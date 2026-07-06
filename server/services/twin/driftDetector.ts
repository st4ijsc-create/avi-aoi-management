/**
 * Twin ↔ reality drift detector — SYNAPSE §5.7.3 (doc 33 §3.6 / H6).
 *
 * "Rủi ro số 1: digital twin lỗi thời." The twin is only trustworthy while its simulated metrics
 * track the real floor. This measures per-metric relative deviation (e.g. simulated cycle-time vs
 * measured) and flags a metric whose |drift| exceeds a threshold (SDD: cycle-time lag > 10% marks
 * the model for re-calibration). Pure + testable. Additive (flag TWIN_DRIFT).
 */

export interface MetricPair {
  metric: string;
  /** Twin-simulated value. */
  simulated: number;
  /** Measured (real) value. */
  actual: number;
}

export interface DriftItem {
  metric: string;
  simulated: number;
  actual: number;
  /** (simulated - actual) / |actual|, or 0 when actual is 0 and simulated is 0. */
  relativeDrift: number;
  drifted: boolean;
}

export interface DriftReport {
  /** Fraction threshold (e.g. 0.1 = 10%). */
  threshold: number;
  items: DriftItem[];
  /** Metrics whose |drift| exceeds the threshold → twin needs re-calibration. */
  drifted: string[];
  ok: boolean;
}

/** Compute the twin-vs-reality drift report. `threshold` defaults to 10% (SDD §5.7.3). */
export function detectDrift(pairs: readonly MetricPair[], threshold = 0.1): DriftReport {
  const items: DriftItem[] = pairs.map((p) => {
    const denom = Math.abs(p.actual);
    const relativeDrift = denom === 0 ? (p.simulated === 0 ? 0 : Infinity) : (p.simulated - p.actual) / denom;
    return { metric: p.metric, simulated: p.simulated, actual: p.actual, relativeDrift, drifted: Math.abs(relativeDrift) > threshold };
  });
  const drifted = items.filter((i) => i.drifted).map((i) => i.metric);
  return { threshold, items, drifted, ok: drifted.length === 0 };
}
