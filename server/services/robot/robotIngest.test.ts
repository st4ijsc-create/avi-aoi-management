/**
 * U3-live (doc 21 §6 / §3 G-5) — robot telemetry LIVE socket emit tests.
 *
 * Verifies the additive emit wired into ingestRobotState:
 *   • FIRES `emitRobotTelemetry` with the compact live UDM on every ingest (mock socket).
 *   • is ERROR-ISOLATED — a throwing socket emit does NOT break the persist path.
 *   • carries the decoded fields (mode/estop/battery/joints/status) into the payload.
 *
 * The DB + the other fire-and-forget hooks (field health / rebalance / safety audit /
 * anomaly scan) are mocked to no-ops so the test isolates the emit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RuntimeRobot } from "./robotAdapter";
import type { RobotState } from "./robotDriver";

// ── Mock the DB so persist is a deterministic no-op that resolves. ──
function terminalInsert() {
  return { values: async (_v: any) => undefined };
}
function terminalUpdate() {
  return { set: () => ({ where: async (_w: any) => undefined }) };
}
vi.mock("../../db/connection", () => ({
  getDb: async () => ({ insert: () => terminalInsert(), update: () => terminalUpdate() }),
}));
vi.mock("../../../drizzle/schema", async (orig) => {
  const mod: any = await (orig as any)();
  return mod;
});

// ── Mock the socket emit — the assertion target. ──
const emitRobotTelemetry = vi.fn();
vi.mock("../../_core/socket", () => ({ emitRobotTelemetry: (e: any) => emitRobotTelemetry(e) }));

// ── Stub the other fire-and-forget hooks so they are no-ops (not under test). ──
vi.mock("../field/fieldHealthService", () => ({ recordHeartbeat: async () => undefined }));
vi.mock("../fleet/taskAllocator", () => ({ rebalanceDeviceTasks: async () => undefined }));
vi.mock("../safety/safetyAuditService", () => ({ record: async () => undefined }));
vi.mock("../ai/robotBehaviorAnomalyService", () => ({ detectAndRaiseForRobot: async () => [] }));

import { ingestRobotState } from "./robotIngest";

const robot: RuntimeRobot = {
  id: 4,
  code: "R-4",
  vendor: "sim",
  connection: { endpoint: "sim://x" },
  pollIntervalMs: 5000,
  driver: {} as any,
};

function state(overrides: Partial<RobotState> = {}): RobotState {
  return {
    mode: "auto",
    busy: true,
    estop: false,
    pose: { cartesian: { x: 1, y: 2, z: 3 } },
    speedPct: 60,
    batteryPct: 77,
    jointStates: [{ p: 0.1 }],
    safetyZoneId: 2,
    firmwareVersion: "1.0.0",
    timestamp: new Date(1_700_000_000_000),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ingestRobotState — U3-live socket emit", () => {
  it("emits robot:telemetry with the compact live UDM on ingest", async () => {
    await ingestRobotState(robot, state());
    expect(emitRobotTelemetry).toHaveBeenCalledTimes(1);
    const payload = emitRobotTelemetry.mock.calls[0][0];
    expect(payload.robotId).toBe(4);
    expect(payload.robotCode).toBe("R-4");
    expect(payload.mode).toBe("auto");
    expect(payload.estop).toBe(false);
    expect(payload.batteryPct).toBe(77);
    expect(payload.jointStates).toEqual([{ p: 0.1 }]);
    expect(payload.status).toBe("busy"); // busy && !estop → "busy"
    expect(payload.ts).toBe(1_700_000_000_000);
  });

  it("reflects e-stop status in the emitted snapshot", async () => {
    await ingestRobotState(robot, state({ estop: true }));
    const payload = emitRobotTelemetry.mock.calls[0][0];
    expect(payload.estop).toBe(true);
    expect(payload.status).toBe("estop");
  });

  it("is error-isolated — a throwing emit does not break ingest", async () => {
    emitRobotTelemetry.mockImplementationOnce(() => {
      throw new Error("socket down");
    });
    // Must NOT throw out of ingest.
    await expect(ingestRobotState(robot, state())).resolves.toBeUndefined();
    expect(emitRobotTelemetry).toHaveBeenCalledTimes(1);
  });
});
