/**
 * ★ F5 (2026-09-22) — logic THUẦN cho khung "Lệnh & Nhật ký": lọc lịch sử lượt lệnh theo kết cục.
 *
 * Một lượt là ĐỎ khi bất kỳ dấu hiệu nào nói nó không sạch: exit code ≠ 0, hết giờ, hoặc bộ chấm test nói đỏ (`ketQua.xanh`
 * = false). Một lượt là XANH chỉ khi KHÔNG có dấu nào trong ba dấu ấy — exit 0 mà test đỏ vẫn là đỏ (đúng luật của bộ đo:
 * "tác nhân nói xanh mà test đỏ ⇒ trượt"). `exitCode === null` (đang chạy/không lấy được) không được coi là xanh.
 */
export type CheDoLocLenh = "tat-ca" | "do" | "xanh";

export interface LuotLenhToiThieu {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly ketQua: { readonly xanh: boolean } | null;
}

export function luotLenhDo(l: LuotLenhToiThieu): boolean {
  if (l.timedOut) return true;
  if (l.exitCode !== null && l.exitCode !== 0) return true;
  if (l.ketQua && l.ketQua.xanh === false) return true;
  return false;
}

export function luotLenhXanh(l: LuotLenhToiThieu): boolean {
  return l.exitCode === 0 && !l.timedOut && (l.ketQua === null || l.ketQua.xanh === true);
}

export function locLuotLenh<T extends LuotLenhToiThieu>(ds: readonly T[], cheDo: CheDoLocLenh): T[] {
  if (cheDo === "do") return ds.filter(luotLenhDo);
  if (cheDo === "xanh") return ds.filter(luotLenhXanh);
  return [...ds];
}

/** Đếm cho nhãn nút lọc: `{ do, xanh }` — tổng có thể lớn hơn do+xanh (lượt chưa có exit code không thuộc bên nào). */
export function demKetCuc(ds: readonly LuotLenhToiThieu[]): { do: number; xanh: number } {
  let d = 0;
  let x = 0;
  for (const l of ds) {
    if (luotLenhDo(l)) d++;
    else if (luotLenhXanh(l)) x++;
  }
  return { do: d, xanh: x };
}
