import type { GioHang } from "./gioHang.ts";
import { dinhDangVnd } from "./dinhDang.ts";

/** Hoá đơn dạng văn bản, mỗi dòng một mục, dòng cuối là tổng. */
export function inHoaDon(gio: GioHang): string {
  const dong = gio.cacDong().map((d) => `${d.ten} x${d.soLuong}: ${dinhDangVnd(d.thanhTien)}`);
  dong.push(`Tổng cộng: ${dinhDangVnd(gio.tongTien())}`);
  return dong.join("\n");
}
