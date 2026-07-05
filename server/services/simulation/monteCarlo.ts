/**
 * Monte-Carlo replication wrapper — SYNAPSE §5.7.3 (doc 33 §3.6 / H6).
 *
 * The DES engine runs a single deterministic pass; SYNAPSE requires N≥30 replications with noise
 * → a KPI DISTRIBUTION + a 95% confidence interval (not a single number). This wraps any sample
 * function: run it N times (a seeded PRNG per replication so results are reproducible), then
 * aggregate mean / std / p5 / p95 / a normal-approx 95% CI. Pure + deterministic.
 */

/** Deterministic PRNG (mulberry32) so replications are reproducible/testable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MonteCarloResult {
  n: number;
  mean: number;
  std: number;
  min: number;
  max: number;
  p5: number;
  p95: number;
  /** Normal-approx 95% CI half-width (1.96·std/√n) and bounds on the mean. */
  ci95: { halfWidth: number; low: number; high: number };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * Run `sample(rng, i)` for `n` replications (n≥30 recommended) and aggregate the KPI. Each
 * replication gets its own seeded PRNG derived from `seed`.
 */
export function monteCarlo(
  sample: (rng: () => number, i: number) => number,
  n = 30,
  seed = 12345,
): MonteCarloResult {
  const N = Math.max(1, Math.floor(n));
  const values: number[] = [];
  for (let i = 0; i < N; i++) {
    values.push(sample(mulberry32(seed + i * 2654435761), i));
  }
  const mean = values.reduce((s, v) => s + v, 0) / N;
  const variance = N > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (N - 1) : 0;
  const std = Math.sqrt(variance);
  const sorted = [...values].sort((a, b) => a - b);
  const halfWidth = N > 0 ? (1.96 * std) / Math.sqrt(N) : 0;
  return {
    n: N,
    mean,
    std,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p5: percentile(sorted, 5),
    p95: percentile(sorted, 95),
    ci95: { halfWidth, low: mean - halfWidth, high: mean + halfWidth },
  };
}
