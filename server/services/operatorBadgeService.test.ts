/**
 * W8-B (doc 29 §3) — operator/badge master: time-windowed resolution against
 * the isolated cloned test DB (vitest.setup.ts). Covers active/expired/future
 * windows, re-issue (same code, new holder, history preserved), auto_seen
 * registration and the fail-open ingest resolver.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, like } from "drizzle-orm";
import { getDb } from "../db/connection";
import { operatorBadges, users } from "../../drizzle/schema";
import {
  resolveOperator,
  resolveOperatorUserId,
  issueBadge,
  revokeBadge,
  updateBadge,
  _resetBadgeCache,
} from "./operatorBadgeService";

const STAMP = Date.now();
const CODE = (s: string) => `W8B-${s}-${STAMP}`;

let userA: number;
let userB: number;

beforeAll(async () => {
  const db = await getDb();
  expect(db).toBeTruthy();
  const rows = await db!
    .insert(users)
    .values([
      { openId: `w8b-a-${STAMP}`, name: "W8B Badge User A", role: "user" },
      { openId: `w8b-b-${STAMP}`, name: "W8B Badge User B", role: "user" },
    ])
    .returning({ id: users.id });
  userA = rows[0].id;
  userB = rows[1].id;
});

afterAll(async () => {
  const db = await getDb();
  if (db) {
    await db.delete(operatorBadges).where(like(operatorBadges.badgeCode, `W8B-%-${STAMP}`));
    await db.delete(users).where(eq(users.id, userA));
    await db.delete(users).where(eq(users.id, userB));
  }
});

beforeEach(() => _resetBadgeCache());

describe("resolveOperator — validity windows", () => {
  it("resolves an active open-ended badge; unknown code resolves to null", async () => {
    await issueBadge({ badgeCode: CODE("OPEN"), userId: userA });
    _resetBadgeCache();
    const hit = await resolveOperator(CODE("OPEN"));
    expect(hit?.userId).toBe(userA);
    expect(await resolveOperator(`W8B-NOPE-${STAMP}-x`)).toBeNull();
  });

  it("EXPIRED window (validTo in the past) does not resolve 'now' but resolves a past instant", async () => {
    const db = await getDb();
    await db!.insert(operatorBadges).values({
      badgeCode: CODE("EXP"),
      userId: userA,
      validFrom: new Date("2026-01-01T00:00:00"),
      validTo: new Date("2026-02-01T00:00:00"),
      isActive: true,
    });
    _resetBadgeCache();
    expect(await resolveOperator(CODE("EXP"), new Date("2026-06-01T00:00:00"))).toBeNull();
    const past = await resolveOperator(CODE("EXP"), new Date("2026-01-15T00:00:00"));
    expect(past?.userId).toBe(userA);
    // validTo is EXCLUSIVE ([validFrom, validTo)).
    expect(await resolveOperator(CODE("EXP"), new Date("2026-02-01T00:00:00"))).toBeNull();
  });

  it("FUTURE window (validFrom ahead) does not resolve 'now'", async () => {
    const db = await getDb();
    await db!.insert(operatorBadges).values({
      badgeCode: CODE("FUT"),
      userId: userA,
      validFrom: new Date(Date.now() + 86_400_000),
      isActive: true,
    });
    _resetBadgeCache();
    expect(await resolveOperator(CODE("FUT"))).toBeNull();
    expect((await resolveOperator(CODE("FUT"), new Date(Date.now() + 2 * 86_400_000)))?.userId).toBe(userA);
  });

  it("re-issue: old holder resolves PAST timestamps, new holder owns the future", async () => {
    const code = CODE("REISSUE");
    const t0 = new Date("2026-01-01T00:00:00");
    const cutover = new Date("2026-06-01T00:00:00");
    await issueBadge({ badgeCode: code, userId: userA, validFrom: t0 });
    _resetBadgeCache();
    await issueBadge({ badgeCode: code, userId: userB, validFrom: cutover }); // re-issue
    _resetBadgeCache();

    const before = await resolveOperator(code, new Date("2026-03-01T00:00:00"));
    expect(before?.userId).toBe(userA);
    const after = await resolveOperator(code, new Date("2026-07-01T00:00:00"));
    expect(after?.userId).toBe(userB);

    // Exactly one ACTIVE row per code (partial unique holds).
    const db = await getDb();
    const rows = await db!.select().from(operatorBadges).where(eq(operatorBadges.badgeCode, code));
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.isActive)).toHaveLength(1);
    expect(rows.find((r) => r.isActive)?.userId).toBe(userB);
  });

  it("revoked badge stops resolving after validTo", async () => {
    const code = CODE("REVOKE");
    const id = await issueBadge({ badgeCode: code, userId: userA, validFrom: new Date("2026-01-01T00:00:00") });
    await revokeBadge(id, new Date("2026-05-01T00:00:00"));
    _resetBadgeCache();
    expect((await resolveOperator(code, new Date("2026-02-01T00:00:00")))?.userId).toBe(userA);
    expect(await resolveOperator(code, new Date("2026-05-02T00:00:00"))).toBeNull();
  });

  it("assigned userId can be NULL (badge known, person unmapped) → resolves with userId null", async () => {
    const code = CODE("NOUSER");
    const id = await issueBadge({ badgeCode: code, displayName: "Chưa có tài khoản" });
    _resetBadgeCache();
    const hit = await resolveOperator(code);
    expect(hit).not.toBeNull();
    expect(hit!.userId).toBeNull();
    expect(hit!.displayName).toBe("Chưa có tài khoản");
    // …until an admin maps a user.
    await updateBadge(id, { userId: userB });
    _resetBadgeCache();
    expect((await resolveOperator(code))?.userId).toBe(userB);
  });
});

describe("resolveOperatorUserId — ingest-facing (fail-open + auto_seen)", () => {
  it("returns the user id for a known active badge", async () => {
    const code = CODE("ING");
    await issueBadge({ badgeCode: code, userId: userB });
    _resetBadgeCache();
    expect(await resolveOperatorUserId(code)).toBe(userB);
  });

  it("unknown badge → null + auto-registers an auto_seen row (userId NULL)", async () => {
    const code = CODE("AUTOSEEN");
    expect(await resolveOperatorUserId(code)).toBeNull();
    // fire-and-forget insert — give it a beat.
    await new Promise((r) => setTimeout(r, 150));
    const db = await getDb();
    const rows = await db!.select().from(operatorBadges).where(eq(operatorBadges.badgeCode, code));
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("auto_seen");
    expect(rows[0].userId).toBeNull();
  });

  it("known badge OUTSIDE its window → null WITHOUT spawning a duplicate auto_seen", async () => {
    const code = CODE("OUTSIDE");
    const db = await getDb();
    await db!.insert(operatorBadges).values({
      badgeCode: code,
      userId: userA,
      validFrom: new Date("2026-01-01T00:00:00"),
      validTo: new Date("2026-01-02T00:00:00"),
      isActive: true,
    });
    _resetBadgeCache();
    expect(await resolveOperatorUserId(code, new Date("2026-06-01T00:00:00"))).toBeNull();
    await new Promise((r) => setTimeout(r, 150));
    const rows = await db!.select().from(operatorBadges).where(eq(operatorBadges.badgeCode, code));
    expect(rows).toHaveLength(1); // no duplicate row
  });

  it("blank badge code → null (no lookup, no insert)", async () => {
    expect(await resolveOperatorUserId("   ")).toBeNull();
  });
});
