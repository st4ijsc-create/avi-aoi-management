/**
 * Trần đầu vào ở cửa vào AI Local (kiem-dinh 2026-10-26). Hàm thuần; việc nối vào /api/ai/local-kb/{retrieve,ask,stream} và /v1 được lưới route
 * (`aiLocalKnowledgeApi.tranDauVao.test.ts`, `openaiGateway.tranDauVao.test.ts`) canh.
 */
import { afterEach, describe, expect, it } from "vitest";
import { kiemTranKb, kiemTranV1, tongKyTuNoiDung, tranKyTuKb, tranKyTuV1Tong } from "./tranDauVao";

afterEach(() => {
  delete process.env.AI_KB_TRAN_KY_TU;
  delete process.env.OPENAI_GATEWAY_MAX_CHARS;
});

describe("tranDauVao", () => {
  it("mặc định: KB 100 000 ký tự, /v1 2 000 000 ký tự tổng", () => {
    expect(tranKyTuKb()).toBe(100_000);
    expect(tranKyTuV1Tong()).toBe(2_000_000);
  });
  it("KB: câu hỏi / từng message lịch sử vượt trần ⇒ không ok, chỉ rõ chỗ (không lộ nội dung)", () => {
    expect(kiemTranKb("x".repeat(100_000))).toEqual({ ok: true });
    expect(kiemTranKb("x".repeat(100_001))).toMatchObject({ ok: false, noi: "question", tran: 100_000 });
    expect(kiemTranKb("hi", [{ content: "a" }, { content: "y".repeat(100_001) }])).toMatchObject({ ok: false, noi: "history[1]" });
  });
  it("/v1: đếm cả content dạng chuỗi lẫn mảng phần text; phần ảnh không tính; tổng vượt ⇒ không ok", () => {
    const m = [{ role: "user", content: "ab" }, { role: "user", content: [{ type: "text", text: "cde" }, { type: "image_url", image_url: { url: "data:..." } }] }];
    expect(tongKyTuNoiDung(m)).toBe(5);
    process.env.OPENAI_GATEWAY_MAX_CHARS = "1000";
    expect(kiemTranV1([{ content: "x".repeat(1000) }])).toEqual({ ok: true });
    expect(kiemTranV1([{ content: "x".repeat(600) }, { content: "y".repeat(401) }])).toMatchObject({ ok: false, noi: "messages", tran: 1000 });
    expect(tongKyTuNoiDung("không phải mảng")).toBe(0);
  });
  it("env hỏng / quá nhỏ ⇒ rơi về mặc định (không thể tắt trần bằng 0 hay chữ)", () => {
    process.env.AI_KB_TRAN_KY_TU = "0";
    expect(tranKyTuKb()).toBe(100_000);
    process.env.AI_KB_TRAN_KY_TU = "abc";
    expect(tranKyTuKb()).toBe(100_000);
    process.env.AI_KB_TRAN_KY_TU = "5000";
    expect(tranKyTuKb()).toBe(5000);
  });
});
