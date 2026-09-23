/**
 * ★ F2 phần còn lại (2026-09-23) — ĐỒNG HỒ HAI PHA của một lượt model, đo TẠI TRÌNH DUYỆT: thời gian NGHĨ (từ mảnh
 * `reasoning` đầu tới mảnh cuối) và thời gian SINH chữ (từ `token` đầu tới `token` cuối). Server chỉ báo TỔNG
 * `latencyMs`, nên trước đây thanh trạng thái chỉ có tok/s GỘP — thứ không phân biệt "nghĩ chậm" với "sinh chậm".
 *
 * Mỗi sự kiện `usage` đóng MỘT lượt: `chotLuot` trả hai khoảng rồi xoá đồng hồ cho lượt kế (đường lập trình có thể
 * nhiều lượt trong một luồng: chọn tệp, khối sửa, sinh mã).
 *
 * "Không biết ≠ 0": pha không có sự kiện, hoặc ngắn hơn `MS_TOI_THIEU` (một mảnh đơn lẻ — khoảng đo vô nghĩa), trả
 * `undefined`, không trả 0. Số đo gồm trễ mạng/đệm SSE: đủ để so hai pha của CÙNG lượt, không phải phép đo máy chủ.
 * Module THUẦN.
 */
export const MS_TOI_THIEU = 200;

export interface DongHoHaiPha {
  nghiDau: number | null;
  nghiCuoi: number | null;
  chuDau: number | null;
  chuCuoi: number | null;
}

export function taoDongHo(): DongHoHaiPha {
  return { nghiDau: null, nghiCuoi: null, chuDau: null, chuCuoi: null };
}

export function ghiNghi(d: DongHoHaiPha, t: number): void {
  if (d.nghiDau === null) d.nghiDau = t;
  d.nghiCuoi = t;
}

export function ghiChu(d: DongHoHaiPha, t: number): void {
  if (d.chuDau === null) d.chuDau = t;
  d.chuCuoi = t;
}

const khoang = (a: number | null, b: number | null): number | undefined => {
  if (a === null || b === null) return undefined;
  const ms = b - a;
  return ms >= MS_TOI_THIEU ? ms : undefined;
};

/** Đóng lượt: trả `{msNghi?, msSinh?}` (chỉ khoá có số) rồi xoá đồng hồ. */
export function chotLuot(d: DongHoHaiPha): { msNghi?: number; msSinh?: number } {
  const msNghi = khoang(d.nghiDau, d.nghiCuoi);
  const msSinh = khoang(d.chuDau, d.chuCuoi);
  d.nghiDau = d.nghiCuoi = d.chuDau = d.chuCuoi = null;
  return { ...(msNghi !== undefined ? { msNghi } : {}), ...(msSinh !== undefined ? { msSinh } : {}) };
}

/**
 * Tốc độ hai pha (tok/s, một chữ số thập phân). `null` = không đo được pha đó. Sinh = ra − nghĩ (số server gộp).
 */
export function tocDoHaiPha(u: {
  readonly tokensOut: number;
  readonly tokensReasoning?: number;
  readonly msNghi?: number;
  readonly msSinh?: number;
}): { tokNghi: number | null; tokSinh: number | null } {
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const nghi = typeof u.tokensReasoning === "number" && Number.isFinite(u.tokensReasoning) ? u.tokensReasoning : null;
  const tokNghi = nghi !== null && nghi > 0 && u.msNghi && u.msNghi > 0 ? r1(nghi / (u.msNghi / 1000)) : null;
  const sinh = nghi === null ? null : Math.max(0, u.tokensOut - nghi);
  const tokSinh = sinh !== null && sinh > 0 && u.msSinh && u.msSinh > 0 ? r1(sinh / (u.msSinh / 1000)) : null;
  return { tokNghi, tokSinh };
}
