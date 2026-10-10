/**
 * doc 81 Đợt 5 task F fix 1 (review Minor 4) — a MOTION instantActions message (stopPause = resume) through the REAL
 * dispatcher and the REAL `vda5050` driver on an in-process aedes broker (127.0.0.1, port 0) is refused by the motion
 * gates — no gate is mocked here:
 *   • MOTION_LOCKED: the robot's driver reports a locked MotionLock (the real MotionLock class) ⇒ refused, 0 messages;
 *   • ROBOT_DISABLED (R-4-x): the REAL robotEnabledGate reads `robots.isEnabled` = false (or no row) ⇒ refused, 0 messages.
 * L-7 control: in both states a STOP (cancelOrder) still reaches the broker (driver + the adapter's second channel).
 * Only the DB (a fake answering the robots row) and the active-robot registry are stand-ins.
 * Oracle: a separate mqtt.js client subscribed to `#` counts messages per topic. Waits are bounded explicitly.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import net from "node:net";
import Aedes from "aedes";
import mqtt, { type MqttClient } from "mqtt";

const H = vi.hoisted(() => ({ entry: null as unknown, robotRow: [] as Array<{ isEnabled: boolean }> }));
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
    // the robots row read by the REAL robotEnabledGate (and any other select: same answer)
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(H.robotRow) }) }) }),
  })),
}));
vi.mock("../robot/robotManager", () => ({
  getActiveRobot: vi.fn((id: number) => (id === 42 ? H.entry : undefined)),
}));
vi.mock("../ot/adapterFacade", () => ({
  createAdapterFacade: () => ({ getSafetyStatus: async () => ({ state: "OK", source: "test", ts: "" }) }),
}));

import { Vda5050Adapter } from "./vda5050Adapter";
import { createVda5050Driver } from "./vda5050Driver";
import { MotionLock } from "../robot/robotDriver";

const MF = "ACME";
const SN = "AGV-G5";
let broker: InstanceType<typeof Aedes>;
let server: net.Server;
let spy: MqttClient;
const seen: Array<{ topic: string }> = [];
const drv = createVda5050Driver();
const lock = new MotionLock();
let adapter: Vda5050Adapter;
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
const count = (suffix: string) => seen.filter((m) => m.topic === `uagv/v2/${MF}/${SN}/${suffix}`).length;
const act = (actionType: string) => ({ actionId: actionType, actionType, blockingType: "HARD" }) as any;
const manual = { triggerKind: "manual" as const, requestedBy: 1, confirmedBy: 1 };

const ENV_KEYS = ["ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED", "SEC_PLATFORM"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

beforeAll(async () => {
  broker = new Aedes();
  server = net.createServer(broker.handle as unknown as (s: net.Socket) => void);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `mqtt://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  spy = mqtt.connect(url, { clientId: "g5-gates-spy", reconnectPeriod: 0 });
  await new Promise<void>((resolve, reject) => {
    spy.once("connect", () => spy.subscribe("#", { qos: 1 }, (err) => (err ? reject(err) : resolve())));
    spy.once("error", reject);
  });
  spy.on("message", (topic) => seen.push({ topic }));
  await drv.connect({ endpoint: url, options: { manufacturer: MF, serialNumber: SN }, timeoutMs: 3000 });
  // The REAL vda5050 driver, plus the REAL MotionLock reported through the driver's getMotionLock seam.
  const driver = Object.assign(Object.create(drv) as object, { getMotionLock: () => lock.snapshot() });
  H.entry = { id: 42, code: `${MF}:${SN}`, driver };
  adapter = new Vda5050Adapter({ robotId: 42, code: `${MF}:${SN}`, manufacturer: MF, serialNumber: SN, interfaceName: "uagv", brokerUrl: url });
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
  lock.clearByStop();
  H.robotRow = [{ isEnabled: true }];
  process.env.ROBOT_CONTROL_ENABLED = "true";
  process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
  delete process.env.SEC_PLATFORM;
});

describe("Đợt 5 F fix 1 — motion instantActions through the real dispatcher + real driver: gates refuse, STOP still goes", () => {
  it("control: enabled + unlocked ⇒ the motion message is published once", async () => {
    const r = await adapter.sendInstantActions({ actions: [act("stopPause")], ...manual });
    expect(r).toMatchObject({ status: "done", published: true });
    await settle(300);
    expect(count("instantActions")).toBe(1);
  });

  it("★ MOTION_LOCKED ⇒ refused before any driver call, 0 messages; a STOP still reaches the broker (L-7)", async () => {
    lock.lock("link_lost", "test");
    expect(lock.snapshot().locked).toBe(true);
    const r = await adapter.sendInstantActions({ actions: [act("stopPause")], ...manual });
    expect(r).toMatchObject({ status: "rejected", published: false, error: "MOTION_LOCKED" });
    await settle(300);
    expect(seen).toHaveLength(0);
    const s = await adapter.sendInstantActions({ actions: [act("cancelOrder")], ...manual });
    expect(s).toMatchObject({ status: "done", published: true });
    await settle(400);
    expect([count("instantActions"), count("order")]).toEqual([2, 0]);
  });

  it.each([
    ["robots.isEnabled = false", [{ isEnabled: false }]],
    ["no robots row", []],
  ])("★ ROBOT_DISABLED (%s, real robotEnabledGate) ⇒ refused, 0 messages; a STOP still reaches the broker (L-7)", async (_n, row) => {
    H.robotRow = row as Array<{ isEnabled: boolean }>;
    const r = await adapter.sendInstantActions({ actions: [act("stopPause")], ...manual });
    expect(r).toMatchObject({ status: "rejected", published: false, error: "ROBOT_DISABLED" });
    await settle(300);
    expect(seen).toHaveLength(0);
    const s = await adapter.sendInstantActions({ actions: [act("cancelOrder")], ...manual });
    expect(s).toMatchObject({ status: "done", published: true });
    await settle(400);
    expect([count("instantActions"), count("order")]).toEqual([2, 0]);
  });
});
