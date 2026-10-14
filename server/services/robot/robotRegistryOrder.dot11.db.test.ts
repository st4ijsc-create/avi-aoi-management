/**
 * doc 81 Đợt 11 final fix wave (ruling R-11-k 4, final review M-4 — safety-relevant: fleet assignment reads robots.status) — the
 * registry status writes are ORDERED by the observation timestamp: a stale write never overwrites a fresher one, and a less safe
 * status never overwrites a fresher, safer one. `_test` only; the ingest side-effect hooks are stubbed (not under test).
 * Deterministic interleavings: the "fresher" row is put in place first (as a reordered newer transaction would have left it), or the
 * row is held so the writes queue behind it in a known order.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";

vi.mock("../../_core/socket", () => ({ emitRobotTelemetry: () => undefined }));
vi.mock("../field/fieldHealthService", () => ({ recordHeartbeat: async () => undefined }));
vi.mock("../fleet/taskAllocator", () => ({ rebalanceDeviceTasks: async () => undefined }));
vi.mock("../safety/safetyAuditService", () => ({ record: async () => undefined, recordFromDeviceIngest: async () => undefined }));
vi.mock("../ai/robotBehaviorAnomalyService", () => ({ detectAndRaiseForRobot: async () => [] }));

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const TAG = `__rord11_${Date.now()}`;
let sql: ReturnType<typeof postgres>;
let robotId = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const statusOf = async () => String((await sql`SELECT status FROM public.robots WHERE id = ${robotId}`)[0].status);

describe.skipIf(!onTest)("Đợt 11 final fix wave (M-4) — robot registry status writes are ordered", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL, { max: 3, onnotice: () => {} });
    const [r] = await sql`INSERT INTO public.robots (code, name, vendor, endpoint, status) VALUES (${TAG}, ${TAG}, 'sim', 'sim://registry-order', 'idle') RETURNING id`;
    robotId = Number(r.id);
    delete process.env.ROBOT_INGEST_COALESCE_ENABLED;
  });
  afterAll(async () => {
    await sql`DELETE FROM public.robot_telemetry WHERE "robotId" = ${robotId}`.catch(() => undefined);
    await sql`DELETE FROM public.robots WHERE id = ${robotId}`.catch(() => undefined);
    await sql.end({ timeout: 5 });
  });
  beforeEach(async () => {
    await sql`UPDATE public.robots SET status = 'idle', "lastSeenAt" = NULL WHERE id = ${robotId}`;
  });
  const runtime = () => ({ id: robotId, code: TAG, vendor: "sim", connection: { endpoint: "sim://registry-order" }, pollIntervalMs: 5000, driver: {} }) as never;
  const state = (s: { busy?: boolean; estop?: boolean }) => ({ mode: "auto", busy: s.busy ?? false, estop: s.estop ?? false, pose: { cartesian: { x: 0, y: 0, z: 0 } }, speedPct: 10, timestamp: new Date() }) as never;

  it("★ RED-first: a FRESHER e-stop is already in the row (a newer transaction that committed first); the late, older 'idle' ingest write is IGNORED", async () => {
    const { ingestRobotState } = (await import(process.env.DOT11_FW_INGEST || "./robotIngest")) as typeof import("./robotIngest"); // DOT11_FW_INGEST: RED / mutation runs only
    // the fresher observation: lastSeenAt 60 s ahead (UTC wall time, the column's convention), status estop
    await sql`UPDATE public.robots SET status = 'estop', "lastSeenAt" = (now() AT TIME ZONE 'UTC') + interval '60 seconds' WHERE id = ${robotId}`;
    await ingestRobotState(runtime(), state({}));
    await sleep(400); // the registry write is fire-and-forget
    expect(await statusOf()).toBe("estop");
  }, 30_000);

  it("the guard: newer lands, older is ignored, `estop` (the safest) always lands", async () => {
    const { _writeRobotRegistryForTests } = await import("./robotIngest");
    const t = Date.now();
    await _writeRobotRegistryForTests(robotId, "busy", new Date(t));
    expect(await statusOf()).toBe("busy");
    await _writeRobotRegistryForTests(robotId, "idle", new Date(t - 1000)); // stale
    expect(await statusOf()).toBe("busy");
    await _writeRobotRegistryForTests(robotId, "idle", new Date(t + 1000)); // fresher
    expect(await statusOf()).toBe("idle");
    await _writeRobotRegistryForTests(robotId, "estop", new Date(t - 5000)); // older, but the safest: fail closed
    expect(await statusOf()).toBe("estop");
  }, 30_000);

  it("★ row held: idle(t1), estop(t2), then a late busy(t0 < t2) queue behind it ⇒ after release the registry shows estop (one write in flight, coalesced to the newest)", async () => {
    const { _queueRobotRegistryWriteForTests } = await import("./robotIngest");
    const holder = await sql.reserve();
    try {
      await holder`BEGIN`;
      await holder`SELECT 1 FROM public.robots WHERE id = ${robotId} FOR NO KEY UPDATE`;
      const t = Date.now();
      _queueRobotRegistryWriteForTests(robotId, "idle", new Date(t + 1)); // in flight, blocked on the row
      await sleep(100);
      _queueRobotRegistryWriteForTests(robotId, "estop", new Date(t + 2)); // waits behind it
      _queueRobotRegistryWriteForTests(robotId, "busy", new Date(t)); // stale: older than the waiting estop ⇒ dropped
      await sleep(200);
      // every UPDATE of robots waiting on a lock (a 2nd waiter queues behind the 1st, not directly behind the holder)
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0 AND query ILIKE 'update "robots"%'`;
      expect(n).toBe(1); // ONE registry write in flight for this robot, the rest coalesced in memory
      await holder`ROLLBACK`;
    } finally {
      await holder`ROLLBACK`.catch(() => undefined);
      holder.release();
    }
    let s = "";
    for (let i = 0; i < 100; i++) {
      s = await statusOf();
      if (s === "estop") break;
      await sleep(30);
    }
    await sleep(300);
    expect(await statusOf()).toBe("estop");
  }, 30_000);
});
