/**
 * doc 81 Đợt 10 task D fix review 1 — ruling R-10-v backstop: the periodic ownership reconcile (≤ 30 s) of this process's central
 * sessions. A session to a device an EDGE node owns is detached (its polling / ingest / motion stop); a central-owned enabled
 * device whose owner EPOCH changed since the last pass and has no session here is attached; a device that merely failed to
 * connect (epoch unchanged) is not retried by it. The sync never starts on the edge.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  robots: [] as Array<{ id: number; edgeNodeId: number | null; ownerEpoch: number }>,
  adapters: [] as Array<{ id: number; edgeNodeId: number | null; ownerEpoch: number }>,
  activeRobots: [] as number[],
  activeAdapters: [] as number[],
  calls: [] as string[],
  dbCalls: 0,
  edge: false,
}));
vi.mock("../../db/connection", () => ({
  isEdgeProcessRole: () => H.edge,
  getDb: async () => {
    H.dbCalls++;
    return {
      execute: async (q: { queryChunks?: Array<{ value?: string[] }> }) => {
        const text = JSON.stringify(q.queryChunks ?? q);
        return text.includes("device_adapters") ? H.adapters : H.robots;
      },
    };
  },
}));
vi.mock("./robotManager", () => ({
  activeRobotIds: () => H.activeRobots,
  detachRobot: async (id: number) => (H.calls.push(`detach:robot:${id}`), true),
  attachRobot: async (id: number) => (H.calls.push(`attach:robot:${id}`), true),
}));
vi.mock("../ot/otManager", () => ({
  isOtRunning: () => true,
  getActiveAdapter: (id: number) => (H.activeAdapters.includes(id) ? { adapterId: id } : undefined),
  detachOtAdapter: async (id: number) => (H.calls.push(`detach:adapter:${id}`), true),
  attachOtAdapter: async (a: { adapterId: number }) => (H.calls.push(`attach:adapter:${a.adapterId}`), H.activeAdapters.push(a.adapterId), true),
}));
vi.mock("../ot/deviceAdapter", () => ({ loadEnabledAdapters: async () => H.adapters.map((a) => ({ adapterId: a.id })) }));

import { reconcileDeviceOwnership, startDeviceOwnershipSync, _resetOwnershipReconcileForTests } from "./deviceOwnershipService";

beforeEach(() => {
  _resetOwnershipReconcileForTests();
  H.calls.length = 0;
  H.dbCalls = 0;
  H.edge = false;
});

describe("R-10-v — ownership reconcile (backstop of the live NOTIFY)", () => {
  it("★ central session to an edge-owned robot / adapter ⇒ detached; an epoch change back to central ⇒ attached; an unchanged epoch is not retried", async () => {
    H.robots = [
      { id: 1, edgeNodeId: 4, ownerEpoch: 2 }, // moved to edge — central still holds a session
      { id: 2, edgeNodeId: null, ownerEpoch: 1 }, // central, no session (failed connect) — never retried by the reconcile
      { id: 3, edgeNodeId: 5, ownerEpoch: 3 }, // edge-owned, no session here
    ];
    H.adapters = [{ id: 10, edgeNodeId: 4, ownerEpoch: 2 }];
    H.activeRobots = [1];
    H.activeAdapters = [10];
    expect(await reconcileDeviceOwnership()).toEqual({ detached: ["robot:1", "adapter:10"], attached: [] });
    H.activeRobots = [];
    H.activeAdapters = [];
    H.calls.length = 0;
    // robot 3 moves back to central (epoch 3 → 4); robot 2 unchanged; adapter 10 back to central (2 → 3)
    H.robots = [
      { id: 1, edgeNodeId: 4, ownerEpoch: 2 },
      { id: 2, edgeNodeId: null, ownerEpoch: 1 },
      { id: 3, edgeNodeId: null, ownerEpoch: 4 },
    ];
    H.adapters = [{ id: 10, edgeNodeId: null, ownerEpoch: 3 }];
    expect(await reconcileDeviceOwnership()).toEqual({ detached: [], attached: ["robot:3", "adapter:10"] });
    expect(H.calls).toEqual(["attach:robot:3", "attach:adapter:10"]);
  });

  it("the sync never starts on the edge (no DB touched)", async () => {
    H.edge = true;
    const stop = await startDeviceOwnershipSync();
    await stop();
    expect(H.dbCalls).toBe(0);
  });
});
