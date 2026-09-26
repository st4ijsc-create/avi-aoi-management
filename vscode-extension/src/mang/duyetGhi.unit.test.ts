/**
 * LƯỚI `docKetQuaDuyet` — máy chủ TỪ CHỐI cửa duyệt qua HTTP 200 (`ok:false`), không ném. Ca
 * "expired" dưới đây là ca CRITICAL: đề xuất hết hạn TTL (5 phút) là chuyện rất dễ xảy ra vì người
 * dùng đọc diff rồi mới bấm Duyệt — nếu phía gọi không đọc `ok`, giao diện sẽ khai "đã ghi" trong
 * khi KHÔNG BYTE NÀO RƠI. Đây đúng lớp lỗi "status nói dối" mà Task 6 vá ở máy chủ, lặp lại ở đây
 * nếu client không đọc `ok`.
 */
import { describe, it, expect } from "vitest";
import { docKetQuaDuyet, daBiTuChoiGhi, maTuChoiGhi } from "./duyetGhi";

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

/**
 * ★★★ VÒNG SỬA 2 — `ok:true` là CẦN nhưng CHƯA ĐỦ. Khi băm neo lệch (BASE_MISMATCH) hay tệp bẩn
 * (FILE_DIRTY), `execute()` TỪ CHỐI ghi ĐÚNG NHƯ THIẾT KẾ nhưng `confirmAction` vẫn trả
 * `{ok:true, status:"executed", result:<ToolResult mang note>}` — sự thật nằm ở `note` của
 * `ToolResult`. `daBiTuChoiGhi`/`maTuChoiGhi` được RE-EXPORT nguyên vẹn từ `shared/aiCodingLoop.ts`
 * (KHÔNG viết lại ở đây) — extension là nơi gọi THỨ TƯ của cùng một vị từ đã cắn CLI (2026-08-23)
 * và WEB, không phải một bản cài đặt thứ hai. Các ca dưới đây đo ĐÚNG hàm được import, không phải
 * một bản sao.
 */
describe("daBiTuChoiGhi / maTuChoiGhi (re-export từ shared/aiCodingLoop, dùng chung)", () => {
  it("★★★ ok:true + result.note=BASE_MISMATCH ⇒ KHÔNG được coi là đã ghi", () => {
    // Vòng đời HITL chạy xong nhưng execute() TỪ CHỐI ghi (băm neo lệch). Đây là ca đã cắn CLI và
    // WEB trước đây; extension là nơi thứ ba nếu ta không đọc `note`.
    expect(daBiTuChoiGhi({ note: "BASE_MISMATCH" })).toBe(true);
    expect(maTuChoiGhi({ note: "BASE_MISMATCH" })).toBe("BASE_MISMATCH");
  });

  it("★★★ ghi THÀNH CÔNG (không có note) ⇒ KHÔNG bị coi là từ chối", () => {
    // Đảo chiều mặc định ở đây sẽ biến mọi lượt ghi thành công thành 'bị từ chối' — đổi một lời
    // khai sai lấy một lời khai sai khác.
    expect(daBiTuChoiGhi({ textSummary: "Đã ghi 3 dòng" })).toBe(false);
    expect(daBiTuChoiGhi(null)).toBe(false);
  });
});
