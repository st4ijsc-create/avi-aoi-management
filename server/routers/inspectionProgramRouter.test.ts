/**
 * Doc 31 Đợt E (UX5, WE-2) — inspectionProgramRouter (tRPC wrapper) tests.
 *
 * The full release state-machine (draft→submit→approve[SoD]→release→supersede)
 * is proven at the service layer in inspectionProgramService.test.ts. This suite
 * covers the ROUTER wrapper that had no tests: ctx threading (createdBy /
 * approvedBy / releasedBy = ctx.user.id), the error `rethrow` mapping
 * (Segregation-of-duties → FORBIDDEN, "not found" → NOT_FOUND, else →
 * BAD_REQUEST), and the qualityProcedure role gate on the sign-off endpoints.
 *
 * The service is mocked (spies) so we assert wiring, not workflow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const createReleaseSpy = vi.fn();
const submitSpy = vi.fn();
const approveSpy = vi.fn();
const rejectSpy = vi.fn();
const releaseSpy = vi.fn();
const listSpy = vi.fn();
const getByIdSpy = vi.fn();
const getActiveSpy = vi.fn();
const compareSpy = vi.fn();

vi.mock("../services/inspectionProgramService", () => ({
  createRelease: (...a: any[]) => createReleaseSpy(...a),
  submitForApproval: (...a: any[]) => submitSpy(...a),
  approveRelease: (...a: any[]) => approveSpy(...a),
  rejectRelease: (...a: any[]) => rejectSpy(...a),
  releaseProgram: (...a: any[]) => releaseSpy(...a),
  listReleases: (...a: any[]) => listSpy(...a),
  getReleaseById: (...a: any[]) => getByIdSpy(...a),
  getActiveRelease: (...a: any[]) => getActiveSpy(...a),
  compareReleases: (...a: any[]) => compareSpy(...a),
}));

// list/get/createDraft/submit gate through requirePermission — allow.
vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => next({ ctx }),
}));

import { inspectionProgramRouter } from "./inspectionProgramRouter";

const qualityCtx = { user: { id: 10, role: "quality_inspector", twoFactorEnabled: true, name: "Q" }, req: { ip: null, headers: {} } } as any;
const operatorCtx = { user: { id: 3, role: "operator", twoFactorEnabled: false, name: "Op" }, req: { ip: null, headers: {} } } as any;
const quality = inspectionProgramRouter.createCaller(qualityCtx);
const operator = inspectionProgramRouter.createCaller(operatorCtx);

beforeEach(() => {
  createReleaseSpy.mockReset();
  submitSpy.mockReset();
  approveSpy.mockReset();
  rejectSpy.mockReset();
  releaseSpy.mockReset();
  compareSpy.mockReset();
});

describe("createDraft — ctx.user.id threaded as createdBy", () => {
  it("passes productModelId/machineId/notes + createdBy into the service", async () => {
    createReleaseSpy.mockResolvedValue({ id: 1, version: 1, status: "draft" });
    const res = await quality.createDraft({ productModelId: 7, machineId: 77, notes: "first" });
    expect(res).toMatchObject({ id: 1, version: 1 });
    expect(createReleaseSpy).toHaveBeenCalledWith({ productModelId: 7, machineId: 77, notes: "first", createdBy: 10 });
  });

  it("defaults machineId/notes to null when omitted", async () => {
    createReleaseSpy.mockResolvedValue({ id: 1 });
    await quality.createDraft({ productModelId: 7 });
    expect(createReleaseSpy).toHaveBeenCalledWith({ productModelId: 7, machineId: null, notes: null, createdBy: 10 });
  });
});

describe("approve — SoD + ctx threading + role gate", () => {
  it("threads approvedBy = ctx.user.id and the note", async () => {
    approveSpy.mockResolvedValue({ id: 1, status: "approved", approvedBy: 10 });
    const res = await quality.approve({ releaseId: 1, note: "OK per IPC" });
    expect(res.status).toBe("approved");
    expect(approveSpy).toHaveBeenCalledWith({ releaseId: 1, approvedBy: 10, note: "OK per IPC" });
  });

  it("maps a Segregation-of-duties service error → FORBIDDEN", async () => {
    approveSpy.mockRejectedValue(new Error("Segregation of duties: creator cannot approve"));
    await expect(quality.approve({ releaseId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("maps a 'not found' service error → NOT_FOUND", async () => {
    approveSpy.mockRejectedValue(new Error("release 999 not found"));
    await expect(quality.approve({ releaseId: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps any other state-guard error → BAD_REQUEST", async () => {
    approveSpy.mockRejectedValue(new Error("Chỉ duyệt được bản chờ duyệt"));
    await expect(quality.approve({ releaseId: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("RBAC: an operator cannot approve (qualityProcedure role gate → FORBIDDEN)", async () => {
    await expect(operator.approve({ releaseId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(approveSpy).not.toHaveBeenCalled();
  });
});

describe("reject / release — ctx threading + validation", () => {
  it("reject requires a non-empty reason (Zod)", async () => {
    await expect(quality.reject({ releaseId: 1, reason: "" })).rejects.toBeTruthy();
    expect(rejectSpy).not.toHaveBeenCalled();
  });

  it("reject threads rejectedBy + reason", async () => {
    rejectSpy.mockResolvedValue({ id: 1, status: "rejected" });
    await quality.reject({ releaseId: 1, reason: "Missing BGA points" });
    expect(rejectSpy).toHaveBeenCalledWith({ releaseId: 1, rejectedBy: 10, reason: "Missing BGA points" });
  });

  it("release threads releasedBy = ctx.user.id", async () => {
    releaseSpy.mockResolvedValue({ id: 1, status: "released" });
    const res = await quality.release({ releaseId: 1 });
    expect(res.status).toBe("released");
    expect(releaseSpy).toHaveBeenCalledWith({ releaseId: 1, releasedBy: 10 });
  });

  it("RBAC: an operator cannot release", async () => {
    await expect(operator.release({ releaseId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("compare — non-SoD/non-not-found errors fall through to BAD_REQUEST", () => {
  it("a cross-product compare error surfaces as BAD_REQUEST", async () => {
    compareSpy.mockRejectedValue(new Error("Chỉ so sánh được hai bản của cùng một sản phẩm"));
    await expect(quality.compare({ aId: 1, bId: 2 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
