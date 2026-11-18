// Định dạng và hoá đơn.
import type { DongDon } from "./phanTich.ts";
import { tamTinh, thanhTien, tienGiam } from "./gia.ts";
import { tongThue } from "./thue.ts";

/** 1250000 -> "1.250.000 ₫". */
export function dinhDangVnd(soTien: number): string {
  const tri = Math.abs(Math.trunc(soTien));
  const nhom = String(tri).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${soTien < 0 ? "-" : ""}${nhom} ₫`;
}

export interface TongKet {
  tamTinh: number;
  giam: number;
  thue: number;
  phaiTra: number;
}

export function tongKet(ds: readonly DongDon[], maGiam?: string): TongKet {
  const tt = tamTinh(ds);
  const giam = tienGiam(tt, maGiam);
  const thue = tongThue(ds);
  return { tamTinh: tt, giam, thue, phaiTra: tt - giam + thue };
}

export function inHoaDon(ds: readonly DongDon[], maGiam?: string): string {
  const k = tongKet(ds, maGiam);
  const dong = ds.map((d) => `${d.ma} x${d.soLuong}: ${dinhDangVnd(thanhTien(d))}`);
  dong.push(`Tạm tính: ${dinhDangVnd(k.tamTinh)}`);
  if (k.giam > 0) dong.push(`Giảm (${maGiam!.trim().toUpperCase()}): -${dinhDangVnd(k.giam)}`);
  dong.push(`Thuế VAT: ${dinhDangVnd(k.thue)}`);
  dong.push(`Phải trả: ${dinhDangVnd(k.phaiTra)}`);
  return dong.join("\n");
}
