/**
 * Shared SPC (Statistical Process Control) utility functions.
 * Used by both spcAdvancedRouter and stationAnalysisRouter.
 */
import { sixSigmaFromCounts } from "./kpi";

// ═══════════════════════════════════════════════════════════════════════════════
// Statistical Utility Functions
// ═══════════════════════════════════════════════════════════════════════════════

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdDev(values: number[], m: number, sample = true): number {
  if (values.length < 2) return 0;
  const divisor = sample ? values.length - 1 : values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / divisor);
}

function skewness(values: number[]): number {
  const n = values.length;
  if (n < 3) return 0;
  const m = mean(values);
  const s = stdDev(values, m, false);
  if (s <= 0) return 0;
  const m3 = values.reduce((acc, v) => acc + ((v - m) / s) ** 3, 0) / n;
  return m3;
}

function boxCoxTransform(x: number, lambda: number): number {
  if (Math.abs(lambda) < 1e-9) return Math.log(x);
  return (Math.pow(x, lambda) - 1) / lambda;
}

function findBestBoxCoxLambda(values: number[]): { lambda: number; transformed: number[]; shift: number } {
  const minVal = Math.min(...values);
  const shift = minVal <= 0 ? 1 - minVal : 0;
  const shifted = values.map(v => v + shift);

  let bestLambda = 1;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestTransformed = [...values];

  for (let lambda = -2; lambda <= 2.0001; lambda += 0.1) {
    const rounded = Math.round(lambda * 10) / 10;
    const transformed = shifted.map(v => boxCoxTransform(v, rounded));
    const score = Math.abs(skewness(transformed));
    if (Number.isFinite(score) && score < bestScore) {
      bestScore = score;
      bestLambda = rounded;
      bestTransformed = transformed;
    }
  }

  return { lambda: bestLambda, transformed: bestTransformed, shift };
}

// ─── Control Chart Constants (d2, D3, D4, A2 for subgroup sizes 2-25) ───────
export const d2Table: Record<number, number> = {
  2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326, 6: 2.534, 7: 2.704, 8: 2.847,
  9: 2.970, 10: 3.078, 11: 3.173, 12: 3.258, 13: 3.336, 14: 3.407, 15: 3.472,
  16: 3.532, 17: 3.588, 18: 3.640, 19: 3.689, 20: 3.735, 21: 3.778, 22: 3.819,
  23: 3.858, 24: 3.895, 25: 3.931,
};
export const D3Table: Record<number, number> = {
  2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0.076, 8: 0.136, 9: 0.184, 10: 0.223,
  11: 0.256, 12: 0.283, 13: 0.307, 14: 0.328, 15: 0.347, 16: 0.363, 17: 0.378,
  18: 0.391, 19: 0.403, 20: 0.415, 21: 0.425, 22: 0.434, 23: 0.443, 24: 0.451,
  25: 0.459,
};
export const D4Table: Record<number, number> = {
  2: 3.267, 3: 2.574, 4: 2.282, 5: 2.114, 6: 2.004, 7: 1.924, 8: 1.864,
  9: 1.816, 10: 1.777, 11: 1.744, 12: 1.717, 13: 1.693, 14: 1.672, 15: 1.653,
  16: 1.637, 17: 1.622, 18: 1.608, 19: 1.597, 20: 1.585, 21: 1.575, 22: 1.566,
  23: 1.557, 24: 1.549, 25: 1.541,
};
export const A2Table: Record<number, number> = {
  2: 1.880, 3: 1.023, 4: 0.729, 5: 0.577, 6: 0.483, 7: 0.419, 8: 0.373,
  9: 0.337, 10: 0.308, 11: 0.285, 12: 0.266, 13: 0.249, 14: 0.235, 15: 0.223,
  16: 0.212, 17: 0.203, 18: 0.194, 19: 0.187, 20: 0.180, 21: 0.173, 22: 0.167,
  23: 0.162, 24: 0.157, 25: 0.153,
};

// ─── X-bar/S chart constants (A3, c4, B3, B4) for subgroup sizes 2-25 ────────
export const A3Table: Record<number, number> = {
  2: 2.659, 3: 1.954, 4: 1.628, 5: 1.427, 6: 1.287, 7: 1.182, 8: 1.099,
  9: 1.032, 10: 0.975, 11: 0.927, 12: 0.886, 13: 0.850, 14: 0.817, 15: 0.789,
  16: 0.763, 17: 0.739, 18: 0.718, 19: 0.698, 20: 0.680, 21: 0.663, 22: 0.647,
  23: 0.633, 24: 0.619, 25: 0.606,
};
// c4 (unbiasing constant for within-subgroup sigma estimate = S̄/c4)
export const c4Table: Record<number, number> = {
  2: 0.7979, 3: 0.8862, 4: 0.9213, 5: 0.9400, 6: 0.9515, 7: 0.9594, 8: 0.9650,
  9: 0.9693, 10: 0.9727, 11: 0.9754, 12: 0.9776, 13: 0.9794, 14: 0.9810, 15: 0.9823,
  16: 0.9835, 17: 0.9845, 18: 0.9854, 19: 0.9862, 20: 0.9869, 21: 0.9876, 22: 0.9882,
  23: 0.9887, 24: 0.9892, 25: 0.9896,
};
export const B3Table: Record<number, number> = {
  2: 0, 3: 0, 4: 0, 5: 0, 6: 0.030, 7: 0.118, 8: 0.185, 9: 0.239, 10: 0.284,
  11: 0.321, 12: 0.354, 13: 0.382, 14: 0.406, 15: 0.428, 16: 0.448, 17: 0.466,
  18: 0.482, 19: 0.497, 20: 0.510, 21: 0.523, 22: 0.534, 23: 0.545, 24: 0.555,
  25: 0.565,
};
export const B4Table: Record<number, number> = {
  2: 3.267, 3: 2.568, 4: 2.266, 5: 2.089, 6: 1.970, 7: 1.882, 8: 1.815,
  9: 1.761, 10: 1.716, 11: 1.679, 12: 1.646, 13: 1.618, 14: 1.594, 15: 1.572,
  16: 1.552, 17: 1.534, 18: 1.518, 19: 1.503, 20: 1.490, 21: 1.477, 22: 1.466,
  23: 1.455, 24: 1.445, 25: 1.435,
};

// I-MR (Individuals/Moving Range) constants: moving range span = 2 → d2 = 1.128, D4 = 3.267
export const MR_D2 = 1.128;
export const MR_D4 = 3.267;
export const MR_D3 = 0;

// ═══════════════════════════════════════════════════════════════════════════════
// Subgroup & Control Limit Computation
// ═══════════════════════════════════════════════════════════════════════════════

export interface SubgroupStats {
  index: number;
  values: number[];
  mean: number;
  range: number;
  timestamp: Date;
}

export function createSubgroups(data: { value: number; inspectionTime: Date }[], size: number): SubgroupStats[] {
  const groups: SubgroupStats[] = [];
  for (let i = 0; i + size <= data.length; i += size) {
    const slice = data.slice(i, i + size);
    const vals = slice.map(d => d.value);
    const m = mean(vals);
    const r = Math.max(...vals) - Math.min(...vals);
    groups.push({ index: groups.length, values: vals, mean: m, range: r, timestamp: slice[0].inspectionTime });
  }
  return groups;
}

export interface ControlLimits {
  xBar: { UCL: number; CL: number; LCL: number };
  range: { UCL: number; CL: number; LCL: number };
  estimatedSigma: number;
}

export function computeControlLimits(subgroups: SubgroupStats[], size: number): ControlLimits {
  const xbarValues = subgroups.map(g => g.mean);
  const rangeValues = subgroups.map(g => g.range);
  const xBarBar = mean(xbarValues);
  const rBar = mean(rangeValues);
  const A2 = A2Table[size] ?? 0.577;
  const D3 = D3Table[size] ?? 0;
  const D4 = D4Table[size] ?? 2.114;
  const d2 = d2Table[size] ?? 2.326;

  return {
    xBar: { UCL: xBarBar + A2 * rBar, CL: xBarBar, LCL: xBarBar - A2 * rBar },
    range: { UCL: D4 * rBar, CL: rBar, LCL: D3 * rBar },
    estimatedSigma: rBar / d2,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPC Rule Violations
// ═══════════════════════════════════════════════════════════════════════════════

export interface RuleViolation {
  ruleType: string;
  ruleName: string;
  ruleDescription: string;
  severity: "info" | "warning" | "critical";
  violatingIndices: number[];
  violatingValues: number[];
}

export function checkWesternElectricRules(values: number[], cl: number, sigma: number): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const n = values.length;

  // Rule 1: One point beyond 3σ
  for (let i = 0; i < n; i++) {
    if (Math.abs(values[i] - cl) > 3 * sigma) {
      violations.push({
        ruleType: 'western_electric_1', ruleName: 'WE Rule 1: Beyond 3σ',
        ruleDescription: `Point at index ${i} (value=${values[i].toFixed(4)}) is beyond 3σ from center line`,
        severity: 'critical', violatingIndices: [i], violatingValues: [values[i]],
      });
    }
  }

  // Rule 2: 2 of 3 consecutive points beyond 2σ on same side
  for (let i = 2; i < n; i++) {
    const window = [values[i - 2], values[i - 1], values[i]];
    const above2s = window.filter(v => v > cl + 2 * sigma).length;
    const below2s = window.filter(v => v < cl - 2 * sigma).length;
    if (above2s >= 2 || below2s >= 2) {
      violations.push({
        ruleType: 'western_electric_2', ruleName: 'WE Rule 2: 2/3 beyond 2σ',
        ruleDescription: `2 of 3 consecutive points beyond 2σ at indices ${i - 2}-${i}`,
        severity: 'warning', violatingIndices: [i - 2, i - 1, i], violatingValues: window,
      });
    }
  }

  // Rule 3: 4 of 5 consecutive points beyond 1σ on same side
  for (let i = 4; i < n; i++) {
    const window = values.slice(i - 4, i + 1);
    const above1s = window.filter(v => v > cl + sigma).length;
    const below1s = window.filter(v => v < cl - sigma).length;
    if (above1s >= 4 || below1s >= 4) {
      violations.push({
        ruleType: 'western_electric_3', ruleName: 'WE Rule 3: 4/5 beyond 1σ',
        ruleDescription: `4 of 5 consecutive points beyond 1σ at indices ${i - 4}-${i}`,
        severity: 'warning', violatingIndices: Array.from({ length: 5 }, (_, k) => i - 4 + k), violatingValues: window,
      });
    }
  }

  // Rule 4: 8 consecutive points on same side of center line
  for (let i = 7; i < n; i++) {
    const window = values.slice(i - 7, i + 1);
    const allAbove = window.every(v => v > cl);
    const allBelow = window.every(v => v < cl);
    if (allAbove || allBelow) {
      violations.push({
        ruleType: 'western_electric_4', ruleName: 'WE Rule 4: 8 consecutive same side',
        ruleDescription: `8 consecutive points ${allAbove ? 'above' : 'below'} center line at indices ${i - 7}-${i}`,
        severity: 'warning', violatingIndices: Array.from({ length: 8 }, (_, k) => i - 7 + k), violatingValues: window,
      });
    }
  }

  return violations;
}

export function checkNelsonRules(values: number[], cl: number, sigma: number): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const n = values.length;

  // Nelson Rule 2: 9 consecutive points on same side
  for (let i = 8; i < n; i++) {
    const window = values.slice(i - 8, i + 1);
    if (window.every(v => v > cl) || window.every(v => v < cl)) {
      violations.push({
        ruleType: 'nelson_2', ruleName: 'Nelson Rule 2: 9 pts same side',
        ruleDescription: `9 consecutive points on same side of center line at indices ${i - 8}-${i}`,
        severity: 'warning', violatingIndices: Array.from({ length: 9 }, (_, k) => i - 8 + k), violatingValues: window,
      });
    }
  }

  // Nelson Rule 3: 6 consecutive increasing or decreasing
  for (let i = 5; i < n; i++) {
    const window = values.slice(i - 5, i + 1);
    let increasing = true, decreasing = true;
    for (let j = 1; j < window.length; j++) {
      if (window[j] <= window[j - 1]) increasing = false;
      if (window[j] >= window[j - 1]) decreasing = false;
    }
    if (increasing || decreasing) {
      violations.push({
        ruleType: 'nelson_3', ruleName: `Nelson Rule 3: 6 pts ${increasing ? 'increasing' : 'decreasing'}`,
        ruleDescription: `6 consecutive ${increasing ? 'increasing' : 'decreasing'} points at indices ${i - 5}-${i}`,
        severity: 'warning', violatingIndices: Array.from({ length: 6 }, (_, k) => i - 5 + k), violatingValues: window,
      });
    }
  }

  // Nelson Rule 4: 14 consecutive alternating up/down
  for (let i = 13; i < n; i++) {
    const window = values.slice(i - 13, i + 1);
    let alternating = true;
    for (let j = 2; j < window.length; j++) {
      const dir1 = window[j - 1] - window[j - 2];
      const dir2 = window[j] - window[j - 1];
      if (dir1 * dir2 >= 0) { alternating = false; break; }
    }
    if (alternating) {
      violations.push({
        ruleType: 'nelson_4', ruleName: 'Nelson Rule 4: 14 pts alternating',
        ruleDescription: `14 consecutive alternating points at indices ${i - 13}-${i}`,
        severity: 'info', violatingIndices: Array.from({ length: 14 }, (_, k) => i - 13 + k), violatingValues: window,
      });
    }
  }

  // Nelson Rule 7: 15 consecutive within 1σ (stratification)
  for (let i = 14; i < n; i++) {
    const window = values.slice(i - 14, i + 1);
    if (window.every(v => Math.abs(v - cl) < sigma)) {
      violations.push({
        ruleType: 'nelson_7', ruleName: 'Nelson Rule 7: 15 pts within 1σ',
        ruleDescription: `15 consecutive points within 1σ (stratification) at indices ${i - 14}-${i}`,
        severity: 'info', violatingIndices: Array.from({ length: 15 }, (_, k) => i - 14 + k), violatingValues: window,
      });
    }
  }

  // Nelson Rule 8: 8 consecutive beyond 1σ on both sides (mixture)
  for (let i = 7; i < n; i++) {
    const window = values.slice(i - 7, i + 1);
    if (window.every(v => Math.abs(v - cl) > sigma)) {
      violations.push({
        ruleType: 'nelson_8', ruleName: 'Nelson Rule 8: 8 pts beyond 1σ both sides',
        ruleDescription: `8 consecutive points beyond 1σ on both sides (mixture) at indices ${i - 7}-${i}`,
        severity: 'warning', violatingIndices: Array.from({ length: 8 }, (_, k) => i - 7 + k), violatingValues: window,
      });
    }
  }

  return violations;
}

/**
 * Detect all 8 SPC rules, filtered by enabledRules array.
 * Rule mapping:
 * 1 = Beyond 3σ (WE1), 2 = 9 consecutive same side (Nelson 2),
 * 3 = 6 trending (Nelson 3), 4 = 14 alternating (Nelson 4),
 * 5 = 2/3 beyond 2σ (WE2), 6 = 4/5 beyond 1σ (WE3),
 * 7 = 15 within 1σ stratification (Nelson 7), 8 = 8 beyond 1σ mixture (Nelson 8)
 */
export function detectAllSpcRules(
  values: number[],
  cl: number,
  sigma: number,
  enabledRules: number[] = [1, 2, 3, 4, 5, 6, 7, 8],
): Map<number, number[]> {
  const ruleMap = new Map<number, number[]>();
  const n = values.length;

  const addViolation = (idx: number, rule: number) => {
    if (!enabledRules.includes(rule)) return;
    if (!ruleMap.has(idx)) ruleMap.set(idx, []);
    ruleMap.get(idx)!.push(rule);
  };

  for (let i = 0; i < n; i++) {
    const v = values[i];

    // Rule 1: 1 point beyond 3σ
    if (v > cl + 3 * sigma || v < cl - 3 * sigma) addViolation(i, 1);

    // Rule 2: 9 consecutive same side
    if (i >= 8) {
      const w = values.slice(i - 8, i + 1);
      if (w.every(x => x > cl) || w.every(x => x < cl)) {
        for (let j = i - 8; j <= i; j++) addViolation(j, 2);
      }
    }

    // Rule 3: 6 consecutive trending
    if (i >= 5) {
      const w = values.slice(i - 5, i + 1);
      let inc = true, dec = true;
      for (let j = 1; j < w.length; j++) {
        if (w[j] <= w[j - 1]) inc = false;
        if (w[j] >= w[j - 1]) dec = false;
      }
      if (inc || dec) for (let j = i - 5; j <= i; j++) addViolation(j, 3);
    }

    // Rule 4: 14 alternating
    if (i >= 13) {
      const w = values.slice(i - 13, i + 1);
      let alt = true;
      for (let j = 2; j < w.length; j++) {
        if ((w[j - 1] - w[j - 2]) * (w[j] - w[j - 1]) >= 0) { alt = false; break; }
      }
      if (alt) for (let j = i - 13; j <= i; j++) addViolation(j, 4);
    }

    // Rule 5: 2/3 beyond 2σ same side
    if (i >= 2) {
      const w = [values[i - 2], values[i - 1], values[i]];
      const a2 = w.filter(x => x > cl + 2 * sigma).length;
      const b2 = w.filter(x => x < cl - 2 * sigma).length;
      if (a2 >= 2 || b2 >= 2) for (let j = i - 2; j <= i; j++) addViolation(j, 5);
    }

    // Rule 6: 4/5 beyond 1σ same side
    if (i >= 4) {
      const w = values.slice(i - 4, i + 1);
      const a1 = w.filter(x => x > cl + sigma).length;
      const b1 = w.filter(x => x < cl - sigma).length;
      if (a1 >= 4 || b1 >= 4) for (let j = i - 4; j <= i; j++) addViolation(j, 6);
    }

    // Rule 7: 15 within 1σ (stratification)
    if (i >= 14) {
      const w = values.slice(i - 14, i + 1);
      if (w.every(x => Math.abs(x - cl) <= sigma)) {
        for (let j = i - 14; j <= i; j++) addViolation(j, 7);
      }
    }

    // Rule 8: 8 beyond 1σ both sides (mixture)
    if (i >= 7) {
      const w = values.slice(i - 7, i + 1);
      if (w.every(x => Math.abs(x - cl) > sigma)) {
        for (let j = i - 7; j <= i; j++) addViolation(j, 8);
      }
    }
  }

  return ruleMap;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Capability Indices
// ═══════════════════════════════════════════════════════════════════════════════

export function calculateCapabilityIndices(
  values: number[],
  usl: number | null,
  lsl: number | null,
  estimatedSigma: number,
) {
  const m = mean(values);
  const s = stdDev(values, m);

  // Auto-switch to Box-Cox when distribution is likely non-normal.
  // Keep legacy behavior for small samples to avoid overfitting transforms.
  const shouldBoxCox = values.length >= 10 && Math.abs(skewness(values)) > 0.5;
  let workingValues = values;
  let workingUsl = usl;
  let workingLsl = lsl;
  let workingEstimatedSigma = estimatedSigma;
  let workingMean = m;
  let workingStdDev = s;

  if (shouldBoxCox) {
    const { lambda, transformed, shift } = findBestBoxCoxLambda(values);
    workingValues = transformed;
    workingMean = mean(workingValues);
    workingStdDev = stdDev(workingValues, workingMean);

    if (estimatedSigma > 0) {
      const sigmaHi = mean(values) + estimatedSigma;
      const sigmaLo = mean(values) - estimatedSigma;
      const hiShifted = sigmaHi + shift;
      const loShifted = sigmaLo + shift;
      if (hiShifted > 0 && loShifted > 0) {
        const hiT = boxCoxTransform(hiShifted, lambda);
        const loT = boxCoxTransform(loShifted, lambda);
        workingEstimatedSigma = Math.abs(hiT - loT) / 2;
      }
    }

    if (usl !== null) {
      const u = usl + shift;
      if (u > 0) workingUsl = boxCoxTransform(u, lambda);
    }
    if (lsl !== null) {
      const l = lsl + shift;
      if (l > 0) workingLsl = boxCoxTransform(l, lambda);
    }
  }

  let cp: number | null = null;
  let cpk: number | null = null;
  let pp: number | null = null;
  let ppk: number | null = null;
  let cpu: number | null = null;
  let cpl: number | null = null;

  if (workingUsl !== null && workingLsl !== null && workingEstimatedSigma > 0) {
    cp = (workingUsl - workingLsl) / (6 * workingEstimatedSigma);
    cpu = (workingUsl - workingMean) / (3 * workingEstimatedSigma);
    cpl = (workingMean - workingLsl) / (3 * workingEstimatedSigma);
    cpk = Math.min(cpu, cpl);
  } else if (workingUsl !== null && workingEstimatedSigma > 0) {
    cpu = (workingUsl - workingMean) / (3 * workingEstimatedSigma);
    cpk = cpu;
  } else if (workingLsl !== null && workingEstimatedSigma > 0) {
    cpl = (workingMean - workingLsl) / (3 * workingEstimatedSigma);
    cpk = cpl;
  }

  if (workingUsl !== null && workingLsl !== null && workingStdDev > 0) {
    pp = (workingUsl - workingLsl) / (6 * workingStdDev);
    ppk = Math.min((workingUsl - workingMean) / (3 * workingStdDev), (workingMean - workingLsl) / (3 * workingStdDev));
  }

  return { cp, cpk, pp, ppk, cpu, cpl, mean: m, overallStdDev: s };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Histogram Bin Computation
// ═══════════════════════════════════════════════════════════════════════════════

export function computeHistogramBins(values: number[], binCount = 20) {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const binWidth = range / binCount;

  const bins = Array.from({ length: binCount }, (_, i) => ({
    binStart: Math.round((min + i * binWidth) * 10000) / 10000,
    binEnd: Math.round((min + (i + 1) * binWidth) * 10000) / 10000,
    binMid: Math.round((min + (i + 0.5) * binWidth) * 10000) / 10000,
    label: `${(min + i * binWidth).toFixed(2)}-${(min + (i + 1) * binWidth).toFixed(2)}`,
    count: 0,
    frequency: 0,
    normalCount: 0,
  }));

  for (const v of values) {
    let idx = Math.floor((v - min) / binWidth);
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    bins[idx].count++;
  }

  const total = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / total;
  const stddev = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / total);

  for (const b of bins) {
    b.frequency = total > 0 ? b.count / total : 0;
    // Normal distribution overlay
    if (stddev > 0) {
      const normalDensity = (1 / (stddev * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((b.binMid - mean) / stddev) ** 2);
      b.normalCount = Math.round(normalDensity * total * binWidth * 10000) / 10000;
    }
  }

  return bins;
}

export const SPC_RULE_NAMES: Record<number, string> = {
  1: 'Point beyond 3σ',
  2: '9 consecutive same side',
  3: '6 consecutive trending',
  4: '14 alternating up/down',
  5: '2 of 3 beyond 2σ',
  6: '4 of 5 beyond 1σ',
  7: '15 within 1σ (stratification)',
  8: '8 beyond 1σ both sides (mixture)',
};

// ═══════════════════════════════════════════════════════════════════════════════
// DPMO & Sigma Level (Six Sigma metrics)
// Canonical math lives in server/utils/kpi.ts (doc 27 decision #4 / gap A8);
// this module re-exports/delegates so existing SPC callers keep working.
// ═══════════════════════════════════════════════════════════════════════════════

// Inverse standard normal CDF (probit) — moved to kpi.ts, re-exported for back-compat.
export { normInv } from "./kpi";

/**
 * Six Sigma metrics from defect counts.
 * DPMO = defects / (units × opportunitiesPerUnit) × 1e6.
 * Sigma level (with 1.5σ shift convention) = Z(1 - defectRate) + 1.5.
 *
 * `opportunitiesPerUnit` (gap A8) = number of measurement points evaluated
 * per inspected unit. Defaults to 1 for back-compat (a single-point
 * analysis where each sample is exactly one opportunity). Callers that
 * aggregate at inspection/board level MUST pass the evaluated
 * measurement-point count so DPMO is a true per-opportunity rate rather
 * than a defective-PPM. (components × joints modelling deferred to M12.)
 */
export function computeSixSigmaMetrics(defectCount: number, units: number, opportunitiesPerUnit = 1) {
  return sixSigmaFromCounts({ defects: defectCount, units, opportunitiesPerUnit });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Chart generation: X-bar/R, X-bar/S, I-MR
// ═══════════════════════════════════════════════════════════════════════════════

export type ChartType = 'xbar_r' | 'xbar_s' | 'individual_mr';

export interface ChartLimitSet {
  UCL: number;
  CL: number;
  LCL: number;
}

export interface ChartPoint {
  index: number;
  value: number;
  timestamp: Date | null;
  outOfControl: boolean;
  violatedRules: number[];
  ruleDescriptions: string[];
}

export interface GeneratedChart {
  type: ChartType;
  /** Primary chart: X-bar (xbar_r/xbar_s) or Individuals (individual_mr) */
  primary: {
    label: 'xbar' | 'individual';
    limits: ChartLimitSet;
    points: ChartPoint[];
  };
  /** Secondary chart: R, S, or MR */
  secondary: {
    label: 'range' | 'stddev' | 'movingRange';
    limits: ChartLimitSet;
    points: ChartPoint[];
  };
  /** Within-subgroup sigma estimate for the process mean (used for capability) */
  estimatedSigma: number;
  /** Sigma of the plotted primary statistic (used for zone overlays/rule detection) */
  plotSigma: number;
  centerLine: number;
  totalSamples: number;
  totalPoints: number;
}

function round4(v: number): number { return Math.round(v * 10000) / 10000; }

function buildPoints(
  values: number[],
  cl: number,
  sigma: number,
  timestamps: (Date | null)[],
  enabledRules: number[],
): { points: ChartPoint[]; oocCount: number } {
  const ruleMap = sigma > 0 ? detectAllSpcRules(values, cl, sigma, enabledRules) : new Map<number, number[]>();
  let oocCount = 0;
  const points = values.map((v, i) => {
    const rules = [...new Set(ruleMap.get(i) || [])];
    if (rules.length > 0) oocCount++;
    return {
      index: i,
      value: round4(v),
      timestamp: timestamps[i] ?? null,
      outOfControl: rules.length > 0,
      violatedRules: rules,
      ruleDescriptions: rules.map(r => SPC_RULE_NAMES[r] || `Rule ${r}`),
    };
  });
  return { points, oocCount };
}

/**
 * Generate a control chart of the requested type from raw ordered numeric data.
 * - xbar_r:        X-bar/R, sigmâ = R̄/d2
 * - xbar_s:        X-bar/S, sigmâ = S̄/c4
 * - individual_mr: I-MR,    sigmâ = MR̄/1.128
 */
export function generateControlChart(
  data: { value: number; inspectionTime: Date | null }[],
  chartType: ChartType,
  subgroupSize: number,
  enabledRules: number[] = [1, 2, 3, 4, 5, 6, 7, 8],
): GeneratedChart | null {
  if (chartType === 'individual_mr') {
    if (data.length < 2) return null;
    const values = data.map(d => d.value);
    const ts = data.map(d => d.inspectionTime);
    const movingRanges = values.slice(1).map((v, i) => Math.abs(v - values[i]));
    const xBar = mean(values);
    const mrBar = mean(movingRanges);
    const estimatedSigma = mrBar / MR_D2;

    const iLimits: ChartLimitSet = {
      UCL: xBar + 3 * estimatedSigma,
      CL: xBar,
      LCL: xBar - 3 * estimatedSigma,
    };
    const mrLimits: ChartLimitSet = {
      UCL: MR_D4 * mrBar,
      CL: mrBar,
      LCL: MR_D3 * mrBar,
    };

    const primary = buildPoints(values, iLimits.CL, estimatedSigma, ts, enabledRules);
    // MR has 1 fewer point; align timestamps to the second sample onward
    const mrSigma = mrBar > 0 ? (mrLimits.UCL - mrLimits.CL) / 3 : 0;
    const secondary = buildPoints(movingRanges, mrLimits.CL, mrSigma, ts.slice(1), enabledRules);

    return {
      type: chartType,
      primary: { label: 'individual', limits: roundLimits(iLimits), points: primary.points },
      secondary: { label: 'movingRange', limits: roundLimits(mrLimits), points: secondary.points },
      estimatedSigma: round4(estimatedSigma),
      plotSigma: round4(estimatedSigma),
      centerLine: round4(iLimits.CL),
      totalSamples: values.length,
      totalPoints: values.length,
    };
  }

  // Subgroup-based charts (xbar_r / xbar_s)
  const subgroups = createSubgroups(
    data.map(d => ({ value: d.value, inspectionTime: d.inspectionTime ?? new Date(0) })),
    subgroupSize,
  );
  if (subgroups.length < 2) return null;

  const xbarValues = subgroups.map(g => g.mean);
  const ts = subgroups.map(g => g.timestamp);
  const xBarBar = mean(xbarValues);

  let estimatedSigma: number;
  let primaryLimits: ChartLimitSet;
  let secondaryValues: number[];
  let secondaryLimits: ChartLimitSet;
  let secondaryLabel: 'range' | 'stddev';

  if (chartType === 'xbar_s') {
    const sValues = subgroups.map(g => stdDev(g.values, mean(g.values), true));
    const sBar = mean(sValues);
    const c4 = c4Table[subgroupSize] ?? 0.94;
    const A3 = A3Table[subgroupSize] ?? 1.427;
    const B3 = B3Table[subgroupSize] ?? 0;
    const B4 = B4Table[subgroupSize] ?? 2.089;
    estimatedSigma = sBar / c4;
    primaryLimits = { UCL: xBarBar + A3 * sBar, CL: xBarBar, LCL: xBarBar - A3 * sBar };
    secondaryLimits = { UCL: B4 * sBar, CL: sBar, LCL: B3 * sBar };
    secondaryValues = sValues;
    secondaryLabel = 'stddev';
  } else {
    // xbar_r
    const limits = computeControlLimits(subgroups, subgroupSize);
    estimatedSigma = limits.estimatedSigma;
    primaryLimits = limits.xBar;
    secondaryLimits = limits.range;
    secondaryValues = subgroups.map(g => g.range);
    secondaryLabel = 'range';
  }

  // Sigma of the X-bar statistic = estimatedSigma / sqrt(n)
  const plotSigma = estimatedSigma / Math.sqrt(subgroupSize);
  const primary = buildPoints(xbarValues, primaryLimits.CL, plotSigma, ts, enabledRules);
  const secSigma = secondaryLimits.CL > 0 ? (secondaryLimits.UCL - secondaryLimits.CL) / 3 : 0;
  const secondary = buildPoints(secondaryValues, secondaryLimits.CL, secSigma, ts, enabledRules);

  return {
    type: chartType,
    primary: { label: 'xbar', limits: roundLimits(primaryLimits), points: primary.points },
    secondary: { label: secondaryLabel, limits: roundLimits(secondaryLimits), points: secondary.points },
    estimatedSigma: round4(estimatedSigma),
    plotSigma: round4(plotSigma),
    centerLine: round4(primaryLimits.CL),
    totalSamples: data.length,
    totalPoints: subgroups.length,
  };
}

function roundLimits(l: ChartLimitSet): ChartLimitSet {
  return { UCL: round4(l.UCL), CL: round4(l.CL), LCL: round4(l.LCL) };
}
