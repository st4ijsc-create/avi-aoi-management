/**
 * Sprint F4a/F4b — Command Dispatcher (the ONE entry to send a machine command).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY:
 *   - This module is NOT exported to tRPC. It is reachable ONLY from a write-tool's
 *     execute(), which itself runs ONLY after the HITL confirm flow
 *     (proposeAction → confirmAction; RBAC #1 + #2 + audit) in aiCopilotActions.
 *   - dispatch() is the ONLY caller of driver.writeTags() (which reaches the
 *     physical device). No other code path may call writeTags / dispatch.
 *   - Two trigger sources, BOTH passing the same shared gates (allowlist
 *     tag.writable, adapter/tag enabled, driver active, OT_CONTROL_ENABLED,
 *     idempotency). Source is the discriminated `triggeredBy.kind`:
 *       'hitl'      → a human-confirmed AI write-action (F4). dispatch re-verifies
 *                     the ai_pending_actions row is confirmed/executed AND owned by
 *                     `confirmedBy` before doing anything.
 *                     doc 81 Đợt 1B Task 6 — on the REAL-write path that legacy check is
 *                     NOT enough: the action must be BOUND to this exact command (tool +
 *                     canonical payload hash, otActionBinding.ts), status 'confirmed'
 *                     (never 'executed'), unexpired, and it is CONSUMED exactly once
 *                     (SELECT … FOR UPDATE + CAS confirmed→executed in the SAME tx that
 *                     writes the ledger intent). No actionId on the real path ⇒
 *                     PRECONDITION_FAILED. `requireBoundAction` (Sparkplug DCMD/NCMD)
 *                     applies the binding check on EVERY path, simulated included.
 *       'interlock' → a DETERMINISTIC, human-approved interlock rule auto-firing
 *                     (F5b). dispatch re-verifies (verifyInterlockAuthorization):
 *                     rule enabled + approvedBy set & matching + requiresHumanConfirm
 *                     =false + action∈{block_downstream,stop_line,reduce_speed} +
 *                     target adapter/tag match, the event belongs to the rule, AND
 *                     the master flag INTERLOCK_AUTO_BLOCK_ENABLED==="true".
 *   - SAFETY: the AI has NO code path that produces kind='interlock'. The
 *     interlock engine (server-internal) is the only caller of that branch; it is
 *     never exported to tRPC. The AI may only propose inert rules.
 *   - Mode gate: when OT_CONTROL_ENABLED !== "true" (the DEFAULT) the dispatcher
 *     NEVER calls driver.writeTags — it records a `simulated` commandLog row and
 *     returns { simulated: true }.
 *   - C2 COMMISSIONING / FAT GATE (doc 24 Wave-1): an ADDITIONAL, stricter gate
 *     layered ON TOP of the mode gate — it never removes or relaxes any existing
 *     check. Flag OT_COMMISSIONING_REQUIRED (DEFAULT ON). Even when
 *     OT_CONTROL_ENABLED==="true" AND every other gate would pass, if the target
 *     adapter has NO active/non-expired/signed commissioning record, dispatch is
 *     FORCED down the SAME 'simulated' path (a commandLog row with errorText
 *     'not_commissioned: …'; driver.writeTags is NEVER called). PRECEDENCE:
 *     not-commissioned ⇒ simulated REGARDLESS of OT_CONTROL_ENABLED. Mirrors the
 *     proven sim-gate → deploy precondition (programmingService). Set the flag
 *     false ONLY for legacy/dev.
 *   - F4b (OT_CONTROL_ENABLED==="true"): after ALL F4a gates pass, dispatch calls
 *     driver.writeTags() under a timeout (OT_CONTROL_TIMEOUT_MS, default 5000ms).
 *     write ok → status='acked'; write ok:false → 'failed'; timeout → 'timeout';
 *     throw → 'failed'. All 5 drivers (opcua/modbus/s7/mitsubishi-mc/ethernet-ip)
 *     write for real.
 *   - G2.1 READ-BACK (OT_READBACK_ENABLED==="true", default OFF): when a write
 *     acked AND read-back is enabled, dispatch issues ONE driver.readTags() (under
 *     the same timeout) on the acked tags and compares the read value (already
 *     scaled) to the requested value. Match → 'acked_verified'; mismatch / bad /
 *     readTags throws-or-times-out → 'acked_unverified' (WARN ONLY — ok STAYS true,
 *     NEVER 'failed', NO blind retry; quyết định #4). readTags is called AT MOST
 *     ONCE per dispatch. Flag OFF → behaviour unchanged ('acked', no readTags).
 *   - Every branch (rejected / failed / simulated / acked / timeout) writes a
 *     commandLog row. The tag.writable allowlist is enforced BEFORE any write.
 *   - Idempotency: a prior terminal commandLog for the same idempotencyKey is
 *     returned as-is (no second dispatch / no blind retry).
 *   - doc 81 Đợt 1B Task 6 — WRITE-AHEAD LEDGER (real-write path only). command_log
 *     is WORM (INSERT+SELECT), so the ledger is two INSERTs, never an UPDATE:
 *       1. under pg_advisory_xact_lock(hashtext('ot.command:'||idempotencyKey)) the
 *          key is re-probed, the HITL action is bound+consumed, and one INTENT row per
 *          write is inserted: status 'sent', ackValue {ledger:'intent'}, idempotencyKey
 *          'intent:<per-write key>'. The tx commits BEFORE driver.writeTags is called;
 *          if it fails nothing is sent (LEDGER_INTENT_FAILED — the one branch that leaves
 *          no ledger row: the ledger itself refused the INSERT; the action is not consumed).
 *       2. after the write, one RESULT row per write (the per-write key as before,
 *          ackValue {ledger:'result', intentId}) — linked to its intent by id AND by
 *          the deterministic key pair.
 *     An intent without a result (crash mid-write, or a same-key call in flight) is
 *     never re-written: a later call with that key is refused DUPLICATE_IN_FLIGHT.
 *   - NO auto-chaining: dispatch handles exactly one command request.
 *   - G1.7 (doc 44 W0-D): every ledger row additionally carries `correlation_id`
 *     (from DispatchInput.correlationId, else the AsyncLocalStorage correlation
 *     backbone, else NULL) + `deadline_ms`. When `deadlineMs` is provided it
 *     REPLACES the global OT_CONTROL_TIMEOUT_MS for THIS command (capped by
 *     OT_CONTROL_TIMEOUT_MAX_MS when set); past-deadline unacked → 'timeout'
 *     exactly like the existing flow. Absent → behaviour byte-for-byte unchanged.
 *   - G1.6 (doc 44 W0-D): after a terminal result (any branch — simulated / acked*
 *     / failed / timeout / rejected, including an idempotent cached replay) a
 *     `cmd_ack` message { command_id, correlation_id, status, reason, ts, result? }
 *     (LDS-L1 §8.5) is published to the UNS via unsPublisher.publishCmdAck.
 *     FIRE-AND-FORGET: a publish error can NEVER fail or delay the dispatch
 *     result. Flag UNS_CMD_ACK_ENABLED (default OFF ⇒ nothing is imported or
 *     published). The publisher is loaded via dynamic import to avoid a module
 *     cycle (unsPublisher statically imports this dispatcher).
 *   - G1.9 (doc 44 W2-A3): when OT_CMD_SERIALIZE_ENABLED === "true" (default OFF)
 *     real-writes to the SAME adapter are SERIALIZED through an in-process
 *     per-adapter queue (spec §13.2 — "lệnh tới cùng asset xử lý tuần tự").
 *     Bounded: queue depth ≥ OT_CMD_QUEUE_MAX (default 10) → immediate 'rejected'
 *     reason 'BUSY' (spec §13.3). The lock wraps ONLY the write+verify section;
 *     every gate above (and the simulated path) is unchanged.
 *     doc 81 Đợt 1E (R-1E-a): a PINNED stop is never BUSY — it runs right after
 *     the in-flight write and cancels the non-stop commands still waiting ahead
 *     of it (reason 'SUPERSEDED_BY_STOP').
 * ════════════════════════════════════════════════════════════════════════════
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  aiPendingActions,
  deviceAdapters,
  deviceTags,
  commandLog,
  interlockRules,
  interlockEvents,
  type AiPendingAction,
  type CommandLog,
} from "../../../drizzle/schema";
import { boundedKey, canonicalOtValue, FOE_ENGINE_TOOL, foeSelfApprovalRefusal, otPayloadHash, readOtPayloadHash } from "./otActionBinding";
import { foeApprovalDbRefusal } from "../orchestration/foe/foeGateApproval"; // doc 81 Đợt 4 fix round 1 (R-4-i)
import { isOtSafetyPreflightEnabled, safetyPreflightReason, type SafetyUnknownBasis } from "./safetyPreflightPolicy"; // final wave (item 3): one policy, two dispatchers
import { getActiveConnectionFingerprint, getActiveDriver } from "./otManager";
import { adapterTargetFingerprint } from "./adapterTarget";
import type { AppErrorCode, AppErrorParams } from "../../_core/appErrorCodes";
import { AUDIT_ACTIONS, createAuditContext, logCrudOperation } from "../auditTrailService";
import type { OtTagAddress } from "./otDriver";
import { readbackMatches } from "./drivers/readbackCompare";
import { withDeadline } from "./drivers/boundedClose"; // final wave 5 (M4)
import { isCommissioned, isCommissioningRequired } from "./commissioningService";
// Doc 25 T1 — cổng interlock ĐỒNG BỘ, fail-closed chạy TRƯỚC mọi real-write HITL.
// Import từ interlockGate (module chỉ đọc DB, KHÔNG import ngược commandDispatcher →
// không tạo vòng phụ thuộc).
import { evaluateInterlockGate } from "../interlock/interlockGate";
import { evaluateCommandPolicy, secPlatformEnabled } from "../security/policyGate"; // doc 33 I2 (F5): policy-as-code gate
// G1.7 (doc 44 W0-D) — correlation backbone (AsyncLocalStorage, opt-in): when the
// caller did not pass an explicit correlationId we read the ambient one (if any).
import { getCorrelationId } from "../observability/correlation";
// doc 81 Đợt 1D Task 2 — per-tag pinned STOP values (mig 0362, Task 1).
import { loadStopPins, matchPinnedStop, stopPinsFromTagRows, validateStopValue, type MatchPinnedStopResult, type StopPin, type StopPinTagRow } from "./stopPin";

/** True when the operator has explicitly enabled real OT control (F4b). */
export function isOtControlEnabled(): boolean {
  return process.env.OT_CONTROL_ENABLED === "true";
}

/**
 * G2.1 — True when read-back ack verification is enabled (default OFF). Read at
 * RUNTIME (not module load) so tests/operators can toggle it. When OFF, an acked
 * write keeps status 'acked' and dispatch NEVER calls driver.readTags.
 */
export function isOtReadbackEnabled(): boolean {
  return process.env.OT_READBACK_ENABLED === "true";
}

/** Float tolerance for read-back compare (default 1e-6). */
function readbackFloatTolerance(): number {
  const t = Number(process.env.OT_READBACK_FLOAT_TOLERANCE);
  return Number.isFinite(t) && t > 0 ? t : 1e-6;
}

/**
 * Master flag for the F5b auto-block path. When false (the DEFAULT) an
 * 'interlock'-triggered dispatch is REJECTED outright (INTERLOCK_AUTO_BLOCK_DISABLED)
 * and never writes — even if every other gate would pass. Bật = cho phép interlock
 * rule TỰ ghi lệnh chặn/dừng xuống máy (vẫn cần OT_CONTROL_ENABLED + rule approved).
 */
export function isInterlockAutoBlockEnabled(): boolean {
  return process.env.INTERLOCK_AUTO_BLOCK_ENABLED === "true";
}

/** Interlock actions that are allowed to auto-fire a command (allowlist). */
const INTERLOCK_AUTO_ACTIONS: ReadonlySet<string> = new Set([
  "block_downstream",
  "stop_line",
  "reduce_speed",
]);

/**
 * doc 48 R1 (T1) — SAFETY-PLC PREFLIGHT flag. Read at RUNTIME (tests/operators toggle).
 * Default ON: safety should be on UNLESS an operator EXPLICITLY disables it
 * (=== "false"). doc 81 Đợt 1B Task 6: an UNKNOWN safety status (no safety-PLC
 * configured/enabled, or a read error) now BLOCKS a real HITL write (SAFETY_UNKNOWN) —
 * only an OK read lets it through. See readSafetyStateForPreflight + the (5a-safety) gate.
 * doc 81 Đợt 1B final wave (item 3): the read-site lives in safetyPreflightPolicy.ts, shared
 * with the robot dispatcher (ROBOT_SAFETY_PREFLIGHT_ENABLED, same default/semantics); this
 * export is kept for existing callers/tests and delegates — no second read-site.
 */
export function isSafetyPreflightEnabled(): boolean {
  return isOtSafetyPreflightEnabled();
}

/**
 * doc 48 R1 (T1) — read the target adapter's READ-ONLY SafetyState for the pre-write
 * preflight (spec invariant #1: a BLOCKED safety-PLC must deny actuation). Delegates to
 * the adapter facade's getSafetyStatus (driver.getSafetyStatus → else the safety-PLC
 * status adapter). The facade is HONEST: it returns 'UNKNOWN' (never a fabricated
 * 'OK'/'BLOCKED') when no source is readable, and never actuates a safety function.
 *
 * Dynamic import avoids a STATIC module cycle (adapterFacade statically imports this
 * dispatcher — mirrors the emitCmdAck/unsPublisher pattern). Belt-and-braces: any
 * unexpected throw maps to 'UNKNOWN' (never a fabricated 'BLOCKED' trip); since doc 81
 * Đợt 1B Task 6 the gate treats UNKNOWN as "not OK" and refuses the write (fail-closed).
 * doc 81 Đợt 1C Task 1 — reads with `{ forRealActuation: true }` (this gate is reachable only on
 * the real, commissioned path): a SIM / real_unmapped safety-PLC no longer yields OK (UNKNOWN,
 * basis "sim_only" ⇒ SAFETY_SIM_ONLY) and a bad-quality real safety tag is not "clean".
 */
/**
 * doc 81 Đợt 1C final wave 5 (final review M4) — overall bound of the OT safety preflight read (the robot
 * side already had SAFETY_PREFLIGHT_DEADLINE_MS = 5000; OT had none). Timeout ⇒ UNKNOWN ⇒ refused (fail-closed).
 */
export const OT_SAFETY_PREFLIGHT_DEADLINE_MS = 5000;

async function readSafetyStateForPreflight(
  adapterId: number,
  machineId: number | null,
): Promise<{ state: "OK" | "BLOCKED" | "UNKNOWN"; basis?: SafetyUnknownBasis }> {
  try {
    const { createAdapterFacade } = await import("./adapterFacade");
    const state = await withDeadline(
      createAdapterFacade({ adapterId, machineId }).getSafetyStatus({ forRealActuation: true }),
      OT_SAFETY_PREFLIGHT_DEADLINE_MS,
      "OT safety preflight",
    );
    return { state: state.state, basis: state.basis };
  } catch (err) {
    console.warn(
      `[Dispatch] safety preflight read failed for adapter ${adapterId} (treated as UNKNOWN ⇒ write refused):`,
      (err as Error)?.message || err,
    );
    return { state: "UNKNOWN" };
  }
}

export type DispatchStatus = CommandLog["status"]; // simulated | sent | acked | failed | timeout | rejected

export interface DispatchWrite {
  tagKey: string;
  value: unknown;
}

/** F4 HITL trigger: a human-confirmed AI write-action. */
export interface HitlTrigger {
  kind: "hitl";
  /**
   * ai_pending_actions.id of the confirmed HITL action. doc 81 Đợt 1B Task 6: REQUIRED for
   * a real (non-simulated) write — absent ⇒ PRECONDITION_FAILED — and it must be bound to
   * this exact command (see otActionBinding.ts) and is consumed once.
   */
  actionId?: string;
  /**
   * doc 81 Đợt 1B Task 6 — the tool/actor the pending action was created for; must equal
   * ai_pending_actions.tool and is part of the canonical payload hash.
   */
  tool?: string;
  /**
   * User who confirmed the HITL action (must own the pending row). doc 81 Đợt 1B Task 6:
   * OMITTED only by a transport with no interactive human (Sparkplug) — the confirmer is
   * then the owner of the bound, confirmed row, never a fabricated id (was `0`).
   */
  confirmedBy?: number;
  /** User who originally requested (proposed) the action. */
  requestedBy: number;
  /**
   * doc 81 Đợt 1B Task 6 — apply the strict binding check on EVERY path (simulated too),
   * not only on the real write. Set by the Sparkplug NCMD/DCMD receiver: an anonymous
   * MQTT command without a valid bound actionId is rejected + ledgered, regardless of
   * OT_CONTROL_ENABLED / SPARKPLUG_COMMAND_ENABLED.
   */
  requireBoundAction?: boolean;
}

/**
 * doc 81 Đợt 1B Task 6 — ledger value for `confirmedBy` when NOBODY confirmed the command
 * (a rejected Sparkplug command without a bound action). command_log.confirmedBy is NOT
 * NULL; a negative id cannot collide with a real user and cannot read as "user 0 confirmed".
 */
export const NO_CONFIRMER = -1;

/** F5b interlock trigger: a deterministic, human-approved interlock rule. */
export interface InterlockTrigger {
  kind: "interlock";
  /** interlock_rules.id whose deterministic condition fired. */
  ruleId: number;
  /** interlock_events.id recorded for this firing (must belong to ruleId). */
  eventId: number;
  /** User who APPROVED the rule (must match interlock_rules.approvedBy). */
  approvedBy: number;
}

export type DispatchTrigger = HitlTrigger | InterlockTrigger;

export interface DispatchInput {
  adapterId: number;
  machineId?: number | null;
  commandType: string;
  writes: DispatchWrite[];
  /** What authorized this command — sets the gate path AND commandLog provenance. */
  triggeredBy: DispatchTrigger;
  lang?: "vi" | "en" | "zh";
  /** Unique key → at most one effective dispatch. */
  idempotencyKey: string;
  /**
   * doc 33 I2 (F5): optional policy-as-code CONTEXT for the SEC_PLATFORM governance gate —
   * `{ zone, product, line, approved, role, fat_passed, … }`. doc 48 R1 (T3): the evaluated
   * action is ALWAYS `ot.command.<commandType>` (namespaced so POLICY_DEFAULT_DENY_ACTIONS
   * =ot.command.* actually gates this write path); any `action` supplied here is IGNORED for
   * the OT write. `approved` satisfies a require_approval policy (four-eyes). Absent + no
   * matching policy → allow. See server/services/security/policyGate.ts + contracts/policies/.
   */
  policyContext?: { approved?: boolean } & Record<string, unknown>;
  /**
   * G1.7 — optional cross-layer correlation id (order → work-order → command → ack).
   * Absent → the ambient AsyncLocalStorage correlation context is used (if any),
   * else NULL. Persisted on EVERY commandLog row (all branches) + echoed in cmd_ack.
   */
  correlationId?: string;
  /**
   * G1.7 — optional per-command ack deadline in ms. When provided (finite, > 0) it
   * is used INSTEAD of the global OT_CONTROL_TIMEOUT_MS for this command (capped by
   * OT_CONTROL_TIMEOUT_MAX_MS when configured); an unacked write past the deadline
   * → status 'timeout' (the existing flow). Absent → behaviour unchanged.
   */
  deadlineMs?: number;
}

/** G1.7 — the (correlationId, deadlineMs) pair persisted on every ledger row. */
function commandContext(input: DispatchInput): { correlationId: string | null; deadlineMs: number | null } {
  const explicit =
    typeof input.correlationId === "string" && input.correlationId.trim() ? input.correlationId.trim() : null;
  const deadlineMs =
    typeof input.deadlineMs === "number" && Number.isFinite(input.deadlineMs) && input.deadlineMs > 0
      ? Math.trunc(input.deadlineMs)
      : null;
  return { correlationId: explicit ?? getCorrelationId() ?? null, deadlineMs };
}

/**
 * G1.7 — the timeout used for THIS command's write (and read-back) race:
 *   • deadlineMs absent/invalid → the global env timeout (OT_CONTROL_TIMEOUT_MS,
 *     default 5000ms) — byte-for-byte the prior behaviour.
 *   • deadlineMs provided → min(deadlineMs, OT_CONTROL_TIMEOUT_MAX_MS) when the
 *     max is configured, else deadlineMs as-is.
 */
function effectiveTimeoutMs(deadlineMs?: number): number {
  const envDefault = Number(process.env.OT_CONTROL_TIMEOUT_MS ?? 5000) || 5000;
  if (typeof deadlineMs !== "number" || !Number.isFinite(deadlineMs) || deadlineMs <= 0) return envDefault;
  const maxRaw = Number(process.env.OT_CONTROL_TIMEOUT_MAX_MS);
  const max = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : null;
  return max != null ? Math.min(Math.trunc(deadlineMs), max) : Math.trunc(deadlineMs);
}

// ─── G1.9 (doc 44 W2-A3) — per-adapter command serialization (spec §13.2) ──────
//
// "Lệnh tới cùng asset xử lý tuần tự (hoặc theo hàng đợi có khóa) để tránh tranh
// chấp." Khi OT_CMD_SERIALIZE_ENABLED === "true" (default OFF) các REAL-WRITE tới
// CÙNG adapterId được tuần tự hóa bằng một hàng đợi in-process per adapter (một
// lệnh đang bay + danh sách lệnh chờ; Đợt 1E thay chuỗi tail-promise). Hàng đợi BOUNDED: khi depth (kể cả lệnh đang chạy)
// đã ≥ OT_CMD_QUEUE_MAX (default 10) → lệnh mới bị REJECT NGAY reason 'BUSY'
// (spec §13.3 — không chờ, không âm thầm treo).
//
// PHẠM VI: chỉ bọc quanh đoạn write+verify của NHÁNH THỰC THI THẬT — mọi gate
// (authorization / idempotency / allowlist / mode / commissioning / policy /
// interlock) chạy TRƯỚC và KHÔNG đổi; các nhánh simulated/rejected đã return
// trước điểm khóa. Flag OFF → thực thi ngay như trước (byte-for-byte).

/** G1.9 — cờ tuần tự hóa lệnh per-adapter, đọc tại call time (default OFF). */
export function isCmdSerializeEnabled(): boolean {
  return process.env.OT_CMD_SERIALIZE_ENABLED === "true";
}

/** Độ sâu hàng đợi tối đa per adapter (env OT_CMD_QUEUE_MAX, default 10). */
function cmdQueueMax(): number {
  const n = parseInt(String(process.env.OT_CMD_QUEUE_MAX ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

// doc 81 Đợt 1E Task 1 (ruling R-1E-a, chủ dự án 2026-10-02 "DỪNG ghim chen hàng đợi: Có") — hàng đợi TƯỜNG
// MINH (một lệnh đang bay + mảng lệnh chờ) thay cho chuỗi tail-promise, để một lệnh DỪNG GHIM (`pinnedStop`
// của Đợt 1D) có thể:
//   • KHÔNG BAO GIỜ bị BUSY (giới hạn OT_CMD_QUEUE_MAX chỉ áp cho lệnh không ưu tiên);
//   • chạy NGAY SAU lệnh đang bay (lệnh đang bay KHÔNG bị ngắt — byte đã lên dây thì không rút lại được);
//   • HUỶ mọi lệnh KHÔNG phải DỪNG ghim còn đang CHỜ trước nó (chạy chúng sau DỪNG có thể cấp năng lượng lại cho
//     máy) — người gọi của lệnh bị huỷ nhận `Superseded` (không treo, không ném), ghi sổ SUPERSEDED_BY_STOP;
//   • KHÔNG huỷ một DỪNG ghim khác đang chờ (các DỪNG chạy theo thứ tự tới) và KHÔNG đụng lệnh tới SAU nó (ý
//     định mới của người vận hành ⇒ FIFO phía sau DỪNG).
// Mọi lệnh khác (kể cả "stop" KHÔNG ghim) giữ đúng ngữ nghĩa cũ: FIFO, BUSY khi depth ≥ OT_CMD_QUEUE_MAX.

/** Kết quả của một lệnh bị huỷ khi đang CHỜ vì một DỪNG ghim xếp sau nó (R-1E-a). */
export type Superseded = {
  superseded: true;
  byStop: true;
  /** Danh tính lệnh DỪNG đã huỷ nó (do người xếp DỪNG cung cấp qua `opts.stopRef`); vắng nếu không cung cấp. */
  stop?: Record<string, unknown>;
};

/** true ⇔ `x` là kết quả `Superseded` của hàng đợi. */
export function isSuperseded(x: unknown): x is Superseded {
  return typeof x === "object" && x !== null && (x as Superseded).superseded === true && (x as Superseded).byStop === true;
}

interface PendingAdapterCommand {
  /** Bắt đầu chạy lệnh (chỉ khi không có lệnh nào đang bay). */
  run: () => void;
  /** Huỷ lệnh đang CHỜ: người gọi nhận `Superseded` (mang danh tính DỪNG `byStop`); `fn` không bao giờ được gọi. */
  cancel: (byStop?: Record<string, unknown>) => void;
  priorityStop: boolean;
}

interface AdapterCommandQueue {
  /** Có một lệnh đang thực thi (write+verify) hay không. */
  inFlight: boolean;
  /** Lệnh đang chờ, theo thứ tự sẽ chạy. */
  pending: PendingAdapterCommand[];
  /** Số lệnh trong hàng = lệnh đang bay (0/1) + lệnh đang chờ. */
  depth: number;
}

const adapterCommandQueues = new Map<number, AdapterCommandQueue>();

/** Chỉ dùng trong test — xóa mọi hàng đợi lệnh per-adapter. */
export function _resetAdapterCommandQueuesForTests(): void {
  adapterCommandQueues.clear();
}

/** Chỉ dùng trong test — số adapter đang có entry hàng đợi (0 ⇔ mọi hàng đã được dọn). */
export function _adapterCommandQueueCountForTests(): number {
  return adapterCommandQueues.size;
}

/** Chỉ dùng trong test — độ sâu hiện tại của hàng đợi một adapter (0 khi không có entry). */
export function _adapterCommandQueueDepthForTests(adapterId: number): number {
  return adapterCommandQueues.get(adapterId)?.depth ?? 0;
}

export type EnqueueOutcome<T> =
  | { accepted: true; result: Promise<T | Superseded> }
  | { accepted: false; depth: number; max: number };

/** Chạy lệnh chờ kế tiếp nếu không có lệnh nào đang bay; hàng cạn ⇒ xoá entry khỏi map. */
function pumpAdapterQueue(adapterId: number, queue: AdapterCommandQueue): void {
  if (queue.inFlight) return;
  const next = queue.pending.shift();
  if (next) {
    next.run();
    return;
  }
  if (queue.depth === 0 && adapterCommandQueues.get(adapterId) === queue) {
    adapterCommandQueues.delete(adapterId);
  }
}

/**
 * Xếp `fn` vào hàng đợi tuần tự của adapter. Lệnh thường: trả {accepted:false} NGAY (không side-effect) khi hàng
 * đã đầy; `fn` chỉ chạy sau khi mọi lệnh xếp trước nó đã kết thúc (kể cả khi lệnh trước lỗi). Lệnh
 * `priorityStop` (DỪNG ghim, R-1E-a): không bao giờ bị từ chối; huỷ mọi lệnh không-ưu-tiên đang CHỜ (chúng trả
 * `Superseded`), rồi đứng sau DỪNG ghim cuối cùng đang chờ (hoặc đầu hàng). Entry của adapter được dọn khỏi map
 * khi hàng cạn (không rò rỉ theo số adapter đã từng dùng).
 */
export function tryEnqueueAdapterCommand<T>(
  adapterId: number,
  fn: () => Promise<T>,
  opts?: { priorityStop?: boolean; stopRef?: Record<string, unknown> },
): EnqueueOutcome<T> {
  const max = cmdQueueMax();
  const priorityStop = opts?.priorityStop === true;
  let q = adapterCommandQueues.get(adapterId);
  if (!priorityStop && q && q.depth >= max) return { accepted: false, depth: q.depth, max };
  if (!q) {
    q = { inFlight: false, pending: [], depth: 0 };
    adapterCommandQueues.set(adapterId, q);
  }
  const queue = q;

  let settle!: { resolve: (v: T | Superseded) => void; reject: (e: unknown) => void };
  const result = new Promise<T | Superseded>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const job: PendingAdapterCommand = {
    priorityStop,
    run: () => {
      queue.inFlight = true;
      let p: Promise<T>;
      try {
        p = Promise.resolve(fn());
      } catch (err) {
        p = Promise.reject(err);
      }
      // Lệnh đang bay kết thúc (thành công HAY lỗi) ⇒ nhả hàng, chạy lệnh kế, rồi trả kết quả cho người gọi.
      const done = (): void => {
        queue.inFlight = false;
        queue.depth -= 1;
        pumpAdapterQueue(adapterId, queue);
      };
      p.then(
        (v) => {
          done();
          settle.resolve(v);
        },
        (err) => {
          done();
          settle.reject(err);
        },
      );
    },
    cancel: (byStop) => {
      queue.depth -= 1;
      settle.resolve(byStop ? { superseded: true, byStop: true, stop: byStop } : { superseded: true, byStop: true });
    },
  };

  if (priorityStop) {
    // R-1E-a — huỷ mọi lệnh KHÔNG phải DỪNG ghim còn đang CHỜ (lệnh đang bay không nằm trong `pending`).
    // R-1E-b (review M-1) — CỐ Ý gồm cả một lệnh "stop" KHÔNG ghim đang chờ (commandType stop/e_stop nhưng giá trị
    // không khớp ghim ⇒ priorityStop false): DỪNG ghim thay thế nó, chiều năng lượng không đổi (vẫn là dừng, bằng
    // ĐÚNG giá trị đã ghim), còn giữ nó lại thì sau DỪNG ghim sẽ ghi một giá trị chưa được chứng minh là an toàn.
    // Lệnh bị huỷ nhận SUPERSEDED_BY_STOP như mọi lệnh khác (test pinnedStop.dot1d "1E M-1").
    const kept: PendingAdapterCommand[] = [];
    for (const j of queue.pending) {
      if (j.priorityStop) kept.push(j);
      else j.cancel(opts?.stopRef);
    }
    queue.pending = kept;
    // Đứng sau DỪNG ghim cuối cùng đang chờ (DỪNG chạy theo thứ tự tới), hoặc đầu hàng.
    let at = 0;
    for (let i = 0; i < queue.pending.length; i++) if (queue.pending[i].priorityStop) at = i + 1;
    queue.pending.splice(at, 0, job);
  } else {
    queue.pending.push(job);
  }
  queue.depth += 1;
  pumpAdapterQueue(adapterId, queue);
  return { accepted: true, result };
}

/** Resolve the (requestedBy, confirmedBy) pair recorded on commandLog rows. */
function actors(input: DispatchInput): { requestedBy: number; confirmedBy: number; actionId: string | null } {
  if (input.triggeredBy.kind === "hitl") {
    return {
      requestedBy: input.triggeredBy.requestedBy,
      confirmedBy: input.triggeredBy.confirmedBy ?? NO_CONFIRMER,
      actionId: input.triggeredBy.actionId ?? null,
    };
  }
  // interlock: the approver of the rule owns responsibility (requested=confirmed).
  return { requestedBy: input.triggeredBy.approvedBy, confirmedBy: input.triggeredBy.approvedBy, actionId: null };
}

/** commandLog provenance columns for the F5b interlock path (null for HITL). */
function triggerCols(input: DispatchInput): {
  triggerKind: "hitl" | "interlock";
  interlockRuleId: number | null;
  interlockEventId: number | null;
  approvedBy: number | null;
} {
  if (input.triggeredBy.kind === "interlock") {
    return {
      triggerKind: "interlock",
      interlockRuleId: input.triggeredBy.ruleId,
      interlockEventId: input.triggeredBy.eventId,
      approvedBy: input.triggeredBy.approvedBy,
    };
  }
  return { triggerKind: "hitl", interlockRuleId: null, interlockEventId: null, approvedBy: null };
}

export interface DispatchPerWrite {
  tagKey: string;
  address?: string;
  ok: boolean;
  status: DispatchStatus;
  error?: string;
}

export interface DispatchResult {
  ok: boolean;
  simulated: boolean;
  status: DispatchStatus;
  reason?: string;
  results: DispatchPerWrite[];
  commandLogIds: number[];
  /**
   * doc 81 Đợt 1C final wave 4 (R-1C-g) — machine-readable, localisable refusal (existing appError code +
   * `errors.reason.*` key) when the refusal needs words beyond `reason`. Today: a stop/e_stop refused by the
   * safety preflight; doc 81 Đợt 1E (I-1): a waiting command cancelled by a pinned STOP
   * (`OT_COMMAND_SUPERSEDED_BY_STOP`, params { stopKey }). Absent everywhere else (byte-identical).
   */
  appError?: { appCode: AppErrorCode; appParams: AppErrorParams };
  /** Plain-English sentence for API callers/logs, paired with `appError`. */
  message?: string;
  /**
   * doc 81 Đợt 1D Task 2 — set ONLY for a stop-typed HITL command that reached the real-write gates: true ⇔ it
   * wrote exactly pinned stop values and was exempted from the safety preflight (see classifyOtStop). Absent for
   * every other command (byte-identical).
   */
  pinnedStop?: boolean;
}

/**
 * doc 81 Đợt 1C final wave 4 (ruling R-1C-g, final review I1) — an OT command whose TYPE is a stop. The name
 * alone NEVER exempts it from the safety preflight (an OT "stop" is caller-chosen tag writes). doc 81 Đợt 1D
 * Task 2: the exemption is decided by DATA — classifyOtStop — and only for a stop that writes exactly the
 * pinned (tagKey, value) pairs of the target adapter; the name only selects which commands are looked at.
 */
export function isStopCommandType(commandType: string): boolean {
  const t = String(commandType ?? "").trim().toLowerCase();
  return t === "stop" || t === "e_stop";
}

/** Why a stop-typed command was NOT treated as a pinned stop (match reasons + the pin read failing). */
export type StopPinRefusalReason =
  | Extract<MatchPinnedStopResult, { ok: false }>["reason"]
  | "pin_load_failed"
  /** fix round 1 (R-1D-h) — the pin no longer fits the tag row step 3 resolved (re-pinned / redefined in between). */
  | "pin_tag_changed"
  /**
   * final wave 1 (R-1D-k) — the RUNNING driver connection was made for a different device than the current adapter
   * row (adapter re-pointed without a reconnect), or that could not be confirmed.
   */
  | "adapter_connection_stale";

export type OtStopClassification =
  | { isStop: false; pinnedStop: false }
  | { isStop: true; pinnedStop: true; writes: StopPin[] }
  | { isStop: true; pinnedStop: false; stopPinReason: StopPinRefusalReason };

/**
 * doc 81 Đợt 1D Task 2 — PURE. Is this command a PINNED stop?
 *   • not stop-typed ⇒ `isStop: false` (pins are not consulted — R-1C-g: the name selects, data decides);
 *   • `pins === null` (the pin read failed) ⇒ NOT pinned (`pin_load_failed`): the pins ARE the safety data, so a
 *     read error never becomes an exemption (fail-closed; overrides the robot R-1C-h DB-outage rule here);
 *   • otherwise `matchPinnedStop` decides: every write must be a pinned tag with its pinned value, no duplicates.
 *     On a match the returned `writes` are the PINNED values (canonical, e.g. caller `1` ⇒ pin `true`) — the
 *     dispatcher sends these, never the caller's values.
 */
export function classifyOtStop(commandType: string, writes: DispatchWrite[], pins: StopPin[] | null): OtStopClassification {
  if (!isStopCommandType(commandType)) return { isStop: false, pinnedStop: false };
  if (pins === null) return { isStop: true, pinnedStop: false, stopPinReason: "pin_load_failed" };
  const m = matchPinnedStop(pins, writes);
  if (!m.ok) return { isStop: true, pinnedStop: false, stopPinReason: m.reason };
  return { isStop: true, pinnedStop: true, writes: m.writes };
}

/** Plain-English "why this stop was not a pinned stop" (API callers / ledger; no codes, no env vars). */
const STOP_PIN_REASON_TEXT: Record<StopPinRefusalReason, string> = {
  no_pins: "no stop tag is pinned for this machine",
  empty_writes: "the stop carried no tag writes",
  unpinned_tag: "the stop writes a tag that is not a pinned stop tag",
  value_mismatch: "the stop writes a value that differs from the pinned stop value",
  duplicate_tag: "the stop writes the same tag more than once",
  pin_load_failed: "the pinned stop tags could not be read",
  pin_tag_changed: "the pinned stop tag changed while the stop was being checked",
  adapter_connection_stale: "the running connection was made for a different device than the adapter's current settings (not reconnected since the adapter was changed)",
};

/**
 * doc 81 Đợt 1D final wave 1 (Ruling R-1D-k, final review I1) — does the RUNNING connection of `adapterId` talk to
 * the device the CURRENT adapter row names? Editing an adapter clears its pins (R-1D-a) but does not reconnect its
 * driver, so a pin chosen for the NEW device would otherwise be written through the OLD connection, exempt from the
 * safety preflight. The row is re-read HERE (after the step-3 tag rows): a pin visible in step 3 that was set after
 * a re-point implies the re-point committed before this read (the re-point clears pins in the same tx), so this read
 * sees the new target. true ⇔ both fingerprints (adapterTarget.ts — the same definition the R-1D-a clear uses) are
 * known and equal. Any error / missing value ⇒ false (no exemption, fail-closed).
 */
async function runningConnectionMatchesAdapterRow(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, adapterId: number): Promise<boolean> {
  try {
    const running = getActiveConnectionFingerprint(adapterId);
    if (!running) return false;
    const [row] = await db.select().from(deviceAdapters).where(eq(deviceAdapters.id, adapterId)).limit(1);
    if (!row) return false;
    return (
      adapterTargetFingerprint({
        protocol: row.protocol,
        endpoint: row.endpoint,
        machineId: row.machineId ?? null,
        connectionOptions: row.connectionOptions ?? null,
      }) === running
    );
  } catch (err) {
    console.warn(
      `[Dispatch] pinned-stop connection check failed for adapter ${adapterId} — stop NOT exempted from the safety preflight:`,
      (err as Error)?.message || err,
    );
    return false;
  }
}

/**
 * doc 81 Đợt 1D Task 2 fix round 1 (Ruling R-1D-h) — PURE. The SECOND layer of the pinned-stop exemption: map the
 * tag rows step 3 resolved (address/dataType the driver will actually use, enabled + writable at that read) onto
 * the matched pin values. The pins are read in a SEPARATE query, so a clear/re-pin/redefinition in between could
 * pair a pin validated against a NEW dataType with the OLD address/dataType. Every resolved row must:
 *   • have a matched pin (else `unpinned_tag` — cannot happen while matchPinnedStop is intact; this layer does not
 *     trust it), and
 *   • accept the pin value under ITS OWN dataType (`validateStopValue`, the same rule that admitted the pin), with
 *     the value unchanged by that validation (else `pin_tag_changed`).
 * `ok` ⇒ the canonical writes, in resolved (= caller) order. Anything else ⇒ no exemption (full preflight).
 */
export function canonicalisePinnedStop(
  resolved: ReadonlyArray<{ write: DispatchWrite; dataType?: string }>,
  pinnedWrites: ReadonlyArray<StopPin>,
): { ok: true; writes: DispatchWrite[] } | { ok: false; reason: "unpinned_tag" | "pin_tag_changed" } {
  const byTag = new Map(pinnedWrites.map((w) => [w.tagKey, w] as const));
  const writes: DispatchWrite[] = [];
  for (const r of resolved) {
    const pin = byTag.get(r.write.tagKey);
    if (!pin) return { ok: false, reason: "unpinned_tag" };
    const v = validateStopValue(String(r.dataType ?? ""), pin.value);
    if (!v.ok || v.value !== pin.value) return { ok: false, reason: "pin_tag_changed" };
    writes.push({ tagKey: pin.tagKey, value: pin.value });
  }
  return { ok: true, writes };
}

/**
 * doc 81 Đợt 1D final wave 3 (M1) — refusal LABEL for a stop none of whose written tags is pinned: `no_pins` when the
 * adapter has no pinned stop tag at all, else the reason the adapter-wide pins give (normally `unpinned_tag`). Read
 * error ⇒ `pin_load_failed`. Never grants the exemption: a pin that appears only in this later read (a re-pin after
 * step 3) is labelled `pin_tag_changed`.
 */
async function labelUnpinnedStop(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, input: DispatchInput): Promise<StopPinRefusalReason> {
  let pins: StopPin[];
  try {
    pins = await loadStopPins(db, input.adapterId);
  } catch (err) {
    console.warn(
      `[Dispatch] pinned-stop read failed for adapter ${input.adapterId} — stop NOT exempted from the safety preflight:`,
      (err as Error)?.message || err,
    );
    return "pin_load_failed";
  }
  const cls = classifyOtStop(input.commandType, input.writes, pins);
  if (!cls.isStop) return "no_pins";
  return cls.pinnedStop ? "pin_tag_changed" : cls.stopPinReason;
}

/** R-1C-g — existing code OPERATION_FAILED + a NEW reason key (vi/en/zh), not a new enum value. */
export const SOFTWARE_STOP_REFUSED_APP_ERROR = {
  appCode: "OPERATION_FAILED",
  appParams: { operation: "softwareStop", reason: "softwareStopRefusedUseHardwareEstop" },
} as const satisfies { appCode: AppErrorCode; appParams: AppErrorParams };

/** The refusal code stays in `reason` / the ledger reason column; the sentence itself names no code or env var. */
function softwareStopRefusedMessage(_code: string, stopPinReason?: StopPinRefusalReason): string {
  const base = "The software stop was REFUSED by the safety check: the platform could not confirm the safety PLC (unreadable, simulation only, or tripped), so it did NOT send this stop. Use the hardware E-STOP on the machine now.";
  return stopPinReason ? `${base} It was not a pinned stop: ${STOP_PIN_REASON_TEXT[stopPinReason]}.` : base;
}

/** The stop pin reason of a stop-typed command, when it was classified and is not pinned. */
function stopPinReasonOf(cls: OtStopClassification | undefined): StopPinRefusalReason | undefined {
  return cls && cls.isStop && !cls.pinnedStop ? cls.stopPinReason : undefined;
}

/**
 * The stop-typed refusal extras (appError + message + pinnedStop), or nothing for any other command.
 * doc 81 Đợt 1D Task 2: `appParams.stopPinReason` + `pinnedStop: false` say WHY the stop was not exempt.
 */
function stopRefusalExtras(
  input: DispatchInput,
  code: string,
  cls?: OtStopClassification,
): { appError?: DispatchResult["appError"]; message?: string; pinnedStop?: boolean } {
  if (!isStopCommandType(input.commandType)) return {};
  const why = stopPinReasonOf(cls);
  return {
    appError: {
      appCode: SOFTWARE_STOP_REFUSED_APP_ERROR.appCode,
      appParams: { ...SOFTWARE_STOP_REFUSED_APP_ERROR.appParams, ...(why ? { stopPinReason: why } : {}) },
    },
    message: softwareStopRefusedMessage(code, why),
    ...(cls?.isStop ? { pinnedStop: false } : {}),
  };
}
function withStopRefusalText(input: DispatchInput, code: string, detail: string, cls?: OtStopClassification): string {
  if (!isStopCommandType(input.commandType)) return detail;
  const why = stopPinReasonOf(cls);
  return `${softwareStopRefusedMessage(code)} — ${detail}${why ? ` [stop pin: ${why}]` : ""}`;
}
/** Ledger metadata (command_log.ackValue) of a refused stop-typed command: pinnedStop false + why. */
function stopRefusalLedgerLink(cls: OtStopClassification): LedgerLink | undefined {
  const why = stopPinReasonOf(cls);
  return why ? { ackExtra: { pinnedStop: false, stopPinReason: why } } : undefined;
}

const TERMINAL_STATUSES: ReadonlySet<DispatchStatus> = new Set([
  "simulated",
  "acked",
  "acked_verified",
  "acked_unverified",
  "failed",
  "timeout",
  "rejected",
]);

/** G1.6 — flag for the UNS cmd_ack publish (default OFF ⇒ dispatch is unchanged). */
function unsCmdAckEnabled(): boolean {
  return process.env.UNS_CMD_ACK_ENABLED === "true";
}

/**
 * G1.6 — publish the terminal cmd_ack to the UNS, FIRE-AND-FORGET. Payload per
 * LDS-L1 §8.5: { command_id, correlation_id, status, reason, ts, result? }.
 * `command_id` = the caller's idempotencyKey (the identity the caller knows).
 * Dynamic import (no static cycle: unsPublisher imports this module). Any error
 * is logged + counted inside the publisher — it can NEVER affect the dispatch.
 */
function emitCmdAck(input: DispatchInput, result: DispatchResult): void {
  if (!unsCmdAckEnabled()) return;
  const ack = {
    command_id: input.idempotencyKey,
    correlation_id: commandContext(input).correlationId,
    status: result.status,
    reason: result.reason ?? null,
    ts: new Date().toISOString(),
    result: result.results,
  };
  void (async () => {
    try {
      const { publishCmdAck } = await import("../unsPublisher");
      publishCmdAck(ack, { adapterId: input.adapterId, machineId: input.machineId ?? null });
    } catch (err) {
      // Fire-and-forget: NEVER propagate into the dispatch result.
      console.error("[Dispatch] cmd_ack publish failed (ignored):", (err as Error)?.message || err);
    }
  })();
}

/**
 * Dispatch a machine command. In F4a this is always DRY-RUN unless
 * OT_CONTROL_ENABLED === "true" (reserved for F4b). Returns a structured result
 * and records commandLog rows on every branch. Never throws for the expected
 * failure modes (offline / not writable / not confirmed).
 *
 * G1.6: this exported wrapper publishes the terminal cmd_ack (fire-and-forget,
 * flag UNS_CMD_ACK_ENABLED) AFTER the core dispatch resolved — every terminal
 * branch (including an idempotent cached replay) emits exactly one ack per call.
 * It adds NO gate and changes NO result: dispatchCore is the entire safety path.
 */
export async function dispatch(input: DispatchInput): Promise<DispatchResult> {
  const result = await dispatchCore(input);
  emitCmdAck(input, result);
  return result;
}

async function dispatchCore(input: DispatchInput): Promise<DispatchResult> {
  const db = await getDb();
  if (!db) {
    return { ok: false, simulated: false, status: "failed", reason: "DB_UNAVAILABLE", results: [], commandLogIds: [] };
  }

  // ── (1) Authorization gate — branch on the trigger source. ───────────────────
  if (input.triggeredBy.kind === "hitl") {
    const t = input.triggeredBy;
    if (t.requireBoundAction) {
      // doc 81 Đợt 1B Task 6 — Sparkplug NCMD/DCMD: strict binding on EVERY path (the
      // anonymous-MQTT S1 path is closed here in code, whatever the flags say). Read-only
      // here; the real-write path re-verifies under FOR UPDATE and consumes the row.
      if (!t.actionId) {
        const ids = await writeRejected(db, input, "PRECONDITION_FAILED", "command requires a bound, confirmed HITL actionId (none supplied)");
        return { ok: false, simulated: false, status: "rejected", reason: "PRECONDITION_FAILED", results: failedResults(input, "PRECONDITION_FAILED"), commandLogIds: ids };
      }
      const [pending] = await db.select().from(aiPendingActions).where(eq(aiPendingActions.id, t.actionId)).limit(1);
      const bound = verifyActionBinding(pending, input, t);
      if (!bound.ok) {
        const ids = await writeRejected(db, input, bound.reason, bound.detail);
        return { ok: false, simulated: false, status: "rejected", reason: bound.reason, results: failedResults(input, bound.reason), commandLogIds: ids };
      }
    } else if (input.triggeredBy.actionId) {
      // F4: defense-in-depth — the pending action must be confirmed/executed AND
      // owned by the confirming user. (Legacy check — kept byte-identical for the
      // simulated path; the real-write path adds the strict binding + consume.)
      const actionId = input.triggeredBy.actionId;
      const confirmedBy = input.triggeredBy.confirmedBy;
      const [pending] = await db
        .select()
        .from(aiPendingActions)
        .where(eq(aiPendingActions.id, actionId))
        .limit(1);

      const confirmedOk =
        !!pending &&
        (pending.status === "confirmed" || pending.status === "executed") &&
        pending.userId === confirmedBy;

      if (!confirmedOk) {
        const ids = await writeRejected(db, input, "NOT_CONFIRMED", "HITL action not confirmed or owner mismatch");
        return { ok: false, simulated: false, status: "rejected", reason: "NOT_CONFIRMED", results: failedResults(input, "NOT_CONFIRMED"), commandLogIds: ids };
      }
    }
  } else {
    // F5b: deterministic interlock rule must be authorized (verifyInterlockAuthorization).
    const auth = await verifyInterlockAuthorization(db, input, input.triggeredBy);
    if (!auth.ok) {
      const ids = await writeRejected(db, input, auth.reason, auth.detail);
      return { ok: false, simulated: false, status: "rejected", reason: auth.reason, results: failedResults(input, auth.reason), commandLogIds: ids };
    }
  }

  // ── (2) Idempotency: a prior terminal command for this key → return cached. ──
  // commandLog rows store a per-write key; probe the deterministic first one
  // (index 0, first tagKey) so a repeat dispatch with the same base key matches.
  const probeKey = perWriteKey(input.idempotencyKey, input.writes[0]?.tagKey ?? "_", 0);
  const [existing] = await db
    .select()
    .from(commandLog)
    .where(eq(commandLog.idempotencyKey, probeKey))
    .limit(1);
  if (existing && TERMINAL_STATUSES.has(existing.status)) {
    return cachedResult(input, existing);
  }

  // ── (3) Resolve adapter + tags; assert enabled + writable. ───────────────────
  const [adapter] = await db.select().from(deviceAdapters).where(eq(deviceAdapters.id, input.adapterId)).limit(1);
  if (!adapter || !adapter.isEnabled) {
    const ids = await writeRejected(db, input, "ADAPTER_DISABLED", "Adapter not found or disabled");
    return { ok: false, simulated: false, status: "rejected", reason: "ADAPTER_DISABLED", results: failedResults(input, "ADAPTER_DISABLED"), commandLogIds: ids };
  }

  const resolved: Array<{
    write: DispatchWrite;
    address: string;
    dataType?: string;
    scale?: number;
    offset?: number;
  }> = [];
  /**
   * final wave 3 (M1) — the step-3 tag rows as read (they carry `stopValue`): the pinned-stop decision (5a-stop) uses
   * THIS snapshot, so the pins it checks and the rows the driver writes with come from one read.
   */
  const step3TagRows: StopPinTagRow[] = [];
  for (const w of input.writes) {
    const [tag] = await db
      .select()
      .from(deviceTags)
      .where(and(eq(deviceTags.adapterId, input.adapterId), eq(deviceTags.tagKey, w.tagKey)))
      .limit(1);

    if (!tag || !tag.isEnabled) {
      const ids = await writeRejected(db, input, "TAG_NOT_FOUND", `Tag "${w.tagKey}" not found or disabled`, w.tagKey);
      return { ok: false, simulated: false, status: "rejected", reason: "TAG_NOT_FOUND", results: failedResults(input, "TAG_NOT_FOUND"), commandLogIds: ids };
    }
    if (tag.writable !== true) {
      // Tag not writable → reject WITHOUT sending anything.
      const ids = await writeRejected(db, input, "TAG_NOT_WRITABLE", `Tag "${w.tagKey}" is not writable`, w.tagKey, tag.address);
      return { ok: false, simulated: false, status: "rejected", reason: "TAG_NOT_WRITABLE", results: failedResults(input, "TAG_NOT_WRITABLE"), commandLogIds: ids };
    }
    step3TagRows.push({ tagKey: tag.tagKey, dataType: tag.dataType, stopValue: tag.stopValue, writable: tag.writable, isEnabled: tag.isEnabled });
    resolved.push({
      write: w,
      address: tag.address,
      dataType: tag.dataType ?? undefined,
      // scale/offset là decimal → string trong DB; ép sang number cho driver.
      scale: tag.scale != null ? Number(tag.scale) : undefined,
      offset: tag.offset != null ? Number(tag.offset) : undefined,
    });
  }

  // ── (4) Resolve a connected driver. ─────────────────────────────────────────
  const driver = getActiveDriver(input.adapterId);
  if (!driver) {
    const ids = await writeFailed(db, input, "ADAPTER_OFFLINE", "No connected driver for adapter");
    return { ok: false, simulated: false, status: "failed", reason: "ADAPTER_OFFLINE", results: failedResults(input, "ADAPTER_OFFLINE", "failed"), commandLogIds: ids };
  }

  // ── (5) MODE GATE. F4a default → DRY-RUN: do NOT call driver.writeTags. ───────
  const who = actors(input);
  const trig = triggerCols(input);
  if (!isOtControlEnabled()) {
    return writeSimulated(db, input, resolved, who, trig);
  }

  // ── (5a) C2 COMMISSIONING / FAT GATE (doc 24 Wave-1) — a STRICTER precondition
  //         layered ON TOP of the mode gate. Reachable ONLY when control is enabled
  //         (else step 5 already returned). When OT_COMMISSIONING_REQUIRED is on
  //         (DEFAULT) and the target adapter is NOT commissioned (no active,
  //         non-expired, signed commissioning record), FORCE the SAME 'simulated'
  //         path — driver.writeTags is NEVER called. This can only ever DOWNGRADE a
  //         would-be real write to simulated; it never enables a write, so it cannot
  //         weaken any gate above. PRECEDENCE: not-commissioned ⇒ simulated even
  //         though OT_CONTROL_ENABLED==="true".
  if (isCommissioningRequired() && !(await isCommissioned(input.adapterId))) {
    return writeSimulated(
      db, input, resolved, who, trig,
      "not_commissioned",
      "adapter has no active, non-expired, signed commissioning record — real write refused (recorded simulated)",
    );
  }

  // ── (5a-stop) doc 81 Đợt 1D Task 2 — PINNED OT STOP (owner decision 2026-09-28, doc 81 §8 QĐ1). Reachable ONLY
  //         on the real, commissioned HITL path (steps 5 / 5a returned 'simulated' otherwise). A stop-typed command
  //         whose writes are EXACTLY pinned (tagKey, value) pairs of THIS adapter (device_tags.stop_value — final
  //         wave 3 (M1): taken from the step-3 tag rows, the same snapshot the write uses), sent through a running
  //         connection made for the adapter's CURRENT target (final wave 1, R-1D-k), is a proven energy-reducing command:
  //           • its writes are CANONICALISED to the pinned values (the caller's values never reach the wire);
  //           • it skips the safety-PLC preflight (BLOCKED / SIM_ONLY / UNKNOWN alike);
  //           • a policy DENY / REQUIRE_APPROVAL or an interlock block does not stop it — the verdict is recorded
  //             as an override (ledger ackValue + control_audit_log), ruling R-1D-c (mirrors robot R-1C-c/d).
  //         Every other gate is unchanged and already ran or still runs: authN/authZ (step 1), idempotency (2),
  //         adapter/tag enabled + writable (3), driver (4), mode + commissioning (5/5a), and the HITL binding +
  //         single-use consume in the write-ahead reservation — verified against the CALLER's writes (what the
  //         human confirmed), which are value-equal to the pins by construction.
  //         Not a pinned stop (or the pin read failed ⇒ NO exemption, the pins are the safety data) ⇒ today's
  //         full path; a refusal carries `stopPinReason`.
  const callerInput = input;
  let stopCls: OtStopClassification = { isStop: false, pinnedStop: false };
  if (input.triggeredBy.kind === "hitl" && isStopCommandType(input.commandType)) {
    // final wave 3 (M1) — the pins come from the step-3 tag rows (one snapshot with the write), not a separate read.
    stopCls = classifyOtStop(input.commandType, input.writes, stopPinsFromTagRows(step3TagRows));
    if (!stopCls.pinnedStop && stopCls.isStop && stopCls.stopPinReason === "no_pins") {
      // LABEL ONLY (never an exemption): none of the WRITTEN tags is pinned — say `unpinned_tag` when the adapter has
      // other pinned tags (the pre-M1 wording), `pin_load_failed` when that cannot be read.
      stopCls = { isStop: true, pinnedStop: false, stopPinReason: await labelUnpinnedStop(db, input) };
    }
    if (stopCls.pinnedStop) {
      // fix round 1 (R-1D-h) — second layer: the pins must fit the tag rows step 3 resolved (same snapshot the
      // driver writes with). Mismatch ⇒ no exemption.
      const canon = canonicalisePinnedStop(resolved, stopCls.writes);
      if (!canon.ok) {
        stopCls = { isStop: true, pinnedStop: false, stopPinReason: canon.reason };
      } else if (!(await runningConnectionMatchesAdapterRow(db, input.adapterId))) {
        // final wave 1 (R-1D-k) — the driver still talks to the device the adapter pointed at when it connected;
        // the pins were chosen for the adapter's CURRENT target ⇒ no exemption, full preflight.
        stopCls = { isStop: true, pinnedStop: false, stopPinReason: "adapter_connection_stale" };
      } else {
        input = { ...input, writes: canon.writes.map((w) => ({ ...w })) };
        resolved.forEach((r, i) => {
          r.write = { ...canon.writes[i] };
        });
      }
    }
  }
  /** Gate verdicts a pinned stop overrode (R-1D-c) — ledgered on its intent/result rows + audited after the write. */
  const stopOverrides: Record<string, Record<string, unknown>> = {};

  // ── (5a-bis) INLINE INTERLOCK GATE (doc 25 T1) — fail-closed, ĐỒNG BỘ, TRƯỚC
  //         mọi real-write cho lệnh HITL. Reachable ONLY khi OT_CONTROL_ENABLED==="true"
  //         VÀ adapter đã commissioned (bước 5/5a đã trả simulated nếu không). Đánh giá
  //         ĐỒNG BỘ các interlock rule enabled+approved có action chặn/dừng nhắm tới
  //         máy/thiết bị này (theo targetAdapterId/targetMachineId/commandTag). Nếu có
  //         rule đang vi phạm → TỪ CHỐI fail-closed (INTERLOCK_BLOCKED), driver.writeTags
  //         KHÔNG được gọi. Lỗi đánh giá → cũng fail-closed (an toàn).
  //         LƯU Ý: chỉ áp cho kind='hitl'. Lệnh kind='interlock' CHÍNH LÀ hành động
  //         interlock (đã qua verifyInterlockAuthorization) — nếu chặn nó bằng cổng này
  //         thì lệnh an toàn không bao giờ ghi được (tự khoá). Cổng KHÔNG áp cho
  //         dry-run/emulator (đường đó đã trả simulated ở bước 5, không có real-write).
  // ── (5a-policy) doc 33 I2 (F5 §5.11.2) — policy-as-code governance gate. SEC_PLATFORM
  //         default OFF → skipped (fully non-breaking). When on, a high-risk command whose
  //         policyContext matches a `deny` policy is REJECTED here; a `require_approval` policy
  //         is rejected unless a four-eyes approval is present. hitl-only (never self-locks an
  //         interlock action). Runs BEFORE the interlock gate (governance → safety).
  if (input.triggeredBy.kind === "hitl" && secPlatformEnabled()) {
    // doc 48 R1 (T3) — evaluate the PER-COMMAND action `ot.command.<verb>` (verb =
    // commandType, e.g. ot.command.tag.write) so the OT write path aligns EXACTLY with
    // the shipped deny-group + allow-policy namespace `ot.command.*` (contracts/policies/
    // allow-ot-command-engineer-fat.policy.yaml). The coarse legacy action "device_write"
    // matched NO `ot.command.*` policy, so enabling POLICY_DEFAULT_DENY_ACTIONS=ot.command.*
    // did NOT actually gate this write. The namespaced action is applied AFTER the caller
    // context so it can NEVER be overridden away from `ot.command.*` (the caller enriches
    // context — role/fat_passed/zone/… — but does not change WHICH action is governed).
    const verdict = evaluateCommandPolicy(
      { ...(input.policyContext ?? {}), action: `ot.command.${input.commandType}` },
      { enabled: true, approved: input.policyContext?.approved === true },
    );
    if (!verdict.allow) {
      const reason = verdict.effect === "deny" ? "POLICY_DENIED" : "POLICY_APPROVAL_REQUIRED";
      if (stopCls.pinnedStop) {
        // R-1D-c — a PINNED stop is never blocked by policy; the verdict is recorded and the stop is sent.
        stopOverrides.policyOverride = {
          decision: reason,
          effect: verdict.effect,
          policyRef: verdict.policyId,
          policyReason: verdict.reason,
          ruling: "R-1D-c",
          note: "pinned OT stop is never blocked by policy — sent anyway",
        };
        console.warn(`[Dispatch] policy ${reason} (${verdict.policyId ?? "no policy id"}) for a PINNED stop on adapter ${input.adapterId} — overridden (R-1D-c), stop sent`);
      } else {
        const ids = await writeRejected(db, input, reason, verdict.reason);
        return { ok: false, simulated: false, status: "rejected", reason, results: failedResults(input, reason), commandLogIds: ids };
      }
    }
  }

  // ── (5a-safety) SAFETY-PLC PREFLIGHT (doc 48 R1 · T1 · spec invariant #1: "a BLOCKED
  //         safety-PLC MUST deny actuation"). Reachable ONLY when OT_CONTROL_ENABLED==="true"
  //         AND the adapter is commissioned (steps 5 / 5a already returned 'simulated'
  //         otherwise) — i.e. immediately before a REAL device write. Reads the target
  //         adapter's READ-ONLY SafetyState via the adapter facade (driver.getSafetyStatus →
  //         else the safety-PLC status adapter); it NEVER actuates a safety function. Honest,
  //         3-way:
  //           • BLOCKED → REJECT (SAFETY_BLOCKED); driver.writeTags is NEVER called.
  //           • UNKNOWN → REJECT (SAFETY_UNKNOWN) since doc 81 Đợt 1B Task 6 (was: allow +
  //                       warn). No configured/readable safety-PLC reporting OK ⇒ no real
  //                       write; a read error also lands here (fail-closed).
  //           • OK      → proceed.
  //         Flag OT_SAFETY_PREFLIGHT_ENABLED — ON UNLESS explicitly "false" (safety should be
  //         on by default). With SAFETY_PLC_ADAPTER_ENABLED off (no source) every real HITL
  //         write is refused SAFETY_UNKNOWN — that is intended. hitl-only (mirrors the
  //         policy + interlock gates): a kind='interlock' command IS a safety de-energization
  //         (block/stop/reduce) — blocking it here would self-lock the safety response. The
  //         dry-run/simulated path never reaches here (no real write to guard).
  //         doc 81 Đợt 1C Task 1 (owner decision 2026-09-27): the reading is the REAL-actuation one —
  //         only a real safety PLC with a mapped tag that reads clean is OK; SIM / real_unmapped
  //         alone ⇒ REJECT SAFETY_SIM_ONLY; a bad-quality real safety tag ⇒ SAFETY_UNKNOWN.
  //         doc 81 Đợt 1D Task 2 — a PINNED stop (5a-stop) skips this preflight entirely (energy-reducing, proven by
  //         data); any other stop-typed command still goes through it and its refusal carries `stopPinReason`.
  if (input.triggeredBy.kind === "hitl" && isSafetyPreflightEnabled() && !stopCls.pinnedStop) {
    const { state: safety, basis: safetyBasis } = await readSafetyStateForPreflight(input.adapterId, input.machineId ?? null);
    if (safety === "BLOCKED") {
      // final wave 4 (R-1C-g) — a stop/e_stop stays gated; its refusal says to use the hardware E-STOP.
      const ids = await writeRejected(
        db,
        input,
        "SAFETY_BLOCKED",
        withStopRefusalText(input, "SAFETY_BLOCKED", "safety-PLC reports BLOCKED/tripped — actuation denied before write (read-only preflight, spec invariant #1)", stopCls),
        undefined,
        undefined,
        stopRefusalLedgerLink(stopCls),
      );
      return {
        ok: false,
        simulated: false,
        status: "rejected",
        reason: "SAFETY_BLOCKED",
        results: failedResults(input, "SAFETY_BLOCKED"),
        commandLogIds: ids,
        ...stopRefusalExtras(input, "SAFETY_BLOCKED", stopCls),
      };
    }
    if (safety !== "OK" && safetyPreflightReason(safety, safetyBasis) === "SAFETY_SIM_ONLY") {
      // doc 81 Đợt 1C Task 1 — only SIM / real_unmapped safety-PLC configs: nothing real vouches
      // for a commissioned target ⇒ refused before any ledger intent or driver call (same reason
      // on the robot side).
      const ids = await writeRejected(
        db,
        input,
        "SAFETY_SIM_ONLY",
        withStopRefusalText(input, "SAFETY_SIM_ONLY", "safety-PLC preflight: no real safety PLC with a mapped safety tag is configured (only SIM / unmapped) — a commissioned target needs a REAL safety PLC; actuation denied before write", stopCls),
        undefined,
        undefined,
        stopRefusalLedgerLink(stopCls),
      );
      return {
        ok: false,
        simulated: false,
        status: "rejected",
        reason: "SAFETY_SIM_ONLY",
        results: failedResults(input, "SAFETY_SIM_ONLY"),
        commandLogIds: ids,
        ...stopRefusalExtras(input, "SAFETY_SIM_ONLY", stopCls),
      };
    }
    if (safety !== "OK") {
      // doc 81 Đợt 1B Task 6 (BE2 §L2 :660) — UNKNOWN used to pass with a warning. Not OK is
      // not OK: no safety-PLC configured/enabled/readable ⇒ the write is refused before any
      // ledger intent or driver call (same rule as the robot dispatcher, Task 5).
      const ids = await writeRejected(
        db,
        input,
        "SAFETY_UNKNOWN",
        withStopRefusalText(input, "SAFETY_UNKNOWN", `safety-PLC preflight returned ${safety} (no configured/readable safety-PLC reports OK) — actuation denied before write`, stopCls),
        undefined,
        undefined,
        stopRefusalLedgerLink(stopCls),
      );
      return {
        ok: false,
        simulated: false,
        status: "rejected",
        reason: "SAFETY_UNKNOWN",
        results: failedResults(input, "SAFETY_UNKNOWN"),
        commandLogIds: ids,
        ...stopRefusalExtras(input, "SAFETY_UNKNOWN", stopCls),
      };
    }
  }

  if (input.triggeredBy.kind === "hitl") {
    const gate = await evaluateInterlockGate({
      adapterId: input.adapterId,
      machineId: input.machineId ?? null,
      tagKeys: input.writes.map((w) => w.tagKey),
    });
    if (gate.blocked) {
      const detail = gate.failClosed
        ? "interlock evaluation error — fail-closed (no write)"
        : `blocked by active interlock rule(s): ${gate.violations
            .map((v) => `#${v.ruleId}(${v.action})`)
            .join(", ")}`;
      if (stopCls.pinnedStop) {
        // R-1D-c — an active interlock wants the machine STOPPED; blocking a pinned stop would defeat it. An
        // evaluation error (failClosed) is overridden too: the stop is proven energy-reducing by the pins.
        stopOverrides.interlockOverride = {
          decision: "INTERLOCK_BLOCKED",
          failClosed: gate.failClosed,
          violations: gate.violations.map((v) => ({ ruleId: v.ruleId, action: v.action })),
          detail,
          ruling: "R-1D-c",
          note: "pinned OT stop is never blocked by the interlock gate — sent anyway",
        };
        console.warn(`[Dispatch] interlock gate blocked a PINNED stop on adapter ${input.adapterId} (${detail}) — overridden (R-1D-c), stop sent`);
      } else {
        const ids = await writeRejected(db, input, "INTERLOCK_BLOCKED", detail);
        return {
          ok: false,
          simulated: false,
          status: "rejected",
          reason: "INTERLOCK_BLOCKED",
          results: failedResults(input, "INTERLOCK_BLOCKED"),
          commandLogIds: ids,
        };
      }
    }
  }

  // doc 81 Đợt 1D Task 2 — ledger metadata of a pinned stop (intent + result rows' ackValue). Empty otherwise ⇒
  // every other command's rows are byte-identical.
  const ledgerExtra: Record<string, unknown> = stopCls.pinnedStop ? { pinnedStop: true, ...stopOverrides } : {};

  // ── (5b) F4b — REAL WRITE PATH. Reachable ONLY when OT_CONTROL_ENABLED==="true"
  //         AND the adapter is commissioned (C2) AND only after every F4a gate above
  //         (confirm+owner, idempotency, allowlist writable, driver active).
  //         driver.writeTags() reaches the physical device. ack (F4b) = write
  //         returned ok. NO blind retry.
  //         G2.1: when OT_READBACK_ENABLED, a SINGLE driver.readTags() verifies the
  //         acked writes (acked_verified / acked_unverified — WARN only). The
  //         per-write outcome + read-back status are computed BEFORE inserting the
  //         commandLog rows so the ledger stays append-only (insert ONCE, no update).
  // ── (5b-0) doc 81 Đợt 1B Task 6 — WRITE-AHEAD RESERVATION (advisory lock → re-probe →
  //         bind + consume the HITL action → INSERT intent rows), committed BEFORE the
  //         driver is called. Refused / failed ⇒ return; driver.writeTags is never reached.
  const reservation = await reserveRealWrite(db, input, resolved, { bindingInput: callerInput, ledgerExtra, pinnedStop: stopCls.pinnedStop });
  if (!reservation.ok) return reservation.result;
  const { intentIds } = reservation;
  const ledgerConfirmer = reservation.boundConfirmer ?? who.confirmedBy;
  const commandLogIds: number[] = [];

  // Map resolved → driver writes (carry dataType/scale/offset for INVERSE scale).
  const driverWrites = resolved.map((r) => ({
    tagKey: r.write.tagKey,
    address: r.address,
    value: r.write.value,
    dataType: r.dataType as any,
    scale: r.scale,
    offset: r.offset,
  }));

  // G1.7 — per-command deadline (when provided) replaces the global env timeout
  // for THIS command; absent → OT_CONTROL_TIMEOUT_MS (default 5000ms) as before.
  const timeoutMs = effectiveTimeoutMs(input.deadlineMs);
  const TIMEOUT = Symbol("timeout");

  // Pre-insert outcome per resolved write. `ok` is fixed by the WRITE result;
  // read-back only refines an acked write's status (verified/unverified) and
  // NEVER flips ok → false (quyết định #4).
  interface Outcome {
    idx: number;
    ok: boolean;
    status: DispatchStatus;
    errorText: string | null;
    readBackValue: unknown;
  }

  // ── G1.9 — the write+verify body, extracted UNCHANGED so it can run either
  //    immediately (flag OFF — prior behaviour) or under the per-adapter queue.
  //    It never throws for expected failure modes (driver errors are caught).
  const executeWriteAndVerify = async (): Promise<{ sentAt: Date; timedOut: boolean; outcomes: Outcome[] }> => {
    const sentAt = new Date();

    let writeResults: Awaited<ReturnType<typeof driver.writeTags>> | typeof TIMEOUT;
    let threwError: string | null = null;
    try {
      writeResults = await Promise.race([
        driver.writeTags(driverWrites),
        new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), timeoutMs)),
      ]);
    } catch (err) {
      threwError = (err as Error)?.message || String(err);
      writeResults = [];
    }

    // Decide a per-write outcome from the write result (status BEFORE read-back).
    const timedOut = writeResults === TIMEOUT;
    const resultsArr = Array.isArray(writeResults) ? writeResults : [];

    const outcomes: Outcome[] = resolved.map((r, i) => {
      if (timedOut) {
        return { idx: i, ok: false, status: "timeout", errorText: `write timeout after ${timeoutMs}ms`, readBackValue: null };
      }
      if (threwError) {
        return { idx: i, ok: false, status: "failed", errorText: threwError, readBackValue: null };
      }
      const wr =
        resultsArr.find((x) => x.tagKey === r.write.tagKey) ??
        { tagKey: r.write.tagKey, ok: false, error: "no result" };
      const ok = wr.ok === true;
      return {
        idx: i,
        ok,
        status: ok ? "acked" : "failed",
        errorText: ok ? null : (wr.error ?? "write failed"),
        readBackValue: null,
      };
    });

    // ── G2.1 READ-BACK — ONLY when control + read-back enabled AND ≥1 write acked.
    //    A SINGLE driver.readTags() (under the same timeout). readTags throwing /
    //    timing out → ALL acked writes become acked_unverified (WARN only; NO retry).
    if (isOtReadbackEnabled() && outcomes.some((o) => o.status === "acked")) {
      const ackedIdx = outcomes.filter((o) => o.status === "acked").map((o) => o.idx);
      const readTags: OtTagAddress[] = ackedIdx.map((i) => {
        const r = resolved[i];
        return {
          tagKey: r.write.tagKey,
          address: r.address,
          dataType: (r.dataType ?? "float") as OtTagAddress["dataType"],
          scale: r.scale,
          offset: r.offset,
        };
      });

      const RB_TIMEOUT = Symbol("rb_timeout");
      let samples: Awaited<ReturnType<typeof driver.readTags>> | typeof RB_TIMEOUT | null = null;
      let readbackUnavailable = false;
      try {
        samples = await Promise.race([
          driver.readTags(readTags),
          new Promise<typeof RB_TIMEOUT>((resolve) => setTimeout(() => resolve(RB_TIMEOUT), timeoutMs)),
        ]);
        if (samples === RB_TIMEOUT) readbackUnavailable = true;
      } catch {
        // readTags throwing → read-back unavailable (NOT failed, NO retry).
        readbackUnavailable = true;
      }

      const tol = readbackFloatTolerance();
      const sampleArr = Array.isArray(samples) ? samples : [];
      for (const i of ackedIdx) {
        const o = outcomes[i];
        const r = resolved[i];
        if (readbackUnavailable) {
          o.status = "acked_unverified";
          o.errorText = "readback unavailable";
          continue;
        }
        const s = sampleArr.find((x) => x.tagKey === r.write.tagKey);
        const actual = s ? s.value : null;
        const dataType = (r.dataType ?? "float") as OtTagAddress["dataType"];
        const matched = s != null && readbackMatches(r.write.value, actual, dataType, tol);
        if (matched) {
          o.status = "acked_verified";
          o.readBackValue = actual;
        } else {
          o.status = "acked_unverified";
          o.readBackValue = actual;
          o.errorText = `readback mismatch: expected=${String(r.write.value)} actual=${String(actual)}`;
        }
      }
    }

    return { sentAt, timedOut, outcomes };
  };

  // ── (5c) G1.9 — PER-ADAPTER SERIALIZATION (flag OT_CMD_SERIALIZE_ENABLED,
  //    default OFF → run immediately, prior behaviour byte-for-byte). Real-writes
  //    to the SAME adapter run one-at-a-time; a full queue (depth ≥ OT_CMD_QUEUE_MAX)
  //    rejects THIS command immediately with reason 'BUSY' (spec §13.3) — the
  //    ledger records the rejection like every other rejected branch.
  //    doc 81 Đợt 1E Task 1 (R-1E-a) — a PINNED stop (stopCls.pinnedStop, Đợt 1D: exact pin match + step-3 row +
  //    connection fingerprint) is never BUSY: it runs right after the in-flight write and cancels the non-stop
  //    commands still WAITING ahead of it; each cancelled caller ledgers SUPERSEDED_BY_STOP naming the stop.
  let executed: { sentAt: Date; timedOut: boolean; outcomes: Outcome[] };
  if (isCmdSerializeEnabled()) {
    const enq = tryEnqueueAdapterCommand(
      input.adapterId,
      executeWriteAndVerify,
      stopCls.pinnedStop === true
        ? { priorityStop: true, stopRef: { idempotencyKey: input.idempotencyKey, commandType: input.commandType, intentIds } }
        : { priorityStop: false },
    );
    if (!enq.accepted) {
      const ids = await writeRejected(
        db,
        input,
        "BUSY",
        `adapter command queue full (depth ${enq.depth} >= max ${enq.max}) — command rejected, retry later`,
        undefined,
        undefined,
        { intentIds, confirmedBy: ledgerConfirmer, ackExtra: ledgerExtra }, // Task 6 — the RESULT row of the intent
      );
      return { ok: false, simulated: false, status: "rejected", reason: "BUSY", results: failedResults(input, "BUSY"), commandLogIds: ids, ...(stopCls.pinnedStop ? { pinnedStop: true } : {}) };
    }
    const queued = await enq.result;
    if (isSuperseded(queued)) {
      // R-1E-a — cancelled while WAITING: never reached driver.writeTags. RESULT row of the intent, like BUSY.
      const stopKey = typeof queued.stop?.idempotencyKey === "string" ? queued.stop.idempotencyKey : "unknown";
      const ids = await writeRejected(
        db,
        input,
        "SUPERSEDED_BY_STOP",
        `cancelled while waiting in the adapter command queue: pinned STOP ${stopKey} was queued after it — not sent to the device, resend if still needed`,
        undefined,
        undefined,
        { intentIds, confirmedBy: ledgerConfirmer, ackExtra: { ...ledgerExtra, supersededByStop: queued.stop ?? null } },
      );
      // fix round 1 (review I-1, plan Global Constraint 3) — the operator must learn the command was DROPPED and must
      // be resent: coded appError (vi/en/zh `errors.OT_COMMAND_SUPERSEDED_BY_STOP`) + a plain sentence (no env vars).
      return {
        ok: false,
        simulated: false,
        status: "rejected",
        reason: "SUPERSEDED_BY_STOP",
        results: failedResults(input, "SUPERSEDED_BY_STOP"),
        commandLogIds: ids,
        appError: { appCode: "OT_COMMAND_SUPERSEDED_BY_STOP", appParams: { stopKey } },
        message: "This waiting command was cancelled because a STOP command was queued after it — it was not sent to the device; resend it if still needed.",
      };
    }
    executed = queued;
  } else {
    executed = await executeWriteAndVerify();
  }
  const { sentAt, timedOut, outcomes } = executed;

  // Insert one commandLog row per write (append-only — single insert per write).
  const ctx = commandContext(input); // G1.7 — correlation_id + deadline_ms
  const results: DispatchPerWrite[] = [];
  for (const o of outcomes) {
    const r = resolved[o.idx];
    const [row] = await db
      .insert(commandLog)
      .values({
        actionId: who.actionId,
        adapterId: input.adapterId,
        machineId: input.machineId ?? null,
        tagKey: r.write.tagKey,
        address: r.address,
        commandType: input.commandType,
        requestedValue: r.write.value as any,
        requestedBy: who.requestedBy,
        confirmedBy: ledgerConfirmer,
        status: o.status,
        ...trig,
        ...ctx,
        readBackValue: o.readBackValue as any,
        errorText: o.errorText,
        // Task 6 — RESULT row linked to its write-ahead intent (by id; the key pair
        // '<k>' / 'intent:<k>' links them too).
        ackValue: { ledger: "result", intentId: intentIds[o.idx], ...ledgerExtra } as any,
        idempotencyKey: perWriteKey(input.idempotencyKey, r.write.tagKey, o.idx),
        sentAt,
        ackedAt: o.ok ? new Date() : null,
      })
      .returning({ id: commandLog.id });
    commandLogIds.push(row.id);
    results.push({ tagKey: r.write.tagKey, address: r.address, ok: o.ok, status: o.status, error: o.errorText ?? undefined });
  }

  // Overall: ok is true iff every WRITE acked (verified or not). status rolls up:
  //   any failed → 'failed'; timeout → 'timeout'; all verified → 'acked_verified';
  //   else (≥1 unverified, none failed) → 'acked_unverified'; else (no read-back) 'acked'.
  const allOk = results.length > 0 && results.every((x) => x.ok);
  let overall: DispatchStatus;
  if (!allOk) {
    overall = timedOut ? "timeout" : "failed";
  } else if (outcomes.every((o) => o.status === "acked_verified")) {
    overall = "acked_verified";
  } else if (outcomes.some((o) => o.status === "acked_unverified")) {
    overall = "acked_unverified";
  } else {
    overall = "acked";
  }
  if (input.triggeredBy.kind === "interlock") await auditInterlockAutoBlock(input, commandLogIds);
  if (stopCls.pinnedStop) {
    for (const [kind, override] of Object.entries(stopOverrides)) auditPinnedStopOverride(input, commandLogIds[0], kind, override, ledgerConfirmer);
    return { ok: allOk, simulated: false, status: overall, results, commandLogIds, pinnedStop: true };
  }
  return { ok: allOk, simulated: false, status: overall, results, commandLogIds };
}

/** Upper bound after which a still-pending pinned-stop override audit is logged as stuck (never awaited by the stop). */
export const OT_STOP_OVERRIDE_AUDIT_DEADLINE_MS = 10_000;

/**
 * doc 81 Đợt 1D Task 2 (R-1D-c) — control_audit_log row "stop_policy_override" / "stop_interlock_override" for a
 * pinned stop that a gate would have refused. Written AFTER the result row, FIRE-AND-FORGET under a deadline (same
 * reason as the robot M1 fix: under SEC_PLATFORM the hash-chain lock has no timeout and must not hold the stop's
 * answer). Its failure is logged (no secrets), never surfaced as a stop failure; the ledger row already carries
 * the override.
 */
function auditPinnedStopOverride(
  input: DispatchInput,
  resultId: number | undefined,
  kind: string,
  override: Record<string, unknown>,
  /** final wave 3 (M6) — the ledger's confirmer (reservation.boundConfirmer ?? caller), same as the HITL binding. */
  confirmer: number,
): void {
  const action = kind === "policyOverride" ? "stop_policy_override" : "stop_interlock_override";
  const work = (async () => {
    const db = await getDb();
    if (!db) {
      console.error(`[Dispatch] audit ${action} skipped for command_log #${resultId ?? "?"} — no DB (the pinned stop was sent)`);
      return;
    }
    const { recordAuditEvent } = await import("../audit/controlAuditService");
    await recordAuditEvent(db, {
      entityType: "ot_command",
      entityId: resultId ?? "unrecorded",
      action,
      actorId: confirmer,
      after: { adapterId: input.adapterId, machineId: input.machineId ?? null, commandType: input.commandType, ...override },
      reason: `R-1D-c: pinned OT stop sent despite ${String(override.decision)}`,
    });
  })();
  void withDeadline(work, OT_STOP_OVERRIDE_AUDIT_DEADLINE_MS, `pinned-stop ${action} audit`).catch((err) => {
    console.error(`[Dispatch] audit ${action} failed or is stuck for command_log #${resultId ?? "?"} (the pinned stop was sent):`, (err as Error)?.message || err);
  });
}

/** The cached (idempotent replay) result of a prior terminal ledger row for this key. */
function cachedResult(input: DispatchInput, existing: CommandLog): DispatchResult {
  // fix round 1 (R-1D-h) — a replayed PINNED stop still says so (its ledger row carries ackValue.pinnedStop).
  const replayedPinnedStop = (existing.ackValue as { pinnedStop?: unknown } | null | undefined)?.pinnedStop === true;
  const cachedOk =
    existing.status === "simulated" ||
    existing.status === "acked" ||
    existing.status === "acked_verified" ||
    existing.status === "acked_unverified" ||
    existing.status === "sent";
  return {
    ok: cachedOk,
    simulated: existing.status === "simulated",
    status: existing.status,
    reason: existing.errorText ?? undefined,
    results: input.writes.map((w) => ({ tagKey: w.tagKey, address: existing.address ?? undefined, ok: cachedOk, status: existing.status, error: existing.errorText ?? undefined })),
    commandLogIds: [existing.id],
    ...(replayedPinnedStop ? { pinnedStop: true } : {}),
  };
}

// ─── doc 81 Đợt 1B Task 6 — HITL binding + write-ahead reservation ────────────

type BindingVerdict =
  | { ok: true; owner: number }
  | { ok: false; reason: "NOT_CONFIRMED" | "ACTION_BINDING_MISMATCH"; detail: string };

/**
 * PURE — is `pending` a valid authorisation for EXACTLY this command? All must hold:
 *   status === 'confirmed' (an 'executed' row is spent — the 594 AI-coding rows included),
 *   not expired, owned by the confirmer (when the trigger names one), created for the
 *   same tool, and carrying the canonical payload hash of THIS adapter/machine/command/
 *   writes (otActionBinding.otPayloadHash — the same function the creators use).
 * Used read-only at entry (requireBoundAction) and under FOR UPDATE before consuming.
 */
function verifyActionBinding(
  pending: AiPendingAction | undefined,
  input: DispatchInput,
  t: HitlTrigger,
  /** doc 81 Đợt 4 Task A5 — true ⇔ the dispatcher classified THIS command as a PINNED stop (data-verified). */
  opts: { pinnedStop?: boolean } = {},
): BindingVerdict {
  if (!pending) return { ok: false, reason: "NOT_CONFIRMED", detail: "HITL action not found" };
  if (pending.status !== "confirmed") {
    return {
      ok: false,
      reason: "NOT_CONFIRMED",
      detail: `HITL action status is '${pending.status}' — only a 'confirmed' action authorises a write, exactly once`,
    };
  }
  if (pending.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "NOT_CONFIRMED", detail: "HITL action expired" };
  }
  if (t.confirmedBy !== undefined && pending.userId !== t.confirmedBy) {
    return { ok: false, reason: "NOT_CONFIRMED", detail: "HITL action owner mismatch" };
  }
  if (!t.tool || pending.tool !== t.tool) {
    return {
      ok: false,
      reason: "ACTION_BINDING_MISMATCH",
      detail: `HITL action was created for tool '${pending.tool}', command claims '${t.tool ?? "(none)"}'`,
    };
  }
  // doc 81 Đợt 4 Task A5 (R-4-a, defence in depth) — an orchestration-engine action must be confirmed by the
  // approver of an earlier hitl_gate, never by the run owner. A PINNED stop is exempt (L-7: a stop is never blocked).
  if (opts.pinnedStop !== true) {
    const self = foeSelfApprovalRefusal(pending, t.requestedBy);
    if (self) return { ok: false, reason: "NOT_CONFIRMED", detail: self };
  }
  const stored = readOtPayloadHash(pending.previewJson);
  if (!stored) {
    return { ok: false, reason: "ACTION_BINDING_MISMATCH", detail: "HITL action carries no OT payload binding" };
  }
  const expected = otPayloadHash({
    tool: pending.tool,
    adapterId: input.adapterId,
    machineId: input.machineId ?? null,
    commandType: input.commandType,
    writes: input.writes,
  });
  if (stored !== expected) {
    return {
      ok: false,
      reason: "ACTION_BINDING_MISMATCH",
      detail: "HITL action was confirmed for a different adapter/machine/command/tag/value",
    };
  }
  return { ok: true, owner: pending.userId };
}

/** Advisory-lock namespace so OT command keys never share a lock with another subsystem. */
const OT_COMMAND_LOCK_NS = "ot.command:";

/** The intent row's key — derived deterministically from the result row's per-write key. */
function intentKeyFor(resultKey: string): string {
  // fix round 1 — prefix + short hash when too long (was a bare 128-char cut that dropped the
  // ':<idx>' suffix ⇒ all writes of a long-key command shared ONE intent key).
  return boundedKey(`intent:${resultKey}`);
}

type Reservation =
  | { ok: true; intentIds: number[]; boundConfirmer: number | null }
  | { ok: false; result: DispatchResult };

/**
 * Real-write reservation, ONE transaction, committed BEFORE the driver is called:
 *   1. pg_advisory_xact_lock(hashtext('ot.command:'||idempotencyKey)) — same-key calls
 *      serialise here (the lock-free probe in step 2 is only a fast path);
 *   2. re-probe the key: a terminal result ⇒ cached replay; an intent WITHOUT a result ⇒
 *      the key is in flight or its outcome is unknown ⇒ refuse (DUPLICATE_IN_FLIGHT);
 *   3. hitl: actionId REQUIRED (PRECONDITION_FAILED); SELECT … FOR UPDATE the pending row,
 *      verifyActionBinding, then CAS confirmed→executed (0 rows ⇒ NOT_CONFIRMED);
 *   4. INSERT one intent row per write.
 * Any throw ⇒ the tx rolls back (action NOT consumed, no intent) and NOTHING is written
 * to the device (LEDGER_INTENT_FAILED).
 */
async function reserveRealWrite(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: DispatchInput,
  resolved: Array<{ write: DispatchWrite; address: string }>,
  opts: {
    /** doc 81 Đợt 1D Task 2 — the command the HITL action is verified against (the CALLER's writes; `input` may
     *  carry the canonicalised pinned-stop writes). Absent ⇒ `input`. */
    bindingInput?: DispatchInput;
    /** Extra ackValue fields on the intent rows (pinned stop metadata). */
    ledgerExtra?: Record<string, unknown>;
    /** doc 81 Đợt 4 Task A5 — this command is a PINNED stop (stopCls.pinnedStop): exempt from the engine-self-approval refusal. */
    pinnedStop?: boolean;
  } = {},
): Promise<Reservation> {
  const resultKeys = resolved.map((r, i) => perWriteKey(input.idempotencyKey, r.write.tagKey, i));
  const intentKeys = resultKeys.map(intentKeyFor);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${OT_COMMAND_LOCK_NS + input.idempotencyKey}))`);

      const prior = await tx
        .select()
        .from(commandLog)
        .where(inArray(commandLog.idempotencyKey, [resultKeys[0], intentKeys[0]]));
      const priorResult = prior.find((r) => r.idempotencyKey === resultKeys[0]);
      if (priorResult && TERMINAL_STATUSES.has(priorResult.status)) {
        return { ok: false as const, result: cachedResult(input, priorResult) };
      }
      if (prior.length > 0) {
        // The key's intent exists but no result: another call holds it, or the process died
        // between the device write and the result row. Either way a second write is unsafe.
        // Ledgered with a NULL key (the per-write keys belong to the in-flight command).
        const intentIds = prior.map((r) => r.id);
        const ids = await writeAll(tx, input, "rejected", "DUPLICATE_IN_FLIGHT", `idempotency key already has a write-ahead intent (#${intentIds.join(",")}) without a result — not re-sent`, undefined, undefined, { nullKey: true, intentIds });
        return {
          ok: false as const,
          result: { ok: false, simulated: false, status: "rejected" as const, reason: "DUPLICATE_IN_FLIGHT", results: failedResults(input, "DUPLICATE_IN_FLIGHT"), commandLogIds: ids },
        };
      }

      let boundConfirmer: number | null = null;
      if (input.triggeredBy.kind === "hitl") {
        const t = input.triggeredBy;
        let verdict: BindingVerdict | { ok: false; reason: "PRECONDITION_FAILED"; detail: string };
        if (!t.actionId) {
          verdict = { ok: false, reason: "PRECONDITION_FAILED", detail: "real OT write requires a bound, confirmed, single-use HITL actionId (none supplied)" };
        } else {
          const [pending] = await tx
            .select()
            .from(aiPendingActions)
            .where(eq(aiPendingActions.id, t.actionId))
            .for("update");
          verdict = verifyActionBinding(pending, opts.bindingInput ?? input, t, { pinnedStop: opts.pinnedStop === true });
          // doc 81 Đợt 4 fix round 1 (R-4-i) — an orchestration-engine action: re-derive the run owner and the gate
          // approver from the DB rows (run + gate + workflow) under this transaction; previewJson only points at the run.
          // A PINNED stop is exempt (L-7).
          if (verdict.ok && pending?.tool === FOE_ENGINE_TOOL && opts.pinnedStop !== true) {
            const refusal = await foeApprovalDbRefusal(tx, pending, t.requestedBy);
            if (refusal) verdict = { ok: false, reason: "NOT_CONFIRMED", detail: refusal };
          }
          if (verdict.ok) {
            const consumed = await tx
              .update(aiPendingActions)
              .set({ status: "executed", executedAt: new Date() })
              .where(and(eq(aiPendingActions.id, t.actionId), eq(aiPendingActions.status, "confirmed")))
              .returning({ id: aiPendingActions.id });
            if (consumed.length !== 1) {
              verdict = { ok: false, reason: "NOT_CONFIRMED", detail: "HITL action was consumed concurrently" };
            }
          }
        }
        if (!verdict.ok) {
          const ids = await writeRejected(tx, input, verdict.reason, verdict.detail);
          return {
            ok: false as const,
            result: { ok: false, simulated: false, status: "rejected" as const, reason: verdict.reason, results: failedResults(input, verdict.reason), commandLogIds: ids },
          };
        }
        boundConfirmer = verdict.owner;
      }

      const who = actors(input);
      const trig = triggerCols(input);
      const ctx = commandContext(input);
      const sentAt = new Date();
      const intentIds: number[] = [];
      for (let i = 0; i < resolved.length; i++) {
        const r = resolved[i];
        const [row] = await tx
          .insert(commandLog)
          .values({
            actionId: who.actionId,
            adapterId: input.adapterId,
            machineId: input.machineId ?? null,
            tagKey: r.write.tagKey,
            address: r.address,
            commandType: input.commandType,
            requestedValue: r.write.value as any,
            requestedBy: who.requestedBy,
            confirmedBy: boundConfirmer ?? who.confirmedBy,
            status: "sent",
            ...trig,
            ...ctx,
            ackValue: { ledger: "intent", ...(opts.ledgerExtra ?? {}) } as any,
            idempotencyKey: intentKeys[i],
            sentAt,
          })
          .returning({ id: commandLog.id });
        intentIds.push(row.id);
      }
      return { ok: true as const, intentIds, boundConfirmer };
    });
  } catch (err) {
    console.error(
      `[Dispatch] write-ahead intent failed for adapter ${input.adapterId} — NOTHING sent to the device:`,
      (err as Error)?.message || err,
    );
    return {
      ok: false,
      result: {
        ok: false,
        simulated: false,
        status: "failed",
        reason: "LEDGER_INTENT_FAILED",
        results: failedResults(input, "LEDGER_INTENT_FAILED", "failed"),
        commandLogIds: [],
      },
    };
  }
}

// ─── F5b — interlock authorization (defense-in-depth, multi-layer) ────────────

/**
 * Re-verify that an 'interlock'-triggered dispatch is authorized. ALL of the
 * following must hold (any failure → reject, no write):
 *   - INTERLOCK_AUTO_BLOCK_ENABLED === "true" (master flag; default off → reject)
 *   - the rule exists AND enabled=true
 *   - rule.approvedBy IS NOT NULL AND === triggeredBy.approvedBy (anti-forgery)
 *   - rule.requiresHumanConfirm === false (this is the AUTO path, not HITL)
 *   - rule.action ∈ {block_downstream, stop_line, reduce_speed} (allowlist)
 *   - rule.targetAdapterId === input.adapterId
 *   - rule.commandTag matches the tag being written
 *   - the event exists, belongs to the rule, and is in a valid state (fired/auto_blocked)
 *
 * This runs IN ADDITION to the shared gates (tag.writable allowlist, adapter/tag
 * enabled, driver active, OT_CONTROL_ENABLED, idempotency) applied to both paths.
 */
async function verifyInterlockAuthorization(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: DispatchInput,
  trig: InterlockTrigger,
): Promise<{ ok: true } | { ok: false; reason: string; detail: string }> {
  // Master flag first — when off, the interlock path is fully closed.
  if (!isInterlockAutoBlockEnabled()) {
    return { ok: false, reason: "INTERLOCK_AUTO_BLOCK_DISABLED", detail: "INTERLOCK_AUTO_BLOCK_ENABLED is not 'true'" };
  }

  const [rule] = await db.select().from(interlockRules).where(eq(interlockRules.id, trig.ruleId)).limit(1);
  if (!rule) {
    return { ok: false, reason: "INTERLOCK_RULE_NOT_FOUND", detail: `Interlock rule #${trig.ruleId} not found` };
  }
  if (rule.enabled !== true) {
    return { ok: false, reason: "INTERLOCK_RULE_DISABLED", detail: `Interlock rule #${trig.ruleId} is not enabled` };
  }
  if (rule.approvedBy == null || rule.approvedBy !== trig.approvedBy) {
    return { ok: false, reason: "INTERLOCK_NOT_APPROVED", detail: "Rule not approved or approver mismatch" };
  }
  if (rule.requiresHumanConfirm !== false) {
    return { ok: false, reason: "INTERLOCK_REQUIRES_HUMAN_CONFIRM", detail: "Rule requires human confirm — not an auto-block path" };
  }
  if (!INTERLOCK_AUTO_ACTIONS.has(rule.action)) {
    return { ok: false, reason: "INTERLOCK_ACTION_NOT_ALLOWED", detail: `Action "${rule.action}" is not auto-block eligible` };
  }
  if (rule.targetAdapterId == null || rule.targetAdapterId !== input.adapterId) {
    return { ok: false, reason: "INTERLOCK_TARGET_MISMATCH", detail: "Rule targetAdapterId does not match dispatch adapter" };
  }
  // doc 81 Đợt 1B Task 6 fix round 1 (R15 hardening) — an interlock-triggered command skips
  // HITL, so the rule itself IS the authorisation and must pin the command EXACTLY: one write,
  // to the rule's commandTag, with the rule's commandValue (default true — the value the
  // interlock engine sends), and commandType === rule.action. Before this a "reduce_speed" rule
  // authorised any value on its tag (speed_sp=9999) plus extra writes on other tags.
  // ⚠ CÒN MỞ: this proves "the command is exactly what the approved rule says", NOT that the
  //   rule's value is protective (de-energising). Real protective-direction enforcement needs
  //   per-tag safe-state metadata (e.g. the safe value / allowed direction of each tag), which
  //   does not exist yet.
  if (input.writes.length !== 1) {
    return {
      ok: false,
      reason: "INTERLOCK_WRITES_MISMATCH",
      detail: `Interlock command must carry exactly ONE write (got ${input.writes.length})`,
    };
  }
  if (!rule.commandTag || input.writes[0].tagKey !== rule.commandTag) {
    return { ok: false, reason: "INTERLOCK_TAG_MISMATCH", detail: "Rule commandTag does not match the written tag" };
  }
  if (canonicalOtValue(input.writes[0].value) !== canonicalOtValue(rule.commandValue ?? true)) {
    return { ok: false, reason: "INTERLOCK_VALUE_MISMATCH", detail: "Written value differs from the rule's commandValue" };
  }
  if (input.commandType !== rule.action) {
    return {
      ok: false,
      reason: "INTERLOCK_COMMAND_MISMATCH",
      detail: `commandType "${input.commandType}" does not match rule action "${rule.action}"`,
    };
  }

  // Defense-in-depth: the event must exist, belong to the rule, and be live.
  const [event] = await db.select().from(interlockEvents).where(eq(interlockEvents.id, trig.eventId)).limit(1);
  if (!event || event.ruleId !== trig.ruleId) {
    return { ok: false, reason: "INTERLOCK_EVENT_INVALID", detail: "Interlock event missing or does not belong to the rule" };
  }
  if (event.status !== "fired" && event.status !== "auto_blocked") {
    return { ok: false, reason: "INTERLOCK_EVENT_INVALID", detail: `Interlock event status "${event.status}" is not dispatchable` };
  }

  return { ok: true };
}

/** Audit an interlock auto-block dispatch (the deterministic, human-approved path). */
async function auditInterlockAutoBlock(input: DispatchInput, commandLogIds: number[]): Promise<void> {
  if (input.triggeredBy.kind !== "interlock") return;
  const { ruleId, eventId, approvedBy } = input.triggeredBy;
  await logCrudOperation(
    createAuditContext({ user: { id: approvedBy, name: "system:interlock" } }),
    {
      action: AUDIT_ACTIONS.INTERLOCK_AUTO_BLOCK,
      entityType: "interlock_rule",
      entityId: ruleId,
      entityName: `interlock rule #${ruleId}`,
      details: {
        operation: AUDIT_ACTIONS.INTERLOCK_AUTO_BLOCK,
        metadata: {
          ruleId,
          eventId,
          approvedBy,
          adapterId: input.adapterId,
          machineId: input.machineId ?? null,
          commandType: input.commandType,
          commandLogIds,
          note: "auto-triggered by deterministic interlock rule",
        },
      },
      status: "success",
    },
  );
}

/**
 * Record a SIMULATED dispatch (one append-only commandLog row per resolved write)
 * and return the { simulated: true } result. This is the SINGLE simulated-write
 * implementation, shared by BOTH:
 *   • the mode gate (OT_CONTROL_ENABLED !== "true") — the default dry-run, and
 *   • the C2 commissioning gate (control on but adapter NOT commissioned) — which
 *     passes `blockedReason="not_commissioned"` so the ledger records WHY the real
 *     write was refused (errorText 'not_commissioned: …') and the result carries the
 *     reason. Sharing one implementation guarantees the two paths cannot drift.
 * driver.writeTags is NEVER called here. The interlock audit still fires for the
 * interlock trigger (an auto-block that lands as simulated is still auditable).
 */
async function writeSimulated(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: DispatchInput,
  resolved: Array<{ write: DispatchWrite; address: string; dataType?: string; scale?: number; offset?: number }>,
  who: ReturnType<typeof actors>,
  trig: ReturnType<typeof triggerCols>,
  blockedReason?: string,
  blockedDetail?: string,
): Promise<DispatchResult> {
  const commandLogIds: number[] = [];
  const results: DispatchPerWrite[] = [];
  const errorText = blockedReason ? `${blockedReason}: ${blockedDetail ?? "blocked"}` : null;
  const ctx = commandContext(input); // G1.7 — correlation_id + deadline_ms (every branch)
  for (const r of resolved) {
    const [row] = await db
      .insert(commandLog)
      .values({
        actionId: who.actionId,
        adapterId: input.adapterId,
        machineId: input.machineId ?? null,
        tagKey: r.write.tagKey,
        address: r.address,
        commandType: input.commandType,
        requestedValue: r.write.value as any,
        requestedBy: who.requestedBy,
        confirmedBy: who.confirmedBy,
        status: "simulated",
        ...trig,
        ...ctx,
        errorText,
        idempotencyKey: perWriteKey(input.idempotencyKey, r.write.tagKey, results.length),
      })
      .returning({ id: commandLog.id });
    commandLogIds.push(row.id);
    results.push({ tagKey: r.write.tagKey, address: r.address, ok: true, status: "simulated", error: errorText ?? undefined });
  }
  if (input.triggeredBy.kind === "interlock") await auditInterlockAutoBlock(input, commandLogIds);
  return { ok: true, simulated: true, status: "simulated", reason: blockedReason, results, commandLogIds };
}

// ─── commandLog writers (one row per write so the ledger is complete) ─────────

async function writeRejected(
  db: LedgerDb,
  input: DispatchInput,
  reason: string,
  detail: string,
  onlyTagKey?: string,
  address?: string,
  link?: LedgerLink,
): Promise<number[]> {
  return writeAll(db, input, "rejected", reason, detail, onlyTagKey, address, link);
}

async function writeFailed(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: DispatchInput,
  reason: string,
  detail: string,
): Promise<number[]> {
  return writeAll(db, input, "failed", reason, detail);
}

/**
 * doc 81 Đợt 1B Task 6 — optional ledger linkage for a row written AFTER a write-ahead
 * intent (a RESULT row, e.g. BUSY) or for a refusal that must not take the per-write key
 * (DUPLICATE_IN_FLIGHT ⇒ nullKey). Absent ⇒ the row is byte-identical to before.
 */
interface LedgerLink {
  intentIds?: number[];
  nullKey?: boolean;
  confirmedBy?: number | null;
  /** doc 81 Đợt 1D Task 2 — extra ackValue fields (pinnedStop / stopPinReason). Empty/absent ⇒ unchanged row. */
  ackExtra?: Record<string, unknown>;
}

/** The db handle OR a transaction handle (ledger writes inside the reservation tx). */
type LedgerDb =
  | NonNullable<Awaited<ReturnType<typeof getDb>>>
  | Parameters<Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]>[0];

async function writeAll(
  db: LedgerDb,
  input: DispatchInput,
  status: DispatchStatus,
  reason: string,
  detail: string,
  onlyTagKey?: string,
  address?: string,
  link?: LedgerLink,
): Promise<number[]> {
  const ids: number[] = [];
  const who = actors(input);
  if (link?.confirmedBy != null) who.confirmedBy = link.confirmedBy;
  const trig = triggerCols(input);
  const ctx = commandContext(input); // G1.7 — correlation_id + deadline_ms (rejected/failed too)
  const writes = onlyTagKey ? input.writes.filter((w) => w.tagKey === onlyTagKey) : input.writes;
  const list = writes.length > 0 ? writes : [{ tagKey: null as any, value: null }];
  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    const [row] = await db
      .insert(commandLog)
      .values({
        actionId: who.actionId,
        adapterId: input.adapterId,
        machineId: input.machineId ?? null,
        tagKey: w.tagKey ?? null,
        address: address ?? null,
        commandType: input.commandType,
        requestedValue: w.value as any,
        requestedBy: who.requestedBy,
        confirmedBy: who.confirmedBy,
        status,
        ...trig,
        ...ctx,
        errorText: `${reason}: ${detail}`,
        ...(link?.intentIds && link.intentIds.length > 0
          ? { ackValue: { ledger: link.nullKey ? "refused_duplicate" : "result", intentId: link.intentIds[Math.min(i, link.intentIds.length - 1)], ...(link.ackExtra ?? {}) } as any }
          : link?.ackExtra && Object.keys(link.ackExtra).length > 0
            ? { ackValue: { ...link.ackExtra } as any }
            : {}),
        idempotencyKey: link?.nullKey ? null : perWriteKey(input.idempotencyKey, w.tagKey ?? "_", i),
      })
      .returning({ id: commandLog.id });
    ids.push(row.id);
  }
  return ids;
}

function failedResults(input: DispatchInput, reason: string, status: DispatchStatus = "rejected"): DispatchPerWrite[] {
  return input.writes.map((w) => ({ tagKey: w.tagKey, ok: false, status, error: reason }));
}

/** Make a per-write idempotency key so a multi-write command keeps the unique constraint. */
function perWriteKey(base: string, tagKey: string, index: number): string {
  // doc 81 Đợt 1B Task 6 fix round 1 — ≤128 AND unique: a bare slice(0,128) collapsed every
  // write of a long-key command onto one key. Keys ≤128 chars are unchanged byte for byte.
  return boundedKey(`${base}:${tagKey}:${index}`);
}
