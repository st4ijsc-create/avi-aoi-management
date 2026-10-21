/**
 * ★★★ Đợt 9 (IDOR) — MỘT hàm chuẩn hoá id tài nguyên dùng chung cho cổng phạm vi VÀ node: giá trị đã KIỂM chính là giá trị node DÙNG.
 * (Lỗ đã bắt: cổng chỉ kiểm khi `typeof id === "number"` còn node làm `Number(may)` ⇒ `may: "999"` đi qua cổng rồi vẫn đọc máy 999.)
 * Module LÁ (không import gì) — mọi node/cổng nhập từ đây, không ai tự `Number(...)` một id.
 */

/** id máy hợp lệ: số nguyên an toàn 1…2147483647, hoặc CHUỖI chỉ gồm 1–12 chữ số (không khoảng trắng, dấu, mũ, hex) ⇒ số. Khác ⇒ `null`. */
export function chuanHoaIdMay(raw: unknown): number | null {
  let n: number;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string" && /^\d{1,12}$/.test(raw)) n = Number(raw);
  else return null;
  return Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
}

/** Ngoài phạm vi HOẶC không tồn tại — một lỗi, một thông điệp (không lộ tồn tại). Router ⇒ NOT_FOUND. */
export class LoiNgoaiPhamVi extends Error {
  constructor() {
    super("Không tìm thấy tài nguyên.");
    this.name = "LoiNgoaiPhamVi";
  }
}
