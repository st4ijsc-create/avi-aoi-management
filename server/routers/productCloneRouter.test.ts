/**
 * Doc 31 Đợt C (PM1, WC-2) — productModel.clone ROUTER wiring tests.
 *
 * db + governance layers are mocked (spies) so this exercises the tRPC procedure
 * itself: source-not-found → NOT_FOUND, duplicate code → CONFLICT (both pre-check
 * and 23505 backstop), copyMappings pass-through, audit log, and the returned
 * shape. The DB deep-copy proof (counts / not-copied / remap) lives in
 * server/db/productClone.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getByIdSpy = vi.fn();
const getByCodeSpy = vi.fn();
const cloneSpy = vi.fn();
const auditSpy = vi.fn(async () => ({ id: 1 }));

vi.mock("../db", () => ({
  getProductModelById: (...a: any[]) => getByIdSpy(...a),
  getProductModelByCode: (...a: any[]) => getByCodeSpy(...a),
  cloneProductModel: (...a: any[]) => cloneSpy(...a),
  createAuditLog: (...a: any[]) => auditSpy(...a),
}));

// Router imports these at top-level; stub so module load never touches the DB.
vi.mock("../services/thresholdGovernanceService", () => ({
  assertThresholdEditAllowed: vi.fn(async () => ({ decision: "direct" })),
}));
vi.mock("../services/componentLinkBackfill", () => ({
  backfillComponentCodesFromBom: vi.fn(async () => ({})),
}));

import { productModelRouter } from "./productRouters";
import { TRPCError } from "@trpc/server";

const adminCtx = { user: { id: 5, role: "admin", twoFactorEnabled: true, name: "Admin" }, req: { ip: null, headers: {} } } as any;
const caller = productModelRouter.createCaller(adminCtx);

const cloneResult = {
  newProductId: 999,
  summary: {
    newCode: "BOARD-B",
    revision: "B",
    clonedFromId: 10,
    measurementPoints: 42,
    fiducialMarks: 4,
    panelDefs: 1,
    panelBoards: 8,
    samplingPlans: 2,
    machineMappings: 0,
  },
};

beforeEach(() => {
  getByIdSpy.mockReset();
  getByCodeSpy.mockReset();
  cloneSpy.mockReset();
  auditSpy.mockClear();
  getByIdSpy.mockResolvedValue({ id: 10, code: "BOARD-A", name: "Board A", revision: "A" });
  getByCodeSpy.mockResolvedValue(undefined); // no collision by default
  cloneSpy.mockResolvedValue(cloneResult);
});

describe("productModel.clone — happy path", () => {
  it("deep-copies via db.cloneProductModel and returns id + summary", async () => {
    const res = await caller.clone({ sourceId: 10, newCode: "BOARD-B", newName: "Board B", newRevision: "B" });
    expect(res).toEqual({ id: 999, summary: cloneResult.summary });
    expect(cloneSpy).toHaveBeenCalledTimes(1);
    const arg = cloneSpy.mock.calls[0][0];
    expect(arg).toMatchObject({ sourceId: 10, newCode: "BOARD-B", newName: "Board B", newRevision: "B", copyMappings: false });
    // audited
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy.mock.calls[0][0]).toMatchObject({ action: "product.clone", entityId: 999 });
  });

  it("threads copyMappings=true through to the db layer", async () => {
    await caller.clone({ sourceId: 10, newCode: "BOARD-C", copyMappings: true });
    expect(cloneSpy.mock.calls[0][0].copyMappings).toBe(true);
  });

  it("defaults copyMappings to false when omitted", async () => {
    await caller.clone({ sourceId: 10, newCode: "BOARD-D" });
    expect(cloneSpy.mock.calls[0][0].copyMappings).toBe(false);
  });
});

describe("productModel.clone — guards", () => {
  it("throws NOT_FOUND when the source does not exist", async () => {
    getByIdSpy.mockResolvedValue(undefined);
    await expect(caller.clone({ sourceId: 404, newCode: "X" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(cloneSpy).not.toHaveBeenCalled();
  });

  it("throws CONFLICT when the new code already exists (pre-check)", async () => {
    getByCodeSpy.mockResolvedValue({ id: 77, code: "BOARD-B" });
    await expect(caller.clone({ sourceId: 10, newCode: "BOARD-B" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(cloneSpy).not.toHaveBeenCalled();
  });

  it("maps a race-condition 23505 from the db layer to CONFLICT", async () => {
    cloneSpy.mockRejectedValue(Object.assign(new Error("duplicate key value violates unique constraint \"product_models_code_unique\""), { code: "23505" }));
    await expect(caller.clone({ sourceId: 10, newCode: "BOARD-B" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects an invalid code (regex) before hitting the db", async () => {
    await expect(caller.clone({ sourceId: 10, newCode: "bad code!" })).rejects.toBeInstanceOf(TRPCError);
    expect(cloneSpy).not.toHaveBeenCalled();
  });
});
