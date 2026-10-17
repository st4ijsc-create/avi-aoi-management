/** Tiện ích chuỗi và ngày dùng chung. Ngày luôn tính theo UTC. */
const MS_NGAY = 24 * 60 * 60 * 1000;

/** Bỏ khoảng trắng hai đầu và gộp khoảng trắng liên tiếp thành một dấu cách. */
export function chuanHoaTen(s) {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}

/** Ngày `ngay` cộng `soNgay` ngày (có thể âm). */
export function congNgay(ngay, soNgay) {
  return new Date(ngay.getTime() + soNgay * MS_NGAY);
}

/** `Date` ⇒ "YYYY-MM-DD" (UTC). */
export function dinhDangNgay(ngay) {
  return ngay.toISOString().slice(0, 10);
}

/** Số ngày lịch (UTC) từ `tu` tới `den`; âm nếu `den` trước `tu`. */
export function soNgayGiua(tu, den) {
  const a = Date.UTC(tu.getUTCFullYear(), tu.getUTCMonth(), tu.getUTCDate());
  const b = Date.UTC(den.getUTCFullYear(), den.getUTCMonth(), den.getUTCDate());
  return Math.round((b - a) / MS_NGAY);
}
