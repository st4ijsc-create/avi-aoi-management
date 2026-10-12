/**
 * doc 81 Đợt 10 task D fix review 2 — the fallbacks of the ownership / STOP service, with a fake DB:
 *   • R-10-ak (N2): the transient STOP's robot-row read is bounded by the STOP bound — a HUNG DB answers `failed` within it;
 *   • N4: a device-scoped execution whose pending set cannot be read still SENDS the STOP and raises an alert;
 *   • R-10-al / N6: the sync LISTENs FIRST (bounded — a hung LISTEN does not block it) and only then runs the first reconcile;
 *     a central robot startRobots never tried (moved to central before the first pass) is attached by that first pass.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  mode: "ok" as "ok" | "hang" | "txfail",
  order: [] as string[],
  listen: "ok" as "ok" | "hang",
  robots: [] as Array<{ id: number; edgeNodeId: number | null; ownerEpoch: number }>,
  active: false,
  dispatched: [] as number[],
  attached: [] as number[],
  alerts: [] as string[],
}));
vi.mock("../../db/connection", () => ({
  isEdgeProcessRole: () => false,
  getDb: async () => {
    if (H.mode === "hang") return new Promise(() => undefined);
    return {
      $client: {
        listen: async () => {
          H.order.push("listen");
          if (H.listen === "hang") return new Promise(() => undefined);
          return { unlisten: async () => undefined };
        },
      },
      execute: async (q: unknown) => {
        const text = JSON.stringify((q as { queryChunks?: unknown }).queryChunks ?? q);
        H.order.push(text.includes("device_pending_stops") ? "sweep" : "reconcile");
        return text.includes("device_adapters") ? [] : text.includes("device_pending_stops") ? [] : H.robots;
      },
      transaction: async () => {
        throw new Error("simulated BEGIN failure");
      },
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    };
  },
}));
vi.mock("./robotManager", () => ({
  getActiveRobot: () => (H.active ? { id: 7, driver: {} } : undefined),
  activeRobotIds: () => [],
  isCentralRobotGatewayOn: () => true,
  robotTriedAtStart: (id: number) => id === 2,
  attachRobot: async (id: number) => (H.attached.push(id), true),
  detachRobot: async () => true,
}));
vi.mock("./robotCommandDispatcher", () => ({
  dispatchRobotJob: async (i: { robotId: number }) => (H.dispatched.push(i.robotId), { ok: true, status: "done", jobId: 1 }),
}));
vi.mock("../ot/otManager", () => ({ isOtGatewayOn: () => false, getActiveAdapter: () => undefined, otAdapterTriedAtStart: () => true }));
vi.mock("./criticalStopAlert", () => ({ raiseCriticalStopAlert: async (a: { message: string }) => void H.alerts.push(a.message) }));

import { executePendingCentralStops, sendCentralRobotStop, startDeviceOwnershipSync, _resetOwnershipReconcileForTests } from "./deviceOwnershipService";
import { STOP_DB_STEP_DEADLINE_MS } from "./stopJob";

beforeEach(() => {
  H.mode = "ok";
  H.order.length = 0;
  H.listen = "ok";
  H.robots = [];
  H.active = false;
  H.dispatched.length = 0;
  H.attached.length = 0;
  H.alerts.length = 0;
  _resetOwnershipReconcileForTests();
  process.env.ROBOT_CONTROL_ENABLED = "true";
});

describe("R-10-ak / N4 — no wait before a STOP longer than the STOP bound", () => {
  it("★ a HUNG DB: the transient STOP's robot-row read answers `failed` within the STOP bound (explicit bound)", async () => {
    H.mode = "hang";
    const t0 = Date.now();
    const r = await Promise.race([sendCentralRobotStop(9), new Promise<"HUNG">((x) => setTimeout(() => x("HUNG"), STOP_DB_STEP_DEADLINE_MS + 1500))]);
    expect(r).not.toBe("HUNG");
    expect(r).toMatchObject({ ok: false, sent: "failed" });
    expect(Date.now() - t0).toBeLessThan(STOP_DB_STEP_DEADLINE_MS + 700);
  });

  it("★ N4 — a device-scoped execution whose pending set cannot be read (BEGIN fails) still SENDS the STOP and alerts", async () => {
    H.mode = "txfail";
    H.active = true; // central holds a session ⇒ the STOP goes through the dispatcher
    const r = await executePendingCentralStops("robot", 7, 3);
    expect(H.dispatched).toEqual([7]);
    expect(r).toMatchObject({ requestIds: [], outcome: "done", sent: "sent" });
    await new Promise((x) => setTimeout(x, 20));
    expect(H.alerts.join("\n")).toMatch(/could not be read\/locked/);
  });
});

describe("R-10-al / N6 — LISTEN first, then the first reconcile; bounded; untried central robots attached", () => {
  it("★ LISTEN is registered BEFORE the first reconcile; the first pass attaches a central robot startRobots never tried (not one it tried)", async () => {
    H.robots = [
      { id: 1, edgeNodeId: null, ownerEpoch: 2 }, // moved to central before the first pass — never tried by startRobots
      { id: 2, edgeNodeId: null, ownerEpoch: 1 }, // tried at start (failed connect) — not retried by the reconcile
      { id: 3, edgeNodeId: 4, ownerEpoch: 1 }, // edge-owned
    ];
    const stop = await startDeviceOwnershipSync();
    const t0 = Date.now();
    while (H.attached.length === 0 && Date.now() - t0 < 2_000) await new Promise((x) => setTimeout(x, 10));
    await stop();
    expect(H.order[0]).toBe("listen");
    expect(H.order.indexOf("reconcile")).toBeGreaterThan(0);
    expect(H.attached).toEqual([1]);
  });

  it("★ N6 — a HUNG LISTEN is bounded: the sync still starts (reconcile runs) after the deadline", async () => {
    H.listen = "hang";
    const t0 = Date.now();
    const stop = await startDeviceOwnershipSync({ listenDeadlineMs: 150 });
    expect(Date.now() - t0).toBeLessThan(1_000);
    await new Promise((x) => setTimeout(x, 20));
    await stop();
    expect(H.order).toContain("reconcile");
  });
});
