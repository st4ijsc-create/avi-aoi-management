/**
 * Giai đoạn 4 — Versioned Machine Data Contract (G15 chuẩn hoá)
 *
 * Hợp đồng dữ liệu giữa máy AVI/AOI ↔ server, tách khỏi router để:
 *  - Khoá schema theo phiên bản (back-compat khi máy nâng cấp dần).
 *  - Sinh JSON-Schema cho đối tác tích hợp ngoài (zod v4 `z.toJSONSchema`).
 *
 * Additive — không thay đổi hành vi `submitInspection`. Router/đối tác có thể
 * dùng `validateMachinePayload` để kiểm tra trước khi gửi.
 */
import { z } from "zod";
import { machineDataContractV2 } from "./machineDataContractV2";

// ── v1: phản ánh hợp đồng submitInspection hiện hành (tập ổn định) ──────────
const measurementV1 = z.object({
  pointId: z.string().optional(),
  pointCode: z.string().optional(),
  measuredValue: z.union([z.number(), z.string()]).optional(),
  result: z.enum(["OK", "NG", "NTF"]),
  remark: z.string().optional(),
  defectCatalogCode: z.string().max(50).optional(),
  defectSeverity: z.enum(["critical", "major", "minor", "cosmetic"]).optional(),
});

export const machineDataContractV1 = z.object({
  schemaVersion: z.literal("1.0").default("1.0"),
  // Định danh máy (một trong hai)
  machineCode: z.string().optional(),
  apiKey: z.string().optional(),
  // Sản phẩm
  serialNumber: z.string().min(1),
  productModel: z.string().optional(),
  batchNumber: z.string().optional(),
  // Kết quả
  overallResult: z.enum(["OK", "NG", "NTF"]),
  cycleTime: z.number().nonnegative().optional(),
  inspectionTime: z.string().optional(),
  // Phân cấp doanh nghiệp
  companyCode: z.string().optional(),
  factoryCode: z.string().optional(),
  workshopCode: z.string().optional(),
  lineCode: z.string().optional(),
  stageCode: z.string().optional(),
  // Bối cảnh sản xuất
  productionOrderCode: z.string().optional(),
  operatorId: z.string().optional(),
  measurements: z.array(measurementV1),
}).refine((d) => Boolean(d.apiKey || d.machineCode), {
  message: "Either apiKey or machineCode must be provided",
});

// ── v1.1: khớp CHÍNH XÁC submitInspection thật (doc 56 API-2 — sửa drift) ────
// v1.0 ở trên được viết tay và LỆCH ~10 field so với `submitInspectionCoreObject`
// (server/routers/machineApiRouters.ts): thiếu variantCode, idempotencyKey,
// pointsConfigVersion, panelId/boardIndex, unit/unitScaleToCanonical + toàn bộ
// nhóm value* của measurement, và serialNumber không bị chặn max(100). v1.1 phản
// ánh ĐÚNG hợp đồng máy đang gửi (BỎ các field server-stamp serverReceivedAt/
// timeSource — chúng KHÔNG thuộc hợp đồng máy). Giữ 1.0 cho back-compat.
const measurementV11 = z.object({
  pointId: z.string().optional(),
  pointCode: z.string().optional(),
  measuredValue: z.union([z.number(), z.string()]).optional(),
  // Đơn vị máy đo + hệ số quy đổi tuỳ chọn (doc 51 P2 / CASE #11).
  unit: z.string().trim().max(20).optional(),
  unitScaleToCanonical: z.union([z.number(), z.string()]).optional(),
  result: z.enum(["OK", "NG", "NTF"]),
  remark: z.string().optional(),
  imageBase64: z.string().optional(),
  // Nhóm giá trị đo mở rộng (SPI/AOI 3D…).
  valueZ: z.union([z.number(), z.string()]).optional(),
  valueHeight: z.union([z.number(), z.string()]).optional(),
  valueArea: z.union([z.number(), z.string()]).optional(),
  valueVolume: z.union([z.number(), z.string()]).optional(),
  valueVoidPct: z.union([z.number(), z.string()]).optional(),
  valueCoplanarity: z.union([z.number(), z.string()]).optional(),
  valueWarpage: z.union([z.number(), z.string()]).optional(),
  valueOffsetX: z.union([z.number(), z.string()]).optional(),
  valueOffsetY: z.union([z.number(), z.string()]).optional(),
  valueTilt: z.union([z.number(), z.string()]).optional(),
  valueThickness: z.union([z.number(), z.string()]).optional(),
  defectCatalogCode: z.string().max(50).optional(),
  defectSeverity: z.enum(["critical", "major", "minor", "cosmetic"]).optional(),
});

export const machineDataContractV11 = z.object({
  schemaVersion: z.literal("1.1").default("1.1"),
  // Định danh máy (một trong hai)
  machineCode: z.string().optional(),
  apiKey: z.string().optional(),
  // Sản phẩm
  serialNumber: z.string().trim().min(1).max(100),
  productModel: z.string().optional(),
  variantCode: z.string().trim().min(1).max(50).optional(),
  batchNumber: z.string().optional(),
  // Kết quả
  cycleTime: z.number().optional(),
  overallResult: z.enum(["OK", "NG", "NTF"]),
  inspectionTime: z.string().optional(),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
  pointsConfigVersion: z.number().int().nonnegative().optional(),
  // Phân cấp doanh nghiệp
  companyCode: z.string().optional(),
  factoryCode: z.string().optional(),
  workshopCode: z.string().optional(),
  lineCode: z.string().optional(),
  stageCode: z.string().optional(),
  // Bối cảnh sản xuất
  productionOrderCode: z.string().optional(),
  operatorId: z.string().optional(),
  // Panel multi-up (W8-B)
  panelId: z.string().max(100).optional(),
  boardIndex: z.number().int().min(1).optional(),
  measurements: z.array(measurementV11),
}).refine((d) => Boolean(d.apiKey || d.machineCode), {
  message: "Either apiKey or machineCode must be provided",
});

// ── Registry phiên bản ──────────────────────────────────────────────────────
// v2.0 (Pha 1A Task 4) — payload cây 4 cấp surface→position→capture→component
// (`machineDataContractV2.ts`), thay hình dạng PHẲNG `measurements: []` của
// v1.0/v1.1. v1.0/v1.1 GIỮ LẠI trong map để TRA CỨU/SO SÁNH — registry còn
// nhận diện được các phiên bản cũ theo tên. ★ TRẠNG THÁI THẬT hôm nay:
// `validateMachinePayload("1.1", <payload hợp lệ>)` vẫn trả `{ok:true}` —
// v1.1 VẪN ĐƯỢC NHẬN qua hàm này, KHÔNG bị chặn. Việc "từ chối v1.x" là thông
// điệp đã viết sẵn (`loiMayChuaNangCap` bên dưới) NHƯNG CHƯA CÓ NƠI GỌI trong
// mã sản xuất (0 call site) — Pha 1A chỉ định nghĩa hợp đồng, chưa nối vào
// đường quyết định nào. Pha 1B (nối đường ingest) sẽ là nơi việc từ chối THẬT
// SỰ xảy ra.
export const MACHINE_CONTRACT_VERSIONS = {
  "1.0": machineDataContractV1,
  "1.1": machineDataContractV11,
  "2.0": machineDataContractV2,
} as const;

export type MachineContractVersion = keyof typeof MACHINE_CONTRACT_VERSIONS;

export const LATEST_MACHINE_CONTRACT_VERSION: MachineContractVersion = "2.0";

/**
 * Thông điệp từ chối máy gửi payload phiên bản CŨ — NÊU RÕ phiên bản đang gửi
 * và phiên bản cần, thay vì để zod ném một đống lỗi trường mà kỹ sư hiện
 * trường không đọc nổi.
 *
 * ★ CHƯA CÓ NƠI GỌI trong mã sản xuất (0 call site) — hàm này mới chỉ là
 * thông điệp được VIẾT SẴN. Giữ v1.0/v1.1 trong `MACHINE_CONTRACT_VERSIONS`
 * là để registry còn TRA CỨU/SO SÁNH được, không phải bằng chứng chúng đã bị
 * từ chối ở đâu đó. Pha 1B sẽ nối hàm này vào đường ingest thật để việc từ
 * chối v1.x THẬT SỰ xảy ra, không chỉ được mô tả.
 */
export function loiMayChuaNangCap(schemaVersion: string): Error {
  return new Error(
    `Máy đang gửi hợp đồng phiên bản "${schemaVersion}". Server chỉ nhận từ "2.0" trở lên ` +
    `(payload cây 4 cấp surface→position→capture→component). Nâng phần mềm máy trước khi gửi.`,
  );
}

export function listMachineContractVersions(): MachineContractVersion[] {
  return Object.keys(MACHINE_CONTRACT_VERSIONS) as MachineContractVersion[];
}

export function getMachineContract(version: string): z.ZodTypeAny | null {
  return (MACHINE_CONTRACT_VERSIONS as Record<string, z.ZodTypeAny>)[version] ?? null;
}

export interface ValidateResult {
  ok: boolean;
  version: string;
  errors?: Array<{ path: string; message: string }>;
}

/** Kiểm tra payload theo phiên bản hợp đồng. Không ném lỗi — trả kết quả có cấu trúc. */
export function validateMachinePayload(version: string, payload: unknown): ValidateResult {
  const schema = getMachineContract(version);
  if (!schema) {
    return { ok: false, version, errors: [{ path: "", message: `Unknown contract version: ${version}` }] };
  }
  const r = schema.safeParse(payload);
  if (r.success) return { ok: true, version };
  return {
    ok: false,
    version,
    errors: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}

/** Sinh JSON-Schema cho đối tác tích hợp ngoài (zod v4). */
export function machineContractJsonSchema(version: string): unknown | null {
  const schema = getMachineContract(version);
  if (!schema) return null;
  return z.toJSONSchema(schema, { target: "draft-7" });
}

/**
 * Nhận diện phiên bản THEO HÌNH DẠNG payload, KHÔNG theo trường `schemaVersion` khai báo —
 * trường đó là optional (log-only), máy CÓ THỂ không gửi. Hình dạng ổn định hơn: v2.0 LUÔN
 * mang mảng `surfaces` (bắt buộc theo `machineDataContractV2`); v1.0/v1.1 LUÔN mang mảng
 * `measurements` (bắt buộc theo hợp đồng máy phẳng).
 *
 * ★★★ MỘT BẢN DUY NHẤT, DÙNG CHUNG — chuyển từ `machineApiRouters.ts` sang đây (Pha 1B Task 7
 * phần 2, quyết định chủ dự án 2026-08-28). Trước đó vị từ này SỐNG PRIVATE trong ingest thật
 * (`submitInspectionRouterInputSchema`) và KHÔNG có bản nào khác — `machineContractRouter.
 * validate()`/`jsonSchema()` mặc định thẳng về `LATEST_MACHINE_CONTRACT_VERSION` bất kể hình
 * dạng payload, khiến `validate({payload})` không khai `version` "nói dối" firmware trên một
 * payload v1.x hợp lệ (báo ĐỎ dù ingest thật NHẬN — GOTCHA đo được, xem `machineContractRouter.
 * test.ts`). Đặt vị từ ở ĐÂY (module hợp đồng dùng chung) rồi cho CẢ HAI phía (ingest thật VÀ
 * validate tự kiểm) cùng gọi — tránh đẻ bản thứ hai trôi khỏi bản gốc (chính là lớp lỗi BG-19).
 */
export function laHinhDangCayV2(raw: unknown): boolean {
  return (
    typeof raw === "object" &&
    raw !== null &&
    Array.isArray((raw as { surfaces?: unknown }).surfaces)
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ST4I Standard Process Feed v1 — hợp đồng RESULT/TELEMETRY chuẩn hoá (doc 56/57).
//
// Envelope máy↔server cho MỌI loại máy (không riêng AVI/AOI): kết quả của MỘT bước
// quy trình/trạm (test, ép, hàn, dán…) — telemetry-of-record, KHÔNG phải lệnh điều
// khiển. Đây là bản CHÍNH THỨC: field names khớp REST /api/v1/ingest/process-result
// và procedure machineApi.submitProcessResult. Đăng ký ở registry RIÊNG (không trộn
// vào MACHINE_CONTRACT_VERSIONS của inspection vì cả hai đều đánh version "1.0").
// ════════════════════════════════════════════════════════════════════════════

/** true khi `s` là ISO-8601 parse được VÀ mang offset UTC tường minh (…Z hoặc ±HH:MM). */
export function isIsoWithExplicitOffset(s: unknown): boolean {
  if (typeof s !== "string" || s.trim() === "") return false;
  const t = s.trim();
  if (Number.isNaN(new Date(t).getTime())) return false;
  // …Z | …±HH:MM | …±HHMM (chỉ ở PHẦN GIỜ, sau chữ 'T')
  return /T[^Z+-]*(?:Z|[+-]\d{2}:?\d{2})$/.test(t);
}

const processMetricV1 = z.object({
  name: z.string().min(1).max(64),
  // RUNTIME chỉ nhận number (submitProcessResultCoreObject.processMetricSchema) — chuỗi/bool → 400.
  // Contract này PHẢI khớp runtime để APIdocs không mời gọi payload bị từ chối (doc 61 §4.8).
  value: z.number(),
  unit: z.string().max(32).optional(),
  lsl: z.number().optional(),
  usl: z.number().optional(),
  nominal: z.number().optional(),
});

const processWaveformV1 = z.object({
  name: z.string().min(1).max(64),
  unit: z.string().max(32).optional(),
  rateHz: z.number().positive().optional(),
  // Chuỗi mẫu [ [t, v], … ] — cặp (thời điểm, giá trị). Cap khớp runtime.
  samples: z.array(z.tuple([z.number(), z.number()])).max(100_000),
});

export const machineProcessResultContractV1 = z.object({
  // RUNTIME: z.string().max(20).optional() — log-only provenance, KHÔNG ép "1.0" (doc 61 §4.8).
  schemaVersion: z.string().max(20).optional(),
  // Định danh máy — transport/API-key cấp; body optional (mirrors inspection).
  machineCode: z.string().optional(),
  apiKey: z.string().optional(),
  // Sản phẩm + bước quy trình
  serialNumber: z.string().trim().min(1).max(128),
  stepType: z.string().trim().min(1).max(64),
  result: z.enum(["pass", "fail", "warn", "skip"]),
  // Dấu thời gian — OPTIONAL (khớp runtime): vắng ⇒ server đóng dấu now()+timeSource='server'.
  // KHI GỬI, PHẢI có offset UTC tường minh (một kết quả process không offset là không truy vết được).
  ts: z
    .string()
    .refine(isIsoWithExplicitOffset, {
      message:
        "ts must be an ISO-8601 timestamp WITH an explicit UTC offset (e.g. 2026-07-17T08:00:00+07:00 or ...Z)",
    })
    .optional(),
  // Công thức/recipe
  recipe: z
    .object({
      code: z.string().min(1).max(128),
      version: z.string().max(64).optional(),
      checksum: z.string().max(128).optional(),
    })
    .optional(),
  // Số đo + dạng sóng (cap khớp runtime)
  metrics: z.array(processMetricV1).max(512).optional(),
  waveforms: z.array(processWaveformV1).max(64).optional(),
  // Idempotency + bối cảnh sản xuất
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
  stationId: z.number().int().positive().optional(),
  lineCode: z.string().max(50).optional(),
  productionOrderCode: z.string().max(80).optional(),
  lotCode: z.string().max(80).optional(),
});

// ── Registry RIÊNG cho process-result ────────────────────────────────────────
export const MACHINE_PROCESS_CONTRACT_VERSIONS = {
  "1.0": machineProcessResultContractV1,
} as const;

export type ProcessContractVersion = keyof typeof MACHINE_PROCESS_CONTRACT_VERSIONS;

export const LATEST_PROCESS_CONTRACT_VERSION: ProcessContractVersion = "1.0";

export function listProcessContractVersions(): ProcessContractVersion[] {
  return Object.keys(MACHINE_PROCESS_CONTRACT_VERSIONS) as ProcessContractVersion[];
}

export function getProcessContract(version: string): z.ZodTypeAny | null {
  return (MACHINE_PROCESS_CONTRACT_VERSIONS as Record<string, z.ZodTypeAny>)[version] ?? null;
}

/** Kiểm tra payload process-result theo phiên bản. Không ném lỗi — trả kết quả có cấu trúc. */
export function validateProcessPayload(version: string, payload: unknown): ValidateResult {
  const schema = getProcessContract(version);
  if (!schema) {
    return { ok: false, version, errors: [{ path: "", message: `Unknown process contract version: ${version}` }] };
  }
  const r = schema.safeParse(payload);
  if (r.success) return { ok: true, version };
  return {
    ok: false,
    version,
    errors: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}

/** Sinh JSON-Schema process-result cho đối tác/firmware (zod v4). */
export function machineProcessContractJsonSchema(version: string): unknown | null {
  const schema = getProcessContract(version);
  if (!schema) return null;
  return z.toJSONSchema(schema, { target: "draft-7" });
}
