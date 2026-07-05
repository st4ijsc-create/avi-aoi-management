/**
 * W4-B (doc 27 B4) — proves the auth-cache invalidation hooks are actually
 * WIRED into the db/auth mutation sites (role change, ban via updateUser,
 * password change, 2FA, session revocation, profile upsert) using a stubbed
 * drizzle connection — no real DB needed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const stub = vi.hoisted(() => {
  const db = {
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: async () => undefined,
        returning: async () => [{ id: 1 }],
      }),
    }),
    delete: () => ({ where: async () => undefined }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  };
  return { getDb: vi.fn(async () => db), getJobsDb: vi.fn(async () => db) };
});

vi.mock("./connection", () => stub);

import {
  disable2FA,
  enable2FA,
  revokeAllSessions,
  revokeSession,
  updateUser,
  updateUserPassword,
  updateUserRole,
  upsertUser,
} from "./auth";
import type { User } from "../../drizzle/schema";
import {
  clearAuthSessionCache,
  getCachedAuthUser,
  setCachedAuthUser,
} from "../services/authSessionCache";

const USER = {
  id: 5,
  openId: "open-5",
  username: "u5",
  passwordHash: null,
  name: "Hook Test",
  email: null,
  phone: null,
  department: null,
  position: null,
  loginMethod: "local",
  role: "supervisor",
  isActive: true,
  twoFactorSecret: null,
  twoFactorEnabled: true,
  loginAttempts: 0,
  lockedUntil: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
} as User;

async function seedSessions(): Promise<void> {
  await setCachedAuthUser("sess-1", USER);
  await setCachedAuthUser("sess-2", USER);
}

async function bothCached(): Promise<boolean> {
  return (await getCachedAuthUser("sess-1")) !== null && (await getCachedAuthUser("sess-2")) !== null;
}

async function bothEvicted(): Promise<boolean> {
  return (await getCachedAuthUser("sess-1")) === null && (await getCachedAuthUser("sess-2")) === null;
}

describe("db/auth mutation hooks evict the auth session cache", () => {
  beforeEach(async () => {
    process.env.AUTH_CACHE_TTL_S = "60";
    await clearAuthSessionCache();
    await seedSessions();
    expect(await bothCached()).toBe(true);
  });

  it("updateUserRole", async () => {
    await updateUserRole(5, "viewer");
    expect(await bothEvicted()).toBe(true);
  });

  it("updateUser (ban path: isActive=false)", async () => {
    await updateUser(5, { isActive: false });
    expect(await bothEvicted()).toBe(true);
  });

  it("updateUserPassword", async () => {
    await updateUserPassword(5, "$2a$10$new");
    expect(await bothEvicted()).toBe(true);
  });

  it("enable2FA / disable2FA", async () => {
    await enable2FA(5);
    expect(await bothEvicted()).toBe(true);
    await seedSessions();
    await disable2FA(5);
    expect(await bothEvicted()).toBe(true);
  });

  it("revokeSession / revokeAllSessions", async () => {
    await revokeSession(99, 5);
    expect(await bothEvicted()).toBe(true);
    await seedSessions();
    await revokeAllSessions(5);
    expect(await bothEvicted()).toBe(true);
  });

  it("upsertUser with ONLY lastSignedIn (the per-request touch) does NOT evict", async () => {
    await upsertUser({ openId: "open-5", lastSignedIn: new Date() });
    expect(await bothCached()).toBe(true);
  });

  it("upsertUser with profile fields (OAuth sync / admin edit) evicts by openId", async () => {
    await upsertUser({ openId: "open-5", name: "Renamed" });
    expect(await bothEvicted()).toBe(true);
  });
});
