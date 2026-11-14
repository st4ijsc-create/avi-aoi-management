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
import { and, desc, eq, inArray, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { appendRunEvent } from "../runEventStore"; // doc 33 W4 (F8): durable RunEvent log (FOE_DURABLE)
// doc 81 Đợt 10 task C — ONE walker, TWO stores: every persistence / gate call of the walk goes through RunContext.store.
import {
  ABORT_ROW_PREFIX,
  DISPATCHED_CTX_KEY,
  WF_CORE_COLS,
  auditAbortStop,
  boundedAbortRead,
  type EdgeSegmentEndResult, // A2(n) T7b-3 (H36)
  centralRunStore,
  enabledAdapterIdsOfMachine,
  loadMachines,
  priorStepsOf,
  abortSentOf,
  readRunStepRows,
  setRunStatusUnlessAborted,
  stopBoundedWrite,
  upsertStep,
  upsertStepOn,
  type AbortSweepSource,
  type EdgeSegmentEnd,
  type PriorSteps,
  type RunStore,
  type RunStoreContext,
  type RunStoreHeldReason,
  type ResumeStateMap,
  INTERRUPTED_EARLIER_CTX_KEY,
  RESUME_STATE_CTX_KEY,
  edgeResumeStateOf,
  laLoiKhongGuiChot,
  loiKhongGuiChot,
  loiKhongGuiChotStop,
  themBuocHongKhiTiepTuc,
  buocTienCua,
  duongToiBuoc,
  toTienCua,
  type LaStop,
  dauKhongXacNhan,
  laHangChuaRa,
  phanLoaiStopAbort,
  dauVetAbort,
  LOI_HUY_BOI_ABORT,
  laHangHuyBoiAbort,
  stopAbortCoGui,
  type LanBamAbort,
  stopChuaRaTuHang,
  FOE_NOT_SENT_RUN_LATCHED,
  quyetDinhKetThucAnh,
  quenBenKhongXacNhan,
  type AnhKetThuc,
  type KetQuaKetThuc,
  type LyDoKetThuc,
} from "./foeRunStore";
import { edgeStepAuthorizations } from "../../edge/edgeControlSchema"; // fix review 2 (R-10-ae) — central's authorisation ledger (0372)
// R1b-2b-2a A2(m2) — a run interrupted while compensating: which compensation was in flight, and may the boot re-send it (b1–b3)
import {
  BIEN_LUOT_GUI_MS,
  BU_TRU_BI_NGAT_CTX_KEY,
  HAN_GHI_KET_QUA_LUOT_MS,
  HAN_XET_GUI_LAI_MS,
  LAN_GUI_LAI_KHOI_DONG,
  LY_DO_KHONG_GUI,
  choKetNoiSanSang,
  dauBuTruCua,
  dauDoBuTru,
  dauDoBuTruCho,
  docCuaSoGuiLai,
  docLenhSau,
  phanLoaiBuTruBiNgat,
  xetGuiLaiBuTruBiNgat,
  type DauBuTruBiNgat,
  type PhanLoaiBuTru,
} from "./foeBuTruBiNgat";
// R1b-2b-2a A2(n) — an UNKNOWN outcome never triggers a device write from a non-STOP compensation: split by energy direction
import { type DangDauVetAbort, type ChuStopAbort, type PhanLoaiStopAbort, chuBamSauKhongDoc, chuKhongDocDinhNghia, chuQuetChuaXong, chuStopAbort, MOC_CUA_SO, STOP_CHUA_RA_CTX_KEY, canhBaoKetCucKhongRo, stopChuaRaTuNguCanh, BUOC_KHONG_XAC_DINH, FOE_STOP_NOT_SENT, KET_CUC_KHONG_RO_CHOT_CTX_KEY, KET_CUC_KHONG_RO_CTX_KEY, KET_CUC_KHONG_RO_DA_BAO_CTX_KEY, KET_CUC_KHONG_RO_XAC_NHAN_CTX_KEY, KHONG_CO_BU_TRU, loiGiuChuaDocHang, KHONG_RO_DUYET_CTX_KEY, loiChuaRaStop, loiGiuChuaRa, maTuChoiCua, nguonCuaKetQua, viChuaRaCuaLoi, type ViChuaRa, buTruKhongRoCho, buocCoTheDaBayTuHang, chotTuHang, daDuyetBuTruKhongRo, dauKetCucKhongRoCua, nhanBuocSauChot, runDaChotKhongRo, type NhanSauChot, ghiAuditKetCucKhongRo, loiCoMaKhongRo, loiGiuBuTruKhongRo, loiLaKetCucKhongRo, maKetCucKhongRoCua, xetTiepTucKetCucKhongRo, type LoaiCanhBaoKhongRo, chuBamDaKetThuc, type KetThucKhongQuet, type NoKetThucKhongQuet } from "./foeKetCucKhongRo";
export { ensureOrchestrationAction, FOE_ACTION_TOOL, FOE_GATE_REQUIRED, FOE_NOT_SENT_RUN_LATCHED, FOE_STOP_NOT_SENT } from "./foeRunStore";
// doc 81 Đợt 10 C — what central's edge report / complete endpoints (group B) apply: the SAME row and status rules as the walk.
export { recordEdgeStepRows, applyEdgeSegmentEnd, edgePriorPictureOf, type EdgeStepRowWrite, type EdgeSegmentEndApply, type EdgeSegmentEndResult } from "./foeRunStore";
import type { EdgeRunPackage, EdgeSweepPicture } from "../../edge/edgeProtocol"; // doc 81 Đợt 10 C — types only (the edge walk)
import {
  orchestrationWorkflows,
  orchestrationWorkflowVersions,
  orchestrationRuns,
  orchestrationRunSteps,
  machines,
  deviceAdapters,
  deviceTags, // final wave P-E1 — the scope-decision probe
  robots, // doc 81 Đợt 4 final wave G3 — a robot step names an existing, enabled robot
  users, // doc 81 Đợt 9 R3 — names on the approver's screen ("issued to")
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
import { ABORT_RESEND_WINDOW_MS, abortResendAllowed } from "@shared/foeAbortResend"; // doc 81 Đợt 6 fix 3 (R-6-d)
import {
  equipmentRegistry,
  type EquipmentCommand,
  type EquipmentCommandResult,
} from "../../equipment/equipmentAdapter";
import { asPackmlState } from "../../equipment/packml";
import { STOP_DB_STEP_DEADLINE_MS, isStopJob } from "../../robot/stopJob"; // final wave F5 — the STOP DB deadline; Đợt 6 — the robot stop classifier
import { withDeadline } from "../../ot/drivers/boundedClose"; // final wave F5 — bounded STOP-step lookups
import { moTaMotPhan, motPhanCua, type MotPhan } from "../../ot/motPhan"; // R1b-2b-2a T3E (backlog 90) — lô áp MỘT PHẦN: không gửi lại
import { coTheDaBayCua, moTaCoTheDaBay } from "../../equipment/lenhTruocCoTheDaBay"; // R1b-2b-2a T3F (backlog 91) — lệnh trước có thể đã bay: không gửi lại
import {
  computeBindingDetail,
  programChecksRecord,
  findStepDeep,
  hashWorkflowDefinition,
  FOE_APPROVAL_SOURCE_SERVER,
  FOE_APPROVAL_SOURCE_SYSTEM,
  FOE_API_RUN_PARAM,
  FOE_DEF_VERSIONS_PARAM,
  FOE_REJECT_CLAIM_CTX_KEY,
  runExecutedVersions,
  runStartedViaApi,
  deriveRunApprovalIdentity,
  excludedApprovers,
} from "./foeGateApproval"; // doc 81 Đợt 4 fix round 1 (R-4-e … R-4-i); Đợt 5 E1 (apiRun); Đợt 7 I6 (reject claim token); Đợt 8 O2; Đợt 9 R2
import { isMigrationMissingError, orchestrationRunsWithApiKey, readApiKeyParties, readRunApiKeyId } from "./runApiKeyIdentity"; // doc 81 Đợt 9 R1/R3 (mig 0369, narrow projections)
import type { ProgramCheck } from "../../ot/programChecksum"; // doc 81 Đợt 8 O2/O3 — the approver's screen list
import { EDGE_HOLD_MARK_KEYS, EDGE_RESUMED_BY_CTX_KEY, edgeProgramPreOf } from "../../edge/edgeProgramReportRule"; // doc 81 Đợt 10 C fix review 1 (R-10-m) — THE report rule + hold marks
import { adapterOwnership, edgeNodeProgramReports, isEdgeControlSchemaMissing } from "../../edge/edgeControlSchema"; // doc 81 Đợt 10 C (D7) — narrow projections (0373/0374)
import { toRobotJob } from "../../equipment/robotJobMapping"; // final wave (item 2) — same mapping the robot route uses
import {
  allStepsOf,
  buildEquipmentCommand,
  commandOf,
  isOtStopCommandType,
  isRobotKind,
  isStopCandidate,
  subtreeHasStopCandidate,
  makeStopVerifier,
  type StopVerification,
  type StopVerifier,
  laStopTheoBuoc,
  stopActionIdMoi,
} from "./foeStepClass"; // doc 81 Đợt 5 task E fix 1 (R-5-j) — THE step walk + stop classification
export { buildEquipmentCommand } from "./foeStepClass";
import {
  collectTargets,
  isOutOfScopeEmpty,
  makeScopeJudge,
  resolveUserFoeScope,
  stepsTouching,
  workflowScopeKeyOf,
  type FoeScope,
  type OutOfScope,
} from "./foeScope"; // doc 81 Đợt 5 task E2 — factory scope (item 26); Đợt 7 I fix 1 — ref namespace
export type { FoeScope } from "./foeScope";
// doc 81 Đợt 9 task S2/S3 — the edge assignment of a run (mig 0370, narrow projections): runs a node executes
import { edgeAssignedRunIdsAmong, readEdgeAssignment, runEdgeAssignments } from "../../edge/edgeExecutionSchema";
import { orchestrationRunsWithApiKey as edgeRunInsertWithApiKey } from "./runApiKeyIdentity"; // S2 — the key IN the insert (mig 0369)
import { napMotLan } from "./foeNapMotLan";

const napAudit = napMotLan(() => import("../../auditTrailService"));
const napCanhBao = napMotLan(() => import("../../robot/criticalStopAlert"));
const napPolicy = napMotLan(() => import("../../security/policyGate"));
import { secPlatformEnabled } from "../../security/secPlatformFlag"; // A2(n) T7b-1d lượt sửa 1 (H29) — read with nothing loaded: flag off, the policy's module is never waited for
const napEdgeChung = napMotLan(() => import("../../edge/edgeCentralCommon"));
const napDispatcher = napMotLan(() => import("../../ot/commandDispatcher"));

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
    const { logCrudOperation, createAuditContext } = await napAudit();
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
  /**
   * doc 81 Đợt 7 I fix 1 — the workflow to update (rollback; the Studio editor of a loaded workflow): used only when it
   * carries the deployed ref and the deployer may see it (or it is in the deployer's own namespace); else as if absent.
   */
  targetWorkflowId?: number;
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
  reason?: DefinitionRefusalReason | typeof FOE_SCOPE_UNVERIFIED | typeof FOE_ABORT_UNCONFIRMED | typeof FOE_RESEND_TOO_OLD;
  stepIds?: string[];
  /**
   * doc 81 Đợt 6 (owner decision 2026-10-11) — set on an abort that went past its scope check: what happened to the
   * run's remaining STOP steps and due STOP compensations (see abortStopSweep).
   */
  abortStops?: AbortStopReport;
  /** doc 81 Đợt 6 fix 3 (M5) — true ⇔ this answer is a RE-SEND on a run that was already aborted (not a new abort). */
  resend?: boolean;
  /** doc 81 Đợt 9 task S2 — the run is executed by this edge node (central does not walk it; it waits 'queued' for the node). */
  edgeNodeId?: number;
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
  /** A2(n) T7b-1 fix 1 (RA-1) — this sweep could not read the definition, or (pressed again on a latched run) the step rows: what it did not send, it does not know of. Absent otherwise */
  khongDocDuoc?: true;
  /** A2(n) T7b-1d lượt sửa 2 (H32) — past the ceiling of the sweep: it has not answered and goes on behind this report: nothing is known of what it read or sent. Absent otherwise */
  quetChuaXong?: true;
  /** A2(n) T7b-1d lượt sửa 2 — this press joined a sweep in flight: the report is that sweep's, this press sent nothing of its own. Absent otherwise */
  nhapQuet?: true;
  /** A2(n) T7b-1c — THE class of each STOP this sweep looked at (foeRunStore.phanLoaiStopAbort), what the answer's words read: a latched run, and T7b-1d a press on any run (`chuaKhoa`). Absent otherwise */
  phanLoai?: Record<string, PhanLoaiStopAbort>;
  /** A2(n) T7b-1d (H23) — this press read a run not latched: nothing is owed on it, the window stands. Absent otherwise */
  chuaKhoa?: true;
  /** A2(n) T7b-1d (H27) — a run not latched: what this Abort did not get out and whose `abort:` row did not land: nothing remembers it. Absent otherwise */
  khongBen?: string[];
  /** A2(n) T7b-1d lượt sửa 3 (F1) — unread, read earlier as no pinned STOP and pinned again: the send path's own verdict (stopAbortCoGui at this press) says a later press does not send it. Absent otherwise */
  khongGuiLai?: string[];
  /** A2(n) T7b-1d lượt sửa 3 (F7) — read earlier as no pinned STOP, read pinned now, and not sent by the same verdict: past the window. Absent otherwise */
  ghimNgoaiCua?: string[];
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
  | "refOutOfScope"
  /** doc 81 Đợt 7 task I3 / I fix 1 — the deployer's factory scope could not be resolved (retry). */
  | "scopeUnverified"
  /** doc 81 Đợt 7 I fix 1 — several workflows the caller can see share the ref (deploy / start from the workflow itself). */
  | "refAmbiguous"
  /** doc 81 Đợt 7 I fix 1 (M-2) — a concurrent create took the (ref, scope) first (retry). */
  | "refConflict"
  /** final wave F9 (N5) — the workflow named by `targetWorkflowId` is gone / not visible and the ref is taken in the deployer's namespace (reload, no retry). */
  | "refTargetStale";

/** doc 81 Đợt 9 task R3 — see RunView.apiKey. */
export interface RunApiKeyView {
  identified: boolean;
  keyId: number | null;
  name: string | null;
  keyPrefix: string | null;
  holder: { id: number; name: string | null } | null;
  creator: { id: number; name: string | null } | null;
  /** users the key was issued to before (still excluded: the secret did not change with the holder). */
  earlierHolders: Array<{ id: number; name: string | null }>;
  /** every user whose approval never counts for this run (starter + key parties). Empty when not identified. */
  excludedUserIds: number[];
  /** doc 81 Đợt 9 R fix 1 — why no approval can count now (null = identified and usable). */
  refusal: "ownerUnknown" | "apiRun" | "apiKeyInactive" | "apiIdentityUnavailable" | null;
  /** "inactive" | "expired" for apiKeyInactive; "migrationMissing" | "readError" for apiIdentityUnavailable. */
  refusalDetail: string | null;
}

/**
 * doc 81 Đợt 9 task R3 — the approver screen's view of an API run's key (best-effort read: any failure ⇒ identified false,
 * which is also what the engine concludes — nothing on the screen can let an approval count that the server refuses).
 */
async function apiKeyViewOf(d: NonNullable<Awaited<ReturnType<typeof getDb>>>, run: OrchestrationRun): Promise<RunApiKeyView | null> {
  // R fix 1 (#3) — a recorded key also makes it an API run (read below); an unmarked run without one ⇒ null.
  let recorded: number | null = null;
  try {
    recorded = await readRunApiKeyId(d, run.id);
  } catch (err) {
    if (!runStartedViaApi(run) && isMigrationMissingError(err)) return null;
    return { identified: false, keyId: null, name: null, keyPrefix: null, holder: null, creator: null, earlierHolders: [], excludedUserIds: [], refusal: "apiIdentityUnavailable", refusalDetail: isMigrationMissingError(err) ? "migrationMissing" : "readError" };
  }
  if (!runStartedViaApi(run) && recorded === null) return null;
  const none: RunApiKeyView = { identified: false, keyId: null, name: null, keyPrefix: null, holder: null, creator: null, earlierHolders: [], excludedUserIds: [], refusal: "apiRun", refusalDetail: null };
  try {
    const keyId = recorded;
    if (keyId === null) return none;
    const key = await readApiKeyParties(d, keyId);
    if (!key) return { ...none, keyId };
    const idr = await deriveRunApprovalIdentity(d, run);
    const ids = [...new Set([key.holder, key.creator, ...key.everHolders].filter((v): v is number => typeof v === "number"))];
    const rows = ids.length ? await d.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
    const nameOf = (id: number) => rows.find((r) => r.id === id)?.name ?? null;
    return {
      identified: idr.ok,
      keyId,
      name: key.name,
      keyPrefix: key.keyPrefix,
      holder: key.holder !== null ? { id: key.holder, name: nameOf(key.holder) } : null,
      creator: key.creator !== null ? { id: key.creator, name: nameOf(key.creator) } : null,
      earlierHolders: key.everHolders.filter((u) => u !== key.holder).map((id) => ({ id, name: nameOf(id) })),
      excludedUserIds: idr.ok ? excludedApprovers(idr.identity) : [],
      refusal: idr.ok ? null : idr.reason,
      refusalDetail: idr.ok ? null : (idr.detail ?? null),
    };
  } catch (err) {
    return { ...none, refusal: "apiIdentityUnavailable", refusalDetail: isMigrationMissingError(err) ? "migrationMissing" : "readError" };
  }
}

export interface RunView {
  /** R1b-2b-2a A2(n) (M-4) — steps whose held compensation (unknown outcome) a Continue would write: it needs a person and a reason. */
  khongRoCho?: string[];
  run: OrchestrationRun;
  /**
   * doc 81 Đợt 4 fix round 2 (R-4-k) — hash of the definition currently deployed for this run's workflow (what the
   * approver's screen shows); sent back as `expectedDefHash` on approval. null when the workflow row is missing.
   */
  defHash: string | null;
  /**
   * doc 81 Đợt 7 task I2 — computeBindingDigest of the device configuration the run's definition resolves to NOW (what the
   * approver's screen covers); sent back as `expectedBindingDigest` on approval. null ⇔ it could not be computed (DB error)
   * or the workflow row is missing — the Studio then cannot approve (fail-closed).
   */
  bindingDigest: string | null;
  /**
   * doc 81 Đợt 8 tasks O2/O3 — the controller program check of every OT adapter / robot the run's commands use, read
   * together with `bindingDigest` (same reading): "verified" (+ checksum, part of the digest) · "unsupported" (this
   * controller cannot be verified — shown plainly, never treated as verified) · "unreadable" (supported but not read now ⇒
   * bindingDigest is null ⇒ no approval). null exactly when bindingDigest is not computed for this read (see getRun).
   */
  programChecks: ProgramCheck[] | null;
  /**
   * doc 81 Đợt 9 task R3 — for a run started through an API key: which key, who it is issued to, and WHO cannot give a
   * counting approval (the same derivation as the engine / dispatchers). null for a run started by a user. A key that
   * cannot be identified ⇒ `identified: false` (its non-STOP OT/robot commands are refused whoever approves).
   */
  apiKey?: RunApiKeyView | null;
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
  /**
   * doc 81 Đợt 7 task I2 — the binding digest (RunView.bindingDigest) the approver's screen LOADED. On an approval of an open
   * gate it must equal computeBindingDigest() NOW, else CONFLICT (reason bindingChanged, "configuration changed — reload")
   * before any state change. A screen-bound approval (expectedDefHash given) without it ⇒ the same CONFLICT (fail-closed).
   * Both omitted ⇒ no check (internal callers: QT pump, auto-resume — they record no counting approval of a person).
   */
  expectedBindingDigest?: string;
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
/**
 * A2(n) T8 lượt sửa 1 (CHAN-3) — is a walker of this run alive in THIS process: what the URGENT obligation sweep (foeRunStore.quetUrgentChuaBen, its required `walkerSong`) asks before it tells a central
 * run. One central engine process assumed (foeRunStore.cheDoProcessEngine). T12 wires it. A boolean only: nothing of the run is read out.
 */
export function coWalkerSongTrongProcess(runId: number): boolean {
  return liveRuns.has(runId);
}

interface RunContext extends LiveRunHandle, RunStoreContext {
  runId: number;
  def: WorkflowDefinition;
  params: Record<string, unknown>;
  context: Record<string, unknown>;
  user: FoeUser;
  /**
   * doc 81 Đợt 10 task C — where the walk persists and asks: the central store (foeRunStore.centralRunStore — today's DB
   * functions, unchanged) or an edge store (edge/edgeRunStore.ts — run package + journal + /authorize, no DB).
   */
  store: RunStore;
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
   * doc 81 Đợt 5 task E1 — the run was started through an API key (server-written markers, see
   * foeGateApproval.runStartedViaApi). doc 81 Đợt 9 R2 (option A) — its approvals then count only when the approver is
   * none of the key's parties (deriveRunApprovalIdentity); this flag is a fail-closed HINT added to the row's markers.
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
  /**
   * doc 81 Đợt 9 task S3 / Đợt 10 C — this EDGE walker lost its claim (the edge store's authorisation answered `stale`): it
   * writes no run status. (Đợt 10 C removed the DB run guard: the per-step /authorize of the edge store decides.)
   */
  edgeDetached?: boolean;
  /**
   * R1b-2b-2a A2(m2) (b1) — the walk is the BOOT re-send of an interrupted STOP compensation: a command the central store does not
   * authorise as a PINNED STOP for this dispatch (`auth.stopGhim`) is never handed to a dispatcher (the pins may have changed since the
   * boot checked them). Set only by guiLaiBuTruLucKhoiDong.
   */
  chiGuiStopGhim?: boolean;
  /**
   * R1b-2b-2a A2(n) — compensations being sent AUTOMATICALLY after an unknown outcome because they were classified a pinned STOP: such a
   * command is handed to a dispatcher only if the central store authorises it as a pinned STOP for THIS dispatch (`auth.stopGhim` — the pins
   * may have changed since the classification); otherwise it is held for a person. Per step id (sibling parallel branches are unaffected).
   */
  chiStopGhimIds?: Set<string>;
  /** R1b-2b-2a A2(n) — the identity of this walk segment (the outcome-unknown alerts' dedup); set on first use. */
  luotDi?: string;
  /** A2(n) (I-3, m-1) — what the dispatcher answered for a compensation sent by itself (the words of the URGENT come from this, not from "ok"). xacNhan (D): acked_verified. */
  ketQuaBuTru?: Map<string, { accepted: boolean; simulated: boolean; xacNhan: boolean }>;
  /** A2(n) (R-4) — this walk reported something about an unknown outcome, or resumed one (no "no compensation due" alert then). */
  khongRoDaBao?: boolean;
  /** A2(n) (R-4) — the command steps of this walk that ended on an unknown outcome. */
  khongRoGoc?: Set<string>;
  /**
   * A2(n) (I-A) — a walk under a Continue that passed n3 is a COMPENSATION-ONLY walk: the approved steps and the containers on the way to them
   * (duongBuTruCua, from the approval). undefined ⇔ not computed yet, null ⇔ an ordinary walk.
   */
  duongBuTru?: Set<string> | null;
  /** A2(n) (S-1) — this walk decided an unknown outcome: the run is latched even if the latch's write failed. */
  khongRoChot?: boolean;
  /** A2(n) (S-1, I-F) — compensations this walk already sent or is sending: never twice, whichever level reaches them first. */
  buTruDaGui?: Set<string>;
  /** A2(n) (m-E) — a Continue's approved compensation really ran in this walk. */
  buTruDaChay?: boolean;
  /** A2(n) (b) — the step rows of this run carry the unknown code (a crash can lose the context's latch, not these): the run is latched. */
  khongRoChotHang?: boolean;
  /** A2(n) (a) — what this walk decided unknown: step ⇒ its error. The latch's reading behind the aggregators (loiKhongRoRun). */
  khongRoTai?: Map<string, string>;
  /** A2(n) (c) — the commands handed to a dispatcher with no answer yet: step ⇒ is it a STOP. Marked in the SAME tick as the latch check. */
  dangGui?: Map<string, boolean>;
  /** A2(n) (a) — the error each compensation was entered with (the words of a hold at the dispatch). */
  loiBuTru?: Map<string, string>;
  /** A2(n) (a) — a step inside a compensation ⇒ whose compensation it is (from the definition, never from a caller). */
  chuBuTru?: Map<string, ChuBuTru>;
  /** A2(n) (a) — compensations already held at the dispatch in this walk (a parallel body reaches the sink twice). */
  buTruDaGiu?: Set<string>;
  /** A2(n) extension — central: the steps whose rows say they may have gone out (a crash can lose the rest). An edge's are in its resume state. */
  khongRoHang?: Set<string>;
  /** A2(n) T6 (decision 3, H13) — the forward work this latched walk dropped, read at its end from the evidence over the whole tree (buocTienBiBo): one step per branch. */
  khongGuiDs?: string[];
  /** A2(n) T6a fix 1 (P1) — the last pass's reading: stop-typed steps whose pin read ANSWERED "not pinned". No STOP: forward work, read once, by the planner. */
  khongGhimCuoi?: Set<string>;
  /** A2(n) T6e lượt sửa 1 (dieu-phoi 08/11 T6e-K1, A) — of khongGhimCuoi: stop-typed steps the sweep's verifier read as not pinned while the dispatcher's own predicate, asked at the last pass,
   *  said a pinned STOP (the pins read at two moments). Not sent, not state C: named, every one, in the words of a STOP whose pin could not be verified. Central only. */
  khongXacMinhGhim?: Set<string>;
  /** A2(n) T6c (Q2, item 4) — stop-typed steps of the marked route its dispatcher answered "no pinned STOP" for, with the code: forward work dropped, told in words true of what happened. */
  dispatcherNoiKhongGhim?: Map<string, string>;
  /** A2(n) T6d (E-C6) — verified STOPs the edge snapshot refused as not pinned, told once in this walk. */
  ghimLechDaBao?: Set<string>;
  /** A2(n) T6 (m-P) — compensations whose own unknown outcome a person was told of in this walk: once. */
  buTruKhongRoDaBao?: Set<string>;
  /** A2(n) (C-6) — STOP work running beside the walk: passes, and a STOP compensation started at the door. Side by side, never chained; finishWalk settles them. */
  stopNen?: Array<Promise<void>>;
  /** A2(n) (I-F) — the first STOP pass of this walk has started. */
  luotDauStop?: boolean;
  /** A2(n) — forward STOPs a pass is sending. */
  diStop?: Set<string>;
  /** A2(n) — stop-typed steps the door stopped: a pass sends them, or says it did not. */
  denCuaStop?: Set<string>;
  /** A2(n) — `step#attempt` of the stop-typed steps that asked again at the sink: once each. */
  hoiLaiStop?: Set<string>;
  /** A2(n) (Q-6) — one hand-over for one STOP: a STOP on its way, or answered ok, and its outcome, for a second runner (the walker's step and a pass). */
  stopDangGiao?: Map<string, Promise<StepOutcome>>;
  /** A2(n) (M1) — branch STOPs already told. */
  nhanhDaBao?: Set<string>;
  /** A2(n) (F2) — a compensation held beside the walk, by a pass or at the door: a held row holds the run, whatever the walk answers and whenever it answers. */
  giuNen?: Extract<StepOutcome, { kind: "held" }>;
  /** A2(n) T6 (S3) — every hold of this walk by what it holds (buTruDaGiu's ids): a hold lifted gives the run's words to one that stands. */
  giuCon?: Map<string, Extract<StepOutcome, { kind: "held" }>>;
  /** A2(n) (R5) — compensations that did go, each with whether its going may end the run: confirmed, or told in a durable URGENT (H2). T6 (H14): no answer at the last attempt went too. */
  buTruDaDi?: Map<string, Promise<boolean>>;
  /** A2(n) T5 (C) — the STOPs this walk left in state C, and why: not settled, the run ends held. Bound by the LAST attempt (V-MIX). A later walk reads them from the rows (src.chuaRa). */
  chuaRaStop?: Map<string, ViChuaRa>;
  /** A2(n) T5 (H17) — STOPs an attempt may have sent: step ⇒ the code of that attempt. One way: a later refusal says nothing of it. From memory, and from the rows of earlier walks (central). */
  stopCoTheRa?: Map<string, string>;
  /** A2(n) T5 — state C told in this walk: once per STOP. */
  chuaRaDaBao?: Set<string>;
  /** A2(n) T9 (T7B1-NOTPINNED, T9-CHU-Q2B) — STOPs whose last hand-over went by the marked route: nobody verified their pins, so their words promise nothing */
  danhDauGiao?: Set<string>;
  /** A2(n) T9 (T9-CHU-NO-GIA) — owed ids the definition does not make a STOP: their words never call them one */
  khongStopNo?: Set<string>;
  /** A2(n) T9 (MAT-HET-CS, H15) — forward steps of a later walk with no record of an earlier hand-over: the STOP compensations the containers around them declare */
  khongBanGhi?: Map<string, string[]>;
  /** A2(n) T9 (T9-CONTINUE-K1) — the STOPs whose going was told as replacing an earlier "did NOT go out", once per walk */
  stopDaDiDaBao?: Set<string>;
  /** A2(n) T9 lượt sửa 1 (R-2) — steps whose LAST hand-over was answered SIMULATED: nothing reached the device */
  giaoMoPhong?: Set<string>;
  /** A2(n) T5 (H1, race) — a STOP that failed before the latch with no code: duongKetThuc puts it in state C if the run latches after all. Not sent again. */
  stopTuChoiTruocKhoa?: Map<string, { attempt: number; vi: ViChuaRa }>;
  /** A2(n) T7b-1 fix 1 (RA-1, R3-E) — what an Abort's sweep of this live walk could not send while the run was not latched: its `abort:` row may be the write lost */
  abortChuaRa?: Map<string, ViChuaRa>;
  /** A2(n) T7b-1c (RA2-4) — what an Abort's sweep of this live walk saw go: its `abort:` row may land after the walk reads */
  abortDaDi?: Set<string>;
  /** A2(n) T7b-1d (H25) — what forward work this walk or its Abort already told as dropped */
  khongGuiDaBao?: Set<string>;
  /** A2(n) T7 — the answers of every URGENT this walk raised (central: stored or not). The end gate reads them: one stored is the run's durable URGENT (decision 1) */
  baoCho?: Array<Promise<boolean>>;
  /** A2(n) T7b-3 (H36) — finishWalk wrote this end (central, not latched, no sweep): told once the walker has let go of the run (sauLuotDi) */
  ketThucKhongQuet?: KetThucKhongQuet;
}

/** R1b-2b-2a T2B — machine-readable code of a non-STOP command step whose dispatch timed out (outcome unknown; not retried). */
export const FOE_OUTCOME_UNKNOWN = "FOE_OUTCOME_UNKNOWN";
/**
 * R1b-2b-2a T3E (backlog 90) — machine-readable code of a non-STOP command step whose batch the device applied only PARTLY (dispatch `failed` +
 * `motPhan`, live or replayed from command_log): NOT retried. A code of its own (not FOE_OUTCOME_UNKNOWN): the outcome IS known item by item — the
 * step error names what was applied and what was not, so the operator acts on exactly those (no blind read-back of everything).
 */
export const FOE_OUTCOME_PARTIAL = "FOE_OUTCOME_PARTIAL";

/** A2(n) (a) — a step whose compensation is being looked at. */
type ChuBuTru = { step: WorkflowStep; comp: WorkflowStep };

/** Outcome of executing a step subtree. */
type StepOutcome =
  | { kind: "ok" }
  | { kind: "skipped" }
  /**
   * khongRoLoi (R1b-2b-2a A2(n), C-A): on a paused / held / aborted outcome — a sibling branch FAILED on an unknown outcome (its error). The flag
   * outranks every sibling state: a container splits its own compensation, and the walk's end tells a person, whatever the parallel answered.
   */
  | { kind: "paused"; stepId: string; khongRoLoi?: string } // hitl_gate / held → run pauses
  /**
   * outcomeUnknown (R1b-2b-2a T2B): set ONLY by execCommand when the dispatch status was "timeout" (sent, outcome unknown), or (T3F) the
   * dispatcher refused because the previous command with the same key may be in flight or already applied (coTheDaBayCua).
   * motPhan (R1b-2b-2a T3E): set ONLY by execCommand when the dispatch was `failed` with a partial batch (detail.motPhan). Both are read only by
   * execStep's retry loop, which rewrites the outcome (flag dropped) before it leaves.
   * stopGhim (R1b-2b-2a A2(m)): set ONLY by execCommand when the central store authorised the command as a PINNED STOP (fresh row);
   * read only by execStep's retry loop (the STOP default of attempts, soLanThuToiDa), which drops it before the outcome leaves.
   * khongRo (R1b-2b-2a A2(n)): the step FAILED because its outcome is UNKNOWN (FOE_OUTCOME_UNKNOWN / EDGE_OUTCOME_UNKNOWN, or a STOP-typed step
   * whose last attempt stayed unknown — I-1). Set by execStep (never by execCommand) and KEPT on the way up: the failed branch of execStep — of
   * the step and of every container around it — then sends a due compensation by itself only if it is a STOP (else the run is held for a person).
   * A known failure never carries it (n6).
   * khongGuiChot (A2(n) extension): the sink refused a forward step, FOE_NOT_SENT_RUN_LATCHED. Final, like khongRo: no further attempt of the step or of a container
   * around it (no `-a2` key), and a parallel never swallows it. It rises with the failure.
   * chuaRaStop (A2(n) T5, state C): set ONLY by execCommand's layer (lopChuaRa), on a latched run, stop-typed, a clear "no" or nobody could decide: why. NOT khongGuiChot: the budget still counts
   * (execStep, guiStopKhongRo). Read for a command only: a container's failure is not one.
   */
  | { kind: "failed"; error: string; outcomeUnknown?: true; motPhan?: MotPhan; stopGhim?: true; khongRo?: true; khongGuiChot?: true; chuaRaStop?: ViChuaRa }
  | { kind: "aborted"; error: string; khongRoLoi?: string }
  /**
   * doc 81 Đợt 10 C (design §2.10, D5) — an EDGE store could not obtain the authorisation of a NON-STOP command (central
   * unreachable, journal full …): nothing was sent, the step is held, NO compensation; the run ends the segment 'held'
   * (Continue later). The central store never answers it.
   */
  | { kind: "held"; stepId: string; reason: RunStoreHeldReason; error: string; khongRoLoi?: string };

// ── db helpers (fail-safe) ───────────────────────────────────────────────────────

async function db() {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  return d;
}

/**
 * Doc 25 T1 — nạp tập stepId ĐÃ HOÀN TẤT (completed/skipped) của một run từ _run_steps.
 * Dùng cho RESUME idempotent: execStep bỏ qua các bước này. Fail-safe: DB lỗi → tập rỗng
 * (walk sẽ chạy lại — an toàn hơn là bỏ sót bước; với control OFF mọi dispatch là dry-run).
 */
async function loadCompletedSteps(runId: number): Promise<{ completed: Set<string>; prior: PriorSteps; khongRoChotHang?: boolean; khongRoHang?: Set<string>; stopCoTheRa?: Map<string, string> }> {
  const set = new Set<string>();
  const d = await getDb();
  if (!d) return { completed: set, prior: { ...priorStepsOf([]), unknown: true } }; // fix 2 (R-6-c): unknown, not empty
  const rows = await d
    .select()
    .from(orchestrationRunSteps)
    .where(eq(orchestrationRunSteps.runId, runId));
  for (const r of rows) {
    if ((r.status === "completed" || r.status === "skipped") && dauKhongXacNhan(r.resultJson) === null) set.add(r.stepId); // T5 (H16) — a row central could not verify is no finished step
  }
  // doc 81 Đợt 6 — same read, the abort sweep's picture; A2(n) (b) — a row with the unknown code latches the run even if the context lost it (a crash)
  const stopCoTheRa = new Map(rows.flatMap((r) => {
    const vi = viChuaRaCuaLoi(r.error);
    return laHangChuaRa(r) && vi?.nguon === "driverLoi" ? [[r.stepId, vi.ma] as const] : [];
  }));
  return { completed: set, prior: priorStepsOf(rows), ...(chotTuHang(rows) ? { khongRoChotHang: true } : {}), khongRoHang: buocCoTheDaBayTuHang(rows), stopCoTheRa };
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

const ABORTED_OUTCOME: StepOutcome = { kind: "aborted", error: LOI_HUY_BOI_ABORT };

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
 *   R1b-2b-2a A2(m) — an OT STOP's pin check (foeRunStore.laStopGhimChoHangFoe, ≤ D, between the lookups and its authorisation
 *   row) adds one D per STOP to every figure above: (L + 5)·D, (L + 5 + 7·(k − 1))·D, ≤ 6·D. A failed attempt of a PINNED STOP on
 *   its default of attempts waits ≤ D before the next one (stopGhimLuiMs: 250 ms, then 500 ms).
 *   R1b-2b-2a A2(n) — a STOP compensation due after an UNKNOWN outcome is classified first (rc.store.buTruLaStopGhim: the adapter lookup + the pin
 *   read, one bound of 2·D, buTruLaStopGhimTrungTam): ≤ 8·D after the failing step's body returns, on that path only. A STOP compensation of a
 *   CONTAINER behind a child's unknown outcome: the rows before it are bounded too (giuCoKhongRo: the child's failed row ≤ D, its compensation's split
 *   ≤ 2·D, its held row ≤ D, one held row ≤ D per container up to this one, level L) ⇒ dispatched within (L + 12)·D of the child's body returning.
 *   R1b-2b-2a A2(n) (m-I) — add to every A2(n) figure: the latch's write (≤ D) and, for the STOP of a container m hops up, the classification of each hop
 *   below it (≤ 2·D each) plus the dispatch time of each lower STOP (stopToTienMoi sends innermost first and awaits it: a dead device's dispatch timeout
 *   delays the next one). The general bound is (L + 13 + 2·m)·D + those m dispatches.
 *   R1b-2b-2a A2(n) (C-6) — a STOP a pass sends after the latch does not walk any of this: from the latch, the pass's rows ≤ D and its verification ≤ D, then that STOP's own path
 *   above (for a compensation its classification ≤ 2·D first), side by side with every other STOP of the pass: no sibling and no slower STOP adds to it. The end of the walk waits
 *   for what is running, with no bound of its own yet.
 */
async function stopBoundedReadbacks(stop: boolean, rc: RunContext, stepId: string, c: Condition | undefined): Promise<void> {
  if (!stop) return refreshConditionReadbacks(rc, c);
  await withDeadline(refreshConditionReadbacks(rc, c), STOP_DB_STEP_DEADLINE_MS, `FOE stop step ${stepId} read-back`).catch((err: unknown) => {
    console.warn(`[FOE] run ${rc.runId} stop step ${stepId}: condition read-back not answered in time — evaluated on the last values (L-7): ${(err as Error)?.message ?? err}`);
  });
}

/** R1b-2b-2a A2(m) — attempts in total of a PINNED STOP step whose maxAttempts is UNSET (an explicit maxAttempts is kept as is). */
export const STOP_GHIM_SO_LAN_MAC_DINH = 3;
/** R1b-2b-2a A2(m) — the first pause before a retry of such a STOP; doubled per attempt, never above D (STOP_DB_STEP_DEADLINE_MS). */
export const STOP_GHIM_LUI_DAU_MS = 250;

/**
 * R1b-2b-2a A2(m) — the attempts in total of a step: an explicit `maxAttempts` (retries) ⇒ maxAttempts + 1, as before; UNSET ⇒ 1 — except
 * a PINNED STOP (`stopGhim`: the central store authorised THIS dispatch as one), which gets STOP_GHIM_SO_LAN_MAC_DINH: a STOP whose
 * first attempt failed (device error, a crash-and-resume refusal) is sent again. Pure.
 */
export function soLanThuToiDa(step: Pick<WorkflowStep, "maxAttempts">, stopGhim: boolean): number {
  if (stopGhim && step.maxAttempts === undefined) return STOP_GHIM_SO_LAN_MAC_DINH;
  // the engine's retry budget — the bound edge /authorize mirrors (edgeAuthorizeParity: `req.attempt > maxAttempts`); unchanged
  return Math.max(1, (step.maxAttempts ?? 0) + 1);
}

/**
 * R1b-2b-2a A2(m) — the pause before attempt `attempt` (≥ 2) of a pinned STOP on its default: 250 ms, 500 ms, … bounded by the engine's
 * STOP bound D = STOP_DB_STEP_DEADLINE_MS (1 s). With the default of 3 attempts the STOP waits at most 750 ms in pauses in total. Pure.
 */
export function stopGhimLuiMs(attempt: number): number {
  return Math.min(STOP_DB_STEP_DEADLINE_MS, STOP_GHIM_LUI_DAU_MS * 2 ** Math.max(0, attempt - 2));
}

/** Execute ONE step subtree. Persists state; routes commands via E0. Fail-safe. `quaCua`: a STOP pass (diStopTien) sends this STOP: no door, no precondition, no gate of the walk in front of it. */
async function execStep(rc: RunContext, step: WorkflowStep, quaCua = false): Promise<StepOutcome> {
  if (rc.aborting) return { kind: "aborted", error: LOI_HUY_BOI_ABORT };

  // Doc 25 T1 — RESUME idempotent: bước đã hoàn tất ở lần chạy trước thì KHÔNG chạy lại.
  // Tránh tái-dispatch lệnh OT (mất idempotency khi OT thật) và tránh re-pause gate đã
  // duyệt — áp cho MỌI loại bước, kể cả gate/lệnh lồng trong parallel/branch/sequence.
  if (rc.completed.has(step.id)) {
    return { kind: "ok" };
  }

  // doc 81 Đợt 10 C fix review 1 (R-10-y, D5) + fix review 2 (R-10-ae) — what an earlier segment of an EDGE run left, as central
  // derived it from the STEP ROWS at the Continue (resumeRun → edgeResumeStateOf; never an edge context mark):
  //   • compensationHeld — the step FAILED and its compensation is due: ONLY the compensation runs, the step is never re-run;
  //   • doneFailed — the step failed and its compensation ended: nothing is redone;
  //   • outcomeUnknown — handled below: never sent again, a failure.
  const rs = resumeStateOf(rc, step.id);
  // A2(n) — a STOP pass on a step the sink refused: "not sent" is what it says, the pass is there to send it. Nothing else skips this.
  const tuChoiChuaGui = quaCua && rs !== null && laLoiKhongGuiChot(rs.error);
  if (rs && rs.state !== "outcomeUnknown" && !tuChoiChuaGui) {
    rc.settled.add(step.id); // minor (re-review N2) — the abort sweep's picture of this segment knows it is settled
    if (!rc.prior.startOrder.includes(step.id) && !rc.startOrder.includes(step.id)) rc.startOrder.push(step.id);
    // R1b-2b-2a A2(n) — a step that failed on an UNKNOWN outcome keeps saying so (its containers' compensations split again)
    const kr = rs.khongRo || loiLaKetCucKhongRo(rs.error) ? { khongRo: true as const } : {};
    let giuLai: StepOutcome | undefined;
    if (rs.state === "compensationHeld" && step.compensation && !rc.aborting) {
      // A2(n) (S-1) — the one gate decides: approved by a Continue ⇒ sent; a latched run with no approval ⇒ split again; an unlatched run's known
      // failure, held by an edge (central unreachable) ⇒ sent as before
      const c = await congBuTru(rc, step, step.compensation, kr.khongRo ? loiCoMaKhongRo(rs.error) : rs.error);
      if (c?.kind === "held" || c?.kind === "paused") giuLai = c;
      // A2(n) — sent now: a later Continue never sends it again
      else if (kr.khongRo && rc.store.kind === "central") datTrangThaiTiepTuc(rc, step.id, { state: "doneFailed", error: rs.error, khongRo: true });
    }
    // A2(n) (m-J) — on a re-walk too: the containers' STOPs go from here, never behind a slower sibling
    if (kr.khongRo && !rc.aborting) await stopToTienMoi(rc, step, loiCoMaKhongRo(rs.error));
    if (giuLai) return giuLai;
    return { kind: "failed", error: rs.error || `Step "${step.id}" failed in an earlier segment.`, ...kr, ...(laLoiKhongGuiChot(rs.error) ? { khongGuiChot: true as const } : {}) };
  }

  // R1b-2b-2a A2(n) (I-A) — a walk under a Continue that passed n3 writes the held compensation(s) and nothing forward: a step off the way to an
  // approved step does nothing (no row, no precondition, no gate), except what was never a forward write: a command already known unknown
  // (it fails here, unsent) and a STOP already attempted (re-sent, L-7).
  const duong = duongBuTruCua(rc);
  if (duong && !quaCua && !duong.has(step.id) && outcomeUnknownOf(rc, step.id) === null && !(await coStopDaThu(rc, step))) return { kind: "skipped" };

  // A2(n) — THE DOOR: on a latched run nothing forward is entered, read or gated. What stands here is decided by ngatSauChot; a pass decides the STOPs. Only a step that may
  // already have gone out goes on, read as unknown, and the container around it, unread: their failure is what a compensation splits on.
  const cua = !duong && !quaCua && daChotKhongRo(rc) && !chuBuTruCua(rc, step.id);
  if (cua && (await dungTaiCua(rc, step))) return ngatSauChot(rc, step);

  // doc 81 Đợt 5 task E4 (item 36) + E fix 1 — on a STOP's path (a STOP step, or a container holding one) the step's own
  // bookkeeping never waits on a hung DB / device: bounded (L-7). Classified FIRST (no DB).
  const stop = await isStopCommandStep(rc, step);

  // Precondition / interlock (A2(n) I-A — a FORWARD step of a compensation-only walk is not re-read: a person has just changed what it reads.
  // (d, I-K) a step of the compensation itself IS: a reason typed on a Continue is not a reading of the door)
  const pre = cua || quaCua || (duong && !chuBuTruCua(rc, step.id)) ? null : await checkPrecondition(rc, step, stop);
  if (pre) {
    if (pre.kind === "skipped") {
      rc.settled.add(step.id); // doc 81 Đợt 6
      await stopBoundedWrite(stop, rc.runId, step.id, "skipped row", () =>
        rc.store.upsertStep(rc.runId, step.id, step.type, { status: "skipped", finishedAt: new Date() }),
      );
    } else {
      const preOutcome = pre;
      await stopBoundedWrite(stop, rc.runId, step.id, "held row", () =>
        rc.store.upsertStep(rc.runId, step.id, step.type, {
          status: preOutcome.kind === "aborted" ? "failed" : "held",
          error: "error" in preOutcome ? preOutcome.error : null,
          finishedAt: new Date(),
        }),
      );
    }
    return pre;
  }

  rc.startOrder.push(step.id); // doc 81 Đợt 6 — its compensation is due on an abort from here on
  await giuCoKhongRo(
    duong !== null,
    rc,
    step.id,
    stopBoundedWrite(stop, rc.runId, step.id, "running row", () =>
      rc.store.upsertStep(rc.runId, step.id, step.type, { status: "running", startedAt: new Date() }),
    ),
  );

  let outcome: StepOutcome;
  let attempt = 0;
  let tungKhongRo = cua && step.type === "command"; // A2(n) (M-3) — an unknown attempt stays unknown, whatever a later attempt answers; past the door, a command is one
  // doc 81 Đợt 10 C fix review 1 — a command an edge SENT but whose result its journal refused (outcome unknown, recorded by
  // central at that segment's end): NEVER sent again — it is a failure (its compensation, if any, follows as for any failure).
  const unknown = outcomeUnknownOf(rc, step.id) ?? (cua && step.type === "command" ? `command step "${step.id}" has no recorded outcome from an earlier attempt` : null);
  if (unknown !== null && !stop) {
    await chotKhongRo(rc, step, unknown); // A2(n) (S-1)
    outcome = { kind: "failed", error: unknown, khongRo: true }; // R-10-ao N2 — a STOP is never held back as "unknown"; A2(n) — khongRo
  }
  // retry loop (deterministic; only command/wait steps benefit, others run once)
  // eslint-disable-next-line no-constant-condition
  else while (true) {
    attempt += 1;
    outcome = await runStepBody(rc, step, attempt, stop);
    if (outcome.kind === "failed" && outcome.outcomeUnknown) {
      tungKhongRo = true;
      await chotKhongRo(rc, step, outcome.error); // A2(n) (S-1) — the run is latched BEFORE anything else on this path
    }
    // R1b-2b-2a T2B (backlog 78) — a NON-STOP command whose dispatch timed out (sent, outcome unknown) is NEVER sent again
    // (precedent: outcomeUnknownOf). A STOP keeps the old retry (never held back as "unknown"); a real "failed" is retried.
    // R1b-2b-2a T3F (backlog 91) — the same for a refusal meaning "the previous command with this key may be in flight or already applied"
    // (DUPLICATE_IN_FLIGHT after a crash + rebuild, …: ketCucLenhFoe sets outcomeUnknown): no further attempt, i.e. NO new attempt key.
    const khongRoChot = khongGuiLaiKhongRo(outcome, stop);
    if (khongRoChot) {
      outcome = khongRoChot;
      break;
    }
    // R1b-2b-2a T3E (backlog 90) — a NON-STOP command whose batch was applied PARTLY is NEVER sent again (the applied items would be applied twice);
    // a STOP keeps the old retry (stopping is idempotent).
    const motPhanChot = khongGuiLaiMotPhan(outcome, stop);
    if (motPhanChot) {
      outcome = motPhanChot;
      break;
    }
    // R1b-2b-2a A2(m) (+ fix round 1) — the budget is decided PER ATTEMPT from the LATEST outcome: a PINNED STOP (the central store said so
    // for THIS dispatch) with no explicit maxAttempts gets the STOP default of attempts, each after a bounded pause (stopGhimLuiMs ≤ D); an
    // attempt that was NOT pinned (pins removed meanwhile, M10 flow) gets the non-pinned budget (unset ⇒ 1 attempt, R-5-j) — never a sticky
    // default from an earlier pinned attempt. An explicit maxAttempts is kept as is (no pause, as before).
    const ghimMacDinh = outcome.kind === "failed" && outcome.stopGhim === true && step.maxAttempts === undefined;
    // A2(n) (C-B) — every step type comes through this loop: an unknown failure of a CONTAINER is never walked again (the second pass would answer a
    // known refusal and lose the flag); a STOP's own retries stay above, in its own loop
    if (outcome.kind === "failed" && (outcome.khongRo === true || outcome.khongGuiChot === true)) break; // extension — a refusal at the sink is final too
    if (outcome.kind === "failed" && daChotKhongRo(rc) && (!stop || step.type !== "command")) break; // A2(n) (C5) — nothing is walked again on a latched run; a STOP keeps its own retries
    if (outcome.kind !== "failed" || attempt >= soLanThuToiDa(step, ghimMacDinh)) break;
    if (ghimMacDinh) await sleep(stopGhimLuiMs(attempt + 1), rc.controller.signal); // an abort wakes it: the next attempt answers 'aborted'
  }
  if (outcome.kind === "failed" && outcome.stopGhim) {
    const { stopGhim: _boCo, ...conLai } = outcome;
    outcome = conLai;
  }
  // R1b-2b-2a A2(n) (I-1) — a STOP-typed step whose LAST attempt stayed unknown (it keeps its retries, so khongGuiLaiKhongRo left it): the same class
  if (outcome.kind === "failed" && (outcome.outcomeUnknown || tungKhongRo)) {
    const { outcomeUnknown: _boCo, chuaRaStop: viCuoi, ...conLai } = outcome;
    // A2(n) T5 (V-MIX) — an attempt with no answer may have gone out: what a later attempt was refused says nothing of it
    outcome = { ...conLai, ...(viCuoi ? { error: `command step "${step.id}": an earlier attempt has no answer, the last one was refused [${viCuoi.ma}]` } : {}), khongRo: true };
  }
  // A2(n) T5 (C) — the LAST attempt decides (V-MIX); a container's failure is not the state of a STOP inside it
  if (outcome.kind === "failed" && outcome.chuaRaStop && step.type !== "command") {
    const { chuaRaStop: _boCo, ...conLai } = outcome;
    outcome = conLai;
  }
  if (step.type === "command" && outcome.kind === "ok") baoStopDaDiSau(rc, step.id); // T9 (T9-CONTINUE-K1) — before its state C is cleared: it went, the earlier "did NOT go out" is replaced
  if (step.type === "command") datChuaRa(rc, step.id, outcome.kind === "failed" ? outcome.chuaRaStop : undefined);

  // doc 81 Đợt 6 — finished, or failed ON ITS OWN (an 'aborted' outcome is the abort's: the sweep decides about it). A2(n) T5 — state C is neither: an Abort and a later walk still have it to send
  if ((outcome.kind === "ok" || outcome.kind === "skipped" || outcome.kind === "failed") && !rc.chuaRaStop?.has(step.id)) rc.settled.add(step.id);
  // persist terminal step state (paused steps stay 'awaiting_confirm'/'held')
  if (outcome.kind === "ok") {
    // E4 — bounded for a STOP too, so a following STOP of the same walk is never held behind this write.
    await stopBoundedWrite(stop, rc.runId, step.id, "completed row", () =>
      rc.store.upsertStep(rc.runId, step.id, step.type, { status: "completed", attempt, finishedAt: new Date() }),
    );
  } else if (outcome.kind === "skipped") {
    await stopBoundedWrite(stop, rc.runId, step.id, "skipped row", () =>
      rc.store.upsertStep(rc.runId, step.id, step.type, { status: "skipped", attempt, finishedAt: new Date() }),
    );
  } else if (outcome.kind === "paused") {
    // step-level status already set by the body (awaiting_confirm)
    // A2(n) (C-A) — a branch failed on an unknown outcome beside the gate: this container's STOP never waits for that approval
    const loiDung = loiKhongRoRun(rc, step, outcome);
    if (loiDung !== undefined && step.compensation && !rc.aborting) await stopToTienSauGiu(rc, step, step.compensation, loiCoMaKhongRo(loiDung));
  } else if (outcome.kind === "held") {
    // doc 81 Đợt 10 C (D5) — nothing was sent: the step waits for a Continue; no compensation (it did not act).
    const heldOutcome = outcome;
    const loiGiu = loiKhongRoRun(rc, step, heldOutcome);
    const khongRoGiu = heldOutcome.reason === "outcomeUnknown" || loiGiu !== undefined;
    // T6 (S4) — a STOP of a held body that went meanwhile (stopTrongThan, from the sink's hold): its row says it went, the hold of the body is not written over it
    if (!(step.type === "command" && rc.buTruDaDi?.has(step.id))) {
      await giuCoKhongRo(
        khongRoGiu,
        rc,
        step.id,
        stopBoundedWrite(stop, rc.runId, step.id, "held row", () =>
          rc.store.upsertStep(rc.runId, step.id, step.type, { status: "held", attempt, error: heldOutcome.error, finishedAt: new Date() }),
        ),
      );
    }
    // R1b-2b-2a A2(n) (C-1) — a container behind a child held for an unknown outcome: a STOP compensation NEVER waits for a person: it goes NOW
    // (recorded by its row: the failure a later Continue brings up finds it settled); a non-STOP one stays due until that Continue
    if (khongRoGiu && step.compensation && !rc.aborting) await stopToTienSauGiu(rc, step, step.compensation, loiCoMaKhongRo(loiGiu ?? heldOutcome.error));
  } else {
    // failed / aborted → run compensation if declared (E4: a STOP's failure row is bounded too). E fix 2 (review N1) — a
    // step whose COMPENSATION holds a STOP: its failed row is on that STOP's path ⇒ bounded as well.
    const failedOutcome = outcome;
    const khongRoLoi = loiKhongRoRun(rc, step, failedOutcome); // A2(n) (C-A) — also an 'aborted' beside a branch that failed on an unknown outcome
    const khongRo = khongRoLoi !== undefined;
    if (khongRo && step.type === "command") {
      (rc.khongRoGoc ??= new Set()).add(step.id); // R-4
      // A2(n) (I-L) — told NOW, never at the walk's end (a sibling may hang for ever); a compensation around it may still be due, the text says so
      if (tungKhongRo && !step.compensation && !chuBuTruCua(rc, step.id)) baoKetCucKhongRo(rc, { loai: "noCompensation", stepId: step.id, compId: KHONG_CO_BU_TRU, error: loiCoMaKhongRo(khongRoLoi as string), lan: luotDiCua(rc) });
    }
    // A2(n) (I-1, C-C) — every unknown row says the class itself: central reads an edge run's rows at every hand-back (chotTuHang, edgeResumeStateOf)
    const loiHang = "error" in failedOutcome ? (khongRo ? loiCoMaKhongRo(failedOutcome.error) : failedOutcome.error) : null;
    const compStop = step.compensation ? await isStopCommandStep(rc, step.compensation) : false;
    // F10 — the row of a step refused at the sink is bounded like an unknown one: a hung write must not stand between the refusal and an ancestor's STOP
    await giuCoKhongRo(
      khongRo || (failedOutcome.kind === "failed" && (failedOutcome.khongGuiChot === true || failedOutcome.chuaRaStop !== undefined)),
      rc,
      step.id,
      stopBoundedWrite(stop || compStop, rc.runId, step.id, "failed row", () =>
        rc.store.upsertStep(rc.runId, step.id, step.type, {
          status: "failed",
          attempt,
          error: loiHang,
          finishedAt: new Date(),
        }),
      ),
    );
    if (rc.chuaRaStop?.has(step.id)) baoStopChuaRa(rc, step.id); // A2(n) T5 — told now, never behind a sibling: the end of the walk has no bound of its own
    // doc 80 ORC-01 — a USER abort must not dispatch anything after the abort instant, so the
    // saga compensation (which issues commands) is NOT run while the run is aborting.
    // doc 81 Đợt 6 — the abort's sweep sends the STOP compensations that are due (only those), not this walk.
    let giu: StepOutcome | undefined;
    // A2(n) extension — a command the sink refused and that no walk ever handed over: nothing of its own to undo, not even a STOP (the failure rises: the containers split theirs)
    const khongHeGui = step.type === "command" && failedOutcome.kind === "failed" && failedOutcome.khongGuiChot === true && !rc.attempted.has(step.id) && !rc.prior.attempted.has(step.id);
    // A2(n) (F11) — ... but its STOP compensation is due, and it never waits for a slower sibling
    if (khongHeGui && !rc.aborting) datStopCuaBuoc(rc, step);
    if (step.compensation && !rc.aborting && !khongHeGui) {
      const c = await congBuTru(rc, step, step.compensation, khongRoLoi !== undefined ? loiCoMaKhongRo(khongRoLoi) : loiHang ?? "");
      if (c?.kind === "held" || c?.kind === "paused") giu = c; // R-10-y — the run is held AT the compensation (Continue resumes it)
    }
    // A2(n) (I-F) — the STOP compensations of the containers around it go NOW, from the branch that decided: never behind a slower parallel sibling
    if (khongRo && step.type === "command" && !rc.aborting) await stopToTienMoi(rc, step, loiCoMaKhongRo(khongRoLoi as string));
    if (giu) return giu;
    // A2(n) (I-E) — an unknown command is never sent again by a later walk (a gate approval re-walks): central's own resume state; a STOP keeps being re-sent
    if (khongRo && !stop && step.type === "command" && rc.store.kind === "central") datTrangThaiTiepTuc(rc, step.id, { state: "doneFailed", error: loiHang ?? "", khongRo: true });
    // extension — nor is a refused one looked at again (a later row would read as handed over, and its compensation as due)
    if (khongHeGui) ghiTuChoiXong(rc, step.id, loiHang ?? "");
  }
  return outcome;
}

/** A2(n) (C-A) — the unknown failure an outcome carries: its own, or a sibling's on a paused / held / aborted one. */
function loiKhongRoCua(o: StepOutcome): string | undefined {
  if (o.kind === "failed") return o.khongRo === true ? o.error : undefined;
  return o.kind === "paused" || o.kind === "held" || o.kind === "aborted" ? o.khongRoLoi : undefined;
}

/**
 * A2(n) (a) — EVERY reader of the unknown flag: the flag an outcome carries, or else THE LATCH. An aggregator that lost the flag changes nothing: a step
 * holding what this walk (or the run's latch) decided unknown says so. `step` null: the walk as a whole (its end). A step that does not hold the unknown
 * step answers no: a sibling container that did not fail is not unknown because the run is latched.
 */
function loiKhongRoRun(rc: RunContext, step: WorkflowStep | null, o: StepOutcome): string | undefined {
  const co = loiKhongRoCua(o);
  if (co !== undefined || o.kind === "ok" || o.kind === "skipped") return co;
  if (step === null) return rc.khongRoTai?.values().next().value;
  const chot = rc.context[KET_CUC_KHONG_RO_CHOT_CTX_KEY] as { stepId?: unknown; ma?: unknown } | undefined;
  for (const x of buocTienCua(step)) {
    const loi = rc.khongRoTai?.get(x.id);
    if (loi !== undefined) return loi;
    if (chot?.stepId === x.id) return `${String(chot.ma ?? FOE_OUTCOME_UNKNOWN)}: step "${x.id}" outcome unknown (latched).`;
  }
  return undefined;
}

/** A2(n) (a) — whose compensation is this step in? null ⇔ a forward step. From the definition: no caller says so. */
function chuBuTruCua(rc: RunContext, stepId: string): ChuBuTru | null {
  if (!rc.chuBuTru) {
    rc.chuBuTru = new Map();
    for (const s of allStepsOf(rc.def.steps)) {
      if (s.compensation) for (const x of buocTienCua(s.compensation)) rc.chuBuTru.set(x.id, { step: s, comp: s.compensation });
    }
  }
  return rc.chuBuTru.get(stepId) ?? null;
}

/** A2(n) (I-A) — the steps of a compensation-only walk, from the approval a Continue recorded; null ⇔ an ordinary walk. */
function duongBuTruCua(rc: RunContext): Set<string> | null {
  if (rc.duongBuTru === undefined) {
    const v = rc.context[KHONG_RO_DUYET_CTX_KEY] as { stepIds?: unknown } | undefined;
    rc.duongBuTru = Array.isArray(v?.stepIds) && v.stepIds.length > 0 ? duongToiBuoc(rc.def.steps, new Set(v.stepIds.map(String))) : null;
  }
  return rc.duongBuTru;
}

/** A2(n) (I-A, I-B) — does this step hold a STOP already attempted and not completed? Re-sent under any walk (L-7). A step never reached is not one. */
async function coStopDaThu(rc: RunContext, step: WorkflowStep): Promise<boolean> {
  for (const x of buocTienCua(step)) {
    if (x.type === "command" && rc.prior.attempted.has(x.id) && !rc.completed.has(x.id) && (await isStopCandidate(x, rc.machineById))) return true;
  }
  return false;
}

/**
 * R1b-2b-2a A2(n) (S-1) — the sorting in front of a compensation a walk enters (the failed branch, the resume branch). It decides what can be decided at
 * the door: an unlatched run ⇒ runCompensation, as always (n6); a latched one: settled ⇒ nothing; approved by a Continue that passed n3, exactly this
 * compensation ⇒ sent, its interlock read (d, I-K), told when not confirmed (m-F); otherwise the split below. THE guarantee is not here: it is the sink at the
 * dispatch (xetCongBuTru), which a compensation admitted before the latch, and every forward step, still has to pass. The callers of runCompensation are this function,
 * guiStopKhongRo and the boot re-send of A2(m2) (rc.chiGuiStopGhim: a pinned STOP or nothing).
 */
async function congBuTru(rc: RunContext, step: WorkflowStep, comp: WorkflowStep, loi: string): Promise<StepOutcome | undefined> {
  if (!daChotKhongRo(rc)) return runCompensation(rc, step, loi);
  // a compensation already sent with no recorded result: runCompensation records its failure and never sends a non-STOP one again (R-10-ae)
  if (outcomeUnknownOf(rc, comp.id) !== null) {
    const c = await runCompensation(rc, step, loi);
    // A2(n) (m-P) — not sent again, and said so
    if (!(await isStopCommandStep(rc, comp)) && !rc.buTruKhongRoDaBao?.has(comp.id)) {
      (rc.buTruKhongRoDaBao ??= new Set()).add(comp.id);
      baoKetCucKhongRo(rc, { loai: "compensationUnknown", stepId: step.id, compId: comp.id, error: loi, lan: luotDiCua(rc) });
    }
    return c;
  }
  if (!daDuyetBuTruKhongRo(rc.context, step.id, comp.id)) return (await buTruSauKetCucKhongRo(rc, step, comp, loi)) ?? undefined;
  if (daXongBuTru(rc, comp.id)) return undefined;
  (rc.buTruDaGui ??= new Set()).add(comp.id);
  // A2(n) (d, I-K) — the interlock of the compensation a person approved is read: not sent if it fails, a person told (a known failure's path never reads a
  // compensation's own top-level precondition: n6, unchanged)
  const pre = await checkPrecondition(rc, comp);
  if (pre) {
    await giuCoKhongRo(true, rc, comp.id, rc.store.upsertStep(rc.runId, comp.id, comp.type, { status: pre.kind === "skipped" ? "skipped" : "failed", error: "error" in pre ? pre.error : null, finishedAt: new Date() }));
    baoKetCucKhongRo(rc, { loai: "approvedNotSent", stepId: step.id, compId: comp.id, error: loi, lan: luotDiCua(rc) });
    return undefined;
  }
  rc.buTruDaChay = true;
  const c = await runCompensation(rc, step, loi);
  if (c?.kind !== "ok" && c?.kind !== "held" && c?.kind !== "paused") {
    baoKetCucKhongRo(rc, { loai: buocTienCua(comp).some((x) => rc.attempted.has(x.id)) ? "approvedNotConfirmed" : "approvedNotSent", stepId: step.id, compId: comp.id, error: loi, lan: luotDiCua(rc) });
  }
  return c;
}

/**
 * R1b-2b-2a A2(n) (a) — THE SINK, read in the same tick as the hand-over to the dispatcher (execCommand). On a latched run a forward step that is not a STOP for this
 * dispatch (`laStop`) ⇒ "khongGui": not handed over (the owner's ruling; khongGuiBuocTien); a forward STOP goes, stopping never waits. A step of a compensation:
 *   • a pinned STOP (`laStop`: central's verdict for THIS dispatch, a robot stop job, the package's verified stop) ⇒ goes; "stop": it entered before the
 *     latch or inside a body, so nobody has told a person yet (the split's own STOP, rc.chiStopGhimIds, and the boot re-send report for themselves);
 *   • anything else ⇒ "giu": NOT handed over, held + URGENT, unless a Continue that passed n3 approved exactly this step + compensation.
 * Whatever the caller, the body's depth or how the compensation was admitted. null ⇔ handed over as usual. No await.
 */
function xetCongBuTru(rc: RunContext, stepId: string, laStop: boolean): { kind: "giu" | "stop"; chu: ChuBuTru } | { kind: "khongGui" } | null {
  if (!daChotKhongRo(rc)) return null;
  const chu = chuBuTruCua(rc, stepId);
  if (!chu) return laStop ? null : { kind: "khongGui" };
  if (laStop) return rc.chiGuiStopGhim || rc.chiStopGhimIds?.has(stepId) ? null : { kind: "stop", chu };
  return daDuyetBuTruKhongRo(rc.context, chu.step.id, chu.comp.id) ? null : { kind: "giu", chu };
}

/**
 * A2(n) extension — may this step have gone out already? Then it is NEVER labelled "not sent". What this walk decided (a STOP-typed step's next attempt), the latch's own step,
 * the state central derived, what the rows say (central), a step started by an earlier walk that left no last word (an edge's). A step that only failed known is not one.
 */
function ketCucRiengKhongRo(rc: RunContext, stepId: string): boolean {
  const chot = rc.context[KET_CUC_KHONG_RO_CHOT_CTX_KEY] as { stepId?: unknown } | undefined;
  return rc.khongRoTai?.has(stepId) === true || chot?.stepId === stepId || outcomeUnknownOf(rc, stepId) !== null || rc.khongRoHang?.has(stepId) === true || (rc.prior.attempted.has(stepId) && !rc.prior.settled.has(stepId));
}

/** A2(n) F10 — the report of an unused authorisation never holds a walk longer than D: a stalled journal must not stand between a refusal and the STOP behind it. Not reported ⇒ central reads the step the safe way. */
function baoKhongDungCoHan(rc: RunContext, stepId: string): Promise<void> {
  return withDeadline(rc.store.uyQuyenKhongDung?.(stepId) ?? Promise.resolve(), STOP_DB_STEP_DEADLINE_MS, `FOE run ${rc.runId} step ${stepId} unused authorisation report`).catch((err: unknown) =>
    console.warn(`[FOE] run ${rc.runId} step ${stepId}: unused authorisation not reported in time: ${(err as Error)?.message ?? err}`),
  );
}

/**
 * A2(n) extension — what the sink answers for a forward step on a latched run. Nothing is handed over, and an authorisation it holds is reported unused.
 *   • it may have gone out already (ketCucRiengKhongRo) ⇒ it STAYS unknown: outcomeUnknown, so execStep latches, words and splits it as a fresh unknown; no "not sent" anywhere;
 *   • otherwise ⇒ failed FOE_NOT_SENT_RUN_LATCHED + khongGuiChot + the audit row. No URGENT of its own: its row is the evidence the end of the walk reads (buocTienBiBo, forwardNotSent).
 */
async function khongGuiBuocTien(rc: RunContext, stepId: string, attempt: number): Promise<StepOutcome> {
  await baoKhongDungCoHan(rc, stepId);
  if (ketCucRiengKhongRo(rc, stepId)) return { kind: "failed", error: `command step "${stepId}" has no recorded outcome from an earlier attempt`, outcomeUnknown: true, khongRo: true };
  rc.store.auditAbort(rc.user, rc.runId, "notSentRunLatched", { stepId, attempt });
  return { kind: "failed", error: loiKhongGuiChot(stepId), khongGuiChot: true };
}

/** A2(n) (a) — the hold at the sink: the same hold as the split's, once per compensation; the pinned STOPs of the rest of its body still go (m-O). */
async function giuTaiCong(rc: RunContext, chu: ChuBuTru, stepId: string): Promise<StepOutcome> {
  const baoKhongDung = baoKhongDungCoHan(rc, stepId); // extension (4) — awaited last: a STOP in the rest of the body never waits on the journal
  const loi = rc.loiBuTru?.get(chu.comp.id) ?? "";
  const lan = luotDiCua(rc);
  let h: StepOutcome = { kind: "held", stepId, reason: "outcomeUnknown", error: loiGiuBuTruKhongRo(chu.step.id, chu.comp.id, loi) };
  if (!rc.buTruDaGiu?.has(chu.comp.id)) {
    (rc.buTruDaGiu ??= new Set()).add(chu.comp.id);
    h = await giuBuTruKhongRo(rc, chu.step, chu.comp, loi, lan);
    await stopTrongThan(rc, chu.step, chu.comp, loi, lan);
  }
  await baoKhongDung;
  return h;
}

/** A2(n) (m-O) — a compensation of several steps cannot be split as one: its pinned STOPs go one by one (each by the one path, one URGENT each); never waits for a person. */
async function stopTrongThan(rc: RunContext, step: WorkflowStep, comp: WorkflowStep, loi: string, lan: string): Promise<void> {
  if (comp.type === "command") return;
  await Promise.allSettled(buocTienCua(comp).map((x) => (x.type === "command" ? stopTrongBuTru(rc, step, x, loi, lan) : undefined))); // C-6 — side by side: a slow STOP holds no other
}

/** A2(n) (m-O) — one STOP inside a compensation of several steps. Handed over by nobody: its row says held, a person is told, the run holds (F2); the rest of the body is not the hold's. */
async function stopTrongBuTru(rc: RunContext, step: WorkflowStep, x: WorkflowStep, loi: string, lan: string, keHoach = false): Promise<void> {
  if (rc.aborting || daGuiHoacXong(rc, x.id, keHoach) || (await laBuTruStop(rc, x)) === "khong") return; // A2(n) T5 — unreadable goes by the marked route (THAN-DOC): never no row and nobody told
  if (!(await guiStopKhongRo(rc, { ...step, compensation: x }, x, loi, lan))) return;
  baoKetCucKhongRo(rc, { loai: "held", stepId: step.id, compId: x.id, error: loi, lan, heldStop: true }); // T9 (THAN-GIU-CONTINUE) — a STOP of a body: a Continue sends only it, no reason asked
  (rc.buTruDaGiu ??= new Set()).add(x.id);
  const giu: Extract<StepOutcome, { kind: "held" }> = { kind: "held", stepId: x.id, reason: "outcomeUnknown", error: loiGiuBuTruKhongRo(step.id, x.id, loi, true) };
  (rc.giuCon ??= new Map()).set(x.id, giu);
  rc.giuNen ??= giu;
}

// ── A2(n): after the latch ─────────────────────────────────────────────────────────────────────────────────────────────

/** A2(n) — the words of a due compensation on a latched run: the latch's, never a forward re-read. */
function loiCuaChot(rc: RunContext): string {
  const dau = rc.khongRoTai?.values().next().value;
  if (dau !== undefined) return loiCoMaKhongRo(dau);
  const c = rc.context[KET_CUC_KHONG_RO_CHOT_CTX_KEY] as { stepId?: unknown; ma?: unknown } | undefined;
  return `${String(c?.ma ?? FOE_OUTCOME_UNKNOWN)}: step "${String(c?.stepId ?? "?")}" outcome unknown (latched).`;
}

/** A2(n) (C-6) — STOP work beside the walk: started now, side by side with the rest, never behind it. finishWalk settles them. */
function chayStopNen(rc: RunContext, viec: () => Promise<unknown>): void {
  (rc.stopNen ??= []).push(
    Promise.resolve()
      .then(viec)
      .then(() => undefined, (err: unknown) => console.error(`[FOE] run ${rc.runId}: STOP work after the latch failed: ${(err as Error)?.message ?? err}`)),
  );
}

/**
 * A2(n) T6 (decision 3, H13) — the forward work a latched walk dropped, read once the STOPs have answered, from THE evidence (bangChungSauChot) over the WHOLE tree: the first command not
 * sent of every branch that was dropped: of each sequence, of each child of a parallel, of the arm a branch took (both arms of one never evaluated). Proven not sent ("chuaGui"), or nothing
 * says it started ("chuaDen"). Never a step that finished, may have gone out or keeps a known last word ("giuNguyen": a device's own error, a STOP in state C, which its own URGENT names); never
 * a stop-typed step nothing proves is no STOP (a pass owes it or lists it; the last pass's pin read that answered "not pinned" proves it, P1); never a delay or a gate; never inside a container whose own last word is known (KTB). What stands behind a gate the
 * walk pauses on, or behind a hold, is dropped all the same: an approval walks into the door, a Continue walks only compensations, a rejection walks nothing (CHO-CONG). A Continue's
 * compensation-only walk drops nothing of its own. The rows of central cannot be read: nothing can be told apart, one URGENT says so (BUOC_KHONG_XAC_DINH). [] ⇔ nothing forward was dropped.
 */
async function buocTienBiBo(rc: RunContext, src: AbortSweepSource | null): Promise<string[]> {
  if (duongBuTruCua(rc) || rc.chiGuiStopGhim) return [];
  // central raises its URGENT itself: what it cannot read it says it cannot tell. An edge's word is checked by central against the definition (baoCaoHopLe): a step id
  // that is none would be dropped there, so an edge whose read threw names from the walk's own memory, the evidence an edge has anyway (bangChungSauChot with no rows)
  if (rc.store.kind === "central" && !src?.hang) return [BUOC_KHONG_XAC_DINH];
  const nhan = bangChungSauChot(rc, src?.hang);
  const hang = new Map((src?.hang ?? []).map((r) => [r.stepId, r] as const));
  const nhanhCua = (id: string) => {
    if (src) return src.branchOf(id);
    const b = rc.context[`branch:${id}`];
    return b === "then" || b === "else" ? b : rc.prior.branches.get(id);
  };
  // a container's failure carries its children's words ("Parallel branch failed: …"): one of them the latch's is enough, the child that failed on its own keeps its row
  const laLoiCuaKhoa = (e: string | null | undefined) => typeof e === "string" && (e.includes(`${FOE_NOT_SENT_RUN_LATCHED}:`) || e.includes(`${FOE_STOP_NOT_SENT}:`) || loiLaKetCucKhongRo(e));
  // KTB — a container whose own row (an earlier segment's picture on an edge) keeps a last word that is not the latch's: what stayed unsent in it was not dropped here
  const loiRieng = (s: WorkflowStep) => {
    const r = hang.get(s.id);
    if (!r) return rc.completed.has(s.id) || (rc.prior.settled.has(s.id) && !laLoiCuaKhoa(resumeStateOf(rc, s.id)?.error));
    return r.status === "completed" || r.status === "compensated" || r.status === "skipped" || (r.status === "failed" && !laLoiCuaKhoa(r.error));
  };
  // a row an earlier walk wrote is evidence all the same: that walk may have died before its end told anyone (CRASH-BAO); a second word is the safe side
  const chuaGui = async (s: WorkflowStep) => {
    const n = nhan.get(s.id);
    // P1 — a stop-typed step whose pin read answered "not pinned" at the last pass is no STOP: dropped forward work like any other, row or no row (F4: unreadable is not this)
    // T6c (Q2, item 4) — the last hand-over of this walk, on the marked route, was answered "no pinned STOP" before any driver: nothing written, forward work dropped all the same.
    // An edge keeps no row of it (its evidence reads "may have gone out"): the answer itself is the evidence, and only the last attempt's
    if (n !== "xong" && rc.dispatcherNoiKhongGhim?.has(s.id) === true) return true;
    const bo = n === "chuaGui" || (n === "chuaDen" && (rc.khongGhimCuoi?.has(s.id) === true || !(await laStopTheoBuoc(s, rc.machineById))));
    // T9 (MAT-HET-CS, H15) — nothing says it started, on a walk after an earlier one: there is no record of whether that walk handed it over. The words say so, and name the STOP compensations the
    // containers around it declare (from the definition); nothing more is sent for it
    // Only a walk after an interruption (a boot, a Continue of an interrupted run): what an earlier walk did may be lost with its rows (H15: a database rolled back). Any other walk's own memory and rows are whole
    if (bo && n === "chuaDen" && rc.store.kind === "central" && (rc.context.interrupted === true || rc.context[INTERRUPTED_EARLIER_CTX_KEY] === true)) (rc.khongBanGhi ??= new Map()).set(s.id, await stopBuTruQuanh(rc, s.id));
    return bo;
  };
  const ten: string[] = [];
  const di = async (steps: readonly WorkflowStep[], songSong: boolean): Promise<void> => {
    let daNeu = false;
    for (const s of steps) {
      if (s.type === "command") {
        if ((songSong || !daNeu) && (await chuaGui(s))) {
          ten.push(s.id);
          daNeu = true;
        }
      } else if (s.type === "sequence" || s.type === "parallel") {
        if (!loiRieng(s)) await di(s.steps, s.type === "parallel");
      } else if (s.type === "branch" && !loiRieng(s)) {
        const nhanh = nhanhCua(s.id);
        if (nhanh !== "else") await di(s.then, false);
        if (nhanh !== "then") await di(s.else ?? [], false);
      }
    }
  };
  await di(rc.def.steps, false);
  // T6e K1 (A) — a STOP whose pin the sweep could not verify is named however its branch was named: every one, never only the first of a sequence
  for (const id of rc.khongXacMinhGhim ?? []) {
    const s = findStepDeep(rc.def.steps, id);
    if (s && !ten.includes(id) && (await chuaGui(s))) ten.push(id);
  }
  return ten;
}

/**
 * A2(n) T6 (m-P) — a compensation due on this latched run whose OWN outcome is already unknown (an earlier segment sent it with no recorded result) and that is no STOP: it is never sent
 * again, and a person is told, even when no walk entered it (its step failed in an earlier walk, the door kept that last word). Once per walk, whoever told first.
 */
async function baoBuTruKhongRoDenHan(rc: RunContext, src: AbortSweepSource | null): Promise<void> {
  // T6a (rà) — a read that threw is no reason for silence: the walk's own memory still says what is due
  for (const id of chuDenHan(rc, bangChungSauChot(rc, src?.hang))) {
    const s = findStepDeep(rc.def.steps, id);
    const comp = s?.compensation;
    if (!s || !comp || rc.buTruKhongRoDaBao?.has(comp.id) || outcomeUnknownOf(rc, comp.id) === null || (await isStopCommandStep(rc, comp))) continue;
    (rc.buTruKhongRoDaBao ??= new Set()).add(comp.id);
    baoKetCucKhongRo(rc, { loai: "compensationUnknown", stepId: s.id, compId: comp.id, error: loiCuaChot(rc), lan: luotDiCua(rc) });
  }
}

/** A2(n) (F11, I-F) — the STOP compensation of a step that never went (`stopToTienSauGiu`: a container's body too; anything else stays where it is). */
function datStopCuaBuoc(rc: RunContext, step: WorkflowStep): void {
  const comp = step.compensation;
  if (comp) chayStopNen(rc, () => stopToTienSauGiu(rc, step, comp, loiCuaChot(rc)));
}

/** A2(n) (I-F) — the first STOP pass: at the latch, or at the start of a walk that finds the run latched. Never behind a sibling, or the write of the latch. Once per walk. */
function batDauLuotStop(rc: RunContext): void {
  if (rc.luotDauStop || rc.chiGuiStopGhim) return;
  rc.luotDauStop = true;
  chayStopNen(rc, () => guiStopSauChot(rc));
}

/**
 * A2(n) — does the door stop this step? Not a non-STOP command that may already have gone out, nor a container with such a step or a resume state inside it, nor a container an earlier
 * walk began and left with no last word (F1): its row or the row of anything inside it, at any depth, says so (a row is a bounded write, it can be the one lost); a boot and an edge segment
 * have no memory of it. Its children meet the door one by one, so what was dropped gets its row and the failure its compensation splits on. A container nobody began stays out: nothing of it ran.
 */
async function dungTaiCua(rc: RunContext, step: WorkflowStep): Promise<boolean> {
  if (step.type === "command") return !ketCucRiengKhongRo(rc, step.id) || (await isStopCandidate(step, rc.machineById));
  if ((step.type === "sequence" || step.type === "parallel" || step.type === "branch") && buocTienCua(step).some((x) => rc.prior.startOrder.includes(x.id)) && !rc.prior.settled.has(step.id)) return false;
  return !buocTienCua(step).some((x) => x.id !== step.id && (resumeStateOf(rc, x.id) !== null || (x.type === "command" && ketCucRiengKhongRo(rc, x.id))));
}

/** A2(n) — what stands at the door of a latched run. No precondition, no gate, no authorisation. A stop-typed step is a pass's; a command reached is refused here, its STOP compensation goes. */
async function ngatSauChot(rc: RunContext, step: WorkflowStep): Promise<StepOutcome> {
  const error = loiKhongGuiChot(step.id);
  const tuChoi: StepOutcome = { kind: "failed", error, khongGuiChot: true };
  // T6 (H13) — what the door drops is read at the end of the walk, from the evidence over the whole tree (buocTienBiBo): nothing is listed here
  if (step.type !== "command") return tuChoi;
  if (await laStopTheoBuoc(step, rc.machineById)) { // T5 (H1) — a step nothing resolves is read by its name: the door does not write "not sent" over a STOP a pass still owes
    (rc.denCuaStop ??= new Set()).add(step.id);
    // T9 (T9-CONTINUE-K1) — its words, carried up into its containers' rows and the run's error, say the pass has it: never "not handed to a dispatcher" (a pass may hand it over)
    return { ...tuChoi, error: loiKhongGuiChotStop(step.id) };
  }
  if (rc.attempted.has(step.id) || rc.prior.settled.has(step.id)) return tuChoi; // a last word stays: a device's own error, a hand-over of this walk
  if (!rc.startOrder.includes(step.id)) rc.startOrder.push(step.id);
  datStopCuaBuoc(rc, step); // before the row: a hung write stands between nothing and this STOP
  rc.settled.add(step.id);
  rc.store.auditAbort(rc.user, rc.runId, "notSentRunLatched", { stepId: step.id, attempt: 0 });
  await giuCoKhongRo(true, rc, step.id, rc.store.upsertStep(rc.runId, step.id, step.type, { status: "failed", error, finishedAt: new Date() }));
  ghiTuChoiXong(rc, step.id, error);
  return tuChoi;
}

/** A2(n) — a refused step is not looked at again (central's resume state), unless its compensation was held meanwhile (F2): that hold is what a Continue resumes. */
function ghiTuChoiXong(rc: RunContext, stepId: string, error: string): void {
  if (rc.store.kind === "central" && resumeStateOf(rc, stepId)?.state !== "compensationHeld") datTrangThaiTiepTuc(rc, stepId, { state: "doneFailed", error });
}

/** A2(n) — the evidence on every command, from what this store has: central's rows, or an edge's package picture. */
function bangChungSauChot(rc: RunContext, hang: AbortSweepSource["hang"]): Map<string, NhanSauChot> {
  const chot = rc.context[KET_CUC_KHONG_RO_CHOT_CTX_KEY] as { stepId?: unknown } | undefined;
  const daGiao = new Set(Array.isArray(rc.context[DISPATCHED_CTX_KEY]) ? (rc.context[DISPATCHED_CTX_KEY] as unknown[]).map(String) : []);
  const by = new Map((hang ?? []).map((r) => [r.stepId, r] as const));
  const out = new Map<string, NhanSauChot>();
  for (const s of mainTreeSteps(rc.def.steps)) {
    if (s.type !== "command") continue;
    const r = by.get(s.id);
    const rs = resumeStateOf(rc, s.id);
    const status = r?.status ?? (rc.completed.has(s.id) ? "completed" : rs ? (rs.state === "outcomeUnknown" ? "running" : "failed") : rc.prior.settled.has(s.id) ? "failed" : rc.prior.attempted.has(s.id) ? "running" : rc.prior.startOrder.includes(s.id) ? "held" : null);
    out.set(
      s.id,
      nhanBuocSauChot({
        status,
        error: r?.error ?? rs?.error ?? null,
        routedTo: typeof (r?.resultJson as { routedTo?: unknown } | null | undefined)?.routedTo === "string",
        khongRo: chot?.stepId === s.id || rc.khongRoTai?.has(s.id) === true || outcomeUnknownOf(rc, s.id) !== null || rs?.khongRo === true,
        daGiao: daGiao.has(s.id) || rc.attempted.has(s.id),
        uyQuyenSong: false,
        khongXacNhan: dauKhongXacNhan(r?.resultJson) !== null,
      }),
    );
  }
  return out;
}

/**
 * A2(n) — whose compensation is due on a latched run. At the latch (`nhan` null): the unknown step's and the containers' around it. At the end: also a failure, what may have gone out,
 * a refused step (F11).
 */
function chuDenHan(rc: RunContext, nhan: ReadonlyMap<string, NhanSauChot> | null): Set<string> {
  const chot = rc.context[KET_CUC_KHONG_RO_CHOT_CTX_KEY] as { stepId?: unknown } | undefined;
  const den = (id: string) => rc.khongRoTai?.has(id) === true || chot?.stepId === id || (nhan !== null && ["coTheDaGui", "giuNguyen", "chuaGui"].includes(nhan.get(id) ?? ""));
  const out = new Set<string>();
  for (const s of mainTreeSteps(rc.def.steps)) if (buocTienCua(s).some((x) => den(x.id))) out.add(s.id);
  return out;
}

/**
 * A2(n) (A2) — THE planner of a latched run: what is due, for the walker (`nguoi` absent) and for an Abort (`nguoi`). The Abort differs in one thing: a person may send again what was
 * never confirmed (G), so nothing is "this walk's own" and a hand-over with no read-back is not settled.
 */
async function lapKeHoachStop(rc: RunContext, src: AbortSweepSource, v: StopVerification, cuoi: boolean, nguoi?: { xacNhan: (id: string) => boolean; daGiao: (id: string) => boolean; daDinh: ReadonlySet<string> }): Promise<AbortPlan> {
  // Q-5 — a verified STOP left running has no last word, with or without a dispatcher result
  const hong = new Set((src.hang ?? []).filter((r) => r.status === "failed" || (r.status === "running" && v.ids.has(r.stepId))).map((r) => r.stepId));
  // this walk's own: handed over here, its unknown, a pass has it. A compensation entered is not one (F3): a STOP behind a failed step of its body is due all the same, and a STOP the body
  // and a pass reach together has one hand-over (stopDangGiao); one that went to the hold did not walk at all (chặn 4)
  const tuLuotNay = (id: string) => rc.attempted.has(id) || rc.khongRoTai?.has(id) === true || rc.diStop?.has(id) === true || rc.buTruDaGui?.has(id) === true;
  // a STOP that failed in an EARLIER walk is due again; one of this walk had its attempts. A row is the last word when there is one; on an edge the rest is its package's picture
  const coHang = new Set((src.hang ?? []).map((r) => r.stepId));
  const hongTruoc = (id: string) => (coHang.has(id) || rc.store.kind === "central" ? hong.has(id) : rc.prior.settled.has(id) && !rc.completed.has(id) && !chuBuTruCua(rc, id));
  const settled = nguoi ? (id: string) => src.settled(id) && !hongTruoc(id) && !(nguoi.daGiao(id) && !nguoi.xacNhan(id)) : (id: string) => tuLuotNay(id) || (src.settled(id) && !hongTruoc(id));
  return planAbortSweep({ ...src, settled, sentBefore: nguoi ? new Set([...src.sentBefore].filter(nguoi.xacNhan)) : src.sentBefore }, rc.def, v, { chuDenHan: chuDenHan(rc, cuoi ? bangChungSauChot(rc, src.hang) : null) }, nguoi?.daDinh);
}

/** A2(n) — a forward STOP goes by the walker's own step: its rows, its retries, its key. Past the door, once per walk. */
async function diStopTien(rc: RunContext, s: WorkflowStep): Promise<void> {
  if (rc.diStop?.has(s.id) || rc.aborting) return;
  (rc.diStop ??= new Set()).add(s.id);
  await execStep(rc, s, true);
}

/** A2(n) — one STOP of a pass: a forward one by its step, a compensation by the split's own unit, on the split's own predicate (the verifier of the sweep can disagree with it). */
function guiMotStop(rc: RunContext, s: WorkflowStep, loi: string): Promise<void> {
  const chu = chuBuTruCua(rc, s.id);
  if (!chu) return diStopTien(rc, s);
  return chu.comp.id === s.id ? stopToTienSauGiu(rc, chu.step, s, loi, true) : stopTrongBuTru(rc, chu.step, s, loi, luotDiCua(rc), true);
}

/**
 * A2(n) — one STOP pass: every STOP still due, by the planner, side by side (C-6): a slow STOP holds no other. `cuoi`: the pass at the end of the walk, whose evidence is whole: it
 * also says what stays unsent. A second pass finds nothing left.
 */
async function guiStopSauChot(rc: RunContext, cuoi = false): Promise<void> {
  if (rc.aborting) return;
  const src = await rc.store.sweepSource({ live: rc, hasLiveDriver: () => true });
  if (!src) return;
  const v = await rc.store.verifyStops(rc.runId, rc.def, rc.machineById);
  const plan = await lapKeHoachStop(rc, src, v, cuoi);
  const loi = loiCuaChot(rc);
  const viec = plan.send.map((s) => guiMotStop(rc, s, loi));
  // what the sweep's verifier could not tell: a forward one still has its own authorisation and the sink, a compensation the split's predicate. T5 (H1) — a step nothing resolves goes too: its row says why
  for (const id of plan.unverified) {
    const s = findStepDeep(rc.def.steps, id);
    if (s?.type === "command" && (await laStopTheoBuoc(s, rc.machineById))) viec.push(guiMotStop(rc, s, loi));
  }
  // T5 (C-3) — the verifier cannot tell "read: not pinned" from "no adapter to read": sorted again here, the shared verifier unchanged, after the STOPs above have started. Only a read that answered is "not pinned"
  const xep = await Promise.all(
    plan.notPinned.map(async (id) => {
      const s = findStepDeep(rc.def.steps, id);
      return { id, s, la: s ? await laBuTruStop(rc, s) : ("khong" as const) };
    }),
  );
  plan.notPinned = xep.filter((x) => x.la !== "chuaDoc").map((x) => x.id);
  // T6e K1 (A) — "stop" too: the verifier read no pin, the dispatcher's predicate says one (two moments). Still not sent (no direction B here): named, every one, as a STOP not verified
  if (cuoi) rc.khongXacMinhGhim = new Set(rc.store.kind === "central" ? xep.filter((x) => x.la === "stop").map((x) => x.id) : []);
  if (cuoi) rc.khongGhimCuoi = new Set([...xep.filter((x) => x.la === "khong" || rc.khongXacMinhGhim?.has(x.id) === true).map((x) => x.id), ...plan.notPinnedUntaken]); // P1 — the end of the walk names them; an unreadable pin goes by the marked route (F4). T6c (Q1) — and a branch never evaluated: never sent, named
  for (const x of xep) if (x.la === "chuaDoc" && x.s) viec.push(guiMotStop(rc, x.s, loi));
  if (cuoi) {
    if (plan.untakenBranch.length) rc.store.auditAbort(rc.user, rc.runId, "abortStopSkippedUntakenBranch", { stepIds: plan.untakenBranch, latched: true });
    if (plan.notPinned.length) rc.store.auditAbort(rc.user, rc.runId, "abortStopNotPinned", { stepIds: plan.notPinned, latched: true });
    for (const id of plan.untakenBranch) baoNhanhChuaChon(rc, id, loi);
    for (const id of plan.notPinned) {
      const chuaRa = rc.chuaRaStop?.has(id) === true || src.chuaRa?.has(id) === true; // T5 (C-CLR) — the read answered: not a STOP. Nothing is owed any more, a person gets out of the hold
      if (!rc.denCuaStop?.has(id) && !chuaRa) continue;
      const vi = rc.chuaRaStop?.get(id) ?? viChuaRaCuaLoi((src.hang ?? []).find((r) => r.stepId === id)?.error);
      datChuaRa(rc, id, undefined);
      // read, not a STOP: not sent. One that may already have gone out never reads so; a row in state C says itself whether it did (an earlier walk's unsettled row is not "no last word")
      const coTheDaRa = chuaRa ? vi?.nguon === "driverLoi" || rc.stopCoTheRa?.has(id) === true : ketCucRiengKhongRo(rc, id);
      const error = coTheDaRa ? loiCoMaKhongRo(`command step "${id}" has no recorded outcome from an earlier attempt`) : loiKhongGuiChot(id);
      await giuCoKhongRo(true, rc, id, rc.store.upsertStep(rc.runId, id, "command", { status: "failed", error, finishedAt: new Date() }));
    }
  }
  await Promise.allSettled(viec);
}

/** A2(n) T9 (MAT-HET-CS, H15) — the STOP compensations the containers around `id` declare, innermost first, read from the definition (a compensation of several steps: its STOP-typed commands). */
async function stopBuTruQuanh(rc: RunContext, id: string): Promise<string[]> {
  const out: string[] = [];
  for (const hop of toTienCua(rc.def.steps, id)) {
    const c = hop.compensation;
    if (!c) continue;
    for (const x of c.type === "command" ? [c] : buocTienCua(c)) if (x.type === "command" && !out.includes(x.id) && (await isStopCandidate(x, rc.machineById).catch(() => false))) out.push(x.id);
  }
  return out;
}

/** A2(n) T6 (H13) — forward work dropped, one URGENT per branch dropped, what rc.khongGuiDs names. T7b-1d (H25) — the walk's end and an Abort: `lan` is the event of the key; once per step per walk. */
function baoBuocTienBiBo(rc: RunContext, lan: string): void {
  for (const id of rc.khongGuiDs ?? []) {
    if (rc.khongGuiDaBao?.has(id)) continue;
    (rc.khongGuiDaBao ??= new Set()).add(id);
    const ma = rc.dispatcherNoiKhongGhim?.get(id); // T6c — handed over and answered "no pinned STOP": not "NOT handed to a dispatcher" (H11)
    const banGhi = ma === undefined && !rc.khongXacMinhGhim?.has(id) ? rc.khongBanGhi?.get(id) : undefined; // T9 (MAT-HET-CS) — no record of an earlier hand-over
    baoKetCucKhongRo(rc, { loai: "forwardNotSent", stepId: id, compId: KHONG_CO_BU_TRU, error: loiKhongGuiChot(id), lan, ...(ma !== undefined ? { vi: { nguon: "tuChoi" as const, ma } } : {}), ...(rc.khongXacMinhGhim?.has(id) ? { stopKhongXacMinh: true as const } : {}), ...(banGhi ? { khongBanGhi: true as const, stopBuTru: banGhi } : {}) });
  }
}

/**
 * A2(n) T7b-1d (H25, H13) — an Abort of a latched run says what the walk would have said at its end, from the same reading (the planner's list, buocTienBiBo): a STOP in a branch never evaluated, the forward work dropped.
 * What cannot be determined is told (buocTienBiBo). `tien` false: only the first. Never a command; nothing of a STOP's path waits on it.
 */
async function baoH13KhiAbort(rc: RunContext, src: AbortSweepSource | null, plan: Pick<AbortPlan, "untakenBranch" | "notPinned" | "notPinnedUntaken">, tien: boolean): Promise<void> {
  const loi = loiCuaChot(rc);
  for (const id of plan.untakenBranch) baoNhanhChuaChon(rc, id, loi);
  if (!tien) return;
  rc.khongGhimCuoi = new Set([...(rc.khongGhimCuoi ?? []), ...plan.notPinned, ...plan.notPinnedUntaken]);
  rc.khongGuiDs = await buocTienBiBo(rc, src);
  baoBuocTienBiBo(rc, "abort");
}

/** A2(n) (M1) — a STOP in a branch never evaluated is listed, never sent. One URGENT per STOP, under the fixed event. No word on the walk's own report (R-4): it says nothing of an unknown step. */
function baoNhanhChuaChon(rc: RunContext, stepId: string, loi: string): void {
  if (rc.nhanhDaBao?.has(stepId)) return;
  (rc.nhanhDaBao ??= new Set()).add(stepId);
  try {
    giuBao(rc, rc.store.ketCucKhongRo?.(rc, { loai: "stopUntakenBranch", stepId, compId: KHONG_CO_BU_TRU, error: loi, lan: "chot" }));
  } catch (err) {
    console.error(`[FOE] run ${rc.runId}: untaken branch report failed: ${(err as Error)?.message ?? err}`);
  }
}

/** A2(n) — the end of a latched walk: what is running settles, then one pass with the whole evidence. Nothing forward is read. A compensation held beside the walk holds the run (F2): a failure that arrived before or after that hold does not end it. */
async function duongKetThuc(rc: RunContext, out: StepOutcome): Promise<StepOutcome> {
  // H-TREO — a hand-over that hangs holds back no other STOP: past the bound the last pass runs all the same
  await withDeadline(Promise.allSettled(rc.stopNen ?? []), STOP_CHO_TRUOC_LUOT_CUOI_MS, `FOE run ${rc.runId} STOPs before the last pass`).catch((err: unknown) => console.warn(`[FOE] run ${rc.runId}: the last STOP pass goes on: ${(err as Error)?.message ?? err}`));
  await guiStopSauChot(rc, true).catch((err: unknown) => console.error(`[FOE] run ${rc.runId}: final STOP pass failed: ${(err as Error)?.message ?? err}`));
  await Promise.allSettled(rc.stopNen ?? []);
  await vaoChuaRaTuTruocKhoa(rc);
  // T6 (H13) — ONE reading of the evidence once every STOP has answered and its row is written: what was dropped, what is owed, what is due
  const src = await rc.store.sweepSource({ live: rc, hasLiveDriver: () => true }).catch(() => null);
  rc.khongGuiDs = await buocTienBiBo(rc, src);
  await baoBuTruKhongRoDenHan(rc, src);
  const ket = await goGiuDaDi(rc, out);
  const giuChuaRa = await giuStopChuaRa(rc, src);
  if (rc.giuNen && (ket.kind === "failed" || ket.kind === "ok" || ket.kind === "skipped")) return rc.giuNen;
  return giuChuaRa && ket.kind !== "paused" && ket.kind !== "held" ? giuChuaRa : ket; // a gate a person still answers comes back here
}

/** A2(n) T5 (H-TREO) — how long the end of a walk waits for the STOPs under way before its last pass. */
export const STOP_CHO_TRUOC_LUOT_CUOI_MS = 5 * STOP_DB_STEP_DEADLINE_MS;

/** A2(n) T5 — set or clear the state C of a STOP. Bound by the last word: undefined clears it. */
function datChuaRa(rc: RunContext, id: string, vi: ViChuaRa | undefined): void {
  if (vi) (rc.chuaRaStop ??= new Map()).set(id, vi);
  else rc.chuaRaStop?.delete(id);
  // T7b-1 (no-cho-T7b, DUYỆT) — the same list in the run's context, persisted with it (the end gate's `held` write too): a row in state C is a bounded write and may be the one lost. Central's walk only
  if (rc.store.kind !== "central") return;
  const co = stopChuaRaTuNguCanh(rc.context);
  if (vi && !co.includes(id)) rc.context[STOP_CHUA_RA_CTX_KEY] = [...co, id];
  else if (!vi && co.includes(id)) {
    const con = co.filter((x) => x !== id);
    if (con.length) rc.context[STOP_CHUA_RA_CTX_KEY] = con;
    else delete rc.context[STOP_CHUA_RA_CTX_KEY];
  }
}

/** A2(n) T5 — the one URGENT of a STOP in state C, under the fixed event: a forward STOP in its own name, a compensation's under its owner. Never awaited on a STOP's path. Once per walk. */
function baoStopChuaRa(rc: RunContext, id: string, vi = rc.chuaRaStop?.get(id)): void {
  if (rc.chuaRaDaBao?.has(id)) return;
  (rc.chuaRaDaBao ??= new Set()).add(id);
  const chu = chuBuTruCua(rc, id);
  const stepId = chu ? chu.step.id : id;
  baoKetCucKhongRo(rc, { loai: "stopNotSent", stepId, compId: chu ? id : KHONG_CO_BU_TRU, error: loiCuaChot(rc), lan: "chot", ...(ketCucRiengKhongRo(rc, stepId) && chu ? {} : { biet: true }), ...(vi ? { vi } : {}), ...cachChuaRa(rc, id) });
}

/** A2(n) T9 — how the words of a debt read it: no STOP at all (T9-CHU-NO-GIA), or pins nobody verified (T7B1-NOTPINNED). One reading for the URGENT and the run's error. */
function cachChuaRa(rc: RunContext, id: string): { khongStop?: true; chuaXacMinh?: true } {
  if (rc.khongStopNo?.has(id)) return { khongStop: true };
  return rc.danhDauGiao?.has(id) ? { chuaXacMinh: true } : {};
}

/**
 * A2(n) T9 (T9-CONTINUE-K1, no-cho-T9) — a STOP an earlier URGENT called NOT gone and owed (state C: this walk's, or the context's list of an earlier walk) went now, accepted: the words that replace that URGENT,
 * under this walk's event. Central only: an edge's report carries no such word (central's own walk is the one that told it). Once per walk; never awaited.
 */
function baoStopDaDiSau(rc: RunContext, id: string): void {
  if (rc.store.kind !== "central" || rc.stopDaDiDaBao?.has(id)) return;
  if (!rc.chuaRaDaBao?.has(id) && !stopChuaRaTuNguCanh(rc.context).includes(id)) return;
  (rc.stopDaDiDaBao ??= new Set()).add(id);
  const chu = chuBuTruCua(rc, id);
  baoKetCucKhongRo(rc, { loai: "stopNotSent", stepId: chu ? chu.step.id : id, compId: chu ? id : KHONG_CO_BU_TRU, error: loiCuaChot(rc), lan: luotDiCua(rc), biet: true, thayCu: "chuaRa", ...(rc.giaoMoPhong?.has(id) ? { moPhong: true as const } : {}) }); // lượt sửa 1 (R-2) — simulated: never "went"
}

/** A2(n) T6d (E-C6) — the one URGENT of a verified STOP the edge snapshot refused as not pinned: a forward STOP in its own name, a compensation's under its owner. Once per walk; the key is durable. */
function baoGhimLechChuaGui(rc: RunContext, id: string): void {
  if (rc.ghimLechDaBao?.has(id)) return;
  (rc.ghimLechDaBao ??= new Set()).add(id);
  const chu = chuBuTruCua(rc, id);
  baoKetCucKhongRo(rc, { loai: "stopGhimLechChuaGui", stepId: chu ? chu.step.id : id, compId: chu ? id : KHONG_CO_BU_TRU, error: loiCuaChot(rc), lan: "chot", biet: true });
}

/** A2(n) T5 (H1, race) — refused before the latch: to the planner it is this walk's own, on its row a plain failure. It did not go out and it is not sent again here: state C, a person's Abort sends it. */
async function vaoChuaRaTuTruocKhoa(rc: RunContext): Promise<void> {
  for (const [id, t] of rc.stopTuChoiTruocKhoa ?? []) {
    const s = findStepDeep(rc.def.steps, id);
    if (!s) continue;
    datChuaRa(rc, id, t.vi);
    rc.settled.delete(id);
    await giuCoKhongRo(true, rc, id, rc.store.upsertStep(rc.runId, id, s.type, { status: "failed", attempt: t.attempt, error: loiChuaRaStop(id, t.attempt, t.vi), finishedAt: new Date() }));
  }
  rc.stopTuChoiTruocKhoa?.clear();
}

/** A2(n) T9 lượt sửa 1 (R-1) — the source of a row's dispatcher answer when its text carries none (a refused attempt left `running`, laHangChuaRa): the same reading as the walk's (nguonCuaKetQua). */
function viTuKetQuaHang(r: { error?: string | null; resultJson?: unknown } | undefined): ViChuaRa | undefined {
  const kq = (r?.resultJson ?? null) as { routedTo?: unknown; status?: unknown; detail?: unknown } | null;
  if (!kq || typeof kq.routedTo !== "string") return undefined;
  const ma = maTuChoiCua({ error: r?.error ?? null, status: typeof kq.status === "string" ? kq.status : null, detail: (kq.detail ?? null) as { reason?: unknown } | null });
  return { nguon: nguonCuaKetQua(String(kq.status), ma, kq.routedTo === "robot-dispatcher"), ma };
}

/** A2(n) T5 (H1) — a STOP that stays owed, this walk's or a row's: told by name, the run held so an Abort can send it. */
async function giuStopChuaRa(rc: RunContext, src: AbortSweepSource | null): Promise<StepOutcome | undefined> {
  let giu: StepOutcome | undefined;
  for (const id of new Set([...(rc.chuaRaStop?.keys() ?? []), ...(src?.chuaRa ?? [])])) {
    let vi = rc.chuaRaStop?.get(id) ?? viChuaRaCuaLoi((src?.hang ?? []).find((r) => r.stepId === id)?.error);
    // T9 (T9-CHU-NO-GIA) — a debt the rows hold of a step the definition does not make a STOP (its refused attempt is its row's last word): words only, the debt stays as read
    const s = findStepDeep(rc.def.steps, id);
    if (!rc.chuaRaStop?.has(id) && s && !(await isStopCandidate(s, rc.machineById).catch(() => true))) {
      (rc.khongStopNo ??= new Set()).add(id); // a step the definition does not hold: the old words
      // lượt sửa 1 (R-1) — its row carries no code: the source is the dispatcher's answer on it (laHangChuaRa: refused, no answer of the "may have flown" kind), read by the same rule as any row
      vi ??= viTuKetQuaHang((src?.hang ?? []).find((r) => r.stepId === id));
    }
    baoStopChuaRa(rc, id, vi);
    giu ??= { kind: "held", stepId: id, reason: "outcomeUnknown", error: loiGiuChuaRa(id, vi, cachChuaRa(rc, id)) };
  }
  return giu;
}

/**
 * A2(n) (R5) — a hold whose STOP went at a later pass of this walk ends with it, by what really came back: confirmed, or handed over (an answer that confirms nothing, or none at the last
 * attempt, T6 H14) and told in a durable URGENT (H2). Nothing is sent again. It did not go (state C), or nothing durable: the hold stands. T6 (S4) — the hold of a compensation of several
 * steps ends when every command of its body went so. A hold the walk returned gives way to its failure only if no container around it still owes a compensation. T6 (S3) — a hold
 * lifted never names the run while another one stands.
 */
async function goGiuDaDi(rc: RunContext, out: StepOutcome): Promise<StepOutcome> {
  const daDi = new Map<string, boolean>();
  const di = async (id: string): Promise<boolean> => {
    if (!daDi.has(id)) {
      const chuan = rc.buTruDaDi?.get(id);
      daDi.set(id, chuan ? await withDeadline(chuan, 5 * STOP_DB_STEP_DEADLINE_MS, `FOE run ${rc.runId} URGENT of ${id}`).catch(() => false) : false);
    }
    return daDi.get(id) === true;
  };
  const go = new Set<string>();
  for (const id of [...(rc.buTruDaGiu ?? [])]) {
    const s = findStepDeep(rc.def.steps, id);
    const lenh = s && s.type !== "command" ? buocTienCua(s).filter((x) => x.type === "command").map((x) => x.id) : [id];
    let het = lenh.length > 0;
    for (const x of lenh) if (!(await di(x))) het = false;
    if (het && rc.buTruDaGiu?.delete(id)) go.add(id);
  }
  if (!go.size) return out;
  const dung = [...(rc.giuCon?.values() ?? [])].find((g) => rc.buTruDaGiu?.has(g.stepId));
  if (dung || !rc.buTruDaGiu?.size) rc.giuNen = dung; // a hold no record names keeps the old words: they still hold the run
  if (out.kind !== "held" || out.reason !== "outcomeUnknown" || !go.has(out.stepId)) return out;
  if (rc.buTruDaGiu?.size) return rc.giuNen ?? out;
  const chu = chuBuTruCua(rc, out.stepId);
  const conNo = chu !== null && toTienCua(rc.def.steps, chu.step.id).some((h) => h.compensation && !daXongBuTru(rc, h.compensation.id));
  return conNo ? out : { kind: "failed", error: loiCuaChot(rc) };
}

/** A2(n) (S-1) — is the run latched? This walk decided an unknown outcome, or its context says so. */
function daChotKhongRo(rc: RunContext): boolean {
  return rc.khongRoChot === true || rc.khongRoChotHang === true || runDaChotKhongRo(rc.context);
}

/**
 * A2(n) T7 — THE end gate of every end of a run (plan point 3, finding 10: one decision, one source). A live central walk brings its picture: the rows read now (bounded), and beside them what its
 * memory holds (its latch, the STOPs it left owed, the answers of the URGENTs it raised); every other end brings the database's picture (docAnhKetThuc). The decision is
 * foeRunStore.quyetDinhKetThucAnh, the edge segment end's too. Confirmation (XAC_NHAN, decision 3) joins it there at T9.
 */
async function quyetDinhKetThuc(x: { rc: RunContext; chiDoi?: boolean } | AnhKetThuc, lyDo: LyDoKetThuc, hanMs?: number): Promise<KetQuaKetThuc> {
  if (!("rc" in x)) return quyetDinhKetThucAnh(x, lyDo, hanMs);
  const rc = x.rc;
  const src = await rc.store.sweepSource({ live: rc, hasLiveDriver: () => true }).catch(() => null);
  return quyetDinhKetThucAnh({ runId: rc.runId, ctx: rc.context, owner: rc.runOwner, rows: src?.hang ?? null, def: rc.def, boNho: boNhoCua(rc), chiDoi: x.chiDoi }, lyDo, hanMs);
}

/** A2(n) T7 — what a live walk holds beside the rows: the first unknown it decided, the STOPs it left owed, the answers of its URGENTs. */
function boNhoCua(rc: RunContext): NonNullable<AnhKetThuc["boNho"]> {
  const dau = rc.khongRoTai ? [...rc.khongRoTai][0] : undefined;
  return { chot: dau ? { stepId: dau[0], ma: maKetCucKhongRoCua(dau[1]) } : null, chuaRa: [...(rc.chuaRaStop?.keys() ?? [])], baoCho: rc.baoCho ?? [], viCua: (id) => rc.chuaRaStop?.get(id), cachCua: (id) => cachChuaRa(rc, id), khongRo: [...(rc.khongRoTai?.keys() ?? [])], boTien: (rc.khongGuiDs?.length ?? 0) > 0 };
}

/** A2(n) T7 — what the database shows of a run for an end with no walk to ask: its context, owner and step rows, bounded by D. null ⇔ not read: never "not latched". */
async function docAnhKetThuc(runId: number): Promise<AnhKetThuc | null> {
  try {
    return await withDeadline(
      (async () => {
        const d = await getDb();
        if (!d) throw new DbUnavailableError();
        const [run] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
        if (!run) return null;
        const rows = await d.select().from(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, runId));
        return { runId, ctx: (run.contextJson as Record<string, unknown> | null) ?? {}, owner: run.startedBy ?? null, rows };
      })(),
      STOP_DB_STEP_DEADLINE_MS,
      `FOE run ${runId} end-of-run read`,
    );
  } catch (err) {
    console.error(`[FOE] run ${runId}: end-of-run read failed: ${(err as Error)?.message ?? err}`);
    return null;
  }
}

/**
 * A2(n) T7 (C1, R3-A) — a walker threw (the last status write, a context write …). Not latched, nothing owed, nothing marked: 'failed' as ever. A STOP owed, no durable URGENT, or the run unread: held +
 * interrupted, so an Abort still sends what is owed. T7 lượt sửa 1 (K1) — the rows AND the walk in hand (`live`: its latch, the STOPs it left owed, the answers of its URGENTs): the row of a STOP in
 * state C is a bounded write and may be the one lost, with the same database trouble that broke the last write. Answers the status written ('aborted' ⇔ an Abort got there first).
 */
async function ketThucNgoaiLe(runId: number, message: string, live?: RunContext | null): Promise<"failed" | "held" | "aborted"> {
  const doc = await docAnhKetThuc(runId);
  const anh: AnhKetThuc | null = doc && live ? { ...doc, ctx: { ...doc.ctx, ...live.context }, def: live.def, boNho: boNhoCua(live) } : doc;
  const q = anh ? await quyetDinhKetThuc(anh, "exception") : null;
  const daBao = q?.moi && q.chot ? { [KET_CUC_KHONG_RO_DA_BAO_CTX_KEY]: { stepId: q.chot.stepId, at: new Date().toISOString() } } : {};
  if (!q || q.ghi === "held") {
    const at = new Date().toISOString();
    const loi = q?.loi ?? loiGiuChuaDocHang(runId, null);
    // data-raw-ok: the run's error: the gate's words (code first), then the walker's own error text
    const ok = await setRunStatusUnlessAborted(runId, "held", { currentStepId: null, error: `${loi} [${message.slice(0, 300)}]`, ...(anh ? { contextJson: { ...anh.ctx, interrupted: true, interruptedAt: at, interruptedFrom: "exception", ...daBao } } : {}) }).catch(() => true);
    return ok ? "held" : "aborted";
  }
  const ok = await setRunStatusUnlessAborted(runId, "failed", { finishedAt: new Date(), error: message, ...(anh && Object.keys(daBao).length ? { contextJson: { ...anh.ctx, ...daBao } } : {}) }).catch(() => true);
  quenBenKhongXacNhan(runId); // T7 lượt sửa 1 (c) — an end through the gate: the marks' answers of this run are no one's any more
  return ok ? "failed" : "aborted";
}

/** A2(n) T7 — DA_BAO on a run that may already be ended: a context-only write (no status guard reads it), bounded by D, best-effort. A live walk carries it in its own context too. */
async function ghiDaBao(runId: number, chot: { stepId: string }, live?: RunContext | null): Promise<void> {
  const dau = { stepId: chot.stepId, at: new Date().toISOString() };
  if (live) live.context[KET_CUC_KHONG_RO_DA_BAO_CTX_KEY] = dau;
  await withDeadline(
    (async () => {
      const d = await getDb();
      if (!d) return;
      const [run] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
      if (run) await d.update(orchestrationRuns).set({ contextJson: { ...((run.contextJson as Record<string, unknown> | null) ?? {}), [KET_CUC_KHONG_RO_DA_BAO_CTX_KEY]: dau } }).where(eq(orchestrationRuns.id, runId));
    })(),
    STOP_DB_STEP_DEADLINE_MS,
    `FOE run ${runId} DA_BAO`,
  ).catch((err: unknown) => console.error(`[FOE] run ${runId}: DA_BAO not written: ${(err as Error)?.message ?? err}`));
}

/**
 * A2(n) T7 (decision B) — an Abort, or a person's gate rejection, ends a run whatever its URGENT did. Its status is written and its STOP sweep has run: then ONE try of the URGENT, bounded by D, and an
 * audit row (foe_outcome_unknown_abort), written even when that try landed. Neither holds anything back; a failure of either leaves the obligation (no DA_BAO) for the scan (T12). A run not latched
 * and with no marked row, or whose latch was already durably told: nothing here.
 */
async function nghiaVuKetThucNguoi(runId: number, user: FoeUser, lyDo: "abort" | "gateRejected", x: { live?: RunContext | null; ctx0: Record<string, unknown>; owner: number | null; stops: AbortStopReport; reason?: string | null }): Promise<void> {
  try {
    const doc = await docAnhKetThuc(runId);
    const ctx = { ...(doc?.ctx ?? x.ctx0), ...(x.live?.context ?? {}) };
    const daBen = ctx[KET_CUC_KHONG_RO_DA_BAO_CTX_KEY] != null;
    const anh: AnhKetThuc = { runId, ctx, owner: doc?.owner ?? x.owner, rows: doc?.rows ?? null, def: x.live?.def ?? null, ...(x.live ? { boNho: { ...boNhoCua(x.live), chuaRa: [] } } : {}) };
    const q = await quyetDinhKetThuc(anh, lyDo, STOP_DB_STEP_DEADLINE_MS);
    if (!((q.chot !== null && !daBen) || q.khongXacNhan.length > 0)) return;
    if (q.moi && q.chot) await ghiDaBao(runId, q.chot, x.live);
    const rows = anh.rows ?? [];
    await ghiAuditKetCucKhongRo(user, runId, "abort", {
      via: lyDo === "abort" ? "heldNoDurableUrgent" : "gateRejectedNoDurableUrgent",
      latchStepId: q.chot?.stepId ?? null,
      ma: q.chot?.ma ?? null,
      khongRoStepIds: rows.filter((r) => !r.stepId.startsWith("abort:") && loiLaKetCucKhongRo(r.error)).map((r) => r.stepId),
      forwardDropped: rows.find((r) => laLoiKhongGuiChot(r.error))?.stepId ?? null,
      khongXacNhan: q.khongXacNhan,
      urgentDurable: q.urgentBen,
      recipients: q.nguoiNhan ?? null,
      stopSweep: { sent: x.stops.sent.length, failed: x.stops.failed.length, unverified: x.stops.unverified.length, untakenBranch: x.stops.untakenBranch },
      reason: x.reason?.trim() || null,
      humanDecision: Number.isSafeInteger(user.id) && user.id > 0,
    });
  } catch (err) {
    console.error(`[FOE] run ${runId}: end-of-run obligation not recorded: ${(err as Error)?.message ?? err}`);
  } finally {
    quenBenKhongXacNhan(runId); // T7 lượt sửa 1 (c) — ended by a person
  }
}

/**
 * A2(n) (S-1, b) — latch the run, the moment an unknown outcome is decided, before anything else on that path; the flag is set in one tick, so a command is
 * either in rc.dangGui now (handed over before the latch: it cannot be recalled, it is reported, c) or sees the latch at the sink. Durable at once:
 *   • central: the latch in the run's context (a failed or slow write leaves the in-memory flag, and the row keeps the code: khongRoChotHang);
 *   • edge: no database, and an edge context patch can never carry it, so the STEP ROW says it, now (the journal, then central): central derives the latch from
 *     the rows at every hand-back (chotTuHang) and /authorize reads them too;
 *   • the boot re-send (m-L): the compensation's own row, under its nonce (runCompensation): this walk must not overwrite a context a person may be changing.
 */
async function chotKhongRo(rc: RunContext, step: WorkflowStep, loi: string): Promise<void> {
  (rc.khongRoTai ??= new Map()).set(step.id, loi);
  const dau = !rc.khongRoChot;
  rc.khongRoChot = true;
  if (dau) baoDangBay(rc, step.id, loi);
  if (rc.chiGuiStopGhim) return;
  batDauLuotStop(rc); // A2(n) (I-F)
  if (rc.store.kind !== "central") {
    await giuCoKhongRo(true, rc, step.id, rc.store.upsertStep(rc.runId, step.id, step.type, { status: "running", error: loiCoMaKhongRo(loi) }));
    return;
  }
  if (!dau) return;
  rc.context[KET_CUC_KHONG_RO_CHOT_CTX_KEY] = { stepId: step.id, ma: maKetCucKhongRoCua(loi), at: new Date().toISOString() };
  await giuCoKhongRo(true, rc, step.id, rc.store.persistContext(rc));
}

/** A2(n) (c) — a non-STOP write already handed to a dispatcher when the run latched cannot be recalled: it leaves a trace (URGENT + audit row, foeKetCucKhongRo). */
function baoDangBay(rc: RunContext, stepId: string, loi: string): void {
  for (const [id, laStop] of rc.dangGui ?? []) {
    if (!laStop && id !== stepId) baoKetCucKhongRo(rc, { loai: "inFlight", stepId, compId: id, error: loiCoMaKhongRo(loi), lan: luotDiCua(rc) });
  }
}

function daXongBuTru(rc: RunContext, compId: string): boolean {
  return rc.prior.settled.has(compId) || rc.buTruDaGui?.has(compId) === true;
}

/**
 * A2(n) T5 — `keHoach`: the planner has this compensation due: a known failure of an earlier walk is no last word for a STOP (C-TRUOC, nobody told otherwise). One that may have gone out still is:
 * it is never sent again here (F7, F8). Sent in this walk is, whoever asks.
 */
function daGuiHoacXong(rc: RunContext, compId: string, keHoach: boolean): boolean {
  return keHoach && !rc.khongRoHang?.has(compId) ? rc.buTruDaGui?.has(compId) === true : daXongBuTru(rc, compId);
}

/** A2(n) (I-F) — the containers around `step`, innermost first: each STOP compensation goes at once. A non-STOP one stays for the failure to reach it. */
async function stopToTienMoi(rc: RunContext, step: WorkflowStep, loi: string): Promise<void> {
  for (const hop of toTienCua(rc.def.steps, step.id)) {
    if (hop.compensation && !rc.aborting) await stopToTienSauGiu(rc, hop, hop.compensation, loi);
  }
}

/**
 * R1b-2b-2a A2(n) (n1, n2) — the split of a latched run's compensation `comp` of `step`:
 *   • already settled in an earlier walk, or sent in this one (a STOP that went behind a held child — C-1; a result on its row) ⇒ never sent again;
 *   • a STOP (rc.store.buTruLaStopGhim: OT pinned / robot stop job) ⇒ sent NOW (guiStopKhongRo) — the step's failure goes on (null: the caller
 *     returns it — the run fails as before and the containers around it split their own compensations);
 *   • anything else, a classification that cannot be made, or a "pinned" one the dispatch did not authorise as one ⇒ NOTHING is sent: the
 *     compensation row `held`, the run held (resume state compensationHeld for `step` + the A2(n) marker, central only — an edge run's
 *     resume state is derived from its rows), URGENT "… waiting for a person".
 */
async function buTruSauKetCucKhongRo(rc: RunContext, step: WorkflowStep, comp: WorkflowStep, loi: string): Promise<StepOutcome | null> {
  if (daXongBuTru(rc, comp.id)) {
    rc.khongRoDaBao = true; // R-4 — it was split and told when it went
    return null;
  }
  if (rc.buTruDaGiu?.has(comp.id)) return { kind: "held", stepId: comp.id, reason: "outcomeUnknown", error: loiGiuBuTruKhongRo(step.id, comp.id, loi) }; // F2 — a pass held it first: told, written
  const lan = luotDiCua(rc);
  if ((await laBuTruStop(rc, comp)) !== "khong") {
    if (!(await guiStopKhongRo(rc, step, comp, loi, lan))) return null;
    // the dispatch did not authorise it as a pinned STOP (nothing handed over): held like any other compensation
  }
  await stopTrongThan(rc, step, comp, loi, lan); // m-O
  return giuBuTruKhongRo(rc, step, comp, loi, lan);
}

/**
 * A2(n) (C-1) — the compensation of a CONTAINER whose child is held for an unknown outcome: settled ⇒ nothing; a STOP ⇒ sent now, the run stays
 * held for the child; any other ⇒ nothing now (it stays due: the failure a Continue brings up splits it).
 */
async function stopToTienSauGiu(rc: RunContext, step: WorkflowStep, comp: WorkflowStep, loi: string, keHoach = false): Promise<void> {
  if (daGuiHoacXong(rc, comp.id, keHoach)) return;
  if (comp.type !== "command") return stopTrongThan(rc, step, comp, loi, luotDiCua(rc)); // m-O
  if ((await laBuTruStop(rc, comp)) === "khong") return;
  const lan = luotDiCua(rc);
  if (!(await guiStopKhongRo(rc, step, comp, loi, lan)) || rc.buTruDaGiu?.has(comp.id)) return;
  const giu = (await giuBuTruKhongRo(rc, step, comp, loi, lan)) as Extract<StepOutcome, { kind: "held" }>; // F2 — not handed over: the run is held for it, its failure may already have gone by
  rc.giuNen ??= giu;
}

function luotDiCua(rc: RunContext): string {
  return (rc.luotDi ??= `${new Date().toISOString()}#${randomBytes(4).toString("hex")}`);
}

async function laBuTruStop(rc: RunContext, comp: WorkflowStep): Promise<LaStop> {
  try {
    return rc.store.buTruLaStopGhim ? await rc.store.buTruLaStopGhim(rc, comp) : "khong";
  } catch {
    // dieu-phoi 08/11 T6d-K2 — a check that throws does not unmake an answer the store already has: an edge's package that READ the pins and found none says "not pinned" (F4 A is for
    // pins nobody could read). Not sent, never the marked route; the end of the walk names it as forward work (P1, khongGhimCuoi)
    if (rc.store.stopDocDuocKhongGhim?.(comp.id) === true) return "khong";
    return (await isStopCandidate(comp, rc.machineById).catch(() => false)) ? "chuaDoc" : "khong"; // A2(n) T5 (C-2) — a read that failed is no answer: not "not a STOP" (decision 2, A). A non-STOP stays out
  }
}

/**
 * A2(n) T5 (H1, C2) — ONE layer around a command, not one `return`: on a latched run a stop-typed step that failed with a clear answer, or with none it could wait for, is state C: it did not go, or may
 * not have, and stays owed. Whatever said so: the dispatcher, a throw, a machine or a command that cannot be resolved, a policy, an authorisation refused. Before the latch it is remembered: if the run
 * latches after all, duongKetThuc puts it in state C. Not here: a non-STOP; a read that answered "not pinned" (tt.khongGhim: no_pins, E-C5, E-C6); no answer (the last attempt decides, V-MIX); the boot's own
 * re-send, which keeps its rule (T10). No list of codes, no condition on pins: a robot has none. `tt.vi` is the only word that leaves (a code).
 */
async function lopChuaRa(rc: RunContext, step: Extract<WorkflowStep, { type: "command" }>, attempt: number, tt: ThongTinLenh, o: StepOutcome): Promise<StepOutcome> {
  if (o.kind === "failed" && o.chuaRaStop) return o; // the inner ask of a stop-typed step asking twice
  if (o.kind !== "failed" || o.outcomeUnknown === true || o.khongRo === true || o.khongGuiChot === true || rc.chiGuiStopGhim || tt.khongGhim) {
    rc.stopTuChoiTruocKhoa?.delete(step.id);
    return o;
  }
  if (!tt.vi || !(await laStopTheoBuoc(step, rc.machineById))) return o;
  // H17 — one way: an attempt that may have gone out stays so, whatever a later attempt was refused. The last attempt decides the state (V-MIX), never these words
  if (tt.vi.nguon === "driverLoi" && !rc.stopCoTheRa?.has(step.id)) (rc.stopCoTheRa ??= new Map()).set(step.id, tt.vi.ma);
  const maRa = rc.stopCoTheRa?.get(step.id);
  const vi: ViChuaRa = maRa !== undefined ? { nguon: "driverLoi", ma: maRa } : tt.vi;
  if (!daChotKhongRo(rc)) {
    (rc.stopTuChoiTruocKhoa ??= new Map()).set(step.id, { attempt, vi });
    return o;
  }
  rc.stopTuChoiTruocKhoa?.delete(step.id);
  // an OT STOP keeps a pinned STOP's budget, -a1..a3; a robot STOP its own: state C adds no attempt
  const c = commandOf(step, rc.machineById);
  return { kind: "failed", error: loiChuaRaStop(step.id, attempt, vi), chuaRaStop: vi, ...(c && !isRobotKind(c.cap.adapterKind) ? { stopGhim: true as const } : {}) };
}

/** A2(n) T5 — what the layer needs from the attempt: why it failed; `khongGhim`: a read answered and this is no pinned STOP. */
interface ThongTinLenh {
  vi?: ViChuaRa;
  khongGhim?: boolean;
}

/**
 * A2(n) — send a STOP compensation by the engine's own path (runCompensation → execCommand → the store's authorisation → equipmentRegistry → the
 * dispatcher, every gate; an OT one handed over only if the central store authorises it as a pinned STOP for that dispatch, rc.chiStopGhimIds),
 * then the URGENT in words that are true (I-3, m-1). Raised after the dispatch, never awaited: it never delays a STOP. true ⇔ NOT handed over
 * because the dispatch did not see a STOP (the caller treats it as held; no URGENT here).
 */
async function guiStopKhongRo(rc: RunContext, step: WorkflowStep, comp: WorkflowStep, loi: string, lan: string): Promise<boolean> {
  if (rc.buTruDaGui?.has(comp.id)) return false; // a concurrent branch reached this container first (checked and marked in one tick)
  (rc.chiStopGhimIds ??= new Set()).add(comp.id);
  (rc.buTruDaGui ??= new Set()).add(comp.id);
  const daGiuTruoc = rc.buTruDaGiu?.has(comp.id) === true;
  let c: StepOutcome | undefined;
  try {
    // A2(n) T5 (C) — runCompensation runs a body once: state C keeps a STOP's budget here, -a1, -a2 …; a robot STOP its own. Nothing else is ever retried here
    const soLan = soLanThuToiDa(comp, !laRobot(rc, comp));
    for (let thu = 1; ; thu++) {
      c = await runCompensation(rc, step, loi, { attempt: thu });
      if (!rc.chuaRaStop?.has(comp.id) || thu >= soLan || rc.aborting) break;
      await sleep(stopGhimLuiMs(thu + 1), rc.controller.signal);
    }
  } finally {
    rc.chiStopGhimIds.delete(comp.id);
  }
  if (c?.kind === "held") {
    rc.buTruDaGui.delete(comp.id); // not handed over: still due
    return true;
  }
  if (rc.chuaRaStop?.has(comp.id)) {
    baoStopChuaRa(rc, comp.id);
    return false;
  }
  const loaiDi = loaiGuiStop(rc, comp.id, c);
  // T9 (HELD-CU) — an earlier URGENT of this walk said it was held and NOT sent: the words of its hand-over replace that one
  const thayGiu = daGiuTruoc && loaiDi !== "stopNotHanded"; // handed to its dispatcher: sent, simulated or not confirmed
  const ben = baoKetCucKhongRo(rc, { loai: loaiDi, stepId: step.id, compId: comp.id, error: loi, lan, ...(thayGiu ? { thayCu: "giu" as const } : {}) });
  // R5 — it went: confirmed ends a hold by itself, handed over only with a durable URGENT (H2; an edge's durable word is central's, at its segment end).
  // T6 (H14) — no answer at the last attempt went too: handed over, not confirmed. Only state C (above) did not go
  const khongTraLoi = c?.kind === "failed" && (c.outcomeUnknown === true || c.khongRo === true) && rc.attempted.has(comp.id);
  // T6a (rà) — an edge has no durable word of its own: an answer it got stands for central's at the segment end, no answer does not (that hold stays for central's end gate)
  if (c?.kind === "ok" || khongTraLoi) (rc.buTruDaDi ??= new Map()).set(comp.id, rc.ketQuaBuTru?.get(comp.id)?.xacNhan === true || (rc.store.kind !== "central" && !khongTraLoi) ? Promise.resolve(true) : rc.store.kind !== "central" ? Promise.resolve(false) : (ben ?? Promise.resolve(false)));
  return false;
}

function laRobot(rc: RunContext, s: WorkflowStep): boolean {
  const c = commandOf(s, rc.machineById);
  return c !== null && isRobotKind(c.cap.adapterKind);
}

function loaiGuiStop(rc: RunContext, compId: string, c: StepOutcome | undefined): LoaiCanhBaoKhongRo {
  const kq = rc.ketQuaBuTru?.get(compId);
  if (kq?.simulated) return "stopSimulated";
  if (c?.kind === "ok" && kq?.accepted) return "stopSent";
  return rc.attempted.has(compId) ? "stopNotConfirmed" : "stopNotHanded";
}

/** R1b-2b-2a A2(n) — hold the run at `comp` (nothing sent). See buTruSauKetCucKhongRo. The URGENT goes FIRST and a failed row write never loses the hold (I-2). */
async function giuBuTruKhongRo(rc: RunContext, step: WorkflowStep, comp: WorkflowStep, loi: string, lan: string): Promise<StepOutcome> {
  const error = loiGiuBuTruKhongRo(step.id, comp.id, loi);
  (rc.buTruDaGiu ??= new Set()).add(comp.id); // the planner: a compensation held walked nothing of itself
  baoKetCucKhongRo(rc, { loai: "held", stepId: step.id, compId: comp.id, error: loi, lan });
  if (rc.store.kind === "central") {
    // central's own resume state + marker (persisted with the context when the walk ends held); an edge run's are central's to derive
    datTrangThaiTiepTuc(rc, step.id, { state: "compensationHeld", error: loi, khongRo: true });
    const truoc = dauKetCucKhongRoCua(rc.context)?.ds ?? [];
    rc.context[KET_CUC_KHONG_RO_CTX_KEY] = { stepId: step.id, compId: comp.id, ma: maKetCucKhongRoCua(loi), at: new Date().toISOString(), lan, ds: [...truoc, { stepId: step.id, compId: comp.id }] };
  }
  await giuCoKhongRo(true, rc, comp.id, rc.store.upsertStep(rc.runId, comp.id, comp.type, { status: "held", error, finishedAt: new Date() }));
  const giu: Extract<StepOutcome, { kind: "held" }> = { kind: "held", stepId: comp.id, reason: "outcomeUnknown", error };
  (rc.giuCon ??= new Map()).set(comp.id, giu); // T6 (S3) — the words of this hold, should another one be lifted
  return giu;
}

/**
 * A2(n) (I-2, I-C) — a row write on the unknown path: a throw must not lose the flag (a parent's catch would turn it into a KNOWN failure, whose
 * compensation runs) and a hung DB must not hold up an ancestor's STOP or the URGENT: bounded by D, like the rest of a STOP's path.
 */
async function giuCoKhongRo(khongRo: boolean, rc: RunContext, stepId: string, ghi: Promise<void>): Promise<void> {
  if (!khongRo) return ghi;
  await withDeadline(ghi, STOP_DB_STEP_DEADLINE_MS, `FOE run ${rc.runId} step ${stepId} row on the outcome-unknown path`).catch((err: unknown) =>
    console.error(`[FOE] run ${rc.runId} step ${stepId}: row write failed on the outcome-unknown path — the run still splits: ${(err as Error)?.message ?? err}`),
  );
}

/** R1b-2b-2a A2(n) — the store's report (central: URGENT alert; edge: anomaly). Never throws, never awaited on a STOP's path. Central answers whether it landed. */
function baoKetCucKhongRo(rc: RunContext, a: Parameters<NonNullable<RunStore["ketCucKhongRo"]>>[1]): Promise<boolean> | undefined {
  rc.khongRoDaBao = true;
  try {
    // m-K — a failure whose own outcome is KNOWN, on a latched run: the words say so
    return giuBao(rc, rc.store.ketCucKhongRo?.(rc, loiLaKetCucKhongRo(a.error) ? a : { ...a, biet: true }) ?? undefined);
  } catch (err) {
    console.error(`[FOE] run ${rc.runId}: outcome-unknown report failed: ${(err as Error)?.message ?? err}`);
    return undefined;
  }
}

/** A2(n) T7 — an URGENT's answer, kept for the end gate (rc.baoCho). Never rejects. */
function giuBao(rc: RunContext, p: Promise<boolean> | void | undefined): Promise<boolean> | undefined {
  if (!p) return undefined;
  const q = p.catch(() => false);
  (rc.baoCho ??= []).push(q);
  return q;
}

/** R1b-2b-2a A2(n) — set the central-written resume state of one step in the walk's context (persisted with it). */
function datTrangThaiTiepTuc(rc: RunContext, stepId: string, v: ResumeStateMap[string]): void {
  const prior = (rc.context[RESUME_STATE_CTX_KEY] as ResumeStateMap | undefined) ?? {};
  rc.context[RESUME_STATE_CTX_KEY] = { ...prior, [stepId]: v };
}

/** doc 81 Đợt 10 C fix review 1 — run-context key (central-written at an edge segment end): steps whose outcome is unknown. */
export const OUTCOME_UNKNOWN_CTX_KEY = "foeOutcomeUnknown";

/** fix review 2 (R-10-ae) — the central-written resume state of a step (see edgeResumeStateOf); null on a fresh / central run. */
function resumeStateOf(rc: RunContext, stepId: string): { state: string; error: string; khongRo: boolean } | null {
  const m = rc.context[RESUME_STATE_CTX_KEY] as Record<string, unknown> | undefined;
  const e = m && typeof m === "object" ? (m[stepId] as { state?: unknown; error?: unknown; khongRo?: unknown } | undefined) : undefined;
  // R1b-2b-2a A2(n) — khongRo: the step failed on an UNKNOWN outcome
  return e && typeof e.state === "string" ? { state: e.state, error: typeof e.error === "string" ? e.error : "", khongRo: e.khongRo === true } : null;
}
function outcomeUnknownOf(rc: RunContext, stepId: string): string | null {
  const rs = resumeStateOf(rc, stepId);
  if (rs?.state === "outcomeUnknown") return rs.error;
  const l = rc.context[OUTCOME_UNKNOWN_CTX_KEY];
  // data-raw-ok: the step error is a machine-readable code (EDGE_OUTCOME_UNKNOWN) — never re-sent
  return Array.isArray(l) && l.includes(stepId) ? `EDGE_OUTCOME_UNKNOWN: command step "${stepId}" was sent by the edge node but its result was not recorded — it is NOT sent again; check the equipment.` : null;
}

/**
 * R1b-2b-2a T2B / T3F — the outcome a NON-STOP step ends on after an attempt whose outcome is UNKNOWN (`outcomeUnknown`: the dispatch timed out,
 * or the dispatcher refused because the previous command with the same key / authorisation may be in flight or already applied):
 * FOE_OUTCOME_UNKNOWN, no further attempt (no new attempt key); null otherwise (a STOP keeps its retry; a plain failure ⇒ the loop decides as before).
 * Pure (exported for the crash-rebuild DB test).
 */
export function khongGuiLaiKhongRo(outcome: StepOutcome, stop: boolean): StepOutcome | null {
  if (stop || outcome.kind !== "failed" || !outcome.outcomeUnknown) return null;
  return { kind: "failed", error: `${FOE_OUTCOME_UNKNOWN}: ${outcome.error} — not sent again; check the device.`, khongRo: true }; // A2(n) — khongRo
}

/**
 * R1b-2b-2a T3E — the outcome a NON-STOP step ends on after an attempt whose batch was applied PARTLY (`failed` + motPhan): FOE_OUTCOME_PARTIAL,
 * no further attempt; null otherwise (a STOP, or not partial ⇒ the retry loop decides as before). Pure (exported for the ledger-replay DB test).
 */
export function khongGuiLaiMotPhan(outcome: StepOutcome, stop: boolean): StepOutcome | null {
  if (stop || outcome.kind !== "failed" || !outcome.motPhan) return null;
  return { kind: "failed", error: `${FOE_OUTCOME_PARTIAL}: ${moTaMotPhan(outcome.motPhan)}.` };
}

/**
 * The StepOutcome of a command a dispatcher answered (the end of execCommand; pure, exported for the ledger-replay DB test):
 * ok ⇒ ok; `timeout` ⇒ failed + outcomeUnknown (T2B: T2's rule wins over partial); a "may be in flight / already applied" refusal
 * (`coTheDaBayCua`: DUPLICATE_IN_FLIGHT, …) ⇒ failed + outcomeUnknown (T3F); `failed` + detail.motPhan ⇒ failed + motPhan (T3E); else failed.
 */
export function ketCucLenhFoe(result: EquipmentCommandResult, command: string): StepOutcome {
  if (result.ok) return { kind: "ok" };
  const error = result.error ?? `Command "${command}" rejected (${result.status}).`;
  if (result.status === "timeout") return { kind: "failed", error, outcomeUnknown: true };
  // R1b-2b-2a T3F (backlog 91) — "the previous command may be in flight or already applied" (DUPLICATE_IN_FLIGHT, …) ⇒ outcome UNKNOWN, like timeout
  const daBay = coTheDaBayCua(result);
  if (daBay) return { kind: "failed", error: moTaCoTheDaBay(daBay, command), outcomeUnknown: true };
  const motPhan = motPhanCua(result.detail?.motPhan);
  return motPhan ? { kind: "failed", error, motPhan } : { kind: "failed", error };
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
        const duongNhanh = duongBuTruCua(rc); // A2(n) (I-A) — a compensation-only walk reads no condition: it goes to the approved step
        let take: boolean;
        if (prior === "then" || prior === "else") {
          take = prior === "then";
        } else if (duongNhanh?.has(step.id)) {
          take = step.then.some((s) => duongNhanh.has(s.id));
        } else {
          await stopBoundedReadbacks(stop, rc, step.id, step.condition); // E fix 1 — bounded when a STOP is inside
          take = evaluateCondition(step.condition, evalCtxOf(rc));
          rc.context[`branch:${step.id}`] = take ? "then" : "else";
        }
        await stopBoundedWrite(stop, rc.runId, step.id, "branch row", () =>
          rc.store.upsertStep(rc.runId, step.id, step.type, {
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
        await rc.store.upsertStep(rc.runId, step.id, step.type, {
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
    return await stopClassifierProbe(d);
  } catch {
    return false;
  }
}

/**
 * doc 81 Đợt 7 task I4 (Đợt 5 re-review M-1) — the STOP classifier's own dependencies, exercised the SAME way
 * foeStepClass.makeStopVerifier uses them: its two lazy modules (the OT dispatcher's classifyOtStop +
 * runningConnectionMatchesAdapterRow, stopPin's stopPinsFromTagRows) and its two batch query shapes (enabled adapters of
 * machines; enabled + writable stop-pin tags of adapters). When the classification of an existing run fails AS A WHOLE
 * (a module that does not load, a batch shape that fails), a missing id is now as undecided as that run — the same
 * "scope not verified" answer, not "not found" (no existence oracle). false (or a rejection) on any failure.
 */
async function stopClassifierProbe(d: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<boolean> {
  const [disp, pin] = await Promise.all([napDispatcher(), import("../../ot/stopPin")]);
  if (typeof disp.classifyOtStop !== "function" || typeof disp.runningConnectionMatchesAdapterRow !== "function" || typeof pin.stopPinsFromTagRows !== "function") {
    return false; // the classifier cannot run ⇒ the probe fails (undecided), like a failed read
  }
  await Promise.all([
    d.select().from(deviceAdapters).where(and(inArray(deviceAdapters.machineId, [-1]), eq(deviceAdapters.isEnabled, true))).limit(1),
    d
      .select({
        adapterId: deviceTags.adapterId,
        tagKey: deviceTags.tagKey,
        dataType: deviceTags.dataType,
        stopValue: deviceTags.stopValue,
        writable: deviceTags.writable,
        isEnabled: deviceTags.isEnabled,
      })
      .from(deviceTags)
      .where(and(inArray(deviceTags.adapterId, [-1]), eq(deviceTags.isEnabled, true), eq(deviceTags.writable, true)))
      .limit(1),
  ]);
  return true;
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
    // doc 81 Đợt 7 task I3 — the definitions of the versions the run EXECUTED (runVisibilityDefinitions); none usable ⇒ "out"
    // (only an unrestricted scope sees it). Every version must be "in"; any decided "out" ⇒ "out"; else any doubt ⇒ "unknown".
    const [defs] = await runVisibilityDefinitions(d, [run ?? { workflowId: -1, paramsJson: null }]);
    let verdict: ScopeDecision = defs && defs.length ? "in" : "out";
    for (const def of defs ?? []) {
      const v = await decideDefinition(judge, def);
      if (v === "out") {
        verdict = "out";
        break;
      }
      if (v === "unknown") verdict = "unknown";
    }
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
    const { logCrudOperation, createAuditContext } = await napAudit();
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
    const rows = await d
      .select({ id: orchestrationRuns.id, workflowId: orchestrationRuns.workflowId, paramsJson: orchestrationRuns.paramsJson })
      .from(orchestrationRuns)
      .where(inArray(orchestrationRuns.id, runIds));
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
): Promise<{ keep: T[]; failed: boolean; unknown: T[] }> {
  if (judge.unrestricted && !judge.failed) return { keep: items, failed: false, unknown: [] };
  const defs = items.map(defOf);
  const ids = new Set<number>();
  for (const d of defs) if (d && Array.isArray(d.steps)) for (const id of validateWorkflow(d, null).referencedMachineIds) ids.add(id);
  const machineMap = await loadMachines([...ids]);
  const verifier = await makeStopVerifier((await getDb()) ?? null, defs.filter((d): d is WorkflowDefinition => !!d && Array.isArray(d.steps)), machineMap);
  const keep: T[] = [];
  const unknown: T[] = []; // final wave F3 (R-7-d) — the undecided items, for callers that must not read them as "not visible"
  let failed = judge.failed;
  for (let i = 0; i < items.length; i++) {
    const d = defs[i];
    if (!d || !Array.isArray(d.steps)) continue;
    // final wave F3 — only a DECIDED "in" is kept; an undecided definition (out only because a pinned STOP's connection is
    // not confirmed, or a lookup failed) is left out AND marks the result `failed` (the hub shows degraded). A definition
    // that is in scope is no longer marked failed just because one of ITS OWN stops could not be verified.
    const verdict = await decideDefinition(judge, d, machineMap, verifier);
    if (verdict === "in") keep.push(items[i]);
    else if (verdict === "unknown") {
      failed = true;
      unknown.push(items[i]);
    }
  }
  return { keep, failed: failed || judge.failed, unknown };
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
    const visible = await runVisibleTo(run ?? { workflowId: -1, paramsJson: null }, scope); // I3 — the executed versions
    return !!run && visible;
  } catch {
    return false;
  }
}

/**
 * doc 81 Đợt 7 task I3 — the DEFINITIONS that decide whether each run is visible: the versions it EXECUTED
 * (foeGateApproval.runExecutedVersions — the head row when it is that version, else the version snapshot). Per run:
 *   • a run that carries no record (started before Đợt 7) ⇒ [the head definition] — the pre-Đợt-7 rule;
 *   • ★ CANNOT DECIDE — the workflow row is gone, or a recorded version has no snapshot (a snapshot write that failed) ⇒
 *     `null`: the run is visible ONLY to an unrestricted scope (fail-closed), answered "not found" to everyone else.
 * ONE read of the heads and ONE of the snapshots for the whole batch. Throws on a DB error (callers fail closed).
 */
export async function runVisibilityDefinitions(
  d: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  runs: ReadonlyArray<{ workflowId: number; paramsJson?: unknown }>,
): Promise<Array<WorkflowDefinition[] | null>> {
  const ids = [...new Set(runs.map((r) => r.workflowId))];
  if (ids.length === 0) return [];
  // final wave F8 — explicit columns (no "scopeKey"): the abort / reject scope decision must survive a missing 0367 (L-7)
  const heads = await d.select(WF_CORE_COLS).from(orchestrationWorkflows).where(inArray(orchestrationWorkflows.id, ids));
  const headById = new Map(heads.map((w) => [w.id, w] as const));
  const needSnapshots = runs.some((r) => {
    const vs = runExecutedVersions(r);
    const h = headById.get(r.workflowId);
    return !!vs && !!h && vs.some((v) => v !== h.version);
  });
  const snaps = needSnapshots
    ? await d
        .select({ workflowId: orchestrationWorkflowVersions.workflowId, version: orchestrationWorkflowVersions.version, definitionJson: orchestrationWorkflowVersions.definitionJson })
        .from(orchestrationWorkflowVersions)
        .where(inArray(orchestrationWorkflowVersions.workflowId, ids))
    : [];
  const usable = (x: unknown): WorkflowDefinition | null => {
    const def = x as WorkflowDefinition | null | undefined;
    return def && Array.isArray(def.steps) ? def : null;
  };
  return runs.map((r) => {
    const head = headById.get(r.workflowId);
    if (!head) return null;
    const headDef = usable(head.definitionJson);
    const versions = runExecutedVersions(r);
    if (!versions) return headDef ? [headDef] : null;
    const defs: WorkflowDefinition[] = [];
    for (const v of versions) {
      const def = v === head.version ? headDef : usable(snaps.find((s) => s.workflowId === r.workflowId && s.version === v)?.definitionJson);
      if (!def) return null;
      defs.push(def);
    }
    return defs;
  });
}

/**
 * doc 81 Đợt 7 task I3 — the runs a judge may see, and whether some decision was undecided (`failed` — the hub shows
 * degraded): a run is kept only when EVERY definition it executed is decided "in" (one machine load + one verifier for
 * the batch). A lookup error ⇒ nothing kept, failed.
 */
async function filterRunsVisibleWith<T extends { workflowId: number; paramsJson?: unknown }>(
  judge: Awaited<ReturnType<typeof makeScopeJudge>>,
  runs: T[],
): Promise<{ keep: T[]; failed: boolean }> {
  if (judge.unrestricted && !judge.failed) return { keep: runs, failed: false };
  if (runs.length === 0) return { keep: runs, failed: judge.failed };
  const d = await getDb();
  if (!d) return { keep: [], failed: true };
  const defsPer = await runVisibilityDefinitions(d, runs);
  const flat: Array<{ i: number; def: WorkflowDefinition }> = [];
  defsPer.forEach((defs, i) => (defs ?? []).forEach((def) => flat.push({ i, def })));
  const r = await filterVisibleWith(judge, flat, (x) => x.def);
  const kept = new Set(r.keep);
  const keep = runs.filter((_, i) => {
    const mine = flat.filter((x) => x.i === i);
    return defsPer[i] !== null && mine.length > 0 && mine.every((x) => kept.has(x));
  });
  return { keep, failed: r.failed || judge.failed };
}

/**
 * doc 81 Đợt 5 task E2 fix — the runs (of any list) `scope` may see. doc 81 Đợt 7 task I3 — by the definition VERSIONS each
 * run executed (runVisibilityDefinitions), no longer by the workflow's current head. Any error ⇒ [] (fail-closed).
 */
export async function filterRunsVisibleTo<T extends { workflowId: number; paramsJson: unknown }>(runs: T[], scope: FoeScope): Promise<T[]> {
  if (runs.length === 0) return runs;
  try {
    return (await filterRunsVisibleWith(await makeScopeJudge(scope), runs)).keep;
  } catch {
    return [];
  }
}

/**
 * doc 81 Đợt 5 task E2 — is this run visible to `scope`? doc 81 Đợt 7 task I3 — by the versions it executed (its
 * `paramsJson` record); `paramsJson: null` = no record ⇒ the workflow's head (also how a version / workflow-level caller
 * asks about the head). DB error ⇒ false.
 */
export async function runVisibleTo(run: { workflowId: number; paramsJson: unknown }, scope: FoeScope): Promise<boolean> {
  try {
    return (await filterRunsVisibleTo([run], scope)).length === 1;
  } catch {
    return false;
  }
}

/**
 * doc 81 Đợt 7 I fix 1 (review M-5 + security scan "resource-cap-removal-dos") — HARD bounds of every run-list call:
 *   • RUN_SCOPE_MAX_DEFINITIONS — at most this many workflow definitions (heads first, then the newest version snapshots) are
 *     JUDGED per call (one machine load + one batched stop verifier for all of them). More exist ⇒ the runs of the versions
 *     left out are not shown and the answer says `truncated` (fail-closed: never shown on a guess).
 *   • RUN_LIST_MAX_LIMIT — the largest page; the scope filter runs IN SQL before LIMIT (no in-memory filtering of runs).
 *   • RUN_PENDING_MAX — the most pending runs the hub / "mine" takes per call; more ⇒ degraded (not a silent subset).
 */
export const RUN_SCOPE_MAX_DEFINITIONS = 2000;
export const RUN_LIST_MAX_LIMIT = 500;
export const RUN_PENDING_MAX = 2000;

/** For tests: what the last runVisibilitySql call judged (bounded-work measurement). */
export const lastRunVisibilityStats = { definitionsRead: 0, definitionsJudged: 0, truncated: false };

/**
 * doc 81 Đợt 7 I fix 1 — the SQL predicate "this run is visible to `scope`" by the definition VERSIONS it executed (the same
 * rule as runVisibilityDefinitions / filterRunsVisibleTo, computed ONCE per call over a bounded set of definitions):
 *   • a run with no version record (legacy) ⇒ its workflow's HEAD must be decided "in";
 *   • a recorded run ⇒ EVERY recorded version (workflowId:version) must be decided "in" (a non-number element, a version not
 *     judged — snapshot missing, or beyond RUN_SCOPE_MAX_DEFINITIONS — ⇒ hidden).
 * `where` undefined ⇔ unrestricted. A failed scope resolution ⇒ FALSE (nothing) + failed. Never throws on a judge failure;
 * a DB error throws (callers fail closed).
 */
export async function runVisibilitySql(
  d: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  scope: FoeScope,
): Promise<{ where: SQL | undefined; truncated: boolean; failed: boolean; scopeFailed: boolean }> {
  const judge = await makeScopeJudge(scope);
  if (judge.unrestricted && !judge.failed) return { where: undefined, truncated: false, failed: false, scopeFailed: false };
  if (judge.failed) return { where: sql`FALSE`, truncated: false, failed: true, scopeFailed: true };
  const max = RUN_SCOPE_MAX_DEFINITIONS;
  const heads = await d
    .select({ id: orchestrationWorkflows.id, version: orchestrationWorkflows.version, definitionJson: orchestrationWorkflows.definitionJson })
    .from(orchestrationWorkflows)
    .orderBy(desc(orchestrationWorkflows.updatedAt))
    .limit(max + 1);
  // final wave F9 (I re-review N1) — a snapshot of the version its workflow's head row IS (every deploy snapshots its head) is
  // the same definition: judged once, as the head — not counted twice against the budget. (N2) the snapshots are read whenever
  // the heads did not already overflow (`<=`): with exactly `max` heads one more snapshot ⇒ `truncated` (never a silent hide).
  const snaps =
    heads.length <= max
      ? await d
          .select({ workflowId: orchestrationWorkflowVersions.workflowId, version: orchestrationWorkflowVersions.version, definitionJson: orchestrationWorkflowVersions.definitionJson })
          .from(orchestrationWorkflowVersions)
          .where(
            sql`NOT EXISTS (SELECT 1 FROM ${orchestrationWorkflows} w WHERE w."id" = ${orchestrationWorkflowVersions.workflowId} AND w."version" = ${orchestrationWorkflowVersions.version})`,
          )
          .orderBy(desc(orchestrationWorkflowVersions.createdAt))
          .limit(max - heads.length + 1)
      : [];
  type Item = { wf: number; version: number; def: WorkflowDefinition | null; head: boolean };
  const items: Item[] = [
    ...heads.map((h) => ({ wf: h.id, version: h.version ?? 1, def: h.definitionJson as WorkflowDefinition, head: true })),
    ...snaps.map((v) => ({ wf: v.workflowId, version: v.version, def: v.definitionJson as WorkflowDefinition, head: false })),
  ];
  const truncated = items.length > max;
  const judged = items.slice(0, max);
  const r = await filterVisibleWith(judge, judged, (x) => x.def);
  lastRunVisibilityStats.definitionsRead = items.length;
  lastRunVisibilityStats.definitionsJudged = judged.length;
  lastRunVisibilityStats.truncated = truncated;
  const headIds = [...new Set(r.keep.filter((x) => x.head).map((x) => x.wf))];
  const pairs = [...new Set(r.keep.map((x) => `${x.wf}:${x.version}`))];
  const p = orchestrationRuns.paramsJson;
  const recorded = sql`(jsonb_typeof(${p} -> ${FOE_DEF_VERSIONS_PARAM}) = 'array' AND jsonb_array_length(${p} -> ${FOE_DEF_VERSIONS_PARAM}) > 0)`;
  const pairArr = pairs.length ? sql`ARRAY[${sql.join(pairs.map((x) => sql`${x}`), sql`, `)}]::text[]` : sql`ARRAY[]::text[]`;
  const where = sql`(
    (NOT coalesce(${recorded}, false) AND ${inArray(orchestrationRuns.workflowId, headIds.length ? headIds : [-1])})
    OR (coalesce(${recorded}, false) AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(${p} -> ${FOE_DEF_VERSIONS_PARAM}) e
       WHERE jsonb_typeof(e) <> 'number' OR (${orchestrationRuns.workflowId}::text || ':' || (e #>> '{}')) <> ALL(${pairArr})
    ))
  )`;
  return { where, truncated, failed: r.failed, scopeFailed: false };
}

/**
 * doc 81 Đợt 7 task I3 + I fix 1 — ONE page of the runs a list shows (newest first, at most min(limit, RUN_LIST_MAX_LIMIT)),
 * visible by the versions they executed: the scope filter is the SQL predicate of runVisibilitySql, applied BEFORE the LIMIT
 * (no in-memory filtering, bounded work). `truncated` ⇔ some definitions were left unjudged (their runs are not shown).
 * Any error ⇒ no runs, truncated (fail-closed, said).
 */
export async function listVisibleRuns(
  opts: { workflowId?: number; limit: number },
  scope: FoeScope,
): Promise<{ runs: Array<typeof orchestrationRuns.$inferSelect>; truncated: boolean }> {
  try {
    const d = await getDb();
    if (!d) return { runs: [], truncated: true };
    const vis = await runVisibilitySql(d, scope);
    const limit = Math.max(1, Math.min(opts.limit, RUN_LIST_MAX_LIMIT));
    const runs = await d
      .select()
      .from(orchestrationRuns)
      .where(and(opts.workflowId != null ? eq(orchestrationRuns.workflowId, opts.workflowId) : undefined, vis.where))
      .orderBy(desc(orchestrationRuns.createdAt), desc(orchestrationRuns.id))
      .limit(limit);
    return { runs, truncated: vis.truncated || vis.failed };
  } catch {
    return { runs: [], truncated: true };
  }
}

/**
 * doc 81 Đợt 7 task I3 + I fix 1 — the PENDING runs (held / awaiting a decision) `scope` may see, as run ids for the oversight
 * hub and the "mine" box (null = unrestricted), filtered IN SQL (runVisibilitySql), at most RUN_PENDING_MAX. `ok: false` ⇔
 * the scope or some definition could not be decided, definitions were left unjudged, or more pending runs exist than the cap
 * (the hub shows degraded; `decidedIds` = the runs decided visible, when the scope itself was resolved).
 */
export async function resolveVisiblePendingRunIds(
  scope: FoeScope,
): Promise<{ ok: true; ids: number[] | null } | { ok: false; decidedIds?: number[] }> {
  try {
    const d = await getDb();
    if (!d) return { ok: false };
    const vis = await runVisibilitySql(d, scope);
    if (vis.where === undefined) return { ok: true, ids: null };
    if (vis.scopeFailed) return { ok: false };
    const rows = await d
      .select({ id: orchestrationRuns.id })
      .from(orchestrationRuns)
      .where(and(inArray(orchestrationRuns.status, ["held", "awaiting_confirm"]), vis.where))
      .orderBy(desc(orchestrationRuns.updatedAt))
      .limit(RUN_PENDING_MAX + 1);
    const ids = rows.slice(0, RUN_PENDING_MAX).map((x) => x.id);
    if (vis.failed || vis.truncated || rows.length > RUN_PENDING_MAX) return { ok: false, decidedIds: ids };
    return { ok: true, ids };
  } catch {
    return { ok: false };
  }
}

/** doc 81 Đợt 5 task E2 — an out-of-scope target referenced only by STOP steps was allowed (L-7): audit it (best-effort). */
function auditStopOutOfScope(user: FoeUser, def: WorkflowDefinition, runId: number, stage: "start" | "approve", out: OutOfScope): void {
  if (isOutOfScopeEmpty(out)) return;
  void (async () => {
    try {
      const { logCrudOperation, createAuditContext } = await napAudit();
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

/** A2(n) (Q-6) — one hand-over for one STOP: a second runner reaching the sink (the walker's step and a pass) takes the first one's answer. A STOP that failed may be tried again. */
async function execCommand(rc: RunContext, step: Extract<WorkflowStep, { type: "command" }>, attempt: number): Promise<StepOutcome> {
  const giao: { xong: ((o: StepOutcome) => void) | null } = { xong: null };
  const tt: ThongTinLenh = {};
  let daOk = false;
  try {
    const o = await lopChuaRa(rc, step, attempt, tt, await execCommandMot(rc, step, attempt, giao, tt));
    giao.xong?.(o);
    daOk = o.kind === "ok";
    return o;
  } catch (err) {
    // the words of the throw are that runner's (runStepBody). T5 (C2) — on a latched run a thrown STOP is state C: it may have been written, so its source is the driver's
    const c = await lopChuaRa(rc, step, attempt, { ...tt, vi: { nguon: "driverLoi", ma: "DISPATCH_THREW" } }, { kind: "failed", error: `command step "${step.id}": its first runner threw at the hand-over` });
    giao.xong?.(c);
    if (c.kind === "failed" && c.chuaRaStop) return c;
    throw err;
  } finally {
    if (giao.xong && !daOk) rc.stopDangGiao?.delete(step.id);
  }
}

/** A2(n) — the one second ask of a stop-typed step at the sink, per attempt. Its unused authorisation is reported first (an edge's). */
async function hoiLaiStop(rc: RunContext, step: Extract<WorkflowStep, { type: "command" }>, attempt: number): Promise<StepOutcome> {
  (rc.hoiLaiStop ??= new Set()).add(`${step.id}#${attempt}`);
  await baoKhongDungCoHan(rc, step.id);
  return execCommand(rc, step, attempt);
}

async function execCommandMot(rc: RunContext, step: Extract<WorkflowStep, { type: "command" }>, attempt: number, giao: { xong: ((o: StepOutcome) => void) | null }, tt: ThongTinLenh): Promise<StepOutcome> {
  const m = rc.machineById.get(step.machineId);
  if (!m) {
    tt.vi = { nguon: "tuChoi", ma: "MACHINE_NOT_FOUND" };
    return { kind: "failed", error: `Machine ${step.machineId} not found.` };
  }
  const cap = getCapabilitiesForMachine({ machineType: m.machineType, capabilities: m.capabilities as never });
  const descriptor = cap.supportedCommands.find((c) => c.name === step.command);
  if (!descriptor) {
    tt.vi = { nguon: "tuChoi", ma: "COMMAND_NOT_SUPPORTED" };
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
    if (secPlatformEnabled()) {
      // T7b-1d lượt sửa 1 (H29) — flag on: its load has a bound; past it this attempt throws, the road a load that fails already has
      const { evaluateActionPolicy } = await withDeadline(napPolicy(), STOP_DB_STEP_DEADLINE_MS, `FOE run ${rc.runId} step ${step.id} policy load`);
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
        tt.vi = { nguon: "tuChoi", ma: code };
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
  // doc 81 Đợt 10 task C — the adapter resolution, the separate-gate lookup (FOE_GATE_REQUIRED) and the authorisation row
  // are the STORE's: foeRunStore.centralAuthorizeCommand is the code that stood here, moved unchanged (same statements, same
  // order, the OT STOP's two lookups still concurrent under ONE STOP_DB_STEP_DEADLINE_MS, the row still bounded for a STOP).
  // The EDGE store (doc 81 Đợt 10 C) answers a NON-STOP command with central's per-step /authorize (a verified STOP never asks —
  // L-7): stopped ⇒ the local abort (non-STOP steps stop, STOPs still sent); stale ⇒ this walker lets go of the run without
  // writing it; unavailable ⇒ HELD (D5: nothing sent, no compensation). The central store only ever refuses.
  const auth = await rc.store.authorizeCommand(rc, step, attempt, { isStop, robotKind, rawArgs, descriptor, cap, idempotencyKey, daChot: daChotKhongRo(rc) && !rc.chiGuiStopGhim });
  if (!auth.ok) {
    switch (auth.verdict) {
      case "refused":
        tt.vi = { nguon: "tuChoi", ma: maTuChoiCua({ error: auth.error }) };
        tt.khongGhim = rc.store.stopDocDuocKhongGhim?.(step.id) === true;
        return { kind: "failed", error: auth.error };
      case "stopped":
        void stopLiveRunForCentralAbort(rc.runId, EDGE_GUARD_ABORT_USER).catch(() => undefined);
        return ABORTED_OUTCOME;
      case "stale":
        rc.edgeDetached = true;
        rc.aborting = true;
        rc.controller.abort();
        return { kind: "aborted", error: "Edge claim is no longer current — this walker let go of the run." };
      case "unavailable": {
        // A2(n) (b) — central's second check: /authorize found the run latched and this compensation not approved. The walker did not know: now it does
        const chuAuth = auth.heldReason === "outcomeUnknown" ? chuBuTruCua(rc, step.id) : null;
        if (chuAuth) {
          await chotKhongRo(rc, step, auth.error);
          return giuTaiCong(rc, chuAuth, step.id);
        }
        return { kind: "held", stepId: step.id, reason: auth.heldReason, error: auth.error };
      }
    }
  }
  let cmd = auth.cmd;
  // A2(n) T5 (C-3) — no dispatcher can be asked: refused, not final, its budget stays
  if (auth.chuaRaStop && !rc.chiGuiStopGhim) {
    tt.vi = { nguon: "doc", ma: "ADAPTER_UNRESOLVED" };
    return { kind: "failed", error: `FOE: stop step "${step.id}": its adapter could not be resolved` };
  }
  // R1b-2b-2a A2(n) — an OT compensation sent by itself after an unknown outcome because it was classified a PINNED STOP: handed over only if the
  // central store authorised it as one for THIS dispatch (the pins may have changed since) — else nothing is sent, the run is held for a person.
  // A robot stop job has no pins (R-2: the classifier is the step itself, the robot dispatcher's own rule); the edge's list is the package's.
  // A2(n) T5 (F4, A) — unreadable is not "not pinned": the marked route, the dispatcher decides (K2-DOC). Only a read that ANSWERED "not pinned" holds it
  if (rc.chiStopGhimIds?.has(step.id) && rc.store.kind === "central" && !robotKind && auth.stopGhim !== true && auth.stopChuaDocGhim !== true) {
    return { kind: "held", stepId: step.id, reason: "outcomeUnknown", error: `${FOE_OUTCOME_UNKNOWN}: the compensation "${step.id}" is not a pinned STOP for this dispatch (its pins changed) — not sent; held for a person.` };
  }
  // R1b-2b-2a A2(m2) (b1) — the boot re-send hands ONLY a pinned STOP (the central store's verdict for THIS dispatch) to a dispatcher
  if (rc.chiGuiStopGhim && auth.stopGhim !== true) {
    return { kind: "failed", error: `FOE_BOOT_RESEND_NOT_PINNED: the compensation "${step.id}" is not a pinned STOP for this dispatch — not sent.` };
  }

  // doc 80 ORC-01 — last check before the command leaves the engine (the awaits above can span an abort).
  if (rc.aborting) return ABORTED_OUTCOME;
  // R1b-2b-2a A2(n) (a) — THE SINK: from here to the hand-over there is no await
  // A2(n) T5 — stopChuaDocGhim: the dispatcher decides; the row, or the absent authorisation, lets nothing else through
  const laStopGiao = auth.stopGhim === true || auth.stopXacMinh === true || (robotKind && isStop) || auth.stopChuaDocGhim === true;
  tt.khongGhim = !laStopGiao && auth.ghimKhongDoc !== true;
  // A2(n) T9 (decision 3, D2, plan point 8) — the step whose unknown attempt this hand-over comes after: the STOP itself handed over AGAIN, or its OWN STOP compensation sent by itself. Nothing else confirms it
  const chuBu = rc.chiStopGhimIds?.has(step.id) ? chuBuTruCua(rc, step.id) : null;
  const xnCho = ketCucRiengKhongRo(rc, step.id) ? step.id : chuBu && chuBu.comp.id === step.id && ketCucRiengKhongRo(rc, chuBu.step.id) ? chuBu.step.id : undefined;
  // D2 — ONLY the STOP handed over again after its own unknown attempt is read back after its write, whatever OT_READBACK_ENABLED. A robot has no read-back (RobotDispatchResult): never asked
  if (xnCho === step.id && laStopGiao && !robotKind) cmd = { ...cmd, docLai: "bat_buoc" };
  const cong = xetCongBuTru(rc, step.id, laStopGiao);
  // A2(n) — asked before the latch: "not a STOP for this dispatch" answered an unlatched run. A stop-typed step asks once more, now latched, and goes or is refused for what it is. A non-STOP never comes here
  if ((cong?.kind === "khongGui" || cong?.kind === "giu") && isStop && (rc.store.stopHoiLaiDuoc?.(step.id) ?? true) && !rc.hoiLaiStop?.has(`${step.id}#${attempt}`)) return hoiLaiStop(rc, step, attempt);
  if (cong?.kind === "khongGui") return khongGuiBuocTien(rc, step.id, attempt);
  if (cong?.kind === "giu") return giuTaiCong(rc, cong.chu, step.id);
  // A2(n) (Q-6) — the first runner holds the step, in this tick; a second one takes its answer
  if (laStopGiao) {
    const dang = rc.stopDangGiao?.get(step.id);
    if (dang) return dang;
    (rc.stopDangGiao ??= new Map()).set(step.id, new Promise<StepOutcome>((ok) => (giao.xong = ok)));
  }

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
  (rc.dangGui ??= new Map()).set(step.id, laStopGiao); // A2(n) (c) — in flight
  if (auth.stopChuaDocGhim === true) (rc.danhDauGiao ??= new Set()).add(step.id); // T9 — this hand-over is the marked route's: nobody verified its pins
  else rc.danhDauGiao?.delete(step.id);
  rc.dispatcherNoiKhongGhim?.delete(step.id); // T6c — only the answer to THIS hand-over counts
  let result: EquipmentCommandResult;
  try {
    result = await adapter.sendCommand(cmd);
  } finally {
    rc.dangGui.delete(step.id);
  }
  // A2(n) (I-3) — what really came back for a compensation sent by itself: a simulated dispatch never reads "sent"
  if (rc.chiStopGhimIds?.has(step.id) || cong) (rc.ketQuaBuTru ??= new Map()).set(step.id, { accepted: result.ok, simulated: result.status === "simulated" || result.detail?.simulated === true, xacNhan: result.ok && result.status === "acked_verified" && result.detail?.simulated !== true });
  // A2(n) (a) — a pinned STOP that passed the sink on its own (a body, or admitted before the latch): URGENT, after the dispatch, never awaited
  if (cong) baoKetCucKhongRo(rc, { loai: loaiGuiStop(rc, step.id, result.ok ? { kind: "ok" } : undefined), stepId: cong.chu.step.id, compId: step.id, error: rc.loiBuTru?.get(cong.chu.comp.id) ?? "", lan: luotDiCua(rc) });
  // A refused attempt is not "on its way" any more: a STOP whose retry an abort cancels is sent once more by the sweep.
  if (!result.ok) rc.dispatched.delete(step.id);
  // T9 lượt sửa 1 (R-2) — the last answer only: simulated reached no device
  if (result.status === "simulated" || result.detail?.simulated === true) (rc.giaoMoPhong ??= new Set()).add(step.id);
  else rc.giaoMoPhong?.delete(step.id);
  // A2(n) T9 (XAC_NHAN, D) — a closed list: a verified STOP for this dispatch, ok, not simulated, `acked_verified`. Anything else that went is only its trace (khongRoTruoc, xacNhan false)
  const xacNhan = xnCho !== undefined && laStopGiao && result.ok && result.status === "acked_verified" && result.detail?.simulated !== true;
  const vetKhongRo = xnCho !== undefined && result.ok ? { buoc: xnCho, ma: maKetCucKhongRoCua(rc.khongRoTai?.get(xnCho) ?? loiCuaChot(rc)), xacNhan } : null;
  if (xacNhan && rc.store.kind === "central") {
    const cu = rc.context[KET_CUC_KHONG_RO_XAC_NHAN_CTX_KEY];
    rc.context[KET_CUC_KHONG_RO_XAC_NHAN_CTX_KEY] = { ...(cu && typeof cu === "object" && !Array.isArray(cu) ? (cu as Record<string, unknown>) : {}), [xnCho]: { stopId: step.id, at: new Date().toISOString() } };
  }
  // R1b-2b-2a A2(o) AMENDMENT 2 — the edge refused it because its config went STALE after the authorisation (nothing sent, the
  // authorisation NOT used): HELD — no retry, no compensation; a Continue re-authorises it under the new config.
  const heldBy = result.ok || !rc.store.heldByDispatch ? null : await rc.store.heldByDispatch(step.id, { ok: result.ok, detail: (result.detail ?? null) as Record<string, unknown> | null });
  if (heldBy) return { kind: "held", stepId: step.id, reason: heldBy.reason, error: heldBy.error };

  const ketCuc = ketCucLenhFoe(result, step.command);
  // A2(n) T5 (H1, H11) — why, in a code, for the layer around this function. The snapshot read and said "not pinned": an answer
  if (ketCuc.kind === "failed") {
    const ma = maTuChoiCua({ error: result.error, status: result.status, detail: result.detail as { reason?: unknown } | null | undefined });
    const khongQuyet = rc.store.dispatcherKhongQuyetDuoc?.(result) === true || (auth.stopChuaDocGhim === true && ma === "NOT_CONFIRMED");
    tt.vi = { nguon: khongQuyet ? "doc" : nguonCuaKetQua(String(result.status), ma, robotKind), ma };
    if (rc.store.dispatcherNoiKhongGhim?.(result) === true) {
      tt.khongGhim = true;
      // T6c (Q2, item 4) — the marked route's own answer: no pinned STOP. Forward work dropped, and the end of the walk names it in words true of it (it WAS handed over)
      if (auth.stopChuaDocGhim === true) (rc.dispatcherNoiKhongGhim ??= new Map()).set(step.id, ma);
      // T6d (dieu-phoi 08/11 T6d-K1, E-C6) — central verified it a pinned STOP, the snapshot refused it as none: no state C (H1's exception), but never silent
      if (auth.stopXacMinh === true && daChotKhongRo(rc)) baoGhimLechChuaGui(rc, step.id);
    }
  }
  // E4 — after a STOP was sent, recording its result is bounded too (the next STOP of the walk must not wait on it).
  // A2(n) (I-2) — an unknown outcome survives a failed write of this row (its throw would read as a KNOWN failure: retried, compensated)
  await giuCoKhongRo(
    ketCuc.kind === "failed" && ketCuc.outcomeUnknown === true,
    rc,
    step.id,
    stopBoundedWrite(isStop, rc.runId, step.id, "result row", () =>
      rc.store.upsertStep(rc.runId, step.id, step.type, {
        status: "running",
        result: {
          routedTo: result.routedTo,
          status: result.status,
          accepted: result.ok,
          simulated: result.detail?.simulated ?? undefined,
          detail: result.detail ?? null,
          ...(vetKhongRo ? { khongRoTruoc: vetKhongRo } : {}), // T9 (X5) — the trace of the unknown attempt before it: never cleared, the row carries no code
        },
      }),
    ),
  );

  // R1b-2b-2a A2(m) — a PINNED STOP that failed: execStep's retry loop gives it the STOP default of attempts (soLanThuToiDa)
  return auth.stopGhim && ketCuc.kind === "failed" ? { ...ketCuc, stopGhim: true } : ketCuc;
}

async function execSequence(rc: RunContext, steps: WorkflowStep[]): Promise<StepOutcome> {
  for (const child of steps) {
    const out = await execStep(rc, child);
    if (out.kind === "paused" || out.kind === "failed" || out.kind === "aborted" || out.kind === "held") return out;
    // 'ok' / 'skipped' → continue
  }
  return { kind: "ok" };
}

async function execParallel(rc: RunContext, steps: WorkflowStep[], failFast: boolean): Promise<StepOutcome> {
  const results = await Promise.allSettled(steps.map((s) => execStep(rc, s)));
  const outcomes: StepOutcome[] = results.map((r) =>
    r.status === "fulfilled" ? r.value : { kind: "failed", error: String(r.reason) },
  );
  // R1b-2b-2a A2(n) (C-2) — a compensation held for an unknown outcome outranks a gate of a sibling: the run says what it waits for
  // (C-A) — and a branch that FAILED on an unknown outcome outranks every sibling state: its flag rides on whatever the parallel answers
  const heldKhongRo = outcomes.find((o) => o.kind === "held" && o.reason === "outcomeUnknown");
  if (heldKhongRo) return heldKhongRo;
  const khongRoLoi = outcomes.map((o, i) => loiKhongRoRun(rc, steps[i] as WorkflowStep, o)).find((x) => x !== undefined);
  const mang = <T extends StepOutcome>(o: T): T => (khongRoLoi === undefined ? o : { ...o, khongRoLoi });
  // A hitl_gate inside a parallel branch pauses the whole run.
  const paused = outcomes.find((o) => o.kind === "paused");
  if (paused) return mang(paused);
  const aborted = outcomes.find((o) => o.kind === "aborted");
  if (aborted) return mang(aborted);
  const held = outcomes.find((o) => o.kind === "held"); // doc 81 Đợt 10 C (D5) — a held branch holds the run
  if (held) return mang(held);
  const failures = outcomes.filter((o) => o.kind === "failed") as Array<{ kind: "failed"; error: string; khongRo?: true; khongGuiChot?: true }>;
  if (failures.length > 0) {
    // R1b-2b-2a A2(n) (I-4) — a branch failed on an UNKNOWN outcome ⇒ so did the parallel, failFast or not: never swallowed into a walk that goes
    // forward (its compensation splits too); a known failure is unchanged (n6)
    const khongRo = failures.some((f) => f.khongRo === true);
    const khongGui = failures.some((f) => f.khongGuiChot === true); // extension — work dropped by the sink never reads as a walk that went on (a run "completed")
    if (failFast || failures.length === outcomes.length || khongRo || khongGui) {
      return { kind: "failed", error: `Parallel branch failed: ${failures.map((f) => f.error).join("; ")}`, ...(khongRo ? { khongRo: true as const } : {}), ...(khongGui ? { khongGuiChot: true as const } : {}) };
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
      await rc.store.upsertStep(rc.runId, step.id, step.type, { status: "running", result: { reachedState: current } });
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
      await rc.store.upsertStep(rc.runId, step.id, step.type, { status: "running", result: { satisfied: true } });
      return { kind: "ok" };
    }
    if (Date.now() >= deadline) {
      return { kind: "failed", error: `wait_telemetry timeout for step "${step.id}".` };
    }
    await sleep(pollMs, rc.controller.signal);
  }
}

/** Run a step's compensation (saga undo). Fail-safe — records but never throws. */
async function runCompensation(
  rc: RunContext,
  step: WorkflowStep,
  stepError?: string,
  /**
   * R1b-2b-2a A2(m2) — `attempt`: the attempt number of the compensation's dispatch (its idempotency key `run<R>-<comp>-a<attempt>`).
   * Always 1 for a walk; the boot re-send of an interrupted STOP compensation uses LAN_GUI_LAI_KHOI_DONG (a key no walk used).
   */
  opts: { attempt?: number } = {},
): Promise<StepOutcome | undefined> {
  if (!step.compensation) return;
  try {
    const comp = step.compensation;
    (rc.loiBuTru ??= new Map()).set(comp.id, stepError ?? "");
    const compStop = await isStopCommandStep(rc, comp); // E fix 1 — a STOP compensation's bookkeeping is bounded too
    // doc 80 ORC-01 — never flip an ABORTED run back to 'compensating'. E fix 2 (review N1) — bounded when the
    // compensation is a STOP (the status write is on its path).
    await stopBoundedWrite(compStop, rc.runId, comp.id, "compensating status", async () => {
      // final wave P-E2 — only FROM a live walk status: if this (bounded) write lands after the run already ended or paused
      // (failed / completed / awaiting_confirm / held …) it changes nothing (it would leave a finished run "compensating").
      await rc.store.setStatusUnlessAborted(rc.runId, "compensating", {}, ["running", "compensating"]);
    });
    // fix review 2 (R-10-ae) — a compensation an earlier segment SENT without a recorded result is never sent again
    const compUnknown = outcomeUnknownOf(rc, comp.id);
    if (compUnknown !== null && !compStop) {
      await stopBoundedWrite(compStop, rc.runId, comp.id, "failed row", () =>
        rc.store.upsertStep(rc.runId, comp.id, comp.type, { status: "failed", error: compUnknown, finishedAt: new Date() }),
      );
      return;
    }
    // run the compensation step body once (no nested compensation cascade)
    await stopBoundedWrite(compStop, rc.runId, comp.id, "running row", () =>
      rc.store.upsertStep(rc.runId, comp.id, comp.type, { status: "running", startedAt: new Date() }),
    );
    const out = await runStepBody(rc, comp, opts.attempt ?? 1, compStop);
    if (comp.type === "command") datChuaRa(rc, comp.id, out.kind === "failed" ? out.chuaRaStop : undefined); // A2(n) T5 — the last word decides
    // A2(n) (S-1) — a compensation whose own outcome is unknown latches the run too: the containers above it must not write by themselves
    const khongRoThan = out.kind === "failed" && (out.outcomeUnknown === true || out.khongRo === true);
    if (khongRoThan) {
      await chotKhongRo(rc, comp, out.error);
      if (!rc.chiGuiStopGhim) {
        // I-I — a person is told now (the split's STOP and an approved compensation report for themselves)
        if (!rc.chiStopGhimIds?.has(comp.id) && !daDuyetBuTruKhongRo(rc.context, step.id, comp.id)) {
          (rc.buTruKhongRoDaBao ??= new Set()).add(comp.id);
          baoKetCucKhongRo(rc, { loai: "compensationUnknown", stepId: step.id, compId: comp.id, error: loiCoMaKhongRo(out.error), lan: luotDiCua(rc) });
        }
        // I-J — the STOPs of the containers around it go now, never behind a sibling
        if (!rc.aborting) await stopToTienMoi(rc, step, loiCoMaKhongRo(out.error));
      }
    }
    // A2(n) (G-1) — a gate inside an approved compensation is asked, not skipped: the run pauses there, the compensation stays due
    if (out.kind === "paused" && duongBuTruCua(rc)) return out;
    if (out.kind === "held") {
      // doc 81 Đợt 10 C fix review 1 (R-10-y, D5) — the compensation could not be authorised: nothing sent, nothing marked
      // failed; the run is held AT it. A Continue resumes it: central reads THAT from the rows (step failed + compensation held —
      // edgeResumeStateOf, R-10-ae), never from a context mark that a filter or a refused journal record could lose.
      void stepError;
      await stopBoundedWrite(compStop, rc.runId, comp.id, "held row", () =>
        rc.store.upsertStep(rc.runId, comp.id, comp.type, { status: "held", error: out.error, finishedAt: new Date() }),
      );
      return out;
    }
    await stopBoundedWrite(compStop, rc.runId, comp.id, "compensated row", () =>
      rc.store.upsertStep(rc.runId, comp.id, comp.type, {
        status: out.kind === "ok" ? "compensated" : "failed",
        error: "error" in out ? (khongRoThan ? loiCoMaKhongRo(out.error) : out.error) : null, // C-C — the row says the class
        finishedAt: new Date(),
      }),
    );
    // R1b-2b-2a A2(m2) — the outcome (the boot re-send reads it; the walk's callers only look for 'held', as before)
    return out;
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
  const st = await withLiveRun(rc, async () => {
    // Guarded: a run aborted while still 'queued' (e.g. async mode) is never revived.
    const started = await rc.store.setStatusUnlessAborted(rc.runId, "running", { startedAt: new Date() });
    if (!started) return "aborted";
    const out = await execSequence(rc, rc.def.steps);
    return finishWalk(rc, out);
  });
  await sauLuotDi(rc);
  return st;
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
async function finishWalk(rc: RunContext, ketQuaDi: StepOutcome): Promise<OrchestrationRun["status"]> {
  // R1b-2b-2a A2(n) (I-A) — a compensation-only walk never reads "completed": nothing forward was done
  let out: StepOutcome =
    (ketQuaDi.kind === "ok" || ketQuaDi.kind === "skipped") && duongBuTruCua(rc)
      ? { kind: "failed", error: rc.buTruDaChay ? `Run ${rc.runId}: the Continue ran only the held compensations; nothing forward was sent.` : `Run ${rc.runId}: the Continue found no held compensation to send; nothing was sent.` }
      : ketQuaDi;
  // the approval is spent with its walk: a later gate approval is an ordinary walk (an edge run's is replaced by central at every Continue)
  if (rc.store.kind === "central") delete rc.context[KHONG_RO_DUYET_CTX_KEY];
  // doc 81 Đợt 9 task S3 — an edge walker whose claim went stale owns nothing any more: no run-level write (it would overwrite
  // the segment that now owns the run, or a run a person holds).
  if (rc.edgeDetached) return "held";
  if (rc.aborting) {
    // abortRun owns the terminal write (with the user's reason). This guarded write only
    // matters if abortRun's own DB write failed — the run must not stay 'running' with no driver.
    const ghiAborted = rc.store.setStatusUnlessAborted(rc.runId, "aborted", { finishedAt: new Date(), error: "Run aborted by request." });
    // A2(n) T7b-1c (RA2-3) — a latched run: neither write that can throw here takes the debt and its URGENT with it. What threw still reaches the walk's exception path, after them
    if (rc.store.kind === "central" && daChotKhongRo(rc)) {
      const loiGhi = await ghiAborted.then(() => null, (err: unknown) => err ?? new Error("aborted write"));
      const loiCtx = await noSauAbortKhoa(rc);
      if (loiGhi ?? loiCtx) throw loiGhi ?? loiCtx;
      return "aborted";
    }
    await ghiAborted;
    await rc.store.persistContext(rc);
    return "aborted";
  }
  if (daChotKhongRo(rc)) out = await duongKetThuc(rc, out);
  // R1b-2b-2a A2(n) (R-4) — an unknown outcome with no compensation due anywhere: nothing was split, nobody was told yet
  // (C-A) — the same on a paused / held / aborted end: the flag rode on it
  const loiKhongRoKet = loiKhongRoRun(rc, null, out);
  if (loiKhongRoKet !== undefined && !rc.khongRoDaBao) {
    const lan = luotDiCua(rc);
    for (const stepId of rc.khongRoGoc ?? []) baoKetCucKhongRo(rc, { loai: "noCompensation", stepId, compId: KHONG_CO_BU_TRU, error: loiCoMaKhongRo(loiKhongRoKet), lan });
  }
  // A2(n) (decision 3) — forward work dropped: said in its own words, whatever else this walk told. T6 (H13) — one URGENT per branch dropped, read by duongKetThuc
  baoBuocTienBiBo(rc, luotDiCua(rc));
  let status: OrchestrationRun["status"];
  let patch: Partial<OrchestrationRun>;
  if (out.kind === "paused") {
    status = "awaiting_confirm";
    patch = { currentStepId: out.stepId };
  } else if (out.kind === "held") {
    // doc 81 Đợt 10 C (D5) — an edge segment that could not get an authorisation: held, resumable (Continue)
    status = "held";
    patch = { currentStepId: null, error: out.error };
  } else if (out.kind === "aborted" || out.kind === "failed") {
    status = out.kind;
    patch = { finishedAt: new Date(), error: out.error };
  } else {
    status = "completed";
    patch = { finishedAt: new Date() };
  }
  // A2(n) T7 — THE end gate (quyetDinhKetThuc; decision 1, H1, H2): a latched central walk ends only on a durable URGENT and never while a STOP is owed on the rows. A hold or a pause is no end:
  // it only records that the latch is told (DA_BAO). An edge walker's end is central's to decide (applyEdgeSegmentEnd)
  let giuCong = false;
  if (rc.store.kind === "central" && daChotKhongRo(rc)) {
    const ketThuc = status === "completed" || status === "failed" || status === "aborted";
    const q = await quyetDinhKetThuc({ rc, chiDoi: !ketThuc }, "walk");
    if (q.moi && q.chot) rc.context[KET_CUC_KHONG_RO_DA_BAO_CTX_KEY] = { stepId: q.chot.stepId, at: new Date().toISOString() };
    if (ketThuc && q.ghi === "held") {
      status = "held";
      patch = { currentStepId: null, error: q.loi };
      giuCong = true;
    }
  }
  const written = await rc.store.setStatusUnlessAborted(rc.runId, status, patch);
  if (written && rc.store.kind === "central" && (status === "completed" || status === "failed" || status === "aborted")) quenBenKhongXacNhan(rc.runId); // T7 lượt sửa 1 (c)
  // A2(n) T7b-3 (H36, chu du an 10/11) — this end swept nothing (no Abort, not latched): what the run still owes is told once the walker has let go of the run (sauLuotDi), never here
  if (written && rc.store.kind === "central" && !giuCong && (status === "completed" || status === "failed" || status === "aborted") && !daChotKhongRo(rc)) rc.ketThucKhongQuet = status;
  // A2(n) (M-5) — held (or paused) over an unknown outcome: the URGENT already said Continue. A lost context never turns that into 'failed': the
  // run stays as it is, a Continue re-walks and splits again (the forward key is replayed, never a new attempt)
  // (m-N) — the same for ANY end of a latched run that a person answers (a gate inside a compensation)
  if (giuCong || (out.kind === "held" && out.reason === "outcomeUnknown") || (out.kind !== "failed" && (loiKhongRoKet !== undefined || daChotKhongRo(rc)))) {
    await rc.store.persistContext(rc).catch((err: unknown) => console.error(`[FOE] run ${rc.runId}: context not persisted on an outcome-unknown hold: ${(err as Error)?.message ?? err}`));
  } else {
    await rc.store.persistContext(rc);
  }
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
  const { completed, prior, khongRoChotHang, khongRoHang, stopCoTheRa } = await loadCompletedSteps(run.id);
  return {
    runId: run.id,
    ...(khongRoChotHang ? { khongRoChotHang } : {}),
    ...(khongRoHang ? { khongRoHang } : {}),
    ...(stopCoTheRa ? { stopCoTheRa } : {}),
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
    store: centralRunStore, // doc 81 Đợt 10 C — a run built from its DB rows is walked against the DB
  };
}


/**
 * doc 80 ORC-03 — ENFORCE the gate's approver policy on APPROVAL (throws FORBIDDEN):
 *   • approverRoles declared ⇒ the approver's role must be listed (admin is always allowed);
 *   • fourEyes ⇒ the approver must not be the user who started the run (no admin exemption).
 */
async function assertGateApprover(gate: HitlGateStep, run: OrchestrationRun, user: FoeUser): Promise<void> {
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
  // doc 81 Đợt 9 task R2 — a four-eyes gate of an API-started run: the key's holder (now or earlier) and its creator are
  // not a second person either. Re-derived from the DB rows; cannot be decided (unidentifiable key, no holder, DB error)
  // ⇒ refused (fail-closed — an approval is never urgent: stopping goes through abort / the machines' STOP / E-STOP).
  if (gate.fourEyes === true) {
    // R fix 1 (#3) — for EVERY four-eyes approval (a recorded key makes a run an API run even without a marker); a user run
    // derives { owner, keyParties: [] } — the owner check above already decided it.
    let idr: Awaited<ReturnType<typeof deriveRunApprovalIdentity>> | null = null;
    try {
      const d = await getDb();
      if (d) idr = await deriveRunApprovalIdentity(d, run);
    } catch {
      idr = null;
    }
    if (!idr || !idr.ok) {
      const why =
        idr?.reason === "apiKeyInactive"
          ? `is ${idr.detail === "expired" ? "expired" : "revoked / disabled"} now`
          : idr?.reason === "ownerUnknown"
            ? "has no holder"
            : idr?.reason === "apiRun"
              ? "cannot be identified"
              : "could not be read (database error, or migration 0369 not applied)";
      throw appError(
        "FORBIDDEN",
        "PERMISSION_DENIED",
        { action: "selfApproveOrchestrationGate" },
        `Gate "${gate.id}" requires four-eyes, but the API key that started run ${run.id} ${why} — it cannot be approved.`,
      );
    }
    if (idr.identity.keyParties.includes(user.id)) {
      throw appError(
        "FORBIDDEN",
        "PERMISSION_DENIED",
        { action: "selfApproveOrchestrationGate" },
        `Gate "${gate.id}" requires four-eyes: run ${run.id} was started through an API key issued to or created by you — another user must approve it.`,
      );
    }
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
    // doc 81 Đợt 7 task I fix 1 (owner decision 2026-10-11, mig 0367) — refs are unique per (ref, scopeKey): the deployer's
    // NAMESPACE is its scope key (foeScope.workflowScopeKeyOf: 'global' for admin / a `global` key / the system loader,
    // 'f:<factory ids>' for a restricted scope). The ref is resolved WITHIN the deployer's view (resolveWorkflowByRef):
    //   • `targetWorkflowId` (rollback; the Studio editor of a loaded workflow) names the workflow to update — used only when
    //     it carries this ref and the deployer may see it (or it is in the deployer's own namespace); else as if absent;
    //   • else the deployer's OWN-namespace workflow of this ref (whatever its visibility — it is its own namespace), else the
    //     single workflow of this ref it may SEE (a 'global' one first) ⇒ that workflow is UPDATED (idempotent redeploy) —
    //     its targets must all be in the deployer's scope, STOP steps included ⇒ else refOutOfScope (a workflow it can see);
    //   • several visible candidates and no own / global one ⇒ refused refAmbiguous (only about workflows it can see);
    //   • otherwise — the ref is free, OR used only by workflows it cannot see (another factory; or undecidable ⇒ treated as
    //     not visible, review M-1) — a NEW workflow is created in its OWN namespace: the SAME answer as a free ref.
    // A race on the unique (ref, scopeKey) ⇒ refConflict ("retry"), never the database's text (review M-2).
    const systemLoader = !(Number.isInteger(user.id) && user.id > 0) && opts?.scope === undefined;
    let scopeKey: string;
    try {
      scopeKey = systemLoader ? "global" : await workflowScopeKeyOf(scope);
    } catch {
      return { ok: false, enabled: true, reason: "scopeUnverified", stepIds: [], message: "Your factory scope could not be resolved — retry in a moment." };
    }
    const resolved = await resolveWorkflowByRef(d, def.ref, scope, scopeKey, { workflowId: opts?.targetWorkflowId, ownAnyVisibility: true });
    // final wave F3 (R-7-d) — the view could not be decided (judge failed / an undecided workflow of this ref) ⇒ refused, never
    // a silent new copy in the deployer's namespace next to a workflow it may be meant to update.
    if (resolved.kind === "unverified") {
      return { ok: false, enabled: true, reason: "scopeUnverified", stepIds: [], message: "Your factory scope could not be verified for this ref — retry in a moment." };
    }
    if (resolved.kind === "ambiguous") {
      return {
        ok: false,
        enabled: true,
        reason: "refAmbiguous",
        stepIds: [],
        message: `Several workflows you can see use the ref "${def.ref}" — deploy from the workflow itself (open it in the Studio) so the right one is updated.`,
      };
    }
    const existing = resolved.kind === "row" ? [resolved.row] : [];
    // doc 81 Đợt 5 task E2 — deploying over an EXISTING workflow replaces its definition, so the deployer's scope must also
    // cover every target of the definition being replaced, STOP steps included.
    if (existing.length) {
      const prev = await scopeVerdict(existing[0].definitionJson as WorkflowDefinition, scope, { nonStopOnly: false });
      if (!isOutOfScopeEmpty(prev.out)) {
        return {
          ok: false,
          enabled: true,
          reason: "refOutOfScope",
          stepIds: [],
          message: `The workflow "${def.ref}" touches machines/robots outside your factory scope (stop steps included) — only someone whose scope covers them can redeploy it; use another ref.`,
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
      try {
        const [row] = await d
          .insert(orchestrationWorkflows)
          .values({
            ref: def.ref,
            scopeKey,
            name: def.name,
            description: def.description ?? null,
            definitionJson,
            version: nextVersion,
            status: "active",
            createdBy: user.id || null,
          })
          .returning();
        workflowId = row.id;
      } catch (err) {
        if (isUniqueViolation(err)) {
          // final wave F9 (I re-review N5) — a `targetWorkflowId` that resolved to nothing (deleted, moved out of view, or another
          // ref) while the deployer's own namespace already holds the ref: retrying can never succeed ⇒ say so (not "retry").
          if (opts?.targetWorkflowId != null) {
            return {
              ok: false,
              enabled: true,
              reason: "refTargetStale",
              stepIds: [],
              message: `The workflow you opened is no longer available under the ref "${def.ref}" — reload the list and open the workflow again (or use another ref).`,
            };
          }
          return { ok: false, enabled: true, reason: "refConflict", stepIds: [], message: `A workflow with the ref "${def.ref}" was just created in your scope — retry.` };
        }
        throw err;
      }
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

/** doc 81 Đợt 7 I fix 1 (M-2) — a unique-key violation (23505), however the driver wraps it. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

type WorkflowRow = typeof orchestrationWorkflows.$inferSelect;
/**
 * `unverified` — final wave F3 (ruling R-7-d): the caller's view could not be DECIDED (its namespace key is unknown, the scope
 * judge failed, or a candidate the caller might see — one that could change the pick — is undecided). Callers REFUSE with
 * `scopeUnverified` ("retry"): never "none" (deploy would silently create a copy in the caller's namespace) and never a
 * fallback to a lower-ranked workflow (start would run the global X instead of the caller's own X).
 */
export type RefResolution = { kind: "row"; row: WorkflowRow } | { kind: "none" } | { kind: "ambiguous" } | { kind: "unverified" };

/**
 * doc 81 Đợt 7 task I fix 1 (owner decision 2026-10-11, mig 0367) — THE resolution of a plain workflow ref WITHIN a caller's
 * view (deploy, start, simulate, delete, duplicate, API v1). Candidates: the workflows with this ref in ANY namespace (or only
 * `workflowId` when given). A candidate counts only when the caller may SEE it (decideDefinition "in") — except, with
 * `ownAnyVisibility`, the caller's OWN-namespace row (deploy: its own namespace leaks nothing). Pick: own namespace › 'global'
 * › the single visible one; several ⇒ ambiguous; none ⇒ none. Workflows of other factories the caller cannot see (decided
 * "out") are never named: "none" is the SAME answer as a free ref.
 * final wave F3 (R-7-d) — what cannot be decided is never read as "not visible": `scopeKey` null (namespace unresolvable) or a
 * failed judge ⇒ `unverified`; an UNDECIDED candidate ⇒ `unverified` unless the pick cannot change whatever it is (the
 * caller's own visible row; or a visible 'global' row and no undecided own-namespace row). Accepted residual (owner ruling):
 * `unverified` tells the caller that some workflow of this ref exists whose visibility is undecided right now.
 */
export async function resolveWorkflowByRef(
  d: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  ref: string,
  scope: FoeScope,
  scopeKey: string | null,
  opts: { workflowId?: number; ownAnyVisibility?: boolean } = {},
): Promise<RefResolution> {
  if (scopeKey == null) return { kind: "unverified" }; // F3 — the SAME answer whatever exists (no fallback to 'global')
  let rows = await d.select().from(orchestrationWorkflows).where(eq(orchestrationWorkflows.ref, ref));
  if (opts.workflowId != null) rows = rows.filter((r) => r.id === opts.workflowId);
  const judge = await makeScopeJudge(scope);
  const own = rows.find((r) => r.scopeKey === scopeKey);
  if (own && opts.ownAnyVisibility) return { kind: "row", row: own };
  const judged = await filterVisibleWith(judge, rows, (r) => r.definitionJson as WorkflowDefinition);
  if (judge.failed) return { kind: "unverified" };
  const visible = judged.keep;
  const ownVisible = visible.find((r) => r.scopeKey === scopeKey);
  if (ownVisible) return { kind: "row", row: ownVisible };
  const globalVisible = visible.find((r) => r.scopeKey === "global");
  const undecidedOwn = judged.unknown.some((r) => r.scopeKey === scopeKey);
  if (globalVisible && !undecidedOwn) return { kind: "row", row: globalVisible };
  if (judged.unknown.length > 0) return { kind: "unverified" };
  if (visible.length === 0) return { kind: "none" };
  return visible.length === 1 ? { kind: "row", row: visible[0] } : { kind: "ambiguous" };
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
    targetWorkflowId: workflowId, // doc 81 Đợt 7 I fix 1 — the workflow being rolled back, never another namespace's
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
    const { logCrudOperation, createAuditContext } = await napAudit();
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
   * since Đợt 9 R1 the user the API key is ISSUED TO — api_keys.holderUserId, default the creator). Ignored when `user` is
   * a real user (id > 0).
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
    /**
     * doc 81 Đợt 9 task R1/R2 — the API key that starts this run (API v1 route only, from the AUTHENTICATED principal, never
     * from the body / params). Recorded on the run (orchestration_runs.startedViaApiKeyId, write-once) only for an API run;
     * its holder / creator are then excluded from approving. Absent (or not recordable) ⇒ the API run stays unidentified ⇒
     * its non-STOP OT/robot steps are refused (apiRun) — fail-closed.
     */
    apiKeyId?: number | null;
    /** doc 81 Đợt 5 task E2 — the starter's factory scope (see DeployOpts.scope). */
    scope?: FoeScope;
    /** doc 81 Đợt 7 I fix 1 — the workflow the caller means (several visible workflows may share a ref across namespaces). */
    workflowId?: number;
    /**
     * doc 81 Đợt 9 task S2 — hand the run to this EDGE NODE (edge_nodes.id; the caller checked the node is in its scope —
     * edgeExecutionCentral.resolveAssignableNode). The run is created 'queued' with its edge assignment (mig 0370) in ONE
     * transaction and is NOT walked here; the node claims and executes it. No assignment recordable ⇒ no run is created.
     */
    edgeNodeId?: number;
    /**
     * doc 81 Đợt 7 task I1 — called with the new run's id right after its row exists (before the walk): the edge runtime
     * uses it to watch central for an abort WHILE the run walks. A throwing callback is ignored (never stops the run).
     */
    onStarted?: (runId: number) => void;
  },
): Promise<StartRunResult> {
  if (!foeEnabled()) {
    return { ok: false, enabled: false, message: "FOE is disabled (set FOE_ENABLED=true)." };
  }
  let runId: number | undefined;
  let rcLuot: RunContext | null = null; // T7 lượt sửa 1 (K1) — the walk in hand, for the end gate
  try {
    const d = await db();
    // doc 81 Đợt 7 task I fix 1 — the ref is resolved WITHIN the starter's view (resolveWorkflowByRef: own namespace ›
    // 'global' › the single visible one; `workflowId` pins one). doc 81 Đợt 5 task E2 — a workflow whose NON-STOP targets are
    // outside the starter's scope does not exist for them (the SAME answer as a missing ref, before any status check).
    // Targets reached only by VERIFIED STOP steps are allowed (L-7, R-5-j) and audited once the run exists.
    const startScope = scopeFor(user, opts?.scope);
    let startKey: string | null = null;
    try {
      startKey = await workflowScopeKeyOf(startScope);
    } catch {
      startKey = null; // final wave F3 (R-7-d) — no fallback to 'global' › single visible: resolveWorkflowByRef ⇒ unverified
    }
    const found = await resolveWorkflowByRef(d, workflowRef, startScope, startKey, { workflowId: opts?.workflowId });
    if (found.kind === "unverified") {
      // final wave F3 — the starter's namespace / view could not be decided: refused (the SAME answer whether the ref exists);
      // a start is never urgent (stopping equipment goes through the machine's direct STOP / E-STOP, not a new run).
      return { ok: false, enabled: true, reason: "scopeUnverified", message: "Your factory scope could not be verified — retry in a moment." };
    }
    if (found.kind === "ambiguous") {
      return {
        ok: false,
        enabled: true,
        reason: "refAmbiguous",
        message: `Several workflows you can see use the ref "${workflowRef}" — start it from the workflow itself (open it in the Studio).`,
      };
    }
    const wf = found.kind === "row" ? found.row : undefined;
    const sv = await scopeVerdict((wf?.definitionJson ?? { ref: workflowRef, name: workflowRef, steps: [] }) as WorkflowDefinition, startScope, { nonStopOnly: true });
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
    // doc 81 Đợt 9 task S2 — handed to an EDGE NODE: created + assigned in ONE transaction, never walked here.
    if (opts?.edgeNodeId !== undefined) return await startEdgeAssignedRun(d, { wf, def, params, user, opts, stopOnlyOut: sv.stopOnlyOut });
    const { viaApi, runValues } = buildNewRunValues(wf, params, user, opts);
    // doc 81 Đợt 9 task R1 + R fix 1 (#4) — WHICH key started this API run is written IN THE INSERT (the 0369 trigger refuses
    // every later UPDATE of the column, a late first write included). Only for an API run with an authenticated key. 0369 not
    // applied (42703) ⇒ the run is created without it, said loudly: it stays unidentified ⇒ its non-STOP OT/robot steps are
    // refused (apiRun), its STOPs go out (a run that exists to stop is never kept from starting). Any other error ⇒ thrown.
    const apiKeyId = opts?.apiKeyId;
    let run: OrchestrationRun | undefined;
    if (viaApi && typeof apiKeyId === "number" && Number.isInteger(apiKeyId) && apiKeyId > 0) {
      try {
        [run] = (await d.insert(orchestrationRunsWithApiKey).values({ ...runValues, startedViaApiKeyId: apiKeyId }).returning()) as unknown as OrchestrationRun[];
      } catch (err) {
        if (!isMigrationMissingError(err)) throw err;
        console.error(
          `[FOE] API run of workflow "${wf.ref}": the API key that starts it (${apiKeyId}) cannot be recorded — database migration 0369 is not applied; its OT/robot steps other than a STOP will be refused (apiRun).`,
        );
      }
    }
    if (!run) [run] = await d.insert(orchestrationRuns).values(runValues).returning();
    runId = run.id;
    try {
      opts?.onStarted?.(run.id); // doc 81 Đợt 7 I1
    } catch {
      /* a caller's callback never stops the run */
    }
    auditStopOutOfScope(user, def, run.id, "start", sv.stopOnlyOut); // doc 81 Đợt 5 task E2 (L-7: allowed, audited)
    // doc 33 W4 (F8 §5.1.2) — durable event log: record RUN_CREATED (best-effort, FOE_DURABLE-gated).
    void appendRunEvent(run.id, "RUN_CREATED", { ts: Date.now(), data: { workflowRef: wf.ref } });

    // OPT-IN async: tách drive khỏi request. Trả 'queued' + runId ngay; drive nền.
    if (opts?.async) {
      const asyncRunId = run.id;
      setImmediate(() => {
        void (async () => {
          let rcNen: RunContext | null = null; // T7 lượt sửa 1 (K1) — the walk in hand, for the end gate
          try {
            const rc = await buildRunContext(run, def, user);
            rcNen = rc;
            await driveRun(rc);
          } catch (err) {
            // FAIL-SAFE — drive nền không được ném ra ngoài (không có ai await).
            const message = err instanceof Error ? err.message : String(err);
            // doc 80 ORC-01 (fix round 1) — conditional: an exception AFTER an abort never turns 'aborted' into 'failed'.
            // A2(n) T7 (C1) — through the end gate: a STOP owed, or no durable URGENT, holds the run
            await ketThucNgoaiLe(asyncRunId, message, rcNen).catch(() => undefined);
          }
        })();
      });
      return { ok: true, enabled: true, runId: run.id, status: "queued" };
    }

    const rc = await buildRunContext(run, def, user);
    rcLuot = rc;
    const status = await driveRun(rc);
    return { ok: status !== "failed" && status !== "aborted", enabled: true, runId: run.id, status };
  } catch (err) {
    // FAIL-SAFE — never throw to the caller; mark the run failed if we created it.
    const message = err instanceof Error ? err.message : String(err);
    // doc 80 ORC-01 (fix round 1) — conditional write: an exception AFTER an abort (e.g. persistContext
    // throwing) must not overwrite 'aborted' with 'failed'. 0 rows written ⇒ report 'aborted'.
    // A2(n) T7 (C1) — through the end gate: a STOP owed, or no durable URGENT, holds the run
    const ghi = runId != null ? await ketThucNgoaiLe(runId, message, rcLuot) : "failed";
    return { ok: false, enabled: true, runId, status: ghi, message };
  }
}

/**
 * doc 81 Đợt 10 C (design §2.7, D7; Đợt 9 S Concern 3) + fix review 1 (R-10-m) — the program checks of the adapters an EDGE
 * NODE owns, from the node's own STORED reports (edge_node_program_reports, mig 0373), through THE one rule
 * (edge/edgeProgramReportRule.edgeProgramCheckOf — key, central capability, owner epoch, freshness; the same rule B's
 * /authorize applies to the readings of its request). Every other adapter id is unreadable: central never reads a controller
 * for an edge run. undefined ⇔ migrations 0373/0374 are missing (no adapter can be edge-owned ⇒ the pre-Đợt-10 reads).
 * Throws on any other DB error (callers fail closed).
 */
export async function edgeNodeProgramPre(d: NonNullable<Awaited<ReturnType<typeof getDb>>>, edgeNodeId: number, nowMs: number = Date.now()): Promise<ReadonlyMap<number, ProgramCheck> | undefined> {
  let owned: Array<{ id: number; ownerEpoch: number | null; edgeNodeId: number | null }>;
  let reports: Array<{ adapterId: number; edgeNodeId: number; status: string; checksum: string | null; reason: string | null; readAt: Date | string | null; ownerEpoch: number | null }>;
  try {
    [owned, reports] = await Promise.all([
      d.select({ id: adapterOwnership.id, ownerEpoch: adapterOwnership.ownerEpoch, edgeNodeId: adapterOwnership.edgeNodeId }).from(adapterOwnership).where(eq(adapterOwnership.edgeNodeId, edgeNodeId)),
      d.select().from(edgeNodeProgramReports).where(eq(edgeNodeProgramReports.edgeNodeId, edgeNodeId)),
    ]);
  } catch (err) {
    if (isEdgeControlSchemaMissing(err)) return undefined;
    throw err;
  }
  const ids = owned.filter((o) => o.edgeNodeId === edgeNodeId).map((o) => o.id);
  const rows = ids.length ? ((await d.select().from(deviceAdapters).where(inArray(deviceAdapters.id, ids))) as Array<Record<string, unknown>>) : [];
  const adapters = owned
    .filter((o) => o.edgeNodeId === edgeNodeId)
    .map((o) => {
      const row = rows.find((r) => r.id === o.id);
      return { id: o.id, edgeNodeId: o.edgeNodeId, ownerEpoch: o.ownerEpoch, protocol: row?.protocol, connectionOptions: row?.connectionOptions, code: row?.code, name: row?.name };
    });
  return edgeProgramPreOf(edgeNodeId, adapters, reports, { source: "stored", nowMs });
}

/**
 * fix review 2 (R-10-ae) — the resume state of an edge run from its STEP ROWS + central's authorisation ledger (0372: an
 * authorisation issued without a reported result ⇒ the command may have been sent). 0372 missing ⇒ no ledger (no v2 edge
 * can have run). Throws on a read error (the caller refuses).
 */
async function edgeResumeStateFor(d: NonNullable<Awaited<ReturnType<typeof getDb>>>, runId: number, def: WorkflowDefinition, hintUnknown: string[]) {
  const rows = await d.select().from(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, runId));
  // fix review 3 (R-10-ao N1) — ANY non-superseded authorisation of a step whose row is not final means it MAY have been sent:
  // the edge journals the ledger result (⇒ resultReportedAt) BEFORE the walker's result row, so "reported" proves nothing.
  let authorised = new Set<string>();
  try {
    const auths = (await d.select().from(edgeStepAuthorizations).where(eq(edgeStepAuthorizations.runId, runId))) as Array<{ stepId: string; supersededAt: unknown }>;
    authorised = new Set(auths.filter((a) => a.supersededAt == null).map((a) => a.stepId));
  } catch (err) {
    // N3 — ONLY a missing table (0372 not applied ⇒ no v2 edge ever ran) means "no ledger"; anything else refuses the Continue
    const code = (err as { code?: unknown; cause?: { code?: unknown } } | null)?.code ?? (err as { cause?: { code?: unknown } } | null)?.cause?.code;
    if (code !== "42P01") throw err;
  }
  // N2 — STOP steps (the walker's own candidates: robot stop job / stop-typed OT) are never outcome-unknown: re-sent (L-7)
  const map = await loadMachines(validateWorkflow(def, null).referencedMachineIds);
  const stops = new Set<string>();
  for (const s of allStepsOf(def.steps)) if (s.type === "command" && (await isStopCandidate(s, map))) stops.add(s.id);
  return { ...edgeResumeStateOf(def, rows, authorised, hintUnknown, stops), rows, stops };
}

/** A2(n) (S-1) — the approval a Continue records: exactly these compensations of these steps. */
function duyetKhongRo(def: WorkflowDefinition, stepIds: readonly string[], user: FoeUser) {
  return { stepIds, buTru: stepIds.map((stepId) => ({ stepId, compId: findStepDeep(def.steps, stepId)?.compensation?.id ?? "?" })), by: user.id, at: new Date().toISOString() };
}

/**
 * R1b-2b-2a A2(n) (m-3, m-6) — one audit row per compensation a Continue releases, BEFORE the claim: a person-gated WRITE never goes out without
 * its audit row (a failed audit refuses the Continue, nothing changed; a claim lost afterwards leaves an audit of an attempt, which is true).
 */
async function auditTiepTucKhongRo(user: FoeUser, runId: number, def: WorkflowDefinition, stepIds: readonly string[], lyDo: string, ctx: Record<string, unknown>, rows: ReadonlyArray<{ stepId: string; stepType?: string; status: string }>, extra: Record<string, unknown> = {}): Promise<void> {
  const dau = dauKetCucKhongRoCua(ctx);
  // G-2 — an open gate off the way is not asked: the run ends failed. Said in the audit, each by name
  const duong = duongToiBuoc(def.steps, new Set(stepIds));
  const coBoQua = rows.filter((r) => r.status === "awaiting_confirm" && r.stepType === "hitl_gate" && !duong.has(r.stepId)).map((r) => `gate ${r.stepId} skipped because the run failed`);
  for (const stepId of stepIds) {
    const compId = findStepDeep(def.steps, stepId)?.compensation?.id ?? dau?.ds?.find((x) => x.stepId === stepId)?.compId ?? "?";
    const ok = await ghiAuditKetCucKhongRo(user, runId, "continue", { stepId, compId, ma: dau?.ma ?? null, reason: lyDo, role: user.role, ...(coBoQua.length ? { gatesSkipped: coBoQua } : {}), ...extra });
    if (!ok) {
      throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "resumeOrchestrationRun", reason: "auditNotWritten" }, `Run ${runId}: the audit row of this Continue could not be written — nothing was sent; retry, or Abort, which sends the run's STOPs.`);
    }
  }
}

/** The binding detail of an edge run: its node's program reports (D7). A read error ⇒ no digest (fail-closed). */
async function edgeBindingDetail(
  d: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  edgeNodeId: number,
  def: WorkflowDefinition,
  view?: { display?: boolean },
): Promise<{ digest: string | null; programs: ProgramCheck[] }> {
  let pre: ReadonlyMap<number, ProgramCheck> | undefined;
  try {
    pre = await edgeNodeProgramPre(d, edgeNodeId);
  } catch {
    return { digest: null, programs: [] };
  }
  return computeBindingDetail(d, def, pre, view);
}

/**
 * Fetch a run + its per-step audit (read-only).
 * final wave F6 — `bindingDigest` (computeBindingDigest: adapter / tag / robot reads) is computed only when the caller is an
 * APPROVER'S SCREEN (`opts.bindingDigest`, the Studio's getRun) AND the run is paused where an approval / continue can bind
 * to it ('awaiting_confirm' | 'held' — resumeRun's `screenBound`); every other read gets null without the extra reads (the
 * edge progress tick, the QT pump, resolveQtGate, API v1 reads). null never lets an approval through: the Studio cannot
 * approve without a digest, and resumeRun recomputes and compares it server side (fail-closed).
 */
export async function getRun(
  runId: number,
  opts: {
    bindingDigest?: boolean;
    /**
     * doc 81 Đợt 8 final wave (review O M1) — the caller's visibility check, applied to the run row FIRST: false ⇒ null
     * (nothing else is read — no step rows, no controller checksum read for a run the caller may not see).
     */
    visibleTo?: (run: typeof orchestrationRuns.$inferSelect) => Promise<boolean>;
  } = {},
): Promise<RunView | null> {
  const d = await getDb();
  if (!d) return null;
  const [run] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
  if (!run) return null;
  if (opts.visibleTo && (await opts.visibleTo(run).catch(() => false)) !== true) return null;
  const stepRows = await d
    .select()
    .from(orchestrationRunSteps)
    .where(eq(orchestrationRunSteps.runId, runId));
  const [wf] = await d.select(WF_CORE_COLS).from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, run.workflowId)).limit(1); // F8: no "scopeKey"
  const wfDef = wf?.definitionJson as WorkflowDefinition | undefined;
  const usable = wfDef && Array.isArray(wfDef.steps) ? wfDef : null;
  // doc 81 Đợt 7 I2 (null on a DB error ⇒ cannot approve); final wave F6 — only for an approver's screen of a paused run.
  // doc 81 Đợt 8 O2/O3 — the program checks come from the SAME reading as the digest.
  // doc 81 Đợt 10 C (D7) — an EDGE run's digest from its node's reports; the assignment unreadable ⇒ no digest (fail-closed,
  // never a central read of what may be an edge run's controller).
  let binding: { digest: string | null; programs: ProgramCheck[] } | null = null;
  let onEdge: Awaited<ReturnType<typeof readEdgeAssignment>> | undefined;
  if (usable && opts.bindingDigest === true && (run.status === "awaiting_confirm" || run.status === "held")) {
    try {
      onEdge = await readEdgeAssignment(d, run.id);
    } catch {
      onEdge = undefined;
    }
    binding =
      onEdge === undefined
        ? { digest: null, programs: [] }
        : onEdge
          ? await edgeBindingDetail(d, onEdge.edgeNodeId, usable, { display: true })
          : await computeBindingDetail(d, usable, undefined, { display: true }); // Đợt 9 R-9-b — screen only: display cache allowed
  }
  // R1b-2b-2a A2(n) (M-4) — THE fact for the approver's screen: the steps whose held compensation a Continue would write (an edge run's rows too:
  // a crash or a lost marker), so the Studio never asks for a reason on a real gate and never misses one
  const paused = run.status === "awaiting_confirm" || run.status === "held";
  const ctxKhongRo = (run.contextJson as Record<string, unknown> | null) ?? {};
  const khongRoCho = !paused ? [] : [...new Set([...buTruKhongRoCho(ctxKhongRo), ...(usable && onEdge ? buTruKhongRoCho({ foeResumeState: edgeResumeStateOf(usable, stepRows, new Set()).state }) : [])])];
  return {
    run,
    khongRoCho,
    defHash: usable ? hashWorkflowDefinition(usable) : null,
    bindingDigest: binding ? binding.digest : null,
    programChecks: binding ? binding.programs : null,
    apiKey: opts.bindingDigest === true ? await apiKeyViewOf(d, run) : null, // doc 81 Đợt 9 R3 — the approver's screen only
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
  let rcLuot: RunContext | null = null; // T7 lượt sửa 1 (K1) — the walk in hand, for the end gate
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
      return { ...(await resendAbortStops(runId, run, user, scopeFor(user, opts.scope), false)), enabled: true }; // fix 3 — R-6-d
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

    // R1b-2b-2a A2(n) (n3, C-2) — THE fact: a pending held compensation of an unknown outcome, at ANY resumable status, on any route. A resume
    // would send it to a device whose state is unknown ⇒ ONLY a person with machine-control rights (the router's floor, re-checked: the engine
    // has system callers too — auto-resume, the QT pump — which are refused) and a REQUIRED reason, audited. An edge run's rows may add steps
    // the context does not name (crash, lost marker): checked again on its branch below. Out of scope was already answered "not found" above. A
    // rejection (= abort) is never refused here (R-1: reason optional, it only sends STOPs).
    const ctxKhongRo = (run.contextJson as Record<string, unknown> | null) ?? {};
    const khongRoCho = buTruKhongRoCho(ctxKhongRo);
    // A2(n) T7b-2 (3a, G4i) — a SYSTEM rejection (the QT pump: its business step failed, or an external signal it resolves) of a latched run is no person's decision: it does not end the run (decision 1;
    // decision B is a person's only). Nothing is claimed, sent or compensated; the run stays as it is and its URGENT stands, a person Continues or Aborts
    if (!decision.approved && !(Number.isSafeInteger(user.id) && user.id > 0) && (runDaChotKhongRo(ctxKhongRo) || chotTuHang(((await readRunStepRows(runId)) ?? []) as Parameters<typeof chotTuHang>[0]) !== null)) {
      return { ok: false, enabled: true, runId, status: run.status, message: `Run ${runId} has a command whose outcome is unknown: a system rejection does not end it. It waits for a person (Continue or Abort); the URGENT already raised stands.` };
    }
    let lyDoKhongRo = khongRoCho.length > 0 && decision.approved ? await xetTiepTucKetCucKhongRo(user, decision.note) : null;
    if (khongRoCho.length > 0 && !decision.approved) {
      void ghiAuditKetCucKhongRo(user, runId, "abort", { via: "reject", stepIds: khongRoCho, reason: decision.note?.trim() || null });
    }

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
      // doc 81 Đợt 7 task I6 — with a hook the claim also writes THIS rejection's token into the run context (server-only,
      // FOE_REJECT_CLAIM_CTX_KEY): when the claim's reply is lost, the re-read below recognises its OWN claim by it.
      const claimToken = hooks.compensate ? `${Date.now().toString(36)}-${randomBytes(8).toString("hex")}` : null;
      const claim = claimPausedRun(
        runId,
        hooks.compensate ? "compensating" : "aborted",
        hooks.compensate
          ? { contextJson: { ...(((run.contextJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>), [FOE_REJECT_CLAIM_CTX_KEY]: claimToken } }
          : { finishedAt: new Date(), error: rejectedBy(reason) },
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
        // A2(n) T7 (decision B, 3a) — a PERSON's rejection ends a latched run whatever its URGENT did: one bounded URGENT and the audit, after the sweep. A system rejection is not this
        if (Number.isSafeInteger(user.id) && user.id > 0) await nghiaVuKetThucNguoi(runId, user, "gateRejected", { live: liveRuns.get(runId) ?? null, ctx0: (run.contextJson as Record<string, unknown> | null) ?? {}, owner: run.startedBy ?? null, stops: abortStops, reason: reason ?? null });
        return { abortStops, confirmed };
      };
      // doc 81 Đợt 7 task I6 — the rejection is finished (sweep, hook, final write, gate row) AT MOST ONCE per call, whichever
      // path gets there: the hook (the QT business compensation) can never run twice for one claim.
      let finishing: Promise<{ abortStops: AbortStopReport; confirmed: boolean }> | null = null;
      const finishOnce = () => (finishing ??= finishRejection());
      try {
        await withDeadline(claim, STOP_DB_STEP_DEADLINE_MS, `FOE reject run ${runId} claim`);
      } catch (err) {
        if (err instanceof TRPCError) throw err; // LOST the claim (CONFLICT) — nothing was sent, nothing will be
        console.error(`[FOE] rejection of run ${runId}: claim not answered in time — ${(err as Error)?.message ?? err}; STOPs follow if it lands as won`);
        void claim.then(
          () => finishOnce().catch(() => undefined),
          // fix 2 (N4) — the claim FAILED after the bound with something other than "lost" (e.g. its reply was lost after it
          // committed): re-read the run (bounded); if it shows THIS rejection's claim, finish it (sweep + gate row).
          async (lateErr: unknown) => {
            if (lateErr instanceof TRPCError) return; // lost the claim: nothing to do
            const row = await rereadRejectClaim(runId);
            if (row === undefined) {
              // ★ CANNOT DECIDE (doc 81 Đợt 7 I6) — the run could not be re-read (3 bounded tries): whether THIS claim won is
              // unknown, so nothing is finished here (no STOP from this path, no business compensation — it must never run
              // for a claim that may be another decision's). Said loudly and audited. The run stays where the database has
              // it: an ABORT of the run (it lands on 'compensating' or 'awaiting_confirm' alike) sweeps its STOPs.
              console.error(`[FOE] rejection of run ${runId}: claim outcome not decided (run not re-read) — rejection NOT finished; abort the run to send its STOP steps, or use the machine's direct STOP / E-STOP`);
              auditAbortStop(user, runId, "rejectClaimUndecided", { stepIds: [], hook: !!hooks.compensate });
              return;
            }
            // With a hook (I6): THIS claim's token on a 'compensating' row — or on an 'aborted' one (an abort landed after the
            // claim committed; its business compensation has still not run) ⇒ ours. Another decision's claim never matches
            // the token. Without a hook (fix 2 N4): 'aborted' + this rejection's own error text.
            const ctx = (row?.contextJson as Record<string, unknown> | null) ?? {};
            const ours = hooks.compensate
              ? claimToken !== null && ctx[FOE_REJECT_CLAIM_CTX_KEY] === claimToken && (row?.status === "compensating" || row?.status === "aborted")
              : row?.status === "aborted" && row.error === rejectedBy(reason);
            if (ours) await finishOnce().catch(() => undefined);
          },
        );
        return {
          ok: false,
          enabled: true,
          runId,
          reason: FOE_ABORT_UNCONFIRMED,
          message: `Rejection of run ${runId} not confirmed by the database in time — STOP steps handed to the dispatcher (the machine has not confirmed them): 0; ${chuThuLai()}`,
          abortStops: emptyAbortReport(),
        };
      }
      const { abortStops, confirmed } = await finishOnce();
      if (!confirmed) {
        return {
          ok: false,
          enabled: true,
          runId,
          reason: FOE_ABORT_UNCONFIRMED,
          message: `Rejection of run ${runId} not confirmed by the database in time — STOP steps handed to the dispatcher (the machine has not confirmed them): ${abortStops.sent.length}; ${chuThuLai()}`,
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
    // doc 81 Đợt 7 I fix 1 (review M-3) — also on "Continue" of a 'held' (interrupted) run: it resumes actuation on the
    // definition and device configuration the screen showed, so both are checked server side for it too.
    const screenBound = run.status === "awaiting_confirm" || run.status === "held";
    if (screenBound && decision.expectedDefHash !== undefined && decision.expectedDefHash !== hashWorkflowDefinition(def)) {
      throw appError(
        "CONFLICT",
        "OPERATION_FAILED",
        { operation: "resumeOrchestrationRun", reason: "definitionChanged" },
        `Workflow "${wf.ref}" was redeployed after your screen loaded — reload and review the current definition before approving.`,
      );
    }
    // doc 81 Đợt 7 task I2 — the approver must also have been looking at THIS device configuration (adapter / tags / robot the
    // commands resolve to — the binding digest the approval will record). Computed ONCE here and recorded below, so the
    // approval covers exactly what was checked. Changed since the screen loaded, not computable now (DB error — cannot
    // decide ⇒ refused), or a screen-bound approval without it ⇒ CONFLICT, nothing changes.
    // doc 81 Đợt 8 O2 — the digest includes the program checksum of every supported controller (read now, bounded): a
    // program changed since the screen loaded, or a supported controller whose checksum cannot be read ⇒ the same CONFLICT.
    // doc 81 Đợt 9 task S2 — is this run executed by an edge node? Read BEFORE the claim (and, Đợt 10 C fix review 1, ONCE,
    // before the digest: an edge run's digest comes from its node's reports — D7); undecidable ⇒ the approval / Continue is
    // refused (never urgent: stopping goes through abort / reject / the machines' STOP / E-STOP).
    let edgeAssigned: Awaited<ReturnType<typeof readEdgeAssignment>> = null;
    try {
      edgeAssigned = await readEdgeAssignment(d, runId);
    } catch {
      return { ok: false, enabled: true, runId, status: run.status, message: `Run ${runId}: whether an edge node executes it could not be read — retry.` };
    }
    let checked: { digest: string | null; programs: ProgramCheck[] } | undefined;
    if (screenBound && (decision.expectedDefHash !== undefined || decision.expectedBindingDigest !== undefined)) {
      checked = edgeAssigned ? await edgeBindingDetail(d, edgeAssigned.edgeNodeId, def) : await computeBindingDetail(d, def); // D7
      const checkedDigest = checked.digest;
      if (decision.expectedBindingDigest === undefined || checkedDigest === null || checkedDigest !== decision.expectedBindingDigest) {
        throw appError(
          "CONFLICT",
          "OPERATION_FAILED",
          { operation: "resumeOrchestrationRun", reason: "bindingChanged" },
          `The device configuration of workflow "${wf.ref}" (adapter, tags or robot its commands use, or the program in a controller it writes to) changed after your screen loaded, or could not be read — reload and review it before approving.`,
        );
      }
    }


    // doc 80 ORC-03 — approving a hitl_gate enforces its approverRoles / fourEyes (FORBIDDEN).
    // Only a run paused AT a gate ('awaiting_confirm'); an interrupted 'held' run has no open gate.
    if (run.status === "awaiting_confirm" && gateStepId) {
      const gate = findStepDeep(def.steps, gateStepId);
      if (gate && gate.type === "hitl_gate") await assertGateApprover(gate, run, user);
    }

    // doc 80 ORC-02 — CAS `UPDATE … SET status='running' WHERE id=$1 AND status IN
    // ('awaiting_confirm','held') RETURNING *`: 0 rows ⇒ another resume already claimed it ⇒ CONFLICT.
    // Exactly one caller proceeds to drive the run. Task 9 — also pinned to the gate read above
    // (the one the approver-role check ran against): a run that moved on to another gate ⇒ CONFLICT.
    // fix round 1 (R-4-g) — the claim also CLEARS currentStepId: it only names the step a run is paused AT; leaving it
    // set made a later 'held' (interrupted) resume re-stamp a gate that had already passed.
    const pausedAtGate = run.status === "awaiting_confirm"; // read BEFORE the claim mutates the run
    // doc 81 Đợt 7 task I3 — the walk below executes the CURRENT head: its version is added to the run's executed versions
    // (only added — every other params key, the apiRun marker included, is kept). A legacy run (no record) gets none.
    const executed = runExecutedVersions(run);
    const headVersion = wf.version ?? 1;
    const versionPatch =
      executed && !executed.includes(headVersion)
        ? { paramsJson: { ...((run.paramsJson as Record<string, unknown> | null) ?? {}), [FOE_DEF_VERSIONS_PARAM]: [...executed, headVersion] } }
        : {};
    // doc 81 Đợt 9 final wave F4 (final review M1) — a run an EDGE NODE executes: the claim, the gate row and the hand-back to
    // 'queued' are ONE transaction (it used to be three writes: 'running' → gate row → 'queued', and a crash between them left
    // the run 'running' with no claim, recoverable only by a manual abort). The node cannot claim before the commit (its claim
    // is a compare-and-set on 'queued'); an abort landing first wins the CAS below (CONFLICT, nothing written). Nothing is
    // dispatched here, so there is nothing to STOP.
    if (edgeAssigned) {
      // doc 81 Đợt 10 C (D7) — the program checks an edge run's approval records are its NODE's reports (central never reads them)
      const recordedEdge = gateStepId && pausedAtGate ? checked ?? (await edgeBindingDetail(d, edgeAssigned.edgeNodeId, def)) : null;
      const human = Number.isInteger(user.id) && user.id > 0;
      // doc 81 Đợt 10 C (N4) — a Continue re-queues the run for its node: the "edge unreachable" / "edge held" / interrupted
      // marks of the hold are cleared with the claim (the Studio stops showing the hold); `interruptedEarlier` keeps the doubt
      // the abort sweep needs (storedSweepSource). The run's own context (branch decisions, dispatched steps) is kept.
      const ctx0 = ((run.contextJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
      // doc 81 Đợt 10 C fix review 2 (R-10-ae) — what the next segment must NEVER redo, derived from the STEP ROWS central wrote
      // and its own authorisation ledger (a context mark may only ADD an outcome-unknown step). Ambiguous rows ⇒ the Continue /
      // approval is REFUSED (never a guess that could re-send motion). A read error ⇒ refused too.
      let resume: ResumeStateMap;
      let derivedRows: Awaited<ReturnType<typeof edgeResumeStateFor>>["rows"];
      let derivedStops: ReadonlySet<string>;
      try {
        const derived = await edgeResumeStateFor(d, runId, def, Array.isArray(ctx0[OUTCOME_UNKNOWN_CTX_KEY]) ? (ctx0[OUTCOME_UNKNOWN_CTX_KEY] as unknown[]).map(String) : []);
        derivedRows = derived.rows;
        derivedStops = derived.stops;
        if (derived.ambiguous.length) {
          // data-raw-ok: an operator-facing refusal naming the steps (machine-readable prefix EDGE_RESUME_AMBIGUOUS)
          return { ok: false, enabled: true, runId, status: run.status, message: `EDGE_RESUME_AMBIGUOUS(${derived.ambiguous.join(",")}): the step rows of run ${runId} do not say whether these steps failed before their compensation ran — it is NOT continued (nothing would be re-sent on a guess). Abort the run, or check the equipment.` };
        }
        resume = derived.state;
      } catch {
        return { ok: false, enabled: true, runId, status: run.status, message: `Run ${runId}: its step rows could not be read to continue it safely — retry.` };
      }
      // R1b-2b-2a A2(n) (C-2) — the FACT on an edge run: what the rows say the re-walk would write, whatever the hold's reason, the marker or the
      // route (a gate approval, journalFull, a sibling's reason, a crash before the compensation row): the same check, before any change
      const khongRoEdge = [...new Set([...khongRoCho, ...buTruKhongRoCho({ foeResumeState: resume })])];
      if (khongRoEdge.length > 0) {
        lyDoKhongRo ??= await xetTiepTucKetCucKhongRo(user, decision.note);
        resume = themBuocHongKhiTiepTuc(def, derivedRows, resume, derivedStops); // I-4 — nothing forward
        await auditTiepTucKhongRo(user, runId, def, khongRoEdge, lyDoKhongRo, ctx0, derivedRows, { edgeNodeId: edgeAssigned.edgeNodeId });
      }
      // R1b-2b-2a A2(n) — the outcome-unknown marker is cleared by the Continue that passed its checks (lyDoKhongRo); the approval it records is the
      // only thing that lets the walker write a held compensation (replaced at every Continue)
      const khongRoDuyet = khongRoEdge.length > 0 ? { [KHONG_RO_DUYET_CTX_KEY]: duyetKhongRo(def, khongRoEdge, user) } : {};
      // A2(n) (b, C-C) — the latch crosses the segment boundary here, at EVERY hand-back (a Continue, a gate approval): any row with the code, whatever its
      // step (a compensation's own unknown, a STOP-typed step), any unknown state. Central's own key, never an edge patch's; never removed
      const chotEdge = ctx0[KET_CUC_KHONG_RO_CHOT_CTX_KEY] == null ? chotTuHang(derivedRows, resume) : null;
      const marked = chotEdge !== null || EDGE_HOLD_MARK_KEYS.some((k) => k in ctx0) || (lyDoKhongRo !== null && KET_CUC_KHONG_RO_CTX_KEY in ctx0) || KHONG_RO_DUYET_CTX_KEY in ctx0;
      // fix review 4 (B F-B2-1) — a Continue of a HELD edge run records WHO continued it (central-only key — the edge context
      // filter refuses it): central's /authorize evaluates the engine policy with that user's role, as central's own resumed walk
      // would (rc.user = the resumer). A gate approval records nothing here (the approver is the gate row's).
      const resumedBy = !pausedAtGate ? { [EDGE_RESUMED_BY_CTX_KEY]: { userId: Number.isInteger(user.id) && user.id > 0 ? user.id : 0, at: Date.now() } } : {};
      const markPatch =
        marked || Object.keys(resume).length || RESUME_STATE_CTX_KEY in ctx0 || Object.keys(resumedBy).length
          ? {
              contextJson: {
                ...Object.fromEntries(Object.entries(ctx0).filter(([k]) => !EDGE_HOLD_MARK_KEYS.includes(k) && k !== RESUME_STATE_CTX_KEY && k !== KHONG_RO_DUYET_CTX_KEY && !(lyDoKhongRo !== null && k === KET_CUC_KHONG_RO_CTX_KEY))),
                ...(ctx0.interrupted === true || ctx0[INTERRUPTED_EARLIER_CTX_KEY] === true ? { [INTERRUPTED_EARLIER_CTX_KEY]: true } : {}),
                ...(Object.keys(resume).length ? { [RESUME_STATE_CTX_KEY]: resume } : {}),
                ...resumedBy,
                ...khongRoDuyet,
                ...(chotEdge ? { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: chotEdge } : {}),
              },
            }
          : {};
      const out = await d.transaction(async (tx) => {
        const claimedRows = await tx
          .update(orchestrationRuns)
          .set({ status: "queued", updatedAt: new Date(), currentStepId: null, ...versionPatch, ...markPatch })
          .where(
            and(
              eq(orchestrationRuns.id, runId),
              inArray(orchestrationRuns.status, RESUMABLE_STATUSES),
              pinnedStepId != null ? eq(orchestrationRuns.currentStepId, pinnedStepId) : isNull(orchestrationRuns.currentStepId),
            ),
          )
          .returning({ id: orchestrationRuns.id });
        if (claimedRows.length === 0) {
          throw appError(
            "CONFLICT",
            "OPERATION_FAILED",
            { operation: "resumeOrchestrationRun", reason: "runAlreadyClaimed" },
            `Run ${runId} was already resumed, rejected or aborted by another request (or moved to another gate).`,
          );
        }
        let gateWritten = false;
        if (gateStepId && pausedAtGate && recordedEdge) {
          const [prior] = await tx
            .select({ status: orchestrationRunSteps.status })
            .from(orchestrationRunSteps)
            .where(and(eq(orchestrationRunSteps.runId, runId), eq(orchestrationRunSteps.stepId, gateStepId)))
            .limit(1);
          if (prior?.status !== "completed") {
            const values = {
              status: "completed" as never,
              attempt: 0,
              resultJson: gateApprovalResult(decision.note, human ? user.id : null, def, recordedEdge),
              error: null,
              finishedAt: new Date(),
            };
            await tx
              .insert(orchestrationRunSteps)
              .values({ runId, stepId: gateStepId, stepType: "hitl_gate", startedAt: null, ...values })
              .onConflictDoUpdate({ target: [orchestrationRunSteps.runId, orchestrationRunSteps.stepId], set: values });
            gateWritten = true;
          }
        }
        return { gateWritten };
      });
      if (out.gateWritten && gateStepId) void appendRunEvent(runId, "TASK_COMPLETED", { taskId: gateStepId, ts: Date.now() });
      if (approvalStopOnlyOut) auditStopOutOfScope(user, def, runId, "approve", approvalStopOnlyOut); // E2 (L-7: allowed, audited)
      return { ok: true, enabled: true, runId, status: "queued", edgeNodeId: edgeAssigned.edgeNodeId };
    }

    // R1b-2b-2a A2(n) (m-6) — the audit row first: no write of a held compensation without it
    if (lyDoKhongRo !== null) await auditTiepTucKhongRo(user, runId, def, khongRoCho, lyDoKhongRo, ctxKhongRo, await d.select().from(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, runId)));
    await claimPausedRun(runId, "running", { currentStepId: null, ...versionPatch }, pinnedStepId);
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
        // Đợt 8 O2 — ONE reading for the digest and the program checks it records (the screen's, else read now).
        const recorded = checked ?? (await computeBindingDetail(d, def));
        await upsertStep(runId, gateStepId, "hitl_gate", {
          status: "completed",
          result: gateApprovalResult(decision.note, human ? user.id : null, def, recorded),
          finishedAt: new Date(),
        });
      }
    }

    // doc 81 Đợt 9 task S2 — a run an EDGE NODE executes is never walked here (final wave F4: handed back above, in one transaction).
    // buildRunContext nạp rc.completed từ _run_steps (đã gồm gate vừa đánh dấu completed
    // ở trên + mọi bước đã xong lần trước) → execStep bỏ qua chúng khi đi lại.
    const rc = await buildRunContext(run, def, user);
    rcLuot = rc;
    delete rc.context[KHONG_RO_DUYET_CTX_KEY]; // only THIS Continue's approval counts (a crash can leave an older one in the row)
    if (lyDoKhongRo !== null) {
      // R1b-2b-2a A2(n) — the Continue passed its checks and won the claim: the approval recorded, the marker cleared (persisted with the walk's
      // context; a crash before that keeps it ⇒ the run comes back needing a person again — fail-safe). I-4 — the other failed steps are done:
      // the re-walk writes exactly the held compensation(s), nothing forward.
      const hangBuoc = await d.select().from(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, runId));
      const stopIds = new Set<string>();
      for (const s of allStepsOf(def.steps)) if (s.type === "command" && (await isStopCandidate(s, rc.machineById))) stopIds.add(s.id);
      rc.context[RESUME_STATE_CTX_KEY] = themBuocHongKhiTiepTuc(def, hangBuoc, (rc.context[RESUME_STATE_CTX_KEY] as ResumeStateMap | undefined) ?? {}, stopIds);
      rc.context[KHONG_RO_DUYET_CTX_KEY] = duyetKhongRo(def, khongRoCho, user);
      delete rc.context[KET_CUC_KHONG_RO_CTX_KEY];
    }
    const status = await driveRunFromResume(rc);
    return { ok: status !== "failed" && status !== "aborted", enabled: true, runId, status };
  } catch (err) {
    // CONFLICT (lost the CAS) / FORBIDDEN (gate policy) are business refusals raised BEFORE any
    // state change — surface them as-is; never mark the run failed for them.
    if (err instanceof TRPCError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    // doc 80 ORC-01 (fix round 1) — conditional write (see startRun): never 'aborted' → 'failed'. A2(n) T7 (C1, R3-A) — through the end gate
    const ghi = await ketThucNgoaiLe(runId, message, rcLuot);
    return { ok: false, enabled: true, runId, status: ghi, message };
  }
}

/**
 * The result row of an APPROVED gate — ONE builder for the central walk and the edge hand-back (final wave F4), so the two can
 * never drift: approvedBy + approvalSource "server" only for a real user (id > 0, else "system", never counts); defHash binds
 * the approval to the definition; bindingDigest (Đợt 5 E3 / Đợt 7 I2 — null ⇒ the approval never counts, fail-closed) and the
 * per-controller program checks (Đợt 8 O2) are the ones computed server side for this decision.
 */
function gateApprovalResult(
  note: string | null | undefined,
  approverId: number | null,
  def: WorkflowDefinition,
  recorded: { digest: string | null; programs: ProgramCheck[] },
): Record<string, unknown> {
  return {
    approved: true,
    note: note ?? null,
    ...(approverId !== null ? { approvedBy: approverId } : {}),
    approvalSource: approverId !== null ? FOE_APPROVAL_SOURCE_SERVER : FOE_APPROVAL_SOURCE_SYSTEM,
    defHash: hashWorkflowDefinition(def),
    bindingDigest: recorded.digest,
    programChecks: programChecksRecord(recorded.programs),
  };
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
  const st = await withLiveRun(rc, async () => {
    // The CAS already set 'running'. Re-assert it GUARDED: an abort that landed between the CAS
    // and this registration (abortRun could not reach a live handle yet) must stop the walk here.
    const stillOurs = await rc.store.setStatusUnlessAborted(rc.runId, "running");
    if (!stillOurs) return "aborted";
    if (daChotKhongRo(rc)) {
      batDauLuotStop(rc); // A2(n) (I-F) — a walk that finds the run latched: boot, Continue, a gate approval, the next edge segment
      // A2(n) (C-7) — a STOP goes before a compensation a person approved, or at the same moment: a hung one does not hold that compensation past D
      if (duongBuTruCua(rc)) await withDeadline(Promise.allSettled(rc.stopNen ?? []), STOP_DB_STEP_DEADLINE_MS, `FOE run ${rc.runId} first STOP pass`).catch(() => undefined);
    }
    const out = await execSequence(rc, rc.def.steps);
    return finishWalk(rc, out);
  });
  await sauLuotDi(rc);
  return st;
}

// ── final wave F8 — migration 0367 (orchestration_workflows."scopeKey") schema guard ─────────────────────────────────
/**
 * doc 81 Đợt 7 final wave F8 (final review #8) — a restart onto this code BEFORE mig 0367 is applied makes every full-row
 * select of orchestration_workflows fail with 42703. Instead of a silent outage:
 *   • boot (rehydrateInterruptedRuns, the FOE boot hook) logs ONE loud FATAL line naming the fix (apply 0367);
 *   • the workflow-management procedures (orchestrationRouter: list / get / deploy / rollback / versions / start / simulate /
 *     delete / duplicate) answer a clear "migration missing" error (assertFoeSchemaReady) instead of the database's text;
 *   • ★ L-7 — the STOPPING paths are NOT gated: run lists / getRun / abort / gate rejection keep working, and the engine reads
 *     they need select explicit columns WITHOUT "scopeKey" (WF_CORE_COLS), so an abort sweep still loads the stored
 *     definition and SENDS its STOP steps (and a live run uses its in-memory definition, as before).
 * State: "unknown" (no DB / another error) never blocks anything — those calls fail on their own. "missing" is re-checked at
 * most every FOE_SCHEMA_RECHECK_MS, so applying 0367 while the server runs lifts the guard without a restart.
 */
export const FOE_SCHEMA_RECHECK_MS = 30_000;
const foeSchema = { state: "unknown" as "ok" | "missing" | "unknown", checkedAt: 0 };

function isUndefinedColumn(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === "42703" || e?.cause?.code === "42703";
}

/** Probe the 0367 column (one bounded read). Logs the FATAL line at boot, and once per change of state afterwards. */
export async function checkFoeSchema(opts: { boot?: boolean } = {}): Promise<"ok" | "missing" | "unknown"> {
  const before = foeSchema.state;
  let state: "ok" | "missing" | "unknown" = "unknown";
  try {
    const d = await getDb();
    if (d) {
      await d.select({ scopeKey: orchestrationWorkflows.scopeKey }).from(orchestrationWorkflows).limit(1);
      state = "ok";
    }
  } catch (err) {
    state = isUndefinedColumn(err) ? "missing" : "unknown";
  }
  foeSchema.checkedAt = Date.now();
  if (state === "unknown" && before !== "unknown") return before; // a transient error never flips a known state
  foeSchema.state = state;
  if (state === "missing" && (opts.boot || before !== "missing")) {
    console.error(
      '[FOE] FATAL: database migration 0367 is NOT applied (orchestration_workflows."scopeKey" is missing). Orchestration ' +
        "workflow management is UNAVAILABLE until it is applied: node scripts/apply-migration-0367.mjs --dev-only (re-checked " +
        `every ${FOE_SCHEMA_RECHECK_MS / 1000} s; no restart needed). Run lists, abort and gate rejection keep working and still ` +
        "send the STOP steps of stored runs; the machines' direct STOP / E-STOP are unaffected.",
    );
  } else if (state === "ok" && before === "missing") {
    console.log("[FOE] migration 0367 is now applied — orchestration workflow management available again.");
  }
  return state;
}

/** true ⇔ 0367 is known to be MISSING (re-checked at most every FOE_SCHEMA_RECHECK_MS). "unknown" ⇒ false (never blocks). */
export async function foeSchemaMissing(): Promise<boolean> {
  if (foeSchema.state === "ok") return false;
  if (Date.now() - foeSchema.checkedAt >= (foeSchema.state === "unknown" ? 5_000 : FOE_SCHEMA_RECHECK_MS)) await checkFoeSchema();
  return foeSchema.state === "missing";
}

/** The clear refusal of a workflow-management call while 0367 is missing (never used on a STOPPING path — L-7). */
export async function assertFoeSchemaReady(): Promise<void> {
  if (await foeSchemaMissing()) {
    throw appError(
      "PRECONDITION_FAILED",
      "FEATURE_NOT_CONFIGURED",
      { feature: "orchestration (database migration 0367)" },
      "Orchestration is unavailable: database migration 0367 is not applied — an administrator runs scripts/apply-migration-0367.mjs. Aborting runs and the machines' direct STOP / E-STOP still work.",
    );
  }
}

/** For tests: forget the cached schema state. */
export function _resetFoeSchemaState(): void {
  foeSchema.state = "unknown";
  foeSchema.checkedAt = 0;
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
  /**
   * R1b-2b-2a A2(m2) — the runs interrupted while COMPENSATING, and what the boot did with each: `held` (one top-level compensation in
   * flight — not re-sent: `lyDo`), `sent` (a pinned STOP compensation re-sent ONCE at boot ⇒ the run ends 'failed' as its step did),
   * `failed` (several / nested / undecidable ⇒ 'failed' + URGENT), `none` (nothing in flight ⇒ 'failed' as before).
   */
  compensations?: Array<{ runId: number; compId: string | null; outcome: "held" | "sent" | "failed" | "none"; reason?: string }>;
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
      // R1b-2b-2a A2(m2) — a run held because a COMPENSATION was interrupted: only the guarded boot re-send (b1–b4) or a person continues it
      if (BU_TRU_BI_NGAT_CTX_KEY in ctx) continue;
      // R1b-2b-2a A2(n) — a run held because a command's outcome is unknown waits for a PERSON (resumeRun refuses a system Continue anyway).
      // A latched run with no hold yet (a crash before the split) IS walked: the forward sink writes nothing forward, and the walk sends the STOP and raises the URGENT
      if (buTruKhongRoCho(ctx).length > 0) continue;
      // doc 81 Đợt 9 task S2 — an edge run interrupted on its node waits for a person's Continue (undecidable ⇒ skipped)
      const onEdge = await readEdgeAssignment(d, runId).catch(() => "unknown" as const);
      if (onEdge !== null) continue;
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
 *     R1b-2b-2a A2(m2) (L-7) — NGOẠI LỆ, xem foeBuTruBiNgat: ĐÚNG MỘT bù trừ cấp đỉnh chưa kết thúc (running / held / pending) ⇒
 *     'held' + trạng thái tiếp tục compensationHeld của bước đó (một lần Tiếp tục CHỈ gửi lại bù trừ ấy, bước tiến không chạy lại)
 *     + URGENT; và nếu nó là STOP GHIM thoả b1–b3 (thời điểm ý định theo đồng hồ CSDL còn trong D, thiết bị không thuộc edge, không
 *     đổi chủ, không lệnh nào khác tới sau) ⇒ boot gửi lại ĐÚNG MỘT LẦN qua commandDispatcher (mọi cổng, khoá mới, hàng uỷ quyền mới)
 *     + URGENT (cả khi thành công) + audit bằng chứng. Hai bù trừ trở lên / lồng / không đọc được ⇒ 'failed' + URGENT (không đoán).
 *   • 'awaiting_confirm' / 'held' → BỎ QUA. Đây là WAIT BỀN VỮNG chờ người — không cần
 *     rehydrate; một người sẽ resume qua resumeRun như thường.
 *
 * FAIL-SAFE tuyệt đối: KHÔNG bao giờ ném ra ngoài (không được chặn khởi động server). DB chưa
 * kết nối → trả kết quả rỗng. KHÔNG flag-gated: dọn cả run cũ tạo khi FOE còn bật.
 */
export async function rehydrateInterruptedRuns(): Promise<RehydrateResult> {
  const result: RehydrateResult = { enabled: foeEnabled(), scanned: 0, interrupted: 0, failed: 0, runIds: [] };
  // R1b-2b-2a A2(m2) — runs interrupted while ONE top-level compensation was in flight: held / re-sent after the scan
  const buTru: BuTruChoXuLy[] = [];
  const compensations: NonNullable<RehydrateResult["compensations"]> = [];
  // final wave F8 — the boot-time schema check of migration 0367 (this function is the FOE's boot hook; it never throws).
  await checkFoeSchema({ boot: true });
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
    // doc 81 Đợt 9 task S2 — a run an EDGE NODE executes is not this process's to rehydrate: its walker lives on the node (a
    // queued one waits for its claim); the node itself declares a lost walker interrupted. Undecidable ⇒ none is touched.
    let onEdge: Set<number>;
    try {
      onEdge = await edgeAssignedRunIdsAmong(d, runsRows.map((r) => r.id));
    } catch (err) {
      console.error(`[FOE] rehydrate: which runs edge nodes execute could not be read — no run is rehydrated this time: ${(err as Error)?.message ?? err}`);
      onEdge = new Set(runsRows.map((r) => r.id));
    }
    const stuck = runsRows.filter((r) => activeStatuses.includes(r.status) && !onEdge.has(r.id));
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
        // R1b-2b-2a A2(m2) — WHICH compensation was in flight (step rows + deployed definition; unreadable ⇒ undecidable, never a guess)
        const pl = await phanLoaiBuTruCuaRun(d, run, ctx);
        // fix round 3 (I-1, controller rule) — a 'compensating' run that carries a boot re-send CLAIM nonce (any boot) never takes the plain
        // path: its compensation row may already say 'compensated' / 'failed' (the attempt's last row write landed, the process died before
        // the outcome write), which classifies as "nothing in flight" ⇒ it would be failed SILENTLY. It goes to giuHoacGuiLaiBuTru: the
        // decision stops at the spent try, and the stale branch holds it + URGENT + audit with the text of that row (no second send).
        const dauLuot = dauBuTruCua(ctx);
        const daNhan = typeof dauLuot?.dangGuiLai === "string" && dauLuot.dangGuiLai !== "";
        // (polish m-3) a claim marker that does not name its step + compensation cannot be held safely: a Continue would find no resume state
        // for the real failed step and walk it FORWARD again ⇒ failed + URGENT + audit (never a guess, never silent)
        const dauThieu = pl.k.kind !== "mot" && daNhan && !(typeof dauLuot?.stepId === "string" && dauLuot.stepId !== "" && typeof dauLuot?.compId === "string" && dauLuot.compId !== "");
        if (dauThieu) {
          const lyDo = "a previous boot claimed a STOP re-send but its record does not name the step / compensation — which STOP was being sent cannot be told";
          await setRunStatus(run.id, "failed", {
            finishedAt: now,
            error: `Interrupted by server restart while compensating (run ${run.id}): ${lyDo} — not resumed, nothing re-sent; check the machine on site now.`,
            contextJson: markedCtx,
          });
          result.failed += 1;
          compensations.push({ runId: run.id, compId: null, outcome: "failed", reason: "markerIncomplete" });
          await ghiAuditBuTru(run.id, false, { outcome: "failed", reason: "markerIncomplete", reasonText: lyDo, staleAttempt: dauLuot?.dangGuiLai ?? null, marker: dauLuot });
          await canhBaoBuTruBiNgat(d, run, { loai: "failed", compId: null, stepId: null, lyDo, dauLan: dauLanNgat(run) });
        } else if (pl.k.kind === "mot" || daNhan) {
          const k: Extract<PhanLoaiBuTru, { kind: "mot" }> =
            pl.k.kind === "mot" ? pl.k : { kind: "mot", stepId: String(dauLuot!.stepId), compId: String(dauLuot!.compId), error: "" };
          // held (and maybe re-sent once) by giuHoacGuiLaiBuTru after this scan; until then it stays 'compensating' (a crash meanwhile ⇒
          // the next boot sees it again)
          buTru.push({ run, markedCtx, k, def: pl.def ?? { ref: run.workflowRef ?? "", name: "", steps: [] }, wfVersion: pl.wfVersion });
          result.interrupted += 1;
        } else {
          const k = pl.k;
          await setRunStatus(run.id, "failed", {
            finishedAt: now,
            error:
              k.kind === "khong"
                ? `Interrupted by server restart while compensating (run ${run.id}); not auto-resumed.`
                : `Interrupted by server restart while compensating (run ${run.id}): ${moTaBuTruKhongDoan(k)} — not resumed, nothing re-sent; check the equipment now.`,
            contextJson: markedCtx,
          });
          result.failed += 1;
          compensations.push({ runId: run.id, compId: k.kind === "khong" ? null : k.compIds.join(",") || null, outcome: k.kind === "khong" ? "none" : "failed", ...(k.kind === "khong" ? {} : { reason: k.kind === "nhieu" ? "several" : k.lyDo }) });
          if (k.kind !== "khong") await canhBaoBuTruBiNgat(d, run, { loai: "failed", compId: k.compIds.join(",") || null, stepId: null, lyDo: moTaBuTruKhongDoan(k), dauLan: dauLanNgat(run) });
        }
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
  // R1b-2b-2a A2(m2) — the runs with ONE interrupted compensation: held + URGENT, or (b1–b4) its pinned STOP re-sent ONCE. Each is
  // bounded (decision ≤ HAN_XET_GUI_LAI_MS, the send ≤ what is left of D) and never throws; the boot hook does not wait on this function.
  const buTruXong = Promise.all(
    buTru.map((b) =>
      giuHoacGuiLaiBuTru(b)
        .then((o) => {
          compensations.push(o);
        })
        .catch((err: unknown) => {
          console.error(`[FOE] rehydrate: interrupted compensation of run ${b.run.id} not handled: ${(err as Error)?.message ?? err}`);
          compensations.push({ runId: b.run.id, compId: b.k.compId, outcome: "held", reason: "error" });
        }),
    ),
  );
  // doc 33 I5 (F8) — durable execution: when FOE_DURABLE, auto-continue the interrupted runs
  // instead of leaving them 'held' for manual resume. Default off → unchanged behavior.
  // (A2(m2): a run held for an interrupted compensation is skipped there — BU_TRU_BI_NGAT_CTX_KEY.)
  if (foeDurableEnabled() && result.runIds.length > 0) {
    const ar = await autoResumeInterruptedRuns(result.runIds);
    result.autoResumed = ar.resumed;
    if (ar.resumed > 0) console.log(`[FOE] durable: auto-resumed ${ar.resumed} interrupted run(s)`);
  }
  await buTruXong;
  if (compensations.length > 0) result.compensations = compensations;
  return result;
}

// ── R1b-2b-2a A2(m2) — a run interrupted while COMPENSATING (see foeBuTruBiNgat) ───────────────────────────────────────

/** The principal of the boot re-send (never a person: the run's gate approval, if any, is the authorisation row's confirmer). */
const SYSTEM_FOE_BOOT_USER: FoeUser = { id: 0, role: "system", name: "FOE boot STOP re-send" };

interface BuTruChoXuLy {
  run: OrchestrationRun;
  markedCtx: Record<string, unknown>;
  k: Extract<PhanLoaiBuTru, { kind: "mot" }>;
  def: WorkflowDefinition;
  wfVersion: number | null;
}

/** The classification of a 'compensating' run from its rows + the deployed definition; any read error / timeout ⇒ undecidable. */
async function phanLoaiBuTruCuaRun(
  d: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  run: OrchestrationRun,
  ctx: Record<string, unknown>,
): Promise<{ k: PhanLoaiBuTru; def: WorkflowDefinition | null; wfVersion: number | null }> {
  try {
    return await withDeadline(
      (async () => {
        const [wf] = await d.select(WF_CORE_COLS).from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, run.workflowId)).limit(1); // F8: no "scopeKey"
        const def = (wf?.definitionJson as WorkflowDefinition | undefined) ?? null;
        const rows = await d.select().from(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, run.id));
        return { k: phanLoaiBuTruBiNgat(def, rows, ctx), def, wfVersion: wf?.version ?? null };
      })(),
      HAN_XET_GUI_LAI_MS,
      `FOE rehydrate run ${run.id} compensation rows`,
    );
  } catch (err) {
    return { k: { kind: "khongRo", lyDo: `unreadable (${String((err as Error)?.message ?? err).slice(0, 160)})`, compIds: [] }, def: null, wfVersion: null };
  }
}

function moTaBuTruKhongDoan(k: Exclude<PhanLoaiBuTru, { kind: "khong" | "mot" }>): string {
  if (k.kind === "nhieu") return `${k.compIds.length} compensations (${k.compIds.join(", ")}) were in flight — which STOP was being sent cannot be told`;
  const why: Record<string, string> = {
    rejectionUnwind: "it was unwinding a gate rejection",
    definitionUnreadable: "its workflow definition could not be read",
    nested: "the compensation in flight belongs to a nested step",
    stepRowNotFailed: "the step of the compensation in flight is not recorded as failed",
  };
  return `${why[k.lyDo] ?? `its compensation state is ${k.lyDo}`}${k.compIds.length ? ` (${k.compIds.join(", ")})` : ""}`;
}

const lyDoText = (lyDo: string): string => (LY_DO_KHONG_GUI as Record<string, string>)[lyDo] ?? lyDo;

/**
 * ONE run with ONE interrupted top-level compensation: decide (b1–b3, foeBuTruBiNgat.xetGuiLaiBuTruBiNgat — DB facts, DB clock), then
 *   • not re-sendable ⇒ 'held' (compensationHeld: a Continue re-sends ONLY the compensation, the step is never re-run) + URGENT + audit;
 *   • re-sendable ⇒ fix round 1:
 *       (I-1) wait until the adapter's running session is the one its row names (choKetNoiSanSang — the dispatcher's own check), never
 *             longer than what is left of D; not up in time ⇒ held + URGENT, NOTHING sent, the single try NOT consumed;
 *       (I-2, m-5) re-check, in SQL on the DB clock, right before the hand-over: the window still open AND still no later command;
 *       CLAIM (compare-and-set on 'compensating' + the marker daThuGuiLai not yet set ⇒ daThuGuiLai + this attempt's nonce + a DB-clock lease;
 *             written BEFORE the attempt: a second boot / replica never sends it again); a claim that THROWS ⇒ held + URGENT + audit (I-3);
 *       ONE attempt through runCompensation → execCommand → the central store → equipmentRegistry → commandDispatcher (every gate; key
 *             `-a2`, a fresh authorisation row), bounded by the re-checked window: at the deadline the walk is ABORTED (rc.aborting + abort
 *             signal: a command not yet handed over is never handed over), and every late compensation-row write is guarded by the nonce;
 *       really sent ⇒ 'failed' (as the step did) + URGENT "STOP re-sent at boot — check the machine state on site" + audit; anything else
 *             (refused, simulated — OT control off —, failed, not confirmed, an exception, past D) ⇒ the compensation row back to 'held' + the
 *             run 'held' + URGENT + audit.
 * Every held write is guarded (I-5a): never over a live attempt of another replica (daThuGuiLai with an unexpired DB-clock lease).
 * Never throws (the caller catches anyway).
 */
async function giuHoacGuiLaiBuTru(b: BuTruChoXuLy): Promise<NonNullable<RehydrateResult["compensations"]>[number]> {
  const { run, k } = b;
  const ctx0 = (run.contextJson as Record<string, unknown> | null) ?? {};
  const prior = (ctx0[RESUME_STATE_CTX_KEY] as ResumeStateMap | undefined) ?? {};
  const { dangGuiLai: _cu, hanLuotGuiMs: _han, bootLuot: _boot, ...dauCu } = (dauBuTruCua(ctx0) ?? {}) as Partial<DauBuTruBiNgat> & { hanLuotGuiMs?: number; bootLuot?: string };
  const dau: DauBuTruBiNgat = { ...dauCu, stepId: k.stepId, compId: k.compId, at: new Date().toISOString() };
  const ctxGiu: Record<string, unknown> = {
    ...b.markedCtx,
    [RESUME_STATE_CTX_KEY]: { ...prior, [k.stepId]: { state: "compensationHeld", error: k.error } },
    [BU_TRU_BI_NGAT_CTX_KEY]: dau,
  };
  const dauLan = dauLanNgat(run);
  const d = await getDb();
  if (!d) return { runId: run.id, compId: k.compId, outcome: "held", reason: "loiTraCuu" }; // still 'compensating': the next boot sees it

  /**
   * The held outcome without an attempt (fix round 2, C-1 — a lease that is not ours is NEVER silent): read the run's CURRENT attempt marker,
   *   • the run left 'compensating' (aborted / continued / held by someone) ⇒ that path owns it — nothing here;
   *   • its attempt nonce belongs to a walker LIVE IN THIS PROCESS (same boot nonce + registered in luotDangChay) ⇒ that walker owns it;
   *   • any other attempt nonce (a previous boot that claimed and then stopped, a claim whose reply was lost, an origin that cannot be told) is
   *     STALE ⇒ held with a compare-and-set ON THAT NONCE + URGENT + audit "a previous boot claimed the STOP re-send and then stopped" — never a
   *     second send (the single try is spent).
   * A held write that loses its compare-and-set is re-read once; still not written ⇒ the URGENT + audit go out anyway.
   */
  const giuKhongGui = async (lyDo: string, bangChung: unknown, them: Record<string, unknown> = {}, opts: { nonceCuaToi?: string } = {}) => {
    let lyDoThuc = lyDo;
    let written: boolean | "loi" = false;
    let luotCu: string | null = null;
    for (let lan = 0; lan < 2 && written === false; lan++) {
      let hienTai: Awaited<ReturnType<typeof docLuotHienTai>> = null;
      try {
        hienTai = await docLuotHienTai(d, run.id);
      } catch (err) {
        console.error(`[FOE] run ${run.id}: current attempt marker not read: ${(err as Error)?.message ?? err}`);
      }
      if (hienTai && hienTai.status !== "compensating") {
        console.warn(`[FOE] run ${run.id}: interrupted compensation "${k.compId}" — the run moved (${hienTai.status}); that path owns it`);
        return { runId: run.id, compId: k.compId, outcome: "held" as const, reason: "notOurs" };
      }
      const dang = hienTai ? hienTai.dangGuiLai : (dauBuTruCua(ctx0)?.dangGuiLai ?? null);
      if (dang !== null && dang !== opts.nonceCuaToi && hienTai?.bootLuot === FOE_BOOT_NONCE && luotDangChay.has(dang)) {
        console.warn(`[FOE] run ${run.id}: interrupted compensation "${k.compId}" — a walker of THIS process is sending it (attempt ${dang})`);
        return { runId: run.id, compId: k.compId, outcome: "held" as const, reason: "notOurs" };
      }
      if (dang !== null && dang !== opts.nonceCuaToi) {
        // a stale attempt (fix round 3): whatever the decision said (spent try, a lookup error …), the person is told what is known — the
        // previous boot's re-send and what its compensation row recorded (the decision's own reason stays in the audit: decisionReason)
        luotCu = dang;
        lyDoThuc = await lyDoLuotCu(d, run.id, k.compId);
      }
      try {
        written = await giuRunBuTru(
          d,
          run.id,
          {
            error: luotCu
              ? `Interrupted by server restart while sending the compensation "${k.compId}" of step "${k.stepId}" (run ${run.id}); not re-sent again (the single boot re-send is spent): ${lyDoText(lyDoThuc)}. A Continue sends that compensation again (only it).`
              : `Interrupted by server restart while sending the compensation "${k.compId}" of step "${k.stepId}" (run ${run.id}); NOT re-sent at boot: ${lyDoText(lyDoThuc)}. A Continue sends that compensation again (only it); check the equipment now.`,
            contextJson: { ...ctxGiu, [BU_TRU_BI_NGAT_CTX_KEY]: { ...dau, ketQuaGuiLai: lyDoThuc } },
          },
          dang,
        );
      } catch (err) {
        written = "loi"; // the held write failed: the URGENT still goes out (the run stays 'compensating' ⇒ the next boot sees it again)
        console.error(`[FOE] run ${run.id}: held write failed: ${(err as Error)?.message ?? err}`);
      }
    }
    console.error(`[FOE] run ${run.id}: compensation "${k.compId}" was interrupted — held (${written === true ? "written" : "NOT written"}), not re-sent at boot: ${lyDoThuc}`);
    await ghiAuditBuTru(run.id, false, { stepId: k.stepId, compId: k.compId, outcome: "held", reason: lyDoThuc, reasonText: lyDoText(lyDoThuc), decisionReason: lyDo, evidence: bangChung, ...(luotCu ? { staleAttempt: luotCu } : {}), ...(written === true ? {} : { heldWritten: false }), ...them });
    await canhBaoBuTruBiNgat(d, run, { loai: luotCu ? "heldStale" : "held", compId: k.compId, stepId: k.stepId, lyDo: lyDoText(lyDoThuc), dauLan, ...(luotCu ? { lyDoMa: lyDoThuc } : {}) });
    return { runId: run.id, compId: k.compId, outcome: "held" as const, reason: lyDoThuc };
  };

  // ── the decision (b1–b3) ──
  let xet: Awaited<ReturnType<typeof xetGuiLaiBuTruBiNgat>> | null = null;
  let loiXet: string | null = null;
  try {
    const executed = runExecutedVersions(run);
    xet = await withDeadline(
      xetGuiLaiBuTruBiNgat(d, {
        runId: run.id,
        stepId: k.stepId,
        compId: k.compId,
        def: b.def,
        ctx: ctx0,
        foeBat: foeEnabled(),
        dinhNghiaKhop: executed === null || (b.wfVersion !== null && executed.includes(b.wfVersion)),
      }),
      HAN_XET_GUI_LAI_MS,
      `FOE boot re-send run ${run.id} checks`,
    );
  } catch (err) {
    loiXet = String((err as Error)?.message ?? err).slice(0, 300);
  }
  const quyetDinh = xet?.quyetDinh ?? ({ gui: false, lyDo: "loiTraCuu" } as const);
  const bangChung = xet?.bangChung ?? null;
  if (!quyetDinh.gui) return giuKhongGui(quyetDinh.lyDo, bangChung, { lookupError: loiXet ?? bangChung?.loi ?? null });
  const adapterId = bangChung!.b1!.adapterId!;
  const machineId = bangChung!.b1!.machineId!;
  const t0 = performance.now();

  // ── (I-1) wait for the adapter's running session, never past what is left of D; (fix round 2, m-2) ONE early URGENT once it is not up ──
  let cho: { sanSang: boolean; choMs: number };
  try {
    cho = await choKetNoiSanSang(d, adapterId, quyetDinh.conLaiMs - (performance.now() - t0), (conMs) => {
      void canhBaoBuTruBiNgat(d, run, { loai: "pending", compId: k.compId, stepId: k.stepId, lyDo: `up to ${Math.max(0, Math.round(conMs / 1000))} s`, dauLan });
    });
  } catch (err) {
    return giuKhongGui("loiTraCuu", bangChung, { lookupError: String((err as Error)?.message ?? err).slice(0, 300) });
  }
  if (!cho.sanSang) return giuKhongGui("ketNoiChuaSan", bangChung, { waitedMs: cho.choMs });

  // ── (I-2, m-5) re-check right before the hand-over, DB clock: the window still open, still no later command ──
  let xetLai: { cuaSo: Awaited<ReturnType<typeof docCuaSoGuiLai>>; lenhSau: Awaited<ReturnType<typeof docLenhSau>> };
  try {
    xetLai = await withDeadline(
      (async () => ({ cuaSo: await docCuaSoGuiLai(d, run.id, k.compId), lenhSau: await docLenhSau(d, { runId: run.id, compId: k.compId, adapterId, machineId }) }))(),
      HAN_XET_GUI_LAI_MS,
      `FOE boot re-send run ${run.id} re-check`,
    );
  } catch (err) {
    return giuKhongGui("loiTraCuu", bangChung, { waitedMs: cho.choMs, lookupError: String((err as Error)?.message ?? err).slice(0, 300) });
  }
  const tXetLai = performance.now();
  const conLai = xetLai.cuaSo.conLaiMs;
  const xetLaiBc = { waitedMs: cho.choMs, recheck: xetLai };
  if (conLai === null || xetLai.cuaSo.dbNowMs === null || conLai <= 0) return giuKhongGui("quaHan", bangChung, xetLaiBc);
  if (xetLai.lenhSau.length > 0) return giuKhongGui("coLenhSau", bangChung, xetLaiBc);

  // ── claim (write-ahead, once): compensating ⇒ compensating + marker daThuGuiLai + this attempt's nonce + THIS process's boot nonce + a
  //    DB-clock lease (evidence; fix round 2: ownership is decided by the boot nonce + the in-process registry, never by the lease alone) ──
  const nonce = randomBytes(8).toString("hex");
  const ctxGui: Record<string, unknown> = {
    ...ctxGiu,
    [BU_TRU_BI_NGAT_CTX_KEY]: { ...dau, daThuGuiLai: true, dangGuiLai: nonce, bootLuot: FOE_BOOT_NONCE, hanLuotGuiMs: xetLai.cuaSo.dbNowMs + conLai + BIEN_LUOT_GUI_MS },
  };
  luotDangChay.add(nonce); // BEFORE the claim: a concurrent in-process scan sees this attempt as live
  try {
    let claimed: boolean;
    try {
      dauDoBuTru("claim");
      // (fix round 2, m-4) bounded; its time is taken off the attempt's window below
      const rows = await withDeadline(
        Promise.resolve(
          d
            .update(orchestrationRuns)
            .set({ contextJson: ctxGui, updatedAt: new Date() })
            .where(
              and(
                eq(orchestrationRuns.id, run.id),
                eq(orchestrationRuns.status, "compensating"),
                sql`COALESCE((${orchestrationRuns.contextJson} -> ${BU_TRU_BI_NGAT_CTX_KEY} ->> 'daThuGuiLai')::boolean, false) = false`,
              ),
            )
            .returning({ id: orchestrationRuns.id }),
        ),
        HAN_GHI_KET_QUA_LUOT_MS,
        `FOE boot re-send run ${run.id} claim`,
      );
      dauDoBuTru("claimSau");
      claimed = rows.length === 1;
    } catch (err) {
      // (I-3 + fix round 2 C-1) the claim threw — or committed with its reply lost: RE-READ it (bounded) instead of assuming
      console.error(`[FOE] run ${run.id}: boot re-send claim failed / unanswered: ${(err as Error)?.message ?? err}`);
      let docLai: Awaited<ReturnType<typeof docLuotHienTai>> = null;
      try {
        docLai = await docLuotHienTai(d, run.id);
      } catch {
        /* unreadable ⇒ not claimed */
      }
      claimed = docLai?.status === "compensating" && docLai.dangGuiLai === nonce;
      if (!claimed) return await giuKhongGui("loiGhiNhan", bangChung, { ...xetLaiBc, claimError: String((err as Error)?.message ?? err).slice(0, 300) }, { nonceCuaToi: nonce });
    }
    if (!claimed) {
      // 0 rows: the run moved (aborted …) or an attempt already exists — never silent unless that path owns it (giuKhongGui decides, C-1)
      return await giuKhongGui("daGuiLaiMotLan", bangChung, { ...xetLaiBc, claimLost: true });
    }

    // ── ONE attempt, bounded by the re-checked window minus the claim; ABORTED at the deadline — whatever stage it is in (fix round 2, I-1) ──
    const conLaiLuot = conLai - (performance.now() - tXetLai);
    const huy: HuyLuotGui = { expired: false, controller: new AbortController() };
    let gui: { sent: boolean; lyDo: string; daGiao: boolean; tuChoi?: boolean; chiTiet: Record<string, unknown> };
    try {
      gui = await withDeadline(guiLaiBuTruLucKhoiDong(run.id, k, b.def, nonce, huy), Math.max(1, conLaiLuot), `FOE boot re-send run ${run.id} compensation ${k.compId}`);
    } catch (err) {
      huy.expired = true; // seen at the walk's next stage, if it has not registered its run context yet
      huy.controller.abort();
      if (huy.rc) huy.rc.aborting = true; // a command not yet handed over is never handed over (execCommand's last check)
      gui = { sent: false, lyDo: "khongXacNhan", daGiao: huy.rc?.attempted.has(k.compId) === true, chiTiet: { error: String((err as Error)?.message ?? err).slice(0, 300) } };
    }
    const { dangGuiLai: _n, hanLuotGuiMs: _l, bootLuot: _b, ...dauSach } = ctxGui[BU_TRU_BI_NGAT_CTX_KEY] as DauBuTruBiNgat & { hanLuotGuiMs?: number; bootLuot?: string };
    const dauKq = { ...dauSach, daThuGuiLai: true as const, ketQuaGuiLai: gui.sent ? "sent" : gui.lyDo };
    const evidence = { stepId: k.stepId, compId: k.compId, reason: gui.sent ? "allChecksPassed" : gui.lyDo, reasonText: gui.sent ? "b1–b3 held: a pinned STOP, inside D on the DB clock, central-owned, same owner epoch, no later command (re-checked before the hand-over)" : lyDoText(gui.lyDo), handedOver: gui.daGiao, evidence: bangChung, ...xetLaiBc, dispatch: gui.chiTiet };
    if (gui.sent) {
      const written = await capNhatTheoLuotGui(d, run.id, nonce, "failed", {
        finishedAt: new Date(),
        error: `Step "${k.stepId}" failed; its STOP compensation "${k.compId}" was interrupted by a server restart and was RE-SENT ONCE at boot (run ${run.id}) — check the machine state on site.`,
        contextJson: { ...ctxGui, [BU_TRU_BI_NGAT_CTX_KEY]: dauKq },
      });
      console.warn(`[FOE] run ${run.id}: STOP compensation "${k.compId}" RE-SENT once at boot (run ${written ? "failed as its step" : "status NOT written"})`);
      await ghiAuditBuTru(run.id, true, { ...evidence, outcome: "sent" });
      await canhBaoBuTruBiNgat(d, run, { loai: "sent", compId: k.compId, stepId: k.stepId, lyDo: "", dauLan });
      return { runId: run.id, compId: k.compId, outcome: "sent" };
    }
    // (fix round 2, m-3) truthful: "did NOT go out" only when nothing was handed to the dispatcher (or the dispatcher only simulated it)
    // (fix round 3, m-2) a dispatcher refusal is "not sent"; "may have gone out" only when the dispatcher accepted it or its outcome is unknown
    const biTuChoi = gui.tuChoi === true;
    const coTheDaRa = gui.daGiao && gui.lyDo !== "moPhong" && !biTuChoi;
    const ketLuan = biTuChoi ? "was refused by the dispatcher — not sent" : coTheDaRa ? "was handed to the dispatcher / device path but NOT confirmed — it MAY HAVE GONE OUT" : "did NOT go out";
    const loiGiu = `Interrupted by server restart while sending the compensation "${k.compId}" of step "${k.stepId}" (run ${run.id}); the boot re-send ${ketLuan}: ${lyDoText(gui.lyDo)}. A Continue sends that compensation again (only it); check the equipment on site now.`;
    const written = await capNhatTheoLuotGui(d, run.id, nonce, "held", { error: loiGiu, contextJson: { ...ctxGui, [BU_TRU_BI_NGAT_CTX_KEY]: dauKq } }, {
      // the compensation is still DUE: its row is never left 'compensated' / 'failed' (a later crash would then read "nothing in flight")
      stepId: k.compId,
      error: `Not confirmed at boot (${biTuChoi ? "refused by the dispatcher — not sent" : coTheDaRa ? "may have gone out" : "not sent"}): ${lyDoText(gui.lyDo)}`,
    });
    console.error(`[FOE] run ${run.id}: boot re-send of compensation "${k.compId}" ${ketLuan} (${gui.lyDo}) — held (${written ? "written" : "NOT written"})`);
    await ghiAuditBuTru(run.id, false, { ...evidence, outcome: "held" });
    await canhBaoBuTruBiNgat(d, run, { loai: coTheDaRa ? "heldMayHaveGone" : "held", compId: k.compId, stepId: k.stepId, lyDo: biTuChoi ? `refused by the dispatcher — not sent (${lyDoText(gui.lyDo)})` : lyDoText(gui.lyDo), dauLan, ...(biTuChoi ? { tuChoi: true } : {}) });
    return { runId: run.id, compId: k.compId, outcome: "held", reason: gui.lyDo };
  } finally {
    luotDangChay.delete(nonce);
  }
}

/**
 * fix round 2 (C-1) — THIS process's boot nonce: carried by every boot re-send claim (marker `bootLuot`). A claim of another boot is, under the
 * single-instance assumption (I-5b), a boot that stopped — never a live owner.
 */
const FOE_BOOT_NONCE = randomBytes(8).toString("hex");
/** fix round 2 (C-1) — the boot re-send attempts LIVE in this process (nonce), from just before their claim until their outcome is written. */
const luotDangChay = new Set<string>();

/** The abort handle of ONE boot re-send attempt — created BEFORE its first await (fix round 2, I-1). */
interface HuyLuotGui {
  expired: boolean;
  controller: AbortController;
  rc?: RunContext;
}

/**
 * fix round 3 (I-1, m-1) — the reason of a STALE attempt (another boot claimed the re-send and stopped before its outcome) from what its
 * compensation row recorded: 'compensated' with an accepted, not simulated dispatch result ⇒ the STOP was re-sent (the outcome was not
 * recorded); 'failed', no row, or 'compensated' by a simulated / not-accepted dispatch (polish m-1) ⇒ the re-send did not complete; anything else (running / held — the crash came during the send) or unreadable ⇒ it may or may not have reached the device.
 */
async function lyDoLuotCu(d: NonNullable<Awaited<ReturnType<typeof getDb>>>, runId: number, compId: string): Promise<string> {
  try {
    const [r] = await withDeadline(
      Promise.resolve(
        d
          .select({ status: orchestrationRunSteps.status, resultJson: orchestrationRunSteps.resultJson })
          .from(orchestrationRunSteps)
          .where(and(eq(orchestrationRunSteps.runId, runId), eq(orchestrationRunSteps.stepId, compId)))
          .limit(1),
      ),
      STOP_DB_STEP_DEADLINE_MS,
      `FOE run ${runId} stale attempt row`,
    );
    // (polish m-1) 'compensated' is also written for a SIMULATED (dry-run) or not-accepted dispatch: "re-sent" only with the live path's test
    const kq = (r?.resultJson ?? null) as Record<string, unknown> | null;
    const daGuiThat = kq?.accepted === true && kq?.simulated !== true && kq?.status !== "simulated";
    if (r?.status === "compensated" && daGuiThat) return "luotTruocDaGui";
    if (!r || r.status === "failed" || r.status === "compensated") return "luotTruocKhongXong";
    return "luotTruocDungGiua";
  } catch {
    return "luotTruocDungGiua";
  }
}

/** The held title of a stale attempt — the same statement as its message (fix round 3, m-1). */
function tieuDeLuotCu(runId: number, comp: string, lyDoMa: string | undefined): string {
  if (lyDoMa === "luotTruocDaGui") return `STOP re-sent at a previous boot (outcome not recorded) — run ${runId}, compensation ${comp} — check the machine on site`;
  if (lyDoMa === "luotTruocKhongXong") return `A previous boot's STOP re-send did not complete — run ${runId} held, ${comp} may not have reached the device — check on site`;
  return `A previous boot's STOP re-send stopped — run ${runId} held, ${comp} MAY OR MAY NOT have reached the device — check on site`;
}

/** The run's status + its current boot re-send attempt marker (nonce, boot). Bounded; throws on a DB error / timeout. */
async function docLuotHienTai(d: NonNullable<Awaited<ReturnType<typeof getDb>>>, runId: number): Promise<{ status: string; dangGuiLai: string | null; bootLuot: string | null } | null> {
  const [r] = await withDeadline(
    Promise.resolve(
      d
        .select({
          status: orchestrationRuns.status,
          dang: sql<string | null>`${orchestrationRuns.contextJson} -> ${BU_TRU_BI_NGAT_CTX_KEY} ->> 'dangGuiLai'`,
          boot: sql<string | null>`${orchestrationRuns.contextJson} -> ${BU_TRU_BI_NGAT_CTX_KEY} ->> 'bootLuot'`,
        })
        .from(orchestrationRuns)
        .where(eq(orchestrationRuns.id, runId))
        .limit(1),
    ),
    STOP_DB_STEP_DEADLINE_MS,
    `FOE run ${runId} attempt marker`,
  );
  return r ? { status: String(r.status), dangGuiLai: r.dang ?? null, bootLuot: r.boot ?? null } : null;
}

/**
 * fix round 1 (I-4) — the identity of ONE interruption: the run row's "updatedAt" as the boot SCAN read it (the last write of the walk that
 * died). Two boots / replicas seeing the SAME interruption read the same value (one URGENT, the durable dedup); a Continue that is
 * interrupted again has moved it (a new URGENT).
 */
function dauLanNgat(run: OrchestrationRun): string {
  const u = run.updatedAt as unknown;
  return u instanceof Date ? String(u.getTime()) : String(u ?? "-");
}

/**
 * The held write of a run with an interrupted compensation: only from 'compensating', and (fix round 2, C-1) a compare-and-set ON THE ATTEMPT
 * NONCE the caller saw (`dangGuiLai`, null = none): it never overwrites an attempt it did not decide about. Whether a live attempt may be
 * overwritten is the caller's decision (giuKhongGui: never one of THIS process; always a stale one). true ⇔ written; throws on a DB error.
 */
async function giuRunBuTru(d: NonNullable<Awaited<ReturnType<typeof getDb>>>, runId: number, patch: Partial<OrchestrationRun>, dangGuiLai: string | null): Promise<boolean> {
  const rows = await withDeadline(
    Promise.resolve(
      d
        .update(orchestrationRuns)
        .set({ status: "held", updatedAt: new Date(), ...patch })
        .where(
          and(
            eq(orchestrationRuns.id, runId),
            eq(orchestrationRuns.status, "compensating"),
            sql`(${orchestrationRuns.contextJson} -> ${BU_TRU_BI_NGAT_CTX_KEY} ->> 'dangGuiLai') IS NOT DISTINCT FROM ${dangGuiLai}`,
          ),
        )
        .returning({ id: orchestrationRuns.id }),
    ),
    HAN_GHI_KET_QUA_LUOT_MS,
    `FOE run ${runId} held write`,
  );
  return rows.length === 1;
}

/**
 * The outcome write of the boot re-send: only while the run is still 'compensating' under THIS attempt's nonce (an abort, a timeout that
 * already held it, never another walk's state); with `buTru`, the compensation row goes back to 'held' in the same transaction.
 */
async function capNhatTheoLuotGui(
  d: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  runId: number,
  nonce: string,
  status: OrchestrationRun["status"],
  patch: Partial<OrchestrationRun>,
  buTru?: { stepId: string; error: string },
): Promise<boolean> {
  try {
    return await withDeadline(
      d.transaction(async (tx) => {
        const rows = await tx
          .update(orchestrationRuns)
          .set({ status, updatedAt: new Date(), ...patch })
          .where(
            and(
              eq(orchestrationRuns.id, runId),
              eq(orchestrationRuns.status, "compensating"),
              sql`(${orchestrationRuns.contextJson} -> ${BU_TRU_BI_NGAT_CTX_KEY} ->> 'dangGuiLai') = ${nonce}`,
            ),
          )
          .returning({ id: orchestrationRuns.id });
        if (rows.length !== 1) return false;
        if (buTru) await upsertStepOn(tx as never, runId, buTru.stepId, "command", { status: "held", error: buTru.error, finishedAt: new Date() });
        return true;
      }),
      HAN_GHI_KET_QUA_LUOT_MS,
      `FOE boot re-send run ${runId} outcome`,
    );
  } catch (err) {
    console.error(`[FOE] run ${runId}: boot re-send outcome not written: ${(err as Error)?.message ?? err}`);
    return false;
  }
}

/**
 * fix round 1 (I-2) — a step-row write of the BOOT re-send walk (its rc.store.upsertStep): only while its run is still 'compensating' under that
 * attempt's nonce (the run row locked FOR UPDATE in the same transaction). After the deadline the outcome write has cleared the nonce, so a late
 * answer never overwrites the row to 'compensated' / 'failed' and never touches the rows of a person's Continue. false ⇔ not written.
 */
async function ghiHangBuTruTheoLuot(runId: number, nonce: string, stepId: string, stepType: string, patch: Parameters<typeof upsertStepOn>[4]): Promise<boolean> {
  const d = await getDb();
  if (!d) return false;
  return d.transaction(async (tx) => {
    const [cua] = await tx
      .select({ id: orchestrationRuns.id })
      .from(orchestrationRuns)
      .where(
        and(
          eq(orchestrationRuns.id, runId),
          eq(orchestrationRuns.status, "compensating"),
          sql`(${orchestrationRuns.contextJson} -> ${BU_TRU_BI_NGAT_CTX_KEY} ->> 'dangGuiLai') = ${nonce}`,
        ),
      )
      .for("update");
    if (!cua) return false;
    await upsertStepOn(tx as never, runId, stepId, stepType, patch);
    return true;
  });
}

/**
 * THE attempt: the compensation through the engine's own compensation path (runCompensation → runStepBody → execCommand → central store
 * → equipmentRegistry → commandDispatcher), registered as a live run (an abort reaches it), only a pinned STOP handed over
 * (rc.chiGuiStopGhim), attempt LAN_GUI_LAI_KHOI_DONG, its step-row writes guarded by the nonce (rc.store.upsertStep). `huy.rc` lets the
 * caller abort the walk at the deadline. "Sent" only when its row says so: compensated, accepted, NOT simulated.
 */
async function guiLaiBuTruLucKhoiDong(
  runId: number,
  k: Extract<PhanLoaiBuTru, { kind: "mot" }>,
  def: WorkflowDefinition,
  nonce: string,
  huy: HuyLuotGui,
): Promise<{ sent: boolean; lyDo: string; daGiao: boolean; tuChoi?: boolean; chiTiet: Record<string, unknown> }> {
  // (fix round 2, I-1) the deadline may fire at ANY stage: checked after every await until the walk's run context carries the abort
  const daHet = () => huy.expired || huy.controller.signal.aborted;
  const huyBo = (chiTiet: Record<string, unknown> = {}) => ({ sent: false, lyDo: "khongXacNhan", daGiao: false, chiTiet: { ...chiTiet, abortedBeforeWalk: true } });
  if (daHet()) return huyBo();
  const d = await getDb();
  if (daHet()) return huyBo();
  if (!d) return { sent: false, lyDo: "khongXacNhan", daGiao: false, chiTiet: { error: "database unavailable" } };
  const [run] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
  if (daHet()) return huyBo();
  if (!run || run.status !== "compensating") return { sent: false, lyDo: "daHuy", daGiao: false, chiTiet: { status: run?.status ?? null } };
  const step = def.steps.find((s) => s.id === k.stepId);
  if (!step?.compensation || step.compensation.id !== k.compId) return { sent: false, lyDo: "dinhNghiaDaDoi", daGiao: false, chiTiet: {} };
  await dauDoBuTruCho("truocDiBo"); // test seam: a slow stage BETWEEN the run read and the run context (buildRunContext loads machines / rows)
  const rc = await buildRunContext(run, def, SYSTEM_FOE_BOOT_USER);
  rc.controller = huy.controller; // the deadline's controller (created before the first await) — a sleep / abort check of the walk sees it
  huy.rc = rc;
  if (daHet()) {
    rc.aborting = true;
    return huyBo();
  }
  rc.chiGuiStopGhim = true;
  // (I-2) every step-row write of this walk (running / result / held / compensated) lands only under this attempt nonce: after the deadline
  // a late answer never rewrites the compensation row, nor the rows of a person's Continue
  rc.store = {
    ...centralRunStore,
    upsertStep: async (rid: number, stepId: string, stepType: string, patch: Parameters<typeof upsertStepOn>[4]) => {
      if (!(await ghiHangBuTruTheoLuot(rid, nonce, stepId, stepType, patch))) console.warn(`[FOE] run ${rid}: late write of the boot re-send (${stepId} ${patch.status}) dropped — the attempt was closed`);
    },
  };
  let out: StepOutcome | undefined;
  await withLiveRun(rc, async () => {
    out = await runCompensation(rc, step, k.error, { attempt: LAN_GUI_LAI_KHOI_DONG });
    return "compensating";
  });
  const daGiao = rc.attempted.has(k.compId); // handed to a dispatcher (whatever came back)
  const [row] = await d
    .select()
    .from(orchestrationRunSteps)
    .where(and(eq(orchestrationRunSteps.runId, runId), eq(orchestrationRunSteps.stepId, k.compId)))
    .limit(1);
  const r = (row?.resultJson ?? null) as Record<string, unknown> | null;
  const chiTiet = { outcome: out?.kind ?? null, error: out && "error" in out ? out.error : null, row: row?.status ?? null, status: r?.status ?? null, accepted: r?.accepted ?? null, simulated: r?.simulated ?? null, routedTo: r?.routedTo ?? null, handedOver: daGiao };
  if (rc.aborting) return { sent: false, lyDo: "daHuy", daGiao, chiTiet };
  const moPhong = r?.simulated === true || r?.status === "simulated";
  const sent = out?.kind === "ok" && row?.status === "compensated" && r?.accepted === true && !moPhong;
  if (sent) return { sent: true, lyDo: "", daGiao, chiTiet };
  // (fix round 3, m-2) the dispatcher REFUSED it (its ledger answer 'rejected'): nothing reached the device
  const tuChoi = r?.status === "rejected";
  return { sent: false, lyDo: moPhong ? "moPhong" : out?.kind === "failed" ? "guiLoi" : "khongXacNhan", daGiao, tuChoi, chiTiet };
}

/** The audit row of a boot decision (b5: reason + the evidence of b1–b3). Bounded; never throws. */
async function ghiAuditBuTru(runId: number, ok: boolean, metadata: Record<string, unknown>): Promise<void> {
  try {
    await withDeadline(
      (async () => {
        const { logCrudOperation, createAuditContext } = await napAudit();
        await logCrudOperation(createAuditContext({ user: { id: 0, name: SYSTEM_FOE_BOOT_USER.name } }), {
          action: FOE_BU_TRU_KHOI_DONG_AUDIT_ACTION,
          entityType: "orchestration_run",
          entityId: runId,
          details: { operation: FOE_BU_TRU_KHOI_DONG_AUDIT_OP, metadata: { runId, ...metadata } },
          status: ok ? "success" : "failure",
        });
      })(),
      5 * STOP_DB_STEP_DEADLINE_MS,
      `FOE run ${runId} interrupted compensation audit`,
    );
  } catch (err) {
    console.error(`[FOE] run ${runId}: interrupted compensation audit not written: ${(err as Error)?.message ?? err}`);
  }
}

/** The audit operation of every boot decision about an interrupted compensation (A2(m2)). */
export const FOE_BU_TRU_KHOI_DONG_AUDIT_OP = "foe_compensation_interrupted_boot";
/**
 * fix round 1 (m-8) — its audit ACTION: a specific value (audit_logs.action is varchar(100), no enum ⇒ no migration) instead of config_change, so
 * a boot STOP decision is found by action; the operation stays in details.
 */
export const FOE_BU_TRU_KHOI_DONG_AUDIT_ACTION = "foe_stop_compensation_boot";

/**
 * The URGENT alert of an interrupted compensation (the critical-stop alert, its durable dedup per run + compensation + outcome):
 *   held — not re-sent (why); sent — a STOP was RE-SENT at boot (b5: a person must know); failed — several / undecidable (never a guess).
 * Recipients: the run owner + active admins / supervisors (bounded read; unreadable ⇒ the owner only — the log line and the alert
 * stream carry it anyway). Bounded; never throws.
 */
/** C-3 (c) — the words a person reads when the boot RE-SENT a STOP (alert texts are not localised: the critical-stop alert carries raw text). */
export const FOE_STOP_GUI_LAI_TIEU_DE = "STOP re-sent at boot — check the machine state on site";
/** fix round 2 (m-2) — the early URGENT while the boot waits for the device connection (its own dedup key). */
export const FOE_STOP_CHO_KET_NOI_TIEU_DE = "STOP compensation pending at boot — waiting for the device connection";

async function canhBaoBuTruBiNgat(
  d: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  run: OrchestrationRun,
  /**
   * `dauLan` (I-4) — the identity of THIS interruption (dauLanNgat): in the dedup key, so a second interruption of the same run alerts again.
   * `loai` (fix round 2): `pending` — the boot WAITS for the device connection (early, own key); `heldMayHaveGone` — held, but the STOP was
   * handed to the dispatcher and not confirmed (m-3: it may have gone out); `held` — held, nothing handed over.
   */
  a: { loai: "held" | "heldMayHaveGone" | "heldStale" | "sent" | "failed" | "pending"; compId: string | null; stepId: string | null; lyDo: string; dauLan: string; lyDoMa?: string; tuChoi?: boolean },
): Promise<void> {
  try {
    let nguoi: number[] = [];
    try {
      const rows = await withDeadline(
        Promise.resolve(d.select({ id: users.id }).from(users).where(and(eq(users.isActive, true), inArray(users.role, ["admin", "supervisor"] as never[])))),
        STOP_DB_STEP_DEADLINE_MS,
        `FOE run ${run.id} alert recipients`,
      );
      nguoi = rows.map((u) => Number(u.id));
    } catch {
      /* the owner only */
    }
    const recipients = [...new Set([run.startedBy ?? 0, ...nguoi])].filter((u) => Number.isSafeInteger(u) && u > 0);
    const kind =
      a.loai === "sent"
        ? "foe_stop_compensation_resent_at_boot"
        : a.loai === "pending"
          ? "foe_stop_compensation_pending_at_boot"
          : a.loai === "failed"
            ? "foe_compensation_interrupted_failed"
            : "foe_compensation_interrupted_held";
    const comp = a.compId ? `"${a.compId}"` : "(unknown)";
    const title =
      a.loai === "sent"
        ? `${FOE_STOP_GUI_LAI_TIEU_DE} (run ${run.id}, compensation ${comp})`
        : a.loai === "pending"
          ? `${FOE_STOP_CHO_KET_NOI_TIEU_DE} (run ${run.id}, compensation ${comp})`
          : a.loai === "heldStale"
            ? tieuDeLuotCu(run.id, comp, a.lyDoMa)
            : a.loai === "heldMayHaveGone"
              ? `Compensation interrupted — run ${run.id} held, ${comp} MAY HAVE GONE OUT (not confirmed) — check on site`
              : a.loai === "held"
                ? `Compensation interrupted — run ${run.id} held, ${comp} NOT re-sent${a.tuChoi ? " (refused by the dispatcher — not sent)" : ""}`
              : `Compensation interrupted — run ${run.id} failed, nothing re-sent`;
    const message =
      a.loai === "sent"
        ? `The server restarted while run ${run.id} was sending the STOP compensation ${comp} of step "${a.stepId}". The boot RE-SENT that STOP once (pinned STOP, inside its window on the database clock, central-owned, same owner, no later command to the device). ${FOE_STOP_GUI_LAI_TIEU_DE}: it may have been started locally (HMI / panel) after the restart.`
        : a.loai === "pending"
          ? `${FOE_STOP_CHO_KET_NOI_TIEU_DE} (${a.lyDo}): the server restarted while run ${run.id} was sending the STOP compensation ${comp} of step "${a.stepId}". It is re-sent once the device is connected, if its window has not closed; otherwise the run is held. Check the equipment on site and use the machine's direct STOP / E-STOP if needed.`
          : a.loai === "heldStale"
            ? `The server restarted while run ${run.id} was sending the compensation ${comp} of step "${a.stepId}": ${a.lyDo}. The run is HELD and it is NOT re-sent again (the single boot re-send is spent): a Continue sends ONLY that compensation. Check the machine on site before you continue.`
            : a.loai === "heldMayHaveGone"
              ? `The server restarted while run ${run.id} was sending the compensation ${comp} of step "${a.stepId}". The boot re-send was handed to the dispatcher / device path but NOT confirmed — it MAY HAVE GONE OUT: ${a.lyDo}. The run is HELD: a Continue sends ONLY that compensation. Check the machine on site before you continue.`
            : a.loai === "held"
              ? `The server restarted while run ${run.id} was sending the compensation ${comp} of step "${a.stepId}" — it was NOT re-sent at boot: ${a.lyDo}. The run is HELD: a Continue sends ONLY that compensation. Check the equipment now and use the machine's direct STOP / E-STOP if needed.`
              : `The server restarted while run ${run.id} was compensating: ${a.lyDo}. The run is FAILED and nothing was re-sent. Check the equipment now and use the machine's direct STOP / E-STOP if needed.`;
    // I-4 — the interruption is named in the TEXT too: the durable dedup also matches a pre-patch row by (kind + identical message), which would
    // swallow a second interruption of the same run with the same reason. (fix round 2, m-1: an ISO time, not raw ms)
    const lan = /^\d+$/.test(a.dauLan) ? new Date(Number(a.dauLan)).toISOString() : a.dauLan;
    const { raiseCriticalStopAlert } = await napCanhBao();
    await raiseCriticalStopAlert({
      kind,
      title,
      message: `${message} [interruption of ${lan}]`,
      recipients,
      dedupKey: `${kind}:${run.id}:${a.compId ?? "-"}:${a.dauLan}`,
      source: "ot",
      entityType: "orchestration_run",
      entityId: run.id,
      khuTrungBenVung: {},
    });
  } catch (err) {
    console.error(`[FOE] run ${run.id}: interrupted compensation alert failed: ${(err as Error)?.message ?? err}`);
  }
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
//   within 7·D of the abort request (8·D if the 'aborted' write matched no row and is read back, A2(n) T7b-1c RC12b), in order (STOP steps in definition order, then the due compensations). A run not latched
//   answers within 8·D (it waits ≤ ABORT_STOP_ANSWER_WAIT_MS for the dispatchers' replies; a later reply is recorded when it comes), T7b-1d: + ≤ 2·D for the traces beside the STOPs and the rows they read. A LATCHED run answers later, its STOPs already handed over: up to D more for
//   the `abort:` rows a debt reads, 5·D for the URGENT of a STOP that did not go or of a definition unread, and the end obligation (a read ≤ D, one URGENT try ≤ D, DA_BAO ≤ D): ≤ 18·D in all, measured 5·D with
//   the URGENT of the STOP hung (T7B1C-SAP-QUET-CO-HAN). REJECTION: the scope decision ≤ D (a real user), the claim ≤ D, then the same sweep (≤ 6·D to its answer), then
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

/**
 * doc 81 Đợt 6 fix 3 (ruling R-6-d) — a re-send of the STOP steps of an aborted run more than ABORT_RESEND_WINDOW_MS
 * (shared/foeAbortResend.ts) after the abort, or with no known abort time, is REFUSED: an old STOP must never reach a
 * machine that has since been restarted. The answer points at the machine's direct STOP / E-STOP.
 */
export const FOE_RESEND_TOO_OLD = "resendTooOld" as const;
export { ABORT_RESEND_WINDOW_MS };

/**
 * fix 3 (M4) — the `abort:<step>` row id within the 128-character column: a longer step id becomes a prefix + `~` + 10 hex
 * of the sha256 of the WHOLE id (never cut: a cut id would not match, and two long ids would share a row).
 */
export function abortRowId(stepId: string): string {
  const full = `${ABORT_ROW_PREFIX}${stepId}`;
  if (full.length <= 128) return full;
  const hash = createHash("sha256").update(stepId).digest("hex").slice(0, 10);
  return `${ABORT_ROW_PREFIX}${stepId.slice(0, 128 - ABORT_ROW_PREFIX.length - hash.length - 1)}~${hash}`;
}

/**
 * doc 81 Đợt 7 task I6 — re-read a run after a rejection's claim failed late: up to 3 bounded reads (now, after D, after
 * 2·D more). `undefined` ⇔ none answered (CANNOT DECIDE — the caller finishes nothing); `null` ⇔ the run row is gone.
 */
async function rereadRejectClaim(runId: number): Promise<OrchestrationRun | null | undefined> {
  for (const waitMs of [0, STOP_DB_STEP_DEADLINE_MS, 2 * STOP_DB_STEP_DEADLINE_MS]) {
    if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
    const rows = await boundedAbortRead(async () => {
      const d = await getDb();
      return d ? d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1) : null;
    }, `FOE reject run ${runId} claim re-read`);
    if (rows) return rows[0] ?? null;
  }
  return undefined;
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
  /** A2(n) T6c (Q1) — stop-typed steps of a branch never evaluated whose pins the verifier READ and found none: no STOP, never sent; forward work a latched walk names (H13) */
  notPinnedUntaken: string[];
}

/**
 * PURE over the source + the verification — what the sweep sends, lists and skips. `chot` (A2(n)): a latched run's reading: only a command can be settled (a container that failed
 * still holds STOPs nobody reached), and the compensations due are the walker's reach, not every step that started. A branch never evaluated stays a list (M1).
 */
async function planAbortSweep(src: AbortSweepSource, def: WorkflowDefinition, v: StopVerification, chot?: { chuDenHan: ReadonlySet<string> }, daDinh?: ReadonlySet<string>): Promise<AbortPlan> {
  const plan: AbortPlan = { send: [], unverified: [], untakenBranch: [], notPinned: [], notPinnedUntaken: [] };
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
      // A2(n) T5 — a failed container still holds a STOP in state C: "not settled" of the row alone would not reach it
      const coChuaRa = s.type !== "command" && !!src.chuaRa?.size && allStepsOf([s]).some((x) => src.chuaRa?.has(x.id));
      if (src.settled(s.id) && !(chot && s.type !== "command") && !coChuaRa) continue; // finished / failed on its own / already on its way to the dispatcher
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
              if (x.type !== "command" || seen.has(x.id)) continue;
              if (v.ids.has(x.id) || v.unsure.has(x.id)) {
                seen.add(x.id);
                plan.untakenBranch.push(x.id);
                continue;
              }
              // T6c (Q1) — the same verification answered "not pinned" for a stop-typed one: no STOP, not listed as one; still never sent, nothing read again. What the sweep sees is unchanged (`seen`)
              const c = commandOf(x, src.machineById);
              if (c && !isRobotKind(c.cap.adapterKind) && (await isOtStopCommandType(c.descriptor.name))) plan.notPinnedUntaken.push(x.id);
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
  const order = chot ? main.map((s) => s.id).reverse().filter((id) => chot.chuDenHan.has(id)) : src.rowsKnown ? [...new Set(src.startOrder)].reverse() : main.map((s) => s.id).reverse();
  for (const id of order) {
    const parent = byId.get(id);
    if (parent?.compensation) await walk([parent.compensation]);
  }
  // A2(n) T7b-1d (H22) — what an earlier Abort tried or meant to send and did not go (foeRunStore.dauVetAbort): whoever wrote over its rows, due or not. The verification above decides: a trace sends nothing that is no pinned STOP
  for (const id of daDinh ?? []) {
    const s = findStepDeep(def.steps, id);
    // P1 (rà T7b-1d) — the walk listed it as a branch never evaluated, yet an Abort tried it: the choice was lost, not never made. The trace outranks the list; a STOP of such a branch with no trace stays listed, no guess
    if (s?.type === "command" && plan.untakenBranch.includes(id)) {
      plan.untakenBranch = plan.untakenBranch.filter((x) => x !== id);
      seen.delete(id);
    }
    if (s?.type === "command") await classify(s as CommandWorkflowStep);
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
  store: RunStore,
  runId: number,
  user: FoeUser,
  step: CommandWorkflowStep,
  map: Map<number, MachineForValidation>,
  nonce: string,
  /** A2(n) T7b-1 (5a) — nobody could verify it: the walker's marked route (authorizeAbortStop danhDau), the dispatcher decides */
  danhDau = false,
  /** A2(n) T7b-1c — class coTheDaRa: the key of this attempt of the walker (execCommandMot's own form), not a sweep's */
  khoaThu?: number,
): Promise<PreparedAbortStop> {
  try {
    const c = commandOf(step, map);
    if (!c) return { step, error: `machine ${step.machineId} / command "${step.command}" not found` };
    const robot = isRobotKind(c.cap.adapterKind);
    const raw = (step.args ?? {}) as Record<string, unknown>;
    const args = robot
      ? raw
      : await withDeadline(store.resolveAdapter(c.cap.adapterKind, step.machineId, raw, step.id), STOP_DB_STEP_DEADLINE_MS, `FOE abort run ${runId} stop ${step.id} adapter lookup`).catch(
          (err: unknown) => {
            console.warn(`[FOE] abort of run ${runId}: stop ${step.id} adapter lookup not answered — sent unresolved (L-7): ${(err as Error)?.message ?? err}`);
            return raw;
          },
        );
    const idempotencyKey = khoaThu !== undefined ? `run${runId}-${step.id}-a${khoaThu}` : abortStopKey(runId, step.id, nonce);
    const cmd = buildEquipmentCommand(c.descriptor, c.cap, step.machineId, args, idempotencyKey, user); // NO approval, ever
    // T7b-1c — a key an earlier dispatch used: a fresh marked authorisation row for THIS one, as the walker's pinned STOP gets (A2(m)): the row under that key may be spent, and that must not refuse a STOP
    if (khoaThu !== undefined && cmd.hitl) cmd.hitl.actionId = stopActionIdMoi(idempotencyKey, khoaThu, nonce);
    if (robot ? !isStopJob(toRobotJob(cmd)) : !(await isOtStopCommandType(cmd.name))) {
      return { step, error: `"${step.command}" is not a STOP — never sent on an abort` };
    }
    store.bindAbortStop?.(runId, step, cmd); // doc 81 Đợt 10 C — edge only (synchronous): the run binding for the edge dispatch
    // the SAME policy seam as a run's own command step (SEC_PLATFORM off by default ⇒ nothing)
    if (secPlatformEnabled()) {
      // T7b-1d lượt sửa 1 (H29) — flag on: its load has a bound; past it the `catch` below: its `abort:` row failed with the reason, named, a press can send it; never around the gate
      const { evaluateActionPolicy } = await withDeadline(napPolicy(), STOP_DB_STEP_DEADLINE_MS, `FOE abort run ${runId} stop ${step.id} policy load`);
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
      await store.authorizeAbortStop(runId, user, step, idempotencyKey, args, cmd, { danhDau: danhDau || khoaThu !== undefined }); // central: bounded by D (stopBoundedWrite)
    }
    return { step, cmd, kind: c.cap.adapterKind };
  } catch (err) {
    // data-raw-ok: goes only into the abort's own `abort:<id>` step row + audit (a record, never a screen text as is).
    return { step, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The outcome of one STOP: an `abort:<id>` step row (bounded, not awaited) + the audit (abortStopSent / abortStopFailed). */
function recordAbortStop(
  store: RunStore,
  runId: number,
  user: FoeUser,
  step: CommandWorkflowStep,
  ok: boolean,
  result: EquipmentCommandResult | null,
  error: string | null,
  outOfScopeTarget: boolean | "unknown",
  extra: Record<string, unknown> = {},
  /** A2(n) T7b-2 (H7, 5a) — an edge's Abort of a latched run: why this STOP stays owed, a closed value in the row's own result, the one place an `abort_stop` record carries it to central */
  chuaRa?: ViChuaRa,
): Promise<boolean> {
  const now = new Date();
  const dispatch = result
    ? { routedTo: result.routedTo, status: result.status, accepted: result.ok, simulated: result.detail?.simulated ?? undefined, detail: result.detail ?? null }
    : {};
  // T7b-1 fix 1 (RA-1) — true ⇔ the row landed: what says whether a debt is durable. Awaited by nobody on a STOP's path
  const ghi = withDeadline(
    store.upsertStep(runId, abortRowId(step.id), "command", {
      status: ok ? "completed" : "failed",
      result: { abortStop: ok ? "sent" : "failed", stepId: step.id, ...dispatch, ...(chuaRa && !ok ? { chuaRa } : {}) },
      error,
      startedAt: now,
      finishedAt: now,
    }),
    STOP_DB_STEP_DEADLINE_MS,
    `FOE abort run ${runId} stop ${step.id} row`,
  ).then(
    () => true,
    (err: unknown) => {
      console.warn(`[FOE] abort of run ${runId}: stop ${step.id} row not written: ${(err as Error)?.message ?? err}`);
      return false;
    },
  );
  store.auditAbort(user, runId, ok ? "abortStopSent" : "abortStopFailed", {
    stepId: step.id,
    machineId: step.machineId,
    command: step.command,
    outOfScopeTarget,
    ...(result ? { routedTo: result.routedTo, status: result.status } : {}),
    ...(error ? { error } : {}),
    ...extra,
  });
  return ghi;
}

function emptyAbortReport(): AbortStopReport {
  return { sent: [], failed: [], pending: [], unverified: [], untakenBranch: [], notPinned: [], notNeeded: [] };
}

/** A2(n) T7b-1c — a STOP handed over again under the key of an earlier attempt: the answer may be that attempt's, so it says nothing of any other (CO-THE-A1-TRUNG-OK-CU). */
function cauCoTheDaRa(r: AbortStopReport): string[] {
  return r.sent.filter((id) => r.phanLoai?.[id]?.lop === "coTheDaRa").map((id) => `STOP "${id}" handed over again under the key of attempt ${r.phanLoai?.[id]?.khoaThu ?? 1}: the answer speaks for that attempt only; whether any other hand-over of it reached the device is not known: check the machine on site.`);
}

/** A2(n) T7b-1d (H27, chu du an 09/11) — a known limit: a run not latched, the one write of an Abort's trace lost: a later press may send nothing. Told at once, by name. Never "owed", no press promised. */
function chuKhongBen(ids: readonly string[]): string {
  return `STOP steps this Abort did not get out could not be recorded: ${ids.join(", ")}: a later press may not reach them: check the machine on site and use its direct STOP / E-STOP.`;
}

/** A2(n) T7b-1d lượt sửa 5 (F-5) — an Abort or a gate rejection the database did not confirm in time: a retry is a press like any, its window an upper limit from MOC_CUA_SO, never a promise; the machine first. */
function chuThuLai(): string {
  return `check the run and retry, but no retry can be counted on after ${Math.round(ABORT_RESEND_WINDOW_MS / 60_000)} minutes from ${MOC_CUA_SO}: check the machine on site and use its direct STOP / E-STOP.`;
}

/**
 * A2(n) T7b-1 fix 1 (RA-3) — the answer to a press on an aborted latched run: what the report says, nothing else. API text; the Studio reads `abortStops`. T7b-1c — what is owed: THE classification of the sweep's read.
 * T7b-1d (H23) — `chuaKhoa`: nothing is owed on such a run and the window stands: the words say what the next press can do.
 */
function chuBamLai(runId: number, r: AbortStopReport, chuaKhoa = false): string {
  const cau: string[] = [];
  const pl = r.phanLoai ?? {};
  const no = Object.keys(pl).filter((id) => pl[id]?.lop === "no");
  const guiThuong = r.sent.filter((id) => pl[id]?.lop !== "coTheDaRa");
  if (r.nhapQuet && r.sent.length) cau.push(`This press joined the sweep already under way and sent nothing itself: that sweep sent: ${r.sent.join(", ")}.`);
  else if (guiThuong.length) cau.push(`STOP steps sent again: ${guiThuong.join(", ")}.`);
  cau.push(...cauCoTheDaRa(r));
  const phut = Math.round(ABORT_RESEND_WINDOW_MS / 60_000);
  const conBen = r.failed.filter((id) => !r.khongBen?.includes(id));
  if (conBen.length) cau.push(chuaKhoa ? `STOP steps refused or not answered: ${conBen.join(", ")}: press Abort again within ${phut} minutes of ${MOC_CUA_SO}; past that check the machine on site.` : `STOP steps refused or not answered: ${conBen.join(", ")}; they stay owed unless a later press sends them.`);
  if (r.khongBen?.length) cau.push(chuKhongBen(r.khongBen));
  if (r.pending.length) cau.push(`STOP steps with no answer yet: ${r.pending.join(", ")}.`);
  const khongGuiLai = new Set(r.khongGuiLai ?? []);
  const chuaXacMinh = r.unverified.filter((id) => !r.khongBen?.includes(id) && !khongGuiLai.has(id));
  if (chuaXacMinh.length) cau.push(`Could not be verified as a pinned STOP: ${chuaXacMinh.join(", ")}: not sent; a later press${chuaKhoa || chuaXacMinh.some((id) => pl[id]?.lop === "xong") ? ` within ${phut} minutes of ${MOC_CUA_SO}` : ""} sends it if its read finds a pinned STOP.`);
  // T7b-1d lượt sửa 3 (F1, F7) — what a later press does not send, said so: never promised
  const quaCua = (ds: readonly string[], dau: string) => `${dau}: ${ds.join(", ")}: not sent, and a later press does not send it (past the window for a pin set again): check the machine on site and use its direct STOP / E-STOP.`;
  const ngoaiCua = r.unverified.filter((id) => khongGuiLai.has(id));
  if (ngoaiCua.length) cau.push(quaCua(ngoaiCua, "Could not be verified as a pinned STOP"));
  if (r.ghimNgoaiCua?.length) cau.push(quaCua(r.ghimNgoaiCua, "Read as a pinned STOP again"));
  if (r.notPinned.length) cau.push(`Read as no pinned STOP: ${r.notPinned.join(", ")}: not sent.`);
  if (r.untakenBranch.length) cau.push(`STOP steps in a branch never evaluated: ${r.untakenBranch.join(", ")}: not sent; check the machine on site.`);
  if (r.khongDocDuoc) cau.push(`Its records could not be read, so what they would show was not sent. ${chuBamSauKhongDoc()}: check the machine on site.`);
  if (r.quetChuaXong) cau.push(chuQuetChuaXong(runId));
  const dongChua = new Set([...r.sent, ...r.failed, ...r.pending, ...r.notPinned, ...r.unverified, ...r.untakenBranch]);
  const conLai = [...no].filter((id) => !dongChua.has(id));
  if (conLai.length) cau.push(`Recorded as owed and not sent by this press: ${conLai.join(", ")}: nothing was sent for them; check the machine on site.`);
  // H28 (dieu-phoi 09/11) — what the records say, never a fact about the machine: a debt durable nowhere reads the same
  if (!cau.length) cau.push("its records hold no STOP step owed and this press sent none: that says nothing of the machine. Check the machine on site.");
  return `Run ${runId} was already aborted — ${cau.join(" ")}`;
}

/** A2(n) T7b-1c (RC12b, dieu-phoi 09/11) — a press on a run not latched: "sent again" only of what this press sent. T7b-1d — anything more the report says, it says. */
function chuBamLaiChuaKhoa(runId: number, r: AbortStopReport): string {
  const conGi = r.failed.length || r.pending.length || r.notPinned.length || r.unverified.length || r.untakenBranch.length || r.khongDocDuoc || r.quetChuaXong || r.khongBen?.length || (r.nhapQuet && r.sent.length);
  if (conGi || r.sent.some((id) => r.phanLoai?.[id]?.lop === "coTheDaRa")) return chuBamLai(runId, r, true);
  // T7b-1d lượt sửa 5 (bảng câu dòng 13) — whether they went before, the rows cannot say cheaply (H27: a write lost reads as no trace; a precondition's abort sent nothing): "again" only as an if
  return r.sent.length ? `Run ${runId} was already aborted — its STOP steps not yet confirmed were sent (again, if they had gone before).` : `Run ${runId} was already aborted — this press sent no STOP step. Check the machine on site.`;
}

/** A2(n) T7b-1d — which words a press gets: what its own sweep read of the run. */
const chuCuaBam = (runId: number, r: AbortStopReport): string => (r.phanLoai && !r.chuaKhoa ? chuBamLai(runId, r) : chuBamLaiChuaKhoa(runId, r));

/**
 * doc 81 Đợt 6 fix 2 (N1, N4) + fix 3 (M2, M3 / R-6-d, M5) — "send the STOP steps again" on a run that is already 'aborted'
 * (an abort or a rejection of it): refused when the abort is older than ABORT_RESEND_WINDOW_MS or its time is unknown;
 * otherwise the sweep runs again (only the STOPs not confirmed). Every request is audited (abortStopResend, `resend: true`
 * on each STOP audit), and the answer is marked `resend` (the Studio does not say "aborted" again).
 */
async function resendAbortStops(
  runId: number,
  run: OrchestrationRun,
  user: FoeUser,
  scope: FoeScope,
  ok: boolean,
): Promise<StartRunResult> {
  // A2(n) T7b-1 (5a, B2, H3, A-OWED, G-OWED) — an aborted LATCHED run: what is owed is read from its rows and context when read (C4), and goes whenever a person presses, no window (B2). fix 1 (RA-1) — within
  // the window also a verified STOP with no trace of a hand-over, read so from rows that were READ (a write lost, a sweep that could not read the definition). A STOP handed over and never confirmed does
  // not go again: the run has ended (H3; G is for a run not ended). Past the window nothing else: the 15 minutes do not stretch. Rows unread and the context not latched: the old way below
  // T7b-1c (RA2-2) — this read only decides whether a sweep is worth it: what goes is the sweep's own read, classified once. This read lost is no answer: the sweep reads again
  const ctxRun = (run.contextJson as Record<string, unknown> | null) ?? {};
  const hang = await readRunStepRows(runId);
  const trongCua = abortResendAllowed(run.finishedAt);
  const quaHan = (): StartRunResult => {
    auditAbortStop(user, runId, "abortStopResend", { resend: true, outcome: "refusedTooOld", abortedAt: run.finishedAt ?? null, windowMs: ABORT_RESEND_WINDOW_MS });
    return {
      ok: false,
      enabled: foeEnabled(),
      runId,
      status: "aborted",
      reason: FOE_RESEND_TOO_OLD,
      resend: true,
      message: `Run ${runId} was aborted more than ${Math.round(ABORT_RESEND_WINDOW_MS / 60_000)} minutes ago (or when is unknown) — its STOP steps are not sent again. To stop equipment now, use the machine's direct STOP / E-STOP.`,
    };
  };
  const biet = runDaChotKhongRo(ctxRun) || (hang !== null && chotTuHang(hang) !== null);
  const noDau = biet ? stopChuaRaTuHang(hang ?? [], ctxRun) : new Set<string>();
  if ((biet && (noDau.size > 0 || trongCua)) || hang === null) {
    auditAbortStop(user, runId, "abortStopResend", { resend: true, outcome: "started", abortedAt: run.finishedAt ?? null, owed: [...noDau] });
    const abortStops = await abortStopSweep(runId, run, liveRuns.get(runId) ?? null, user, scope, { resend: true, bamLai: { trongCua } });
    if (biet || (abortStops.phanLoai && !abortStops.chuaKhoa)) {
      const conNo = Object.values(abortStops.phanLoai ?? {}).some((p) => p.lop === "no");
      if (!trongCua && !conNo && !abortStops.khongDocDuoc && !abortStops.quetChuaXong && !abortStops.sent.length && !abortStops.failed.length && !abortStops.pending.length) return quaHan();
      return { ok, enabled: foeEnabled(), runId, status: "aborted", resend: true, message: chuBamLai(runId, abortStops), abortStops };
    }
    if (!trongCua) return quaHan();
    // DIEU-LO-1 (dieu-phoi 09/11): every read lost and the context not latched: read as the old way, in the window only. A stated exception to point 3, on condition every read fails, not the behaviour wanted
    return { ok, enabled: foeEnabled(), runId, status: "aborted", resend: true, message: chuCuaBam(runId, abortStops), abortStops };
  }
  if (!trongCua) return quaHan();
  auditAbortStop(user, runId, "abortStopResend", { resend: true, outcome: "started", abortedAt: run.finishedAt ?? null });
  const abortStops = await abortStopSweep(runId, run, liveRuns.get(runId) ?? null, user, scope, { resend: true, bamLai: { trongCua: true } });
  return {
    ok,
    enabled: foeEnabled(),
    runId,
    status: "aborted",
    resend: true,
    message: chuCuaBam(runId, abortStops),
    abortStops,
  };
}

/** fix 1 (#1) — two sweeps of ONE run overlapping in this process share one (no STOP sent twice by this process). */
const abortSweepsInFlight = new Map<number, Promise<AbortStopReport>>();

/**
 * A2(n) T7b-1c (RC12b) — an Abort of a run whose walker lives, from the moment it flags the walker until its sweep has answered: the walk that ends meanwhile waits for it (noSauAbortKhoa), bounded, or it would tell a
 * STOP as not out that the sweep is about to send. Nothing of a STOP's path waits on this: only the end of a walk already aborted.
 */
const abortSapQuet = new Map<number, Promise<void>>();
const ABORT_SAP_QUET_HAN_MS = 15 * STOP_DB_STEP_DEADLINE_MS;
function chanSapQuet(runId: number): () => void {
  let tha: () => void = () => undefined;
  const p = new Promise<void>((ok) => (tha = ok));
  abortSapQuet.set(runId, p);
  return () => {
    if (abortSapQuet.get(runId) === p) abortSapQuet.delete(runId);
    tha();
  };
}

/**
 * doc 81 Đợt 6 — THE sweep (see the section header). `live` = the run's driver in this process (its memory is the
 * picture), else the stored rows of `run`. `scope` = the caller's factory scope (audit marker only). Never throws; every
 * wait is bounded.
 */
function abortStopSweep(
  runId: number,
  run: OrchestrationRun | undefined,
  live: RunContext | null,
  user: FoeUser,
  scope: FoeScope,
  /** doc 81 Đợt 10 C — `store`: the store of a run with no live walker here (default: central). A live walker's own store wins. T7b-1c — `bamLai`, `ketThucKhac`: runAbortStopSweep */
  opts: { resend?: boolean; store?: RunStore; bamLai?: { trongCua: boolean }; ketThucKhac?: true } = {},
): Promise<AbortStopReport> {
  // T7b-1d lượt sửa 1 (H29) — every wait of a sweep has its bound; this one is for the sweep itself and whoever joins it: never a silent ok. The sweep goes on behind it. Lượt sửa 2 (H32) — past it the words are of a sweep not finished (nothing was unread),
  // and this is the ceiling of the sweep's part of the answer: the URGENT of it is not waited for, it keeps its own bound and its own catch, and the answer does not say it landed. The ceiling of the answer of an Abort is 16·D (dieu-phoi 10/11):
  // these 15·D, then 1·D of nghiaVuKetThucNguoi in abortRun, bounded on its own (measured 16017 ms with the URGENT hanging)
  const coTran = (q: Promise<AbortStopReport>) =>
    withDeadline(q, ABORT_SAP_QUET_HAN_MS, `FOE abort run ${runId} STOP sweep`).catch((err: unknown): AbortStopReport => {
      console.error(`[FOE] abort of run ${runId}: STOP sweep not answered: ${(err as Error)?.message ?? err}; use the machine's direct STOP / E-STOP`);
      const report: AbortStopReport = { ...emptyAbortReport(), quetChuaXong: true };
      const ctx = (live?.context ?? (run?.contextJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
      if ((opts.store ?? live?.store ?? centralRunStore).kind === "central" && (runDaChotKhongRo(ctx) || (live !== null && daChotKhongRo(live)))) {
        report.phanLoai = {};
        void withDeadline(canhBaoKetCucKhongRo({ loai: "abortSweepUnfinished", runId, stepId: BUOC_KHONG_XAC_DINH, compId: KHONG_CO_BU_TRU, error: "FOE_OUTCOME_UNKNOWN", lan: "chot", owner: run?.startedBy ?? live?.runOwner ?? null }), 5 * STOP_DB_STEP_DEADLINE_MS, `FOE abort run ${runId} sweep not finished URGENT`).catch((loi: unknown) =>
          console.error(`[FOE] abort of run ${runId}: the URGENT of a sweep not finished failed: ${(loi as Error)?.message ?? loi}`),
        );
      }
      return report;
    });
  const running = abortSweepsInFlight.get(runId);
  // T7b-1d lượt sửa 2 — a press that joins: the report of that sweep, the words say so (no sweep of its own, by decision)
  if (running) return coTran(running.then((r) => ({ ...r, nhapQuet: true as const })));
  const p = runAbortStopSweep(runId, run, live, user, scope, opts).finally(() => {
    if (abortSweepsInFlight.get(runId) === p) abortSweepsInFlight.delete(runId);
  });
  abortSweepsInFlight.set(runId, p);
  return coTran(p);
}

/** A2(n) T7b-1c (RA2-5) — the URGENT of a latched run whose sweep could not read what it needs: no step to name. One bounded try; never a command. */
async function baoKhongDocDinhNghia(runId: number, owner: number | null): Promise<void> {
  await withDeadline(canhBaoKetCucKhongRo({ loai: "abortDefUnread", runId, stepId: BUOC_KHONG_XAC_DINH, compId: KHONG_CO_BU_TRU, error: FOE_STOP_NOT_SENT, lan: "chot", owner }), 5 * STOP_DB_STEP_DEADLINE_MS, `FOE abort run ${runId} definition unread URGENT`).catch((err: unknown) =>
    console.error(`[FOE] abort of run ${runId}: the URGENT of its definition unread failed: ${(err as Error)?.message ?? err}`),
  );
}

/**
 * A2(n) T7b-1 (5a, A2) — a stored latched run has no walk to ask: the planner's picture from its rows (the walker's own `rc` shape, nothing in memory). `aborting`: nothing of it ever walks.
 */
function rcTuHang(runId: number, def: WorkflowDefinition, ctx: Record<string, unknown>, src: AbortSweepSource, store: RunStore, user: FoeUser, owner: number | null): RunContext {
  const hang = (src.hang ?? []) as Parameters<typeof priorStepsOf>[0];
  return {
    runId,
    def,
    context: ctx,
    store,
    user,
    machineById: src.machineById,
    params: {},
    telemetry: new Map(),
    states: new Map(),
    runOwner: owner,
    startedViaApi: false,
    aborting: true,
    controller: new AbortController(),
    dispatched: new Set(),
    startOrder: [],
    settled: new Set(),
    attempted: new Set(),
    prior: priorStepsOf(hang),
    completed: new Set(hang.filter((r) => r.status === "completed").map((r) => r.stepId)),
  } as unknown as RunContext;
}

/** A2(n) T7b-1 — why a STOP an Abort handed over stays owed: a code, never a driver's text (H11). The marked route's NOT_CONFIRMED is the walker's reading too: nobody could decide it. */
function viAbortChuaRa(r: { result: EquipmentCommandResult | null; error: string | null; robot: boolean; danhDau: boolean; nem?: boolean; chuaTraLoi?: boolean }): ViChuaRa {
  if (r.chuaTraLoi) return { nguon: "driverLoi", ma: "NO_ANSWER" };
  if (r.nem) return { nguon: "driverLoi", ma: maTuChoiCua({ error: r.error }) };
  if (!r.result) return { nguon: "tuChoi", ma: maTuChoiCua({ error: r.error }) };
  const ma = maTuChoiCua({ error: r.result.error, status: r.result.status, detail: r.result.detail as { reason?: unknown } | null | undefined });
  if (r.danhDau && ma === "NOT_CONFIRMED") return { nguon: "doc", ma };
  return { nguon: nguonCuaKetQua(String(r.result.status), ma, r.robot), ma };
}

/**
 * A2(n) T9 lượt sửa 3 (RA2-8) — is this run given to an edge node: Đợt 10's assignment row (runEdgeAssignments, the one edgeAssignmentOwnershipRefusal guards), or E4's column. Bounded by D. Read AFTER the
 * Abort's STOPs were handed over (runAbortStopSweep: "after the STOPs, before the answer"): never on a STOP's road. T9 lượt sửa 3b (dieu-phoi 13/11 (A)) — unread (it throws, past D, no database) ⇒
 * "khongBiet": the words promise neither central's nor the node's, the safe act (as RA-EE).
 */
async function laRunGiaoEdge(runId: number, run: OrchestrationRun | undefined): Promise<boolean | "khongBiet"> {
  if (run?.edgeNodeId != null) return true;
  try {
    const d = await getDb();
    if (!d) return "khongBiet";
    return (await withDeadline(readEdgeAssignment(d, runId), STOP_DB_STEP_DEADLINE_MS, `FOE run ${runId} its edge assignment`)) !== null;
  } catch {
    return "khongBiet";
  }
}

/** A2(n) T7b-1 (5a, A-REF, B2) — the URGENT of a STOP an Abort of a latched run handed over and that did not go: its own name, owed, press Abort again. One bounded try each; never a command. */
async function baoStopChuaRaAbort(runId: number, ds: ReadonlyArray<{ id: string; vi: ViChuaRa; chu: ChuStopAbort | null }>, owner: number | null, adapterNut: boolean | "khongBiet" = false): Promise<void> {
  await Promise.all(
    ds.map((x) =>
      withDeadline(canhBaoKetCucKhongRo({ loai: "abortStopNotSent", runId, stepId: x.id, compId: KHONG_CO_BU_TRU, error: FOE_STOP_NOT_SENT, lan: "chot", biet: true, vi: x.vi, ...(x.chu ? { chuAbort: x.chu } : {}), ...(adapterNut === "khongBiet" ? { adapterNut: "khongBiet" as const, tuTrungTam: true as const } : adapterNut ? { adapterNut: true as const, tuTrungTam: true as const } : {}), owner }), 5 * STOP_DB_STEP_DEADLINE_MS, `FOE abort run ${runId} STOP ${x.id} not out URGENT`).catch(
        (err: unknown) => console.error(`[FOE] abort of run ${runId}: the URGENT of STOP ${x.id} not out failed: ${(err as Error)?.message ?? err}`),
      ),
    ),
  );
}

/**
 * A2(n) T7b-1 (5a, R3-E, C4), fix 1 (RA-2) — this walk ends aborted and latched, and the latch fell after the Abort's sweep (or the sweep did not reach what the walk knows): what is owed is said now.
 *   • a STOP this walk had refused before the latch (rc.stopTuChoiTruocKhoa, as duongKetThuc's vaoChuaRaTuTruocKhoa): state C on its row, told by name, unless the Abort's own STOP went;
 *   • a STOP of the Abort that did not go: its `abort:` row has no code (or was lost: then the walk's memory, and the context, hold it), told by name, under the same fixed key.
 * T7b-1c — the words come after the context write and say what it did (RA2-3: told as durable only if it is); a STOP the sweep saw go is read from the walk's memory, its row may land later (RA2-4); an Abort still on
 * its way to its sweep is waited for, bounded (RC12b). Answers what the context write threw, for the walk's exception path. Never throws, never a command. A sweep whose answer lands after this end: the scan's (T12).
 */
async function noSauAbortKhoa(rc: RunContext): Promise<unknown> {
  let loiCtx: unknown = null;
  try {
    // T7b-1d lượt sửa 1 (H29) — the walk ends: it does not stand behind a sweep past that sweep's own ceiling. Lượt sửa 2 (H32) — one ceiling for the Abort on its way and then its sweep, from when this began to wait
    await withDeadline<unknown>(
      (async () => {
        await abortSapQuet.get(rc.runId);
        await abortSweepsInFlight.get(rc.runId);
      })(),
      ABORT_SAP_QUET_HAN_MS,
      `FOE run ${rc.runId} its Abort and that Abort's sweep`,
    ).catch(() => undefined);
    const hang = (await readRunStepRows(rc.runId)) ?? [];
    const daDi = new Set([...abortSentOf(hang), ...(rc.abortDaDi ?? [])]);
    for (const id of daDi) rc.stopTuChoiTruocKhoa?.delete(id);
    const tuChoi = [...(rc.stopTuChoiTruocKhoa?.keys() ?? [])];
    await vaoChuaRaTuTruocKhoa(rc);
    const ds: Array<{ id: string; vi: ViChuaRa; ben: boolean }> = [];
    for (const r of hang) {
      if (!r.stepId.startsWith(ABORT_ROW_PREFIX) || r.status !== "failed" || String(r.error ?? "").startsWith(`${FOE_STOP_NOT_SENT}:`)) continue;
      const kq = (r.resultJson ?? {}) as { stepId?: unknown; routedTo?: unknown; status?: unknown; detail?: unknown; abortStop?: unknown };
      const id = String(kq.stepId ?? r.stepId.slice(ABORT_ROW_PREFIX.length));
      const ma = kq.abortStop === "chuaTraLoi" ? "NO_ANSWER" : maTuChoiCua({ error: r.error, status: typeof kq.status === "string" ? kq.status : null, detail: (kq.detail ?? null) as { reason?: unknown } | null });
      ds.push({ id, vi: typeof kq.routedTo === "string" ? { nguon: nguonCuaKetQua(String(kq.status), ma, kq.routedTo === "robot-dispatcher"), ma } : { nguon: "driverLoi", ma }, ben: true });
    }
    for (const [id, vi] of rc.abortChuaRa ?? []) {
      if (daDi.has(id) || ds.some((x) => x.id === id) || hang.some((r) => r.stepId === abortRowId(id))) continue;
      datChuaRa(rc, id, vi); // its row lost: the context holds it, if the write below lands
      ds.push({ id, vi, ben: false });
    }
    const ctxBen = await rc.store.persistContext(rc).then(
      () => true,
      (err: unknown) => {
        loiCtx = err ?? new Error("context write");
        return false;
      },
    );
    const sau = ctxBen ? hang : ((await readRunStepRows(rc.runId)) ?? hang);
    for (const id of tuChoi) {
      // told as owed where something durable says so; else as what it is: not recorded, the window is all there is
      if (ctxBen || sau.some((r) => r.stepId === id && laHangChuaRa(r))) baoStopChuaRa(rc, id);
      else ds.push({ id, vi: rc.chuaRaStop?.get(id) ?? { nguon: "tuChoi", ma: "REFUSED" }, ben: false });
    }
    const vao = { hang: sau, ctx: rc.context, daThu: (id: string) => rc.attempted.has(id) };
    // T7b-1d — the Abort's trace "not verified" whose row was lost: the walk's memory still says so (a sweep of a run not latched has no other source of `doc`): the same words as the row's
    const chuCua = (x: { id: string; vi: ViChuaRa }) => {
      const p = phanLoaiStopAbort(x.id, vao);
      return x.vi.nguon === "doc" ? { ...p, truoc: "chuaXacMinh" as const } : p;
    };
    if (ds.length) await baoStopChuaRaAbort(rc.runId, ds.map((x) => ({ id: x.id, vi: x.vi, chu: chuStopAbort(chuCua(x), x.ben || ctxBen) })), rc.runOwner);
    // T7b-1d (H25) — the latch fell after the sweep, or the sweep's word was lost: the same reading as the walk's end, once
    // T7b-1d lượt sửa 1 (H29) — bounded as a whole: a last word that hangs does not hold the end of the walk
    await withDeadline(
      (async () => {
        const src = await rc.store.sweepSource({ live: rc, hasLiveDriver: () => true }).catch(() => null);
        const v = await rc.store.verifyStops(rc.runId, rc.def, rc.machineById);
        await baoH13KhiAbort(rc, src, src ? await lapKeHoachStop(rc, src, v, true) : { untakenBranch: [], notPinned: [], notPinnedUntaken: [] }, true);
      })(),
      5 * STOP_DB_STEP_DEADLINE_MS,
      `FOE run ${rc.runId} what its Abort dropped`,
    );
  } catch (err) {
    console.error(`[FOE] run ${rc.runId}: what an aborted latched walk owes could not be told: ${(err as Error)?.message ?? err}`);
  }
  return loiCtx;
}

// ── A2(n) T7b-3 (H36, chu du an 10/11) — a run that ACTED, never latched, and ended with no STOP sweep (a precondition's abort or hold, a step refused every attempt, a parallel failFast true or false,
// an edge's failed / aborted end): nothing is sent, a durable URGENT names each pinned STOP still owed and sends a person to the machine. "Still owed" is what an Abort's sweep of the run would send now:
// ONE source, the sweep's own picture (sweepSource), verification (verifyStops), R-6-b (runHasActuated), planner (planAbortSweep), and its trace rule for what could not be verified. Read only. ─────────────

/**
 * H36 — what such a run owes. `live`: the walker that just let go of it (its memory is the picture, as the sweep's); else the stored run. null ⇔ nothing to tell: a latched run (its end gate and H2 words are
 * its own), a run that never acted (R-6-b), a completion with no failed step (nothing was undone, nothing is due), or nothing owed. `khongDoc`: the definition or the rows could not be read: which STOP is
 * owed cannot be told, and that is told. Pins unreadable: `chuaXacMinh`, the sweep's own class (laStopTheoBuoc / laBuTruStop "chuaDoc"), never a STOP called sent. Never throws past its reads.
 */
async function noKetThucKhongQuet(runId: number, x: { live?: RunContext | null; run?: OrchestrationRun; ketThuc: KetThucKhongQuet }): Promise<NoKetThucKhongQuet | null> {
  const store = centralRunStore;
  const src = await store.sweepSource({ live: x.live ?? null, run: x.run, hasLiveDriver: (id) => liveRuns.has(id) }).catch(() => null);
  const ctx = (x.live?.context ?? (x.run?.contextJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  if (runDaChotKhongRo(ctx) || (x.live != null && daChotKhongRo(x.live)) || chotTuHang((src?.hang ?? []) as Parameters<typeof chotTuHang>[0]) !== null) return null;
  // a completion is a run that went to its end: only one with a failed step (a parallel failFast false) left work undone, and only rows read can say so
  if (x.ketThuc === "completed" && !(src?.hang ?? []).some((r) => !r.stepId.startsWith(ABORT_ROW_PREFIX) && r.status === "failed")) return null;
  if (!src?.def || !src.rowsKnown) return { ketThuc: x.ketThuc, ghim: [], chuaXacMinh: [], khongDoc: true };
  const def = src.def;
  const v = await store.verifyStops(runId, def, src.machineById);
  if (!runHasActuated(def, src, v)) return null; // R-6-b
  const plan = await planAbortSweep(src, def, v);
  const xem = x.live ?? rcTuHang(runId, def, ctx, src, store, SYSTEM_FOE_USER, x.run?.startedBy ?? null);
  // the sweep's trace rule (runAbortStopSweep, a run not latched): stop-typed, its pins unread, bounded; past the bound the side that keeps a STOP
  const [khongXacMinh, docLai] = await Promise.all([
    Promise.all(
      plan.unverified.map(async (id) => {
        const s = findStepDeep(def.steps, id);
        return s?.type === "command" && (await withDeadline(laStopTheoBuoc(s, src.machineById), STOP_DB_STEP_DEADLINE_MS, `FOE run ${runId} end, stop ${id}`).catch(() => true)) ? id : null;
      }),
    ),
    Promise.all(
      plan.notPinned.map(async (id) => {
        const s = findStepDeep(def.steps, id);
        return s && (await withDeadline(laBuTruStop(xem, s), STOP_DB_STEP_DEADLINE_MS, `FOE run ${runId} end, stop ${id}`).catch(() => "chuaDoc" as const)) === "chuaDoc" ? id : null;
      }),
    ),
  ]);
  const ghim = plan.send.map((s) => s.id);
  const chuaXacMinh = [...khongXacMinh, ...docLai].filter((id): id is string => id !== null);
  return ghim.length || chuaXacMinh.length ? { ketThuc: x.ketThuc, ghim, chuaXacMinh, khongDoc: false } : null;
}

/** H36 — the URGENTs: one per STOP owed (one, with no step named, when the records could not be read), under ONE fixed key per (run, STOP): the event "ket". Each bounded; never a command; never throws. */
async function baoKetThucKhongQuet(runId: number, owner: number | null, no: NoKetThucKhongQuet): Promise<void> {
  const ds = no.khongDoc ? [{ id: BUOC_KHONG_XAC_DINH, xm: false }] : [...no.ghim.map((id) => ({ id, xm: false })), ...no.chuaXacMinh.map((id) => ({ id, xm: true }))];
  await Promise.all(
    ds.map((x) =>
      withDeadline(canhBaoKetCucKhongRo({ loai: "stopEndedUnswept", runId, stepId: x.id, compId: KHONG_CO_BU_TRU, error: FOE_STOP_NOT_SENT, lan: "ket", ketThuc: no.ketThuc, ...(x.xm ? { stopKhongXacMinh: true as const } : {}), owner }), 5 * STOP_DB_STEP_DEADLINE_MS, `FOE run ${runId} STOP ${x.id} owed at its end URGENT`)
        .then((ben) => {
          if (!ben) console.error(`[FOE] run ${runId}: the URGENT of STOP ${x.id}, owed at an end with no sweep, is not stored`);
        })
        .catch((err: unknown) => console.error(`[FOE] run ${runId}: the URGENT of STOP ${x.id}, owed at an end with no sweep, failed: ${(err as Error)?.message ?? err}`)),
    ),
  );
}

/** H36 — read, then tell. Bounded as a whole (its reads ≤ 4·D, the URGENTs ≤ 5·D); never throws, never a command. */
async function keVaBaoKetThucKhongQuet(runId: number, x: { live?: RunContext | null; run?: OrchestrationRun; ketThuc: KetThucKhongQuet; owner: number | null }): Promise<void> {
  await withDeadline(
    (async () => {
      const no = await noKetThucKhongQuet(runId, x);
      if (no) await baoKetThucKhongQuet(runId, x.owner, no);
    })(),
    10 * STOP_DB_STEP_DEADLINE_MS,
    `FOE run ${runId} what its end owes`,
  ).catch((err: unknown) => console.error(`[FOE] run ${runId}: what an end with no STOP sweep owes could not be told: ${(err as Error)?.message ?? err}; check the machine on site`));
}

/** H36 — central's own walk: after withLiveRun let go of the run (no Abort finds this walker any more), once. */
async function sauLuotDi(rc: RunContext): Promise<void> {
  const ket = rc.ketThucKhongQuet;
  if (!ket) return;
  delete rc.ketThucKhongQuet;
  // an Abort flagged this walker while its end was in flight (RC12b): that Abort's sweep reads the end and tells what did not go (ketThucKhac), not this
  if (rc.aborting) return;
  await keVaBaoKetThucKhongQuet(rc.runId, { live: rc, ketThuc: ket, owner: rc.runOwner });
}

/** A2(n) T7b-3 — the run row, bounded by D. null ⇔ not read or no row. */
async function docRunGioiHan(runId: number): Promise<OrchestrationRun | null> {
  const rows = await boundedAbortRead(async () => {
    const d = await getDb();
    return d ? d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1) : null;
  }, `FOE run ${runId} read`);
  return rows?.[0] ?? null;
}

/**
 * H36 — an edge segment's end, once central's transaction that applied it has COMMITTED (edgeExecutionCentral.completeForNodeV2): the run that end wrote terminal is read again (the stored picture, as an Abort's
 * sweep of it), and told what it owes. An end that changed nothing (replayed, a run already stopped) tells nothing. Never in the transaction holding the run row; never throws, never a command.
 */
export async function baoKetThucKhongQuetSauDoanEdge(runId: number, r: EdgeSegmentEndResult): Promise<void> {
  if (!r.ok || !r.changed || (r.status !== "aborted" && r.status !== "failed" && r.status !== "completed")) return;
  const ket: KetThucKhongQuet = r.status;
  const run = await docRunGioiHan(runId);
  if (!run || run.status !== ket) return; // a later write (an Abort) owns what it says
  await keVaBaoKetThucKhongQuet(runId, { run, ketThuc: ket, owner: run.startedBy ?? null });
}

/** H36 (brief point 3) — the answer to a press on a run that has ended `completed` / `failed`: the old words, unless it still owes a STOP by the same reading as its URGENT. Read only, bounded; nothing sent. */
async function chuDaKetThuc(runId: number, run: OrchestrationRun | null): Promise<string> {
  const cu = `Run ${runId} already terminal.`;
  if (!run || (run.status !== "completed" && run.status !== "failed")) return cu;
  const ket: KetThucKhongQuet = run.status;
  const no = await withDeadline(noKetThucKhongQuet(runId, { run, ketThuc: ket }), 5 * STOP_DB_STEP_DEADLINE_MS, `FOE abort run ${runId} what its end owes`).catch((): NoKetThucKhongQuet => ({ ketThuc: ket, ghim: [], chuaXacMinh: [], khongDoc: true }));
  return no ? chuBamDaKetThuc(runId, no) : cu;
}

async function runAbortStopSweep(
  runId: number,
  run: OrchestrationRun | undefined,
  live: RunContext | null,
  user: FoeUser,
  scope: FoeScope,
  /**
   * T7b-1c — `bamLai`: pressed again on an aborted run; on a latched one what the planner has due goes by THE classification at this press (stopAbortCoGui). `ketThucKhac` (RC12b): the run reached another end before this
   * Abort's write: as a run that has ended, whether or not it is latched: what goes goes by the classification, what does not is told in words true of it. A run that never acted: R-6-b stands.
   */
  opts: { resend?: boolean; store?: RunStore; bamLai?: { trongCua: boolean }; ketThucKhac?: true } = {},
): Promise<AbortStopReport> {
  const report = emptyAbortReport();
  const extra: Record<string, unknown> = opts.resend ? { resend: true } : {}; // fix 3 (M2) — every audit of a re-send says so
  // doc 81 Đợt 10 C — the picture, the stop verification, the OT STOP rows and the records go through the store: the live
  // walker's own (central or edge), else the given one (an edge re-send from a sweep picture), else central.
  const store: RunStore = live?.store ?? opts.store ?? centralRunStore;
  // A2(n) T7b-1 — a latched run (central): what did not go stays owed, on its `abort:` row (C4), and a person is told
  let khoa = false;
  // A2(n) T7b-2 (Q2-ABORT-T7b, 5a) — the Abort of a LIVE edge walker of a latched run: the planner and the marked route of a latched run, handed to the edge's own dispatcher (it owns the device and decides
  // by its signed snapshot; central's can only queue a STOP for the node, ADAPTER_OWNED_BY_EDGE). What did not go is owed on its `abort:` row, its code in the record's own result (H7): central writes it and tells
  // (reportForNode), never this process (no database here). Nothing else of `khoa` is the edge's: no URGENT, no forward words, no row of the walker rewritten
  let khoaEdge = false;
  const viNo = new Map<string, ViChuaRa>();
  const ghiNo = new Map<string, Promise<boolean>>(); // fix 1 (RA-1) — did its `abort:` row land?
  let noDaBen: ReadonlySet<string> = new Set(); // ... or does a row or the context hold the debt already
  let phanCua: (id: string) => PhanLoaiStopAbort = () => ({ lop: "khongDoc" }); // T7b-1c — THE classification, of the one read below
  const owner = run?.startedBy ?? live?.runOwner ?? null;
  // T7b-1d (H26) — a run that never latched and reached another end: no marked route; what could not be verified is listed and told
  let hoChuaKhoa = false;
  const khongXacMinhKetThuc = new Set<string>();
  const cho: Array<Promise<unknown>> = []; // T7b-1d — started beside the STOPs, waited for after them: traces and words
  const baoKhongDoc = async () => {
    report.phanLoai ??= {};
    await baoKhongDocDinhNghia(runId, owner);
  };
  try {
    const src = await store.sweepSource({ live, run, hasLiveDriver: (id) => liveRuns.has(id) });
    // T7b-1 (5a, A2, 1b) — a latched run: THE planner of the end of a walk, for a person (nguoi: G, a hand-over never confirmed is due again). R-6-b is for a run NOT latched only: latched means
    // "not known", not "never actuated" (A-STOPONLY). The edge's own walker is T7b-2's
    const ctxRun = (live?.context ?? (run?.contextJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    khoa = store.kind === "central" && (opts.ketThucKhac === true || runDaChotKhongRo(ctxRun) || (live !== null && daChotKhongRo(live)) || chotTuHang((src?.hang ?? []) as Parameters<typeof chotTuHang>[0]) !== null);
    khoaEdge = store.kind === "edge" && live !== null && daChotKhongRo(live);
    if (!src?.def) {
      store.auditAbort(user, runId, "abortStopUnverified", { stepIds: [], reason: "definitionUnreadable", ...extra });
      report.khongDocDuoc = true; // T7b-1 fix 1 (RA-1) — never read as "nothing to send"
      // T7b-1c (RA2-5, dieu-phoi 09/11) — a latched run: never a silent ok: an URGENT of its own, no step to name, whether or not the latch was told
      if (khoa) await baoKhongDoc();
      return report;
    }
    if (opts.bamLai && !opts.bamLai.trongCua && !khoa) return report; // past the window a run not latched sends nothing (resendAbortStops says so)
    const def = src.def;
    const v = await store.verifyStops(runId, def, src.machineById);
    hoChuaKhoa = opts.ketThucKhac === true && !runDaChotKhongRo(ctxRun) && !(live !== null && daChotKhongRo(live)) && chotTuHang((src.hang ?? []) as Parameters<typeof chotTuHang>[0]) === null;
    if (hoChuaKhoa && !runHasActuated(def, src, v)) return report; // R-6-b: nothing of it acted
    const hangTheo = new Map((src.hang ?? []).map((r) => [r.stepId, r] as const));
    const ketQua = (r: { resultJson?: unknown } | undefined) => (r?.resultJson ?? null) as { routedTo?: unknown; status?: unknown } | null;
    const daGiao = (id: string) => typeof ketQua(hangTheo.get(id))?.routedTo === "string" || typeof ketQua(hangTheo.get(abortRowId(id)))?.routedTo === "string";
    const daXacNhan = (id: string) => ketQua(hangTheo.get(id))?.status === "acked_verified" || ketQua(hangTheo.get(abortRowId(id)))?.status === "acked_verified";
    noDaBen = stopChuaRaTuHang(src.hang ?? [], ctxRun);
    const docDuoc = src.rowsKnown && src.hang != null; // T7b-1c — a read that failed is no "no trace"
    const vaoPhanLoai = { hang: docDuoc ? (src.hang as NonNullable<typeof src.hang>) : null, ctx: ctxRun, ...(live ? { daThu: (x: string) => live.attempted.has(x) } : {}), ghimLai: (x: string) => v.ids.has(x) };
    phanCua = (id) => phanLoaiStopAbort(id, vaoPhanLoai);
    // T7b-1d (H22) — one set for a press, on every run: what the planner has due plus an earlier Abort's trace, then the classification. T7b-2 (P4) — a walker on an edge (store edge) keeps no trace: its rows are
    // central's, as the node reports them. A central sweep of a run assigned to a node keeps its trace as on any run (a later press reads it); the node's picture route does not (docRunAbortCanGuiLaiStop)
    const dauVet = store.kind === "central" && docDuoc ? dauVetAbort(src.hang) : new Map<string, DangDauVetAbort>();
    // ... and what is owed by the one definition of a debt (rows and context): an URGENT that promises a press promises this set. A row lost on a latched run stays owed here (not H27), due or not. The verification still decides
    const daDinh: ReadonlySet<string> = store.kind === "central" ? new Set([...dauVet.keys(), ...noDaBen]) : new Set(dauVet.keys());
    const bamChuaKhoa = !khoa && opts.bamLai !== undefined && docDuoc && store.kind === "central";
    // T7b-1d lượt sửa 1 (H30, chu du an 09/11) — a press on a run not latched: a step an Abort cancelled is no last word: what stands behind it is planned, and the verification and the classification decide as for any other. At a press only: a first
    // Abort over the rows of a walker elsewhere is not covered, as decided (a latched run reads no `failed` as settled at all: lapKeHoachStop)
    const nhin = khoa ? (live ?? rcTuHang(runId, def, ctxRun, src, store, user, owner)) : khoaEdge ? live : null;
    const plan = nhin ? await lapKeHoachStop(nhin, src, v, true, { xacNhan: daXacNhan, daGiao, daDinh }) : await planAbortSweep(bamChuaKhoa ? { ...src, settled: (id) => src.settled(id) && !laHangHuyBoiAbort(hangTheo.get(id)) } : src, def, v, undefined, daDinh);
    // R-6-b — a run that never actuated sends none of its STOPs (said out loud)
    if (!nhin && plan.send.length > 0 && !runHasActuated(def, src, v)) {
      report.notNeeded = plan.send.map((s) => s.id);
      store.auditAbort(user, runId, "abortStopNotNeeded", { stepIds: report.notNeeded, reason: "runNeverActuated", ...extra });
      plan.send = [];
    }
    const danhDau = new Set<string>();
    // read, no pinned STOP: nothing is owed any more, nothing is remembered: its `abort:` row says so
    const goDauVet = (id: string) => {
      const now = new Date();
      void withDeadline(store.upsertStep(runId, abortRowId(id), "command", { status: "skipped", result: { abortStop: "notPinned", stepId: id }, error: null, startedAt: now, finishedAt: now }), STOP_DB_STEP_DEADLINE_MS, `FOE abort run ${runId} stop ${id} row`).catch(
        (err: unknown) => console.warn(`[FOE] abort of run ${runId}: stop ${id} row not written: ${(err as Error)?.message ?? err}`),
      );
    };
    // T7b-1d (H22) — a trace the verifier read as not pinned, a press on a run not latched: read again as above. Answered: the trace goes. Unread: it stays, nothing is sent (no marked route on a run not latched)
    if (bamChuaKhoa && daDinh.size) {
      const xem = live ?? rcTuHang(runId, def, ctxRun, src, store, user, owner);
      // T7b-1d lượt sửa 2 (H32) — side by side, each bounded: every STOP of the press waits behind these reads, so no number of traces may lengthen it. Taken in the order of the plan
      const docVet = await Promise.all(
        plan.notPinned
          .filter((x) => daDinh.has(x))
          .map(async (id) => {
            const s = findStepDeep(def.steps, id);
            return { id, la: s ? await laBuTruStop(xem, s) : ("khong" as const) };
          }),
      );
      for (const { id, la } of docVet) {
        if (la === "khong") goDauVet(id);
        else if (la === "chuaDoc") {
          plan.notPinned = plan.notPinned.filter((x) => x !== id);
          plan.unverified.push(id);
        }
      }
    }
    if (nhin) {
      // nobody could verify it, and its own name says STOP: the walker's marked route (F4, decision 2, A): only its dispatcher's own pinned-STOP verdict sends it. A non-STOP never goes
      // T7b-1d (H26) — a run that never latched has no marked route: listed and told (the words of the sweep's header: not verified, not sent), its safety not resting on a dispatcher's reading of a marked row
      for (const id of plan.unverified) {
        const s = findStepDeep(def.steps, id);
        if (s?.type === "command" && (await laStopTheoBuoc(s, src.machineById))) {
          if (hoChuaKhoa) {
            khongXacMinhKetThuc.add(id);
            continue;
          }
          danhDau.add(id);
          plan.send.push(s as CommandWorkflowStep);
        }
      }
      // C-3 — the verifier cannot tell "read: not pinned" from "no adapter to read": sorted again, as at the end of a walk. Unread goes by the marked route; read and not pinned is an answer:
      // nothing is owed any more (C-CLR, A-READ-3), its `abort:` row says so. One the dispatcher's predicate finds pinned stays listed, not sent (T6e K1, direction A)
      const xep = await Promise.all(
        plan.notPinned.map(async (id) => {
          const s = findStepDeep(def.steps, id);
          return { id, s, la: s ? await laBuTruStop(nhin, s) : ("khong" as const) };
        }),
      );
      for (const x of xep) {
        if (x.la === "chuaDoc" && x.s?.type === "command") {
          if (hoChuaKhoa) {
            khongXacMinhKetThuc.add(x.id);
            plan.unverified.push(x.id);
            continue;
          }
          danhDau.add(x.id);
          plan.send.push(x.s as CommandWorkflowStep);
        } else if (x.la === "khong" && (src.chuaRa?.has(x.id) || daDinh.has(x.id))) goDauVet(x.id);
      }
      plan.notPinned = xep.filter((x) => !danhDau.has(x.id) && !khongXacMinhKetThuc.has(x.id)).map((x) => x.id);
      if (danhDau.size) store.auditAbort(user, runId, "abortStopUnverified", { stepIds: [...danhDau], rowsKnown: src.rowsKnown, routed: "markedRow", ...extra });
      plan.unverified = plan.unverified.filter((id) => !danhDau.has(id));
      if (opts.bamLai && !docDuoc) report.khongDocDuoc = true; // nothing goes on it, and the answer says so
    }
    // T7b-1c — what the planner has due goes by THE classification at this press; the marked route and the pins were the planner's and stay so. T7b-1d (H22) — a run not latched too: one definition, one filter (its window stood at the door above)
    if (nhin || bamChuaKhoa) {
      if (bamChuaKhoa) report.chuaKhoa = true;
      report.phanLoai = Object.fromEntries([...new Set([...v.ids, ...plan.send.map((s) => s.id), ...noDaBen, ...daDinh])].map((id) => [id, phanCua(id)]));
      const lan: LanBamAbort = !opts.bamLai ? "dau" : opts.bamLai.trongCua ? "trongCua" : "ngoaiCua";
      // T7b-1d lượt sửa 2 (H31-K) — read earlier as no pinned STOP, its read lost now: it was on the marked route only for want of a read, and it does not go on that (0 commands, as before). It stays listed as unread: never `xong` with no word
      const macChuaDoc = plan.send.filter((s) => danhDau.has(s.id) && hangTheo.get(abortRowId(s.id))?.status === "skipped").map((s) => s.id);
      // T7b-1d lượt sửa 3 (F7) — read pinned again, its row the one of a read "not pinned", dropped by the verdict below: past the window
      const ghimLaiBoLoc = plan.send.filter((s) => !danhDau.has(s.id) && hangTheo.get(abortRowId(s.id))?.status === "skipped" && !stopAbortCoGui(phanCua(s.id), lan)).map((s) => s.id);
      if (ghimLaiBoLoc.length) report.ghimNgoaiCua = ghimLaiBoLoc;
      plan.send = plan.send.filter((s) => stopAbortCoGui(phanCua(s.id), lan));
      for (const id of macChuaDoc) {
        if (plan.send.some((s) => s.id === id)) continue;
        plan.unverified.push(id);
        // T7b-1d lượt sửa 3 (F1) — whether a later press sends it once its read finds a pin: the class it would then have, under the send path's own verdict at this press (the window only closes)
        if (!stopAbortCoGui(phanLoaiStopAbort(id, { ...vaoPhanLoai, ghimLai: () => true }), lan)) (report.khongGuiLai ??= []).push(id);
      }
    }
    report.unverified = plan.unverified;
    report.untakenBranch = plan.untakenBranch;
    report.notPinned = plan.notPinned;
    if (plan.unverified.length) store.auditAbort(user, runId, "abortStopUnverified", { stepIds: plan.unverified, rowsKnown: src.rowsKnown, ...extra });
    if (plan.untakenBranch.length) store.auditAbort(user, runId, "abortStopSkippedUntakenBranch", { stepIds: plan.untakenBranch, ...extra });
    // stop-TYPED steps that are not a pinned stop: not a real STOP (R-5-j), not sent — said out loud all the same
    if (plan.notPinned.length) store.auditAbort(user, runId, "abortStopNotPinned", { stepIds: plan.notPinned, ...extra });
    // T7b-1d (H22) — the trace of a trace-less STOP: a run not latched, one the Abort meant and could not verify. Its own name says STOP (a non-STOP leaves no debt behind it); a read that answered "not pinned" leaves none. Beside the STOPs: none waits on it
    const ghiDauVet = (id: string, dang: DangDauVetAbort): Promise<boolean> => {
      const now = new Date();
      return withDeadline(store.upsertStep(runId, abortRowId(id), "command", { status: "failed", result: { abortStop: dang, stepId: id }, error: null, startedAt: now, finishedAt: now }), STOP_DB_STEP_DEADLINE_MS, `FOE abort run ${runId} stop ${id} row`).then(
        () => true,
        (err: unknown) => {
          console.warn(`[FOE] abort of run ${runId}: stop ${id} row not written: ${(err as Error)?.message ?? err}`);
          return false;
        },
      );
    };
    if (!khoa && store.kind === "central" && (plan.unverified.length || plan.notPinned.length) && runHasActuated(def, src, v)) {
      const chuaXacMinh = [...plan.unverified];
      const docLai = plan.notPinned.filter((id) => !dauVet.has(id));
      cho.push(
        (async () => {
          const xem = live ?? rcTuHang(runId, def, ctxRun, src, store, user, owner);
          const them = async (id: string) => {
            if (dauVet.has(id)) return;
            ghiNo.set(id, ghiDauVet(id, "chuaXacMinh"));
            if (live) (live.abortChuaRa ??= new Map()).set(id, { nguon: "doc", ma: "NOT_CONFIRMED" });
          };
          for (const id of chuaXacMinh) {
            const s = findStepDeep(def.steps, id);
            // T7b-1d lượt sửa 1 (H29) — bounded: past it the side that keeps a STOP. A press reads it again: read and no STOP, the trace goes
            if (s?.type === "command" && (await withDeadline(laStopTheoBuoc(s, src.machineById), STOP_DB_STEP_DEADLINE_MS, `FOE abort run ${runId} stop ${id} trace`).catch(() => true))) await them(id);
          }
          // T7b-1d lượt sửa 2 (H32, đo) — side by side: this holds the answer (the wait on `cho`, 3·D), and past that wait one after the other left traces behind it
          await Promise.all(
            docLai.map(async (id) => {
              const s = findStepDeep(def.steps, id);
              if (s && (await withDeadline(laBuTruStop(xem, s), STOP_DB_STEP_DEADLINE_MS, `FOE abort run ${runId} stop ${id} trace`).catch(() => "chuaDoc" as const)) === "chuaDoc") await them(id);
            }),
          );
        })().catch((err: unknown) => console.error(`[FOE] abort of run ${runId}: the trace of a STOP not verified: ${(err as Error)?.message ?? err}`)),
      );
    }
    // T7b-1d (H25) — a latched run: what the walk would have told at its end. Stored and told durably already: the walker's word stands (a second key only where no word is known to have landed)
    // T7b-2 lượt sửa 1 (H25 on the edge, dieu-phoi 09/11) — a latched edge walker's Abort says what its walk's end would, from the same reading: its words go the edge's way (store.ketCucKhongRo: the node reports, central raises)
    if (nhin && (khoa || khoaEdge) && !opts.ketThucKhac) {
      const tien = live !== null || ctxRun[KET_CUC_KHONG_RO_DA_BAO_CTX_KEY] == null; // a press too, while no word is known to have landed: under one fixed key
      // driven elsewhere (an edge node, another instance): its rows lag, they cannot say what was not handed over: which step is not determined, and that is told (buocTienBiBo, no rows)
      const noiKhac = live === null && (run?.edgeNodeId != null || run?.status === "running" || run?.status === "compensating");
      cho.push(baoH13KhiAbort(nhin, noiKhac ? null : src, plan, tien).catch((err: unknown) => console.error(`[FOE] abort of run ${runId}: forward work not told: ${(err as Error)?.message ?? err}`)));
    }
    for (const id of khongXacMinhKetThuc) viNo.set(id, { nguon: "doc", ma: "NOT_CONFIRMED" });
    if (plan.send.length > 0) {
      // every STOP prepared CONCURRENTLY (≤ 2·D, the scope marker alongside ≤ D), then handed to its dispatcher IN ORDER,
      // without waiting on a reply
      const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
      const [prepared, markers] = await Promise.all([
        Promise.all(
          plan.send.map((s) => {
            const p = nhin || bamChuaKhoa ? phanCua(s.id) : null;
            return prepareAbortStop(store, runId, user, s, src.machineById, nonce, danhDau.has(s.id), p?.lop === "coTheDaRa" ? p.khoaThu : undefined);
          }),
        ),
        outOfScopeMarkers(runId, scope, plan.send, src.machineById),
      ]);
      // T7b-1 — the error of an `abort:` row of a latched run: the code of state C, so the row alone is the obligation (C4)
      const loiNo = (id: string, error: string | null, vi: ViChuaRa) => {
        if (!khoa && !khoaEdge) return error;
        viNo.set(id, vi);
        return loiChuaRaStop(id, "abort", vi);
      };
      const replies: Array<Promise<void>> = [];
      for (const p of prepared) {
        const id = p.step.id;
        const marker = markers.get(id) ?? "unknown";
        if ("error" in p) {
          report.failed.push(id);
          const viLoi = viAbortChuaRa({ result: null, error: p.error, robot: false, danhDau: danhDau.has(id) });
          if (live && !khoa) (live.abortChuaRa ??= new Map()).set(id, viLoi);
          ghiNo.set(id, recordAbortStop(store, runId, user, p.step, false, null, loiNo(id, p.error, viLoi), marker, extra, khoaEdge ? viLoi : undefined));
          continue;
        }
        report.pending.push(id);
        let sent: Promise<EquipmentCommandResult>;
        try {
          sent = equipmentRegistry.getAdapter(p.kind).sendCommand(p.cmd);
        } catch (err) {
          sent = Promise.reject(err);
        }
        const robot = isRobotKind(p.kind);
        const settle = (ok: boolean, result: EquipmentCommandResult | null, error: string | null, nem = false) => {
          report.pending = report.pending.filter((x) => x !== id);
          (ok ? report.sent : report.failed).push(id);
          const viLoi = viAbortChuaRa({ result, error, robot, danhDau: danhDau.has(id), nem });
          if (live && !khoa && !ok) (live.abortChuaRa ??= new Map()).set(id, viLoi);
          if (live && ok) (live.abortDaDi ??= new Set()).add(id); // T7b-1c (RA2-4)
          const hangGhi = recordAbortStop(store, runId, user, p.step, ok, result, ok ? error : loiNo(id, error, viLoi), marker, extra, khoaEdge ? viLoi : undefined);
          if (ok) viNo.delete(id);
          else ghiNo.set(id, hangGhi);
          // 5a (R1, THAN-GIU) — a STOP a person had waiting, sent: its own row stops saying it waits (the debt itself is read from its `abort:` row)
          if (ok && khoa && hangTheo.get(id)?.status === "held") {
            const now = new Date();
            void withDeadline(store.upsertStep(runId, id, "command", { status: "completed", result: { abortStop: "sent", stepId: id, routedTo: result?.routedTo, status: result?.status, accepted: true }, error: null, finishedAt: now }), STOP_DB_STEP_DEADLINE_MS, `FOE abort run ${runId} step ${id} row`).catch(
              (err: unknown) => console.warn(`[FOE] abort of run ${runId}: step ${id} row not rewritten: ${(err as Error)?.message ?? err}`),
            );
          }
        };
        replies.push(
          sent.then(
            (r) => settle(r.ok, r, r.ok ? null : r.error ?? `Command "${p.step.command}" rejected (${r.status}).`),
            // data-raw-ok: the dispatcher's failure, recorded in the `abort:<id>` step row + audit only.
            (err: unknown) => settle(false, null, err instanceof Error ? err.message : String(err), true),
          ),
        );
      }
      await withDeadline(Promise.all(replies), ABORT_STOP_ANSWER_WAIT_MS, `FOE abort run ${runId} stop replies`).catch(() => {
        console.warn(`[FOE] abort of run ${runId}: STOP(s) ${report.pending.join(", ")} still awaiting the dispatcher — recorded when answered`);
      });
      // T7b-1 — no answer yet on a latched run: owed until one lands (the answer's own write replaces this row). T7b-2 — on a latched edge walker too, its code in the row's own result
      if (khoa || khoaEdge) {
        for (const id of report.pending) {
          const s = plan.send.find((x) => x.id === id);
          if (!s) continue;
          const now = new Date();
          const vi = viAbortChuaRa({ result: null, error: null, robot: false, danhDau: danhDau.has(id), chuaTraLoi: true });
          viNo.set(id, vi);
          ghiNo.set(
            id,
            withDeadline(store.upsertStep(runId, abortRowId(id), "command", { status: "failed", result: { abortStop: "failed", stepId: id, ...(khoaEdge ? { chuaRa: vi } : {}) }, error: loiChuaRaStop(id, "abort", vi), startedAt: now, finishedAt: now }), STOP_DB_STEP_DEADLINE_MS, `FOE abort run ${runId} stop ${id} row`).then(
              () => true,
              (err: unknown) => {
                console.warn(`[FOE] abort of run ${runId}: stop ${id} row not written: ${(err as Error)?.message ?? err}`);
                return false;
              },
            ),
          );
        }
      } else if (store.kind === "central") {
        // T7b-1d (H22, H23) — no answer yet on a run not latched: a trace, no debt, class coTheDaRa. An answer that lands replaces it
        for (const id of report.pending) {
          ghiNo.set(id, ghiDauVet(id, "chuaTraLoi"));
          if (live) (live.abortChuaRa ??= new Map()).set(id, { nguon: "driverLoi", ma: "NO_ANSWER" });
        }
      }
    }
  } catch (err) {
    console.error(`[FOE] abort of run ${runId}: STOP sweep error — ${(err as Error)?.message ?? err}; use the machine's direct STOP / E-STOP`);
    // T7b-1d (H26) — never a silent ok: told as what it is. A latched run by RA2-5's road, the 15 minutes do not stretch; a run not latched only to the one who pressed (H23)
    report.khongDocDuoc = true;
    const ctxNem = (live?.context ?? (run?.contextJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    if (khoa || (store.kind === "central" && (runDaChotKhongRo(ctxNem) || (live !== null && daChotKhongRo(live))))) await baoKhongDoc();
  }
  await withDeadline(Promise.allSettled(cho), 3 * STOP_DB_STEP_DEADLINE_MS, `FOE abort run ${runId} traces`).catch((err: unknown) => console.warn(`[FOE] abort of run ${runId}: ${(err as Error)?.message ?? err}`));
  // T7b-1d (H27, chu du an 09/11) — a run not latched, the one write of a trace lost: a known limit, no second path for it: where the walker wrote over the rows a press sends nothing. The answer says so now, by name
  if (!khoa && store.kind === "central") {
    const mat: string[] = [];
    for (const [id, p] of ghiNo) if ((await p) !== true) mat.push(id);
    if (mat.length) report.khongBen = mat;
  }
  // T7b-1 (5a, A-REF) — what did not go, by its name: owed, press Abort again (never "it went"). After the STOPs, before the answer
  // fix 1 (RA-1) — the words say "no time limit" only of a debt that is durable: its row landed, or a row or the context already holds it. The STOPs have gone: this wait holds none of them. T7b-1c — the words read THE classification
  if (khoa && viNo.size) {
    const ds = await Promise.all(
      [...viNo].map(async ([id, vi]) => {
        const luu = (await ghiNo.get(id)) === true || noDaBen.has(id);
        // T7b-1d — this sweep handed it over: what an earlier one could not verify is no longer the word
        const p = phanCua(id);
        const chuBam = p.truoc === "chuaXacMinh" ? { lop: p.lop } : p;
        return { id, vi, chu: !opts.ketThucKhac ? chuStopAbort(chuBam, luu) : khongXacMinhKetThuc.has(id) ? ("daKetThucKhongXacMinh" as const) : hoChuaKhoa ? ("daKetThucChuaKhoa" as const) : ("daKetThuc" as const) };
      }),
    );
    // T9 lượt sửa 3 (RA2-8) — central's Abort of a run given to an edge node: its adapters are the node's (edgeAssignmentOwnershipRefusal), whatever this press's code (ADAPTER_OFFLINE: the owner not read):
    // the words of the node's road, the same rule as the node's own sweep (edgeReportsCentral), never "press Abort again, there is no time limit"
    await baoStopChuaRaAbort(runId, ds, owner, await laRunGiaoEdge(runId, run));
  }
  // a snapshot: later replies keep updating the rows / audit, not this answer
  return { ...report, sent: [...report.sent], failed: [...report.failed], pending: [...report.pending] };
}

/** A2(n) T7b-1c (RC12b) — the run's status, read back after a write of 'aborted' matched no row, bounded by D. null ⇔ not read; undefined ⇔ no row. */
async function docTrangThaiSauAbort(runId: number): Promise<OrchestrationRun["status"] | null | undefined> {
  return withDeadline(
    (async () => {
      const d = await getDb();
      if (!d) throw new DbUnavailableError();
      const [r] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
      return r?.status;
    })(),
    STOP_DB_STEP_DEADLINE_MS,
    `FOE abort run ${runId} status read back`,
  ).catch((err: unknown) => {
    console.error(`[FOE] abort of run ${runId}: status not read back: ${(err as Error)?.message ?? err}`);
    return null;
  });
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
  let thaSapQuet: () => void = () => undefined; // T7b-1c (RC12b)
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
      return resendAbortStops(runId, run, user, scopeFor(user, opts.scope), true); // fix 3 — R-6-d window, audited
    }
    if (["completed", "failed"].includes(run.status)) {
      // A2(n) T7b-3 (H36, brief point 3) — a STOP still owed by the reading of its URGENT is named, nothing is sent, nothing promised
      return { ok: false, enabled: foeEnabled(), runId, status: run.status, message: await chuDaKetThuc(runId, run) };
    }
    // R1b-2b-2a A2(n) — read BEFORE the 'aborted' write (the row as the abort found it)
    const khongRoHuy = run.status === "held" || run.status === "awaiting_confirm" ? buTruKhongRoCho(run.contextJson as Record<string, unknown> | null) : [];
    const live = liveRuns.get(runId);
    // T7b-1c (RC12b) — THIS Abort flagged the walker: a write of 'aborted' that then matches no row may have lost to the very walker it woke
    const datLive = live !== undefined && !live.aborting;
    if (live) {
      if (datLive) thaSapQuet = chanSapQuet(runId); // before the flag: the walk it wakes must find this
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
    // T7b-1c (RC12b, dieu-phoi 09/11) — the write matched no row. A walker this Abort woke may have written first, and then no STOP may be lost to "already terminal" (loại 2):
    //   read back 'aborted': confirmed, the sweep runs · the read back failed: the sweep runs (pinned STOPs only: a STOP too many is harmless, one swallowed is not), the answer says the state is not confirmed ·
    //   another end: that end is the answer, what is not out goes by the classification and is told · no walker of ours (a double click, two people): no read back, no sweep, as ever.
    let ketThucKhac: "completed" | "failed" | null = null;
    if (confirmed === false && datLive) {
      const sau = await docTrangThaiSauAbort(runId);
      if (sau === "aborted") confirmed = true;
      else if (sau === null) confirmed = "unknown";
      else if (sau === "completed" || sau === "failed") ketThucKhac = sau;
    }
    if (ketThucKhac) {
      const abortStops = await abortStopSweep(runId, run, live ?? null, user, scopeFor(user, opts.scope), { bamLai: { trongCua: true }, ketThucKhac: true });
      thaSapQuet();
      return { ok: false, enabled: foeEnabled(), runId, status: ketThucKhac, message: `Run ${runId} had already ended (${ketThucKhac}) before this Abort took effect. STOP steps handed over now: ${abortStops.sent.length}; check the machine on site.`, abortStops };
    }
    if (confirmed === false) {
      thaSapQuet();
      // T7b-3 (H36) — no walker of ours: the run ended by another hand meanwhile; what it owes is read again, the same words
      return { ok: false, enabled: foeEnabled(), runId, message: await chuDaKetThuc(runId, await docRunGioiHan(runId)) };
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
    // R1b-2b-2a A2(n) (n3) — the Abort of a run held for an unknown outcome: never refused (L-7), audited (never awaited: the STOP sweep goes on)
    if (khongRoHuy.length > 0) void ghiAuditKetCucKhongRo(user, runId, "abort", { via: "abort", stepIds: khongRoHuy, reason: reason?.trim() || null, confirmed });
    // doc 81 Đợt 6 — skip every non-STOP step, still send the remaining STOP steps and the due STOP compensations.
    const abortStops = await abortStopSweep(runId, run, lateLive ?? live ?? null, user, scopeFor(user, opts.scope));
    thaSapQuet();
    // A2(n) T7 (decision B) — the order: the status, the sweep, then one bounded URGENT and the audit. Neither blocks
    await nghiaVuKetThucNguoi(runId, user, "abort", { live: lateLive ?? live ?? null, ctx0: (run.contextJson as Record<string, unknown> | null) ?? {}, owner: run.startedBy ?? null, stops: abortStops, reason });
    if (confirmed === "unknown") {
      return {
        ok: false,
        enabled: foeEnabled(),
        runId,
        reason: FOE_ABORT_UNCONFIRMED,
        // H38 thêm (dieu-phoi 13/11, P3 of kiem-dinh) — `sent` is the dispatcher's acceptance, the machine has not confirmed it: never "confirmed sent" (here and in the two rejection answers)
        message: `Abort of run ${runId} not confirmed by the database in time — STOP steps handed to the dispatcher (the machine has not confirmed them): ${abortStops.sent.length}; ${chuThuLai()}`,
        abortStops,
      };
    }
    // T7b-1c — a latched run: never a silent ok (RA2-5), and what it knows of a key used again
    const loi = [...(abortStops.khongDocDuoc ? [chuKhongDocDinhNghia(runId)] : []), ...(abortStops.quetChuaXong ? [chuQuetChuaXong(runId)] : []), ...cauCoTheDaRa(abortStops), ...(abortStops.khongBen?.length ? [chuKhongBen(abortStops.khongBen)] : [])];
    return { ok: true, enabled: foeEnabled(), runId, status: "aborted", abortStops, ...(loi.length ? { message: loi.join(" ") } : {}) };
  } catch (err) {
    thaSapQuet();
    // data-raw-ok: như trên — lỗi một bước trong bộ thực thi quy trình.
    return { ok: false, enabled: foeEnabled(), runId, message: err instanceof Error ? err.message : String(err) };
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// doc 81 Đợt 9 tasks S2 / S3 (owner decision 2026-10-12, "edge workflow execution — do it fully") — the engine side of EDGE
// EXECUTION. The edge gateway's DATABASE_URL is the central control-plane DB, so an edge node executes THE CENTRAL RUN ROW
// (same run id, same workflow id — mig 0370's ID mapping) with this very engine: every gate is the same code over the same
// rows (Group R identity rule, binding digest, program checksum through the edge's own drivers, R-4-x, STOP exemptions).
// Protocol and limits: server/services/edge/edgeExecutionCentral.ts, edgeExecutionAgent.ts, docs/EDGE_GATEWAY.md.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * doc 81 Đợt 9 final wave F6 (final review M6) — the row of a NEW run, built in ONE place for startRun and startEdgeAssignedRun
 * (they used to build it twice "in step"):
 *   • doc 81 Đợt 5 task E1 (item 24, option C) — an API-started run is marked in BOTH server-written places (see
 *     foeGateApproval.FOE_API_RUN_PARAM): paramsJson is never rewritten after the INSERT; contextJson may be;
 *   • doc 81 Đợt 7 task I3 — the version this run executes (server-written; a caller's value is replaced);
 *   • the owner: the starting user, else the API key's holder (ownerUserId).
 */
function buildNewRunValues(
  wf: { id: number; ref: string; version: number | null },
  params: Record<string, unknown> | null | undefined,
  user: FoeUser,
  opts: { viaApi?: boolean; ownerUserId?: number | null } | undefined,
) {
  const humanStart = Number.isInteger(user.id) && user.id > 0;
  const viaApi =
    opts?.viaApi === true ||
    (!humanStart && opts?.ownerUserId != null && opts.ownerUserId > 0) ||
    runStartedViaApi({ paramsJson: params });
  const runValues = {
    workflowId: wf.id,
    workflowRef: wf.ref,
    status: "queued" as const,
    paramsJson: { ...(params ?? {}), ...(viaApi ? { [FOE_API_RUN_PARAM]: true } : {}), [FOE_DEF_VERSIONS_PARAM]: [wf.version ?? 1] },
    contextJson: viaApi ? { startedViaApi: true } : {},
    startedBy: user.id || (opts?.ownerUserId != null && opts.ownerUserId > 0 ? opts.ownerUserId : null),
    startedAt: new Date(),
  };
  return { viaApi, runValues };
}

/** The principal an edge-side abort (signal / run guard) is recorded under — never a person. */
const EDGE_GUARD_ABORT_USER: FoeUser = { id: 0, role: "system", name: "edge: central abort" };

/**
 * central: create the run 'queued' + its edge assignment, atomically (startRun's checks already passed). The run row carries
 * EXACTLY the values startRun's own insert writes (API marker, executed version, owner — one builder, buildNewRunValues) and, for an
 * API run with an authenticated key, the key IN THE INSERT (mig 0369: the column is never written later). Nothing recordable
 * (0370 / 0369 missing, the node gone, a DB error) ⇒ the transaction rolls back and no run exists.
 */
async function startEdgeAssignedRun(
  d: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  x: {
    wf: { id: number; ref: string; version: number | null };
    def: WorkflowDefinition;
    params: Record<string, unknown>;
    user: FoeUser;
    opts: { viaApi?: boolean; ownerUserId?: number | null; apiKeyId?: number | null; edgeNodeId?: number; onStarted?: (runId: number) => void };
    stopOnlyOut: OutOfScope;
  },
): Promise<StartRunResult> {
  const { wf, def, params, user, opts } = x;
  const { viaApi, runValues } = buildNewRunValues(wf, params, user, opts); // final wave F6 — the SAME builder as startRun
  const apiKeyId = viaApi && typeof opts.apiKeyId === "number" && Number.isInteger(opts.apiKeyId) && opts.apiKeyId > 0 ? opts.apiKeyId : null;
  const a = { wf, def, runValues, apiKeyId, edgeNodeId: opts.edgeNodeId as number, user, stopOnlyOut: x.stopOnlyOut, onStarted: opts.onStarted };
  if (!Number.isInteger(a.edgeNodeId) || a.edgeNodeId <= 0) return { ok: false, enabled: true, message: "A valid edge node is required." };
  // doc 81 Đợt 10 C fix review 5 (R-10-bn, design §2.12) — the node must OWN every device the definition binds (robots and OT
  // adapters, STOP steps included — an edge drives only its own devices), now; a target that cannot be resolved, or an
  // ownership that cannot be read, refuses the assignment (fail-closed). B's claim re-checks it (edgeExecutionCentral).
  const notOwned = await edgeAssignmentOwnershipRefusal(d, a.edgeNodeId, a.def);
  if (notOwned) return { ok: false, enabled: true, stepIds: notOwned.stepIds, message: notOwned.message };
  let run: OrchestrationRun;
  try {
    run = await d.transaction(async (tx) => {
      const [r] =
        a.apiKeyId !== null
          ? ((await tx.insert(edgeRunInsertWithApiKey).values({ ...a.runValues, startedViaApiKeyId: a.apiKeyId }).returning()) as unknown as OrchestrationRun[])
          : await tx.insert(orchestrationRuns).values(a.runValues).returning();
      await tx.insert(runEdgeAssignments).values({
        runId: r.id,
        edgeNodeId: a.edgeNodeId,
        workflowId: a.wf.id,
        workflowVersion: a.wf.version ?? 1,
        defHash: hashWorkflowDefinition(a.def),
        assignedBy: Number.isInteger(a.user.id) && a.user.id > 0 ? a.user.id : (a.runValues.startedBy ?? null),
      });
      return r;
    });
  } catch (err) {
    // nothing was created (the transaction rolled back): 0370 / 0369 missing, the node gone, a DB error
    console.error(`[FOE] run of "${a.wf.ref}" for edge node ${a.edgeNodeId} not created: ${(err as Error)?.message ?? err}`);
    return { ok: false, enabled: true, message: "The run could not be handed to the edge node (edge execution unavailable) — nothing was started." };
  }
  try {
    a.onStarted?.(run.id);
  } catch {
    /* a caller's callback never stops the run */
  }
  auditStopOutOfScope(a.user, a.def, run.id, "start", a.stopOnlyOut);
  void appendRunEvent(run.id, "RUN_CREATED", { ts: Date.now(), data: { workflowRef: a.wf.ref, edgeNodeId: a.edgeNodeId } });
  return { ok: true, enabled: true, runId: run.id, status: "queued", edgeNodeId: a.edgeNodeId };
}

/**
 * fix review 5 (R-10-bn) — why `def` cannot be assigned to edge node `nodeId` (null ⇔ it can): the devices are resolved with
 * central's own rule for edge runs (edgeRunAnalysis.analyseDefinition — the one B's claim uses) and must be OWNED by the node
 * and placed in its factory (edgeCentralCommon.ownedRobotIds / ownedAdapterIds — the claim's predicate). A command step whose
 * device cannot be resolved (no adapter, no robot id, unknown machine / command) or any read error ⇒ refused.
 */
async function edgeAssignmentOwnershipRefusal(
  d: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  nodeId: number,
  def: WorkflowDefinition,
): Promise<{ message: string; stepIds: string[] } | null> {
  try {
    const { analyseDefinition, loadMachineMap } = await import("../../edge/edgeRunAnalysis");
    const { ownedRobotIds, ownedAdapterIds } = await napEdgeChung();
    const map = await loadMachineMap(d as never, def);
    const an = await analyseDefinition(d as never, 0, def, map);
    const unresolved = new Set(an.unresolved);
    for (const s of allStepsOf(def.steps)) {
      if (s.type !== "command") continue;
      const c = commandOf(s, map);
      if (!c) unresolved.add(s.id);
      else if (isRobotKind(c.cap.adapterKind)) {
        const rid = (s.args ?? {}).robotId;
        if (!(typeof rid === "number" && Number.isInteger(rid) && rid > 0)) unresolved.add(s.id);
      }
    }
    const [ownR, ownA] = await Promise.all([ownedRobotIds(d as never, nodeId, an.robotIds), ownedAdapterIds(d as never, nodeId, an.adapterIds)]);
    const foreign = [...an.robotIds.filter((id) => !ownR.has(id)).map((id) => `robot ${id}`), ...an.adapterIds.filter((id) => !ownA.has(id)).map((id) => `adapter ${id}`)];
    if (unresolved.size === 0 && foreign.length === 0) return null;
    const what = [foreign.length ? `devices it does not own (${foreign.slice(0, 5).join(", ")})` : "", unresolved.size ? `steps whose device cannot be resolved (${[...unresolved].slice(0, 5).join(", ")})` : ""].filter(Boolean).join("; ");
    // data-raw-ok: an operator-facing refusal naming the devices / steps (nothing was created)
    return { message: `The run cannot be handed to edge node ${nodeId}: ${what} — an edge node drives only the devices it owns. Nothing was started.`, stepIds: [...unresolved] };
  } catch (err) {
    console.error(`[FOE] edge assignment to node ${nodeId}: device ownership not verified — ${(err as Error)?.message ?? err}`);
    return { message: `The run cannot be handed to edge node ${nodeId}: device ownership could not be verified — nothing was started; retry.`, stepIds: [] };
  }
}

/** What the edge's agent holds for the segment it claimed (the token itself never leaves the agent's store). */
export interface EdgeClaim {
  runId?: number;
  claimSeq: number;
  claimToken?: string;
  /** the snapshot hash the agent claimed for (when given, it must be the package's) */
  defHash?: string;
}

/** What an edge walk returns to the agent: `refused` (nothing walked) or how the segment ended (POST complete). */
export type EdgeDriveResult = { ok: boolean; status?: OrchestrationRun["status"]; refused?: string; detached?: boolean } & Partial<EdgeSegmentEnd>;

/**
 * doc 81 Đợt 10 task C (design §2.14) — EDGE: walk the run of a VERIFIED, SIGNED run package (edgeTrust.verifyEdgeRunPackage —
 * the agent verifies it before calling) for the claim the agent holds, against the edge `store` (edge/edgeRunStore.ts). Reads
 * NO database: the definition, machines, prior picture, context, owner and the adapter of every OT step are the package's.
 * Refused (nothing walked, nothing written) unless the package is for this claim, its definition hashes to its defHash (= the
 * one the agent claimed) and the run has an owner (validated active centrally). The walk is a resume (completed steps are
 * skipped, an approved gate passes, an unapproved one pauses); every NON-STOP command asks central (the store's /authorize), a
 * STOP never does (L-7). The result carries the segment end the agent reports (POST complete).
 */
export async function driveEdgeRunFromPackage(pkg: EdgeRunPackage, claim: EdgeClaim, store: RunStore): Promise<EdgeDriveResult> {
  if (!foeEnabled()) return { ok: false, refused: "FOE is disabled on this edge" };
  if (store.kind !== "edge") return { ok: false, refused: "an edge run is walked only against an edge store (no database on the edge)" };
  if ((claim.runId !== undefined && claim.runId !== pkg.runId) || claim.claimSeq !== pkg.claimSeq) return { ok: false, refused: "the run package is not for this claim" };
  const def = pkg.definition as unknown as WorkflowDefinition;
  if (!def || !Array.isArray(def.steps) || hashWorkflowDefinition(def) !== pkg.defHash || (claim.defHash !== undefined && claim.defHash !== pkg.defHash)) {
    return { ok: false, refused: "the workflow definition is not the assigned snapshot" };
  }
  const owner = pkg.owner;
  if (!owner || !(Number.isInteger(owner.id) && owner.id > 0) || typeof owner.role !== "string" || !owner.role) return { ok: false, refused: "the run has no active owner" };
  const context = { ...((pkg.context as Record<string, unknown>) ?? {}) };
  const p = pkg.prior;
  const rc: RunContext = {
    runId: pkg.runId,
    def,
    params: (pkg.params as Record<string, unknown>) ?? {},
    context,
    user: { id: owner.id, role: owner.role, name: "edge" },
    store,
    machineById: new Map(pkg.machines.map((m) => [m.id, { id: m.id, machineType: m.machineType, capabilities: m.capabilities as never }] as const)),
    telemetry: new Map<string, unknown>(Object.entries((context.telemetry as Record<string, unknown>) ?? {})),
    states: new Map<number, string>(Object.entries((context.states as Record<string, string>) ?? {}).map(([k, v]) => [Number(k), v])),
    completed: new Set(p.completed),
    runOwner: owner.id,
    startedViaApi: pkg.startedViaApi === true,
    aborting: false,
    controller: new AbortController(),
    dispatched: new Set(),
    startOrder: [],
    settled: new Set(),
    prior: { settled: new Set(p.settled), startOrder: [...p.startOrder], branches: new Map(p.branches.map((b) => [b.stepId, b.branch] as const)), attempted: new Set(p.attempted), unknown: p.unknown },
    attempted: new Set(),
  };
  const status = await driveRunFromResume(rc);
  if (rc.edgeDetached) return { ok: false, status, detached: true, refused: "the claim on this run is no longer this walker's — it let go of the run (nothing more written)" };
  const end = store.segmentEnd?.() ?? null;
  return { ok: status !== "failed" && status !== "aborted", status, ...(end ?? {}) };
}

/**
 * doc 81 Đợt 10 task C — EDGE: central aborted a run after its last segment on this node ended (no walker left here) and could
 * not confirm some of its STOPs: the pull hands a SIGNED sweep picture (verified by the agent — edgeTrust.verifyEdgeSweepPicture).
 * Re-sends the picture's VERIFIED STOPs not confirmed yet through THIS process's dispatchers — the engine's abort sweep over
 * the stored picture (a confirmed STOP is never sent again; only STOPs, never motion). No database. Refused when the picture is
 * older than ABORT_RESEND_WINDOW_MS (an old STOP must never reach a machine restarted since — R-6-d; central only issues
 * pictures of runs aborted within that window).
 */
export async function resendStopsOfAbortedRun(picture: EdgeSweepPicture, user: FoeUser, store: RunStore): Promise<StartRunResult> {
  const runId = picture.runId;
  // fix review 1 — the window counts from the ABORT (central's finishedAt, carried signed in the picture); issuedAt only when absent
  const abortedAt = (picture as { abortedAt?: number | null }).abortedAt ?? null;
  if (!abortResendAllowed(abortedAt ?? picture.issuedAt)) {
    store.auditAbort(user, runId, "abortStopResend", { resend: true, outcome: "refusedTooOld", abortedAt, pictureIssuedAt: picture.issuedAt, windowMs: ABORT_RESEND_WINDOW_MS });
    return {
      ok: false,
      enabled: foeEnabled(),
      runId,
      status: "aborted",
      reason: FOE_RESEND_TOO_OLD,
      resend: true,
      message: `Run ${runId} was aborted more than ${Math.round(ABORT_RESEND_WINDOW_MS / 60_000)} minutes ago, counted from the abort its STOP picture carries (from the picture itself when that is unknown) — its STOP steps are not sent again. To stop equipment now, use the machine's direct STOP / E-STOP.`,
    };
  }
  store.auditAbort(user, runId, "abortStopResend", { resend: true, outcome: "started", abortedAt, pictureIssuedAt: picture.issuedAt });
  const abortStops = await abortStopSweep(runId, undefined, null, user, null, { resend: true, store });
  return { ok: true, enabled: foeEnabled(), runId, status: "aborted", resend: true, message: `Run ${runId} was aborted — its STOP steps not yet confirmed were sent again from this edge.`, abortStops };
}

/**
 * EDGE: central stopped `runId` (abort / gate rejection — learned from a protocol answer or the run guard). The walker of it
 * in THIS process is flagged at once (no further non-STOP step; a wait wakes up), then the Đợt 6 sweep runs over its live
 * picture: the remaining real STOP steps and due STOP compensations are SENT through this edge's dispatchers (a STOP central
 * already confirmed sent is not sent again; one already on its way finishes). Nothing is written to the run row (central
 * owns 'aborted'; the walker's own writes are conditional) — a run is never resurrected. No walker here ⇒ nothing to do.
 */
// (doc 81 Đợt 9 final wave F5 — this JSDoc sat above resendStopsOfAbortedRun's since S3; moved to its own function.)
export async function stopLiveRunForCentralAbort(runId: number, user: FoeUser): Promise<{ live: boolean; abortStops?: AbortStopReport }> {
  const live = liveRuns.get(runId);
  if (!live) return { live: false };
  live.aborting = true;
  live.controller.abort();
  const abortStops = await abortStopSweep(runId, undefined, live, user, null);
  return { live: true, abortStops };
}
