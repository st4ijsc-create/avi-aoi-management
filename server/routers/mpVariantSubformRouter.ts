/**
 * P4.C G20 — Specialized measurement-point subform router.
 *
 * Mirrors inspectionVariantRouter (G16): per-`measurementTypeCode` Zod
 * validation of `extraFields` jsonb on `measurement_point_defs`.
 *
 *  - listTypes:  registered subform discriminators for UI dropdowns.
 *  - validate:   dry-run validate a payload for a given typeCode.
 *  - getExtra:   read current measurementTypeCode + extraFields for one MP.
 *  - setExtra:   replace extraFields (and optionally measurementTypeCode)
 *                for one MP, with strict validation when the typeCode is known.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import {
  listMpSubformTypes,
  validateExtraFields,
} from "../utils/mpVariantSubform";

export const mpVariantSubformRouter = router({
  listTypes: protectedProcedure.query(() => ({
    types: listMpSubformTypes(),
  })),

  validate: protectedProcedure
    .input(z.object({
      measurementTypeCode: z.string().max(100).nullable().optional(),
      payload: z.unknown(),
    }))
    .query(({ input }) => {
      return validateExtraFields(input.measurementTypeCode ?? null, input.payload);
    }),

  getExtra: protectedProcedure
    .input(z.object({ pointDefId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const mp = await (db as any).getMeasurementPointDefById?.(input.pointDefId);
      if (!mp) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "measurementPoint" }, "Measurement point not found");
      }
      return {
        pointDefId: mp.id,
        measurementTypeCode: (mp as any).measurementTypeCode ?? null,
        extraFields: (mp as any).extraFields ?? null,
      };
    }),

  setExtra: protectedProcedure
    .input(z.object({
      pointDefId: z.number().int().positive(),
      measurementTypeCode: z.string().max(100).nullable().optional(),
      payload: z.unknown(),
    }))
    .mutation(async ({ input }) => {
      const mp = await (db as any).getMeasurementPointDefById?.(input.pointDefId);
      if (!mp) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "measurementPoint" }, "Measurement point not found");
      }
      // Resolve the active typeCode: explicit input wins, else preserve existing.
      const code = input.measurementTypeCode === undefined
        ? ((mp as any).measurementTypeCode ?? null)
        : input.measurementTypeCode;
      const v = validateExtraFields(code, input.payload);
      if (!v.ok) {
        throw appError(
          "BAD_REQUEST",
          "INVALID_VALUE",
          { field: "extraFields" },
          `Invalid extraFields for ${code ?? "(no typeCode)"}: ` +
            v.errors.map((e) => `${e.path || "(root)"}: ${e.message}`).join("; "),
        );
      }
      const conn = await (db as any).getDb?.();
      if (!conn) {
        throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      }
      const { measurementPointDefs } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const set: any = {
        extraFields: v.data as any,
        updatedAt: new Date(),
      };
      if (input.measurementTypeCode !== undefined) {
        set.measurementTypeCode = input.measurementTypeCode;
      }
      await conn
        .update(measurementPointDefs)
        .set(set)
        .where(eq(measurementPointDefs.id, input.pointDefId));
      return {
        ok: true,
        pointDefId: input.pointDefId,
        measurementTypeCode: code,
        knownType: v.knownType,
      };
    }),
});
