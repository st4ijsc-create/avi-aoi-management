/**
 * Alert Evaluation Scheduler (P0-E)
 *
 * Wires up the previously-dead alerting pipeline. On a fixed interval it:
 *   1. Evaluates every active legacy alertSetting (yield_rate / ng_count /
 *      machine_status / machine_offline) and fires on breach — bug #1 (rules
 *      had no evaluator, only a manual test button).
 *   2. (GỠ ở Pha 0 AL0-1, 2026-11-04) bộ dò detectDefectSpike / detectYieldDrop KHÔNG còn chạy theo lịch — nguồn lũ thông báo.
 *   3. Runs processAutoEscalation() so unacknowledged alerts escalate — bug #2.
 *
 * Convention matches the existing setInterval schedulers in this repo
 * (mqttAlertScheduler / alertEscalationService): module-level timer + guard
 * flag, run-immediately-then-interval, start/stop/status exports.
 *
 * Interval is configurable via ALERT_EVALUATOR_INTERVAL_MINUTES (default 2).
 * Enabled by default; set ALERT_EVALUATOR_ENABLED=false to disable.
 */

import { getDb } from "../db/connection";
import { evaluateActiveAlertSettings } from "../routers/alertRouters";
import { processAutoEscalation } from "./aiSmartAlertRouter";

let timer: NodeJS.Timeout | null = null;
let isRunning = false;
let cycleInFlight = false;
let lastRunAt: Date | null = null;
let lastError: string | null = null;

const DEFAULT_INTERVAL_MINUTES = 2;

function resolveIntervalMinutes(override?: number): number {
  if (override && override > 0) return override;
  const fromEnv = Number(process.env.ALERT_EVALUATOR_INTERVAL_MINUTES);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return DEFAULT_INTERVAL_MINUTES;
}

async function runCycle(): Promise<void> {
  // Re-entrancy guard: a slow cycle must not overlap the next tick.
  if (cycleInFlight) {
    console.log("[AlertEvaluator] Previous cycle still running, skipping this tick");
    return;
  }
  cycleInFlight = true;
  lastRunAt = new Date();
  lastError = null;

  try {
    const db = await getDb();
    if (!db) {
      console.warn("[AlertEvaluator] Database not available, skipping cycle");
      return;
    }

    // 1) Legacy alertSettings rules.
    let legacyFired = 0;
    try {
      legacyFired = await evaluateActiveAlertSettings();
    } catch (err) {
      console.error("[AlertEvaluator] legacy alertSettings eval failed:", (err as Error).message);
    }

    // 2) ★ Pha 0 AL0-1 (2026-11-04): BỘ DÒ detectDefectSpike / detectYieldDrop KHÔNG còn chạy theo lịch. Chúng là nguồn lũ đo được
    //    (53 416 thông báo "CRITICAL Alert: DEFECT SPIKE" phát cho 5 người, 100 % chưa đọc — TechDocs 40 §1) và không có đường tắt theo
    //    người nhận. Vẫn gọi tay được qua aiSmartAlertRouting.*; thay thế đúng nghĩa là alarm_event ở AL1+ (40 §2).
    const spikes = 0;
    const yieldDrops = 0;

    // 3) Auto-escalation of unacknowledged alerts.
    let escalated = 0;
    try {
      escalated = await processAutoEscalation();
    } catch (err) {
      console.error("[AlertEvaluator] processAutoEscalation failed:", (err as Error).message);
    }

    console.log(
      `[AlertEvaluator] cycle done — legacyFired=${legacyFired} spikes=${spikes} yieldDrops=${yieldDrops} escalated=${escalated}`,
    );
  } catch (err) {
    lastError = (err as Error).message;
    console.error("[AlertEvaluator] cycle error:", lastError);
  } finally {
    cycleInFlight = false;
  }
}

/**
 * Start the scheduler. Idempotent — a second call while running is a no-op
 * (guards against double-start). Disabled when ALERT_EVALUATOR_ENABLED=false.
 */
export function startAlertEvaluatorScheduler(intervalMinutes?: number): void {
  if (process.env.ALERT_EVALUATOR_ENABLED === "false") {
    console.log("[AlertEvaluator] Disabled via ALERT_EVALUATOR_ENABLED=false");
    return;
  }
  if (isRunning || timer) {
    console.log("[AlertEvaluator] Already running, ignoring start()");
    return;
  }

  const minutes = resolveIntervalMinutes(intervalMinutes);
  isRunning = true;
  console.log(`[AlertEvaluator] Started (interval: ${minutes} min)`);

  // Run once immediately, then on the interval. Errors are swallowed inside
  // runCycle so the timer never dies.
  void runCycle();
  timer = setInterval(() => void runCycle(), minutes * 60 * 1000);
}

export function stopAlertEvaluatorScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  isRunning = false;
  console.log("[AlertEvaluator] Stopped");
}

export function getAlertEvaluatorStatus() {
  return { isRunning, cycleInFlight, lastRunAt, lastError };
}

/** Manual one-shot trigger (e.g. for an admin endpoint or tests). */
export async function triggerAlertEvaluatorCycle() {
  await runCycle();
  return { lastRunAt, lastError };
}
