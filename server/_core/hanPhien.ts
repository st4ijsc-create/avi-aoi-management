/**
 * ★★★★ Pha 9 · **HẠN CỦA MỘT PHIÊN — MỘT CHỦ, MỘT CON SỐ, BA NƠI TIÊU THỤ.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐO SỐNG TRÊN MÁY CHỦ ĐANG CHẠY (PID 36248, `POST /api/trpc/auth.login`, `engineer1`)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 *     Set-Cookie: app_session_id=…; Max-Age=31536000; Expires=Thu, 12 Aug 2027 15:42:43 GMT
 *     JWT payload: { …, "exp": 1818085363 }   →  2027-08-12   →  TTL = 365,00 ngày
 *
 * ⇒ Cửa sổ khai thác của **một cookie bị bắt** là **MỘT NĂM**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÀ MỘT PHÁT HIỆN NGOÀI BRIEF: `SESSION_TTL_DAYS` KHÔNG PHẢI *"có sẵn nhưng chưa đặt"* —
 *     NÓ LÀ **MÃ CHẾT**.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `sdk.signSession` **có** đọc `SESSION_TTL_DAYS`, nhưng chỉ dùng nó làm **mặc định**:
 *
 *     const expiresInMs = options.expiresInMs ?? defaultTtlMs;   // ← `??`
 *
 * và **cả bốn** cửa đúc vé phiên truyền `expiresInMs: ONE_YEAR_MS` **tường minh**
 * (`authService.establishSession` · `oauth.ts` ×2 · `samlProvider.ts`). ⇒ Đặt `SESSION_TTL_DAYS`
 * vào `.env` **không đổi được một giây nào** — người vận hành sẽ đặt nó, đọc lại tài liệu, và tin
 * rằng mình đã siết. Đó là một **hàng rào không ai canh** ở dạng tệ nhất: nó *trông như* một nút
 * điều khiển. Lượt này gỡ cả bốn lượt truyền tường minh ấy.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO **30 NGÀY** — VÀ VÌ SAO KHÔNG PHẢI 7
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. **Chính repo này đã chọn 30 ngày một lần rồi.** `_core/index.ts:1930` — thẻ Bearer của
 *     `/api/external/auth/login` — dùng `30 * 24 * 60 * 60 * 1000`. Lấy cùng con số là **hợp nhất**
 *     hai bề mặt về một hạn, thay vì đẻ ra con số thứ ba.
 *  2. **Chính bình luận cũ ở `sdk.signSession` khuyến nghị `7–30 ngày`.** 30 là **đầu thận trọng**
 *     của khoảng ấy — ít rủi ro hồi quy nhất, mà vẫn cắt cửa sổ khai thác **12 lần** (365 → 30).
 *  3. **Phiên KHÔNG gia hạn trượt.** `verifySession` chỉ kiểm `exp`; không cửa nào đúc lại vé cho
 *     một người đang dùng. ⇒ TTL là một hạn **TUYỆT ĐỐI** kể từ lúc đăng nhập, không phải "30 ngày
 *     không hoạt động". Với nhà máy — ca kíp, trạm HMI dùng chung — 7 ngày nghĩa là **mỗi tuần**
 *     một lượt đăng nhập lại trên mọi trạm; đó là đúng loại ma sát đẩy người vận hành sang dùng
 *     chung tài khoản. 30 ngày ≈ **một lượt/tháng/thiết bị**.
 *  4. **TTL là CẬN TRÊN cho một phiên KHÔNG AI ĐỂ Ý**, không phải cơ chế thu hồi. Ba cơ chế thu hồi
 *     đã có và có hiệu lực **NGAY**: `chanNeuPhienDaThuHoi` (tra sổ mỗi request — Pha 8 C-1 + Pha 9
 *     A2), `chanNeuTaiKhoanBiTat` + `revokeAllSessions` khi tắt tài khoản (Pha 9 C-1), và
 *     `session.revoke` thủ công. TTL chỉ trả lời câu *"nếu KHÔNG ai làm gì cả thì bao lâu?"*.
 *
 * ⚠ **CHỈ ẢNH HƯỞNG VÉ MỚI** — đo, đừng suy: `exp` nằm **trong** JWT đã ký, và `expiresAt` đã nằm
 *   trong hàng `user_sessions`. Không lượt nào ở đây đọc lại hai giá trị ấy, nên **mọi phiên đang
 *   sống giữ nguyên hạn cũ**. Nghiệm thu sống ở báo cáo lượt này: cookie đúc **trước** lượt triển
 *   khai vẫn `auth.me` ⇒ `id 51` **sau** lượt triển khai.
 *
 * ⚠ **KHÔNG chạm** thẻ Bearer của `/api/external/auth/login`: nó là một **API hướng ra ngoài đã
 *   tài liệu hoá** (`docs/API_REFERENCE.md` + OpenAPI, client thật `FactoryAlertSystem`), nên hạn
 *   của nó là một hợp đồng sản phẩm — không được để `SESSION_TTL_DAYS` lặng lẽ đổi. Nó đã là 30
 *   ngày, nên hôm nay hai bề mặt trùng số; đó là một sự trùng **có chủ ý**, không phải một bản sao.
 */

/** Mặc định khi `SESSION_TTL_DAYS` không đặt / không hợp lệ. Xem khối lý lẽ trên. */
export const HAN_PHIEN_MAC_DINH_NGAY = 30;

const MS_MOT_NGAY = 24 * 60 * 60 * 1000;

/**
 * Hạn của một phiên **MỚI**, tính bằng mili-giây.
 *
 * ⚠ Đọc `process.env` ở **mỗi lượt gọi**, không ghim lúc nạp module: một lượt đổi cấu hình + khởi
 *   động lại tiến trình phải có hiệu lực ngay, và một hằng cấp module làm lưới phải `resetModules`
 *   để đo được — thứ đã đẻ ra một lớp ca không tất định trong chính nhánh này.
 * ⚠ Giá trị **không hợp lệ** (rỗng · `0` · âm · `NaN` · `Infinity`) ⇒ rơi về mặc định, **không** ném
 *   và **không** cho ra một hạn 0 giây: một cấu hình gõ sai không được biến thành một nhà tù.
 */
export function hanPhienMs(): number {
  const ngay = Number(process.env.SESSION_TTL_DAYS);
  return Number.isFinite(ngay) && ngay > 0 ? ngay * MS_MOT_NGAY : HAN_PHIEN_MAC_DINH_NGAY * MS_MOT_NGAY;
}
