/**
 * doc 81 Đợt 10 task E fix review 1 (I-5 / R-10-ag) — the edge's devices follow its VERIFIED config, not only the one at boot:
 *   • booted with central down and no cache ⇒ health `unconfigured` (never `online`), no device runs; the first config that
 *     arrives (heartbeat ⇒ newer version ⇒ refresh) STARTS the devices;
 *   • a robot that leaves the node (ownership change) is LOCKED locally, STOPPED through D's edge dispatch, then its session is
 *     closed — never left moving; a central STOP for it in the same pull runs FIRST (fast path, before the refresh).
 * REAL gateway boot, robotManager (edge mode) + SIM robot driver, D's dispatch; no DB (EDGE_DB_TRAP=throw, 0 hits).
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
const KEYS = ["ROBOT_GATEWAY_ENABLED", "ROBOT_CONTROL_ENABLED", "OT_GATEWAY_ENABLED", "EDGE_EXECUTION_ENABLED", "EDGE_CENTRAL_URL", "EDGE_NODE_CREDENTIAL_FILE", "EDGE_CENTRAL_NODE_ID", "EDGE_CENTRAL_CREDENTIAL_ID", "EDGE_KEYSET_PIN_FILE", "EDGE_JOURNAL_DIR", "EDGE_GATEWAY_LIVENESS_FILE", "EDGE_UNS_STORE_FORWARD_FILE", "OT_STORE_FORWARD_ENABLED", "OT_STORE_FORWARD_FILE"] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of KEYS) saved[k] = process.env[k];
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-reconcile-"));
  await fs.writeFile(path.join(dir, "node.cred"), KIT_TOKEN, { mode: 0o600 });
  await fs.writeFile(path.join(dir, "pin.json"), JSON.stringify(central.pin));
  Object.assign(process.env, {
    ROBOT_GATEWAY_ENABLED: "true",
    ROBOT_CONTROL_ENABLED: "true",
    OT_GATEWAY_ENABLED: "false",
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

describe("doc 81 Đợt 10 E fix review 1 — devices follow the verified config", () => {
  it("★ no config at boot ⇒ unconfigured, nothing runs; the first config starts the robots; a removed robot is locked, STOPPED, released — a STOP for it in the same pull runs first", async () => {
    const { SimRobotDriver } = await import("../robot/drivers/simRobotDriver");
    const runJob = vi.spyOn(SimRobotDriver.prototype, "runJob");
    const order: string[] = [];
    runJob.mockImplementation(async function (this: unknown, job: { jobType: string }) {
      order.push(`robot:${job.jobType}`);
      return { ok: true, status: "done" as const };
    });
    const rm = await import("../robot/robotManager");
    const gw = await import("./edgeGatewayRuntime");
    const conn = await import("../../db/connection");

    central.down = true;
    const handles = await gw.bootstrapEdgeGateway({ fetchImpl: central.fetchImpl });
    expect(handles.runtime).not.toBeNull();
    expect(handles.runtime!.config.current()).toBeNull();
    expect((await gw.getEdgeGatewayHealth()).status).toBe("unconfigured");
    expect(rm.activeRobotIds()).toEqual([]);

    // central comes back: the heartbeat sees a config version ⇒ refresh ⇒ the devices start
    central.down = false;
    await gw.sendHeartbeat();
    await vi.waitFor(() => expect(rm.activeRobotIds()).toEqual([12]), { timeout: 5_000, interval: 20 });
    expect((await gw.getEdgeGatewayHealth()).status).not.toBe("unconfigured");

    // ownership change: robot 12 leaves this node; the SAME pull carries a central STOP for it
    central.setConfig({ robots: [] });
    central.commands = [central.sign("cmd", central.commandPayload({ requestId: 140, kind: "stop", target: { robotId: 12 } }))];
    const { currentEdgeExecutionAgent } = await import("./edgeExecutionAgent");
    const agent = currentEdgeExecutionAgent()!;
    order.push("tick");
    await agent.tick();
    await vi.waitFor(() => expect(rm.activeRobotIds()).toEqual([]), { timeout: 5_000, interval: 20 });
    // the command STOP (fast path) first, then the release STOP, then the session is gone
    expect(order).toEqual(["tick", "robot:abort", "robot:abort"]);
    await handles.runtime!.journal.flush();
    await handles.runtime!.shipper.flushAll();
    expect(central.received.locksEvents.some((r) => r.kind === "anomaly" && r.code === "EDGE_DEVICE_RELEASED")).toBe(true);
    expect(central.received.locksEvents.filter((r) => r.kind === "command_ack" && r.requestId === 140).map((r) => r.outcome)).toEqual(["done"]);

    expect(conn.edgeDbTrapCount()).toBe(0);
  }, 60_000);
});
