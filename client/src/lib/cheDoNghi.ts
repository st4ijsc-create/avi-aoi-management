/**
 * Chế độ nghĩ (F3) của màn lập trình — đọc lựa chọn dính + DI TRÚ MỘT LẦN.
 * Trước 2026-10-27 `cheDoNghi` không bao giờ tới máy chủ (hook stream bỏ rơi) nên "Nhanh" đã lưu thực ra chạy "cân bằng". Giờ nó có hiệu lực thật
 * (tắt nghĩ, kém đúng ~10–15 điểm — tiêu chí chủ dự án: ĐÚNG hơn NHANH) ⇒ lần đầu sau bản này mọi "nhanh" cũ được đặt lại "can-bang" (khoá đánh dấu `.v2`).
 */
export type CheDoNghiUi = "can-bang" | "nhanh";
const KHOA = "repoWs.cheDoNghi";
const KHOA_V2 = "repoWs.cheDoNghi.v2";

export function docCheDoNghi(): CheDoNghiUi {
  try {
    if (localStorage.getItem(KHOA_V2) === null) {
      localStorage.setItem(KHOA, "can-bang");
      localStorage.setItem(KHOA_V2, "1");
      return "can-bang";
    }
    return localStorage.getItem(KHOA) === "nhanh" ? "nhanh" : "can-bang";
  } catch {
    return "can-bang";
  }
}
export function luuCheDoNghi(v: CheDoNghiUi): void {
  try {
    localStorage.setItem(KHOA, v);
  } catch {
    /* chế độ riêng tư */
  }
}
