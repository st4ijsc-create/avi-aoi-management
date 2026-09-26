/**
 * ★ F6 (2026-09-22) — CHỈ SỐ PHIÊN của màn lập trình, THUẦN: cộng dồn từ sự kiện SSE `usage` (B7) và các kết cục từ chối.
 *
 * "Không biết ≠ 0": `tokensNghi` là `null` cho tới khi có ít nhất một lượt đếm được suy luận; lượt không đếm được
 * (đường in‑process) tăng `nghiKhongDo` thay vì cộng 0 — để tổng nghĩ không bao giờ là một con số thấp giả.
 */
export interface ThongKePhien {
  /** Số lượt gọi model (mỗi sự kiện `usage` = một lượt: sinh mã, khối sửa, chọn tệp…). */
  soLuot: number;
  tokensVao: number;
  /** GỘP cả suy luận (số của server). */
  tokensRa: number;
  /** Tổng token trong `<think>` của các lượt ĐẾM ĐƯỢC; `null` = chưa lượt nào đếm được. */
  tokensNghi: number | null;
  /** Số lượt không đếm được suy luận (không cộng vào `tokensNghi`). */
  nghiKhongDo: number;
  /** Tổng thời gian model (ms) — cộng `latencyMs` từng lượt, không phải thời gian tường. */
  msTong: number;
  /** Số lần đường ống TỪ CHỐI/THOÁI HOÁ (done.degraded, luồng lỗi). */
  soTuChoi: number;
}

export function thongKeRong(): ThongKePhien {
  return { soLuot: 0, tokensVao: 0, tokensRa: 0, tokensNghi: null, nghiKhongDo: 0, msTong: 0, soTuChoi: 0 };
}

const so = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

export function congUsage(
  tk: ThongKePhien,
  u: { readonly tokensIn: number; readonly tokensOut: number; readonly tokensReasoning?: number; readonly latencyMs: number },
): ThongKePhien {
  const coNghi = typeof u.tokensReasoning === "number" && Number.isFinite(u.tokensReasoning);
  return {
    soLuot: tk.soLuot + 1,
    tokensVao: tk.tokensVao + so(u.tokensIn),
    tokensRa: tk.tokensRa + so(u.tokensOut),
    tokensNghi: coNghi ? (tk.tokensNghi ?? 0) + so(u.tokensReasoning) : tk.tokensNghi,
    nghiKhongDo: tk.nghiKhongDo + (coNghi ? 0 : 1),
    msTong: tk.msTong + so(u.latencyMs),
    soTuChoi: tk.soTuChoi,
  };
}

export function congTuChoi(tk: ThongKePhien): ThongKePhien {
  return { ...tk, soTuChoi: tk.soTuChoi + 1 };
}

/**
 * ★ F6 phần 2 (2026-09-23) — XUẤT chỉ số phiên thành JSON để dán vào bảng so sánh bench (`so-sanh.mjs`, audit §8).
 * Giữ "không biết ≠ 0": `tokensNghi` null vẫn là `null` trong JSON, model không rõ là `null`. Khoá `schema` để
 * người đọc sau biết đang đọc hình dạng nào khi các trường đổi.
 */
export const SCHEMA_XUAT_PHIEN = "ai-local-phien/1";

export function xuatThongKeJson(tk: ThongKePhien, o: { readonly model?: string | null; readonly luc: Date }): string {
  return JSON.stringify(
    {
      schema: SCHEMA_XUAT_PHIEN,
      luc: o.luc.toISOString(),
      model: typeof o.model === "string" && o.model ? o.model : null,
      soLuot: tk.soLuot,
      tokensVao: tk.tokensVao,
      tokensRa: tk.tokensRa,
      tokensNghi: tk.tokensNghi,
      nghiKhongDo: tk.nghiKhongDo,
      msTong: tk.msTong,
      soTuChoi: tk.soTuChoi,
    },
    null,
    2,
  );
}
