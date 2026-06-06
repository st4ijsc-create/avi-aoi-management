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
 */

import { getDb } from "../db/connection";
import { and, eq, gte, lte, isNotNull, sql } from "drizzle-orm";
import {
  downtimeEvents,
  oeeMetrics,
  oeeTargets,
  type InsertOEEMetric,
} from "../../drizzle/schema";

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
