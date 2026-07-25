/**
 * AI Gateway (P4 — doc 12 §9 "AI gateway" + audit F).
 *
 * The canonical single entry for EVERY local-LLM inference (chat / copilot / vision /
 * batch). It promotes the pure Model Router (aiModelRouter.route) into a real gateway:
 *
 *   1. ROUTE   — pick tier + model via the existing pure `route()` decision engine.
 *   2. LIMIT   — enforce a per-user, per-tier token-bucket rate limit (in-process).
 *   3. A/B     — optional split flag: deterministically tag a fraction of traffic as
 *                variant "B" so call-sites / analytics can compare two routing arms.
 *   4. METER   — record tokens-in / tokens-out / latency / model / tier / outcome to a
 *                durable table (ai_gateway_metrics), batched + async off the hot path.
 *
 * Backwards compatible by design. The decision (RouteDecision) returned by
 * `planInference()` is byte-identical to what `route()` returned before, so existing
 * call-sites can adopt the gateway incrementally:
 *   • cheapest adoption: replace `route(req)` with `planInference(req)` (adds limit + A/B
 *     + a metrics handle) and call `plan.record({...})` after the inference completes.
 *   • full adoption: wrap the engine call in `routeInference(req, exec)` and the gateway
 *     times it, records metrics, and surfaces rate-limit errors for you.
 *
 * NOTHING here loads a model or blocks; metrics are buffered and flushed by a timer.
 */

import { route, getRouterStats as getInMemoryRouterStats } from "./aiModelRouter";
import type { RouteInput, RouteDecision, TaskKind } from "./aiModelRouter";

export type { RouteInput, RouteDecision, TaskKind } from "./aiModelRouter";

// ─── Public request / result types ─────────────────────────────

export interface GatewayRequest extends RouteInput {
  /** Who triggered it (for per-user rate-limit + metrics). Omit for system/cron callers. */
  userId?: number;
}

export type Outcome = "ok" | "error" | "rate_limited";

/** Token accounting + outcome a caller reports back after running the inference. */
export interface InferenceOutcome {
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
  outcome?: Outcome;
}

/**
 * A planned inference: the routing decision plus the gateway's bookkeeping handles.
 * Call `record()` once the inference finishes (or fails) so the gateway can meter it.
 */
export interface GatewayPlan {
  decision: RouteDecision;
  /** A/B variant assigned to this request ("A" = control, "B" = experiment), or null when A/B is off. */
  abVariant: "A" | "B" | null;
  /** Record token/latency/outcome for this request (idempotent — only the first call counts). */
  record: (o: InferenceOutcome) => void;
}

export class RateLimitError extends Error {
  readonly code = "AI_RATE_LIMITED" as const;
  constructor(
    message: string,
    readonly retryAfterMs: number,
    readonly tier: number,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

// ─── Config (env-tunable) ──────────────────────────────────────

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}
function envFlag(name: string): boolean {
  const v = (process.env[name] || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Per-user, per-minute request budget for EXPENSIVE tiers (deep / vision / HITL = tier ≥ 2).
 * Cheap tiers (0/1) get a higher budget since they are sub-second. Tunable via env.
 */
const LIMIT_WINDOW_MS = 60_000;
const LIMIT_CHEAP_PER_MIN = envInt("AI_GATEWAY_LIMIT_CHEAP_PER_MIN", 120); // tier 0/1
const LIMIT_DEEP_PER_MIN = envInt("AI_GATEWAY_LIMIT_DEEP_PER_MIN", 30); // tier ≥ 2

/** A/B split: fraction of traffic [0,1] tagged variant "B". 0 = A/B off (default). */
function abSplit(): number {
  if (!envFlag("AI_GATEWAY_AB_ENABLED")) return 0;
  const s = envFloat("AI_GATEWAY_AB_SPLIT", 0.5);
  return s < 0 ? 0 : s > 1 ? 1 : s;
}

// ─── Token-bucket rate limiter (in-process, per user+bucket) ───
// Simple fixed-window counter keyed by `${userId}:${bucket}` where bucket is
// "cheap" (tier 0/1) or "deep" (tier ≥ 2). Anonymous/system callers (no userId)
// share a single key per bucket. Fail-OPEN: any internal error never blocks.

interface Window {
  count: number;
  resetAt: number;
}
const windows = new Map<string, Window>();

function bucketFor(tier: number): { name: "cheap" | "deep"; max: number } {
  return tier >= 2 ? { name: "deep", max: LIMIT_DEEP_PER_MIN } : { name: "cheap", max: LIMIT_CHEAP_PER_MIN };
}

/**
 * Returns null when allowed; otherwise the ms until the window resets (rate-limited).
 * Increments the counter on allow.
 */
function checkRateLimit(userId: number | undefined, tier: number): number | null {
  try {
    const { name, max } = bucketFor(tier);
    const key = `${userId ?? "anon"}:${name}`;
    const now = Date.now();
    let w = windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + LIMIT_WINDOW_MS };
      windows.set(key, w);
    }
    if (w.count >= max) return Math.max(1, w.resetAt - now);
    w.count++;
    return null;
  } catch {
    return null; // fail-open: never let the limiter break inference
  }
}

/**
 * Generic per-user fixed-window limiter — REUSES the exact same in-process `windows`
 * store and window length as `checkRateLimit` above, but keyed by a caller-supplied
 * bucket name + max instead of an inference tier. Lets non-inference call-sites (e.g.
 * the AI analytics/report routers, doc 69 W0-3) throttle per-`userId` without
 * borrowing budget from actual LLM inference tiers, while still sharing the same
 * mechanism (and its GC) rather than standing up a parallel limiter. Fail-open, same
 * as checkRateLimit: returns null (allowed) on any internal error.
 */
export function checkNamedRateLimit(userId: number | undefined, bucket: string, maxPerMinute: number): number | null {
  try {
    const key = `${userId ?? "anon"}:${bucket}`;
    const now = Date.now();
    let w = windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + LIMIT_WINDOW_MS };
      windows.set(key, w);
    }
    if (w.count >= maxPerMinute) return Math.max(1, w.resetAt - now);
    w.count++;
    return null;
  } catch {
    return null; // fail-open: never let the limiter break the request
  }
}

// Opportunistic GC of stale windows so the map can't grow unbounded.
function gcWindows(): void {
  const now = Date.now();
  for (const [k, w] of windows) if (w.resetAt + LIMIT_WINDOW_MS < now) windows.delete(k);
}

// ─── A/B assignment (deterministic per user, stable within a window) ───
function assignVariant(userId: number | undefined): "A" | "B" | null {
  const split = abSplit();
  if (split <= 0) return null;
  // Deterministic per user so a given user has a consistent experience; anon → random.
  const basis = userId != null ? hash32(String(userId)) / 0xffffffff : Math.random();
  return basis < split ? "B" : "A";
}
function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ─── Metric buffer (batched, async flush — non-blocking) ───────

interface MetricRow {
  tier: number;
  task: TaskKind;
  model: string;
  abVariant: "A" | "B" | null;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  outcome: Outcome;
  fastModelConfigured: boolean;
  userId: number | null;
  createdAt: Date;
}

const buffer: MetricRow[] = [];
const BUFFER_MAX = 500; // hard cap so a DB outage can't leak memory
let flushTimer: ReturnType<typeof setInterval> | null = null;
const FLUSH_INTERVAL_MS = envInt("AI_GATEWAY_FLUSH_MS", 5_000);

function enqueue(row: MetricRow): void {
  buffer.push(row);
  if (buffer.length > BUFFER_MAX) buffer.splice(0, buffer.length - BUFFER_MAX);
  ensureFlushTimer();
  bumpHotCache(row);
}

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flush();
    gcWindows();
  }, FLUSH_INTERVAL_MS);
  // Don't keep the process alive just for telemetry flushing.
  if (typeof flushTimer.unref === "function") flushTimer.unref();
}

/** Drain the buffer to the DB. Fail-safe: on error the rows are dropped (telemetry only). */
export async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (!db) return; // no DB configured (e.g. tests) → drop silently
    const { aiGatewayMetrics } = await import("../../drizzle/schema");
    await db.insert(aiGatewayMetrics).values(
      batch.map((r) => ({
        tier: r.tier,
        task: r.task,
        model: r.model,
        abVariant: r.abVariant,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        latencyMs: r.latencyMs,
        outcome: r.outcome,
        fastModelConfigured: r.fastModelConfigured,
        userId: r.userId,
        createdAt: r.createdAt,
      })),
    );
  } catch (err) {
    // Telemetry must never break the app. Drop and move on.
    console.warn("[aiGateway] metric flush failed (dropped batch):", (err as Error)?.message);
  }
}

// ─── In-memory hot cache (cheap, restart-resettable) ───────────
// Mirrors the persisted counters so the dashboard has instant numbers even before
// the first DB flush / when the DB is unavailable. Aggregated stats prefer the DB.

interface HotStats {
  total: number;
  byTier: Record<number, number>;
  tokensIn: number;
  tokensOut: number;
  latencySumMs: number;
  rateLimited: number;
  errors: number;
  fastModelConfigured: boolean;
}
const hot: HotStats = {
  total: 0,
  byTier: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 },
  tokensIn: 0,
  tokensOut: 0,
  latencySumMs: 0,
  rateLimited: 0,
  errors: 0,
  fastModelConfigured: false,
};

function bumpHotCache(r: MetricRow): void {
  hot.total++;
  hot.byTier[r.tier] = (hot.byTier[r.tier] ?? 0) + 1;
  hot.tokensIn += r.tokensIn;
  hot.tokensOut += r.tokensOut;
  hot.latencySumMs += r.latencyMs;
  if (r.outcome === "rate_limited") hot.rateLimited++;
  else if (r.outcome === "error") hot.errors++;
  hot.fastModelConfigured = r.fastModelConfigured;
}

// ─── Core API ──────────────────────────────────────────────────

/**
 * Plan an inference: route it, enforce the rate limit, assign an A/B variant, and hand
 * back a `record()` callback to meter the outcome. Throws {@link RateLimitError} when the
 * caller's per-tier budget is exhausted (caller maps it to a 429 / friendly message).
 *
 * This is the recommended low-friction adoption: callers that already use `route()` swap
 * to `planInference()`, use `plan.decision` exactly as before, and call `plan.record()`
 * once the engine returns.
 */
export function planInference(req: GatewayRequest): GatewayPlan {
  const decision = route(req); // pure decision (also feeds the legacy in-memory router counter)
  const abVariant = assignVariant(req.userId);

  const retry = checkRateLimit(req.userId, decision.tier);
  if (retry != null) {
    // Record the rejection (so dashboards show throttling) before throwing.
    enqueue(toRow(req, decision, abVariant, { outcome: "rate_limited" }));
    throw new RateLimitError(
      `AI rate limit exceeded for tier ${decision.tier}. Retry in ~${Math.ceil(retry / 1000)}s.`,
      retry,
      decision.tier,
    );
  }

  let recorded = false;
  const record = (o: InferenceOutcome) => {
    if (recorded) return;
    recorded = true;
    enqueue(toRow(req, decision, abVariant, o));
  };

  return { decision, abVariant, record };
}

/**
 * Full-adoption wrapper: route + rate-limit + A/B, then run `exec(decision)` while the
 * gateway times it and records token/latency/outcome automatically. `exec` receives the
 * routing decision and must return the inference result + its token counts.
 */
export async function routeInference<T>(
  req: GatewayRequest,
  exec: (decision: RouteDecision, abVariant: "A" | "B" | null) => Promise<{ result: T; tokensIn?: number; tokensOut?: number }>,
): Promise<{ result: T; decision: RouteDecision; abVariant: "A" | "B" | null }> {
  const plan = planInference(req); // may throw RateLimitError
  const start = Date.now();
  try {
    const { result, tokensIn, tokensOut } = await exec(plan.decision, plan.abVariant);
    plan.record({ tokensIn, tokensOut, latencyMs: Date.now() - start, outcome: "ok" });
    return { result, decision: plan.decision, abVariant: plan.abVariant };
  } catch (err) {
    plan.record({ latencyMs: Date.now() - start, outcome: "error" });
    throw err;
  }
}

function toRow(
  req: GatewayRequest,
  decision: RouteDecision,
  abVariant: "A" | "B" | null,
  o: InferenceOutcome,
): MetricRow {
  return {
    tier: decision.tier,
    task: req.task,
    model: decision.modelId ?? "default",
    abVariant,
    tokensIn: Math.max(0, Math.trunc(o.tokensIn ?? 0)),
    tokensOut: Math.max(0, Math.trunc(o.tokensOut ?? 0)),
    latencyMs: Math.max(0, Math.trunc(o.latencyMs ?? 0)),
    outcome: o.outcome ?? "ok",
    fastModelConfigured: getInMemoryRouterStats().fastModelConfigured,
    userId: req.userId ?? null,
    createdAt: new Date(),
  };
}

// ─── Stats readers (DB-backed with hot-cache fallback) ─────────

export interface GatewayStats {
  /** "db" when aggregated from ai_gateway_metrics, "memory" when DB unavailable. */
  source: "db" | "memory";
  total: number;
  byTier: Record<number, number>;
  tokensIn: number;
  tokensOut: number;
  avgLatencyMs: number;
  rateLimited: number;
  errors: number;
  fastModelConfigured: boolean;
  /** Per-model token + latency breakdown (top models, DB source only). */
  byModel: Array<{ model: string; count: number; tokensIn: number; tokensOut: number; avgLatencyMs: number }>;
  /** A/B variant split (counts), null when A/B has never been active. */
  ab: { A: number; B: number } | null;
}

/** Hot-cache snapshot (instant; resets on restart). */
function hotSnapshot(): GatewayStats {
  return {
    source: "memory",
    total: hot.total,
    byTier: { ...hot.byTier },
    tokensIn: hot.tokensIn,
    tokensOut: hot.tokensOut,
    avgLatencyMs: hot.total > 0 ? Math.round(hot.latencySumMs / hot.total) : 0,
    rateLimited: hot.rateLimited,
    errors: hot.errors,
    fastModelConfigured: hot.fastModelConfigured || getInMemoryRouterStats().fastModelConfigured,
    byModel: [],
    ab: null,
  };
}

/**
 * Aggregate gateway stats from the persisted table over the last `sinceHours` (default 24h).
 * Falls back to the in-memory hot cache when the DB is unavailable (honest `source` flag).
 * Honest-empty: returns zeroes (not fake data) when nothing has been routed yet.
 */
export async function getGatewayStats(sinceHours = 24): Promise<GatewayStats> {
  try {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (!db) return hotSnapshot();

    const { aiGatewayMetrics } = await import("../../drizzle/schema");
    const { sql, gte } = await import("drizzle-orm");
    const since = new Date(Date.now() - sinceHours * 3_600_000);

    // Flush any buffered rows first so the read reflects very-recent activity.
    await flush();

    const rows = await db
      .select({
        tier: aiGatewayMetrics.tier,
        model: aiGatewayMetrics.model,
        abVariant: aiGatewayMetrics.abVariant,
        outcome: aiGatewayMetrics.outcome,
        cnt: sql<number>`count(*)::int`,
        tin: sql<number>`coalesce(sum(${aiGatewayMetrics.tokensIn}),0)::int`,
        tout: sql<number>`coalesce(sum(${aiGatewayMetrics.tokensOut}),0)::int`,
        latSum: sql<number>`coalesce(sum(${aiGatewayMetrics.latencyMs}),0)::bigint`,
      })
      .from(aiGatewayMetrics)
      .where(gte(aiGatewayMetrics.createdAt, since))
      .groupBy(aiGatewayMetrics.tier, aiGatewayMetrics.model, aiGatewayMetrics.abVariant, aiGatewayMetrics.outcome);

    if (rows.length === 0) {
      // Nothing persisted in-window: honest empty, but surface the live hot cache if it has data.
      return hot.total > 0 ? hotSnapshot() : emptyDbStats();
    }

    const out: GatewayStats = {
      source: "db",
      total: 0,
      byTier: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 },
      tokensIn: 0,
      tokensOut: 0,
      avgLatencyMs: 0,
      rateLimited: 0,
      errors: 0,
      fastModelConfigured: getInMemoryRouterStats().fastModelConfigured,
      byModel: [],
      ab: null,
    };
    let latSum = 0;
    let aCount = 0;
    let bCount = 0;
    const modelAgg = new Map<string, { count: number; tokensIn: number; tokensOut: number; latSum: number }>();

    for (const r of rows) {
      const cnt = Number(r.cnt) || 0;
      const tin = Number(r.tin) || 0;
      const tout = Number(r.tout) || 0;
      const ls = Number(r.latSum) || 0;
      out.total += cnt;
      out.byTier[r.tier] = (out.byTier[r.tier] ?? 0) + cnt;
      out.tokensIn += tin;
      out.tokensOut += tout;
      latSum += ls;
      if (r.outcome === "rate_limited") out.rateLimited += cnt;
      else if (r.outcome === "error") out.errors += cnt;
      if (r.abVariant === "A") aCount += cnt;
      else if (r.abVariant === "B") bCount += cnt;

      const m = modelAgg.get(r.model) ?? { count: 0, tokensIn: 0, tokensOut: 0, latSum: 0 };
      m.count += cnt;
      m.tokensIn += tin;
      m.tokensOut += tout;
      m.latSum += ls;
      modelAgg.set(r.model, m);
    }

    out.avgLatencyMs = out.total > 0 ? Math.round(latSum / out.total) : 0;
    out.byModel = [...modelAgg.entries()]
      .map(([model, m]) => ({
        model,
        count: m.count,
        tokensIn: m.tokensIn,
        tokensOut: m.tokensOut,
        avgLatencyMs: m.count > 0 ? Math.round(m.latSum / m.count) : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    out.ab = aCount > 0 || bCount > 0 ? { A: aCount, B: bCount } : null;
    return out;
  } catch (err) {
    console.warn("[aiGateway] getGatewayStats DB read failed, using hot cache:", (err as Error)?.message);
    return hotSnapshot();
  }
}

function emptyDbStats(): GatewayStats {
  return {
    source: "db",
    total: 0,
    byTier: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 },
    tokensIn: 0,
    tokensOut: 0,
    avgLatencyMs: 0,
    rateLimited: 0,
    errors: 0,
    fastModelConfigured: getInMemoryRouterStats().fastModelConfigured,
    byModel: [],
    ab: null,
  };
}

/** Whether the A/B split is currently enabled (for UI badges). */
export function isAbEnabled(): boolean {
  return abSplit() > 0;
}
