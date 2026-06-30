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
import { and, eq, gte, lte, isNotNull, sql } from "drizzle-orm";
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
 * Resolve an ideal cycle time (seconds/unit) for a machine.
 * Priority: explicit caller value → most-recent persisted oee_metrics.idealCycleTime
 * for this machine → null (no synthetic default).
 */
export async function resolveIdealCycleTimeSec(machineId: number): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
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

  const machineRows = await db.select({
    id: machines.id,
    code: machines.code,
  })
    .from(machines)
    .where(eq(machines.isActive, true));

  const results = await Promise.all(machineRows.map(async (m) => {
    const idealCycleTimeSec = await resolveIdealCycleTimeSec(m.id);
    return getMachineOEELive({
      machineId: m.id,
      machineCode: m.code,
      windowHours,
      idealCycleTimeSec,
    });
  }));

  return results;
}
