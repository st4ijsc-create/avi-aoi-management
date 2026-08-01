/**
 * NCR / MRB router (doc 35 Wave W4-B, task 2).
 *
 *   • create      — any authenticated user may RAISE an NCR.
 *   • list/getById — read.
 *   • transition  — review / disposition / close. Quality-gated (qualityProcedure)
 *                   with SoD (raiser ≠ decider) enforced in ncrService.transitionNcr.
 *
 * The disposition set (use_as_is / rework / scrap / return / rtv) and lifecycle
 * (open → in_review → dispositioned → closed) live in drizzle/schema/ncr.ts.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { moduleProcedure, qualityProcedure, router } from "../_core/trpc";
// Doc 38 Đợt Q — license-gate this router behind MOD_QUALITY (moduleGate = pass-through
// until the deployment's SKU is configured — no-brick). Shadows `protectedProcedure`.
const protectedProcedure = moduleProcedure("MOD_QUALITY");
import {
  createNcr,
  getNcrById,
  listNcr,
  transitionNcr,
  NcrError,
} from "../services/ncrService";
import { NCR_DISPOSITIONS, NCR_SOURCES, NCR_STATUSES } from "../../drizzle/schema/ncr";

function toTrpc(err: unknown): never {
  if (err instanceof NcrError) {
    const code =
      err.code === "NOT_FOUND" ? "NOT_FOUND" :
      err.code === "SOD" ? "FORBIDDEN" :
      err.code === "DB" ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST";
    throw new TRPCError({ code, message: err.message });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (err as any)?.message ?? "NCR error" });
}

export const ncrRouter = router({
  create: protectedProcedure
    .input(z.object({
      source: z.enum(NCR_SOURCES),
      ncrKey: z.string().max(64).optional(),
      linkedInspectionId: z.number().int().positive().optional(),
      lotNumber: z.string().max(128).optional(),
      serialNumber: z.string().max(128).optional(),
      productModelId: z.number().int().positive().optional(),
      defectSummary: z.string().max(4000).optional(),
      quarantineLocationId: z.number().int().positive().optional(),
      reason: z.string().max(4000).optional(),
      note: z.string().max(4000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await createNcr({ ...input, raisedBy: ctx.user.id });
      } catch (err) {
        toTrpc(err);
      }
    }),

  list: protectedProcedure
    .input(z.object({
      status: z.enum(NCR_STATUSES).optional(),
      source: z.enum(NCR_SOURCES).optional(),
      lotNumber: z.string().max(128).optional(),
      serialNumber: z.string().max(128).optional(),
      productModelId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => listNcr(input ?? {})),

  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const row = await getNcrById(input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `NCR ${input.id} not found` });
      return row;
    }),

  // Quality-gated lifecycle advance. SoD checked inside transitionNcr.
  transition: qualityProcedure
    .input(z.object({
      id: z.number().int().positive(),
      action: z.enum(["review", "disposition", "close"]),
      disposition: z.enum(NCR_DISPOSITIONS).optional(),
      quarantineLocationId: z.number().int().positive().optional(),
      note: z.string().max(4000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await transitionNcr({ ...input, actorId: ctx.user.id });
      } catch (err) {
        toTrpc(err);
      }
    }),
});
