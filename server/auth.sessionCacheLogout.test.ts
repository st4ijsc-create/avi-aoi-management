/**
 * W4-B (doc 27 B4) — auth.logout must evict the session's short-TTL auth
 * cache entry (via ctx.sessionToken) so a captured cookie cannot keep
 * riding the cache after logout.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";
import {
  clearAuthSessionCache,
  getCachedAuthUser,
  setCachedAuthUser,
} from "./services/authSessionCache";

const SESSION_TOKEN = "logout-test-session-token";

function makeUser(): User {
  return {
    id: 21,
    openId: "open-21",
    username: "user21",
    name: "Logout Test",
    email: "u21@example.com",
    phone: null,
    department: null,
    position: null,
    loginMethod: "local",
    role: "user",
    isActive: true,
    twoFactorEnabled: false,
    loginAttempts: 0,
    lockedUntil: null,
    // ★ Pha 7 Task 9 (9b) — hai mốc "buộc đổi mật khẩu"; `passwordHash`/`twoFactorSecret` đã rời
    //   bảng `users` sang `user_secrets` (9c).
    passwordChangedAt: null,
    passwordInvalidBefore: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  } as User;
}

function makeCtx(user: User): TrpcContext {
  return {
    user,
    sessionToken: SESSION_TOKEN,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as unknown as TrpcContext["res"],
  };
}

describe("auth.logout auth-cache invalidation (B4)", () => {
  beforeEach(async () => {
    process.env.AUTH_CACHE_TTL_S = "60";
    await clearAuthSessionCache();
  });

  it("evicts the cached session-user entry on logout", async () => {
    const user = makeUser();
    await setCachedAuthUser(SESSION_TOKEN, user);
    expect(await getCachedAuthUser(SESSION_TOKEN)).not.toBeNull();

    const caller = appRouter.createCaller(makeCtx(user));
    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(await getCachedAuthUser(SESSION_TOKEN)).toBeNull();
  });

  it("logout without a session token still succeeds (public procedure)", async () => {
    const ctx = makeCtx(makeUser());
    ctx.sessionToken = null;
    const caller = appRouter.createCaller(ctx);
    await expect(caller.auth.logout()).resolves.toEqual({ success: true });
  });
});
