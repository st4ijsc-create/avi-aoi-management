/**
 * Doc 31 B.6 (WB-3) — machine delta-sync limit write-back gate.
 *
 * PROVES THE ACTUAL BEHAVIOR of machineApi.syncMeasurementPoints (POINTS_PUSH):
 * a machine push DOES carry LSL/USL/target, so overwriting them on an EXISTING
 * point of a LIVE product is a governed direct edit (decision #4). This test drives
 * the real router via a tRPC caller and asserts:
 *   - active product + CHANGED limit → the limit fields are STRIPPED from the
 *     update (geometry/name still sync), response.limitChangesBlocked === 1
 *   - development product + CHANGED limit → the limit is APPLIED (not stripped)
 *   - UNCHANGED limit → the gate is not even consulted (idempotent re-push)
 *
 * The gate resolver is mocked so the lifecycle decision is deterministic (the
 * resolver itself is covered by thresholdGovernanceService.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── db barrel: only the fns the POINTS_PUSH path touches ─────────────────────
const updateMeasurementPointDef = vi.fn(async () => {});
const createMeasurementPointDef = vi.fn(async () => 123);
const getProductModelByCode = vi.fn();
const getMeasurementPointDefByCode = vi.fn();
vi.mock("./db", () => ({
  updateMachineHeartbeat: vi.fn(async () => {}),
  getProductModelByCode: (...a: unknown[]) => getProductModelByCode(...a),
  getMeasurementPointDefByCode: (...a: unknown[]) => getMeasurementPointDefByCode(...a),
  updateMeasurementPointDef: (...a: unknown[]) => updateMeasurementPointDef(...a),
  createMeasurementPointDef: (...a: unknown[]) => createMeasurementPointDef(...a),
  updateProductModel: vi.fn(async () => {}),
  // Doc 51 P3 batch-2 — syncMeasurementPoints now bumps ATOMICALLY (was a RMW on
  // updateProductModel). Value is irrelevant to the sync-gate assertions here.
  bumpPointsConfigVersion: vi.fn(async (id: number) => ({ productModelId: id, code: "PRD-1", version: 10 })),
  createProductSyncLog: vi.fn(async () => {}),
  createAuditLog: vi.fn(async () => ({ id: 1 })),
  getDb: vi.fn(async () => null),
}));
vi.mock("./db/aiAdvanced");
vi.mock("./services/aiEdgeEnhanced", () => ({
  confirmDeployment: vi.fn(), recordEdgeHeartbeat: vi.fn(), syncEdgeResults: vi.fn(),
}));

// Machine auth — bypass the real key lookup; return a fixed machine.
vi.mock("./services/machineAuthService", async (orig) => {
  const actual = await orig<typeof import("./services/machineAuthService")>();
  return {
    ...actual,
    authenticateMachine: vi.fn(async () => ({ machine: { id: 7, code: "MACH-1" } })),
    enforceMachineIngestRateLimit: vi.fn(() => {}),
  };
});

// _shared — keep the pure helpers (toOptionalDecimal/cleanUndefined); stub the IO.
vi.mock("./routers/_shared", async (orig) => {
  const actual = await orig<typeof import("./routers/_shared")>();
  return {
    ...actual,
    resolveWorkstationId: vi.fn(async () => null),
    uploadPointReferenceImage: vi.fn(async () => null),
  };
});

vi.mock("./services/mqttService", async (orig) => {
  const actual = await orig<typeof import("./services/mqttService")>();
  return { ...actual, publishPointsConfigChanged: vi.fn() };
});

// The gate resolver — deterministic per test.
const resolveThresholdEditGate = vi.fn();
vi.mock("./services/thresholdGovernanceService", () => ({
  resolveThresholdEditGate: (...a: unknown[]) => resolveThresholdEditGate(...a),
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function anonCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

const EXISTING_POINT = { id: 42, code: "MP-1", lowerLimit: "8", upperLimit: "9", nominalValue: "8.5" };
const PRODUCT = { id: 5, code: "PRD-1", imageWidth: null, imageHeight: null, pointsConfigVersion: 3 };

function pushInput(overrides: Partial<{ upperLimit: number; lowerLimit: number; nominalValue: number }>) {
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
        upperLimit: overrides.upperLimit ?? 9,
        lowerLimit: overrides.lowerLimit ?? 8,
        nominalValue: overrides.nominalValue ?? 8.5,
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getProductModelByCode.mockResolvedValue(PRODUCT);
  getMeasurementPointDefByCode.mockResolvedValue(EXISTING_POINT);
});

describe("syncMeasurementPoints — machine limit write-back gate (B.6)", () => {
  it("ACTIVE product + changed limit → strips limit fields, blocks (geometry still syncs)", async () => {
    resolveThresholdEditGate.mockResolvedValue({
      decision: "requires_approval", productModelId: 5, lifecycleStatus: "active",
      hasReleasedProgram: false, enforced: true,
    });
    const caller = appRouter.createCaller(anonCtx());
    const res = await caller.machineApi.syncMeasurementPoints(pushInput({ upperLimit: 10 }));

    expect(resolveThresholdEditGate).toHaveBeenCalledWith(42);
    expect(res.limitChangesBlocked).toBe(1);
    expect(res.points[0].limitBlocked).toBe(true);

    // The update was applied WITHOUT limit fields (approved limits protected)…
    const [, payload] = updateMeasurementPointDef.mock.calls[0] as [number, Record<string, unknown>];
    expect(payload).not.toHaveProperty("upperLimit");
    expect(payload).not.toHaveProperty("lowerLimit");
    expect(payload).not.toHaveProperty("nominalValue");
    // …but geometry/name still synced.
    expect(payload).toMatchObject({ name: "Điểm 1", positionX: 10, positionY: 20 });
  });

  it("DEVELOPMENT product + changed limit → applies the new limit (not stripped)", async () => {
    resolveThresholdEditGate.mockResolvedValue({
      decision: "direct", productModelId: 5, lifecycleStatus: "development",
      hasReleasedProgram: false, enforced: true,
    });
    const caller = appRouter.createCaller(anonCtx());
    const res = await caller.machineApi.syncMeasurementPoints(pushInput({ upperLimit: 10 }));

    expect(res.limitChangesBlocked).toBe(0);
    expect(res.points[0].limitBlocked).toBe(false);
    const [, payload] = updateMeasurementPointDef.mock.calls[0] as [number, Record<string, unknown>];
    expect(payload).toMatchObject({ upperLimit: "10" });
  });

  it("UNCHANGED limits → gate NOT consulted (idempotent re-push), update proceeds", async () => {
    const caller = appRouter.createCaller(anonCtx());
    const res = await caller.machineApi.syncMeasurementPoints(pushInput({})); // same as existing
    expect(resolveThresholdEditGate).not.toHaveBeenCalled();
    expect(res.limitChangesBlocked).toBe(0);
    expect(updateMeasurementPointDef).toHaveBeenCalledTimes(1);
  });
});
