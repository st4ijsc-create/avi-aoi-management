/**
 * ★★ Đợt 3c — phòng thủ chiều sâu chống COOKIE-TOSSING, mức **CHỈ GHI LOG** (KHÔNG đổi hành vi xác thực).
 *
 * Một origin CÙNG SITE (vd mã do AI sinh chạy trên cùng host khác cổng) đặt được `app_session_id=…; path=/api`.
 * Trình duyệt khi ấy gửi HAI cookie cùng tên, path DÀI trước — và `cookie.parse` (sdk/context) giữ giá trị ĐẦU TIÊN
 * ⇒ cookie che bóng THẮNG (cố định phiên / đăng xuất ngầm). Lớp chặn chính là ở xem trước (origin khác site,
 * `services/ai/chayUngDung/cungSite.ts`); đây chỉ là CẢM BIẾN: ≥ 2 `app_session_id` ⇒ một dòng cảnh báo, có giới hạn
 * tần suất (mặc định ≤ 1 dòng/phút + đếm số lần bị nén), KHÔNG in giá trị cookie, KHÔNG ném.
 * ⚠ Chưa chặn vì trùng hợp lệ có thể có (cookie cũ khác `Domain`/`path` từ bản trước) — đo log trước khi bật cứng.
 * MỘT điểm gọi: `sdk.xacThucTho` (đường xác thực chung của tRPC + REST).
 */
import { COOKIE_NAME } from "@shared/const";

/** Đếm cookie TÊN `ten` trong header thô (không qua `cookie.parse` — nó nuốt bản trùng). */
export function demCookieTheoTen(header: string | undefined, ten: string): number {
  if (typeof header !== "string" || header === "") return 0;
  let n = 0;
  for (const phan of header.split(";")) {
    const i = phan.indexOf("=");
    if (i > 0 && phan.slice(0, i).trim() === ten) n++;
  }
  return n;
}

export function taoCanhBaoCookiePhienTrung(o: { bayGio?: () => number; ghi?: (s: string) => void; khoangMs?: number } = {}) {
  const bayGio = o.bayGio ?? Date.now;
  const ghi = o.ghi ?? ((s: string) => console.warn(s));
  const khoang = o.khoangMs ?? 60_000;
  let lanCuoi = Number.NEGATIVE_INFINITY;
  let biNen = 0;
  return (header: string | undefined): void => {
    try {
      const n = demCookieTheoTen(header, COOKIE_NAME);
      if (n < 2) return;
      const t = bayGio();
      if (t - lanCuoi < khoang) {
        biNen++;
        return;
      }
      lanCuoi = t;
      const nen = biNen;
      biNen = 0;
      ghi(`[Auth] ${n} cookie ${COOKIE_NAME} trùng tên trong một yêu cầu — dấu hiệu cookie-tossing từ một origin cùng site (đã nén ${nen} lần trong cửa sổ trước; chưa chặn).`);
    } catch {
      /* cảm biến không bao giờ làm hỏng xác thực */
    }
  };
}

export const canhBaoCookiePhienTrung = taoCanhBaoCookiePhienTrung();
