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
import { users, type User } from "../../drizzle/schema";

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
  /** 🔴 **BÍ MẬT** — bcrypt hash. Rò ra ⇒ bẻ khoá **ngoại tuyến**, không còn rate-limit. */
  passwordHash: "server-only",
  name: "public",
  email: "public",
  phone: "public",
  department: "public",
  position: "public",
  loginMethod: "public",
  role: "public",
  isActive: "public",
  /** 🔴🔴 **BÍ MẬT** — HẠT GIỐNG TOTP. Rò ra ⇒ tự sinh mã hợp lệ vĩnh viễn ⇒ 2FA toàn hệ vô hiệu. */
  twoFactorSecret: "server-only",
  twoFactorEnabled: "public",
  loginAttempts: "public",
  lockedUntil: "public",
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
