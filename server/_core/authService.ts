import { randomBytes } from "node:crypto";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Request, Response } from "express";
import * as db from "../db";
import type { User } from "../../drizzle/schema";
import { getSessionCookieOptions } from "./cookies";
// ★★★ Pha 7 Task 7 — chủ DUY NHẤT của "cột nào của `users` được rời máy chủ".
import { redactServerOnlyUserFields } from "./publicUser";
import { sdk } from "./sdk";

/**
 * Single source of truth for the local-login security controls.
 *
 * Audit A bug #1: the UI calls tRPC `auth.login`, but the brute-force lockout
 * and login audit logging used to live ONLY in the (unused) Express
 * `/api/auth/login` route — so those controls never ran in practice. This
 * module centralises them so BOTH the tRPC login procedure and the Express
 * `/api/auth/verify-2fa` completion path enforce identical behaviour.
 *
 * Controls (IEC 62443-2-1 CL2 §CR 1.8 / §CR 1.6):
 *  - failed-attempt counting (users.loginAttempts)
 *  - lockout window after MAX_ATTEMPTS (users.lockedUntil)
 *  - audit log entry on every login success AND failure
 *  - a server-side user_sessions row keyed by the session JWT (so session
 *    list / isCurrent / revokeAll work — see context.ts ctx.sessionToken)
 */

export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

export class LoginError extends Error {
  constructor(
    public readonly code:
      | "INVALID_CREDENTIALS"
      | "ACCOUNT_DISABLED"
      | "PASSWORD_UNSUPPORTED"
      | "ACCOUNT_LOCKED",
    message: string,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LoginError";
  }
}

type AuditCtx = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

function auditCtxFromRequest(req: Request): AuditCtx {
  return {
    ipAddress: req.ip ?? req.socket?.remoteAddress ?? null,
    userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
  };
}

/**
 * F9 (Sprint 5, doc71 task 11) — cost factor bcrypt "rounds" MUST match every
 * real password hash in this app, hoặc thủ thuật hash-giả bên dưới chỉ THU
 * HẸP side-channel thời gian thay vì đóng hẳn. Đo bằng grep — MỌI lời gọi
 * `bcrypt.hash(..., N)` trong repo đều dùng N=10: server/db/auth.ts:228,
 * server/routers/userRouters.ts:59/128/206,
 * server/routers/twoFactorRouter.ts:20, server/services/mqttService.ts:337.
 * Không hardcode một chuỗi bcrypt có sẵn — sinh ra tại runtime bằng đúng cost
 * factor thật này (xem getDummyPasswordHash).
 */
const PASSWORD_HASH_COST_FACTOR = 10;

/**
 * Định dạng một bcrypt hash HỢP LỆ: `$2a$`/`$2b$`/`$2y$` + 2 chữ số cost +
 * `$` + 53 ký tự radix64 (22 salt + 31 hash) — tổng 60 ký tự. Dùng để phân
 * biệt hash thật với các chuỗi KHÔNG PHẢI bcrypt nhưng vẫn được lưu (truthy)
 * trong cột `passwordHash`, ví dụ sentinel `"LOCKED-no-valid-hash"` mà
 * `scripts/audit/audit-account.mjs off` ghi để khoá tài khoản audit (2 dòng
 * thật trong DB dev tại thời điểm review — xem task-11-report.md vòng sửa 2).
 */
const BCRYPT_HASH_FORMAT = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

function isBcryptHash(hash: unknown): hash is string {
  return typeof hash === "string" && BCRYPT_HASH_FORMAT.test(hash);
}

/**
 * Hash giả dùng làm đối số cho bcrypt.compare() khi user không tồn tại,
 * không có passwordHash, HOẶC passwordHash lưu trong DB không đúng định
 * dạng bcrypt (vd. sentinel "LOCKED-no-valid-hash" ở trên) — để
 * bcrypt.compare vẫn tốn đúng khoảng thời gian CPU như so với một hash
 * thật, đóng side-channel thời gian (F9). bcryptjs KIỂM ĐỊNH DẠNG hash
 * TRƯỚC khi chạy các vòng Blowfish thật — đưa thẳng một chuỗi dị dạng vào
 * bcrypt.compare() trả về `false` gần như tức thì (đo được ~0.1-0.7ms so
 * với ~50ms của một hash hợp lệ cost=10 — xem task-11-report.md), nên
 * KHÔNG được coi "passwordHash có giá trị (truthy)" là đủ điều kiện dùng
 * làm hash thật; phải qua `isBcryptHash()` trước.
 *
 * Tính MỘT LẦN — sinh sẵn NGAY KHI NẠP MODULE (không đợi request đầu tiên,
 * tránh request đầu tiên của mỗi lần khởi động lại process tốn gấp đôi thời
 * gian: sinh hash + compare, thay vì chỉ compare) — nhớ lại (memo hoá theo
 * module, sống suốt vòng đời process) rồi dùng lại cho mọi lần gọi sau.
 * Plaintext nguồn không quan trọng (không bao giờ so khớp với gì thật), chỉ
 * cost factor mới quan trọng.
 */
const dummyPasswordHashPromise: Promise<string> = (async () => {
  const bcryptModule = await import("bcryptjs");
  return bcryptModule.hash(randomBytes(32).toString("hex"), PASSWORD_HASH_COST_FACTOR);
})();
// Gắn một handler rỗng để Node không in "Unhandled Promise Rejection" nếu
// bcryptjs lỗi ngay lúc nạp module mà chưa có request nào await tới —  lỗi
// thật (cực khó xảy ra vì bcryptjs đã là dependency runtime dùng khắp nơi)
// vẫn nổi lên bình thường ở lần đầu ai đó thật sự await promise này.
dummyPasswordHashPromise.catch(() => {});

function getDummyPasswordHash(): Promise<string> {
  return dummyPasswordHashPromise;
}

/**
 * So khớp mật khẩu với hash lưu trong DB theo kiểu CHỐNG side-channel thời
 * gian (F9): nếu `storedHash` không phải chuỗi bcrypt ĐÚNG ĐỊNH DẠNG (falsy,
 * hoặc dị dạng như sentinel khoá tài khoản ở trên), dùng hash giả cùng cost
 * factor thay thế — để bcrypt.compare LUÔN chạy đủ số vòng, bất kể nhánh
 * nào sẽ chạy tiếp theo sau khi biết kết quả.
 *
 * DÙNG CHUNG cho mọi route xác thực bằng mật khẩu cục bộ trong repo
 * (`verifyCredentials` bên dưới, và `/api/external/auth/login` ở
 * server/_core/index.ts) — CHỈ phần "so khớp mật khẩu" này được dùng
 * chung; audit log / thông điệp lỗi / hình dạng response / mã trạng thái
 * HTTP vẫn do TỪNG route tự quyết định (hai route đó khác nhau về phạm vi
 * session — cookie+user_sessions row vs Bearer token 30 ngày — và về việc
 * có gate 2FA hay không, nên KHÔNG hợp nhất toàn bộ luồng).
 */
export async function comparePasswordConstantTime(
  bcryptModule: typeof import("bcryptjs"),
  password: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  const hashToCompare = isBcryptHash(storedHash) ? storedHash : await getDummyPasswordHash();
  return bcryptModule.compare(password, hashToCompare);
}

async function recordAudit(
  status: "success" | "failure",
  user: Pick<User, "id" | "name"> | null,
  username: string,
  audit: AuditCtx,
  details?: Record<string, unknown>,
): Promise<void> {
  await db
    .createAuditLog({
      userId: user?.id ?? null,
      userName: user?.name ?? username,
      action: "login",
      entityType: "auth",
      status,
      details: details ?? null,
      ipAddress: audit.ipAddress ?? null,
      userAgent: audit.userAgent ?? null,
    })
    .catch(() => {
      /* auditing must never block the login */
    });
}

/**
 * Verify username + password, enforce brute-force lockout, and write the
 * appropriate audit entry. Throws LoginError on any failure (the caller maps
 * it to the right transport error). On success, returns the user row and
 * resets the lockout counter.
 *
 * Does NOT issue a cookie or check 2FA — that is the caller's responsibility
 * (the 2FA branch returns `requires2FA` before a session is created).
 */
export async function verifyCredentials(
  username: string,
  password: string,
  req: Request,
): Promise<User> {
  const audit = auditCtxFromRequest(req);
  const bcrypt = await import("bcryptjs");

  const user = await db.getUserByUsername(username);

  // F9 (side-channel đăng nhập, tiền tồn tại) — LUÔN chạy bcrypt.compare
  // TRƯỚC khi kiểm isActive/lockedUntil/tồn tại/hỗ trợ mật khẩu, dùng hash
  // giả (cost factor khớp hash thật, và khi passwordHash lưu trong DB không
  // đúng định dạng bcrypt — xem comparePasswordConstantTime) khi user không
  // tồn tại hoặc không có passwordHash HỢP LỆ. Trước đây nhánh "user không
  // tồn tại" bỏ qua bcrypt HOÀN TOÀN nên trả lời nhanh hơn hẳn các nhánh
  // khác ⇒ chỉ cần đo thời gian phản hồi là dò được username có thật. Kết
  // quả `passwordMatches` được dùng THẬT cho nhánh user tồn tại + có hash
  // hợp lệ; bị bỏ qua có chủ đích ở các nhánh throw sớm bên dưới (không đổi
  // logic chặn — chỉ để bcrypt luôn tốn đúng thời gian, bất kể nhánh nào sẽ
  // chạy sau đó). Thứ tự các nhánh throw bên dưới GIỮ NGUYÊN như trước khi
  // sửa (không tồn tại → vô hiệu hoá → đang khoá → không hỗ trợ mật khẩu →
  // sai mật khẩu) — chỉ có lời gọi bcrypt.compare là được đưa lên đầu.
  // ★★★ Pha 7 Task 9 (9c) — hash mật khẩu nay ở `user_secrets`, KHÔNG còn trên hàng `users`.
  // ⚠⚠ Lượt đọc này chạy **VÔ ĐIỀU KIỆN**, kể cả khi `user` là `undefined` (hàm nhận `null` và
  //    vẫn chạy một câu truy vấn hình dạng y hệt). Gọi nó **có điều kiện** sẽ làm nhánh "username
  //    không tồn tại" trả lời nhanh hơn đúng một lượt truy vấn ⇒ dựng lại chính side-channel F9
  //    mà đoạn dưới đây được viết ra để đóng.
  const biMat = await db.layBiMatNguoiDung(user?.id ?? null);
  const passwordMatches = await comparePasswordConstantTime(bcrypt, password, biMat.passwordHash);

  if (!user) {
    await recordAudit("failure", null, username, audit, { reason: "unknown_user" });
    throw new LoginError("INVALID_CREDENTIALS", "Tên đăng nhập hoặc mật khẩu không đúng");
  }

  if (!user.isActive) {
    await recordAudit("failure", user, username, audit, { reason: "account_disabled" });
    throw new LoginError("ACCOUNT_DISABLED", "Tài khoản đã bị vô hiệu hóa");
  }

  // Brute-force lockout check — vẫn chạy TRƯỚC khi dùng kết quả bcrypt: tài
  // khoản đang bị khoá bị từ chối dù mật khẩu vừa nhập ĐÚNG.
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const remaining = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    await recordAudit("failure", user, username, audit, { reason: "account_locked" });
    throw new LoginError(
      "ACCOUNT_LOCKED",
      `Tài khoản tạm khóa do đăng nhập sai nhiều lần. Thử lại sau ${remaining} phút.`,
      { remainingMinutes: remaining },
    );
  }

  if (!biMat.passwordHash) {
    await recordAudit("failure", user, username, audit, { reason: "password_unsupported" });
    throw new LoginError(
      "PASSWORD_UNSUPPORTED",
      "Tài khoản này không hỗ trợ đăng nhập bằng mật khẩu",
    );
  }

  if (!passwordMatches) {
    const newAttempts = (user.loginAttempts ?? 0) + 1;
    const lockedUntil =
      newAttempts >= MAX_LOGIN_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
        : null;
    await db.updateUserLoginAttempts(user.id, newAttempts, lockedUntil);
    await recordAudit("failure", user, username, audit, {
      reason: lockedUntil ? "account_locked" : `attempt_${newAttempts}`,
    });

    if (lockedUntil) {
      throw new LoginError(
        "ACCOUNT_LOCKED",
        `Đăng nhập sai ${MAX_LOGIN_ATTEMPTS} lần. Tài khoản bị khóa ${LOCKOUT_MINUTES} phút.`,
      );
    }
    throw new LoginError("INVALID_CREDENTIALS", "Tên đăng nhập hoặc mật khẩu không đúng", {
      attemptsRemaining: MAX_LOGIN_ATTEMPTS - newAttempts,
    });
  }

  // Reset lockout counter on successful password verification.
  if ((user.loginAttempts ?? 0) > 0 || user.lockedUntil) {
    await db.updateUserLoginAttempts(user.id, 0, null);
  }

  // ★★★ Pha 7 Task 7 — bí mật **KHÔNG ĐI XA HƠN CHỖ CẦN NÓ.** `user.passwordHash` đã được dùng
  // xong ngay phía trên (`comparePasswordConstantTime`); từ đây trở đi mọi người gọi chỉ cần
  // `id`/`openId`/`name`/`email`/`role` (đã đo: `db.get2FAStatus` nhận `user.id` · lượt cấp vé 2FA
  // nhận `user.id` · `establishSession` · `res.json({user:{id,name,email,role}})`).
  // ⚠ Chú thích này CỐ Ý không viết tên hàm cấp vé kèm dấu `(`: `sessionGrantScan.test.ts` §"∀
  //   đường `login` cấp vé" đếm chuỗi ấy bằng `src.includes(…)` trên **toàn văn file**, nên một
  //   lượt nhắc trong chú thích cũng bị tính là một NGƯỜI CẤP VÉ thứ tư (đã đo: ô ấy ĐỎ).
  return redactServerOnlyUserFields(user);
}

/**
 * ★★★ Pha 8 — **LỖI GHI SỔ PHIÊN KHÔNG CÒN VÔ HÌNH.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ TRƯỚC BẢN VÁ: `.catch(() => {})` — MỘT LƯỢT ĐĂNG NHẬP CÓ THỂ KHÔNG CÓ HÀNG PHIÊN NÀO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hàng `user_sessions` là thứ làm cho một phiên **thấy được** (`session.list`) và **thu hồi được**
 * (`session.revoke`). Khi lượt INSERT hỏng mà lỗi bị nuốt, lượt đăng nhập ấy vẫn **cấp cookie hợp
 * lệ** nhưng **không có hàng nào đại diện** ⇒ nó không hiện trong danh sách thiết bị, và *"đăng
 * xuất mọi thiết bị"* **không chạm tới nó**. Task 2 vừa biến `user_sessions` thành đường thu hồi
 * CHÍNH, nên đây là lỗ an ninh, không phải chuyện sổ sách.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO **GHI LOG + ĐẾM**, KHÔNG PHẢI **NÉM** — LỰA CHỌN GIỮ NGUYÊN, LÝ LẼ MẠNH HƠN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ném thẳng biến một lỗi DB thoáng qua thành **lượt đăng nhập thất bại** — một cổng fail-closed
 * chặn luôn cả đường thoát, đúng lớp lỗi đã deploy ra **nhà tù 4/4 tài khoản** ở Pha 7.
 *
 * ⚠⚠ **HAI NGUYÊN NHÂN ĐÃ BIẾT CỦA LƯỢT HỎNG NAY ĐỀU ĐÃ ĐÓNG** — và điều đó làm lựa chọn này
 *    **mạnh hơn**, không phải yếu đi:
 *   · **trần cột** — `sessionToken` từng là `varchar(255)` với đúng **22 ký tự** dư trên 276 hàng
 *     thật; dấu tiếng Việt là 2 byte UTF-8 mà base64 đếm BYTE, nên một cái tên 12 ký tự đã đủ vỡ.
 *     Mig `0317` đổi cột sang **`text`** ⇒ lớp lỗi `22001` **hết hẳn**, không còn trần để đoán.
 *   · **va chạm UNIQUE** — hai lượt đăng nhập trong cùng một giây từng sinh **cùng một JWT** ⇒
 *     `23505` ở lượt thứ hai. `sdk.signSession` nay gắn `jti` ngẫu nhiên 72 bit ⇒ va chạm còn lại
 *     là biến cố xác suất ~0.
 * ⇒ Nên **bất cứ lỗi nào còn lọt tới `catch` này đều là dấu hiệu của một thứ KHÁC HẲN** — mất kết
 *   nối, quyền bị thu, bảng đổi hình dạng. Đó đúng là loại tín hiệu **không được nuốt**, và cũng
 *   đúng là loại tín hiệu **không nên biến thành lượt đăng nhập hỏng** trước khi có người nhìn nó.
 * ⇒ Giữ **không im lặng mà cũng không chặn cửa**: đếm (`demLoiGhiSoPhien()` — đo được từ lưới,
 *   không phải một dòng log phải đọc bằng mắt) + `console.error` có ngữ cảnh.
 */
let soLoiGhiSoPhien = 0;

/** Số lượt ghi sổ phiên hỏng kể từ khi tiến trình chạy (hoặc từ lần đặt lại gần nhất). */
export function demLoiGhiSoPhien(): number {
  return soLoiGhiSoPhien;
}

/** Đặt lại bộ đếm — dành cho lưới, để mỗi ca đo trên một mốc sạch. */
export function datLaiDemLoiGhiSoPhien(): void {
  soLoiGhiSoPhien = 0;
}

/**
 * Ghi hàng `user_sessions` cho một lượt cấp phiên. **Không ném** (xem khối lý lẽ trên), nhưng
 * **không bao giờ im lặng**: hỏng thì bộ đếm nhích và một dòng `error` có ngữ cảnh được ghi.
 */
export async function ghiSoPhien(data: {
  userId: number;
  sessionToken: string;
  ipAddress?: string;
  deviceName?: string;
  expiresAt: Date;
}): Promise<number | null> {
  try {
    return await db.createUserSession(data);
  } catch (err) {
    soLoiGhiSoPhien++;
    console.error(
      "[Auth] GHI SỔ PHIÊN HỎNG — lượt đăng nhập này KHÔNG có hàng `user_sessions` của riêng nó, " +
        "nên nó VÔ HÌNH với `session.list` và NGOÀI TẦM `session.revoke`.",
      {
        userId: data.userId,
        doDaiToken: data.sessionToken.length, // ⚠ độ dài, KHÔNG phải token — token là khoá phiên.
        loi: err instanceof Error ? err.message : String(err),
      },
    );
    return null;
  }
}

/**
 * Complete a successful login: mark last-signed-in, mint a session JWT, persist
 * a user_sessions row (keyed by that JWT so it is discoverable / revocable),
 * set the cookie, and write the success audit entry.
 */
export async function establishSession(
  user: User,
  req: Request,
  res: Response,
  opts: { method?: "password" | "2fa" } = {},
): Promise<void> {
  const audit = auditCtxFromRequest(req);

  await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });

  const sessionToken = await sdk.createSessionToken(user.openId, {
    name: user.name || "",
    expiresInMs: ONE_YEAR_MS,
  });

  // Persist a server-side session record so it shows up in the session list
  // and can be individually revoked. Keyed by the JWT == ctx.sessionToken.
  await ghiSoPhien({
    userId: user.id,
    sessionToken,
    ipAddress: audit.ipAddress ?? undefined,
    // Minimal device hint; richer UA parsing can be layered in later.
    deviceName: audit.userAgent ?? undefined,
    expiresAt: new Date(Date.now() + ONE_YEAR_MS),
  });

  const cookieOptions = getSessionCookieOptions(req);
  res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

  // doc 44 G5.18 — anomalous-login detection (additive; ANOMALOUS_LOGIN_ENABLED,
  // default OFF → immediate no-op, zero added cost / bit-compat). Run BEFORE the
  // success audit row is written so the history baseline excludes THIS login (so a
  // new IP still reads as "new"). Best-effort: never throws / never blocks login.
  try {
    const { checkLoginAnomaly } = await import("../services/security/anomalousLoginDetector");
    await checkLoginAnomaly({
      userId: user.id,
      username: user.name ?? user.openId,
      ip: audit.ipAddress,
      userAgent: audit.userAgent,
      at: Date.now(),
    });
  } catch {
    /* anomalous-login detection must never block or break login */
  }

  await recordAudit("success", user, user.name ?? user.openId, audit, {
    method: opts.method ?? "password",
  });
}
