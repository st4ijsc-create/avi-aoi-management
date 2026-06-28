/**
 * Phase E2 — Factory Control Plane: ORCHESTRATION router (Factory Orchestration Engine).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * tRPC surface over the build-own FOE (server/services/orchestration/foe/foeEngine.ts).
 * Lets operators list/deploy workflows + start/resume/abort runs from the platform UI.
 *
 * SAFETY (ABSOLUTE): every control a workflow issues routes through the E0
 * equipmentRegistry → existing HITL/dry-run dispatcher. This router opens NO device
 * path. Flag-gated by FOE_ENABLED (off → the engine returns a `disabled` result).
 *
 * RBAC (module-level):
 *   • write ops (deploy/start/resume/abort) → machine_control / canCreate.
 *   • read ops  (list/get) → machine_monitoring / canView.
 * The session user (ctx.user) is the source of truth — never the request body.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import { orchestrationWorkflows, orchestrationRuns } from "../../drizzle/schema";
import {
  deployWorkflow,
  startRun,
  resumeRun,
  abortRun,
  getRun,
  foeEnabled,
  type FoeUser,
} from "../services/orchestration/foe/foeEngine";
import type { WorkflowDefinition } from "../services/orchestration/foe/workflowModel";

function toFoeUser(user: { id: number; role: string; name?: string | null }): FoeUser {
  return { id: user.id, role: String(user.role), name: user.name ?? null };
}

async function db() {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not connected" });
  return d;
}

export const orchestrationRouter = router({
  /** Whether the FOE flag is enabled (UI gating hint). */
  status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({ enabled: foeEnabled() })),

  /** List deployed workflows (newest first). */
  listWorkflows: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional())
    .query(async ({ input }) => {
      const d = await db();
      return d
        .select()
        .from(orchestrationWorkflows)
        .orderBy(desc(orchestrationWorkflows.updatedAt))
        .limit(input?.limit ?? 100);
    }),

  /** Get one workflow by id (with its full definition). */
  getWorkflow: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const d = await db();
      const [row] = await d
        .select()
        .from(orchestrationWorkflows)
        .where(eq(orchestrationWorkflows.id, input.id))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Workflow ${input.id} not found` });
      return row;
    }),

  /** Deploy (validate + persist) a workflow definition. Flag-gated. */
  deployWorkflow: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ definition: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ input, ctx }) => {
      const result = await deployWorkflow(
        input.definition as unknown as WorkflowDefinition,
        toFoeUser(ctx.user),
      );
      return result;
    }),

  /** List runs (optionally filtered by workflowId), newest first. */
  listRuns: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z
        .object({
          workflowId: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(500).default(100),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const d = await db();
      return d
        .select()
        .from(orchestrationRuns)
        .where(input?.workflowId != null ? eq(orchestrationRuns.workflowId, input.workflowId) : undefined)
        .orderBy(desc(orchestrationRuns.createdAt))
        .limit(input?.limit ?? 100);
    }),

  /** Get a run + its per-step audit. */
  getRun: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ runId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const view = await getRun(input.runId);
      if (!view) throw new TRPCError({ code: "NOT_FOUND", message: `Run ${input.runId} not found` });
      return view;
    }),

  /** Start a run of a deployed workflow (by ref). Flag-gated. */
  startRun: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        workflowRef: z.string().min(1).max(128),
        params: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return startRun(input.workflowRef, input.params, toFoeUser(ctx.user));
    }),

  /** Resume a run paused at a hitl_gate (approve/reject). Flag-gated. */
  resumeRun: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        runId: z.number().int().positive(),
        approved: z.boolean(),
        note: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return resumeRun(input.runId, { approved: input.approved, note: input.note }, toFoeUser(ctx.user));
    }),

  /** Abort an in-flight run (terminal). */
  abortRun: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ runId: z.number().int().positive(), reason: z.string().max(1000).optional() }))
    .mutation(async ({ input, ctx }) => {
      return abortRun(input.runId, toFoeUser(ctx.user), input.reason);
    }),
});
