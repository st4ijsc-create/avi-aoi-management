/**
 * doc 81 Đợt 9 final wave F1 (final review I1) — ONE ingest owner per robot. Central (startRobots() — no options) ingests robot
 * state as before; an EDGE (startRobots({ scope, ingest: false })) connects and polls its drivers (the dispatcher and the
 * driver's link supervision need them) but records NOTHING: no robot_telemetry, no trusted e-stop safety_event — so a physical
 * e-stop is never ingested twice (central + edge). The scope reaches the loader unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ ingested: [] as Array<{ robotId: number; state: unknown }>, scopes: [] as unknown[] }));
vi.mock("./robotCommandDispatcher", () => ({ reconcileOrphanedRobotJobs: vi.fn(async () => 0), orphanedRunningThresholdMs: () => 80_000 }));
vi.mock("./robotIngest", () => ({ ingestRobotState: vi.fn(async (robot: { id: number }, state: unknown) => void h.ingested.push({ robotId: robot.id, state })) }));
vi.mock("./robotMotionLockStore", () => ({ loadMotionLocks: async () => ({ ok: true, rows: new Map() }), attachMotionLockPersistence: () => "none" }));
vi.mock("./robotAdapter", () => ({
  loadEnabledRobots: vi.fn(async (scope?: unknown) => {
    h.scopes.push(scope);
    return [
      {
        id: 41,
        code: "R41",
        vendor: "sim",
        connection: { endpoint: "sim://x" },
        pollIntervalMs: 1000,
        driver: {
          connect: async () => undefined,
          disconnect: async () => undefined,
          // the driver polls and hands every state to the callback (an e-stop among them)
          subscribeState: async (cb: (s: unknown) => void) => {
            cb({ mode: "auto", estop: true });
            return { close: async () => undefined };
          },
        },
      },
    ];
  }),
}));

const saved = process.env.ROBOT_GATEWAY_ENABLED;
beforeEach(() => {
  vi.resetModules();
  h.ingested.length = 0;
  h.scopes.length = 0;
  process.env.ROBOT_GATEWAY_ENABLED = "true";
});
afterEach(() => {
  if (saved === undefined) delete process.env.ROBOT_GATEWAY_ENABLED;
  else process.env.ROBOT_GATEWAY_ENABLED = saved;
});

describe("final wave F1 — robot state ingest has ONE owner (central XOR edge)", () => {
  it("central (no options): every state is ingested, as before", async () => {
    const { startRobots, stopRobots } = await import("./robotManager");
    expect(await startRobots()).toBe(true);
    expect(h.scopes).toEqual([undefined]);
    expect(h.ingested).toEqual([{ robotId: 41, state: { mode: "auto", estop: true } }]);
    await stopRobots();
  });

  it("★ edge (scope + ingest off): the driver is connected and polled, the scope reaches the loader, NOTHING is ingested (the e-stop is central's to record)", async () => {
    const { startRobots, getActiveRobot, stopRobots } = await import("./robotManager");
    const scope = { lineCodes: ["L1"], factoryCode: "F1" };
    expect(await startRobots({ scope, ingest: false })).toBe(true);
    expect(h.scopes).toEqual([scope]);
    expect(getActiveRobot(41)).toBeDefined(); // the edge's dispatchers can reach it
    expect(h.ingested).toEqual([]);
    await stopRobots();
  });
});
