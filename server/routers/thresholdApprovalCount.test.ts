import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: Array<{ pointDefId: number; status: string; productModelId: number }> = [];
const fakeDb = {
  select: () => ({ from: () => ({ innerJoin: () => ({ where: () => Promise.resolve(
    rows.filter(r => r.status === "requested").map(r => ({ pointDefId: r.pointDefId, cnt: 1 })),
  ) }) }) }),
};
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => fakeDb) }));

import { countPendingByPoint } from "../services/thresholdApprovalCount";

beforeEach(() => { rows.length = 0; vi.clearAllMocks(); });

describe("countPendingByPoint", () => {
  it("gom đúng số đề xuất 'requested' theo pointDefId", async () => {
    rows.push(
      { pointDefId: 7, status: "requested", productModelId: 1 },
      { pointDefId: 7, status: "requested", productModelId: 1 },
      { pointDefId: 9, status: "requested", productModelId: 1 },
    );
    const r = await countPendingByPoint(1);
    expect(r.byPoint[7]).toBe(2);
    expect(r.byPoint[9]).toBe(1);
    expect(r.total).toBe(3);
  });

  it("không có đề xuất ⇒ rỗng, total 0, KHÔNG ném", async () => {
    const r = await countPendingByPoint(1);
    expect(r.byPoint).toEqual({});
    expect(r.total).toBe(0);
  });

  it("DB không sẵn sàng ⇒ rỗng, KHÔNG ném (màn điểm đo phải chạy bình thường)", async () => {
    const { getDb } = await import("../db/connection");
    (getDb as any).mockResolvedValueOnce(null);
    await expect(countPendingByPoint(1)).resolves.toEqual({ byPoint: {}, total: 0 });
  });

  it("bảng chưa migrate (42P01 bọc trong err.cause) ⇒ rỗng, KHÔNG ném", async () => {
    const inner: any = new Error('relation "threshold_approvals" does not exist');
    inner.code = "42P01";
    const wrapped: any = new Error("DrizzleQueryError");
    wrapped.cause = inner;
    const { getDb } = await import("../db/connection");
    (getDb as any).mockResolvedValueOnce({
      select: () => ({ from: () => ({ innerJoin: () => ({ where: () => Promise.reject(wrapped) }) }) }),
    });
    await expect(countPendingByPoint(1)).resolves.toEqual({ byPoint: {}, total: 0 });
  });

  // Vòng sửa 1 (review) — "suy giảm phải TRUNG THỰC": lỗi KHÔNG phải missing-table
  // là BẤT NGỜ (bug/kết nối hỏng/...), phải khác hẳn console.warn im lặng của
  // trường hợp "chưa migrate". Hai nhánh log khác nhau ⇒ hai test riêng, không gộp.
  it("lỗi BẤT NGỜ (không phải missing-table) ⇒ vẫn trả rỗng NHƯNG console.error được gọi với lỗi gốc", async () => {
    const boom = new Error("connection reset by peer");
    const { getDb } = await import("../db/connection");
    (getDb as any).mockResolvedValueOnce({
      select: () => ({ from: () => ({ innerJoin: () => ({ where: () => Promise.reject(boom) }) }) }),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(countPendingByPoint(1)).resolves.toEqual({ byPoint: {}, total: 0 });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]).toContain(boom);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("bảng chưa migrate (42P01) ⇒ console.error KHÔNG được gọi (chỉ console.warn — dự kiến được)", async () => {
    const inner: any = new Error('relation "threshold_approvals" does not exist');
    inner.code = "42P01";
    const wrapped: any = new Error("DrizzleQueryError");
    wrapped.cause = inner;
    const { getDb } = await import("../db/connection");
    (getDb as any).mockResolvedValueOnce({
      select: () => ({ from: () => ({ innerJoin: () => ({ where: () => Promise.reject(wrapped) }) }) }),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(countPendingByPoint(1)).resolves.toEqual({ byPoint: {}, total: 0 });
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
