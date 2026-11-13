/**
 * HA-3 — trần SỐ LƯỢT MODEL của một lượt agent, chỉnh được bằng biến môi trường `AI_AGENT_SO_LUOT_TOI_DA`.
 *
 * "Lượt" ở đây = MỘT lần gọi model (cùng đơn vị với `GioiHanVong.soLuotToiDa` và `luotMax` trong báo cáo). Mặc định 30 (`GIOI_HAN_MAC_DINH`).
 * Biến chưa đặt / không phải số nguyên dương ⇒ KHÔNG đổi gì (hành vi cũ, không đổi một byte). Đặt hợp lệ ⇒ kẹp vào [1, TRAN_CUNG_SO_LUOT].
 * Giới hạn truyền tường minh qua `phuThuoc.gioiHan` luôn THẮNG biến môi trường (người gọi biết rõ hơn).
 */
import type { GioiHanVong } from "@shared/agentCore";

/** Mặc định hiện nay (= GIOI_HAN_MAC_DINH.soLuotToiDa trong shared/agentCore/kieu.ts). */
export const SO_LUOT_MAC_DINH = 30;

/** Trần cứng: không biến môi trường hay thẻ nào nâng được quá số này. */
export const TRAN_CUNG_SO_LUOT = 120;

/** Giá trị hợp lệ của `AI_AGENT_SO_LUOT_TOI_DA` (đã kẹp) hoặc `undefined` nếu chưa đặt / không hợp lệ. Thuần. */
export function soLuotToiDaTuEnv(env: Record<string, string | undefined>): number | undefined {
  const tho = (env.AI_AGENT_SO_LUOT_TOI_DA ?? "").trim();
  if (!/^\d{1,6}$/.test(tho)) return undefined;
  const n = Number(tho);
  if (!Number.isInteger(n) || n < 1) return undefined;
  return Math.min(n, TRAN_CUNG_SO_LUOT);
}

/** Ghép trần từ biến môi trường vào `gioiHan` của phụ thuộc: env chưa đặt ⇒ trả NGUYÊN `goc` (cùng tham chiếu, kể cả undefined). Thuần. */
export function hopGioiHanLuot(goc: Partial<GioiHanVong> | undefined, env: Record<string, string | undefined>): Partial<GioiHanVong> | undefined {
  const n = soLuotToiDaTuEnv(env);
  return n === undefined ? goc : { soLuotToiDa: n, ...(goc ?? {}) };
}
