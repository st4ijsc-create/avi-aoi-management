/**
 * AI SPC-Alert Sweep Scheduler — W0-D
 *
 * `getControlChart()` computes SPC control-chart rule violations, and
 * `triggerSpcAlerts()` persists + broadcasts them — but until this task
 * neither had any proactive caller: violations were only ever detected
 * reactively when a user opened a control chart. This scheduler runs a
 * periodic sweep (default every 30 min) over machines with recent NG
 * inspections, computes their control chart, and fires any detected
 * violations through the now-idempotent `triggerSpcAlerts()` (see W0-D's
 * dedup fix in aiInspectionAnalytics.ts) — so a re-run of this sweep neither
 * duplicates rows nor re-notifies for a violation already recorded today.
 *
 * Mirrors server/services/aiBatchRcaScheduler.ts's shape: a pure
 * run...Once(), init.../stop.../get...Status(), flag-gated via node-cron.
 *
 * Opt-in: this writes DB rows + broadcasts socket alerts (new proactive
 * behavior), so AI_SPC_ALERT_SWEEP_ENABLED defaults to OFF — inert until an
 * operator explicitly enables it.
 */

import * as cron from "node-cron";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { getControlChart, triggerSpcAlerts } from "./aiInspectionAnalytics";

const CRON = process.env.AI_SPC_ALERT_CRON || "*/30 * * * *"; // every 30 min
const TIMEZONE = process.env.AI_SPC_ALERT_TZ || "Asia/Ho_Chi_Minh";
const MAX_MACHINES_PER_RUN = Number(process.env.AI_SPC_ALERT_MAX_MACHINES || "50");
const METRIC = (process.env.AI_SPC_ALERT_METRIC || "defectRate") as "yield" | "defectRate" | "cycleTime";
const WINDOW_HOURS = Number(process.env.AI_SPC_ALERT_WINDOW_HOURS || "24");
// Opt-in (default OFF) — inverted default vs. AI_BATCH_RCA_ENABLED on purpose:
// this is new proactive behavior (writes rows + broadcasts), not a fix to
// existing always-on behavior.
const ENABLED = String(process.env.AI_SPC_ALERT_SWEEP_ENABLED ?? "false").toLowerCase() === "true";

let scheduledJob: cron.ScheduledTask | null = null;
let lastRunAt: Date | null = null;
let lastRunStats: { machinesSwept: number; violationsFired: number; failed: number; durationMs: number } | null = null;

interface MachineRow {
  id: number;
  code: string;
  ng_count: number;
}

async function fetchActiveMachines(db: any, since: Date, until: Date): Promise<MachineRow[]> {
  // postgres.js không bind native Date qua sql template — phải truyền ISO string + cast ::timestamptz
  // (same idiom as aiBatchRcaScheduler.fetchActiveMachines).
  const sinceIso = since.toISOString();
  const untilIso = until.toISOString();
  const result = (await db.execute(sql`
    SELECT m.id, m.code, COUNT(*)::int AS ng_count
    FROM product_inspections i
    JOIN machines m ON i."machineId" = m.id
    WHERE i."createdAt" BETWEEN ${sinceIso}::timestamptz AND ${untilIso}::timestamptz
      AND i."overallResult" = 'NG'
    GROUP BY m.id, m.code
    HAVING COUNT(*) > 0
    ORDER BY COUNT(*) DESC
    LIMIT ${MAX_MACHINES_PER_RUN}
  `)) as any;
  // Same `.rows || result || []` accessor as aiBatchRcaScheduler — this
  // project's postgres-js driver returns rows directly (no `.rows` wrapper).
  return result.rows || result || [];
}

export async function runSpcAlertSweepOnce(): Promise<{
  machinesSwept: number;
  violationsFired: number;
  failed: number;
  durationMs: number;
}> {
  const start = Date.now();
  const db = await getDb();
  if (!db) {
    console.warn("[aiSpcAlertScheduler] db unavailable, skipping");
    return { machinesSwept: 0, violationsFired: 0, failed: 0, durationMs: Date.now() - start };
  }

  const until = new Date();
  const since = new Date(until.getTime() - WINDOW_HOURS * 60 * 60 * 1000);

  let machines: MachineRow[] = [];
  try {
    machines = await fetchActiveMachines(db, since, until);
  } catch (err) {
    console.error("[aiSpcAlertScheduler] fetchActiveMachines failed:", err);
    return { machinesSwept: 0, violationsFired: 0, failed: 0, durationMs: Date.now() - start };
  }

  console.log(`[aiSpcAlertScheduler] Found ${machines.length} active machines with NG in last ${WINDOW_HOURS}h`);

  let violationsFired = 0;
  let failed = 0;

  for (const m of machines) {
    try {
      const chart = await getControlChart({ startDate: since, endDate: until, machineId: m.id }, METRIC);
      const violations = chart?.summary?.spcViolations ?? [];
      if (violations.length > 0) {
        await triggerSpcAlerts({
          violations,
          metric: METRIC,
          machineId: m.id,
          controlLimits: { ucl: chart.summary.ucl, lcl: chart.summary.lcl, cl: chart.summary.mean },
        });
        violationsFired += violations.length;
      }
    } catch (err) {
      console.error(`[aiSpcAlertScheduler] Machine ${m.code} (#${m.id}) failed:`, err);
      failed++;
    }
  }

  const durationMs = Date.now() - start;
  lastRunAt = new Date();
  lastRunStats = { machinesSwept: machines.length, violationsFired, failed, durationMs };
  console.log(
    `[aiSpcAlertScheduler] Done in ${durationMs}ms — ${machines.length} machines swept, ${violationsFired} violations fired, ${failed} failed`,
  );
  return lastRunStats;
}

export function initSpcAlertScheduler() {
  if (!ENABLED) {
    console.log("[aiSpcAlertScheduler] disabled (default) — opt in via AI_SPC_ALERT_SWEEP_ENABLED=true");
    return;
  }
  if (scheduledJob) return;
  scheduledJob = cron.schedule(
    CRON,
    () => {
      runSpcAlertSweepOnce().catch(err => console.error("[aiSpcAlertScheduler] cron run error:", err));
    },
    { timezone: TIMEZONE },
  );
  console.log(`[aiSpcAlertScheduler] scheduled '${CRON}' (${TIMEZONE})`);
}

export function stopSpcAlertScheduler() {
  if (scheduledJob) {
    scheduledJob.stop();
    scheduledJob = null;
  }
}

export function getSpcAlertStatus() {
  return {
    enabled: ENABLED,
    cron: CRON,
    timezone: TIMEZONE,
    running: !!scheduledJob,
    lastRunAt,
    lastRunStats,
    maxMachinesPerRun: MAX_MACHINES_PER_RUN,
    metric: METRIC,
    windowHours: WINDOW_HOURS,
  };
}
