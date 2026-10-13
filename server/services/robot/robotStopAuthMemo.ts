/**
 * doc 81 Đợt 10 task D fix reviews 5 — rulings R-10-bb (STOP-only degraded auth, L-7) and R-10-be (its memory, tightened).
 * The in-process memory the STOP-only degraded auth may fall back on when the database does not answer within
 * STOP_AUTH_BOUND_MS. Import-light (no DB, no tRPC): server/_core/context.ts reads `isStopOnlyCall` and feeds
 * `noteAuthenticatedUser`; authSessionCache / db/auth / the tRPC audit middleware call the invalidators.
 *   • bound to the SESSION (the JWT's jti; a hash of the token when it has none), never to the openId;
 *   • every entry lives STOP_AUTH_MEMO_TTL_MS (15 min) at most from the FULL authentication that wrote it;
 *   • it holds: the user row that authentication resolved (role, 2FA, active), when a full machine_control:canEdit check last
 *     granted this session, and the factory scope last read for it;
 *   • it is DROPPED on logout / session revoke (invalidateStopAuthForSession), account disable / role change / password / 2FA /
 *     revoke-all (invalidateStopAuthForUser), and any authorization-administration mutation — permissions, factory / corporate
 *     assignments (clearAllStopAuthMemo: fail-closed, all sessions);
 *   • a DEFINITE refusal of a session (revoked / unknown / disabled / must change password) is remembered AS a refusal: that
 *     session can no longer STOP from memory until a full authentication succeeds again.
 * Limit (stated): another API replica's memory is not reached by this process's invalidation — it ages out within the TTL.
 * Nothing here ever authorises MOTION: only the STOP procedure reads it.
 */
import { createHash } from "node:crypto";
import { decodeJwt } from "jose";
import type { User } from "../../../drizzle/schema";

/** the tRPC paths of the STOP-only procedure(s) — the only calls whose context skips the unbounded auth reads */
export const STOP_ONLY_PATHS: ReadonlySet<string> = new Set(["robot.consoleStop"]);
export const STOP_AUTH_BOUND_MS = 300;
export const STOP_AUTH_MEMO_TTL_MS = 15 * 60 * 1000;
let ttlMs = STOP_AUTH_MEMO_TTL_MS;
/** Test seam. */
export function _setStopAuthMemoTtlMsForTests(ms: number | null): void {
  ttlMs = ms ?? STOP_AUTH_MEMO_TTL_MS;
}

/** true ⇔ every call of this HTTP request is a STOP-only procedure (a batch mixing anything else is NOT). */
export function isStopOnlyCall(info: unknown): boolean {
  const calls = (info as { calls?: Array<{ path?: unknown }> } | undefined)?.calls;
  return Array.isArray(calls) && calls.length > 0 && calls.every((c) => typeof c?.path === "string" && STOP_ONLY_PATHS.has(c.path));
}

/** The session key: the token's jti (no verification here — callers verified the token), else a hash of the token. */
export function stopSessionKey(token: string | null | undefined): string | null {
  if (!token) return null;
  try {
    const jti = decodeJwt(token).jti;
    if (typeof jti === "string" && jti.length > 0) return `jti:${jti}`;
  } catch {
    /* not a JWT — hash it */
  }
  return `tok:${createHash("sha256").update(token).digest("hex")}`;
}

export type RememberedUser = Pick<User, "id" | "openId" | "role" | "name" | "twoFactorEnabled"> & { isActive?: boolean | null };
type Entry = { user: RememberedUser; at: number; grantAt?: number; scope?: { value: number[] | null; at: number } };
const entries = new Map<string, Entry>();
/** sessions whose last definite answer was a refusal (key → until) */
const refused = new Map<string, number>();
const live = (at: number | undefined) => at !== undefined && Date.now() - at <= ttlMs;

export function noteAuthenticatedUser(user: User | null | undefined, token: string | null | undefined): void {
  const key = stopSessionKey(token);
  if (!user || !key || typeof user.openId !== "string") return;
  refused.delete(key);
  const prev = entries.get(key);
  const same = prev && prev.user.id === user.id && prev.user.role === user.role;
  entries.set(key, {
    user: { id: user.id, openId: user.openId, role: user.role, name: user.name, twoFactorEnabled: user.twoFactorEnabled, isActive: (user as { isActive?: boolean | null }).isActive ?? null },
    at: Date.now(),
    // a grant / scope survives a re-authentication only for the SAME user and role
    ...(same ? { grantAt: prev!.grantAt, scope: prev!.scope } : {}),
  });
}
export function rememberedIdentity(token: string | null | undefined): RememberedUser | null {
  const key = stopSessionKey(token);
  if (!key || refused.has(key)) return null;
  const e = entries.get(key);
  if (!e || !live(e.at)) return null;
  return e.user;
}
export function noteMachineControlGrant(token: string | null | undefined, userId: number): void {
  const e = entries.get(stopSessionKey(token) ?? "");
  if (e && e.user.id === userId) e.grantAt = Date.now();
}
export function rememberedMachineControlGrant(token: string | null | undefined, userId: number): boolean {
  const key = stopSessionKey(token);
  const e = key && !refused.has(key) ? entries.get(key) : undefined;
  return !!e && e.user.id === userId && live(e.at) && live(e.grantAt);
}
export function noteFactoryScope(token: string | null | undefined, userId: number, factoryIds: number[] | null): void {
  const e = entries.get(stopSessionKey(token) ?? "");
  if (e && e.user.id === userId) e.scope = { value: factoryIds, at: Date.now() };
}
/** undefined = not known (within the TTL); null = unrestricted; [] / ids = restricted */
export function rememberedFactoryScope(token: string | null | undefined, userId: number): number[] | null | undefined {
  const key = stopSessionKey(token);
  const e = key && !refused.has(key) ? entries.get(key) : undefined;
  return e && e.user.id === userId && live(e.at) && e.scope && live(e.scope.at) ? e.scope.value : undefined;
}

/** A definite refusal of this session (revoked / unknown / disabled / must change password): remembered as a refusal. */
export function noteDefiniteRefusal(token: string | null | undefined): void {
  const key = stopSessionKey(token);
  if (!key) return;
  entries.delete(key);
  refused.set(key, Date.now());
}
/** logout / targeted revoke */
export function invalidateStopAuthForSession(token: string | null | undefined): void {
  const key = stopSessionKey(token);
  if (key) entries.delete(key);
}
/** account disable / role change / password / 2FA / revoke-all — every session of the user */
export function invalidateStopAuthForUser(userId?: number, openId?: string): void {
  for (const [k, e] of entries) if ((userId !== undefined && e.user.id === userId) || (openId !== undefined && e.user.openId === openId)) entries.delete(k);
}
/** any permission / assignment change (fail-closed: every session) */
export function clearAllStopAuthMemo(): void {
  entries.clear();
}
/** tRPC mutation paths that administer authorization (permissions, factory / corporate assignments, users, sessions) */
const INVALIDATING_ROUTERS = ["permissions", "user", "userAssignment", "auth", "session"];
export function invalidatesStopAuthMemo(path: string): boolean {
  return INVALIDATING_ROUTERS.includes(path.split(".")[0] ?? "");
}
/** Test seam. */
export function _resetStopAuthMemoForTests(): void {
  entries.clear();
  refused.clear();
}
