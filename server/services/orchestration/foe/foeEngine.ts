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
  deviceTags, // final wave P-E1 — the scope-decision probe
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
import { getCapabilitiesForMachine, type AdapterKind } from "../../equipment/capabilityModel";
import {
  equipmentRegistry,
  type EquipmentCommand,
  type EquipmentCommandResult,
} from "../../equipment/equipmentAdapter";
import { asPackmlState } from "../../equipment/packml";
import { FOE_ENGINE_TOOL, otPayloadHash, robotPayloadHash, withFoeGateApproval, withOtPayloadHash, type FoeGateApproval } from "../../ot/otActionBinding"; // doc 81 Đợt 1B Task 6 + final wave (robot) + Đợt 4 A5
import { STOP_DB_STEP_DEADLINE_MS, isStopJob } from "../../robot/stopJob"; // final wave F5 — the STOP DB deadline; Đợt 6 — the robot stop classifier
import { withDeadline } from "../../ot/drivers/boundedClose"; // final wave F5 — bounded STOP-step lookups
import {
  evaluateGateApprovals,
  computeBindingDigest,
  findStepDeep,
  hashWorkflowDefinition,
  FOE_APPROVAL_SOURCE_SERVER,
  FOE_APPROVAL_SOURCE_SYSTEM,
  FOE_API_RUN_PARAM,
  runStartedViaApi,
  type GateRequiredReason,
} from "./foeGateApproval"; // doc 81 Đợt 4 fix round 1 (R-4-e … R-4-i); Đợt 5 E1 (apiRun)
import { toRobotJob } from "../../equipment/robotJobMapping"; // final wave (item 2) — same mapping the robot route uses
import {
  allStepsOf,
  buildEquipmentCommand,
  commandOf,
  isOtStopCommandType,
  isRobotKind,
  isStopCandidate,
  orchestrationActionId,
  subtreeHasStopCandidate,
  makeStopVerifier,
  type StopVerification,
  type StopVerifier,
} from "./foeStepClass"; // doc 81 Đợt 5 task E fix 1 (R-5-j) — THE step walk + stop classification
export { buildEquipmentCommand } from "./foeStepClass";
import {
  collectTargets,
  isOutOfScopeEmpty,
  makeScopeJudge,
  resolveUserFoeScope,
  stepsTouching,
  type FoeScope,
  type OutOfScope,
} from "./foeScope"; // doc 81 Đợt 5 task E2 — factory scope (item 26)
export type { FoeScope } from "./foeScope";

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
  /**
   * doc 81 Đợt 5 task E2 — the deployer's factory scope. Omitted (undefined) ⇒ resolved from `user` (a real user ⇒ their
   * assignments; a non-user principal ⇒ EMPTY scope). `null` = explicitly unrestricted (a `global` API key).
   */
  scope?: FoeScope;
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
  reason?: DefinitionRefusalReason | typeof FOE_SCOPE_UNVERIFIED | typeof FOE_ABORT_UNCONFIRMED;
  stepIds?: string[];
  /**
   * doc 81 Đợt 6 (owner decision 2026-10-11) — set on an abort that went past its scope check: what happened to the
   * run's remaining STOP steps and due STOP compensations (see abortStopSweep).
   */
  abortStops?: AbortStopReport;
}

/**
 * doc 81 Đợt 6 — the outcome of an abort's STOP sweep, by step id (a compensation is listed under its own id).
 *   sent        — a real STOP handed to the dispatcher, which accepted it (abortStopSent);
 *   failed      — a real STOP that could not be sent, or that the dispatcher refused / errored (abortStopFailed);
 *   pending     — a real STOP handed to the dispatcher whose answer had not come when the abort answered (it keeps
 *                 running; the answer is recorded when it arrives);
 *   unverified  — a step that may be a STOP but could not be verified as one (pins / connection / machine unreadable):
 *                 NOT sent (no exemption on a guess), audited (abortStopUnverified);
 *   untakenBranch — real or possible STOPs inside a branch whose condition was never evaluated: NOT sent (no guess),
 *                 audited (abortStopSkippedUntakenBranch);
 *   notPinned   — stop-TYPED OT steps that are not a pinned stop (not a real STOP, R-5-j): not sent, audited
 *                 (abortStopNotPinned) so the operator is told;
 *   notNeeded   — fix 1 (R-6-b): real STOPs NOT sent because the run never actuated (no non-STOP command attempted),
 *                 audited (abortStopNotNeeded).
 */
export interface AbortStopReport {
  sent: string[];
  failed: string[];
  pending: string[];
  unverified: string[];
  untakenBranch: string[];
  notPinned: string[];
  notNeeded: string[];
}

/** doc 81 Đợt 4 (R-4-j, R-4-n, final wave G3) — why a definition was refused (deploy, and since G4 run start). */
export type DefinitionRefusalReason =
  | "stopAdapterAmbiguous"
  | "robotIdMissing"
  | "robotUnavailable"
  | "robotDisabled"
  /** doc 81 Đợt 5 task E2 — a step touches a machine / robot / adapter outside the deployer's factory scope. */
  | "outOfScope"
  /** doc 81 Đợt 5 task E2 — the ref belongs to an existing workflow that touches targets outside the deployer's scope. */
  | "refOutOfScope";

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
const liveRuns = new Map<number, RunContext>();

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
  /**
   * doc 81 Đợt 5 task E1 (item 24, option C) — the run was started through an API key (server-written markers, see
   * foeGateApproval.runStartedViaApi). Its OT/robot steps other than a STOP are never sent (reason apiRun).
   */
  startedViaApi: boolean;
  /**
   * doc 81 Đợt 6 — what an abort's STOP sweep needs to know about THIS walk (in memory, never awaited):
   *   • `dispatched` — command steps (compensations included) whose `sendCommand` was CALLED: a STOP among them is
   *     already on its way and is let finish — the sweep never sends it again;
   *   • `startOrder` — step ids in the order they started (their running row), after the earlier segments' (`prior`);
   *   • `settled` — steps that finished in this walk (completed / skipped) or failed on their own (not by the abort).
   * `prior` is the same picture of the earlier walk segments, read from the step rows when the context was built.
   */
  dispatched: Set<string>;
  startOrder: string[];
  settled: Set<string>;
  prior: PriorSteps;
  /** fix 1 (R-6-b) — command steps (compensations included) whose `sendCommand` was CALLED in this walk, whatever came back. */
  attempted: Set<string>;
}

/** doc 81 Đợt 6 — the step rows of a run, as the abort sweep reads them (see priorStepsOf). */
interface PriorSteps {
  /** completed / skipped / compensated / failed, or carrying a dispatcher result (the command left the engine). */
  settled: Set<string>;
  /** steps that started (a startedAt or a started status), oldest first. */
  startOrder: string[];
  /** `branch:<id>` decisions recorded on branch rows. */
  branches: Map<string, "then" | "else">;
  /**
   * fix 1 (R-6-b) — steps that MAY have been handed to a dispatcher, counted conservatively: a dispatcher result is
   * recorded, or the row is running / completed / failed / compensated (a failure after the hand-over may have no result).
   */
  attempted: Set<string>;
  /** fix 2 (R-6-c) — true ⇔ the rows could not be read at all (no DB): whether the run acted is UNKNOWN ⇒ counted as acted. */
  unknown: boolean;
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
async function loadCompletedSteps(runId: number): Promise<{ completed: Set<string>; prior: PriorSteps }> {
  const set = new Set<string>();
  const d = await getDb();
  if (!d) return { completed: set, prior: { ...priorStepsOf([]), unknown: true } }; // fix 2 (R-6-c): unknown, not empty
  const rows = await d
    .select()
    .from(orchestrationRunSteps)
    .where(eq(orchestrationRunSteps.runId, runId));
  for (const r of rows) {
    if (r.status === "completed" || r.status === "skipped") set.add(r.stepId);
  }
  return { completed: set, prior: priorStepsOf(rows) }; // doc 81 Đợt 6 — same read, the abort sweep's picture
}

/** doc 81 Đợt 6 fix 2 (N5) — run-context key: the command steps handed to a dispatcher (see execCommand). */
const DISPATCHED_CTX_KEY = "foeDispatchedSteps";

/** doc 81 Đợt 6 — the step rows written by an abort's STOP sweep (`abort:<stepId>`; never a definition step). */
const ABORT_ROW_PREFIX = "abort:";

/**
 * doc 81 Đợt 6 — the abort sweep's picture of a run from its step rows (pure). A row whose command left the engine
 * (a dispatcher result is recorded) or that finished / failed counts as settled: a STOP there is never sent again.
 */
function priorStepsOf(rows: ReadonlyArray<{ id?: number; stepId: string; status: string; resultJson?: unknown; startedAt?: Date | null }>): PriorSteps {
  const settled = new Set<string>();
  const branches = new Map<string, "then" | "else">();
  const started: Array<{ stepId: string; at: number; id: number }> = [];
  const attempted = new Set<string>();
  for (const r of rows) {
    if (r.stepId.startsWith(ABORT_ROW_PREFIX)) continue;
    const result = (r.resultJson ?? null) as Record<string, unknown> | null;
    if (["completed", "skipped", "compensated", "failed"].includes(r.status) || typeof result?.routedTo === "string") settled.add(r.stepId);
    if (["running", "completed", "failed", "compensated"].includes(r.status) || typeof result?.routedTo === "string") attempted.add(r.stepId);
    if (result?.branch === "then" || result?.branch === "else") branches.set(r.stepId, result.branch);
    if (r.startedAt || ["running", "completed", "failed", "compensated"].includes(r.status)) {
      const at = r.startedAt ? new Date(r.startedAt).getTime() : Number.MAX_SAFE_INTEGER;
      started.push({ stepId: r.stepId, at: Number.isFinite(at) ? at : Number.MAX_SAFE_INTEGER, id: r.id ?? 0 });
    }
  }
  started.sort((a, b) => a.at - b.at || a.id - b.id);
  return { settled, branches, startOrder: started.map((s) => s.stepId), attempted, unknown: false };
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
  /**
   * doc 81 Đợt 5 final wave P-E2 — write ONLY while the run is in one of these statuses (a guard evaluated when the UPDATE
   * lands): a bounded write that lands LATE (after the run already ended / paused) must not regress it.
   */
  onlyFrom?: Array<OrchestrationRun["status"]>,
): Promise<boolean> {
  const d = await getDb();
  if (!d) return false;
  const written = await d
    .update(orchestrationRuns)
    .set({ status, updatedAt: new Date(), ...patch })
    .where(
      and(
        eq(orchestrationRuns.id, runId),
        ne(orchestrationRuns.status, "aborted"),
        onlyFrom ? inArray(orchestrationRuns.status, onlyFrom) : undefined,
      ),
    )
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
      // doc 81 Đợt 5 task E fix 1 (review #13) — a 'running' write (issued before, landing after a bounded STOP moved on)
      // never overwrites a FINISHED step (completed / skipped / compensated): the row cannot regress, so a resume never
      // re-sends a STOP that completed. Every other transition is unconditional, as before.
      ...(patch.status === "running"
        ? { setWhere: notInArray(orchestrationRunSteps.status, ["completed", "skipped", "compensated"] as never[]) }
        : {}),
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
async function checkPrecondition(rc: RunContext, step: WorkflowStep, stop = false): Promise<StepOutcome | null> {
  if (!step.precondition) return null;
  // refresh any machine readbacks the condition needs (E fix 1 — bounded on a STOP's path)
  await stopBoundedReadbacks(stop, rc, step.id, step.precondition);
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

/**
 * doc 81 Đợt 5 task E4 (items 35+36) — is this step a STOP command (the SAME classification execCommand uses: robot ⇒ the
 * job toRobotJob maps it to is a stop; OT ⇒ the dispatcher's stop-type predicate)? No DB access (machine rows are in rc).
 */
async function isStopCommandStep(rc: RunContext, step: WorkflowStep): Promise<boolean> {
  if (step.type === "command") return isStopCandidate(step, rc.machineById);
  // doc 81 Đợt 5 task E fix 1 (review #6) — a CONTAINER (sequence / parallel / branch) whose subtree holds a STOP: its own
  // bookkeeping (running / completed rows, a branch's condition read-back) is on that STOP's path ⇒ bounded too.
  if (step.type === "sequence" || step.type === "parallel" || step.type === "branch") return subtreeHasStopCandidate(step, rc.machineById);
  return false;
}

/**
 * doc 81 Đợt 5 task E fix 1 (review #13) — a STOP step's (or a STOP-holding container's) condition read-backs (device
 * reads through the adapters) are bounded by the STOP deadline; past it the condition is evaluated on what was read.
 *
 * ★ WORST-CASE DELAY OF A STOP (D = STOP_DB_STEP_DEADLINE_MS = 1 s; every bounded wait is ≤ D, the gate / adapter lookups
 *   of an OT STOP run CONCURRENTLY under ONE D). A STOP at container depth L is dispatched at most (L + 4)·D after the walk
 *   reaches its outermost STOP-holding container: L container 'running' rows (a branch adds its condition read-back,
 *   ≤ D more), its own precondition read-back, its own 'running' row, the lookups, its authorisation row (robot STOP: none).
 *   After the dispatch it costs ≤ 2·D (result + completed rows) before the walk moves on, so in a run of STOP steps the k-th
 *   STOP is dispatched within (L + 4 + 6·(k − 1))·D (+ L·D for branch read-backs). A NON-stop step before a STOP is
 *   awaited as before (sequence semantics — not a STOP's own bookkeeping).
 *   E fix 2 (review N1) — a STOP COMPENSATION of a failing step is dispatched within 4·D after the step's body returns:
 *   the step's failed row (≤ D), the run's 'compensating' status (≤ D), the compensation's running row (≤ D), its
 *   lookups / authorisation row (≤ D, ≤ D) — i.e. ≤ 5·D. (The failing step's OWN body is not a STOP — it is awaited as before.)
 */
async function stopBoundedReadbacks(stop: boolean, rc: RunContext, stepId: string, c: Condition | undefined): Promise<void> {
  if (!stop) return refreshConditionReadbacks(rc, c);
  await withDeadline(refreshConditionReadbacks(rc, c), STOP_DB_STEP_DEADLINE_MS, `FOE stop step ${stepId} read-back`).catch((err: unknown) => {
    console.warn(`[FOE] run ${rc.runId} stop step ${stepId}: condition read-back not answered in time — evaluated on the last values (L-7): ${(err as Error)?.message ?? err}`);
  });
}

/**
 * doc 81 Đợt 5 task E4 (item 36, L-7) — a STOP step's own bookkeeping write (step row, authorisation row) waits at most
 * STOP_DB_STEP_DEADLINE_MS, and a failing write never holds the STOP: it is logged and the STOP continues to the
 * dispatcher, whose own error path decides (OT: no authorisation row ⇒ NOT_CONFIRMED, visibly). A non-STOP write is
 * awaited exactly as before.
 */
async function stopBoundedWrite(stop: boolean, runId: number, stepId: string, what: string, write: () => Promise<void>): Promise<void> {
  if (!stop) return write();
  await withDeadline(write(), STOP_DB_STEP_DEADLINE_MS, `FOE stop step ${stepId} ${what}`).catch((err: unknown) => {
    console.warn(`[FOE] run ${runId} stop step ${stepId}: ${what} not written in time — the STOP continues (L-7, E4): ${(err as Error)?.message ?? err}`);
  });
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

  // doc 81 Đợt 5 task E4 (item 36) + E fix 1 — on a STOP's path (a STOP step, or a container holding one) the step's own
  // bookkeeping never waits on a hung DB / device: bounded (L-7). Classified FIRST (no DB).
  const stop = await isStopCommandStep(rc, step);

  // Precondition / interlock
  const pre = await checkPrecondition(rc, step, stop);
  if (pre) {
    if (pre.kind === "skipped") {
      rc.settled.add(step.id); // doc 81 Đợt 6
      await stopBoundedWrite(stop, rc.runId, step.id, "skipped row", () =>
        upsertStep(rc.runId, step.id, step.type, { status: "skipped", finishedAt: new Date() }),
      );
    } else {
      const preOutcome = pre;
      await stopBoundedWrite(stop, rc.runId, step.id, "held row", () =>
        upsertStep(rc.runId, step.id, step.type, {
          status: preOutcome.kind === "aborted" ? "failed" : "held",
          error: "error" in preOutcome ? preOutcome.error : null,
          finishedAt: new Date(),
        }),
      );
    }
    return pre;
  }

  rc.startOrder.push(step.id); // doc 81 Đợt 6 — its compensation is due on an abort from here on
  await stopBoundedWrite(stop, rc.runId, step.id, "running row", () =>
    upsertStep(rc.runId, step.id, step.type, { status: "running", startedAt: new Date() }),
  );

  let outcome: StepOutcome;
  const maxAttempts = Math.max(1, (step.maxAttempts ?? 0) + 1);
  let attempt = 0;
  // retry loop (deterministic; only command/wait steps benefit, others run once)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    outcome = await runStepBody(rc, step, attempt, stop);
    if (outcome.kind !== "failed" || attempt >= maxAttempts) break;
  }

  // doc 81 Đợt 6 — finished, or failed ON ITS OWN (an 'aborted' outcome is the abort's: the sweep decides about it)
  if (outcome.kind === "ok" || outcome.kind === "skipped" || outcome.kind === "failed") rc.settled.add(step.id);
  // persist terminal step state (paused steps stay 'awaiting_confirm'/'held')
  if (outcome.kind === "ok") {
    // E4 — bounded for a STOP too, so a following STOP of the same walk is never held behind this write.
    await stopBoundedWrite(stop, rc.runId, step.id, "completed row", () =>
      upsertStep(rc.runId, step.id, step.type, { status: "completed", attempt, finishedAt: new Date() }),
    );
  } else if (outcome.kind === "skipped") {
    await stopBoundedWrite(stop, rc.runId, step.id, "skipped row", () =>
      upsertStep(rc.runId, step.id, step.type, { status: "skipped", attempt, finishedAt: new Date() }),
    );
  } else if (outcome.kind === "paused") {
    // step-level status already set by the body (awaiting_confirm)
  } else {
    // failed / aborted → run compensation if declared (E4: a STOP's failure row is bounded too). E fix 2 (review N1) — a
    // step whose COMPENSATION holds a STOP: its failed row is on that STOP's path ⇒ bounded as well.
    const failedOutcome = outcome;
    const compStop = step.compensation ? await isStopCommandStep(rc, step.compensation) : false;
    await stopBoundedWrite(stop || compStop, rc.runId, step.id, "failed row", () =>
      upsertStep(rc.runId, step.id, step.type, {
        status: "failed",
        attempt,
        error: "error" in failedOutcome ? failedOutcome.error : null,
        finishedAt: new Date(),
      }),
    );
    // doc 80 ORC-01 — a USER abort must not dispatch anything after the abort instant, so the
    // saga compensation (which issues commands) is NOT run while the run is aborting.
    // doc 81 Đợt 6 — the abort's sweep sends the STOP compensations that are due (only those), not this walk.
    if (step.compensation && !rc.aborting) {
      await runCompensation(rc, step);
    }
  }
  return outcome;
}

/** Run the inner logic of a single step (after precondition + status=running). */
async function runStepBody(rc: RunContext, step: WorkflowStep, attempt: number, stop = false): Promise<StepOutcome> {
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
          await stopBoundedReadbacks(stop, rc, step.id, step.condition); // E fix 1 — bounded when a STOP is inside
          take = evaluateCondition(step.condition, evalCtxOf(rc));
          rc.context[`branch:${step.id}`] = take ? "then" : "else";
        }
        await stopBoundedWrite(stop, rc.runId, step.id, "branch row", () =>
          upsertStep(rc.runId, step.id, step.type, {
            status: "running",
            result: { branch: take ? "then" : "else" },
          }),
        );
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
    // doc 81 Đợt 5 task E1 — an API-started run never has a counting approval (option C). The in-memory flag (read when
    // the walk was built) AND the run row as it is now: either marker ⇒ apiRun (fail-closed).
    if (rc.startedViaApi) return { reason: "apiRun" };
    const d = await getDb();
    if (!d) return { reason: "noGate" };
    const [runNow] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, rc.runId)).limit(1);
    if (!runNow) return { reason: "noGate" };
    if (runStartedViaApi(runNow)) return { reason: "apiRun" };
    const rows = await d.select().from(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, rc.runId));
    // doc 81 Đợt 5 task E3 — recompute the binding digest from the device configuration NOW (server side).
    const ev = evaluateGateApprovals(rows, rc.def, hashWorkflowDefinition(rc.def), rc.runOwner, await computeBindingDigest(d, rc.def));
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
      "the workflow was redeployed, or the adapter / tag / robot configuration its commands use changed, after the gate was approved, so the approval does not cover what would be sent now. Start a new run and have the gate approved again.",
    ownerUnknown:
      "the run has no attributable owner (started by the system or by an API key with no creating user), so a separate approval cannot be verified. Start the run as a user.",
    apiRun:
      "the run was started through an API key. A run started through an API key never sends OT or robot commands other than a STOP: the person holding the key cannot be told apart from the approver. Start the run as a user in the Orchestration Studio.",
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
 * doc 81 Đợt 4 final wave G3 (re-review 3 A3-2) + N1 (R-4-w) + R-4-x — robot steps whose args.robotId names a robot that
 *   • does not EXIST (`missing`) — any robot step, a stop included: it could never be sent;
 *   • exists but is NOT ENABLED (`disabled`) — MOTION steps only (R-4-x): `robots.isEnabled` is the gate for motion, while
 *     a stop/abort/e_stop to a disabled robot still goes out (the dispatcher sends stops to the boot-loaded active set).
 * A DB error counts every robot step as `missing` (fail-closed; at run START the caller drops the stop steps, R-4-w).
 * Steps without a valid robotId are robotStepsWithoutRobotId's. Orchestration has no tenant scope (pre-existing).
 */
async function robotStepsWithUnavailableRobot(
  def: WorkflowDefinition,
  machineMap: Map<number, MachineForValidation>,
  stops: Set<string>,
): Promise<{ missing: string[]; disabled: string[] }> {
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
  if (wanted.length === 0) return { missing: [], disabled: [] };
  let enabledById: Map<number, boolean>;
  try {
    const d = await getDb();
    if (!d) return { missing: wanted.map((w) => w.stepId), disabled: [] };
    const rows = await d.select().from(robots).where(inArray(robots.id, [...new Set(wanted.map((w) => w.robotId))]));
    enabledById = new Map(rows.map((r) => [r.id, r.isEnabled === true] as const));
  } catch {
    return { missing: wanted.map((w) => w.stepId), disabled: [] };
  }
  return {
    missing: wanted.filter((w) => !enabledById.has(w.robotId)).map((w) => w.stepId),
    // R-4-x — a disabled robot offends only for a MOTION step
    disabled: wanted.filter((w) => enabledById.get(w.robotId) === false && !stops.has(w.stepId)).map((w) => w.stepId),
  };
}

/**
 * Final wave N1 (ruling R-4-w) — ids of the STOP command steps of a definition (robot: the job toRobotJob maps the step to
 * is a stop — the same classification execCommand uses; OT: the dispatcher's stop-type predicate). Used so the run-START
 * check never refuses a run because of a stop step (L-7): a defective stop step fails on its own at runtime, as before.
 */
async function stopStepIdsOf(def: WorkflowDefinition, machineMap: Map<number, MachineForValidation>): Promise<Set<string>> {
  // doc 81 Đợt 5 task E fix 1 (ruling R-5-j) — an EXEMPTION is given only to a VERIFIED stop (robot stop job, or an OT
  // PINNED stop on the adapter it writes through) — never on the command name. foeStepClass.verifiedStopStepIds.
  return (await verifiedStopsOf(def, machineMap)).ids;
}

/**
 * The verified stops + whether a lookup failed (no exemption for what could not be verified). Never throws. `unsure` null
 * ⇔ the classification itself failed (which steps are unsure is not known — final wave F3: any "out" is then undecided).
 */
async function verifiedStopsOf(
  def: WorkflowDefinition,
  machineMap: Map<number, MachineForValidation>,
  verifier?: StopVerifier,
): Promise<Omit<StopVerification, "unsure"> & { unsure: Set<string> | null }> {
  try {
    const v = verifier ?? (await makeStopVerifier((await getDb()) ?? null, [def], machineMap));
    return await v.verified(def, machineMap);
  } catch {
    return { ids: new Set(), failed: true, unsure: null };
  }
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
  const stops = await stopStepIdsOf(def, machineMap);
  const keep = (ids: string[]) => (opts.nonStopOnly ? ids.filter((id) => !stops.has(id)) : ids);
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
  // final wave G3 / N1 / R-4-x — the named robot must exist (every robot step at deploy; non-stop at start) …
  const robotCheck = await robotStepsWithUnavailableRobot(def, machineMap, stops);
  const unavailable = keep(robotCheck.missing);
  if (unavailable.length > 0) {
    return {
      reason: "robotUnavailable",
      stepIds: unavailable,
      errors: unavailable.map((id) => ({
        path: `step:${id}`,
        message: `Robot step "${id}" names a robot that does not exist (or the robot list could not be read) — at run time it could not be sent. Pick an existing robot for the step.`,
      })),
      message: `Robot step(s) ${unavailable.join(", ")} name a robot that does not exist (or the robot list could not be read) — pick an existing robot for each step.`,
    };
  }
  // … and R-4-x — a MOTION step's robot must also be ENABLED (at deploy AND at start; stop steps are never in this list).
  const disabled = robotCheck.disabled;
  if (disabled.length > 0) {
    return {
      reason: "robotDisabled",
      stepIds: disabled,
      errors: disabled.map((id) => ({
        path: `step:${id}`,
        message: `Motion step "${id}" names a robot that is not enabled — motion to a disabled robot is not allowed. Enable the robot or pick an enabled one.`,
      })),
      message: `Motion step(s) ${disabled.join(", ")} name a robot that is not enabled — enable the robot or pick an enabled one for each step.`,
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

// ── doc 81 Đợt 5 task E2 (item 26) — FACTORY SCOPE (rule + targets: foeScope.ts header) ───────────────────────────

/** The scope an engine call acts under: the caller's explicit one, else the one of `user` (fail-closed for non-users). */
function scopeFor(user: FoeUser, explicit: FoeScope | undefined): FoeScope {
  return explicit !== undefined ? explicit : resolveUserFoeScope(user);
}

/** A definition's targets + its STOP step ids (same classification execCommand uses). */
async function definitionTargets(def: WorkflowDefinition, machineMap?: Map<number, MachineForValidation>, verifier?: StopVerifier) {
  const map = machineMap ?? (await loadMachines(validateWorkflow(def, null).referencedMachineIds));
  // E fix 1 (R-5-j) — only a VERIFIED stop makes a target "STOP-only" (an unpinned stop-typed write is a NON-stop target).
  const v = await verifiedStopsOf(def, map, verifier);
  // final wave F3 — the targets IF every unsure step (pinned, connection not confirmed / pins unreadable) were a stop:
  // what a decision needs to tell "out whatever those steps are" (decided) from "out only because of them" (undecided).
  const unsureTargets = v.unsure && v.unsure.size > 0 ? collectTargets(def, map, new Set([...v.ids, ...v.unsure])) : null;
  return { targets: collectTargets(def, map, v.ids), stops: v.ids, stopsFailed: v.failed, unsureTargets };
}

type ScopeDecision = "in" | "out" | "unknown";

/**
 * doc 81 Đợt 5 final wave F3 — the READ / abort / reject decision for ONE definition: "in" (every non-STOP target in scope),
 * "out" (out of scope WHATEVER the unverified steps are) or "unknown" (out only because a step that may be a pinned STOP
 * could not be verified — e.g. its adapter is down or reconnecting — or a lookup failed). Never "out" on a guess.
 */
async function decideDefinition(
  judge: Awaited<ReturnType<typeof makeScopeJudge>>,
  def: WorkflowDefinition,
  machineMap?: Map<number, MachineForValidation>,
  verifier?: StopVerifier,
): Promise<ScopeDecision> {
  const { targets, stopsFailed, unsureTargets } = await definitionTargets(def, machineMap, verifier);
  const out = await judge.outOf(targets, { nonStopOnly: true });
  if (judge.failed) return "unknown";
  if (isOutOfScopeEmpty(out)) return "in";
  if (!stopsFailed) return "out";
  if (!unsureTargets) return "unknown"; // the classification failed as a whole
  const outIfStops = await judge.outOf(unsureTargets, { nonStopOnly: true });
  if (judge.failed) return "unknown";
  return isOutOfScopeEmpty(outIfStops) ? "unknown" : "out";
}

/**
 * final wave P-E1 — one row of every table a scope decision may read (workflows, machines, adapters, stop-pin tags,
 * robots), read for an existing AND a missing run id alike: when one of them cannot be read, a missing id is as undecided
 * as an existing run whose decision needed it (the SAME "scope not verified" answer — no existence oracle). Never throws.
 */
async function scopeDecisionProbe(d: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<boolean> {
  try {
    await Promise.all([
      d.select({ id: orchestrationWorkflows.id }).from(orchestrationWorkflows).limit(1),
      d.select({ id: machines.id }).from(machines).limit(1),
      d.select({ id: deviceAdapters.id }).from(deviceAdapters).limit(1),
      d.select({ id: deviceTags.id }).from(deviceTags).limit(1),
      d.select({ id: robots.id }).from(robots).limit(1),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * doc 81 Đợt 5 task E fix 1 (ruling R-5-i → R-5-l) — the scope decision for an ABORT / REJECTION: "in" | "out" | "unknown".
 * Any lookup failure (scope resolution, machines, pins, adapters, robots) ⇒ "unknown" — never a guess; "unknown" ⇒ REFUSED
 * (R-5-l, scopeUnverified); only a DECIDED "out" is answered "not found".
 * final wave F5 / P-E1 — the run row is read HERE (inside the caller's STOP-deadline bound, not before it), together with
 * the judge and the probe; a missing id takes the same reads as an existing one, and a decision other than "in" stands
 * only when the probe read every table (else "unknown" — for an existing and a missing id alike).
 * F3 — a definition out of scope only because of a pinned STOP whose connection is not confirmed ⇒ "unknown".
 */
async function runScopeDecision(runId: number, scope: FoeScope): Promise<{ verdict: ScopeDecision; run: OrchestrationRun | undefined }> {
  let run: OrchestrationRun | undefined;
  try {
    const d = await getDb();
    if (!d) return { verdict: "unknown", run };
    const probe = scopeDecisionProbe(d); // never rejects
    const [rows, judge] = await Promise.all([d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1), makeScopeJudge(scope)]);
    run = rows[0];
    if (judge.failed) return { verdict: "unknown", run };
    if (judge.unrestricted) return { verdict: "in", run };
    const [wf] = await d.select().from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, run?.workflowId ?? -1)).limit(1);
    const def = wf?.definitionJson as WorkflowDefinition | undefined;
    const verdict: ScopeDecision = def && Array.isArray(def.steps) ? await decideDefinition(judge, def) : "out";
    if (verdict === "in") return { verdict, run };
    return { verdict: (await probe) ? verdict : "unknown", run };
  } catch {
    return { verdict: "unknown", run };
  }
}

/** R-5-i / F5 — runScopeDecision (run read included) bounded by STOP_DB_STEP_DEADLINE_MS (timeout ⇒ "unknown", no run). */
async function boundedRunScopeDecision(
  runId: number,
  scope: FoeScope,
  label: string,
): Promise<{ verdict: ScopeDecision; run: OrchestrationRun | undefined }> {
  return withDeadline(runScopeDecision(runId, scope), STOP_DB_STEP_DEADLINE_MS, label).catch(() => ({ verdict: "unknown" as const, run: undefined }));
}

/**
 * doc 81 Đợt 5 task E fix 2 (ruling R-5-l, replaces R-5-i) — an abort / rejection whose scope could not be DECIDED within
 * the bound is REFUSED (an abort or a rejection skips the run's later NON-STOP steps and — Đợt 6 + fix 1 R-6-a — sends its
 * remaining STOPs: a cross-factory abort / rejection is a mutation of another factory's run; no equipment STOP path goes through here — the
 * direct STOP / E-STOP of the machine is unaffected; doc 81 Đợt 6 keeps this check in front of the abort's STOP sweep). The answer
 * is distinct from "not found" and is the SAME for a nonexistent id whose lookup was undecided (no oracle).
 */
export const FOE_SCOPE_UNVERIFIED = "scopeUnverified" as const;
const SCOPE_UNVERIFIED_MESSAGE = "Scope not verified — retry. To stop equipment now, use the machine's direct STOP / E-STOP.";

function scopeUnverifiedAnswer(runId: number): StartRunResult {
  return { ok: false, enabled: foeEnabled(), runId, reason: FOE_SCOPE_UNVERIFIED, message: SCOPE_UNVERIFIED_MESSAGE };
}

/** R-5-l — the refusal is logged SYNCHRONOUSLY (console, always) and audited, the audit bounded by the STOP DB deadline. */
async function auditScopeUnverified(user: FoeUser, runId: number, action: "abort" | "reject"): Promise<void> {
  console.error(`[FOE] ${action} of run ${runId} by user ${user.id || 0} (${user.role}) REFUSED: factory scope not verified within ${STOP_DB_STEP_DEADLINE_MS} ms (R-5-l)`);
  const write = (async () => {
    const { logCrudOperation, createAuditContext } = await import("../../auditTrailService");
    await logCrudOperation(createAuditContext({ user: { id: user.id || 0, name: user.name ?? user.role } }), {
      action: "config_change",
      entityType: "orchestration_run",
      entityId: runId,
      details: { operation: "foe_scope_unverified", metadata: { runId, action, outcome: "refused", reason: FOE_SCOPE_UNVERIFIED } },
      status: "failure",
    });
  })();
  await withDeadline(write, STOP_DB_STEP_DEADLINE_MS, `FOE ${action} run ${runId} scopeUnverified audit`).catch((err: unknown) => {
    console.error(`[FOE] ${action} of run ${runId}: scopeUnverified audit not written: ${(err as Error)?.message ?? err}`);
  });
}

/**
 * doc 81 Đợt 5 task E fix 1 (review #8) — the ids of the workflows `scope` may see (null = unrestricted), so list
 * queries filter IN SQL before their LIMIT. Any error ⇒ [] (fail-closed).
 */
export async function visibleWorkflowIds(scope: FoeScope): Promise<number[] | null> {
  const r = await resolveVisibleWorkflowIds(scope);
  // final wave F3 — undecided: only the DECIDED-visible workflows (an undecided one is left out — fail-closed per item, as
  // getRun / getWorkflow answer "not found" for it), instead of hiding every row because one definition is undecided.
  return r.ok ? r.ids : r.decidedIds ?? [];
}

/**
 * doc 81 Đợt 5 task E fix 2 (review N3, N4) — visibleWorkflowIds that SAYS when it could not decide (`ok: false`) so a
 * count can be shown as degraded instead of a misleading 0. ONE definitions read, ONE judge, one batched verifier.
 * final wave F3 — `decidedIds` (only when the scope itself was resolved): the workflows DECIDED visible while some other
 * definition is undecided (e.g. its only foreign target is a pinned STOP whose adapter is down). Never an undecided one.
 */
export async function resolveVisibleWorkflowIds(
  scope: FoeScope,
): Promise<{ ok: true; ids: number[] | null } | { ok: false; decidedIds?: number[] }> {
  try {
    const judge = await makeScopeJudge(scope);
    if (judge.unrestricted && !judge.failed) return { ok: true, ids: null };
    const d = await getDb();
    if (!d) return { ok: false };
    const rows = await d.select({ id: orchestrationWorkflows.id, definitionJson: orchestrationWorkflows.definitionJson }).from(orchestrationWorkflows);
    const r = await filterVisibleWith(judge, rows, (x) => x.definitionJson as WorkflowDefinition);
    if (r.failed) return judge.failed ? { ok: false } : { ok: false, decidedIds: r.keep.map((x) => x.id) };
    return { ok: true, ids: r.keep.map((x) => x.id) };
  } catch {
    return { ok: false };
  }
}

/** doc 81 Đợt 5 task E fix 1 — of `runIds`, those whose workflow `scope` may see (the "assignments" column, census). */
export async function visibleRunIds(runIds: number[], scope: FoeScope): Promise<Set<number>> {
  try {
    if (runIds.length === 0) return new Set();
    const d = await getDb();
    if (!d) return new Set();
    const rows = await d.select({ id: orchestrationRuns.id, workflowId: orchestrationRuns.workflowId }).from(orchestrationRuns).where(inArray(orchestrationRuns.id, runIds));
    return new Set((await filterRunsVisibleTo(rows, scope)).map((r) => r.id));
  } catch {
    return new Set();
  }
}

/**
 * doc 81 Đợt 5 task E2 — deploy / rollback (`nonStopOnly` false: EVERY step, STOPs included — deploy is never urgent) and
 * the start / approval rule (`nonStopOnly`: only targets referenced outside a STOP step).
 * `stopOnlyOut` = targets referenced ONLY by STOP steps that are out of scope (allowed at start/approval, L-7; audited).
 */
async function scopeVerdict(
  def: WorkflowDefinition,
  scope: FoeScope,
  opts: { nonStopOnly: boolean; machineMap?: Map<number, MachineForValidation> },
): Promise<{ out: OutOfScope; stepIds: string[]; stopOnlyOut: OutOfScope }> {
  const judge = await makeScopeJudge(scope);
  const empty: OutOfScope = { machines: [], robots: [], adapters: [] };
  if (judge.unrestricted) return { out: empty, stepIds: [], stopOnlyOut: empty };
  const { targets, stops } = await definitionTargets(def, opts.machineMap);
  const all = await judge.outOf(targets);
  const nonStop = await judge.outOf(targets, { nonStopOnly: true });
  const out = opts.nonStopOnly ? nonStop : all;
  const minus = (a: number[], b: number[]) => a.filter((x) => !b.includes(x));
  return {
    out,
    stepIds: isOutOfScopeEmpty(out) ? [] : stepsTouching(def, out, stops, opts.nonStopOnly),
    stopOnlyOut: { machines: minus(all.machines, nonStop.machines), robots: minus(all.robots, nonStop.robots), adapters: minus(all.adapters, nonStop.adapters) },
  };
}

function outOfScopeRefusal(stepIds: string[], out: OutOfScope) {
  const what = [
    out.machines.length ? `machine(s) ${out.machines.join(", ")}` : "",
    out.robots.length ? `robot(s) ${out.robots.join(", ")}` : "",
    out.adapters.length ? `adapter(s) ${out.adapters.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  return {
    reason: "outOfScope" as const,
    stepIds,
    errors: stepIds.map((id) => ({ path: `step:${id}`, message: `Step "${id}" touches ${what || "a target"} outside your factory scope.` })),
    message: `Step(s) ${stepIds.join(", ") || "?"} touch ${what || "targets"} outside your factory scope — a deploy covers every step, stop steps included. Ask someone whose scope covers them to deploy it.`,
  };
}

/**
 * doc 81 Đợt 5 task E2 — may `scope` SEE (and start / approve) this definition? Its non-STOP targets must all be in scope.
 * The read rule of getRun / getWorkflow / listRuns / listWorkflows / versions / simulate-by-ref: outside it ⇒ "not found".
 */
export async function definitionVisibleTo(def: WorkflowDefinition | null | undefined, scope: FoeScope): Promise<boolean> {
  return (await filterVisibleBy([def], (x) => x, scope)).length === 1;
}

/**
 * doc 81 Đợt 5 task E2 — the items whose definition `scope` may see (ONE scope resolution, ONE machine load for the
 * batch). A missing / malformed definition is visible only to an unrestricted scope (fail-closed).
 */
export async function filterVisibleBy<T>(items: T[], defOf: (item: T) => WorkflowDefinition | null | undefined, scope: FoeScope): Promise<T[]> {
  return (await filterVisibleWith(await makeScopeJudge(scope), items, defOf)).keep;
}

/**
 * doc 81 Đợt 5 task E fix 2 (review N3) — ONE pass for a batch: the judge resolved once by the caller, ONE machine load,
 * ONE stop verifier (one bound-adapter read + one stop-pin read for every definition of the batch). `failed` ⇒ some
 * lookup failed (the result is the fail-closed one; callers that must SAY so — the hub — read it).
 */
async function filterVisibleWith<T>(
  judge: Awaited<ReturnType<typeof makeScopeJudge>>,
  items: T[],
  defOf: (item: T) => WorkflowDefinition | null | undefined,
): Promise<{ keep: T[]; failed: boolean }> {
  if (judge.unrestricted && !judge.failed) return { keep: items, failed: false };
  const defs = items.map(defOf);
  const ids = new Set<number>();
  for (const d of defs) if (d && Array.isArray(d.steps)) for (const id of validateWorkflow(d, null).referencedMachineIds) ids.add(id);
  const machineMap = await loadMachines([...ids]);
  const verifier = await makeStopVerifier((await getDb()) ?? null, defs.filter((d): d is WorkflowDefinition => !!d && Array.isArray(d.steps)), machineMap);
  const keep: T[] = [];
  let failed = judge.failed;
  for (let i = 0; i < items.length; i++) {
    const d = defs[i];
    if (!d || !Array.isArray(d.steps)) continue;
    // final wave F3 — only a DECIDED "in" is kept; an undecided definition (out only because a pinned STOP's connection is
    // not confirmed, or a lookup failed) is left out AND marks the result `failed` (the hub shows degraded). A definition
    // that is in scope is no longer marked failed just because one of ITS OWN stops could not be verified.
    const verdict = await decideDefinition(judge, d, machineMap, verifier);
    if (verdict === "in") keep.push(items[i]);
    else if (verdict === "unknown") failed = true;
  }
  return { keep, failed: failed || judge.failed };
}

/** doc 81 Đợt 5 task E2 — EVERY target (STOPs included) in `scope`: the deploy rule, also for deleting a workflow. */
export async function definitionFullyInScope(def: WorkflowDefinition | null | undefined, scope: FoeScope): Promise<boolean> {
  if (!def || !Array.isArray(def.steps)) return (await makeScopeJudge(scope)).unrestricted;
  return isOutOfScopeEmpty((await scopeVerdict(def, scope, { nonStopOnly: false })).out);
}

/**
 * doc 81 Đợt 5 task E2 fix (ruling R-5-d) — THE shared run check of every entry point that takes a run id (engine resume /
 * abort, orchestration router, edge router, API v1): the run EXISTS and its workflow is visible to `scope`. The scope is
 * ALWAYS resolved, also for a missing run, so a nonexistent id and an out-of-scope id take the same path (same answer,
 * no early exit). DB error ⇒ false (fail-closed).
 */
export async function runIdVisibleTo(runId: number, scope: FoeScope): Promise<boolean> {
  try {
    const d = await getDb();
    const run = d ? (await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1))[0] : undefined;
    const visible = await runVisibleTo({ workflowId: run?.workflowId ?? -1 }, scope);
    return !!run && visible;
  } catch {
    return false;
  }
}

/** doc 81 Đợt 5 task E2 fix — the runs (of any list) whose workflow `scope` may see; one workflow load for the batch. */
export async function filterRunsVisibleTo<T extends { workflowId: number }>(runs: T[], scope: FoeScope): Promise<T[]> {
  if (runs.length === 0) return runs;
  const d = await getDb();
  if (!d) return [];
  const ids = [...new Set(runs.map((r) => r.workflowId))];
  const wfs = await d.select().from(orchestrationWorkflows).where(inArray(orchestrationWorkflows.id, ids));
  const defById = new Map(wfs.map((w) => [w.id, w.definitionJson as WorkflowDefinition] as const));
  return filterVisibleBy(runs, (r) => defById.get(r.workflowId), scope);
}

/** doc 81 Đợt 5 task E2 — the run's workflow (current head definition) is visible to `scope`. DB error ⇒ false. */
export async function runVisibleTo(run: { workflowId: number }, scope: FoeScope): Promise<boolean> {
  try {
    const d = await getDb();
    const wf = d ? (await d.select().from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, run.workflowId)).limit(1))[0] : undefined;
    return await definitionVisibleTo(wf?.definitionJson as WorkflowDefinition | undefined, scope);
  } catch {
    return false;
  }
}

/** doc 81 Đợt 5 task E2 — an out-of-scope target referenced only by STOP steps was allowed (L-7): audit it (best-effort). */
function auditStopOutOfScope(user: FoeUser, def: WorkflowDefinition, runId: number, stage: "start" | "approve", out: OutOfScope): void {
  if (isOutOfScopeEmpty(out)) return;
  void (async () => {
    try {
      const { logCrudOperation, createAuditContext } = await import("../../auditTrailService");
      await logCrudOperation(createAuditContext({ user: { id: user.id || 0, name: user.name ?? user.role } }), {
        action: "config_change",
        entityType: "orchestration_run",
        entityId: runId,
        entityName: def.ref,
        details: { operation: "foe_stop_target_out_of_scope", metadata: { stage, runId, ref: def.ref, outOfScope: out } },
        status: "success",
      });
    } catch {
      /* audit best-effort — never blocks a STOP (L-7) */
    }
  })();
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
  // doc 81 Đợt 5 task E fix 1 (R-5-j) — the RUN-TIME candidate (foeStepClass.isStopCandidate): the engine only stays
  // out of the way here; the dispatcher re-decides with the real pins (an unpinned stop needs a counting gate there).
  const isStop = await isStopCandidate(step, rc.machineById);
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
  // doc 81 Đợt 5 task E4 (items 35+36) — a ROBOT STOP gets NO authorisation row: the robot dispatcher never reads or
  // consumes a stop's row (a STOP is never refused on HITL grounds), so the row authorised nothing, named whoever drove
  // the walk as "confirmer" (item 35) and cost an unbounded DB wait before the STOP (item 36). An OT STOP keeps its row
  // (the OT dispatcher accepts a pinned stop on a self-confirmed row) but waits for it at most STOP_DB_STEP_DEADLINE_MS;
  // past that the STOP goes on and the OT dispatcher's own path decides (no row ⇒ NOT_CONFIRMED, visibly).
  if (!(isRobotKind(cap.adapterKind) && (cmd.robotId == null || isStop))) {
    await stopBoundedWrite(isStop, rc.runId, step.id, "authorisation row", () =>
      ensureOrchestrationAction(rc.user, idempotencyKey, step, args, cmd, approval ?? undefined),
    );
  }

  // doc 80 ORC-01 — last check before the command leaves the engine (the awaits above can span an abort).
  if (rc.aborting) return ABORTED_OUTCOME;

  // ROUTE THROUGH E0 → existing HITL/dry-run dispatcher. NEVER a direct device path.
  const adapter = equipmentRegistry.getAdapter(cap.adapterKind);
  // doc 81 Đợt 6 — marked in the SAME tick as the abort check above: an abort either came before (this step is not sent
  // here; the abort sweep sends it if it is a real STOP) or after (it is on its way; the sweep never sends it again).
  rc.dispatched.add(step.id);
  rc.attempted.add(step.id); // fix 1 (R-6-b) — handed to a dispatcher: the run has acted (never removed)
  // fix 2 (N5) — ALSO in the run context, which is persisted (awaited, unbounded) when the walk pauses or ends: the step
  // rows of a stop-TYPED step are bounded writes (it may be a STOP) and can be lost on a slow DB, this record cannot.
  const already = Array.isArray(rc.context[DISPATCHED_CTX_KEY]) ? (rc.context[DISPATCHED_CTX_KEY] as unknown[]).map(String) : [];
  if (!already.includes(step.id)) rc.context[DISPATCHED_CTX_KEY] = [...already, step.id];
  const result: EquipmentCommandResult = await adapter.sendCommand(cmd);
  // A refused attempt is not "on its way" any more: a STOP whose retry an abort cancels is sent once more by the sweep.
  if (!result.ok) rc.dispatched.delete(step.id);

  // E4 — after a STOP was sent, recording its result is bounded too (the next STOP of the walk must not wait on it).
  await stopBoundedWrite(isStop, rc.runId, step.id, "result row", () =>
    upsertStep(rc.runId, step.id, step.type, {
      status: "running",
      result: {
        routedTo: result.routedTo,
        status: result.status,
        accepted: result.ok,
        simulated: result.detail?.simulated ?? undefined,
        detail: result.detail ?? null,
      },
    }),
  );

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
    const comp = step.compensation;
    const compStop = await isStopCommandStep(rc, comp); // E fix 1 — a STOP compensation's bookkeeping is bounded too
    // doc 80 ORC-01 — never flip an ABORTED run back to 'compensating'. E fix 2 (review N1) — bounded when the
    // compensation is a STOP (the status write is on its path).
    await stopBoundedWrite(compStop, rc.runId, comp.id, "compensating status", async () => {
      // final wave P-E2 — only FROM a live walk status: if this (bounded) write lands after the run already ended or paused
      // (failed / completed / awaiting_confirm / held …) it changes nothing (it would leave a finished run "compensating").
      await setRunStatusUnlessAborted(rc.runId, "compensating", {}, ["running", "compensating"]);
    });
    // run the compensation step body once (no nested compensation cascade)
    await stopBoundedWrite(compStop, rc.runId, comp.id, "running row", () =>
      upsertStep(rc.runId, comp.id, comp.type, { status: "running", startedAt: new Date() }),
    );
    const out = await runStepBody(rc, comp, 1, compStop);
    await stopBoundedWrite(compStop, rc.runId, comp.id, "compensated row", () =>
      upsertStep(rc.runId, comp.id, comp.type, {
        status: out.kind === "ok" ? "compensated" : "failed",
        error: "error" in out ? out.error : null,
        finishedAt: new Date(),
      }),
    );
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
  const { completed, prior } = await loadCompletedSteps(run.id);
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
    startedViaApi: runStartedViaApi(run), // doc 81 Đợt 5 task E1
    aborting: false,
    controller: new AbortController(),
    // doc 81 Đợt 6 — the abort sweep's picture of this walk
    dispatched: new Set(),
    startOrder: [],
    settled: new Set(),
    prior,
    attempted: new Set(),
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

    // doc 81 Đợt 5 task E2 — every target (STOPs included) in the deployer's factory scope.
    const scope = scopeFor(user, opts?.scope);
    const sv = await scopeVerdict(def, scope, { nonStopOnly: false, machineMap });
    if (!isOutOfScopeEmpty(sv.out)) return { ok: false, enabled: true, ...outOfScopeRefusal(sv.stepIds, sv.out) };

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
    // doc 81 Đợt 5 task E2 — refs are global: deploying over an EXISTING workflow replaces its definition, so the
    // deployer's scope must also cover every target of the definition being replaced (else another factory's workflow
    // could be overwritten). The refusal names no step and reveals only that the ref is taken (as duplicate does).
    if (existing.length) {
      const prev = await scopeVerdict(existing[0].definitionJson as WorkflowDefinition, scope, { nonStopOnly: false });
      if (!isOutOfScopeEmpty(prev.out)) {
        return {
          ok: false,
          enabled: true,
          reason: "refOutOfScope",
          stepIds: [],
          message: `A workflow with ref "${def.ref}" already exists outside your factory scope — use another ref.`,
        };
      }
    }
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
  /** doc 81 Đợt 5 task E2 — see DeployOpts.scope. */
  opts: { scope?: FoeScope } = {},
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
  const noSnapshot: DeployResult = { ok: false, enabled: true, message: `No snapshot for workflow ${workflowId} version ${version}.` };
  // doc 81 Đợt 5 task E2 — a workflow the actor cannot see is answered exactly like a missing snapshot.
  const scope = scopeFor(user, opts.scope);
  const [head] = await d.select().from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, workflowId)).limit(1);
  const headVisible = await definitionVisibleTo(head?.definitionJson as WorkflowDefinition | undefined, scope); // resolved for a missing id too
  if (!head || !headVisible) return noSnapshot;
  const snaps = await d
    .select()
    .from(orchestrationWorkflowVersions)
    .where(eq(orchestrationWorkflowVersions.workflowId, workflowId));
  const target = snaps.find((s) => s.version === version);
  if (!target) return noSnapshot;
  // Re-deploy the old definition → bumps to a fresh version with the old content.
  // doc 80 ORC-05 — the sim-gate override is NO LONGER auto-filled by the engine: when the gate is
  // on, the override carries the HUMAN's mandatory reason (audited by auditDeploySimGate).
  const def = target.definitionJson as WorkflowDefinition;
  // doc 81 Đợt 5 task E2 — the re-deploy runs the deploy scope check (every target of the old version AND of the head it replaces).
  const res = await deployWorkflow(def, user, {
    overrideReason: `rollback to v${version}: ${why}`,
    scope,
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
  opts?: {
    async?: boolean;
    ownerUserId?: number | null;
    /**
     * doc 81 Đợt 5 task E1 — set by the API v1 route (server side). The run is ALSO marked when a non-user principal
     * (id ≤ 0) starts it on behalf of a human owner (`ownerUserId` — only the API route does that), and when the caller's
     * params already carry the marker (an edge re-execution of an API run copies its params) — the marker can only be
     * added, never lifted. A non-user start with NO owner stays unmarked: it is owner-less ⇒ ownerUnknown refuses it anyway.
     */
    viaApi?: boolean;
    /** doc 81 Đợt 5 task E2 — the starter's factory scope (see DeployOpts.scope). */
    scope?: FoeScope;
  },
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
    // doc 81 Đợt 5 task E2 — a workflow whose NON-STOP targets are outside the starter's scope does not exist for them
    // (the SAME answer as a missing ref, before any status check). Targets reached only by VERIFIED STOP steps are allowed
    // (L-7, R-5-j) and audited once the run exists. E fix 1 (review #9) — the scope is resolved for a missing ref too.
    const sv = await scopeVerdict((wf?.definitionJson ?? { ref: workflowRef, name: workflowRef, steps: [] }) as WorkflowDefinition, scopeFor(user, opts?.scope), { nonStopOnly: true });
    if (!wf || !isOutOfScopeEmpty(sv.out)) return { ok: false, enabled: true, message: `Workflow "${workflowRef}" not found.` };
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
    // doc 81 Đợt 5 task E1 (item 24, option C) — mark an API-started run in BOTH server-written places (see
    // foeGateApproval.FOE_API_RUN_PARAM): paramsJson is never rewritten after this INSERT; contextJson may be.
    const humanStart = Number.isInteger(user.id) && user.id > 0;
    const viaApi =
      opts?.viaApi === true ||
      (!humanStart && opts?.ownerUserId != null && opts.ownerUserId > 0) ||
      runStartedViaApi({ paramsJson: params });
    const [run] = await d
      .insert(orchestrationRuns)
      .values({
        workflowId: wf.id,
        workflowRef: wf.ref,
        status: "queued",
        paramsJson: viaApi ? { ...(params ?? {}), [FOE_API_RUN_PARAM]: true } : params ?? {},
        contextJson: viaApi ? { startedViaApi: true } : {},
        startedBy: user.id || (opts?.ownerUserId != null && opts.ownerUserId > 0 ? opts.ownerUserId : null),
        startedAt: new Date(),
      })
      .returning();
    runId = run.id;
    auditStopOutOfScope(user, def, run.id, "start", sv.stopOnlyOut); // doc 81 Đợt 5 task E2 (L-7: allowed, audited)
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
  /**
   * doc 81 Đợt 5 task E2 — the approver's factory scope (see DeployOpts.scope). Checked on every APPROVAL by a real user
   * (or whenever given explicitly); a system resume (user 0: auto-resume / QT pump) records no counting approval.
   */
  opts: { scope?: FoeScope } = {},
): Promise<StartRunResult> {
  if (!foeEnabled()) {
    return { ok: false, enabled: false, message: "FOE is disabled (set FOE_ENABLED=true)." };
  }
  try {
    const d = await db();
    const scopeChecked = opts.scope !== undefined || (Number.isInteger(user.id) && user.id > 0);
    // final wave F5 — a REJECTION by a real user reads the run row INSIDE its STOP-deadline-bounded scope decision (below);
    // every other path reads it here, as before.
    let run: OrchestrationRun | undefined;
    let rejectDecision: Awaited<ReturnType<typeof boundedRunScopeDecision>> | null = null;
    if (scopeChecked && !decision.approved) {
      rejectDecision = await boundedRunScopeDecision(runId, scopeFor(user, opts.scope), `FOE reject run ${runId} scope`);
      run = rejectDecision.run;
    } else {
      [run] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
    }
    const notFound: StartRunResult = { ok: false, enabled: true, message: `Run ${runId} not found.` };
    // doc 81 Đợt 5 task E2 + fix (ruling R-5-d) — EVERY decision by a real user (approve AND reject — a rejection aborts
    // the run, a cross-factory mutation) needs the run's non-STOP targets in the decider's scope. Outside it the run does
    // not exist for them: the SAME answer as a missing run, before any status / gate information, and the scope is
    // resolved for a missing id too (same path). The brief's CONFLICT outOfScope would tell an out-of-scope caller that the
    // run exists (Đợt 4 lesson: out-of-scope ⇒ indistinguishable from not found). Stopping is not weakened for the
    // people who own the equipment: in-scope users approve / reject / abort as before; STOP steps run as before (L-7).
    let approvalStopOnlyOut: OutOfScope | null = null;
    if (scopeChecked) {
      const scope = scopeFor(user, opts.scope);
      if (decision.approved) {
        // An APPROVAL lets actuation proceed ⇒ fail-closed: any doubt ⇒ "not found".
        const [wfS] = run ? await d.select().from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, run.workflowId)).limit(1) : [];
        const defS = wfS?.definitionJson as WorkflowDefinition | undefined;
        const visible = await definitionVisibleTo(defS, scope);
        if (!run || !visible) return notFound;
        if (defS) approvalStopOnlyOut = (await scopeVerdict(defS, scope, { nonStopOnly: true })).stopOnlyOut;
      } else {
        // E fix 2 (ruling R-5-l) — a REJECTION aborts the run (a cross-factory mutation; since Đợt 6 fix 1 it sends the run's
        // remaining STOP steps / due STOP compensations like an abort): the scope lookup is bounded by the STOP DB deadline; undecided ⇒ REFUSED with the distinct "scope not verified"
        // answer (also for a missing id — no oracle), audited; a DECIDED out-of-scope ⇒ "not found".
        const verdict = rejectDecision?.verdict ?? "unknown";
        if (verdict === "unknown") {
          await auditScopeUnverified(user, runId, "reject");
          return { ...scopeUnverifiedAnswer(runId), enabled: true };
        }
        if (!run || verdict === "out") return notFound;
      }
    }
    if (!run) return notFound;
    if (!decision.approved && run.status === "aborted") {
      // fix 2 (N4) — the same as an abort of an aborted run (N1): e.g. this rejection's claim committed but its reply was
      // lost. The sweep runs again (never re-sends a confirmed STOP).
      const abortStops = await abortStopSweep(runId, run, liveRuns.get(runId) ?? null, user, scopeFor(user, opts.scope));
      return { ok: false, enabled: true, runId, status: "aborted", message: `Run ${runId} was already aborted — its STOP steps not yet confirmed were sent again.`, abortStops };
    }
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
      const rejectedBy = (why?: string) => `Gate "${gateStepId ?? "?"}" rejected by user ${user.id}.${why ? ` Reason: ${why}` : ""}`;
      // doc 80 Đợt 1 Task 9 — CLAIM FIRST: CAS the paused run (gate pinned). With a compensation hook (QT) the claim moves it
      // to 'compensating' and only the winner compensates, then finishes 'compensating' → 'aborted' (a restart mid-way leaves
      // 'compensating' ⇒ rehydrate marks it failed; an abort landing meanwhile stays 'aborted' — the final CAS only moves a
      // run still 'compensating'). Without a hook the claim writes 'aborted' itself. doc 80 ORC-02 — only ONE decision
      // (approve OR reject) may claim the paused run.
      // doc 81 Đợt 6 fix 1 (R-6-a) — a rejection aborts the run, so it sends the run's remaining STOP steps and due STOP
      // compensations like an abort (abortStopSweep) — ONLY after its claim WON: a losing decision (CONFLICT) is thrown as
      // before and sends nothing. The claim, the final write and the gate row are bounded by D (L-7). A claim that does not
      // answer within D sends nothing NOW (it may not have won); if it lands later and won, the rest of the rejection
      // (sweep, hook, final write, gate row) runs then, in the background — the answer says it was not confirmed.
      const claim = claimPausedRun(
        runId,
        hooks.compensate ? "compensating" : "aborted",
        hooks.compensate ? {} : { finishedAt: new Date(), error: rejectedBy(reason) },
        pinnedStepId,
      );
      const finishRejection = async (): Promise<{ abortStops: AbortStopReport; confirmed: boolean }> => {
        // STOPs FIRST (L-7), then the QT business compensations: the hook acts through services (cancel the order, line →
        // held, cancel the AMR task, unlock the recipe), never through FOE command steps — it cannot send one of these
        // STOPs again, nor is it a route for a non-STOP command compensation (unchanged since doc 80 Task 9).
        const abortStops = await abortStopSweep(runId, run, liveRuns.get(runId) ?? null, user, scopeFor(user, opts.scope));
        let confirmed = true;
        if (hooks.compensate) {
          let finalNote: string | undefined;
          try {
            finalNote = await hooks.compensate();
          } catch (err) {
            finalNote = [reason, `compensation threw: ${err instanceof Error ? err.message : String(err)}`].filter(Boolean).join(" · ");
          }
          reason = (finalNote ?? reason)?.trim() || reason;
          try {
            await withDeadline(
              (async () => {
                const d2 = await getDb();
                if (!d2) throw new DbUnavailableError();
                await d2
                  .update(orchestrationRuns)
                  .set({ status: "aborted", updatedAt: new Date(), finishedAt: new Date(), error: rejectedBy(reason) })
                  .where(and(eq(orchestrationRuns.id, runId), eq(orchestrationRuns.status, "compensating")));
              })(),
              STOP_DB_STEP_DEADLINE_MS,
              `FOE reject run ${runId} final write`,
            );
          } catch (err) {
            confirmed = false;
            console.error(`[FOE] rejection of run ${runId}: 'aborted' not confirmed by the database — ${(err as Error)?.message ?? err}`);
          }
        }
        void appendRunEvent(runId, "RUN_FAILED", { ts: Date.now(), data: { status: "aborted" } });
        if (gateStepId) {
          await withDeadline(
            upsertStep(runId, gateStepId, "hitl_gate", {
              status: "failed",
              error: reason ? `Rejected: ${reason}` : "Rejected",
              result: { approved: false, note: reason ?? null, rejectedBy: user.id },
              finishedAt: new Date(),
            }),
            STOP_DB_STEP_DEADLINE_MS,
            `FOE reject run ${runId} gate row`,
          ).catch(() => undefined);
        }
        return { abortStops, confirmed };
      };
      try {
        await withDeadline(claim, STOP_DB_STEP_DEADLINE_MS, `FOE reject run ${runId} claim`);
      } catch (err) {
        if (err instanceof TRPCError) throw err; // LOST the claim (CONFLICT) — nothing was sent, nothing will be
        console.error(`[FOE] rejection of run ${runId}: claim not answered in time — ${(err as Error)?.message ?? err}; STOPs follow if it lands as won`);
        void claim.then(
          () => finishRejection().catch(() => undefined),
          // fix 2 (N4) — the claim FAILED after the bound with something other than "lost" (e.g. its reply was lost after it
          // committed): re-read the run (bounded); if it shows THIS rejection's claim, finish it (sweep + gate row).
          async (lateErr: unknown) => {
            if (lateErr instanceof TRPCError) return; // lost the claim: nothing to do
            const now = await boundedAbortRead(async () => {
              const d3 = await getDb();
              return d3 ? d3.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1) : null;
            }, `FOE reject run ${runId} claim re-read`);
            const row = now?.[0];
            // without a hook only: a 'compensating' row could be ANOTHER decision's claim, and its QT business compensations
            // must not run twice — a later abort (it lands on 'compensating') sweeps that run instead.
            const ours = !hooks.compensate && row?.status === "aborted" && row.error === rejectedBy(reason);
            if (ours) await finishRejection().catch(() => undefined);
          },
        );
        return {
          ok: false,
          enabled: true,
          runId,
          reason: FOE_ABORT_UNCONFIRMED,
          message: `Rejection of run ${runId} not confirmed by the database in time — STOP steps confirmed sent: 0; check the run and retry.`,
          abortStops: emptyAbortReport(),
        };
      }
      const { abortStops, confirmed } = await finishRejection();
      if (!confirmed) {
        return {
          ok: false,
          enabled: true,
          runId,
          reason: FOE_ABORT_UNCONFIRMED,
          message: `Rejection of run ${runId} not confirmed by the database in time — STOP steps confirmed sent: ${abortStops.sent.length}; check the run and retry.`,
          abortStops,
        };
      }
      return { ok: false, enabled: true, runId, status: "aborted", abortStops };
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
    if (approvalStopOnlyOut) auditStopOutOfScope(user, def, runId, "approve", approvalStopOnlyOut); // E2 (L-7: allowed, audited)

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
            // doc 81 Đợt 5 task E3 — the device configuration the approval covers, computed HERE (server side); null
            // (DB error) ⇒ the approval never counts (fail-closed).
            bindingDigest: await computeBindingDigest(d, def),
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

// ── doc 81 Đợt 6 (owner decision 2026-10-11, "Huỷ vẫn chạy bước DỪNG") — an ABORT / a gate REJECTION still sends the run's STOPs
//
// Before: an abort (and a gate rejection, which aborts the run) cancelled every later step, its STOP steps included, and the
// STOP compensations too — aborting "start → delay → stop" during the delay left the equipment running. Now an abort (after
// its R-5-l scope check and its 'aborted' write) and a rejection (fix 1, R-6-a: after its claim on the paused run WON) run
// ONE sweep over the run:
//   • every pending NON-STOP step is skipped (never sent — R-2-n), also inside sequences / parallels / branches;
//   • every remaining REAL STOP step is sent: a robot step whose job is a stop job, or an OT step that is a PINNED stop
//     over a confirmed running connection — the shared Đợt 5 classifier (foeStepClass.makeStopVerifier), never the
//     command name (R-5-j). An unpinned stop-typed step is not a STOP (`notPinned`, not sent, audited abortStopNotPinned);
//     a step that may be one but cannot be verified (pins / connection / machine unreadable) is NOT sent and is audited
//     (`abortStopUnverified`);
//   • then the STOP compensations that are due (of steps that completed or were running), newest start first;
//   • a STOP step already handed to the dispatcher is let finish (never sent twice, never cancelled); a non-STOP step
//     running at abort time is cancelled as before;
//   • a branch whose condition was never evaluated is not guessed: its STOPs are listed (`abortStopSkippedUntakenBranch`);
//   • a STOP behind an unpassed hitl_gate is sent (a STOP never needs a gate, QĐ-4a);
//   • fix 1 (R-6-b) — ONLY when the run has ACTUATED: at least one NON-STOP command step (any command that is not a verified
//     STOP, compensations included) was ATTEMPTED — handed to a dispatcher whatever came back (refused, failed, timed out),
//     or recorded as running / completed / failed / compensated / dispatched on its row (counted conservatively: a doubt
//     counts as actuated). A run that never actuated (queued, paused before its first motion) sends NO STOP — its STOP
//     steps exist to undo its own actions, not to stop equipment another process may be running — audited
//     `abortStopNotNeeded`;
//   • each STOP goes through the SAME dispatcher path as a run's own STOP (equipmentRegistry → OT / robot dispatcher, an
//     engine authorisation row for OT, the run id in the action id) WITHOUT a gate approval — so the dispatchers' own
//     checks still decide: the OT dispatcher accepts such a row ONLY for a pinned stop (R-4-x), the robot dispatcher sends
//     only a stop job. Each outcome is audited (`abortStopSent` / `abortStopFailed`, with `outOfScopeTarget` — fix 1 #8 —
//     true when the STOP's machine / robot / adapter is outside the caller's factory scope, "unknown" when that could not be
//     decided) and shown as an `abort:<id>` step row;
//   • fix 1 (#1, #2) — sent ONCE: a second abort finds the run 'aborted' (the write excludes it) and sends nothing; two
//     sweeps of one run overlapping in this process share one; a STOP whose `abort:<id>` row says it was sent is never sent
//     again, while one that FAILED is sent again by a later sweep under a NEW idempotency key (a per-sweep nonce: the OT
//     dispatcher caches a failed key's result as terminal).
//
// ★ SLOW DATABASE (fix 1 #5) — said plainly: when the stop-pin / running-connection reads of an OT STOP do not answer within
//   D, that OT STOP is NOT verified ⇒ NOT sent by the sweep (audited abortStopUnverified, the Studio warns and points at the
//   machine's direct STOP / E-STOP) — even though the OT dispatcher would re-check it itself (plan constraint 3: no exemption
//   on a guess). Robot stop jobs need no DB and still go. And in a LIVE run, an OT STOP the walker was about to send when the
//   abort flag fell is cancelled by the flag and handed over by the sweep instead: up to ~4·D later than the walker would have
//   (verification ≤ D + its adapter lookup ≤ D + authorisation row ≤ D, after the bounded 'aborted' write ≤ D).
//
// ★ BOUND (D = STOP_DB_STEP_DEADLINE_MS = 1 s; every wait below is bounded, nothing waits on a hung DB or device). ABORT:
//   scope decision ≤ D (a real user; the system path's run read — getDb() included — ≤ D instead) · 'aborted' write ≤ D
//   (getDb() included) · picture of the run ≤ 2·D (definition + step rows concurrently ≤ D, machines ≤ D; a live run: memory +
//   its step rows ≤ D) · STOP verification + the scope marker ≤ D (concurrently) · preparing every STOP CONCURRENTLY ≤ 2·D
//   (adapter lookup ≤ D, then the OT authorisation row ≤ D; a robot STOP: none) — so every STOP is handed to its dispatcher
//   within 7·D of the abort request, in order (STOP steps in definition order, then the due compensations), and the abort
//   answers within 8·D (it waits ≤ ABORT_STOP_ANSWER_WAIT_MS for the dispatchers' replies; a later reply is recorded when it
//   comes). REJECTION: the scope decision ≤ D (a real user), the claim ≤ D, then the same sweep (≤ 6·D to its answer), then
//   the QT compensation hook (business actions, not a STOP path — it is awaited as before), the final write ≤ D and the gate
//   row ≤ D. The record writes (step row, audit) are bounded and never awaited by a STOP. NOT inside the figure: the first
//   `db()` of resumeRun (pre-existing, before anything else) and the dispatchers' own work after the hand-over.

/** doc 81 Đợt 6 — how long the abort ANSWER waits for the dispatchers' replies to its STOPs (they keep running past it). */
export const ABORT_STOP_ANSWER_WAIT_MS = STOP_DB_STEP_DEADLINE_MS;

/**
 * doc 81 Đợt 6 — the 'aborted' write (abort) / the claim or the final write (rejection) did not answer within D: the
 * database may not say 'aborted' — the caller is told to check and retry (the answer says how many STOPs were CONFIRMED).
 */
export const FOE_ABORT_UNCONFIRMED = "abortUnconfirmed" as const;

type AbortAuditOp =
  | "abortStopSent"
  | "abortStopFailed"
  | "abortStopSkippedUntakenBranch"
  | "abortStopUnverified"
  | "abortStopNotPinned"
  | "abortStopNotNeeded";

/** The audit module, imported ONCE per process for the sweep's several concurrent audit writes (a failed import is retried). */
let abortAuditModulePromise: Promise<typeof import("../../auditTrailService")> | undefined;
function abortAuditModule(): Promise<typeof import("../../auditTrailService")> {
  abortAuditModulePromise ??= import("../../auditTrailService").catch((err: unknown) => {
    abortAuditModulePromise = undefined;
    throw err;
  });
  return abortAuditModulePromise;
}

/** doc 81 Đợt 6 — one console line (always, synchronous) + one audit row (bounded by D, never awaited by a STOP). */
function auditAbortStop(user: FoeUser, runId: number, operation: AbortAuditOp, metadata: Record<string, unknown>): void {
  const line = `[FOE] abort of run ${runId} by user ${user.id || 0} (${user.role}): ${operation} ${JSON.stringify(metadata)}`;
  if (operation === "abortStopSent" || operation === "abortStopNotNeeded") console.log(line);
  else console.error(`${line} — to stop that equipment now, use the machine's direct STOP / E-STOP.`);
  const write = (async () => {
    const { logCrudOperation, createAuditContext } = await abortAuditModule();
    await logCrudOperation(createAuditContext({ user: { id: user.id || 0, name: user.name ?? user.role } }), {
      action: "config_change",
      entityType: "orchestration_run",
      entityId: runId,
      details: { operation, metadata: { runId, ...metadata } },
      status: operation === "abortStopSent" || operation === "abortStopNotNeeded" ? "success" : "failure",
    });
  })();
  void withDeadline(write, STOP_DB_STEP_DEADLINE_MS, `FOE abort run ${runId} ${operation} audit`).catch((err: unknown) => {
    console.error(`[FOE] abort of run ${runId}: ${operation} audit not written: ${(err as Error)?.message ?? err}`);
  });
}

/** doc 81 Đợt 6 — what the sweep knows about a run (from the live driver's memory, or from its stored rows). */
interface AbortSweepSource {
  def: WorkflowDefinition | null;
  machineById: Map<number, MachineForValidation>;
  /** false ⇔ the step rows could not be read: nothing is known settled, every compensation counts as due (STOP direction). */
  rowsKnown: boolean;
  settled: (stepId: string) => boolean;
  branchOf: (stepId: string) => "then" | "else" | undefined;
  startOrder: string[];
  /** R-6-b — steps that MAY have been handed to a dispatcher (attempted, whatever the result) — counted conservatively. */
  mayHaveActuated: (stepId: string) => boolean;
  /** #2 — STOPs an earlier sweep of this run CONFIRMED sent (`abort:<id>` row completed): never sent again. */
  sentBefore: Set<string>;
}

/** The step rows of a run, bounded by D (null when they could not be read). */
function readRunStepRows(runId: number) {
  return boundedAbortRead(async () => {
    const d = await getDb();
    return d ? d.select().from(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, runId)) : null;
  }, `FOE abort run ${runId} step rows`);
}

/** #2 — the STOPs earlier sweeps confirmed sent (pure). */
function abortSentOf(rows: ReadonlyArray<{ stepId: string; status: string }> | null): Set<string> {
  const out = new Set<string>();
  for (const r of rows ?? []) if (r.stepId.startsWith(ABORT_ROW_PREFIX) && r.status === "completed") out.add(r.stepId.slice(ABORT_ROW_PREFIX.length));
  return out;
}

async function liveSweepSource(rc: RunContext): Promise<AbortSweepSource> {
  const rows = await readRunStepRows(rc.runId); // ≤ D — earlier sweeps' rows, and the rows' (conservative) actuation record
  const fromRows = rows ? priorStepsOf(rows) : null;
  return {
    def: rc.def,
    machineById: rc.machineById,
    rowsKnown: true,
    settled: (id) => rc.completed.has(id) || rc.prior.settled.has(id) || rc.settled.has(id) || rc.dispatched.has(id),
    branchOf: (id) => {
      const b = rc.context[`branch:${id}`];
      return b === "then" || b === "else" ? b : rc.prior.branches.get(id);
    },
    startOrder: [...rc.prior.startOrder, ...rc.startOrder],
    mayHaveActuated: (id) => rc.prior.unknown || rc.attempted.has(id) || rc.prior.attempted.has(id) || !!fromRows?.attempted.has(id),
    sentBefore: abortSentOf(rows),
  };
}

/** A read bounded by D: `null` when it failed or did not answer (logged). Never throws. */
async function boundedAbortRead<T>(read: () => PromiseLike<T>, label: string): Promise<T | null> {
  try {
    return await withDeadline(Promise.resolve().then(read), STOP_DB_STEP_DEADLINE_MS, label);
  } catch (err) {
    console.warn(`[FOE] ${label}: not read (${(err as Error)?.message ?? err}) — the abort sweep goes on without it (L-7)`);
    return null;
  }
}

/** A run with NO live driver in this process (paused at a gate, held, queued, or driven elsewhere): its stored picture. */
async function storedSweepSource(run: OrchestrationRun): Promise<AbortSweepSource> {
  const [wf, rows] = await Promise.all([
    boundedAbortRead(async () => {
      const d = await getDb();
      return d ? d.select().from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, run.workflowId)).limit(1) : null;
    }, `FOE abort run ${run.id} definition`),
    readRunStepRows(run.id),
  ]);
  const def = (wf?.[0]?.definitionJson as WorkflowDefinition | undefined) ?? null;
  const usable = def && Array.isArray(def.steps) ? def : null;
  const machineById =
    (usable && (await boundedAbortRead(() => loadMachines(validateWorkflow(usable, null).referencedMachineIds), `FOE abort run ${run.id} machines`))) ||
    new Map<number, MachineForValidation>();
  const prior = rows ? priorStepsOf(rows) : priorStepsOf([]);
  const context = (run.contextJson as Record<string, unknown>) ?? {};
  // fix 2 (R-6-c, N2, N5) — when whether the run acted cannot be DECIDED from here, it counts as acted (STOPs are sent):
  //   • its rows could not be read;
  //   • it is driven ELSEWHERE — delegated to an edge node (its rows reach us only when the edge's walk returns), or
  //     'running' / 'compensating' with no driver in this process (another instance, or orphaned): its rows may lag;
  //   • it was interrupted by a restart (rehydrate marks it): a bounded row may never have been written.
  // Plus the commands the walk recorded as dispatched in the run context (persisted, not a bounded write).
  const drivenElsewhere = run.edgeNodeId != null || ((run.status === "running" || run.status === "compensating") && !liveRuns.has(run.id));
  const undecidable = rows === null || drivenElsewhere || context.interrupted === true;
  const ctxDispatched = new Set(Array.isArray(context[DISPATCHED_CTX_KEY]) ? (context[DISPATCHED_CTX_KEY] as unknown[]).map(String) : []);
  return {
    def: usable,
    machineById,
    rowsKnown: rows !== null,
    settled: (id) => prior.settled.has(id),
    branchOf: (id) => {
      const b = context[`branch:${id}`];
      return b === "then" || b === "else" ? b : prior.branches.get(id);
    },
    startOrder: prior.startOrder,
    mayHaveActuated: (id) => undecidable || prior.attempted.has(id) || ctxDispatched.has(id),
    sentBefore: abortSentOf(rows),
  };
}

/**
 * The REAL stops of the definition (foeStepClass — the Đợt 5 classifier), bounded by D. Past it / on failure: the
 * classification WITHOUT the database — robot stop jobs are still known (no DB needed), every OT candidate is `unsure`
 * (not sent, audited): nothing is exempted on a guess.
 */
async function verifyStopsForAbort(runId: number, def: WorkflowDefinition, map: Map<number, MachineForValidation>): Promise<StopVerification> {
  try {
    return await withDeadline(
      (async () => (await makeStopVerifier((await getDb()) ?? null, [def], map)).verified(def, map))(),
      STOP_DB_STEP_DEADLINE_MS,
      `FOE abort run ${runId} stop verification`,
    );
  } catch (err) {
    console.warn(`[FOE] abort of run ${runId}: OT stops not verified in time (${(err as Error)?.message ?? err}) — robot stops only (L-7)`);
    try {
      return await (await makeStopVerifier(null, [def], map)).verified(def, map);
    } catch {
      const unsure = new Set(allStepsOf(def.steps).filter((s) => s.type === "command").map((s) => s.id));
      return { ids: new Set(), failed: true, unsure };
    }
  }
}

/**
 * fix 1 #8 — per STOP to send: is its target (machine / robot / explicit adapter) outside the caller's factory scope?
 * true / false, or "unknown" when the scope could not be decided within D. An audit MARKER only — it never decides a send.
 */
async function outOfScopeMarkers(
  runId: number,
  scope: FoeScope,
  steps: CommandWorkflowStep[],
  map: Map<number, MachineForValidation>,
): Promise<Map<string, boolean | "unknown">> {
  const out = new Map<string, boolean | "unknown">();
  if (steps.length === 0) return out;
  try {
    await withDeadline(
      (async () => {
        const judge = await makeScopeJudge(scope);
        for (const s of steps) {
          const o = await judge.outOf(collectTargets({ ref: "abort", name: "abort", steps: [s] }, map, new Set()));
          out.set(s.id, judge.failed ? "unknown" : !isOutOfScopeEmpty(o));
        }
      })(),
      STOP_DB_STEP_DEADLINE_MS,
      `FOE abort run ${runId} scope marker`,
    );
  } catch {
    /* not decided in time ⇒ "unknown" below */
  }
  for (const s of steps) if (!out.has(s.id)) out.set(s.id, "unknown");
  return out;
}

/** Every step of the main tree (children and branches; NOT compensation subtrees — a compensation never compensates). */
function mainTreeSteps(steps: WorkflowStep[] | undefined, out: WorkflowStep[] = []): WorkflowStep[] {
  for (const s of steps ?? []) {
    out.push(s);
    const node = s as { steps?: WorkflowStep[]; then?: WorkflowStep[]; else?: WorkflowStep[] };
    mainTreeSteps(node.steps, out);
    mainTreeSteps(node.then, out);
    mainTreeSteps(node.else, out);
  }
  return out;
}

type CommandWorkflowStep = Extract<WorkflowStep, { type: "command" }>;

interface AbortPlan {
  /** the remaining real STOP steps (definition order), then the due STOP compensations (newest start first). */
  send: CommandWorkflowStep[];
  unverified: string[];
  untakenBranch: string[];
  notPinned: string[];
}

/** PURE over the source + the verification — what the sweep sends, lists and skips. */
async function planAbortSweep(src: AbortSweepSource, def: WorkflowDefinition, v: StopVerification): Promise<AbortPlan> {
  const plan: AbortPlan = { send: [], unverified: [], untakenBranch: [], notPinned: [] };
  const seen = new Set<string>();
  const classify = async (s: CommandWorkflowStep) => {
    if (seen.has(s.id)) return;
    seen.add(s.id);
    if (v.ids.has(s.id)) {
      if (!src.sentBefore.has(s.id)) plan.send.push(s); // a REAL stop (robot stop job / pinned OT stop) — the only thing sent
      return;
    }
    const c = commandOf(s, src.machineById);
    if (!c || v.unsure.has(s.id)) {
      plan.unverified.push(s.id); // may be a STOP, cannot be verified ⇒ not sent, audited (never a silent skip)
      return;
    }
    if (!isRobotKind(c.cap.adapterKind) && (await isOtStopCommandType(c.descriptor.name))) plan.notPinned.push(s.id);
    // otherwise a NON-STOP step: never sent on an abort (R-2-n)
  };
  const walk = async (steps: WorkflowStep[] | undefined): Promise<void> => {
    for (const s of steps ?? []) {
      if (src.settled(s.id)) continue; // finished / failed on its own / already on its way to the dispatcher
      switch (s.type) {
        case "command":
          await classify(s);
          break;
        case "sequence":
        case "parallel":
          await walk(s.steps);
          break;
        case "branch": {
          const taken = src.branchOf(s.id);
          if (taken === "then") await walk(s.then);
          else if (taken === "else") await walk(s.else);
          else {
            // never evaluated ⇒ no guess: its STOPs (real or possible) are listed, not sent
            for (const x of allStepsOf([...s.then, ...(s.else ?? [])])) {
              if (x.type === "command" && (v.ids.has(x.id) || v.unsure.has(x.id)) && !seen.has(x.id)) {
                seen.add(x.id);
                plan.untakenBranch.push(x.id);
              }
            }
          }
          break;
        }
        default:
          break; // delay / wait_* / hitl_gate: nothing to send — and a gate never holds a STOP back (QĐ-4a)
      }
    }
  };
  await walk(def.steps);
  // the STOP compensations that are due: of the steps that completed or were running, newest start first
  const main = mainTreeSteps(def.steps);
  const byId = new Map(main.map((s) => [s.id, s] as const));
  const order = src.rowsKnown ? [...new Set(src.startOrder)].reverse() : main.map((s) => s.id).reverse();
  for (const id of order) {
    const parent = byId.get(id);
    if (parent?.compensation) await walk([parent.compensation]);
  }
  return plan;
}

/**
 * fix 1 (R-6-b) — has the run ACTUATED? Some command step (compensations included) that is NOT a verified STOP may have been
 * handed to a dispatcher. Conservative: an unpinned / unverifiable stop-typed step counts as a non-STOP; a doubt counts.
 */
function runHasActuated(def: WorkflowDefinition, src: AbortSweepSource, v: StopVerification): boolean {
  for (const s of allStepsOf(def.steps)) {
    if (s.type === "command" && !v.ids.has(s.id) && src.mayHaveActuated(s.id)) return true;
  }
  return false;
}

/**
 * fix 2 (N3) — the idempotency key of one abort STOP: `run<id>-abort-<nonce>-<step>`, the nonce BEFORE the step id, and a
 * step id too long for the 64-character action id (`foe-<key>`, orchestrationActionId) shortened to a prefix + a hash of the
 * WHOLE id — so a retried sweep never reuses an earlier sweep's action row, and two long step ids never share one.
 */
export function abortStopKey(runId: number, stepId: string, nonce: string): string {
  const base = `run${runId}-abort-${nonce}-`;
  const room = 64 - "foe-".length - base.length;
  if (stepId.length <= room) return base + stepId;
  const hash = createHash("sha256").update(stepId).digest("hex").slice(0, 10);
  return base + stepId.slice(0, Math.max(0, room - hash.length - 1)) + "~" + hash;
}

type PreparedAbortStop = { step: CommandWorkflowStep; cmd: EquipmentCommand; kind: AdapterKind } | { step: CommandWorkflowStep; error: string };

/**
 * One STOP of the sweep, up to the dispatcher (bounded: adapter lookup ≤ D, OT authorisation row ≤ D). The command is
 * built WITHOUT a gate approval, always: the engine row it gets is self-confirmed, which the OT dispatcher accepts only for
 * a pinned stop. Re-checked here as a STOP (robot: stop job; OT: stop-typed — the dispatcher re-checks the pins).
 * `nonce` (#2) — one per sweep: a STOP that failed in an earlier sweep is sent again under a NEW key.
 */
async function prepareAbortStop(
  runId: number,
  user: FoeUser,
  step: CommandWorkflowStep,
  map: Map<number, MachineForValidation>,
  nonce: string,
): Promise<PreparedAbortStop> {
  try {
    const c = commandOf(step, map);
    if (!c) return { step, error: `machine ${step.machineId} / command "${step.command}" not found` };
    const robot = isRobotKind(c.cap.adapterKind);
    const raw = (step.args ?? {}) as Record<string, unknown>;
    const args = robot
      ? raw
      : await withDeadline(withResolvedAdapter(c.cap.adapterKind, step.machineId, raw), STOP_DB_STEP_DEADLINE_MS, `FOE abort run ${runId} stop ${step.id} adapter lookup`).catch(
          (err: unknown) => {
            console.warn(`[FOE] abort of run ${runId}: stop ${step.id} adapter lookup not answered — sent unresolved (L-7): ${(err as Error)?.message ?? err}`);
            return raw;
          },
        );
    const idempotencyKey = abortStopKey(runId, step.id, nonce);
    const cmd = buildEquipmentCommand(c.descriptor, c.cap, step.machineId, args, idempotencyKey, user); // NO approval, ever
    if (robot ? !isStopJob(toRobotJob(cmd)) : !(await isOtStopCommandType(cmd.name))) {
      return { step, error: `"${step.command}" is not a STOP — never sent on an abort` };
    }
    // the SAME policy seam as a run's own command step (SEC_PLATFORM off by default ⇒ nothing)
    const { evaluateActionPolicy, secPlatformEnabled } = await import("../../security/policyGate");
    if (secPlatformEnabled()) {
      const verdict = evaluateActionPolicy(`foe-run:${runId}`, `foe.command.${step.command}`, `machine:${step.machineId}`, {
        runId,
        stepId: step.id,
        stepType: step.type,
        command: step.command,
        machineId: step.machineId,
        role: user.role,
        abort: true,
      }, { requestId: idempotencyKey });
      if (!verdict.allow) return { step, error: `${verdict.effect === "deny" ? "POLICY_DENIED" : "POLICY_APPROVAL_REQUIRED"}: ${verdict.reason}` };
    }
    if (!robot) {
      await stopBoundedWrite(true, runId, step.id, "abort authorisation row", () => ensureOrchestrationAction(user, idempotencyKey, step, args, cmd));
    }
    return { step, cmd, kind: c.cap.adapterKind };
  } catch (err) {
    // data-raw-ok: goes only into the abort's own `abort:<id>` step row + audit (a record, never a screen text as is).
    return { step, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The outcome of one STOP: an `abort:<id>` step row (bounded, not awaited) + the audit (abortStopSent / abortStopFailed). */
function recordAbortStop(
  runId: number,
  user: FoeUser,
  step: CommandWorkflowStep,
  ok: boolean,
  result: EquipmentCommandResult | null,
  error: string | null,
  outOfScopeTarget: boolean | "unknown",
): void {
  const now = new Date();
  const dispatch = result
    ? { routedTo: result.routedTo, status: result.status, accepted: result.ok, simulated: result.detail?.simulated ?? undefined, detail: result.detail ?? null }
    : {};
  void withDeadline(
    upsertStep(runId, `${ABORT_ROW_PREFIX}${step.id}`.slice(0, 128), "command", {
      status: ok ? "completed" : "failed",
      result: { abortStop: ok ? "sent" : "failed", stepId: step.id, ...dispatch },
      error,
      startedAt: now,
      finishedAt: now,
    }),
    STOP_DB_STEP_DEADLINE_MS,
    `FOE abort run ${runId} stop ${step.id} row`,
  ).catch((err: unknown) => console.warn(`[FOE] abort of run ${runId}: stop ${step.id} row not written: ${(err as Error)?.message ?? err}`));
  auditAbortStop(user, runId, ok ? "abortStopSent" : "abortStopFailed", {
    stepId: step.id,
    machineId: step.machineId,
    command: step.command,
    outOfScopeTarget,
    ...(result ? { routedTo: result.routedTo, status: result.status } : {}),
    ...(error ? { error } : {}),
  });
}

function emptyAbortReport(): AbortStopReport {
  return { sent: [], failed: [], pending: [], unverified: [], untakenBranch: [], notPinned: [], notNeeded: [] };
}

/** fix 1 (#1) — two sweeps of ONE run overlapping in this process share one (no STOP sent twice by this process). */
const abortSweepsInFlight = new Map<number, Promise<AbortStopReport>>();

/**
 * doc 81 Đợt 6 — THE sweep (see the section header). `live` = the run's driver in this process (its memory is the
 * picture), else the stored rows of `run`. `scope` = the caller's factory scope (audit marker only). Never throws; every
 * wait is bounded.
 */
function abortStopSweep(runId: number, run: OrchestrationRun | undefined, live: RunContext | null, user: FoeUser, scope: FoeScope): Promise<AbortStopReport> {
  const running = abortSweepsInFlight.get(runId);
  if (running) return running;
  const p = runAbortStopSweep(runId, run, live, user, scope).finally(() => {
    if (abortSweepsInFlight.get(runId) === p) abortSweepsInFlight.delete(runId);
  });
  abortSweepsInFlight.set(runId, p);
  return p;
}

async function runAbortStopSweep(runId: number, run: OrchestrationRun | undefined, live: RunContext | null, user: FoeUser, scope: FoeScope): Promise<AbortStopReport> {
  const report = emptyAbortReport();
  try {
    const src = live ? await liveSweepSource(live) : run ? await storedSweepSource(run) : null;
    if (!src?.def) {
      auditAbortStop(user, runId, "abortStopUnverified", { stepIds: [], reason: "definitionUnreadable" });
      return report;
    }
    const def = src.def;
    const v = await verifyStopsForAbort(runId, def, src.machineById);
    const plan = await planAbortSweep(src, def, v);
    // R-6-b — a run that never actuated sends none of its STOPs (said out loud)
    if (plan.send.length > 0 && !runHasActuated(def, src, v)) {
      report.notNeeded = plan.send.map((s) => s.id);
      auditAbortStop(user, runId, "abortStopNotNeeded", { stepIds: report.notNeeded, reason: "runNeverActuated" });
      plan.send = [];
    }
    report.unverified = plan.unverified;
    report.untakenBranch = plan.untakenBranch;
    report.notPinned = plan.notPinned;
    if (plan.unverified.length) auditAbortStop(user, runId, "abortStopUnverified", { stepIds: plan.unverified, rowsKnown: src.rowsKnown });
    if (plan.untakenBranch.length) auditAbortStop(user, runId, "abortStopSkippedUntakenBranch", { stepIds: plan.untakenBranch });
    // stop-TYPED steps that are not a pinned stop: not a real STOP (R-5-j), not sent — said out loud all the same
    if (plan.notPinned.length) auditAbortStop(user, runId, "abortStopNotPinned", { stepIds: plan.notPinned });
    if (plan.send.length === 0) return report;
    // every STOP prepared CONCURRENTLY (≤ 2·D, the scope marker alongside ≤ D), then handed to its dispatcher IN ORDER,
    // without waiting on a reply
    const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const [prepared, markers] = await Promise.all([
      Promise.all(plan.send.map((s) => prepareAbortStop(runId, user, s, src.machineById, nonce))),
      outOfScopeMarkers(runId, scope, plan.send, src.machineById),
    ]);
    const replies: Array<Promise<void>> = [];
    for (const p of prepared) {
      const id = p.step.id;
      const marker = markers.get(id) ?? "unknown";
      if ("error" in p) {
        report.failed.push(id);
        recordAbortStop(runId, user, p.step, false, null, p.error, marker);
        continue;
      }
      report.pending.push(id);
      let sent: Promise<EquipmentCommandResult>;
      try {
        sent = equipmentRegistry.getAdapter(p.kind).sendCommand(p.cmd);
      } catch (err) {
        sent = Promise.reject(err);
      }
      const settle = (ok: boolean, result: EquipmentCommandResult | null, error: string | null) => {
        report.pending = report.pending.filter((x) => x !== id);
        (ok ? report.sent : report.failed).push(id);
        recordAbortStop(runId, user, p.step, ok, result, error, marker);
      };
      replies.push(
        sent.then(
          (r) => settle(r.ok, r, r.ok ? null : r.error ?? `Command "${p.step.command}" rejected (${r.status}).`),
          // data-raw-ok: the dispatcher's failure, recorded in the `abort:<id>` step row + audit only.
          (err: unknown) => settle(false, null, err instanceof Error ? err.message : String(err)),
        ),
      );
    }
    await withDeadline(Promise.all(replies), ABORT_STOP_ANSWER_WAIT_MS, `FOE abort run ${runId} stop replies`).catch(() => {
      console.warn(`[FOE] abort of run ${runId}: STOP(s) ${report.pending.join(", ")} still awaiting the dispatcher — recorded when answered`);
    });
  } catch (err) {
    console.error(`[FOE] abort of run ${runId}: STOP sweep error — ${(err as Error)?.message ?? err}; use the machine's direct STOP / E-STOP`);
  }
  // a snapshot: later replies keep updating the rows / audit, not this answer
  return { ...report, sent: [...report.sent], failed: [...report.failed], pending: [...report.pending] };
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
 * DB poll between steps (not in Đợt 0). (doc 81 Đợt 6: the STOP sweep of such a run works from its stored rows, so a
 * STOP that driver is sending at that moment may be sent twice — a STOP, never motion.)
 *
 * doc 81 Đợt 6 — after the 'aborted' write the abort SENDS the run's remaining real STOP steps and its due STOP
 * compensations (only when the run actuated — R-6-b), and skips every non-STOP step (abortStopSweep; bound in the section
 * header above). A gate REJECTION (resumeRun approved:false) does the same since fix 1 (R-6-a).
 */
export async function abortRun(
  runId: number,
  user: FoeUser,
  reason?: string,
  /**
   * doc 81 Đợt 5 task E2 fix (ruling R-5-d) — the aborter's factory scope (see DeployOpts.scope). Checked for a real user
   * (or whenever given): aborting a run of another factory is a cross-factory mutation ⇒ answered EXACTLY like a missing
   * run. The owners of the equipment (in scope) abort as before; the run's remaining STOPs are sent (Đợt 6, L-7).
   */
  opts: { scope?: FoeScope } = {},
): Promise<StartRunResult> {
  try {
    const notFound: StartRunResult = { ok: false, enabled: foeEnabled(), runId, message: `Run ${runId} not found.` };
    let run: OrchestrationRun | undefined;
    if (opts.scope !== undefined || (Number.isInteger(user.id) && user.id > 0)) {
      // E fix 2 (ruling R-5-l) — bounded by the STOP DB deadline (an abort is never held longer); undecided (timeout /
      // error / pins unreadable) ⇒ REFUSED with the distinct "scope not verified — retry; use the direct STOP / E-STOP"
      // answer (the SAME for a missing id — no oracle), audited synchronously (bounded); a DECIDED out-of-scope ⇒ "not found".
      // final wave F5 — the run row read is INSIDE that bound (a hung read ⇒ "scope not verified", not a hung abort).
      const decision = await boundedRunScopeDecision(runId, scopeFor(user, opts.scope), `FOE abort run ${runId} scope`);
      if (decision.verdict === "unknown") {
        await auditScopeUnverified(user, runId, "abort");
        return scopeUnverifiedAnswer(runId);
      }
      if (!decision.run || decision.verdict === "out") return notFound;
      run = decision.run;
    } else {
      // fix 1 (#6) — the system path's run read (getDb() included) is bounded by D too: it replaces the scope decision
      // inside the documented 8·D; unanswered ⇒ nothing changed, nothing sent (the caller retries).
      try {
        [run] = await withDeadline(
          (async () => {
            const d = await getDb();
            if (!d) throw new DbUnavailableError();
            return d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
          })(),
          STOP_DB_STEP_DEADLINE_MS,
          `FOE abort run ${runId} read`,
        );
      } catch (err) {
        console.error(`[FOE] abort of run ${runId}: run not read in time — ${(err as Error)?.message ?? err}`);
        return { ok: false, enabled: foeEnabled(), runId, message: "DB unavailable." };
      }
    }
    if (!run) return notFound;
    if (run.status === "aborted") {
      // fix 2 (N1) — the retry the answer asks for ('aborted' landed late, or a STOP failed / could not be verified):
      // nothing to write, the sweep runs AGAIN — it re-sends the STOPs that were not CONFIRMED (a new key per sweep) and
      // never a confirmed one (`abort:<id>` row completed), R-6-b / R-6-c apply, an overlapping sweep is joined.
      const abortStops = await abortStopSweep(runId, run, liveRuns.get(runId) ?? null, user, scopeFor(user, opts.scope));
      return { ok: true, enabled: foeEnabled(), runId, status: "aborted", message: `Run ${runId} was already aborted — its STOP steps not yet confirmed were sent again.`, abortStops };
    }
    if (["completed", "failed"].includes(run.status)) {
      return { ok: false, enabled: foeEnabled(), runId, status: run.status, message: `Run ${runId} already terminal.` };
    }
    const live = liveRuns.get(runId);
    if (live) {
      live.aborting = true;
      live.controller.abort();
    }
    // doc 81 Đợt 6 — the 'aborted' write is bounded by D: past it (or on a DB error) the abort is UNCONFIRMED — it is in
    // effect in this process (a live driver is flagged, never dispatches again) and the STOP sweep below still runs (a STOP
    // never waits on the DB, L-7); the answer says the database may not show 'aborted'.
    let confirmed: boolean | "unknown";
    try {
      // fix 1 (#6) — getDb() is inside the bound; (#1) 'aborted' is excluded too: a second abort (double click, two users)
      // finds the run already aborted and sends nothing.
      const written = await withDeadline(
        (async () => {
          const d = await getDb();
          if (!d) throw new DbUnavailableError();
          return d
            .update(orchestrationRuns)
            .set({
              status: "aborted",
              updatedAt: new Date(),
              finishedAt: new Date(),
              error: reason ? `Aborted by user ${user.id}: ${reason}` : `Aborted by user ${user.id}.`,
            })
            .where(and(eq(orchestrationRuns.id, runId), notInArray(orchestrationRuns.status, ["completed", "failed", "aborted"])))
            .returning({ id: orchestrationRuns.id });
        })(),
        STOP_DB_STEP_DEADLINE_MS,
        `FOE abort run ${runId} status write`,
      );
      confirmed = written.length > 0;
    } catch (err) {
      console.error(`[FOE] abort of run ${runId}: 'aborted' not confirmed by the database — ${(err as Error)?.message ?? err}; STOP steps are still sent`);
      confirmed = "unknown";
    }
    if (confirmed === false) {
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
    if (confirmed === true) void appendRunEvent(runId, "RUN_FAILED", { ts: Date.now(), data: { status: "aborted" } });
    // doc 81 Đợt 6 — skip every non-STOP step, still send the remaining STOP steps and the due STOP compensations.
    const abortStops = await abortStopSweep(runId, run, lateLive ?? live ?? null, user, scopeFor(user, opts.scope));
    if (confirmed === "unknown") {
      return {
        ok: false,
        enabled: foeEnabled(),
        runId,
        reason: FOE_ABORT_UNCONFIRMED,
        message: `Abort of run ${runId} not confirmed by the database in time — STOP steps confirmed sent: ${abortStops.sent.length}; check the run and retry.`,
        abortStops,
      };
    }
    return { ok: true, enabled: foeEnabled(), runId, status: "aborted", abortStops };
  } catch (err) {
    // data-raw-ok: như trên — lỗi một bước trong bộ thực thi quy trình.
    return { ok: false, enabled: foeEnabled(), runId, message: err instanceof Error ? err.message : String(err) };
  }
}
