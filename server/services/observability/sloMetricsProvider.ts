/**
 * SLO observation provider — HTTP feed bridge (doc 38 Đợt P · P0-A "0 provider" fix).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * GAP this closes: `startSloEvaluator()` runs but `registerSloObservationProvider()` is never
 * called anywhere → the evaluator sweeps SLOs with NO feed, so burn-rate stays "no data" and an
 * alert can never fire. This module is the missing feed: a lightweight rolling-window tracker of
 * real HTTP request latency + error-rate that yields the (good,total) short/long windows the
 * multi-window burn-rate math consumes, and registers one provider per catalogue SLO.
 *
 * ─── Why a rolling window and NOT prom-client histogram buckets ──────────────
 * The prom-client histogram (avi_aoi_http_request_duration_seconds) is CUMULATIVE since process
 * start — monotonic counters, no notion of "last 5 min" vs "last 1 h". Multi-window burn rate needs
 * two DISJOINT rolling windows, which a cumulative histogram cannot give without snapshotting +
 * diffing anyway. So we keep an independent, allocation-light time-bucketed ring (fed from the same
 * metricsMiddleware hook) that gives true rolling windows at ~O(1) per request and O(#buckets) per
 * evaluation. It is also prom-client-free, so the SLO feed still works when METRICS_ENABLED is off
 * (as long as OBSERVABILITY is on) — honest-degrade.
 *
 * ─── SLI mapping (real signal, honest scope) ─────────────────────────────────
 *   • Latency SLOs (kind:"latency", latencyThresholdMs T): SLI = fraction of HTTP requests with
 *     duration ≤ T. good = count(duration ≤ T), total = count. This IS the p95/p99-style objective
 *     ("≥ objective of requests under T ms"). NOTE: the scope here is ALL HTTP traffic — a first-pass
 *     PROXY for the subsystem-specific SLOs (dispatch / UNS / twin). A subsystem that later
 *     instruments its own latency simply calls registerSloObservationProvider(<same id>, …) and
 *     REPLACES this HTTP proxy (register = last-writer-wins by id). See §limitations in the plan.
 *   • Availability SLO (kind:"availability"): good = non-5xx responses, total = all. This is an
 *     EXACT match for "control API availability" — real HTTP error-budget from status ≥ 500.
 *
 * FLAG: activated only when OBSERVABILITY is on (installSloMetricsProviders is a no-op otherwise).
 * With the tracker inactive, sloHttpTrackingActive() is false and the middleware never records.
 * ════════════════════════════════════════════════════════════════════════════
 */
import {
  DEFAULT_SLOS,
  type SloObservation,
} from "./slo";
import { registerSloObservationProvider, observabilityEnabled } from "./sloAlerting";

// ── config (env-driven; honest defaults) ─────────────────────────────────────

const BUCKET_MS = 60_000; // 1-minute time buckets

function shortWindowMs(): number {
  const n = parseInt(process.env.OBS_SLO_SHORT_WINDOW_MS || String(5 * 60_000), 10);
  return Number.isFinite(n) && n >= BUCKET_MS ? n : 5 * 60_000;
}

function longWindowMs(): number {
  const n = parseInt(process.env.OBS_SLO_LONG_WINDOW_MS || String(60 * 60_000), 10);
  return Number.isFinite(n) && n >= BUCKET_MS ? n : 60 * 60_000;
}

// ── which SLOs the generic HTTP proxy may feed ────────────────────────────────

/**
 * W0-F (doc 44): SLOs whose signal is NOT server-HTTP latency. Feeding them from
 * the HTTP ring would be DISHONEST (screen-load is client-side LCP; policy-eval /
 * state-read are subsystem-internal calls, not HTTP round-trips), so they are
 * excluded from the generic proxy and get dedicated providers below.
 */
const HTTP_PROXY_EXCLUDED_SLO_IDS = new Set(["screen-load-p95", "policy-eval-p95", "state-read-p95"]);

/** Catalogue SLOs the HTTP rolling-window proxy is allowed to feed. */
const HTTP_PROXIED_SLOS = DEFAULT_SLOS.filter((s) => !HTTP_PROXY_EXCLUDED_SLO_IDS.has(s.id));

// ── latency thresholds that matter (from the HTTP-proxied catalogue) ─────────

/** Distinct latency thresholds (ms), ascending — one "good count" column per threshold. */
const THRESHOLDS: number[] = Array.from(
  new Set(
    HTTP_PROXIED_SLOS.filter(
      (s) => s.kind === "latency" && typeof s.latencyThresholdMs === "number",
    ).map((s) => s.latencyThresholdMs as number),
  ),
).sort((a, b) => a - b);

function thresholdIndex(t: number): number {
  return THRESHOLDS.indexOf(t);
}

// ── rolling-window ring ───────────────────────────────────────────────────────

interface Bucket {
  /** Bucket-aligned start (ms). A slot whose startMs ≠ the current alignment is stale. */
  startMs: number;
  total: number;
  errors: number; // status >= 500
  /** Count of requests with duration ≤ THRESHOLDS[i], parallel to THRESHOLDS. */
  under: number[];
}

// Ring big enough to cover the long window + margin, sized off the default long window so a smaller
// env override never under-provisions. Reset-on-stale reclaims wrapped slots with zero pruning cost.
const RING_CAP = Math.ceil((60 * 60_000) / BUCKET_MS) + 2; // ~62 slots (1 h + 2 min)
const ring: (Bucket | null)[] = new Array(RING_CAP).fill(null);

let active = false;

function freshBucket(startMs: number): Bucket {
  return { startMs, total: 0, errors: 0, under: new Array(THRESHOLDS.length).fill(0) };
}

/** Cheap boolean the request hot-path checks before doing any work. */
export function sloHttpTrackingActive(): boolean {
  return active;
}

/**
 * Record one finished HTTP request into the rolling window. Called from metricsMiddleware's
 * `finish` handler. No-op (and effectively free) when tracking is inactive. Never throws.
 */
export function recordHttpForSlo(durationMs: number, statusCode: number): void {
  if (!active) return;
  try {
    const now = Date.now();
    const startMs = now - (now % BUCKET_MS);
    const idx = Math.floor(startMs / BUCKET_MS) % RING_CAP;
    let b = ring[idx];
    if (!b || b.startMs !== startMs) {
      b = freshBucket(startMs);
      ring[idx] = b;
    }
    b.total += 1;
    if (statusCode >= 500) b.errors += 1;
    for (let i = 0; i < THRESHOLDS.length; i++) {
      if (durationMs <= THRESHOLDS[i]) b.under[i] += 1;
    }
  } catch {
    /* metrics must never break a request */
  }
}

interface WindowSum {
  total: number;
  errors: number;
  under: number[];
}

/** Sum every live bucket whose start falls within `windowMs` of now. */
function sumWindow(windowMs: number, now: number): WindowSum {
  const cutoff = now - windowMs;
  const out: WindowSum = { total: 0, errors: 0, under: new Array(THRESHOLDS.length).fill(0) };
  for (const b of ring) {
    if (!b) continue;
    if (b.startMs <= cutoff || b.startMs > now) continue; // stale/outside-window slots excluded
    out.total += b.total;
    out.errors += b.errors;
    for (let i = 0; i < THRESHOLDS.length; i++) out.under[i] += b.under[i];
  }
  return out;
}

// ── per-SLO observation providers ─────────────────────────────────────────────

/** Latency SLO feed: good = requests under threshold T; total = all. null when no data yet. */
function latencyObservation(thresholdMs: number): { short: SloObservation; long: SloObservation } | null {
  const i = thresholdIndex(thresholdMs);
  if (i < 0) return null;
  const now = Date.now();
  const long = sumWindow(longWindowMs(), now);
  if (long.total === 0) return null; // honest: no traffic → no data (never fabricate)
  const short = sumWindow(shortWindowMs(), now);
  return {
    short: { good: short.under[i], total: short.total },
    long: { good: long.under[i], total: long.total },
  };
}

/** Availability SLO feed: good = non-5xx; total = all. null when no data yet. */
function availabilityObservation(): { short: SloObservation; long: SloObservation } | null {
  const now = Date.now();
  const long = sumWindow(longWindowMs(), now);
  if (long.total === 0) return null;
  const short = sumWindow(shortWindowMs(), now);
  return {
    short: { good: short.total - short.errors, total: short.total },
    long: { good: long.total - long.errors, total: long.total },
  };
}

// ── W0-F: screen-load-p95 — RUM LCP histogram feed (rum_web_vitals_lcp_ms) ────
//
// The client-ingest path (parallel W0 batch) records real-user LCP into a
// prom-client histogram named `rum_web_vitals_lcp_ms`. That histogram is
// CUMULATIVE since process start, so this provider snapshots (good,total) each
// evaluator tick and DIFFS rolling windows out of the snapshots — the same
// multi-window shape the burn-rate math consumes.
//
// HONEST: prom-client absent / metric not registered (ingest not deployed yet or
// METRICS off) / no snapshots / zero traffic in the window → null ("no data",
// never fabricated). prom-client `.get()` is async while providers are sync, so
// the provider serves the cached snapshots and fires a refresh in the background
// (first tick(s) honestly report null until the cache warms).

const RUM_LCP_METRIC = "rum_web_vitals_lcp_ms";

interface RumSnap {
  t: number;
  good: number; // observations ≤ threshold (cumulative)
  total: number; // all observations (cumulative)
}

const rumSnaps: RumSnap[] = [];
let rumRefreshing = false;

/**
 * Read the cumulative (good,total) of the RUM LCP histogram from the prom-client
 * DEFAULT registry. `good` = the cumulative bucket with the largest `le` ≤ the
 * threshold (exact when a 2000ms boundary exists; otherwise conservatively
 * undercounts "good"). Returns null when the metric/package is absent.
 */
async function readRumCumulative(thresholdMs: number): Promise<{ good: number; total: number } | null> {
  try {
    const pkg = "prom-client";
    const promClient = await import(pkg).catch(() => null);
    if (!promClient) return null;
    const client = (promClient as { default?: unknown }).default ?? promClient;
    const registry = (client as { register?: { getSingleMetric?: (n: string) => unknown } }).register;
    const metric = registry?.getSingleMetric?.(RUM_LCP_METRIC) as
      | { get: () => Promise<{ values?: Array<{ metricName?: string; value?: number; labels?: Record<string, unknown> }> }> }
      | undefined;
    if (!metric || typeof metric.get !== "function") return null; // honest: not registered yet

    const data = await metric.get();
    const values = data?.values ?? [];
    let total = 0;
    let sawCount = false;
    // Per label-set, keep the bucket with the largest le ≤ threshold.
    const bestByLabelSet = new Map<string, { le: number; value: number }>();
    for (const v of values) {
      const mn = v.metricName ?? "";
      if (mn.endsWith("_count")) {
        total += Number(v.value) || 0;
        sawCount = true;
      } else if (mn.endsWith("_bucket")) {
        const rawLe = (v.labels as { le?: unknown } | undefined)?.le;
        const le = rawLe === "+Inf" ? Infinity : Number(rawLe);
        if (!Number.isFinite(le) || le > thresholdMs) continue;
        const { le: _le, ...rest } = (v.labels ?? {}) as Record<string, unknown>;
        const key = JSON.stringify(rest);
        const prev = bestByLabelSet.get(key);
        if (!prev || le > prev.le) bestByLabelSet.set(key, { le, value: Number(v.value) || 0 });
      }
    }
    if (!sawCount) return null;
    let good = 0;
    for (const b of bestByLabelSet.values()) good += b.value;
    return { good, total };
  } catch {
    return null; // metrics must never throw into the evaluator
  }
}

/** Background snapshot refresh (non-overlapping). Prunes beyond the long window. */
function refreshRumSnapshot(thresholdMs: number): void {
  if (rumRefreshing) return;
  rumRefreshing = true;
  void readRumCumulative(thresholdMs)
    .then((cum) => {
      if (!cum) return;
      rumSnaps.push({ t: Date.now(), good: cum.good, total: cum.total });
      // Keep just enough history to cover the long window (+ margin).
      const cutoff = Date.now() - (longWindowMs() + 5 * BUCKET_MS);
      while (rumSnaps.length > 2 && rumSnaps[0].t < cutoff) rumSnaps.shift();
    })
    .finally(() => {
      rumRefreshing = false;
    });
}

/** Latest snapshot at/before `t`, else the oldest available (or null when none). */
function rumBaselineAt(t: number): RumSnap | null {
  let base: RumSnap | null = null;
  for (const s of rumSnaps) {
    if (s.t <= t) base = s;
    else break;
  }
  return base ?? rumSnaps[0] ?? null;
}

/** screen-load-p95 provider: rolling windows diffed from cumulative RUM snapshots. */
function rumLcpObservation(thresholdMs: number): { short: SloObservation; long: SloObservation } | null {
  refreshRumSnapshot(thresholdMs); // fire-and-forget; serves the cache below
  if (rumSnaps.length < 2) return null; // honest: not enough history to diff
  const now = Date.now();
  const cur = rumSnaps[rumSnaps.length - 1];
  const longBase = rumBaselineAt(now - longWindowMs());
  const shortBase = rumBaselineAt(now - shortWindowMs());
  if (!longBase || longBase.t >= cur.t) return null;
  const diff = (a: RumSnap, b: RumSnap): SloObservation => ({
    good: Math.max(0, b.good - a.good),
    total: Math.max(0, b.total - a.total),
  });
  const long = diff(longBase, cur);
  if (long.total === 0) return null; // honest: no RUM traffic in the window
  const short = shortBase && shortBase.t < cur.t ? diff(shortBase, cur) : { good: 0, total: 0 };
  return { short, long };
}

// ── install (called once at observability startup) ───────────────────────────

/**
 * Register an observation provider for every catalogue SLO and arm the request-path
 * tracker. Idempotent. NO-OP when OBSERVABILITY is off (evaluator itself is off too, so there is
 * nothing to feed). Never throws into startup.
 *
 * Provider assignment (register = last-writer-wins by id, so a subsystem with a
 * better signal can replace any of these later):
 *   • HTTP-proxied SLOs → the rolling-window HTTP tracker (as before).
 *   • screen-load-p95   → RUM LCP histogram diff (null until the metric exists).
 *   • policy-eval-p95 / state-read-p95 → null (chưa instrument — W2/W3): the
 *     policy engine / state-read paths have no latency instrumentation yet, so
 *     the ONLY honest observation is "no data". NEVER fabricate numbers here.
 */
export function installSloMetricsProviders(): void {
  if (!observabilityEnabled()) {
    console.log("[SLO] OBSERVABILITY off — HTTP metrics provider not installed.");
    return;
  }

  for (const target of HTTP_PROXIED_SLOS) {
    if (target.kind === "latency" && typeof target.latencyThresholdMs === "number") {
      const t = target.latencyThresholdMs;
      registerSloObservationProvider(target.id, () => latencyObservation(t));
    } else if (target.kind === "availability") {
      registerSloObservationProvider(target.id, () => availabilityObservation());
    }
  }

  // W0-F dedicated feeds (see block comment above).
  const screenLoad = DEFAULT_SLOS.find((s) => s.id === "screen-load-p95");
  if (screenLoad?.latencyThresholdMs) {
    const t = screenLoad.latencyThresholdMs;
    registerSloObservationProvider("screen-load-p95", () => rumLcpObservation(t));
  }
  // Chưa instrument — W2/W3: honest null until the real subsystem feed registers.
  registerSloObservationProvider("policy-eval-p95", () => null);
  registerSloObservationProvider("state-read-p95", () => null);

  active = true;
  console.log(
    `[SLO] metrics providers installed for ${DEFAULT_SLOS.length} SLO(s) ` +
      `(HTTP-proxied=${HTTP_PROXIED_SLOS.length}, RUM=screen-load-p95, ` +
      `pending-instrumentation=policy-eval-p95,state-read-p95; ` +
      `short=${shortWindowMs()}ms, long=${longWindowMs()}ms, thresholds=[${THRESHOLDS.join(",")}]ms).`,
  );
}

// ── test / teardown helper ────────────────────────────────────────────────────

/** Reset the tracker (tests). */
export function _resetSloMetricsProvider(): void {
  active = false;
  ring.fill(null);
  rumSnaps.length = 0;
  rumRefreshing = false;
}
