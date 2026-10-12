/**
 * doc 81 Đợt 10 task D — rulings R-10-i / R-10-v / R-10-w (L-7), `_test` as avi_app (mig 0374 + A fix review 2).
 *   • R-10-i: a device whose ownership moves from an edge node to CENTRAL while a STOP request for it is unacknowledged ⇒ central
 *     EXECUTES the STOP right after the transfer, then acks every pending request through edge_stop_ack_central (done | failed).
 *     A STOP that cannot be sent ⇒ `failed` (the row stays) + a durable critical alert. Robot: central's session — or, when central
 *     holds none (the production case right after an edge → central transfer), a TRANSIENT driver session, bounded (fix review I-4).
 *   • R-10-v: the transfer is applied LIVE in this process (detach on central → edge, attach on edge → central) and NOTIFYs
 *     'device_owner_changed' for the other replicas.
 *   • R-10-w: the SWEEP catches a transfer made by another path; two sweeps at once execute the STOP ONCE (FOR UPDATE SKIP LOCKED);
 *     a later sweep finds nothing (idempotent).
 * Test rows are removed afterwards as far as the guards allow (edge nodes, adapters, robots; WORM history and acked requests stay).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";

const H = vi.hoisted(() => ({
  jobs: [] as Array<{ jobType: string }>,
  fail: false,
  alerts: [] as string[],
  active: true,
  delayMs: 0,
  attached: [] as number[],
  detached: [] as number[],
  transient: { connects: 0, disconnects: 0, hang: false },
}));
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
              if (H.delayMs) await new Promise((r) => setTimeout(r, H.delayMs));
              return H.fail ? { ok: false, status: "failed", error: "robot refused the abort" } : { ok: true, status: "done" };
            },
          },
        }
      : undefined,
  attachRobot: async (id: number) => (H.attached.push(id), true),
  detachRobot: async (id: number) => (H.detached.push(id), true),
  activeRobotIds: () => [],
}));
// the transient session's driver (no central session — I-4): a fake vendor driver, never a socket
vi.mock("./driverRegistry", () => ({
  createRobotDriver: () => ({
    vendor: "sim",
    connect: async () => {
      H.transient.connects++;
      if (H.transient.hang) await new Promise(() => undefined);
    },
    disconnect: async () => {
      H.transient.disconnects++;
    },
    isConnected: () => true,
    runJob: async (job: { jobType: string }) => {
      H.jobs.push({ jobType: `transient:${job.jobType}` });
      return H.fail ? { ok: false, status: "failed", error: "no ack" } : { ok: true, status: "done" };
    },
  }),
}));
vi.mock("../ecosystem/ecosystemEvents", () => ({ publishAnomalyDetected: (p: { message: string }) => H.alerts.push(p.message) }));
vi.mock("../notificationService", () => ({ sendNotification: async () => undefined }));

import { changeDeviceOwner, sweepPendingCentralStops, _setCentralStopSessionDeadlineMsForTests, DEVICE_OWNER_CHANNEL } from "./deviceOwnershipService";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const TAG = `D10I-${Date.now()}`;
let sql: ReturnType<typeof postgres>;
let viewExists = false;
const made = { nodes: [] as number[], robots: [] as number[], adapters: [] as number[] };
const env: Record<string, string | undefined> = {};
let actor = 0;

async function node(s: string) {
  const [n] = await sql`INSERT INTO edge_nodes (code, name, status) VALUES (${`${TAG}-N${s}`}, 'n', 'offline') RETURNING id`;
  made.nodes.push(Number(n.id));
  return Number(n.id);
}
async function edgeOwnedRobotWithPendingStop(s: string, expiresIn = "1 minute") {
  const n = await node(s);
  const [r] = await sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled") VALUES (${`${TAG}-R${s}`}, 'r', 'sim', 'sim://t', true) RETURNING id`;
  made.robots.push(Number(r.id));
  await sql`UPDATE robots SET "edgeNodeId" = ${n} WHERE id = ${r.id}`;
  const [o] = await sql`SELECT "ownerEpoch" FROM robots WHERE id = ${r.id}`;
  const [q] = await sql`INSERT INTO robot_motion_lock_requests ("robotId", "edgeNodeId", "ownerEpoch", kind, reason, "requestedBy", "expiresAt")
                        VALUES (${r.id}, ${n}, ${o.ownerEpoch}, 'stop', 'console stop', ${actor}, now() + ${expiresIn}::interval) RETURNING id`;
  return { node: n, robot: Number(r.id), request: Number(q.id) };
}
/** the durable alert is fire-and-forget (never holds the STOP path) — wait for it, bounded */
const alerted = async () => {
  const t0 = Date.now();
  while (H.alerts.length === 0 && Date.now() - t0 < 3_000) await new Promise((r) => setTimeout(r, 25));
  return H.alerts.join("\n");
};
const reqRow = async (id: number) => (await sql`SELECT "ackedAt", outcome, "ackedBy" FROM robot_motion_lock_requests WHERE id = ${id}`)[0];

describe.skipIf(!onTest)("R-10-i / R-10-v / R-10-w — STOPs owed after a transfer to central; live ownership (_test)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL, { max: 2, connect_timeout: 30, onnotice: () => {} });
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
    _setCentralStopSessionDeadlineMsForTests(null);
    // M-7 — remove what the guards allow: jobs, locks, owners, then robots / adapters / nodes (acked requests + WORM history stay)
    for (const r of made.robots) {
      await sql`DELETE FROM robot_jobs WHERE "robotId" = ${r}`.catch(() => undefined);
      await sql`UPDATE robots SET "edgeNodeId" = NULL WHERE id = ${r} AND "edgeNodeId" IS NOT NULL`.catch(() => undefined);
      // a device with an unacknowledged STOP cannot be deleted (L-7 guard): the test's own leftovers are acked through the guard
      for (const q of await sql`SELECT id FROM robot_motion_lock_requests WHERE "robotId" = ${r} AND kind = 'stop' AND "ackedAt" IS NULL`) {
        await sql`SELECT public.edge_stop_ack_central(${q.id}, 'failed', ${actor})`.catch(() => undefined);
      }
      for (const q of await sql`SELECT "requestId" AS id FROM device_pending_stops WHERE "needsResolution" AND "robotId" = ${r}`) {
        await sql`SELECT public.edge_stop_resolve(${q.id}, ${actor}, 'test cleanup (no device)')`.catch(() => undefined);
      }
      await sql`DELETE FROM robot_motion_locks WHERE "robotId" = ${r}`.catch(() => undefined);
      await sql`DELETE FROM robots WHERE id = ${r}`.catch(() => undefined);
    }
    for (const a of made.adapters) {
      await sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${a} AND "edgeNodeId" IS NOT NULL`.catch(() => undefined);
      for (const q of await sql`SELECT id FROM robot_motion_lock_requests WHERE "adapterId" = ${a} AND kind = 'stop' AND "ackedAt" IS NULL`) {
        await sql`SELECT public.edge_stop_ack_central(${q.id}, 'failed', ${actor})`.catch(() => undefined);
      }
      for (const q of await sql`SELECT "requestId" AS id FROM device_pending_stops WHERE "needsResolution" AND "adapterId" = ${a}`) {
        await sql`SELECT public.edge_stop_resolve(${q.id}, ${actor}, 'test cleanup (no device)')`.catch(() => undefined);
      }
      await sql`DELETE FROM device_adapters WHERE id = ${a}`.catch(() => undefined);
    }
    for (const n of made.nodes) await sql`DELETE FROM edge_nodes WHERE id = ${n}`.catch(() => undefined);
    await sql.end();
  }, 60_000);
  beforeEach(() => {
    H.jobs.length = 0;
    H.alerts.length = 0;
    H.attached.length = 0;
    H.detached.length = 0;
    H.fail = false;
    H.active = true;
    H.delayMs = 0;
    H.transient = { connects: 0, disconnects: 0, hang: false };
  });

  it("★ edge → central with an unacked (even overdue) STOP request ⇒ the abort is SENT right after the transfer, acked done by the actor; the session is attached live", async () => {
    expect(viewExists).toBe(true);
    const { robot, request } = await edgeOwnedRobotWithPendingStop("a", "1 second");
    await new Promise((r) => setTimeout(r, 1_200)); // OVERDUE (past expiresAt) — still owed
    expect((await sql`SELECT overdue FROM device_pending_stops WHERE "requestId" = ${request}`)[0].overdue).toBe(true);
    const r = await changeDeviceOwner({ kind: "robot", deviceId: robot, toEdgeNodeId: null, actorUserId: actor, actorName: "test" });
    expect(r).toMatchObject({ ok: true, toEdgeNodeId: null, centralStops: { requestIds: [request], outcome: "done", sent: "sent", ackErrors: [] } });
    expect(H.jobs.map((j) => j.jobType)).toEqual(["abort"]);
    expect(await reqRow(request)).toMatchObject({ outcome: "done", ackedBy: actor });
    expect(H.alerts).toEqual([]);
    expect(H.attached).toEqual([robot]); // R-10-v — applied in this process at once
  });

  it("★ the STOP cannot be confirmed ⇒ acked FAILED (row kept) + a CRITICAL alert", async () => {
    const { robot, request } = await edgeOwnedRobotWithPendingStop("b");
    H.fail = true;
    const r = await changeDeviceOwner({ kind: "robot", deviceId: robot, toEdgeNodeId: null, actorUserId: actor, actorName: "test" });
    expect(r).toMatchObject({ ok: true, centralStops: { outcome: "failed", sent: "failed" } });
    expect(await reqRow(request)).toMatchObject({ outcome: "failed", ackedBy: actor });
    expect(await alerted()).toMatch(/could NOT be sent/);
  });

  it("★ I-4 — NO central session (the production case): a TRANSIENT session connects, sends the abort, disconnects; acked done", async () => {
    const { robot, request } = await edgeOwnedRobotWithPendingStop("t1");
    H.active = false;
    const r = await changeDeviceOwner({ kind: "robot", deviceId: robot, toEdgeNodeId: null, actorUserId: actor, actorName: "test" });
    expect(r).toMatchObject({ ok: true, centralStops: { outcome: "done", sent: "sent" } });
    expect(H.jobs.map((j) => j.jobType)).toEqual(["transient:abort"]);
    expect(H.transient).toMatchObject({ connects: 1, disconnects: 1 });
    expect(await reqRow(request)).toMatchObject({ outcome: "done" });
  });

  it("★ I-4 — the transient connect HANGS ⇒ bounded by the session deadline ⇒ failed + alert (explicit bound)", async () => {
    const { robot, request } = await edgeOwnedRobotWithPendingStop("t2");
    H.active = false;
    H.transient.hang = true;
    _setCentralStopSessionDeadlineMsForTests(300);
    const t0 = Date.now();
    const r = await changeDeviceOwner({ kind: "robot", deviceId: robot, toEdgeNodeId: null, actorUserId: actor, actorName: "test" });
    expect(Date.now() - t0).toBeLessThan(3_000);
    _setCentralStopSessionDeadlineMsForTests(null);
    expect(r).toMatchObject({ ok: true, centralStops: { outcome: "failed", sent: "failed" } });
    expect(await reqRow(request)).toMatchObject({ outcome: "failed" });
    expect(await alerted()).toMatch(/could NOT be sent/);
  });

  it("an adapter with no pinned stop tag ⇒ the STOP is impossible ⇒ failed + alert (hardware E-STOP named)", async () => {
    const n = await node("A");
    const [a] = await sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled") VALUES (${`${TAG}-A`}, 'a', 'stub', 'stub://a', false) RETURNING id`;
    made.adapters.push(Number(a.id));
    await sql`UPDATE device_adapters SET "edgeNodeId" = ${n} WHERE id = ${a.id}`;
    const [o] = await sql`SELECT "ownerEpoch" FROM device_adapters WHERE id = ${a.id}`;
    const [q] = await sql`INSERT INTO robot_motion_lock_requests ("adapterId", "edgeNodeId", "ownerEpoch", kind, reason, "requestedBy", "expiresAt")
                          VALUES (${a.id}, ${n}, ${o.ownerEpoch}, 'stop', 'console stop', ${actor}, now() + interval '1 minute') RETURNING id`;
    const r = await changeDeviceOwner({ kind: "adapter", deviceId: Number(a.id), toEdgeNodeId: null, actorUserId: actor, actorName: "test" });
    expect(r).toMatchObject({ ok: true, centralStops: { outcome: "failed", sent: "failed" } });
    expect((r as { centralStops: { detail: string } }).centralStops.detail).toMatch(/hardware E-STOP/);
    expect(await reqRow(Number(q.id))).toMatchObject({ outcome: "failed" });
    await alerted();
    expect(H.alerts).toHaveLength(1);
  });

  it("★ R-10-v — central → edge: the central session is DETACHED at once; a NOTIFY 'device_owner_changed' reaches other replicas", async () => {
    const n = await node("v");
    const [rr] = await sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled") VALUES (${`${TAG}-Rv`}, 'r', 'sim', 'sim://t', true) RETURNING id`;
    const robot = Number(rr.id);
    made.robots.push(robot);
    const got: string[] = [];
    const sub = await sql.listen(DEVICE_OWNER_CHANNEL, (p) => got.push(p));
    try {
      const r = await changeDeviceOwner({ kind: "robot", deviceId: robot, toEdgeNodeId: n, actorUserId: actor, actorName: "test" });
      expect(r).toMatchObject({ ok: true, toEdgeNodeId: n, centralStops: null });
      expect(H.detached).toEqual([robot]);
      const t0 = Date.now();
      while (!got.some((p) => JSON.parse(p).id === robot) && Date.now() - t0 < 3_000) await new Promise((x) => setTimeout(x, 50));
      expect(got.map((p) => JSON.parse(p)).find((m) => m.id === robot)).toMatchObject({ kind: "robot", id: robot, to: n });
    } finally {
      await sub.unlisten();
    }
  });

  it("★ R-10-w — a transfer made by ANOTHER path (plain SQL): the sweep executes the owed STOP; two sweeps at once send it ONCE; a later sweep finds nothing", async () => {
    const { robot, request } = await edgeOwnedRobotWithPendingStop("w");
    await sql`UPDATE robots SET "edgeNodeId" = NULL WHERE id = ${robot}`; // not through changeDeviceOwner ⇒ nobody ran the STOP yet
    H.delayMs = 400; // the first sweep holds the request lock while its STOP is in flight
    const [a, b] = await Promise.all([sweepPendingCentralStops({ device: { kind: "robot", id: robot } }), sweepPendingCentralStops({ device: { kind: "robot", id: robot } })]);
    expect(H.jobs.map((j) => j.jobType)).toEqual(["abort"]);
    expect([...a, ...b]).toHaveLength(1);
    expect([...a, ...b][0]).toMatchObject({ requestIds: [request], outcome: "done" });
    expect(await reqRow(request)).toMatchObject({ outcome: "done", ackedBy: actor }); // actor = the requester (system sweep)
    expect(await sweepPendingCentralStops({ device: { kind: "robot", id: robot } })).toEqual([]);
    expect(H.jobs).toHaveLength(1);
  });

  it("edge → edge ⇒ central sends nothing (the DB carries it to the new edge); back to central ⇒ the carried STOP is executed", async () => {
    const { robot } = await edgeOwnedRobotWithPendingStop("c");
    const n2 = await node("c2");
    const r = await changeDeviceOwner({ kind: "robot", deviceId: robot, toEdgeNodeId: n2, actorUserId: actor, actorName: "test" });
    expect(r).toMatchObject({ ok: true, toEdgeNodeId: n2, centralStops: null });
    expect(H.jobs).toEqual([]);
    const owed = await sql`SELECT "requestId" FROM device_pending_stops WHERE "robotId" = ${robot} AND "currentEdgeNodeId" = ${n2}`;
    expect(owed.length).toBeGreaterThanOrEqual(1); // still owed — now to the NEW edge (the DB carry), never dropped
    const back = await changeDeviceOwner({ kind: "robot", deviceId: robot, toEdgeNodeId: null, actorUserId: actor, actorName: "test" });
    expect(back.ok).toBe(true);
    expect(H.jobs.map((j) => j.jobType)).toEqual(["abort"]);
  });
});
