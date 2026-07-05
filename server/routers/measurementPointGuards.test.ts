/**
 * Doc 31 Đợt E (UX5, WE-2) — measurementPointRouter validation-guard + remap
 * coverage NOT already exercised by measurementPointWritePath.test.ts (component
 * columns) or measurementPointConflictRouter.test.ts (optimistic lock).
 *
 * Covers: create-time referential guards (preferredInstrument / samplingPlan /
 * productView must exist, be active, and belong to the same product), the delete
 * soft/audit path, and the remapUnmapped __UNMAPPED__ guards (MP3/WB-2).
 *
 * db + resolver + governance are mocked (spies) — procedure wiring only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getProductSpy = vi.fn(async () => ({ id: 1, imageWidth: null, imageHeight: null }));
const getInstrumentSpy = vi.fn();
const getSamplingSpy = vi.fn();
const getViewSpy = vi.fn();
const getTypeCatalogSpy = vi.fn(async () => undefined);
const createPointSpy = vi.fn(async () => 501);
const getPointSpy = vi.fn();
const deletePointSpy = vi.fn(async () => {});
const remapSpy = vi.fn();
const auditSpy = vi.fn(async () => ({ id: 1 }));

vi.mock("../db", () => ({
  getProductModelById: (...a: any[]) => getProductSpy(...a),
  getMeasurementInstrumentById: (...a: any[]) => getInstrumentSpy(...a),
  getSamplingPlanById: (...a: any[]) => getSamplingSpy(...a),
  getProductViewById: (...a: any[]) => getViewSpy(...a),
  getMeasurementTypeCatalogByCode: (...a: any[]) => getTypeCatalogSpy(...a),
  createMeasurementPointDef: (...a: any[]) => createPointSpy(...a),
  getMeasurementPointDefById: (...a: any[]) => getPointSpy(...a),
  deleteMeasurementPointDef: (...a: any[]) => deletePointSpy(...a),
  remapMeasurementPoints: (...a: any[]) => remapSpy(...a),
  createAuditLog: (...a: any[]) => auditSpy(...a),
}));

const getUnmappedModelIdSpy = vi.fn();
vi.mock("../services/measurementPointResolver", () => ({
  getUnmappedProductModelId: (...a: any[]) => getUnmappedModelIdSpy(...a),
  getUnmappedPointRate: vi.fn(async () => ({ total: 0, unmatched: 0, rate: 0 })),
}));
vi.mock("../services/thresholdGovernanceService", () => ({
  assertThresholdEditAllowed: vi.fn(async () => ({ decision: "direct", enforced: true })),
}));
vi.mock("../services/componentLinkBackfill", () => ({
  backfillComponentCodesFromBom: vi.fn(async () => ({})),
}));

import { measurementPointRouter } from "./productRouters";

const adminCtx = { user: { id: 5, role: "admin", twoFactorEnabled: true, name: "Admin" }, req: { ip: null, headers: {} } } as any;
const caller = measurementPointRouter.createCaller(adminCtx);

const basePoint = { productModelId: 1, code: "MP-1", name: "Solder A", measurementType: "VISUAL" as const, positionX: 10, positionY: 20 };

beforeEach(() => {
  getProductSpy.mockClear();
  getInstrumentSpy.mockReset();
  getSamplingSpy.mockReset();
  getViewSpy.mockReset();
  createPointSpy.mockClear();
  getPointSpy.mockReset();
  deletePointSpy.mockClear();
  remapSpy.mockReset();
  auditSpy.mockClear();
  getUnmappedModelIdSpy.mockReset();
});

describe("measurementPoint.create — referential guards", () => {
  it("happy path returns the new id", async () => {
    const res = await caller.create({ ...basePoint });
    expect(res).toEqual({ id: 501 });
  });

  it("unknown preferredInstrumentId → NOT_FOUND", async () => {
    getInstrumentSpy.mockResolvedValue(undefined);
    await expect(caller.create({ ...basePoint, preferredInstrumentId: 42 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(createPointSpy).not.toHaveBeenCalled();
  });

  it("inactive preferredInstrumentId → BAD_REQUEST", async () => {
    getInstrumentSpy.mockResolvedValue({ id: 42, code: "CAL-1", isActive: false });
    await expect(caller.create({ ...basePoint, preferredInstrumentId: 42 })).rejects.toMatchObject({
      code: "BAD_REQUEST", message: /inactive/,
    });
  });

  it("samplingPlan belonging to a DIFFERENT product → BAD_REQUEST", async () => {
    getSamplingSpy.mockResolvedValue({ id: 9, code: "AQL-1", isActive: true, productModelId: 2 });
    await expect(caller.create({ ...basePoint, preferredSamplingPlanId: 9 })).rejects.toMatchObject({
      code: "BAD_REQUEST", message: /does not belong/,
    });
  });

  it("productView belonging to a DIFFERENT product → BAD_REQUEST", async () => {
    getViewSpy.mockResolvedValue({ id: 3, code: "CAM-TOP", isActive: true, productModelId: 2 });
    await expect(caller.create({ ...basePoint, productViewId: 3 })).rejects.toMatchObject({
      code: "BAD_REQUEST", message: /does not belong/,
    });
  });
});

describe("measurementPoint.delete — soft + audit", () => {
  it("soft-deletes and records the code + productModelId", async () => {
    getPointSpy.mockResolvedValue({ id: 501, code: "MP-1", productModelId: 1 });
    const res = await caller.delete({ id: 501 });
    expect(res).toEqual({ success: true });
    expect(deletePointSpy).toHaveBeenCalledWith(501);
    const audit = auditSpy.mock.calls[0][0] as any;
    expect(audit).toMatchObject({ action: "measurementPoint.delete", entityName: "MP-1" });
    expect(audit.details).toMatchObject({ soft: true, productModelId: 1 });
  });
});

describe("measurementPoint.remapUnmapped — __UNMAPPED__ guards (MP3/WB-2)", () => {
  it("NOT_FOUND when no __UNMAPPED__ model exists", async () => {
    getUnmappedModelIdSpy.mockResolvedValue(null);
    await expect(
      caller.remapUnmapped({ pointDefIds: [1, 2], targetProductModelId: 5 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: /__UNMAPPED__/ });
  });

  it("NOT_FOUND when the target product model is missing", async () => {
    getUnmappedModelIdSpy.mockResolvedValue(99);
    getProductSpy.mockResolvedValueOnce(undefined);
    await expect(
      caller.remapUnmapped({ pointDefIds: [1], targetProductModelId: 5 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("BAD_REQUEST when remapping INTO the __UNMAPPED__ model itself", async () => {
    getUnmappedModelIdSpy.mockResolvedValue(99);
    getProductSpy.mockResolvedValueOnce({ id: 99, code: "__UNMAPPED__" });
    await expect(
      caller.remapUnmapped({ pointDefIds: [1], targetProductModelId: 99 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("happy path delegates to db.remapMeasurementPoints and audits", async () => {
    getUnmappedModelIdSpy.mockResolvedValue(99);
    getProductSpy.mockResolvedValueOnce({ id: 5, code: "PCB-REAL" });
    remapSpy.mockResolvedValue({ moved: 2, merged: 0, repointedResults: 7 });
    const res = await caller.remapUnmapped({ pointDefIds: [1, 2], targetProductModelId: 5, targetMachineId: 3 });
    expect(res).toMatchObject({ moved: 2, repointedResults: 7 });
    expect(remapSpy).toHaveBeenCalledWith({
      pointDefIds: [1, 2], targetProductModelId: 5, unmappedModelId: 99, targetMachineId: 3,
    });
    expect(auditSpy.mock.calls[0][0]).toMatchObject({ action: "measurementPoint.remapUnmapped", entityName: "PCB-REAL" });
  });
});
