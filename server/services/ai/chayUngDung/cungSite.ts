/**
 * ★★★ Đợt 3c — vá "cookie-tossing / same-site" (rà bảo mật trên f4b504dc5).
 *
 * COOKIE KHÔNG TÁCH THEO CỔNG: `127.0.0.1:5099` và `127.0.0.1:3000` là CÙNG host ⇒ mã do AI sinh chạy trong xem trước
 * đặt được `document.cookie = "app_session_id=…; path=/api"` mà ứng dụng chính nhận (che bóng / cố định phiên), và
 * `SameSite` cũng không tách hai cổng cùng site. ⇒ Xem trước CHỈ được bật khi host công khai của proxy KHÁC SITE với
 * host ứng dụng. Phép so ở đây CHẶT có chủ ý (nghi ngờ ⇒ "cùng site" ⇒ từ chối):
 *
 *   1. Host rỗng / méo ⇒ CÙNG (fail-closed).
 *   2. Trùng tuyệt đối (sau chuẩn hoá chữ thường, bỏ `[]`, bỏ dấu chấm cuối, chuẩn hoá IP qua `URL`) ⇒ CÙNG.
 *   3. Nhóm loopback "TÊN": `localhost`, `*.localhost`, `127.0.0.1`, `::1`, `::ffff:127.0.0.1`, `0.0.0.0`, `::` —
 *      coi là MỘT host (cùng một máy, người dùng gõ cái nào cũng được). ⚠ `127.0.0.2` KHÔNG thuộc nhóm: cookie khoá
 *      theo CHUỖI host, IP chỉ khớp tuyệt đối ⇒ `127.0.0.2` khác site với `127.0.0.1` — lối ra khuyên dùng trên máy dev.
 *   4. Có một bên là IP (ngoài nhóm 3) ⇒ chỉ khớp tuyệt đối (IP không có `Domain=` cookie).
 *   5. Tên miền: một bên là cha/con của bên kia, HOẶC chung HAI nhãn cuối ⇒ CÙNG. Không dùng Public Suffix List:
 *      `a.cty.com.vn` vs `b.khac.com.vn` bị coi CÙNG (dương tính giả theo chiều an toàn — đặt tên miền khác hẳn).
 */
import net from "node:net";

/** Chuẩn hoá một hostname (có thể kèm `[]` của IPv6). `null` ⇔ méo. */
export function chuanHoaHost(h: string | null | undefined): string | null {
  if (typeof h !== "string") return null;
  let s = h.trim().toLowerCase();
  if (s === "") return null;
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  while (s.endsWith(".")) s = s.slice(0, -1);
  if (s === "") return null;
  try {
    const u = new URL(`http://${net.isIPv6(s) ? `[${s}]` : s}/`);
    let ra = u.hostname;
    if (ra.startsWith("[") && ra.endsWith("]")) ra = ra.slice(1, -1);
    // URL chấp nhận vài ký tự lạ (vd `_`) — giữ; nhưng khoảng trắng / ký tự cấm đã ném ở trên.
    return ra === "" ? null : ra;
  } catch {
    return null;
  }
}

const LOOPBACK_TEN = new Set(["localhost", "127.0.0.1", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "0.0.0.0", "::"]);

export function laNhomLoopbackTen(h: string | null | undefined): boolean {
  const n = chuanHoaHost(h);
  if (n === null) return false;
  return LOOPBACK_TEN.has(n) || n.endsWith(".localhost");
}

/** `true` ⇔ hai host được coi là CÙNG SITE (⇒ xem trước KHÔNG được phép). Fail-closed. */
export function cungSite(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = chuanHoaHost(a);
  const y = chuanHoaHost(b);
  if (x === null || y === null) return true;
  if (x === y) return true;
  if (laNhomLoopbackTen(x) && laNhomLoopbackTen(y)) return true;
  if (net.isIP(x) !== 0 || net.isIP(y) !== 0) return false;
  if (x.endsWith(`.${y}`) || y.endsWith(`.${x}`)) return true;
  const nx = x.split(".");
  const ny = y.split(".");
  if (nx.length >= 2 && ny.length >= 2 && nx.slice(-2).join(".") === ny.slice(-2).join(".")) return true;
  return false;
}

/** Câu gợi ý cấu hình (máy-đọc-được, không i18n — đi kèm mã lỗi tới quản trị). */
export const GOI_Y_CAU_HINH_ORIGIN_RIENG =
  "Đặt AI_PREVIEW_PUBLIC_ORIGIN tới một HOST khác site với ứng dụng (máy dev: AI_PREVIEW_PUBLIC_ORIGIN=http://127.0.0.2:<AI_PREVIEW_PROXY_PORT>, AI_PREVIEW_PROXY_HOST=127.0.0.2) và mở ứng dụng bằng host khác host ấy.";
