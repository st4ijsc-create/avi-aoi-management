import type { BoLoc, CapNhatViec, KetQua, ViecMoi } from "./kieu.ts";

export function kiemViecMoi(x: unknown): KetQua<ViecMoi> {
  throw new Error("chưa làm");
}

export function kiemCapNhat(x: unknown): KetQua<CapNhatViec> {
  throw new Error("chưa làm");
}

export function kiemBoLoc(q: URLSearchParams): KetQua<BoLoc> {
  throw new Error("chưa làm");
}
