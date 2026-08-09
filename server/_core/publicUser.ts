/**
 * ★★★ Pha 7 Task 7 — **CHỦ DUY NHẤT của bất biến: "cột nào của `users` được RỜI MÁY CHỦ".**
 * (Module này tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo hai lưới của nó
 *  vào lượng từ *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO MODULE NÀY TỒN TẠI — ĐO ĐƯỢC TRÊN HỆ THẬT, KHÔNG PHẢI LO XA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `auth.me` (`server/routers.ts`) từng là `publicProcedure.query(opts => opts.ctx.user)` — trả
 * **NGUYÊN HÀNG `users`**. Bước 1 của Task 7 đo trên máy chủ đang chạy:
 *
 *   GET /api/trpc/auth.me ⇒ 200
 *   { … "passwordHash":"$2b$10$xY5z…", "twoFactorSecret":"IA2DCZK5LBKTSOTYGMUXCM2UHZ2G4ULQ" … }
 *
 * `twoFactorSecret` là **HẠT GIỐNG sinh mọi mã OTP**. Ai đọc được nó thì tự sinh mã hợp lệ **mãi
 * mãi** ⇒ vé một-lần (Pha 7 Task 6) · sổ chống phát lại `totp_consumed` (Pha 7 Task 5) · step-up
 * mỗi lượt (Pha 6 Task 1/1b) **đều thành trang trí**. Và nó rộng hơn VRAM: **mọi** thứ đứng sau
 * 2FA của toàn hệ (deploy · xoá dự án · tắt 2FA · đẻ mã dự phòng) đứng sau bí mật ấy.
 *
 * Phép đếm Bước 2 tìm ra **thứ nguy hơn `auth.me`** (lần thứ SÁU phép đếm lật quyết định):
 *   • `user.list` — `db.getAllUsers()` **nguyên hàng, KHÔNG lọc**, ⇒ bí mật của **MỌI** người dùng;
 *   • `userAssignment.getAllUserAssignments` — `{ user, … }` nguyên hàng, mọi người dùng;
 *   • `user.getById` / `user.search` — chỉ bỏ `passwordHash`, **`twoFactorSecret` VẪN RA**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO **DANH SÁCH CHO PHÉP**, KHÔNG PHẢI DANH SÁCH CẤM
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ba chỗ trong repo đã dùng danh sách CẤM cho đúng bất biến này, và **hai** trong ba đã sai:
 *   · `userRouters.ts` — `const { passwordHash, ...safeUser } = user`  ⇒ **bỏ sót `twoFactorSecret`**;
 *   · `authSessionCache.ts` — `{ ...user, passwordHash: null, twoFactorSecret: null }` ⇒ đúng **hôm
 *     nay**, nhưng một cột bí mật **thứ ba** đi thẳng vào Redis mà không ai biết.
 * Lớp lỗi *"cái gì LIỆT KÊ thì luôn có phần tử thứ N+1"* đã tái diễn **MƯỜI SÁU** lần trong chuỗi
 * pha này. Lời giải **mỗi lần**: **ĐẢO LƯỢNG TỪ**.
 *
 * Ở đây lượng từ được đảo bằng **BA** tính chất chồng nhau, mỗi cái đóng một cửa thoát:
 *
 *  1. **MẶC ĐỊNH ĐÓNG** — `toPublicUser()` **CHỌN** theo `PUBLIC_USER_FIELDS`. Một cột mới thêm vào
 *     `users` **không ra được** kể cả khi không ai nhớ tới nó. An toàn **KHÔNG** là hệ quả của một
 *     lưới đang xanh (lăng kính *"an toàn là HỆ QUẢ của một thứ khác đang hỏng"* — đã bảy lần).
 *  2. **PHÂN LOẠI TOÀN PHẦN** — `USER_FIELD_VISIBILITY` phải phủ **đúng** tập cột của `users`,
 *     canh **hai chiều** với `getTableColumns(users)` ở `publicUser.test.ts`. Thêm một cột mà không
 *     phân loại ⇒ **ĐỎ**. Đây là chỗ biến *"an toàn im lặng"* thành *"một QUYẾT ĐỊNH ĐƯỢC NÓI RA"*.
 *  3. **ĐỔI KIỂU** — `PublicUser` giao với `{ [K in ServerOnlyUserField]?: never }`, nên nhét một ô
 *     bí mật trở lại vào giá trị trả về là **LỖI BIÊN DỊCH**, không phải một lượt review bỏ sót.
 *     (Khuôn *"làm cho thứ sai KHÔNG VIẾT RA ĐƯỢC"* đã dùng thành công 5 lần trong dự án.)
 *
 * ⚠ **KHÔNG dựng người ghi thứ hai.** `authSessionCache.setCachedAuthUser` và
 *   `sdk.authenticateRequest` **gọi lại** `redactServerOnlyUserFields()` của module này thay vì giữ
 *   danh sách riêng — lớp lỗi *"nhiều chủ cho một bất biến"* đã đẻ **ba** Critical.
 */
import { getTableColumns } from "drizzle-orm";
import { users, userSecrets, type User, type UserSecrets } from "../../drizzle/schema";

/** Mức hiển thị của một cột `users`. */
export type UserFieldVisibility = "public" | "server-only";

/**
 * ★★★ **PHÂN LOẠI TOÀN PHẦN** mọi cột của bảng `users`.
 *
 * ⚠⚠ `Record<keyof User, …>` khiến **TypeScript** bắt lỗi ngay khi một cột mới xuất hiện trong
 *    `drizzle/schema/auth.ts` mà không được phân loại ở đây — tức lượng từ được cưỡng chế **hai
 *    tầng**: lúc biên dịch (kiểu) **và** lúc chạy (`publicUser.test.ts`, đối chiếu với
 *    `getTableColumns(users)` — nguồn sự thật DUY NHẤT, không chép tay).
 *
 * ⚠ Khi thêm cột mới: **mặc định phải là `"server-only"`**, rồi mới cân nhắc mở. Mở một cột là một
 *   quyết định về an ninh; đóng một cột thì không.
 */
export const USER_FIELD_VISIBILITY = {
  id: "public",
  openId: "public",
  username: "public",
  name: "public",
  email: "public",
  phone: "public",
  department: "public",
  position: "public",
  loginMethod: "public",
  role: "public",
  isActive: "public",
  twoFactorEnabled: "public",
  loginAttempts: "public",
  lockedUntil: "public",
  /**
   * 🔴 **Pha 7 Task 9 (9b) — QĐ-1.** Hai MỐC nói *"tài khoản này có đang bị buộc đổi mật khẩu
   * không"*. Chủ dự án chọn đặt chúng trên `users`; **giữ chúng không rò là ràng buộc kỹ thuật**,
   * và hai thứ không mâu thuẫn:
   *   · phân loại **`"server-only"`** ⇒ `user.list` **không** phát ra được một danh sách chính xác
   *     các tài khoản đang bị buộc đổi mật khẩu (đó là rủi ro đã nêu, nay đóng **theo cấu tạo**);
   *   · client vẫn biết về **CHÍNH NÓ** qua ô SUY RA `mustChangePassword` ở `auth.me`
   *     (`suyRaPhaiDoiMatKhau` dưới đây) — **không** bằng cách mở cột.
   * ⚠ Luật cưỡng chế nằm ở `publicUser.test.ts` và là một **LƯỢNG TỪ**, không phải hai tên:
   *   ***∀ cột `users` có tên chứa "password" ⇒ phải là `"server-only"`.***
   */
  passwordChangedAt: "server-only",
  passwordInvalidBefore: "server-only",
  createdAt: "public",
  updatedAt: "public",
  lastSignedIn: "public",
} as const satisfies Record<keyof User, UserFieldVisibility>;

type Visibility = typeof USER_FIELD_VISIBILITY;

/** Tên cột được phép rời máy chủ. */
export type PublicUserField = {
  [K in keyof Visibility]: Visibility[K] extends "public" ? K : never;
}[keyof Visibility];

/** Tên cột **KHÔNG BAO GIỜ** được rời máy chủ. */
export type ServerOnlyUserField = {
  [K in keyof Visibility]: Visibility[K] extends "server-only" ? K : never;
}[keyof Visibility];

/**
 * ★★★ Hình dạng người dùng **được phép** ra ngoài máy chủ.
 *
 * ⚠⚠ Phần giao `{ [K in ServerOnlyUserField]?: never }` là **cả điểm mấu chốt**: nó khiến một giá
 * trị có `twoFactorSecret: string` **KHÔNG gán được** vào `PublicUser`. Tức bản vá này không dựa
 * vào việc người sau *nhớ* gọi `toPublicUser()` — nếu họ trả hàng thô, `tsc` **đỏ**.
 */
export type PublicUser = Pick<User, PublicUserField> & {
  [K in ServerOnlyUserField]?: never;
};

/** Mọi cột **được phép** ra ngoài — suy ra từ phân loại, không viết tay lần hai. */
export const PUBLIC_USER_FIELDS = (
  Object.keys(USER_FIELD_VISIBILITY) as (keyof Visibility)[]
).filter((k) => USER_FIELD_VISIBILITY[k] === "public") as readonly PublicUserField[];

/** Mọi cột **chỉ ở máy chủ** — suy ra từ phân loại, không viết tay lần hai. */
export const SERVER_ONLY_USER_FIELDS = (
  Object.keys(USER_FIELD_VISIBILITY) as (keyof Visibility)[]
).filter((k) => USER_FIELD_VISIBILITY[k] === "server-only") as readonly ServerOnlyUserField[];

/**
 * ★★★ **PHÉP CHIẾU DUY NHẤT** để một đối tượng người dùng rời máy chủ.
 *
 * ⚠⚠ Nó **CHỌN** (allow-list), **không XOÁ** (deny-list). Hệ quả đo được: một cột bí mật **thứ ba**
 * thêm vào `users` ngày mai **không ra được** qua đường này — kể cả trước khi ai đó phân loại nó.
 * Đó là khác biệt giữa *"một danh sách"* và *"một luật"*.
 */
export function toPublicUser<T extends Partial<Record<keyof User, unknown>>>(
  user: T,
): PublicUser {
  const ra = {} as Record<string, unknown>;
  for (const k of PUBLIC_USER_FIELDS) {
    if (k in user) ra[k] = (user as Record<string, unknown>)[k];
  }
  return ra as PublicUser;
}

/** `toPublicUser` cho một danh sách. */
export function toPublicUsers<T extends Partial<Record<keyof User, unknown>>>(
  list: readonly T[],
): PublicUser[] {
  return list.map((u) => toPublicUser(u));
}

/**
 * ★★★ Bản **GIỮ KIỂU `User`** của phép làm sạch — dùng ở những chỗ mà đổi kiểu tĩnh sẽ lan ra hàng
 * trăm điểm (`TrpcContext.user: User`, `sdk.authenticateRequest(): Promise<User>`).
 *
 * ⚠⚠ Vì sao cần cả hai hàm, chứ không chỉ `toPublicUser`: `ctx.user` được **hàng trăm** chỗ dùng
 * với kiểu `User`; đổi kiểu ở đó **không phải một lượt thu hẹp** mà là một cuộc đại tu. Nên bất biến
 * được cưỡng chế ở **hai tầng khác nhau**:
 *   · **GIÁ TRỊ** — `authenticateRequest` trả về hàng đã bị làm rỗng bí mật ⇒ `ctx.user` **không bao
 *     giờ** mang bí mật, nên socket / export / route AI / `localStorage` của client đều sạch;
 *   · **KIỂU** — `auth.me`, `user.list`, … trả `PublicUser` ⇒ nhét lại là lỗi biên dịch.
 *
 * ⚠ ĐO TRƯỚC KHI ĐỔI (Bước 2 §2.4): `git grep` mọi điểm đọc `passwordHash`/`twoFactorSecret` ⇒
 *   **6 điểm, KHÔNG điểm nào** đọc từ `ctx.user`; cả 6 đọc từ một lượt `db.getUserById` /
 *   `getUserByUsername` **MỚI**. Vì thế phép làm rỗng này **không chạm** đường đăng nhập, đổi mật
 *   khẩu, bật/tắt 2FA.
 *
 * ⚠ Đặt `null` (chứ không xoá khoá) để giữ **đúng kiểu `User`** và giữ hình dạng giống hệt thứ
 *   `authSessionCache` vẫn trả về khi cache HIT — nhờ vậy cache-hit và cache-miss thôi khác nhau.
 *   (Trước bản vá, khác nhau ấy làm lượt rò **NGẮT QUÃNG**: đo được 1/6 lượt rò, 5/6 lượt sạch ⇒
 *   một lượt nghiệm thu "nhìn một phát" sẽ báo SẠCH NHẦM.)
 */
export function redactServerOnlyUserFields<T extends Record<string, unknown>>(user: T): T {
  const ra = { ...user } as Record<string, unknown>;
  for (const k of SERVER_ONLY_USER_FIELDS) ra[k] = null;
  return ra as T;
}

/**
 * Tập cột **thật** của bảng `users`, đọc từ drizzle. Dùng bởi `publicUser.test.ts` để canh lượng từ
 * hai chiều. ⚠ Để ở đây (không nội tuyến trong test) vì `getTableColumns` là **nguồn sự thật**, và
 * cả hai lưới phải hỏi **cùng một** nguồn.
 */
export function moiCotCuaBangUsers(): string[] {
  return Object.keys(getTableColumns(users)).sort();
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ Pha 7 Task 9 / R1 — **NEO LẠI LƯỢNG TỪ SANG `user_secrets`.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 9c chuyển `passwordHash` + `twoFactorSecret` sang bảng `user_secrets`. Hệ quả **đo được trước
 * khi đổi** (§2.5 báo cáo Task 9): nếu luật của Task 7 vẫn chỉ neo vào `users`, thì
 *   · `SERVER_ONLY_USER_FIELDS` mất hai phần tử ấy,
 *   · `ServerOnlyUserField` co lại,
 *   · và cổng *"nhét bí mật lại là LỖI BIÊN DỊCH"* (`PublicUser` giao `{[K]?: never}`) **hoá
 *     trang trí** — vì phần giao không còn chặn hai tên nguy nhất.
 * ⚠⚠ Và lượt sửa **hiển nhiên** (xoá bốn dòng test đang đỏ) làm **mọi thứ xanh** với một danh sách
 *    rỗng. Đó chính là lớp *"trả nợ đẻ ra nợ nặng hơn"*.
 *
 * ⇒ Bất biến được phát biểu lại, **trên hai bảng**, và **suy ra** cả hai vế:
 *
 *   ***∀ cột bí mật c của `user_secrets`: c KHÔNG BAO GIỜ rời máy chủ.***
 *
 * "Cột bí mật của `user_secrets`" = **mọi** cột của bảng ấy **trừ** hai cột hạ tầng (`userId` —
 * chính là `users.id`, đã công khai; `updatedAt` — một dấu thời gian). Một cột **thứ ba** thêm vào
 * `user_secrets` ngày mai tự vào lượng từ, **không cần ai nhớ sửa file này** — và ô *"tập rỗng ⇒
 * ĐỎ"* ở `publicUser.test.ts` chặn đúng đường thoát mà §2.5 vừa mô tả. */

/* ──────────────────────────────────────────────────────────────────────────────────────────────
 * ★★★ Pha 7 / review TOÀN NHÁNH **C-2** — **CỔNG KIỂU, DỰNG LẠI TRÊN ĐÚNG BẢNG.**
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠⚠⚠ VÌ SAO KHỐI NÀY TỒN TẠI: **9c GỠ MẤT tầng cưỡng chế lúc BIÊN DỊCH, và không ai thấy.**
 * Ba tính chất của Task 7 (mặc-định-đóng · phân-loại-toàn-phần · **đổi KIỂU**) đều phát biểu trên
 * **cột của `users`**. 9c dời `passwordHash` + `twoFactorSecret` sang `user_secrets` ⇒
 * `keyof User` **không còn** hai tên ấy ⇒ `ServerOnlyUserField` co về hai dấu thời gian ⇒ phần
 * giao `{ [K in ServerOnlyUserField]?: never }` của `PublicUser` **không còn nhắc tới hai bí mật**.
 * Tức tính chất (3) **thôi chặn đúng thứ nó được dựng ra để chặn**.
 *
 * **ĐO ĐƯỢC, không suy ra** (đột biến của lượt review, đã hoàn nguyên): thêm
 * `twoFactorSecret: status?.twoFactorSecret ?? null` vào giá trị trả về của `user.get2FAStatus` ⇒
 *   `npm run check` **SẠCH (0 lỗi)** · sáu lưới của Task 7/8/9 **58/58 XANH**.
 * ⇒ **Hạt giống TOTP đi thẳng ra trình duyệt qua cổng chính, không ai chặn.**
 *
 * ⚠ Bản vá của R1 (`moiCotBiMatCuaUserSecrets`, dưới đây) **đúng nhưng hẹp hơn** câu Task 7 hứa:
 *   nó khẳng định *"không cột nào của `user_secrets` lọt vào `PUBLIC_USER_FIELDS`"* — mà cột của
 *   `user_secrets` **theo cấu tạo không thể** nằm trong `keyof User`, nên vế ấy **trống nghĩa**.
 *   Cái thiếu là **cổng KIỂU**, và nó phải neo vào **chính bảng đang giữ bí mật**.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * ★★★ **PHÂN LOẠI TOÀN PHẦN** mọi cột của bảng `user_secrets` — **cùng khuôn** với
 * `USER_FIELD_VISIBILITY`, và cùng lý do.
 *
 * ⚠⚠ `Record<keyof UserSecrets, …>` khiến **TypeScript** bắt lỗi ngay khi một cột mới xuất hiện ở
 *    `drizzle/schema/auth.ts` mà không được phân loại ở đây; `publicUser.test.ts` canh chiều còn
 *    lại (mục ma) bằng `getTableColumns(userSecrets)` — nguồn sự thật DUY NHẤT, không chép tay.
 * ⚠ Khi thêm cột mới: **mặc định phải là `"server-only"`**. Bảng này tồn tại **chỉ để** giữ bí mật;
 *   một cột `"public"` ở đây phải là một quyết định được nói ra, không phải một lượt trôi.
 */
export const USER_SECRETS_FIELD_VISIBILITY = {
  /** `users.id` — đã công khai ở bảng kia; đây chỉ là khoá 1:1. */
  userId: "public",
  /** 🔴 bcrypt PHC. */
  passwordHash: "server-only",
  /** 🔴🔴 HẠT GIỐNG TOTP — ai đọc được thì tự sinh mã hợp lệ **mãi mãi**. */
  twoFactorSecret: "server-only",
  /** Một dấu thời gian — không mang bí mật. */
  updatedAt: "public",
} as const satisfies Record<keyof UserSecrets, UserFieldVisibility>;

type VisibilityBiMat = typeof USER_SECRETS_FIELD_VISIBILITY;

/** Tên cột của `user_secrets` **KHÔNG BAO GIỜ** được rời máy chủ. */
export type ServerOnlyUserSecretField = {
  [K in keyof VisibilityBiMat]: VisibilityBiMat[K] extends "server-only" ? K : never;
}[keyof VisibilityBiMat];

/** Mọi cột bí mật — **suy ra** từ phân loại, không viết tay lần hai. */
export const SERVER_ONLY_USER_SECRET_FIELDS = (
  Object.keys(USER_SECRETS_FIELD_VISIBILITY) as (keyof VisibilityBiMat)[]
).filter((k) => USER_SECRETS_FIELD_VISIBILITY[k] === "server-only") as readonly ServerOnlyUserSecretField[];

/**
 * ★★★★ **CỔNG KIỂU** — *"nhét một ô bí mật của `user_secrets` vào một giá trị trả về là **LỖI BIÊN
 * DỊCH**"*, đúng câu Task 7 hứa, nay neo vào **đúng bảng**.
 *
 * ⚠⚠ Phần giao `{ [K in ServerOnlyUserSecretField]?: never }` là **cả điểm mấu chốt**: một hình
 *    dạng có `twoFactorSecret: string | null` **KHÔNG gán được** vào `KhongMangBiMat<…>`. Nó
 *    **SUY RA** từ `USER_SECRETS_FIELD_VISIBILITY`, nên một cột bí mật **thứ BA** thêm vào
 *    `user_secrets` ngày mai **tự vào cổng** — không cần ai nhớ sửa file này.
 * ⚠ Dùng ở **mọi thủ tục đọc `user_secrets` rồi trả về một hình dạng cho client**. Lượng từ *"ai
 *   phải mang cổng này"* được cưỡng chế ở `server/routers/userExposureScan.test.ts` (trục BỀ MẶT),
 *   nên cổng kiểu và bộ quét bề mặt đóng **hai nửa khác nhau** của cùng một bất biến:
 *     · cổng KIỂU  — bắt lúc **biên dịch**, kể cả ở file chưa tồn tại, nhưng **chỉ nơi được khai**;
 *     · bộ quét   — bắt **mọi nơi** theo cấu tạo, nhưng lúc **chạy lưới**.
 */
export type KhongMangBiMat<T> = T & { [K in ServerOnlyUserSecretField]?: never };

/** Tập cột **thật** của `user_secrets`, đọc từ drizzle — canh lượng từ hai chiều ở `publicUser.test.ts`. */
export function moiCotCuaBangUserSecrets(): string[] {
  return Object.keys(getTableColumns(userSecrets)).sort();
}

/**
 * Tập cột **BÍ MẬT** của `user_secrets` — nay **suy ra từ chính phân loại ở trên**, không từ một
 * danh sách "hai cột hạ tầng" thứ hai.
 *
 * ⚠⚠ Trước C-2 hàm này lấy **phần bù** của `["userId","updatedAt"]` viết tay. Hai nguồn sự thật cho
 *    cùng một khái niệm là chỗ luật trôi đi (lớp *"nhiều chủ cho một bất biến"* đã đẻ **ba**
 *    Critical). Nay **một** chủ: `USER_SECRETS_FIELD_VISIBILITY`. Ô ∀-A/∀-B ở `publicUser.test.ts`
 *    giữ cho chủ ấy không lệch khỏi schema.
 */
export function moiCotBiMatCuaUserSecrets(): string[] {
  return [...SERVER_ONLY_USER_SECRET_FIELDS].sort();
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ Pha 7 Task 9 (9b) / QĐ-1 — **Ô SUY RA, KHÔNG PHẢI CỘT ĐƯỢC MỞ.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Hai mốc mà vị từ *"phải đổi mật khẩu"* được suy ra từ đó. */
export type MocMatKhau = {
  passwordChangedAt: Date | null;
  passwordInvalidBefore: Date | null;
};

/**
 * ★★★ **VỊ TỪ DUY NHẤT** của *"tài khoản này phải đổi mật khẩu ở lượt đăng nhập tới"*.
 *
 *   PHẢI_ĐỔI  <=>  passwordInvalidBefore ≠ NULL
 *                  ∧ (passwordChangedAt = NULL ∨ passwordChangedAt ≤ passwordInvalidBefore)
 *
 * Ba giá trị, cùng kỷ luật `TrangThaiTienTrinh`:
 *   · `passwordInvalidBefore = NULL` → **CHƯA TỪNG thu hồi** ⇒ không buộc ai (mặc định trung tính);
 *   · `passwordChangedAt = NULL` → **KHÔNG BIẾT** mật khẩu đặt lúc nào. Với một lượt thu hồi đang
 *     hiệu lực, người đọc **PHẢI** coi là phải đổi — hỏng theo chiều **ĐÓNG**, không mở cửa.
 *
 * ⚠⚠ **ĐỪNG gọi hàm này với `ctx.user`.** `redactServerOnlyUserFields()` làm **rỗng** hai mốc ấy
 *    trên `ctx.user` (chúng là `"server-only"`), nên suy ra từ đó sẽ luôn cho `false` — một lời
 *    nói dối **im lặng theo chiều MỞ**. Nguồn đúng là một lượt đọc DB **mới**
 *    (`db.layMocMatKhau`). Có ca riêng canh đúng chuyện này ở
 *    `server/routers/mustChangePassword.test.ts` (§4).
 */
export function suyRaPhaiDoiMatKhau(moc: MocMatKhau): boolean {
  const thuHoi = moc.passwordInvalidBefore;
  if (thuHoi == null) return false;
  const doiLuc = moc.passwordChangedAt;
  if (doiLuc == null) return true;
  return doiLuc.getTime() <= thuHoi.getTime();
}

/** Hình dạng `auth.me` trả về: `PublicUser` **cộng đúng một ô SUY RA**. */
export type MeUser = PublicUser & { mustChangePassword: boolean };
