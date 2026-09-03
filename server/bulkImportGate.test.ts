/**
 * Doc 31 B.6 (WB-3) — bulk-import limit write-back gate.
 *
 * data.importMeasurementPoints (replaceIfExists) overwrites the limits of an
 * EXISTING point. On a LIVE product that is a governed direct edit (decision #4):
 * the point is SKIPPED with a clear message; on a `development` product it is
 * applied + audited. Drives the real router via a tRPC caller; the gate resolver
 * is mocked for a deterministic lifecycle decision.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const updateMeasurementPointDef = vi.fn(async () => {});
const createMeasurementPointDef = vi.fn(async () => 1);
const getProductModelByCode = vi.fn();
const getMeasurementPointDefByCode = vi.fn();
const createAuditLog = vi.fn(async () => ({ id: 1 }));
vi.mock("./db", () => ({
  getProductModelByCode: (...a: unknown[]) => getProductModelByCode(...a),
  getMeasurementPointDefByCode: (...a: unknown[]) => getMeasurementPointDefByCode(...a),
  updateMeasurementPointDef: (...a: unknown[]) => updateMeasurementPointDef(...a),
  createMeasurementPointDef: (...a: unknown[]) => createMeasurementPointDef(...a),
  createAuditLog: (...a: unknown[]) => createAuditLog(...a),
}));

const resolveThresholdEditGate = vi.fn();
vi.mock("./services/thresholdGovernanceService", () => ({
  resolveThresholdEditGate: (...a: unknown[]) => resolveThresholdEditGate(...a),
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function adminCtx(): TrpcContext {
  return {
    user: { id: 1, role: "admin", name: "Admin" } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

const item = {
  productModelCode: "PRD-1",
  code: "MP-1",
  name: "Điểm 1",
  measurementType: "DIMENSION" as const,
  upperLimit: 10, // existing is 9 → a real limit change
};

beforeEach(() => {
  vi.clearAllMocks();
  getProductModelByCode.mockResolvedValue({ id: 5, code: "PRD-1" });
  getMeasurementPointDefByCode.mockResolvedValue({ id: 42, code: "MP-1", lowerLimit: "8", upperLimit: "9", nominalValue: "8.5" });
});

describe("importMeasurementPoints — bulk-import limit gate (B.6)", () => {
  it("ACTIVE product + changed limit → SKIPPED with a clear message, no db write", async () => {
    resolveThresholdEditGate.mockResolvedValue({
      decision: "requires_approval", productModelId: 5, lifecycleStatus: "active",
      hasReleasedProgram: false, enforced: true,
    });
    const caller = appRouter.createCaller(adminCtx());
    const res = await caller.import.importMeasurementPoints({ data: [item], replaceIfExists: true });

    expect(res.skipped).toBe(1);
    expect(res.success).toBe(0);
    expect(res.errors.join(" ")).toMatch(/approval|duyệt/i);
    expect(updateMeasurementPointDef).not.toHaveBeenCalled();
  });

  it("DEVELOPMENT product + changed limit → applied + audited", async () => {
    resolveThresholdEditGate.mockResolvedValue({
      decision: "direct", productModelId: 5, lifecycleStatus: "development",
      hasReleasedProgram: false, enforced: true,
    });
    const caller = appRouter.createCaller(adminCtx());
    const res = await caller.import.importMeasurementPoints({ data: [item], replaceIfExists: true });

    expect(res.success).toBe(1);
    expect(res.skipped).toBe(0);
    expect(updateMeasurementPointDef).toHaveBeenCalledWith(42, expect.objectContaining({ upperLimit: "10" }));
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "threshold.directEdit" }));
  });

  // Task 8 Khối C — trước bản vá `touchesLimits` ở đây chỉ chép tay
  // upperLimit/lowerLimit/nominalValue: một dòng CHỈ đổi `unit` không bao giờ
  // gọi resolveThresholdEditGate, ghi thẳng kể cả trên sản phẩm live.
  it("ACTIVE product + ONLY `unit` changed → cũng SKIPPED (unit LÀ một field giới hạn)", async () => {
    resolveThresholdEditGate.mockResolvedValue({
      decision: "requires_approval", productModelId: 5, lifecycleStatus: "active",
      hasReleasedProgram: false, enforced: true,
    });
    const caller = appRouter.createCaller(adminCtx());
    const unitOnlyItem = { ...item, upperLimit: undefined, unit: "mm" };
    const res = await caller.import.importMeasurementPoints({ data: [unitOnlyItem], replaceIfExists: true });

    expect(resolveThresholdEditGate).toHaveBeenCalledWith(42);
    expect(res.skipped).toBe(1);
    expect(res.success).toBe(0);
    expect(updateMeasurementPointDef).not.toHaveBeenCalled();
  });
});
