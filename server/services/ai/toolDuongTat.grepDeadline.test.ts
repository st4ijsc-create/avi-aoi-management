/**
 * ★ G19 (2026-09-22) — `GREP_DEADLINE` vô can với đơn SINH MÃ, nhưng vẫn làm cầu chì nổ cho câu hỏi VỀ repo.
 * Ca thật: H‑cs3 trượt 5/6 lượt vì grep quá hạn 4 s rồi cầu chì trả câu từ chối thay cho mã.
 */
import { describe, it, expect } from "vitest";
import { cauChiNenNo } from "./toolDuongTat";

describe("cauChiNenNo — GREP_DEADLINE (G19)", () => {
  it("★★★ đơn SINH MÃ + mọi vòng chỉ GREP_DEADLINE ⇒ KHÔNG nổ (model vẫn được viết mã)", () => {
    expect(cauChiNenNo(["GREP_DEADLINE"], true)).toBe(false);
    expect(cauChiNenNo(["GREP_DEADLINE", "NOT_FOUND"], true)).toBe(false);
    expect(cauChiNenNo(["grep_deadline "], true), "không phân biệt hoa/thường, khoảng trắng").toBe(false);
  });
  it("★★ câu hỏi VỀ repo + GREP_DEADLINE ⇒ vẫn NỔ y cũ (vector bịa về repo còn nguyên)", () => {
    expect(cauChiNenNo(["GREP_DEADLINE"], false)).toBe(true);
  });
  it("★ đơn sinh mã nhưng có ghi chú KHÔNG vô can (DENIED_SECRET / ngân sách) ⇒ vẫn nổ", () => {
    expect(cauChiNenNo(["GREP_DEADLINE", "DENIED_SECRET"], true)).toBe(true);
    expect(cauChiNenNo(["BUDGET_EXHAUSTED"], true)).toBe(true);
  });
});
