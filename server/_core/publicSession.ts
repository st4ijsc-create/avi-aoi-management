/**
 * ★★★ Pha 8 Task 5 — **PHÉP CHIẾU DUY NHẤT để một hàng `user_sessions` rời máy chủ.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI (đo được, không suy đoán)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Repo có **hai tuyến song song** liệt kê phiên đăng nhập của chính người dùng:
 *   · `session.list`      (`server/routers/sessionRouter.ts`)  — chiếu **tường minh** 10 cột,
 *                                                                **không** có `sessionToken`;
 *   · `user.getSessions`  (`server/routers/userRouters.ts`)    — `return db.getUserSessions(id)`,
 *                                                                tức **NGUYÊN HÀNG**.
 * `db.getUserSessions` là `db.select().from(userSessions)` — **không phép chiếu** ⇒ mọi cột ra,
 * **kể cả `sessionToken`**, cột dùng làm khoá tra cứu phiên ở `db.getSessionByToken` và là thứ
 * `_core/sdk.ts` đọc cookie ra để dựng danh tính. Tuyến ấy **đang được client gọi thật**
 * (`client/src/pages/SessionManagement.tsx:63`) ⇒ token của **mọi phiên đang sống** của người dùng
 * bay xuống trình duyệt mỗi lần mở màn "Quản lý phiên". Bất kỳ ai đọc được response ấy (XSS, add-on,
 * log, ảnh chụp DevTools) **chiếm được mọi thiết bị**, không chỉ thiết bị hiện tại.
 *
 * ⚠ Đây là **cặp song song thứ TƯ** — cặp mà phép đếm tay ở `server/_core/totpOnce.ts:20-24` không
 *   thể sót, vì nó **không thuộc trục TOTP**. Nó chỉ lộ ra khi lượng từ được đảo: *"∀ đơn vị xử lý
 *   trả kết quả một phép đọc THÔ trên bảng tài nguyên xác thực"* (`hoTuyenSongSong.test.ts` §4).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ ALLOW-LIST, KHÔNG PHẢI DENY-LIST — cùng khuôn và cùng lý do với `publicUser.ts`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `Record<keyof UserSession, …>` khiến **TypeScript** đỏ ngay khi một cột mới xuất hiện ở
 * `drizzle/schema/auth.ts` mà chưa được phân loại. Và vì phép chiếu **CHỌN** chứ không **XOÁ**, một
 * cột nhạy cảm **thứ hai** thêm vào `user_sessions` ngày mai **không ra được** qua đường này — kể cả
 * trước khi ai kịp phân loại nó.
 */
import type { UserSession } from "../../drizzle/schema";

export type SessionFieldVisibility = "public" | "server-only";

export const USER_SESSION_FIELD_VISIBILITY = {
  id: "public",
  /** Đã biết: chính là người gọi. Không cần rời máy chủ, và không có ích cho client. */
  userId: "server-only",
  /** 🔴🔴 **KHOÁ PHIÊN.** Ai đọc được thì **là** người dùng ấy, trên mọi thiết bị. */
  sessionToken: "server-only",
  deviceName: "public",
  deviceType: "public",
  browser: "public",
  os: "public",
  ipAddress: "public",
  location: "public",
  /** Cờ nội bộ: `getUserSessions` **đã lọc** `isActive = true`, nên nó không mang tin gì thêm. */
  isActive: "server-only",
  lastActivityAt: "public",
  expiresAt: "public",
  createdAt: "public",
} as const satisfies Record<keyof UserSession, SessionFieldVisibility>;

type Vis = typeof USER_SESSION_FIELD_VISIBILITY;

/** Cột được phép rời máy chủ. */
export type PublicSessionField = {
  [K in keyof Vis]: Vis[K] extends "public" ? K : never;
}[keyof Vis];

/** Cột **KHÔNG BAO GIỜ** được rời máy chủ. */
export type ServerOnlySessionField = {
  [K in keyof Vis]: Vis[K] extends "server-only" ? K : never;
}[keyof Vis];

/**
 * ★★★ Hình dạng phiên **được phép** ra ngoài.
 * ⚠ Phần giao `{ [K in ServerOnlySessionField]?: never }` khiến một giá trị mang `sessionToken`
 *   **KHÔNG gán được** vào kiểu này ⇒ bản vá không dựa vào việc người sau *nhớ* gọi phép chiếu.
 */
export type PublicSession = Pick<UserSession, PublicSessionField> & {
  [K in ServerOnlySessionField]?: never;
} & { isCurrent?: boolean };

/** Mọi cột được phép ra ngoài — **suy ra** từ phân loại, không viết tay lần hai. */
export const PUBLIC_SESSION_FIELDS = (
  Object.keys(USER_SESSION_FIELD_VISIBILITY) as (keyof Vis)[]
).filter((k) => USER_SESSION_FIELD_VISIBILITY[k] === "public") as readonly PublicSessionField[];

/** Mọi cột **chỉ ở máy chủ** — suy ra từ phân loại. */
export const SERVER_ONLY_SESSION_FIELDS = (
  Object.keys(USER_SESSION_FIELD_VISIBILITY) as (keyof Vis)[]
).filter((k) => USER_SESSION_FIELD_VISIBILITY[k] === "server-only") as readonly ServerOnlySessionField[];

/**
 * ★★★ **CHỦ DUY NHẤT** của phép chiếu. `isCurrent` là ô **SUY RA** (so `sessionToken` **ở máy
 * chủ**), đúng khuôn `mustChangePassword`/`hasSecret`: client biết *"phiên nào là phiên này"* mà
 * **không** cần thấy token.
 */
export function toPublicSession(row: UserSession, tokenHienTai?: string | null): PublicSession {
  const ra = {} as Record<string, unknown>;
  for (const k of PUBLIC_SESSION_FIELDS) ra[k] = row[k];
  ra.isCurrent = !!tokenHienTai && row.sessionToken === tokenHienTai;
  return ra as PublicSession;
}

export function toPublicSessions(rows: readonly UserSession[], tokenHienTai?: string | null): PublicSession[] {
  return rows.map((r) => toPublicSession(r, tokenHienTai));
}
