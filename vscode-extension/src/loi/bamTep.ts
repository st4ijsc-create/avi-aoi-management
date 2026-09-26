/**
 * Băm nội dung tệp — CÙNG vị từ máy chủ dùng để chặn TOCTOU (`server/services/aiLocalTools/
 * writeHandlers/applyDiff.ts` hàm `bam`, `BASE_MISMATCH` dòng 399-404): nếu tệp trên đĩa đã đổi
 * kể từ lúc model sinh đề xuất, phải DỪNG chứ không ghi đè.
 *
 * ⚠⚠ KHÔNG chuẩn hoá dòng-kết-thúc ở đây. Băm phải nói về BYTE THẬT trên đĩa — tự chuyển
 * `\r\n`→`\n` trước khi băm sẽ làm một tệp đã bị sửa (chỉ đổi EOL) trông như CHƯA đổi, và một
 * lượt ghi đè sẽ âm thầm xoá mất thay đổi thật của người dùng. Đây là hàng rào ngược với
 * `tomTatDiff.ts` (nơi chuẩn hoá CRLF là ĐÚNG vì chỉ phục vụ đếm hiển thị, không phục vụ so khớp
 * ghi-đè).
 */
import { createHash } from "node:crypto";

/** sha256(s) dạng hex thường (`digest("hex")` của Node luôn trả chữ thường). */
export function bamNoiDung(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * So khớp băm đĩa với băm gốc (băm mà model thấy khi sinh đề xuất).
 *
 * So sánh KHÔNG phân biệt hoa/thường CỦA CHUỖI HEX (`toLowerCase` trước khi so). Đây là chuẩn hoá
 * AN TOÀN — khác hẳn việc chuẩn hoá EOL bị CẤM ở `bamNoiDung`: hoa/thường của ký tự hex chỉ là
 * cách BIỂU DIỄN cùng một con số (16 tiến), không mang thông tin về NỘI DUNG tệp. Chuẩn hoá EOL
 * thì ngược lại — nó xoá đi chính sự khác biệt cần phát hiện. Phòng trường hợp một phía băm đến
 * từ nguồn khác (vd. do người dùng dán tay) dùng hex hoa.
 */
export function khopBanGoc(bamDia: string, bamGoc: string): boolean {
  return bamDia.toLowerCase() === bamGoc.toLowerCase();
}
