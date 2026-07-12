/**
 * doc 44 W6-2 / G5.13 — CLIENT for the UNS "snapshot-then-stream" WS contract.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The server side (server/services/stateStore/unsStreamGateway.ts, flag
 * WS_UNS_STREAM_ENABLED) already implements SNAPSHOT-THEN-STREAM over the shared
 * Socket.IO connection. Nothing consumed it — monitoring screens still polled
 * every 5 s. This module is the missing client:
 *
 *   → 'uns:subscribe'   { path_prefix, aspects?, min_severity? }
 *   ← 'uns:snapshot'    { path_prefix, snapshots:[…], count, ts }   (base state)
 *   ← 'uns:delta'       { aspect, path, ts, snapshot?|event? }       (patch)
 *   ← 'uns:delta'       { coalesced:true, dropped, deltas:[…] }      (backpressure)
 *   ← 'uns:heartbeat'   { path_prefix, ts }
 *   → 'uns:unsubscribe' { path_prefix }
 *
 * DESIGN (mirrors usePollingInterval): the moving parts are PURE + injectable so
 * they unit-test in the node env with a fake socket:
 *   • unsStreamReducer  — the (state, action) → state machine (snapshot resets a
 *     prefix; deltas patch; coalesced frames mark the stream `thinned`).
 *   • createUnsStream   — wires a socket-like object to the reducer + a store,
 *     emits subscribe on connect + re-subscribe on reconnect (resync).
 * The React hook `useUnsStream` is a thin wrapper over those two.
 *
 * HONEST DEGRADATION (§5.2): while WS_UNS_STREAM_ENABLED is OFF server-side,
 * `uns:subscribe` is a documented no-op → NO snapshot arrives → `live` stays
 * false. Callers therefore keep their existing poll as the source of truth and
 * only overlay WS state once `live` is true (client auto-fallback, no config).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { useEffect, useRef, useState } from "react";
import { getSharedSocket } from "./socketManager";

// ─── Contract types ───────────────────────────────────────────────────────────

export type UnsAspect = "state" | "events";
export type UnsMinSeverity = "info" | "warning" | "error" | "critical";
export type UnsConn = "connecting" | "live" | "disconnected";

export interface UnsClientSnapshot {
  path: string;
  ts: string;
  state: string;
  values?: Record<string, { v: unknown; unit?: string; q?: string }>;
  health?: "online" | "degraded" | "offline";
  source?: string;
  machineId?: number;
}

export interface UnsClientEvent {
  event_id: string;
  type: string;
  severity: string;
  ts: string;
  path: string;
  payload?: Record<string, unknown>;
}

interface UnsSnapshotMsg {
  path_prefix?: string;
  snapshots?: UnsClientSnapshot[];
  count?: number;
  ts?: string;
}

interface UnsDeltaSingle {
  aspect?: UnsAspect;
  path?: string;
  ts?: string;
  snapshot?: UnsClientSnapshot;
  event?: Omit<UnsClientEvent, "path">;
}

interface UnsDeltaCoalesced {
  coalesced: true;
  dropped?: boolean;
  count?: number;
  deltas?: UnsDeltaSingle[];
  ts?: string;
}

type UnsDeltaMsg = UnsDeltaSingle | UnsDeltaCoalesced;

// ─── Reducer state + actions (PURE) ──────────────────────────────────────────

const MAX_EVENTS = 200;

export interface UnsStreamState {
  conn: UnsConn;
  /** Latest state snapshot per ISA-95 path. */
  snapshots: Map<string, UnsClientSnapshot>;
  /** Convenience index: machineId → its latest snapshot (when path carries one). */
  byMachineId: Map<number, UnsClientSnapshot>;
  /** Bounded ring of recent events (aspect=events), newest last. */
  events: UnsClientEvent[];
  lastSnapshotTs: string | null;
  lastDeltaTs: string | null;
  lastHeartbeatTs: string | null;
  /** Saw a coalesced `dropped` frame → the client KNOWS it saw a thinned stream. */
  thinned: boolean;
  /** How many snapshots (subscription confirmations) have arrived. */
  snapshotCount: number;
}

export type UnsAction =
  | { type: "connect" }
  | { type: "disconnect" }
  | { type: "snapshot"; msg: UnsSnapshotMsg }
  | { type: "delta"; msg: UnsDeltaMsg }
  | { type: "heartbeat"; ts?: string };

export function initialUnsState(): UnsStreamState {
  return {
    conn: "connecting",
    snapshots: new Map(),
    byMachineId: new Map(),
    events: [],
    lastSnapshotTs: null,
    lastDeltaTs: null,
    lastHeartbeatTs: null,
    thinned: false,
    snapshotCount: 0,
  };
}

function prefixMatches(prefix: string, path: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Apply ONE state snapshot into the maps (mutates the given maps). */
function putSnapshot(
  snapshots: Map<string, UnsClientSnapshot>,
  byMachineId: Map<number, UnsClientSnapshot>,
  snap: UnsClientSnapshot,
): void {
  if (!snap || typeof snap.path !== "string") return;
  snapshots.set(snap.path, snap);
  if (typeof snap.machineId === "number" && Number.isFinite(snap.machineId)) {
    byMachineId.set(snap.machineId, snap);
  }
}

/** Apply one non-coalesced delta into working maps/events. Returns new lastTs. */
function applyDeltaSingle(
  snapshots: Map<string, UnsClientSnapshot>,
  byMachineId: Map<number, UnsClientSnapshot>,
  events: UnsClientEvent[],
  d: UnsDeltaSingle,
): void {
  if (!d) return;
  if (d.aspect === "events" || d.event) {
    if (d.event && d.path) {
      events.push({ ...d.event, path: d.path });
      if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    }
    return;
  }
  // default = state aspect
  if (d.snapshot) putSnapshot(snapshots, byMachineId, d.snapshot);
}

/**
 * The state machine. PURE — returns a NEW state (never mutates the input). This
 * is the whole G5.13 client behaviour and is unit-tested directly.
 */
export function unsStreamReducer(state: UnsStreamState, action: UnsAction): UnsStreamState {
  switch (action.type) {
    case "connect":
      return { ...state, conn: state.snapshotCount > 0 ? "live" : "connecting" };

    case "disconnect":
      return { ...state, conn: "disconnected" };

    case "snapshot": {
      const prefix = String(action.msg.path_prefix ?? "").replace(/^\/+|\/+$/g, "");
      const snapshots = new Map(state.snapshots);
      const byMachineId = new Map(state.byMachineId);
      // RESYNC: a snapshot is the authoritative base for its prefix — drop stale
      // entries under it first (handles reconnect), then set the fresh ones.
      if (prefix) {
        for (const [path, snap] of state.snapshots) {
          if (prefixMatches(prefix, path)) {
            snapshots.delete(path);
            if (typeof snap.machineId === "number") byMachineId.delete(snap.machineId);
          }
        }
      }
      for (const snap of action.msg.snapshots ?? []) putSnapshot(snapshots, byMachineId, snap);
      return {
        ...state,
        conn: "live",
        snapshots,
        byMachineId,
        lastSnapshotTs: action.msg.ts ?? new Date().toISOString(),
        snapshotCount: state.snapshotCount + 1,
      };
    }

    case "delta": {
      const snapshots = new Map(state.snapshots);
      const byMachineId = new Map(state.byMachineId);
      const events = state.events.slice();
      let thinned = state.thinned;
      const msg = action.msg as UnsDeltaCoalesced & UnsDeltaSingle;
      if (msg && msg.coalesced) {
        if (msg.dropped) thinned = true;
        for (const d of msg.deltas ?? []) applyDeltaSingle(snapshots, byMachineId, events, d);
      } else {
        applyDeltaSingle(snapshots, byMachineId, events, msg);
      }
      return {
        ...state,
        // receiving deltas means the stream is alive even if we somehow missed
        // the snapshot event; but stay honest — only "live" once we've had one.
        conn: state.snapshotCount > 0 ? "live" : state.conn,
        snapshots,
        byMachineId,
        events,
        thinned,
        lastDeltaTs: (msg && msg.ts) || new Date().toISOString(),
      };
    }

    case "heartbeat":
      return { ...state, lastHeartbeatTs: action.ts ?? new Date().toISOString() };

    default:
      return state;
  }
}

// ─── Socket-like seam (real socket.io Socket satisfies it; mockable) ─────────

export interface UnsSocketLike {
  connected?: boolean;
  on(event: string, cb: (...args: any[]) => void): unknown;
  off(event: string, cb: (...args: any[]) => void): unknown;
  emit(event: string, ...args: any[]): unknown;
}

export interface UnsStreamOptions {
  pathPrefix: string;
  aspects?: UnsAspect[];
  minSeverity?: UnsMinSeverity;
}

export interface UnsStreamController {
  getState(): UnsStreamState;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/**
 * Wire a socket-like object to the reducer and return a small store. Emits
 * 'uns:subscribe' immediately (if connected) and again on every 'connect' so a
 * reconnect resubscribes + resyncs. `dispose()` unsubscribes + detaches all
 * listeners. Fully unit-testable with a fake socket.
 */
export function createUnsStream(socket: UnsSocketLike, opts: UnsStreamOptions): UnsStreamController {
  let state = initialUnsState();
  const listeners = new Set<() => void>();
  const emitChange = () => {
    for (const l of listeners) l();
  };
  const dispatch = (action: UnsAction) => {
    const next = unsStreamReducer(state, action);
    if (next !== state) {
      state = next;
      emitChange();
    }
  };

  const req = {
    path_prefix: opts.pathPrefix,
    aspects: opts.aspects ?? ["state"],
    min_severity: opts.minSeverity ?? "info",
  };
  const sendSubscribe = () => {
    try {
      socket.emit("uns:subscribe", req);
    } catch {
      /* socket transient — reconnect will retry */
    }
  };

  const onSnapshot = (msg: UnsSnapshotMsg) => dispatch({ type: "snapshot", msg: msg ?? {} });
  const onDelta = (msg: UnsDeltaMsg) => dispatch({ type: "delta", msg: msg ?? ({} as UnsDeltaMsg) });
  const onHeartbeat = (msg: { ts?: string }) => dispatch({ type: "heartbeat", ts: msg?.ts });
  const onConnect = () => {
    dispatch({ type: "connect" });
    sendSubscribe(); // resubscribe + resync on (re)connect
  };
  const onDisconnect = () => dispatch({ type: "disconnect" });

  socket.on("uns:snapshot", onSnapshot);
  socket.on("uns:delta", onDelta);
  socket.on("uns:heartbeat", onHeartbeat);
  socket.on("connect", onConnect);
  socket.on("disconnect", onDisconnect);

  // Subscribe now if the socket is already connected (common: shared socket).
  if (socket.connected !== false) sendSubscribe();

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      try {
        socket.emit("uns:unsubscribe", { path_prefix: opts.pathPrefix });
      } catch {
        /* ignore */
      }
      socket.off("uns:snapshot", onSnapshot);
      socket.off("uns:delta", onDelta);
      socket.off("uns:heartbeat", onHeartbeat);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      listeners.clear();
    },
  };
}

// ─── Derived helpers ─────────────────────────────────────────────────────────

/** True once a snapshot has arrived AND the socket is connected. */
export function unsStreamLive(state: UnsStreamState): boolean {
  return state.conn === "live" && state.snapshotCount > 0;
}

/** Latest snapshot for a machine id (null when the stream hasn't seen it). */
export function unsMachineSnapshot(state: UnsStreamState, machineId: number): UnsClientSnapshot | null {
  return state.byMachineId.get(machineId) ?? null;
}

// ─── ISA-95 slug (mirror of server topicV2.slugSegment) ──────────────────────

/**
 * Slug an ISA-95 segment EXACTLY like the server (topicV2.slugSegment): strip
 * Vietnamese diacritics, đ→d, lowercase, non-[a-z0-9]→'-', trim '-'. Used to
 * build a subscribe `path_prefix` from a factory/line CODE on the client.
 */
export function isa95Slug(raw: unknown, fallback = "unassigned"): string {
  if (raw == null) return fallback;
  const s = String(raw)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.length > 0 ? s : fallback;
}

// ─── React hook ───────────────────────────────────────────────────────────────

export interface UseUnsStreamOptions {
  /** ISA-95 prefix to subscribe (already slugged). Null/empty → hook is inert. */
  pathPrefix: string | null | undefined;
  aspects?: UnsAspect[];
  minSeverity?: UnsMinSeverity;
  /** Master switch — pass false to skip WS entirely (keep polling). Default true. */
  enabled?: boolean;
  /** Heartbeat/delta silence (ms) after which `stale` flips true. Default 60 s. */
  staleAfterMs?: number;
}

export interface UseUnsStreamResult extends UnsStreamState {
  /** Snapshot arrived + socket connected → safe to overlay WS onto the screen. */
  live: boolean;
  /** No snapshot/delta/heartbeat within staleAfterMs (honest "delayed"). */
  stale: boolean;
}

/**
 * Subscribe a monitoring screen to the UNS stream. Returns the live state map +
 * `live`/`stale`. When `live` is false (flag off, disconnected, or no prefix)
 * the caller MUST keep its existing poll — this hook never fabricates data.
 */
export function useUnsStream(opts: UseUnsStreamOptions): UseUnsStreamResult {
  const { pathPrefix, enabled = true, staleAfterMs = 60_000 } = opts;
  const aspectsKey = (opts.aspects ?? ["state"]).join(",");
  const minSeverity = opts.minSeverity ?? "info";

  const [state, setState] = useState<UnsStreamState>(initialUnsState);
  const [now, setNow] = useState(() => Date.now());
  const ctrlRef = useRef<UnsStreamController | null>(null);

  const active = enabled && !!pathPrefix;

  useEffect(() => {
    if (!active || !pathPrefix) {
      setState({ ...initialUnsState(), conn: "disconnected" });
      return;
    }
    const socket = getSharedSocket() as unknown as UnsSocketLike;
    const ctrl = createUnsStream(socket, {
      pathPrefix,
      aspects: aspectsKey.split(",") as UnsAspect[],
      minSeverity,
    });
    ctrlRef.current = ctrl;
    setState(ctrl.getState());
    const unsub = ctrl.subscribe(() => setState(ctrl.getState()));
    return () => {
      unsub();
      ctrl.dispose();
      ctrlRef.current = null;
    };
    // aspectsKey/minSeverity are primitive-stable keys for the subscription.
  }, [active, pathPrefix, aspectsKey, minSeverity]);

  // Lightweight ticker only while live — powers the honest `stale` flag.
  const isLive = unsStreamLive(state);
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, [isLive]);

  const lastActivity = state.lastDeltaTs ?? state.lastHeartbeatTs ?? state.lastSnapshotTs;
  const stale = isLive && lastActivity != null && now - new Date(lastActivity).getTime() > staleAfterMs;

  return { ...state, live: isLive, stale };
}
