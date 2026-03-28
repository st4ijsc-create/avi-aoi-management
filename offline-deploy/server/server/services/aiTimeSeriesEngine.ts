/**
 * AI Time Series Anomaly Detection Engine
 * 
 * Algorithms:
 *  - EWMA (Exponential Weighted Moving Average)
 *  - Holt-Winters (Triple Exponential Smoothing) for seasonal/shift patterns
 *  - Isolation Forest for multivariate anomaly scoring
 *  - Seasonal Decomposition (Trend + Seasonal + Residual)
 *  - Change Point Detection (CUSUM-based)
 * 
 * AOI Applications:
 *  - Predict defect rate by shift
 *  - Detect machine degradation trends
 *  - Alert on production pattern changes
 */

import { mean, stdDev } from "../utils/statistics";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TimeSeriesPoint {
  timestamp: number; // epoch ms
  value: number;
}

export interface MultivariatePoint {
  timestamp: number;
  values: Record<string, number>;
}

export type Algorithm = "ewma" | "holt_winters" | "isolation_forest" | "seasonal_decompose" | "change_point";

export interface AnalysisOptions {
  algorithm: Algorithm;
  /** EWMA smoothing factor (0 < alpha < 1). Default 0.3 */
  alpha?: number;
  /** Holt-Winters trend factor. Default 0.1 */
  beta?: number;
  /** Holt-Winters seasonal factor. Default 0.3 */
  gamma?: number;
  /** Season length (e.g. 24 for hourly data with daily pattern, 3 for 3-shift). */
  seasonLength?: number;
  /** Anomaly threshold in std deviations. Default 3.0 */
  threshold?: number;
  /** Isolation Forest: number of trees. Default 100 */
  numTrees?: number;
  /** Isolation Forest: sample size per tree. Default 256 */
  sampleSize?: number;
  /** Forecast horizon (number of future points). Default 12 */
  horizon?: number;
}

export interface ForecastPoint {
  timestamp: number;
  predicted: number;
  lower: number;
  upper: number;
}

export interface AnomalyResult {
  index: number;
  timestamp: number;
  value: number;
  score: number; // anomaly score (higher = more anomalous)
  isAnomaly: boolean;
}

export interface DecompositionResult {
  trend: number[];
  seasonal: number[];
  residual: number[];
  timestamps: number[];
}

export interface ChangePointResult {
  index: number;
  timestamp: number;
  cumulativeSum: number;
  direction: "increase" | "decrease";
}

export interface TimeSeriesAnalysis {
  algorithm: Algorithm;
  anomalies: AnomalyResult[];
  forecast: ForecastPoint[];
  decomposition?: DecompositionResult;
  changePoints?: ChangePointResult[];
  summary: {
    totalPoints: number;
    anomalyCount: number;
    meanValue: number;
    stdDevValue: number;
    trendDirection: "increasing" | "decreasing" | "stable";
    trendSlope: number;
  };
}

// ─── EWMA ──────────────────────────────────────────────────────────────────

/**
 * Exponential Weighted Moving Average.
 * Returns smoothed values and detects anomalies where residual > threshold * σ.
 */
export function ewma(
  data: TimeSeriesPoint[],
  alpha = 0.3,
  threshold = 3.0,
): { smoothed: number[]; anomalies: AnomalyResult[] } {
  if (data.length === 0) return { smoothed: [], anomalies: [] };

  const smoothed: number[] = [data[0].value];
  for (let i = 1; i < data.length; i++) {
    smoothed.push(alpha * data[i].value + (1 - alpha) * smoothed[i - 1]);
  }

  // Compute residuals
  const residuals = data.map((d, i) => d.value - smoothed[i]);
  const residualMean = mean(residuals);
  const residualStd = stdDev(residuals, residualMean);

  const anomalies: AnomalyResult[] = [];
  for (let i = 0; i < data.length; i++) {
    const score = residualStd > 0 ? Math.abs(residuals[i] - residualMean) / residualStd : 0;
    if (score > threshold) {
      anomalies.push({
        index: i,
        timestamp: data[i].timestamp,
        value: data[i].value,
        score,
        isAnomaly: true,
      });
    }
  }

  return { smoothed, anomalies };
}

/**
 * EWMA forecast: extrapolate based on last smoothed value and trend.
 */
export function ewmaForecast(
  data: TimeSeriesPoint[],
  alpha = 0.3,
  horizon = 12,
): ForecastPoint[] {
  if (data.length < 2) return [];

  const { smoothed } = ewma(data, alpha);
  const lastSmoothed = smoothed[smoothed.length - 1];

  // Estimate trend from last N smoothed points
  const n = Math.min(smoothed.length, 20);
  const recent = smoothed.slice(-n);
  const slope = (recent[recent.length - 1] - recent[0]) / (n - 1);

  // Estimate forecast error for confidence interval
  const residuals = data.map((d, i) => d.value - smoothed[i]);
  const residualMean = mean(residuals);
  const residualStd = stdDev(residuals, residualMean);

  const lastTs = data[data.length - 1].timestamp;
  const avgInterval = data.length > 1
    ? (data[data.length - 1].timestamp - data[0].timestamp) / (data.length - 1)
    : 3600000; // fallback 1h

  const forecast: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    const predicted = lastSmoothed + slope * h;
    const uncertainty = residualStd * Math.sqrt(h) * 1.96;
    forecast.push({
      timestamp: lastTs + avgInterval * h,
      predicted,
      lower: predicted - uncertainty,
      upper: predicted + uncertainty,
    });
  }

  return forecast;
}

// ─── Holt-Winters (Triple Exponential Smoothing) ───────────────────────────

/**
 * Holt-Winters triple exponential smoothing with additive seasonality.
 * Ideal for shift-based patterns (e.g. 3-shift = seasonLength 3).
 */
export function holtWinters(
  data: TimeSeriesPoint[],
  alpha = 0.3,
  beta = 0.1,
  gamma = 0.3,
  seasonLength = 24,
  threshold = 3.0,
): { smoothed: number[]; anomalies: AnomalyResult[]; forecast: ForecastPoint[] } {
  const n = data.length;
  if (n < seasonLength * 2) {
    // Not enough data for seasonal decomposition, fall back to EWMA
    const ewmaResult = ewma(data, alpha, threshold);
    const fc = ewmaForecast(data, alpha, 12);
    return { smoothed: ewmaResult.smoothed, anomalies: ewmaResult.anomalies, forecast: fc };
  }

  // Initialize level, trend, seasonal
  const values = data.map(d => d.value);
  let level = mean(values.slice(0, seasonLength));
  let trend = 0;
  for (let i = 0; i < seasonLength; i++) {
    trend += (values[seasonLength + i] - values[i]);
  }
  trend /= (seasonLength * seasonLength);

  const seasonal: number[] = new Array(n + 12);
  for (let i = 0; i < seasonLength; i++) {
    seasonal[i] = values[i] - level;
  }

  const smoothed: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const prevLevel = level;
    if (i >= seasonLength) {
      level = alpha * (values[i] - seasonal[i - seasonLength]) + (1 - alpha) * (prevLevel + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
      seasonal[i] = gamma * (values[i] - level) + (1 - gamma) * seasonal[i - seasonLength];
    }
    smoothed[i] = level + trend + (i >= seasonLength ? seasonal[i] : seasonal[i % seasonLength]);
  }

  // Detect anomalies from residuals
  const residuals = values.map((v, i) => v - smoothed[i]);
  const resMean = mean(residuals);
  const resStd = stdDev(residuals, resMean);

  const anomalies: AnomalyResult[] = [];
  for (let i = seasonLength; i < n; i++) {
    const score = resStd > 0 ? Math.abs(residuals[i] - resMean) / resStd : 0;
    if (score > threshold) {
      anomalies.push({
        index: i,
        timestamp: data[i].timestamp,
        value: data[i].value,
        score,
        isAnomaly: true,
      });
    }
  }

  // Forecast
  const lastTs = data[n - 1].timestamp;
  const avgInterval = (data[n - 1].timestamp - data[0].timestamp) / (n - 1);
  const forecast: ForecastPoint[] = [];
  const uncertainty = resStd * 1.96;

  for (let h = 1; h <= 12; h++) {
    const seasonIdx = ((n - seasonLength + h - 1) % seasonLength + seasonLength) % seasonLength;
    const predicted = level + trend * h + seasonal[n - seasonLength + seasonIdx];
    forecast.push({
      timestamp: lastTs + avgInterval * h,
      predicted,
      lower: predicted - uncertainty * Math.sqrt(h),
      upper: predicted + uncertainty * Math.sqrt(h),
    });
  }

  return { smoothed, anomalies, forecast };
}

// ─── Isolation Forest ──────────────────────────────────────────────────────

interface IsolationTreeNode {
  splitFeature?: string;
  splitValue?: number;
  left?: IsolationTreeNode;
  right?: IsolationTreeNode;
  size?: number; // leaf size for external nodes
}

/**
 * Build a single isolation tree from multivariate data.
 */
function buildIsolationTree(
  data: MultivariatePoint[],
  features: string[],
  maxDepth: number,
  currentDepth = 0,
): IsolationTreeNode {
  if (data.length <= 1 || currentDepth >= maxDepth) {
    return { size: data.length };
  }

  // Random feature
  const feature = features[Math.floor(Math.random() * features.length)];
  const featureValues = data.map(d => d.values[feature]).filter(v => v !== undefined);
  if (featureValues.length === 0) return { size: data.length };

  const minVal = Math.min(...featureValues);
  const maxVal = Math.max(...featureValues);

  if (minVal === maxVal) return { size: data.length };

  const splitValue = minVal + Math.random() * (maxVal - minVal);

  const left = data.filter(d => (d.values[feature] ?? 0) < splitValue);
  const right = data.filter(d => (d.values[feature] ?? 0) >= splitValue);

  return {
    splitFeature: feature,
    splitValue,
    left: buildIsolationTree(left, features, maxDepth, currentDepth + 1),
    right: buildIsolationTree(right, features, maxDepth, currentDepth + 1),
  };
}

/**
 * Compute path length for a point in an isolation tree.
 */
function pathLength(point: MultivariatePoint, node: IsolationTreeNode, currentDepth = 0): number {
  if (node.size !== undefined) {
    // External node — add average path length for remaining items
    return currentDepth + averagePathLength(node.size);
  }

  const val = point.values[node.splitFeature!] ?? 0;
  if (val < node.splitValue!) {
    return pathLength(point, node.left!, currentDepth + 1);
  }
  return pathLength(point, node.right!, currentDepth + 1);
}

/**
 * Average path length of unsuccessful search in BST (Eq. 1 from Isolation Forest paper).
 */
function averagePathLength(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * (Math.log(n - 1) + 0.5772156649) - 2 * (n - 1) / n;
}

/**
 * Isolation Forest anomaly detection for multivariate time series.
 * Score range: close to 1 = anomaly, close to 0.5 = normal, close to 0 = very normal.
 */
export function isolationForest(
  data: MultivariatePoint[],
  numTrees = 100,
  sampleSize = 256,
  threshold = 0.65,
): AnomalyResult[] {
  if (data.length === 0) return [];

  const features = Object.keys(data[0].values);
  if (features.length === 0) return [];

  const effectiveSample = Math.min(sampleSize, data.length);
  const maxDepth = Math.ceil(Math.log2(effectiveSample));

  // Build forest
  const trees: IsolationTreeNode[] = [];
  for (let t = 0; t < numTrees; t++) {
    // Random subsample
    const sample: MultivariatePoint[] = [];
    for (let i = 0; i < effectiveSample; i++) {
      sample.push(data[Math.floor(Math.random() * data.length)]);
    }
    trees.push(buildIsolationTree(sample, features, maxDepth));
  }

  // Score each point
  const c = averagePathLength(effectiveSample);
  const results: AnomalyResult[] = [];

  for (let i = 0; i < data.length; i++) {
    const avgPath = trees.reduce((sum, tree) => sum + pathLength(data[i], tree), 0) / numTrees;
    const score = Math.pow(2, -avgPath / c);

    if (score > threshold) {
      // Use the first feature value as the representative value
      const firstVal = data[i].values[features[0]] ?? 0;
      results.push({
        index: i,
        timestamp: data[i].timestamp,
        value: firstVal,
        score,
        isAnomaly: true,
      });
    }
  }

  return results;
}

// ─── Seasonal Decomposition ───────────────────────────────────────────────

/**
 * Additive seasonal decomposition: Y = Trend + Seasonal + Residual.
 * Uses centered moving average for trend extraction.
 */
export function seasonalDecompose(
  data: TimeSeriesPoint[],
  period = 24,
): DecompositionResult {
  const n = data.length;
  const values = data.map(d => d.value);

  // 1. Trend via centered moving average
  const trend: number[] = new Array(n).fill(NaN);
  const halfP = Math.floor(period / 2);
  for (let i = halfP; i < n - halfP; i++) {
    let sum = 0;
    for (let j = -halfP; j <= halfP; j++) {
      sum += values[i + j];
    }
    trend[i] = sum / (2 * halfP + 1);
  }

  // Fill edges with nearest good value
  for (let i = 0; i < halfP; i++) trend[i] = trend[halfP];
  for (let i = n - halfP; i < n; i++) trend[i] = trend[n - halfP - 1];

  // 2. Detrend
  const detrended = values.map((v, i) => v - trend[i]);

  // 3. Seasonal component: average detrended by period position
  const seasonalAvg: number[] = new Array(period).fill(0);
  const seasonalCount: number[] = new Array(period).fill(0);
  for (let i = 0; i < n; i++) {
    const pos = i % period;
    seasonalAvg[pos] += detrended[i];
    seasonalCount[pos]++;
  }
  for (let i = 0; i < period; i++) {
    seasonalAvg[i] = seasonalCount[i] > 0 ? seasonalAvg[i] / seasonalCount[i] : 0;
  }

  // Center seasonal (sum to 0)
  const seasonalMean = mean(seasonalAvg);
  const seasonal = data.map((_, i) => seasonalAvg[i % period] - seasonalMean);

  // 4. Residual
  const residual = values.map((v, i) => v - trend[i] - seasonal[i]);

  return {
    trend,
    seasonal,
    residual,
    timestamps: data.map(d => d.timestamp),
  };
}

// ─── Change Point Detection (CUSUM) ───────────────────────────────────────

/**
 * CUSUM (Cumulative Sum Control Chart) change point detection.
 * Detects sudden shifts in the mean of a time series.
 */
export function detectChangePoints(
  data: TimeSeriesPoint[],
  threshold = 4.0,
): ChangePointResult[] {
  if (data.length < 10) return [];

  const values = data.map(d => d.value);
  const m = mean(values);
  const s = stdDev(values, m);
  if (s === 0) return [];

  // Standardize
  const z = values.map(v => (v - m) / s);

  // CUSUM
  let cusumPos = 0;
  let cusumNeg = 0;
  const drift = 0.5; // slack value (allowance)

  const changePoints: ChangePointResult[] = [];

  for (let i = 1; i < z.length; i++) {
    cusumPos = Math.max(0, cusumPos + z[i] - drift);
    cusumNeg = Math.min(0, cusumNeg + z[i] + drift);

    if (cusumPos > threshold) {
      changePoints.push({
        index: i,
        timestamp: data[i].timestamp,
        cumulativeSum: cusumPos,
        direction: "increase",
      });
      cusumPos = 0; // reset after detection
    }

    if (cusumNeg < -threshold) {
      changePoints.push({
        index: i,
        timestamp: data[i].timestamp,
        cumulativeSum: cusumNeg,
        direction: "decrease",
      });
      cusumNeg = 0; // reset after detection
    }
  }

  return changePoints;
}

// ─── Linear Regression (for trend) ────────────────────────────────────────

function linearRegression(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

// ─── Unified Analysis API ──────────────────────────────────────────────────

/**
 * Main entry: run time series analysis with the chosen algorithm.
 */
export function analyzeTimeSeries(
  data: TimeSeriesPoint[],
  options: AnalysisOptions,
): TimeSeriesAnalysis {
  const {
    algorithm,
    alpha = 0.3,
    beta = 0.1,
    gamma = 0.3,
    seasonLength = 24,
    threshold = 3.0,
    horizon = 12,
  } = options;

  const values = data.map(d => d.value);
  const m = mean(values);
  const s = stdDev(values, m);
  const { slope } = linearRegression(values);

  const trendDirection: "increasing" | "decreasing" | "stable" =
    slope > 0.01 ? "increasing" : slope < -0.01 ? "decreasing" : "stable";

  let anomalies: AnomalyResult[] = [];
  let forecast: ForecastPoint[] = [];
  let decomposition: DecompositionResult | undefined;
  let changePoints: ChangePointResult[] | undefined;

  switch (algorithm) {
    case "ewma": {
      const result = ewma(data, alpha, threshold);
      anomalies = result.anomalies;
      forecast = ewmaForecast(data, alpha, horizon);
      break;
    }

    case "holt_winters": {
      const result = holtWinters(data, alpha, beta, gamma, seasonLength, threshold);
      anomalies = result.anomalies;
      forecast = result.forecast;
      break;
    }

    case "isolation_forest": {
      // Convert univariate to multivariate
      const mvData: MultivariatePoint[] = data.map(d => ({
        timestamp: d.timestamp,
        values: { value: d.value },
      }));
      anomalies = isolationForest(
        mvData,
        options.numTrees,
        options.sampleSize,
        threshold > 1 ? 0.65 : threshold,
      );
      // EWMA forecast as complement
      forecast = ewmaForecast(data, alpha, horizon);
      break;
    }

    case "seasonal_decompose": {
      decomposition = seasonalDecompose(data, seasonLength);
      // Anomalies from residuals
      const resMean = mean(decomposition.residual);
      const resStd = stdDev(decomposition.residual, resMean);
      for (let i = 0; i < data.length; i++) {
        const score = resStd > 0
          ? Math.abs(decomposition.residual[i] - resMean) / resStd
          : 0;
        if (score > threshold) {
          anomalies.push({
            index: i,
            timestamp: data[i].timestamp,
            value: data[i].value,
            score,
            isAnomaly: true,
          });
        }
      }
      forecast = ewmaForecast(data, alpha, horizon);
      break;
    }

    case "change_point": {
      changePoints = detectChangePoints(data, threshold);
      // Map change points to anomaly format too
      anomalies = changePoints.map(cp => ({
        index: cp.index,
        timestamp: cp.timestamp,
        value: data[cp.index].value,
        score: Math.abs(cp.cumulativeSum),
        isAnomaly: true,
      }));
      forecast = ewmaForecast(data, alpha, horizon);
      break;
    }
  }

  return {
    algorithm,
    anomalies,
    forecast,
    decomposition,
    changePoints,
    summary: {
      totalPoints: data.length,
      anomalyCount: anomalies.length,
      meanValue: m,
      stdDevValue: s,
      trendDirection,
      trendSlope: slope,
    },
  };
}

/**
 * Multivariate anomaly detection using Isolation Forest.
 */
export function analyzeMultivariate(
  data: MultivariatePoint[],
  options?: { numTrees?: number; sampleSize?: number; threshold?: number },
): AnomalyResult[] {
  return isolationForest(
    data,
    options?.numTrees ?? 100,
    options?.sampleSize ?? 256,
    options?.threshold ?? 0.65,
  );
}

/**
 * Convenience: forecast with confidence intervals.
 */
export function forecastWithConfidenceInterval(
  data: TimeSeriesPoint[],
  horizon = 12,
  algorithm: "ewma" | "holt_winters" = "ewma",
  options?: Partial<AnalysisOptions>,
): ForecastPoint[] {
  if (algorithm === "holt_winters") {
    const result = holtWinters(
      data,
      options?.alpha ?? 0.3,
      options?.beta ?? 0.1,
      options?.gamma ?? 0.3,
      options?.seasonLength ?? 24,
    );
    return result.forecast.slice(0, horizon);
  }
  return ewmaForecast(data, options?.alpha ?? 0.3, horizon);
}
