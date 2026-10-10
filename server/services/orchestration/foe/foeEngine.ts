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
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { DbUnavailableError } from "../../../_core/dbErrors";
import { TRPCError } from "@trpc/server";
import { appError } from "../../../_core/appError";
import { and, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { appendRunEvent } from "../runEventStore"; // doc 33 W4 (F8): durable RunEvent log (FOE_DURABLE)
import {
  orchestrationWorkflows,
  orchestrationWorkflowVersions,
  orchestrationRuns,
  orchestrationRunSteps,
  machines,
  aiPendingActions,
  deviceAdapters,
  robots, // doc 81 Đợt 4 final wave G3 — a robot step names an existing, enabled robot
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
import { FOE_ENGINE_TOOL, otPayloadHash, robotPayloadHash, withFoeGateApproval, withOtPayloadHash, type FoeGateApproval } from "../../ot/otActionBinding"; // doc 81 Đợt 1B Task 6 + final wave (robot) + Đợt 4 A5
import { isStopJob, STOP_DB_STEP_DEADLINE_MS } from "../../robot/stopJob"; // doc 81 Đợt 4 A5 — a robot STOP is never gated (L-7); F5 deadline
import { withDeadline } from "../../ot/drivers/boundedClose"; // final wave F5 — bounded STOP-step lookups
import {
  evaluateGateApprovals,
  findStepDeep,
  hashWorkflowDefinition,
  FOE_APPROVAL_SOURCE_SERVER,
  FOE_APPROVAL_SOURCE_SYSTEM,
  type GateRequiredReason,
} from "./foeGateApproval"; // doc 81 Đợt 4 fix round 1 (R-4-e … R-4-i)
import { toRobotJob } from "../../equipment/robotJobMapping"; // final wave (item 2) — same mapping the robot route uses

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

// doc 81 Đợt 4 fix round 1 — canonical-JSON definition hash moved to foeGateApproval.ts (ONE definition shared with the
// gate-approval binding R-4-e and the dispatchers' DB check R-4-i); re-exported here for existing importers.
export { hashWorkflowDefinition };

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
  /** doc 81 Đợt 4 fix round 2 (R-4-j) — machine-readable refusal (Studio translates it). */
  reason?: DefinitionRefusalReason;
  /** Offending step ids for `reason`. */
  stepIds?: string[];
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
  /**
   * Doc 80 Đợt 1 Task 11 — set ONLY when refused because the WORKFLOW (not the run) is not
   * `active` (draft/archived — ORC-06). The Studio client uses this to render a translated
   * (`t()`) toast instead of showing `message` (English, server-authored) verbatim.
   */
  workflowStatus?: string;
  /**
   * doc 81 Đợt 4 final wave G4 — set when the START was refused by the same definition checks deploy runs (a workflow
   * activated before those checks existed): no run was created. The Studio translates it like a deploy refusal.
   */
  reason?: DefinitionRefusalReason;
  stepIds?: string[];
}

/** doc 81 Đợt 4 (R-4-j, R-4-n, final wave G3) — why a definition was refused (deploy, and since G4 run start). */
export type DefinitionRefusalReason = "stopAdapterAmbiguous" | "robotIdMissing" | "robotUnavailable";

export interface RunView {
  run: OrchestrationRun;
  /**
   * doc 81 Đợt 4 fix round 2 (R-4-k) — hash of the definition currently deployed for this run's workflow (what the
   * approver's screen shows); sent back as `expectedDefHash` on approval. null when the workflow row is missing.
   */
  defHash: string | null;
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
  /**
   * doc 80 Đợt 1 Task 9 — the gate (`currentStepId`) the decider was LOOKING AT. When given, it
   * must equal the run's current gate or the decision is refused with CONFLICT (a stale approver
   * of g1 must never approve/reject g2). `null` = "the run had no current step" (interrupted
   * 'held' run). Omitted ⇒ no caller-side pin (internal callers); the CAS still pins the gate
   * read at the start of this call.
   */
  expectedStepId?: string | null;
  /**
   * doc 81 Đợt 4 fix round 2 (R-4-k) — hash (hashWorkflowDefinition) of the definition the approver's screen LOADED
   * (RunView.defHash). Given on an approval of an open gate and ≠ the definition now deployed ⇒ CONFLICT
   * (reason definitionChanged) before any state change. Omitted ⇒ no check (internal callers).
   */
  expectedDefHash?: string;
}

/** doc 80 Đợt 1 Task 9 — optional hooks of `resumeRun`. */
export interface ResumeHooks {
  /**
   * REJECT path only: side effects that undo completed work (QT saga compensation §18.2). They
   * run ONLY after this call has WON the CAS on the paused run (status → 'compensating', gate
   * pinned) — a decision that loses the race never compensates. Returns the final rejection note
   * (e.g. the decider's note + compensation notes); undefined keeps `decision.note`.
   */
  compensate?: () => Promise<string | undefined>;
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
  /**
   * doc 81 Đợt 4 Task A5 — orchestration_runs.startedBy (the run OWNER). NOT `user`: on a resume `user` is
   * the approver. null = the run was not started by a user (API key / system).
   */
  runOwner: number | null;
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
        // doc 81 Đợt 4 fix round 3 (R-4-n) — a transition that carries no result KEEPS the step's result (the command's
        // routedTo/status/detail, incl. a localisable detail.appError) instead of wiping it to NULL on completion/failure.
        ...(patch.result !== undefined ? { resultJson: patch.result } : {}),
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
 * dispatcher OT/robot tái-xác-minh trước khi ghi. Bản ghi không hiện trong action inbox
 * (inbox chỉ hiện 'proposed'). Lỗi tạo bản ghi → nuốt: bản ghi không có ⇒ dispatcher
 * fail-closed (từ chối), an toàn hơn là để lệnh lọt.
 */
/**
 * doc 81 Đợt 1B Task 6 (Ruling R4) — the OT dispatcher now accepts a real write only for a
 * 'confirmed' action BOUND to the exact command (tool + canonical payload hash) and consumes
 * it (confirmed→executed). So for an OT step the row is created 'confirmed' and carries the
 * hash of EXACTLY the command FOE is about to send (built from the same EquipmentCommand the
 * OtEquipmentAdapter maps to DispatchInput). Final wave (item 2): robot/AGV steps get the SAME
 * treatment — a 'confirmed' row bound with robotPayloadHash to the job toRobotJob(cmd) yields,
 * which the robot dispatcher verifies under FOR UPDATE and consumes once. Only a step that is
 * neither OT nor robot (no adapterId, no robotId) still gets the legacy unbound 'executed' row.
 * doc 81 Đợt 4 Task A5 (QĐ-4a option (a)) CLOSES the old "FOE grants itself this approval" gap: the row is
 * confirmed by the approver of an earlier hitl_gate of the run (≠ run owner) — see findSeparateGateApproval.
 */
export const FOE_ACTION_TOOL = FOE_ENGINE_TOOL;

export async function ensureOrchestrationAction(
  user: FoeUser,
  idempotencyKey: string,
  step: WorkflowStep,
  args: Record<string, unknown>,
  cmd?: EquipmentCommand,
  /**
   * doc 81 Đợt 4 Task A5 — the separate gate approval (OT/robot steps). With it the row is CONFIRMED BY the
   * approver and carries the approval; without it an OT/robot row is still created confirmed by `user` — the only
   * case the engine still does that is a STOP (every other OT/robot step is refused before this call), and the
   * dispatchers accept such a self-confirmed engine row ONLY for a stop (a pinned OT stop; a robot abort is never
   * verified at all).
   */
  approval?: FoeGateApproval,
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
    const isOt = cmd != null && cmd.adapterId != null && cmd.robotId == null;
    // doc 81 Đợt 1B final wave (item 2, ruling R4) — a ROBOT command gets the same treatment as
    // an OT one: a 'confirmed' row bound (robotPayloadHash) to EXACTLY the job the robot route
    // will dispatch (toRobotJob — the same mapping RobotEquipmentAdapter.sendCommand uses), so the
    // robot dispatcher can verify + consume it once. It used to be an unbound 'executed' row.
    const isRobot = cmd != null && cmd.robotId != null;
    let previewJson: Record<string, unknown> | undefined;
    if (isOt) {
      previewJson = withOtPayloadHash(
        null,
        otPayloadHash({
          tool: FOE_ACTION_TOOL,
          adapterId: cmd.adapterId!,
          machineId: cmd.machineId ?? null,
          commandType: cmd.name,
          writes: cmd.writes ?? [],
        }),
      );
    } else if (isRobot) {
      const job = toRobotJob(cmd);
      previewJson = withOtPayloadHash(null, robotPayloadHash({ robotId: cmd.robotId!, jobType: job.jobType, params: job.params ?? null }));
    }
    const approved = (isOt || isRobot) && approval != null;
    if (approved && previewJson) previewJson = withFoeGateApproval(previewJson, approval);
    await d.insert(aiPendingActions).values({
      id: actionId,
      tool: FOE_ACTION_TOOL,
      argsJson: args ?? {},
      // doc 81 Đợt 4 Task A5 — confirmer = the gate approver (never the run owner).
      userId: approved ? approval.approvedBy : user.id || 0,
      userRole: approved ? "foe_gate_approver" : user.role || "system",
      summary: `FOE orchestration: step ${step.id}`,
      ...(isOt || isRobot
        ? { status: "confirmed" as const, previewJson }
        : { status: "executed" as const, executedAt: new Date() }),
      idempotencyKey: actionId,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
  } catch {
    // fail-safe: không tạo được ⇒ cổng dispatcher sẽ fail-closed (an toàn).
  }
}

export function buildEquipmentCommand(
  descriptor: CommandDescriptor,
  capability: EquipmentCapability,
  machineId: number,
  args: Record<string, unknown>,
  idempotencyKey: string,
  user: FoeUser,
  /** doc 81 Đợt 4 Task A5 — requester = run owner, confirmer = the gate approver (absent ⇒ legacy: both `user`). */
  approval?: FoeGateApproval,
): EquipmentCommand {
  const isRobot = isRobotKind(capability.adapterKind);
  const cmd: EquipmentCommand = {
    name: descriptor.name,
    machineId,
    idempotencyKey,
    // FOE is an automated multi-step actor; the dispatcher STILL applies its dry-run
    // gate. actionId TRỎ tới bản ghi ai_pending_actions confirmed thật (ensureOrchestrationAction);
    // requestedBy/confirmedBy = user đã khởi động run (owner của bản ghi) → cổng OT/robot qua hợp lệ.
    hitl: {
      actionId: orchestrationActionId(idempotencyKey),
      tool: FOE_ACTION_TOOL, // doc 81 Đợt 1B Task 6 — part of the OT binding
      requestedBy: approval ? approval.runOwner ?? 0 : user.id || 0,
      confirmedBy: approval ? approval.approvedBy : user.id || 0,
    },
  };
  if (isRobot) {
    // fix round 2 (R-4-m) — never default to the machine id (different id space): no robotId ⇒ the robot route refuses
    // ("robotId required for robot command") and nothing reaches a robot.
    cmd.robotId = typeof args.robotId === "number" ? args.robotId : undefined;
    if (descriptor.name === "run_job" && typeof args.jobType === "string") {
      cmd.job = { jobType: args.jobType as never, params: (args.params as Record<string, unknown>) ?? {} };
    }
  } else {
    // fix round 1 (R-4-d) — never default to the machine id (different id space); execCommand resolves the bound adapter.
    cmd.adapterId = typeof args.adapterId === "number" ? args.adapterId : undefined;
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

/**
 * doc 81 Đợt 4 Task A5 — the OT dispatcher's OWN stop-type predicate (commandDispatcher.isStopCommandType — one
 * definition), imported lazily (the dispatcher module is heavy and test suites replace it). Unavailable ⇒ false:
 * the step is then treated as a non-stop and needs a gate (fail-closed).
 */
async function isOtStopCommandType(name: string): Promise<boolean> {
  try {
    const mod = await import("../../ot/commandDispatcher");
    return typeof mod.isStopCommandType === "function" && mod.isStopCommandType(name) === true;
  } catch {
    return false;
  }
}

/** doc 81 Đợt 4 Task A5 — step error code (prefix) the Studio translates (studio.gateRequired). */
export const FOE_GATE_REQUIRED = "FOE_GATE_REQUIRED";

/**
 * doc 81 Đợt 4 Task A5 (R-4-a) + fix round 1 (R-4-e … R-4-h) — the latest hitl_gate of THIS run that counts as a separate
 * human approval, by the ONE rule in foeGateApproval.evaluateGateApprovals (server-recorded approval, approver ≠ run
 * owner, bound to the hash of the definition being executed; an owner-less run never counts). Otherwise WHY not.
 * Any DB error ⇒ noGate (fail-closed).
 */
async function findSeparateGateApproval(rc: RunContext): Promise<{ approval: FoeGateApproval } | { reason: GateRequiredReason }> {
  try {
    const d = await getDb();
    if (!d) return { reason: "noGate" };
    const rows = await d.select().from(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, rc.runId));
    const ev = evaluateGateApprovals(rows, rc.def, hashWorkflowDefinition(rc.def), rc.runOwner);
    if (!ev.ok) return { reason: ev.reason };
    const top = ev.approvals[0];
    return { approval: { runId: rc.runId, runOwner: rc.runOwner, approvedBy: top.approvedBy, gateStepId: top.gateStepId } };
  } catch {
    return { reason: "noGate" };
  }
}

/** doc 81 Đợt 4 fix round 1 (finding 7) — the step error per reason; the Studio keys its text on `FOE_GATE_REQUIRED(<reason>)`. */
function gateRequiredError(stepId: string, reason: GateRequiredReason): string {
  const why: Record<GateRequiredReason, string> = {
    noGate:
      "needs an earlier approval gate (hitl_gate) in this run approved by someone other than the user who started it — none found. Add a hitl_gate before this step, deploy, and start a new run; another user must approve the gate.",
    approvedByOwner:
      "the approval gate before it was approved by the user who started the run — that does not count. Start a new run and have another user approve the gate.",
    staleApproval:
      "the workflow was redeployed after the gate was approved, so the approval does not cover the definition now running. Start a new run and have the gate approved again.",
    ownerUnknown:
      "the run has no attributable owner (started by the system or by an API key with no creating user), so a separate approval cannot be verified. Start the run as a user.",
  };
  return `${FOE_GATE_REQUIRED}(${reason}): command step "${stepId}" was not sent: ${why[reason]}`;
}

/**
 * doc 81 Đợt 4 fix round 1 (R-4-d, review C1) — the OT adapter a step writes through. Explicit numeric args.adapterId is
 * kept (the OT dispatcher + the safety preflight then resolve ITS machine server-side). Otherwise: the single ENABLED
 * device_adapters row bound to the step's machine; zero or several ⇒ no adapterId (the OT route refuses — fail-closed).
 * Robot kinds are untouched (robotId). Before: `adapterId = machineId` — two id spaces mixed, a write could land on an
 * unrelated adapter.
 */
async function withResolvedAdapter(kind: string, machineId: number, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (isRobotKind(kind) || typeof args.adapterId === "number") return args;
  const ids = await enabledAdapterIdsOfMachine(machineId);
  return ids !== null && ids.length === 1 ? { ...args, adapterId: ids[0] } : args;
}

/** doc 81 Đợt 4 fix round 2 (R-4-m) — robot/AGV adapter kinds (robotId, never adapterId). */
function isRobotKind(kind: string): boolean {
  return kind === "robot" || kind === "vda5050";
}

/**
 * doc 81 Đợt 4 fix round 2 (R-4-j) — the ENABLED device_adapters bound to a machine: the ONE lookup behind both the
 * runtime adapter choice (withResolvedAdapter) and the deploy-time stop check (ambiguousStopSteps). null ⇒ DB error.
 */
async function enabledAdapterIdsOfMachine(machineId: number): Promise<number[] | null> {
  try {
    const d = await getDb();
    if (!d) return null;
    const rows = await d.select().from(deviceAdapters).where(and(eq(deviceAdapters.machineId, machineId), eq(deviceAdapters.isEnabled, true)));
    return rows.map((r) => r.id);
  } catch {
    return null;
  }
}

/** Every step of a definition, depth-first (children, branches, compensation). */
function allStepsOf(steps: WorkflowStep[] | undefined, out: WorkflowStep[] = []): WorkflowStep[] {
  for (const s of steps ?? []) {
    out.push(s);
    const node = s as { steps?: WorkflowStep[]; then?: WorkflowStep[]; else?: WorkflowStep[] };
    allStepsOf(node.steps, out);
    allStepsOf(node.then, out);
    allStepsOf(node.else, out);
    if (s.compensation) allStepsOf([s.compensation], out);
  }
  return out;
}

/**
 * doc 81 Đợt 4 fix round 3 (ruling R-4-n, re-review NEW-1) — a robot-kind command step must name its robot
 * (numeric args.robotId > 0): robots have no machine link, so nothing can be derived at run time (R-4-m removed the
 * machine-id fallback) and the step — an abort / e_stop included — would only fail during the run. Refused at DEPLOY.
 */
function robotStepsWithoutRobotId(def: WorkflowDefinition, machineMap: Map<number, MachineForValidation>): string[] {
  const bad: string[] = [];
  for (const step of allStepsOf(def.steps)) {
    if (step.type !== "command") continue;
    const m = machineMap.get(step.machineId);
    if (!m) continue;
    const cap = getCapabilitiesForMachine({ machineType: m.machineType, capabilities: m.capabilities as never });
    if (!isRobotKind(cap.adapterKind)) continue;
    const rid = step.args?.robotId;
    if (!(typeof rid === "number" && Number.isInteger(rid) && rid > 0)) bad.push(step.id);
  }
  return bad;
}

/**
 * doc 81 Đợt 4 final wave G3 (re-review 3 A3-2) — a robot-kind command step whose args.robotId names a robot that does
 * not EXIST could never be sent. Refused at DEPLOY (and at run start for NON-stop steps only, R-4-w). A DB error counts
 * every such step as offending (fail-closed). Steps without a valid robotId are robotStepsWithoutRobotId's.
 * Final wave N1 (ruling R-4-w) — EXISTENCE only, not `robots.isEnabled`: the robot dispatcher sends to the active set
 * loaded at boot (robotManager.getActiveRobot), and robot.setEnabled only updates the row — a robot disabled after boot
 * still receives an abort today, so the DB flag is not the truth about "can this stop be sent". Orchestration has no
 * tenant scope (out of scope here, pre-existing).
 */
async function robotStepsWithUnavailableRobot(def: WorkflowDefinition, machineMap: Map<number, MachineForValidation>): Promise<string[]> {
  const wanted: Array<{ stepId: string; robotId: number }> = [];
  for (const step of allStepsOf(def.steps)) {
    if (step.type !== "command") continue;
    const m = machineMap.get(step.machineId);
    if (!m) continue;
    const cap = getCapabilitiesForMachine({ machineType: m.machineType, capabilities: m.capabilities as never });
    if (!isRobotKind(cap.adapterKind)) continue;
    const rid = step.args?.robotId;
    if (typeof rid === "number" && Number.isInteger(rid) && rid > 0) wanted.push({ stepId: step.id, robotId: rid });
  }
  if (wanted.length === 0) return [];
  let existing: Set<number>;
  try {
    const d = await getDb();
    if (!d) return wanted.map((w) => w.stepId);
    const rows = await d.select().from(robots).where(inArray(robots.id, [...new Set(wanted.map((w) => w.robotId))]));
    existing = new Set(rows.map((r) => r.id)); // N1 (R-4-w) — exists; the enabled flag is not consulted
  } catch {
    return wanted.map((w) => w.stepId);
  }
  return wanted.filter((w) => !existing.has(w.robotId)).map((w) => w.stepId);
}

/**
 * Final wave N1 (ruling R-4-w) — ids of the STOP command steps of a definition (robot: the job toRobotJob maps the step to
 * is a stop — the same classification execCommand uses; OT: the dispatcher's stop-type predicate). Used so the run-START
 * check never refuses a run because of a stop step (L-7): a defective stop step fails on its own at runtime, as before.
 */
async function stopStepIdsOf(def: WorkflowDefinition, machineMap: Map<number, MachineForValidation>): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const step of allStepsOf(def.steps)) {
    if (step.type !== "command") continue;
    const m = machineMap.get(step.machineId);
    if (!m) continue;
    const cap = getCapabilitiesForMachine({ machineType: m.machineType, capabilities: m.capabilities as never });
    if (isRobotKind(cap.adapterKind)) {
      const descriptor = cap.supportedCommands.find((c) => c.name === step.command);
      if (descriptor && isStopJob(toRobotJob(buildEquipmentCommand(descriptor, cap, step.machineId, step.args ?? {}, "probe", { id: 0, role: "system" })))) {
        ids.add(step.id);
      }
    } else if (await isOtStopCommandType(step.command)) ids.add(step.id);
  }
  return ids;
}

/**
 * doc 81 Đợt 4 (R-4-n, final wave G3, R-4-j) — the definition checks deploy runs after validation, in this order; also run
 * at run START since final wave G4 (workflows activated before these checks existed). null ⇒ the definition passes.
 * Final wave N1 (ruling R-4-w) — at START (`nonStopOnly`) only NON-stop steps can cause a refusal: stop / abort / e_stop
 * steps are left out of every check (stopAdapterAmbiguous is about stops only, so it never applies at start). Deploy
 * (default) is unchanged.
 */
async function definitionRefusal(
  def: WorkflowDefinition,
  machineMap: Map<number, MachineForValidation>,
  opts: { nonStopOnly?: boolean } = {},
): Promise<{ reason: DefinitionRefusalReason; stepIds: string[]; errors: ValidationError[]; message: string } | null> {
  const stops = opts.nonStopOnly ? await stopStepIdsOf(def, machineMap) : new Set<string>();
  const keep = (ids: string[]) => ids.filter((id) => !stops.has(id));
  // doc 81 Đợt 4 fix round 3 (R-4-n) — every robot step must name its robot BEFORE the run exists.
  const noRobot = keep(robotStepsWithoutRobotId(def, machineMap));
  if (noRobot.length > 0) {
    return {
      reason: "robotIdMissing",
      stepIds: noRobot,
      errors: noRobot.map((id) => ({
        path: `step:${id}`,
        message: `Robot step "${id}" names no robot (args.robotId) — at run time it could not be sent. Pick the robot for the step.`,
      })),
      message: `Robot step(s) ${noRobot.join(", ")} name no robot — pick the robot for each step before deploying.`,
    };
  }
  // final wave G3 / N1 — the named robot must exist.
  const unavailable = keep(await robotStepsWithUnavailableRobot(def, machineMap));
  if (unavailable.length > 0) {
    return {
      reason: "robotUnavailable",
      stepIds: unavailable,
      errors: unavailable.map((id) => ({
        path: `step:${id}`,
        message: `Robot step "${id}" names a robot that does not exist — at run time it could not be sent. Pick an existing robot for the step.`,
      })),
      message: `Robot step(s) ${unavailable.join(", ")} name a robot that does not exist — pick an existing robot for each step.`,
    };
  }
  // doc 81 Đợt 4 fix round 2 (R-4-j) — an OT STOP step must name a resolvable adapter BEFORE the run exists (deploy only:
  // every offender is a stop step, so at START (N1) this never refuses).
  const ambiguous = opts.nonStopOnly ? [] : await ambiguousStopSteps(def, machineMap);
  if (ambiguous.length > 0) {
    return {
      reason: "stopAdapterAmbiguous",
      stepIds: ambiguous,
      errors: ambiguous.map((id) => ({
        path: `step:${id}`,
        message: `Stop step "${id}": its machine has no single enabled adapter (0 or several) and the step names no adapterId — at run time this STOP could not be sent. Set args.adapterId or fix the machine's adapters.`,
      })),
      message: `Stop step(s) ${ambiguous.join(", ")} cannot reach a unique adapter — set args.adapterId or fix the machine's adapters before deploying.`,
    };
  }
  return null;
}

/**
 * doc 81 Đợt 4 fix round 2 (ruling R-4-j, review N1) — an OT STOP step whose adapter cannot be resolved uniquely at run
 * time (no explicit args.adapterId and 0 or 2+ enabled adapters bound to its machine) would only fail during an
 * emergency ("adapterId required"). Caught at DEPLOY instead; the runtime STOP path is unchanged and never gated (L-7).
 * Returns the offending step ids (a DB error counts every candidate as offending — fail-closed).
 */
async function ambiguousStopSteps(def: WorkflowDefinition, machineMap: Map<number, MachineForValidation>): Promise<string[]> {
  const bad: string[] = [];
  for (const step of allStepsOf(def.steps)) {
    if (step.type !== "command") continue;
    const m = machineMap.get(step.machineId);
    if (!m) continue; // semantic validation already refused unknown machines
    const cap = getCapabilitiesForMachine({ machineType: m.machineType, capabilities: m.capabilities as never });
    if (isRobotKind(cap.adapterKind)) continue;
    if (!(await isOtStopCommandType(step.command))) continue;
    if (typeof step.args?.adapterId === "number") continue;
    const ids = await enabledAdapterIdsOfMachine(step.machineId);
    if (ids === null || ids.length !== 1) bad.push(step.id);
  }
  return bad;
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
          // doc 81 Đợt 4 Task A5 — the run OWNER (on a resume rc.user is the approver, which this used to report).
          startedBy: rc.runOwner ?? rc.user.id,
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

  // Final review fix #9 — an aborted run must not leave an authorization row behind for a
  // command it will never send: check the flag BEFORE creating the ai_pending_actions record.
  if (rc.aborting) return ABORTED_OUTCOME;

  // Doc 25 T1 — tạo ủy quyền ai_pending_actions confirmed THẬT trước khi dispatch để
  // cổng HITL của dispatcher (OT/robot) tái-xác-minh và cho qua HỢP LỆ (không còn phụ
  // thuộc mock). Fail-safe: nếu không tạo được, dispatcher fail-closed từ chối.
  // doc 81 Đợt 1B Task 6 — build the command FIRST so the authorisation row is bound to it.
  // doc 81 Đợt 4 Task A5 (QĐ-4a option (a), R-4-a) — the engine no longer approves itself: an OT/robot step runs only
  // on an earlier hitl_gate of THIS run approved by someone other than the run owner; that approver is the action's
  // confirmer. No such gate ⇒ the step stops with FOE_GATE_REQUIRED (Studio: studio.gateRequired). A STOP is exempt
  // (L-7, energy direction): a robot abort/stop is never gated by the robot dispatcher, and an OT stop-typed step is
  // let through here but the OT dispatcher accepts its self-confirmed row ONLY for a PINNED stop.
  // fix round 1 (R-4-d) — an OT step without args.adapterId writes through the adapter BOUND to its machine (one enabled
  // device_adapters row), never "adapter id = machine id"; none / several ⇒ no adapter ⇒ the OT route refuses it.
  // final wave F5 (L-7, final review M3) — classify the STOP FIRST, from the step itself (no DB): the name is the
  // descriptor's and a robot step's args are never rewritten by withResolvedAdapter. fix round 2 (R-4-m) — by ADAPTER KIND.
  const rawArgs = step.args ?? {};
  const robotKind = isRobotKind(cap.adapterKind);
  const isStop = robotKind
    ? isStopJob(toRobotJob(buildEquipmentCommand(descriptor, cap, step.machineId, rawArgs, idempotencyKey, rc.user)))
    : await isOtStopCommandType(descriptor.name);
  let args: Record<string, unknown>;
  let found: Awaited<ReturnType<typeof findSeparateGateApproval>>;
  if (!isStop) {
    args = await withResolvedAdapter(cap.adapterKind, step.machineId, rawArgs);
    found = await findSeparateGateApproval(rc);
  } else if (robotKind) {
    // A robot STOP never waits on the gate lookup: the robot dispatcher never verifies a stop's binding (L-7), so an
    // approval would change nothing. No adapter lookup either (robot kinds carry robotId).
    args = rawArgs;
    found = { reason: "noGate" };
  } else {
    // An OT STOP: the OT dispatcher exempts only a PINNED stop from the four-eyes re-check, so an UNPINNED stop step
    // still rides on a counting gate (refusing it here would refuse a stop that works today). Both lookups therefore
    // run CONCURRENTLY under ONE STOP DB-step deadline (R-1C-h, STOP_DB_STEP_DEADLINE_MS): the STOP waits at most that
    // long, never on a hung DB. Deadline/DB failure ⇒ adapter unresolved (the OT route refuses "adapterId required")
    // and/or no approval (self-confirmed row: a pinned stop passes, an unpinned one is refused NOT_CONFIRMED) — the
    // runtime stop path's own handling, logged here, never a silent hang.
    [args, found] = await Promise.all([
      withDeadline(withResolvedAdapter(cap.adapterKind, step.machineId, rawArgs), STOP_DB_STEP_DEADLINE_MS, `FOE stop step ${step.id} adapter lookup`).catch(
        (err: unknown) => {
          console.warn(`[FOE] run ${rc.runId} stop step ${step.id}: adapter lookup not answered — sent unresolved (L-7, F5): ${(err as Error)?.message ?? err}`);
          return rawArgs;
        },
      ),
      withDeadline(findSeparateGateApproval(rc), STOP_DB_STEP_DEADLINE_MS, `FOE stop step ${step.id} gate lookup`).catch((err: unknown) => {
        console.warn(`[FOE] run ${rc.runId} stop step ${step.id}: gate lookup not answered — sent without a gate approval (L-7, F5): ${(err as Error)?.message ?? err}`);
        return { reason: "noGate" as const };
      }),
    ]);
  }
  const approval = "approval" in found ? found.approval : null;
  const probe = buildEquipmentCommand(descriptor, cap, step.machineId, args, idempotencyKey, rc.user);
  if (!approval && !isStop) {
    // data-raw-ok: the code prefix FOE_GATE_REQUIRED(<reason>) is what the Studio keys its translated text on.
    return { kind: "failed", error: gateRequiredError(step.id, "reason" in found ? found.reason : "noGate") };
  }
  const cmd = approval ? buildEquipmentCommand(descriptor, cap, step.machineId, args, idempotencyKey, rc.user, approval) : probe;
  // fix round 3 (R-4-n) — a robot step with no robot never gets an authorisation row (it can never be sent; the robot
  // route below refuses it with the localisable INVALID_VALUE robotId/robotIdRequired).
  if (!(isRobotKind(cap.adapterKind) && cmd.robotId == null)) {
    await ensureOrchestrationAction(rc.user, idempotencyKey, step, args, cmd, approval ?? undefined);
  }

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
    runOwner: run.startedBy ?? null,
    aborting: false,
    controller: new AbortController(),
  };
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
  // doc 81 Đợt 4 fix round 1 (R-4-f) — four-eyes cannot be verified for a run with no owner ⇒ refused (fail-closed).
  if (gate.fourEyes === true && run.startedBy == null) {
    throw appError(
      "FORBIDDEN",
      "PERMISSION_DENIED",
      { action: "selfApproveOrchestrationGate" },
      `Gate "${gate.id}" requires four-eyes, but run ${run.id} has no attributable owner — it cannot be approved.`,
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

    // doc 81 Đợt 4 (R-4-n, final wave G3, R-4-j) — robot steps name an existing, enabled robot; OT stops a unique adapter.
    const refusal = await definitionRefusal(def, machineMap);
    if (refusal) return { ok: false, enabled: true, ...refusal };

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
  /**
   * ownerUserId — doc 81 Đợt 4 fix round 1 (R-4-f): the HUMAN who owns a run started by a non-user principal (API v1:
   * the API key's creating user). Ignored when `user` is a real user (id > 0).
   */
  opts?: { async?: boolean; ownerUserId?: number | null },
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
        workflowStatus: wf.status,
        message: `Workflow "${workflowRef}" is ${wf.status} — deploy it before running.`,
      };
    }

    const def = wf.definitionJson as WorkflowDefinition;
    // doc 81 Đợt 4 final wave G4 (re-review 3 A3-3) — a workflow activated BEFORE the R-4-j / R-4-n / G3 deploy checks is
    // re-checked here with the SAME checks: refused ⇒ no run is created. Final wave N1 (ruling R-4-w, L-7): ONLY non-stop
    // steps can refuse a start — a run that exists to STOP is never kept from starting; a defective stop step fails on its
    // own at runtime with its i18n error (R-4-n / R-4-j "runtime unchanged"), the other steps still go out.
    {
      const refs = validateWorkflow(def, null).referencedMachineIds;
      const refusal = await definitionRefusal(def, await loadMachines(refs), { nonStopOnly: true });
      if (refusal) return { ok: false, enabled: true, reason: refusal.reason, stepIds: refusal.stepIds, errors: refusal.errors, message: refusal.message };
    }
    const [run] = await d
      .insert(orchestrationRuns)
      .values({
        workflowId: wf.id,
        workflowRef: wf.ref,
        status: "queued",
        paramsJson: params ?? {},
        contextJson: {},
        startedBy: user.id || (opts?.ownerUserId != null && opts.ownerUserId > 0 ? opts.ownerUserId : null),
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
  const [wf] = await d.select().from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, run.workflowId)).limit(1);
  const wfDef = wf?.definitionJson as WorkflowDefinition | undefined;
  return {
    run,
    defHash: wfDef && Array.isArray(wfDef.steps) ? hashWorkflowDefinition(wfDef) : null,
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
  hooks: ResumeHooks = {},
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
    // doc 80 Đợt 1 Task 9 — the decider saw ANOTHER gate (run already moved on) ⇒ CONFLICT before
    // any state change. The CAS below pins the gate read here too (closes read→CAS window).
    if (decision.expectedStepId !== undefined && (decision.expectedStepId ?? null) !== (run.currentStepId ?? null)) {
      throw runGateChangedError(runId);
    }
    const pinnedStepId = run.currentStepId ?? null;

    if (!decision.approved) {
      // U6 (doc 26) — kèm lý do từ chối (note) vào audit của run + bước để truy vết.
      let reason = decision.note?.trim();
      if (hooks.compensate) {
        // doc 80 Đợt 1 Task 9 — CLAIM FIRST, compensate AFTER: CAS the paused run (gate pinned) to
        // 'compensating'; only the winner runs the compensations, then finishes 'compensating' →
        // 'aborted'. A restart mid-compensation leaves 'compensating' ⇒ rehydrate marks it failed
        // (never auto-resumed). An abort landing meanwhile stays 'aborted' (the final CAS below
        // only moves a run that is still 'compensating').
        await claimPausedRun(runId, "compensating", {}, pinnedStepId);
        let finalNote: string | undefined;
        try {
          finalNote = await hooks.compensate();
        } catch (err) {
          finalNote = [reason, `compensation threw: ${err instanceof Error ? err.message : String(err)}`].filter(Boolean).join(" · ");
        }
        reason = (finalNote ?? reason)?.trim() || reason;
        await d
          .update(orchestrationRuns)
          .set({
            status: "aborted",
            updatedAt: new Date(),
            finishedAt: new Date(),
            error: `Gate "${gateStepId ?? "?"}" rejected by user ${user.id}.${reason ? ` Reason: ${reason}` : ""}`,
          })
          .where(and(eq(orchestrationRuns.id, runId), eq(orchestrationRuns.status, "compensating")));
      } else {
        // doc 80 ORC-02 — CAS: only ONE decision (approve OR reject) may claim the paused run.
        await claimPausedRun(runId, "aborted", {
          finishedAt: new Date(),
          error: `Gate "${gateStepId ?? "?"}" rejected by user ${user.id}.${reason ? ` Reason: ${reason}` : ""}`,
        }, pinnedStepId);
      }
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

    // doc 81 Đợt 4 fix round 2 (R-4-k) — the approver must have been looking at THIS definition (a redeploy since their
    // screen loaded ⇒ their approval would be recorded against content they never saw) ⇒ CONFLICT, nothing changes.
    if (run.status === "awaiting_confirm" && decision.expectedDefHash !== undefined && decision.expectedDefHash !== hashWorkflowDefinition(def)) {
      throw appError(
        "CONFLICT",
        "OPERATION_FAILED",
        { operation: "resumeOrchestrationRun", reason: "definitionChanged" },
        `Workflow "${wf.ref}" was redeployed after your screen loaded — reload and review the current definition before approving.`,
      );
    }

    // doc 80 ORC-03 — approving a hitl_gate enforces its approverRoles / fourEyes (FORBIDDEN).
    // Only a run paused AT a gate ('awaiting_confirm'); an interrupted 'held' run has no open gate.
    if (run.status === "awaiting_confirm" && gateStepId) {
      const gate = findStepDeep(def.steps, gateStepId);
      if (gate && gate.type === "hitl_gate") assertGateApprover(gate, run, user);
    }

    // doc 80 ORC-02 — CAS `UPDATE … SET status='running' WHERE id=$1 AND status IN
    // ('awaiting_confirm','held') RETURNING *`: 0 rows ⇒ another resume already claimed it ⇒ CONFLICT.
    // Exactly one caller proceeds to drive the run. Task 9 — also pinned to the gate read above
    // (the one the approver-role check ran against): a run that moved on to another gate ⇒ CONFLICT.
    // fix round 1 (R-4-g) — the claim also CLEARS currentStepId: it only names the step a run is paused AT; leaving it
    // set made a later 'held' (interrupted) resume re-stamp a gate that had already passed.
    const pausedAtGate = run.status === "awaiting_confirm"; // read BEFORE the claim mutates the run
    await claimPausedRun(runId, "running", { currentStepId: null }, pinnedStepId);

    // Mark the OPEN gate resolved (completed) so the re-walk skips it. fix round 1 (R-4-g/R-4-h/R-4-e):
    //   • only for a run paused AT a gate ('awaiting_confirm') — a 'held' (interrupted) resume never writes or re-stamps
    //     a step: "Continue" is not an approval (the walk re-pauses at any gate not yet approved);
    //   • never over a gate row that is already 'completed' (its approval is kept as recorded);
    //   • approvedBy + approvalSource "server" only for a real user (ctx.user, id > 0); user 0 (system / API) ⇒
    //     approvalSource "system", no approvedBy (never counts);
    //   • defHash binds the approval to the definition the approver acted on (a redeploy makes it stale).
    if (gateStepId && pausedAtGate) {
      const prior = (await d.select().from(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, runId))).find(
        (r) => r.stepId === gateStepId,
      );
      if (prior?.status !== "completed") {
        const human = Number.isInteger(user.id) && user.id > 0;
        await upsertStep(runId, gateStepId, "hitl_gate", {
          status: "completed",
          result: {
            approved: true,
            note: decision.note ?? null,
            ...(human ? { approvedBy: user.id } : {}),
            approvalSource: human ? FOE_APPROVAL_SOURCE_SERVER : FOE_APPROVAL_SOURCE_SYSTEM,
            defHash: hashWorkflowDefinition(def),
          },
          finishedAt: new Date(),
        });
      }
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
  /** doc 80 Đợt 1 Task 9 — the gate this decision was made for (`IS NOT DISTINCT FROM`). */
  pinnedStepId: string | null,
): Promise<OrchestrationRun> {
  const d = await db();
  const claimed = await d
    .update(orchestrationRuns)
    .set({ status, updatedAt: new Date(), ...patch })
    .where(
      and(
        eq(orchestrationRuns.id, runId),
        inArray(orchestrationRuns.status, RESUMABLE_STATUSES),
        pinnedStepId != null ? eq(orchestrationRuns.currentStepId, pinnedStepId) : isNull(orchestrationRuns.currentStepId),
      ),
    )
    .returning();
  if (claimed.length === 0) {
    throw appError(
      "CONFLICT",
      "OPERATION_FAILED",
      { operation: "resumeOrchestrationRun", reason: "runAlreadyClaimed" },
      `Run ${runId} was already resumed, rejected or aborted by another request (or moved to another gate).`,
    );
  }
  return claimed[0];
}

/** doc 80 Đợt 1 Task 9 — the decider was looking at a gate the run has already left. */
function runGateChangedError(runId: number): TRPCError {
  return appError(
    "CONFLICT",
    "OPERATION_FAILED",
    { operation: "resumeOrchestrationRun", reason: "runGateChanged" },
    `Run ${runId} is no longer waiting at the gate you reviewed — reload to see the current gate.`,
  );
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
 * finished first stays finished and the caller is told so. After a successful write the
 * registry is read AGAIN (final review fix #1) so a driver that registered in between is
 * flagged too.
 *
 * CROSS-INSTANCE LIMIT: `liveRuns` is per process. When the run's driver lives in another
 * server instance, this abort only takes effect at that driver's NEXT guarded status write
 * (`setRunStatusUnlessAborted`); until then it may still execute steps. Closing that needs a
 * DB poll between steps (not in Đợt 0).
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
    // Final review fix #1 — the registry lookup above ran BEFORE the DB write: a driver that
    // registered + wrote 'running' in between (e.g. an async run whose setImmediate fired while
    // our UPDATE was in flight) was never flagged and would dispatch every remaining command
    // although this abort is acknowledged. Re-read the registry AFTER the write succeeded. Any
    // driver registering later still sees 'aborted' at its guarded 'running' write and stops.
    // NOTE: the registry is per-process — a driver alive in ANOTHER instance only notices the
    // abort at its next guarded status write (it may still run steps until then).
    const lateLive = liveRuns.get(runId);
    if (lateLive && !lateLive.aborting) {
      lateLive.aborting = true;
      lateLive.controller.abort();
    }
    void appendRunEvent(runId, "RUN_FAILED", { ts: Date.now(), data: { status: "aborted" } });
    return { ok: true, enabled: foeEnabled(), runId, status: "aborted" };
  } catch (err) {
    // data-raw-ok: như trên — lỗi một bước trong bộ thực thi quy trình.
    return { ok: false, enabled: foeEnabled(), runId, message: err instanceof Error ? err.message : String(err) };
  }
}
