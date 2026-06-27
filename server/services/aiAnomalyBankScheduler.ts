/**
 * Anomaly Bank Auto-Rebuild Scheduler — auto-rebuilds PatchCore anomaly memory
 * banks per scope (machine, optionally product) when enough NEW OK samples have
 * accumulated in ai_image_embeddings.
 *
 * Why: buildBankFromStoredEmbeddings() builds a bank from stored OK DINOv2 vectors,
 * but until now had to be triggered by hand (router). A scope's OK pool grows over
 * time (embed-at-ingest), so the bank/threshold should be refreshed periodically —
 * without churning every scope on every run. This scheduler decides, per scope,
 * whether a rebuild is worthwhile and caps the work per run.
 *
 * Additive, flag-gated (default OFF → safe no-op), fail-safe (a bad scope logs and
 * never aborts the run; a scheduler error never crashes boot). Mirrors
 * aiSelfLearningScheduler / reportScheduler (node-cron registration + start/stop).
 *
 * Env flags:
 *   ANOMALY_BANK_AUTO_REBUILD_ENABLED  (default "false" — master switch, safe no-op when off)
 *   ANOMALY_BANK_REBUILD_CRON          (default "0 3 * * *" — 03:00 daily)
 *   ANOMALY_BANK_TZ                    (default "Asia/Ho_Chi_Minh")
 *   ANOMALY_BANK_MIN_OK                (default 30 — min OK samples to build a NON-bootstrap bank)
 *   ANOMALY_BANK_REBUILD_DELTA         (default 20 — min NEW OK samples since last build to rebuild)
 *   ANOMALY_BANK_SCOPE                 (default "machine" — "machine" | "product" | "both")
 *   ANOMALY_BANK_MAX_SCOPES_PER_RUN    (default 25 — safety cap; skipped count is logged)
 *   ANOMALY_BANK_MODEL_CODE            (default "dinov2-small" — embedding modelCode in ai_image_embeddings)
 *   ANOMALY_BANK_BACKFILL              (default "true" — after a rebuild, backfill recent scores for the scope)
 *   ANOMALY_BANK_BACKFILL_LIMIT        (default 5000 — bound on backfilled rows per scope)
 */

import * as cron from "node-cron";
import {
  enumerateOkScopes,
  getProfileSnapshot,
  type AnomalyScopeKind,
  type OkScopeCount,
  type AnomalyScope,
  type ProfileSnapshot,
} from "../db/aiAnomaly";
import {
  buildBankFromStoredEmbeddings,
  backfillAnomalyScores,
} from "./aiAnomalyDetection";

// ─── Config (env, safe defaults) ──────────────────────────────────────────────

const ENABLED = String(process.env.ANOMALY_BANK_AUTO_REBUILD_ENABLED ?? "false").toLowerCase() === "true";
const CRON = process.env.ANOMALY_BANK_REBUILD_CRON || "0 3 * * *";
const TZ = process.env.ANOMALY_BANK_TZ || "Asia/Ho_Chi_Minh";
const MIN_OK = Math.max(1, Number(process.env.ANOMALY_BANK_MIN_OK ?? 30));
const REBUILD_DELTA = Math.max(1, Number(process.env.ANOMALY_BANK_REBUILD_DELTA ?? 20));
const MAX_SCOPES_PER_RUN = Math.max(1, Number(process.env.ANOMALY_BANK_MAX_SCOPES_PER_RUN ?? 25));
const MODEL_CODE = process.env.ANOMALY_BANK_MODEL_CODE || "dinov2-small";
const BACKFILL = String(process.env.ANOMALY_BANK_BACKFILL ?? "true").toLowerCase() === "true";
const BACKFILL_LIMIT = Math.max(1, Number(process.env.ANOMALY_BANK_BACKFILL_LIMIT ?? 5000));

function configuredScopeKinds(): AnomalyScopeKind[] {
  const raw = (process.env.ANOMALY_BANK_SCOPE || "machine").trim().toLowerCase();
  if (raw === "both") return ["machine", "product"];
  if (raw === "product") return ["product"];
  return ["machine"];
}

// ─── Rebuild-decision (pure, exported for tests) ──────────────────────────────

export interface RebuildDecisionInput {
  /** Current OK-sample count for the scope (≥ MIN_OK by construction of the candidate list). */
  okCount: number;
  /** Existing profile snapshot, or null when no bank/profile exists yet. */
  profile: ProfileSnapshot | null;
  minOk: number;
  rebuildDelta: number;
}

export interface RebuildDecision {
  rebuild: boolean;
  /** Machine-readable reason for the per-run summary / logs. */
  reason: "no_profile" | "bootstrap_now_enough" | "delta_exceeded" | "no_change";
}

/**
 * Decide whether a scope should be rebuilt. Rebuild when:
 *   1. No bank/profile exists yet                                  → "no_profile".
 *   2. Profile is bootstrap-flagged AND now ≥ minOk OK samples     → "bootstrap_now_enough".
 *   3. OK count grew by ≥ rebuildDelta since the last build's      → "delta_exceeded".
 *      recorded sample count (profile.bankSize proxy).
 * Otherwise skip (avoid churn)                                     → "no_change".
 *
 * Pure: no I/O, no env reads. Drives both the scheduler and the unit tests.
 */
export function decideRebuild(input: RebuildDecisionInput): RebuildDecision {
  const { okCount, profile, minOk, rebuildDelta } = input;

  if (!profile) {
    return { rebuild: true, reason: "no_profile" };
  }

  // Bootstrap bank that now has enough OK samples → upgrade to a real bank.
  if (profile.bootstrap && okCount >= minOk) {
    return { rebuild: true, reason: "bootstrap_now_enough" };
  }

  // Enough NEW OK samples since the last build (bankSize is the coreset of the
  // pool used last time; growth past it by ≥ delta justifies a refresh).
  if (okCount - profile.bankSize >= rebuildDelta) {
    return { rebuild: true, reason: "delta_exceeded" };
  }

  return { rebuild: false, reason: "no_change" };
}

// ─── Run ──────────────────────────────────────────────────────────────────────

export interface AnomalyBankRunStats {
  considered: number;
  rebuilt: number;
  skipped: number;
  bootstrap: number;
  failures: number;
  cappedOut: number;
  durationMs: number;
}

let job: cron.ScheduledTask | null = null;
let lastRunAt: Date | null = null;
let lastRunStats: AnomalyBankRunStats | null = null;

/** Bank scope key matches buildBankFromStoredEmbeddings: "anomaly:onnx:<modelCode>". */
function bankScopeFor(s: OkScopeCount): AnomalyScope {
  return {
    productModelId: s.productModelId,
    machineId: s.machineId,
    modelCode: `anomaly:onnx:${MODEL_CODE}`,
  };
}

function scopeLabel(s: OkScopeCount): string {
  return s.kind === "machine" ? `machine#${s.machineId}` : `product#${s.productModelId}`;
}

/**
 * One full pass: enumerate candidate scopes (≥ MIN_OK OK embeddings), decide which
 * to rebuild, cap at MAX_SCOPES_PER_RUN, then rebuild + (optionally) backfill each.
 * Fail-safe per scope. Never throws.
 */
export async function runAnomalyBankRebuildNow(): Promise<AnomalyBankRunStats> {
  const start = Date.now();
  const stats: AnomalyBankRunStats = {
    considered: 0,
    rebuilt: 0,
    skipped: 0,
    bootstrap: 0,
    failures: 0,
    cappedOut: 0,
    durationMs: 0,
  };

  try {
    // 1) Enumerate candidate scopes across configured kinds.
    const candidates: OkScopeCount[] = [];
    for (const kind of configuredScopeKinds()) {
      try {
        const scopes = await enumerateOkScopes({ kind, modelCode: MODEL_CODE, minOk: MIN_OK });
        candidates.push(...scopes);
      } catch (err) {
        console.error(`[anomalyBankScheduler] enumerate ${kind} scopes failed:`, (err as any)?.message || err);
      }
    }
    stats.considered = candidates.length;

    // 2) Decide which qualify (read each profile snapshot).
    const qualifying: Array<{ scope: OkScopeCount; reason: RebuildDecision["reason"] }> = [];
    for (const cand of candidates) {
      let profile: ProfileSnapshot | null = null;
      try {
        profile = await getProfileSnapshot(bankScopeFor(cand));
      } catch (err) {
        // Treat an unreadable profile as "no profile" → rebuild (fail-safe toward refresh).
        console.warn(`[anomalyBankScheduler] profile read failed for ${scopeLabel(cand)}:`, (err as any)?.message || err);
      }
      const decision = decideRebuild({
        okCount: cand.okCount,
        profile,
        minOk: MIN_OK,
        rebuildDelta: REBUILD_DELTA,
      });
      if (decision.rebuild) {
        qualifying.push({ scope: cand, reason: decision.reason });
      } else {
        stats.skipped++;
      }
    }

    // 3) Cap per run (no silent truncation — log the skipped count).
    let toRun = qualifying;
    if (qualifying.length > MAX_SCOPES_PER_RUN) {
      stats.cappedOut = qualifying.length - MAX_SCOPES_PER_RUN;
      toRun = qualifying.slice(0, MAX_SCOPES_PER_RUN);
      console.warn(
        `[anomalyBankScheduler] ${qualifying.length} scopes qualify but cap is ${MAX_SCOPES_PER_RUN} ` +
        `→ deferring ${stats.cappedOut} to next run`,
      );
    }

    // 4) Rebuild (+ optional backfill) each qualifying scope. Fail-safe per scope.
    for (const { scope, reason } of toRun) {
      try {
        const res = await buildBankFromStoredEmbeddings({
          machineId: scope.machineId ?? undefined,
          productModelId: scope.productModelId ?? undefined,
          modelCode: MODEL_CODE,
          okOnly: true,
        });
        stats.rebuilt++;
        if (res.bootstrap) stats.bootstrap++;
        console.log(
          `[anomalyBankScheduler] rebuilt ${scopeLabel(scope)} (${reason}): ` +
          `bankSize=${res.bankSize} stored=${res.storedCount}${res.bootstrap ? " [BOOTSTRAP]" : ""}`,
        );

        if (BACKFILL) {
          try {
            const bf = await backfillAnomalyScores({
              machineId: scope.machineId ?? undefined,
              productModelId: scope.productModelId ?? undefined,
              modelCode: MODEL_CODE,
              limit: BACKFILL_LIMIT,
            });
            console.log(
              `[anomalyBankScheduler] backfilled ${scopeLabel(scope)}: ` +
              `scored=${bf.scored} anomalies=${bf.flaggedAnomaly} failures=${bf.failures}`,
            );
          } catch (err) {
            console.error(`[anomalyBankScheduler] backfill ${scopeLabel(scope)} failed:`, (err as any)?.message || err);
          }
        }
      } catch (err) {
        stats.failures++;
        console.error(`[anomalyBankScheduler] rebuild ${scopeLabel(scope)} failed:`, (err as any)?.message || err);
      }
    }
  } catch (err) {
    // Top-level guard: the run itself must never throw.
    console.error("[anomalyBankScheduler] run error:", (err as any)?.message || err);
  }

  stats.durationMs = Date.now() - start;
  lastRunAt = new Date();
  lastRunStats = stats;
  console.log(
    `[anomalyBankScheduler] done in ${stats.durationMs}ms — considered=${stats.considered} ` +
    `rebuilt=${stats.rebuilt} skipped=${stats.skipped} bootstrap=${stats.bootstrap} ` +
    `failures=${stats.failures} cappedOut=${stats.cappedOut}`,
  );
  return stats;
}

// ─── Scheduler lifecycle (mirror the other schedulers) ────────────────────────

/** Register the cron job. No-op when ANOMALY_BANK_AUTO_REBUILD_ENABLED is not "true". */
export function startAnomalyBankScheduler(): void {
  if (!ENABLED) {
    console.log("[anomalyBankScheduler] disabled (set ANOMALY_BANK_AUTO_REBUILD_ENABLED=true to enable)");
    return;
  }
  if (job) return; // already started
  job = cron.schedule(
    CRON,
    () => {
      runAnomalyBankRebuildNow().catch((e) => console.error("[anomalyBankScheduler] cron error:", e));
    },
    { timezone: TZ },
  );
  console.log(`[anomalyBankScheduler] scheduled '${CRON}' (${TZ}) scope=${configuredScopeKinds().join("+")}`);
}

/** Stop the cron job (shutdown). Safe to call when not started. */
export function stopAnomalyBankScheduler(): void {
  if (job) {
    job.stop();
    job = null;
    console.log("[anomalyBankScheduler] stopped");
  }
}

/** Status for dashboards / health. */
export function getAnomalyBankSchedulerStatus() {
  return {
    enabled: ENABLED,
    cron: CRON,
    timezone: TZ,
    scope: configuredScopeKinds(),
    minOk: MIN_OK,
    rebuildDelta: REBUILD_DELTA,
    maxScopesPerRun: MAX_SCOPES_PER_RUN,
    modelCode: MODEL_CODE,
    backfill: BACKFILL,
    running: !!job,
    lastRunAt,
    lastRunStats,
  };
}
