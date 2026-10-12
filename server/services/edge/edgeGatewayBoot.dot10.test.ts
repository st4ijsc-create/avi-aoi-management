/**
 * doc 81 Đợt 10 task E (design §2.15, §4 E) — the edge gateway BOOTS and RUNS with NO central DB:
 *   • DATABASE_URL and every PG* variable are removed before any import; AVI_PROCESS_ROLE=edge is set by importing
 *     server/edge/edgeRole FIRST (the entrypoint's own first import) + EDGE_DB_TRAP=throw, so any
 *     getDb / getJobsDb / getReadDb call anywhere in the process would THROW and be counted;
 *   • boot order config → sources → OT → robots → agent: the verified config (fake central, signed) drives the OT manager
 *     (a stub adapter of THIS node), its telemetry leaves through the telemetryBus insert-function seam over HTTP; the agent
 *     claims a run, verifies the signed package, the walker authorises + consumes + reports, the segment end is delivered;
 *     a central STOP command reaches the robot; the heartbeat is HTTP with the journal epoch and config hash;
 *   • measured: 0 trap hits, 0 TCP connects (net tripwire), 0 Postgres client constructions — and the instrument check: an
 *     explicit getDb() afterwards DOES throw EDGE_DB_TRAP and is counted (a trap that never fires proves nothing).
 * Robots (group D's manager, DB-backed until D lands) and the UNS publisher (mqtt) are replaced; everything else is real.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  for (const k of Object.keys(process.env)) if (k === "DATABASE_URL" || k === "TEST_DATABASE_URL" || k.startsWith("PG")) delete process.env[k];
  delete process.env.AVI_PROCESS_ROLE; // the role comes from ./edgeRole — the entrypoint's first import — not from the env
  process.env.EDGE_DB_TRAP = "throw";
  return { connects: [] as string[], pgConstructed: 0, startRobots: [] as unknown[], robotAborts: 0 };
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
vi.mock("../robot/robotManager", () => ({
  startRobots: async (opts: unknown) => {
    h.startRobots.push(opts);
    return true;
  },
  stopRobots: async () => undefined,
  getActiveRobot: (id: number) =>
    id === 12
      ? {
          id: 12,
          code: "rb-12",
          driver: {
            abort: async () => {
              h.robotAborts++;
            },
          },
        }
      : undefined,
}));

import "../../edge/edgeRole"; // FIRST, exactly as server/edge/edgeGatewayMain.ts (edgeRole.dot10.test.ts pins that order)
import net from "node:net";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeCentral, KIT_TOKEN, kitHashDefinition } from "./edgeFakeCentral.testkit";
import type { EdgeRunIo, EdgeSegmentOutcome, EdgeWalker } from "./edgeExecutionAgent";

const realConnect = net.Socket.prototype.connect;
let dir = "";
const central = new FakeCentral(7, 31);
let walked = 0;
let motions = 0;

const walker: EdgeWalker = {
  drive: async (_pkg, io: EdgeRunIo): Promise<EdgeSegmentOutcome> => {
    walked++;
    const a = await io.authorize.authorize({ runId: io.runId, claimSeq: io.claimSeq, claimToken: io.claimToken, stepId: "m1", attempt: 1, idempotencyKey: `foe:${io.runId}:m1:1`, command: { kind: "robot", robotId: 12, jobType: "move", params: {} }, payloadHash: "sha256:" + "a".repeat(64) });
    if (!a.ok) return { outcome: "held", heldReason: "centralUnreachable" };
    const c = await io.consume.consumeAuthorization({ jti: a.claims.jti, runId: io.runId, claimSeq: io.claimSeq, stepId: "m1", attempt: 1 });
    if (!c.ok) return { outcome: "failed", error: c.reason };
    io.authorize.settleNonce(a.reqNonce);
    motions++;
    await io.sink.run(io.runId, io.claimSeq, { kind: "step", stepId: "m1", stepType: "command", status: "completed", attempt: 1, startedAt: 1, finishedAt: 2, error: null, result: null, jti: a.claims.jti });
    return { outcome: "completed" };
  },
  abortLive: async () => ({ live: false }),
};

const ENV_KEYS = [
  "OT_GATEWAY_ENABLED",
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
    EDGE_EXECUTION_ENABLED: "true",
    FOE_ENABLED: "true",
    EDGE_RUNTIME_ENABLED: "true",
    EDGE_CENTRAL_URL: "http://central.test",
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

describe("doc 81 Đợt 10 E — the edge gateway boots and runs OT + the agent with NO central DB", () => {
  it("★ boot → OT telemetry over HTTP → claim / walk / report / complete → central STOP; 0 trap hits, 0 sockets, no postgres", async () => {
    expect(process.env.DATABASE_URL).toBeUndefined();
    expect(process.env.AVI_PROCESS_ROLE).toBe("edge");
    const conn = await import("../../db/connection");
    expect(conn.isEdgeProcessRole()).toBe(true);
    const trapBefore = conn.edgeDbTrapCount();
    expect(trapBefore).toBe(0);

    central.addRun(9, { steps: [{ id: "m1", type: "command" }] });
    const { bootstrapEdgeGateway } = await import("./edgeGatewayRuntime");
    const handles = await bootstrapEdgeGateway({ fetchImpl: central.fetchImpl, walker });
    expect(handles.runtime).not.toBeNull();

    // config first, verified; heartbeat over HTTP with the journal epoch and the config hash in use
    expect(central.calls[0].route).toBe("config");
    const hb = central.callsTo("heartbeat")[0]?.body;
    expect(hb).toMatchObject({ protocolVersion: 2, journal: { epoch: handles.runtime!.journal.epoch }, configHash: handles.runtime!.config.hash() });
    // robots: the OWNED robots of the VERIFIED config (no DB load), lock seeded from the journal — a fresh journal knows
    // nothing ⇒ the robot starts LOCKED persistUnknown above every known generation, announced to central as a lock event
    expect(h.startRobots).toHaveLength(1);
    const ro = h.startRobots[0] as { configRobots: Array<{ id: number }>; attachLock: (r: unknown, l: unknown) => void; stateSink: (r: unknown, s: unknown) => void };
    expect(ro.configRobots.map((r) => r.id)).toEqual([12]);
    const { MotionLock } = await import("../robot/robotDriver");
    const lock = new MotionLock();
    ro.attachLock(ro.configRobots[0], lock);
    expect(lock.snapshot()).toMatchObject({ locked: true, reasonCode: "persistUnknown", generation: 1 });
    ro.stateSink(ro.configRobots[0], { busy: false, estop: true, timestamp: new Date() });
    await vi.waitFor(() => expect(central.received.robotsState.map((r) => [r.robotId, r.estop])).toEqual([[12, true]]), { timeout: 5_000, interval: 50 });
    await vi.waitFor(() => expect(central.received.locksEvents.some((r) => r.kind === "lock" && r.robotId === 12 && r.event === "locked" && r.reasonCode === "persistUnknown")).toBe(true), { timeout: 5_000, interval: 50 });

    // OT: the stub adapter of THIS node polls; samples reach central over HTTP (telemetryBus seam)
    await vi.waitFor(() => expect(central.received.telemetry.length).toBeGreaterThan(0), { timeout: 10_000, interval: 50 });
    expect(central.received.telemetry.every((s) => s.adapterId === 21)).toBe(true);
    expect(new Set(central.received.telemetry.map((s) => s.tagKey))).toEqual(new Set(["temp", "run"]));

    // the agent: claim → signed package → walk (authorise + consume + report) → complete
    await vi.waitFor(() => expect(central.callsTo("complete").length).toBe(1), { timeout: 10_000, interval: 50 });
    expect(walked).toBe(1);
    expect(motions).toBe(1);
    expect(central.callsTo("complete")[0].body).toMatchObject({ outcome: "completed", reportedThrough: 1 });
    expect(central.received.report.map((r) => r.stepId)).toEqual(["m1"]);
    expect(central.callsTo("claim")[0].body.defHash).toBe(kitHashDefinition({ steps: [{ id: "m1", type: "command" }] }));

    // a central STOP of the owned robot (signed command on the pull)
    central.commands = [central.sign("cmd", central.commandPayload({ requestId: 77, kind: "stop", target: { robotId: 12 } }))];
    await vi.waitFor(() => expect(h.robotAborts).toBe(1), { timeout: 5_000, interval: 50 });
    await vi.waitFor(() => expect(central.received.locksEvents.some((r) => r.kind === "command_ack" && r.requestId === 77 && r.outcome === "done")).toBe(true), { timeout: 5_000, interval: 50 });

    // ── the measurement ──
    expect(conn.edgeDbTrapStats()).toEqual({ count: 0, byAccessor: {} });
    expect(h.connects).toEqual([]);
    expect(h.pgConstructed).toBe(0);

    // instrument check: the trap is live — a deliberate DB attempt throws and is counted
    await expect(conn.getDb()).rejects.toMatchObject({ code: "EDGE_DB_TRAP" });
    expect(conn.edgeDbTrapCount()).toBe(1);
  }, 60_000);
});
