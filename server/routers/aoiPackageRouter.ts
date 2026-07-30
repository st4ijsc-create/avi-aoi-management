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
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid file name" });
  }

  const cacheKey = `${pkg.packageId}/${normalizedName}`;
  const cachePath = path.join(CACHE_DIR, cacheKey);

  // Verify cache path stays within CACHE_DIR
  const resolvedCache = path.resolve(cachePath);
  if (!resolvedCache.startsWith(path.resolve(CACHE_DIR) + path.sep)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid file name" });
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
      throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "aoiPackage" }, "ZIP file not found on disk");
    }
    zipBuffer = fs.readFileSync(filePath);
  } else {
    // Forge mode - download from storage
    const { url } = await storageGet(pkg.storageKey);
    const response = await fetch(url);
    if (!response.ok) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to download ZIP from storage" });
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
const metaJsonSchema = z.object({
  // Machine identification (backward compatible)
  machineCode: z.string().optional(),
  inspectionId: z.string().optional(), // Internal inspection ID from agent
  
  // Product information (REQUIRED)
  serialNumber: z.string(), // Số serial sản phẩm
  productModel: z.string(), // Model sản phẩm
  batchNumber: z.string().optional(), // Số lô
  
  // Inspection timing
  startedAt: z.string().optional(), // ISO datetime
  finishedAt: z.string().optional(), // ISO datetime
  inspectionTime: z.string().optional(), // Alias for startedAt (submitInspection compat)
  cycleTime: z.number().optional(), // Thời gian chu kỳ (giây)
  
  // Overall result
  overallResult: z.enum(["OK", "NG", "NTF"]).optional(), // Kết quả tổng thể
  
  // Enterprise hierarchy (top-down) - Đồng bộ với submitInspection
  companyCode: z.string().optional(), // Mã tập đoàn/công ty
  factoryCode: z.string().optional(), // Mã nhà máy (alias: factory)
  factory: z.string().optional(), // Backward compatible
  workshopCode: z.string().optional(), // Mã nhà xưởng
  lineCode: z.string().optional(), // Mã dây chuyền (alias: line)
  line: z.string().optional(), // Backward compatible
  stageCode: z.string().optional(), // Mã công đoạn
  
  // Production context
  productionOrderCode: z.string().optional(), // Mã lệnh sản xuất
  operatorId: z.string().optional(), // Mã công nhân vận hành
  
  // Measurement data - Đồng bộ với submitInspection measurements
  measurements: z.array(z.object({
    pointId: z.string().optional(), // ID điểm đo (submitInspection compat)
    pointCode: z.string().optional(), // Mã điểm đo (backward compatible)
    code: z.string().optional(), // Alias for pointCode
    name: z.string().optional(), // Tên điểm đo
    fileName: z.string(), // Tên file ảnh trong ZIP
    result: z.enum(["OK", "NG", "NTF"]).optional(), // Kết quả
    measuredValue: z.union([z.number(), z.string()]).optional(), // Giá trị đo (submitInspection compat)
    value: z.union([z.number(), z.string()]).optional(), // Alias (backward compatible)
    unit: z.string().optional(), // Đơn vị
    remark: z.string().optional(), // Ghi chú
  })),
  
  // Legacy fields (backward compatible)
  points: z.array(z.object({
    code: z.string(),
    name: z.string().optional(),
    fileName: z.string(),
    result: z.enum(["OK", "NG", "NTF"]).optional(),
    value: z.union([z.number(), z.string()]).optional(),
    unit: z.string().optional(),
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
// Router
// ============================================================
export const aoiPackageRouter = router({
  /**
   * 1. Presign - Tạo presigned URL để Agent upload ZIP
   * Agent gọi endpoint này trước khi upload
   */
  presign: publicProcedure
    .input(z.object({
      apiKey: z.string().optional(),
      machineCode: z.string().optional(),
      inspectionId: z.string(), // From agent (unique ID)
      sizeBytes: z.number(),
      sha256: z.string().optional(),
    }).refine(data => data.apiKey || data.machineCode, {
      message: "Either apiKey or machineCode must be provided",
    }))
    .mutation(async ({ input }) => {
      // Validate machine
      let machine;
      if (input.apiKey) {
        machine = await db.getMachineByApiKey(input.apiKey);
      } else if (input.machineCode) {
        machine = await db.getMachineByCode(input.machineCode.trim());
      }
      if (!machine) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid machine credentials" });
      }

      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

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
      // Build storage key: aoi/{factory}/{line}/{machine}/{yyyy}/{mm}/{dd}/{inspectionId}.zip
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");

      const objectKey = `aoi/${machineRecord.code}/${yyyy}/${mm}/${dd}/${input.inspectionId}.zip`;
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
    .mutation(async ({ input }) => {
      // Validate machine
      let machine;
      if (input.apiKey) {
        machine = await db.getMachineByApiKey(input.apiKey);
      } else if (input.machineCode) {
        machine = await db.getMachineByCode(input.machineCode.trim());
      }
      if (!machine) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid machine credentials" });
      }

      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

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
        throw new TRPCError({ code: "FORBIDDEN", message: "Package belongs to another machine" });
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
              throw new Error("ZIP file not found");
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

          // Count images in ZIP
          const imageFiles = Object.keys(zip.files).filter(
            (name) => name.startsWith("images/") && !name.endsWith("/")
          );

          // Normalize measurements - support both measurements and points (backward compat)
          const normalizedMeasurements = metaData?.measurements || metaData?.points || [];

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

          // Outer-scope values needed AFTER the tx commits (logging/hooks/return).
          let linkedInspectionId: number | undefined;
          let createdInspection = false;
          let finalOverallResult: "OK" | "NG" | "NTF" = "OK";

          // ── P1-A: ONE atomic transaction for ALL commit writes ──────────────
          // package images + inspection (find/create) + measurement results +
          // spec-gate overall-NG promotion + package status→committed. A crash
          // mid-write can no longer leave a partially-committed package (e.g.
          // measurement rows with no committed header, or an OK header over NG
          // points). ZIP/object I/O and point-def auto-create already ran ABOVE
          // (outside the tx); the post-commit hooks run BELOW (outside).
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

          if (metaData?.serialNumber) {
            // Try to find existing inspection
            const inspections = await tx
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
              // Create new inspection record from AOI package data
              // Fix timezone: shift to "fake UTC" so Drizzle stores local time in timestamp without time zone
              const rawInspTime = metaData.inspectionTime 
                ? new Date(metaData.inspectionTime) 
                : metaData.startedAt 
                ? new Date(metaData.startedAt) 
                : new Date();
              const inspectionTime = new Date(rawInspTime.getTime() - rawInspTime.getTimezoneOffset() * 60000);
              
              // Determine overall result
              const overallResult = metaData.overallResult 
                || (metaData.summary?.ng && metaData.summary.ng > 0 ? "NG" : "OK");

              const [newInspection] = await tx
                .insert(productInspections)
                .values({
                  machineId: machine.id,
                  serialNumber: metaData.serialNumber,
                  productModel: metaData.productModel || null,
                  batchNumber: metaData.batchNumber || null,
                  
                  // Enterprise hierarchy - prioritize new fields
                  corporateCode: metaData.companyCode || null,
                  factoryCode: metaData.factoryCode || metaData.factory || null,
                  workshopCode: metaData.workshopCode || null,
                  lineCode: metaData.lineCode || metaData.line || null,
                  stageCode: metaData.stageCode || null,
                  
                  // Production context
                  productionOrderCode: metaData.productionOrderCode || null,
                  operatorId: metaData.operatorId || null,
                  
                  overallResult: overallResult as "OK" | "NG" | "NTF",
                  originalResult: overallResult as "OK" | "NG",
                  inspectionTime: inspectionTime,
                  cycleTime: metaData.cycleTime ? String(metaData.cycleTime) : null,
                  createdAt: inspectionTime,
                  updatedAt: inspectionTime,
                })
                .returning({ id: productInspections.id });

              linkedInspectionId = newInspection.id;
              createdInspection = true;
            }

            // Create or update measurement results with image URLs pointing to AOI package images
            // Applies for BOTH new and existing inspections
            if (linkedInspectionId && pointsWithImages.length > 0) {
              const inspectionTime2Raw = metaData.inspectionTime
                ? new Date(metaData.inspectionTime)
                : metaData.startedAt
                ? new Date(metaData.startedAt)
                : new Date();
              const inspectionTime = new Date(inspectionTime2Raw.getTime() - inspectionTime2Raw.getTimezoneOffset() * 60000);

              // Build one measurement_results row from a pre-resolved point
              // (pointDefId/gateDef resolved OUTSIDE the tx above). The spec-gate
              // EVAL runs here so `zipDowngradeCount` is only bumped for rows we
              // actually (re)write with a result.
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

              // For existing inspections, update existing records instead of creating duplicates
              if (!createdInspection) {
                const existingRecords = await tx
                  .select({ id: measurementResults.id, remark: measurementResults.remark })
                  .from(measurementResults)
                  .where(eq(measurementResults.inspectionId, linkedInspectionId!))
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
              } else {
                // New inspection — insert all measurement records
                const measurementRecords = [];
                for (let idx = 0; idx < pointsWithImages.length; idx++) {
                  measurementRecords.push(buildRecord(idx, pointsWithImages[idx] as any));
                }
                await tx.insert(measurementResults).values(measurementRecords);
              }
            }

            // W2-A / doc 35 D2 — spec-gate overall-NG promotion, now INSIDE the
            // same atomic tx (mirrors reconcileInspectionOverallNG: only flips an
            // OK header to NG; idempotent). Being part of the atomic unit, a
            // failure here rolls the whole commit back rather than leaving an
            // OK header over NG points.
            if (zipDowngradeCount > 0 && linkedInspectionId) {
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

          // Calculate summary from measurements if not provided
          const calculatedSummary = metaData?.summary || {
            totalPoints: normalizedMeasurements.length,
            ok: normalizedMeasurements.filter(p => p.result === 'OK').length,
            ng: normalizedMeasurements.filter(p => p.result === 'NG').length,
            ntf: normalizedMeasurements.filter(p => !p.result || p.result === 'NTF').length,
          };

          // Determine overall result (assigns the outer-scope var used by the
          // post-commit WIP hook below).
          finalOverallResult = (metaData?.overallResult
            || (calculatedSummary.ng > 0 ? "NG" : "OK")) as "OK" | "NG" | "NTF";

          // Update package record → committed (atomic with the writes above)
          await tx
            .update(inspectionPackages)
            .set({
              status: "committed",
              inspectionId: linkedInspectionId || null,
              serialNumber: metaData?.serialNumber || null,
              productModel: metaData?.productModel || null,
              factoryCode: metaData?.factoryCode || metaData?.factory || null,
              lineCode: metaData?.lineCode || metaData?.line || null,
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
            metadata: { errorCode: err.code, storageKey: pkg.storageKey },
          });

          // Mark as failed
          await database
            .update(inspectionPackages)
            .set({
              status: "failed",
              errorMessage: err.message || "Failed to process package",
              updatedAt: new Date(),
            })
            .where(eq(inspectionPackages.id, pkg.id));

          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to process package: ${err.message}`,
          });
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
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

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
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

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
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

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
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot determine image file name" });
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
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

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
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

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
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

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
        throw new TRPCError({ code: "NOT_FOUND", message: "ZIP file not available" });
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
    .mutation(async ({ input }) => {
      let machine;
      if (input.apiKey) {
        machine = await db.getMachineByApiKey(input.apiKey);
      } else if (input.machineCode) {
        machine = await db.getMachineByCode(input.machineCode.trim());
      }
      if (!machine) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid machine credentials" });
      }

      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

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
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

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
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

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
