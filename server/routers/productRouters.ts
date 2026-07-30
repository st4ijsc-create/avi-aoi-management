import { protectedProcedure, qualityProcedure, writeProcedure, router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { requirePermission } from "../_core/accessControl";
import { z } from "zod";
import * as db from "../db";
import { withDbErrors } from "../_core/dbErrors";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { nanoid } from "nanoid";
import { storagePut, resolveImageToDataUrl } from "../storage";
import { detectSpcViolations, detectEwma, rollingCapability } from "../utils/spcRules";
import { publishSpcAlert, loadDefaultSinksFromEnv } from "../utils/spcAlertSink";
import { routeSpcViolationsToCentral } from "../services/spcCentralAlertBridge";
import { calculateAnovaGrr, calculateBias, calculateLinearity, calculateStability } from "../utils/msaAdvanced";
import { assertInstrumentReady } from "../utils/instrumentGate";
import { parseCad } from "../utils/cadParsers";
// Doc 31 MP5/PM4 (Đợt C, decision #5) — generic centroid/pick-place import.
import { inspectCentroidHeaders } from "../services/cad/centroidParser";
import {
  previewCentroidImport,
  commitCentroidImport,
  applyCentroidImport,
  // Doc 54 §11 P0.1 — apply CAD/centroid coords onto EXISTING points (fix 0,0).
  previewCoordinateApply,
  applyCoordinatesToPoints,
} from "../services/cad/centroidImportService";
import { createHash } from "node:crypto";
import {
  measurementGeometrySchema,
  pointShapeEnum,
  deriveLegacyAnchor,
  type MeasurementGeometry,
} from "../lib/measurementGeometry";
// Doc 31 OP2 (decision #4) — lifecycle gate for direct threshold edits.
import {
  assertThresholdEditAllowed,
  type ThresholdGateResult,
} from "../services/thresholdGovernanceService";
// Doc 31 MP1/PM6 — BOM-driven componentCode backfill (lights up Pareto-by-package).
import { backfillComponentCodesFromBom } from "../services/componentLinkBackfill";
// Doc 31 MP3 (WB-2) — __UNMAPPED__ unmatched-rate metric + remap helpers.
import {
  getUnmappedPointRate,
  getUnmappedProductModelId,
  type UnmappedRateFilter,
} from "../services/measurementPointResolver";
// Doc 31 UX2/PM9 (WD-2) — product config-completeness ("readiness") score.
import {
  computeProductReadiness,
  computeProductReadinessBatch,
} from "../services/productReadinessService";
// Doc 31 OP5 (decision #3) — AQL lot-acceptance engine consuming sampling plans.
import {
  evaluateLotAcceptance,
  listLotDispositions,
} from "../services/lotAcceptanceService";
// Doc 42 Đợt 4A (APPLY-B) — engine import/export dùng chung cho danh sách sản phẩm.
import { exportRows, type MasterDataColumn } from "../services/masterDataIO";
// Doc 51 P1 (R4) — machines learn about point-config changes off this MQTT topic.
import { publishPointsConfigChanged } from "../services/mqttService";

// ══════════════════════════════════════════════════════════════════════════════
// Doc 51 P1 (R4) — pointsConfigVersion propagation
// ──────────────────────────────────────────────────────────────────────────────
// THE BUG this closes: `pointsConfigVersion` was bumped in exactly ONE place in
// this file — CAD applyJob — so measurementPoint.create / update / delete through
// the UI left the version untouched. checkPointsVersion then answered "no changes"
// and deltaSyncPoints returned an empty set FOREVER: every AOI/AVI machine kept
// inspecting against the config it happened to fetch first. New points never got
// inspected, retired points kept failing boards, and re-tuned limits never landed —
// silently, with a green UI telling the engineer the edit was saved.
//
// Every mutation that touches measurement_point_defs MUST route through here.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Bump a product's pointsConfigVersion and tell the machines to re-fetch.
 *
 * Failure policy is deliberately split:
 *  • The DB bump PROPAGATES. Swallowing it would silently reproduce the exact bug
 *    this fixes. It is safe to surface: the point write itself is now idempotent
 *    (0274 + ON CONFLICT), so the client's retry converges instead of duplicating.
 *  • The MQTT publish is BEST-EFFORT. It is only a latency optimisation — machines
 *    also poll checkPointsVersion, so a dead broker delays convergence to the next
 *    poll rather than losing it. Never fail an engineer's save over that.
 *
 * `bumped === null` ⇒ the product row is gone (soft-deleted) → nothing to notify.
 */
async function bumpAndNotifyPointsConfig(
  productModelId: number | null | undefined,
  // Doc 55 Item 3 PV2 (QĐ#14) — OPTIONAL variant to scope the MQTT notify to. Absent
  // ⇒ the legacy base topic (byte-identical). See publishPointsConfigChanged.
  variantCode?: string,
) {
  if (productModelId == null) return null;
  const bumped = await db.bumpPointsConfigVersion(productModelId);
  if (!bumped) return null;
  try {
    publishPointsConfigChanged(bumped.code, bumped.version, undefined, variantCode);
  } catch (err) {
    console.warn("[doc51 R4] publishPointsConfigChanged failed (machines will pick it up on next poll)", err);
  }
  return bumped;
}

/**
 * Doc 55 Item 3 PV2 (QĐ#14) — resolve the variant CODE to scope a config-changed
 * notify to, from the point row being edited. Flag-gated + forgiving:
 *   • PRODUCT_VARIANT_ENABLED off, no point, or a NULL/base variantId ⇒ undefined
 *     (the base/model fan-out topic — byte-identical to the pre-variant behaviour).
 *   • a NON-BASE variant point ⇒ that variant's code.
 * Best-effort: any lookup failure degrades to undefined (base topic), never throws
 * into an engineer's save.
 */
async function variantCodeForPointNotify(
  point: { variantId?: number | null } | null | undefined,
): Promise<string | undefined> {
  if (!productVariantEnabledPR() || point?.variantId == null) return undefined;
  try {
    const v = await db.getVariantById(point.variantId);
    return v && !v.isBase ? v.code : undefined;
  } catch {
    return undefined;
  }
}

/** Local mirror of machineApiRouters.productVariantEnabled (avoids a router↔router import cycle). */
function productVariantEnabledPR(): boolean {
  const s = String(process.env.PRODUCT_VARIANT_ENABLED ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "on";
}

// ══════════════════════════════════════════════════════════════════════════════
// Doc 51 P2 (CASE #6) — recover inspections that arrived BEFORE their product model
// ──────────────────────────────────────────────────────────────────────────────
// THE BUG this closes: an AOI/AVI machine can post an inspection for a product
// model that does not exist in the DB yet (new SKU on the line before engineering
// onboards it). The machine-API ingest stores `productModelId = NULL` but keeps the
// raw `productModel` code string for backward compatibility. When the engineer
// later creates that model, the historical inspections STAY NULL forever — and
// every by-model report GROUP/JOINs on `productModelId`, so those inspections
// silently vanish from the model's yield/defect/SPC history.
//
// Fix: the moment a model with code `C` exists (create — and, defensively, an
// update that touches an existing model), stamp `productModelId` onto every
// inspection whose raw `productModel = C` and whose id is still NULL. This is a
// pure data-RECOVERY UPDATE (NULL → the now-known id); it never overwrites an
// existing link and cannot change any already-attributed row.
//
// Isolation contract: best-effort. It is awaited (so the count is logged
// deterministically and it is testable end-to-end) but wrapped so it can NEVER
// throw into — or otherwise fail — the model create/update mutation. Gated by
// INSPECTION_MODEL_BACKFILL_ENABLED (default "true"; QĐ#1 controllable switch) so
// ops can disable it if the sweep is ever too heavy on a very large hypertable.
export function isInspectionModelBackfillEnabled(): boolean {
  return String(process.env.INSPECTION_MODEL_BACKFILL_ENABLED ?? "true").toLowerCase() !== "false";
}

/**
 * Backfill `product_inspections.productModelId` for a newly-known model.
 * Returns the number of inspection rows re-anchored (0 on any failure / when
 * disabled). NEVER throws — safe to call from inside a mutation.
 */
export async function backfillInspectionsForModel(
  productModelId: number,
  code: string,
): Promise<number> {
  if (!isInspectionModelBackfillEnabled()) return 0;
  if (!Number.isInteger(productModelId) || productModelId <= 0 || !code) return 0;
  try {
    const { sql } = await import("drizzle-orm");
    const database = await db.getDb();
    if (!database) return 0;
    // CTE so a single round-trip both UPDATEs and returns the affected count,
    // without RETURNING every id of a potentially large backlog.
    const rows = (await database.execute(sql`
      WITH upd AS (
        UPDATE product_inspections
           SET "productModelId" = ${productModelId}
         WHERE "productModel" = ${code}
           AND "productModelId" IS NULL
        RETURNING 1
      )
      SELECT count(*)::int AS n FROM upd`)) as unknown as Array<{ n: number }>;
    const n = Number(rows?.[0]?.n ?? 0);
    if (n > 0) {
      console.log(`[doc51 P2] backfilled ${n} orphan inspection(s) → productModelId=${productModelId} (code='${code}')`);
    }
    return n;
  } catch (err) {
    console.warn(`[doc51 P2] inspection backfill failed for code='${code}' (best-effort, ignored)`, (err as Error)?.message);
    return 0;
  }
}

const legacyMeasurementTypeValues = ["DIMENSION", "VISUAL", "ELECTRICAL", "POSITION", "COLOR", "SURFACE", "OTHER"] as const;
const legacyMeasurementTypeSchema = z.enum(legacyMeasurementTypeValues);

// Doc 31 MP5/PM4 — centroid import Zod schemas (configurable column map + opts).
const centroidColumnRef = z.union([z.number().int().nonnegative(), z.string()]);
const centroidColumnMapSchema = z.object({
  refDesignator: centroidColumnRef,
  x: centroidColumnRef,
  y: centroidColumnRef,
  rotation: centroidColumnRef.optional(),
  side: centroidColumnRef.optional(),
  package: centroidColumnRef.optional(),
  componentCode: centroidColumnRef.optional(),
  placedStatus: centroidColumnRef.optional(),
  name: centroidColumnRef.optional(),
});
const centroidParseOptionsSchema = z.object({
  delimiter: z.enum([",", ";", "\t", "auto"]).optional(),
  decimal: z.enum([".", ","]).optional(),
  hasHeader: z.boolean().optional(),
  commentPrefixes: z.array(z.string().max(4)).max(8).optional(),
});
const centroidTransformOptionsSchema = z.object({
  unit: z.enum(["mm", "cm", "mil", "inch", "um"]).optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
  targetMode: z.enum(["mm", "pixel"]).optional(),
  fitToImage: z.boolean().optional(),
  marginPct: z.number().min(0).max(45).optional(),
  scale: z.number().positive().max(100000).optional(),
  offsetX: z.number().optional(),
  offsetY: z.number().optional(),
});

const toleranceModeSchema = z.enum(["min_only", "max_only", "range", "bilateral"]);
const materialConditionSchema = z.enum(["MMC", "LMC", "RFS"]);

const criteriaItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("numeric_range"),
    metric: z.string().min(1).max(100),
    min: z.union([z.string(), z.number()]).optional(),
    max: z.union([z.string(), z.number()]).optional(),
    unit: z.string().max(20).optional(),
  }),
  z.object({
    kind: z.literal("boolean_check"),
    metric: z.string().min(1).max(100),
    expected: z.boolean(),
  }),
  z.object({
    kind: z.literal("text_match"),
    metric: z.string().min(1).max(100),
    expected: z.string().max(255),
    mode: z.enum(["exact", "contains", "regex"]).default("exact"),
  }),
]);

function mapCatalogCategoryToLegacyType(category?: string | null): z.infer<typeof legacyMeasurementTypeSchema> {
  switch ((category ?? "").toUpperCase()) {
    case "DIMENSION":
    case "GD_T":
      return "DIMENSION";
    case "ELECTRICAL":
      return "ELECTRICAL";
    case "POSITION":
      return "POSITION";
    case "COLOR":
      return "COLOR";
    case "SURFACE":
      return "SURFACE";
    case "OTHER":
      return "OTHER";
    default:
      return "VISUAL";
  }
}

function toNumberOrNull(value?: string | number | null): number | null {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveLegacyLimitsFromTolerance(input: {
  toleranceMode?: z.infer<typeof toleranceModeSchema>;
  nominalValue?: string;
  tolPlus?: string;
  tolMinus?: string;
  lowerLimit?: string;
  upperLimit?: string;
}) {
  if (input.toleranceMode !== "bilateral") {
    return {
      lowerLimit: input.lowerLimit,
      upperLimit: input.upperLimit,
    };
  }
  const nominal = toNumberOrNull(input.nominalValue);
  const plus = toNumberOrNull(input.tolPlus);
  const minus = toNumberOrNull(input.tolMinus);
  if (nominal === null || plus === null || minus === null) {
    return {
      lowerLimit: input.lowerLimit,
      upperLimit: input.upperLimit,
    };
  }
  return {
    lowerLimit: String(nominal - minus),
    upperLimit: String(nominal + plus),
  };
}

async function resolveLegacyMeasurementType(measurementTypeCode?: string, fallback?: z.infer<typeof legacyMeasurementTypeSchema>) {
  if (measurementTypeCode) {
    const catalog = await db.getMeasurementTypeCatalogByCode(measurementTypeCode);
    if (catalog) {
      return mapCatalogCategoryToLegacyType(catalog.category);
    }
  }
  return fallback ?? "VISUAL";
}

// ── Doc 31 PM8 — image-dimension enforcement flags (read per-call) ────────────
// A reference image MUST resolve to width/height so point coordinates can be
// stored resolution-independently (normalized). Default: enforced on upload.
// Break-glass: PRODUCT_IMAGE_DIMS_REQUIRED=false lets an image through without
// extractable dims (dev/legacy only).
function isProductImageDimsRequired(): boolean {
  return process.env.PRODUCT_IMAGE_DIMS_REQUIRED !== "false";
}
// Blocking point-save when the owning product has no dims is OPT-IN (default
// off) — turning it on before the 4 dev products are backfilled would break
// authoring, and WC-1 (centroid import) also needs dims. Set
// PRODUCT_POINT_REQUIRE_DIMS=true once every live product carries dims.
function isPointSaveDimsRequired(): boolean {
  return process.env.PRODUCT_POINT_REQUIRE_DIMS === "true";
}
// Extract (width,height) from a base64 data URL via sharp. Independent of the
// storage backend so dims are known even when Forge is not configured.
async function extractDimsFromDataUrl(
  dataUrl: string,
): Promise<{ width?: number; height?: number }> {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) return {};
  try {
    const buffer = Buffer.from(matches[2], "base64");
    const sharp = (await import("sharp")).default;
    const metadata = await sharp(buffer).metadata();
    return { width: metadata.width, height: metadata.height };
  } catch {
    return {};
  }
}

// ============ PRODUCT MODEL ROUTER ============
// ─── Doc 42 Đợt 4A (APPLY-B) — import/export danh sách sản phẩm ────────────────
// Trạng thái vòng đời hợp lệ (khớp lifecycleStatusEnum + productModel.create).
const productLifecycleValues = ["development", "active", "eol", "archived"] as const;

// Cột NHẬP (parse + validate) & mẫu — trùng khớp cột client trong ProductModels.tsx
// (cả hai phía validate cùng luật @shared/masterDataIO nên không lệch).
const PRODUCT_IMPORT_COLUMNS: MasterDataColumn[] = [
  { field: "code", header: "Mã sản phẩm", required: true, type: "string", example: "SP-001" },
  { field: "name", header: "Tên sản phẩm", required: true, type: "string", example: "Bảng mạch A" },
  { field: "description", header: "Mô tả", type: "string" },
  { field: "category", header: "Nhóm", type: "string", example: "PCBA" },
  { field: "productLine", header: "Dòng sản phẩm", type: "string" },
  { field: "variant", header: "Biến thể", type: "string" },
  { field: "revision", header: "Phiên bản (Rev)", type: "string", example: "A" },
  { field: "lifecycleStatus", header: "Trạng thái vòng đời", type: "string", example: "active" },
  { field: "targetYieldRate", header: "FPY mục tiêu (%)", type: "number", example: 98 },
  { field: "minYieldRate", header: "FPY tối thiểu (%)", type: "number", example: 95 },
];

// Cột XUẤT = cột nhập + ngày tạo/cập nhật (chỉ đọc, không dùng khi nhập).
const PRODUCT_EXPORT_COLUMNS: MasterDataColumn[] = [
  ...PRODUCT_IMPORT_COLUMNS,
  { field: "createdAt", header: "Ngày tạo", type: "date" },
  { field: "updatedAt", header: "Ngày cập nhật", type: "date" },
];

export const productModelRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      lifecycleStatus: z.enum(["development", "active", "eol", "archived"]).optional(),
      sortBy: z.enum(["code", "name", "createdAt", "updatedAt"]).optional(),
      sortOrder: z.enum(["asc", "desc"]).optional(),
      limit: z.number().min(1).max(100).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getProductModels(input);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getProductModelById(input.id);
    }),

  getByCode: protectedProcedure
    .input(z.object({ code: z.string() }))
    .query(async ({ input }) => {
      const productModel = await db.getProductModelByCode(input.code);
      if (!productModel) return null;
      const measurementPoints = await db.getMeasurementPointDefsByProductModel(productModel.id);
      return { productModel, measurementPoints };
    }),

  // Doc 31 UX2/PM9 — config-completeness ("readiness") of ONE product: weighted
  // 0..100 score + per-item checklist (image/dims, points, limits%, componentCode%,
  // fiducials, golden, release, mapping, panel). Also consumed by WD-1's onboarding
  // wizard via computeProductReadiness(). Returns null when the product is unknown.
  getReadiness: protectedProcedure
    .input(z.object({ productModelId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return computeProductReadiness(input.productModelId);
    }),

  // Batched readiness for the product-list badges — CONSTANT query cost (no N+1).
  getReadinessBatch: protectedProcedure
    .input(z.object({ ids: z.array(z.number().int().positive()).max(300) }))
    .query(async ({ input }) => {
      if (input.ids.length === 0) return [];
      return computeProductReadinessBatch(input.ids);
    }),

  create: protectedProcedure.use(requirePermission("settings_products", "canCreate"))
    .input(z.object({
      code: z.string().min(1, "Mã sản phẩm là bắt buộc").max(100).regex(/^[A-Za-z0-9_\-]+$/, "Mã chỉ được chứa chữ, số, gạch dưới, gạch ngang"),
      name: z.string().min(1, "Tên sản phẩm là bắt buộc").max(255),
      description: z.string().optional(),
      category: z.string().optional(),
      categoryId: z.number().int().positive().optional(),
      productLine: z.string().optional(),
      variant: z.string().optional(),
      // Doc 31 PM2 (decision #6) — free-text engineering revision ("A", "B", "Rev2").
      revision: z.string().trim().max(32).optional(),
      lifecycleStatus: z.enum(["development", "active", "eol", "archived"]).optional(),
      targetYieldRate: z.string().optional(),
      minYieldRate: z.string().optional(),
      referenceImageUrl: z.string().optional(),
      referenceImageKey: z.string().optional(),
      imageWidth: z.number().int().nonnegative().max(100000).optional(),
      imageHeight: z.number().int().nonnegative().max(100000).optional(),
      imageDisplayMode: z.enum(["contain", "cover", "stretch", "none"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      let finalImageUrl = input.referenceImageUrl;
      let finalImageKey = input.referenceImageKey;
      
      // Check if referenceImageUrl is a base64 data URL and upload to S3
      let autoImageWidth: number | undefined;
      let autoImageHeight: number | undefined;
      if (input.referenceImageUrl && input.referenceImageUrl.startsWith('data:')) {
        // PM8: extract dims FIRST, independent of the storage backend — dims are
        // a property of the image, not of whether Forge is configured.
        if (!input.imageWidth || !input.imageHeight) {
          const dims = await extractDimsFromDataUrl(input.referenceImageUrl);
          autoImageWidth = dims.width;
          autoImageHeight = dims.height;
        }
        const isForgeConfigured = !!(process.env.BUILT_IN_FORGE_API_URL && process.env.BUILT_IN_FORGE_API_KEY);
        if (!isForgeConfigured) {
          // Forge storage is not configured – skip external upload but do not fail creation
          console.warn('Forge storage not configured, skipping product model image upload for create');
        } else {
          try {
            // Parse base64 data URL
            const matches = input.referenceImageUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
              const mimeType = matches[1];
              const base64Data = matches[2];
              const buffer = Buffer.from(base64Data, 'base64');

              // Determine file extension
              const extMap: Record<string, string> = {
                'image/jpeg': 'jpg',
                'image/png': 'png',
                'image/gif': 'gif',
                'image/webp': 'webp',
              };
              const ext = extMap[mimeType] || 'jpg';
              const fileKey = `product-models/${input.code}-${nanoid(8)}.${ext}`;

              // Upload to S3
              const { url, key } = await storagePut(fileKey, buffer, mimeType);
              finalImageUrl = url;
              finalImageKey = key;
            }
          } catch (error) {
            console.error('Failed to upload product model image to S3:', error);
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to upload image' });
          }
        }
        // PM8 enforcement: an image was supplied but we could not determine its
        // dimensions and none were provided manually → refuse (coords would be
        // raw pixels, not portable). Break-glass via PRODUCT_IMAGE_DIMS_REQUIRED=false.
        const w = input.imageWidth ?? autoImageWidth;
        const h = input.imageHeight ?? autoImageHeight;
        if ((!w || !h) && isProductImageDimsRequired()) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Could not determine reference image dimensions. Provide imageWidth/imageHeight or upload a valid image. ' +
              'Không xác định được kích thước ảnh — cung cấp imageWidth/imageHeight hoặc tải ảnh hợp lệ.',
          });
        }
      }

      const id = await withDbErrors(() => db.createProductModel({
        ...input,
        referenceImageUrl: finalImageUrl,
        referenceImageKey: finalImageKey,
        imageWidth: input.imageWidth ?? autoImageWidth,
        imageHeight: input.imageHeight ?? autoImageHeight,
      }), { conflictMessage: `Mã sản phẩm '${input.code}' đã tồn tại` });
      // Doc 51 P2 (CASE #6): re-anchor any inspections that arrived before this
      // model existed. Best-effort + error-isolated (never blocks the create); the
      // recovered row count is logged inside the helper. Return shape unchanged.
      await backfillInspectionsForModel(id, input.code);
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "product.create",
          entityType: "product",
          entityId: id,
          entityName: input.code,
          details: { code: input.code, name: input.name, lifecycleStatus: input.lifecycleStatus },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (product.create)", err);
      }
      return { id };
    }),

  update: protectedProcedure.use(requirePermission("settings_products", "canEdit"))
    .input(z.object({
      id: z.number().int().positive(),
      code: z.string().min(1).max(100).regex(/^[A-Za-z0-9_\-]+$/, "Code may only contain letters, digits, underscore, dash").optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      category: z.string().optional(),
      categoryId: z.number().int().positive().optional(),
      productLine: z.string().optional(),
      variant: z.string().optional(),
      // Doc 31 PM2 (decision #6) — free-text engineering revision ("A", "B", "Rev2").
      revision: z.string().trim().max(32).optional(),
      lifecycleStatus: z.enum(["development", "active", "eol", "archived"]).optional(),
      targetYieldRate: z.string().optional(),
      minYieldRate: z.string().optional(),
      referenceImageUrl: z.string().optional(),
      referenceImageKey: z.string().optional(),
      imageWidth: z.number().int().nonnegative().max(100000).optional(),
      imageHeight: z.number().int().nonnegative().max(100000).optional(),
      imageDisplayMode: z.enum(["contain", "cover", "stretch", "none"]).optional(),
      isActive: z.boolean().optional(),
      changeReason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, changeReason, ...rest } = input;
      const data = rest;
      let finalData = { ...data };

      // Doc 31 WE-2 bug #1: verify the target exists so a bad id returns
      // NOT_FOUND (was a silent no-op that still wrote a phantom audit row),
      // consistent with measurementPoint/fiducial/panel update.
      const existing = await db.getProductModelById(id);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy sản phẩm' });
      }

      // Check if code is being updated and if it's a duplicate
      if (data.code) {
        if (existing.code !== data.code) {
          // Code is changing, check for duplicates
          const duplicate = await db.getProductModelByCode(data.code);
          if (duplicate) {
            // WE-2 bug #2: CONFLICT for consistency with productModel.clone.
            throw new TRPCError({ code: 'CONFLICT', message: 'Mã sản phẩm đã tồn tại' });
          }
        } else {
          // Code is not changing, remove it from update data to avoid duplicate key error
          delete finalData.code;
        }
      }
      
      // Check if referenceImageUrl is a base64 data URL and upload to S3
      if (data.referenceImageUrl && data.referenceImageUrl.startsWith('data:')) {
        // PM8: extract dims first, independent of the storage backend.
        if (!data.imageWidth || !data.imageHeight) {
          const dims = await extractDimsFromDataUrl(data.referenceImageUrl);
          if (dims.width && dims.height) {
            finalData.imageWidth = finalData.imageWidth ?? dims.width;
            finalData.imageHeight = finalData.imageHeight ?? dims.height;
          }
        }
        const isForgeConfigured = !!(process.env.BUILT_IN_FORGE_API_URL && process.env.BUILT_IN_FORGE_API_KEY);
        if (!isForgeConfigured) {
          // Forge storage is not configured – skip external upload but do not fail update
          console.warn('Forge storage not configured, skipping product model image upload for update');
        } else {
          try {
            const matches = data.referenceImageUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
              const mimeType = matches[1];
              const base64Data = matches[2];
              const buffer = Buffer.from(base64Data, 'base64');

              const extMap: Record<string, string> = {
                'image/jpeg': 'jpg',
                'image/png': 'png',
                'image/gif': 'gif',
                'image/webp': 'webp',
              };
              const ext = extMap[mimeType] || 'jpg';
              const code = data.code || `product-${id}`;
              const fileKey = `product-models/${code}-${nanoid(8)}.${ext}`;

              const { url, key } = await storagePut(fileKey, buffer, mimeType);
              finalData.referenceImageUrl = url;
              finalData.referenceImageKey = key;
            }
          } catch (error) {
            console.error('Failed to upload product model image to S3:', error);
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to upload image' });
          }
        }
        // PM8 enforcement: a new image without resolvable dims is refused.
        if ((!finalData.imageWidth || !finalData.imageHeight) && isProductImageDimsRequired()) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Could not determine reference image dimensions. Provide imageWidth/imageHeight or upload a valid image. ' +
              'Không xác định được kích thước ảnh — cung cấp imageWidth/imageHeight hoặc tải ảnh hợp lệ.',
          });
        }
      }

      await withDbErrors(() => db.updateProductModel(id, finalData), { conflictMessage: "Mã sản phẩm đã tồn tại" });
      // Doc 51 P2 (CASE #6): defensive backfill for models that already existed
      // before this fix shipped (e.g. now being activated/renamed) — re-anchor any
      // still-NULL inspections carrying this model's code. Best-effort + isolated.
      await backfillInspectionsForModel(id, finalData.code ?? existing.code);
      // PM8: when dims are now known, recompute normalized coords for all points
      // (+ fiducials) so existing pixel coordinates become resolution-independent.
      if (finalData.imageWidth && finalData.imageHeight) {
        try {
          await db.backfillNormalizedCoordsForProduct(id, finalData.imageWidth, finalData.imageHeight);
        } catch (err) {
          console.warn("normalized-coord backfill failed (product.update)", err);
        }
      }
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "product.update",
          entityType: "product",
          entityId: id,
          entityName: data.code ?? undefined,
          details: { changedFields: Object.keys(finalData), changeReason: changeReason ?? null },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (product.update)", err);
      }
      return { success: true };
    }),

  delete: protectedProcedure.use(requirePermission("settings_products", "canDelete"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getProductModelById(input.id);
      await db.deleteProductModel(input.id);
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "product.delete",
          entityType: "product",
          entityId: input.id,
          entityName: existing?.code ?? undefined,
          details: { soft: true },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (product.delete)", err);
      }
      return { success: true };
    }),

  // Doc 31 PM1 (WC-2) — deep clone a product model into a new code. In ONE tx the
  // clone deep-copies measurement points (every column incl. componentCode/limits/
  // geometry/3D), fiducials, panel defs+boards, sampling plans, and OPTIONALLY
  // machine mappings (copyMappings, default false). It does NOT copy inspection
  // results, golden samples, or program releases (fresh start). Lifecycle resets to
  // 'development'; clonedFromId records provenance; the reference image is shared.
  clone: protectedProcedure.use(requirePermission("settings_products", "canCreate"))
    .input(z.object({
      sourceId: z.number().int().positive(),
      newCode: z.string().min(1).max(100).regex(/^[A-Za-z0-9_\-]+$/, "Code may only contain letters, digits, underscore, dash"),
      newName: z.string().min(1).max(255).optional(),
      newRevision: z.string().trim().max(32).optional(),
      copyMappings: z.boolean().optional().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const source = await db.getProductModelById(input.sourceId);
      if (!source) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Sản phẩm nguồn không tồn tại" });
      }
      // Code collision → CONFLICT (the unique index is the tx-level backstop below).
      const duplicate = await db.getProductModelByCode(input.newCode);
      if (duplicate) {
        throw new TRPCError({ code: "CONFLICT", message: "Mã sản phẩm đã tồn tại" });
      }

      let result: Awaited<ReturnType<typeof db.cloneProductModel>>;
      try {
        result = await db.cloneProductModel({
          sourceId: input.sourceId,
          newCode: input.newCode,
          newName: input.newName,
          newRevision: input.newRevision,
          copyMappings: input.copyMappings,
        });
      } catch (err: any) {
        // Backstop for a race that slips past the pre-check.
        if (err?.code === "23505" || /product_models_code/.test(String(err?.message))) {
          throw new TRPCError({ code: "CONFLICT", message: "Mã sản phẩm đã tồn tại" });
        }
        throw err;
      }

      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "product.clone",
          entityType: "product",
          entityId: result.newProductId,
          entityName: input.newCode,
          details: {
            sourceId: input.sourceId,
            sourceCode: source.code,
            newCode: input.newCode,
            copyMappings: input.copyMappings,
            summary: result.summary,
          },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (product.clone)", err);
      }
      return { id: result.newProductId, summary: result.summary };
    }),

  // ── Doc 31 PM8 — backfill image dimensions for existing products ──
  // For products that have a reference image but no imageWidth/imageHeight (all 4
  // dev products today), read the stored image, extract dims via sharp, persist
  // them, and recompute normalized coords for their points + fiducials. Pass a
  // productModelId to target one; omit to sweep every product missing dims.
  backfillImageDimensions: adminProcedure
    .input(z.object({ productModelId: z.number().int().positive().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const targets = input?.productModelId
        ? [await db.getProductModelById(input.productModelId)].filter(Boolean)
        : await db.getProductModels({});
      const results: Array<{
        productModelId: number; code: string; status: string;
        width?: number; height?: number; pointsNormalized?: number; fiducialsNormalized?: number;
      }> = [];

      for (const pm of targets as any[]) {
        if (!pm) continue;
        if (pm.imageWidth && pm.imageHeight) {
          // Already has dims — just (re)compute normals so points stay consistent.
          const bf = await db.backfillNormalizedCoordsForProduct(pm.id, pm.imageWidth, pm.imageHeight);
          results.push({ productModelId: pm.id, code: pm.code, status: "already_had_dims", width: pm.imageWidth, height: pm.imageHeight, pointsNormalized: bf.points, fiducialsNormalized: bf.fiducials });
          continue;
        }
        if (!pm.referenceImageUrl) {
          results.push({ productModelId: pm.id, code: pm.code, status: "no_image" });
          continue;
        }
        // Resolve the image bytes: data:/uploads → data URL; http(s) → fetch.
        let buffer: Buffer | null = null;
        try {
          const dataUrl = await resolveImageToDataUrl(pm.referenceImageUrl);
          if (dataUrl && dataUrl.startsWith("data:")) {
            const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (m) buffer = Buffer.from(m[2], "base64");
          } else if (pm.referenceImageUrl.startsWith("http")) {
            const fetchFn = (globalThis as any).fetch;
            if (fetchFn) {
              const resp = await fetchFn(pm.referenceImageUrl);
              if (resp.ok) buffer = Buffer.from(await resp.arrayBuffer());
            }
          }
        } catch (err) {
          console.warn("backfillImageDimensions: fetch failed", pm.code, err);
        }
        if (!buffer) {
          results.push({ productModelId: pm.id, code: pm.code, status: "image_unreadable" });
          continue;
        }
        let width: number | undefined;
        let height: number | undefined;
        try {
          const sharp = (await import("sharp")).default;
          const meta = await sharp(buffer).metadata();
          width = meta.width; height = meta.height;
        } catch { /* sharp unavailable */ }
        if (!width || !height) {
          results.push({ productModelId: pm.id, code: pm.code, status: "dims_undetermined" });
          continue;
        }
        await db.updateProductModel(pm.id, { imageWidth: width, imageHeight: height });
        const bf = await db.backfillNormalizedCoordsForProduct(pm.id, width, height);
        results.push({ productModelId: pm.id, code: pm.code, status: "backfilled", width, height, pointsNormalized: bf.points, fiducialsNormalized: bf.fiducials });
      }

      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "product.backfillImageDimensions",
          entityType: "product",
          entityId: input?.productModelId ?? 0,
          entityName: input?.productModelId ? String(input.productModelId) : "ALL",
          details: { results },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (product.backfillImageDimensions)", err);
      }
      return { results };
    }),

  // ── Doc 42 Đợt 4A (APPLY-B) — xuất danh sách sản phẩm ra Excel/CSV ──
  // Xuất theo BỘ LỌC hiện tại (khớp productModel.list). Trả buffer base64 để
  // client tải về, giữ header brand + tiếng Việt (qua masterDataIO/exportRows).
  exportList: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      lifecycleStatus: z.enum(productLifecycleValues).optional(),
      sortBy: z.enum(["code", "name", "createdAt", "updatedAt"]).optional(),
      sortOrder: z.enum(["asc", "desc"]).optional(),
      format: z.enum(["csv", "xlsx"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      const format = input?.format ?? "xlsx";
      const products = await db.getProductModels({
        search: input?.search,
        lifecycleStatus: input?.lifecycleStatus,
        sortBy: input?.sortBy,
        sortOrder: input?.sortOrder,
      });
      const rows = (products as any[]).map((p) => ({
        code: p.code,
        name: p.name,
        description: p.description ?? "",
        category: p.category ?? "",
        productLine: p.productLine ?? "",
        variant: p.variant ?? "",
        revision: p.revision ?? "",
        lifecycleStatus: p.lifecycleStatus ?? "",
        targetYieldRate: p.targetYieldRate ?? "",
        minYieldRate: p.minYieldRate ?? "",
        createdAt: p.createdAt ?? null,
        updatedAt: p.updatedAt ?? null,
      }));
      const buffer = await exportRows(rows, PRODUCT_EXPORT_COLUMNS, format);
      const ext = format === "csv" ? "csv" : "xlsx";
      const mimeType =
        format === "csv"
          ? "text/csv;charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      return {
        fileName: `san_pham_${new Date().toISOString().slice(0, 10)}.${ext}`,
        mimeType,
        base64: buffer.toString("base64"),
        count: rows.length,
      };
    }),

  // ── Doc 42 Đợt 4A (APPLY-B) — nhập danh sách sản phẩm (upsert theo mã) ──
  // Nhận các dòng ĐÃ ánh xạ field (client preview qua @shared/masterDataIO) rồi
  // RE-VALIDATE phía server (không bỏ qua validation): mã trùng → UPDATE, chưa có
  // → INSERT, thiếu trường bắt buộc/không hợp lệ → lỗi theo dòng. UPDATE chỉ ghi
  // các field có giá trị (không xoá trắng dữ liệu cũ). Trả {inserted,updated,failed,errors}.
  // doc 54 P0.3 — bulk product import gated on settings_products (same as create),
  // was adminProcedure → single-admin bottleneck at rollout.
  importList: protectedProcedure.use(requirePermission("settings_products", "canCreate"))
    .input(z.object({
      rows: z.array(z.record(z.string(), z.unknown())).max(5000),
    }))
    .mutation(async ({ ctx, input }) => {
      let inserted = 0;
      let updated = 0;
      const errors: Array<{ row: number; message: string }> = [];

      const str = (v: unknown): string | undefined => {
        const s = v == null ? "" : String(v).trim();
        return s === "" ? undefined : s;
      };
      const dec = (v: unknown): string | undefined => {
        if (v == null || String(v).trim() === "") return undefined;
        const n = Number(String(v).trim());
        return Number.isFinite(n) ? String(n) : undefined;
      };

      for (let i = 0; i < input.rows.length; i++) {
        const rowNo = i + 1;
        const raw = input.rows[i] ?? {};
        try {
          const code = String(raw.code ?? "").trim();
          const name = String(raw.name ?? "").trim();
          if (!code) { errors.push({ row: rowNo, message: '"Mã sản phẩm" bắt buộc nhập' }); continue; }
          if (!/^[A-Za-z0-9_\-]+$/.test(code)) {
            errors.push({ row: rowNo, message: `Mã '${code}' chỉ được chứa chữ, số, gạch dưới, gạch ngang` });
            continue;
          }
          if (!name) { errors.push({ row: rowNo, message: '"Tên sản phẩm" bắt buộc nhập' }); continue; }

          // Trạng thái vòng đời (nếu có) phải hợp lệ.
          let lifecycleStatus: (typeof productLifecycleValues)[number] | undefined;
          const rawLifecycle = raw.lifecycleStatus == null ? "" : String(raw.lifecycleStatus).trim().toLowerCase();
          if (rawLifecycle) {
            if (!(productLifecycleValues as readonly string[]).includes(rawLifecycle)) {
              errors.push({ row: rowNo, message: `Trạng thái '${rawLifecycle}' không hợp lệ (development/active/eol/archived)` });
              continue;
            }
            lifecycleStatus = rawLifecycle as (typeof productLifecycleValues)[number];
          }

          const fields: Record<string, unknown> = {
            name,
            description: str(raw.description),
            category: str(raw.category),
            productLine: str(raw.productLine),
            variant: str(raw.variant),
            revision: str(raw.revision),
            lifecycleStatus,
            targetYieldRate: dec(raw.targetYieldRate),
            minYieldRate: dec(raw.minYieldRate),
          };
          // Bỏ field undefined để UPDATE không ghi đè null lên dữ liệu cũ.
          const data: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(fields)) if (v !== undefined) data[k] = v;

          const existing = await db.getProductModelByCode(code);
          if (existing) {
            await withDbErrors(() => db.updateProductModel(existing.id, data as any));
            updated++;
          } else {
            await withDbErrors(
              () => db.createProductModel({ code, ...data } as any),
              { conflictMessage: `Mã sản phẩm '${code}' đã tồn tại` },
            );
            inserted++;
          }
        } catch (err: any) {
          errors.push({ row: rowNo, message: err?.message ? String(err.message) : "Lỗi không xác định" });
        }
      }

      const failed = errors.length;
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "product.import",
          entityType: "product",
          entityId: 0,
          entityName: `import ${inserted + updated}/${input.rows.length}`,
          details: { inserted, updated, failed, total: input.rows.length },
          status: inserted + updated === 0 && failed > 0 ? "failure" : "success",
        });
      } catch (err) {
        console.warn("audit log failed (product.import)", err);
      }

      return { inserted, updated, failed, errors };
    }),
});

// ============ MEASUREMENT POINT DEFINITION ROUTER ============
export const measurementPointRouter = router({
  list: protectedProcedure
    .query(async () => {
      return db.listAllMeasurementPointDefs();
    }),

  listByProductModel: protectedProcedure
    .input(z.object({ productModelId: z.number() }))
    .query(async ({ input }) => {
      return db.getMeasurementPointDefsByProductModel(input.productModelId);
    }),

  listByMachine: protectedProcedure
    .input(z.object({ machineId: z.number() }))
    .query(async ({ input }) => {
      return db.getMeasurementPointDefsByMachine(input.machineId);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getMeasurementPointDefById(input.id);
    }),

  create: protectedProcedure.use(requirePermission("settings_measurement_points", "canCreate"))
    .input(z.object({
      productModelId: z.number().int().positive(),
      machineId: z.number().int().positive().optional(),
      workstationId: z.number().int().positive().optional(),
      code: z.string().min(1).max(50).regex(/^[A-Za-z0-9_\-]+$/, "Code may only contain letters, digits, underscore, dash"),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      measurementType: legacyMeasurementTypeSchema.optional(),
      measurementTypeCode: z.string().min(3).max(100).optional(),
      unit: z.string().optional(),
      lowerLimit: z.string().optional(),
      upperLimit: z.string().optional(),
      nominalValue: z.string().optional(),
      toleranceMode: toleranceModeSchema.optional(),
      tolPlus: z.string().optional(),
      tolMinus: z.string().optional(),
      criteria: z.array(criteriaItemSchema).optional(),
      datumRefs: z.array(z.string().trim().min(1).max(20)).max(10).optional(),
      materialCondition: materialConditionSchema.optional(),
      fitClass: z.string().max(20).optional(),
      positionZ: z.string().optional(),
      heightMin: z.string().optional(),
      heightMax: z.string().optional(),
      heightNominal: z.string().optional(),
      heightUnit: z.string().max(20).optional(),
      areaMin: z.string().optional(),
      areaMax: z.string().optional(),
      areaNominal: z.string().optional(),
      areaUnit: z.string().max(20).optional(),
      volumeMin: z.string().optional(),
      volumeMax: z.string().optional(),
      volumeNominal: z.string().optional(),
      volumeUnit: z.string().max(20).optional(),
      coplanarityMax: z.string().optional(),
      warpageMax: z.string().optional(),
      voidPctMax: z.string().optional(),
      offsetXMax: z.string().optional(),
      offsetYMax: z.string().optional(),
      tiltMax: z.string().optional(),
      thicknessMin: z.string().optional(),
      thicknessMax: z.string().optional(),
      depthMapUrl: z.string().url().optional(),
      pointCloudUrl: z.string().url().optional(),
      positionX: z.number().int().nonnegative().max(100000),
      positionY: z.number().int().nonnegative().max(100000),
      radius: z.number().int().nonnegative().max(100000).optional(),
      cropWidth: z.number().int().nonnegative().max(100000).optional().default(100),
      cropHeight: z.number().int().nonnegative().max(100000).optional().default(100),
      referenceImageUrl: z.string().optional(),
      referenceImageKey: z.string().optional(),
      orderIndex: z.number().int().nonnegative().optional(),
      shape: pointShapeEnum.optional(),
      geometry: measurementGeometrySchema.optional(),
      preferredInstrumentId: z.number().int().positive().optional(),
      preferredSamplingPlanId: z.number().int().positive().optional(),
      productViewId: z.number().int().positive().optional(), // P3.4: multi-camera binding
      // Doc 31 MP1/PM6 — WHICH component this point measures. componentCode
      // relates BY CODE to materials.code (this is what lights up the
      // Pareto-by-package chain — W8-A/0191); refDesignator is the board
      // position (e.g. "R12"). NEITHER is a limit field, so they never touch
      // WA-1's threshold gate (which only fires on lowerLimit/upperLimit/
      // nominalValue/toleranceMode/tolPlus/tolMinus).
      componentCode: z.string().trim().max(100).optional(),
      refDesignator: z.string().trim().max(64).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // P1: when caller supplies a geometry, derive legacy positionX/Y/radius
      // from the geometry centroid so legacy clients stay correct.
      let positionX = input.positionX;
      let positionY = input.positionY;
      let radius = input.radius;
      if (input.geometry) {
        const anchor = deriveLegacyAnchor(input.geometry as MeasurementGeometry);
        positionX = Math.max(0, Math.round(anchor.x));
        positionY = Math.max(0, Math.round(anchor.y));
        radius = Math.max(0, Math.round(anchor.radius));
      }
      // Auto-compute normalized coordinates from product model dimensions
      let normalizedX: string | undefined;
      let normalizedY: string | undefined;
      let normalizedRadius: string | undefined;
      if (positionX != null && positionY != null) {
        const productModel = await db.getProductModelById(input.productModelId);
        if (productModel?.imageWidth && productModel?.imageHeight) {
          normalizedX = (positionX / productModel.imageWidth).toFixed(8);
          normalizedY = (positionY / productModel.imageHeight).toFixed(8);
          if (radius != null) {
            normalizedRadius = (radius / productModel.imageWidth).toFixed(8);
          }
        } else if (isPointSaveDimsRequired()) {
          // PM8 (opt-in): without image dims the coordinate is a raw pixel that is
          // not portable across machines — block the save until dims are set
          // (via image upload or product.backfillImageDimensions). Default off so
          // the current dim-less dev products still allow authoring.
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "This product has no reference image dimensions; set them before adding points. " +
              "Sản phẩm chưa có kích thước ảnh — hãy đặt kích thước trước khi thêm điểm đo.",
          });
        }
      }
      // P3: Validate preferredInstrument if provided
      if (input.preferredInstrumentId) {
        const instrument = await db.getMeasurementInstrumentById(input.preferredInstrumentId);
        if (!instrument) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Instrument ID ${input.preferredInstrumentId} not found` });
        }
        if (!instrument.isActive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Instrument "${instrument.code}" is inactive; cannot assign to measurement point` });
        }
      }

      // P3: Validate preferredSamplingPlan if provided
      if (input.preferredSamplingPlanId) {
        const samplingPlan = await db.getSamplingPlanById(input.preferredSamplingPlanId);
        if (!samplingPlan) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Sampling plan ID ${input.preferredSamplingPlanId} not found` });
        }
        if (samplingPlan.productModelId !== input.productModelId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Sampling plan does not belong to this product model` });
        }
        if (!samplingPlan.isActive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Sampling plan "${samplingPlan.code}" is inactive; cannot assign to measurement point` });
        }
      }

      // P3.4: Validate productView if provided (multi-camera binding)
      if (input.productViewId) {
        const productView = await db.getProductViewById(input.productViewId);
        if (!productView) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Product view ID ${input.productViewId} not found` });
        }
        if (productView.productModelId !== input.productModelId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Product view does not belong to this product model` });
        }
        if (!productView.isActive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Product view "${productView.code}" is inactive; cannot assign to measurement point` });
        }
      }

      const legacyMeasurementType = await resolveLegacyMeasurementType(input.measurementTypeCode, input.measurementType);
      const legacyLimits = deriveLegacyLimitsFromTolerance({
        toleranceMode: input.toleranceMode,
        nominalValue: input.nominalValue,
        tolPlus: input.tolPlus,
        tolMinus: input.tolMinus,
        lowerLimit: input.lowerLimit,
        upperLimit: input.upperLimit,
      });

      // Doc 51 P2 — out-param: `duplicate` ⇒ an active def with this code already
      // existed and `id` is ITS id; nothing was written (see createMeasurementPointDef).
      const createOutcome = { duplicate: false };
      const id = await db.createMeasurementPointDef({
        ...input,
        measurementType: legacyMeasurementType,
        lowerLimit: legacyLimits.lowerLimit,
        upperLimit: legacyLimits.upperLimit,
        positionX,
        positionY,
        radius,
        normalizedX,
        normalizedY,
        normalizedRadius,
      }, createOutcome);

      // Doc 51 P1 (R4) — a NEW point the machines cannot see is a point that never
      // gets inspected. Skip the bump when nothing was actually written: a losing
      // racer must not churn the version and trigger a pointless fleet re-fetch.
      if (!createOutcome.duplicate) {
        await bumpAndNotifyPointsConfig(input.productModelId);
      }
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "measurementPoint.create",
          entityType: "product",
          entityId: id,
          entityName: input.code,
          details: {
            productModelId: input.productModelId,
            machineId: input.machineId,
            measurementType: legacyMeasurementType,
            measurementTypeCode: input.measurementTypeCode,
            shape: input.shape ?? "circle",
            // Doc 51 P2 — audit must not claim a create that never happened.
            duplicate: createOutcome.duplicate,
          },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (measurementPoint.create)", err);
      }
      // `duplicate` is ADDITIVE (existing clients read only `id`): true ⇒ the code
      // was already live and `id` points at the pre-existing def.
      return { id, duplicate: createOutcome.duplicate };
    }),

  update: protectedProcedure.use(requirePermission("settings_measurement_points", "canEdit"))
    .input(z.object({
      id: z.number().int().positive(),
      code: z.string().min(1).max(50).regex(/^[A-Za-z0-9_\-]+$/, "Code may only contain letters, digits, underscore, dash").optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      measurementType: legacyMeasurementTypeSchema.optional(),
      measurementTypeCode: z.string().min(3).max(100).optional(),
      unit: z.string().optional(),
      lowerLimit: z.string().optional(),
      upperLimit: z.string().optional(),
      nominalValue: z.string().optional(),
      toleranceMode: toleranceModeSchema.optional(),
      tolPlus: z.string().optional(),
      tolMinus: z.string().optional(),
      criteria: z.array(criteriaItemSchema).optional(),
      datumRefs: z.array(z.string().trim().min(1).max(20)).max(10).optional(),
      materialCondition: materialConditionSchema.optional(),
      fitClass: z.string().max(20).optional(),
      positionZ: z.string().optional(),
      heightMin: z.string().optional(),
      heightMax: z.string().optional(),
      heightNominal: z.string().optional(),
      heightUnit: z.string().max(20).optional(),
      areaMin: z.string().optional(),
      areaMax: z.string().optional(),
      areaNominal: z.string().optional(),
      areaUnit: z.string().max(20).optional(),
      volumeMin: z.string().optional(),
      volumeMax: z.string().optional(),
      volumeNominal: z.string().optional(),
      volumeUnit: z.string().max(20).optional(),
      coplanarityMax: z.string().optional(),
      warpageMax: z.string().optional(),
      voidPctMax: z.string().optional(),
      offsetXMax: z.string().optional(),
      offsetYMax: z.string().optional(),
      tiltMax: z.string().optional(),
      thicknessMin: z.string().optional(),
      thicknessMax: z.string().optional(),
      depthMapUrl: z.string().url().optional(),
      pointCloudUrl: z.string().url().optional(),
      positionX: z.number().int().nonnegative().max(100000).optional(),
      positionY: z.number().int().nonnegative().max(100000).optional(),
      radius: z.number().int().nonnegative().max(100000).optional(),
      cropWidth: z.number().int().nonnegative().max(100000).optional(),
      cropHeight: z.number().int().nonnegative().max(100000).optional(),
      referenceImageUrl: z.string().optional(),
      referenceImageKey: z.string().optional(),
      orderIndex: z.number().int().nonnegative().optional(),
      workstationId: z.number().int().positive().optional(),
      preferredInstrumentId: z.number().int().positive().optional(),
      preferredSamplingPlanId: z.number().int().positive().optional(),
      productViewId: z.number().int().positive().optional(), // P3.4: multi-camera binding
      // Doc 31 MP1/PM6 — component linkage (see create input). Non-limit fields:
      // editing them alone must NOT route through the approval queue, so they are
      // deliberately excluded from the `touchesLimits` check below.
      componentCode: z.string().trim().max(100).optional(),
      refDesignator: z.string().trim().max(64).optional(),
      isActive: z.boolean().optional(),
      shape: pointShapeEnum.optional(),
      geometry: measurementGeometrySchema.optional(),
      changeReason: z.string().max(500).optional(),
      // Doc 31 UX3 — optimistic lock: the updatedAt the editor loaded. When present
      // the write is a compare-and-set; a mismatch throws CONFLICT. Optional →
      // omitting it keeps the legacy blind-update behaviour (backward compatible).
      expectedUpdatedAt: z.coerce.date().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, changeReason, expectedUpdatedAt, ...rest } = input;
      const data: Record<string, unknown> = { ...rest };
      const existingPoint = await db.getMeasurementPointDefById(id);
      if (!existingPoint) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Measurement point not found" });
      }

      // Doc 31 OP2 (decision #4) — a DIRECT limit change is only allowed while the
      // owning product is in `development` (and has no released program); on a live
      // product it must go through the approval queue. Non-limit edits (name/shape/
      // position/…) are never gated. The audit row below records every direct edit.
      const touchesLimits =
        rest.lowerLimit !== undefined ||
        rest.upperLimit !== undefined ||
        rest.nominalValue !== undefined ||
        rest.toleranceMode !== undefined ||
        rest.tolPlus !== undefined ||
        rest.tolMinus !== undefined;
      let thresholdGate: ThresholdGateResult | null = null;
      if (touchesLimits) {
        // Throws FORBIDDEN (→ approval queue) when the product is live + enforced.
        thresholdGate = await assertThresholdEditAllowed(id);
      }

      // P3: Validate preferredInstrument if provided or changed
      if (rest.preferredInstrumentId) {
        const instrument = await db.getMeasurementInstrumentById(rest.preferredInstrumentId);
        if (!instrument) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Instrument ID ${rest.preferredInstrumentId} not found` });
        }
        if (!instrument.isActive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Instrument "${instrument.code}" is inactive; cannot assign to measurement point` });
        }
      }

      // P3: Validate preferredSamplingPlan if provided or changed
      if (rest.preferredSamplingPlanId) {
        const samplingPlan = await db.getSamplingPlanById(rest.preferredSamplingPlanId);
        if (!samplingPlan) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Sampling plan ID ${rest.preferredSamplingPlanId} not found` });
        }
        if (samplingPlan.productModelId !== existingPoint.productModelId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Sampling plan does not belong to this product model` });
        }
        if (!samplingPlan.isActive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Sampling plan "${samplingPlan.code}" is inactive; cannot assign to measurement point` });
        }
      }

      // P3.4: Validate productView if provided or changed (multi-camera binding)
      if (rest.productViewId) {
        const productView = await db.getProductViewById(rest.productViewId);
        if (!productView) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Product view ID ${rest.productViewId} not found` });
        }
        if (productView.productModelId !== existingPoint.productModelId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Product view does not belong to this product model` });
        }
        if (!productView.isActive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Product view "${productView.code}" is inactive; cannot assign to measurement point` });
        }
      }

      const nextMeasurementTypeCode = rest.measurementTypeCode ?? existingPoint.measurementTypeCode ?? undefined;
      const nextLegacyType = await resolveLegacyMeasurementType(
        nextMeasurementTypeCode,
        (rest.measurementType ?? existingPoint.measurementType) as z.infer<typeof legacyMeasurementTypeSchema>,
      );
      data.measurementType = nextLegacyType;

      const legacyLimits = deriveLegacyLimitsFromTolerance({
        toleranceMode: (rest.toleranceMode ?? existingPoint.toleranceMode ?? undefined) as z.infer<typeof toleranceModeSchema> | undefined,
        nominalValue: (rest.nominalValue ?? existingPoint.nominalValue ?? undefined) as string | undefined,
        tolPlus: (rest.tolPlus ?? existingPoint.tolPlus ?? undefined) as string | undefined,
        tolMinus: (rest.tolMinus ?? existingPoint.tolMinus ?? undefined) as string | undefined,
        lowerLimit: (rest.lowerLimit ?? existingPoint.lowerLimit ?? undefined) as string | undefined,
        upperLimit: (rest.upperLimit ?? existingPoint.upperLimit ?? undefined) as string | undefined,
      });
      data.lowerLimit = legacyLimits.lowerLimit;
      data.upperLimit = legacyLimits.upperLimit;

      // P1: derive legacy x/y/r from supplied geometry (for any shape).
      if (rest.geometry) {
        const anchor = deriveLegacyAnchor(rest.geometry as MeasurementGeometry);
        data.positionX = Math.max(0, Math.round(anchor.x));
        data.positionY = Math.max(0, Math.round(anchor.y));
        data.radius = Math.max(0, Math.round(anchor.radius));
      }
      // Auto-compute normalized coordinates when position changes
      let normalizedData: Record<string, unknown> = { ...data };
      if (data.positionX != null || data.positionY != null || data.radius != null) {
        const productModel = await db.getProductModelById(existingPoint.productModelId);
        if (productModel?.imageWidth && productModel?.imageHeight) {
          const px = (data.positionX as number | undefined) ?? existingPoint.positionX;
          const py = (data.positionY as number | undefined) ?? existingPoint.positionY;
          const r = (data.radius as number | undefined) ?? existingPoint.radius;
          if (px != null && py != null) {
            normalizedData.normalizedX = (px / productModel.imageWidth).toFixed(8);
            normalizedData.normalizedY = (py / productModel.imageHeight).toFixed(8);
            if (r != null) {
              normalizedData.normalizedRadius = (r / productModel.imageWidth).toFixed(8);
            }
          }
        }
      }
      try {
        await db.updateMeasurementPointDef(id, normalizedData, {
          changedBy: ctx.user.id,
          changeReason: changeReason ?? null,
          expectedUpdatedAt, // UX3 optimistic lock (undefined → skip check)
        });
      } catch (err) {
        // Doc 31 UX3 — a stale compare-and-set surfaces as CONFLICT. Forward the
        // CURRENT row (selected fields) so the client can show "someone else
        // changed X" and offer reload / overwrite-anyway. Duck-typed by `.code`
        // (db module is mocked in some tests → never `instanceof`).
        if (err && (err as { code?: string }).code === "MP_STALE_WRITE") {
          const conflictErr = err as {
            current?: Record<string, unknown>;
            expectedUpdatedAt?: string | null;
            actualUpdatedAt?: string | null;
          };
          const cur = conflictErr.current ?? {};
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Điểm đo đã bị người khác thay đổi kể từ khi bạn mở. Tải lại để xem thay đổi, hoặc ghi đè. " +
              "This measurement point was changed by someone else since you opened it.",
            cause: {
              // Read by the additive errorFormatter forward (trpc.ts) → data.conflict.
              mpConflict: {
                pointDefId: id,
                expectedUpdatedAt: conflictErr.expectedUpdatedAt ?? null,
                actualUpdatedAt: conflictErr.actualUpdatedAt ?? null,
                current: {
                  code: cur.code ?? null,
                  name: cur.name ?? null,
                  lowerLimit: cur.lowerLimit ?? null,
                  upperLimit: cur.upperLimit ?? null,
                  nominalValue: cur.nominalValue ?? null,
                  componentCode: cur.componentCode ?? null,
                  refDesignator: cur.refDesignator ?? null,
                  positionX: cur.positionX ?? null,
                  positionY: cur.positionY ?? null,
                  radius: cur.radius ?? null,
                  updatedAt: cur.updatedAt ?? null,
                },
              },
            } as unknown as Error,
          });
        }
        throw err;
      }
      // Doc 51 P1 (R4) — THE fix: an edited limit/position/name that machines never
      // re-fetch means the engineer's change exists only in the UI while the fleet
      // keeps grading boards against the old spec. Bump AFTER the write succeeds
      // (a rejected optimistic-lock write above threw, so no version churn for it).
      // Doc 55 Item 3 PV2 (QĐ#14) — scope the notify to the point's variant (base
      // point / flag OFF ⇒ undefined ⇒ base topic, byte-identical).
      await bumpAndNotifyPointsConfig(
        existingPoint.productModelId,
        await variantCodeForPointNotify(existingPoint),
      );
      // Doc 31 OP2 — every DIRECT limit change leaves a dedicated audit row with
      // before/after limits + the gate decision (development-direct or override).
      if (touchesLimits) {
        try {
          await db.createAuditLog({
            userId: ctx.user.id,
            userName: ctx.user.name ?? undefined,
            action: "threshold.directEdit",
            entityType: "measurement_point_def",
            entityId: id,
            entityName: (data.code as string | undefined) ?? existingPoint.code ?? undefined,
            details: {
              productModelId: existingPoint.productModelId,
              lifecycleStatus: thresholdGate?.lifecycleStatus ?? null,
              gateDecision: thresholdGate?.decision ?? null,
              gateEnforced: thresholdGate?.enforced ?? null,
              hasReleasedProgram: thresholdGate?.hasReleasedProgram ?? null,
              before: {
                lowerLimit: existingPoint.lowerLimit,
                upperLimit: existingPoint.upperLimit,
                nominalValue: existingPoint.nominalValue,
                toleranceMode: existingPoint.toleranceMode,
                tolPlus: existingPoint.tolPlus,
                tolMinus: existingPoint.tolMinus,
              },
              after: {
                lowerLimit: normalizedData.lowerLimit ?? null,
                upperLimit: normalizedData.upperLimit ?? null,
                nominalValue: normalizedData.nominalValue ?? null,
                toleranceMode: normalizedData.toleranceMode ?? null,
                tolPlus: normalizedData.tolPlus ?? null,
                tolMinus: normalizedData.tolMinus ?? null,
              },
              changeReason: changeReason ?? null,
            },
            status: "success",
          });
        } catch (err) {
          console.warn("audit log failed (threshold.directEdit)", err);
        }
      }
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "measurementPoint.update",
          entityType: "product",
          entityId: id,
          entityName: (data.code as string | undefined) ?? undefined,
          details: {
            changedFields: Object.keys(normalizedData),
            measurementType: nextLegacyType,
            measurementTypeCode: nextMeasurementTypeCode,
            changeReason: changeReason ?? null,
          },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (measurementPoint.update)", err);
      }
      return { success: true };
    }),

  // Doc 31 MP1/PM6 — fill empty componentCode on a product's points from its BOM
  // (refDesignator match). Non-destructive (never overwrites an existing link);
  // dryRun previews the plan. Returns {matched, updated, unmatched[]}.
  backfillComponentCodesFromBom: adminProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      dryRun: z.boolean().optional().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await backfillComponentCodesFromBom(input.productModelId, { dryRun: input.dryRun });
      if (!input.dryRun && result.updated > 0) {
        // Doc 51 P1 (R4) — componentCode is carried on the point def the machine
        // syncs. dryRun writes nothing and updated===0 changed nothing → no bump
        // (a version bump with no payload change is a wasted fleet-wide re-fetch).
        await bumpAndNotifyPointsConfig(input.productModelId);
        try {
          await db.createAuditLog({
            userId: ctx.user.id,
            userName: ctx.user.name ?? undefined,
            action: "measurementPoint.backfillComponentCodes",
            entityType: "product",
            entityId: input.productModelId,
            details: {
              bomDefinitionId: result.bomDefinitionId,
              matched: result.matched,
              updated: result.updated,
              skippedAlreadyLinked: result.skippedAlreadyLinked,
              unmatched: result.unmatched.length,
            },
            status: "success",
          });
        } catch (err) {
          console.warn("audit log failed (measurementPoint.backfillComponentCodes)", err);
        }
      }
      return result;
    }),

  delete: protectedProcedure.use(requirePermission("settings_measurement_points", "canDelete"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getMeasurementPointDefById(input.id);
      // Doc 51 P1 (R4 + CASE #4): deleteMeasurementPointDef bumps pointsConfigVersion
      // and stamps the tombstone's deletedAtVersion INSIDE its own transaction — the
      // two must never diverge, so the bump cannot be lifted out to this layer.
      // Returns the new version (null = the point was already deleted → no-op).
      const bumped = await db.deleteMeasurementPointDef(input.id);
      if (bumped) {
        // Best-effort nudge; machines otherwise converge on their next poll.
        // Doc 55 Item 3 PV2 (QĐ#14) — scope to the deleted point's variant (a
        // variant-added point → that variant's topic; base point / flag OFF ⇒ base
        // topic, byte-identical).
        const notifyVariantCode = await variantCodeForPointNotify(existing);
        try {
          publishPointsConfigChanged(bumped.code, bumped.version, undefined, notifyVariantCode);
        } catch (err) {
          console.warn("[doc51 R4] publishPointsConfigChanged failed after point delete", err);
        }
      }
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "measurementPoint.delete",
          entityType: "product",
          entityId: input.id,
          entityName: existing?.code ?? undefined,
          details: {
            soft: true,
            productModelId: existing?.productModelId,
            // Doc 51 — which config version retired this point (answers
            // "the machine was still on v7, did it ever get the tombstone?").
            pointsConfigVersion: bumped?.version ?? null,
          },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (measurementPoint.delete)", err);
      }
      return { success: true, pointsConfigVersion: bumped?.version ?? null };
    }),

  // Upload cropped reference image for measurement point
  uploadCroppedImage: adminProcedure
    .input(z.object({
      pointId: z.number().int().positive(),
      imageBase64: z.string(),
      mimeType: z.string().default('image/png'),
    }))
    .mutation(async ({ ctx, input }) => {
      // Get point info
      const point = await db.getMeasurementPointDefById(input.pointId);
      if (!point) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Measurement point not found' });
      }

      // Decode base64 and upload to S3
      const buffer = Buffer.from(input.imageBase64, 'base64');
      const ext = input.mimeType.split('/')[1] || 'png';
      const fileKey = `measurement-points/${point.productModelId}/${point.code}-crop-${nanoid(8)}.${ext}`;
      
      const { url, key } = await storagePut(fileKey, buffer, input.mimeType);

      // Update measurement point with cropped image URL (records a version snapshot)
      await db.updateMeasurementPointDef(input.pointId, {
        referenceImageUrl: url,
        referenceImageKey: key,
      }, {
        changedBy: ctx.user.id,
        changeReason: "uploadCroppedImage",
      });

      // Doc 51 P1 (R4) — the crop IS part of the point config the machine syncs
      // (referenceImageUrl/Key); without a bump the fleet keeps matching against
      // the previous template image.
      await bumpAndNotifyPointsConfig(point.productModelId);

      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "measurementPoint.uploadCroppedImage",
          entityType: "product",
          entityId: input.pointId,
          entityName: point.code,
          details: { mimeType: input.mimeType, key },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (measurementPoint.uploadCroppedImage)", err);
      }

      return { success: true, imageUrl: url, imageKey: key };
    }),

  // ── Doc 31 Đợt B (MP3) — __UNMAPPED__ visibility + bulk remap ──

  /** Unmatched-rate metric: % of results resolving under __UNMAPPED__. */
  unmappedRate: protectedProcedure
    .input(z.object({
      machineId: z.number().int().positive().optional(),
      productModelId: z.number().int().positive().optional(),
      fromTs: z.coerce.date().optional(),
      toTs: z.coerce.date().optional(),
    }).optional())
    .query(async ({ input }) => {
      const filter: UnmappedRateFilter = {
        machineId: input?.machineId,
        productModelId: input?.productModelId,
        fromTs: input?.fromTs,
        toTs: input?.toTs,
      };
      return getUnmappedPointRate(filter);
    }),

  /** List __UNMAPPED__ point defs with result counts + a remap suggestion. */
  listUnmapped: protectedProcedure
    .query(async () => {
      const unmappedModelId = await getUnmappedProductModelId();
      if (!unmappedModelId) return { unmappedModelId: null, points: [] };
      const points = await db.listUnmappedPointDefsWithStats(unmappedModelId);
      return { unmappedModelId, points };
    }),

  /**
   * Bulk-remap __UNMAPPED__ points to a real product model. Merges into an
   * existing same-code target def (re-pointing its results) or moves the def.
   */
  remapUnmapped: adminProcedure
    .input(z.object({
      pointDefIds: z.array(z.number().int().positive()).min(1).max(2000),
      targetProductModelId: z.number().int().positive(),
      targetMachineId: z.number().int().positive().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const unmappedModelId = await getUnmappedProductModelId();
      if (!unmappedModelId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No __UNMAPPED__ model exists — nothing to remap." });
      }
      const target = await db.getProductModelById(input.targetProductModelId);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Target product model ${input.targetProductModelId} not found.` });
      }
      if (input.targetProductModelId === unmappedModelId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot remap into the __UNMAPPED__ model itself." });
      }
      const summary = await db.remapMeasurementPoints({
        pointDefIds: input.pointDefIds,
        targetProductModelId: input.targetProductModelId,
        unmappedModelId,
        targetMachineId: input.targetMachineId ?? undefined,
      });
      // Doc 51 P1 (R4) — a MOVE adds real defs to the target product's point set,
      // so the machines running that product must re-fetch. Only when something
      // actually landed. (MERGE re-points results onto an existing target def and
      // changes nothing the machine reads, but it is cheaper to bump once than to
      // reason per-branch.) The __UNMAPPED__ source is a synthetic placeholder no
      // machine ever syncs against → deliberately not bumped.
      if (summary.moved > 0 || summary.merged > 0) {
        await bumpAndNotifyPointsConfig(input.targetProductModelId);
      }
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "measurementPoint.remapUnmapped",
        entityType: "product",
        entityId: input.targetProductModelId,
        entityName: target.code,
        details: { requested: input.pointDefIds.length, ...summary },
        status: "success",
      });
      return summary;
    }),

  // ══════════════════════════════════════════════════════════════════════════
  // Doc 51 P3 batch-2 (§5.2 P3) — VERSION-ROLLBACK. Reconstruct the point set as it
  // stood at an earlier pointsConfigVersion, then bump the version FORWARD so the
  // fleet re-fetches. This is "revert CONTENT, advance VERSION" — the number never
  // goes backwards, so delta-sync / version-gate stay monotonic (see db function).
  // Gated by canEdit (rewrites this product's measurement config for every machine).
  // ══════════════════════════════════════════════════════════════════════════
  revertPointsConfigToVersion: protectedProcedure.use(requirePermission("settings_measurement_points", "canEdit"))
    .input(z.object({
      productModelId: z.number().int().positive(),
      targetVersion: z.number().int().positive(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await withDbErrors(() =>
        db.revertPointsConfigToVersion(input.productModelId, input.targetVersion, {
          changedBy: ctx.user.id,
          changeReason: input.reason ?? `revert to pointsConfigVersion ${input.targetVersion}`,
        }),
      ).catch((err) => {
        // Out-of-range target (target >= current, or non-positive) → 400, not 500.
        if (err instanceof db.RevertVersionError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      });
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Product model ${input.productModelId} not found.` });
      }
      // Best-effort nudge; machines otherwise converge on their next poll.
      try {
        publishPointsConfigChanged(result.code, result.newVersion);
      } catch (err) {
        console.warn("[doc51 P3] publishPointsConfigChanged failed after points-config revert", err);
      }
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "measurementPoint.revertPointsConfig",
          entityType: "product",
          entityId: input.productModelId,
          entityName: result.code,
          details: {
            targetVersion: result.targetVersion,
            fromVersion: result.fromVersion,
            newVersion: result.newVersion,
            pointsReverted: result.pointsReverted,
            pointsUnchanged: result.pointsUnchanged,
            pointsSkipped: result.pointsSkipped,
            skippedPointIds: result.skippedPointIds,
            reason: input.reason ?? null,
          },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (measurementPoint.revertPointsConfig)", err);
      }
      return result;
    }),
});

// ============ PRODUCT MACHINE MAPPING ROUTER ============
export const productMachineMappingRouter = router({
  list: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getProductMachineMappings(input?.machineId, input?.productModelId);
    }),

  byMachine: protectedProcedure
    .input(z.object({ machineId: z.number() }))
    .query(async ({ input }) => {
      return db.getMappingsByMachine(input.machineId);
    }),

  byProduct: protectedProcedure
    .input(z.object({ productModelId: z.number() }))
    .query(async ({ input }) => {
      return db.getMappingsByProduct(input.productModelId);
    }),

  create: writeProcedure
    .input(z.object({
      productModelId: z.number({ error: "Vui lòng chọn sản phẩm" }).int().positive(),
      machineId: z.number({ error: "Vui lòng chọn máy" }).int().positive(),
      priority: z.number().int().nonnegative().optional(),
      notes: z.string().optional(),
      // doc 54 P0.4 — override the readiness go-live gate (admin/intentional).
      force: z.boolean().optional().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      // Doc 42 #40 — orphan guard: chặn tạo mapping trỏ tới sản phẩm/máy không tồn
      // tại (hoặc đã xoá) — nguồn gốc của các mapping mồ côi "N/A".
      const [product, machine] = await Promise.all([
        db.getProductModelById(input.productModelId),
        db.getMachineById(input.machineId),
      ]);
      if (!product) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Sản phẩm không tồn tại hoặc đã bị xoá — vui lòng chọn lại.",
        });
      }
      if (!machine) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Máy không tồn tại hoặc đã bị xoá — vui lòng chọn lại.",
        });
      }
      // doc 54 P0.4 — GO-LIVE READINESS GATE: don't let an under-configured product
      // (points with no thresholds / no coordinates / no golden) be mapped to a machine,
      // where it would silently feed Phase-1 with junk spec-gates. Block "blocked"-band
      // products unless the caller explicitly forces it.
      if (!input.force) {
        try {
          const readiness = await computeProductReadiness(input.productModelId);
          if (readiness && readiness.band === "blocked") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                `Sản phẩm "${product.code}" chưa đủ cấu hình để gán máy (readiness ${readiness.score}% — band "blocked"). ` +
                `Hoàn thiện điểm-đo (ngưỡng/tọa độ/golden) trước, hoặc gán với force=true nếu cố ý.`,
            });
          }
        } catch (e) {
          if (e instanceof TRPCError) throw e;
          // readiness compute failed (non-blocking) — fail-open, don't block a legit map.
          console.warn("productMachineMapping readiness gate: compute failed, allowing", e);
        }
      }
      const { force: _force, ...mappingInput } = input;
      const result = await db.createProductMachineMapping(mappingInput);
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "productMachineMapping.create",
          entityType: "mapping",
          entityId: typeof result === "object" && result && "id" in result ? (result as any).id : undefined,
          details: { productModelId: input.productModelId, machineId: input.machineId, priority: input.priority },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (productMachineMapping.create)", err);
      }
      return result;
    }),

  update: writeProcedure
    .input(z.object({
      id: z.number().int().positive(),
      priority: z.number().int().nonnegative().optional(),
      notes: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await db.updateProductMachineMapping(id, data);
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "productMachineMapping.update",
          entityType: "mapping",
          entityId: id,
          details: { changedFields: Object.keys(data) },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (productMachineMapping.update)", err);
      }
      return { success: true };
    }),

  delete: writeProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await db.deleteProductMachineMapping(input.id);
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "productMachineMapping.delete",
          entityType: "mapping",
          entityId: input.id,
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (productMachineMapping.delete)", err);
      }
      return { success: true };
    }),

  // Doc 42 Đợt 1 (#11) — dọn mapping mồ côi (sản phẩm/máy đã xoá) cho admin.
  cleanupOrphans: writeProcedure
    .mutation(async ({ ctx }) => {
      const deleted = await db.deleteOrphanProductMachineMappings();
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "productMachineMapping.cleanupOrphans",
          entityType: "mapping",
          details: { deleted },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (productMachineMapping.cleanupOrphans)", err);
      }
      return { deleted };
    }),
});

// ============ PRODUCT CATEGORY ROUTER ============
export const productCategoryRouter = router({
  list: protectedProcedure
    .input(z.object({
      parentId: z.number().nullable().optional(),
      isActive: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getProductCategories(input);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getProductCategoryById(input.id);
    }),

  getByCode: protectedProcedure
    .input(z.object({ code: z.string() }))
    .query(async ({ input }) => {
      return db.getProductCategoryByCode(input.code);
    }),

  getTree: protectedProcedure
    .query(async () => {
      return db.getProductCategoryTree();
    }),

  create: adminProcedure
    .input(z.object({
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      parentId: z.number().nullable().optional(),
      color: z.string().optional(),
      icon: z.string().optional(),
      orderIndex: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      // Check if code already exists
      const existing = await db.getProductCategoryByCode(input.code);
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Category code already exists' });
      }
      const result = await db.createProductCategory(input);
      return { id: result.id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      code: z.string().min(1).max(50).optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      parentId: z.number().nullable().optional(),
      color: z.string().optional(),
      icon: z.string().optional(),
      orderIndex: z.number().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      // Check if code already exists (if changing code)
      if (data.code) {
        const existing = await db.getProductCategoryByCode(data.code);
        if (existing && existing.id !== id) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Category code already exists' });
        }
      }
      await db.updateProductCategory(id, data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteProductCategory(input.id);
      return { success: true };
    }),

  reorder: adminProcedure
    .input(z.object({ categoryIds: z.array(z.number()) }))
    .mutation(async ({ input }) => {
      await db.reorderProductCategories(input.categoryIds);
      return { success: true };
    }),

  updateCount: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.updateProductCategoryCount(input.id);
      return { success: true };
    }),
});

// ============ PRODUCT DOCUMENT ROUTER ============
export const productDocumentRouter = router({
  list: protectedProcedure
    .input(z.object({ productModelId: z.number() }))
    .query(async ({ input }) => {
      const { productDocuments } = await import("../../drizzle/schema/product");
      const { eq, desc } = await import("drizzle-orm");
      const database = await db.getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
      return database.select().from(productDocuments)
        .where(eq(productDocuments.productModelId, input.productModelId))
        .orderBy(desc(productDocuments.createdAt));
    }),

  upload: writeProcedure
    .input(z.object({
      productModelId: z.number(),
      fileName: z.string().min(1).max(255),
      fileBase64: z.string(),
      mimeType: z.string().refine(
        (v) => ['application/pdf', 'application/msword', 
                 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                 'image/png', 'image/jpeg'].includes(v),
        { message: 'Unsupported file type' }
      ),
    }))
    .mutation(async ({ ctx, input }) => {
      const { productDocuments } = await import("../../drizzle/schema/product");
      const database = await db.getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");

      const buffer = Buffer.from(input.fileBase64, 'base64');
      const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const fileKey = `product-documents/${input.productModelId}/${Date.now()}-${safeName}`;
      const stored = await storagePut(fileKey, buffer, input.mimeType);

      const [doc] = await database.insert(productDocuments).values({
        productModelId: input.productModelId,
        fileName: input.fileName,
        fileKey: stored.key,
        fileUrl: stored.url,
        fileSize: buffer.length,
        mimeType: input.mimeType,
        uploadedBy: ctx.user?.id ?? null,
        uploadedByName: ctx.user?.name ?? null,
      }).returning();

      return doc;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { productDocuments } = await import("../../drizzle/schema/product");
      const { eq } = await import("drizzle-orm");
      const database = await db.getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
      await database.delete(productDocuments).where(eq(productDocuments.id, input.id));
      return { success: true };
    }),
});

// ============ FIDUCIAL MARK ROUTER (P1) ============
export const fiducialMarkRouter = router({
  listByProductModel: protectedProcedure
    .input(z.object({ productModelId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return db.getFiducialMarksByProductModel(input.productModelId);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      return db.getFiducialMarkById(input.id);
    }),

  create: adminProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      code: z.string().min(1).max(50).regex(/^[A-Za-z0-9_\-]+$/, "Code may only contain letters, digits, underscore, dash"),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      type: z.enum(["cross", "circle", "square", "custom"]).optional().default("cross"),
      positionX: z.number().int().nonnegative().max(100000),
      positionY: z.number().int().nonnegative().max(100000),
      searchWindowW: z.number().int().positive().max(10000).optional().default(80),
      searchWindowH: z.number().int().positive().max(10000).optional().default(80),
      templateImageUrl: z.string().optional(),
      templateImageKey: z.string().optional(),
      orderIndex: z.number().int().nonnegative().optional().default(0),
    }))
    .mutation(async ({ ctx, input }) => {
      // Auto-compute normalized X/Y from product model dimensions.
      let normalizedX: string | undefined;
      let normalizedY: string | undefined;
      const productModel = await db.getProductModelById(input.productModelId);
      if (productModel?.imageWidth && productModel?.imageHeight) {
        normalizedX = (input.positionX / productModel.imageWidth).toFixed(8);
        normalizedY = (input.positionY / productModel.imageHeight).toFixed(8);
      }
      const id = await db.createFiducialMark({
        ...input,
        normalizedX,
        normalizedY,
      });
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "fiducialMark.create",
          entityType: "product",
          entityId: id,
          entityName: input.code,
          details: { productModelId: input.productModelId, type: input.type },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (fiducialMark.create)", err);
      }
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      code: z.string().min(1).max(50).regex(/^[A-Za-z0-9_\-]+$/, "Code may only contain letters, digits, underscore, dash").optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      type: z.enum(["cross", "circle", "square", "custom"]).optional(),
      positionX: z.number().int().nonnegative().max(100000).optional(),
      positionY: z.number().int().nonnegative().max(100000).optional(),
      searchWindowW: z.number().int().positive().max(10000).optional(),
      searchWindowH: z.number().int().positive().max(10000).optional(),
      templateImageUrl: z.string().optional(),
      templateImageKey: z.string().optional(),
      orderIndex: z.number().int().nonnegative().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      const data: Record<string, unknown> = { ...rest };
      // Re-normalize when position changes
      if (rest.positionX != null || rest.positionY != null) {
        const existing = await db.getFiducialMarkById(id);
        if (existing) {
          const productModel = await db.getProductModelById(existing.productModelId);
          if (productModel?.imageWidth && productModel?.imageHeight) {
            const px = rest.positionX ?? existing.positionX;
            const py = rest.positionY ?? existing.positionY;
            if (px != null && py != null) {
              data.normalizedX = (px / productModel.imageWidth).toFixed(8);
              data.normalizedY = (py / productModel.imageHeight).toFixed(8);
            }
          }
        }
      }
      await db.updateFiducialMark(id, data);
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "fiducialMark.update",
          entityType: "product",
          entityId: id,
          entityName: rest.code ?? undefined,
          details: { changedFields: Object.keys(data) },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (fiducialMark.update)", err);
      }
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getFiducialMarkById(input.id);
      await db.deleteFiducialMark(input.id);
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "fiducialMark.delete",
          entityType: "product",
          entityId: input.id,
          entityName: existing?.code ?? undefined,
          details: { soft: true, productModelId: existing?.productModelId },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (fiducialMark.delete)", err);
      }
      return { success: true };
    }),

  uploadTemplateImage: adminProcedure
    .input(z.object({
      fiducialId: z.number().int().positive(),
      imageBase64: z.string(),
      mimeType: z.string().default("image/png"),
    }))
    .mutation(async ({ ctx, input }) => {
      const fid = await db.getFiducialMarkById(input.fiducialId);
      if (!fid) throw new TRPCError({ code: "NOT_FOUND", message: "Fiducial mark not found" });
      const buffer = Buffer.from(input.imageBase64, "base64");
      const ext = input.mimeType.split("/")[1] || "png";
      const fileKey = `fiducial-marks/${fid.productModelId}/${fid.code}-tpl-${nanoid(8)}.${ext}`;
      const { url, key } = await storagePut(fileKey, buffer, input.mimeType);
      await db.updateFiducialMark(input.fiducialId, {
        templateImageUrl: url,
        templateImageKey: key,
      });
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "fiducialMark.uploadTemplateImage",
          entityType: "product",
          entityId: input.fiducialId,
          entityName: fid.code,
          details: { mimeType: input.mimeType, key },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (fiducialMark.uploadTemplateImage)", err);
      }
      return { success: true, imageUrl: url, imageKey: key };
    }),
});

// ============ MEASUREMENT TYPE CATALOG ROUTER (P2) ============
export const measurementTypeCatalogRouter = router({
  list: protectedProcedure
    .input(z.object({
      category: z.string().optional(),
      includeInactive: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.listMeasurementTypeCatalog(input);
    }),

  create: adminProcedure
    .input(z.object({
      category: z.string().min(1).max(50),
      subType: z.string().min(1).max(80),
      code: z.string().min(3).max(100),
      nameEn: z.string().max(200).optional(),
      nameVi: z.string().max(200).optional(),
      defaultUnit: z.string().max(20).optional(),
      valueKind: z.enum(["numeric", "text", "boolean", "composite"]).optional(),
      description: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await db.createMeasurementTypeCatalog(input);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "measurementTypeCatalog.create",
        entityType: "product",
        entityId: id,
        entityName: input.code,
        details: input,
        status: "success",
      });
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      category: z.string().min(1).max(50).optional(),
      subType: z.string().min(1).max(80).optional(),
      code: z.string().min(3).max(100).optional(),
      nameEn: z.string().max(200).optional(),
      nameVi: z.string().max(200).optional(),
      defaultUnit: z.string().max(20).optional(),
      valueKind: z.enum(["numeric", "text", "boolean", "composite"]).optional(),
      description: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const before = await db.getMeasurementTypeCatalogByCode(input.code ?? "");
      await db.updateMeasurementTypeCatalog(id, data);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "measurementTypeCatalog.update",
        entityType: "product",
        entityId: id,
        entityName: input.code ?? undefined,
        details: { before, after: data },
        status: "success",
      });
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await db.softDeleteMeasurementTypeCatalog(input.id);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "measurementTypeCatalog.delete",
        entityType: "product",
        entityId: input.id,
        details: { soft: true },
        status: "success",
      });
      return { success: true };
    }),
});

// ============ DEFECT CATALOG ROUTER (P2) ============
export const defectCatalogRouter = router({
  list: protectedProcedure
    .input(z.object({
      category: z.string().optional(),
      severity: z.enum(["critical", "major", "minor", "cosmetic"]).optional(),
      includeInactive: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.listDefectCatalog(input);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      return db.getDefectCatalogById(input.id);
    }),

  create: qualityProcedure
    .input(z.object({
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(255),
      category: z.string().min(1).max(80),
      severity: z.enum(["critical", "major", "minor", "cosmetic"]),
      ipcReference: z.string().max(50).optional(),
      ipcSection: z.string().max(20).optional(),
      acceptanceClass: z.enum(["1", "2", "3"]).optional(),
      appliesTo: z.array(z.string()).optional(),
      detectableBy: z.array(z.string()).optional(),
      classRules: z.any().optional(),
      description: z.string().optional(),
      nameVi: z.string().max(255).optional(),
      descriptionVi: z.string().optional(),
      repairGuidance: z.string().optional(),
      repairGuidanceVi: z.string().optional(),
      referenceImageKey: z.string().max(255).optional(),
      referenceImageUrl: z.string().url().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await db.createDefectCatalog(input);
      // Doc 31 OP3: if this code was previously seen but unmatched, mark the
      // rollup row resolved so the curation panel stops flagging it.
      try { await db.markUnmatchedDefectCodeResolved(input.code, id); } catch { /* best-effort */ }
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "defectCatalog.create",
        entityType: "product",
        entityId: id,
        entityName: input.code,
        details: input,
        status: "success",
      });
      return { id };
    }),

  update: qualityProcedure
    .input(z.object({
      id: z.number().int().positive(),
      code: z.string().min(1).max(50).optional(),
      name: z.string().min(1).max(255).optional(),
      category: z.string().min(1).max(80).optional(),
      severity: z.enum(["critical", "major", "minor", "cosmetic"]).optional(),
      ipcReference: z.string().max(50).optional(),
      ipcSection: z.string().max(20).optional(),
      acceptanceClass: z.enum(["1", "2", "3"]).optional(),
      appliesTo: z.array(z.string()).optional(),
      detectableBy: z.array(z.string()).optional(),
      classRules: z.any().optional(),
      description: z.string().optional(),
      nameVi: z.string().max(255).optional(),
      descriptionVi: z.string().optional(),
      repairGuidance: z.string().optional(),
      repairGuidanceVi: z.string().optional(),
      referenceImageKey: z.string().max(255).optional(),
      referenceImageUrl: z.string().url().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const before = await db.getDefectCatalogById(id);
      await db.updateDefectCatalog(id, data);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "defectCatalog.update",
        entityType: "product",
        entityId: id,
        entityName: input.code ?? before?.code,
        details: { before, after: data },
        status: "success",
      });
      return { success: true };
    }),

  delete: qualityProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await db.softDeleteDefectCatalog(input.id);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "defectCatalog.delete",
        entityType: "product",
        entityId: input.id,
        details: { soft: true },
        status: "success",
      });
      return { success: true };
    }),

  // ── Doc 31 Đợt B (OP3) — unmatched-code telemetry for curation ──
  // Codes reported by machines/AI that did NOT resolve to a catalog row.
  listUnmatchedCodes: protectedProcedure
    .input(z.object({
      onlyUnresolved: z.boolean().optional().default(true),
      limit: z.number().int().positive().max(1000).optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.listUnmatchedDefectCodes({
        onlyUnresolved: input?.onlyUnresolved ?? true,
        limit: input?.limit,
      });
    }),

  // ── Doc 31 Đợt B (OP4) — per-component defect tendency (Pareto-by-package) ──
  // Joins classified NG results → point-def componentCode → defect class.
  // Tolerates empty componentCode (WB-1 fills it) — returns [] gracefully.
  defectTendency: protectedProcedure
    .input(z.object({
      productModelId: z.number().int().positive().optional(),
      fromTs: z.coerce.date().optional(),
      toTs: z.coerce.date().optional(),
      limit: z.number().int().positive().max(500).optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getDefectTendencyByComponent({
        productModelId: input?.productModelId,
        fromTs: input?.fromTs,
        toTs: input?.toTs,
        limit: input?.limit,
      });
    }),
});

  // ============ P3.1 / P3.3 / P3.4 FOUNDATION ROUTERS ============
  export const measurementInstrumentRouter = router({
    list: protectedProcedure
      .input(z.object({
        instrumentType: z.string().optional(),
        includeInactive: z.boolean().optional(),
      }).optional())
      .query(async ({ input }) => {
        return db.listMeasurementInstruments(input);
      }),

    getById: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => {
        return db.getMeasurementInstrumentById(input.id);
      }),

    create: adminProcedure
      .input(z.object({
        code: z.string().min(1).max(50),
        name: z.string().min(1).max(255),
        instrumentType: z.string().min(1).max(80),
        manufacturer: z.string().max(120).optional(),
        model: z.string().max(120).optional(),
        serialNumber: z.string().max(120).optional(),
        defaultUnit: z.string().max(20).optional(),
        resolution: z.string().optional(),
        uncertainty: z.string().optional(),
        mmPerPixel: z.string().optional(), // P3.2: calibration factor (e.g., "0.05" mm/pixel)
        calibrationPeriodDays: z.number().int().positive().optional(),
        lastCalibrationAt: z.date().optional(),
        nextCalibrationAt: z.date().optional(),
        msaMethod: z.string().max(50).optional(),
        notes: z.string().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await db.createMeasurementInstrument(input);
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "measurementInstrument.create",
          entityType: "product",
          entityId: id,
          entityName: input.code,
          details: input,
          status: "success",
        });
        return { id };
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number().int().positive(),
        code: z.string().min(1).max(50).optional(),
        name: z.string().min(1).max(255).optional(),
        instrumentType: z.string().min(1).max(80).optional(),
        manufacturer: z.string().max(120).optional(),
        model: z.string().max(120).optional(),
        serialNumber: z.string().max(120).optional(),
        defaultUnit: z.string().max(20).optional(),
        resolution: z.string().optional(),
        uncertainty: z.string().optional(),
        mmPerPixel: z.string().optional(), // P3.2: calibration factor
        calibrationPeriodDays: z.number().int().positive().optional(),
        lastCalibrationAt: z.date().optional(),
        nextCalibrationAt: z.date().optional(),
        msaMethod: z.string().max(50).optional(),
        notes: z.string().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const before = await db.getMeasurementInstrumentById(id);
        await db.updateMeasurementInstrument(id, data);
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "measurementInstrument.update",
          entityType: "product",
          entityId: id,
          entityName: input.code ?? before?.code,
          details: { before, after: data },
          status: "success",
        });
        return { success: true };
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await db.softDeleteMeasurementInstrument(input.id);
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "measurementInstrument.delete",
          entityType: "product",
          entityId: input.id,
          details: { soft: true },
          status: "success",
        });
        return { success: true };
      }),
  });

  export const samplingPlanRouter = router({
    listByProduct: protectedProcedure
      .input(z.object({
        productModelId: z.number().int().positive(),
        includeInactive: z.boolean().optional(),
      }))
      .query(async ({ input }) => {
        return db.listSamplingPlansByProduct(input.productModelId, { includeInactive: input.includeInactive });
      }),

    create: adminProcedure
      .input(z.object({
        productModelId: z.number().int().positive(),
        code: z.string().min(1).max(60),
        name: z.string().min(1).max(255),
        strategy: z.enum(["fixed_n", "aql", "risk_based"]).optional(),
        lotSize: z.number().int().positive().optional(),
        aqlCritical: z.string().optional(),
        aqlMajor: z.string().optional(),
        aqlMinor: z.string().optional(),
        sampleSize: z.number().int().positive().optional(),
        acceptanceQty: z.number().int().nonnegative().optional(),
        rejectionQty: z.number().int().nonnegative().optional(),
        rules: z.record(z.string(), z.any()).optional(),
        version: z.number().int().positive().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await db.createSamplingPlan(input);
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "samplingPlan.create",
          entityType: "product",
          entityId: id,
          entityName: input.code,
          details: input,
          status: "success",
        });
        return { id };
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number().int().positive(),
        code: z.string().min(1).max(60).optional(),
        name: z.string().min(1).max(255).optional(),
        strategy: z.enum(["fixed_n", "aql", "risk_based"]).optional(),
        lotSize: z.number().int().positive().optional(),
        aqlCritical: z.string().optional(),
        aqlMajor: z.string().optional(),
        aqlMinor: z.string().optional(),
        sampleSize: z.number().int().positive().optional(),
        acceptanceQty: z.number().int().nonnegative().optional(),
        rejectionQty: z.number().int().nonnegative().optional(),
        rules: z.record(z.string(), z.any()).optional(),
        version: z.number().int().positive().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const before = await db.getSamplingPlanById(id);
        await db.updateSamplingPlan(id, data);
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "samplingPlan.update",
          entityType: "product",
          entityId: id,
          entityName: input.code ?? before?.code,
          details: { before, after: data },
          status: "success",
        });
        return { success: true };
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await db.softDeleteSamplingPlan(input.id);
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "samplingPlan.delete",
          entityType: "product",
          entityId: input.id,
          details: { soft: true },
          status: "success",
        });
        return { success: true };
      }),

    // ── Doc 31 OP5 (decision #3) — AQL lot acceptance ────────────────────────
    // Evaluate a single lot (by batchNumber) against the product's AQL sampling
    // plan → accept / reject / pending disposition.
    evaluateLot: protectedProcedure
      .input(z.object({
        productModelId: z.number().int().positive(),
        samplingPlanId: z.number().int().positive().optional(),
        batchNumber: z.string().max(100).nullable().optional(),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
        machineId: z.number().int().positive().optional(),
      }))
      .query(async ({ input }) => {
        return evaluateLotAcceptance({
          productModelId: input.productModelId,
          samplingPlanId: input.samplingPlanId,
          batchNumber: input.batchNumber ?? undefined,
          startDate: input.startDate ? new Date(input.startDate) : undefined,
          endDate: input.endDate ? new Date(input.endDate) : undefined,
          machineId: input.machineId,
        });
      }),

    // List recent lots + their dispositions for a product (accept/reject board).
    listLots: protectedProcedure
      .input(z.object({
        productModelId: z.number().int().positive(),
        samplingPlanId: z.number().int().positive().optional(),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
        machineId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }))
      .query(async ({ input }) => {
        return listLotDispositions({
          productModelId: input.productModelId,
          samplingPlanId: input.samplingPlanId,
          startDate: input.startDate ? new Date(input.startDate) : undefined,
          endDate: input.endDate ? new Date(input.endDate) : undefined,
          machineId: input.machineId,
          limit: input.limit,
        });
      }),
  });

  export const productViewRouter = router({
    listByProduct: protectedProcedure
      .input(z.object({
        productModelId: z.number().int().positive(),
        includeInactive: z.boolean().optional(),
      }))
      .query(async ({ input }) => {
        return db.listProductViewsByProduct(input.productModelId, { includeInactive: input.includeInactive });
      }),

    create: adminProcedure
      .input(z.object({
        productModelId: z.number().int().positive(),
        code: z.string().min(1).max(50),
        name: z.string().min(1).max(255),
        viewType: z.enum(["top", "bottom", "side", "isometric", "custom"]).optional(),
        referenceImageUrl: z.string().optional(),
        referenceImageKey: z.string().optional(),
        transform: z.record(z.string(), z.any()).optional(),
        orderIndex: z.number().int().nonnegative().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await db.createProductView(input);
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "productView.create",
          entityType: "product",
          entityId: id,
          entityName: input.code,
          details: input,
          status: "success",
        });
        return { id };
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number().int().positive(),
        code: z.string().min(1).max(50).optional(),
        name: z.string().min(1).max(255).optional(),
        viewType: z.enum(["top", "bottom", "side", "isometric", "custom"]).optional(),
        referenceImageUrl: z.string().optional(),
        referenceImageKey: z.string().optional(),
        transform: z.record(z.string(), z.any()).optional(),
        orderIndex: z.number().int().nonnegative().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const before = await db.getProductViewById(id);
        await db.updateProductView(id, data);
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "productView.update",
          entityType: "product",
          entityId: id,
          entityName: input.code ?? before?.code,
          details: { before, after: data },
          status: "success",
        });
        return { success: true };
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await db.softDeleteProductView(input.id);
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "productView.delete",
          entityType: "product",
          entityId: input.id,
          details: { soft: true },
          status: "success",
        });
        return { success: true };
      }),
  });

export const msaWizardRouter = router({
  listCsvMappingPresets: protectedProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      sourceMachine: z.string().min(1).max(120).optional(),
    }))
    .query(async ({ input }) => {
      return db.listMsaCsvMappingPresetsByProduct(input.productModelId, {
        sourceMachine: input.sourceMachine,
      });
    }),

  saveCsvMappingPreset: protectedProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      sourceMachine: z.string().min(1).max(120),
      presetName: z.string().min(1).max(120),
      instrumentId: z.number().int().positive().optional(),
      hasHeader: z.boolean(),
      columnMap: z.object({
        operator: z.number().int().min(0),
        part: z.number().int().min(0),
        trial: z.number().int().min(0),
        value: z.number().int().min(0),
        notes: z.number().int().min(-1),
      }),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.instrumentId) {
        const inst = await db.getMeasurementInstrumentById(input.instrumentId);
        if (!inst) throw new TRPCError({ code: "NOT_FOUND", message: `Instrument ID ${input.instrumentId} not found` });
      }

      const id = await db.upsertMsaCsvMappingPreset({
        productModelId: input.productModelId,
        sourceMachine: input.sourceMachine,
        presetName: input.presetName,
        instrumentId: input.instrumentId,
        hasHeader: input.hasHeader,
        columnMap: input.columnMap,
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
      });

      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "msa.csv_preset.save",
        entityType: "product",
        entityId: input.productModelId,
        details: { id, sourceMachine: input.sourceMachine, presetName: input.presetName },
        status: "success",
      });

      return { id, success: true };
    }),

  deleteCsvMappingPreset: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await db.softDeleteMsaCsvMappingPreset(input.id, ctx.user.id);

      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "msa.csv_preset.delete",
        entityType: "product",
        entityId: input.id,
        details: { soft: true },
        status: "success",
      });

      return { success: true };
    }),

  listByProduct: protectedProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      includeInactive: z.boolean().optional(),
    }))
    .query(async ({ input }) => {
      return db.listMsaStudiesByProduct(input.productModelId, { includeInactive: input.includeInactive });
    }),

  getStudy: protectedProcedure
    .input(z.object({ studyId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const study = await db.getMsaStudyById(input.studyId);
      if (!study) {
        throw new TRPCError({ code: "NOT_FOUND", message: "MSA study not found" });
      }
      const observations = await db.listMsaObservationsByStudy(input.studyId);
      return { study, observations };
    }),

  startStudy: adminProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      measurementPointDefId: z.number().int().positive().optional(),
      instrumentId: z.number().int().positive().optional(),
      studyCode: z.string().min(1).max(60),
      name: z.string().min(1).max(255),
      studyType: z.enum(["gage_rr", "bias", "linearity", "stability"]).optional(),
      operatorCount: z.number().int().min(1).max(20).optional(),
      partCount: z.number().int().min(1).max(200).optional(),
      trialCount: z.number().int().min(1).max(20).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.instrumentId) {
        const inst = await db.getMeasurementInstrumentById(input.instrumentId);
        if (!inst) throw new TRPCError({ code: "NOT_FOUND", message: `Instrument ID ${input.instrumentId} not found` });
      }
      if (input.measurementPointDefId) {
        const point = await db.getMeasurementPointDefById(input.measurementPointDefId);
        if (!point) throw new TRPCError({ code: "NOT_FOUND", message: `Measurement point ID ${input.measurementPointDefId} not found` });
        if (point.productModelId !== input.productModelId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Measurement point does not belong to this product model" });
        }
      }

      const id = await db.createMsaStudy({
        productModelId: input.productModelId,
        measurementPointDefId: input.measurementPointDefId,
        instrumentId: input.instrumentId,
        studyCode: input.studyCode,
        name: input.name,
        studyType: input.studyType ?? "gage_rr",
        operatorCount: input.operatorCount ?? 3,
        partCount: input.partCount ?? 10,
        trialCount: input.trialCount ?? 2,
        status: "running",
        startedAt: new Date(),
      });

      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "msa.study.start",
        entityType: "product",
        entityId: id,
        entityName: input.studyCode,
        details: input,
        status: "success",
      });
      return { id };
    }),

  addObservation: adminProcedure
    .input(z.object({
      studyId: z.number().int().positive(),
      operatorName: z.string().min(1).max(120),
      partLabel: z.string().min(1).max(120),
      trialNo: z.number().int().positive(),
      measuredValue: z.string().min(1),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const study = await db.getMsaStudyById(input.studyId);
      if (!study) throw new TRPCError({ code: "NOT_FOUND", message: "MSA study not found" });
      if (study.status === "completed" || study.status === "cancelled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Study is closed" });
      }

      const duplicated = await db.getMsaObservationByCell(
        input.studyId,
        input.operatorName,
        input.partLabel,
        input.trialNo,
      );
      if (duplicated) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Observation for (${input.operatorName}, ${input.partLabel}, trial ${input.trialNo}) already exists`,
        });
      }

      const value = Number(input.measuredValue);
      if (!Number.isFinite(value)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "measuredValue must be numeric" });
      }

      const id = await db.addMsaObservation({
        studyId: input.studyId,
        operatorName: input.operatorName,
        partLabel: input.partLabel,
        trialNo: input.trialNo,
        measuredValue: String(value),
        notes: input.notes,
      });

      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "msa.observation.add",
        entityType: "product",
        entityId: input.studyId,
        details: { observationId: id, operatorName: input.operatorName, partLabel: input.partLabel, trialNo: input.trialNo },
        status: "success",
      });
      return { id };
    }),

  addObservationsBatch: adminProcedure
    .input(z.object({
      studyId: z.number().int().positive(),
      skipDuplicates: z.boolean().optional(),
      rows: z.array(z.object({
        operatorName: z.string().min(1).max(120),
        partLabel: z.string().min(1).max(120),
        trialNo: z.number().int().positive(),
        measuredValue: z.string().min(1),
        notes: z.string().optional(),
      })).min(1).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const study = await db.getMsaStudyById(input.studyId);
      if (!study) throw new TRPCError({ code: "NOT_FOUND", message: "MSA study not found" });
      if (study.status === "completed" || study.status === "cancelled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Study is closed" });
      }

      const skipDuplicates = input.skipDuplicates !== false;
      let created = 0;
      let skipped = 0;
      const errors: Array<{ index: number; message: string }> = [];

      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i];

        const value = Number(row.measuredValue);
        if (!Number.isFinite(value)) {
          errors.push({ index: i, message: "measuredValue must be numeric" });
          continue;
        }

        const duplicated = await db.getMsaObservationByCell(
          input.studyId,
          row.operatorName,
          row.partLabel,
          row.trialNo,
        );

        if (duplicated) {
          if (skipDuplicates) {
            skipped++;
            continue;
          }
          errors.push({
            index: i,
            message: `Duplicate cell (${row.operatorName}, ${row.partLabel}, trial ${row.trialNo})`,
          });
          continue;
        }

        await db.addMsaObservation({
          studyId: input.studyId,
          operatorName: row.operatorName,
          partLabel: row.partLabel,
          trialNo: row.trialNo,
          measuredValue: String(value),
          notes: row.notes,
        });
        created++;
      }

      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "msa.observation.batch_add",
        entityType: "product",
        entityId: input.studyId,
        details: { totalRows: input.rows.length, created, skipped, errorCount: errors.length, skipDuplicates },
        status: errors.length > 0 ? "failure" : "success",
      });

      return {
        success: true,
        created,
        skipped,
        errorCount: errors.length,
        errors,
      };
    }),

  generateMatrix: adminProcedure
    .input(z.object({
      studyId: z.number().int().positive(),
      overwriteExisting: z.boolean().optional(),
      baseValue: z.number().optional(),
      noisePct: z.number().min(0).max(50).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const study = await db.getMsaStudyById(input.studyId);
      if (!study) throw new TRPCError({ code: "NOT_FOUND", message: "MSA study not found" });
      if (study.status === "completed" || study.status === "cancelled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Study is closed" });
      }

      const result = await db.generateMsaObservationMatrix(input.studyId, {
        overwriteExisting: input.overwriteExisting,
        baseValue: input.baseValue,
        noisePct: input.noisePct,
      });

      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "msa.matrix.generate",
        entityType: "product",
        entityId: input.studyId,
        details: { ...input, ...result },
        status: "success",
      });

      return { success: true, ...result };
    }),

  completeStudy: adminProcedure
    .input(z.object({ studyId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const study = await db.getMsaStudyById(input.studyId);
      if (!study) throw new TRPCError({ code: "NOT_FOUND", message: "MSA study not found" });

      const summary = await db.calculateMsaSummary(input.studyId);
      await db.updateMsaStudy(input.studyId, {
        status: "completed",
        completedAt: new Date(),
        summary,
      });

      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "msa.study.complete",
        entityType: "product",
        entityId: input.studyId,
        details: summary,
        status: "success",
      });
      return { success: true, summary };
    }),

  cancelStudy: adminProcedure
    .input(z.object({ studyId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const study = await db.getMsaStudyById(input.studyId);
      if (!study) throw new TRPCError({ code: "NOT_FOUND", message: "MSA study not found" });
      await db.updateMsaStudy(input.studyId, { status: "cancelled", isActive: false });
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "msa.study.cancel",
        entityType: "product",
        entityId: input.studyId,
        status: "success",
      });
      return { success: true };
    }),
});

// (P4.A routers appended below)

// ============================================================
// P4.A G19 — Instrument Calibration & MSA records routers
// ============================================================
export const instrumentCalibrationRouter = router({
  list: protectedProcedure
    .input(z.object({ instrumentId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return db.listInstrumentCalibrations(input.instrumentId);
    }),

  health: protectedProcedure
    .input(z.object({ instrumentId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return db.getInstrumentHealth(input.instrumentId);
    }),

  create: adminProcedure
    .input(z.object({
      instrumentId: z.number().int().positive(),
      certNumber: z.string().min(1).max(120),
      certPdfUrl: z.string().url().optional(),
      certPdfKey: z.string().max(255).optional(),
      traceability: z.string().max(80).optional(),
      performedAt: z.coerce.date(),
      validUntil: z.coerce.date(),
      performedBy: z.string().max(255).optional(),
      performedByOrg: z.string().max(255).optional(),
      referenceStandard: z.string().max(255).optional(),
      asFoundBias: z.string().optional(),
      asLeftBias: z.string().optional(),
      uncertainty: z.string().optional(),
      result: z.enum(["pass", "conditional", "fail"]).default("pass"),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const inst = await db.getMeasurementInstrumentById(input.instrumentId);
      if (!inst) throw new TRPCError({ code: "NOT_FOUND", message: "Instrument not found" });
      const id = await db.createInstrumentCalibration({ ...input, createdBy: ctx.user.id });
      // Sync convenience: update instrument's lastCalibrationAt / nextCalibrationAt
      if (input.result !== "fail") {
        await db.updateMeasurementInstrument(input.instrumentId, {
          lastCalibrationAt: input.performedAt,
          nextCalibrationAt: input.validUntil,
        });
      }
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "instrumentCalibration.create",
        entityType: "instrument",
        entityId: input.instrumentId,
        entityName: inst.code,
        details: { certNumber: input.certNumber, result: input.result, validUntil: input.validUntil },
        status: "success",
      });
      return { id };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await db.softDeleteInstrumentCalibration(input.id);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "instrumentCalibration.delete",
        entityType: "instrument",
        entityId: input.id,
        status: "success",
      });
      return { success: true };
    }),
});

export const instrumentMsaRecordRouter = router({
  list: protectedProcedure
    .input(z.object({ instrumentId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return db.listInstrumentMsaRecords(input.instrumentId);
    }),

  create: adminProcedure
    .input(z.object({
      instrumentId: z.number().int().positive(),
      msaStudyId: z.number().int().positive().optional(),
      method: z.enum(["ARM", "ANOVA", "BIAS", "LINEARITY", "STABILITY"]).default("ARM"),
      performedAt: z.coerce.date().optional(),
      validUntil: z.coerce.date(),
      evPct: z.string().optional(),
      avPct: z.string().optional(),
      grrPct: z.string().optional(),
      ndc: z.number().int().nonnegative().optional(),
      ptRatio: z.string().optional(),
      biasValue: z.string().optional(),
      linearityScore: z.string().optional(),
      stabilityScore: z.string().optional(),
      verdict: z.enum(["good", "acceptable", "poor", "unknown"]).default("unknown"),
      notes: z.string().optional(),
      reportPdfUrl: z.string().url().optional(),
      reportPdfKey: z.string().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const inst = await db.getMeasurementInstrumentById(input.instrumentId);
      if (!inst) throw new TRPCError({ code: "NOT_FOUND", message: "Instrument not found" });
      const id = await db.createInstrumentMsaRecord({ ...input, createdBy: ctx.user.id });
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "instrumentMsaRecord.create",
        entityType: "instrument",
        entityId: input.instrumentId,
        entityName: inst.code,
        details: { method: input.method, verdict: input.verdict, validUntil: input.validUntil },
        status: "success",
      });
      return { id };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await db.softDeleteInstrumentMsaRecord(input.id);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "instrumentMsaRecord.delete",
        entityType: "instrument",
        entityId: input.id,
        status: "success",
      });
      return { success: true };
    }),
});

// ============================================================
// P4.A G17 — MP Lighting Profile router
// ============================================================
export const mpLightingProfileRouter = router({
  listByPoint: protectedProcedure
    .input(z.object({ pointDefId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return db.listMpLightingProfiles(input.pointDefId);
    }),

  create: adminProcedure
    .input(z.object({
      pointDefId: z.number().int().positive(),
      shotIndex: z.number().int().positive().default(1),
      name: z.string().max(120).optional(),
      lightSource: z.enum([
        "ring", "coaxial", "dome", "side_low_angle", "back",
        "uv", "ir", "multi_spectral", "dark_field",
      ]).default("ring"),
      color: z.enum(["white", "red", "green", "blue", "rgb", "ir", "uv", "custom"]).default("white"),
      colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      intensityPct: z.number().int().min(0).max(100).default(100),
      angleDeg: z.number().int().min(0).max(90).optional(),
      exposureUs: z.number().int().positive().optional(),
      gain: z.string().optional(),
      focusOffsetUm: z.number().int().optional(),
      opticalFilter: z.string().max(60).optional(),
      purpose: z.string().max(60).optional(),
      referenceImageUrl: z.string().url().optional(),
      referenceImageKey: z.string().max(255).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await db.createMpLightingProfile(input);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "mpLightingProfile.create",
        entityType: "measurementPoint",
        entityId: input.pointDefId,
        details: { shotIndex: input.shotIndex, lightSource: input.lightSource, color: input.color },
        status: "success",
      });
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      shotIndex: z.number().int().positive().optional(),
      name: z.string().max(120).optional(),
      lightSource: z.enum([
        "ring", "coaxial", "dome", "side_low_angle", "back",
        "uv", "ir", "multi_spectral", "dark_field",
      ]).optional(),
      color: z.enum(["white", "red", "green", "blue", "rgb", "ir", "uv", "custom"]).optional(),
      colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      intensityPct: z.number().int().min(0).max(100).optional(),
      angleDeg: z.number().int().min(0).max(90).optional(),
      exposureUs: z.number().int().positive().optional(),
      gain: z.string().optional(),
      focusOffsetUm: z.number().int().optional(),
      opticalFilter: z.string().max(60).optional(),
      purpose: z.string().max(60).optional(),
      referenceImageUrl: z.string().url().optional(),
      referenceImageKey: z.string().max(255).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await db.updateMpLightingProfile(id, data);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "mpLightingProfile.update",
        entityType: "measurementPoint",
        entityId: id,
        details: data,
        status: "success",
      });
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await db.softDeleteMpLightingProfile(input.id);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "mpLightingProfile.delete",
        entityType: "measurementPoint",
        entityId: input.id,
        status: "success",
      });
      return { success: true };
    }),
});

// (P4.B routers appended)

// ============================================================
// P4.B G14 — measurement_samples ingest + SPC analytics router
// ============================================================
export const measurementSamplesRouter = router({
  /**
   * Bulk ingest samples (typically from a machine submission). Returns count.
   * Auto-creates monthly partitions as needed.
   */
  ingest: protectedProcedure
    .input(z.object({
      rows: z.array(z.object({
        pointDefId: z.number().int().positive(),
        machineId: z.number().int().positive().optional(),
        inspectionId: z.number().int().positive().optional(),
        serialNumber: z.string().max(128).optional(),
        stationCode: z.string().max(50).optional(),
        value: z.number(),
        isOk: z.boolean().optional(),
        operatorId: z.number().int().positive().optional(),
        instrumentId: z.number().int().positive().optional(),
        lotCode: z.string().max(80).optional(),
        shiftCode: z.string().max(20).optional(),
        envTempC: z.number().optional(),
        envRhPct: z.number().optional(),
        sampledAt: z.coerce.date(),
      })).min(1).max(5000),
    }))
    .mutation(async ({ input }) => {
      // P4.B G19 — hard gate: validate every distinct instrumentId referenced
      // in the batch is fit-for-use (active, in-date calibration, valid MSA).
      const instrumentIds = Array.from(new Set(
        input.rows.map((r) => r.instrumentId).filter((v): v is number => typeof v === "number"),
      ));
      for (const id of instrumentIds) {
        await assertInstrumentReady(id);
      }
      const inserted = await db.insertMeasurementSamples(
        input.rows.map((r) => ({
          ...r,
          value: String(r.value) as any,
          envTempC: r.envTempC != null ? (String(r.envTempC) as any) : undefined,
          envRhPct: r.envRhPct != null ? (String(r.envRhPct) as any) : undefined,
        })) as any,
      );
      return { inserted };
    }),

  /**
   * Recent samples for SPC chart (chronological).
   */
  list: protectedProcedure
    .input(z.object({
      pointDefId: z.number().int().positive(),
      windowSize: z.number().int().min(1).max(2000).optional(),
      fromTs: z.coerce.date().optional(),
      toTs: z.coerce.date().optional(),
    }))
    .query(async ({ input }) => {
      return db.listMeasurementSamples(input);
    }),

  /**
   * Compute SPC stats + WE/Nelson/EWMA violations on the fly. Optionally upserts
   * the rolling cache + persists detected alerts.
   */
  analyze: protectedProcedure
    .input(z.object({
      pointDefId: z.number().int().positive(),
      windowSize: z.number().int().min(10).max(1000).default(50),
      // Optional explicit limits — otherwise computed from window
      mean: z.number().optional(),
      sigma: z.number().positive().optional(),
      usl: z.number().optional(),
      lsl: z.number().optional(),
      persistAlerts: z.boolean().default(false),
      persistRolling: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const samples = await db.listMeasurementSamples({
        pointDefId: input.pointDefId,
        windowSize: input.windowSize,
      });
      if (samples.length === 0) {
        return { samples: 0, violations: [], capability: null, ewma: null };
      }
      const values = samples.map((s) => Number(s.value));
      const cap = rollingCapability(values, input.usl ?? null, input.lsl ?? null);
      const limits = {
        mean: input.mean ?? cap.mean,
        sigma: input.sigma ?? cap.sigmaWithin,
      };
      const sampleTuples = samples.map((s) => ({
        id: Number(s.id), value: Number(s.value), sampledAt: s.sampledAt,
      }));
      const violations = detectSpcViolations(sampleTuples, limits);
      const ewma = detectEwma(sampleTuples, limits);
      const allViolations = [...violations, ...ewma.violations];

      if (input.persistAlerts) {
        const sinks = loadDefaultSinksFromEnv();
        for (const v of allViolations) {
          await db.createSpcAlert({
            pointDefId: input.pointDefId,
            ruleCode: v.ruleCode,
            ruleName: v.ruleName,
            severity: v.severity,
            windowFrom: v.windowFrom,
            windowTo: v.windowTo,
            sampleIds: v.sampleIds as any,
            summary: v.summary as any,
          });
          // Fire-and-forget — do not block the mutation on sink errors.
          publishSpcAlert({
            pointDefId: input.pointDefId,
            ruleCode: v.ruleCode,
            ruleName: v.ruleName,
            severity: v.severity,
            windowFrom: v.windowFrom,
            windowTo: v.windowTo,
            sampleIds: v.sampleIds as number[],
            summary: v.summary,
          }, sinks).catch(() => undefined);
        }
        // W5-A: additionally route persisted OOC violations into the CENTRAL
        // alert/Andon path (predictive_alerts + notify, optional advisory Andon).
        // Flag-gated (SPC_CENTRAL_ALERT_ENABLED, default OFF); fire-and-forget and
        // de-duped per (pointDefId, ruleCode) inside the bridge — never blocks this
        // mutation nor the SPC-only sink fan-out above.
        routeSpcViolationsToCentral(allViolations, { pointDefId: input.pointDefId });
      }
      if (input.persistRolling) {
        await db.upsertRollingSpc({
          pointDefId: input.pointDefId,
          windowSize: input.windowSize,
          n: samples.length,
          mean: String(cap.mean) as any,
          stdDev: String(cap.sigmaOverall) as any,
          minValue: String(Math.min(...values)) as any,
          maxValue: String(Math.max(...values)) as any,
          cp: cap.cp != null ? (String(cap.cp) as any) : undefined,
          cpk: cap.cpk != null ? (String(cap.cpk) as any) : undefined,
          pp: cap.pp != null ? (String(cap.pp) as any) : undefined,
          ppk: cap.ppk != null ? (String(cap.ppk) as any) : undefined,
          ewmaLast: ewma.ewma.length ? (String(ewma.ewma[ewma.ewma.length - 1]) as any) : undefined,
        });
      }
      return {
        samples: samples.length,
        capability: cap,
        violations: allViolations,
        ewma: { ewma: ewma.ewma, ucl: ewma.ucl, lcl: ewma.lcl },
        limits,
      };
    }),
});

export const spcAlertsRouter = router({
  list: protectedProcedure
    .input(z.object({
      pointDefId: z.number().int().positive().optional(),
      unackedOnly: z.boolean().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.listSpcAlerts(input ?? {});
    }),

  ack: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      note: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.ackSpcAlert(input.id, ctx.user.id, input.note);
      return { success: true };
    }),
});

// ============================================================
// P4.B G10 — Per-MP defect heatmap stats router
// ============================================================
export const mpDefectStatsRouter = router({
  byProductModel: protectedProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      productViewId: z.number().int().positive().optional(),
      machineId: z.number().int().positive().optional(),
      fromTs: z.coerce.date().optional(),
      toTs: z.coerce.date().optional(),
      // Convenience: lastNDays overrides fromTs/toTs.
      lastNDays: z.number().int().min(1).max(365).optional(),
    }))
    .query(async ({ input }) => {
      let fromTs = input.fromTs;
      let toTs = input.toTs;
      if (input.lastNDays) {
        const now = new Date();
        toTs = now;
        fromTs = new Date(now.getTime() - input.lastNDays * 24 * 3600 * 1000);
      }
      return db.getMpDefectStatsForProduct({
        productModelId: input.productModelId,
        productViewId: input.productViewId,
        machineId: input.machineId,
        fromTs,
        toTs,
      });
    }),
});

// (P4.B G12 MSA advanced router appended)

// ============================================================
// P4.B G12 — Advanced MSA: ANOVA, Bias, Linearity, Stability
// Stateless analytical endpoints (the inputs come from CSV/observations the
// caller already has). Persist results via instrumentMsaRecordRouter.create.
// ============================================================
export const msaAdvancedRouter = router({
  anovaGrr: protectedProcedure
    .input(z.object({
      observations: z.array(z.object({
        operator: z.string().min(1),
        part: z.string().min(1),
        trial: z.number().int().positive(),
        value: z.number(),
      })).min(4),
      tolerance: z.number().positive().optional(),
    }))
    .mutation(async ({ input }) => {
      return calculateAnovaGrr(input.observations, input.tolerance);
    }),

  bias: protectedProcedure
    .input(z.object({
      values: z.array(z.number()).min(2),
      refValue: z.number(),
    }))
    .mutation(async ({ input }) => {
      return calculateBias(input.values, input.refValue);
    }),

  linearity: protectedProcedure
    .input(z.object({
      points: z.array(z.object({
        refValue: z.number(),
        measurements: z.array(z.number()).min(1),
      })).min(2),
    }))
    .mutation(async ({ input }) => {
      return calculateLinearity(input.points);
    }),

  stability: protectedProcedure
    .input(z.object({
      readings: z.array(z.object({
        timestamp: z.coerce.date(),
        values: z.array(z.number()).min(2).max(10),
      })).min(2),
    }))
    .mutation(async ({ input }) => {
      return calculateStability(input.readings);
    }),

  /**
   * For ANOVA on an existing MSA study (uses the study's observations table).
   */
  anovaOfStudy: protectedProcedure
    .input(z.object({
      studyId: z.number().int().positive(),
      tolerance: z.number().positive().optional(),
    }))
    .mutation(async ({ input }) => {
      const obs = await db.listMsaObservationsByStudy(input.studyId);
      const adapted = obs.map((o: any) => ({
        operator: String(o.operatorName ?? "?"),
        part: String(o.partLabel ?? "?"),
        trial: Number(o.trialNumber ?? 1),
        value: Number(o.measuredValue),
      })).filter((o) => Number.isFinite(o.value));
      return calculateAnovaGrr(adapted, input.tolerance);
    }),
});

// (P4.B G9 CAD import router appended)

// ============================================================
// P4.B G9 — CAD Import (STEP AP242 + DXF) router
// Two-step flow:
//   1) parseUpload  — uploads CAD text + parses → creates job + candidates.
//   2) listCandidates / setSelection — user reviews, toggles candidates.
//   3) apply — converts selected candidates into measurement_point_defs.
// ============================================================
export const cadImportRouter = router({
  list: protectedProcedure
    .input(z.object({ productModelId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return db.listCadImportJobsByProduct(input.productModelId);
    }),

  getJob: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      return db.getCadImportJobById(input.id);
    }),

  parseUpload: adminProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      fileName: z.string().min(1).max(255),
      // Base64-encoded contents OR raw text (set isBase64 accordingly).
      content: z.string().min(1).max(50 * 1024 * 1024),
      isBase64: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const text = input.isBase64
        ? Buffer.from(input.content, "base64").toString("utf-8")
        : input.content;
      const buf = Buffer.from(text, "utf-8");
      const sha256 = createHash("sha256").update(buf).digest("hex");

      // Persist raw file in storage (best-effort).
      const key = `cad-imports/${input.productModelId}/${Date.now()}_${input.fileName}`;
      let stored: { key: string; url: string } | null = null;
      try {
        stored = await storagePut(key, buf, "application/octet-stream");
      } catch (e: any) {
        // Don't block parsing if storage fails.
      }

      const parsed = parseCad(input.fileName, text);
      const jobId = await db.createCadImportJob({
        productModelId: input.productModelId,
        format: parsed.format,
        fileName: input.fileName,
        fileKey: stored?.key,
        fileUrl: stored?.url,
        fileSizeBytes: buf.length,
        fileSha256: sha256,
        status: "parsed",
        parserVersion: parsed.parserVersion,
        entityCounts: parsed.entityCounts,
        candidatePointCount: parsed.candidates.length,
        uploadedBy: ctx.user.id,
      });
      if (parsed.candidates.length > 0) {
        await db.bulkInsertCadImportCandidates(parsed.candidates.map((c) => ({
          jobId,
          candidateIndex: c.candidateIndex,
          code: c.code,
          name: c.name,
          shape: c.shape,
          positionX: String(c.positionX) as any,
          positionY: String(c.positionY) as any,
          positionZ: c.positionZ != null ? (String(c.positionZ) as any) : undefined,
          radius: c.radius != null ? (String(c.radius) as any) : undefined,
          geometry: c.geometry as any,
          sourceEntityType: c.sourceEntityType,
          sourceEntityId: c.sourceEntityId,
        })));
      }
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "cadImport.parse",
        entityType: "product",
        entityId: input.productModelId,
        entityName: input.fileName,
        details: {
          jobId, format: parsed.format,
          candidates: parsed.candidates.length,
          warnings: parsed.warnings,
        },
        status: "success",
      });
      return {
        jobId,
        format: parsed.format,
        candidates: parsed.candidates.length,
        entityCounts: parsed.entityCounts,
        warnings: parsed.warnings,
      };
    }),

  listCandidates: protectedProcedure
    .input(z.object({ jobId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return db.listCadImportCandidates(input.jobId);
    }),

  setSelection: adminProcedure
    .input(z.object({
      jobId: z.number().int().positive(),
      candidateIds: z.array(z.number().int().positive()).max(10000),
      selected: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      await db.setCadCandidateSelection(input.jobId, input.candidateIds, input.selected);
      return { success: true };
    }),

  applyJob: adminProcedure
    .input(z.object({ jobId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const job = await db.getCadImportJobById(input.jobId);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "CAD import job not found" });
      if (job.status === "applied") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "CAD import job already applied" });
      }
      const count = await db.applyCadImportJob(input.jobId, ctx.user.id);
      // Doc 51 P1 (R4 / CASE #12) — was a READ-MODIFY-WRITE (read version, +1,
      // write it back) wrapped in a bare `try {} catch {}`: two concurrent config
      // changes both reading v7 both wrote v8, so one change shipped under a
      // version some machine already held and was never re-fetched — and the empty
      // catch hid every failure. Now one atomic `col = col + 1` (+ MQTT nudge),
      // and a bump failure surfaces instead of silently stranding the fleet.
      await bumpAndNotifyPointsConfig(job.productModelId);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "cadImport.apply",
        entityType: "product",
        entityId: job.productModelId,
        entityName: job.fileName,
        details: { jobId: input.jobId, applied: count },
        status: "success",
      });
      return { applied: count };
    }),

  // ══════════════════════════════════════════════════════════════════════════
  // Doc 31 MP5 / PM4 (Đợt C, decision #5) — GENERIC centroid / pick-place import.
  // A configurable column map (like the hot-folder adapter) defers all
  // vendor-specific work to UI mapping — no code change to onboard a real
  // Fuji / Panasonic / Siemens / KiCad file. Flow: inspect → preview → commit
  // → apply, reusing cad_import_jobs / cad_import_candidates (no migration).
  // ══════════════════════════════════════════════════════════════════════════
  centroidInspect: adminProcedure
    .input(z.object({
      content: z.string().min(1).max(50 * 1024 * 1024),
      isBase64: z.boolean().default(false),
      delimiter: z.enum([",", ";", "\t", "auto"]).optional(),
      hasHeader: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const text = input.isBase64
        ? Buffer.from(input.content, "base64").toString("utf-8")
        : input.content;
      return inspectCentroidHeaders(text, {
        delimiter: input.delimiter,
        hasHeader: input.hasHeader,
      });
    }),

  centroidPreview: adminProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      content: z.string().min(1).max(50 * 1024 * 1024),
      isBase64: z.boolean().default(false),
      columnMap: centroidColumnMapSchema.optional(),
      parseOptions: centroidParseOptionsSchema.optional(),
      transformOptions: centroidTransformOptionsSchema.optional(),
    }))
    .mutation(async ({ input }) => {
      const text = input.isBase64
        ? Buffer.from(input.content, "base64").toString("utf-8")
        : input.content;
      return previewCentroidImport({
        productModelId: input.productModelId,
        text,
        columnMap: input.columnMap,
        parseOptions: input.parseOptions,
        transformOptions: input.transformOptions,
      });
    }),

  centroidCommit: adminProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      fileName: z.string().min(1).max(255),
      content: z.string().min(1).max(50 * 1024 * 1024),
      isBase64: z.boolean().default(false),
      columnMap: centroidColumnMapSchema,
      parseOptions: centroidParseOptionsSchema.optional(),
      transformOptions: centroidTransformOptionsSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const text = input.isBase64
        ? Buffer.from(input.content, "base64").toString("utf-8")
        : input.content;
      const buf = Buffer.from(text, "utf-8");
      return commitCentroidImport({
        productModelId: input.productModelId,
        fileName: input.fileName,
        text,
        fileSha256: createHash("sha256").update(buf).digest("hex"),
        fileSizeBytes: buf.length,
        uploadedBy: ctx.user.id,
        columnMap: input.columnMap,
        parseOptions: input.parseOptions,
        transformOptions: input.transformOptions,
      });
    }),

  centroidApply: adminProcedure
    .input(z.object({
      jobId: z.number().int().positive(),
      measurementType: legacyMeasurementTypeSchema.optional(),
      radius: z.number().int().min(1).max(100000).optional(),
      cropWidth: z.number().int().min(1).max(100000).optional(),
      cropHeight: z.number().int().min(1).max(100000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const job = await db.getCadImportJobById(input.jobId);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Centroid import job not found" });
      return applyCentroidImport({
        jobId: input.jobId,
        appliedBy: ctx.user.id,
        appliedByName: ctx.user.name ?? undefined,
        defaults: {
          measurementType: input.measurementType,
          radius: input.radius,
          cropWidth: input.cropWidth,
          cropHeight: input.cropHeight,
        },
      });
    }),

  // ══════════════════════════════════════════════════════════════════════════
  // Doc 54 §11 P0.1 — apply CAD/centroid coordinates onto EXISTING points.
  // The centroidCommit/centroidApply pair above CREATES new points; these two
  // instead MATCH a pick-place file to points that already exist and WRITE their
  // real X/Y — the fix for points bulk-imported at (0,0). Gated on
  // settings_measurement_points/canCreate (same as measurementPoint.create and
  // importList) so engineers — not only admins — can run it.
  // ══════════════════════════════════════════════════════════════════════════
  parsePreview: protectedProcedure.use(requirePermission("settings_measurement_points", "canCreate"))
    .input(z.object({
      productModelId: z.number().int().positive(),
      content: z.string().min(1).max(50 * 1024 * 1024),
      isBase64: z.boolean().default(false),
      columnMap: centroidColumnMapSchema.optional(),
      parseOptions: centroidParseOptionsSchema.optional(),
      transformOptions: centroidTransformOptionsSchema.optional(),
    }))
    .mutation(async ({ input }) => {
      const text = input.isBase64
        ? Buffer.from(input.content, "base64").toString("utf-8")
        : input.content;
      return previewCoordinateApply({
        productModelId: input.productModelId,
        text,
        columnMap: input.columnMap,
        parseOptions: input.parseOptions,
        transformOptions: input.transformOptions,
      });
    }),

  applyCoordinates: protectedProcedure.use(requirePermission("settings_measurement_points", "canCreate"))
    .input(z.object({
      productModelId: z.number().int().positive(),
      fileName: z.string().min(1).max(255).default("coordinates.csv"),
      content: z.string().min(1).max(50 * 1024 * 1024),
      isBase64: z.boolean().default(false),
      columnMap: centroidColumnMapSchema.optional(),
      parseOptions: centroidParseOptionsSchema.optional(),
      transformOptions: centroidTransformOptionsSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const text = input.isBase64
        ? Buffer.from(input.content, "base64").toString("utf-8")
        : input.content;
      const buf = Buffer.from(text, "utf-8");
      const res = await applyCoordinatesToPoints({
        productModelId: input.productModelId,
        fileName: input.fileName,
        text,
        fileSha256: createHash("sha256").update(buf).digest("hex"),
        fileSizeBytes: buf.length,
        uploadedBy: ctx.user.id,
        columnMap: input.columnMap,
        parseOptions: input.parseOptions,
        transformOptions: input.transformOptions,
      });
      // MQTT nudge (best-effort) so AOI/AVI machines re-fetch the bumped config.
      if (res.bumped) {
        try {
          publishPointsConfigChanged(res.bumped.code, res.bumped.version);
        } catch {
          /* machines pick it up on the next poll */
        }
      }
      return res;
    }),
});
