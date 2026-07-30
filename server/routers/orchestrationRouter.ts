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
import { appError } from "../_core/appError";
import { router, moduleProcedure, moduleGate, actuationProcedure as actuationBase, deployProcedure as deployBase } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
// Doc 37 P0-3 — gate the Orchestration Studio surface behind MOD_ENGINEERING
// (flag LICENSE_MODULE_GATE_ENABLED → pass-through until SKU configured). Shadows
// `protectedProcedure`; per-action RBAC + FOE_ENABLED guards are unchanged.
const protectedProcedure = moduleProcedure("MOD_ENGINEERING");
// Doc 38 Đợt Q — role-floor (admin/supervisor/engineer) + 2FA for every deploy/run
// (device-actuation) path, PLUS the same MOD_ENGINEERING license gate. Per-action
// requirePermission("machine_control", …) still composes on top.
const actuationProcedure = actuationBase.use(moduleGate("MOD_ENGINEERING"));
// doc 40 CTL-07 — deploy path thêm lớp step-up 2FA (requireFreshTotp) SAU cờ ACTUATION_STEPUP_2FA
// (mặc định OFF → pass-through). Vẫn giữ role-floor + require2FA + MOD_ENGINEERING như actuation.
const deployProcedure = deployBase.use(moduleGate("MOD_ENGINEERING"));
import { orchestrationWorkflows, orchestrationWorkflowVersions, orchestrationRuns, orchestrationRunSteps, machines } from "../../drizzle/schema";
import {
  deployWorkflow,
  rollbackWorkflow,
  startRun,
  resumeRun,
  abortRun,
  getRun,
  foeEnabled,
  foeSimGateRequired,
  issueSimToken,
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
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return d;
}

export const orchestrationRouter = router({
  /** Whether the FOE flag is enabled + sim-gate required (UI gating hints). */
  status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({ enabled: foeEnabled(), simGateRequired: foeSimGateRequired() })),

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
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "workflow" }, `Workflow ${input.id} not found`);
      return row;
    }),

  /**
   * Deploy (validate + persist) a workflow definition. Flag-gated by FOE_ENABLED.
   * doc 40 ENG-F4 — SIM-GATE: khi FOE_SIM_GATE_REQUIRED bật, phải kèm `simToken` (do
   * orchestration.simulate phát hành cho ĐÚNG định nghĩa này khi sim ĐẠT) HOẶC `overrideReason`
   * (ghi audit). Mặc định OFF → không đổi. doc 40 CTL-07 — `totpCode` (tuỳ chọn) cho step-up 2FA
   * khi ACTUATION_STEPUP_2FA bật (đọc bởi middleware requireFreshTotp; OFF → bỏ qua).
   */
  deployWorkflow: deployProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        definition: z.record(z.string(), z.unknown()),
        simToken: z.string().max(256).optional(),
        overrideReason: z.string().max(1000).optional(),
        totpCode: z.string().max(16).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const result = await deployWorkflow(
        input.definition as unknown as WorkflowDefinition,
        toFoeUser(ctx.user),
        { simToken: input.simToken ?? null, overrideReason: input.overrideReason ?? null },
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
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "workflowVersion" }, `Version ${input.id} not found`);
      return row;
    }),

  /**
   * W3-11 — ROLL BACK a workflow to an earlier version by re-deploying that version's
   * definition as a NEW version (append-only). Flag-gated; machine_control/canCreate.
   */
  rollbackWorkflow: actuationProcedure
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
      if (!view) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "workflowRun" }, `Run ${input.runId} not found`);
      return view;
    }),

  /** Start a run of a deployed workflow (by ref). Flag-gated. */
  startRun: actuationProcedure
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
  resumeRun: actuationProcedure
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
    .query(async ({ input }): Promise<SimulationResult & { simToken?: string }> => {
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
        if (!wf) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "workflow" }, `Workflow "${input.workflowRef}" not found`);
        def = wf.definitionJson as WorkflowDefinition;
      } else {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Provide either `workflow` or `workflowRef`." });
      }

      // Load referenced machine rows (machineType + capabilities) for capability resolution.
      const refIds = new Set(validateWorkflow(def, null).referencedMachineIds);
      const byId = new Map<number, { id: number; machineType: string; capabilities?: unknown }>();
      if (refIds.size > 0) {
        // Doc 54 P3.4 (#3) — set-membership PHẢI dùng Drizzle inArray: nạp ĐÚNG các máy được tham
        // chiếu thay vì quét TOÀN BỘ bảng machines rồi lọc trong JS (chậm + tốn RAM theo quy mô nhà
        // máy, và sai về ngữ nghĩa "IN (...)"). inArray đã import sẵn ở đầu file.
        const rows = await d.select().from(machines).where(inArray(machines.id, [...refIds]));
        for (const m of rows) {
          byId.set(m.id, { id: m.id, machineType: m.machineType, capabilities: m.capabilities });
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

      const result = simulateWorkflow(def, input.params, {
        machines: machineRows,
        assumedTelemetry,
        commandDurations: input.commandDurations,
        defaultCommandMs: input.defaultCommandMs,
        gateMs: input.gateMs,
      });

      // doc 40 ENG-F4 — khi sim ĐẠT (feasible), phát hành sim-token (HMAC) buộc vào ĐÚNG định nghĩa
      // này. Client mang token sang deployWorkflow để qua sim-gate. Sim KHÔNG đạt → không có token
      // (deploy sẽ bị chặn nếu FOE_SIM_GATE_REQUIRED bật, trừ khi override có lý do).
      const simToken = result.ok ? issueSimToken(def) : undefined;
      return { ...result, simToken };
    }),

  /** Abort an in-flight run (terminal). */
  abortRun: actuationProcedure
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
      if (!wf) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "workflow" }, "Workflow not found");

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
      if (!src) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "workflow" }, "Source workflow not found");

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
