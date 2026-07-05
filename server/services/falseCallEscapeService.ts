/**
 * False-call ↔ escape paired KPI — the core AOI tuning trade-off.
 * Doc 27 §6 gap A9 (P2), Đợt 5 item 5.2 (W5-A).
 *
 * ── Definitions (honest) ────────────────────────────────────────────────────
 * FALSE-CALL RATE — proxy from human verify results:
 *   machine NG calls  = product_inspections rows with originalResult = 'NG'
 *                       (the machine's original verdict, before human review)
 *   false calls       = of those, overallResult = 'NTF' (human cleared it)
 *   falseCallRate     = falseCalls / machineNgCalls × 100
 *   This is what productionDashboard exposed as `retestRate` (NTF/total) —
 *   renamed and re-based to NG calls because NTF/total is a share of ALL
 *   boards, not a rate of the machine's NG verdicts. It remains a PROXY: it
 *   only sees false calls an operator actually reviewed and cleared.
 *
 * ESCAPE RATE — from station_traces (stationTriangulation, gap G15):
 *   escaped serials = traces with firstEscapeStation IS NOT NULL (an
 *                     upstream station passed a unit a downstream station
 *                     failed)
 *   defect serials  = traces with totalDefects > 0
 *   escapeRate      = escapedSerials / defectSerials × 100
 *   SCOPE CAVEAT: station_traces has NO machine/line linkage (one row per
 *   serial across the whole line), so the escape side can only be scoped by
 *   product + window. The response carries `scope: "product_window"` so the
 *   UI can say so instead of implying per-machine escape attribution.
 *
 * TREND buckets are FACTORY-local days (utils/kpi.factoryDayTextSql — gap A2).
 *
 * ── Threshold / alarm wiring ────────────────────────────────────────────────
 * `yield_alert_thresholds` (drizzle/schema/alerts.ts) already has an `NTF`
 * metric type — its warning/critical levels are evaluated here against the
 * false-call rate and surfaced in the response (visual alarm). No push-alert
 * firing: `alertTypeEnum` (alert_settings) has no NTF/false-call type and the
 * threshold table has no evaluator job anywhere in the codebase — adding an
 * enum value would need a migration, which W5-A must not create. Documented
 * as visual-only.
 */
import { sql, eq, and, gte, lt, inArray, type SQL } from "drizzle-orm";
import { productInspections, stationTraces, yieldAlertThresholds } from "../../drizzle/schema";
import { getDb } from "../db/connection";
import { factoryDayTextSql } from "../utils/kpi";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

// ─── Types ──────────────────────────────────────────────────────────────────

export type TuningHint =
  | "overSensitive"    // false calls ↑ while escapes ↓ → thresholds too tight
  | "underSensitive"   // false calls ↓ while escapes ↑ → thresholds too loose
  | "processDrift"     // both ↑ → likely a real process problem, not tuning
  | "improving"        // both ↓
  | "stable"
  | "insufficientData";

export interface FalseCallTrendPoint {
  day: string; // factory-local YYYY-MM-DD
  machineNgCalls: number;
  falseCalls: number;
  falseCallRate: number | null;
}

export interface EscapeTrendPoint {
  day: string; // factory-local YYYY-MM-DD (trace lastSeenAt)
  tracedSerials: number;
  defectSerials: number;
  escapedSerials: number;
  escapeRate: number | null;
}

export interface FalseCallEscapeKpi {
  falseCall: {
    totalInspections: number;
    machineNgCalls: number;
    falseCalls: number;
    confirmedNg: number;
    /** % of machine NG calls a human cleared as NTF. Null when no NG calls. */
    falseCallRate: number | null;
    trend: FalseCallTrendPoint[];
  };
  escape: {
    /** False when no station_traces rows exist in scope (feature not fed). */
    available: boolean;
    tracedSerials: number;
    defectSerials: number;
    escapedSerials: number;
    totalEscapes: number;
    /** % of defective serials whose defect escaped an upstream station. */
    escapeRate: number | null;
    /** station_traces has no machine/line linkage — see module docblock. */
    scope: "product_window";
    trend: EscapeTrendPoint[];
  };
  tuningHint: TuningHint;
  threshold: {
    source: "yield_alert_thresholds:NTF" | null;
    warning: number | null;
    critical: number | null;
    comparisonOperator: string | null;
    /** Evaluated on falseCallRate; null when no enabled NTF threshold row. */
    level: "ok" | "warning" | "critical" | null;
    /** Honest note: no push-alert path exists for this metric (visual only). */
    visualOnly: true;
  };
}

export interface FalseCallEscapeParams {
  startDate: Date;
  /** End-exclusive when resolved from a date-only string (kpi helper). */
  endDate: Date;
  machineIds?: number[];
  productModelId?: number;
}

// ─── Pure helpers (unit-tested) ─────────────────────────────────────────────

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Tuning-tradeoff hint from the two daily-rate series. Compares the mean of
 * the first half vs the second half of each series with a 1-percentage-point
 * deadband. Needs ≥4 false-call points AND ≥4 escape points — otherwise
 * "insufficientData" (we refuse to over-read two data points).
 */
export function computeTuningHint(
  falseCallRates: Array<number | null>,
  escapeRates: Array<number | null>,
): TuningHint {
  const fc = falseCallRates.filter((v): v is number => v != null);
  const esc = escapeRates.filter((v): v is number => v != null);
  if (fc.length < 4 || esc.length < 4) return "insufficientData";

  const half = (xs: number[]) => {
    const mid = Math.floor(xs.length / 2);
    return { first: avg(xs.slice(0, mid))!, second: avg(xs.slice(mid))! };
  };
  const f = half(fc);
  const e = half(esc);
  const DEADBAND = 1; // percentage points

  const fcUp = f.second - f.first > DEADBAND;
  const fcDown = f.first - f.second > DEADBAND;
  const escUp = e.second - e.first > DEADBAND;
  const escDown = e.first - e.second > DEADBAND;

  if (fcUp && escDown) return "overSensitive";
  if (fcDown && escUp) return "underSensitive";
  if (fcUp && escUp) return "processDrift";
  if (fcDown && escDown) return "improving";
  return "stable";
}

type CompareOp = "gt" | "lt" | "gte" | "lte";

function satisfies(value: number, op: CompareOp, threshold: number): boolean {
  switch (op) {
    case "gt": return value > threshold;
    case "lt": return value < threshold;
    case "gte": return value >= threshold;
    case "lte": return value <= threshold;
  }
}

/**
 * Threshold semantics follow yield_alert_thresholds convention: the operator
 * describes the HEALTHY direction (e.g. NTF row with `lte` + warning 10 =
 * healthy while rate <= 10). Breach = NOT satisfying the comparison.
 */
export function evaluateThresholdLevel(
  rate: number | null,
  row: { warningThreshold: string | number; criticalThreshold: string | number; comparisonOperator: string } | null,
): "ok" | "warning" | "critical" | null {
  // No threshold row OR no computable rate → nothing to evaluate (null).
  if (!row || rate == null) return null;
  const op = (["gt", "lt", "gte", "lte"].includes(row.comparisonOperator)
    ? row.comparisonOperator
    : "lte") as CompareOp;
  const warning = Number(row.warningThreshold);
  const critical = Number(row.criticalThreshold);
  if (Number.isFinite(critical) && !satisfies(rate, op, critical)) return "critical";
  if (Number.isFinite(warning) && !satisfies(rate, op, warning)) return "warning";
  return "ok";
}

function pct(numerator: number, denominator: number): number | null {
  if (!(denominator > 0)) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export async function getFalseCallEscapeKpi(
  params: FalseCallEscapeParams,
): Promise<FalseCallEscapeKpi> {
  const db = await getDb();
  const empty: FalseCallEscapeKpi = {
    falseCall: {
      totalInspections: 0,
      machineNgCalls: 0,
      falseCalls: 0,
      confirmedNg: 0,
      falseCallRate: null,
      trend: [],
    },
    escape: {
      available: false,
      tracedSerials: 0,
      defectSerials: 0,
      escapedSerials: 0,
      totalEscapes: 0,
      escapeRate: null,
      scope: "product_window",
      trend: [],
    },
    tuningHint: "insufficientData",
    threshold: {
      source: null,
      warning: null,
      critical: null,
      comparisonOperator: null,
      level: null,
      visualOnly: true,
    },
  };
  if (!db) return empty;
  // Filters resolved to an empty machine set → honest empty result.
  if (params.machineIds && params.machineIds.length === 0) return empty;

  // ── False-call side (product_inspections) ─────────────────────────────────
  const inspConditions: SQL[] = [
    gte(productInspections.inspectionTime, params.startDate),
    lt(productInspections.inspectionTime, params.endDate),
  ];
  if (params.machineIds && params.machineIds.length > 0) {
    inspConditions.push(inArray(productInspections.machineId, params.machineIds));
  }
  if (params.productModelId) {
    inspConditions.push(eq(productInspections.productModelId, params.productModelId));
  }

  const machineNgCallExpr = sql<number>`COUNT(*) FILTER (WHERE ${productInspections.originalResult} = 'NG')`;
  const falseCallExpr = sql<number>`COUNT(*) FILTER (WHERE ${productInspections.originalResult} = 'NG' AND ${productInspections.overallResult} = 'NTF')`;
  const confirmedNgExpr = sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} = 'NG')`;

  const dayBucket = factoryDayTextSql(productInspections.inspectionTime);

  const [totals, trendRows, thresholdRows] = await Promise.all([
    db
      .select({
        total: sql<number>`COUNT(*)`,
        machineNgCalls: machineNgCallExpr,
        falseCalls: falseCallExpr,
        confirmedNg: confirmedNgExpr,
      })
      .from(productInspections)
      .where(and(...inspConditions)),
    db
      .select({
        day: sql<string>`${dayBucket}`.as("day"),
        machineNgCalls: machineNgCallExpr,
        falseCalls: falseCallExpr,
      })
      .from(productInspections)
      .where(and(...inspConditions))
      .groupBy(dayBucket)
      .orderBy(dayBucket),
    db
      .select()
      .from(yieldAlertThresholds)
      .where(and(eq(yieldAlertThresholds.metricType, "NTF"), eq(yieldAlertThresholds.isEnabled, true)))
      .limit(1),
  ]);

  const t = totals[0] ?? { total: 0, machineNgCalls: 0, falseCalls: 0, confirmedNg: 0 };
  const machineNgCalls = Number(t.machineNgCalls) || 0;
  const falseCalls = Number(t.falseCalls) || 0;
  const falseCallRate = pct(falseCalls, machineNgCalls);

  const falseCallTrend: FalseCallTrendPoint[] = trendRows.map((r) => {
    const ngCalls = Number(r.machineNgCalls) || 0;
    const fc = Number(r.falseCalls) || 0;
    return {
      day: String(r.day),
      machineNgCalls: ngCalls,
      falseCalls: fc,
      falseCallRate: pct(fc, ngCalls),
    };
  });

  // ── Escape side (station_traces — product/window scope only) ──────────────
  const traceConditions: SQL[] = [
    gte(stationTraces.lastSeenAt, params.startDate),
    lt(stationTraces.lastSeenAt, params.endDate),
  ];
  if (params.productModelId) {
    traceConditions.push(eq(stationTraces.productModelId, params.productModelId));
  }

  const escapedExpr = sql<number>`COUNT(*) FILTER (WHERE ${stationTraces.firstEscapeStation} IS NOT NULL)`;
  const defectiveExpr = sql<number>`COUNT(*) FILTER (WHERE ${stationTraces.totalDefects} > 0)`;
  const traceDayBucket = factoryDayTextSql(stationTraces.lastSeenAt);

  const [escTotalsRows, escTrendRows] = await Promise.all([
    db
      .select({
        traced: sql<number>`COUNT(*)`,
        defective: defectiveExpr,
        escaped: escapedExpr,
        totalEscapes: sql<number>`COALESCE(SUM(${stationTraces.totalEscapes}), 0)`,
      })
      .from(stationTraces)
      .where(and(...traceConditions)),
    db
      .select({
        day: sql<string>`${traceDayBucket}`.as("day"),
        traced: sql<number>`COUNT(*)`,
        defective: defectiveExpr,
        escaped: escapedExpr,
      })
      .from(stationTraces)
      .where(and(...traceConditions))
      .groupBy(traceDayBucket)
      .orderBy(traceDayBucket),
  ]);

  const e = escTotalsRows[0] ?? { traced: 0, defective: 0, escaped: 0, totalEscapes: 0 };
  const tracedSerials = Number(e.traced) || 0;
  const defectSerials = Number(e.defective) || 0;
  const escapedSerials = Number(e.escaped) || 0;

  const escapeTrend: EscapeTrendPoint[] = escTrendRows.map((r) => {
    const defective = Number(r.defective) || 0;
    const escaped = Number(r.escaped) || 0;
    return {
      day: String(r.day),
      tracedSerials: Number(r.traced) || 0,
      defectSerials: defective,
      escapedSerials: escaped,
      escapeRate: pct(escaped, defective),
    };
  });

  // ── Threshold + hint ───────────────────────────────────────────────────────
  const thresholdRow = thresholdRows[0] ?? null;
  const level = evaluateThresholdLevel(falseCallRate, thresholdRow);

  return {
    falseCall: {
      totalInspections: Number(t.total) || 0,
      machineNgCalls,
      falseCalls,
      confirmedNg: Number(t.confirmedNg) || 0,
      falseCallRate,
      trend: falseCallTrend,
    },
    escape: {
      available: tracedSerials > 0,
      tracedSerials,
      defectSerials,
      escapedSerials,
      totalEscapes: Number(e.totalEscapes) || 0,
      escapeRate: pct(escapedSerials, defectSerials),
      scope: "product_window",
      trend: escapeTrend,
    },
    tuningHint: computeTuningHint(
      falseCallTrend.map((p) => p.falseCallRate),
      escapeTrend.map((p) => p.escapeRate),
    ),
    threshold: {
      source: thresholdRow ? "yield_alert_thresholds:NTF" : null,
      warning: thresholdRow ? Number(thresholdRow.warningThreshold) : null,
      critical: thresholdRow ? Number(thresholdRow.criticalThreshold) : null,
      comparisonOperator: thresholdRow ? thresholdRow.comparisonOperator : null,
      level,
      visualOnly: true,
    },
  };
}
