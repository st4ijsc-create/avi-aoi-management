/**
 * Doc 31 MP6 (decision #2) — pure unit tests for the point spec-gate evaluator.
 * No DB. Proves 3D-limit + criteria gating and its monotonic (OK→NG only) policy.
 */
import { describe, it, expect } from "vitest";
import { evaluatePointResult, isPointLimitEvalEnabled } from "./pointResultEvaluator";

describe("evaluatePointResult — 3D limit gating", () => {
  it("downgrades machine OK → NG when height is above heightMax", () => {
    const def = { heightMin: "10", heightMax: "20" };
    const m = { valueHeight: "25" };
    const r = evaluatePointResult(def, m, "OK");
    expect(r.result).toBe("NG");
    expect(r.overridden).toBe(true);
    expect(r.evaluated).toBe(true);
    expect(r.violations[0]).toContain("height");
  });

  it("downgrades when height is below heightMin", () => {
    const r = evaluatePointResult({ heightMin: "10", heightMax: "20" }, { valueHeight: "5" }, "OK");
    expect(r.result).toBe("NG");
  });

  it("keeps OK when height is within range", () => {
    const r = evaluatePointResult({ heightMin: "10", heightMax: "20" }, { valueHeight: "15" }, "OK");
    expect(r.result).toBe("OK");
    expect(r.overridden).toBe(false);
    expect(r.evaluated).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it("enforces max-only ceilings (voidPct / coplanarity / tilt)", () => {
    expect(evaluatePointResult({ voidPctMax: "25" }, { valueVoidPct: "40" }, "OK").result).toBe("NG");
    expect(evaluatePointResult({ coplanarityMax: "50" }, { valueCoplanarity: "60" }, "OK").result).toBe("NG");
    expect(evaluatePointResult({ tiltMax: "3" }, { valueTilt: "2" }, "OK").result).toBe("OK");
  });

  it("enforces the 1D LSL/USL on measuredValue", () => {
    expect(evaluatePointResult({ lowerLimit: "1", upperLimit: "2" }, { measuredValue: "3" }, "OK").result).toBe("NG");
    expect(evaluatePointResult({ lowerLimit: "1", upperLimit: "2" }, { measuredValue: "1.5" }, "OK").result).toBe("OK");
  });

  it("passes the machine verdict through when the point has NO limits (e.g. VISUAL)", () => {
    const r = evaluatePointResult({}, { measuredValue: "999" }, "OK");
    expect(r.result).toBe("OK");
    expect(r.evaluated).toBe(false);
  });

  it("only evaluates a dimension when BOTH a limit and a value are present", () => {
    // limit present, value missing → not evaluated
    expect(evaluatePointResult({ heightMax: "20" }, {}, "OK").evaluated).toBe(false);
    // value present, limit missing → not evaluated
    expect(evaluatePointResult({}, { valueHeight: "999" }, "OK").evaluated).toBe(false);
  });

  it("is monotonic: never upgrades NG→OK and never touches NTF", () => {
    // machine NG, values within limits → stays NG
    expect(evaluatePointResult({ heightMin: "10", heightMax: "20" }, { valueHeight: "15" }, "NG").result).toBe("NG");
    // machine NTF, values violate → stays NTF (human disposition wins)
    expect(evaluatePointResult({ heightMax: "20" }, { valueHeight: "99" }, "NTF").result).toBe("NTF");
  });
});

describe("evaluatePointResult — criteria gating", () => {
  it("fails a numeric_range criterion out of bounds", () => {
    const def = { criteria: [{ kind: "numeric_range", metric: "volume", min: 80, max: 120 }] };
    expect(evaluatePointResult(def, { valueVolume: "150" }, "OK").result).toBe("NG");
    expect(evaluatePointResult(def, { valueVolume: "100" }, "OK").result).toBe("OK");
  });

  it("fails a boolean_check when the observed boolean differs", () => {
    const def = { criteria: [{ kind: "boolean_check", metric: "value", expected: true }] };
    expect(evaluatePointResult(def, { measuredValueText: "false" }, "OK").result).toBe("NG");
    expect(evaluatePointResult(def, { measuredValueText: "true" }, "OK").result).toBe("OK");
  });

  it("fails a text_match (exact / contains / regex)", () => {
    expect(evaluatePointResult({ criteria: [{ kind: "text_match", metric: "value", expected: "PASS" }] }, { measuredValueText: "FAIL" }, "OK").result).toBe("NG");
    expect(evaluatePointResult({ criteria: [{ kind: "text_match", metric: "value", expected: "OK", mode: "contains" }] }, { measuredValueText: "STATUS-OK" }, "OK").result).toBe("OK");
    expect(evaluatePointResult({ criteria: [{ kind: "text_match", metric: "value", expected: "^A\\d+$", mode: "regex" }] }, { measuredValueText: "B12" }, "OK").result).toBe("NG");
  });

  it("skips criteria referencing an unknown metric (never fails a good board)", () => {
    const def = { criteria: [{ kind: "numeric_range", metric: "unknownXYZ", min: 0, max: 1 }] };
    const r = evaluatePointResult(def, { measuredValue: "999" }, "OK");
    expect(r.result).toBe("OK");
    expect(r.evaluated).toBe(false);
  });
});

describe("isPointLimitEvalEnabled", () => {
  it("defaults ON", () => {
    const prev = process.env.POINT_LIMIT_EVAL_ENABLED;
    delete process.env.POINT_LIMIT_EVAL_ENABLED;
    expect(isPointLimitEvalEnabled()).toBe(true);
    process.env.POINT_LIMIT_EVAL_ENABLED = "false";
    expect(isPointLimitEvalEnabled()).toBe(false);
    if (prev === undefined) delete process.env.POINT_LIMIT_EVAL_ENABLED;
    else process.env.POINT_LIMIT_EVAL_ENABLED = prev;
  });
});
