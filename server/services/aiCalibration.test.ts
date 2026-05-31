/**
 * B2 — Confidence calibration verification tests.
 *
 * Covers computeECE (perfect / overconfident), reliability-bin invariants, fitTemperature
 * (overconfident → T>1 and ECE drops), the exact multi-class logits path, and the
 * collectCalibrationSamples N=0 → null contract.
 */
import { describe, it, expect } from "vitest";
import {
  computeECE,
  fitTemperature,
  fitTemperatureFromLogits,
  applyTemperatureToConfidence,
  type CalibrationSample,
} from "./aiCalibration";

describe("computeECE", () => {
  it("perfectly calibrated samples → ECE ≈ 0", () => {
    // Each bin's accuracy equals its average confidence.
    const samples: CalibrationSample[] = [];
    // conf 0.1 bin: 10% correct
    for (let i = 0; i < 100; i++) samples.push({ confidence: 0.1, correct: i < 10 });
    // conf 0.5 bin: 50% correct
    for (let i = 0; i < 100; i++) samples.push({ confidence: 0.5, correct: i < 50 });
    // conf 0.9 bin: 90% correct
    for (let i = 0; i < 100; i++) samples.push({ confidence: 0.9, correct: i < 90 });
    const r = computeECE(samples, 10);
    expect(r.ece).toBeLessThan(0.01);
  });

  it("overconfident (conf=1.0, acc=0.5) → ECE ≈ 0.5", () => {
    const samples: CalibrationSample[] = [];
    for (let i = 0; i < 100; i++) samples.push({ confidence: 1.0, correct: i < 50 });
    const r = computeECE(samples, 10);
    expect(r.ece).toBeCloseTo(0.5, 5);
    expect(r.mce).toBeCloseTo(0.5, 5);
  });

  it("reliability bins: total count = N, accuracy ∈ [0,1], avgConfidence ∈ [0,1]", () => {
    const samples: CalibrationSample[] = [];
    for (let i = 0; i < 250; i++) {
      samples.push({ confidence: (i % 100) / 100, correct: i % 3 === 0 });
    }
    const r = computeECE(samples, 10);
    const totalCount = r.reliabilityBins.reduce((a, b) => a + b.count, 0);
    expect(totalCount).toBe(samples.length);
    expect(r.sampleCount).toBe(samples.length);
    for (const bin of r.reliabilityBins) {
      expect(bin.accuracy).toBeGreaterThanOrEqual(0);
      expect(bin.accuracy).toBeLessThanOrEqual(1);
      expect(bin.avgConfidence).toBeGreaterThanOrEqual(0);
      expect(bin.avgConfidence).toBeLessThanOrEqual(1);
    }
  });

  it("empty input → zeros and empty (all-count-0) bins", () => {
    const r = computeECE([], 10);
    expect(r.ece).toBe(0);
    expect(r.mce).toBe(0);
    expect(r.brierScore).toBe(0);
    expect(r.sampleCount).toBe(0);
    expect(r.reliabilityBins.reduce((a, b) => a + b.count, 0)).toBe(0);
  });

  it("Brier score: conf=1 wrong every time → 1.0", () => {
    const samples: CalibrationSample[] = Array.from({ length: 50 }, () => ({
      confidence: 1.0,
      correct: false,
    }));
    const r = computeECE(samples, 10);
    expect(r.brierScore).toBeCloseTo(1.0, 6);
  });
});

describe("fitTemperature (binary-confidence approximation)", () => {
  it("overconfident model → T > 1 and ECE after < ECE before", () => {
    // Build an overconfident set: high stored confidence but only ~60% correct.
    const samples: CalibrationSample[] = [];
    for (let i = 0; i < 200; i++) {
      samples.push({ confidence: 0.97, correct: i % 10 < 6 }); // 60% correct @ conf 0.97
    }
    const fit = fitTemperature(samples, { bins: 10 });
    expect(fit).not.toBeNull();
    expect(fit!.temperature).toBeGreaterThan(1);
    expect(fit!.eceAfter).toBeLessThan(fit!.eceBefore);
    expect(fit!.approximate).toBe(true);
  });

  it("too few samples → null", () => {
    const fit = fitTemperature([{ confidence: 0.9, correct: true }], { bins: 10 });
    expect(fit).toBeNull();
  });

  it("degenerate (all correct) → null", () => {
    const samples: CalibrationSample[] = Array.from({ length: 50 }, () => ({
      confidence: 0.8,
      correct: true,
    }));
    expect(fitTemperature(samples)).toBeNull();
  });

  it("applyTemperatureToConfidence: T>1 reduces an overconfident prob, T=1 is identity", () => {
    expect(applyTemperatureToConfidence(0.95, 1)).toBeCloseTo(0.95, 6);
    expect(applyTemperatureToConfidence(0.95, 2)).toBeLessThan(0.95);
    expect(applyTemperatureToConfidence(0.95, 2)).toBeGreaterThan(0.5);
  });
});

describe("fitTemperatureFromLogits (exact multi-class path)", () => {
  it("overconfident logits → T > 1 and NLL after ≤ NLL before", () => {
    // 2-class overconfident logits where the true label is sometimes the lower logit.
    const logitsSet: number[][] = [];
    const labels: number[] = [];
    for (let i = 0; i < 100; i++) {
      logitsSet.push([5, -5]); // very confident in class 0
      labels.push(i % 10 < 7 ? 0 : 1); // but only 70% actually class 0
    }
    const fit = fitTemperatureFromLogits(logitsSet, labels);
    expect(fit).not.toBeNull();
    expect(fit!.temperature).toBeGreaterThan(1);
    expect(fit!.nllAfter).toBeLessThanOrEqual(fit!.nllBefore + 1e-9);
  });

  it("mismatched / empty input → null", () => {
    expect(fitTemperatureFromLogits([], [])).toBeNull();
    expect(fitTemperatureFromLogits([[1, 2]], [0, 1])).toBeNull();
  });
});

describe("collectCalibrationSamples", () => {
  it("returns null when DB is unavailable / no samples (N=0 fail-safe)", async () => {
    // In the test env getDb() resolves to null (no DATABASE_URL) → null.
    const { collectCalibrationSamples } = await import("./aiCalibration");
    const result = await collectCalibrationSamples({ modelId: 999999 });
    expect(result).toBeNull();
  });
});
