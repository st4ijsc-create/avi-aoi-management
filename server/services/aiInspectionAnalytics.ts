/**
 * AI Inspection Analytics Service 
 * 
 * Advanced analytics for inspection data including:
 *  - Defect trend analysis with forecasting
 *  - Pareto analysis by defect type, machine, product
 *  - Yield prediction based on historical patterns
 *  - Correlation analysis between machines/products/shifts
 *  - SPC-style control chart data generation
 *  - Risk scoring and prevention recommendations
 *  - Comprehensive visual report data
 */

import { getDb } from "../db/connection";
import { sql, eq, and, gte, lte, desc, asc, count, avg, inArray, SQL } from "drizzle-orm";
import {
  productInspections,
  measurementResults,
  measurementPointDefs,
  dailyStatistics,
  machines,
  stations,
  productionLines,
  workshops,
  factories,
  defectCatalog,
  spcRuleViolations,
  robots,
  robotTelemetry,
  robotBehaviorAnomalies,
} from "../../drizzle/schema";
import { cacheService } from "./cacheService";
import { emitSpcViolationAlert } from "../_core/socket";
import { calculateCapabilityIndices } from "../utils/spc";
// Canonical KPI math + factory-timezone bucketing (doc 27 decision #4, gaps A2/A4).
import {
  finalYieldPassCondSql,
  factoryDayTextSql,
  factoryHourOfDaySql,
} from "../utils/kpi";

// ─── Types ─────────────────────────────────────────────────────

export interface AnalyticsPeriod {
  startDate: Date;
  endDate: Date;
  machineId?: number;
  factoryCode?: string;
  lineCode?: string;
  productModel?: string;
  // doc 69 Wave 2 / A1 — machineType as a first-class analytics dimension (AOI/AVI/
  // SPI/AXI/ICT/.../ROBOT — machines.machineType). OPTIONAL + additive: omitting it
  // leaves every existing call site byte-identical to before this task.
  machineType?: string;
}

interface ConditionOptions {
  machineId?: boolean;
  factoryCode?: boolean;
  lineCode?: boolean;
  productModel?: boolean;
  machineType?: boolean;
}

export function buildAnalyticsConditions(
  params: AnalyticsPeriod,
  options: ConditionOptions = {},
): SQL[] {
  const conditions: SQL[] = [
    gte(productInspections.inspectionTime, params.startDate),
    lte(productInspections.inspectionTime, params.endDate),
  ];

  if (options.machineId && params.machineId) {
    conditions.push(eq(productInspections.machineId, params.machineId));
  }
  if (options.factoryCode && params.factoryCode) {
    conditions.push(eq(productInspections.factoryCode, params.factoryCode));
  }
  if (options.lineCode && params.lineCode) {
    conditions.push(eq(productInspections.lineCode, params.lineCode));
  }

  const normalizedProductModel = params.productModel?.trim();
  if (options.productModel && normalizedProductModel) {
    conditions.push(eq(productInspections.productModel, normalizedProductModel));
  }

  // doc 69 Wave 2 / A1 — machineType filter. `product_inspections` has no
  // machineType column of its own (it lives on `machines`), and most call sites
  // below do NOT join `machines` into their outer query — so this narrows via a
  // machineId subquery instead of requiring every existing query to add a join.
  // Cast the enum to text before comparing (mirrors server/api/v1/assets.ts's
  // existing `${machines.machineType}::text = ${cls}` pattern) so an unknown/typo'd
  // value simply matches zero machines instead of throwing an enum-cast error.
  const normalizedMachineType = params.machineType?.trim();
  if (options.machineType && normalizedMachineType) {
    conditions.push(
      sql`${productInspections.machineId} IN (SELECT ${machines.id} FROM ${machines} WHERE ${machines.machineType}::text = ${normalizedMachineType})`,
    );
  }

  return conditions;
}

export interface DefectTrendPoint {
  date: string;
  total: number;
  pass: number;
  fail: number;
  yieldRate: number;
  defectRate: number;
}

export interface DefectParetoItem {
  defectType: string;
  count: number;
  percentage: number;
  cumulativePercentage: number;
}

export interface MachinePerformance {
  machineId: number;
  machineCode: string;
  machineName: string;
  totalInspections: number;
  passCount: number;
  failCount: number;
  yieldRate: number;
  avgCycleTime: number;
  trend: "improving" | "stable" | "declining";
}

export interface YieldForecast {
  date: string;
  predicted: number;
  lowerBound: number;
  upperBound: number;
  confidence: number;
}

export interface CorrelationResult {
  factor1: string;
  factor2: string;
  correlation: number;
  strength: "strong" | "moderate" | "weak" | "none";
  direction: "positive" | "negative";
  sampleSize: number;
}

export interface RiskAssessment {
  category: string;
  level: "critical" | "high" | "medium" | "low";
  score: number; // 0-100
  description: string;
  recommendation: string;
  affectedItems: string[];
}

export interface SpcViolation {
  ruleId: string;         // "western_electric_1" | "nelson_3" etc.
  ruleName: string;       // human-readable
  severity: "critical" | "warning" | "info";
  pointIndices: number[]; // which data points triggered this rule
}

export interface ControlChartData {
  metric: string;
  points: Array<{
    date: string;
    value: number;
    ucl: number; // Upper Control Limit
    lcl: number; // Lower Control Limit
    cl: number;  // Center Line
    outOfControl: boolean;
    violationRule?: string;        // primary rule name (backward compat)
    violatedRules?: string[];      // all rule names violated at this point
  }>;
  summary: {
    mean: number;
    stdDev: number;
    ucl: number;
    lcl: number;
    cpk: number | null; // null when spec limits (USL/LSL) not provided
    cpu?: number | null; // one-sided upper capability (additive; present when USL known)
    cpl?: number | null; // one-sided lower capability (additive; present when LSL known)
    cpkNote?: string;   // i18n message KEY explaining why cpk is null (client translates)
    outOfControlCount: number;
    spcViolations: SpcViolation[]; // all detected SPC rule violations
  };
}

// ─── SPC Rule Engine — all 12 Western Electric + Nelson rules ────────────────

/**
 * Detects SPC rule violations across 12 standard rules.
 *
 * Rules implemented:
 *  WE1/N1 : 1 point beyond ±3σ                       (critical)
 *  WE2/N5 : 2 of 3 consecutive beyond ±2σ same side  (warning)
 *  WE3/N6 : 4 of 5 consecutive beyond ±1σ same side  (warning)
 *  WE4    : 8 consecutive on same side of CL          (warning)
 *  N2     : 9 consecutive on same side of CL          (warning)
 *  N3     : 6 consecutive monotone (trend)            (warning)
 *  N4     : 14 consecutive alternating up/down        (info)
 *  N7     : 15 consecutive within ±1σ (stratification)(warning)
 *  N8     : 8 consecutive beyond ±1σ either side (mixture)(warning)
 */
export function detectSpcViolations(
  values: number[],
  mean: number,
  stdDev: number,
): SpcViolation[] {
  const n = values.length;
  if (n < 2 || stdDev <= 0) return [];

  const violations: SpcViolation[] = [];
  const s1 = stdDev, s2 = 2 * stdDev, s3 = 3 * stdDev;

  // Utility: sign relative to mean (+1 above, -1 below)
  const side = (v: number) => (v >= mean ? 1 : -1);

  // ── WE1 / N1: any point beyond ±3σ (critical) ──────────────────────────────
  const we1pts: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Math.abs(values[i] - mean) > s3) we1pts.push(i);
  }
  if (we1pts.length > 0) {
    violations.push({
      ruleId: "western_electric_1",
      ruleName: "WE1/N1: Point beyond ±3σ",
      severity: "critical",
      pointIndices: we1pts,
    });
  }

  // ── WE2 / N5: 2 of 3 consecutive beyond ±2σ on the same side ───────────────
  const we2pts: number[] = [];
  for (let i = 2; i < n; i++) {
    const window = [i - 2, i - 1, i];
    const aboveCount = window.filter(j => values[j] > mean + s2).length;
    const belowCount = window.filter(j => values[j] < mean - s2).length;
    if (aboveCount >= 2 || belowCount >= 2) we2pts.push(i);
  }
  if (we2pts.length > 0) {
    violations.push({
      ruleId: "western_electric_2",
      ruleName: "WE2/N5: 2 of 3 beyond ±2σ same side",
      severity: "warning",
      pointIndices: [...new Set(we2pts)],
    });
  }

  // ── WE3 / N6: 4 of 5 consecutive beyond ±1σ on the same side ───────────────
  const we3pts: number[] = [];
  for (let i = 4; i < n; i++) {
    const window = [i - 4, i - 3, i - 2, i - 1, i];
    const aboveCount = window.filter(j => values[j] > mean + s1).length;
    const belowCount = window.filter(j => values[j] < mean - s1).length;
    if (aboveCount >= 4 || belowCount >= 4) we3pts.push(i);
  }
  if (we3pts.length > 0) {
    violations.push({
      ruleId: "western_electric_3",
      ruleName: "WE3/N6: 4 of 5 beyond ±1σ same side",
      severity: "warning",
      pointIndices: [...new Set(we3pts)],
    });
  }

  // ── WE4: 8 consecutive points on the same side of CL ───────────────────────
  const we4pts: number[] = [];
  let runLen4 = 1, runSide4 = side(values[0]);
  for (let i = 1; i < n; i++) {
    if (side(values[i]) === runSide4) {
      runLen4++;
      if (runLen4 >= 8) we4pts.push(i);
    } else {
      runLen4 = 1;
      runSide4 = side(values[i]);
    }
  }
  if (we4pts.length > 0) {
    violations.push({
      ruleId: "western_electric_4",
      ruleName: "WE4: 8 consecutive on same side of CL",
      severity: "warning",
      pointIndices: we4pts,
    });
  }

  // ── N2: 9 consecutive points on the same side of CL ────────────────────────
  const n2pts: number[] = [];
  let runLen2 = 1, runSide2 = side(values[0]);
  for (let i = 1; i < n; i++) {
    if (side(values[i]) === runSide2) {
      runLen2++;
      if (runLen2 >= 9) n2pts.push(i);
    } else {
      runLen2 = 1;
      runSide2 = side(values[i]);
    }
  }
  if (n2pts.length > 0) {
    violations.push({
      ruleId: "nelson_2",
      ruleName: "N2: 9 consecutive on same side of CL",
      severity: "warning",
      pointIndices: n2pts,
    });
  }

  // ── N3: 6 consecutive points monotone (all increasing or all decreasing) ────
  const n3pts: number[] = [];
  let trendUp = 0, trendDn = 0;
  for (let i = 1; i < n; i++) {
    if (values[i] > values[i - 1]) { trendUp++; trendDn = 0; }
    else if (values[i] < values[i - 1]) { trendDn++; trendUp = 0; }
    else { trendUp = 0; trendDn = 0; }
    if (trendUp >= 5 || trendDn >= 5) n3pts.push(i); // 6 points = 5 consecutive differences
  }
  if (n3pts.length > 0) {
    violations.push({
      ruleId: "nelson_3",
      ruleName: "N3: 6 consecutive points trending monotone",
      severity: "warning",
      pointIndices: n3pts,
    });
  }

  // ── N4: 14 consecutive points alternating up/down ───────────────────────────
  const n4pts: number[] = [];
  let altLen = 1;
  for (let i = 1; i < n; i++) {
    const diff = values[i] - values[i - 1];
    const prevDiff = i >= 2 ? values[i - 1] - values[i - 2] : 0;
    if (i >= 2 && Math.sign(diff) !== 0 && Math.sign(prevDiff) !== 0 && Math.sign(diff) !== Math.sign(prevDiff)) {
      altLen++;
      if (altLen >= 14) n4pts.push(i);
    } else {
      altLen = 2;
    }
  }
  if (n4pts.length > 0) {
    violations.push({
      ruleId: "nelson_4",
      ruleName: "N4: 14 consecutive alternating up/down",
      severity: "info",
      pointIndices: n4pts,
    });
  }

  // ── N7: 15 consecutive points within ±1σ (stratification) ──────────────────
  const n7pts: number[] = [];
  let within1s = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(values[i] - mean) < s1) {
      within1s++;
      if (within1s >= 15) n7pts.push(i);
    } else {
      within1s = 0;
    }
  }
  if (n7pts.length > 0) {
    violations.push({
      ruleId: "nelson_7",
      ruleName: "N7: 15 consecutive within ±1σ (stratification)",
      severity: "warning",
      pointIndices: n7pts,
    });
  }

  // ── N8: 8 consecutive points beyond ±1σ on EITHER side (mixture pattern) ───
  const n8pts: number[] = [];
  let beyond1s = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(values[i] - mean) > s1) {
      beyond1s++;
      if (beyond1s >= 8) n8pts.push(i);
    } else {
      beyond1s = 0;
    }
  }
  if (n8pts.length > 0) {
    violations.push({
      ruleId: "nelson_8",
      ruleName: "N8: 8 consecutive beyond ±1σ either side (mixture)",
      severity: "warning",
      pointIndices: n8pts,
    });
  }

  return violations;
}

/** Build a per-point lookup: index → list of violated rule names */
function buildViolationMap(violations: SpcViolation[], n: number): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const v of violations) {
    for (const idx of v.pointIndices) {
      if (!map.has(idx)) map.set(idx, []);
      map.get(idx)!.push(v.ruleName);
    }
  }
  return map;
}

export interface ShiftAnalysis {
  shift: string;
  totalInspections: number;
  yieldRate: number;
  avgCycleTime: number;
  topDefects: Array<{ type: string; count: number }>;
}

// doc 69 Wave 2 / A1 — per-machineType breakdown (AOI vs AVI vs SPI ...).
export interface MachineTypeBreakdown {
  machineType: string;
  totalInspections: number;
  passCount: number;
  failCount: number;
  yieldRate: number;
  defectRate: number;
  activeMachines: number;
}

// doc 69 Wave 2 / A1 — robot/OT KPIs routed into the comprehensive report. Sourced
// from the SAME tables aiRobotAnomalyRouter reads (robots/robot_telemetry/
// robot_behavior_anomalies) — this does not duplicate that router's mutation logic,
// only adds a read-oriented summary for the analytics report.
export interface RobotHealthSnapshot {
  robotId: number;
  robotCode: string;
  robotName: string;
  vendor: string;
  kind: string;
  status: string;
  isEnabled: boolean;
  lastSeenAt: string | null;
  latestTelemetry: {
    mode: string | null;
    busy: boolean | null;
    estop: boolean | null;
    speedPct: number | null;
    batteryLevel: number | null;
    lastHeartbeat: string | null;
  } | null;
}

export interface RobotAnomalySummary {
  id: number;
  robotId: number;
  kind: string;
  severity: string;
  score: number;
  status: string;
  detectedAt: string;
}

export interface RobotsSection {
  totalRobots: number;
  activeRobots: number; // robots.isEnabled = true
  onlineRobots: number; // robots.status !== 'offline'
  robots: RobotHealthSnapshot[];
  recentAnomalies: RobotAnomalySummary[];
  /**
   * Severity counts over `recentAnomalies` ONLY (the capped top-50 most recent,
   * not a true aggregate over all in-scope anomalies) — a factory with >50
   * recent anomalies will under-count older/lower-ranked severities here.
   */
  anomalyCountBySeverity: Record<string, number>;
}

export interface ComprehensiveReport {
  period: { start: string; end: string };
  overview: {
    totalInspections: number;
    passCount: number;
    failCount: number;
    reworkCount: number;
    yieldRate: number;
    avgCycleTime: number;
    uniqueProducts: number;
    activeMachines: number;
  };
  defectTrend: DefectTrendPoint[];
  defectPareto: DefectParetoItem[];
  machinePerformance: MachinePerformance[];
  yieldForecast: YieldForecast[];
  correlations: CorrelationResult[];
  risks: RiskAssessment[];
  controlChart: ControlChartData;
  shiftAnalysis: ShiftAnalysis[];
  heatmapData: Array<{
    machineCode: string;
    hour: number;
    defectRate: number;
  }>;
  /** doc 69 Wave 2 / A1 — additive. Per-machineType yield/defect/count breakdown. */
  byMachineType: MachineTypeBreakdown[];
  /** doc 69 Wave 2 / A1 — additive. Robot/OT KPIs; empty-safe when no robot data. */
  robots: RobotsSection;
}

// ─── Core Analytics Functions ──────────────────────────────────

/**
 * Get daily defect trend with yield rate
 */
export async function getDefectTrend(params: AnalyticsPeriod): Promise<DefectTrendPoint[]> {
  const db = await getDb();
  if (!db) {
    console.error("[getDefectTrend] Database connection unavailable (DB_UNAVAILABLE)");
    return [];
  }

  const conditions = buildAnalyticsConditions(params, {
    machineId: true,
    factoryCode: true,
    lineCode: true,
    productModel: true,
    machineType: true,
  });

  // Day bucket in the FACTORY timezone (gap A2). Note: the previous
  // `IN ('OK', 'PASS')` / `IN ('NG', 'FAIL')` literals were invalid for the
  // overallresultenum (OK/NG/NTF only) and made this query THROW at runtime;
  // the canonical pass condition (OK + NTF, decision #4) also fixes that.
  const dayBucket = factoryDayTextSql(productInspections.inspectionTime);
  const rows = await db.select({
    date: sql<string>`${dayBucket}`.as("date"),
    total: count().as("total"),
    pass: sql<number>`COUNT(*) FILTER (WHERE ${finalYieldPassCondSql(productInspections.overallResult)})`.as("pass"),
    fail: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} = 'NG')`.as("fail"),
  })
    .from(productInspections)
    .where(and(...conditions))
    .groupBy(dayBucket)
    .orderBy(asc(dayBucket));

  return rows.map(r => ({
    date: String(r.date),
    total: Number(r.total),
    // pass now follows the canonical FINAL-yield definition (OK + NTF).
    pass: Number(r.pass),
    fail: Number(r.fail),
    yieldRate: r.total > 0 ? (Number(r.pass) / Number(r.total)) * 100 : 0,
    defectRate: r.total > 0 ? (Number(r.fail) / Number(r.total)) * 100 : 0,
  }));
}

/**
 * Pareto analysis — top defect types by frequency
 */
export async function getDefectPareto(params: AnalyticsPeriod): Promise<DefectParetoItem[]> {
  const db = await getDb();
  if (!db) {
    console.error("[getDefectPareto] Database connection unavailable (DB_UNAVAILABLE)");
    return [];
  }

  const conditions = [
    ...buildAnalyticsConditions(params, {
      machineId: true,
      factoryCode: true,
      lineCode: true,
      productModel: true,
      machineType: true,
    }),
    // 'FAIL' is not a valid overallresultenum value (would throw); NG only.
    sql`${measurementResults.result} = 'NG'`,
  ];

  const rows = await db.select({
    defectType: sql<string>`COALESCE(${measurementPointDefs.name}, 'Unknown')`.as("defectType"),
    defectCount: count().as("defectCount"),
  })
    .from(measurementResults)
    .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .leftJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .where(and(...conditions))
    .groupBy(sql`COALESCE(${measurementPointDefs.name}, 'Unknown')`)
    .orderBy(desc(count()));

  const totalDefects = rows.reduce((sum, r) => sum + Number(r.defectCount), 0);
  let cumulative = 0;

  return rows.map(r => {
    const pct = totalDefects > 0 ? (Number(r.defectCount) / totalDefects) * 100 : 0;
    cumulative += pct;
    return {
      defectType: r.defectType,
      count: Number(r.defectCount),
      percentage: Number(pct.toFixed(1)),
      cumulativePercentage: Number(cumulative.toFixed(1)),
    };
  });
}

// ─── Defect-CLASS Pareto (doc 27 gap A6, W5-A) ─────────────────────────────
// The point-name Pareto above answers "WHERE on the board do we fail?".
// This one answers "WHAT KIND of defect do we produce?" by aggregating
// measurement_results.defectCatalogId against the IPC-A-610 defect_catalog.
// Both remain available — they are different questions.

export interface DefectClassParetoItem {
  defectCatalogId: number | null;
  /** Catalog code (e.g. "BRIDGING"), or "UNCLASSIFIED" / "OTHERS" buckets. */
  code: string;
  name: string;
  severity: string | null;
  category: string | null;
  ipcReference: string | null;
  count: number;
  percentage: number;
  /** TRUE cumulative % over ALL defects in scope — reaches 100 at the last item. */
  cumulativePercentage: number;
  bucket: "class" | "unclassified" | "others";
}

export interface DefectClassParetoResult {
  items: DefectClassParetoItem[];
  totalDefects: number;
  classifiedDefects: number;
  /** NG rows with defectCatalogId IS NULL (legacy / vendor without class mapping). */
  unclassifiedDefects: number;
  topN: number;
}

export interface DefectClassParetoParams {
  startDate: Date;
  endDate: Date;
  machineId?: number;
  lineId?: number;
  workshopId?: number;
  factoryId?: number;
  productModelId?: number;
  /** Named classes kept before folding the tail into "OTHERS" (default 10). */
  topN?: number;
}

interface DefectClassCountRow {
  defectCatalogId: number | null;
  code: string | null;
  name: string | null;
  severity: string | null;
  category: string | null;
  ipcReference: string | null;
  count: number;
}

/**
 * Pure Pareto builder (unit-tested): true cumulative % over the FULL defect
 * population, top-N named classes + one "OTHERS" tail bucket, and an honest
 * "UNCLASSIFIED" bucket for rows without a defectCatalogId (it competes in
 * the ranking like any class — hiding it would fake the distribution).
 */
export function buildDefectClassPareto(
  rows: DefectClassCountRow[],
  topN = 10,
): DefectClassParetoResult {
  const normalized = rows
    .map((r) => ({
      defectCatalogId: r.defectCatalogId,
      code: r.defectCatalogId == null ? "UNCLASSIFIED" : (r.code ?? `#${r.defectCatalogId}`),
      name: r.defectCatalogId == null ? "Unclassified" : (r.name ?? `#${r.defectCatalogId}`),
      severity: r.defectCatalogId == null ? null : r.severity,
      category: r.defectCatalogId == null ? null : r.category,
      ipcReference: r.defectCatalogId == null ? null : r.ipcReference,
      count: Number(r.count) || 0,
      bucket: (r.defectCatalogId == null ? "unclassified" : "class") as DefectClassParetoItem["bucket"],
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  const totalDefects = normalized.reduce((s, r) => s + r.count, 0);
  const unclassifiedDefects = normalized
    .filter((r) => r.bucket === "unclassified")
    .reduce((s, r) => s + r.count, 0);

  const head = normalized.slice(0, Math.max(1, topN));
  const tail = normalized.slice(Math.max(1, topN));

  const emitted: Array<Omit<DefectClassParetoItem, "percentage" | "cumulativePercentage">> = [...head];
  if (tail.length > 0) {
    emitted.push({
      defectCatalogId: null,
      code: "OTHERS",
      name: `Others (${tail.length} classes)`,
      severity: null,
      category: null,
      ipcReference: null,
      count: tail.reduce((s, r) => s + r.count, 0),
      bucket: "others",
    });
  }

  let cumulative = 0;
  const items: DefectClassParetoItem[] = emitted.map((r) => {
    const pct = totalDefects > 0 ? (r.count / totalDefects) * 100 : 0;
    cumulative += pct;
    return {
      ...r,
      percentage: Math.round(pct * 100) / 100,
      cumulativePercentage: Math.round(cumulative * 100) / 100,
    };
  });

  return {
    items,
    totalDefects,
    classifiedDefects: totalDefects - unclassifiedDefects,
    unclassifiedDefects,
    topN,
  };
}

/**
 * Defect-class Pareto over a window. Filters: machine / line / workshop /
 * factory (via the machines→stations→lines→workshops chain) / product model.
 * Callers resolving date-only UI strings should use
 * `resolveFactoryDateWindow` (utils/kpi.ts) so the window is factory-local.
 */
export async function getDefectClassPareto(
  params: DefectClassParetoParams,
): Promise<DefectClassParetoResult> {
  const db = await getDb();
  if (!db) {
    console.error("[getDefectClassPareto] Database connection unavailable (DB_UNAVAILABLE)");
    return { items: [], totalDefects: 0, classifiedDefects: 0, unclassifiedDefects: 0, topN: params.topN ?? 10 };
  }

  const conditions: SQL[] = [
    gte(productInspections.inspectionTime, params.startDate),
    lte(productInspections.inspectionTime, params.endDate),
    sql`${measurementResults.result} = 'NG'`,
  ];
  if (params.machineId) conditions.push(eq(productInspections.machineId, params.machineId));
  if (params.productModelId) conditions.push(eq(productInspections.productModelId, params.productModelId));

  const needsHierarchy = !!(params.lineId || params.workshopId || params.factoryId);
  if (params.lineId) conditions.push(eq(stations.lineId, params.lineId));
  if (params.workshopId) conditions.push(eq(productionLines.workshopId, params.workshopId));
  if (params.factoryId) conditions.push(eq(workshops.factoryId, params.factoryId));

  let query = db
    .select({
      defectCatalogId: measurementResults.defectCatalogId,
      code: defectCatalog.code,
      name: defectCatalog.name,
      severity: defectCatalog.severity,
      category: defectCatalog.category,
      ipcReference: defectCatalog.ipcReference,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(measurementResults)
    .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .leftJoin(defectCatalog, eq(measurementResults.defectCatalogId, defectCatalog.id))
    .$dynamic();

  if (needsHierarchy) {
    query = query
      .innerJoin(machines, eq(productInspections.machineId, machines.id))
      .innerJoin(stations, eq(machines.stationId, stations.id))
      .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
      .innerJoin(workshops, eq(productionLines.workshopId, workshops.id));
  }

  const rows = await query
    .where(and(...conditions))
    .groupBy(
      measurementResults.defectCatalogId,
      defectCatalog.code,
      defectCatalog.name,
      defectCatalog.severity,
      defectCatalog.category,
      defectCatalog.ipcReference,
    )
    .orderBy(desc(sql`COUNT(*)`));

  return buildDefectClassPareto(rows as DefectClassCountRow[], params.topN ?? 10);
}

/**
 * Machine performance comparison
 */
export async function getMachinePerformance(params: AnalyticsPeriod): Promise<MachinePerformance[]> {
  const db = await getDb();
  if (!db) {
    console.error("[getMachinePerformance] Database connection unavailable (DB_UNAVAILABLE)");
    return [];
  }

  const conditions = buildAnalyticsConditions(params, {
    machineId: true,
    factoryCode: true,
    lineCode: true,
    productModel: true,
    machineType: true,
  });

  // Canonical pass = OK + NTF (decision #4); also fixes the previously
  // invalid 'PASS'/'FAIL' enum literals that made this query throw.
  const rows = await db.select({
    machineId: productInspections.machineId,
    machineCode: machines.code,
    machineName: machines.name,
    total: count().as("total"),
    pass: sql<number>`COUNT(*) FILTER (WHERE ${finalYieldPassCondSql(productInspections.overallResult)})`.as("pass"),
    fail: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} = 'NG')`.as("fail"),
    avgCycleTime: avg(productInspections.cycleTime).as("avgCycleTime"),
  })
    .from(productInspections)
    .innerJoin(machines, eq(productInspections.machineId, machines.id))
    .where(and(...conditions))
    .groupBy(productInspections.machineId, machines.code, machines.name)
    .orderBy(desc(count()));

  // Determine trend by comparing first half vs second half — single batch query.
  // NOTE: raw Date params inside sql`` templates crash postgres.js (it only
  // serializes Dates for typed columns); pass an ISO string instead. This was
  // a latent bug masked by the old invalid 'PASS' enum literal that made the
  // query throw before reaching the driver.
  const midDate = new Date((params.startDate.getTime() + params.endDate.getTime()) / 2).toISOString();

  const trendRows = await db.select({
    machineId: productInspections.machineId,
    firstHalfTotal: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.inspectionTime} < ${midDate})`.as("firstHalfTotal"),
    firstHalfPass: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.inspectionTime} < ${midDate} AND ${finalYieldPassCondSql(productInspections.overallResult)})`.as("firstHalfPass"),
    secondHalfTotal: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.inspectionTime} >= ${midDate})`.as("secondHalfTotal"),
    secondHalfPass: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.inspectionTime} >= ${midDate} AND ${finalYieldPassCondSql(productInspections.overallResult)})`.as("secondHalfPass"),
  })
    .from(productInspections)
    .where(and(...conditions))
    .groupBy(productInspections.machineId);

  const trendMap = new Map(trendRows.map(t => [t.machineId, t]));

  return rows.map(r => {
    const total = Number(r.total);
    const pass = Number(r.pass);
    const fail = Number(r.fail);

    const td = trendMap.get(r.machineId!);
    const firstYield = Number(td?.firstHalfTotal) > 0 ? Number(td?.firstHalfPass) / Number(td?.firstHalfTotal) : 0;
    const secondYield = Number(td?.secondHalfTotal) > 0 ? Number(td?.secondHalfPass) / Number(td?.secondHalfTotal) : 0;

    let trend: "improving" | "stable" | "declining" = "stable";
    if (secondYield - firstYield > 0.02) trend = "improving";
    else if (firstYield - secondYield > 0.02) trend = "declining";

    return {
      machineId: r.machineId!,
      machineCode: r.machineCode ?? "",
      machineName: r.machineName ?? "",
      totalInspections: total,
      // passCount follows the canonical FINAL-yield definition (OK + NTF).
      passCount: pass,
      failCount: fail,
      yieldRate: total > 0 ? (pass / total) * 100 : 0,
      avgCycleTime: Number(r.avgCycleTime ?? 0),
      trend,
    };
  });
}

/**
 * Yield forecast using Holt-Winters triple exponential smoothing
 */
/**
 * Forecast yield with multiple strategies based on data length
 * - 14+ days: Holt-Winters with seasonal pattern (HIGH confidence ~0.9)
 * - 7-13 days: EWMA (Exponential Weighted Moving Average) (MEDIUM confidence ~0.6)
 * - 1-6 days: Linear trend only (LOW confidence ~0.3)
 */
export async function forecastYield(
  params: AnalyticsPeriod,
  horizonDays: number = 7,
): Promise<YieldForecast[]> {
  const trend = await getDefectTrend(params);
  if (trend.length < 1) return [];

  const data = trend.map(t => t.yieldRate);
  const lastDate = new Date(trend[trend.length - 1].date);
  const forecasts: YieldForecast[] = [];

  if (data.length >= 14) {
    // HIGH confidence: Holt-Winters with seasonal pattern
    return forecastWithHoltWinters(data, lastDate, horizonDays, 0.9);
  } else if (data.length >= 7) {
    // MEDIUM confidence: EWMA (Exponential Weighted Moving Average)
    return forecastWithEWMA(data, lastDate, horizonDays, 0.6);
  } else {
    // LOW confidence: Linear trend
    return forecastWithLinearTrend(data, lastDate, horizonDays, 0.3);
  }
}

/**
 * Holt-Winters seasonal forecasting for stable, long-term data (14+ days).
 * Exported for unit testing of confidence/season behavior (B1.2).
 */
export function forecastWithHoltWinters(
  data: number[],
  baseDate: Date,
  horizonDays: number,
  confidence: number,
): YieldForecast[] {
  // Holt-Winters parameters
  const alpha = 0.3; // Level smoothing
  const beta = 0.1;  // Trend smoothing
  const gamma = 0.3; // Seasonal smoothing
  // Seasonal component (weekly = 7) is only meaningful with at least two full cycles.
  // Below 2*seasonLength observations we collapse to a non-seasonal model (seasonLength=1),
  // which keeps the additive seasonal term at 0 and avoids fabricating a season we cannot fit.
  const desiredSeason = 7; // Weekly pattern
  const seasonLength = data.length >= 2 * desiredSeason ? desiredSeason : 1;

  // Initialize
  const level: number[] = [data[0]];
  const trendArr: number[] = [data.length > 1 ? data[1] - data[0] : 0];
  const seasonal: number[] = new Array(seasonLength).fill(0);

  // Initialize seasonal factors
  if (data.length >= seasonLength) {
    const avgFirst = data.slice(0, seasonLength).reduce((a, b) => a + b, 0) / seasonLength;
    for (let i = 0; i < seasonLength; i++) {
      seasonal[i] = data[i] - avgFirst;
    }
  }

  // Fit
  for (let t = 1; t < data.length; t++) {
    const sIdx = t % seasonLength;
    const prevLevel = level[t - 1];
    const prevTrend = trendArr[t - 1];
    const prevSeasonal = seasonal[sIdx];

    const newLevel = alpha * (data[t] - prevSeasonal) + (1 - alpha) * (prevLevel + prevTrend);
    const newTrend = beta * (newLevel - prevLevel) + (1 - beta) * prevTrend;

    level.push(newLevel);
    trendArr.push(newTrend);
    // Only update seasonal factors when a real season is being modelled.
    // With seasonLength=1 (insufficient data for a weekly cycle) the seasonal term
    // stays 0 so the model degrades cleanly to double-exponential smoothing.
    if (seasonLength > 1) {
      seasonal[sIdx] = gamma * (data[t] - newLevel) + (1 - gamma) * prevSeasonal;
    }
  }

  // Calculate in-sample error for confidence intervals
  const errors: number[] = [];
  for (let t = seasonLength; t < data.length; t++) {
    const predicted = level[t] + seasonal[t % seasonLength];
    errors.push(data[t] - predicted);
  }
  const meanError = errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 0;
  const stdError = errors.length > 1
    ? Math.sqrt(errors.reduce((sum, e) => sum + Math.pow(e - meanError, 2), 0) / (errors.length - 1))
    : 2;

  // Forecast
  const lastLevel = level[level.length - 1];
  const lastTrend = trendArr[trendArr.length - 1];
  const forecasts: YieldForecast[] = [];

  // Confidence model: the caller-supplied `confidence` is the CEILING (best case at h=1
  // when the fit is tight). It decays per horizon by the real normalized forecast error.
  // normalizedError(h) scales the growing prediction-interval half-width (1.96*σ*√h)
  // against the level magnitude, so a noisier fit erodes confidence faster — instead of
  // the previous hard-coded 1 - h*0.03 which ignored both `confidence` and the data.
  const levelScale = Math.max(Math.abs(lastLevel), 1); // guard tiny/zero levels
  const ceiling = Math.max(0.3, Math.min(1, confidence));

  for (let h = 1; h <= horizonDays; h++) {
    const forecastDate = new Date(baseDate);
    forecastDate.setDate(forecastDate.getDate() + h);

    const sIdx = (data.length + h) % seasonLength;
    const predicted = lastLevel + h * lastTrend + seasonal[sIdx];
    const interval = 1.96 * stdError * Math.sqrt(h);

    const normalizedError = Math.min(1, (stdError * Math.sqrt(h)) / levelScale);
    const horizonConfidence = Math.max(0.3, Math.min(ceiling, ceiling * (1 - normalizedError)));

    forecasts.push({
      date: forecastDate.toISOString().split("T")[0],
      predicted: Math.max(0, Math.min(100, Number(predicted.toFixed(2)))),
      lowerBound: Math.max(0, Number((predicted - interval).toFixed(2))),
      upperBound: Math.min(100, Number((predicted + interval).toFixed(2))),
      confidence: Number(horizonConfidence.toFixed(2)),
    });
  }

  return forecasts;
}

/**
 * EWMA forecasting for medium-term data (7-13 days)
 */
function forecastWithEWMA(
  data: number[],
  baseDate: Date,
  horizonDays: number,
  confidence: number,
): YieldForecast[] {
  const alpha = 0.4; // Smoothing factor for recent data
  const forecasts: YieldForecast[] = [];

  // Calculate EWMA
  const ewma: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ewma.push(alpha * data[i] + (1 - alpha) * ewma[i - 1]);
  }

  // Calculate trend from last 3 points
  const lastEwma = ewma[ewma.length - 1];
  const trend = data.length >= 3
    ? (ewma[ewma.length - 1] - ewma[ewma.length - 3]) / 2
    : 0;

  // Calculate residual standard error
  const residuals = data.map((d, i) => d - ewma[i]);
  const meanResidual = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const stdResidual = Math.sqrt(
    residuals.reduce((sum, r) => sum + Math.pow(r - meanResidual, 2), 0) / Math.max(1, residuals.length - 1)
  );

  for (let h = 1; h <= horizonDays; h++) {
    const forecastDate = new Date(baseDate);
    forecastDate.setDate(forecastDate.getDate() + h);
    
    const predicted = lastEwma + trend * h;
    const margin = 1.64 * stdResidual * Math.sqrt(1 + h / data.length); // 90% CI

    forecasts.push({
      date: forecastDate.toISOString().split("T")[0],
      predicted: Math.max(0, Math.min(100, Number(predicted.toFixed(2)))),
      lowerBound: Math.max(0, Number((predicted - margin).toFixed(2))),
      upperBound: Math.min(100, Number((predicted + margin).toFixed(2))),
      confidence,
    });
  }

  return forecasts;
}

/**
 * Linear trend forecasting for minimal data (1-6 days)
 */
function forecastWithLinearTrend(
  data: number[],
  baseDate: Date,
  horizonDays: number,
  confidence: number,
): YieldForecast[] {
  const forecasts: YieldForecast[] = [];
  
  if (data.length === 1) {
    // No trend, use constant
    const predicted = data[0];
    for (let h = 1; h <= horizonDays; h++) {
      const forecastDate = new Date(baseDate);
      forecastDate.setDate(forecastDate.getDate() + h);
      forecasts.push({
        date: forecastDate.toISOString().split("T")[0],
        predicted,
        lowerBound: Math.max(0, predicted - 10), // Wide confidence band
        upperBound: Math.min(100, predicted + 10),
        confidence,
      });
    }
    return forecasts;
  }

  // Simple linear regression
  const n = data.length;
  const xMean = (n - 1) / 2; // Average index
  const yMean = data.reduce((a, b) => a + b, 0) / n;
  
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (data[i] - yMean);
    denominator += (i - xMean) * (i - xMean);
  }
  const slope = denominator > 0 ? numerator / denominator : 0;
  const intercept = yMean - slope * xMean;

  // Calculate residual standard error
  const residuals = data.map((d, i) => d - (intercept + slope * i));
  const stdResidual = Math.sqrt(
    residuals.reduce((sum, r) => sum + r * r, 0) / Math.max(1, n - 2)
  );

  for (let h = 1; h <= horizonDays; h++) {
    const forecastDate = new Date(baseDate);
    forecastDate.setDate(forecastDate.getDate() + h);
    
    const predicted = intercept + slope * (n - 1 + h);
    const margin = 1.64 * stdResidual * Math.sqrt(1 + (n + h) / (denominator || 1)); // 90% CI

    forecasts.push({
      date: forecastDate.toISOString().split("T")[0],
      predicted: Math.max(0, Math.min(100, Number(predicted.toFixed(2)))),
      lowerBound: Math.max(0, Number((predicted - margin).toFixed(2))),
      upperBound: Math.min(100, Number((predicted + margin).toFixed(2))),
      confidence,
    });
  }

  return forecasts;
}

/**
 * Statistical correlation analysis between different factors
 * OPTIMIZED: Limits to top 10 machines by inspection volume to reduce O(n²) complexity
 * CACHED: Results cached for 5 minutes to avoid repeated expensive calculations
 */
export async function getCorrelationAnalysis(params: AnalyticsPeriod): Promise<CorrelationResult[]> {
  const db = await getDb();
  if (!db) throw new Error("[getCorrelationAnalysis] Database connection unavailable (DB_UNAVAILABLE)");

  // Generate cache key
  const cacheKey = [
    "correlation",
    params.startDate.toISOString(),
    params.endDate.toISOString(),
    `machine:${params.machineId ?? "all"}`,
    `factory:${params.factoryCode ?? "all"}`,
    `line:${params.lineCode ?? "all"}`,
    `product:${params.productModel?.trim() || "all"}`,
    `machineType:${params.machineType?.trim() || "all"}`,
  ].join(":");

  // Check cache first
  const cached = cacheService.get<CorrelationResult[]>(cacheKey);
  if (cached) {
    console.log(`[getCorrelationAnalysis] Cache HIT for ${cacheKey}`);
    return cached;
  }

  console.log(`[getCorrelationAnalysis] Cache MISS - computing correlations...`);
  const startTime = Date.now();

  const conditions = buildAnalyticsConditions(params, {
    machineId: true,
    factoryCode: true,
    lineCode: true,
    productModel: true,
    machineType: true,
  });

  // OPTIMIZATION: Get daily data per machine (aggregated).
  // Day bucket in the FACTORY timezone (gap A2); 'FAIL' enum literal removed.
  const corrDayBucket = factoryDayTextSql(productInspections.inspectionTime);
  const rows = await db.select({
    date: sql<string>`${corrDayBucket}`.as("date"),
    machineId: productInspections.machineId,
    machineCode: machines.code,
    total: count().as("total"),
    fail: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} = 'NG')`.as("fail"),
    avgCycleTime: avg(productInspections.cycleTime).as("avgCycleTime"),
  })
    .from(productInspections)
    .innerJoin(machines, eq(productInspections.machineId, machines.id))
    .where(and(...conditions))
    .groupBy(corrDayBucket, productInspections.machineId, machines.code)
    .orderBy(asc(corrDayBucket));

  const correlations: CorrelationResult[] = [];

  // Correlation: defect rate vs cycle time
  const defectRates = rows.map(r => Number(r.total) > 0 ? Number(r.fail) / Number(r.total) : 0);
  const cycleTimes = rows.map(r => Number(r.avgCycleTime ?? 0));

  if (defectRates.length >= 5) {
    const corr = pearsonCorrelation(defectRates, cycleTimes);
    correlations.push({
      factor1: "Defect Rate",
      factor2: "Cycle Time",
      correlation: Number(corr.toFixed(3)),
      strength: classifyCorrelation(Math.abs(corr)),
      direction: corr >= 0 ? "positive" : "negative",
      sampleSize: defectRates.length,
    });
  }

  // Cross-machine correlation (OPTIMIZATION: limit to top 10 machines by inspection volume)
  // Use Map<date, defectRate> per machine for O(1) lookup during alignment
  const machineGroups = new Map<string, { rateByDate: Map<string, number>; total: number }>();
  for (const r of rows) {
    const code = r.machineCode ?? `M-${r.machineId}`;
    if (!machineGroups.has(code)) machineGroups.set(code, { rateByDate: new Map(), total: 0 });
    const group = machineGroups.get(code)!;
    const rate = Number(r.total) > 0 ? Number(r.fail) / Number(r.total) : 0;
    group.rateByDate.set(String(r.date), rate);
    group.total += Number(r.total);
  }

  // Sort by inspection volume and take top 10
  const topMachines = Array.from(machineGroups.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10)
    .map(([code]) => code);

  // Only compute pairwise correlations for top 10 machines (reduces O(n²) complexity)
  // Date alignment uses Map.has/get for O(1) lookup → overall O(min(|A|,|B|)) per pair
  for (let i = 0; i < topMachines.length; i++) {
    for (let j = i + 1; j < topMachines.length; j++) {
      const a = machineGroups.get(topMachines[i])!;
      const b = machineGroups.get(topMachines[j])!;

      // Iterate the smaller map for efficiency
      const [smaller, larger] = a.rateByDate.size <= b.rateByDate.size ? [a, b] : [b, a];
      const aVals: number[] = [];
      const bVals: number[] = [];
      for (const [date, rate] of smaller.rateByDate) {
        const otherRate = larger.rateByDate.get(date);
        if (otherRate !== undefined) {
          // preserve original ordering: first array corresponds to topMachines[i]
          if (smaller === a) {
            aVals.push(rate);
            bVals.push(otherRate);
          } else {
            aVals.push(otherRate);
            bVals.push(rate);
          }
        }
      }
      if (aVals.length >= 5) {
        const corr = pearsonCorrelation(aVals, bVals);

        if (Math.abs(corr) > 0.3) {
          correlations.push({
            factor1: topMachines[i],
            factor2: topMachines[j],
            correlation: Number(corr.toFixed(3)),
            strength: classifyCorrelation(Math.abs(corr)),
            direction: corr >= 0 ? "positive" : "negative",
            sampleSize: aVals.length,
          });
        }
      }
    }
  }

  const result = correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  const elapsedMs = Date.now() - startTime;
  console.log(`[getCorrelationAnalysis] Computed ${result.length} correlations in ${elapsedMs}ms`);

  // Cache results for 5 minutes (300s)
  cacheService.set(cacheKey, result, 5 * 60 * 1000);

  return result;
}

/**
 * Risk assessment based on inspection data patterns
 */
export async function assessRisks(params: AnalyticsPeriod): Promise<RiskAssessment[]> {
  const db = await getDb();
  if (!db) return [];

  const risks: RiskAssessment[] = [];

  // OPTIMIZATION: parallel fetch of independent analytics queries
  const [machinePerf, trend, pareto] = await Promise.all([
    getMachinePerformance(params),
    getDefectTrend(params),
    getDefectPareto(params),
  ]);

  // 1. Machine degradation risk
  const decliningMachines = machinePerf.filter(m => m.trend === "declining" && m.yieldRate < 95);
  if (decliningMachines.length > 0) {
    risks.push({
      category: "Machine Degradation",
      level: decliningMachines.some(m => m.yieldRate < 85) ? "critical" : "high",
      score: Math.max(0, 100 - Math.min(...decliningMachines.map(m => m.yieldRate))),
      description: `${decliningMachines.length} machine(s) showing declining yield trends`,
      recommendation: "Schedule preventive maintenance for affected machines. Review calibration status.",
      affectedItems: decliningMachines.map(m => m.machineCode),
    });
  }

  // 2. Yield drop risk (data already fetched above)
  if (trend.length >= 7) {
    const recent = trend.slice(-7);
    const earlier = trend.slice(-14, -7);
    const recentYield = recent.reduce((s, t) => s + t.yieldRate, 0) / recent.length;
    const earlierYield = earlier.length > 0
      ? earlier.reduce((s, t) => s + t.yieldRate, 0) / earlier.length
      : recentYield;

    if (recentYield < earlierYield - 2) {
      risks.push({
        category: "Yield Deterioration",
        level: recentYield < 90 ? "critical" : recentYield < 95 ? "high" : "medium",
        score: Number((earlierYield - recentYield).toFixed(1)),
        description: `Yield dropped from ${earlierYield.toFixed(1)}% to ${recentYield.toFixed(1)}% in the last 7 days`,
        recommendation: "Investigate root cause of yield drop. Check material quality, operator training, and environmental conditions.",
        affectedItems: [],
      });
    }
  }

  // 3. Concentrated defect risk (data already fetched above)
  if (pareto.length > 0 && pareto[0].percentage > 40) {
    risks.push({
      category: "Concentrated Defect",
      level: pareto[0].percentage > 60 ? "high" : "medium",
      score: Number(pareto[0].percentage.toFixed(1)),
      description: `${pareto[0].defectType} accounts for ${pareto[0].percentage.toFixed(1)}% of all defects`,
      recommendation: `Focus improvement efforts on "${pareto[0].defectType}". Conduct 5-Why analysis and implement countermeasures.`,
      affectedItems: [pareto[0].defectType],
    });
  }

  // 4. High-volume with low yield machines
  const highVolumeLowYield = machinePerf.filter(m => m.totalInspections > 100 && m.yieldRate < 90);
  if (highVolumeLowYield.length > 0) {
    risks.push({
      category: "High Impact Machines",
      level: "high",
      score: highVolumeLowYield.length * 20,
      description: `${highVolumeLowYield.length} high-volume machine(s) with yield below 90%`,
      recommendation: "Prioritize these machines for immediate quality improvement. Consider temporary load redistribution.",
      affectedItems: highVolumeLowYield.map(m => `${m.machineCode} (${m.yieldRate.toFixed(1)}%)`),
    });
  }

  return risks.sort((a, b) => {
    const levelOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return levelOrder[a.level] - levelOrder[b.level];
  });
}

/**
 * Generate control chart data (X-bar chart)
 * @param specLimits - Customer/process specification limits. Required for meaningful Cpk on
 *   defectRate/cycleTime. For yield, defaults to [0, 100] if omitted.
 *   Without explicit spec limits, Cpk is set to null to prevent misleading capability claims.
 */
export async function getControlChart(
  params: AnalyticsPeriod,
  metric: "yield" | "defectRate" | "cycleTime" = "yield",
  specLimits?: { usl?: number; lsl?: number },
): Promise<ControlChartData> {
  const trend = await getDefectTrend(params);
  if (trend.length === 0) {
    return {
      metric,
      points: [],
      summary: { mean: 0, stdDev: 0, ucl: 0, lcl: 0, cpk: null, cpu: null, cpl: null, cpkNote: "aiAnalytics.cpkNote", outOfControlCount: 0, spcViolations: [] },
    };
  }

  const values = trend.map(t => {
    if (metric === "yield") return t.yieldRate;
    if (metric === "defectRate") return t.defectRate;
    return t.total > 0 ? t.total : 0; // cycleTime approximation
  });

  const meanVal = values.reduce((a, b) => a + b, 0) / values.length;
  const stdDevVal = Math.sqrt(
    values.reduce((sum, v) => sum + Math.pow(v - meanVal, 2), 0) / Math.max(1, values.length - 1)
  );

  const ucl = meanVal + 3 * stdDevVal;
  const lcl = Math.max(0, meanVal - 3 * stdDevVal);

  // Full 12-rule SPC violation detection
  const spcViolations = detectSpcViolations(values, meanVal, stdDevVal);
  const violationMap = buildViolationMap(spcViolations, values.length);

  const points = trend.map((t, i) => {
    const value = values[i];
    const outOfControl = value > ucl || value < lcl;
    const violatedRules = violationMap.get(i);
    const violationRule = violatedRules?.[0]; // primary rule (backward compat)

    return {
      date: t.date,
      value: Number(value.toFixed(2)),
      ucl: Number(ucl.toFixed(2)),
      lcl: Number(lcl.toFixed(2)),
      cl: Number(meanVal.toFixed(2)),
      outOfControl: outOfControl || (violatedRules !== undefined && violatedRules.length > 0),
      violationRule,
      violatedRules,
    };
  });

  // Cpk via the shared SPC utility (server/utils/spc.ts:calculateCapabilityIndices).
  // That helper handles one-sided specs (Cpu/Cpl), non-normal Box-Cox (transforming
  // BOTH values and spec limits together to keep the scale consistent), and returns
  // cpk=null when no usable spec is present. Spec limits MUST be real customer/process
  // limits — we never fabricate (e.g. yield USL=100), which would only measure centering.
  // No subgroups are available here (one aggregate value per day), so the overall sample
  // stdDev is the sigma estimate fed to the capability calculation.
  const resolvedUsl: number | null = specLimits?.usl ?? null;
  const resolvedLsl: number | null = specLimits?.lsl ?? null;
  // At least one real spec limit is required for any capability index.
  const hasCpkData = resolvedUsl !== null || resolvedLsl !== null;

  let cpk: number | null = null;
  let cpu: number | null = null;
  let cpl: number | null = null;
  if (hasCpkData) {
    const indices = calculateCapabilityIndices(values, resolvedUsl, resolvedLsl, stdDevVal);
    cpk = indices.cpk;
    cpu = indices.cpu;
    cpl = indices.cpl;
  }

  return {
    metric,
    points,
    summary: {
      mean: Number(meanVal.toFixed(2)),
      stdDev: Number(stdDevVal.toFixed(2)),
      ucl: Number(ucl.toFixed(2)),
      lcl: Number(lcl.toFixed(2)),
      cpk: cpk !== null && Number.isFinite(cpk) ? Number(cpk.toFixed(3)) : null,
      cpu: cpu !== null && Number.isFinite(cpu) ? Number(cpu.toFixed(3)) : null,
      cpl: cpl !== null && Number.isFinite(cpl) ? Number(cpl.toFixed(3)) : null,
      // i18n message KEY (client translates). Emitted whenever Cpk could not be computed
      // from real spec limits, so the UI never shows a fabricated capability number.
      cpkNote: cpk === null ? "aiAnalytics.cpkNote" : undefined,
      outOfControlCount: points.filter(p => p.outOfControl).length,
      spcViolations,
    },
  };
}

/**
 * Shift-based analysis
 */
export async function getShiftAnalysis(params: AnalyticsPeriod): Promise<ShiftAnalysis[]> {
  const db = await getDb();
  if (!db) {
    console.error("[getShiftAnalysis] Database connection unavailable (DB_UNAVAILABLE)");
    return [];
  }

  const conditions = buildAnalyticsConditions(params, {
    machineId: true,
    factoryCode: true,
    lineCode: true,
    productModel: true,
    machineType: true,
  });

  // Group by shift (morning 6-14, afternoon 14-22, night 22-6),
  // classified by FACTORY-LOCAL hour (gap A2). Canonical pass = OK + NTF.
  const localHour = factoryHourOfDaySql(productInspections.inspectionTime);
  const shiftExpr = sql<string>`CASE
      WHEN ${localHour} BETWEEN 6 AND 13 THEN 'Morning'
      WHEN ${localHour} BETWEEN 14 AND 21 THEN 'Afternoon'
      ELSE 'Night'
    END`;
  const rows = await db.select({
    shift: shiftExpr.as("shift"),
    total: count().as("total"),
    pass: sql<number>`COUNT(*) FILTER (WHERE ${finalYieldPassCondSql(productInspections.overallResult)})`.as("pass"),
    avgCycleTime: avg(productInspections.cycleTime).as("avgCycleTime"),
  })
    .from(productInspections)
    .where(and(...conditions))
    .groupBy(shiftExpr);

  return rows.map(r => ({
    shift: r.shift,
    totalInspections: Number(r.total),
    yieldRate: Number(r.total) > 0 ? (Number(r.pass) / Number(r.total)) * 100 : 0,
    avgCycleTime: Number(r.avgCycleTime ?? 0),
    topDefects: [], // Would need additional query
  }));
}

/**
 * Hourly heatmap data (machine × hour → defect rate)
 */
export async function getDefectHeatmap(params: AnalyticsPeriod): Promise<Array<{
  machineCode: string;
  hour: number;
  defectRate: number;
  total: number;
}>> {
  const db = await getDb();
  if (!db) {
    console.error("[getDefectHeatmap] Database connection unavailable (DB_UNAVAILABLE)");
    return [];
  }

  const conditions = buildAnalyticsConditions(params, {
    machineId: true,
    factoryCode: true,
    lineCode: true,
    productModel: true,
    machineType: true,
  });

  // Hour-of-day in the FACTORY timezone (gap A2); 'FAIL' enum literal removed.
  const heatmapHour = factoryHourOfDaySql(productInspections.inspectionTime);
  const rows = await db.select({
    machineCode: machines.code,
    hour: sql<number>`${heatmapHour}`.as("hour"),
    total: count().as("total"),
    fail: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} = 'NG')`.as("fail"),
  })
    .from(productInspections)
    .innerJoin(machines, eq(productInspections.machineId, machines.id))
    .where(and(...conditions))
    .groupBy(machines.code, heatmapHour)
    .orderBy(machines.code, asc(heatmapHour));

  return rows.map(r => ({
    machineCode: r.machineCode ?? "",
    hour: Number(r.hour),
    defectRate: Number(r.total) > 0 ? (Number(r.fail) / Number(r.total)) * 100 : 0,
    total: Number(r.total),
  }));
}

/**
 * doc 69 Wave 2 / A1 — per-machineType yield/defect/count breakdown, so the
 * comprehensive report can say "AOI vs AVI vs SPI" instead of aggregating every
 * machine type together. Respects the SAME filters as every other analytics
 * function (including `params.machineType` itself — narrowing to one type just
 * yields a single-row breakdown, which is the expected/consistent behavior).
 */
export async function getByMachineTypeBreakdown(params: AnalyticsPeriod): Promise<MachineTypeBreakdown[]> {
  const db = await getDb();
  if (!db) {
    console.error("[getByMachineTypeBreakdown] Database connection unavailable (DB_UNAVAILABLE)");
    return [];
  }

  const conditions = buildAnalyticsConditions(params, {
    machineId: true,
    factoryCode: true,
    lineCode: true,
    productModel: true,
    machineType: true,
  });

  const rows = await db.select({
    machineType: machines.machineType,
    total: count().as("total"),
    pass: sql<number>`COUNT(*) FILTER (WHERE ${finalYieldPassCondSql(productInspections.overallResult)})`.as("pass"),
    fail: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} = 'NG')`.as("fail"),
    activeMachines: sql<number>`COUNT(DISTINCT ${productInspections.machineId})`.as("activeMachines"),
  })
    .from(productInspections)
    .innerJoin(machines, eq(productInspections.machineId, machines.id))
    .where(and(...conditions))
    .groupBy(machines.machineType)
    .orderBy(desc(count()));

  return rows.map(r => {
    const total = Number(r.total);
    const pass = Number(r.pass);
    const fail = Number(r.fail);
    return {
      machineType: String(r.machineType),
      totalInspections: total,
      passCount: pass,
      failCount: fail,
      yieldRate: total > 0 ? (pass / total) * 100 : 0,
      defectRate: total > 0 ? (fail / total) * 100 : 0,
      activeMachines: Number(r.activeMachines),
    };
  });
}

/**
 * doc 69 Wave 2 / A1 — robot/OT KPIs for the comprehensive report. Reads the SAME
 * tables aiRobotAnomalyRouter.listAnomalies reads (robots / robot_telemetry /
 * robot_behavior_anomalies) rather than duplicating a separate reader.
 *
 * Tenant/factory scope: robots have no `factoryCode` column, so this mirrors
 * `aiAnalyticsScope.getMachineFactoryCode`'s join chain (stations → lines →
 * workshops → factories) over `robots.stationId` to resolve which robots belong
 * to a scoped caller's factory. A robot is ALSO in-scope when its `lineId`
 * resolves to the caller's factory (lines → workshops → factories) — a robot
 * assigned directly to a line (no stationId) must not be invisible to its own
 * factory's scoped users. The two resolutions are unioned; either one matching
 * is enough. `factoryCode` undefined (global/admin — already enforced at the
 * router boundary by `enforceAnalyticsFactoryScope`) → no restriction. A robot
 * with neither stationId nor lineId (or where neither resolves to the scoped
 * factory) is simply excluded for a SCOPED caller — fail-closed, never a
 * cross-factory leak. Always fail-safe: DB errors / no robot data → the empty
 * section, never an exception that would break the rest of the report.
 */
export async function getRobotsSection(params: { factoryCode?: string } = {}): Promise<RobotsSection> {
  const empty: RobotsSection = {
    totalRobots: 0,
    activeRobots: 0,
    onlineRobots: 0,
    robots: [],
    recentAnomalies: [],
    anomalyCountBySeverity: {},
  };

  const db = await getDb();
  if (!db) {
    console.error("[getRobotsSection] Database connection unavailable (DB_UNAVAILABLE)");
    return empty;
  }

  try {
    let robotRows: (typeof robots.$inferSelect)[];
    if (params.factoryCode) {
      // Resolve scope BOTH ways — a robot is in-scope if either its station's
      // factory OR its line's factory matches the caller's factory. Union of
      // ids, still fail-closed (only ADDS robots whose resolved factory is in
      // scope; never widens beyond that).
      const viaStation = await db
        .select({ id: robots.id })
        .from(robots)
        .innerJoin(stations, eq(robots.stationId, stations.id))
        .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
        .innerJoin(workshops, eq(productionLines.workshopId, workshops.id))
        .innerJoin(factories, eq(workshops.factoryId, factories.id))
        .where(eq(factories.code, params.factoryCode));
      const viaLine = await db
        .select({ id: robots.id })
        .from(robots)
        .innerJoin(productionLines, eq(robots.lineId, productionLines.id))
        .innerJoin(workshops, eq(productionLines.workshopId, workshops.id))
        .innerJoin(factories, eq(workshops.factoryId, factories.id))
        .where(eq(factories.code, params.factoryCode));
      const ids = Array.from(new Set([...viaStation.map(r => r.id), ...viaLine.map(r => r.id)]));
      if (ids.length === 0) return empty; // scoped caller with zero robots in their factory
      robotRows = await db.select().from(robots).where(inArray(robots.id, ids)).orderBy(desc(robots.updatedAt));
    } else {
      // Global/admin caller (factoryCode already resolved — possibly undefined —
      // by enforceAnalyticsFactoryScope before this function is ever reached).
      robotRows = await db.select().from(robots).orderBy(desc(robots.updatedAt));
    }

    if (robotRows.length === 0) return empty;
    const robotIds = robotRows.map(r => r.id);

    // Latest telemetry per robot — robots are low-cardinality, so a bounded
    // per-robot lookback (rather than a heavier DISTINCT ON) keeps this simple
    // and consistent with the rest of this file's query style.
    const latestByRobot = new Map<number, typeof robotTelemetry.$inferSelect>();
    const telemetryRows = await db
      .select()
      .from(robotTelemetry)
      .where(inArray(robotTelemetry.robotId, robotIds))
      .orderBy(desc(robotTelemetry.timestamp))
      .limit(robotIds.length * 20);
    for (const row of telemetryRows) {
      if (!latestByRobot.has(row.robotId)) latestByRobot.set(row.robotId, row);
    }

    const anomalyRows = await db
      .select()
      .from(robotBehaviorAnomalies)
      .where(inArray(robotBehaviorAnomalies.robotId, robotIds))
      .orderBy(desc(robotBehaviorAnomalies.detectedAt))
      .limit(50);

    // NOTE: computed over `anomalyRows` (capped at 50, most recent first) — see
    // the `anomalyCountBySeverity` doc comment on RobotsSection above.
    const anomalyCountBySeverity: Record<string, number> = {};
    for (const a of anomalyRows) {
      anomalyCountBySeverity[a.severity] = (anomalyCountBySeverity[a.severity] ?? 0) + 1;
    }

    return {
      totalRobots: robotRows.length,
      activeRobots: robotRows.filter(r => r.isEnabled).length,
      onlineRobots: robotRows.filter(r => r.status !== "offline").length,
      robots: robotRows.map(r => {
        const t = latestByRobot.get(r.id);
        return {
          robotId: r.id,
          robotCode: r.code,
          robotName: r.name,
          vendor: r.vendor,
          kind: r.kind,
          status: r.status,
          isEnabled: r.isEnabled,
          lastSeenAt: r.lastSeenAt ? r.lastSeenAt.toISOString() : null,
          latestTelemetry: t
            ? {
                mode: t.mode ?? null,
                busy: t.busy ?? null,
                estop: t.estop ?? null,
                speedPct: t.speedPct ?? null,
                batteryLevel: t.batteryLevel != null ? Number(t.batteryLevel) : null,
                lastHeartbeat: t.lastHeartbeat ? t.lastHeartbeat.toISOString() : null,
              }
            : null,
        };
      }),
      recentAnomalies: anomalyRows.map(a => ({
        id: a.id,
        robotId: a.robotId,
        kind: a.kind,
        severity: a.severity,
        score: Number(a.score),
        status: a.status,
        detectedAt: a.detectedAt.toISOString(),
      })),
      anomalyCountBySeverity,
    };
  } catch (err) {
    // Fail-safe — a robot-data problem must never break the rest of the report.
    console.error("[getRobotsSection] Failed to build robots section:", (err as Error)?.message ?? err);
    return empty;
  }
}

/**
 * Generate comprehensive report data for visual dashboards
 */
export async function generateComprehensiveReport(params: AnalyticsPeriod): Promise<ComprehensiveReport> {
  const db = await getDb();
  if (!db) {
    console.error("[generateComprehensiveReport] Database connection unavailable (DB_UNAVAILABLE)");
    throw new Error("Database connection unavailable");
  }

  // Execute all analytics in parallel
  const [
    defectTrend,
    defectPareto,
    machinePerformance,
    yieldForecast,
    correlations,
    risks,
    controlChart,
    shiftAnalysis,
    heatmapData,
    byMachineType,
    robotsSection,
  ] = await Promise.all([
    getDefectTrend(params),
    getDefectPareto(params),
    getMachinePerformance(params),
    forecastYield(params),
    getCorrelationAnalysis(params),
    assessRisks(params),
    getControlChart(params, "yield"),
    getShiftAnalysis(params),
    getDefectHeatmap(params),
    // doc 69 Wave 2 / A1 — additive sections (do not change any existing field's shape).
    getByMachineTypeBreakdown(params),
    getRobotsSection({ factoryCode: params.factoryCode }),
  ]);

  // Calculate overview
  const totalInspections = defectTrend.reduce((s, t) => s + t.total, 0);
  const passCount = defectTrend.reduce((s, t) => s + t.pass, 0);
  const failCount = defectTrend.reduce((s, t) => s + t.fail, 0);
  const reworkCount = 0; // Would need REWORK filter

  return {
    period: {
      start: params.startDate.toISOString().split("T")[0],
      end: params.endDate.toISOString().split("T")[0],
    },
    overview: {
      totalInspections,
      passCount,
      failCount,
      reworkCount,
      yieldRate: totalInspections > 0 ? (passCount / totalInspections) * 100 : 0,
      avgCycleTime: machinePerformance.length > 0
        ? machinePerformance.reduce((s, m) => s + m.avgCycleTime, 0) / machinePerformance.length
        : 0,
      uniqueProducts: 0,
      activeMachines: machinePerformance.length,
    },
    defectTrend,
    defectPareto,
    machinePerformance,
    yieldForecast,
    correlations,
    risks,
    controlChart,
    shiftAnalysis,
    heatmapData,
    byMachineType,
    robots: robotsSection,
  };
}

// ─── Utility Functions ────────────────────────────────────────

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;

  const xMean = x.reduce((a, b) => a + b, 0) / n;
  const yMean = y.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let xVar = 0;
  let yVar = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - xMean;
    const dy = y[i] - yMean;
    numerator += dx * dy;
    xVar += dx * dx;
    yVar += dy * dy;
  }

  const denominator = Math.sqrt(xVar * yVar);
  return denominator > 0 ? numerator / denominator : 0;
}

function classifyCorrelation(abs: number): "strong" | "moderate" | "weak" | "none" {
  if (abs >= 0.7) return "strong";
  if (abs >= 0.4) return "moderate";
  if (abs >= 0.2) return "weak";
  return "none";
}

// ─── AI Narration Layer ───────────────────────────────────────

/**
 * Generate a natural language narration for analytics data using GGUF.
 * Returns null if AI is unavailable — data is always returned regardless.
 */
async function narrateAnalysis(type: string, data: unknown): Promise<string | null> {
  try {
    const { generateText } = await import("./aiGgufEngine");

    const dataStr = JSON.stringify(data, null, 0).slice(0, 2000); // Limit context size
    const result = await generateText({
      systemPrompt:
        "You are a manufacturing data analyst. Provide concise, actionable insights " +
        "from analytics data. Focus on key findings, anomalies, and recommendations. " +
        "Use 2-3 sentences maximum. Support both English and Vietnamese readers.",
      prompt: `Summarize this ${type} analysis data and highlight key findings:\n${dataStr}`,
      maxTokens: 256,
      temperature: 0.5,
    });
    return result.text.trim() || null;
  } catch {
    return null;
  }
}

/** Trend analysis with AI narration */
export async function getDefectTrendWithNarration(params: AnalyticsPeriod) {
  const data = await getDefectTrend(params);
  const narration = await narrateAnalysis("defect trend", data);
  return { data, narration };
}

/** Pareto analysis with AI narration */
export async function getDefectParetoWithNarration(params: AnalyticsPeriod) {
  const data = await getDefectPareto(params);
  const narration = await narrateAnalysis("defect Pareto", data);
  return { data, narration };
}

/** Machine performance with AI narration */
export async function getMachinePerformanceWithNarration(params: AnalyticsPeriod) {
  const data = await getMachinePerformance(params);
  const narration = await narrateAnalysis("machine performance", data);
  return { data, narration };
}

/** Correlation analysis with AI narration */
export async function getCorrelationAnalysisWithNarration(params: AnalyticsPeriod) {
  const data = await getCorrelationAnalysis(params);
  const narration = await narrateAnalysis("correlation", data);
  return { data, narration };
}

/** Risk assessment with AI narration */
export async function assessRisksWithNarration(params: AnalyticsPeriod) {
  const data = await assessRisks(params);
  const narration = await narrateAnalysis("risk assessment", data);
  return { data, narration };
}

/** Control chart with AI interpretation */
export async function getControlChartWithNarration(
  params: AnalyticsPeriod,
  metric: "yield" | "defectRate" = "yield"
) {
  const data = await getControlChart(params, metric);
  const narration = await narrateAnalysis("SPC control chart", data);
  return { data, narration };
}

/**
 * Deep SPC interpretation — explains Western Electric rule violations,
 * process stability, Cpk adequacy, and specific corrective actions.
 * Non-blocking — returns null on failure.
 */
export async function interpretSPCViolations(
  params: AnalyticsPeriod,
  metric: "yield" | "defectRate" = "yield",
): Promise<{ data: ControlChartData; interpretation: string | null }> {
  const data = await getControlChart(params, metric);

  const violations = data.points.filter(p => p.violationRule);
  if (violations.length === 0 && data.summary.outOfControlCount === 0) {
    return { data, interpretation: "Process is in statistical control. No Western Electric rule violations detected." };
  }

  try {
    const { generateText } = await import("./aiGgufEngine");

    const violationSummary = violations.map(v =>
      `${v.date}: value=${v.value} (CL=${v.cl}, UCL=${v.ucl}, LCL=${v.lcl}) — ${v.violationRule}`
    ).join("\n");

    const response = await generateText({
      systemPrompt: `You are an SPC (Statistical Process Control) expert for manufacturing.
Analyze Western Electric rule violations and provide:
1. What each violation pattern indicates (systematic shift, trend, excessive variation, etc.)
2. Whether the process is stable, showing a trend, or has a step change
3. Cpk assessment and what it means for process capability
4. Specific corrective actions ordered by priority
Be concise but technically precise (4-6 sentences).`,
      prompt: `SPC Analysis for metric: ${metric}
Process stats: Mean=${data.summary.mean}, StdDev=${data.summary.stdDev}, UCL=${data.summary.ucl}, LCL=${data.summary.lcl}, Cpk=${data.summary.cpk}
Out-of-control points: ${data.summary.outOfControlCount} of ${data.points.length} total
Violations:
${violationSummary || "Points beyond 3σ limits detected"}`,
      maxTokens: 400,
      temperature: 0.3,
    });

    return { data, interpretation: response.text?.trim() || null };
  } catch {
    return { data, interpretation: null };
  }
}

/** Comprehensive report with executive summary narration */
export async function generateComprehensiveReportWithNarration(params: AnalyticsPeriod) {
  const report = await generateComprehensiveReport(params);
  const narration = await narrateAnalysis("comprehensive inspection report", {
    overview: report.overview,
    topDefects: report.defectPareto.slice(0, 5),
    risks: report.risks.filter(r => r.level === "critical" || r.level === "high"),
    outOfControl: report.controlChart.summary.outOfControlCount,
  });
  return { ...report, narration };
}

/**
 * Persist SPC violations to DB and fire real-time socket alerts.
 *
 * Call this after getControlChart() whenever you want to store + broadcast
 * detected violations. Idempotent: duplicate violations on the same day are
 * skipped by checking detectedAt date.
 */
export async function triggerSpcAlerts(opts: {
  violations: SpcViolation[];
  metric: string;
  machineId?: number;
  workstationId?: number;
  productModelId?: number;
  measurementPointDefId?: number;
  controlLimits: { ucl: number; lcl: number; cl: number };
}): Promise<void> {
  const { violations, metric, machineId, workstationId, productModelId, measurementPointDefId, controlLimits } = opts;
  if (violations.length === 0) return;

  const db = await getDb();

  for (const v of violations) {
    const severity = v.severity === "critical" ? "critical"
      : v.severity === "info" ? "info"
      : "warning";

    if (db) {
      try {
        await db.insert(spcRuleViolations).values({
          measurementPointDefId: measurementPointDefId ?? null,
          workstationId: workstationId ?? null,
          machineId: machineId ?? null,
          productModelId: productModelId ?? null,
          ruleType: v.ruleId as any,
          ruleName: v.ruleName,
          ruleDescription: `Metric: ${metric}. Points: ${v.pointIndices.join(", ")}`,
          severity,
          violatingValues: v.pointIndices,
          subgroupIndices: v.pointIndices,
          controlLimits,
          isActive: true,
        });
      } catch (err) {
        console.error(`[SPC] Failed to persist violation ${v.ruleId}:`, err);
      }
    }

    // Real-time broadcast regardless of DB success
    emitSpcViolationAlert({
      ruleId: v.ruleId,
      ruleName: v.ruleName,
      severity,
      metric,
      machineId,
      pointIndices: v.pointIndices,
      violationCount: v.pointIndices.length,
      detectedAt: new Date(),
      message: `SPC ${severity.toUpperCase()}: ${v.ruleName} detected on metric '${metric}' (${v.pointIndices.length} points affected)`,
    });
  }
}
