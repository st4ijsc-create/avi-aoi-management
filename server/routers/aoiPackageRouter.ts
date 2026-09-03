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

import { z, ZodError } from "zod";
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
  packageActivityLogs,
  InsertProductInspection,
} from "../../drizzle/schema";
import JSZip from "jszip";
import fs from "fs";
import path from "path";
// BG-87 — băm sha256 THẬT trên byte nhận được (kiểm toàn vẹn ZIP + toàn vẹn
// từng ảnh), thay vì nhận trường rồi vứt (xem `tranByteGoiZip`/`commit` bên dưới).
import { createHash } from "node:crypto";
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
// Pha 1D Task 5 (BG-52 ⛔) — phân loại lỗi VĨNH VIỄN/TẠM THỜI cho chốt chặn retry
// vô hạn ở cửa ZIP (commit). DÙNG LẠI nguyên hàm đã có ở đường WAL inspection —
// KHÔNG viết bản thứ hai (đúng chỉ dẫn brief).
import { isPermanentSubmitError } from "../services/inspection/inspectionStoreForward";
// ════════════════════════════════════════════════════════════════════════════
// BG-85 (docs/superpowers/specs/2026-09-01-aoi-chuan-goi-anh.md) — MỘT hợp
// đồng, hai đường vận chuyển. `metaJsonSchema` (bên dưới) = `machineDataContractV2`
// + `images[]`, KHÔNG còn là một schema phẳng song song. Cửa ZIP dùng THẲNG
// `dichCayKetQua`/`laHinhDangCayV2` — CÙNG bộ dịch/vị từ đường trực tiếp v2.0
// (`server/routers/machineApiRouters.ts` submitInspectionTreeV2), KHÔNG viết
// bản chép tay thứ hai của luật cuộn/nhận-diện-hình-dạng.
// ════════════════════════════════════════════════════════════════════════════
import { machineDataContractV2, imageRefSchema, type MachineDataContractV2 } from "../contracts/machineDataContractV2";
import { laHinhDangCayV2 } from "../contracts/machineDataContract";
import { dichCayKetQua, type CayDaDich, type CaptureDaDich } from "../services/ingestCayKetQua";
// Khối B Task 4 (BG-92) — cổng spec cho đường CÂY v2, CÙNG hàm mà cửa trực tiếp dùng.
import { congSpecTuBanDay } from "../services/specGateCayV2";
// BG-97 — hàm THUẦN đưa chuỗi thời gian máy gửi về cùng khung với `changedAt`.
import { mocDoTuChuoi } from "../services/gioiHanLucDoCayV2";
import type { ResultVerdict } from "@shared/rollupVerdict";

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

/**
 * ★★★ BG-87 (docs/superpowers/specs/2026-09-01-aoi-chuan-goi-anh.md §5-6) —
 * TRẦN CỨNG `sizeBytes` phía máy chủ. NGUỒN CỦA CON SỐ — không phải một số
 * đẹp chọn riêng cho task này: nó LÀ giới hạn `express.raw({ limit })` mà
 * tuyến DUY NHẤT từng nhận byte ZIP thật từ Agent (`PUT
 * /api/aoi/upload/:packageId`, `server/_core/index.ts`) đã áp dụng SẴN —
 * `"200mb"`, một hằng số được CHỌN CÓ CHỦ ĐÍCH ở R-1 (doc 38, xem comment tại
 * `LARGE_BODY_LIMIT` cùng file) làm trần BỘ NHỚ chống memory-exhaustion DoS
 * (`express.raw()` giữ NGUYÊN body trong RAM trước khi handler chạy — 200MB
 * là con số đã định cỡ theo dung lượng máy chủ, không phải "nghe hợp lý").
 * BG-87 KHÔNG phát minh trần mới — nó RÚT con số ĐÃ CÓ THẬT này ra một hàm
 * dùng CHUNG, để `presign` (từ chối SỚM — trước khi Agent tốn một lượt tải
 * ZIP hàng trăm MB vô ích, mệnh đề 2) và `commit`/tuyến upload (đối chiếu
 * byte THẬT, mệnh đề 3) không thể trôi lệch khỏi con số tầng transport ĐANG
 * thực thi (`server/_core/index.ts` đổi từ chuỗi `"200mb"` hardcode SANG gọi
 * THẲNG hàm này — một nguồn, không hai hằng số tách rời).
 *
 * Env-tunable qua `AOI_PACKAGE_ZIP_MAX_BYTES` (byte) — cùng quy ước
 * `envInt()`/`nguongLoiVinhVienZip()` ở trên, để test hành vi "vượt trần"
 * KHÔNG cần cấp phát một buffer 200MB thật (hạ trần bằng ENV rồi dùng buffer
 * nhỏ — xem `aoiPackageBaLoToanVenBg87.test.ts`). RIÊNG cổng `.max()` TĨNH ở
 * `presignCoreObject.sizeBytes` đọc hàm này MỘT LẦN lúc module nạp (giới hạn
 * của Zod `.max()` — không lazy theo từng lượt parse); test hành vi trần ở
 * CỔNG ĐÓ vì vậy dùng THẲNG giá trị mặc định (`sizeBytes: tranByteGoiZip() +
 * 1` — presign chỉ nhận một SỐ, không cấp phát byte thật, nên 200MB+1 không
 * tốn bộ nhớ nào để kiểm).
 */
export function tranByteGoiZip(): number {
  return envInt("AOI_PACKAGE_ZIP_MAX_BYTES", 200 * 1024 * 1024);
}

/** Đếm THUẦN (không I/O) — tách riêng để test đơn vị không cần DB thật. */
export function demSoLoiVinhVienTuLichSu(lichSuMetadata: ReadonlyArray<unknown>): number {
  return lichSuMetadata.filter(
    (m) => m !== null && typeof m === "object" && (m as Record<string, unknown>).permanent === true,
  ).length;
}

/**
 * ★★★ BG-73 (Pha 1F Task 2 ⛔) — ZodError do LỆCH HÌNH DẠNG hợp đồng (thiếu
 * trường bắt buộc/sai kiểu) KHÔNG được đếm vào ngưỡng `'dead'` ở cửa ZIP.
 *
 * Mẫu `meta.json` THẬT của máy (`D:\SOURCES\AOIData\aoipackage-meta-sample.json`)
 * mang `images[]`, không có `measurements[]`/`points[]` — `metaJsonSchema.parse()`
 * ném `ZodError` MỘT issue duy nhất (`code:"invalid_type"`, thiếu trường bắt
 * buộc `measurements`, đã đo LIVE bằng `safeParse` — xem task-2-report.md).
 * TRƯỚC bản vá này, `isPermanentSubmitError` (BG-64) coi MỌI `ZodError` là
 * VĨNH VIỄN như nhau — đúng cho payload QUÁ CỠ (Postgres cũng sẽ `22001` nếu
 * `.max()` không chặn trước), nhưng SAI cho payload LỆCH HÌNH DẠNG: "thử lại
 * NGUYÊN VĂN không bao giờ thành công" vẫn đúng, nhưng lý do là HỢP ĐỒNG MÁY
 * CHỦ hẹp hơn máy thật — không phải "payload rác không sửa được". Một gói như
 * vậy chạm `'dead'` sau `nguongLoiVinhVienZip()` lượt rồi `presign`/`commit`/
 * `upload` (BG-65) đều khoá VĨNH VIỄN — không có đường về nào từ phía máy chủ,
 * DÙ server sau đó sửa `metaJsonSchema` cho đúng: `laGoiDaChet` chỉ đọc
 * `status`, không tự phục hồi khi hợp đồng đổi.
 *
 * Phân biệt theo `issue.code`: `"too_big"` (MỌI issue, một mình) là QUÁ CỠ —
 * GIỮ NGUYÊN đếm vào ngưỡng, đúng lý do BG-64. Bất kỳ issue nào KHÁC
 * (`invalid_type` thiếu trường/sai kiểu, `invalid_enum_value`,
 * `unrecognized_keys`, `invalid_union`, …) là LỆCH HÌNH DẠNG — KHÔNG đếm; gói
 * ở lại `'failed'`, `presign`/`commit` vẫn nhận retry vô hạn — đúng hành vi
 * TRƯỚC Pha 1E cho lớp lỗi này. Vận hành lấy gói này về bằng: (1) ZIP gốc +
 * `meta.json` THẬT vẫn còn nguyên trên storage (không mất byte nào vì gói
 * KHÔNG BAO GIỜ khoá); (2) khi kỹ sư server sửa `metaJsonSchema`/tầng ánh xạ để
 * nhận hình dạng máy thật (hướng (a) trong task-2-brief.md — đổi hợp đồng,
 * CHƯA làm ở bản vá này), một lượt `commit` MỚI trên CÙNG `packageId` (không
 * bị khoá vì chưa từng `'dead'`) sẽ parse thành công và chuyển `'committed'` —
 * không cần thao tác hồi sinh thủ công nào trên hàng DB.
 *
 * ⚠ KHÔNG đổi `isPermanentSubmitError` DÙNG CHUNG (`inspectionStoreForward.ts`)
 * — hàm đó còn phục vụ WAL replay của `machineApiRouters.ts` (v1.x, nhiều chục
 * điểm gọi) VÀ `processStoreForward.ts`, nơi "ZodError = vĩnh viễn" vẫn ĐÚNG
 * (đóng đúng lớp lỗi BG-64: một payload không parse được không bao giờ tự sửa
 * qua replay NGUYÊN VĂN). Đây là MỘT lớp HẸP HƠN, CHỈ áp dụng cho ngưỡng
 * `'dead'` của cửa ZIP — nơi DUY NHẤT một schema hẹp hơn máy thật có thể được
 * server sửa VÀ gói cũ hưởng lợi mà không cần gửi lại (Agent không cần biết).
 */
export function laLoiVinhVienDemVaoNguongDeadZip(err: unknown): boolean {
  if (err instanceof ZodError) {
    return err.issues.every((issue) => issue.code === "too_big");
  }
  return isPermanentSubmitError(err);
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
  // BG-87 (docs/superpowers/specs/2026-09-01-aoi-chuan-goi-anh.md §3) — MỘT
  // đường dẫn duy nhất: `images/<fileName>`. TRƯỚC bản vá này, `zip.file(fileName)`
  // là một cửa THỨ HAI để tìm CÙNG một ảnh — hai đường tìm cho cùng một tệp
  // nghĩa là hành vi phụ thuộc NỘI DUNG GÓI (ảnh nằm ở gốc hay ở images/), khó
  // chẩn đoán khi lệch. Đo trước khi bỏ (task-2-report.md): 296 gói `committed`
  // trong `aoi_management_test` — 0 gói dựng qua test hiện có phụ thuộc
  // fallback (mọi `zip.file(` ghi ảnh trong repo đều dưới `images/`, đối
  // chứng bằng grep toàn repo).
  const imagePath = `images/${fileName}`;
  const imageFile = zip.file(imagePath);

  if (!imageFile) {
    throw appError(
      "NOT_FOUND",
      "ENTITY_NOT_FOUND",
      { entity: "image" },
      `Không tìm thấy ảnh "${fileName}" trong gói ZIP — đường mong đợi DUY NHẤT là "${imagePath}" (không còn tìm ở gốc gói).`,
    );
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
// Meta.json schema — BG-85: MỘT hợp đồng, hai đường vận chuyển
// (docs/superpowers/specs/2026-09-01-aoi-chuan-goi-anh.md §3-4)
// ============================================================
/**
 * ★★★ BG-85 — TRƯỚC bản vá này, `metaJsonSchema` là một schema PHẲNG viết tay
 * SONG SONG với `machineDataContractV2` (đường trực tiếp v2.0) — hai hợp đồng
 * cho CÙNG một khái niệm ("kết quả kiểm tra một sản phẩm"), lệch hình dạng
 * hoàn toàn (phẳng `measurements[]`/`points[]` ở đây, cây
 * `surfaces[].positions[].captures[].components[]` ở kia). Cái giá của việc
 * để hai hợp đồng tách rời đã trả qua bảy lượt review: `inferAoiOverallResult`
 * là bản logic cuộn verdict CHÉP TAY THỨ HAI (BG-42/BG-53), cửa ZIP cuộn
 * verdict từ `summary` MÁY TỰ KHAI thay vì dữ liệu (BG-68), `calculatedSummary`
 * (`ngCount`) và `overallResult` cùng hàng nhưng hai nguồn (BG-76).
 *
 * Quyết định chủ dự án (spec trên, §1): `meta.json` trong gói ZIP KHÔNG còn là
 * một hợp đồng riêng — nó là CHÍNH `machineDataContractV2` (payload kết quả
 * v2.0 mà đường trực tiếp `submitInspection` nhận), cộng thêm ĐÚNG MỘT trường
 * `images[]` (tham chiếu ảnh, `captureId` là khoá join sang
 * `surfaces[].positions[].captures[].captureId` của CHÍNH hợp đồng này).
 *
 * `.extend()` TRÊN CHÍNH `machineDataContractV2` — KHÔNG chép trường: chép là
 * DỰNG LẠI đúng hợp đồng song song mà bản vá này sinh ra để xoá.
 *
 * ⚠ HỆ QUẢ DI TRÚ (đo baseline THẬT trên mẫu máy hôm nay,
 * `D:\SOURCES\AOIData\aoipackage-meta-sample.json`, TRƯỚC bản vá này):
 *   - `metaJsonSchema` CŨ (phẳng): `safeParse` = false — thiếu `measurements`.
 *   - `machineDataContractV2`: `safeParse` = false — thiếu `ntf`/`summary`/`surfaces`.
 * Mẫu máy thật KHÔNG khớp CẢ HAI hợp đồng hôm nay (nó chỉ có `images[]`, không
 * hề có cây) — hợp nhất KHÔNG làm nó tệ hơn (vẫn `'failed'`, retry được, không
 * khoá `'dead'` — xem `laLoiVinhVienDemVaoNguongDeadZip`), và mở đúng MỘT
 * đường mới: khi Agent (hoặc một phiên bản firmware sau này) gửi ĐỦ cây +
 * `images[]`, gói ZIP giờ commit được qua CÙNG một đường `dichCayKetQua` mà
 * `submitInspection` (đường trực tiếp) đang dùng — KHÔNG còn hai luật cuộn.
 *
 * Hình dạng PHẲNG cũ (`measurements[]`/`points[]`, không `surfaces`) — hình
 * dạng đã sinh ra 262 gói `committed` hiện có — cũng KHÔNG còn parse được qua
 * schema hợp nhất này (thiếu `surfaces`/`summary`/`identity`/`ntf` bắt buộc) ⇒
 * cùng số phận: `'failed'`, retry được, KHÔNG khoá `'dead'` (Bước 6, đường di
 * trú — nhận diện hình dạng bằng `laHinhDangCayV2`, KHÔNG thêm vị từ thứ hai).
 * Gói `committed` CŨ trong DB KHÔNG bị đụng tới (`commit` chỉ ghi khi PARSE
 * MỚI thành công — không có tác vụ nào chạy lại trên hàng đã có).
 */
export const metaJsonSchema = machineDataContractV2.extend({
  images: z.array(imageRefSchema).optional(),
});

export type MetaJson = z.infer<typeof metaJsonSchema>;

// ============================================================
// BG-85 — bốn nhóm ĐẾM ĐƯỢC TỪ CÂY, dùng để đối chiếu với `summary` MÁY TỰ
// KHAI (bất biến 3, §4 chuẩn gói ảnh) — KHÔNG dùng để quyết định verdict.
// ============================================================
type BonNhom = MachineDataContractV2["summary"];

/**
 * ★★★ N-7 (re-review lượt 8) — MỘT ĐỊNH NGHĨA "ntf" CHO CẢ BỐN CẤP.
 *
 * TRƯỚC bản vá có HAI hàm đếm với HAI định nghĩa khác nhau cho cùng chữ "ntf",
 * chạy TRONG CÙNG một phép cuộn:
 *   · cấp component: đếm **cờ `ntf`** của nút.
 *   · surfaces/positions/captures: đếm theo `rolledResult`, mà `rolledResult`
 *     trên đường v2 KHÔNG BAO GIỜ là `"NTF"` — hợp đồng máy khai
 *     `result: z.enum(["OK","NG"])` ở MỌI cấp, và `rollupVerdict` chỉ trả
 *     `"NTF"` khi một CON có `result === "NTF"`. ⇒ nhánh `ntf` ở ba cấp trên là
 *     **mã CHẾT**: chúng KHÔNG THỂ đếm ra `ntf > 0` dù cây nói gì.
 * Hệ quả đo được: một máy khai `summary` ĐÚNG THEO CHÍNH CÂY NÓ GỬI vẫn bị
 * `coLechSummary` trả `true` ⇒ `summaryDeclaredMismatch = true` cho **100%**
 * gói NTF — cờ sinh ra để soi đúng loại bo đáng để ý nhất thành nhiễu 100%
 * trên chính loại bo đó.
 *
 * VÌ SAO KHÔNG chọn "bỏ `ntf` khỏi phép so cho 3 cấp trên": phép đo bác bỏ.
 * Lời khai NTF trung thực CHUẨN của dự án (`BANG_HINH_DANG`, hình dạng
 * `ntfThatTuCoNguoiXacNhanChuaXacNhan`) khai `{total:1, pass:0, ng:0, ntf:1}`
 * ở CẢ BỐN nhóm; số đếm cũ cho ba cấp trên là `pass:1, ntf:0` ⇒ bỏ riêng `ntf`
 * khỏi phép so vẫn còn **`pass` lệch** ⇒ cờ vẫn nổ. Đóng bằng cách đó phải bỏ
 * luôn `pass`, tức moi ruột bộ dò.
 *
 * VÌ SAO đếm CỜ là đúng thứ để đếm: máy có cờ `Ntf` ở MỌI cấp
 * (`HookPosition.Ntf`, `HookCapture.Ntf`, `HookComponent.Ntf`; `surfaces[].ntf`
 * là worst-case rollup của generator — `D:\SOURCES\AOIData\
 * sync-json-samples-reference.md`), và `summary` của nó là *"tự tính
 * (generator) — Đếm total/pass/ng/ntf **từng cấp**"*. Máy đếm cờ từng cấp; phép
 * so của máy chủ nay đếm CÙNG thứ đó. Đọc `ntf` KHAI TẠI NÚT (không phải
 * `rolledNtf`) là cố ý: `summary` là lời khai của máy về CHÍNH cây nó gửi, nên
 * bộ dò phải so với cây đó chứ không với một giá trị máy chủ tự suy thêm.
 *
 * ⚠ Ưu tiên cờ `ntf` TRƯỚC `NG` — giữ NGUYÊN thứ tự `demNhomComponent` cũ đã
 * dùng ở lá (cùng ưu tiên `dichComponent` dùng khi gán `ntfSource`). ĐÂY LÀ
 * PHÉP ĐẾM ĐỂ ĐỐI CHIẾU LỜI KHAI, KHÔNG phải luật cuộn verdict: luật cuộn
 * (NG > NTF > OK, `rollupVerdict`/`verdictLuuTru`) không bị hàm này đụng tới, và
 * `overallResult` ghi xuống DB vẫn LUÔN là `cay.verdictLuuTru` (bất biến 3).
 */
function demNhomTheoCo(nodes: ReadonlyArray<{ ntf: boolean; ketQua: ResultVerdict }>): BonNhom["surfaces"] {
  let pass = 0, ng = 0, ntf = 0;
  for (const n of nodes) {
    if (n.ntf) ntf++;
    else if (n.ketQua === "NG") ng++;
    else pass++;
  }
  return { total: nodes.length, pass, ng, ntf };
}

/**
 * Đếm bốn nhóm (surfaces/positions/captures/components) THẬT SỰ có trong cây
 * đã dịch — hàm THUẦN, không I/O. Dùng để đối chiếu với `metaData.summary`
 * (lời khai của máy) — KHÔNG dùng để quyết định verdict (đó luôn là
 * `cay.verdictLuuTru`, bất biến 3).
 */
export function demBonNhomTuCay(cay: CayDaDich): BonNhom {
  const positions = cay.surfaces.flatMap((s) => s.positions);
  const captures = positions.flatMap((p) => p.captures);
  const components = captures.flatMap((c) => c.components);
  // N-7 — MỘT hàm, bốn cấp. Ba cấp trên lấy `rolledResult` (kết quả ĐÃ CUỘN của
  // nút) làm phán quyết; lá không có gì để cuộn nên lấy `result` của chính nó.
  return {
    surfaces: demNhomTheoCo(cay.surfaces.map((s) => ({ ntf: s.ntf, ketQua: s.rolledResult }))),
    positions: demNhomTheoCo(positions.map((p) => ({ ntf: p.ntf, ketQua: p.rolledResult }))),
    captures: demNhomTheoCo(captures.map((c) => ({ ntf: c.ntf, ketQua: c.rolledResult }))),
    components: demNhomTheoCo(components.map((c) => ({ ntf: c.ntf, ketQua: c.result }))),
  };
}

/**
 * true = CÓ lệch giữa `summary` máy khai và số đếm THẬT từ cây, ở ÍT NHẤT một
 * trong bốn nhóm/bốn chỉ số (total/pass/ng/ntf). Dùng để GẮN CỜ (log cảnh báo),
 * KHÔNG dùng để từ chối gói — bất biến 3 chỉ đòi verdict KHÔNG được lấy từ
 * `summary`, không đòi `summary` phải khớp tuyệt đối (máy có thể tính sai mà
 * vẫn là một gói hợp lệ về mặt cấu trúc).
 */
export function coLechSummary(khai: BonNhom, tinhDuoc: BonNhom): boolean {
  const nhom: Array<keyof BonNhom> = ["surfaces", "positions", "captures", "components"];
  return nhom.some((n) => {
    const a = khai[n];
    const b = tinhDuoc[n];
    return a.total !== b.total || a.pass !== b.pass || a.ng !== b.ng || a.ntf !== b.ntf;
  });
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
 * `authenticateMachine`, không INSERT).
 *
 * ★★★ BG-87 (2026-09-02) — CẬP NHẬT lời khai `sha256`/`sizeBytes` ở trên: TRƯỚC
 * bản vá này cả hai đúng là "khai báo nhưng không đọc ở đâu" (nhận rồi vứt) —
 * SAU bản vá, KHÔNG còn đúng cho `sha256` (đọc/so ở `commit`, xem docblock tại
 * `commit`) và KHÔNG còn đúng cho `sizeBytes` (`.max()` dưới đây + đối chiếu ở
 * `commit`). Chi tiết từng trường:
 *
 * `sha256` — TUỲ CHỌN (KHÔNG bắt buộc), quyết định có chủ đích: (1) hợp đồng
 * `imageRefSchema.sha256` (machineDataContractV2.ts) cũng khai `sha256?` —
 * kiểu tuỳ chọn đã là quyết định của chủ dự án, không phải chỗ này tự chọn
 * lại; (2) Agent/firmware ĐANG chạy hôm nay không gửi trường này (đo:
 * 296 gói `committed` trong `aoi_management_test`, 0 gói có `sha256` — xem
 * task-2-report.md) — bắt buộc NGAY sẽ từ chối 100% lưu lượng thật với 0 dữ
 * liệu đếm-được về tốc độ nâng cấp Agent, ngược nguyên tắc di trú 3 giai đoạn
 * của chính chuẩn này (§7: "cắt trước khi cái thay thế sẵn sàng là làm hệ
 * thống tệ hơn", Đ-20). ⚠ TUỲ CHỌN KHÔNG ĐƯỢC tạo cảm giác "đã kiểm": một gói
 * KHÔNG gửi `sha256` không hề an toàn hơn/kém hơn một gói gửi SAI — cả hai
 * đều không có bảo đảm toàn vẹn từ trường này; chỉ gói gửi ĐÚNG mới có bảo
 * đảm THẬT. `.max(128)` dư sức SHA-256 hex thật (64 ký tự), chặn payload rác.
 *
 * ★★★ I-7 (review lượt 8) — `sha256` khai Ở ĐÂY GIỜ ĐƯỢC KIỂM THẬT. TRƯỚC bản
 * vá này nó "nhận rồi vứt" (không lưu, không so, không cả log) — đúng cái bẫy
 * §6 chuẩn gói ảnh TỰ GỌI TÊN: *"trường trông như bảo đảm toàn vẹn mà không
 * phải còn nguy hiểm hơn không có trường"* — và tệ hơn, `presign` là nơi DUY
 * NHẤT hai tài liệu hướng máy (`docs/CSHARP_CLIENT_UPLOAD_GUIDE.md` và tab
 * Presign của `client/src/components/apiDocs/AoiPackageSection.tsx`, chỗ còn
 * gọi thẳng nó là "integrity check") dạy đặt nó ⇒ một Agent làm ĐÚNG tài liệu
 * công bố nhận 0 kiểm toàn vẹn trong khi tin rằng mình có.
 * KHÔNG kiểm được NGAY tại đây (byte ZIP chưa tồn tại ở bước presign), nên lời
 * khai được LƯU vào `inspection_packages."sha256Presign"` (migration 0346,
 * chuẩn hoá `.trim().toLowerCase()`) rồi đối chiếu ở đúng khoảnh khắc byte
 * thật xuất hiện:
 *   · `PUT /api/aoi/upload/:packageId` (server/_core/index.ts) — lượt tải ĐẦU
 *     sau presign (`!isRetry`, CÙNG điều kiện đã dùng cho `sizeBytes`);
 *   · `commit` — backstop cho gói `status==='pending'` (đường ghi thẳng vào
 *     storage, không đi qua Express).
 * Agent vẫn được khai LẠI `sha256` ở `commit` — trường độc lập, kiểm độc lập.
 * ⚠ Một lượt `presign` LẶP cho gói đã tồn tại KHÔNG cập nhật `sha256Presign`
 * (nhánh trả-về-sớm bên dưới) — CÙNG hành vi `fileSizeBytes` vốn có, và cũng
 * là lý do hai phép đối chiếu chỉ chạy ở lượt tải ĐẦU: một retry HỢP LỆ (sửa
 * ZIP rồi tải lại) đổi cả kích thước lẫn digest một cách CHÍNH ĐÁNG.
 *
 * `sizeBytes` — TRẦN CỨNG `tranByteGoiZip()` (xem docblock hàm đó ngay phía
 * trên `demSoLoiVinhVienTuLichSu`): từ chối NGAY ở đây nếu Agent khai một con
 * số vượt trần — TRƯỚC KHI Agent tốn một lượt tải ZIP (có thể hàng trăm MB)
 * vô ích cho một gói chắc chắn sẽ bị `express.raw` (server/_core/index.ts)
 * 413 sau đó. `.int().positive()` — byte không thể âm/lẻ.
 */
export const presignCoreObject = z.object({
  apiKey: z.string().max(256).optional(),
  machineCode: z.string().max(50).optional(),
  inspectionId: z.string().max(100), // From agent (unique ID) — inspection_packages.packageId varchar(100)
  sizeBytes: z.number().int().positive().max(tranByteGoiZip()),
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
        // ★★★ N-1 (re-review lượt 8 ⛔) — LỜI KHAI TOÀN VẸN MỚI NHẤT THẮNG,
        // CHỪNG NÀO BYTE CHƯA ĐƯỢC NHẬN.
        //
        // TRƯỚC bản vá này nhánh "gói đã tồn tại" trả presign cũ mà KHÔNG đụng
        // `sha256Presign`/`fileSizeBytes` ⇒ chuỗi khoá VĨNH VIỄN một gói TỐT:
        //   presign(sha=A) → upload hỏng/chưa chạy (`status` VẪN 'pending')
        //   → Agent dựng lại ZIP (cùng nội dung, CÙNG `sizeBytes`, khác byte vì
        //     mtime nằm trong local header) ⇒ digest B
        //   → presign(sha=B) KHÔNG ghi gì → byte-của-B tới cửa: `isRetry` =
        //     (`status==='uploaded'||'uploading'`) = FALSE ⇒ cổng I-7 chạy ⇒
        //     B ≠ A ⇒ 400 ⇒ `status` VẪN 'pending' ⇒ lặp VÔ HẠN.
        // Miễn trừ `!isRetry` của I-7 được viết cho "một RETRY hợp lệ đổi digest
        // một cách chính đáng", nhưng nó khoá vào `'uploaded'` — TRẠNG THÁI MÀ
        // MỘT LẦN DỰNG LẠI *TRƯỚC* UPLOAD KHÔNG BAO GIỜ CHẠM TỚI. Thông điệp
        // lỗi hai cửa còn kê đơn "tải lại ZIP": tải lại bao nhiêu lần cũng 400,
        // chỉ một `packageId` MỚI mới thoát ⇒ đây là bo TỐT bị CHẶN.
        //
        // Bán kính lúc vá = 0 (`sha256Presign IS NOT NULL` = 0/0 ở
        // `aoi_management`, 0/296 ở `aoi_management_test`) — nhưng tài liệu I-2
        // vừa DẠY MỌI AGENT gửi `sha256` ở presign, nên lỗi tự lên đạn đúng lúc
        // bên tích hợp làm theo tài liệu.
        //
        // Phạm vi làm mới: gói CHƯA `'uploaded'` (nhánh `'committed'` đã trả về
        // ở trên, `'dead'` đã ném ở trên) — tức `'pending' | 'uploading' |
        // 'failed'`. Gói `'uploaded'` GIỮ NGUYÊN hành vi bảo vệ: ở đó byte THẬT
        // đã tới và đã được đối chiếu bằng chính digest này; một lời khai
        // presign MUỘN không được ghi đè lên bằng chứng nghiệm thu đó.
        // ⚠ Không khai `sha256` ở lượt gọi này ⇒ cột về NULL. Đó là CỐ Ý và
        // KHÔNG hạ mức bảo đảm: trường này 100% do Agent tự khai, nên một Agent
        // muốn qua cổng chỉ cần khai một digest KHỚP — giữ lại một lời khai CŨ
        // mà Agent đã bỏ không mua thêm được bảo đảm nào, chỉ mua thêm một cái
        // bẫy khoá vĩnh viễn.
        if (pkg.status !== "uploaded") {
          const shaMoi = input.sha256?.trim().toLowerCase() || null;
          await database
            .update(inspectionPackages)
            .set({ sha256Presign: shaMoi, fileSizeBytes: input.sizeBytes, updatedAt: new Date() })
            .where(eq(inspectionPackages.id, pkg.id));
          await logPackageActivity({
            packageDbId: pkg.id,
            packageId: pkg.packageId,
            machineId: machine.id,
            event: "presign",
            message: `Presign gọi lại trên gói chưa upload (${pkg.status}) — làm mới lời khai toàn vẹn`,
            source: "agent",
            detail: `sha256Presign: ${pkg.sha256Presign ?? "NULL"} → ${shaMoi ?? "NULL"}, fileSizeBytes: ${pkg.fileSizeBytes ?? "NULL"} → ${input.sizeBytes}`,
            fileSizeBytes: input.sizeBytes,
            metadata: {
              lamMoiLoiKhaiPresign: true,
              trangThai: pkg.status,
              sha256PresignCu: pkg.sha256Presign ?? null,
              sha256PresignMoi: shaMoi,
              fileSizeBytesCu: pkg.fileSizeBytes ?? null,
              fileSizeBytesMoi: input.sizeBytes,
            },
          });
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
        // I-7 — LƯU lời khai `sha256` để đối chiếu khi byte thật xuất hiện
        // (xem docblock `presignCoreObject`). Chuẩn hoá về chữ thường đã trim
        // NGAY tại chỗ ghi: Agent .NET (`Convert.ToHexString`) trả HOA, digest
        // máy chủ luôn thường — hoa/thường KHÔNG phải "lệch nội dung", và
        // chuẩn hoá một lần ở đây tốt hơn nhớ chuẩn hoá ở hai chỗ so.
        sha256Presign: input.sha256?.trim().toLowerCase() || null,
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
      // BG-87 — TUỲ CHỌN, ĐỐI CHIẾU THẬT khi có mặt (xem khối kiểm ngay sau khi
      // `zipBuffer` được tải về, trong thân mutation bên dưới): so với byte ZIP
      // THẬT vừa tải, KHÔNG PHẢI chỉ nhận rồi bỏ như trước bản vá này.
      sizeBytes: z.number().int().positive().max(tranByteGoiZip()).optional(),
      // BG-87 — TUỲ CHỌN, KIỂM THẬT khi có mặt: băm `zipBuffer` bằng sha256, so
      // với chuỗi Agent khai — lệch ⇒ từ chối cả gói (mệnh đề 1). `.max(128)`
      // cùng con số presignCoreObject.sha256 (dư sức hex 64 ký tự thật).
      sha256: z.string().max(128).optional(),
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

          // ════════════════════════════════════════════════════════════════
          // BG-87 (docs/superpowers/specs/2026-09-01-aoi-chuan-goi-anh.md §6)
          // — BA lỗ toàn vẹn/kích thước ĐÓNG Ở ĐÂY, TRÊN `zipBuffer` — byte
          // ZIP THẬT vừa tải về ở trên, KHÔNG phải con số Agent tự khai.
          // ════════════════════════════════════════════════════════════════

          // (1) Trần cứng — BACKSTOP trên byte THẬT. Cùng con số
          // `express.raw({ limit })` của tuyến PUT /api/aoi/upload/:packageId
          // (server/_core/index.ts) — xem docblock `tranByteGoiZip()`. Tuyến
          // đó ĐÃ chặn ở tầng transport TRƯỚC KHI byte tới đây trong vận hành
          // bình thường; kiểm lại ở đây là backstop cho đường ghi thẳng vào
          // storage không đi qua Express (vd. thao tác vận hành/khôi phục).
          const tranByte = tranByteGoiZip();
          if (zipBuffer.length > tranByte) {
            throw appError(
              "PAYLOAD_TOO_LARGE",
              "INVALID_VALUE",
              { field: "sizeBytes" },
              `TỪ CHỐI gói: ZIP nhận được ${zipBuffer.length} byte vượt trần cứng ${tranByte} byte ` +
                `(= giới hạn express.raw của tuyến upload, server/_core/index.ts) — không commit.`,
            );
          }

          // (2) `sizeBytes` ĐỐI CHIẾU byte THẬT — hai nguồn khai độc lập, kiểm
          // CẢ HAI nếu có mặt (không còn nhận rồi vứt như trước bản vá này):
          //   (2a) `input.sizeBytes` — Agent khai LẠI ngay tại lượt gọi
          //        `commit` này.
          if (input.sizeBytes != null && input.sizeBytes !== zipBuffer.length) {
            throw appError(
              "BAD_REQUEST",
              "INVALID_VALUE",
              { field: "sizeBytes" },
              `TỪ CHỐI gói: sizeBytes Agent khai ở commit (${input.sizeBytes} byte) không khớp byte ZIP ` +
                `THẬT nhận được (${zipBuffer.length} byte).`,
            );
          }
          //   (2b) `pkg.fileSizeBytes` — con số Agent khai ở BƯỚC PRESIGN, lưu
          //        trên hàng — CHỈ đối chiếu khi gói CHƯA từng đi qua tuyến
          //        upload thật (`status==='pending'`): SAU khi tuyến upload
          //        (server/_core/index.ts, cùng BG-87) đã ghi đè cột này bằng
          //        byte THẬT của lần upload đó, một lượt `commit` gọi lại
          //        không còn đối chiếu "lời khai gốc" nữa — nó luôn khớp
          //        chính byte vừa tải nên phép so ở đây sẽ không phát hiện
          //        được gì (không phải lỗ mới — gói ĐÃ qua tuyến upload nghĩa
          //        là byte THẬT đã được đối chiếu Ở ĐÓ rồi, hoặc gói đã bị từ
          //        chối tại đó).
          if (
            pkg.status === "pending" &&
            pkg.fileSizeBytes != null &&
            Number(pkg.fileSizeBytes) !== zipBuffer.length
          ) {
            throw appError(
              "BAD_REQUEST",
              "INVALID_VALUE",
              { field: "sizeBytes" },
              `TỪ CHỐI gói: sizeBytes Agent khai ở presign (${pkg.fileSizeBytes} byte) không khớp byte ZIP ` +
                `THẬT nhận được (${zipBuffer.length} byte).`,
            );
          }

          // (3) `sha256` KIỂM THẬT — TUỲ CHỌN (xem docblock `presignCoreObject`/
          // `commit` input cho lý do bắt buộc/tuỳ chọn): nếu Agent gửi, băm
          // NGUYÊN VĂN byte `zipBuffer` vừa tải về và so — lệch ⇒ từ chối.
          // KHÔNG gửi ⇒ KHÔNG kiểm được gì (một gói không khai sha256 không hề
          // "kém an toàn hơn" một gói khai SAI — cả hai đều không có bảo đảm
          // toàn vẹn từ trường này; khác biệt là gói khai ĐÚNG mới có bảo đảm
          // THẬT). So sánh KHÔNG phân biệt hoa/thường + `.trim()` — digest hex
          // phía máy chủ luôn chữ thường, nhưng Agent .NET (`Convert.
          // ToHexString`) mặc định trả HOA — không được coi hoa/thường khác
          // nhau là "lệch nội dung".
          // ★★★ I-7 (review lượt 8) — HAI lời khai `sha256` độc lập, kiểm CẢ
          // HAI nếu có mặt. Tính MỘT LẦN digest thật rồi so với từng lời khai.
          const shaZipThuc =
            input.sha256 || pkg.sha256Presign
              ? createHash("sha256").update(zipBuffer).digest("hex").toLowerCase()
              : null;

          //   (3a) `input.sha256` — Agent khai LẠI ngay tại lượt `commit` này.
          if (input.sha256 && shaZipThuc !== input.sha256.trim().toLowerCase()) {
            throw appError(
              "BAD_REQUEST",
              "INVALID_VALUE",
              { field: "sha256" },
              `TỪ CHỐI gói: sha256 Agent khai ("${input.sha256}") không khớp sha256 THẬT của byte ZIP ` +
                `nhận được ("${shaZipThuc}") — dữ liệu có thể đã hỏng khi truyền/lưu. Tải lại ZIP và commit lại.`,
            );
          }

          //   (3b) `pkg.sha256Presign` — lời khai từ BƯỚC PRESIGN, lưu trên
          //   hàng (migration 0346). Đây là nơi DUY NHẤT hai tài liệu hướng máy
          //   dạy đặt `sha256`, nên không kiểm nó = để bảo đảm toàn vẹn của
          //   phần lớn Agent thành GIẢ. Kiểm CHỈ khi gói CHƯA từng đi qua tuyến
          //   upload (`status==='pending'`) — hoàn toàn cùng lý do (2b) ở trên:
          //   tuyến `PUT /api/aoi/upload/:packageId` đã đối chiếu Ở ĐÓ cho lượt
          //   tải ĐẦU, còn sau một RETRY hợp lệ (sửa ZIP rồi tải lại) thì digest
          //   presign cũ đã lỗi thời một cách chính đáng — so tiếp sẽ từ chối
          //   NHẦM. Nhánh này vì thế phủ đúng đường ghi thẳng vào storage,
          //   không đi qua Express.
          //   ★★★ N-1 (re-review lượt 8) — điều làm cổng này KHÔNG còn khoá
          //   vĩnh viễn một gói TỐT: `presign` gọi lại trên gói chưa
          //   `'uploaded'` nay LÀM MỚI `sha256Presign` (xem docblock N-1 ở
          //   nhánh "gói đã tồn tại" của `presign`). Một Agent dựng lại ZIP
          //   trước khi upload chỉ cần khai lại digest MỚI; trước bản vá đó,
          //   `status` không bao giờ rời `'pending'` nên cổng này lặp lại mãi
          //   trên một lời khai đã chết.
          if (pkg.status === "pending" && pkg.sha256Presign && shaZipThuc !== pkg.sha256Presign) {
            throw appError(
              "BAD_REQUEST",
              "INVALID_VALUE",
              { field: "sha256" },
              `TỪ CHỐI gói: sha256 Agent khai ở presign ("${pkg.sha256Presign}") không khớp sha256 THẬT của ` +
                `byte ZIP nhận được ("${shaZipThuc}") — dữ liệu có thể đã hỏng khi truyền/lưu. Tải lại ZIP và commit lại.`,
            );
          }

          const zip = await JSZip.loadAsync(zipBuffer);
          const metaFile = zip.file("meta.json");
          // ★★★ M-8 (re-review lượt 8) — THIẾU `meta.json` ⇒ TỪ CHỐI, KHÔNG
          // `committed` im lặng.
          //
          // Đây là HÌNH DẠNG CUỐI CÙNG còn lại của ĐÚNG lớp lỗi C-1: "commit
          // thành công, không bo nào được ghi, Agent nghe THÀNH CÔNG". Trước
          // bản vá: `metaData` ở lại null ⇒ không nhánh nào ghi đè
          // `finalOverallResult` (khởi tạo `"OK"`), 0 `product_inspections`,
          // 0 `package_images` (khối I-6 nằm trong `if (metaData)`),
          // `demTuCayBaoCao` rơi về `{total: <số ảnh>, ok:0, ng:0}` — mà hàng
          // vẫn chuyển `'committed'` với `overallResult='OK'`.
          //
          // HỘ TIÊU THỤ ĐÃ ĐO TRƯỚC KHI ĐỔI (vai `avi_app`, kèm
          // `current_database()` — luật Đ-28): `aoi_management` 0 gói;
          // `aoi_management_test` 296 gói, TẤT CẢ `committed`, `metaJson IS
          // NULL` = 0 ⇒ KHÔNG gói hợp lệ nào đang CỐ Ý không mang manifest.
          // Một gói không manifest không thể thoả bất biến 1/2 (§4 chuẩn gói
          // ảnh): không serial, không cây kết quả, không `images[]` — nên từ
          // chối không lấy mất năng lực nào.
          //
          // ⚠ Cách chữa được kê PHẢI thi hành được (bài học N-1): gói ở lại
          // `'failed'` ⇒ CÙNG `packageId` vẫn `presign`/upload/`commit` lại
          // được với ZIP có `meta.json` (và `presign` gọi lại nay còn LÀM MỚI
          // lời khai toàn vẹn — N-1). Chỉ sau `nguongLoiVinhVienZip()` lượt lỗi
          // vĩnh viễn LIÊN TIẾP gói mới thành `'dead'`, và thông điệp lúc đó kê
          // đúng cách chữa còn lại (`packageId` MỚI) — đó là thiết kế BG-52 có
          // sẵn, không phải một ngõ cụt mới.
          if (!metaFile) {
            throw appError(
              "BAD_REQUEST",
              "INVALID_VALUE",
              { field: "meta.json" },
              `TỪ CHỐI gói: ZIP không có tệp \`meta.json\` — không có manifest thì máy chủ KHÔNG ghi được bo ` +
                `nào (0 product_inspections, 0 package_images), nên một lượt commit "thành công" ở đây sẽ là ` +
                `lời báo thành công RỖNG. Tải lên lại gói với \`meta.json\` ở GỐC ZIP rồi commit lại.`,
            );
          }
          const metaContent = await metaFile.async("string");
          metaData = metaJsonSchema.parse(JSON.parse(metaContent));

          // BG-85 — `metaJsonSchema` GIỜ LÀ `machineDataContractV2` + `images[]`
          // (xem docblock tại chỗ khai schema): `surfaces` bắt buộc ⇒ MỌI lượt
          // `.parse()` thành công đều là hình dạng CÂY. Khẳng định tường minh
          // bằng ĐÚNG vị từ đường trực tiếp v2.0 dùng — Bước 6 (đường di trú)
          // cấm thêm vị từ thứ hai.
          if (metaData && !laHinhDangCayV2(metaData)) {
            throw new Error(
              "BẤT THƯỜNG: metaJsonSchema.parse() thành công nhưng laHinhDangCayV2()===false " +
                "— hợp đồng đã đổi hình dạng theo cách chỗ này chưa cập nhật kịp.",
            );
          }

          // ★★★ 2026-08-18 — MÃ TENANT SUY TỪ MÁY ĐÃ XÁC THỰC, KHÔNG LẤY TỪ `meta.json`.
          // BG-85: hợp đồng v2.0 KHÔNG mang companyCode/factoryCode/workshopCode/
          // lineCode để đối chiếu (khác hợp đồng phẳng cũ đã xoá) — CÙNG
          // `submitInspectionTreeV2` (đường trực tiếp, machineApiRouters.ts):
          // `khai` luôn rỗng, không có lời tự khai nào để so.
          const macTenantCommit = await macTenantChoGhi(machine, {});

          // Count images in ZIP — đếm THEO Ổ ĐĨA (không đổi), độc lập với
          // images[] khai trong meta.json.
          const imageFiles = Object.keys(zip.files).filter(
            (name) => name.startsWith("images/") && !name.endsWith("/")
          );

          // Outer-scope values needed AFTER the tree branch (logging/hooks/return).
          let linkedInspectionId: number | undefined;
          let createdInspection = false;
          let finalOverallResult: "OK" | "NG" | "NTF" = "OK";
          let cay: CayDaDich | null = null;
          let lechSummary = false;
          // Khối B Task 3 — đếm cấp component của lượt commit này (xem `ThongKeCapComponent`).
          let thongKeCapComponent: db.ThongKeCapComponent | undefined;
          // Khối B Task 4 (BG-92) — kết luận spec-gate của lượt commit này. BA trạng
          // thái tách rời; `chuaDay`/`khongGioiHan` KHÔNG BAO GIỜ được cộng vào `dat`.
          let thongKeSpecGate: {
            batCong: boolean; tong: number; dat: number; truot: number; haCap: number;
            chuaDay: number; khongGioiHan: number; tatCong: number;
          } | undefined;
          // Cột báo cáo (`inspection_packages.totalPoints/okCount/ngCount`) —
          // đếm CAPTURES (cấp gần nhất với "một điểm kiểm tra có ảnh") từ CÂY
          // đã dịch — KHÔNG từ `summary` khai (bất biến 3). ★★★ M-8 — trị khởi
          // tạo dưới đây TỪNG là con đường sống của gói thiếu `meta.json`
          // ("committed" với 0 bo, `ok:0`); nay nhánh đó bị TỪ CHỐI ở trên nên
          // đây chỉ còn là trị khởi tạo bị `dichCayKetQua` ghi đè ngay sau.
          let demTuCayBaoCao = { total: imageFiles.length, ok: 0, ng: 0 };
          let resolvedProductModel: Awaited<ReturnType<typeof db.getProductModelByCode>> | undefined;
          // captureId → capture ĐÃ DỊCH (rolledResult…) — dùng để chọn ảnh đại
          // diện cho inline AI gate (thay `normalizedMeasurements` cũ). Chỉ có
          // giá trị SAU khi `dichCayKetQua` chạy (dưới đây) — invariant 1 dùng
          // MỘT Set riêng, xây từ payload THÔ, không phụ thuộc bước dịch.
          const capturesTrongCay = new Map<string, CaptureDaDich>();

          if (metaData) {
            resolvedProductModel = metaData.productModel
              ? await db.getProductModelByCode(metaData.productModel.trim())
              : undefined;

            const capIdsTrongCayTho = new Set<string>();
            for (const s of metaData.surfaces) {
              for (const p of s.positions) {
                for (const c of p.captures) capIdsTrongCayTho.add(c.captureId);
              }
            }
            const images = metaData.images ?? [];

            // ★★★ BG-85/BG-86 Bước 4, bất biến 1 — mọi `images[].captureId`
            // PHẢI tồn tại trong cây. Không tồn tại ⇒ TỪ CHỐI CẢ GÓI — không
            // âm thầm bỏ ảnh (đây LÀ lý do bất biến này tồn tại: một ảnh không
            // join được là dấu hiệu payload hỏng, không phải "ảnh thừa vô hại").
            // `appError("BAD_REQUEST", ...)` ⇒ TRPCError code nằm trong
            // `PERMANENT_TRPC_CODES` (inspectionStoreForward.ts) ⇒
            // `laLoiVinhVienDemVaoNguongDeadZip` xếp VĨNH VIỄN (đúng: thử lại
            // NGUYÊN VĂN cùng ZIP sẽ luôn lệch y hệt — khác lớp lỗi BG-73/hình
            // dạng cũ, nơi một SCHEMA rộng hơn ở server có thể tự cứu gói).
            for (const img of images) {
              if (!capIdsTrongCayTho.has(img.captureId)) {
                throw appError(
                  "BAD_REQUEST",
                  "INVALID_VALUE",
                  { field: "images[].captureId" },
                  `TỪ CHỐI gói: images[].captureId="${img.captureId}" (fileName="${img.fileName}") không ` +
                    `tồn tại trong cây surfaces[].positions[].captures[] — ảnh không nối được vào bo, ` +
                    `KHÔNG âm thầm bỏ ảnh (bất biến 1, §4 chuẩn gói ảnh).`,
                );
              }
            }
            // Bất biến 2 — mọi `images[].fileName` PHẢI có tệp thật trong
            // `images/` của ZIP. Thiếu ⇒ từ chối, cùng lý do phân loại VĨNH VIỄN
            // ở trên. CÙNG VÒNG LẶP (BG-87, Task 2) — nếu `images[].sha256` có
            // mặt (tuỳ chọn, xem `imageRefSchema`), băm nội dung ảnh THẬT vừa
            // đọc và so — lệch ⇒ từ chối CẢ GÓI, không âm thầm bỏ qua MỘT ảnh
            // hỏng (cùng nguyên tắc "không âm thầm bỏ ảnh" của bất biến 1).
            // KHÔNG có `sha256` ⇒ KHÔNG kiểm được gì cho ảnh đó — KHÔNG coi là
            // lỗi (tuỳ chọn, xem docblock `presignCoreObject`/`commit` cho lý
            // do bắt buộc/tuỳ chọn — cùng quyết định áp cho cả sha256 cấp-ZIP
            // và sha256 cấp-ảnh). Fallback tên trần `zip.file(fileName)` ở
            // đường ĐỌC ảnh SAU commit (`getOrExtractImage`, GET
            // /api/aoi/image/:packageId/:fileName) — ĐÃ BỎ ở bản vá này (BG-87,
            // Task 2, "một đường dẫn duy nhất").
            for (const img of images) {
              const anhFileBg87 = zip.file(`images/${img.fileName}`);
              if (!anhFileBg87) {
                throw appError(
                  "BAD_REQUEST",
                  "INVALID_VALUE",
                  { field: "images[].fileName" },
                  `TỪ CHỐI gói: images[].fileName="${img.fileName}" không có tệp thật trong images/ của ` +
                    `ZIP (bất biến 2, §4 chuẩn gói ảnh).`,
                );
              }
              if (img.sha256) {
                const noiDungAnhThuc = Buffer.from(await anhFileBg87.async("uint8array"));
                const shaAnhThuc = createHash("sha256").update(noiDungAnhThuc).digest("hex");
                if (shaAnhThuc.toLowerCase() !== img.sha256.trim().toLowerCase()) {
                  throw appError(
                    "BAD_REQUEST",
                    "INVALID_VALUE",
                    { field: "images[].sha256" },
                    `TỪ CHỐI gói: images[].sha256 Agent khai cho fileName="${img.fileName}" ("${img.sha256}") ` +
                      `không khớp sha256 THẬT của ảnh nhận được ("${shaAnhThuc}") — dữ liệu ảnh có thể đã hỏng.`,
                  );
                }
              }
            }

            // ── dịch cây + verdict — bất biến 3: verdict LUÔN cuộn từ CÂY,
            // `summary` (metaData.summary) chỉ đối chiếu + gắn cờ lệch dưới
            // đây, KHÔNG BAO GIỜ là nguồn quyết định overallResult. DÙNG THẲNG
            // `dichCayKetQua` — CÙNG bộ dịch đường trực tiếp v2.0 dùng, không
            // viết bản chép tay thứ hai của luật cuộn (đúng lý do BG-85 tồn tại).
            // ★★★ Khối B Task 3 (Đ-19) + Task 4 (BG-92) — tra bản dạy của MÁY ĐÃ
            // XÁC THỰC, rồi dựng cổng spec, rồi mới dịch cây. THỨ TỰ BẮT BUỘC: cổng
            // chấm TỪNG LÁ trước khi `dichCayKetQua` cuộn lên bốn cấp — cuộn trước
            // rồi mới chấm sẽ để `finalOverallResult` chốt OK trong khi lá đã bị hạ
            // xuống NG. CÙNG hàm tra + CÙNG cổng mà đường trực tiếp v2.0 dùng
            // (`db.traBanDayChoCay` + `congSpecTuBanDay`) — không chép bản thứ hai,
            // vì hai bản chép tay là đúng cách BG-42 ra đời.
            // ★★★ BG-97 — MỐC "bo được đo", tính TRƯỚC lượt tra. `null` (máy không gửi
            // mốc nào) ⇒ BỎ đường snapshot thay vì neo vào `new Date()`, vì `new Date()`
            // làm lượt phát lại chấm theo giới hạn của LÚC PHÁT LẠI. CÙNG hàm với cửa
            // trực tiếp — `mocDoTuChuoi` đưa chuỗi TRẦN về cùng khung với `changedAt`,
            // KHÔNG phải `new Date(chuỗi trần)` (phụ thuộc múi giờ server — bẫy BG-96).
            // ⚠ KHÔNG thay `rawInspTime` bên dưới: cột `inspectionTime` giữ nguyên.
            const mocDo: Date | null =
              mocDoTuChuoi(metaData.completedAt) ?? mocDoTuChuoi(metaData.startedAt);
            const traBanDay = await db.traBanDayChoCay(
              machine.id, metaData, resolvedProductModel?.id, { lucDo: mocDo },
            );
            const congSpec = congSpecTuBanDay(traBanDay);
            cay = dichCayKetQua(metaData, { cong: congSpec });
            for (const s of cay.surfaces) {
              for (const p of s.positions) {
                for (const c of p.captures) capturesTrongCay.set(c.captureId, c);
              }
            }
            finalOverallResult = cay.verdictLuuTru;
            const demDuocTuCay = demBonNhomTuCay(cay);
            lechSummary = coLechSummary(metaData.summary, demDuocTuCay);
            // ★★★ N-7 — CỘT BÁO CÁO GIỮ NGUYÊN NGHĨA, VÀ NGHĨA ĐÓ NAY ĐƯỢC KHAI
            // TƯỜNG MINH: `okCount` = "số capture ĐẠT", trong đó **NTF LÀ ĐẠT**
            // — cùng lời khai `shared/kpiYield.ts`
            // `FINAL_YIELD_PASS_RESULTS = ["OK","NTF"]` đang áp cho final yield.
            // Trước N-7, `captures.pass` TÌNH CỜ đã gộp sẵn capture NTF-do-cờ
            // (vì ba cấp trên đếm theo `rolledResult`, không bao giờ là "NTF");
            // sau N-7 phép đếm tách `ntf` ra bucket riêng, nên phải cộng LẠI Ở
            // ĐÂY để con số ghi xuống `inspection_packages` KHÔNG đổi cho bất kỳ
            // gói nào — kể cả gói NTF. Nhờ vậy `okCount + ngCount ===
            // totalPoints` vẫn ĐÚNG và không hàng nào đã ghi bị đọc lại theo một
            // nghĩa khác. Đây là cách hiểu (A) trong tranh chấp M-9; cách hiểu
            // (B) ("okCount = số capture KHÔNG cần xem lại") đòi một cột
            // `ntfCount` mà `inspection_packages` KHÔNG CÓ (đo
            // `information_schema`) — chọn (B) mà không thêm cột là bỏ con số
            // NTF vào hư không. Nợ: nếu sau này thêm `ntfCount`, đây là chỗ đổi.
            demTuCayBaoCao = {
              total: demDuocTuCay.captures.total,
              ok: demDuocTuCay.captures.pass + demDuocTuCay.captures.ntf,
              ng: demDuocTuCay.captures.ng,
            };

            // ── Ghi header + cây, CÙNG một transaction vật lý qua
            // `persistInspectionAtomic({..., cay})` — mirror ĐÚNG
            // `submitInspectionTreeV2` (đường trực tiếp): KHÔNG ghi
            // `measurement_results` cấp component (Đ-19, chưa nối — xem "mối
            // lo" báo cáo BG-85), KHÔNG tự tìm "inspection đã có cho serial
            // này" (khác đường FLAT cũ) — mỗi packageId hội tụ về ĐÚNG MỘT
            // inspection qua sổ idempotency `aoi-pkg:${pkg.packageId}`, một
            // packageId KHÁC (VD gói mặt-dưới của cùng board) luôn tạo header
            // MỚI thay vì gộp vào serial trùng — phạm vi HẸP HƠN đường FLAT cũ,
            // khai rõ trong báo cáo, không âm thầm bỏ qua.
            //
            // ★★★ C-1 ⛔ (review lượt 8) — GHI VÔ ĐIỀU KIỆN. Trước bản vá này
            // toàn bộ khối dưới đây bị bọc trong `if (metaData.serialNumber)`.
            // Cổng đó là DI SẢN của hợp đồng PHẲNG cũ, nơi serial LÀ khoá đi
            // tìm "inspection đã có" — sau BG-85 khoá hội tụ là `packageId`
            // (`idempotencyKey` ngay dưới), serial KHÔNG còn là khoá join nào
            // nữa, nên cổng mất hết lý do tồn tại nhưng vẫn ở lại. Hậu quả đo
            // được: `serialNumber: ""` là hình dạng HỢP LỆ theo hợp đồng
            // (`machineDataContractV2.ts` CỐ Ý không `.min(1)` — máy chưa gán
            // serial vẫn gửi bo thật; DB đã có 99 hàng serial rỗng) nhưng ""
            // là falsy ⇒ một bo NG commit "thành công" mà KHÔNG để lại hàng
            // `product_inspections` nào ⇒ biến mất khỏi yield/cảnh báo/ERP.
            // Điều kiện ĐÚNG là "có cây hợp lệ" (`if (metaData)` bao ngoài),
            // và đó CHÍNH LÀ điều kiện đường trực tiếp v2.0 dùng
            // (`machineApiRouters.ts` — ghi vô điều kiện, idempotencyKey luôn
            // đặt). ĐỪNG khôi phục cổng này; nếu cần chặn serial rỗng thì chặn
            // Ở HỢP ĐỒNG, và hướng đó đã bị chủ dự án BÁC (BG-73 hướng (a)).
            const rawInspTime = metaData.completedAt
              ? new Date(metaData.completedAt)
              : metaData.startedAt
              ? new Date(metaData.startedAt)
              : new Date();
            // Cutover 2026-09-03 (Khối C QĐ-1, BG-96) — bỏ dịch "fake UTC"; `inspectionTime`/
            // `createdAt`/`updatedAt` dưới đây ghi THẲNG `rawInspTime` (UTC thật), cùng hệ quy
            // chiếu với `mocDo`/cây ở trên và với đường trực tiếp v2.0 (machineApiRouters.ts).

            const reservedId = await db.reserveInspectionId();
            const insertOutcome: { duplicate: boolean } = { duplicate: false };
            const newInspectionData: InsertProductInspection & { id: number } = {
              id: reservedId,
              machineId: machine.id,
              serialNumber: metaData.serialNumber,
              productModelId: resolvedProductModel?.id,
              productModel: resolvedProductModel?.code || metaData.productModel?.trim() || null,
              // Cột `originalResultEnum` chỉ nhận OK/NG — payload v2.0 TỰ giới
              // hạn `overallResult` ở OK/NG (không NTF ở cấp khai máy) nên ghi
              // THẲNG lời khai gốc, KHÔNG cần `toOriginalResult` (mirror
              // `submitInspectionTreeV2`, không chép một công thức thứ ba).
              originalResult: metaData.overallResult,
              overallResult: finalOverallResult,
              corporateCode: macTenantCommit.corporateCode ?? null,
              factoryCode: macTenantCommit.factoryCode ?? null,
              workshopCode: macTenantCommit.workshopCode ?? null,
              lineCode: macTenantCommit.lineCode ?? null,
              inspectionTime: rawInspTime,
              ntfSource: cay.ntfSource ?? undefined,
              machineProductIndex: metaData.machineProductIndex ?? undefined,
              summaryCounts: metaData.summary,
              createdAt: rawInspTime,
              updatedAt: rawInspTime,
              // Sổ idempotency (doc 51 P1) — packageId UNIQUE ⇒ khoá ổn định
              // qua mọi lần retry của CÙNG một gói. ĐÂY là thứ chặn đếm trùng
              // (BG-23), KHÔNG phải serial — chỉ số duy nhất trong `product_
              // inspections` canh theo serial (`uq_inspection_natural`) đã
              // MIỄN TRỪ serial rỗng bằng `WHERE serialNumber <> ''`.
              idempotencyKey: `aoi-pkg:${pkg.packageId}`,
            };

            const persisted = await db.persistInspectionAtomic(
              newInspectionData,
              [],
              { cay, outcome: insertOutcome, tra: traBanDay },
            );
            linkedInspectionId = persisted.id;
            createdInspection = !persisted.duplicate;
            // ⚠ KHÔNG ÂM THẦM — xem `ghiSoLechCayDay`. Nhánh "máy ĐÃ dạy mà khai linh
            // kiện ngoài cây" đã vào `audit_logs` TRONG chính transaction trên; dòng này
            // là kênh thứ hai (nhật ký vận hành) cho CẢ HAI nhánh.
            // ★★★ BG-92 — CỔNG SPEC NÓI RA CẢ BA TRẠNG THÁI (xem `specGateCayV2.ts`).
            // `truot > 0` = bo XẤU vừa bị chặn ở cửa ZIP — đúng cửa mà BG-85 đã đánh
            // rơi `evaluatePointResult` ở `df20b31c`.
            const tkCong = congSpec.thongKe;
            if (tkCong.truot > 0) {
              console.warn(
                `[AOI commit] SPEC-GATE: ${tkCong.truot}/${tkCong.tong} linh kiện VI PHẠM giới hạn ` +
                  `đã dạy (${tkCong.haCap} lần HẠ OK→NG) · máy=${machine.code} gói=${pkg.packageId} ` +
                  `inspectionId=${persisted.id} · mẫu: ${tkCong.mauTruot.join(" | ")}`,
              );
            }
            if (tkCong.batCong && tkCong.dat + tkCong.truot === 0 && tkCong.tong > 0) {
              console.warn(
                `[AOI commit] SPEC-GATE KHÔNG KẾT LUẬN ĐƯỢC gì: ${tkCong.tong} linh kiện — ` +
                  `${tkCong.chuaDay} chưa dạy, ${tkCong.khongGioiHan} đã dạy mà bản dạy CHƯA CÓ ` +
                  `giới hạn · máy=${machine.code} gói=${pkg.packageId} inspectionId=${persisted.id}`,
              );
            }
            thongKeSpecGate = {
              batCong: tkCong.batCong, tong: tkCong.tong, dat: tkCong.dat, truot: tkCong.truot,
              haCap: tkCong.haCap, chuaDay: tkCong.chuaDay,
              khongGioiHan: tkCong.khongGioiHan, tatCong: tkCong.tatCong,
            };
            thongKeCapComponent = persisted.thongKeComponent;
            if (thongKeCapComponent && thongKeCapComponent.chuaDay > 0) {
              console.warn(
                `[AOI commit] cấp component: ghi ${thongKeCapComponent.daGhi}/${thongKeCapComponent.tong} hàng — ` +
                  `${thongKeCapComponent.chuaDay} linh kiện CHƯA CÓ BẢN DẠY` +
                  (thongKeCapComponent.nhapNhang > 0 ? ` (trong đó ${thongKeCapComponent.nhapNhang} nhập nhằng)` : "") +
                  ` · máy=${machine.code} mayCoBanDay=${thongKeCapComponent.mayCoBanDay}` +
                  ` · gói=${pkg.packageId} inspectionId=${persisted.id} · mẫu: ${thongKeCapComponent.mauChuaDay.join(", ")}`,
              );
            }
            if (persisted.duplicate) {
              console.warn(
                `[AOI commit] persistInspectionAtomic reported duplicate for package ` +
                  `${pkg.packageId} (idempotency key hit) → existing inspectionId=${persisted.id}`,
              );
            }
          }

          // ════════════════════════════════════════════════════════════════
          // ★★★ I-6 (review lượt 8) — GHI LẠI `package_images` TỪ `images[]`
          // ĐÃ THẨM ĐỊNH. BG-85 bỏ hẳn INSERT này với lý do "`pointCode`
          // varchar(50) < `captureId` cho phép tới 64 ⇒ nguy cơ cắt cụt âm
          // thầm" — mối lo ĐÚNG, cách xử lý SAI: bỏ ghi làm `getPackage`/
          // `getPackageImages` trả RỖNG và `getImage({pointCode})` mất bảng
          // tra `pointCode → fileName`, tức người phán mất ảnh NG để nhìn.
          // Đo được: 2 gói `committed` hình dạng cây trong `aoi_management_test`
          // có `imageCount>0` mà 0 hàng `package_images`.
          // Migration 0345 nới cột lên varchar(64) = ĐÚNG trần hợp đồng
          // (`imageRefSchema.captureId .max(64)`) ⇒ không còn phải chọn giữa
          // "cắt cụt âm thầm" và "không ghi gì".
          //
          // Nguồn dữ liệu là `images[]` ĐÃ QUA bất biến 1 + 2 ở trên (captureId
          // tồn tại trong cây; fileName có tệp thật trong `images/`), nên mọi
          // hàng ghi ra đều nối được cả hai chiều — không có hàng mồ côi.
          // `result` lấy `rolledResult` của CHÍNH capture đó (cuộn từ cây), KHÔNG
          // lấy `result` máy khai: cùng bất biến 3 áp cho cột báo cáo.
          // `measurementValue` để NULL — hợp đồng cây mang trị đo ở cấp
          // COMPONENT, gán bừa một trị nào đó vào hàng cấp capture là bịa.
          //
          // DELETE-rồi-INSERT trong MỘT transaction: phép ghi này phải chịu
          // được một lượt `commit` lặp (gói `failed` giữa chừng rồi retry) mà
          // không nhân đôi hàng. `package_images` KHÔNG phải bảng WORM —
          // `avi_app` có đủ SELECT/INSERT/UPDATE/DELETE (đo bằng
          // information_schema.role_table_grants), khác `product_inspections`.
          // ════════════════════════════════════════════════════════════════
          const anhDaThamDinh = metaData?.images ?? [];
          if (metaData) {
            const hangAnh = anhDaThamDinh.map((img) => ({
              packageId: pkg.id,
              pointCode: img.captureId,
              pointName: img.captureName ?? null,
              fileName: img.fileName,
              result: capturesTrongCay.get(img.captureId)?.rolledResult,
              measurementValue: null,
            }));
            await database.transaction(async (tx) => {
              await tx.delete(packageImages).where(eq(packageImages.packageId, pkg.id));
              if (hangAnh.length > 0) await tx.insert(packageImages).values(hangAnh);
            });
          }

          // Update package record → committed.
          await database
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
              totalPoints: demTuCayBaoCao.total,
              okCount: demTuCayBaoCao.ok,
              ngCount: demTuCayBaoCao.ng,
              imageCount: imageFiles.length,
              inspectionTime: metaData?.completedAt
                ? new Date(metaData.completedAt)
                : metaData?.startedAt
                ? new Date(metaData.startedAt)
                : null,
              metaJson: metaData as any,
              committedAt: new Date(),
              uploadedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(inspectionPackages.id, pkg.id));

          // Log: commit_success
          const commitDuration = Date.now() - commitStartTime;
          await logPackageActivity({
            packageDbId: pkg.id,
            packageId: pkg.packageId,
            machineId: machine.id,
            event: "commit_success",
            // C-1: nhánh "no inspection linked" KHÔNG còn nghĩa "thiếu
            // serialNumber" (cổng đó đã bỏ) — nó từng chỉ còn xảy ra khi ZIP
            // KHÔNG có `meta.json`. ★★★ M-8 (re-review lượt 8) đã ĐÓNG luôn
            // đường đó: thiếu `meta.json` nay bị TỪ CHỐI trước khi tới đây, nên
            // một lượt `commit_success` LUÔN có bo được ghi. Nhánh thứ ba giữ
            // lại làm CẦU CHÌ: nếu nó xuất hiện trong nhật ký thì bất biến
            // "commit thành công ⇔ có bo được ghi" đã gãy ở một đường chưa
            // biết — câu chữ phải nói đúng thế, không đổ cho một nguyên nhân
            // đã bị chặn.
            message: `Package committed successfully — ${imageFiles.length} images, ${demTuCayBaoCao.total} captures${createdInspection ? ', inspection created' : linkedInspectionId ? ', duplicate (idempotent retry)' : ', ⚠ BẤT THƯỜNG: no inspection linked (M-8 đã chặn nhánh thiếu meta.json — bất biến bo-được-ghi đã gãy ở đường khác)'}`,
            source: "agent",
            durationMs: commitDuration,
            detail: `Serial: ${metaData?.serialNumber || 'N/A'}, Model: ${metaData?.productModel || 'N/A'}, Result: ${finalOverallResult}, Inspection ID: ${linkedInspectionId || 'none'}${createdInspection ? ' (NEW)' : ''}`,
            metadata: {
              imageCount: imageFiles.length,
              serialNumber: metaData?.serialNumber,
              overallResult: finalOverallResult,
              linkedInspectionId,
              createdInspection,
              // BG-85 bất biến 3 — verdict LUÔN cuộn từ cây; hai trường dưới đây
              // CHỈ là cờ đối chiếu/quan sát, KHÔNG hề ảnh hưởng verdict đã ghi
              // ở trên — đo được bằng SELECT trên chính cột này.
              verdictSource: "tree" as const,
              treeDeclaredMismatch: cay?.declaredMismatch ?? null,
              summaryDeclaredMismatch: lechSummary,
            },
          });

          // Embed-at-ingest (Phase A2/A4): queue DINOv2 visual embeddings for this
          // inspection's images. Non-blocking + flag-gated (AOI_EMBEDDING_ENABLED);
          // never throws — must not affect commit success.
          //
          // ⚠ I-6 (review lượt 8) — LỜI KHAI PHẢI ĐÚNG SỰ THẬT HÔM NAY: worker
          // (`aoiImageEmbeddingWorker.ts`) chọn ứng viên bằng
          // `measurement_results WHERE inspectionId=? AND imageUrl IS NOT NULL`.
          // Đường ZIP hình dạng CÂY KHÔNG ghi `measurement_results` cấp
          // component (Đ-19, chưa nối — chờ ánh xạ `componentExtId → pointDefId`
          // của Khối B), nên với gói cây, truy vấn đó trả 0 hàng và cả chuỗi
          // embed → anomaly → escalation VL KHÔNG chạy. Lệnh xếp hàng dưới đây
          // vì thế là một no-op CÓ CHỦ ĐÍCH cho gói cây: giữ nguyên để khi Khối
          // B nối `measurement_results` thì đường này sống lại mà không phải
          // nhớ thêm một chỗ. `package_images` (vừa khôi phục ở trên) KHÔNG
          // phải nguồn của worker — bảng đó phục vụ đường ĐỌC ảnh của người
          // dùng, không phải đường embedding.
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
          //
          // ★★★ C-1 (review lượt 8) — cổng CHỈ còn `linkedInspectionId`. Điều
          // kiện cũ `&& metaData?.serialNumber` là hộ tiêu thụ THỨ HAI của cùng
          // di sản "serial là khoá": nó bỏ luôn cả phần KHÔNG cần serial (bump
          // production order, line-balance metrics) cho mọi bo serial-rỗng.
          // `ingestInspectionToWip` nhận `serialNumber: string | null` và TỰ gác
          // từng bước con cần serial (`if (input.serialNumber)` — WIP unit,
          // dwell, ERP outbox) ⇒ chuyển quyết định về đúng nơi biết luật, thay
          // vì chặn cả gói ở tầng gọi.
          try {
            if (linkedInspectionId) {
              const { ingestInspectionToWip } = await import("../services/wipIngestService");
              ingestInspectionToWip({
                inspectionId: linkedInspectionId,
                serialNumber: metaData?.serialNumber ?? null,
                // BG-85: hợp đồng v2.0 không mang batchNumber/cycleTime (trường
                // riêng của hợp đồng phẳng cũ, đã xoá) — không có gì để suy.
                lotNumber: null,
                overallResult: finalOverallResult,
                machineId: machine.id,
                stationId: machine.stationId ?? null,
                productModelId: resolvedProductModel?.id ?? null,
                productCode: metaData?.productModel ?? null,
                cycleTimeSec: null,
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
          // delayed. BG-85: gate image chọn qua `images[]`/`captureId` (thay
          // `normalizedMeasurements` cũ) — ưu tiên ảnh của capture NG, không
          // có thì lấy ảnh ĐẦU TIÊN, extracted lazily INSIDE the hook.
          // Per-machine/product enablement, the AI-down circuit breaker and the
          // NEEDS_REVIEW fallback live inside runInlineQualityGate (same write
          // shape as the on-demand UI path).
          try {
            const inlineGateOn = (process.env.AI_INLINE_GATE_ENABLED ?? "false").toLowerCase() === "true";
            if (inlineGateOn && linkedInspectionId && metaData) {
              const anhTrongMeta = metaData.images ?? [];
              const anhNg = anhTrongMeta.find((img) => capturesTrongCay.get(img.captureId)?.rolledResult === "NG");
              const gatePoint = anhNg ?? anhTrongMeta[0];
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
                          // BG-87 — một đường dẫn duy nhất (bỏ fallback tên
                          // trần), cùng chuẩn `getOrExtractImage` ở trên.
                          const f = zip.file(`images/${gateFileName}`);
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
            totalPoints: demTuCayBaoCao.total,
            // Khối B Task 3 (Đ-19) — ĐẾM ĐƯỢC TẬN CỬA (trường THÊM, không sửa
            // trường cũ nào). Agent đẩy gói đọc được ngay rằng nó vừa khai N linh
            // kiện chưa có bản dạy — đó là tín hiệu "hãy đẩy cây dạy lên".
            capComponent: thongKeCapComponent
              ? {
                  tong: thongKeCapComponent.tong,
                  daGhi: thongKeCapComponent.daGhi,
                  chuaDay: thongKeCapComponent.chuaDay,
                  mayCoBanDay: thongKeCapComponent.mayCoBanDay,
                }
              : undefined,
            // ★★★ Khối B Task 4 (BG-92) — BA TRẠNG THÁI của spec-gate, y hệt cửa trực
            // tiếp v2.0. `dat`/`truot` = đã chấm được; `chuaDay`/`khongGioiHan`/`tatCong`
            // = KHÔNG KẾT LUẬN ĐƯỢC. Bốn trường RIÊNG — gộp chúng vào `dat` là đúng thứ
            // "giấy vô can giả" mà brief Task 4 cấm.
            specGate: thongKeSpecGate,
          };
        } catch (err: any) {
          // Log: commit_fail
          const commitDuration = Date.now() - commitStartTime;
          // ★★★ Pha 1D Task 5 (BG-52 ⛔) — phân loại VĨNH VIỄN/TẠM THỜI bằng
          // `laLoiVinhVienDemVaoNguongDeadZip` (định nghĩa phía trên, dựa trên
          // CHÍNH `isPermanentSubmitError` của server/services/inspection/
          // inspectionStoreForward.ts — KHÔNG viết bản thứ hai). VĨNH VIỄN
          // (Postgres 22xxx/23xxx qua `.cause`, TRPCError NOT_FOUND/FORBIDDEN/
          // BAD_REQUEST/…, hoặc `ZodError` CHỈ gồm issue `"too_big"` — payload
          // QUÁ CỠ) sẽ KHÔNG BAO GIỜ thành công khi thử lại NGUYÊN VĂN cùng
          // ZIP; đếm vào ngưỡng dead-letter dưới đây. TẠM THỜI (mạng storage
          // rớt, DB chớp nháy, lỗi JS chung không rõ lớp) KHÔNG được đếm — gói
          // vẫn `'failed'` và vẫn retry được vô hạn, đúng ý chống-siết-quá
          // (mệnh đề 4). ★★★ BG-73 (Pha 1F Task 2 ⛔) — `ZodError` do LỆCH
          // HÌNH DẠNG (thiếu trường bắt buộc/sai kiểu, ví dụ mẫu meta.json
          // THẬT của máy mang `images[]` thay vì `measurements[]`) CŨNG KHÔNG
          // được đếm — xem docblock `laLoiVinhVienDemVaoNguongDeadZip` phía
          // trên cho lý do đầy đủ + câu trả lời "vận hành lấy gói này về bằng
          // cách nào".
          const laLoiVinhVien = laLoiVinhVienDemVaoNguongDeadZip(err);
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
