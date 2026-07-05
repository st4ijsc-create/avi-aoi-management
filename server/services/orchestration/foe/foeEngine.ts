/**
 * Phase E2 — Factory Control Plane: FACTORY ORCHESTRATION ENGINE (FOE) — EXECUTOR.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The BUILD-OWN ISA-88-style workflow RUNTIME. It walks a portable WorkflowDefinition
 * (workflowModel.ts) and sequences COMMANDS ACROSS MULTIPLE MACHINES with interlocks,
 * HITL gates and saga compensation — dispatching EVERY control through the EXISTING
 * E0 equipmentRegistry.sendCommand (commandDispatcher / robotCommandDispatcher).
 *
 * SAFETY (ABSOLUTE — non-negotiable):
 *   • A `command` step NEVER opens a device path. It calls
 *     equipmentRegistry.getAdapter(kind).sendCommand(...) which honours the global
 *     OT_CONTROL_ENABLED / ROBOT_CONTROL_ENABLED dry-run gates + the HITL trigger.
 *     With control OFF (the default) the WHOLE workflow runs in SIMULATION and writes
 *     NOTHING — ideal for testing.
 *   • The engine is FLAG-GATED by FOE_ENABLED (default OFF). deployWorkflow/startRun
 *     return a disabled result when off.
 *   • FAIL-SAFE: an executor error NEVER crashes the process. The run transitions to
 *     'failed' with the error recorded.
 *   • DETERMINISTIC: no random control flow.
 *
 * Persistence: orchestration_workflows / _runs / _run_steps (drizzle). The executor
 * persists each step's state as it walks.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import {
  orchestrationWorkflows,
  orchestrationWorkflowVersions,
  orchestrationRuns,
  orchestrationRunSteps,
  machines,
  aiPendingActions,
  type OrchestrationRun,
} from "../../../../drizzle/schema";
import {
  validateWorkflow,
  evaluateCondition,
  type WorkflowDefinition,
  type WorkflowStep,
  type Condition,
  type EvalContext,
  type ValidationError,
  type MachineForValidation,
} from "./workflowModel";
import {
  getCapabilitiesForMachine,
  type EquipmentCapability,
  type CommandDescriptor,
} from "../../equipment/capabilityModel";
import {
  equipmentRegistry,
  type EquipmentCommand,
  type EquipmentCommandResult,
} from "../../equipment/equipmentAdapter";
import { asPackmlState } from "../../equipment/packml";

// ── Flag ────────────────────────────────────────────────────────────────────────

/** Read the flag at call time so config toggles / tests take effect. */
export function foeEnabled(): boolean {
  return process.env.FOE_ENABLED === "true" || process.env.FOE_ENABLED === "1";
}

/**
 * doc 33 I5 (F8 §5.1.6) — durable execution. When on, an interrupted run (marked 'held' by
 * rehydrateInterruptedRuns after a crash) is AUTO-continued rather than waiting for a human to
 * resume it manually. Default OFF → current behavior (manual resume). Requires FOE_ENABLED.
 */
export function foeDurableEnabled(): boolean {
  return process.env.FOE_DURABLE === "true" || process.env.FOE_DURABLE === "1";
}

/** System actor recorded on an auto-resume (never a real human). */
const SYSTEM_FOE_USER: FoeUser = { id: 0, role: "system", name: "FOE auto-resume" };

// ── Public result shapes ─────────────────────────────────────────────────────────

export interface FoeUser {
  id: number;
  role: string;
  name?: string | null;
}

export interface DeployResult {
  ok: boolean;
  enabled: boolean;
  workflowId?: number;
  ref?: string;
  version?: number;
  errors?: ValidationError[];
  message?: string;
}

export interface StartRunResult {
  ok: boolean;
  enabled: boolean;
  runId?: number;
  status?: OrchestrationRun["status"];
  message?: string;
  errors?: ValidationError[];
}

export interface RunView {
  run: OrchestrationRun;
  steps: Array<{
    stepId: string;
    stepType: string;
    status: string;
    attempt: number;
    result: Record<string, unknown> | null;
    error: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
  }>;
}

/** Human gate decision used to resume a run paused at a hitl_gate / held step. */
export interface GateDecision {
  approved: boolean;
  note?: string;
}

// ── Internal exec context (in-memory; mirrors run.contextJson) ──────────────────

interface RunContext {
  runId: number;
  def: WorkflowDefinition;
  params: Record<string, unknown>;
  context: Record<string, unknown>;
  user: FoeUser;
  /** Resolved machine rows by id (for capability + adapter). */
  machineById: Map<number, MachineForValidation>;
  /** Latest telemetry cache used by condition evaluation (machineId|key → value). */
  telemetry: Map<string, unknown>;
  /** Latest device state cache (machineId → state). */
  states: Map<number, string>;
  /** When set, the walk pauses (a hitl_gate reached) at this step id. */
  pausedAtStepId?: string;
  /** True once an abort/fatal interlock has been requested — unwind toward 'failed'. */
  aborting?: boolean;
  /**
   * Doc 25 T1 — RESUME idempotent: stepId đã 'completed'/'skipped' ở lần chạy trước
   * (nguồn chân lý = bảng _run_steps). execStep BỎ QUA mọi bước trong tập này nên khi
   * resume KHÔNG tái-dispatch lệnh đã gửi và KHÔNG re-pause gate đã duyệt — kể cả gate
   * lồng trong parallel/branch (vì mọi walker đều đi qua execStep). Rỗng khi chạy mới.
   */
  completed: Set<string>;
}

/** Outcome of executing a step subtree. */
type StepOutcome =
  | { kind: "ok" }
  | { kind: "skipped" }
  | { kind: "paused"; stepId: string } // hitl_gate / held → run pauses
  | { kind: "failed"; error: string }
  | { kind: "aborted"; error: string };

// ── db helpers (fail-safe) ───────────────────────────────────────────────────────

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not connected");
  return d;
}

async function loadMachines(ids: number[]): Promise<Map<number, MachineForValidation>> {
  const map = new Map<number, MachineForValidation>();
  if (ids.length === 0) return map;
  const d = await getDb();
  if (!d) return map;
  const rows = await d.select().from(machines);
  for (const m of rows) {
    if (ids.includes(m.id)) {
      map.set(m.id, { id: m.id, machineType: m.machineType, capabilities: m.capabilities });
    }
  }
  return map;
}

/**
 * Doc 25 T1 — nạp tập stepId ĐÃ HOÀN TẤT (completed/skipped) của một run từ _run_steps.
 * Dùng cho RESUME idempotent: execStep bỏ qua các bước này. Fail-safe: DB lỗi → tập rỗng
 * (walk sẽ chạy lại — an toàn hơn là bỏ sót bước; với control OFF mọi dispatch là dry-run).
 */
async function loadCompletedSteps(runId: number): Promise<Set<string>> {
  const set = new Set<string>();
  const d = await getDb();
  if (!d) return set;
  const rows = await d
    .select()
    .from(orchestrationRunSteps)
    .where(eq(orchestrationRunSteps.runId, runId));
  for (const r of rows) {
    if (r.status === "completed" || r.status === "skipped") set.add(r.stepId);
  }
  return set;
}

async function setRunStatus(
  runId: number,
  status: OrchestrationRun["status"],
  patch: Partial<OrchestrationRun> = {},
): Promise<void> {
  const d = await getDb();
  if (!d) return;
  await d
    .update(orchestrationRuns)
    .set({ status, updatedAt: new Date(), ...patch })
    .where(eq(orchestrationRuns.id, runId));
}

async function upsertStep(
  runId: number,
  stepId: string,
  stepType: string,
  patch: {
    status: string;
    attempt?: number;
    result?: Record<string, unknown> | null;
    error?: string | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
  },
): Promise<void> {
  const d = await getDb();
  if (!d) return;
  // Upsert on (runId, stepId) — the table has a unique constraint there.
  await d
    .insert(orchestrationRunSteps)
    .values({
      runId,
      stepId,
      stepType,
      status: patch.status as never,
      attempt: patch.attempt ?? 0,
      resultJson: patch.result ?? null,
      error: patch.error ?? null,
      startedAt: patch.startedAt ?? null,
      finishedAt: patch.finishedAt ?? null,
    })
    .onConflictDoUpdate({
      target: [orchestrationRunSteps.runId, orchestrationRunSteps.stepId],
      set: {
        status: patch.status as never,
        attempt: patch.attempt ?? 0,
        resultJson: patch.result ?? null,
        error: patch.error ?? null,
        startedAt: patch.startedAt ?? undefined,
        finishedAt: patch.finishedAt ?? undefined,
      },
    });
}

async function persistContext(rc: RunContext): Promise<void> {
  const d = await getDb();
  if (!d) return;
  await d
    .update(orchestrationRuns)
    .set({
      contextJson: {
        ...rc.context,
        telemetry: Object.fromEntries(rc.telemetry),
        states: Object.fromEntries(rc.states),
      },
      updatedAt: new Date(),
    })
    .where(eq(orchestrationRuns.id, rc.runId));
}

// ── condition / telemetry helpers ────────────────────────────────────────────────

function evalCtxOf(rc: RunContext): EvalContext {
  return {
    params: rc.params,
    context: rc.context,
    getTelemetry: (machineId, key) =>
      machineId == null ? rc.telemetry.get(`*|${key}`) : rc.telemetry.get(`${machineId}|${key}`),
    getState: (machineId) => (machineId == null ? undefined : rc.states.get(machineId)),
  };
}

/**
 * Best-effort refresh of the telemetry/state caches a step's condition references.
 * Reads via the EquipmentAdapter (read-only). Fail-safe — never throws.
 */
async function refreshReadbacks(rc: RunContext, machineId: number | undefined): Promise<void> {
  if (machineId == null) return;
  const m = rc.machineById.get(machineId);
  if (!m) return;
  try {
    const cap = getCapabilitiesForMachine({ machineType: m.machineType, capabilities: m.capabilities as never });
    const adapter = equipmentRegistry.getAdapter(cap.adapterKind);
    if (adapter.getState) {
      const st = await adapter.getState({});
      const packml = asPackmlState(st.state);
      if (packml) rc.states.set(machineId, packml);
    }
    const samples = await adapter.readTelemetry({});
    for (const s of samples) rc.telemetry.set(`${machineId}|${s.key}`, s.value);
  } catch {
    // read failure → leave caches as-is; conditions fail-closed.
  }
}

// ── command building (mirrors api/v1 buildCommand; HITL trigger synthesized) ─────

/**
 * Doc 25 T1 — actionId hợp lệ cho lệnh FOE. Trước đây FOE gắn `foe-<key>` KHÔNG tồn
 * tại trong ai_pending_actions → dispatcher OT tái-xác-minh và TỪ CHỐI (NOT_CONFIRMED);
 * test cũ chỉ xanh vì mock dispatcher. Giờ FOE tạo bản ghi ai_pending_actions CONFIRMED
 * thật với đúng id này (ensureOrchestrationAction) nên cả cổng OT lẫn robot đều qua HỢP LỆ.
 * id là khóa chính ai_pending_actions (varchar 64) → cắt cho vừa.
 */
function orchestrationActionId(idempotencyKey: string): string {
  const id = `foe-${idempotencyKey}`;
  return id.length <= 64 ? id : id.slice(0, 64);
}

/**
 * Tạo (idempotent, fail-safe) một bản ghi ai_pending_actions ĐÃ CONFIRMED cho một
 * bước lệnh của run — chủ sở hữu là user đã khởi động run. Đây là ủy quyền THẬT mà
 * dispatcher OT/robot tái-xác-minh (status confirmed/executed + đúng owner) trước khi
 * ghi. Dùng status 'executed' (terminal) nên KHÔNG lọt vào action inbox (inbox chỉ hiện
 * 'proposed'). Lỗi tạo bản ghi → nuốt: bản ghi không có ⇒ dispatcher fail-closed (từ chối),
 * an toàn hơn là để lệnh lọt.
 */
async function ensureOrchestrationAction(
  user: FoeUser,
  idempotencyKey: string,
  step: WorkflowStep,
  args: Record<string, unknown>,
): Promise<void> {
  try {
    const d = await getDb();
    if (!d) return;
    const actionId = orchestrationActionId(idempotencyKey);
    const [existing] = await d
      .select()
      .from(aiPendingActions)
      .where(eq(aiPendingActions.id, actionId))
      .limit(1);
    if (existing) return; // resume/retry → tái dùng bản ghi cũ
    await d.insert(aiPendingActions).values({
      id: actionId,
      tool: "foe.orchestration",
      argsJson: args ?? {},
      userId: user.id || 0,
      userRole: user.role || "system",
      summary: `FOE orchestration: step ${step.id}`,
      status: "executed",
      idempotencyKey: actionId,
      expiresAt: new Date(Date.now() + 3_600_000),
      executedAt: new Date(),
    });
  } catch {
    // fail-safe: không tạo được ⇒ cổng dispatcher sẽ fail-closed (an toàn).
  }
}

function buildEquipmentCommand(
  descriptor: CommandDescriptor,
  capability: EquipmentCapability,
  machineId: number,
  args: Record<string, unknown>,
  idempotencyKey: string,
  user: FoeUser,
): EquipmentCommand {
  const isRobot = capability.adapterKind === "robot" || capability.adapterKind === "vda5050";
  const cmd: EquipmentCommand = {
    name: descriptor.name,
    machineId,
    idempotencyKey,
    // FOE is an automated multi-step actor; the dispatcher STILL applies its dry-run
    // gate. actionId TRỎ tới bản ghi ai_pending_actions confirmed thật (ensureOrchestrationAction);
    // requestedBy/confirmedBy = user đã khởi động run (owner của bản ghi) → cổng OT/robot qua hợp lệ.
    hitl: {
      actionId: orchestrationActionId(idempotencyKey),
      requestedBy: user.id || 0,
      confirmedBy: user.id || 0,
    },
  };
  if (isRobot) {
    cmd.robotId = typeof args.robotId === "number" ? args.robotId : machineId;
    if (descriptor.name === "run_job" && typeof args.jobType === "string") {
      cmd.job = { jobType: args.jobType as never, params: (args.params as Record<string, unknown>) ?? {} };
    }
  } else {
    cmd.adapterId = typeof args.adapterId === "number" ? args.adapterId : machineId;
    if (Array.isArray(args.writes)) {
      cmd.writes = (args.writes as Array<{ tagKey: string; value: unknown }>).filter(
        (w) => w && typeof w.tagKey === "string",
      );
    } else if (typeof args.tagKey === "string") {
      cmd.writes = [{ tagKey: args.tagKey, value: args.value }];
    }
  }
  return cmd;
}

// ── the step walker ───────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

/** Run a precondition/interlock for a step. Returns null if it holds, else an outcome. */
async function checkPrecondition(rc: RunContext, step: WorkflowStep): Promise<StepOutcome | null> {
  if (!step.precondition) return null;
  // refresh any machine readbacks the condition needs
  await refreshConditionReadbacks(rc, step.precondition);
  const ok = evaluateCondition(step.precondition, evalCtxOf(rc));
  if (ok) return null;
  const mode = step.onPreconditionFail ?? "hold";
  if (mode === "skip") return { kind: "skipped" };
  if (mode === "abort") return { kind: "aborted", error: `Precondition failed for step "${step.id}" (abort).` };
  return { kind: "failed", error: `Precondition (interlock) failed for step "${step.id}" (hold).` };
}

async function refreshConditionReadbacks(rc: RunContext, c: Condition | undefined): Promise<void> {
  if (!c) return;
  const ids = new Set<number>();
  collect(c, ids);
  for (const id of ids) await refreshReadbacks(rc, id);
  function collect(cond: Condition, acc: Set<number>): void {
    const comp = cond as { all?: Condition[]; any?: Condition[]; not?: Condition };
    if (comp.all || comp.any || comp.not) {
      (comp.all ?? []).forEach((x) => collect(x, acc));
      (comp.any ?? []).forEach((x) => collect(x, acc));
      if (comp.not) collect(comp.not, acc);
      return;
    }
    const leaf = cond as { source?: string; machineId?: number };
    if ((leaf.source === "telemetry" || leaf.source === "state") && typeof leaf.machineId === "number") {
      acc.add(leaf.machineId);
    }
  }
}

/** Execute ONE step subtree. Persists state; routes commands via E0. Fail-safe. */
async function execStep(rc: RunContext, step: WorkflowStep): Promise<StepOutcome> {
  if (rc.aborting) return { kind: "aborted", error: "Run is aborting." };

  // Doc 25 T1 — RESUME idempotent: bước đã hoàn tất ở lần chạy trước thì KHÔNG chạy lại.
  // Tránh tái-dispatch lệnh OT (mất idempotency khi OT thật) và tránh re-pause gate đã
  // duyệt — áp cho MỌI loại bước, kể cả gate/lệnh lồng trong parallel/branch/sequence.
  if (rc.completed.has(step.id)) {
    return { kind: "ok" };
  }

  // Precondition / interlock
  const pre = await checkPrecondition(rc, step);
  if (pre) {
    if (pre.kind === "skipped") {
      await upsertStep(rc.runId, step.id, step.type, { status: "skipped", finishedAt: new Date() });
    } else {
      await upsertStep(rc.runId, step.id, step.type, {
        status: pre.kind === "aborted" ? "failed" : "held",
        error: "error" in pre ? pre.error : null,
        finishedAt: new Date(),
      });
    }
    return pre;
  }

  await upsertStep(rc.runId, step.id, step.type, { status: "running", startedAt: new Date() });

  let outcome: StepOutcome;
  const maxAttempts = Math.max(1, (step.maxAttempts ?? 0) + 1);
  let attempt = 0;
  // retry loop (deterministic; only command/wait steps benefit, others run once)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    outcome = await runStepBody(rc, step, attempt);
    if (outcome.kind !== "failed" || attempt >= maxAttempts) break;
  }

  // persist terminal step state (paused steps stay 'awaiting_confirm'/'held')
  if (outcome.kind === "ok") {
    await upsertStep(rc.runId, step.id, step.type, { status: "completed", attempt, finishedAt: new Date() });
  } else if (outcome.kind === "skipped") {
    await upsertStep(rc.runId, step.id, step.type, { status: "skipped", attempt, finishedAt: new Date() });
  } else if (outcome.kind === "paused") {
    // step-level status already set by the body (awaiting_confirm)
  } else {
    // failed / aborted → run compensation if declared
    await upsertStep(rc.runId, step.id, step.type, {
      status: "failed",
      attempt,
      error: "error" in outcome ? outcome.error : null,
      finishedAt: new Date(),
    });
    if (step.compensation) {
      await runCompensation(rc, step);
    }
  }
  return outcome;
}

/** Run the inner logic of a single step (after precondition + status=running). */
async function runStepBody(rc: RunContext, step: WorkflowStep, attempt: number): Promise<StepOutcome> {
  try {
    switch (step.type) {
      case "command":
        return await execCommand(rc, step, attempt);
      case "delay":
        await sleep(step.ms);
        return { kind: "ok" };
      case "sequence":
        return await execSequence(rc, step.steps);
      case "parallel":
        return await execParallel(rc, step.steps, step.failFast === true);
      case "branch": {
        // Doc 25 T1 — RESUME: nếu nhánh đã chọn ở lần chạy trước (persist trong context),
        // GIỮ nguyên nhánh đó để re-enter đúng đường-dẫn đã đi (idempotent), không đánh giá
        // lại điều kiện (telemetry có thể đã đổi → tránh nhảy sang nhánh khác nửa chừng).
        const prior = rc.context[`branch:${step.id}`];
        let take: boolean;
        if (prior === "then" || prior === "else") {
          take = prior === "then";
        } else {
          await refreshConditionReadbacks(rc, step.condition);
          take = evaluateCondition(step.condition, evalCtxOf(rc));
          rc.context[`branch:${step.id}`] = take ? "then" : "else";
        }
        await upsertStep(rc.runId, step.id, step.type, {
          status: "running",
          result: { branch: take ? "then" : "else" },
        });
        const path = take ? step.then : step.else ?? [];
        return await execSequence(rc, path);
      }
      case "wait_state":
        return await execWaitState(rc, step);
      case "wait_telemetry":
        return await execWaitTelemetry(rc, step);
      case "hitl_gate": {
        // pause the run; persist step as awaiting_confirm; resumeRun continues it.
        await upsertStep(rc.runId, step.id, step.type, {
          status: "awaiting_confirm",
          result: { prompt: step.prompt, approverRoles: step.approverRoles ?? null },
        });
        rc.pausedAtStepId = step.id;
        return { kind: "paused", stepId: step.id };
      }
      default:
        return { kind: "failed", error: `Unknown step type "${(step as { type?: string }).type}".` };
    }
  } catch (err) {
    // FAIL-SAFE — a step throwing never crashes the executor.
    return { kind: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

async function execCommand(rc: RunContext, step: Extract<WorkflowStep, { type: "command" }>, attempt: number): Promise<StepOutcome> {
  const m = rc.machineById.get(step.machineId);
  if (!m) return { kind: "failed", error: `Machine ${step.machineId} not found.` };
  const cap = getCapabilitiesForMachine({ machineType: m.machineType, capabilities: m.capabilities as never });
  const descriptor = cap.supportedCommands.find((c) => c.name === step.command);
  if (!descriptor) {
    return { kind: "failed", error: `Command "${step.command}" not supported by machine ${step.machineId}.` };
  }
  const idempotencyKey = `run${rc.runId}-${step.id}-a${attempt}`;
  // Doc 25 T1 — tạo ủy quyền ai_pending_actions confirmed THẬT trước khi dispatch để
  // cổng HITL của dispatcher (OT/robot) tái-xác-minh và cho qua HỢP LỆ (không còn phụ
  // thuộc mock). Fail-safe: nếu không tạo được, dispatcher fail-closed từ chối.
  await ensureOrchestrationAction(rc.user, idempotencyKey, step, step.args ?? {});
  const cmd = buildEquipmentCommand(descriptor, cap, step.machineId, step.args ?? {}, idempotencyKey, rc.user);

  // ROUTE THROUGH E0 → existing HITL/dry-run dispatcher. NEVER a direct device path.
  const adapter = equipmentRegistry.getAdapter(cap.adapterKind);
  const result: EquipmentCommandResult = await adapter.sendCommand(cmd);

  await upsertStep(rc.runId, step.id, step.type, {
    status: "running",
    result: {
      routedTo: result.routedTo,
      status: result.status,
      accepted: result.ok,
      simulated: result.detail?.simulated ?? undefined,
      detail: result.detail ?? null,
    },
  });

  if (!result.ok) {
    return { kind: "failed", error: result.error ?? `Command "${step.command}" rejected (${result.status}).` };
  }
  return { kind: "ok" };
}

async function execSequence(rc: RunContext, steps: WorkflowStep[]): Promise<StepOutcome> {
  for (const child of steps) {
    const out = await execStep(rc, child);
    if (out.kind === "paused" || out.kind === "failed" || out.kind === "aborted") return out;
    // 'ok' / 'skipped' → continue
  }
  return { kind: "ok" };
}

async function execParallel(rc: RunContext, steps: WorkflowStep[], failFast: boolean): Promise<StepOutcome> {
  const results = await Promise.allSettled(steps.map((s) => execStep(rc, s)));
  const outcomes: StepOutcome[] = results.map((r) =>
    r.status === "fulfilled" ? r.value : { kind: "failed", error: String(r.reason) },
  );
  // A hitl_gate inside a parallel branch pauses the whole run.
  const paused = outcomes.find((o) => o.kind === "paused");
  if (paused) return paused;
  const aborted = outcomes.find((o) => o.kind === "aborted");
  if (aborted) return aborted;
  const failures = outcomes.filter((o) => o.kind === "failed") as Array<{ kind: "failed"; error: string }>;
  if (failures.length > 0) {
    if (failFast || failures.length === outcomes.length) {
      return { kind: "failed", error: `Parallel branch failed: ${failures.map((f) => f.error).join("; ")}` };
    }
  }
  return { kind: "ok" };
}

async function execWaitState(rc: RunContext, step: Extract<WorkflowStep, { type: "wait_state" }>): Promise<StepOutcome> {
  const deadline = Date.now() + step.timeoutMs;
  const pollMs = Math.max(1, step.pollMs ?? Math.min(250, step.timeoutMs));
  const targets = new Set<string>(step.targetStates as string[]);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await refreshReadbacks(rc, step.machineId);
    const current = rc.states.get(step.machineId);
    if (current && targets.has(current)) {
      await upsertStep(rc.runId, step.id, step.type, { status: "running", result: { reachedState: current } });
      return { kind: "ok" };
    }
    if (Date.now() >= deadline) {
      return { kind: "failed", error: `wait_state timeout (machine ${step.machineId} state="${current ?? "?"}").` };
    }
    await sleep(pollMs);
  }
}

async function execWaitTelemetry(rc: RunContext, step: Extract<WorkflowStep, { type: "wait_telemetry" }>): Promise<StepOutcome> {
  const deadline = Date.now() + step.timeoutMs;
  const pollMs = Math.max(1, step.pollMs ?? Math.min(250, step.timeoutMs));
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await refreshConditionReadbacks(rc, step.condition);
    if (evaluateCondition(step.condition, evalCtxOf(rc))) {
      await upsertStep(rc.runId, step.id, step.type, { status: "running", result: { satisfied: true } });
      return { kind: "ok" };
    }
    if (Date.now() >= deadline) {
      return { kind: "failed", error: `wait_telemetry timeout for step "${step.id}".` };
    }
    await sleep(pollMs);
  }
}

/** Run a step's compensation (saga undo). Fail-safe — records but never throws. */
async function runCompensation(rc: RunContext, step: WorkflowStep): Promise<void> {
  if (!step.compensation) return;
  try {
    await setRunStatus(rc.runId, "compensating");
    const comp = step.compensation;
    // run the compensation step body once (no nested compensation cascade)
    await upsertStep(rc.runId, comp.id, comp.type, { status: "running", startedAt: new Date() });
    const out = await runStepBody(rc, comp, 1);
    await upsertStep(rc.runId, comp.id, comp.type, {
      status: out.kind === "ok" ? "compensated" : "failed",
      error: "error" in out ? out.error : null,
      finishedAt: new Date(),
    });
  } catch {
    // swallow — compensation failures must not crash the run unwind.
  }
}

// ── run driver: walk the top-level sequence from a resume point ──────────────────

/**
 * Drive the run: walk the top-level steps. Returns the terminal/paused run status.
 * Resume re-enters here; a hitl_gate that was just approved is treated as 'completed'
 * and the walk continues PAST it (the gate's id is recorded as resolved in context).
 */
async function driveRun(rc: RunContext): Promise<OrchestrationRun["status"]> {
  await setRunStatus(rc.runId, "running", { startedAt: new Date() });
  const out = await execSequence(rc, rc.def.steps);

  if (out.kind === "paused") {
    await setRunStatus(rc.runId, "awaiting_confirm", { currentStepId: out.stepId });
    await persistContext(rc);
    return "awaiting_confirm";
  }
  if (out.kind === "aborted") {
    await setRunStatus(rc.runId, "aborted", { finishedAt: new Date(), error: "error" in out ? out.error : null });
    await persistContext(rc);
    return "aborted";
  }
  if (out.kind === "failed") {
    await setRunStatus(rc.runId, "failed", { finishedAt: new Date(), error: "error" in out ? out.error : null });
    await persistContext(rc);
    return "failed";
  }
  await setRunStatus(rc.runId, "completed", { finishedAt: new Date() });
  await persistContext(rc);
  return "completed";
}

/**
 * Build a RunContext from a persisted run + its workflow. Loads referenced machines and
 * the set of steps ĐÃ HOÀN TẤT (từ _run_steps) để RESUME idempotent (execStep bỏ qua
 * chúng). Với run mới, _run_steps rỗng → completed rỗng → hành vi không đổi.
 */
async function buildRunContext(
  run: OrchestrationRun,
  def: WorkflowDefinition,
  user: FoeUser,
): Promise<RunContext> {
  const validation = validateWorkflow(def, null);
  const machineMap = await loadMachines(validation.referencedMachineIds);
  const context = (run.contextJson as Record<string, unknown>) ?? {};
  const telemetry = new Map<string, unknown>(
    Object.entries((context.telemetry as Record<string, unknown>) ?? {}),
  );
  const states = new Map<number, string>(
    Object.entries((context.states as Record<string, string>) ?? {}).map(([k, v]) => [Number(k), v]),
  );
  const completed = await loadCompletedSteps(run.id);
  return {
    runId: run.id,
    def,
    params: (run.paramsJson as Record<string, unknown>) ?? {},
    context,
    user,
    machineById: machineMap,
    telemetry,
    states,
    completed,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Deploy (validate + persist) a workflow definition. Upserts by ref (bumps version).
 * Flag-gated: FOE_ENABLED off → a disabled result (no persistence).
 */
export async function deployWorkflow(def: WorkflowDefinition, user: FoeUser): Promise<DeployResult> {
  if (!foeEnabled()) {
    return { ok: false, enabled: false, message: "FOE is disabled (set FOE_ENABLED=true)." };
  }
  try {
    // structural validation first (no machines)
    const structural = validateWorkflow(def, null);
    if (!structural.ok) return { ok: false, enabled: true, errors: structural.errors };

    // semantic validation against the referenced machines
    const machineMap = await loadMachines(structural.referencedMachineIds);
    const full = validateWorkflow(def, [...machineMap.values()]);
    if (!full.ok) return { ok: false, enabled: true, errors: full.errors };

    const d = await db();
    const existing = await d
      .select()
      .from(orchestrationWorkflows)
      .where(eq(orchestrationWorkflows.ref, def.ref))
      .limit(1);
    const nextVersion = existing.length ? (existing[0].version ?? 1) + 1 : def.version ?? 1;
    const definitionJson: WorkflowDefinition = { ...def, version: nextVersion };

    let workflowId: number;
    if (existing.length) {
      await d
        .update(orchestrationWorkflows)
        .set({
          name: def.name,
          description: def.description ?? null,
          definitionJson,
          version: nextVersion,
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(orchestrationWorkflows.id, existing[0].id));
      workflowId = existing[0].id;
    } else {
      const [row] = await d
        .insert(orchestrationWorkflows)
        .values({
          ref: def.ref,
          name: def.name,
          description: def.description ?? null,
          definitionJson,
          version: nextVersion,
          status: "active",
          createdBy: user.id || null,
        })
        .returning();
      workflowId = row.id;
    }

    // W3-11 — SNAPSHOT this version (append-only) so the head-row overwrite above no
    // longer loses history; enables version diff + rollback in the Studio.
    await snapshotWorkflowVersion(d, {
      workflowId,
      ref: def.ref,
      version: nextVersion,
      name: def.name,
      description: def.description ?? null,
      definitionJson,
      createdBy: user.id || null,
    });

    return { ok: true, enabled: true, workflowId, ref: def.ref, version: nextVersion };
  } catch (err) {
    return { ok: false, enabled: true, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * W3-11 — persist a version snapshot (best-effort; a snapshot failure must NOT fail
 * the deploy — the head row is already written and startRun uses that). Records at
 * most one row per (workflowId, version); a duplicate is swallowed.
 */
async function snapshotWorkflowVersion(
  d: Awaited<ReturnType<typeof db>>,
  snap: {
    workflowId: number;
    ref: string;
    version: number;
    name: string;
    description: string | null;
    definitionJson: WorkflowDefinition;
    createdBy: number | null;
  },
): Promise<void> {
  try {
    const dupes = await d
      .select()
      .from(orchestrationWorkflowVersions)
      .where(eq(orchestrationWorkflowVersions.workflowId, snap.workflowId));
    if (dupes.some((v) => v.version === snap.version)) return; // đã snapshot version này
    await d.insert(orchestrationWorkflowVersions).values(snap);
  } catch {
    // best-effort — không chặn deploy nếu bảng versions chưa có (migration chưa chạy).
  }
}

/**
 * W3-11 — ROLL BACK a workflow to an earlier snapshotted version by RE-DEPLOYING that
 * version's definition as a NEW version (append-only; never mutates history). Routes
 * through the same validated + flag-gated deployWorkflow path.
 */
export async function rollbackWorkflow(
  workflowId: number,
  version: number,
  user: FoeUser,
): Promise<DeployResult> {
  if (!foeEnabled()) {
    return { ok: false, enabled: false, message: "FOE is disabled (set FOE_ENABLED=true)." };
  }
  const d = await db();
  const snaps = await d
    .select()
    .from(orchestrationWorkflowVersions)
    .where(eq(orchestrationWorkflowVersions.workflowId, workflowId));
  const target = snaps.find((s) => s.version === version);
  if (!target) {
    return { ok: false, enabled: true, message: `No snapshot for workflow ${workflowId} version ${version}.` };
  }
  // Re-deploy the old definition → bumps to a fresh version with the old content.
  return deployWorkflow(target.definitionJson as WorkflowDefinition, user);
}

/**
 * Start a run of a deployed workflow (by ref). Creates the run row, then kicks the
 * executor. The executor is fail-safe — any error transitions the run to 'failed'.
 * Flag-gated.
 *
 * MODES (W4-17 · durable execution):
 *   • DEFAULT (đồng bộ) — drive tới khi run đạt trạng thái terminal/paused rồi mới trả
 *     về (awaitable). Đây là hành vi hiện có mà router + toàn bộ FOE test đang dựa vào —
 *     GIỮ NGUYÊN, không đổi chữ ký gọi mặc định.
 *   • opts.async === true (OPT-IN) — tạo run 'queued', TRẢ runId NGAY, rồi drive nền
 *     trong-tiến-trình qua setImmediate (không block request tRPC). Fail-safe: lỗi nền
 *     đưa run về 'failed'. Nếu tiến trình chết giữa chừng, rehydrateInterruptedRuns()
 *     lúc khởi động lại sẽ đánh dấu run 'interrupted' (không kẹt im lặng).
 */
export async function startRun(
  workflowRef: string,
  params: Record<string, unknown>,
  user: FoeUser,
  opts?: { async?: boolean },
): Promise<StartRunResult> {
  if (!foeEnabled()) {
    return { ok: false, enabled: false, message: "FOE is disabled (set FOE_ENABLED=true)." };
  }
  let runId: number | undefined;
  try {
    const d = await db();
    const [wf] = await d
      .select()
      .from(orchestrationWorkflows)
      .where(eq(orchestrationWorkflows.ref, workflowRef))
      .limit(1);
    if (!wf) return { ok: false, enabled: true, message: `Workflow "${workflowRef}" not found.` };

    const def = wf.definitionJson as WorkflowDefinition;
    const [run] = await d
      .insert(orchestrationRuns)
      .values({
        workflowId: wf.id,
        workflowRef: wf.ref,
        status: "queued",
        paramsJson: params ?? {},
        contextJson: {},
        startedBy: user.id || null,
        startedAt: new Date(),
      })
      .returning();
    runId = run.id;

    // OPT-IN async: tách drive khỏi request. Trả 'queued' + runId ngay; drive nền.
    if (opts?.async) {
      const asyncRunId = run.id;
      setImmediate(() => {
        void (async () => {
          try {
            const rc = await buildRunContext(run, def, user);
            await driveRun(rc);
          } catch (err) {
            // FAIL-SAFE — drive nền không được ném ra ngoài (không có ai await).
            const message = err instanceof Error ? err.message : String(err);
            await setRunStatus(asyncRunId, "failed", { finishedAt: new Date(), error: message }).catch(() => undefined);
          }
        })();
      });
      return { ok: true, enabled: true, runId: run.id, status: "queued" };
    }

    const rc = await buildRunContext(run, def, user);
    const status = await driveRun(rc);
    return { ok: status !== "failed" && status !== "aborted", enabled: true, runId: run.id, status };
  } catch (err) {
    // FAIL-SAFE — never throw to the caller; mark the run failed if we created it.
    const message = err instanceof Error ? err.message : String(err);
    if (runId != null) {
      await setRunStatus(runId, "failed", { finishedAt: new Date(), error: message }).catch(() => undefined);
    }
    return { ok: false, enabled: true, runId, status: "failed", message };
  }
}

/** Fetch a run + its per-step audit (read-only). */
export async function getRun(runId: number): Promise<RunView | null> {
  const d = await getDb();
  if (!d) return null;
  const [run] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
  if (!run) return null;
  const stepRows = await d
    .select()
    .from(orchestrationRunSteps)
    .where(eq(orchestrationRunSteps.runId, runId));
  return {
    run,
    steps: stepRows.map((s) => ({
      stepId: s.stepId,
      stepType: s.stepType,
      status: s.status,
      attempt: s.attempt,
      result: (s.resultJson as Record<string, unknown>) ?? null,
      error: s.error ?? null,
      startedAt: s.startedAt ?? null,
      finishedAt: s.finishedAt ?? null,
    })),
  };
}

/**
 * Resume a run paused at a hitl_gate (awaiting_confirm) or held. A decision of
 * {approved:false} aborts the run. On approval, the gate step is marked completed and
 * the walk re-runs from the top (already-completed steps are idempotent / re-dispatch
 * is dry-run-safe; the gate is skipped because it is now resolved). Flag-gated.
 */
export async function resumeRun(
  runId: number,
  decision: GateDecision,
  user: FoeUser,
): Promise<StartRunResult> {
  if (!foeEnabled()) {
    return { ok: false, enabled: false, message: "FOE is disabled (set FOE_ENABLED=true)." };
  }
  try {
    const d = await db();
    const [run] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
    if (!run) return { ok: false, enabled: true, message: `Run ${runId} not found.` };
    if (run.status !== "awaiting_confirm" && run.status !== "held") {
      return { ok: false, enabled: true, runId, status: run.status, message: `Run ${runId} is not resumable (status=${run.status}).` };
    }
    const gateStepId = run.currentStepId ?? undefined;

    if (!decision.approved) {
      // U6 (doc 26) — kèm lý do từ chối (note) vào audit của run + bước để truy vết.
      const reason = decision.note?.trim();
      await setRunStatus(runId, "aborted", {
        finishedAt: new Date(),
        error: `Gate "${gateStepId ?? "?"}" rejected by user ${user.id}.${reason ? ` Reason: ${reason}` : ""}`,
      });
      if (gateStepId) {
        const [wf2] = await d.select().from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, run.workflowId)).limit(1);
        await upsertStep(runId, gateStepId, "hitl_gate", {
          status: "failed",
          error: reason ? `Rejected: ${reason}` : "Rejected",
          result: { approved: false, note: reason ?? null, rejectedBy: user.id },
          finishedAt: new Date(),
        }).catch(() => undefined);
        void wf2;
      }
      return { ok: false, enabled: true, runId, status: "aborted" };
    }

    const [wf] = await d.select().from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, run.workflowId)).limit(1);
    if (!wf) return { ok: false, enabled: true, message: `Workflow ${run.workflowId} not found.` };
    const def = wf.definitionJson as WorkflowDefinition;

    // mark the gate resolved (completed) so the re-walk skips it
    if (gateStepId) {
      await upsertStep(runId, gateStepId, "hitl_gate", {
        status: "completed",
        result: { approved: true, note: decision.note ?? null, approvedBy: user.id },
        finishedAt: new Date(),
      });
    }

    // buildRunContext nạp rc.completed từ _run_steps (đã gồm gate vừa đánh dấu completed
    // ở trên + mọi bước đã xong lần trước) → execStep bỏ qua chúng khi đi lại.
    const rc = await buildRunContext(run, def, user);
    const status = await driveRunFromResume(rc);
    return { ok: status !== "failed" && status !== "aborted", enabled: true, runId, status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setRunStatus(runId, "failed", { finishedAt: new Date(), error: message }).catch(() => undefined);
    return { ok: false, enabled: true, runId, status: "failed", message };
  }
}

/**
 * Đường RESUME. KHÔNG reset startedAt. Đi lại từ đầu bằng execSequence THƯỜNG: mọi bước
 * đã hoàn tất (gồm gate vừa duyệt) nằm trong rc.completed nên execStep bỏ qua — không
 * tái-dispatch lệnh, không re-pause gate đã duyệt, kể cả gate lồng trong parallel/branch.
 * Gate CHƯA duyệt (nếu có) sẽ pause lại như thường.
 */
async function driveRunFromResume(rc: RunContext): Promise<OrchestrationRun["status"]> {
  await setRunStatus(rc.runId, "running");
  const out = await execSequence(rc, rc.def.steps);

  if (out.kind === "paused") {
    await setRunStatus(rc.runId, "awaiting_confirm", { currentStepId: out.stepId });
    await persistContext(rc);
    return "awaiting_confirm";
  }
  if (out.kind === "aborted") {
    await setRunStatus(rc.runId, "aborted", { finishedAt: new Date(), error: "error" in out ? out.error : null });
    await persistContext(rc);
    return "aborted";
  }
  if (out.kind === "failed") {
    await setRunStatus(rc.runId, "failed", { finishedAt: new Date(), error: "error" in out ? out.error : null });
    await persistContext(rc);
    return "failed";
  }
  await setRunStatus(rc.runId, "completed", { finishedAt: new Date() });
  await persistContext(rc);
  return "completed";
}

// ── W4-17 — DURABLE EXECUTION: rehydrate-on-boot ─────────────────────────────────

export interface RehydrateResult {
  enabled: boolean;
  /** Số run ĐANG-CHẠY (không phải wait bền vững) phát hiện lúc khởi động. */
  scanned: number;
  /** Số run được đánh dấu 'interrupted' dạng RESUMABLE (status 'held'). */
  interrupted: number;
  /** Số run được đưa về terminal 'failed' (đang compensating → không tự tiếp tục được). */
  failed: number;
  runIds: number[];
  /** doc 33 I5 — số run được AUTO-resume (chỉ khi FOE_DURABLE). undefined nếu không bật. */
  autoResumed?: number;
}

/**
 * doc 33 I5 (F8 §5.1.6) — AUTO-continue interrupted runs. For each run that rehydrate marked
 * 'held' with context.interrupted, re-drive it via the proven idempotent resumeRun (re-walk from
 * the resume point; already-completed steps are idempotent, re-dispatch is dry-run-safe). Only
 * touches interrupted runs — a human gate ('awaiting_confirm', or 'held' WITHOUT interrupted) is
 * left for a person. No-op unless FOE_DURABLE && FOE_ENABLED. Best-effort; never throws on boot.
 */
export async function autoResumeInterruptedRuns(runIds: number[]): Promise<{ enabled: boolean; resumed: number; runIds: number[] }> {
  if (!foeDurableEnabled() || !foeEnabled()) return { enabled: false, resumed: 0, runIds: [] };
  const resumed: number[] = [];
  try {
    const d = await getDb();
    if (!d) return { enabled: true, resumed: 0, runIds: [] };
    for (const runId of runIds) {
      const [run] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
      if (!run || run.status !== "held") continue; // skip failed/terminal
      const ctx = (run.contextJson as Record<string, unknown>) ?? {};
      if (ctx.interrupted !== true) continue; // NEVER auto-resume a human gate
      const res = await resumeRun(runId, { approved: true, note: "auto-resume (FOE_DURABLE)" }, SYSTEM_FOE_USER);
      if (res.ok) resumed.push(runId);
    }
  } catch (err) {
    console.error("[FOE] autoResumeInterruptedRuns failed:", err instanceof Error ? err.message : String(err));
  }
  return { enabled: true, resumed: resumed.length, runIds: resumed };
}

/**
 * W4-17 — REHYDRATE khi server khởi động. driveRun/resumeRun chạy TRONG-TIẾN-TRÌNH; nếu
 * server chết giữa chừng, một run có thể kẹt ở trạng thái ĐANG-CHẠY mà KHÔNG còn driver
 * sống để tiếp tục. Hàm này quét các run như vậy và đánh dấu chúng "interrupted" để:
 *   • KHÔNG kẹt im lặng ở 'running'/'queued'/'compensating' mãi mãi;
 *   • cho phép RESUME THỦ CÔNG an toàn (idempotent) qua resumeRun (run 'held' là resumable;
 *     approve → đi lại bỏ qua bước đã hoàn tất, reject → abort).
 *
 * PHÂN LOẠI (an toàn trên hết):
 *   • 'queued' / 'running' → 'held' + cờ context.interrupted → RESUMABLE. Đi lại là idempotent
 *     (execStep bỏ qua bước đã 'completed'/'skipped'; với control OFF mọi dispatch là dry-run).
 *   • 'compensating' → 'failed' (terminal). Run đang UNWIND một lỗi; drive-lại về phía trước
 *     là KHÔNG an toàn, nên chốt terminal + ghi lý do.
 *   • 'awaiting_confirm' / 'held' → BỎ QUA. Đây là WAIT BỀN VỮNG chờ người — không cần
 *     rehydrate; một người sẽ resume qua resumeRun như thường.
 *
 * FAIL-SAFE tuyệt đối: KHÔNG bao giờ ném ra ngoài (không được chặn khởi động server). DB chưa
 * kết nối → trả kết quả rỗng. KHÔNG flag-gated: dọn cả run cũ tạo khi FOE còn bật.
 */
export async function rehydrateInterruptedRuns(): Promise<RehydrateResult> {
  const result: RehydrateResult = { enabled: foeEnabled(), scanned: 0, interrupted: 0, failed: 0, runIds: [] };
  try {
    const d = await getDb();
    if (!d) return result;
    // Các trạng thái ĐANG-CHẠY (không tự tiếp tục được sau restart). awaiting_confirm/held là
    // wait bền vững → cố ý loại trừ.
    const activeStatuses: OrchestrationRun["status"][] = ["queued", "running", "compensating"];
    const runsRows = await d
      .select()
      .from(orchestrationRuns)
      .where(inArray(orchestrationRuns.status, activeStatuses));
    // Lọc lại trong JS (chân lý cuối cùng) — chống mọi khác biệt where của driver.
    const stuck = runsRows.filter((r) => activeStatuses.includes(r.status));
    result.scanned = stuck.length;
    const now = new Date();
    for (const run of stuck) {
      const ctx = (run.contextJson as Record<string, unknown>) ?? {};
      const markedCtx = {
        ...ctx,
        interrupted: true,
        interruptedAt: now.toISOString(),
        interruptedFrom: run.status,
      };
      if (run.status === "compensating") {
        await setRunStatus(run.id, "failed", {
          finishedAt: now,
          error: `Interrupted by server restart while compensating (run ${run.id}); not auto-resumed.`,
          contextJson: markedCtx,
        });
        result.failed += 1;
      } else {
        // queued/running → resumable 'held'.
        await setRunStatus(run.id, "held", {
          error: `Interrupted by server restart (was ${run.status}); awaiting manual resume.`,
          contextJson: markedCtx,
        });
        result.interrupted += 1;
      }
      result.runIds.push(run.id);
    }
  } catch (err) {
    // nuốt — một lỗi rehydrate KHÔNG được chặn khởi động server.
    console.error("[FOE] rehydrateInterruptedRuns failed:", err instanceof Error ? err.message : String(err));
  }
  // doc 33 I5 (F8) — durable execution: when FOE_DURABLE, auto-continue the interrupted runs
  // instead of leaving them 'held' for manual resume. Default off → unchanged behavior.
  if (foeDurableEnabled() && result.runIds.length > 0) {
    const ar = await autoResumeInterruptedRuns(result.runIds);
    result.autoResumed = ar.resumed;
    if (ar.resumed > 0) console.log(`[FOE] durable: auto-resumed ${ar.resumed} interrupted run(s)`);
  }
  return result;
}

/** Abort a run (terminal). Records the reason; does not crash on a missing run. */
export async function abortRun(runId: number, user: FoeUser, reason?: string): Promise<StartRunResult> {
  try {
    const d = await getDb();
    if (!d) return { ok: false, enabled: foeEnabled(), runId, message: "DB unavailable." };
    const [run] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
    if (!run) return { ok: false, enabled: foeEnabled(), runId, message: `Run ${runId} not found.` };
    if (["completed", "failed", "aborted"].includes(run.status)) {
      return { ok: false, enabled: foeEnabled(), runId, status: run.status, message: `Run ${runId} already terminal.` };
    }
    await setRunStatus(runId, "aborted", {
      finishedAt: new Date(),
      error: reason ? `Aborted by user ${user.id}: ${reason}` : `Aborted by user ${user.id}.`,
    });
    return { ok: true, enabled: foeEnabled(), runId, status: "aborted" };
  } catch (err) {
    return { ok: false, enabled: foeEnabled(), runId, message: err instanceof Error ? err.message : String(err) };
  }
}
