/**
 * doc 56 Đ5 — Process SPC: turn a series of individual process metric measurements
 * (torque, dispense volume, cycle time, …) into a server-authoritative I-MR control
 * chart + optional capability (Cpk) against the engineer's spec limits.
 *
 * This is a THIN wrapper over server/utils/spc.ts (generateControlChart /
 * calculateCapabilityIndices) — the SPC math is shared with the inspection SPC path,
 * NOT re-implemented. Pure (no DB); the router feeds it points + spec limits.
 */
import { generateControlChart, calculateCapabilityIndices, type GeneratedChart } from "../utils/spc";

export interface ProcessMetricSample {
  value: number;
  measuredAt: Date | null;
}

export interface ProcessControlChart {
  /** Enough points to compute control limits (I-MR needs ≥ 2). */
  ok: boolean;
  n: number;
  metricKey: string;
  /** Center line + UCL/LCL of the individuals chart; null when ok=false. */
  limits: { UCL: number; CL: number; LCL: number } | null;
  estimatedSigma: number;
  outOfControlCount: number;
  /** Plotted points with rule violations flagged (from the I-chart). */
  points: Array<{ ts: number | null; value: number; outOfControl: boolean; rules: number[] }>;
  /** Process capability vs spec limits — present only when usl/lsl supplied. */
  capability: { cp: number | null; cpk: number | null; usl: number | null; lsl: number | null } | null;
}

/**
 * Build an I-MR control chart for one metric key. `rules` selects the SPC rule set
 * (defaults to Western-Electric 1..4 — the "beyond limits / zone" family that a
 * dashboard should surface; the fuller Nelson set 5..8 is available but noisier).
 */
export function buildProcessControlChart(
  metricKey: string,
  samples: ProcessMetricSample[],
  opts?: { usl?: number | null; lsl?: number | null; rules?: number[] },
): ProcessControlChart {
  const n = samples.length;
  const empty: ProcessControlChart = {
    ok: false, n, metricKey, limits: null, estimatedSigma: 0,
    outOfControlCount: 0, points: [], capability: null,
  };
  if (n < 2) return empty;

  const rules = opts?.rules ?? [1, 2, 3, 4];
  const chart: GeneratedChart | null = generateControlChart(
    samples.map((s) => ({ value: s.value, inspectionTime: s.measuredAt })),
    "individual_mr",
    1,
    rules,
  );
  if (!chart) return empty;

  const points = chart.primary.points.map((p) => ({
    ts: p.timestamp ? p.timestamp.getTime() : null,
    value: p.value,
    outOfControl: p.outOfControl,
    rules: p.violatedRules,
  }));
  const outOfControlCount = points.filter((p) => p.outOfControl).length;

  let capability: ProcessControlChart["capability"] = null;
  const usl = opts?.usl ?? null;
  const lsl = opts?.lsl ?? null;
  if ((usl != null || lsl != null) && chart.estimatedSigma > 0) {
    const cap = calculateCapabilityIndices(samples.map((s) => s.value), usl, lsl, chart.estimatedSigma);
    capability = { cp: cap.cp ?? null, cpk: cap.cpk ?? null, usl, lsl };
  }

  return {
    ok: true,
    n,
    metricKey,
    limits: chart.primary.limits,
    estimatedSigma: chart.estimatedSigma,
    outOfControlCount,
    points,
    capability,
  };
}
