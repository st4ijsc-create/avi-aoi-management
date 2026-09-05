/**
 * Doc 51 P1 (R4) — measurementPoint mutations MUST bump pointsConfigVersion.
 *
 * THE BUG (verified on disk before the fix: `pointsConfigVersion` matched exactly
 * 3 lines in productRouters.ts — all inside CAD applyJob): create / update /
 * delete through the UI never touched the version, so checkPointsVersion answered
 * "no changes" and deltaSyncPoints returned nothing FOREVER. Machines kept
 * inspecting whatever config they happened to fetch first: new points never
 * inspected, deleted points still failing boards, re-tuned limits never applied —
 * all while the UI reported a successful save.
 *
 * Router wiring only (db + mqtt are spies). The atomicity of the bump itself and
 * the DB-level tombstone/upsert behaviour are proven against the real DB in
 * server/db/measurementPointIntegrity.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const bumpSpy = vi.fn(async (id: number) => ({ productModelId: id, code: `PM-${id}`, version: 8 }));
const createSpy = vi.fn(async () => 501);
const updateSpy = vi.fn(async () => {});
const deleteSpy = vi.fn(async () => ({ productModelId: 1, code: "PM-1", version: 9 }));
const getPointSpy = vi.fn();
const auditSpy = vi.fn(async () => ({ id: 1 }));

vi.mock("../db", () => ({
  bumpPointsConfigVersion: (...a: any[]) => bumpSpy(...(a as [number])),
  createMeasurementPointDef: (...a: any[]) => createSpy(...(a as [])),
  updateMeasurementPointDef: (...a: any[]) => updateSpy(...(a as [])),
  deleteMeasurementPointDef: (...a: any[]) => deleteSpy(...(a as [])),
  getMeasurementPointDefById: (...a: any[]) => getPointSpy(...a),
  getProductModelById: vi.fn(async () => ({ id: 1, imageWidth: null, imageHeight: null })),
  getMeasurementTypeCatalogByCode: vi.fn(async () => undefined),
  getMeasurementInstrumentById: vi.fn(async () => undefined),
  getSamplingPlanById: vi.fn(async () => undefined),
  getProductViewById: vi.fn(async () => undefined),
  createAuditLog: (...a: any[]) => auditSpy(...a),
}));

const publishSpy = vi.fn();
vi.mock("../services/mqttService", () => ({
  publishPointsConfigChanged: (...a: any[]) => publishSpy(...a),
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
vi.mock("../services/measurementPointResolver", () => ({
  getUnmappedProductModelId: vi.fn(async () => 99),
  getUnmappedPointRate: vi.fn(async () => ({ total: 0, unmatched: 0, rate: 0 })),
}));

import { measurementPointRouter } from "./productRouters";

const adminCtx = {
  user: { id: 5, role: "admin", twoFactorEnabled: true, name: "Admin" },
  req: { ip: null, headers: {} },
} as any;
const caller = measurementPointRouter.createCaller(adminCtx);

const existingPoint = {
  id: 501,
  productModelId: 7,
  code: "P1",
  name: "P1",
  positionX: 10,
  positionY: 10,
  radius: 5,
  updatedAt: new Date("2026-07-15T00:00:00.000Z"),
  lowerLimit: null,
  upperLimit: null,
  nominalValue: null,
  toleranceMode: null,
  tolPlus: null,
  tolMinus: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  getPointSpy.mockResolvedValue({ ...existingPoint });
});

describe("doc 51 R4 — measurementPoint.create", () => {
  it("bumps the product's version and notifies machines", async () => {
    await caller.create({
      productModelId: 7,
      code: "NEW1",
      name: "New point",
      measurementType: "VISUAL",
      positionX: 1,
      positionY: 2,
    } as any);

    // A new point the fleet never re-fetches is a point that is never inspected.
    expect(bumpSpy).toHaveBeenCalledWith(7);
    // publishPointsConfigChanged broadcasts BY CODE + the NEW version. QĐ#14 added
    // optional machineCode/variantCode params (both undefined here — this point has
    // no variant) — arity 4, byte-identical legacy behaviour on the wire.
    expect(publishSpy).toHaveBeenCalledWith("PM-7", 8, undefined, undefined);
  });

  it("does NOT bump when the code already existed (nothing was written)", async () => {
    // Simulate the losing side of a concurrent create: db reports duplicate.
    createSpy.mockImplementationOnce(async (...args: any[]) => {
      const outcome = args[1];
      if (outcome) outcome.duplicate = true;
      return 501;
    });

    const res = await caller.create({
      productModelId: 7,
      code: "DUP",
      name: "Dup point",
      measurementType: "VISUAL",
      positionX: 1,
      positionY: 2,
    } as any);

    expect(res).toMatchObject({ id: 501, duplicate: true });
    // Bumping for a write that never happened forces a pointless fleet-wide
    // re-fetch of an identical config.
    expect(bumpSpy).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
  });
});

describe("doc 51 R4 — measurementPoint.update", () => {
  it("bumps the version after a successful edit", async () => {
    await caller.update({ id: 501, name: "renamed" } as any);

    expect(updateSpy).toHaveBeenCalled();
    // Uses the point's OWN productModelId — not anything client-supplied.
    expect(bumpSpy).toHaveBeenCalledWith(7);
    // QĐ#14 arity 4 (machineCode/variantCode) — see create test above for why both
    // are undefined for a non-variant point.
    expect(publishSpy).toHaveBeenCalledWith("PM-7", 8, undefined, undefined);
  });

  it("does NOT bump when the write was rejected by the optimistic lock", async () => {
    updateSpy.mockRejectedValueOnce(
      Object.assign(new Error("stale"), { code: "MP_STALE_WRITE", current: { ...existingPoint } }),
    );

    await expect(
      caller.update({ id: 501, name: "loser", expectedUpdatedAt: new Date("2020-01-01") } as any),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // Nothing changed → the fleet must not be told to re-fetch.
    expect(bumpSpy).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
  });
});

describe("doc 51 R4/CASE #4 — measurementPoint.delete", () => {
  it("publishes the version returned by the delete transaction", async () => {
    const res = await caller.delete({ id: 501 });

    expect(deleteSpy).toHaveBeenCalledWith(501);
    // The bump is done INSIDE deleteMeasurementPointDef's transaction (it must be
    // atomic with the deletedAtVersion stamp), so the router must NOT bump again —
    // a second bump would strand machines one version behind the tombstone.
    expect(bumpSpy).not.toHaveBeenCalled();
    // QĐ#14 arity 4 — deletion path resolves variantCode via variantCodeForPointNotify,
    // which returns undefined here (existingPoint has no variantId).
    expect(publishSpy).toHaveBeenCalledWith("PM-1", 9, undefined, undefined);
    expect(res).toMatchObject({ success: true, pointsConfigVersion: 9 });
  });

  it("does not notify when the point was already deleted", async () => {
    deleteSpy.mockResolvedValueOnce(null as any);

    const res = await caller.delete({ id: 501 });

    expect(publishSpy).not.toHaveBeenCalled();
    expect(res).toMatchObject({ success: true, pointsConfigVersion: null });
  });

  it("still succeeds when the MQTT broker is down (poll is the fallback)", async () => {
    publishSpy.mockImplementationOnce(() => { throw new Error("broker down"); });

    // The version is already committed; machines converge on their next
    // checkPointsVersion poll. Failing the engineer's delete here would be worse.
    await expect(caller.delete({ id: 501 })).resolves.toMatchObject({ success: true });
  });
});
