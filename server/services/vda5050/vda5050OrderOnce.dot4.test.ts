/**
 * doc 81 Đợt 4 Task B1 — VDA 5050: MỘT lệnh order được gửi ĐÚNG MỘT LẦN.
 *
 * Trước bản vá: `Vda5050Adapter.sendOrder` gọi dispatcher ⇒ driver `vda5050` (đã qua mọi cổng) publish order lên
 * topic `…/order`, RỒI adapter publish THÊM một lần nữa khi status 'done' ⇒ AGV nhận hai order cùng orderId.
 * Sau: chỉ driver publish (một kênh), `published` của adapter lấy từ kết quả driver (`detail.published`).
 * Kênh STOP thứ hai ở `sendInstantActions` GIỮ NGUYÊN (giảm năng lượng) — có ca riêng dưới đây.
 *
 * Oracle ĐỘC LẬP với mã sản phẩm: broker aedes THẬT trong tiến trình (127.0.0.1, cổng 0) + một client mqtt.js
 * riêng đăng ký `#` và đếm gói nhận được trên từng topic. Driver `vda5050` THẬT nối vào broker này; dispatcher THẬT.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
// doc 81 Đợt 4 final wave R-4-x — this suite does not measure the motion "robot enabled" gate (robotEnabledGate.dot4.test.ts does).
vi.mock("../robot/robotEnabledGate", () => ({ readRobotEnabledForMotion: async () => true }));
import net from "node:net";
import Aedes from "aedes";
import mqtt, { type MqttClient } from "mqtt";

const H = vi.hoisted(() => ({ driver: null as unknown }));

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({
    insert: () => ({
      values: () => {
        const p: any = Promise.resolve();
        p.returning = () => Promise.resolve([{ id: 999 }]);
        return p;
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
  })),
}));
vi.mock("../robot/robotManager", () => ({
  getActiveRobot: vi.fn((id: number) => (id === 42 ? { id: 42, code: "ACME:AGV-001", driver: H.driver } : undefined)),
}));
vi.mock("../ot/adapterFacade", () => ({
  createAdapterFacade: () => ({ getSafetyStatus: async () => ({ state: "OK", source: "test", ts: "" }) }),
}));

import { Vda5050Adapter } from "./vda5050Adapter";
import { createVda5050Driver } from "./vda5050Driver";

const MF = "ACME";
const SN = "AGV-001";
let broker: InstanceType<typeof Aedes>;
let server: net.Server;
let url = "";
let spy: MqttClient;
const seen: Array<{ topic: string; payload: any }> = [];
const drv = createVda5050Driver();
let adapter: Vda5050Adapter;

function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (cond()) return resolve(true);
      if (Date.now() - t0 > ms) return resolve(false);
      setTimeout(tick, 10);
    };
    tick();
  });
}
/** Settle window: give any second (duplicate) publish time to arrive before counting. */
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ENV_KEYS = ["ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED", "SEC_PLATFORM"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

beforeAll(async () => {
  broker = new Aedes();
  server = net.createServer(broker.handle as unknown as (s: net.Socket) => void);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  url = `mqtt://127.0.0.1:${(server.address() as net.AddressInfo).port}`;

  spy = mqtt.connect(url, { clientId: "b1-spy", reconnectPeriod: 0 });
  await new Promise<void>((resolve, reject) => {
    spy.once("connect", () => spy.subscribe("#", { qos: 1 }, (err) => (err ? reject(err) : resolve())));
    spy.once("error", reject);
  });
  spy.on("message", (topic, payload) => seen.push({ topic, payload: JSON.parse(payload.toString()) }));

  await drv.connect({ endpoint: url, options: { manufacturer: MF, serialNumber: SN }, timeoutMs: 3000 });
  expect(drv.isConnected()).toBe(true);
  H.driver = drv;

  adapter = new Vda5050Adapter({ robotId: 42, code: "ACME:AGV-001", manufacturer: MF, serialNumber: SN, interfaceName: "uagv", brokerUrl: url });
  await adapter.start();
  const c = (adapter as unknown as { client: MqttClient }).client;
  expect(await waitFor(() => c.connected === true, 3000)).toBe(true);
});

afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await adapter?.stop();
  await drv.disconnect();
  await new Promise<void>((r) => spy.end(true, {}, () => r()));
  await new Promise<void>((r) => broker.close(() => r()));
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  seen.length = 0;
  process.env.ROBOT_CONTROL_ENABLED = "true";
  process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
  delete process.env.SEC_PLATFORM;
});

describe("B1 — VDA 5050 order is published exactly once", () => {
  it("control enabled: the broker receives ONE order; published comes from the driver", async () => {
    const res = await adapter.sendOrder({
      orderId: "ord-b1-once",
      nodes: [{ nodeId: "t", x: 1, y: 2, mapId: "m" }],
      triggerKind: "manual",
      requestedBy: 1,
      confirmedBy: 1,
    } as Parameters<Vda5050Adapter["sendOrder"]>[0]);
    expect(res.status).toBe("done");
    expect(res.published).toBe(true);
    expect(await waitFor(() => seen.some((m) => m.topic.endsWith("/order")), 3000)).toBe(true);
    await settle(400);
    const orders = seen.filter((m) => m.topic === `uagv/v2/${MF}/${SN}/order`);
    expect(orders).toHaveLength(1);
    expect(orders[0].payload.serialNumber).toBe(SN);
  });

  it("dry-run: nothing reaches the broker, published=false", async () => {
    delete process.env.ROBOT_CONTROL_ENABLED;
    const res = await adapter.sendOrder({
      nodes: [{ nodeId: "t", x: 1, y: 2, mapId: "m" }],
      triggerKind: "manual",
      requestedBy: 1,
      confirmedBy: 1,
    });
    expect(res.status).toBe("simulated");
    expect(res.published).toBe(false);
    await settle(300);
    expect(seen.filter((m) => m.topic.endsWith("/order"))).toHaveLength(0);
  });

  it("STOP instantActions keeps its second channel (driver + adapter = 2 stop messages, 0 orders)", async () => {
    const res = await adapter.sendInstantActions({
      actions: [{ actionId: "c", actionType: "cancelOrder", blockingType: "HARD" } as any],
      triggerKind: "manual",
      requestedBy: 1,
      confirmedBy: 1,
    });
    expect(res.status).toBe("done");
    expect(res.published).toBe(true);
    expect(await waitFor(() => seen.filter((m) => m.topic.endsWith("/instantActions")).length >= 2, 3000)).toBe(true);
    await settle(200);
    expect(seen.filter((m) => m.topic.endsWith("/instantActions"))).toHaveLength(2);
    expect(seen.filter((m) => m.topic.endsWith("/order"))).toHaveLength(0);
  });
});
