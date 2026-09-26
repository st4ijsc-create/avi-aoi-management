/**
 * doc 55 Item 3 / PV3 — PRODUCT VARIANT admin (tRPC) router.
 *
 * Thin CRUD/query wrapper over the PV0 db helpers (server/db/product.ts). It is the
 * backend the PV3 frontend calls to author variants, their point overrides, and to
 * preview a variant's EFFECTIVE point set (common ∪ added − excluded, overrides patched).
 *
 * ── Scope / flag boundary ─────────────────────────────────────────────────────
 * This router is deliberately NOT gated behind PRODUCT_VARIANT_ENABLED. Authoring a
 * variant is MASTER-DATA administration; the flag only gates the machine-facing
 * sync/ingest path (PV1/PV2) — i.e. whether a machine *sees* variants at all. An
 * engineer must be able to prepare variant data while the flag is still OFF, exactly
 * as they prepare any other product master-data. Writing variant rows with the flag
 * OFF changes nothing the fleet observes (submitInspection never stamps variantId and
 * the read paths use the MODEL point set + MODEL version until the flag flips).
 *
 * ── Migration guard ───────────────────────────────────────────────────────────
 * product_variants / variant_point_overrides / measurement_point_defs.variantId all
 * arrive in migration 0286, which may not yet be applied at runtime (code can deploy
 * ahead of the coordinator). Every procedure asserts the table is present first and
 * returns a clean PRECONDITION_FAILED ("apply 0286") instead of a raw 42P01 500.
 *
 * ── Permissions ───────────────────────────────────────────────────────────────
 * Variant lifecycle (list/get/create/update/delete + effective-point reads) is product
 * master-data ⇒ `settings_products` (canView/canCreate/canEdit/canDelete), consistent
 * with productModelRouter. Point OVERRIDE mutations edit what a variant *measures* ⇒
 * `settings_measurement_points` canEdit, consistent with measurementPointRouter — the
 * permission tracks the nature of the data being changed.
 */
import { protectedProcedure, router } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import * as db from "../db";
import type { ProductVariant, VariantPointOverride } from "../../drizzle/schema";
// ★★★ BG-113/I-3 (review Khối C lượt 9) — `setOverride.patchJson` là nguồn giới
// hạn THỨ HAI ngoài `POINT_LIMIT_SPEC`/`APPROVAL_LIMIT_FIELDS`: whitelist khoá
// (schema), cửa duyệt ngưỡng (assertThresholdEditAllowed), và ghi version
// (db.recordVariantOverrideVersion) — xem docblock tại chỗ dùng bên dưới.
import { APPROVAL_LIMIT_FIELDS, MIN_MAX_PAIRS } from "@shared/pointLimitSpec";
import { assertThresholdEditAllowed } from "../services/thresholdGovernanceService";
import { assertCapGioiHanHopLe, gopCapGioiHanDonGian, type CapGioiHan } from "../utils/measurementPointLimitGate";

/**
 * ★★★ NEW-1 (review Khối C lượt 9, vòng 2, Important) — rút đúng các field tham
 * gia MỘT cặp min/max (`MIN_MAX_PAIRS`, `shared/pointLimitSpec.ts`) từ một object
 * bất kỳ (hàng DB hoặc `patchJson` đã qua whitelist) — dùng ở CẢ `setOverride`
 * lẫn `removeOverride` để không lặp lại 10 tên field hai lần. TRƯỚC bản vá này
 * hai điểm gọi chỉ đọc `lowerLimit`/`upperLimit` (hoặc thêm `heightMin`/`heightMax`
 * ở setOverride) — area/volume/thickness đi qua trắng dù whitelist patchJson
 * ĐÃ cho phép (SUY từ APPROVAL_LIMIT_FIELDS, không phải một khoá mới thêm).
 */
function layCapGioiHanTuDoi(obj: Record<string, unknown> | null | undefined): CapGioiHan {
  const ket: CapGioiHan = {};
  if (!obj) return ket;
  for (const { min, max } of MIN_MAX_PAIRS) {
    ket[min] = obj[min];
    ket[max] = obj[max];
  }
  return ket;
}

// ── Reserved code for the model's inheritance root — never manually creatable. ──
const BASE_VARIANT_CODE = "BASE";

/**
 * ★★★ BG-113/I-3 (review Khối C lượt 9) — WHITELIST khoá `patchJson` của
 * `setOverride`, SUY từ `APPROVAL_LIMIT_FIELDS` (MỘT nguồn, `shared/
 * pointLimitSpec.ts` — không chép tay danh sách cột lần nữa). TRƯỚC bản vá:
 * `z.record(z.string(), z.unknown())` nhận BẤT KỲ khoá nào — một patch
 * `{deletedAt: null}`/`{id: 999}` đi thẳng vào `gateLimits` qua
 * `apDungVariantPatch` (chỉ lọc khoá ĐỊNH DANH, không lọc khoá LẠ khác).
 *
 * Đo được (review lượt 9): client (`ProductVariantsTab.tsx`) hôm nay CHỈ gửi
 * `lowerLimit`/`upperLimit`/`nominalValue` — tập con của `APPROVAL_LIMIT_FIELDS`
 * — nên whitelist này KHÔNG cắt bất kỳ hành vi thật nào đang chạy. `.strict()`
 * từ chối khoá lạ (bao gồm khoá phi-giới-hạn) — `variant_point_overrides` =
 * 0 hàng hôm nay (đo được) nên không có bằng chứng cần thêm khoá phi-giới-hạn
 * nào; mở rộng sau nếu một nhu cầu THẬT xuất hiện, không đoán trước.
 */
const variantOverridePatchSchema = z
  .object(Object.fromEntries(APPROVAL_LIMIT_FIELDS.map((f) => [f, z.unknown().optional()])))
  .strict();

/**
 * Assert migration 0286 landed. Cheap (cached probe) — throws a clean, actionable
 * PRECONDITION_FAILED instead of letting a raw "relation does not exist" bubble as a
 * 500. Called at the top of every procedure so the whole router degrades gracefully
 * on a not-yet-migrated DB.
 */
async function assertVariantTableAvailable(): Promise<void> {
  const ok = await db.productVariantsTableAvailable();
  if (!ok) {
    throw appError(
      "PRECONDITION_FAILED",
      // F6 (doc 71) — "bảng chưa migrate" chốt về FEATURE_NOT_CONFIGURED trong toàn repo.
      "FEATURE_NOT_CONFIGURED",
      { feature: "productVariants" },
      "Tính năng biến thể sản phẩm chưa sẵn sàng: cần áp dụng migration 0286 (product_variants). " +
        "Product variants require migration 0286 to be applied.",
    );
  }
}

/** Clean DTO — the columns the UI needs, without leaking soft-delete internals. */
function toVariantDto(v: ProductVariant) {
  return {
    id: v.id,
    productModelId: v.productModelId,
    code: v.code,
    name: v.name,
    isBase: v.isBase,
    pointsConfigVersion: v.pointsConfigVersion,
    referenceImageUrl: v.referenceImageUrl,
    referenceImageKey: v.referenceImageKey,
    coordinateMode: v.coordinateMode,
    lifecycleStatus: v.lifecycleStatus,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

function toOverrideDto(o: VariantPointOverride) {
  return {
    id: o.id,
    variantId: o.variantId,
    basePointDefId: o.basePointDefId,
    action: o.action,
    patchJson: o.patchJson ?? null,
    updatedAt: o.updatedAt,
  };
}

const lifecycleStatusSchema = z.enum(["active", "eol", "archived"]);
const overrideActionSchema = z.enum(["exclude", "override"]);
const variantCodeSchema = z
  .string()
  .trim()
  .min(1, "Mã biến thể là bắt buộc")
  .max(100)
  .regex(/^[A-Za-z0-9_\-]+$/, "Mã chỉ được chứa chữ, số, gạch dưới, gạch ngang");

async function auditQuiet(entry: Parameters<typeof db.createAuditLog>[0]): Promise<void> {
  try {
    await db.createAuditLog(entry);
  } catch (err) {
    console.warn(`audit log failed (${entry.action})`, err);
  }
}

export const productVariantRouter = router({
  // ── list every live variant of a model (BASE first, then by code) ──
  listVariants: protectedProcedure
    .use(requirePermission("settings_products", "canView"))
    .input(z.object({ productModelId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await assertVariantTableAvailable();
      const variants = await db.getVariantsByModel(input.productModelId);
      return variants.map(toVariantDto);
    }),

  // ── one variant + its overrides + how many points it effectively inspects ──
  getVariant: protectedProcedure
    .use(requirePermission("settings_products", "canView"))
    .input(z.object({ variantId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await assertVariantTableAvailable();
      const variant = await db.getVariantById(input.variantId);
      if (!variant) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productVariant" }, "Không tìm thấy biến thể");
      }
      const [overrides, effective] = await Promise.all([
        db.getVariantOverrides(variant.id),
        db.resolveEffectivePoints(variant.productModelId, variant.id),
      ]);
      return {
        variant: toVariantDto(variant),
        overrides: overrides.map(toOverrideDto),
        effectivePointCount: effective.length,
      };
    }),

  // ── create a NON-BASE variant (isBase is never author-settable) ──
  createVariant: protectedProcedure
    .use(requirePermission("settings_products", "canCreate"))
    .input(z.object({
      productModelId: z.number().int().positive(),
      code: variantCodeSchema,
      name: z.string().trim().max(255).optional(),
      referenceImageUrl: z.string().max(2048).optional(),
      referenceImageKey: z.string().max(255).optional(),
      coordinateMode: z.string().trim().max(20).optional(),
      lifecycleStatus: lifecycleStatusSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertVariantTableAvailable();

      const model = await db.getProductModelById(input.productModelId);
      if (!model) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productModel" }, "Không tìm thấy sản phẩm");
      }
      // 'BASE' is reserved for the model's inheritance root (created by 0286 /
      // ensureBaseVariant); an author never mints one manually.
      if (input.code.toUpperCase() === BASE_VARIANT_CODE) {
        throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "code" }, `Mã '${BASE_VARIANT_CODE}' được dành riêng cho biến thể gốc`);
      }
      // Live-uniqueness pre-check (the partial unique index is the tx-level backstop).
      const existing = await db.getVariantByCode(input.productModelId, input.code);
      if (existing) {
        throw appError("CONFLICT", "ENTITY_DUPLICATE", { entity: "productVariant" }, `Biến thể '${input.code}' đã tồn tại`);
      }

      let id: number;
      try {
        id = await db.createVariant({
          productModelId: input.productModelId,
          code: input.code,
          name: input.name,
          referenceImageUrl: input.referenceImageUrl,
          referenceImageKey: input.referenceImageKey,
          coordinateMode: input.coordinateMode,
          lifecycleStatus: input.lifecycleStatus,
          // isBase intentionally omitted — schema default(false).
        });
      } catch (err: any) {
        if (err?.code === "23505" || /uq_product_variants_model_code/.test(String(err?.message))) {
          throw appError("CONFLICT", "ENTITY_DUPLICATE", { entity: "productVariant" }, `Biến thể '${input.code}' đã tồn tại`);
        }
        throw err;
      }

      await auditQuiet({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "productVariant.create",
        entityType: "product_variant",
        entityId: id,
        entityName: input.code,
        details: { productModelId: input.productModelId, code: input.code, name: input.name },
        status: "success",
      });
      return { id };
    }),

  // ── update a variant (isBase / productModelId are immutable; base is un-renamable) ──
  updateVariant: protectedProcedure
    .use(requirePermission("settings_products", "canEdit"))
    .input(z.object({
      variantId: z.number().int().positive(),
      code: variantCodeSchema.optional(),
      name: z.string().trim().max(255).optional(),
      referenceImageUrl: z.string().max(2048).optional(),
      referenceImageKey: z.string().max(255).optional(),
      coordinateMode: z.string().trim().max(20).optional(),
      lifecycleStatus: lifecycleStatusSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertVariantTableAvailable();

      const { variantId, ...patch } = input;
      const existing = await db.getVariantById(variantId);
      if (!existing) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productVariant" }, "Không tìm thấy biến thể");
      }

      if (patch.code !== undefined && patch.code !== existing.code) {
        // The base variant is the model's stable inheritance root — its code never moves.
        if (existing.isBase) {
          throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "renameRootVariantCode" }, "Không thể đổi mã biến thể gốc");
        }
        if (patch.code.toUpperCase() === BASE_VARIANT_CODE) {
          throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "code" }, `Mã '${BASE_VARIANT_CODE}' được dành riêng cho biến thể gốc`);
        }
        const clash = await db.getVariantByCode(existing.productModelId, patch.code);
        if (clash && clash.id !== variantId) {
          throw appError("CONFLICT", "ENTITY_DUPLICATE", { entity: "productVariant" }, `Biến thể '${patch.code}' đã tồn tại`);
        }
      }

      // Drop code from the write when unchanged so we never trip the unique index.
      const data: Record<string, unknown> = { ...patch };
      if (patch.code === undefined || patch.code === existing.code) delete data.code;

      try {
        await db.updateVariant(variantId, data as any);
      } catch (err: any) {
        if (err?.code === "23505" || /uq_product_variants_model_code/.test(String(err?.message))) {
          throw appError("CONFLICT", "ENTITY_DUPLICATE", { entity: "productVariant" }, "Mã biến thể đã tồn tại");
        }
        throw err;
      }

      await auditQuiet({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "productVariant.update",
        entityType: "product_variant",
        entityId: variantId,
        entityName: existing.code,
        details: { changedFields: Object.keys(data) },
        status: "success",
      });
      return { success: true };
    }),

  // ── soft-delete a NON-BASE variant (base is never deletable) ──
  deleteVariant: protectedProcedure
    .use(requirePermission("settings_products", "canDelete"))
    .input(z.object({ variantId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await assertVariantTableAvailable();

      const existing = await db.getVariantById(input.variantId);
      if (!existing) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productVariant" }, "Không tìm thấy biến thể");
      }
      if (existing.isBase) {
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "deleteRootVariant" }, "Không thể xoá biến thể gốc");
      }

      await db.softDeleteVariant(input.variantId);
      await auditQuiet({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "productVariant.delete",
        entityType: "product_variant",
        entityId: input.variantId,
        entityName: existing.code,
        details: { soft: true },
        status: "success",
      });
      return { success: true };
    }),

  // ── preview the EFFECTIVE point set a variant inspects (common/added/overridden) ──
  // origin lets the UI colour each row: 'base' (inherited untouched),
  // 'overridden' (inherited base point patched by this variant), 'variant' (added
  // only for this variant — QĐ#11 variantId row).
  getEffectivePoints: protectedProcedure
    .use(requirePermission("settings_products", "canView"))
    .input(z.object({
      productModelId: z.number().int().positive(),
      variantId: z.number().int().positive().nullable().optional(),
    }))
    .query(async ({ input }) => {
      await assertVariantTableAvailable();

      const variantId = input.variantId ?? null;
      let overriddenBaseIds = new Set<number>();
      let isNonBaseVariant = false;
      if (variantId != null) {
        const variant = await db.getVariantById(variantId);
        if (!variant) {
          throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productVariant" }, "Không tìm thấy biến thể");
        }
        if (variant.productModelId !== input.productModelId) {
          throw appError("BAD_REQUEST", "SCOPE_MISMATCH", { entity: "productVariant", parent: "productModel" }, "Biến thể không thuộc sản phẩm này");
        }
        isNonBaseVariant = !variant.isBase;
        if (isNonBaseVariant) {
          const overrides = await db.getVariantOverrides(variantId);
          overriddenBaseIds = new Set(
            overrides.filter((o) => o.action === "override").map((o) => o.basePointDefId),
          );
        }
      }

      const points = await db.resolveEffectivePoints(input.productModelId, variantId);
      const classified = points.map((p) => {
        let origin: "base" | "variant" | "overridden" = "base";
        if (isNonBaseVariant && p.variantId === variantId) origin = "variant";
        else if (overriddenBaseIds.has(p.id)) origin = "overridden";
        return { ...p, origin };
      });
      return { points: classified, count: classified.length };
    }),

  // ── set (upsert) a point override for a NON-BASE variant (QĐ#11) ──
  setOverride: protectedProcedure
    .use(requirePermission("settings_measurement_points", "canEdit"))
    .input(z.object({
      variantId: z.number().int().positive(),
      basePointDefId: z.number().int().positive(),
      action: overrideActionSchema,
      // BG-113/I-3 — whitelist APPROVAL_LIMIT_FIELDS (xem docblock hằng số ở trên).
      patchJson: variantOverridePatchSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertVariantTableAvailable();

      const variant = await db.getVariantById(input.variantId);
      if (!variant) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productVariant" }, "Không tìm thấy biến thể");
      }
      // Overrides express how a NON-BASE variant diverges FROM the base; the base
      // variant owns the common points directly and cannot override itself.
      if (variant.isBase) {
        throw appError(
          "BAD_REQUEST",
          "OPERATION_FAILED",
          { operation: "overrideBaseVariantPoint" },
          "Biến thể gốc không thể ghi đè điểm đo của chính nó",
        );
      }
      // action='override' must carry a patch; 'exclude' must not.
      if (input.action === "override" && (!input.patchJson || Object.keys(input.patchJson).length === 0)) {
        throw appError("BAD_REQUEST", "FIELD_REQUIRED", { field: "patchJson" }, "Ghi đè cần patchJson (các trường thay đổi)");
      }

      // The target must be a BASE/common point (variantId NULL) of THIS variant's model.
      const basePoint = await db.getMeasurementPointDefById(input.basePointDefId);
      if (!basePoint) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "measurementPoint" }, "Không tìm thấy điểm đo gốc");
      }
      if (basePoint.productModelId !== variant.productModelId) {
        throw appError("BAD_REQUEST", "SCOPE_MISMATCH", { entity: "measurementPoint", parent: "productModel" }, "Điểm đo không thuộc sản phẩm của biến thể");
      }
      if (basePoint.variantId != null) {
        throw appError(
          "BAD_REQUEST",
          "OPERATION_FAILED",
          { operation: "overrideBaseVariantPoint" },
          "Chỉ được ghi đè điểm đo chung (base) — không phải điểm riêng của biến thể",
        );
      }

      // ★★★ BG-113/I-3 (review Khối C lượt 9) — (b) CỬA DUYỆT NGƯỠNG, như 5 đường
      // ghi giới hạn khác (measurementPoint.update/setLimitsBatch/bulk-import/AI
      // Copilot).
      // ★★★ NEW-4 (review lượt 9, vòng 2, BG-125) — TRƯỚC bản vá này cửa CHỈ đứng
      // khi `action==='override'`; `'exclude'` đi thẳng qua, 0 gate. Lý do cũ ("exclude
      // không mang giá trị số nào để duyệt") SAI Ở CHỖ: loại hẳn một điểm khỏi cổng
      // của một biến thể LIVE là một thay đổi ngưỡng TRIỆT ĐỂ HƠN nới một cận số —
      // điểm đó không còn ai chấm nữa, bo XẤU lọt qua êm (BG-125). Cửa nay đứng cho
      // CẢ HAI action.
      await assertThresholdEditAllowed(input.basePointDefId);

      // ★★★ BG-113/I-3 — (c) GHI VERSION trước khi ghi đè, TRÊN CHÍNH bảng
      // `measurement_point_versions` mà snapshot-gate BG-97 đọc (xem docblock
      // `db.recordVariantOverrideVersion` cho phạm vi THẬT/giới hạn đã biết).
      // Snapshot là hiệu lực TRƯỚC lượt này: base + override CŨ (nếu có, dùng
      // LẠI `apDungVariantPatch` — Task 6, cùng công thức mà đường CHẤM dùng ở
      // `machineApiRouters.ts`), không phải base trơ — một override THAY một
      // override khác (hay một `exclude` xoá mất một override cũ) vẫn phải để lại
      // đúng trạng thái đã mất.
      // ★★★ NEW-4 — GHI VERSION nay chạy cho CẢ HAI action, cùng lý do cửa (b) ở trên:
      // `exclude` xoá hiệu lực số của điểm khỏi biến thể mà TRƯỚC bản vá không để
      // lại dấu vết nào trong `measurement_point_versions` — 0 version, đúng lớp lỗi
      // "đường ghi ẩn danh" mà I-3 đã vá cho `override`.
      const overridesHienCo = await db.getVariantOverrides(input.variantId);
      const ovHienCo = overridesHienCo.find((o) => o.basePointDefId === input.basePointDefId);
      const hieuLucTruoc = db.apDungVariantPatch(
        basePoint as unknown as Record<string, unknown>,
        ovHienCo?.action === "override" ? ovHienCo.patchJson : null,
      );

      // ★★★ BG-113 (I-2, đường ghi giới hạn THỨ SÁU) — patchJson biến thể có thể
      // mang BẤT KỲ field nào thuộc APPROVAL_LIMIT_FIELDS (whitelist ở trên cho
      // phép — bao gồm areaMin/areaMax/volumeMin/volumeMax/thicknessMin/thicknessMax,
      // không chỉ lowerLimit/upperLimit/heightMin/heightMax) ⇒ CÙNG lỗ "0 kiểm
      // min ≤ max" mà các đường kia đã vá. Kiểm trên khoảng ĐÃ MERGE: hiệu lực
      // TRƯỚC override (base + override CŨ, vừa tính ở trên cho bước ghi version)
      // đè bởi patch MỚI — patch chỉ đổi MỘT cận vẫn phải chặn nếu mâu thuẫn với
      // cận HIỆN CÓ (đúng nguyên tắc I-2).
      // ★★★ NEW-4 (CÙNG điểm gọi thứ 6/census, `limitRangeGateCensus` — override VÀ
      // exclude gộp một vùng) — `exclude` không mang patch số nào ⇒ merge với `{}`
      // (RỖNG, không đổi gì) — một lượt kiểm KHÔNG-ĐỔI, nhưng CÙNG một đường mã
      // bảo vệ tất cả ghi vào `measurement_point_versions` qua router này.
      // ★★★ NEW-1 — `layCapGioiHanTuDoi` rút CẢ NĂM cặp (10 field), không chỉ hai
      // cặp hard-code trước đây — area/volume/thickness nay được kiểm.
      assertCapGioiHanHopLe(
        gopCapGioiHanDonGian(
          layCapGioiHanTuDoi(hieuLucTruoc as unknown as Record<string, unknown>),
          input.action === "override" ? layCapGioiHanTuDoi(input.patchJson ?? null) : {},
        ),
      );

      // NEW-3 (review lượt 9, vòng 2) — `variantId` BẮT BUỘC (không còn suy từ
      // chuỗi `changeReason` tự do): hàm tự gắn tiền tố `[VARIANT:<id>]`.
      await db.recordVariantOverrideVersion(input.basePointDefId, input.variantId, hieuLucTruoc, {
        changedBy: ctx.user.id,
        changeReason: input.action === "override" ? "productVariant.setOverride" : "productVariant.setOverride(exclude)",
      });

      const id = await db.setVariantPointOverride({
        variantId: input.variantId,
        basePointDefId: input.basePointDefId,
        action: input.action,
        // 'exclude' stores no patch.
        patchJson: input.action === "override" ? input.patchJson : null,
      });

      // QĐ#10 — a change confined to a variant re-notifies ONLY that variant's
      // machines. Best-effort: the override is already persisted; a failed bump
      // just delays convergence to the next checkPointsVersion poll.
      try {
        await db.bumpVariantPointsConfigVersion(input.variantId);
      } catch (err) {
        console.warn("[doc55 PV3] bumpVariantPointsConfigVersion failed (setOverride)", err);
      }

      await auditQuiet({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "productVariant.setOverride",
        entityType: "product_variant",
        entityId: input.variantId,
        entityName: variant.code,
        details: { basePointDefId: input.basePointDefId, action: input.action },
        status: "success",
      });
      return { id };
    }),

  // ── remove a point override (variant re-inherits the base point) ──
  removeOverride: protectedProcedure
    .use(requirePermission("settings_measurement_points", "canEdit"))
    .input(z.object({
      variantId: z.number().int().positive(),
      basePointDefId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertVariantTableAvailable();

      const variant = await db.getVariantById(input.variantId);
      if (!variant) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productVariant" }, "Không tìm thấy biến thể");
      }

      // ★★★ NEW-4 (review lượt 9, vòng 2, BG-125) — CÙNG cửa/version như `setOverride`:
      // TRƯỚC bản vá này, gỡ một override (số HOẶC `exclude`) đi thẳng qua — 0 gate,
      // 0 version, y hệt lỗ mà I-3 đã vá cho `setOverride`. Gỡ MỘT `exclude` trên biến
      // thể LIVE hoàn tác chính lượt loại-điểm-khỏi-cổng — cùng mức nghiêm trọng cần
      // duyệt như tạo ra nó. Snapshot ghi lại hiệu lực TRƯỚC lượt gỡ (base + override
      // sắp mất, cùng `apDungVariantPatch`) — để lại đúng trạng thái đã mất.
      const basePoint = await db.getMeasurementPointDefById(input.basePointDefId);
      if (!basePoint) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "measurementPoint" }, "Không tìm thấy điểm đo gốc");
      }
      await assertThresholdEditAllowed(input.basePointDefId);

      const overridesHienCo = await db.getVariantOverrides(input.variantId);
      const ovHienCo = overridesHienCo.find((o) => o.basePointDefId === input.basePointDefId);
      const hieuLucTruoc = db.apDungVariantPatch(
        basePoint as unknown as Record<string, unknown>,
        ovHienCo?.action === "override" ? ovHienCo.patchJson : null,
      );
      // NEW-4 (đường ghi giới hạn thứ BẢY/census, `limitRangeGateCensus`) — gỡ override
      // không mang patch số nào ⇒ merge với `{}` (không đổi gì), cùng lý do đã ghi ở `setOverride`.
      // NEW-1 — `layCapGioiHanTuDoi` rút CẢ NĂM cặp, không chỉ hai cặp hard-code.
      assertCapGioiHanHopLe(
        gopCapGioiHanDonGian(layCapGioiHanTuDoi(hieuLucTruoc as unknown as Record<string, unknown>), {}),
      );
      await db.recordVariantOverrideVersion(input.basePointDefId, input.variantId, hieuLucTruoc, {
        changedBy: ctx.user.id,
        changeReason: "productVariant.removeOverride",
      });

      await db.removeVariantOverride(input.variantId, input.basePointDefId);

      try {
        await db.bumpVariantPointsConfigVersion(input.variantId);
      } catch (err) {
        console.warn("[doc55 PV3] bumpVariantPointsConfigVersion failed (removeOverride)", err);
      }

      await auditQuiet({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "productVariant.removeOverride",
        entityType: "product_variant",
        entityId: input.variantId,
        entityName: variant.code,
        details: { basePointDefId: input.basePointDefId },
        status: "success",
      });
      return { success: true };
    }),
});
