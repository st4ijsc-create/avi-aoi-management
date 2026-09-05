/**
 * Doc 31 Đợt E (UX5, WE-2) — thresholdApprovalRouter COMPLEMENT.
 *
 * thresholdApprovalRouter.test.ts (WA-1) already covers approve-SoD,
 * batchApprove, list-metadata and revert. This file complements it with the
 * three endpoints WA-1 did not touch:
 *   • request  — LSL<USL validation, NOT_FOUND point, records requestedBy/status
 *   • reject   — state guard (only from `requested`), records decidedBy/comment
 *   • withdraw — REQUESTER-ONLY (self ≠ FORBIDDEN), state guard
 *
 * Same in-memory FakeDb harness as the WA-1 file (no real DB).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, makeDesc, resetSeq } from "./__otFakeDb";
import { thresholdApprovals, measurementPointDefs } from "../../drizzle/schema/product";

const fake = new FakeDb();
function makeInArray(col: any, values: any[]) {
  return (row: any) => values.includes(row[col.name]);
}
vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: makeEq, and: makeAnd, desc: makeDesc, inArray: makeInArray };
});
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => fake) }));
vi.mock("../db", () => ({
  getDb: vi.fn(async () => fake),
  updateMeasurementPointDef: vi.fn(async () => {}),
  createAuditLog: vi.fn(async () => ({ id: 1 })),
  // ★ Cùng lỗ đã vá ở thresholdApprovalRouter.test.ts (commit 99034e1f) — cổng
  // `chanKhiPhaiDoiMatKhau` (server/_core/trpc.ts) đứng ở GỐC mọi thủ tục và đọc
  // `phaiDoiMatKhau` từ `../db`; mock ở đây chưa từng liệt kê export này (trôi theo
  // thời gian, không liên quan BG-126) nên MỌI ca trong file này đỏ CÙNG lỗi. `false`
  // = không ai bị buộc đổi mật khẩu, giữ hành vi các ca hiện có nguyên vẹn.
  phaiDoiMatKhau: vi.fn(async () => false),
}));

import { thresholdApprovalRouter } from "./thresholdApprovalRouter";

// protectedProcedure caller (any authenticated user) — for request/withdraw.
const userCaller = (id: number) =>
  thresholdApprovalRouter.createCaller({ user: { id, role: "operator", name: "U" }, req: { ip: null, headers: {} } } as any);
// qualityProcedure caller — for reject.
const qualityCaller = (id = 10) =>
  thresholdApprovalRouter.createCaller({ user: { id, role: "quality_inspector", twoFactorEnabled: true, name: "Q" }, req: { ip: null, headers: {} } } as any);

function seedApproval(over: Record<string, any>) {
  return {
    id: 1, pointDefId: 5, requestedBy: 20, status: "requested", suggestion: {},
    proposedLsl: "1", proposedUsl: "9", createdAt: new Date(), updatedAt: new Date(), ...over,
  };
}

beforeEach(() => {
  fake.store.clear();
  resetSeq();
});

describe("request — validation + provenance", () => {
  it("rejects proposedLsl ≥ proposedUsl (BAD_REQUEST) before any db call", async () => {
    await expect(
      userCaller(20).request({ pointDefId: 5, proposedLsl: 9, proposedUsl: 1 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("throws NOT_FOUND when the measurement point does not exist", async () => {
    // no measurementPointDefs seeded
    await expect(
      userCaller(20).request({ pointDefId: 5, proposedLsl: 1, proposedUsl: 9 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("records a 'requested' row stamped with the caller as requestedBy", async () => {
    fake.seed(measurementPointDefs, [{ id: 5, code: "MP-5", lowerLimit: "0", upperLimit: "100", nominalValue: "50" }]);
    const row = await userCaller(20).request({ pointDefId: 5, proposedLsl: 1, proposedUsl: 9, comment: "tighten" });
    expect(row.status).toBe("requested");
    expect(row.requestedBy).toBe(20);
    expect(row.proposedLsl).toBe("1");
    expect(row.proposedUsl).toBe("9");
    // Persisted exactly once.
    const key = (thresholdApprovals as any)[Symbol.for("drizzle:Name")];
    expect(fake.store.get(key)).toHaveLength(1);
  });
});

describe("reject — state guard + provenance", () => {
  it("records status=rejected, decidedBy, decidedComment", async () => {
    fake.seed(thresholdApprovals, [seedApproval({ requestedBy: 20, status: "requested" })]);
    const updated = await qualityCaller(10).reject({ id: 1, comment: "Out of spec" });
    expect(updated.status).toBe("rejected");
    expect(updated.decidedBy).toBe(10);
    expect(updated.decidedComment).toBe("Out of spec");
  });

  it("refuses to reject a non-pending request (BAD_REQUEST)", async () => {
    fake.seed(thresholdApprovals, [seedApproval({ status: "applied" })]);
    await expect(qualityCaller(10).reject({ id: 1, comment: "late" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("withdraw — requester-only", () => {
  it("the original requester can withdraw a pending request", async () => {
    fake.seed(thresholdApprovals, [seedApproval({ requestedBy: 20, status: "requested" })]);
    const updated = await userCaller(20).withdraw({ id: 1, comment: "no longer needed" });
    expect(updated.status).toBe("withdrawn");
    expect(updated.decidedBy).toBe(20);
  });

  it("a DIFFERENT user cannot withdraw someone else's request (FORBIDDEN)", async () => {
    fake.seed(thresholdApprovals, [seedApproval({ requestedBy: 20, status: "requested" })]);
    await expect(userCaller(30).withdraw({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // untouched
    const key = (thresholdApprovals as any)[Symbol.for("drizzle:Name")];
    expect(fake.store.get(key)![0].status).toBe("requested");
  });

  it("cannot withdraw a request that is no longer pending (BAD_REQUEST)", async () => {
    fake.seed(thresholdApprovals, [seedApproval({ requestedBy: 20, status: "approved" })]);
    await expect(userCaller(20).withdraw({ id: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
