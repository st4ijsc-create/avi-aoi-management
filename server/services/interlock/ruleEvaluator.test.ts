/**
 * Sprint F5a — ruleEvaluator pure-logic tests (no DB, no I/O).
 */
import { describe, it, expect } from "vitest";
import { compare, evaluateCondition, deriveObserved } from "./ruleEvaluator";

describe("compare", () => {
  it("evaluates each operator with real values", () => {
    expect(compare(5, "lt", 10)).toBe(true);
    expect(compare(10, "lt", 10)).toBe(false);
    expect(compare(10, "lte", 10)).toBe(true);
    expect(compare(11, "gt", 10)).toBe(true);
    expect(compare(10, "gt", 10)).toBe(false);
    expect(compare(10, "gte", 10)).toBe(true);
    expect(compare(10, "eq", 10)).toBe(true);
    expect(compare(9, "eq", 10)).toBe(false);
  });

  it("returns false for null / NaN operands (safe)", () => {
    expect(compare(null, "gt", 10)).toBe(false);
    expect(compare(5, "gt", null)).toBe(false);
    expect(compare(NaN, "gt", 10)).toBe(false);
    expect(compare(undefined, "lt", 10)).toBe(false);
  });
});

describe("evaluateCondition with consecutiveCount", () => {
  it("fires only when the last N samples all satisfy the comparison", () => {
    // need 3 consecutive > 100
    expect(evaluateCondition(undefined, "gt", 100, 3, [50, 120, 130, 140])).toBe(true);
    expect(evaluateCondition(undefined, "gt", 100, 3, [120, 130, 90])).toBe(false); // last is 90
    expect(evaluateCondition(undefined, "gt", 100, 3, [120, 130])).toBe(false); // not enough samples
  });

  it("falls back to single-value compare when no consecutiveCount", () => {
    expect(evaluateCondition(150, "gt", 100)).toBe(true);
    expect(evaluateCondition(80, "gt", 100)).toBe(false);
  });

  it("treats consecutiveCount<=1 as single-value compare", () => {
    expect(evaluateCondition(150, "gt", 100, 1, [10, 20])).toBe(true);
  });
});

describe("deriveObserved", () => {
  it("uses count for spc_violation / process_result", () => {
    expect(deriveObserved("spc_violation", { count: 7 })).toBe(7);
    expect(deriveObserved("process_result", { count: 0 })).toBe(0);
  });

  it("uses scalar for ng_rate / cpk / telemetry_tag", () => {
    expect(deriveObserved("ng_rate", { scalar: 12.5 })).toBe(12.5);
    expect(deriveObserved("cpk", { scalar: 1.1 })).toBe(1.1);
    expect(deriveObserved("telemetry_tag", { scalar: 88 })).toBe(88);
  });

  it("returns null when the relevant field is missing", () => {
    expect(deriveObserved("ng_rate", {})).toBeNull();
    expect(deriveObserved("spc_violation", {})).toBeNull();
  });
});
