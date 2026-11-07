/**
 * PHA 0 · C0-3 (50-C0, 2026-11-04) — "NÚT DỪNG MÁY KHÔNG BAO GIỜ BỊ CHE". Kho nhỏ mà `NutDungMay` đăng ký vào khi mount; `LopDungMayNoi`
 * (gắn MỘT lần ở gốc `App`) đọc kho này và, khi nút trong luồng bị che bởi một hộp thoại / ngăn phủ, dựng một nút DỪNG MÁY NỔI ở tầng
 * trên cùng (z trên mọi Dialog / Sheet / Sonner) cho ĐÚNG máy đó.
 *
 * Vì sao không "portal mọi nút": một trang có nhiều máy (M10, bảng khẩn cấp) có NHIỀU `NutDungMay` — một nút cố định duy nhất sẽ không biết
 * dừng máy nào. Nút nổi chỉ xuất hiện cho nút nằm TRONG một hộp thoại (faceplate) mà hộp thoại đó bị hộp thoại lồng (xác nhận lệnh M5…)
 * phủ lên — đúng ca "hộp xác nhận lồng trong Faceplate che nút" của 50-C0-3.
 *
 * "Bị che" = (a) tổ tiên có `aria-hidden="true"` / `data-aria-hidden` / `inert` (Radix `hideOthers` đặt khi hộp lồng mở) HOẶC (b) trình duyệt có
 * hình học và `elementFromPoint` ở tâm nút không thuộc nút. (a) kiểm được ở jsdom; (b) bắt ca phủ không qua Radix.
 */
export interface NutDungMayDangKy {
  id: number;
  machineId: number;
  tenMay: string;
  /** Phần tử nút trong luồng (null khi đã gỡ). */
  nut: () => HTMLElement | null;
  /** Mở hộp xác nhận DỪNG của CHÍNH instance này. */
  mo: () => void;
}

let dem = 0;
const ds = new Map<number, NutDungMayDangKy>();
const nguoiNghe = new Set<() => void>();
let anh: readonly NutDungMayDangKy[] = [];

function baoDoi(): void {
  anh = [...ds.values()];
  for (const f of [...nguoiNghe]) f();
}

/** Đăng ký một `NutDungMay`; trả hàm gỡ. */
export function dangKyNutDungMay(m: Omit<NutDungMayDangKy, "id">): () => void {
  const id = ++dem;
  ds.set(id, { ...m, id });
  baoDoi();
  return () => {
    ds.delete(id);
    baoDoi();
  };
}
export function layNutDungMay(): readonly NutDungMayDangKy[] {
  return anh;
}
export function ngheNutDungMay(fn: () => void): () => void {
  nguoiNghe.add(fn);
  return () => nguoiNghe.delete(fn);
}

/** Nút nằm TRONG một hộp thoại (`[role=dialog]`)? Nút của trang (không trong hộp) không bao giờ được nổi — nó nằm sau hộp theo thiết kế. */
export function nutTrongHopThoai(nut: HTMLElement): boolean {
  return nut.closest('[role="dialog"], [role="alertdialog"]') !== null;
}

/** Nút trong luồng có đang bị che / bị vô hiệu bởi hộp thoại khác không. */
export function nutBiChe(nut: HTMLElement): boolean {
  if (!nut.isConnected) return false;
  if (nut.closest('[aria-hidden="true"], [data-aria-hidden="true"], [inert]') !== null) return true;
  // hình học (jsdom: elementFromPoint không có / trả null ⇒ bỏ qua nhánh này)
  const r = nut.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const hit = typeof document.elementFromPoint === "function" ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
  return hit !== null && !nut.contains(hit) && !hit.contains(nut);
}

/** Dành cho test. */
export function xoaNutDungMayChoTest(): void {
  ds.clear();
  baoDoi();
}
