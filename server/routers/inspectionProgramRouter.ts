/**
 * W3-C (doc 27 §2 M9) — Inspection-program release workflow router.
 *
 * Thin wrapper over server/services/inspectionProgramService.ts (see its header
 * for the full workflow/state machine). Pure catalog/ledger mutations — nothing
 * here pushes anything to a machine.
 *
 * RBAC (mirrors the page this surfaces on — /products uses module
 * 'settings_products' — plus quality sign-off roles for decisions):
 *   list/get/getActive/compare → settings_products canView
 *   createDraft                → settings_products canCreate
 *   submit                     → settings_products canEdit
 *   approve/reject/release     → qualityProcedure (admin/supervisor/
 *                                quality_inspector + 2FA) — the sign-off tier.
 *   SoD (creator ≠ approver) is additionally enforced in the service layer.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { protectedProcedure, qualityProcedure, router } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import {
  approveRelease,
  compareReleases,
  createRelease,
  getActiveRelease,
  getReleaseById,
  listReleases,
  rejectRelease,
  releaseProgram,
  submitForApproval,
} from "../services/inspectionProgramService";
import { idsMayTrongPhamVi, mayTrongPhamVi } from "./_adapterPhamVi";

/**
 * phạm vi người dùng (L3 2026-10-25) — QUYẾT CỦA CHỦ DỰ ÁN (dieu-phoi chuyển 2026-10-25): bản phát hành chương trình kiểm tra GẮN MÁY (machineId ≠ null) ⇒ theo phạm vi nhà máy của máy đó (ngoài phạm vi ≡ không tồn tại);
 * bản cấp SẢN PHẨM (machineId NULL, là phương án dự phòng cho MỌI máy mọi nhà máy) ⇒ ĐỌC được với mọi người có quyền, nhưng tạo/gửi duyệt/duyệt/từ chối/phát hành CHỈ người phạm vi toàn quyền
 * (phát hành bản sản phẩm-cấp đổi chương trình của máy nhà máy khác).
 */
const khongThayBan = (id: number) => appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "programRelease" }, `Program release #${id} not found`);
const tuChoiSanPhamCap = () =>
  appError("FORBIDDEN", "PERMISSION_DENIED", { action: "manageProductWideProgramRelease" }, "Bản chương trình kiểm tra cấp sản phẩm áp cho mọi nhà máy — chỉ người có phạm vi toàn quyền được tạo/duyệt/phát hành.");
/** bản (đã tồn tại) thấy được: cấp sản phẩm ⇒ ai cũng đọc; gắn máy ⇒ máy trong phạm vi. */
const banThay = (idsMay: number[] | null, r: { machineId: number | null }): boolean => idsMay === null || r.machineId == null || idsMay.includes(r.machineId);
/** ghi lên bản đã có: ngoài phạm vi ⇒ như không tồn tại; cấp sản phẩm mà người gọi hẹp ⇒ FORBIDDEN. Bản không tồn tại ⇒ để dịch vụ ném như cũ. */
async function chanGhiBan(ctx: unknown, releaseId: number): Promise<void> {
  const idsMay = await idsMayTrongPhamVi(ctx as never);
  if (idsMay === null) return;
  const r = await getReleaseById(releaseId);
  if (!r) return;
  if (r.machineId == null) throw tuChoiSanPhamCap();
  if (!idsMay.includes(r.machineId)) throw khongThayBan(releaseId);
}

/** Map service-layer Errors (state guards, SoD) onto proper tRPC codes. */
function rethrow(err: unknown): never {
  if (err instanceof TRPCError) throw err; // lỗi đã có mã (kể cả cổng phạm vi L3) đi qua NGUYÊN VẸN
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("Segregation of duties")) {
    throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "selfApproveProgramRelease" }, message);
  }
  // Review cuối, ca I-A #10: inspectionProgramService ném CẢ `Product model #N not
  // found` (createRelease — thiếu SẢN PHẨM) LẪN `Program release #N not found`
  // (approve/reject/release/compare — thiếu BẢN PHÁT HÀNH). Regex "not found" trước
  // đây gộp cả hai vào entity:"programRelease" — SAI HẲN thực thể khi thứ thiếu là mã
  // sản phẩm. Phân biệt theo nội dung message trước khi gán entity.
  if (message.includes("Product model") && message.includes("not found")) {
    throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productModel" }, message);
  }
  if (message.includes("not found")) {
    throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "programRelease" }, message);
  }
  throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "manageProgramRelease" }, message);
}

export const inspectionProgramRouter = router({
  /** All releases of a product, newest version first (actor names resolved). */
  list: protectedProcedure
    .use(requirePermission("settings_products", "canView"))
    .input(z.object({ productModelId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const idsMay = await idsMayTrongPhamVi(ctx);
      return (await listReleases(input.productModelId)).filter((r) => banThay(idsMay, r)); // phạm vi người dùng (L3 2026-10-25)
    }),

  get: protectedProcedure
    .use(requirePermission("settings_products", "canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const row = await getReleaseById(input.id);
      if (row && !banThay(await idsMayTrongPhamVi(ctx), row)) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "programRelease" }, "Bản phát hành không tồn tại."); // phạm vi người dùng (L3 2026-10-25)
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "programRelease" }, "Bản phát hành không tồn tại.");
      return row;
    }),

  /** Production-truth released program (exact machine scope, product fallback). */
  getActive: protectedProcedure
    .use(requirePermission("settings_products", "canView"))
    .input(z.object({
      productModelId: z.number().int().positive(),
      machineId: z.number().int().positive().nullable().optional(),
    }))
    .query(async ({ input, ctx }) => {
      // phạm vi người dùng (L3 2026-10-25): máy ngoài phạm vi ≡ máy không tồn tại ⇒ chỉ rơi về bản cấp sản phẩm
      const idsMay = await idsMayTrongPhamVi(ctx);
      const machineId = input.machineId != null && idsMay !== null && !idsMay.includes(input.machineId) ? null : input.machineId ?? null;
      return getActiveRelease({ productModelId: input.productModelId, machineId });
    }),

  /** Structural field-level diff between two releases of the same product. */
  compare: protectedProcedure
    .use(requirePermission("settings_products", "canView"))
    .input(z.object({
      aId: z.number().int().positive(),
      bId: z.number().int().positive(),
    }))
    .query(async ({ input, ctx }) => {
      try {
        const idsMay = await idsMayTrongPhamVi(ctx); // phạm vi người dùng (L3 2026-10-25)
        for (const id of [input.aId, input.bId]) {
          const r = await getReleaseById(id);
          if (r && !banThay(idsMay, r)) throw khongThayBan(id);
        }
        return await compareReleases(input.aId, input.bId);
      } catch (err) {
        rethrow(err);
      }
    }),

  /** Snapshot the current point-set into a new draft release (version = max+1). */
  createDraft: protectedProcedure
    .use(requirePermission("settings_products", "canCreate"))
    .input(z.object({
      productModelId: z.number().int().positive(),
      machineId: z.number().int().positive().nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        // phạm vi người dùng (L3 2026-10-25): gắn máy ⇒ máy phải trong phạm vi; cấp sản phẩm (machineId null) ⇒ chỉ phạm vi toàn quyền
        if (input.machineId != null) await mayTrongPhamVi(ctx, input.machineId);
        else if ((await idsMayTrongPhamVi(ctx)) !== null) throw tuChoiSanPhamCap();
        return await createRelease({
          productModelId: input.productModelId,
          machineId: input.machineId ?? null,
          notes: input.notes ?? null,
          createdBy: ctx.user.id,
        });
      } catch (err) {
        rethrow(err);
      }
    }),

  submit: protectedProcedure
    .use(requirePermission("settings_products", "canEdit"))
    .input(z.object({ releaseId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      try {
        await chanGhiBan(ctx, input.releaseId); // phạm vi người dùng (L3 2026-10-25)
        return await submitForApproval({ releaseId: input.releaseId, userId: ctx.user.id });
      } catch (err) {
        rethrow(err);
      }
    }),

  /** SoD: the service refuses approval by the release's own creator. */
  approve: qualityProcedure
    .input(z.object({
      releaseId: z.number().int().positive(),
      note: z.string().max(2000).nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        await chanGhiBan(ctx, input.releaseId); // phạm vi người dùng (L3 2026-10-25)
        return await approveRelease({ releaseId: input.releaseId, approvedBy: ctx.user.id, note: input.note ?? null });
      } catch (err) {
        rethrow(err);
      }
    }),

  reject: qualityProcedure
    .input(z.object({
      releaseId: z.number().int().positive(),
      reason: z.string().min(1).max(2000),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        await chanGhiBan(ctx, input.releaseId); // phạm vi người dùng (L3 2026-10-25)
        return await rejectRelease({ releaseId: input.releaseId, rejectedBy: ctx.user.id, reason: input.reason });
      } catch (err) {
        rethrow(err);
      }
    }),

  /** Atomic go-live: supersedes the previously released version of the scope. */
  release: qualityProcedure
    .input(z.object({ releaseId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      try {
        await chanGhiBan(ctx, input.releaseId); // phạm vi người dùng (L3 2026-10-25)
        return await releaseProgram({ releaseId: input.releaseId, releasedBy: ctx.user.id });
      } catch (err) {
        rethrow(err);
      }
    }),
});
