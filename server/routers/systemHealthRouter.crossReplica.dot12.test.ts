/**
 * doc 81 Đợt 12 task P fix 1 (M-3) — systemHealth.crossReplicaChannels: the OT STOP epoch sync status and the device_owner_changed
 * listener status, admin_system/canView, read-only; never key material.
 */
import { describe, it, expect, vi } from "vitest";

const perm = { allow: true };
vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => {
    if (!perm.allow) {
      const { TRPCError } = await import("@trpc/server");
      throw new TRPCError({ code: "FORBIDDEN", message: "no admin_system/canView" });
    }
    return next({ ctx });
  },
}));
vi.mock("../services/ot/storeForward", () => ({ getStatus: vi.fn(() => ({ enabled: false })) }));
vi.mock("../services/ot/otManager", () => ({ listSupervisorStatuses: vi.fn(() => []), isConnHaEnabled: vi.fn(() => false), isOtRunning: vi.fn(() => false) }));
vi.mock("../services/aiImageEmbedding", () => ({ getDinov2ModelHealth: vi.fn(async () => ({ modelPresent: false })) }));
vi.mock("../services/ot/otStopEpochSync", () => ({ otStopEpochSyncStatus: () => ({ running: true, state: "ok", keySource: "SECRET_ENCRYPTION_KEY", rejected: 0 }) }));
vi.mock("../services/robot/deviceOwnershipService", () => ({ deviceOwnerListenerStatus: () => ({ channel: "device_owner_changed", state: "degraded", reconnects: 2 }) }));

import { systemHealthRouter } from "./systemHealthRouter";

const caller = () => systemHealthRouter.createCaller({ user: { id: 1, role: "admin" } } as never);

describe("systemHealth.crossReplicaChannels", () => {
  it("★ returns both channel statuses", async () => {
    perm.allow = true;
    const r = await caller().crossReplicaChannels();
    expect(r).toEqual({
      otStopEpoch: { running: true, state: "ok", keySource: "SECRET_ENCRYPTION_KEY", rejected: 0 },
      deviceOwner: { channel: "device_owner_changed", state: "degraded", reconnects: 2 },
    });
  });
  it("admin_system/canView enforced", async () => {
    perm.allow = false;
    await expect(caller().crossReplicaChannels()).rejects.toMatchObject({ code: "FORBIDDEN" });
    perm.allow = true;
  });
});
