import { randomBytes } from "node:crypto";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Request, Response } from "express";
import * as db from "../db";
import type { User } from "../../drizzle/schema";
import { getSessionCookieOptions } from "./cookies";
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
 * Hash giả dùng làm đối số cho bcrypt.compare() khi user không tồn tại (hoặc
 * không có passwordHash, vd. tài khoản chỉ đăng nhập SSO) — để bcrypt.compare
 * vẫn tốn đúng khoảng thời gian CPU như so với một hash thật, đóng side-
 * channel thời gian (F9). Tính MỘT LẦN, nhớ lại (memo hoá theo module, sống
 * suốt vòng đời process) rồi dùng lại cho mọi lần gọi sau — plaintext nguồn
 * không quan trọng (không bao giờ so khớp với gì thật), chỉ cost factor mới
 * quan trọng.
 */
let dummyPasswordHashPromise: Promise<string> | null = null;
function getDummyPasswordHash(bcryptModule: typeof import("bcryptjs")): Promise<string> {
  if (!dummyPasswordHashPromise) {
    dummyPasswordHashPromise = bcryptModule.hash(
      randomBytes(32).toString("hex"),
      PASSWORD_HASH_COST_FACTOR,
    );
  }
  return dummyPasswordHashPromise;
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
  // giả (cost factor khớp hash thật — xem getDummyPasswordHash) khi user
  // không tồn tại hoặc không có passwordHash. Trước đây nhánh "user không
  // tồn tại" bỏ qua bcrypt HOÀN TOÀN nên trả lời nhanh hơn hẳn các nhánh
  // khác ⇒ chỉ cần đo thời gian phản hồi là dò được username có thật. Kết
  // quả `passwordMatches` được dùng THẬT cho nhánh user tồn tại + có hash;
  // bị bỏ qua có chủ đích ở các nhánh throw sớm bên dưới (không đổi logic
  // chặn — chỉ để bcrypt luôn tốn đúng thời gian, bất kể nhánh nào sẽ chạy
  // sau đó). Thứ tự các nhánh throw bên dưới GIỮ NGUYÊN như trước khi sửa
  // (không tồn tại → vô hiệu hoá → đang khoá → không hỗ trợ mật khẩu → sai
  // mật khẩu) — chỉ có lời gọi bcrypt.compare là được đưa lên đầu.
  const passwordMatches = await bcrypt.compare(
    password,
    user?.passwordHash ?? (await getDummyPasswordHash(bcrypt)),
  );

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

  if (!user.passwordHash) {
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

  return user;
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
  await db
    .createUserSession({
      userId: user.id,
      sessionToken,
      ipAddress: audit.ipAddress ?? undefined,
      // Minimal device hint; richer UA parsing can be layered in later.
      deviceName: audit.userAgent ?? undefined,
      expiresAt: new Date(Date.now() + ONE_YEAR_MS),
    })
    .catch(() => {
      /* never block login on session bookkeeping */
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
