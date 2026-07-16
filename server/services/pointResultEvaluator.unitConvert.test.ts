/**
 * Doc 51 P2 (CASE #11) — UNIT CONVERSION before the 1D spec gate.
 *
 * The gap: a machine sending measuredValue in mil while the point def's limits are
 * in mm made the gate compare raw-vs-raw (mil vs mm) and silently downgrade a good
 * board to NG. The evaluator now converts the measured value into the def's unit
 * first, and REFUSES (skips the gate + flags) when the units are incompatible.
 *
 * Each test is a mutation test: it turns RED if the conversion is removed.
 */
import { describe, it, expect } from "vitest";
import {
  evaluatePointResult,
  lengthUnitToMm,
  convertMeasuredValueToDefUnit,
  type PointLimitSource,
  type MeasurementValues,
} from "./pointResultEvaluator";

describe("lengthUnitToMm — canonical length table", () => {
  it("known units resolve; unknown → null", () => {
    expect(lengthUnitToMm("mm")).toBe(1);
    expect(lengthUnitToMm("mil")).toBeCloseTo(0.0254, 6);
    expect(lengthUnitToMm("thou")).toBeCloseTo(0.0254, 6);
    expect(lengthUnitToMm("inch")).toBe(25.4);
    expect(lengthUnitToMm("in")).toBe(25.4);
    expect(lengthUnitToMm("micron")).toBe(0.001);
    expect(lengthUnitToMm("um")).toBe(0.001);
    expect(lengthUnitToMm("cm")).toBe(10);
    expect(lengthUnitToMm("M")).toBe(1000); // case-insensitive
    expect(lengthUnitToMm("volts")).toBeNull();
    expect(lengthUnitToMm(null)).toBeNull();
  });
});

describe("convertMeasuredValueToDefUnit", () => {
  it("mil → mm converts by 0.0254", () => {
    const r = convertMeasuredValueToDefUnit(40, { unit: "mil" }, { unit: "mm" });
    expect(r.mismatch).toBe(false);
    expect(r.value).toBeCloseTo(1.016, 6);
  });
  it("same unit → passthrough, no conversion", () => {
    expect(convertMeasuredValueToDefUnit(40, { unit: "mm" }, { unit: "mm" })).toEqual({ value: 40, mismatch: false });
  });
  it("either unit absent → passthrough (backward compatible)", () => {
    expect(convertMeasuredValueToDefUnit(40, {}, { unit: "mm" })).toEqual({ value: 40, mismatch: false });
    expect(convertMeasuredValueToDefUnit(40, { unit: "mil" }, {})).toEqual({ value: 40, mismatch: false });
  });
  it("incompatible / unknown unit → mismatch (caller must skip the gate)", () => {
    const r = convertMeasuredValueToDefUnit(40, { unit: "volts" }, { unit: "mm" });
    expect(r.mismatch).toBe(true);
    expect(r.value).toBeNull();
  });
  it("explicit unitScaleToCanonical overrides the table", () => {
    const r = convertMeasuredValueToDefUnit(40, { unit: "customtick", unitScaleToCanonical: 0.0254 }, { unit: "mm" });
    expect(r.mismatch).toBe(false);
    expect(r.value).toBeCloseTo(1.016, 6);
  });
});

describe("evaluatePointResult — unit-aware 1D gate", () => {
  const def: PointLimitSource = { lowerLimit: "0.9", upperLimit: "1.1", unit: "mm" };

  it("★ 40 mil (=1.016 mm) is IN spec → OK; WITHOUT conversion it would be a false NG", () => {
    const m: MeasurementValues = { measuredValue: 40, unit: "mil" };
    const converted = evaluatePointResult(def, m, "OK", { convertUnits: true });
    expect(converted.result).toBe("OK");
    expect(converted.unitMismatch).toBe(false);
    // Proof the input truly trips the gate raw-vs-raw (the bug this fixes):
    const raw = evaluatePointResult(def, m, "OK", { convertUnits: false });
    expect(raw.result).toBe("NG");
  });

  it("50 mil (=1.27 mm) is OUT of spec → still NG (conversion doesn't mask real violations)", () => {
    const r = evaluatePointResult(def, { measuredValue: 50, unit: "mil" }, "OK", { convertUnits: true });
    expect(r.result).toBe("NG");
  });

  it("incompatible unit → gate SKIPPED (never a silent NG) + unitMismatch flagged", () => {
    const r = evaluatePointResult(def, { measuredValue: 40, unit: "volts" }, "OK", { convertUnits: true });
    expect(r.result).toBe("OK");
    expect(r.unitMismatch).toBe(true);
    expect(r.evaluated).toBe(false); // value gate did not run
  });

  it("no unit sent → exactly legacy behaviour (raw gate, no mismatch)", () => {
    const r = evaluatePointResult(def, { measuredValue: 40 }, "OK", { convertUnits: true });
    expect(r.result).toBe("NG"); // 40 mm >> 1.1 mm
    expect(r.unitMismatch).toBe(false);
  });

  it("convertUnits off → units ignored entirely (raw compare)", () => {
    const r = evaluatePointResult(def, { measuredValue: 40, unit: "mil" }, "OK", { convertUnits: false });
    expect(r.result).toBe("NG");
    expect(r.unitMismatch).toBe(false);
  });
});
