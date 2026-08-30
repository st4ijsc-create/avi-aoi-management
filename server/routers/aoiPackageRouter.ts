/**
 * AOI Package Router - Upload ảnh AOI theo phương thức ZIP Package + Async Upload
 * 
 * Endpoints:
 * - presign: Tạo presigned URL để Agent upload ZIP
 * - commit: Xác nhận upload thành công, parse meta.json
 * - listPackages: Danh sách packages theo bộ lọc
 * - getPackage: Chi tiết một package
 * - getImage: Lấy ảnh từ ZIP (extract + cache + watermark)
 * - getPackageImages: Danh sách ảnh trong package
 * - downloadZip: Tải ZIP gốc cho audit
 * - queueMetrics: Agent gửi metrics hàng đợi upload
 * - getQueueStatus: Xem trạng thái hàng đợi upload theo máy
 */

import { z } from "zod";
import { router, publicProcedure, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { nanoid } from "nanoid";
import { eq, and, desc, gte, lte, sql, like, inArray, count } from "drizzle-orm";
import { getDb } from "../db";
import * as db from "../db";
import { storagePut, storageGet } from "../storage";
import {
  inspectionPackages,
  packageImages,
  uploadQueueMetrics,
  machines,
  productInspections,
  packageActivityLogs,
  measurementResults,
  InsertProductInspection,
  InsertMeasurementResult,
} from "../../drizzle/schema";
import JSZip from "jszip";
import fs from "fs";
import path from "path";
import {
  resolveOrCreateMeasurementPointDefId,
  assertValidPointDefId,
} from "../services/measurementPointResolver";
import type { PointDefCache } from "./_shared";
// W2-A / doc 35 D2 — same server-side spec gate the canonical ingest applies
// (machineApiRouters.processInspectionSubmission). The ZIP commit path does its
// OWN measurement_results inserts and must not store a machine "OK" that its
// point-def limits say is NG.
import { evaluatePointResult, isPointLimitEvalEnabled } from "../services/pointResultEvaluator";
// ★★★ 2026-08-18 — mã tenant của một hàng ĐƯỢC GHI suy từ MÁY ĐÃ XÁC THỰC, không từ `meta.json`;
// khoá lưu trữ gói cũng do máy chủ sinh theo chuỗi phân cấp ấy.
import { macTenantChoGhi, khoaLuuTruGoi } from "./phamViGhiMay";
// ★★★ Task 10 (2026-08-24) — ĐƯỜNG ZIP PACKAGE TỰ PHÂN GIẢI MÁY, BỎ QUA CỔNG
// `authenticateMachine`. Ba chỗ dưới đây (presign/commit/reportQueueMetrics) + PUT
// /api/aoi/upload/:packageId ở server/_core/index.ts gọi thẳng
// `getMachineByCode`/`getMachineByApiKey`, nên cờ `MACHINE_CODE_ONLY_ALLOWED=deny`
// (server/services/machineAuthService.ts) mua được 0 trên toàn đường ZIP: biết mã
// máy — in trên nhãn dán, có trong URL, trong báo cáo — là đủ ghi kết quả
// inspection. Đổi cả ba sang authenticateMachine({ scope: "ingest:write" }), CÙNG
// cổng mọi đường machine khác đang tuân theo. `machineHeaderKey` TÁI DÙNG từ
// machineApiRouters.ts (export có chủ ý) — không chép lại logic đọc header.
import { authenticateMachine } from "../services/machineAuthService";
import { machineHeaderKey } from "./machineApiRouters";
// BG-42 (Pha 1D) — `inferAoiOverallResult` để `explicitResult` thắng VÔ ĐIỀU
// KIỆN trên lời khai máy, ngược hẳn đường v2.0 (đóng bằng `verdictXauHon` ở
// Pha 1C cho Đ-21). DÙNG LẠI hàm chung, KHÔNG chép logic "xấu hơn thắng"
// thành bản thứ ba trong file này.
import { verdictXauHon } from "@shared/rollupVerdict";
// Pha 1D Task 5 (BG-52 ⛔) — phân loại lỗi VĨNH VIỄN/TẠM THỜI cho chốt chặn retry
// vô hạn ở cửa ZIP (commit). DÙNG LẠI nguyên hàm đã có ở đường WAL inspection —
// KHÔNG viết bản thứ hai (đúng chỉ dẫn brief).
import { isPermanentSubmitError } from "../services/inspection/inspectionStoreForward";

// ============================================================
// Image Cache Configuration
// ============================================================
const CACHE_DIR = process.env.AOI_CACHE_DIR
  ? path.resolve(process.env.AOI_CACHE_DIR)
  : path.join(process.cwd(), "uploads", "aoi-cache");

const CACHE_TTL_DAYS = parseInt(process.env.AOI_CACHE_TTL_DAYS || "7");
const PRESIGN_TTL_MINUTES = parseInt(process.env.AOI_PRESIGN_TTL_MINUTES || "15");

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// ============================================================
// Pha 1D Task 5 (BG-52 ⛔) — chốt chặn retry vô hạn ở cửa ZIP
// ============================================================
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Số lần lỗi VĨNH VIỄN LIÊN TIẾP (đếm qua `package_activity_logs.event='commit_fail'`
 * với `metadata.permanent===true` — KHÔNG thêm cột đếm mới vào `inspection_packages`)
 * trước khi một gói ZIP chuyển trạng thái CUỐI `'dead'`. Lỗi TẠM THỜI KHÔNG được
 * đếm vào đây (mệnh đề 4 — chống siết quá: đừng biến DB chớp nháy thành gói chết).
 * Mặc định 5: đủ thấp để không tốn quá nhiều lượt tải-ZIP-thật vô ích trên một
 * gói không bao giờ ghi được, đủ cao để một cú xếp-nhầm-loại hiếm (nếu có) không
 * biến một gói còn cứu được thành 'dead' chỉ sau một lần.
 */
function nguongLoiVinhVienZip(): number {
  return envInt("AOI_PACKAGE_ZIP_MAX_PERMANENT_FAILS", 5);
}

/** Đếm THUẦN (không I/O) — tách riêng để test đơn vị không cần DB thật. */
export function demSoLoiVinhVienTuLichSu(lichSuMetadata: ReadonlyArray<unknown>): number {
  return lichSuMetadata.filter(
    (m) => m !== null && typeof m === "object" && (m as Record<string, unknown>).permanent === true,
  ).length;
}

/**
 * ★★★ BG-65 (Pha 1E Task 2 ⛔) — hàm THUẦN, MỘT nguồn sự thật cho "gói ZIP
 * này đã HỎNG VĨNH VIỄN chưa" ('dead', migration 0344, trạng thái CUỐI). Dùng
 * CHUNG cho CẢ BA cửa của vòng Agent (`presign`/`commit` ở file này, VÀ tuyến
 * PUT `/api/aoi/upload/:packageId` ở `server/_core/index.ts`, gọi qua
 * `await import("../routers/aoiPackageRouter")` — cùng cách file đó đã tự
 * import động mọi service khác). TRƯỚC bản vá BG-65, `upload` tự quyết theo
 * cách RIÊNG (chỉ biết ngắn mạch `'committed'`, không biết `'dead'`) — một bản
 * chép tay thứ hai của "trạng thái nào là CUỐI" lệch khỏi bản gốc, đúng lớp
 * lỗi khiến gói `'dead'` sống lại qua `presign → upload → commit`. Hàm này
 * đóng lỗ đó bằng cách xoá luôn khả năng lệch: chỉ MỘT chỗ định nghĩa "dead
 * nghĩa là gì", ba cửa cùng gọi.
 */
export function laGoiDaChet(status: string | null | undefined): boolean {
  return status === "dead";
}

// ============================================================
// Activity Log Helper - Ghi nhật ký hoạt động gói tin
// ============================================================
type LogEvent = typeof packageActivityLogs.$inferInsert["event"];
type LogLevel = "info" | "warn" | "error";

interface LogOptions {
  packageDbId: number;
  packageId: string;
  machineId?: number | null;
  event: LogEvent;
  level?: LogLevel;
  message: string;
  detail?: string | null;
  source?: "agent" | "server" | "user";
  userId?: number | null;
  userName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  durationMs?: number | null;
  fileSizeBytes?: number | null;
  metadata?: Record<string, any> | null;
}

async function logPackageActivity(opts: LogOptions): Promise<void> {
  try {
    const database = await getDb();
    if (!database) return;
    await database.insert(packageActivityLogs).values({
      packageDbId: opts.packageDbId,
      packageId: opts.packageId,
      machineId: opts.machineId ?? null,
      event: opts.event,
      level: opts.level || "info",
      message: opts.message,
      detail: opts.detail ?? null,
      source: opts.source ?? "server",
      userId: opts.userId ?? null,
      userName: opts.userName ?? null,
      ipAddress: opts.ipAddress ?? null,
      userAgent: opts.userAgent ?? null,
      durationMs: opts.durationMs ?? null,
      fileSizeBytes: opts.fileSizeBytes ?? null,
      metadata: opts.metadata ?? null,
    });
  } catch (err) {
    // Log helper should never break the main flow
    console.error("[AOI-LOG] Failed to write activity log:", err);
  }
}

// ============================================================
// Helper: Apply text watermark to image buffer (using Canvas-free approach)
// ============================================================
async function applyWatermark(
  imageBuffer: Buffer,
  watermarkText: string[],
): Promise<Buffer> {
  // Try to use sharp if available, otherwise return original
  try {
    const sharp = await import("sharp");
    const metadata = await sharp.default(imageBuffer).metadata();
    const width = metadata.width || 800;
    const height = metadata.height || 600;

    // Create SVG watermark overlay
    const fontSize = Math.max(12, Math.floor(width / 40));
    const lineHeight = fontSize + 6;
    const svgLines = watermarkText
      .map(
        (line, i) =>
          `<text x="10" y="${30 + i * lineHeight}" font-size="${fontSize}" fill="rgba(255,255,255,0.6)" font-family="Arial" stroke="rgba(0,0,0,0.3)" stroke-width="0.5">${escapeXml(line)}</text>`
      )
      .join("");

    // Add diagonal CONFIDENTIAL watermark
    const diagFontSize = Math.max(20, Math.floor(width / 15));
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);

    const svgOverlay = `
      <svg width="${width}" height="${height}">
        ${svgLines}
        <text x="${centerX}" y="${centerY}" font-size="${diagFontSize}" fill="rgba(255,255,255,0.15)" 
              font-family="Arial" font-weight="bold" text-anchor="middle" 
              transform="rotate(-30, ${centerX}, ${centerY})">CONFIDENTIAL</text>
      </svg>
    `;

    const result = await sharp
      .default(imageBuffer)
      .composite([
        {
          input: Buffer.from(svgOverlay),
          top: 0,
          left: 0,
        },
      ])
      .jpeg({ quality: 85 })
      .toBuffer();

    return result;
  } catch {
    // Sharp not available, return original image
    return imageBuffer;
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ============================================================
// Helper: Get cached image or extract from ZIP
// ============================================================
async function getOrExtractImage(
  pkg: typeof inspectionPackages.$inferSelect,
  fileName: string,
  watermarkLines: string[],
): Promise<{ buffer: Buffer; fromCache: boolean }> {
  // Validate fileName to prevent path traversal (zip-slip)
  const normalizedName = path.normalize(fileName).replace(/^(\.\.(\/|\\|$))+/, '');
  if (normalizedName.includes('..') || path.isAbsolute(normalizedName)) {
    throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "fileName" }, "Invalid file name");
  }

  const cacheKey = `${pkg.packageId}/${normalizedName}`;
  const cachePath = path.join(CACHE_DIR, cacheKey);

  // Verify cache path stays within CACHE_DIR
  const resolvedCache = path.resolve(cachePath);
  if (!resolvedCache.startsWith(path.resolve(CACHE_DIR) + path.sep)) {
    throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "fileName" }, "Invalid file name");
  }

  // Check cache
  if (fs.existsSync(cachePath)) {
    const stat = fs.statSync(cachePath);
    const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
    if (ageDays < CACHE_TTL_DAYS) {
      return { buffer: fs.readFileSync(cachePath), fromCache: true };
    }
    // Cache expired, remove
    fs.unlinkSync(cachePath);
  }

  // Extract from ZIP
  // I-2 (review round 1) + round 2: pkg CHẮC CHẮN tồn tại ở đây (caller đã resolve
  // nó) — chỉ thiếu storageKey. ENTITY_NOT_FOUND ("Không tìm thấy gói AOI") sẽ nói
  // SAI: gói không hề mất, người vận hành sẽ đi tìm nhầm thứ. Dùng OPERATION_FAILED
  // để mô tả đúng hành động không thực hiện được, không đụng tới field nội bộ.
  // `operation` là khoá camelCase tra qua `errors.operation.*` (client
  // localizeParams) — KHÔNG phải câu tiếng Anh cứng, để người dùng vi/en/zh đều
  // đọc đúng ngôn ngữ của mình (round 2: sửa lỗi để lọt câu tiếng Anh trần).
  if (!pkg.storageKey) {
    throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "extractAoiPackageImage" }, "Package storage key not found");
  }

  let zipBuffer: Buffer;
  const storageMode = process.env.STORAGE_MODE ?? "forge";

  if (storageMode === "local") {
    const uploadsRoot = process.env.LOCAL_STORAGE_DIR
      ? path.resolve(process.env.LOCAL_STORAGE_DIR)
      : path.join(process.cwd(), "uploads");
    const filePath = path.join(uploadsRoot, pkg.storageKey);
    if (!fs.existsSync(filePath)) {
      // Review cuối, ca I-A #1: gói NÀY tồn tại trong DB (pkg + storageKey đều có) —
      // chỉ file ZIP cục bộ bị mất/di chuyển. ENTITY_NOT_FOUND{entity:"aoiPackage"} nói
      // SAI: người vận hành sẽ đi tìm nhầm "gói" thay vì hiểu đây là sự cố lưu trữ. Khớp
      // anh em ruột ở :223 (storageKey thiếu) và nhánh forge ở :243 (download lỗi) —
      // cả ba đều dùng OPERATION_FAILED cho cùng họ lỗi "trích xuất ảnh gói AOI thất bại".
      throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "extractAoiPackageImage" }, "ZIP file not found on disk");
    }
    zipBuffer = fs.readFileSync(filePath);
  } else {
    // Forge mode - download from storage
    const { url } = await storageGet(pkg.storageKey);
    const response = await fetch(url);
    if (!response.ok) {
      throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "downloadPackageZip" }, "Failed to download ZIP from storage");
    }
    zipBuffer = Buffer.from(await response.arrayBuffer());
  }

  // Parse ZIP and extract image
  const zip = await JSZip.loadAsync(zipBuffer);
  const imagePath = `images/${fileName}`;
  const imageFile = zip.file(imagePath) || zip.file(fileName);

  if (!imageFile) {
    throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "image" }, `Image ${fileName} not found in ZIP package`);
  }

  let imageBuffer: Buffer = Buffer.from(await imageFile.async("uint8array")) as Buffer;

  // Apply watermark
  if (watermarkLines.length > 0) {
    imageBuffer = await applyWatermark(imageBuffer, watermarkLines);
  }

  // Write to cache
  const cacheDir = path.dirname(cachePath);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  fs.writeFileSync(cachePath, imageBuffer);

  return { buffer: imageBuffer, fromCache: false };
}

// ============================================================
// Meta.json schema - Đồng bộ với submitInspection API
// ============================================================
/**
 * Pha 1D Task 5 (BG-52 ⛔) — trước bản vá này, `metaJsonSchema` có **0 trường
 * `.max()`** trong khi 6 trường (`serialNumber`/`productModel`/`batchNumber`/
 * `productionOrderCode`/`stageCode`/`operatorId`) ghi NGUYÊN VĂN vào cột
 * `varchar` của `product_inspections` — đúng lớp lỗi BG-9/BG-27 mà
 * `machineDataContractV2` (đường v2.0) đã đóng, nhưng cửa ZIP chưa từng được vá.
 * Sau bản vá `.max()` này, một payload quá cỡ bị TỪ CHỐI ở cửa hợp đồng
 * (`metaJsonSchema.parse()` ném, `commit` bắt ở `:catch`) thay vì rơi tới Postgres
 * `[22001] value too long for type character varying(n)` — thông điệp không nêu
 * tên trường, kỹ sư hiện trường không đọc nổi.
 *
 * `export` (đổi từ `const` nội bộ) CHỈ để `capChuoiVarcharScan.ts` (census
 * schema-walk) soi được đối tượng `ZodType` THẬT — không đổi ai import/dùng nó
 * để parse.
 *
 * HAI NHÓM, cùng khuôn `machineDataContractV2.ts` ("Vòng sửa 3"):
 *
 * (A) KHỚP CỘT THẬT — số đo từ `information_schema.columns`, vai `avi_app`,
 *   kiểm 2026-08-30 — sai một ký tự là sai:
 *   - `serialNumber`/`productModel`/`batchNumber`/`productionOrderCode` →
 *     `product_inspections.*` varchar(100).
 *   - `stageCode`/`operatorId` → `product_inspections.*` varchar(50).
 *   - `measurements[]`/`points[]`: `pointId`/`pointCode`/`code` →
 *     `package_images.pointCode` varchar(50) (ba tên là BA nguồn ứng viên cho
 *     CÙNG một cột, `point.pointId || point.pointCode || point.code`, xem
 *     `aoiPackageRouter.ts` gần dòng "Insert package image records" — cả ba
 *     phải cùng trần với cột đích); `name` → `package_images.pointName`
 *     varchar(255); `fileName` → `package_images.fileName` varchar(255);
 *     `measuredValue`/`value` (nhánh chuỗi) → cột SIẾT HƠN trong HAI cột nó có
 *     thể chạm — `package_images.measurementValue` varchar(**100**, không
 *     phải `measurement_results.measuredValueText` varchar(255) — cùng giá trị
 *     `.toString()` ghi vào CẢ HAI bảng, lấy trần NHỎ HƠN để không vỡ cột nào).
 *
 * (B) VỆ SINH — không khớp cột nào, hoặc khớp cột NHƯNG giá trị KHÔNG được ghi
 *   verbatim (bị suy lại/chỉ dùng đối chiếu) — `.max()` CHẶN PAYLOAD RÁC, số là
 *   hằng CHỌN (trừ khi ghi chú nói khác):
 *   - `machineCode`/`inspectionId` (gốc) — KHÔNG đọc ở đâu trong `commit`
 *     (đã grep `metaData?.machineCode`/`metaData?.inspectionId` — 0 kết quả) —
 *     `.max(100)`.
 *   - `startedAt`/`finishedAt`/`inspectionTime` (gốc) — `startedAt`/
 *     `inspectionTime` đi `new Date(...)` vào cột `timestamp` (KHÔNG PHẢI
 *     varchar, `22001` không áp dụng); `finishedAt` không đọc ở đâu hôm nay
 *     (chuẩn bị trước, cùng lý do `machineCode`) — `.max(40)`, dư sức ISO-8601
 *     dài nhất có múi giờ.
 *   - `companyCode`/`factoryCode`/`factory`/`workshopCode`/`lineCode`/`line`
 *     (gốc) — KHÔNG ghi verbatim: `macTenantCommit` (`phamViGhiMay.ts`) chỉ
 *     dùng chúng để ĐỐI CHIẾU với chuỗi SUY TỪ MÁY, giá trị THẬT ghi xuống
 *     luôn là bản suy. `.max(50)` khớp sức chứa `factories.code`/
 *     `workshops.code`/`production_lines.code`/`corporates.code` (đo avi_app,
 *     đều varchar(50)) — không phải rủi ro `22001` nhưng vẫn chặn payload rác
 *     trôi vào so sánh/log.
 *   - `measurements[].unit`/`points[].unit` — chỉ nội suy vào `remark` (text,
 *     không giới hạn), không có cột đích riêng — `.max(50)` (nhãn đơn vị ngắn).
 *
 * NGOẠI LỆ DUY NHẤT — `measurements[].remark`: cột đích
 * `measurement_results.remark` là `text`, KHÔNG có `character_maximum_length`
 * (đã kiểm avi_app, NULL = không giới hạn thật) — KHÔNG thêm `.max()`, cùng lý
 * do `errorDesc` bị loại trừ ở `machineDataContractV2.ts`. Census
 * (`capChuoiVarcharScan.ts`, danh sách miễn trừ theo schema) biết loại trừ
 * đúng MỘT trường này, không phải cả cây `measurements[]`.
 */
export const metaJsonSchema = z.object({
  // Machine identification (backward compatible)
  machineCode: z.string().max(100).optional(),
  inspectionId: z.string().max(100).optional(), // Internal inspection ID from agent

  // Product information (REQUIRED)
  serialNumber: z.string().max(100), // Số serial sản phẩm — product_inspections.serialNumber varchar(100)
  productModel: z.string().max(100), // Model sản phẩm — product_inspections.productModel varchar(100)
  batchNumber: z.string().max(100).optional(), // Số lô — product_inspections.batchNumber varchar(100)

  // Inspection timing
  startedAt: z.string().max(40).optional(), // ISO datetime
  finishedAt: z.string().max(40).optional(), // ISO datetime
  inspectionTime: z.string().max(40).optional(), // Alias for startedAt (submitInspection compat)
  cycleTime: z.number().optional(), // Thời gian chu kỳ (giây)

  // Overall result
  overallResult: z.enum(["OK", "NG", "NTF"]).optional(), // Kết quả tổng thể

  // Enterprise hierarchy (top-down) - Đồng bộ với submitInspection
  companyCode: z.string().max(50).optional(), // Mã tập đoàn/công ty
  factoryCode: z.string().max(50).optional(), // Mã nhà máy (alias: factory)
  factory: z.string().max(50).optional(), // Backward compatible
  workshopCode: z.string().max(50).optional(), // Mã nhà xưởng
  lineCode: z.string().max(50).optional(), // Mã dây chuyền (alias: line)
  line: z.string().max(50).optional(), // Backward compatible
  stageCode: z.string().max(50).optional(), // Mã công đoạn — product_inspections.stageCode varchar(50)

  // Production context
  productionOrderCode: z.string().max(100).optional(), // Mã lệnh sản xuất — product_inspections.productionOrderCode varchar(100)
  operatorId: z.string().max(50).optional(), // Mã công nhân vận hành — product_inspections.operatorId varchar(50)

  // Measurement data - Đồng bộ với submitInspection measurements
  measurements: z.array(z.object({
    pointId: z.string().max(50).optional(), // ID điểm đo (submitInspection compat) — package_images.pointCode varchar(50)
    pointCode: z.string().max(50).optional(), // Mã điểm đo (backward compatible) — cùng cột trên
    code: z.string().max(50).optional(), // Alias for pointCode — cùng cột trên
    name: z.string().max(255).optional(), // Tên điểm đo — package_images.pointName varchar(255)
    fileName: z.string().max(255), // Tên file ảnh trong ZIP — package_images.fileName varchar(255)
    result: z.enum(["OK", "NG", "NTF"]).optional(), // Kết quả
    measuredValue: z.union([z.number(), z.string().max(100)]).optional(), // Giá trị đo — package_images.measurementValue varchar(100) (trần SIẾT HƠN — xem docblock)
    value: z.union([z.number(), z.string().max(100)]).optional(), // Alias — cùng cột trên
    unit: z.string().max(50).optional(), // Đơn vị
    remark: z.string().optional(), // Ghi chú — measurement_results.remark là `text`, KHÔNG `.max()` (xem docblock)
  })),

  // Legacy fields (backward compatible)
  points: z.array(z.object({
    code: z.string().max(50), // package_images.pointCode varchar(50)
    name: z.string().max(255).optional(), // package_images.pointName varchar(255)
    fileName: z.string().max(255), // package_images.fileName varchar(255)
    result: z.enum(["OK", "NG", "NTF"]).optional(),
    value: z.union([z.number(), z.string().max(100)]).optional(), // package_images.measurementValue varchar(100)
    unit: z.string().max(50).optional(),
  })).optional(),

  // Summary (auto-calculated if not provided)
  summary: z.object({
    totalPoints: z.number(),
    ok: z.number(),
    ng: z.number(),
    ntf: z.number().optional(),
  }).optional(),
});

// ============================================================
// Overall-result inference (Task 9 / PHẦN 2) — thuần, không I/O, test trực tiếp
// được từ aoiPackageIngestHopNhat.test.ts.
// ============================================================
/**
 * Suy `overallResult` của một gói ZIP AOI, đối chiếu lời khai `meta.json` với
 * cuộn tính TỪ `summary`.
 *
 * Trước sửa (task-9-report.md PHẦN 2, lỗi 1), cả hai nơi dùng biểu thức
 * `metaData.overallResult || (summary?.ng > 0 ? "NG" : "OK")` — KHÔNG nhánh
 * nào trả "NTF". Bản vá đó thêm nhánh NTF nhưng vẫn để `explicitResult` THẮNG
 * VÔ ĐIỀU KIỆN — đúng hình dạng Đ-21 mà Pha 1C vừa đóng cho đường v2.0 bằng
 * `verdictXauHon`: gói khai `OK` với `summary.ng = 3` vẫn ghi `OK` (BG-42).
 * Sau Pha 1C, đường ZIP là đường DUY NHẤT còn để lời khai thắng — cùng sản
 * phẩm, hai đường ingest xử lý ngược nhau.
 *
 * Quy tắc mới: cuộn từ `summary` trước (có NG → NG; không NG mà có NTF →
 * NTF; không cả hai → OK), rồi lấy XẤU HƠN giữa cuộn đó và `explicitResult`
 * (nếu có khai) qua `verdictXauHon` — cùng hàm chung đường v2.0 đang dùng,
 * không viết bản chép tay thứ ba. `explicitResult` vẫn có tác dụng khi nó
 * XẤU HƠN cuộn (VD: máy khai NG nhưng summary rỗng ⇒ vẫn NG — máy biết thứ
 * nó không gửi lên), chỉ KHÔNG còn được phép làm NHẸ đi một cuộn tệ hơn.
 */
export function inferAoiOverallResult(input: {
  explicitResult?: "OK" | "NG" | "NTF" | null;
  ngCount?: number | null;
  ntfCount?: number | null;
}): "OK" | "NG" | "NTF" {
  const cuonTuSummary: "OK" | "NG" | "NTF" =
    (input.ngCount ?? 0) > 0 ? "NG" : (input.ntfCount ?? 0) > 0 ? "NTF" : "OK";
  if (input.explicitResult) return verdictXauHon(input.explicitResult, cuonTuSummary);
  return cuonTuSummary;
}

/**
 * `product_inspections.originalResult` ghi lại cái MÁY BÁO TRƯỚC KHI người xác
 * nhận NTF — cột DB chỉ nhận OK/NG (`originalResultEnum`,
 * drizzle/schema/enums.ts:59). "NTF" không phải giá trị máy tự báo, nó là một
 * xác nhận CỦA NGƯỜI đến sau, nên khi overall suy ra NTF, `originalResult` vẫn
 * phải là NG (đang chờ xác nhận) — KHÔNG BAO GIỜ "NTF" (lỗi 2, task-9-report.md
 * PHẦN 2: ép kiểu `overallResult as "OK" | "NG"` cũ để lọt "NTF" xuống INSERT
 * và vỡ ở tầng DB vì originalResultEnum không nhận giá trị đó).
 */
export function toOriginalResult(overall: "OK" | "NG" | "NTF"): "OK" | "NG" {
  return overall === "NTF" ? "NG" : overall;
}

/**
 * Pha 1E Task 3 (BG-69) — `presign.input`, TRÍCH XUẤT thành named export CÙNG
 * quy ước `submitInspectionCoreObject` (machineApiRouters.ts): `export`
 * (không đổi hình dạng/hành vi) CHỈ để census schema-walk
 * (`server/contracts/capChuoiVarcharScan.ts`) soi được đối tượng `ZodType`
 * THẬT trước khi `.refine()` áp lên — `.refine()` không đổi cấu trúc trường,
 * chỉ thêm một ràng buộc CHÉO (apiKey || machineCode) không đụng tới `.max()`.
 *
 * ★★★ LỖ THẬT ĐƯỢC ĐÓNG Ở ĐÂY — `inspectionId` KHỚP CỘT THẬT
 * `inspection_packages.packageId` varchar(100) (đo avi_app, 2026-08-30):
 * `presign` INSERT `packageId: input.inspectionId` NGUYÊN VĂN
 * (xem `database.insert(inspectionPackages).values({...})` bên dưới) — trước
 * bản vá này, một `inspectionId` > 100 ký tự rơi thẳng xuống Postgres
 * `[22001] value too long for type character varying(100)`, và lỗi đó xảy ra
 * Ở BƯỚC `presign` — TRƯỚC KHI `metaJsonSchema` (đã siết từ Pha 1D Task 5)
 * kịp soi bất kỳ trường nào của `meta.json` (`meta.json` chỉ xuất hiện ở bước
 * `commit`, sau khi ZIP đã được tải lên trọn vẹn — presign từ chối SỚM tiết
 * kiệm một lượt upload ZIP vô ích).
 *
 * `apiKey`/`machineCode` — VỆ SINH, cùng lý do + cùng con số đã chọn cho hai
 * trường CÙNG TÊN ở `submitInspectionCoreObject` (chỉ SO KHỚP qua
 * `authenticateMachine`, không INSERT). `sha256` — VỆ SINH: đã grep toàn file
 * `input.sha256` — chỉ xuất hiện ở khai báo schema (đây + `commit`), không hề
 * được đọc/so sánh ở đâu khác — `.max(128)` dư sức SHA-256 hex thật (64 ký
 * tự), chặn payload rác.
 */
export const presignCoreObject = z.object({
  apiKey: z.string().max(256).optional(),
  machineCode: z.string().max(50).optional(),
  inspectionId: z.string().max(100), // From agent (unique ID) — inspection_packages.packageId varchar(100)
  sizeBytes: z.number(),
  sha256: z.string().max(128).optional(),
});

// ============================================================
// Router
// ============================================================
export const aoiPackageRouter = router({
  /**
   * 1. Presign - Tạo presigned URL để Agent upload ZIP
   * Agent gọi endpoint này trước khi upload
   */
  presign: publicProcedure
    .input(presignCoreObject.refine(data => data.apiKey || data.machineCode, {
      message: "Either apiKey or machineCode must be provided",
    }))
    .mutation(async ({ input, ctx }) => {
      // ★★★ Task 10 — TỪNG tự phân giải máy bằng getMachineByApiKey/getMachineByCode,
      // bỏ qua hoàn toàn cổng MACHINE_CODE_ONLY_ALLOWED. Nay đi qua authenticateMachine
      // (cùng cổng mọi đường machine khác dùng), scope ingest:write.
      const { machine } = await authenticateMachine({
        apiKey: input.apiKey,
        machineCode: input.machineCode,
        headerKey: machineHeaderKey(ctx),
        scope: "ingest:write",
        endpoint: "aoiPackage.presign",
      });

      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      // Check for idempotency - if package with same ID exists, return existing info
      const existing = await database
        .select()
        .from(inspectionPackages)
        .where(eq(inspectionPackages.packageId, input.inspectionId))
        .limit(1);

      if (existing.length > 0) {
        const pkg = existing[0];
        if (pkg.status === "committed") {
          return {
            success: true,
            alreadyCommitted: true,
            packageId: pkg.packageId,
            message: "Package already committed",
          };
        }
        // ★★★ BG-65 (Pha 1E Task 2 ⛔) — 'dead' là trạng thái CUỐI (migration
        // 0344, Pha 1D Task 5/BG-52): gói đã chạm ngưỡng lỗi VĨNH VIỄN LIÊN
        // TIẾP ở `commit`. Trước bản vá này, nhánh DUY NHẤT còn lại cho một
        // gói không-committed là "trả presign cũ để retry" ngay bên dưới —
        // đúng nghĩa MỜI Agent thử lại một gói không bao giờ commit được, tốn
        // một lượt upload ZIP (có thể hàng chục MB) vô ích trước khi `commit`
        // mới từ chối được (:~825 dưới). Từ chối NGAY ở đây — cùng lời văn với
        // cổng `commit` (:~825) để Agent nhận đúng MỘT thông điệp cho cả vòng.
        if (laGoiDaChet(pkg.status)) {
          throw appError(
            "UNPROCESSABLE_CONTENT",
            "OPERATION_FAILED",
            { operation: "processAoiPackage" },
            `Gói ${pkg.packageId} đã bị đánh dấu HỎNG VĨNH VIỄN sau nhiều lần lỗi không thể phục hồi ` +
              `(lỗi gần nhất: ${pkg.errorMessage ?? "?"}) — Agent KHÔNG được thử lại gói này nữa. ` +
              `Cần một gói ZIP MỚI (packageId khác) nếu payload đã được sửa.`,
          );
        }
        // Return existing presign info for retry
        return {
          success: true,
          alreadyCommitted: false,
          packageId: pkg.packageId,
          objectKey: pkg.storageKey,
          uploadUrl: undefined as string | undefined,
          expiresAt: pkg.presignExpiresAt?.toISOString(),
        };
      }

      // Get machine hierarchy info for object key
      const machineRecord = machine;
      // ★★★ 2026-08-18 — ĐƯỜNG LƯU TỆP DO MÁY CHỦ SINH, theo chuỗi phân cấp SUY TỪ MÁY:
      //   aoi/<corporateCode>/<factoryCode>/<workshopCode>/<lineCode>/<machineCode>/yyyy/mm/dd/<id>.zip
      // Dòng cũ đã viết sẵn lời hứa `aoi/{factory}/{line}/{machine}/…` trong chú thích nhưng chỉ
      // sinh ra `aoi/{machine}/…` — không một đoạn tenant nào. Sau lượt này, một lượt uỷ quyền
      // đọc ảnh chỉ còn là phép so TIỀN TỐ đường dẫn (O(1), không truy vấn cho mỗi ảnh).
      // ⚠ Gói CŨ giữ nguyên khoá cũ trong `inspection_packages."storageKey"`; mọi đường đọc lấy
      // khoá TỪ HÀNG chứ không dựng lại đường dẫn ⇒ tệp cũ vẫn phục vụ được.
      const macTenantGoi = await macTenantChoGhi(machineRecord, {});
      const now = new Date();
      const objectKey = macTenantGoi.chuoi
        ? khoaLuuTruGoi(macTenantGoi.chuoi, input.inspectionId, now)
        : `aoi/${machineRecord.code}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}/${input.inspectionId}.zip`;
      const expiresAt = new Date(Date.now() + PRESIGN_TTL_MINUTES * 60 * 1000);

      // In local/forge storage mode, we use direct upload to our server
      // The "presigned URL" is actually our own upload endpoint
      const uploadUrl = `/api/aoi/upload/${input.inspectionId}`;

      // Create package record
      const insertResult = await database.insert(inspectionPackages).values({
        machineId: machineRecord.id,
        packageId: input.inspectionId,
        storageKey: objectKey,
        fileSizeBytes: input.sizeBytes,
        status: "pending",
        machineCode: machineRecord.code,
        presignExpiresAt: expiresAt,
      }).returning({ id: inspectionPackages.id });

      // Log: presign event
      const pkgDbId = insertResult[0]?.id;
      if (pkgDbId) {
        await logPackageActivity({
          packageDbId: pkgDbId,
          packageId: input.inspectionId,
          machineId: machineRecord.id,
          event: "presign",
          message: `Presigned URL created for package ${input.inspectionId}`,
          source: "agent",
          detail: `Storage key: ${objectKey}, Size: ${input.sizeBytes} bytes, Expires: ${expiresAt.toISOString()}`,
          fileSizeBytes: input.sizeBytes,
          metadata: { objectKey, uploadUrl, sizeBytes: input.sizeBytes },
        });
      }

      // Update machine heartbeat
      await db.updateMachineHeartbeat(machineRecord.id);

      return {
        success: true,
        alreadyCommitted: false,
        packageId: input.inspectionId,
        objectKey,
        uploadUrl,
        expiresAt: expiresAt.toISOString(),
      };
    }),

  /**
   * 2. Commit - Xác nhận upload thành công
   * Agent gọi sau khi upload ZIP xong
   */
  commit: publicProcedure
    .input(z.object({
      apiKey: z.string().optional(),
      machineCode: z.string().optional(),
      packageId: z.string(),
      sizeBytes: z.number().optional(),
      sha256: z.string().optional(),
    }).refine(data => data.apiKey || data.machineCode, {
      message: "Either apiKey or machineCode must be provided",
    }))
    .mutation(async ({ input, ctx }) => {
      // ★★★ Task 10 — same fix as presign: authenticateMachine instead of a raw
      // getMachineByApiKey/getMachineByCode resolve.
      const { machine } = await authenticateMachine({
        apiKey: input.apiKey,
        machineCode: input.machineCode,
        headerKey: machineHeaderKey(ctx),
        scope: "ingest:write",
        endpoint: "aoiPackage.commit",
      });

      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      // Find package
      const pkgs = await database
        .select()
        .from(inspectionPackages)
        .where(eq(inspectionPackages.packageId, input.packageId))
        .limit(1);

      if (pkgs.length === 0) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "aoiPackage" }, "Package not found");
      }

      const pkg = pkgs[0];

      // Idempotent: already committed
      if (pkg.status === "committed") {
        return { success: true, alreadyCommitted: true, packageId: pkg.packageId };
      }

      // Validate package belongs to this machine
      if (pkg.machineId !== machine.id) {
        throw appError("FORBIDDEN", "SCOPE_MISMATCH", { entity: "aoiPackage", parent: "machine" }, "Package belongs to another machine");
      }

      // ★★★ Pha 1D Task 5 (BG-52 ⛔) — CHỐT CHẶN RETRY VÔ HẠN. Gói đã chạm trạng
      // thái CUỐI `'dead'` (đủ `nguongLoiVinhVienZip()` lỗi VĨNH VIỄN LIÊN TIẾP,
      // xem `catch` bên dưới) — từ chối NGAY, KHÔNG tải lại ZIP/KHÔNG đụng DB
      // thêm lần nào nữa. Trước bản vá này, `:673` (nhánh idempotent ở trên) chỉ
      // ngắn mạch `status==='committed'` — một gói `'failed'` VĨNH VIỄN bị Agent
      // gọi lại `commit` sẽ chạy LẠI TOÀN BỘ chi phí (tải ZIP, parse, transaction)
      // để nhận đúng lỗi cũ, vô hạn lần. Đặt SAU cổng xác thực/uỷ quyền ở trên để
      // không lộ trạng thái gói cho một máy không sở hữu nó.
      if (laGoiDaChet(pkg.status)) {
        throw appError(
          "UNPROCESSABLE_CONTENT",
          "OPERATION_FAILED",
          { operation: "processAoiPackage" },
          `Gói ${pkg.packageId} đã bị đánh dấu HỎNG VĨNH VIỄN sau nhiều lần lỗi không thể phục hồi ` +
            `(lỗi gần nhất: ${pkg.errorMessage ?? "?"}) — Agent KHÔNG được thử lại gói này nữa. ` +
            `Cần một gói ZIP MỚI (packageId khác) nếu payload đã được sửa.`,
        );
      }

      // Log: commit_start
      const commitStartTime = Date.now();
      await logPackageActivity({
        packageDbId: pkg.id,
        packageId: pkg.packageId,
        machineId: machine.id,
        event: "commit_start",
        message: `Commit started for package ${pkg.packageId}`,
        source: "agent",
        detail: `Storage key: ${pkg.storageKey || 'N/A'}`,
      });

      // Try to parse meta.json from the ZIP
      let metaData: z.infer<typeof metaJsonSchema> | null = null;

      if (pkg.storageKey) {
        try {
          let zipBuffer: Buffer;
          const storageMode = process.env.STORAGE_MODE ?? "forge";

          if (storageMode === "local") {
            const uploadsRoot = process.env.LOCAL_STORAGE_DIR
              ? path.resolve(process.env.LOCAL_STORAGE_DIR)
              : path.join(process.cwd(), "uploads");
            const filePath = path.join(uploadsRoot, pkg.storageKey);
            if (fs.existsSync(filePath)) {
              zipBuffer = fs.readFileSync(filePath);
            } else {
              throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "aoiPackage" }, "ZIP file not found");
            }
          } else {
            const { url } = await storageGet(pkg.storageKey);
            const response = await fetch(url);
            zipBuffer = Buffer.from(await response.arrayBuffer());
          }

          const zip = await JSZip.loadAsync(zipBuffer);
          const metaFile = zip.file("meta.json");
          if (metaFile) {
            const metaContent = await metaFile.async("string");
            metaData = metaJsonSchema.parse(JSON.parse(metaContent));
          }

          // ★★★ 2026-08-18 — MÃ TENANT SUY TỪ MÁY ĐÃ XÁC THỰC, KHÔNG LẤY TỪ `meta.json`.
          // `meta.json` nằm TRONG chính tệp ZIP mà máy vừa tải lên — nó là lời tự khai ở dạng
          // thuần khiết nhất. Hai chỗ ghi dưới đây dùng nó: bản ghi kiểm mới
          // (`product_inspections`) và hàng gói (`inspection_packages`, bảng CÓ RLS
          // `app_tenant_allows("factoryCode", NULL)` ⇒ `factoryCode` NULL = **mọi nhà máy đều
          // thấy** sau mig 0327; đo được 160/160 gói trong CSDL test đang là NULL).
          // Lời khai vẫn được NHẬN, nhưng chỉ để ĐỐI CHIẾU — lệch ⇒ `machine_tenant_claim_mismatch`.
          const macTenantCommit = await macTenantChoGhi(machine, {
            corporateCode: metaData?.companyCode,
            factoryCode: metaData?.factoryCode ?? metaData?.factory,
            workshopCode: metaData?.workshopCode,
            lineCode: metaData?.lineCode ?? metaData?.line,
          });

          // Count images in ZIP
          const imageFiles = Object.keys(zip.files).filter(
            (name) => name.startsWith("images/") && !name.endsWith("/")
          );

          // Normalize measurements - support both measurements and points (backward compat)
          const normalizedMeasurements = metaData?.measurements || metaData?.points || [];

          // ★★★ BG-68 (Pha 1E Task 2 ⛔) — đếm NG/NTF THẬT từ measurements[].result,
          // KHÔNG BAO GIỜ từ metaData.summary. `summary` là lời khai THỨ HAI của
          // CHÍNH MÁY, trong CÙNG tệp meta.json, CÙNG ZIP — không phải dữ liệu độc
          // lập. Trước bản vá này, cả `inferredOverall` (header board-mới) lẫn
          // `finalOverallResult` (package row + hook WIP) suy verdict từ
          // `metaData.summary?.ng`/`calculatedSummary.ng` (calculatedSummary ưu
          // tiên `metaData.summary` khi có — xem dưới), nên `verdictXauHon(khai,
          // khai)` chỉ so hai lời khai của MỘT nguồn với nhau: một máy khai NHẤT
          // QUÁN SAI (`overallResult:"OK"` + `summary.ng:0` + `measurements[]` có
          // `result:"NG"`) đi lọt hoàn toàn. Đúng lỗ mà `614245c0` vừa đóng cho
          // đường v1.x (`machineApiRouters.ts`, cuộn từ `measurementResults` THẬT
          // qua `rollupVerdict`) — vẫn mở nguyên ở cửa ZIP.
          // Đếm này nuôi CẢ HAI nơi suy overallResult bên dưới (header board-mới
          // ở khối `metaData?.serialNumber` VÀ `finalOverallResult`) — không còn
          // nơi nào đọc `metaData.summary` để quyết định VERDICT. Phạm vi cố ý hẹp:
          // `calculatedSummary` (totalPoints/ok/ng lưu vào `inspection_packages`
          // để BÁO CÁO) giữ nguyên hành vi cũ — chỉ overallResult mới bắt buộc
          // cuộn từ dữ liệu thật (BG-68 chỉ canh verdict, không mở rộng sang các
          // cột đếm báo cáo).
          const ngNtfThat = {
            ng: normalizedMeasurements.filter((p) => p.result === "NG").length,
            ntf: normalizedMeasurements.filter((p) => !p.result || p.result === "NTF").length,
          };

          // ── P0-A data-integrity: resolve REAL measurement-point definition ids ──
          // Resolve the product model (by code) so auto-provisioned point defs are
          // anchored to it. Caches are shared across all inserts in this commit.
          const resolvedProductModel = metaData?.productModel
            ? await db.getProductModelByCode(metaData.productModel.trim())
            : undefined;
          const mpResolverProductCache: PointDefCache = new Map();
          const mpResolverMachineCache: PointDefCache = new Map();
          const resolvePointDefId = (rawCode: string | undefined) =>
            resolveOrCreateMeasurementPointDefId(rawCode, {
              productModelId: resolvedProductModel?.id,
              machineId: machine.id,
              productCache: mpResolverProductCache,
              machineCache: mpResolverMachineCache,
              autoCreate: true,
            });

          // W2-A / doc 35 D2 — spec gate. resolvePointDefId() warms the shared
          // caches with the FULL point-def row (incl. limits/criteria), so after
          // resolving the id we can read the def back to gate the stored result.
          // Auto-provisioned defs carry no limits ⇒ pass-through (like canonical).
          const pointLimitEvalOn = isPointLimitEvalEnabled();
          const resolvePointDefRecord = (rawCode: string | undefined) => {
            const normalized = (rawCode ?? "").trim();
            if (!normalized) return null;
            return (
              mpResolverProductCache.get(normalized) ??
              mpResolverMachineCache.get(normalized) ??
              null
            );
          };
          // Count points the spec gate downgraded OK→NG so the inspection's
          // overallResult can be reconciled to NG after the inserts (mirrors the
          // canonical serverDowngradeCount → reconcileInspectionOverallNG path).
          let zipDowngradeCount = 0;

          // ── P1-A (doc 38 R-2b): pre-resolve point-def ids ONCE, outside tx ──
          // Each measurement-insert branch below used to call
          // `await resolvePointDefId(code)` per row (a DB round-trip + possible
          // auto-create INSIDE the write loop). Resolve every image-bearing
          // measurement ONCE here, keyed by its ABSOLUTE index (the same index
          // the branches use for the `Point_N` fallback code). Point-def
          // auto-creation is idempotent master-data and intentionally stays
          // OUTSIDE the atomic result-write transaction. The spec-gate EVAL is
          // kept inline per branch so OK→NG is only counted for rows that are
          // actually (re)written with a result (the imageUrl-only UPDATE path is
          // NOT gated — unchanged behavior).
          const pointsWithImages = normalizedMeasurements.filter((point) => point.fileName);
          const resolvedPoints: Array<{
            pointCode: string;
            pointName: string;
            pointDefId: number;
            gateDef: any | null;
            measuredVal: any;
            measuredStr: string | null;
            isNumeric: boolean;
          }> = [];
          for (let k = 0; k < pointsWithImages.length; k++) {
            const point = pointsWithImages[k] as any;
            const pointCode = point.pointId || point.pointCode || point.code || `Point_${k + 1}`;
            const pointName = point.name || pointCode;
            const measuredVal =
              point.measuredValue !== undefined ? point.measuredValue : point.value;
            const measuredStr =
              measuredVal !== undefined && measuredVal !== null ? String(measuredVal) : null;
            const isNumeric =
              measuredStr !== null && !isNaN(Number(measuredStr)) && measuredStr.trim() !== "";
            const pointDefId = await resolvePointDefId(pointCode);
            assertValidPointDefId(
              pointDefId,
              `AOI commit (pkg=${pkg.packageId}, point=${pointCode})`,
            );
            const gateDef = pointLimitEvalOn ? resolvePointDefRecord(pointCode) : null;
            resolvedPoints.push({ pointCode, pointName, pointDefId, gateDef, measuredVal, measuredStr, isNumeric });
          }

          // Outer-scope values needed AFTER persistInspectionAtomic / the tx below
          // (logging/hooks/return).
          let linkedInspectionId: number | undefined;
          let createdInspection = false;
          let finalOverallResult: "OK" | "NG" | "NTF" = "OK";

          // Fix timezone: shift to "fake UTC" so Drizzle stores local time in
          // timestamp without time zone. Tính MỘT LẦN — dùng lại cho cả header
          // (board mới) lẫn measurement rows (board mới VÀ board tái dùng). An
          // toàn khi `metaData` null: `pointsWithImages` rỗng nên `buildRecord`
          // dưới đây không bao giờ thực sự chạy.
          const rawInspTime = metaData?.inspectionTime
            ? new Date(metaData.inspectionTime)
            : metaData?.startedAt
            ? new Date(metaData.startedAt)
            : new Date();
          const inspectionTime = new Date(rawInspTime.getTime() - rawInspTime.getTimezoneOffset() * 60000);

          // Build one measurement_results row from a pre-resolved point
          // (pointDefId/gateDef resolved OUTSIDE any transaction above). The
          // spec-gate EVAL runs here so `zipDowngradeCount` is only bumped for
          // rows we actually (re)write with a result. Dùng chung cho CẢ đường
          // board-mới (persistInspectionAtomic bên dưới) LẪN đường tái dùng
          // (trong transaction cuối) — `linkedInspectionId` được đọc tại THỜI
          // ĐIỂM GỌI qua closure nên mỗi đường thấy đúng giá trị nó vừa đặt.
          const buildRecord = (absIdx: number, point: any) => {
            const rp = resolvedPoints[absIdx];
            let effectiveResult = (point.result || "NTF") as "OK" | "NG" | "NTF";
            let specGateRemark: string | undefined;
            if (rp.gateDef) {
              const evalRes = evaluatePointResult(rp.gateDef as any, { measuredValue: rp.measuredVal as any }, effectiveResult);
              effectiveResult = evalRes.result;
              if (evalRes.overridden) {
                zipDowngradeCount++;
                specGateRemark = `Spec gate: ${evalRes.violations.join("; ")}`.slice(0, 480);
              }
            }
            return {
              inspectionId: linkedInspectionId!,
              pointDefId: rp.pointDefId,
              measuredValue: rp.isNumeric ? rp.measuredStr : null,
              measuredValueText: rp.measuredStr,
              result: effectiveResult,
              imageUrl: `/api/aoi/image/${pkg.packageId}/${point.fileName}`,
              remark: specGateRemark ?? (point.remark || `${rp.pointName}${rp.measuredVal !== undefined ? ` (${rp.measuredVal}${point.unit || ''})` : ''}`),
              createdAt: inspectionTime,
            };
          };

          // ── Task 9 (PHẦN 1) — header + measurements của một board MỚI đi qua
          // `persistInspectionAtomic`, KHÔNG còn tự INSERT thẳng vào bảng
          // `productInspections` qua `tx`. Lối (a) (xem task-9-report.md): gọi TRƯỚC khi mở transaction
          // ở dưới, vì `persistInspectionAtomic` tự mở `db.transaction()` CỦA
          // RIÊNG NÓ trên một kết nối khác — gọi nó BÊN TRONG một transaction khác
          // sẽ không khiến nó tham gia transaction đó, nên rollback ngoài sẽ
          // KHÔNG hoàn tác nó. Đánh đổi: mất tính nguyên tử giữa (header+
          // measurements) và (package_images+trạng thái gói) — nhưng ĐƯỢC sổ
          // idempotency claim-first của nó, nên một lần retry của CÙNG
          // `pkg.packageId` hội tụ về đúng MỘT inspection thay vì tự chép lại
          // giao thức claim (điều task này sinh ra để xoá).
          if (metaData?.serialNumber) {
            // Try to find existing inspection (đọc trước khi ghi — một lượt commit
            // ĐỒNG THỜI thật của CÙNG package vẫn bị chặn ở dưới bởi chính sổ
            // idempotency claim-first của `persistInspectionAtomic`, không phải bởi
            // SELECT này).
            const inspections = await database
              .select()
              .from(productInspections)
              .where(
                and(
                  eq(productInspections.machineId, machine.id),
                  eq(productInspections.serialNumber, metaData.serialNumber)
                )
              )
              .orderBy(desc(productInspections.createdAt))
              .limit(1);

            if (inspections.length > 0) {
              linkedInspectionId = inspections[0].id;
            } else {
              // ── NEW inspection: reserve the surrogate id FIRST (mirrors the
              // machineApiRouters PA-A path) so the measurement rows below can
              // carry it, then persist header+measurements ATOMICALLY in ONE call.
              const reservedId = await db.reserveInspectionId();
              linkedInspectionId = reservedId;

              const newMeasurementRows: InsertMeasurementResult[] = [];
              for (let idx = 0; idx < pointsWithImages.length; idx++) {
                newMeasurementRows.push(buildRecord(idx, pointsWithImages[idx] as any));
              }

              // Determine overall result — xem inferAoiOverallResult (PHẦN 2, lỗi 1)
              // + BG-68 (ngNtfThat, đếm THẬT từ measurements[].result — KHÔNG còn
              // đọc metaData.summary để suy verdict, xem docblock tại chỗ khai báo).
              const inferredOverall = inferAoiOverallResult({
                explicitResult: metaData.overallResult ?? null,
                ngCount: ngNtfThat.ng,
                ntfCount: ngNtfThat.ntf,
              });

              const newInspectionData: InsertProductInspection & { id: number } = {
                id: reservedId,
                machineId: machine.id,
                serialNumber: metaData.serialNumber,
                productModel: metaData.productModel || null,
                batchNumber: metaData.batchNumber || null,

                // Enterprise hierarchy — SUY TỪ MÁY (xem `macTenantCommit` ở trên).
                // ⚠ `stageCode` KHÔNG suy được (không phải nút phân cấp) ⇒ nguyên văn lời khai.
                corporateCode: macTenantCommit.corporateCode ?? null,
                factoryCode: macTenantCommit.factoryCode ?? null,
                workshopCode: macTenantCommit.workshopCode ?? null,
                lineCode: macTenantCommit.lineCode ?? null,
                stageCode: metaData.stageCode || null,

                // Production context
                productionOrderCode: metaData.productionOrderCode || null,
                operatorId: metaData.operatorId || null,

                overallResult: inferredOverall,
                // PHẦN 2 lỗi 2: originalResultEnum chỉ nhận OK/NG — NTF suy từ
                // overall phải hạ về NG (cái máy báo TRƯỚC khi người xác nhận NTF).
                originalResult: toOriginalResult(inferredOverall),
                inspectionTime: inspectionTime,
                cycleTime: metaData.cycleTime ? String(metaData.cycleTime) : null,
                createdAt: inspectionTime,
                updatedAt: inspectionTime,
                // Sổ idempotency (doc 51 P1) tái dùng nguyên giao thức — packageId
                // là UNIQUE (drizzle/schema/inspection.ts:364) ⇒ khoá ổn định qua
                // mọi lần retry của CÙNG một gói.
                idempotencyKey: `aoi-pkg:${pkg.packageId}`,
              };

              const persisted = await db.persistInspectionAtomic(
                newInspectionData,
                newMeasurementRows,
                { promoteOverallToNg: zipDowngradeCount > 0 },
              );
              linkedInspectionId = persisted.id;
              createdInspection = !persisted.duplicate;
              if (persisted.duplicate) {
                console.warn(
                  `[AOI commit] persistInspectionAtomic reported duplicate for package ` +
                    `${pkg.packageId} (idempotency key hit) → existing inspectionId=${persisted.id}`,
                );
                // Measurements vừa build KHÔNG được ghi (persistInspectionAtomic bỏ
                // qua chúng khi duplicate) — nhánh tái dùng bên dưới tự đếm lại từ
                // đầu trên các record ĐÃ tồn tại, nên đếm của lượt này không được
                // rò sang đó.
                zipDowngradeCount = 0;
              }
            }
          }

          // Calculate summary from measurements if not provided — CHỈ dùng cho
          // các cột BÁO CÁO (totalPoints/okCount/ngCount lưu vào
          // `inspection_packages`, xem :~1140 dưới). KHÔNG dùng cho verdict —
          // BG-68 tách hẳn hai việc: đếm này vẫn được phép ưu tiên lời khai
          // `metaData.summary` (phạm vi cố ý hẹp, xem docblock `ngNtfThat`), còn
          // verdict luôn cuộn từ `ngNtfThat` (đo thật) ở dưới.
          const calculatedSummary = metaData?.summary || {
            totalPoints: normalizedMeasurements.length,
            ok: normalizedMeasurements.filter(p => p.result === 'OK').length,
            ng: normalizedMeasurements.filter(p => p.result === 'NG').length,
            ntf: normalizedMeasurements.filter(p => !p.result || p.result === 'NTF').length,
          };

          // Determine overall result (assigns the outer-scope var used by the
          // post-commit WIP hook below). Cùng hàm thuần với header — BG-68: dùng
          // `ngNtfThat` (đếm THẬT từ measurements[].result, tính MỘT LẦN ở trên)
          // thay vì `calculatedSummary.ng/ntf` — biểu thức cũ đọc lại đúng lời
          // khai `metaData.summary` khi máy CÓ gửi summary (dù summary đó nhất
          // quán SAI với measurements[]), để lọt đúng lỗ BG-68 mô tả.
          finalOverallResult = inferAoiOverallResult({
            explicitResult: metaData?.overallResult ?? null,
            ngCount: ngNtfThat.ng,
            ntfCount: ngNtfThat.ntf,
          });

          // ── Phần ghi còn lại, VẪN MỘT transaction: package images + (CHỈ đường
          // tái dùng) đồng bộ measurement/thăng hạng spec-gate + trạng thái
          // gói→committed. Header+measurements của board MỚI đã commit nguyên tử
          // ở TRÊN qua persistInspectionAtomic.
          await database.transaction(async (tx) => {
            // Insert package image records
            if (normalizedMeasurements.length > 0) {
              const imageRecords = normalizedMeasurements.map((point: any) => ({
                packageId: pkg.id,
                pointCode: point.pointId || point.pointCode || point.code || 'UNKNOWN',
                pointName: point.name || null,
                fileName: point.fileName,
                result: point.result as "OK" | "NG" | "NTF" | undefined,
                measurementValue: (point.measuredValue || point.value)?.toString() || null,
              }));

              if (imageRecords.length > 0) {
                await tx.insert(packageImages).values(imageRecords);
              }
            }

            // Create or update measurement results with image URLs pointing to AOI
            // package images — CHỈ cho đường TÁI DÙNG (một inspection đã có sẵn,
            // tìm thấy ở SELECT trên HOẶC được persistInspectionAtomic báo là
            // duplicate). Đường board-MỚI đã ghi measurements nguyên tử cùng header
            // qua persistInspectionAtomic rồi.
            if (!createdInspection && linkedInspectionId && pointsWithImages.length > 0) {
              const existingRecords = await tx
                .select({ id: measurementResults.id, remark: measurementResults.remark })
                .from(measurementResults)
                .where(eq(measurementResults.inspectionId, linkedInspectionId))
                .orderBy(measurementResults.id);

              if (existingRecords.length > 0) {
                // Batch UPDATE existing rows' imageUrl by index order (was one
                // UPDATE per row): pair id↔url via a VALUES list so it runs as
                // a SINGLE statement (each id/url is a bound scalar param).
                const updateCount = Math.min(existingRecords.length, pointsWithImages.length);
                if (updateCount > 0) {
                  const pairs = [];
                  for (let i = 0; i < updateCount; i++) {
                    const url = `/api/aoi/image/${pkg.packageId}/${pointsWithImages[i].fileName}`;
                    pairs.push(sql`(${existingRecords[i].id}::int, ${url}::text)`);
                  }
                  await tx.execute(sql`
                    UPDATE ${measurementResults} AS mr
                    SET "imageUrl" = data.image_url
                    FROM (VALUES ${sql.join(pairs, sql`, `)}) AS data(id, image_url)
                    WHERE mr.id = data.id
                  `);
                }

                // Insert any extra AOI measurements beyond existing count
                if (pointsWithImages.length > existingRecords.length) {
                  const extraRecords = [];
                  for (let realIdx = existingRecords.length; realIdx < pointsWithImages.length; realIdx++) {
                    extraRecords.push(buildRecord(realIdx, pointsWithImages[realIdx] as any));
                  }
                  await tx.insert(measurementResults).values(extraRecords);
                }
              } else {
                // Existing inspection but no measurement records yet — insert all
                const measurementRecords = [];
                for (let idx = 0; idx < pointsWithImages.length; idx++) {
                  measurementRecords.push(buildRecord(idx, pointsWithImages[idx] as any));
                }
                await tx.insert(measurementResults).values(measurementRecords);
              }

              // W2-A / doc 35 D2 — spec-gate overall-NG promotion cho đường TÁI
              // DÙNG (giống reconcileInspectionOverallNG: chỉ lật header đang OK
              // sang NG; idempotent). Thăng hạng của đường board-MỚI đã chạy BÊN
              // TRONG persistInspectionAtomic (`promoteOverallToNg`) rồi.
              if (zipDowngradeCount > 0) {
                await tx
                  .update(productInspections)
                  .set({ overallResult: "NG", updatedAt: new Date() })
                  .where(and(
                    eq(productInspections.id, linkedInspectionId),
                    eq(productInspections.overallResult, "OK"),
                  ));
                console.warn(`[AOI commit] spec-gate downgraded ${zipDowngradeCount} point(s) → inspection ${linkedInspectionId} overall promoted to NG`);
              }
            }

            // Update package record → committed (atomic with the writes above)
            await tx
              .update(inspectionPackages)
              .set({
                status: "committed",
                inspectionId: linkedInspectionId || null,
                serialNumber: metaData?.serialNumber || null,
                productModel: metaData?.productModel || null,
                // ⚠ `inspection_packages` là bảng CÓ RLS (`app_tenant_allows("factoryCode", NULL)`):
                // một `factoryCode` NULL ở đây nghĩa là gói ảnh này hiện ra với MỌI nhà máy sau
                // mig 0327. Nên nó suy từ máy, không lấy từ `meta.json` — xem `macTenantCommit`.
                factoryCode: macTenantCommit.factoryCode ?? null,
                lineCode: macTenantCommit.lineCode ?? null,
                overallResult: finalOverallResult,
                totalPoints: calculatedSummary.totalPoints,
                okCount: calculatedSummary.ok,
                ngCount: calculatedSummary.ng,
                imageCount: imageFiles.length,
                inspectionTime: metaData?.inspectionTime
                  ? new Date(metaData.inspectionTime)
                  : metaData?.startedAt
                  ? new Date(metaData.startedAt)
                  : null,
                metaJson: metaData as any,
                committedAt: new Date(),
                uploadedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(inspectionPackages.id, pkg.id));
          });

          // Log: commit_success
          const commitDuration = Date.now() - commitStartTime;
          await logPackageActivity({
            packageDbId: pkg.id,
            packageId: pkg.packageId,
            machineId: machine.id,
            event: "commit_success",
            message: `Package committed successfully — ${imageFiles.length} images, ${metaData?.summary?.totalPoints || imageFiles.length} points${createdInspection ? ', inspection created' : ', linked to existing inspection'}`,
            source: "agent",
            durationMs: commitDuration,
            detail: `Serial: ${metaData?.serialNumber || 'N/A'}, Model: ${metaData?.productModel || 'N/A'}, Result: ${metaData?.summary?.ng && metaData.summary.ng > 0 ? 'NG' : 'OK'}, Inspection ID: ${linkedInspectionId || 'none'}${createdInspection ? ' (NEW)' : ' (EXISTING)'}`,
            metadata: {
              imageCount: imageFiles.length,
              serialNumber: metaData?.serialNumber,
              overallResult: metaData?.summary?.ng && metaData.summary.ng > 0 ? 'NG' : 'OK',
              linkedInspectionId,
              createdInspection,
            },
          });

          // Embed-at-ingest (Phase A2/A4): queue DINOv2 visual embeddings for this
          // inspection's images. Non-blocking + flag-gated (AOI_EMBEDDING_ENABLED);
          // never throws — must not affect commit success.
          try {
            if (linkedInspectionId) {
              const { enqueueAoiImageEmbedding } = await import("../services/aoiImageEmbeddingWorker");
              enqueueAoiImageEmbedding({
                inspectionId: linkedInspectionId,
                packageId: pkg.packageId,
                storageKey: pkg.storageKey ?? null,
              });
            }
          } catch (e) {
            console.warn("[aoiEmbed] enqueue failed:", (e as any)?.message ?? e);
          }

          // P0-D: realtime quality-gate evaluation. Runs AFTER the inspection +
          // measurement results are persisted. Fire-and-forget + fully guarded —
          // a gate evaluation failure must never affect commit success/idempotency
          // and does NOT touch P0-A's resolver/assert logic above.
          try {
            if (linkedInspectionId) {
              const { evaluateGatesAfterInspection } = await import("../services/qualityGateEvaluator");
              evaluateGatesAfterInspection({
                machineId: machine.id,
                inspectionId: linkedInspectionId,
                productModelId: resolvedProductModel?.id ?? null,
              }).catch((e2) => {
                console.error("[QualityGate] post-commit evaluation failed:", (e2 as any)?.message ?? e2);
              });
            }
          } catch (e) {
            console.error("[QualityGate] Failed to import qualityGateEvaluator:", (e as any)?.message ?? e);
          }

          // P2 WIP write-path: populate wip_tracking / station_dwell_time /
          // line_balance_metrics + bump the matching production order from this
          // AOI-package inspection. Fire-and-forget + fully guarded (the service
          // never throws) so it can never affect commit success/idempotency, and
          // does NOT touch the P0-A resolver/assert nor the P0-D gate logic above.
          try {
            if (linkedInspectionId && metaData?.serialNumber) {
              const { ingestInspectionToWip } = await import("../services/wipIngestService");
              ingestInspectionToWip({
                inspectionId: linkedInspectionId,
                serialNumber: metaData.serialNumber,
                lotNumber: metaData.batchNumber ?? null,
                overallResult: finalOverallResult,
                machineId: machine.id,
                stationId: machine.stationId ?? null,
                productModelId: resolvedProductModel?.id ?? null,
                productCode: metaData.productModel ?? null,
                cycleTimeSec: metaData.cycleTime ?? null,
              }).catch((e2) => {
                console.error("[wipIngest] post-commit ingest failed:", (e2 as any)?.message ?? e2);
              });
            }
          } catch (e) {
            console.error("[wipIngest] Failed to import wipIngestService:", (e as any)?.message ?? e);
          }

          // V1/V5/V18 (doc 27 Đợt 7.1 — W7-A): INLINE AI quality gate on the
          // package ingest path. Flag-gated (AI_INLINE_GATE_ENABLED, default
          // OFF) fire-and-forget via setImmediate — the commit ACK is never
          // delayed. Gate image = the first NG measurement's file from the
          // already-loaded ZIP (else the first with a file), extracted lazily
          // INSIDE the hook. Per-machine/product enablement, the AI-down
          // circuit breaker and the NEEDS_REVIEW fallback live inside
          // runInlineQualityGate (same write shape as the on-demand UI path).
          try {
            const inlineGateOn = (process.env.AI_INLINE_GATE_ENABLED ?? "false").toLowerCase() === "true";
            if (inlineGateOn && linkedInspectionId) {
              const withFile = normalizedMeasurements.filter((p) => p.fileName);
              const gatePoint = withFile.find((p) => p.result === "NG") ?? withFile[0];
              const gateFileName = gatePoint?.fileName;
              if (gateFileName) {
                const gateInspectionId = linkedInspectionId;
                const gateProductModelId = resolvedProductModel?.id ?? null;
                const gateMachineId = machine.id;
                setImmediate(() => {
                  import("../services/aiQualityGate")
                    .then(({ runInlineQualityGate }) =>
                      runInlineQualityGate({
                        inspectionId: gateInspectionId,
                        machineId: gateMachineId,
                        productModelId: gateProductModelId,
                        source: "aoi_package",
                        getImage: async () => {
                          const f = zip.file(`images/${gateFileName}`) || zip.file(gateFileName);
                          if (!f) return null;
                          return Buffer.from(await f.async("uint8array"));
                        },
                      }),
                    )
                    .catch((err) => {
                      console.error(
                        `[InlineGate] post-commit AI gate failed for package ${pkg.packageId}:`,
                        (err as Error)?.message ?? err,
                      );
                    });
                });
              }
            }
          } catch (e) {
            console.error("[InlineGate] failed to schedule inline gate:", (e as any)?.message ?? e);
          }

          return {
            success: true,
            alreadyCommitted: false,
            packageId: pkg.packageId,
            inspectionId: linkedInspectionId,
            imageCount: imageFiles.length,
            totalPoints: metaData?.summary?.totalPoints || imageFiles.length,
          };
        } catch (err: any) {
          // Log: commit_fail
          const commitDuration = Date.now() - commitStartTime;
          // ★★★ Pha 1D Task 5 (BG-52 ⛔) — phân loại VĨNH VIỄN/TẠM THỜI bằng
          // CHÍNH `isPermanentSubmitError` (server/services/inspection/
          // inspectionStoreForward.ts) — KHÔNG viết bản thứ hai. VĨNH VIỄN
          // (Postgres 22xxx/23xxx qua `.cause`, hoặc TRPCError NOT_FOUND/
          // FORBIDDEN/BAD_REQUEST/…) sẽ KHÔNG BAO GIỜ thành công khi thử lại
          // NGUYÊN VĂN cùng ZIP; đếm vào ngưỡng dead-letter dưới đây. TẠM THỜI
          // (mạng storage rớt, DB chớp nháy, lỗi JS chung không rõ lớp) KHÔNG
          // được đếm — gói vẫn `'failed'` và vẫn retry được vô hạn, đúng ý
          // chống-siết-quá (mệnh đề 4).
          const laLoiVinhVien = isPermanentSubmitError(err);
          await logPackageActivity({
            packageDbId: pkg.id,
            packageId: pkg.packageId,
            machineId: machine.id,
            event: "commit_fail",
            level: "error",
            message: `Commit failed: ${err.message}`,
            source: "server",
            durationMs: commitDuration,
            detail: err.stack || err.message,
            metadata: { errorCode: err.code, storageKey: pkg.storageKey, permanent: laLoiVinhVien },
          });

          // ★★★ Pha 1D Task 5 (BG-52 ⛔) — ĐẾM lỗi VĨNH VIỄN LIÊN TIẾP trên
          // CHÍNH hàng `inspection_packages`, qua nhật ký `package_activity_logs`
          // đã có sẵn (KHÔNG thêm cột đếm mới). Đã ghi entry `commit_fail` của
          // LƯỢT NÀY ở trên nên nó nằm TRONG tập đếm dưới đây. Quá ngưỡng ⇒
          // trạng thái CUỐI `'dead'` (migration 0344) thay vì `'failed'` (vẫn
          // retry được).
          let trangThaiMoi: "failed" | "dead" = "failed";
          let soLanLoiVinhVien = 0;
          if (laLoiVinhVien) {
            const lichSuLoi = await database
              .select({ metadata: packageActivityLogs.metadata })
              .from(packageActivityLogs)
              .where(and(
                eq(packageActivityLogs.packageDbId, pkg.id),
                eq(packageActivityLogs.event, "commit_fail"),
              ));
            soLanLoiVinhVien = demSoLoiVinhVienTuLichSu(lichSuLoi.map((r) => r.metadata));
            if (soLanLoiVinhVien >= nguongLoiVinhVienZip()) {
              trangThaiMoi = "dead";
            }
          }

          // Mark as failed/dead
          await database
            .update(inspectionPackages)
            .set({
              status: trangThaiMoi,
              // data-raw-ok: đây là object `.values()` của một INSERT — chuỗi này đi vào
              // BẢNG NHẬT KÝ, không rời máy chủ. Ở nhật ký kỹ thuật, chuỗi GỐC mới đúng:
              // nó là bằng chứng truy nguyên, không phải câu nói với người dùng.
              errorMessage:
                trangThaiMoi === "dead"
                  ? `HỎNG VĨNH VIỄN sau ${soLanLoiVinhVien} lần lỗi không thể phục hồi — KHÔNG retry nữa. Lỗi gần nhất: ${err.message}`
                  : err.message || "Failed to process package",
              updatedAt: new Date(),
            })
            .where(eq(inspectionPackages.id, pkg.id));

          if (trangThaiMoi === "dead") {
            throw appError(
              "UNPROCESSABLE_CONTENT",
              "OPERATION_FAILED",
              { operation: "processAoiPackage" },
              `Gói ${pkg.packageId} đã bị đánh dấu HỎNG VĨNH VIỄN sau ${soLanLoiVinhVien} lần lỗi không thể ` +
                `phục hồi (lỗi gần nhất: ${err.message}) — Agent KHÔNG được thử lại gói này nữa.`,
            );
          }

          throw appError(
            "INTERNAL_SERVER_ERROR",
            "OPERATION_FAILED",
            { operation: "processAoiPackage" },
            `Failed to process package: ${err.message}`,
          );
        }
      }

      // No storage key yet - mark as uploaded
      await database
        .update(inspectionPackages)
        .set({
          status: "uploaded",
          uploadedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(inspectionPackages.id, pkg.id));

      return { success: true, alreadyCommitted: false, packageId: pkg.packageId };
    }),

  /**
   * 3. List packages with filters
   */
  listPackages: protectedProcedure
    .input(z.object({
      page: z.number().default(1),
      pageSize: z.number().default(20),
      machineId: z.number().optional(),
      machineCode: z.string().optional(),
      serialNumber: z.string().optional(),
      productModel: z.string().optional(),
      status: z.enum(["pending", "uploading", "uploaded", "committed", "failed"]).optional(),
      overallResult: z.enum(["OK", "NG", "NTF"]).optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      const conditions: any[] = [];

      if (input.machineId) conditions.push(eq(inspectionPackages.machineId, input.machineId));
      if (input.machineCode) conditions.push(eq(inspectionPackages.machineCode, input.machineCode));
      if (input.serialNumber) conditions.push(like(inspectionPackages.serialNumber, `%${input.serialNumber}%`));
      if (input.productModel) conditions.push(eq(inspectionPackages.productModel, input.productModel));
      if (input.status) conditions.push(eq(inspectionPackages.status, input.status));
      if (input.overallResult) conditions.push(eq(inspectionPackages.overallResult, input.overallResult));
      if (input.dateFrom) conditions.push(gte(inspectionPackages.inspectionTime, new Date(input.dateFrom)));
      if (input.dateTo) conditions.push(lte(inspectionPackages.inspectionTime, new Date(input.dateTo)));

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const offset = (input.page - 1) * input.pageSize;

      const [data, totalResult] = await Promise.all([
        database
          .select({
            id: inspectionPackages.id,
            packageId: inspectionPackages.packageId,
            inspectionId: inspectionPackages.inspectionId,
            machineId: inspectionPackages.machineId,
            machineCode: inspectionPackages.machineCode,
            serialNumber: inspectionPackages.serialNumber,
            productModel: inspectionPackages.productModel,
            factoryCode: inspectionPackages.factoryCode,
            lineCode: inspectionPackages.lineCode,
            overallResult: inspectionPackages.overallResult,
            totalPoints: inspectionPackages.totalPoints,
            okCount: inspectionPackages.okCount,
            ngCount: inspectionPackages.ngCount,
            imageCount: inspectionPackages.imageCount,
            fileSizeBytes: inspectionPackages.fileSizeBytes,
            status: inspectionPackages.status,
            inspectionTime: inspectionPackages.inspectionTime,
            uploadedAt: inspectionPackages.uploadedAt,
            committedAt: inspectionPackages.committedAt,
            createdAt: inspectionPackages.createdAt,
          })
          .from(inspectionPackages)
          .where(where)
          .orderBy(desc(inspectionPackages.createdAt))
          .limit(input.pageSize)
          .offset(offset),
        database
          .select({ count: count() })
          .from(inspectionPackages)
          .where(where),
      ]);

      return {
        data,
        total: totalResult[0]?.count || 0,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil((totalResult[0]?.count || 0) / input.pageSize),
      };
    }),

  /**
   * 4. Get package detail
   */
  getPackage: protectedProcedure
    .input(z.object({
      packageId: z.string().optional(),
      id: z.number().optional(),
    }).refine(data => data.packageId || data.id, {
      message: "Either packageId or id must be provided",
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      const where = input.id
        ? eq(inspectionPackages.id, input.id)
        : eq(inspectionPackages.packageId, input.packageId!);

      const pkgs = await database
        .select()
        .from(inspectionPackages)
        .where(where)
        .limit(1);

      if (pkgs.length === 0) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "aoiPackage" }, "Package not found");
      }

      // Get images
      const images = await database
        .select()
        .from(packageImages)
        .where(eq(packageImages.packageId, pkgs[0].id));

      // Get machine info
      const machineInfo = await database
        .select({ code: machines.code, name: machines.name, machineType: machines.machineType })
        .from(machines)
        .where(eq(machines.id, pkgs[0].machineId))
        .limit(1);

      return {
        ...pkgs[0],
        images,
        machine: machineInfo[0] || null,
      };
    }),

  /**
   * 5. Get image from package (extract + cache + watermark)
   */
  getImage: protectedProcedure
    .input(z.object({
      packageId: z.string(),
      pointCode: z.string().optional(),
      fileName: z.string().optional(),
      // Image optimization params for slow networks
      quality: z.number().min(10).max(100).optional(), // JPEG quality (default: 85)
      maxWidth: z.number().min(50).max(4000).optional(), // Max width for resize
      thumbnail: z.boolean().optional(), // Quick thumbnail (320px, quality 60)
    }).refine(data => data.pointCode || data.fileName, {
      message: "Either pointCode or fileName must be provided",
    }))
    .query(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      // Find package
      const pkgs = await database
        .select()
        .from(inspectionPackages)
        .where(eq(inspectionPackages.packageId, input.packageId))
        .limit(1);

      if (pkgs.length === 0) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "aoiPackage" }, "Package not found");
      }

      const pkg = pkgs[0];

      // Determine file name
      let targetFileName = input.fileName;
      if (!targetFileName && input.pointCode) {
        const imgs = await database
          .select()
          .from(packageImages)
          .where(
            and(
              eq(packageImages.packageId, pkg.id),
              eq(packageImages.pointCode, input.pointCode)
            )
          )
          .limit(1);

        if (imgs.length > 0) {
          targetFileName = imgs[0].fileName;
        } else {
          targetFileName = `${input.pointCode}.jpg`;
        }
      }

      if (!targetFileName) {
        throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "fileName" }, "Cannot determine image file name");
      }

      // Build watermark lines
      const watermarkLines = [
        `SN: ${pkg.serialNumber || "N/A"}`,
        `Machine: ${pkg.machineCode || "N/A"}`,
        `Time: ${pkg.inspectionTime?.toISOString() || "N/A"}`,
        `User: ${ctx.user?.name || ctx.user?.username || "N/A"}`,
      ];

      const { buffer: rawBuffer, fromCache } = await getOrExtractImage(pkg, targetFileName, watermarkLines);

      // Apply image optimization (resize/compress) for slow networks
      let finalBuffer = rawBuffer;
      try {
        const sharp = await import("sharp");
        const isThumbnail = input.thumbnail;
        const targetWidth = isThumbnail ? 320 : input.maxWidth;
        const targetQuality = isThumbnail ? 60 : (input.quality || 85);

        if (targetWidth || targetQuality !== 85) {
          let pipeline = sharp.default(rawBuffer);
          if (targetWidth) {
            pipeline = pipeline.resize({ width: targetWidth, withoutEnlargement: true });
          }
          finalBuffer = await pipeline.jpeg({ quality: targetQuality }).toBuffer();
        }
      } catch {
        // sharp not available, serve original
      }

      // Return as base64 for tRPC transport
      return {
        imageBase64: finalBuffer.toString("base64"),
        mimeType: "image/jpeg",
        fileName: targetFileName,
        fromCache,
        packageId: input.packageId,
        pointCode: input.pointCode,
      };
    }),

  /**
   * 6. Get package images list
   */
  getPackageImages: protectedProcedure
    .input(z.object({
      packageId: z.string().optional(),
      id: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      let pkgId: number;
      if (input.id) {
        pkgId = input.id;
      } else if (input.packageId) {
        const pkgs = await database
          .select({ id: inspectionPackages.id })
          .from(inspectionPackages)
          .where(eq(inspectionPackages.packageId, input.packageId))
          .limit(1);

        if (pkgs.length === 0) {
          throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "aoiPackage" }, "Package not found");
        }
        pkgId = pkgs[0].id;
      } else {
        throw appError("BAD_REQUEST", "FIELD_REQUIRED", { field: "idOrPackageId" }, "id or packageId required");
      }

      return database
        .select()
        .from(packageImages)
        .where(eq(packageImages.packageId, pkgId));
    }),

  /**
   * 6b. Get activity logs for a package
   * Trả về nhật ký hoạt động theo timeline
   */
  getPackageLogs: protectedProcedure
    .input(z.object({
      packageId: z.string().optional(),
      id: z.number().optional(),
      limit: z.number().default(100),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      let pkgDbId: number;
      let pkgPackageId: string;

      if (input.id) {
        pkgDbId = input.id;
        const pkg = await database
          .select({ packageId: inspectionPackages.packageId })
          .from(inspectionPackages)
          .where(eq(inspectionPackages.id, input.id))
          .limit(1);
        pkgPackageId = pkg[0]?.packageId || "";
      } else if (input.packageId) {
        const pkgs = await database
          .select({ id: inspectionPackages.id, packageId: inspectionPackages.packageId })
          .from(inspectionPackages)
          .where(eq(inspectionPackages.packageId, input.packageId))
          .limit(1);

        if (pkgs.length === 0) {
          throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "aoiPackage" }, "Package not found");
        }
        pkgDbId = pkgs[0].id;
        pkgPackageId = pkgs[0].packageId;
      } else {
        throw appError("BAD_REQUEST", "FIELD_REQUIRED", { field: "idOrPackageId" }, "id or packageId required");
      }

      const logs = await database
        .select({
          id: packageActivityLogs.id,
          event: packageActivityLogs.event,
          level: packageActivityLogs.level,
          message: packageActivityLogs.message,
          detail: packageActivityLogs.detail,
          source: packageActivityLogs.source,
          userName: packageActivityLogs.userName,
          ipAddress: packageActivityLogs.ipAddress,
          durationMs: packageActivityLogs.durationMs,
          fileSizeBytes: packageActivityLogs.fileSizeBytes,
          metadata: packageActivityLogs.metadata,
          createdAt: packageActivityLogs.createdAt,
        })
        .from(packageActivityLogs)
        .where(eq(packageActivityLogs.packageDbId, pkgDbId))
        .orderBy(desc(packageActivityLogs.createdAt))
        .limit(input.limit);

      return {
        packageId: pkgPackageId,
        logs,
        total: logs.length,
      };
    }),

  /**
   * 7. Download original ZIP for audit
   */
  downloadZip: protectedProcedure
    .input(z.object({
      packageId: z.string(),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      const pkgs = await database
        .select()
        .from(inspectionPackages)
        .where(eq(inspectionPackages.packageId, input.packageId))
        .limit(1);

      if (pkgs.length === 0) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "aoiPackage" }, "Package not found");
      }

      const pkg = pkgs[0];
      if (!pkg.storageKey) {
        throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "downloadPackageZip" }, "ZIP file not available");
      }

      const { url } = await storageGet(pkg.storageKey);

      return {
        downloadUrl: url,
        fileName: `${pkg.packageId}.zip`,
        storageKey: pkg.storageKey,
      };
    }),

  /**
   * 8. Agent reports queue metrics
   */
  reportQueueMetrics: publicProcedure
    .input(z.object({
      apiKey: z.string().optional(),
      machineCode: z.string().optional(),
      queuedCount: z.number().default(0),
      uploadingCount: z.number().default(0),
      failedCount: z.number().default(0),
      completedCount: z.number().default(0),
      diskUsedBytes: z.number().optional(),
      diskFreeBytes: z.number().optional(),
      avgUploadLatencyMs: z.number().optional(),
      lastErrorMessage: z.string().optional(),
    }).refine(data => data.apiKey || data.machineCode, {
      message: "Either apiKey or machineCode must be provided",
    }))
    .mutation(async ({ input, ctx }) => {
      // ★★★ Task 10 — same fix as presign/commit: authenticateMachine instead of a
      // raw getMachineByApiKey/getMachineByCode resolve.
      const { machine } = await authenticateMachine({
        apiKey: input.apiKey,
        machineCode: input.machineCode,
        headerKey: machineHeaderKey(ctx),
        scope: "ingest:write",
        endpoint: "aoiPackage.reportQueueMetrics",
      });

      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      await database.insert(uploadQueueMetrics).values({
        machineId: machine.id,
        queuedCount: input.queuedCount,
        uploadingCount: input.uploadingCount,
        failedCount: input.failedCount,
        completedCount: input.completedCount,
        diskUsedBytes: input.diskUsedBytes || null,
        diskFreeBytes: input.diskFreeBytes || null,
        avgUploadLatencyMs: input.avgUploadLatencyMs || null,
        lastErrorMessage: input.lastErrorMessage || null,
        lastUploadAt: new Date(),
      });

      await db.updateMachineHeartbeat(machine.id);

      return { success: true };
    }),

  /**
   * 9. Get upload queue status per machine (observability)
   */
  getQueueStatus: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      // Get latest metric per machine
      const query = database
        .select({
          machineId: uploadQueueMetrics.machineId,
          queuedCount: uploadQueueMetrics.queuedCount,
          uploadingCount: uploadQueueMetrics.uploadingCount,
          failedCount: uploadQueueMetrics.failedCount,
          completedCount: uploadQueueMetrics.completedCount,
          diskUsedBytes: uploadQueueMetrics.diskUsedBytes,
          diskFreeBytes: uploadQueueMetrics.diskFreeBytes,
          avgUploadLatencyMs: uploadQueueMetrics.avgUploadLatencyMs,
          lastErrorMessage: uploadQueueMetrics.lastErrorMessage,
          recordedAt: uploadQueueMetrics.recordedAt,
        })
        .from(uploadQueueMetrics)
        .orderBy(desc(uploadQueueMetrics.recordedAt))
        .limit(input.machineId ? 1 : 50);

      if (input.machineId) {
        return query.where(eq(uploadQueueMetrics.machineId, input.machineId));
      }

      return query;
    }),

  /**
   * 10. Get upload statistics summary
   */
  getUploadStats: protectedProcedure
    .input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      const conditions: any[] = [];
      if (input.dateFrom) conditions.push(gte(inspectionPackages.createdAt, new Date(input.dateFrom)));
      if (input.dateTo) conditions.push(lte(inspectionPackages.createdAt, new Date(input.dateTo)));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const stats = await database
        .select({
          total: count(),
          committed: sql<number>`SUM(CASE WHEN status = 'committed' THEN 1 ELSE 0 END)::int`,
          failed: sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::int`,
          pending: sql<number>`SUM(CASE WHEN status IN ('pending', 'uploading', 'uploaded') THEN 1 ELSE 0 END)::int`,
          totalImages: sql<number>`SUM(COALESCE("imageCount", 0))::int`,
          totalSize: sql<number>`SUM(COALESCE("fileSizeBytes", 0))::bigint`,
          ngPackages: sql<number>`SUM(CASE WHEN "overallResult" = 'NG' THEN 1 ELSE 0 END)::int`,
        })
        .from(inspectionPackages)
        .where(where);

      // Per-machine breakdown
      const perMachine = await database
        .select({
          machineCode: inspectionPackages.machineCode,
          machineId: inspectionPackages.machineId,
          total: count(),
          committed: sql<number>`SUM(CASE WHEN status = 'committed' THEN 1 ELSE 0 END)::int`,
          failed: sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::int`,
        })
        .from(inspectionPackages)
        .where(where)
        .groupBy(inspectionPackages.machineCode, inspectionPackages.machineId);

      return {
        summary: stats[0] || { total: 0, committed: 0, failed: 0, pending: 0, totalImages: 0, totalSize: 0, ngPackages: 0 },
        perMachine,
      };
    }),
});
