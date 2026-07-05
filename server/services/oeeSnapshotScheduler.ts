/**
 * OEE Snapshot Scheduler — doc 32 Wave R5 (R1 readiness gap).
 *
 * Wave R1 found that `oee_metrics` is written ONLY on demand — the manual
 * "Calculate OEE" button (mqttOeeRouters.calculateOEE) — so in practice the
 * table is sparse/gappy and the OEE reports (R3 external, R4 web, the /api/bi
 * `machine_oee` + `/api/export/oee` datasets) have almost no continuous data.
 *
 * This periodic job snapshots OEE per ACTIVE machine per period into
 * `oee_metrics`, reusing the SAME canonical compute path the manual button uses
 * (oeeService.computeOEE → persistOEEMetric — SEMI E10 / ISO 22400). It mirrors
 * cpkSnapshotScheduler / aiThresholdTuneScheduler exactly: node-cron
 * registration, own timers, flag-gated, no-overlap guard, fully error-isolated,
 * bounded, and IDEMPOTENT (never double-inserts the same machine+period+end).
 *
 * Cadence: an HOURLY snapshot of the last completed hour + a DAILY rollup of the
 * previous day (both crons + timezone tunable via env).
 *
 * SAFETY: the flag defaults OFF because this job WRITES data. Turn on in prod
 * with `OEE_SNAPSHOT_ENABLED=true` (per deployment — single worker only, like
 * every other scheduler here; there is no leader election).
 *
 * ── OEE inputs (honest, real sources) ────────────────────────────────────────
 *  • Production counts (totalCount / goodCount) are counted directly from
 *    product_inspections over the window per machine. goodCount = OK + NTF (the
 *    canonical yield convention — NTF counts as pass, same as everywhere else).
 *  • SEMI E10 state durations (availability) come from downtime_events inside
 *    computeOEE (no downtime tracked ⇒ the window is treated as fully productive
 *    ⇒ availability 100% — the honest default).
 *  • idealCycleTimeSec (Performance denominator) is resolved via
 *    oeeService.resolveIdealCycleTimeSec (configured / last-known) and, when that
 *    is absent, FALLS BACK to the window's observed average cycle time. When
 *    ideal ≈ observed average, Performance reflects productive-time utilisation
 *    rather than pure speed-loss — configure an ideal cycle time for true OEE.
 *    A machine with production but no resolvable ideal is SKIPPED (never a
 *    fabricated Performance=0), and a machine with no production in the window is
 *    SKIPPED too (OEE is a production-period metric).
 */

import * as cron from "node-cron";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { executeRows } from "../utils/kpi";
import { computeOEE, persistOEEMetric, resolveIdealCycleTimeSec } from "./oeeService";

// ─── Flags / constants ────────────────────────────────────────────────────────
const ENABLED = String(process.env.OEE_SNAPSHOT_ENABLED ?? "false").toLowerCase() === "true";
const HOURLY_CRON = process.env.OEE_SNAPSHOT_HOURLY_CRON || "5 * * * *"; // :05 every hour
const DAILY_CRON = process.env.OEE_SNAPSHOT_DAILY_CRON || "20 1 * * *"; // 01:20 daily
const TZ = process.env.OEE_SNAPSHOT_TZ || "Asia/Ho_Chi_Minh";
const MAX_MACHINES = Math.max(1, Number(process.env.OEE_SNAPSHOT_MAX_MACHINES ?? 5000));

export type OeePeriodType = "HOUR" | "DAY";

// ─── Module state ─────────────────────────────────────────────────────────────
let hourlyJob: cron.ScheduledTask | null = null;
let dailyJob: cron.ScheduledTask | null = null;
let runningHourly = false;
let runningDaily = false;
let lastRunAt: string | null = null;
let lastRunStats: OeeSnapshotStats | null = null;

export interface OeeSnapshotStats {
  periodType: OeePeriodType;
  windowStart: string;
  windowEnd: string;
  machines: number;            // active machines considered
  snapshotted: number;         // rows written to oee_metrics
  skippedNoProduction: number; // machine had no inspections in the window
  skippedDuplicate: number;    // a row for this machine+period+end already exists (idempotent)
  skippedNoIdeal: number;      // production but no resolvable ideal cycle time
  errors: number;
  ms: number;
}

// ─── Window helpers (UTC-floored) ─────────────────────────────────────────────
// Ingest stores "fake-UTC" shifted inspectionTimes (see processInspectionSubmission
// / cpkSnapshotScheduler note): the stored instant already equals the factory
// wall-clock read as UTC. So UTC-floored hour/day boundaries line up with the
// factory-local hour/day here — which is exactly what we want.
function floorHourUtc(d: Date): Date {
  const t = new Date(d);
  t.setUTCMinutes(0, 0, 0);
  return t;
}
function floorDayUtc(d: Date): Date {
  const t = new Date(d);
  t.setUTCHours(0, 0, 0, 0);
  return t;
}

/** [from, to) for the LAST COMPLETED period ending at/just before `now`. */
export function periodWindow(periodType: OeePeriodType, now: Date): { from: Date; to: Date } {
  if (periodType === "DAY") {
    const to = floorDayUtc(now);
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
    return { from, to };
  }
  const to = floorHourUtc(now);
  const from = new Date(to.getTime() - 60 * 60 * 1000);
  return { from, to };
}

// ─── Core run (NOT gated by ENABLED — ENABLED only controls cron registration,
//     so this can be called on demand / in tests). Never throws. ──────────────
export async function runOeeSnapshotNow(opts?: {
  periodType?: OeePeriodType;
  now?: Date;
  from?: Date;
  to?: Date;
}): Promise<OeeSnapshotStats> {
  const t0 = Date.now();
  const periodType: OeePeriodType = opts?.periodType ?? "HOUR";
  const now = opts?.now ?? new Date();
  const win = opts?.from && opts?.to ? { from: opts.from, to: opts.to } : periodWindow(periodType, now);
  const { from, to } = win;

  const stats: OeeSnapshotStats = {
    periodType,
    windowStart: from.toISOString(),
    windowEnd: to.toISOString(),
    machines: 0,
    snapshotted: 0,
    skippedNoProduction: 0,
    skippedDuplicate: 0,
    skippedNoIdeal: 0,
    errors: 0,
    ms: 0,
  };

  try {
    const db = await getDb();
    if (!db) {
      stats.ms = Date.now() - t0;
      return stats;
    }

    // 1) Active machines (bounded).
    const machineRows = executeRows(
      await db.execute(sql`
        SELECT id, code
        FROM machines
        WHERE "isActive" = true
        ORDER BY id
        LIMIT ${MAX_MACHINES}
      `),
    ) as Array<{ id: number; code: string }>;

    if (machineRows.length === 0) {
      stats.ms = Date.now() - t0;
      lastRunAt = new Date().toISOString();
      lastRunStats = stats;
      return stats;
    }

    // 2) Production counts per machine over the window (one grouped query).
    const countRows = executeRows(
      await db.execute(sql`
        SELECT "machineId"                                                          AS machine_id,
               COUNT(*)::int                                                        AS total,
               SUM(CASE WHEN "overallResult" IN ('OK','NTF') THEN 1 ELSE 0 END)::int AS good,
               AVG(NULLIF("cycleTime", 0))::float                                   AS avg_cycle
        FROM product_inspections
        WHERE "inspectionTime" >= ${from} AND "inspectionTime" < ${to}
        GROUP BY "machineId"
      `),
    ) as Array<{ machine_id: number; total: number; good: number; avg_cycle: number | null }>;

    const counts = new Map<number, { total: number; good: number; avgCycle: number | null }>();
    for (const r of countRows) {
      counts.set(Number(r.machine_id), {
        total: Number(r.total) || 0,
        good: Number(r.good) || 0,
        avgCycle: r.avg_cycle != null ? Number(r.avg_cycle) : null,
      });
    }

    // 3) Existing rows for this exact period end (IDEMPOTENCY — never double-insert).
    const existingRows = executeRows(
      await db.execute(sql`
        SELECT DISTINCT "machineId" AS machine_id
        FROM oee_metrics
        WHERE "periodType" = ${periodType} AND "timestamp" = ${to}
      `),
    ) as Array<{ machine_id: number }>;
    const existing = new Set<number>(existingRows.map((r) => Number(r.machine_id)));

    // 4) Snapshot each machine (fail-safe per machine).
    for (const m of machineRows) {
      stats.machines++;
      const machineId = Number(m.id);
      try {
        const c = counts.get(machineId);
        if (!c || c.total <= 0) {
          stats.skippedNoProduction++;
          continue;
        }
        if (existing.has(machineId)) {
          stats.skippedDuplicate++;
          continue;
        }

        // Ideal cycle time: configured/last-known first, else observed avg.
        let idealSource = "configured";
        let ideal = await resolveIdealCycleTimeSec(machineId);
        if (!ideal || ideal <= 0) {
          ideal = c.avgCycle && c.avgCycle > 0 ? c.avgCycle : null;
          idealSource = "observed_avg";
        }
        if (!ideal || ideal <= 0) {
          stats.skippedNoIdeal++;
          continue;
        }

        const breakdown = await computeOEE({
          machineId,
          from,
          to,
          totalCount: c.total,
          goodCount: c.good,
          idealCycleTimeSec: ideal,
        });

        await persistOEEMetric({
          breakdown,
          machineCode: m.code ?? `M-${machineId}`,
          periodType,
          calculatedBy: "OEE_SNAPSHOT",
          notes: `auto ${periodType} snapshot; ideal=${idealSource}(${Math.round(ideal)}s)`,
        });
        stats.snapshotted++;
      } catch (e) {
        stats.errors++;
        console.error(
          `[oeeSnapshotScheduler] machine ${machineId} ${periodType} snapshot failed:`,
          (e as any)?.message || e,
        );
      }
    }
  } catch (e) {
    // Top-level guard: a run must never throw.
    console.error("[oeeSnapshotScheduler] run error:", (e as any)?.message || e);
  }

  stats.ms = Date.now() - t0;
  lastRunAt = new Date().toISOString();
  lastRunStats = stats;
  return stats;
}

// ─── Scheduler lifecycle (mirror cpkSnapshotScheduler) ────────────────────────

/** Register both cron jobs. No-op when OEE_SNAPSHOT_ENABLED is not "true". */
export function startOeeSnapshotScheduler(): void {
  if (!ENABLED) {
    console.log("[oeeSnapshotScheduler] disabled (set OEE_SNAPSHOT_ENABLED=true to enable — WRITES data)");
    return;
  }
  if (hourlyJob || dailyJob) return; // already started

  hourlyJob = cron.schedule(
    HOURLY_CRON,
    () => {
      if (runningHourly) return; // no overlap
      runningHourly = true;
      runOeeSnapshotNow({ periodType: "HOUR" })
        .then((s) =>
          console.log(
            `[oeeSnapshotScheduler] HOUR ${s.windowStart}→${s.windowEnd}: snapshotted ${s.snapshotted}/${s.machines} ` +
              `(noProd=${s.skippedNoProduction} dup=${s.skippedDuplicate} noIdeal=${s.skippedNoIdeal} err=${s.errors}) in ${s.ms}ms`,
          ),
        )
        .catch((e) => console.error("[oeeSnapshotScheduler] hourly cron error:", e))
        .finally(() => {
          runningHourly = false;
        });
    },
    { timezone: TZ },
  );

  dailyJob = cron.schedule(
    DAILY_CRON,
    () => {
      if (runningDaily) return; // no overlap
      runningDaily = true;
      runOeeSnapshotNow({ periodType: "DAY" })
        .then((s) =>
          console.log(
            `[oeeSnapshotScheduler] DAY ${s.windowStart}→${s.windowEnd}: snapshotted ${s.snapshotted}/${s.machines} ` +
              `(noProd=${s.skippedNoProduction} dup=${s.skippedDuplicate} noIdeal=${s.skippedNoIdeal} err=${s.errors}) in ${s.ms}ms`,
          ),
        )
        .catch((e) => console.error("[oeeSnapshotScheduler] daily cron error:", e))
        .finally(() => {
          runningDaily = false;
        });
    },
    { timezone: TZ },
  );

  console.log(
    `[oeeSnapshotScheduler] scheduled hourly='${HOURLY_CRON}' daily='${DAILY_CRON}' (${TZ}) maxMachines=${MAX_MACHINES}`,
  );
}

/** Stop both cron jobs (shutdown). Safe to call when not started. */
export function stopOeeSnapshotScheduler(): void {
  if (hourlyJob) {
    hourlyJob.stop();
    hourlyJob = null;
  }
  if (dailyJob) {
    dailyJob.stop();
    dailyJob = null;
  }
  console.log("[oeeSnapshotScheduler] stopped");
}

/** Status for dashboards / health. */
export function getOeeSnapshotSchedulerStatus() {
  return {
    enabled: ENABLED,
    hourlyCron: HOURLY_CRON,
    dailyCron: DAILY_CRON,
    timezone: TZ,
    maxMachines: MAX_MACHINES,
    running: !!(hourlyJob || dailyJob),
    lastRunAt,
    lastRunStats,
  };
}
