/**
 * P4.B G12 — Advanced MSA methods for IATF 16949 / AIAG MSA 4th ed.
 *
 * Pure functions (no DB):
 *  - calculateAnovaGrr      → 2-way ANOVA with operator × part interaction
 *  - calculateBias          → bias vs reference value, t-test for significance
 *  - calculateLinearity     → linear regression of bias across reference range
 *  - calculateStability     → control chart of repeated readings of same master gauge
 */

export interface AnovaObservation {
  operator: string;
  part: string;
  trial: number;
  value: number;
}

export interface AnovaSummary {
  // Variance components (variance scale, not std-dev)
  varRepeatability: number;
  varReproducibility: number;
  varInteraction: number;
  varPartToPart: number;
  varTotal: number;
  // Std-devs derived
  ev: number;       // sqrt(varRepeatability)
  av: number;       // sqrt(varReproducibility)
  iv: number;       // sqrt(varInteraction)
  pv: number;       // sqrt(varPartToPart)
  grr: number;      // sqrt(varRepeatability + varReproducibility + varInteraction)
  tv: number;       // sqrt(varTotal)
  // Percent contributions
  evPct: number;
  avPct: number;
  ivPct: number;
  pvPct: number;
  grrPct: number;
  ndc: number | null;
  pTolerance?: number;
  ptRatio?: number;
  verdict: "good" | "acceptable" | "poor" | "insufficient_data";
  notes: string[];
}

/**
 * 2-way ANOVA (random model, with interaction) for Gauge R&R.
 * Reference: AIAG MSA 4th edition Chapter III §B.5.
 *
 * Required: ≥ 2 operators, ≥ 2 parts, ≥ 2 trials per cell.
 */
export function calculateAnovaGrr(
  obs: AnovaObservation[],
  tolerance?: number,
): AnovaSummary {
  const notes: string[] = [];
  const empty: AnovaSummary = {
    varRepeatability: 0, varReproducibility: 0, varInteraction: 0,
    varPartToPart: 0, varTotal: 0,
    ev: 0, av: 0, iv: 0, pv: 0, grr: 0, tv: 0,
    evPct: 0, avPct: 0, ivPct: 0, pvPct: 0, grrPct: 0,
    ndc: null,
    verdict: "insufficient_data",
    notes,
  };
  if (obs.length === 0) {
    notes.push("No observations supplied.");
    return empty;
  }

  const operators = Array.from(new Set(obs.map((o) => o.operator)));
  const parts = Array.from(new Set(obs.map((o) => o.part)));
  const k = operators.length; // number of operators (appraisers)
  const p = parts.length;     // number of parts

  // Determine trials per cell — must be uniform.
  const cellMap = new Map<string, number[]>();
  for (const o of obs) {
    const key = `${o.operator}__${o.part}`;
    if (!cellMap.has(key)) cellMap.set(key, []);
    cellMap.get(key)!.push(o.value);
  }
  const trialsPerCell = Array.from(cellMap.values()).map((arr) => arr.length);
  const r = trialsPerCell[0] ?? 0;
  const uniform = trialsPerCell.every((t) => t === r);
  if (k < 2 || p < 2 || r < 2 || !uniform) {
    notes.push(`Need ≥2 operators, ≥2 parts, ≥2 trials/cell uniformly. Got k=${k}, p=${p}, r=${r}, uniform=${uniform}.`);
    return empty;
  }

  // Cell means y_ij and grand mean
  const cellMean = new Map<string, number>();
  for (const [key, arr] of cellMap.entries()) {
    cellMean.set(key, arr.reduce((a, b) => a + b, 0) / arr.length);
  }
  const N = obs.length;
  const grandMean = obs.reduce((a, b) => a + b.value, 0) / N;

  // Operator means y_i. and Part means y_.j
  const opMean = new Map<string, number>();
  for (const op of operators) {
    const arr = obs.filter((o) => o.operator === op).map((o) => o.value);
    opMean.set(op, arr.reduce((a, b) => a + b, 0) / arr.length);
  }
  const partMean = new Map<string, number>();
  for (const pa of parts) {
    const arr = obs.filter((o) => o.part === pa).map((o) => o.value);
    partMean.set(pa, arr.reduce((a, b) => a + b, 0) / arr.length);
  }

  // Sums of squares
  let SSO = 0; // operator
  for (const op of operators) SSO += (opMean.get(op)! - grandMean) ** 2;
  SSO *= p * r;

  let SSP = 0; // part
  for (const pa of parts) SSP += (partMean.get(pa)! - grandMean) ** 2;
  SSP *= k * r;

  let SSOP = 0; // interaction
  for (const op of operators) {
    for (const pa of parts) {
      const yij = cellMean.get(`${op}__${pa}`)!;
      SSOP += (yij - opMean.get(op)! - partMean.get(pa)! + grandMean) ** 2;
    }
  }
  SSOP *= r;

  let SSE = 0; // repeatability (within-cell)
  for (const o of obs) {
    const yij = cellMean.get(`${o.operator}__${o.part}`)!;
    SSE += (o.value - yij) ** 2;
  }

  // Degrees of freedom
  const dfO = k - 1;
  const dfP = p - 1;
  const dfOP = (k - 1) * (p - 1);
  const dfE = k * p * (r - 1);

  const MSO = SSO / dfO;
  const MSP = SSP / dfP;
  const MSOP = SSOP / dfOP;
  const MSE = SSE / dfE;

  // Variance components (random effects model, AIAG)
  let varInteraction = (MSOP - MSE) / r;
  if (varInteraction < 0) varInteraction = 0;
  let varReproducibility = (MSO - MSOP) / (p * r);
  if (varReproducibility < 0) varReproducibility = 0;
  let varPartToPart = (MSP - MSOP) / (k * r);
  if (varPartToPart < 0) varPartToPart = 0;
  const varRepeatability = MSE;

  const varGrr = varRepeatability + varReproducibility + varInteraction;
  const varTotal = varGrr + varPartToPart;

  const ev = Math.sqrt(varRepeatability);
  const av = Math.sqrt(varReproducibility);
  const iv = Math.sqrt(varInteraction);
  const pv = Math.sqrt(varPartToPart);
  const grr = Math.sqrt(varGrr);
  const tv = Math.sqrt(varTotal);

  const evPct = tv > 0 ? (ev / tv) * 100 : 0;
  const avPct = tv > 0 ? (av / tv) * 100 : 0;
  const ivPct = tv > 0 ? (iv / tv) * 100 : 0;
  const pvPct = tv > 0 ? (pv / tv) * 100 : 0;
  const grrPct = tv > 0 ? (grr / tv) * 100 : 0;
  const ndc = grr > 0 ? Math.floor(1.41 * (pv / grr)) : null;

  const ptRatio = tolerance && tolerance > 0 ? (6 * grr) / tolerance * 100 : undefined;

  let verdict: AnovaSummary["verdict"];
  if (grrPct <= 10) verdict = "good";
  else if (grrPct <= 30) verdict = "acceptable";
  else verdict = "poor";

  if (ndc != null && ndc < 5) {
    notes.push(`NDC=${ndc} < 5 — measurement system may not discriminate parts adequately.`);
  }

  return {
    varRepeatability, varReproducibility, varInteraction,
    varPartToPart, varTotal,
    ev, av, iv, pv, grr, tv,
    evPct, avPct, ivPct, pvPct, grrPct,
    ndc,
    pTolerance: tolerance,
    ptRatio,
    verdict,
    notes,
  };
}

/**
 * Bias study — repeated measurements of a single reference standard with known value.
 */
export interface BiasSummary {
  n: number;
  refValue: number;
  mean: number;
  bias: number;
  stdDev: number;
  tStat: number;
  /** Critical t at α=0.05 (two-tailed) for df=n-1; pre-tabulated for n=2..30, else use 1.96 */
  tCritical: number;
  significant: boolean;
  verdict: "ok" | "biased" | "insufficient_data";
}

const T_TABLE_05: Record<number, number> = {
  1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
  8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145,
  15: 2.131, 16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086,
  21: 2.080, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.060, 26: 2.056,
  27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042,
};

export function calculateBias(values: number[], refValue: number): BiasSummary {
  const n = values.length;
  if (n < 2) {
    return {
      n, refValue,
      mean: n === 1 ? values[0] : NaN,
      bias: n === 1 ? values[0] - refValue : NaN,
      stdDev: NaN, tStat: NaN, tCritical: NaN,
      significant: false, verdict: "insufficient_data",
    };
  }
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const stdDev = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const bias = mean - refValue;
  const tStat = stdDev > 0 ? bias / (stdDev / Math.sqrt(n)) : 0;
  const df = n - 1;
  const tCritical = T_TABLE_05[df] ?? 1.96;
  const significant = Math.abs(tStat) > tCritical;
  return {
    n, refValue, mean, bias, stdDev, tStat, tCritical,
    significant,
    verdict: significant ? "biased" : "ok",
  };
}

/**
 * Linearity study — bias measured across multiple reference values; linear regression.
 */
export interface LinearityPoint {
  refValue: number;
  measurements: number[];
}

export interface LinearitySummary {
  points: Array<{ refValue: number; mean: number; bias: number }>;
  slope: number;        // bias = a + b*refValue → b
  intercept: number;
  rSquared: number;
  /** AIAG: linearity index = |slope| × process variation (here: range of refs). */
  linearityIndex: number;
  verdict: "ok" | "non_linear" | "insufficient_data";
}

export function calculateLinearity(points: LinearityPoint[]): LinearitySummary {
  if (points.length < 2) {
    return {
      points: [], slope: 0, intercept: 0, rSquared: 0,
      linearityIndex: 0, verdict: "insufficient_data",
    };
  }
  const summary = points.map((p) => {
    const mean = p.measurements.reduce((a, b) => a + b, 0) / p.measurements.length;
    return { refValue: p.refValue, mean, bias: mean - p.refValue };
  });
  const n = summary.length;
  const xs = summary.map((s) => s.refValue);
  const ys = summary.map((s) => s.bias);
  const xBar = xs.reduce((a, b) => a + b, 0) / n;
  const yBar = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  let totSS = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xBar) * (ys[i] - yBar);
    den += (xs[i] - xBar) ** 2;
    totSS += (ys[i] - yBar) ** 2;
  }
  const slope = den > 0 ? num / den : 0;
  const intercept = yBar - slope * xBar;
  let resSS = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * xs[i];
    resSS += (ys[i] - pred) ** 2;
  }
  const rSquared = totSS > 0 ? 1 - resSS / totSS : 0;
  const range = Math.max(...xs) - Math.min(...xs);
  const linearityIndex = Math.abs(slope) * range;
  // Heuristic verdict: |slope| > 0.05 OR R² > 0.8 → trend → non-linear bias
  const verdict: LinearitySummary["verdict"] =
    Math.abs(slope) > 0.05 && rSquared > 0.8 ? "non_linear" : "ok";
  return { points: summary, slope, intercept, rSquared, linearityIndex, verdict };
}

/**
 * Stability — repeated readings of master gauge over time; X-bar / R control chart limits.
 */
export interface StabilityReading {
  timestamp: Date;
  values: number[]; // sub-group of repeated readings
}

export interface StabilitySummary {
  subgroups: Array<{ timestamp: Date; mean: number; range: number; outOfControl: boolean }>;
  xBarBar: number;
  rBar: number;
  uclX: number;
  lclX: number;
  uclR: number;
  /** Fraction of subgroups out of control */
  outOfControlPct: number;
  verdict: "stable" | "drift" | "insufficient_data";
}

// Constants for X-bar/R chart (n = subgroup size 2..10)
const A2: Record<number, number> = {
  2: 1.880, 3: 1.023, 4: 0.729, 5: 0.577, 6: 0.483, 7: 0.419,
  8: 0.373, 9: 0.337, 10: 0.308,
};
const D4: Record<number, number> = {
  2: 3.267, 3: 2.574, 4: 2.282, 5: 2.114, 6: 2.004, 7: 1.924,
  8: 1.864, 9: 1.816, 10: 1.777,
};

export function calculateStability(readings: StabilityReading[]): StabilitySummary {
  const empty: StabilitySummary = {
    subgroups: [], xBarBar: 0, rBar: 0, uclX: 0, lclX: 0, uclR: 0,
    outOfControlPct: 0, verdict: "insufficient_data",
  };
  if (readings.length < 2) return empty;
  const subSize = readings[0].values.length;
  if (subSize < 2 || subSize > 10) return empty;
  if (!readings.every((r) => r.values.length === subSize)) return empty;

  const subgroups = readings.map((r) => {
    const mean = r.values.reduce((a, b) => a + b, 0) / r.values.length;
    const range = Math.max(...r.values) - Math.min(...r.values);
    return { timestamp: r.timestamp, mean, range, outOfControl: false };
  });
  const xBarBar = subgroups.reduce((a, b) => a + b.mean, 0) / subgroups.length;
  const rBar = subgroups.reduce((a, b) => a + b.range, 0) / subgroups.length;
  const a2 = A2[subSize];
  const d4 = D4[subSize];
  const uclX = xBarBar + a2 * rBar;
  const lclX = xBarBar - a2 * rBar;
  const uclR = d4 * rBar;
  let ooc = 0;
  for (const sg of subgroups) {
    if (sg.mean > uclX || sg.mean < lclX || sg.range > uclR) {
      sg.outOfControl = true;
      ooc++;
    }
  }
  const outOfControlPct = (ooc / subgroups.length) * 100;
  const verdict: StabilitySummary["verdict"] =
    outOfControlPct === 0 ? "stable" : "drift";
  return { subgroups, xBarBar, rBar, uclX, lclX, uclR, outOfControlPct, verdict };
}
