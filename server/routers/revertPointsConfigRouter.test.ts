/**
 * Doc 51 P3 batch-2 (§5.2 P3) — measurementPoint.revertPointsConfigToVersion ROUTER
 * wiring. The DB reconstruction logic itself is proven in
 * server/db/revertPointsConfig.test.ts; here we prove the router:
 *   • delegates to db.revertPointsConfigToVersion with the caller's user for audit,
 *   • publishes the NEW (forward) version so the fleet re-fetches,
 *   • writes an audit log,
 *   • maps an out-of-range target (RevertVersionError) → BAD_REQUEST (not 500),
 *   • maps a gone product (null) → NOT_FOUND,
 *   • still succeeds when the MQTT broker is down (poll is the fallback).
 *
 * Mutation-test: RED if the publish is dropped, the version isn't forwarded, or the
 * RevertVersionError is not mapped to BAD_REQUEST.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted so the vi.mock factory (which returns the class as a VALUE) can reach it.
const { RevertVersionError } = vi.hoisted(() => {
  class RevertVersionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "RevertVersionError";
    }
  }
  return { RevertVersionError };
});

const revertSpy = vi.fn();
const auditSpy = vi.fn(async () => ({ id: 1 }));

vi.mock("../db", () => ({
  revertPointsConfigToVersion: (...a: any[]) => revertSpy(...a),
  RevertVersionError,
  createAuditLog: (...a: any[]) => auditSpy(...a),
}));

const publishSpy = vi.fn();
vi.mock("../services/mqttService", () => ({
  publishPointsConfigChanged: (...a: any[]) => publishSpy(...a),
}));

// Services loaded at module-eval by productRouters — stub the ones the version-bump
// suite stubs so importing the router never hits real implementations.
vi.mock("../services/thresholdGovernanceService", () => ({
  assertThresholdEditAllowed: vi.fn(async () => ({ decision: "direct" })),
}));
vi.mock("../services/componentLinkBackfill", () => ({
  backfillComponentCodesFromBom: vi.fn(async () => ({})),
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

const SUMMARY = {
  productModelId: 7,
  code: "PM-7",
  targetVersion: 1,
  fromVersion: 3,
  newVersion: 4,
  pointsReverted: 2,
  pointsUnchanged: 1,
  pointsSkipped: 0,
  skippedPointIds: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  revertSpy.mockResolvedValue({ ...SUMMARY });
});

describe("measurementPoint.revertPointsConfigToVersion", () => {
  it("★ delegates, publishes the FORWARD version, audits", async () => {
    const res = await caller.revertPointsConfigToVersion({ productModelId: 7, targetVersion: 1, reason: "bad push" });

    expect(revertSpy).toHaveBeenCalledWith(7, 1, expect.objectContaining({ changedBy: 5 }));
    // Machines must be told to converge to the NEW version, not the target.
    expect(publishSpy).toHaveBeenCalledWith("PM-7", 4);
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: "measurementPoint.revertPointsConfig" }),
    );
    expect(res).toMatchObject({ newVersion: 4, targetVersion: 1, pointsReverted: 2 });
  });

  it("★ out-of-range target (RevertVersionError) → BAD_REQUEST, no publish", async () => {
    revertSpy.mockRejectedValueOnce(new RevertVersionError("targetVersion (5) must be below the current"));

    await expect(
      caller.revertPointsConfigToVersion({ productModelId: 7, targetVersion: 5 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("gone product (null) → NOT_FOUND", async () => {
    revertSpy.mockResolvedValueOnce(null);

    await expect(
      caller.revertPointsConfigToVersion({ productModelId: 7, targetVersion: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("succeeds even when the MQTT broker is down (poll is the fallback)", async () => {
    publishSpy.mockImplementationOnce(() => { throw new Error("broker down"); });

    await expect(
      caller.revertPointsConfigToVersion({ productModelId: 7, targetVersion: 1 }),
    ).resolves.toMatchObject({ newVersion: 4 });
  });
});
