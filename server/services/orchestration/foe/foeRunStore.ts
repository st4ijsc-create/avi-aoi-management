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
import { randomUUID } from "node:crypto";
import cluster from "node:cluster"; // A2(n) T8 lượt sửa 1 (CHAN-3) — cheDoProcessEngine
import { isStopCommandType } from "../../ot/loaiLenhStop";
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
import { FOE_ENGINE_TOOL, otPayloadHash, robotPayloadHash, withFoeGateApproval, withHangMoiStopGhim, withOtPayloadHash, type FoeGateApproval } from "../../ot/otActionBinding";
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
import { readEdgeAssignment } from "../../edge/edgeExecutionSchema"; // A2(n) T8 lượt sửa 1 (CHAN-3) — a run given to an edge node: its claim's progress is its heartbeat; lượt sửa 2 (CHAN-4): through the shared read (0370 missing ⇒ no edge)
import { EDGE_HELD_CTX_KEY, EDGE_HOLD_CONSUME_OVERRUN, EDGE_HOLD_UNUSED_NOT_REPORTED, INTERRUPTED_EARLIER_CTX_KEY, edgeHoldMarkOf } from "../../edge/edgeProgramReportRule"; // fix review 1 — ONE home of the hold marks
import { allStepsOf, buildEquipmentCommand, commandOf, isRobotKind, isRobotStopStep, isStopCandidate, laStopTheoBuoc, makeStopVerifier, orchestrationActionId, orchestrationActionIdCu, stopActionIdMoi, type StopVerification } from "./foeStepClass";
import { type DangDauVetAbort, type LopStopAbort, type PhanLoaiStopAbort, maTuChoiCua, nguonCuaKetQua, type ViChuaRa, FOE_STOP_NOT_SENT, KET_CUC_KHONG_RO_CHOT_CTX_KEY, KET_CUC_KHONG_RO_CTX_KEY, KET_CUC_KHONG_RO_DA_BAO_CTX_KEY, KET_CUC_KHONG_RO_DA_BAO_QUET_CTX_KEY, KHONG_CO_BU_TRU, canhBaoKetCucKhongRo, canhBaoTuBaoCaoEdge, chotTuHang, loiGiuChuaDocHang, loiGiuChuaRa, loiGiuKhongBen, loiLaKetCucKhongRo, maKetCucKhongRoCua, runDaChotKhongRo, stopChuaRaTuNguCanh, tachBaoCaoKhongRoEdge, xacNhanHetChot, xacNhanTu, ghiNenXacNhanNut, rutGonGiua, TRAN_TEN_NUT, TRAN_LY_DO, VI_KHONG_BAO, CAU_TAY_MAY, type CachEdgeTrungTam, viChuaRaCuaLoi, type BaoCaoKhongRoEdge, type DauKetCucKhongRo, type LoaiCanhBaoKhongRo, type MaKetCucKhongRo } from "./foeKetCucKhongRo"; // R1b-2b-2a A2(n)
import { napMotLan } from "./foeNapMotLan";
import { coTheDaBayCua } from "../../equipment/lenhTruocCoTheDaBay"; // A2(n) T7b-1 — "may already have flown" is no refusal: laHangChuaRa

const napDispatcher = napMotLan(() => import("../../ot/commandDispatcher"));
const napCanhBao = napMotLan(() => import("../../robot/criticalStopAlert"));

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
  /** A2(n) T5 — the walker's reading of the latch at this ask: only a latched run takes the marked route */
  daChot?: boolean;
}

/**
 * Why an edge segment ends `held` (design §2.10, D5) — the edge store's only non-central verdict (edgeProtocol EDGE_HELD_REASONS).
 * R1b-2b-2a A2(n) — `outcomeUnknown`: a command's outcome is unknown and the compensation due is not a pinned STOP ⇒ held for a person
 * (both stores; the walker's own verdict, foeEngine.execStep).
 */
export type RunStoreHeldReason = "centralUnreachable" | "journalFull" | "keysetUnknown" | "configStale" | "outcomeUnknown";

/** R1b-2b-2a A2(n) — what the walker reports about a compensation split after an unknown outcome (alert / anomaly — the store's way). */
export interface KetCucKhongRoBaoCao {
  loai: LoaiCanhBaoKhongRo;
  stepId: string;
  compId: string;
  /** the failed step's error */
  error: string;
  /** the walk segment the event belongs to (central: the walk's identity; the edge store uses its claim) */
  lan: string;
  /** m-K — `stepId`'s own failure is KNOWN; the doubt is another command's (the run is latched) */
  biet?: boolean;
  /** A2(n) T6e K1 — forwardNotSent of a stop-typed step whose pin the sweep could not verify (the dispatcher's predicate said pinned). Central only: never on the wire */
  stopKhongXacMinh?: true;
  /** A2(n) T9 — the words' marks (foeKetCucKhongRo.CanhBaoKhongRo, same names). Central's walk only: never on the wire (an edge's anomaly carries its closed fields only, chiTietAnomalyKhongRo) */
  thayCu?: "giu" | "chuaRa";
  heldStop?: true;
  khongStop?: true;
  chuaXacMinh?: true;
  khongBanGhi?: true;
  stopBuTru?: readonly string[];
}

export type AuthorizeVerdict =
  /**
   * stopGhim (R1b-2b-2a A2(m)) — central only: the command is a PINNED STOP and rides on a fresh authorisation row (the walker's
   * retry loop gives such a step with no explicit maxAttempts its STOP default, foeEngine.soLanThuToiDa).
   * stopXacMinh (A2(n) (a)) — edge only: a VERIFIED stop of the package. For the sink alone (no retry default: an edge's budget is unchanged).
   * stopChuaDocGhim (A2(n) T5, F4, A) — stop-typed, on a latched run, its pins unreadable: handed over on a MARKED fresh row (central) or with no authorisation at all (edge), so nothing but the
   * dispatcher's own verdict can send it. Never a non-STOP. Without the mark it does not exist: fail-closed.
   * ghimKhongDoc (T5) — this ask could not read the pins, latched or not: "not pinned" was not what the read said. For the words and for a refusal before the latch (H1).
   * chuaRaStop (T5, C-3) — stop-typed, on a latched run, its adapter could not be resolved: no dispatcher can be asked. Nothing goes; its budget stays.
   */
  | { ok: true; cmd: EquipmentCommand; args: Record<string, unknown>; approval: FoeGateApproval | null; stopGhim?: true; stopXacMinh?: true; stopChuaDocGhim?: true; ghimKhongDoc?: true; chuaRaStop?: true }
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
  /** A2(n) — the rows as read (central), for the one reading of the evidence after the latch; absent on an edge, whose rows of earlier segments are its package's picture. */
  hang?: ReadonlyArray<{ stepId: string; status: string; error?: string | null; resultJson?: unknown }> | null;
  /** A2(n) T5 — the STOPs the rows hold in state C (stopChuaRaTuHang). Absent on an edge: its walker has this segment's in memory, the rest is central's. */
  chuaRa?: ReadonlySet<string>;
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
  | "rejectClaimUndecided"
  /** A2(n) extension — not the sweep's: a forward command not handed over because the run is latched (the one audit both stores carry; nothing is silent). */
  | "notSentRunLatched";

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
   * R1b-2b-2a A2(o) AMENDMENT 2 — a dispatch REFUSED for a reason that means "hold, not fail" (the edge's config went stale after
   * the authorisation: nothing sent) ⇒ the step is HELD (no retry, no compensation). Absent / null ⇒ the usual failure path.
   * The central store has none (it never sees that refusal).
   */
  heldByDispatch?(stepId: string, result: { ok: boolean; detail?: Record<string, unknown> | null }): Promise<{ reason: RunStoreHeldReason; error: string } | null>;
  /**
   * EDGE only (synchronous — never a wait on a STOP's path): binds every abort-sweep STOP command to the run segment for the
   * edge dispatch (its ledger record). The central store has none.
   */
  bindAbortStop?(runId: number, step: Extract<WorkflowStep, { type: "command" }>, cmd: EquipmentCommand): void;
  /**
   * The OT authorisation row of an abort STOP (central: self-confirmed engine row, bounded by D; edge: none — a STOP never asks). A2(n) T7b-1 (5a) — `danhDau`: a stop-typed step of a latched run
   * nobody could verify takes the SAME marked fresh row as the walker's F4 route: only the dispatcher's own pinned-STOP verdict consumes it.
   */
  authorizeAbortStop(runId: number, user: RunStoreUser, step: Extract<WorkflowStep, { type: "command" }>, idempotencyKey: string, args: Record<string, unknown>, cmd: EquipmentCommand, opts?: { danhDau?: boolean }): Promise<void>;
  /** The abort sweep's picture: of the live walker (`live`), else of the stored run (`run`). null ⇔ neither is known. */
  sweepSource(x: { live?: RunStoreContext | null; run?: OrchestrationRun; hasLiveDriver?: (runId: number) => boolean }): Promise<AbortSweepSource | null>;
  /** The REAL stops of the definition (central: the Đợt 5 classifier, bounded by D; edge: the package's verified list). */
  verifyStops(runId: number, def: WorkflowDefinition, map: Map<number, MachineForValidation>): Promise<StopVerification>;
  /** One console line (always) + the record of an abort-sweep decision (central: audit row bounded by D; edge: journal). */
  auditAbort(user: RunStoreUser, runId: number, operation: AbortAuditOp, metadata: Record<string, unknown>): void;
  /** EDGE only — how the segment walked under this store ended (null ⇔ not ended, or the walker let go). */
  segmentEnd?(): EdgeSegmentEnd | null;
  /**
   * R1b-2b-2a A2(n) — is this COMPENSATION a STOP that may go out by itself? OT: a PINNED STOP (the A2(h) shared predicate); robot: a stop job
   * (R-2, the robot dispatcher's own rule, foeStepClass.isRobotStopStep → stopJob.isStopJob). Central: over the adapter the compensation
   * resolves to (bounded; pins unreadable / no adapter ⇒ false); edge: a stop the package lists as VERIFIED (+ its local robot classifier).
   * A2(n) T5: "chuaDoc" ⇔ stop-typed and nobody could tell: not "khong" (decision 2, A), it takes the marked route. Absent ⇒ "khong" (held — the fail-safe direction).
   */
  buTruLaStopGhim?(rc: RunStoreContext, comp: WorkflowStep): Promise<LaStop>;
  /** R1b-2b-2a A2(n) — tell a person (central: URGENT alert; edge: an anomaly central turns into that alert). Never throws, never awaited. */
  ketCucKhongRo?(rc: RunStoreContext, a: KetCucKhongRoBaoCao): void | Promise<boolean>;
  /**
   * A2(n) extension (4) — EDGE only: the authorisation `stepId` holds was never used (the sink refused the hand-over). Central supersedes it, so nothing reads the
   * step as possibly sent. The rows stop quoting it from the call (its synchronous part: a quoted jti is evidence of use). Never rejects. The central store has none.
   */
  uyQuyenKhongDung?(stepId: string): Promise<void>;
  /** A2(n) — may a stop-typed step refused at the sink ask its authorisation again, now latched? Absent: yes (central re-reads its pins). */
  stopHoiLaiDuoc?(stepId: string): boolean;
  /** A2(n) T5 — EDGE only: the dispatcher itself could not decide (its snapshot names no such adapter, the running connection is not the snapshot's): state C, whoever verified the STOP before. */
  dispatcherKhongQuyetDuoc?(result: { ok: boolean; detail?: Record<string, unknown> | null }): boolean;
  /** A2(n) T5 — EDGE only: the snapshot was read and says NOT pinned: an answer, no debt (E-C5, E-C6). */
  dispatcherNoiKhongGhim?(result: { ok: boolean; detail?: Record<string, unknown> | null }): boolean;
  /** A2(n) T5 — EDGE only: the package read this step and it is no STOP: a refusal of it is an answer, no debt (V-CTL). */
  stopDocDuocKhongGhim?(stepId: string): boolean;
}

// ── shared pure helpers (both stores) ───────────────────────────────────────────────────────────────────────────────

/** doc 81 Đợt 6 fix 2 (N5) — run-context key: the command steps handed to a dispatcher (see execCommand). */
export const DISPATCHED_CTX_KEY = "foeDispatchedSteps";

/** doc 81 Đợt 6 — the step rows written by an abort's STOP sweep (`abort:<stepId>`; never a definition step). */
export const ABORT_ROW_PREFIX = "abort:";

/**
 * A2(n) T7b-1d lượt sửa 1 (H30, chu du an 09/11) — THE words a walk writes on a step an Abort cancelled. Read back by laHangHuyBoiAbort, exactly: every source goes through this constant (foeHuyBoiAbortCensus). A row with other
 * words (a step that failed on its own, a precondition's abort, an edge claim let go) is the last word it always was. No mark in `result`: a row with a result would lose what the walker recorded (routedTo, accepted).
 */
export const LOI_HUY_BOI_ABORT = "Run is aborting.";
export const laHangHuyBoiAbort = (r: { status?: string; error?: string | null } | undefined): boolean => r?.status === "failed" && r.error === LOI_HUY_BOI_ABORT;

/**
 * doc 81 Đợt 6 — the abort sweep's picture of a run from its step rows (pure). A row whose command left the engine
 * (a dispatcher result is recorded) or that finished / failed counts as settled: a STOP there is never sent again.
 */
export function priorStepsOf(rows: ReadonlyArray<{ id?: number; stepId: string; status: string; resultJson?: unknown; startedAt?: Date | null; error?: string | null }>): PriorSteps {
  const settled = new Set<string>();
  const branches = new Map<string, "then" | "else">();
  const started: Array<{ stepId: string; at: number; id: number }> = [];
  const attempted = new Set<string>();
  for (const r of rows) {
    if (r.stepId.startsWith(ABORT_ROW_PREFIX)) continue;
    const result = (r.resultJson ?? null) as Record<string, unknown> | null;
    // A2(n) T5 — a row in state C is no last word: an Abort and a later walk still have this STOP to send
    // T5 (H16) — nor is a row central could not verify: it says what an edge reported, not that a STOP went
    if (!laHangChuaRa(r) && dauKhongXacNhan(result) === null && (["completed", "skipped", "compensated", "failed"].includes(r.status) || typeof result?.routedTo === "string")) settled.add(r.stepId);
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

/**
 * R1b-2b-2a A2(n) extension (owner's ruling) — machine-readable code of a forward non-STOP command step NOT handed to a dispatcher because its run is latched
 * (foeEngine.xetCongBuTru). Its outcome IS known: this attempt was not sent. Never of the class "may have gone out" (a step that may have keeps FOE_OUTCOME_UNKNOWN).
 * Here, not beside FOE_OUTCOME_UNKNOWN: edgeResumeStateOf reads it and foeRunStore never imports the engine (foeEngine re-exports it).
 */
export const FOE_NOT_SENT_RUN_LATCHED = "FOE_NOT_SENT_RUN_LATCHED";
/** The row of such a step: the code first (the Studio and a masked viewer key on it). */
export function loiKhongGuiChot(stepId: string): string {
  // data-raw-ok: machine-readable code first (known code, MA_LOI_DA_BIET); ids are the workflow's own
  return `${FOE_NOT_SENT_RUN_LATCHED}: not sent: run latched — command step "${stepId}" was not handed to a dispatcher: another command of this run has an unknown outcome. It is not sent again.`;
}
/**
 * A2(n) T9 (T9-CONTINUE-K1) — what the door of a latched walk returns for a STOP it leaves to the STOP pass: carried up into its containers' rows and the run's error. The code first (the same readers),
 * and never "not handed to a dispatcher": a pass hands it over, or names it owed.
 */
export function loiKhongGuiChotStop(stepId: string): string {
  // data-raw-ok: machine-readable code first (known code, MA_LOI_DA_BIET); ids are the workflow's own
  // lượt sửa 1 (R-3) — the door does not know whether it is a pinned STOP (a stop-typed step whose pins read "not pinned" comes here too): never "STOP step", never "the pass sends it"
  return `${FOE_NOT_SENT_RUN_LATCHED}: run latched — command step "${stepId}" is not walked forward here: the run's STOP pass decides it: it goes only as a verified pinned STOP, else it is named as NOT sent. Another command of this run has an unknown outcome.`;
}
/** Does a stored error say that? Only a row or resume state can (the walk carries khongGuiChot itself). */
export const laLoiKhongGuiChot = (error: string | null | undefined): boolean => typeof error === "string" && error.startsWith(`${FOE_NOT_SENT_RUN_LATCHED}:`);

export { FOE_STOP_NOT_SENT };
/** A2(n) T5 (C-2) — "chuaDoc" is NOT "khong": unreadable is never "not pinned" (decision 2, A). Only a stop-typed step can answer it. */
export type LaStop = "stop" | "khong" | "chuaDoc";
/**
 * T9 lượt sửa 3d (mục 2, điều kiện (3) của 3c) — the row's own STOP, from structured data only: the step the row is of (`stepId`; an `abort:` row's is its result's `stepId`, else its name after
 * the prefix, as stopChuaRaTuHang reads it), never an id read from the words (a cut or other id there loses no debt). A CONTAINER's row carries the same words (F-DB1: the walk writes the failed
 * row of a sequence / parallel / branch with the error that rose from inside it, `upsertStep(…, step.type, { status: "failed", error: loiHang })`, foeEngine.ts:1213; an edge's row gets its type
 * from central's definition, edgeReportsCentral.ts:359): its type says it is no STOP's own row. A row of no type (data that does not say) is read as the STOP's own: in doubt it is owed.
 */
const LOAI_KHOI_CHUA: ReadonlySet<string> = new Set(["sequence", "parallel", "branch"]);
/** an `abort:` row's result names its STOP: a non-empty string; anything else (no result, no stepId, another type) says nothing */
const idKetQuaAbort = (r: { resultJson?: unknown }): string | null => {
  const v = (r.resultJson as { stepId?: unknown } | null | undefined)?.stepId;
  return typeof v === "string" && v !== "" ? v : null;
};
/** THE id of an `abort:` row (stopChuaRaTuHang's key): its result's, else its name after the prefix (abortRowId: whole, or cut + `~` + 10 hex when long) */
const idCuaHangAbort = (r: { stepId: string; resultJson?: unknown }): string => idKetQuaAbort(r) ?? r.stepId.slice(ABORT_ROW_PREFIX.length);
/** is the row the one of `id`: its step; an `abort:` row by its result, else (in doubt: owed) by its name, a long id's cut head before `~` + hash included */
const laHangCuaBuoc = (r: { stepId: string; resultJson?: unknown }, id: string): boolean => {
  if (!r.stepId.startsWith(ABORT_ROW_PREFIX)) return r.stepId === id;
  const kq = idKetQuaAbort(r);
  if (kq !== null) return kq === id;
  const ten = r.stepId.slice(ABORT_ROW_PREFIX.length);
  return ten === id || (/~[0-9a-f]{10}$/.test(ten) && ten.length > 11 && id.startsWith(ten.slice(0, -11)));
};
const laHangMaChuaRa = (r: { stepId: string; stepType?: string; error?: string | null; resultJson?: unknown }, id: string): boolean =>
  typeof r.error === "string" && r.error.startsWith(`${FOE_STOP_NOT_SENT}:`) && laHangCuaBuoc(r, id) && !(typeof r.stepType === "string" && LOAI_KHOI_CHUA.has(r.stepType));
/**
 * THE row of a STOP not out (ONE source: priorStepsOf, stopChuaRaTuHang): the STOP's own row of state C (a container around it carries the same words, F-DB1), or — A2(n) T7b-1 — a row whose LAST
 * word is its dispatcher's "no" to the attempt it records: handed over (routedTo), not taken (accepted false), an answer (not a timeout, not "may already have flown"), and nothing written after it
 * (the row is still `running`: the row of state C that should have followed, or the known failure, is the write that was lost). A row whose walk wrote its end is read by that end. `id` the step's
 * id: an `abort:` row's is shortened when long, its result has the whole one.
 */
export const laHangChuaRa = (r: { stepId: string; stepType?: string; status?: string; error?: string | null; resultJson?: unknown }, id = r.stepId): boolean => {
  if (laHangMaChuaRa(r, id)) return true;
  const kq = (r.resultJson ?? null) as { routedTo?: unknown; accepted?: unknown; status?: unknown; detail?: unknown } | null;
  return r.stepId === id && r.status === "running" && typeof kq?.routedTo === "string" && kq.accepted === false && kq.status !== "timeout" && coTheDaBayCua({ ok: false, detail: (kq.detail ?? undefined) as Record<string, unknown> | undefined }) === null;
};
/**
 * A2(n) T5 (H16) — THE mark on a step row central could not verify: an edge reported a STOP step handed over with no authorisation, and central's own reading did not make it a verified STOP. `docLoi`:
 * the pins could not be read; `ghimLech`: they were read and they differ, or nothing resolves the step. Written only by edgeReportsCentral, never taken from a record. It is no confirmation: not
 * settled, not completed for a walk, it clears no URGENT and no debt. Not `acked_unverified`, which is a device's answer: this is what central does not know.
 */
export const DAU_KHONG_XAC_NHAN = "stopKhongXacNhan";
export type DangKhongXacNhan = "docLoi" | "ghimLech";
export function dauKhongXacNhan(result: unknown): DangKhongXacNhan | null {
  const v = (result as Record<string, unknown> | null | undefined)?.[DAU_KHONG_XAC_NHAN];
  return v === "docLoi" || v === "ghimLech" ? v : null;
}

/**
 * A2(n) T5 — MỘT định nghĩa of "still owed": the STOPs the rows hold in state C. An `abort:` row that went (or a read that found it no STOP) settles it. Pure.
 * T7b-1 — the rows ∪ the context (`ctx`, STOP_CHUA_RA_CTX_KEY: the walk's own list, a row may be the write lost). In doubt it is owed: the context only ADDS (an id it names is cleared only by the
 * STOP's own row completed, or an `abort:` row that went); it never clears a debt a row names. On a latched run (the rows' code or the context's latch): a refused attempt that is the row's last
 * word (laHangChuaRa) is owed, and so is an `abort:` row that failed, with the code or without it (C4: read when read, not when the sweep ran). Unlatched, a refused attempt is no debt: state C is a
 * latched run's (H1).
 */
export function stopChuaRaTuHang(rows: ReadonlyArray<{ stepId: string; stepType?: string; status?: string; error?: string | null; resultJson?: unknown }> | null | undefined, ctx?: Record<string, unknown> | null): Set<string> {
  const no = new Set<string>();
  const xong = new Set<string>();
  const daXong = new Set<string>();
  const khoa = chotTuHang(rows ?? []) !== null || runDaChotKhongRo(ctx);
  for (const r of rows ?? []) {
    const abort = r.stepId.startsWith(ABORT_ROW_PREFIX);
    const id = abort ? idCuaHangAbort(r) : r.stepId; // lượt sửa 3d (mục 2) — a result with no string stepId says nothing: the row's name (was String(stepId): a number named another STOP)
    const coMa = laHangMaChuaRa(r, id); // lượt sửa 3d (mục 2) — the code and the row's own step (structured), never the id in its words
    if (laHangChuaRa(r, id) && (coMa || khoa)) no.add(id);
    if (abort && khoa && r.status === "failed") no.add(id);
    if (abort && (r.status === "completed" || r.status === "skipped")) xong.add(id);
    if (!abort && r.status === "completed") daXong.add(id);
  }
  for (const id of stopChuaRaTuNguCanh(ctx)) if (!daXong.has(id)) no.add(id);
  for (const id of xong) no.delete(id);
  return no;
}

/**
 * A2(n) T7b-1d (H22) — THE trace of what an earlier Abort tried or meant to send and did not go, read the same on every run: an `abort:` row that failed (its result says which kind). An `abort:` row that went or was
 * settled ends it. Whoever wrote the STOP's own row or its container's has no say: this is the Abort's own record. What a press does with it: planAbortSweep (it enters the plan, the verification decides),
 * phanLoaiStopAbort (its class). The row is all there is: H27 (chu du an 09/11), a run not latched, that one write lost and the walker's rows over it: the press may send nothing; the first answer says so by name. Pure.
 */
export function dauVetAbort(rows: ReadonlyArray<{ stepId: string; status?: string; resultJson?: unknown }> | null | undefined): Map<string, DangDauVetAbort> {
  const out = new Map<string, DangDauVetAbort>();
  for (const r of rows ?? []) {
    if (!r.stepId.startsWith(ABORT_ROW_PREFIX)) continue;
    const kq = (r.resultJson ?? null) as { stepId?: unknown; abortStop?: unknown } | null;
    const id = String(kq?.stepId ?? r.stepId.slice(ABORT_ROW_PREFIX.length));
    if (r.status === "completed" || r.status === "skipped") out.delete(id);
    else if (r.status === "failed") out.set(id, kq?.abortStop === "chuaXacMinh" || kq?.abortStop === "chuaTraLoi" ? kq.abortStop : "daThu");
  }
  return out;
}

/** A2(n) T7b-1c — what is read of a run at an Abort. `hang` null ⇔ the step rows could not be read. `daThu`: the live walk's memory of a hand-over. */
export interface VaoPhanLoaiStopAbort {
  hang: ReadonlyArray<{ stepId: string; status?: string; error?: string | null; resultJson?: unknown; attempt?: number | null }> | null;
  ctx: Record<string, unknown> | null | undefined;
  daThu?: (id: string) => boolean;
  /** T7b-1d lượt sửa 1 (H31) — this press's own read verifies it as a pinned STOP: a row that said "read: not pinned" is an older answer, no last word */
  ghimLai?: (id: string) => boolean;
}
/**
 * A2(n) T7b-1c — what ONE row says of a hand-over. "tuChoi": a word that it did not go (a dispatcher's refusal, the sink, state C). A dispatcher's answer that is no clean "no" (no answer, "may have flown", a device
 * error) is "may have gone". A row that began, or failed with no dispatcher's word, cannot say.
 */
function dauVetCuaHang(r: { stepId: string; status?: string; error?: string | null; resultJson?: unknown } | undefined, id: string): "daGiao" | "coTheDaRa" | "tuChoi" | null {
  if (!r) return null;
  const kq = (r.resultJson ?? null) as { routedTo?: unknown; accepted?: unknown; status?: unknown; detail?: unknown } | null;
  if (dauKhongXacNhan(kq) !== null) return "coTheDaRa";
  if (r.status === "completed" || r.status === "compensated" || kq?.accepted === true) return "daGiao";
  if (typeof kq?.routedTo === "string") {
    const detail = (kq.detail ?? undefined) as { reason?: unknown } | undefined;
    const ma = maTuChoiCua({ error: r.error, status: typeof kq.status === "string" ? kq.status : null, detail });
    const coThe = kq.status === "timeout" || coTheDaBayCua({ ok: false, detail: detail as Record<string, unknown> | undefined }) !== null || nguonCuaKetQua(String(kq.status), ma, kq.routedTo === "robot-dispatcher") === "driverLoi";
    return coThe ? "coTheDaRa" : "tuChoi";
  }
  if (laHangChuaRa(r, id) || laLoiKhongGuiChot(r.error)) return "tuChoi";
  return r.status === "running" || r.status === "failed" ? "coTheDaRa" : null;
}
/**
 * A2(n) T7b-1c (dieu-phoi 09/11) — THE classification of a STOP at an Abort, of a latched run, and T7b-1d (H22) of a press on any run: what goes (stopAbortCoGui), its key (`khoaThu`), the words (chuStopAbort) and the answer all read this, from ONE read.
 *   xong      — an `abort:` row that went or was settled, or a read-back that confirmed it;
 *   no        — stopChuaRaTuHang (one definition of "owed"), or, on a run not latched, an Abort's trace it did not go (dauVetAbort: no debt, H23; a press sends it, the window of such a run stands at the door of the sweep); `truoc` says what its rows know of an earlier hand-over, for the words only;
 *   daGiao    — a dispatcher took it (accepted, or its row completed);
 *   coTheDaRa — it may have gone: no answer, a device error, a row that began or failed with no word, or only the record of the hand-over. foeDispatchedSteps and the walk's `attempted` are written BEFORE the
 *               dispatcher is called (foeEngine execCommandMot, the same tick) and never cleared on a refusal, so alone they prove only this. T7b-1d — so does an Abort's hand-over with no answer yet;
 *   chuaGiao  — read, and no trace, or a word that it did not go;
 *   khongDoc  — nothing could be read (a debt the context holds is still `no`).
 * dieu-phoi 09/11: khoá gần đúng cho attempt 0; dispatcher chỉ phát lại khi lần dưới khoá đó ok và không mô phỏng, nên không nuốt STOP; tệ nhất thêm một STOP
 */
export function phanLoaiStopAbort(id: string, vao: VaoPhanLoaiStopAbort): PhanLoaiStopAbort {
  if (vao.hang === null) return stopChuaRaTuNguCanh(vao.ctx).includes(id) ? { lop: "no" } : { lop: "khongDoc" };
  const cua = vao.hang.find((r) => r.stepId === id);
  const ab = vao.hang.find((r) => r.stepId.startsWith(ABORT_ROW_PREFIX) && String((r.resultJson as { stepId?: unknown } | null | undefined)?.stepId ?? r.stepId.slice(ABORT_ROW_PREFIX.length)) === id);
  if (ab?.status === "completed" || (ab?.status === "skipped" && vao.ghimLai?.(id) !== true)) return { lop: "xong" };
  const vet = dauVetCuaHang(cua, id);
  const vetAb = dauVetCuaHang(ab, id);
  const dv = dauVetAbort(vao.hang).get(id);
  const truoc = dv === "chuaXacMinh" ? dv : vet === "daGiao" || vet === "coTheDaRa" ? vet : vetAb === "daGiao" || vetAb === "coTheDaRa" ? vetAb : undefined;
  if (stopChuaRaTuHang(vao.hang, vao.ctx).has(id) || dv === "daThu" || dv === "chuaXacMinh") return truoc ? { lop: "no", truoc } : { lop: "no" };
  if ((cua?.resultJson as { status?: unknown } | null | undefined)?.status === "acked_verified") return { lop: "xong" };
  if (vet === "daGiao") return { lop: "daGiao" };
  const khoaThu = typeof cua?.attempt === "number" && cua.attempt > 0 ? cua.attempt : 1;
  if (vet === "coTheDaRa" || dv === "chuaTraLoi") return { lop: "coTheDaRa", khoaThu };
  if (vet === "tuChoi") return { lop: "chuaGiao" };
  const giao = vao.ctx?.[DISPATCHED_CTX_KEY];
  if ((Array.isArray(giao) && giao.map(String).includes(id)) || vao.daThu?.(id) === true) return { lop: "coTheDaRa", khoaThu };
  return { lop: "chuaGiao" };
}
/** Which press of an Abort this is: the first, on a run not ended; again on an aborted run, in ABORT_RESEND_WINDOW_MS or past it. */
export type LanBamAbort = "dau" | "trongCua" | "ngoaiCua";
/**
 * A2(n) T7b-1c — does this class go at this press. Owed: always (B2). Handed over, never confirmed: the first Abort of a run not ended only (G, H3). No trace, or may have gone: not past the window. Unread: a first
 * Abort sends what the planner has due (may add a STOP, never swallows one, L-7), a press sends nothing on it. Never reads `truoc`. Pure.
 */
export function stopAbortCoGui(p: Pick<PhanLoaiStopAbort, "lop" | "truoc">, lan: LanBamAbort): boolean {
  switch (p.lop) {
    case "no":
      return true;
    case "chuaGiao":
    case "coTheDaRa":
      return lan !== "ngoaiCua";
    case "daGiao":
    case "khongDoc":
      return lan === "dau";
    case "xong":
      return false;
  }
}

// ── A2(n) T7 — THE end decision of a run (decision 1, B, H1, H2, H18, M4; plan point 3) ────────────────────────────────────────────────────────────────────────────────────

/** Why a run reaches an end. walk / edgeSegment / exception: no durable URGENT, or a STOP still owed ⇒ held. abort / gateRejected (a person): always an end (decision B). */
export type LyDoKetThuc = "walk" | "edgeSegment" | "exception" | "abort" | "gateRejected";
export interface HangKetThuc {
  stepId: string;
  status?: string;
  error?: string | null;
  resultJson?: unknown;
}
/** What the gate is given: the database's picture of the run, plus what a live walk holds in memory beside it. */
export interface AnhKetThuc {
  runId: number;
  ctx: Record<string, unknown>;
  owner: number | null;
  /** the run's step rows; null ⇔ they could not be read (nothing can say then that no STOP is owed) */
  rows: ReadonlyArray<HangKetThuc> | null;
  /** names the owner of a marked compensation in its URGENT, as the report path does */
  def?: Pick<WorkflowDefinition, "steps"> | null;
  /** central's live walk: its latch, the STOPs it left owed, the URGENTs it raised (a bounded row write may be the one lost) */
  boNho?: { chot: { stepId: string; ma: MaKetCucKhongRo } | null; chuaRa: Iterable<string>; baoCho: ReadonlyArray<Promise<boolean>>; /** why a STOP it left owed stays owed (its row may be the write lost) */ viCua?: (stopId: string) => ViChuaRa | undefined; /** T9 — how its words read it (no STOP; pins nobody verified) */ cachCua?: (stopId: string) => { khongStop?: true; chuaXacMinh?: true }; /** T9 (XAC_NHAN) — every unknown it decided; whether it dropped forward work */ khongRo?: readonly string[]; boTien?: boolean };
  /** an edge segment: the URGENTs of the reports riding on its end, and the latch they carry */
  daCo?: ReadonlyArray<Promise<boolean>>;
  /** T9 lượt sửa 3 (RA2-2) — an edge segment: how central reads a STOP it leaves owed (cachEdgeTrungTam of the report, the node's adapter): the run's error by the URGENT's rule */
  cachNo?: (stopId: string) => Promise<{ khongStop?: boolean; chuaXacMinh?: boolean; adapterNut?: boolean }>;
  /** T9 lượt sửa 3c (mục 1) — an edge segment: the code of the node's report of that STOP (structured), before the row's */
  viNo?: (stopId: string) => ViChuaRa | undefined;
  chotTuBao?: { stepId: string; ma: MaKetCucKhongRo } | null;
  /** a hold or a pause: no end. Waits for what is on its way, raises nothing new */
  chiDoi?: boolean;
  /** the claim of a marked row whose result does not name one (the segment's own) */
  claimSeq?: number;
}
export interface KetQuaKetThuc {
  ghi: "terminal" | "held";
  /** why held: a STOP owed (H1), no durable URGENT (decision 1, H2, H18), the rows unread */
  vi: "no" | "khongBen" | "chuaDoc" | null;
  urgentBen: boolean;
  chot: { stepId: string; ma: MaKetCucKhongRo } | null;
  /** the STOPs the rows (and the walk's memory) hold owed */
  no: string[];
  /** marked steps whose URGENT is not durable */
  khongXacNhan: string[];
  /** this decision established the durability of the latch's URGENT: DA_BAO is to be written */
  moi: boolean;
  /** the people the run_end URGENT went to, when this decision raised it */
  nguoiNhan?: number;
  /** the run's error when held */
  loi?: string;
}

/** true as soon as one says durable; false once all said no, or past `hanMs`. No answer is no yes. */
async function motBen(ps: ReadonlyArray<Promise<boolean>>, hanMs: number, label: string): Promise<boolean> {
  if (ps.length === 0) return false;
  const mot = new Promise<boolean>((resolve) => {
    let con = ps.length;
    const xong = () => {
      con -= 1;
      if (con === 0) resolve(false);
    };
    for (const p of ps) p.then((b) => (b === true ? resolve(true) : xong()), xong);
  });
  return withDeadline(mot, hanMs, label).catch(() => false);
}

/** H18 — the URGENTs of the marked rows, by run + step + form + claim: what the report path raised, for the end gate (in-process; a restart asks again, the durable dedup answers). */
const benKhongXacNhanCho = new Map<string, Promise<boolean>>();
const BEN_KHONG_XAC_NHAN_TOI_DA = 5_000;
const khoaKhongXacNhan = (runId: number, stepId: string, dang: DangKhongXacNhan, claimSeq: number | undefined) => `${runId}:${stepId}:${dang}:${claimSeq ?? "-"}`;
/** A run that ended forgets its marks' answers. */
export function quenBenKhongXacNhan(runId: number): void {
  for (const k of [...benKhongXacNhanCho.keys()]) if (k.startsWith(`${runId}:`)) benKhongXacNhanCho.delete(k);
}
/**
 * A2(n) T5 (H16), T7 (H18) — THE URGENT of a marked step: an edge reports this STOP handed over and central could not verify it. One text and one key for the report path (edgeReportsCentral) and
 * the end gate: `stepId` the marked step, under its owner when it is a compensation's. Never throws. true ⇔ stored.
 */
export function baoKhongXacNhan(x: { runId: number; def?: Pick<WorkflowDefinition, "steps"> | null; stepId: string; dang: DangKhongXacNhan; claimSeq: number | undefined; owner: number | null }): Promise<boolean> {
  const chu = x.def ? chuBuTruTrongDinhNghia(x.def.steps, x.stepId) : null;
  const p = canhBaoKetCucKhongRo({ loai: x.dang === "docLoi" ? "stopKhongXacNhanDoc" : "stopGhimLech", runId: x.runId, stepId: chu ? chu.step.id : x.stepId, compId: chu ? x.stepId : KHONG_CO_BU_TRU, error: "FOE_OUTCOME_UNKNOWN", lan: `claim${x.claimSeq ?? "-"}`, biet: true, owner: x.owner });
  if (benKhongXacNhanCho.size >= BEN_KHONG_XAC_NHAN_TOI_DA) benKhongXacNhanCho.delete(benKhongXacNhanCho.keys().next().value as string);
  benKhongXacNhanCho.set(khoaKhongXacNhan(x.runId, x.stepId, x.dang, x.claimSeq), p);
  return p;
}
/** The claim an edge marked row was reported under (its result's `edge` mark). */
function claimCuaHang(r: HangKetThuc): number | undefined {
  const c = (r.resultJson as { edge?: { claimSeq?: unknown } } | null | undefined)?.edge?.claimSeq;
  return Number.isSafeInteger(c) ? (c as number) : undefined;
}

/**
 * A2(n) T7 — THE decision of every end of a run: the walk's own (central's memory comes in `boNho`, its evidence is the rows), an edge segment's end, an exception, an Abort and a person's gate
 * rejection. Read from the ROWS (C1: an exception never passed duongKetThuc):
 *   • a STOP still owed (stopChuaRaTuHang, H1): held, whatever the URGENT did. Not for a person's Abort or rejection (decision B: it ends; the Abort sends it);
 *   • latched (the context's latch, the report's, the rows' code): an end needs a durable URGENT (decision 1). DA_BAO, or one of the URGENTs on their way, or one bounded run_end under the fixed key
 *     `…run_end:<run>:<latch step>:-:chot`. recipients = 0 is no URGENT (M4: canhBaoKetCucKhongRo). No answer is no yes;
 *   • a marked row (stopKhongXacNhan, H18), latched or not: its own URGENT durable, else held;
 *   • the rows unread: held (nothing can say no STOP is owed).
 * A hold or a pause (`chiDoi`) is no end: it waits for what is on its way and raises nothing. Never throws. Confirmation (decision 3, XAC_NHAN) is T9's: until then every latched end needs its URGENT.
 * A2(n) T8 (N-3) — `tongMs`: ONE bound for every wait of this decision together (each still at most `hanMs`). An edge segment's end decides inside the batch's transaction, holding the run row
 * FOR UPDATE: without it the waits add up (the latch's two, each mark's two). What is raised is raised all the same; past the bound it is not waited for, so it is no yes (held, H2).
 */
export async function quyetDinhKetThucAnh(x: AnhKetThuc, lyDo: LyDoKetThuc, hanMs = 5 * STOP_DB_STEP_DEADLINE_MS, tongMs?: number): Promise<KetQuaKetThuc> {
  const nguoi = lyDo === "abort" || lyDo === "gateRejected";
  const rows = x.rows ?? [];
  const tuCtx = x.ctx[KET_CUC_KHONG_RO_CHOT_CTX_KEY] as { stepId?: unknown; ma?: unknown } | null | undefined;
  const tuHang = chotTuHang(rows);
  const chot =
    tuCtx?.stepId != null
      ? { stepId: String(tuCtx.stepId), ma: maKetCucKhongRoCua(typeof tuCtx.ma === "string" ? tuCtx.ma : null) }
      : (x.chotTuBao ?? (tuHang ? { stepId: tuHang.stepId, ma: tuHang.ma } : null) ?? x.boNho?.chot ?? null);
  const no = [...new Set([...stopChuaRaTuHang(rows, x.ctx), ...(x.boNho?.chuaRa ?? [])])];
  if (x.rows === null && !nguoi) return { ghi: "held", vi: "chuaDoc", urgentBen: false, chot, no, khongXacNhan: [], moi: false, loi: loiGiuChuaDocHang(x.runId, chot?.ma ?? null) };
  const giuNo = no.length > 0 && !nguoi;
  const doi = x.chiDoi === true || giuNo; // held is no end: nothing new is raised
  const dau = rows.filter((r) => !r.stepId.startsWith(ABORT_ROW_PREFIX) && dauKhongXacNhan(r.resultJson) !== null);
  const label = `FOE run ${x.runId} end-of-run URGENT`;
  // N-3 — the one bound of every wait together: once it is past, every later wait reads no (an answer already in, too: motBen settles a few microtasks after the bound's own promise). The outcome is
  // held either way (one wait already failed); only the list of marks named in the held words may then name one stored. Every raise is still made
  const hetTong: Promise<false> | null = tongMs === undefined ? null : withDeadline(new Promise<never>(() => undefined), tongMs, `${label} (all waits)`, { unref: true }).catch(() => false as const);
  const choi = (p: Promise<boolean>): Promise<boolean> => (hetTong ? Promise.race([p, hetTong]) : p);
  let benChot = true;
  let moi = false;
  let nguoiNhan: number | undefined;
  // A2(n) T9 (decision 3, XAC_NHAN, X1, X2, X2-EXC) — every unknown covered by a confirmed STOP and no forward work dropped: no URGENT is needed (the trace stays on the rows and in the context). ONE reading
  // (xacNhanHetChot) for this gate, every end that comes here, and the obligation sweep
  const lenhCua = x.def ? new Set(allStepsOf(x.def.steps as WorkflowStep[]).filter((s) => s.type === "command").map((s) => s.id)) : null;
  const xacNhanHet = xacNhanHetChot({ chot, rows: x.rows, ctx: x.ctx, ...(lenhCua ? { laLenh: (id: string) => lenhCua.has(id), lenhTien: lenhTienCua(x.def!.steps as WorkflowStep[]) } : {}), khongRo: x.boNho?.khongRo, boTien: x.boNho?.boTien });
  // lượt sửa 2 (R-5 (2)) — the confirmation came from an edge node's rows: said, once per decision, with its source
  if (chot && x.ctx[KET_CUC_KHONG_RO_DA_BAO_CTX_KEY] == null && xacNhanHet && lyDo === "edgeSegment") void ghiNenXacNhanNut(x.runId, [...xacNhanTu(x.rows, null)], "cong").catch(() => undefined);
  if (chot && x.ctx[KET_CUC_KHONG_RO_DA_BAO_CTX_KEY] == null && !xacNhanHet) {
    benChot = await choi(motBen([...(x.daCo ?? []), ...(x.boNho?.baoCho ?? [])], hanMs, label));
    if (!benChot && !doi) {
      benChot = await choi(
        withDeadline(
          canhBaoKetCucKhongRo({ loai: "runEnd", runId: x.runId, stepId: chot.stepId, compId: KHONG_CO_BU_TRU, error: chot.ma, lan: "chot", owner: x.owner, soNguoiNhan: (n) => (nguoiNhan = n) }),
          hanMs,
          label,
        ).catch(() => false),
      );
    }
    moi = benChot;
  }
  const khongXacNhan: string[] = [];
  for (const r of dau) {
    const dang = dauKhongXacNhan(r.resultJson) as DangKhongXacNhan;
    const claimSeq = claimCuaHang(r) ?? x.claimSeq;
    const cho = benKhongXacNhanCho.get(khoaKhongXacNhan(x.runId, r.stepId, dang, claimSeq));
    let ben = cho ? await choi(motBen([cho], hanMs, label)) : false;
    if (!ben && !doi) ben = await choi(motBen([baoKhongXacNhan({ runId: x.runId, def: x.def, stepId: r.stepId, dang, claimSeq, owner: x.owner })], hanMs, label));
    if (!ben) khongXacNhan.push(r.stepId);
  }
  const ben = benChot && khongXacNhan.length === 0;
  const out: KetQuaKetThuc = { ghi: nguoi || (!giuNo && ben) ? "terminal" : "held", vi: null, urgentBen: ben, chot, no, khongXacNhan, moi, ...(nguoiNhan !== undefined ? { nguoiNhan } : {}) };
  if (nguoi) return out;
  if (giuNo) {
    const id0 = no[0] as string;
    // T9 lượt sửa 3 (RA2-2) — an edge segment's end: central's reading of it, the node's adapter (one rule with the URGENT); central's walk: its memory, as before
    const cach = x.cachNo ? await x.cachNo(id0) : x.boNho?.cachCua?.(id0);
    // lượt sửa 3c (mục 1) — an edge segment: the node's report first, then the row's own code; nothing ⇒ NOT_REPORTED (fail-closed: never "did NOT go out")
    const vi = x.viNo?.(id0) ?? viChuaRaCuaLoi(rows.find((r) => r.stepId === id0)?.error) ?? x.boNho?.viCua?.(id0) ?? (x.cachNo ? VI_KHONG_BAO : undefined);
    return { ...out, vi: "no", loi: loiGiuChuaRa(id0, vi, cach) };
  }
  if (!ben) return { ...out, vi: "khongBen", loi: loiGiuKhongBen(x.runId, { ma: benChot ? null : (chot?.ma ?? null), khongXacNhan }) };
  return out;
}

/** A2(n) T9 lượt sửa 1 — the forward commands of a definition: sequence / parallel / branch (both arms), never inside a compensation */
function lenhTienCua(steps: readonly WorkflowStep[], out: string[] = []): string[] {
  for (const s of steps) {
    if (s.type === "command") out.push(s.id);
    else if (s.type === "sequence" || s.type === "parallel") lenhTienCua(s.steps, out);
    else if (s.type === "branch") {
      lenhTienCua(s.then, out);
      lenhTienCua(s.else ?? [], out);
    }
  }
  return out;
}

/** A2(n) T8 (N-3) — the end gate of an edge segment waits at most this long in all, inside the transaction holding the run row (the same 5·D a single wait had). */
export const KET_DOAN_EDGE_TONG_MS = 5 * STOP_DB_STEP_DEADLINE_MS;

/** A2(n) T8 — a live run (a walker may still reach its own end and raise its own URGENT) is swept only once nothing of it has changed for this long. T12 sets the period. */
export const QUET_URGENT_TUOI_TOI_THIEU_MS = 5 * 60_000;
const QUET_URGENT_STATUS = ["held", "awaiting_confirm", "aborted", "running", "compensating", "queued"] as const;
/** M9a — the statuses a walker may still be on: the minimum age applies to each of them */
const QUET_URGENT_SONG: ReadonlySet<string> = new Set(["running", "compensating", "queued"]);
/** T8 lượt sửa 1 (CHAN-3) — the statuses of a run a CENTRAL walker walks */
const QUET_URGENT_WALKER_TRUNG_TAM: ReadonlySet<string> = new Set(["running", "compensating"]);

/**
 * A2(n) T8 lượt sửa 1 (CHAN-3) — how many processes may run the central engine. The live-walker check of the sweep (`walkerSong`, the engine's liveRuns) sees this process only.
 * lượt sửa 2 (dieu-phoi 11/11, (A) the FLOOR): the walker runs in the api pods (routers, boot's rehydrate; helm `replicaCount` 2, HA 3 and more), each with its own liveRuns, so ONE process
 * is never assumed: only FOE_ENGINE_MOT_PROCESS=1 confirms it ("mot"), and only when nothing this process can see says more (a cluster worker, pm2's NODE_APP_INSTANCE, WEB_CONCURRENCY above 1:
 * "nhieu"; WEB_CONCURRENCY that is no positive integer: "khongRo"). Absent: "khongRo". Read from the environment the process was given (never a .env file).
 */
export type CheDoProcessEngine = "mot" | "nhieu" | "khongRo";
export function cheDoProcessEngine(env: NodeJS.ProcessEnv = process.env, laWorker: boolean = cluster.isWorker === true): CheDoProcessEngine {
  if (laWorker || env.NODE_APP_INSTANCE !== undefined) return "nhieu";
  const wc = env.WEB_CONCURRENCY;
  if (wc !== undefined && wc.trim() !== "") {
    const n = Number(wc);
    if (!Number.isSafeInteger(n) || n < 1) return "khongRo";
    if (n > 1) return "nhieu";
  }
  return env.FOE_ENGINE_MOT_PROCESS === "1" ? "mot" : "khongRo";
}
/**
 * A2(n) T8 lượt sửa 3 (CHAN-5) — FOE_ENGINE_MOT_PROCESS=1 beside a sign of more than one process this process can see: the mode is not "mot" (cheDoProcessEngine), and the flag is said to be wrong, ONCE
 * per process (not at every sweep, whether or not a run is skipped). What it cannot see (helm `replicaCount`, another host) it cannot say: the flag is the deployment's word there.
 */
let daCanhBaoCoMotProcess = false;
function canhBaoCoMotProcess(env: NodeJS.ProcessEnv = process.env, laWorker: boolean = cluster.isWorker === true): void {
  if (daCanhBaoCoMotProcess || env.FOE_ENGINE_MOT_PROCESS !== "1") return;
  const che = cheDoProcessEngine(env, laWorker);
  if (che === "mot") return;
  const thay = [laWorker ? "a cluster worker" : null, env.NODE_APP_INSTANCE !== undefined ? `NODE_APP_INSTANCE=${env.NODE_APP_INSTANCE}` : null, env.WEB_CONCURRENCY !== undefined && env.WEB_CONCURRENCY.trim() !== "" ? `WEB_CONCURRENCY=${env.WEB_CONCURRENCY}` : null].filter((x): x is string => x !== null);
  daCanhBaoCoMotProcess = true;
  console.warn(`[FOE] FOE_ENGINE_MOT_PROCESS=1 says the central engine runs in ONE process, but this process sees ${thay.join(", ")} (${che}): the flag is not taken; central running / compensating runs are not told by the URGENT obligation sweep. Unset the flag or run one engine process.`);
}

/** the latest moment the run, its rows or its edge claim (the node's progress: the edge walker's heartbeat) changed; NaN ⇔ nothing says (then the run is old enough: the side that raises) */
function mocMoiNhat(run: { updatedAt?: unknown; startedAt?: unknown }, rows: ReadonlyArray<{ startedAt?: unknown; finishedAt?: unknown; createdAt?: unknown }>, claim: { lastProgressAt?: unknown; claimedAt?: unknown } | null): number {
  const t = (v: unknown) => (v instanceof Date || typeof v === "string" || typeof v === "number" ? new Date(v as string).getTime() : NaN);
  const ts = [t(run.updatedAt), t(run.startedAt), ...rows.flatMap((r) => [t(r.startedAt), t(r.finishedAt), t(r.createdAt)]), t(claim?.lastProgressAt), t(claim?.claimedAt)].filter((n) => Number.isFinite(n));
  return ts.length ? Math.max(...ts) : NaN;
}

/**
 * T8 lượt sửa 1 (CHAN-1, CHAN-2) — the sweep's OWN durable mark, never DA_BAO: DA_BAO keeps its meaning "the walker's end told the latch" (abortStopSweep's `tien` reads it to say the walk's words again,
 * and must not take the sweep's run_end for them). `{ chot?: { stepId, at }, dau?: { <run>:<step>:<form>:<claim>: at } }`: the latch's run_end and each mark's URGENT the sweep stored. Read by the sweep only.
 * A value that is no such object is a READ ERROR: the sweep raises again (one line for that process: an URGENT repeated is noise, one lost is type (2)) and logs it; its write puts a sound value back.
 */
interface DauQuet {
  chot: { stepId: string; at: string } | null;
  dau: Record<string, string>;
}
function docDaBaoQuet(v: unknown): DauQuet | "loi" {
  if (v === undefined || v === null) return { chot: null, dau: {} };
  if (typeof v !== "object" || Array.isArray(v)) return "loi";
  const o = v as { chot?: unknown; dau?: unknown };
  const chot = o.chot === undefined || o.chot === null ? null : typeof o.chot === "object" && typeof (o.chot as { stepId?: unknown }).stepId === "string" ? { stepId: (o.chot as { stepId: string }).stepId, at: String((o.chot as { at?: unknown }).at ?? "") } : "loi";
  if (chot === "loi") return "loi";
  if (o.dau !== undefined && (typeof o.dau !== "object" || o.dau === null || Array.isArray(o.dau))) return "loi";
  const dau: Record<string, string> = {};
  for (const [k, x] of Object.entries((o.dau ?? {}) as Record<string, unknown>)) {
    if (typeof x !== "string") return "loi";
    dau[k] = x;
  }
  return { chot, dau };
}

/** The sweep's mark, under the row lock, merged into the context as it is now (only its own key; DA_BAO never), adding what this round stored. Bounded by D, best-effort: a lost write raises again. */
async function ghiDaBaoQuet(d: RunDb, runId: number, them: { chot?: string; dau?: readonly string[] }): Promise<void> {
  await withDeadline(
    d.transaction(async (tx) => {
      const [run] = await tx.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).for("update").limit(1);
      if (!run) return;
      const ctx = ((run.contextJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
      const cu = docDaBaoQuet(ctx[KET_CUC_KHONG_RO_DA_BAO_QUET_CTX_KEY]);
      const goc: DauQuet = cu === "loi" ? { chot: null, dau: {} } : cu;
      const at = new Date().toISOString();
      const moi = { chot: goc.chot ?? (them.chot ? { stepId: them.chot, at } : null), dau: { ...goc.dau, ...Object.fromEntries((them.dau ?? []).filter((k) => !(k in goc.dau)).map((k) => [k, at] as const)) } };
      await tx.update(orchestrationRuns).set({ contextJson: { ...ctx, [KET_CUC_KHONG_RO_DA_BAO_QUET_CTX_KEY]: moi } }).where(eq(orchestrationRuns.id, runId));
    }),
    STOP_DB_STEP_DEADLINE_MS,
    `FOE run ${runId} DA_BAO_QUET`,
  ).catch((err: unknown) => console.error(`[FOE] run ${runId}: the sweep's mark (DA_BAO_QUET) not written: ${(err as Error)?.message ?? err}`));
}

/** T8 lượt sửa 1 — what this process stored already: a lost mark write, or an unreadable one, raises once per process, not at every round */
const quetDaBenTrongProcess = new Set<string>();
/** Tests only: a restart forgets this process's memory (the durable mark DA_BAO_QUET must carry the rest). */
export function __quenBoNhoQuetChoTest(): void {
  quetDaBenTrongProcess.clear();
  daCanhBaoBoQua.clear();
  daCanhBaoCoMotProcess = false;
}
/** T8 lượt sửa 3 (CHAN-5) — the central runs this process already named as skipped, by mode: a run is named once per mode (a mode that changes is news), not at every sweep */
const daCanhBaoBoQua = new Set<string>();

/**
 * A2(n) T8 (plan point 4, C-4, B) — THE sweep of the durable-URGENT obligation. A run whose URGENT never became durable and that no end will ever reach (an edge node dead for good: no record again, no
 * segment end; a held run whose URGENT failed) is told again, until it is stored:
 *   • chosen by its ROWS and its context: the latch (the context's key, else chotTuHang of the rows and of central's resume state) told neither by the walker (DA_BAO) nor by the sweep (DA_BAO_QUET);
 *     each marked row (stopKhongXacNhan) whose URGENT the sweep has not stored (DA_BAO_QUET, durable: no 24-hour dedup window behind it). Status held / awaiting_confirm / aborted; running /
 *     compensating / queued once nothing of the run changed for `tuoiMs`: the run row, its rows, and for a run given to an edge node its claim's progress (the node's heartbeat);
 *   • lượt sửa 1 (CHAN-3) — a run a CENTRAL walker walks (no edge assignment) is skipped while `walkerSong` says its walker is alive. `walkerSong` is required (the engine's liveRuns: injected, no import
 *     cycle; T12 wires foeEngine.coWalkerSongTrongProcess). It sees ONE process: when cheDoProcessEngine says more, or cannot tell, a central `running` / `compensating` run is not told (logged).
 *     A run given to an edge node has no central walker: the age of its reports decides, whatever the mode (a dead node's run stays `running` at central);
 *   • the SAME URGENTs, under the SAME keys, as the end gate: run_end `…:<run>:<latch step>:-:chot` (canhBaoKetCucKhongRo), the mark's of the report path (baoKhongXacNhan);
 *   • it ONLY raises: no walk, no engine, no command, no status. Its mark is written merged, under the row lock, once a raise is stored.
 * Another call's raise counts only when it said stored (Q-7). Confirmation (XAC_NHAN, decision 3) is T9's. Placement: plan point 4 puts it in foeKetCucKhongRo.ts. It lives here (dieu-phoi 11/11): it raises
 * through baoKhongXacNhan and reads benKhongXacNhanCho, both of this module, which imports foeKetCucKhongRo already (a cycle otherwise). Nothing calls it at boot or on a period yet: T12 does. Never throws.
 */
export async function quetUrgentChuaBen(o: { walkerSong: (runId: number) => boolean; cheDo?: CheDoProcessEngine; gioiHan?: number; bayGio?: number; tuoiMs?: number }): Promise<{ quet: number; ben: number; chuaBen: number }> {
  const out = { quet: 0, ben: 0, chuaBen: 0 };
  let d: RunDb | null = null;
  try {
    d = await getDb();
  } catch {
    return out;
  }
  if (!d) return out;
  canhBaoCoMotProcess();
  const x: QuetMot = { bayGio: o.bayGio ?? Date.now(), tuoi: o.tuoiMs ?? QUET_URGENT_TUOI_TOI_THIEU_MS, walkerSong: o.walkerSong, cheDo: o.cheDo ?? cheDoProcessEngine(), boQuaNhieuProcess: [] };
  const gioiHan = o.gioiHan ?? 100;
  let runs: OrchestrationRun[];
  try {
    runs = (await d.select().from(orchestrationRuns).where(inArray(orchestrationRuns.status, [...QUET_URGENT_STATUS] as never))) as OrchestrationRun[];
  } catch (err) {
    console.error(`[FOE] URGENT obligation sweep: the runs could not be read: ${(err as Error)?.message ?? err}`);
    return out;
  }
  for (const run of [...runs].sort((a, b) => a.id - b.id)) {
    if (out.quet >= gioiHan) break;
    let ben: boolean | null;
    try {
      ben = await quetMotRun(d, run, x);
    } catch (err) {
      console.error(`[FOE] run ${run.id}: URGENT obligation sweep failed: ${(err as Error)?.message ?? err}`);
      ben = false;
    }
    if (ben === null) continue;
    out.quet += 1;
    if (ben) out.ben += 1;
    else out.chuaBen += 1;
  }
  const moi = x.boQuaNhieuProcess.filter((id) => !daCanhBaoBoQua.has(`${x.cheDo}:${id}`));
  for (const id of moi) daCanhBaoBoQua.add(`${x.cheDo}:${id}`);
  if (daCanhBaoBoQua.size > 50_000) daCanhBaoBoQua.clear();
  if (moi.length) console.warn(`[FOE] URGENT obligation sweep: the central engine may run in more than one process (${x.cheDo}): central run(s) ${moi.join(", ")} (running / compensating) not told, a walker may be alive elsewhere`);
  return out;
}

interface QuetMot {
  bayGio: number;
  tuoi: number;
  walkerSong: (runId: number) => boolean;
  cheDo: CheDoProcessEngine;
  boQuaNhieuProcess: number[];
}

/** One run of the sweep: null ⇔ nothing owed (or too young, or its central walker alive); else whether everything owed is durable now. */
async function quetMotRun(d: RunDb, run: OrchestrationRun, x: QuetMot): Promise<boolean | null> {
  const ctx = ((run.contextJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const hang = ((await d.select().from(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, run.id))) as Array<HangKetThuc & { startedAt?: unknown; finishedAt?: unknown; createdAt?: unknown }>).filter((r) => !r.stepId.startsWith(ABORT_ROW_PREFIX));
  const daBaoQuet = docDaBaoQuet(ctx[KET_CUC_KHONG_RO_DA_BAO_QUET_CTX_KEY]);
  if (daBaoQuet === "loi") console.warn(`[FOE] run ${run.id}: the sweep's mark (DA_BAO_QUET) could not be read: what it may have stored is raised again (once in this process)`);
  const dq: DauQuet = daBaoQuet === "loi" ? { chot: null, dau: {} } : daBaoQuet;
  const tuCtx = ctx[KET_CUC_KHONG_RO_CHOT_CTX_KEY] as { stepId?: unknown; ma?: unknown } | null | undefined;
  const tuHang = chotTuHang(hang, ctx[RESUME_STATE_CTX_KEY] as Parameters<typeof chotTuHang>[1]);
  const chot = tuCtx?.stepId != null ? { stepId: String(tuCtx.stepId), ma: maKetCucKhongRoCua(typeof tuCtx.ma === "string" ? tuCtx.ma : null) } : tuHang ? { stepId: tuHang.stepId, ma: tuHang.ma } : null;
  const khoaChot = chot ? `${run.id}:${chot.stepId}:chot` : null;
  // T9 (decision 3, census of the latch's readers) — a latch every unknown of which a confirmed STOP covers owes no run_end URGENT. lượt sửa 2 (P-2, dieu-phoi 13/11) — read as the gate reads it: with the
  // definition (only when a confirmation is there to read); the definition unread ⇒ raised (the safe side)
  let noChot = chot !== null && ctx[KET_CUC_KHONG_RO_DA_BAO_CTX_KEY] == null && dq.chot === null && !quetDaBenTrongProcess.has(khoaChot as string);
  const coXacNhan = noChot && chot !== null && xacNhanTu(hang, ctx).size > 0;
  const dau = hang
    .filter((r) => dauKhongXacNhan(r.resultJson) !== null)
    .map((r) => ({ r, dang: dauKhongXacNhan(r.resultJson) as DangKhongXacNhan, claimSeq: claimCuaHang(r) }))
    .map((m) => ({ ...m, khoa: khoaKhongXacNhan(run.id, m.r.stepId, m.dang, m.claimSeq) }))
    .filter((m) => !(m.khoa in dq.dau) && !quetDaBenTrongProcess.has(m.khoa));
  if (!noChot && dau.length === 0) return null;
  // CHAN-3 — whose walker: a run given to an edge node has none at central; its claim's progress is its heartbeat
  // lượt sửa 2 (CHAN-4) — the shared read: 0370 not applied (42P01 / 42703) ⇒ no edge assignment, the run is central; any other error throws to the per-run catch (this run only)
  const claim = (await readEdgeAssignment(d, run.id)) as { lastProgressAt?: unknown; claimedAt?: unknown } | null;
  if (!claim && QUET_URGENT_WALKER_TRUNG_TAM.has(run.status)) {
    if (x.walkerSong(run.id)) return null;
    if (x.cheDo !== "mot") {
      x.boQuaNhieuProcess.push(run.id);
      return null;
    }
  }
  if (QUET_URGENT_SONG.has(run.status)) {
    const moc = mocMoiNhat(run, hang, claim ?? null);
    if (Number.isFinite(moc) && x.bayGio - moc < x.tuoi) return null;
  }
  const label = `FOE run ${run.id} URGENT obligation sweep`;
  const owner = run.startedBy ?? null;
  // the definition names the owner of a marked compensation in its key, as the report path does; unread: the step itself. T9 lượt sửa 3 (RA2-3, dieu-phoi 13/11) — ONE read, only for a run not skipped, under
  // its own bound (D), inside this run's 5·D (N-3): what is left of it bounds the raise. Past the bound or any error ⇒ not known ⇒ the safe side: XAC_NHAN cannot clear (its own rule), the run is raised.
  // A read that hangs ends this run's read, never the pass
  const t0 = Date.now();
  let def: Pick<WorkflowDefinition, "steps"> | null = null;
  try {
    def = await withDeadline(
      (async () => {
        const [wf] = await d.select().from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, run.workflowId)).limit(1);
        return (wf?.definitionJson as Pick<WorkflowDefinition, "steps"> | null | undefined) ?? null;
      })(),
      STOP_DB_STEP_DEADLINE_MS,
      `FOE run ${run.id} URGENT obligation sweep: its definition`,
    );
  } catch {
    def = null;
  }
  const han = Math.max(STOP_DB_STEP_DEADLINE_MS, 5 * STOP_DB_STEP_DEADLINE_MS - (Date.now() - t0));
  // XAC_NHAN (P-2, above): ONE reading (xacNhanHetChot), with the definition read here; with no definition it never clears (its own rule), so the sweep raises
  if (coXacNhan && chot) {
    const lenhDn = def ? new Set(allStepsOf(def.steps as WorkflowStep[]).filter((s) => s.type === "command").map((s) => s.id)) : null;
    if (xacNhanHetChot({ chot, rows: hang, ctx, ...(def && lenhDn ? { laLenh: (id: string) => lenhDn.has(id), lenhTien: lenhTienCua(def.steps as WorkflowStep[]) } : {}) })) {
      noChot = false;
      // R-5 (2) — a confirmation of a node's rows (no central context mark): said with its source
      const daTrungTam = xacNhanTu(null, ctx);
      const tuNut = [...xacNhanTu(hang, null)].filter((b) => !daTrungTam.has(b));
      if (tuNut.length) void ghiNenXacNhanNut(run.id, tuNut, "quet").catch(() => undefined);
      if (dau.length === 0) return null;
    }
  }
  let ben = true;
  const daBen: { chot?: string; dau: string[] } = { dau: [] };
  if (noChot && chot) {
    const b = await withDeadline(canhBaoKetCucKhongRo({ loai: "runEnd", runId: run.id, stepId: chot.stepId, compId: KHONG_CO_BU_TRU, error: chot.ma, lan: "chot", owner }), han, label).catch(() => false);
    if (b) {
      daBen.chot = chot.stepId;
      quetDaBenTrongProcess.add(khoaChot as string);
    } else ben = false;
  }
  for (const m of dau) {
    // Q-7 — another call's raise is proof only when it said stored
    const cho = benKhongXacNhanCho.get(m.khoa);
    const b = (cho && (await motBen([cho], han, label))) || (await motBen([baoKhongXacNhan({ runId: run.id, def, stepId: m.r.stepId, dang: m.dang, claimSeq: m.claimSeq, owner })], han, label));
    if (b) {
      daBen.dau.push(m.khoa);
      quetDaBenTrongProcess.add(m.khoa);
    } else ben = false;
  }
  if (quetDaBenTrongProcess.size > 50_000) quetDaBenTrongProcess.clear();
  if (daBen.chot || daBen.dau.length) await ghiDaBaoQuet(d, run.id, daBen);
  return ben;
}

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

/**
 * dieu-phoi 08/11 T6e-K2 — an edge's forwardNotSent of a stop-typed step that CENTRAL's own verifier takes for a pinned STOP, or cannot verify: the edge package compares the raw
 * write (EP-KIEU-EDGE, with the edge dispatcher), central the coerced one, so a STOP central would send may be named as forward work. Its URGENT then says it is a STOP whose pin the sweep
 * could not verify (the T6e-K1 words), never "Command … NOT handed". A read-only answer of central (verifyStopsForAbort: bounded, read failure ⇒ unsure); past the bound or on any
 * error ⇒ false (the words stay as they were). Nothing on the wire changes: the edge never says it.
 */
/**
 * A2(n) T9 lượt sửa 1 (dieu-phoi 11/11: the edge's words are central's, branch (1)) — central's reading of an edge's report for its words, by the precedent of stopKhongXacMinhEdge: forwardNotSent as that;
 * stopNotSent of the step the report names (its STOP: compId, or stepId): no STOP by the definition (isStopCandidate) ⇒ khongStop; stop-typed and central's verifier does not verify it as a pinned STOP (unsure
 * or not pinned) ⇒ chuaXacMinh. Read-only, bounded. T9 lượt sửa 2 (RA-EE, dieu-phoi 13/11: fail-closed) — no definition, any error or past the bound ⇒ { chuaXacMinh: true } (central cannot say it is a
 * pinned STOP, so the words promise nothing plainly). Nothing on the wire changes.
 */
export async function cachEdgeTrungTam(runId: number, def: WorkflowDefinition | null | undefined, x: { loai: string; stepId: string; compId?: string }): Promise<CachEdgeTrungTam> {
  if (x.loai === "forwardNotSent") return { stopKhongXacMinh: await stopKhongXacMinhEdge(runId, def, x) };
  if (x.loai !== "stopNotSent") return {};
  if (!def) return { chuaXacMinh: true }; // lượt sửa 2 (RA-EE) — no definition to read: nothing verified
  try {
    return await withDeadline(
      (async (): Promise<CachEdgeTrungTam> => {
        const id = x.compId && x.compId !== KHONG_CO_BU_TRU ? x.compId : x.stepId;
        const s = allStepsOf(def.steps).find((y) => y.id === id);
        if (!s || s.type !== "command") return {};
        const map = await loadMachines([...new Set(allStepsOf(def.steps).filter((y) => y.type === "command").map((y) => (y as { machineId: number }).machineId))]);
        if (!(await isStopCandidate(s, map))) return { khongStop: true };
        const v = await verifyStopsForAbort(runId, { steps: [s] } as WorkflowDefinition, map);
        return v.ids.has(s.id) ? {} : { chuaXacMinh: true };
      })(),
      2 * STOP_DB_STEP_DEADLINE_MS,
      `FOE run ${runId} step ${x.stepId} STOP words`,
    );
  } catch {
    // lượt sửa 2 (RA-EE, dieu-phoi 13/11: fail-closed) — central could not read: it cannot say the STOP is pinned, so the words promise nothing (chuaXacMinh), never the plain "Abort sends it again"
    return { chuaXacMinh: true };
  }
}
export async function stopKhongXacMinhEdge(runId: number, def: WorkflowDefinition | null | undefined, x: { loai: string; stepId: string }): Promise<boolean> {
  if (x.loai !== "forwardNotSent" || !def) return false;
  try {
    return await withDeadline(
      (async () => {
        const s = allStepsOf(def.steps).find((y) => y.id === x.stepId);
        if (!s || s.type !== "command") return false;
        const map = await loadMachines([...new Set(allStepsOf(def.steps).filter((y) => y.type === "command").map((y) => (y as { machineId: number }).machineId))]);
        if (!(await laStopTheoBuoc(s, map))) return false;
        const v = await verifyStopsForAbort(runId, { steps: [s] } as WorkflowDefinition, map);
        return v.ids.has(s.id) || v.unsure.has(s.id);
      })(),
      2 * STOP_DB_STEP_DEADLINE_MS,
      `FOE run ${runId} step ${x.stepId} STOP words`,
    );
  } catch {
    return false;
  }
}

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
/**
 * The lifetime of an engine authorisation row (ai_pending_actions."expiresAt" = creation + this). R1b-2b-2a A2(m2): named so the
 * boot re-send of an interrupted STOP compensation can never be allowed past the original STOP's own authorisation (foeBuTruBiNgat).
 */
export const FOE_ACTION_TTL_MS = 3_600_000;

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
  /**
   * R1b-2b-2a A2(m) — `hangMoi`: the command is a PINNED STOP (the dispatcher's own predicate, `phanLoaiStopGhimChoFoe`): the row is
   * ALWAYS inserted under this fresh per-dispatch id (`stopActionIdMoi`), never an existing row reused — a spent row of an earlier
   * dispatch (a crash after the reservation, a resume by another user, a row past its hour) can never refuse the STOP. Its content is
   * exactly what any STOP row gets (tool, binding hash, gate approval if any, owner = approver or walker), PLUS the mark
   * hangMoiStopGhim (AMENDMENT 2): the reservation refuses a marked row unless the dispatcher itself classifies the command as a pinned STOP.
   * Without it (every other
   * command): the deterministic id, an existing row reused whatever its status (a spent row stays spent: one approval = one write).
   */
  opts: { hangMoi?: { actionId: string } } = {},
): Promise<string | null> {
  try {
    const d = await getDb();
    if (!d) return null;
    const hangMoi = opts.hangMoi?.actionId ?? null;
    const actionId = hangMoi ?? orchestrationActionId(idempotencyKey);
    if (!hangMoi) {
      const [existing] = await d
        .select()
        .from(aiPendingActions)
        .where(eq(aiPendingActions.id, actionId))
        .limit(1);
      if (existing) return actionId; // resume/retry → tái dùng bản ghi cũ
      // A2(m) upgrade compatibility — a run mid-flight across the upgrade may hold its row under the OLD (truncated) id of a long key:
      // that row is THE authorisation of this key (pending or spent) ⇒ used, never shadowed by a fresh confirmed row (a second write).
      // REMOVAL NOTE (fix round 1): engine rows expire after 1 h and a resumed run past that is refused anyway (expired) — this lookup
      // and orchestrationActionIdCu can be removed one release after A2(m) (no row under a legacy id can still authorise anything then).
      const cu = orchestrationActionIdCu(idempotencyKey);
      if (cu !== actionId) {
        const [legacy] = await d.select().from(aiPendingActions).where(eq(aiPendingActions.id, cu)).limit(1);
        if (legacy) return cu;
      }
    }
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
    // A2(m) AMENDMENT 2 — the fresh row of a pinned STOP is MARKED: the reservation refuses it unless the dispatcher itself classifies the
    // command as a pinned STOP (never a grant — a non-pinned command can never consume it, whatever approval it carries)
    if (hangMoi && previewJson) previewJson = withHangMoiStopGhim(previewJson);
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
      expiresAt: new Date(Date.now() + FOE_ACTION_TTL_MS),
    });
    return actionId;
  } catch {
    // fail-safe: không tạo được ⇒ cổng dispatcher sẽ fail-closed (an toàn).
    return null;
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
  attempt: number,
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
  // R1b-2b-2a A2(m) — an OT command that is a PINNED STOP (the dispatcher's own predicate, asked through `phanLoaiStopGhimChoFoe`; a STOP's
  // read bounded by D) gets a FRESH authorisation row for THIS dispatch: a new id from (key, attempt, nonce), never an existing row —
  // so a resume (same attempt key), a resume by another user, a row past its hour or an attempt whose row an earlier dispatch spent
  // (crash after the reservation) never refuses the STOP. The T6d re-key inside dispatch() keeps this actionId, so a fresh row per
  // dispatch is all it needs (no status exemption in the reservation: one approval = one write). Every other command: unchanged.
  const pl = !isRobotKind(cap.adapterKind) && cmd.adapterId != null && cmd.hitl != null ? await laStopGhimChoHangFoe(rc, step, cmd, isStop) : { ghim: false, khongDoc: false };
  // A2(n) T5 (F4, decision 2) — unreadable is not "not pinned": a stop-typed step on a latched run takes the SAME marked fresh row, which the reservation lets ONLY a pinned STOP of the dispatcher consume
  const chuaDoc = x.daChot === true && isStop && !pl.ghim && pl.khongDoc;
  const stopGhim = pl.ghim || chuaDoc;
  if (stopGhim && cmd.hitl) cmd.hitl.actionId = stopActionIdMoi(idempotencyKey, attempt, randomUUID());
  if (!(isRobotKind(cap.adapterKind) && (cmd.robotId == null || isStop))) {
    // the id the row was found / written under, applied only when known in time (a STOP's write is bounded by D: a late answer
    // never rewrites a command already on its way)
    let idDaDung: string | null = null;
    await stopBoundedWrite(isStop, rc.runId, step.id, "authorisation row", async () => {
      idDaDung = await ensureOrchestrationAction(rc.user, idempotencyKey, step, args, cmd, approval ?? undefined, stopGhim && cmd.hitl ? { hangMoi: { actionId: cmd.hitl.actionId } } : {});
    });
    // A2(m) compatibility — a row of a run mid-flight across the upgrade found under the OLD id of a long key is the one this command uses
    if (idDaDung && cmd.hitl && !stopGhim) cmd.hitl.actionId = idDaDung;
  }
  // C-3 — no adapter: no dispatcher can be asked, and "no adapter" is no reading of its pins
  const khongAdapter = isStop && !isRobotKind(cap.adapterKind) && cmd.adapterId == null;
  return {
    ok: true,
    cmd,
    args,
    approval,
    ...(pl.ghim ? { stopGhim: true as const } : {}),
    ...(chuaDoc ? { stopChuaDocGhim: true as const } : {}),
    ...(pl.khongDoc || khongAdapter ? { ghimKhongDoc: true as const } : {}),
    ...(khongAdapter && x.daChot === true ? { chuaRaStop: true as const } : {}),
  };
}

/**
 * R1b-2b-2a A2(m) — is the command an OT step is about to send a PINNED STOP? The dispatcher's OWN predicate (gate (1)'s function:
 * `phanLoaiStopGhimChoFoe` → `laStopGhimTaiCong1` → `phanLoaiStopGhimRangBuoc`; never the key-purpose `laStopChoKhoa`, which counts
 * content stops). A command that is not stop-typed is answered without a read. On a STOP's path (`stop`) the read is bounded by D (L-7).
 * The pins could not be read (error, no DB, deadline) ⇒ NOT pinned — the old path (fail-closed) — AND, for a stop-typed step, ONE
 * URGENT alert per run / step / adapter (the critical-stop alert's own durable dedup): the STOP may not be re-sendable after a crash.
 * This answer only chooses the authorisation ROW; the dispatcher re-decides at gate (1) and at the reservation (its verdict wins).
 */
async function laStopGhimChoHangFoe(rc: RunStoreContext, step: Extract<WorkflowStep, { type: "command" }>, cmd: EquipmentCommand, stop: boolean): Promise<{ ghim: boolean; khongDoc: boolean }> {
  const adapterId = cmd.adapterId as number;
  const hoi = (async (): Promise<{ pinnedStop: boolean; loiDocGhim: string | null }> => {
    const d = await getDb();
    if (!d) return { pinnedStop: false, loiDocGhim: "database unavailable" };
    const { phanLoaiStopGhimChoFoe } = await napDispatcher();
    return phanLoaiStopGhimChoFoe(d, { adapterId, commandType: cmd.name, writes: cmd.writes ?? [] });
  })();
  let kq: { pinnedStop: boolean; loiDocGhim: string | null };
  try {
    kq = stop ? await withDeadline(hoi, STOP_DB_STEP_DEADLINE_MS, `FOE stop step ${step.id} pin check`) : await hoi;
  } catch (err) {
    kq = { pinnedStop: false, loiDocGhim: String((err as Error)?.message ?? err) };
  }
  if (kq.loiDocGhim !== null && stop) canhBaoGhimStopKhongXacMinh(rc, step.id, adapterId, kq.loiDocGhim);
  return { ghim: kq.pinnedStop, khongDoc: kq.loiDocGhim !== null };
}

/**
 * R1b-2b-2a A2(n) (n1, R-2) — central: is the compensation `comp` a STOP that goes out by itself? A robot job: the robot dispatcher's own
 * non-motion rule (isRobotStopStep → stopJob.isStopJob, the ONE classifier). OT: the SAME reads as A2(m2)'s b1 (xetGuiLaiBuTruBiNgat): the
 * adapter it resolves to (withResolvedAdapter — none / several ⇒ false), the command it would send, then the dispatcher's own predicate
 * `phanLoaiStopGhimChoFoe` (gate (1)'s function; never laStopChoKhoa). The pins could not be read, the DB is unavailable, anything throws,
 * or the bound (2·D: the adapter lookup + the pin read, on a STOP's path) passes ⇒ false: the compensation is HELD (fail-safe). The dispatch
 * re-decides with its own reads (execCommand: an OT compensation chosen here is handed over only if the central store authorises it as a
 * pinned STOP for THAT dispatch).
 * A2(n) T5 (C-2, C-3) — an answer that could not be read is "chuaDoc", for a stop-typed step only: the route, never "not pinned"; a non-STOP stays "khong" whatever a read says.
 */
export async function buTruLaStopGhimTrungTam(rc: RunStoreContext, comp: WorkflowStep): Promise<LaStop> {
  if (comp.type !== "command") return "khong";
  const c = commandOf(comp, rc.machineById);
  if (!c) return (await laStopTheoBuoc(comp, rc.machineById)) ? "chuaDoc" : "khong"; // H1 — nothing resolves it, its own name says what it is
  if (isRobotKind(c.cap.adapterKind)) return isRobotStopStep(c) ? "stop" : "khong";
  const chuaDoc: LaStop = (await isStopCandidate(comp, rc.machineById)) ? "chuaDoc" : "khong";
  try {
    return await withDeadline(
      (async () => {
        const args = await withResolvedAdapter(c.cap.adapterKind, comp.machineId, comp.args ?? {});
        const cmd = buildEquipmentCommand(c.descriptor, c.cap, comp.machineId, args, `run${rc.runId}-${comp.id}-a1`, rc.user);
        if (cmd.adapterId == null) return chuaDoc;
        const d = await getDb();
        if (!d) return chuaDoc;
        const { phanLoaiStopGhimChoFoe } = await napDispatcher();
        const g = await phanLoaiStopGhimChoFoe(d, { adapterId: cmd.adapterId, commandType: cmd.name, writes: cmd.writes ?? [] });
        if (g.loiDocGhim !== null) return chuaDoc;
        return g.pinnedStop === true ? ("stop" as const) : ("khong" as const);
      })(),
      2 * STOP_DB_STEP_DEADLINE_MS,
      `FOE run ${rc.runId} compensation ${comp.id} pin check`,
    );
  } catch (err) {
    console.warn(`[FOE] run ${rc.runId} compensation ${comp.id}: pinned-STOP check not answered — its dispatcher decides: ${(err as Error)?.message ?? err}`);
    return chuaDoc;
  }
}

/** A2(m) AMENDMENT 1 (M11) — the URGENT alert of a STOP step whose pins could not be verified (never throws, never awaited). */
function canhBaoGhimStopKhongXacMinh(rc: RunStoreContext, stepId: string, adapterId: number, loi: string): void {
  const recipients = [...new Set([rc.runOwner ?? 0, rc.user.id || 0])].filter((u) => Number.isSafeInteger(u) && u > 0);
  const message = `STOP pin could not be verified — the STOP may not be re-sendable (run ${rc.runId}, step "${stepId}", adapter ${adapterId}): ${loi.slice(0, 200)}. Its dispatcher decides with its own read: this says nothing of whether it went out, the run's step does. After a crash or a resume it may be refused. Check the adapter's stop pins, and use the machine's direct STOP / E-STOP if needed.`;
  void napCanhBao()
    .then(({ raiseCriticalStopAlert }) =>
      raiseCriticalStopAlert({
        kind: "foe_stop_pin_unverified",
        title: `STOP pin could not be verified — run ${rc.runId}, step ${stepId}`,
        message,
        recipients,
        dedupKey: `foe_stop_pin_unverified:${rc.runId}:${stepId}:${adapterId}`,
        source: "ot",
        entityType: "orchestration_run",
        entityId: rc.runId,
        khuTrungBenVung: {},
      }),
    )
    .catch(() => undefined);
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
const abortAuditModule = napMotLan(() => import("../../auditTrailService"));

/** The console line of an abort-sweep decision (both stores): always, synchronous. */
export function logAbortStop(user: RunStoreUser, runId: number, operation: AbortAuditOp, metadata: Record<string, unknown>): void {
  if (operation === "notSentRunLatched") {
    console.warn(`[FOE] run ${runId}: command not sent, run latched ${JSON.stringify(metadata)}`);
    return;
  }
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
export function readRunStepRows(runId: number) {
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
    hang: rows,
    chuaRa: stopChuaRaTuHang(rows, rc.context),
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
    hang: rows,
    chuaRa: stopChuaRaTuHang(rows, context),
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
      // T7b-1d lượt sửa 1 (H29) — this path has its bound too; what it would have answered is known with nothing read
      return await withDeadline(
        (async () => (await makeStopVerifier(null, [def], map)).verified(def, map))(),
        STOP_DB_STEP_DEADLINE_MS,
        `FOE abort run ${runId} stop verification, no database`,
      );
    } catch (loi) {
      console.warn(`[FOE] abort of run ${runId}: stop verification with no database: ${(loi as Error)?.message ?? loi}`);
      const ids = new Set<string>();
      const unsure = new Set<string>();
      for (const s of allStepsOf(def.steps)) {
        const c = commandOf(s, map);
        if (!c) {
          if (s.type === "command") unsure.add(s.id);
        } else if (isRobotKind(c.cap.adapterKind)) {
          if (isRobotStopStep(c)) ids.add(s.id);
        } else if (isStopCommandType(c.descriptor.name)) unsure.add(s.id);
      }
      return { ids, failed: true, unsure };
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
  authorizeAbortStop(runId: number, user: RunStoreUser, step: Extract<WorkflowStep, { type: "command" }>, idempotencyKey: string, args: Record<string, unknown>, cmd: EquipmentCommand, opts: { danhDau?: boolean } = {}): Promise<void> {
    // the abort key carries a per-sweep nonce (abortStopKey, ≤ 60 characters): a fresh row per sweep already
    // A2(n) T7b-1 — the marked route: the same fresh row the key already gives (its per-sweep nonce), MARKED: inserted, never an existing row reused. T7b-1c — a key used before (coTheDaRa): a fresh id in cmd.hitl, the same way
    const hangMoi = opts.danhDau === true && cmd.hitl ? { actionId: cmd.hitl.actionId } : null;
    return stopBoundedWrite(true, runId, step.id, "abort authorisation row", async () => {
      await ensureOrchestrationAction(user, idempotencyKey, step, args, cmd, undefined, hangMoi ? { hangMoi } : {});
    });
  },
  async sweepSource(x: { live?: RunStoreContext | null; run?: OrchestrationRun; hasLiveDriver?: (runId: number) => boolean }): Promise<AbortSweepSource | null> {
    return x.live ? liveSweepSource(x.live) : x.run ? storedSweepSource(x.run, x.hasLiveDriver ?? (() => false)) : null;
  },
  verifyStops: verifyStopsForAbort,
  auditAbort: auditAbortStop,
  buTruLaStopGhim: buTruLaStopGhimTrungTam, // R1b-2b-2a A2(n)
  ketCucKhongRo(rc: RunStoreContext, a: KetCucKhongRoBaoCao): Promise<boolean> {
    return canhBaoKetCucKhongRo({ ...a, runId: rc.runId, owner: rc.runOwner });
  },
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

/**
 * R1b-2b-2a A2(n) — the marker of an edge segment held for an unknown outcome: the step / compensation named by the walker's held text
 * (foeKetCucKhongRo.loiGiuBuTruKhongRo), "?" when they cannot be read (still marked: fail-closed).
 */
function dauKhongRoTuEdge(end: Pick<EdgeSegmentEndApply, "error" | "claimSeq">, at: string, bao: readonly BaoCaoKhongRoEdge[]): DauKetCucKhongRo {
  const m = /(?:command|step) "([^"]{1,128})" (?:outcome unknown|failed; another command's outcome is unknown) — machine state unknown — compensation "([^"]{1,128})"/.exec(end.error ?? "");
  const ds = bao.filter((x) => x.loai === "held").map((x) => ({ stepId: x.stepId, compId: x.compId }));
  const dau = { stepId: m?.[1] ?? ds[0]?.stepId ?? "?", compId: m?.[2] ?? ds[0]?.compId ?? "?" };
  return { ...dau, ma: maKetCucKhongRoCua(end.error), at, lan: `claim${end.claimSeq}`, ds: ds.length ? ds : [dau] };
}

/** A step and the forward steps inside it (never a compensation). Pure. */
export function buocTienCua(step: WorkflowStep): WorkflowStep[] {
  const n = step as { steps?: WorkflowStep[]; then?: WorkflowStep[]; else?: WorkflowStep[] };
  return [step, ...[...(n.steps ?? []), ...(n.then ?? []), ...(n.else ?? [])].flatMap(buocTienCua)];
}

/**
 * R1b-2b-2a A2(n) (I-A) — the steps of a compensation-only walk: the approved steps and the containers on the way to them. Pure.
 * The body of an approved step's compensation is on the way too: a gate inside it is walked and ASKED (G-1), its commands are what the person approved.
 */
export function duongToiBuoc(steps: readonly WorkflowStep[], ids: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  const di = (s: WorkflowStep): boolean => {
    const n = s as { steps?: WorkflowStep[]; then?: WorkflowStep[]; else?: WorkflowStep[] };
    // every child is visited (no short-circuit): each may lead to its own approved step
    const coCon = [...(n.steps ?? []), ...(n.then ?? []), ...(n.else ?? [])].map(di).some(Boolean);
    if (ids.has(s.id) && s.compensation) for (const x of buocTienCua(s.compensation)) out.add(x.id);
    if (coCon || ids.has(s.id)) out.add(s.id);
    return coCon || ids.has(s.id);
  };
  steps.forEach(di);
  return out;
}

/** A2(n) (S-1, I-F) — the containers around a step, innermost first. Pure. */
export function toTienCua(steps: readonly WorkflowStep[], stepId: string): WorkflowStep[] {
  for (const s of steps) {
    const n = s as { steps?: WorkflowStep[]; then?: WorkflowStep[]; else?: WorkflowStep[] };
    const con = [...(n.steps ?? []), ...(n.then ?? []), ...(n.else ?? [])];
    if (con.some((x) => x.id === stepId)) return [s];
    const sau = toTienCua(con, stepId);
    if (sau.length > 0) return [...sau, s];
  }
  return [];
}

/** A2(n) (a) — a step inside a compensation and that compensation's owner, from the definition; null ⇔ a forward step. Pure. */
export function chuBuTruTrongDinhNghia(steps: WorkflowStep[], stepId: string): { step: WorkflowStep; comp: WorkflowStep } | null {
  for (const s of allStepsOf(steps)) {
    if (s.compensation && buocTienCua(s.compensation).some((x) => x.id === stepId)) return { step: s, comp: s.compensation };
  }
  return null;
}

/**
 * m-H — is this a report of the assigned definition: its step exists, paired with that step's own compensation or a step inside it (m-O) (or none);
 * (c) an in-flight report names any command of the definition. Pure.
 */
export function baoCaoHopLe(def: Pick<WorkflowDefinition, "steps">, x: Pick<BaoCaoKhongRoEdge, "stepId" | "compId"> & { loai?: BaoCaoKhongRoEdge["loai"] }): boolean {
  const tat = allStepsOf(def.steps);
  const s = tat.find((y) => y.id === x.stepId);
  if (s == null) return false;
  if (x.loai === "inFlight") return tat.some((y) => y.id === x.compId && y.type === "command");
  return x.compId === KHONG_CO_BU_TRU || (s.compensation != null && buocTienCua(s.compensation).some((y) => y.id === x.compId));
}

/**
 * R1b-2b-2a A2(n) (I-D, I-G) — what a crashed edge segment leaves for a person, from its rows and central's authorisation ledger: a pending compensation
 * of an unknown outcome (held) or an unknown step with no compensation of its own, whether it failed on a row or the node died while the command
 * was out (`outcomeUnknown`: authorised, maybe sent, no result — the likeliest crash). The same reports a live walker would have made, so a late
 * anomaly dedups with them. STOP steps are not unknown (they are sent again, L-7).
 */
export function baoCaoKhongRoTuHang(
  def: Pick<WorkflowDefinition, "steps">,
  rows: ReadonlyArray<{ stepId: string; status: string; resultJson?: unknown; error?: string | null }>,
  claimSeq: number,
  authorised: ReadonlySet<string> = new Set(),
  stops: ReadonlySet<string> = new Set(),
): BaoCaoKhongRoEdge[] {
  const { state } = edgeResumeStateOf(def, rows, authorised, [], stops);
  const out: BaoCaoKhongRoEdge[] = [];
  for (const s of allStepsOf(def.steps)) {
    const e = state[s.id];
    if (!e) continue;
    const laKhongRo = e.state === "outcomeUnknown" || e.khongRo === true;
    if (!laKhongRo) continue;
    const ma = maKetCucKhongRoCua(e.error);
    if ((e.state === "compensationHeld" || e.state === "outcomeUnknown") && s.compensation) out.push({ loai: "held", stepId: s.id, compId: s.compensation.id, ma, claimSeq });
    else if (!s.compensation && (e.state === "doneFailed" || e.state === "outcomeUnknown")) out.push({ loai: "noCompensation", stepId: s.id, compId: KHONG_CO_BU_TRU, ma, claimSeq });
  }
  return out;
}

/** R1b-2b-2a A2(n) (I-D) — the marker of those holds (the same shape as a walker's). */
export function dauKhongRoTuBaoCao(bao: readonly BaoCaoKhongRoEdge[], at: string): DauKetCucKhongRo | null {
  const ds = bao.filter((x) => x.loai === "held").map((x) => ({ stepId: x.stepId, compId: x.compId }));
  return ds.length ? { ...ds[0]!, ma: bao[0]!.ma, at, lan: `claim${bao[0]!.claimSeq}`, ds } : null;
}

/**
 * R1b-2b-2a A2(n) (I-4) — Continue on an outcome-unknown hold writes EXACTLY the held compensation(s), nothing forward: every other FAILED step
 * of the run (a failed sibling of a parallel, central or edge) becomes doneFailed, so the re-walk never runs it forward again. `state` wins (a
 * step already decided keeps its state); a STOP step keeps being re-sent (`stops`, L-7); compensations are never walked as forward steps. Pure.
 */
export function themBuocHongKhiTiepTuc(
  def: Pick<WorkflowDefinition, "steps">,
  rows: ReadonlyArray<{ stepId: string; status: string; error?: string | null; resultJson?: unknown }>,
  state: ResumeStateMap,
  stops: ReadonlySet<string> = new Set(),
): ResumeStateMap {
  const all = allStepsOf(def.steps);
  const comps = new Set(all.flatMap((s) => (s.compensation ? [s.compensation.id] : [])));
  const by = new Map(rows.map((r) => [r.stepId, r] as const));
  const out: ResumeStateMap = { ...state };
  for (const s of all) {
    const r = by.get(s.id);
    if (r?.status !== "failed" || out[s.id] || comps.has(s.id) || stops.has(s.id)) continue;
    // I-B — marked per leaf: a failed container that holds a failed STOP is walked, or the STOP inside it would never be re-sent
    // m-B — not only 'failed': a STOP whose final row was lost reads 'running'
    if (buocTienCua(s).some((x) => { const h = by.get(x.id); return x.id !== s.id && stops.has(x.id) && h != null && (h.status !== "completed" || dauKhongXacNhan(h.resultJson) !== null); })) continue;
    const error = r.error ?? "";
    out[s.id] = { state: "doneFailed", error, ...(loiLaKetCucKhongRo(error) ? { khongRo: true as const } : {}) };
  }
  return out;
}

/** foeEngine.OUTCOME_UNKNOWN_CTX_KEY (kept here as a literal: foeRunStore never imports the engine). */
const OUTCOME_UNKNOWN_KEY = "foeOutcomeUnknown";

/** The context mark of an edge-held run (central's own key: never taken from an edge context patch). */
export { EDGE_HELD_CTX_KEY };

/**
 * a2n round C — the end of a held run's error: what a person may do with it. Every hold keeps "Continue to resume it", except two. MIX ends failed without its forward STOP: it says
 * Abort, because Abort is the way out there. B5 fails the step, the run is latched by it and the walk's STOP pass sends the verified STOPs behind it (measured): it says so.
 */
function heldAdvice(error: string | undefined): string {
  // A2(n) T5 (N9, H1) — state C carries its own way out, Abort: "Continue to resume it" would be false
  if (error?.startsWith(`${FOE_STOP_NOT_SENT}:`)) return "";
  const mark = edgeHoldMarkOf(error);
  // data-raw-ok: the run's error (shown on the run), as the rest of it
  if (mark === EDGE_HOLD_CONSUME_OVERRUN) return " A compensation may already have run. For a STOP still due use Abort: Continue may end the run without sending it.";
  // data-raw-ok: as above
  if (mark === EDGE_HOLD_UNUSED_NOT_REPORTED) return " Central counts that step as possibly sent. Continue fails that step, sends nothing forward, and sends the verified STOPs behind it. Abort sends them too.";
  return " — nothing further was sent; Continue to resume it.";
}

/**
 * T9 lượt sửa 3b (mục 4) — the held error of an edge segment, as central shows it: the node's name and the hold's reason cut in the middle at their ceilings (rutGonGiua), the text after them as
 * given (the node's free text is cut at 500 by the caller; central's own words of state C are whole and short). ≤ 800 with every input, the advice after it included. Pure.
 */
export function chuGiuEdge(nodeCode: string, runId: number, reason: string, loi: string | undefined): string {
  return `Edge node ${rutGonGiua(nodeCode, TRAN_TEN_NUT)} held run ${runId} (${rutGonGiua(reason, TRAN_LY_DO)})${loi ? `: ${loi}` : ""}`;
}

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
export async function applyEdgeSegmentEnd(db: RunDb, runId: number, endTho: EdgeSegmentEndApply): Promise<EdgeSegmentEndResult> {
  // R1b-2b-2a A2(n) (I-5) — the segment's outcome-unknown reports ride on its end (never stored in the run's error): a full journal that lost
  // the anomaly does not lose the URGENT; the same event as the anomaly route ⇒ the same dedup key
  // M-2, m-H — a report counts only for THIS claim and for a step of the assigned definition paired with its own compensation
  const { error: loiEnd, bao: baoKhongRo } = tachBaoCaoKhongRoEdge(endTho.error, (x) => x.claimSeq === endTho.claimSeq && baoCaoHopLe(endTho.def, x));
  const end: EdgeSegmentEndApply = { ...endTho, error: loiEnd };
  const [run] = await db.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).for("update").limit(1);
  if (!run) return { ok: true, status: "missing", changed: false };
  // dieu-phoi 08/11 T6e-K2; A2(n) T7 — the URGENTs of what rode on this end: the end gate waits for them (bounded), they are raised whatever this end becomes
  const cachBao = baoKhongRo.map((x) => cachEdgeTrungTam(runId, endTho.def, x));
  const daCo = baoKhongRo.map((x, i) => (cachBao[i] as Promise<CachEdgeTrungTam>).then((k) => canhBaoTuBaoCaoEdge(runId, x, run.startedBy ?? null, k)).catch(() => false));
  /**
   * T9 lượt sửa 3 (RA2-2, dieu-phoi 13/11: branch (2)) — the run's error of a STOP the node leaves owed is CENTRAL's words, by the URGENT's rule: the node's report (its code), central's reading of it (the
   * same cachEdgeTrungTam the URGENT reads; none ⇒ not verified, fail-closed), the node's adapter. The node's own text (loiGiuChuaRa on the node, shown on its HMI) is never carried to central's view.
   */
  const cachNoEdge = async (stopId: string): Promise<{ khongStop?: boolean; chuaXacMinh?: boolean; adapterNut: true }> => {
    const i = baoKhongRo.findIndex((b) => b.loai === "stopNotSent" && (b.compId && b.compId !== KHONG_CO_BU_TRU ? b.compId : b.stepId) === stopId);
    const k: CachEdgeTrungTam = i >= 0 ? await (cachBao[i] as Promise<CachEdgeTrungTam>).catch(() => ({ chuaXacMinh: true })) : { chuaXacMinh: true };
    return { ...(k.khongStop ? { khongStop: true } : k.chuaXacMinh ? { chuaXacMinh: true } : {}), adapterNut: true };
  };
  /** T9 lượt sửa 3c (mục 1) — the node's report of a STOP: its code, or, a report with none, NOT_REPORTED (it may have reached the device: never "did NOT go out" on what central was not told) */
  const viBao = (stopId: string): ViChuaRa | undefined => {
    const b = baoKhongRo.find((x) => x.loai === "stopNotSent" && (x.compId && x.compId !== KHONG_CO_BU_TRU ? x.compId : x.stepId) === stopId);
    return b ? (b.vi ?? VI_KHONG_BAO) : undefined;
  };
  /**
   * T9 lượt sửa 3c (mục 1, dieu-phoi 14/11) — the STOP the run's error names is the node's REPORT's (structured: the whole id), never an id read from the node's text (its words cut long ids, 3b mục 4).
   * No report rode on this end: fail-closed, no id, "not confirmed out", never "did NOT go out". The node's text is only the sign that this is state C (its code prefix).
   */
  const loiNoTrungTam = async (): Promise<string> => {
    const b = baoKhongRo.find((x) => x.loai === "stopNotSent");
    if (!b) return `${FOE_STOP_NOT_SENT}: a STOP of this run stays owed and is not confirmed out: the edge node's report of it did not reach central, so it may have reached the device: ${CAU_TAY_MAY}.`;
    const id = b.compId && b.compId !== KHONG_CO_BU_TRU ? b.compId : b.stepId;
    return loiGiuChuaRa(id, viBao(id), await cachNoEdge(id));
  };
  const ctx = ((run.contextJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const stopped = run.status === "aborted" || ctx[FOE_REJECT_CLAIM_CTX_KEY] != null;
  if (stopped || (run.status !== "running" && run.status !== "compensating")) return { ok: true, status: run.status, changed: false };
  const LIVE: Array<OrchestrationRun["status"]> = ["running", "compensating"];
  const write = async (status: OrchestrationRun["status"], patch: Partial<OrchestrationRun>): Promise<EdgeSegmentEndResult> => {
    const ok = await setRunStatusUnlessAbortedOn(db, runId, status, patch, LIVE);
    return { ok: true, status: ok ? status : run.status, changed: ok };
  };
  // A2(n) (b, C-C) — a report on the end is the fact itself, whatever the rows lost (a full journal): the latch is central's from here on
  const chotTuBao = ctx[KET_CUC_KHONG_RO_CHOT_CTX_KEY] == null && baoKhongRo[0] ? { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: { stepId: baoKhongRo[0].stepId, ma: baoKhongRo[0].ma, at: new Date().toISOString() } } : {};
  const held = async (reason: string, error: string | undefined) => {
    const at = new Date().toISOString();
    // RA2-2 — state C: central's own words, whole (never cut: the safe act is their last clause; measured under 800 with the prefix, T9 lượt sửa 3b). T9 lượt sửa 3b (mục 3) — anything else is the
    // node's free text: central's 500 cut, as before lượt sửa 3 (edgeHeldMark.a2n: the mark at the head, the advice whole, the error under 800)
    const loiHien = error?.startsWith(`${FOE_STOP_NOT_SENT}:`) ? await loiNoTrungTam() : error?.slice(0, 500);
    // fix review 1 — a command the edge sent but could not record: never sent again (foeEngine reads the list on the re-walk)
    const unknown = edgeOutcomeUnknownOf(end);
    const prevUnknown = Array.isArray(ctx[OUTCOME_UNKNOWN_KEY]) ? (ctx[OUTCOME_UNKNOWN_KEY] as unknown[]).map(String) : [];
    return write("held", {
      currentStepId: null,
      // data-raw-ok: the run's error names the node and the reason code (shown on the run; the Studio keys on edgeHeld)
      error: `${chuGiuEdge(end.nodeCode, runId, reason, loiHien)}${heldAdvice(loiHien)}`,
      contextJson: {
        ...ctx,
        [EDGE_HELD_CTX_KEY]: reason,
        [`${EDGE_HELD_CTX_KEY}At`]: at,
        [`${EDGE_HELD_CTX_KEY}Node`]: end.nodeCode,
        interrupted: true,
        interruptedAt: at,
        interruptedFrom: run.status,
        interruptedBy: `edge held: ${reason}`,
        ...(unknown.length ? { [OUTCOME_UNKNOWN_KEY]: [...new Set([...prevUnknown, ...unknown])] } : {}),
        // R1b-2b-2a A2(n) — held because a command's outcome is unknown and the compensation due is not a pinned STOP: the SAME marker as
        // central's own walk (codes / ids only), so a Continue needs a person with machine-control rights and a reason (resumeRun)
        // A2(n) T5 — state C alone holds no compensation for a person: as central's own walk, no marker
        ...(reason === "outcomeUnknown" && (!error?.startsWith(`${FOE_STOP_NOT_SENT}:`) || baoKhongRo.some((x) => x.loai === "held")) ? { [KET_CUC_KHONG_RO_CTX_KEY]: dauKhongRoTuEdge(end, at, baoKhongRo) } : {}),
        ...chotTuBao,
      },
    });
  };
  /**
   * A2(n) T7 — THE end gate (quyetDinhKetThucAnh) for an end of this segment, central's, with what rode on it (C1: the same gate as central's own walk). A STOP owed on the rows, or no durable URGENT
   * for a latched run or a marked row: central holds the run itself (not an edge's hold: no EDGE_HELD mark), a Continue walks to the gate again, an Abort ends it. Else the terminal write, with
   * DA_BAO when this end made the URGENT durable. N-3 (T8): inside the batch's transaction, every wait of the gate together is bounded by 5·D (KET_DOAN_EDGE_TONG_MS), not 5·D each.
   */
  const congCuoi = async (): Promise<{ giu: EdgeSegmentEndResult } | { patch: Partial<OrchestrationRun> }> => {
    const hang = await db.select().from(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, runId));
    const tuBao = chotTuBao[KET_CUC_KHONG_RO_CHOT_CTX_KEY] as { stepId: string; ma: MaKetCucKhongRo } | undefined;
    const q = await quyetDinhKetThucAnh({ runId, ctx, owner: run.startedBy ?? null, rows: hang, def: end.def, daCo, cachNo: cachNoEdge, viNo: viBao, chotTuBao: tuBao ? { stepId: tuBao.stepId, ma: tuBao.ma } : null, claimSeq: end.claimSeq }, "edgeSegment", undefined, KET_DOAN_EDGE_TONG_MS);
    const daBao = q.moi && q.chot ? { [KET_CUC_KHONG_RO_DA_BAO_CTX_KEY]: { stepId: q.chot.stepId, at: new Date().toISOString() } } : {};
    if (q.ghi === "terminal") return { patch: Object.keys(daBao).length ? { contextJson: { ...ctx, ...chotTuBao, ...daBao } } : {} };
    const at = new Date().toISOString();
    const unknown = edgeOutcomeUnknownOf(end);
    const prevUnknown = Array.isArray(ctx[OUTCOME_UNKNOWN_KEY]) ? (ctx[OUTCOME_UNKNOWN_KEY] as unknown[]).map(String) : [];
    return {
      giu: await write("held", {
        currentStepId: null,
        error: q.loi,
        contextJson: { ...ctx, interrupted: true, interruptedAt: at, interruptedFrom: run.status, interruptedBy: "end gate", ...(unknown.length ? { [OUTCOME_UNKNOWN_KEY]: [...new Set([...prevUnknown, ...unknown])] } : {}), ...chotTuBao, ...daBao },
      }),
    };
  };
  const ketThuc = async (status: OrchestrationRun["status"], patch: Partial<OrchestrationRun>): Promise<EdgeSegmentEndResult> => {
    const c = await congCuoi();
    if ("giu" in c) return c.giu;
    const out = await write(status, { ...patch, ...c.patch });
    if (out.ok && out.changed) quenBenKhongXacNhan(runId);
    return out;
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
      return ketThuc("completed", { finishedAt: new Date() });
    }
    case "paused": {
      const gate = end.gateStepId ? allStepsOf(end.def.steps).find((s) => s.id === end.gateStepId) : undefined;
      if (!gate || gate.type !== "hitl_gate") return held("pausedAtNonGate", `the edge reported a pause at "${end.gateStepId ?? "?"}", which is not a gate of the assigned definition`);
      const out = await write("awaiting_confirm", { currentStepId: gate.id, ...(Object.keys(chotTuBao).length ? { contextJson: { ...ctx, ...chotTuBao } } : {}) });
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
      return ketThuc("aborted", { finishedAt: new Date(), error: `aborted on edge node ${end.nodeCode}${end.error ? `: ${end.error.slice(0, 2000)}` : ""}` });
    default:
      // data-raw-ok: the run's error (the walker's own error text, prefixed with the node)
      return ketThuc("failed", { finishedAt: new Date(), error: `failed on edge node ${end.nodeCode}${end.error ? `: ${end.error.slice(0, 2000)}` : ""}` });
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
    completed: rows.filter((r) => !r.stepId.startsWith(ABORT_ROW_PREFIX) && (r.status === "completed" || r.status === "skipped") && dauKhongXacNhan(r.resultJson) === null).map((r) => r.stepId),
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
/** R1b-2b-2a A2(n) — `khongRo`: the step failed because its outcome is UNKNOWN (its failure carries the flag on: ancestor compensations split). */
export type ResumeStateMap = Record<string, { state: ResumeStepState; error: string; khongRo?: true }>;

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
    if (r && FINAL.has(r.status)) {
      // R1b-2b-2a A2(n) (I-E, T2B) — an unknown outcome is never sent again, compensation or not: a new claim would get a new authorisation
      if (r.status === "failed" && !s.compensation && loiLaKetCucKhongRo(r.error)) state[s.id] = { state: "doneFailed", error: r.error ?? "", khongRo: true };
      continue;
    }
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
    // A2(n) (C-1) — a CONTAINER held behind a child's hold whose STOP compensation already went: not ambiguous, the re-walk descends and the
    // failure reaching it finds its compensation settled (foeEngine.buTruSauKetCucKhongRo)
    if (r?.status === "held" && c != null && s.type !== "command") continue;
    // M-1 — a `running` row (its final row lost) has no text: the first loop's verdict, and the doubt itself, keep the flag
    const truoc = state[s.id];
    const error = r?.error || truoc?.error || "";
    // R1b-2b-2a A2(n) — the rows hold only the error text: an unknown-outcome failure is told by its code (FOE_/EDGE_OUTCOME_UNKNOWN)
    // (C-C) — and a compensation row with the code: its own unknown, or a hold at the dispatch of a known failure's compensation (needs n3 all the same)
    const kr = loiLaKetCucKhongRo(error) || loiLaKetCucKhongRo(c?.error) || truoc?.state === "outcomeUnknown" || (r?.status === "running" && c != null) ? { khongRo: true as const } : {};
    if (c == null) {
      // A2(n) extension — a step the sink refused was never sent: nothing of its own to undo
      if (r?.status === "failed") state[s.id] = laLoiKhongGuiChot(error) ? { state: "doneFailed", error } : { state: "compensationHeld", error, ...kr }; // failed, compensation never started
      continue;
    }
    if (!failedForward) {
      ambiguous.push(s.id); // a compensation row, but the forward step's row does not say it failed
      continue;
    }
    if (c.status === "compensated" || c.status === "failed") state[s.id] = { state: "doneFailed", error, ...kr };
    else state[s.id] = { state: "compensationHeld", error, ...kr }; // held / running (not sent ⇒ resumed; sent ⇒ comp is outcomeUnknown, not re-sent)
  }
  return { state, ambiguous };
}
