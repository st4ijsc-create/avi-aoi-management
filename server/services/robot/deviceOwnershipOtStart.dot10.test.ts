/**
 * doc 81 Đợt 10 task D fix review 4 — NF-3 (R-10-al, OT half). Central starts OT only after the HTTP listen, so the ownership sync's
 * first reconcile used to run while the OT gateway was still OFF and SEED the adapters' epochs; after a failed startOt load the
 * later passes saw "epoch unchanged" and never attached the adapter (measured: never, passes 1–3). Now:
 *   • epochs are only seen while the gateway is on (a pass before startOt changes nothing);
 *   • the sync reconciles again as soon as startOt has finished (onOtGatewayStarted) — the adapter is attached then.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  adapters: [] as Array<{ id: number; edgeNodeId: number | null; ownerEpoch: number }>,
  active: [] as number[],
  otOn: false,
  calls: [] as string[],
  started: [] as Array<() => void>,
}));
vi.mock("../../db/connection", () => ({
  isEdgeProcessRole: () => false,
  getDb: async () => ({
    execute: async (q: { queryChunks?: unknown }) => (JSON.stringify(q.queryChunks ?? q).includes("device_adapters") ? H.adapters : []),
  }),
}));
vi.mock("./robotManager", () => ({
  activeRobotIds: () => [],
  isCentralRobotGatewayOn: () => true,
  robotTriedAtStart: () => true,
  detachRobot: async () => false,
  attachRobot: async () => false,
}));
vi.mock("../ot/otManager", () => ({
  isOtRunning: () => H.otOn,
  isOtGatewayOn: () => H.otOn,
  otAdapterTriedAtStart: () => false, // startOt's load FAILED: it tried nothing
  getActiveAdapter: (id: number) => (H.active.includes(id) ? { adapterId: id } : undefined),
  detachOtAdapter: async () => false,
  attachOtAdapter: async (a: { adapterId: number }) => {
    if (!H.otOn) return false;
    H.calls.push(`attach:adapter:${a.adapterId}`);
    H.active.push(a.adapterId);
    return true;
  },
  onOtGatewayStarted: (fn: () => void) => {
    H.started.push(fn);
    return () => undefined;
  },
}));
vi.mock("../ot/deviceAdapter", () => ({ loadEnabledAdapters: async () => H.adapters.map((a) => ({ adapterId: a.id })) }));

import { reconcileDeviceOwnership, startDeviceOwnershipSync, _resetOwnershipReconcileForTests } from "./deviceOwnershipService";

beforeEach(() => {
  _resetOwnershipReconcileForTests();
  H.adapters = [{ id: 10, edgeNodeId: null, ownerEpoch: 1 }];
  H.active = [];
  H.otOn = false;
  H.calls = [];
  H.started = [];
});

describe("NF-3 — the OT half of the first reconcile", () => {
  it("★ a pass BEFORE startOt seeds nothing: once the gateway is on (its load failed), the next pass attaches the adapter", async () => {
    expect(await reconcileDeviceOwnership()).toEqual({ attached: [], detached: [] }); // gateway off: nothing to do
    H.otOn = true; // startOt ran, its load failed (nothing tried)
    expect((await reconcileDeviceOwnership()).attached).toEqual(["adapter:10"]);
    expect(H.calls).toEqual(["attach:adapter:10"]);
  });

  it("★ the sync reconciles again when startOt FINISHES (onOtGatewayStarted) — the adapter is attached then, not 30 s later", async () => {
    const stop = await startDeviceOwnershipSync({ listenDeadlineMs: 10 });
    try {
      await new Promise((r) => setTimeout(r, 50)); // the first (pre-startOt) pass
      expect(H.calls).toEqual([]);
      expect(H.started).toHaveLength(1);
      H.otOn = true;
      H.started[0](); // startOt finished (load failed)
      const t0 = Date.now();
      while (H.calls.length === 0 && Date.now() - t0 < 2_000) await new Promise((r) => setTimeout(r, 10));
      expect(H.calls).toEqual(["attach:adapter:10"]);
    } finally {
      await stop();
    }
  });
});
