/**
 * Engineering Change (ECN / ECO) router — doc 35 Wave W4-D, task 1.
 *
 *   • create      — any authenticated user may DRAFT an engineering change.
 *   • list/getById/getItems — read.
 *   • transition  — submit / review / approve / reject / implement / close.
 *                   Decision-gated (admin / supervisor / quality / engineering
 *                   role) with SoD (requester ≠ approver) enforced inside
 *                   ecnService.transitionEcn.
 *
 * The change-type set (product / bom / recipe / program / process / document)
 * and lifecycle (draft → submitted → in_review → approved/rejected →
 * implemented → closed) live in drizzle/schema/ecn.ts.
 *
 * No feature flag is required — this is an RBAC-gated maker-checker workflow,
 * exactly like the threshold-approval queue.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, roleProcedure, router } from "../_core/trpc";
import {
  createEcn,
  getEcnById,
  getEcnItems,
  listEcn,
  transitionEcn,
  EcnError,
} from "../services/ecnService";
import { ECN_CHANGE_TYPES, ECN_ITEM_ACTIONS, ECN_STATUSES } from "../../drizzle/schema/ecn";

// Engineering-change decisions are made by quality / engineering leadership.
// (2FA is enforced by roleProcedure's require2FA for privileged roles.)
const ecnDecisionProcedure = roleProcedure("admin", "supervisor", "quality_inspector", "engineer");

function toTrpc(err: unknown): never {
  if (err instanceof EcnError) {
    const code =
      err.code === "NOT_FOUND" ? "NOT_FOUND" :
      err.code === "SOD" ? "FORBIDDEN" :
      err.code === "DB" ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST";
    throw new TRPCError({ code, message: err.message });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (err as any)?.message ?? "ECN error" });
}

const impactSummarySchema = z.object({
  affectedProducts: z.array(z.union([z.number(), z.string()])).optional(),
  affectedPrograms: z.array(z.union([z.number(), z.string()])).optional(),
  affectedLines: z.array(z.union([z.number(), z.string()])).optional(),
  notes: z.string().max(4000).optional(),
}).passthrough();

const itemSchema = z.object({
  entityType: z.string().max(32),
  entityRef: z.number().int().positive().optional(),
  entityCode: z.string().max(128).optional(),
  action: z.enum(ECN_ITEM_ACTIONS).optional(),
  description: z.string().max(4000).optional(),
  note: z.string().max(4000).optional(),
});

export const ecnRouter = router({
  create: protectedProcedure
    .input(z.object({
      title: z.string().min(1).max(256),
      changeType: z.enum(ECN_CHANGE_TYPES),
      ecnKey: z.string().max(64).optional(),
      productModelId: z.number().int().positive().optional(),
      bomId: z.number().int().positive().optional(),
      recipeId: z.number().int().positive().optional(),
      programId: z.number().int().positive().optional(),
      processId: z.number().int().positive().optional(),
      targetDescription: z.string().max(4000).optional(),
      reason: z.string().max(4000).optional(),
      impactSummary: impactSummarySchema.optional(),
      effectivityDate: z.union([z.string(), z.date()]).optional(),
      note: z.string().max(4000).optional(),
      items: z.array(itemSchema).max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await createEcn({ ...input, requestedBy: ctx.user.id });
      } catch (err) {
        toTrpc(err);
      }
    }),

  list: protectedProcedure
    .input(z.object({
      status: z.enum(ECN_STATUSES).optional(),
      changeType: z.enum(ECN_CHANGE_TYPES).optional(),
      productModelId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => listEcn(input ?? {})),

  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const row = await getEcnById(input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `ECN ${input.id} not found` });
      return row;
    }),

  getItems: protectedProcedure
    .input(z.object({ ecnId: z.number().int().positive() }))
    .query(async ({ input }) => getEcnItems(input.ecnId)),

  // Decision-gated lifecycle advance. SoD (requester ≠ approver) checked inside
  // transitionEcn. `submit` is available to the same gate for simplicity; the
  // legal-transition table is the real guard on what each status permits.
  transition: ecnDecisionProcedure
    .input(z.object({
      id: z.number().int().positive(),
      action: z.enum(["submit", "review", "approve", "reject", "implement", "close"]),
      comment: z.string().max(4000).optional(),
      effectivityDate: z.union([z.string(), z.date()]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await transitionEcn({ ...input, actorId: ctx.user.id });
      } catch (err) {
        toTrpc(err);
      }
    }),
});
