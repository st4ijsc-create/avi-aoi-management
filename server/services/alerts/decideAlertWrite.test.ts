import { describe, it, expect } from "vitest";
import { decideAlertWrite, maxSeverity } from "./decideAlertWrite";

const open = { id: 7, severity: "HIGH" as const, occurrenceCount: 22 };

describe("maxSeverity — mức độ chỉ đi lên", () => {
  it("CRITICAL vs MEDIUM ⇒ CRITICAL", () => {
    expect(maxSeverity("CRITICAL", "MEDIUM")).toBe("CRITICAL");
  });
  it("MEDIUM vs CRITICAL ⇒ CRITICAL (không phụ thuộc thứ tự tham số)", () => {
    expect(maxSeverity("MEDIUM", "CRITICAL")).toBe("CRITICAL");
  });
});

describe("decideAlertWrite", () => {
  it("KHÔNG có machineId ⇒ luôn INSERT, kể cả khi có cảnh báo mở", () => {
    expect(decideAlertWrite(open, { machineId: null, alertType: "PATTERN_ANOMALY", severity: "MEDIUM" }))
      .toEqual({ action: "insert", reason: "no-machine" });
  });

  it("tra cứu HỎNG ⇒ INSERT (fail-OPEN), kể cả khi có cảnh báo mở", () => {
    expect(decideAlertWrite(open, { machineId: 2, alertType: "MACHINE_FAILURE", severity: "HIGH" }, true))
      .toEqual({ action: "insert", reason: "lookup-failed" });
  });

  it("không có cảnh báo mở ⇒ INSERT", () => {
    expect(decideAlertWrite(null, { machineId: 2, alertType: "MACHINE_FAILURE", severity: "HIGH" }))
      .toEqual({ action: "insert", reason: "no-open-alert" });
  });

  it("có cảnh báo mở ⇒ UPDATE, tăng số lần tái diễn từ giá trị CŨ", () => {
    expect(decideAlertWrite(open, { machineId: 2, alertType: "MACHINE_FAILURE", severity: "HIGH" }))
      .toEqual({ action: "update", id: 7, severity: "HIGH", occurrenceCount: 23 });
  });

  it("mức độ KHÔNG được tụt: đang CRITICAL, vòng sau MEDIUM ⇒ vẫn CRITICAL", () => {
    expect(decideAlertWrite({ id: 9, severity: "CRITICAL", occurrenceCount: 1 },
      { machineId: 2, alertType: "MACHINE_FAILURE", severity: "MEDIUM" }))
      .toEqual({ action: "update", id: 9, severity: "CRITICAL", occurrenceCount: 2 });
  });

  it("mức độ ĐƯỢC nâng: đang MEDIUM, vòng sau CRITICAL ⇒ CRITICAL", () => {
    expect(decideAlertWrite({ id: 9, severity: "MEDIUM", occurrenceCount: 4 },
      { machineId: 2, alertType: "MACHINE_FAILURE", severity: "CRITICAL" }))
      .toEqual({ action: "update", id: 9, severity: "CRITICAL", occurrenceCount: 5 });
  });
});
