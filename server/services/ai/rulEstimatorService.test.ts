/**
 * G4.7 (doc 44 W5-B3) — unit tests for the RUL estimator (Weibull survival).
 *
 * PURE functions only (no DB, no flag): Weibull MLE recovers a known shape/scale
 * (with and without right-censoring); conditional remaining-life matches the
 * closed-form mean at age 0 and the memoryless property at k=1; estimateRul falls
 * back HONESTLY (method='heuristic'/'insufficient_data') below the observation gate.
 */
import { describe, it, expect } from "vitest";
import {
  fitWeibull,
  weibullMean,
  conditionalRemainingLife,
  estimateRul,
  type FailureObservation,
} from "./rulEstimatorService";

// ── deterministic PRNG (mulberry32) so tests are reproducible ────────────────
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inverse-CDF Weibull sample: t = λ·(−ln(1−U))^(1/k). */
function weibullSample(rng: () => number, k: number, lambda: number): number {
  const u = Math.min(1 - 1e-12, Math.max(1e-12, rng()));
  return lambda * Math.pow(-Math.log(1 - u), 1 / k);
}

describe("weibullMean / conditionalRemainingLife", () => {
  it("weibullMean(1, λ) == λ  and  weibullMean(2, 100) == 100·Γ(1.5)", () => {
    expect(weibullMean(1, 137)).toBeCloseTo(137, 5);
    // Γ(1.5) = √π/2 ≈ 0.8862269
    expect(weibullMean(2, 100)).toBeCloseTo(88.6227, 2);
  });

  it("conditional remaining life at age 0 equals the Weibull mean", () => {
    for (const [k, lambda] of [[1, 100], [1.5, 80], [2.5, 200], [3, 50]] as const) {
      const rul0 = conditionalRemainingLife(k, lambda, 0);
      expect(rul0).toBeCloseTo(weibullMean(k, lambda), 0); // within ~1h on these scales
    }
  });

  it("k=1 is memoryless: RUL(t) ≈ λ for every age t", () => {
    const lambda = 90;
    for (const t of [0, 30, 90, 250]) {
      expect(conditionalRemainingLife(1, lambda, t)).toBeCloseTo(lambda, 0);
    }
  });

  it("wear-out (k>1): remaining life DECREASES with age", () => {
    const young = conditionalRemainingLife(3, 100, 20);
    const mid = conditionalRemainingLife(3, 100, 100);
    const old = conditionalRemainingLife(3, 100, 200);
    expect(young).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(old);
    expect(old).toBeGreaterThanOrEqual(0);
  });
});

describe("fitWeibull — MLE recovery", () => {
  it("recovers a known shape/scale from a large uncensored sample", () => {
    const rng = makeRng(12345);
    const kTrue = 2.0, lambdaTrue = 120;
    const obs: FailureObservation[] = [];
    for (let i = 0; i < 1200; i++) {
      obs.push({ durationHours: weibullSample(rng, kTrue, lambdaTrue), censored: false });
    }
    const fit = fitWeibull(obs);
    expect(fit).not.toBeNull();
    expect(fit!.shape).toBeGreaterThan(1.8);
    expect(fit!.shape).toBeLessThan(2.2);
    expect(fit!.scale).toBeGreaterThan(110);
    expect(fit!.scale).toBeLessThan(130);
    expect(fit!.failures).toBe(1200);
    expect(fit!.censored).toBe(0);
    expect(fit!.bounded).toBe(false);
  });

  it("recovers shape/scale with ~35% Type-I right censoring", () => {
    const rng = makeRng(98765);
    const kTrue = 2.0, lambdaTrue = 120;
    const cutoff = 120; // P(T>120) = e^-1 ≈ 0.368 censored
    const obs: FailureObservation[] = [];
    let censoredCount = 0;
    for (let i = 0; i < 1500; i++) {
      const t = weibullSample(rng, kTrue, lambdaTrue);
      if (t > cutoff) { obs.push({ durationHours: cutoff, censored: true }); censoredCount++; }
      else obs.push({ durationHours: t, censored: false });
    }
    expect(censoredCount).toBeGreaterThan(300); // sanity: real censoring happened
    const fit = fitWeibull(obs);
    expect(fit).not.toBeNull();
    // Censoring widens tolerance but MLE stays consistent.
    expect(fit!.shape).toBeGreaterThan(1.7);
    expect(fit!.shape).toBeLessThan(2.35);
    expect(fit!.scale).toBeGreaterThan(105);
    expect(fit!.scale).toBeLessThan(135);
    expect(fit!.censored).toBe(censoredCount);
  });

  it("returns null with no failures (all censored) or < 2 observations", () => {
    expect(fitWeibull([{ durationHours: 10, censored: true }, { durationHours: 20, censored: true }])).toBeNull();
    expect(fitWeibull([{ durationHours: 10, censored: false }])).toBeNull();
    expect(fitWeibull([])).toBeNull();
  });
});

describe("estimateRul — honest fallback vs weibull", () => {
  it("below the observation gate → method 'heuristic' when a fallback is supplied", () => {
    const obs: FailureObservation[] = [
      { durationHours: 100, censored: false },
      { durationHours: 120, censored: false },
      { durationHours: 90, censored: false },
    ]; // only 3 failures < default 5
    const est = estimateRul(obs, 40, { heuristicRulHours: 48 });
    expect(est.method).toBe("heuristic");
    expect(est.rulHours).toBe(48);
    expect(est.shape).toBeNull();
    expect(est.confidence).toBeGreaterThan(0);
    expect(est.confidence).toBeLessThan(0.35); // deliberately low — no fit was done
    expect(est.failures).toBe(3);
  });

  it("below the gate with no fallback → 'insufficient_data', null RUL, zero confidence", () => {
    const est = estimateRul([{ durationHours: 100, censored: false }], 10, {});
    expect(est.method).toBe("insufficient_data");
    expect(est.rulHours).toBeNull();
    expect(est.confidence).toBe(0);
  });

  it("enough real failures → method 'weibull' with a positive RUL + fitted params", () => {
    const rng = makeRng(2024);
    const obs: FailureObservation[] = [];
    for (let i = 0; i < 40; i++) obs.push({ durationHours: weibullSample(rng, 2.2, 100), censored: false });
    const est = estimateRul(obs, 30, { heuristicRulHours: 999 });
    expect(est.method).toBe("weibull");
    expect(est.rulHours).not.toBeNull();
    expect(est.rulHours!).toBeGreaterThan(0);
    expect(est.shape).toBeGreaterThan(1.5);
    expect(est.scale).toBeGreaterThan(70);
    expect(est.observations).toBe(40);
    // confidence from failure count: 40/(40+8) ≈ 0.833
    expect(est.confidence).toBeGreaterThan(0.7);
    expect(est.confidence).toBeLessThanOrEqual(0.9);
  });
});
