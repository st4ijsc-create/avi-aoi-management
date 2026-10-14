/**
 * doc 81 Đợt 12 task N (OWNER-SETUP B2) — the SIM robot's motion lock end to end, TWO PROCESSES (the F1 harness,
 * __edgeE2eHarness.dot10.ts): central = this process against `aoi_management_test`; the edge = edgeGatewayMain in a spawned
 * process with NO DB, whose SIM robot driver is now the PRODUCT driver with its own MotionLock (the child no longer patches one in).
 *
 *   assign (robot A → node A: the DB relocks it ownerChanged under the edge authority; the edge starts it LOCKED)
 *   → signed clear (the operator's robot.clearMotionLock, queued as a signed command; the edge clears its own lock)
 *   → move (a workflow run's NON-STOP robot step reaches the edge's sim robot)
 *   → STOP (the run's robot STOP)
 *   → release (robot A → central: the DB relocks it ownerChanged under 'central'; central attaches it with that lock restored)
 *   → central row locked (central refuses motion: MOTION_LOCKED; a stale generation / no reason are refused)
 *   → audited clear (robot.clearMotionLock on central: audit row FIRST, exactly that row removed)
 *   → central move allowed (the console motion reaches central's sim robot).
 * Before Đợt 12 the edge answered the signed clear `refused:no_driver` and central's clear `motionLockUnsupported`.
 * Oracles: the edge's counted SIM driver (motions / stops / lock state), central's counted SIM driver, central rows.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const H = vi.hoisted(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "n12-dot12-e2e-session-secret-0123456789abcdef";
  return { prefix: "\u0000never" };
});
// central's robot gateway loads only THIS suite's robots (the shared _test DB holds many other suites' robots) — isolation only
vi.mock("../robot/robotAdapter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../robot/robotAdapter")>();
  return { ...actual, loadEnabledRobots: async (...a: Parameters<typeof actual.loadEnabledRobots>) => (await actual.loadEnabledRobots(...a)).filter((r) => String(r.code).includes(H.prefix)) };
});

import { setupCentral, waitFor, type Central, type EdgeProc, type CentralTestHooks } from "./__edgeE2eHarness.dot10";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
let c: Central;
let edge: EdgeProc;
/** central's own SIM robot sessions (counted: what reached central's driver) */
const central = { calls: [] as Array<{ jobType: string; robotId: number | null; at: number }> };
const motionsOf = (e: EdgeProc, robotId: number) => (e.counts()?.motions ?? []).filter((m) => m.robotId === robotId);
const stopsOf = (e: EdgeProc, robotId: number) => (e.counts()?.stops ?? []).filter((m) => m.robotId === robotId);

const hooks: CentralTestHooks = {
  async trpcRouter() {
    const [{ router }, { robotRouter }] = await Promise.all([import("../../_core/trpc"), import("../../routers/robotRouter")]);
    return router({ robot: robotRouter });
  },
  async mintSession(sql, userId, openId) {
    const { sdk } = await import("../../_core/sdk");
    const t = await sdk.signSession({ openId, appId: "n12-e2e", name: "N12 engineer" }, { expiresInMs: 60 * 60 * 1000 });
    await sql`INSERT INTO user_sessions ("userId", "sessionToken", "expiresAt", "isActive") VALUES (${userId}, ${t}, now() + interval '1 hour', true)`;
    return t;
  },
};
const out = (r: { json: any }) => r.json?.result?.data?.json;
const errOf = (r: { json: any }) => r.json?.error?.json ?? r.json?.error;
/** a tRPC QUERY over GET (the harness's c.trpc POSTs: mutations only) */
async function trpcQuery(proc: string, input: unknown, session: string): Promise<unknown> {
  const { COOKIE_NAME } = await import("@shared/const");
  const res = await fetch(`${c.base}/api/trpc/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`, { headers: { cookie: `${COOKIE_NAME}=${session}` } });
  const j = (await res.json().catch(() => null)) as any;
  if (res.status !== 200) throw new Error(`${proc}: HTTP ${res.status} ${JSON.stringify(j).slice(0, 400)}`);
  return j?.result?.data?.json;
}

describe.skipIf(!onTest)("doc 81 Đợt 12 N — the SIM robot's motion lock across an edge assignment and its release (two processes)", () => {
  beforeAll(async () => {
    c = await setupCentral("N12", { hooks });
    H.prefix = c.DAU;
    const { SimRobotDriver } = await import("../robot/drivers/simRobotDriver");
    const proto = SimRobotDriver.prototype as unknown as { connect: (cfg: { endpoint?: string }) => Promise<void>; runJob: (j: { jobType: string }) => Promise<unknown> };
    const of = (self: { _ep?: string }) => {
      const m = /#(\d+)$/.exec(self._ep ?? "");
      return m ? Number(m[1]) : null;
    };
    const [oc, orj] = [proto.connect, proto.runJob];
    proto.connect = async function (this: { _ep?: string }, cfg) {
      this._ep = String(cfg?.endpoint ?? "");
      return oc.call(this, cfg);
    };
    proto.runJob = async function (this: { _ep?: string }, j) {
      central.calls.push({ jobType: String(j?.jobType), robotId: of(this), at: Date.now() });
      return orj.call(this, j);
    };
    edge = await c.spawnEdge("n12", { waitRobot: true });
  }, 300_000);
  afterAll(async () => {
    try {
      const { stopRobots } = await import("../robot/robotManager");
      await stopRobots();
    } catch {
      /* not started */
    }
    try {
      await edge?.stop();
    } catch {
      /* already gone */
    }
    await c?.teardown();
  }, 240_000);

  it("★ assign → signed clear → move → STOP → release → central row locked → audited clear → central move allowed", async () => {
    const A = c.ids.robotA;
    // ── assign: the edge's PRODUCT sim driver starts LOCKED (ownerChanged / fresh journal), mirrored centrally as an edge row ──
    const seeded = await edge.waitCounts("robot A on the edge, locked", (k) => k.robots.find((r) => r.id === A && r.locked === true), 60_000);
    expect(seeded.generation).toBeGreaterThan(0);

    // ── signed clear (central's robot.clearMotionLock → a signed command → the edge's own compare-and-clear) ──
    const cleared = await c.clearEdgeLock(A, edge);
    expect(cleared.requestId).toBeGreaterThan(0);
    await waitFor("the edge's clear acked", async () => (await c.sql`SELECT outcome FROM robot_motion_lock_requests WHERE id = ${cleared.requestId}`)[0]?.outcome === "done", 30_000);

    // ── move + STOP (a run on the edge: a NON-STOP robot step, then the robot STOP) ──
    const m0 = motionsOf(edge, A).length;
    const s0 = stopsOf(edge, A).length;
    const s = c.steps;
    const id = await c.startRun("n12move", [s.gate(), s.move("m1"), s.stop("s1")]);
    await c.approveAtGate(id);
    await waitFor(`run ${id} completed on the edge and reported`, async () => (await c.run(id)).status === "completed" && (await c.assignment(id)).claimTokenHash === null, 90_000);
    expect(motionsOf(edge, A).length).toBe(m0 + 1); // the move reached the edge's sim robot
    expect(stopsOf(edge, A).length).toBeGreaterThan(s0); // so did the STOP
    expect(edge.counts()!.robots.find((r) => r.id === A)?.locked).toBe(false);

    // ── release to central (central's robot gateway ON: it attaches the robot with its persisted lock restored) ──
    process.env.ROBOT_GATEWAY_ENABLED = "true";
    const rm = await import("../robot/robotManager");
    await rm.startRobots();
    const { changeDeviceOwner } = await import("../robot/deviceOwnershipService");
    const moved = await changeDeviceOwner({ kind: "robot", deviceId: A, toEdgeNodeId: null, actorUserId: c.u.admin, actorName: "N12 admin" });
    expect(moved, JSON.stringify(moved)).toMatchObject({ ok: true, toEdgeNodeId: null });
    await edge.waitCounts("robot A released by the edge", (k) => !k.robots.some((r) => r.id === A), 30_000);

    // ── central row locked: ownerChanged under 'central'; central's session holds it; motion refused ──
    const [row] = await c.sql`SELECT authority, "reasonCode", generation FROM robot_motion_locks WHERE "robotId" = ${A}`;
    expect(row).toMatchObject({ authority: "central", reasonCode: "ownerChanged" });
    const g = Number(row.generation);
    await waitFor("robot A attached centrally", () => rm.activeRobotIds().includes(A), 30_000);
    expect(rm.getActiveRobot(A)!.driver.getMotionLock!()).toMatchObject({ locked: true, reasonCode: "ownerChanged", generation: g });
    const session = await c.engineerSession();
    const n0 = central.calls.filter((x) => x.robotId === A && x.jobType !== "abort").length;
    const refused = await c.trpc("robot.actuate", { robotId: A, command: "start" }, session);
    expect(JSON.stringify(refused.json)).toMatch(/MOTION_LOCKED/);
    expect(central.calls.filter((x) => x.robotId === A && x.jobType !== "abort").length).toBe(n0);
    const listed = (await trpcQuery("robot.get", { id: A }, session)) as any; // a query: GET
    expect(listed?.live?.motionLock).toMatchObject({ locked: true, reasonCode: "ownerChanged", generation: g });

    // refused clears: no reason, a stale generation — nothing audited, nothing cleared
    const noReason = await c.trpc("robot.clearMotionLock", { robotId: A, reason: "  ", expectedGeneration: g }, session);
    expect(errOf(noReason)?.data?.code ?? noReason.status).toMatch(/BAD_REQUEST|400/);
    const stale = await c.trpc("robot.clearMotionLock", { robotId: A, reason: "N12 stale", expectedGeneration: g - 1 }, session);
    expect(JSON.stringify(stale.json)).toMatch(/CONFLICT|motionLockChanged/);
    expect(Number((await c.sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'robot.clearMotionLock' AND "entityId" = ${A} AND "createdAt" > now() - interval '10 minutes' AND details NOT LIKE '%edge_command%'`)[0].n)).toBe(0);
    expect((await c.sql`SELECT generation FROM robot_motion_locks WHERE "robotId" = ${A}`)[0]?.generation).toBe(g);

    // ── audited clear on central ──
    const ok = await c.trpc("robot.clearMotionLock", { robotId: A, reason: "N12 e2e: cell checked after the edge", expectedGeneration: g }, session);
    expect(out(ok), JSON.stringify(ok.json)).toMatchObject({ robotId: A, changed: true, motionLock: { locked: false, clearedBy: "operator" } });
    const [audit] = await c.sql`SELECT status, details FROM audit_logs WHERE action = 'robot.clearMotionLock' AND "entityId" = ${A} AND details NOT LIKE '%edge_command%' ORDER BY id DESC LIMIT 1`;
    expect(audit.status).toBe("success");
    expect(String(audit.details)).toMatch(/N12 e2e: cell checked after the edge/);
    await waitFor("the central ownerChanged row removed", async () => (await c.sql`SELECT 1 FROM robot_motion_locks WHERE "robotId" = ${A}`).length === 0, 15_000);

    // ── central move allowed: the console motion reaches central's sim robot ──
    const go = await c.trpc("robot.actuate", { robotId: A, command: "start" }, session);
    expect(JSON.stringify(go.json)).not.toMatch(/MOTION_LOCKED/);
    expect(out(go), JSON.stringify(go.json)).toMatchObject({ ok: true });
    await waitFor("the motion reached central's sim robot", () => central.calls.filter((x) => x.robotId === A && x.jobType !== "abort").length > n0, 15_000);
  }, 300_000);
});
