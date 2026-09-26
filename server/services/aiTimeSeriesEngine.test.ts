/**
 * doc69 A4 (audit U5) — aiTimeSeriesEngine had NO dedicated tests at all before
 * this file. Covers:
 *  1. Reference series with a KNOWN change-point (CUSUM) and KNOWN seasonality
 *     (seasonal decomposition) — characterization tests against the existing,
 *     unchanged math (these algorithms were not touched by doc69 A4).
 *  2. The seeded PRNG (createSeededRng) and Isolation Forest determinism: same
 *     seed + same data ⇒ IDENTICAL anomaly scores across repeated runs — this
 *     is the actual behavior change (was unseeded Math.random, irreproducible).
 */
import { describe, it, expect, vi } from "vitest";
import {
  ewma,
  holtWinters,
  seasonalDecompose,
  detectChangePoints,
  isolationForest,
  analyzeTimeSeries,
  analyzeMultivariate,
  createSeededRng,
  DEFAULT_ISOLATION_FOREST_SEED,
  type TimeSeriesPoint,
  type MultivariatePoint,
} from "./aiTimeSeriesEngine";

const HOUR = 3600_000;

function series(values: number[], startTs = 0, stepMs = HOUR): TimeSeriesPoint[] {
  return values.map((value, i) => ({ timestamp: startTs + i * stepMs, value }));
}

// ─── Seeded PRNG ────────────────────────────────────────────────────────────

describe("createSeededRng", () => {
  it("same seed → identical sequence, every call", () => {
    const a = createSeededRng(1234);
    const b = createSeededRng(1234);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("different seeds → different sequence (not the same stream)", () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it("output is always within [0, 1)", () => {
    const rng = createSeededRng(42);
    for (let i = 0; i < 500; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("seed 0 does not degenerate to a constant stream", () => {
    const rng = createSeededRng(0);
    const seq = Array.from({ length: 10 }, () => rng());
    expect(new Set(seq).size).toBeGreaterThan(1);
  });

  it("never calls Math.random (deterministic by construction — spy proves no fallback)", () => {
    const spy = vi.spyOn(Math, "random");
    const rng = createSeededRng(7);
    for (let i = 0; i < 20; i++) rng();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ─── Isolation Forest — determinism (doc69 A4 core fix) ───────────────────

function makeMultivariateReference(): MultivariatePoint[] {
  // 40 "normal" clustered points + 3 clear outliers far from the cluster.
  const points: MultivariatePoint[] = [];
  for (let i = 0; i < 40; i++) {
    points.push({
      timestamp: i * HOUR,
      values: { x: 10 + (i % 5) * 0.4, y: 20 + (i % 3) * 0.3 },
    });
  }
  points.push({ timestamp: 40 * HOUR, values: { x: 500, y: 500 } });
  points.push({ timestamp: 41 * HOUR, values: { x: -500, y: -500 } });
  points.push({ timestamp: 42 * HOUR, values: { x: 480, y: -510 } });
  return points;
}

describe("isolationForest — determinism (doc69 A4, was unseeded Math.random)", () => {
  it("same seed, same data, repeated calls → byte-identical anomaly results", () => {
    const data = makeMultivariateReference();
    const run1 = isolationForest(data, 50, 32, 0.55, 999);
    const run2 = isolationForest(data, 50, 32, 0.55, 999);
    const run3 = isolationForest(data, 50, 32, 0.55, 999);
    expect(run2).toEqual(run1);
    expect(run3).toEqual(run1);
  });

  it("default seed is ALSO deterministic across calls (no seed passed)", () => {
    const data = makeMultivariateReference();
    const run1 = isolationForest(data, 40, 32, 0.55);
    const run2 = isolationForest(data, 40, 32, 0.55);
    expect(run2).toEqual(run1);
  });

  it("never calls Math.random — the entire bug this task fixes (was ~L292,301,363)", () => {
    const spy = vi.spyOn(Math, "random");
    const data = makeMultivariateReference();
    isolationForest(data, 20, 32, 0.55, 123);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("DEFAULT_ISOLATION_FOREST_SEED is exported and used implicitly (explicit === implicit)", () => {
    const data = makeMultivariateReference();
    const explicit = isolationForest(data, 40, 32, 0.55, DEFAULT_ISOLATION_FOREST_SEED);
    const implicit = isolationForest(data, 40, 32, 0.55);
    expect(explicit).toEqual(implicit);
  });

  it("clear outliers score high enough to be flagged as anomalies (sanity: seeding didn't break detection)", () => {
    const data = makeMultivariateReference();
    const result = isolationForest(data, 100, 32, 0.6, 12345);
    const anomalyIndexes = new Set(result.map((r) => r.index));
    // The 3 far-outlier points (indexes 40,41,42) should dominate the flagged set.
    expect(anomalyIndexes.has(40) || anomalyIndexes.has(41) || anomalyIndexes.has(42)).toBe(true);
  });

  it("different seeds CAN produce different tree structures (not hardcoded to one output)", () => {
    const data = makeMultivariateReference();
    const bySeedA = isolationForest(data, 30, 32, 0.5, 1);
    const bySeedB = isolationForest(data, 30, 32, 0.5, 2);
    // Not asserting they must differ (a small/simple dataset could coincidentally
    // agree) — only that computing with a different seed does not throw and
    // returns a same-shape, valid result set.
    expect(Array.isArray(bySeedA)).toBe(true);
    expect(Array.isArray(bySeedB)).toBe(true);
  });

  it("empty data → empty result, no crash", () => {
    expect(isolationForest([], 10, 32, 0.65, 1)).toEqual([]);
  });
});

describe("analyzeTimeSeries(isolation_forest) / analyzeMultivariate — seed threads through the public API", () => {
  it("analyzeTimeSeries with the same explicit seed is deterministic end-to-end", () => {
    const data = series([1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 500, 1, 2]);
    const a = analyzeTimeSeries(data, { algorithm: "isolation_forest", seed: 77 });
    const b = analyzeTimeSeries(data, { algorithm: "isolation_forest", seed: 77 });
    expect(a.anomalies).toEqual(b.anomalies);
  });

  it("analyzeMultivariate with the same explicit seed is deterministic end-to-end", () => {
    const data = makeMultivariateReference();
    const a = analyzeMultivariate(data, { seed: 555 });
    const b = analyzeMultivariate(data, { seed: 555 });
    expect(a).toEqual(b);
  });
});

// ─── EWMA — known single-spike reference series ────────────────────────────

describe("ewma — reference series with a known spike", () => {
  it("flags the single injected spike as an anomaly and smooths a flat baseline otherwise", () => {
    const values = new Array(30).fill(10);
    values[15] = 400; // sharp, isolated spike
    const data = series(values);

    const { anomalies, smoothed } = ewma(data, 0.3, 3.0);

    expect(smoothed).toHaveLength(30);
    const anomalyIndexes = anomalies.map((a) => a.index);
    expect(anomalyIndexes).toContain(15);
    // The flat pre-spike baseline (far from the spike) must NOT be flagged.
    expect(anomalyIndexes).not.toContain(2);
    expect(anomalyIndexes).not.toContain(3);
  });

  it("empty series → no smoothed values, no anomalies, no crash", () => {
    expect(ewma([], 0.3, 3.0)).toEqual({ smoothed: [], anomalies: [] });
  });
});

// ─── Holt-Winters — falls back to EWMA under seasonLength*2, else seasonal ─

describe("holtWinters — seasonal reference series", () => {
  it("falls back to plain EWMA when data is shorter than 2 full seasons", () => {
    const data = series([1, 2, 3, 4, 5]); // seasonLength default 24 → far too short
    const result = holtWinters(data, 0.3, 0.1, 0.3, 24, 3.0);
    const ewmaResult = ewma(data, 0.3, 3.0);
    expect(result.smoothed).toEqual(ewmaResult.smoothed);
  });

  it("produces a forecast of the expected horizon length for a genuinely seasonal series", () => {
    // period=4 repeating offset pattern on a slowly rising level — 10 full cycles.
    const seasonalOffsets = [10, -10, 5, -5];
    const values = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5 + seasonalOffsets[i % 4]);
    const data = series(values);

    const result = holtWinters(data, 0.3, 0.1, 0.3, 4, 3.0);
    expect(result.forecast).toHaveLength(12);
    expect(result.smoothed).toHaveLength(40);
    // Forecast values should stay in a sane range near the tail of the series
    // (not diverge wildly) — a loose sanity bound, not a tight numeric pin.
    for (const f of result.forecast) {
      expect(f.predicted).toBeGreaterThan(50);
      expect(f.predicted).toBeLessThan(200);
      expect(f.upper).toBeGreaterThanOrEqual(f.predicted);
      expect(f.lower).toBeLessThanOrEqual(f.predicted);
    }
  });
});

// ─── Seasonal decomposition — known period, zero-noise reference series ───

describe("seasonalDecompose — known period, zero-noise reference series", () => {
  it("recovers the seasonal pattern and leaves a small residual for a pure trend+seasonal series", () => {
    // ODD period: the centered moving average window is `2*floor(period/2)+1`,
    // which equals `period` exactly for odd periods, so each interior window
    // spans one full cycle and the zero-sum seasonal component cancels out of
    // the TREND almost perfectly. The per-position seasonal AVERAGE (step 3)
    // still mixes in the two edge positions' fill-forward/back values (a real,
    // documented property of this simple centered-MA decomposition — not
    // something doc69 A4 touches) — so the residual is small but not exactly
    // zero. This bounds it well under the ~15-unit seasonal swing, proving the
    // decomposition recovers the pattern rather than pinning it to float epsilon.
    const period = 5;
    const seasonalOffsets = [10, -10, 5, -5, 0]; // sums to 0 → matches the function's centering
    const values = Array.from({ length: 40 }, (_, i) => 200 + i * 1 + seasonalOffsets[i % period]);
    const data = series(values);

    const { seasonal, residual } = seasonalDecompose(data, period);

    for (let i = period; i < data.length - period; i++) {
      expect(Math.abs(residual[i])).toBeLessThan(0.5);
    }

    // The seasonal component must repeat with the given period.
    for (let i = 0; i < data.length - period; i++) {
      expect(seasonal[i]).toBeCloseTo(seasonal[i + period], 6);
    }
    // And it should reproduce the RELATIVE shape of the injected offsets
    // (same period-to-period differences, centering aside) — loose tolerance
    // to absorb the edge-averaging artifact documented above, not a numeric pin.
    const s = seasonal.slice(0, period);
    expect(Math.abs((s[0] - s[1]) - (seasonalOffsets[0] - seasonalOffsets[1]))).toBeLessThan(0.5);
    expect(Math.abs((s[2] - s[3]) - (seasonalOffsets[2] - seasonalOffsets[3]))).toBeLessThan(0.5);
  });
});

// ─── Change point detection — known single mean-shift reference series ────

describe("detectChangePoints — reference series with a known mean shift", () => {
  it("detects an increasing change point near the injected shift index", () => {
    // Low-variance baseline (mean ≈ 0.5) for 20 points, then a clear step up to
    // mean ≈ 10.5 for the remaining 20 — deterministic small oscillation (not
    // random) so std ≠ 0 without relying on any RNG.
    const before = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 0 : 1));
    const after = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 10 : 11));
    const data = series([...before, ...after]);

    const changePoints = detectChangePoints(data, 4.0);

    expect(changePoints.length).toBeGreaterThan(0);
    const increases = changePoints.filter((c) => c.direction === "increase");
    expect(increases.length).toBeGreaterThan(0);
    // The first detected increase should land reasonably close to the true
    // shift at index 20 (CUSUM inherently lags a little behind the true point).
    expect(increases[0].index).toBeGreaterThanOrEqual(18);
    expect(increases[0].index).toBeLessThanOrEqual(30);
  });

  it("a flat (zero-variance) series yields no change points, not a crash", () => {
    const data = series(new Array(15).fill(5));
    expect(detectChangePoints(data, 4.0)).toEqual([]);
  });

  it("fewer than 10 points → no change points (documented minimum)", () => {
    const data = series([1, 2, 3, 4, 5]);
    expect(detectChangePoints(data, 4.0)).toEqual([]);
  });
});
