/**
 * Predictive-alert SIGNAL derivation — doc69 Wave 2 / A2.
 *
 * `predictiveAlertRouter.generatePredictions` (server/routers/aiRouters.ts) used to
 * decide "is a defect spike coming?" with an inline 7-point OLS slope + a
 * HARDCODED 10% defect-rate threshold + hardcoded recommendation strings, all
 * mislabeled `modelUsed: 'Linear Regression'`. This module replaces that fake
 * heuristic's DECISION with the REAL forecast engine already in the repo
 * (aiInspectionAnalytics.forecastYield — Holt-Winters/EWMA/Linear per data-length,
 * confidence tied to real in-sample forecast error).
 *
 * PURE: no DB, no I/O. The router fetches `trend`/`forecast`/`pareto` (and,
 * flag-gated, `correlationFactors`) via the existing analytics services and passes
 * them in here; this module only decides whether to alert, at what severity, and
 * with what data-derived recommendations. Fully unit-testable without a DB.
 */

import {
  yieldForecastMethodFor,
  type DefectTrendPoint,
  type DefectParetoItem,
  type YieldForecast,
  type YieldForecastMethod,
} from "./aiInspectionAnalytics";
import type { FactorCorrelation } from "./ai/defectCorrelationService";

// ─── Tunables ──────────────────────────────────────────────────────────────────
// NOTE: unlike the old hardcoded "predictedRate > 10%" business threshold, this is
// a NOISE FLOOR — the minimum rise (in percentage points) between the real
// forecast's predicted defect rate and the machine's own recent baseline before we
// call it a "trend" at all (the honest analogue of the old code's `slope > 0.5`
// rising-trend gate). It is NOT a fixed alert-worthy business threshold: the
// comparison is always against THIS machine's own data, never an absolute level.
const RISING_TREND_MIN_DELTA_PP = 1.5;

const MODEL_LABELS: Record<YieldForecastMethod, string> = {
  "holt-winters": "yield-forecast:holt-winters (seasonal exponential smoothing)",
  ewma: "yield-forecast:ewma (exponential weighted moving average)",
  "linear-trend": "yield-forecast:linear-trend",
};

export interface DefectSpikeSignal {
  alertType: "DEFECT_SPIKE";
  severity: "MEDIUM" | "HIGH" | "CRITICAL";
  /** Predicted defect rate (%) at the forecast horizon — REAL, from forecastYield. */
  predictedValue: number;
  /** Current/baseline defect rate (%) over the analyzed window. */
  currentValue: number;
  /** The decision boundary (currentValue + noise floor) — replaces the old fixed 10%. */
  alertThreshold: number;
  /** 0-100, derived from the forecast's OWN confidence (real forecast error), not fabricated. */
  confidenceScore: number;
  predictedTimeframe: string;
  /** The ACTUAL forecasting method used (not a mislabel). */
  modelUsed: string;
  dataPoints: number;
  factors: Array<{ name: string; contribution: number; description: string }>;
  recommendations: string[];
}

export interface DeriveDefectSpikeSignalInput {
  /** Daily defect trend for this machine (aiInspectionAnalytics.getDefectTrend). */
  trend: DefectTrendPoint[];
  /** Yield forecast for the same scope/window (aiInspectionAnalytics.forecastYield). */
  forecast: YieldForecast[];
  /** Top defect-type breakdown for the window (aiInspectionAnalytics.getDefectPareto). */
  pareto: DefectParetoItem[];
  /** Optional — quantitative upstream-parameter correlations (RCA_QUANTITATIVE_ENABLED
   *  gated at the caller; [] when unavailable/disabled — never fabricated). */
  correlationFactors?: FactorCorrelation[];
}

/**
 * Decide whether the real forecast signals a defect spike worth alerting on, and
 * if so, build the alert's fields entirely from that real signal.
 *
 * Honest-degrade: returns null when there isn't enough data for the forecast
 * engine to have run (mirrors "today"'s minimum-data behavior) or when the
 * forecast doesn't show a rising trend — never fabricates a value.
 */
export function deriveDefectSpikeSignal(input: DeriveDefectSpikeSignalInput): DefectSpikeSignal | null {
  const { trend, forecast, pareto, correlationFactors = [] } = input;

  // Same minimum-data bar as the previous heuristic (>=7 data points) — but now
  // gating a REAL forecast run instead of a manual 7-point OLS.
  if (trend.length < 7 || forecast.length === 0) return null;

  const currentDefectRate = trend.reduce((s, t) => s + t.defectRate, 0) / trend.length;
  // Furthest-out forecast point — matches the old "predict 7 days ahead" semantics
  // and the predictedTimeframe label below.
  const horizon = forecast[forecast.length - 1];
  const predictedDefectRate = Math.max(0, Math.min(100, 100 - horizon.predicted));
  const confidence = Math.max(0, Math.min(1, horizon.confidence)); // REAL — tied to forecast error

  const method = yieldForecastMethodFor(trend.length);
  const modelUsed = MODEL_LABELS[method];

  const delta = predictedDefectRate - currentDefectRate;
  const alertThreshold = Number((currentDefectRate + RISING_TREND_MIN_DELTA_PP).toFixed(2));

  if (delta < RISING_TREND_MIN_DELTA_PP) return null; // not a real rising trend — honest no-alert

  // Severity scales off the SAME two real signals — how much worse (delta) and how
  // confident the model is — never a fixed absolute-level cutoff (e.g. "> 20%").
  const severityScore = delta * confidence;
  const severity: DefectSpikeSignal["severity"] =
    severityScore >= 10 ? "CRITICAL" : severityScore >= 5 ? "HIGH" : "MEDIUM";

  // Data-derived factors: top defect types actually observed in the window.
  const factors = pareto.slice(0, 3).map((p) => ({
    name: p.defectType,
    contribution: p.percentage,
    description: `${p.count} NG in window (${p.percentage.toFixed(1)}% of defects)`,
  }));

  // Data-derived recommendations: quantitative upstream correlations when
  // available (flag-gated at the caller), else the top Pareto defect, else an
  // honest generic (never a fabricated specific).
  const recommendations: string[] = [];
  for (const c of correlationFactors.slice(0, 3)) {
    if (c.direction === "none") continue;
    recommendations.push(
      `Upstream factor "${c.factor}": ${c.direction === "higher_more_defects" ? "higher values" : "lower values"} correlate with more defects` +
        ` (r=${c.pearson}, p=${c.pValue}${c.significant ? ", significant" : ""}, n=${c.n})`,
    );
  }
  if (pareto.length > 0) {
    recommendations.push(
      `Focus on "${pareto[0].defectType}" — the top contributing defect (${pareto[0].percentage.toFixed(1)}% of NG in the analyzed window)`,
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(
      "Defect rate is trending upward with no single dominant factor identified yet — review recent process/inspection data for this machine.",
    );
  }

  return {
    alertType: "DEFECT_SPIKE",
    severity,
    predictedValue: Number(predictedDefectRate.toFixed(2)),
    currentValue: Number(currentDefectRate.toFixed(2)),
    alertThreshold,
    confidenceScore: Number((confidence * 100).toFixed(2)),
    predictedTimeframe: `next ${forecast.length} day${forecast.length === 1 ? "" : "s"}`,
    modelUsed,
    dataPoints: trend.length,
    factors,
    recommendations,
  };
}
