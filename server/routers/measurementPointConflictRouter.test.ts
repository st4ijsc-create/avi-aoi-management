/**
 * Doc 31 Đợt D (UX3 — WD-2) — measurementPoint.update router optimistic-lock wiring.
 *
 * Proves the router (a) threads expectedUpdatedAt into db.updateMeasurementPointDef,
 * (b) maps a MP_STALE_WRITE error → tRPC CONFLICT with the current row forwarded,
 * and (c) omits the check (undefined) when the client sends no expectedUpdatedAt.
 * db + governance are mocked (spies) — this exercises router wiring only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const updateSpy = vi.fn(async () => {});
const getPointSpy = vi.fn();
const getProductSpy = vi.fn(async () => ({ id: 1, imageWidth: null, imageHeight: null }));
const auditSpy = vi.fn(async () => ({ id: 1 }));

vi.mock("../db", () => ({
  createMeasurementPointDef: vi.fn(async () => 1),
  updateMeasurementPointDef: (...a: any[]) => updateSpy(...a),
  // Doc 51 P1 (R4): point mutations bump pointsConfigVersion via bumpAndNotifyPointsConfig().
  bumpPointsConfigVersion: vi.fn(async (id: number) => ({ productModelId: id, code: "PM-TEST", version: 2 })),
  getMeasurementPointDefById: (...a: any[]) => getPointSpy(...a),
  getProductModelById: (...a: any[]) => getProductSpy(...a),
  getMeasurementTypeCatalogByCode: vi.fn(async () => undefined),
  getMeasurementInstrumentById: vi.fn(async () => undefined),
  getSamplingPlanById: vi.fn(async () => undefined),
  getProductViewById: vi.fn(async () => undefined),
  createAuditLog: (...a: any[]) => auditSpy(...a),
}));
vi.mock("../services/thresholdGovernanceService", () => ({
  assertThresholdEditAllowed: vi.fn(async () => ({
    decision: "direct", productModelId: 1, lifecycleStatus: "development",
    hasReleasedProgram: false, enforced: true,
  })),
}));
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
  updateSpy.mockClear();
  updateSpy.mockResolvedValue(undefined as any);
  getPointSpy.mockResolvedValue({ ...existingPoint });
});

describe("measurementPoint.update — optimistic lock", () => {
  it("threads expectedUpdatedAt into the db call", async () => {
    const ts = new Date("2026-07-05T10:00:00.000Z");
    await caller.update({ id: 42, name: "New name", expectedUpdatedAt: ts });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const opts = updateSpy.mock.calls[0][2] as any;
    expect(opts.expectedUpdatedAt).toBeInstanceOf(Date);
    expect((opts.expectedUpdatedAt as Date).getTime()).toBe(ts.getTime());
  });

  it("sends undefined when the client omits expectedUpdatedAt (skip check)", async () => {
    await caller.update({ id: 42, name: "New name" });
    const opts = updateSpy.mock.calls[0][2] as any;
    expect(opts.expectedUpdatedAt).toBeUndefined();
  });

  it("maps MP_STALE_WRITE → CONFLICT and forwards the current row", async () => {
    updateSpy.mockRejectedValueOnce(Object.assign(new Error("stale"), {
      code: "MP_STALE_WRITE",
      current: { code: "MP-42", name: "Someone else's name", lowerLimit: "2" },
      expectedUpdatedAt: "2026-07-05T10:00:00.000Z",
      actualUpdatedAt: "2026-07-05T11:00:00.000Z",
    }));
    try {
      await caller.update({ id: 42, name: "New name", expectedUpdatedAt: new Date("2026-07-05T10:00:00.000Z") });
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as any;
      expect(e.code).toBe("CONFLICT");
      expect(e.cause?.mpConflict?.current?.name).toBe("Someone else's name");
      expect(e.cause?.mpConflict?.actualUpdatedAt).toBe("2026-07-05T11:00:00.000Z");
    }
  });
});
