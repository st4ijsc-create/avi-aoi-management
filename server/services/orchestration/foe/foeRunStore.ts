/**
 * doc 81 Đợt 10 task C (design §0.1, §2.14) — ONE WALKER, TWO STORES. Every persistence and gate call the FOE walker
 * (foeEngine.ts) makes goes through the `RunStore` carried on its RunContext:
 *   • the CENTRAL store (this file, `centralRunStore`) = the functions that lived in foeEngine.ts until Đợt 10, MOVED
 *     UNCHANGED (upsertStep, setRunStatusUnlessAborted, persistContext, appendRunEvent, withResolvedAdapter, the authorise
 *     chain findSeparateGateApproval + ensureOrchestrationAction, the abort-sweep source / stop verification / audit);
 *   • the EDGE store (server/services/edge/edgeRunStore.ts) = the signed run package + the local journal + the per-step
 *     /authorize client — no database.
 * The walker's semantics (retry, branch, parallel, gate pause, compensation, abort sweep, the L-7 bounds) are therefore the
 * SAME code for both; foeRunStoreParity.dot10.test.ts walks the same definitions through both and compares the rows.
 *
 * L-7 — a STOP never depends on a store's authorisation: the central store keeps the bounded STOP paths exactly as before
 * (robot STOP: no lookup, no row; OT STOP: both lookups concurrently under ONE STOP_DB_STEP_DEADLINE_MS, the row bounded);
 * the edge store answers a STOP without asking central.
 */
import { and, eq, inArray, ne, notInArray } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { appendRunEvent } from "../runEventStore"; // doc 33 W4 (F8): durable RunEvent log (FOE_DURABLE)
import {
  orchestrationWorkflows,
  orchestrationRuns,
  orchestrationRunSteps,
  machines,
  aiPendingActions,
  deviceAdapters,
  type OrchestrationRun,
} from "../../../../drizzle/schema";
import { validateWorkflow, type WorkflowDefinition, type WorkflowStep, type MachineForValidation } from "./workflowModel";
import type { CommandDescriptor, EquipmentCapability } from "../../equipment/capabilityModel";
import type { EquipmentCommand } from "../../equipment/equipmentAdapter";
import { FOE_ENGINE_TOOL, otPayloadHash, robotPayloadHash, withFoeGateApproval, withOtPayloadHash, type FoeGateApproval } from "../../ot/otActionBinding";
import { STOP_DB_STEP_DEADLINE_MS } from "../../robot/stopJob";
import { withDeadline } from "../../ot/drivers/boundedClose";
import {
  evaluateGateApprovals,
  computeBindingDetail,
  evaluateWithPrograms,
  recordedProgramDigests,
  hashWorkflowDefinition,
  deriveRunApprovalIdentity,
  FOE_REJECT_CLAIM_CTX_KEY,
  type GateRequiredReason,
} from "./foeGateApproval";
import { toRobotJob } from "../../equipment/robotJobMapping";
import { EDGE_HELD_CTX_KEY, INTERRUPTED_EARLIER_CTX_KEY } from "../../edge/edgeProgramReportRule"; // fix review 1 — ONE home of the hold marks
import { allStepsOf, buildEquipmentCommand, isRobotKind, makeStopVerifier, orchestrationActionId, type StopVerification } from "./foeStepClass";

// ── the port ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Principal shape (foeEngine.FoeUser). */
export interface RunStoreUser {
  id: number;
  role: string;
  name?: string | null;
}

/** doc 81 Đợt 6 — the step rows of a run, as the abort sweep reads them (see priorStepsOf). */
export interface PriorSteps {
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

/** The part of the walker's RunContext a store reads (foeEngine.RunContext extends it). */
export interface RunStoreContext {
  runId: number;
  def: WorkflowDefinition;
  params: Record<string, unknown>;
  context: Record<string, unknown>;
  user: RunStoreUser;
  machineById: Map<number, MachineForValidation>;
  telemetry: Map<string, unknown>;
  states: Map<number, string>;
  completed: Set<string>;
  runOwner: number | null;
  startedViaApi: boolean;
  dispatched: Set<string>;
  startOrder: string[];
  settled: Set<string>;
  prior: PriorSteps;
  attempted: Set<string>;
}

/** One step-row transition (orchestration_run_steps), exactly what upsertStep takes. */
export interface RunStepPatch {
  status: string;
  attempt?: number;
  result?: Record<string, unknown> | null;
  error?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}

/** What execCommand hands the store's authorisation (everything it already computed, no DB). */
export interface AuthorizeInput {
  /** foeStepClass.isStopCandidate — the walker's RUN-TIME stop classification. */
  isStop: boolean;
  robotKind: boolean;
  rawArgs: Record<string, unknown>;
  descriptor: CommandDescriptor;
  cap: EquipmentCapability;
  idempotencyKey: string;
}

/** Why an edge segment ends `held` (design §2.10, D5) — the edge store's only non-central verdict (edgeProtocol EDGE_HELD_REASONS). */
export type RunStoreHeldReason = "centralUnreachable" | "journalFull" | "keysetUnknown" | "configStale";

export type AuthorizeVerdict =
  | { ok: true; cmd: EquipmentCommand; args: Record<string, unknown>; approval: FoeGateApproval | null }
  /** refused — the step fails with `error` (FOE_GATE_REQUIRED(<reason>) … for a gate refusal: the Studio keys on it) */
  | { ok: false; verdict: "refused"; error: string; reason?: string }
  /** central stopped the run (abort / rejection) — the walker sweeps locally (edge store only) */
  | { ok: false; verdict: "stopped" }
  /** the claim is no longer this walker's — it lets go of the run without writing it (edge store only) */
  | { ok: false; verdict: "stale" }
  /** no authorisation obtainable now (central unreachable, journal full …) — the step is HELD, nothing sent (D5, edge only) */
  | { ok: false; verdict: "unavailable"; heldReason: RunStoreHeldReason; error: string };

/** doc 81 Đợt 6 — what the sweep knows about a run (from the live driver's memory, or from its stored rows). */
export interface AbortSweepSource {
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

/** The audit operations of the abort sweep (foeEngine). */
export type AbortAuditOp =
  | "abortStopSent"
  | "abortStopFailed"
  | "abortStopSkippedUntakenBranch"
  | "abortStopUnverified"
  | "abortStopNotPinned"
  | "abortStopNotNeeded"
  /** fix 3 (M2) — one row per re-send REQUEST (started / refused too old), even when it sends nothing. */
  | "abortStopResend"
  /** doc 81 Đợt 7 I6 — a rejection whose claim failed late could not re-read the run: not finished (abort it to send its STOPs). */
  | "rejectClaimUndecided";

/** How an edge walk segment ended (edgeProtocol edgeCompleteRequest outcome); null ⇔ the walker let go of the run (stale claim). */
export interface EdgeSegmentEnd {
  outcome: "completed" | "failed" | "aborted" | "paused" | "held";
  gateStepId?: string;
  heldReason?: RunStoreHeldReason;
  error?: string;
  /** fix review 1 — commands SENT whose result the journal refused (never sent again); also named in `error` (EDGE_OUTCOME_UNKNOWN(…)) */
  outcomeUnknown?: string[];
}

/**
 * THE port (design §2.14). Central = today's functions (centralRunStore below); edge = edgeRunStore.ts.
 * Deviation from the design sketch, recorded in group-C-report.md: `authorizeCommand` takes the step's command INPUT and
 * builds the command itself (the central OT STOP runs its adapter and gate lookups CONCURRENTLY under one deadline — the L-7
 * bound — which a "command already built" signature could not keep); the abort sweep's stop verification, its OT STOP
 * authorisation row and its audit are store calls too (no DB on the edge).
 */
export interface RunStore {
  readonly kind: "central" | "edge";
  upsertStep(runId: number, stepId: string, stepType: string, patch: RunStepPatch): Promise<void>;
  setStatusUnlessAborted(
    runId: number,
    status: OrchestrationRun["status"],
    patch?: Partial<OrchestrationRun>,
    onlyFrom?: Array<OrchestrationRun["status"]>,
  ): Promise<boolean>;
  persistContext(rc: RunStoreContext): Promise<void>;
  resolveAdapter(kind: string, machineId: number, args: Record<string, unknown>, stepId: string): Promise<Record<string, unknown>>;
  authorizeCommand(rc: RunStoreContext, step: Extract<WorkflowStep, { type: "command" }>, attempt: number, x: AuthorizeInput): Promise<AuthorizeVerdict>;
  /**
   * EDGE only (synchronous — never a wait on a STOP's path): binds every abort-sweep STOP command to the run segment for the
   * edge dispatch (its ledger record). The central store has none.
   */
  bindAbortStop?(runId: number, step: Extract<WorkflowStep, { type: "command" }>, cmd: EquipmentCommand): void;
  /** The OT authorisation row of an abort STOP (central: self-confirmed engine row, bounded by D; edge: none — a STOP never asks). */
  authorizeAbortStop(runId: number, user: RunStoreUser, step: Extract<WorkflowStep, { type: "command" }>, idempotencyKey: string, args: Record<string, unknown>, cmd: EquipmentCommand): Promise<void>;
  /** The abort sweep's picture: of the live walker (`live`), else of the stored run (`run`). null ⇔ neither is known. */
  sweepSource(x: { live?: RunStoreContext | null; run?: OrchestrationRun; hasLiveDriver?: (runId: number) => boolean }): Promise<AbortSweepSource | null>;
  /** The REAL stops of the definition (central: the Đợt 5 classifier, bounded by D; edge: the package's verified list). */
  verifyStops(runId: number, def: WorkflowDefinition, map: Map<number, MachineForValidation>): Promise<StopVerification>;
  /** One console line (always) + the record of an abort-sweep decision (central: audit row bounded by D; edge: journal). */
  auditAbort(user: RunStoreUser, runId: number, operation: AbortAuditOp, metadata: Record<string, unknown>): void;
  /** EDGE only — how the segment walked under this store ended (null ⇔ not ended, or the walker let go). */
  segmentEnd?(): EdgeSegmentEnd | null;
}

// ── shared pure helpers (both stores) ───────────────────────────────────────────────────────────────────────────────

/** doc 81 Đợt 6 fix 2 (N5) — run-context key: the command steps handed to a dispatcher (see execCommand). */
export const DISPATCHED_CTX_KEY = "foeDispatchedSteps";

/** doc 81 Đợt 6 — the step rows written by an abort's STOP sweep (`abort:<stepId>`; never a definition step). */
export const ABORT_ROW_PREFIX = "abort:";

/**
 * doc 81 Đợt 6 — the abort sweep's picture of a run from its step rows (pure). A row whose command left the engine
 * (a dispatcher result is recorded) or that finished / failed counts as settled: a STOP there is never sent again.
 */
export function priorStepsOf(rows: ReadonlyArray<{ id?: number; stepId: string; status: string; resultJson?: unknown; startedAt?: Date | null }>): PriorSteps {
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

/** #2 — the STOPs earlier sweeps confirmed sent (pure). fix 3 (M4) — the step id is read from the row's result (the row
 * id of a long step id is shortened, see abortRowId), the row id only as a fallback. */
export function abortSentOf(rows: ReadonlyArray<{ stepId: string; status: string; resultJson?: unknown }> | null): Set<string> {
  const out = new Set<string>();
  for (const r of rows ?? []) {
    if (!r.stepId.startsWith(ABORT_ROW_PREFIX) || r.status !== "completed") continue;
    const own = (r.resultJson as { stepId?: unknown } | null | undefined)?.stepId;
    out.add(typeof own === "string" ? own : r.stepId.slice(ABORT_ROW_PREFIX.length));
  }
  return out;
}

/**
 * doc 81 Đợt 5 task E4 (item 36, L-7) — a STOP step's own bookkeeping write (step row, authorisation row) waits at most
 * STOP_DB_STEP_DEADLINE_MS, and a failing write never holds the STOP: it is logged and the STOP continues to the
 * dispatcher, whose own error path decides (OT: no authorisation row ⇒ NOT_CONFIRMED, visibly). A non-STOP write is
 * awaited exactly as before.
 */
export async function stopBoundedWrite(stop: boolean, runId: number, stepId: string, what: string, write: () => Promise<void>): Promise<void> {
  if (!stop) return write();
  await withDeadline(write(), STOP_DB_STEP_DEADLINE_MS, `FOE stop step ${stepId} ${what}`).catch((err: unknown) => {
    console.warn(`[FOE] run ${runId} stop step ${stepId}: ${what} not written in time — the STOP continues (L-7, E4): ${(err as Error)?.message ?? err}`);
  });
}

/** doc 81 Đợt 4 Task A5 — step error code (prefix) the Studio translates (studio.gateRequired). */
export const FOE_GATE_REQUIRED = "FOE_GATE_REQUIRED";

/** doc 81 Đợt 4 fix round 1 (finding 7) — the step error per reason; the Studio keys its text on `FOE_GATE_REQUIRED(<reason>)`. */
export function gateRequiredError(stepId: string, reason: GateRequiredReason): string {
  const why: Record<GateRequiredReason, string> = {
    noGate:
      "needs an earlier approval gate (hitl_gate) in this run approved by someone other than the user who started it — none found. Add a hitl_gate before this step, deploy, and start a new run; another user must approve the gate.",
    approvedByOwner:
      "the approval gate before it was approved by the user who started the run — that does not count. Start a new run and have another user approve the gate.",
    approvedByKeyHolder:
      "the run was started through an API key and the approval gate before it was approved by the person the key is (or was) issued to, or by the person who created the key — that does not count. Have another user approve the gate of a new run.",
    staleApproval:
      "the workflow was redeployed, or the adapter / tag / robot configuration its commands use changed, or the program in a controller it writes to changed, after the gate was approved, so the approval does not cover what would be sent now. Start a new run and have the gate approved again.",
    programUnreadable:
      "the program checksum of a controller it writes to could not be read now (not connected, no answer in time, or an invalid answer), so it cannot be verified that the program is still the one that was approved. Check the controller connection and start a new run.",
    ownerUnknown:
      "the run has no attributable owner (started by the system, or by an API key that is issued to nobody active), so a separate approval cannot be verified. Start the run as a user.",
    apiKeyInactive:
      "the API key that started the run is revoked / disabled or expired now. Its OT and robot commands other than a STOP are refused until an administrator re-activates (or extends) the key.",
    apiIdentityUnavailable:
      "the API key identity of the run could not be read (database error, or database migration 0369 not applied — an administrator runs scripts/apply-migration-0369.mjs), so it cannot be checked that the approver is not the key's holder. Retry once the database is reachable.",
    apiRun:
      "the run was started through an API key that cannot be identified (started before the key-holder record existed, the key was deleted, or a copy of the run without its key), so it cannot be checked that the approver is not the key's holder. Start a new run through the key, or start it as a user in the Orchestration Studio.",
  };
  return `${FOE_GATE_REQUIRED}(${reason}): command step "${stepId}" was not sent: ${why[reason]}`;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// THE CENTRAL STORE — moved from foeEngine.ts UNCHANGED (doc 81 Đợt 10 task C). Comments are the original ones.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** A central database handle (the pool, or a transaction of it). */
export type RunDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export async function loadMachines(ids: number[]): Promise<Map<number, MachineForValidation>> {
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
 * doc 80 ORC-01 — status write used by the DRIVER: a conditional UPDATE
 * `… WHERE id = $1 AND status <> 'aborted'`, so a run aborted meanwhile (by abortRun in this
 * process, or by any other instance straight in the DB) is NEVER overwritten back to
 * completed / failed / awaiting_confirm / compensating. Returns true iff the row was written.
 * DB unavailable → false (nothing written; the caller treats the run as not-its-to-finish).
 */
export async function setRunStatusUnlessAborted(
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
  return setRunStatusUnlessAbortedOn(d, runId, status, patch, onlyFrom);
}

/** doc 81 Đợt 10 C — setRunStatusUnlessAborted on a GIVEN handle (a transaction of central's edge report endpoints). */
export async function setRunStatusUnlessAbortedOn(
  d: RunDb,
  runId: number,
  status: OrchestrationRun["status"],
  patch: Partial<OrchestrationRun> = {},
  onlyFrom?: Array<OrchestrationRun["status"]>,
): Promise<boolean> {
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

export async function upsertStep(
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
  await upsertStepOn(d, runId, stepId, stepType, patch);
}

/** doc 81 Đợt 10 C — upsertStep on a GIVEN handle: THE one row rule for central's walk and the rows an edge reports. */
export async function upsertStepOn(d: RunDb, runId: number, stepId: string, stepType: string, patch: RunStepPatch): Promise<void> {
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
        : patch.status === "failed" && stepId.startsWith(ABORT_ROW_PREFIX)
          ? // doc 81 Đợt 9 task S3 — an edge run is swept by TWO processes (central's abort, its node's walker): a STOP one of
            // them CONFIRMED sent (`abort:<id>` completed) is never shown as failed by the other's later failure (central
            // cannot reach the node's devices). A failed row stays re-sendable as before.
            { setWhere: notInArray(orchestrationRunSteps.status, ["completed"] as never[]) }
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

export async function persistContext(rc: RunStoreContext): Promise<void> {
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
  user: RunStoreUser,
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

/**
 * doc 81 Đợt 4 Task A5 (R-4-a) + fix round 1 (R-4-e … R-4-h) — the latest hitl_gate of THIS run that counts as a separate
 * human approval, by the ONE rule in foeGateApproval.evaluateGateApprovals (server-recorded approval, approver ≠ run
 * owner, bound to the hash of the definition being executed; an owner-less run never counts). Otherwise WHY not.
 * Any DB error ⇒ noGate (fail-closed).
 */
export async function findSeparateGateApproval(
  rc: Pick<RunStoreContext, "runId" | "def" | "startedViaApi">,
  /**
   * doc 81 Đợt 8 O2 (L-7) — `stop: true` on a STOP step: NO controller is read; each approval is checked against the
   * program checksums IT recorded (configuration still read now). See foeGateApproval.recordedProgramDigests.
   */
  opts: { stop?: boolean } = {},
): Promise<{ approval: FoeGateApproval } | { reason: GateRequiredReason }> {
  try {
    const d = await getDb();
    if (!d) return { reason: "noGate" };
    const [runNow] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, rc.runId)).limit(1);
    if (!runNow) return { reason: "noGate" };
    // doc 81 Đợt 9 task R2 (option A, replaces Đợt 5 E1 option C) — WHO may not approve, re-derived from the run row as it
    // is NOW and the api_keys rows (owner; for an API run also the key's holder now / earlier and its creator). The
    // in-memory marker (read when the walk was built) OR the row's ⇒ API run (fail-closed). Unidentifiable key ⇒ apiRun.
    const idr = await deriveRunApprovalIdentity(d, runNow, { viaApiHint: rc.startedViaApi });
    if (!idr.ok) return { reason: idr.reason };
    const rows = await d.select().from(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, rc.runId));
    // doc 81 Đợt 5 task E3 — recompute the binding digest from the device configuration NOW (server side).
    // doc 81 Đợt 8 O2 — including the program checksum of every supported controller, read now (bounded; unreadable ⇒
    // programUnreadable). On a STOP step no controller is read (L-7): the approval's own recorded checksums are used.
    const defHash = hashWorkflowDefinition(rc.def);
    const ev = opts.stop
      ? evaluateGateApprovals(rows, rc.def, defHash, idr.identity, await recordedProgramDigests(d, rc.def))
      : evaluateWithPrograms(rows, rc.def, defHash, idr.identity, await computeBindingDetail(d, rc.def));
    if (!ev.ok) return { reason: ev.reason };
    const top = ev.approvals[0];
    return { approval: { runId: rc.runId, runOwner: idr.identity.owner, approvedBy: top.approvedBy, gateStepId: top.gateStepId } };
  } catch {
    return { reason: "noGate" };
  }
}

/**
 * doc 81 Đợt 4 fix round 1 (R-4-d, review C1) — the OT adapter a step writes through. Explicit numeric args.adapterId is
 * kept (the OT dispatcher + the safety preflight then resolve ITS machine server-side). Otherwise: the single ENABLED
 * device_adapters row bound to the step's machine; zero or several ⇒ no adapterId (the OT route refuses — fail-closed).
 * Robot kinds are untouched (robotId). Before: `adapterId = machineId` — two id spaces mixed, a write could land on an
 * unrelated adapter.
 */
export async function withResolvedAdapter(kind: string, machineId: number, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (isRobotKind(kind) || typeof args.adapterId === "number") return args;
  const ids = await enabledAdapterIdsOfMachine(machineId);
  return ids !== null && ids.length === 1 ? { ...args, adapterId: ids[0] } : args;
}

/**
 * doc 81 Đợt 4 fix round 2 (R-4-j) — the ENABLED device_adapters bound to a machine: the ONE lookup behind both the
 * runtime adapter choice (withResolvedAdapter) and the deploy-time stop check (ambiguousStopSteps). null ⇒ DB error.
 */
export async function enabledAdapterIdsOfMachine(machineId: number): Promise<number[] | null> {
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
 * The central half of execCommand's authorisation (moved from foeEngine.execCommand, Đợt 10 C — same statements, same
 * order). doc 81 Đợt 4 Task A5 (QĐ-4a option (a), R-4-a) — the engine no longer approves itself: an OT/robot step runs only
 * on an earlier hitl_gate of THIS run approved by someone other than the run owner; that approver is the action's
 * confirmer. No such gate ⇒ the step stops with FOE_GATE_REQUIRED (Studio: studio.gateRequired). A STOP is exempt
 * (L-7, energy direction): a robot abort/stop is never gated by the robot dispatcher, and an OT stop-typed step is
 * let through here but the OT dispatcher accepts its self-confirmed row ONLY for a PINNED stop.
 * fix round 1 (R-4-d) — an OT step without args.adapterId writes through the adapter BOUND to its machine (one enabled
 * device_adapters row), never "adapter id = machine id"; none / several ⇒ no adapter ⇒ the OT route refuses it.
 */
async function centralAuthorizeCommand(
  rc: RunStoreContext,
  step: Extract<WorkflowStep, { type: "command" }>,
  _attempt: number,
  x: AuthorizeInput,
): Promise<AuthorizeVerdict> {
  const { isStop, rawArgs, descriptor, cap, idempotencyKey } = x;
  let args: Record<string, unknown>;
  let found: Awaited<ReturnType<typeof findSeparateGateApproval>>;
  if (!isStop) {
    args = await withResolvedAdapter(cap.adapterKind, step.machineId, rawArgs);
    found = await findSeparateGateApproval(rc);
  } else if (x.robotKind) {
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
      // Đợt 8 O2 (L-7) — `stop: true`: this lookup never reads a controller's program checksum.
      withDeadline(findSeparateGateApproval(rc, { stop: true }), STOP_DB_STEP_DEADLINE_MS, `FOE stop step ${step.id} gate lookup`).catch((err: unknown) => {
        console.warn(`[FOE] run ${rc.runId} stop step ${step.id}: gate lookup not answered — sent without a gate approval (L-7, F5): ${(err as Error)?.message ?? err}`);
        return { reason: "noGate" as const };
      }),
    ]);
  }
  const approval = "approval" in found ? found.approval : null;
  const probe = buildEquipmentCommand(descriptor, cap, step.machineId, args, idempotencyKey, rc.user);
  if (!approval && !isStop) {
    // data-raw-ok: the code prefix FOE_GATE_REQUIRED(<reason>) is what the Studio keys its translated text on.
    const reason = "reason" in found ? found.reason : "noGate";
    return { ok: false, verdict: "refused", error: gateRequiredError(step.id, reason), reason };
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
  return { ok: true, cmd, args, approval };
}

// ── the abort sweep's central picture (moved from foeEngine.ts, Đợt 6 — unchanged) ───────────────────────────────────

/** The workflow columns every engine read on a STOPPING path uses (never "scopeKey" — those reads must survive a missing 0367). */
export const WF_CORE_COLS = {
  id: orchestrationWorkflows.id,
  ref: orchestrationWorkflows.ref,
  name: orchestrationWorkflows.name,
  version: orchestrationWorkflows.version,
  status: orchestrationWorkflows.status,
  definitionJson: orchestrationWorkflows.definitionJson,
};

/** The audit module, imported ONCE per process for the sweep's several concurrent audit writes (a failed import is retried). */
let abortAuditModulePromise: Promise<typeof import("../../auditTrailService")> | undefined;
function abortAuditModule(): Promise<typeof import("../../auditTrailService")> {
  abortAuditModulePromise ??= import("../../auditTrailService").catch((err: unknown) => {
    abortAuditModulePromise = undefined;
    throw err;
  });
  return abortAuditModulePromise;
}

/** The console line of an abort-sweep decision (both stores): always, synchronous. */
export function logAbortStop(user: RunStoreUser, runId: number, operation: AbortAuditOp, metadata: Record<string, unknown>): void {
  const line = `[FOE] abort of run ${runId} by user ${user.id || 0} (${user.role}): ${operation} ${JSON.stringify(metadata)}`;
  if (abortAuditSuccess(operation, metadata)) console.log(line);
  else console.error(`${line} — to stop that equipment now, use the machine's direct STOP / E-STOP.`);
}

function abortAuditSuccess(operation: AbortAuditOp, metadata: Record<string, unknown>): boolean {
  return operation === "abortStopSent" || operation === "abortStopNotNeeded" || (operation === "abortStopResend" && metadata.outcome === "started");
}

/** doc 81 Đợt 6 — one console line (always, synchronous) + one audit row (bounded by D, never awaited by a STOP). */
export function auditAbortStop(user: RunStoreUser, runId: number, operation: AbortAuditOp, metadata: Record<string, unknown>): void {
  logAbortStop(user, runId, operation, metadata);
  const write = (async () => {
    const { logCrudOperation, createAuditContext } = await abortAuditModule();
    await logCrudOperation(createAuditContext({ user: { id: user.id || 0, name: user.name ?? user.role } }), {
      action: "config_change",
      entityType: "orchestration_run",
      entityId: runId,
      details: { operation, metadata: { runId, ...metadata } },
      status: abortAuditSuccess(operation, metadata) ? "success" : "failure",
    });
  })();
  void withDeadline(write, STOP_DB_STEP_DEADLINE_MS, `FOE abort run ${runId} ${operation} audit`).catch((err: unknown) => {
    console.error(`[FOE] abort of run ${runId}: ${operation} audit not written: ${(err as Error)?.message ?? err}`);
  });
}

/** The step rows of a run, bounded by D (null when they could not be read). */
function readRunStepRows(runId: number) {
  return boundedAbortRead(async () => {
    const d = await getDb();
    return d ? d.select().from(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, runId)) : null;
  }, `FOE abort run ${runId} step rows`);
}

/** A read bounded by D: `null` when it failed or did not answer (logged). Never throws. */
export async function boundedAbortRead<T>(read: () => PromiseLike<T>, label: string): Promise<T | null> {
  try {
    return await withDeadline(Promise.resolve().then(read), STOP_DB_STEP_DEADLINE_MS, label);
  } catch (err) {
    console.warn(`[FOE] ${label}: not read (${(err as Error)?.message ?? err}) — the abort sweep goes on without it (L-7)`);
    return null;
  }
}

async function liveSweepSource(rc: RunStoreContext): Promise<AbortSweepSource> {
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

/** A run with NO live driver in this process (paused at a gate, held, queued, or driven elsewhere): its stored picture. */
async function storedSweepSource(run: OrchestrationRun, hasLiveDriver: (runId: number) => boolean): Promise<AbortSweepSource> {
  const [wf, rows] = await Promise.all([
    boundedAbortRead(async () => {
      const d = await getDb();
      // final wave F8 (L-7) — explicit columns (no "scopeKey"): the stored definition, hence the STOP steps, loads even when
      // migration 0367 is missing.
      return d ? d.select(WF_CORE_COLS).from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, run.workflowId)).limit(1) : null;
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
  // doc 81 Đợt 10 C (N4) — a Continue of an edge run clears its `interrupted` mark but sets `interruptedEarlier`: the same
  // doubt stands for the steps of the interrupted segment.
  const drivenElsewhere = run.edgeNodeId != null || ((run.status === "running" || run.status === "compensating") && !hasLiveDriver(run.id));
  const undecidable = rows === null || drivenElsewhere || context.interrupted === true || context[INTERRUPTED_EARLIER_CTX_KEY] === true;
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
export async function verifyStopsForAbort(runId: number, def: WorkflowDefinition, map: Map<number, MachineForValidation>): Promise<StopVerification> {
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

/** doc 81 Đợt 10 C (N4) — set (never cleared) when a Continue clears an edge run's `interrupted` mark (see storedSweepSource). */
export { INTERRUPTED_EARLIER_CTX_KEY };

/** THE central store: today's functions, unchanged. */
export const centralRunStore: RunStore = Object.freeze({
  kind: "central" as const,
  upsertStep,
  setStatusUnlessAborted: setRunStatusUnlessAborted,
  persistContext,
  resolveAdapter(kind: string, machineId: number, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    return withResolvedAdapter(kind, machineId, args);
  },
  authorizeCommand: centralAuthorizeCommand,
  authorizeAbortStop(runId: number, user: RunStoreUser, step: Extract<WorkflowStep, { type: "command" }>, idempotencyKey: string, args: Record<string, unknown>, cmd: EquipmentCommand): Promise<void> {
    return stopBoundedWrite(true, runId, step.id, "abort authorisation row", () => ensureOrchestrationAction(user, idempotencyKey, step, args, cmd));
  },
  async sweepSource(x: { live?: RunStoreContext | null; run?: OrchestrationRun; hasLiveDriver?: (runId: number) => boolean }): Promise<AbortSweepSource | null> {
    return x.live ? liveSweepSource(x.live) : x.run ? storedSweepSource(x.run, x.hasLiveDriver ?? (() => false)) : null;
  },
  verifyStops: verifyStopsForAbort,
  auditAbort: auditAbortStop,
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// doc 81 Đợt 10 C — CENTRAL applies what an EDGE walker reports (group B's report / complete endpoints call these, on their
// transaction): central stays the ONLY writer of an edge run's rows, with the SAME rules as its own walk.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** One step row an edge reported (group B: edgeEngineSink.EdgeStepRowWrite — structurally identical). */
export interface EdgeStepRowWrite {
  stepId: string;
  stepType: string;
  status: string;
  attempt: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  /** undefined ⇒ the stored result is KEPT (the upsertStep rule) */
  result: Record<string, unknown> | undefined;
}

/**
 * The reported rows, each with upsertStep's own rule (upsertStepOn): upsert on (runId, stepId); a 'running' write never
 * overwrites a completed / skipped / compensated row; a 'failed' `abort:` row never overwrites a completed one; no result ⇒
 * the stored result is kept; the durable RunEvent as upsertStep appends it. The caller (B) has already checked the stream
 * sequence, the claim, the step and the jti of every non-STOP result.
 */
export async function recordEdgeStepRows(db: RunDb, runId: number, rows: ReadonlyArray<EdgeStepRowWrite>): Promise<void> {
  for (const r of rows) {
    await upsertStepOn(db, runId, r.stepId, r.stepType, {
      status: r.status,
      attempt: r.attempt,
      ...(r.result !== undefined ? { result: r.result } : {}),
      error: r.error,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
    });
  }
}

/** How an edge segment ended (group B: edgeEngineSink.EdgeSegmentEnd — structurally identical). */
export interface EdgeSegmentEndApply {
  outcome: "completed" | "failed" | "aborted" | "paused" | "held";
  gateStepId?: string;
  heldReason?: string;
  error?: string;
  nodeCode: string;
  claimSeq: number;
  /** the ASSIGNED definition (the one the edge walked) */
  def: WorkflowDefinition;
  /** fix review 1 — command steps whose outcome is unknown (the complete request carries them in `error`: EDGE_OUTCOME_UNKNOWN(a,b)) */
  outcomeUnknown?: string[];
}

/** fix review 1 — the outcome-unknown steps of a segment end: the structured list, else the `EDGE_OUTCOME_UNKNOWN(a,b)` prefix of its error; only COMMAND steps of the definition. */
export function edgeOutcomeUnknownOf(end: Pick<EdgeSegmentEndApply, "outcomeUnknown" | "error" | "def">): string[] {
  const named = end.outcomeUnknown ?? (/^EDGE_OUTCOME_UNKNOWN\(([^)]{1,4000})\)/.exec(end.error ?? "")?.[1].split(",") ?? []);
  const commands = new Set(allStepsOf(end.def.steps).filter((s) => s.type === "command").map((s) => s.id));
  return [...new Set(named.map((x) => x.trim()).filter((x) => commands.has(x)))];
}
export type EdgeSegmentEndResult = { ok: true; status: string; changed: boolean } | { ok: false; code: "not_finished"; message: string };

/** foeEngine.OUTCOME_UNKNOWN_CTX_KEY (kept here as a literal: foeRunStore never imports the engine). */
const OUTCOME_UNKNOWN_KEY = "foeOutcomeUnknown";

/** The context mark of an edge-held run (central's own key: never taken from an edge context patch). */
export { EDGE_HELD_CTX_KEY };

/**
 * The end of an edge walk segment, with finishWalk's / setRunStatusUnlessAborted's semantics (design §2.6), on `db` (B's
 * transaction). Never from 'aborted' or a centrally STOPPED run (a rejection's claim token) — only from 'running' /
 * 'compensating' (the bound write P-E2 uses), so a late report never regresses a run. The run row decides, never the report:
 *   • completed — accepted only when the rows show every TOP-LEVEL step completed / skipped and no step row 'running'
 *                 (else not_finished, nothing written);
 *   • paused    — at a hitl_gate of the definition: 'awaiting_confirm' + currentStepId + the gate row the walker writes
 *                 ({prompt, approverRoles}; a completed gate row is never reopened). Not a gate ⇒ held (a person decides);
 *   • held      — D5: 'held' + the reason; Continue (resumeRun) re-queues it for the node;
 *   • failed    — 'failed'; `aborted` reported while central did not stop the run is a failure too (an edge never aborts
 *                 a run by itself).
 */
export async function applyEdgeSegmentEnd(db: RunDb, runId: number, end: EdgeSegmentEndApply): Promise<EdgeSegmentEndResult> {
  const [run] = await db.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).for("update").limit(1);
  if (!run) return { ok: true, status: "missing", changed: false };
  const ctx = ((run.contextJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const stopped = run.status === "aborted" || ctx[FOE_REJECT_CLAIM_CTX_KEY] != null;
  if (stopped || (run.status !== "running" && run.status !== "compensating")) return { ok: true, status: run.status, changed: false };
  const LIVE: Array<OrchestrationRun["status"]> = ["running", "compensating"];
  const write = async (status: OrchestrationRun["status"], patch: Partial<OrchestrationRun>): Promise<EdgeSegmentEndResult> => {
    const ok = await setRunStatusUnlessAbortedOn(db, runId, status, patch, LIVE);
    return { ok: true, status: ok ? status : run.status, changed: ok };
  };
  const held = (reason: string, error: string | undefined) => {
    const at = new Date().toISOString();
    // fix review 1 — a command the edge sent but could not record: never sent again (foeEngine reads the list on the re-walk)
    const unknown = edgeOutcomeUnknownOf(end);
    const prevUnknown = Array.isArray(ctx[OUTCOME_UNKNOWN_KEY]) ? (ctx[OUTCOME_UNKNOWN_KEY] as unknown[]).map(String) : [];
    return write("held", {
      currentStepId: null,
      // data-raw-ok: the run's error names the node and the reason code (shown on the run; the Studio keys on edgeHeld)
      error: `Edge node ${end.nodeCode} held run ${runId} (${reason})${error ? `: ${error.slice(0, 500)}` : ""} — nothing further was sent; Continue to resume it.`,
      contextJson: { ...ctx, [EDGE_HELD_CTX_KEY]: reason, [`${EDGE_HELD_CTX_KEY}At`]: at, [`${EDGE_HELD_CTX_KEY}Node`]: end.nodeCode, interrupted: true, interruptedAt: at, interruptedFrom: run.status, interruptedBy: `edge held: ${reason}`, ...(unknown.length ? { [OUTCOME_UNKNOWN_KEY]: [...new Set([...prevUnknown, ...unknown])] } : {}) },
    });
  };
  switch (end.outcome) {
    case "completed": {
      const rows = await db.select().from(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, runId));
      const by = new Map(rows.map((r) => [r.stepId, r.status as string] as const));
      const allDone = (end.def.steps ?? []).every((s) => by.get(s.id) === "completed" || by.get(s.id) === "skipped");
      const anyRunning = rows.some((r) => r.status === "running" && !r.stepId.startsWith(ABORT_ROW_PREFIX));
      if (!allDone || anyRunning) {
        return { ok: false, code: "not_finished", message: `Run ${runId}: the reported step rows do not show every top-level step completed / skipped (or a step is still running) — not completed.` };
      }
      return write("completed", { finishedAt: new Date() });
    }
    case "paused": {
      const gate = end.gateStepId ? allStepsOf(end.def.steps).find((s) => s.id === end.gateStepId) : undefined;
      if (!gate || gate.type !== "hitl_gate") return held("pausedAtNonGate", `the edge reported a pause at "${end.gateStepId ?? "?"}", which is not a gate of the assigned definition`);
      const out = await write("awaiting_confirm", { currentStepId: gate.id });
      if (out.ok && out.changed) {
        const [prior] = await db
          .select()
          .from(orchestrationRunSteps)
          .where(and(eq(orchestrationRunSteps.runId, runId), eq(orchestrationRunSteps.stepId, gate.id)))
          .limit(1);
        // the walker's own gate row (runStepBody, hitl_gate) — never over an approved (completed) one
        if (prior?.status !== "completed") {
          await upsertStepOn(db, runId, gate.id, "hitl_gate", { status: "awaiting_confirm", result: { prompt: gate.prompt, approverRoles: gate.approverRoles ?? null } });
        }
      }
      return out;
    }
    case "held":
      return held(end.heldReason ?? "centralUnreachable", end.error);
    case "aborted":
      // fix review 1 — the walk itself ended aborted (a precondition with onPreconditionFail "abort"): the same terminal status
      // central's own walk writes (finishWalk). A central abort never reaches here (the run is already 'aborted').
      // data-raw-ok: the run's error (the walker's own error text, prefixed with the node)
      return write("aborted", { finishedAt: new Date(), error: `aborted on edge node ${end.nodeCode}${end.error ? `: ${end.error.slice(0, 2000)}` : ""}` });
    default:
      // data-raw-ok: the run's error (the walker's own error text, prefixed with the node)
      return write("failed", { finishedAt: new Date(), error: `failed on edge node ${end.nodeCode}${end.error ? `: ${end.error.slice(0, 2000)}` : ""}` });
  }
}

/**
 * The PRIOR picture of a run for its next edge segment (edgeProtocol.edgePriorPictureSchema), from its step rows — what
 * central's own walk computes from the same rows (loadCompletedSteps + priorStepsOf + abortSentOf). Pure. Group B ships it in
 * the run package / sweep picture. `null` rows (not readable) ⇒ `unknown: true` (counted as acted, R-6-c).
 */
export function edgePriorPictureOf(
  rows: ReadonlyArray<{ id?: number; stepId: string; status: string; resultJson?: unknown; startedAt?: Date | null }> | null,
): { completed: string[]; settled: string[]; attempted: string[]; startOrder: string[]; branches: Array<{ stepId: string; branch: "then" | "else" }>; abortSentBefore: string[]; unknown: boolean } {
  if (rows === null) return { completed: [], settled: [], attempted: [], startOrder: [], branches: [], abortSentBefore: [], unknown: true };
  const p = priorStepsOf(rows);
  return {
    completed: rows.filter((r) => !r.stepId.startsWith(ABORT_ROW_PREFIX) && (r.status === "completed" || r.status === "skipped")).map((r) => r.stepId),
    settled: [...p.settled],
    attempted: [...p.attempted],
    startOrder: p.startOrder,
    branches: [...p.branches.entries()].map(([stepId, branch]) => ({ stepId, branch })),
    abortSentBefore: [...abortSentOf(rows)],
    unknown: false,
  };
}

// ── doc 81 Đợt 10 C fix review 2 (ruling R-10-ae) — what a re-walk of an EDGE run must never redo, from the STEP ROWS ──────

/** The run-context key central writes at a Continue / approval of an edge run (never an edge context patch). */
export const RESUME_STATE_CTX_KEY = "foeResumeState";
export type ResumeStepState = "compensationHeld" | "outcomeUnknown" | "doneFailed";
export type ResumeStateMap = Record<string, { state: ResumeStepState; error: string }>;

/**
 * R-10-ae — derived ONLY from the rows central wrote (and its own authorisation ledger), never from an edge context mark:
 *   • outcomeUnknown — a COMMAND step whose row is not final (running / held / none) but which was SENT: its row carries a
 *     dispatch result (routedTo), or central issued it an authorisation whose result never came back (`unreported`), or the
 *     segment end named it (`hintUnknown`, only ever ADDS). It is never sent again (a failure on the re-walk).
 *   • compensationHeld — a step that FAILED (row failed, or running whose final row was lost) whose compensation row is
 *     `held`, or whose compensation never started / started but was not sent: the re-walk runs ONLY the compensation.
 *   • doneFailed — a step that failed and whose compensation already ended (compensated / failed): nothing to redo.
 * `ambiguous` — a compensation row exists but the forward step's row does not say it failed, or a compensation whose own
 * outcome is not final and not unknown-sent … the Continue is REFUSED (never a guess that could re-send).
 */
export function edgeResumeStateOf(
  def: Pick<WorkflowDefinition, "steps">,
  rows: ReadonlyArray<{ stepId: string; status: string; resultJson?: unknown; error?: string | null }>,
  /** fix review 3 (R-10-ao N1) — the steps central issued ANY (non-superseded) authorisation to, reported or not */
  authorised: ReadonlySet<string>,
  hintUnknown: readonly string[] = [],
  /** fix review 3 (R-10-ao N2) — STOP steps (verified / robot / stop-typed candidates): never outcome-unknown — re-sent (L-7) */
  stops: ReadonlySet<string> = new Set(),
): { state: ResumeStateMap; ambiguous: string[] } {
  const all = allStepsOf(def.steps);
  const byId = new Map(rows.filter((r) => !r.stepId.startsWith(ABORT_ROW_PREFIX)).map((r) => [r.stepId, r] as const));
  const FINAL = new Set(["completed", "skipped", "compensated", "failed"]);
  const state: ResumeStateMap = {};
  const ambiguous: string[] = [];
  const sent = (id: string) => {
    const r = byId.get(id);
    return typeof (r?.resultJson as { routedTo?: unknown } | null | undefined)?.routedTo === "string" || authorised.has(id);
  };
  for (const s of all) {
    if (s.type !== "command" || stops.has(s.id)) continue; // N2 — a STOP is always sent again on a Continue (L-7)
    const r = byId.get(s.id);
    if (r && FINAL.has(r.status)) continue;
    if (sent(s.id) || hintUnknown.includes(s.id)) {
      state[s.id] = { state: "outcomeUnknown", error: `EDGE_OUTCOME_UNKNOWN: command step "${s.id}" was sent by the edge node but its result was not recorded — it is NOT sent again; check the equipment.` };
    }
  }
  for (const s of all) {
    const comp = s.compensation;
    if (!comp) continue;
    const r = byId.get(s.id);
    const c = byId.get(comp.id);
    const failedForward = r != null && (r.status === "failed" || (r.status === "running" && c != null));
    const error = r?.error ?? "";
    if (c == null) {
      if (r?.status === "failed") state[s.id] = { state: "compensationHeld", error }; // failed, compensation never started
      continue;
    }
    if (!failedForward) {
      ambiguous.push(s.id); // a compensation row, but the forward step's row does not say it failed
      continue;
    }
    if (c.status === "compensated" || c.status === "failed") state[s.id] = { state: "doneFailed", error };
    else state[s.id] = { state: "compensationHeld", error }; // held / running (not sent ⇒ resumed; sent ⇒ comp is outcomeUnknown, not re-sent)
  }
  return { state, ambiguous };
}
