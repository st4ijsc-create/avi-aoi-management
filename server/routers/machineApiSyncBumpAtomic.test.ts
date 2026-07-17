/**
 * Doc 51 P3 batch-2 (§11.2/§12.2 CASE #12) — syncMeasurementPoints bumps
 * pointsConfigVersion ATOMICALLY (db.bumpPointsConfigVersion), NOT via a
 * read-modify-write on updateProductModel.
 *
 * THE BUG this closes: the POINTS_PUSH path read `productModel.pointsConfigVersion`,
 * added 1 in JS, and wrote it back with updateProductModel. Two concurrent pushes
 * that both read version N both wrote N+1 → two distinct config changes shipped
 * under ONE version number, and a machine already on N+1 skips the second change
 * forever. `bumpPointsConfigVersion` is `col = col + 1 RETURNING` under a row lock.
 *
 * Mutation-test: RED if the code reverts to the RMW — bumpPointsConfigVersion would
 * not be called, updateProductModel WOULD be, and two sequential syncs (a mocked
 * atomic counter) would both report N+1 instead of N+1 then N+2.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const EXISTING_UPDATED_AT = new Date("2026-07-15T10:00:00.000Z");

// A mocked ATOMIC counter: each call increments and returns the NEW version, exactly
// as `UPDATE ... SET col = col + 1 RETURNING` would under a row lock.
let liveVersion = 9;
const bumpPointsConfigVersion = vi.fn(async (_id: number) => ({
  productModelId: 5,
  code: "PRD-1",
  version: ++liveVersion,
}));
const updateProductModel = vi.fn(async () => {});
const publishPointsConfigChanged = vi.fn();

vi.mock("../db", () => ({
  updateMachineHeartbeat: vi.fn(async () => {}),
  getProductModelByCode: vi.fn(async () => ({
    id: 5, code: "PRD-1", name: "Prod 1", imageWidth: null, imageHeight: null,
    pointsConfigVersion: 9, coordinateMode: "mm", referenceImageUrl: null,
  })),
  getMeasurementPointDefByCode: vi.fn(async () => ({
    id: 42, code: "MP-1", updatedAt: EXISTING_UPDATED_AT,
    lowerLimit: "8", upperLimit: "9", nominalValue: "8.5",
  })),
  updateMeasurementPointDef: vi.fn(async () => {}),
  createMeasurementPointDef: vi.fn(async () => 123),
  bumpPointsConfigVersion: (...a: any[]) => bumpPointsConfigVersion(...(a as [number])),
  updateProductModel: (...a: any[]) => updateProductModel(...(a as [])),
  createProductSyncLog: vi.fn(async () => {}),
  createAuditLog: vi.fn(async () => ({ id: 1 })),
  isStaleUpdate: vi.fn(() => false),
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
  return { ...actual, publishPointsConfigChanged: (...a: any[]) => publishPointsConfigChanged(...a) };
});
vi.mock("../services/thresholdGovernanceService", () => ({
  resolveThresholdEditGate: vi.fn(async () => ({
    decision: "direct", lifecycleStatus: "development", hasReleasedProgram: false, enforced: false,
  })),
}));

import { machineApiRouter } from "./machineApiRouters";
import type { TrpcContext } from "../_core/context";

function ctx(): TrpcContext {
  return { user: null, req: { protocol: "https", headers: {} } as any, res: {} as any } as TrpcContext;
}

function pushInput() {
  return {
    apiKey: "k",
    productModelCode: "PRD-1",
    points: [{
      code: "MP-1", name: "Điểm 1", measurementType: "DIMENSION" as const,
      positionX: 10, positionY: 20, upperLimit: 9, lowerLimit: 8, nominalValue: 8.5,
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  liveVersion = 9;
});

describe("syncMeasurementPoints — atomic pointsConfigVersion bump", () => {
  it("★ bumps via db.bumpPointsConfigVersion (NOT updateProductModel) and returns the RETURNING version", async () => {
    const res = await machineApiRouter.createCaller(ctx()).syncMeasurementPoints(pushInput());

    expect(bumpPointsConfigVersion).toHaveBeenCalledWith(5);
    // The RMW write-back is gone: no updateProductModel version stomp.
    expect(updateProductModel).not.toHaveBeenCalled();
    // Response carries the atomic RETURNING value, and the fleet is notified with it
    // (broadcast by the bumped CODE + version; machineCode is undefined here since the
    // input omits it — the point is that publish uses the atomic result, not a RMW).
    expect(res.pointsConfigVersion).toBe(10);
    expect(publishPointsConfigChanged).toHaveBeenCalledWith("PRD-1", 10, undefined);
  });

  it("★ two sequential syncs advance +2 (no lost update) — 10 then 11", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    const r1 = await caller.syncMeasurementPoints(pushInput());
    const r2 = await caller.syncMeasurementPoints(pushInput());
    // Under the old RMW (static read of version 9) both would report 10.
    expect([r1.pointsConfigVersion, r2.pointsConfigVersion]).toEqual([10, 11]);
    expect(bumpPointsConfigVersion).toHaveBeenCalledTimes(2);
  });
});
