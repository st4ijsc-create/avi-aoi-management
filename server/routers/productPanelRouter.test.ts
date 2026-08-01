/**
 * Doc 31 Đợt E (UX5, WE-2) — productPanelRouter CRUD + RBAC tests (W8-B, 0192).
 *
 * The panel-def router had ZERO tests. Covers: create (NOT_FOUND product,
 * BAD_REQUEST service-error mapping, happy path), get/update NOT_FOUND, remove
 * pass-through, saveBoards BAD_REQUEST mapping, the PURE generateGrid preview,
 * and the permission gate.
 *
 * ── PM7 governance note ──────────────────────────────────────────────────────
 * These mutations are `protectedProcedure + requirePermission("settings_products",
 * canCreate/canEdit/canDelete)` — NOT `adminProcedure`. So ANY user whose role
 * carries the settings_products write permission can create/edit/delete a panel
 * def, whereas the product MODEL itself is admin-only. Doc 31 §3 PM7 flags this
 * asymmetry (planned tightening → E.6 "Gate admin/quality"). The test below
 * ASSERTS THE CURRENT (looser) behavior: a permission-holding non-admin succeeds.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getProductSpy = vi.fn();
const listSpy = vi.fn();
const getSpy = vi.fn();
const getActiveSpy = vi.fn();
const createSpy = vi.fn();
const updateSpy = vi.fn();
const softDeleteSpy = vi.fn();
const replaceBoardsSpy = vi.fn();

vi.mock("../db", () => ({
  getProductModelById: (...a: any[]) => getProductSpy(...a),
  // consumed by the global fire-and-forget audit middleware (protectedProcedure)
  createAuditLog: vi.fn(async () => ({})),
}));
vi.mock("../services/panel/panelService", () => ({
  listPanelDefs: (...a: any[]) => listSpy(...a),
  getPanelDef: (...a: any[]) => getSpy(...a),
  getActivePanelDefForProduct: (...a: any[]) => getActiveSpy(...a),
  createPanelDef: (...a: any[]) => createSpy(...a),
  updatePanelDef: (...a: any[]) => updateSpy(...a),
  softDeletePanelDef: (...a: any[]) => softDeleteSpy(...a),
  replaceBoards: (...a: any[]) => replaceBoardsSpy(...a),
}));

// Permission gate — toggle `perm.allow` per test.
const perm = { allow: true };
vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => {
    if (!perm.allow) {
      const { TRPCError } = await import("@trpc/server");
      throw new TRPCError({ code: "FORBIDDEN", message: "no settings_products" });
    }
    return next({ ctx });
  },
}));

import { productPanelRouter } from "./productPanelRouter";

// A NON-admin (quality) user — proves the gate is permission-based, not admin (PM7).
const qualityCtx = { user: { id: 8, role: "quality_inspector", twoFactorEnabled: true, name: "Q" }, req: { ip: null, headers: {} } } as any;
const caller = productPanelRouter.createCaller(qualityCtx);

beforeEach(() => {
  perm.allow = true;
  getProductSpy.mockReset();
  listSpy.mockReset();
  getSpy.mockReset();
  getActiveSpy.mockReset();
  createSpy.mockReset();
  updateSpy.mockReset();
  softDeleteSpy.mockReset();
  replaceBoardsSpy.mockReset();
});

describe("productPanel.create", () => {
  it("PM7: a permission-holding NON-admin can create a panel def (current behavior)", async () => {
    getProductSpy.mockResolvedValue({ id: 1, code: "PCB-A" });
    createSpy.mockResolvedValue(55);
    const res = await caller.create({
      productModelId: 1, code: "PNL-2x2", rows: 2, cols: 2, nUp: 4,
      boards: [{ boardIndex: 1, offsetXMm: 0, offsetYMm: 0 }],
    });
    expect(res).toEqual({ id: 55 });
    // boards are split away from the def before persisting.
    const [def, boards] = createSpy.mock.calls[0] as any[];
    expect(def.code).toBe("PNL-2x2");
    expect(def.boards).toBeUndefined();
    expect(boards).toHaveLength(1);
  });

  it("throws NOT_FOUND when the product model does not exist", async () => {
    getProductSpy.mockResolvedValue(undefined);
    await expect(caller.create({ productModelId: 999, code: "PNL" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("maps a service-layer error to BAD_REQUEST", async () => {
    getProductSpy.mockResolvedValue({ id: 1, code: "PCB-A" });
    createSpy.mockRejectedValue(new Error("nUp must equal rows*cols"));
    await expect(caller.create({ productModelId: 1, code: "PNL" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: /nUp must equal/,
    });
  });

  it("is denied without the settings_products permission", async () => {
    perm.allow = false;
    await expect(caller.create({ productModelId: 1, code: "PNL" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getProductSpy).not.toHaveBeenCalled();
  });
});

describe("productPanel.get / update — NOT_FOUND", () => {
  it("get throws NOT_FOUND when the def is missing", async () => {
    getSpy.mockResolvedValue(undefined);
    await expect(caller.get({ id: 5 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("update throws NOT_FOUND when the def does not exist", async () => {
    updateSpy.mockResolvedValue(undefined);
    await expect(caller.update({ id: 5, name: "X" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("update returns the patched row on success", async () => {
    updateSpy.mockResolvedValue({ id: 5, name: "Renamed" });
    const res = await caller.update({ id: 5, name: "Renamed" });
    expect(res).toEqual({ id: 5, name: "Renamed" });
    const [id, patch] = updateSpy.mock.calls[0] as any[];
    expect(id).toBe(5);
    expect(patch.name).toBe("Renamed");
  });
});

describe("productPanel.remove / saveBoards", () => {
  it("remove delegates to softDeletePanelDef", async () => {
    softDeleteSpy.mockResolvedValue({ ok: true });
    await caller.remove({ id: 5 });
    expect(softDeleteSpy).toHaveBeenCalledWith(5);
  });

  it("saveBoards maps a service error to BAD_REQUEST", async () => {
    replaceBoardsSpy.mockRejectedValue(new Error("duplicate boardIndex"));
    await expect(
      caller.saveBoards({ panelDefId: 5, boards: [{ boardIndex: 1, offsetXMm: 0, offsetYMm: 0 }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /duplicate boardIndex/ });
  });

  it("saveBoards returns the service result on success", async () => {
    replaceBoardsSpy.mockResolvedValue({ replaced: 2 });
    const res = await caller.saveBoards({
      panelDefId: 5,
      boards: [
        { boardIndex: 1, offsetXMm: 0, offsetYMm: 0 },
        { boardIndex: 2, offsetXMm: 50, offsetYMm: 0 },
      ],
    });
    expect(res).toEqual({ replaced: 2 });
  });
});

describe("productPanel.generateGrid — pure rows×cols preview", () => {
  it("produces row-major boards with even offsets from panel dims", async () => {
    const boards = await caller.generateGrid({ rows: 2, cols: 3, panelWidthMm: 300, panelHeightMm: 200 });
    expect(boards).toHaveLength(6);
    expect(boards.map((b) => b.boardIndex)).toEqual([1, 2, 3, 4, 5, 6]);
    // cell = 300/3 × 200/2 = 100 × 100; board #5 is row 1, col 1 → (100,100).
    expect(boards[4]).toMatchObject({ offsetXMm: 100, offsetYMm: 100, rotationDeg: 0, mirrored: false });
  });
});
