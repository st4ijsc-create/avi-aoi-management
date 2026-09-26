/**
 * Doc 80 · Task 10 · AI-09 — cách panel copilot HIỂN THỊ một lượt hỏng / bị cổng chặn.
 * Đo trước (phụ lục A §4): lỗi hệ thống hiện thành ghi chú xám chứa nguyên chuỗi chẩn đoán + trích
 * suy luận của model. Nay: câu ngắn (khoá i18n theo `errorCode`), chi tiết kỹ thuật chỉ admin.
 */
import { describe, it, expect } from "vitest";
import { copilotErrorView, copilotRefusalView } from "./copilotResultView";

describe("copilotErrorView", () => {
  const hong = { errorCode: "TOKEN_BUDGET", note: "Trợ lý chưa trả lời được (hết ngân sách xử lý). Thử lại hoặc rút ngắn yêu cầu.", devDetail: "HỆ THỐNG HỎNG … TRÍCH SUY LUẬN: Here's a thinking process" };

  it("lỗi hệ thống ⇒ khoá i18n theo errorCode, fallback = note ngắn của server", () => {
    const v = copilotErrorView(hong, false)!;
    expect(v.i18nKey).toBe("progCopilot.error.TOKEN_BUDGET");
    expect(v.fallback).toBe(hong.note);
  });

  it("KHÔNG phải admin ⇒ không có devDetail (kể cả khi server lỡ gửi)", () => {
    expect(copilotErrorView(hong, false)!.devDetail).toBeUndefined();
  });

  it("admin ⇒ có devDetail (UI gập mặc định)", () => {
    expect(copilotErrorView(hong, true)!.devDetail).toMatch(/TRÍCH SUY LUẬN/);
  });

  it("không có errorCode ⇒ null (ghi chú thường như cũ)", () => {
    expect(copilotErrorView({ note: "Auto-repaired in 1 round(s)" }, true)).toBeNull();
  });

  it("errorCode lạ ⇒ vẫn hiển thị note của server (fallback), không rơi về chuỗi rỗng", () => {
    const v = copilotErrorView({ errorCode: "SOMETHING_NEW", note: "câu ngắn" }, false)!;
    expect(v.fallback).toBe("câu ngắn");
  });
});

describe("copilotRefusalView", () => {
  it("có reasonCode ⇒ khoá i18n progCopilot.refusal.<code>, fallback = userMessage", () => {
    const v = copilotRefusalView({ reasonCode: "SAFETY_BYPASS_REQUEST", userMessage: "Không thể hỗ trợ…", reason: "Không thể hỗ trợ…" });
    expect(v).toEqual({ i18nKey: "progCopilot.refusal.SAFETY_BYPASS_REQUEST", fallback: "Không thể hỗ trợ…" });
  });
  it("không có reasonCode (client/server cũ) ⇒ hiện nguyên reason", () => {
    expect(copilotRefusalView({ reason: "Refused" })).toEqual({ i18nKey: null, fallback: "Refused" });
  });
});
