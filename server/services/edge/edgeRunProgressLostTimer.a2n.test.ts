/**
 * Đĩa edge treo (a2n) — layer 2 runs on central's own: the node-health pass calls the lost-progress sweep (edgeExecutionCentral.baoRunMatProgress) and it stops
 * with the checker. Measured on the running timer: the sweep is the only reader that selects both `a` and `nodeCode` (a stub database counts it). A sweep that fails is
 * logged, never thrown into the timer, and the pass goes on; a missing migration 0370 is silent.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const S = vi.hoisted(() => ({ sweeps: 0, fail: null as null | Error }));
vi.mock("./edgeCoordinator", async (orig) => ({ ...(await orig<typeof import("./edgeCoordinator")>()), edgeRuntimeEnabled: () => true, markStaleNodesOffline: async () => [] }));
vi.mock("../../db/connection", () => ({
  getDb: async () => ({
    select(p?: Record<string, unknown>) {
      const b: Record<string, unknown> = {};
      for (const k of ["from", "innerJoin", "where", "orderBy", "limit"]) b[k] = () => b;
      b.then = (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => {
        if (!p || !("a" in p && "nodeCode" in p)) return Promise.resolve([]).then(res, rej); // holdUnclaimedEdgeRuns selects a `nodeCode` too, never an `a`
        S.sweeps++;
        return (S.fail ? Promise.reject(S.fail) : Promise.resolve([])).then(res, rej);
      };
      return b;
    },
  }),
}));

import { startEdgeNodeHealthChecker, stopEdgeNodeHealthChecker } from "./edgeNodeHealthScheduler";

const saved = process.env.EDGE_NODE_HEALTH_INTERVAL_MS;
afterEach(() => {
  stopEdgeNodeHealthChecker();
  process.env.EDGE_NODE_HEALTH_INTERVAL_MS = saved;
  vi.restoreAllMocks();
  S.fail = null;
});

describe("a2n — the lost-progress sweep on the node-health pass", () => {
  it("★ every pass calls it; stopped with the checker", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.env.EDGE_NODE_HEALTH_INTERVAL_MS = "20";
    startEdgeNodeHealthChecker();
    await vi.waitFor(() => expect(S.sweeps).toBeGreaterThanOrEqual(3), { timeout: 5_000, interval: 5 });
    stopEdgeNodeHealthChecker();
    await new Promise((r) => setTimeout(r, 40));
    const n = S.sweeps;
    await new Promise((r) => setTimeout(r, 80));
    expect(S.sweeps).toBe(n);
  });

  it("★ a failing sweep is logged and the next pass sweeps again; a missing 0370 is silent", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.EDGE_NODE_HEALTH_INTERVAL_MS = "20";
    S.fail = Object.assign(new Error("no table"), { code: "42P01" });
    const n0 = S.sweeps;
    startEdgeNodeHealthChecker();
    await vi.waitFor(() => expect(S.sweeps).toBeGreaterThanOrEqual(n0 + 2), { timeout: 5_000, interval: 5 });
    expect(err.mock.calls.filter((c) => String(c[0]).includes("lost-progress"))).toEqual([]);
    S.fail = new Error("db down");
    await vi.waitFor(() => expect(err.mock.calls.filter((c) => String(c[0]).includes("lost-progress sweep failed")).length).toBeGreaterThan(0), { timeout: 5_000, interval: 5 });
    const n1 = S.sweeps;
    await vi.waitFor(() => expect(S.sweeps).toBeGreaterThan(n1), { timeout: 5_000, interval: 5 });
  });
});
