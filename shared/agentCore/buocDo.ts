/**
 * ★★★ Đợt 12 · H0.2 (2026-10-31) — phần THUẦN của sự kiện `buoc-do`: bản ghi MỖI lượt gọi model của vòng agent, để ĐO
 * (nén ngữ cảnh, tỉ lệ trúng cache, độ chính xác của ước lượng token) trước khi đổi hành vi (H1.1…).
 *
 * ⚠ Chỉ SỐ và MÃ: không nội dung tin nhắn, không đường dẫn, không bí mật. `bamHeThong` là băm ngắn (FNV-1a 32 bit) —
 *   dùng để thấy "system/tools có đổi giữa hai bước không" (đổi ⇒ mất cache), KHÔNG phải băm mật mã.
 * ⚠ Không đổi một byte nào gửi model: sự kiện chỉ ĐỌC trạng thái vòng.
 */

/**
 * Mã các khối vòng agent CHÈN thêm vào hội thoại (role `user`) giữa các lượt. MỘT hằng chung: `vongAgent.ts` chỉ chèn qua
 * `chenNhac(ma, …)` và census (`buocDo.test.ts`) bắt khối chèn mới thiếu mã.
 */
export const MA_KHOI_CHEN = ["tom-tat-ngu-canh", "tool-call-hong", "cat-khong-tool", "kiem-dac-ta", "ghi-chua-test"] as const;
export type MaKhoiChen = (typeof MA_KHOI_CHEN)[number];

/** Băm ngắn 8 ký tự hex (FNV-1a 32 bit, thuần, không phụ thuộc node). */
export function bamNgan(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Hành động nén của lượt này; `null` khi không nén gì. */
export interface NenBuocDo {
  soNen: number;
  tokenTruoc: number;
  tokenSau: number;
}

/** Số hữu hạn không âm hoặc `undefined` (KHÔNG BIẾT ≠ 0). */
export function soDoDuoc(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}
