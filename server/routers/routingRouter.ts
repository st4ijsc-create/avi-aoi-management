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
import { appError } from "../_core/appError";
import { moduleProcedure, router } from "../_core/trpc";
// Doc 38 Đợt Q — license-gate this router behind MOD_PRODUCTION (moduleGate = pass-through
// until the deployment's SKU is configured — no-brick). Shadows `protectedProcedure`.
const protectedProcedure = moduleProcedure("MOD_PRODUCTION");
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
import { getProductModelByCode } from "../db/product";

function toTrpc(err: unknown): never {
  if (err instanceof RoutingError) {
    const code =
      err.code === "NOT_FOUND" ? "NOT_FOUND" :
      err.code === "CONFLICT" ? "CONFLICT" :
      err.code === "DB" ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST";
    throw appError(code, "OPERATION_FAILED", { operation: "manageRouting" }, err.message);
  }
  throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "manageRouting" }, (err as any)?.message ?? "Routing error");
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
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "routing" }, `Routing ${input.id} not found`);
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

  /**
   * Doc 54 §11 P0.5 — bulk-import routings from a FLAT CSV/array (one row per
   * step). Gated on the SAME permission as create (production_orders.canCreate) —
   * NOT adminProcedure (mirrors doc-54 P0.3). Rows are grouped by
   * (productCode, routingCode) into one routing header each; productCode resolves
   * to productModelId (unknown product → that group fails, not the batch).
   * Idempotent: an existing header of that code has its steps REPLACED (updated);
   * a new code is CREATED with its steps (inserted). Counts are at the ROUTING
   * level. Returns {inserted, updated, failed, errors[]}.
   */
  importRouting: protectedProcedure
    .use(canCreate)
    .input(z.object({
      rows: z.array(z.object({
        productCode: z.string().trim().min(1).max(100),
        routingCode: z.string().trim().max(64).optional(),
        routingName: z.string().max(255).optional(),
        stepSeq: z.number().int().min(1),
        operationCode: z.string().trim().min(1).max(64),
        stationCode: z.string().trim().max(128).optional(),
        standardTimeSec: z.number().int().min(0).optional(),
        description: z.string().max(4000).optional(),
      })).min(1).max(10000),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = { inserted: 0, updated: 0, failed: 0, errors: [] as string[] };
      // Group flat rows by (productCode, routingCode).
      type Group = {
        productCode: string;
        routingCode: string;
        routingName?: string;
        rows: typeof input.rows;
      };
      const groups = new Map<string, Group>();
      for (const row of input.rows) {
        const productCode = row.productCode.trim();
        const routingCode = (row.routingCode?.trim() || `${productCode}-IMPORT`);
        const key = `${productCode}::${routingCode}`;
        let g = groups.get(key);
        if (!g) {
          g = { productCode, routingCode, routingName: row.routingName, rows: [] };
          groups.set(key, g);
        }
        g.rows.push(row);
      }

      for (const g of groups.values()) {
        try {
          const product = await getProductModelByCode(g.productCode);
          if (!product) throw new Error(`Không tìm thấy sản phẩm "${g.productCode}"`);
          const seen = new Set<number>();
          const steps = g.rows
            .slice()
            .sort((a, b) => a.stepSeq - b.stepSeq)
            .map((r) => {
              if (seen.has(r.stepSeq)) {
                throw new Error(`Trùng bước ${r.stepSeq} trong routing ${g.routingCode}`);
              }
              seen.add(r.stepSeq);
              return {
                stepNo: r.stepSeq,
                operationCode: r.operationCode.trim(),
                stationOrMachineType: r.stationCode?.trim() || null,
                standardTimeSec: r.standardTimeSec ?? null,
                description: r.description ?? null,
              };
            });
          const list = await listRoutings({ productModelId: product.id, limit: 500 });
          const existing = list.find((r) => r.code === g.routingCode);
          if (existing) {
            await replaceSteps(existing.id, steps);
            result.updated++;
          } else {
            await createRouting({
              productModelId: product.id,
              code: g.routingCode,
              name: g.routingName ?? null,
              steps,
              createdBy: ctx.user.id,
            });
            result.inserted++;
          }
        } catch (err) {
          result.failed++;
          result.errors.push(`${g.productCode}/${g.routingCode}: ${err instanceof Error ? err.message : "lỗi import"}`);
        }
      }
      return result;
    }),
});
