/**
 * WS-1 — Unit tests for aiMetrics (pure, no DB).
 */
import { describe, it, expect } from "vitest";
import {
  softmax,
  argmax,
  normalizedEntropy,
  buildConfusionMatrix,
  accuracyFromConfusion,
  computeMetrics,
  computeMetricsFromPredictions,
  normalizeLabel,
  displayLabel,
  seededShuffle,
  mulberry32,
} from "./aiMetrics";

describe("softmax", () => {
  it("sums to 1 and is monotonic in logits", () => {
    const p = softmax([1, 2, 3]);
    const sum = p.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(p[2]).toBeGreaterThan(p[1]!);
    expect(p[1]).toBeGreaterThan(p[0]!);
  });
  it("is numerically stable for large logits", () => {
    const p = softmax([1000, 1001]);
    expect(p[0]! + p[1]!).toBeCloseTo(1, 6);
    expect(Number.isNaN(p[0]!)).toBe(false);
  });
});

describe("argmax", () => {
  it("returns index of max (first wins on tie)", () => {
    expect(argmax([0.1, 0.9, 0.2])).toBe(1);
    expect(argmax([0.5, 0.5])).toBe(0);
  });
});

describe("normalizedEntropy", () => {
  it("is 0 for a certain distribution", () => {
    expect(normalizedEntropy([1, 0, 0])).toBeCloseTo(0, 6);
  });
  it("is 1 for a uniform distribution", () => {
    expect(normalizedEntropy([0.5, 0.5])).toBeCloseTo(1, 6);
    expect(normalizedEntropy([1 / 3, 1 / 3, 1 / 3])).toBeCloseTo(1, 6);
  });
  it("is between 0 and 1 for a skewed distribution", () => {
    const h = normalizedEntropy([0.7, 0.2, 0.1]);
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(1);
  });
});

describe("confusion matrix + metrics", () => {
  it("builds matrix[actual][predicted]", () => {
    const m = buildConfusionMatrix([0, 1, 1], [0, 1, 0], 2);
    // sample0: actual0/pred0, sample1: actual1/pred1, sample2: actual0/pred1
    expect(m).toEqual([
      [1, 1],
      [0, 1],
    ]);
  });

  it("perfect classifier → accuracy 1, P/R/F1 = 1", () => {
    const metrics = computeMetricsFromPredictions([0, 1, 2], [0, 1, 2], 3);
    expect(metrics.accuracy).toBe(1);
    expect(metrics.precision).toBe(1);
    expect(metrics.recall).toBe(1);
    expect(metrics.f1Score).toBe(1);
    expect(metrics.microF1).toBe(1);
  });

  it("micro metrics equal accuracy for single-label classification", () => {
    const metrics = computeMetricsFromPredictions([0, 0, 1, 1], [0, 1, 1, 1], 2);
    expect(metrics.microPrecision).toBeCloseTo(metrics.accuracy, 6);
    expect(metrics.microRecall).toBeCloseTo(metrics.accuracy, 6);
  });

  it("accuracyFromConfusion = trace/total", () => {
    expect(accuracyFromConfusion([[2, 1], [0, 2]])).toBeCloseTo(4 / 5, 6);
  });

  it("computeMetrics ignores empty (no-support) classes in macro avg", () => {
    // class 2 never appears as actual → excluded from macro denominator
    const m = computeMetrics(buildConfusionMatrix([0, 1], [0, 1], 3));
    expect(m.accuracy).toBe(1);
    expect(m.precision).toBe(1);
  });
});

describe("normalizeLabel / displayLabel", () => {
  it("collapses casing + whitespace so 'xước' === ' Xước '", () => {
    expect(normalizeLabel(" Xước ")).toBe(normalizeLabel("xước"));
  });
  it("normalizes diacritic composition (NFC)", () => {
    const decomposed = "xước"; // combining acute
    expect(normalizeLabel(decomposed)).toBe(normalizeLabel("xước"));
  });
  it("displayLabel preserves casing but trims", () => {
    expect(displayLabel("  Scratch  ")).toBe("Scratch");
  });
  it("handles null/undefined", () => {
    expect(normalizeLabel(null)).toBe("");
    expect(displayLabel(undefined)).toBe("");
  });
});

describe("seededShuffle / mulberry32", () => {
  it("is reproducible for the same seed", () => {
    const a = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], 42);
    const b = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], 42);
    expect(a).toEqual(b);
  });
  it("differs for different seeds (with high probability)", () => {
    const a = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], 1);
    const b = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], 2);
    expect(a).not.toEqual(b);
  });
  it("is a permutation (no loss)", () => {
    const a = seededShuffle([1, 2, 3, 4, 5], 99);
    expect(a.slice().sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
  });
  it("mulberry32 yields values in [0,1)", () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
