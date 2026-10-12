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
