/** 1250000 -> "1.250.000 ₫" (không phụ thuộc ICU của máy). */
export function dinhDangVnd(soTien: number): string {
  const tri = Math.abs(Math.trunc(soTien));
  const nhom = String(tri).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${soTien < 0 ? "-" : ""}${nhom} ₫`;
}
