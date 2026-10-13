/**
 * doc 81 Đợt 10 task D fix review 4 — rulings R-10-au / R-10-az: the CONTRACT of the edge's per-robot lifecycle, as E calls it.
 *   • attachEdgeRobot(verifiedConfigRow, extras?) ⇒ { ok, reason? } — robotManager builds the driver + RuntimeRobot from the row;
 *     the lock is attached FIRST (E's attachLock: journal / config seed), else the robot starts LOCKED persistUnknown;
 *   • a robot that never connects is cut at its bound and BACKS OFF (a re-attach inside the window touches nothing); a healthy
 *     robot attached at the same time is neither delayed nor disturbed;
 *   • detachEdgeRobot(id) ⇒ { ok:false, reason:"not_locked" } unless locked; locked ⇒ { ok:true }, session closed. Never throws.
 * No DB (the edge): any getDb() fails the test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const D = vi.hoisted(() => ({ built: [] as string[], connects: new Map<number, number>(), disconnects: [] as number[], locks: new Map<number, unknown>() }));
vi.mock("../../db/connection", () => ({
  getDb: async () => {
    throw new Error("EDGE_DB_TRAP");
  },
}));
vi.mock("./driverRegistry", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./driverRegistry")>();
  const { MotionLock } = await import("./robotDriver");
  return {
    ...orig,
    // the driver robotManager builds from the row: "hang://" never connects, anything else connects at once
    createRobotDriver: (vendor: string) => {
      D.built.push(vendor);
      const lock = new MotionLock();
      let id = -1;
      return {
        vendor,
        connect: (c: { endpoint: string }) => {
          id = Number(c.endpoint.split("#")[1]);
          D.locks.set(id, lock);
          D.connects.set(id, (D.connects.get(id) ?? 0) + 1);
          return c.endpoint.startsWith("hang://") ? new Promise<void>(() => undefined) : Promise.resolve();
        },
        disconnect: async () => void D.disconnects.push(id),
        isConnected: () => true,
        motionLockController: () => lock,
        getMotionLock: () => lock.snapshot(),
        subscribeState: async () => ({ close: async () => undefined }),
        runJob: async () => ({ ok: true }),
      };
    },
  };
});

import { startRobots, stopRobots, attachEdgeRobot, detachEdgeRobot, activeRobotIds, getActiveRobot, _setEdgeRobotConnectDeadlineMsForTests, _setEdgeRobotBackoffBaseMsForTests, type EdgeRobotConfigRow } from "./robotManager";
import type { MotionLock } from "./robotDriver";

const row = (id: number, endpoint = `sim://ok#${id}`): EdgeRobotConfigRow => ({
  id,
  code: `E${id}`,
  name: `edge robot ${id}`,
  vendor: "sim",
  model: null,
  kind: "arm",
  endpoint,
  connectionOptions: null,
  pollIntervalMs: 1000,
  isEnabled: true,
  commissioned: true,
  lineId: 1,
  stationId: null,
  motionLock: null,
  motionLockGenerationFloor: 0,
});
const seeded: number[] = [];
const startSeeded: number[] = [];
const extras = { attachLock: (r: { id: number }, lock: MotionLock) => void (seeded.push(r.id), lock.restore({ reasonCode: "ownerChanged", detail: "seeded from the journal", since: new Date().toISOString(), generation: 1 })), stateSink: () => undefined };

beforeEach(async () => {
  await stopRobots();
  D.built = [];
  D.connects.clear();
  D.disconnects = [];
  seeded.length = 0;
  startSeeded.length = 0;
  process.env.ROBOT_GATEWAY_ENABLED = "true";
  _setEdgeRobotConnectDeadlineMsForTests(150);
  _setEdgeRobotBackoffBaseMsForTests(300);
  await startRobots({ configRobots: [], attachLock: (r) => void startSeeded.push(r.id), stateSink: extras.stateSink }); // the edge start (0 robots yet)
});

describe("R-10-az — attachEdgeRobot / detachEdgeRobot contract", () => {
  it("★ attach from a VERIFIED config row: robotManager builds the driver, the lock is seeded FIRST (starts locked), the session is active", async () => {
    expect(await attachEdgeRobot(row(1), extras)).toEqual({ ok: true });
    expect(D.built).toEqual(["sim"]);
    expect(seeded).toEqual([1]); // the extras E passed with THIS attach, not the start's
    expect(startSeeded).toEqual([]);
    expect(activeRobotIds()).toEqual([1]);
    expect(getActiveRobot(1)?.driver.getMotionLock?.()).toMatchObject({ locked: true, reasonCode: "ownerChanged" });
    expect(await attachEdgeRobot(row(1), extras)).toEqual({ ok: false, reason: "already_active" });
  });

  it("★ attach with NO lock persistence anywhere ⇒ the robot starts LOCKED persistUnknown (fail-closed)", async () => {
    await stopRobots();
    await startRobots({ configRobots: [] }); // an edge start without attachLock
    expect((await attachEdgeRobot(row(2))).ok).toBe(true);
    expect(getActiveRobot(2)?.driver.getMotionLock?.()).toMatchObject({ locked: true, reasonCode: "persistUnknown" });
  });

  it("★ detach is REFUSED while unlocked; ok once locked (session closed); never throws", async () => {
    await attachEdgeRobot(row(3), extras);
    const lock = D.locks.get(3) as MotionLock;
    lock.clearByStop(); // a successful STOP clears the lock
    expect(await detachEdgeRobot(3)).toEqual({ ok: false, reason: "not_locked" });
    expect(activeRobotIds()).toEqual([3]);
    lock.lock("ownerChanged", "E holds it after the STOP");
    expect(await detachEdgeRobot(3)).toEqual({ ok: true });
    expect(activeRobotIds()).toEqual([]);
    expect(D.disconnects).toContain(3);
    expect(await detachEdgeRobot(3)).toEqual({ ok: false, reason: "not_active" });
    await expect(detachEdgeRobot(Number.NaN)).resolves.toMatchObject({ ok: false });
  });

  it("★ a robot that never connects does not disturb a healthy one; it BACKS OFF (a re-attach inside the window touches nothing)", async () => {
    const t0 = Date.now();
    const bad = attachEdgeRobot(row(4, "hang://x#4"), extras);
    const good = attachEdgeRobot(row(5), extras);
    expect(await good).toEqual({ ok: true });
    expect(Date.now() - t0).toBeLessThan(100); // not behind the hanging one
    expect(await bad).toEqual({ ok: false, reason: "connect_failed" });
    expect(activeRobotIds()).toEqual([5]);
    expect(await attachEdgeRobot(row(4, "hang://x#4"), extras)).toMatchObject({ ok: false, reason: "backoff" });
    expect(D.connects.get(4)).toBe(1); // the back-off did not touch the device
    await new Promise((r) => setTimeout(r, 320));
    expect(await attachEdgeRobot(row(4, "hang://x#4"), extras)).toEqual({ ok: false, reason: "connect_failed" });
    expect(D.connects.get(4)).toBe(2);
    expect(activeRobotIds()).toEqual([5]); // the healthy one is untouched throughout
  });

  it("the edge start: one robot that never connects is cut at its bound; the others start", async () => {
    await stopRobots();
    const { runtimeRobotsFromConfig } = await import("./robotAdapter");
    const t0 = Date.now();
    expect(await startRobots({ configRobots: runtimeRobotsFromConfig([row(6, "hang://x#6"), row(7), row(8)] as never), ...extras })).toBe(true);
    expect(Date.now() - t0).toBeLessThan(600);
    expect(activeRobotIds().sort()).toEqual([7, 8]);
  });

  it("not an edge gateway (no edge start, no extras) or after stopRobots ⇒ refused, nothing built", async () => {
    await stopRobots();
    expect(await attachEdgeRobot(row(9))).toEqual({ ok: false, reason: "not_edge" });
    expect(D.built).toEqual([]);
  });
});
