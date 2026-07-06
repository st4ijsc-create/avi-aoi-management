/**
 * Routing Master router (doc 35 Wave W4-E, task 3).
 *
 *   • list / getById / getActive — read (protected).
 *   • create / update / addStep / updateStep / deleteStep / replaceSteps — write,
 *     RBAC-gated on production_orders.canCreate / canEdit.
 *   • activate / archive / delete — lifecycle, RBAC-gated.
 *
 * The routing lifecycle (draft → active → archived), single-active-per-product
 * invariant and SoD-free CRUD live in server/services/routingService.ts. This is
 * the master ERP order-intake resolves operations against (erpIntake.ts TODO).
 *
 * NO feature flag — pure RBAC-gated master-data CRUD.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import {
  createRouting,
  listRoutings,
  getRoutingById,
  getActiveRouting,
  updateRouting,
  activateRouting,
  archiveRouting,
  deleteRouting,
  addStep,
  updateStep,
  deleteStep,
  replaceSteps,
  RoutingError,
} from "../services/routingService";
import { ROUTING_STATUSES } from "../../drizzle/schema/routing";

function toTrpc(err: unknown): never {
  if (err instanceof RoutingError) {
    const code =
      err.code === "NOT_FOUND" ? "NOT_FOUND" :
      err.code === "CONFLICT" ? "CONFLICT" :
      err.code === "DB" ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST";
    throw new TRPCError({ code, message: err.message });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (err as any)?.message ?? "Routing error" });
}

const stepInput = z.object({
  stepNo: z.number().int().min(1),
  operationCode: z.string().min(1).max(64),
  stationOrMachineType: z.string().max(128).optional(),
  standardTimeSec: z.number().int().min(0).optional(),
  description: z.string().max(4000).optional(),
});

const canCreate = requirePermission("production_orders", "canCreate");
const canEdit = requirePermission("production_orders", "canEdit");
const canDelete = requirePermission("production_orders", "canDelete");

export const routingRouter = router({
  list: protectedProcedure
    .input(z.object({
      productModelId: z.number().int().positive().optional(),
      status: z.enum(ROUTING_STATUSES).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => listRoutings(input ?? {})),

  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const row = await getRoutingById(input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Routing ${input.id} not found` });
      return row;
    }),

  /** The single active routing (+steps) for a product — ERP intake resolves ops here. */
  getActive: protectedProcedure
    .input(z.object({ productModelId: z.number().int().positive() }))
    .query(async ({ input }) => getActiveRouting(input.productModelId)),

  create: protectedProcedure
    .use(canCreate)
    .input(z.object({
      productModelId: z.number().int().positive(),
      code: z.string().min(1).max(64),
      version: z.number().int().min(1).optional(),
      name: z.string().max(255).optional(),
      description: z.string().max(4000).optional(),
      steps: z.array(stepInput).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await createRouting({ ...input, createdBy: ctx.user.id });
      } catch (err) {
        toTrpc(err);
      }
    }),

  update: protectedProcedure
    .use(canEdit)
    .input(z.object({
      id: z.number().int().positive(),
      code: z.string().min(1).max(64).optional(),
      version: z.number().int().min(1).optional(),
      name: z.string().max(255).nullable().optional(),
      description: z.string().max(4000).nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        return await updateRouting(input);
      } catch (err) {
        toTrpc(err);
      }
    }),

  activate: protectedProcedure
    .use(canEdit)
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      try {
        return await activateRouting(input.id);
      } catch (err) {
        toTrpc(err);
      }
    }),

  archive: protectedProcedure
    .use(canEdit)
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      try {
        return await archiveRouting(input.id);
      } catch (err) {
        toTrpc(err);
      }
    }),

  delete: protectedProcedure
    .use(canDelete)
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      try {
        return await deleteRouting(input.id);
      } catch (err) {
        toTrpc(err);
      }
    }),

  // ── Steps ──────────────────────────────────────────────────────────────────
  addStep: protectedProcedure
    .use(canEdit)
    .input(z.object({ routingId: z.number().int().positive() }).and(stepInput))
    .mutation(async ({ input }) => {
      try {
        return await addStep(input);
      } catch (err) {
        toTrpc(err);
      }
    }),

  updateStep: protectedProcedure
    .use(canEdit)
    .input(z.object({
      id: z.number().int().positive(),
      stepNo: z.number().int().min(1).optional(),
      operationCode: z.string().min(1).max(64).optional(),
      stationOrMachineType: z.string().max(128).nullable().optional(),
      standardTimeSec: z.number().int().min(0).nullable().optional(),
      description: z.string().max(4000).nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        return await updateStep(input);
      } catch (err) {
        toTrpc(err);
      }
    }),

  deleteStep: protectedProcedure
    .use(canEdit)
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      try {
        return await deleteStep(input.id);
      } catch (err) {
        toTrpc(err);
      }
    }),

  replaceSteps: protectedProcedure
    .use(canEdit)
    .input(z.object({
      routingId: z.number().int().positive(),
      steps: z.array(stepInput),
    }))
    .mutation(async ({ input }) => {
      try {
        return await replaceSteps(input.routingId, input.steps);
      } catch (err) {
        toTrpc(err);
      }
    }),
});
