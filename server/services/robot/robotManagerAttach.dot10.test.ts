/**
 * doc 81 Đợt 10 task D fix review 2 — R-10-al / N5: central's live attach works whatever startRobots loaded (0 central robots at
 * cutover, a failed load), and two concurrent attaches of one robot open ONE session (the loser never leaks a connection).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({ load: [] as any[], loadFails: false, connects: 0, disconnects: 0 }));
vi.mock("./robotCommandDispatcher", () => ({ reconcileOrphanedRobotJobs: async () => 0, orphanedRunningThresholdMs: () => 60_000 }));
vi.mock("./robotAdapter", () => ({
  loadEnabledRobots: async () => {
    if (H.loadFails) throw new Error("load failed");
    return H.load;
  },
}));
vi.mock("./robotMotionLockStore", () => ({ attachMotionLockPersistence: () => "none", loadMotionLocks: async () => ({ ok: true, rows: new Map() }) }));
vi.mock("./robotIngest", () => ({ ingestRobotState: () => undefined }));

import { startRobots, stopRobots, attachRobot, activeRobotIds, isCentralRobotGatewayOn } from "./robotManager";

const robot = (id: number) => ({
  id,
  code: `R${id}`,
  vendor: "sim",
  connection: { endpoint: "sim://x" },
  pollIntervalMs: 1000,
  driver: {
    connect: async () => {
      H.connects++;
      await new Promise((r) => setTimeout(r, 30));
    },
    disconnect: async () => void H.disconnects++,
    subscribeState: async () => ({ close: async () => undefined }),
  },
});

beforeEach(async () => {
  await stopRobots();
  H.load = [];
  H.loadFails = false;
  H.connects = 0;
  H.disconnects = 0;
  process.env.ROBOT_GATEWAY_ENABLED = "true";
});

describe("R-10-al / N5 — live attach", () => {
  it("★ startRobots found 0 central robots (cutover) ⇒ a robot moved to central later is attached live", async () => {
    expect(await startRobots()).toBe(false);
    expect(isCentralRobotGatewayOn()).toBe(true);
    H.load = [robot(5)];
    expect(await attachRobot(5)).toBe(true);
    expect(activeRobotIds()).toEqual([5]);
  });

  it("★ startRobots' load FAILED ⇒ attach still works later", async () => {
    H.loadFails = true;
    expect(await startRobots()).toBe(false);
    H.loadFails = false;
    H.load = [robot(6)];
    expect(await attachRobot(6)).toBe(true);
  });

  it("★ N5 — two concurrent attaches of one robot ⇒ ONE session (one connect), nothing leaked", async () => {
    await startRobots();
    H.load = [robot(7)];
    // the first attach is still inside connect when the second starts (the in-process change + this process's own NOTIFY)
    const first = attachRobot(7);
    await new Promise((r) => setTimeout(r, 5));
    const second = attachRobot(7);
    const [x, y] = await Promise.all([first, second]);
    expect([x, y]).toEqual([true, false]);
    expect(H.connects).toBe(1); // the second never opened a session
    expect(H.disconnects).toBe(0);
    expect(activeRobotIds()).toEqual([7]);
  });
});
