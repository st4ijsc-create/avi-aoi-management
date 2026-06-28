/**
 * AI Threshold/Param Advisor — verification tests.
 *
 * Focus on the PURE helpers + the fail-safe / flag-gated public surface:
 *   - computeNgRecommendation: shape, percentile basis, clamp to tool bounds,
 *     critical >= warning, degraded when thin, no-throw on junk input.
 *   - clamp / round2 / quantileSorted basics.
 *   - recommend* functions: flag-OFF → disabled no-op; never throw.
 *
 * No DB is touched: with the flag OFF the public functions short-circuit before
 * any query, so these run without a database connection.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  clamp,
  round2,
  quantileSorted,
  computeNgRecommendation,
  NG_THRESHOLD_BOUNDS,
  isThresholdAdvisorEnabled,
  minSamples,
  recommendForMeasurementPoint,
  recommendNgThreshold,
  recommendInspectionParam,
} from "./aiThresholdAdvisor";

describe("pure helpers", () => {
  it("clamp keeps within bounds and handles non-finite", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
    expect(clamp(NaN, 0, 10)).toBe(0);
    expect(clamp(Infinity, 0, 10)).toBe(10);
  });

  it("round2 rounds to 2 decimals and coerces junk to 0", () => {
    expect(round2(1.23456)).toBe(1.23);
    expect(round2(NaN)).toBe(0);
  });

  it("quantileSorted interpolates", () => {
    const s = [0, 1, 2, 3, 4];
    expect(quantileSorted(s, 0)).toBe(0);
    expect(quantileSorted(s, 1)).toBe(4);
    expect(quantileSorted(s, 0.5)).toBe(2);
    expect(Number.isNaN(quantileSorted([], 0.5))).toBe(true);
  });
});

describe("computeNgRecommendation", () => {
  const min = 14;

  it("returns a well-formed shape with percentile basis", () => {
    const rates = Array.from({ length: 30 }, (_, i) => 2 + (i % 5)); // 2..6 %
    const r = computeNgRecommendation(rates, { min });
    expect(typeof r.warning).toBe("number");
    expect(typeof r.critical).toBe("number");
    expect(r.sampleSize).toBe(30);
    expect(r.degraded).toBe(false);
    expect(r.basis).toContain("p75");
    expect(r.basis).toContain("p90");
  });

  it("critical >= warning always", () => {
    const r = computeNgRecommendation([1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5, 6, 7, 8, 9, 50], { min });
    expect(r.critical).toBeGreaterThanOrEqual(r.warning);
  });

  it("clamps recommendations to the tool bounds (0..100)", () => {
    // Huge NG rates would push the recommendation past 100 without the clamp.
    const rates = Array.from({ length: 30 }, () => 99.9);
    const r = computeNgRecommendation(rates, { min, bounds: NG_THRESHOLD_BOUNDS });
    expect(r.warning).toBeGreaterThanOrEqual(NG_THRESHOLD_BOUNDS.min);
    expect(r.warning).toBeLessThanOrEqual(NG_THRESHOLD_BOUNDS.max);
    expect(r.critical).toBeLessThanOrEqual(NG_THRESHOLD_BOUNDS.max);
  });

  it("respects a custom (tighter) bounds clamp", () => {
    const rates = Array.from({ length: 30 }, () => 40);
    const r = computeNgRecommendation(rates, { min, bounds: { min: 0, max: 20 } });
    expect(r.warning).toBeLessThanOrEqual(20);
    expect(r.critical).toBeLessThanOrEqual(20);
  });

  it("degrades when fewer than `min` observations", () => {
    const r = computeNgRecommendation([3, 4, 5], { min });
    expect(r.degraded).toBe(true);
    expect(r.sampleSize).toBe(3);
  });

  it("empty input → degraded conservative fallback, no throw", () => {
    const r = computeNgRecommendation([], { min, fallbackWarning: 5, fallbackCritical: 10 });
    expect(r.degraded).toBe(true);
    expect(r.sampleSize).toBe(0);
    expect(r.warning).toBe(5);
    expect(r.critical).toBe(10);
  });

  it("filters out NaN / negative junk without throwing", () => {
    const r = computeNgRecommendation([NaN, -5, 3, 4, 5] as number[], { min });
    expect(r.sampleSize).toBe(3);
    expect(Number.isFinite(r.warning)).toBe(true);
  });
});

describe("flags", () => {
  const prev = process.env.AI_THRESHOLD_ADVISOR_ENABLED;
  const prevMin = process.env.AI_THRESHOLD_ADVISOR_MIN_SAMPLES;
  afterEach(() => {
    process.env.AI_THRESHOLD_ADVISOR_ENABLED = prev;
    process.env.AI_THRESHOLD_ADVISOR_MIN_SAMPLES = prevMin;
  });

  it("isThresholdAdvisorEnabled defaults OFF", () => {
    delete process.env.AI_THRESHOLD_ADVISOR_ENABLED;
    expect(isThresholdAdvisorEnabled()).toBe(false);
  });

  it("minSamples defaults to 300", () => {
    delete process.env.AI_THRESHOLD_ADVISOR_MIN_SAMPLES;
    expect(minSamples()).toBe(300);
  });

  it("minSamples honors override", () => {
    process.env.AI_THRESHOLD_ADVISOR_MIN_SAMPLES = "50";
    expect(minSamples()).toBe(50);
  });
});

describe("public functions are flag-gated + fail-safe", () => {
  beforeEach(() => {
    process.env.AI_THRESHOLD_ADVISOR_ENABLED = "false";
  });

  it("recommendForMeasurementPoint → disabled no-op when flag OFF (no throw)", async () => {
    const r = await recommendForMeasurementPoint({ measurementPointId: 1 });
    expect(r.ok).toBe(true);
    expect(r.disabled).toBe(true);
    expect(r.degraded).toBe(true);
  });

  it("recommendNgThreshold → disabled no-op when flag OFF (no throw)", async () => {
    const r = await recommendNgThreshold({ ngThresholdId: 1 });
    expect(r.ok).toBe(true);
    expect(r.disabled).toBe(true);
    // Conservative default recommendation present even when disabled.
    expect(r.recommended.warning).toBeGreaterThanOrEqual(0);
    expect(r.recommended.critical).toBeGreaterThanOrEqual(r.recommended.warning);
  });

  it("recommendInspectionParam → disabled no-op when flag OFF (no throw)", async () => {
    const r = await recommendInspectionParam({ ngThresholdId: 1 });
    expect(r.ok).toBe(true);
    expect(r.disabled).toBe(true);
  });
});
