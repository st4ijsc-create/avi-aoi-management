/**
 * Short-TTL session→user auth cache (W4-B, doc 27 gap B4).
 *
 * Problem: EVERY authenticated request (~110 polling endpoints) ran
 * `verifySession` + `db.getUserByOpenId` + `db.getSessionByToken` (revocation
 * check) + `db.upsertUser({lastSignedIn})` — i.e. 3 DB round-trips per
 * request, a constant read/write stream that dwarfs real work under
 * dashboard polling.
 *
 * Design:
 *  - KEY: `auth:session:<sha256(sessionCookie)>` — the session JWT is the
 *    canonical session identifier (== user_sessions.sessionToken); it is
 *    HASHED so the raw token never appears in cache keys/logs/Redis.
 *  - VALUE: the `users` row the auth layer returns as ctx.user, with the
 *    two secret columns (passwordHash, twoFactorSecret) stripped — every
 *    consumer of those re-reads them from the DB (verified: authService,
 *    userRouters change-password / 2FA flows use db.getUserById /
 *    db.get2FAStatus, never ctx.user). Serialized with superjson so Date
 *    fields survive the Redis tier round-trip intact.
 *  - TTL: AUTH_CACHE_TTL_S env (default 45s, clamped to 0..300; 0 disables).
 *  - TIERS: goes through the consolidated cacheService facade (L1 in-process
 *    LRU always; Redis L2 when REDIS_URL is set) — Part 2 / gap B8.
 *
 * INVALIDATION (explicit, at every mutation site that changes what auth
 * returns):
 *  - logout (routers.ts auth.logout)                    → by session token
 *  - user update / role change / ban (db/auth.updateUser,
 *    updateUserRole, updateUserPassword, deleteUser)    → by user id
 *  - 2FA enable/disable (db/auth.enable2FA/disable2FA)  → by user id
 *  - session revocation (db/auth.revokeSession/revokeAllSessions)
 *                                                       → by user id
 *  - profile-affecting upsert (db/auth.upsertUser when fields beyond
 *    lastSignedIn change)                               → by openId
 *
 * DOCUMENTED STALENESS WINDOW: a role revocation / ban / session revoke
 * takes effect immediately on the instance that performed it (explicit
 * invalidation, broadcast to other instances when Redis pub/sub is up) and
 * within ≤ AUTH_CACHE_TTL_S (≤60s) everywhere else — e.g. an instance that
 * cached the session but did not observe the broadcast. Accepted per doc 27
 * §8 B4 ("Cache user-by-session TTL 30–60s"). `lastSignedIn` is likewise
 * only persisted once per TTL window instead of per request.
 *
 * getAuthCacheStats() is exported for the system-health page (wired by
 * W4-A's cache-stats surface at acceptance).
 */

import { createHash } from "node:crypto";
import superjson from "superjson";
import type { User } from "../../drizzle/schema";
import { cacheService } from "./cacheService";

const KEY_PREFIX = "auth:session:";

/** Reverse index (in-process): user id / openId → cache keys we created. */
const keysByUserId = new Map<number, Set<string>>();
const keysByOpenId = new Map<string, Set<string>>();

const stats = {
  hits: 0,
  misses: 0,
  invalidations: 0,
};

/** TTL read per call so tests / operators can change it without restart. */
export function getAuthCacheTtlMs(): number {
  const raw = Number(process.env.AUTH_CACHE_TTL_S);
  const seconds = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 300) : 45;
  return seconds * 1000;
}

function keyFor(sessionToken: string): string {
  return KEY_PREFIX + createHash("sha256").update(sessionToken).digest("hex");
}

/** Cap per-user tracked session keys so the reverse index cannot grow
 * unboundedly over a long process lifetime (oldest hashes are forgotten —
 * their cache entries still expire via TTL). */
const MAX_TRACKED_KEYS_PER_USER = 32;

function addCapped(set: Set<string>, key: string): void {
  if (set.has(key)) return;
  if (set.size >= MAX_TRACKED_KEYS_PER_USER) {
    const oldest = set.values().next().value;
    if (oldest !== undefined) set.delete(oldest);
  }
  set.add(key);
}

function indexKey(user: Pick<User, "id" | "openId">, key: string): void {
  let byId = keysByUserId.get(user.id);
  if (!byId) keysByUserId.set(user.id, (byId = new Set()));
  addCapped(byId, key);
  let byOpen = keysByOpenId.get(user.openId);
  if (!byOpen) keysByOpenId.set(user.openId, (byOpen = new Set()));
  addCapped(byOpen, key);
}

/**
 * Look up the cached auth user for a session token. Returns null on miss,
 * expiry, disabled cache, or any cache-layer error (auth NEVER fails or
 * blocks because of the cache — it just falls back to the DB path).
 */
export async function getCachedAuthUser(sessionToken: string): Promise<User | null> {
  if (getAuthCacheTtlMs() <= 0) return null;
  try {
    const serialized = await cacheService.getAsync<string>(keyFor(sessionToken));
    if (typeof serialized === "string" && serialized.length > 0) {
      const user = superjson.parse<User>(serialized);
      stats.hits++;
      return user;
    }
  } catch (err: any) {
    console.warn("[AuthCache] read failed (falling back to DB):", err?.message ?? err);
  }
  stats.misses++;
  return null;
}

/**
 * Cache the auth user for a session token (call ONLY after the full auth
 * path — including the session-revocation check — has passed).
 */
export async function setCachedAuthUser(sessionToken: string, user: User): Promise<void> {
  const ttlMs = getAuthCacheTtlMs();
  if (ttlMs <= 0) return;
  try {
    // Strip secrets before the value can reach the Redis tier.
    const cacheable: User = { ...user, passwordHash: null, twoFactorSecret: null };
    const key = keyFor(sessionToken);
    await cacheService.setAsync(key, superjson.stringify(cacheable), ttlMs);
    indexKey(user, key);
  } catch (err: any) {
    console.warn("[AuthCache] write failed (ignored):", err?.message ?? err);
  }
}

/** Invalidate a single session's cached auth (logout / targeted revoke). */
export async function invalidateAuthSession(sessionToken: string): Promise<void> {
  try {
    const key = keyFor(sessionToken);
    stats.invalidations++;
    // deleteAsync clears L1 + L2 and broadcasts the exact key so other
    // instances drop their L1 copy too.
    await cacheService.deleteAsync(key);
  } catch (err: any) {
    console.warn("[AuthCache] session invalidation failed:", err?.message ?? err);
  }
}

/**
 * Invalidate every cached session for a user (role change, ban, password
 * change, 2FA change, revoke-all). Sessions cached by OTHER instances that
 * this process never saw are covered by the Redis broadcast when available,
 * otherwise by the ≤TTL staleness window documented above.
 */
export async function invalidateAuthUser(userId?: number, openId?: string): Promise<void> {
  const keys = new Set<string>();
  if (userId !== undefined) {
    for (const k of keysByUserId.get(userId) ?? []) keys.add(k);
    keysByUserId.delete(userId);
  }
  if (openId !== undefined) {
    for (const k of keysByOpenId.get(openId) ?? []) keys.add(k);
    keysByOpenId.delete(openId);
  }
  if (keys.size === 0) return;
  stats.invalidations += keys.size;
  for (const key of keys) {
    try {
      await cacheService.deleteAsync(key);
    } catch (err: any) {
      console.warn("[AuthCache] user invalidation failed for a key:", err?.message ?? err);
    }
  }
}

/** Test/ops helper: drop every cached auth entry + reverse index. */
export async function clearAuthSessionCache(): Promise<void> {
  keysByUserId.clear();
  keysByOpenId.clear();
  await cacheService.invalidateByPatternAsync(`${KEY_PREFIX}*`);
}

/** Reset counters (tests). */
export function resetAuthCacheStats(): void {
  stats.hits = 0;
  stats.misses = 0;
  stats.invalidations = 0;
}

/**
 * Hit/miss counters for the system-health cache panel (W4-A wires this into
 * its cache-stats surface at acceptance — exported here, consumed there).
 */
export function getAuthCacheStats() {
  const total = stats.hits + stats.misses;
  return {
    enabled: getAuthCacheTtlMs() > 0,
    ttlSeconds: getAuthCacheTtlMs() / 1000,
    hits: stats.hits,
    misses: stats.misses,
    hitRate: total > 0 ? ((stats.hits / total) * 100).toFixed(2) + "%" : "0%",
    invalidations: stats.invalidations,
    trackedUsers: keysByUserId.size,
  };
}
