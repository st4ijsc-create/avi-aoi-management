import { DS_CA, type MaCa } from "./ca.ts";

export interface PhanCong {
  ngay: string;
  ca: MaCa;
  nhanVien: string;
}

function congNgay(ngay: string, n: number): string {
  const d = new Date(`${ngay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Xếp vòng: mỗi ngày đủ 3 ca theo thứ tự CA1, CA2, CA3; người kế tiếp theo thứ tự danh sách, nối tiếp qua các ngày. */
export function taoLich(nhanVien: string[], tuNgay: string, soNgay: number): PhanCong[] {
  if (nhanVien.length === 0) throw new Error("Cần ít nhất một nhân viên");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tuNgay)) throw new RangeError("tuNgay phải dạng YYYY-MM-DD");
  if (!Number.isInteger(soNgay) || soNgay < 0) throw new RangeError("soNgay phải là số nguyên ≥ 0");
  const ra: PhanCong[] = [];
  let k = 0;
  for (let d = 0; d < soNgay; d++) {
    const ngay = congNgay(tuNgay, d);
    for (const ca of DS_CA) ra.push({ ngay, ca, nhanVien: nhanVien[k++ % nhanVien.length] });
  }
  return ra;
}

export function soCaCuaNhanVien(lich: PhanCong[], nhanVien: string): number {
  return lich.filter((p) => p.nhanVien === nhanVien).length;
}
