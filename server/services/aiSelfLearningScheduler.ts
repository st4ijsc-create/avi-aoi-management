/**
 * AI Self-Learning Scheduler — WS-1
 *
 * Periodically (a) sweeps inference results for uncertain images and enqueues
 * them for labeling, and (b) checks the auto-retrain trigger for active models.
 * Both passes are IDEMPOTENT and offline. Disabled by default; opt in via env.
 *
 * Env flags:
 *   AI_SELF_LEARNING_ENABLED       (default "false")
 *   AI_SELF_LEARNING_CRON          (default "0 3 * * *" — 03:00 daily)
 *   AI_SELF_LEARNING_TZ            (default "Asia/Ho_Chi_Minh")
 *   AI_SELF_LEARNING_UNCERTAINTY   (default "0.5")
 *   AI_SELF_LEARNING_SINCE_HOURS   (default "24")
 *   AI_SELF_LEARNING_MAX_ITEMS     (default "200")
 *   AI_SELF_LEARNING_AUTORETRAIN   (default "false" — only flags, never auto-trains)
 */

import * as cron from "node-cron";
import { getDb } from "../db/connection";
import { aiModels } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { scanInferenceForUncertainty } from "./aiActiveLearningAuto";
import { checkAutoRetrainTrigger } from "./aiTrainingPipeline";
import { checkConfidenceDrift, isDriftMonitorEnabled } from "./aiDriftMonitor";

const ENABLED = String(process.env.AI_SELF_LEARNING_ENABLED ?? "false").toLowerCase() === "true";
const CRON = process.env.AI_SELF_LEARNING_CRON || "0 3 * * *";
const TZ = process.env.AI_SELF_LEARNING_TZ || "Asia/Ho_Chi_Minh";
const UNCERTAINTY = Number(process.env.AI_SELF_LEARNING_UNCERTAINTY || "0.5");
const SINCE_HOURS = Number(process.env.AI_SELF_LEARNING_SINCE_HOURS || "24");
const MAX_ITEMS = Number(process.env.AI_SELF_LEARNING_MAX_ITEMS || "200");
const AUTORETRAIN = String(process.env.AI_SELF_LEARNING_AUTORETRAIN ?? "false").toLowerCase() === "true";

let job: cron.ScheduledTask | null = null;
let lastRunAt: Date | null = null;
let lastRunStats: { models: number; enqueued: number; retrainFlagged: number; driftFlagged: number; durationMs: number } | null = null;

export async function runSelfLearningScanOnce() {
  const start = Date.now();
  const db = await getDb();
  if (!db) {
    console.warn("[aiSelfLearningScheduler] db unavailable, skipping");
    return { models: 0, enqueued: 0, retrainFlagged: 0, driftFlagged: 0, durationMs: 0 };
  }

  const models = await db.select({ id: aiModels.id }).from(aiModels).where(eq(aiModels.status, "ACTIVE"));
  const since = new Date(Date.now() - SINCE_HOURS * 3600_000);

  let enqueued = 0;
  let retrainFlagged = 0;
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

      // B5.2 — advisory confidence-drift check. Self-gating: a safe no-op unless
      // AI_DRIFT_MONITOR_ENABLED is on. Emits a model_drift_alerts row on drift;
      // NEVER swaps/retrains a model.
      if (isDriftMonitorEnabled()) {
        const drift = await checkConfidenceDrift({ modelId: m.id });
        if (drift.drift) {
          driftFlagged++;
          console.log(`[aiSelfLearningScheduler] model ${m.id} confidence drift (${drift.severity}): ${drift.reasons.join("; ")}`);
        }
      }

      if (AUTORETRAIN) {
        const trigger = await checkAutoRetrainTrigger(m.id);
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
  lastRunStats = { models: models.length, enqueued, retrainFlagged, driftFlagged, durationMs };
  console.log(`[aiSelfLearningScheduler] done in ${durationMs}ms — ${enqueued} enqueued across ${models.length} models`);
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
