/**
 * ★★★ Review TOÀN NHÁNH Pha 9 · **M-4 (nửa client)** — **CÂU NGƯỜI DÙNG THẤY ĐI QUA i18n.**
 *
 * Tuyến REST (`/api/ai/stream/*`, `/api/ai/local-kb/*`) nay trả một **mã máy-đọc-được** trong ô
 * `code` cùng ba lớp mã trạng thái (401 *"đăng nhập lại"* · 403 *"đăng nhập lại KHÔNG cứu được"* ·
 * 500 *"máy chủ hỏng"*) — xem `server/routes/_xacThucRest.ts`. Hai hook đang hiển thị **thẳng**
 * `errBody.error`, một chuỗi **tiếng Anh cứng** ở tầng máy chủ.
 *
 * ⚠ MỘT CHỦ, KHÔNG HAI: `useAIStream` và `useKbChatStream` đọc cùng hình dạng thân phản hồi, nên
 *   phép dịch sống ở **một** chỗ. Bốn mã (`AUTH_REQUIRED` · `MUST_CHANGE_PASSWORD` ·
 *   `ACCOUNT_DISABLED` · `DB_UNAVAILABLE`) **đã có sẵn** khoá `errors.<mã>` ở cả **ba** locale —
 *   lượt này không đẻ khoá mới.
 * ⚠ `translateAppError` tự lo cửa *"bundle chưa nạp / thiếu đúng khoá này"* (hai vòng sửa F8) và
 *   rơi về `fallback` — nên một mã lạ **không** làm người dùng thấy chuỗi rỗng.
 */
import { translateAppError } from "./errorCodes";

/** Thân JSON của một lượt từ chối từ tuyến REST xác thực. */
export interface ThanLoiRest {
  readonly error?: unknown;
  readonly code?: unknown;
}

/**
 * Câu hiển thị cho một lượt gọi REST hỏng.
 *
 * @param than thân JSON đã parse (hoặc `{}` khi không parse được).
 * @param macDinh câu dự phòng khi thân không mang gì đọc được (thường `Stream failed (500)`).
 */
export function thongDiepLoiRest(than: ThanLoiRest | null | undefined, macDinh: string): string {
  const ma = typeof than?.code === "string" ? than.code : null;
  const tho = typeof than?.error === "string" && than.error.length > 0 ? than.error : macDinh;
  // Không có `code` ⇒ tuyến chưa di trú (hoặc một lỗi khác hẳn) ⇒ giữ nguyên hành vi cũ.
  return ma === null ? tho : translateAppError(ma, undefined, tho);
}
