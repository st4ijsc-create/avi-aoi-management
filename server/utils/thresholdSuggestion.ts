/**
 * P4.C G18 — ML auto-threshold suggestion.
 *
 * Given a stream of measurement values for a single MP, suggest LSL/USL/target
 * using a hybrid of:
 *   - Robust percentile bounds (trimmed P0.135 / P99.865 ~ ±3σ-equivalent)
 *   - Bayesian shrinkage of (mean, sd) toward existing nominal/limits
 *   - Rolling Cp/Cpk against current vs suggested limits
 *
 * Pure functions only — no DB calls. Caller passes in the sample values.
 */

export interface ThresholdInput {
  values: number[];
  /** Existing nominal/target if any. */
  currentNominal?: number | null;
  /** Existing LSL if any. */
  currentLsl?: number | null;
  /** Existing USL if any. */
  currentUsl?: number | null;
  /** Strength of prior toward existing limits (0..1). Default 0.2. */
  priorWeight?: number;
}

export interface ThresholdSuggestion {
  n: number;
  mean: number;
  median: number;
  stdDev: number;
  mad: number;
  /** P0.135 (~ -3σ for normal distribution) */
  p00135: number;
  /** P99.865 (~ +3σ for normal distribution) */
  p99865: number;
  suggestedTarget: number;
  suggestedLsl: number;
  suggestedUsl: number;
  /** Cp/Cpk evaluated against the suggested limits. */
  cp: number;
  cpk: number;
  /** Cp/Cpk evaluated against the current limits (null if no current). */
  currentCp: number | null;
  currentCpk: number | null;
  /** 0..1, lower when n is small or sd is unstable. */
  confidence: number;
  /**
   * ROC-style sweep over candidate symmetric thresholds (target ± k·σ for
   * k = 0.5 .. 5.0). For each k we report the empirical fraction of in-spec
   * samples (true-pass rate) and the implied false-fail rate vs current
   * limits when available. Useful for the operator chart in the UI.
   */
  rocPoints: Array<{
    k: number;
    threshold: number;
    lsl: number;
    usl: number;
    /** fraction of samples within [lsl, usl] (true-positive / acceptance rate) */
    tpr: number;
    /** fraction of samples outside [lsl, usl] (false-fail when process is in-control) */
    fpr: number;
  }>;
  /** Human-readable notes. */
  notes: string[];
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

function stdDev(values: number[], m: number): number {
  if (values.length < 2) return 0;
  let s = 0;
  for (const v of values) {
    const d = v - m;
    s += d * d;
  }
  return Math.sqrt(s / (values.length - 1));
}

function median(sorted: number[]): number {
  return quantile(sorted, 0.5);
}

function mad(values: number[], med: number): number {
  if (values.length === 0) return 0;
  const dev = values.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  return median(dev);
}

function cpCpk(m: number, sd: number, lsl: number, usl: number): { cp: number; cpk: number } {
  if (sd <= 0 || !isFinite(sd)) return { cp: 0, cpk: 0 };
  const cp = (usl - lsl) / (6 * sd);
  const cpu = (usl - m) / (3 * sd);
  const cpl = (m - lsl) / (3 * sd);
  return { cp, cpk: Math.min(cpu, cpl) };
}

/**
 * Suggest LSL / USL / target for one MP.
 * Falls back gracefully when n < 30 (lower confidence, wider bounds).
 */
export function suggestThresholds(input: ThresholdInput): ThresholdSuggestion {
  const notes: string[] = [];
  const valid = (input.values ?? []).filter((v) => typeof v === "number" && isFinite(v));
  const n = valid.length;
  if (n === 0) {
    return {
      n: 0,
      mean: NaN, median: NaN, stdDev: NaN, mad: NaN,
      p00135: NaN, p99865: NaN,
      suggestedTarget: input.currentNominal ?? NaN,
      suggestedLsl: input.currentLsl ?? NaN,
      suggestedUsl: input.currentUsl ?? NaN,
      cp: 0, cpk: 0,
      currentCp: null, currentCpk: null,
      confidence: 0,
      rocPoints: [],
      notes: ["No samples; returning current limits unchanged."],
    };
  }

  const sorted = [...valid].sort((a, b) => a - b);
  const m = mean(valid);
  const med = median(sorted);
  const sd = stdDev(valid, m);
  const madVal = mad(valid, med);
  // Robust sd estimate: 1.4826 * MAD ≈ σ for normal data
  const robustSd = madVal > 0 ? 1.4826 * madVal : sd;
  const sdFinal = robustSd > 0 ? robustSd : sd;

  const p00135 = quantile(sorted, 0.00135);
  const p99865 = quantile(sorted, 0.99865);

  // Empirical (percentile) candidates
  const empLsl = p00135;
  const empUsl = p99865;
  // Parametric (mean ± 3σ) candidates
  const parLsl = m - 3 * sdFinal;
  const parUsl = m + 3 * sdFinal;

  // Combine empirical and parametric — use the wider side for safety,
  // unless n is very large in which case empirical dominates.
  const empWeight = Math.min(1, n / 200);
  const sugLsl = empWeight * empLsl + (1 - empWeight) * parLsl;
  const sugUsl = empWeight * empUsl + (1 - empWeight) * parUsl;
  let target = input.currentNominal != null ? input.currentNominal : med;

  // Bayesian shrinkage toward existing limits
  const w = Math.min(Math.max(input.priorWeight ?? 0.2, 0), 1);
  let finalLsl = sugLsl;
  let finalUsl = sugUsl;
  if (input.currentLsl != null && isFinite(input.currentLsl)) {
    finalLsl = w * input.currentLsl + (1 - w) * sugLsl;
  }
  if (input.currentUsl != null && isFinite(input.currentUsl)) {
    finalUsl = w * input.currentUsl + (1 - w) * sugUsl;
  }
  if (input.currentNominal != null && isFinite(input.currentNominal)) {
    target = w * input.currentNominal + (1 - w) * med;
  }

  // Guard: ensure LSL < USL
  if (finalLsl >= finalUsl) {
    const eps = Math.max(Math.abs(target) * 1e-6, sdFinal * 0.5, 1e-6);
    finalLsl = target - eps;
    finalUsl = target + eps;
    notes.push("Suggested LSL/USL collapsed; widened around target as fallback.");
  }

  const sug = cpCpk(m, sdFinal, finalLsl, finalUsl);
  let curCp: number | null = null;
  let curCpk: number | null = null;
  if (input.currentLsl != null && input.currentUsl != null && input.currentLsl < input.currentUsl) {
    const c = cpCpk(m, sdFinal, input.currentLsl, input.currentUsl);
    curCp = c.cp;
    curCpk = c.cpk;
  }

  // Confidence: scales with sample count, penalised when sd is very small
  // (overfitting risk) or extremely large (noisy MP).
  let confidence = 1 - Math.exp(-n / 50);
  if (sdFinal === 0) {
    confidence *= 0.3;
    notes.push("Zero variance in samples; suggestions may be too tight.");
  }
  if (n < 30) notes.push(`Only ${n} samples; consider collecting >= 30 for stable limits.`);
  if (madVal === 0 && sd > 0) notes.push("MAD is zero but stdev > 0; distribution is skewed.");

  // ROC-style sweep: vary k in target ± k·σ and report empirical accept rate.
  const rocPoints: ThresholdSuggestion["rocPoints"] = [];
  if (sdFinal > 0 && isFinite(target)) {
    const ks = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5];
    for (const k of ks) {
      const lo = target - k * sdFinal;
      const hi = target + k * sdFinal;
      let inside = 0;
      for (const v of valid) if (v >= lo && v <= hi) inside++;
      const tpr = inside / n;
      const fpr = 1 - tpr;
      rocPoints.push({ k, threshold: k * sdFinal, lsl: lo, usl: hi, tpr, fpr });
    }
  }

  return {
    n,
    mean: m,
    median: med,
    stdDev: sd,
    mad: madVal,
    p00135,
    p99865,
    suggestedTarget: target,
    suggestedLsl: finalLsl,
    suggestedUsl: finalUsl,
    cp: sug.cp,
    cpk: sug.cpk,
    currentCp: curCp,
    currentCpk: curCpk,
    confidence: Math.max(0, Math.min(1, confidence)),
    rocPoints,
    notes,
  };
}
