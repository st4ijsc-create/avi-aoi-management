/**
 * rootCauseRouter — update/delete shape + RBAC tests.
 *
 * Mocks the DB accessor (records SQL/builder calls, returns canned rows) and
 * the accessControl middleware so each test can grant/deny canEdit / canDelete.
 * Verifies:
 *  - update merges review fields (confirmedCause/correctiveAction/notes) and
 *    persists status; returns { success, id, review }
 *  - update on a missing id → NOT_FOUND
 *  - delete removes by id; missing id → NOT_FOUND
 *  - RBAC: a denied canEdit/canDelete → FORBIDDEN (write never runs)
 *
 * W0-1 (doc 69): `update`'s WRITE (the UPDATE ... SET status/aiInsights) was
 * converted from a raw unquoted-identifier `db.execute(sql`UPDATE ...`)` to
 * the drizzle builder `db.update(rootCauseAnalysis).set(...).where(...)` — the
 * pre-read SELECT still goes through `db.execute` (now quoted). The mock below
 * models both surfaces.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Control RBAC outcome per test ─────────────────────────────────────────────
let allow = true;
vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ next }: any) => {
    if (!allow) {
      const { TRPCError } = await import("@trpc/server");
      throw new TRPCError({ code: "FORBIDDEN", message: "denied" });
    }
    return next();
  },
}));

// ── Mock DB: record execute() calls (pre-read SELECT / delete) and
// db.update().set().where() calls (the write), return scripted rows ──────────
const execSpy = vi.fn();
const updateSetSpy = vi.fn();
vi.mock("../db", () => ({
  getDb: async () => ({
    execute: (q: unknown) => execSpy(q),
    update: () => ({
      set: (values: unknown) => {
        updateSetSpy(values);
        return { where: () => Promise.resolve() };
      },
    }),
  }),
  // The tRPC audit middleware logs mutations; stub it so it's a no-op here.
  createAuditLog: vi.fn(async () => {}),
}));

import { rootCauseRouter } from "./aiRouters";
import { initTRPC } from "@trpc/server";

const t = initTRPC.context<any>().create();
const createCaller = t.createCallerFactory(rootCauseRouter);
const caller = createCaller({ user: { id: 9, name: "Tester", role: "admin" } });

beforeEach(() => {
  allow = true;
  execSpy.mockReset();
  updateSetSpy.mockReset();
});

describe("rootCause.update", () => {
  it("merges review fields + persists, returns review", async () => {
    // The pre-read SELECT goes through execute(); the write goes through the
    // drizzle builder (db.update().set().where()) — see W0-1 fix note above.
    execSpy.mockResolvedValueOnce({ rows: [{ id: 1, aiInsights: { summary: "s" } }] });

    const res = await caller.update({
      id: 1,
      status: "IN_PROGRESS",
      confirmedCause: "Excess paste",
      correctiveAction: "Reduce aperture",
      notes: "verified on line 2",
    });

    expect(res.success).toBe(true);
    expect(res.id).toBe(1);
    expect(res.review.confirmedCause).toBe("Excess paste");
    expect(res.review.correctiveAction).toBe("Reduce aperture");
    expect(res.review.notes).toBe("verified on line 2");
    expect(res.review.reviewedBy).toBe(9);
    expect(execSpy).toHaveBeenCalledTimes(1); // only the pre-read SELECT
    expect(updateSetSpy).toHaveBeenCalledTimes(1);
    expect(updateSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "IN_PROGRESS",
        aiInsights: expect.objectContaining({
          summary: "s",
          review: expect.objectContaining({ confirmedCause: "Excess paste" }),
        }),
      }),
    );
  });

  it("missing id → NOT_FOUND (no UPDATE issued)", async () => {
    execSpy.mockResolvedValueOnce({ rows: [] });
    await expect(caller.update({ id: 404, notes: "x" })).rejects.toThrow(/not found/i);
    expect(execSpy).toHaveBeenCalledTimes(1); // only the SELECT ran
    expect(updateSetSpy).not.toHaveBeenCalled();
  });

  it("denied canEdit → FORBIDDEN, no DB call", async () => {
    allow = false;
    await expect(caller.update({ id: 1, notes: "x" })).rejects.toThrow(/denied|forbidden/i);
    expect(execSpy).not.toHaveBeenCalled();
    expect(updateSetSpy).not.toHaveBeenCalled();
  });
});

describe("rootCause.delete", () => {
  it("deletes by id", async () => {
    execSpy
      .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // SELECT existing
      .mockResolvedValueOnce({ rows: [] }); // DELETE
    const res = await caller.delete({ id: 5 });
    expect(res).toEqual({ success: true, id: 5, deleted: true });
    expect(execSpy).toHaveBeenCalledTimes(2);
  });

  it("missing id → NOT_FOUND", async () => {
    execSpy.mockResolvedValueOnce({ rows: [] });
    await expect(caller.delete({ id: 7 })).rejects.toThrow(/not found/i);
    expect(execSpy).toHaveBeenCalledTimes(1);
  });

  it("denied canDelete → FORBIDDEN, no DB call", async () => {
    allow = false;
    await expect(caller.delete({ id: 5 })).rejects.toThrow(/denied|forbidden/i);
    expect(execSpy).not.toHaveBeenCalled();
  });
});
