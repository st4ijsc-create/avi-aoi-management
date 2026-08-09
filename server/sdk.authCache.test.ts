/**
 * W4-B (doc 27 B4) — proves the session-user auth cache eliminates the
 * per-request DB traffic of authenticateRequest and that invalidation
 * restores the DB path.
 *
 * MEASUREMENT (asserted below): 5 authenticated requests with the SAME
 * session cookie
 *   - cache DISABLED (AUTH_CACHE_TTL_S=0): 15 DB calls
 *       (5× getUserByOpenId + 5× getSessionByToken + 5× upsertUser)
 *   - cache ENABLED  (TTL 60s):            3 DB calls (first request only)
 *   → 80% fewer DB round-trips at 5 requests; converges to ~100% of
 *     steady-state polling traffic within a TTL window.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { COOKIE_NAME } from "../shared/const";

const dbMocks = vi.hoisted(() => {
  // ENV is read at import time — set before any module loads.
  process.env.JWT_SECRET = "w4b-test-secret-0123456789abcdef0123456789abcdef";
  process.env.VITE_APP_ID = "w4b-test-app";
  process.env.AUTH_CACHE_TTL_S = "60";
  return {
    getUserByOpenId: vi.fn(),
    upsertUser: vi.fn(),
    getSessionByToken: vi.fn(),
    /**
     * ★ Pha 8 Task 1 — `authenticateRequest` nay cưỡng chế cổng buộc-đổi-mật-khẩu ở biên xác thực
     * (`chanNeuPhaiDoiMatKhau` → `db.phaiDoiMatKhau`). ⚠ Nó **KHÔNG** được cộng vào `dbCallCount()`
     * bên dưới: các ô của file này đo *"bộ nhớ đệm phiên tiết kiệm được bao nhiêu lượt DB của đường
     * phân giải danh tính"*, và phép chặn là một lượt đọc **CỐ Ý không cache** (cache nó = giữ
     * người vừa đổi mật khẩu trong nhà tù thêm một TTL). Gộp vào là làm hỏng đúng thứ đang được đo.
     */
    phaiDoiMatKhau: vi.fn(async () => false),
  };
});

vi.mock("./db", () => dbMocks);

import { sdk } from "./_core/sdk";
import {
  clearAuthSessionCache,
  getAuthCacheStats,
  invalidateAuthSession,
  resetAuthCacheStats,
} from "./services/authSessionCache";
import { SERVER_ONLY_USER_FIELDS } from "./_core/publicUser";

const USER_ROW = {
  id: 42,
  openId: "open-42",
  username: "user42",
  name: "Cache Test User",
  email: "u42@example.com",
  phone: null,
  department: null,
  position: null,
  loginMethod: "local",
  role: "operator",
  isActive: true,
  twoFactorEnabled: false,
  loginAttempts: 0,
  lockedUntil: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  lastSignedIn: new Date("2026-07-01T00:00:00Z"),
};

function reqWithCookie(token: string): Request {
  return {
    headers: { cookie: `${COOKIE_NAME}=${token}` },
  } as unknown as Request;
}

function dbCallCount(): number {
  return (
    dbMocks.getUserByOpenId.mock.calls.length +
    dbMocks.getSessionByToken.mock.calls.length +
    dbMocks.upsertUser.mock.calls.length
  );
}

describe("sdk.authenticateRequest session-user cache (B4)", () => {
  let token: string;

  beforeEach(async () => {
    process.env.AUTH_CACHE_TTL_S = "60";
    await clearAuthSessionCache();
    resetAuthCacheStats();
    vi.clearAllMocks();
    dbMocks.getUserByOpenId.mockResolvedValue({ ...USER_ROW });
    dbMocks.upsertUser.mockResolvedValue(undefined);
    dbMocks.getSessionByToken.mockResolvedValue(undefined); // no session row → JWT authoritative
    token = await sdk.createSessionToken("open-42", { name: "Cache Test User" });
  });

  it("BEFORE (cache disabled): every request pays 3 DB calls — 5 requests = 15", async () => {
    process.env.AUTH_CACHE_TTL_S = "0";
    for (let i = 0; i < 5; i++) {
      const user = await sdk.authenticateRequest(reqWithCookie(token));
      expect(user.id).toBe(42);
    }
    expect(dbMocks.getUserByOpenId).toHaveBeenCalledTimes(5);
    expect(dbMocks.getSessionByToken).toHaveBeenCalledTimes(5);
    expect(dbMocks.upsertUser).toHaveBeenCalledTimes(5);
    expect(dbCallCount()).toBe(15);
  });

  it("AFTER (cache enabled, TTL 60s): 5 requests = 3 DB calls (first only)", async () => {
    for (let i = 0; i < 5; i++) {
      const user = await sdk.authenticateRequest(reqWithCookie(token));
      expect(user.id).toBe(42);
      expect(user.role).toBe("operator");
    }
    expect(dbMocks.getUserByOpenId).toHaveBeenCalledTimes(1);
    expect(dbMocks.getSessionByToken).toHaveBeenCalledTimes(1);
    expect(dbMocks.upsertUser).toHaveBeenCalledTimes(1);
    expect(dbCallCount()).toBe(3);

    const stats = getAuthCacheStats();
    expect(stats.hits).toBe(4);
    expect(stats.misses).toBe(1);
  });

  it("cache hit returns the same user shape (Dates intact, secrets stripped)", async () => {
    const first = await sdk.authenticateRequest(reqWithCookie(token));
    const second = await sdk.authenticateRequest(reqWithCookie(token));
    expect(second.id).toBe(first.id);
    expect(second.openId).toBe(first.openId);
    expect(second.role).toBe(first.role);
    expect(second.twoFactorEnabled).toBe(first.twoFactorEnabled);
    expect(second.lastSignedIn).toBeInstanceOf(Date);
    // Pha 7 Task 9 / R1 — LUONG TU tren tap SUY RA, khong phai hai ten (hai ten ay da roi `users`).
    expect(SERVER_ONLY_USER_FIELDS.length).toBeGreaterThan(0);
    for (const k of SERVER_ONLY_USER_FIELDS) {
      expect((second as unknown as Record<string, unknown>)[k]).toBeNull();
    }
  });

  it("invalidation on logout: next request goes back to the DB", async () => {
    await sdk.authenticateRequest(reqWithCookie(token));
    await sdk.authenticateRequest(reqWithCookie(token));
    expect(dbMocks.getUserByOpenId).toHaveBeenCalledTimes(1);

    await invalidateAuthSession(token); // what auth.logout does with ctx.sessionToken

    await sdk.authenticateRequest(reqWithCookie(token));
    expect(dbMocks.getUserByOpenId).toHaveBeenCalledTimes(2);
    expect(dbMocks.getSessionByToken).toHaveBeenCalledTimes(2);
  });

  it("a REVOKED session row is rejected and never cached", async () => {
    dbMocks.getSessionByToken.mockResolvedValue({
      id: 1,
      userId: 42,
      sessionToken: token,
      isActive: false,
      expiresAt: null,
    });
    await expect(sdk.authenticateRequest(reqWithCookie(token))).rejects.toThrow(/revoked/i);
    // the failed auth must not have cached anything
    await expect(sdk.authenticateRequest(reqWithCookie(token))).rejects.toThrow(/revoked/i);
    expect(dbMocks.getSessionByToken).toHaveBeenCalledTimes(2);
  });

  it("different session cookies do not share cache entries", async () => {
    // different expiry → different JWT bytes → different cache key
    const otherToken = await sdk.createSessionToken("open-42", {
      name: "Cache Test User",
      expiresInMs: 12 * 60 * 60 * 1000,
    });
    await sdk.authenticateRequest(reqWithCookie(token));
    await sdk.authenticateRequest(reqWithCookie(otherToken));
    // both first-requests hit the DB (key = hash of the cookie, not the user)
    expect(dbMocks.getUserByOpenId).toHaveBeenCalledTimes(2);
  });
});
