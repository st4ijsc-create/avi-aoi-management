import { describe, it, expect } from "vitest";
import {
  detectSpcViolations,
  detectEwma,
  rollingCapability,
  type SpcSample,
  type SpcLimits,
} from "./spcRules";

const limits: SpcLimits = { mean: 100, sigma: 1 };

function mkSamples(values: number[], startMs = 0): SpcSample[] {
  return values.map((v, i) => ({
    id: i + 1,
    value: v,
    sampledAt: new Date(startMs + i * 60_000),
  }));
}

function codes(violations: ReturnType<typeof detectSpcViolations>): string[] {
  return violations.map((v) => v.ruleCode);
}

describe("detectSpcViolations — Western Electric", () => {
  it("WE_1 fires on a single point > 3σ", () => {
    const s = mkSamples([100, 100, 100, 104.5, 100]);
    const v = detectSpcViolations(s, limits);
    expect(codes(v)).toContain("WE_1");
    const we1 = v.find((x) => x.ruleCode === "WE_1")!;
    expect(we1.severity).toBe("critical");
    expect(we1.sampleIndices).toEqual([3]);
  });

  it("WE_2 fires on 2 of 3 beyond 2σ same side", () => {
    const s = mkSamples([100, 102.5, 100, 102.5, 100]);
    const v = detectSpcViolations(s, limits);
    expect(codes(v)).toContain("WE_2");
  });

  it("WE_3 fires on 4 of 5 beyond 1σ same side", () => {
    const s = mkSamples([100, 101.5, 101.5, 100, 101.5, 101.5, 100]);
    const v = detectSpcViolations(s, limits);
    expect(codes(v)).toContain("WE_3");
  });

  it("WE_4 fires on 8 consecutive same side", () => {
    const s = mkSamples([100.5, 100.5, 100.5, 100.5, 100.5, 100.5, 100.5, 100.5]);
    const v = detectSpcViolations(s, limits);
    expect(codes(v)).toContain("WE_4");
  });
});

describe("detectSpcViolations — Nelson rules", () => {
  it("NELSON_1 == WE_1 territory: > 3σ point fires WE_1 (Nelson 1 alias not duplicated by impl)", () => {
    const s = mkSamples([100, 100, 103.1, 100]);
    const v = detectSpcViolations(s, limits);
    expect(codes(v)).toContain("WE_1");
  });

  it("NELSON_2 fires on 9 consecutive same side", () => {
    const s = mkSamples([100.3, 100.3, 100.3, 100.3, 100.3, 100.3, 100.3, 100.3, 100.3]);
    const v = detectSpcViolations(s, limits);
    expect(codes(v)).toContain("NELSON_2");
  });

  it("NELSON_3 fires on 6 monotonically increasing points", () => {
    const s = mkSamples([100, 100.1, 100.2, 100.3, 100.4, 100.5, 100.6]);
    const v = detectSpcViolations(s, limits);
    expect(codes(v)).toContain("NELSON_3");
  });

  it("NELSON_3 fires on 6 monotonically decreasing points", () => {
    const s = mkSamples([100.6, 100.5, 100.4, 100.3, 100.2, 100.1, 100]);
    const v = detectSpcViolations(s, limits);
    expect(codes(v)).toContain("NELSON_3");
  });

  it("NELSON_4 fires on 14 alternating points", () => {
    const vals: number[] = [];
    for (let i = 0; i < 14; i++) vals.push(i % 2 === 0 ? 99.7 : 100.3);
    const s = mkSamples(vals);
    const v = detectSpcViolations(s, limits);
    expect(codes(v)).toContain("NELSON_4");
  });

  it("NELSON_5 fires on 2 of 3 beyond 2σ same side", () => {
    const s = mkSamples([100, 102.5, 102.5]);
    const v = detectSpcViolations(s, limits);
    expect(codes(v)).toContain("NELSON_5");
  });

  it("NELSON_6 fires on 4 of 5 beyond 1σ same side", () => {
    const s = mkSamples([101.5, 101.5, 100, 101.5, 101.5]);
    const v = detectSpcViolations(s, limits);
    expect(codes(v)).toContain("NELSON_6");
  });

  it("NELSON_7 fires on 15 points within ±1σ (stratification)", () => {
    const vals: number[] = [];
    for (let i = 0; i < 15; i++) vals.push(100 + (i % 2 === 0 ? 0.2 : -0.2));
    const s = mkSamples(vals);
    const v = detectSpcViolations(s, limits);
    expect(codes(v)).toContain("NELSON_7");
  });

  it("NELSON_8 fires on 8 points all > 1σ either side", () => {
    const s = mkSamples([101.5, 98.5, 101.5, 98.5, 101.5, 98.5, 101.5, 98.5]);
    const v = detectSpcViolations(s, limits);
    expect(codes(v)).toContain("NELSON_8");
  });
});

describe("detectSpcViolations — edge cases", () => {
  it("returns [] for empty samples", () => {
    expect(detectSpcViolations([], limits)).toEqual([]);
  });
  it("returns [] for non-positive sigma", () => {
    expect(detectSpcViolations(mkSamples([100, 100]), { mean: 100, sigma: 0 })).toEqual([]);
  });
  it("does not fire on a clean in-control series", () => {
    const s = mkSamples([100, 100.1, 99.9, 100, 100.2, 99.8, 100]);
    const v = detectSpcViolations(s, limits);
    expect(v).toEqual([]);
  });
});

describe("detectEwma", () => {
  it("flags out-of-control when a sustained shift accumulates", () => {
    const vals: number[] = [];
    for (let i = 0; i < 30; i++) vals.push(100 + 1.5);
    const s = mkSamples(vals);
    const r = detectEwma(s, limits, 0.2, 3);
    expect(r.ewma).toHaveLength(30);
    expect(r.ucl).toHaveLength(30);
    expect(r.lcl).toHaveLength(30);
    expect(r.violations.some((v) => v.ruleCode === "EWMA_OOC")).toBe(true);
  });

  it("does not flag when series stays at the mean", () => {
    const s = mkSamples(Array.from({ length: 30 }, () => 100));
    const r = detectEwma(s, limits, 0.2, 3);
    expect(r.violations).toEqual([]);
  });
});

describe("rollingCapability", () => {
  it("computes Cp/Cpk/Pp/Ppk with both limits", () => {
    const r = rollingCapability(
      [100, 100.1, 99.9, 100.2, 99.8, 100, 100.1, 99.9, 100.2, 99.8],
      101, 99,
    );
    expect(r.mean).toBeCloseTo(100, 3);
    expect(r.cp).toBeGreaterThan(0);
    expect(r.cpk).toBeGreaterThan(0);
    expect(r.pp).toBeGreaterThan(0);
    expect(r.ppk).toBeGreaterThan(0);
  });

  it("uses single-sided computation when only USL is provided", () => {
    const r = rollingCapability([99, 100, 101, 99, 100], 102, null);
    expect(r.cp).toBeUndefined();
    expect(r.pp).toBeUndefined();
    expect(r.cpk).toBeDefined();
    expect(r.ppk).toBeDefined();
  });

  it("returns NaNs for empty values", () => {
    const r = rollingCapability([]);
    expect(Number.isNaN(r.mean)).toBe(true);
  });
});
