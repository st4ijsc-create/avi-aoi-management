/**
 * doc 81 Đợt 3b Task 3 — đường dẫn NỘI BỘ an toàn để điều hướng (chuông thông báo `notifications.actionUrl`).
 *
 * Review Focus #2: không open redirect. Dùng ở CẢ HAI phía — server lọc khi ghi/đọc thông báo, client lọc
 * lần nữa trước khi `setLocation` — một hàng không qua được hàm này thì KHÔNG được đi theo.
 *
 * Luật (theo cách trình duyệt phân tích URL, WHATWG):
 *   • phải là chuỗi, bắt đầu bằng ĐÚNG MỘT "/" — "//host" là URL cùng giao thức tới máy khác;
 *   • không có "\" ở đâu cả — trình duyệt coi "\" như "/" với http(s) ⇒ "/\host" = "//host";
 *   • không ký tự điều khiển/khoảng trắng (≤ U+0020, U+007F) — TAB/LF/CR bị BỎ khi phân tích ⇒ "/\t/host" = "//host";
 *   • ≤ 500 ký tự (cột `actionUrl` varchar(500));
 *   • phân tích thật trên một gốc giả phải giữ nguyên gốc ấy (lưới cuối cho mọi trường hợp lạ còn sót).
 * Bắt đầu bằng "/" nên không thể mang scheme (http:, javascript:, data:).
 */
export const INTERNAL_PATH_MAX = 500;

const PROBE_ORIGIN = "http://internal.invalid";

export function safeInternalPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > INTERNAL_PATH_MAX) return null;
  if (raw[0] !== "/" || raw[1] === "/") return null;
  if (raw.includes("\\")) return null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f) return null;
  }
  try {
    if (new URL(raw, PROBE_ORIGIN).origin !== PROBE_ORIGIN) return null;
  } catch {
    return null;
  }
  return raw;
}
