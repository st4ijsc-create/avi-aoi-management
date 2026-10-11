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
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, moduleProcedure, moduleGate, writeProcedure as writeBase, actuationProcedure as actuationBase, deployProcedure as deployBase } from "../_core/trpc";
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
// doc 40 CTL-07 — deploy path thêm lớp step-up 2FA SAU cờ ACTUATION_STEPUP_2FA (mặc định OFF →
// pass-through). Vẫn giữ role-floor + require2FA + MOD_ENGINEERING như actuation.
// ★★★ Pha 6 Task 1b — `deployProcedure` (gốc, `_core/trpc.ts`) nay chain `requirePerCallFreshTotp`:
// khi cờ BẬT, `totpCode` là **BẮT BUỘC MỖI LƯỢT GỌI**, không còn cache phiên 10 phút.
// ★★★ I-4 (review Task 1b) — `.optional()` ĐÃ ĐƯỢC GỠ khỏi zod bên dưới. Lý do cũ (*"bắt buộc sẽ
// gãy mọi lượt gọi khi cờ TẮT"*) **không đứng vững khi kiểm**: `useStepUpOtp.guard` KHÔNG đọc cờ
// client nên UI gửi mã ở **cả hai** trạng thái cờ, và **0** người gọi tRPC nội bộ. Cái `.optional()`
// ấy **không phải mỹ quan** — nó là **CƠ CHẾ** khiến `tsc` **ban phước** cho đột biến R2 (gỡ
// `stepUp.guard` + `totpCode` khỏi một điểm gọi client ⇒ 108 file/1837 ca XANH, tsc SẠCH).
// Bắt buộc ở zod ⇒ lượt gỡ ấy nay là một **lỗi biên dịch**. ⚠ CHỈ THU HẸP: middleware vẫn đọc raw
// input TRƯỚC zod và fail-closed, nên zod không phải cổng an ninh — nó là cổng **hợp đồng**.
// Lưới: `server/routers/deployStepUpFreshness.test.ts` · `client/src/lib/vramPanelStepUp.unit.test.ts`.
const deployProcedure = deployBase.use(moduleGate("MOD_ENGINEERING"));
// doc 80 ORC-06 — write floor (not a read-only role) + the same MOD_ENGINEERING license gate.
const writeProcedure = writeBase.use(moduleGate("MOD_ENGINEERING"));
/**
 * doc 81 Đợt 7 final wave F8 — the WORKFLOW-MANAGEMENT procedures (list / get / deploy / rollback / versions / start / simulate /
 * delete / duplicate) answer a clear "migration 0367 missing" while it is (foeEngine.assertFoeSchemaReady). NOT on the
 * stopping paths (L-7): status, listRuns, runListMeta, getRun, abortRun and a gate REJECTION keep working.
 */
async function foeSchemaGuard({ ctx, next }: { ctx: unknown; next: Function }) {
  await assertFoeSchemaReady();
  return next({ ctx });
}
import { orchestrationWorkflows, orchestrationWorkflowVersions, orchestrationRuns, orchestrationRunSteps, machines } from "../../drizzle/schema";
import { summarizeRunDispatch } from "../../shared/provenance";
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
  definitionVisibleTo,
  definitionFullyInScope,
  filterVisibleBy,
  filterRunsVisibleTo,
  runVisibleTo,
  visibleWorkflowIds,
  listVisibleRuns,
  resolveWorkflowByRef,
  assertFoeSchemaReady,
  type FoeUser,
} from "../services/orchestration/foe/foeEngine";
import { resolveUserFoeScope, workflowScopeKeyOf, type FoeScope } from "../services/orchestration/foe/foeScope";
import {
  simulateWorkflow,
  type SimulationResult,
} from "../services/orchestration/foe/foeSimulator";
import { validateWorkflow, type WorkflowDefinition } from "../services/orchestration/foe/workflowModel";

function toFoeUser(user: { id: number; role: string; name?: string | null }): FoeUser {
  return { id: user.id, role: String(user.role), name: user.name ?? null };
}

/**
 * doc 81 Đợt 5 task E2 (item 26) — the caller's factory scope: ctx.user ONLY (never the input), through the same resolver
 * every other tRPC scope uses (admin ⇒ unrestricted). Every read below answers an out-of-scope row exactly like a missing
 * one (rule: foeScope.ts header); deploy / rollback / start / resume resolve the same scope inside the engine.
 */
function scopeOf(user: { id: number; role: string }): FoeScope {
  return resolveUserFoeScope({ id: user.id, role: String(user.role) });
}

/**
 * doc 81 Đợt 7 I fix 1 — the workflow a by-id-or-ref input names FOR THE CALLER: by id (any namespace) or by ref resolved
 * within the caller's view (foeEngine.resolveWorkflowByRef; `workflowId` pins the ref resolution to that workflow — final wave
 * F9 / N4). Not visible / several ⇒ undefined + `ambiguous`; the visibility check of each procedure still runs on the result
 * (a missing and an out-of-scope workflow answer the same).
 * final wave F3 (R-7-d) — the caller's namespace or view could not be decided ⇒ THROWS scopeUnverified ("retry"): never a
 * fallback to the 'global' / single visible workflow in place of the caller's own.
 */
async function workflowByIdOrRef(
  d: Awaited<ReturnType<typeof db>>,
  input: { id?: number; ref?: string; workflowId?: number },
  scope: FoeScope,
): Promise<{ row: typeof orchestrationWorkflows.$inferSelect | undefined; ambiguous: boolean }> {
  if (input.id != null) {
    const [row] = await d.select().from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, input.id)).limit(1);
    return { row, ambiguous: false };
  }
  let key: string | null = null;
  try {
    key = await workflowScopeKeyOf(scope);
  } catch {
    key = null; // ⇒ resolveWorkflowByRef answers "unverified"
  }
  const r = await resolveWorkflowByRef(d, input.ref ?? "", scope, key, { workflowId: input.workflowId });
  if (r.kind === "unverified") throw scopeUnverifiedError();
  return { row: r.kind === "row" ? r.row : undefined, ambiguous: r.kind === "ambiguous" };
}

/** final wave F3 (R-7-d) — the caller's factory scope / view of a ref could not be decided (retry). */
function scopeUnverifiedError() {
  return appError("CONFLICT", "OPERATION_FAILED", { operation: "resolveWorkflowRef", reason: "scopeUnverified" }, "Your factory scope could not be verified — retry in a moment.");
}

function refAmbiguousError(ref: string) {
  return appError("CONFLICT", "OPERATION_FAILED", { operation: "resolveWorkflowRef", reason: "refAmbiguous" }, `Several workflows you can see use the ref "${ref}" — use the workflow's id.`);
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
    .use(foeSchemaGuard) // final wave F8 — migration 0367 missing ⇒ a clear refusal
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional())
    .query(async ({ input, ctx }) => {
      const d = await db();
      // doc 81 Đợt 5 task E2 + E fix 1 (review #8) — only workflows whose non-STOP targets are in the caller's scope,
      // filtered IN SQL before the LIMIT (a full page, no "hidden rows" count).
      const ids = await visibleWorkflowIds(scopeOf(ctx.user));
      return d
        .select()
        .from(orchestrationWorkflows)
        .where(ids === null ? undefined : inArray(orchestrationWorkflows.id, ids.length ? ids : [-1]))
        .orderBy(desc(orchestrationWorkflows.updatedAt))
        .limit(input?.limit ?? 100);
    }),

  /** Get one workflow by id (with its full definition). */
  getWorkflow: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .use(foeSchemaGuard) // final wave F8 — migration 0367 missing ⇒ a clear refusal
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const d = await db();
      const [row] = await d
        .select()
        .from(orchestrationWorkflows)
        .where(eq(orchestrationWorkflows.id, input.id))
        .limit(1);
      // doc 81 Đợt 5 task E2 — out of scope ⇒ the SAME NOT_FOUND as a missing id (scope resolved for both: same path).
      const visible = await definitionVisibleTo(row?.definitionJson as WorkflowDefinition | undefined, scopeOf(ctx.user));
      if (!row || !visible) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "workflow" }, `Workflow ${input.id} not found`);
      }
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
    .use(foeSchemaGuard) // final wave F8 — migration 0367 missing ⇒ a clear refusal
    .input(
      z.object({
        definition: z.record(z.string(), z.unknown()),
        simToken: z.string().max(256).optional(),
        overrideReason: z.string().max(1000).optional(),
        totpCode: z.string().max(16),
        /** doc 81 Đợt 7 I fix 1 — the workflow the editor loaded (it is updated when it carries this ref and is visible). */
        workflowId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const result = await deployWorkflow(
        input.definition as unknown as WorkflowDefinition,
        toFoeUser(ctx.user),
        { simToken: input.simToken ?? null, overrideReason: input.overrideReason ?? null, targetWorkflowId: input.workflowId },
      );
      return result;
    }),

  /**
   * W3-11 — list the VERSION snapshots of a workflow (newest first). Read-only.
   * Backs the version diff + rollback panel in the Studio.
   */
  listVersions: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .use(foeSchemaGuard) // final wave F8 — migration 0367 missing ⇒ a clear refusal
    .input(z.object({ workflowId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const d = await db();
      // doc 81 Đợt 5 task E2 — a workflow the caller cannot see has no versions for them (as a missing id: []); of a
      // visible one, only the versions whose own definition the caller may see.
      const scope = scopeOf(ctx.user);
      const [head] = await d.select().from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, input.workflowId)).limit(1);
      const headVisible = await definitionVisibleTo(head?.definitionJson as WorkflowDefinition | undefined, scope);
      if (!head || !headVisible) return []; // a missing workflow has no versions either (same answer)
      const rows = await d
        .select()
        .from(orchestrationWorkflowVersions)
        .where(eq(orchestrationWorkflowVersions.workflowId, input.workflowId))
        .orderBy(desc(orchestrationWorkflowVersions.version));
      return filterVisibleBy(rows, (r) => r.definitionJson as WorkflowDefinition, scope);
    }),

  /** W3-11 — get one version snapshot (with its full definition). Read-only. */
  getVersion: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .use(foeSchemaGuard) // final wave F8 — migration 0367 missing ⇒ a clear refusal
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const d = await db();
      const [row] = await d
        .select()
        .from(orchestrationWorkflowVersions)
        .where(eq(orchestrationWorkflowVersions.id, input.id))
        .limit(1);
      // doc 81 Đợt 5 task E2 — the version's own definition AND its workflow's current one must be visible.
      const scope = scopeOf(ctx.user);
      const ownVisible = await definitionVisibleTo(row?.definitionJson as WorkflowDefinition | undefined, scope);
      // doc 81 Đợt 7 I3 — `paramsJson: null` asks about the workflow's HEAD (this is a workflow-level check, not a run)
      const headVisible = await runVisibleTo({ workflowId: row?.workflowId ?? -1, paramsJson: null }, scope);
      if (!row || !ownVisible || !headVisible) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "workflowVersion" }, `Version ${input.id} not found`);
      return row;
    }),

  /**
   * W3-11 — ROLL BACK a workflow to an earlier version by re-deploying that version's
   * definition as a NEW version (append-only). Flag-gated; machine_control/canCreate.
   * doc 80 ORC-05 — a rollback IS a deploy: `deployProcedure` (fresh per-call OTP `totpCode`)
   * and a mandatory human `reason` (≥3 chars, audited; it is also the sim-gate override reason —
   * the engine no longer auto-fills one).
   */
  rollbackWorkflow: deployProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .use(foeSchemaGuard) // final wave F8 — migration 0367 missing ⇒ a clear refusal
    .input(
      z.object({
        workflowId: z.number().int().positive(),
        version: z.number().int().positive(),
        reason: z.string().trim().min(3).max(1000),
        totpCode: z.string().max(16),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return rollbackWorkflow(input.workflowId, input.version, toFoeUser(ctx.user), input.reason);
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
    .query(async ({ input, ctx }) => {
      const d = await db();
      // doc 81 Đợt 5 task E2 — only runs the caller may see; a run whose workflow row is gone is visible only to an
      // unrestricted scope. doc 81 Đợt 7 task I3 — by the definition VERSIONS each run executed (not the workflow's current
      // head): foeEngine.listVisibleRuns (a full page, newest first).
      // doc 81 Đợt 7 I fix 1 — bounded: the scope filter is SQL before LIMIT (RUN_LIST_MAX_LIMIT ≥ this input's max 500);
      // whether definitions were left unjudged is told by `runListMeta` (the Studio shows a notice).
      const { runs } = await listVisibleRuns({ workflowId: input?.workflowId ?? undefined, limit: input?.limit ?? 100 }, scopeOf(ctx.user));
      // doc 80 Đợt 1 Task 4 (ORC-13) — additive `dispatch`: were this run's commands simulated
      // (DRY-RUN) or really sent? Derived from the step results foeEngine records
      // ({routedTo, status, simulated}); one extra query over the listed run ids.
      const stepRows = runs.length
        ? await d
            .select({ runId: orchestrationRunSteps.runId, resultJson: orchestrationRunSteps.resultJson })
            .from(orchestrationRunSteps)
            .where(inArray(orchestrationRunSteps.runId, runs.map((r) => r.id)))
        : [];
      const byRun = new Map<number, unknown[]>();
      for (const s of stepRows) {
        const list = byRun.get(s.runId);
        if (list) list.push(s.resultJson);
        else byRun.set(s.runId, [s.resultJson]);
      }
      return runs.map((r) => ({ ...r, dispatch: summarizeRunDispatch(byRun.get(r.id) ?? []) }));
    }),

  /**
   * doc 81 Đợt 7 I fix 1 (review M-5) — is the caller's run list TRUNCATED? true ⇔ more workflow definitions exist than one call
   * judges (foeEngine.RUN_SCOPE_MAX_DEFINITIONS) — the runs of the versions left out are not listed — or the scope could
   * not be decided. The Studio says so instead of silently showing fewer runs.
   */
  runListMeta: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(async ({ ctx }) => {
      const { truncated } = await listVisibleRuns({ limit: 1 }, scopeOf(ctx.user));
      return { truncated };
    }),

  /** Get a run + its per-step audit. */
  getRun: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ runId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      // final wave F6 — the Studio's run screen is where an approval / continue binds: the digest is computed here (paused runs).
      // doc 81 Đợt 8 final wave (review O M1) — the SCOPE check runs on the run row BEFORE anything else is read, so an
      // out-of-scope viewer never triggers controller checksum reads (concurrent screens share one read: single-flight).
      // doc 81 Đợt 5 task E2 — out of scope ⇒ the SAME NOT_FOUND as a missing run (scope resolved for both).
      // doc 81 Đợt 7 I3 — by the versions the run executed (run.paramsJson)
      const scope = scopeOf(ctx.user);
      let checked = false;
      const view = await getRun(input.runId, {
        bindingDigest: true,
        visibleTo: async (run) => {
          checked = true;
          return runVisibleTo(run, scope);
        },
      });
      if (!checked) await runVisibleTo({ workflowId: -1, paramsJson: null }, scope); // missing run: scope resolved too (parity)
      if (!view) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "workflowRun" }, `Run ${input.runId} not found`);
      }
      return view;
    }),

  /** Start a run of a deployed workflow (by ref). Flag-gated. */
  startRun: actuationProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .use(foeSchemaGuard) // final wave F8 — migration 0367 missing ⇒ a clear refusal
    .input(
      z.object({
        workflowRef: z.string().min(1).max(128),
        params: z.record(z.string(), z.unknown()).default({}),
        /** doc 81 Đợt 7 I fix 1 — the workflow the caller means when several visible ones share the ref. */
        workflowId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return startRun(input.workflowRef, input.params, toFoeUser(ctx.user), { workflowId: input.workflowId });
    }),

  /**
   * Resume a run paused at a hitl_gate (approve/reject). Flag-gated.
   * doc 80 Đợt 1 Task 9 — `expectedStepId` (BẮT BUỘC) = gate màn hình đang hiện cho người duyệt
   * (`null` khi run không có bước hiện tại — run 'held' gián đoạn trước bước đầu). Run đã sang
   * gate khác ⇒ CONFLICT (reason runGateChanged): người duyệt cũ không duyệt/từ chối được gate kế.
   */
  resumeRun: actuationProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z
        .object({
          runId: z.number().int().positive(),
          approved: z.boolean(),
          note: z.string().max(1000).optional(),
          expectedStepId: z.string().max(128).nullable(),
          /**
           * doc 81 Đợt 4 fix round 2 (R-4-k) — REQUIRED on an approval: getRun().defHash as the approver's screen loaded
           * it. A redeploy since then ⇒ CONFLICT (definitionChanged, "reload"). Rejections do not need it.
           */
          expectedDefHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
          /**
           * doc 81 Đợt 7 task I2 — REQUIRED on an approval: getRun().bindingDigest as the approver's screen loaded it. The
           * device configuration changed since then (or cannot be read now) ⇒ CONFLICT (bindingChanged, "reload").
           */
          expectedBindingDigest: z.string().regex(/^[0-9a-f]{64}$/).optional(),
        })
        .refine((i) => !i.approved || i.expectedDefHash !== undefined, {
          message: "expectedDefHash is required to approve",
          path: ["expectedDefHash"],
        })
        .refine((i) => !i.approved || i.expectedBindingDigest !== undefined, {
          message: "expectedBindingDigest is required to approve",
          path: ["expectedBindingDigest"],
        }),
    )
    .mutation(async ({ input, ctx }) => {
      // final wave F8 — an APPROVAL resumes actuation ⇒ refused clearly while migration 0367 is missing; a REJECTION is a
      // stopping path (it sends the run's STOP steps — L-7) and is never gated here.
      if (input.approved) await assertFoeSchemaReady();
      return resumeRun(
        input.runId,
        {
          approved: input.approved,
          note: input.note,
          expectedStepId: input.expectedStepId,
          expectedDefHash: input.expectedDefHash,
          expectedBindingDigest: input.expectedBindingDigest,
        },
        toFoeUser(ctx.user),
      );
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
    .use(foeSchemaGuard) // final wave F8 — migration 0367 missing ⇒ a clear refusal
    .input(
      z.object({
        workflow: z.record(z.string(), z.unknown()).optional(),
        workflowRef: z.string().min(1).max(128).optional(),
        /** final wave F9 (I re-review N4) — the workflow the caller picked when several visible ones share `workflowRef`. */
        workflowId: z.number().int().positive().optional(),
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
    .query(async ({ input, ctx }): Promise<SimulationResult & { simToken?: string }> => {
      const d = await db();

      // Resolve the definition: inline `workflow` wins, else load by `workflowRef`.
      let def: WorkflowDefinition | undefined;
      if (input.workflow) {
        def = input.workflow as unknown as WorkflowDefinition;
      } else if (input.workflowRef) {
        // doc 81 Đợt 7 I fix 1 — resolved within the caller's view (namespaces)
        const found = await workflowByIdOrRef(d, { ref: input.workflowRef, workflowId: input.workflowId }, scopeOf(ctx.user));
        if (found.ambiguous) throw refAmbiguousError(input.workflowRef);
        const wf = found.row;
        // doc 81 Đợt 5 task E2 — a stored workflow outside the caller's scope ⇒ the SAME NOT_FOUND as a missing ref.
        const visible = await definitionVisibleTo(wf?.definitionJson as WorkflowDefinition | undefined, scopeOf(ctx.user));
        if (!wf || !visible) {
          throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "workflow" }, `Workflow "${input.workflowRef}" not found`);
        }
        def = wf.definitionJson as WorkflowDefinition;
      } else {
        throw appError("BAD_REQUEST", "FIELD_REQUIRED", { field: "workflowOrWorkflowRef" }, "Provide either `workflow` or `workflowRef`.");
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
      // doc 81 Đợt 5 task E2 fix (R-5-d) — the engine checks the aborter's scope (from ctx.user): out of scope ⇒ "not found".
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
    .use(foeSchemaGuard) // final wave F8 — migration 0367 missing ⇒ a clear refusal
    .input(
      z
        .object({
          id: z.number().int().positive().optional(),
          ref: z.string().min(1).max(128).optional(),
        })
        .refine((v) => v.id != null || v.ref != null, { message: "Provide either `id` or `ref`." }),
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      // doc 81 Đợt 5 task E2 — invisible ⇒ the SAME NOT_FOUND; visible but some target (a STOP's, e.g. a shared emergency
      // stop of another factory) outside the caller's scope ⇒ refused: removing a workflow is a change like deploying one.
      // doc 81 Đợt 7 I fix 1 — a ref is resolved within the caller's view (namespaces).
      const scope = scopeOf(ctx.user);
      const found = await workflowByIdOrRef(d, input, scope);
      if (found.ambiguous) throw refAmbiguousError(input.ref ?? "");
      const wf = found.row;
      const visible = await definitionVisibleTo(wf?.definitionJson as WorkflowDefinition | undefined, scope);
      if (!wf || !visible) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "workflow" }, "Workflow not found");
      }
      if (!(await definitionFullyInScope(wf.definitionJson as WorkflowDefinition, scope))) {
        throw appError(
          "CONFLICT",
          "OPERATION_FAILED",
          { operation: "deleteWorkflow", reason: "workflowTargetsOutOfScope" },
          `Workflow "${wf.ref}" touches machines/robots outside your factory scope (stop steps included) — only someone whose scope covers them can delete it.`,
        );
      }

      const runs = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.workflowId, wf.id));
      const active = runs.filter((r) => !["completed", "failed", "aborted"].includes(r.status));
      if (active.length > 0) {
        throw appError(
          "CONFLICT",
          "OPERATION_FAILED",
          { operation: "deleteWorkflow" },
          `Workflow "${wf.ref}" has ${active.length} active run(s). Abort or finish them before deleting.`,
        );
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
   * RBAC: write floor + machine_control / canCreate.
   * doc 80 ORC-06 — the copy is created `draft` (NOT runnable): startRun refuses it until it
   * passes deployWorkflow (validation + sim-gate + version snapshot), which sets it `active`.
   */
  duplicateWorkflow: writeProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .use(foeSchemaGuard) // final wave F8 — migration 0367 missing ⇒ a clear refusal
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
      const scopeD = scopeOf(ctx.user);
      const srcFound = await workflowByIdOrRef(d, input, scopeD); // doc 81 Đợt 7 I fix 1 — namespaces
      if (srcFound.ambiguous) throw refAmbiguousError(input.ref ?? "");
      const src = srcFound.row;
      // doc 81 Đợt 5 task E2 — a source outside the caller's scope ⇒ the SAME NOT_FOUND (copying is reading).
      const srcVisible = await definitionVisibleTo(src?.definitionJson as WorkflowDefinition | undefined, scopeD);
      if (!src || !srcVisible) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "workflow" }, "Source workflow not found");
      }

      // doc 81 Đợt 7 task I3 + I fix 1 (owner decision, mig 0367) — WORKFLOW-REF PROBING closed by NAMESPACES: the copy is
      // created in the caller's own namespace (scope key). A ref the caller can see (its own namespace, or a visible workflow
      // of another one) ⇒ ENTITY_DUPLICATE, as before; a ref used only by workflows it cannot see answers exactly like a free
      // ref (the copy is created under the plain ref — the namespaces never collide). A race ⇒ ENTITY_DUPLICATE (no raw text).
      const newRef = input.newRef.trim();
      let dupKey: string;
      try {
        dupKey = await workflowScopeKeyOf(scopeD);
      } catch {
        throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Factory scope could not be resolved — retry.");
      }
      const clash = await resolveWorkflowByRef(d, newRef, scopeD, dupKey, { ownAnyVisibility: true });
      if (clash.kind === "unverified") throw scopeUnverifiedError(); // final wave F3 (R-7-d)
      if (clash.kind !== "none") throw appError("CONFLICT", "ENTITY_DUPLICATE", { entity: "workflow" }, `A workflow with ref "${newRef}" already exists.`);

      // Re-stamp the definition's own ref so the stored JSON stays consistent.
      const def = {
        ...(src.definitionJson as unknown as Record<string, unknown>),
        ref: newRef,
      } as typeof src.definitionJson;
      const newName = input.newName?.trim() || `${src.name} (copy)`;
      const insertCopy = d
        .insert(orchestrationWorkflows)
        .values({
          ref: newRef,
          scopeKey: dupKey,
          name: newName,
          version: 1,
          description: src.description,
          definitionJson: def,
          status: "draft",
          createdBy: ctx.user?.id ?? null,
        })
        .returning();
      let row: typeof orchestrationWorkflows.$inferSelect;
      try {
        [row] = await insertCopy;
      } catch (err) {
        const code = (err as { code?: unknown; cause?: { code?: unknown } })?.code ?? (err as { cause?: { code?: unknown } })?.cause?.code;
        if (code === "23505") throw appError("CONFLICT", "ENTITY_DUPLICATE", { entity: "workflow" }, `A workflow with ref "${newRef}" already exists.`);
        throw err;
      }
      return { ok: true, id: row.id, ref: row.ref, status: row.status };
    }),
});
