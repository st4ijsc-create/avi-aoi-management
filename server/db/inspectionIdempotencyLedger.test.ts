/**
 * Doc 51 P1 — createProductInspection với EXPLICIT idempotencyKey (migration 0275).
 *
 * Phủ GIAO THỨC GHI của ledger inspection_idempotency_keys — thứ thay thế cho
 * unique index bất khả thi trên hypertable:
 *   • claim thắng  → insert header → back-fill inspectionId, TẤT CẢ trong MỘT transaction
 *   • claim thua   → KHÔNG insert header, trả inspectionId của row gốc, duplicate = true
 *   • claim thắng nhưng header đụng natural key 0272 (cùng serial+time, khoá MỚI)
 *                  → trỏ khoá vào row gốc + duplicate = true
 *   • claim đã commit mà inspectionId NULL (bất biến vỡ) → NÉM, không bịa id
 *   • KHÔNG có idempotencyKey → đường cũ P0 y nguyên, KHÔNG mở transaction
 *
 * Bổ trợ: inspectionIdempotency.test.ts (P0) phủ natural key;
 * routers/machineApiProvenance.test.ts phủ đầu-cuối qua tRPC.
 *
 * ⚠ Giới hạn của test này: fake drizzle chốt LOGIC tầng app. Việc PK
 * ("machineId","idempotencyKey") thật sự cưỡng chế được — và việc unique index
 * trên product_inspections thì KHÔNG (Timescale đòi cột partition) — đã kiểm
 * chứng TRỰC TIẾP trên DB dev, không phải suy đoán (xem 0275 + báo cáo P1).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const state = {
  /** [] = khoá đã có chủ (ON CONFLICT DO NOTHING nuốt); [row] = ta giành được. */
  claimReturns: [] as Array<{ machineId: number }>,
  /** Row ledger đã tồn tại, đọc khi claim thua. */
  priorLedgerReturns: [] as Array<{ inspectionId: number | null }>,
  /** [] = header đụng natural key 0272; [row] = insert thật. */
  headerInsertReturns: [] as Array<{ id: number }>,
  /** Row product_inspections cũ, đọc khi header conflict. */
  naturalKeyReturns: [] as Array<{ id: number }>,

  // ── ghi nhận hành vi ──
  transactionOpened: 0,
  ledgerInserts: [] as unknown[],
  headerInserts: [] as unknown[],
  ledgerUpdates: [] as unknown[],
};

vi.mock("./connection", () => {
  const LEDGER = "inspection_idempotency_keys";
  const HEADER = "product_inspections";

  // drizzle gắn tên bảng vào một Symbol nội bộ; đọc qua getTableName cho chắc.
  const nameOf = (table: unknown): string => {
    const sym = Object.getOwnPropertySymbols(table as object).find((s) =>
      String(s).includes("Name"),
    );
    return sym ? String((table as Record<symbol, unknown>)[sym]) : "";
  };

  const makeRunner = () => ({
    insert: (table: unknown) => ({
      values: (data: unknown) => {
        const t = nameOf(table);
        return {
          onConflictDoNothing: () => ({
            returning: async () => {
              if (t === LEDGER) {
                state.ledgerInserts.push(data);
                return state.claimReturns;
              }
              state.headerInserts.push(data);
              return state.headerInsertReturns;
            },
          }),
          // Quay lại plain insert = mất chống-trùng → test phải đỏ ngay.
          returning: async () => {
            throw new Error("plain insert without onConflictDoNothing — idempotency lost");
          },
        };
      },
    }),
    select: () => ({
      from: (table: unknown) => {
        const t = nameOf(table);
        return {
          where: () => ({
            // Ledger: .where().limit()
            limit: async () => (t === LEDGER ? state.priorLedgerReturns : []),
            // Header natural key: .where().orderBy().limit()
            orderBy: () => ({ limit: async () => state.naturalKeyReturns }),
          }),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (data: unknown) => ({
        where: async () => {
          if (nameOf(table) === LEDGER) state.ledgerUpdates.push(data);
        },
      }),
    }),
  });

  const fakeDb = {
    ...makeRunner(),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      state.transactionOpened += 1;
      return fn(makeRunner());
    },
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
const KEYED: InsertProductInspection = { ...BASE, idempotencyKey: "board-uuid-0001-abcd" };

beforeEach(() => {
  state.claimReturns = [];
  state.priorLedgerReturns = [];
  state.headerInsertReturns = [];
  state.naturalKeyReturns = [];
  state.transactionOpened = 0;
  state.ledgerInserts = [];
  state.headerInserts = [];
  state.ledgerUpdates = [];
  vi.clearAllMocks();
});

describe("createProductInspection — ledger idempotencyKey (doc 51 P1 / 0275)", () => {
  it("★ claim THẮNG → claim + insert header + back-fill inspectionId, trong MỘT transaction", async () => {
    state.claimReturns = [{ machineId: 5 }];
    state.headerInsertReturns = [{ id: 101 }];
    const outcome: CreateInspectionOutcome = { duplicate: false };

    const id = await createProductInspection(KEYED, outcome);

    expect(id).toBe(101);
    expect(outcome.duplicate).toBe(false);
    // Nguyên tử: cả ba lệnh phải nằm trong CÙNG một transaction, nếu không một cú
    // crash giữa chừng để lại khoá "đã dùng" trỏ vào hư vô → board mất vĩnh viễn.
    expect(state.transactionOpened).toBe(1);
    expect(state.ledgerInserts).toHaveLength(1);
    expect(state.ledgerInserts[0]).toMatchObject({
      machineId: 5,
      idempotencyKey: "board-uuid-0001-abcd",
    });
    expect(state.headerInserts).toHaveLength(1);
    expect(state.ledgerUpdates).toEqual([{ inspectionId: 101 }]);
  });

  it("★ claim THUA (retry) → KHÔNG insert header, trả id row gốc + duplicate = true", async () => {
    state.claimReturns = []; // PK đụng → ON CONFLICT DO NOTHING nuốt
    state.priorLedgerReturns = [{ inspectionId: 77 }];
    const outcome: CreateInspectionOutcome = { duplicate: false };

    const id = await createProductInspection(KEYED, outcome);

    expect(id).toBe(77);
    expect(outcome.duplicate).toBe(true);
    // ★ cốt lõi: KHÔNG một row product_inspections nào được tạo thêm.
    expect(state.headerInserts).toHaveLength(0);
    expect(state.ledgerUpdates).toHaveLength(0);
  });

  it("claim THẮNG nhưng header đụng natural key 0272 (cùng serial+time, khoá MỚI) → trỏ khoá vào row gốc, duplicate = true", async () => {
    state.claimReturns = [{ machineId: 5 }];
    state.headerInsertReturns = []; // uq_inspections_machine_serial_time nuốt insert
    state.naturalKeyReturns = [{ id: 42 }];
    const outcome: CreateInspectionOutcome = { duplicate: false };

    const id = await createProductInspection(KEYED, outcome);

    expect(id).toBe(42);
    expect(outcome.duplicate).toBe(true);
    // Khoá mới phải trỏ về ĐÚNG row gốc — nếu không, retry TIẾP THEO của khoá này
    // sẽ đọc ra NULL và nổ.
    expect(state.ledgerUpdates).toEqual([{ inspectionId: 42 }]);
  });

  it("claim đã COMMIT mà inspectionId NULL (bất biến vỡ) → NÉM, không bịa id", async () => {
    state.claimReturns = [];
    state.priorLedgerReturns = [{ inspectionId: null }];
    await expect(createProductInspection(KEYED)).rejects.toThrow(
      /idempotency key claimed but unresolved/i,
    );
  });

  it("claim thua nhưng ledger không đọc được row nào → NÉM (transient → WAL đệm, không mất board)", async () => {
    state.claimReturns = [];
    state.priorLedgerReturns = [];
    await expect(createProductInspection(KEYED)).rejects.toThrow(
      /idempotency key claimed but unresolved/i,
    );
  });

  it("khoá toàn khoảng trắng ⇒ coi như KHÔNG có khoá (không claim rỗng vào ledger)", async () => {
    state.headerInsertReturns = [{ id: 303 }];
    const id = await createProductInspection({ ...BASE, idempotencyKey: "   " });
    expect(id).toBe(303);
    expect(state.transactionOpened).toBe(0);
    expect(state.ledgerInserts).toHaveLength(0);
  });

  it("★ KHÔNG có idempotencyKey → đường P0 y nguyên: KHÔNG transaction, KHÔNG chạm ledger", async () => {
    state.headerInsertReturns = [{ id: 202 }];
    const outcome: CreateInspectionOutcome = { duplicate: false };

    const id = await createProductInspection(BASE, outcome);

    expect(id).toBe(202);
    expect(outcome.duplicate).toBe(false);
    // ~20 caller seed/test/analytics đi đường này — thêm transaction cho họ là
    // thuế vô ích trên đường nóng nhất hệ.
    expect(state.transactionOpened).toBe(0);
    expect(state.ledgerInserts).toHaveLength(0);
    expect(state.headerInserts).toHaveLength(1);
  });

  it("KHÔNG có idempotencyKey + conflict natural key → vẫn trả id cũ + duplicate (hợp đồng P0 nguyên vẹn)", async () => {
    state.headerInsertReturns = [];
    state.naturalKeyReturns = [{ id: 55 }];
    const outcome: CreateInspectionOutcome = { duplicate: false };

    await expect(createProductInspection(BASE, outcome)).resolves.toBe(55);
    expect(outcome.duplicate).toBe(true);
    expect(state.transactionOpened).toBe(0);
  });
});
