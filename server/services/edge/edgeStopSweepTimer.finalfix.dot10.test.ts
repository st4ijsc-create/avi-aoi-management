/**
 * doc 81 Đợt 10 final fix wave — I-3 (ruling R-10-br): the undelivered-STOP sweep (edgeNodeCommands.alertUndeliveredStops) runs
 * on its OWN short timer (edgeStopDeliveryCheckMs ≈ the pull interval), started by the edge-node health checker — not only on
 * the 30 s node-health pass — and stops with it. Measured on the running timer (the sweep itself is the DB suite's).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// X-14 (HST 17/11): the order of the two sweeps of one tick (A = alertUndeliveredStops, B = canhBaoStopRunQuaHan) and B throwing
const S = vi.hoisted(() => ({ sweeps: 0, thuTu: [] as string[], x14Nem: false }));
vi.mock("./edgeCoordinator", () => ({ edgeRuntimeEnabled: () => true, markStaleNodesOffline: async () => [] }));
vi.mock("./edgeExecutionCentral", () => ({ holdUnclaimedEdgeRuns: async () => [] }));
vi.mock("./edgeExecutionSchema", () => ({ isEdgeSchemaMissing: () => false }));
vi.mock("./edgeCentralCommon", () => ({ isEdgeUnavailableError: () => false }));
vi.mock("./edgeNodeCommands", () => ({
  expireEdgeRequests: async () => 0,
  edgeStopDeliveryCheckMs: () => 40,
  alertUndeliveredStops: async () => {
    S.sweeps++;
    S.thuTu.push("A");
    return 0;
  },
  canhBaoStopRunQuaHan: async () => {
    S.thuTu.push("B");
    if (S.x14Nem) throw new Error("X-14 sweep failed (test)");
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
  // X-14 ca 12 (tam/x14-thiet-ke.md mục 5; HST 17/11: alertUndeliveredStops runs first) — red before edgeNodeHealthScheduler.ts calls the new sweep
  it("X14-12-HS every tick runs canhBaoStopRunQuaHan AFTER alertUndeliveredStops (never before, never instead); the new sweep throwing never stops the next ticks", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const saved = process.env.EDGE_NODE_HEALTH_INTERVAL_MS;
    process.env.EDGE_NODE_HEALTH_INTERVAL_MS = "60000";
    S.thuTu = [];
    S.x14Nem = false;
    try {
      startEdgeNodeHealthChecker();
      await vi.waitFor(() => expect(S.thuTu.filter((x) => x === "B").length).toBeGreaterThanOrEqual(3), { timeout: 2_000, interval: 10 });
      const dau = S.thuTu.slice(0, 6);
      expect(dau, "A then B, tick after tick").toEqual(["A", "B", "A", "B", "A", "B"]);
      S.x14Nem = true;
      const n = S.sweeps;
      await vi.waitFor(() => expect(S.sweeps).toBeGreaterThanOrEqual(n + 3), { timeout: 2_000, interval: 10 });
    } finally {
      stopEdgeNodeHealthChecker();
      S.x14Nem = false;
      process.env.EDGE_NODE_HEALTH_INTERVAL_MS = saved;
    }
  });
});
