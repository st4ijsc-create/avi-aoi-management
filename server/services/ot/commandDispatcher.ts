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
 * ════════════════════════════════════════════════════════════════════════════
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  aiPendingActions,
  deviceAdapters,
  deviceTags,
  commandLog,
  interlockRules,
  interlockEvents,
  type CommandLog,
} from "../../../drizzle/schema";
import { getActiveDriver } from "./otManager";
import { AUDIT_ACTIONS, createAuditContext, logCrudOperation } from "../auditTrailService";
import type { OtTagAddress } from "./otDriver";
import { readbackMatches } from "./drivers/readbackCompare";
import { isCommissioned, isCommissioningRequired } from "./commissioningService";
// Doc 25 T1 — cổng interlock ĐỒNG BỘ, fail-closed chạy TRƯỚC mọi real-write HITL.
// Import từ interlockGate (module chỉ đọc DB, KHÔNG import ngược commandDispatcher →
// không tạo vòng phụ thuộc).
import { evaluateInterlockGate } from "../interlock/interlockGate";
import { evaluateCommandPolicy, secPlatformEnabled } from "../security/policyGate"; // doc 33 I2 (F5): policy-as-code gate
// G1.7 (doc 44 W0-D) — correlation backbone (AsyncLocalStorage, opt-in): when the
// caller did not pass an explicit correlationId we read the ambient one (if any).
import { getCorrelationId } from "../observability/correlation";

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

export type DispatchStatus = CommandLog["status"]; // simulated | sent | acked | failed | timeout | rejected

export interface DispatchWrite {
  tagKey: string;
  value: unknown;
}

/** F4 HITL trigger: a human-confirmed AI write-action. */
export interface HitlTrigger {
  kind: "hitl";
  /** ai_pending_actions.id of the confirmed HITL action (defense-in-depth). */
  actionId?: string;
  /** User who confirmed the HITL action (must own the pending row). */
  confirmedBy: number;
  /** User who originally requested (proposed) the action. */
  requestedBy: number;
}

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
   * doc 33 I2 (F5): optional policy-as-code context for the SEC_PLATFORM governance gate —
   * `{ action, zone, product, line, approved }`. Absent → action defaults to "device_write"
   * (no default policy matches → allow). See server/services/security/policyGate.ts.
   */
  policyContext?: { action?: string; approved?: boolean } & Record<string, unknown>;
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
// CÙNG adapterId được tuần tự hóa bằng một promise-chain in-process per adapter
// (mutex kiểu tail-promise). Hàng đợi BOUNDED: khi depth (kể cả lệnh đang chạy)
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

interface AdapterCommandQueue {
  /** Promise của lệnh cuối trong chuỗi — đã "sanitize" (không bao giờ reject). */
  tail: Promise<void>;
  /** Số lệnh trong hàng (kể cả lệnh đang thực thi). */
  depth: number;
}

const adapterCommandQueues = new Map<number, AdapterCommandQueue>();

/** Chỉ dùng trong test — xóa mọi hàng đợi lệnh per-adapter. */
export function _resetAdapterCommandQueuesForTests(): void {
  adapterCommandQueues.clear();
}

type EnqueueOutcome<T> =
  | { accepted: true; result: Promise<T> }
  | { accepted: false; depth: number; max: number };

/**
 * Xếp `fn` vào hàng đợi tuần tự của adapter. Trả {accepted:false} NGAY (không
 * side-effect) khi hàng đã đầy. `fn` chỉ chạy sau khi mọi lệnh xếp trước nó đã
 * kết thúc (kể cả khi lệnh trước lỗi — tail được sanitize). Entry của adapter
 * được dọn khỏi map khi hàng cạn (không rò rỉ theo số adapter đã từng dùng).
 */
function tryEnqueueAdapterCommand<T>(adapterId: number, fn: () => Promise<T>): EnqueueOutcome<T> {
  const max = cmdQueueMax();
  let q = adapterCommandQueues.get(adapterId);
  if (!q) {
    q = { tail: Promise.resolve(), depth: 0 };
    adapterCommandQueues.set(adapterId, q);
  }
  if (q.depth >= max) return { accepted: false, depth: q.depth, max };
  q.depth += 1;
  const queue = q;
  const run = queue.tail.then(fn);
  queue.tail = run.then(
    () => undefined,
    () => undefined,
  );
  const result = run.finally(() => {
    queue.depth -= 1;
    if (queue.depth === 0 && adapterCommandQueues.get(adapterId) === queue) {
      adapterCommandQueues.delete(adapterId);
    }
  });
  return { accepted: true, result };
}

/** Resolve the (requestedBy, confirmedBy) pair recorded on commandLog rows. */
function actors(input: DispatchInput): { requestedBy: number; confirmedBy: number; actionId: string | null } {
  if (input.triggeredBy.kind === "hitl") {
    return {
      requestedBy: input.triggeredBy.requestedBy,
      confirmedBy: input.triggeredBy.confirmedBy,
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
    // F4: defense-in-depth — the pending action must be confirmed/executed AND
    // owned by the confirming user.
    if (input.triggeredBy.actionId) {
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
    };
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
    const verdict = evaluateCommandPolicy(
      { action: "device_write", ...(input.policyContext ?? {}) },
      { enabled: true, approved: input.policyContext?.approved === true },
    );
    if (!verdict.allow) {
      const reason = verdict.effect === "deny" ? "POLICY_DENIED" : "POLICY_APPROVAL_REQUIRED";
      const ids = await writeRejected(db, input, reason, verdict.reason);
      return { ok: false, simulated: false, status: "rejected", reason, results: failedResults(input, reason), commandLogIds: ids };
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

  // ── (5b) F4b — REAL WRITE PATH. Reachable ONLY when OT_CONTROL_ENABLED==="true"
  //         AND the adapter is commissioned (C2) AND only after every F4a gate above
  //         (confirm+owner, idempotency, allowlist writable, driver active).
  //         driver.writeTags() reaches the physical device. ack (F4b) = write
  //         returned ok. NO blind retry.
  //         G2.1: when OT_READBACK_ENABLED, a SINGLE driver.readTags() verifies the
  //         acked writes (acked_verified / acked_unverified — WARN only). The
  //         per-write outcome + read-back status are computed BEFORE inserting the
  //         commandLog rows so the ledger stays append-only (insert ONCE, no update).
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
  let executed: { sentAt: Date; timedOut: boolean; outcomes: Outcome[] };
  if (isCmdSerializeEnabled()) {
    const enq = tryEnqueueAdapterCommand(input.adapterId, executeWriteAndVerify);
    if (!enq.accepted) {
      const ids = await writeRejected(
        db,
        input,
        "BUSY",
        `adapter command queue full (depth ${enq.depth} >= max ${enq.max}) — command rejected, retry later`,
      );
      return { ok: false, simulated: false, status: "rejected", reason: "BUSY", results: failedResults(input, "BUSY"), commandLogIds: ids };
    }
    executed = await enq.result;
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
        confirmedBy: who.confirmedBy,
        status: o.status,
        ...trig,
        ...ctx,
        readBackValue: o.readBackValue as any,
        errorText: o.errorText,
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
  return { ok: allOk, simulated: false, status: overall, results, commandLogIds };
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
  // commandTag must match the (single) tag being written.
  const tagKeys = input.writes.map((w) => w.tagKey);
  if (!rule.commandTag || !tagKeys.includes(rule.commandTag)) {
    return { ok: false, reason: "INTERLOCK_TAG_MISMATCH", detail: "Rule commandTag does not match the written tag" };
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
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: DispatchInput,
  reason: string,
  detail: string,
  onlyTagKey?: string,
  address?: string,
): Promise<number[]> {
  return writeAll(db, input, "rejected", reason, detail, onlyTagKey, address);
}

async function writeFailed(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: DispatchInput,
  reason: string,
  detail: string,
): Promise<number[]> {
  return writeAll(db, input, "failed", reason, detail);
}

async function writeAll(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: DispatchInput,
  status: DispatchStatus,
  reason: string,
  detail: string,
  onlyTagKey?: string,
  address?: string,
): Promise<number[]> {
  const ids: number[] = [];
  const who = actors(input);
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
        idempotencyKey: perWriteKey(input.idempotencyKey, w.tagKey ?? "_", i),
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
  const k = `${base}:${tagKey}:${index}`;
  return k.length <= 128 ? k : k.slice(0, 128);
}
