/**
 * Doc 51 P0 (R2) — submitInspection INGEST IDEMPOTENCY tests.
 *
 * Rủi ro R2 (đã tự-kiểm-chứng trong doc 51): product_inspections không có unique
 * key → máy retry cùng một board (ACK timeout, agent restart) ghi row THỨ HAI →
 * ĐẾM TRÙNG (completedQuantity +2, yield sai, ERP outbox + cảnh báo NG bắn 2 lần).
 *
 * Migration 0272 dựng unique index ("machineId","serialNumber","inspectionTime")
 * WHERE "serialNumber" <> ''; db.createProductInspection chuyển sang ON CONFLICT
 * DO NOTHING + resolve row cũ; processInspectionSubmission SHORT-CIRCUIT khi trùng.
 *
 * Test này chạy qua tRPC mutation THẬT với ../db mock mô phỏng ĐÚNG ngữ nghĩa của
 * unique index đó (insert lần 2 cùng natural key ⇒ không tạo row, trả id CŨ, bật
 * outcome.duplicate) → chứng minh KHÔNG có tác dụng phụ nào chạy lại.
 *
 * Bổ trợ: server/db/inspectionIdempotency.test.ts phủ tầng DB (ON CONFLICT DO
 * NOTHING + lookup row cũ); server/routers/machineApiDurability.test.ts phủ WAL.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../db", () => {
  // measurement_results chỉ được ghi qua dbInstance.transaction() → đếm ở đây.
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      insert: () => ({ values: async () => undefined }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    }),
  );
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [] }),
        orderBy: () => ({ limit: async () => [] }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({ values: async () => undefined }),
    transaction,
  };
  return {
    __transaction: transaction,
    getDb: vi.fn(async () => fakeDb),
    getMachineByApiKey: vi.fn(),
    getMachineByCode: vi.fn(),
    getMachineById: vi.fn(),
    updateMachineHeartbeat: vi.fn(async () => undefined),
    getProductModelByCode: vi.fn(async () => undefined),
    getProductionOrderByCode: vi.fn(),
    updateProductionOrderQuantities: vi.fn(async () => undefined),
    createProductInspection: vi.fn(),
    createMeasurementResults: vi.fn(async () => undefined),
    getMachineStats: vi.fn(async () => ({ total: 10, ok: 10, ng: 0, ntf: 0, yieldRate: 100 })),
    // ⚠ 2026-08-18 — CHUỖI PHÂN CẤP PHẢI PHÂN GIẢI ĐƯỢC. Đường ingest nay SUY mã tenant từ máy
    // (`phamViGhiMay.macTenantChoGhi`) và TỪ CHỐI một máy không ra được nhà máy. Bốn stub cũ trả
    // `undefined` mô tả một cái máy KHÔNG THUỘC NHÀ MÁY NÀO — trạng thái mà lược đồ KHÔNG cho
    // phép tồn tại (`machines.stationId` NOT NULL + ba FK `ON DELETE RESTRICT`), nên stub cũ là
    // một lời khai SAI VỀ THẾ GIỚI, không phải một lối tắt vô hại.
    getStationById: vi.fn(async () => ({ id: 1, code: "ST-MOCK", lineId: 1 })),
    getLineById: vi.fn(async () => ({ id: 1, code: "LINE-MOCK", workshopId: 1 })),
    getWorkshopById: vi.fn(async () => ({ id: 1, code: "WS-MOCK", factoryId: 1 })),
    getFactoryById: vi.fn(async () => ({ id: 1, code: "FAC-MOCK", corporateCode: "CORP-MOCK" })),
    getDefectCatalogByCode: vi.fn(async () => undefined),
    recordUnmatchedDefectCodes: vi.fn(async () => undefined),
    // Điểm đo đã có sẵn → không kích hoạt nhánh auto-provision.
    getMeasurementPointDefByCode: vi.fn(async () => undefined),
    getMeasurementPointDefByMachineAndCode: vi.fn(async () => ({
      id: 900,
      code: "MP001",
      name: "Point 1",
      referenceImageUrl: null,
      workstationId: null,
      normalizedX: null,
      normalizedY: null,
      normalizedRadius: null,
    })),
  };
});

// Side-effect surfaces the duplicate short-circuit MUST NOT re-trigger.
vi.mock("../_core/socket", () => ({
  emitNGAlert: vi.fn(),
  emitYieldWarning: vi.fn(),
  emitDashboardUpdate: vi.fn(),
}));
vi.mock("../services/mqttService", () => ({
  publishNGAlert: vi.fn(async () => undefined),
  publishPointsConfigChanged: vi.fn(async () => undefined),
}));
vi.mock("../services/integration/outboxProducers", () => ({
  publishToOutbox: vi.fn(),
}));

import { machineApiRouter } from "./machineApiRouters";
import * as db from "../db";
import { emitNGAlert } from "../_core/socket";
import { publishNGAlert } from "../services/mqttService";
import { publishToOutbox } from "../services/integration/outboxProducers";
import type { CreateInspectionOutcome } from "../db/inspection";
import type { InsertProductInspection } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";

const MACHINE = { id: 5, code: "AOI-01", name: "AOI Machine", stationId: 1, isActive: true };
const ORDER = { id: 42, code: "WO-2026-001" };

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    apiKey: "SHARED-KEY",
    serialNumber: "SN-DUP-1",
    overallResult: "OK" as const,
    // Máy CÓ gửi inspectionTime → natural key ổn định giữa các lần retry.
    inspectionTime: "2026-07-15T08:00:00.000Z",
    productionOrderCode: ORDER.code,
    measurements: [],
    ...overrides,
  };
}

/**
 * Mô phỏng uq_inspections_machine_serial_time ở tầng mock: key =
 * (machineId, serialNumber, inspectionTime). Trả về số lần row THẬT được tạo.
 */
function installIdempotentInsertFake() {
  const rows = new Map<string, number>();
  let nextId = 1000;
  let realInserts = 0;
  (db.createProductInspection as ReturnType<typeof vi.fn>).mockImplementation(
    async (data: InsertProductInspection, outcome?: CreateInspectionOutcome) => {
      const key = `${data.machineId}|${data.serialNumber}|${(data.inspectionTime as Date).toISOString()}`;
      const existing = rows.get(key);
      if (existing !== undefined) {
        if (outcome) outcome.duplicate = true; // ON CONFLICT DO NOTHING → row cũ
        return existing;
      }
      const id = nextId++;
      rows.set(key, id);
      realInserts += 1;
      if (outcome) outcome.duplicate = false;
      return id;
    },
  );
  return {
    get realInserts() {
      return realInserts;
    },
  };
}

beforeEach(() => {
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  // OFF: lỗi bất ngờ phải NỔ ra thay vì biến thành ACK queued (WAL đã có test riêng).
  process.env.INSPECTION_STORE_FORWARD_ENABLED = "false";
  delete process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN;
  delete process.env.AI_INLINE_GATE_ENABLED;
  vi.clearAllMocks();
  (db.getMachineByApiKey as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineById as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getProductionOrderByCode as ReturnType<typeof vi.fn>).mockResolvedValue(ORDER);
  (db.getMachineStats as ReturnType<typeof vi.fn>).mockResolvedValue({
    total: 10, ok: 10, ng: 0, ntf: 0, yieldRate: 100,
  });
});

describe("submitInspection idempotency (doc 51 P0 / R2 — chống đếm trùng)", () => {
  it("2 lần submit LIVE cùng payload → 1 row, cùng inspectionId, KHÔNG đếm trùng lệnh sản xuất", async () => {
    const fake = installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());

    const first = await caller.submitInspection(payload());
    const second = await caller.submitInspection(payload()); // vendor client retry

    // 1) chỉ MỘT row product_inspections được tạo
    expect(fake.realInserts).toBe(1);

    // 2) lần 2 trả CÙNG inspectionId + gắn cờ duplicate cho máy biết
    expect(second.inspectionId).toBe(first.inspectionId);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect((first as { duplicate?: boolean }).duplicate).toBeUndefined();
    expect((second as { duplicate?: boolean }).duplicate).toBe(true);

    // 3) ★ điểm cốt lõi: completedQuantity KHÔNG bị +2
    expect(db.updateProductionOrderQuantities).toHaveBeenCalledTimes(1);
    expect(db.updateProductionOrderQuantities).toHaveBeenCalledWith(
      ORDER.id,
      expect.objectContaining({ completedQuantity: 1, okQuantity: 1 }),
    );

    // 4) ERP outbox chỉ bắn 1 lần
    expect(publishToOutbox).toHaveBeenCalledTimes(1);
  });

  it("board NG retry → cảnh báo NG KHÔNG bắn lần 2 (operator không bị Andon kép)", async () => {
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());
    const ngPayload = payload({ serialNumber: "SN-NG-1", overallResult: "NG" as const });

    await caller.submitInspection(ngPayload);
    expect(emitNGAlert).toHaveBeenCalledTimes(1);
    expect(publishNGAlert).toHaveBeenCalledTimes(1);

    const retry = await caller.submitInspection(ngPayload);

    expect((retry as { duplicate?: boolean }).duplicate).toBe(true);
    expect(emitNGAlert).toHaveBeenCalledTimes(1); // vẫn 1 — không bắn lại
    expect(publishNGAlert).toHaveBeenCalledTimes(1);
  });

  it("bản TRÙNG không ghi lại measurement_results", async () => {
    installIdempotentInsertFake();
    const tx = (db as unknown as { __transaction: ReturnType<typeof vi.fn> }).__transaction;
    const caller = machineApiRouter.createCaller(ctx());
    const withPoints = payload({
      serialNumber: "SN-MR-1",
      measurements: [{ pointCode: "MP001", result: "OK" as const, measuredValue: 1.23 }],
    });

    await caller.submitInspection(withPoints);
    // Lần 1: measurement_results ĐƯỢC ghi (chứng minh test thật sự chạm nhánh này).
    expect(tx).toHaveBeenCalledTimes(1);

    await caller.submitInspection(withPoints);
    // Lần 2 short-circuit TRƯỚC khi build/insert measurement → không thêm transaction nào.
    expect(tx).toHaveBeenCalledTimes(1);
  });

  it("serial KHÁC nhau vẫn ghi bình thường (chống-trùng không chặn nhầm hàng thật)", async () => {
    const fake = installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());

    const a = await caller.submitInspection(payload({ serialNumber: "SN-A" }));
    const b = await caller.submitInspection(payload({ serialNumber: "SN-B" }));

    expect(fake.realInserts).toBe(2);
    expect(a.inspectionId).not.toBe(b.inspectionId);
    expect(db.updateProductionOrderQuantities).toHaveBeenCalledTimes(2);
  });

  it("cùng serial nhưng inspectionTime KHÁC → là board thật, KHÔNG bị coi là trùng (QĐ#3: nhận, không từ chối cứng)", async () => {
    const fake = installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());

    await caller.submitInspection(payload({ serialNumber: "SN-REWORK" }));
    const rework = await caller.submitInspection(
      payload({ serialNumber: "SN-REWORK", inspectionTime: "2026-07-15T09:30:00.000Z" }),
    );

    expect(fake.realInserts).toBe(2);
    expect((rework as { duplicate?: boolean }).duplicate).toBeUndefined();
  });

  it("store-forward BẬT (QĐ#6): bản trùng vẫn ACK success + ledger, không nổ lỗi", async () => {
    process.env.INSPECTION_STORE_FORWARD_ENABLED = "true";
    const fake = installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());

    await caller.submitInspection(payload({ serialNumber: "SN-SF" }));
    const retry = await caller.submitInspection(payload({ serialNumber: "SN-SF" }));

    expect(retry.success).toBe(true);
    expect((retry as { duplicate?: boolean }).duplicate).toBe(true);
    expect((retry as { queued?: boolean }).queued).toBeUndefined(); // KHÔNG rơi vào nhánh WAL
    expect(fake.realInserts).toBe(1);
  });
});

describe("submitInspection serialNumber validation (doc 51 P0)", () => {
  it("serialNumber '' bị zod từ chối (không bao giờ chạm DB)", async () => {
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());
    await expect(
      caller.submitInspection(payload({ serialNumber: "" })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.createProductInspection).not.toHaveBeenCalled();
  });

  it("serialNumber toàn khoảng trắng bị từ chối (trim rồi mới min(1))", async () => {
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());
    await expect(
      caller.submitInspection(payload({ serialNumber: "   " })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.createProductInspection).not.toHaveBeenCalled();
  });

  it("serialNumber > 100 ký tự bị từ chối (khớp varchar(100) — hết lỗi cắt cụt ngầm)", async () => {
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());
    await expect(
      caller.submitInspection(payload({ serialNumber: "S".repeat(101) })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.createProductInspection).not.toHaveBeenCalled();
  });

  it("serial có khoảng trắng thừa được TRIM trước khi ghi → retry ' SN ' và 'SN' cùng một khoá", async () => {
    const fake = installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());

    await caller.submitInspection(payload({ serialNumber: "  SN-TRIM  " }));
    const persisted = (db.createProductInspection as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as InsertProductInspection;
    expect(persisted.serialNumber).toBe("SN-TRIM");

    const retry = await caller.submitInspection(payload({ serialNumber: "SN-TRIM" }));
    expect((retry as { duplicate?: boolean }).duplicate).toBe(true);
    expect(fake.realInserts).toBe(1);
  });

  it("serial đúng 100 ký tự vẫn được nhận (biên trên hợp lệ)", async () => {
    const fake = installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());
    const res = await caller.submitInspection(payload({ serialNumber: "S".repeat(100) }));
    expect(res.success).toBe(true);
    expect(fake.realInserts).toBe(1);
  });
});
