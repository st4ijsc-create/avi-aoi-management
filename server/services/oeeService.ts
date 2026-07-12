/**
 * OEE Service — SEMI E10 compliant calculator
 *
 * Computes Overall Equipment Effectiveness from `downtime_events` and
 * `oee_metrics` over a time window, classifying every minute into one of
 * SEMI E10 six equipment states:
 *
 *   1. Productive Time              (PT)  — making good product
 *   2. Standby Time                 (SB)  — capable, no demand
 *   3. Engineering Time             (ET)  — qualification / experiments
 *   4. Scheduled Downtime           (SD)  — planned maintenance, setup
 *   5. Unscheduled Downtime         (UD)  — failures, repairs
 *   6. Non-Scheduled Time           (NS)  — shift off, holiday
 *
 * SEMI E10 / SEMI E79 OEE definitions:
 *   Availability  = (Operations Time) / (Equipment Uptime)
 *                 = (PT + ET) / (PT + SB + ET + UD)
 *   Performance   = (Theoretical Production Time for Actual Units)
 *                  / (PT)
 *                 = (idealCycleTime × goodCount + idealCycleTime × rejectCount)
 *                  / (PT × 60)
 *   Quality       = goodCount / totalCount
 *   OEE           = Availability × Performance × Quality
 *
 * Standards: SEMI E10-0701, SEMI E79-0200, ISO 22400-2 (KPI for MOM).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CANONICAL SOURCE OF TRUTH
 * ─────────────────────────────────────────────────────────────────────────
 * This module is the ONE place OEE is defined. Every consumer (mqttOeeRouters
 * `getAllOEE`/`getMachineOEE`/`calculateOEE`, dashboards, reports) must delegate
 * here rather than re-deriving A/P/Q with its own formula.
 *
 * `getMachineOEELive` / `getAllMachinesOEELive` compute OEE on read from REAL
 * sources — no in-memory cache, no synthetic multipliers, no random fallback:
 *
 *   Availability  = online time / (online + offline)            ← machine_status_logs
 *                   (getMachineUptimeStats — the unified status/uptime path)
 *   Performance   = (idealCycleTime × totalCount) / runTimeSec  ← daily_statistics
 *                   runTimeSec = online seconds from the same uptime source.
 *                   idealCycleTime resolved from the active oee_target's
 *                   implied ideal (targetPerformance vs avgCycleTime) or, when
 *                   no ideal is configured, Performance is NULL (honest N/A).
 *   Quality       = (okCount + ntfCount) / totalCount           ← daily_statistics
 *                   NTF = "no-trouble-found" (confirmed good); this is the same
 *                   yield convention used everywhere else (server/db/statistics).
 *   OEE           = Availability × Performance × Quality
 *
 * When a factor's inputs are absent we return `null` for that factor (and for
 * OEE), NEVER a fabricated number. Callers/UI render null as "N/A".
 */

import { getDb } from "../db/connection";
import { and, eq, gte, lte, isNotNull, isNull, or, sql } from "drizzle-orm";
import { executeRows } from "../utils/kpi";
import { publishToOutbox } from "./integration/outboxProducers"; // K0+-c: ADDITIVE ERP outbox (ERP_OUTBOX_ENABLED)
import {
  downtimeEvents,
  oeeMetrics,
  oeeTargets,
  dailyStatistics,
  machines,
  type InsertOEEMetric,
} from "../../drizzle/schema";
import { getMachineUptimeStats } from "../db/machine";

// SEMI E10 category → equipment state mapping. The `category` enum used by
// downtime_events is application-specific (`unplanned`, `planned`, …); we
// normalize it into the canonical six states here.
const SEMI_E10_MAP: Record<string, "SD" | "UD" | "ET" | "NS" | "SB"> = {
  planned: "SD",
  scheduled: "SD",
  maintenance: "SD",
  setup: "SD",
  changeover: "SD",
  unplanned: "UD",
  failure: "UD",
  breakdown: "UD",
  fault: "UD",
  engineering: "ET",
  qualification: "ET",
  test: "ET",
  non_scheduled: "NS",
  holiday: "NS",
  standby: "SB",
  idle: "SB",
};

export interface StateDurations {
  PT: number; // Productive (minutes)
  SB: number; // Standby
  ET: number; // Engineering
  SD: number; // Scheduled downtime
  UD: number; // Unscheduled downtime
  NS: number; // Non-scheduled
  totalWindow: number; // Total minutes in window
  equipmentUptime: number; // PT + SB + ET + UD
  operationsTime: number;  // PT + ET
}

export interface OEEBreakdown {
  machineId: number;
  windowStart: Date;
  windowEnd: Date;
  states: StateDurations;
  availability: number;   // 0..1
  performance: number;    // 0..1
  quality: number;        // 0..1
  oee: number;            // 0..1
  totalCount: number;
  goodCount: number;
  rejectCount: number;
  idealCycleTimeSec: number;
}

function classify(category: string | null | undefined): "SD" | "UD" | "ET" | "NS" | "SB" {
  if (!category) return "UD";
  return SEMI_E10_MAP[category.toLowerCase()] ?? "UD";
}

function clipToWindow(start: Date, end: Date, winStart: Date, winEnd: Date): number {
  const s = Math.max(start.getTime(), winStart.getTime());
  const e = Math.min(end.getTime(), winEnd.getTime());
  return Math.max(0, Math.round((e - s) / 60000));
}

/**
 * Compute SEMI E10 state durations for a machine over [from, to].
 * Any time not covered by a downtime event is treated as productive.
 */
export async function computeStateDurations(params: {
  machineId: number;
  from: Date;
  to: Date;
}): Promise<StateDurations> {
  const { machineId, from, to } = params;
  const db = await getDb();
  if (!db) {
    return {
      PT: 0, SB: 0, ET: 0, SD: 0, UD: 0, NS: 0,
      totalWindow: 0, equipmentUptime: 0, operationsTime: 0,
    };
  }

  const events = await db.select({
    category: downtimeEvents.category,
    startTime: downtimeEvents.startTime,
    endTime: downtimeEvents.endTime,
  })
    .from(downtimeEvents)
    .where(and(
      eq(downtimeEvents.machineId, machineId),
      lte(downtimeEvents.startTime, to),
      // MON-F7 (doc 40) — lower time bound so we never scan the machine's ENTIRE
      // downtime history: keep only events that can still overlap [from, to] —
      // ongoing (endTime IS NULL) or ended at/after `from`. The JS loop below
      // already drops `end <= from`; this just moves that filter into SQL.
      or(isNull(downtimeEvents.endTime), gte(downtimeEvents.endTime, from)),
    ));

  const states: Omit<StateDurations, "totalWindow" | "equipmentUptime" | "operationsTime"> = {
    PT: 0, SB: 0, ET: 0, SD: 0, UD: 0, NS: 0,
  };

  let nonProductiveMinutes = 0;
  for (const ev of events) {
    const end = ev.endTime ? new Date(ev.endTime) : to;
    const start = new Date(ev.startTime);
    if (end <= from) continue;
    const mins = clipToWindow(start, end, from, to);
    if (mins <= 0) continue;
    const code = classify(ev.category as any);
    states[code] += mins;
    nonProductiveMinutes += mins;
  }

  const totalWindow = Math.round((to.getTime() - from.getTime()) / 60000);
  states.PT = Math.max(0, totalWindow - nonProductiveMinutes);

  const equipmentUptime = states.PT + states.SB + states.ET + states.UD;
  const operationsTime  = states.PT + states.ET;

  return { ...states, totalWindow, equipmentUptime, operationsTime };
}

/**
 * Compute OEE breakdown over [from, to] using production counts from a
 * caller-supplied source (typically `daily_statistics`).
 */
export async function computeOEE(params: {
  machineId: number;
  from: Date;
  to: Date;
  totalCount: number;
  goodCount: number;
  idealCycleTimeSec: number;
}): Promise<OEEBreakdown> {
  const states = await computeStateDurations({
    machineId: params.machineId,
    from: params.from,
    to: params.to,
  });

  const goodCount  = Math.max(0, params.goodCount);
  const totalCount = Math.max(goodCount, params.totalCount);
  const rejectCount = totalCount - goodCount;

  const availability = states.equipmentUptime > 0
    ? states.operationsTime / states.equipmentUptime
    : 0;

  // theoretical productive seconds for actual output
  const theoreticalSec = totalCount * params.idealCycleTimeSec;
  const actualProductiveSec = states.PT * 60;
  const performance = actualProductiveSec > 0
    ? Math.min(1, theoreticalSec / actualProductiveSec)
    : 0;

  const quality = totalCount > 0 ? goodCount / totalCount : 0;
  const oee = availability * performance * quality;

  return {
    machineId: params.machineId,
    windowStart: params.from,
    windowEnd: params.to,
    states,
    availability,
    performance,
    quality,
    oee,
    totalCount,
    goodCount,
    rejectCount,
    idealCycleTimeSec: params.idealCycleTimeSec,
  };
}

/**
 * Persist a computed OEE breakdown to `oee_metrics` (percentage × 100).
 */
export async function persistOEEMetric(params: {
  breakdown: OEEBreakdown;
  machineCode: string;
  periodType?: "HOUR" | "SHIFT" | "DAY" | "WEEK" | "MONTH";
  calculatedBy?: string;
  notes?: string;
}): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const b = params.breakdown;
  const row: InsertOEEMetric = {
    machineId: b.machineId,
    machineCode: params.machineCode,
    timestamp: b.windowEnd,
    periodType: (params.periodType ?? "HOUR") as any,
    availability: Math.round(b.availability * 10000),
    performance:  Math.round(b.performance  * 10000),
    quality:      Math.round(b.quality      * 10000),
    oee:          Math.round(b.oee          * 10000),
    plannedTime:  b.states.equipmentUptime,
    runTime:      b.states.PT,
    idealCycleTime: b.idealCycleTimeSec,
    totalCount: b.totalCount,
    goodCount:  b.goodCount,
    rejectCount: b.rejectCount,
    calculatedBy: params.calculatedBy ?? "AUTO",
    notes: params.notes,
  };
  const [inserted] = await db.insert(oeeMetrics).values(row).returning({ id: oeeMetrics.id });

  // K0+-c: ADDITIVELY publish the OEE metric to the durable ERP outbox.
  // Fire-and-forget + error-isolated (never blocks OEE persist); gated by
  // ERP_OUTBOX_ENABLED (no-op when off). Idempotent per machine+window+period.
  if (inserted?.id) {
    const periodType = params.periodType ?? "HOUR";
    publishToOutbox({
      eventType: "oee-metric",
      payload: {
        oeeMetricId: inserted.id,
        machineId: b.machineId,
        machineCode: params.machineCode,
        timestamp: b.windowEnd.toISOString(),
        periodType,
        availability: row.availability,
        performance: row.performance,
        quality: row.quality,
        oee: row.oee,
        totalCount: b.totalCount,
        goodCount: b.goodCount,
        rejectCount: b.rejectCount,
      },
      idempotencyKey: `oee-${b.machineId}-${b.windowEnd.getTime()}-${periodType}`,
    });
  }

  return inserted?.id ?? null;
}

/**
 * Look up the active OEE target row that applies at `at`.
 */
export async function getActiveOEETarget(params: {
  machineId?: number;
  lineId?: number;
  at?: Date;
}): Promise<typeof oeeTargets.$inferSelect | null> {
  const db = await getDb();
  if (!db) return null;
  const at = params.at ?? new Date();
  const rows = await db.select().from(oeeTargets).where(and(
    eq(oeeTargets.isActive, true),
    lte(oeeTargets.effectiveFrom, at),
    params.machineId ? eq(oeeTargets.machineId, params.machineId) : sql`true`,
    params.lineId ? eq(oeeTargets.lineId, params.lineId) : sql`true`,
  ));
  return rows[0] ?? null;
}

export interface OEEAlert {
  level: "ok" | "warning" | "critical";
  oeePct: number;
  threshold: number;
  message: string;
}

export function evaluateOEEAlert(
  oee: number,
  target: { alertThreshold: number; criticalThreshold: number } | null,
): OEEAlert {
  const oeePct = Math.round(oee * 10000);
  if (!target) {
    return { level: "ok", oeePct, threshold: 0, message: "no target configured" };
  }
  if (oeePct < target.criticalThreshold) {
    return {
      level: "critical",
      oeePct,
      threshold: target.criticalThreshold,
      message: `OEE ${(oeePct / 100).toFixed(1)}% below critical ${(target.criticalThreshold / 100).toFixed(1)}%`,
    };
  }
  if (oeePct < target.alertThreshold) {
    return {
      level: "warning",
      oeePct,
      threshold: target.alertThreshold,
      message: `OEE ${(oeePct / 100).toFixed(1)}% below warning ${(target.alertThreshold / 100).toFixed(1)}%`,
    };
  }
  return { level: "ok", oeePct, threshold: target.alertThreshold, message: "within target" };
}

// ───────────────────────────────────────────────────────────────────────────
// LIVE OEE — computed on read from real sources (no in-memory cache).
//
// This is the canonical replacement for the legacy socket.ts in-memory
// `calculateOEE`/`machineOEEData` path. Factors that lack real inputs are
// returned as `null` (honest N/A) — never fabricated.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Live OEE for a single machine. Percentages are 0..100 to match the existing
 * frontend contract (CorporateDashboard / OEEDashboard / MachineHealthMonitoring
 * read `.oee/.availability/.performance/.quality` as percentages). Any factor
 * whose inputs are missing is `null`, and OEE is `null` unless all three exist.
 */
export interface LiveOEEMetrics {
  machineId: number;
  machineCode: string;
  timestamp: Date;
  availability: number | null; // %  online/(online+offline)
  performance: number | null;  // %  ideal·count / runTime   (null if no ideal cycle)
  quality: number | null;      // %  (ok+ntf)/total
  oee: number | null;          // %  A×P×Q (null if any factor null)
  details: {
    windowHours: number;
    onlineSeconds: number;
    offlineSeconds: number;
    totalCount: number;
    goodCount: number;       // ok + ntf
    rejectCount: number;     // ng
    idealCycleTimeSec: number | null;
    hasUptimeData: boolean;
    hasProductionData: boolean;
  };
}

function pct(x: number): number {
  return Math.round(Math.min(100, Math.max(0, x * 100)) * 100) / 100;
}

/**
 * Compute live OEE for one machine over the trailing `windowHours`.
 *
 *  - Availability from the unified machine-status/uptime path
 *    (getMachineUptimeStats → machine_status_logs).
 *  - Production counts (ok/ng/ntf/total) summed from daily_statistics for the
 *    window. Quality = (ok+ntf)/total (NTF treated as good — same convention as
 *    server/db/statistics yieldRate).
 *  - Ideal cycle time resolved by `resolveIdealCycleTimeSec`; when none is
 *    available, Performance (and therefore OEE) is null.
 */
export async function getMachineOEELive(params: {
  machineId: number;
  machineCode?: string;
  windowHours?: number;
  idealCycleTimeSec?: number | null;
}): Promise<LiveOEEMetrics> {
  const windowHours = params.windowHours ?? 24;
  const db = await getDb();

  // Resolve machine code if not supplied.
  let machineCode = params.machineCode ?? "";
  if (!machineCode && db) {
    const rows = await db.select({ code: machines.code })
      .from(machines).where(eq(machines.id, params.machineId)).limit(1);
    machineCode = rows[0]?.code ?? `M-${params.machineId}`;
  }

  const empty = (): LiveOEEMetrics => ({
    machineId: params.machineId,
    machineCode,
    timestamp: new Date(),
    availability: null,
    performance: null,
    quality: null,
    oee: null,
    details: {
      windowHours,
      onlineSeconds: 0,
      offlineSeconds: 0,
      totalCount: 0,
      goodCount: 0,
      rejectCount: 0,
      idealCycleTimeSec: null,
      hasUptimeData: false,
      hasProductionData: false,
    },
  });

  if (!db) return empty();

  // ── Availability ─────────────────────────────────────────────────────────
  const uptime = await getMachineUptimeStats(params.machineId, windowHours);
  const onlineSeconds = uptime.totalOnlineTime;
  const offlineSeconds = uptime.totalOfflineTime;
  const totalStatusTime = onlineSeconds + offlineSeconds;
  const hasUptimeData = totalStatusTime > 0;
  const availability = hasUptimeData ? onlineSeconds / totalStatusTime : null;

  // ── Production counts (Quality + Performance numerator) ───────────────────
  const from = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const statsRows = await db.select({
    totalCount: dailyStatistics.totalCount,
    okCount: dailyStatistics.okCount,
    ngCount: dailyStatistics.ngCount,
    ntfCount: dailyStatistics.ntfCount,
    avgCycleTime: dailyStatistics.avgCycleTime,
  })
    .from(dailyStatistics)
    .where(and(
      eq(dailyStatistics.machineId, params.machineId),
      gte(dailyStatistics.date, from),
    ));

  let totalCount = 0, okCount = 0, ngCount = 0, ntfCount = 0;
  for (const r of statsRows) {
    totalCount += Number(r.totalCount) || 0;
    okCount += Number(r.okCount) || 0;
    ngCount += Number(r.ngCount) || 0;
    ntfCount += Number(r.ntfCount) || 0;
  }
  const hasProductionData = totalCount > 0;
  const goodCount = okCount + ntfCount;
  const quality = hasProductionData ? goodCount / totalCount : null;

  // ── Performance ───────────────────────────────────────────────────────────
  const idealCycleTimeSec = params.idealCycleTimeSec ?? null;
  let performance: number | null = null;
  if (idealCycleTimeSec && idealCycleTimeSec > 0 && hasProductionData && onlineSeconds > 0) {
    performance = Math.min(1, (idealCycleTimeSec * totalCount) / onlineSeconds);
  }

  const allFactors = availability !== null && performance !== null && quality !== null;
  const oee = allFactors ? availability! * performance! * quality! : null;

  return {
    machineId: params.machineId,
    machineCode,
    timestamp: new Date(),
    availability: availability !== null ? pct(availability) : null,
    performance: performance !== null ? pct(performance) : null,
    quality: quality !== null ? pct(quality) : null,
    oee: oee !== null ? pct(oee) : null,
    details: {
      windowHours,
      onlineSeconds,
      offlineSeconds,
      totalCount,
      goodCount,
      rejectCount: ngCount,
      idealCycleTimeSec,
      hasUptimeData,
      hasProductionData,
    },
  };
}

/**
 * MON-F8 (doc 40) — proactive ideal-cycle-time source flag.
 *
 * Default OFF (behaviour unchanged: ideal is read back from oee_metrics). When
 * armed (in .env.sim) `resolveIdealCycleTimeSec` prefers a CONFIGURED active OEE
 * target's implied ideal (observed avg cycle × targetPerformance) over the
 * oee_metrics read-back — breaking the chicken-and-egg where OEE needs an ideal
 * that only a prior OEE snapshot could supply.
 */
function idealFromTargetEnabled(): boolean {
  return String(process.env.OEE_IDEAL_FROM_TARGET ?? "false").toLowerCase() === "true";
}

/**
 * Resolve an ideal cycle time (seconds/unit) for a machine.
 * Priority:
 *   1. (MON-F8, when OEE_IDEAL_FROM_TARGET armed AND an observed avg cycle is
 *      supplied) the active oee_target's implied ideal = avgCycle × targetPerformance.
 *      This is a PROACTIVE source — it needs no pre-existing oee_metrics row.
 *   2. Most-recent persisted oee_metrics.idealCycleTime for this machine.
 *   3. null (no synthetic default).
 *
 * NOTE: a dedicated `machines.idealCycleTimeSec` column would be the cleanest
 * proactive source, but that table/migration is outside this wave's owned files;
 * the active-target implied ideal delivers the same "configured, not read-back"
 * property without a schema change.
 */
export async function resolveIdealCycleTimeSec(
  machineId: number,
  opts?: { avgCycleTimeSec?: number | null; at?: Date },
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  // 1) Proactive: active OEE target's implied ideal (gated OFF by default).
  if (idealFromTargetEnabled() && opts?.avgCycleTimeSec && opts.avgCycleTimeSec > 0) {
    const target = await getActiveOEETarget({ machineId, at: opts?.at });
    if (target && target.targetPerformance > 0) {
      const implied = opts.avgCycleTimeSec * (target.targetPerformance / 10000);
      if (implied > 0) return implied;
    }
  }

  // 2) Fallback: last-known persisted ideal from oee_metrics.
  const rows = await db.select({ idealCycleTime: oeeMetrics.idealCycleTime })
    .from(oeeMetrics)
    .where(and(eq(oeeMetrics.machineId, machineId), isNotNull(oeeMetrics.idealCycleTime)))
    .orderBy(sql`${oeeMetrics.timestamp} DESC`)
    .limit(1);
  const v = rows[0]?.idealCycleTime;
  return v && Number(v) > 0 ? Number(v) : null;
}

/**
 * Live OEE for every active machine. Returns one entry per machine; factors are
 * null where data is absent. This is the canonical backing for `getAllOEE`.
 */
export async function getAllMachinesOEELive(params?: {
  windowHours?: number;
}): Promise<LiveOEEMetrics[]> {
  const db = await getDb();
  if (!db) return [];
  const windowHours = params?.windowHours ?? 24;
  const from = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  // MON-F7 (doc 40) — SET-BASED fleet OEE. The old path fanned out one
  // getMachineOEELive per machine, each doing a full status-log scan + a
  // daily_statistics query + an ideal read-back — i.e. N+1 × several ≈ ~300
  // queries/min for a 100-machine fleet on the 60s broadcaster. This computes the
  // whole fleet with a FIXED handful of grouped queries (machine list + status
  // durations + production + ideal, +1 target when OEE_IDEAL_FROM_TARGET),
  // regardless of fleet size. Result shape is identical to the per-machine path.

  // 1) Active machines.
  const machineRows = await db.select({ id: machines.id, code: machines.code })
    .from(machines)
    .where(eq(machines.isActive, true));
  if (machineRows.length === 0) return [];

  // 2) Availability — online/offline seconds per machine from machine_status_logs,
  //    computed set-based with a window LEAD. Mirrors getMachineUptimeStats exactly:
  //    only rows inside the window count, and the last row's interval extends to
  //    NOW() (open-ended current state).
  const durationRows = executeRows(await db.execute(sql`
    WITH ordered AS (
      SELECT "machineId" AS machine_id, status, "timestamp" AS ts,
             LEAD("timestamp") OVER (PARTITION BY "machineId" ORDER BY "timestamp") AS next_ts
      FROM machine_status_logs
      WHERE "timestamp" >= ${from.toISOString()}
    )
    SELECT machine_id,
      COALESCE(SUM(CASE WHEN status = 'online'
        THEN EXTRACT(EPOCH FROM (COALESCE(next_ts, NOW()) - ts)) ELSE 0 END), 0)::float AS online_sec,
      COALESCE(SUM(CASE WHEN status <> 'online'
        THEN EXTRACT(EPOCH FROM (COALESCE(next_ts, NOW()) - ts)) ELSE 0 END), 0)::float AS offline_sec
    FROM ordered
    GROUP BY machine_id
  `)) as Array<{ machine_id: number; online_sec: number; offline_sec: number }>;
  const uptimeByMachine = new Map<number, { online: number; offline: number }>();
  for (const r of durationRows) {
    uptimeByMachine.set(Number(r.machine_id), {
      online: Math.round(Number(r.online_sec) || 0),
      offline: Math.round(Number(r.offline_sec) || 0),
    });
  }

  // 3) Production counts + observed avg cycle per machine from daily_statistics.
  const statRows = executeRows(await db.execute(sql`
    SELECT "machineId" AS machine_id,
      COALESCE(SUM("totalCount"), 0)::int  AS total,
      COALESCE(SUM("okCount"), 0)::int     AS ok,
      COALESCE(SUM("ngCount"), 0)::int     AS ng,
      COALESCE(SUM("ntfCount"), 0)::int    AS ntf,
      AVG(NULLIF("avgCycleTime", 0))::float AS avg_cycle
    FROM daily_statistics
    WHERE "date" >= ${from.toISOString()}
    GROUP BY "machineId"
  `)) as Array<{ machine_id: number; total: number; ok: number; ng: number; ntf: number; avg_cycle: number | null }>;
  const prodByMachine = new Map<number, { total: number; ok: number; ng: number; ntf: number; avgCycle: number | null }>();
  for (const r of statRows) {
    prodByMachine.set(Number(r.machine_id), {
      total: Number(r.total) || 0,
      ok: Number(r.ok) || 0,
      ng: Number(r.ng) || 0,
      ntf: Number(r.ntf) || 0,
      avgCycle: r.avg_cycle != null ? Number(r.avg_cycle) : null,
    });
  }

  // 4) Ideal cycle time per machine — latest persisted oee_metrics.idealCycleTime
  //    (DISTINCT ON), the same fallback source resolveIdealCycleTimeSec uses.
  const idealRows = executeRows(await db.execute(sql`
    SELECT DISTINCT ON ("machineId") "machineId" AS machine_id, "idealCycleTime" AS ideal
    FROM oee_metrics
    WHERE "idealCycleTime" IS NOT NULL
    ORDER BY "machineId", "timestamp" DESC
  `)) as Array<{ machine_id: number; ideal: number | null }>;
  const idealByMachine = new Map<number, number>();
  for (const r of idealRows) {
    const v = r.ideal != null ? Number(r.ideal) : 0;
    if (v > 0) idealByMachine.set(Number(r.machine_id), v);
  }

  // 4b) MON-F8 — PROACTIVE ideal from active OEE targets (implied ideal =
  //     observed avg cycle × targetPerformance). Gated OFF by default; when armed
  //     it wins over the oee_metrics read-back (per-machine, applied in step 5).
  let targetPerfByMachine: Map<number, number> | null = null;
  if (idealFromTargetEnabled()) {
    const now = new Date();
    const targetRows = executeRows(await db.execute(sql`
      SELECT DISTINCT ON ("machineId") "machineId" AS machine_id, "targetPerformance" AS perf
      FROM oee_targets
      WHERE "isActive" = true AND "machineId" IS NOT NULL AND "effectiveFrom" <= ${now.toISOString()}
      ORDER BY "machineId", "effectiveFrom" DESC
    `)) as Array<{ machine_id: number; perf: number | null }>;
    targetPerfByMachine = new Map<number, number>();
    for (const r of targetRows) {
      const p = r.perf != null ? Number(r.perf) : 0;
      if (p > 0) targetPerfByMachine.set(Number(r.machine_id), p);
    }
  }

  // 5) Assemble per machine (pure JS; SAME math as getMachineOEELive — honest N/A
  //    for any factor whose inputs are absent).
  const now = new Date();
  return machineRows.map((m) => {
    const up = uptimeByMachine.get(m.id) ?? { online: 0, offline: 0 };
    const prod = prodByMachine.get(m.id) ?? { total: 0, ok: 0, ng: 0, ntf: 0, avgCycle: null };

    const onlineSeconds = up.online;
    const offlineSeconds = up.offline;
    const totalStatusTime = onlineSeconds + offlineSeconds;
    const hasUptimeData = totalStatusTime > 0;
    const availability = hasUptimeData ? onlineSeconds / totalStatusTime : null;

    const totalCount = prod.total;
    const hasProductionData = totalCount > 0;
    const goodCount = prod.ok + prod.ntf;
    const quality = hasProductionData ? goodCount / totalCount : null;

    // Ideal: proactive target-implied first (if armed + observed avg present),
    // else last-known oee_metrics.
    let idealCycleTimeSec: number | null = null;
    if (targetPerfByMachine && prod.avgCycle && prod.avgCycle > 0) {
      const perf = targetPerfByMachine.get(m.id);
      if (perf && perf > 0) idealCycleTimeSec = prod.avgCycle * (perf / 10000);
    }
    if (idealCycleTimeSec == null) idealCycleTimeSec = idealByMachine.get(m.id) ?? null;

    let performance: number | null = null;
    if (idealCycleTimeSec && idealCycleTimeSec > 0 && hasProductionData && onlineSeconds > 0) {
      performance = Math.min(1, (idealCycleTimeSec * totalCount) / onlineSeconds);
    }

    const allFactors = availability !== null && performance !== null && quality !== null;
    const oee = allFactors ? availability! * performance! * quality! : null;

    return {
      machineId: m.id,
      machineCode: m.code,
      timestamp: now,
      availability: availability !== null ? pct(availability) : null,
      performance: performance !== null ? pct(performance) : null,
      quality: quality !== null ? pct(quality) : null,
      oee: oee !== null ? pct(oee) : null,
      details: {
        windowHours,
        onlineSeconds,
        offlineSeconds,
        totalCount,
        goodCount,
        rejectCount: prod.ng,
        idealCycleTimeSec,
        hasUptimeData,
        hasProductionData,
      },
    } satisfies LiveOEEMetrics;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// LINE-LEVEL OEE — rollup by production line over an explicit [from, to] window.
//
// doc 40 Wave 4c (§11 — MON supervisor "OEE theo LINE" + War-Room briefing).
// Same SEMI-E10 math as getMachineOEELive, but aggregated to the LINE grain by
// walking machines → stations → production_lines → workshops. Fully SET-BASED
// (a fixed handful of grouped queries regardless of fleet size — no N+1) and
// HONEST-NULL: any factor whose inputs are absent is null, and line OEE is null
// unless all three factors exist.
//
// Unlike getAllMachinesOEELive (trailing window from NOW), this accepts an
// explicit [from, to] so callers (War-Room "today"/per-shift briefing) can scope
// the exact period. Sources are identical: machine_status_logs (availability),
// daily_statistics (quality + performance numerator), oee_metrics.idealCycleTime
// (last-known ideal cycle time).
// ───────────────────────────────────────────────────────────────────────────

export interface LineOEEMetrics {
  lineId: number;
  lineName: string;
  availability: number | null; // %  online / (online + offline)
  performance: number | null;  // %  Σ(ideal·total) / Σonline over machines w/ ideal
  quality: number | null;      // %  (ok + ntf) / total
  oee: number | null;          // %  A × P × Q (null if any factor null)
  details: {
    from: Date;
    to: Date;
    machineCount: number;
    onlineSeconds: number;
    offlineSeconds: number;
    totalCount: number;
    goodCount: number;   // ok + ntf
    rejectCount: number; // ng
    hasUptimeData: boolean;
    hasProductionData: boolean;
    hasIdeal: boolean;
  };
}

export async function getLineOEE(params?: {
  lineId?: number;
  factoryId?: number;
  from?: Date;
  to?: Date;
}): Promise<LineOEEMetrics[]> {
  const db = await getDb();
  if (!db) return [];
  const to = params?.to ?? new Date();
  const from = params?.from ?? new Date(to.getTime() - 24 * 60 * 60 * 1000);
  if (to.getTime() <= from.getTime()) return [];

  // 1) Active machine → line map (optionally scoped to one line / one factory).
  const mapRows = executeRows(await db.execute(sql`
    SELECT m."id" AS machine_id, l."id" AS line_id, l."name" AS line_name
    FROM machines m
    JOIN stations s ON s."id" = m."stationId"
    JOIN production_lines l ON l."id" = s."lineId"
    JOIN workshops w ON w."id" = l."workshopId"
    WHERE m."isActive" = true
      ${params?.lineId ? sql`AND l."id" = ${params.lineId}` : sql``}
      ${params?.factoryId ? sql`AND w."factoryId" = ${params.factoryId}` : sql``}
  `)) as Array<{ machine_id: number; line_id: number; line_name: string }>;
  if (mapRows.length === 0) return [];

  const lineNameById = new Map<number, string>();
  const machineToLine = new Map<number, number>();
  const lineOrder: number[] = [];
  for (const r of mapRows) {
    const mid = Number(r.machine_id), lid = Number(r.line_id);
    machineToLine.set(mid, lid);
    if (!lineNameById.has(lid)) { lineNameById.set(lid, r.line_name); lineOrder.push(lid); }
  }

  // 2) Availability inputs — online/offline seconds per machine over [from, to].
  //    Mirrors getAllMachinesOEELive but with a closed upper bound: the current
  //    (open-ended) interval is clipped to `to`, not NOW().
  const durationRows = executeRows(await db.execute(sql`
    WITH ordered AS (
      SELECT "machineId" AS machine_id, status, "timestamp" AS ts,
             LEAD("timestamp") OVER (PARTITION BY "machineId" ORDER BY "timestamp") AS next_ts
      FROM machine_status_logs
      WHERE "timestamp" >= ${from.toISOString()} AND "timestamp" <= ${to.toISOString()}
    )
    SELECT machine_id,
      COALESCE(SUM(CASE WHEN status = 'online'
        THEN EXTRACT(EPOCH FROM (LEAST(COALESCE(next_ts, ${to.toISOString()}), ${to.toISOString()}) - ts)) ELSE 0 END), 0)::float AS online_sec,
      COALESCE(SUM(CASE WHEN status <> 'online'
        THEN EXTRACT(EPOCH FROM (LEAST(COALESCE(next_ts, ${to.toISOString()}), ${to.toISOString()}) - ts)) ELSE 0 END), 0)::float AS offline_sec
    FROM ordered
    GROUP BY machine_id
  `)) as Array<{ machine_id: number; online_sec: number; offline_sec: number }>;
  const uptimeByMachine = new Map<number, { online: number; offline: number }>();
  for (const r of durationRows) {
    uptimeByMachine.set(Number(r.machine_id), {
      online: Math.max(0, Math.round(Number(r.online_sec) || 0)),
      offline: Math.max(0, Math.round(Number(r.offline_sec) || 0)),
    });
  }

  // 3) Production counts per machine over [from, to].
  const statRows = executeRows(await db.execute(sql`
    SELECT "machineId" AS machine_id,
      COALESCE(SUM("totalCount"), 0)::int AS total,
      COALESCE(SUM("okCount"), 0)::int    AS ok,
      COALESCE(SUM("ngCount"), 0)::int    AS ng,
      COALESCE(SUM("ntfCount"), 0)::int   AS ntf
    FROM daily_statistics
    WHERE "date" >= ${from.toISOString()} AND "date" <= ${to.toISOString()}
    GROUP BY "machineId"
  `)) as Array<{ machine_id: number; total: number; ok: number; ng: number; ntf: number }>;
  const prodByMachine = new Map<number, { total: number; ok: number; ng: number; ntf: number }>();
  for (const r of statRows) {
    prodByMachine.set(Number(r.machine_id), {
      total: Number(r.total) || 0, ok: Number(r.ok) || 0,
      ng: Number(r.ng) || 0, ntf: Number(r.ntf) || 0,
    });
  }

  // 4) Ideal cycle time per machine — latest persisted oee_metrics.idealCycleTime.
  const idealRows = executeRows(await db.execute(sql`
    SELECT DISTINCT ON ("machineId") "machineId" AS machine_id, "idealCycleTime" AS ideal
    FROM oee_metrics
    WHERE "idealCycleTime" IS NOT NULL
    ORDER BY "machineId", "timestamp" DESC
  `)) as Array<{ machine_id: number; ideal: number | null }>;
  const idealByMachine = new Map<number, number>();
  for (const r of idealRows) {
    const v = r.ideal != null ? Number(r.ideal) : 0;
    if (v > 0) idealByMachine.set(Number(r.machine_id), v);
  }

  // 5) Aggregate per line (pure JS; honest-null for absent inputs).
  type Acc = {
    machineCount: number; online: number; offline: number;
    total: number; good: number; ng: number;
    perfNum: number; perfDen: number; hasIdeal: boolean;
  };
  const accByLine = new Map<number, Acc>();
  for (const lid of lineOrder) {
    accByLine.set(lid, {
      machineCount: 0, online: 0, offline: 0, total: 0, good: 0, ng: 0,
      perfNum: 0, perfDen: 0, hasIdeal: false,
    });
  }
  for (const [mid, lid] of machineToLine) {
    const acc = accByLine.get(lid);
    if (!acc) continue;
    acc.machineCount += 1;
    const up = uptimeByMachine.get(mid);
    if (up) { acc.online += up.online; acc.offline += up.offline; }
    const prod = prodByMachine.get(mid);
    if (prod) {
      acc.total += prod.total;
      acc.good += prod.ok + prod.ntf;
      acc.ng += prod.ng;
      // Performance numerator/denominator restricted to machines that HAVE an
      // ideal cycle time AND produced units (so a machine with no configured
      // ideal never silently deflates the line's performance).
      const ideal = idealByMachine.get(mid);
      if (ideal && ideal > 0 && prod.total > 0 && up && up.online > 0) {
        acc.perfNum += ideal * prod.total;
        acc.perfDen += up.online;
        acc.hasIdeal = true;
      }
    }
  }

  return lineOrder.map((lid) => {
    const a = accByLine.get(lid)!;
    const totalStatus = a.online + a.offline;
    const hasUptimeData = totalStatus > 0;
    const availability = hasUptimeData ? a.online / totalStatus : null;

    const hasProductionData = a.total > 0;
    const quality = hasProductionData ? a.good / a.total : null;

    let performance: number | null = null;
    if (a.hasIdeal && a.perfDen > 0) performance = Math.min(1, a.perfNum / a.perfDen);

    const allFactors = availability !== null && performance !== null && quality !== null;
    const oee = allFactors ? availability! * performance! * quality! : null;

    return {
      lineId: lid,
      lineName: lineNameById.get(lid) ?? `Line ${lid}`,
      availability: availability !== null ? pct(availability) : null,
      performance: performance !== null ? pct(performance) : null,
      quality: quality !== null ? pct(quality) : null,
      oee: oee !== null ? pct(oee) : null,
      details: {
        from, to,
        machineCount: a.machineCount,
        onlineSeconds: a.online,
        offlineSeconds: a.offline,
        totalCount: a.total,
        goodCount: a.good,
        rejectCount: a.ng,
        hasUptimeData,
        hasProductionData,
        hasIdeal: a.hasIdeal,
      },
    } satisfies LineOEEMetrics;
  });
}
