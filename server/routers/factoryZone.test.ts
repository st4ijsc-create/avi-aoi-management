/**
 * factoryZoneRouter — CRUD + SECURITY gating tests (audit doc 25 · W6-25).
 * Vùng polygon trên mặt bằng: đọc mở cho user đăng nhập; ghi (create/update/delete)
 * phải qua machine_control/canEdit — user read-only KHÔNG được ghi.
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

// db spies — không đụng DB thật (vi.hoisted vì mock factory được hoist lên đầu file)
const { getFactoryZones, createFactoryZone, updateFactoryZone, deleteFactoryZone } = vi.hoisted(() => ({
  getFactoryZones: vi.fn(async () => [{ id: 1, factoryId: 9, name: "A", color: "#0ea5e9", points: [] }]),
  createFactoryZone: vi.fn(async () => 55),
  updateFactoryZone: vi.fn(async () => {}),
  deleteFactoryZone: vi.fn(async () => {}),
}));
vi.mock("../db", () => ({ getFactoryZones, createFactoryZone, updateFactoryZone, deleteFactoryZone }));

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

import { factoryZoneRouter } from "./hierarchyRouters";

const ctx = { user: { id: 42, role: "operator", name: "Op" } } as any;
const caller = factoryZoneRouter.createCaller(ctx);

beforeEach(() => {
  perm.allow = true;
  getFactoryZones.mockClear();
  createFactoryZone.mockClear();
  updateFactoryZone.mockClear();
  deleteFactoryZone.mockClear();
});

describe("factoryZone.listByFactory — đọc mở", () => {
  it("trả về danh sách zone của nhà máy", async () => {
    const res = await caller.listByFactory({ factoryId: 9 });
    expect(getFactoryZones).toHaveBeenCalledWith(9);
    expect(res).toHaveLength(1);
  });
});

describe("factoryZone.create — RBAC gate", () => {
  it("từ chối khi KHÔNG có canEdit", async () => {
    perm.allow = false;
    await expect(
      caller.create({ factoryId: 9, name: "Khu hàn", points: [{ x: 0.1, y: 0.1 }] }),
    ).rejects.toThrow(/FORBIDDEN|canEdit/i);
    expect(createFactoryZone).not.toHaveBeenCalled();
  });

  it("cho phép tạo khi có canEdit (mặc định color)", async () => {
    const res = await caller.create({ factoryId: 9, name: "Khu hàn", points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.1, y: 0.3 }] });
    expect(res).toEqual({ id: 55 });
    expect(createFactoryZone).toHaveBeenCalledWith(expect.objectContaining({
      factoryId: 9, name: "Khu hàn", color: "#0ea5e9",
    }));
  });
});

describe("factoryZone.update — RBAC gate", () => {
  it("từ chối khi KHÔNG có canEdit", async () => {
    perm.allow = false;
    await expect(caller.update({ id: 1, name: "Đổi tên" })).rejects.toThrow(/FORBIDDEN|canEdit/i);
    expect(updateFactoryZone).not.toHaveBeenCalled();
  });

  it("cho phép cập nhật khi có canEdit", async () => {
    const res = await caller.update({ id: 1, name: "Đổi tên", color: "#ef4444" });
    expect(res).toEqual({ success: true });
    expect(updateFactoryZone).toHaveBeenCalledWith(1, { name: "Đổi tên", color: "#ef4444" });
  });
});

describe("factoryZone.delete — RBAC gate", () => {
  it("từ chối khi KHÔNG có canEdit", async () => {
    perm.allow = false;
    await expect(caller.delete({ id: 1 })).rejects.toThrow(/FORBIDDEN|canEdit/i);
    expect(deleteFactoryZone).not.toHaveBeenCalled();
  });

  it("cho phép xoá khi có canEdit", async () => {
    const res = await caller.delete({ id: 1 });
    expect(res).toEqual({ success: true });
    expect(deleteFactoryZone).toHaveBeenCalledWith(1);
  });
});

describe("factoryZone — validate ràng buộc zod", () => {
  it("từ chối điểm ngoài [0,1]", async () => {
    await expect(caller.create({ factoryId: 9, name: "X", points: [{ x: 1.5, y: 0.5 }] })).rejects.toThrow();
    expect(createFactoryZone).not.toHaveBeenCalled();
  });

  it("từ chối tên rỗng", async () => {
    await expect(caller.create({ factoryId: 9, name: "" })).rejects.toThrow();
  });
});
