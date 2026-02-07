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
} from "../../drizzle/schema";
import JSZip from "jszip";
import fs from "fs";
import path from "path";

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
  const cacheKey = `${pkg.packageId}/${fileName}`;
  const cachePath = path.join(CACHE_DIR, cacheKey);

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
  if (!pkg.storageKey) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Package storage key not found" });
  }

  let zipBuffer: Buffer;
  const storageMode = process.env.STORAGE_MODE ?? "forge";

  if (storageMode === "local") {
    const uploadsRoot = process.env.LOCAL_STORAGE_DIR
      ? path.resolve(process.env.LOCAL_STORAGE_DIR)
      : path.join(process.cwd(), "uploads");
    const filePath = path.join(uploadsRoot, pkg.storageKey);
    if (!fs.existsSync(filePath)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "ZIP file not found on disk" });
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
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Image ${fileName} not found in ZIP package`,
    });
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
// Meta.json schema
// ============================================================
const metaJsonSchema = z.object({
  inspectionId: z.string(),
  serialNumber: z.string(),
  productModel: z.string(),
  factory: z.string().optional(),
  line: z.string().optional(),
  machineCode: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  points: z.array(z.object({
    code: z.string(),
    name: z.string().optional(),
    fileName: z.string(),
    result: z.enum(["OK", "NG", "NTF"]).optional(),
    value: z.union([z.number(), z.string()]).optional(),
    unit: z.string().optional(),
  })),
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
      await database.insert(inspectionPackages).values({
        machineId: machineRecord.id,
        packageId: input.inspectionId,
        storageKey: objectKey,
        fileSizeBytes: input.sizeBytes,
        status: "pending",
        machineCode: machineRecord.code,
        presignExpiresAt: expiresAt,
      });

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
        throw new TRPCError({ code: "NOT_FOUND", message: "Package not found" });
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

          // Insert package image records
          if (metaData?.points) {
            const imageRecords = metaData.points.map((point) => ({
              packageId: pkg.id,
              pointCode: point.code,
              pointName: point.name || null,
              fileName: point.fileName,
              result: point.result as "OK" | "NG" | "NTF" | undefined,
              measurementValue: point.value?.toString() || null,
            }));

            if (imageRecords.length > 0) {
              await database.insert(packageImages).values(imageRecords);
            }
          }

          // Link to existing inspection if possible
          let linkedInspectionId: number | undefined;
          if (metaData?.serialNumber) {
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
            }
          }

          // Update package record
          await database
            .update(inspectionPackages)
            .set({
              status: "committed",
              inspectionId: linkedInspectionId || null,
              serialNumber: metaData?.serialNumber || null,
              productModel: metaData?.productModel || null,
              factoryCode: metaData?.factory || null,
              lineCode: metaData?.line || null,
              overallResult: metaData?.summary?.ng && metaData.summary.ng > 0 ? "NG" : "OK",
              totalPoints: metaData?.summary?.totalPoints || imageFiles.length,
              okCount: metaData?.summary?.ok || 0,
              ngCount: metaData?.summary?.ng || 0,
              imageCount: imageFiles.length,
              inspectionTime: metaData?.startedAt ? new Date(metaData.startedAt) : null,
              metaJson: metaData as any,
              committedAt: new Date(),
              uploadedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(inspectionPackages.id, pkg.id));

          return {
            success: true,
            alreadyCommitted: false,
            packageId: pkg.packageId,
            inspectionId: linkedInspectionId,
            imageCount: imageFiles.length,
            totalPoints: metaData?.summary?.totalPoints || imageFiles.length,
          };
        } catch (err: any) {
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
        throw new TRPCError({ code: "NOT_FOUND", message: "Package not found" });
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
        throw new TRPCError({ code: "NOT_FOUND", message: "Package not found" });
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

      const { buffer, fromCache } = await getOrExtractImage(pkg, targetFileName, watermarkLines);

      // Return as base64 for tRPC transport
      return {
        imageBase64: buffer.toString("base64"),
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
          throw new TRPCError({ code: "NOT_FOUND", message: "Package not found" });
        }
        pkgId = pkgs[0].id;
      } else {
        throw new TRPCError({ code: "BAD_REQUEST", message: "id or packageId required" });
      }

      return database
        .select()
        .from(packageImages)
        .where(eq(packageImages.packageId, pkgId));
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
        throw new TRPCError({ code: "NOT_FOUND", message: "Package not found" });
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
