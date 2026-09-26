/**
 * Engineering Change (ECN / ECO) router — doc 35 Wave W4-D, task 1.
 * doc 80 Đợt 0 Task 8 (RBAC-02, ECN-03, ECN-05) — permission-gated reads/create,
 * CAS transition, SoD extended to review.
 *
 *   • create      — `machine_control` canCreate required (was: any authenticated
 *                   user — RBAC-02).
 *   • list/getById/getItems — `machine_control` canView required (was: any
 *                   authenticated user — RBAC-02), mirrors the ECN page's own
 *                   client-side gate (doc 54 Đ2).
 *   • transition  — submit / review / approve / reject / implement / close.
 *                   Decision-gated (admin / supervisor / quality / engineering
 *                   role) with SoD (requester ≠ reviewer ≠ approver — ECN-05)
 *                   and a compare-and-swap on status (ECN-03) enforced inside
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
import { appError } from "../_core/appError";
import { requirePermission } from "../_core/accessControl";
import { moduleProcedure, roleProcedure, router } from "../_core/trpc";
// Doc 38 Đợt Q — license-gate this router behind MOD_ENGINEERING (moduleGate = pass-through
// until the deployment's SKU is configured — no-brick). Shadows `protectedProcedure`.
const protectedProcedure = moduleProcedure("MOD_ENGINEERING");
// doc 80 Đợt 0 Task 8 (RBAC-02) — before this task, create/list/getById/getItems sat on
// `protectedProcedure` ALONE: any authenticated user (license gate is a no-op until the
// SKU flag is on) could read or draft ECNs. Gate on `machine_control`, mirroring the ECN
// page's own client-side gate (doc 54 Đ2, EngineeringChanges.tsx) — canView for reads,
// canCreate for the mutation that creates a new change.
const ecnViewProcedure = protectedProcedure.use(requirePermission("machine_control", "canView"));
const ecnCreateProcedure = protectedProcedure.use(requirePermission("machine_control", "canCreate"));
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
      // doc 80 Đợt 0 Task 8 (ECN-03) — CAS UPDATE matched 0 rows: someone else
      // already moved the ECN's status. CONFLICT (409), not a generic BAD_REQUEST.
      err.code === "CONFLICT" ? "CONFLICT" :
      err.code === "DB" ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST";
    throw appError(code, "OPERATION_FAILED", { operation: "manageEcn" }, err.message);
  }
  throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "manageEcn" }, (err as any)?.message ?? "ECN error");
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
  create: ecnCreateProcedure
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

  list: ecnViewProcedure
    .input(z.object({
      status: z.enum(ECN_STATUSES).optional(),
      changeType: z.enum(ECN_CHANGE_TYPES).optional(),
      productModelId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => listEcn(input ?? {})),

  getById: ecnViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const row = await getEcnById(input.id);
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "ecn" }, `ECN ${input.id} not found`);
      return row;
    }),

  getItems: ecnViewProcedure
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
      // doc 80 Đợt 0 Task 8 (ECN-03) — status the CLIENT currently sees for this
      // ECN. Passed straight through to the service's compare-and-swap UPDATE
      // (`WHERE id=$1 AND status=$expectedStatus`); a stale/raced value ⇒
      // CONFLICT instead of silently overwriting a transition that already
      // happened. Optional for back-compat with not-yet-migrated callers.
      expectedStatus: z.enum(ECN_STATUSES).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await transitionEcn({ ...input, actorId: ctx.user.id });
      } catch (err) {
        toTrpc(err);
      }
    }),
});
