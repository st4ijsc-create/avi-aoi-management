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
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { DbUnavailableError } from "../../../_core/dbErrors";
import { TRPCError } from "@trpc/server";
import { appError } from "../../../_core/appError";
import { and, eq, inArray, ne, notInArray } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { appendRunEvent } from "../runEventStore"; // doc 33 W4 (F8): durable RunEvent log (FOE_DURABLE)
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
  type HitlGateStep,
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

/**
 * doc 40 ENG-F4 (P0 tồn từ doc 22) — SIM-GATE cho deploy workflow FOE. Khi BẬT, deployWorkflow
 * CHỈ chấp nhận một definition ĐÃ mô phỏng ĐẠT (feasible) trên digital twin — bằng chứng là một
 * sim-token (HMAC) do orchestration.simulate phát hành cho ĐÚNG definition đó — TRỪ KHI có override
 * kèm lý do (được ghi audit). Mặc định OFF → hành vi cũ (không đổi gì, giữ green). Fail-closed:
 * bật mà không có sim-pass hợp lệ ⇒ TỪ CHỐI honest (an toàn hơn deploy mù). KHÔNG nới lỏng gate nào.
 */
export function foeSimGateRequired(): boolean {
  return process.env.FOE_SIM_GATE_REQUIRED === "true" || process.env.FOE_SIM_GATE_REQUIRED === "1";
}

/**
 * Bí mật ký sim-token. Ưu tiên env cố định (bền qua khởi-động-lại / đa-instance); nếu không có
 * thì sinh NGẪU NHIÊN mỗi tiến trình — token khi đó chỉ sống trong vòng đời tiến trình, và mất
 * token ⇒ deploy fail-closed (buộc mô phỏng lại) → hướng AN TOÀN, không nới lỏng.
 */
const SIM_TOKEN_SECRET =
  process.env.FOE_SIM_TOKEN_SECRET || process.env.SESSION_SECRET || randomBytes(32).toString("hex");

/** Canonical JSON (khóa sắp xếp, đệ quy) → hash ĐỊNH NGHĨA ổn định bất kể thứ tự khóa. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = canonicalize(obj[k]);
        return acc;
      }, {});
  }
  return value;
}

/** Hash ổn định (sha256) của một WorkflowDefinition — khóa dùng cho sim-gate binding. */
export function hashWorkflowDefinition(def: WorkflowDefinition): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(def))).digest("hex");
}

/**
 * Phát hành sim-token (HMAC) cho một definition ĐÃ mô phỏng ĐẠT. CHỈ gọi khi sim.ok === true
 * (router chịu trách nhiệm điều kiện đó). Token là attestation stateless: deployWorkflow xác minh
 * lại bằng cách tính lại HMAC trên định nghĩa được nộp — không cần DB/bộ nhớ trung gian.
 */
export function issueSimToken(def: WorkflowDefinition): string {
  const hash = hashWorkflowDefinition(def);
  return createHmac("sha256", SIM_TOKEN_SECRET).update(`simpass:${hash}`).digest("hex");
}

/** Xác minh sim-token khớp ĐÚNG definition (so sánh constant-time). Thiếu token → false. */
function verifySimToken(def: WorkflowDefinition, token: string | undefined | null): boolean {
  if (!token) return false;
  const expected = issueSimToken(def);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(token, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Ghi audit best-effort cho quyết định sim-gate ở deploy (từ chối / override). Fail-safe — lỗi
 * audit KHÔNG chặn deploy path. Dùng dynamic import để tránh coupling load-order.
 */
async function auditDeploySimGate(
  user: FoeUser,
  def: WorkflowDefinition,
  outcome: "rejected" | "override",
  reason: string | null,
): Promise<void> {
  try {
    const { logCrudOperation, createAuditContext } = await import("../../auditTrailService");
    await logCrudOperation(
      createAuditContext({ user: { id: user.id || 0, name: user.name ?? user.role } }),
      {
        action: "config_change",
        entityType: "orchestration_workflow",
        entityName: def.ref,
        details: {
          operation:
            outcome === "rejected" ? "foe_deploy_sim_gate_rejected" : "foe_deploy_sim_gate_override",
          metadata: { ref: def.ref, hash: hashWorkflowDefinition(def), reason },
        },
        status: outcome === "rejected" ? "failure" : "success",
      },
    );
  } catch {
    /* audit best-effort — không được chặn deploy */
  }
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

/** doc 40 ENG-F4 — tuỳ chọn deploy để đi qua sim-gate. */
export interface DeployOpts {
  /** Sim-token do orchestration.simulate phát hành cho ĐÚNG định nghĩa này (bằng chứng sim ĐẠT). */
  simToken?: string | null;
  /** Lý do override sim-gate (bắt buộc để bỏ qua khi gate BẬT mà không có token) — được ghi audit. */
  overrideReason?: string | null;
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

/**
 * doc 80 ORC-01 — handle of a run whose driver is ALIVE in THIS process. `abortRun` flips
 * `aborting` + fires `controller.abort()`; the walker checks the flag between steps and every
 * wait (`delay` / `wait_*` poll) receives the AbortSignal so it wakes up immediately.
 */
export interface LiveRunHandle {
  aborting: boolean;
  controller: AbortController;
}

/** runId → live driver handle (the RunContext itself). Entry removed when the driver returns. */
const liveRuns = new Map<number, LiveRunHandle>();

interface RunContext extends LiveRunHandle {
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
  if (!d) throw new DbUnavailableError();
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
  // doc 33 D1 (F8 §5.1.2) — durable RunEvent log: terminal run transitions (FOE_DURABLE, best-effort).
  if (status === "completed") void appendRunEvent(runId, "RUN_COMPLETED", { ts: Date.now() });
  else if (status === "failed" || status === "aborted") void appendRunEvent(runId, "RUN_FAILED", { ts: Date.now(), data: { status } });
}

/**
 * doc 80 ORC-01 — status write used by the DRIVER: a conditional UPDATE
 * `… WHERE id = $1 AND status <> 'aborted'`, so a run aborted meanwhile (by abortRun in this
 * process, or by any other instance straight in the DB) is NEVER overwritten back to
 * completed / failed / awaiting_confirm / compensating. Returns true iff the row was written.
 * DB unavailable → false (nothing written; the caller treats the run as not-its-to-finish).
 */
async function setRunStatusUnlessAborted(
  runId: number,
  status: OrchestrationRun["status"],
  patch: Partial<OrchestrationRun> = {},
): Promise<boolean> {
  const d = await getDb();
  if (!d) return false;
  const written = await d
    .update(orchestrationRuns)
    .set({ status, updatedAt: new Date(), ...patch })
    .where(and(eq(orchestrationRuns.id, runId), ne(orchestrationRuns.status, "aborted")))
    .returning({ id: orchestrationRuns.id });
  if (written.length === 0) return false;
  if (status === "completed") void appendRunEvent(runId, "RUN_COMPLETED", { ts: Date.now() });
  else if (status === "failed" || status === "aborted") void appendRunEvent(runId, "RUN_FAILED", { ts: Date.now(), data: { status } });
  return true;
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
  // doc 33 D1 (F8) — durable RunEvent log: step transitions (FOE_DURABLE, best-effort).
  const stepEvt =
    patch.status === "running"
      ? "TASK_STARTED"
      : patch.status === "completed"
        ? "TASK_COMPLETED"
        : patch.status === "failed"
          ? "TASK_FAILED"
          : null;
  if (stepEvt) void appendRunEvent(runId, stepEvt, { taskId: stepId, ts: Date.now() });
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

/**
 * Sleep that WAKES EARLY when `signal` aborts (doc 80 ORC-01). Resolves (never rejects) — the
 * caller re-checks `rc.aborting` right after, so an abort turns into an 'aborted' outcome.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, ms));
    signal?.addEventListener("abort", done, { once: true });
  });
}

const ABORTED_OUTCOME: StepOutcome = { kind: "aborted", error: "Run is aborting." };

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
    // doc 80 ORC-01 — a USER abort must not dispatch anything after the abort instant, so the
    // saga compensation (which issues commands) is NOT run while the run is aborting.
    if (step.compensation && !rc.aborting) {
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
        await sleep(step.ms, rc.controller.signal);
        if (rc.aborting) return ABORTED_OUTCOME;
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
    // data-raw-ok: `kind: "failed"` ĐÃ là mã; chuỗi là lỗi của MỘT BƯỚC trong quy trình.
    // Người đọc là kỹ sư đang dựng quy trình và cần biết bước nào hỏng vì sao.
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

  // W3-B2 (doc 44 G3.14) — "MỘT CỬA": mọi bước lệnh FOE qua policy seam TRƯỚC khi tạo
  // ủy quyền/dispatch. SEC_PLATFORM OFF (mặc định) → bỏ qua hoàn toàn (hành vi cũ).
  // DENY → bước FAIL với lý do honest và đi vào flow tự nhiên của engine (retry-budget
  // → compensation qua execStep) — KHÔNG BAO GIỜ throw sập run-loop (runStepBody đã bọc
  // try/catch, và ta return outcome chứ không throw). require_approval → FOE không có
  // kênh phê duyệt per-step ngoài hitl_gate khai báo trong workflow ⇒ reject honest
  // POLICY_APPROVAL_REQUIRED (tác giả workflow thêm hitl_gate TRƯỚC bước lệnh nếu muốn).
  {
    const { evaluateActionPolicy, secPlatformEnabled } = await import("../../security/policyGate");
    if (secPlatformEnabled()) {
      const verdict = evaluateActionPolicy(
        `foe-run:${rc.runId}`,
        `foe.command.${step.command}`,
        `machine:${step.machineId}`,
        {
          runId: rc.runId,
          workflowRef: rc.def.ref,
          stepId: step.id,
          stepType: step.type,
          command: step.command,
          machineId: step.machineId,
          role: rc.user.role,
          startedBy: rc.user.id,
          attempt,
        },
        { requestId: idempotencyKey },
      );
      if (!verdict.allow) {
        const code = verdict.effect === "deny" ? "POLICY_DENIED" : "POLICY_APPROVAL_REQUIRED";
        return {
          kind: "failed",
          error: `${code}: ${verdict.reason}${verdict.policyId ? ` (policy ${verdict.policyId})` : ""}`,
        };
      }
    }
  }

  // Doc 25 T1 — tạo ủy quyền ai_pending_actions confirmed THẬT trước khi dispatch để
  // cổng HITL của dispatcher (OT/robot) tái-xác-minh và cho qua HỢP LỆ (không còn phụ
  // thuộc mock). Fail-safe: nếu không tạo được, dispatcher fail-closed từ chối.
  await ensureOrchestrationAction(rc.user, idempotencyKey, step, step.args ?? {});
  const cmd = buildEquipmentCommand(descriptor, cap, step.machineId, step.args ?? {}, idempotencyKey, rc.user);

  // doc 80 ORC-01 — last check before the command leaves the engine (the awaits above can span an abort).
  if (rc.aborting) return ABORTED_OUTCOME;

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
    if (rc.aborting) return ABORTED_OUTCOME;
    await refreshReadbacks(rc, step.machineId);
    const current = rc.states.get(step.machineId);
    if (current && targets.has(current)) {
      await upsertStep(rc.runId, step.id, step.type, { status: "running", result: { reachedState: current } });
      return { kind: "ok" };
    }
    if (Date.now() >= deadline) {
      return { kind: "failed", error: `wait_state timeout (machine ${step.machineId} state="${current ?? "?"}").` };
    }
    await sleep(pollMs, rc.controller.signal);
  }
}

async function execWaitTelemetry(rc: RunContext, step: Extract<WorkflowStep, { type: "wait_telemetry" }>): Promise<StepOutcome> {
  const deadline = Date.now() + step.timeoutMs;
  const pollMs = Math.max(1, step.pollMs ?? Math.min(250, step.timeoutMs));
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (rc.aborting) return ABORTED_OUTCOME;
    await refreshConditionReadbacks(rc, step.condition);
    if (evaluateCondition(step.condition, evalCtxOf(rc))) {
      await upsertStep(rc.runId, step.id, step.type, { status: "running", result: { satisfied: true } });
      return { kind: "ok" };
    }
    if (Date.now() >= deadline) {
      return { kind: "failed", error: `wait_telemetry timeout for step "${step.id}".` };
    }
    await sleep(pollMs, rc.controller.signal);
  }
}

/** Run a step's compensation (saga undo). Fail-safe — records but never throws. */
async function runCompensation(rc: RunContext, step: WorkflowStep): Promise<void> {
  if (!step.compensation) return;
  try {
    // doc 80 ORC-01 — never flip an ABORTED run back to 'compensating'.
    await setRunStatusUnlessAborted(rc.runId, "compensating");
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
  return withLiveRun(rc, async () => {
    // Guarded: a run aborted while still 'queued' (e.g. async mode) is never revived.
    const started = await setRunStatusUnlessAborted(rc.runId, "running", { startedAt: new Date() });
    if (!started) return "aborted";
    const out = await execSequence(rc, rc.def.steps);
    return finishWalk(rc, out);
  });
}

/**
 * doc 80 ORC-01 — register the driver in `liveRuns` for the duration of the walk so abortRun
 * can reach it; always unregister (only our own entry) when the walk returns or throws.
 */
async function withLiveRun(
  rc: RunContext,
  walk: () => Promise<OrchestrationRun["status"]>,
): Promise<OrchestrationRun["status"]> {
  liveRuns.set(rc.runId, rc);
  try {
    return await walk();
  } finally {
    if (liveRuns.get(rc.runId) === rc) liveRuns.delete(rc.runId);
  }
}

/**
 * Persist the walk's outcome. Every write is `setRunStatusUnlessAborted` (UPDATE … WHERE
 * status <> 'aborted'): if the run was aborted meanwhile the write is refused and the driver
 * reports 'aborted' — the abort is NEVER overwritten by completed/failed/awaiting_confirm.
 */
async function finishWalk(rc: RunContext, out: StepOutcome): Promise<OrchestrationRun["status"]> {
  if (rc.aborting) {
    // abortRun owns the terminal write (with the user's reason). This guarded write only
    // matters if abortRun's own DB write failed — the run must not stay 'running' with no driver.
    await setRunStatusUnlessAborted(rc.runId, "aborted", { finishedAt: new Date(), error: "Run aborted by request." });
    await persistContext(rc);
    return "aborted";
  }
  let status: OrchestrationRun["status"];
  let patch: Partial<OrchestrationRun>;
  if (out.kind === "paused") {
    status = "awaiting_confirm";
    patch = { currentStepId: out.stepId };
  } else if (out.kind === "aborted" || out.kind === "failed") {
    status = out.kind;
    patch = { finishedAt: new Date(), error: out.error };
  } else {
    status = "completed";
    patch = { finishedAt: new Date() };
  }
  const written = await setRunStatusUnlessAborted(rc.runId, status, patch);
  await persistContext(rc);
  return written ? status : "aborted";
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
    aborting: false,
    controller: new AbortController(),
  };
}

/** Depth-first lookup of a step by id anywhere in the tree (children, branches, compensation). */
function findStepDeep(steps: WorkflowStep[] | undefined, id: string): WorkflowStep | undefined {
  for (const s of steps ?? []) {
    if (s.id === id) return s;
    const node = s as { steps?: WorkflowStep[]; then?: WorkflowStep[]; else?: WorkflowStep[] };
    const hit =
      findStepDeep(node.steps, id) ??
      findStepDeep(node.then, id) ??
      findStepDeep(node.else, id) ??
      (s.compensation ? findStepDeep([s.compensation], id) : undefined);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * doc 80 ORC-03 — ENFORCE the gate's approver policy on APPROVAL (throws FORBIDDEN):
 *   • approverRoles declared ⇒ the approver's role must be listed (admin is always allowed);
 *   • fourEyes ⇒ the approver must not be the user who started the run (no admin exemption).
 */
function assertGateApprover(gate: HitlGateStep, run: OrchestrationRun, user: FoeUser): void {
  const role = String(user.role ?? "").trim().toLowerCase();
  const roles = (Array.isArray(gate.approverRoles) ? gate.approverRoles : [])
    .map((r) => String(r).trim().toLowerCase())
    .filter(Boolean);
  if (roles.length > 0 && role !== "admin" && !roles.includes(role)) {
    throw appError(
      "FORBIDDEN",
      "PERMISSION_DENIED",
      { action: "approveOrchestrationGate" },
      `Gate "${gate.id}" may only be approved by: ${roles.join(", ")} (your role: ${role || "?"}).`,
    );
  }
  if (gate.fourEyes === true && run.startedBy != null && run.startedBy === user.id) {
    throw appError(
      "FORBIDDEN",
      "PERMISSION_DENIED",
      { action: "selfApproveOrchestrationGate" },
      `Gate "${gate.id}" requires four-eyes: the user who started run ${run.id} cannot approve it.`,
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Deploy (validate + persist) a workflow definition. Upserts by ref (bumps version).
 * Flag-gated: FOE_ENABLED off → a disabled result (no persistence).
 */
export async function deployWorkflow(
  def: WorkflowDefinition,
  user: FoeUser,
  opts?: DeployOpts,
): Promise<DeployResult> {
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

    // doc 40 ENG-F4 — SIM-GATE (sau khi validate, TRƯỚC khi persist). Khi cờ FOE_SIM_GATE_REQUIRED
    // bật: chỉ deploy definition có sim-token hợp lệ (đã mô phỏng ĐẠT) HOẶC có override kèm lý do
    // (ghi audit). Mặc định OFF → bỏ qua hoàn toàn (hành vi cũ). Fail-closed khi thiếu cả hai.
    if (foeSimGateRequired()) {
      const simOk = verifySimToken(def, opts?.simToken);
      const reason = opts?.overrideReason?.trim() || "";
      if (!simOk && !reason) {
        void auditDeploySimGate(user, def, "rejected", null);
        return {
          ok: false,
          enabled: true,
          message:
            "Chưa mô phỏng đạt (sim-gate): hãy Simulate workflow đến khi feasible rồi Deploy, hoặc deploy kèm lý do override.",
        };
      }
      if (!simOk && reason) {
        void auditDeploySimGate(user, def, "override", reason);
      }
    }

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
    // data-raw-ok: như trên — lỗi một bước trong bộ thực thi quy trình.
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
  reason: string,
): Promise<DeployResult> {
  if (!foeEnabled()) {
    return { ok: false, enabled: false, message: "FOE is disabled (set FOE_ENABLED=true)." };
  }
  // doc 80 ORC-05 — a rollback is a deploy: it needs a HUMAN reason (≥3 chars), recorded in audit.
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length < 3) {
    return { ok: false, enabled: true, message: "A rollback reason (at least 3 characters) is required." };
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
  // doc 80 ORC-05 — the sim-gate override is NO LONGER auto-filled by the engine: when the gate is
  // on, the override carries the HUMAN's mandatory reason (audited by auditDeploySimGate).
  const def = target.definitionJson as WorkflowDefinition;
  const res = await deployWorkflow(def, user, {
    overrideReason: `rollback to v${version}: ${why}`,
  });
  if (res.ok) void auditRollback(user, def, version, res.version ?? null, why);
  return res;
}

/** doc 80 ORC-05 — audit the rollback itself with the human reason (best-effort). */
async function auditRollback(
  user: FoeUser,
  def: WorkflowDefinition,
  fromVersion: number,
  newVersion: number | null,
  reason: string,
): Promise<void> {
  try {
    const { logCrudOperation, createAuditContext } = await import("../../auditTrailService");
    await logCrudOperation(
      createAuditContext({ user: { id: user.id || 0, name: user.name ?? user.role } }),
      {
        action: "config_change",
        entityType: "orchestration_workflow",
        entityName: def.ref,
        details: {
          operation: "foe_workflow_rollback",
          metadata: { ref: def.ref, rolledBackTo: fromVersion, newVersion, reason },
        },
        status: "success",
      },
    );
  } catch {
    /* audit best-effort */
  }
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
    // doc 80 ORC-06 — only a DEPLOYED ('active') workflow runs. A duplicate is created 'draft'
    // and must pass deployWorkflow (validation + sim-gate + version snapshot) before running.
    if (wf.status !== "active") {
      return {
        ok: false,
        enabled: true,
        message: `Workflow "${workflowRef}" is ${wf.status} — deploy it before running.`,
      };
    }

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
    // doc 33 W4 (F8 §5.1.2) — durable event log: record RUN_CREATED (best-effort, FOE_DURABLE-gated).
    void appendRunEvent(run.id, "RUN_CREATED", { ts: Date.now(), data: { workflowRef: wf.ref } });

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
            // doc 80 ORC-01 (fix round 1) — conditional: an exception AFTER an abort never turns 'aborted' into 'failed'.
            await setRunStatusUnlessAborted(asyncRunId, "failed", { finishedAt: new Date(), error: message }).catch(() => undefined);
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
    // doc 80 ORC-01 (fix round 1) — conditional write: an exception AFTER an abort (e.g. persistContext
    // throwing) must not overwrite 'aborted' with 'failed'. 0 rows written ⇒ report 'aborted'.
    let wroteFailed = true;
    if (runId != null) {
      wroteFailed = await setRunStatusUnlessAborted(runId, "failed", { finishedAt: new Date(), error: message }).catch(() => true);
    }
    return { ok: false, enabled: true, runId, status: wroteFailed ? "failed" : "aborted", message };
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
      // doc 80 ORC-02 — CAS: only ONE decision (approve OR reject) may claim the paused run.
      await claimPausedRun(runId, "aborted", {
        finishedAt: new Date(),
        error: `Gate "${gateStepId ?? "?"}" rejected by user ${user.id}.${reason ? ` Reason: ${reason}` : ""}`,
      });
      void appendRunEvent(runId, "RUN_FAILED", { ts: Date.now(), data: { status: "aborted" } });
      if (gateStepId) {
        await upsertStep(runId, gateStepId, "hitl_gate", {
          status: "failed",
          error: reason ? `Rejected: ${reason}` : "Rejected",
          result: { approved: false, note: reason ?? null, rejectedBy: user.id },
          finishedAt: new Date(),
        }).catch(() => undefined);
      }
      return { ok: false, enabled: true, runId, status: "aborted" };
    }

    const [wf] = await d.select().from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, run.workflowId)).limit(1);
    if (!wf) return { ok: false, enabled: true, message: `Workflow ${run.workflowId} not found.` };
    const def = wf.definitionJson as WorkflowDefinition;

    // doc 80 ORC-03 — approving a hitl_gate enforces its approverRoles / fourEyes (FORBIDDEN).
    // Only a run paused AT a gate ('awaiting_confirm'); an interrupted 'held' run has no open gate.
    if (run.status === "awaiting_confirm" && gateStepId) {
      const gate = findStepDeep(def.steps, gateStepId);
      if (gate && gate.type === "hitl_gate") assertGateApprover(gate, run, user);
    }

    // doc 80 ORC-02 — CAS `UPDATE … SET status='running' WHERE id=$1 AND status IN
    // ('awaiting_confirm','held') RETURNING *`: 0 rows ⇒ another resume already claimed it ⇒ CONFLICT.
    // Exactly one caller proceeds to drive the run.
    await claimPausedRun(runId, "running");

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
    // CONFLICT (lost the CAS) / FORBIDDEN (gate policy) are business refusals raised BEFORE any
    // state change — surface them as-is; never mark the run failed for them.
    if (err instanceof TRPCError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    // doc 80 ORC-01 (fix round 1) — conditional write (see startRun): never 'aborted' → 'failed'.
    const wroteFailed = await setRunStatusUnlessAborted(runId, "failed", { finishedAt: new Date(), error: message }).catch(() => true);
    return { ok: false, enabled: true, runId, status: wroteFailed ? "failed" : "aborted", message };
  }
}

/** Statuses a human/auto resume may claim (doc 80 ORC-02). */
const RESUMABLE_STATUSES: OrchestrationRun["status"][] = ["awaiting_confirm", "held"];

/**
 * doc 80 ORC-02 — compare-and-set claim of a paused run:
 * `UPDATE orchestration_runs SET status=$2 … WHERE id=$1 AND status IN ('awaiting_confirm','held')
 * RETURNING *`. 0 rows ⇒ someone else resumed / rejected / aborted it first ⇒ CONFLICT.
 */
async function claimPausedRun(
  runId: number,
  status: OrchestrationRun["status"],
  patch: Partial<OrchestrationRun> = {},
): Promise<OrchestrationRun> {
  const d = await db();
  const claimed = await d
    .update(orchestrationRuns)
    .set({ status, updatedAt: new Date(), ...patch })
    .where(and(eq(orchestrationRuns.id, runId), inArray(orchestrationRuns.status, RESUMABLE_STATUSES)))
    .returning();
  if (claimed.length === 0) {
    throw appError(
      "CONFLICT",
      "OPERATION_FAILED",
      { operation: "resumeOrchestrationRun", reason: "runAlreadyClaimed" },
      `Run ${runId} was already resumed, rejected or aborted by another request.`,
    );
  }
  return claimed[0];
}

/**
 * Đường RESUME. KHÔNG reset startedAt. Đi lại từ đầu bằng execSequence THƯỜNG: mọi bước
 * đã hoàn tất (gồm gate vừa duyệt) nằm trong rc.completed nên execStep bỏ qua — không
 * tái-dispatch lệnh, không re-pause gate đã duyệt, kể cả gate lồng trong parallel/branch.
 * Gate CHƯA duyệt (nếu có) sẽ pause lại như thường.
 */
async function driveRunFromResume(rc: RunContext): Promise<OrchestrationRun["status"]> {
  return withLiveRun(rc, async () => {
    // The CAS already set 'running'. Re-assert it GUARDED: an abort that landed between the CAS
    // and this registration (abortRun could not reach a live handle yet) must stop the walk here.
    const stillOurs = await setRunStatusUnlessAborted(rc.runId, "running");
    if (!stillOurs) return "aborted";
    const out = await execSequence(rc, rc.def.steps);
    return finishWalk(rc, out);
  });
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
      // doc 80 ORC-02 — resumeRun may now THROW (CONFLICT when a human resumed it first); one
      // refusal must not stop the sweep over the remaining interrupted runs.
      const res = await resumeRun(runId, { approved: true, note: "auto-resume (FOE_DURABLE)" }, SYSTEM_FOE_USER).catch(
        (err: unknown) => {
          console.error(`[FOE] auto-resume run ${runId} skipped:`, err instanceof Error ? err.message : String(err));
          return null;
        },
      );
      if (res?.ok) resumed.push(runId);
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

/**
 * Abort a run (terminal). Records the reason; does not crash on a missing run.
 *
 * doc 80 ORC-01 — a REAL abort: if the run's driver is alive in this process, its handle is
 * flagged + its AbortController fired FIRST (so no further step / command is issued and any
 * `delay` / `wait_*` wakes up at once), THEN the DB row is written 'aborted'. The driver's own
 * terminal writes are conditional (`status <> 'aborted'`), so it can never overwrite this.
 * The DB write itself is conditional too (`status NOT IN ('completed','failed')`): a run that
 * finished first stays finished and the caller is told so.
 */
export async function abortRun(runId: number, user: FoeUser, reason?: string): Promise<StartRunResult> {
  try {
    const d = await getDb();
    if (!d) return { ok: false, enabled: foeEnabled(), runId, message: "DB unavailable." };
    const [run] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
    if (!run) return { ok: false, enabled: foeEnabled(), runId, message: `Run ${runId} not found.` };
    if (["completed", "failed", "aborted"].includes(run.status)) {
      return { ok: false, enabled: foeEnabled(), runId, status: run.status, message: `Run ${runId} already terminal.` };
    }
    const live = liveRuns.get(runId);
    if (live) {
      live.aborting = true;
      live.controller.abort();
    }
    const written = await d
      .update(orchestrationRuns)
      .set({
        status: "aborted",
        updatedAt: new Date(),
        finishedAt: new Date(),
        error: reason ? `Aborted by user ${user.id}: ${reason}` : `Aborted by user ${user.id}.`,
      })
      .where(and(eq(orchestrationRuns.id, runId), notInArray(orchestrationRuns.status, ["completed", "failed"])))
      .returning({ id: orchestrationRuns.id });
    if (written.length === 0) {
      return { ok: false, enabled: foeEnabled(), runId, message: `Run ${runId} already terminal.` };
    }
    void appendRunEvent(runId, "RUN_FAILED", { ts: Date.now(), data: { status: "aborted" } });
    return { ok: true, enabled: foeEnabled(), runId, status: "aborted" };
  } catch (err) {
    // data-raw-ok: như trên — lỗi một bước trong bộ thực thi quy trình.
    return { ok: false, enabled: foeEnabled(), runId, message: err instanceof Error ? err.message : String(err) };
  }
}
