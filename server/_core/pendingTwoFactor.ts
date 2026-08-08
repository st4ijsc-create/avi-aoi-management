/**
 * ★★★ Pha 7 Task 6 — **VÉ "BƯỚC MẬT KHẨU ĐÃ QUA": CHỦ DUY NHẤT CỦA BẤT BIẾN ẤY.**
 * (File này tự khai `Pha 5` để `vramPha5Gate.test.ts` kéo lưới của nó vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI — ĐO ĐƯỢC TRÊN HỆ THẬT, KHÔNG SUY LUẬN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hai lượt liên tiếp, `supervisor1` (id 49, vai `supervisor`, 2FA BẬT), máy chủ sản xuất:
 *
 *     POST /api/auth/login       {username, MẬT KHẨU SAI}  ⇒ 401
 *     POST /api/auth/verify-2fa  {userId: 49, token: OTP}  ⇒ 200 + Set-Cookie (phiên 1 NĂM)
 *
 * `/api/auth/verify-2fa` đọc `userId` **thẳng từ `req.body`** và **không hỏi** bước mật khẩu đã
 * qua chưa. ⇒ **2FA KHÔNG PHẢI yếu tố THỨ HAI — nó là yếu tố DUY NHẤT.** Ai có mã OTP (nhìn màn
 * hình · ứng dụng bị chiếm · nội gián) vào được **mọi** vai, kể cả `admin`, **không cần mật khẩu**.
 *
 * ⇒ Bất biến mà file này sở hữu:
 *
 *   ***∀ lượt `verify-2fa` cấp phiên: bước mật khẩu của CHÍNH `userId` ấy phải vừa qua, trong một
 *   cửa sổ ngắn, và bằng chứng ấy tiêu ĐÚNG MỘT LẦN.***
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO MỘT CHỦ **MỚI** — ĐÃ KIỂM BA CHỦ ĐANG CÓ TRƯỚC KHI VIẾT DÒNG ĐẦU TIÊN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * *"Đừng dựng người ghi/người đọc MỚI cho một bất biến ĐÃ CÓ CHỦ"* — lớp lỗi này đã đẻ **ba
 * Critical** trong chuỗi pha. Nên phép kiểm chạy TRƯỚC, và đây là kết quả:
 *
 *   • `totp_consumed` (mig 0313) + `_core/totpOnce.ts` — sở hữu *"một MÃ OTP tiêu đúng một lần"*.
 *     Nói về **mã**, không nói gì về **mật khẩu**. Một mã chưa tiêu vẫn là một mã của kẻ không
 *     biết mật khẩu. ⇒ **KHÔNG** phải chủ của bất biến trên.
 *   • `user_sessions` (`createUserSession`) — sở hữu *"một PHIÊN đã được lập"*. Hàng chỉ ra đời
 *     **SAU KHI** phiên đã cấp ⇒ dùng nó làm bằng chứng là để **bằng chứng sinh sau thứ nó phải
 *     gác**. ⇒ **KHÔNG**.
 *   • `oauthStateStore` + `consumeStateEntry` (`_core/oauth.ts:38-87`) — sở hữu *"nonce OAuth một
 *     lần, hạn 5 phút"*, cột chặt vào `ExternalOAuthProvider`. ⇒ **KHÔNG** — nhưng **HÌNH DẠNG**
 *     của nó thì mượn nguyên: sổ trong bộ nhớ · hạn ngắn · `consume` xoá luôn khỏi sổ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO SỔ NẰM TRONG BỘ NHỚ Ở ĐÂY, TRONG KHI `totp_consumed` VỪA PHẢI ĐI XUỐNG DB (mig 0313)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Câu trả lời **không** phải "vì gọn hơn". Nó là **CHIỀU CỦA LƯỢT HỎNG**, và hai sổ ngược chiều
 * nhau:
 *
 *   | mất sổ vì…      | `totp_consumed` (mã đã tiêu)          | vé này (bước mật khẩu đã qua)      |
 *   |-----------------|---------------------------------------|------------------------------------|
 *   | restart         | mã đã tiêu **dùng lại được** → MỞ 🔴  | vé biến mất → **401** → ĐÓNG ✅    |
 *   | hai tiến trình  | mã tiêu ở A vẫn qua ở B → MỞ 🔴       | vé của A không có ở B → **401** ✅ |
 *
 * Sổ *"đã tiêu"* mất trí nhớ ⇒ **fail-OPEN** ⇒ bắt buộc phải bền và dùng chung ⇒ DDL.
 * Sổ *"đã qua"* mất trí nhớ ⇒ **fail-CLOSED** ⇒ hậu quả xấu nhất là người dùng phải **nhập lại
 * mật khẩu**. Không lượt mất trí nhớ nào của sổ này cấp thêm một phiên nào cho ai.
 * ⇒ **KHÔNG cần DDL, và cũng KHÔNG được lấy DDL ra làm cớ để hoãn.**
 *
 * ⚠ Đây cũng đúng hành vi mà repo **đã chấp nhận** cho `oauthStateStore`: nonce OAuth cũng chết
 *   theo tiến trình, và cũng vì lượt hỏng của nó là fail-closed.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÉ ĐI BẰNG **COOKIE HttpOnly**, KHÔNG ĐI BẰNG BODY — VÀ ĐÓ LÀ MỘT LỰA CHỌN CÓ GIÁ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   • **Chỉ thu hẹp, không đổi hợp đồng.** Hình dạng response của cả hai đường `login` giữ
 *     NGUYÊN 100 %; `client/src/pages/Login.tsx` **không sửa một dòng nào** (lượt
 *     `fetch("/api/auth/verify-2fa")` ở `:90` là same-origin ⇒ trình duyệt tự gửi cookie). Nhờ đó
 *     **đối chứng dương** — luồng đúng vẫn cấp phiên — không phải "vì tôi cũng vừa sửa client cho
 *     khớp", mà vì client **không hề biết** có vé.
 *   • **`httpOnly: true`** ⇒ một lỗ XSS **không đọc được** vé. Vé đi trong body thì nó sống trong
 *     bộ nhớ JS của trang, tức đúng nơi XSS với tới.
 *   • Giá phải trả, nói thẳng: client **không giữ cookie** (vd. `curl` không `-c/-b`) sẽ **hỏng**
 *     ở bước 2FA. Đó là **fail-closed** và là **chính cái lỗ này** — một client như thế hôm nay
 *     đang đăng nhập được **mà không cần mật khẩu**.
 *
 * ⚠ **NGÂN SÁCH LƯỢT THỬ, và vì sao vé KHÔNG tiêu ngay lúc kiểm:** tiêu vé trước khi verify OTP thì
 *   một lượt **gõ nhầm 6 số** cũng bắt người dùng nhập lại mật khẩu ⇒ luồng đúng vỡ. Nên vé chỉ
 *   tiêu khi OTP **ĐÚNG**. Cửa mở ra từ đó (một vé = vô hạn lượt đoán OTP trong 5 phút) được đóng
 *   bằng `VE_SO_LUOT` — hết ngân sách thì vé **chết**, đúng khuôn `MAX_LOGIN_ATTEMPTS` của
 *   `authService.ts`.
 */
import { randomBytes } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import type { CookieOptions, Request, Response } from "express";
import { getSessionCookieOptions } from "./cookies";

/** Tên cookie mang **mã vé** (không mang danh tính, không mang gì đọc được). */
export const VE_COOKIE = "pending_2fa";

/**
 * Hạn của vé. **5 phút** — cùng con số `STATE_TTL_MS` của `oauthStateStore` (`_core/oauth.ts:37`),
 * và cùng lý lẽ: đủ để một người thật lấy mã trên điện thoại, ngắn hơn nhiều so với thời gian một
 * vé bị bỏ quên thành hữu ích cho người khác.
 */
export const VE_HAN_MS = 5 * 60 * 1000;

/** Ngân sách lượt OTP sai cho MỘT vé. Khớp `MAX_LOGIN_ATTEMPTS` của `authService.ts`. */
export const VE_SO_LUOT = 5;

export type LyDoTuChoiVe = "thieu-ve" | "ve-la" | "qua-han" | "sai-nguoi" | "het-luot";

type MucVe = {
  userId: number;
  hetHanLuc: number;
  luotConLai: number;
};

const soVe = new Map<string, MucVe>();

function donVeQuaHan(bayGio = Date.now()): void {
  for (const [ma, muc] of soVe.entries()) {
    if (muc.hetHanLuc <= bayGio) soVe.delete(ma);
  }
}

// Cùng khuôn dọn rác của `oauthStateStore`: `unref()` để bộ hẹn giờ không giữ tiến trình sống.
const boHenGio = setInterval(donVeQuaHan, VE_HAN_MS);
if (typeof boHenGio.unref === "function") boHenGio.unref();

/**
 * Tuỳ chọn cookie của vé = **đúng** tuỳ chọn cookie phiên (`httpOnly`/`path`/`sameSite`/`secure`
 * do `getSessionCookieOptions` quyết theo môi trường) **+** `maxAge` riêng của vé.
 * ⚠ Dùng lại hàm ấy chứ không chép giá trị: một lượt siết `secure`/`sameSite` cho cookie phiên
 *   phải kéo theo cookie vé, nếu không thì bịt một cửa và để mở cửa kia.
 */
function tuyChonVe(req: Request): CookieOptions {
  return { ...getSessionCookieOptions(req), maxAge: VE_HAN_MS };
}

/**
 * ⚠ Đọc **thẳng từ `req.headers.cookie`**, không đọc `req.cookies`: repo này **không nạp**
 * `cookie-parser` (đã `grep` toàn `server/**` + `package.json`: không có). `_core/context.ts:41`
 * và `sdk.parseCookies` cũng làm đúng thế. Tin vào `req.cookies` ở đây sẽ cho `undefined` **luôn
 * luôn** ⇒ mọi lượt `verify-2fa` trả `thieu-ve` ⇒ **chặn hết**, kể cả luồng đúng.
 */
function maVeTu(req: Request): string | null {
  const header = req.headers?.cookie;
  if (typeof header !== "string" || header.length === 0) return null;
  const v = parseCookieHeader(header)[VE_COOKIE];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Cấp vé cho `userId` — gọi ở **đúng chỗ bước mật khẩu vừa qua mà 2FA còn thiếu**, tức nhánh
 * `requires2FA` của cả hai đường `login` (tRPC `auth.login` và `POST /api/auth/login`).
 */
export function capVe2FA(userId: number, req: Request, res: Response): string {
  donVeQuaHan();
  const ma = randomBytes(32).toString("hex");
  soVe.set(ma, {
    userId,
    hetHanLuc: Date.now() + VE_HAN_MS,
    luotConLai: VE_SO_LUOT,
  });
  res.cookie(VE_COOKIE, ma, tuyChonVe(req));
  return ma;
}

/**
 * Hỏi vé — **KHÔNG tiêu**. Trả lời *"bước mật khẩu của ĐÚNG `userId` này đã qua chưa"*.
 * ⚠ `sai-nguoi` là ca thật, không phải lo xa: vé là bằng chứng cho **một** danh tính, còn `userId`
 *   vẫn tới từ body ⇒ không ràng hai thứ lại thì vé của A mở được tài khoản của B.
 */
export function kiemVe2FA(
  req: Request,
  userId: number,
): { hopLe: true } | { hopLe: false; lyDo: LyDoTuChoiVe } {
  const ma = maVeTu(req);
  if (!ma) return { hopLe: false, lyDo: "thieu-ve" };
  const muc = soVe.get(ma);
  if (!muc) return { hopLe: false, lyDo: "ve-la" };
  if (muc.hetHanLuc <= Date.now()) {
    soVe.delete(ma);
    return { hopLe: false, lyDo: "qua-han" };
  }
  if (muc.luotConLai <= 0) {
    soVe.delete(ma);
    return { hopLe: false, lyDo: "het-luot" };
  }
  if (muc.userId !== userId) return { hopLe: false, lyDo: "sai-nguoi" };
  return { hopLe: true };
}

/**
 * Một lượt OTP **SAI** trên vé này ⇒ trừ ngân sách; hết thì vé chết ngay.
 * (Không đụng cookie: lượt `kiemVe2FA` kế tiếp trả `ve-la`/`het-luot` và người dùng quay lại bước
 * mật khẩu — đúng hành vi mong muốn.)
 */
export function ghiNhanOtpSai(req: Request): void {
  const ma = maVeTu(req);
  if (!ma) return;
  const muc = soVe.get(ma);
  if (!muc) return;
  muc.luotConLai -= 1;
  if (muc.luotConLai <= 0) soVe.delete(ma);
}

/** Tiêu vé (một-lần) — gọi **sau** khi OTP đã đúng, **trước/cùng** lượt cấp phiên. */
export function tieuVe2FA(req: Request, res: Response): void {
  const ma = maVeTu(req);
  if (ma) soVe.delete(ma);
  res.clearCookie(VE_COOKIE, { ...getSessionCookieOptions(req), maxAge: -1 });
}

/** Chỉ dành cho lưới — số vé đang sống. */
export function __soVeDangSong(): number {
  donVeQuaHan();
  return soVe.size;
}

/** Chỉ dành cho lưới — dọn sạch sổ giữa hai ca. */
export function __resetSoVe(): void {
  soVe.clear();
}

/**
 * Chỉ dành cho lưới — đẩy **lùi** hạn của một vé để ca *"vé quá hạn"* không phải ngủ 5 phút.
 * ⚠ Không có đường nào từ request tới hàm này; nó chỉ sửa sổ trong bộ nhớ của chính tiến trình.
 */
export function __laoHoaVe(ma: string, luiMs: number): void {
  const muc = soVe.get(ma);
  if (muc) muc.hetHanLuc -= luiMs;
}
