/**
 * doc 55 Item 3 / PV1+PV2 — PRODUCT VARIANT wiring in the MACHINE API router.
 *
 * Router-level mutation tests (mocked db). Two invariants, each test flips exactly
 * one lever and asserts the mutation-visible consequence:
 *
 *  (A) PRODUCT_VARIANT_ENABLED OFF (default) ⇒ BYTE-IDENTICAL to pre-variant:
 *      submitInspection never stamps variantId (stays undefined ⇒ NULL) and never
 *      touches product_variants; getPoints/deltaSyncPoints/checkPointsVersion use the
 *      MODEL point set + MODEL version, and never call the variant helpers.
 *  (B) ON ⇒ variantCode resolves; ingest stamps variantId (+ QĐ#12 base-tag when a
 *      MULTI-variant model gets no code); reads return the variant's EFFECTIVE set +
 *      the variant version; an unknown point on a NON-BASE variant is auto-provisioned
 *      as a variant row (variantId set — QĐ#11).
 *
 * Removing any one wire flips a test red:
 *   • drop the header `variantId` stamp        → ON stamping test fails
 *   • drop the OFF flag-guard in submit        → OFF calls getVariantsByModel (spy > 0)
 *   • drop resolveEffectivePoints in getPoints  → ON returns MODEL codes, not effective
 *   • drop the variant version gate in delta    → ON diff hidden behind model version
 *   • drop variant scope in auto-provision      → createMeasurementPointDef variantId absent
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── db mock (mirrors machineApiProvenance.test.ts + the variant/sync surface) ──
vi.mock("../db", () => {
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      insert: () => ({ values: async () => undefined }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    }),
  );
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [] }),
        orderBy: () => ({ limit: async () => [] }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({ values: async () => undefined }),
    transaction,
  };
  return {
    getDb: vi.fn(async () => fakeDb),
    getMachineByApiKey: vi.fn(),
    getMachineByCode: vi.fn(),
    getMachineById: vi.fn(),
    updateMachineHeartbeat: vi.fn(async () => undefined),
    getProductModelByCode: vi.fn(async () => undefined),
    getProductionOrderByCode: vi.fn(async () => undefined),
    updateProductionOrderQuantities: vi.fn(async () => undefined),
    createProductInspection: vi.fn(),
    createMeasurementResults: vi.fn(async () => undefined),
    getMachineStats: vi.fn(async () => ({ total: 10, ok: 10, ng: 0, ntf: 0, yieldRate: 100 })),
    getStationById: vi.fn(async () => undefined),
    getLineById: vi.fn(async () => undefined),
    getWorkshopById: vi.fn(async () => undefined),
    getFactoryById: vi.fn(async () => undefined),
    getDefectCatalogByCode: vi.fn(async () => undefined),
    recordUnmatchedDefectCodes: vi.fn(async () => undefined),
    getMeasurementPointDefByCode: vi.fn(async () => undefined),
    getMeasurementPointDefByMachineAndCode: vi.fn(async () => undefined),
    getMeasurementPointDefById: vi.fn(async () => undefined),
    createMeasurementPointDef: vi.fn(async () => 555),
    // ── PV1/PV2 surface ──
    getVariantByCode: vi.fn(async () => undefined),
    getBaseVariant: vi.fn(async () => undefined),
    getVariantsByModel: vi.fn(async () => [] as any[]),
    getVariantOverrides: vi.fn(async () => [] as any[]),
    resolveEffectivePoints: vi.fn(async () => [] as any[]),
    // ── read-sync surface ──
    getMeasurementPointDefsByProductModel: vi.fn(async () => [] as any[]),
    getMappingsByMachine: vi.fn(async () => [] as any[]),
    getPointsChangedSinceVersion: vi.fn(async () => ({
      points: [] as any[], deletedPoints: [] as any[], deletedCodes: [] as string[], currentVersion: 0,
    })),
    getFiducialMarksByProductModel: vi.fn(async () => [] as any[]),
    listMpLightingProfilesByPointDefIds: vi.fn(async () => new Map<number, any[]>()),
    createProductSyncLog: vi.fn(async () => undefined),
  };
});

vi.mock("../_core/socket", () => ({
  emitNGAlert: vi.fn(),
  emitYieldWarning: vi.fn(),
  emitDashboardUpdate: vi.fn(),
}));
vi.mock("../services/mqttService", () => ({
  publishNGAlert: vi.fn(async () => undefined),
  publishPointsConfigChanged: vi.fn(async () => undefined),
}));
vi.mock("../services/integration/outboxProducers", () => ({
  publishToOutbox: vi.fn(),
}));

import { machineApiRouter } from "./machineApiRouters";
import * as db from "../db";
import type { TrpcContext } from "../_core/context";
import type { InsertProductInspection } from "../../drizzle/schema";

const MACHINE = { id: 5, code: "AOI-01", name: "AOI Machine", stationId: 1, isActive: true };
const MODEL = {
  id: 7, code: "MODEL-A", name: "Model A",
  pointsConfigVersion: 3, imageWidth: 100, imageHeight: 100,
  referenceImageUrl: null, coordinateMode: "pixel",
};

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

/** Header persisted by the n-th createProductInspection call (0-based). */
function persistedHeader(n = 0): InsertProductInspection {
  return (db.createProductInspection as ReturnType<typeof vi.fn>).mock.calls[n][0] as InsertProductInspection;
}

const spy = <T extends keyof typeof db>(name: T) => db[name] as unknown as ReturnType<typeof vi.fn>;

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    apiKey: "SHARED-KEY",
    machineCode: "AOI-01",
    productModel: "MODEL-A",
    serialNumber: "SN-1",
    overallResult: "OK" as const,
    measurements: [] as any[],
    ...overrides,
  };
}

beforeEach(() => {
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  process.env.INSPECTION_STORE_FORWARD_ENABLED = "false";
  delete process.env.PRODUCT_VARIANT_ENABLED;
  delete process.env.INGEST_REQUEST_AUDIT_ENABLED;
  delete process.env.INSPECTION_SINGLE_TX_ENABLED;
  delete process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN;
  vi.clearAllMocks();
  (db.getMachineByApiKey as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineByCode as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineById as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineStats as ReturnType<typeof vi.fn>).mockResolvedValue({ total: 10, ok: 10, ng: 0, ntf: 0, yieldRate: 100 });
  (db.getProductModelByCode as ReturnType<typeof vi.fn>).mockResolvedValue(MODEL);
  let nextId = 1000;
  (db.createProductInspection as ReturnType<typeof vi.fn>).mockImplementation(async () => nextId++);
});

afterEach(() => vi.restoreAllMocks());

// ════════════════════════════════════════════════════════════════════════════
// PV2 — submitInspection variant STAMP
// ════════════════════════════════════════════════════════════════════════════
describe("PV2 submitInspection — variantId stamp (QĐ#12)", () => {
  it("FLAG OFF ⇒ variantId undefined (→NULL) + variant tables untouched (byte-identical)", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    await caller.submitInspection(basePayload({ variantCode: "EU" })); // code ignored while OFF

    expect(persistedHeader().variantId).toBeUndefined();
    expect(spy("getVariantByCode")).not.toHaveBeenCalled();
    expect(spy("getBaseVariant")).not.toHaveBeenCalled();
    expect(spy("getVariantsByModel")).not.toHaveBeenCalled();
  });

  it("ON + variantCode resolving to a NON-BASE variant ⇒ stamps that id, no tag", async () => {
    process.env.PRODUCT_VARIANT_ENABLED = "true";
    spy("getVariantByCode").mockResolvedValue({ id: 42, isBase: false, code: "EU", pointsConfigVersion: 9 });
    const caller = machineApiRouter.createCaller(ctx());

    await caller.submitInspection(basePayload({ variantCode: "EU" }));

    const h = persistedHeader();
    expect(h.variantId).toBe(42);
    expect(h.ingestMode).toBeUndefined(); // explicit variant ⇒ not "variant_unspecified"
    expect(spy("getVariantByCode")).toHaveBeenCalledWith(7, "EU");
  });

  it("ON + NO variantCode + MULTI-variant model ⇒ base id + ingestMode='variant_unspecified'", async () => {
    process.env.PRODUCT_VARIANT_ENABLED = "true";
    spy("getVariantsByModel").mockResolvedValue([
      { id: 10, isBase: true, code: "BASE", pointsConfigVersion: 3 },
      { id: 11, isBase: false, code: "EU", pointsConfigVersion: 3 },
    ]);
    const caller = machineApiRouter.createCaller(ctx());

    await caller.submitInspection(basePayload());

    const h = persistedHeader();
    expect(h.variantId).toBe(10);              // filed AS base
    expect(h.ingestMode).toBe("variant_unspecified");
    expect(spy("getVariantByCode")).not.toHaveBeenCalled();
  });

  it("ON + NO variantCode + ONLY base ⇒ base id, NO tag", async () => {
    process.env.PRODUCT_VARIANT_ENABLED = "true";
    spy("getVariantsByModel").mockResolvedValue([{ id: 10, isBase: true, code: "BASE", pointsConfigVersion: 3 }]);
    const caller = machineApiRouter.createCaller(ctx());

    await caller.submitInspection(basePayload());

    const h = persistedHeader();
    expect(h.variantId).toBe(10);
    expect(h.ingestMode).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PV2 — auto-provision unknown point on a NON-BASE variant (QĐ#11)
// ════════════════════════════════════════════════════════════════════════════
describe("PV2 submitInspection — variant-scoped auto-provision (QĐ#11)", () => {
  it("ON + non-base variant + unknown pointCode ⇒ createMeasurementPointDef(variantId set)", async () => {
    process.env.PRODUCT_VARIANT_ENABLED = "true";
    spy("getVariantByCode").mockResolvedValue({ id: 42, isBase: false, code: "EU", pointsConfigVersion: 9 });
    // resolveMeasurementPointDefinition misses (both scoped lookups undefined) ⇒ auto-provision.
    spy("getMeasurementPointDefByCode").mockResolvedValue(undefined);
    spy("getMeasurementPointDefByMachineAndCode").mockResolvedValue(undefined);
    spy("createMeasurementPointDef").mockResolvedValue(555);
    spy("getMeasurementPointDefById").mockResolvedValue({ id: 555, code: "NEWPT", variantId: 42 });
    const caller = machineApiRouter.createCaller(ctx());

    await caller.submitInspection(basePayload({
      variantCode: "EU",
      measurements: [{ pointCode: "NEWPT", result: "OK" }],
    }));

    const createArg = spy("createMeasurementPointDef").mock.calls[0][0] as { variantId?: number; code: string };
    expect(createArg.variantId).toBe(42);
    expect(createArg.code).toBe("NEWPT");
  });

  it("FLAG OFF + unknown pointCode ⇒ legacy resolver path, NOT the variant helper", async () => {
    // With the flag off, createMeasurementPointDef may still be reached via the
    // legacy resolver, but it must NEVER carry a variantId.
    spy("getMeasurementPointDefByCode").mockResolvedValue(undefined);
    spy("getMeasurementPointDefByMachineAndCode").mockResolvedValue(undefined);
    spy("createMeasurementPointDef").mockResolvedValue(556);
    spy("getMeasurementPointDefById").mockResolvedValue({ id: 556, code: "NEWPT" });
    const caller = machineApiRouter.createCaller(ctx());

    await caller.submitInspection(basePayload({ measurements: [{ pointCode: "NEWPT", result: "OK" }] }));

    for (const call of spy("createMeasurementPointDef").mock.calls) {
      expect((call[0] as { variantId?: number }).variantId).toBeUndefined();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PV1 — checkPointsVersion
// ════════════════════════════════════════════════════════════════════════════
describe("PV1 checkPointsVersion — version source", () => {
  it("FLAG OFF ⇒ MODEL version, variant helpers untouched", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    const res = await caller.checkPointsVersion(basePayload({ productModelCode: "MODEL-A", variantCode: "EU" }));
    expect(res.productModels[0].pointsConfigVersion).toBe(3);
    expect(spy("getVariantByCode")).not.toHaveBeenCalled();
    expect(spy("getBaseVariant")).not.toHaveBeenCalled();
  });

  it("ON + variantCode ⇒ the VARIANT's version", async () => {
    process.env.PRODUCT_VARIANT_ENABLED = "true";
    spy("getVariantByCode").mockResolvedValue({ id: 42, isBase: false, code: "EU", pointsConfigVersion: 9 });
    const caller = machineApiRouter.createCaller(ctx());
    const res = await caller.checkPointsVersion(basePayload({ productModelCode: "MODEL-A", variantCode: "EU" }));
    expect(res.productModels[0].pointsConfigVersion).toBe(9);
  });

  it("ON + absent ⇒ the BASE variant's version", async () => {
    process.env.PRODUCT_VARIANT_ENABLED = "true";
    spy("getBaseVariant").mockResolvedValue({ id: 10, isBase: true, code: "BASE", pointsConfigVersion: 4 });
    const caller = machineApiRouter.createCaller(ctx());
    const res = await caller.checkPointsVersion(basePayload({ productModelCode: "MODEL-A" }));
    expect(res.productModels[0].pointsConfigVersion).toBe(4);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PV1 — getPoints
// ════════════════════════════════════════════════════════════════════════════
describe("PV1 getPoints — point set + version", () => {
  it("FLAG OFF ⇒ model point set + model version, resolveEffectivePoints untouched", async () => {
    spy("getMeasurementPointDefsByProductModel").mockResolvedValue([
      { id: 1, code: "B1", positionX: 0, positionY: 0 },
      { id: 2, code: "B2", positionX: 0, positionY: 0 },
    ]);
    const caller = machineApiRouter.createCaller(ctx());
    const res = await caller.getPoints(basePayload({ productModelCode: "MODEL-A", variantCode: "EU" }));

    const pm = res.productModels[0] as any;
    expect(pm.points.map((p: any) => p.code).sort()).toEqual(["B1", "B2"]);
    expect(pm.pointsConfigVersion).toBe(3);
    expect(spy("resolveEffectivePoints")).not.toHaveBeenCalled();
  });

  it("ON + variantCode ⇒ EFFECTIVE set + variant version", async () => {
    process.env.PRODUCT_VARIANT_ENABLED = "true";
    spy("getVariantByCode").mockResolvedValue({ id: 42, isBase: false, code: "EU", pointsConfigVersion: 9 });
    spy("resolveEffectivePoints").mockResolvedValue([
      { id: 1, code: "B1", positionX: 0, positionY: 0 }, // inherited base
      { id: 5, code: "VADD", positionX: 0, positionY: 0, variantId: 42 }, // variant-added
    ]);
    const caller = machineApiRouter.createCaller(ctx());
    const res = await caller.getPoints(basePayload({ productModelCode: "MODEL-A", variantCode: "EU" }));

    const pm = res.productModels[0] as any;
    expect(pm.points.map((p: any) => p.code).sort()).toEqual(["B1", "VADD"]);
    expect(pm.pointsConfigVersion).toBe(9);
    // scoped by the NON-BASE variant id (base points are variantId NULL, but the
    // resolver takes the variant id for a non-base variant).
    expect(spy("resolveEffectivePoints")).toHaveBeenCalledWith(7, 42);
    expect(spy("getMeasurementPointDefsByProductModel")).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PV1 — deltaSyncPoints
// ════════════════════════════════════════════════════════════════════════════
describe("PV1 deltaSyncPoints — variant-aware version gate + point source", () => {
  it("FLAG OFF ⇒ model-version diff, points from getPointsChangedSinceVersion", async () => {
    spy("getPointsChangedSinceVersion").mockResolvedValue({
      points: [{ id: 1, code: "B1", positionX: 0, positionY: 0 }],
      deletedPoints: [{ id: 9, code: "OLD", deletedAt: new Date("2026-01-01T00:00:00Z"), deletedAtVersion: 2 }],
      deletedCodes: ["OLD"],
      currentVersion: 3,
    });
    const caller = machineApiRouter.createCaller(ctx());
    const res: any = await caller.deltaSyncPoints({ apiKey: "SHARED-KEY", machineCode: "AOI-01", productModelCode: "MODEL-A", sinceVersion: 1, variantCode: "EU" });

    expect(res.hasChanges).toBe(true);
    expect(res.currentVersion).toBe(3);
    expect(res.points.map((p: any) => p.code)).toEqual(["B1"]);
    expect(res.deletedCodes).toEqual(["OLD"]);
    expect(spy("resolveEffectivePoints")).not.toHaveBeenCalled();
  });

  it("ON + variant version > sinceVersion > MODEL version ⇒ variant gate fires; effective set", async () => {
    process.env.PRODUCT_VARIANT_ENABLED = "true";
    // Variant-specific bump: model still 3, variant advanced to 9. A machine at v5
    // must be told there ARE changes (a pure model-version gate would hide them).
    spy("getVariantByCode").mockResolvedValue({ id: 42, isBase: false, code: "EU", pointsConfigVersion: 9 });
    spy("resolveEffectivePoints").mockResolvedValue([
      { id: 1, code: "B1", positionX: 0, positionY: 0 },
      { id: 5, code: "VADD", positionX: 0, positionY: 0, variantId: 42 },
    ]);
    spy("getPointsChangedSinceVersion").mockResolvedValue({
      points: [], deletedPoints: [], deletedCodes: [], currentVersion: 3, // model gate would return empty at since=5
    });
    const caller = machineApiRouter.createCaller(ctx());
    const res: any = await caller.deltaSyncPoints({ apiKey: "SHARED-KEY", machineCode: "AOI-01", productModelCode: "MODEL-A", sinceVersion: 5, variantCode: "EU" });

    expect(res.hasChanges).toBe(true);
    expect(res.currentVersion).toBe(9);
    expect(res.points.map((p: any) => p.code).sort()).toEqual(["B1", "VADD"]);
    expect(spy("resolveEffectivePoints")).toHaveBeenCalledWith(7, 42);
  });

  it("ON + sinceVersion >= variant version ⇒ no changes", async () => {
    process.env.PRODUCT_VARIANT_ENABLED = "true";
    spy("getVariantByCode").mockResolvedValue({ id: 42, isBase: false, code: "EU", pointsConfigVersion: 9 });
    const caller = machineApiRouter.createCaller(ctx());
    const res: any = await caller.deltaSyncPoints({ apiKey: "SHARED-KEY", machineCode: "AOI-01", productModelCode: "MODEL-A", sinceVersion: 9, variantCode: "EU" });

    expect(res.hasChanges).toBe(false);
    expect(res.currentVersion).toBe(9);
    expect(res.points).toEqual([]);
  });
});
