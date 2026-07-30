/**
 * P4.C G16 — Specialized inspection-type subforms.
 *
 * Exposes:
 *  - listTypes:           known variant discriminators for UI dropdowns.
 *  - validate:            dry-run validate a payload against a type.
 *  - setVariant:          attach / replace variantPayload + inspectionType
 *                         on an existing product inspection.
 *  - getVariant:          fetch the stored type + payload for one inspection.
 *
 * The actual schemas live in server/utils/inspectionVariant.ts so they can be
 * reused by other routers (e.g. inspection create/update) without a circular
 * import via this router.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import {
  INSPECTION_TYPES,
  validatePayload,
  listInspectionTypes,
} from "../utils/inspectionVariant";

const inspectionTypeInput = z.enum(INSPECTION_TYPES);

export const inspectionVariantRouter = router({
  listTypes: protectedProcedure.query(() => ({
    types: listInspectionTypes(),
  })),

  validate: protectedProcedure
    .input(z.object({
      inspectionType: inspectionTypeInput,
      payload: z.unknown(),
    }))
    .query(({ input }) => {
      const r = validatePayload(input.inspectionType, input.payload);
      return r;
    }),

  getVariant: protectedProcedure
    .input(z.object({ inspectionId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const insp = await (db as any).getProductInspectionById?.(input.inspectionId);
      if (!insp) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Inspection not found" });
      }
      return {
        inspectionId: insp.id,
        inspectionType: (insp as any).inspectionType ?? null,
        variantPayload: (insp as any).variantPayload ?? null,
      };
    }),

  setVariant: protectedProcedure
    .input(z.object({
      inspectionId: z.number().int().positive(),
      inspectionType: inspectionTypeInput,
      payload: z.unknown(),
    }))
    .mutation(async ({ input }) => {
      const insp = await (db as any).getProductInspectionById?.(input.inspectionId);
      if (!insp) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Inspection not found" });
      }
      const v = validatePayload(input.inspectionType, input.payload);
      if (!v.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid ${input.inspectionType} payload: ` +
            (v.errors ?? []).map((e) => `${e.path || "(root)"}: ${e.message}`).join("; "),
        });
      }
      // Update via raw connection — keeps this router decoupled from a
      // dedicated db helper. If/when an updateProductInspection() helper
      // exists, swap to it.
      const conn = await (db as any).getDb?.();
      if (!conn) {
        throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      }
      // Use sql tag via drizzle through the schema export to stay typed.
      const { productInspections } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await conn
        .update(productInspections)
        .set({
          inspectionType: input.inspectionType,
          variantPayload: v.data as any,
          updatedAt: new Date(),
        } as any)
        .where(eq(productInspections.id, input.inspectionId));
      return { ok: true, inspectionId: input.inspectionId, inspectionType: input.inspectionType };
    }),
});
