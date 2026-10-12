/**
 * doc 81 Đợt 10 task A — migrations 0372–0375 on the `_test` DB, measured through the NARROW projections the groups will use
 * (edgeControlSchema.ts) and through the apply scripts themselves:
 *   • every projection selects (its columns exist with these names);
 *   • the triggers behave through drizzle as avi_app: ownership change logged WORM with the actor of setEdgeOwnershipActor,
 *     the floor raised, refused while a job runs; cursors start at 0 and never go back; key status one-way;
 *   • the apply scripts re-run idempotently (--test-only, both URLs pinned to _test) and refuse to run without a target flag;
 *   • isEdgeControlSchemaMissing recognises 42703 / 42P01.
 * Every write happens in a transaction that is rolled back.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { integer, pgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { getDb } from "../../db/connection";
import {
  EDGE_CONTROL_MIGRATIONS,
  adapterOwnership,
  deviceOwnerChanges,
  edgeAuthSigningKeys,
  edgeLockRowMatch,
  edgeNodeProgramReports,
  edgeNodeProtocol,
  edgeNodeReportCursors,
  edgeRobotTrustApprovals,
  edgeStepAuthorizations,
  isEdgeControlRefusal,
  isEdgeControlSchemaMissing,
  robotMotionLockAuthority,
  robotMotionLockRequests,
  robotOwnership,
  setEdgeOwnershipActor,
} from "./edgeControlSchema";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const REPO = path.resolve(__dirname, "../../..");

class Rollback extends Error {}
async function inRolledBackTx<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  const d = await getDb();
  if (!d) throw new Error("no DB");
  let out: T | undefined;
  try {
    await d.transaction(async (tx) => {
      out = await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return out as T;
}
async function codeOf(tx: any, p: Promise<unknown>): Promise<string | null> {
  try {
    await tx.transaction(async () => p);
    return null;
  } catch (e) {
    const c = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
    return c ?? String((e as Error).message);
  }
}

describe.skipIf(!onTest)("0372–0375 on _test through the narrow projections", () => {
  it("every projection selects (columns exist under these names)", async () => {
    const d = (await getDb())!;
    for (const t of [edgeStepAuthorizations, edgeNodeReportCursors, edgeNodeProgramReports, edgeAuthSigningKeys, edgeNodeProtocol, robotOwnership, adapterOwnership, robotMotionLockAuthority, robotMotionLockRequests, deviceOwnerChanges, edgeRobotTrustApprovals]) {
      await expect(d.select().from(t as never).limit(1)).resolves.toBeInstanceOf(Array);
    }
    const ledger = (await d.execute(sql`SELECT filename FROM "__applied_migrations" WHERE filename LIKE '037%'`)) as unknown as Array<{ filename: string }>;
    const names = new Set(ledger.map((r) => r.filename));
    expect(EDGE_CONTROL_MIGRATIONS.filter((f) => names.has(f))).toEqual([...EDGE_CONTROL_MIGRATIONS]);
  });

  it("ownership change: WORM history with the named actor, floor raised past the lock generation, refused while a job runs", async () => {
    const CODE = `__dot10A_own_${Date.now()}`;
    const out = await inRolledBackTx(async (tx) => {
      const [node] = (await tx.execute(sql`INSERT INTO edge_nodes (code, name, status) VALUES (${CODE}, ${CODE}, 'offline') RETURNING id`)) as Array<{ id: number }>;
      const [robot] = (await tx.execute(sql`INSERT INTO robots (code, name, vendor, endpoint) VALUES (${CODE}, ${CODE}, 'sim', 'sim://t') RETURNING id`)) as Array<{ id: number }>;
      const [busy] = (await tx.execute(sql`INSERT INTO robots (code, name, vendor, endpoint) VALUES (${CODE + "b"}, ${CODE}, 'sim', 'sim://t') RETURNING id`)) as Array<{ id: number }>;
      await tx.insert(robotMotionLockAuthority).values({ robotId: robot.id, reasonCode: "t", generation: 9 });
      await setEdgeOwnershipActor(tx, `admin:${CODE}`);
      await tx.update(robotOwnership).set({ edgeNodeId: node.id }).where(eq(robotOwnership.id, robot.id));
      const [own] = await tx.select().from(robotOwnership).where(eq(robotOwnership.id, robot.id));
      const hist = await tx.select().from(deviceOwnerChanges).where(and(eq(deviceOwnerChanges.deviceKind, "robot"), eq(deviceOwnerChanges.deviceId, robot.id)));
      await tx.execute(sql`INSERT INTO robot_jobs ("robotId", "jobType", status) VALUES (${busy.id}, 'move', 'running')`);
      const busyChange = await codeOf(tx, tx.update(robotOwnership).set({ edgeNodeId: node.id }).where(eq(robotOwnership.id, busy.id)));
      const lockOther = await codeOf(tx, tx.update(robotMotionLockAuthority).set({ authority: `edge:${node.id + 1000000}` }).where(eq(robotMotionLockAuthority.robotId, robot.id)));
      const lockOwner = await codeOf(tx, tx.update(robotMotionLockAuthority).set({ authority: `edge:${node.id}` }).where(eq(robotMotionLockAuthority.robotId, robot.id)));
      return { own, hist, busyChange, lockOther, lockOwner };
    });
    expect(out.own.motionLockGenerationFloor).toBe(10);
    expect(out.hist).toHaveLength(1);
    expect(out.hist[0]).toMatchObject({ fromEdgeNodeId: null, generationFloor: 10, changedBy: expect.stringContaining("admin:__dot10A_own_") });
    expect(out.busyChange).toBe("23514");
    expect(out.lockOther).toBe("23514");
    expect(out.lockOwner).toBeNull();
    expect(isEdgeControlRefusal({ code: "23514" })).toBe(true);
  });

  it("★ R-10-b: an owner change re-locks the robot under the new authority + epoch; stale-epoch lock events are refused / match nothing", async () => {
    const CODE = `__dot10A_epoch_${Date.now()}`;
    const out = await inRolledBackTx(async (tx) => {
      const [node] = (await tx.execute(sql`INSERT INTO edge_nodes (code, name, status) VALUES (${CODE}, ${CODE}, 'offline') RETURNING id`)) as Array<{ id: number }>;
      const [robot] = (await tx.execute(sql`INSERT INTO robots (code, name, vendor, endpoint) VALUES (${CODE}, ${CODE}, 'sim', 'sim://t') RETURNING id`)) as Array<{ id: number }>;
      await tx.update(robotOwnership).set({ edgeNodeId: node.id }).where(eq(robotOwnership.id, robot.id));
      const [own] = await tx.select().from(robotOwnership).where(eq(robotOwnership.id, robot.id));
      const [lock] = await tx.select().from(robotMotionLockAuthority).where(eq(robotMotionLockAuthority.robotId, robot.id));
      const staleApply = await tx.update(robotMotionLockAuthority).set({ generation: 99 }).where(edgeLockRowMatch(robot.id, node.id, own.ownerEpoch - 1)).returning({ id: robotMotionLockAuthority.robotId });
      const staleWrite = await codeOf(tx, tx.update(robotMotionLockAuthority).set({ ownerEpoch: own.ownerEpoch - 1, generation: lock.generation + 1 }).where(eq(robotMotionLockAuthority.robotId, robot.id)));
      const currentApply = await tx.update(robotMotionLockAuthority).set({ generation: lock.generation + 1 }).where(edgeLockRowMatch(robot.id, node.id, own.ownerEpoch)).returning({ id: robotMotionLockAuthority.robotId });
      const manualEpoch = await codeOf(tx, tx.update(robotOwnership).set({ ownerEpoch: own.ownerEpoch + 5 }).where(eq(robotOwnership.id, robot.id)));
      return { own, lock, staleApply: staleApply.length, staleWrite, currentApply: currentApply.length, manualEpoch };
    });
    expect(out.own.ownerEpoch).toBe(2);
    expect(out.lock).toMatchObject({ authority: expect.stringMatching(/^edge:\d+$/), ownerEpoch: 2, reasonCode: "ownerChanged", generation: out.own.motionLockGenerationFloor });
    expect(out).toMatchObject({ staleApply: 0, staleWrite: "23514", currentApply: 1, manualEpoch: "23514" });
  });

  it("★ R-10-b: a node deleted and re-created under the SAME id cannot apply / clear the old (authority, epoch)", async () => {
    const CODE = `__dot10A_reuse_${Date.now()}`;
    const out = await inRolledBackTx(async (tx) => {
      const [node] = (await tx.execute(sql`INSERT INTO edge_nodes (code, name, status) VALUES (${CODE}, ${CODE}, 'offline') RETURNING id`)) as Array<{ id: number }>;
      const [robot] = (await tx.execute(sql`INSERT INTO robots (code, name, vendor, endpoint) VALUES (${CODE}, ${CODE}, 'sim', 'sim://t') RETURNING id`)) as Array<{ id: number }>;
      await tx.update(robotOwnership).set({ edgeNodeId: node.id }).where(eq(robotOwnership.id, robot.id)); // epoch 2
      const nodeDelWhileOwner = await codeOf(tx, tx.execute(sql`DELETE FROM edge_nodes WHERE id = ${node.id}`));
      await tx.update(robotOwnership).set({ edgeNodeId: null }).where(eq(robotOwnership.id, robot.id)); // epoch 3, row central
      await tx.execute(sql`DELETE FROM edge_nodes WHERE id = ${node.id}`);
      await tx.execute(sql`INSERT INTO edge_nodes (id, code, name, status) VALUES (${node.id}, ${CODE + "-reused"}, ${CODE}, 'offline')`);
      await tx.update(robotOwnership).set({ edgeNodeId: node.id }).where(eq(robotOwnership.id, robot.id)); // epoch 4
      const oldClear = await tx.delete(robotMotionLockAuthority).where(edgeLockRowMatch(robot.id, node.id, 2)).returning({ id: robotMotionLockAuthority.robotId });
      const oldApply = await codeOf(tx, tx.update(robotMotionLockAuthority).set({ ownerEpoch: 2 }).where(eq(robotMotionLockAuthority.robotId, robot.id)));
      const [still] = await tx.select().from(robotMotionLockAuthority).where(eq(robotMotionLockAuthority.robotId, robot.id));
      return { nodeDelWhileOwner, oldClear: oldClear.length, oldApply, still };
    });
    expect(out.nodeDelWhileOwner).toBe("23503");
    expect(out.oldClear).toBe(0);
    expect(out.oldApply).toBe("23514");
    expect(out.still).toMatchObject({ ownerEpoch: 4, reasonCode: "ownerChanged" });
  });

  it("report cursor starts at 0 and never goes back; key status is one-way", async () => {
    const CODE = `__dot10A_cur_${Date.now()}`;
    const out = await inRolledBackTx(async (tx) => {
      const [node] = (await tx.execute(sql`INSERT INTO edge_nodes (code, name, status) VALUES (${CODE}, ${CODE}, 'offline') RETURNING id`)) as Array<{ id: number }>;
      const ep = "a".repeat(32);
      await tx.insert(edgeNodeReportCursors).values({ edgeNodeId: node.id, stream: "events", epoch: ep });
      const startHigh = await codeOf(tx, tx.insert(edgeNodeReportCursors).values({ edgeNodeId: node.id, stream: "robot_state", epoch: ep, lastSeq: 3 }));
      await tx.update(edgeNodeReportCursors).set({ lastSeq: 5 }).where(eq(edgeNodeReportCursors.edgeNodeId, node.id));
      const back = await codeOf(tx, tx.update(edgeNodeReportCursors).set({ lastSeq: 4 }).where(eq(edgeNodeReportCursors.edgeNodeId, node.id)));
      const kid = "edk_" + "Q".repeat(22);
      await tx.insert(edgeAuthSigningKeys).values({ kid, publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----\n", status: "active", createdBy: CODE });
      await tx.update(edgeAuthSigningKeys).set({ status: "retired", retiredAt: new Date() }).where(eq(edgeAuthSigningKeys.kid, kid));
      const unretire = await codeOf(tx, tx.update(edgeAuthSigningKeys).set({ status: "active", retiredAt: null }).where(eq(edgeAuthSigningKeys.kid, kid)));
      return { startHigh, back, unretire };
    });
    expect(out).toEqual({ startHigh: "23514", back: "23514", unretire: "23514" });
  });

  it("isEdgeControlSchemaMissing recognises an absent column (42703) / table (42P01)", async () => {
    const d = (await getDb())!;
    const ghostCol = pgTable("robots", { nope: integer("__dot10_no_such_column") });
    const ghostTable = pgTable("__dot10_no_such_table", { id: integer("id") });
    for (const t of [ghostCol, ghostTable]) {
      const err = await d.select().from(t as never).limit(1).then(() => null, (e: unknown) => e);
      expect(isEdgeControlSchemaMissing(err)).toBe(true);
    }
    expect(isEdgeControlSchemaMissing({ code: "23514" })).toBe(false);
  });

  it("the apply scripts re-run idempotently on _test and refuse without exactly one target flag", () => {
    for (const n of ["0372", "0373", "0374", "0375"]) {
      const r = spawnSync(process.execPath, [path.join(REPO, "scripts", `apply-migration-${n}.mjs`), "--test-only"], {
        env: { ...process.env, DATABASE_URL: DB_URL, TEST_DATABASE_URL: DB_URL },
        encoding: "utf8",
        timeout: 120_000,
      });
      expect(r.status, `${n}: ${r.stdout}\n${r.stderr}`).toBe(0);
      expect(r.stdout).toContain("applied + verified");
    }
    const none = spawnSync(process.execPath, [path.join(REPO, "scripts", "apply-migration-0373.mjs")], { env: { ...process.env, DATABASE_URL: DB_URL, TEST_DATABASE_URL: DB_URL }, encoding: "utf8" });
    expect(none.status).toBe(2);
    expect(none.stderr).toMatch(/DUNG MOT dich/);
  }, 400_000);
});
