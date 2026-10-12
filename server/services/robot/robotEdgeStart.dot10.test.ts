/**
 * doc 81 Đợt 10 task D (design §2.11 / §2.12, re-review N2) — robots on an EDGE v2 gateway, with NO database:
 *   • startRobots({ configRobots }) — the node's owned robots from the signed config: no robot_jobs reconciliation, no DB load,
 *     no DB motion-lock load; robot state goes to the injected sink (journal → central ingest);
 *   • the motion lock is the edge AUTHORITY's: seeded (never backwards) and persisted through the injected journal sink
 *     (attachEdgeMotionLockPersistence), never robot_motion_locks; without a persistence the robot starts LOCKED persistUnknown.
 * The DB module is a trap: any getDb() fails the test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({ dbCalls: 0 }));
vi.mock("../../db/connection", () => ({
  getDb: async () => {
    H.dbCalls++;
    throw new Error("EDGE_DB_TRAP");
  },
  getJobsDb: async () => {
    H.dbCalls++;
    throw new Error("EDGE_DB_TRAP");
  },
}));

import { startRobots, stopRobots, getActiveRobot } from "./robotManager";
import { attachEdgeMotionLockPersistence } from "./robotMotionLockStore";
import { MotionLock, type MotionLockState, type RobotState } from "./robotDriver";
import type { RuntimeRobot } from "./robotAdapter";

function fakeRobot(id: number, states: RobotState[]): RuntimeRobot & { lock: MotionLock } {
  const lock = new MotionLock();
  return {
    id,
    code: `R${id}`,
    vendor: "sim",
    connection: { endpoint: "sim://x" },
    pollIntervalMs: 1000,
    lock,
    driver: {
      vendor: "sim",
      connect: async () => undefined,
      disconnect: async () => undefined,
      isConnected: () => true,
      motionLockController: () => lock,
      getMotionLock: () => lock.snapshot(),
      subscribeState: async (cb: (s: RobotState) => void) => {
        for (const s of states) cb(s);
        return { close: async () => undefined };
      },
    } as never,
  };
}

beforeEach(async () => {
  await stopRobots();
  H.dbCalls = 0;
  process.env.ROBOT_GATEWAY_ENABLED = "true";
});

describe("edge v2 robots — config-sourced, journal-backed lock, no DB", () => {
  it("★ startRobots({configRobots}) touches no DB; the lock persistence is the injected one; state goes to the sink", async () => {
    const st = { link: "connected", mode: "auto" } as unknown as RobotState;
    const r = fakeRobot(31, [st]);
    const events: Array<[string, MotionLockState]> = [];
    const sunk: Array<[number, RobotState]> = [];
    const ok = await startRobots({
      configRobots: [r],
      stateSink: (robot, s) => sunk.push([robot.id, s]),
      attachLock: (robot, lock) =>
        attachEdgeMotionLockPersistence(robot.id, lock, { locked: null, generationBase: 7 }, { locked: (s) => events.push(["locked", s]), cleared: (s) => events.push(["cleared", s]) }),
    });
    expect(ok).toBe(true);
    expect(getActiveRobot(31)).toBe(r);
    expect(sunk).toEqual([[31, st]]);
    expect(H.dbCalls).toBe(0);
    r.lock.lock("motion_outcome_unknown");
    expect(r.lock.snapshot().generation).toBe(8); // seeded base 7 ⇒ the next lock is 8 (never backwards)
    r.lock.clearByStop();
    expect(events.map(([k, s]) => [k, s.generation])).toEqual([["locked", 8], ["cleared", 8]]);
    expect(H.dbCalls).toBe(0);
  });

  it("★ no persistence supplied ⇒ the robot starts LOCKED persistUnknown (fail-closed)", async () => {
    const r = fakeRobot(32, []);
    await startRobots({ configRobots: [r] });
    expect(r.lock.snapshot()).toMatchObject({ locked: true, reasonCode: "persistUnknown" });
    expect(H.dbCalls).toBe(0);
  });

  it("a seed that says locked (journal / ownerChanged) ⇒ restored LOCKED at its generation; `announce` reports it once", async () => {
    const l = new MotionLock();
    const events: string[] = [];
    const out = attachEdgeMotionLockPersistence(
      33,
      l,
      { locked: { reasonCode: "ownerChanged", since: "2026-10-12T00:00:00.000Z", generation: 9 }, generationBase: 9 },
      { locked: (s) => events.push(`locked:${s.generation}`), cleared: (s) => events.push(`cleared:${s.generation}`) },
      { announce: true },
    );
    expect(out).toBe("restored");
    expect(l.snapshot()).toMatchObject({ locked: true, reasonCode: "ownerChanged", generation: 9 });
    expect(events).toEqual(["locked:9"]);
    l.clearByOperator({ reason: "r", userId: 1, expectedGeneration: 9 });
    expect(events).toEqual(["locked:9", "cleared:9"]);
  });
});
