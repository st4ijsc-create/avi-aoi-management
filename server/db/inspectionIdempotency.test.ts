/**
 * Doc 51 P0 (R2) — createProductInspection: insert idempotent ở TẦNG DB.
 *
 * Phủ hợp đồng của hàm sau khi chuyển sang ON CONFLICT DO NOTHING (migration 0272
 * dựng uq_inspections_machine_serial_time):
 *   • insert thành công  → trả id MỚI, outcome.duplicate = false
 *   • conflict (retry)   → KHÔNG tạo row, SELECT row cũ theo natural key, trả id
 *                          CŨ, outcome.duplicate = true
 *   • conflict mà không tìm thấy row cũ → NÉM lỗi (không bao giờ bịa id)
 *   • callers cũ (seed/test/analytics) không truyền outcome → hợp đồng
 *     Promise<number> giữ nguyên
 *
 * Ràng buộc unique THẬT (partial unique index trên hypertable Timescale) đã được
 * kiểm chứng trực tiếp trên DB dev; ở đây fake drizzle chỉ chốt hành vi tầng app.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

/** Bắt lại query cuối cùng để assert đúng nhánh nào được gọi. */
const state = {
  insertValues: undefined as unknown,
  onConflictUsed: false,
  insertReturns: [] as Array<{ id: number }>,
  selectReturns: [] as Array<{ id: number }>,
  selectCalls: 0,
};

vi.mock("./connection", () => {
  const fakeDb = {
    insert: () => ({
      values: (data: unknown) => {
        state.insertValues = data;
        return {
          onConflictDoNothing: () => {
            state.onConflictUsed = true;
            return { returning: async () => state.insertReturns };
          },
          // Nếu code quay lại plain insert (mất chống-trùng) test sẽ đỏ ở đây.
          returning: async () => {
            throw new Error("plain insert without onConflictDoNothing — idempotency lost");
          },
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => {
              state.selectCalls += 1;
              return state.selectReturns;
            },
          }),
        }),
      }),
    }),
  };
  return { getDb: vi.fn(async () => fakeDb) };
});

vi.mock("../services/downtimeDetectionService", () => ({
  recordMachineActivity: vi.fn(async () => undefined),
}));

import { createProductInspection, type CreateInspectionOutcome } from "./inspection";
import type { InsertProductInspection } from "../../drizzle/schema";

const BASE: InsertProductInspection = {
  machineId: 5,
  serialNumber: "SN-1",
  inspectionTime: new Date("2026-07-15T08:00:00.000Z"),
  overallResult: "OK",
  originalResult: "OK",
};

beforeEach(() => {
  state.insertValues = undefined;
  state.onConflictUsed = false;
  state.insertReturns = [];
  state.selectReturns = [];
  state.selectCalls = 0;
  vi.clearAllMocks();
});

describe("createProductInspection — idempotency (doc 51 P0 / R2)", () => {
  it("insert mới → dùng ON CONFLICT DO NOTHING, trả id mới, duplicate = false", async () => {
    state.insertReturns = [{ id: 101 }];
    const outcome: CreateInspectionOutcome = { duplicate: false };

    const id = await createProductInspection(BASE, outcome);

    expect(id).toBe(101);
    expect(outcome.duplicate).toBe(false);
    expect(state.onConflictUsed).toBe(true);
    expect(state.selectCalls).toBe(0); // không cần lookup khi không conflict
    expect(state.insertValues).toMatchObject({ serialNumber: "SN-1", machineId: 5 });
  });

  it("conflict (retry của máy) → trả id row CŨ + duplicate = true, KHÔNG tạo row mới", async () => {
    state.insertReturns = []; // ON CONFLICT DO NOTHING nuốt insert
    state.selectReturns = [{ id: 77 }]; // row gốc đang tồn tại
    const outcome: CreateInspectionOutcome = { duplicate: false };

    const id = await createProductInspection(BASE, outcome);

    expect(id).toBe(77);
    expect(outcome.duplicate).toBe(true);
    expect(state.selectCalls).toBe(1); // resolve theo natural key
  });

  it("conflict nhưng không tìm được row cũ → NÉM lỗi (không bịa inspectionId)", async () => {
    state.insertReturns = [];
    state.selectReturns = []; // conflict trên ràng buộc khác / row biến mất
    await expect(createProductInspection(BASE)).rejects.toThrow(
      /insert conflicted but no existing row/i,
    );
  });

  it("caller cũ không truyền outcome → vẫn là Promise<number> như trước (không phá seed/test)", async () => {
    state.insertReturns = [{ id: 202 }];
    await expect(createProductInspection(BASE)).resolves.toBe(202);

    state.insertReturns = [];
    state.selectReturns = [{ id: 55 }];
    await expect(createProductInspection(BASE)).resolves.toBe(55); // trùng → id cũ, không throw
  });
});
