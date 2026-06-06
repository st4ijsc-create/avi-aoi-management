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

// ── Registry phiên bản ──────────────────────────────────────────────────────
export const MACHINE_CONTRACT_VERSIONS = {
  "1.0": machineDataContractV1,
} as const;

export type MachineContractVersion = keyof typeof MACHINE_CONTRACT_VERSIONS;

export const LATEST_MACHINE_CONTRACT_VERSION: MachineContractVersion = "1.0";

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
