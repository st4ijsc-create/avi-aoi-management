/**
 * doc 81 Đợt 1C residual 1 — ruling R-1C-m, LỚP (b) driver VDA5050 và LỚP (c) adapter VDA5050.
 *
 * (b) `Vda5050RobotDriver.runJob` từng BỎ QUA jobType: một job `abort` mang `params.order` (hoặc x,y) bị phát lên topic
 *     `order` ⇒ AGV chạy. Nay: job dừng (abort / stop / e_stop) ⇒ CHỈ instantActions dựng phía server
 *     (cancelOrder rồi startPause — ngữ nghĩa dừng đã có ở M7), KHÔNG BAO GIỜ order, bất kể params. `abort()` dùng
 *     cùng đường (trước: RobotAbortUnsupportedError — AGV không dừng được qua nền tảng).
 * (c) `Vda5050Adapter.sendInstantActions` dừng: tin phát đi dựng phía server, không mang actions / actionParameters
 *     của người gọi.
 *
 * Oracle độc lập: client MQTT giả ghi từng (topic, payload) thật sự được phát; loại hành động kiểm theo tên trong
 * đặc tả VDA 5050 2.0 (cancelOrder / startPause), không lấy từ mã sản phẩm.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

type Row = Record<string, any>;
const S = vi.hoisted(() => ({ rows: [] as Record<string, any>[], seq: 1, driverJobs: [] as any[] }));

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
            runJob: async (job: any) => {
              S.driverJobs.push(structuredClone(job));
              return { ok: true, status: "done", detail: {} };
            },
            abort: async () => undefined,
          },
        }
      : undefined,
}));
vi.mock("../interlock/interlockGate", () => ({ evaluateInterlockGate: async () => ({ blocked: false, failClosed: false, violations: [] }) }));
vi.mock("../ot/adapterFacade", () => ({ createAdapterFacade: () => ({ getSafetyStatus: async () => ({ state: "OK", source: "t", ts: "" }) }) }));
vi.mock("../robot/robotAutomationAction", () => ({ ensureBoundRobotAction: async () => null }));

import { Vda5050RobotDriver } from "./vda5050Driver";
import { Vda5050Adapter } from "./vda5050Adapter";

type Pub = { topic: string; payload: any };
function fakeClient(pub: Pub[]) {
  return {
    on: () => undefined,
    subscribe: () => undefined,
    publish: (topic: string, payload: string, _o: unknown, cb?: (e?: Error | null) => void) => {
      pub.push({ topic, payload: JSON.parse(payload) });
      cb?.(null);
    },
    end: (_f?: boolean, _o?: unknown, cb?: () => void) => cb?.(),
    connected: true,
  };
}
function connectedDriver() {
  const d = new Vda5050RobotDriver();
  const pub: Pub[] = [];
  Object.assign(d as unknown as Record<string, unknown>, { client: fakeClient(pub), connected: true, manufacturer: "acme", serialNumber: "sn7", interfaceName: "uagv" });
  return { d, pub };
}
const orders = (p: Pub[]) => p.filter((x) => /\/order$/.test(x.topic));
const instant = (p: Pub[]) => p.filter((x) => /\/instantActions$/.test(x.topic));
const EVIL = { order: { orderId: "evil", nodes: [{ nodeId: "far", sequenceId: 0, released: true, nodePosition: { x: 99, y: 99, mapId: "m" }, actions: [] }], edges: [] }, x: 50, y: 50, mapId: "m" };

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

describe("R-1C-m lớp (b) — Vda5050RobotDriver: job dừng ⇒ CHỈ instantActions dựng phía server, không bao giờ order", () => {
  it.each(["abort", "stop", "e_stop"])("★ runJob({ jobType: '%s', params: {order, x, y} }) ⇒ 0 order, 1 instantActions [cancelOrder, startPause]", async (jt) => {
    const { d, pub } = connectedDriver();
    const r = await d.runJob({ jobType: jt as never, params: EVIL });
    expect(r.ok).toBe(true);
    expect(orders(pub)).toHaveLength(0);
    expect(instant(pub)).toHaveLength(1);
    const msg = instant(pub)[0].payload;
    expect(msg.actions.map((a: any) => a.actionType)).toEqual(["cancelOrder", "startPause"]);
    expect(msg.manufacturer).toBe("acme");
    expect(msg.serialNumber).toBe("sn7");
    expect(JSON.stringify(msg)).not.toMatch(/evil|far|99/);
    for (const a of msg.actions) expect(a.actionParameters ?? []).toEqual([]);
  });

  it("abort() ⇒ phát cùng tin dừng (trước: RobotAbortUnsupportedError); chưa kết nối ⇒ abort_failed, không im lặng", async () => {
    const { d, pub } = connectedDriver();
    await expect(d.abort()).resolves.toBeUndefined();
    expect(orders(pub)).toHaveLength(0);
    expect(instant(pub)).toHaveLength(1);
    const cold = new Vda5050RobotDriver();
    const err = await cold.abort().then(() => null, (e) => e);
    expect(err?.reasonCode).toBe("abort_failed");
  });

  it("chuyển động (move) vẫn phát order như cũ (không chặn oan)", async () => {
    const { d, pub } = connectedDriver();
    const r = await d.runJob({ jobType: "move", params: { x: 1, y: 2, mapId: "m" } });
    expect(r.ok).toBe(true);
    expect(orders(pub)).toHaveLength(1);
    expect(instant(pub)).toHaveLength(0);
  });
});

describe("R-1C-m lớp (c) — Vda5050Adapter.sendInstantActions dừng: tin dựng phía server", () => {
  function makeAgv() {
    const a = new Vda5050Adapter({ robotId: 7, code: "AGV-7", manufacturer: "acme", serialNumber: "sn7", interfaceName: "uagv", brokerUrl: "mqtt://127.0.0.1:1" });
    const pub: Pub[] = [];
    (a as unknown as { client: unknown }).client = fakeClient(pub);
    return { a, pub };
  }
  it("★ cancelOrder mang actionParameters + actionId của người gọi ⇒ phát tin CHUẨN [cancelOrder, startPause], không mang gì của người gọi; job tới dispatcher là abort chuẩn", async () => {
    const { a, pub } = makeAgv();
    const r = await a.sendInstantActions({
      actions: [{ actionId: "caller-EVIL-ID", actionType: "cancelOrder", blockingType: "NONE", actionParameters: [{ key: "resumeTo", value: "evil-node" }] } as any],
      requestedBy: 3,
    });
    expect(r.status).toBe("done");
    expect(orders(pub)).toHaveLength(0);
    expect(instant(pub)).toHaveLength(1);
    const msg = instant(pub)[0].payload;
    expect(msg.actions.map((x: any) => x.actionType)).toEqual(["cancelOrder", "startPause"]);
    expect(JSON.stringify(msg)).not.toMatch(/caller-EVIL-ID|evil-node|resumeTo/);
    expect(S.driverJobs).toEqual([{ jobType: "abort", params: {} }]);
  });
});
