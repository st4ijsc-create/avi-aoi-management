/**
 * Doc 31 Đợt A — thresholdApprovalRouter governance tests.
 *
 * Covers OP1 (SoD on approve), OP8 (list-with-metadata, batchApprove mixed
 * outcomes, revert from measurement_point_versions). Uses the in-memory FakeDb
 * + mocked db-layer helpers, mirroring machineRecipeRouter.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readAppErrorMeta } from "../_core/appError";
import { FakeDb, makeEq, makeAnd, makeDesc, resetSeq } from "./__otFakeDb";
import {
  thresholdApprovals,
  measurementPointDefs,
  measurementPointVersions,
  productModels,
} from "../../drizzle/schema/product";

const fake = new FakeDb();

function makeInArray(col: any, values: any[]) {
  return (row: any) => values.includes(row[col.name]);
}

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: makeEq, and: makeAnd, desc: makeDesc, inArray: makeInArray };
});
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => fake) }));

const updateSpy = vi.fn(async () => {});
const auditSpy = vi.fn(async () => ({ id: 1 }));
vi.mock("../db", () => ({
  getDb: vi.fn(async () => fake),
  updateMeasurementPointDef: (...a: any[]) => updateSpy(...a),
  createAuditLog: (...a: any[]) => auditSpy(...a),
  // ★ Bản vá không-liên-quan-BG-126, phát hiện khi thêm ca này — cổng
  // `chanKhiPhaiDoiMatKhau` (server/_core/trpc.ts) đứng ở GỐC mọi thủ tục và đọc
  // `phaiDoiMatKhau` từ `../db`; mock ở đây chưa từng liệt kê export này (trôi
  // theo thời gian, không phải do BG-126) nên MỌI ca trong file này đã đỏ trước
  // khi có bản vá này (đo được: stash bản gốc → 9/9 ca đỏ CÙNG lỗi). `false` =
  // không ai bị buộc đổi mật khẩu, giữ hành vi các ca hiện có nguyên vẹn.
  phaiDoiMatKhau: vi.fn(async () => false),
}));

import { thresholdApprovalRouter } from "./thresholdApprovalRouter";

// Quality manager (approver). twoFactorEnabled required for privileged roles.
const qualityCtx = (id = 10) =>
  ({ user: { id, role: "quality_inspector", twoFactorEnabled: true, name: "Q" }, req: { ip: null, headers: {} } }) as any;

const caller = (id = 10) => thresholdApprovalRouter.createCaller(qualityCtx(id));

function seedApproval(over: Record<string, any>) {
  const base = {
    id: 1,
    pointDefId: 5,
    requestedBy: 20,
    status: "requested",
    suggestion: {},
    proposedLsl: "1",
    proposedUsl: "9",
    proposedNominal: "5",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return { ...base, ...over };
}

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  updateSpy.mockClear();
  auditSpy.mockClear();
});

describe("approve — OP1 Segregation of Duties", () => {
  it("rejects when the approver is the requester (self-approve → FORBIDDEN)", async () => {
    fake.seed(thresholdApprovals, [seedApproval({ requestedBy: 10 })]);
    fake.seed(measurementPointDefs, [{ id: 5, code: "MP-5", lowerLimit: "0", upperLimit: "100" }]);
    await expect(caller(10).approve({ id: 1, apply: true })).rejects.toThrow(/Segregation of duties/i);
  });

  it("applies when a DIFFERENT quality user approves (writes new limits onto the point)", async () => {
    fake.seed(thresholdApprovals, [seedApproval({ requestedBy: 20 })]);
    fake.seed(measurementPointDefs, [{ id: 5, code: "MP-5", lowerLimit: "0", upperLimit: "100" }]);

    const updated = await caller(10).approve({ id: 1, apply: true });
    expect(updated.status).toBe("applied");
    expect(updated.decidedBy).toBe(10);

    const key = (measurementPointDefs as any)[Symbol.for("drizzle:Name")];
    const row = fake.store.get(key)!.find((r: any) => r.id === 5);
    expect(row.lowerLimit).toBe("1");
    expect(row.upperLimit).toBe("9");
    expect(row.nominalValue).toBe("5");
  });

  it("approve without apply just records the decision, no limit write", async () => {
    fake.seed(thresholdApprovals, [seedApproval({ requestedBy: 20 })]);
    fake.seed(measurementPointDefs, [{ id: 5, code: "MP-5", lowerLimit: "0", upperLimit: "100" }]);
    const updated = await caller(10).approve({ id: 1, apply: false });
    expect(updated.status).toBe("approved");
    const key = (measurementPointDefs as any)[Symbol.for("drizzle:Name")];
    const row = fake.store.get(key)!.find((r: any) => r.id === 5);
    expect(row.lowerLimit).toBe("0"); // unchanged
  });

  it("the AI auto-tune sentinel request (requestedBy=0) is approvable by any quality user", async () => {
    fake.seed(thresholdApprovals, [seedApproval({ requestedBy: 0 })]);
    fake.seed(measurementPointDefs, [{ id: 5, code: "MP-5", lowerLimit: "0", upperLimit: "100" }]);
    const updated = await caller(10).approve({ id: 1, apply: true });
    expect(updated.status).toBe("applied");
  });
});

describe("batchApprove — OP8 mixed outcomes (atomic per item)", () => {
  it("approves valid, skips non-pending, fails self + missing", async () => {
    fake.seed(thresholdApprovals, [
      seedApproval({ id: 1, requestedBy: 20, status: "requested" }), // → approved
      seedApproval({ id: 2, requestedBy: 10, status: "requested" }), // → failed (SoD self)
      seedApproval({ id: 3, requestedBy: 20, status: "applied" }),   // → skipped (not pending)
    ]);
    fake.seed(measurementPointDefs, [{ id: 5, code: "MP-5", lowerLimit: "0", upperLimit: "100" }]);

    const res = await caller(10).batchApprove({ ids: [1, 2, 3, 999], apply: true });
    const byId = Object.fromEntries(res.results.map((r) => [r.id, r]));
    expect(byId[1].status).toBe("approved");
    expect(byId[2].status).toBe("failed");
    expect(byId[2].reason).toMatch(/segregation of duties/i);
    expect(byId[3].status).toBe("skipped");
    expect(byId[999].status).toBe("failed"); // NOT_FOUND
    expect(res.summary).toEqual({ approved: 1, skipped: 1, failed: 2 });
  });
});

describe("list — OP8 point + product metadata", () => {
  it("resolves pointCode / pointName / productCode / productName", async () => {
    fake.seed(thresholdApprovals, [seedApproval({ id: 1, pointDefId: 5 })]);
    fake.seed(measurementPointDefs, [{ id: 5, code: "MP-A", name: "Solder Joint A", productModelId: 100 }]);
    fake.seed(productModels, [{ id: 100, code: "PRD-1", name: "Product One" }]);

    const rows = await caller(10).list({});
    expect(rows).toHaveLength(1);
    expect(rows[0].pointCode).toBe("MP-A");
    expect(rows[0].pointName).toBe("Solder Joint A");
    expect(rows[0].productModelId).toBe(100);
    expect(rows[0].productCode).toBe("PRD-1");
    expect(rows[0].productName).toBe("Product One");
  });
});

describe("revert — OP8 restore prior limits + audit", () => {
  it("restores the latest version snapshot's limits and writes an audit row", async () => {
    // v1 older, v2 latest → revert must restore v2's snapshot (pre-last-edit state).
    fake.seed(measurementPointVersions, [
      { id: 1, pointDefId: 5, version: 1, snapshotJson: { lowerLimit: "-9", upperLimit: "-1" } },
      { id: 2, pointDefId: 5, version: 2, snapshotJson: { lowerLimit: "2", upperLimit: "8", nominalValue: "5" } },
    ]);
    fake.seed(measurementPointDefs, [{ id: 5, code: "MP-5", lowerLimit: "99", upperLimit: "100", nominalValue: "99.5" }]);

    const out = await caller(10).revert({ pointDefId: 5, comment: "rollback bad tune" });
    expect(out.ok).toBe(true);
    expect(out.pointDefId).toBe(5);
    expect(out.restored).toMatchObject({ lowerLimit: "2", upperLimit: "8", nominalValue: "5" });

    // updateMeasurementPointDef called with the restored limits + actor.
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [pid, patch, opts] = updateSpy.mock.calls[0] as any[];
    expect(pid).toBe(5);
    expect(patch).toMatchObject({ lowerLimit: "2", upperLimit: "8", nominalValue: "5" });
    expect(opts.changedBy).toBe(10);

    // audit row with before (current) + after (restored).
    expect(auditSpy).toHaveBeenCalledTimes(1);
    const audit = auditSpy.mock.calls[0][0] as any;
    expect(audit.action).toBe("threshold.revert");
    expect(audit.entityId).toBe(5);
    expect(audit.details.before.lowerLimit).toBe("99");
    expect(audit.details.after.lowerLimit).toBe("2");
    expect(audit.details.fromVersion).toBe(2);
  });

  it("resolves the point from an approvalId", async () => {
    fake.seed(thresholdApprovals, [seedApproval({ id: 7, pointDefId: 5 })]);
    fake.seed(measurementPointVersions, [
      { id: 1, pointDefId: 5, version: 1, snapshotJson: { lowerLimit: "3", upperLimit: "7" } },
    ]);
    fake.seed(measurementPointDefs, [{ id: 5, code: "MP-5", lowerLimit: "0", upperLimit: "1" }]);

    const out = await caller(10).revert({ approvalId: 7 });
    expect(out.pointDefId).toBe(5);
    expect(out.restored).toMatchObject({ lowerLimit: "3", upperLimit: "7" });
  });

  it("throws NOT_FOUND when there is no prior version to revert to", async () => {
    fake.seed(measurementPointDefs, [{ id: 5, code: "MP-5" }]);
    await expect(caller(10).revert({ pointDefId: 5 })).rejects.toThrow(/No prior version/i);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ★★★ BG-126 (Khối C, "nợ còn mở", 2026-09-05) — `comment` ở đây chảy THẲNG
  // vào `changeReason` của `updateMeasurementPointDef` (xem
  // `server/routers/thresholdApprovalRouter.ts:448`: `changeReason: input.comment
  // ?? "threshold.revert (doc31 OP8)"`) — người dùng gõ đúng tiền tố cấu trúc
  // `[VARIANT:<id>]` (`RE_TIEN_TO_VERSION_BIEN_THE`, `server/db/product.ts`) sẽ
  // làm snapshot BASE đó vô hình với `napLichSuGioiHanTheoDiem`/
  // `loadPointLimitSnapshots` khi cờ `SPEC_GATE_SNAPSHOT_ENABLED` BẬT.
  // ══════════════════════════════════════════════════════════════════════════
  it("★★★ BG-126 — comment='[VARIANT:12] abc' ⇒ BAD_REQUEST/CHANGE_REASON_RESERVED_PREFIX, KHÔNG ghi gì", async () => {
    fake.seed(measurementPointVersions, [
      { id: 1, pointDefId: 5, version: 1, snapshotJson: { lowerLimit: "2", upperLimit: "8" } },
    ]);
    fake.seed(measurementPointDefs, [{ id: 5, code: "MP-5", lowerLimit: "0", upperLimit: "1" }]);

    let err: unknown;
    try {
      await caller(10).revert({ pointDefId: 5, comment: "[VARIANT:12] abc" });
    } catch (e) {
      err = e;
    }
    expect(err, "phải bị từ chối").toBeDefined();
    expect(readAppErrorMeta(err)).toMatchObject({
      appCode: "CHANGE_REASON_RESERVED_PREFIX",
      appParams: { field: "comment" },
    });
    expect(updateSpy, "gate phải chặn TRƯỚC khi updateMeasurementPointDef chạy").not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it("BG-126 — comment='đổi giới hạn theo đo đạc' ⇒ qua bình thường", async () => {
    fake.seed(measurementPointVersions, [
      { id: 1, pointDefId: 5, version: 1, snapshotJson: { lowerLimit: "2", upperLimit: "8" } },
    ]);
    fake.seed(measurementPointDefs, [{ id: 5, code: "MP-5", lowerLimit: "0", upperLimit: "1" }]);

    const out = await caller(10).revert({ pointDefId: 5, comment: "đổi giới hạn theo đo đạc" });
    expect(out.ok).toBe(true);
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });
});
