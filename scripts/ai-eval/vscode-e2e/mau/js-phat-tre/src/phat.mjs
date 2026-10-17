/** Tiền phạt trả trễ (VND): soNgayTre × mucNgay, không vượt toiDa. */
export function tinhPhat(soNgayTre, { mucNgay = 5000, toiDa = 100000 } = {}) {
  if (!Number.isInteger(soNgayTre) || soNgayTre < 0) throw new RangeError("soNgayTre phải là số nguyên ≥ 0");
  return Math.min(soNgayTre * mucNgay, toiDa);
}
