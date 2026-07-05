/**
 * Doc 31 Đợt E (UX5, WE-2) — fiducialMarkRouter CRUD tests.
 *
 * The fiducial tab was orphaned (UX1: "no importer → unreachable") until WD-1
 * remounted it; its router had ZERO tests. Covers: create (normalized-coord
 * auto-compute from product image dims, + graceful skip when dims are absent),
 * update (re-normalize on position change), delete (soft + audit), and
 * uploadTemplateImage NOT_FOUND. Plus adminProcedure RBAC.
 *
 * db + storage mocked (spies) — exercises the procedure wiring only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getProductSpy = vi.fn();
const getFidSpy = vi.fn();
const createFidSpy = vi.fn(async () => 321);
const updateFidSpy = vi.fn(async () => {});
const deleteFidSpy = vi.fn(async () => {});
const auditSpy = vi.fn(async () => ({ id: 1 }));
const storagePutSpy = vi.fn(async () => ({ url: "https://cdn/x.png", key: "k/x.png" }));

vi.mock("../db", () => ({
  getProductModelById: (...a: any[]) => getProductSpy(...a),
  getFiducialMarkById: (...a: any[]) => getFidSpy(...a),
  createFiducialMark: (...a: any[]) => createFidSpy(...a),
  updateFiducialMark: (...a: any[]) => updateFidSpy(...a),
  deleteFiducialMark: (...a: any[]) => deleteFidSpy(...a),
  createAuditLog: (...a: any[]) => auditSpy(...a),
}));
vi.mock("../storage", () => ({
  storagePut: (...a: any[]) => storagePutSpy(...a),
  resolveImageToDataUrl: vi.fn(async () => undefined),
}));
vi.mock("../services/thresholdGovernanceService", () => ({
  assertThresholdEditAllowed: vi.fn(async () => ({ decision: "direct", enforced: true })),
}));
vi.mock("../services/componentLinkBackfill", () => ({
  backfillComponentCodesFromBom: vi.fn(async () => ({})),
}));

import { fiducialMarkRouter } from "./productRouters";

const adminCtx = { user: { id: 5, role: "admin", twoFactorEnabled: true, name: "Admin" }, req: { ip: null, headers: {} } } as any;
const viewerCtx = { user: { id: 9, role: "viewer", twoFactorEnabled: false, name: "V" }, req: { ip: null, headers: {} } } as any;
const admin = fiducialMarkRouter.createCaller(adminCtx);
const viewer = fiducialMarkRouter.createCaller(viewerCtx);

beforeEach(() => {
  getProductSpy.mockReset();
  getFidSpy.mockReset();
  createFidSpy.mockClear();
  updateFidSpy.mockClear();
  deleteFidSpy.mockClear();
  auditSpy.mockClear();
  storagePutSpy.mockClear();
});

describe("fiducialMark.create — normalized coords from product image dims", () => {
  it("computes normalizedX/Y from image dims and threads all fields into the insert", async () => {
    getProductSpy.mockResolvedValue({ id: 1, imageWidth: 1000, imageHeight: 500 });
    const res = await admin.create({
      productModelId: 1, code: "FID-1", name: "Top-left fiducial",
      type: "cross", positionX: 250, positionY: 100,
    });
    expect(res).toEqual({ id: 321 });
    const inserted = createFidSpy.mock.calls[0][0] as any;
    expect(inserted.normalizedX).toBe("0.25000000"); // 250/1000
    expect(inserted.normalizedY).toBe("0.20000000"); // 100/500
    expect(inserted.code).toBe("FID-1");
    expect(auditSpy.mock.calls[0][0]).toMatchObject({ action: "fiducialMark.create" });
  });

  it("skips normalization (undefined) when the product has NO image dims", async () => {
    getProductSpy.mockResolvedValue({ id: 1, imageWidth: null, imageHeight: null });
    await admin.create({ productModelId: 1, code: "FID-2", name: "F2", positionX: 10, positionY: 20 });
    const inserted = createFidSpy.mock.calls[0][0] as any;
    expect(inserted.normalizedX).toBeUndefined();
    expect(inserted.normalizedY).toBeUndefined();
  });

  it("rejects an invalid code (regex) before touching the db", async () => {
    await expect(
      admin.create({ productModelId: 1, code: "bad code!", name: "F", positionX: 1, positionY: 1 }),
    ).rejects.toBeTruthy();
    expect(createFidSpy).not.toHaveBeenCalled();
  });
});

describe("fiducialMark.update — re-normalize on position change", () => {
  it("recomputes normalized coords when a position field changes", async () => {
    getFidSpy.mockResolvedValue({ id: 321, productModelId: 1, positionX: 250, positionY: 100 });
    getProductSpy.mockResolvedValue({ id: 1, imageWidth: 1000, imageHeight: 500 });
    const res = await admin.update({ id: 321, positionX: 500 });
    expect(res).toEqual({ success: true });
    const [id, patch] = updateFidSpy.mock.calls[0] as any[];
    expect(id).toBe(321);
    expect(patch.normalizedX).toBe("0.50000000"); // new x 500/1000
    expect(patch.normalizedY).toBe("0.20000000"); // unchanged y 100/500
  });

  it("does NOT recompute when only a non-position field changes", async () => {
    getFidSpy.mockResolvedValue({ id: 321, productModelId: 1, positionX: 250, positionY: 100 });
    await admin.update({ id: 321, name: "Renamed fiducial" });
    const [, patch] = updateFidSpy.mock.calls[0] as any[];
    expect(patch.normalizedX).toBeUndefined();
    expect(patch.name).toBe("Renamed fiducial");
  });
});

describe("fiducialMark.delete — soft delete + audit", () => {
  it("soft-deletes and records the code in the audit trail", async () => {
    getFidSpy.mockResolvedValue({ id: 321, code: "FID-1", productModelId: 1 });
    const res = await admin.delete({ id: 321 });
    expect(res).toEqual({ success: true });
    expect(deleteFidSpy).toHaveBeenCalledWith(321);
    const audit = auditSpy.mock.calls[0][0] as any;
    expect(audit).toMatchObject({ action: "fiducialMark.delete", entityName: "FID-1" });
    expect(audit.details.soft).toBe(true);
  });
});

describe("fiducialMark.uploadTemplateImage", () => {
  it("throws NOT_FOUND for an unknown fiducial (never uploads)", async () => {
    getFidSpy.mockResolvedValue(undefined);
    await expect(
      admin.uploadTemplateImage({ fiducialId: 999, imageBase64: "AAAA", mimeType: "image/png" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(storagePutSpy).not.toHaveBeenCalled();
  });

  it("uploads and persists the template image url/key for a known fiducial", async () => {
    getFidSpy.mockResolvedValue({ id: 321, code: "FID-1", productModelId: 1 });
    const res = await admin.uploadTemplateImage({ fiducialId: 321, imageBase64: "AAAA", mimeType: "image/png" });
    expect(res).toMatchObject({ success: true, imageUrl: "https://cdn/x.png", imageKey: "k/x.png" });
    expect(storagePutSpy).toHaveBeenCalledTimes(1);
    const [, patch] = updateFidSpy.mock.calls[0] as any[];
    expect(patch.templateImageUrl).toBe("https://cdn/x.png");
  });
});

describe("RBAC — fiducial mutations are admin-only", () => {
  it("a viewer cannot create a fiducial (FORBIDDEN)", async () => {
    await expect(
      viewer.create({ productModelId: 1, code: "FID-X", name: "X", positionX: 1, positionY: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createFidSpy).not.toHaveBeenCalled();
  });
});
