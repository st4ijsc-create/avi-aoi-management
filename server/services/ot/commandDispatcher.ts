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
  type DeviceTag,
} from "../../../drizzle/schema";
import { kiemGiaTriGhi, laKenhGhi, loaiKenh } from "../scada/kenhScada"; // SCADA R1a Task 3 (K4) — the ONE coercion/range/step rule
import { cheDoMay, congCheDoBat, laToolHmiCongCheDo } from "../scada/cheDoMay"; // SCADA R1a Task 4 (K2/D3) — machine LOCAL/REMOTE
import { boundedKey, canonicalOtValue, FOE_ENGINE_TOOL, foeSelfApprovalRefusal, otPayloadHash, readOtPayloadHash } from "./otActionBinding";
import { foeApprovalDbRefusal, preReadProgramChecksForAction, type PreReadPrograms } from "../orchestration/foe/foeGateApproval"; // doc 81 Đợt 4 fix round 1 (R-4-i); Đợt 8 final wave O M2
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
import { isCommissioned, isCommissioningRequired } from "./commissioningService";
// Doc 25 T1 — cổng interlock ĐỒNG BỘ, fail-closed chạy TRƯỚC mọi real-write HITL.
// Import từ interlockGate (module chỉ đọc DB, KHÔNG import ngược commandDispatcher →
// không tạo vòng phụ thuộc).
import { evaluateInterlockGate } from "../interlock/interlockGate";
import { evaluateCommandPolicy, secPlatformEnabled } from "../security/policyGate"; // doc 33 I2 (F5): policy-as-code gate
// G1.7 (doc 44 W0-D) — correlation backbone (AsyncLocalStorage, opt-in): when the
// caller did not pass an explicit correlationId we read the ambient one (if any).
import { getCorrelationId } from "../observability/correlation";
import { adapterOwnedByEdgeInTx } from "./otAdapterOwnerGate"; // doc 81 Đợt 10 D fix review 3 (scan #73)
// doc 81 Đợt 1D Task 2 — per-tag pinned STOP values (mig 0362, Task 1).
import { loadStopPins, matchPinnedStop, stopPinsFromTagRows, validateStopValue, type MatchPinnedStopResult, type StopPin, type StopPinTagRow } from "./stopPin";
import { giaTriLenhInterlock } from "../interlock/giaTriLenh"; // R1a T12 fix 1 (c1): giá trị luật GỬI = giá trị so ở đây = giá trị kiểm lúc cấu hình
import { cachedStopPinPresence } from "./stopPinPresence"; // doc 81 Đợt 12 final fix wave residual (R-12-f item 1)
import { otStopEpochSyncSeesPeers } from "./otStopEpochSync"; // R-12-f item 1

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
  /** doc 81 Đợt 10 final fix wave (I-4) — the adapter is EDGE-owned: the STOP was queued for its node as this request */
  edgeStopRequest?: { requestId: number; edgeNodeId: number };
  /**
   * SCADA R1b-1 T2 fix round 2 — set ONLY on the edge-route branch where the STOP could NOT be queued for the owning node and central ran
   * its fallback STOP of the adapter's pinned values (R-10-ay): `sent` ⇔ that fallback reported sent. Absent everywhere else.
   */
  centralFallbackStop?: { sent: boolean; detail: string };
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
  // kiem-dinh P1-3 — scale/offset (hàng bước 3 là hàng đầy đủ): int của tag ĐÃ KHAI phải nằm trên lưới thô, không thì OFF_STEP.
  Partial<Pick<DeviceTag, "scale" | "offset">>;

/** Refusal codes of the early channel gate (command_log.errorText `<CODE>: <detail>`). */
export type MaCongKenh = "CHANNEL_READ_ONLY" | "TYPE_MISMATCH" | "OUT_OF_RANGE" | "OFF_STEP";

export type KetQuaCongKenhSom =
  | { ok: true; writes: DispatchWrite[] }
  | { ok: false; ma: MaCongKenh; chiTiet: string; tagKey: string; address: string };

/**
 * Does this tag DECLARE a write channel model (mig 0431 columns)? Only then are its written values coerced and checked
 * (type, range, step). All NULL ⇒ the pre-R1a behaviour, byte for byte: the caller's value goes on as sent, uncoerced
 * (plan R1a: "NULL = hành vi cũ"; the ' "42" ≠ 42 ' binding test and the ' "0" is not the int pin 0 ' stop-pin test stay
 * true on an undeclared tag). `actuationLevel` / `displayName` / `displayFormat` describe, they do not constrain a write.
 */
export function kenhDaKhaiGhi(tag: Pick<DeviceTag, "channelKind" | "writeMin" | "writeMax" | "writeStep">): boolean {
  return tag.channelKind != null || tag.writeMin != null || tag.writeMax != null || tag.writeStep != null;
}

/** Type-only coercion (kenhScada's rule, no range/step) — the value a declared tag would carry if it were in range. */
function epKieuKenh(tag: Pick<DeviceTag, "dataType">, value: unknown) {
  return kiemGiaTriGhi({ dataType: tag.dataType, writeMin: null, writeMax: null, writeStep: null }, value);
}

/**
 * PURE — the early channel gate (step 3b of dispatchCore). `tags[i]` is the step-3 row of `writes[i]` (found, enabled,
 * writable). Two passes over the writes, each in write order:
 *   PASS 1 (every write):
 *   1. not a write channel (`laKenhGhi`: channel_kind input / calculated) ⇒ CHANNEL_READ_ONLY. NO stop exemption: a pin
 *      only exists on a writable channel. channel_kind NULL ⇒ derived from `writable` (true here) ⇒ always a write channel.
 *   2. channel model not declared (`kenhDaKhaiGhi` false) ⇒ the write passes UNCHANGED (old behaviour).
 *   3. coerce by dataType (`kiemGiaTriGhi`, never rounds) ⇒ TYPE_MISMATCH on failure.
 *   PINNED STOP exemption (coordinator 2026-10-24 item 4: no software blocks a pinned STOP; fix round 1 M-2: WHOLE command
 *   only) — matched on DATA here, since this gate runs before the mode/commissioning gates: a stop-typed command
 *   (`isStopCommandType`) whose writes — ALL of them, declared (coerced) and undeclared (as sent) — equal their tags'
 *   `stop_value` (one `matchPinnedStop` over every write, the 5a-stop rule: pinned tags, pinned values, no duplicates) skips
 *   range and step. A stop that mixes a pin with ANY other write (fix round 2: an undeclared, unpinned one too — it is not a
 *   pinned STOP at 5a-stop either) is not exempt for any of them. The full classification (`classifyOtStop`, connection fingerprint …)
 *   still runs later, unchanged. Range ↔ stop_value consistency is checked at CONFIGURATION time (R1a Task 12), not here.
 *   PASS 2 (declared writes, unless exempt):
 *   4. range, then step ⇒ OUT_OF_RANGE / OFF_STEP (the detail carries `goiY`, a hint only — the value is never altered).
 *   5. kiem-dinh P1-3 (2026-10-24) — int with scale/offset: (v − offset)/scale must be an integer, else OFF_STEP (goiY = the raw-grid
 *      value the driver's `inverseScale` would have rounded to). DECLARED tags only, like 3–4: an undeclared tag keeps the pre-R1a
 *      behaviour byte for byte (flags-off equivalence) — and so the driver still rounds silently there (known limit; R1b backlog).
 *      A pinned STOP is exempt (whole-command rule above), like range/step.
 * ok ⇒ the writes to use downstream: declared tags carry the COERCED value, undeclared ones the caller's write object.
 *
 * R1a Task 4 (ledger R-1) appends its mode gate (3c) right after this block in dispatchCore, on the same tag rows.
 */
export function congKenhSom(commandType: string, writes: ReadonlyArray<DispatchWrite>, tags: ReadonlyArray<TagCongKenh>): KetQuaCongKenhSom {
  const tuChoi = (i: number, ma: MaCongKenh, chiTiet: string): KetQuaCongKenhSom => ({ ok: false, ma, chiTiet, tagKey: writes[i].tagKey, address: tags[i].address });
  const out: DispatchWrite[] = [];
  const daKhai: number[] = []; // indexes of the declared writes (coerced in `out`)
  for (let i = 0; i < writes.length; i++) {
    const w = writes[i];
    const tag = tags[i];
    if (!laKenhGhi(tag)) return tuChoi(i, "CHANNEL_READ_ONLY", `Tag "${w.tagKey}" is a '${loaiKenh(tag)}' channel — not a write channel`);
    if (!kenhDaKhaiGhi(tag)) {
      out.push(w);
      continue;
    }
    const kieu = epKieuKenh(tag, w.value);
    if (!kieu.ok) return tuChoi(i, kieu.ma, `Tag "${w.tagKey}": ${kieu.chiTiet}`);
    out.push({ ...w, value: kieu.giaTri });
    daKhai.push(i);
  }
  if (daKhai.length === 0) return { ok: true, writes: out };

  if (isStopCommandType(commandType)) {
    const pins = stopPinsFromTagRows(tags.map((t) => ({ tagKey: t.tagKey, dataType: t.dataType, stopValue: t.stopValue, writable: t.writable, isEnabled: t.isEnabled })));
    if (matchPinnedStop(pins, out.map((w) => ({ tagKey: w.tagKey, value: w.value }))).ok) return { ok: true, writes: out };
  }

  for (const i of daKhai) {
    const kq = kiemGiaTriGhi(tags[i], writes[i].value);
    if (!kq.ok) return tuChoi(i, kq.ma, `Tag "${writes[i].tagKey}": ${kq.chiTiet}${kq.goiY !== undefined ? ` (goiY=${kq.goiY})` : ""}`);
    // kq.giaTri === the pass-1 coerced value (kiemGiaTriGhi never rounds or clamps)
  }
  return { ok: true, writes: out };
}

/**
 * Gate 1 (requireBoundAction) verifies the binding BEFORE step 3 reads the tags. To accept the same coerced form step 3b
 * will produce, this reads the written tags' declarations and returns the type-coerced writes — or null when nothing
 * would change, or the read fails (⇒ the raw verdict stands: fail-closed). Read-only.
 */
async function writesEpKieuChoRangBuoc(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, input: DispatchInput): Promise<DispatchWrite[] | null> {
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

async function dispatchCore(input: DispatchInput): Promise<DispatchResult> {
  // doc 81 Đợt 11 K-fix (R-11-d) — FIRST, before any await: the adapter's STOP epoch as this command's gates begin. Read-only;
  // K-fix 2 (R-11-i b): nothing here moves it — only a TRUE stop does, when it is SENT (device stage).
  const epochAtGates = adapterStopEpoch(input.adapterId);
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
      let bound = verifyActionBinding(pending, input, t);
      if (!bound.ok && bound.reason === "ACTION_BINDING_MISMATCH") {
        // SCADA R1a Task 3 — the binding may have been hashed on the COERCED value step 3b will send (declared tags only;
        // see the hash decision at step 3b). Same verifier, raw form first; neither form matches ⇒ the raw verdict stands.
        const epKieu = await writesEpKieuChoRangBuoc(db, input);
        if (epKieu) {
          const lai = verifyActionBinding(pending, { ...input, writes: epKieu }, t);
          if (lai.ok) bound = lai;
        }
      }
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
  // SCADA R1a T3 fix round 1 (M-1) — no row for write #0: a refusal of ONE later write (TAG_NOT_FOUND / TAG_NOT_WRITABLE /
  // the step-3b channel gate) ledgers only that write, under its own index. Look for it too (first in write order), so a
  // retry returns that cached refusal instead of re-running the gates into the unique constraint. Single-write commands
  // (and any command whose write #0 has a row) never reach this read.
  if (!existing && input.writes.length > 1) {
    const laterKeys = input.writes.slice(1).map((w, i) => perWriteKey(input.idempotencyKey, w.tagKey, i + 1));
    const later = await db.select().from(commandLog).where(inArray(commandLog.idempotencyKey, laterKeys));
    const first = laterKeys.map((k) => later.find((r) => r.idempotencyKey === k)).find((r) => !!r && TERMINAL_STATUSES.has(r.status));
    if (first) return cachedResult(input, first);
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
  //         human did not confirm. Gate 1 (requireBoundAction) applies the same two forms (writesEpKieuChoRangBuoc).
  const rawCallerWrites = input.writes;
  /**
   * The ONE refusal path of the early gate block (3b channel gate, 3c mode gate). fix round 1 (I-1) — a STOP-typed command to an
   * adapter central holds no driver for: if an EDGE node owns the adapter, step 4 turns it into an adapter-wide STOP of the PINNED
   * values (queued for the node / central fallback), ignoring the caller's values — so a refusal here would protect no wire value
   * and only block a STOP. Route it exactly as step 4 would; not edge-owned (or the owner unreadable — routeEdgeOwnedAdapterCommand
   * alerts) ⇒ refused through writeRejected (command_log, WORM). `tagKey` given ⇒ one row for that write; absent ⇒ one per write.
   */
  const tuChoiSom = async (ma: string, chiTiet: string, tagKey?: string, address?: string): Promise<DispatchResult> => {
    if (isStopCommandType(input.commandType) && !getActiveDriver(input.adapterId)) {
      const routed = await routeEdgeOwnedAdapterCommand(db, input);
      if (routed) return routed;
    }
    const ids = await writeRejected(db, input, ma, chiTiet, tagKey, address);
    return { ok: false, simulated: false, status: "rejected", reason: ma, results: failedResults(input, ma), commandLogIds: ids };
  };
  const kenh = congKenhSom(input.commandType, input.writes, tagRowsBuoc3);
  if (!kenh.ok) return tuChoiSom(kenh.ma, kenh.chiTiet, kenh.tagKey, kenh.address);
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
    const gate = await evaluateInterlockGate({
      adapterId: input.adapterId,
      machineId: input.machineId ?? null,
      tagKeys: input.writes.map((w) => w.tagKey),
    });
    if (gate.blocked) {
      const detail = gate.failClosed
        ? "interlock evaluation error — fail-closed (no write)"
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
  const reservation = await reserveRealWrite(db, input, resolved, { bindingInput: callerInput, rawBindingWrites: rawCallerWrites, ledgerExtra, pinnedStop: stopCls.pinnedStop });
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
      const stopKey = typeof queued.stop?.idempotencyKey === "string" && queued.stop.idempotencyKey ? queued.stop.idempotencyKey : null;
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
    const stopKey = typeof executed.stop?.idempotencyKey === "string" && executed.stop.idempotencyKey ? executed.stop.idempotencyKey : null;
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
    const stopKey = typeof executed.stop?.idempotencyKey === "string" && executed.stop.idempotencyKey ? executed.stop.idempotencyKey : null;
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
  opts: {
    pinnedStop?: boolean;
    /**
     * SCADA R1a Task 3 — a second form of the SAME writes (the caller's raw values when `input` carries the step-3b coerced
     * ones). The stored hash may match either; every other field (tool/adapter/machine/commandType) comes from `input`.
     */
    altWrites?: ReadonlyArray<DispatchWrite>;
  } = {},
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
    /** SCADA R1a Task 3 — the caller's RAW writes (before step-3b coercion): the binding may match these OR `bindingInput`'s. */
    rawBindingWrites?: ReadonlyArray<DispatchWrite>;
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
        let verdict: BindingVerdict | { ok: false; reason: "PRECONDITION_FAILED"; detail: string };
        if (!t.actionId) {
          verdict = { ok: false, reason: "PRECONDITION_FAILED", detail: "real OT write requires a bound, confirmed, single-use HITL actionId (none supplied)" };
        } else {
          const [pending] = await tx
            .select()
            .from(aiPendingActions)
            .where(eq(aiPendingActions.id, t.actionId))
            .for("update");
          verdict = verifyActionBinding(pending, opts.bindingInput ?? input, t, { pinnedStop: opts.pinnedStop === true, altWrites: opts.rawBindingWrites });
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
  // SCADA R1a T3 fix round 1 (M-1) — each row keeps the ORIGINAL write index in its per-write key (was the index in the
  // filtered list: a refusal of write #1 took key `K:<tag>:0`, which the step-2 probe never looks for ⇒ a retry with the same
  // key re-ran the gates and hit the unique constraint). Unfiltered calls are byte-identical (index === original index).
  const indexed = input.writes.map((w, idx) => ({ w, idx }));
  const writes = onlyTagKey ? indexed.filter((e) => e.w.tagKey === onlyTagKey) : indexed;
  const list = writes.length > 0 ? writes : [{ w: { tagKey: null as any, value: null }, idx: 0 }];
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
        ...(link?.intentIds && link.intentIds.length > 0
          ? { ackValue: { ledger: link.nullKey ? "refused_duplicate" : "result", intentId: link.intentIds[Math.min(i, link.intentIds.length - 1)], ...(link.ackExtra ?? {}) } as any }
          : link?.ackExtra && Object.keys(link.ackExtra).length > 0
            ? { ackValue: { ...link.ackExtra } as any }
            : {}),
        idempotencyKey: link?.nullKey ? null : perWriteKey(input.idempotencyKey, w.tagKey ?? "_", idx),
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
function raiseOtStopAlert(kind: string, input: DispatchInput, message: string, recipients: number[] = [], dedupKey?: string): Promise<void> {
  return import("../robot/criticalStopAlert")
    .then(({ raiseCriticalStopAlert }) =>
      raiseCriticalStopAlert({
        kind,
        title: `OT STOP not executed by central — adapter ${input.adapterId}`,
        message,
        recipients: recipients.filter((u) => Number.isSafeInteger(u) && u > 0),
        dedupKey: dedupKey ?? `${kind}:${input.adapterId}:${input.idempotencyKey}`,
        source: "ot",
        entityType: "ot_command",
        entityId: input.adapterId,
        retryUntilPersisted: { everyMs: 30_000, attempts: 20 },
      }),
    )
    .catch(() => undefined);
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
