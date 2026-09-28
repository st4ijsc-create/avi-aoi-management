/**
 * doc 81 Đợt 1C final wave 5 (final review M7) — instantActions DỪNG của VDA 5050 là KHÔNG chuyển động.
 *
 * Trước bản vá: `sendInstantActions` gói MỌI instant action thành job `custom` (= chuyển động) ⇒ một cancelOrder
 * (dừng AGV) bị SAFETY_SIM_ONLY / PLC không đọc được / BLOCKED / interlock / khoá chuyển động chặn — đúng những lúc
 * cần dừng. Sau: tin chỉ gồm hành động GIẢM năng lượng theo VDA 5050 2.0 — `cancelOrder` (huỷ lệnh, AGV dừng) và
 * `startPause` (bật chế độ tạm dừng: không di chuyển nữa) — đi như job `abort` (miễn các cổng chuyển động).
 * `stopPause` KẾT THÚC tạm dừng (AGV chạy lại) ⇒ vẫn là chuyển động, vẫn bị chặn; tin trộn ⇒ chuyển động.
 *
 * Môi trường THÙ ĐỊCH: safety BLOCKED, interlock vi phạm, driver khoá chuyển động. Oracle độc lập: driver giả ghi
 * jobType nhận; client MQTT giả ghi (topic, payload) thật sự được phát.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

type Row = Record<string, any>;
const S = vi.hoisted(() => ({ rows: [] as Record<string, any>[], seq: 1, driverJobs: [] as string[], safetyReads: 0, interlockEvals: 0 }));

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
            vendor: "vda5050",
            isConnected: () => true,
            getMotionLock: () => ({ locked: true, since: "2026-09-28T00:00:00Z", reasonCode: "motion_locked_after_link_loss" }),
            runJob: async (job: { jobType: string }) => {
              S.driverJobs.push(job.jobType);
              return { ok: true, status: "done", detail: {} };
            },
            abort: async () => undefined,
          },
        }
      : undefined,
}));
vi.mock("../interlock/interlockGate", () => ({
  evaluateInterlockGate: async () => {
    S.interlockEvals++;
    return { blocked: true, failClosed: false, violations: [{ ruleId: 1, action: "block" }] };
  },
}));
vi.mock("../ot/adapterFacade", () => ({
  createAdapterFacade: () => ({
    getSafetyStatus: async () => {
      S.safetyReads++;
      return { state: "BLOCKED", source: "safety_plc:SPLC-1", ts: "" };
    },
  }),
}));
// Chuyển động 'hitl' cần bản ghi gắn — không cấp ⇒ chuyển động bị từ chối dù sao. STOP không được cần bản ghi.
vi.mock("../robot/robotAutomationAction", () => ({ ensureBoundRobotAction: async () => null }));

import { Vda5050Adapter, isVda5050StopInstantActions } from "./vda5050Adapter";

function makeAgv() {
  const a = new Vda5050Adapter({ robotId: 7, code: "AGV-7", manufacturer: "acme", serialNumber: "sn7", interfaceName: "uagv", brokerUrl: "mqtt://127.0.0.1:1" });
  const published: Array<{ topic: string; payload: any }> = [];
  (a as unknown as { client: unknown }).client = {
    on: () => undefined,
    subscribe: () => undefined,
    publish: (topic: string, payload: string, _o: unknown, cb?: (e?: Error | null) => void) => {
      published.push({ topic, payload: JSON.parse(payload) });
      cb?.(null);
    },
    end: (_f?: boolean, _o?: unknown, cb?: () => void) => cb?.(),
    connected: true,
  };
  return { adapter: a, published };
}
const act = (actionType: string, id = actionType) => ({ actionId: id, actionType, blockingType: "HARD" }) as any;

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
  S.safetyReads = 0;
  S.interlockEvals = 0;
  process.env.ROBOT_CONTROL_ENABLED = "true";
  process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
  delete process.env.SEC_PLATFORM;
  delete process.env.FIELD_V2_ENABLED;
});

describe("M7 — VDA 5050 instantActions dừng = không chuyển động (không chịu cổng chuyển động)", () => {
  it.each(["cancelOrder", "startPause"])("★ %s trong môi trường thù địch ⇒ job abort tới driver, được PHÁT lên instantActions; safety/interlock không được hỏi", async (type) => {
    const { adapter, published } = makeAgv();
    const r = await adapter.sendInstantActions({ actions: [act(type)], requestedBy: 3 });
    expect(r.status).toBe("done");
    expect(r.published).toBe(true);
    expect(S.driverJobs).toEqual(["abort"]);
    expect(S.safetyReads).toBe(0);
    expect(S.interlockEvals).toBe(0);
    expect(published).toHaveLength(1);
    expect(published[0].topic).toMatch(/\/instantActions$/);
    // residual 1 (R-1C-m, lớp c): tin dừng nay dựng PHÍA SERVER — luôn [cancelOrder, startPause], không lấy của người gọi.
    expect(published[0].payload.actions.map((a: any) => a.actionType)).toEqual(["cancelOrder", "startPause"]);
    expect(S.rows[0]).toMatchObject({ jobType: "abort", status: "done" });
  });

  it("stopPause (KẾT THÚC tạm dừng ⇒ AGV chạy lại) vẫn là chuyển động ⇒ bị từ chối, 0 phát", async () => {
    const { adapter, published } = makeAgv();
    const r = await adapter.sendInstantActions({ actions: [act("stopPause")], requestedBy: 3, confirmedBy: 3 });
    expect(r.status).toBe("rejected");
    expect(published).toHaveLength(0);
    expect(S.driverJobs).toEqual([]);
  });

  it("tin TRỘN (cancelOrder + stopPause) ⇒ chuyển động (không được lách qua miễn trừ), bị từ chối", async () => {
    const { adapter, published } = makeAgv();
    const r = await adapter.sendInstantActions({ actions: [act("cancelOrder", "a1"), act("stopPause", "a2")], requestedBy: 3, confirmedBy: 3 });
    expect(r.status).toBe("rejected");
    expect(published).toHaveLength(0);
  });

  it("phân loại thuần: chỉ tin toàn cancelOrder/startPause mới là dừng; rỗng không phải dừng", () => {
    expect(isVda5050StopInstantActions([act("cancelOrder"), act("startPause", "b")])).toBe(true);
    expect(isVda5050StopInstantActions([])).toBe(false);
    expect(isVda5050StopInstantActions([act("stopPause")])).toBe(false);
    expect(isVda5050StopInstantActions([act("initPosition")])).toBe(false);
  });

  it("dry-run ⇒ cancelOrder 'simulated', KHÔNG phát gì", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "false";
    const { adapter, published } = makeAgv();
    const r = await adapter.sendInstantActions({ actions: [act("cancelOrder")], requestedBy: 3 });
    expect(r.status).toBe("simulated");
    expect(published).toHaveLength(0);
  });
});
