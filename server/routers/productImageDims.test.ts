/**
 * Doc 31 PM8 — image-dimension enforcement on product create.
 *
 * Proves: an uploaded image whose dimensions cannot be determined (and no manual
 * override) is REFUSED; when sharp yields dims they are persisted. db + sharp are
 * mocked. (The normalized-coord backfill is proven in the DB test.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const createProductSpy = vi.fn(async () => 42);
const auditSpy = vi.fn(async () => ({ id: 1 }));

vi.mock("../db", () => ({
  createProductModel: (...a: any[]) => createProductSpy(...a),
  createAuditLog: (...a: any[]) => auditSpy(...a),
  getProductModelById: vi.fn(async () => undefined),
  getProductModelByCode: vi.fn(async () => undefined),
  updateProductModel: vi.fn(async () => {}),
  backfillNormalizedCoordsForProduct: vi.fn(async () => ({ points: 0, fiducials: 0 })),
  getMeasurementTypeCatalogByCode: vi.fn(async () => undefined),
}));

vi.mock("../services/thresholdGovernanceService", () => ({
  assertThresholdEditAllowed: vi.fn(async () => ({ decision: "direct", enforced: true })),
}));
vi.mock("../services/componentLinkBackfill", () => ({
  backfillComponentCodesFromBom: vi.fn(async () => ({})),
}));

// sharp is dynamically imported inside the router — mutable metadata via hoisted.
const h = vi.hoisted(() => ({ meta: { width: 640, height: 480 } as { width?: number; height?: number } }));
vi.mock("sharp", () => ({ default: () => ({ metadata: async () => h.meta }) }));

import { productModelRouter } from "./productRouters";

const adminCtx = { user: { id: 1, role: "admin", twoFactorEnabled: true, name: "Admin" }, req: { ip: null, headers: {} } } as any;
const caller = productModelRouter.createCaller(adminCtx);

const DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="; // content irrelevant (sharp mocked)

beforeEach(() => {
  createProductSpy.mockClear();
  process.env.PRODUCT_IMAGE_DIMS_REQUIRED = "true";
  h.meta = { width: 640, height: 480 };
});

describe("productModel.create — PM8 image dims", () => {
  it("persists auto-extracted dimensions", async () => {
    const res = await caller.create({ code: "PCB-A", name: "Board A", referenceImageUrl: DATA_URL });
    expect(res).toEqual({ id: 42 });
    const inserted = createProductSpy.mock.calls[0][0] as any;
    expect(inserted.imageWidth).toBe(640);
    expect(inserted.imageHeight).toBe(480);
  });

  it("REFUSES an image whose dimensions cannot be determined", async () => {
    h.meta = {}; // sharp returns no dims
    await expect(
      caller.create({ code: "PCB-B", name: "Board B", referenceImageUrl: DATA_URL }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(createProductSpy).not.toHaveBeenCalled();
  });

  it("accepts a manual dimension override even when sharp fails", async () => {
    h.meta = {};
    const res = await caller.create({
      code: "PCB-C", name: "Board C", referenceImageUrl: DATA_URL, imageWidth: 800, imageHeight: 600,
    });
    expect(res).toEqual({ id: 42 });
    const inserted = createProductSpy.mock.calls[0][0] as any;
    expect(inserted.imageWidth).toBe(800);
    expect(inserted.imageHeight).toBe(600);
  });

  it("a product with NO image is unaffected (dims genuinely unknown)", async () => {
    const res = await caller.create({ code: "PCB-D", name: "Board D" });
    expect(res).toEqual({ id: 42 });
  });

  it("break-glass PRODUCT_IMAGE_DIMS_REQUIRED=false lets a dim-less image through", async () => {
    process.env.PRODUCT_IMAGE_DIMS_REQUIRED = "false";
    h.meta = {};
    const res = await caller.create({ code: "PCB-E", name: "Board E", referenceImageUrl: DATA_URL });
    expect(res).toEqual({ id: 42 });
  });
});
