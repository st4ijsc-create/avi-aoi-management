/**
 * doc 81 Đợt 11 task H (mig 0377, one lock order — device row FIRST, then the STOP request): the central STOP sweep
 * (executeDeviceStopsLocked, via executePendingCentralStops) against an owner change of the same device.
 *
 * Before: the sweep picked the device's pending requests FOR UPDATE SKIP LOCKED, sent the STOP (I/O), then acked through
 * edge_stop_ack_central, which takes the device row FOR SHARE. An owner change made during the STOP I/O locked the device and its
 * carry waited for those requests ⇒ the ack waited for the device ⇒ 40P01. Now the sweep locks the device FOR SHARE before the
 * pick: the owner change waits (bounded by the sweep's STOP bound), the ack lands, nothing is left to carry.
 *
 * `_test` as avi_app; the transient STOP session is a fake driver whose connect() is held open by the test (the window an owner
 * change can hit). Committed rows (the race needs two sessions); cleanup through the legitimate path; WORM rows stay (R-10-aa).
 * DOT11_H_OWNERSVC (mutation runs only): the module path of deviceOwnershipService to import (an untracked copy).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";

const H = vi.hoisted(() => ({ connected: false, release: (() => undefined) as () => void, errors: [] as string[] }));
vi.mock("./robotManager", () => ({
  getActiveRobot: () => undefined, // no central session: the transient path (the production case right after edge → central)
  attachRobot: async () => true,
  detachRobot: async () => true,
  activeRobotIds: () => [],
}));
vi.mock("./driverRegistry", () => ({
  createRobotDriver: () => ({
    vendor: "sim",
    connect: async () => {
      H.connected = true;
      await new Promise<void>((r) => (H.release = r));
    },
    disconnect: async () => undefined,
    isConnected: () => true,
    runJob: async () => ({ ok: true, status: "done" }),
  }),
}));
vi.mock("../ecosystem/ecosystemEvents", () => ({ publishAnomalyDetected: () => undefined }));
vi.mock("../notificationService", () => ({ sendNotification: async () => undefined }));

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const TAG = `__sw11_${Date.now()}`;
let sql: ReturnType<typeof postgres>;
const made = { robots: [] as number[], nodes: [] as number[] };
const env: Record<string, string | undefined> = {};
let actor = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const codeOf = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; message?: string }) => e?.code ?? String(e?.message ?? e));

describe.skipIf(!onTest)("0377 — the central STOP sweep follows the one lock order (device row first)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL, { max: 3, onnotice: () => {} });
    const [u] = await sql`INSERT INTO public.users ("openId", role, "isActive") VALUES (${TAG + "-admin"}, 'admin', true) RETURNING id`;
    actor = Number(u.id);
    for (const k of ["ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED"]) env[k] = process.env[k];
    process.env.ROBOT_CONTROL_ENABLED = "true";
    process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(env)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
    H.release();
    try {
      for (const r of made.robots) {
        await sql`UPDATE public.robots SET "edgeNodeId" = NULL WHERE id = ${r} AND "edgeNodeId" IS NOT NULL`.catch(() => undefined);
        const pend = await sql`SELECT "requestId" AS q FROM public.device_pending_stops WHERE "robotId" = ${r} AND outcome IS NULL`;
        if (pend.length) {
          const [ex] = await sql`SELECT public.edge_stop_record_central_execution('robot', ${r}, true, 'sweep lock-order cleanup') AS id`;
          for (const p of pend) await sql`SELECT public.edge_stop_ack_central(${p.q}, 'done', ${ex.id}::bigint)`.catch(() => undefined);
        }
        await sql`DELETE FROM public.robot_motion_locks WHERE "robotId" = ${r}`.catch(() => undefined);
        await sql`DELETE FROM public.robots WHERE id = ${r}`.catch(() => undefined);
      }
      if (made.nodes.length) await sql`DELETE FROM public.edge_nodes WHERE id = ANY(${made.nodes})`.catch(() => undefined);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }, 120_000);

  it("★ an owner change (central → edge) made while the sweep's STOP is in flight: no 40P01; the ack lands; nothing left to carry", async () => {
    const svc = (await import(process.env.DOT11_H_OWNERSVC || "./deviceOwnershipService")) as typeof import("./deviceOwnershipService");
    const consoleError = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void H.errors.push(a.map(String).join(" ")));
    /**
     * One attempt. Another suite's GLOBAL sweep (sweepPendingCentralStops in a parallel worker) may execute this central-owned
     * robot's STOP first — then this sweep finds nothing to pick and its STOP session never opens (`connected` false): that
     * attempt says nothing about the lock order and is repeated on a fresh robot (at most 3 attempts; each is reported).
     */
    const attempt = async () => {
      H.connected = false;
      const [n1] = await sql`INSERT INTO public.edge_nodes (code, name, status) VALUES (${TAG + "a" + made.robots.length}, ${TAG}, 'offline') RETURNING id`;
      const [n2] = await sql`INSERT INTO public.edge_nodes (code, name, status) VALUES (${TAG + "b" + made.robots.length}, ${TAG}, 'offline') RETURNING id`;
      made.nodes.push(n1.id, n2.id);
      const [r] = await sql`INSERT INTO public.robots (code, name, vendor, endpoint) VALUES (${TAG + "r" + made.robots.length}, ${TAG}, 'sim', 'sim://sweep-lock-order') RETURNING id`;
      made.robots.push(r.id);
      await sql`UPDATE public.robots SET "edgeNodeId" = ${n1.id} WHERE id = ${r.id}`;
      const [{ e }] = await sql`SELECT "ownerEpoch" AS e FROM public.robots WHERE id = ${r.id}`;
      const [q] = await sql`INSERT INTO public.robot_motion_lock_requests ("robotId", "edgeNodeId", "ownerEpoch", kind, "requestedBy", "expiresAt", reason) VALUES (${r.id}, ${n1.id}, ${e}, 'stop', ${actor}, now() + interval '1 minute', 'sweep lock-order STOP') RETURNING id`;
      await sql`UPDATE public.robots SET "edgeNodeId" = NULL WHERE id = ${r.id}`; // now central-owned: centralMustExecute
      const b = await sql.reserve();
      try {
        const [{ p: bPid }] = await b`SELECT pg_backend_pid() AS p`;
        const sweep = svc.executePendingCentralStops("robot", Number(r.id), actor);
        const t0 = Date.now();
        while (!H.connected && Date.now() - t0 < 10_000) await sleep(20);
        if (!H.connected) {
          await sweep;
          return null; // another worker's sweep executed it — not this attempt's question
        }
        await b`BEGIN`;
        await b`SET LOCAL lock_timeout = '15s'`;
        const change = codeOf(b`UPDATE public.robots SET "edgeNodeId" = ${n2.id} WHERE id = ${r.id}`);
        let bWaits = false;
        for (let i = 0; i < 100 && !bWaits; i++) {
          bWaits = (await sql`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = ${bPid} AND NOT granted) AS w`)[0].w;
          if (!bWaits) await sleep(25);
        }
        H.release(); // the STOP reaches the device; the sweep records it and acks
        const out = await sweep;
        const changeCode = await change;
        const changeCommit = changeCode === null ? await codeOf(b`COMMIT`) : changeCode;
        const [row] = await sql`SELECT outcome, "carriedToId" IS NOT NULL AS carried FROM public.robot_motion_lock_requests WHERE id = ${q.id}`;
        const heads = await sql`SELECT count(*)::int AS n FROM public.device_pending_stops WHERE "robotId" = ${r.id} AND outcome IS NULL`;
        return {
          bWaits,
          outcome: out?.outcome,
          sent: out?.sent,
          ackErrors: out?.ackErrors,
          changeCode: changeCommit,
          request: `${row.outcome}/${row.carried}`,
          pendingHeads: heads[0].n,
          deadlockLogged: H.errors.some((x) => /deadlock|40P01/i.test(x)),
        };
      } finally {
        H.release();
        await b`ROLLBACK`.catch(() => undefined);
        b.release();
      }
    };
    try {
      let res: Awaited<ReturnType<typeof attempt>> = null;
      let attempts = 0;
      while (res === null && attempts < 3) {
        attempts++;
        res = await attempt();
      }
      expect({ attempts: res === null ? attempts : "ran", ...res }).toEqual({ attempts: "ran", bWaits: true, outcome: "done", sent: "sent", ackErrors: [], changeCode: null, request: "done/false", pendingHeads: 0, deadlockLogged: false });
    } finally {
      consoleError.mockRestore();
    }
  }, 90_000);
});
