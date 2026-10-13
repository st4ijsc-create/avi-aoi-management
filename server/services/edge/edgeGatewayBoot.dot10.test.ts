/**
 * doc 81 Đợt 10 task E (design §2.15, §4 E; fix review 1 I-6 / R-10-ag) — the edge gateway BOOTS and RUNS the PRODUCTION path
 * with NO central DB and NO central secret:
 *   • DATABASE_URL, every PG*, JWT_SECRET and SECRET_ENCRYPTION_KEY are removed before any import; AVI_PROCESS_ROLE=edge comes
 *     from server/edge/edgeRole (the entrypoint's first import) and EDGE_DB_TRAP=throw — any getDb / getJobsDb / getReadDb /
 *     raw postgres() anywhere in the process would THROW and be counted;
 *   • REAL modules: the gateway boot, the OT manager (a stub adapter of this node; telemetry over HTTP), C's walker
 *     (foeEngine.driveEdgeRunFromPackage + edgeRunStore), D's edge dispatch (installEdgeDeviceRuntime → robotEdgeDispatch:
 *     verify the signed authorisation, consume the jti in the journal, drive the robot) and D's robotManager edge mode with the
 *     SIM robot driver; the central STOP goes through robotEdgeDispatch's STOP path (R-10-ad);
 *   • measured: the robot got exactly the motion and the STOP, the run was walked to `complete`, and then 0 trap hits, 0 TCP
 *     connects, 0 Postgres client constructions — plus the instrument check (a deliberate getDb() afterwards throws, counted).
 * Only central (a signing fake, edgeFakeCentral.testkit) and the UNS publisher (mqtt) are replaced.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  for (const k of Object.keys(process.env)) if (k === "DATABASE_URL" || k === "TEST_DATABASE_URL" || k.startsWith("PG") || k === "JWT_SECRET" || k === "SECRET_ENCRYPTION_KEY") delete process.env[k];
  delete process.env.AVI_PROCESS_ROLE; // the role comes from ./edgeRole — the entrypoint's first import — not from the env
  process.env.EDGE_DB_TRAP = "throw";
  return { connects: [] as string[], pgConstructed: 0 };
});

vi.mock("postgres", () => {
  const ctor = () => {
    h.pgConstructed++;
    throw new Error("postgres client constructed on the edge");
  };
  return { default: ctor };
});
vi.mock("../unsPublisher", () => ({
  isUnsPublisherConnected: () => false,
  initUnsPublisher: () => undefined,
  shutdownUnsPublisher: async () => undefined,
  publishNdeathGraceful: async () => undefined,
  publishNormalized: () => undefined,
  publishSparkplugDData: () => undefined,
}));

import "../../edge/edgeRole"; // FIRST, exactly as server/edge/edgeGatewayMain.ts (edgeRole.dot10.test.ts pins that order)
import net from "node:net";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeCentral, KIT_TOKEN, kitHashDefinition } from "./edgeFakeCentral.testkit";

const realConnect = net.Socket.prototype.connect;
let dir = "";
const central = new FakeCentral(7, 31);
const DEF = { ref: "edge-boot", name: "edge boot", steps: [{ id: "m1", type: "command", machineId: 2, command: "run_job", args: { robotId: 12, jobType: "move", params: { x: 1 } } }] };

const ENV_KEYS = [
  "OT_GATEWAY_ENABLED",
  "ROBOT_GATEWAY_ENABLED",
  "ROBOT_CONTROL_ENABLED",
  "ROBOT_SAFETY_PREFLIGHT_ENABLED",
  "EDGE_EXECUTION_ENABLED",
  "FOE_ENABLED",
  "EDGE_RUNTIME_ENABLED",
  "EDGE_CENTRAL_URL",
  "EDGE_NODE_CREDENTIAL_FILE",
  "EDGE_CENTRAL_NODE_ID",
  "EDGE_CENTRAL_CREDENTIAL_ID",
  "EDGE_KEYSET_PIN_FILE",
  "EDGE_JOURNAL_DIR",
  "EDGE_PULL_INTERVAL_MS",
  "EDGE_GATEWAY_LIVENESS_FILE",
  "EDGE_UNS_STORE_FORWARD_FILE",
  "EDGE_GATEWAY_MODE",
  "OT_STORE_FORWARD_ENABLED",
  "OT_STORE_FORWARD_FILE",
  "OT_CONN_HA_ENABLED",
] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    const a = args[0] as { host?: string; port?: number } | number;
    h.connects.push(typeof a === "object" ? `${a?.host}:${a?.port}` : String(a));
    return (realConnect as (...x: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-boot-"));
  const cred = path.join(dir, "node.cred");
  await fs.writeFile(cred, KIT_TOKEN, { mode: 0o600 });
  const pin = path.join(dir, "edge-keyset.json");
  await fs.writeFile(pin, JSON.stringify(central.pin));
  Object.assign(process.env, {
    OT_GATEWAY_ENABLED: "true",
    ROBOT_GATEWAY_ENABLED: "true",
    ROBOT_CONTROL_ENABLED: "true",
    // the snapshot ships no safety-PLC config for this sim cell: with the preflight on, D refuses the motion SAFETY_UNKNOWN
    // (fail-closed — measured once while writing this test); the preflight itself is group D's suite
    ROBOT_SAFETY_PREFLIGHT_ENABLED: "false",
    EDGE_EXECUTION_ENABLED: "true",
    FOE_ENABLED: "true",
    EDGE_RUNTIME_ENABLED: "true",
    EDGE_CENTRAL_URL: "https://central.test", // final fix wave M-4: plain http to a non-loopback host is refused
    EDGE_NODE_CREDENTIAL_FILE: cred,
    EDGE_CENTRAL_NODE_ID: "7",
    EDGE_CENTRAL_CREDENTIAL_ID: "31",
    EDGE_KEYSET_PIN_FILE: pin,
    EDGE_JOURNAL_DIR: path.join(dir, "journal"),
    EDGE_PULL_INTERVAL_MS: "200",
    EDGE_GATEWAY_LIVENESS_FILE: path.join(dir, "alive.json"),
    EDGE_UNS_STORE_FORWARD_FILE: path.join(dir, "uns.jsonl"),
  });
  delete process.env.OT_STORE_FORWARD_ENABLED;
  delete process.env.OT_STORE_FORWARD_FILE;
  delete process.env.OT_CONN_HA_ENABLED;
});

afterAll(async () => {
  const { stopEdgeGateway, _resetForTests } = await import("./edgeGatewayRuntime");
  await stopEdgeGateway();
  _resetForTests();
  net.Socket.prototype.connect = realConnect;
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("doc 81 Đợt 10 E — the edge gateway boots and runs the production path with NO central DB / secret", () => {
  it("★ boot → OT telemetry over HTTP → claim / REAL walker / D's dispatch / sim robot / complete → central STOP via D; 0 trap hits, 0 sockets, no postgres", async () => {
    expect(process.env.DATABASE_URL).toBeUndefined();
    expect(process.env.JWT_SECRET).toBeUndefined();
    expect(process.env.SECRET_ENCRYPTION_KEY).toBeUndefined();
    expect(process.env.AVI_PROCESS_ROLE).toBe("edge");
    const conn = await import("../../db/connection");
    expect(conn.isEdgeProcessRole()).toBe(true);
    expect(conn.edgeDbTrapCount()).toBe(0);
    // the robot of this node is the REAL sim driver; count what reaches it
    const { SimRobotDriver } = await import("../robot/drivers/simRobotDriver");
    const runJob = vi.spyOn(SimRobotDriver.prototype, "runJob");
    const abort = vi.spyOn(SimRobotDriver.prototype, "abort");
    // fix review 2 — the sim robot gets a REAL motion lock, so the edge lock authority is exercised end to end: a fresh
    // journal seeds it LOCKED persistUnknown, D's dispatch would refuse the move, a signed central `clear` releases it
    const { MotionLock } = await import("../robot/robotDriver");
    const locks: InstanceType<typeof MotionLock>[] = [];
    (SimRobotDriver.prototype as unknown as { motionLockController: () => InstanceType<typeof MotionLock> }).motionLockController = function (this: { _ml?: InstanceType<typeof MotionLock> }) {
      if (!this._ml) locks.push((this._ml = new MotionLock()));
      return this._ml;
    };
    // fix review 3 (F-5) — the gate D's dispatch reads before a motion
    (SimRobotDriver.prototype as unknown as { getMotionLock: () => unknown }).getMotionLock = function (this: { motionLockController: () => InstanceType<typeof MotionLock> }) {
      return this.motionLockController().snapshot();
    };

    central.packageOver.set(8, { machines: [{ id: 2, machineType: "ROBOT", capabilities: null }], verifiedStops: [], defHash: kitHashDefinition(DEF) });
    central.packageOver.set(9, { machines: [{ id: 2, machineType: "ROBOT", capabilities: null }], verifiedStops: [], defHash: kitHashDefinition(DEF) });
    const { bootstrapEdgeGateway, getEdgeGatewayHealth } = await import("./edgeGatewayRuntime");
    const handles = await bootstrapEdgeGateway({ fetchImpl: central.fetchImpl });
    expect(handles.runtime).not.toBeNull();

    // config first, verified; heartbeat over HTTP with the journal epoch and the config hash in use
    expect(central.calls[0].route).toBe("config");
    const hb = central.callsTo("heartbeat")[0]?.body;
    expect(hb).toMatchObject({ protocolVersion: 2, journal: { epoch: handles.runtime!.journal.epoch }, configHash: handles.runtime!.config.hash() });
    const rm = await import("../robot/robotManager");
    expect(rm.activeRobotIds()).toEqual([12]); // the REAL robot manager, from the verified config
    const lock = rm.getActiveRobot(12)!.driver.motionLockController!();
    expect(lock.snapshot()).toMatchObject({ locked: true, reasonCode: "persistUnknown" }); // fresh journal ⇒ fail-closed
    await vi.waitFor(() => expect(central.received.locksEvents.some((r) => r.kind === "lock" && r.event === "locked" && r.reasonCode === "persistUnknown")).toBe(true), { timeout: 5_000, interval: 50 });
    // F-5 — a run walked while the robot is LOCKED: D's dispatch refuses the move (MOTION_LOCKED), the robot never moves
    central.addRun(8, DEF);
    await vi.waitFor(() => expect(central.callsTo("complete").filter((c) => c.runId === 8).length).toBe(1), { timeout: 15_000, interval: 50 });
    expect(central.callsTo("complete").find((c) => c.runId === 8)!.body.outcome).not.toBe("completed");
    expect(runJob.mock.calls.filter((c) => (c[0] as { jobType: string }).jobType === "move")).toHaveLength(0);
    expect(JSON.stringify(central.received.report)).toContain("MOTION_LOCKED");
    central.received.report.length = 0;
    // central clears it (signed, compare-and-clear on the generation it saw)
    const gen = lock.snapshot().generation!;
    central.commands = [central.sign("cmd", central.commandPayload({ requestId: 70, kind: "clear", robotId: 12, expectedGeneration: gen, clearedBy: 4, reason: "commissioning check done" }))];
    await vi.waitFor(() => expect(central.received.locksEvents.some((r) => r.kind === "command_ack" && r.requestId === 70 && r.outcome === "done")).toBe(true), { timeout: 5_000, interval: 50 });
    expect(lock.isLocked()).toBe(false);
    central.commands = [];
    central.addRun(9, DEF);

    // OT: the stub adapter of THIS node polls; samples reach central over HTTP (telemetryBus seam)
    await vi.waitFor(() => expect(central.received.telemetry.length).toBeGreaterThan(0), { timeout: 10_000, interval: 50 });
    expect(central.received.telemetry.every((s) => s.adapterId === 21)).toBe(true);

    // the REAL walker: claim → signed package → authorise → D verifies + consumes → sim robot moves → report → complete
    await vi.waitFor(() => expect(central.callsTo("complete").filter((c) => c.runId === 9).length).toBe(1), { timeout: 15_000, interval: 50 });
    expect(central.callsTo("complete").find((c) => c.runId === 9)!.body).toMatchObject({ outcome: "completed" });
    expect(central.callsTo("authorize").map((c) => [c.runId, c.body.stepId])).toEqual([[8, "m1"], [9, "m1"]]);
    expect(runJob.mock.calls.map((c) => (c[0] as { jobType: string }).jobType)).toEqual(["move"]);
    const ledger = central.received.report.find((r) => r.kind === "ledger");
    expect(ledger).toMatchObject({ stepId: "m1", stop: false, target: { robotId: 12, jobType: "move" } });
    expect(handles.runtime!.journal.isJtiConsumed(ledger.jti)).toBe(true);

    // a central STOP of the owned robot (signed command on the pull) → D's robot STOP path → the sim robot
    central.commands = [central.sign("cmd", central.commandPayload({ requestId: 77, kind: "stop", target: { robotId: 12 } }))];
    // D's STOP path sends the CANONICAL stop job (or the driver abort) — exactly one STOP reaches the robot
    const stops = () => runJob.mock.calls.filter((c) => (c[0] as { jobType: string }).jobType === "abort").length + abort.mock.calls.length;
    await vi.waitFor(() => expect(stops()).toBe(1), { timeout: 5_000, interval: 50 });
    await vi.waitFor(() => expect(central.received.locksEvents.some((r) => r.kind === "command_ack" && r.requestId === 77 && r.outcome === "done")).toBe(true), { timeout: 5_000, interval: 50 });
    expect(central.received.locksEvents.filter((r) => r.kind === "stop" && r.requestId === 77)).toHaveLength(1); // D journaled it once
    expect((await getEdgeGatewayHealth()).status).not.toBe("unconfigured");

    // ── the measurement ──
    expect(conn.edgeDbTrapStats()).toEqual({ count: 0, byAccessor: {} });
    expect(h.connects).toEqual([]);
    expect(h.pgConstructed).toBe(0);

    // instrument check: the trap is live — a deliberate DB attempt throws and is counted
    await expect(conn.getDb()).rejects.toMatchObject({ code: "EDGE_DB_TRAP" });
    expect(conn.edgeDbTrapCount()).toBe(1);
  }, 90_000);
});
