/**
 * doc 81 Đợt 10 task D (design §2.11 / §2.12, re-review N1 + N2) — ONE motion-lock AUTHORITY per robot, measured on the `_test`
 * DB as avi_app (mig 0374 applied), every case inside ONE transaction that is rolled back (getDb → that transaction):
 *   • an EDGE clear can never delete CENTRAL's row (edge_motion_lock_clear matches only its own authority + epoch);
 *   • CENTRAL's own writes (robotMotionLockStore: upsert / delete of its in-memory lock's mirror) never replace or remove an
 *     edge authority's row (N2 — they are scoped to authority 'central');
 *   • a GENERATION or OWNER-EPOCH mismatch is refused (stale clear removes nothing; stale apply → 23514);
 *   • an OWNERSHIP TRANSFER starts LOCKED ('ownerChanged' under the new authority + epoch, same statement): central refuses
 *     motion to the edge-owned robot (ROBOT_OWNED_BY_EDGE, even with a session still open), and after the transfer BACK it
 *     refuses motion on the ownerChanged row (N1 — central now reads it), ADOPTS it into the in-memory lock, and the operator's
 *     generation-quoting clear removes the row through the existing persistence hook — then motion passes again.
 * Oracle: rows read by plain SQL in the same transaction; dispatcher decisions; the in-memory MotionLock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sql } from "drizzle-orm";

const H = vi.hoisted(() => ({ tx: null as any, lock: null as any }));
vi.mock("../../db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/connection")>();
  return { ...actual, getDb: vi.fn(async () => H.tx ?? actual.getDb()) };
});
vi.mock("./robotEnabledGate", () => ({ readRobotEnabledForMotion: async () => true })); // not measured here
vi.mock("./robotManager", () => ({
  // central still holds a session for the robot (e.g. opened before an ownership change) — the authority read must refuse anyway
  getActiveRobot: () => ({
    id: 0,
    code: "T",
    vendor: "sim",
    driver: { vendor: "sim", isConnected: () => true, getMotionLock: () => H.lock.snapshot(), motionLockController: () => H.lock, runJob: async () => ({ ok: true, status: "done" }) },
  }),
}));

import { getDb } from "../../db/connection";
import { applyEdgeMotionLock, clearEdgeMotionLock, isEdgeControlRefusal } from "../edge/edgeControlSchema";
import { attachMotionLockPersistence, deleteMotionLock, persistMotionLock, _flushMotionLockWritesForTests } from "./robotMotionLockStore";
import { dispatchRobotJob, ROBOT_OWNED_BY_EDGE } from "./robotCommandDispatcher";
import { MotionLock } from "./robotDriver";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const TAG = `D10D-${Date.now()}`;

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: any) => Promise<void>): Promise<void> {
  const d = (await getDb())!;
  try {
    await d.transaction(async (tx) => {
      H.tx = tx;
      try {
        await fn(tx);
      } finally {
        await _flushMotionLockWritesForTests();
        H.tx = null;
      }
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}
const rows = async (tx: any, q: ReturnType<typeof sql>) => (await tx.execute(q)) as Array<Record<string, any>>;
const lockRow = async (tx: any, robotId: number) => {
  const r = (await rows(tx, sql`SELECT "reasonCode", generation, authority, "authorityNodeId", "ownerEpoch" FROM robot_motion_locks WHERE "robotId" = ${robotId}`))[0];
  return r ? { ...r, generation: Number(r.generation), ownerEpoch: r.ownerEpoch == null ? null : Number(r.ownerEpoch) } : null;
};
async function codeOf(tx: any, p: () => Promise<unknown>): Promise<string | null> {
  try {
    await tx.transaction(async () => p());
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code ?? String((e as Error).message);
  }
}
async function nodeAndRobot(tx: any, suffix: string): Promise<{ node: number; robot: number }> {
  const [n] = await rows(tx, sql`INSERT INTO edge_nodes (code, name, status) VALUES (${`${TAG}-N${suffix}`}, 'n', 'offline') RETURNING id`);
  const [r] = await rows(tx, sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled") VALUES (${`${TAG}-R${suffix}`}, 'r', 'sim', 'sim://t', true) RETURNING id`);
  return { node: Number(n.id), robot: Number(r.id) };
}
const own = async (tx: any, robot: number, node: number | null) => {
  await tx.execute(sql`UPDATE robots SET "edgeNodeId" = ${node} WHERE id = ${robot}`);
  return Number((await rows(tx, sql`SELECT "ownerEpoch" FROM robots WHERE id = ${robot}`))[0].ownerEpoch);
};
const MOTION = (robotId: number) => ({ robotId, job: { jobType: "home" as const, params: {} }, triggerKind: "manual" as const, requestedBy: 1, confirmedBy: 1 });

beforeEach(() => {
  H.lock = new MotionLock();
  delete process.env.ROBOT_CONTROL_ENABLED; // dry-run: a motion that passes every gate ends 'simulated'
  delete process.env.EDGE_EXECUTION_ENABLED;
  delete process.env.EDGE_GATEWAY_MODE;
  delete process.env.FIELD_V2_ENABLED;
});

describe.skipIf(!onTest)("motion-lock authority (mig 0374, _test, rolled back)", () => {
  it("★ an EDGE clear cannot delete CENTRAL's row — not with any generation; an edge apply on a central robot is refused", async () => {
    await inRolledBackTx(async (tx) => {
      const { node, robot } = await nodeAndRobot(tx, "a");
      await persistMotionLock(robot, { locked: true, reasonCode: "motion_outcome_unknown", since: new Date().toISOString(), generation: 3 });
      await _flushMotionLockWritesForTests();
      expect(await lockRow(tx, robot)).toMatchObject({ authority: "central", generation: 3 });
      expect(await clearEdgeMotionLock(tx, { robotId: robot, nodeId: node, ownerEpoch: 1, generation: 2_000_000 })).toBe(0);
      expect(await lockRow(tx, robot)).toMatchObject({ authority: "central", generation: 3 });
      const code = await codeOf(tx, () => applyEdgeMotionLock(tx, { robotId: robot, nodeId: node, ownerEpoch: 1, generation: 99, reasonCode: "x" }));
      expect(code).toBe("23514");
      expect(await lockRow(tx, robot)).toMatchObject({ authority: "central", generation: 3 });
    });
  });

  it("★ N2 — CENTRAL's own upsert / delete never replace or remove an EDGE authority's row", async () => {
    await inRolledBackTx(async (tx) => {
      const { node, robot } = await nodeAndRobot(tx, "b");
      await own(tx, robot, node);
      const before = await lockRow(tx, robot);
      expect(before).toMatchObject({ authority: `edge:${node}`, reasonCode: "ownerChanged" });
      await deleteMotionLock(robot, 2_000_000); // scoped to authority 'central' ⇒ matches nothing (an unscoped one would be refused 23514 and abort the tx)
      await _flushMotionLockWritesForTests();
      expect(await lockRow(tx, robot)).toEqual(before);
      // a central upsert of an edge-owned robot: never replaces the edge row (the DB also refuses central writes for an edge-owned
      // robot — run in a savepoint so that refusal does not abort the outer transaction)
      try {
        await tx.transaction(async (sp: any) => {
          H.tx = sp;
          try {
            await persistMotionLock(robot, { locked: true, reasonCode: "central_says", since: new Date().toISOString(), generation: 2_000_000 });
            await _flushMotionLockWritesForTests();
          } finally {
            H.tx = tx;
          }
          throw new Rollback();
        });
      } catch (e) {
        if (!(e instanceof Rollback)) throw e;
      }
      expect(await lockRow(tx, robot)).toEqual(before);
    });
  });

  it("★ a GENERATION or OWNER-EPOCH mismatch is refused: a stale clear removes nothing, a stale apply is 23514; the matching clear removes it", async () => {
    await inRolledBackTx(async (tx) => {
      const { node, robot } = await nodeAndRobot(tx, "c");
      const epoch = await own(tx, robot, node);
      const g = Number((await lockRow(tx, robot)).generation);
      expect(await clearEdgeMotionLock(tx, { robotId: robot, nodeId: node, ownerEpoch: epoch, generation: g - 1 })).toBe(0); // older generation
      expect(await clearEdgeMotionLock(tx, { robotId: robot, nodeId: node, ownerEpoch: epoch - 1, generation: g })).toBe(0); // stale epoch
      expect(await codeOf(tx, () => applyEdgeMotionLock(tx, { robotId: robot, nodeId: node, ownerEpoch: epoch - 1, generation: g + 1, reasonCode: "late" }))).toBe("23514");
      expect(await lockRow(tx, robot)).toMatchObject({ authority: `edge:${node}`, generation: g, ownerEpoch: epoch });
      expect(await applyEdgeMotionLock(tx, { robotId: robot, nodeId: node, ownerEpoch: epoch, generation: g - 1, reasonCode: "older" })).toBe(false); // never backwards
      expect(await clearEdgeMotionLock(tx, { robotId: robot, nodeId: node, ownerEpoch: epoch, generation: g })).toBe(1);
      expect(await lockRow(tx, robot)).toBeNull();
    });
  });

  it("★ an OWNERSHIP TRANSFER starts locked: central refuses motion to the edge-owned robot (ROBOT_OWNED_BY_EDGE, session or not); after the transfer BACK it refuses on the ownerChanged row, adopts it, and the operator's clear (its generation) removes it", async () => {
    await inRolledBackTx(async (tx) => {
      const { node, robot } = await nodeAndRobot(tx, "d");
      attachMotionLockPersistence(robot, H.lock, { ok: true, rows: new Map() }); // central's registration: DB-mirrored lock
      expect((await dispatchRobotJob(MOTION(robot))).status).toBe("simulated"); // control: central robot, no row

      const e1 = await own(tx, robot, node);
      expect(await lockRow(tx, robot)).toMatchObject({ authority: `edge:${node}`, reasonCode: "ownerChanged", ownerEpoch: e1 });
      const owned = await dispatchRobotJob(MOTION(robot));
      expect(owned).toMatchObject({ ok: false, status: "rejected", error: ROBOT_OWNED_BY_EDGE });
      expect(H.lock.isLocked()).toBe(false); // an edge authority's lock is never adopted by central
      const stop = await dispatchRobotJob({ ...MOTION(robot), job: { jobType: "abort" as const, params: {} } });
      expect(stop.error).not.toBe(ROBOT_OWNED_BY_EDGE); // L-7: a STOP never reads the owner

      const e2 = await own(tx, robot, null);
      expect(e2).toBe(e1 + 1);
      const row = await lockRow(tx, robot);
      expect(row).toMatchObject({ authority: "central", reasonCode: "ownerChanged", ownerEpoch: e2 });
      const refused = await dispatchRobotJob(MOTION(robot));
      expect(refused).toMatchObject({ ok: false, status: "rejected", error: "MOTION_LOCKED" });
      expect(H.lock.snapshot()).toMatchObject({ locked: true, reasonCode: "ownerChanged", generation: Number(row.generation) });

      H.lock.clearByOperator({ reason: "verified on site", userId: 1, expectedGeneration: Number(row.generation) });
      await _flushMotionLockWritesForTests();
      expect(await lockRow(tx, robot)).toBeNull();
      expect((await dispatchRobotJob(MOTION(robot))).status).toBe("simulated");
    });
  });

  it("isEdgeControlRefusal maps the guard's 23514 (sanity of the oracle)", () => {
    expect(isEdgeControlRefusal({ code: "23514" })).toBe(true);
  });
});
