/**
 * doc 81 Đợt 11 task H fix 1 (review H-R6) — the robot poll loop never waits on a held robots row. The LEGACY ingest path (the
 * default: ROBOT_INGEST_COALESCE_ENABLED unset) awaited `UPDATE robots SET status, lastSeenAt`; any transaction holding that row
 * (the central STOP sweep's FOR SHARE across its STOP I/O, an owner change, an admin edit) stalled ingestRobotState — and the
 * poll loop — for the whole hold. Now the registry write is fire-and-forget and bounded by the SERVER (lock_timeout), like the
 * coalesced path. `_test` as avi_app; the side-effect hooks are stubbed (not under test).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";

vi.mock("../../_core/socket", () => ({ emitRobotTelemetry: () => undefined }));
vi.mock("../field/fieldHealthService", () => ({ recordHeartbeat: async () => undefined }));
vi.mock("../fleet/taskAllocator", () => ({ rebalanceDeviceTasks: async () => undefined }));
vi.mock("../safety/safetyAuditService", () => ({ record: async () => undefined, recordFromDeviceIngest: async () => undefined }));
vi.mock("../ai/robotBehaviorAnomalyService", () => ({ detectAndRaiseForRobot: async () => [] }));

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const TAG = `__ri11_${Date.now()}`;
let sql: ReturnType<typeof postgres>;
let robotId = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!onTest)("Đợt 11 H fix 1 (H-R6) — legacy ingest: the registry write never holds the poll loop", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL, { max: 3, onnotice: () => {} });
    const [r] = await sql`INSERT INTO public.robots (code, name, vendor, endpoint, status) VALUES (${TAG}, ${TAG}, 'sim', 'sim://ingest-bound', 'idle') RETURNING id`;
    robotId = Number(r.id);
    delete process.env.ROBOT_INGEST_COALESCE_ENABLED;
  });
  afterAll(async () => {
    await sql`DELETE FROM public.robot_telemetry WHERE "robotId" = ${robotId}`.catch(() => undefined);
    await sql`DELETE FROM public.robots WHERE id = ${robotId}`.catch(() => undefined);
    await sql.end({ timeout: 5 });
  });
  const runtime = () => ({ id: robotId, code: TAG, vendor: "sim", connection: { endpoint: "sim://ingest-bound" }, pollIntervalMs: 5000, driver: {} }) as never;
  const state = (busy: boolean) => ({ mode: "auto", busy, estop: false, pose: { cartesian: { x: 0, y: 0, z: 0 } }, speedPct: 10, timestamp: new Date() }) as never;

  it("★ a robots row held 4 s: ingestRobotState returns within 1 s (RED before: it waited the whole hold)", async () => {
    const { ingestRobotState } = (await import(process.env.DOT11_H_INGEST || "./robotIngest")) as typeof import("./robotIngest"); // DOT11_H_INGEST: mutation runs only
    const holder = await sql.reserve();
    try {
      const [{ p: holderPid }] = await holder`SELECT pg_backend_pid() AS p`;
      await holder`BEGIN`;
      await holder`SELECT 1 FROM public.robots WHERE id = ${robotId} FOR NO KEY UPDATE`;
      const released = new Promise<void>((res) => setTimeout(() => void holder`ROLLBACK`.then(() => res(), () => res()), 4_000));
      const t0 = Date.now();
      await ingestRobotState(runtime(), state(true));
      const ms = Date.now() - t0;
      console.log(`[fix 1 H-R6] robots row held 4000 ms: ingestRobotState returned after ${ms} ms`);
      // bounded: past the registry lock_timeout the fire-and-forget write no longer waits on the holder (no pool connection held)
      await sleep(Math.max(0, 2_600 - (Date.now() - t0)));
      const [{ n: stillWaiting }] = await sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${holderPid}::int = ANY (pg_blocking_pids(pid))`;
      await released;
      expect({ fast: ms < 1_000, stillWaitingAfterBound: stillWaiting }).toEqual({ fast: true, stillWaitingAfterBound: 0 });
    } finally {
      await holder`ROLLBACK`.catch(() => undefined);
      holder.release();
    }
  }, 30_000);

  it("the registry status is still written when the row is free (fire-and-forget, not dropped)", async () => {
    const { ingestRobotState } = (await import(process.env.DOT11_H_INGEST || "./robotIngest")) as typeof import("./robotIngest"); // DOT11_H_INGEST: mutation runs only
    await sql`UPDATE public.robots SET status = 'idle' WHERE id = ${robotId}`;
    await ingestRobotState(runtime(), state(true));
    let status = "";
    for (let i = 0; i < 100 && status !== "busy"; i++) {
      status = String((await sql`SELECT status FROM public.robots WHERE id = ${robotId}`)[0].status);
      if (status !== "busy") await sleep(30);
    }
    expect(status).toBe("busy");
  }, 30_000);
});
