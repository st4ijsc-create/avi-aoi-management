/**
 * doc 81 Đợt 4 Task B4 (QĐ-4c, mig 0364) — KHOÁ CHUYỂN ĐỘNG sống qua khởi động lại (CSDL `_test` THẬT).
 *
 * Trước: khoá chỉ ở bộ nhớ driver — robot bị khoá (mất kết nối / kết cục không rõ), tiến trình khởi động lại ⇒ driver
 * mới, khoá mất ⇒ chuyển động được phép lại mà không có DỪNG xác nhận hay gỡ khoá có kiểm toán. Sau: lock() ghi hàng
 * `robot_motion_locks`; robotManager.startRobots nạp nó TRƯỚC khi nối ⇒ robot bắt đầu KHOÁ; DỪNG xác nhận / gỡ khoá có
 * kiểm toán xoá hàng; không đọc được ⇒ khoá `persistUnknown` (fail-closed).
 *
 * "Khởi động lại" = stopRobots() rồi startRobots() với driver MỚI (MotionLock mới, trống) — đúng thứ một tiến trình mới
 * có. Driver giả trong tiến trình (không socket) mang MotionLock THẬT; dispatcher THẬT; router THẬT (quyền giả qua).
 * Oracle: hàng SQL đọc bằng truy vấn riêng + quyết định của dispatcher + hàng audit_logs.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";

const H = vi.hoisted(() => ({
  robotId: 990_364_000 + (Date.now() % 9_000),
  drivers: [] as unknown[],
  getDbFault: null as null | "throw" | "hang",
}));

vi.mock("../../db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/connection")>();
  return {
    ...actual,
    getDb: vi.fn(async () => {
      if (H.getDbFault === "throw") throw new Error("simulated DB outage (postgres://app:SECRETPW@db/x)");
      if (H.getDbFault === "hang") return new Promise(() => undefined);
      return actual.getDb();
    }),
  };
});
vi.mock("./robotAdapter", async () => {
  const { MotionLock } = await import("./robotDriver");
  class LockDriver {
    readonly vendor = "mitsubishi" as const;
    readonly motionLock = new MotionLock();
    connected = false;
    stops = 0;
    async connect() {
      this.connected = true;
    }
    async disconnect() {
      this.connected = false;
    }
    isConnected() {
      return this.connected;
    }
    async getState() {
      return { timestamp: new Date() };
    }
    async subscribeState() {
      return { close: async () => undefined };
    }
    async runJob(job: { jobType: string }) {
      if (job.jobType === "abort") {
        this.stops += 1;
        this.motionLock.clearByStop(); // a STOP delivered AND confirmed by the driver
        return { ok: true, status: "done" as const, detail: {} };
      }
      const refusal = this.motionLock.refusal(job as any);
      if (refusal) return refusal;
      return { ok: true, status: "done" as const, detail: {} };
    }
    async abort() {}
    async health() {
      return { vendor: this.vendor, connected: this.connected };
    }
    getMotionLock() {
      return this.motionLock.snapshot();
    }
    clearMotionLock(input: { reason: string; userId: number; expectedGeneration: number }) {
      return this.motionLock.clearByOperator(input);
    }
    lockMotion(reasonCode: string, detail?: string) {
      this.motionLock.lock(reasonCode, detail);
    }
    motionLockController() {
      return this.motionLock;
    }
  }
  return {
    loadEnabledRobots: async () => {
      const driver = new LockDriver();
      H.drivers.push(driver);
      return [{ id: H.robotId, code: `B4-${H.robotId}`, vendor: "mitsubishi", connection: { endpoint: "sim://b4" }, pollIntervalMs: 60_000, driver }];
    },
  };
});
// startRobots reconciles orphaned robot_jobs of the WHOLE shared _test DB — not this test's business.
vi.mock("./robotCommandDispatcher", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./robotCommandDispatcher")>()),
  reconcileOrphanedRobotJobs: async () => undefined,
  orphanedRunningThresholdMs: () => 3_600_000,
}));
vi.mock("../ot/adapterFacade", () => ({
  createAdapterFacade: () => ({ getSafetyStatus: async () => ({ state: "OK", source: "test", ts: "" }) }),
}));
vi.mock("../interlock/interlockGate", () => ({ evaluateInterlockGate: async () => ({ blocked: false, failClosed: false, violations: [] }) }));
vi.mock("../../_core/accessControl", () => ({ requirePermission: () => async ({ ctx, next }: any) => next({ ctx }) }));

import { getDb } from "../../db/connection";
import { robotMotionLocks, auditLogs } from "../../../drizzle/schema";
import { startRobots, stopRobots, getActiveRobot } from "./robotManager";
import { dispatchRobotJob } from "./robotCommandDispatcher";
import { _flushMotionLockWritesForTests, MOTION_LOCK_DB_DEADLINE_MS } from "./robotMotionLockStore";
import { robotRouter } from "../../routers/robotRouter";

const ROBOT = H.robotId;
const USER = 990_364_901;
type Drv = { motionLock: import("./robotDriver").MotionLock; stops: number; getMotionLock(): any; lockMotion(r: string, d?: string): void };
const current = () => H.drivers[H.drivers.length - 1] as Drv;

async function db() {
  const d = await getDb();
  if (!d) throw new Error("no _test DB");
  return d;
}
async function row() {
  const [r] = await (await db()).select().from(robotMotionLocks).where(eq(robotMotionLocks.robotId, ROBOT));
  return r ?? null;
}
async function restart() {
  await stopRobots();
  await startRobots();
  expect(getActiveRobot(ROBOT)).toBeDefined();
}
const MOTION = { robotId: ROBOT, job: { jobType: "home" as const, params: {} }, triggerKind: "manual" as const, requestedBy: USER, confirmedBy: USER };
const STOP = { robotId: ROBOT, job: { jobType: "abort" as const, params: {} }, triggerKind: "manual" as const, requestedBy: USER, confirmedBy: USER };

const ENV = ["ROBOT_GATEWAY_ENABLED", "ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED", "FIELD_V2_ENABLED", "SEC_PLATFORM", "ROBOT_SAFETY_PREFLIGHT_ENABLED", "AUTH_2FA_BAT_BUOC"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV) saved[k] = process.env[k];

async function cleanup() {
  const d = await db();
  await d.delete(robotMotionLocks).where(eq(robotMotionLocks.robotId, ROBOT)); // robot_jobs is append-only (no DELETE for avi_app): its rows of this fake robot id stay
}
beforeAll(async () => {
  await cleanup();
});
afterAll(async () => {
  H.getDbFault = null;
  await stopRobots();
  await _flushMotionLockWritesForTests();
  await cleanup();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
beforeEach(async () => {
  H.getDbFault = null;
  process.env.ROBOT_GATEWAY_ENABLED = "true";
  process.env.ROBOT_CONTROL_ENABLED = "true";
  process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
  delete process.env.FIELD_V2_ENABLED;
  delete process.env.SEC_PLATFORM;
  delete process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED;
  await stopRobots();
  await _flushMotionLockWritesForTests();
  await cleanup();
  await startRobots();
});

describe("B4 — motion lock survives a restart (robot_motion_locks, _test)", () => {
  it("★ lock → restart ⇒ still LOCKED (same cause, time, generation); motion refused by the dispatcher", async () => {
    current().lockMotion("line_connection_closed", "peer dropped");
    const before = current().getMotionLock();
    await _flushMotionLockWritesForTests();
    expect(await row()).toMatchObject({ robotId: ROBOT, reasonCode: "line_connection_closed", detail: "peer dropped", generation: before.generation });

    await restart();
    const after = current().getMotionLock();
    expect(after).toMatchObject({ locked: true, reasonCode: "line_connection_closed", generation: before.generation });
    expect(new Date(after.since).getTime()).toBe(new Date(before.since).getTime());
    const r = await dispatchRobotJob(MOTION);
    expect(r).toMatchObject({ ok: false, status: "rejected", error: "MOTION_LOCKED" });
  });

  it("★ a confirmed STOP clears it — the row is gone and the NEXT restart starts unlocked", async () => {
    current().lockMotion("rmi_reply_timeout");
    await _flushMotionLockWritesForTests();
    expect(await row()).not.toBeNull();
    await restart();
    expect(current().getMotionLock().locked).toBe(true);
    const r = await dispatchRobotJob(STOP);
    expect(r.status).toBe("done");
    expect(current().stops).toBe(1);
    expect(current().getMotionLock()).toMatchObject({ locked: false, clearedBy: "stop_confirmed" });
    await _flushMotionLockWritesForTests();
    expect(await row()).toBeNull();
    await restart();
    expect(current().getMotionLock().locked).toBe(false);
    expect((await dispatchRobotJob(MOTION)).status).toBe("done");
  });

  it("★ operator clear (robot.clearMotionLock) is AUDITED and removes the row; generation quoted from before the restart", async () => {
    current().lockMotion("line_connection_closed");
    await _flushMotionLockWritesForTests();
    await restart();
    const gen = current().getMotionLock().generation;
    const caller = robotRouter.createCaller({ user: { id: USER, role: "engineer", name: "B4 op", twoFactorEnabled: true }, req: { ip: "127.0.0.1", headers: {} } } as any);
    const res = await caller.clearMotionLock({ robotId: ROBOT, reason: "checked on site, robot stationary", expectedGeneration: gen! });
    expect(res).toMatchObject({ changed: true, motionLock: { locked: false, clearedBy: "operator", clearedByUserId: USER } });
    await _flushMotionLockWritesForTests();
    expect(await row()).toBeNull();
    const audits = await (await db())
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, "robot"), eq(auditLogs.entityId, ROBOT), eq(auditLogs.action, "robot.clearMotionLock")));
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(audits[audits.length - 1].details)).toContain("checked on site, robot stationary");
    await restart();
    expect(current().getMotionLock().locked).toBe(false);
  });

  it("★ fail-closed: the persisted lock cannot be read at registration ⇒ starts LOCKED `persistUnknown`; an audited clear unlocks", async () => {
    await stopRobots();
    H.getDbFault = "throw";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await startRobots();
    H.getDbFault = null;
    expect(current().getMotionLock()).toMatchObject({ locked: true, reasonCode: "persistUnknown" });
    expect(errSpy.mock.calls.flat().join(" ")).not.toContain("SECRETPW");
    errSpy.mockRestore();
    expect((await dispatchRobotJob(MOTION)).error).toBe("MOTION_LOCKED");
    const caller = robotRouter.createCaller({ user: { id: USER, role: "engineer", name: "B4 op", twoFactorEnabled: true }, req: { ip: "127.0.0.1", headers: {} } } as any);
    await caller.clearMotionLock({ robotId: ROBOT, reason: "DB was down at boot; robot checked", expectedGeneration: current().getMotionLock().generation });
    expect(current().getMotionLock().locked).toBe(false);
  });

  it("★ a HUNG load is bounded: registration finishes within the DB deadline and the robot starts locked", async () => {
    await stopRobots();
    H.getDbFault = "hang";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const t0 = Date.now();
    await startRobots();
    const elapsed = Date.now() - t0;
    H.getDbFault = null;
    errSpy.mockRestore();
    expect(elapsed).toBeLessThan(MOTION_LOCK_DB_DEADLINE_MS + 1000);
    expect(current().getMotionLock()).toMatchObject({ locked: true, reasonCode: "persistUnknown" });
  });

  it("★ a failing DB write never blocks lock(): locked at once in memory, error logged", async () => {
    H.getDbFault = "hang";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const t0 = Date.now();
    current().lockMotion("line_reply_timeout");
    expect(Date.now() - t0).toBeLessThan(50);
    expect(current().getMotionLock().locked).toBe(true);
    await _flushMotionLockWritesForTests();
    expect(errSpy.mock.calls.flat().join(" ")).toMatch(/not persisted/);
    errSpy.mockRestore();
    H.getDbFault = null;
    expect(await row()).toBeNull();
    // and a STOP still clears instantly in memory while the DB is unreachable
    H.getDbFault = "hang";
    const t1 = Date.now();
    current().motionLock.clearByStop();
    expect(Date.now() - t1).toBeLessThan(50);
    expect(current().getMotionLock().locked).toBe(false);
    H.getDbFault = null;
  });

  it("lock → clear → lock quickly: writes land in order (no stale row from an older generation)", async () => {
    const d = current();
    d.lockMotion("a");
    d.motionLock.clearByStop();
    d.lockMotion("b");
    d.motionLock.clearByStop();
    await _flushMotionLockWritesForTests();
    expect(await row()).toBeNull();
    d.lockMotion("c");
    await _flushMotionLockWritesForTests();
    expect(await row()).toMatchObject({ reasonCode: "c", generation: d.getMotionLock().generation });
  });
});
