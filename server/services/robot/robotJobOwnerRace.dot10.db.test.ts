/**
 * doc 81 Đợt 10 task D — ruling R-10-g (M4), on the `_test` DB as avi_app with TWO concurrent transactions.
 * robot_jobs has no FK to robots, so a central MOTION whose authority read passed could insert its 'running' row at the same
 * moment as an ownership change committed (slipping past 0374's "no owner change while a job runs"). The reservation now locks
 * the robot row FOR SHARE in the SAME transaction as the insert and re-reads the authority:
 *   A. the owner change holds the row (uncommitted) while the motion's authority read passes ⇒ the reservation WAITS on the
 *      row lock; the owner change commits ⇒ the re-read sees the edge owner ⇒ REFUSED ROBOT_OWNED_BY_EDGE, the driver is never
 *      called, the ledger row is 'rejected';
 *   B. the motion reserved first (its 'running' row is committed, the driver is mid-job) ⇒ the owner change is REFUSED (23514)
 *      and the robot stays central.
 * Explicit bounds (no vitest timeouts as the oracle). Rows are removed afterwards (the WORM owner history stays, by design).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const H = vi.hoisted(() => ({ runJobs: 0, gate: null as null | Promise<void>, release: null as null | (() => void) }));
vi.mock("./robotEnabledGate", () => ({ readRobotEnabledForMotion: async () => true }));
vi.mock("../interlock/interlockGate", () => ({ evaluateInterlockGate: async () => ({ blocked: false, failClosed: false, violations: [] }) }));
vi.mock("./robotManager", () => ({
  getActiveRobot: () => ({
    id: 0,
    code: "T",
    vendor: "sim",
    driver: {
      vendor: "sim",
      isConnected: () => true,
      getMotionLock: () => ({ locked: false, generation: 0 }),
      runJob: async () => {
        H.runJobs++;
        if (H.gate) await H.gate;
        return { ok: true, status: "done" };
      },
      abort: async () => undefined,
    },
  }),
}));

import { dispatchRobotJob, ROBOT_OWNED_BY_EDGE } from "./robotCommandDispatcher";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const TAG = `D10M4-${Date.now()}`;
let sql: ReturnType<typeof postgres>;
const ids = { nodes: [] as number[], robots: [] as number[] };
const MOTION = (robotId: number) => ({ robotId, job: { jobType: "home" as const, params: {} }, triggerKind: "manual" as const, requestedBy: 1, confirmedBy: 1, idempotencyKey: `${TAG}-${robotId}-${Math.random()}` });
const env: Record<string, string | undefined> = {};
const within = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<"TIMEOUT">((r) => setTimeout(() => r("TIMEOUT"), ms))]);

async function nodeAndRobot(s: string) {
  const [n] = await sql`INSERT INTO edge_nodes (code, name, status) VALUES (${`${TAG}-N${s}`}, 'n', 'offline') RETURNING id`;
  const [r] = await sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled") VALUES (${`${TAG}-R${s}`}, 'r', 'sim', 'sim://t', true) RETURNING id`;
  ids.nodes.push(Number(n.id));
  ids.robots.push(Number(r.id));
  return { node: Number(n.id), robot: Number(r.id) };
}

describe.skipIf(!onTest)("R-10-g (M4) — a motion's ledger insert cannot race an ownership change (_test)", () => {
  beforeAll(() => {
    sql = postgres(DB_URL, { max: 2, connect_timeout: 30, onnotice: () => {} });
    for (const k of ["ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED", "ROBOT_SAFETY_PREFLIGHT_ENABLED", "EDGE_EXECUTION_ENABLED", "EDGE_GATEWAY_MODE", "FIELD_V2_ENABLED"]) env[k] = process.env[k];
    process.env.ROBOT_CONTROL_ENABLED = "true"; // the REAL path (the reservation writes the 'running' row)
    process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
    process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED = "false";
    delete process.env.EDGE_EXECUTION_ENABLED;
    delete process.env.EDGE_GATEWAY_MODE;
    delete process.env.FIELD_V2_ENABLED;
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(env)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
    // best-effort cleanup (edge lock rows are removed through the guarded function; the WORM history stays)
    for (const r of ids.robots) {
      try {
        const [o] = await sql`SELECT "edgeNodeId", "ownerEpoch", "motionLockGenerationFloor" FROM robots WHERE id = ${r}`;
        if (o?.edgeNodeId != null) {
          const [l] = await sql`SELECT generation FROM robot_motion_locks WHERE "robotId" = ${r}`;
          if (l) await sql`SELECT edge_motion_lock_clear(${r}, ${o.edgeNodeId}, ${o.ownerEpoch}::bigint, ${l.generation})`;
          await sql`UPDATE robots SET "edgeNodeId" = NULL WHERE id = ${r}`;
        }
        await sql`DELETE FROM robot_motion_locks WHERE "robotId" = ${r}`;
        await sql`DELETE FROM robot_jobs WHERE "robotId" = ${r}`.catch(() => undefined);
        await sql`DELETE FROM robots WHERE id = ${r}`.catch(() => undefined);
      } catch {
        /* leave it — unique codes per run */
      }
    }
    for (const n of ids.nodes) await sql`DELETE FROM edge_nodes WHERE id = ${n}`.catch(() => undefined);
    await sql.end();
  }, 60_000);

  it("★ A — the owner change holds the robot row: the reservation waits, then sees the edge owner ⇒ REFUSED, the driver is never called", async () => {
    const { node, robot } = await nodeAndRobot("a");
    H.runJobs = 0;
    const owner = await sql.reserve();
    try {
      await owner`BEGIN`;
      await owner`UPDATE robots SET "edgeNodeId" = ${node} WHERE id = ${robot}`; // row locked, not committed
      const motion = dispatchRobotJob(MOTION(robot));
      expect(await within(motion, 700)).toBe("TIMEOUT"); // blocked on FOR SHARE behind the owner change
      expect(H.runJobs).toBe(0);
      await owner`COMMIT`;
      const r = await within(motion, 5_000);
      expect(r).toMatchObject({ ok: false, status: "rejected", error: ROBOT_OWNED_BY_EDGE });
    } finally {
      owner.release();
    }
    expect(H.runJobs).toBe(0);
    const rows = await sql`SELECT status, result FROM robot_jobs WHERE "robotId" = ${robot}`;
    expect(rows.map((x) => x.status)).toEqual(["rejected"]);
    expect(rows[0].result).toMatchObject({ reasonCode: ROBOT_OWNED_BY_EDGE });
  }, 20_000);

  it("★ B — the motion reserved first ('running' committed, driver mid-job) ⇒ the owner change is REFUSED (23514); the robot stays central", async () => {
    const { node, robot } = await nodeAndRobot("b");
    H.runJobs = 0;
    H.gate = new Promise<void>((r) => (H.release = r));
    const motion = dispatchRobotJob(MOTION(robot));
    try {
      const t0 = Date.now();
      while (H.runJobs === 0 && Date.now() - t0 < 5_000) await new Promise((r) => setTimeout(r, 20));
      expect(H.runJobs).toBe(1);
      const err = await sql`UPDATE robots SET "edgeNodeId" = ${node} WHERE id = ${robot}`.then(
        () => null,
        (e) => (e as { code?: string }).code ?? String(e),
      );
      expect(err).toBe("23514");
    } finally {
      H.release?.();
      H.gate = null;
    }
    expect(await within(motion, 5_000)).toMatchObject({ ok: true, status: "done" });
    const [o] = await sql`SELECT "edgeNodeId" FROM robots WHERE id = ${robot}`;
    expect(o.edgeNodeId).toBeNull();
  }, 20_000);
});
