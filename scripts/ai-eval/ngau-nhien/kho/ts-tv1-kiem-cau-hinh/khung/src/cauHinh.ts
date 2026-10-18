export type MayAoi = { loai: "aoi"; ten: string; cong: number; doPhanGiai: number };
export type MayPlc = { loai: "plc"; ten: string; cong: number; diaChi: string; chuKyMs: number };
export type MayCamera = { loai: "camera"; ten: string; url: string };
export type May = MayAoi | MayPlc | MayCamera;
export type CauHinh = { phienBan: 1; tenNhaMay: string; ghiNhat: boolean; may: May[] };

export type LoiKiem = { duong: string; thongDiep: string };
export type KetQua<T> = { ok: true; giaTri: T } | { ok: false; loi: LoiKiem[] };

export function kiemCauHinh(x: unknown): KetQua<CauHinh> {
  throw new Error("chưa làm");
}

export function laMayPlc(m: May): m is MayPlc {
  throw new Error("chưa làm");
}

export function moTaMay(m: May): string {
  throw new Error("chưa làm");
}
