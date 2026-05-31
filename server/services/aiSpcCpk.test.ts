/**
 * B1 Tier-1 data-debt fixes — verification tests.
 *
 * B1.1 Cpk: AI analytics now reuses server/utils/spc.ts:calculateCapabilityIndices
 *           (one-sided Cpu/Cpl aware, Box-Cox transforms values AND spec limits together,
 *           returns cpk=null when no real spec limit is supplied — no fabricated USL=100).
 * B1.2 Forecast: forecastWithHoltWinters now honors the `confidence` ceiling and decays
 *           per-horizon by the real in-sample stdError instead of the old hard-coded 1-h*0.03.
 */
import { describe, it, expect } from "vitest";
import { calculateCapabilityIndices } from "../utils/spc";
import { forecastWithHoltWinters } from "./aiInspectionAnalytics";

// ─── B1.1 Cpk (Six Sigma reference values) ───────────────────────────────
// calculateCapabilityIndices uses the supplied `estimatedSigma` for Cp/Cpk, so we
// feed σ=2 directly and use symmetric data (skew≈0 → no Box-Cox) centered on the mean.
function symmetricAround(mean: number, n = 20): number[] {
  // Tight symmetric spread so skewness ≈ 0 and the sample mean equals `mean`.
  const out: number[] = [];
  for (let i = 0; i < n / 2; i++) {
    out.push(mean - 0.5, mean + 0.5);
  }
  return out;
}

describe("B1.1 Cpk via calculateCapabilityIndices", () => {
  it("centered process μ=100, σ=2, USL=106, LSL=94 → Cpk=1.0", () => {
    const r = calculateCapabilityIndices(symmetricAround(100), 106, 94, 2);
    expect(r.cpk).toBeCloseTo(1.0, 3);
    expect(r.cpu).toBeCloseTo(1.0, 3);
    expect(r.cpl).toBeCloseTo(1.0, 3);
  });

  it("off-center μ=102, σ=2, USL=106, LSL=94 → Cpk=0.667 (= min(Cpu,Cpl))", () => {
    const r = calculateCapabilityIndices(symmetricAround(102), 106, 94, 2);
    // Cpu = (106-102)/(3*2)=0.667 ; Cpl = (102-94)/(3*2)=1.333
    expect(r.cpu).toBeCloseTo(0.667, 3);
    expect(r.cpl).toBeCloseTo(1.333, 3);
    expect(r.cpk).toBeCloseTo(0.667, 3);
  });

  it("one-sided upper spec only (LSL=null) → Cpk equals Cpu", () => {
    const r = calculateCapabilityIndices(symmetricAround(100), 106, null, 2);
    expect(r.cpl).toBeNull();
    expect(r.cpu).toBeCloseTo(1.0, 3);
    expect(r.cpk).toBeCloseTo(1.0, 3);
    expect(r.cpk).toBe(r.cpu);
  });

  it("one-sided lower spec only (USL=null) → Cpk equals Cpl", () => {
    const r = calculateCapabilityIndices(symmetricAround(100), null, 94, 2);
    expect(r.cpu).toBeNull();
    expect(r.cpl).toBeCloseTo(1.0, 3);
    expect(r.cpk).toBe(r.cpl);
  });

  it("no spec limits → cpk/cpu/cpl all null (never fabricated)", () => {
    const r = calculateCapabilityIndices(symmetricAround(100), null, null, 2);
    expect(r.cpk).toBeNull();
    expect(r.cpu).toBeNull();
    expect(r.cpl).toBeNull();
  });

  it("skewed data does not produce NaN Cpk (Box-Cox guard)", () => {
    // Strongly right-skewed positive data, n>=10 → triggers Box-Cox internally.
    const skewed = [1, 1, 1, 2, 2, 2, 3, 4, 6, 9, 15, 25];
    const r = calculateCapabilityIndices(skewed, 30, 0.5, 3);
    expect(r.cpk).not.toBeNull();
    expect(Number.isNaN(r.cpk as number)).toBe(false);
    expect(Number.isFinite(r.cpk as number)).toBe(true);
  });
});

// ─── B1.2 Forecast confidence by window ──────────────────────────────────
describe("B1.2 forecastWithHoltWinters confidence", () => {
  const base = new Date("2026-05-01T00:00:00.000Z");

  it("confidence never exceeds the supplied ceiling and stays ≥ 0.3", () => {
    // 28 noisy points → a real (non-zero) stdError so confidence decays.
    const data = Array.from({ length: 28 }, (_, i) => 90 + (i % 5) - 2 + (i % 2 === 0 ? 1.5 : -1.5));
    const ceiling = 0.9;
    const fc = forecastWithHoltWinters(data, base, 14, ceiling);
    for (const p of fc) {
      expect(p.confidence).toBeLessThanOrEqual(ceiling + 1e-9);
      expect(p.confidence).toBeGreaterThanOrEqual(0.3 - 1e-9);
    }
  });

  it("confidence is non-increasing across the horizon (decays with stdError·√h)", () => {
    const data = Array.from({ length: 28 }, (_, i) => 88 + (i % 7) + (i % 3 === 0 ? 4 : -4));
    const fc = forecastWithHoltWinters(data, base, 14, 0.9);
    for (let i = 1; i < fc.length; i++) {
      expect(fc[i].confidence).toBeLessThanOrEqual(fc[i - 1].confidence + 1e-9);
    }
  });

  it("the supplied confidence is actually used (different ceilings → different values)", () => {
    const data = Array.from({ length: 28 }, (_, i) => 90 + (i % 5) - 2 + (i % 2 === 0 ? 1.5 : -1.5));
    const high = forecastWithHoltWinters(data, base, 7, 0.9);
    const low = forecastWithHoltWinters(data, base, 7, 0.5);
    // Old code ignored `confidence`; with the fix the low ceiling caps every horizon lower.
    expect(low[0].confidence).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(high[0].confidence).toBeGreaterThan(low[0].confidence);
  });

  it("near-perfect fit keeps h=1 confidence close to the ceiling", () => {
    // Almost-flat series → tiny stdError → normalizedError≈0 → confidence≈ceiling at h=1.
    const data = Array.from({ length: 28 }, (_, i) => 95 + (i % 2 === 0 ? 0.01 : -0.01));
    const fc = forecastWithHoltWinters(data, base, 7, 0.9);
    expect(fc[0].confidence).toBeGreaterThan(0.85);
    expect(fc[0].confidence).toBeLessThanOrEqual(0.9 + 1e-9);
  });
});
