/**
 * doc 44 W2-B1 / G2.17 — WS subscription contract: SNAPSHOT-THEN-STREAM
 * (SYNAPSE Tầng 2 §12 — /v1/subscribe semantics over the existing Socket.IO).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Client protocol (all events ride the ALREADY-AUTHENTICATED socket — the
 * io.use() handshake middleware in server/_core/socket.ts:85-110 is the guard;
 * additionally only `clientType === 'browser'` sockets may subscribe here,
 * machine sockets bypass cookie auth and have no business on this stream):
 *
 *   → 'uns:subscribe'   { path_prefix, aspects?: ('state'|'events')[], min_severity? }
 *   ← 'uns:snapshot'    { path_prefix, count, snapshots: StateSnapshot[], ts }   (a — ngay lập tức)
 *   ← 'uns:delta'       { aspect, path, ts, snapshot? | event? }                  (b — stream tiếp)
 *   ← 'uns:delta'       { coalesced: true, dropped: true, deltas: [...] }         (backpressure)
 *   ← 'uns:heartbeat'   { path_prefix, ts }                                       (30s/prefix có subscriber)
 *   → 'uns:unsubscribe' { path_prefix? }                                          (omit → all)
 *
 * ORDER GUARANTEE (§12.2 "snapshot+stream"): the subscription is registered and
 * the snapshot emitted in the SAME synchronous tick, so no delta can interleave
 * before the snapshot.
 *
 * DELTA SOURCES — the SAME write points task G2.12 hooks:
 *   • state  — stateStore.onStateUpdate (every setState, live + db-fallback).
 *   • events — the in-process eventBus (ANDON / SAFETY_EVENT / NG_ALERT), each
 *     resolved machineId → ISA-95 path. HONEST: bus events WITHOUT a machineId
 *     (e.g. line-only safety events) cannot be path-addressed and are skipped.
 *
 * BACKPRESSURE (simple + honest): per-socket token window — over
 * WS_UNS_MAX_DELTAS_PER_SEC (default 50) or a large engine writeBuffer, deltas
 * are coalesced per (aspect:path) key with drop-oldest beyond 500 pending and
 * flushed every WS_UNS_COALESCE_FLUSH_MS (default 250 ms) as ONE frame marked
 * `dropped:true` — the client KNOWS it saw a thinned stream.
 *
 * Flag: WS_UNS_STREAM_ENABLED (default OFF → 'uns:subscribe' is a complete
 * no-op; nothing is emitted, no room is joined).
 * ════════════════════════════════════════════════════════════════════════════
 */

import { eventBus, EventTypes } from "../../_core/eventBus";
import { resolveIsa95Path } from "../uns/isa95Resolver";
import { isa95PathString } from "../uns/topicV2";
import { getByPrefix, normalizePath, onStateUpdate, type StateSnapshot } from "./stateStore";

// ─── Flag / tunables ──────────────────────────────────────────────────────────

export function wsUnsStreamEnabled(): boolean {
  return process.env.WS_UNS_STREAM_ENABLED === "true" || process.env.WS_UNS_STREAM_ENABLED === "1";
}

function maxDeltasPerSec(): number {
  const n = Number(process.env.WS_UNS_MAX_DELTAS_PER_SEC);
  return Number.isFinite(n) && n > 0 ? n : 50;
}

function coalesceFlushMs(): number {
  const n = Number(process.env.WS_UNS_COALESCE_FLUSH_MS);
  return Number.isFinite(n) && n >= 50 ? n : 250;
}

function heartbeatMs(): number {
  const n = Number(process.env.WS_UNS_HEARTBEAT_MS);
  return Number.isFinite(n) && n >= 1000 ? n : 30_000;
}

const MAX_PENDING_PER_SOCKET = 500;
const MAX_WRITE_BUFFER = 200;
const MAX_PREFIXES_PER_SOCKET = 20;

// ─── Aspect / severity vocabulary ────────────────────────────────────────────

export type UnsAspect = "state" | "events";
export type UnsSeverity = "info" | "warning" | "error" | "critical";

const SEVERITY_RANK: Record<UnsSeverity, number> = { info: 0, warning: 1, error: 2, critical: 3 };

function sanitizeAspects(raw: unknown): Set<UnsAspect> {
  const out = new Set<UnsAspect>();
  if (Array.isArray(raw)) {
    for (const a of raw) if (a === "state" || a === "events") out.add(a);
  }
  if (out.size === 0) {
    out.add("state");
    out.add("events");
  }
  return out;
}

function sanitizeSeverity(raw: unknown): UnsSeverity {
  const s = String(raw ?? "").toLowerCase();
  return s === "warning" || s === "error" || s === "critical" ? (s as UnsSeverity) : "info";
}

// ─── Socket structural type (real socket.io Socket satisfies this; mockable) ──

export interface UnsSocketLike {
  id: string;
  data?: Record<string, unknown>;
  on(event: string, cb: (...args: unknown[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
  join?(room: string): unknown;
  leave?(room: string): unknown;
  conn?: { writeBuffer?: unknown[] };
}

// ─── Delta shapes ─────────────────────────────────────────────────────────────

export interface UnsEventPayload {
  event_id: string;
  type: string;
  severity: UnsSeverity;
  ts: string;
  payload?: Record<string, unknown>;
}

export interface UnsDelta {
  aspect: UnsAspect;
  path: string;
  ts: string;
  snapshot?: StateSnapshot;
  event?: UnsEventPayload;
}

// ─── Per-socket registry + backpressure state ────────────────────────────────

interface SubOptions {
  aspects: Set<UnsAspect>;
  minSeverity: UnsSeverity;
}

interface SocketEntry {
  socket: UnsSocketLike;
  subs: Map<string, SubOptions>; // prefix → options
  // backpressure window
  windowStart: number;
  windowCount: number;
  pending: Map<string, UnsDelta>;
  pendingDropped: boolean;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

const registry = new Map<string, SocketEntry>();

// ─── Fan-out install (idempotent, lazy on first subscribe) ───────────────────

let fanoutInstalled = false;
let fanoutUnsubs: Array<() => void> = [];
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function ensureFanout(): void {
  if (fanoutInstalled) return;
  fanoutInstalled = true;

  // (1) STATE deltas — the same write point G2.12 uses (stateStore.setState).
  fanoutUnsubs.push(
    onStateUpdate((snap) => {
      fanoutDelta({ aspect: "state", path: snap.path, ts: snap.ts, snapshot: snap });
    }),
  );

  // (2) EVENT deltas — in-process bus events that carry a machineId.
  const busEvent = (
    type: string,
    toEvent: (payload: Record<string, unknown>) => { machineId: unknown; event: Omit<UnsEventPayload, "ts"> & { ts?: string } } | null,
  ) => {
    fanoutUnsubs.push(
      eventBus.subscribe(type, (e) => {
        void (async () => {
          try {
            const payload = (e.payload ?? {}) as Record<string, unknown>;
            const mapped = toEvent(payload);
            if (!mapped) return;
            const machineId = Number(mapped.machineId);
            if (!Number.isInteger(machineId) || machineId <= 0) return; // honest skip — not path-addressable
            const path = await resolveIsa95Path(machineId);
            if (!path) return;
            const ts = mapped.event.ts ?? new Date(e.ts).toISOString();
            fanoutDelta({
              aspect: "events",
              path: isa95PathString(path),
              ts,
              event: { ...mapped.event, ts },
            });
          } catch (err) {
            console.error("[UNS-WS] event fanout failed:", (err as Error)?.message ?? err);
          }
        })();
      }),
    );
  };

  busEvent(EventTypes.ANDON, (p) => ({
    machineId: p.machineId,
    event: {
      event_id: `andon-${p.id ?? "?"}-${p.event ?? "raised"}`,
      type: `andon:${p.reason ?? "unknown"}`,
      severity:
        p.state === "red" ? "critical" : p.state === "green" ? "info" : "warning",
      payload: { state: p.state, status: p.status, title: p.title, lineId: p.lineId ?? null },
      ts: p.raisedAt ? new Date(p.raisedAt as never).toISOString() : undefined,
    },
  }));

  busEvent(EventTypes.SAFETY_EVENT, (p) => ({
    // safety_events carry robotId/lineId, not machineId — most are skipped
    // honestly (see module header); machineId is used when a producer sets it.
    machineId: (p as { machineId?: unknown }).machineId,
    event: {
      event_id: `safety-${p.id ?? "?"}`,
      type: `safety:${p.eventType ?? "unknown"}`,
      severity: p.isNearMiss ? "warning" : "critical",
      payload: { outcome: p.outcome, detectedBy: p.detectedBy ?? null, lineId: p.lineId ?? null },
      ts: p.createdAt ? new Date(p.createdAt as never).toISOString() : undefined,
    },
  }));

  busEvent(EventTypes.NG_ALERT, (p) => ({
    machineId: p.machineId,
    event: {
      event_id: `ng-${p.machineId ?? "?"}-${p.serialNumber ?? Date.now()}`,
      type: "quality:ng",
      severity: "error",
      payload: { serialNumber: p.serialNumber ?? null, machineCode: p.machineCode ?? null },
    },
  }));
}

function ensureHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    try {
      if (registry.size === 0) {
        stopHeartbeat();
        return;
      }
      const ts = new Date().toISOString();
      for (const entry of registry.values()) {
        for (const prefix of entry.subs.keys()) {
          try {
            entry.socket.emit("uns:heartbeat", { path_prefix: prefix, ts });
          } catch {
            /* one dead socket must not break the sweep */
          }
        }
      }
    } catch (err) {
      console.error("[UNS-WS] heartbeat sweep failed:", (err as Error)?.message ?? err);
    }
  }, heartbeatMs());
  if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ─── Delta fan-out with per-socket filter + backpressure ─────────────────────

function matches(sub: SubOptions, delta: UnsDelta): boolean {
  if (!sub.aspects.has(delta.aspect)) return false;
  if (delta.aspect === "events") {
    const sev = delta.event?.severity ?? "info";
    if (SEVERITY_RANK[sev] < SEVERITY_RANK[sub.minSeverity]) return false;
  }
  return true;
}

function prefixMatches(prefix: string, path: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Fan a delta out to every matching subscription (exported for tests). */
export function fanoutDelta(delta: UnsDelta): void {
  if (registry.size === 0) return;
  for (const entry of registry.values()) {
    let match = false;
    for (const [prefix, sub] of entry.subs) {
      if (prefixMatches(prefix, delta.path) && matches(sub, delta)) {
        match = true;
        break;
      }
    }
    if (match) deliver(entry, delta);
  }
}

function deliver(entry: SocketEntry, delta: UnsDelta): void {
  const now = Date.now();
  if (now - entry.windowStart >= 1000) {
    entry.windowStart = now;
    entry.windowCount = 0;
  }
  const bufferedTooMuch = (entry.socket.conn?.writeBuffer?.length ?? 0) > MAX_WRITE_BUFFER;
  const overRate = entry.windowCount >= maxDeltasPerSec();

  if (!bufferedTooMuch && !overRate && entry.pending.size === 0) {
    entry.windowCount += 1;
    try {
      entry.socket.emit("uns:delta", delta);
    } catch {
      /* socket gone — disconnect cleanup will follow */
    }
    return;
  }

  // Coalesce: latest wins per (aspect:path) for state; events keyed by id.
  const key = delta.aspect === "state" ? `s:${delta.path}` : `e:${delta.event?.event_id ?? delta.ts}`;
  if (entry.pending.has(key)) entry.pendingDropped = true; // an older delta was replaced
  entry.pending.delete(key);
  entry.pending.set(key, delta);
  while (entry.pending.size > MAX_PENDING_PER_SOCKET) {
    const oldest = entry.pending.keys().next().value;
    if (oldest === undefined) break;
    entry.pending.delete(oldest);
    entry.pendingDropped = true; // drop-oldest — honest mark
  }
  if (!entry.flushTimer) {
    entry.flushTimer = setTimeout(() => flushPending(entry), coalesceFlushMs());
    if (typeof entry.flushTimer.unref === "function") entry.flushTimer.unref();
  }
}

function flushPending(entry: SocketEntry): void {
  entry.flushTimer = null;
  if (entry.pending.size === 0) return;
  const deltas = [...entry.pending.values()];
  const dropped = entry.pendingDropped;
  entry.pending.clear();
  entry.pendingDropped = false;
  entry.windowCount += 1; // one frame
  try {
    entry.socket.emit("uns:delta", {
      coalesced: true,
      dropped,
      count: deltas.length,
      deltas,
      ts: new Date().toISOString(),
    });
  } catch {
    /* socket gone */
  }
}

// ─── Handler registration (called from socket.ts on every connection) ─────────

/**
 * Register the 'uns:subscribe' / 'uns:unsubscribe' / disconnect handlers on a
 * socket. ADDITIVE — touches nothing else on the socket. With
 * WS_UNS_STREAM_ENABLED off (default) subscribe is a complete no-op.
 */
export function registerUnsStreamHandlers(socket: UnsSocketLike): void {
  socket.on("uns:subscribe", (raw: unknown) => {
    try {
      if (!wsUnsStreamEnabled()) return; // flag OFF → no-op (documented)
      // Same guard posture as the handshake middleware: only authenticated
      // browser clients (machine sockets bypass cookie auth per-event).
      if ((socket.data as Record<string, unknown> | undefined)?.clientType !== "browser") return;

      const req = (raw ?? {}) as Record<string, unknown>;
      const prefix = normalizePath(req.path_prefix);
      if (!prefix) {
        socket.emit("uns:error", { code: "bad_request", message: "path_prefix (ISA-95 prefix) is required." });
        return;
      }
      const aspects = sanitizeAspects(req.aspects);
      const minSeverity = sanitizeSeverity(req.min_severity);

      let entry = registry.get(socket.id);
      if (!entry) {
        entry = {
          socket,
          subs: new Map(),
          windowStart: Date.now(),
          windowCount: 0,
          pending: new Map(),
          pendingDropped: false,
          flushTimer: null,
        };
        registry.set(socket.id, entry);
      }
      if (!entry.subs.has(prefix) && entry.subs.size >= MAX_PREFIXES_PER_SOCKET) {
        socket.emit("uns:error", { code: "too_many_subscriptions", message: `Max ${MAX_PREFIXES_PER_SOCKET} prefixes per socket.` });
        return;
      }
      entry.subs.set(prefix, { aspects, minSeverity });
      socket.join?.(`uns:${prefix}`);
      ensureFanout();
      ensureHeartbeat();

      // (a) SNAPSHOT FIRST — same synchronous tick as the registration above,
      // so no delta can arrive before it (§12.2 snapshot+stream).
      const snapshots = aspects.has("state") ? getByPrefix(prefix) : [];
      socket.emit("uns:snapshot", {
        path_prefix: prefix,
        aspects: [...aspects],
        min_severity: minSeverity,
        count: snapshots.length,
        snapshots,
        ts: new Date().toISOString(),
        // HONEST: this-node retained view; events have no retained snapshot.
        note: aspects.has("state") ? undefined : "aspects exclude 'state' — events carry no retained snapshot",
      });
    } catch (err) {
      console.error("[UNS-WS] uns:subscribe failed:", (err as Error)?.message ?? err);
    }
  });

  socket.on("uns:unsubscribe", (raw: unknown) => {
    try {
      const entry = registry.get(socket.id);
      if (!entry) return;
      const req = (raw ?? {}) as Record<string, unknown>;
      const prefix = normalizePath(req.path_prefix);
      if (prefix) {
        entry.subs.delete(prefix);
        socket.leave?.(`uns:${prefix}`);
      } else {
        for (const p of entry.subs.keys()) socket.leave?.(`uns:${p}`);
        entry.subs.clear();
      }
      if (entry.subs.size === 0) cleanupSocket(socket.id);
    } catch (err) {
      console.error("[UNS-WS] uns:unsubscribe failed:", (err as Error)?.message ?? err);
    }
  });

  socket.on("disconnect", () => cleanupSocket(socket.id));
}

function cleanupSocket(socketId: string): void {
  const entry = registry.get(socketId);
  if (!entry) return;
  if (entry.flushTimer) clearTimeout(entry.flushTimer);
  registry.delete(socketId);
  if (registry.size === 0) stopHeartbeat();
}

// ─── Test seams ───────────────────────────────────────────────────────────────

/** Current subscription count (tests / status). */
export function _unsStreamSubscriberCount(): number {
  return registry.size;
}

/** Tear down registry + fanout + heartbeat (tests). */
export function _resetUnsStreamForTests(): void {
  for (const entry of registry.values()) {
    if (entry.flushTimer) clearTimeout(entry.flushTimer);
  }
  registry.clear();
  stopHeartbeat();
  for (const u of fanoutUnsubs) {
    try {
      u();
    } catch {
      /* ignore */
    }
  }
  fanoutUnsubs = [];
  fanoutInstalled = false;
}
