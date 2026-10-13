/**
 * doc 81 Đợt 10 final fix wave — I-3 (ruling R-10-br): the undelivered-STOP sweep (edgeNodeCommands.alertUndeliveredStops) runs
 * on its OWN short timer (edgeStopDeliveryCheckMs ≈ the pull interval), started by the edge-node health checker — not only on
 * the 30 s node-health pass — and stops with it. Measured on the running timer (the sweep itself is the DB suite's).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const S = vi.hoisted(() => ({ sweeps: 0 }));
vi.mock("./edgeCoordinator", () => ({ edgeRuntimeEnabled: () => true, markStaleNodesOffline: async () => [] }));
vi.mock("./edgeExecutionCentral", () => ({ holdUnclaimedEdgeRuns: async () => [] }));
vi.mock("./edgeExecutionSchema", () => ({ isEdgeSchemaMissing: () => false }));
vi.mock("./edgeCentralCommon", () => ({ isEdgeUnavailableError: () => false }));
vi.mock("./edgeNodeCommands", () => ({
  expireEdgeRequests: async () => 0,
  edgeStopDeliveryCheckMs: () => 40,
  alertUndeliveredStops: async () => {
    S.sweeps++;
    return 0;
  },
}));

import { startEdgeNodeHealthChecker, stopEdgeNodeHealthChecker } from "./edgeNodeHealthScheduler";

afterEach(() => stopEdgeNodeHealthChecker());

describe("final fix wave I-3 — the undelivered-STOP sweep timer", () => {
  it("★ started by the health checker, every edgeStopDeliveryCheckMs (40 ms here, the node pass is 60 s); stopped with it", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const saved = process.env.EDGE_NODE_HEALTH_INTERVAL_MS;
    process.env.EDGE_NODE_HEALTH_INTERVAL_MS = "60000";
    try {
      startEdgeNodeHealthChecker();
      await vi.waitFor(() => expect(S.sweeps).toBeGreaterThanOrEqual(3), { timeout: 2_000, interval: 10 });
      stopEdgeNodeHealthChecker();
      const n = S.sweeps;
      await new Promise((r) => setTimeout(r, 150));
      expect(S.sweeps).toBe(n);
    } finally {
      process.env.EDGE_NODE_HEALTH_INTERVAL_MS = saved;
    }
  });
});
