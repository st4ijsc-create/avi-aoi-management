// Tệp CHO SẴN — không sửa. Kiểu dùng chung giữa kho, xác thực và máy chủ.

export type UuTien = "thap" | "vua" | "cao";

export type Viec = { id: number; tieuDe: string; xong: boolean; uuTien: UuTien; nhan: string[] };

export type ViecMoi = { tieuDe: string; xong: boolean; uuTien: UuTien; nhan: string[] };

export type CapNhatViec = { tieuDe?: string; xong?: boolean; uuTien?: UuTien; nhan?: string[] };

export type BoLoc = { xong?: boolean; uuTien?: UuTien; q?: string };

export type LoiTruong = { truong: string; thongDiep: string };

export type KetQua<T> = { ok: true; giaTri: T } | { ok: false; loi: LoiTruong[] };
