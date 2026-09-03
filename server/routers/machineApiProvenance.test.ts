/**
 * Doc 51 P1 — submitInspection PROVENANCE: clock skew (CASE #3), config version
 * pinning (CASE #12), explicit idempotency key (closing the P0/0272 hole).
 *
 * Mỗi test dưới đây phải ĐỎ nếu gỡ đúng một mẩu fix (đã tự kiểm bằng mutation
 * test — xem báo cáo P1):
 *   • gỡ ledger idempotencyKey  → "2 lần cùng khoá" ghi 2 row
 *   • gỡ stamp skew             → clockSkewFlagged/timeSkewSeconds undefined
 *   • gỡ superRefine            → naive/unparseable lọt qua khi cờ BẬT
 *   • gỡ stamp version          → pointsConfigVersion/configVersionStatus undefined
 *
 * Bổ trợ: server/db/inspectionIdempotencyLedger.test.ts phủ giao thức ghi ledger
 * ở tầng DB; machineApiIdempotency.test.ts (P0) phủ natural key.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
    getProductionOrderByCode: vi.fn(async () => undefined),
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
    getMeasurementPointDefByCode: vi.fn(async () => undefined),
    getMeasurementPointDefByMachineAndCode: vi.fn(async () => undefined),
  };
});

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
// Bề mặt cảnh báo ops THẬT mà skew phải chạm tới (dynamic import trong router).
vi.mock("../services/aiSmartAlertRouter", () => ({
  routeAlert: vi.fn(async () => ({
    alertType: "PATTERN_ANOMALY",
    targets: [],
    consolidated: false,
    escalationLevel: "L1",
  })),
}));

import { machineApiRouter, _resetClockSkewAlertCooldown } from "./machineApiRouters";
import * as db from "../db";
import { routeAlert } from "../services/aiSmartAlertRouter";
import type { CreateInspectionOutcome } from "../db/inspection";
import type { InsertProductInspection } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";

const MACHINE = { id: 5, code: "AOI-01", name: "AOI Machine", stationId: 1, isActive: true };

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
    serialNumber: "SN-P1-1",
    overallResult: "OK" as const,
    measurements: [],
    ...overrides,
  };
}

/** Bản ghi ĐÃ persist của lần gọi createProductInspection thứ `n` (0-based). */
function persisted(n = 0): InsertProductInspection {
  return (db.createProductInspection as ReturnType<typeof vi.fn>).mock
    .calls[n][0] as InsertProductInspection;
}

/**
 * Mô phỏng TRUNG THỰC hai lớp chống-trùng của DB:
 *   • ledger inspection_idempotency_keys — PK (machineId, idempotencyKey), 0275
 *   • uq_inspections_machine_serial_time — (machineId, serialNumber, inspectionTime), 0272
 * Ledger được kiểm TRƯỚC, đúng thứ tự createProductInspection thực hiện.
 */
function installIdempotentInsertFake() {
  const ledger = new Map<string, number>();
  const natural = new Map<string, number>();
  let nextId = 1000;
  let realInserts = 0;
  (db.createProductInspection as ReturnType<typeof vi.fn>).mockImplementation(
    async (data: InsertProductInspection, outcome?: CreateInspectionOutcome) => {
      const idem = data.idempotencyKey?.trim();
      if (idem) {
        const lk = `${data.machineId}|${idem}`;
        const hit = ledger.get(lk);
        if (hit !== undefined) {
          if (outcome) outcome.duplicate = true;
          return hit;
        }
      }
      const nk = `${data.machineId}|${data.serialNumber}|${(data.inspectionTime as Date).toISOString()}`;
      const nHit = natural.get(nk);
      if (nHit !== undefined) {
        if (idem) ledger.set(`${data.machineId}|${idem}`, nHit);
        if (outcome) outcome.duplicate = true;
        return nHit;
      }
      const id = nextId++;
      natural.set(nk, id);
      if (idem) ledger.set(`${data.machineId}|${idem}`, id);
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
  process.env.INSPECTION_STORE_FORWARD_ENABLED = "false";
  delete process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN;
  delete process.env.AI_INLINE_GATE_ENABLED;
  delete process.env.INGEST_REQUIRE_TIME_OFFSET;
  delete process.env.INGEST_CLOCK_SKEW_WARN_SECONDS;
  delete process.env.INGEST_CLOCK_SKEW_ALERT_ENABLED;
  delete process.env.INGEST_CLOCK_SKEW_ALERT_COOLDOWN_SEC;
  _resetClockSkewAlertCooldown();
  vi.clearAllMocks();
  (db.getMachineByApiKey as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineById as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineStats as ReturnType<typeof vi.fn>).mockResolvedValue({
    total: 10, ok: 10, ng: 0, ntf: 0, yieldRate: 100,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ════════════════════════════════════════════════════════════════════════════
describe("idempotencyKey — bịt nốt lỗ P0 (máy KHÔNG gửi inspectionTime)", () => {
  it("★ 2 lần cùng idempotencyKey, KHÔNG gửi inspectionTime → 1 row + duplicate:true", async () => {
    const fake = installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());
    const p = payload({ idempotencyKey: "board-uuid-0001-abcd" });

    const first = await caller.submitInspection(p);
    // Retry của máy: HTTP request MỚI ⇒ server đóng dấu now() MỚI ⇒ natural key
    // 0272 KHÁC hoàn toàn. Chỉ ledger idempotencyKey mới bắt được.
    const second = await caller.submitInspection(p);

    expect(fake.realInserts).toBe(1);
    expect(second.inspectionId).toBe(first.inspectionId);
    expect((second as { duplicate?: boolean }).duplicate).toBe(true);

    // Chứng minh test THẬT SỰ chạm đúng lỗ hổng: hai lần gọi mang inspectionTime
    // KHÁC nhau (server stamp now() mỗi lần) — natural key 0272 vô dụng ở đây.
    const t1 = (persisted(0).inspectionTime as Date).getTime();
    const t2 = (persisted(1).inspectionTime as Date).getTime();
    expect(t2).toBeGreaterThanOrEqual(t1);
    expect(persisted(0).timeSource).toBe("server");
  });

  it("KHÔNG có idempotencyKey + KHÔNG có inspectionTime → VẪN 2 row (giới hạn có thật, không tô hồng)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T08:00:00.000Z"));
    const fake = installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());

    await caller.submitInspection(payload({ serialNumber: "SN-NOKEY" }));
    vi.setSystemTime(new Date("2026-07-15T08:00:01.000Z")); // retry 1s sau
    await caller.submitInspection(payload({ serialNumber: "SN-NOKEY" }));

    // Đây là hành vi ĐÚNG-NHƯ-MÔ-TẢ, không phải bug của P1: hai HTTP request độc
    // lập không mang danh tính chung nào. Máy PHẢI gửi idempotencyKey để được bảo vệ.
    expect(fake.realInserts).toBe(2);
  });

  it("idempotencyKey khác nhau → board thật khác nhau, không chặn nhầm", async () => {
    const fake = installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());

    await caller.submitInspection(payload({ idempotencyKey: "board-uuid-aaaa-0001" }));
    await caller.submitInspection(payload({ idempotencyKey: "board-uuid-aaaa-0002" }));

    expect(fake.realInserts).toBe(2);
  });

  it("idempotencyKey được đóng dấu NGUYÊN VĂN (đã trim) vào row để audit", async () => {
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());
    await caller.submitInspection(payload({ idempotencyKey: "  board-uuid-trim-01  " }));
    expect(persisted(0).idempotencyKey).toBe("board-uuid-trim-01");
  });

  it("idempotencyKey < 8 ký tự bị zod từ chối (chống khoá entropy thấp đụng nhau giữa các board)", async () => {
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());
    await expect(
      caller.submitInspection(payload({ idempotencyKey: "1234567" })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.createProductInspection).not.toHaveBeenCalled();
  });

  it("cùng idempotencyKey trên board NG → Andon KHÔNG bắn lần 2", async () => {
    const { emitNGAlert } = await import("../_core/socket");
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());
    const p = payload({ overallResult: "NG" as const, idempotencyKey: "board-uuid-ng-0001" });

    await caller.submitInspection(p);
    expect(emitNGAlert).toHaveBeenCalledTimes(1);
    await caller.submitInspection(p);
    expect(emitNGAlert).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("CASE #3 — clock skew", () => {
  it("★ máy lệch 6h → row có clockSkewFlagged + timeSkewSeconds đúng + serverReceivedAt là giờ SERVER", async () => {
    vi.useFakeTimers();
    const serverNow = new Date("2026-07-15T08:00:00.000Z");
    vi.setSystemTime(serverNow);
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());

    // Đồng hồ máy chạy TRƯỚC 6 tiếng.
    await caller.submitInspection(
      payload({ inspectionTime: "2026-07-15T14:00:00.000Z" }),
    );

    const row = persisted(0);
    expect(row.clockSkewFlagged).toBe(true);
    expect(row.timeSkewSeconds).toBe(6 * 3600);
    expect(row.timeSource).toBe("machine_utc");
    // serverReceivedAt = giờ SERVER nhận, ghi THÔ (cutover 2026-09-03, BG-96 — KHÔNG còn
    // phép dịch "fake UTC"), KHÔNG phải giờ máy khai.
    expect((row.serverReceivedAt as Date).toISOString()).toBe(serverNow.toISOString());
  });

  it("máy lệch 6h VỀ QUÁ KHỨ → skew ÂM (giữ dấu: chạy chậm ≠ chạy trước)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T08:00:00.000Z"));
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());

    await caller.submitInspection(payload({ inspectionTime: "2026-07-15T02:00:00.000Z" }));

    expect(persisted(0).timeSkewSeconds).toBe(-6 * 3600);
    expect(persisted(0).clockSkewFlagged).toBe(true);
  });

  it("máy lệch 6h → BẮN cảnh báo ops qua bề mặt alert sẵn có", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T08:00:00.000Z"));
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());

    await caller.submitInspection(payload({ inspectionTime: "2026-07-15T14:00:00.000Z" }));
    await vi.waitFor(() => expect(routeAlert).toHaveBeenCalledTimes(1));

    expect(routeAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        machineId: MACHINE.id,
        severity: "HIGH",
        data: expect.objectContaining({ reason: "clock_skew", skewSeconds: 21600 }),
      }),
    );
  });

  it("máy hỏng đồng hồ bắn 1 board/s → cảnh báo bị cooldown chặn (không chôn ops dưới 3600 alert/h)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T08:00:00.000Z"));
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());

    for (let i = 0; i < 5; i++) {
      await caller.submitInspection(
        payload({ serialNumber: `SN-SKEW-${i}`, inspectionTime: "2026-07-15T14:00:00.000Z" }),
      );
    }
    await vi.waitFor(() => expect(routeAlert).toHaveBeenCalledTimes(1));

    // 5 board lệch giờ → 5 row ĐỀU được gắn cờ (dữ liệu đầy đủ) …
    for (let i = 0; i < 5; i++) expect(persisted(i).clockSkewFlagged).toBe(true);
    // … nhưng CHỈ 1 alert.
    expect(routeAlert).toHaveBeenCalledTimes(1);
  });

  it("máy đúng giờ (lệch 30s) → KHÔNG gắn cờ, KHÔNG alert, nhưng VẪN đo skew", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T08:00:00.000Z"));
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());

    await caller.submitInspection(payload({ inspectionTime: "2026-07-15T08:00:30.000Z" }));

    expect(persisted(0).clockSkewFlagged).toBe(false);
    expect(persisted(0).timeSkewSeconds).toBe(30);
    expect(routeAlert).not.toHaveBeenCalled();
  });

  it("ngưỡng cấu hình được qua INGEST_CLOCK_SKEW_WARN_SECONDS", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T08:00:00.000Z"));
    process.env.INGEST_CLOCK_SKEW_WARN_SECONDS = "10";
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());

    await caller.submitInspection(payload({ inspectionTime: "2026-07-15T08:00:30.000Z" }));
    expect(persisted(0).clockSkewFlagged).toBe(true); // 30s > 10s
  });

  it("máy KHÔNG gửi giờ → timeSource='server', skew=0 (không tự đo server với chính nó)", async () => {
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());
    await caller.submitInspection(payload());
    expect(persisted(0).timeSource).toBe("server");
    expect(persisted(0).timeSkewSeconds).toBe(0);
    expect(persisted(0).clockSkewFlagged).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("CASE #3 — timestamp naive (QĐ#1: cờ + mặc định tương thích ngược)", () => {
  it("★ cờ TẮT (mặc định) → naive timestamp VẪN được nhận, chỉ GẮN CỜ timeSource='machine_naive'", async () => {
    const fake = installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());

    const res = await caller.submitInspection(
      payload({ inspectionTime: "2026-07-15T08:00:00" }), // KHÔNG offset
    );

    expect(res.success).toBe(true);
    expect(fake.realInserts).toBe(1);
    expect(persisted(0).timeSource).toBe("machine_naive");
  });

  it("★ cờ BẬT → naive timestamp bị TỪ CHỐI (BAD_REQUEST), không chạm DB", async () => {
    process.env.INGEST_REQUIRE_TIME_OFFSET = "true";
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());

    await expect(
      caller.submitInspection(payload({ inspectionTime: "2026-07-15T08:00:00" })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.createProductInspection).not.toHaveBeenCalled();
  });

  it("cờ BẬT → timestamp CÓ offset vẫn qua bình thường (cả 'Z' lẫn '+07:00')", async () => {
    process.env.INGEST_REQUIRE_TIME_OFFSET = "true";
    const fake = installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());

    await caller.submitInspection(payload({ serialNumber: "SN-Z", inspectionTime: "2026-07-15T08:00:00.000Z" }));
    await caller.submitInspection(payload({ serialNumber: "SN-OFF", inspectionTime: "2026-07-15T15:00:00+07:00" }));

    expect(fake.realInserts).toBe(2);
    expect(persisted(0).timeSource).toBe("machine_utc");
    expect(persisted(1).timeSource).toBe("machine_utc");
  });

  it("timestamp KHÔNG parse được → BAD_REQUEST kể cả khi cờ TẮT (không để payload độc kẹt WAL retry vĩnh viễn)", async () => {
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());
    await expect(
      caller.submitInspection(payload({ inspectionTime: "hôm qua" })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.createProductInspection).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("CASE #12 — version pinning (QĐ#2 seam)", () => {
  const PRODUCT = { id: 70, code: "PM-1", name: "Product 1", pointsConfigVersion: 9 };

  beforeEach(() => {
    (db.getProductModelByCode as ReturnType<typeof vi.fn>).mockResolvedValue(PRODUCT);
  });

  it("★ máy khai version → đóng dấu NGUYÊN VĂN vào row (kể cả khi đã cũ — đây là LỜI KHAI, không phải phán quyết)", async () => {
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());

    await caller.submitInspection(payload({ productModel: "PM-1", pointsConfigVersion: 4 }));

    expect(persisted(0).pointsConfigVersion).toBe(4); // KHÔNG bị thay bằng 9 (live)
  });

  it("★ máy khai version CŨ hơn → TAG 'stale' + VẪN NHẬN (QĐ#3: không từ chối cứng)", async () => {
    const fake = installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());

    const res = await caller.submitInspection(payload({ productModel: "PM-1", pointsConfigVersion: 4 }));

    expect(res.success).toBe(true);
    expect(fake.realInserts).toBe(1); // board KHÔNG bị chặn
    expect(persisted(0).configVersionStatus).toBe("stale");
  });

  it("máy khai ĐÚNG version live → 'current'", async () => {
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());
    await caller.submitInspection(payload({ productModel: "PM-1", pointsConfigVersion: 9 }));
    expect(persisted(0).configVersionStatus).toBe("current");
  });

  it("máy khai version MỚI hơn server → 'ahead' (rollback cấu hình / máy nói dối — phải nhìn thấy)", async () => {
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());
    await caller.submitInspection(payload({ productModel: "PM-1", pointsConfigVersion: 12 }));
    expect(persisted(0).configVersionStatus).toBe("ahead");
  });

  it("máy KHÔNG khai version → 'unknown' + cột version NULL (không bịa version live vào row)", async () => {
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());
    await caller.submitInspection(payload({ productModel: "PM-1" }));
    expect(persisted(0).pointsConfigVersion).toBeUndefined();
    expect(persisted(0).configVersionStatus).toBe("unknown");
  });

  it("khai version nhưng KHÔNG resolve được product model → 'unknown', vẫn giữ lời khai", async () => {
    (db.getProductModelByCode as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());
    await caller.submitInspection(payload({ productModel: "PM-GHOST", pointsConfigVersion: 4 }));
    expect(persisted(0).pointsConfigVersion).toBe(4);
    expect(persisted(0).configVersionStatus).toBe("unknown");
  });
});
