/**
 * P4.B G14 — Statistical Process Control rule engine
 *
 * Implements:
 *  - Western Electric rules WE_1..WE_4
 *  - Nelson rules NELSON_1..NELSON_8
 *  - EWMA out-of-control detector
 *
 * Pure functions. Stateless. Caller is responsible for:
 *  - providing samples in chronological order
 *  - persisting violations via `mp_spc_alerts`
 */

export interface SpcSample {
  id: number;
  value: number;
  sampledAt: Date;
}

export interface SpcLimits {
  mean: number;
  sigma: number;
}

export interface SpcViolation {
  ruleCode: string;
  ruleName: string;
  severity: "warn" | "critical";
  sampleIndices: number[];   // 0-based indexes into the input array
  sampleIds: number[];
  windowFrom: Date;
  windowTo: Date;
  summary?: Record<string, any>;
}

const RULES: Record<string, string> = {
  WE_1: "1 point beyond ±3σ (WE Rule 1)",
  WE_2: "2 of 3 consecutive points beyond ±2σ on same side (WE Rule 2)",
  WE_3: "4 of 5 consecutive points beyond ±1σ on same side (WE Rule 3)",
  WE_4: "8 consecutive points on same side of mean (WE Rule 4)",
  NELSON_1: "1 point > 3σ from mean (Nelson 1)",
  NELSON_2: "9 points in a row on same side of mean (Nelson 2)",
  NELSON_3: "6 points in a row monotonically increasing or decreasing (Nelson 3)",
  NELSON_4: "14 points alternating up/down (Nelson 4)",
  NELSON_5: "2 of 3 consecutive points > 2σ same side (Nelson 5)",
  NELSON_6: "4 of 5 consecutive points > 1σ same side (Nelson 6)",
  NELSON_7: "15 points in a row within ±1σ (stratification) (Nelson 7)",
  NELSON_8: "8 points in a row > 1σ from mean either side (Nelson 8)",
  EWMA_OOC: "EWMA value beyond control limits",
};

function side(v: number, mean: number): 1 | -1 | 0 {
  if (v > mean) return 1;
  if (v < mean) return -1;
  return 0;
}

function range(samples: SpcSample[], from: number, to: number): { from: Date; to: Date; ids: number[] } {
  const slice = samples.slice(from, to + 1);
  return {
    from: slice[0].sampledAt,
    to: slice[slice.length - 1].sampledAt,
    ids: slice.map((s) => s.id),
  };
}

/**
 * Run all WE + Nelson rules on a sample window.
 * @returns violations with sample-index references.
 */
export function detectSpcViolations(samples: SpcSample[], limits: SpcLimits): SpcViolation[] {
  if (samples.length === 0) return [];
  const { mean, sigma } = limits;
  if (!isFinite(sigma) || sigma <= 0) return [];

  const out: SpcViolation[] = [];
  const v = samples.map((s) => s.value);
  const n = v.length;

  // ---------- WE_1 / NELSON_1: any single point > 3σ ----------
  for (let i = 0; i < n; i++) {
    if (Math.abs(v[i] - mean) > 3 * sigma) {
      const r = range(samples, i, i);
      out.push({
        ruleCode: "WE_1",
        ruleName: RULES.WE_1,
        severity: "critical",
        sampleIndices: [i],
        sampleIds: r.ids,
        windowFrom: r.from,
        windowTo: r.to,
        summary: { value: v[i], deviation: (v[i] - mean) / sigma },
      });
    }
  }

  // ---------- WE_4 / NELSON_2: k consecutive same side ----------
  function consecutiveSameSide(k: number, ruleCode: "WE_4" | "NELSON_2", severity: SpcViolation["severity"]) {
    let runStart = 0;
    let runSide: 1 | -1 | 0 = 0;
    for (let i = 0; i < n; i++) {
      const s = side(v[i], mean);
      if (s === 0) {
        runStart = i + 1;
        runSide = 0;
        continue;
      }
      if (s !== runSide) {
        runStart = i;
        runSide = s;
      }
      if (i - runStart + 1 >= k) {
        const r = range(samples, runStart, i);
        out.push({
          ruleCode,
          ruleName: RULES[ruleCode],
          severity,
          sampleIndices: Array.from({ length: k }, (_, j) => runStart + j),
          sampleIds: r.ids,
          windowFrom: r.from,
          windowTo: r.to,
          summary: { side: runSide === 1 ? "above" : "below", consecutive: k },
        });
        // reset to avoid duplicate flags for the same run
        runStart = i + 1;
        runSide = 0;
      }
    }
  }
  consecutiveSameSide(8, "WE_4", "warn");
  consecutiveSameSide(9, "NELSON_2", "warn");

  // ---------- WE_2 / NELSON_5: 2 of 3 beyond 2σ same side ----------
  function nOfMSameSide(needed: number, window: number, threshold: number, ruleCode: string, severity: SpcViolation["severity"]) {
    for (let i = 0; i + window - 1 < n; i++) {
      const slice = v.slice(i, i + window);
      const above = slice.filter((x) => x - mean > threshold * sigma).length;
      const below = slice.filter((x) => mean - x > threshold * sigma).length;
      if (above >= needed || below >= needed) {
        const r = range(samples, i, i + window - 1);
        out.push({
          ruleCode,
          ruleName: RULES[ruleCode],
          severity,
          sampleIndices: Array.from({ length: window }, (_, j) => i + j),
          sampleIds: r.ids,
          windowFrom: r.from,
          windowTo: r.to,
          summary: { side: above >= needed ? "above" : "below", threshold, needed, of: window },
        });
      }
    }
  }
  nOfMSameSide(2, 3, 2, "WE_2", "warn");
  nOfMSameSide(2, 3, 2, "NELSON_5", "warn");
  nOfMSameSide(4, 5, 1, "WE_3", "warn");
  nOfMSameSide(4, 5, 1, "NELSON_6", "warn");

  // ---------- NELSON_3: 6 monotonic points ----------
  for (let i = 0; i + 5 < n; i++) {
    let inc = true;
    let dec = true;
    for (let k = i + 1; k <= i + 5; k++) {
      if (v[k] <= v[k - 1]) inc = false;
      if (v[k] >= v[k - 1]) dec = false;
    }
    if (inc || dec) {
      const r = range(samples, i, i + 5);
      out.push({
        ruleCode: "NELSON_3",
        ruleName: RULES.NELSON_3,
        severity: "warn",
        sampleIndices: [i, i + 1, i + 2, i + 3, i + 4, i + 5],
        sampleIds: r.ids,
        windowFrom: r.from,
        windowTo: r.to,
        summary: { trend: inc ? "increasing" : "decreasing" },
      });
    }
  }

  // ---------- NELSON_4: 14 alternating ----------
  for (let i = 0; i + 13 < n; i++) {
    let alternating = true;
    for (let k = i + 1; k <= i + 13; k++) {
      const a = v[k] - v[k - 1];
      const b = k - 2 >= i ? v[k - 1] - v[k - 2] : null;
      if (a === 0) {
        alternating = false;
        break;
      }
      if (b !== null && Math.sign(a) === Math.sign(b)) {
        alternating = false;
        break;
      }
    }
    if (alternating) {
      const r = range(samples, i, i + 13);
      out.push({
        ruleCode: "NELSON_4",
        ruleName: RULES.NELSON_4,
        severity: "warn",
        sampleIndices: Array.from({ length: 14 }, (_, j) => i + j),
        sampleIds: r.ids,
        windowFrom: r.from,
        windowTo: r.to,
      });
    }
  }

  // ---------- NELSON_7: 15 points within ±1σ (stratification) ----------
  for (let i = 0; i + 14 < n; i++) {
    let allWithin = true;
    for (let k = i; k <= i + 14; k++) {
      if (Math.abs(v[k] - mean) > sigma) { allWithin = false; break; }
    }
    if (allWithin) {
      const r = range(samples, i, i + 14);
      out.push({
        ruleCode: "NELSON_7",
        ruleName: RULES.NELSON_7,
        severity: "warn",
        sampleIndices: Array.from({ length: 15 }, (_, j) => i + j),
        sampleIds: r.ids,
        windowFrom: r.from,
        windowTo: r.to,
      });
    }
  }

  // ---------- NELSON_8: 8 points all > 1σ either side ----------
  for (let i = 0; i + 7 < n; i++) {
    let allOutside = true;
    for (let k = i; k <= i + 7; k++) {
      if (Math.abs(v[k] - mean) <= sigma) { allOutside = false; break; }
    }
    if (allOutside) {
      const r = range(samples, i, i + 7);
      out.push({
        ruleCode: "NELSON_8",
        ruleName: RULES.NELSON_8,
        severity: "warn",
        sampleIndices: Array.from({ length: 8 }, (_, j) => i + j),
        sampleIds: r.ids,
        windowFrom: r.from,
        windowTo: r.to,
      });
    }
  }

  return out;
}

/**
 * Compute EWMA series and detect first out-of-control point.
 * @param lambda smoothing factor (0 < λ ≤ 1), typical 0.2
 * @param L control-limit width in σ units, typical 3
 */
export function detectEwma(
  samples: SpcSample[],
  limits: SpcLimits,
  lambda = 0.2,
  L = 3,
): { ewma: number[]; ucl: number[]; lcl: number[]; violations: SpcViolation[] } {
  const { mean, sigma } = limits;
  const ewma: number[] = [];
  const ucl: number[] = [];
  const lcl: number[] = [];
  const violations: SpcViolation[] = [];
  let prev = mean;
  for (let i = 0; i < samples.length; i++) {
    const z = lambda * samples[i].value + (1 - lambda) * prev;
    const factor = Math.sqrt((lambda / (2 - lambda)) * (1 - Math.pow(1 - lambda, 2 * (i + 1))));
    const u = mean + L * sigma * factor;
    const l = mean - L * sigma * factor;
    ewma.push(z);
    ucl.push(u);
    lcl.push(l);
    if (z > u || z < l) {
      violations.push({
        ruleCode: "EWMA_OOC",
        ruleName: RULES.EWMA_OOC,
        severity: "critical",
        sampleIndices: [i],
        sampleIds: [samples[i].id],
        windowFrom: samples[i].sampledAt,
        windowTo: samples[i].sampledAt,
        summary: { ewma: z, ucl: u, lcl: l, lambda, L },
      });
    }
    prev = z;
  }
  return { ewma, ucl, lcl, violations };
}

/**
 * Compute simple rolling Cp/Cpk/Pp/Ppk for a window.
 * Pp/Ppk uses overall σ (sample standard deviation).
 * Cp/Cpk uses within-subgroup σ — for ad-hoc series we approximate via
 * average moving-range / d2(2) = 1.128.
 */
export function rollingCapability(
  values: number[],
  usl?: number | null,
  lsl?: number | null,
): { mean: number; sigmaOverall: number; sigmaWithin: number; cp?: number; cpk?: number; pp?: number; ppk?: number } {
  const n = values.length;
  if (n === 0) return { mean: NaN, sigmaOverall: NaN, sigmaWithin: NaN };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
  const sigmaOverall = Math.sqrt(variance);
  let sigmaWithin = sigmaOverall;
  if (n >= 2) {
    let sumMr = 0;
    for (let i = 1; i < n; i++) sumMr += Math.abs(values[i] - values[i - 1]);
    const mrBar = sumMr / (n - 1);
    sigmaWithin = mrBar / 1.128;
  }
  const out: ReturnType<typeof rollingCapability> = { mean, sigmaOverall, sigmaWithin };
  if (usl != null && lsl != null) {
    out.cp = (usl - lsl) / (6 * sigmaWithin);
    out.cpk = Math.min((usl - mean) / (3 * sigmaWithin), (mean - lsl) / (3 * sigmaWithin));
    out.pp = (usl - lsl) / (6 * sigmaOverall);
    out.ppk = Math.min((usl - mean) / (3 * sigmaOverall), (mean - lsl) / (3 * sigmaOverall));
  } else if (usl != null) {
    out.cpk = (usl - mean) / (3 * sigmaWithin);
    out.ppk = (usl - mean) / (3 * sigmaOverall);
  } else if (lsl != null) {
    out.cpk = (mean - lsl) / (3 * sigmaWithin);
    out.ppk = (mean - lsl) / (3 * sigmaOverall);
  }
  return out;
}
