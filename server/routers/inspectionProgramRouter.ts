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

/** Map service-layer Errors (state guards, SoD) onto proper tRPC codes. */
function rethrow(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("Segregation of duties")) {
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
  if (message.includes("not found")) {
    throw new TRPCError({ code: "NOT_FOUND", message });
  }
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

export const inspectionProgramRouter = router({
  /** All releases of a product, newest version first (actor names resolved). */
  list: protectedProcedure
    .use(requirePermission("settings_products", "canView"))
    .input(z.object({ productModelId: z.number().int().positive() }))
    .query(async ({ input }) => listReleases(input.productModelId)),

  get: protectedProcedure
    .use(requirePermission("settings_products", "canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const row = await getReleaseById(input.id);
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
    .query(async ({ input }) =>
      getActiveRelease({ productModelId: input.productModelId, machineId: input.machineId ?? null }),
    ),

  /** Structural field-level diff between two releases of the same product. */
  compare: protectedProcedure
    .use(requirePermission("settings_products", "canView"))
    .input(z.object({
      aId: z.number().int().positive(),
      bId: z.number().int().positive(),
    }))
    .query(async ({ input }) => {
      try {
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
        return await releaseProgram({ releaseId: input.releaseId, releasedBy: ctx.user.id });
      } catch (err) {
        rethrow(err);
      }
    }),
});
