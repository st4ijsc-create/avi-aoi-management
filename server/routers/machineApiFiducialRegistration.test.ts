/**
 * Doc 55 Item 2 (CASE #11) — FIDUCIAL REGISTRATION wiring into
 * syncMeasurementPoints (Phase P1). Drives the REAL machineApi router via a tRPC
 * caller; the fiducial MATH lib (server/lib/fiducialRegistration) runs for real
 * (NOT mocked) so the similarity fit + residual gate are exercised end-to-end.
 *
 * Proves (each a mutation-test — RED if the wiring is reverted):
 *   • Flag OFF → byte-identical: a pushed point keeps its positionX/Y exactly,
 *     `registrationApplied=false`, EVEN when observedFiducials are supplied.
 *   • Flag ON + fiducials that match by code under a pure TRANSLATION → the point
 *     is re-projected observed→canonical, `registrationApplied=true`, residual≈0<5,
 *     and the resolution-scale branch is SUBSUMED (QĐ#9).
 *   • Flag ON + a fit the similarity can't explain (anisotropic stretch, RMS>5) →
 *     FALLBACK to legacy coords, `registrationApplied=false`,
 *     reason='residual_exceeded' (QĐ#7).
 *   • Flag ON + fewer than MACHINE_FIDUCIAL_MIN_MARKS observed → FALLBACK,
 *     reason='insufficient'.
 *   • Flag ON + observed codes that don't match any canonical fiducial → no pairs →
 *     FALLBACK, reason='insufficient'.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── captured calls / knobs ───────────────────────────────────────────────────
const createMeasurementPointDef = vi.fn(async (_payload: Record<string, unknown>) => 123);
const getProductModelByCode = vi.fn();
const getMeasurementPointDefByCode = vi.fn();
const getFiducialMarksByProductModel = vi.fn(async () => [] as any[]);
const createProductSyncLog = vi.fn(async () => {});

vi.mock("../db", () => ({
  updateMachineHeartbeat: vi.fn(async () => {}),
  getProductModelByCode: (...a: unknown[]) => getProductModelByCode(...a),
  getMeasurementPointDefByCode: (...a: unknown[]) => getMeasurementPointDefByCode(...a),
  getMeasurementPointDefsByProductModel: vi.fn(async () => []),
  updateMeasurementPointDef: vi.fn(async () => {}),
  createMeasurementPointDef: (...a: unknown[]) => (createMeasurementPointDef as any)(...a),
  updateProductModel: vi.fn(async () => {}),
  bumpPointsConfigVersion: vi.fn(async (id: number) => ({ productModelId: id, code: "PRD-1", version: 10 })),
  createProductSyncLog: (...a: unknown[]) => (createProductSyncLog as any)(...a),
  createAuditLog: vi.fn(async () => ({ id: 1 })),
  isStaleUpdate: vi.fn(() => false),
  getFiducialMarksByProductModel: (...a: unknown[]) => getFiducialMarksByProductModel(...a),
  listMpLightingProfilesByPointDefIds: vi.fn(async () => new Map<number, any[]>()),
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

// Product WITH server dimensions so normalized is computed alongside the absolute
// coords (exercises the full Case-0 body).
const PRODUCT = {
  id: 5, code: "PRD-1", name: "Prod 1",
  imageWidth: 1000, imageHeight: 1000,
  pointsConfigVersion: 9, coordinateMode: "pixel", referenceImageUrl: null,
};

// A single NEW measurement point the machine observed at (200,150) in its frame.
function pushInput(over: Record<string, unknown> = {}) {
  return {
    apiKey: "k",
    productModelCode: "PRD-1",
    points: [
      {
        code: "MP-1",
        name: "Điểm 1",
        measurementType: "DIMENSION" as const,
        positionX: 200,
        positionY: 150,
      },
    ],
    ...over,
  };
}

/** Payload the router handed to createMeasurementPointDef (the persisted row). */
function writtenPoint(): Record<string, any> {
  return createMeasurementPointDef.mock.calls[0][0] as Record<string, any>;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.MACHINE_FIDUCIAL_REGISTRATION;
  delete process.env.MACHINE_FIDUCIAL_MIN_MARKS;
  delete process.env.MACHINE_FIDUCIAL_MAX_RESIDUAL_PX;
  getProductModelByCode.mockResolvedValue(PRODUCT);
  getMeasurementPointDefByCode.mockResolvedValue(null); // create-path
  getFiducialMarksByProductModel.mockResolvedValue([]);
});

describe("syncMeasurementPoints — fiducial registration OFF (byte-identical)", () => {
  it("flag OFF → coords untouched, registrationApplied=false, even WITH observedFiducials", async () => {
    // Canonical fiducials present + observed fiducials supplied, but the master
    // switch is OFF → the whole feature is inert (QĐ#1 backward-compat).
    getFiducialMarksByProductModel.mockResolvedValue([
      { code: "F1", positionX: 100, positionY: 100 },
      { code: "F2", positionX: 400, positionY: 200 },
    ]);
    const res = await machineApiRouter.createCaller(ctx()).syncMeasurementPoints(
      pushInput({
        observedFiducials: [
          { code: "F1", observedX: 130, observedY: 80 },
          { code: "F2", observedX: 430, observedY: 180 },
        ],
      }),
    );
    expect(res.registrationApplied).toBe(false);
    expect(res.registrationResidualPx).toBeUndefined();
    expect(res.registrationRejectedReason).toBeUndefined();
    // Byte-identical: legacy Case-3 keeps the observed absolute coords as-is.
    expect(writtenPoint().positionX).toBe(200);
    expect(writtenPoint().positionY).toBe(150);
    // sync_logs telemetry: no coordinate transformation happened.
    expect(createProductSyncLog.mock.calls[0][0].coordTransformations).toBe(0);
  });
});

describe("syncMeasurementPoints — fiducial registration ON", () => {
  it("★ pure TRANSLATION fit → point re-projected observed→canonical, applied, residual≈0", async () => {
    process.env.MACHINE_FIDUCIAL_REGISTRATION = "true";
    // Board sat shifted: observed = canonical + (30,-20). Fit maps observed→canonical
    // (i.e. x-30, y+20). Observed point (200,150) → canonical (170,170).
    getFiducialMarksByProductModel.mockResolvedValue([
      { code: "F1", positionX: 100, positionY: 100 },
      { code: "F2", positionX: 400, positionY: 200 },
    ]);
    const res = await machineApiRouter.createCaller(ctx()).syncMeasurementPoints(
      pushInput({
        observedFiducials: [
          { code: "F1", observedX: 130, observedY: 80 },
          { code: "F2", observedX: 430, observedY: 180 },
        ],
      }),
    );
    expect(res.registrationApplied).toBe(true);
    expect(res.registrationFiducialCount).toBe(2);
    expect(res.registrationResidualPx).toBeLessThan(5);
    expect(res.registrationResidualPx).toBeCloseTo(0, 6);
    expect(res.registrationRejectedReason).toBeUndefined();
    // The written point moved into the canonical frame.
    expect(writtenPoint().positionX).toBe(170);
    expect(writtenPoint().positionY).toBe(170);
    // Every point re-projected ⇒ counted as a coordinate transformation.
    expect(res.coordTransformed).toBe(1);
    expect(createProductSyncLog.mock.calls[0][0].coordTransformations).toBe(1);
  });

  it("★ non-similarity distortion (RMS>5) → FALLBACK, reason=residual_exceeded, coords legacy", async () => {
    process.env.MACHINE_FIDUCIAL_REGISTRATION = "true";
    // Anisotropic Y-stretch a similarity cannot represent → best-fit RMS ≈ 18px.
    getFiducialMarksByProductModel.mockResolvedValue([
      { code: "F1", positionX: 0, positionY: 0 },
      { code: "F2", positionX: 100, positionY: 0 },
      { code: "F3", positionX: 0, positionY: 100 },
    ]);
    const res = await machineApiRouter.createCaller(ctx()).syncMeasurementPoints(
      pushInput({
        observedFiducials: [
          { code: "F1", observedX: 0, observedY: 0 },
          { code: "F2", observedX: 100, observedY: 0 },
          { code: "F3", observedX: 0, observedY: 200 },
        ],
      }),
    );
    expect(res.registrationApplied).toBe(false);
    expect(res.registrationRejectedReason).toBe("residual_exceeded");
    expect(res.registrationFiducialCount).toBe(3);
    expect(res.registrationResidualPx).toBeGreaterThan(5);
    // Fell back to legacy coords — point unchanged.
    expect(writtenPoint().positionX).toBe(200);
    expect(writtenPoint().positionY).toBe(150);
    expect(createProductSyncLog.mock.calls[0][0].coordTransformations).toBe(0);
  });

  it("fewer than MIN_MARKS observed → FALLBACK, reason=insufficient", async () => {
    process.env.MACHINE_FIDUCIAL_REGISTRATION = "true";
    getFiducialMarksByProductModel.mockResolvedValue([
      { code: "F1", positionX: 100, positionY: 100 },
      { code: "F2", positionX: 400, positionY: 200 },
    ]);
    const res = await machineApiRouter.createCaller(ctx()).syncMeasurementPoints(
      pushInput({
        observedFiducials: [{ code: "F1", observedX: 130, observedY: 80 }], // only 1
      }),
    );
    expect(res.registrationApplied).toBe(false);
    expect(res.registrationRejectedReason).toBe("insufficient");
    expect(writtenPoint().positionX).toBe(200);
    expect(writtenPoint().positionY).toBe(150);
  });

  it("observed codes match NO canonical fiducial → no pairs → FALLBACK insufficient", async () => {
    process.env.MACHINE_FIDUCIAL_REGISTRATION = "true";
    getFiducialMarksByProductModel.mockResolvedValue([
      { code: "F1", positionX: 100, positionY: 100 },
      { code: "F2", positionX: 400, positionY: 200 },
    ]);
    const res = await machineApiRouter.createCaller(ctx()).syncMeasurementPoints(
      pushInput({
        observedFiducials: [
          { code: "ZZZ", observedX: 130, observedY: 80 },
          { code: "YYY", observedX: 430, observedY: 180 },
        ],
      }),
    );
    expect(res.registrationApplied).toBe(false);
    expect(res.registrationRejectedReason).toBe("insufficient");
    expect(res.registrationFiducialCount).toBe(0);
    expect(writtenPoint().positionX).toBe(200);
    expect(writtenPoint().positionY).toBe(150);
  });

  it("configurable MIN_MARKS=3 rejects a 2-fiducial push as insufficient", async () => {
    process.env.MACHINE_FIDUCIAL_REGISTRATION = "true";
    process.env.MACHINE_FIDUCIAL_MIN_MARKS = "3";
    getFiducialMarksByProductModel.mockResolvedValue([
      { code: "F1", positionX: 100, positionY: 100 },
      { code: "F2", positionX: 400, positionY: 200 },
    ]);
    const res = await machineApiRouter.createCaller(ctx()).syncMeasurementPoints(
      pushInput({
        observedFiducials: [
          { code: "F1", observedX: 130, observedY: 80 },
          { code: "F2", observedX: 430, observedY: 180 },
        ],
      }),
    );
    expect(res.registrationApplied).toBe(false);
    expect(res.registrationRejectedReason).toBe("insufficient");
    expect(writtenPoint().positionX).toBe(200);
  });
});
