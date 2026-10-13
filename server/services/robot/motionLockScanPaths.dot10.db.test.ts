/**
 * doc 81 Đợt 10 task D fix review 3 — the three concrete paths behind security scans #71 / #72 on robotMotionLockStore (commit
 * 3a19ff530), each pinned RED-first on `_test` (rolled back). Every lock below is a DIFFERENT writer (another replica):
 *   P1 (authorization-logic) — an ADOPTED row's clear deleted by generation ALONE: when the adopted row was meanwhile removed and
 *      another writer re-created a row at the SAME generation, the late clear erased that new, never-seen lock;
 *   P2 (safety-interlock-bypass) — the persistUnknown boot branch (`lockedAt < boot`) applied to ANY writer: a process that booted
 *      persistUnknown REPLACED another replica's pre-boot lock with its own and its clear DELETED it — reason never shown;
 *   P3 (strength lowered) — a MERGED row kept its original writer's identity, so that writer's next lock REPLACED it: the other
 *      writer's (stronger) reason vanished.
 * Fixes: an adopted clear matches generation AND lockedAt; the boot branch is the writer's OWN rows only; a merged row belongs to
 * nobody (its writer stamp is cleared) — only a clear naming its exact generation (after adoption) removes it.
 */
import { describe, it, expect, vi } from "vitest";
import { sql } from "drizzle-orm";

const H = vi.hoisted(() => ({ tx: null as any }));
vi.mock("../../db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/connection")>();
  return { ...actual, getDb: vi.fn(async () => H.tx ?? actual.getDb()) };
});

import { getDb } from "../../db/connection";
import * as store from "./robotMotionLockStore";
import { MotionLock } from "./robotDriver";
import { recheckMotionAuthorityInTx } from "./robotSharedMotionLockGate";

const onTest = /_test\b/.test(process.env.DATABASE_URL ?? "");
const TAG = `D10S-${Date.now()}`;
class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: any) => Promise<void>): Promise<void> {
  const d = (await getDb())!;
  try {
    await d.transaction(async (tx) => {
      H.tx = tx;
      try {
        await fn(tx);
      } finally {
        await store._flushMotionLockWritesForTests();
        H.tx = null;
      }
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}
const q = async (tx: any, x: ReturnType<typeof sql>) => (await tx.execute(x)) as Array<Record<string, any>>;
let writerSeq = 100;
/** a lock of ANOTHER writer (another process / replica) */
function writer(robot: number, load: store.MotionLockLoad = { ok: true, rows: new Map() }): MotionLock {
  const l = new MotionLock();
  (store as unknown as { _setMotionLockWriterForTests?: (l: MotionLock, w: number) => void })._setMotionLockWriterForTests?.(l, writerSeq++);
  store.attachMotionLockPersistence(robot, l, load);
  return l;
}
async function robotRow(tx: any, s: string): Promise<number> {
  return Number((await q(tx, sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled") VALUES (${`${TAG}-${s}`}, 'r', 'sim', 'sim://t', true) RETURNING id`))[0].id);
}
const lockRow = async (tx: any, robot: number) => (await q(tx, sql`SELECT "reasonCode", generation, detail FROM robot_motion_locks WHERE "robotId" = ${robot}`))[0];

describe.skipIf(!onTest)("scan #71 / #72 — motion-lock store paths (_test, rolled back)", () => {
  it("★ P1 — a late clear of an ADOPTED row never deletes a row another writer re-created at the same generation", async () => {
    await inRolledBackTx(async (tx) => {
      const robot = await robotRow(tx, "p1");
      const B = writer(robot);
      B.lock("line_connection_closed", "B");
      await store._flushMotionLockWritesForTests();
      const [row] = await q(tx, sql`SELECT generation FROM robot_motion_locks WHERE "robotId" = ${robot}`);
      const A = writer(robot);
      store.adoptPersistedMotionLock(A, { reasonCode: "line_connection_closed", detail: "B", since: new Date(Date.now() - 5).toISOString(), generation: Number(row.generation) });
      B.clearByStop(); // B removes its own row
      await store._flushMotionLockWritesForTests();
      await new Promise((r) => setTimeout(r, 5));
      const C = writer(robot);
      C.lock("rmi_reply_timeout", "C: a NEW fault"); // same generation 1 — a different lock
      await store._flushMotionLockWritesForTests();
      A.clearByOperator({ reason: "acknowledged B's lock", userId: 1, expectedGeneration: A.snapshot().generation! });
      await store._flushMotionLockWritesForTests();
      expect(await lockRow(tx, robot)).toMatchObject({ reasonCode: "rmi_reply_timeout" }); // C's lock survives
    });
  });

  it("★ P2 — a persistUnknown boot never REPLACES / DELETES another writer's pre-boot lock (its reason is kept, merged)", async () => {
    await inRolledBackTx(async (tx) => {
      const robot = await robotRow(tx, "p2");
      const B = writer(robot);
      B.lock("motion_outcome_unknown", "B: reply timeout");
      await store._flushMotionLockWritesForTests();
      await new Promise((r) => setTimeout(r, 5));
      const A = writer(robot, { ok: false, error: "load failed" }); // A boots persistUnknown AFTER B's lock
      await store._flushMotionLockWritesForTests();
      const merged = await lockRow(tx, robot);
      expect(merged.reasonCode).toBe("motion_outcome_unknown"); // never replaced by A's persistUnknown
      expect(String(merged.detail)).toMatch(/persistUnknown/);
      A.clearByOperator({ reason: "persistUnknown acknowledged", userId: 1, expectedGeneration: A.snapshot().generation! });
      await store._flushMotionLockWritesForTests();
      expect(await lockRow(tx, robot)).toMatchObject({ reasonCode: "motion_outcome_unknown" }); // A's clear does not delete it
    });
  });

  it("★ P3 — after a MERGE, the original writer's next lock never replaces the row (the other writer's reason stays)", async () => {
    await inRolledBackTx(async (tx) => {
      const robot = await robotRow(tx, "p3");
      const A = writer(robot);
      const B = writer(robot);
      A.lock("door_open", "A: a weaker reason");
      await store._flushMotionLockWritesForTests();
      B.lock("motion_outcome_unknown", "B: the stronger reason");
      await store._flushMotionLockWritesForTests();
      expect((await lockRow(tx, robot)).reasonCode).toBe("motion_outcome_unknown");
      A.clearByStop(); // A's own clear (generation 1) — the merged row is not A's to delete
      await store._flushMotionLockWritesForTests();
      A.lock("rmi_reply_timeout", "A again"); // A's generation 2 = the merged row's generation
      await store._flushMotionLockWritesForTests();
      const after = await lockRow(tx, robot);
      expect(after.reasonCode).toBe("motion_outcome_unknown"); // never lowered / replaced
      expect(String(after.detail)).toMatch(/B: the stronger reason/);
    });
  });
  it("★ R-10-ap — two writers NEVER replace each other, even with the SAME lockedAt and generation (the old 1-in-999 tag collision)", async () => {
    await inRolledBackTx(async (tx) => {
      const robot = await robotRow(tx, "ap");
      const wA = store.motionLockWriterInstanceId(writer(robot));
      const wB = store.motionLockWriterInstanceId(writer(robot));
      expect(wA).not.toBe(wB);
      const at = new Date(Date.now() - 1000).toISOString(); // identical instant for both writers
      for (let round = 1; round <= 6; round++) {
        const [first, second] = round % 2 ? [wA, wB] : [wB, wA];
        await store.persistMotionLock(robot, { locked: true, reasonCode: "door_open", detail: `first-${round}`, since: at, generation: 1 } as any, first);
        const before = await lockRow(tx, robot);
        await store.persistMotionLock(robot, { locked: true, reasonCode: "door_open", detail: `second-${round}`, since: at, generation: 1 } as any, second);
        const after = await lockRow(tx, robot);
        expect(Number(after.generation)).toBeGreaterThan(Number(before.generation)); // never a same-generation replace
        expect(String(after.detail)).toContain(String(before.detail).replace(/^reasons: /, "")); // the earlier reason is LISTED, not replaced
        // neither writer's own clear removes a row it no longer holds alone
        await store.deleteMotionLock(robot, 1_000, undefined, undefined, first);
        await store.deleteMotionLock(robot, 1_000, undefined, undefined, second);
        expect(await lockRow(tx, robot)).toBeTruthy();
        await tx.execute(sql`DELETE FROM robot_motion_locks WHERE "robotId" = ${robot}`); // next round starts clean
      }
    });
  });
  it("★ fix review 4 (NF-5) — the in-transaction recheck refuses a FOREIGN central row and a MERGED row; only the row this lock cleared (delete in flight) passes", async () => {
    await inRolledBackTx(async (tx) => {
      const robot = await robotRow(tx, "nf5");
      const A = writer(robot);
      const B = writer(robot);
      expect(await recheckMotionAuthorityInTx(tx, robot, null, A)).toBeNull(); // no row
      B.lock("door_open", "B: another replica's lock");
      await store._flushMotionLockWritesForTests();
      expect(await recheckMotionAuthorityInTx(tx, robot, null, A)).toMatchObject({ code: "MOTION_LOCKED" }); // foreign central row
      A.lock("door_open", "A");
      await store._flushMotionLockWritesForTests(); // ⇒ MERGED row
      expect((await q(tx, sql`SELECT "writerInstanceId" AS w FROM robot_motion_locks WHERE "robotId" = ${robot}`))[0].w).toBe(store.MERGED_WRITER);
      expect(await recheckMotionAuthorityInTx(tx, robot, null, A)).toMatchObject({ code: "MOTION_LOCKED" });
      expect(await recheckMotionAuthorityInTx(tx, robot, null, B)).toMatchObject({ code: "MOTION_LOCKED" });
      await tx.execute(sql`DELETE FROM robot_motion_locks WHERE "robotId" = ${robot}`);
      // A's own row, cleared by A, its DELETE "still in flight" (the very row re-appears) ⇒ exempt for A only
      const C = writer(robot);
      C.lock("door_open", "C");
      await store._flushMotionLockWritesForTests();
      const [saved] = await q(tx, sql`SELECT "reasonCode", generation, "lockedAt", "writerInstanceId" FROM robot_motion_locks WHERE "robotId" = ${robot}`);
      C.clearByStop();
      await store._flushMotionLockWritesForTests();
      await tx.execute(sql`INSERT INTO robot_motion_locks ("robotId", "reasonCode", generation, "lockedAt", "writerInstanceId") VALUES (${robot}, ${saved.reasonCode}, ${saved.generation}, ${saved.lockedAt}, ${saved.writerInstanceId})`);
      expect(await recheckMotionAuthorityInTx(tx, robot, null, C)).toBeNull();
      expect(await recheckMotionAuthorityInTx(tx, robot, null, A)).toMatchObject({ code: "MOTION_LOCKED" });
      expect(await recheckMotionAuthorityInTx(tx, robot, null, null)).toMatchObject({ code: "MOTION_LOCKED" });
    });
  });
});
