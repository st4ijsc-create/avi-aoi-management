/**
 * ★ F2 (2026-09-22) — `bocUsage()`: bóc sự kiện SSE `usage` thành `KbUsageLuot`.
 * Luật: thiếu số cốt lõi ⇒ `null` (không dựng ô "0 token" từ gói hỏng); `tokensReasoning` vắng giữ VẮNG.
 */
import { describe, it, expect } from "vitest";
import { bocUsage } from "./useKbChatStream";

describe("bocUsage — sự kiện `usage` → KbUsageLuot", () => {
  it("★★ gói đủ ⇒ đúng từng ô, kể cả tokensReasoning = 0 (số đo, không phải vắng)", () => {
    const u = bocUsage({
      type: "usage",
      luot: "sinh-ma",
      modelId: "Qwen3.6-35B-A3B",
      tokensIn: 812,
      tokensOut: 1300,
      tokensReasoning: 0,
      thinking: false,
      samplingProfile: "hien-tai",
      latencyMs: 4200,
      ctxMax: 32768,
    });
    expect(u).toEqual({
      luot: "sinh-ma",
      modelId: "Qwen3.6-35B-A3B",
      tokensIn: 812,
      tokensOut: 1300,
      tokensReasoning: 0,
      thinking: false,
      samplingProfile: "hien-tai",
      latencyMs: 4200,
      ctxMax: 32768,
    });
  });

  it("★★★ vắng tokensReasoning ⇒ KHÔNG có khoá (không biết ≠ 0); thinking lạ ⇒ null; ctxMax 0 ⇒ bỏ", () => {
    const u = bocUsage({ type: "usage", tokensIn: 1, tokensOut: 2, latencyMs: 3, thinking: "yes", ctxMax: 0 });
    expect(u).not.toBeNull();
    expect("tokensReasoning" in u!).toBe(false);
    expect(u!.thinking).toBeNull();
    expect("ctxMax" in u!).toBe(false);
    expect(u!.modelId).toBe("default");
  });

  it("★★ thiếu số cốt lõi (tokensOut / latencyMs) hoặc số âm/NaN ⇒ null — không dựng ô từ gói hỏng", () => {
    expect(bocUsage({ type: "usage", tokensIn: 1, latencyMs: 3 })).toBeNull();
    expect(bocUsage({ type: "usage", tokensIn: 1, tokensOut: -2, latencyMs: 3 })).toBeNull();
    expect(bocUsage({ type: "usage", tokensIn: Number.NaN, tokensOut: 2, latencyMs: 3 })).toBeNull();
    expect(bocUsage({ type: "usage", tokensIn: "1", tokensOut: 2, latencyMs: 3 })).toBeNull();
  });
});
