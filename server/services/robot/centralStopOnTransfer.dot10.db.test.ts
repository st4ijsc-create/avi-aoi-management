/**
 * doc 81 Đợt 10 task D — ruling R-10-i (L-7), `_test` as avi_app (mig 0374 + A fix review 2): a device whose ownership moves
 * from an edge node to CENTRAL while a STOP request for it is still unacknowledged ⇒ central EXECUTES the STOP right after the
 * transfer commits, then acknowledges every pending request through the guarded helper (done | failed). A STOP that cannot be
 * sent ⇒ `failed` + a CRITICAL alert (the row stays, outcome failed). Robot: central's robot path; adapter: no pinned stop ⇒
 * cannot be sent ⇒ failed + alert. The edge → edge direction is the DB's carry (not central's to execute).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";

const H = vi.hoisted(() => ({ jobs: [] as Array<{ jobType: string }>, fail: false, alerts: [] as string[], active: true }));
vi.mock("./robotManager", () => ({
  getActiveRobot: () =>
    H.active
      ? {
          id: 0,
          code: "T",
          vendor: "sim",
          driver: {
            vendor: "sim",
            isConnected: () => true,
            getMotionLock: () => ({ locked: false, generation: 0 }),
            runJob: async (job: { jobType: string }) => {
              H.jobs.push(job);
              return H.fail ? { ok: false, status: "failed", error: "robot refused the abort" } : { ok: true, status: "done" };
            },
          },
        }
      : undefined,
}));
vi.mock("../ecosystem/ecosystemEvents", () => ({ publishAnomalyDetected: (p: { message: string }) => H.alerts.push(p.message) }));
vi.mock("../notificationService", () => ({ sendNotification: async () => undefined }));

import { changeDeviceOwner } from "./deviceOwnershipService";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const TAG = `D10I-${Date.now()}`;
let sql: ReturnType<typeof postgres>;
let viewExists = false;
const made = { nodes: [] as number[], robots: [] as number[], adapters: [] as number[], users: [] as number[] };
const env: Record<string, string | undefined> = {};
let actor = 0;

async function edgeOwnedRobotWithPendingStop(s: string) {
  const [n] = await sql`INSERT INTO edge_nodes (code, name, status) VALUES (${`${TAG}-N${s}`}, 'n', 'offline') RETURNING id`;
  const [r] = await sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled") VALUES (${`${TAG}-R${s}`}, 'r', 'sim', 'sim://t', true) RETURNING id`;
  made.nodes.push(Number(n.id));
  made.robots.push(Number(r.id));
  await sql`UPDATE robots SET "edgeNodeId" = ${n.id} WHERE id = ${r.id}`;
  const [o] = await sql`SELECT "ownerEpoch" FROM robots WHERE id = ${r.id}`;
  const [q] = await sql`INSERT INTO robot_motion_lock_requests ("robotId", "edgeNodeId", "ownerEpoch", kind, reason, "requestedBy", "expiresAt")
                        VALUES (${r.id}, ${n.id}, ${o.ownerEpoch}, 'stop', 'console stop', ${actor}, now() + interval '1 second') RETURNING id`; // overdue after 1 s
  return { node: Number(n.id), robot: Number(r.id), request: Number(q.id) };
}
const reqRow = async (id: number) => (await sql`SELECT "ackedAt", outcome, "ackedBy" FROM robot_motion_lock_requests WHERE id = ${id}`)[0];

describe.skipIf(!onTest)("R-10-i — central executes the STOPs owed after a transfer to central (_test)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL, { max: 1, connect_timeout: 30, onnotice: () => {} });
    viewExists = (await sql`SELECT to_regclass('public.device_pending_stops') IS NOT NULL AS ok`)[0].ok === true;
    const [u] = await sql`SELECT id FROM users ORDER BY id LIMIT 1`;
    actor = Number(u.id);
    for (const k of ["ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED", "OT_CONTROL_ENABLED"]) env[k] = process.env[k];
    process.env.ROBOT_CONTROL_ENABLED = "true";
    process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
    process.env.OT_CONTROL_ENABLED = "true";
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(env)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
    for (const r of made.robots) {
      await sql`DELETE FROM robot_jobs WHERE "robotId" = ${r}`.catch(() => undefined);
      await sql`DELETE FROM robot_motion_locks WHERE "robotId" = ${r}`.catch(() => undefined);
    }
    await sql.end();
  }, 60_000);
  beforeEach(() => {
    H.jobs.length = 0;
    H.alerts.length = 0;
    H.fail = false;
    H.active = true;
  });

  it("★ edge → central with an unacked (even overdue) STOP request ⇒ the abort is SENT right after the transfer and the request is acked done by the actor", async () => {
    expect(viewExists).toBe(true);
    const { robot, request } = await edgeOwnedRobotWithPendingStop("a");
    await new Promise((r) => setTimeout(r, 1_200)); // the request is now OVERDUE (past expiresAt) — still owed
    expect((await sql`SELECT overdue FROM device_pending_stops WHERE "requestId" = ${request}`)[0].overdue).toBe(true);
    const r = await changeDeviceOwner({ kind: "robot", deviceId: robot, toEdgeNodeId: null, actorUserId: actor, actorName: "test" });
    expect(r).toMatchObject({ ok: true, toEdgeNodeId: null, centralStops: { requestIds: [request], outcome: "done", sent: "sent", ackErrors: [] } });
    expect(H.jobs.map((j) => j.jobType)).toEqual(["abort"]);
    expect(await reqRow(request)).toMatchObject({ outcome: "done", ackedBy: actor });
    expect(H.alerts).toEqual([]);
  });

  it("★ the STOP cannot be confirmed ⇒ acked FAILED (row kept) + a CRITICAL alert", async () => {
    const { robot, request } = await edgeOwnedRobotWithPendingStop("b");
    H.fail = true;
    const r = await changeDeviceOwner({ kind: "robot", deviceId: robot, toEdgeNodeId: null, actorUserId: actor, actorName: "test" });
    expect(r).toMatchObject({ ok: true, centralStops: { outcome: "failed", sent: "failed" } });
    expect(H.jobs.map((j) => j.jobType)).toEqual(["abort"]);
    expect(await reqRow(request)).toMatchObject({ outcome: "failed", ackedBy: actor });
    expect(H.alerts.join("\n")).toMatch(/could NOT be sent/);
  });

  it("an adapter with no pinned stop tag ⇒ the STOP is impossible ⇒ failed + alert (hardware E-STOP named)", async () => {
    const [n] = await sql`INSERT INTO edge_nodes (code, name, status) VALUES (${`${TAG}-NA`}, 'n', 'offline') RETURNING id`;
    const [a] = await sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled") VALUES (${`${TAG}-A`}, 'a', 'stub', 'stub://a', false) RETURNING id`;
    await sql`UPDATE device_adapters SET "edgeNodeId" = ${n.id} WHERE id = ${a.id}`;
    const [o] = await sql`SELECT "ownerEpoch" FROM device_adapters WHERE id = ${a.id}`;
    const [q] = await sql`INSERT INTO robot_motion_lock_requests ("adapterId", "edgeNodeId", "ownerEpoch", kind, reason, "requestedBy", "expiresAt")
                          VALUES (${a.id}, ${n.id}, ${o.ownerEpoch}, 'stop', 'console stop', ${actor}, now() + interval '1 minute') RETURNING id`;
    const r = await changeDeviceOwner({ kind: "adapter", deviceId: Number(a.id), toEdgeNodeId: null, actorUserId: actor, actorName: "test" });
    expect(r).toMatchObject({ ok: true, centralStops: { outcome: "failed", sent: "failed" } });
    expect((r as { centralStops: { detail: string } }).centralStops.detail).toMatch(/hardware E-STOP/);
    expect(await reqRow(Number(q.id))).toMatchObject({ outcome: "failed" });
    expect(H.alerts).toHaveLength(1);
  });

  it("no pending STOP ⇒ nothing sent (centralStops null); edge → edge ⇒ central sends nothing (the DB carries it to the new edge)", async () => {
    const { robot, request } = await edgeOwnedRobotWithPendingStop("c");
    const [n2] = await sql`INSERT INTO edge_nodes (code, name, status) VALUES (${`${TAG}-N2`}, 'n', 'offline') RETURNING id`;
    const r = await changeDeviceOwner({ kind: "robot", deviceId: robot, toEdgeNodeId: Number(n2.id), actorUserId: actor, actorName: "test" });
    expect(r).toMatchObject({ ok: true, toEdgeNodeId: Number(n2.id), centralStops: null });
    expect(H.jobs).toEqual([]);
    const owed = await sql`SELECT "requestId", "currentEdgeNodeId" FROM device_pending_stops WHERE "robotId" = ${robot} AND "currentEdgeNodeId" = ${n2.id}`;
    expect(owed.length).toBeGreaterThanOrEqual(1); // still owed — now to the NEW edge (the DB carry), never dropped
    void request;
    const back = await changeDeviceOwner({ kind: "robot", deviceId: robot, toEdgeNodeId: null, actorUserId: actor, actorName: "test" });
    expect(back.ok).toBe(true);
    expect(H.jobs.map((j) => j.jobType)).toEqual(["abort"]); // the carried STOP is still owed ⇒ central executes it
  });
});
