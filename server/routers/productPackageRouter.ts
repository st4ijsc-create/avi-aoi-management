/**
 * Doc 31 Đợt C (PM3 / C.4) — Product package export / import endpoints.
 *
 * `export` returns the portable JSON bundle for a product (the client offers it
 * as a download); `import` recreates it as a NEW product model. Both are admin-
 * gated to match product-model management. Export is a mutation purely so the
 * client can trigger it imperatively on a button click (it is side-effect free).
 */
import { z } from "zod";
import { router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import * as db from "../db";
import {
  exportProductPackage,
  importProductPackage,
} from "../services/productPackageService";

export const productPackageRouter = router({
  /** Build the portable JSON bundle for a product model. */
  exportPackage: adminProcedure
    .input(z.object({ productModelId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      try {
        return await exportProductPackage(input.productModelId);
      } catch (err: any) {
        throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "exportProductPackage" }, err?.message ?? "Export failed");
      }
    }),

  /** Recreate a product from a package as a NEW product model. */
  importPackage: adminProcedure
    .input(z.object({
      package: z.unknown(),
      newCode: z.string().min(1).max(100).regex(/^[A-Za-z0-9_\-]+$/, "Code may only contain letters, digits, underscore, dash"),
      newName: z.string().min(1).max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      let result;
      try {
        result = await importProductPackage(input.package, {
          newCode: input.newCode,
          newName: input.newName,
          createdBy: ctx.user.id,
        });
      } catch (err: any) {
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "importProductPackage" }, err?.message ?? "Import failed");
      }
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "product.importPackage",
          entityType: "product",
          entityId: result.productModelId,
          entityName: result.code,
          details: { counts: result.counts, warnings: result.warnings },
          status: "success",
        });
      } catch (e) {
        console.warn("audit log failed (product.importPackage)", e);
      }
      return result;
    }),
});
