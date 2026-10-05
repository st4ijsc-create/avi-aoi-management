/**
 * doc 81 Đợt 3 final wave (Task 3 FINAL-WAVE: `fmtDateTime` bị chép) — MỘT bản định dạng ngày-giờ cho các bảng phân công
 * (Sản xuất › Ca và An toàn — hai trang tách nhau ở Đợt 3 Task 3, trước đó chép nguyên văn cùng một hàm).
 * Hành vi giữ y hệt bản cũ: rỗng / không hợp lệ ⇒ "—"; còn lại ⇒ `toLocaleString()` theo locale trình duyệt.
 */
export function fmtDateTime(d?: string | Date | null): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString();
}
