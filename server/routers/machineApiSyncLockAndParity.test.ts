/**
 * Doc 51 P2 batch-2 (§5.2 P2) — machine-push OPTIMISTIC LOCK + getPoints GEOMETRY
 * PARITY. Drives the real machineApi router via a tRPC caller.
 *
 * Proves (each a mutation-test — RED if the fix is reverted):
 *   • syncMeasurementPoints threads a machine-sent expectedUpdatedAt into
 *     updateMeasurementPointDef only when MACHINE_SYNC_OPTIMISTIC_LOCK is ON:
 *       - stale value + lock ON → per-point CONFLICT, staleConflicts=1, NOT written.
 *       - fresh value + lock ON → written, staleConflicts=0.
 *       - stale value + lock OFF → still written (blind) but a 'blindOverwrite'
 *         audit fires + blindOverwrites=1.
 *       - no value → blind, no audit, no options passed (back-compat).
 *   • getPoints returns shape/geometry/cells/fiducials/coordinateMode IDENTICAL to
 *     deltaSyncPoints for the same point (init parity).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const EXISTING_UPDATED_AT = new Date("2026-07-15T10:00:00.000Z");

// ── captured calls / knobs ───────────────────────────────────────────────────
const updateMeasurementPointDef = vi.fn(
  async (_id: number, _payload: Record<string, unknown>, options?: { expectedUpdatedAt?: Date | string | null }) => {
    if (options?.expectedUpdatedAt != null) {
      const exp = new Date(options.expectedUpdatedAt).getTime();
      if (exp !== EXISTING_UPDATED_AT.getTime()) {
        const e: any = new Error("stale");
        e.code = "MP_STALE_WRITE";
        throw e;
      }
    }
  },
);
const createAuditLog = vi.fn(async () => ({ id: 1 }));
const getProductModelByCode = vi.fn();
const getMeasurementPointDefByCode = vi.fn();
const getMeasurementPointDefsByProductModel = vi.fn();
const getPointsChangedSinceVersion = vi.fn();
const getFiducialMarksByProductModel = vi.fn(async () => [] as any[]);
const listMpLightingProfilesByPointDefIds = vi.fn(async () => new Map<number, any[]>());

function realIsStaleUpdate(cur: any, exp: any): boolean {
  if (exp == null) return false;
  const c = cur instanceof Date ? cur : cur != null ? new Date(cur) : null;
  const e = exp instanceof Date ? exp : new Date(exp);
  if (!c || Number.isNaN(c.getTime()) || Number.isNaN(e.getTime())) return false;
  return c.getTime() !== e.getTime();
}

vi.mock("../db", () => ({
  updateMachineHeartbeat: vi.fn(async () => {}),
  getProductModelByCode: (...a: unknown[]) => getProductModelByCode(...a),
  getMeasurementPointDefByCode: (...a: unknown[]) => getMeasurementPointDefByCode(...a),
  getMeasurementPointDefsByProductModel: (...a: unknown[]) => getMeasurementPointDefsByProductModel(...a),
  updateMeasurementPointDef: (...a: unknown[]) => (updateMeasurementPointDef as any)(...a),
  createMeasurementPointDef: vi.fn(async () => 123),
  updateProductModel: vi.fn(async () => {}),
  createProductSyncLog: vi.fn(async () => {}),
  createAuditLog: (...a: unknown[]) => createAuditLog(...(a as [])),
  isStaleUpdate: (...a: unknown[]) => realIsStaleUpdate(a[0], a[1]),
  getPointsChangedSinceVersion: (...a: unknown[]) => getPointsChangedSinceVersion(...a),
  getFiducialMarksByProductModel: (...a: unknown[]) => getFiducialMarksByProductModel(...a),
  listMpLightingProfilesByPointDefIds: (...a: unknown[]) => listMpLightingProfilesByPointDefIds(...a),
  getMappingsByMachine: vi.fn(async () => []),
  getDb: vi.fn(async () => null),
}));
vi.mock("../db/aiAdvanced");
vi.mock("../services/aiEdgeEnhanced", () => ({
  confirmDeployment: vi.fn(), recordEdgeHeartbeat: vi.fn(), syncEdgeResults: vi.fn(),
}));

vi.mock("../services/machineAuthService", async (orig) => {
  const actual = await orig<typeof import("../services/machineAuthService")>();
  return {
    ...actual,
    authenticateMachine: vi.fn(async () => ({ machine: { id: 7, code: "MACH-1" }, method: "api-key" })),
    enforceMachineIngestRateLimit: vi.fn(() => {}),
  };
});
vi.mock("../routers/_shared", async (orig) => {
  const actual = await orig<typeof import("../routers/_shared")>();
  return { ...actual, resolveWorkstationId: vi.fn(async () => null), uploadPointReferenceImage: vi.fn(async () => null) };
});
vi.mock("../services/mqttService", async (orig) => {
  const actual = await orig<typeof import("../services/mqttService")>();
  return { ...actual, publishPointsConfigChanged: vi.fn() };
});
// The gate resolver — a limit change is NOT what these tests exercise; return direct.
vi.mock("../services/thresholdGovernanceService", () => ({
  resolveThresholdEditGate: vi.fn(async () => ({
    decision: "direct", lifecycleStatus: "development", hasReleasedProgram: false, enforced: false,
  })),
}));

import { machineApiRouter } from "./machineApiRouters";
import type { TrpcContext } from "../_core/context";

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}

const PRODUCT = { id: 5, code: "PRD-1", name: "Prod 1", imageWidth: null, imageHeight: null, pointsConfigVersion: 9, coordinateMode: "mm", referenceImageUrl: null };
const EXISTING_POINT = {
  id: 42, code: "MP-1", updatedAt: EXISTING_UPDATED_AT,
  lowerLimit: "8", upperLimit: "9", nominalValue: "8.5",
};

function pushInput(over: Record<string, unknown> = {}) {
  return {
    apiKey: "k",
    productModelCode: "PRD-1",
    points: [
      {
        code: "MP-1",
        name: "Điểm 1",
        measurementType: "DIMENSION" as const,
        positionX: 10,
        positionY: 20,
        // Same limits as EXISTING → the limit gate is never consulted.
        upperLimit: 9,
        lowerLimit: 8,
        nominalValue: 8.5,
        ...over,
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.MACHINE_SYNC_OPTIMISTIC_LOCK;
  getProductModelByCode.mockResolvedValue(PRODUCT);
  getMeasurementPointDefByCode.mockResolvedValue(EXISTING_POINT);
});

describe("syncMeasurementPoints — optimistic lock (§5.2 P2)", () => {
  it("★ lock ON + STALE expectedUpdatedAt → CONFLICT, point NOT written", async () => {
    process.env.MACHINE_SYNC_OPTIMISTIC_LOCK = "true";
    const stale = new Date(EXISTING_UPDATED_AT.getTime() - 3_600_000).toISOString();
    const res = await machineApiRouter.createCaller(ctx()).syncMeasurementPoints(
      pushInput({ expectedUpdatedAt: stale }),
    );
    expect(res.optimisticLockEnforced).toBe(true);
    expect(res.staleConflicts).toBe(1);
    expect(res.updated).toBe(0);
    expect(res.errors[0].message).toContain("CONFLICT");
    // updateMeasurementPointDef WAS called with the lock option (it threw).
    const call = updateMeasurementPointDef.mock.calls[0];
    expect(call[2]).toMatchObject({ expectedUpdatedAt: expect.anything() });
  });

  it("★ lock ON + FRESH expectedUpdatedAt → written, no conflict", async () => {
    process.env.MACHINE_SYNC_OPTIMISTIC_LOCK = "true";
    const res = await machineApiRouter.createCaller(ctx()).syncMeasurementPoints(
      pushInput({ expectedUpdatedAt: EXISTING_UPDATED_AT.toISOString() }),
    );
    expect(res.staleConflicts).toBe(0);
    expect(res.updated).toBe(1);
    expect(updateMeasurementPointDef.mock.calls[0][2]).toMatchObject({ expectedUpdatedAt: expect.anything() });
  });

  it("★ lock OFF + STALE expectedUpdatedAt → BLIND write + 'blindOverwrite' audit", async () => {
    // flag unset (default OFF)
    const stale = new Date(EXISTING_UPDATED_AT.getTime() - 3_600_000).toISOString();
    const res = await machineApiRouter.createCaller(ctx()).syncMeasurementPoints(
      pushInput({ expectedUpdatedAt: stale }),
    );
    expect(res.optimisticLockEnforced).toBe(false);
    expect(res.staleConflicts).toBe(0);
    expect(res.blindOverwrites).toBe(1);
    expect(res.updated).toBe(1);
    // audit fired, and the write was BLIND (no lock option passed → 3rd arg undefined)
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "measurementPoint.blindOverwrite" }),
    );
    expect(updateMeasurementPointDef.mock.calls[0][2]).toBeUndefined();
  });

  it("no expectedUpdatedAt → blind write, no audit, back-compat (3rd arg undefined)", async () => {
    const res = await machineApiRouter.createCaller(ctx()).syncMeasurementPoints(pushInput());
    expect(res.blindOverwrites).toBe(0);
    expect(res.updated).toBe(1);
    expect(createAuditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "measurementPoint.blindOverwrite" }),
    );
    expect(updateMeasurementPointDef.mock.calls[0][2]).toBeUndefined();
  });
});

describe("getPoints — geometry parity with deltaSyncPoints (§5.2 P2, init)", () => {
  // An ARRAY-shape point: getPoints must ship shape/geometry/cells or a machine
  // initialising via getPoints treats it as a bare circle.
  const ARRAY_GEOMETRY = {
    shape: "array" as const, rows: 2, cols: 2, pitchX: 10, pitchY: 10,
    originX: 0, originY: 0, cellShape: "circle" as const, cellGeometry: { radius: 3 },
  };
  const POINT = {
    id: 42, code: "MP-1", name: "Điểm 1", description: null, measurementType: "DIMENSION",
    unit: "mm", lowerLimit: "1", upperLimit: "9", nominalValue: "5",
    positionX: 10, positionY: 20, radius: 5,
    normalizedX: null, normalizedY: null, normalizedRadius: null,
    cropWidth: 100, cropHeight: 100, orderIndex: 0, isActive: true,
    referenceImageUrl: null, workstationId: null,
    shape: "array", geometry: ARRAY_GEOMETRY,
    heightMin: "2", coplanarityMax: "0.1", criteria: [{ kind: "numeric_range", metric: "height", max: 5 }],
    lastModifiedAt: new Date("2026-07-14T00:00:00Z"),
  };
  const FID = { id: 1, code: "F1", name: "Fid 1", type: "cross", positionX: 3, positionY: 4, normalizedX: null, normalizedY: null, searchWindowW: 80, searchWindowH: 80, templateImageUrl: null, orderIndex: 0 };

  beforeEach(() => {
    getMeasurementPointDefsByProductModel.mockResolvedValue([POINT]);
    getFiducialMarksByProductModel.mockResolvedValue([FID]);
    getPointsChangedSinceVersion.mockResolvedValue({
      points: [POINT], deletedPoints: [], deletedCodes: [], currentVersion: 9,
    });
  });

  it("★ getPoints ships shape/geometry/cells/fiducials/coordinateMode identical to deltaSync", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    const gp = await caller.getPoints({ apiKey: "k", productModelCode: "PRD-1" });
    const ds = await caller.deltaSyncPoints({ apiKey: "k", productModelCode: "PRD-1", sinceVersion: 4 });

    const gpModel = gp.productModels[0] as any;
    const gpPoint = gpModel.points[0] as any;
    const dsPoint = ds.points[0] as any;

    // The geometry the old getPoints DROPPED is now present + equal to deltaSync.
    expect(gpPoint.shape).toBe("array");
    expect(gpPoint.geometry).toEqual(ARRAY_GEOMETRY);
    expect(gpPoint.cells).toBeDefined();
    expect(gpPoint.cells).toHaveLength(4);          // 2×2 array expanded
    expect(gpPoint.cells).toEqual(dsPoint.cells);   // identical projection
    expect(gpPoint.geometry).toEqual(dsPoint.geometry);
    expect(gpPoint.shape).toEqual(dsPoint.shape);

    // Fiducials + coordinateMode now surface on the model entry (deltaSync parity).
    expect(gpModel.coordinateMode).toBe("mm");
    expect(gpModel.fiducials).toEqual(ds.fiducials);

    // Legacy fields preserved.
    expect(gpPoint.id).toBe(42);
    expect(gpPoint).toHaveProperty("workstationId");
    expect(gpPoint).toHaveProperty("referenceImageUrl");
  });
});
