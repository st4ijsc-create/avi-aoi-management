/**
 * Doc 31 Đợt E (UX5, WE-2) — productModelRouter surface NOT already covered by
 * productCloneRouter.test.ts (clone) or productImageDims.test.ts (PM8 create).
 *
 * Covers the remaining CRUD/query surface: list (search/sort/pagination
 * pass-through), update (rename + duplicate-code guard + no-op-code path),
 * delete (soft + audit + entityName), getReadiness/getReadinessBatch
 * pass-through, and adminProcedure RBAC on the mutations.
 *
 * db + governance + readiness are mocked (spies) — this exercises the tRPC
 * procedure wiring, not the DB (real round-trips live in *.db.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getModelsSpy = vi.fn();
const getByIdSpy = vi.fn();
const getByCodeSpy = vi.fn();
const updateSpy = vi.fn(async () => {});
const deleteSpy = vi.fn(async () => {});
const backfillNormalizedSpy = vi.fn(async () => ({ points: 0, fiducials: 0 }));
const auditSpy = vi.fn(async () => ({ id: 1 }));

vi.mock("../db", () => ({
  getProductModels: (...a: any[]) => getModelsSpy(...a),
  getProductModelById: (...a: any[]) => getByIdSpy(...a),
  getProductModelByCode: (...a: any[]) => getByCodeSpy(...a),
  updateProductModel: (...a: any[]) => updateSpy(...a),
  deleteProductModel: (...a: any[]) => deleteSpy(...a),
  backfillNormalizedCoordsForProduct: (...a: any[]) => backfillNormalizedSpy(...a),
  createAuditLog: (...a: any[]) => auditSpy(...a),
}));

// Top-level imports of productRouters — stub so module load never touches the DB.
vi.mock("../services/thresholdGovernanceService", () => ({
  assertThresholdEditAllowed: vi.fn(async () => ({ decision: "direct", enforced: true })),
}));
vi.mock("../services/componentLinkBackfill", () => ({
  backfillComponentCodesFromBom: vi.fn(async () => ({})),
}));
const readinessSpy = vi.fn();
const readinessBatchSpy = vi.fn();
vi.mock("../services/productReadinessService", () => ({
  computeProductReadiness: (...a: any[]) => readinessSpy(...a),
  computeProductReadinessBatch: (...a: any[]) => readinessBatchSpy(...a),
}));

import { productModelRouter } from "./productRouters";

const adminCtx = { user: { id: 5, role: "admin", twoFactorEnabled: true, name: "Admin" }, req: { ip: null, headers: {} } } as any;
const viewerCtx = { user: { id: 9, role: "viewer", twoFactorEnabled: false, name: "Viewer" }, req: { ip: null, headers: {} } } as any;
const admin = productModelRouter.createCaller(adminCtx);
const viewer = productModelRouter.createCaller(viewerCtx);

beforeEach(() => {
  getModelsSpy.mockReset();
  getByIdSpy.mockReset();
  getByCodeSpy.mockReset();
  updateSpy.mockClear();
  deleteSpy.mockClear();
  auditSpy.mockClear();
  readinessSpy.mockReset();
  readinessBatchSpy.mockReset();
});

describe("productModel.list — filter/sort/pagination pass-through", () => {
  it("forwards the whole filter object to db.getProductModels and returns its rows", async () => {
    const rows = [{ id: 1, code: "PCB-A" }, { id: 2, code: "PCB-B" }];
    getModelsSpy.mockResolvedValue(rows);
    const filter = { search: "PCB", lifecycleStatus: "active" as const, sortBy: "code" as const, sortOrder: "desc" as const, limit: 25, offset: 50 };
    const res = await admin.list(filter);
    expect(res).toBe(rows);
    expect(getModelsSpy).toHaveBeenCalledWith(filter);
  });

  it("accepts an omitted input (undefined) and passes it through", async () => {
    getModelsSpy.mockResolvedValue([]);
    await admin.list();
    expect(getModelsSpy).toHaveBeenCalledWith(undefined);
  });

  it("rejects an out-of-range limit (Zod)", async () => {
    await expect(admin.list({ limit: 9999 } as any)).rejects.toBeTruthy();
    expect(getModelsSpy).not.toHaveBeenCalled();
  });
});

describe("productModel.update — rename + duplicate-code guard", () => {
  it("renaming to a FREE code updates and audits the changed fields", async () => {
    getByIdSpy.mockResolvedValue({ id: 10, code: "OLD", name: "Old" });
    getByCodeSpy.mockResolvedValue(undefined); // new code free
    const res = await admin.update({ id: 10, code: "NEW", name: "New name" });
    expect(res).toEqual({ success: true });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [id, patch] = updateSpy.mock.calls[0] as any[];
    expect(id).toBe(10);
    expect(patch.code).toBe("NEW");
    expect(patch.name).toBe("New name");
    expect(auditSpy.mock.calls[0][0]).toMatchObject({ action: "product.update", entityId: 10 });
  });

  it("renaming to a TAKEN code is refused (CONFLICT) before writing", async () => {
    getByIdSpy.mockResolvedValue({ id: 10, code: "OLD" });
    getByCodeSpy.mockResolvedValue({ id: 77, code: "TAKEN" }); // collision
    // Doc 31 WE-2 bug #2: CONFLICT (consistent with productModel.clone), was BAD_REQUEST.
    await expect(admin.update({ id: 10, code: "TAKEN" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("updating a non-existent product is refused (NOT_FOUND), no phantom write/audit", async () => {
    // Doc 31 WE-2 bug #1: was a silent no-op that still wrote a product.update audit row.
    getByIdSpy.mockResolvedValue(undefined);
    await expect(admin.update({ id: 999999, name: "ghost" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it("re-sending the SAME code drops it from the patch (no false duplicate error)", async () => {
    getByIdSpy.mockResolvedValue({ id: 10, code: "SAME" });
    await admin.update({ id: 10, code: "SAME", name: "Renamed" });
    expect(getByCodeSpy).not.toHaveBeenCalled(); // no duplicate lookup when code unchanged
    const [, patch] = updateSpy.mock.calls[0] as any[];
    expect(patch.code).toBeUndefined(); // dropped
    expect(patch.name).toBe("Renamed");
  });
});

describe("productModel.delete — soft delete + audit", () => {
  it("soft-deletes and stamps the audit row with the product code", async () => {
    getByIdSpy.mockResolvedValue({ id: 10, code: "PCB-DEL" });
    const res = await admin.delete({ id: 10 });
    expect(res).toEqual({ success: true });
    expect(deleteSpy).toHaveBeenCalledWith(10);
    const audit = auditSpy.mock.calls[0][0] as any;
    expect(audit).toMatchObject({ action: "product.delete", entityId: 10, entityName: "PCB-DEL" });
    expect(audit.details.soft).toBe(true);
  });
});

describe("productModel.getReadiness — pass-through (UX2/WD-2)", () => {
  it("returns the readiness score object for a known product", async () => {
    const readiness = { productModelId: 10, score: 62, missingLimits: 40, checklist: [] };
    readinessSpy.mockResolvedValue(readiness);
    const res = await admin.getReadiness({ productModelId: 10 });
    expect(res).toBe(readiness);
    expect(readinessSpy).toHaveBeenCalledWith(10);
  });

  it("returns null for an unknown product", async () => {
    readinessSpy.mockResolvedValue(null);
    expect(await admin.getReadiness({ productModelId: 999 })).toBeNull();
  });

  it("getReadinessBatch short-circuits an empty id list (no query cost)", async () => {
    const res = await admin.getReadinessBatch({ ids: [] });
    expect(res).toEqual([]);
    expect(readinessBatchSpy).not.toHaveBeenCalled();
  });
});

describe("RBAC — mutations are admin-only", () => {
  it("a viewer cannot delete a product (FORBIDDEN)", async () => {
    await expect(viewer.delete({ id: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("a viewer cannot update a product (FORBIDDEN)", async () => {
    await expect(viewer.update({ id: 10, name: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("a viewer CAN list (read is protectedProcedure, not admin)", async () => {
    getModelsSpy.mockResolvedValue([]);
    await expect(viewer.list()).resolves.toEqual([]);
  });
});
