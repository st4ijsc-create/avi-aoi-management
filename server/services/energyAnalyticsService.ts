/**
 * Sprint G2.6a — Advanced energy analytics service.
 *
 * SAFETY: this service is READ + COMPUTE only over energy telemetry. It NEVER
 * imports commandDispatcher / driver.writeTags and NEVER writes to a machine.
 * suggestDemandResponse returns TEXT + i18n keys ONLY — it does not act, shed
 * load, or dispatch any command. Energy reading inserts (recordReading) live in
 * the router/db layer and write DATA rows, not control commands.
 *
 * Capabilities:
 *  - computeRecipeEnergy : kWh + kWh/unit attributed per recipe (recipeRef direct,
 *                          else LEAD() deployment-window attribution).
 *  - computePeakDemand   : instantaneous MAX(powerKw) + rolling N-min demand.
 *  - computePowerFactor  : avg/min PF + % below threshold (NULL-safe).
 *  - forecastEnergy      : reuses aiTimeSeriesEngine.forecastWithConfidenceInterval.
 *  - suggestDemandResponse: text-only advisory (NO action).
 */
import {
  getEnergyReadings,
  getRecipeDeploymentWindows,
  getGoodUnitsByRecipe,
  getPeakDemandRows,
  getRollingDemandBuckets,
  getPowerFactorStats,
  type EnergyRange,
} from "../db/energy";
import { queryEnergyBuckets, isTsdbEnabled } from "../db/timescale";
import {
  forecastWithConfidenceInterval,
  type TimeSeriesPoint,
  type ForecastPoint,
} from "./aiTimeSeriesEngine";

const PF_DEFAULT_THRESHOLD = 0.9;

// ============================================================
// Per-recipe energy
// ============================================================
export interface RecipeEnergyRow {
  recipeId: number | null;
  recipeCode: string | null;
  recipeRef: string;
  machineId: number | null;
  periodStart: Date;
  periodEnd: Date;
  totalKwh: number;
  unitsProduced: number;
  kwhPerUnit: number | null;
  avgPowerKw: number | null;
  peakDemandKw: number | null;
}

interface ReadingForAttribution {
  machineId: number | null;
  value: number | null;
  powerKw: number | null;
  recipeRef: string | null;
  timestamp: Date;
}

/**
 * Energy attributed per recipe over [from,to). A reading is attributed to a
 * recipe by:
 *   1. its own recipeRef column when present (direct attribution), else
 *   2. the recipe deployment window active at the reading timestamp
 *      (LEAD()-derived [startAt,nextAt) per machine).
 * kwhPerUnit = totalKwh / goodUnits, NULL when goodUnits = 0.
 */
export async function computeRecipeEnergy(params: EnergyRange): Promise<RecipeEnergyRow[]> {
  const range: EnergyRange = { from: params.from, to: params.to, machineId: params.machineId };

  const [readings, windows, goodUnits] = await Promise.all([
    getEnergyReadings(range),
    getRecipeDeploymentWindows(params.machineId, range),
    getGoodUnitsByRecipe(range),
  ]);

  // recipeRef -> {recipeId, recipeCode} lookup from deployment windows.
  const refMeta = new Map<string, { recipeId: number | null; recipeCode: string | null }>();
  for (const w of windows) {
    if (w.recipeCode) refMeta.set(w.recipeCode, { recipeId: w.recipeId, recipeCode: w.recipeCode });
  }

  // good-units lookup keyed by recipeRef (process_results.recipeRef == recipe code).
  const unitsByRef = new Map<string, number>();
  for (const g of goodUnits) {
    unitsByRef.set(g.recipeRef, (unitsByRef.get(g.recipeRef) ?? 0) + Number(g.goodUnits ?? 0));
  }

  interface Acc {
    recipeId: number | null;
    recipeCode: string | null;
    machineId: number | null;
    totalKwh: number;
    powerSum: number;
    powerCount: number;
    peakKw: number | null;
  }
  const acc = new Map<string, Acc>();

  const attribute = (r: ReadingForAttribution): { ref: string; recipeId: number | null; recipeCode: string | null } | null => {
    // 1) direct recipeRef
    if (r.recipeRef) {
      const meta = refMeta.get(r.recipeRef);
      return { ref: r.recipeRef, recipeId: meta?.recipeId ?? null, recipeCode: meta?.recipeCode ?? r.recipeRef };
    }
    // 2) LEAD() deployment window active at timestamp for this machine
    const t = r.timestamp.getTime();
    for (const w of windows) {
      if (r.machineId != null && w.machineId !== r.machineId) continue;
      const start = w.startAt.getTime();
      const end = w.endAt ? w.endAt.getTime() : Infinity;
      if (t >= start && t < end) {
        const ref = w.recipeCode ?? `recipe:${w.recipeId}`;
        return { ref, recipeId: w.recipeId, recipeCode: w.recipeCode };
      }
    }
    return null;
  };

  for (const r of readings) {
    const a = attribute(r);
    if (!a) continue;
    const key = `${r.machineId ?? "null"}::${a.ref}`;
    const cur = acc.get(key) ?? {
      recipeId: a.recipeId,
      recipeCode: a.recipeCode,
      machineId: r.machineId,
      totalKwh: 0,
      powerSum: 0,
      powerCount: 0,
      peakKw: null,
    };
    if (r.value != null) cur.totalKwh += Number(r.value);
    if (r.powerKw != null) {
      cur.powerSum += Number(r.powerKw);
      cur.powerCount += 1;
      cur.peakKw = cur.peakKw == null ? Number(r.powerKw) : Math.max(cur.peakKw, Number(r.powerKw));
    }
    acc.set(key, cur);
  }

  const out: RecipeEnergyRow[] = [];
  for (const [key, v] of acc) {
    const ref = key.split("::")[1];
    const units = unitsByRef.get(v.recipeCode ?? ref) ?? unitsByRef.get(ref) ?? 0;
    out.push({
      recipeId: v.recipeId,
      recipeCode: v.recipeCode,
      recipeRef: ref,
      machineId: v.machineId,
      periodStart: params.from,
      periodEnd: params.to,
      totalKwh: round4(v.totalKwh),
      unitsProduced: units,
      kwhPerUnit: units > 0 ? round6(v.totalKwh / units) : null,
      avgPowerKw: v.powerCount > 0 ? round4(v.powerSum / v.powerCount) : null,
      peakDemandKw: v.peakKw != null ? round4(v.peakKw) : null,
    });
  }
  out.sort((a, b) => b.totalKwh - a.totalKwh);
  return out;
}

// ============================================================
// Peak demand
// ============================================================
export interface PeakDemandResult {
  instantaneousPeakKw: number | null;
  peakAt: Date | null;
  rollingDemandKw: number | null;
  rollingWindowMin: number;
  demandByBucket: Array<{ bucket: Date; avgPowerKw: number | null }>;
  source: "tsdb" | "main_pg";
}

/**
 * Peak demand over [from,to): instantaneous = MAX(powerKw) + its timestamp;
 * rolling = max of fixed `windowMin` rolling-average buckets. Uses TimescaleDB
 * time_bucket when enabled, else a main-PG window AVG. The instantaneous peak +
 * peakAt always come from the main PG (precise timestamp).
 */
export async function computePeakDemand(params: EnergyRange & { windowMin?: number }): Promise<PeakDemandResult> {
  const windowMin = params.windowMin && params.windowMin > 0 ? params.windowMin : 15;
  const range: EnergyRange = { from: params.from, to: params.to, machineId: params.machineId };

  const peak = await getPeakDemandRows(range);

  let buckets: Array<{ bucket: Date; avgPowerKw: number | null }>;
  let source: "tsdb" | "main_pg";
  if (isTsdbEnabled()) {
    const tsdb = await queryEnergyBuckets({
      machineId: params.machineId,
      from: params.from,
      to: params.to,
      bucket: `${windowMin} minutes`,
    });
    buckets = tsdb.map((b) => ({ bucket: b.bucket, avgPowerKw: b.avgPowerKw }));
    source = "tsdb";
  } else {
    buckets = await getRollingDemandBuckets(range, windowMin);
    source = "main_pg";
  }

  let rollingDemandKw: number | null = null;
  for (const b of buckets) {
    if (b.avgPowerKw == null) continue;
    rollingDemandKw = rollingDemandKw == null ? b.avgPowerKw : Math.max(rollingDemandKw, b.avgPowerKw);
  }

  return {
    instantaneousPeakKw: peak.instantaneousPeakKw != null ? round4(peak.instantaneousPeakKw) : null,
    peakAt: peak.peakAt,
    rollingDemandKw: rollingDemandKw != null ? round4(rollingDemandKw) : null,
    rollingWindowMin: windowMin,
    demandByBucket: buckets,
    source,
  };
}

// ============================================================
// Power factor
// ============================================================
export interface PowerFactorResult {
  available: boolean;
  avgPowerFactor: number | null;
  minPowerFactor: number | null;
  threshold: number;
  samples: number;
  pfSamples: number;
  belowThreshold: number;
  pctBelowThreshold: number | null;
}

/**
 * Power-factor stats over [from,to). When NO reading carries a powerFactor value
 * (all NULL) returns { available:false }. Otherwise avg/min are computed over the
 * non-NULL subset and pctBelowThreshold is relative to that subset.
 */
export async function computePowerFactor(params: EnergyRange & { threshold?: number }): Promise<PowerFactorResult> {
  const threshold = params.threshold != null ? params.threshold : PF_DEFAULT_THRESHOLD;
  const range: EnergyRange = { from: params.from, to: params.to, machineId: params.machineId };
  const stats = await getPowerFactorStats(range, threshold);

  if (stats.pfSamples === 0) {
    return {
      available: false,
      avgPowerFactor: null,
      minPowerFactor: null,
      threshold,
      samples: stats.samples,
      pfSamples: 0,
      belowThreshold: 0,
      pctBelowThreshold: null,
    };
  }

  return {
    available: true,
    avgPowerFactor: stats.avgPf != null ? round4(stats.avgPf) : null,
    minPowerFactor: stats.minPf != null ? round4(stats.minPf) : null,
    threshold,
    samples: stats.samples,
    pfSamples: stats.pfSamples,
    belowThreshold: stats.belowThreshold,
    pctBelowThreshold: round4((stats.belowThreshold / stats.pfSamples) * 100),
  };
}

// ============================================================
// Forecast
// ============================================================
export interface EnergyForecastResult {
  metric: "kwh" | "powerKw";
  available: boolean;
  reason?: string;
  pointsUsed: number;
  bucket: string;
  forecast: ForecastPoint[];
  predictedPeak: number | null;
}

/**
 * Forecast future energy (kWh) or power (kW). Builds a TimeSeriesPoint[] from
 * bucketed history (TSDB time_bucket when enabled, else main-PG buckets) and
 * delegates to the pure aiTimeSeriesEngine. With < 3 points it returns
 * { available:false } WITHOUT throwing (insufficient data is not an error).
 * predictedPeak = max(upper) of the confidence band.
 */
export async function forecastEnergy(params: EnergyRange & {
  metric?: "kwh" | "powerKw";
  horizon?: number;
  algorithm?: "ewma" | "holt_winters";
  bucketMin?: number;
}): Promise<EnergyForecastResult> {
  const metric = params.metric ?? "kwh";
  const horizon = params.horizon && params.horizon > 0 ? params.horizon : 12;
  const algorithm = params.algorithm ?? "ewma";
  const bucketMin = params.bucketMin && params.bucketMin > 0 ? params.bucketMin : 60;
  const bucketLabel = `${bucketMin} minutes`;

  // Build the history series from buckets.
  let series: TimeSeriesPoint[];
  if (isTsdbEnabled()) {
    const rows = await queryEnergyBuckets({
      machineId: params.machineId,
      from: params.from,
      to: params.to,
      bucket: bucketLabel,
    });
    series = rows
      .map((r) => ({
        timestamp: new Date(r.bucket).getTime(),
        value: metric === "kwh" ? Number(r.totalValue ?? 0) : Number(r.avgPowerKw ?? 0),
      }))
      .filter((p) => Number.isFinite(p.value));
  } else {
    const buckets = await getRollingDemandBuckets(
      { from: params.from, to: params.to, machineId: params.machineId },
      bucketMin,
    );
    if (metric === "powerKw") {
      series = buckets
        .map((b) => ({ timestamp: new Date(b.bucket).getTime(), value: Number(b.avgPowerKw ?? 0) }))
        .filter((p) => Number.isFinite(p.value));
    } else {
      // kWh per bucket from raw readings summed into the same window.
      const readings = await getEnergyReadings({ from: params.from, to: params.to, machineId: params.machineId });
      const seconds = bucketMin * 60;
      const sums = new Map<number, number>();
      for (const r of readings) {
        if (r.value == null) continue;
        const b = Math.floor(r.timestamp.getTime() / 1000 / seconds) * seconds * 1000;
        sums.set(b, (sums.get(b) ?? 0) + Number(r.value));
      }
      series = [...sums.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ timestamp: t, value: v }));
    }
  }

  if (series.length < 3) {
    return {
      metric,
      available: false,
      reason: "energy.forecast.insufficientData",
      pointsUsed: series.length,
      bucket: bucketLabel,
      forecast: [],
      predictedPeak: null,
    };
  }

  const forecast = forecastWithConfidenceInterval(series, horizon, algorithm);
  const predictedPeak = forecast.length > 0 ? Math.max(...forecast.map((f) => f.upper)) : null;

  return {
    metric,
    available: true,
    pointsUsed: series.length,
    bucket: bucketLabel,
    forecast,
    predictedPeak: predictedPeak != null ? round4(predictedPeak) : null,
  };
}

// ============================================================
// Demand-response advisory — TEXT ONLY (no action / no dispatch)
// ============================================================
export interface DemandResponseSuggestion {
  severity: "info" | "warning" | "critical";
  messageKey: string;
  detail: Record<string, number | string | null>;
}

/**
 * Advisory suggestions comparing a forecast + peak against a contract/threshold
 * (kW). Returns TEXT + i18n keys ONLY. This function performs NO machine action,
 * NO load-shedding, NO dispatch — it is purely informational for an operator.
 */
export function suggestDemandResponse(
  forecast: EnergyForecastResult | null,
  peak: PeakDemandResult | null,
  thresholdKw: number,
): DemandResponseSuggestion[] {
  const out: DemandResponseSuggestion[] = [];
  if (!(thresholdKw > 0)) return out;

  const observedPeak = peak?.rollingDemandKw ?? peak?.instantaneousPeakKw ?? null;
  if (observedPeak != null && observedPeak >= thresholdKw) {
    out.push({
      severity: "critical",
      messageKey: "energy.demandResponse.peakExceeded",
      detail: { observedPeakKw: round4(observedPeak), thresholdKw, windowMin: peak?.rollingWindowMin ?? null },
    });
  } else if (observedPeak != null && observedPeak >= thresholdKw * 0.9) {
    out.push({
      severity: "warning",
      messageKey: "energy.demandResponse.peakApproaching",
      detail: { observedPeakKw: round4(observedPeak), thresholdKw },
    });
  }

  const predicted = forecast?.available ? forecast.predictedPeak : null;
  if (predicted != null && predicted >= thresholdKw) {
    out.push({
      severity: "warning",
      messageKey: "energy.demandResponse.forecastPeakExceedsThreshold",
      detail: { predictedPeakKw: round4(predicted), thresholdKw },
    });
  }

  if (out.length === 0) {
    out.push({
      severity: "info",
      messageKey: "energy.demandResponse.withinLimits",
      detail: { observedPeakKw: observedPeak != null ? round4(observedPeak) : null, thresholdKw },
    });
  }
  return out;
}

// ── rounding helpers (avoid float noise in API output) ──
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
