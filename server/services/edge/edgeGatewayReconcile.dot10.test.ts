/**
 * doc 81 Đợt 10 task E fix review 1 (I-5) + fix review 2 (R-1 / R-2 / N-1 / N-2, R-10-ar) — the edge's devices follow its
 * VERIFIED config, not only the one at boot:
 *   • booted with central down and no cache ⇒ health `unconfigured` (never `online`), no device runs; the first config that
 *     arrives (heartbeat ⇒ newer version ⇒ refresh) STARTS the devices;
 *   • a robot that leaves the node is released ONLY when it was LOCKED locally AND its STOP (D's dispatch) succeeded — a failed
 *     STOP keeps it attached + locked, a TRUTHFUL alert, and the release is retried; a central STOP for it in the same pull runs
 *     FIRST (fast path, before the refresh);
 *   • an adapter that leaves the node gets its PINNED STOP (pins of the verified row it was started from) before its session
 *     closes — a failed STOP write keeps it attached + alert + retry; kept devices keep their sessions (one device at a time).
 * REAL gateway boot, robotManager (edge mode) + SIM robot driver WITH a motion lock, OT manager + stub adapter, D's dispatch;
 * no DB (EDGE_DB_TRAP=throw, 0 hits).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const k of Object.keys(process.env)) if (k === "DATABASE_URL" || k === "TEST_DATABASE_URL" || k.startsWith("PG")) delete process.env[k];
  process.env.EDGE_DB_TRAP = "throw";
});
vi.mock("../unsPublisher", () => ({
  isUnsPublisherConnected: () => false,
  initUnsPublisher: () => undefined,
  shutdownUnsPublisher: async () => undefined,
  publishNdeathGraceful: async () => undefined,
  publishNormalized: () => undefined,
  publishSparkplugDData: () => undefined,
}));

import "../../edge/edgeRole";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeCentral, KIT_TOKEN } from "./edgeFakeCentral.testkit";

const central = new FakeCentral(7, 31);
const B0 = central.makeConfig();
/** what the node owns at boot: robots 12 + 13, adapters 21 + 22 (22: a WRONG fingerprint ⇒ D's pinned STOP fails closed) */
const BOOT = {
  robots: [...B0.robots, { ...B0.robots[0], id: 13, code: "rb-13", endpoint: "sim://13" }],
  adapters: [...B0.adapters, { ...B0.adapters[0], id: 22, code: "plc-22", endpoint: "stub://plc-22", connectionFingerprint: "0".repeat(64), tags: B0.adapters[0].tags.map((t) => ({ ...t, id: t.id + 100 })) }],
};
central.setConfig(BOOT);
let dir = "";
const KEYS = ["EDGE_RECONCILE_RETRY_MS", "ROBOT_GATEWAY_ENABLED", "ROBOT_CONTROL_ENABLED", "OT_GATEWAY_ENABLED", "OT_CONTROL_ENABLED", "OT_CONN_HA_ENABLED", "EDGE_EXECUTION_ENABLED", "EDGE_CENTRAL_URL", "EDGE_NODE_CREDENTIAL_FILE", "EDGE_CENTRAL_NODE_ID", "EDGE_CENTRAL_CREDENTIAL_ID", "EDGE_KEYSET_PIN_FILE", "EDGE_JOURNAL_DIR", "EDGE_GATEWAY_LIVENESS_FILE", "EDGE_UNS_STORE_FORWARD_FILE", "OT_STORE_FORWARD_ENABLED", "OT_STORE_FORWARD_FILE"] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of KEYS) saved[k] = process.env[k];
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-reconcile-"));
  await fs.writeFile(path.join(dir, "node.cred"), KIT_TOKEN, { mode: 0o600 });
  await fs.writeFile(path.join(dir, "pin.json"), JSON.stringify(central.pin));
  Object.assign(process.env, {
    ROBOT_GATEWAY_ENABLED: "true",
    ROBOT_CONTROL_ENABLED: "true",
    OT_GATEWAY_ENABLED: "true",
    OT_CONTROL_ENABLED: "true",
    EDGE_RECONCILE_RETRY_MS: "300",
    EDGE_CENTRAL_URL: "http://central.test",
    EDGE_NODE_CREDENTIAL_FILE: path.join(dir, "node.cred"),
    EDGE_CENTRAL_NODE_ID: "7",
    EDGE_CENTRAL_CREDENTIAL_ID: "31",
    EDGE_KEYSET_PIN_FILE: path.join(dir, "pin.json"),
    EDGE_JOURNAL_DIR: path.join(dir, "journal"),
    EDGE_GATEWAY_LIVENESS_FILE: path.join(dir, "alive.json"),
    EDGE_UNS_STORE_FORWARD_FILE: path.join(dir, "uns.jsonl"),
  });
  delete process.env.EDGE_EXECUTION_ENABLED; // commands-only agent
  delete process.env.OT_CONN_HA_ENABLED;
  delete process.env.OT_STORE_FORWARD_ENABLED;
  delete process.env.OT_STORE_FORWARD_FILE;
});
afterAll(async () => {
  const { stopEdgeGateway, _resetForTests } = await import("./edgeGatewayRuntime");
  await stopEdgeGateway();
  _resetForTests();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("doc 81 Đợt 10 E fix reviews 1-3 — devices follow the verified config; release is fail-safe; one robot at a time", () => {
  it("★ no config ⇒ unconfigured; late config starts devices; release: lock + STOP first, a failed STOP keeps the device attached (truthful alert) and is retried; adapters get their pinned STOP", async () => {
    const { SimRobotDriver } = await import("../robot/drivers/simRobotDriver");
    const { StubDriver } = await import("../ot/drivers/stubDriver");
    const { MotionLock } = await import("../robot/robotDriver");
    type ML = InstanceType<typeof MotionLock>;
    (SimRobotDriver.prototype as unknown as { motionLockController: () => ML }).motionLockController = function (this: { _ml?: ML }) {
      return (this._ml ??= new MotionLock());
    };
    const order: string[] = [];
    let robotStopFails = false;
    vi.spyOn(SimRobotDriver.prototype, "runJob").mockImplementation(async (job: { jobType: string }) => {
      order.push(`robot:${job.jobType}${robotStopFails ? ":fail" : ""}`);
      return robotStopFails ? { ok: false, status: "failed" as const, error: "controller rejected" } : { ok: true, status: "done" as const };
    });
    let otStopFails = true;
    const writes = vi.spyOn(StubDriver.prototype, "writeTags").mockImplementation(async (w: Array<{ tagKey: string }>) => {
      order.push(`ot:${w.map((x) => x.tagKey).join(",")}${otStopFails ? ":fail" : ""}`);
      return w.map((x) => ({ tagKey: x.tagKey, ok: !otStopFails, status: otStopFails ? "failed" : "done" })) as never;
    });
    const rm = await import("../robot/robotManager");
    const om = await import("../ot/otManager");
    const gw = await import("./edgeGatewayRuntime");
    // F-2 — group D's per-robot attach / detach (a FAKE until D ships attachEdgeRobot / detachEdgeRobot): detach is the real
    // single-session close; attach records the call — robot 14 never connects
    const attaches: number[] = [];
    gw.setEdgeRobotLifecycle({
      attach: async (row) => {
        attaches.push(row.id);
        return row.id !== 14;
      },
      detach: (id) => rm.detachRobot(id),
    });
    const conn = await import("../../db/connection");
    const alerts = async () => {
      await rt.journal.flush();
      await rt.shipper.flushAll();
      return central.received.locksEvents.filter((r) => r.kind === "anomaly" && String(r.code).startsWith("EDGE_DEVICE_RELEASE")).map((r) => `${r.code}: ${r.detail}`);
    };

    central.down = true;
    const handles = await gw.bootstrapEdgeGateway({ fetchImpl: central.fetchImpl });
    const rt = handles.runtime!;
    expect(rt.config.current()).toBeNull();
    expect((await gw.getEdgeGatewayHealth()).status).toBe("unconfigured");
    expect(rm.activeRobotIds()).toEqual([]);

    // central comes back: the heartbeat sees a config version ⇒ refresh ⇒ the devices start
    central.down = false;
    await gw.sendHeartbeat();
    await vi.waitFor(() => expect(rm.activeRobotIds().sort()).toEqual([12, 13]), { timeout: 5_000, interval: 20 });
    await vi.waitFor(() => expect(om.getActiveDriver(21)).toBeDefined(), { timeout: 5_000, interval: 20 });
    await vi.waitFor(() => expect(om.getActiveDriver(22)).toBeDefined(), { timeout: 5_000, interval: 20 });
    const robot13 = rm.getActiveRobot(13)!; // the HEALTHY robot: its session must never be cycled below
    expect((await gw.getEdgeGatewayHealth()).status).not.toBe("unconfigured");
    const robot12 = rm.getActiveRobot(12)!;

    // ── ownership change: robot 12 AND adapter 21 leave; the SAME pull carries a central STOP for robot 12; the robot's
    //    release STOP fails at first, the adapter's pinned STOP write fails at first
    const base = BOOT;
    central.setConfig({ robots: base.robots.filter((r) => r.id === 13), adapters: [] });
    central.commands = [central.sign("cmd", central.commandPayload({ requestId: 140, kind: "stop", target: { robotId: 12 } }))];
    const agent = (await import("./edgeExecutionAgent")).currentEdgeExecutionAgent()!;
    order.length = 0;
    order.push("tick");
    robotStopFails = false;
    const firstTick = agent.tick();
    await vi.waitFor(() => expect(order).toContain("robot:abort"), { timeout: 5_000, interval: 5 });
    robotStopFails = true; // the command STOP went; the release STOP that follows the refresh fails
    await firstTick;
    await gw.reconcileDevices(rt, "test barrier");
    expect(order.slice(0, 2)).toEqual(["tick", "robot:abort"]); // the central STOP ran FIRST (fast path)
    expect(order).toContain("robot:abort:fail");
    expect(order).toContain("ot:run:fail");
    // nothing released: both kept attached, the robot LOCKED locally
    expect(rm.activeRobotIds().sort()).toEqual([12, 13]);
    expect(om.getActiveDriver(21)).toBeDefined();
    expect(om.getActiveDriver(22)).toBeDefined();
    expect(robot12.driver.motionLockController!().isLocked()).toBe(true); // locked (still persistUnknown from the fresh journal, or ownershipRemoved)
    const failed = await alerts();
    expect(failed.some((a) => a.startsWith("EDGE_DEVICE_RELEASE_FAILED: robot 12") && /KEPT attached and locked/.test(a) && /STOP FAILED/.test(a))).toBe(true);
    expect(failed.some((a) => a.startsWith("EDGE_DEVICE_RELEASE_FAILED: adapter 21") && /KEPT attached/.test(a) && /pinned STOP NOT sent \/ FAILED/.test(a))).toBe(true);
    // F-4 — adapter 22's running connection is not its verified row's: D's pipeline refuses the pinned STOP (fail-closed), no write
    expect(failed.some((a) => a.startsWith("EDGE_DEVICE_RELEASE_FAILED: adapter 22") && /adapter_connection_stale|not a verified pinned|STOP NOT sent/.test(a))).toBe(true);
    expect(order.filter((o) => o.startsWith("ot:")).every((o) => o.startsWith("ot:run"))).toBe(true);
    expect(failed.some((a) => a.startsWith("EDGE_DEVICE_RELEASED"))).toBe(false); // never a false "released"

    // the STOP now succeeds but the robot can NOT be locked locally (a lock-less driver) ⇒ still kept, alert says why
    robotStopFails = false;
    const ctrl = robot12.driver.motionLockController;
    (robot12.driver as { motionLockController?: unknown }).motionLockController = undefined;
    await gw.reconcileDevices(rt, "no lock");
    expect(rm.activeRobotIds().sort()).toEqual([12, 13]);
    expect((await alerts()).some((a) => /^EDGE_DEVICE_RELEASE_FAILED: robot 12 .*KEPT attached: NOT locked: the driver has no motion lock; STOP done/.test(a))).toBe(true);
    (robot12.driver as { motionLockController?: unknown }).motionLockController = ctrl;
    // the cause is fixed ⇒ the RETRY TIMER (N-2, EDGE_RECONCILE_RETRY_MS) releases both, each after a successful STOP
    otStopFails = false;
    await vi.waitFor(() => expect(rm.activeRobotIds()).toEqual([13]), { timeout: 5_000, interval: 50 });
    await vi.waitFor(() => expect(om.getActiveDriver(21)).toBeUndefined(), { timeout: 5_000, interval: 50 });
    expect(om.getActiveDriver(22)).toBeDefined(); // the stale-connection adapter stays attached (fail-closed)
    const after = await alerts();
    expect(after.some((a) => /^EDGE_DEVICE_RELEASED: robot 12 .*locked \(generation \d+\), STOP done, session closed/.test(a))).toBe(true);
    expect(after.some((a) => /^EDGE_DEVICE_RELEASED: adapter 21 .*pinned STOP \w+ \(run\), session closed/.test(a))).toBe(true);
    expect(writes).toHaveBeenCalled();
    expect(central.received.locksEvents.filter((r) => r.kind === "command_ack" && r.requestId === 140).map((r) => r.outcome)).toEqual(["done"]);

    // ── F-2: robot 12 comes back and robot 14 is added (it never connects) — each through the per-robot attach; the healthy
    //    robot 13 keeps its session the whole time (no gateway restart, no cycling), robot 14 is retried with a back-off
    // adapter 21 comes back too: its first attach FAILS ⇒ not recorded, retried (fix review 3)
    const otAttaches: number[] = [];
    gw.setEdgeOtLifecycle({
      attach: async (a) => {
        otAttaches.push(a.adapterId);
        return otAttaches.length > 1 ? om.attachOtAdapter(a) : false;
      },
      detach: (id) => om.detachOtAdapter(id),
    });
    central.setConfig({ robots: [...base.robots, { ...base.robots[0], id: 14, code: "rb-14", endpoint: "sim://14" }], adapters: base.adapters.filter((a) => a.id === 21) });
    await gw.sendHeartbeat();
    await gw.reconcileDevices(rt, "barrier");
    expect(attaches).toEqual(expect.arrayContaining([12, 14]));
    await vi.waitFor(() => expect(otAttaches.filter((id) => id === 21).length).toBeGreaterThanOrEqual(2), { timeout: 5_000, interval: 50 });
    await vi.waitFor(() => expect(om.getActiveDriver(21)).toBeDefined(), { timeout: 5_000, interval: 50 });
    gw.setEdgeOtLifecycle(null);
    expect(rm.getActiveRobot(13)).toBe(robot13);
    await new Promise((r) => setTimeout(r, 1_500)); // several retry windows (EDGE_RECONCILE_RETRY_MS=300, back-off doubling)
    const tries14 = attaches.filter((id) => id === 14).length;
    expect(tries14).toBeGreaterThan(1); // retried …
    expect(tries14).toBeLessThan(6); // … with a back-off, not every pass
    expect(attaches.filter((id) => id === 12)).toHaveLength(1); // the robot that attached is not touched again
    expect(rm.getActiveRobot(13)).toBe(robot13); // never cycled by the robot that cannot connect
    // a rename keeps a session (no attach / detach)
    const n = attaches.length;
    central.setConfig({ robots: base.robots.map((r) => ({ ...r, name: "renamed", updatedAt: 99 })), adapters: base.adapters.filter((a) => a.id === 21) });
    await gw.sendHeartbeat();
    await gw.reconcileDevices(rt, "barrier");
    expect(rm.getActiveRobot(13)).toBe(robot13);
    expect(attaches.slice(n).filter((id) => id !== 14)).toEqual([]);
    gw.setEdgeRobotLifecycle(null);

    expect(conn.edgeDbTrapCount()).toBe(0);
  }, 90_000);
});
