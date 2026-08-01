// scripts/bench/lib/stats.mjs
// ─────────────────────────────────────────────────────────────────────────────
// doc 44 W7-3 (G1.19 / G2.20) — PURE benchmark statistics.
//
// No I/O, no deps, deterministic → unit-testable (see benchStats.test.ts). Shared
// by bench-ingest.mjs (measurement) and bench-report.mjs (release-gate scoring).
//
// percentile() uses the "linear interpolation between closest ranks" method
// (same family as numpy default / Grafana / HiveMQ-report style): for a sorted
// sample of length n, the p-th percentile sits at fractional 0-based rank
// r = (p/100)·(n−1); we interpolate between arr[floor(r)] and arr[ceil(r)]. This
// is stable, monotonic in p, and needs no bucket config (unlike a prom histogram).
// ─────────────────────────────────────────────────────────────────────────────

/** Round to `d` decimals (null-safe). */
export function round(n, d = 2) {
  if (n == null || !Number.isFinite(n)) return null;
  const m = 10 ** d;
  return Math.round(n * m) / m;
}

/**
 * p-th percentile (0..100) of `values` via linear interpolation between closest
 * ranks. Non-finite values are dropped. Returns null for an empty sample. Does
 * NOT mutate the input.
 */
export function percentile(values, p) {
  const arr = values.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  const n = arr.length;
  if (n === 0) return null;
  if (n === 1) return arr[0];
  const clamped = Math.min(100, Math.max(0, p));
  const rank = (clamped / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return arr[lo];
  const frac = rank - lo;
  return arr[lo] + (arr[hi] - arr[lo]) * frac;
}

/** Arithmetic mean (null for empty). */
export function mean(values) {
  const arr = values.filter((n) => Number.isFinite(n));
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Full latency summary: count + min/max/mean + p50/p95/p99/p999. All numeric
 * fields rounded to `decimals`. `n` is the count of FINITE samples considered.
 */
export function summarize(values, decimals = 3) {
  const arr = values.filter((n) => Number.isFinite(n));
  const n = arr.length;
  if (n === 0) {
    return { n: 0, min: null, max: null, mean: null, p50: null, p95: null, p99: null, p999: null };
  }
  const sorted = arr.slice().sort((a, b) => a - b);
  return {
    n,
    min: round(sorted[0], decimals),
    max: round(sorted[n - 1], decimals),
    mean: round(mean(sorted), decimals),
    p50: round(percentile(sorted, 50), decimals),
    p95: round(percentile(sorted, 95), decimals),
    p99: round(percentile(sorted, 99), decimals),
    p999: round(percentile(sorted, 99.9), decimals),
  };
}

/**
 * Throughput over a wall-clock window. `count` events over `elapsedMs` → events
 * per second. Returns 0 when elapsed ≤ 0 (avoids Infinity in reports).
 */
export function throughputPerSec(count, elapsedMs) {
  if (!Number.isFinite(count) || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return (count / elapsedMs) * 1000;
}

/**
 * Compare a measured value against an SLO threshold. `mode` = "max" (measured
 * must be ≤ threshold, e.g. latency) or "min" (measured must be ≥ threshold, e.g.
 * throughput). Returns a structured gate result. A null/absent measured value is
 * reported as `pass: null` (NOT MEASURED — honest, never a silent pass).
 */
export function gate(label, measured, threshold, mode = "max", unit = "") {
  if (measured == null || !Number.isFinite(measured)) {
    return { label, measured: null, threshold, mode, unit, pass: null, note: "not measured" };
  }
  const pass = mode === "min" ? measured >= threshold : measured <= threshold;
  return { label, measured, threshold, mode, unit, pass };
}
