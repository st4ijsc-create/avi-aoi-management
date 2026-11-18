/**
 * Q0-2 — ngưỡng cảnh báo yield ở đường nạp máy đọc `yield_alert_thresholds` (metric FY), mặc định 90 khi vắng/tắt/lỗi.
 * kiem-dinh 2026-11-06 (lô C ❌): đột biến y5 (bỏ cấu hình, luôn 90) và y6 (bỏ `isEnabled`) sống sót vì không test nào
 * đi qua nhánh cảnh báo. Máy báo yield 80% (getMachineStats) nên: ngưỡng 90 ⇒ cảnh báo; ngưỡng 70 ⇒ KHÔNG cảnh báo.
 * Không chạm DB (`../db` là bản giả) — cùng khuôn `machineApiSingleTx.test.ts`, đường hai pha (cờ single-tx TẮT).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../db", () => {
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
    getDb: vi.fn(async () => fakeDb),
    getMachineByApiKey: vi.fn(),
    getMachineByCode: vi.fn(),
    getMachineById: vi.fn(),
    updateMachineHeartbeat: vi.fn(async () => undefined),
    getProductModelByCode: vi.fn(async () => undefined),
    getProductionOrderByCode: vi.fn(),
    updateProductionOrderQuantities: vi.fn(async () => undefined),
    // ── doc 55 Item 1 — the single-tx surface under test ──
    reserveInspectionId: vi.fn(async () => 7777),
    persistInspectionAtomic: vi.fn(),
    createProductInspection: vi.fn(),
    deleteInspectionForCompensation: vi.fn(async () => undefined),
    createMeasurementResults: vi.fn(async () => undefined),
    getMachineStats: vi.fn(async () => ({ total: 10, ok: 8, ng: 2, ntf: 0, yieldRate: 80 })),
    getYieldAlertThresholdByType: vi.fn(async () => null),
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

// Spy the object storage so we can assert the reserved id is embedded in the key,
// and that the ON-path failure does NOT delete images (relies on the orphan reaper).
vi.mock("../storage", () => ({
  storagePut: vi.fn(async (key: string) => ({ url: `http://store/${key}` })),
  storageGet: vi.fn(async () => null),
  storageDelete: vi.fn(async () => ({ deleted: true })),
  resolveImageToDataUrl: vi.fn(async () => null),
}));

// Side-effect surfaces a duplicate/short-circuit MUST NOT re-trigger.
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
import { emitYieldWarning } from "../_core/socket";
import type { TrpcContext } from "../_core/context";

const MACHINE = { id: 5, code: "AOI-01", name: "AOI Machine", stationId: 1, isActive: true };
const ORDER = { id: 42, code: "WO-2026-001" };
const ctx = (): TrpcContext => ({ user: null, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] });
const fnOf = (f: unknown) => f as ReturnType<typeof vi.fn>;

async function nap() {
  return machineApiRouter.createCaller(ctx()).submitInspection({
    apiKey: "SHARED-KEY",
    serialNumber: "SN-YIELD",
    overallResult: "OK" as const,
    inspectionTime: "2026-07-16T09:00:00.000Z",
    productionOrderCode: ORDER.code,
    measurements: [],
  });
}

beforeEach(() => {
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  process.env.INSPECTION_STORE_FORWARD_ENABLED = "false";
  delete process.env.INSPECTION_SINGLE_TX_ENABLED;
  delete process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN;
  delete process.env.AI_INLINE_GATE_ENABLED;
  vi.clearAllMocks();
  fnOf(db.getMachineByApiKey).mockResolvedValue(MACHINE);
  fnOf(db.getMachineById).mockResolvedValue(MACHINE);
  fnOf(db.getProductionOrderByCode).mockResolvedValue(ORDER);
  fnOf(db.createProductInspection).mockResolvedValue(555);
  fnOf(db.getMachineStats).mockResolvedValue({ total: 10, ok: 8, ng: 2, ntf: 0, yieldRate: 80 });
  fnOf(db.getYieldAlertThresholdByType).mockResolvedValue(null);
});

describe("ngưỡng cảnh báo yield khi nạp máy (yield_alert_thresholds, metric FY)", () => {
  it("chưa cấu hình ⇒ ngưỡng 90 như cũ: yield 80 < 90 ⇒ cảnh báo kèm ngưỡng 90", async () => {
    await nap();
    expect(db.getYieldAlertThresholdByType).toHaveBeenCalledWith("FY", null);
    expect(emitYieldWarning).toHaveBeenCalledTimes(1);
    expect(emitYieldWarning).toHaveBeenCalledWith(5, "AOI Machine", "AOI-01", 80, 90);
  });

  it("y5 — cấu hình BẬT ngưỡng 70 ⇒ yield 80 ≥ 70 ⇒ KHÔNG cảnh báo (bỏ cấu hình, luôn 90, sẽ cảnh báo ⇒ đỏ)", async () => {
    fnOf(db.getYieldAlertThresholdByType).mockResolvedValue({ isEnabled: true, warningThreshold: "70" });
    await nap();
    expect(emitYieldWarning).not.toHaveBeenCalled();
  });

  it("cấu hình BẬT ngưỡng 85 ⇒ yield 80 < 85 ⇒ cảnh báo kèm đúng ngưỡng 85 (không phải 90)", async () => {
    fnOf(db.getYieldAlertThresholdByType).mockResolvedValue({ isEnabled: true, warningThreshold: "85" });
    await nap();
    expect(emitYieldWarning).toHaveBeenCalledWith(5, "AOI Machine", "AOI-01", 80, 85);
  });

  it("y6 — cấu hình TẮT (isEnabled=false, ngưỡng 70) ⇒ bỏ qua, dùng 90 ⇒ vẫn cảnh báo ngưỡng 90 (bỏ isEnabled sẽ dùng 70, im lặng ⇒ đỏ)", async () => {
    fnOf(db.getYieldAlertThresholdByType).mockResolvedValue({ isEnabled: false, warningThreshold: "70" });
    await nap();
    expect(emitYieldWarning).toHaveBeenCalledWith(5, "AOI Machine", "AOI-01", 80, 90);
  });

  it("ngưỡng không hợp lệ (0 / chữ) hoặc đọc lỗi ⇒ giữ 90, không làm hỏng lượt nạp", async () => {
    for (const bad of [{ isEnabled: true, warningThreshold: "0" }, { isEnabled: true, warningThreshold: "abc" }]) {
      vi.clearAllMocks();
      fnOf(db.getMachineByApiKey).mockResolvedValue(MACHINE);
      fnOf(db.getMachineById).mockResolvedValue(MACHINE);
      fnOf(db.getProductionOrderByCode).mockResolvedValue(ORDER);
      fnOf(db.createProductInspection).mockResolvedValue(555);
      fnOf(db.getMachineStats).mockResolvedValue({ total: 10, ok: 8, ng: 2, ntf: 0, yieldRate: 80 });
      fnOf(db.getYieldAlertThresholdByType).mockResolvedValue(bad);
      await nap();
      expect(emitYieldWarning).toHaveBeenCalledWith(5, "AOI Machine", "AOI-01", 80, 90);
    }
    vi.clearAllMocks();
    fnOf(db.getMachineByApiKey).mockResolvedValue(MACHINE);
    fnOf(db.getMachineById).mockResolvedValue(MACHINE);
    fnOf(db.getProductionOrderByCode).mockResolvedValue(ORDER);
    fnOf(db.createProductInspection).mockResolvedValue(555);
    fnOf(db.getMachineStats).mockResolvedValue({ total: 10, ok: 8, ng: 2, ntf: 0, yieldRate: 80 });
    fnOf(db.getYieldAlertThresholdByType).mockRejectedValue(new Error("db down"));
    const res = await nap();
    expect(res).toEqual({ success: true, inspectionId: 555 });
    expect(emitYieldWarning).toHaveBeenCalledWith(5, "AOI Machine", "AOI-01", 80, 90);
  });
});
