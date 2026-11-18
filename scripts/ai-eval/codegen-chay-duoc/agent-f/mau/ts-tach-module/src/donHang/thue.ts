// Thuế VAT theo loại hàng.
import type { DongDon, LoaiHang } from "./phanTich.ts";
import { thanhTien } from "./gia.ts";

export const THUE_SUAT: Readonly<Record<LoaiHang, number>> = { "thuc-pham": 5, sach: 0, thuong: 10 };

export function thueDong(d: DongDon): number {
  return Math.round((thanhTien(d) * THUE_SUAT[d.loai]) / 100);
}

/** Thuế tính trên từng dòng TRƯỚC giảm giá (quy ước của cửa hàng), cộng lại. */
export function tongThue(ds: readonly DongDon[]): number {
  return ds.reduce((s, d) => s + thueDong(d), 0);
}
