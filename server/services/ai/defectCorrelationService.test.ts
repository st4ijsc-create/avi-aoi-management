/**
 * W5-B2 (doc 44 G4.17) — quantitative defect-correlation tests (pure stats).
 *   • pearson / point-biserial on known data,
 *   • Student-t two-tailed p-value (incomplete-beta) against reference values,
 *   • univariate logistic fit direction,
 *   • correlateFactor + rankFactors top-k on known association,
 *   • flag OFF → correlateStationDefect degrades (no DB).
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  pearson,
  pearsonTwoTailedP,
  incompleteBeta,
  logisticFit1D,
  correlateFactor,
  rankFactors,
  correlateStationDefect,
  isRcaQuantitativeEnabled,
} from "./defectCorrelationService";

const SAVED = process.env.RCA_QUANTITATIVE_ENABLED;
afterEach(() => {
  if (SAVED === undefined) delete process.env.RCA_QUANTITATIVE_ENABLED;
  else process.env.RCA_QUANTITATIVE_ENABLED = SAVED;
});

describe("pearson / point-biserial", () => {
  it("perfect positive / negative correlation", () => {
    const x = [1, 2, 3, 4, 5];
    expect(pearson(x, [1, 2, 3, 4, 5])).toBeCloseTo(1, 6);
    expect(pearson(x, [5, 4, 3, 2, 1])).toBeCloseTo(-1, 6);
  });

  it("point-biserial with a binary outcome", () => {
    // higher x → y=1
    const x = [1.0, 1.1, 1.2, 2.0, 2.1, 2.2];
    const y = [0, 0, 0, 1, 1, 1];
    const r = pearson(x, y);
    expect(r).toBeGreaterThan(0.9);
  });

  it("constant vector → 0 (no correlation defined)", () => {
    expect(pearson([2, 2, 2, 2], [0, 1, 0, 1])).toBe(0);
  });
});

describe("Student-t two-tailed p-value (incomplete-beta)", () => {
  it("incompleteBeta boundary + symmetry", () => {
    expect(incompleteBeta(0, 2, 3)).toBe(0);
    expect(incompleteBeta(1, 2, 3)).toBe(1);
    expect(incompleteBeta(0.5, 3, 3)).toBeCloseTo(0.5, 6); // symmetric a=b
  });

  it("r=0 → p≈1; strong r large-n → tiny p", () => {
    expect(pearsonTwoTailedP(0, 50)).toBeCloseTo(1, 6);
    expect(pearsonTwoTailedP(0.9, 20)).toBeLessThan(0.001);
  });

  it("matches the textbook critical r≈0.361 @ n=30 → p≈0.05", () => {
    const p = pearsonTwoTailedP(0.361, 30);
    expect(p).toBeGreaterThan(0.04);
    expect(p).toBeLessThan(0.06);
  });
});

describe("logistic fit — direction", () => {
  it("higher x → defect ⇒ positive slope", () => {
    const x = [1, 1.2, 1.4, 1.6, 2.4, 2.6, 2.8, 3.0];
    const y = [0, 0, 0, 0, 1, 1, 1, 1];
    const fit = logisticFit1D(x, y);
    expect(fit.slope).toBeGreaterThan(0);
  });

  it("lower x → defect ⇒ negative slope", () => {
    const x = [1, 1.2, 1.4, 1.6, 2.4, 2.6, 2.8, 3.0];
    const y = [1, 1, 1, 1, 0, 0, 0, 0];
    const fit = logisticFit1D(x, y);
    expect(fit.slope).toBeLessThan(0);
  });
});

describe("correlateFactor + rankFactors", () => {
  // 20 units: high torque → defect.
  const torqueOk = [1.5, 1.52, 1.55, 1.5, 1.58, 1.6, 1.53, 1.57, 1.54, 1.51];
  const torqueNg = [2.0, 2.05, 2.1, 2.02, 2.08, 2.11, 2.03, 2.07, 2.04, 2.09];
  const torqueValues = [...torqueOk, ...torqueNg];
  const outcomes = [...Array(10).fill(0), ...Array(10).fill(1)];

  it("detects a significant 'higher→more defects' factor with correct means", () => {
    const c = correlateFactor("screw.torque_nm", torqueValues, outcomes, { minSamples: 12 });
    expect(c).not.toBeNull();
    expect(c!.direction).toBe("higher_more_defects");
    expect(c!.significant).toBe(true);
    expect(c!.pValue).toBeLessThan(0.01);
    expect(c!.pearson).toBeGreaterThan(0.9);
    expect(c!.meanDefect).toBeGreaterThan(c!.meanOk);
    expect(c!.logisticCoef).toBeGreaterThan(0);
    expect(c!.n).toBe(20);
  });

  it("returns null on degenerate inputs (too few / one class / constant)", () => {
    expect(correlateFactor("f", [1, 2, 3], [0, 1, 0], { minSamples: 8 })).toBeNull();
    expect(correlateFactor("f", torqueValues, Array(20).fill(1), { minSamples: 12 })).toBeNull();
    expect(correlateFactor("f", Array(20).fill(2), outcomes, { minSamples: 12 })).toBeNull();
  });

  it("rankFactors puts the significant factor first and honors top-k", () => {
    // noise factor: value uncorrelated with outcome (alternating).
    const noise = torqueValues.map((_, i) => (i % 2 === 0 ? 1.0 : 1.01));
    // weak negative factor: glue slightly lower for defects.
    const glue = outcomes.map((o) => (o === 1 ? 4.9 + Math.random() * 0.05 : 5.0 + Math.random() * 0.05));
    const ranked = rankFactors(
      [
        { factor: "noise", values: noise, outcomes },
        { factor: "screw.torque_nm", values: torqueValues, outcomes },
        { factor: "glue.volume_ml", values: glue, outcomes },
      ],
      { topK: 2, minSamples: 12 },
    );
    expect(ranked.length).toBeLessThanOrEqual(2);
    expect(ranked[0].factor).toBe("screw.torque_nm");
    expect(ranked[0].significant).toBe(true);
  });
});

describe("correlateStationDefect — flag gate (no DB)", () => {
  it("defaults OFF → ok:false, RCA_QUANTITATIVE_DISABLED", async () => {
    delete process.env.RCA_QUANTITATIVE_ENABLED;
    expect(isRcaQuantitativeEnabled()).toBe(false);
    const r = await correlateStationDefect({ machineId: 1, defectType: "missing" });
    expect(r.ok).toBe(false);
    expect(r.notes).toContain("RCA_QUANTITATIVE_DISABLED");
    expect(r.factors).toEqual([]);
  });

  it("enabled but no station → INSUFFICIENT_SCOPE_NO_STATION", async () => {
    process.env.RCA_QUANTITATIVE_ENABLED = "true";
    const r = await correlateStationDefect({ defectType: "missing" });
    expect(r.ok).toBe(false);
    expect(r.notes).toContain("INSUFFICIENT_SCOPE_NO_STATION");
  });
});
