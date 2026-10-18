/** Ngày nghỉ: Chủ nhật (UTC) luôn nghỉ, cộng các ngày trong `dsNghi` (dạng YYYY-MM-DD). */
export function laNgayNghi(ngay: string, dsNghi: readonly string[] = []): boolean {
  return new Date(`${ngay}T00:00:00Z`).getUTCDay() === 0 || dsNghi.includes(ngay);
}
