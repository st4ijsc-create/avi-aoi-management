/**
 * doc 81 Đợt 9 final wave F1 (final review I1) — the edge gateway's BOOT starts its robots SCOPED to its own lines / factory and
 * with ingest OFF (central is the one robot-state ingest owner), and only when run execution is on. Before: startRobots() —
 * every enabled robot of the control plane, state ingested here as well as on central (a physical e-stop recorded twice).
 * No broker / DB: the boot's collaborators are replaced; only the call made to the robot manager is measured.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({ startRobots: [] as unknown[], execStarted: 0 }));
vi.mock("../unsPublisher", () => ({
  isUnsPublisherConnected: () => false,
  initUnsPublisher: () => undefined,
  shutdownUnsPublisher: async () => undefined,
  publishNdeathGraceful: async () => undefined,
}));
vi.mock("./edgeCoordinator", () => ({ registerNode: async () => ({ ok: true, enabled: true, data: {} }), heartbeat: async () => ({ ok: true, enabled: true, data: {} }) }));
vi.mock("../ot", () => ({ startOt: async () => undefined, stopOt: async () => undefined }));
vi.mock("../robot/robotManager", () => ({
  startRobots: vi.fn(async (opts?: unknown) => {
    h.startRobots.push(opts);
    return true;
  }),
}));
vi.mock("./edgeExecutionAgent", () => ({
  startEdgeExecutionFromEnv: async () => {
    h.execStarted++;
    return null;
  },
  stopEdgeExecution: async () => undefined,
}));

import { bootstrapEdgeGateway, stopEdgeGateway } from "./edgeGatewayRuntime";

const KEYS = ["EDGE_EXECUTION_ENABLED", "EDGE_GATEWAY_LINE_CODES", "EDGE_GATEWAY_FACTORY_CODE", "EDGE_GATEWAY_MODE", "EDGE_UNS_STORE_FORWARD_FILE", "EDGE_GATEWAY_LIVENESS_FILE", "EDGE_GATEWAY_CONFIG_FILE"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.EDGE_UNS_STORE_FORWARD_FILE = path.join(os.tmpdir(), `fw1-uns-${stamp}.jsonl`);
  process.env.EDGE_GATEWAY_LIVENESS_FILE = path.join(os.tmpdir(), `fw1-alive-${stamp}.json`);
  delete process.env.EDGE_GATEWAY_CONFIG_FILE;
  h.startRobots.length = 0;
  h.execStarted = 0;
});
afterEach(async () => {
  await stopEdgeGateway();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("final wave F1 — the edge boot starts ONLY its node's robots, ingest off", () => {
  it("★ execution on: startRobots({ scope: its lines + factory, ingest: false }) — never the unscoped central call", async () => {
    process.env.EDGE_EXECUTION_ENABLED = "true";
    process.env.EDGE_GATEWAY_LINE_CODES = "L7,L8";
    process.env.EDGE_GATEWAY_FACTORY_CODE = "F-HN";
    await bootstrapEdgeGateway();
    expect(h.startRobots).toEqual([{ scope: { lineCodes: ["L7", "L8"], factoryCode: "F-HN" }, ingest: false }]);
    expect(h.execStarted).toBe(1);
  });

  it("execution off: no robot is started on the edge at all", async () => {
    delete process.env.EDGE_EXECUTION_ENABLED;
    await bootstrapEdgeGateway();
    expect(h.startRobots).toEqual([]);
  });
});
