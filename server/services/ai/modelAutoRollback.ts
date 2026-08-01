/**
 * I2-b (doc 16 §9 Khối 4 / doc 18 §6) — MODEL AUTO-ROLLBACK.
 * Flag: AI_MODEL_AUTOROLLBACK_ENABLED (default OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A drift/quality monitor for the ACTIVE model version. When live accuracy/confidence
 * drops below a threshold vs the version's EVAL BASELINE (or a drift score fires), it
 * AUTOMATICALLY rolls back to the previous stable version — flipping model_versions.
 * status via the SAME aiModelService.activateModelVersion the manual path uses (NO
 * model-registry fork) — records an append-only model_rollback_events row, and emits
 * an alert.
 *
 * FLAG DISCIPLINE: when off, behaviour is exactly today's (manual activation only);
 * the sweep is a NO-OP. The decision core evaluateRollback() is PURE (unit-testable).
 *
 * ⚠ HONEST SEAM: "live accuracy" needs a FEEDBACK SIGNAL (labels/confidence from
 * production inferences). We read it from model_performance_snapshots when present
 * (accuracy / driftScore / avg confidence). With NO snapshot the monitor has no live
 * signal → it does NOTHING (never fabricates a live metric to justify a rollback).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { getDb } from "../../db/connection";
import { and, desc, eq } from "drizzle-orm";
import {
  modelVersions,
  modelPerformanceSnapshots,
  modelRollbackEvents,
  type ModelVersion,
  type InsertModelRollbackEvent,
} from "../../../drizzle/schema";
import { activateModelVersion } from "../aiModelService";

export function isModelAutoRollbackEnabled(): boolean {
  return process.env.AI_MODEL_AUTOROLLBACK_ENABLED === "true";
}

/** Max tolerated accuracy drop (fraction, 0..1) vs baseline before rollback. */
function accuracyDropThreshold(): number {
  const n = Number(process.env.AI_MODEL_AUTOROLLBACK_ACC_DROP);
  return Number.isFinite(n) && n > 0 ? n : 0.05; // 5 pts default
}
/** Drift score at/above which a rollback fires regardless of accuracy. */
function driftThreshold(): number {
  const n = Number(process.env.AI_MODEL_AUTOROLLBACK_DRIFT);
  return Number.isFinite(n) && n > 0 ? n : 0.25;
}

export type RollbackTrigger = "auto_drift" | "auto_accuracy" | "manual";

export interface LiveSignal {
  /** Observed live accuracy (0..1), or null when there is no feedback signal. */
  liveAccuracy: number | null;
  /** Observed drift score (0..1), or null when not measured. */
  driftScore: number | null;
}

export interface RollbackDecision {
  shouldRollback: boolean;
  trigger: RollbackTrigger | null;
  reason: string;
  accuracyDelta: number | null;
  driftScore: number | null;
}

// ─── Pure decision core ────────────────────────────────────────────────────────

/**
 * Decide whether the ACTIVE version should be rolled back given its eval baseline
 * accuracy + a live signal. PURE — no I/O.
 *
 *  - No baseline OR no live signal → NO rollback (honest: nothing to compare).
 *  - drift ≥ driftThreshold                              → rollback (auto_drift).
 *  - liveAccuracy < baseline - accDropThreshold          → rollback (auto_accuracy).
 *  - otherwise healthy                                    → no rollback.
 */
export function evaluateRollback(
  baselineAccuracy: number | null,
  live: LiveSignal,
  opts?: { accDrop?: number; drift?: number },
): RollbackDecision {
  const accDrop = opts?.accDrop ?? accuracyDropThreshold();
  const drift = opts?.drift ?? driftThreshold();

  const driftScore = live.driftScore;
  if (driftScore != null && driftScore >= drift) {
    return {
      shouldRollback: true,
      trigger: "auto_drift",
      reason: `Drift score ${driftScore.toFixed(4)} ≥ threshold ${drift} — data/prediction distribution shifted.`,
      accuracyDelta: baselineAccuracy != null && live.liveAccuracy != null
        ? Number((live.liveAccuracy - baselineAccuracy).toFixed(4))
        : null,
      driftScore,
    };
  }

  if (baselineAccuracy == null || live.liveAccuracy == null) {
    return {
      shouldRollback: false,
      trigger: null,
      reason: baselineAccuracy == null
        ? "No eval baseline for the active version — cannot judge regression."
        : "No live accuracy signal (no feedback) — nothing to compare.",
      accuracyDelta: null,
      driftScore,
    };
  }

  const delta = Number((live.liveAccuracy - baselineAccuracy).toFixed(4));
  if (live.liveAccuracy < baselineAccuracy - accDrop) {
    return {
      shouldRollback: true,
      trigger: "auto_accuracy",
      reason: `Live accuracy ${live.liveAccuracy.toFixed(4)} dropped ${(baselineAccuracy - live.liveAccuracy).toFixed(4)} below baseline ${baselineAccuracy.toFixed(4)} (> ${accDrop}).`,
      accuracyDelta: delta,
      driftScore,
    };
  }

  return {
    shouldRollback: false,
    trigger: null,
    reason: `Healthy: live accuracy ${live.liveAccuracy.toFixed(4)} within ${accDrop} of baseline ${baselineAccuracy.toFixed(4)}.`,
    accuracyDelta: delta,
    driftScore,
  };
}

// ─── Helpers to read the baseline + live signal from the registry ──────────────

/** Extract a version's eval baseline accuracy (0..1) from metrics/evalReport/accuracy. */
export function baselineAccuracyOf(v: ModelVersion | null | undefined): number | null {
  if (!v) return null;
  const m = v.metrics as Record<string, unknown> | null | undefined;
  if (m && typeof m.accuracy === "number" && Number.isFinite(m.accuracy)) return m.accuracy;
  const report = v.evalReport as Record<string, unknown> | null | undefined;
  const cand = (report?.candidate as Record<string, unknown> | undefined)?.accuracy;
  if (typeof cand === "number" && Number.isFinite(cand)) return cand;
  // model_versions.accuracy is stored as a 0..100 percentage string.
  if (v.accuracy != null) {
    const pct = Number(v.accuracy);
    if (Number.isFinite(pct)) return pct / 100;
  }
  return null;
}

/**
 * The previous STABLE version to roll back to: the most-recent non-active version
 * whose status is ACTIVE/INACTIVE/READY (i.e. it was validated before) and that has
 * an eval baseline. Returns null when none exists (then rollback is impossible).
 */
export function pickRollbackTarget(versions: ModelVersion[], activeVersionId: number): ModelVersion | null {
  const candidates = versions
    .filter((v) => v.id !== activeVersionId)
    .filter((v) => v.status === "INACTIVE" || v.status === "READY" || v.status === "ACTIVE")
    .filter((v) => baselineAccuracyOf(v) != null)
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  return candidates[0] ?? null;
}

// ─── Runtime: read live signal + roll back ─────────────────────────────────────

/** Read the newest performance snapshot for a model version → a LiveSignal. */
async function readLiveSignal(modelId: number, version: string | null): Promise<LiveSignal> {
  const db = await getDb();
  if (!db) return { liveAccuracy: null, driftScore: null };
  const cond = version
    ? and(eq(modelPerformanceSnapshots.modelId, modelId), eq(modelPerformanceSnapshots.modelVersion, version))
    : eq(modelPerformanceSnapshots.modelId, modelId);
  const [snap] = await db
    .select()
    .from(modelPerformanceSnapshots)
    .where(cond)
    .orderBy(desc(modelPerformanceSnapshots.periodEnd))
    .limit(1);
  if (!snap) return { liveAccuracy: null, driftScore: null };
  return {
    liveAccuracy: snap.accuracy != null ? Number(snap.accuracy) : null,
    driftScore: snap.driftScore != null ? Number(snap.driftScore) : null,
  };
}

export interface RollbackOutcome {
  rolledBack: boolean;
  modelId: number;
  reason: string;
  fromVersionId?: number;
  toVersionId?: number;
  eventId?: number;
}

/**
 * Evaluate + (if warranted) roll back ONE model. NO-OP → {rolledBack:false} when the
 * flag is off, there's no active version, no rollback target, or the model is healthy.
 */
export async function runRollbackForModel(modelId: number): Promise<RollbackOutcome> {
  if (!isModelAutoRollbackEnabled()) return { rolledBack: false, modelId, reason: "flag off" };
  const db = await getDb();
  if (!db) return { rolledBack: false, modelId, reason: "no db" };

  const versions = await db
    .select()
    .from(modelVersions)
    .where(eq(modelVersions.modelId, modelId))
    .orderBy(desc(modelVersions.createdAt));

  const active = versions.find((v) => v.status === "ACTIVE");
  if (!active) return { rolledBack: false, modelId, reason: "no active version" };

  const baseline = baselineAccuracyOf(active);
  const live = await readLiveSignal(modelId, active.version);
  const decision = evaluateRollback(baseline, live);
  if (!decision.shouldRollback) return { rolledBack: false, modelId, reason: decision.reason };

  const target = pickRollbackTarget(versions, active.id);
  if (!target) return { rolledBack: false, modelId, reason: "no stable rollback target available" };

  // Flip status via the SAME manual activation path (no fork). This marks the target
  // ACTIVE, the previous ACTIVE INACTIVE, and updates aiModels.currentVersion.
  await activateModelVersion(modelId, target.id);

  // Record the append-only rollback event.
  const eventRow: InsertModelRollbackEvent = {
    modelId,
    fromVersionId: active.id,
    toVersionId: target.id,
    fromVersion: active.version,
    toVersion: target.version,
    trigger: decision.trigger ?? "auto_accuracy",
    reason: decision.reason,
    metrics: {
      baselineAccuracy: baseline,
      liveAccuracy: live.liveAccuracy,
      driftScore: live.driftScore,
      accuracyDelta: decision.accuracyDelta,
    },
    triggeredBy: null,
  };
  const [event] = await db.insert(modelRollbackEvents).values(eventRow).returning({ id: modelRollbackEvents.id });

  // Emit an alert (best-effort — reuse the smart-alert router).
  try {
    const { routeAlert } = await import("../aiSmartAlertRouter");
    await routeAlert({
      type: "QUALITY_DEGRADATION",
      severity: decision.trigger === "auto_drift" ? "HIGH" : "MEDIUM",
      message: `Model ${modelId} auto-rolled back ${active.version} → ${target.version}. ${decision.reason}`,
      data: { modelId, fromVersion: active.version, toVersion: target.version, trigger: decision.trigger },
    });
  } catch (err) {
    console.error(`[modelAutoRollback] routeAlert failed for model ${modelId}:`, (err as Error)?.message ?? err);
  }

  return {
    rolledBack: true,
    modelId,
    reason: decision.reason,
    fromVersionId: active.id,
    toVersionId: target.id,
    eventId: event?.id,
  };
}

/**
 * Manual rollback (operator-triggered). Flips to `toVersionId` and records a
 * `manual` event. Flag-gated only for the AUTOMATIC sweep — a human with the perm
 * may roll back regardless of the flag (mirrors manual activation).
 */
export async function manualRollback(
  modelId: number,
  toVersionId: number,
  triggeredBy: number,
  reason = "Manual rollback",
): Promise<RollbackOutcome> {
  const db = await getDb();
  if (!db) return { rolledBack: false, modelId, reason: "no db" };

  const versions = await db.select().from(modelVersions).where(eq(modelVersions.modelId, modelId));
  const active = versions.find((v) => v.status === "ACTIVE");
  const target = versions.find((v) => v.id === toVersionId);
  if (!target) return { rolledBack: false, modelId, reason: `version ${toVersionId} not found for model ${modelId}` };

  await activateModelVersion(modelId, toVersionId);

  const [event] = await db
    .insert(modelRollbackEvents)
    .values({
      modelId,
      fromVersionId: active?.id ?? null,
      toVersionId,
      fromVersion: active?.version ?? null,
      toVersion: target.version,
      trigger: "manual",
      reason,
      metrics: { baselineAccuracy: baselineAccuracyOf(active), targetAccuracy: baselineAccuracyOf(target) },
      triggeredBy,
    } satisfies InsertModelRollbackEvent)
    .returning({ id: modelRollbackEvents.id });

  return { rolledBack: true, modelId, reason, fromVersionId: active?.id, toVersionId, eventId: event?.id };
}

/**
 * Sweep every model that has an ACTIVE version and evaluate rollback. NO-OP when the
 * flag is off. Returns the count of rollbacks performed.
 */
export async function runRollbackSweep(): Promise<{ enabled: boolean; checked: number; rolledBack: number }> {
  if (!isModelAutoRollbackEnabled()) return { enabled: false, checked: 0, rolledBack: 0 };
  const db = await getDb();
  if (!db) return { enabled: true, checked: 0, rolledBack: 0 };

  const activeVersions = await db
    .select({ modelId: modelVersions.modelId })
    .from(modelVersions)
    .where(eq(modelVersions.status, "ACTIVE"));
  const modelIds = Array.from(new Set(activeVersions.map((v) => v.modelId)));

  let rolledBack = 0;
  for (const modelId of modelIds) {
    try {
      const outcome = await runRollbackForModel(modelId);
      if (outcome.rolledBack) rolledBack++;
    } catch (err) {
      console.error(`[modelAutoRollback] sweep failed for model ${modelId}:`, (err as Error)?.message ?? err);
    }
  }
  return { enabled: true, checked: modelIds.length, rolledBack };
}

/**
 * Start the flag-gated auto-rollback sweep timer. Unref'd + non-overlapping, mirrors
 * the fleet charging sweep in _core/index.ts. NO-OP when the flag is off.
 */
let sweepTimer: NodeJS.Timeout | null = null;
export function startModelAutoRollbackSweep(): void {
  if (sweepTimer) return;
  if (!isModelAutoRollbackEnabled()) {
    console.log("[modelAutoRollback] disabled (set AI_MODEL_AUTOROLLBACK_ENABLED=true to enable)");
    return;
  }
  const intervalMs = Math.max(60_000, Number(process.env.AI_MODEL_AUTOROLLBACK_SWEEP_MS ?? 600_000));
  let running = false;
  sweepTimer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await runRollbackSweep();
      if (r.rolledBack > 0) console.log(`[modelAutoRollback] sweep: ${r.rolledBack}/${r.checked} model(s) rolled back`);
    } catch (err) {
      console.error("[modelAutoRollback] sweep error:", (err as Error)?.message ?? err);
    } finally {
      running = false;
    }
  }, intervalMs);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
  console.log(`[modelAutoRollback] sweep started (every ${intervalMs}ms)`);
}

export function stopModelAutoRollbackSweep(): void {
  if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
}
