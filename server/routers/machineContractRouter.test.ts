/**
 * server/routers/machineContractRouter.test.ts
 *
 * Pha 1B Task 7 (BG-3) — `machineContractRouter` chưa có MỘT file test nào trước bản vá này.
 *
 * MỆNH ĐỀ TRUNG TÂM (lý do BG-3 tồn tại): **cái `validate()` khai XANH phải là cái ingest THẬT
 * (`machineApi.submitInspection`) NHẬN — và cái `validate()` khai ĐỎ phải là cái ingest thật từ
 * chối.** `validate` là endpoint firmware gọi để tự kiểm payload TRƯỚC khi gửi thật; nếu hai
 * đường lệch nhau, kỹ sư hiện trường có một giấy chứng nhận xanh và một lượt gửi hỏng (hoặc
 * ngược lại — hoảng vô cớ với payload thật ra vẫn được nhận). Trước bản vá này KHÔNG lưới nào
 * phát biểu mối quan hệ đó.
 *
 * ⚠ Lưới bên dưới gọi CẢ HAI thủ tục THẬT — `machineContractRouter.validate` VÀ
 * `machineApiRouter.submitInspection` (DB/dịch vụ ngoài bị mock; mocking recipe mượn nguyên văn
 * từ `machineApiIngestCayV2.test.ts`, nơi đã canh `submitInspection` THẬT chạy đúng qua router)
 * — trên CÙNG một payload, rồi SO SÁNH TRỰC TIẾP `validateResult.ok` với kết quả ingest thật
 * (`ingestChapNhan`). KHÔNG so với một hằng số viết tay: nếu `validate` bị đổi để luôn trả
 * `ok:true` (đột biến canh ở cuối), các ca "payload hỏng" bên dưới ĐỎ vì `validateResult.ok`
 * (mutated → true) lệch với `ingestChapNhan` (vẫn `false`, vì `submitInspection` không bị đụng).
 *
 * Bốn điểm dùng `LATEST_MACHINE_CONTRACT_VERSION` trong router (`versions`, `jsonSchema`,
 * `validate` mặc định version — cho CẢ hai contract) đều được canh.
 *
 * ── Task 7 phần 2 (2026-08-28, quyết định chủ dự án) — GOTCHA ban đầu đã được ĐÓNG, không chỉ
 * NÓI RA ────────────────────────────────────────────────────────────────────────────────────
 * Lượt đo ĐẦU (Task 7 phần 1) phát hiện: `validate({payload})` KHÔNG khai `version` LUÔN mặc
 * định về `LATEST_MACHINE_CONTRACT_VERSION` ("2.0", cây) bất kể hình dạng payload ⇒ một payload
 * v1.x hợp lệ (mảng `measurements[]`) tự kiểm không khai version bị đo NHẦM bằng cây v2.0, báo ĐỎ
 * dù ingest thật NHẬN — `validate` "nói dối" firmware, đúng lớp lỗi BG-3 sinh ra để đóng. Ban đầu
 * lưới này chỉ NÓI RA khác biệt (cùng nguyên tắc `hopDongVsIngest.test.ts`) và để ngoài phạm vi
 * sửa. Chủ dự án phán KHÔNG hoãn: xuất xưởng GOTCHA đó trong chính pha có nhiệm vụ đóng BG-3 là
 * tự mâu thuẫn. `machineContractRouter.ts` nay suy phiên bản MẶC ĐỊNH (khi KHÔNG khai `version`)
 * THEO HÌNH DẠNG payload — DÙNG CHUNG vị từ `laHinhDangCayV2` mà ingest thật dùng (chuyển từ
 * `machineApiRouters.ts` sang `contracts/machineDataContract.ts`, MỘT bản, tránh trôi — BG-19).
 * Khai `version` tường minh VẪN LUÔN THẮNG hình dạng (đường thoát kiểm chéo có chủ đích).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock recipe mượn nguyên văn từ machineApiIngestCayV2.test.ts — cần để gọi
//    machineApiRouter.submitInspection THẬT (ingest) mà không chạm DB/dịch vụ ngoài. ──
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
    // auditMutationMiddleware (server/_core/trpc.ts, mọi mutation kể cả `validate`) fire-and-forget
    // gọi logCrudOperation → db.createAuditLog. Không mock ⇒ log lỗi ồn ào (vô hại, đã .catch()),
    // mock để output test sạch.
    createAuditLog: vi.fn(async () => ({ id: 1 })),
    getMachineByApiKey: vi.fn(),
    getMachineByCode: vi.fn(),
    getMachineById: vi.fn(),
    updateMachineHeartbeat: vi.fn(async () => undefined),
    getProductModelByCode: vi.fn(async () => undefined),
    getProductionOrderByCode: vi.fn(async () => undefined),
    updateProductionOrderQuantities: vi.fn(async () => undefined),
    // v1.x đi qua hàm này cho header.
    createProductInspection: vi.fn(async () => 4242),
    // v2.0 đi qua hai hàm này.
    reserveInspectionId: vi.fn(async () => nextReservedId++),
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
import { machineContractRouter } from "./machineContractRouter";
import { LATEST_MACHINE_CONTRACT_VERSION, LATEST_PROCESS_CONTRACT_VERSION } from "../contracts/machineDataContract";
import * as db from "../db";
import type { TrpcContext } from "../_core/context";

const MACHINE = { id: 777, code: "AOI-MC-01", name: "AOI MC", stationId: 1, isActive: true };

function ingestCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}
function ingestCaller() {
  return machineApiRouter.createCaller(ingestCtx());
}

// protectedProcedure: vai "admin" MIỄN TRỪ cổng buộc-đổi-mật-khẩu (shared/buocDoiMatKhau.ts,
// VAI_MIEN_TRU_BUOC_DOI_MAT_KHAU) ⇒ chanKhiPhaiDoiMatKhau KHÔNG chạm DB — không cần mock
// db.phaiDoiMatKhau. TENANT_RLS_ENABLED mặc định TẮT ⇒ tenantScopeMiddleware cũng không chạm DB.
const adminCtx = { user: { id: 1, name: "Admin", role: "admin" }, req: { headers: {} } } as any;
function validateCaller() {
  return machineContractRouter.createCaller(adminCtx);
}

// ── Payload v2.0 dựng đúng hình dạng `machineDataContractV2` (mượn khuôn machineApiIngestCayV2.test.ts) ──
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
      station: "ST1", machine: "M1", line: "L1", plant: "P1", country: "VN",
      solutionName: "InspectProAOI", appVersion: "1.0.0",
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
        name: "TOP", result: "OK" as const, ntf: false,
        positions: [
          {
            positionId: "POS1", result: "OK" as const, ntf: false,
            captures: [{ captureId: "CAP1", result: "OK" as const, ntf: false, components }],
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

/** true nếu ingest THẬT (`submitInspection`) nhận payload (không ném lỗi). */
async function ingestChapNhan(payload: unknown): Promise<boolean> {
  try {
    await ingestCaller().submitInspection(payload);
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  process.env.INSPECTION_STORE_FORWARD_ENABLED = "false";
  // Ràng buộc toàn cục Task 7 — KHÔNG đổi mặc định cờ này: giữ TẮT, đúng hành vi sản xuất hôm nay.
  delete process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED;
  delete process.env.INSPECTION_SINGLE_TX_ENABLED;
  capturedPersistCalls = [];
  nextReservedId = 9000;
  vi.clearAllMocks();
  (db.getMachineByApiKey as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineById as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineByCode as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.createProductInspection as ReturnType<typeof vi.fn>).mockResolvedValue(4242);
});

describe("mệnh đề trung tâm — validate() XANH ⇔ ingest THẬT nhận", () => {
  it("payload cây v2.0 hợp lệ: validate() mặc định (không khai version) VÀ ingest thật ĐỒNG THUẬN nhận", async () => {
    const payload = payloadV2();
    const v = await validateCaller().validate({ payload });
    const accepted = await ingestChapNhan(payload);
    // Suy đúng theo HÌNH DẠNG (mảng surfaces có mặt) — trùng LATEST hôm nay, nhưng suy bằng
    // vị từ hình dạng, KHÔNG phải "luôn luôn LATEST" (khác nhau khi payload là v1.x — xem dưới).
    expect(v.version).toBe(LATEST_MACHINE_CONTRACT_VERSION);
    expect(v.ok).toBe(true);
    expect(accepted).toBe(true);
    // Phát biểu MỐI QUAN HỆ, không chỉ hai khẳng định độc lập — đây là mệnh đề BG-3 canh.
    expect(v.ok).toBe(accepted);
  });

  it("payload cây v2.0 THIẾU productId: validate() VÀ ingest thật ĐỒNG THUẬN từ chối", async () => {
    const payload = payloadV2() as Record<string, unknown>;
    delete payload.productId;
    const v = await validateCaller().validate({ payload });
    const accepted = await ingestChapNhan(payload);
    expect(v.ok).toBe(false);
    expect(accepted).toBe(false);
    expect(v.ok).toBe(accepted);
    expect(db.persistInspectionAtomic).not.toHaveBeenCalled();
  });

  it("payload cây v2.0 với 1 component THIẾU componentId: validate() VÀ ingest thật ĐỒNG THUẬN từ chối", async () => {
    const payload = payloadV2([{ result: "OK", ntf: false } as Record<string, unknown>]);
    const v = await validateCaller().validate({ payload });
    const accepted = await ingestChapNhan(payload);
    expect(v.ok).toBe(false);
    expect(accepted).toBe(false);
    expect(v.ok).toBe(accepted);
  });

  it("payload v1.x phẳng hợp lệ, validate({version:'1.1'}) tường minh VÀ ingest thật ĐỒNG THUẬN nhận", async () => {
    const payload = payloadV1();
    const v = await validateCaller().validate({ payload, version: "1.1" });
    const accepted = await ingestChapNhan(payload);
    expect(v.ok).toBe(true);
    expect(accepted).toBe(true);
    expect(v.ok).toBe(accepted);
    expect(db.createProductInspection).toHaveBeenCalledTimes(1);
  });

  it("payload v1.x THIẾU cả apiKey lẫn machineCode: validate({version:'1.1'}) VÀ ingest thật ĐỒNG THUẬN từ chối", async () => {
    const payload = payloadV1({ apiKey: undefined });
    const v = await validateCaller().validate({ payload, version: "1.1" });
    const accepted = await ingestChapNhan(payload);
    expect(v.ok).toBe(false);
    expect(accepted).toBe(false);
    expect(v.ok).toBe(accepted);
  });
});

describe("Task 7 phần 2 — validate() KHÔNG khai version suy THEO HÌNH DẠNG (GOTCHA đã ĐÓNG, không chỉ nói ra)", () => {
  it("mệnh đề 1 — payload v1.x hợp lệ, validate({payload}) KHÔNG khai version → suy '1.1' theo HÌNH DẠNG (KHÔNG phải LATEST '2.0') → XANH, khớp ingest thật", async () => {
    const payload = payloadV1();
    const v = await validateCaller().validate({ payload }); // KHÔNG khai version
    const accepted = await ingestChapNhan(payload);
    // TRƯỚC bản vá phần 2: version suy ra là LATEST_MACHINE_CONTRACT_VERSION ("2.0") ⇒ v.ok=false
    // (false NEGATIVE). SAU bản vá: suy theo hình dạng (mảng measurements, không có surfaces) ⇒ "1.1".
    expect(v.version).toBe("1.1");
    expect(v.version).not.toBe(LATEST_MACHINE_CONTRACT_VERSION);
    expect(v.ok).toBe(true);
    expect(accepted).toBe(true);
    // Mối quan hệ ĐÚNG bây giờ cho hình dạng v1.x — trước bản vá phần 2, dòng này ĐỎ
    // (v.ok=false, accepted=true) chính là GOTCHA đo được ở Task 7 phần 1.
    expect(v.ok).toBe(accepted);
  });

  it("mệnh đề 2 — payload v2.0 hợp lệ, validate({payload}) KHÔNG khai version → suy LATEST theo HÌNH DẠNG (mảng surfaces) → XANH, khớp ingest thật", async () => {
    const payload = payloadV2();
    const v = await validateCaller().validate({ payload });
    const accepted = await ingestChapNhan(payload);
    expect(v.version).toBe(LATEST_MACHINE_CONTRACT_VERSION);
    expect(v.ok).toBe(true);
    expect(accepted).toBe(true);
    expect(v.ok).toBe(accepted);
  });
});

describe("mệnh đề 3 — khai `version` tường minh LUÔN THẮNG hình dạng (đường thoát kiểm chéo có chủ đích)", () => {
  it("validate({version:'1.1', payload: payload CÂY v2.0}) vẫn đo bằng 1.1 — KHÔNG bị hình dạng ghi đè lên version đã khai", async () => {
    const payload = payloadV2(); // hình dạng CÂY (mảng surfaces) — nếu suy theo hình dạng sẽ ra "2.0"
    const v = await validateCaller().validate({ payload, version: "1.1" });
    expect(v.version).toBe("1.1"); // version khai tường minh thắng, KHÔNG bị suy lại thành "2.0"
    // Payload cây không mang mảng `measurements` (required của schema 1.1) → ok:false, đúng NGHĨA:
    // đây là một payload v2.0 bị đo (có chủ đích) bằng một hợp đồng KHÔNG phải của nó.
    expect(v.ok).toBe(false);
    expect((v.errors ?? []).some((e) => e.path === "measurements")).toBe(true);
  });

  it("validate({version:'2.0', payload: payload PHẲNG v1.x}) vẫn đo bằng 2.0 — KHÔNG bị hình dạng ghi đè lên version đã khai", async () => {
    const payload = payloadV1(); // hình dạng PHẲNG (mảng measurements) — nếu suy theo hình dạng sẽ ra "1.1"
    const v = await validateCaller().validate({ payload, version: "2.0" });
    expect(v.version).toBe("2.0");
    expect(v.ok).toBe(false); // payload phẳng thiếu identity/productId/summary/surfaces (required của 2.0)
  });
});

describe("versions() — bốn điểm dùng LATEST_MACHINE_CONTRACT_VERSION/LATEST_PROCESS_CONTRACT_VERSION, điểm 1/4", () => {
  it("latest + contracts.inspection.latest + contracts['process-result'].latest khớp hằng import trực tiếp từ registry", async () => {
    const r = await validateCaller().versions();
    expect(r.latest).toBe(LATEST_MACHINE_CONTRACT_VERSION);
    expect(r.contracts.inspection.latest).toBe(LATEST_MACHINE_CONTRACT_VERSION);
    expect(r.contracts["process-result"].latest).toBe(LATEST_PROCESS_CONTRACT_VERSION);
    expect(r.versions).toContain(LATEST_MACHINE_CONTRACT_VERSION);
    expect(r.versions).toContain("1.1");
  });
});

describe("jsonSchema() — điểm 2/4, xác nhận theo TỪNG phiên bản đúng shape", () => {
  it("mặc định (không khai version) trả schema LATEST — required chứa surfaces, KHÔNG chứa measurements", async () => {
    const r = await validateCaller().jsonSchema();
    expect(r.found).toBe(true);
    expect(r.version).toBe(LATEST_MACHINE_CONTRACT_VERSION);
    const required = (r.schema as { required?: string[] }).required ?? [];
    expect(required).toContain("surfaces");
    expect(required).not.toContain("measurements");
  });

  it("version:'1.1' tường minh trả schema PHẲNG — required chứa measurements, KHÔNG chứa surfaces", async () => {
    const r = await validateCaller().jsonSchema({ version: "1.1" });
    expect(r.found).toBe(true);
    const required = (r.schema as { required?: string[] }).required ?? [];
    expect(required).toContain("measurements");
    expect(required).not.toContain("surfaces");
  });

  it("phiên bản không tồn tại → found:false, schema:null (không ném lỗi)", async () => {
    const r = await validateCaller().jsonSchema({ version: "9.9" });
    expect(r.found).toBe(false);
    expect(r.schema).toBeNull();
  });
});

describe("validate() — điểm 3-4/4, họ process-result (contract='process-result', LATEST riêng)", () => {
  it("payload tối giản hợp lệ → ok:true, version mặc định = LATEST_PROCESS_CONTRACT_VERSION", async () => {
    const v = await validateCaller().validate({
      contract: "process-result",
      payload: { serialNumber: "SN1", stepType: "test", result: "pass" },
    });
    expect(v.ok).toBe(true);
    expect(v.version).toBe(LATEST_PROCESS_CONTRACT_VERSION);
  });

  it("payload thiếu result → ok:false kèm errors", async () => {
    const v = await validateCaller().validate({
      contract: "process-result",
      payload: { serialNumber: "SN1", stepType: "test" },
    });
    expect(v.ok).toBe(false);
    expect(v.errors?.length ?? 0).toBeGreaterThan(0);
  });
});
