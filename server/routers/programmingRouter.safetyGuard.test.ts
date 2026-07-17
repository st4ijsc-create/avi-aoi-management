/**
 * Doc 54 P3.4 — unit tests cho hai guard THUẦN (pure) của programmingRouter:
 *   • isSafetyRelevantProgram — copilot review/explain KHÔNG được lặng lẽ chứng nhận logic an toàn.
 *   • idempotencyKeyConflicts — tái dùng idempotencyKey cho yêu cầu KHÁC phải bị coi là xung đột
 *     (chống "swallow-reject"), còn replay đúng yêu cầu thì KHÔNG.
 *
 * Cả hai hàm đều thuần (không DB, không tRPC context) → test nhanh + ổn định.
 */
import { describe, it, expect } from "vitest";
import { isSafetyRelevantProgram, idempotencyKeyConflicts } from "./programmingRouter";

describe("isSafetyRelevantProgram — safety keyword detection (copilot review/explain guard)", () => {
  it("flags e-stop / emergency-stop phrasing", () => {
    expect(isSafetyRelevantProgram("please review this emergency stop routine")).toBe(true);
    expect(isSafetyRelevantProgram("E-STOP handler")).toBe(true);
    expect(isSafetyRelevantProgram("estop", "code here")).toBe(true);
  });

  it("flags interlock / light-curtain / two-hand / guard / muting / safety-PLC / SIL / PL", () => {
    expect(isSafetyRelevantProgram("safety interlock logic")).toBe(true);
    expect(isSafetyRelevantProgram("light curtain muting")).toBe(true);
    expect(isSafetyRelevantProgram("light-curtain")).toBe(true);
    expect(isSafetyRelevantProgram("two-hand control")).toBe(true);
    expect(isSafetyRelevantProgram("guard lock")).toBe(true);
    expect(isSafetyRelevantProgram("guard")).toBe(true);
    expect(isSafetyRelevantProgram("safety PLC program")).toBe(true);
    expect(isSafetyRelevantProgram("rated SIL 3")).toBe(true);
    expect(isSafetyRelevantProgram("performance level PL d")).toBe(true);
  });

  it("flags CJK safety terms", () => {
    expect(isSafetyRelevantProgram("急停回路")).toBe(true);
    expect(isSafetyRelevantProgram("安全")).toBe(true);
  });

  it("probes across multiple args (request + code)", () => {
    expect(isSafetyRelevantProgram("optimize cycle time", "IF light_curtain THEN stop")).toBe(true);
  });

  it("does NOT flag benign motion/print programs or ordinary words", () => {
    expect(isSafetyRelevantProgram('BASE(0,1)\nMOVEABS(0,0)\nWAIT IDLE\nPRINT "done"')).toBe(false);
    expect(isSafetyRelevantProgram("place the part and print the label")).toBe(false);
    expect(isSafetyRelevantProgram("silicon wafer handler")).toBe(false);
  });

  it("returns false for empty / nullish input", () => {
    expect(isSafetyRelevantProgram()).toBe(false);
    expect(isSafetyRelevantProgram(undefined, null, "")).toBe(false);
  });
});

describe("idempotencyKeyConflicts — swallow-reject guard", () => {
  it("no conflict when the request matches the prior deploy (valid replay)", () => {
    expect(
      idempotencyKeyConflicts(
        { buildId: 10, stage: "production", deviceId: 5 },
        { buildId: 10, stage: "production", deviceId: 5 },
      ),
    ).toBe(false);
  });

  it("conflict when the SAME key is reused for a DIFFERENT build", () => {
    expect(
      idempotencyKeyConflicts(
        { buildId: 10, stage: "staging", deviceId: null },
        { buildId: 11, stage: "staging", deviceId: null },
      ),
    ).toBe(true);
  });

  it("conflict when the SAME key targets a DIFFERENT stage", () => {
    expect(
      idempotencyKeyConflicts(
        { buildId: 10, stage: "staging", deviceId: null },
        { buildId: 10, stage: "production", deviceId: null },
      ),
    ).toBe(true);
  });

  it("conflict when the caller EXPLICITLY targets a different device", () => {
    expect(
      idempotencyKeyConflicts(
        { buildId: 10, stage: "production", deviceId: 5 },
        { buildId: 10, stage: "production", deviceId: 7 },
      ),
    ).toBe(true);
  });

  it("does NOT false-conflict on deviceId when the caller omitted it (null → service resolves)", () => {
    // want.deviceId == null → không so deviceId (service tự suy ra device của project).
    expect(
      idempotencyKeyConflicts(
        { buildId: 10, stage: "production", deviceId: 5 },
        { buildId: 10, stage: "production", deviceId: null },
      ),
    ).toBe(false);
  });
});
