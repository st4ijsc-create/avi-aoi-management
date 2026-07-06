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
import { desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, moduleProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
// Doc 37 P0-3 — gate the Orchestration Studio surface behind MOD_ENGINEERING
// (flag LICENSE_MODULE_GATE_ENABLED, default OFF → pass-through). Shadows
// `protectedProcedure`; per-action RBAC + FOE_ENABLED guards are unchanged.
const protectedProcedure = moduleProcedure("MOD_ENGINEERING");
import { orchestrationWorkflows, orchestrationWorkflowVersions, orchestrationRuns, orchestrationRunSteps, machines } from "../../drizzle/schema";
import {
  deployWorkflow,
  rollbackWorkflow,
  startRun,
  resumeRun,
  abortRun,
  getRun,
  foeEnabled,
  type FoeUser,
} from "../services/orchestration/foe/foeEngine";
import {
  simulateWorkflow,
  type SimulationResult,
} from "../services/orchestration/foe/foeSimulator";
import { validateWorkflow, type WorkflowDefinition } from "../services/orchestration/foe/workflowModel";

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

  /**
   * W3-11 — list the VERSION snapshots of a workflow (newest first). Read-only.
   * Backs the version diff + rollback panel in the Studio.
   */
  listVersions: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ workflowId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const d = await db();
      const rows = await d
        .select()
        .from(orchestrationWorkflowVersions)
        .where(eq(orchestrationWorkflowVersions.workflowId, input.workflowId))
        .orderBy(desc(orchestrationWorkflowVersions.version));
      return rows;
    }),

  /** W3-11 — get one version snapshot (with its full definition). Read-only. */
  getVersion: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const d = await db();
      const [row] = await d
        .select()
        .from(orchestrationWorkflowVersions)
        .where(eq(orchestrationWorkflowVersions.id, input.id))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Version ${input.id} not found` });
      return row;
    }),

  /**
   * W3-11 — ROLL BACK a workflow to an earlier version by re-deploying that version's
   * definition as a NEW version (append-only). Flag-gated; machine_control/canCreate.
   */
  rollbackWorkflow: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ workflowId: z.number().int().positive(), version: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      return rollbackWorkflow(input.workflowId, input.version, toFoeUser(ctx.user));
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

  /**
   * E3a — DIGITAL-TWIN SIMULATE: predict a workflow's execution WITHOUT any dispatch.
   * Read-only (no control) → machine_monitoring/canView. PURE + fail-safe; NOT flag-gated
   * (simulation is always safe). Supply an inline `workflow` OR a `workflowRef` to load a
   * stored definition. Resolves referenced machine rows so the twin can map command verbs
   * to PackML transitions; assumed telemetry/params feed the condition evaluator.
   */
  simulate: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z.object({
        workflow: z.record(z.string(), z.unknown()).optional(),
        workflowRef: z.string().min(1).max(128).optional(),
        params: z.record(z.string(), z.unknown()).default({}),
        assumedTelemetry: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
        commandDurations: z.record(z.string(), z.number()).optional(),
        defaultCommandMs: z.number().int().min(0).optional(),
        gateMs: z.number().int().min(0).optional(),
        // Inline machine rows (machineType + capabilities) for "what-if" / self-contained
        // simulations of machines that may not exist in the DB. Override DB rows by id.
        machines: z
          .array(
            z.object({
              id: z.number().int().positive(),
              machineType: z.string().min(1).max(64),
              capabilities: z.unknown().optional(),
            }),
          )
          .optional(),
      }),
    )
    .query(async ({ input }): Promise<SimulationResult> => {
      const d = await db();

      // Resolve the definition: inline `workflow` wins, else load by `workflowRef`.
      let def: WorkflowDefinition | undefined;
      if (input.workflow) {
        def = input.workflow as unknown as WorkflowDefinition;
      } else if (input.workflowRef) {
        const [wf] = await d
          .select()
          .from(orchestrationWorkflows)
          .where(eq(orchestrationWorkflows.ref, input.workflowRef))
          .limit(1);
        if (!wf) throw new TRPCError({ code: "NOT_FOUND", message: `Workflow "${input.workflowRef}" not found` });
        def = wf.definitionJson as WorkflowDefinition;
      } else {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Provide either `workflow` or `workflowRef`." });
      }

      // Load referenced machine rows (machineType + capabilities) for capability resolution.
      const refIds = new Set(validateWorkflow(def, null).referencedMachineIds);
      const byId = new Map<number, { id: number; machineType: string; capabilities?: unknown }>();
      if (refIds.size > 0) {
        const rows = await d.select().from(machines);
        for (const m of rows) {
          if (refIds.has(m.id)) {
            byId.set(m.id, { id: m.id, machineType: m.machineType, capabilities: m.capabilities });
          }
        }
      }
      // Inline machines override/augment DB rows (self-contained what-if simulations).
      for (const m of input.machines ?? []) {
        byId.set(m.id, { id: m.id, machineType: m.machineType, capabilities: m.capabilities });
      }
      const machineRows = [...byId.values()];

      // PURE prediction — no dispatch, no control. Normalize the telemetry key types.
      const assumedTelemetry: Record<number, Record<string, unknown>> | undefined = input.assumedTelemetry
        ? Object.fromEntries(
            Object.entries(input.assumedTelemetry).map(([k, v]) => [Number(k), v as Record<string, unknown>]),
          )
        : undefined;

      return simulateWorkflow(def, input.params, {
        machines: machineRows,
        assumedTelemetry,
        commandDurations: input.commandDurations,
        defaultCommandMs: input.defaultCommandMs,
        gateMs: input.gateMs,
      });
    }),

  /** Abort an in-flight run (terminal). */
  abortRun: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ runId: z.number().int().positive(), reason: z.string().max(1000).optional() }))
    .mutation(async ({ input, ctx }) => {
      return abortRun(input.runId, toFoeUser(ctx.user), input.reason);
    }),

  /**
   * DELETE a workflow (by id OR ref).
   *
   * CASCADE-SAFETY (documented): deleting a workflow that still has NON-TERMINAL runs
   * (queued/running/held/awaiting_confirm) is REFUSED — those runs would be orphaned;
   * the caller must abort/finish them first. When only terminal runs remain, the run
   * history (orchestration_runs + orchestration_run_steps) is cascaded/cleaned so no
   * dangling FK rows are left behind, then the workflow row is removed.
   * RBAC: machine_control / canDelete.
   */
  deleteWorkflow: protectedProcedure
    .use(requirePermission("machine_control", "canDelete"))
    .input(
      z
        .object({
          id: z.number().int().positive().optional(),
          ref: z.string().min(1).max(128).optional(),
        })
        .refine((v) => v.id != null || v.ref != null, { message: "Provide either `id` or `ref`." }),
    )
    .mutation(async ({ input }) => {
      const d = await db();
      const [wf] = await d
        .select()
        .from(orchestrationWorkflows)
        .where(input.id != null ? eq(orchestrationWorkflows.id, input.id) : eq(orchestrationWorkflows.ref, input.ref!))
        .limit(1);
      if (!wf) throw new TRPCError({ code: "NOT_FOUND", message: "Workflow not found" });

      const runs = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.workflowId, wf.id));
      const active = runs.filter((r) => !["completed", "failed", "aborted"].includes(r.status));
      if (active.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Workflow "${wf.ref}" has ${active.length} active run(s). Abort or finish them before deleting.`,
        });
      }

      // Cascade-clean terminal run history (steps → runs) then delete the workflow.
      const runIds = runs.map((r) => r.id);
      if (runIds.length > 0) {
        await d.delete(orchestrationRunSteps).where(inArray(orchestrationRunSteps.runId, runIds));
        await d.delete(orchestrationRuns).where(eq(orchestrationRuns.workflowId, wf.id));
      }
      await d.delete(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, wf.id));
      return { ok: true, id: wf.id, ref: wf.ref, removedRuns: runIds.length };
    }),

  /**
   * DUPLICATE a workflow (by id OR ref) under a NEW unique ref. Copies the definition
   * (re-stamping its `ref`), resets version to 1, and creates a fresh row with NO runs.
   * RBAC: machine_control / canCreate.
   */
  duplicateWorkflow: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z
        .object({
          id: z.number().int().positive().optional(),
          ref: z.string().min(1).max(128).optional(),
          newRef: z.string().min(1).max(128),
          newName: z.string().min(1).max(255).optional(),
        })
        .refine((v) => v.id != null || v.ref != null, { message: "Provide either `id` or `ref`." }),
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const [src] = await d
        .select()
        .from(orchestrationWorkflows)
        .where(input.id != null ? eq(orchestrationWorkflows.id, input.id) : eq(orchestrationWorkflows.ref, input.ref!))
        .limit(1);
      if (!src) throw new TRPCError({ code: "NOT_FOUND", message: "Source workflow not found" });

      const newRef = input.newRef.trim();
      const [clash] = await d
        .select()
        .from(orchestrationWorkflows)
        .where(eq(orchestrationWorkflows.ref, newRef))
        .limit(1);
      if (clash) throw new TRPCError({ code: "CONFLICT", message: `A workflow with ref "${newRef}" already exists.` });

      // Re-stamp the definition's own ref so the stored JSON stays consistent.
      const def = {
        ...(src.definitionJson as unknown as Record<string, unknown>),
        ref: newRef,
      } as typeof src.definitionJson;
      const newName = input.newName?.trim() || `${src.name} (copy)`;
      const [row] = await d
        .insert(orchestrationWorkflows)
        .values({
          ref: newRef,
          name: newName,
          version: 1,
          description: src.description,
          definitionJson: def,
          status: "active",
          createdBy: ctx.user?.id ?? null,
        })
        .returning();
      return { ok: true, id: row.id, ref: row.ref };
    }),
});
