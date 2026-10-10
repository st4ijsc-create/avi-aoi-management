/**
 * doc 81 Đợt 4 — B1 non-regression proof (controller request after the B3 alert-only rework).
 *
 * B1 removed the adapter's SECOND order publish. This file pins, on a REAL in-process aedes broker (127.0.0.1, port 0)
 * with the REAL `vda5050` driver and the REAL dispatcher, what reaches the broker for every adapter entry point. The same
 * file was run against the pre-B1 code (vda5050Adapter.ts + robotCommandDispatcher.ts of 0d3a8b316~1) — see the
 * report: every STOP / instantActions row is identical before and after B1; only `sendOrder` changed (2 orders ⇒ 1).
 *
 * Pre-existing open item (NOT caused by B1): a MOTION instantActions message (e.g. stopPause) dispatched through the real
 * `vda5050` driver fails — the driver's runJob only builds ORDERS ("job has no usable nodes/x,y"), and the adapter only
 * publishes a motion message when the dispatcher reports 'done'. Before B1 it failed identically (sendInstantActions was
 * not touched by B1). Pinned below so a future fix is a visible change.
 * Oracle: a separate mqtt.js client subscribed to `#` counts messages per topic.
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
let spy: MqttClient;
const seen: Array<{ topic: string; payload: any }> = [];
const drv = createVda5050Driver();
let adapter: Vda5050Adapter;
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
const count = (suffix: string) => seen.filter((m) => m.topic === `uagv/v2/${MF}/${SN}/${suffix}`).length;
const act = (actionType: string) => ({ actionId: actionType, actionType, blockingType: "HARD" }) as any;

const ENV_KEYS = ["ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED", "SEC_PLATFORM"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

beforeAll(async () => {
  broker = new Aedes();
  server = net.createServer(broker.handle as unknown as (s: net.Socket) => void);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `mqtt://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  spy = mqtt.connect(url, { clientId: "b1-regr-spy", reconnectPeriod: 0 });
  await new Promise<void>((resolve, reject) => {
    spy.once("connect", () => spy.subscribe("#", { qos: 1 }, (err) => (err ? reject(err) : resolve())));
    spy.once("error", reject);
  });
  spy.on("message", (topic, payload) => seen.push({ topic, payload: JSON.parse(payload.toString()) }));
  await drv.connect({ endpoint: url, options: { manufacturer: MF, serialNumber: SN }, timeoutMs: 3000 });
  H.driver = drv;
  adapter = new Vda5050Adapter({ robotId: 42, code: "ACME:AGV-001", manufacturer: MF, serialNumber: SN, interfaceName: "uagv", brokerUrl: url });
  await adapter.start();
  const c = (adapter as unknown as { client: MqttClient }).client;
  const t0 = Date.now();
  while (!c.connected && Date.now() - t0 < 3000) await settle(10);
  expect(c.connected).toBe(true);
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

const manual = { triggerKind: "manual" as const, requestedBy: 1, confirmedBy: 1 };

describe("B1 non-regression — what reaches the broker (real driver, real dispatcher)", () => {
  it("STOP cancelOrder: driver + adapter second channel = 2 instantActions, 0 orders (same as before B1)", async () => {
    const r = await adapter.sendInstantActions({ actions: [act("cancelOrder")], ...manual });
    expect(r).toMatchObject({ status: "done", published: true });
    await settle(400);
    expect([count("instantActions"), count("order")]).toEqual([2, 0]);
    expect(seen.every((m) => m.payload.actions?.map((a: any) => a.actionType).join() === "cancelOrder,startPause")).toBe(true);
  });

  it("STOP startPause: 2 instantActions (server-built cancelOrder+startPause), 0 orders (same as before B1)", async () => {
    const r = await adapter.sendInstantActions({ actions: [act("startPause")], ...manual });
    expect(r).toMatchObject({ status: "done", published: true });
    await settle(400);
    expect([count("instantActions"), count("order")]).toEqual([2, 0]);
  });

  it("STOP in dry-run: 0 messages (same as before B1)", async () => {
    delete process.env.ROBOT_CONTROL_ENABLED;
    const r = await adapter.sendInstantActions({ actions: [act("cancelOrder")], ...manual });
    expect(r).toMatchObject({ status: "simulated", published: false });
    await settle(300);
    expect(seen).toHaveLength(0);
  });

  it("PRE-EXISTING open item: MOTION instantActions (stopPause) through the real driver fails — 0 messages (same before B1)", async () => {
    const r = await adapter.sendInstantActions({ actions: [act("stopPause")], ...manual });
    expect(r.status).toBe("failed");
    expect(r.published).toBe(false);
    expect(String(r.error)).toMatch(/no usable nodes/);
    await settle(300);
    expect(seen).toHaveLength(0);
  });

  it("sendOrder: exactly ONE order (before B1: two) — the only behaviour B1 changed", async () => {
    const r = await adapter.sendOrder({ orderId: "ord-b1-regr", nodes: [{ nodeId: "t", x: 1, y: 2, mapId: "m" }], ...manual });
    expect(r.status).toBe("done");
    await settle(400);
    expect([count("order"), count("instantActions")]).toEqual([1, 0]);
  });
});
