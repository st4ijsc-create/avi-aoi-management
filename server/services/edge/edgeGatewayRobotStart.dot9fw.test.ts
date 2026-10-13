/**
 * doc 81 Đợt 9 final wave F1 (final review I1) — the edge gateway starts ONLY its node's robots, with ingest OFF in-process.
 *
 * doc 81 Đợt 10 task E — re-measured for protocol v2: the robots are the OWNED robots of the VERIFIED config snapshot
 * (robotManager edge mode: configRobots), never a DB load scoped by EDGE_GATEWAY_LINE_CODES / EDGE_GATEWAY_FACTORY_CODE; a
 * node that is not provisioned (no credential / node id / pin) starts NO robot at all (fail-closed). The full boot with a
 * config — robots started after OT, lock seeded from the journal — is measured in edgeGatewayBoot.dot10.test.ts.
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
vi.mock("../ot", () => ({ startOt: async () => undefined, stopOt: async () => undefined }));
vi.mock("../robot/robotManager", () => ({
  startRobots: vi.fn(async (opts?: unknown) => {
    h.startRobots.push(opts);
    return true;
  }),
}));

import { bootstrapEdgeGateway, stopEdgeGateway, _resetForTests } from "./edgeGatewayRuntime";

const KEYS = ["EDGE_EXECUTION_ENABLED", "EDGE_GATEWAY_LINE_CODES", "EDGE_GATEWAY_FACTORY_CODE", "EDGE_GATEWAY_MODE", "EDGE_UNS_STORE_FORWARD_FILE", "EDGE_GATEWAY_LIVENESS_FILE", "EDGE_GATEWAY_CONFIG_FILE", "EDGE_CENTRAL_URL", "EDGE_NODE_CREDENTIAL_FILE"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.EDGE_UNS_STORE_FORWARD_FILE = path.join(os.tmpdir(), `fw1-uns-${stamp}.jsonl`);
  process.env.EDGE_GATEWAY_LIVENESS_FILE = path.join(os.tmpdir(), `fw1-alive-${stamp}.json`);
  delete process.env.EDGE_GATEWAY_CONFIG_FILE;
  delete process.env.EDGE_CENTRAL_URL;
  delete process.env.EDGE_NODE_CREDENTIAL_FILE;
  h.startRobots.length = 0;
});
afterEach(async () => {
  await stopEdgeGateway();
  _resetForTests();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("final wave F1 / Đợt 10 E — the edge boot starts ONLY its node's robots, from the verified config", () => {
  it("★ not provisioned (no credential / node id / pin): NO robot is started, whatever the env says (fail-closed)", async () => {
    process.env.EDGE_EXECUTION_ENABLED = "true";
    process.env.EDGE_GATEWAY_LINE_CODES = "L7,L8";
    const r = await bootstrapEdgeGateway();
    expect(r.runtime).toBeNull();
    expect(h.startRobots).toEqual([]);
  });
});
