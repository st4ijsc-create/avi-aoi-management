/**
 * doc 81 Đợt 1C final wave 3 (ruling R-1C-j, final review I4) — cầu ROS2 KHÔNG BAO GIỜ phát publishSpec của người gọi.
 *
 * Trước bản vá: `dispatchToRos2(input, publishSpec)` chạy dispatcher (driver.runJob) rồi phát NGUYÊN VĂN
 * `publishSpec.msg` — (a) một STOP có thể mang chuyển động lậu qua dây, (b) hash "gắn một lần" chỉ gắn job trong sổ,
 * không gắn thứ đi trên dây, (c) robot bị điều khiển HAI lần cho một lệnh (driver + cầu).
 * Sau: thông điệp chuyển động dựng CHỈ từ `job.params.ros2` của job đã gắn (thứ dispatcher kiểm hash) và đi qua
 * ĐÚNG MỘT kênh (cầu thay driver.runJob); STOP ⇒ driver nhận abort + cầu phát THÔNG ĐIỆP DỪNG CỐ ĐỊNH; publishSpec bị bỏ qua.
 *
 * Oracle độc lập: client rosbridge giả ghi lại từng (topic, type, msg) THẬT SỰ được phát; driver giả ghi từng job nhận.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
// doc 81 Đợt 4 final wave R-4-x — this suite does not measure the motion "robot enabled" gate (robotEnabledGate.dot4.test.ts does).
vi.mock("../robot/robotEnabledGate", () => ({ readRobotEnabledForMotion: async () => true }));

type Row = Record<string, any>;
const S = vi.hoisted(() => ({ rows: [] as Record<string, any>[], seq: 1, driverJobs: [] as string[] }));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: (col: any, val: any) => ({ __k: col?.__name, __v: val }), and: (...p: any[]) => ({ __and: p }) };
});
function makeFakeDb() {
  return {
    select: () => ({
      from: (t: any) => ({
        where: (pred: any) => {
          const rows = t?.__table === "robot_jobs" ? S.rows.filter((r) => pred?.__k && r[pred.__k] === pred.__v) : [];
          return { limit: async () => rows.slice(0, 1), then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej) };
        },
      }),
    }),
    insert: (t: any) => ({
      values: (vals: Row) => ({
        returning: async () => {
          const row = { id: S.seq++, ...vals };
          if (t?.__table === "robot_jobs") S.rows.push(row);
          return [{ id: row.id }];
        },
      }),
    }),
    update: (t: any) => ({
      set: (vals: Row) => ({
        where: async (pred: any) => {
          for (const r of t?.__table === "robot_jobs" ? S.rows : []) if (r[pred.__k] === pred.__v) Object.assign(r, vals);
        },
      }),
    }),
  };
}
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));
vi.mock("../../../drizzle/schema", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  robotJobs: { __table: "robot_jobs", id: { __name: "id" }, idempotencyKey: { __name: "idempotencyKey" }, robotId: { __name: "robotId" }, jobType: { __name: "jobType" } },
  robots: { __table: "robots", id: { __name: "id" } },
  aiPendingActions: { __table: "ai_pending_actions", id: { __name: "id" } },
}));
vi.mock("../robot/robotManager", () => ({
  getActiveRobot: (id: number) =>
    id === 7
      ? {
          driver: {
            vendor: "sim",
            isConnected: () => true,
            getMotionLock: () => ({ locked: false }),
            runJob: async (job: { jobType: string }) => {
              S.driverJobs.push(job.jobType);
              return { ok: true, status: "done", detail: {} };
            },
            abort: async () => undefined,
          },
        }
      : undefined,
}));
vi.mock("../interlock/interlockGate", () => ({ evaluateInterlockGate: async () => ({ blocked: false, failClosed: false, violations: [] }) }));
vi.mock("../ot/adapterFacade", () => ({ createAdapterFacade: () => ({ getSafetyStatus: async () => ({ state: "OK", source: "test", ts: "" }) }) }));

import { Ros2Bridge, ROS2_STOP_MESSAGE } from "./ros2Bridge";
import { dispatchRobotJob } from "../robot/robotCommandDispatcher";

function makeBridge() {
  const b = new Ros2Bridge({ url: "ws://127.0.0.1:1" });
  const published: Array<{ topic: string; type: string; msg: unknown }> = [];
  (b as unknown as { client: unknown }).client = {
    isConnected: () => true,
    publish: (topic: string, type: string, msg: unknown) => published.push({ topic, type, msg }),
    close: async () => undefined,
    getLastError: () => undefined,
  };
  return { bridge: b, published };
}

/** Thông điệp người gọi muốn lén đưa lên dây (chuyển động mạnh trên /cmd_vel). */
const EVIL = { topic: "/cmd_vel", type: "geometry_msgs/msg/Twist", msg: { linear: { x: 5, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 3 } } };
const GOAL = { topic: "/arm/goal", type: "std_msgs/msg/String", msg: { data: "pose-17" } };

const ENV_KEYS = ["ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED", "SEC_PLATFORM", "FIELD_V2_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
beforeEach(() => {
  S.rows.length = 0;
  S.seq = 1;
  S.driverJobs.length = 0;
  process.env.ROBOT_CONTROL_ENABLED = "true";
  process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
  delete process.env.SEC_PLATFORM;
  delete process.env.FIELD_V2_ENABLED;
});

const manualMove = (params: Record<string, unknown>) => ({ robotId: 7, job: { jobType: "move" as const, params }, triggerKind: "manual" as const, requestedBy: 3, confirmedBy: 3 });
const stop = { robotId: 7, job: { jobType: "abort" as const, params: {} }, triggerKind: "hitl" as const, requestedBy: 3 };

describe("R-1C-j — cầu ROS2: thông điệp chỉ từ job đã gắn, MỘT kênh", () => {
  it("★ chuyển động: phát ĐÚNG thông điệp trong job.params.ros2 (không phải publishSpec), ĐÚNG MỘT lần; driver.runJob KHÔNG chạy", async () => {
    const { bridge, published } = makeBridge();
    const r = await bridge.dispatchToRos2(manualMove({ ros2: GOAL }), EVIL);
    expect(r.dispatch.status).toBe("done");
    expect(r.published).toBe(true);
    expect(published).toEqual([GOAL]);
    expect(S.driverJobs).toEqual([]); // cầu và driver KHÔNG cùng điều khiển robot cho một job
    expect(S.rows[0]).toMatchObject({ jobType: "move", status: "done" });
  });

  it("chuyển động KHÔNG có job.params.ros2 ⇒ từ chối ROS2_JOB_MESSAGE_REQUIRED, 0 phát, 0 driver (publishSpec không thay được)", async () => {
    const { bridge, published } = makeBridge();
    const r = await bridge.dispatchToRos2(manualMove({ target: [1, 2, 3] }), EVIL);
    expect(r.dispatch).toMatchObject({ ok: false, status: "rejected", error: "ROS2_JOB_MESSAGE_REQUIRED" });
    expect(r.published).toBe(false);
    expect(published).toEqual([]);
    expect(S.driverJobs).toEqual([]);
  });

  it("★ STOP mang publishSpec chuyển động ⇒ driver nhận abort; cầu phát CHỈ thông điệp dừng cố định, không bao giờ publishSpec", async () => {
    const { bridge, published } = makeBridge();
    const r = await bridge.dispatchToRos2(stop, EVIL);
    expect(r.dispatch.status).toBe("done");
    expect(S.driverJobs).toEqual(["abort"]);
    expect(published).toEqual([ROS2_STOP_MESSAGE]);
    // Oracle độc lập với mã: thông điệp dừng = Twist toàn 0 (REP-103: vận tốc 0 ⇒ đứng yên).
    expect(ROS2_STOP_MESSAGE).toEqual({ topic: "/cmd_vel", type: "geometry_msgs/msg/Twist", msg: { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } } });
  });

  it("dry-run ⇒ không phát gì (chuyển động lẫn STOP)", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "false";
    const { bridge, published } = makeBridge();
    expect((await bridge.dispatchToRos2(manualMove({ ros2: GOAL }))).dispatch.status).toBe("simulated");
    expect((await bridge.dispatchToRos2(stop)).dispatch.status).toBe("simulated");
    expect(published).toEqual([]);
    expect(S.driverJobs).toEqual([]);
  });

  it("dispatcher: bộ chấp hành thay thế CHỈ dùng cho chuyển động — một STOP luôn tới driver", async () => {
    let actuatorCalls = 0;
    const r = await dispatchRobotJob(stop, { motionActuator: async () => ((actuatorCalls++), { ok: true, status: "done" }) });
    expect(r.status).toBe("done");
    expect(actuatorCalls).toBe(0);
    expect(S.driverJobs).toEqual(["abort"]);
  });
});
