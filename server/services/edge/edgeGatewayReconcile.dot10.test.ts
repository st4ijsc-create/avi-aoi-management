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

describe("doc 81 Đợt 10 E fix reviews 1+2 — devices follow the verified config; release is fail-safe", () => {
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
    await vi.waitFor(() => expect(rm.activeRobotIds()).toEqual([12]), { timeout: 5_000, interval: 20 });
    await vi.waitFor(() => expect(om.getActiveDriver(21)).toBeDefined(), { timeout: 5_000, interval: 20 });
    expect((await gw.getEdgeGatewayHealth()).status).not.toBe("unconfigured");
    const robot12 = rm.getActiveRobot(12)!;

    // ── ownership change: robot 12 AND adapter 21 leave; the SAME pull carries a central STOP for robot 12; the robot's
    //    release STOP fails at first, the adapter's pinned STOP write fails at first
    const base = central.makeConfig();
    central.setConfig({ robots: [], adapters: [] });
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
    expect(rm.activeRobotIds()).toEqual([12]);
    expect(om.getActiveDriver(21)).toBeDefined();
    expect(robot12.driver.motionLockController!().isLocked()).toBe(true); // locked (still persistUnknown from the fresh journal, or ownershipRemoved)
    const failed = await alerts();
    expect(failed.some((a) => a.startsWith("EDGE_DEVICE_RELEASE_FAILED: robot 12") && /KEPT attached and locked/.test(a) && /STOP FAILED/.test(a))).toBe(true);
    expect(failed.some((a) => a.startsWith("EDGE_DEVICE_RELEASE_FAILED: adapter 21") && /KEPT attached/.test(a) && /pinned STOP FAILED/.test(a))).toBe(true);
    expect(failed.some((a) => a.startsWith("EDGE_DEVICE_RELEASED"))).toBe(false); // never a false "released"

    // the STOP now succeeds but the robot can NOT be locked locally (a lock-less driver) ⇒ still kept, alert says why
    robotStopFails = false;
    const ctrl = robot12.driver.motionLockController;
    (robot12.driver as { motionLockController?: unknown }).motionLockController = undefined;
    await gw.reconcileDevices(rt, "no lock");
    expect(rm.activeRobotIds()).toEqual([12]);
    expect((await alerts()).some((a) => /^EDGE_DEVICE_RELEASE_FAILED: robot 12 .*KEPT attached: NOT locked: the driver has no motion lock; STOP done/.test(a))).toBe(true);
    (robot12.driver as { motionLockController?: unknown }).motionLockController = ctrl;
    // the cause is fixed ⇒ the RETRY TIMER (N-2, EDGE_RECONCILE_RETRY_MS) releases both, each after a successful STOP
    otStopFails = false;
    await vi.waitFor(() => expect(rm.activeRobotIds()).toEqual([]), { timeout: 5_000, interval: 50 });
    await vi.waitFor(() => expect(om.getActiveDriver(21)).toBeUndefined(), { timeout: 5_000, interval: 50 });
    const after = await alerts();
    expect(after.some((a) => /^EDGE_DEVICE_RELEASED: robot 12 .*locked \(generation \d+\), STOP done, session closed/.test(a))).toBe(true);
    expect(after.some((a) => /^EDGE_DEVICE_RELEASED: adapter 21 .*pinned STOP sent \(run\), session closed/.test(a))).toBe(true);
    expect(writes).toHaveBeenCalled();
    expect(central.received.locksEvents.filter((r) => r.kind === "command_ack" && r.requestId === 140).map((r) => r.outcome)).toEqual(["done"]);

    // ── N-1: the robot comes back alone — a new session for it; an adapter edit restarts only that adapter
    central.setConfig({ robots: base.robots, adapters: base.adapters });
    await gw.sendHeartbeat();
    await gw.reconcileDevices(rt, "barrier");
    expect(rm.activeRobotIds()).toEqual([12]);
    expect(om.getActiveDriver(21)).toBeDefined();
    const robotSession = rm.getActiveRobot(12);
    central.setConfig({ robots: base.robots.map((r) => ({ ...r, name: "renamed", updatedAt: 99 })), adapters: base.adapters });
    await gw.sendHeartbeat();
    await gw.reconcileDevices(rt, "barrier");
    expect(rm.getActiveRobot(12)).toBe(robotSession); // a rename keeps the session (no restart on updatedAt alone)

    expect(conn.edgeDbTrapCount()).toBe(0);
  }, 90_000);
});
