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
import { sql, eq, and, gte, lte, desc, asc, count, avg, SQL } from "drizzle-orm";
import {
  productInspections,
  measurementResults,
  measurementPointDefs,
  dailyStatistics,
  machines,
} from "../../drizzle/schema";
import { cacheService } from "./cacheService";

// ─── Types ─────────────────────────────────────────────────────

export interface AnalyticsPeriod {
  startDate: Date;
  endDate: Date;
  machineId?: number;
  factoryCode?: string;
  lineCode?: string;
  productModel?: string;
}

interface ConditionOptions {
  machineId?: boolean;
  factoryCode?: boolean;
  lineCode?: boolean;
  productModel?: boolean;
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

export interface ControlChartData {
  metric: string;
  points: Array<{
    date: string;
    value: number;
    ucl: number; // Upper Control Limit
    lcl: number; // Lower Control Limit
    cl: number;  // Center Line
    outOfControl: boolean;
    violationRule?: string;
  }>;
  summary: {
    mean: number;
    stdDev: number;
    ucl: number;
    lcl: number;
    cpk: number;
    outOfControlCount: number;
  };
}

export interface ShiftAnalysis {
  shift: string;
  totalInspections: number;
  yieldRate: number;
  avgCycleTime: number;
  topDefects: Array<{ type: string; count: number }>;
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
  });

  const rows = await db.select({
    date: sql<string>`DATE(${productInspections.inspectionTime})`.as("date"),
    total: count().as("total"),
    pass: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} IN ('OK', 'PASS'))`.as("pass"),
    fail: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} IN ('NG', 'FAIL'))`.as("fail"),
  })
    .from(productInspections)
    .where(and(...conditions))
    .groupBy(sql`DATE(${productInspections.inspectionTime})`)
    .orderBy(asc(sql`DATE(${productInspections.inspectionTime})`));

  return rows.map(r => ({
    date: String(r.date),
    total: Number(r.total),
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
    }),
    sql`${measurementResults.result} IN ('NG', 'FAIL')`,
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
  });

  const rows = await db.select({
    machineId: productInspections.machineId,
    machineCode: machines.code,
    machineName: machines.name,
    total: count().as("total"),
    pass: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} IN ('OK', 'PASS'))`.as("pass"),
    fail: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} IN ('NG', 'FAIL'))`.as("fail"),
    avgCycleTime: avg(productInspections.cycleTime).as("avgCycleTime"),
  })
    .from(productInspections)
    .innerJoin(machines, eq(productInspections.machineId, machines.id))
    .where(and(...conditions))
    .groupBy(productInspections.machineId, machines.code, machines.name)
    .orderBy(desc(count()));

  // Determine trend by comparing first half vs second half — single batch query
  const midDate = new Date((params.startDate.getTime() + params.endDate.getTime()) / 2);

  const trendRows = await db.select({
    machineId: productInspections.machineId,
    firstHalfTotal: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.inspectionTime} < ${midDate})`.as("firstHalfTotal"),
    firstHalfPass: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.inspectionTime} < ${midDate} AND ${productInspections.overallResult} IN ('OK', 'PASS'))`.as("firstHalfPass"),
    secondHalfTotal: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.inspectionTime} >= ${midDate})`.as("secondHalfTotal"),
    secondHalfPass: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.inspectionTime} >= ${midDate} AND ${productInspections.overallResult} IN ('OK', 'PASS'))`.as("secondHalfPass"),
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
 * Holt-Winters seasonal forecasting for stable, long-term data (14+ days)
 */
function forecastWithHoltWinters(
  data: number[],
  baseDate: Date,
  horizonDays: number,
  confidence: number,
): YieldForecast[] {
  // Holt-Winters parameters
  const alpha = 0.3; // Level smoothing
  const beta = 0.1;  // Trend smoothing
  const gamma = 0.3; // Seasonal smoothing
  const seasonLength = Math.min(7, Math.floor(data.length / 2)); // Weekly pattern

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
    const newSeasonal = gamma * (data[t] - newLevel) + (1 - gamma) * prevSeasonal;

    level.push(newLevel);
    trendArr.push(newTrend);
    seasonal[sIdx] = newSeasonal;
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

  for (let h = 1; h <= horizonDays; h++) {
    const forecastDate = new Date(baseDate);
    forecastDate.setDate(forecastDate.getDate() + h);

    const sIdx = (data.length + h) % seasonLength;
    const predicted = lastLevel + h * lastTrend + seasonal[sIdx];
    const interval = 1.96 * stdError * Math.sqrt(h);

    forecasts.push({
      date: forecastDate.toISOString().split("T")[0],
      predicted: Math.max(0, Math.min(100, Number(predicted.toFixed(2)))),
      lowerBound: Math.max(0, Number((predicted - interval).toFixed(2))),
      upperBound: Math.min(100, Number((predicted + interval).toFixed(2))),
      confidence: Math.max(0.5, Number((1 - (h * 0.03)).toFixed(2))),
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
  });

  // OPTIMIZATION: Get daily data per machine (aggregated)
  const rows = await db.select({
    date: sql<string>`DATE(${productInspections.inspectionTime})`.as("date"),
    machineId: productInspections.machineId,
    machineCode: machines.code,
    total: count().as("total"),
    fail: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} IN ('NG', 'FAIL'))`.as("fail"),
    avgCycleTime: avg(productInspections.cycleTime).as("avgCycleTime"),
  })
    .from(productInspections)
    .innerJoin(machines, eq(productInspections.machineId, machines.id))
    .where(and(...conditions))
    .groupBy(sql`DATE(${productInspections.inspectionTime})`, productInspections.machineId, machines.code)
    .orderBy(asc(sql`DATE(${productInspections.inspectionTime})`));

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
  const machineGroups = new Map<string, { defectRates: number[]; dates: string[]; total: number }>();
  for (const r of rows) {
    const code = r.machineCode ?? `M-${r.machineId}`;
    if (!machineGroups.has(code)) machineGroups.set(code, { defectRates: [], dates: [], total: 0 });
    const group = machineGroups.get(code)!;
    group.defectRates.push(Number(r.total) > 0 ? Number(r.fail) / Number(r.total) : 0);
    group.dates.push(String(r.date));
    group.total += Number(r.total);
  }

  // Sort by inspection volume and take top 10
  const topMachines = Array.from(machineGroups.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10)
    .map(([code]) => code);

  // Only compute pairwise correlations for top 10 machines (reduces O(n²) complexity)
  for (let i = 0; i < topMachines.length; i++) {
    for (let j = i + 1; j < topMachines.length; j++) {
      const a = machineGroups.get(topMachines[i])!;
      const b = machineGroups.get(topMachines[j])!;

      // Align by date
      const commonDates = a.dates.filter(d => b.dates.includes(d));
      if (commonDates.length >= 5) {
        const aVals = commonDates.map(d => a.defectRates[a.dates.indexOf(d)]);
        const bVals = commonDates.map(d => b.defectRates[b.dates.indexOf(d)]);
        const corr = pearsonCorrelation(aVals, bVals);

        if (Math.abs(corr) > 0.3) {
          correlations.push({
            factor1: topMachines[i],
            factor2: topMachines[j],
            correlation: Number(corr.toFixed(3)),
            strength: classifyCorrelation(Math.abs(corr)),
            direction: corr >= 0 ? "positive" : "negative",
            sampleSize: commonDates.length,
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

  // 1. Machine degradation risk
  const machinePerf = await getMachinePerformance(params);
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

  // 2. Yield drop risk
  const trend = await getDefectTrend(params);
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

  // 3. Concentrated defect risk
  const pareto = await getDefectPareto(params);
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
 */
export async function getControlChart(
  params: AnalyticsPeriod,
  metric: "yield" | "defectRate" | "cycleTime" = "yield",
): Promise<ControlChartData> {
  const trend = await getDefectTrend(params);
  if (trend.length === 0) {
    return {
      metric,
      points: [],
      summary: { mean: 0, stdDev: 0, ucl: 0, lcl: 0, cpk: 0, outOfControlCount: 0 },
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

  const points = trend.map((t, i) => {
    const value = values[i];
    const outOfControl = value > ucl || value < lcl;

    // Western Electric rules
    let violationRule: string | undefined;
    if (outOfControl) violationRule = "Beyond 3σ";
    else if (i >= 1 && (
      (values[i] > meanVal + 2 * stdDevVal && values[i - 1] > meanVal + 2 * stdDevVal) ||
      (values[i] < meanVal - 2 * stdDevVal && values[i - 1] < meanVal - 2 * stdDevVal)
    )) {
      violationRule = "2 of 3 beyond 2σ";
    }

    return {
      date: t.date,
      value: Number(value.toFixed(2)),
      ucl: Number(ucl.toFixed(2)),
      lcl: Number(lcl.toFixed(2)),
      cl: Number(meanVal.toFixed(2)),
      outOfControl,
      violationRule,
    };
  });

  // Cpk calculation (assuming spec limits at ±3σ from target 100% for yield)
  const target = metric === "yield" ? 100 : 0;
  const usl = metric === "yield" ? 100 : meanVal + 3 * stdDevVal;
  const lsl = metric === "yield" ? Math.max(0, meanVal - 6 * stdDevVal) : 0;
  const cpk = stdDevVal > 0
    ? Math.min((usl - meanVal) / (3 * stdDevVal), (meanVal - lsl) / (3 * stdDevVal))
    : 0;

  return {
    metric,
    points,
    summary: {
      mean: Number(meanVal.toFixed(2)),
      stdDev: Number(stdDevVal.toFixed(2)),
      ucl: Number(ucl.toFixed(2)),
      lcl: Number(lcl.toFixed(2)),
      cpk: Number(cpk.toFixed(3)),
      outOfControlCount: points.filter(p => p.outOfControl).length,
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
  });

  // Group by shift (morning 6-14, afternoon 14-22, night 22-6)
  const rows = await db.select({
    shift: sql<string>`CASE 
      WHEN EXTRACT(HOUR FROM ${productInspections.inspectionTime}) BETWEEN 6 AND 13 THEN 'Morning'
      WHEN EXTRACT(HOUR FROM ${productInspections.inspectionTime}) BETWEEN 14 AND 21 THEN 'Afternoon'
      ELSE 'Night'
    END`.as("shift"),
    total: count().as("total"),
    pass: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} IN ('OK', 'PASS'))`.as("pass"),
    avgCycleTime: avg(productInspections.cycleTime).as("avgCycleTime"),
  })
    .from(productInspections)
    .where(and(...conditions))
    .groupBy(sql`CASE 
      WHEN EXTRACT(HOUR FROM ${productInspections.inspectionTime}) BETWEEN 6 AND 13 THEN 'Morning'
      WHEN EXTRACT(HOUR FROM ${productInspections.inspectionTime}) BETWEEN 14 AND 21 THEN 'Afternoon'
      ELSE 'Night'
    END`);

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
  });

  const rows = await db.select({
    machineCode: machines.code,
    hour: sql<number>`EXTRACT(HOUR FROM ${productInspections.inspectionTime})`.as("hour"),
    total: count().as("total"),
    fail: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} IN ('NG', 'FAIL'))`.as("fail"),
  })
    .from(productInspections)
    .innerJoin(machines, eq(productInspections.machineId, machines.id))
    .where(and(...conditions))
    .groupBy(machines.code, sql`EXTRACT(HOUR FROM ${productInspections.inspectionTime})`)
    .orderBy(machines.code, asc(sql`EXTRACT(HOUR FROM ${productInspections.inspectionTime})`));

  return rows.map(r => ({
    machineCode: r.machineCode ?? "",
    hour: Number(r.hour),
    defectRate: Number(r.total) > 0 ? (Number(r.fail) / Number(r.total)) * 100 : 0,
    total: Number(r.total),
  }));
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
