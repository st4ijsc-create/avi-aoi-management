/**
 * doc 81 Đợt 10 task D (design §2.14) — the DEVICE STAGE of an OT write, extracted VERBATIM from commandDispatcher so the
 * central dispatcher and the edge front end (otEdgeDispatch.ts) drive an adapter through ONE implementation:
 *   • the per-adapter command QUEUE (G1.9 / R-1E-a: bounded, a PINNED stop is never BUSY and supersedes waiting commands);
 *   • the WRITE under the command timeout, the read-back (G2.1), the read-only STOP WATCH after an abandoned write (B3, alert
 *     only) and the queue-slot HOLD of a timed-out write (B3, QĐ-4b) with its bounded session reset.
 * No gate and no ledger here: the callers decide (central: command_log; edge: journal). commandDispatcher re-exports every
 * public name that used to live there, so its importers and suites are unchanged.
 */
import { getDb } from "../../db/connection";
import { adapterSessionResetBoundMs, getActiveConnectionFingerprint, getActiveDriver, listActiveAdapters, resetAdapterSession } from "./otManager";
import type { OtDriver, OtTagAddress } from "./otDriver";
import { readbackMatches } from "./drivers/readbackCompare";
import { canonicalOtValue } from "./otActionBinding";
import { withDeadline } from "./drivers/boundedClose";
import { ghiNhanLenh } from "./boDemTruyenThong";
import type { DispatchInput, DispatchStatus } from "./commandDispatcher";

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
 * doc 81 Đợt 4 Task B3 (QĐ-4b, owner ruling: 1000 ms) — how long a write that TIMED OUT keeps its adapter's queue
 * slot while it may still be running on the driver's session (see holdSlotAfterTimedOutWrite).
 */
export const OT_TIMED_OUT_WRITE_GRACE_MS = 1000;

/**
 * doc 81 Đợt 4 Task B3 fix scan (1) — slack on top of the session-reset budget for the dispatcher's OUTER deadline. The
 * reset is cooperative (it gives up by itself within its budget, adapterSessionResetBoundMs); the outer deadline is only
 * a safety net for a reset path that would not honour its budget.
 */
export const OT_SESSION_RESET_SLACK_MS = 250;

/**
 * doc 81 Đợt 4 Task B3 (alert-only, R-4-q) — resetting the session does NOT recall a request already on the wire: the
 * device may still apply the old (timed-out) write AFTER a STOP sent on the new session (re-energising after a stop).
 * For the adapter's risk window (staleWriteRiskWindowMs, at least OT_STALE_WRITE_RISK_TTL_MS — Đợt 5 F3) after such a
 * write was abandoned, a STOP to that adapter gets a READ-ONLY watch (every OT_STOP_WATCH_POLL_MS) that raises a
 * critical operator alarm when the STOP value cannot be confirmed — see startStopWatch. Nothing is ever written
 * automatically.
 */
export const OT_STALE_WRITE_RISK_TTL_MS = 10_000;
export const OT_STOP_WATCH_POLL_MS = 200;
/** doc 81 Đợt 5 task F fix 1 (ruling R-5-g) — the env knob's allowed range for the window FLOOR. */
export const OT_STALE_WRITE_RISK_TTL_MIN_MS = 10_000;
export const OT_STALE_WRITE_RISK_TTL_MAX_MS = 60_000;

/**
 * R-5-g — the risk-window FLOOR: env OT_STALE_WRITE_RISK_TTL_MS (ms), clamped to [10 s, 60 s]; unset / not a finite
 * number ⇒ 10 s. Read at call time. The per-adapter formula (2 × the driver timeout) still applies on top of it.
 */
export function staleWriteRiskFloorMs(): number {
  const raw = process.env.OT_STALE_WRITE_RISK_TTL_MS;
  const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(n)) return OT_STALE_WRITE_RISK_TTL_MS;
  return Math.min(OT_STALE_WRITE_RISK_TTL_MAX_MS, Math.max(OT_STALE_WRITE_RISK_TTL_MIN_MS, Math.trunc(n)));
}
/** The connect/request timeout every built-in OT driver uses when `connection.timeoutMs` is unset (`cfg.timeoutMs ?? 5000`). */
export const OT_DRIVER_DEFAULT_TIMEOUT_MS = 5000;

function driverTimeoutOf(conn: { timeoutMs?: unknown } | null | undefined): number {
  const t = conn?.timeoutMs;
  return typeof t === "number" && Number.isFinite(t) && t > 0 ? t : OT_DRIVER_DEFAULT_TIMEOUT_MS;
}

/**
 * doc 81 Đợt 5 task F3 (item 29, owner: survey recommendation (b)) — the stale-write risk window OF ONE ADAPTER:
 * max(floor, 2 × the driver's request/connect timeout); floor = staleWriteRiskFloorMs() (env OT_STALE_WRITE_RISK_TTL_MS
 * clamped to [10 s, 60 s], default 10 s — R-5-g). In production `connection.timeoutMs` is always unset today
 * (deviceAdapter.ts), so the window tracks the drivers' fixed 5 s default ⇒ the floor decides it. A driver library
 * may keep an abandoned request in flight (or retry it) for up to its own timeout; the old fixed 10 s was 2 × the 5 s
 * driver default.
 *   • The driver timeout is the running adapter's `connection.timeoutMs` (the larger of primary and HA backup — a
 *     failover may run the slower one), the drivers' default 5000 when unset or not a positive number.
 *   • Adapter not in the running set (e.g. a legacy reconnect in progress) ⇒ conservative: 2 × its reset (connect)
 *     bound adapterSessionResetBoundMs, which is never below the endpoint's own timeout.
 * Captured ONCE when the write is abandoned (StaleWrite.windowMs) — the abandoned request ran on THAT driver config; a
 * later reconfiguration does not shorten the watch. Never throws (any lookup failure ⇒ the conservative branch / floor).
 */
export function staleWriteRiskWindowMs(adapterId: number): number {
  let driverTimeoutMs: number | null = null;
  try {
    const a = listActiveAdapters().find((x) => x.adapterId === adapterId);
    if (a) driverTimeoutMs = Math.max(driverTimeoutOf(a.connection), a.backupConnection ? driverTimeoutOf(a.backupConnection) : 0);
  } catch {
    driverTimeoutMs = null;
  }
  if (driverTimeoutMs == null) {
    try {
      const b = adapterSessionResetBoundMs(adapterId);
      driverTimeoutMs = Math.max(OT_DRIVER_DEFAULT_TIMEOUT_MS, typeof b === "number" && Number.isFinite(b) && b > 0 ? b : 0);
    } catch {
      driverTimeoutMs = OT_DRIVER_DEFAULT_TIMEOUT_MS;
    }
  }
  return Math.max(staleWriteRiskFloorMs(), 2 * driverTimeoutMs);
}

/**
 * B3 — the running read-only STOP watches of an adapter. A watch follows the STOP's tags; only a newer command whose write
 * is actually DISPATCHED to the driver (executeWriteAndVerify, right before driver.writeTags) and that writes one of those
 * tags releases THAT tag (the operator's later intent for it owns it now). Commands for other tags and commands
 * superseded / cancelled / refused before their write release nothing. A watch with no tag left ends quietly.
 */
type StopWatch = { cancelled: boolean; tags: Set<string> };
const stopWatches = new Map<number, Set<StopWatch>>();
function registerStopWatch(adapterId: number, w: StopWatch): void {
  let set = stopWatches.get(adapterId);
  if (!set) {
    set = new Set();
    stopWatches.set(adapterId, set);
  }
  set.add(w);
}
function unregisterStopWatch(adapterId: number, w: StopWatch): void {
  const set = stopWatches.get(adapterId);
  if (!set) return;
  set.delete(w);
  if (set.size === 0) stopWatches.delete(adapterId);
}
/** A newer command's write to `tagKeys` is being dispatched: those tags are no longer the read-only watches' to verify. */
function releaseWatchedTags(adapterId: number, tagKeys: readonly string[]): void {
  const set = stopWatches.get(adapterId);
  if (!set) return;
  for (const w of [...set]) {
    for (const k of tagKeys) w.tags.delete(k);
    if (w.tags.size === 0) {
      w.cancelled = true;
      unregisterStopWatch(adapterId, w);
    }
  }
}

/**
 * B3 fix scan (3) / scan 3 (b)(c) — the abandoned write of an adapter whose fate is unknown (until = epoch ms): its
 * identity and values, so the watch can recognise it landing and AUDIT-LINK that observation to the abandoned command.
 * One entry per adapter (overwritten by a newer abandonment); expired entries are swept on every write to the map and on
 * lookup — the map never holds more than one entry per adapter and none older than its own window (windowMs, Đợt 5 F3).
 */
type StaleWrite = {
  until: number;
  /** Đợt 5 F3 — this adapter's risk window (staleWriteRiskWindowMs), captured when the write was abandoned. */
  windowMs: number;
  commandType: string;
  idempotencyKey: string | null;
  intentIds: number[];
  confirmedBy: number;
  machineId: number | null;
  writes: Array<{ tagKey: string; value: unknown }>;
};
const staleWriteRisk = new Map<number, StaleWrite>();
function sweepStaleWriteRisk(now = Date.now()): void {
  for (const [id, r] of staleWriteRisk) if (now > r.until) staleWriteRisk.delete(id);
}
/** Test seams (B3 fix scan 3 (b)) — sizes of the per-adapter state and an explicit sweep. */
export function _staleWriteRiskSizeForTests(): number {
  return staleWriteRisk.size;
}
export function _sweepStaleWriteRiskForTests(now: number): void {
  sweepStaleWriteRisk(now);
}
/** doc 81 Đợt 11 (R-11-k 2, kept by R-11-n) — test seam: the intents the adapter's abandoned (timed-out) write carries, null when none. */
export function _staleWriteRiskIntentIdsForTests(adapterId: number): number[] | null {
  return staleWriteRisk.get(adapterId)?.intentIds ?? null;
}
export function _stopWatchCountForTests(adapterId: number): number {
  return stopWatches.get(adapterId)?.size ?? 0;
}
function staleWriteRiskActive(adapterId: number): boolean {
  sweepStaleWriteRisk();
  return staleWriteRisk.has(adapterId);
}


/** G1.9 — cờ tuần tự hóa lệnh per-adapter, đọc tại call time (default OFF). */
export function isCmdSerializeEnabled(): boolean {
  return process.env.OT_CMD_SERIALIZE_ENABLED === "true";
}

/** Độ sâu hàng đợi tối đa per adapter (env OT_CMD_QUEUE_MAX, default 10). */
function cmdQueueMax(): number {
  const n = parseInt(String(process.env.OT_CMD_QUEUE_MAX ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}


/** final wave F7 — what the write+verify body produced for one command (see executeWriteAndVerify in dispatch). */
export type ExecutedWrite = {
  sentAt: Date;
  timedOut: boolean;
  outcomes: Array<{ idx: number; ok: boolean; status: DispatchStatus; errorText: string | null; readBackValue: unknown }>;
  slotHold?: Promise<void>;
};

/**
 * final wave F7 — listeners told when a PINNED stop is queued for an adapter: an in-flight pre-write safety re-check of a
 * non-stop command gives way to it at once (L-7). Returns the unsubscribe function.
 * doc 81 Đợt 11 K-fix 2 (R-11-i a) / simplify (R-11-n) — told for every VERIFIED STOP (by content) that reaches the queue; `info.pinned`
 * false for a content stop that is not the pinned stop command. An unverified stop-typed command never tells anyone.
 */
export type StopQueuedListener = (stopRef?: Record<string, unknown>, info?: { pinned: boolean }) => void;
const pinnedStopQueuedListeners = new Map<number, Set<StopQueuedListener>>();
export function onPinnedStopQueued(adapterId: number, fn: StopQueuedListener): () => void {
  let set = pinnedStopQueuedListeners.get(adapterId);
  if (!set) {
    set = new Set();
    pinnedStopQueuedListeners.set(adapterId, set);
  }
  set.add(fn);
  return () => {
    const cur = pinnedStopQueuedListeners.get(adapterId);
    if (!cur) return;
    cur.delete(fn);
    if (cur.size === 0) pinnedStopQueuedListeners.delete(adapterId);
  };
}

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

/**
 * doc 81 Đợt 11 K-fix (ruling R-11-d) — the per-adapter STOP EPOCH. Closes the pre-queue race of Group K (D-2): a non-STOP write
 * submitted BEFORE a STOP but still in its gates (DB reservation, preflight, interlock …) when the STOP is issued used to reach
 * the device AFTER the STOP (flag ON: it entered the queue behind the STOP and was not superseded; flag OFF: it simply ran).
 *   • K-fix 2 (R-11-i a/b): only a TRUE STOP — by CONTENT (the pinned stop, or writes that are exactly pinned stop tags with
 *     their pinned values), never by label — BUMPS its adapter's epoch, and only when it is EXECUTED: in the device stage right
 *     before driver.writeTags (central: when sent; edge: after verification, or when a pinned STOP runs unverified under L-7;
 *     central's fallback / sweep STOP too). Never on receipt, never before authorisation (bumpAdapterStopEpoch).
 *   • Every other write records the epoch when its gates begin; right before the device write it is compared
 *     (executeOtDeviceWriteUnlessStopped): moved ⇒ the write is CANCELLED (`StoppedBeforeWrite`, reason STOPPED_BEFORE_WRITE),
 *     nothing reaches the device, the caller ledgers the refusal. Flag ON and OFF alike. A protective interlock action (R-11-h)
 *     records nothing and is never cancelled.
 *   • A write whose gates begin AFTER the STOP was sent is the operator's newer intent and runs.
 * Values come from ONE process-wide counter (strictly increasing, never reused) so an equal value means "no STOP since";
 * the map holds one entry per adapter ever stopped (bounded by the adapter count).
 * PER PROCESS, plus a best-effort CROSS-REPLICA signal (doc 81 Đợt 12 task P): when a central process runs otStopEpochSync, every
 * local bump is broadcast AFTER the send (setStopEpochBroadcaster — scheduled with setImmediate, never awaited, never on the STOP's
 * path) and every other central replica bumps its own epoch for that adapter on receipt (bumpAdapterStopEpochFromPeer — no
 * re-broadcast). Remaining window = the NOTIFY latency (docs/EDGE_GATEWAY.md §8.14). The edge has no DB: its epoch stays per process.
 */
let stopEpochSeq = 0;
const adapterStopEpochs = new Map<number, { epoch: number; stop: Record<string, unknown> | null }>();

/** doc 81 Đợt 12 task P — the cross-replica broadcaster (otStopEpochSync, central only); null ⇒ per process (edge, tests). */
export type StopEpochBroadcast = { adapterId: number; epoch: number; at: number };
let stopEpochBroadcaster: ((m: StopEpochBroadcast) => void) | null = null;
/** Task P — install (or with null remove) the broadcaster. Returns a function that removes THIS broadcaster if still installed. */
export function setStopEpochBroadcaster(fn: ((m: StopEpochBroadcast) => void) | null): () => void {
  stopEpochBroadcaster = fn;
  return () => {
    if (stopEpochBroadcaster === fn) stopEpochBroadcaster = null;
  };
}

/**
 * R-11-d — a TRUE STOP for `adapterId` is being SENT: move the epoch (returns the new value). Never throws.
 * Task P — then, when a broadcaster is installed, the bump is announced to the other replicas on the NEXT macrotask (setImmediate):
 * the device stage (executeOtDeviceWrite) reaches driver.writeTags in this same synchronous section, so the NOTIFY starts only after
 * the STOP's device call was made (the identical-STOP join in tryEnqueueAdapterCommand bumps for a STOP already on the wire), and
 * nothing on the STOP's path ever waits for it (L-7).
 */
export function bumpAdapterStopEpoch(adapterId: number, stop?: Record<string, unknown> | null): number {
  stopEpochSeq += 1;
  const epoch = stopEpochSeq;
  adapterStopEpochs.set(adapterId, { epoch, stop: stop ?? null });
  const b = stopEpochBroadcaster;
  if (b) {
    const m: StopEpochBroadcast = { adapterId, epoch, at: Date.now() };
    setImmediate(() => {
      try {
        b(m);
      } catch {
        /* best effort — a broadcaster failure never reaches the STOP */
      }
    });
  }
  return epoch;
}

/**
 * doc 81 Đợt 12 task P fix 1 — PEER epochs live in their OWN map (another central replica SENT a verified STOP), apart from the
 * LOCAL map above (STOPs sent by this process, bounded by the real adapter count):
 *   • I-2 (L-7): a peer move never supersedes a stop-typed command on an adapter WITHOUT stop pins (the only software STOP there) —
 *     stopIssuedSince(…, {localOnly}) for those; final fix wave R-12-e I-1: on an adapter WITH pins it cancels a stop-labelled command
 *     that is not a verified STOP like any write (a verified STOP never records an epoch, so it is never cancelled).
 *   • I-3 (scan #111): the peer map is CAPPED without failing open — a new adapter always gets its entry; when full, the least
 *     recently moved entry is EVICTED and the PEER FLOOR rises to its epoch: an adapter without a peer entry reads the floor, so an
 *     eviction can only move an epoch FORWARD (the cancel direction), never back, and a real peer STOP is never dropped.
 */
export const OT_STOP_EPOCH_PEER_ADAPTERS_MAX = 100_000;
const peerStopEpochs = new Map<number, { epoch: number; stop: Record<string, unknown> | null }>();
let peerFloor: { epoch: number; stop: Record<string, unknown> | null } | null = null;
function peerEpochOf(adapterId: number): { epoch: number; stop: Record<string, unknown> | null } | null {
  return peerStopEpochs.get(adapterId) ?? peerFloor;
}
/**
 * doc 81 Đợt 12 task P — another central replica SENT a verified STOP for `adapterId`: move this process's PEER epoch for it (non-STOP
 * writes in this process's gates since before now are cancelled STOPPED_BEFORE_WRITE). Never broadcast again. `evicted`: the adapter
 * whose entry made room (the floor rose to its epoch), null when nothing was evicted — the caller alerts on it.
 */
export function bumpAdapterStopEpochFromPeer(adapterId: number, stop: Record<string, unknown>): { epoch: number; evicted: number | null } {
  stopEpochSeq += 1;
  let evicted: number | null = null;
  if (peerStopEpochs.has(adapterId)) peerStopEpochs.delete(adapterId); // re-inserted below: most recently moved last (LRU order)
  else if (peerStopEpochs.size >= OT_STOP_EPOCH_PEER_ADAPTERS_MAX) {
    const first = peerStopEpochs.entries().next().value as [number, { epoch: number; stop: Record<string, unknown> | null }];
    peerStopEpochs.delete(first[0]);
    evicted = first[0];
    if (!peerFloor || first[1].epoch > peerFloor.epoch) peerFloor = { epoch: first[1].epoch, stop: { ...(first[1].stop ?? {}), peerFloor: true } };
  }
  peerStopEpochs.set(adapterId, { epoch: stopEpochSeq, stop });
  return { epoch: stopEpochSeq, evicted };
}
/** Task P fix 1 — size of the peer map + floor (status / tests). */
export function peerStopEpochStats(): { size: number; max: number; floor: number } {
  return { size: peerStopEpochs.size, max: OT_STOP_EPOCH_PEER_ADAPTERS_MAX, floor: peerFloor?.epoch ?? 0 };
}

/** R-11-d — the adapter's current STOP epoch, local or peer (0 = never stopped in this process). Only ever moves forward. */
export function adapterStopEpoch(adapterId: number): number {
  return Math.max(adapterStopEpochs.get(adapterId)?.epoch ?? 0, peerEpochOf(adapterId)?.epoch ?? 0);
}

/** R-11-d — a non-STOP write cancelled right before its device write because a STOP was issued after its gates began. */
export type StoppedBeforeWrite = {
  stoppedBeforeWrite: true;
  epochAtGates: number;
  epochNow: number;
  /** identity of the latest STOP (idempotencyKey / commandType / pinned …) as its issuer supplied it; null if none */
  stop: Record<string, unknown> | null;
};

export function isStoppedBeforeWrite(x: unknown): x is StoppedBeforeWrite {
  return typeof x === "object" && x !== null && (x as StoppedBeforeWrite).stoppedBeforeWrite === true;
}

/**
 * R-11-d — null when no STOP was issued for the adapter since `epochAtGates`, else the cancellation (the latest STOP named).
 * Task P fix 1 (I-2, L-7): `localOnly` (a stop-typed command on an adapter without pins, R-12-e I-1) — only a STOP SENT BY THIS
 * PROCESS counts; a peer move never denies the only software STOP of an unpinned adapter.
 */
export function stopIssuedSince(adapterId: number, epochAtGates: number, opts?: { localOnly?: boolean }): StoppedBeforeWrite | null {
  const local = adapterStopEpochs.get(adapterId) ?? null;
  const peer = opts?.localOnly ? null : peerEpochOf(adapterId);
  const cur = (peer?.epoch ?? 0) > (local?.epoch ?? 0) ? peer : local;
  const epochNow = cur?.epoch ?? 0;
  if (epochNow <= epochAtGates) return null;
  return { stoppedBeforeWrite: true, epochAtGates, epochNow, stop: cur?.stop ?? null };
}

/**
 * SCADA R1a Task 5 (K9) — hạn mặc định một lệnh THƯỜNG được chờ trong hàng đợi per-adapter (trung tâm) trước khi tới lượt chạy
 * (Rapid dùng 60 s). Dispatcher đưa `queueTtlMs = input.deadlineMs ?? HAN_HANG_DOI_MAC_DINH_MS` cho lệnh không phải DỪNG / không phải
 * hành động interlock bảo vệ / không phải lệnh kiểu stop; quá hạn lúc tới lượt ⇒ không bao giờ chạy (`QueueExpired`).
 */
export const HAN_HANG_DOI_MAC_DINH_MS = 60_000;

/** R1a T5 (K9) — the job waited in the queue longer than its TTL: it was NEVER run (fn not called, nothing sent to the device). */
export type QueueExpired = { queueExpired: true; waitedMs: number; ttlMs: number };

export function isQueueExpired(x: unknown): x is QueueExpired {
  return typeof x === "object" && x !== null && (x as { queueExpired?: unknown }).queueExpired === true;
}

interface PendingAdapterCommand {
  /** Bắt đầu chạy lệnh (chỉ khi không có lệnh nào đang bay). */
  run: () => void;
  /** Huỷ lệnh đang CHỜ: người gọi nhận `Superseded` (mang danh tính DỪNG `byStop`); `fn` không bao giờ được gọi. */
  cancel: (byStop?: Record<string, unknown>) => void;
  /** a VERIFIED STOP (the pinned stop, or a stop by content): never BUSY, waits only for the in-flight command, never cancelled */
  priorityStop: boolean;
  /** R-11-o (M-1) — a verified STOP that is NOT the pinned stop (a stop by content): every pinned STOP goes ahead of it */
  contentStop: boolean;
  /**
   * doc 81 Đợt 11 K-fix 2 (ruling R-11-h) — a PROTECTIVE interlock action (stop_line / block / reduce): never cancelled by a STOP —
   * final fix wave (R-11-k 3): unless `overridesStopPin`, see below. It keeps every gate.
   */
  protective: boolean;
  /**
   * R-11-k (3) — this protective action writes a PINNED stop tag with a value other than its pin (e.g. a reduce_speed writing 30 where the
   * stop pin is 0): a VERIFIED stop cancels it (else it would land after the STOP and override it).
   */
  overridesStopPin: boolean;
  /**
   * doc 81 Đợt 11 simplify (ruling R-11-n) — a PINNED STOP's device write identity (identicalStopKey); null: never shared. While this STOP
   * waits or its write is in flight, an identical STOP is not queued again: its caller gets THIS STOP's real outcome.
   */
  identicalStopKey: string | null;
  /** R-11-n — the shared outcome of this STOP (set for a sharable STOP) */
  result?: Promise<unknown>;
  /** R-11-n — this STOP's ledger intents (the array its device write was given): an identical STOP's intents are added to it */
  intentIds?: number[];
  /** R-11-n / R-11-o (M-2) — the WRITE has answered (or timed out / failed): from then on an identical STOP is sent anew */
  settled: boolean;
  /** R-11-n — callers sharing this job (1 + identical STOPs dropped onto it) — test seam only */
  callers: number;
  /** R1a T5 (K9) — Date.now() when the command entered the queue (a slot waiter: when it started waiting). */
  enqueuedAt: number;
  /**
   * R1a T5 (K9) — how long it may wait before its turn; null ⇒ never expires: a STOP (priorityStop, pinned or by content), a protective
   * interlock action (safety direction), or a caller that passed no `queueTtlMs` (the edge front end, unchanged — R1c).
   */
  ttlMs: number | null;
}

/** R-11-o — a command waiting for a slot of a FULL queue (not counted in `depth`). */
type SlotWaiter = { admit: () => void; cancel: (byStop?: Record<string, unknown>) => void; overridesStopPin: boolean };

interface AdapterCommandQueue {
  /** Có một lệnh đang thực thi (write+verify) hay không. */
  inFlight: boolean;
  /** R-11-n — the job in flight (an identical STOP joins it while its write has not answered) */
  running: PendingAdapterCommand | null;
  /** Lệnh đang chờ, theo thứ tự sẽ chạy. */
  pending: PendingAdapterCommand[];
  /** Số lệnh trong hàng = lệnh đang bay (0/1) + lệnh đang chờ. */
  depth: number;
  /**
   * doc 81 Đợt 11 ruling R-11-o (I-1) — commands that found the queue FULL and wait (FIFO) for a slot instead of BUSY, admitted before any
   * newer command: first the INTERLOCK actions (at most OT_INTERLOCK_WAIT_MAX), then the UNVERIFIED stops (at most
   * OT_STOP_UNVERIFIED_WAIT_MAX; beyond it STOP_UNVERIFIED_QUEUE_FULL). Not counted in `depth`.
   */
  interlockWaiters: SlotWaiter[];
  unverifiedWaiters: SlotWaiter[];
}

/** R-11-o (I-1) — at most this many unverified stops wait for a slot per adapter; more ⇒ refused STOP_UNVERIFIED_QUEUE_FULL (+ alert). */
export const OT_STOP_UNVERIFIED_WAIT_MAX = 2;
/** R-11-o (I-1) — at most this many interlock actions wait for a slot per adapter (admitted before the unverified stops); more ⇒ BUSY. */
export const OT_INTERLOCK_WAIT_MAX = 4;

const adapterCommandQueues = new Map<number, AdapterCommandQueue>();

/** Chỉ dùng trong test — xóa mọi hàng đợi lệnh per-adapter. */
export function _resetAdapterCommandQueuesForTests(): void {
  adapterCommandQueues.clear();
  staleWriteRisk.clear();
  for (const set of stopWatches.values()) for (const w of set) w.cancelled = true;
  stopWatches.clear();
}

/** Chỉ dùng trong test — số adapter đang có entry hàng đợi (0 ⇔ mọi hàng đã được dọn). */
export function _adapterCommandQueueCountForTests(): number {
  return adapterCommandQueues.size;
}

/** Chỉ dùng trong test — độ sâu hiện tại của hàng đợi một adapter (0 khi không có entry). */
export function _adapterCommandQueueDepthForTests(adapterId: number): number {
  return adapterCommandQueues.get(adapterId)?.depth ?? 0;
}

/** R-11-n / R-11-o — test seam: commands waiting for a slot of the adapter's full queue (interlock + unverified). */
export function _adapterSlotWaitersForTests(adapterId: number): number {
  const q = adapterCommandQueues.get(adapterId);
  return q ? q.interlockWaiters.length + q.unverifiedWaiters.length : 0;
}

/** R-11-n — test seam: the WAITING entries in line order (`stop` with its callers, `protective`, `ordinary`). */
export function _adapterQueueLineForTests(adapterId: number): Array<{ cls: "stop" | "protective" | "ordinary"; callers?: number }> {
  return (adapterCommandQueues.get(adapterId)?.pending ?? []).map((j) => (j.priorityStop ? { cls: "stop" as const, callers: j.callers } : { cls: j.protective ? ("protective" as const) : ("ordinary" as const) }));
}

/** R-11-n — test seam: callers of the adapter's STOPs (waiting, or in flight with no answer yet), identical STOPs dropped onto them included. */
export function _stopCallersForTests(adapterId: number): number {
  const q = adapterCommandQueues.get(adapterId);
  if (!q) return 0;
  const run = q.running?.priorityStop && !q.running.settled ? q.running.callers : 0;
  return q.pending.reduce((n, j) => n + (j.priorityStop ? j.callers : 0), run);
}

export type EnqueueOutcome<T> =
  | { accepted: true; result: Promise<T | Superseded | QueueExpired>; /** R-11-n — an identical STOP was already waiting / in flight: this is ITS outcome */ joined?: boolean }
  | { accepted: false; depth: number; max: number; /** R-11-o — absent ⇒ BUSY */ reason?: "BUSY" | "STOP_UNVERIFIED_QUEUE_FULL" };

/** R-11-o — admit the waiting commands while the queue has room: interlock actions first, then unverified stops (each FIFO). */
function admitSlotWaiters(queue: AdapterCommandQueue): void {
  const max = cmdQueueMax();
  while (queue.depth < max) {
    const w = queue.interlockWaiters.shift() ?? queue.unverifiedWaiters.shift();
    if (!w) return;
    w.admit();
  }
}

/** Chạy lệnh chờ kế tiếp nếu không có lệnh nào đang bay; hàng cạn ⇒ xoá entry khỏi map. */
function pumpAdapterQueue(adapterId: number, queue: AdapterCommandQueue): void {
  if (queue.inFlight) return;
  admitSlotWaiters(queue);
  const next = queue.pending.shift();
  if (next) {
    next.run();
    return;
  }
  if (queue.depth === 0 && queue.interlockWaiters.length === 0 && queue.unverifiedWaiters.length === 0 && adapterCommandQueues.get(adapterId) === queue) {
    adapterCommandQueues.delete(adapterId);
  }
}

/**
 * A VERIFIED STOP arrives (R-1E-a): cancel every WAITING command that is neither a STOP nor a protective interlock action
 * (SUPERSEDED_BY_STOP naming the STOP), every unverified stop waiting for a slot (R-1E-b — its unproven values must not run after the
 * STOP and undo it), a protective action — queued or waiting for a slot — only when it writes a pinned stop tag with a non-pin value
 * (R-11-k 3), and tell an in-flight pre-write safety re-check (it gives way — final wave F7). The command in flight is never touched.
 */
function cancelWaitingForStop(adapterId: number, queue: AdapterCommandQueue, stopRef: Record<string, unknown> | undefined): void {
  for (const w of queue.unverifiedWaiters.splice(0)) w.cancel(stopRef);
  const keptWaiters: SlotWaiter[] = [];
  for (const w of queue.interlockWaiters) {
    if (w.overridesStopPin) w.cancel(stopRef);
    else keptWaiters.push(w);
  }
  queue.interlockWaiters = keptWaiters;
  const kept: PendingAdapterCommand[] = [];
  for (const j of queue.pending) {
    if (j.priorityStop || (j.protective && !j.overridesStopPin)) kept.push(j);
    else j.cancel(stopRef);
  }
  queue.pending = kept;
  for (const fn of [...(pinnedStopQueuedListeners.get(adapterId) ?? [])]) fn(stopRef, { pinned: stopRef?.contentStop !== true });
}

/**
 * doc 81 Đợt 11 simplify (ruling R-11-n) — the identity of a PINNED STOP's device write: the running connection + every write's tag,
 * address, dataType, scale, offset and canonical value, IN ORDER (so the shared outcome's per-write indexes are the caller's own), and —
 * R-11-o (M-2) — the command's timeout (a STOP with another deadline never shares a write: each caller's own deadlineMs holds). Two
 * STOPs share one write only when this is equal. Never throws: anything it cannot read ⇒ null (never shared, sent on its own).
 */
export function identicalStopKey(adapterId: number, writes: ReadonlyArray<OtResolvedWrite>, timeoutMs?: number): string | null {
  try {
    const conn = getActiveConnectionFingerprint(adapterId) ?? null;
    return JSON.stringify([conn, timeoutMs ?? null, writes.map((w) => [w.write.tagKey, w.address, w.dataType ?? null, w.scale ?? null, w.offset ?? null, canonicalOtValue(w.write.value)])]);
  } catch {
    return null;
  }
}

/** R-11-o (M-2) — what the queue hands the job it runs: call `writeAnswered` as soon as the device WRITE has answered (or timed out). */
export type QueueJobCtl = { writeAnswered: () => void };

/**
 * Xếp `fn` vào hàng đợi tuần tự của adapter (G1.9; entry dọn khỏi map khi hàng cạn). `fn` chỉ chạy sau khi mọi lệnh xếp trước nó đã
 * kết thúc (kể cả khi lệnh trước lỗi).
 *   • Lệnh thường: trả {accepted:false} NGAY (không side-effect) khi hàng đã đầy (BUSY).
 *   • `waitForSlot` (doc 81 Đợt 11 R-11-n → R-11-o): `"interlock"` (a protective interlock action) or `"unverified"` (a stop-TYPED command
 *     that is not a verified stop): a full queue ⇒ it waits for a slot (FIFO, interlock actions first, before any newer command), then
 *     queues like any command, with every gate of its caller. Each list is capped (OT_INTERLOCK_WAIT_MAX ⇒ BUSY beyond it;
 *     OT_STOP_UNVERIFIED_WAIT_MAX ⇒ STOP_UNVERIFIED_QUEUE_FULL beyond it).
 *   • `priorityStop` (a VERIFIED STOP — the pinned stop, R-1E-a, or a stop by content, R-11-n): never BUSY; cancels the waiting commands
 *     (cancelWaitingForStop), then stands after the last waiting STOP — a pinned STOP after the last waiting PINNED STOP, ahead of every
 *     content stop (R-11-o M-1) — it waits only for the command in flight (and earlier STOPs).
 *     `identicalStopKey` (a pinned STOP): an identical STOP already waiting, or in flight whose WRITE has not answered yet, is not queued
 *     again — the caller gets THAT STOP's real outcome (`joined`); its `shareIntentIds` join that STOP's ledger intents, and when that
 *     STOP's write is already in flight the adapter's STOP epoch moves now (R-11-d: this STOP is executed by that write).
 */
export function tryEnqueueAdapterCommand<T>(
  adapterId: number,
  fn: (ctl?: QueueJobCtl) => Promise<T>,
  opts?: {
    priorityStop?: boolean;
    /** doc 81 Đợt 11 K-fix 2 (R-11-h) — a protective interlock action: never cancelled by a STOP; queued and capped like any command. */
    protective?: boolean;
    /** R-11-k (3) — the protective action writes a pinned stop tag with a non-pin value: a VERIFIED stop cancels it. */
    overridesStopPin?: boolean;
    /** R-11-n / R-11-o — a full queue ⇒ wait for a slot in this (capped) list instead of BUSY. */
    waitForSlot?: "interlock" | "unverified";
    /** R-11-n — a pinned STOP's identicalStopKey (null / absent: never shared). */
    identicalStopKey?: string | null;
    /**
     * SCADA R1a Task 5 (K9) — the longest this command may WAIT before its turn (finite, > 0; else ignored). Checked when the job reaches
     * its turn (`run`, no timer): waited longer ⇒ `fn` is never called and the caller gets `QueueExpired`. Ignored for a `priorityStop`
     * and a `protective` job (they never expire). Absent ⇒ no TTL (byte-identical to before).
     */
    queueTtlMs?: number;
    /** R-11-n — the (mutable) intents array this STOP's device write records; an identical STOP's intents are appended to it. */
    shareIntentIds?: number[];
    stopRef?: Record<string, unknown>;
    /**
     * doc 81 Đợt 4 Task B3 — given `fn`'s result, a promise the queue SLOT waits on before the next command runs
     * (the caller still gets the result at once). It must settle on its own within a bounded time and never reject
     * (a rejection releases the slot too). undefined ⇒ the slot is released immediately, as before.
     */
    holdSlot?: (v: T) => Promise<void> | undefined;
  },
): EnqueueOutcome<T> {
  const max = cmdQueueMax();
  const priorityStop = opts?.priorityStop === true;
  const waitList = priorityStop ? undefined : opts?.waitForSlot;
  let q = adapterCommandQueues.get(adapterId);
  if (q && !priorityStop) {
    // full = no room, or commands of this kind or of a kind admitted earlier already wait for a slot (they go first)
    const full =
      q.depth >= max || q.interlockWaiters.length > 0 || (waitList !== "interlock" && q.unverifiedWaiters.length > 0);
    if (full) {
      if (waitList === undefined) return { accepted: false, depth: q.depth, max };
      if (waitList === "interlock" && q.interlockWaiters.length >= OT_INTERLOCK_WAIT_MAX) return { accepted: false, depth: q.depth, max };
      if (waitList === "unverified" && q.unverifiedWaiters.length >= OT_STOP_UNVERIFIED_WAIT_MAX) return { accepted: false, depth: q.depth, max, reason: "STOP_UNVERIFIED_QUEUE_FULL" };
    }
  }
  if (!q) {
    q = { inFlight: false, running: null, pending: [], depth: 0, interlockWaiters: [], unverifiedWaiters: [] };
    adapterCommandQueues.set(adapterId, q);
  }
  const queue = q;

  const key = priorityStop ? (opts?.identicalStopKey ?? null) : null;
  if (key !== null) {
    const live = (j: PendingAdapterCommand | null | undefined) => j && j.identicalStopKey === key && !j.settled && j.result;
    const same = live(queue.running) ? queue.running : queue.pending.find((j) => live(j));
    if (same?.result) {
      same.callers += 1;
      if (opts?.shareIntentIds && same.intentIds) same.intentIds.push(...opts.shareIntentIds);
      if (same === queue.running) bumpAdapterStopEpoch(adapterId, opts?.stopRef ?? null);
      cancelWaitingForStop(adapterId, queue, opts?.stopRef); // a newer STOP intent: nothing waiting before it runs after it
      return { accepted: true, result: same.result as Promise<T | Superseded | QueueExpired>, joined: true };
    }
  }

  let settle!: { resolve: (v: T | Superseded | QueueExpired) => void; reject: (e: unknown) => void };
  const result = new Promise<T | Superseded | QueueExpired>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const job: PendingAdapterCommand = {
    priorityStop,
    contentStop: priorityStop && opts?.stopRef?.contentStop === true,
    protective: opts?.protective === true,
    overridesStopPin: opts?.overridesStopPin === true,
    identicalStopKey: key,
    ...(key !== null ? { result, intentIds: opts?.shareIntentIds } : {}),
    settled: false,
    callers: 1,
    enqueuedAt: Date.now(),
    ttlMs:
      !priorityStop && opts?.protective !== true && typeof opts?.queueTtlMs === "number" && Number.isFinite(opts.queueTtlMs) && opts.queueTtlMs > 0
        ? opts.queueTtlMs
        : null,
    run: () => {
      // R1a T5 (K9) — its turn came too late: never run (nothing sent), the slot is freed and the next command runs.
      const waitedMs = Date.now() - job.enqueuedAt;
      if (job.ttlMs !== null && waitedMs > job.ttlMs) {
        job.settled = true;
        queue.depth -= 1;
        settle.resolve({ queueExpired: true, waitedMs, ttlMs: job.ttlMs });
        pumpAdapterQueue(adapterId, queue);
        return;
      }
      queue.inFlight = true;
      queue.running = job;
      const ctl: QueueJobCtl = {
        writeAnswered: () => {
          job.settled = true;
        },
      };
      let p: Promise<T>;
      try {
        p = Promise.resolve(fn(ctl));
      } catch (err) {
        p = Promise.reject(err);
      }
      // Lệnh đang bay kết thúc (thành công HAY lỗi) ⇒ nhả hàng, chạy lệnh kế, rồi trả kết quả cho người gọi.
      const done = (): void => {
        queue.inFlight = false;
        if (queue.running === job) queue.running = null;
        queue.depth -= 1;
        pumpAdapterQueue(adapterId, queue);
      };
      p.then(
        (v) => {
          job.settled = true;
          let hold: Promise<void> | undefined;
          try {
            hold = opts?.holdSlot?.(v);
          } catch {
            hold = undefined;
          }
          if (hold) {
            // B3 — answer the caller now, keep the slot until the hold settles (bounded by its producer).
            hold.then(done, done);
            settle.resolve(v);
            return;
          }
          done();
          settle.resolve(v);
        },
        (err) => {
          job.settled = true;
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

  const enqueue = (): void => {
    if (priorityStop) {
      // Đứng sau DỪNG cuối cùng đang chờ (DỪNG chạy theo thứ tự tới), hoặc đầu hàng; R-11-o (M-1): DỪNG ghim đứng trước mọi DỪNG theo nội dung.
      let at = 0;
      for (let i = 0; i < queue.pending.length; i++) {
        const j = queue.pending[i];
        if (j.priorityStop && (job.contentStop || !j.contentStop)) at = i + 1;
      }
      queue.pending.splice(at, 0, job);
    } else queue.pending.push(job);
    queue.depth += 1;
  };
  if (priorityStop) {
    // R-1E-a — huỷ mọi lệnh KHÔNG phải DỪNG đang CHỜ (lệnh đang bay không nằm trong `pending`) — trừ hành động interlock bảo vệ
    // (R-11-h) không ghi đè ghim (R-11-k 3). R-1E-b — CỐ Ý gồm cả lệnh "stop" chưa xác minh đang chờ (trong hàng hoặc chờ chỗ).
    cancelWaitingForStop(adapterId, queue, opts?.stopRef);
    enqueue();
  } else if (waitList !== undefined && (queue.depth >= max || queue.interlockWaiters.length > 0 || (waitList === "unverified" && queue.unverifiedWaiters.length > 0))) {
    // R-11-n / R-11-o — wait for a slot (the caps were checked above)
    (waitList === "interlock" ? queue.interlockWaiters : queue.unverifiedWaiters).push({
      admit: enqueue,
      cancel: (byStop) => settle.resolve(byStop ? { superseded: true, byStop: true, stop: byStop } : { superseded: true, byStop: true }),
      overridesStopPin: opts?.overridesStopPin === true,
    });
    return { accepted: true, result };
  } else enqueue();
  pumpAdapterQueue(adapterId, queue);
  return { accepted: true, result };
}


/**
 * doc 81 Đợt 4 Task B3 (QĐ-4b) — the queue-slot hold of a write that TIMED OUT. Before: the slot was released at the
 * timeout while the write could still be running on the driver's session, so a STOP queued behind it ran at the same
 * time on the same session. Now the slot is held until
 *   (a) the old write settles (the next command then runs on the same, now idle session), or
 *   (b) OT_TIMED_OUT_WRITE_GRACE_MS expires ⇒ the session is reset through the EXISTING reconnect path
 *       (otManager.resetAdapterSession: connection supervisor, or the legacy watchdog's own steps), bounded by
 *       adapterSessionResetBoundMs (that path's connect timeout). The next command (a STOP) runs on the fresh session.
 * L-7 — a STOP is never held indefinitely: if the reset fails or exceeds its bound, the slot is released anyway (the
 * STOP proceeds), logged and audited as `overlapRisk` (control_audit_log "ot_write_overlap_risk").
 * WORST-CASE extra STOP start latency, counted from the old write's own timeout:
 *   OT_TIMED_OUT_WRITE_GRACE_MS + adapterSessionResetBoundMs + OT_SESSION_RESET_SLACK_MS
 *   = 1 s + connect timeout (default 10 s) + 0.25 s = 11.25 s.
 * fix scan (1): the reset is COOPERATIVE — it spends at most its budget (all steps) and then has itself given up, so it
 * never completes "late" and replaces the session a STOP is using; a connect landing after the budget is reaped, never
 * made active. The old write may still land on the device after the STOP — see startStopWatch (read-only, alarm only).
 * CUMULATIVE (fix round 1, review #4): the bound is PER timed-out predecessor. STOPs do not supersede each other, so N
 * queued commands that EACH time out ahead of a STOP delay it by up to N × (write timeout + 11.25 s).
 * Applies ONLY with OT_CMD_SERIALIZE_ENABLED (there is no queue slot otherwise — residual risk, reported).
 * Non-STOP commands behind it wait for the slot the same way. Never rejects.
 */
async function holdSlotAfterTimedOutWrite(
  input: DispatchInput,
  write: Promise<unknown>,
  ledger: { intentIds: number[]; confirmedBy: number },
  sink?: OtDeviceEventSink,
): Promise<void> {
  try {
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const first = await Promise.race([
      write.then(
        () => "settled" as const,
        () => "settled" as const,
      ),
      new Promise<"grace">((resolve) => {
        graceTimer = setTimeout(() => resolve("grace"), OT_TIMED_OUT_WRITE_GRACE_MS);
      }),
    ]);
    clearTimeout(graceTimer);
    if (first === "settled") return;

    // The old write is abandoned with its fate unknown. Fix round 1 (R-4-r): the risk entry is LIVE for the whole reset
    // (until = ∞) and gets its TTL only when the reset SETTLES (success, failure or budget expiry) — a full-budget reset
    // can no longer expire it before the STOP behind it runs. The STOP's read-only watch then runs TTL from the STOP.
    sweepStaleWriteRisk();
    const riskEntry: StaleWrite = {
      until: Number.POSITIVE_INFINITY,
      windowMs: staleWriteRiskWindowMs(input.adapterId),
      commandType: input.commandType,
      idempotencyKey: input.idempotencyKey ?? null,
      intentIds: ledger.intentIds,
      confirmedBy: ledger.confirmedBy,
      machineId: input.machineId ?? null,
      writes: input.writes.map((w) => ({ tagKey: w.tagKey, value: w.value })),
    };
    staleWriteRisk.set(input.adapterId, riskEntry);
    // fix scan (1) — the reset gets ONE budget it honours itself (cooperative); the outer deadline adds only a slack.
    const resetBoundMs = adapterSessionResetBoundMs(input.adapterId);
    let resetError: string;
    try {
      const r = await withDeadline(
        resetAdapterSession(input.adapterId, `timed-out write still pending after ${OT_TIMED_OUT_WRITE_GRACE_MS}ms grace (B3)`, resetBoundMs),
        resetBoundMs + OT_SESSION_RESET_SLACK_MS,
        `adapter ${input.adapterId} session reset`,
      );
      if (r.reset) {
        console.warn(`[Dispatch] adapter ${input.adapterId}: timed-out write still pending after its grace — driver session reset via ${r.via} before the next command (B3)`);
        return;
      }
      resetError = r.error ?? "session not reset";
    } catch (err) {
      resetError = (err as Error)?.message || String(err);
    } finally {
      // R-4-r — the reset has settled (any outcome): the risk window now counts from here.
      riskEntry.until = Date.now() + riskEntry.windowMs;
    }
    console.error(
      `[Dispatch] adapter ${input.adapterId}: overlapRisk — a timed-out write may still be running on the old session and its reset failed (${resetError}); the next command (a STOP) proceeds anyway (L-7, B3)`,
    );
    auditWriteOverlapRisk(input, ledger, { graceMs: OT_TIMED_OUT_WRITE_GRACE_MS, resetBoundMs, resetError, intentIds: ledger.intentIds }, sink);
  } catch (err) {
    console.error(`[Dispatch] adapter ${input.adapterId}: timed-out write slot hold failed (slot released):`, (err as Error)?.message || err);
  }
}

/**
 * doc 81 Đợt 4 Task B3 — ALERT-ONLY STOP watch (owner decision 2026-10-10, ruling R-4-q). After a STOP to an adapter
 * whose earlier write was abandoned with its outcome unknown (staleWriteRisk), this watch READS the STOP's tags until the
 * risk window ends. It NEVER writes to the device — no automatic re-assert exists.
 *   • DETACHED: holds no queue slot, never delays the STOP's answer or any later command.
 *   • Reads go through the SAME target the STOP used: the connection fingerprint and the driver object captured at the
 *     STOP. If the adapter was reconfigured (fingerprint changed) or its driver replaced, nothing is read through the new
 *     target: the same single critical alarm is raised (reason target_changed — "cannot verify, check manually").
 *   • A newer command whose write to one of the STOP's tags is DISPATCHED releases that tag (releaseWatchedTags); no tag
 *     left ⇒ the watch ends quietly (the operator's later intent owns those tags).
 *   • A read that shows a value other than the STOP's, or a tag that cannot be read (read error, missing sample, adapter
 *     offline) ⇒ ONE critical operator alarm per STOP (raiseStopUnverifiedAlarm) + audit "ot_stop_unverified" linked to
 *     the ABANDONED command's ledger row (entityId = its intent id), then the watch ends.
 * The window starts at the STOP and lasts the adapter's risk window (R-4-r; Đợt 5 F3 windowMs). Reads per STOP ≤ (window / poll), each ≤ the
 * command timeout. Never rejects.
 */
function startStopWatch(
  input: DispatchInput,
  stopDriver: OtDriver,
  stopFingerprint: string | undefined,
  writes: Array<{ tagKey: string; value: unknown }>,
  readTags: OtTagAddress[],
  timeoutMs: number,
  ledger: { intentIds: number[]; confirmedBy: number },
  sink?: OtDeviceEventSink,
): void {
  const token: StopWatch = { cancelled: false, tags: new Set(writes.map((w) => w.tagKey)) };
  registerStopWatch(input.adapterId, token);
  const risk = staleWriteRisk.get(input.adapterId);
  // R-4-r — the watch window starts at the STOP and lasts the adapter's risk window (Đợt 5 F3; no risk ⇒ no window).
  const end = risk ? Date.now() + risk.windowMs : Date.now();
  const abandoned = risk
    ? { idempotencyKey: risk.idempotencyKey, intentIds: risk.intentIds, commandType: risk.commandType, confirmedBy: risk.confirmedBy, writes: risk.writes }
    : null;
  const stopRef = { idempotencyKey: input.idempotencyKey ?? null, intentIds: ledger.intentIds, commandType: input.commandType };
  void (async () => {
    try {
      const tol = readbackFloatTolerance();
      while (!token.cancelled && Date.now() < end) {
        await new Promise((r) => setTimeout(r, OT_STOP_WATCH_POLL_MS));
        if (token.cancelled) break;
        // Same target as the STOP: a changed connection fingerprint (adapter reconfigured — or, on the legacy path, the adapter
        // momentarily out of the active set during a reconnect) or a replaced driver ⇒ the ONE critical alarm "cannot verify —
        // check manually" (reason target_changed), nothing read through another target, then the watch ends.
        const fpNow = getActiveConnectionFingerprint(input.adapterId);
        const drvNow = getActiveDriver(input.adapterId);
        if (fpNow !== stopFingerprint || (drvNow !== undefined && drvNow !== stopDriver)) {
          // Fix round 1 (R-4-s) — the STOP can no longer be verified on its own target: the same single critical alarm
          // (nothing is read through the new target), then the watch ends.
          raiseStopUnverifiedAlarm(input, ledger, abandoned, stopRef, [], readTags.filter((t) => token.tags.has(t.tagKey)).map((t) => t.tagKey), "target_changed", sink);
          break;
        }
        const tags = readTags.filter((t) => token.tags.has(t.tagKey));
        if (tags.length === 0) break;
        let samples: Array<{ tagKey: string; value: unknown; quality?: string }> | null = null;
        if (drvNow) {
          try {
            const got = await withDeadline(Promise.resolve(stopDriver.readTags(tags)), timeoutMs, `adapter ${input.adapterId} STOP watch read`);
            samples = Array.isArray(got) ? got : null;
          } catch {
            samples = null;
          }
        }
        if (token.cancelled) break;
        const drift: Array<{ tagKey: string; expected: unknown; actual: unknown; abandonedValueLanded: boolean }> = [];
        const unread: string[] = [];
        for (const t of tags) {
          if (!token.tags.has(t.tagKey)) continue; // released by a newer command while we were reading
          const s = samples?.find((x) => x.tagKey === t.tagKey);
          const expected = writes.find((w) => w.tagKey === t.tagKey)?.value;
          // SCADA R0 (F2) — chỉ mẫu quality "good" mới xác nhận được STOP: uncertain mang giá trị CŨ (last usable), bad không có giá trị.
          if (!s || s.value == null || s.quality !== "good") unread.push(t.tagKey);
          else if (!readbackMatches(expected, s.value, t.dataType, tol)) {
            const old = abandoned?.writes.find((w) => w.tagKey === t.tagKey);
            drift.push({ tagKey: t.tagKey, expected, actual: s.value as unknown, abandonedValueLanded: old != null && readbackMatches(old.value, s.value, t.dataType, tol) });
          }
        }
        if (drift.length === 0 && unread.length === 0) continue;
        // ONE alarm per STOP, then the watch is done (no spam). Nothing is written.
        raiseStopUnverifiedAlarm(input, ledger, abandoned, stopRef, drift, unread, undefined, sink);
        break;
      }
    } catch (err) {
      console.error(`[Dispatch] adapter ${input.adapterId}: STOP watch failed:`, (err as Error)?.message || err);
    } finally {
      token.cancelled = true;
      unregisterStopWatch(input.adapterId, token);
    }
  })();
}

/**
 * B3 alert-only — the CRITICAL operator alarm of an unverified STOP, through the existing paths:
 *   • the unified alert stream: an `anomaly.detected` event with severity "critical" (NotificationCenter toasts critical
 *     items even while the bell is snoozed — R-3c-a);
 *   • the persisted inbox: an URGENT notification (counted while snoozed — R-3c-a) to the STOP's confirmer and the
 *     abandoned command's confirmer;
 *   • control_audit_log "ot_stop_unverified" on the ABANDONED command (entityId = its intent row).
 * Fire-and-forget, bounded; never throws, never writes to a device.
 */
function raiseStopUnverifiedAlarm(
  input: DispatchInput,
  stopLedger: { intentIds: number[]; confirmedBy: number },
  abandoned: { idempotencyKey: string | null; intentIds: number[]; commandType: string; confirmedBy: number } | null,
  stopRef: { idempotencyKey: string | null; intentIds: number[]; commandType: string },
  drift: Array<{ tagKey: string; expected: unknown; actual: unknown; abandonedValueLanded: boolean }>,
  unread: string[],
  reason: "drift" | "unreadable" | "target_changed" = drift.length > 0 ? "drift" : "unreadable",
  sink?: OtDeviceEventSink,
): void {
  const tags = [...drift.map((d) => d.tagKey), ...unread];
  const what =
    reason === "target_changed"
      ? `cannot be verified — the adapter's connection changed after the STOP (reconfigured, reconnecting or driver replaced); check manually (${unread.join(", ")})`
      : drift.length > 0
        ? `reads back a value other than the STOP's on ${drift.map((d) => d.tagKey).join(", ")}`
        : `cannot be read back (${unread.join(", ")})`;
  const message =
    `STOP on adapter ${input.adapterId} ${what} after an earlier command timed out with an unknown outcome — ` +
    `the device may have been re-energised. Check the equipment on site now. Nothing was re-sent automatically.`;
  console.error(`[Dispatch] CRITICAL: ${message}`);
  // Fix round 1 (R-4-s #6) — a SYSTEM observation: actor = system (null); the abandoned command's confirmer is in the detail.
  const detail = {
    reason,
    drift,
    unread,
    stop: stopRef,
    abandonedWrite: abandoned ? { idempotencyKey: abandoned.idempotencyKey, intentIds: abandoned.intentIds, commandType: abandoned.commandType, confirmedBy: abandoned.confirmedBy } : null,
  };
  if (sink) {
    // R-10-x — edge: ONE critical event through the injected sink (journal → central); no DB, no inbox from here.
    emitToSink(sink, input, "ot_stop_unverified", true, message, detail);
    return;
  }
  auditOtEvent(
    abandoned ? { ...input, commandType: abandoned.commandType, idempotencyKey: abandoned.idempotencyKey ?? input.idempotencyKey } : input,
    abandoned ? { intentIds: abandoned.intentIds, confirmedBy: abandoned.confirmedBy } : stopLedger,
    "ot_stop_unverified",
    detail,
    "B3 alert-only (R-4-q): after a STOP that followed a timed-out write, the STOP value could not be confirmed — operator alarm raised, nothing written",
    null,
  );
  const recipients = [...new Set([stopLedger.confirmedBy, abandoned?.confirmedBy].filter((u): u is number => typeof u === "number" && u > 0))];
  const work = (async () => {
    // Dynamic imports: the ecosystem/notification modules pull in heavy graphs (and would form static cycles).
    const { publishAnomalyDetected } = await import("../ecosystem/ecosystemEvents");
    publishAnomalyDetected(
      { kind: "ot_stop_unverified", severity: "critical", source: "ot", machineId: input.machineId ?? null, message: `STOP not confirmed on adapter ${input.adapterId} (${tags.join(", ")})` },
      "ot",
    );
    const { sendNotification } = await import("../notificationService");
    for (const userId of recipients) {
      // doc 81 Đợt 5 task F6 (item 33) — SAFETY-CRITICAL: delivered even to a recipient who opted out of in-app
      // notifications / alerts or is in quiet hours (the STOP's confirmer must learn the STOP was not confirmed).
      await sendNotification(
        userId,
        {
          type: "ALERT",
          priority: "URGENT",
          title: `STOP not confirmed — adapter ${input.adapterId}`,
          message,
          entityType: "ot_command",
          entityId: abandoned?.intentIds[0] ?? stopLedger.intentIds[0],
          metadata: detail,
        },
        // fix 1 / fix scan (R-5-f, R-5-h) — bypass deduped per OCCURRENCE (type, machine, this STOP's ledger row) and
        // recipient for 60 s; another STOP's alarm is a distinct occurrence and is never merged.
        // final wave F1 (ruling R-8-d) — exempt from the per-recipient bypass cap: a burst of safety-event trips (correlated
        // in time with STOPs) must never downgrade this alarm; it is still deduped per occurrence above.
        {
          safetyCritical: true,
          capExempt: "ot_stop_unverified",
          dedupKey: `ot_stop_unverified:${input.machineId != null ? `machine:${input.machineId}` : `adapter:${input.adapterId}`}:stop:${stopLedger.intentIds[0] ?? "?"}`,
        },
      );
    }
  })();
  void withDeadline(work, OT_STOP_OVERRIDE_AUDIT_DEADLINE_MS, "ot_stop_unverified notification").catch((err) => {
    console.error(`[Dispatch] ot_stop_unverified notification failed or is stuck:`, (err as Error)?.message || err);
  });
}

/** B3 — control_audit_log "ot_write_overlap_risk", fire-and-forget under a deadline (never holds the queue). */
function auditWriteOverlapRisk(
  input: DispatchInput,
  ledger: { intentIds: number[]; confirmedBy: number },
  /** R-11-k (2) / R-11-n — intentIds: EVERY intent the timed-out write carried (identical STOPs dropped onto it included), for the late-result review */
  detail: { graceMs: number; resetBoundMs: number; resetError: string; intentIds?: number[] },
  sink?: OtDeviceEventSink,
): void {
  if (sink) {
    emitToSink(sink, input, "ot_write_overlap_risk", true, `adapter ${input.adapterId}: a timed-out write was still pending after its grace and the session could not be reset — the next command (a STOP) proceeded (L-7)`, { overlapRisk: true, ...detail });
    return;
  }
  auditOtEvent(
    input,
    ledger,
    "ot_write_overlap_risk",
    { overlapRisk: true, ...detail },
    "B3 (QĐ-4b): a timed-out write was still pending after its grace and the driver session could not be reset in time — the next command proceeded (L-7: a STOP is never held indefinitely)",
  );
}

/** B3 — the audit module, imported ONCE (dynamic: avoids a static cycle) and shared by every B3 audit row. */
let controlAuditModule: Promise<typeof import("../audit/controlAuditService")> | undefined;
function loadControlAudit(): Promise<typeof import("../audit/controlAuditService")> {
  controlAuditModule ??= import("../audit/controlAuditService");
  return controlAuditModule;
}

/** B3 — one control_audit_log row about an OT command, fire-and-forget under a deadline (never holds anything). */
function auditOtEvent(
  input: DispatchInput,
  ledger: { intentIds: number[]; confirmedBy: number },
  action: string,
  detail: Record<string, unknown>,
  reason: string,
  /** actorId of the row; default = the ledger's confirmer. null = system (fix round 1, R-4-s #6). */
  actorId: number | null = ledger.confirmedBy,
): void {
  const work = (async () => {
    const db = await getDb();
    if (!db) {
      console.error(`[Dispatch] audit ${action} skipped for adapter ${input.adapterId} — no DB`);
      return;
    }
    const { recordAuditEvent } = await loadControlAudit();
    await recordAuditEvent(db, {
      entityType: "ot_command",
      entityId: ledger.intentIds[0] ?? input.idempotencyKey ?? "unrecorded",
      action,
      actorId,
      after: {
        adapterId: input.adapterId,
        machineId: input.machineId ?? null,
        commandType: input.commandType,
        idempotencyKey: input.idempotencyKey ?? null,
        ...detail,
      },
      reason,
    });
  })();
  void withDeadline(work, OT_STOP_OVERRIDE_AUDIT_DEADLINE_MS, `${action} audit`).catch((err) => {
    console.error(`[Dispatch] audit ${action} failed or is stuck for adapter ${input.adapterId}:`, (err as Error)?.message || err);
  });
}

/** Upper bound after which a still-pending pinned-stop override audit is logged as stuck (never awaited by the stop). */
export const OT_STOP_OVERRIDE_AUDIT_DEADLINE_MS = 10_000;


/**
 * doc 81 Đợt 10 task D fix review 1 (R-10-x) — where the device stage's ALARMS / AUDITS go. Absent (central) ⇒ the existing DB
 * paths (control_audit_log, the safety-critical inbox, the alert stream) — byte-identical. On the EDGE the front end injects one
 * that journals an `anomaly` event (E's report sink) — the device stage then never reaches a DB (no trap hit).
 */
export type OtDeviceEventSink = (ev: { action: string; critical: boolean; adapterId: number; machineId: number | null; commandType: string; idempotencyKey: string | null; message: string; detail: Record<string, unknown> }) => void;
function emitToSink(sink: OtDeviceEventSink, input: DispatchInput, action: string, critical: boolean, message: string, detail: Record<string, unknown>): void {
  try {
    sink({ action, critical, adapterId: input.adapterId, machineId: input.machineId ?? null, commandType: input.commandType, idempotencyKey: input.idempotencyKey ?? null, message, detail });
  } catch (err) {
    console.error(`[Dispatch] device-stage event sink failed (${action}, adapter ${input.adapterId}):`, (err as Error)?.message || err);
  }
}

/** One resolved write as the device stage needs it (address / dataType / scale / offset from the tag row or the signed snapshot). */
export interface OtResolvedWrite {
  write: { tagKey: string; value: unknown };
  address: string;
  dataType?: string;
  scale?: number;
  offset?: number;
}

/**
 * doc 81 Đợt 11 K-fix (R-11-d) — the device stage behind the STOP-epoch check: a write whose gates began at `stopEpochAtGates` is
 * cancelled when a STOP was EXECUTED on its adapter since (nothing written, `StoppedBeforeWrite` returned); otherwise
 * executeOtDeviceWrite runs. Deliberately NOT async: the check and the call happen in one tick, and executeOtDeviceWrite reaches
 * driver.writeTags without an await — no STOP can be executed in between.
 * `stopEpochAtGates` null ⇒ no check: a TRUE stop (by content — K-fix 2, R-11-i a) and a protective interlock action (R-11-h).
 * A stop-LABELLED command with arbitrary writes is not a true stop: it records an epoch and is checked like any write.
 */
export function executeOtDeviceWriteUnlessStopped(
  a: Parameters<typeof executeOtDeviceWrite>[0] & {
    stopEpochAtGates: number | null;
    /**
     * doc 81 Đợt 12 final fix wave (ruling R-12-e I-1, scan #113) — the adapter has NO stop pin at all (the caller read the adapter's
     * pins and found none). A stop-TYPED command is exempt from PEER moves (I-2: a peer never denies the only software STOP there is)
     * ONLY when this is explicitly true. On an adapter WITH pins a verified STOP exists, so a peer STOP cancels a stop-labelled command
     * that is not a verified STOP (an unpinned tag, the pin value plus an unpinned tag, a non-pin value) exactly as a local STOP does —
     * the replica the load balancer picked changes nothing. Absent (a pin read failure, the edge) ⇒ not exempt.
     * (Was, P fix 1 + scan #112: exempt when `overridesStopPin === false` — still decided by the label for writes that touch no pin.)
     */
    adapterHasNoStopPins?: boolean | (() => boolean);
  },
): Promise<ExecutedWrite | StoppedBeforeWrite> {
  if (a.stopEpochAtGates !== null) {
    // I-2 / R-12-e I-1 — peer moves ignored only where no pin exists. R-12-f item 1: the answer may be LAZY (a synchronous cache
    // lookup, taken here at the check — no await before the device write); a throw / anything but true ⇒ not exempt.
    const x = a.adapterHasNoStopPins;
    let noPins = false;
    try {
      noPins = typeof x === "function" ? x() === true : x === true;
    } catch {
      noPins = false;
    }
    const localOnly = a.stopTyped && noPins;
    const stopped = stopIssuedSince(a.input.adapterId, a.stopEpochAtGates, { localOnly });
    if (stopped) return Promise.resolve(stopped);
  }
  return executeOtDeviceWrite(a);
}

/**
 * The write + verify body of ONE command (moved unchanged from dispatchCore's executeWriteAndVerify, minus the pre-write safety
 * re-check, which stays a dispatcher gate). Never throws for expected failure modes (driver errors are caught).
 */
export async function executeOtDeviceWrite(a: {
  input: DispatchInput;
  driver: OtDriver;
  resolved: OtResolvedWrite[];
  driverWrites: Array<{ tagKey: string; address: string; value: unknown; dataType: any; scale?: number; offset?: number }>;
  timeoutMs: number;
  /** the command TYPE is a stop (stop / e_stop) — selects the B3 read-only STOP watch */
  stopTyped: boolean;
  ledger: { intentIds: number[]; confirmedBy: number };
  /** R-10-x — the edge's alarm / audit sink; absent ⇒ central's DB paths (unchanged) */
  sink?: OtDeviceEventSink;
  /**
   * doc 81 Đợt 11 K-fix 2 (R-11-i b) — this write IS a STOP (by content) and moves the adapter's STOP epoch when it is SENT (here,
   * right before driver.writeTags) — never on receipt, never before authorisation. Central / edge pass whether the command is a true
   * stop; absent ⇒ `stopTyped` (central's fallback / sweep STOP, which writes only the adapter's pinned stop values).
   */
  bumpStopEpoch?: boolean;
  /** doc 81 Đợt 11 R-11-o (M-2) — called once the device WRITE has answered, failed or timed out (before the read-back): the queue's share window ends */
  onWriteAnswered?: () => void;
}): Promise<ExecutedWrite> {
  const { input, driver, resolved, driverWrites, timeoutMs, stopTyped } = a;
  const { intentIds, confirmedBy: ledgerConfirmer } = a.ledger;
  // R-11-d — NO await may precede driver.writeTags below: executeOtDeviceWriteUnlessStopped checks the STOP epoch in the same
  // tick as this call (its check is "right before the device write"), and this bump is "when the STOP is sent" (K-fix 2, R-11-i b).
  if (a.bumpStopEpoch ?? stopTyped) bumpAdapterStopEpoch(input.adapterId, { idempotencyKey: input.idempotencyKey ?? null, commandType: input.commandType });
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
  const sentAt = new Date();

  let writeResults: Awaited<ReturnType<typeof driver.writeTags>> | typeof TIMEOUT;
  let threwError: string | null = null;
  // doc 81 Đợt 4 Task B3 — keep the write promise: after a timeout it may still be running on the session.
  let writePromise: Promise<unknown> | undefined;
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    // B3 fix scan 3 (a) — this write is DISPATCHED now: a running STOP watch gives up exactly these tags (the newer
    // intent for them wins); watches on other tags keep running.
    releaseWatchedTags(input.adapterId, driverWrites.map((w) => w.tagKey));
    const wp = Promise.resolve(driver.writeTags(driverWrites));
    writePromise = wp;
    wp.catch(() => undefined); // a late rejection after the timeout is expected, never unhandled
    writeResults = await Promise.race([
      wp,
      new Promise<typeof TIMEOUT>((resolve) => {
        writeTimer = setTimeout(() => resolve(TIMEOUT), timeoutMs);
      }),
    ]);
  } catch (err) {
    threwError = (err as Error)?.message || String(err);
    writeResults = [];
  } finally {
    clearTimeout(writeTimer);
    try {
      a.onWriteAnswered?.();
    } catch {
      /* a queue bookkeeping hook never fails the write */
    }
  }

  // Decide a per-write outcome from the write result (status BEFORE read-back).
  const timedOut = writeResults === TIMEOUT;
  // B3 — a timed-out write keeps the adapter's queue slot (only the serialized path has one) until it settles or
  // its grace expires and the session is reset; the caller's answer is not delayed by this.
  const slotHold =
    timedOut && writePromise && isCmdSerializeEnabled()
      ? holdSlotAfterTimedOutWrite(input, writePromise, { intentIds, confirmedBy: ledgerConfirmer }, a.sink)
      : undefined;
  const resultsArr = Array.isArray(writeResults) ? writeResults : [];

  const outcomes: Outcome[] = resolved.map((r, i) => {
    if (timedOut) {
      // B3 fix scan (2) — a timeout is NOT "not applied": the device may have applied (part of) it.
      return {
        idx: i,
        ok: false,
        status: "timeout",
        errorText: `write timeout after ${timeoutMs}ms — outcome unknown: the write may have been applied on the device`,
        readBackValue: null,
      };
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

  // SCADA R0 Task 6 (C8) — đếm kết quả GHI theo từng tag (trước read-back: read-back không bao giờ lật ok). Timeout/ném ⇒ lỗi. Không ném.
  for (const o of outcomes) ghiNhanLenh(input.adapterId, resolved[o.idx].write.tagKey, o.ok);

  // ── G2.1 READ-BACK — ONLY when control + read-back enabled AND ≥1 write acked.
  //    A SINGLE driver.readTags() (under the same timeout). readTags throwing /
  //    timing out → ALL acked writes become acked_unverified (WARN only; NO retry).
  //    SCADA R1a Task 5 (K7) — `input.docLai === "bat_buoc"` (the HMI path) forces this read-back even with OT_READBACK_ENABLED off;
  //    the comparison below is the same (readbackMatches + quality "good"). Absent ⇒ the flag alone decides, as before.
  if ((isOtReadbackEnabled() || input.docLai === "bat_buoc") && outcomes.some((o) => o.status === "acked")) {
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
    let rbTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      samples = await Promise.race([
        driver.readTags(readTags),
        new Promise<typeof RB_TIMEOUT>((resolve) => {
          rbTimer = setTimeout(() => resolve(RB_TIMEOUT), timeoutMs);
        }),
      ]);
      if (samples === RB_TIMEOUT) readbackUnavailable = true;
    } catch {
      // readTags throwing → read-back unavailable (NOT failed, NO retry).
      readbackUnavailable = true;
    } finally {
      clearTimeout(rbTimer); // R1a T5 fix round 1 — the race timer no longer lingers for timeoutMs after the read answered
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
      // SCADA R0 (F2) — chỉ mẫu quality "good" mới xác minh được lệnh ghi: uncertain mang giá trị CŨ (last usable) nên khớp giá trị
      // không chứng minh gì; uncertain/bad ⇒ acked_unverified.
      const matched = s != null && s.quality === "good" && readbackMatches(r.write.value, actual, dataType, tol);
      if (matched) {
        o.status = "acked_verified";
        o.readBackValue = actual;
      } else {
        o.status = "acked_unverified";
        o.readBackValue = actual;
        o.errorText =
          s != null && s.quality !== "good"
            ? `readback not verified: sample quality=${String(s.quality)} (expected=${String(r.write.value)} actual=${String(actual)})`
            : `readback mismatch: expected=${String(r.write.value)} actual=${String(actual)}`;
      }
    }
  }

  // B3 alert-only (R-4-q) — a STOP after an abandoned write whose fate is unknown: a DETACHED read-only watch (no queue
  // slot, the STOP's answer is returned now — L-7) alarms the operator if the STOP value cannot be confirmed.
  if (!timedOut && isCmdSerializeEnabled() && stopTyped && staleWriteRiskActive(input.adapterId)) {
    const acked = outcomes.filter((o) => o.ok).map((o) => o.idx);
    if (acked.length > 0) {
      startStopWatch(
        input,
        driver,
        getActiveConnectionFingerprint(input.adapterId),
        acked.map((i) => driverWrites[i]),
        acked.map((i) => ({
          tagKey: resolved[i].write.tagKey,
          address: resolved[i].address,
          dataType: (resolved[i].dataType ?? "float") as OtTagAddress["dataType"],
          scale: resolved[i].scale,
          offset: resolved[i].offset,
        })),
        timeoutMs,
        { intentIds, confirmedBy: ledgerConfirmer },
        a.sink,
      );
    }
  }
  return { sentAt, timedOut, outcomes, ...(slotHold ? { slotHold } : {}) };
}
