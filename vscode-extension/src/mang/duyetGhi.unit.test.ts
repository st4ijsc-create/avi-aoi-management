/**
 * LƯỚI `docKetQuaDuyet` — máy chủ TỪ CHỐI cửa duyệt qua HTTP 200 (`ok:false`), không ném. Ca
 * "expired" dưới đây là ca CRITICAL: đề xuất hết hạn TTL (5 phút) là chuyện rất dễ xảy ra vì người
 * dùng đọc diff rồi mới bấm Duyệt — nếu phía gọi không đọc `ok`, giao diện sẽ khai "đã ghi" trong
 * khi KHÔNG BYTE NÀO RƠI. Đây đúng lớp lỗi "status nói dối" mà Task 6 vá ở máy chủ, lặp lại ở đây
 * nếu client không đọc `ok`.
 */
import { describe, it, expect } from "vitest";
import { docKetQuaDuyet } from "./duyetGhi";

describe("docKetQuaDuyet", () => {
  it("★★★ ok:true, status:executed ⇒ đọc đúng ok", () => {
    const kq = docKetQuaDuyet({ ok: true, status: "executed", message: "Đã thực thi trước đó." });
    expect(kq.ok).toBe(true);
    expect(kq.status).toBe("executed");
    expect(kq.message).toBe("Đã thực thi trước đó.");
  });

  it("★★★ CRITICAL: ok:false, status:expired ⇒ ok:false, GIỮ NGUYÊN message hết hạn", () => {
    const kq = docKetQuaDuyet({
      ok: false,
      status: "expired",
      message: "Đề xuất đã hết hạn. Vui lòng yêu cầu lại.",
    });
    expect(kq.ok).toBe(false);
    expect(kq.status).toBe("expired");
    expect(kq.message).toBe("Đề xuất đã hết hạn. Vui lòng yêu cầu lại.");
  });

  it("★★★ ok:false, status:invalid (token/owner lệch) ⇒ giữ nguyên message", () => {
    const kq = docKetQuaDuyet({ ok: false, status: "invalid", message: "Token hoặc người dùng không khớp." });
    expect(kq.ok).toBe(false);
    expect(kq.status).toBe("invalid");
    expect(kq.message).toBe("Token hoặc người dùng không khớp.");
  });

  it("★★ null ⇒ ok:false, KHÔNG ném", () => {
    expect(() => docKetQuaDuyet(null)).not.toThrow();
    expect(docKetQuaDuyet(null).ok).toBe(false);
  });

  it("★★ chuỗi (hình dạng lạ) ⇒ ok:false, KHÔNG ném", () => {
    expect(() => docKetQuaDuyet("khong-phai-object")).not.toThrow();
    expect(docKetQuaDuyet("khong-phai-object").ok).toBe(false);
  });

  it("★★ object rỗng {} ⇒ ok:false (không có ok:true tường minh ⇒ coi là từ chối)", () => {
    expect(docKetQuaDuyet({}).ok).toBe(false);
  });
});
