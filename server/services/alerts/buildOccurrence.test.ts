import { describe, it, expect } from "vitest";
import { buildOccurrence } from "./buildOccurrence";

const now = new Date("2026-07-29T10:00:00.000Z");

describe("buildOccurrence", () => {
  it("dựng đủ trường từ sự kiện của LẦN NÀY", () => {
    expect(buildOccurrence(7, { severity: "HIGH", confidence: 63.5 }, now)).toEqual({
      alertId: 7, occurredAt: now, severity: "HIGH", confidenceScore: "63.50",
    });
  });

  it("không có độ tin cậy ⇒ null, KHÔNG bịa số", () => {
    expect(buildOccurrence(7, { severity: "MEDIUM", confidence: null }, now))
      .toEqual({ alertId: 7, occurredAt: now, severity: "MEDIUM", confidenceScore: null });
  });

  it("độ tin cậy là chuỗi (decimal từ pg) vẫn chuẩn hoá đúng", () => {
    // Hàm trả `OccurrenceRow | null` ⇒ phải khẳng định khác null TRƯỚC khi đọc trường,
    // nếu không `tsc` sẽ vỡ ("possibly null").
    const row = buildOccurrence(7, { severity: "LOW", confidence: "50" }, now);
    expect(row).not.toBeNull();
    expect(row!.confidenceScore).toBe("50.00");
  });

  it("độ tin cậy rác ⇒ null, không ném", () => {
    const row = buildOccurrence(7, { severity: "LOW", confidence: "abc" }, now);
    expect(row).not.toBeNull();
    expect(row!.confidenceScore).toBeNull();
  });

  it("KHÔNG có alertId ⇒ null (không ghi dòng mồ côi)", () => {
    expect(buildOccurrence(undefined as any, { severity: "HIGH", confidence: 1 }, now)).toBeNull();
  });
});
