/**
 * doc 81 Đợt 5 task F fix scan (R-5-h) — robotIngest's e-stop TRANSITION is recorded through the device-ingest door
 * (safetyAuditService.recordFromDeviceIngest, server-derived trusted origin) ONLY for a robot whose controller the server
 * itself polls (TRUSTED_ROBOT_TELEMETRY_VENDORS: fanuc, mitsubishi, techman). sim, the delta mock, the UR(sim) bridge and
 * VDA 5050 (state over MQTT) record a plain advisory event. Oracle: the mocked audit service records which door was used.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RuntimeRobot } from "./robotAdapter";
import type { RobotState } from "./robotDriver";

vi.mock("../../db/connection", () => ({
  getDb: async () => ({
    insert: () => ({ values: async () => undefined }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }),
}));
vi.mock("../../_core/socket", () => ({ emitRobotTelemetry: () => undefined }));
vi.mock("../field/fieldHealthService", () => ({ recordHeartbeat: async () => undefined }));
vi.mock("../fleet/taskAllocator", () => ({ rebalanceDeviceTasks: async () => undefined }));
vi.mock("../ai/robotBehaviorAnomalyService", () => ({ detectAndRaiseForRobot: async () => [] }));
const A = vi.hoisted(() => ({ calls: [] as Array<{ door: string; origin?: string; input: Record<string, unknown> }> }));
vi.mock("../safety/safetyAuditService", () => ({
  record: async (input: Record<string, unknown>) => void A.calls.push({ door: "record", input }),
  recordFromDeviceIngest: async (origin: string, input: Record<string, unknown>) => void A.calls.push({ door: "device", origin, input }),
}));

import { ingestRobotState } from "./robotIngest";

let nextId = 500;
const robotOf = (vendor: string): RuntimeRobot =>
  ({ id: nextId++, code: `R-${vendor}`, vendor, connection: { endpoint: "tcp://192.0.2.1:1" }, pollIntervalMs: 5000, driver: {} }) as unknown as RuntimeRobot;
const state = (estop: boolean): RobotState => ({ mode: "auto", busy: false, estop, timestamp: new Date() }) as RobotState;
async function until(cond: () => boolean, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 5));
  }
  return true;
}

beforeEach(() => {
  A.calls.length = 0;
});

describe("Đợt 5 F fix scan — robot e-stop transition: trusted door only for server-polled real controllers", () => {
  it.each(["fanuc", "mitsubishi", "techman"])("%s ⇒ recordFromDeviceIngest('robot_telemetry', estop)", async (vendor) => {
    const r = robotOf(vendor);
    await ingestRobotState(r, state(false));
    await ingestRobotState(r, state(true));
    expect(await until(() => A.calls.length === 1, 1500)).toBe(true);
    expect(A.calls[0]).toMatchObject({ door: "device", origin: "robot_telemetry", input: { eventType: "estop", robotId: r.id } });
  });

  it.each(["sim", "vda5050", "delta", "ur"])("%s ⇒ plain record() (never the trusted door)", async (vendor) => {
    const r = robotOf(vendor);
    await ingestRobotState(r, state(false));
    await ingestRobotState(r, state(true));
    expect(await until(() => A.calls.length === 1, 1500)).toBe(true);
    expect(A.calls[0]).toMatchObject({ door: "record", input: { eventType: "estop" } });
  });
});
