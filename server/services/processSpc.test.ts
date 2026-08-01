// doc 56 Đ5 — buildProcessControlChart: I-MR wiring over the shared SPC math.
import { describe, it, expect } from "vitest";
import { buildProcessControlChart } from "./processSpc";

const ts = (i: number) => new Date(2026, 6, 18, 0, 0, i); // distinct, ordered

describe("buildProcessControlChart (doc 56 Đ5)", () => {
  it("returns ok=false with < 2 samples (I-MR needs a moving range)", () => {
    const c = buildProcessControlChart("torque", [{ value: 12, measuredAt: ts(0) }]);
    expect(c.ok).toBe(false);
    expect(c.n).toBe(1);
    expect(c.limits).toBeNull();
    expect(c.points).toEqual([]);
  });

  it("computes I-MR limits + centers on the process mean for a stable series", () => {
    const samples = [12.0, 12.1, 11.9, 12.05, 11.95, 12.02, 11.98, 12.0].map((v, i) => ({ value: v, measuredAt: ts(i) }));
    const c = buildProcessControlChart("torque", samples);
    expect(c.ok).toBe(true);
    expect(c.n).toBe(8);
    expect(c.limits).not.toBeNull();
    // CL ≈ mean(≈12.0); UCL > CL > LCL.
    expect(c.limits!.CL).toBeGreaterThan(11.9);
    expect(c.limits!.CL).toBeLessThan(12.1);
    expect(c.limits!.UCL).toBeGreaterThan(c.limits!.CL);
    expect(c.limits!.LCL).toBeLessThan(c.limits!.CL);
    expect(c.points).toHaveLength(8);
    // A stable series should have no rule-1 (beyond-limit) violations.
    expect(c.outOfControlCount).toBe(0);
  });

  it("flags an out-of-control point when one sample jumps far beyond the limits", () => {
    const base = Array.from({ length: 12 }, (_, i) => ({ value: 12 + (i % 2 === 0 ? 0.01 : -0.01), measuredAt: ts(i) }));
    base.push({ value: 25, measuredAt: ts(12) }); // gross outlier
    const c = buildProcessControlChart("torque", base);
    expect(c.ok).toBe(true);
    expect(c.outOfControlCount).toBeGreaterThanOrEqual(1);
    const flagged = c.points.find((p) => p.outOfControl);
    expect(flagged).toBeTruthy();
    expect(flagged!.rules.length).toBeGreaterThan(0);
  });

  it("adds capability (cp/cpk) only when spec limits are supplied", () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({ value: 12 + Math.sin(i) * 0.05, measuredAt: ts(i) }));
    const withoutSpec = buildProcessControlChart("torque", samples);
    expect(withoutSpec.capability).toBeNull();

    const withSpec = buildProcessControlChart("torque", samples, { usl: 13.5, lsl: 10.5 });
    expect(withSpec.capability).not.toBeNull();
    expect(withSpec.capability!.usl).toBe(13.5);
    expect(withSpec.capability!.lsl).toBe(10.5);
    expect(typeof withSpec.capability!.cpk === "number" || withSpec.capability!.cpk === null).toBe(true);
  });
});
