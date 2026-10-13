/**
 * doc 81 Đợt 10 task D fix review 6 — the STOP-only degraded-auth memory, unit level:
 *   • NF5-9: every map is LRU-bounded (STOP_AUTH_MEMO_MAX) and refusals are pruned after the TTL;
 *   • NF5-1: per-user facts (grant / scope) are bound to the role they were proved under; per-user invalidation leaves other users;
 *     an authorization change that names no user clears every user (fail-closed).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  STOP_AUTH_MEMO_MAX,
  _resetStopAuthMemoForTests,
  _setStopAuthMemoTtlMsForTests,
  _stopAuthMemoSizesForTests,
  invalidateForAuthorizationChange,
  noteAuthenticatedUser,
  noteDefiniteRefusal,
  noteMachineControlRow,
  noteUserFactoryScope,
  rememberedFactoryScope,
  rememberedIdentity,
  rememberedMachineControlGrant,
} from "./robotStopAuthMemo";

const user = (id: number, role = "engineer") => ({ id, openId: `oid-${id}`, role, name: `u${id}`, twoFactorEnabled: true, isActive: true }) as never;

beforeEach(() => {
  _resetStopAuthMemoForTests();
  _setStopAuthMemoTtlMsForTests(null);
});

describe("robotStopAuthMemo — bounded, per user", () => {
  it("★ NF5-9 — sessions / users / refusals are LRU-bounded; the most recent survive", () => {
    for (let i = 0; i < STOP_AUTH_MEMO_MAX + 50; i++) {
      noteAuthenticatedUser(user(i), `tok-${i}`);
      noteMachineControlRow(i, "engineer", true);
      noteDefiniteRefusal(`bad-${i}`);
    }
    const s = _stopAuthMemoSizesForTests();
    expect(s.sessions).toBeLessThanOrEqual(STOP_AUTH_MEMO_MAX);
    expect(s.users).toBeLessThanOrEqual(STOP_AUTH_MEMO_MAX);
    expect(s.refused).toBeLessThanOrEqual(STOP_AUTH_MEMO_MAX);
    expect(rememberedIdentity("tok-0")).toBeNull(); // evicted
    expect(rememberedIdentity(`tok-${STOP_AUTH_MEMO_MAX + 49}`)).toMatchObject({ id: STOP_AUTH_MEMO_MAX + 49 });
  });

  it("refusals expire with the TTL (pruned on read)", async () => {
    _setStopAuthMemoTtlMsForTests(30);
    noteDefiniteRefusal("tok-r");
    noteAuthenticatedUser(user(1), "tok-r"); // a later full success clears it anyway
    noteDefiniteRefusal("tok-r");
    expect(rememberedIdentity("tok-r")).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(_stopAuthMemoSizesForTests().refused).toBe(1);
    rememberedIdentity("tok-r");
    expect(_stopAuthMemoSizesForTests().refused).toBe(0);
  });

  it("★ NF5-1 — a grant / scope is per USER, bound to its role; per-user invalidation leaves other users", () => {
    noteAuthenticatedUser(user(1), "t1");
    noteAuthenticatedUser(user(2), "t2");
    noteMachineControlRow(1, "engineer", true);
    noteMachineControlRow(2, "engineer", true);
    noteUserFactoryScope(1, "engineer", [7]);
    expect(rememberedMachineControlGrant("t1", 1)).toBe(true);
    expect(rememberedFactoryScope("t1", 1)).toEqual([7]);
    invalidateForAuthorizationChange({ userId: 2 });
    expect(rememberedMachineControlGrant("t1", 1)).toBe(true);
    expect(rememberedMachineControlGrant("t2", 2)).toBe(false);
    noteMachineControlRow(1, "engineer", false); // a later full read says no
    expect(rememberedMachineControlGrant("t1", 1)).toBe(false);
    noteMachineControlRow(1, "engineer", true);
    noteAuthenticatedUser(user(1, "supervisor"), "t1"); // role changed: facts proved for the old role are dropped
    expect(rememberedMachineControlGrant("t1", 1)).toBe(false);
    noteMachineControlRow(1, "engineer", true); // a LATE read proved under the OLD role
    expect(rememberedMachineControlGrant("t1", 1)).toBe(false); // never counts for the session now seen as supervisor
    noteMachineControlRow(1, "supervisor", true);
    expect(rememberedMachineControlGrant("t1", 1)).toBe(true);
    invalidateForAuthorizationChange({}); // no user named ⇒ everyone
    expect(rememberedMachineControlGrant("t1", 1)).toBe(false);
  });
});
