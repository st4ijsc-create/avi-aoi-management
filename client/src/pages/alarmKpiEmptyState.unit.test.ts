import { describe, it, expect } from "vitest";
import { pickOccurrenceLogNotice } from "./alarmKpiEmptyState";

const generatedAt = "2026-07-29T12:00:00.000Z";

describe("pickOccurrenceLogNotice", () => {
  it("đang có cảnh báo ⇒ không giải thích gì", () => {
    expect(pickOccurrenceLogNotice({
      predictiveCount: 3, occurrenceLog: { available: true, firstOccurredAt: null }, generatedAt, windowHours: 8,
    })).toBeNull();
  });

  it("bảng chưa có ⇒ table-missing", () => {
    expect(pickOccurrenceLogNotice({
      predictiveCount: 0, occurrenceLog: { available: false, firstOccurredAt: null }, generatedAt, windowHours: 8,
    })).toEqual({ kind: "table-missing" });
  });

  it("sổ rỗng ⇒ log-empty", () => {
    expect(pickOccurrenceLogNotice({
      predictiveCount: 0, occurrenceLog: { available: true, firstOccurredAt: null }, generatedAt, windowHours: 8,
    })).toEqual({ kind: "log-empty" });
  });

  it("sổ bắt đầu SAU mốc cửa sổ ⇒ log-younger-than-window", () => {
    expect(pickOccurrenceLogNotice({
      predictiveCount: 0,
      occurrenceLog: { available: true, firstOccurredAt: "2026-07-29T09:00:00.000Z" }, // 3h trước
      generatedAt, windowHours: 8,
    })).toEqual({ kind: "log-younger-than-window", firstOccurredAt: "2026-07-29T09:00:00.000Z" });
  });

  it("sổ cũ hơn cửa sổ, 0 là thật ⇒ không giải thích", () => {
    expect(pickOccurrenceLogNotice({
      predictiveCount: 0,
      occurrenceLog: { available: true, firstOccurredAt: "2026-07-01T00:00:00.000Z" },
      generatedAt, windowHours: 8,
    })).toBeNull();
  });

  it("server cũ chưa trả occurrenceLog ⇒ im lặng, KHÔNG bịa lý do", () => {
    expect(pickOccurrenceLogNotice({
      predictiveCount: 0, occurrenceLog: undefined, generatedAt, windowHours: 8,
    })).toBeNull();
  });
});
