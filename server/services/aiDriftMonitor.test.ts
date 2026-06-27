/**
 * B5.2 — Drift monitor tests.
 *
 * Covers the pure helpers (summarizeConfidences, psiFromHistograms) and the
 * sample-injection path of checkConfidenceDrift (which bypasses the DB + the
 * AI_DRIFT_MONITOR_ENABLED flag so the math is testable offline):
 *   - identical distributions → no drift, PSI ≈ 0
 *   - a confidence collapse (high → low) → drift flagged with reasons
 *   - too few samples → evaluated:false (fail-safe, no false alarm)
 */
import { describe, it, expect } from "vitest";
import {
  summarizeConfidences,
  psiFromHistograms,
  checkConfidenceDrift,
} from "./aiDriftMonitor";

describe("summarizeConfidences", () => {
  it("computes count/mean/std and a normalized histogram", () => {
    const s = summarizeConfidences([0.0, 0.5, 1.0]);
    expect(s.count).toBe(3);
    expect(s.mean).toBeCloseTo(0.5, 6);
    // histogram fractions sum to 1
    const sum = s.histogram.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it("empty input → zeroed summary (fail-safe)", () => {
    const s = summarizeConfidences([]);
    expect(s.count).toBe(0);
    expect(s.mean).toBe(0);
    expect(s.histogram.every((x) => x === 0)).toBe(true);
  });
});

describe("psiFromHistograms", () => {
  it("identical histograms → PSI ≈ 0", () => {
    const h = summarizeConfidences([0.9, 0.85, 0.95, 0.8, 0.92]).histogram;
    expect(psiFromHistograms(h, h)).toBeCloseTo(0, 6);
  });

  it("disjoint histograms → large PSI", () => {
    const a = summarizeConfidences(Array(100).fill(0.95)).histogram;
    const b = summarizeConfidences(Array(100).fill(0.1)).histogram;
    expect(psiFromHistograms(a, b)).toBeGreaterThan(0.25);
  });
});

describe("checkConfidenceDrift (sample-injection path)", () => {
  const stable = () => Array.from({ length: 200 }, (_, i) => 0.9 + ((i % 5) - 2) * 0.01); // ~0.88–0.92

  it("identical windows → no drift", async () => {
    const res = await checkConfidenceDrift({ modelId: 1, samples: { baseline: stable(), recent: stable() } });
    expect(res.evaluated).toBe(true);
    expect(res.drift).toBe(false);
    expect(res.severity).toBe("NONE");
    expect(res.psi).toBeLessThan(0.1);
  });

  it("confidence collapse (high → low) → drift flagged", async () => {
    const baseline = Array(200).fill(0.95);
    const recent = Array.from({ length: 200 }, (_, i) => 0.45 + (i % 10) * 0.01); // ~0.45–0.54
    const res = await checkConfidenceDrift({ modelId: 1, samples: { baseline, recent } });
    expect(res.evaluated).toBe(true);
    expect(res.drift).toBe(true);
    expect(["HIGH", "CRITICAL"]).toContain(res.severity);
    expect(res.meanShift).toBeGreaterThan(0.15);
    expect(res.reasons.length).toBeGreaterThan(0);
  });

  it("too few samples → not evaluated (no false alarm)", async () => {
    const res = await checkConfidenceDrift({ modelId: 1, samples: { baseline: [0.9, 0.9], recent: [0.5, 0.5] } });
    expect(res.evaluated).toBe(false);
    expect(res.drift).toBe(false);
    expect(res.reasons.some((r) => r.includes("insufficient samples"))).toBe(true);
  });
});
