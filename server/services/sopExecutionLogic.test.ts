/**
 * doc 44 W6-1 (G5.14) — pure e-SOP confirm-gate logic tests.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeInput,
  validateStepConfirmation,
  isStepSatisfied,
  computeExecutionProgress,
  canFinishExecution,
  upsertConfirmation,
  type SopStepLite,
  type SopStepConfirmation,
} from "./sopExecutionLogic";

const steps: SopStepLite[] = [
  { stepNo: 1, requiresConfirm: false },
  { stepNo: 2, requiresConfirm: true }, // confirm, no expected input
  { stepNo: 3, requiresConfirm: true, expectedInput: "JIG-X" }, // confirm + scan
];

const conf = (stepNo: number, input?: string): SopStepConfirmation => ({
  stepNo,
  confirmedBy: 1,
  confirmedAt: new Date().toISOString(),
  input: input ?? null,
});

describe("normalizeInput", () => {
  it("trims, uppercases, takes first token", () => {
    expect(normalizeInput("  jig-x ")).toBe("JIG-X");
    expect(normalizeInput("JIG-X|LOT7")).toBe("JIG-X");
    expect(normalizeInput(null)).toBe("");
  });
});

describe("validateStepConfirmation", () => {
  it("non-confirm step is always OK", () => {
    expect(validateStepConfirmation(steps, 1).ok).toBe(true);
  });
  it("confirm step without expected input is OK", () => {
    expect(validateStepConfirmation(steps, 2).ok).toBe(true);
  });
  it("confirm step with expected input requires a match", () => {
    expect(validateStepConfirmation(steps, 3, "").code).toBe("INPUT_REQUIRED");
    expect(validateStepConfirmation(steps, 3, "WRONG").code).toBe("INPUT_MISMATCH");
    expect(validateStepConfirmation(steps, 3, "jig-x").ok).toBe(true); // case/space-insensitive
  });
  it("unknown step → NO_SUCH_STEP", () => {
    expect(validateStepConfirmation(steps, 99).code).toBe("NO_SUCH_STEP");
  });
});

describe("isStepSatisfied", () => {
  it("non-confirm always satisfied", () => {
    expect(isStepSatisfied(steps[0], [])).toBe(true);
  });
  it("confirm step needs a confirmation", () => {
    expect(isStepSatisfied(steps[1], [])).toBe(false);
    expect(isStepSatisfied(steps[1], [conf(2)])).toBe(true);
  });
  it("scan step needs matching input", () => {
    expect(isStepSatisfied(steps[2], [conf(3, "WRONG")])).toBe(false);
    expect(isStepSatisfied(steps[2], [conf(3, "JIG-X")])).toBe(true);
  });
});

describe("computeExecutionProgress + canFinish", () => {
  it("incomplete until all required steps satisfied", () => {
    const p0 = computeExecutionProgress(steps, []);
    expect(p0.requiredSteps).toBe(2);
    expect(p0.satisfiedRequired).toBe(0);
    expect(p0.complete).toBe(false);
    expect(p0.nextRequiredStepNo).toBe(2);
    expect(canFinishExecution(steps, [])).toBe(false);

    const p1 = computeExecutionProgress(steps, [conf(2)]);
    expect(p1.satisfiedRequired).toBe(1);
    expect(p1.nextRequiredStepNo).toBe(3);
    expect(p1.complete).toBe(false);

    const p2 = computeExecutionProgress(steps, [conf(2), conf(3, "JIG-X")]);
    expect(p2.satisfiedRequired).toBe(2);
    expect(p2.complete).toBe(true);
    expect(p2.nextRequiredStepNo).toBe(null);
    expect(canFinishExecution(steps, [conf(2), conf(3, "JIG-X")])).toBe(true);
  });

  it("a wrong scan does NOT satisfy the gate", () => {
    expect(canFinishExecution(steps, [conf(2), conf(3, "WRONG")])).toBe(false);
  });

  it("SOP with no required steps is complete", () => {
    const info: SopStepLite[] = [{ stepNo: 1, requiresConfirm: false }];
    expect(canFinishExecution(info, [])).toBe(true);
  });
});

describe("upsertConfirmation", () => {
  it("adds new and overwrites same step, keeps order", () => {
    let arr: SopStepConfirmation[] = [];
    arr = upsertConfirmation(arr, conf(3, "A"));
    arr = upsertConfirmation(arr, conf(2, "B"));
    expect(arr.map((c) => c.stepNo)).toEqual([2, 3]);
    arr = upsertConfirmation(arr, conf(3, "C"));
    expect(arr.filter((c) => c.stepNo === 3)).toHaveLength(1);
    expect(arr.find((c) => c.stepNo === 3)?.input).toBe("C");
  });
});
