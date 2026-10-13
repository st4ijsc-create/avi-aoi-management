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
type Entry = { user: RememberedUser; at: number };
/** per USER facts the full chain proved (fix review 6, NF5-1): bound to the role they were proved under */
type Facts = { role: string; grant?: { value: boolean; at: number }; scope?: { value: number[] | null; at: number } };
/** fix review 6 (NF5-9) — every map is bounded (LRU: an access moves the key to the end; the oldest is evicted) */
export const STOP_AUTH_MEMO_MAX = 5_000;
const entries = new Map<string, Entry>();
const facts = new Map<number, Facts>();
/** sessions whose last definite answer was a refusal (key → at); pruned after the TTL */
const refused = new Map<string, number>();
const live = (at: number | undefined) => at !== undefined && Date.now() - at <= ttlMs;

/**
 * fix review 7 — ruling R-10-bg: a warm write must never resurrect what an invalidation removed. The race: a full authentication
 * STARTS, an invalidation lands (revoke / disable / role change), then the in-flight authentication FINISHES and writes the old
 * identity back. Every invalidation bumps a monotonic GENERATION and leaves a TOMBSTONE (the generation it was made at) per
 * session, per user, or globally, kept TOMBSTONE_TTL_MS (≥ the memo TTL). A warm write carries the generation read at its
 * request's START (a ticket — beginStopAuthWarm): it is DROPPED if a tombstone of its session, its user or the global one is
 * newer than its ticket. A warm write WITHOUT a ticket (a caller that cannot say when its request started) is dropped while ANY
 * such tombstone is alive (conservative: the degraded STOP is then unavailable to that user until it expires — never stale).
 * Refusals are never dropped.
 */
let generation = 0;
const tombSession = new Map<string, { gen: number; at: number }>();
const tombUser = new Map<number, { gen: number; at: number }>();
let tombAll: { gen: number; at: number } | null = null;
const tombTtl = () => Math.max(ttlMs, STOP_AUTH_MEMO_TTL_MS);
const tombLive = (t: { at: number } | null | undefined): t is { gen: number; at: number } => !!t && Date.now() - t.at <= tombTtl();
export type StopAuthWarmTicket = { gen: number; at: number };
/** read at a request's START; pass to the warm writes of that request */
export function beginStopAuthWarm(): StopAuthWarmTicket {
  return { gen: generation, at: Date.now() };
}
function tombstone(kind: "session" | "user" | "all", key?: string | number): void {
  const t = { gen: ++generation, at: Date.now() };
  if (kind === "all") tombAll = t;
  else if (kind === "session") lruSet(tombSession, key as string, t);
  else lruSet(tombUser, key as number, t);
}
/** may a warm write of (session?, user) carrying `ticket` land? */
function warmAllowed(sessionKey: string | null, userId: number | null, ticket?: StopAuthWarmTicket): boolean {
  if (ticket && Date.now() - ticket.at > tombTtl()) return false; // older than any tombstone we still keep
  const newer = (t: { gen: number; at: number } | null | undefined) => tombLive(t) && (ticket === undefined || t.gen > ticket.gen);
  if (newer(tombAll)) return false;
  if (sessionKey !== null && newer(tombSession.get(sessionKey))) return false;
  if (userId !== null && newer(tombUser.get(userId))) return false;
  return true;
}
function lruSet<K, V>(m: Map<K, V>, k: K, v: V): void {
  m.delete(k);
  m.set(k, v);
  while (m.size > STOP_AUTH_MEMO_MAX) {
    const oldest = m.keys().next().value as K;
    m.delete(oldest);
  }
}
const isRefused = (key: string): boolean => {
  const at = refused.get(key);
  if (at === undefined) return false;
  if (!live(at)) {
    refused.delete(key);
    return false;
  }
  return true;
};

/** EVERY successful full authentication (createContext): the session's identity. */
export function noteAuthenticatedUser(user: User | null | undefined, token: string | null | undefined, ticket?: StopAuthWarmTicket): void {
  const key = stopSessionKey(token);
  if (!user || !key || typeof user.openId !== "string") return;
  if (!warmAllowed(key, user.id, ticket)) return; // R-10-bg — an older request never resurrects an invalidated identity
  refused.delete(key);
  lruSet(entries, key, {
    user: { id: user.id, openId: user.openId, role: user.role, name: user.name, twoFactorEnabled: user.twoFactorEnabled, isActive: (user as { isActive?: boolean | null }).isActive ?? null },
    at: Date.now(),
  });
  const f = facts.get(user.id);
  if (f && f.role !== user.role) facts.delete(user.id); // a role change: what was proved for the old role no longer counts
}
export function rememberedIdentity(token: string | null | undefined): RememberedUser | null {
  const key = stopSessionKey(token);
  if (!key || isRefused(key)) return null;
  const e = entries.get(key);
  if (!e || !live(e.at)) return null;
  return e.user;
}
function factsFor(userId: number, role: string): Facts {
  const f = facts.get(userId);
  if (f && f.role === role) return f;
  const n: Facts = { role };
  lruSet(facts, userId, n);
  return n;
}
/**
 * fix review 6 (NF5-1) — the machine_control row the FULL permission chain just read for this user (accessControl.checkPermission,
 * whatever action it was asked: the row carries canEdit too — no extra DB read). true / false both remembered (false revokes).
 */
export function noteMachineControlRow(userId: number, role: string, canEdit: boolean, ticket?: StopAuthWarmTicket): void {
  if (canEdit && !warmAllowed(null, userId, ticket)) return; // R-10-bg (a "false" always lands: it only narrows)
  lruSet(facts, userId, { ...factsFor(userId, role), grant: { value: canEdit, at: Date.now() } });
}
/** a full machine_control:canEdit grant proved on this request (actuate / consoleStop) */
export function noteMachineControlGrant(_token: string | null | undefined, userId: number, role?: string, ticket?: StopAuthWarmTicket): void {
  const key = stopSessionKey(_token);
  if (!warmAllowed(key, userId, ticket)) return; // R-10-bg
  const e = entries.get(key ?? "");
  const r = role ?? (e && e.user.id === userId ? String(e.user.role) : undefined);
  if (r !== undefined) noteMachineControlRow(userId, r, true, ticket);
}
export function rememberedMachineControlGrant(token: string | null | undefined, userId: number): boolean {
  const who = rememberedIdentity(token);
  if (!who || who.id !== userId) return false;
  const f = facts.get(userId);
  return !!f && f.role === who.role && !!f.grant && f.grant.value === true && live(f.grant.at);
}
/** fix review 6 (NF5-1) — the factory scope a full scoped read just resolved for this user (reportAggregators) */
export function noteUserFactoryScope(userId: number, role: string, factoryIds: number[] | null, ticket?: StopAuthWarmTicket): void {
  if (!warmAllowed(null, userId, ticket)) return; // R-10-bg
  lruSet(facts, userId, { ...factsFor(userId, role), scope: { value: factoryIds, at: Date.now() } });
}
export function noteFactoryScope(token: string | null | undefined, userId: number, factoryIds: number[] | null, ticket?: StopAuthWarmTicket): void {
  const key = stopSessionKey(token);
  if (!warmAllowed(key, userId, ticket)) return; // R-10-bg
  const e = entries.get(key ?? "");
  if (e && e.user.id === userId) noteUserFactoryScope(userId, String(e.user.role), factoryIds, ticket);
}
/** undefined = not known (within the TTL); null = unrestricted; [] / ids = restricted */
export function rememberedFactoryScope(token: string | null | undefined, userId: number): number[] | null | undefined {
  const who = rememberedIdentity(token);
  if (!who || who.id !== userId) return undefined;
  const f = facts.get(userId);
  return f && f.role === who.role && f.scope && live(f.scope.at) ? f.scope.value : undefined;
}

/** A definite refusal of this session (revoked / unknown / disabled / must change password): remembered as a refusal. */
export function noteDefiniteRefusal(token: string | null | undefined): void {
  const key = stopSessionKey(token);
  if (!key) return;
  entries.delete(key);
  lruSet(refused, key, Date.now());
}
/** logout / targeted revoke */
export function invalidateStopAuthForSession(token: string | null | undefined): void {
  const key = stopSessionKey(token);
  if (!key) return;
  const e = entries.get(key);
  entries.delete(key);
  tombstone("session", key); // R-10-bg
  if (e) tombstone("user", e.user.id);
}
/** account disable / role change / password / 2FA / revoke-all / its permissions or assignments — every session + fact of the user */
export function invalidateStopAuthForUser(userId?: number, openId?: string): void {
  if (userId !== undefined) tombstone("user", userId); // R-10-bg
  for (const [k, e] of entries) {
    if ((userId !== undefined && e.user.id === userId) || (openId !== undefined && e.user.openId === openId)) {
      entries.delete(k);
      facts.delete(e.user.id);
      tombstone("session", k);
      tombstone("user", e.user.id);
    }
  }
  if (userId !== undefined) facts.delete(userId);
}
/** an authorization change whose affected user cannot be told (fail-closed: every user's facts) */
export function clearAllStopAuthMemo(): void {
  entries.clear();
  facts.clear();
  tombstone("all"); // R-10-bg
}
/**
 * fix review 6 (NF5-1) — tRPC mutation routers that administer OTHER users' authorization (permissions, assignments). Their raw
 * input names the affected user (`userId`) ⇒ only that user is invalidated; no userId ⇒ every user (fail-closed). Self-service
 * routers (user.* / auth.* / session.*) invalidate through the db-layer hooks (invalidateAuthUser / invalidateAuthSession) — per user.
 */
const INVALIDATING_ROUTERS = ["permissions", "userAssignment"];
export function invalidatesStopAuthMemo(path: string): boolean {
  return INVALIDATING_ROUTERS.includes(path.split(".")[0] ?? "");
}
/** the affected user(s) of an authorization-administration mutation, from its raw input; null = cannot tell (clear all) */
export function affectedUserIds(rawInput: unknown): number[] | null {
  const i = rawInput as { userId?: unknown; userIds?: unknown } | null | undefined;
  if (i && Number.isSafeInteger(i.userId)) return [Number(i.userId)];
  if (i && Array.isArray(i.userIds) && i.userIds.every((x) => Number.isSafeInteger(x))) return (i.userIds as number[]).map(Number);
  return null;
}
export function invalidateForAuthorizationChange(rawInput: unknown): void {
  const ids = affectedUserIds(rawInput);
  if (ids === null) clearAllStopAuthMemo();
  else for (const id of ids) invalidateStopAuthForUser(id);
}
/** Test seam. */
export function _resetStopAuthMemoForTests(): void {
  entries.clear();
  facts.clear();
  refused.clear();
  tombSession.clear();
  tombUser.clear();
  tombAll = null;
}
/** Test seam (NF5-9). */
export function _stopAuthMemoSizesForTests(): { sessions: number; users: number; refused: number } {
  return { sessions: entries.size, users: facts.size, refused: refused.size };
}
