/**
 * doc 81 Đợt 10 task A — migrations 0372–0375 on the `_test` DB, measured through the NARROW projections and guarded helpers
 * the groups will use (edgeControlSchema.ts) and through the apply scripts themselves, as avi_app:
 *   • every projection selects (its columns exist with these names);
 *   • ownership: WORM history with the actor of setEdgeOwnershipActor, floor raised, refused while a job runs;
 *   • R-10-b owner epoch: an owner change re-locks the robot under the new authority + epoch IN THE SAME statement; stale-epoch
 *     lock events are refused / match nothing; a node re-created under the same id cannot touch the old authority;
 *   • fix scan 2 safety-lock: avi_app cannot UPDATE / DELETE / move an edge-authority row directly — only applyEdgeMotionLock /
 *     clearEdgeMotionLock (matched, generation-checked); central rows of central robots behave as before;
 *   • fix scan 2 maker-checker: avi_app cannot write trust approvals directly; an editor since the last approval (the creator
 *     included) can never approve; an owner change / digest change invalidates the approval;
 *   • R-10-c: avi_app cannot plant a signing-key row (the mirror is the owner's);
 *   • cursors start at 0 and never go back; the apply scripts re-run idempotently and refuse without a target flag.
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
  applyEdgeMotionLock,
  approveEdgeRobotTrust,
  clearEdgeMotionLock,
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
  isEdgeRobotTrustApproved,
  requestEdgeRobotTrust,
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
async function codeOf(tx: any, p: () => Promise<unknown>): Promise<string | null> {
  try {
    await tx.transaction(async () => p());
    return null;
  } catch (e) {
    const c = (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;
    return c ?? String((e as Error).message);
  }
}
const one = async (tx: any, q: ReturnType<typeof sql>) => ((await tx.execute(q)) as Array<Record<string, any>>)[0];
async function nodeRobot(tx: any, code: string) {
  const node = await one(tx, sql`INSERT INTO edge_nodes (code, name, status) VALUES (${code}, ${code}, 'offline') RETURNING id`);
  const robot = await one(tx, sql`INSERT INTO robots (code, name, vendor, endpoint) VALUES (${code}, ${code}, 'sim', 'sim://t') RETURNING id`);
  return { node: node.id as number, robot: robot.id as number };
}

describe.skipIf(!onTest)("0372–0375 on _test through the narrow projections", () => {
  it("every projection selects (columns exist under these names); the ledger holds the four files", async () => {
    const d = (await getDb())!;
    for (const t of [edgeStepAuthorizations, edgeNodeReportCursors, edgeNodeProgramReports, edgeAuthSigningKeys, edgeNodeProtocol, robotOwnership, adapterOwnership, robotMotionLockAuthority, robotMotionLockRequests, deviceOwnerChanges, edgeRobotTrustApprovals]) {
      await expect(d.select().from(t as never).limit(1)).resolves.toBeInstanceOf(Array);
    }
    const ledger = (await d.execute(sql`SELECT filename FROM "__applied_migrations" WHERE filename LIKE '037%'`)) as unknown as Array<{ filename: string }>;
    const names = new Set(ledger.map((r) => r.filename));
    expect(EDGE_CONTROL_MIGRATIONS.filter((f) => names.has(f))).toEqual([...EDGE_CONTROL_MIGRATIONS]);
  });

  it("ownership change: WORM history with the named actor, floor raised past the lock generation, refused while a job runs", async () => {
    const out = await inRolledBackTx(async (tx) => {
      const { node, robot } = await nodeRobot(tx, `__dot10A_own_${Date.now()}`);
      const busy = (await one(tx, sql`INSERT INTO robots (code, name, vendor, endpoint) VALUES (${"__dot10A_busy_" + Date.now()}, 'b', 'sim', 'sim://t') RETURNING id`)).id;
      await tx.insert(robotMotionLockAuthority).values({ robotId: robot, reasonCode: "t", generation: 9 }); // a central row of a central robot
      await setEdgeOwnershipActor(tx, `admin:dot10A`);
      await tx.update(robotOwnership).set({ edgeNodeId: node }).where(eq(robotOwnership.id, robot));
      const [own] = await tx.select().from(robotOwnership).where(eq(robotOwnership.id, robot));
      const hist = await tx.select().from(deviceOwnerChanges).where(and(eq(deviceOwnerChanges.deviceKind, "robot"), eq(deviceOwnerChanges.deviceId, robot)));
      await tx.execute(sql`INSERT INTO robot_jobs ("robotId", "jobType", status) VALUES (${busy}, 'move', 'running')`);
      const busyChange = await codeOf(tx, () => tx.update(robotOwnership).set({ edgeNodeId: node }).where(eq(robotOwnership.id, busy)));
      return { own, hist, busyChange };
    });
    expect(out.own.motionLockGenerationFloor).toBe(10);
    expect(out.hist).toHaveLength(1);
    expect(out.hist[0]).toMatchObject({ fromEdgeNodeId: null, generationFloor: 10, fromOwnerEpoch: 1, toOwnerEpoch: 2, changedBy: "admin:dot10A" });
    expect(out.busyChange).toBe("23514");
    expect(isEdgeControlRefusal({ code: "23514" })).toBe(true);
  });

  it("★ R-10-b + safety-lock: the owner change locks the robot in the SAME statement; edge rows move only through the guarded path", async () => {
    const out = await inRolledBackTx(async (tx) => {
      const { node, robot } = await nodeRobot(tx, `__dot10A_lock_${Date.now()}`);
      await tx.update(robotOwnership).set({ edgeNodeId: node }).where(eq(robotOwnership.id, robot));
      const [lock] = await tx.select().from(robotMotionLockAuthority).where(eq(robotMotionLockAuthority.robotId, robot));
      const directUpdate = await codeOf(tx, () => tx.update(robotMotionLockAuthority).set({ generation: 99 }).where(eq(robotMotionLockAuthority.robotId, robot)));
      const directDelete = await codeOf(tx, () => tx.delete(robotMotionLockAuthority).where(edgeLockRowMatch(robot, node, 2)));
      const directToCentral = await codeOf(tx, () => tx.update(robotMotionLockAuthority).set({ authority: "central", authorityNodeId: null }).where(eq(robotMotionLockAuthority.robotId, robot)));
      const staleApply = await codeOf(tx, () => applyEdgeMotionLock(tx, { robotId: robot, nodeId: node, ownerEpoch: 1, generation: lock.generation + 1, reasonCode: "x" }));
      const applyNewer = await applyEdgeMotionLock(tx, { robotId: robot, nodeId: node, ownerEpoch: 2, generation: lock.generation + 2, reasonCode: "outcomeUnknown" });
      const applyLower = await applyEdgeMotionLock(tx, { robotId: robot, nodeId: node, ownerEpoch: 2, generation: lock.generation + 1, reasonCode: "x" });
      const staleClear = await clearEdgeMotionLock(tx, { robotId: robot, nodeId: node, ownerEpoch: 1, generation: 1000 });
      const lowClear = await clearEdgeMotionLock(tx, { robotId: robot, nodeId: node, ownerEpoch: 2, generation: lock.generation + 1 });
      const clear = await clearEdgeMotionLock(tx, { robotId: robot, nodeId: node, ownerEpoch: 2, generation: lock.generation + 2 });
      const centralRowOnEdgeRobot = await codeOf(tx, () => tx.insert(robotMotionLockAuthority).values({ robotId: robot, reasonCode: "c", generation: 1 }));
      return { lock, directUpdate, directDelete, directToCentral, staleApply, applyLower, applyNewer, staleClear, lowClear, clear, centralRowOnEdgeRobot };
    });
    expect(out.lock).toMatchObject({ authority: expect.stringMatching(/^edge:\d+$/), ownerEpoch: 2, reasonCode: "ownerChanged" });
    expect(out).toMatchObject({
      directUpdate: "23514", directDelete: "23514", directToCentral: "23514", staleApply: "23514", applyLower: false, applyNewer: true,
      staleClear: 0, lowClear: 0, clear: 1, centralRowOnEdgeRobot: "23514",
    });
  });

  it("★ R-10-b: a node deleted and re-created under the SAME id cannot apply / clear the old (authority, epoch)", async () => {
    const out = await inRolledBackTx(async (tx) => {
      const code = `__dot10A_reuse_${Date.now()}`;
      const { node, robot } = await nodeRobot(tx, code);
      await tx.update(robotOwnership).set({ edgeNodeId: node }).where(eq(robotOwnership.id, robot)); // epoch 2
      const nodeDelWhileOwner = await codeOf(tx, () => tx.execute(sql`DELETE FROM edge_nodes WHERE id = ${node}`));
      await tx.update(robotOwnership).set({ edgeNodeId: null }).where(eq(robotOwnership.id, robot)); // epoch 3, row central
      await tx.execute(sql`DELETE FROM edge_nodes WHERE id = ${node}`);
      await tx.execute(sql`INSERT INTO edge_nodes (id, code, name, status) VALUES (${node}, ${code + "-reused"}, ${code}, 'offline')`);
      await tx.update(robotOwnership).set({ edgeNodeId: node }).where(eq(robotOwnership.id, robot)); // epoch 4
      const oldClear = await clearEdgeMotionLock(tx, { robotId: robot, nodeId: node, ownerEpoch: 2, generation: 1000 });
      const oldApply = await codeOf(tx, () => applyEdgeMotionLock(tx, { robotId: robot, nodeId: node, ownerEpoch: 2, generation: 1000, reasonCode: "x" }));
      const [still] = await tx.select().from(robotMotionLockAuthority).where(eq(robotMotionLockAuthority.robotId, robot));
      return { nodeDelWhileOwner, oldClear, oldApply, still };
    });
    expect(out.nodeDelWhileOwner).toBe("23503");
    expect(out.oldClear).toBe(0);
    expect(out.oldApply).toBe("23514");
    expect(out.still).toMatchObject({ ownerEpoch: 4, reasonCode: "ownerChanged" });
  });

  it("★ maker-checker: no direct write; the creator / a later editor never approves; owner or digest change invalidates", async () => {
    const out = await inRolledBackTx(async (tx) => {
      const code = `__dot10A_trust_${Date.now()}`;
      const { node, robot } = await nodeRobot(tx, code);
      await tx.update(robotOwnership).set({ edgeNodeId: node }).where(eq(robotOwnership.id, robot));
      const user = async (tag: string) => (await one(tx, sql`INSERT INTO users ("openId", role, "isActive") VALUES (${code + tag}, 'admin', true) RETURNING id`)).id as number;
      const [maker, editor2, checker] = [await user("-m"), await user("-e"), await user("-c")];
      const D = (c: string) => c.repeat(64);
      const directInsert = await codeOf(tx, () => tx.insert(edgeRobotTrustApprovals).values({ edgeNodeId: node, robotId: robot, digest: D("a"), ownerEpoch: 2, editedBy: maker, editorsSinceApproval: [maker] }));
      await requestEdgeRobotTrust(tx, { nodeId: node, robotId: robot, digest: D("a"), editorUserId: maker });
      const byCreator = await codeOf(tx, () => approveEdgeRobotTrust(tx, { nodeId: node, robotId: robot, digest: D("a"), approverUserId: maker }));
      await requestEdgeRobotTrust(tx, { nodeId: node, robotId: robot, digest: D("a"), editorUserId: editor2 });
      const byLaterEditor = await codeOf(tx, () => approveEdgeRobotTrust(tx, { nodeId: node, robotId: robot, digest: D("a"), approverUserId: editor2 }));
      const directApprove = await codeOf(tx, () => tx.update(edgeRobotTrustApprovals).set({ approvedBy: checker }).where(eq(edgeRobotTrustApprovals.robotId, robot)));
      await approveEdgeRobotTrust(tx, { nodeId: node, robotId: robot, digest: D("a"), approverUserId: checker });
      const approved = await isEdgeRobotTrustApproved(tx, { nodeId: node, robotId: robot, digest: D("a") });
      await tx.update(robotOwnership).set({ edgeNodeId: null }).where(eq(robotOwnership.id, robot));
      await tx.update(robotOwnership).set({ edgeNodeId: node }).where(eq(robotOwnership.id, robot));
      const afterOwnerChange = await isEdgeRobotTrustApproved(tx, { nodeId: node, robotId: robot, digest: D("a") });
      await requestEdgeRobotTrust(tx, { nodeId: node, robotId: robot, digest: D("b"), editorUserId: maker });
      await approveEdgeRobotTrust(tx, { nodeId: node, robotId: robot, digest: D("b"), approverUserId: checker });
      const reApproved = await isEdgeRobotTrustApproved(tx, { nodeId: node, robotId: robot, digest: D("b") });
      await requestEdgeRobotTrust(tx, { nodeId: node, robotId: robot, digest: D("c"), editorUserId: editor2 });
      const afterDigestChange = await isEdgeRobotTrustApproved(tx, { nodeId: node, robotId: robot, digest: D("b") });
      return { directInsert, byCreator, byLaterEditor, directApprove, approved, afterOwnerChange, reApproved, afterDigestChange };
    });
    expect(out).toEqual({ directInsert: "42501", byCreator: "23514", byLaterEditor: "23514", directApprove: "42501", approved: true, afterOwnerChange: false, reApproved: true, afterDigestChange: false });
  });

  it("★ fix review 1 M1 (L-7): a STOP for the OLD owner stays deliverable and is CARRIED to a new edge owner; lock / clear at a stale epoch stay refused", async () => {
    const out = await inRolledBackTx(async (tx) => {
      const code = `__dot10Af_stop_${Date.now()}`;
      const { node, robot } = await nodeRobot(tx, code);
      const nodeB = (await one(tx, sql`INSERT INTO edge_nodes (code, name, status) VALUES (${code + "-b"}, ${code}, 'offline') RETURNING id`)).id as number;
      const ad = (await one(tx, sql`INSERT INTO device_adapters (code, name, protocol, endpoint) VALUES (${code + "-a"}, ${code}, 'stub', 'stub://t') RETURNING id`)).id as number;
      await tx.update(robotOwnership).set({ edgeNodeId: node }).where(eq(robotOwnership.id, robot)); // robot epoch 2
      await tx.update(adapterOwnership).set({ edgeNodeId: node }).where(eq(adapterOwnership.id, ad)); // adapter epoch 2
      const req = async (o: { robotId?: number; adapterId?: number; kind: "stop" | "lock"; reason: string }) =>
        (await tx.insert(robotMotionLockRequests).values({ robotId: o.robotId ?? null, adapterId: o.adapterId ?? null, edgeNodeId: node, ownerEpoch: 2, kind: o.kind, reason: o.reason, requestedBy: 7, expiresAt: new Date(Date.now() + 60_000) }).returning({ id: robotMotionLockRequests.id }))[0].id;
      const stopR = await req({ robotId: robot, kind: "stop", reason: "operator e-stop" });
      const lockR = await req({ robotId: robot, kind: "lock", reason: "maintenance" });
      const stopA = await req({ adapterId: ad, kind: "stop", reason: "adapter stop" });
      const ackedStop = await req({ robotId: robot, kind: "stop", reason: "already done" });
      await tx.update(robotMotionLockRequests).set({ deliveredAt: new Date() }).where(eq(robotMotionLockRequests.id, ackedStop));
      await tx.update(robotMotionLockRequests).set({ ackedAt: new Date(), outcome: "done" }).where(eq(robotMotionLockRequests.id, ackedStop));
      await tx.update(robotOwnership).set({ edgeNodeId: nodeB }).where(eq(robotOwnership.id, robot)); // robot epoch 3, owner B
      await tx.update(adapterOwnership).set({ edgeNodeId: null }).where(eq(adapterOwnership.id, ad)); // adapter → central
      const deliverOldStop = await codeOf(tx, () => tx.update(robotMotionLockRequests).set({ deliveredAt: new Date() }).where(eq(robotMotionLockRequests.id, stopR)));
      const deliverOldLock = await codeOf(tx, () => tx.update(robotMotionLockRequests).set({ deliveredAt: new Date() }).where(eq(robotMotionLockRequests.id, lockR)));
      const deliverOldAdapterStop = await codeOf(tx, () => tx.update(robotMotionLockRequests).set({ deliveredAt: new Date() }).where(eq(robotMotionLockRequests.id, stopA)));
      const carried = await tx.select().from(robotMotionLockRequests).where(and(eq(robotMotionLockRequests.robotId, robot), eq(robotMotionLockRequests.edgeNodeId, nodeB)));
      const adapterCarried = await tx.select().from(robotMotionLockRequests).where(and(eq(robotMotionLockRequests.adapterId, ad), sql`${robotMotionLockRequests.id} <> ${stopA}`));
      return { stopR, deliverOldStop, deliverOldLock, deliverOldAdapterStop, carried, adapterCarried };
    });
    expect(out).toMatchObject({ deliverOldStop: null, deliverOldLock: "23514", deliverOldAdapterStop: null, adapterCarried: [] });
    expect(out.carried).toHaveLength(1); // the unacked STOP only — never the lock, never the acknowledged STOP
    expect(out.carried[0]).toMatchObject({ kind: "stop", ownerEpoch: 3, requestedBy: 7, deliveredAt: null, ackedAt: null });
    expect(out.carried[0].reason).toContain(`carried from request #${out.stopR}`);
    expect(out.carried[0].reason).toContain("operator e-stop");
  });

  it("★ fix review 1 M2: edge_motion_lock_apply / _clear refuse a generation below the robot's motionLockGenerationFloor", async () => {
    const out = await inRolledBackTx(async (tx) => {
      const { node, robot } = await nodeRobot(tx, `__dot10Af_floor_${Date.now()}`);
      await tx.insert(robotMotionLockAuthority).values({ robotId: robot, reasonCode: "t", generation: 9 });
      await tx.update(robotOwnership).set({ edgeNodeId: node }).where(eq(robotOwnership.id, robot)); // floor 10, relock row gen 10
      const [own] = await tx.select().from(robotOwnership).where(eq(robotOwnership.id, robot));
      const f = own.motionLockGenerationFloor as number;
      const clearBelow = await clearEdgeMotionLock(tx, { robotId: robot, nodeId: node, ownerEpoch: 2, generation: f - 1 });
      const clearAt = await clearEdgeMotionLock(tx, { robotId: robot, nodeId: node, ownerEpoch: 2, generation: f });
      const applyBelow = await applyEdgeMotionLock(tx, { robotId: robot, nodeId: node, ownerEpoch: 2, generation: f - 1, reasonCode: "x" });
      const rowsAfterBelow = (await tx.select().from(robotMotionLockAuthority).where(eq(robotMotionLockAuthority.robotId, robot))).length;
      const applyAt = await applyEdgeMotionLock(tx, { robotId: robot, nodeId: node, ownerEpoch: 2, generation: f, reasonCode: "x" });
      return { f, clearBelow, clearAt, applyBelow, rowsAfterBelow, applyAt };
    });
    expect(out).toEqual({ f: 10, clearBelow: 0, clearAt: 1, applyBelow: false, rowsAfterBelow: 0, applyAt: true });
  });

  it("report cursor starts at 0 and never goes back; avi_app cannot plant a signing-key row (R-10-c mirror)", async () => {
    const out = await inRolledBackTx(async (tx) => {
      const { node } = await nodeRobot(tx, `__dot10A_cur_${Date.now()}`);
      const ep = "a".repeat(32);
      await tx.insert(edgeNodeReportCursors).values({ edgeNodeId: node, stream: "events", epoch: ep });
      const startHigh = await codeOf(tx, () => tx.insert(edgeNodeReportCursors).values({ edgeNodeId: node, stream: "robot_state", epoch: ep, lastSeq: 3 }));
      await tx.update(edgeNodeReportCursors).set({ lastSeq: 5 }).where(eq(edgeNodeReportCursors.edgeNodeId, node));
      const back = await codeOf(tx, () => tx.update(edgeNodeReportCursors).set({ lastSeq: 4 }).where(eq(edgeNodeReportCursors.edgeNodeId, node)));
      const plant = await codeOf(tx, () =>
        tx.insert(edgeAuthSigningKeys).values({ kid: "edk_" + "Q".repeat(22), publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----\n", status: "active", createdBy: "planted" }),
      );
      return { startHigh, back, plant };
    });
    expect(out).toEqual({ startHigh: "23514", back: "23514", plant: "42501" });
  });

  it("isEdgeControlSchemaMissing recognises an absent column (42703) / table (42P01)", async () => {
    const d = (await getDb())!;
    const ghostCol = pgTable("robots", { nope: integer("__dot10_no_such_column") });
    const ghostTable = pgTable("__dot10_no_such_table", { id: integer("id") });
    for (const t of [ghostCol, ghostTable]) {
      const err = await d.select().from(t as never).limit(1).then(() => null, (e: unknown) => e);
      expect(isEdgeControlSchemaMissing(err)).toBe(true);
    }
    // fix review 1 (I6): a DB without 0374 / 0375 has no guarded function ⇒ 42883 undefined_function ⇒ 503 edge_unavailable
    const noFn = await d.execute(sql`SELECT public.__dot10_no_such_function(1)`).then(() => null, (e: unknown) => e);
    expect((noFn as { code?: string; cause?: { code?: string } }).code ?? (noFn as { cause?: { code?: string } }).cause?.code).toBe("42883");
    expect(isEdgeControlSchemaMissing(noFn)).toBe(true);
    expect(isEdgeControlSchemaMissing({ cause: { code: "42883" } })).toBe(true);
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
