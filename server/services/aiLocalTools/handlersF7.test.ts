/**
 * doc 56 Đ6 — handler unit tests for the device-standardization persona tools
 * (get_device_health, get_fleet_process_summary). Same strategy as handlersF6:
 * mock getDb + the db/* helpers + the config-sync shadow; exercise the handler
 * logic + Vietnamese textSummary on seeded data (real processSpc + deviceClassOf).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getDbMock = vi.fn();
vi.mock("../../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...a) }));

const aggregateProcessResultStats = vi.fn();
const aggregateProcessResultStatsByType = vi.fn();
const getProcessMetricPoints = vi.fn();
const listProcessResultsByMachine = vi.fn();
vi.mock("../../db/processResult", () => ({
  aggregateProcessResultStats: (...a: unknown[]) => aggregateProcessResultStats(...a),
  aggregateProcessResultStatsByType: (...a: unknown[]) => aggregateProcessResultStatsByType(...a),
  getProcessMetricPoints: (...a: unknown[]) => getProcessMetricPoints(...a),
  listProcessResultsByMachine: (...a: unknown[]) => listProcessResultsByMachine(...a),
}));

const readConfigState = vi.fn();
vi.mock("../configDriftService", () => ({ readConfigState: (...a: unknown[]) => readConfigState(...a) }));

vi.mock("../../../drizzle/schema", () => ({
  machines: { code: { __c: "code" }, machineType: { __c: "machineType" }, id: { __c: "id" } },
}));

import { getDeviceHealth, getFleetProcessSummary } from "./handlersF7";

function fakeDb(machineRows: any[]) {
  return { select: () => ({ from: () => ({ where: () => ({ limit: async () => machineRows }) }) }) };
}
const stableTorque = Array.from({ length: 8 }, (_, i) => ({ value: 12 + (i % 2 ? 0.05 : -0.05), measuredAt: new Date(2026, 6, 18, 0, 0, i) }));

beforeEach(() => {
  getDbMock.mockReset();
  aggregateProcessResultStats.mockReset();
  aggregateProcessResultStatsByType.mockReset();
  getProcessMetricPoints.mockReset();
  listProcessResultsByMachine.mockReset();
  readConfigState.mockReset();
});

describe("get_device_health (doc 56 Đ6)", () => {
  it("is a READ tool (no write/execute/permission)", () => {
    expect(getDeviceHealth.kind ?? "read").toBe("read");
    expect((getDeviceHealth as any).execute).toBeUndefined();
    expect((getDeviceHealth as any).requiredPermission).toBeUndefined();
  });

  it("noDbResult when getDb() is null", async () => {
    getDbMock.mockResolvedValue(null);
    const r = await getDeviceHealth.handler({ machineCode: "SCRW-01", days: 7 });
    expect(r.note).toBe("DB_UNAVAILABLE");
    expect(r.data.process.total).toBe(0);
  });

  it("NOT_FOUND when the machine code does not resolve", async () => {
    getDbMock.mockResolvedValue(fakeDb([]));
    const r = await getDeviceHealth.handler({ machineCode: "NOPE", days: 7 });
    expect(r.note).toBe("NOT_FOUND");
  });

  it("assembles process + drift + SPC for an automation machine", async () => {
    getDbMock.mockResolvedValue(fakeDb([{ id: 243, machineType: "SCREWDRIVE" }]));
    aggregateProcessResultStats.mockResolvedValue({ pass: 8, fail: 2, warn: 0, skip: 0 });
    listProcessResultsByMachine.mockResolvedValue([{ measuredAt: new Date(2026, 6, 18, 3), metrics: { torque: 12.1 } }]);
    getProcessMetricPoints.mockResolvedValue(stableTorque);
    readConfigState.mockImplementation(async (_id: number, kind: string) =>
      kind === "recipe" ? { driftState: "drift", desiredChecksum: "aaa", reportedChecksum: "bbb" } : { driftState: "in_sync" },
    );

    const r = await getDeviceHealth.handler({ machineCode: "SCRW-SIM-01", days: 7 });
    expect(r.type).toBe("device_health");
    expect(r.data.machineType).toBe("SCREWDRIVE");
    expect(r.data.deviceClass).toBe("automation");
    expect(r.data.process.fpy).toBeCloseTo(80, 5); // 8/(8+2+0)
    expect(r.data.configDrift).toEqual({ configKind: "recipe", state: "drift" });
    expect(r.data.spc?.metricKey).toBe("torque"); // inferred from latest row
    expect(r.data.spc?.ok).toBe(true);
    expect(r.data.spc?.cl).not.toBeNull();
    expect(r.textSummary).toContain("LỆCH");
    // primary metric was inferred (no metricKey passed) → helper called with torque
    expect(getProcessMetricPoints).toHaveBeenCalledWith(expect.objectContaining({ metricKey: "torque", machineId: 243 }));
  });
});

describe("get_fleet_process_summary (doc 56 Đ6)", () => {
  it("noDbResult when getDb() is null", async () => {
    getDbMock.mockResolvedValue(null);
    const r = await getFleetProcessSummary.handler({ days: 7 });
    expect(r.note).toBe("DB_UNAVAILABLE");
  });

  it("rolls up by machineType, tags deviceClass, computes FPY + totals", async () => {
    getDbMock.mockResolvedValue(fakeDb([]));
    aggregateProcessResultStatsByType.mockResolvedValue([
      { machineType: "SCREWDRIVE", pass: 90, fail: 10, warn: 0, skip: 0, total: 100 },
      { machineType: "AOI", pass: 45, fail: 5, warn: 0, skip: 0, total: 50 },
    ]);
    const r = await getFleetProcessSummary.handler({ days: 7 });
    expect(r.type).toBe("fleet_process_summary");
    expect(r.data.groups).toHaveLength(2);
    const screw = r.data.groups.find((g) => g.machineType === "SCREWDRIVE")!;
    expect(screw.deviceClass).toBe("automation");
    expect(screw.fpy).toBeCloseTo(90, 5);
    expect(r.data.totals.total).toBe(150);
    expect(r.data.totals.fpy).toBeCloseTo(90, 5); // (90+45)/(150)
  });

  it("filters to a single deviceClass when requested", async () => {
    getDbMock.mockResolvedValue(fakeDb([]));
    aggregateProcessResultStatsByType.mockResolvedValue([
      { machineType: "SCREWDRIVE", pass: 90, fail: 10, warn: 0, skip: 0, total: 100 },
      { machineType: "AOI", pass: 45, fail: 5, warn: 0, skip: 0, total: 50 },
    ]);
    const r = await getFleetProcessSummary.handler({ days: 7, deviceClass: "automation" });
    expect(r.data.groups).toHaveLength(1);
    expect(r.data.groups[0].machineType).toBe("SCREWDRIVE");
    expect(r.data.deviceClass).toBe("automation");
  });
});
