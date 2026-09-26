/**
 * doc 56 Đ6 — handler unit tests for the device-standardization persona tools
 * (get_device_health, get_fleet_process_summary). Same strategy as handlersF6:
 * mock getDb + the db/* helpers + the config-sync shadow; exercise the handler
 * logic + Vietnamese textSummary on seeded data (real processSpc + deviceClassOf).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ★★★ G3-A — HAI TOOL NÀY NAY ĐỨNG SAU `machine_status/canView` (trước đây KHÔNG có cổng nào).
 * Bộ ca cũ gọi thẳng `handler(...)` không kèm danh tính ⇒ nay bị TỪ CHỌI, đúng như thiết kế.
 * Ở đây ta cấp một danh tính hợp lệ + mở cổng để **giữ nguyên** ý định của từng ca (kiểm logic dữ
 * liệu), và thêm ca riêng ở cuối file để kiểm **chính cái cổng**.
 */
type ChiSoQuyen = [userId: number, role: string, moduleName: string, action: string];
const checkPermissionMock = vi.fn(async (..._a: ChiSoQuyen) => true);
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: ChiSoQuyen) => checkPermissionMock(...a),
}));
const AUTH_TEST = { userId: 7, role: "engineer" };

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
  checkPermissionMock.mockReset();
  checkPermissionMock.mockResolvedValue(true as never);
});

describe("get_device_health (doc 56 Đ6)", () => {
  it("is a READ tool đứng sau MỘT CỔNG XEM (G3-A: trước đây KHÔNG có cổng nào)", () => {
    expect(getDeviceHealth.kind ?? "read").toBe("read");
    expect((getDeviceHealth as any).execute).toBeUndefined();
    expect((getDeviceHealth as any).preview).toBeUndefined();
    // ⚠ ĐÍNH CHÍNH: dòng cũ khẳng định `requiredPermission` phải VẮNG — đó chính là lỗ G3-A đóng.
    expect((getDeviceHealth as any).requiredPermission).toEqual({ module: "machine_status", action: "canView" });
    expect((getFleetProcessSummary as any).requiredPermission).toEqual({ module: "machine_status", action: "canView" });
  });

  it("★★★ G3-A — KHÔNG danh tính ⇒ TỪ CHỐI TRUNG THỰC, và KHÔNG chạm CSDL", async () => {
    getDbMock.mockResolvedValue(fakeDb([{ id: 1, machineType: "SCREWDRIVER" }]));
    checkPermissionMock.mockClear();
    for (const t of [getDeviceHealth, getFleetProcessSummary]) {
      const r: any = await (t.handler as any)({ machineCode: "SCRW-01", days: 7 });
      expect(r.note).toBe("PERMISSION_DENIED");
      expect(r.textSummary).toContain("machine_status/canView");
      expect(r.textSummary).not.toMatch(/không có dữ liệu|chưa có dữ liệu/i);
    }
    // Danh tính vắng ⇒ KHÔNG hỏi cổng bằng một danh tính bịa, và KHÔNG mở kết nối.
    expect(checkPermissionMock).not.toHaveBeenCalled();
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("★★★ G3-A — cổng TỪ CHỐI ⇒ tool từ chối, dù danh tính hợp lệ", async () => {
    getDbMock.mockResolvedValue(fakeDb([{ id: 1, machineType: "SCREWDRIVER" }]));
    checkPermissionMock.mockResolvedValueOnce(false as never);
    const r: any = await (getDeviceHealth.handler as any)({ machineCode: "SCRW-01", days: 7, __authCtx: AUTH_TEST });
    expect(r.note).toBe("PERMISSION_DENIED");
    expect(checkPermissionMock).toHaveBeenCalledWith(7, "engineer", "machine_status", "canView");
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("noDbResult when getDb() is null", async () => {
    getDbMock.mockResolvedValue(null);
    const r = await getDeviceHealth.handler!({ __authCtx: AUTH_TEST, machineCode: "SCRW-01", days: 7 });
    expect(r.note).toBe("DB_UNAVAILABLE");
    expect(r.data.process.total).toBe(0);
  });

  it("NOT_FOUND when the machine code does not resolve", async () => {
    getDbMock.mockResolvedValue(fakeDb([]));
    const r = await getDeviceHealth.handler!({ __authCtx: AUTH_TEST, machineCode: "NOPE", days: 7 });
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

    const r = await getDeviceHealth.handler!({ __authCtx: AUTH_TEST, machineCode: "SCRW-SIM-01", days: 7 });
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
    const r = await getFleetProcessSummary.handler!({ __authCtx: AUTH_TEST, days: 7 });
    expect(r.note).toBe("DB_UNAVAILABLE");
  });

  it("rolls up by machineType, tags deviceClass, computes FPY + totals", async () => {
    getDbMock.mockResolvedValue(fakeDb([]));
    aggregateProcessResultStatsByType.mockResolvedValue([
      { machineType: "SCREWDRIVE", pass: 90, fail: 10, warn: 0, skip: 0, total: 100 },
      { machineType: "AOI", pass: 45, fail: 5, warn: 0, skip: 0, total: 50 },
    ]);
    const r = await getFleetProcessSummary.handler!({ __authCtx: AUTH_TEST, days: 7 });
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
    const r = await getFleetProcessSummary.handler!({ __authCtx: AUTH_TEST, days: 7, deviceClass: "automation" });
    expect(r.data.groups).toHaveLength(1);
    expect(r.data.groups[0].machineType).toBe("SCREWDRIVE");
    expect(r.data.deviceClass).toBe("automation");
  });
});
