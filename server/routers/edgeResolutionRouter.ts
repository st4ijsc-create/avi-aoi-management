/**
 * doc 81 Đợt 10 task F2 — rulings R-10-af / R-10-ax: the person-facing side of two fail-closed states the đợt created.
 *
 *   edgeResolution.list          — pending STOPs (device_pending_stops: needsResolution / ownerCannotList / overdue /
 *                                  undeliverable …) and unresolved OT write intents, within the caller's factory scope.
 *                                  machine_control/canView.
 *   edgeResolution.resolveStop   — close a REFUSED / FAILED STOP with a resolution (A's guarded edge_stop_resolve).
 *   edgeResolution.resolveIntent — record "outcome unknown" for a crash-orphaned write intent (its RESULT row).
 * Both writes: admin / supervisor (+ 2FA, supervisorProcedure) AND machine_control/canEdit; a reason ≥ 3 chars; the caller's
 * factory scope (strict — unreadable ⇒ refused; out of scope ⇒ the same NOT_FOUND as a missing row); the audit row is written in
 * the same transaction as the change (no audit ⇒ no change). Neither sends anything to a device.
 */
import { z } from "zod";
import { router, protectedProcedure, supervisorProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { appError } from "../_core/appError";
import { listEdgeResolutionItems, resolveOrphanedIntent, resolvePendingStop, type FactoryScope, type ResolveResult } from "../services/edge/edgeResolutionService";

/** The caller's factory scope (null = unrestricted), STRICT: an unreadable scope refuses instead of widening. */
async function scopeOf(user: { id: number; role?: string | null }, operation: "listEdgeResolution" | "resolveEdgeStop" | "resolveWriteIntent"): Promise<FactoryScope> {
  const { resolveTenantFactoryScope } = await import("../db/reportAggregators");
  try {
    return (await resolveTenantFactoryScope({ userId: user.id, userRole: String(user.role ?? "") }, { strict: true })).factoryIds;
  } catch {
    throw appError("SERVICE_UNAVAILABLE", "OPERATION_FAILED", { operation, reason: "factoryScopeUnavailable" }, "the caller's factory scope could not be read — refused (fail-closed)");
  }
}

function fail(r: Extract<ResolveResult, { ok: false }>, operation: "resolveEdgeStop" | "resolveWriteIntent"): never {
  if (r.reason === "notFound") throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: operation === "resolveEdgeStop" ? "edgePendingStop" : "orphanedWriteIntent" }, r.detail);
  if (r.reason === "unavailable") throw appError("SERVICE_UNAVAILABLE", "OPERATION_FAILED", { operation, reason: "edgeControlUnavailable" }, r.detail);
  if (r.reason === "tooRecent") throw appError("PRECONDITION_FAILED", "OPERATION_FAILED", { operation, reason: "writeIntentTooRecent" }, r.detail);
  if (r.reason === "alreadyResolved") throw appError("CONFLICT", "OPERATION_FAILED", { operation, reason: "alreadyResolved" }, r.detail);
  throw appError("PRECONDITION_FAILED", "OPERATION_FAILED", { operation, reason: "stopNotResolvable" }, r.detail);
}

const actorOf = (ctx: { user: { id: number; name?: string | null }; req?: { ip?: string; headers?: Record<string, unknown> } }) => ({
  id: ctx.user.id,
  name: ctx.user.name ?? null,
  ip: ctx.req?.ip ?? null,
  userAgent: (ctx.req?.headers?.["user-agent"] as string | undefined) ?? null,
});

export const edgeResolutionRouter = router({
  list: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({ robotId: z.number().int().positive().optional(), adapterId: z.number().int().positive().optional() }).optional())
    .query(async ({ ctx, input }) => listEdgeResolutionItems(await scopeOf(ctx.user, "listEdgeResolution"), { robotId: input?.robotId, adapterId: input?.adapterId })),

  resolveStop: supervisorProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({ requestId: z.number().int().positive(), resolution: z.string().trim().min(3).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const r = await resolvePendingStop({ requestId: input.requestId, resolution: input.resolution, actor: actorOf(ctx), scope: await scopeOf(ctx.user, "resolveEdgeStop") });
      if (!r.ok) fail(r, "resolveEdgeStop");
      return r;
    }),

  resolveIntent: supervisorProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({ intentId: z.number().int().positive(), reason: z.string().trim().min(3).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const r = await resolveOrphanedIntent({ intentId: input.intentId, reason: input.reason, actor: actorOf(ctx), scope: await scopeOf(ctx.user, "resolveWriteIntent") });
      if (!r.ok) fail(r, "resolveWriteIntent");
      return r;
    }),
});
