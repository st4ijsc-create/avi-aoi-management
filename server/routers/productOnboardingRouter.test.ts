/**
 * productOnboardingRouter tests (WD-1 · doc 31 Đợt D · gap UX1).
 *
 * Covers:
 *   • draft lifecycle — saveDraft creates ONE 'draft' row, updates it in place,
 *     getDraft resumes it, listDrafts enriches with product code/name,
 *     deleteDraft removes it.
 *   • step-state persistence — currentStep + stepState round-trip through the
 *     draft (create → resume).
 *   • complete — flips the draft → 'completed' (so it drops out of getDraft /
 *     listDrafts); with no draft it records a fresh 'completed' marker.
 *   • guards — saveDraft rejects an unknown product; RBAC denial rejects.
 *
 * Uses the shared FakeDb (__otFakeDb) — no real DB needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, makeDesc, resetSeq, type Row } from "./__otFakeDb";
import { productModels, productOnboardingDrafts } from "../../drizzle/schema";

const fake = new FakeDb();

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: makeEq, and: makeAnd, desc: makeDesc };
});
vi.mock("../db", () => ({
  getDb: vi.fn(async () => fake),
  // consumed by the global fire-and-forget audit middleware (protectedProcedure)
  createAuditLog: vi.fn(async () => ({})),
}));

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

import { productOnboardingRouter } from "./productOnboardingRouter";
import { getDb } from "../db";

const adminCtx = { user: { id: 7, role: "admin", name: "Admin" } } as any;
const admin = productOnboardingRouter.createCaller(adminCtx);

const PRODUCT = { id: 1, code: "BOARD-A", name: "Board A", lifecycleStatus: "development" };
const PRODUCT2 = { id: 2, code: "BOARD-B", name: "Board B", lifecycleStatus: "development" };

function tableRows(t: any): Row[] {
  return fake.store.get((t as any)[Symbol.for("drizzle:Name")]) ?? [];
}

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  perm.allow = true;
  fake.seed(productModels, [PRODUCT, PRODUCT2]);
  vi.mocked(getDb).mockImplementation(async () => fake as any);
});

describe("draft lifecycle (resumable product wizard)", () => {
  it("saveDraft creates ONE draft row and updates it in place on re-save", async () => {
    await admin.saveDraft({
      productModelId: 1,
      currentStep: 2,
      stepState: { fiducials: { status: "done" }, points: { status: "todo" } },
    });
    let drafts = tableRows(productOnboardingDrafts);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].status).toBe("draft");
    expect(drafts[0].createdBy).toBe(7);
    expect(drafts[0].currentStep).toBe(2);

    // Re-save (next step) → updates in place, not duplicated.
    await admin.saveDraft({
      productModelId: 1,
      currentStep: 3,
      stepState: { fiducials: { status: "done" }, points: { status: "done" } },
    });
    drafts = tableRows(productOnboardingDrafts);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].currentStep).toBe(3);

    // Resume.
    const resumed = await admin.getDraft({ productModelId: 1 });
    expect(resumed?.currentStep).toBe(3);
    expect((resumed?.stepState as any).points.status).toBe("done");

    // Abandon.
    const del = await admin.deleteDraft({ productModelId: 1 });
    expect(del.deleted).toBe(true);
    expect(tableRows(productOnboardingDrafts)).toHaveLength(0);
    expect(await admin.getDraft({ productModelId: 1 })).toBeNull();
  });

  it("step-state persists (currentStep + stepState round-trip)", async () => {
    const state = {
      product: { status: "done" },
      thresholds: { status: "skipped", note: "set later" },
    };
    await admin.saveDraft({ productModelId: 2, currentStep: 4, stepState: state });
    const resumed = await admin.getDraft({ productModelId: 2 });
    expect(resumed?.currentStep).toBe(4);
    expect(resumed?.stepState).toEqual(state);
  });

  it("listDrafts returns only 'draft' rows enriched with product code/name", async () => {
    await admin.saveDraft({ productModelId: 1, currentStep: 1, stepState: {} });
    await admin.saveDraft({ productModelId: 2, currentStep: 2, stepState: {} });
    const list = await admin.listDrafts();
    expect(list).toHaveLength(2);
    const byId = new Map(list.map((d) => [d.productModelId, d]));
    expect(byId.get(1)?.productCode).toBe("BOARD-A");
    expect(byId.get(2)?.productName).toBe("Board B");
  });

  it("saveDraft rejects an unknown product", async () => {
    await expect(
      admin.saveDraft({ productModelId: 999, currentStep: 0, stepState: {} }),
    ).rejects.toThrow(/không tồn tại|NOT_FOUND/i);
  });
});

describe("complete (finish)", () => {
  it("flips the draft → completed so it drops out of getDraft/listDrafts", async () => {
    await admin.saveDraft({ productModelId: 1, currentStep: 8, stepState: { review: { status: "done" } } });
    const done = await admin.complete({ productModelId: 1 });
    expect(done.status).toBe("completed");

    // No longer an active draft.
    expect(await admin.getDraft({ productModelId: 1 })).toBeNull();
    expect(await admin.listDrafts()).toHaveLength(0);
    // Row still exists (as a completed marker).
    expect(tableRows(productOnboardingDrafts)).toHaveLength(1);
    expect(tableRows(productOnboardingDrafts)[0].status).toBe("completed");
  });

  it("with no prior draft, complete records a fresh 'completed' marker", async () => {
    const done = await admin.complete({ productModelId: 2, currentStep: 8 });
    expect(done.status).toBe("completed");
    expect(done.createdBy).toBe(7);
    expect(tableRows(productOnboardingDrafts)).toHaveLength(1);
  });
});

describe("RBAC", () => {
  it("denies without the settings_products permission", async () => {
    perm.allow = false;
    await expect(admin.getDraft({ productModelId: 1 })).rejects.toThrow(/FORBIDDEN|settings_products/i);
    await expect(
      admin.saveDraft({ productModelId: 1, currentStep: 0, stepState: {} }),
    ).rejects.toThrow(/FORBIDDEN|settings_products/i);
  });
});
