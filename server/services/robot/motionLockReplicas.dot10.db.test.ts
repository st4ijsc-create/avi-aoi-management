/**
 * doc 81 Đợt 10 task D fix review 1 — ruling R-10-u (N1 across central REPLICAS), `_test` as avi_app, rolled back.
 * Two API "processes" = two MotionLocks (each with its own persistence registry) sharing ONE database. Replica A locks a robot
 * (outcome unknown) ⇒ its central row. Replica B — whose own in-memory lock is clear — must NOT move the robot: the row is not
 * one B wrote and cleared ⇒ MOTION_LOCKED (fail-closed), adopted into B's lock so B's operator clear (quoting the generation)
 * removes it. The one exemption stays: a row THIS process wrote and then cleared itself (its DELETE in flight) does not re-lock it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sql } from "drizzle-orm";

const H = vi.hoisted(() => ({ tx: null as any, lock: null as any, runJobs: 0 }));
vi.mock("../../db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/connection")>();
  return { ...actual, getDb: vi.fn(async () => H.tx ?? actual.getDb()) };
});
vi.mock("./robotEnabledGate", () => ({ readRobotEnabledForMotion: async () => true }));
vi.mock("./robotManager", () => ({
  getActiveRobot: () => ({
    id: 0,
    code: "T",
    vendor: "sim",
    driver: {
      vendor: "sim",
      isConnected: () => true,
      getMotionLock: () => H.lock.snapshot(),
      motionLockController: () => H.lock,
      runJob: async () => {
        H.runJobs++;
        return { ok: true, status: "done" };
      },
    },
  }),
}));

import { getDb } from "../../db/connection";
import { attachMotionLockPersistence, _flushMotionLockWritesForTests } from "./robotMotionLockStore";
import { readCentralMotionAuthority } from "./robotSharedMotionLockGate";
import { dispatchRobotJob } from "./robotCommandDispatcher";
import { MotionLock } from "./robotDriver";

const onTest = /_test\b/.test(process.env.DATABASE_URL ?? "");
const TAG = `D10U-${Date.now()}`;
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
const MOTION = (robotId: number) => ({ robotId, job: { jobType: "home" as const, params: {} }, triggerKind: "manual" as const, requestedBy: 1, confirmedBy: 1 });

beforeEach(() => {
  delete process.env.ROBOT_CONTROL_ENABLED; // dry-run: a motion past every gate ends 'simulated'
  delete process.env.EDGE_EXECUTION_ENABLED;
  delete process.env.EDGE_GATEWAY_MODE;
  H.runJobs = 0;
});

describe.skipIf(!onTest)("R-10-u — a central lock set by ANOTHER replica refuses motion here (_test, rolled back)", () => {
  it("★ replica A locks ⇒ replica B (clear in memory) is REFUSED MOTION_LOCKED, adopts the lock, and its operator clear removes the row", async () => {
    await inRolledBackTx(async (tx) => {
      const [r] = await rows(tx, sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled") VALUES (${`${TAG}-R1`}, 'r', 'sim', 'sim://t', true) RETURNING id`);
      const robot = Number(r.id);
      const lockA = new MotionLock();
      const lockB = new MotionLock();
      attachMotionLockPersistence(robot, lockA, { ok: true, rows: new Map() }); // replica A's registration
      attachMotionLockPersistence(robot, lockB, { ok: true, rows: new Map() }); // replica B's registration
      lockA.lock("motion_outcome_unknown", "replica A: reply timeout");
      await _flushMotionLockWritesForTests();
      const [row] = await rows(tx, sql`SELECT generation, authority FROM robot_motion_locks WHERE "robotId" = ${robot}`);
      expect(row).toMatchObject({ authority: "central", generation: 1 });

      H.lock = lockB; // this process is replica B
      const refused = await dispatchRobotJob(MOTION(robot));
      expect(refused).toMatchObject({ ok: false, status: "rejected", error: "MOTION_LOCKED" });
      expect(H.runJobs).toBe(0);
      expect(lockB.snapshot()).toMatchObject({ locked: true, reasonCode: "motion_outcome_unknown", generation: 1 }); // adopted

      lockB.clearByOperator({ reason: "checked on site", userId: 1, expectedGeneration: 1 });
      await _flushMotionLockWritesForTests();
      expect(await rows(tx, sql`SELECT 1 FROM robot_motion_locks WHERE "robotId" = ${robot}`)).toHaveLength(0);
      expect((await dispatchRobotJob(MOTION(robot))).status).toBe("simulated");
    });
  });

  it("★ the exemption is per process: a row A wrote and cleared itself (delete still in flight) does not re-lock A — but it does refuse B", async () => {
    await inRolledBackTx(async (tx) => {
      const [r] = await rows(tx, sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled") VALUES (${`${TAG}-R2`}, 'r', 'sim', 'sim://t', true) RETURNING id`);
      const robot = Number(r.id);
      const lockA = new MotionLock();
      const lockB = new MotionLock();
      attachMotionLockPersistence(robot, lockA, { ok: true, rows: new Map() });
      attachMotionLockPersistence(robot, lockB, { ok: true, rows: new Map() });
      lockA.lock("line_connection_closed");
      await _flushMotionLockWritesForTests();
      const [saved] = await rows(tx, sql`SELECT "reasonCode", generation, "lockedAt" FROM robot_motion_locks WHERE "robotId" = ${robot}`);
      lockA.clearByStop();
      await _flushMotionLockWritesForTests();
      // the DELETE "still in flight": the very row A cleared is present again
      await tx.execute(sql`INSERT INTO robot_motion_locks ("robotId", "reasonCode", generation, "lockedAt") VALUES (${robot}, ${saved.reasonCode}, ${saved.generation}, ${saved.lockedAt})`);
      // (compared through the gate's own drizzle read — a raw postgres.js read of a naive timestamp is shifted by the TZ offset)
      expect(await readCentralMotionAuthority(robot, lockA)).toMatchObject({ ok: true });
      expect(await readCentralMotionAuthority(robot, lockB)).toMatchObject({ locked: true, authority: "central", generation: 1 });
      expect(await readCentralMotionAuthority(robot, null)).toMatchObject({ locked: true }); // no lock of its own ⇒ never exempt
    });
  });

  it("★ R-10-aj (re-review N1 probe) — B never REPLACES A's row: A locks motion_outcome_unknown, B locks too ⇒ ONE row, A's reason kept + both listed, generation bumped; the operator's clear via B (B's generation) does NOT remove it; B / C stay refused; B adopts and the clear naming the ROW's generation removes it", async () => {
    await inRolledBackTx(async (tx) => {
      const [r] = await rows(tx, sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled") VALUES (${`${TAG}-R3`}, 'r', 'sim', 'sim://t', true) RETURNING id`);
      const robot = Number(r.id);
      const [A, B, C] = [new MotionLock(), new MotionLock(), new MotionLock()];
      for (const l of [A, B, C]) attachMotionLockPersistence(robot, l, { ok: true, rows: new Map() });
      A.lock("motion_outcome_unknown", "replica A: reply timeout");
      await _flushMotionLockWritesForTests();
      B.lock("line_connection_closed", "replica B: peer dropped");
      await _flushMotionLockWritesForTests();
      const all = await rows(tx, sql`SELECT "reasonCode", generation, detail FROM robot_motion_locks WHERE "robotId" = ${robot}`);
      expect(all).toHaveLength(1);
      expect(all[0].reasonCode).toBe("motion_outcome_unknown"); // the strongest is kept — A's reason not replaced
      expect(String(all[0].detail)).toMatch(/motion_outcome_unknown[\s\S]*line_connection_closed/); // every reason listed
      expect(Number(all[0].generation)).toBe(2); // the write incremented the generation
      // the operator clears via B, quoting what B shows (generation 1) — the row is NOT removed
      B.clearByOperator({ reason: "checked", userId: 1, expectedGeneration: 1 });
      await _flushMotionLockWritesForTests();
      expect(await rows(tx, sql`SELECT 1 FROM robot_motion_locks WHERE "robotId" = ${robot}`)).toHaveLength(1);
      expect(await readCentralMotionAuthority(robot, B)).toMatchObject({ locked: true, reasonCode: "motion_outcome_unknown", generation: 2 });
      expect(await readCentralMotionAuthority(robot, C)).toMatchObject({ locked: true });
      // B adopts the row (motion refused) and shows ALL reasons at the ROW's generation; that clear removes it
      H.lock = B;
      expect(await dispatchRobotJob(MOTION(robot))).toMatchObject({ error: "MOTION_LOCKED" });
      const shown = B.snapshot();
      expect(shown).toMatchObject({ locked: true, reasonCode: "motion_outcome_unknown" });
      expect(String(shown.detail)).toMatch(/line_connection_closed/);
      B.clearByOperator({ reason: "both reasons checked on site", userId: 1, expectedGeneration: shown.generation! });
      await _flushMotionLockWritesForTests();
      expect(await rows(tx, sql`SELECT 1 FROM robot_motion_locks WHERE "robotId" = ${robot}`)).toHaveLength(0);
    });
  });
});
