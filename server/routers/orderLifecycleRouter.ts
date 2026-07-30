/**
 * W3-A3 (doc 44 G3.6/G3.7) — ORDER LIFECYCLE tRPC router (key "orderLifecycle")
 * — the UI-facing mirror of api/v1/ordersLifecycle (SYNAPSE LDS-L3 §13.1).
 *
 * NOT SELF-REGISTERED: routers.ts is owned by another batch — the wiring
 * snippet (`orderLifecycle: orderLifecycleRouter`) ships in the batch report.
 *
 * RBAC: reuses the existing "production_orders" module permissions — reads →
 * canView, lifecycle commands → canEdit (same module the orders UI already
 * gates on; no new permission ghost). All procedures are additionally gated by
 * ORDER_LIFECYCLE_ENABLED (default OFF → PRECONDITION_FAILED with a clear
 * message, never a silent no-op). All state changes route through
 * orderLifecycleService (policy seam + transactional audit) — this layer only
 * maps errors.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import {
  orderLifecycleEnabled,
  OrderLifecycleError,
  listOrders,
  getOrderDetail,
  traceOrder,
  allocateOrder,
  holdOrder,
  resumeOrder,
  cancelOrder,
} from "../services/orders/orderLifecycleService";

const canView = requirePermission("production_orders", "canView");
const canEdit = requirePermission("production_orders", "canEdit");

function ensureEnabled(): void {
  if (!orderLifecycleEnabled()) {
    throw appError(
      "PRECONDITION_FAILED",
      "FEATURE_DISABLED",
      { feature: "orderLifecycle" },
      "Order lifecycle is disabled (ORDER_LIFECYCLE_ENABLED, default OFF; requires migration 0258).",
    );
  }
}

/** Map the typed service error → tRPC error codes. */
function toTrpc(err: unknown): never {
  if (err instanceof OrderLifecycleError) {
    const code =
      err.httpStatus === 404 ? "NOT_FOUND" :
      err.httpStatus === 409 ? "CONFLICT" :
      err.httpStatus === 403 ? "FORBIDDEN" :
      err.httpStatus === 503 ? "PRECONDITION_FAILED" :
      err.httpStatus >= 500 ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST";
    throw appError(code, "OPERATION_FAILED", { operation: "manageOrderLifecycle" }, err.message);
  }
  if (err instanceof TRPCError) throw err;
  throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "manageOrderLifecycle" }, (err as Error)?.message ?? "Order lifecycle error");
}

const lifecycleEnum = z.enum(["created", "allocated", "running", "held", "compensating", "done", "failed", "rejected"]);

export const orderLifecycleRouter = router({
  /** List orders with effective lifecycle + allocation (projection-aware filter). */
  list: protectedProcedure
    .use(canView)
    .input(
      z.object({
        lifecycle: lifecycleEnum.optional(),
        lineId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      }).optional(),
    )
    .query(async ({ input }) => {
      ensureEnabled();
      try {
        return await listOrders(input ?? {});
      } catch (err) {
        toTrpc(err);
      }
    }),

  /** Order detail + full transition history. */
  detail: protectedProcedure
    .use(canView)
    .input(z.object({ orderId: z.number().int().positive() }))
    .query(async ({ input }) => {
      ensureEnabled();
      try {
        const detail = await getOrderDetail(input.orderId);
        if (!detail) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productionOrder" }, `Order ${input.orderId} not found`);
        return detail;
      } catch (err) {
        toTrpc(err);
      }
    }),

  /** Trace: transitions + genealogy references (honest-empty). */
  trace: protectedProcedure
    .use(canView)
    .input(z.object({ orderId: z.number().int().positive() }))
    .query(async ({ input }) => {
      ensureEnabled();
      try {
        const trace = await traceOrder(input.orderId);
        if (!trace) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productionOrder" }, `Order ${input.orderId} not found`);
        return trace;
      } catch (err) {
        toTrpc(err);
      }
    }),

  /** §9.1 allocation — explicit line (capacity-validated) or least-loaded auto-select. */
  allocate: protectedProcedure
    .use(canEdit)
    .input(
      z.object({
        orderId: z.number().int().positive(),
        lineId: z.number().int().positive().optional(),
        reason: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      ensureEnabled();
      try {
        return await allocateOrder(input.orderId, {
          lineId: input.lineId,
          reason: input.reason,
          actor: `user:${ctx.user.id}`,
        });
      } catch (err) {
        toTrpc(err);
      }
    }),

  /** running → held. */
  hold: protectedProcedure
    .use(canEdit)
    .input(z.object({ orderId: z.number().int().positive(), reason: z.string().max(1000).optional() }))
    .mutation(async ({ ctx, input }) => {
      ensureEnabled();
      try {
        return await holdOrder(input.orderId, { reason: input.reason, actor: `user:${ctx.user.id}` });
      } catch (err) {
        toTrpc(err);
      }
    }),

  /** held → running. */
  resume: protectedProcedure
    .use(canEdit)
    .input(z.object({ orderId: z.number().int().positive(), reason: z.string().max(1000).optional() }))
    .mutation(async ({ ctx, input }) => {
      ensureEnabled();
      try {
        return await resumeOrder(input.orderId, { reason: input.reason, actor: `user:${ctx.user.id}` });
      } catch (err) {
        toTrpc(err);
      }
    }),

  /** created/allocated → rejected · running/held → compensating → failed. */
  cancel: protectedProcedure
    .use(canEdit)
    .input(z.object({ orderId: z.number().int().positive(), reason: z.string().max(1000).optional() }))
    .mutation(async ({ ctx, input }) => {
      ensureEnabled();
      try {
        return await cancelOrder(input.orderId, input.reason, { actor: `user:${ctx.user.id}` });
      } catch (err) {
        toTrpc(err);
      }
    }),
});
