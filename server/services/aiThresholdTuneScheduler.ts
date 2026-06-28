/**
 * Threshold Auto-Tune Scheduler — periodically checks whether a threshold has
 * become suboptimal (now that enough new data has accumulated) and, when so,
 * creates a HUMAN-IN-THE-LOOP proposal so a responsible user can 1-tap approve it.
 *
 * This complements the Setup Advisor's "copy now, tune later" decision: copied
 * limits are a starting point; this cron watches the data and PROPOSES a tuned
 * value once it is materially better — it NEVER applies anything itself.
 *
 *   • NG-rate thresholds → proposeAction(adjust_ng_threshold, recommendedArgs) to
 *     the responsible users (role maintenance/supervisor in the factory who hold
 *     the tool permission) → lands in their AI Action inbox for 1-tap approve.
 *   • Measurement-point limits → a threshold-approval REQUEST (the existing
 *     human-approval queue) → shows in the approval queue for a quality manager.
 *
 * Reuses (never re-implements): aiThresholdAdvisor.recommendNgThreshold /
 * recommendForMeasurementPoint, aiCopilotActions.proposeAction, the
 * threshold_approvals queue, and aiAutoProposer's responsible-user targeting
 * pattern (replicated locally — findResponsibleUsers is not exported there).
 *
 * Additive, flag-gated (default OFF → safe no-op), fail-safe (a bad scope logs and
 * never aborts the run; a scheduler error never crashes boot). Mirrors
 * aiAnomalyBankScheduler (node-cron registration + start/stop + pure decide fn).
 *
 * Env flags:
 *   AI_THRESHOLD_AUTOTUNE_ENABLED      (default "false" — master switch, safe no-op when off)
 *   AI_THRESHOLD_AUTOTUNE_CRON         (default "0 4 * * *" — 04:00 daily)
 *   AI_THRESHOLD_AUTOTUNE_TZ           (default "Asia/Ho_Chi_Minh")
 *   AI_THRESHOLD_AUTOTUNE_MIN_SAMPLES  (default 300 — min recent samples in scope to consider)
 *   AI_THRESHOLD_AUTOTUNE_CPK_TARGET   (default 1.33 — only propose a point when current Cpk < target)
 *   AI_THRESHOLD_AUTOTUNE_MIN_DELTA    (default 0.1 — min material change: ΔCpk for points, OR
 *                                       relative NG warn/crit shift fraction for NG thresholds)
 *   AI_THRESHOLD_AUTOTUNE_MAX_PER_RUN  (default 20 — safety cap; cappedOut is logged, not silent)
 *   AI_THRESHOLD_AUTOTUNE_SCOPE        (default "both" — "ng" | "point" | "both")
 *   AI_THRESHOLD_AUTOTUNE_THROTTLE_MS  (default 24h — per-scope re-propose cooldown)
 *   AI_THRESHOLD_AUTOTUNE_WINDOW_DAYS  (default 30 — recency window for sample counts + advisor)
 */

import * as cron from "node-cron";
import {
  enumerateNgTuneScopes,
  enumeratePointTuneScopes,
  factoryCodeForMachine,
  type NgTuneScope,
  type PointTuneScope,
} from "../db/aiThresholdTune";
import {
  recommendNgThreshold,
  recommendForMeasurementPoint,
  type NgRecommendation,
  type PointRecommendation,
} from "./aiThresholdAdvisor";

// ─── Config (env, safe defaults) ──────────────────────────────────────────────

const ENABLED = String(process.env.AI_THRESHOLD_AUTOTUNE_ENABLED ?? "false").toLowerCase() === "true";
const CRON = process.env.AI_THRESHOLD_AUTOTUNE_CRON || "0 4 * * *";
const TZ = process.env.AI_THRESHOLD_AUTOTUNE_TZ || "Asia/Ho_Chi_Minh";
const MIN_SAMPLES = Math.max(1, Number(process.env.AI_THRESHOLD_AUTOTUNE_MIN_SAMPLES ?? 300));
const CPK_TARGET = numOr(process.env.AI_THRESHOLD_AUTOTUNE_CPK_TARGET, 1.33);
const MIN_DELTA = numOr(process.env.AI_THRESHOLD_AUTOTUNE_MIN_DELTA, 0.1);
const MAX_PER_RUN = Math.max(1, Number(process.env.AI_THRESHOLD_AUTOTUNE_MAX_PER_RUN ?? 20));
const THROTTLE_MS = Math.max(1, Number(process.env.AI_THRESHOLD_AUTOTUNE_THROTTLE_MS ?? 24 * 60 * 60 * 1000));
const WINDOW_DAYS = Math.max(1, Number(process.env.AI_THRESHOLD_AUTOTUNE_WINDOW_DAYS ?? 30));

function numOr(raw: string | undefined, fallback: number): number {
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

type ConfiguredScope = "ng" | "point";

function configuredScopes(): ConfiguredScope[] {
  const raw = (process.env.AI_THRESHOLD_AUTOTUNE_SCOPE || "both").trim().toLowerCase();
  if (raw === "ng") return ["ng"];
  if (raw === "point") return ["point"];
  return ["ng", "point"];
}

// ─── Tune-decision (pure, exported for tests) ─────────────────────────────────

export interface TuneConfig {
  minSamples: number;
  cpkTarget: number;
  /** Min material change to bother (ΔCpk for points; relative NG shift fraction for NG). */
  minDelta: number;
}

export interface TuneDecision {
  propose: boolean;
  /** Machine-readable reason for the per-run summary / logs. */
  reason:
    | "ok_point"
    | "ok_ng"
    | "disabled"
    | "advisor_failed"
    | "degraded"
    | "sub_min_samples"
    | "already_good"
    | "immaterial"
    | "no_change";
}

/**
 * decidePointTune — PURE. Propose tuning a measurement point ONLY when:
 *   1. The advisor returned a real, non-degraded recommendation (enough data),
 *   2. there is ≥ minSamples,
 *   3. the CURRENT Cpk is below target (suboptimal), and
 *   4. the projected Cpk improvement is material (projectedCpk - currentCpk ≥ minDelta).
 * Otherwise skip (avoid churn).
 */
export function decidePointTune(rec: PointRecommendation, cfg: TuneConfig): TuneDecision {
  if (!rec.ok || rec.disabled) return { propose: false, reason: "disabled" };
  if (rec.degraded) return { propose: false, reason: "degraded" };
  if (rec.sampleSize < cfg.minSamples) return { propose: false, reason: "sub_min_samples" };

  const current = rec.current.cpk;
  const projected = rec.recommended.projectedCpk;
  // Current must be known and below target to be "suboptimal".
  if (current != null && Number.isFinite(current) && current >= cfg.cpkTarget) {
    return { propose: false, reason: "already_good" };
  }
  const base = current != null && Number.isFinite(current) ? current : 0;
  const delta = projected - base;
  if (!(delta >= cfg.minDelta)) return { propose: false, reason: "immaterial" };

  return { propose: true, reason: "ok_point" };
}

/** Relative shift between two NG-rate values (fraction of the larger magnitude). */
function relShift(a: number | null, b: number): number {
  if (a == null || !Number.isFinite(a)) return Infinity; // unset current → any value is material
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-6);
  return Math.abs(b - a) / denom;
}

/**
 * decideNgTune — PURE. Propose tuning an NG threshold ONLY when:
 *   1. The advisor returned a real, non-degraded recommendation (enough data),
 *   2. there is ≥ minSamples observations, and
 *   3. the recommended warning OR critical drifts from the current by ≥ minDelta
 *      (relative). Otherwise skip (avoid churn).
 */
export function decideNgTune(rec: NgRecommendation, cfg: TuneConfig): TuneDecision {
  if (!rec.ok || rec.disabled) return { propose: false, reason: "disabled" };
  if (rec.degraded) return { propose: false, reason: "degraded" };
  if (rec.sampleSize < cfg.minSamples) return { propose: false, reason: "sub_min_samples" };

  const warnShift = relShift(rec.current.warning, rec.recommended.warning);
  const critShift = relShift(rec.current.critical, rec.recommended.critical);
  if (Math.max(warnShift, critShift) < cfg.minDelta) return { propose: false, reason: "immaterial" };

  return { propose: true, reason: "ok_ng" };
}

// ─── Throttle / dedup state (per scope key) ───────────────────────────────────

const lastProposeByScope = new Map<string, number>();

function ngScopeKey(s: NgTuneScope): string {
  return `ng:${s.ngThresholdId}`;
}
function pointScopeKey(s: PointTuneScope): string {
  return `point:${s.pointDefId}`;
}

function isThrottled(key: string, now: number): boolean {
  const last = lastProposeByScope.get(key) ?? 0;
  return now - last < THROTTLE_MS;
}
function markProposed(key: string, now: number): void {
  lastProposeByScope.set(key, now);
}

// ─── Responsible-user targeting (replicates aiAutoProposer.findResponsibleUsers) ──

/**
 * Users responsible for the affected factory who HOLD the tool's permission.
 * role ∈ {maintenance, supervisor}, assigned to factoryCode (when known),
 * checkPermission OK. Returns up to `cap`. Fail-safe → [].
 */
async function findResponsibleUsers(
  factoryCode: string | null,
  perm: { module: string; action: string },
  cap: number,
): Promise<Array<{ id: number; role: string; name?: string | null }>> {
  try {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (!db) return [];
    const { inArray, eq, and } = await import("drizzle-orm");
    const { users, userFactoryAssignments } = await import("../../drizzle/schema");
    const { checkPermission } = await import("../_core/accessControl");

    const targetRoles = ["maintenance", "supervisor"];
    const candidates = await db
      .select({ id: users.id, role: users.role, name: users.name })
      .from(users)
      .where(and(inArray(users.role, targetRoles as any), eq(users.isActive, true)));

    let scoped = candidates;
    if (factoryCode) {
      const assigns = await db
        .select({ userId: userFactoryAssignments.userId })
        .from(userFactoryAssignments)
        .where(eq(userFactoryAssignments.factoryCode, factoryCode));
      const assignedIds = new Set(assigns.map((a) => a.userId));
      scoped = candidates.filter((u) => assignedIds.has(u.id));
    }

    const permitted: Array<{ id: number; role: string; name?: string | null }> = [];
    for (const u of scoped) {
      if (permitted.length >= cap) break;
      try {
        const ok = await checkPermission(u.id, String(u.role), perm.module, perm.action as any);
        if (ok) permitted.push({ id: u.id, role: String(u.role), name: u.name });
      } catch {
        /* skip user on permission-check error */
      }
    }
    return permitted;
  } catch (err) {
    console.error("[aiThresholdTuneScheduler] findResponsibleUsers failed:", (err as Error)?.message ?? err);
    return [];
  }
}

// ─── HITL proposal creators (never auto-apply) ────────────────────────────────

/**
 * Create NG-threshold proposals via proposeAction(adjust_ng_threshold) for the
 * responsible users → their inbox (1-tap approve). Returns count of users proposed to.
 */
async function proposeNgTune(scope: NgTuneScope, rec: NgRecommendation): Promise<number> {
  const { getTool, isWriteTool } = await import("./aiLocalTools/toolRegistry");
  // Ensure write-tools are registered (idempotent side-effect import).
  await import("./aiLocalTools/writeHandlers/engineering").catch(() => undefined);
  const tool = getTool("adjust_ng_threshold");
  if (!tool || !isWriteTool(tool) || !tool.requiredPermission) {
    console.warn("[aiThresholdTuneScheduler] adjust_ng_threshold tool unavailable — skipping NG propose");
    return 0;
  }

  const factoryCode = await factoryCodeForMachine(scope.machineId);
  const targets = await findResponsibleUsers(factoryCode, tool.requiredPermission, MAX_PER_RUN);
  if (targets.length === 0) return 0;

  const args: Record<string, unknown> = {
    thresholdId: scope.ngThresholdId,
    warningThreshold: rec.recommended.warning,
    criticalThreshold: rec.recommended.critical,
  };
  // Defense in depth: re-validate against the tool bounds before proposing.
  try {
    const parsed = (tool.parameters as { safeParse?: (a: unknown) => { success: boolean } }).safeParse?.(args);
    if (parsed && !parsed.success) {
      console.warn(`[aiThresholdTuneScheduler] ng#${scope.ngThresholdId} args out of bounds — skipping`);
      return 0;
    }
  } catch {
    /* tool without zod safeParse → trust advisor-clamped args */
  }

  const { proposeAction } = await import("./aiCopilotActions");
  let proposed = 0;
  for (const u of targets) {
    try {
      // HITL: PROPOSE ONLY. Never confirm/execute.
      const res = await proposeAction(tool, args, {
        user: { id: u.id, role: u.role, name: u.name ?? null },
        lang: "vi",
      });
      if (res.ok) proposed++;
    } catch (err) {
      console.error("[aiThresholdTuneScheduler] proposeAction failed:", (err as Error)?.message ?? err);
    }
  }
  return proposed;
}

/**
 * Create a measurement-point threshold-approval REQUEST (the existing human-approval
 * queue) → shows in the approval queue for a quality manager. Never applies.
 * Returns true on a created request.
 */
async function requestPointTune(scope: PointTuneScope, rec: PointRecommendation): Promise<boolean> {
  try {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (!db) return false;
    const { thresholdApprovals } = await import("../../drizzle/schema/product");

    const lsl = rec.recommended.lsl;
    const usl = rec.recommended.usl;
    if (!(lsl < usl)) {
      console.warn(`[aiThresholdTuneScheduler] point#${scope.pointDefId} recommended LSL≥USL — skipping`);
      return false;
    }

    await db.insert(thresholdApprovals).values({
      pointDefId: scope.pointDefId,
      // System-generated proposal; requestedBy 0 marks "AI auto-tune" (no human author).
      requestedBy: 0,
      suggestion: {
        source: "ai_threshold_autotune",
        currentCpk: rec.current.cpk,
        projectedCpk: rec.recommended.projectedCpk,
        sampleSize: rec.sampleSize,
        basis: rec.basis,
      } as any,
      currentLsl: rec.current.lsl != null ? (String(rec.current.lsl) as any) : undefined,
      currentUsl: rec.current.usl != null ? (String(rec.current.usl) as any) : undefined,
      currentNominal: rec.current.target != null ? (String(rec.current.target) as any) : undefined,
      proposedLsl: String(lsl) as any,
      proposedUsl: String(usl) as any,
      proposedNominal: String(rec.recommended.target) as any,
      comment: `Auto-tune: Cpk ${rec.current.cpk ?? "?"} → ${rec.recommended.projectedCpk} (${rec.sampleSize} mẫu).`,
      status: "requested",
    });
    return true;
  } catch (err) {
    console.error(
      `[aiThresholdTuneScheduler] requestPointTune point#${scope.pointDefId} failed:`,
      (err as Error)?.message ?? err,
    );
    return false;
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

export interface ThresholdTuneRunStats {
  considered: number;
  proposed: number;
  skipped: number;
  failures: number;
  cappedOut: number;
  ngProposed: number;
  pointRequested: number;
  durationMs: number;
}

let job: cron.ScheduledTask | null = null;
let lastRunAt: Date | null = null;
let lastRunStats: ThresholdTuneRunStats | null = null;

const cfg = (): TuneConfig => ({ minSamples: MIN_SAMPLES, cpkTarget: CPK_TARGET, minDelta: MIN_DELTA });

/**
 * One full pass: enumerate candidate scopes (≥ MIN_SAMPLES recent samples), call
 * the advisor + pure decide for each, cap at MAX_PER_RUN, then create the HITL
 * proposal (NG inbox proposal / point approval request). Fail-safe per scope.
 * Never throws. Safe no-op when the flag is off.
 */
export async function runThresholdTuneNow(): Promise<ThresholdTuneRunStats> {
  const start = Date.now();
  const stats: ThresholdTuneRunStats = {
    considered: 0,
    proposed: 0,
    skipped: 0,
    failures: 0,
    cappedOut: 0,
    ngProposed: 0,
    pointRequested: 0,
    durationMs: 0,
  };

  if (!ENABLED) {
    stats.durationMs = Date.now() - start;
    return stats; // safe no-op
  }

  const now = Date.now();
  const scopes = configuredScopes();

  try {
    // 1) Enumerate candidates + decide which qualify (call advisor per scope).
    const qualifying: Array<
      | { kind: "ng"; scope: NgTuneScope; rec: NgRecommendation; key: string }
      | { kind: "point"; scope: PointTuneScope; rec: PointRecommendation; key: string }
    > = [];

    if (scopes.includes("ng")) {
      let ngScopes: NgTuneScope[] = [];
      try {
        ngScopes = await enumerateNgTuneScopes({ minSamples: MIN_SAMPLES, days: WINDOW_DAYS });
      } catch (err) {
        console.error("[aiThresholdTuneScheduler] enumerate NG scopes failed:", (err as Error)?.message ?? err);
      }
      for (const s of ngScopes) {
        stats.considered++;
        const key = ngScopeKey(s);
        if (isThrottled(key, now)) {
          stats.skipped++;
          continue;
        }
        try {
          const rec = await recommendNgThreshold({ ngThresholdId: s.ngThresholdId, windowDays: WINDOW_DAYS });
          const decision = decideNgTune(rec, cfg());
          if (decision.propose) qualifying.push({ kind: "ng", scope: s, rec, key });
          else stats.skipped++;
        } catch (err) {
          stats.failures++;
          console.error(
            `[aiThresholdTuneScheduler] advisor ng#${s.ngThresholdId} failed:`,
            (err as Error)?.message ?? err,
          );
        }
      }
    }

    if (scopes.includes("point")) {
      let pointScopes: PointTuneScope[] = [];
      try {
        pointScopes = await enumeratePointTuneScopes({ minSamples: MIN_SAMPLES, days: WINDOW_DAYS });
      } catch (err) {
        console.error("[aiThresholdTuneScheduler] enumerate point scopes failed:", (err as Error)?.message ?? err);
      }
      for (const s of pointScopes) {
        stats.considered++;
        const key = pointScopeKey(s);
        if (isThrottled(key, now)) {
          stats.skipped++;
          continue;
        }
        try {
          const rec = await recommendForMeasurementPoint({
            measurementPointId: s.pointDefId,
            productModelId: s.productModelId ?? undefined,
            machineId: s.machineId ?? undefined,
            windowDays: WINDOW_DAYS,
          });
          const decision = decidePointTune(rec, cfg());
          if (decision.propose) qualifying.push({ kind: "point", scope: s, rec, key });
          else stats.skipped++;
        } catch (err) {
          stats.failures++;
          console.error(
            `[aiThresholdTuneScheduler] advisor point#${s.pointDefId} failed:`,
            (err as Error)?.message ?? err,
          );
        }
      }
    }

    // 2) Cap per run (no silent truncation — log the deferred count).
    let toRun = qualifying;
    if (qualifying.length > MAX_PER_RUN) {
      stats.cappedOut = qualifying.length - MAX_PER_RUN;
      toRun = qualifying.slice(0, MAX_PER_RUN);
      console.warn(
        `[aiThresholdTuneScheduler] ${qualifying.length} scopes qualify but cap is ${MAX_PER_RUN} ` +
          `→ deferring ${stats.cappedOut} to next run`,
      );
    }

    // 3) Create the HITL proposal per qualifying scope. Fail-safe per scope.
    for (const q of toRun) {
      try {
        if (q.kind === "ng") {
          const n = await proposeNgTune(q.scope, q.rec);
          if (n > 0) {
            stats.proposed++;
            stats.ngProposed += n;
            markProposed(q.key, now);
            console.log(
              `[aiThresholdTuneScheduler] proposed adjust_ng_threshold for ng#${q.scope.ngThresholdId} ` +
                `to ${n} user(s) (warn=${q.rec.recommended.warning} crit=${q.rec.recommended.critical})`,
            );
          } else {
            stats.skipped++; // qualified but no permitted users / tool unavailable
          }
        } else {
          const ok = await requestPointTune(q.scope, q.rec);
          if (ok) {
            stats.proposed++;
            stats.pointRequested++;
            markProposed(q.key, now);
            console.log(
              `[aiThresholdTuneScheduler] created approval request for point#${q.scope.pointDefId} ` +
                `(Cpk ${q.rec.current.cpk ?? "?"} → ${q.rec.recommended.projectedCpk})`,
            );
          } else {
            stats.skipped++;
          }
        }
      } catch (err) {
        stats.failures++;
        const label = q.kind === "ng" ? `ng#${q.scope.ngThresholdId}` : `point#${q.scope.pointDefId}`;
        console.error(`[aiThresholdTuneScheduler] propose ${label} failed:`, (err as Error)?.message ?? err);
      }
    }
  } catch (err) {
    // Top-level guard: the run itself must never throw.
    console.error("[aiThresholdTuneScheduler] run error:", (err as Error)?.message ?? err);
  }

  stats.durationMs = Date.now() - start;
  lastRunAt = new Date();
  lastRunStats = stats;
  console.log(
    `[aiThresholdTuneScheduler] done in ${stats.durationMs}ms — considered=${stats.considered} ` +
      `proposed=${stats.proposed} (ng=${stats.ngProposed} point=${stats.pointRequested}) ` +
      `skipped=${stats.skipped} failures=${stats.failures} cappedOut=${stats.cappedOut}`,
  );
  return stats;
}

// ─── Scheduler lifecycle (mirror the other schedulers) ────────────────────────

/** Register the cron job. No-op when AI_THRESHOLD_AUTOTUNE_ENABLED is not "true". */
export function startThresholdTuneScheduler(): void {
  if (!ENABLED) {
    console.log("[aiThresholdTuneScheduler] disabled (set AI_THRESHOLD_AUTOTUNE_ENABLED=true to enable)");
    return;
  }
  if (job) return; // already started
  job = cron.schedule(
    CRON,
    () => {
      runThresholdTuneNow().catch((e) => console.error("[aiThresholdTuneScheduler] cron error:", e));
    },
    { timezone: TZ },
  );
  console.log(`[aiThresholdTuneScheduler] scheduled '${CRON}' (${TZ}) scope=${configuredScopes().join("+")}`);
}

/** Stop the cron job (shutdown). Safe to call when not started. */
export function stopThresholdTuneScheduler(): void {
  if (job) {
    job.stop();
    job = null;
    console.log("[aiThresholdTuneScheduler] stopped");
  }
}

/** Status for dashboards / health. */
export function getThresholdTuneSchedulerStatus() {
  return {
    enabled: ENABLED,
    cron: CRON,
    timezone: TZ,
    scope: configuredScopes(),
    minSamples: MIN_SAMPLES,
    cpkTarget: CPK_TARGET,
    minDelta: MIN_DELTA,
    maxPerRun: MAX_PER_RUN,
    throttleMs: THROTTLE_MS,
    windowDays: WINDOW_DAYS,
    running: !!job,
    lastRunAt,
    lastRunStats,
  };
}
