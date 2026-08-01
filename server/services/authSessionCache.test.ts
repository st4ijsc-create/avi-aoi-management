/**
 * W4-B (doc 27 B4) — unit tests for the short-TTL session→user auth cache.
 * REDIS_URL is not set under vitest, so the facade runs L1-only (the
 * in-process LRU fallback) — deterministic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../../drizzle/schema";
import {
  clearAuthSessionCache,
  getAuthCacheStats,
  getAuthCacheTtlMs,
  getCachedAuthUser,
  invalidateAuthSession,
  invalidateAuthUser,
  resetAuthCacheStats,
  setCachedAuthUser,
} from "./authSessionCache";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 7,
    openId: "open-7",
    username: "user7",
    passwordHash: "$2a$10$secret-hash",
    name: "User Seven",
    email: "u7@example.com",
    phone: null,
    department: null,
    position: null,
    loginMethod: "local",
    role: "operator",
    isActive: true,
    twoFactorSecret: "TOTPSECRET",
    twoFactorEnabled: false,
    loginAttempts: 0,
    lockedUntil: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    lastSignedIn: new Date("2026-07-01T03:04:05Z"),
    ...overrides,
  } as User;
}

const TOKEN = "jwt.session.token-abc";

describe("authSessionCache", () => {
  beforeEach(async () => {
    process.env.AUTH_CACHE_TTL_S = "60";
    await clearAuthSessionCache();
    resetAuthCacheStats();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AUTH_CACHE_TTL_S;
  });

  it("misses when empty, hits after set, preserves Date fields, strips secrets", async () => {
    expect(await getCachedAuthUser(TOKEN)).toBeNull();

    const user = makeUser();
    await setCachedAuthUser(TOKEN, user);
    const cached = await getCachedAuthUser(TOKEN);

    expect(cached).not.toBeNull();
    expect(cached!.id).toBe(7);
    expect(cached!.role).toBe("operator");
    // superjson keeps Date instances across the tier round-trip
    expect(cached!.lastSignedIn).toBeInstanceOf(Date);
    expect(cached!.lastSignedIn.toISOString()).toBe("2026-07-01T03:04:05.000Z");
    // secrets must never be cached (Redis tier would persist them)
    expect(cached!.passwordHash).toBeNull();
    expect(cached!.twoFactorSecret).toBeNull();

    const stats = getAuthCacheStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.enabled).toBe(true);
  });

  it("expires after the TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T08:00:00Z"));
    await setCachedAuthUser(TOKEN, makeUser());
    expect(await getCachedAuthUser(TOKEN)).not.toBeNull();

    vi.setSystemTime(new Date("2026-07-04T08:01:01Z")); // 61s > TTL 60s
    expect(await getCachedAuthUser(TOKEN)).toBeNull();
  });

  it("AUTH_CACHE_TTL_S=0 disables the cache; values are clamped to 300s", async () => {
    process.env.AUTH_CACHE_TTL_S = "0";
    expect(getAuthCacheTtlMs()).toBe(0);
    await setCachedAuthUser(TOKEN, makeUser());
    expect(await getCachedAuthUser(TOKEN)).toBeNull();
    expect(getAuthCacheStats().enabled).toBe(false);

    process.env.AUTH_CACHE_TTL_S = "9999";
    expect(getAuthCacheTtlMs()).toBe(300_000);

    process.env.AUTH_CACHE_TTL_S = "not-a-number";
    expect(getAuthCacheTtlMs()).toBe(45_000); // default
  });

  it("invalidateAuthSession evicts exactly that session", async () => {
    await setCachedAuthUser(TOKEN, makeUser());
    await setCachedAuthUser("other-token", makeUser({ id: 8, openId: "open-8" }));

    await invalidateAuthSession(TOKEN);

    expect(await getCachedAuthUser(TOKEN)).toBeNull();
    expect(await getCachedAuthUser("other-token")).not.toBeNull();
  });

  it("invalidateAuthUser(userId) evicts every session of that user (role change / ban)", async () => {
    const user = makeUser();
    await setCachedAuthUser("session-a", user);
    await setCachedAuthUser("session-b", user);
    await setCachedAuthUser("session-c", makeUser({ id: 9, openId: "open-9" }));

    await invalidateAuthUser(7);

    expect(await getCachedAuthUser("session-a")).toBeNull();
    expect(await getCachedAuthUser("session-b")).toBeNull();
    expect(await getCachedAuthUser("session-c")).not.toBeNull();
    expect(getAuthCacheStats().invalidations).toBe(2);
  });

  it("invalidateAuthUser by openId works (upsertUser profile-change path)", async () => {
    await setCachedAuthUser("session-a", makeUser());
    await invalidateAuthUser(undefined, "open-7");
    expect(await getCachedAuthUser("session-a")).toBeNull();
  });
});
