/**
 * AI Self-Learning Scheduler — WS-1 (+ B5.2 / doc 69 Wave 6 F2)
 *
 * Periodically (a) sweeps inference results for uncertain images and enqueues
 * them for labeling, (b) checks the auto-retrain trigger for active models, and
 * (c) escalates a HIGH/CRITICAL drift signal + a satisfied auto-retrain trigger
 * into a PROPOSED (HITL) retrain job — never auto-started, never auto-activated.
 * All passes are IDEMPOTENT-ish and offline. Disabled by default; opt in via env.
 *
 * DELIBERATELY NOT DONE (review remediation, doc 69 F2): an earlier revision of
 * this file also registered a scheduled sweep that called
 * aiMonitoring.collectPerformanceSnapshot (which internally runs
 * aiMonitoring.detectDrift and persists a driftScore onto
 * model_performance_snapshots). That was removed because it would have been the
 * FIRST-EVER writer of driftScore — which makes
 * `server/services/ai/modelAutoRollback.ts`'s `auto_drift` branch reachable: that
 * branch calls activateModelVersion AUTOMATICALLY, with NO human step, whenever
 * driftScore >= AI_MODEL_AUTOROLLBACK_DRIFT (default 0.25). Silently arming a
 * no-HITL auto-rollback path is directly against this task's HITL intent, and is
 * a decision that must be made deliberately (with rollback-safety review), not as
 * a side effect of adding a snapshot sweep. It would also have DUPLICATED the
 * pre-existing, already-scheduled `server/services/ai/modelPerfSnapshotProducer.ts`
 * (own flag AI_MODEL_PERF_SNAPSHOTS_ENABLED), which already writes
 * model_performance_snapshots with REAL accuracy from ai_feedback — two
 * independent writers of the same table would race for "latest row".
 * Performance snapshots are satisfied by that pre-existing producer; the
 * drift→retrain escalation below reads drift DIRECTLY from aiDriftMonitor
 * (checkConfidenceDrift / checkConceptDriftKS), never from driftScore.
 *
 * Env flags:
 *   AI_SELF_LEARNING_ENABLED       (default "false")
 *   AI_SELF_LEARNING_CRON          (default "0 3 * * *" — 03:00 daily)
 *   AI_SELF_LEARNING_TZ            (default "Asia/Ho_Chi_Minh")
 *   AI_SELF_LEARNING_UNCERTAINTY   (default "0.5")
 *   AI_SELF_LEARNING_SINCE_HOURS   (default "24")
 *   AI_SELF_LEARNING_MAX_ITEMS     (default "200")
 *   AI_SELF_LEARNING_AUTORETRAIN   (default "false" — legacy: only flags/logs, never proposes/trains)
 */

import * as cron from "node-cron";
import { getDb } from "../db/connection";
import { aiModels } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { scanInferenceForUncertainty } from "./aiActiveLearningAuto";
import { checkAutoRetrainTrigger, proposeRetrainJob } from "./aiTrainingPipeline";
import { checkConfidenceDrift, checkConceptDriftKS, isDriftMonitorEnabled } from "./aiDriftMonitor";

const ENABLED = String(process.env.AI_SELF_LEARNING_ENABLED ?? "false").toLowerCase() === "true";
const CRON = process.env.AI_SELF_LEARNING_CRON || "0 3 * * *";
const TZ = process.env.AI_SELF_LEARNING_TZ || "Asia/Ho_Chi_Minh";
const UNCERTAINTY = Number(process.env.AI_SELF_LEARNING_UNCERTAINTY || "0.5");
const SINCE_HOURS = Number(process.env.AI_SELF_LEARNING_SINCE_HOURS || "24");
const MAX_ITEMS = Number(process.env.AI_SELF_LEARNING_MAX_ITEMS || "200");
const AUTORETRAIN = String(process.env.AI_SELF_LEARNING_AUTORETRAIN ?? "false").toLowerCase() === "true";

let job: cron.ScheduledTask | null = null;
let lastRunAt: Date | null = null;
let lastRunStats: { models: number; enqueued: number; retrainFlagged: number; retrainProposed: number; driftFlagged: number; durationMs: number } | null = null;

export async function runSelfLearningScanOnce() {
  const start = Date.now();
  const db = await getDb();
  if (!db) {
    console.warn("[aiSelfLearningScheduler] db unavailable, skipping");
    return { models: 0, enqueued: 0, retrainFlagged: 0, retrainProposed: 0, driftFlagged: 0, durationMs: 0 };
  }

  const models = await db.select({ id: aiModels.id }).from(aiModels).where(eq(aiModels.status, "ACTIVE"));
  const since = new Date(Date.now() - SINCE_HOURS * 3600_000);

  let enqueued = 0;
  let retrainFlagged = 0;
  let retrainProposed = 0;
  let driftFlagged = 0;

  for (const m of models) {
    try {
      const res = await scanInferenceForUncertainty({
        modelId: m.id,
        uncertaintyThreshold: UNCERTAINTY,
        since,
        maxItems: MAX_ITEMS,
      });
      enqueued += res.enqueued;

      // B5.2 — advisory drift checks. Self-gating: a safe no-op unless
      // AI_DRIFT_MONITOR_ENABLED is on. Each check only emits a
      // model_drift_alerts row on drift — NEVER swaps/retrains a model on its
      // own. `escalate` tracks whether EITHER signal is HIGH/CRITICAL, for the
      // drift→retrain escalation below.
      let escalate = false;
      let escalateSeverity = "HIGH";
      let escalateSource: "confidence-psi" | "concept-drift-ks" = "confidence-psi";

      if (isDriftMonitorEnabled()) {
        const drift = await checkConfidenceDrift({ modelId: m.id });
        if (drift.drift) {
          driftFlagged++;
          escalate = true;
          escalateSeverity = drift.severity;
          escalateSource = "confidence-psi";
          console.log(`[aiSelfLearningScheduler] model ${m.id} confidence drift (${drift.severity}): ${drift.reasons.join("; ")}`);
        }

        // G4.28 concept-drift (KS) — a second, independent drift signal (no
        // graduated severity of its own; aiDriftMonitor persists it as HIGH).
        const concept = await checkConceptDriftKS({ modelId: m.id });
        if (concept.drift) {
          driftFlagged++;
          if (!escalate) {
            escalate = true;
            escalateSeverity = "HIGH";
            escalateSource = "concept-drift-ks";
          }
          console.log(`[aiSelfLearningScheduler] model ${m.id} concept drift (KS): ${concept.reasons.join("; ")}`);
        }
      }

      // Auto-retrain trigger is checked at most ONCE per model per scan (shared
      // by both the legacy flag-only path and the new HITL escalation below).
      let triggerResult: Awaited<ReturnType<typeof checkAutoRetrainTrigger>> | null = null;
      const getTrigger = async () => {
        if (!triggerResult) triggerResult = await checkAutoRetrainTrigger(m.id);
        return triggerResult;
      };

      // B5.2 F2 (doc 69 Wave 6) — drift → retrain escalation (HITL). When a
      // HIGH/CRITICAL drift signal coincides with a satisfied auto-retrain
      // trigger, PROPOSE a retrain job for human review — NEVER start training,
      // NEVER activate a model (proposeRetrainJob only inserts a QUEUED row; the
      // eval-gate + promote-gate still apply whenever a human later runs it).
      // Gated on THIS scheduler's own flag (AI_SELF_LEARNING_ENABLED) so a
      // flag-off scan never proposes, even with drift monitoring enabled.
      if (ENABLED && escalate) {
        const trigger = await getTrigger();
        if (trigger.shouldRetrain) {
          // proposeRetrainJob itself de-dups: returns null (no insert) when an
          // un-actioned drift-retrain proposal already exists for this model, so
          // a still-qualifying model doesn't spam a new [PROPOSED] job every scan.
          const proposed = await proposeRetrainJob({
            modelId: m.id,
            reason: trigger.reason ?? "auto-retrain trigger satisfied",
            driftSeverity: escalateSeverity,
            driftSource: escalateSource,
            feedbackCount: trigger.feedbackCount,
            labeledCount: trigger.labeledCount,
          });
          if (proposed) {
            retrainProposed++;
            console.log(
              `[aiSelfLearningScheduler] model ${m.id} → PROPOSED retrain job #${(proposed as any)?.id} ` +
                `(drift ${escalateSeverity}/${escalateSource}; ${trigger.reason}) — awaiting human approval`,
            );
          } else {
            console.log(
              `[aiSelfLearningScheduler] model ${m.id} drift-retrain trigger satisfied but an un-actioned ` +
                `proposal already exists — skipping duplicate`,
            );
          }
        }
      }

      if (AUTORETRAIN) {
        const trigger = await getTrigger();
        if (trigger.shouldRetrain) {
          retrainFlagged++;
          // Intentionally do NOT auto-start training here (needs class labels +
          // dataset + a human go). Flag only; surfaced via autoRetrainCheck API.
          console.log(`[aiSelfLearningScheduler] model ${m.id} flagged for retrain: ${trigger.reason}`);
        }
      }
    } catch (err) {
      console.error(`[aiSelfLearningScheduler] model ${m.id} scan failed:`, (err as any)?.message || err);
    }
  }

  const durationMs = Date.now() - start;
  lastRunAt = new Date();
  lastRunStats = { models: models.length, enqueued, retrainFlagged, retrainProposed, driftFlagged, durationMs };
  console.log(`[aiSelfLearningScheduler] done in ${durationMs}ms — ${enqueued} enqueued, ${retrainProposed} retrain proposal(s) across ${models.length} models`);
  return lastRunStats;
}

export function initSelfLearningScheduler() {
  if (!ENABLED) {
    console.log("[aiSelfLearningScheduler] disabled (set AI_SELF_LEARNING_ENABLED=true to enable)");
    return;
  }
  if (job) return;
  job = cron.schedule(
    CRON,
    () => { runSelfLearningScanOnce().catch(err => console.error("[aiSelfLearningScheduler] cron error:", err)); },
    { timezone: TZ },
  );
  console.log(`[aiSelfLearningScheduler] scheduled '${CRON}' (${TZ})`);
}

export function stopSelfLearningScheduler() {
  if (job) { job.stop(); job = null; }
}

export function getSelfLearningStatus() {
  return { enabled: ENABLED, cron: CRON, timezone: TZ, running: !!job, lastRunAt, lastRunStats };
}
