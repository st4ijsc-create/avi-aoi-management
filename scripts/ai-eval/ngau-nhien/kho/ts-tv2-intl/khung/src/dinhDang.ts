export type TienTe = "VND" | "USD";
export type NgonNgu = "vi-VN" | "en-US";
export type MauSoNhieu = { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string };

export function dinhDangTien(soTien: number, tienTe: TienTe, locale: NgonNgu): string {
  throw new Error("chưa làm");
}

export function thoiDiemDiaPhuong(ms: number, timeZone: string): string {
  throw new Error("chưa làm");
}

export function thuTuTiengAnh(n: number): string {
  throw new Error("chưa làm");
}

export function soNhieu(n: number, locale: NgonNgu, mau: MauSoNhieu): string {
  throw new Error("chưa làm");
}

export function thoiGianTuongDoi(thoiDiem: number, bayGio: number, locale: NgonNgu): string {
  throw new Error("chưa làm");
}

export function sapXepTen(ds: readonly string[]): string[] {
  throw new Error("chưa làm");
}
