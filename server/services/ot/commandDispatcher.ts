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
 *                     R1b-2b-2a A2(h): that binding is now the DEFAULT for EVERY HITL command
 *                     at gate (1), on every path; no actionId ⇒ PRECONDITION_FAILED, except a
 *                     PINNED stop (phanLoaiStopGhimRangBuoc — the reservation's predicate too).
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

import { createHash, randomUUID } from "node:crypto";
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
  type DeviceTag,
} from "../../../drizzle/schema";
import { canKiemGiaTriChuaKhai, epKieuGiaTri, kiemGiaTriGhi, kiemLuoiThoChuaKhai, laKenhGhi, loaiKenh } from "../scada/kenhScada"; // SCADA R1a Task 3 (K4) — the ONE coercion/range/step rule
import { cheDoMay, congCheDoBat, laToolHmiCongCheDo } from "../scada/cheDoMay"; // SCADA R1a Task 4 (K2/D3) — machine LOCAL/REMOTE
import { boundedKey, canonicalOtValue, FOE_ENGINE_TOOL, foeSelfApprovalRefusal, laHangMoiStopGhim, laKhoaBenGoiChon, otPayloadHash, readOtPayloadHash } from "./otActionBinding";
import { foeApprovalDbRefusal, preReadProgramChecksForAction, type PreReadPrograms } from "../orchestration/foe/foeGateApproval"; // doc 81 Đợt 4 fix round 1 (R-4-i); Đợt 8 final wave O M2
import { orchestrationActionId } from "../orchestration/foe/foeStepClass"; // R1b-2b-2a A2(k) — the id an FOE row minted for a key carries (k3)
import { isOtSafetyPreflightEnabled, safetyPreflightReason, type SafetyUnknownBasis } from "./safetyPreflightPolicy"; // final wave (item 3): one policy, two dispatchers
import { getActiveConnectionFingerprint, getActiveDriver } from "./otManager";
// doc 81 Đợt 10 task D — the device stage (queue, write, read-back, STOP watch, slot hold) lives in otDeviceWrite.ts; every
// public name it used to export from here is re-exported below, unchanged.
import {
  adapterStopEpoch,
  executeOtDeviceWriteUnlessStopped,
  HAN_HANG_DOI_MAC_DINH_MS,
  identicalStopKey,
  isCmdSerializeEnabled,
  isQueueExpired,
  isStoppedBeforeWrite,
  isSuperseded,
  onPinnedStopQueued,
  OT_STOP_OVERRIDE_AUDIT_DEADLINE_MS,
  OT_STOP_UNVERIFIED_WAIT_MAX,
  tryEnqueueAdapterCommand,
  type ExecutedWrite,
  type QueueJobCtl,
  type StoppedBeforeWrite,
  type Superseded,
} from "./otDeviceWrite";
export {
  isOtReadbackEnabled,
  OT_TIMED_OUT_WRITE_GRACE_MS,
  OT_SESSION_RESET_SLACK_MS,
  OT_STALE_WRITE_RISK_TTL_MS,
  OT_STOP_WATCH_POLL_MS,
  OT_STALE_WRITE_RISK_TTL_MIN_MS,
  OT_STALE_WRITE_RISK_TTL_MAX_MS,
  staleWriteRiskFloorMs,
  OT_DRIVER_DEFAULT_TIMEOUT_MS,
  staleWriteRiskWindowMs,
  _staleWriteRiskSizeForTests,
  _sweepStaleWriteRiskForTests,
  _stopWatchCountForTests,
  isCmdSerializeEnabled,
  isSuperseded,
  _resetAdapterCommandQueuesForTests,
  _adapterCommandQueueCountForTests,
  _adapterCommandQueueDepthForTests,
  tryEnqueueAdapterCommand,
  OT_STOP_OVERRIDE_AUDIT_DEADLINE_MS,
  adapterStopEpoch,
  bumpAdapterStopEpoch,
  isStoppedBeforeWrite,
  HAN_HANG_DOI_MAC_DINH_MS,
  isQueueExpired,
  type Superseded,
  type EnqueueOutcome,
  type StoppedBeforeWrite,
  type QueueExpired,
} from "./otDeviceWrite";
import { adapterTargetFingerprint } from "./adapterTarget";
import type { AppErrorCode, AppErrorParams } from "../../_core/appErrorCodes";
import { AUDIT_ACTIONS, createAuditContext, logCrudOperation } from "../auditTrailService";
import { withDeadline } from "./drivers/boundedClose"; // final wave 5 (M4)
import { ghiCoTran, suKienAuditTuNoiDung, themLucSuKien, type BoiCanhGhi } from "./ghiTreoCoTran"; // R1b-2b-2a T1 (mục 61) — one stuck-write cap for the STOP path
import { isCommissioned, isCommissioningRequired } from "./commissioningService";
// Doc 25 T1 — cổng interlock ĐỒNG BỘ, fail-closed chạy TRƯỚC mọi real-write HITL.
// Import từ interlockGate (module chỉ đọc DB, KHÔNG import ngược commandDispatcher →
// không tạo vòng phụ thuộc).
import { evaluateInterlockGate } from "../interlock/interlockGate";
import { tapMayChoInterlock } from "../interlock/tapMayChoInterlock";
import { evaluateCommandPolicy, secPlatformEnabled } from "../security/policyGate"; // doc 33 I2 (F5): policy-as-code gate
// G1.7 (doc 44 W0-D) — correlation backbone (AsyncLocalStorage, opt-in): when the
// caller did not pass an explicit correlationId we read the ambient one (if any).
import { getCorrelationId } from "../observability/correlation";
import { adapterOwnedByEdgeInTx } from "./otAdapterOwnerGate"; // doc 81 Đợt 10 D fix review 3 (scan #73)
// doc 81 Đợt 1D Task 2 — per-tag pinned STOP values (mig 0362, Task 1).
import { loadStopPins, matchPinnedStop, stopPinsFromTagRows, validateStopValue, type MatchPinnedStopResult, type StopPin, type StopPinTagRow } from "./stopPin";
import { luatDuyetConHieuLuc } from "../interlock/dinhNghiaDuyet"; // kiem-dinh R1b-1 I1 (a): duyệt còn hiệu lực = bám định nghĩa tag khớp
import { giaTriLenhInterlock } from "../interlock/giaTriLenh"; // R1a T12 fix 1 (c1): giá trị luật GỬI = giá trị so ở đây = giá trị kiểm lúc cấu hình
import { cachedStopPinPresence } from "./stopPinPresence"; // doc 81 Đợt 12 final fix wave residual (R-12-f item 1)
import { kiemGiaTriDiaChiBit, lopDiaChiBit } from "./drivers/diaChiBit"; // R1b-2b-1 T2 fix round 1 (I1) — bit-address rule of the early gate
import { otStopEpochSyncSeesPeers } from "./otStopEpochSync"; // R-12-f item 1
import { hanLenhOtMacDinhMs } from "./hanLenhOt"; // R1b-2b-2a T3 fix 1 (M-4) — MỘT nơi đọc + kẹp OT_CONTROL_TIMEOUT_MS
import { ketCucLo, MA_MOT_PHAN, moTaMotPhan, motPhanCua, type MotPhan } from "./motPhan"; // R1b-2b-2a T3E (backlog 90) — lô áp MỘT PHẦN
import { ghiNhanMotPhan } from "./boDemTruyenThong"; // T3E — scadaDiag: lô áp một phần gần nhất của adapter (RAM, cửa sổ 1 h)

/** True when the operator has explicitly enabled real OT control (F4b). */
export function isOtControlEnabled(): boolean {
  return process.env.OT_CONTROL_ENABLED === "true";
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
   * R1b-2b-2a A2(h) — REDUNDANT for any command but a pinned STOP: gate (1) now binds every HITL command on every path.
   * Still accepted; with it a pinned STOP without an actionId is refused too.
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
   * R1b-2b-2a T6d — NỘI BỘ (do `dispatch()` đặt, bên gọi không truyền): băm payload của lệnh như BÊN GỌI gửi (trước mọi ép kiểu) — `bamLenhOt`. Ghi vào
   * `ackValue.bam` của MỌI hàng của lệnh; phát lại chỉ khi hàng cũ CÙNG adapterId + tagKey + băm.
   */
  bamLenh?: string;
  /** T6d — NỘI BỘ: ghi chú sổ cho mọi hàng của lệnh (STOP gửi lại khi khoá trùng / lệch: `lanTruoc`). */
  ghiChuKhoa?: Record<string, unknown>;
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
   * SCADA R1a Task 5 (K9) — with OT_CMD_SERIALIZE_ENABLED it is ALSO the longest an ordinary command may wait in the adapter's queue
   * before its turn (absent/invalid ⇒ HAN_HANG_DOI_MAC_DINH_MS = 60 s); waited longer ⇒ never sent, rejected QUEUE_EXPIRED. A STOP, a
   * protective interlock action and a stop-typed command never expire. The ack timeout above is unchanged (and the queue TTL is NOT
   * capped by OT_CONTROL_TIMEOUT_MAX_MS: that cap bounds the device call, not the wait).
   */
  deadlineMs?: number;
  /**
   * SCADA R1a final I-2 — the queue wait ONLY: with OT_CMD_SERIALIZE_ENABLED, the longest an ordinary command may wait in the adapter's
   * queue for its turn (finite, ≥ 1 after truncation; otherwise ignored ⇒ deadlineMs / 60 s as before). It NEVER sets the device ack /
   * read-back timeout and is not persisted as deadline_ms: those stay `effectiveTimeoutMs(deadlineMs)` (absent ⇒ OT_CONTROL_TIMEOUT_MS).
   * The HMI confirm passes its remaining request TTL here (and no deadlineMs), so a confirm late in the TTL never shrinks the ack window.
   */
  queueTtlMs?: number;
  /**
   * SCADA R1a Task 5 (K7) — "bat_buoc": the device stage reads the written tags back after an acked write EVEN WHEN OT_READBACK_ENABLED
   * is off (the HMI path always verifies): match + quality "good" ⇒ acked_verified, else acked_unverified with readBackValue. The
   * comparison is the flag's own (readbackMatches); `ok` is never flipped. Absent ⇒ the flag alone decides, as before.
   */
  docLai?: "bat_buoc";
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
 * SCADA R1a Task 5 (K9) — the longest an ORDINARY command may wait in the adapter queue: its sanitised deadlineMs (commandContext), else
 * HAN_HANG_DOI_MAC_DINH_MS. Fix round 1 (fail-closed) — never 0: a fractional deadline (0.5 ⇒ trunc 0), ≤0, NaN or ∞ falls back to the
 * default (the queue treats a TTL ≤ 0 as "no TTL", so `0 ?? 60000` used to turn the TTL OFF). Always a finite integer ≥ 1.
 */
export function queueTtlMsFor(input: Pick<DispatchInput, "deadlineMs" | "queueTtlMs">): number {
  // R1a final I-2 — an explicit queue wait wins (same fail-closed sanitising: never 0 / NaN / ∞)
  const q = input.queueTtlMs;
  const tq = typeof q === "number" && Number.isFinite(q) ? Math.trunc(q) : 0;
  if (tq >= 1) return tq;
  const d = input.deadlineMs;
  const t = typeof d === "number" && Number.isFinite(d) ? Math.trunc(d) : 0; // same truncation as commandContext
  return t >= 1 ? t : HAN_HANG_DOI_MAC_DINH_MS;
}

/**
 * G1.7 — the timeout used for THIS command's write (and read-back) race:
 *   • deadlineMs absent/invalid → the global env timeout (OT_CONTROL_TIMEOUT_MS,
 *     default 5000ms) — byte-for-byte the prior behaviour.
 *   • deadlineMs provided → min(deadlineMs, OT_CONTROL_TIMEOUT_MAX_MS) when the
 *     max is configured, else deadlineMs as-is.
 */
/** SCADA R1a final I-2 — the ack/read-back timeout a command WITHOUT deadlineMs gets (OT_CONTROL_TIMEOUT_MS); the HMI sizes its lock window with it. */
export function ackTimeoutMacDinhMs(): number {
  return effectiveTimeoutMs(undefined);
}

function effectiveTimeoutMs(deadlineMs?: number): number {
  const envDefault = hanLenhOtMacDinhMs(); // R1b-2b-2a T3 fix 1 (M-4) — MỘT helper kẹp (Infinity / NaN / âm / quá trần setTimeout ⇒ 5000 + cảnh báo một lần)
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

/** final wave F7 — the pre-write safety re-check refused a non-stop write that waited too long after its preflight. */
type SafetyRecheckRefusal = { safetyRecheckRefused: true; reason: ReturnType<typeof safetyPreflightReason>; detail: string };

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
   * (`OT_COMMAND_SUPERSEDED_BY_STOP`, params { stopKey }); R1b-1 T13: an early-channel-gate OFF_STEP (`SCADA_VALUE_OFF_STEP` /
   * `_NO_HINT`, params { ma, tagKey, step, goiY? } — the HMI's own codes, `appErrorLechBuoc`); R1b-2b-1 T2: an early-channel-gate TYPE_MISMATCH
   * (`SCADA_VALUE_TYPE_MISMATCH`, params { ma, tagKey, dataType } — `appErrorCongKenh`). Absent everywhere else (byte-identical).
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
  /** doc 81 Đợt 10 final fix wave (I-4) — the adapter is EDGE-owned: the STOP was queued for its node as this request */
  edgeStopRequest?: { requestId: number; edgeNodeId: number };
  /**
   * SCADA R1b-1 T2 fix round 2 — set ONLY on the edge-route branch where the STOP could NOT be queued for the owning node and central ran
   * its fallback STOP of the adapter's pinned values (R-10-ay): `sent` ⇔ that fallback reported sent. Absent everywhere else.
   */
  centralFallbackStop?: { sent: boolean; detail: string };
  /**
   * SCADA R1b-2b-2a T3E (backlog 90, AN TOÀN) — CHỈ khi lô áp MỘT PHẦN: ≥ 1 write áp (`ok`), ≥ 1 write thiết bị đã trả lời "không áp" (`failed`),
   * KHÔNG write nào không rõ (T2: không rõ ⇒ `timeout`, thắng). `status` vẫn `failed`, `reason` = `MOT_PHAN`; danh sách tagKey. Lưu bền trong
   * `command_log.ackValue.motPhan` của MỌI hàng kết quả của lô (đường thử lại idempotent đọc lại ⇒ vẫn MOT_PHAN, không gửi lại). Vắng ở mọi kết cục khác.
   */
  motPhan?: MotPhan;
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
// doc 81 Đợt 5 task E fix 2 (review N6) — EXPORTED so the orchestration engine's verified-stop classification
// (foeStepClass.verifiedStopStepIds) applies THIS check, not a copy of it.
export async function runningConnectionMatchesAdapterRow(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, adapterId: number): Promise<boolean> {
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

/** R1b-2b-2a T3F — global slot of the test-only cut point (symbol: not reachable by name from outside). */
const CAT_SAU_GHI_CHO_TEST = Symbol.for("avi.ot.dispatch.catSauGhiThietBiChoTest");
export function catSauGhiThietBiChoTest(): ((input: DispatchInput) => Promise<void>) | null { // exported for the gate test
  // the READER requires vitest too: code outside vitest never reaches the hook by setting the global
  if (!process.env.VITEST) return null;
  const f = (globalThis as Record<symbol, unknown>)[CAT_SAU_GHI_CHO_TEST];
  return typeof f === "function" ? (f as (input: DispatchInput) => Promise<void>) : null;
}
/**
 * R1b-2b-2a T3F — TEST ONLY (vitest): a function awaited right after the device answered a real write and BEFORE its result rows are written
 * (simulates a crash between "device written" and "result row written": e.g. a promise that never settles). null clears it. Outside vitest
 * (`process.env.VITEST` absent) it does nothing, logs, returns false. Never used by production code.
 */
export function __catSauGhiThietBiChoTest(f: ((input: DispatchInput) => Promise<void>) | null): boolean {
  if (!process.env.VITEST) {
    console.error("[Dispatch] __catSauGhiThietBiChoTest ignored outside vitest");
    return false;
  }
  const g = globalThis as Record<symbol, unknown>;
  if (f) g[CAT_SAU_GHI_CHO_TEST] = f;
  else delete g[CAT_SAU_GHI_CHO_TEST];
  return true;
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
  // R1b-2b-2a T6d — băm payload của BÊN GỌI (trước mọi ép kiểu), một lần, theo lệnh; trường nội bộ do bên gọi đặt bị bỏ qua.
  // T6d fix 2 (AN TOÀN) — khoá idempotency chuẩn hoá MỘT lần ở cửa duy nhất vào đường gửi (`dispatchCore` chỉ được gọi từ đây): kiểu khai `string`
  // nhưng lúc chạy có bên gọi không truyền (vd khung lệnh canonical thiếu cả idempotency_key lẫn command_id) ⇒ "" (KHÔNG sinh khoá: lệnh thiếu khoá vẫn
  // là "không khoá" — STOP thay lệnh đang chờ báo biến thể OT_COMMAND_SUPERSEDED_BY_STOP_NO_KEY, G9). Mọi chỗ sau thấy một chuỗi.
  // A2(a) fix round 2 — chuỗi CHỈ khoảng trắng cũng ⇒ "" (chỉ khoảng trắng = không khoá ở MỌI chỗ; xem `khoaChuanHoa`).
  const result = await dispatchCore({ ...input, idempotencyKey: khoaChuanHoa(input.idempotencyKey), bamLenh: bamLenhOt(input), ghiChuKhoa: undefined });
  emitCmdAck(input, result);
  return result;
}

/**
 * A2(a) — khoá "rỗng" = lệnh KHÔNG khoá: không phải chuỗi, "" hoặc chỉ khoảng trắng (`trim` CHỈ để thử rỗng; khoá không rỗng không bao giờ bị sửa).
 * A2(a) fix round 2 (AN TOÀN) — vị từ DUY NHẤT cho "khoá rỗng" trong dispatcher: mọi phép thử rỗng của khoá (bước 1b, lý do đổi khoá STOP ở bước 2 và
 * giữ chỗ, khoá NULL của `writeAll` / `writeSimulated`, khoá STOP hiển thị NO_KEY) đi qua đây — không `!key` / `key === ""` / `key.length` rời.
 */
function laKhoaRong(k: unknown): boolean {
  return typeof k !== "string" || k.trim() === "";
}

/**
 * T6d fix 2 — khoá idempotency của bên gọi như chuỗi: thiếu / không phải chuỗi ⇒ "" (lệnh không khoá); chuỗi giữ nguyên từng byte.
 * A2(a) fix round 2 (AN TOÀN, kiem-dinh) — chuỗi CHỈ khoảng trắng ⇒ "" (chỉ khoảng trắng = KHÔNG khoá, ở MỌI chỗ). Trước: `"   "` đi tiếp như một khoá thật
 * ⇒ mọi STOP khoá `"   "` dùng chung khoá ghi `v2:3:   :…` mà hai chỗ gọi lý do đổi khoá STOP (phép phủ định chuỗi khoá, không trim) coi là CÓ khoá ⇒ STOP thứ hai
 * sau một STOP ok bị PHÁT LẠI (acked, KHÔNG gửi). Chuỗi có ký tự khác khoảng trắng giữ NGUYÊN từng byte (`"  K  "` — KK-6).
 */
export function khoaChuanHoa(k: unknown): string {
  return typeof k === "string" && !laKhoaRong(k) ? k : "";
}

/** A2(a) fix round 2 — lý do gửi lại STOP dưới khoá mới, với "không khoá" = `laKhoaRong` (MỘT chỗ cho cả bước 2 lẫn giữ chỗ). Xuất cho test. */
export function lyDoStopKhoaMoiCho(qd: QuyetDinhKhoa, kqPhatLai: DispatchResult | null, idempotencyKey: unknown): LyDoStopKhoaMoi | null {
  return lyDoStopKhoaMoi(qd, kqPhatLai, laKhoaRong(idempotencyKey));
}

/** A2(a) fix round 2 — khoá của STOP đã gửi như hiển thị trong lời huỷ lệnh chờ: rỗng (`laKhoaRong`) ⇒ null (biến thể NO_KEY, G9). Xuất cho test. */
export function khoaStopHienThi(k: unknown): string | null {
  return typeof k === "string" && !laKhoaRong(k) ? k : null;
}

/**
 * doc 81 Đợt 11 K-fix (R-11-d) / K-fix 2 (R-11-i, R-11-h) / final fix wave (R-11-j, R-11-k) — the STOP epoch a command checks right
 * before its device write (the value it read when its gates began), or null when a STOP never cancels it:
 *   • a TRUE stop by content (`trueStop`: the pinned stop, or writes that are exactly pinned stop tags with their pinned values);
 *   • (an UNVERIFIED stop-typed command DOES record it — ruling R-11-o M-3, was R-11-j/m: a verified STOP sent while it is in its gates
 *     supersedes it, SUPERSEDED_BY_STOP never STOPPED_BEFORE_WRITE, exactly as when it waits in the queue (R-1E-b); flag ON and OFF);
 *   • an INTERLOCK-triggered command (block_downstream / stop_line / reduce_speed) — a protective action is never cancelled (R-11-h) —
 *     UNLESS it writes a pinned stop tag with a non-pin value (`overridesStopPin`, R-11-k 3): then a verified STOP sent while it is in
 *     its gates cancels it (else it would land after the STOP and override the pin).
 */
export function stopEpochAtGatesFor(
  input: Pick<DispatchInput, "triggeredBy" | "commandType">,
  opts: { trueStop: boolean; epochAtGates: number; overridesStopPin?: boolean },
): number | null {
  if (opts.trueStop) return null;
  if (input.triggeredBy.kind === "interlock" && opts.overridesStopPin !== true) return null;
  return opts.epochAtGates;
}

/** doc 81 Đợt 12 final fix wave (R-12-e I-1) — bound of the adapter-wide pin read deciding the peer-move exemption */
export const PEER_EXEMPT_PIN_READ_MS = 1_000;
/**
 * doc 81 Đợt 12 final fix wave (ruling R-12-e I-1, scan #113) — true ONLY when the adapter's pins were read and there are none. A read
 * error or no answer within PEER_EXEMPT_PIN_READ_MS ⇒ false (not exempt: fail toward cancelling on a peer STOP). Never throws.
 */
export async function adapterHasNoStopPinsBounded(db: Parameters<typeof loadStopPins>[0], adapterId: number, ms = PEER_EXEMPT_PIN_READ_MS): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((r) => {
      timer = setTimeout(() => r(null), ms);
    });
    const pins = await Promise.race([loadStopPins(db, adapterId), timeout]);
    return pins !== null && pins.length === 0;
  } catch (err) {
    console.warn(`[Dispatch] stop-pin read for the peer-move exemption failed (adapter ${adapterId}) — not exempt:`, (err as Error)?.message || err);
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * doc 81 Đợt 11 final fix wave (R-11-k 3) — does this command write a PINNED stop tag with a value other than its pin (by the same
 * match rule as the pinned stop)? e.g. a reduce_speed interlock writing speed_sp = 30 where speed_sp's stop pin is 0. Pure.
 */
export function writesOverrideStopPin(writes: ReadonlyArray<DispatchWrite>, pins: ReadonlyArray<StopPin>): boolean {
  return writes.some((w) => pins.some((p) => p.tagKey === w.tagKey) && !matchPinnedStop([...pins], [{ tagKey: w.tagKey, value: w.value }]).ok);
}

/**
 * doc 81 Đợt 11 K-fix 2 (ruling R-11-i a) — is this command a STOP by CONTENT (never by its label)? The pinned stop (5a-stop:
 * stop-typed + exact pins + step-3 rows + current connection), or — whatever its commandType, HITL or interlock — a command whose
 * writes are exactly pinned stop tags with their pinned values, fitting the step-3 rows, on a connection made for the adapter's
 * CURRENT target (the same evidence as the pin, minus the label). Only this decides the STOP path of the queue (R-11-n) and the STOP
 * epoch; it skips no gate before the queue (the gate exemptions stay the pinned stop's alone) — only the pre-write safety RE-check
 * (R-11-k / R-11-l: never for a verified STOP). Any read failure ⇒ false (fail closed: an ordinary / unverified command).
 */
async function isStopByContent(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: DispatchInput,
  resolved: Array<{ write: DispatchWrite; dataType?: string }>,
  step3TagRows: StopPinTagRow[],
  stopCls: OtStopClassification,
): Promise<boolean> {
  if (stopCls.pinnedStop) return true;
  if (stopCls.isStop) return false; // a HITL stop-labelled command that is not the pin: the same content test already failed
  const c = classifyOtStop("stop", input.writes, stopPinsFromTagRows(step3TagRows)); // the label is ignored: content only
  if (!c.isStop || !c.pinnedStop) return false;
  if (!canonicalisePinnedStop(resolved, c.writes).ok) return false;
  try {
    return await runningConnectionMatchesAdapterRow(db, input.adapterId);
  } catch {
    return false;
  }
}

// ─── SCADA R1a Task 3 (K4) — EARLY CHANNEL GATE: channel kind + write type/range/step, every caller ───────────────────────────

/** The device_tags columns the early channel gate reads (the step-3 row of each written tag). */
export type TagCongKenh = Pick<
  DeviceTag,
  "tagKey" | "address" | "dataType" | "writable" | "isEnabled" | "stopValue" | "channelKind" | "writeMin" | "writeMax" | "writeStep"
> &
  // kiem-dinh P1-3 + R1b-1 T13 — scale/offset (hàng bước 3 là hàng đầy đủ): int của MỌI tag (đã khai hay chưa) phải nằm trên lưới thô,
  // không thì OFF_STEP.
  Partial<Pick<DeviceTag, "scale" | "offset">>;

/** Refusal codes of the early channel gate (command_log.errorText `<CODE>: <detail>`). */
export type MaCongKenh = "CHANNEL_READ_ONLY" | "TYPE_MISMATCH" | "OUT_OF_RANGE" | "OFF_STEP";

export type KetQuaCongKenhSom =
  | { ok: true; writes: DispatchWrite[] }
  // R1b-1 T13 — `buoc` / `goiY` (OFF_STEP only): the grid just missed and the hint, for the localisable refusal (`SCADA_VALUE_OFF_STEP`).
  | { ok: false; ma: MaCongKenh; chiTiet: string; tagKey: string; address: string; buoc?: number; goiY?: number };

/**
 * Does this tag DECLARE a write channel model (mig 0431 columns)? Only then are its written values coerced and checked
 * (type, range, step). All NULL ⇒ the pre-R1a behaviour, byte for byte: the caller's value goes on as sent, uncoerced
 * (plan R1a: "NULL = hành vi cũ"; the ' "42" ≠ 42 ' binding test and the ' "0" is not the int pin 0 ' stop-pin test stay
 * true on an undeclared tag). `actuationLevel` / `displayName` / `displayFormat` describe, they do not constrain a write.
 */
export function kenhDaKhaiGhi(tag: Pick<DeviceTag, "channelKind" | "writeMin" | "writeMax" | "writeStep">): boolean {
  return tag.channelKind != null || tag.writeMin != null || tag.writeMax != null || tag.writeStep != null;
}

/**
 * Type-only coercion (kenhScada `epKieuGiaTri`: no range / step / raw grid) — the value a declared tag would carry if it were in range.
 * R1b-2a T2 (m5) — scale / offset aware: an int tag with (scale, offset) ≠ (1, 0) carries a finite ENGINEERING value (2.5 on scale 0.5),
 * (1, 0) keeps the integer coercion. The SAME function for pass 1 of `congKenhSom` AND Gate 1 (`writesEpKieuChoRangBuoc`, ruling K4), so the
 * binding re-check and the write always see one coerced value. NOT `kiemGiaTriGhi`: a raw-grid check here would refuse a pinned STOP before the
 * whole-command exemption (pass 2 does the grid).
 */
function epKieuKenh(tag: Pick<DeviceTag, "dataType"> & Partial<Pick<DeviceTag, "scale" | "offset">>, value: unknown) {
  return epKieuGiaTri({ dataType: tag.dataType, scale: tag.scale, offset: tag.offset }, value);
}

/**
 * PURE — the early channel gate (step 3b of dispatchCore). `tags[i]` is the step-3 row of `writes[i]` (found, enabled,
 * writable). Two passes over the writes, each in write order:
 *   PASS 1 (every write):
 *   1. not a write channel (`laKenhGhi`: channel_kind input / calculated) ⇒ CHANNEL_READ_ONLY. NO stop exemption: a pin
 *      only exists on a writable channel. channel_kind NULL ⇒ derived from `writable` (true here) ⇒ always a write channel.
 *   2. channel model not declared (`kenhDaKhaiGhi` false) ⇒ the write passes UNCHANGED (old behaviour: never coerced). R1b-1 T13 +
 *      R1b-2a T1 (Q-T13 b): EVERY undeclared INT tag — scale 1 / offset 0 included — is still queued for pass 2 (5); R1b-2a T2 (ruling T1
 *      c3): EVERY undeclared FLOAT tag too (`canKiemGiaTriChuaKhai` ⇔ dataType int | float); its value is not coerced.
 *   3. coerce by dataType (`epKieuKenh` = kenhScada `epKieuGiaTri`, type only, never rounds; R1b-2a T2: int with (scale, offset) ≠ (1, 0)
 *      ⇒ a finite engineering value, e.g. 2.5 on scale 0.5) ⇒ TYPE_MISMATCH on failure. No raw-grid check in pass 1 (it would refuse a
 *      pinned STOP before the exemption below).
 *   PINNED STOP exemption (coordinator 2026-10-24 item 4: no software blocks a pinned STOP; fix round 1 M-2: WHOLE command
 *   only) — matched on DATA here, since this gate runs before the mode/commissioning gates: a stop-typed command
 *   (`isStopCommandType`) whose writes — ALL of them, declared (coerced) and undeclared (as sent) — equal their tags'
 *   `stop_value` (one `matchPinnedStop` over every write, the 5a-stop rule: pinned tags, pinned values, no duplicates) skips
 *   range and step. A stop that mixes a pin with ANY other write (fix round 2: an undeclared, unpinned one too — it is not a
 *   pinned STOP at 5a-stop either) is not exempt for any of them. The full classification (`classifyOtStop`, connection fingerprint …)
 *   still runs later, unchanged. Range ↔ stop_value consistency is checked at CONFIGURATION time (R1a Task 12), not here.
 *   PASS 2 (declared writes + EVERY undeclared int or float write, in write order, unless exempt):
 *   4. range, then step ⇒ OUT_OF_RANGE / OFF_STEP (the detail carries `goiY`, a hint only — the value is never altered). Declared only.
 *   5. kiem-dinh P1-3 (2026-10-24) + R1b-1 T13 + R1b-2a T1 — int raw grid: n = (v − offset)/scale must be an integer, compared in RAW
 *      space (|n − round(n)| > 1e-9 + 4·EPSILON·(|n| + (|v| + |o|)/|s|) ⇒ OFF_STEP, goiY = the nearest raw-grid value, buoc = |scale|;
 *      scale 1 / offset 0 ⇒ the integer grid: 2.5 ⇒ OFF_STEP goiY 3 buoc 1); |n| ≥ 2^53 or n not finite ⇒ OUT_OF_RANGE (kiem-dinh M1).
 *      EVERY int tag: declared (`kiemGiaTriGhi`, on the coerced integer) AND undeclared (`kiemLuoiThoChuaKhai`, on the number the driver's
 *      `inverseScale` reads — the value itself still goes on as sent). Undeclared int only (kiem-dinh M2, ruling K3): a value that is not
 *      a deliberate finite number — NaN / ±Infinity / "abc" / "Infinity" / "" / whitespace / null / undefined / an array / a plain object
 *      / a Symbol — ⇒ TYPE_MISMATCH "giá trị không phải số hữu hạn — tag int không ghi được" (the driver used to write Math.round(NaN), or
 *      the 0 of Number(""), Number(null), Number([])); true / false ⇒ 1 / 0, "7" ⇒ 7, a safe Sparkplug Long ⇒ its number. R1b-2a T2
 *      (ruling T1 c3): the same reader on an undeclared FLOAT tag ⇒ TYPE_MISMATCH "… tag float không ghi được" (no grid: the driver does
 *      not round a float; a raw (v − o)/s that overflows a double ⇒ OUT_OF_RANGE); valid numbers / numeric strings still go on as sent. No flag: the
 *      driver used to round silently (scale 10: 25 ⇒ raw 3 = 30) — a right/wrong fix, census in the T13 report and the R1b-2a T1 report
 *      (nobody relies on the rounding / on the NaN write). A pinned STOP is exempt (whole-command rule above), like range/step: an
 *      off-grid pin is still written (and rounded by the driver) — STOP is never blocked; such pins are a configuration finding, not a
 *      dispatch refusal.
 *   6. R1b-2b-1 T2 fix round 1 (I1) — BIT ADDRESS (`protocol` given): a write to an address the driver writes as ONE BIT whatever the tag
 *      dataType (Modbus coil, bool holding register, SLMP / MC / S7 bit — `kiemGiaTriDiaChiBit`) must carry a value in the bool set (the driver's
 *      strict `boolGhi` would otherwise fail it AFTER every gate and the ledger) ⇒ TYPE_MISMATCH here, device called 0 times. Runs LAST, after
 *      the stop-typed pinned-STOP exemption, and is also skipped when the whole command equals the pinned values (a STOP by content, written
 *      with the lenient `boolDungGhim` — KD-T2: a verified STOP is never refused for its bool form).
 * ok ⇒ the writes to use downstream: declared tags carry the COERCED value, undeclared ones the caller's write object.
 *
 * R1a Task 4 (ledger R-1) appends its mode gate (3c) right after this block in dispatchCore, on the same tag rows.
 */
export function congKenhSom(
  commandType: string,
  writes: ReadonlyArray<DispatchWrite>,
  tags: ReadonlyArray<TagCongKenh>,
  /** R1b-2b-1 T2 fix round 1 — the adapter protocol (bit-address rule 6); absent ⇒ rule 6 does not run (pure callers / old behaviour). */
  protocol?: string | null,
): KetQuaCongKenhSom {
  const tuChoi = (i: number, ma: MaCongKenh, chiTiet: string, luoi?: { buoc?: number; goiY?: number }): KetQuaCongKenhSom => ({
    ok: false,
    ma,
    chiTiet,
    tagKey: writes[i].tagKey,
    address: tags[i].address,
    ...(luoi?.buoc !== undefined ? { buoc: luoi.buoc } : {}),
    ...(luoi?.goiY !== undefined ? { goiY: luoi.goiY } : {}),
  });
  const out: DispatchWrite[] = [];
  const canKiem: number[] = []; // indexes checked in pass 2: declared writes (coerced in `out`) + every undeclared int / float write (as sent)
  for (let i = 0; i < writes.length; i++) {
    const w = writes[i];
    const tag = tags[i];
    if (!laKenhGhi(tag)) return tuChoi(i, "CHANNEL_READ_ONLY", `Tag "${w.tagKey}" is a '${loaiKenh(tag)}' channel — not a write channel`);
    if (!kenhDaKhaiGhi(tag)) {
      out.push(w);
      // R1b-1 T13 + R1b-2a T1 (int: raw grid + finite number) + R1b-2a T2 (float: finite number) — the value is NOT coerced
      if (canKiemGiaTriChuaKhai(tag)) canKiem.push(i);
      continue;
    }
    const kieu = epKieuKenh(tag, w.value);
    if (!kieu.ok) return tuChoi(i, kieu.ma, `Tag "${w.tagKey}": ${kieu.chiTiet}`);
    out.push({ ...w, value: kieu.giaTri });
    canKiem.push(i);
  }
  // rule 6 candidates: writes to a bit-class address (any dataType)
  const bitIdx = protocol ? writes.map((_, i) => i).filter((i) => lopDiaChiBit(protocol, tags[i].address, tags[i].dataType) !== null) : [];
  if (canKiem.length === 0 && bitIdx.length === 0) return { ok: true, writes: out };

  const khopGhim = (): boolean => {
    const pins = stopPinsFromTagRows(tags.map((t) => ({ tagKey: t.tagKey, dataType: t.dataType, stopValue: t.stopValue, writable: t.writable, isEnabled: t.isEnabled })));
    return matchPinnedStop(pins, out.map((w) => ({ tagKey: w.tagKey, value: w.value }))).ok;
  };
  if (isStopCommandType(commandType) && khopGhim()) return { ok: true, writes: out };

  for (const i of canKiem) {
    const kq = kenhDaKhaiGhi(tags[i]) ? kiemGiaTriGhi(tags[i], writes[i].value) : kiemLuoiThoChuaKhai(tags[i], writes[i].value);
    if (!kq.ok) {
      return tuChoi(i, kq.ma, `Tag "${writes[i].tagKey}": ${kq.chiTiet}${kq.goiY !== undefined ? ` (goiY=${kq.goiY})` : ""}`, { buoc: kq.buoc, goiY: kq.goiY });
    }
    // declared: kq.giaTri === the pass-1 coerced value (kiemGiaTriGhi never rounds or clamps); undeclared: the value as sent
  }
  // rule 6 — on the value the driver receives (`out`); a STOP by content (whole command = the pinned values) is exempt (KD-T2)
  if (bitIdx.length > 0 && !khopGhim()) {
    for (const i of bitIdx) {
      const bit = kiemGiaTriDiaChiBit(protocol, tags[i].address, tags[i].dataType, out[i].value);
      if (!bit.ok) return tuChoi(i, "TYPE_MISMATCH", `Tag "${writes[i].tagKey}": ${bit.chiTiet}`);
    }
  }
  return { ok: true, writes: out };
}

/**
 * PURE — R1b-1 T13: the localisable form of an early-gate OFF_STEP, REUSING the HMI's codes and keys (`SCADA_VALUE_OFF_STEP` with
 * { ma, tagKey, step, goiY }, `SCADA_VALUE_OFF_STEP_NO_HINT` without goiY; vi/en/zh in `errors.*`), so every caller that already shows a
 * `DispatchResult.appError` (FOE step detail, equipment facade) and the AI tools say the same sentence. Any other refusal ⇒ undefined.
 */
export function appErrorLechBuoc(kq: KetQuaCongKenhSom): DispatchResult["appError"] {
  if (kq.ok || kq.ma !== "OFF_STEP" || kq.buoc === undefined) return undefined;
  return kq.goiY !== undefined
    ? { appCode: "SCADA_VALUE_OFF_STEP", appParams: { ma: kq.ma, tagKey: kq.tagKey, step: kq.buoc, goiY: kq.goiY } }
    : { appCode: "SCADA_VALUE_OFF_STEP_NO_HINT", appParams: { ma: kq.ma, tagKey: kq.tagKey, step: kq.buoc } };
}

/**
 * PURE — R1b-2b-1 T2 (kiem-dinh G1): the localisable form of an early-gate refusal returned by `dispatch()`. OFF_STEP ⇒ `appErrorLechBuoc`;
 * TYPE_MISMATCH ⇒ the HMI's own `SCADA_VALUE_TYPE_MISMATCH` with { ma, tagKey, dataType } (the dataType of the step-3 row of that tag —
 * e.g. "off" on an undeclared bool coil says the same sentence as on a declared one). Any other refusal ⇒ undefined.
 */
export function appErrorCongKenh(kq: KetQuaCongKenhSom, tags: ReadonlyArray<Pick<TagCongKenh, "tagKey" | "dataType">>): DispatchResult["appError"] {
  const lech = appErrorLechBuoc(kq);
  if (lech || kq.ok || kq.ma !== "TYPE_MISMATCH") return lech;
  const dataType = tags.find((t) => t.tagKey === kq.tagKey)?.dataType;
  if (dataType == null) return undefined;
  return { appCode: "SCADA_VALUE_TYPE_MISMATCH", appParams: { ma: kq.ma, tagKey: kq.tagKey, dataType } };
}

/**
 * Gate 1 (every HITL actionId since A2(h)) verifies the binding BEFORE step 3 reads the tags. To accept the same coerced form step 3b
 * will produce, this reads the written tags' declarations and returns the type-coerced writes — or null when nothing
 * would change, or the read fails (⇒ the raw verdict stands: fail-closed). Read-only.
 */
async function writesEpKieuChoRangBuoc(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, input: Pick<DispatchInput, "adapterId" | "writes">): Promise<DispatchWrite[] | null> {
  try {
    const keys = input.writes.map((w) => w.tagKey);
    if (keys.length === 0) return null;
    const rows = await db
      .select({
        tagKey: deviceTags.tagKey,
        dataType: deviceTags.dataType,
        channelKind: deviceTags.channelKind,
        writeMin: deviceTags.writeMin,
        writeMax: deviceTags.writeMax,
        writeStep: deviceTags.writeStep,
        // R1b-2a T2 (ruling K4) — the coercion is scale / offset aware (epKieuKenh): without them a declared int with scale 10 would coerce
        // "30.0" here by epInt (refused ⇒ raw form only) while pass 1 sends 30 ⇒ a binding hashed on 30 would fail Gate 1.
        scale: deviceTags.scale,
        offset: deviceTags.offset,
      })
      .from(deviceTags)
      .where(and(eq(deviceTags.adapterId, input.adapterId), inArray(deviceTags.tagKey, keys)));
    const theoKhoa = new Map(rows.map((r) => [r.tagKey, r]));
    let doi = false;
    const out = input.writes.map((w) => {
      const tag = theoKhoa.get(w.tagKey);
      if (!tag || !kenhDaKhaiGhi(tag)) return w;
      const kieu = epKieuKenh(tag, w.value);
      if (!kieu.ok || canonicalOtValue(kieu.giaTri) === canonicalOtValue(w.value)) return w;
      doi = true;
      return { ...w, value: kieu.giaTri };
    });
    return doi ? out : null;
  } catch {
    return null;
  }
}

/**
 * R1b-2b-2a A2(g) (AN TOÀN) — liên kết sổ của MỌI hàng từ chối ghi TRƯỚC idempotency (2): cổng uỷ quyền (1) — PRECONDITION_FAILED (requireBoundAction
 * không actionId), `bound.reason` (ACTION_BINDING_MISMATCH …), NOT_CONFIRMED, INTERLOCK_* (`verifyInterlockAuthorization`). (Bước (1b) A2(a) chỉ chạy cho
 * lệnh KHÔNG khoá và đã ghi khoá NULL — `tuChoiThieuKhoa`.) Khoá NULL (`nullKey`) + khoá gốc của bên gọi ở `ackValue.khoaGoc` (để kiểm toán vẫn thấy
 * khoá; lệnh không khoá: không có khoá gốc ⇒ không thêm trường, hàng y như A2(a) F1). Mã / lý do / chi tiết không đổi.
 *
 * Vì sao: trước, hàng từ chối của lệnh CÓ khoá mang `perWriteKey(key, tag, idx)` mà `command_log_idempotencyKey_unique` là UNIQUE TOÀN BẢNG ⇒ lần thử lại
 * cùng khoá bị từ chối ở (1) lần nữa — hoặc khoá ĐÃ BAY rồi một lần sau bị từ chối ở (1) — vỡ UNIQUE ⇒ `dispatch()` NÉM (hợp đồng: không ném cho lỗi
 * dự kiến); cùng khoá trên hai adapter cũng vỡ (khoá ghi không chứa adapter).
 *
 * Ngữ nghĩa: từ chối trước (2) nghĩa là KHÔNG gì được gửi ⇒ khoá KHÔNG bị tiêu: lần sau được uỷ quyền đúng với cùng khoá ĐI QUA (gửi thật), kể cả với
 * payload KHÁC (chưa gì bay dưới khoá đó) — hàng NULL không bao giờ khớp `hangTheoKhoa` (`IN (<khoá chuỗi>)`). Còn khoá ĐÃ bay giữ nguyên phát lại /
 * `IDEMPOTENCY_KEY_REUSED`: hàng từ chối không bao giờ che hay thay hàng đã bay. Hàng ghi TỪ (2) trở đi giữ khoá như cũ (lời từ chối ở (3)+ của lệnh có
 * khoá là hàng kết thúc mà lần thử lại PHÁT LẠI — phát lại == sống, không đổi).
 */
function lienKetTuChoiTruocBuoc2(input: DispatchInput): LedgerLink {
  return { nullKey: true, ...(laKhoaRong(input.idempotencyKey) ? {} : { ackExtra: { khoaGoc: input.idempotencyKey } }) };
}

/**
 * R1b-2b-2a A2(h) — THE pinned-STOP predicate of the HITL binding exemption (L-7: the engine-self-approval refusal
 * `foeSelfApprovalRefusal` inside `verifyActionBinding` never blocks a PINNED stop). ONE function, TWO call sites in `dispatchCore`:
 *   • gate (1) — `laStopGhimTaiCong1` (pins read with `loadStopPins`);
 *   • step 5a-stop — pins from the step-3 rows; its verdict, narrowed by the stricter layers there (canonicalisePinnedStop, running
 *     connection), is `opts.pinnedStop` of the write-ahead reservation (`reserveRealWrite` → `verifyActionBinding`).
 * Pinned ⇔ stop-typed AND every write is a pinned (tagKey, value) pair of the adapter (`classifyOtStop`); `pins === null` (the pin read
 * failed) ⇒ NOT pinned. "STOP" is defined for this purpose HERE ONLY (A2(h) H6 scans the gate for a second definition):
 * `laStopChoKhoa` / `phanLoaiStopKhoa` are the KEY-purpose classification (content stops included) — not this predicate.
 */
export function phanLoaiStopGhimRangBuoc(commandType: string, writes: DispatchWrite[], pins: StopPin[] | null): OtStopClassification {
  return classifyOtStop(commandType, writes, pins);
}

/**
 * R1b-2b-2a A2(h) — gate (1)'s answer of `phanLoaiStopGhimRangBuoc`, before step 3 has read the tags: the adapter's pins
 * (`loadStopPins`, the same rule as the step-3 pins; a read error ⇒ `null` ⇒ not pinned) against the writes step 3b will send — the
 * type-coerced form when it differs (`writesEpKieuChoRangBuoc`, the form 5a-stop classifies), else the caller's. Read-only. A command
 * that is not stop-typed is answered without a read (`classifyOtStop` decides that on the type alone).
 */
async function laStopGhimTaiCong1(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: Pick<DispatchInput, "adapterId" | "commandType" | "writes">,
  /** R1b-2b-2a A2(m) — told when the pin read failed (the FOE engine raises its URGENT alert on it); gate (1) passes none. */
  baoLoiDocGhim?: (loi: string) => void,
  noi = "gate (1)",
): Promise<boolean> {
  if (!phanLoaiStopGhimRangBuoc(input.commandType, input.writes, []).isStop) return false;
  let pins: StopPin[] | null;
  try {
    pins = await loadStopPins(db, input.adapterId);
  } catch (err) {
    console.warn(`[Dispatch] ${noi}: pinned-stop read failed for adapter ${input.adapterId} — not treated as a pinned stop:`, (err as Error)?.message || err);
    baoLoiDocGhim?.(String((err as Error)?.message ?? err));
    pins = null;
  }
  const writes = (await writesEpKieuChoRangBuoc(db, input)) ?? input.writes;
  return phanLoaiStopGhimRangBuoc(input.commandType, writes, pins).pinnedStop;
}

/**
 * R1b-2b-2a A2(m) — the FOE engine's question "is the command this step is about to send a PINNED STOP?", answered by gate (1)'s OWN
 * function (`laStopGhimTaiCong1` → `phanLoaiStopGhimRangBuoc`, the same pins rule and the same coerced writes) — never a second
 * definition. Pinned ⇒ the engine mints a FRESH authorisation row for this one dispatch (foeRunStore.ensureOrchestrationAction).
 * `loiDocGhim` ≠ null ⇔ the pins could not be read (⇒ not pinned: the old path, fail-closed). Read-only. This answer only chooses the
 * ROW: the dispatcher re-decides at gate (1) and at the reservation with its own reads (a pin change in between ⇒ its verdict wins).
 */
export async function phanLoaiStopGhimChoFoe(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: Pick<DispatchInput, "adapterId" | "commandType" | "writes">,
): Promise<{ pinnedStop: boolean; loiDocGhim: string | null }> {
  let loiDocGhim: string | null = null;
  const pinnedStop = await laStopGhimTaiCong1(db, input, (loi) => (loiDocGhim = loi), "FOE engine");
  return { pinnedStop, loiDocGhim };
}

async function dispatchCore(input: DispatchInput): Promise<DispatchResult> {
  // doc 81 Đợt 11 K-fix (R-11-d) — FIRST, before any await: the adapter's STOP epoch as this command's gates begin. Read-only;
  // K-fix 2 (R-11-i b): nothing here moves it — only a TRUE stop does, when it is SENT (device stage).
  const epochAtGates = adapterStopEpoch(input.adapterId);
  const db = await getDb();
  if (!db) {
    return { ok: false, simulated: false, status: "failed", reason: "DB_UNAVAILABLE", results: [], commandLogIds: [] };
  }

  // ── (1) Authorization gate — branch on the trigger source. ───────────────────
  // R1b-2b-2a A2(g) — every refusal row written here (before step 2) goes through `lienKetTuChoiTruocBuoc2`: NULL ledger key + `ackValue.khoaGoc`.
  if (input.triggeredBy.kind === "hitl") {
    const t = input.triggeredBy;
    // R1b-2b-2a A2(h) (AN TOÀN) — the binding is the DEFAULT for every HITL command, on EVERY path (simulated / dry-run, not commissioned,
    // the edge STOP routing, every refusal before the reservation — not only the real write): an `actionId` is verified by
    // `verifyActionBinding` (confirmed, unexpired, owned by `confirmedBy`, same tool, payload hash of THIS command — raw or the coerced form
    // step 3b sends). Before A2(h) only `requireBoundAction` (doc 81 Đợt 1B Task 6, Sparkplug / HMI) did; any other actionId got the legacy
    // check (confirmed|executed + owner — not bound to this command) and NO actionId got nothing. `requireBoundAction` stays accepted
    // (redundant now, except that it refuses a missing actionId even for a pinned STOP). Read-only here; the real-write path re-verifies
    // under FOR UPDATE and consumes the row.
    // PINNED STOP (L-7 — a pinned STOP is never refused for want of a separate approval): `laStopGhimTaiCong1` → `phanLoaiStopGhimRangBuoc`,
    // the SAME predicate whose 5a-stop verdict is the reservation's `opts.pinnedStop`. Pinned ⇒ exempt from the engine-self-approval
    // refusal (as in the reservation), and with NO actionId it is not refused here (unchanged; the reservation still demands a bound
    // actionId before any real write, the edge routing sends only the adapter's pins). Any other command without an actionId ⇒
    // PRECONDITION_FAILED (fail-closed).
    // The pins are read ONLY where the answer can change the verdict (doc 81 Đợt 1D M1 — no separate pin read on any other STOP; L-7
    // latency): no actionId (refuse or not), or an orchestration-engine row (the pinned flag only lifts `foeSelfApprovalRefusal`, which
    // answers null for every other tool — pinned by A2(h) H6). Any other row: `false` is the same verdict as the predicate's answer.
    const stopGhim = () => laStopGhimTaiCong1(db, input);
    if (!t.actionId) {
      if (t.requireBoundAction || !(await stopGhim())) {
        const ids = await writeRejected(db, input, "PRECONDITION_FAILED", "command requires a bound, confirmed HITL actionId (none supplied)", undefined, undefined, lienKetTuChoiTruocBuoc2(input));
        return { ok: false, simulated: false, status: "rejected", reason: "PRECONDITION_FAILED", results: failedResults(input, "PRECONDITION_FAILED"), commandLogIds: ids };
      }
    } else {
      const [pending] = await db.select().from(aiPendingActions).where(eq(aiPendingActions.id, t.actionId)).limit(1);
      // AMENDMENT 2 — `daTieuChoBuoc2`: a spent ('executed') row bound to THIS command goes on to step (2), which answers for the attempt that
      // spent it (replay / DUPLICATE_IN_FLIGHT / IDEMPOTENCY_KEY_REUSED / MOT_PHAN) — refusing it here made a resumed FOE step (same key, same
      // row) look "not flown" and re-send under a new attempt key (double write). It can never be written: the reservation consumes only
      // 'confirmed' rows. A `requireBoundAction` caller (HMI write / HMI STOP / Sparkplug — doc 81 Đợt 1B Task 6) keeps its strict rule
      // unchanged: a spent row is refused on every path (an anonymous MQTT command never replays a spent row, simulated included).
      const daTieu = t.requireBoundAction !== true;
      const ghim = pending?.tool === FOE_ENGINE_TOOL ? await stopGhim() : false;
      let bound = verifyActionBinding(pending, input, t, { pinnedStop: ghim, daTieuChoBuoc2: daTieu });
      if (!bound.ok && bound.reason === "ACTION_BINDING_MISMATCH") {
        // SCADA R1a Task 3 — the binding may have been hashed on the COERCED value step 3b will send (declared tags only;
        // see the hash decision at step 3b). Same verifier, raw form first; neither form matches ⇒ the raw verdict stands.
        const epKieu = await writesEpKieuChoRangBuoc(db, input);
        if (epKieu) {
          const lai = verifyActionBinding(pending, { ...input, writes: epKieu }, t, { pinnedStop: ghim, daTieuChoBuoc2: daTieu });
          if (lai.ok) bound = lai;
        }
      }
      if (!bound.ok) {
        const ids = await writeRejected(db, input, bound.reason, bound.detail, undefined, undefined, lienKetTuChoiTruocBuoc2(input));
        return { ok: false, simulated: false, status: "rejected", reason: bound.reason, results: failedResults(input, bound.reason), commandLogIds: ids };
      }
    }
  } else {
    // F5b: deterministic interlock rule must be authorized (verifyInterlockAuthorization).
    const auth = await verifyInterlockAuthorization(db, input, input.triggeredBy);
    if (!auth.ok) {
      const ids = await writeRejected(db, input, auth.reason, auth.detail, undefined, undefined, lienKetTuChoiTruocBuoc2(input));
      return { ok: false, simulated: false, status: "rejected", reason: auth.reason, results: failedResults(input, auth.reason), commandLogIds: ids };
    }
  }

  // ── (1b) R1b-2b-2a A2(a) (+ AMENDMENT 1) — lệnh KHÔNG khoá idempotency mà KHÔNG phải STOP ⇒ TỪ CHỐI. ──────────
  // Ngay SAU cổng uỷ quyền (1) — lệnh không được uỷ quyền nhận đúng lời từ chối uỷ quyền như trước (không mã khoá, không cảnh báo khẩn: người không
  // được uỷ quyền không bắn được cảnh báo / hàng sổ hàng loạt; cổng (1) chỉ ĐỌC khi thành công) — và TRƯỚC idempotency (2), giữ chỗ, ý định, mọi tiếp
  // xúc thiết bị. Không khoá = không chống trùng (thử lại = ghi hai lần). `trim()` CHỈ để thử rỗng: khoá không rỗng không bao giờ bị sửa (KK-6).
  // STOP (theo loại, hoặc nội dung = ghim) không khoá VẪN BAY như trước (G9 NO_KEY, fix 2 `khong_khoa`). Lô trộn (tag ghim STOP + write khác, loại lệnh
  // thường) KHÔNG phải STOP theo phân loại của hệ ⇒ từ chối CẢ lô (không gửi một phần — tách lô là backlog A2(e)), có cảnh báo khẩn.
  if (laKhoaRong(input.idempotencyKey)) {
    const pl = await phanLoaiStopKhoa(db, input);
    if (pl.loai !== "stop") return tuChoiThieuKhoa(db, input, pl);
  }

  // ── (2) Idempotency: a prior terminal command for this key → return cached. ──
  // commandLog rows store a per-write key; every write's key is read (T6c: the replay rolls up EVERY row; SCADA R1a T3 fix round 1 M-1: a
  // refusal of ONE later write ledgers only that write, under its own index).
  // R1b-2b-2a T6d — CHỐT phát lại (mẫu robot R-1C-i), MỘT hàm quyết `quyetDinhKhoa`: chỉ CÙNG lệnh (adapterId + tagKey + băm payload [+ người yêu cầu
  // CHỈ cho khoá bên gọi chọn `pd:` — T6d fix 1]; hàng
  // trước T6d: khớp CHẮC CHẮN giá trị) mới được phát lại; khoá của lệnh KHÁC ⇒ `IDEMPOTENCY_KEY_REUSED`, không gửi, không trả kết quả cũ. STOP (theo
  // loại, hoặc nội dung = ghim) với khoá lệch / đang bay / lần trước không tới thiết bị ⇒ GỬI THẬT dưới khoá mới, tham chiếu `ackValue.lanTruoc`.
  {
    const qd = quyetDinhKhoa(input, input.bamLenh ?? bamLenhOt(input), nguoiGoiKhoa(input), await hangTheoKhoa(db, input));
    if (qd.loai !== "khong") {
      const kqPhatLai = qd.loai === "phat_lai" ? ketQuaPhatLai(input, qd.existing, qd.hangLo) : null;
      const lyDo = lyDoStopKhoaMoiCho(qd, kqPhatLai, input.idempotencyKey);
      if (lyDo && (await laStopChoKhoa(db, input))) input = stopGuiLaiVoiKhoaMoi(input, hangCuaQuyetDinh(qd), lyDo);
      else if (kqPhatLai) return kqPhatLai;
      else if (qd.loai === "lech") return tuChoiKhoaDungLai(db, input, qd.hangTrung);
      else if (qd.loai === "khong_chac") return tuChoiKhongChac(db, input, qd.hang);
      // `dang_bay` (lệnh thường): đi tiếp — bước giữ chỗ (5b-0) từ chối DUPLICATE_IN_FLIGHT dưới khoá tư vấn (T3F, giữ nguyên).
    }
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
  /** SCADA R1a Task 3 — the full step-3 row of each write (same snapshot), for the early channel gate (3b). */
  const tagRowsBuoc3: TagCongKenh[] = [];
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
    tagRowsBuoc3.push(tag);
    resolved.push({
      write: w,
      address: tag.address,
      dataType: tag.dataType ?? undefined,
      // scale/offset là decimal → string trong DB; ép sang number cho driver.
      scale: tag.scale != null ? Number(tag.scale) : undefined,
      offset: tag.offset != null ? Number(tag.offset) : undefined,
    });
  }

  // ── (3b) SCADA R1a Task 3 (K4) — EARLY CHANNEL GATE, every caller (hitl, interlock, Sparkplug, engine). No flag: the mig 0431
  //         columns are NULL by default and an undeclared tag passes unchanged (congKenhSom). Placed BEFORE the driver / OT-mode /
  //         commissioning gates so an out-of-range command is `rejected` (one command_log row, the offending tag) even when
  //         OT_CONTROL_ENABLED is off — never `simulated`. R1a Task 4 appends its mode gate (3c) right after this block.
  //
  //         HASH DECISION (coerce before hashing, never break an existing binding): from here on the COERCED writes replace the
  //         caller's everywhere downstream — 5a-stop classification, the HITL binding re-verified in the reservation, the
  //         driver, command_log.requestedValue, idempotency (keyed by tagKey only, unaffected). The binding is accepted when the
  //         stored `__otPayloadHash` matches EITHER the coerced writes (an HMI request hashes the coerced value: "245" ⇒ 245) OR
  //         the caller's raw writes (proposeAction hashes the AI tool's raw params, e.g. "1" for a bool — such an action stays
  //         valid). Both forms describe the SAME value on the wire (the coerced one), so accepting either authorises nothing a
  //         human did not confirm. Gate 1 (every HITL actionId, A2(h)) applies the same two forms (writesEpKieuChoRangBuoc).
  const rawCallerWrites = input.writes;
  /**
   * The ONE refusal path of the early gate block (3b channel gate, 3c mode gate). fix round 1 (I-1) — a STOP-typed command to an
   * adapter central holds no driver for: if an EDGE node owns the adapter, step 4 turns it into an adapter-wide STOP of the PINNED
   * values (queued for the node / central fallback), ignoring the caller's values — so a refusal here would protect no wire value
   * and only block a STOP. Route it exactly as step 4 would; not edge-owned (or the owner unreadable — routeEdgeOwnedAdapterCommand
   * alerts) ⇒ refused through writeRejected (command_log, WORM). `tagKey` given ⇒ one row for that write; absent ⇒ one per write.
   */
  const tuChoiSom = async (
    ma: string,
    chiTiet: string,
    tagKey?: string,
    address?: string,
    appError?: DispatchResult["appError"],
  ): Promise<DispatchResult> => {
    if (isStopCommandType(input.commandType) && !getActiveDriver(input.adapterId)) {
      const routed = await routeEdgeOwnedAdapterCommand(db, input);
      if (routed) return routed;
    }
    const ids = await writeRejected(db, input, ma, chiTiet, tagKey, address);
    return { ok: false, simulated: false, status: "rejected", reason: ma, results: failedResults(input, ma), commandLogIds: ids, ...(appError ? { appError } : {}) };
  };
  const kenh = congKenhSom(input.commandType, input.writes, tagRowsBuoc3, adapter.protocol);
  if (!kenh.ok) return tuChoiSom(kenh.ma, kenh.chiTiet, kenh.tagKey, kenh.address, appErrorCongKenh(kenh, tagRowsBuoc3));
  if (kenh.writes.some((w, i) => w !== rawCallerWrites[i])) {
    input = { ...input, writes: kenh.writes };
    resolved.forEach((r, i) => {
      r.write = kenh.writes[i];
    });
  }

  // ── (3c) SCADA R1a Task 4 (K2/D3) — MACHINE MODE GATE (LOCAL/REMOTE), same early block as 3b (ledger ruling R-1): a LOCAL refusal
  //         is `rejected` (`MODE_LOCAL: <lyDo>`, one command_log row per write) even when OT_CONTROL_ENABLED is off — never
  //         `simulated`. Runs ONLY when SCADA_CONG_CHE_DO_ENABLED=true (every caller: hitl, Sparkplug, interlock — ruled "K2 with
  //         interlock commands": blocked in LOCAL) OR for the SCADA HMI write tool (`hmi.write_tag`, always). Flag off and not HMI ⇒
  //         nothing here runs, no query: the pre-R1a path byte for byte.
  //         Machine = the ADAPTER's (the step-3 device_adapters row) — authoritative (T4 fix round 1, ruling 1): `input.machineId` never
  //         overrides it (a caller naming a REMOTE machine must not bypass the LOCAL machine the adapter is on). A differing
  //         input.machineId is NOT a refusal by itself (that would change existing callers); an adapter on no machine ⇒ null ⇒ LOCAL
  //         chua_khai. REMOTE only per cheDoMay (declared channel whose adapter is still on this machine and enabled, buffer on, a
  //         good, fresh sample equal to gia_tri_remote); anything else LOCAL (fail-closed; cheDoMay never throws).
  //         PINNED STOP exemption (no software blocks a pinned STOP), matched on DATA as in 3b — WHOLE command only: stop-typed and
  //         ONE matchPinnedStop over every write (the coerced writes of 3b) against the step-3 pins. A refused stop-typed command still
  //         takes the edge pre-route of tuChoiSom.
  //         SCADA R1b-1 Task 2 — the HMI STOP tool (`hmi.stop`) is gated here ALWAYS too (stricter, never looser): its payload is built
  //         from the pins, so the data exemption above lets it through in LOCAL; any other payload under that tool is refused MODE_LOCAL.
  if (congCheDoBat() || (input.triggeredBy.kind === "hitl" && laToolHmiCongCheDo(input.triggeredBy.tool))) {
    const stopGhim =
      isStopCommandType(input.commandType) &&
      matchPinnedStop(stopPinsFromTagRows(step3TagRows), input.writes.map((w) => ({ tagKey: w.tagKey, value: w.value }))).ok;
    if (!stopGhim) {
      const cheDo = await cheDoMay(adapter.machineId ?? null);
      if (cheDo.cheDo !== "REMOTE") return tuChoiSom("MODE_LOCAL", cheDo.lyDo);
    }
  }

  // ── (4) Resolve a connected driver. ─────────────────────────────────────────
  const driver = getActiveDriver(input.adapterId);
  if (!driver) {
    // doc 81 Đợt 10 final fix wave (I-4, R-10-br, L-7) — no driver here because an EDGE node owns the adapter: a stop-typed
    // command is routed to that node (queued adapter STOP + alert; the queue failing ⇒ central's fallback STOP + critical
    // alert); any other write is refused ADAPTER_OWNED_BY_EDGE. A central-owned adapter keeps ADAPTER_OFFLINE (unchanged).
    const routed = await routeEdgeOwnedAdapterCommand(db, input);
    if (routed) return routed;
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
    // R1b-2b-2a A2(h) — the SAME predicate as gate (1) (`phanLoaiStopGhimRangBuoc`): this verdict becomes `opts.pinnedStop` below.
    stopCls = phanLoaiStopGhimRangBuoc(input.commandType, input.writes, stopPinsFromTagRows(step3TagRows));
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
  // final wave F7 (final review M5) — when the preflight PASSED; a non-stop write that then waits longer than
  // OT_SAFETY_PREFLIGHT_DEADLINE_MS before its write is re-checked just before writing (recheckSafetyIfStale).
  let preflightPassedAt: number | undefined;
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
    preflightPassedAt = Date.now();
  }

  if (input.triggeredBy.kind === "hitl") {
    // SCADA R1b-2b-2a A2(i)(1) — `targetMachineId` rules are matched against the UNION {the ADAPTER's machine (the step-3 row, no second read),
    // the caller's machine} (tapMayChoInterlock — stricter only): an FOE step naming another machine's adapter can no longer skip the rules of the
    // machine the write actually lands on. Adapter on no machine ⇒ the caller's only (as before). A pinned STOP is unchanged: a block from the wider
    // set is overridden below exactly like any other (R-1D-c). The binding hash (reserveRealWrite) keeps the CALLER's machine.
    const gate = await evaluateInterlockGate({
      adapterId: input.adapterId,
      machineIds: tapMayChoInterlock(adapter.machineId, input.machineId),
      tagKeys: input.writes.map((w) => w.tagKey),
    });
    if (gate.blocked) {
      const detail = gate.failClosed
        ? gate.vuotTran
          ? `interlock rule set for this target exceeds ${gate.vuotTran.tran} rules — fail-closed (no write)` // A2(j)
          : "interlock evaluation error — fail-closed (no write)"
        : `blocked by active interlock rule(s): ${gate.violations
            .map((v) =>
              v.lyDo === "thieu_du_lieu"
                ? `#${v.ruleId}(${v.action}; missing data — thieu_du_lieu)`
                : v.lyDo === "cau_hinh"
                  ? `#${v.ruleId}(${v.action}; rule misconfigured — cau_hinh)`
                  : `#${v.ruleId}(${v.action})`,
            )
            .join(", ")}`;
      if (stopCls.pinnedStop) {
        // R-1D-c — an active interlock wants the machine STOPPED; blocking a pinned stop would defeat it. An
        // evaluation error (failClosed) is overridden too: the stop is proven energy-reducing by the pins.
        stopOverrides.interlockOverride = {
          decision: "INTERLOCK_BLOCKED",
          failClosed: gate.failClosed,
          violations: gate.violations.map((v) => ({ ruleId: v.ruleId, action: v.action, ...(v.lyDo ? { lyDo: v.lyDo } : {}) })),
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
  // R1b-2b-2a T6d — một STOP (theo loại, ghim, hoặc nội dung = ghim của hàng bước 3 — hàm thuần, không đọc thêm) không bao giờ bị khoá trùng nuốt, kể cả
  // khi lệnh khác giành khoá GIỮA bước 2 và khoá tư vấn: bước giữ chỗ báo `doiKhoaStop` ⇒ gửi lại MỘT lần dưới khoá mới (chưa tiêu duyệt nào).
  const laStopKhoa = isStopCommandType(input.commandType) || stopCls.pinnedStop || classifyOtStop("stop", input.writes, stopPinsFromTagRows(step3TagRows)).pinnedStop;
  // R1b-2b-2a A2(k) — `laStopKhoa` goes into BOTH reservation calls (the re-keyed one gets no `laStop`): a STOP is never answered "may have flown".
  const optsGiuCho = { bindingInput: callerInput, rawBindingWrites: rawCallerWrites, ledgerExtra, laStopKhoa, pinnedStop: stopCls.pinnedStop };
  let reservation = await reserveRealWrite(db, input, resolved, { ...optsGiuCho, laStop: laStopKhoa });
  if ("doiKhoaStop" in reservation) {
    input = stopGuiLaiVoiKhoaMoi(input, reservation.doiKhoaStop.hang, reservation.doiKhoaStop.lyDo);
    reservation = await reserveRealWrite(db, input, resolved, optsGiuCho);
  }
  // khoá mới chứa UUID và lần giữ chỗ thứ hai không có `laStop` ⇒ không bao giờ báo `doiKhoaStop` lại. T6d fix 2: nhánh không thể ấy KHÔNG ném (census
  // ném thô) mà FAIL-CLOSED như giữ chỗ hỏng — không gửi, không bao giờ ok (cùng kết quả LEDGER_INTENT_FAILED của `reserveRealWrite` khi giao dịch lỗi).
  if (!reservation.ok) {
    if ("result" in reservation) return reservation.result;
    console.error(`[Dispatch] adapter ${input.adapterId}: the re-keyed STOP reservation reported its fresh key as taken — not sent (LEDGER_INTENT_FAILED)`);
    return { ok: false, simulated: false, status: "failed", reason: "LEDGER_INTENT_FAILED", results: failedResults(input, "LEDGER_INTENT_FAILED", "failed"), commandLogIds: [] };
  }
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

  // doc 81 Đợt 11 K-fix 2 (R-11-i a, R-11-h) — STOP by CONTENT decides the STOP path and the epoch; a protective interlock action
  // is never cancelled (no epoch check, `protective` in the queue) unless it overrides a pin, and is a STOP only by its content.
  const trueStop = await isStopByContent(db, input, resolved, step3TagRows, stopCls);
  // doc 81 Đợt 11 simplify (R-11-n) — an UNVERIFIED stop: stop-typed, values not proven. Every gate (the Đợt 5 F4 re-check too), the
  // ordinary queue (FIFO) but never BUSY (a full queue ⇒ it waits for a slot), no epoch bump, cancels nothing (R-11-j).
  const unverifiedStop = !trueStop && isStopCommandType(input.commandType);
  // R-11-k (3) / R-11-m — a protective interlock action or an UNVERIFIED stop that would override a pinned stop value can be cancelled
  // by a verified STOP (an ordinary write records its epoch anyway)
  const overridesStopPin = writesOverrideStopPin(input.writes, stopPinsFromTagRows(step3TagRows));
  const stopEpochAtGates = stopEpochAtGatesFor(input, { trueStop, epochAtGates, overridesStopPin });
  // doc 81 Đợt 12 final fix wave (ruling R-12-e I-1, scan #113) — the PEER-move exemption of a stop-typed command that is not a verified
  // STOP is decided by the ADAPTER's pins (all of them, not only the written tags): none ⇒ exempt (I-2: a peer never denies the only
  // software STOP there is); any pin, or the read failing / not answering ⇒ not exempt (a peer STOP cancels it as a local one does).
  // Final fix wave residual (R-12-f item 1, L-7) — the unverified stop does not wait on that read in the common case: a fresh cached
  // presence answers (stopPinPresence: TTL, invalidated on a pin change, seeded by every full pin read — e.g. the label read just
  // above); with no peer replica seen (single process / sync disabled) nothing is read at all and the answer is taken LAZILY at the
  // epoch check (cached "none" ⇒ exempt, anything else ⇒ not exempt); only a peer-seen cache miss reads (bounded 1 s).
  let adapterHasNoStopPins: boolean | (() => boolean) = false;
  if (unverifiedStop && stopEpochAtGates !== null) {
    const known = cachedStopPinPresence(input.adapterId);
    // R-12-g (defence in depth) — this command's own step-3 tag rows (read now) show a pin ⇒ the adapter HAS pins, whatever a cache says
    if (stopPinsFromTagRows(step3TagRows).length > 0) adapterHasNoStopPins = false;
    else if (known !== null) adapterHasNoStopPins = known === "none";
    else if (!otStopEpochSyncSeesPeers()) {
      const id = input.adapterId;
      adapterHasNoStopPins = () => cachedStopPinPresence(id) === "none";
    } else adapterHasNoStopPins = await adapterHasNoStopPinsBounded(db, input.adapterId);
  }

  // ── final wave F7 (final review M5) — the check-then-act gap. The safety preflight ran BEFORE the write-ahead
  //    reservation and the queue; a write queued behind a slow / timed-out one (B3 hold: up to ~11.25 s) reached the
  //    device on a verdict that old. A NON-STOP write whose preflight passed more than OT_SAFETY_PREFLIGHT_DEADLINE_MS
  //    ago re-runs the SAME preflight read just before writing; not OK => refused with the same reason (nothing written).
  //    doc 81 Đợt 5 task F4 (item 34) — the skip now matches the preflight: only a PINNED stop (stopCls.pinnedStop) is
  //    never re-checked (L-7; it never preflights either). An UNPINNED stop-typed command ran the preflight, waited in
  //    the queue like any write and can carry arbitrary writes, so it is re-checked too (was: skipped by NAME,
  //    isStopCommandType); its refusal reads like the preflight's (use the hardware E-STOP + stop pin reason).
  //    DELAY BOUND (fix 1, documented): the re-check is ONE safety read under readSafetyStateForPreflight's deadline, so
  //    an unpinned stop-typed command can be delayed by at most OT_SAFETY_PREFLIGHT_DEADLINE_MS (5 s) — and only when it
  //    had already waited longer than that in the queue; a PINNED STOP queued meanwhile ends the wait at once (it
  //    supersedes the re-checking command). A PINNED STOP itself is never re-checked and never delayed by this (L-7).
  //    The re-check holds this command's queue slot, so a PINNED STOP
  //    queued meanwhile must not wait on it: the re-check gives way at once (this write is dropped as SUPERSEDED_BY_STOP,
  //    exactly like a waiting command) and the STOP runs next.
  //    doc 81 Đợt 11 (R-11-k / R-11-l, kept by R-11-n) — no VERIFIED STOP is re-checked (the pin, or a stop by content: its values are
  //    the pinned stop values — refusing them when the safety PLC reads BLOCKED would gate a STOP, L-7); an UNVERIFIED stop is.
  const recheckSafetyIfStale = async (): Promise<Superseded | SafetyRecheckRefusal | null> => {
    if (preflightPassedAt === undefined || stopCls.pinnedStop || trueStop) return null;
    const waitedMs = Date.now() - preflightPassedAt;
    if (waitedMs <= OT_SAFETY_PREFLIGHT_DEADLINE_MS) return null;
    let unsubscribe: (() => void) | undefined;
    const stopQueued = new Promise<Superseded>((resolve) => {
      // only VERIFIED STOPs are announced (K-fix 2, R-11-i a); a protective interlock action never re-checks (no preflight on that path)
      unsubscribe = onPinnedStopQueued(input.adapterId, (stopRef) => resolve(stopRef ? { superseded: true, byStop: true, stop: stopRef } : { superseded: true, byStop: true }));
    });
    try {
      const r = await Promise.race([readSafetyStateForPreflight(input.adapterId, input.machineId ?? null), stopQueued]);
      if (isSuperseded(r)) return r;
      if (r.state === "OK") return null;
      const reason = safetyPreflightReason(r.state, r.basis);
      return {
        safetyRecheckRefused: true,
        reason,
        detail: `safety-PLC re-check before the write (the command waited ${waitedMs} ms after its preflight) returned ${r.state} — actuation denied before write, nothing sent`,
      };
    } finally {
      unsubscribe?.();
    }
  };

  // doc 81 Đợt 11 simplify (R-11-n) — the intents the device write records (B3 slot hold / late-result review, STOP watch): this
  // command's own, plus those of an identical pinned STOP dropped onto it while it waits or its write is in flight (mutable, by design).
  const deviceLedgerIntents = [...intentIds];
  // ── G1.9 — the write+verify body, extracted UNCHANGED so it can run either
  //    immediately (flag OFF — prior behaviour) or under the per-adapter queue.
  //    It never throws for expected failure modes (driver errors are caught).
  const executeWriteAndVerify = async (ctl?: QueueJobCtl): Promise<ExecutedWrite | Superseded | SafetyRecheckRefusal | StoppedBeforeWrite> => {
    const recheck = await recheckSafetyIfStale(); // final wave F7 — null => no re-check needed / still OK
    if (recheck) return recheck;
    // doc 81 Đợt 10 task D — the write + read-back + STOP-watch + slot-hold body moved VERBATIM to otDeviceWrite.executeOtDeviceWrite.
    // doc 81 Đợt 11 K-fix (R-11-d) — behind the STOP-epoch check: a STOP executed since this write's gates began cancels it here;
    // K-fix 2 (R-11-i b) — a TRUE stop moves the epoch when it is sent (bumpStopEpoch), nothing else does.
    return executeOtDeviceWriteUnlessStopped({
      input,
      driver,
      resolved,
      driverWrites,
      timeoutMs,
      stopTyped: isStopCommandType(input.commandType),
      ledger: { intentIds: deviceLedgerIntents, confirmedBy: ledgerConfirmer },
      stopEpochAtGates,
      adapterHasNoStopPins, // doc 81 Đợt 12 final fix wave (R-12-e I-1) — only an adapter without pins exempts a stop from peer moves
      bumpStopEpoch: trueStop,
      onWriteAnswered: ctl?.writeAnswered, // R-11-o (M-2) — an identical STOP shares this write only until the device answered it
    });
  };

  // ── (5c) G1.9 — PER-ADAPTER SERIALIZATION (flag OT_CMD_SERIALIZE_ENABLED,
  //    default OFF → run immediately, prior behaviour byte-for-byte). Real-writes
  //    to the SAME adapter run one-at-a-time; a full queue (depth ≥ OT_CMD_QUEUE_MAX)
  //    rejects THIS command immediately with reason 'BUSY' (spec §13.3) — the
  //    ledger records the rejection like every other rejected branch.
  //    doc 81 Đợt 1E Task 1 (R-1E-a) — a PINNED stop (stopCls.pinnedStop, Đợt 1D: exact pin match + step-3 row +
  //    connection fingerprint) is never BUSY: it runs right after the in-flight write and cancels the non-stop
  //    commands still WAITING ahead of it; each cancelled caller ledgers SUPERSEDED_BY_STOP naming the stop.
  //    doc 81 Đợt 11 simplify (owner ruling R-11-n) — a VERIFIED STOP (trueStop: the pin, or a stop by content) is sent exactly as with
  //    the flag OFF, behind the per-adapter in-flight write only: no lane, no group, no pin read at send. An identical PINNED STOP
  //    already waiting or in flight is not queued again — the caller gets that STOP's real outcome. An UNVERIFIED stop is an ordinary
  //    queued command with every gate that is never BUSY (a full queue ⇒ it waits for a slot). Anything else: capped, BUSY when full.
  //    A protective interlock action is never cancelled by a STOP unless it would override a pin (R-11-k 3).
  let executed: ExecutedWrite | SafetyRecheckRefusal | StoppedBeforeWrite;
  const slotHoldOf = (v: ExecutedWrite | Superseded | SafetyRecheckRefusal | StoppedBeforeWrite): Promise<void> | undefined => ("slotHold" in v ? v.slotHold : undefined);
  if (isCmdSerializeEnabled()) {
    const interlock = input.triggeredBy.kind === "interlock";
    const enq = trueStop
      ? tryEnqueueAdapterCommand(input.adapterId, (ctl) => executeWriteAndVerify(ctl), {
          priorityStop: true,
          stopRef: { idempotencyKey: input.idempotencyKey, commandType: input.commandType, intentIds, ...(stopCls.pinnedStop ? {} : { contentStop: true }) },
          // only the PINNED stop is shared: its outcome is its device write alone (a content stop is never one caller's verdict for another);
          // R-11-o (M-2) — same write AND same timeout (each caller's own deadlineMs holds)
          identicalStopKey: stopCls.pinnedStop ? identicalStopKey(input.adapterId, resolved, timeoutMs) : null,
          shareIntentIds: deviceLedgerIntents,
          holdSlot: slotHoldOf,
        })
      : tryEnqueueAdapterCommand(input.adapterId, (ctl) => executeWriteAndVerify(ctl), {
          // R-11-o (I-1) — on a full queue an interlock action waits (own capped list, admitted first), an unverified stop waits (capped)
          waitForSlot: interlock ? "interlock" : unverifiedStop ? "unverified" : undefined,
          protective: interlock,
          overridesStopPin,
          holdSlot: slotHoldOf,
          // SCADA R1a Task 5 (K9) — an ORDINARY command waits at most its queueTtlMs (R1a final I-2), else deadlineMs, else 60 s for its turn; past it, never sent
          // (QUEUE_EXPIRED below). No TTL — never expires — for a protective interlock action (safety direction: stop_line / block /
          // reduce) and for a stop-TYPED command that is not a verified STOP (dropping a stop is the unsafe direction; a verified STOP
          // already cancels it when its values are not the pin's). A verified STOP is the branch above (priorityStop: no TTL).
          ...(interlock || unverifiedStop ? {} : { queueTtlMs: queueTtlMsFor(input) }),
        });
    if (!enq.accepted && enq.reason === "STOP_UNVERIFIED_QUEUE_FULL") {
      // R-11-o (I-1) — the waiting list for unverified stops is full: refused (ledgered) + a durable alert; the operator is told to use the
      // pinned STOP. A verified STOP never reaches this branch.
      const detail = `${OT_STOP_UNVERIFIED_WAIT_MAX} stops that are not a verified (pinned) STOP already wait for adapter ${input.adapterId}'s full command queue — this one was refused, nothing sent. Use the pinned STOP (or the machine's E-STOP).`;
      const ids = await writeRejected(db, input, "STOP_UNVERIFIED_QUEUE_FULL", detail, undefined, undefined, { intentIds, confirmedBy: ledgerConfirmer, ackExtra: ledgerExtra });
      raiseUnverifiedStopRefusedAlert(input, detail, [ledgerConfirmer, (input.triggeredBy as { requestedBy?: number }).requestedBy ?? 0]);
      return {
        ok: false,
        simulated: false,
        status: "rejected",
        reason: "STOP_UNVERIFIED_QUEUE_FULL",
        results: failedResults(input, "STOP_UNVERIFIED_QUEUE_FULL"),
        commandLogIds: ids,
        appError: { appCode: "OT_STOP_UNVERIFIED_QUEUE_FULL", appParams: {} },
        message: "This stop is not a verified (pinned) STOP and too many such stops are already waiting for this device — it was refused and nothing was sent. Use the pinned STOP (or the machine's E-STOP).",
      };
    }
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
      // final wave G9 — a STOP without an idempotency key: its own localisable code, never the literal "unknown".
      const stopKey = khoaStopHienThi(queued.stop?.idempotencyKey);
      const stopWord = queued.stop?.contentStop === true ? "STOP" : "pinned STOP"; // K-fix 2 — a content stop that is not the pin says so
      const ids = await writeRejected(
        db,
        input,
        "SUPERSEDED_BY_STOP",
        `cancelled while waiting in the adapter command queue: ${stopKey ? `${stopWord} ${stopKey}` : `a ${stopWord} (no idempotency key)`} was queued after it — not sent to the device, resend if still needed`,
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
        appError: stopKey
          ? { appCode: "OT_COMMAND_SUPERSEDED_BY_STOP", appParams: { stopKey } }
          : { appCode: "OT_COMMAND_SUPERSEDED_BY_STOP_NO_KEY", appParams: {} },
        message: "This waiting command was cancelled because a STOP command was queued after it — it was not sent to the device; resend it if still needed.",
      };
    }
    if (isQueueExpired(queued)) {
      // SCADA R1a Task 5 (K9) — its turn came after its queue TTL: never reached driver.writeTags. RESULT row of the intent, like BUSY /
      // SUPERSEDED_BY_STOP (writeRejected with the intent link — no new ledger path).
      const ids = await writeRejected(
        db,
        input,
        "QUEUE_EXPIRED",
        `expired in the adapter command queue: waited ${queued.waitedMs} ms for its turn (limit ${queued.ttlMs} ms) — not sent to the device, resend if still needed`,
        undefined,
        undefined,
        { intentIds, confirmedBy: ledgerConfirmer, ackExtra: { ...ledgerExtra, queueExpired: { waitedMs: queued.waitedMs, ttlMs: queued.ttlMs } } },
      );
      return {
        ok: false,
        simulated: false,
        status: "rejected",
        reason: "QUEUE_EXPIRED",
        results: failedResults(input, "QUEUE_EXPIRED"),
        commandLogIds: ids,
        appError: { appCode: "OT_COMMAND_QUEUE_EXPIRED", appParams: {} },
        message: "This command waited too long in the device's command queue and expired — it was not sent to the device; resend it if still needed.",
      };
    }
    executed = queued;
  } else {
    const direct = await executeWriteAndVerify();
    // No queue => nothing can supersede it (onPinnedStopQueued fires only from the queue); kept total for the type.
    if (isSuperseded(direct)) {
      const ids = await writeRejected(db, input, "SUPERSEDED_BY_STOP", "cancelled before its write: a pinned STOP was queued", undefined, undefined, { intentIds, confirmedBy: ledgerConfirmer, ackExtra: ledgerExtra });
      return { ok: false, simulated: false, status: "rejected", reason: "SUPERSEDED_BY_STOP", results: failedResults(input, "SUPERSEDED_BY_STOP"), commandLogIds: ids };
    }
    executed = direct;
  }
  if (isStoppedBeforeWrite(executed) && unverifiedStop) {
    // doc 81 Đợt 11 final fix wave residual (R-11-m) — an UNVERIFIED stop writing a pinned stop tag with a non-pin value, in its gates
    // while a verified STOP was sent: superseded by that STOP (a stop is never "STOPPED_BEFORE_WRITE" — R-11-j), nothing written.
    const stopKey = khoaStopHienThi(executed.stop?.idempotencyKey);
    const ids = await writeRejected(
      db,
      input,
      "SUPERSEDED_BY_STOP",
      `superseded right before its device write: a verified STOP${stopKey ? ` (${stopKey})` : ""} was sent for adapter ${input.adapterId} after this command's checks began, and this command is a stop whose values are not the verified stop values — not sent to the device`,
      undefined,
      undefined,
      { intentIds, confirmedBy: ledgerConfirmer, ackExtra: { ...ledgerExtra, supersededByStop: executed.stop ?? null } },
    );
    return {
      ok: false,
      simulated: false,
      status: "rejected",
      reason: "SUPERSEDED_BY_STOP",
      results: failedResults(input, "SUPERSEDED_BY_STOP"),
      commandLogIds: ids,
      appError: stopKey ? { appCode: "OT_COMMAND_SUPERSEDED_BY_STOP", appParams: { stopKey } } : { appCode: "OT_COMMAND_SUPERSEDED_BY_STOP_NO_KEY", appParams: {} },
      message: "This command was cancelled because a STOP command was issued for the same device before it was sent — it was not sent to the device; resend it if still needed.",
    };
  }
  if (isStoppedBeforeWrite(executed)) {
    // doc 81 Đợt 11 K-fix (R-11-d) — a STOP was issued for this adapter after this write's gates began: cancelled right before
    // the device write, driver.writeTags never reached. The RESULT row of the intent (like BUSY / SUPERSEDED_BY_STOP) names the
    // STOP; the operator reads the same coded "cancelled because a STOP was issued — resend if still needed" sentence.
    const stopKey = khoaStopHienThi(executed.stop?.idempotencyKey);
    const ids = await writeRejected(
      db,
      input,
      "STOPPED_BEFORE_WRITE",
      `cancelled right before its device write: a STOP${stopKey ? ` (${stopKey})` : ""} was issued for adapter ${input.adapterId} after this command's checks began — not sent to the device, resend if still needed`,
      undefined,
      undefined,
      { intentIds, confirmedBy: ledgerConfirmer, ackExtra: { ...ledgerExtra, stoppedBeforeWrite: { epochAtGates: executed.epochAtGates, epochNow: executed.epochNow, stop: executed.stop } } },
    );
    return {
      ok: false,
      simulated: false,
      status: "rejected",
      reason: "STOPPED_BEFORE_WRITE",
      results: failedResults(input, "STOPPED_BEFORE_WRITE"),
      commandLogIds: ids,
      appError: stopKey ? { appCode: "OT_COMMAND_SUPERSEDED_BY_STOP", appParams: { stopKey } } : { appCode: "OT_COMMAND_SUPERSEDED_BY_STOP_NO_KEY", appParams: {} },
      message: "This command was cancelled because a STOP command was issued for the same device before it was sent — it was not sent to the device; resend it if still needed.",
    };
  }
  if ("safetyRecheckRefused" in executed) {
    // final wave F7 — the RESULT row of the intent (like BUSY / SUPERSEDED_BY_STOP); driver.writeTags never reached.
    // Đợt 5 F4 — an unpinned stop-typed command refused here reads like its preflight refusal (R-1C-g): the hardware
    // E-STOP sentence + appError, and the ledger carries pinnedStop:false + stopPinReason.
    const ids = await writeRejected(
      db,
      input,
      executed.reason,
      withStopRefusalText(input, executed.reason, executed.detail, stopCls),
      undefined,
      undefined,
      { intentIds, confirmedBy: ledgerConfirmer, ackExtra: { ...ledgerExtra, ...(stopRefusalLedgerLink(stopCls)?.ackExtra ?? {}) } },
    );
    return {
      ok: false,
      simulated: false,
      status: "rejected",
      reason: executed.reason,
      results: failedResults(input, executed.reason),
      commandLogIds: ids,
      ...stopRefusalExtras(input, executed.reason, stopCls),
    };
  }
  const { sentAt, timedOut, outcomes } = executed;
  // R1b-2b-2a T3F — TEST-ONLY cut point (vitest only, setter AND reader): the device has answered, the result rows are not written yet — the
  // window a process crash leaves an intent without a result (⇒ DUPLICATE_IN_FLIGHT on replay). Production: never set, never awaited.
  const catSauGhi = catSauGhiThietBiChoTest();
  if (catSauGhi) await catSauGhi(input);

  // Overall: ok is true iff every WRITE acked (verified or not). status rolls up:
  //   timeout (the command's, or ≥1 write whose outcome is unknown) → 'timeout'; else any failed → 'failed';
  //   all verified → 'acked_verified'; else (≥1 unverified, none failed) → 'acked_unverified'; else (no read-back) 'acked'.
  // R1b-2b-2a T2 (mục 66) — không rõ THẮNG thất bại (chiều an toàn: người vận hành phải đọc lại trước khi gửi lần nữa).
  // R1b-2b-2a T3E (backlog 90) — CÙNG luật với edge (`ketCucLo`); 'failed' mà ≥ 1 write ĐÃ áp ⇒ MOT_PHAN + motPhan, tính TRƯỚC khi ghi hàng kết quả
  // (motPhan đi vào ackValue của MỌI hàng của lô; hàng KHÔNG áp mang tiền tố mã `MOT_PHAN: ` trong errorText).
  const lo = ketCucLo(
    outcomes.map((o) => ({ tagKey: resolved[o.idx].write.tagKey, ok: o.ok, status: o.status })),
    timedOut,
  );
  const motPhan = lo.motPhan;

  // Insert one commandLog row per write (append-only — single insert per write).
  const ctx = commandContext(input); // G1.7 — correlation_id + deadline_ms
  const results: DispatchPerWrite[] = [];
  for (const o of outcomes) {
    const r = resolved[o.idx];
    const errorText = motPhan && !o.ok ? `${MA_MOT_PHAN}: ${o.errorText ?? "write failed"} — ${moTaMotPhan(motPhan)}` : o.errorText;
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
        errorText,
        // Task 6 — RESULT row linked to its write-ahead intent (by id; the key pair
        // '<k>' / 'intent:<k>' links them too). T3E — + `motPhan` (lô áp một phần) trên MỌI hàng của lô.
        // R1b-2b-2a T6c — + `khongRo: true` trên MỌI hàng của lô có kết cục `timeout` (không rõ): phát lại theo khoá (`ketQuaPhatLai`) thấy dấu ⇒
        // `timeout`, kể cả khi hàng đọc được là một write acked.
        ackValue: { ledger: "result", intentId: intentIds[o.idx], ...ackKhoa(input), ...ledgerExtra, ...(motPhan ? { motPhan } : {}), ...(lo.status === "timeout" ? { khongRo: true } : {}) } as any,
        idempotencyKey: perWriteKey(input.idempotencyKey, r.write.tagKey, o.idx),
        sentAt,
        ackedAt: o.ok ? new Date() : null,
      })
      .returning({ id: commandLog.id });
    commandLogIds.push(row.id);
    results.push({ tagKey: r.write.tagKey, address: r.address, ok: o.ok, status: o.status, error: errorText ?? undefined });
  }

  const allOk = lo.ok;
  const overall = lo.status as DispatchStatus;
  // T3E — reason MOT_PHAN + danh sách + câu tiếng Anh cho bên gọi API / log; scadaDiag thấy lô gần nhất (RAM).
  const motPhanExtra = motPhan ? { reason: MA_MOT_PHAN, motPhan, message: `Command "${input.commandType}": ${moTaMotPhan(motPhan)}.` } : {};
  if (motPhan) ghiNhanMotPhan(input.adapterId, { ...motPhan, commandLogIds: [...commandLogIds] });
  if (input.triggeredBy.kind === "interlock") await auditInterlockAutoBlock(input, commandLogIds);
  if (stopCls.pinnedStop) {
    for (const [kind, override] of Object.entries(stopOverrides)) auditPinnedStopOverride(input, commandLogIds[0], kind, override, ledgerConfirmer);
    return { ok: allOk, simulated: false, status: overall, results, commandLogIds, pinnedStop: true, ...motPhanExtra };
  }
  return { ok: allOk, simulated: false, status: overall, results, commandLogIds, ...motPhanExtra };
}

/**
 * doc 81 Đợt 1D Task 2 (R-1D-c) — control_audit_log row "stop_policy_override" / "stop_interlock_override" for a
 * pinned stop that a gate would have refused. Written AFTER the result row, FIRE-AND-FORGET under a deadline (same
 * reason as the robot M1 fix: under SEC_PLATFORM the hash-chain lock has no timeout and must not hold the stop's
 * answer). Its failure is logged (no secrets), never surfaced as a stop failure; the ledger row already carries
 * the override.
 * R1b-2b-2a T1 (mục 61, điều phối Q2) — runs as a THUNK under the STOP path's ONE stuck-write cap (`ghiCoTran`, `ghiTreoCoTran.ts`) for EVERY
 * pinned stop (one rule for every STOP source): the getDb() / import() / INSERT are issued only while fewer than TRAN_GHI_TREO_STOP background
 * writes are in flight; a full cap ⇒ it is QUEUED (bounded FIFO, drained under the same cap, event time kept in after.lucSuKien); only overflow / age-out drops it (logged + counted + one summary audit row).
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
  const suKien = {
    entityType: "ot_command",
    entityId: resultId ?? "unrecorded",
    action,
    actorId: confirmer,
    after: { adapterId: input.adapterId, machineId: input.machineId ?? null, commandType: input.commandType, ...override },
    reason: `R-1D-c: pinned OT stop sent despite ${String(override.decision)}`,
  };
  void ghiCoTran(
    async (t) => {
      const db = await getDb();
      if (!db) {
        console.error(`[Dispatch] audit ${action} skipped for command_log #${resultId ?? "?"} — no DB (the pinned stop was sent)`);
        return;
      }
      const { recordAuditEvent } = await import("../audit/controlAuditService");
      await recordAuditEvent(db, themLucSuKien(suKien, t));
    },
    {
      nhan: "dispatch_pinned_stop_audit",
      requestId: input.idempotencyKey ?? "-",
      noiDung: { bang: "control_audit_log", ...suKien, resultId: resultId ?? null, adapterId: input.adapterId },
      // fix round 2/3 — mục quá lớn trong hàng chờ: ghi bản CẮT (chỉ before/after, định danh nguyên văn) từ nội dung; người ghi dựng ở phạm vi riêng
      viecTuNoiDung: nguoiGhiAuditStopGhimTuNoiDung(action),
      khiLoi: khiLoiAuditStopGhim(action, resultId),
    },
  );
}

/**
 * R1b-2b-2a T1 fix round 3 (re-review N2-3) — writers / error handler for the pinned-stop audit built in their OWN scope (only `action` / `resultId`),
 * so a queued oversize entry does not keep the override payload alive (V8 shares one context per scope).
 */
function nguoiGhiAuditStopGhimTuNoiDung(action: string): (nd: unknown, t: BoiCanhGhi) => Promise<void> {
  return async (nd, t) => {
    const db = await getDb();
    if (!db) {
      console.error(`[Dispatch] audit ${action} (truncated) skipped — no DB (the pinned stop was sent)`);
      return;
    }
    // khoá phụ của nội dung (resultId, adapterId) không phải cột audit — `recordAuditEvent` chỉ đọc các trường của AuditEventInput
    const { recordAuditEvent } = await import("../audit/controlAuditService");
    await recordAuditEvent(db, themLucSuKien(suKienAuditTuNoiDung<Parameters<typeof recordAuditEvent>[1]>(nd), t));
  };
}
function khiLoiAuditStopGhim(action: string, resultId: number | undefined): (err: unknown, muon: boolean) => void {
  return (err, muon) =>
    console.error(
      `[Dispatch] audit ${action} failed${muon ? " (late, after the background-write deadline)" : ""} for command_log #${resultId ?? "?"} (the pinned stop was sent):`,
      (err as Error)?.message || err,
    );
}

/** R1b-2b-2a T6c — status một hàng kết quả mang khi thiết bị ĐÃ được ghi (đường sống `ketCucLo`). */
const TRANG_THAI_HANG_THIET_BI: ReadonlySet<string> = new Set(["acked", "acked_verified", "acked_unverified", "failed", "timeout"]);
/** Status của một hàng được tính là "ok" (giữ đúng tập cũ của phát lại). */
const TRANG_THAI_HANG_OK: ReadonlySet<string> = new Set(["simulated", "acked", "acked_verified", "acked_unverified", "sent"]);
/**
 * T6c polish 2 (re-review Important) — MÃ mà dispatcher ghi với một status THIẾT BỊ (`failed`) mà KHÔNG chạm thiết bị: chỉ `writeFailed`, người gọi DUY
 * NHẤT là ADAPTER_OFFLINE (đo lịch sử git của mọi lời gọi `writeFailed(` / `writeAll(` từ F4a 09bdb6c84: không mã nào khác). Không dùng `MA_LOI_DA_BIET`
 * (`_chiTietKyThuat`): tập ấy chứa cả mã của hàng THIẾT BỊ (MOT_PHAN, READBACK_*, OT_MC_TAM_KHOA, OT_S7_*, DRIVER_WRITE_FAILED) nên "mã đã biết" không có
 * nghĩa "không gửi"; và nhập tệp router vào dispatcher kéo theo accessControl / schema (gãy các test mock schema). Không xuất (không phải nguồn census).
 */
const MA_THAT_BAI_KHONG_GUI: ReadonlySet<string> = new Set(["ADAPTER_OFFLINE"]);
/** MÃ tiền tố `MA:` của một errorText (`writeAll` ghi `${reason}: ${detail}`) — cùng biểu thức với `reason` phát lại (polish m1). */
const maTienTo = (errorText: string | null | undefined): string | undefined => (errorText ? /^([A-Z][A-Z0-9_]*):/.exec(errorText)?.[1] : undefined);

/**
 * R1b-2b-2a T6d — băm payload của một lệnh OT như BÊN GỌI gửi (trước mọi ép kiểu / chuẩn hoá ghim): loại lệnh + danh sách write CHUẨN HOÁ theo thứ tự
 * (tagKey, kiểu JS của giá trị, giá trị chuẩn hoá `canonicalOtValue`). Hai lệnh cùng khoá chỉ là "cùng lệnh" khi băm bằng nhau (và cùng adapterId, tagKey
 * từng hàng, người gọi — `quyetDinhKhoa`). Hàm thuần.
 */
export function bamLenhOt(input: Pick<DispatchInput, "commandType" | "writes">): string {
  const chuan = JSON.stringify({ v: 1, commandType: input.commandType, writes: input.writes.map((w) => [w.tagKey, typeof w.value, canonicalOtValue(w.value)]) });
  return createHash("sha256").update(chuan, "utf8").digest("hex");
}

/** T6d — `ackValue` thêm vào MỌI hàng sổ của lệnh: `bam` (+ ghi chú khoá nếu có: `lanTruoc` của STOP gửi lại). */
function ackKhoa(input: DispatchInput): Record<string, unknown> {
  return { bam: input.bamLenh ?? bamLenhOt(input), ...(input.ghiChuKhoa ?? {}) };
}

/**
 * T6d — người yêu cầu của lệnh như cột sổ ghi (`requestedBy`). T6d fix 1 (review I1, dieu-phoi): CHỈ dùng cho khoá BÊN GỌI CHỌN (`laKhoaBenGoiChon`,
 * miền lập trình `pd:u<N>:`); khoá máy chủ sinh KHÔNG chốt người (FOE tiếp tục chạy dưới SYSTEM_FOE_USER, interlock được duyệt lại bởi người khác ⇒
 * vẫn phát lại / gửi như cũ). `triggerKind` KHÔNG thuộc chốt (dieu-phoi: đúng bốn trường adapter + tag + băm + commandType).
 */
export function nguoiGoiKhoa(input: DispatchInput): { requestedBy: number } {
  return { requestedBy: actors(input).requestedBy };
}

/** T6d — mọi hàng sổ có thể thuộc khoá này, theo chỉ số write: kết quả + ý định, định dạng MỚI (`v2` / `i2`) và CŨ (trước T6d, chỉ đọc). */
export interface HangTheoKhoa {
  ketQuaMoi: Array<CommandLog | undefined>;
  ketQuaCu: Array<CommandLog | undefined>;
  yDinhMoi: Array<CommandLog | undefined>;
  yDinhCu: Array<CommandLog | undefined>;
}

/** T6d — đọc MỘT lần mọi hàng của khoá (kết quả + ý định của MỌI write, cả hai định dạng). */
async function hangTheoKhoa(db: LedgerDb, input: DispatchInput): Promise<HangTheoKhoa> {
  // lệnh KHÔNG có write: `writeAll` ghi MỘT hàng tagKey null dưới khoá `_` chỉ số 0 (giữ phát lại như trước T6d)
  const tags = input.writes.length > 0 ? input.writes.map((w) => w.tagKey) : ["_"];
  const ketQuaMoi = tags.map((t, i) => perWriteKey(input.idempotencyKey, t, i));
  const ketQuaCu = tags.map((t, i) => perWriteKeyCu(input.idempotencyKey, t, i));
  const yDinhMoi = ketQuaMoi.map(intentKeyFor);
  const yDinhCu = ketQuaCu.map(intentKeyFor);
  const tat = [...new Set([...ketQuaMoi, ...ketQuaCu, ...yDinhMoi, ...yDinhCu])];
  const rows = tat.length === 0 ? [] : ((await db.select().from(commandLog).where(inArray(commandLog.idempotencyKey, tat))) as CommandLog[]);
  const tim = (keys: string[]) => keys.map((k) => rows.find((r) => r.idempotencyKey === k));
  return { ketQuaMoi: tim(ketQuaMoi), ketQuaCu: tim(ketQuaCu), yDinhMoi: tim(yDinhMoi), yDinhCu: tim(yDinhCu) };
}

/** T6d — hai giá trị là CHẮC CHẮN cùng một giá trị ghi (JSON chuẩn hoá bằng nhau, hoặc hai giá trị nguyên thuỷ có cùng dạng chuỗi: "245" ≡ 245). */
function khopGiaTriChac(a: unknown, b: unknown): boolean {
  if (canonicalOtValue(a) === canonicalOtValue(b)) return true;
  const nguyenThuy = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
  return nguyenThuy(a) && nguyenThuy(b) && String(a) === String(b);
}

export type QuyetDinhKhoa =
  | { loai: "khong" }
  /** CÙNG lệnh, có hàng kết quả kết thúc ⇒ phát lại T6c (`ketQuaPhatLai`). */
  | { loai: "phat_lai"; existing: CommandLog; hangLo: Array<CommandLog | undefined> }
  /** CÙNG lệnh, ý định (hoặc hàng chưa kết thúc) không có kết quả: đang bay / không rõ ⇒ DUPLICATE_IN_FLIGHT (T3F), STOP ⇒ gửi lại. */
  | { loai: "dang_bay"; hang: CommandLog[] }
  /** Khoá thuộc lệnh KHÁC ⇒ IDEMPOTENCY_KEY_REUSED (không gửi, không trả kết quả cũ); STOP ⇒ gửi thật dưới khoá mới. */
  | { loai: "lech"; hangTrung: CommandLog[] }
  /**
   * Hàng TRƯỚC T6d (không băm) không chứng minh được cùng hay khác lệnh ⇒ coi như kết cục lần trước KHÔNG RÕ: lệnh thường bị từ chối DUPLICATE_IN_FLIGHT
   * (lớp "có thể đã bay" — FOE không thử lại với khoá mới, không gửi lại), STOP ⇒ gửi thật dưới khoá mới.
   */
  | { loai: "khong_chac"; hang: CommandLog[] };

/**
 * R1b-2b-2a T6d (AN TOÀN) — MỘT nơi quyết lệnh mang khoá đã dùng có phải CÙNG lệnh không (mẫu robot `robotCommandDispatcher` R-1C-i). MỌI hàng tìm thấy
 * (kết quả + ý định, định dạng mới + cũ) phải là của lệnh này, không thì `lech`:
 *   • cùng `adapterId`, cùng `tagKey` của write CÙNG chỉ số; cùng người yêu cầu (`requestedBy`) CHỈ KHI khoá do BÊN GỌI chọn (`laKhoaBenGoiChon`,
 *     `pd:u<N>:` — T6d fix 1, review I1): khoá máy chủ sinh (`il-`, `hmi:`, `run<N>-…`, actionId, edge) chốt ĐÚNG adapter + tag + băm + commandType,
 *     KHÔNG người, KHÔNG `triggerKind` (FOE tiếp tục dưới SYSTEM_FOE_USER / interlock duyệt lại ⇒ phát lại như cũ, không bao giờ IDEMPOTENCY_KEY_REUSED);
 *   • hàng tìm thấy dưới khoá định dạng CŨ mà MANG `ackValue.bam` ⇒ `lech` (T6d fix 1, review M1): băm chỉ được ghi từ T6d, và từ T6d chỉ ghi khoá v2
 *     ⇒ hàng ấy là của một base KHÁC mà chuỗi v2 trùng chuỗi định dạng cũ của base này (base `v2:1:K:1` + tag `t` + 0 ≡ khoá v2 của base `K`);
 *   • hàng có `ackValue.bam` (ghi từ T6d) ⇒ băm = băm lệnh này (loại lệnh + tag + giá trị + kiểu + thứ tự);
 *   • hàng KHÔNG có băm (trước T6d) ⇒ FAIL-CLOSED: khác loại lệnh ⇒ lệch; giá trị khớp CHẮC CHẮN (`khopGiaTriChac`) ⇒ khớp; không chắc ⇒
 *     `khong_chac` (kết cục lần trước KHÔNG RÕ — từ chối DUPLICATE_IN_FLIGHT, không bao giờ ok, không bao giờ cho bên gọi thử lại khoá mới).
 * Một hàng lệch ⇒ `lech` (thắng `khong_chac`). Khớp hết: hàng kết quả (ưu tiên định dạng mới) có hàng kết thúc ⇒ `phat_lai`; còn hàng mà không kết quả kết thúc ⇒ `dang_bay`; không hàng ⇒ `khong`.
 * Hàm thuần — xuất cho test.
 */
export function quyetDinhKhoa(
  input: DispatchInput,
  bam: string,
  nguoiGoi: { requestedBy: number },
  h: HangTheoKhoa,
): QuyetDinhKhoa {
  const chotNguoi = laKhoaBenGoiChon(input.idempotencyKey); // T6d fix 1 (I1): chốt người CHỈ cho khoá bên gọi chọn
  // "khop" = chắc chắn CÙNG lệnh; "lech" = chắc chắn lệnh KHÁC (cột sổ khác, hoặc băm khác); "khong_chac" = hàng trước T6d (không băm) cùng cột nhưng
  // GIÁ TRỊ không khớp chắc chắn (sổ lưu giá trị ĐÃ ép kiểu / chuẩn hoá ghim: "30.0" ⇒ 30, 1 ⇒ true) — không chứng minh được khác hay cùng.
  const bamCua = (x: CommandLog | undefined) => (x?.ackValue as { bam?: unknown } | null | undefined)?.bam;
  const khopHang = (r: CommandLog, i: number, dinhDangCu: boolean): "khop" | "lech" | "khong_chac" => {
    const w: { tagKey: string | null; value: unknown } | undefined = input.writes[i] ?? (input.writes.length === 0 && i === 0 ? { tagKey: null, value: null } : undefined);
    if (!w || r.adapterId !== input.adapterId || (r.tagKey ?? null) !== w.tagKey) return "lech";
    if (chotNguoi && r.requestedBy !== nguoiGoi.requestedBy) return "lech";
    const bamHang = bamCua(r);
    // M1: khoá định dạng CŨ + có băm ⇒ hàng của base KHÁC (chuỗi v2 của nó trùng chuỗi cũ của base này) ⇒ không bao giờ phát lại
    if (dinhDangCu && typeof bamHang === "string") return "lech";
    if (typeof bamHang === "string") return bamHang === bam ? "khop" : "lech";
    // hàng kết quả không băm GẮN với ý định cùng chỉ số (`ackValue.intentId`) — vd kết quả "không rõ" do người vận hành giải bằng hàm DB
    // `ot_write_intent_resolve` (mig 0374, chép cột của ý định nhưng không chép `bam`) ⇒ phán theo băm của CHÍNH ý định ấy
    const yd = h.yDinhMoi[i] ?? h.yDinhCu[i];
    const bamYd = bamCua(yd);
    if (yd && yd.id !== r.id && (r.ackValue as { intentId?: unknown } | null | undefined)?.intentId === yd.id && typeof bamYd === "string") return bamYd === bam ? "khop" : "lech";
    if (r.commandType !== input.commandType) return "lech";
    return khopGiaTriChac(r.requestedValue, w.value) ? "khop" : "khong_chac"; // hàng chưa có băm: khớp CHẮC CHẮN, hoặc không chắc (fail-closed)
  };
  const tatCa: CommandLog[] = [];
  let lech = false;
  let khongChac = false;
  for (const [ds, dinhDangCu] of [[h.ketQuaMoi, false], [h.ketQuaCu, true], [h.yDinhMoi, false], [h.yDinhCu, true]] as const) {
    ds.forEach((r, i) => {
      if (!r) return;
      if (!tatCa.some((x) => x.id === r.id)) tatCa.push(r);
      const k = khopHang(r, i, dinhDangCu);
      if (k === "lech") lech = true;
      else if (k === "khong_chac") khongChac = true;
    });
  }
  if (tatCa.length === 0) return { loai: "khong" };
  if (lech) return { loai: "lech", hangTrung: tatCa };
  if (khongChac) return { loai: "khong_chac", hang: tatCa };
  const hangLo = h.ketQuaMoi.some((r) => !!r) ? h.ketQuaMoi : h.ketQuaCu;
  const dau = hangLo[0];
  const ketThuc = (r: CommandLog | undefined): r is CommandLog => !!r && TERMINAL_STATUSES.has(r.status as DispatchStatus);
  // cùng thứ tự đọc với trước T6d: hàng của write #0; không có ⇒ hàng kết thúc đầu tiên theo thứ tự write (R1a T3 M-1)
  const existing = dau ? (ketThuc(dau) ? dau : undefined) : hangLo.find(ketThuc);
  if (existing) return { loai: "phat_lai", existing, hangLo: [...hangLo] };
  // chưa có kết quả kết thúc: hàng của write #0 trước (cùng tập T3F đọc trước T6d), không có thì mọi hàng
  const dau0 = [h.yDinhMoi[0] ?? h.yDinhCu[0], dau].filter((r): r is CommandLog => !!r);
  return { loai: "dang_bay", hang: dau0.length > 0 ? dau0 : tatCa };
}

/**
 * T6d / A2(a) — phân loại một lệnh theo ghim STOP cho mục đích khoá (MỘT lần đọc ghim):
 *   • `stop`         — loại lệnh STOP (`isStopCommandType`), HOẶC nội dung đúng các tag ghim STOP với giá trị ghim (`matchPinnedStop`);
 *   • `giong_stop`   — không phải STOP nhưng có write vào một tag ghim STOP (lô trộn, hoặc giá trị khác ghim);
 *   • `ghim_loi_doc` — không đọc được ghim của adapter (`loadStopPins` ném) ⇒ không chứng minh được STOP;
 *   • `thuong`       — còn lại.
 */
type PhanLoaiStopKhoa = { loai: "stop" } | { loai: "giong_stop" } | { loai: "ghim_loi_doc"; loi: string } | { loai: "thuong" };

async function phanLoaiStopKhoa(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, input: DispatchInput): Promise<PhanLoaiStopKhoa> {
  if (isStopCommandType(input.commandType)) return { loai: "stop" };
  let pins: StopPin[];
  try {
    pins = await loadStopPins(db, input.adapterId);
  } catch (err) {
    return { loai: "ghim_loi_doc", loi: String((err as Error)?.message ?? err).slice(0, 160) };
  }
  let khopGhim = false;
  try {
    khopGhim = matchPinnedStop(pins, input.writes).ok;
  } catch {
    khopGhim = false; // như trước A2(a): lỗi khi so ⇒ không phải STOP
  }
  if (khopGhim) return { loai: "stop" };
  return input.writes.some((w) => pins.some((p) => p.tagKey === w.tagKey)) ? { loai: "giong_stop" } : { loai: "thuong" };
}

/**
 * T6d — lệnh này có phải STOP cho mục đích chốt khoá không: loại lệnh STOP (`isStopCommandType`), HOẶC nội dung đúng các tag ghim STOP với giá trị ghim
 * (đọc ghim của adapter — CHỈ khi khoá đã dùng). Đọc lỗi ⇒ false (lệnh thường: từ chối, không gửi). Chỉ quyết "không nuốt STOP": mọi cổng sau vẫn áp.
 * A2(a): cùng phân loại với cửa từ chối lệnh không khoá (`phanLoaiStopKhoa`), hành vi không đổi.
 */
async function laStopChoKhoa(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, input: DispatchInput): Promise<boolean> {
  return (await phanLoaiStopKhoa(db, input)).loai === "stop";
}

// ─── R1b-2b-2a A2(a) — lệnh THƯỜNG không khoá idempotency bị từ chối ở cửa vào ────────────────────────────────────────────────

/** A2(a) — lệnh thường (không write nào chạm tag ghim STOP) không có khoá idempotency. */
export const MA_THIEU_KHOA = "IDEMPOTENCY_KEY_REQUIRED";
/** A2(a) — không khoá, có write vào tag ghim STOP nhưng KHÔNG phải STOP (lô trộn / giá trị khác ghim) — cảnh báo khẩn. */
export const MA_THIEU_KHOA_GIONG_STOP = "IDEMPOTENCY_KEY_REQUIRED_STOP_LIKE";
/** A2(a) — không khoá, ghim STOP của adapter không đọc được ⇒ không chứng minh được STOP — cảnh báo khẩn. */
export const MA_THIEU_KHOA_GHIM_LOI_DOC = "IDEMPOTENCY_KEY_REQUIRED_PIN_UNREADABLE";
const CHI_TIET_THIEU_KHOA = "idempotency key required for a non-STOP command — not sent";

/** A2(a) AMENDMENT 1 — cửa sổ khử trùng cảnh báo khẩn của lệnh không khoá giống STOP / ghim lỗi đọc. */
export const KHOA_BAT_BUOC_CANH_BAO_CUA_SO_MS = 60_000;
/** A2(a) AMENDMENT 2 — trần số bộ CÒN SỐNG trong bảng khử trùng; đầy ⇒ bộ mới gộp vào khoá tràn (không bao giờ đuổi bộ còn sống). */
export const KHOA_BAT_BUOC_CANH_BAO_TOI_DA = 1024;
/** A2(a) AMENDMENT 2 — khoá tràn dùng chung (một cảnh báo / cửa sổ cho mọi bộ tràn). */
export const KHOA_BAT_BUOC_CANH_BAO_TRAN = "__tran__";

type CuaSoCanhBao = { batDau: number; lanThu: number };
const cuaSoCanhBaoKhongKhoa = new Map<string, CuaSoCanhBao>();
let cuaSoTranKhongKhoa: CuaSoCanhBao | null = null;
let toiDaCanhBaoKhongKhoa = KHOA_BAT_BUOC_CANH_BAO_TOI_DA;

/**
 * A2(a) AMENDMENT 1 + 2 — đếm một lần từ chối vào cửa sổ khử trùng của bộ `khoa`; `daPhat` ⇒ lần ĐẦU của cửa sổ (phát cảnh báo), sau đó trong cửa sổ
 * KHÔNG phát (nhưng mỗi lần vẫn ghi hàng sổ, `lanThu` đếm). Bộ hết cửa sổ (≥ `KHOA_BAT_BUOC_CANH_BAO_CUA_SO_MS`) ⇒ cửa sổ mới. Bảng đầy (sau khi dọn bộ
 * hết hạn) ⇒ KHÔNG đuổi bộ còn sống (nó sẽ phát lại) — bộ mới gộp vào `KHOA_BAT_BUOC_CANH_BAO_TRAN` (cửa sổ riêng, một cảnh báo / cửa sổ). Xuất cho test.
 * Đã chấp nhận (fix round 1, F5): (a) hai biến thể STOP_LIKE / PIN_UNREADABLE DÙNG CHUNG bộ (adapter, tập tag, người yêu cầu) ⇒ cùng một cửa sổ (tối đa một
 * cảnh báo khẩn / bộ / cửa sổ; cả hai câu đều nói "KHÔNG gửi — dùng STOP máy HMI"); (b) cảnh báo tràn luôn là lần "#1" của cửa sổ tràn — số lần SAU nằm ở
 * `canhBao.lanThu` của từng hàng sổ (câu cảnh báo nói rõ điều đó). Chỉ gọi cho lệnh ĐÃ được uỷ quyền có kiểm và sẽ ghi thật (F2).
 */
export function demCanhBaoKhongKhoa(khoa: string, now: number = Date.now()): { khoa: string; lanThu: number; daPhat: boolean; batDau: number } {
  const conSong = (e: CuaSoCanhBao) => now - e.batDau < KHOA_BAT_BUOC_CANH_BAO_CUA_SO_MS;
  const e = cuaSoCanhBaoKhongKhoa.get(khoa);
  if (e && conSong(e)) {
    e.lanThu += 1;
    return { khoa, lanThu: e.lanThu, daPhat: false, batDau: e.batDau };
  }
  if (e) cuaSoCanhBaoKhongKhoa.delete(khoa);
  if (cuaSoCanhBaoKhongKhoa.size >= toiDaCanhBaoKhongKhoa) {
    for (const [k, v] of cuaSoCanhBaoKhongKhoa) if (!conSong(v)) cuaSoCanhBaoKhongKhoa.delete(k);
  }
  if (cuaSoCanhBaoKhongKhoa.size >= toiDaCanhBaoKhongKhoa) {
    if (cuaSoTranKhongKhoa && conSong(cuaSoTranKhongKhoa)) {
      cuaSoTranKhongKhoa.lanThu += 1;
      return { khoa: KHOA_BAT_BUOC_CANH_BAO_TRAN, lanThu: cuaSoTranKhongKhoa.lanThu, daPhat: false, batDau: cuaSoTranKhongKhoa.batDau };
    }
    cuaSoTranKhongKhoa = { batDau: now, lanThu: 1 };
    return { khoa: KHOA_BAT_BUOC_CANH_BAO_TRAN, lanThu: 1, daPhat: true, batDau: now };
  }
  cuaSoCanhBaoKhongKhoa.set(khoa, { batDau: now, lanThu: 1 });
  return { khoa, lanThu: 1, daPhat: true, batDau: now };
}

/** TEST ONLY — xoá bảng khử trùng; `toiDa` > 0 ⇒ hạ trần (mặc định `KHOA_BAT_BUOC_CANH_BAO_TOI_DA`). Ngoài vitest: bỏ qua. */
export function __datLaiCanhBaoKhongKhoaChoTest(toiDa?: number | null): boolean {
  if (!process.env.VITEST) {
    console.error("[Dispatch] __datLaiCanhBaoKhongKhoaChoTest ignored outside vitest");
    return false;
  }
  cuaSoCanhBaoKhongKhoa.clear();
  cuaSoTranKhongKhoa = null;
  toiDaCanhBaoKhongKhoa = typeof toiDa === "number" && Number.isSafeInteger(toiDa) && toiDa > 0 ? toiDa : KHOA_BAT_BUOC_CANH_BAO_TOI_DA;
  return true;
}

/** A2(a) AMENDMENT 1 — bộ khử trùng: (adapterId, tập tagKey KHÁC NHAU đã sắp, người yêu cầu — `requestedBy ?? confirmedBy` / luật interlock). */
function boKhuTrungKhongKhoa(input: DispatchInput): string {
  const tags = [...new Set(input.writes.map((w) => String(w.tagKey)))].sort();
  const t = input.triggeredBy;
  const ai = t.kind === "hitl" ? `u${t.requestedBy ?? t.confirmedBy}` : `r${t.ruleId}`;
  return `${input.adapterId}|${JSON.stringify(tags)}|${ai}`;
}

/**
 * A2(a) — từ chối lệnh KHÔNG phải STOP mà không có khoá idempotency (đã qua cổng uỷ quyền (1), TRƯỚC idempotency (2), giữ chỗ, ý định, thiết bị): hàng
 * rejected cho mỗi write, KHÔNG mang khoá (`nullKey` — khoá rỗng là của chung mọi lệnh không khoá); không gửi gì. Biến thể giống STOP / ghim lỗi đọc ⇒
 * hàng mang `ackValue.canhBao { khoa, lanThu, daPhat }` và cảnh báo khẩn (khử trùng theo bộ trong cửa sổ — `demCanhBaoKhongKhoa`).
 */
async function tuChoiThieuKhoa(db: LedgerDb, input: DispatchInput, pl: Exclude<PhanLoaiStopKhoa, { loai: "stop" }>): Promise<DispatchResult> {
  const ma = pl.loai === "giong_stop" ? MA_THIEU_KHOA_GIONG_STOP : pl.loai === "ghim_loi_doc" ? MA_THIEU_KHOA_GHIM_LOI_DOC : MA_THIEU_KHOA;
  const viSao =
    pl.loai === "giong_stop"
      ? "it writes a pinned STOP tag but is not a STOP"
      : pl.loai === "ghim_loi_doc"
        ? `the adapter's stop pins could not be read (${pl.loi}), so it cannot be proven a STOP`
        : null;
  const chiTiet = viSao ? `${CHI_TIET_THIEU_KHOA} (${viSao} — use the HMI machine stop, or resend with an idempotency key)` : CHI_TIET_THIEU_KHOA;
  // fix round 1 F2 (phán quyết điều phối) — cảnh báo KHẨN chỉ cho yêu cầu THẬT, GỬI ĐƯỢC: (a) uỷ quyền mà cổng (1) THỰC SỰ kiểm — interlock (đã qua
  // verifyInterlockAuthorization) hoặc HITL CÓ actionId (đã qua kiểm hành động / ràng buộc); HITL không actionId (không requireBoundAction) qua cổng (1) mà
  // không kiểm gì ⇒ không cảnh báo; (b) lệnh sẽ KHÔNG chạy thử — cùng vị từ bước (5) (`isOtControlEnabled()`, thuần, không tác dụng phụ). Không đủ ⇒ hàng
  // vẫn ghi như cũ, `canhBao { daPhat: false, boQua }`, KHÔNG chạm cửa sổ khử trùng. (Hạ cấp mô phỏng của bước 5a — chưa nghiệm thu — cần đọc DB, không xét.)
  const t = input.triggeredBy;
  const boQua: "khong_rang_buoc" | "chay_thu" | null =
    t.kind === "hitl" && !t.actionId ? "khong_rang_buoc" : !isOtControlEnabled() ? "chay_thu" : null;
  const canhBao =
    pl.loai === "thuong"
      ? null
      : boQua
        ? { khoa: boKhuTrungKhongKhoa(input), lanThu: 0, daPhat: false, batDau: 0, boQua }
        : { ...demCanhBaoKhongKhoa(boKhuTrungKhongKhoa(input)), boQua: undefined };
  console.warn(
    `[Dispatch] adapter ${input.adapterId}: ${ma} — "${input.commandType}" without an idempotency key refused, nothing sent (A2(a))${canhBao ? ` — alert ${canhBao.boQua ? `skipped (${canhBao.boQua})` : canhBao.daPhat ? "raised" : `deduplicated (#${canhBao.lanThu} in window)`}` : ""}`,
  );
  // F5 — đếm TRƯỚC (ở trên), phát trong `finally`: chèn sổ lỗi cũng không để cửa sổ câm (cửa sổ đã ghi nhận lần này ⇒ không lần nào khác phát thay).
  let ids: number[] = [];
  try {
    ids = await writeAll(db, input, "rejected", ma, chiTiet, undefined, undefined, {
      nullKey: true,
      ...(canhBao
        ? { ackExtra: { canhBao: { khoa: canhBao.khoa, lanThu: canhBao.lanThu, daPhat: canhBao.daPhat, ...(canhBao.boQua ? { boQua: canhBao.boQua } : {}) } } }
        : {}),
    });
  } finally {
    if (canhBao?.daPhat) {
      const who = actors(input);
      const kind = pl.loai === "giong_stop" ? "ot_keyless_stop_like_refused" : "ot_keyless_pin_unreadable_refused";
      const tags = [...new Set(input.writes.map((w) => String(w.tagKey)))].join(", ");
      // polish — chèn lỗi GIỮA một lô nhiều write ⇒ `ids` rỗng nhưng vài hàng có thể đã ghi: không khẳng định "không hàng nào"
      const so = ids.length > 0 ? `command_log #${ids.join(",")}` : "the refusal row(s) may NOT have been (fully) written to command_log";
      const tran =
        canhBao.khoa === KHOA_BAT_BUOC_CANH_BAO_TRAN
          ? ` The keyless-refusal alert table is full (${toiDaCanhBaoKhongKhoa} live entries): this is overflow refusal #${canhBao.lanThu} in this ${KHOA_BAT_BUOC_CANH_BAO_CUA_SO_MS / 1000}-second window; further overflow refusals in the window are NOT alerted one by one — their counts are in each row's canhBao.lanThu in command_log.`
          : "";
      void raiseOtStopAlert(
        kind,
        input,
        `OT command "${input.commandType}" for adapter ${input.adapterId} (tags: ${tags}) arrived WITHOUT an idempotency key and ${viSao} — the command was NOT sent (${so}). To stop the machine use the STOP path (HMI machine stop); otherwise resend the command with an idempotency key.${tran}`,
        [who.requestedBy, who.confirmedBy],
        `ot_keyless:${canhBao.khoa}:${canhBao.batDau}`,
        `Keyless OT command refused (not sent) — adapter ${input.adapterId}`,
      );
    }
  }
  return { ok: false, simulated: false, status: "rejected", reason: ma, results: failedResults(input, ma), commandLogIds: ids };
}

/** T6d — mã từ chối khi khoá đã dùng cho lệnh KHÁC (cùng mã với robot `IDEMPOTENCY_KEY_REUSED`). */
export const MA_KHOA_DUNG_LAI = "IDEMPOTENCY_KEY_REUSED";

/** T6d — từ chối lệnh (không STOP) mang khoá của lệnh khác: hàng sổ KHÔNG mang khoá (khoá thuộc lệnh kia — UNIQUE), ghi tham chiếu; không gửi gì. */
async function tuChoiKhoaDungLai(db: LedgerDb, input: DispatchInput, hangTrung: ReadonlyArray<CommandLog>): Promise<DispatchResult> {
  console.warn(`[Dispatch] adapter ${input.adapterId}: idempotency key already used by a different command (command_log #${hangTrung.map((r) => r.id).join(",")}) — refused, nothing sent (T6d)`);
  const ids = await writeAll(
    db,
    input,
    "rejected",
    MA_KHOA_DUNG_LAI,
    "idempotency key already used by a different command (another adapter, tag, value or caller) — not sent, the earlier result is not returned",
    undefined,
    undefined,
    { nullKey: true, ackExtra: { khoaDungLai: { commandLogIds: hangTrung.map((r) => r.id) } } },
  );
  return { ok: false, simulated: false, status: "rejected", reason: MA_KHOA_DUNG_LAI, results: failedResults(input, MA_KHOA_DUNG_LAI), commandLogIds: ids };
}

/**
 * T6d — từ chối lệnh (không STOP) mà khoá có hàng TRƯỚC T6d không chứng minh được cùng / khác lệnh: DUPLICATE_IN_FLIGHT (kết cục lần trước KHÔNG RÕ —
 * lớp "có thể đã bay" của T3F: FOE không gửi lại với khoá mới), hàng KHÔNG mang khoá, tham chiếu hàng cũ; không gửi gì. Vì sao không
 * IDEMPOTENCY_KEY_REUSED: mã ấy nghĩa "khoá thuộc một lệnh KHÁC đã chứng minh, lệnh này chưa gửi" và nằm trong lớp "có thể đã được áp" (lệnh khác có thể đã chạy):
 * FOE KHÔNG BAO GIỜ thử lại nó dưới khoá mới; STOP thì được đổi khoá và gửi thật. Ở đây hàng cũ có thể CHÍNH là lệnh này (đã áp trước nâng cấp) ⇒ không dùng mã ấy.
 */
async function tuChoiKhongChac(db: LedgerDb, input: DispatchInput, hang: ReadonlyArray<CommandLog>): Promise<DispatchResult> {
  const ids = hang.map((r) => r.id);
  const ghiIds = await writeAll(
    db,
    input,
    "rejected",
    "DUPLICATE_IN_FLIGHT",
    `idempotency key already used by pre-T6d ledger row(s) #${ids.join(",")} that carry no payload hash and cannot be proven to be this command — outcome of that attempt unknown, not sent`,
    undefined,
    undefined,
    { nullKey: true, ackExtra: { khoaKhongChac: { commandLogIds: ids } } },
  );
  return { ok: false, simulated: false, status: "rejected", reason: "DUPLICATE_IN_FLIGHT", results: failedResults(input, "DUPLICATE_IN_FLIGHT"), commandLogIds: ghiIds };
}

export type LyDoStopKhoaMoi = "khoa_lech" | "lan_truoc_khong_ok" | "dang_bay" | "khong_chac" | "khong_khoa";

/**
 * T6d — lý do gửi lại một STOP dưới khoá mới theo quyết định khoá; null ⇒ không cần (không có hàng, hoặc lần trước là STOP ĐÃ tới thiết bị: ok, không mô
 * phỏng ⇒ phát lại — mẫu robot residual 3: STOP chỉ phát lại một lần trước 'done').
 * T6d fix 2 — STOP KHÔNG khoá (`""`): khoá ghi của nó (`v2:0::<tag>:<idx>`) là của CHUNG mọi lệnh không khoá ⇒ hàng tìm thấy không bao giờ là "lần trước của
 * CHÍNH STOP này" ⇒ có hàng nào ⇒ gửi dưới khoá mới (`khong_khoa`), không bao giờ phát lại (STOP không khoá thứ hai sau một STOP ok vẫn ra thiết bị).
 */
function lyDoStopKhoaMoi(qd: QuyetDinhKhoa, kqPhatLai: DispatchResult | null, khongKhoa: boolean): LyDoStopKhoaMoi | null {
  if (khongKhoa && qd.loai !== "khong") return "khong_khoa";
  if (qd.loai === "lech") return "khoa_lech";
  if (qd.loai === "dang_bay") return "dang_bay";
  if (qd.loai === "khong_chac") return "khong_chac";
  if (qd.loai === "phat_lai" && kqPhatLai && !(kqPhatLai.ok && !kqPhatLai.simulated)) return "lan_truoc_khong_ok";
  return null;
}

/** T6d — các hàng lần trước mà một STOP gửi lại tham chiếu. */
function hangCuaQuyetDinh(qd: QuyetDinhKhoa): CommandLog[] {
  if (qd.loai === "lech") return qd.hangTrung;
  if (qd.loai === "dang_bay" || qd.loai === "khong_chac") return qd.hang;
  if (qd.loai === "phat_lai") return qd.hangLo.filter((r): r is CommandLog => !!r);
  return [];
}

/**
 * T6d — STOP với khoá của lệnh khác / đang bay / lần trước không tới thiết bị: GỬI THẬT dưới khoá MỚI (khoá gốc thuộc lần trước — UNIQUE), mọi hàng ghi
 * tham chiếu `ackValue.lanTruoc`. Mẫu robot (R-1C-i + residual 3): một STOP thừa vô hại, một STOP bị nuốt thì không. Mọi cổng sau vẫn áp.
 */
function stopGuiLaiVoiKhoaMoi(input: DispatchInput, hangTruoc: ReadonlyArray<CommandLog>, lyDo: LyDoStopKhoaMoi): DispatchInput {
  const ids = hangTruoc.map((r) => r.id);
  console.warn(`[Dispatch] STOP on adapter ${input.adapterId}: idempotency key already used (${lyDo}, command_log #${ids.join(",")}) — not a replay, STOP sent under a new key (T6d)`);
  return {
    ...input,
    idempotencyKey: `${input.idempotencyKey}#stop-${randomUUID()}`,
    ghiChuKhoa: { ...(input.ghiChuKhoa ?? {}), lanTruoc: { idempotencyKey: input.idempotencyKey, commandLogIds: ids, lyDo } },
  };
}

/**
 * R1b-2b-2a T6c (AN TOÀN, dieu-phoi 2026-11-01) — câu trả lời PHÁT LẠI theo khoá idempotency = câu trả lời SỐNG (ok / status / reason / motPhan) cho mọi
 * tổ hợp lô. Trước: chỉ đọc hàng 0 ⇒ lô `timeout` trộn có hàng 0 acked được phát lại là `ok: true` (THÀNH CÔNG giả). Nay:
 *   • `ackValue.motPhan` trên bất kỳ hàng nào (T3E) ⇒ cùng kết cục MOT_PHAN như trước;
 *   • lô thiết bị (mọi hàng có status thiết bị) HOẶC có dấu `ackValue.khongRo` ⇒ `ketCucLo` (CÙNG hàm với đường sống) trên MỌI write: write không có hàng
 *     ⇒ `timeout` (không rõ — fail-closed); dấu `khongRo` ⇒ `timeout` dù gì đi nữa (dấu thắng). Hàng ghi TRƯỚC bản vá (không dấu) được suy từ trạng thái
 *     mọi hàng: có hàng không ok ⇒ không bao giờ `ok: true`; có hàng `timeout` ⇒ `timeout`; acked + failed ⇒ `failed` MOT_PHAN (không gửi lại);
 *   • lô KHÔNG phải thiết bị (rejected / simulated / `failed` không gửi gì như ADAPTER_OFFLINE): status của hàng đọc được, `reason` = MÃ tiền tố của
 *     errorText (= `reason` sống, polish m1), fail-closed: `ok` chỉ khi MỌI hàng có của lô ok;
 *   • polish 2 (re-review Important): hàng CŨ không `ackValue.ledger` mà có status thiết bị = hàng thiết bị (trừ tiền tố `MA_THAT_BAI_KHONG_GUI`);
 *     ở nhánh không-thiết-bị, write KHÔNG có hàng ⇒ `timeout`, không bao giờ ok (trừ lô mà mọi hàng có đều `rejected`: từ chối một write, không gì được gửi).
 * Hàm thuần — xuất cho test.
 */
export function ketQuaPhatLai(input: DispatchInput, existing: CommandLog, hangLo: ReadonlyArray<CommandLog | undefined>): DispatchResult {
  const coMat = hangLo.filter((r): r is CommandLog => !!r);
  const hang = coMat.length > 0 ? coMat : [existing];
  const av = (r: CommandLog) => (r.ackValue ?? null) as { ledger?: unknown; pinnedStop?: unknown; motPhan?: unknown; khongRo?: unknown } | null;
  const ids = hang.map((r) => r.id);
  // fix round 1 (R-1D-h) — a replayed PINNED stop still says so (its ledger row carries ackValue.pinnedStop).
  const replayedPinnedStop = hang.some((r) => av(r)?.pinnedStop === true);
  const ghim = replayedPinnedStop ? { pinnedStop: true } : {};
  const ketQuaMotPhan = (motPhan: MotPhan): DispatchResult => ({
    ok: false,
    simulated: false,
    status: "failed",
    reason: MA_MOT_PHAN,
    results: input.writes.map((w) => {
      const ap = motPhan.daAp.includes(w.tagKey);
      return { tagKey: w.tagKey, ok: ap, status: ap ? ("acked" as const) : ("failed" as const), ...(ap ? {} : { error: MA_MOT_PHAN }) };
    }),
    commandLogIds: ids,
    motPhan,
    message: `Command "${input.commandType}" (replayed from the ledger): ${moTaMotPhan(motPhan)}.`,
    ...ghim,
  });
  // R1b-2b-2a T3E (backlog 90) — a batch applied PARTLY: every result row carries ackValue.motPhan ⇒ the SAME partial outcome (never ok, never resent).
  for (const r of hang) {
    const mp = motPhanCua(av(r)?.motPhan);
    if (mp) return ketQuaMotPhan(mp);
  }
  const khongRo = hang.some((r) => av(r)?.khongRo === true);
  // T6c polish (review m1) — lô THIẾT BỊ = mọi hàng có status thiết bị VÀ là hàng KẾT QUẢ của đường ghi (`ackValue.ledger === "result"`, đường sống luôn
  // ghi). Hàng từ chối / `failed` không gửi gì (`writeFailed` ADAPTER_OFFLINE: không `ackValue`) ⇒ nhánh không-thiết-bị (giữ `reason` = mã như đường sống).
  // T6c polish 2 (re-review Important) — hàng KHÔNG `ackValue.ledger` (hàng cũ trước sổ ghi trước, hoặc hàng ghi không qua sổ; T6d chỉ thêm `bam`, không thêm
  // `ledger`) mang status thiết bị cũng là hàng thiết bị ⇒ CÙNG `ketCucLo`
  // (legacy [acked, failed] ⇒ failed MOT_PHAN như đường sống), TRỪ khi errorText mang tiền tố mã của một thất bại KHÔNG gửi (`MA_THAT_BAI_KHONG_GUI`).
  const hangThietBi = (r: CommandLog): boolean => {
    if (!TRANG_THAI_HANG_THIET_BI.has(r.status)) return false;
    const ledger = av(r)?.ledger;
    if (ledger === "result") return true;
    if (ledger !== undefined && ledger !== null) return false; // vai khác của sổ ghi (refused_duplicate / late_result …) — giữ như polish 1
    const ma = maTienTo(r.errorText);
    return !(ma && MA_THAT_BAI_KHONG_GUI.has(ma));
  };
  const thietBi = hang.every(hangThietBi);
  if (khongRo || thietBi) {
    const outcomes = input.writes.map((w, i) => {
      const r = hangLo[i];
      return r ? { tagKey: w.tagKey, ok: TRANG_THAI_HANG_OK.has(r.status), status: r.status as DispatchStatus } : { tagKey: w.tagKey, ok: false, status: "timeout" as DispatchStatus };
    });
    const lo = ketCucLo(outcomes, khongRo);
    if (lo.motPhan) return ketQuaMotPhan(lo.motPhan);
    const ok = lo.ok && !khongRo; // dấu "không rõ" thắng
    const status = (khongRo ? "timeout" : lo.status) as DispatchStatus;
    return {
      ok,
      simulated: false,
      status,
      results: input.writes.map((w, i) => {
        const r = hangLo[i];
        return { tagKey: w.tagKey, address: r?.address ?? undefined, ok: outcomes[i]!.ok, status: outcomes[i]!.status, error: r ? (r.errorText ?? undefined) : "no result row in the ledger — outcome unknown" };
      }),
      commandLogIds: ids,
      ...ghim,
    };
  }
  // T6c polish 2 (re-review Important) — write KHÔNG có hàng ⇒ không biết nó ra sao ⇒ `timeout`, KHÔNG BAO GIỜ `ok` (cùng luật nhánh thiết bị). Ngoại lệ DUY
  // NHẤT: mọi hàng có đều `rejected` — từ chối một write (TAG_NOT_FOUND / TAG_NOT_WRITABLE / cổng kênh: `writeRejected` `onlyTagKey`) chỉ ghi hàng của write
  // ấy, các write khác KHÔNG được gửi (từ chối luôn đứng TRƯỚC khi gửi) ⇒ giữ `rejected` + mã như đường sống.
  const thieuHang = coMat.length < input.writes.length && !coMat.every((r) => r.status === "rejected");
  const cachedOk = !thieuHang && TRANG_THAI_HANG_OK.has(existing.status) && hang.every((r) => TRANG_THAI_HANG_OK.has(r.status));
  // T6c polish (review m1) — `reason` của đường sống là MÃ (`writeAll` / `writeSimulated` ghi `${mã}: ${chi tiết}`) ⇒ phát lại trả lại MÃ đó, không phải văn
  // bản đầy đủ; văn bản không tiền tố mã ⇒ giữ nguyên (hàng lạ). Một hàng `timeout` (hàng cũ không `ackValue`) ⇒ `timeout` (fail-closed).
  const ma = maTienTo(existing.errorText);
  return {
    ok: cachedOk,
    simulated: existing.status === "simulated",
    status: thieuHang || hang.some((r) => r.status === "timeout") ? "timeout" : existing.status,
    reason: ma ?? existing.errorText ?? undefined,
    results: input.writes.map((w, i) =>
      thieuHang && !hangLo[i]
        ? { tagKey: w.tagKey, ok: false, status: "timeout" as DispatchStatus, error: "no result row in the ledger — outcome unknown" }
        : { tagKey: w.tagKey, address: existing.address ?? undefined, ok: cachedOk, status: existing.status, error: existing.errorText ?? undefined },
    ),
    commandLogIds: ids,
    ...ghim,
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
  opts: {
    pinnedStop?: boolean;
    /**
     * SCADA R1a Task 3 — a second form of the SAME writes (the caller's raw values when `input` carries the step-3b coerced
     * ones). The stored hash may match either; every other field (tool/adapter/machine/commandType) comes from `input`.
     */
    altWrites?: ReadonlyArray<DispatchWrite>;
    /**
     * R1b-2b-2a A2(h) AMENDMENT 2 — GATE (1) ONLY, never the reservation: an 'executed' (spent) row is accepted — status and expiry not
     * checked for it — when EVERYTHING else holds (owner, tool, engine self-approval, payload hash). Such a command only goes on to the
     * idempotency step (2) (replay / DUPLICATE_IN_FLIGHT / IDEMPOTENCY_KEY_REUSED / MOT_PHAN of the attempt that spent the row); it can never
     * be written: the reservation verifies WITHOUT this flag and consumes only a 'confirmed' row. Any other status ⇒ refused as before.
     */
    daTieuChoBuoc2?: boolean;
  } = {},
): BindingVerdict {
  if (!pending) return { ok: false, reason: "NOT_CONFIRMED", detail: "HITL action not found" };
  const daTieuQua = opts.daTieuChoBuoc2 === true && pending.status === "executed";
  if (pending.status !== "confirmed" && !daTieuQua) {
    return {
      ok: false,
      reason: "NOT_CONFIRMED",
      detail: `HITL action status is '${pending.status}' — only a 'confirmed' action authorises a write, exactly once`,
    };
  }
  if (!daTieuQua && pending.expiresAt.getTime() <= Date.now()) {
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
  const altMatches = () =>
    !!opts.altWrites &&
    stored ===
      otPayloadHash({
        tool: pending.tool,
        adapterId: input.adapterId,
        machineId: input.machineId ?? null,
        commandType: input.commandType,
        writes: opts.altWrites,
      });
  if (stored !== expected && !altMatches()) {
    return {
      ok: false,
      reason: "ACTION_BINDING_MISMATCH",
      detail: "HITL action was confirmed for a different adapter/machine/command/tag/value",
    };
  }
  return { ok: true, owner: pending.userId };
}

/**
 * R1b-2b-2a A2(k) (AN TOÀN, defence in depth) — reason code of the reservation: the orchestration-engine row minted for THIS very key is already
 * spent ('executed') and the key has no row at all (no intent, no result). Inside the reservation that state cannot come from central's own
 * reservation (it consumes the row and writes the intent in ONE transaction), so the row was spent elsewhere — the edge's /authorize writes it
 * 'executed' under the same `foe-<key>` id (edgeAuthorizeCentral) — and the write may already have reached the device through that path.
 * It is in the "may have flown" class (`equipment/lenhTruocCoTheDaBay.ts`): FOE does not resend, fails the step, runs its compensation and fails
 * the run (no alert, no held run). NOT_CONFIRMED (FOE: "not flown" ⇒ retried under a new attempt key) stays the answer for every other spent row.
 */
export const MA_HANG_FOE_DA_TIEU = "FOE_ROW_SPENT_FOR_KEY";

/**
 * R1b-2b-2a A2(k) — PURE. Called ONLY by the reservation, ONLY after `verifyActionBinding` refused a row whose status is 'executed' (no row exists
 * under the key at that point: `qd.loai === "khong"`). The refusal detail of `MA_HANG_FOE_DA_TIEU` when ALL hold, else null (the refusal stays
 * NOT_CONFIRMED exactly as before):
 *   (k1) the command is NOT a STOP for key purposes: `laStopKhoa === false`, the dispatcher's own flag (absent ⇒ null) — a STOP is never put in
 *        the "may have flown" class (L-7);
 *   (k2) the row is an orchestration-engine row (`FOE_ENGINE_TOOL`);
 *   (k3) the row was minted for THIS key (`orchestrationActionId(key)`) — a spent id replayed / forged under another key (the Sparkplug / HMI
 *        reuse shape) stays NOT_CONFIRMED;
 *   (k4) everything else in the binding holds (owner, tool, engine self-approval, payload hash): `verifyActionBinding` with `daTieuChoBuoc2` —
 *        READ ONLY: nothing is consumed and nothing is ever written on this answer (the reservation still consumes only a 'confirmed' row);
 *   (k5) the row is not an A2(m) fresh pinned-STOP row (`hangMoiStopGhim`) — those keep A2(m)'s rule.
 */
export function lyDoHangFoeDaTieuChoKhoa(
  pending: AiPendingAction | undefined,
  bindingInput: DispatchInput,
  khoa: string,
  t: HitlTrigger,
  opts: { laStopKhoa?: boolean; altWrites?: ReadonlyArray<DispatchWrite> } = {},
): string | null {
  if (!pending || pending.status !== "executed") return null;
  if (opts.laStopKhoa !== false) return null; // (k1)
  if (pending.tool !== FOE_ENGINE_TOOL) return null; // (k2)
  if (pending.id !== orchestrationActionId(khoa)) return null; // (k3)
  if (laHangMoiStopGhim(pending.previewJson)) return null; // (k5)
  if (!verifyActionBinding(pending, bindingInput, t, { daTieuChoBuoc2: true, altWrites: opts.altWrites }).ok) return null; // (k4)
  return `orchestration action ${pending.id} was minted for this very idempotency key and is already spent, yet the key has no write-ahead intent — the write may already have reached the device through another path (an edge node); not sent, and not to be retried under a new key`;
}

/** R1b-2b-2a A2(m) AMENDMENT 2 — the refusal detail of a marked fresh FOE STOP row presented by a command this dispatcher does not classify as a pinned STOP. */
export const HANG_MOI_STOP_GHIM_TU_CHOI =
  "orchestration action is a fresh STOP authorisation (hangMoiStopGhim) but this command is not a pinned STOP for the dispatcher — refused (it authorises only a pinned STOP)";

/** Advisory-lock namespace so OT command keys never share a lock with another subsystem. */
const OT_COMMAND_LOCK_NS = "ot.command:";

/**
 * The intent row's key — derived deterministically from the result row's per-write key.
 * R1b-2b-2a T6d — UNCHANGED form `intent:<result key>`, now over the unambiguous `v2:` result key (`perWriteKey`): every result key starts with
 * `v2:` and every intent key with `intent:` ⇒ the two never collide, and no caller base can produce another base's intent key (before: base
 * `intent:X` gave a RESULT key equal to base `X`'s INTENT key). The prefix is kept because the DB function `ot_write_intent_resolve` (mig 0374)
 * derives the manual resolution's result key as `substr(intentKey, 8)` — with `intent:` it yields exactly the v2 result key (no migration). The same
 * function reads pre-T6d intents (`intent:<base>:<tag>:<idx>`) from their pre-T6d result keys (`perWriteKeyCu`).
 */
function intentKeyFor(resultKey: string): string {
  // fix round 1 — prefix + short hash when too long (was a bare 128-char cut that dropped the
  // ':<idx>' suffix ⇒ all writes of a long-key command shared ONE intent key).
  return boundedKey(`intent:${resultKey}`);
}

type Reservation =
  | { ok: true; intentIds: number[]; boundConfirmer: number | null }
  | { ok: false; result: DispatchResult }
  /** R1b-2b-2a T6d — chỉ khi `opts.laStop`: khoá đã bị lệnh khác / lượt đang bay / lượt không tới thiết bị giữ ⇒ bên gọi gửi lại STOP dưới khoá mới. */
  | { ok: false; doiKhoaStop: { hang: CommandLog[]; lyDo: LyDoStopKhoaMoi } };

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
    /** SCADA R1a Task 3 — the caller's RAW writes (before step-3b coercion): the binding may match these OR `bindingInput`'s. */
    rawBindingWrites?: ReadonlyArray<DispatchWrite>;
    /** R1b-2b-2a T6d — this command is a STOP (type, pin or pinned content): a taken key ⇒ `doiKhoaStop` (re-sent under a new key), never swallowed. */
    laStop?: boolean;
    /**
     * R1b-2b-2a A2(k) — the SAME STOP-for-key-purposes flag as `laStop`, but passed to BOTH reservation calls (the re-keyed STOP call gets no
     * `laStop`): `false` is required for `MA_HANG_FOE_DA_TIEU` (k1); absent ⇒ treated as a STOP (NOT_CONFIRMED as before).
     */
    laStopKhoa?: boolean;
  } = {},
): Promise<Reservation> {
  const resultKeys = resolved.map((r, i) => perWriteKey(input.idempotencyKey, r.write.tagKey, i));
  const intentKeys = resultKeys.map(intentKeyFor);
  // doc 81 Đợt 8 final wave (review O M2) — an orchestration action's controller program checksums are read HERE, before
  // the reservation transaction (bounded 1 s, concurrent, single-flight): no pool connection, advisory lock or FOR UPDATE
  // row is held while a controller is read. A PINNED stop reads nothing (L-7). L-7 statement (O M6): an UNPINNED
  // stop-typed write of such a run may be refused or delayed ≤ 1 s by this read (R-4-x: it is not a verified stop).
  // final wave NF-4 — a DUPLICATE costs nothing: a lock-free probe of the same two keys the transaction checks first; a prior
  // intent / result ⇒ no controller read (the transaction answers cached / DUPLICATE_IN_FLIGHT before any approval check).
  // The probe is only an optimisation: it decides nothing. Probe error / a race ⇒ the pre-read runs, or the transaction reads
  // live (bounded) exactly as before — fail-closed semantics unchanged.
  let prePrograms: PreReadPrograms | undefined;
  if (input.triggeredBy.kind === "hitl" && input.triggeredBy.actionId && opts.pinnedStop !== true) {
    const duplicate = await db
      .select({ id: commandLog.id })
      .from(commandLog)
      .where(inArray(commandLog.idempotencyKey, [resultKeys[0], intentKeys[0]]))
      .limit(1)
      .then((r) => r.length > 0, () => false);
    if (!duplicate) prePrograms = await preReadProgramChecksForAction(db, input.triggeredBy.actionId, FOE_ENGINE_TOOL);
  }
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${OT_COMMAND_LOCK_NS + input.idempotencyKey}))`);

      // R1b-2b-2a T6d — dưới khoá tư vấn: MỌI hàng của khoá (kết quả + ý định, khoá mới + cũ); CÙNG chốt `quyetDinhKhoa` với bước 2 (chống đua).
      const qd = quyetDinhKhoa(input, input.bamLenh ?? bamLenhOt(input), nguoiGoiKhoa(input), await hangTheoKhoa(tx, input));
      const kqPhatLai = qd.loai === "phat_lai" ? ketQuaPhatLai(input, qd.existing, qd.hangLo) : null;
      const lyDoStop = opts.laStop ? lyDoStopKhoaMoiCho(qd, kqPhatLai, input.idempotencyKey) : null;
      if (lyDoStop) return { ok: false as const, doiKhoaStop: { hang: hangCuaQuyetDinh(qd), lyDo: lyDoStop } };
      if (kqPhatLai) return { ok: false as const, result: kqPhatLai };
      if (qd.loai === "lech") return { ok: false as const, result: await tuChoiKhoaDungLai(tx, input, qd.hangTrung) };
      if (qd.loai === "khong_chac") return { ok: false as const, result: await tuChoiKhongChac(tx, input, qd.hang) };
      if (qd.loai === "dang_bay") {
        const prior = qd.hang;
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

      // doc 81 Đợt 10 task D fix review 3 (scan #73) — WHO OWNS THE ADAPTER, under this transaction (FOR SHARE), before any
      // approval is consumed: an edge-owned adapter is never written by central (a session not yet detached is not authority).
      // L-7: a PINNED stop is never gated (otAdapterOwnerGate returns null without reading).
      const edgeOwned = await adapterOwnedByEdgeInTx(tx, input.adapterId, { pinnedStop: opts.pinnedStop === true });
      if (edgeOwned) {
        const ids = await writeRejected(tx, input, edgeOwned.code, edgeOwned.detail);
        return {
          ok: false as const,
          result: { ok: false, simulated: false, status: "rejected" as const, reason: edgeOwned.code, results: failedResults(input, edgeOwned.code), commandLogIds: ids },
        };
      }

      let boundConfirmer: number | null = null;
      if (input.triggeredBy.kind === "hitl") {
        const t = input.triggeredBy;
        let verdict: BindingVerdict | { ok: false; reason: "PRECONDITION_FAILED" | typeof MA_HANG_FOE_DA_TIEU; detail: string };
        if (!t.actionId) {
          verdict = { ok: false, reason: "PRECONDITION_FAILED", detail: "real OT write requires a bound, confirmed, single-use HITL actionId (none supplied)" };
        } else {
          const [pending] = await tx
            .select()
            .from(aiPendingActions)
            .where(eq(aiPendingActions.id, t.actionId))
            .for("update");
          verdict = verifyActionBinding(pending, opts.bindingInput ?? input, t, { pinnedStop: opts.pinnedStop === true, altWrites: opts.rawBindingWrites });
          // R1b-2b-2a A2(k) (defence in depth) — a SPENT row and no row under the key (guaranteed here): when the spent row is the FOE row minted
          // for THIS key and bound to THIS non-STOP command (k1..k5, `lyDoHangFoeDaTieuChoKhoa` — read only), it was spent elsewhere (the edge) and the
          // write may have flown ⇒ MA_HANG_FOE_DA_TIEU (FOE: do not resend under a new key), ledgered below like every refusal. Otherwise NOT_CONFIRMED.
          if (!verdict.ok && pending?.status === "executed") {
            const daTieu = lyDoHangFoeDaTieuChoKhoa(pending, opts.bindingInput ?? input, input.idempotencyKey, t, { laStopKhoa: opts.laStopKhoa, altWrites: opts.rawBindingWrites });
            if (daTieu) verdict = { ok: false, reason: MA_HANG_FOE_DA_TIEU, detail: daTieu };
          }
          // R1b-2b-2a A2(m) AMENDMENT 2 — a FRESH row the FOE engine minted for a command IT classified as a pinned STOP (marked) is consumed ONLY by
          // a pinned STOP THIS dispatcher confirms (opts.pinnedStop, its own step-3 verdict). Not pinned here (stale connection, pins changed,
          // value form) ⇒ REFUSED, with or without a real gate approval: one approval = one write stays absolute for every non-pinned command.
          if (verdict.ok && laHangMoiStopGhim(pending?.previewJson) && opts.pinnedStop !== true) {
            verdict = { ok: false, reason: "NOT_CONFIRMED", detail: HANG_MOI_STOP_GHIM_TU_CHOI };
          }
          // doc 81 Đợt 4 fix round 1 (R-4-i) — an orchestration-engine action: re-derive the run owner and the gate
          // approver from the DB rows (run + gate + workflow) under this transaction; previewJson only points at the run.
          // A PINNED stop is exempt (L-7).
          if (verdict.ok && pending?.tool === FOE_ENGINE_TOOL && opts.pinnedStop !== true) {
            const refusal = await foeApprovalDbRefusal(tx, pending, t.requestedBy, prePrograms);
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
            ackValue: { ledger: "intent", ...ackKhoa(input), ...(opts.ledgerExtra ?? {}) } as any, // T6d — + bam (chốt phát lại)
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
 *   - kiem-dinh R1b-1 I1 (a): the approval is still in force — current source/target tag definition hash == rule.approvedDefHash
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
  // kiem-dinh R1b-1 I1 (a) — the approval only holds while the source / target tag definitions (address, type, scale/offset, adapter, the
  // adapter's edge node) still hash to what was captured at approval (approvedDefHash, mig 0434). Mismatch / no hash (approved before 0434) /
  // unreadable ⇒ NOT approved (fail-closed), same code as above.
  if (!(await luatDuyetConHieuLuc(db as never, rule))) {
    return {
      ok: false,
      reason: "INTERLOCK_NOT_APPROVED",
      detail: "Rule source/target tag definition changed since approval (or approved before mig 0434) — re-approve",
    };
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
  if (canonicalOtValue(input.writes[0].value) !== canonicalOtValue(giaTriLenhInterlock(rule))) {
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
        ackValue: ackKhoa(input) as any, // R1b-2b-2a T6d — bam (chốt phát lại)
        // fix round 1 A2(a) F1 — hàng MÔ PHỎNG (không gửi, không gắn ý định) của lệnh không khoá ⇒ khoá NULL (cùng lý do với `writeAll`).
        idempotencyKey: laKhoaRong(input.idempotencyKey) ? null : perWriteKey(input.idempotencyKey, r.write.tagKey, results.length),
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
  // SCADA R1a T3 fix round 1 (M-1) — each row keeps the ORIGINAL write index in its per-write key (was the index in the
  // filtered list: a refusal of write #1 took key `K:<tag>:0`, which the step-2 probe never looks for ⇒ a retry with the same
  // key re-ran the gates and hit the unique constraint). Unfiltered calls are byte-identical (index === original index).
  const indexed = input.writes.map((w, idx) => ({ w, idx }));
  const writes = onlyTagKey ? indexed.filter((e) => e.w.tagKey === onlyTagKey) : indexed;
  const list = writes.length > 0 ? writes : [{ w: { tagKey: null as any, value: null }, idx: 0 }];
  // fix round 1 A2(a) F1 (AN TOÀN) — lệnh KHÔNG khoá (khoá rỗng sau chuẩn hoá, kể cả chỉ khoảng trắng — cùng định nghĩa "không khoá" với bước (1b)): MỌI hàng
  // không gắn ý định ghi trước (từ chối / thất bại trước thiết bị) mang khoá NULL. Trước: `perWriteKey("", tag, idx)` KHÔNG chứa adapter mà
  // `command_log_idempotencyKey_unique` là UNIQUE TOÀN BẢNG ⇒ lời từ chối không khoá THỨ HAI cùng tag + chỉ số (mọi adapter) vỡ UNIQUE ⇒ dispatch() NÉM.
  // UNIQUE cho phép nhiều NULL; mọi truy vấn phát lại tìm theo `IN (<khoá chuỗi>)` nên không bao giờ thấy hàng NULL. Hàng gắn ý định (`link.intentIds`) — STOP
  // không khoá ĐÃ bay — giữ khoá như trước (fix 2: `v2:0::…` hoặc `#stop-<uuid>`). Mã / lý do không đổi.
  const khongKhoaSo = link?.nullKey === true || (laKhoaRong(input.idempotencyKey) && !(link?.intentIds && link.intentIds.length > 0));
  for (let i = 0; i < list.length; i++) {
    const { w, idx } = list[i];
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
        // R1b-2b-2a T6d — MỌI hàng mang `ackValue.bam` (chốt phát lại theo đúng lệnh); trước T6d hàng không liên kết không có `ackValue`.
        ackValue: (link?.intentIds && link.intentIds.length > 0
          ? { ledger: link.nullKey ? "refused_duplicate" : "result", intentId: link.intentIds[Math.min(i, link.intentIds.length - 1)], ...ackKhoa(input), ...(link.ackExtra ?? {}) }
          : { ...ackKhoa(input), ...(link?.ackExtra ?? {}) }) as any,
        idempotencyKey: khongKhoaSo ? null : perWriteKey(input.idempotencyKey, w.tagKey ?? "_", idx),
      })
      .returning({ id: commandLog.id });
    ids.push(row.id);
  }
  return ids;
}

/**
 * doc 81 Đợt 10 final fix wave (I-4, R-10-br) — the dispatcher found NO driver for the adapter. If an EDGE node owns it (mig 0374,
 * read with otAdapterOwnerGate's reader — a DB without 0374 has no edge owners ⇒ null), central never answers ADAPTER_OFFLINE:
 *   • a STOP-typed command (stop / e_stop: console, interlock F5b auto-block, a central run's abort) ⇒ an adapter STOP request
 *     QUEUED for the owning node (edgeNodeCommands, delivered on its next pull; never expired; the undelivered-STOP sweep alerts
 *     past the ack bound) + a durable alert now; the queue refusing / failing ⇒ central's fallback STOP of the adapter's PINNED
 *     values on a transient session (R-10-ay, deviceOwnershipService.sendCentralAdapterStop) + a critical alert;
 *   • any other write ⇒ refused with the explicit ADAPTER_OWNED_BY_EDGE (the edge node is the only writer).
 * The result is never ok (central did not execute THIS command); the ledger row names the request / the fallback. null ⇒ not
 * edge-owned (or the owner could not be read: the caller's ADAPTER_OFFLINE stands, a STOP is alerted).
 */
async function routeEdgeOwnedAdapterCommand(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, input: DispatchInput): Promise<DispatchResult | null> {
  const routedAt = Date.now(); // residual 2 — the reply bound counts from here
  const stop = isStopCommandType(input.commandType);
  let owner: Awaited<ReturnType<typeof adapterOwnedByEdgeInTx>>;
  try {
    owner = await adapterOwnedByEdgeInTx(db, input.adapterId);
  } catch (err) {
    if (stop) {
      void raiseOtStopAlert("ot_stop_owner_unknown", input, `OT ${input.commandType} for adapter ${input.adapterId}: central holds no driver and the adapter's owner could not be read (${String((err as Error)?.message ?? err).slice(0, 160)}) — the STOP was NOT routed. Use the machine's E-STOP if it is still running.`);
    }
    return null;
  }
  if (!owner) return null;
  if (!stop) {
    const ids = await writeRejected(db, input, owner.code, owner.detail);
    return { ok: false, simulated: false, status: "rejected", reason: owner.code, results: failedResults(input, owner.code), commandLogIds: ids, message: owner.detail };
  }
  const who = actors(input);
  const via = input.triggeredBy.kind === "interlock" ? `interlock rule #${input.triggeredBy.ruleId}` : "console / run";
  try {
    const cmds = await import("../edge/edgeNodeCommands");
    const { enqueueEdgeDeviceRequest } = cmds;
    const q = await enqueueEdgeDeviceRequest({ kind: "stop", adapterId: input.adapterId, reason: `central OT ${input.commandType} (${via})`, requestedBy: who.requestedBy });
    const detail = `adapter ${input.adapterId} is owned by edge node ${q.edgeNodeId}: STOP queued for it as request #${q.requestId} (delivered on its next pull — central holds no driver)`;
    // residual MIN-2 (R-10-bt, I-3 parity) + residual 2 (R-10-bu) — the owning node is UNREACHABLE (no pull / stale heartbeat /
    // unreadable) ⇒ central's fallback STOP (the adapter's PINNED values, transient session) AT ONCE + the stop_undelivered alert.
    // Both under the 2 s reply bound of a console STOP (from routing entry): the reachability read ≤ STOP_DB_STEP_DEADLINE_MS
    // (slower / failed ⇒ unreadable ⇒ unreachable); a fallback still running at the bound continues in the BACKGROUND and the
    // answer says so (partial); a late failure of it is alerted again.
    let fallbackText = "";
    const { STOP_DB_STEP_DEADLINE_MS } = await import("../robot/stopJob");
    const replyBoundMs = 2 * STOP_DB_STEP_DEADLINE_MS;
    const reach = await withDeadline(Promise.resolve().then(() => cmds.edgeNodeReachability(q.edgeNodeId)), STOP_DB_STEP_DEADLINE_MS, `edge node ${q.edgeNodeId} reachability`).catch(
      () => ({ reachable: false, basis: "unreadable" as const, ageMs: null }),
    );
    if (!reach.reachable) {
      type Fb = { ok: boolean; sent: string; detail: string };
      const leg: { v: { state: "pending" } | { state: "done"; value: Fb } } = { v: { state: "pending" } };
      const run = (async (): Promise<Fb> => {
        try {
          const { sendCentralAdapterStop } = await import("../robot/deviceOwnershipService");
          return await sendCentralAdapterStop(input.adapterId);
        } catch (e) {
          return { ok: false, sent: "failed", detail: String((e as Error)?.message ?? e).slice(0, 160) };
        }
      })().then((value) => {
        leg.v = { state: "done", value };
        return value;
      });
      let t: NodeJS.Timeout | undefined;
      await Promise.race([run, new Promise<void>((r) => (t = setTimeout(r, Math.max(0, replyBoundMs - (Date.now() - routedAt)))))]);
      clearTimeout(t);
      const lv = leg.v;
      const fbText = lv.state === "done" ? (lv.value.ok && lv.value.sent === "sent" ? "sent" : `${lv.value.sent} (${lv.value.detail})`) : "still in progress (continues in the background)";
      fallbackText = `; edge node ${q.edgeNodeId} is UNREACHABLE from central (${reach.basis}) — central fallback STOP: ${fbText}`;
      void raiseOtStopAlert("stop_undelivered", input, `STOP request #${q.requestId} for adapter ${input.adapterId} is queued for edge node ${q.edgeNodeId}, which is UNREACHABLE from central (${reach.basis}) — central fallback STOP: ${fbText}. Use the machine's E-STOP if it is still running.`, [who.requestedBy], `stop_undelivered:request:${q.requestId}`);
      if (lv.state === "pending") {
        void run.then((late) => {
          if (late.ok && late.sent === "sent") return;
          console.error(`[Dispatch] CRITICAL: the central fallback STOP of adapter ${input.adapterId} (edge node ${q.edgeNodeId} unreachable) finished WITHOUT success: ${late.sent} (${late.detail})`);
          void raiseOtStopAlert("stop_undelivered", input, `STOP request #${q.requestId} for adapter ${input.adapterId}: the central fallback STOP finished WITHOUT success (${late.sent}: ${late.detail}). Use the machine's E-STOP now.`, [who.requestedBy], `stop_undelivered:request:${q.requestId}:late`);
        });
      }
    }
    const ids = await writeRejected(db, input, owner.code, detail + fallbackText);
    void raiseOtStopAlert("ot_stop_routed_to_edge", input, `OT ${input.commandType} for adapter ${input.adapterId} (${via}) was NOT executed by central: ${detail}${fallbackText}. Confirm it on the edge node; an unacknowledged STOP raises a further alert.`, [who.requestedBy], `ot_stop_routed_to_edge:request:${q.requestId}`);
    return { ok: false, simulated: false, status: "rejected", reason: owner.code, results: failedResults(input, owner.code), commandLogIds: ids, message: detail + fallbackText, edgeStopRequest: { requestId: q.requestId, edgeNodeId: q.edgeNodeId } };
  } catch (err) {
    // R-10-ay — never silence: central's fallback STOP (the adapter's PINNED values, transient session, bounded) + critical alert
    const why = String((err as Error)?.message ?? err).slice(0, 200);
    let fb: { ok: boolean; sent: string; detail: string };
    try {
      const { sendCentralAdapterStop } = await import("../robot/deviceOwnershipService");
      fb = await sendCentralAdapterStop(input.adapterId);
    } catch (e) {
      fb = { ok: false, sent: "failed", detail: String((e as Error)?.message ?? e).slice(0, 160) };
    }
    const detail = `adapter ${input.adapterId} is owned by edge node ${owner.edgeNodeId} but the STOP could not be queued for it (${why}); central fallback STOP: ${fb.ok && fb.sent === "sent" ? "sent" : `${fb.sent} (${fb.detail})`}`;
    const ids = await writeRejected(db, input, owner.code, detail);
    void raiseOtStopAlert("ot_stop_not_queued", input, `OT ${input.commandType} for adapter ${input.adapterId} (${via}): ${detail}.${fb.ok && fb.sent === "sent" ? "" : " Use the machine's E-STOP if it is still running."}`, [who.requestedBy]);
    return {
      ok: false,
      simulated: false,
      status: "rejected",
      reason: owner.code,
      results: failedResults(input, owner.code),
      commandLogIds: ids,
      message: detail,
      centralFallbackStop: { sent: fb.ok && fb.sent === "sent", detail: `${fb.sent}${fb.detail ? ` (${fb.detail})` : ""}`.slice(0, 200) },
    };
  }
}

/**
 * doc 81 Đợt 11 ruling R-11-o (I-1) — the durable alert of an UNVERIFIED stop refused because its adapter's waiting list is full: the alert
 * stream (warning) + an inbox row (HIGH) per recipient through the normal notification path — NO cap exemption (this is not a verified
 * STOP, R-8-d reserves exemptions for those). Deduped per command; fire-and-forget under a deadline; never throws.
 */
function raiseUnverifiedStopRefusedAlert(input: DispatchInput, message: string, recipients: number[]): void {
  const users = [...new Set(recipients.filter((u) => Number.isSafeInteger(u) && u > 0))];
  const work = (async () => {
    const { publishAnomalyDetected } = await import("../ecosystem/ecosystemEvents");
    publishAnomalyDetected({ kind: "stop_unverified_queue_full", severity: "warning", source: "ot", machineId: input.machineId ?? null, message }, "ot");
    const { sendNotification } = await import("../notificationService");
    for (const userId of users) {
      await sendNotification(
        userId,
        {
          type: "ALERT",
          priority: "HIGH",
          title: `Stop refused — adapter ${input.adapterId}: use the pinned STOP`,
          message,
          entityType: "ot_command",
          entityId: input.adapterId as never,
          metadata: { kind: "stop_unverified_queue_full", adapterId: input.adapterId, idempotencyKey: input.idempotencyKey ?? null },
        },
        { safetyCritical: true, dedupKey: `stop_unverified_queue_full:${input.adapterId}:${input.idempotencyKey ?? "?"}` },
      );
    }
  })();
  void withDeadline(work, OT_STOP_OVERRIDE_AUDIT_DEADLINE_MS, "stop_unverified_queue_full alert").catch((err) => {
    console.error(`[Dispatch] stop_unverified_queue_full alert failed or is stuck (adapter ${input.adapterId}):`, (err as Error)?.message || err);
  });
}

/** I-4 — the durable critical alert of an OT STOP central could not execute itself (criticalStopAlert; never throws). */
/** Tests only (A2(j) polish): the OT STOP alert helper, to pin that a per-request STOP alert carries the durable dedup (the sweep's marker). */
export function _raiseOtStopAlertChoTest(kind: string, input: DispatchInput, message: string, recipients: number[] = [], dedupKey?: string): Promise<void> {
  return raiseOtStopAlert(kind, input, message, recipients, dedupKey);
}
function raiseOtStopAlert(kind: string, input: DispatchInput, message: string, recipients: number[] = [], dedupKey?: string, title?: string): Promise<void> {
  return import("../robot/criticalStopAlert")
    .then(({ raiseCriticalStopAlert }) =>
      raiseCriticalStopAlert({
        kind,
        title: title ?? `OT STOP not executed by central — adapter ${input.adapterId}`,
        message,
        recipients: recipients.filter((u) => Number.isSafeInteger(u) && u > 0),
        dedupKey: dedupKey ?? `${kind}:${input.adapterId}:${input.idempotencyKey}`,
        source: "ot",
        entityType: "ot_command",
        entityId: input.adapterId,
        retryUntilPersisted: { everyMs: 30_000, attempts: 20 },
        // A2(j) polish — a per-request STOP alert (`stop_undelivered:request:<id>`) carries the durable dedup: its inbox row gets metadata.dedupKey,
        // the marker edgeNodeCommands.alertUndeliveredStops reads ⇒ the sweep does not alert the same request a second time
        ...(dedupKey?.startsWith("stop_undelivered:request:") ? { khuTrungBenVung: {} } : {}),
      }),
    )
    .catch(() => undefined);
}

function failedResults(input: DispatchInput, reason: string, status: DispatchStatus = "rejected"): DispatchPerWrite[] {
  return input.writes.map((w) => ({ tagKey: w.tagKey, ok: false, status, error: reason }));
}

/**
 * Make a per-write idempotency key so a multi-write command keeps the unique constraint.
 * R1b-2b-2a T6d (AN TOÀN) — định dạng KHÔNG MƠ HỒ: tiền tố phiên bản `v2:` + ĐỘ DÀI của từng phần (`v2:<len>:<base>:<len>:<tagKey>:<idx>`) ⇒ hai bộ
 * (base, tagKey, idx) khác nhau KHÔNG BAO GIỜ cho cùng chuỗi (trước: `${base}:${tagKey}:${idx}` — base `K` + tag `x:y` ≡ base `K:x` + tag `y`). Khoá dài
 * hơn 128 ⇒ `boundedKey` (giữ tiền tố + băm của CẢ chuỗi). Hàng ghi theo định dạng CŨ được đọc qua `perWriteKeyCu` (chỉ để phát lại có chốt).
 */
export function perWriteKey(base: string, tagKey: string, index: number): string {
  // T6d fix 2 — TOÀN PHẦN (phòng thủ chiều sâu, cửa vào đã chuẩn hoá khoá): base không phải chuỗi ⇒ "" (lệnh không khoá, như `dispatch()`); tagKey không
  // phải chuỗi ⇒ "_" (CÙNG khoá `writeAll` ghi cho hàng tagKey null) — không bao giờ ném ở bước 2 trước cả khi tag được tra.
  const b = typeof base === "string" ? base : "";
  const t = typeof tagKey === "string" ? tagKey : "_";
  return boundedKey(`v2:${b.length}:${b}:${t.length}:${t}:${index}`);
}

/** T6d — định dạng CŨ (trước T6d), CHỈ để ĐỌC hàng cũ cho phát lại có chốt / chặn DUPLICATE_IN_FLIGHT; không bao giờ dùng để ghi. */
function perWriteKeyCu(base: string, tagKey: string, index: number): string {
  // doc 81 Đợt 1B Task 6 fix round 1 — ≤128 AND unique: a bare slice(0,128) collapsed every
  // write of a long-key command onto one key. Keys ≤128 chars are unchanged byte for byte.
  return boundedKey(`${base}:${tagKey}:${index}`);
}
