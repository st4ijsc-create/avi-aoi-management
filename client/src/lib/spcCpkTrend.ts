/** Dữ liệu biểu đồ xu hướng Cpk: giữ NULL (không xác định) thay vì ép về 0 — thanh 0 bị đọc nhầm là "không đạt". Thuần, test được. */
export interface DongCpk {
  cpk?: number | null;
  ppk?: number | null;
}
export interface DiemCpk {
  i: number;
  cpk: number | null;
  ppk: number | null;
}

const so = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Hàng mới nhất đứng đầu trong nguồn ⇒ đảo lại để trục thời gian đi từ cũ đến mới. */
export function duLieuXuHuongCpk(rows: readonly DongCpk[]): { diem: DiemCpk[]; coKhongXacDinh: boolean } {
  const diem = [...rows].reverse().map((d, i) => ({ i: i + 1, cpk: so(d.cpk), ppk: so(d.ppk) }));
  return { diem, coKhongXacDinh: diem.some((d) => d.cpk === null || d.ppk === null) };
}
