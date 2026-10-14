/**
 * doc 81 Đợt 12 task N (OWNER-SETUP B2) — a central robot whose driver has NO motion-lock controller (one-shot transports:
 * Techman / UR / VDA5050) but whose robot_motion_locks row carries a lock — e.g. the DB's `ownerChanged` relock written when the
 * device is released from an edge (mig 0374 robot_owner_relock). Central refuses every motion on that row
 * (readCentralMotionAuthority), and robot.clearMotionLock used to answer `motionLockUnsupported`: the robot stayed locked for ever
 * (only a hand-written DELETE released it).
 *
 * Now that lock is clearable ONLY through the existing audited path, measured on the `_test` DB as avi_app, every case inside ONE
 * rolled-back transaction (getDb → that transaction; the router, audit, owner read, scope read and dispatcher all real):
 *   • factory scope (R-10-bt): outside the caller's scope ⇒ the same NOT_FOUND; nothing audited, the row stays;
 *   • a reason is required (zod trim ≥ 3) ⇒ BAD_REQUEST; the row stays;
 *   • the generation the operator saw must be the row's ⇒ else CONFLICT motionLockChanged, nothing audited, the row stays;
 *   • the audit row is written FIRST, then EXACTLY that row (generation, lockedAt ms, writerInstanceId, owner epoch, authority
 *     'central', robot still central-owned) is deleted by the guarded helper — a row replaced meanwhile is never touched;
 *   • NEVER automatically: a STOP to the robot leaves the row (a one-shot driver confirms nothing to clear it with);
 *   • robot.list / robot.get show the persisted lock in `live.motionLock` (the UI's clear button sends its generation);
 *   • no row ⇒ `motionLockUnsupported` exactly as before.
 * Oracle: rows read by plain SQL in the same transaction; dispatcher decisions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const H = vi.hoisted(() => ({ tx: null as any, robotId: 0, lines: null as null | number[], stops: 0, auditFail: false, relockBeforeDelete: false, readError: false }));
// the real guarded delete — with a NEW relock landing just before it on demand (the row read is no longer the row stored)
vi.mock("../services/robot/robotMotionLockStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/robot/robotMotionLockStore")>();
  return {
    ...actual,
    readPersistedMotionLockRow: async (...a: Parameters<typeof actual.readPersistedMotionLockRow>) =>
      H.readError ? { error: "simulated read failure" } : actual.readPersistedMotionLockRow(...a),
    clearPersistedCentralMotionLock: async (...a: Parameters<typeof actual.clearPersistedCentralMotionLock>) => {
      if (H.relockBeforeDelete) {
        const { sql: q } = await import("drizzle-orm");
        await H.tx.execute(q`UPDATE robot_motion_locks SET generation = generation + 1, "lockedAt" = now() + interval '1 second' WHERE "robotId" = ${a[0]}`);
      }
      return actual.clearPersistedCentralMotionLock(...a);
    },
  };
});
// the real audit writer — made to FAIL on demand (audit FIRST: no trail ⇒ nothing cleared)
vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db")>();
  return {
    ...actual,
    createAuditLog: async (...a: Parameters<typeof actual.createAuditLog>) => {
      if (H.auditFail) throw new Error("audit insert failed (simulated)");
      return actual.createAuditLog(...a);
    },
  };
});
vi.mock("../db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/connection")>();
  return { ...actual, getDb: vi.fn(async () => H.tx ?? actual.getDb()) };
});
vi.mock("../db/hierarchy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/hierarchy")>()),
  idsTrongPhamVi: async (kind: string) => (H.lines === null ? null : kind === "line" ? H.lines : []),
}));
vi.mock("../_core/accessControl", () => ({ requirePermission: () => async ({ ctx, next }: any) => next({ ctx }) }));
// the robot central holds a session for — a ONE-SHOT driver: no getMotionLock / clearMotionLock / motionLockController
vi.mock("../services/robot/robotManager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/robot/robotManager")>()),
  getActiveRobot: (id: number) =>
    id === H.robotId && id > 0
      ? {
          id,
          code: `R${id}`,
          vendor: "techman",
          driver: {
            vendor: "techman",
            isConnected: () => true,
            runJob: async () => ({ ok: true, status: "done" }),
            abort: async () => void H.stops++,
          },
        }
      : undefined,
}));

import { getDb } from "../db/connection";
import { robotRouter } from "./robotRouter";
import { dispatchRobotJob } from "../services/robot/robotCommandDispatcher";
import { clearPersistedCentralMotionLock, readPersistedMotionLockRow } from "../services/robot/robotMotionLockStore";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const TAG = `D12N-${Date.now()}`;

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: any) => Promise<void>): Promise<void> {
  const d = (await getDb())!;
  try {
    await d.transaction(async (tx) => {
      H.tx = tx;
      try {
        await fn(tx);
      } finally {
        H.tx = null;
        H.robotId = 0;
      }
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}
const rows = async (tx: any, q: ReturnType<typeof sql>) => (await tx.execute(q)) as Array<Record<string, any>>;
const lockRow = async (tx: any, robotId: number): Promise<Record<string, any> | null> => {
  const r = (await rows(tx, sql`SELECT "reasonCode", generation, authority, "ownerEpoch", "writerInstanceId" FROM robot_motion_locks WHERE "robotId" = ${robotId}`))[0];
  return r ? { ...r, generation: Number(r.generation), ownerEpoch: r.ownerEpoch == null ? null : Number(r.ownerEpoch) } : null;
};
const audits = async (tx: any, robotId: number): Promise<Array<Record<string, any>>> =>
  (await rows(tx, sql`SELECT action, status, "userId", details FROM audit_logs WHERE "entityType" = 'robot' AND "entityId" = ${robotId} AND action = 'robot.clearMotionLock' ORDER BY id`)).map((a) => ({
    ...a,
    details: typeof a.details === "string" ? JSON.parse(a.details) : a.details,
  }));

/** a central robot released from an edge node: the DB's relock leaves a central `ownerChanged` row (mig 0374) */
async function releasedRobot(tx: any, suffix: string): Promise<{ robot: number; line: number }> {
  const [line] = await rows(tx, sql`SELECT id FROM production_lines ORDER BY id LIMIT 1`);
  const [n] = await rows(tx, sql`INSERT INTO edge_nodes (code, name, status) VALUES (${`${TAG}-N${suffix}`}, 'n', 'offline') RETURNING id`);
  const [r] = await rows(tx, sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId") VALUES (${`${TAG}-R${suffix}`}, 'r', 'techman', 'tcp://127.0.0.1:1', true, ${Number(line.id)}) RETURNING id`);
  await tx.execute(sql`UPDATE robots SET "edgeNodeId" = ${Number(n.id)} WHERE id = ${Number(r.id)}`);
  await tx.execute(sql`UPDATE robots SET "edgeNodeId" = NULL WHERE id = ${Number(r.id)}`);
  H.robotId = Number(r.id);
  return { robot: Number(r.id), line: Number(line.id) };
}
const MOTION = (robotId: number) => ({ robotId, job: { jobType: "home" as const, params: {} }, triggerKind: "manual" as const, requestedBy: 1, confirmedBy: 1 });
const engineer = () => robotRouter.createCaller({ user: { id: 7, role: "engineer", name: "Eng N", twoFactorEnabled: true } } as any);
async function errOf(p: Promise<unknown>): Promise<TRPCError> {
  const e = await p.then(
    () => null,
    (x) => x,
  );
  expect(e).toBeInstanceOf(TRPCError);
  return e as TRPCError;
}

beforeEach(() => {
  H.lines = null;
  H.stops = 0;
  H.auditFail = false;
  H.relockBeforeDelete = false;
  H.readError = false;
  delete process.env.ROBOT_CONTROL_ENABLED; // dry-run: a motion that passes every gate ends 'simulated'
  delete process.env.EDGE_EXECUTION_ENABLED;
  delete process.env.EDGE_GATEWAY_MODE;
});

describe.skipIf(!onTest)("doc 81 Đợt 12 N — clearing a persisted lock of a central robot whose driver has no motion lock (_test, rolled back)", () => {
  it("★ released from an edge ⇒ central row ownerChanged, motion refused, a STOP does NOT clear it; robot.list shows it; the audited clear (scope, reason, generation) removes exactly it ⇒ motion allowed", async () => {
    await inRolledBackTx(async (tx) => {
      const { robot, line } = await releasedRobot(tx, "a");
      const row = await lockRow(tx, robot);
      expect(row).toMatchObject({ authority: "central", reasonCode: "ownerChanged" });
      expect(await dispatchRobotJob(MOTION(robot))).toMatchObject({ ok: false, status: "rejected", error: "MOTION_LOCKED" });

      // never automatically: a STOP reaches the robot (L-7) and the row stays
      const stop = await dispatchRobotJob({ ...MOTION(robot), job: { jobType: "abort" as const, params: {} } });
      expect(stop.error).not.toBe("MOTION_LOCKED");
      expect(await lockRow(tx, robot)).toEqual(row);

      // the UI reads the lock (and its generation) where it reads every lock: live.motionLock
      const listed = ((await engineer().list()) as any[]).find((r) => r.id === robot);
      expect(listed.live).toMatchObject({ active: true, connected: true, motionLock: { locked: true, reasonCode: "ownerChanged", generation: row!.generation } });
      expect(((await engineer().get({ id: robot })) as any).live.motionLock).toMatchObject({ locked: true, generation: row!.generation });

      H.lines = [line];
      const out = await engineer().clearMotionLock({ robotId: robot, reason: "Dot 12 N: cell checked after the edge trial", expectedGeneration: row!.generation });
      expect(out).toMatchObject({ robotId: robot, changed: true, motionLock: { locked: false, clearedBy: "operator", clearedByUserId: 7, generation: row!.generation } });
      expect(await lockRow(tx, robot)).toBeNull();
      const a = await audits(tx, robot);
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ status: "success", userId: 7 });
      expect(a[0].details).toMatchObject({
        reason: "Dot 12 N: cell checked after the edge trial",
        via: "persisted_row",
        expectedGeneration: row!.generation,
        before: { reasonCode: "ownerChanged", generation: row!.generation, writerInstanceId: row!.writerInstanceId, ownerEpoch: row!.ownerEpoch },
      });
      expect((await dispatchRobotJob(MOTION(robot))).status).toBe("simulated");
      // a second clear: nothing left ⇒ the pre-Đợt-12 answer
      const again = await errOf(engineer().clearMotionLock({ robotId: robot, reason: "again please", expectedGeneration: row!.generation }));
      expect((again.cause as any)?.appParams).toMatchObject({ operation: "clearRobotMotionLock", reason: "motionLockUnsupported" });
    });
  });

  it("★ OUT OF SCOPE ⇒ NOT_FOUND (same as a missing robot); nothing audited, the row stays", async () => {
    await inRolledBackTx(async (tx) => {
      const { robot, line } = await releasedRobot(tx, "b");
      const row = await lockRow(tx, robot);
      H.lines = [line + 1_000_000];
      const e = await errOf(engineer().clearMotionLock({ robotId: robot, reason: "Dot 12 N out of scope", expectedGeneration: row!.generation }));
      expect(e.code).toBe("NOT_FOUND");
      const missing = await errOf(engineer().clearMotionLock({ robotId: 2_000_000_000, reason: "Dot 12 N out of scope", expectedGeneration: row!.generation }));
      expect(missing.code).toBe("NOT_FOUND");
      expect(await lockRow(tx, robot)).toEqual(row);
      expect(await audits(tx, robot)).toEqual([]);
    });
  });

  it("★ NO REASON (empty / blank / too short) ⇒ BAD_REQUEST; the row stays, nothing audited", async () => {
    await inRolledBackTx(async (tx) => {
      const { robot } = await releasedRobot(tx, "c");
      const row = await lockRow(tx, robot);
      for (const reason of ["", "   ", "ok"]) {
        const e = await errOf(engineer().clearMotionLock({ robotId: robot, reason, expectedGeneration: row!.generation }));
        expect(e.code, JSON.stringify(reason)).toBe("BAD_REQUEST");
      }
      const e = await errOf((engineer() as any).clearMotionLock({ robotId: robot, expectedGeneration: row!.generation }));
      expect(e.code).toBe("BAD_REQUEST");
      expect(await lockRow(tx, robot)).toEqual(row);
      expect(await audits(tx, robot)).toEqual([]);
    });
  });

  it("★ STALE GENERATION ⇒ CONFLICT motionLockChanged before any audit; the row stays; motion still refused", async () => {
    await inRolledBackTx(async (tx) => {
      const { robot } = await releasedRobot(tx, "d");
      const row = await lockRow(tx, robot);
      for (const g of [row!.generation - 1, row!.generation + 1]) {
        const e = await errOf(engineer().clearMotionLock({ robotId: robot, reason: "Dot 12 N stale generation", expectedGeneration: Math.max(0, g) }));
        expect(e.code).toBe("CONFLICT");
        expect((e.cause as any)?.appParams).toMatchObject({ operation: "clearRobotMotionLock", reason: "motionLockChanged" });
      }
      expect(await lockRow(tx, robot)).toEqual(row);
      expect(await audits(tx, robot)).toEqual([]);
      expect(await dispatchRobotJob(MOTION(robot))).toMatchObject({ ok: false, error: "MOTION_LOCKED" });
    });
  });

  it("★ the guarded helper deletes EXACTLY the row read (generation, lockedAt, writer, owner epoch, central, central-owned) — a row replaced meanwhile, an edge-owned robot: 0 rows", async () => {
    await inRolledBackTx(async (tx) => {
      const { robot } = await releasedRobot(tx, "e");
      const read = await readPersistedMotionLockRow(robot);
      expect("row" in read && read.row).toBeTruthy();
      const r = (read as { row: NonNullable<Extract<typeof read, { row: unknown }>["row"]> }).row;
      const id = { generation: r.generation, lockedAtMs: r.lockedAtMs, writerInstanceId: r.writerInstanceId, ownerEpoch: r.ownerEpoch };
      expect(await clearPersistedCentralMotionLock(robot, { ...id, generation: id.generation + 1 })).toBe(0);
      expect(await clearPersistedCentralMotionLock(robot, { ...id, lockedAtMs: id.lockedAtMs + 1 })).toBe(0);
      expect(await clearPersistedCentralMotionLock(robot, { ...id, writerInstanceId: "00000000-0000-4000-8000-000000000001" })).toBe(0);
      expect(await clearPersistedCentralMotionLock(robot, { ...id, ownerEpoch: (id.ownerEpoch ?? 0) + 1 })).toBe(0);
      expect(await lockRow(tx, robot)).not.toBeNull();
      // owned by an edge again: the relock made it an edge row — the old identity matches nothing, never an edge authority's row
      const [n] = await rows(tx, sql`INSERT INTO edge_nodes (code, name, status) VALUES (${`${TAG}-Ne2`}, 'n', 'offline') RETURNING id`);
      await tx.execute(sql`UPDATE robots SET "edgeNodeId" = ${Number(n.id)} WHERE id = ${robot}`);
      expect(await clearPersistedCentralMotionLock(robot, id)).toBe(0);
      expect((await lockRow(tx, robot))?.authority).toBe(`edge:${Number(n.id)}`);
      // … not even with the EDGE row's own identity: an edge authority's row is never deleted here (no 23514 either)
      const edgeRead = await readPersistedMotionLockRow(robot);
      const er = (edgeRead as { row: NonNullable<Extract<typeof edgeRead, { row: unknown }>["row"]> }).row;
      expect(er.authority).toBe(`edge:${Number(n.id)}`);
      expect(await clearPersistedCentralMotionLock(robot, { generation: er.generation, lockedAtMs: er.lockedAtMs, writerInstanceId: er.writerInstanceId, ownerEpoch: er.ownerEpoch })).toBe(0);
      expect((await lockRow(tx, robot))?.authority).toBe(`edge:${Number(n.id)}`);
    });
  });

  it("★ the audit row cannot be written ⇒ the clear fails and the row STAYS (audit first, fail-closed)", async () => {
    await inRolledBackTx(async (tx) => {
      const { robot } = await releasedRobot(tx, "g");
      const row = await lockRow(tx, robot);
      H.auditFail = true;
      await expect(engineer().clearMotionLock({ robotId: robot, reason: "Dot 12 N audit down", expectedGeneration: row!.generation })).rejects.toBeInstanceOf(Error);
      expect(await lockRow(tx, robot)).toEqual(row);
      expect(await dispatchRobotJob(MOTION(robot))).toMatchObject({ ok: false, error: "MOTION_LOCKED" });
    });
  });

  it("★ the row CHANGED between the read and the delete (a new lock landed) ⇒ CONFLICT, the new row stays, a 'failure' audit row follows the first", async () => {
    await inRolledBackTx(async (tx) => {
      const { robot } = await releasedRobot(tx, "h");
      const row = await lockRow(tx, robot);
      H.relockBeforeDelete = true;
      const e = await errOf(engineer().clearMotionLock({ robotId: robot, reason: "Dot 12 N race", expectedGeneration: row!.generation }));
      expect(e.code).toBe("CONFLICT");
      expect((e.cause as any)?.appParams).toMatchObject({ operation: "clearRobotMotionLock", reason: "motionLockChanged" });
      expect(e.message).toMatch(new RegExp(`generation ${row!.generation + 1}`));
      expect(await lockRow(tx, robot)).toMatchObject({ generation: row!.generation + 1, reasonCode: "ownerChanged" });
      expect((await audits(tx, robot)).map((a) => a.status)).toEqual(["success", "failure"]);
      expect(await dispatchRobotJob(MOTION(robot))).toMatchObject({ ok: false, error: "MOTION_LOCKED" });
    });
  });

  it("★ the persisted row cannot be READ ⇒ refused (DB_UNAVAILABLE), nothing audited, the row stays (fail-closed)", async () => {
    await inRolledBackTx(async (tx) => {
      const { robot } = await releasedRobot(tx, "i");
      const row = await lockRow(tx, robot);
      H.readError = true;
      const e = await errOf(engineer().clearMotionLock({ robotId: robot, reason: "Dot 12 N read down", expectedGeneration: row!.generation }));
      expect(e.code).toBe("INTERNAL_SERVER_ERROR");
      expect((e.cause as any)?.appCode).toBe("DB_UNAVAILABLE");
      expect(await lockRow(tx, robot)).toEqual(row);
      expect(await audits(tx, robot)).toEqual([]);
    });
  });

  it("control: a lockless robot with NO row still answers motionLockUnsupported (unchanged)", async () => {
    await inRolledBackTx(async (tx) => {
      const { robot } = await releasedRobot(tx, "f");
      await tx.execute(sql`DELETE FROM robot_motion_locks WHERE "robotId" = ${robot}`);
      const e = await errOf(engineer().clearMotionLock({ robotId: robot, reason: "Dot 12 N control", expectedGeneration: 0 }));
      expect(e.code).toBe("PRECONDITION_FAILED");
      expect((e.cause as any)?.appParams).toMatchObject({ operation: "clearRobotMotionLock", reason: "motionLockUnsupported" });
      expect(await audits(tx, robot)).toEqual([]);
    });
  });
});
