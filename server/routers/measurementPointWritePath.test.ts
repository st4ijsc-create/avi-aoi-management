/**
 * Doc 31 Đợt B (MP1 / PM6) — measurementPoint WRITE-PATH tests.
 *
 * Proves the two wave-8 columns (componentCode / refDesignator) now have a
 * writer through the tRPC router, AND that editing them does NOT trip WA-1's
 * lifecycle threshold gate (they are non-limit fields).
 *
 * db + governance layers are fully mocked (spies) — this exercises the router
 * wiring, not the DB. The DB round-trip + Pareto proof lives in
 * componentLinkBackfill.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const createSpy = vi.fn(async () => 777);
const updateSpy = vi.fn(async () => {});
const getPointSpy = vi.fn();
const getProductSpy = vi.fn(async () => ({ id: 1, imageWidth: null, imageHeight: null }));
const auditSpy = vi.fn(async () => ({ id: 1 }));

vi.mock("../db", () => ({
  createMeasurementPointDef: (...a: any[]) => createSpy(...a),
  updateMeasurementPointDef: (...a: any[]) => updateSpy(...a),
  getMeasurementPointDefById: (...a: any[]) => getPointSpy(...a),
  getProductModelById: (...a: any[]) => getProductSpy(...a),
  getMeasurementTypeCatalogByCode: vi.fn(async () => undefined),
  getMeasurementInstrumentById: vi.fn(async () => undefined),
  getSamplingPlanById: vi.fn(async () => undefined),
  getProductViewById: vi.fn(async () => undefined),
  createAuditLog: (...a: any[]) => auditSpy(...a),
}));

// The gate: spy so we can assert it is / isn't called and simulate a live product.
const gateSpy = vi.fn(async () => ({
  decision: "direct" as const,
  productModelId: 1,
  lifecycleStatus: "development",
  hasReleasedProgram: false,
  enforced: true,
}));
vi.mock("../services/thresholdGovernanceService", () => ({
  assertThresholdEditAllowed: (...a: any[]) => gateSpy(...a),
}));

// Router imports this at top-level; stub so nothing touches the DB here.
vi.mock("../services/componentLinkBackfill", () => ({
  backfillComponentCodesFromBom: vi.fn(async () => ({
    productModelId: 1, bomDefinitionId: null, matched: 0, updated: 0,
    skippedAlreadyLinked: 0, unmatched: [], dryRun: false,
  })),
}));

import { measurementPointRouter } from "./productRouters";

const adminCtx = { user: { id: 5, role: "admin", twoFactorEnabled: true, name: "Admin" }, req: { ip: null, headers: {} } } as any;
const caller = measurementPointRouter.createCaller(adminCtx);

const existingPoint = {
  id: 42, code: "MP-42", name: "Solder A", productModelId: 1,
  measurementType: "VISUAL", measurementTypeCode: null,
  lowerLimit: null, upperLimit: null, nominalValue: null,
  toleranceMode: null, tolPlus: null, tolMinus: null,
  positionX: 10, positionY: 20, radius: 5,
  componentCode: null, refDesignator: null,
};

beforeEach(() => {
  createSpy.mockClear();
  updateSpy.mockClear();
  auditSpy.mockClear();
  gateSpy.mockClear();
  gateSpy.mockResolvedValue({
    decision: "direct", productModelId: 1, lifecycleStatus: "development",
    hasReleasedProgram: false, enforced: true,
  } as any);
  getPointSpy.mockResolvedValue({ ...existingPoint });
});

describe("create — componentCode / refDesignator write path", () => {
  it("threads both columns into the insert", async () => {
    const res = await caller.create({
      productModelId: 1,
      code: "MP-CC-1",
      name: "Cap C12",
      measurementType: "VISUAL",
      positionX: 100,
      positionY: 150,
      componentCode: "C-0402-10K",
      refDesignator: "C12",
    });
    expect(res).toEqual({ id: 777 });
    expect(createSpy).toHaveBeenCalledTimes(1);
    const inserted = createSpy.mock.calls[0][0] as any;
    expect(inserted.componentCode).toBe("C-0402-10K");
    expect(inserted.refDesignator).toBe("C12");
    // creating a point never touches the threshold gate.
    expect(gateSpy).not.toHaveBeenCalled();
  });
});

describe("update — componentCode / refDesignator do NOT trip the threshold gate", () => {
  it("updates both columns and leaves the gate untouched (development product)", async () => {
    const res = await caller.update({ id: 42, componentCode: "R-100", refDesignator: "R7" });
    expect(res).toEqual({ success: true });
    expect(gateSpy).not.toHaveBeenCalled(); // ← the core MP1-vs-WA-1 proof
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [pid, patch] = updateSpy.mock.calls[0] as any[];
    expect(pid).toBe(42);
    expect(patch.componentCode).toBe("R-100");
    expect(patch.refDesignator).toBe("R7");
  });

  it("succeeds on a LIVE product too — the gate would block but is never reached", async () => {
    // Simulate an active/released product: if the gate were ever consulted for a
    // componentCode-only edit it would throw. It must NOT be.
    gateSpy.mockRejectedValue(Object.assign(new Error("FORBIDDEN — would block"), { code: "FORBIDDEN" }));
    await expect(caller.update({ id: 42, componentCode: "U-QFN48" })).resolves.toEqual({ success: true });
    expect(gateSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect((updateSpy.mock.calls[0][1] as any).componentCode).toBe("U-QFN48");
  });
});

describe("update — WA-1 regression: limit edits STILL gate", () => {
  it("a limit-touching update consults assertThresholdEditAllowed", async () => {
    await caller.update({ id: 42, lowerLimit: "1", upperLimit: "9" });
    expect(gateSpy).toHaveBeenCalledTimes(1);
    expect(gateSpy).toHaveBeenCalledWith(42);
  });
});
