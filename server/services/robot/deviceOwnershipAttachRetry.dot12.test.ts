/**
 * doc 81 Đợt 12 task N fix 1 (review M-3) — a robot released from an edge whose central ATTACH fails (its driver cannot connect at
 * that moment) used to stay unattached until a restart: the ownership reconcile tried it once, on the epoch change, and never
 * again (the epoch was then "seen"). Its persisted ownerChanged lock could neither be shown live nor cleared. Now an attach the
 * reconcile tried and that FAILED is retried on every later pass (while the robot stays central-owned, enabled and without a
 * session), with no restart. A robot that merely failed at BOOT (never tried by the reconcile) is still not retried (unchanged).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  robots: [] as Array<{ id: number; edgeNodeId: number | null; ownerEpoch: number }>,
  activeRobots: [] as number[],
  attachOk: false,
  calls: [] as string[],
}));
vi.mock("../../db/connection", () => ({
  isEdgeProcessRole: () => false,
  getDb: async () => ({
    execute: async (q: { queryChunks?: Array<{ value?: string[] }> }) => (JSON.stringify(q.queryChunks ?? q).includes("device_adapters") ? [] : H.robots),
  }),
}));
vi.mock("./robotManager", () => ({
  activeRobotIds: () => H.activeRobots,
  isCentralRobotGatewayOn: () => true,
  robotTriedAtStart: () => true,
  detachRobot: async (id: number) => (H.calls.push(`detach:${id}`), true),
  attachRobot: async (id: number) => {
    H.calls.push(`attach:${id}`);
    if (H.attachOk) H.activeRobots.push(id);
    return H.attachOk;
  },
}));
vi.mock("../ot/otManager", () => ({
  isOtGatewayOn: () => true,
  otAdapterTriedAtStart: () => true,
  getActiveAdapter: () => undefined,
  detachOtAdapter: async () => true,
}));

import { reconcileDeviceOwnership, _resetOwnershipReconcileForTests } from "./deviceOwnershipService";

beforeEach(() => {
  _resetOwnershipReconcileForTests();
  H.calls.length = 0;
  H.activeRobots = [];
  H.attachOk = false;
});

describe("doc 81 Đợt 12 N fix 1 (M-3) — a failed attach is retried by the ownership reconcile (no restart)", () => {
  it("★ released from an edge, the attach fails ⇒ retried on the next passes until it succeeds; then never again", async () => {
    H.robots = [{ id: 7, edgeNodeId: 3, ownerEpoch: 5 }];
    await reconcileDeviceOwnership(); // edge-owned: epoch 5 seen
    H.robots = [{ id: 7, edgeNodeId: null, ownerEpoch: 6 }]; // released to central
    expect(await reconcileDeviceOwnership()).toEqual({ attached: [], detached: [] }); // the attach failed (cannot connect)
    expect(H.calls).toEqual(["attach:7"]);
    await reconcileDeviceOwnership(); // same epoch — retried
    expect(H.calls).toEqual(["attach:7", "attach:7"]);
    H.attachOk = true;
    expect(await reconcileDeviceOwnership()).toEqual({ attached: ["robot:7"], detached: [] });
    await reconcileDeviceOwnership(); // attached now — nothing more
    expect(H.calls).toEqual(["attach:7", "attach:7", "attach:7"]);
  });

  it("★ the retry stops when the robot goes back to an edge or is disabled; a robot never tried by the reconcile is not retried (unchanged)", async () => {
    H.robots = [{ id: 8, edgeNodeId: 3, ownerEpoch: 1 }, { id: 9, edgeNodeId: null, ownerEpoch: 1 }];
    await reconcileDeviceOwnership();
    H.robots = [{ id: 8, edgeNodeId: null, ownerEpoch: 2 }, { id: 9, edgeNodeId: null, ownerEpoch: 1 }];
    await reconcileDeviceOwnership();
    expect(H.calls).toEqual(["attach:8"]); // 9: failed only at boot (epoch unchanged) — not the reconcile's to retry
    H.robots = [{ id: 8, edgeNodeId: 4, ownerEpoch: 3 }, { id: 9, edgeNodeId: null, ownerEpoch: 1 }]; // back to an edge
    await reconcileDeviceOwnership();
    H.robots = [{ id: 8, edgeNodeId: null, ownerEpoch: 3 }, { id: 9, edgeNodeId: null, ownerEpoch: 1 }]; // (same epoch: no change seen)
    await reconcileDeviceOwnership();
    expect(H.calls).toEqual(["attach:8"]);
    // disabled: the query lists enabled robots only ⇒ it drops out of the retry
    H.robots = [{ id: 8, edgeNodeId: null, ownerEpoch: 4 }];
    await reconcileDeviceOwnership(); // epoch change ⇒ tried, fails
    H.robots = [];
    await reconcileDeviceOwnership();
    H.robots = [{ id: 8, edgeNodeId: null, ownerEpoch: 4 }]; // re-enabled, epoch unchanged
    await reconcileDeviceOwnership();
    expect(H.calls).toEqual(["attach:8", "attach:8"]);
  });
});
