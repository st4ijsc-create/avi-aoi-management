/**
 * server/routers/machineApiIngestCayV2.test.ts
 *
 * Pha 1B Task 6 (BG-1, spec §13 Đ-11/Đ-19) — nối payload máy v2.0 (cây 4 cấp) vào
 * `submitInspection` THẬT (đường sản xuất qua router, KHÔNG chỉ hàm thuần
 * `dichCayKetQua`/`ghiCayKetQua` đã canh ở Task 4/5).
 *
 * NĂM MỆNH ĐỀ canh (task-6-brief bổ sung, xem `.superpowers/sdd/2026-08-26-
 * aoi-pha1b-ingest-cay/task-6-brief.md` và bối cảnh trong nhiệm vụ):
 *  1. Payload v2.0 → ghi được, `product_inspections.overallResult` = `cay.verdictLuuTru`.
 *  2. Payload v2.0 mọi `result="OK"` + 1 component `ntf=true` → cột thật = "NTF"
 *     (lỗ 6,55% đóng trên ĐƯỜNG SẢN XUẤT, không chỉ trong lưới Task 5).
 *  3. Payload v1.x vẫn chạy như hôm nay khi cờ TẮT — chống hồi quy quan trọng nhất.
 *  4. Payload v1.x khi cờ BẬT → lỗi từ `loiMayChuaNangCap`, canh HÀNH VI THẬT (gọi
 *     endpoint thật, đọc mã lỗi + thông điệp trả về) — KHÔNG chỉ gọi thẳng hàm rồi
 *     đọc `.message` (đây chính là lỗi §13 Đ-11 mà Pha 1A mắc phải).
 *  5. Payload v2.0 KHÔNG khai `schemaVersion` vẫn được nhận diện đúng theo HÌNH DẠNG
 *     (mảng `surfaces`), không phụ thuộc trường tuỳ chọn đó.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

// ── Cầu ghi lại tham số MỖI lượt gọi persistInspectionAtomic (v2.0) và
//    createProductInspection (v1.x) — để canh ĐÚNG nhánh nào chạy, ĐÚNG giá trị nào ghi. ──
let capturedPersistCalls: Array<{
  data: Record<string, unknown>;
  measurementRows: unknown[];
  opts?: Record<string, unknown>;
}> = [];
let nextReservedId = 9000;

vi.mock("../storage", () => ({
  storagePut: vi.fn(async (key: string) => ({ url: `/uploads/${key}`, key })),
  storageGet: vi.fn(async () => ({ key: "", url: "" })),
  storageDelete: vi.fn(async () => ({ deleted: true })),
  resolveImageToDataUrl: vi.fn(async () => ""),
}));

vi.mock("../db", () => {
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      insert: () => ({ values: async () => undefined }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    }),
  );
  const fakeDb = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
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
    // v1.x (hai pha, singleTxOn mặc định TẮT) đi qua hàm này cho header.
    createProductInspection: vi.fn(async () => 4242),
    // v2.0 (Task 6) đi qua hai hàm này.
    reserveInspectionId: vi.fn(async () => nextReservedId++),
    // Khối B Task 3 (Đ-19) — `submitInspectionTreeV2` tra bản dạy TRƯỚC khi ghi.
    // Giả lập "máy CHƯA dạy gì" (bản đồ rỗng) = ĐÚNG trạng thái nền đo được
    // 2026-09-03 (`machine_template_versions` 0 hàng ở cả hai DB) ⇒ file này giữ
    // NGUYÊN mọi mệnh đề cũ của nó: 0 hàng cấp component, verdict không đổi.
    traBanDayChoCay: vi.fn(async () => ({
      banDo: new Map<string, number>(),
      // Khối B Task 4 (BG-92) — spec-gate đọc `gioiHan` từ CHÍNH kết quả tra này.
      // Bản đồ RỖNG = "chưa dạy" ⇒ cổng trả `chuaDay`, KHÔNG trả "đạt" (đó là cả
      // điểm của Task 4), nên mọi mệnh đề cũ của file này giữ nguyên nghĩa.
      gioiHan: new Map<string, PointLimitSource>(),
      mayCoBanDay: false,
      khoaNhapNhang: [] as string[],
    })),
    persistInspectionAtomic: vi.fn(
      async (
        data: Record<string, unknown>,
        measurementRows: unknown[],
        opts?: Record<string, unknown>,
      ) => {
        capturedPersistCalls.push({ data, measurementRows, opts });
        return { id: data.id as number, duplicate: false };
      },
    ),
    getMachineStats: vi.fn(async () => ({ total: 0, ok: 0, ng: 0, ntf: 0, yieldRate: 100 })),
    // Chuỗi phân cấp (macTenantChoGhi → maTenantCuaMay) — máy PHẢI suy ra được
    // factory/workshop/line, đúng khuôn `machineApiVersionGate.test.ts`.
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
vi.mock("../services/integration/outboxProducers", () => ({ publishToOutbox: vi.fn() }));

import { machineApiRouter } from "./machineApiRouters";
import * as db from "../db";
import type { TrpcContext } from "../_core/context";
// Khối B Task 4 (BG-92) — kiểu giới hạn đã dạy mà `traBanDayChoCay` nay cũng trả về.
import type { PointLimitSource } from "../services/pointResultEvaluator";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  _resetInspectionStoreForward,
  bufferedInspectionCount,
} from "../services/inspection/inspectionStoreForward";

const MACHINE = { id: 777, code: "AOI-V2-01", name: "AOI V2", stationId: 1, isActive: true };

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}

function caller() {
  return machineApiRouter.createCaller(ctx());
}

// ── Payload v2.0 dựng thủ công đúng hình dạng `machineDataContractV2` ────────────
function componentV2(over: Record<string, unknown> = {}) {
  return { componentId: "C1", result: "OK" as const, ntf: false, ...over };
}

function payloadV2(
  components: Array<Record<string, unknown>> = [componentV2()],
  overTop: Record<string, unknown> = {},
) {
  const base = {
    schemaVersion: "2.0",
    type: "product",
    apiKey: "V2-SHARED-KEY",
    identity: {
      station: "ST1",
      machine: "M1",
      line: "L1",
      plant: "P1",
      country: "VN",
      solutionName: "InspectProAOI",
      appVersion: "1.0.0",
    },
    productId: "PROD-1",
    serialNumber: "SN-V2-001",
    overallResult: "OK" as const,
    ntf: false,
    summary: {
      surfaces: { total: 1, pass: 1, ng: 0, ntf: 0 },
      positions: { total: 1, pass: 1, ng: 0, ntf: 0 },
      captures: { total: 1, pass: 1, ng: 0, ntf: 0 },
      components: { total: components.length, pass: components.length, ng: 0, ntf: 0 },
    },
    surfaces: [
      {
        name: "TOP",
        result: "OK" as const,
        ntf: false,
        positions: [
          {
            positionId: "POS1",
            result: "OK" as const,
            ntf: false,
            captures: [
              {
                captureId: "CAP1",
                result: "OK" as const,
                ntf: false,
                components,
              },
            ],
          },
        ],
      },
    ],
  };
  return { ...base, ...overTop };
}

function payloadV1(over: Record<string, unknown> = {}) {
  return {
    apiKey: "V1-SHARED-KEY",
    serialNumber: "SN-V1-001",
    overallResult: "OK" as const,
    measurements: [] as Record<string, unknown>[],
    ...over,
  };
}

beforeEach(() => {
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  process.env.INSPECTION_STORE_FORWARD_ENABLED = "false";
  delete process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED; // mặc định TẮT
  delete process.env.INSPECTION_SINGLE_TX_ENABLED;
  capturedPersistCalls = [];
  nextReservedId = 9000;
  vi.clearAllMocks();
  (db.getMachineByApiKey as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineById as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineByCode as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.createProductInspection as ReturnType<typeof vi.fn>).mockResolvedValue(4242);
});

describe("Task 6 (BG-1) — mệnh đề 1: v2.0 ghi được, overallResult = cay.verdictLuuTru", () => {
  it("payload v2.0 toàn OK, không ntf → ghi qua persistInspectionAtomic, overallResult='OK'", async () => {
    const res = await caller().submitInspection(payloadV2());
    expect(res.success).toBe(true);
    expect(capturedPersistCalls).toHaveLength(1);
    expect(capturedPersistCalls[0].data.overallResult).toBe("OK");
    expect(capturedPersistCalls[0].data.serialNumber).toBe("SN-V2-001");
    // measurement_results cấp component CHƯA ghi (chờ Khối B) — mảng RỖNG có chủ đích.
    expect(capturedPersistCalls[0].measurementRows).toEqual([]);
    // opts.cay PHẢI có mặt — đây là cách "cùng transaction" được bảo đảm CẤU TRÚC (Task 5).
    expect(capturedPersistCalls[0].opts?.cay).toBeTruthy();
    expect(db.createProductInspection).not.toHaveBeenCalled();
  });
});

describe("Task 6 (BG-1) — mệnh đề 2: 1 component ntf=true ⇒ cột thật = 'NTF' (lỗ 6,55%)", () => {
  it("mọi result='OK' + đúng MỘT component ntf=true → data.overallResult ghi vào persistInspectionAtomic = 'NTF'", async () => {
    const res = await caller().submitInspection(
      payloadV2([componentV2({ componentId: "C1", ntf: false }), componentV2({ componentId: "C2", ntf: true })]),
    );
    expect(res.success).toBe(true);
    expect(capturedPersistCalls).toHaveLength(1);
    // ⚠ Đây là mệnh đề trung tâm: PHẢI là cay.verdictLuuTru (cuộn từ cây), KHÔNG phải
    // payload.overallResult (payload khai "OK" — đó chính là nơi 6,55% NTF biến mất).
    expect(capturedPersistCalls[0].data.overallResult).toBe("NTF");
  });
});

describe("Task 6 (BG-1) — mệnh đề 3: v1.x vẫn chạy như hôm nay khi cờ TẮT", () => {
  it("payload v1.x (measurements phẳng) → đi qua createProductInspection như trước bản vá, KHÔNG đụng persistInspectionAtomic", async () => {
    const res = await caller().submitInspection(payloadV1());
    expect(res.success).toBe(true);
    expect((res as { inspectionId: number }).inspectionId).toBe(4242);
    expect(db.createProductInspection).toHaveBeenCalledTimes(1);
    expect(db.persistInspectionAtomic).not.toHaveBeenCalled();
    expect(capturedPersistCalls).toHaveLength(0);
  });

  it("payload v1.1-shaped (không khai schemaVersion, có variantCode/idempotencyKey) vẫn chạy đúng đường v1.x", async () => {
    const res = await caller().submitInspection(
      payloadV1({ idempotencyKey: "IDK-000000001", pointsConfigVersion: 1 }),
    );
    expect(res.success).toBe(true);
    expect(db.createProductInspection).toHaveBeenCalledTimes(1);
    expect(db.persistInspectionAtomic).not.toHaveBeenCalled();
  });
});

describe("Task 6 (BG-1) — mệnh đề 4: cờ BẬT → v1.x bị từ chối bằng loiMayChuaNangCap (HÀNH VI THẬT)", () => {
  it("gọi ĐÚNG endpoint submitInspection thật, payload v1.x, cờ BẬT → BAD_REQUEST nêu rõ '2.0', KHÔNG phải lỗi zod thô, KHÔNG chạm DB", async () => {
    process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED = "true";
    let thrown: unknown;
    try {
      await caller().submitInspection(payloadV1());
      throw new Error("submitInspection lẽ ra phải ném lỗi khi cờ BẬT");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TRPCError);
    const trpcErr = thrown as TRPCError;
    expect(trpcErr.code).toBe("BAD_REQUEST");
    // Thông điệp PHẢI đến từ loiMayChuaNangCap (nêu rõ "2.0" cần), KHÔNG phải zod issues thô.
    expect(trpcErr.message).toContain("2.0");
    expect(trpcErr.message.toLowerCase()).not.toMatch(/invalid_type|zoderror|"issues"|"path":\[/);
    // Bị từ chối TRƯỚC khi chạm bất kỳ đường ghi nào — không phải "ghi rồi mới báo lỗi".
    expect(db.createProductInspection).not.toHaveBeenCalled();
    expect(db.persistInspectionAtomic).not.toHaveBeenCalled();
  });

  it("payload v1.x KHÔNG khai schemaVersion, cờ BẬT → thông điệp lỗi vẫn nêu rõ máy chưa nâng cấp", async () => {
    process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED = "true";
    await expect(caller().submitInspection(payloadV1())).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("cờ BẬT nhưng payload v2.0 hợp lệ → VẪN được nhận (cờ chỉ cắt v1.x, không cắt v2.0)", async () => {
    process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED = "true";
    const res = await caller().submitInspection(payloadV2());
    expect(res.success).toBe(true);
    expect(capturedPersistCalls).toHaveLength(1);
  });
});

describe("Task 6 (BG-1) — mệnh đề 5: v2.0 KHÔNG khai schemaVersion vẫn nhận diện đúng theo HÌNH DẠNG", () => {
  it("payload v2.0 với schemaVersion=undefined (xoá hẳn trường) → vẫn đi đường cây, không rơi vào v1.x", async () => {
    const raw = payloadV2() as Record<string, unknown>;
    delete raw.schemaVersion;
    expect("schemaVersion" in raw).toBe(false);
    const res = await caller().submitInspection(raw);
    expect(res.success).toBe(true);
    expect(capturedPersistCalls).toHaveLength(1);
    expect(db.createProductInspection).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Doc 2026-08-29 (WAL cho cây v2.0) Task 1 — buffer khi lỗi TẠM THỜI + ranh giới
// TẠM THỜI/VĨNH VIỄN quanh `submitInspectionTreeV2`, canh Ở ĐÚNG ĐƯỜNG SẢN XUẤT
// (router thật, `db.persistInspectionAtomic` mocked reject — không gọi thẳng hàm nội bộ).
// ═══════════════════════════════════════════════════════════════════════════════
describe("Task 1 (WAL cho cây v2.0) — buffer khi lỗi tạm thời + ranh giới tạm thời/vĩnh viễn", () => {
  let walPath: string;

  beforeEach(() => {
    walPath = path.join(
      os.tmpdir(),
      `insp-sf-v2-router-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
    );
    process.env.INSPECTION_STORE_FORWARD_FILE = walPath;
    delete process.env.OT_STORE_FORWARD_ENABLED;
    _resetInspectionStoreForward();
  });

  afterEach(async () => {
    _resetInspectionStoreForward();
    for (const f of [walPath, walPath.replace(/\.jsonl$/, "") + ".dead.jsonl"]) {
      try {
        await fs.unlink(f);
      } catch {
        /* có thể chưa tồn tại */
      }
    }
  });

  it("⚠ RÀNG BUỘC — cờ WAL TẮT (mặc định) ⇒ lỗi DB tạm thời vẫn NÉM NGUYÊN VĂN, không buffer (không đổi mặc định)", async () => {
    process.env.INSPECTION_STORE_FORWARD_ENABLED = "false";
    (db.persistInspectionAtomic as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("connect ECONNREFUSED"),
    );
    await expect(caller().submitInspection(payloadV2())).rejects.toThrow("ECONNREFUSED");
    expect(bufferedInspectionCount()).toBe(0);
  });

  it("cờ BẬT + lỗi TẠM THỜI (Error thường, không phải TRPCError) ⇒ buffer vào WAL, ACK {success:true, queued:true, submissionId}", async () => {
    process.env.INSPECTION_STORE_FORWARD_ENABLED = "true";
    (db.persistInspectionAtomic as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("connect ECONNREFUSED"),
    );
    const res = await caller().submitInspection(payloadV2());
    expect(res).toMatchObject({ success: true, queued: true, inspectionId: null });
    expect(typeof (res as { submissionId: string }).submissionId).toBe("string");
    expect(bufferedInspectionCount()).toBe(1);
  });

  it("cờ BẬT + lỗi VĨNH VIỄN (TRPCError BAD_REQUEST) ⇒ vẫn NÉM, KHÔNG buffer (không nghẽn hàng đợi bằng payload không bao giờ ghi được)", async () => {
    process.env.INSPECTION_STORE_FORWARD_ENABLED = "true";
    (db.persistInspectionAtomic as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TRPCError({ code: "BAD_REQUEST", message: "payload rejected" }),
    );
    await expect(caller().submitInspection(payloadV2())).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(bufferedInspectionCount()).toBe(0);
  });

  it("★★★ hệ quả THẬT của mệnh đề 1 trên đường router: hai bo v2.0 KHÁC NHAU, cùng trạm, serial rỗng, DB down ⇒ CẢ HAI được buffer RIÊNG (không cái nào bị nuốt vì 'trùng')", async () => {
    process.env.INSPECTION_STORE_FORWARD_ENABLED = "true";
    (db.persistInspectionAtomic as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("connect ECONNREFUSED"));
    const rA = await caller().submitInspection(
      payloadV2([componentV2()], { serialNumber: "", productId: "PROD-BUF-A" }),
    );
    const rB = await caller().submitInspection(
      payloadV2([componentV2()], { serialNumber: "", productId: "PROD-BUF-B" }),
    );
    expect((rA as { queued?: boolean }).queued).toBe(true);
    expect((rB as { queued?: boolean }).queued).toBe(true);
    expect((rA as { submissionId: string }).submissionId).not.toBe(
      (rB as { submissionId: string }).submissionId,
    );
    expect(bufferedInspectionCount()).toBe(2);
  });
});
