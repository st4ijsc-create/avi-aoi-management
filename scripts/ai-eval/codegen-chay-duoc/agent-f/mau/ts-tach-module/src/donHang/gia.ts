// Giá và mã giảm.
import type { DongDon } from "./phanTich.ts";

export interface MaGiam {
  ma: string;
  kieu: "phan-tram" | "co-dinh";
  giaTri: number;
  toiThieu: number;
}

export const BANG_MA_GIAM: readonly MaGiam[] = [
  { ma: "GIAM10", kieu: "phan-tram", giaTri: 10, toiThieu: 0 },
  { ma: "GIAM50K", kieu: "co-dinh", giaTri: 50_000, toiThieu: 300_000 },
  { ma: "SACH20", kieu: "phan-tram", giaTri: 20, toiThieu: 200_000 },
];

export function thanhTien(d: DongDon): number {
  return d.soLuong * d.donGia;
}

export function tamTinh(ds: readonly DongDon[]): number {
  return ds.reduce((s, d) => s + thanhTien(d), 0);
}

export function timMaGiam(ma: string): MaGiam | undefined {
  return BANG_MA_GIAM.find((m) => m.ma === ma.trim().toUpperCase());
}

/** Số tiền được giảm (không âm, không vượt tạm tính). Mã lạ hoặc chưa đủ tối thiểu ⇒ 0. */
export function tienGiam(tamTinhTien: number, maGiam?: string): number {
  if (!maGiam) return 0;
  const m = timMaGiam(maGiam);
  if (!m || tamTinhTien < m.toiThieu) return 0;
  const giam = m.kieu === "phan-tram" ? Math.floor((tamTinhTien * m.giaTri) / 100) : m.giaTri;
  return Math.min(giam, tamTinhTien);
}
