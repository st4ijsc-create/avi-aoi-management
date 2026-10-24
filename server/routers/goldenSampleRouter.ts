/**
 * Golden-sample router (key "goldenSample").
 *
 * W5-B (doc 27 §5 gap F8) created the READ-ONLY surface (getActiveForKey /
 * listForProduct). W7-C (doc 27 §9 Đợt 7.4 — gaps V7/V8/V11/V15) extends it into
 * the FULL production golden-diff chain:
 *
 *   capture   — captureFromUpload / captureFromInspection create a DRAFT
 *               (status='draft', active=false — never resolvable) [V8]
 *   approve   — approve/reject/retire with SoD (capturer ≠ approver, mirrors
 *               machineRecipe W2-9); only APPROVED rows resolve [V11]
 *   normalize — flat-field illumination normalization (per-call flag) [V15]
 *   align     — sub-pixel registration (imageRegistration.registerToReference)
 *               per-golden `alignBeforeDiff` flag, ALIGN_BEFORE_DIFF=false env
 *               is the global kill-switch [V7]
 *   diff      — diffForMeasurement / diffWithUpload run the whole chain and
 *               return diff score + alignment confidence + heatmap PNG.
 *
 * RBAC: reads = protectedProcedure; capture/approve/reject/retire/flags =
 * qualityProcedure (admin/supervisor/quality_inspector + 2FA). Every mutation is
 * audit-logged.
 */
import { z } from "zod";
import fs from "fs";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, protectedProcedure, qualityProcedure } from "../_core/trpc";
import { sql } from "drizzle-orm";
import { phamViCua, type CoDanhTinh } from "./_phamViNguoiXem";
import { mayTrongPhamVi } from "./_adapterPhamVi";
import { sanPhamGhiTrongPhamVi } from "./_sanPhamPhamVi";
import {
  resolveActiveReference,
  referenceThumbnailDataUrl,
  listReferences,
  listByProduct,
  submitDraft,
  approveReference,
  rejectReference,
  retireReference,
  setAlignBeforeDiff,
  getReferenceById,
  GoldenSoDError,
  GoldenStatusError,
} from "../services/goldenSampleService";
import { goldenDiffForKey } from "../services/aiAdvancedVision";
import * as db from "../db";
import { resolveImageToDataUrl } from "../storage";
import { resolveSafeImagePath } from "../utils/safeImagePath";
import type { GoldenSampleReference } from "../../drizzle/schema";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB (same cap as aiAdvancedVisionRouter)

const keyInput = z.object({
  productCode: z.string().min(1).max(128).nullable().optional(),
  recipeCode: z.string().min(1).max(128).nullable().optional(),
  stationCode: z.string().min(1).max(128).nullable().optional(),
  roiKey: z.string().min(1).max(128).nullable().optional(),
  /** When the exact key has no golden, fall back to the product-level one (default true). */
  fallbackToProductLevel: z.boolean().optional(),
});

function decodeBase64Image(b64: string): Buffer {
  const cleaned = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  let buf: Buffer;
  try {
    buf = Buffer.from(cleaned, "base64");
  } catch {
    // Task 5 (doc 71) — xem ghi chú cùng pattern ở aiAdvancedVisionRouter.ts:
    // reason tách 3 nguyên nhân trước đây render 1 câu; nhánh vượt dung lượng tái
    // dùng KB_FILE_TOO_LARGE{limitMb}, KHÔNG nhồi vào INVALID_VALUE.
    throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "image", reason: "invalidBase64Image" }, "Invalid base64 image");
  }
  if (buf.length === 0) throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "image", reason: "emptyImagePayload" }, "Empty image payload");
  if (buf.length > MAX_IMAGE_BYTES) {
    throw appError(
      "PAYLOAD_TOO_LARGE",
      "KB_FILE_TOO_LARGE",
      { limitMb: Math.round((MAX_IMAGE_BYTES / (1024 * 1024)) * 10) / 10 },
      `Image exceeds ${MAX_IMAGE_BYTES} bytes`,
    );
  }
  return buf;
}

/**
 * Resolve a measurement's stored image to raw bytes. Tries, in order:
 * imageKey (local uploads, path-traversal-safe), data: URL, /uploads/ relative
 * URL (read from disk), absolute http(s) URL (fetched server-side, size-capped).
 * Honest failure: BAD_REQUEST with the reason — never a fabricated image.
 */
async function loadMeasurementImage(m: { imageUrl: string | null; imageKey?: string | null }): Promise<Buffer> {
  if (m.imageKey) {
    try {
      const p = resolveSafeImagePath(
        m.imageKey.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/^uploads\//i, ""),
      );
      return await fs.promises.readFile(p);
    } catch {
      // fall through to imageUrl
    }
  }
  const url = m.imageUrl;
  if (!url) {
    throw appError("BAD_REQUEST", "ENTITY_NOT_FOUND", { entity: "image" }, "Measurement has no stored image (imageUrl/imageKey empty)");
  }
  // data: URL or /uploads/… (resolveImageToDataUrl converts local files to data URLs)
  const resolved = url.startsWith("data:") ? url : await resolveImageToDataUrl(url);
  if (resolved?.startsWith("data:")) {
    return decodeBase64Image(resolved);
  }
  if (resolved && /^https?:\/\//i.test(resolved)) {
    let res: Response;
    try {
      res = await fetch(resolved);
    } catch (err) {
      throw appError(
        "BAD_REQUEST",
        "OPERATION_FAILED",
        { operation: "fetchMeasurementImage" },
        `Cannot fetch measurement image: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!res.ok) {
      throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "fetchMeasurementImage" }, `Cannot fetch measurement image (HTTP ${res.status})`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    // Review round 1 (M-4) — cùng bệnh đã sửa ở decodeBase64Image() phía trên (2 nguyên
    // nhân khác nhau, cùng render "Giá trị không hợp lệ ở hình ảnh."): tách reason cho
    // ca rỗng, tái dùng KB_FILE_TOO_LARGE{limitMb} cho ca vượt dung lượng.
    if (buf.length === 0) {
      throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "image", reason: "emptyImagePayload" }, "Fetched image is empty or exceeds the 10 MB cap");
    }
    if (buf.length > MAX_IMAGE_BYTES) {
      throw appError(
        "BAD_REQUEST",
        "KB_FILE_TOO_LARGE",
        { limitMb: Math.round((MAX_IMAGE_BYTES / (1024 * 1024)) * 10) / 10 },
        "Fetched image is empty or exceeds the 10 MB cap",
      );
    }
    return buf;
  }
  throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "fetchMeasurementImage" }, `Unresolvable measurement image URL: ${url.slice(0, 80)}`);
}

/** Serialize a golden row for API responses (metadata only — no gray plane). */
function rowMeta(r: GoldenSampleReference) {
  return {
    id: r.id,
    productCode: r.productCode,
    productModelId: r.productModelId ?? null,
    recipeCode: r.recipeCode,
    stationCode: r.stationCode,
    roiKey: r.roiKey,
    version: r.version,
    active: r.active,
    status: r.status,
    approvedBy: r.approvedBy,
    approvedAt: r.approvedAt,
    approvalNote: r.approvalNote,
    alignBeforeDiff: r.alignBeforeDiff,
    sourceInspectionId: r.sourceInspectionId,
    sourceMeasurementId: r.sourceMeasurementId,
    width: r.width,
    height: r.height,
    imageUrl: r.imageUrl,
    notes: r.notes,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Map workflow errors to honest TRPC codes (SoD → FORBIDDEN, lifecycle → BAD_REQUEST). */
function mapGoldenError(err: unknown): never {
  if (err instanceof GoldenSoDError) {
    throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "selfApproveGoldenSample" }, err.message);
  }
  if (err instanceof GoldenStatusError) {
    throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "manageGoldenSample" }, err.message);
  }
  throw err;
}

/**
 * Phạm vi nhà máy cho GHI / so sánh golden sample (rà bảo mật 2026-10-25, lô W10): golden thuộc MỘT sản phẩm (theo mã hoặc productModelId) ⇒ LUẬT GHI THEO SẢN PHẨM
 * (trong phạm vi hoặc nháp). Lượt kiểm tra phải thuộc máy trong phạm vi. Ngoài phạm vi ≡ không tồn tại. Mã sản phẩm KHÔNG tồn tại (golden cũ theo mã) giữ hành vi cũ.
 */
async function sanPhamTheoMa(ctx: CoDanhTinh, code: string | null | undefined): Promise<void> {
  if (!code) return;
  const p = await db.getProductModelByCode(code);
  if (p) await sanPhamGhiTrongPhamVi(ctx, p.id);
}
async function mauGoldenGhi(ctx: CoDanhTinh, id: number): Promise<void> {
  const d = await db.getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  const rows = (await d.execute(sql`SELECT "productModelId" AS p, "productCode" AS c FROM golden_sample_references WHERE id = ${id}`)) as unknown as Array<{ p: number | null; c: string | null }>;
  const r = rows[0];
  if (!r) return; // không có hàng: để dịch vụ trả NOT_FOUND như trước
  if (r.p != null) await sanPhamGhiTrongPhamVi(ctx, Number(r.p));
  else await sanPhamTheoMa(ctx, r.c);
}
async function luotKiemGoldenGhi(ctx: CoDanhTinh, inspection: { machineId?: number | null; productModel?: string | null }): Promise<void> {
  if (inspection.machineId != null) await mayTrongPhamVi(ctx, inspection.machineId);
  await sanPhamTheoMa(ctx, inspection.productModel);
}

/**
 * phạm vi người dùng (L6a 2026-10-25): tập golden người gọi THẤY ĐƯỢC. Golden gắn sản phẩm (productModelId, hoặc productCode → mô hình); thấy ⇔ sản phẩm TRONG phạm vi
 * (`sanPhamTrongPhamVi`, cùng đường danh sách sản phẩm). Không xác định được sản phẩm ⇒ chỉ toàn quyền (fail-closed). Toàn quyền ⇒ tất cả.
 */
async function goldenThayDuocTrongPhamVi<T extends { productModelId?: number | null; productCode?: string | null }>(ctx: CoDanhTinh, rows: T[]): Promise<T[]> {
  const pv = phamViCua(ctx);
  const nho = new Map<string, boolean>();
  const out: T[] = [];
  for (const r of rows) {
    let id: number | null = r.productModelId ?? null;
    if (id == null && r.productCode) id = (await db.getProductModelByCode(r.productCode))?.id ?? null;
    const khoa = id == null ? "none" : String(id);
    if (!nho.has(khoa)) nho.set(khoa, await db.sanPhamTrongPhamVi(id ?? -1, pv));
    if (nho.get(khoa)) out.push(r);
  }
  return out;
}

export const goldenSampleRouter = router({
  /** ACTIVE (approved) golden for a key (exact → product-level fallback), with thumbnail. */
  getActiveForKey: protectedProcedure
    .input(keyInput)
    .query(async ({ input, ctx }) => {
      const resolved = await resolveActiveReference(
        {
          productCode: input.productCode ?? null,
          recipeCode: input.recipeCode ?? null,
          stationCode: input.stationCode ?? null,
          roiKey: input.roiKey ?? null,
        },
        { fallbackToProductLevel: input.fallbackToProductLevel ?? true },
      );
      if (!resolved || (await goldenThayDuocTrongPhamVi(ctx, [resolved.row])).length === 0) return { found: false as const }; // phạm vi người dùng (L6a 2026-10-25)

      const { row, matchedLevel } = resolved;
      return {
        found: true as const,
        matchedLevel,
        reference: {
          ...rowMeta(row),
          thumbnailDataUrl: await referenceThumbnailDataUrl(row),
        },
      };
    }),

  /** Metadata list of a product's goldens (active-only by default; no image payload). */
  listForProduct: protectedProcedure
    .input(z.object({
      productCode: z.string().min(1).max(128),
      activeOnly: z.boolean().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const rows = await goldenThayDuocTrongPhamVi(ctx, await listReferences({ // phạm vi người dùng (L6a 2026-10-25)
        productCode: input.productCode,
        activeOnly: input.activeOnly ?? true,
        limit: input.limit ?? 100,
      }));
      return rows.map(rowMeta);
    }),

  /**
   * Doc 31 PM5 / UX8 — a PRODUCT MODEL's goldens (by FK, falling back to legacy
   * productCode). This is what the product-page golden panel queries — keyed by
   * productModelId so it survives a product-code rename. Optional thumbnails.
   */
  listByProduct: protectedProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      activeOnly: z.boolean().optional(),
      status: z.enum(["draft", "approved", "retired"]).optional(),
      withThumbnails: z.boolean().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const product = await db.getProductModelById(input.productModelId);
      const limit = input.withThumbnails ? Math.min(input.limit ?? 100, 100) : (input.limit ?? 200);
      const rows = await goldenThayDuocTrongPhamVi(ctx, await listByProduct({ // phạm vi người dùng (L6a 2026-10-25)
        productModelId: input.productModelId,
        productCode: product?.code ?? null,
        activeOnly: input.activeOnly ?? false,
        status: input.status ?? null,
        limit,
      }));
      return Promise.all(rows.map(async (r) => ({
        ...rowMeta(r),
        thumbnailDataUrl: input.withThumbnails ? await referenceThumbnailDataUrl(r) : null,
      })));
    }),

  /**
   * W7-C (V8) — management list: all goldens (any product), filterable by
   * product/status, with optional thumbnails (capped at 100 rows when enabled).
   */
  listManaged: protectedProcedure
    .input(z.object({
      productCode: z.string().min(1).max(128).optional(),
      status: z.enum(["draft", "approved", "retired"]).optional(),
      activeOnly: z.boolean().optional(),
      withThumbnails: z.boolean().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const limit = input.withThumbnails ? Math.min(input.limit ?? 100, 100) : (input.limit ?? 200);
      const rows = await goldenThayDuocTrongPhamVi(ctx, await listReferences({ // phạm vi người dùng (L6a 2026-10-25)
        productCode: input.productCode ?? null,
        status: input.status ?? null,
        activeOnly: input.activeOnly ?? false,
        limit,
      }));
      return Promise.all(rows.map(async (r) => ({
        ...rowMeta(r),
        thumbnailDataUrl: input.withThumbnails ? await referenceThumbnailDataUrl(r) : null,
      })));
    }),

  /** W7-C (V8) — capture a DRAFT golden from an uploaded image (base64). */
  captureFromUpload: qualityProcedure
    .input(z.object({
      productCode: z.string().min(1).max(128),
      recipeCode: z.string().min(1).max(128).optional(),
      stationCode: z.string().min(1).max(128).optional(),
      roiKey: z.string().min(1).max(128).optional(),
      imageBase64: z.string().min(16),
      notes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await sanPhamTheoMa(ctx, input.productCode);
      const image = decodeBase64Image(input.imageBase64);
      // Doc 31 PM5 — resolve the FK from the product code so a rename can't orphan
      // this golden. Legacy/unknown codes stay NULL (still work via productCode).
      const product = await db.getProductModelByCode(input.productCode);
      const row = await submitDraft({
        productCode: input.productCode,
        productModelId: product?.id ?? null,
        recipeCode: input.recipeCode ?? null,
        stationCode: input.stationCode ?? null,
        roiKey: input.roiKey ?? null,
        image,
        notes: input.notes ?? null,
        createdBy: ctx.user.id,
      });
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "goldenSample.captureFromUpload",
        entityType: "golden_sample_reference",
        entityId: row.id,
        details: {
          productCode: row.productCode, recipeCode: row.recipeCode,
          stationCode: row.stationCode, roiKey: row.roiKey,
          version: row.version, status: row.status,
        },
        status: "success",
      });
      return { ...rowMeta(row), thumbnailDataUrl: await referenceThumbnailDataUrl(row) };
    }),

  /**
   * W7-C (V8) — capture a DRAFT golden from a KNOWN-GOOD measurement's stored
   * image. Guard: the measurement point result must be OK (a golden is a
   * known-good reference — capturing an NG image is refused honestly). Key is
   * (productCode = inspection.productModel, roiKey = point code) — the same key
   * InspectionDetail resolves against.
   */
  captureFromInspection: qualityProcedure
    .input(z.object({
      measurementResultId: z.number().int().positive(),
      /** Optional key overrides (default: product from the inspection, roi from the point def). */
      recipeCode: z.string().min(1).max(128).optional(),
      stationCode: z.string().min(1).max(128).optional(),
      roiKey: z.string().min(1).max(128).optional(),
      notes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const m = await db.getMeasurementResultById(input.measurementResultId);
      if (!m) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "measurementResult" }, "Measurement result not found");
      if (m.result !== "OK") {
        throw appError(
          "BAD_REQUEST",
          "OPERATION_FAILED",
          { operation: "captureGoldenSample" },
          `Chỉ chụp golden từ điểm đo OK (điểm này: ${m.result})`,
        );
      }
      const inspection = await db.getProductInspectionById(m.inspectionId);
      if (!inspection) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "inspection" }, "Inspection not found");
      await luotKiemGoldenGhi(ctx, inspection); // phạm vi nhà máy: lượt kiểm tra phải thuộc máy trong phạm vi, sản phẩm theo luật ghi theo sản phẩm
      const productCode = inspection.productModel;
      if (!productCode) {
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "captureGoldenSample" }, "Inspection has no product model — cannot key the golden");
      }

      // Point code → roiKey (same join style as measurementResult.getById).
      let roiKey: string | null = input.roiKey ?? null;
      if (!roiKey) {
        const { measurementPointDefs } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const dbi = await db.getDb();
        if (dbi) {
          const [pointDef] = await dbi.select().from(measurementPointDefs)
            .where(eq(measurementPointDefs.id, m.pointDefId)).limit(1);
          roiKey = pointDef?.code ?? null;
        }
      }

      const image = await loadMeasurementImage(m);
      // Doc 31 PM5 — resolve the FK from the inspection's product code.
      const productForFk = await db.getProductModelByCode(productCode);
      const row = await submitDraft({
        productCode,
        productModelId: productForFk?.id ?? null,
        recipeCode: input.recipeCode ?? null,
        stationCode: input.stationCode ?? null,
        roiKey,
        image,
        imageUrl: m.imageUrl ?? null,
        notes: input.notes ?? `Captured from inspection #${m.inspectionId} (SN ${inspection.serialNumber}), measurement #${m.id}`,
        createdBy: ctx.user.id,
        sourceInspectionId: m.inspectionId,
        sourceMeasurementId: m.id,
      });
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "goldenSample.captureFromInspection",
        entityType: "golden_sample_reference",
        entityId: row.id,
        details: {
          productCode, roiKey, version: row.version, status: row.status,
          sourceInspectionId: m.inspectionId, sourceMeasurementId: m.id,
        },
        status: "success",
      });
      return { ...rowMeta(row), thumbnailDataUrl: await referenceThumbnailDataUrl(row) };
    }),

  /** W7-C (V11) — approve a draft (SoD: capturer ≠ approver) → becomes the active golden. */
  approve: qualityProcedure
    .input(z.object({ id: z.number().int().positive(), note: z.string().max(2000).optional() }))
    .mutation(async ({ input, ctx }) => {
      await mauGoldenGhi(ctx, input.id);
      const row = await approveReference({ id: input.id, approvedBy: ctx.user.id, note: input.note ?? null })
        .catch(mapGoldenError);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "goldenSample.approve",
        entityType: "golden_sample_reference",
        entityId: row.id,
        details: { productCode: row.productCode, roiKey: row.roiKey, version: row.version, note: input.note ?? null },
        status: "success",
      });
      return rowMeta(row);
    }),

  /** W7-C (V11) — reject a draft (→ retired, never activated). */
  reject: qualityProcedure
    .input(z.object({ id: z.number().int().positive(), note: z.string().max(2000).optional() }))
    .mutation(async ({ input, ctx }) => {
      await mauGoldenGhi(ctx, input.id);
      const row = await rejectReference(input.id, input.note ?? null).catch(mapGoldenError);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "goldenSample.reject",
        entityType: "golden_sample_reference",
        entityId: row.id,
        details: { productCode: row.productCode, roiKey: row.roiKey, version: row.version, note: input.note ?? null },
        status: "success",
      });
      return rowMeta(row);
    }),

  /** W7-C (V11) — retire an approved golden (removed from production resolution). */
  retire: qualityProcedure
    .input(z.object({ id: z.number().int().positive(), note: z.string().max(2000).optional() }))
    .mutation(async ({ input, ctx }) => {
      await mauGoldenGhi(ctx, input.id);
      const row = await retireReference(input.id, input.note ?? null).catch(mapGoldenError);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "goldenSample.retire",
        entityType: "golden_sample_reference",
        entityId: row.id,
        details: { productCode: row.productCode, roiKey: row.roiKey, version: row.version, note: input.note ?? null },
        status: "success",
      });
      return rowMeta(row);
    }),

  /** W7-C (V7) — toggle per-golden align-before-diff. */
  setAlignBeforeDiff: qualityProcedure
    .input(z.object({ id: z.number().int().positive(), enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await mauGoldenGhi(ctx, input.id);
      const row = await setAlignBeforeDiff(input.id, input.enabled).catch(mapGoldenError);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "goldenSample.setAlignBeforeDiff",
        entityType: "golden_sample_reference",
        entityId: row.id,
        details: { enabled: input.enabled },
        status: "success",
      });
      return rowMeta(row);
    }),

  /** Full-size preview of one stored golden (PNG data URL). */
  getThumbnail: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const row = await getReferenceById(input.id);
      if (!row || (await goldenThayDuocTrongPhamVi(ctx, [row])).length === 0) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "goldenReference" }, "Golden reference not found"); // phạm vi người dùng (L6a 2026-10-25)
      return { id: row.id, thumbnailDataUrl: await referenceThumbnailDataUrl(row) };
    }),

  /**
   * W7-C (V7+V15) — diff a measurement's stored image against its resolved
   * APPROVED golden: normalize → sub-pixel align (per-golden flag) → heatmap diff.
   * Returns { found:false } when no approved golden exists for the key — honest.
   */
  diffForMeasurement: protectedProcedure
    .input(z.object({
      measurementResultId: z.number().int().positive(),
      normalize: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const m = await db.getMeasurementResultById(input.measurementResultId);
      if (!m) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "measurementResult" }, "Measurement result not found");
      const inspection = await db.getProductInspectionById(m.inspectionId);
      if (inspection) await luotKiemGoldenGhi(ctx, inspection); // phạm vi nhà máy
      if (!inspection?.productModel) {
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "resolveGoldenSample" }, "Inspection has no product model — cannot resolve a golden");
      }
      // roiKey = point code (same key InspectionDetail queries with).
      let roiKey: string | null = null;
      {
        const { measurementPointDefs } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const dbi = await db.getDb();
        if (dbi) {
          const [pointDef] = await dbi.select().from(measurementPointDefs)
            .where(eq(measurementPointDefs.id, m.pointDefId)).limit(1);
          roiKey = pointDef?.code ?? null;
        }
      }
      const image = await loadMeasurementImage(m);
      const r = await goldenDiffForKey(
        { productCode: inspection.productModel, roiKey },
        image,
        { normalize: input.normalize ?? true },
      );
      if (!r) return { found: false as const };
      return {
        found: true as const,
        golden: r.golden,
        width: r.width,
        height: r.height,
        heatmapPngBase64: r.heatmapPng.toString("base64"),
        hotspots: r.hotspots,
        totalDiffPixels: r.totalDiffPixels,
        diffRatio: r.diffRatio,
        diffScore: r.diffScore,
        normalized: r.normalized,
        aligned: r.aligned,
        alignment: r.alignment,
      };
    }),

  /** W7-C — diff an uploaded candidate (base64) against the resolved golden for a key. */
  diffWithUpload: protectedProcedure
    .input(z.object({
      productCode: z.string().min(1).max(128),
      recipeCode: z.string().min(1).max(128).optional(),
      stationCode: z.string().min(1).max(128).optional(),
      roiKey: z.string().min(1).max(128).optional(),
      candidateBase64: z.string().min(16),
      normalize: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await sanPhamTheoMa(ctx, input.productCode);
      const candidate = decodeBase64Image(input.candidateBase64);
      const r = await goldenDiffForKey(
        {
          productCode: input.productCode,
          recipeCode: input.recipeCode ?? null,
          stationCode: input.stationCode ?? null,
          roiKey: input.roiKey ?? null,
        },
        candidate,
        { normalize: input.normalize ?? true },
      );
      if (!r) return { found: false as const };
      return {
        found: true as const,
        golden: r.golden,
        width: r.width,
        height: r.height,
        heatmapPngBase64: r.heatmapPng.toString("base64"),
        hotspots: r.hotspots,
        totalDiffPixels: r.totalDiffPixels,
        diffRatio: r.diffRatio,
        diffScore: r.diffScore,
        normalized: r.normalized,
        aligned: r.aligned,
        alignment: r.alignment,
      };
    }),
});
