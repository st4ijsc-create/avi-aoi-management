/**
 * ★ Đợt 10.3 (AI_FLOW_SECURITY_OPERATIONS §12, backlog forge) — dịch vụ "forge" của khung gốc (`BUILT_IN_FORGE_API_URL`): sinh ảnh,
 * chuyển giọng nói (AI ngoài THẬT), dataApi, bản đồ, thông báo chủ dự án, kho tệp chế độ forge. Mọi lời gọi đi ra ngoài KHÔNG qua cổng
 * AI ngoài (không che dữ liệu, không trần, không sổ). URL RỖNG ⇒ tắt (0 lời gọi — lưới `forgeNgoai.test.ts`). Đặt URL là quyết định
 * của chủ dự án ⇒ lúc khởi động cảnh báo MỘT lần; `oversight.posture` báo `forgeNgoaiBat`.
 */
import { ENV } from "./env";

/** Đường forge có được cấu hình (URL khác rỗng)? */
export function forgeNgoaiBat(env: { forgeApiUrl: string } = ENV): boolean {
  return env.forgeApiUrl.trim().length > 0;
}

let daCanhBao = false;

/** Cảnh báo lúc khởi động khi URL forge được đặt. Trả `true` nếu VỪA in cảnh báo (mỗi tiến trình tối đa một lần). */
export function canhBaoForgeKhiKhoiDong(env: { forgeApiUrl: string } = ENV, ghi: (s: string) => void = (s) => console.warn(s)): boolean {
  if (daCanhBao || !forgeNgoaiBat(env)) return false;
  daCanhBao = true;
  let host = "?";
  try {
    host = new URL(env.forgeApiUrl).host;
  } catch {
    /* URL hỏng: vẫn cảnh báo */
  }
  ghi(
    `[an-ninh] BUILT_IN_FORGE_API_URL đã đặt (host ${host}) ⇒ sinh ảnh / chuyển giọng nói / dataApi / bản đồ / thông báo / kho tệp forge ` +
      "gọi dịch vụ NGOÀI KHÔNG qua cổng AI ngoài (không che dữ liệu, không trần, không sổ) — cần quyết định của chủ dự án " +
      "(docs/AI_FLOW_SECURITY_OPERATIONS.md §12). Để rỗng nếu không dùng.",
  );
  return true;
}

/** Chỉ lưới: cho cảnh báo in lại. */
export function __datLaiCanhBaoForgeChoTest(): void {
  daCanhBao = false;
}
