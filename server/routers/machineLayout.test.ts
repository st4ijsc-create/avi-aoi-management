/**
 * machineRouter.updateLayout / updateLayoutPosition — SECURITY gating tests
 * (audit doc 25 T7). Ghi vị trí máy trên mặt bằng phải qua quyền
 * machine_control/canEdit — user read-only KHÔNG được ghi. Ngoài ra kiểm
 * ràng buộc zod: x,y ∈ [0,1], footprint ∈ [0.3,20].
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// RBAC middleware — bật/tắt bằng cờ perm.allow (mô phỏng có/không canEdit)
const perm = { allow: true };
vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => {
    if (!perm.allow) {
      const { TRPCError } = await import("@trpc/server");
      throw new TRPCError({ code: "FORBIDDEN", message: "no machine_control/canEdit" });
    }
    return next({ ctx });
  },
}));

// db.updateMachine spy — không đụng DB thật (vi.hoisted vì factory được hoist lên đầu file)
const { updateMachine } = vi.hoisted(() => ({ updateMachine: vi.fn(async () => {}) }));
vi.mock("../db", () => ({ updateMachine }));

// Bỏ qua audit fire-and-forget để không kéo theo db thật (W3-B: router giờ
// import thêm logCreate/logUpdate/logDelete/createAuditContext/ENTITY_TYPES)
vi.mock("../services/auditTrailService", () => ({
  logCrudOperation: vi.fn(async () => ({ id: 1 })),
  logCreate: vi.fn(async () => {}),
  logUpdate: vi.fn(async () => {}),
  logDelete: vi.fn(async () => {}),
  createAuditContext: vi.fn(() => ({})),
  ENTITY_TYPES: {
    FACTORY: "factory", WORKSHOP: "workshop", LINE: "line",
    STATION: "station", MACHINE: "machine",
  },
}));

import { machineRouter } from "./hierarchyRouters";

// User read-only (operator) — RBAC được quyết định bởi perm.allow ở trên
const ctx = { user: { id: 42, role: "operator", name: "Op" } } as any;
const caller = machineRouter.createCaller(ctx);

beforeEach(() => {
  perm.allow = true;
  updateMachine.mockClear();
});

describe("updateLayout — RBAC gate", () => {
  it("từ chối khi user KHÔNG có machine_control/canEdit", async () => {
    perm.allow = false;
    await expect(
      caller.updateLayout({ id: 1, x: 0.5, y: 0.5, rotationDeg: 90, footprintW: 2, footprintD: 2 }),
    ).rejects.toThrow(/FORBIDDEN|canEdit/i);
    expect(updateMachine).not.toHaveBeenCalled();
  });

  it("cho phép ghi khi có canEdit", async () => {
    const res = await caller.updateLayout({ id: 7, x: 0.25, y: 0.75, rotationDeg: 180, footprintW: 3, footprintD: 1.5 });
    expect(res).toEqual({ success: true });
    expect(updateMachine).toHaveBeenCalledWith(7, expect.objectContaining({
      layoutPositionX: "0.25",
      layoutPositionY: "0.75",
      layout: { x: 0.25, y: 0.75, rotationDeg: 180, footprintW: 3, footprintD: 1.5 },
    }));
  });
});

describe("updateLayoutPosition — RBAC gate", () => {
  it("từ chối khi user KHÔNG có canEdit", async () => {
    perm.allow = false;
    await expect(
      caller.updateLayoutPosition({ id: 1, layoutPositionX: 0.5, layoutPositionY: 0.5 }),
    ).rejects.toThrow(/FORBIDDEN|canEdit/i);
    expect(updateMachine).not.toHaveBeenCalled();
  });

  it("cho phép ghi khi có canEdit", async () => {
    const res = await caller.updateLayoutPosition({ id: 3, layoutPositionX: 0.1, layoutPositionY: 0.9 });
    expect(res).toEqual({ success: true });
    expect(updateMachine).toHaveBeenCalledWith(3, { layoutPositionX: "0.1", layoutPositionY: "0.9" });
  });
});

describe("updateLayout — validate ràng buộc zod", () => {
  it("từ chối x ngoài [0,1]", async () => {
    await expect(caller.updateLayout({ id: 1, x: 1.5, y: 0.5 })).rejects.toThrow();
    await expect(caller.updateLayout({ id: 1, x: -0.1, y: 0.5 })).rejects.toThrow();
  });

  it("từ chối y ngoài [0,1]", async () => {
    await expect(caller.updateLayout({ id: 1, x: 0.5, y: 2 })).rejects.toThrow();
    await expect(caller.updateLayout({ id: 1, x: 0.5, y: -0.5 })).rejects.toThrow();
  });

  it("từ chối footprint ngoài [0.3,20]", async () => {
    await expect(caller.updateLayout({ id: 1, x: 0.5, y: 0.5, footprintW: 0.1 })).rejects.toThrow();
    await expect(caller.updateLayout({ id: 1, x: 0.5, y: 0.5, footprintW: 25 })).rejects.toThrow();
    await expect(caller.updateLayout({ id: 1, x: 0.5, y: 0.5, footprintD: 0.2 })).rejects.toThrow();
    await expect(caller.updateLayout({ id: 1, x: 0.5, y: 0.5, footprintD: 21 })).rejects.toThrow();
    expect(updateMachine).not.toHaveBeenCalled();
  });

  it("chấp nhận biên hợp lệ (footprint 0.3 và 20)", async () => {
    await caller.updateLayout({ id: 1, x: 0, y: 1, footprintW: 0.3, footprintD: 20 });
    expect(updateMachine).toHaveBeenCalled();
  });
});

describe("updateLayoutPosition — validate x,y ∈ [0,1]", () => {
  it("từ chối toạ độ ngoài khoảng", async () => {
    await expect(caller.updateLayoutPosition({ id: 1, layoutPositionX: 1.2, layoutPositionY: 0.5 })).rejects.toThrow();
    await expect(caller.updateLayoutPosition({ id: 1, layoutPositionX: 0.5, layoutPositionY: -0.3 })).rejects.toThrow();
    expect(updateMachine).not.toHaveBeenCalled();
  });
});
