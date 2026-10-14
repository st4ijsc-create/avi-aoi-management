/**
 * doc 81 Đợt 11 final fix wave (ruling R-11-k 4, final review M-3) — the GLOBAL pending-STOP sweep's "device row busy ⇒ STOP sent
 * anyway" branch (H fix 1), with a stubbed STOP sender and a fake DB (no shared `_test` STOPs):
 *   • the STOP is sent on EVERY pass while the row stays busy (idempotent, L-7);
 *   • the operator alert is raised ONCE per device per lock episode — again only when the send outcome changes, or in a new episode
 *     (a pass that obtains the lock, or the device leaving the pending set, ends the episode);
 *   • a NAMED device (a transfer just made here) still alerts every time.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  /** the device row lock is held by someone else ⇒ the sweep's FOR SHARE fails with 55P03 */
  busy: true,
  /** the device ids in device_pending_stops (global sweep's device list) */
  pendingDevices: [7] as number[],
  dispatched: [] as number[],
  dispatchOk: true,
  alerts: [] as string[],
}));
vi.mock("../../db/connection", () => ({
  isEdgeProcessRole: () => false,
  getDb: async () => {
    const tx = {
      execute: async (q: unknown) => {
        const text = JSON.stringify(q);
        if (text.includes("FOR SHARE")) {
          if (H.busy) throw Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
          return [];
        }
        return []; // SET LOCAL … / the pending pick (nothing pending ⇒ the pass ends without a STOP)
      },
      transaction: async (fn: (sp: unknown) => Promise<unknown>) => fn(tx),
    };
    return {
      execute: async (q: unknown) => {
        const text = JSON.stringify(q);
        if (text.includes("device_pending_stops")) return H.pendingDevices.map((id) => ({ robotId: id, adapterId: null }));
        return [];
      },
      transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };
  },
}));
vi.mock("./robotManager", () => ({
  getActiveRobot: () => ({ id: 7, driver: {} }),
  activeRobotIds: () => [],
  isCentralRobotGatewayOn: () => true,
  robotTriedAtStart: () => true,
  attachRobot: async () => true,
  detachRobot: async () => true,
}));
vi.mock("./robotCommandDispatcher", () => ({
  dispatchRobotJob: async (i: { robotId: number }) => {
    H.dispatched.push(i.robotId);
    return H.dispatchOk ? { ok: true, status: "done", jobId: H.dispatched.length } : { ok: false, status: "failed", error: "driver refused" };
  },
}));
vi.mock("../ot/otManager", () => ({ isOtGatewayOn: () => false, getActiveAdapter: () => undefined, otAdapterTriedAtStart: () => true }));
vi.mock("./criticalStopAlert", () => ({ raiseCriticalStopAlert: async (a: { message: string }) => void H.alerts.push(a.message) }));

import { sweepPendingCentralStops, executePendingCentralStops, _resetOwnershipReconcileForTests } from "./deviceOwnershipService";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  H.busy = true;
  H.pendingDevices = [7];
  H.dispatched.length = 0;
  H.dispatchOk = true;
  H.alerts.length = 0;
  _resetOwnershipReconcileForTests();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("R-11-k (4) — global sweep, device row busy: STOP every pass, alert once per lock episode", () => {
  it("★ three busy passes ⇒ three STOPs, ONE alert; a pass that gets the lock ends the episode; the next busy pass alerts again", async () => {
    for (let i = 0; i < 3; i++) {
      const out = await sweepPendingCentralStops();
      expect(out).toMatchObject([{ outcome: "done", sent: "sent" }]);
      await flush();
    }
    expect(H.dispatched).toEqual([7, 7, 7]); // the STOP is never skipped (L-7)
    expect(H.alerts).toHaveLength(1);
    expect(H.alerts[0]).toContain("busy");
    H.busy = false;
    await sweepPendingCentralStops(); // lock obtained (nothing pending in the fake) ⇒ the episode ends
    await flush();
    expect(H.dispatched).toEqual([7, 7, 7]);
    H.busy = true;
    await sweepPendingCentralStops();
    await flush();
    expect(H.dispatched).toEqual([7, 7, 7, 7]);
    expect(H.alerts).toHaveLength(2); // a new episode
  });

  it("★ the outcome changes within an episode (sent → failed) ⇒ alerted again; a device that leaves the pending set ends its episode", async () => {
    await sweepPendingCentralStops();
    await flush();
    H.dispatchOk = false;
    await sweepPendingCentralStops();
    await sweepPendingCentralStops();
    await flush();
    expect(H.dispatched).toEqual([7, 7, 7]);
    expect(H.alerts).toHaveLength(2);
    expect(H.alerts[1]).toContain("failed");
    H.pendingDevices = [];
    await sweepPendingCentralStops(); // no pending STOP for device 7 any more
    H.pendingDevices = [7];
    await sweepPendingCentralStops();
    await flush();
    expect(H.alerts).toHaveLength(3);
  });

  it("control: a NAMED device (transfer just made here) whose row is busy alerts every time (each transfer is its own event)", async () => {
    await executePendingCentralStops("robot", 7, 1);
    await executePendingCentralStops("robot", 7, 1);
    await flush();
    expect(H.dispatched).toEqual([7, 7]);
    expect(H.alerts).toHaveLength(2);
  });
});
