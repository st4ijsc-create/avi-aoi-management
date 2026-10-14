/**
 * doc 81 Đợt 12 task P — the per-adapter STOP epoch (R-11-d) ACROSS central replicas.
 *
 * The epoch lives in one process (otDeviceWrite): a non-STOP write whose gates began in replica B before a verified STOP was SENT by
 * replica A used to reach the device after that STOP. This module closes most of that window, best effort:
 *   • SEND — every local bump (a verified STOP actually sent, otDeviceWrite.bumpAdapterStopEpoch) is broadcast on the dedicated pg
 *     channel `ot_stop_epoch` as {v, kind:"stop", origin, adapterId, epoch, at}. The broadcaster is called on the macrotask AFTER the
 *     STOP's driver call, never awaited, through the app pool, bounded (OT_STOP_EPOCH_NOTIFY_DEADLINE_MS) — it NEVER delays or gates
 *     the STOP (L-7). A failed send is counted and logged (rate-limited), nothing else.
 *   • RECEIVE — every central replica LISTENs on the channel (through the app pool's postgres client: the same single LISTEN
 *     connection as `device_owner_changed`, no new connection) and bumps ITS OWN epoch for that adapter
 *     (bumpAdapterStopEpochFromPeer, never re-broadcast) ⇒ writes in its gates since before that moment are cancelled
 *     STOPPED_BEFORE_WRITE. Its own notifications are ignored (origin = this process's random id).
 *   • STRICT payloads — exactly the keys above, v = 1, integers where integers are due, origin [A-Za-z0-9-]{8,64}, ≤ 512 bytes;
 *     anything else is counted and dropped. A forged but well-formed notification can only CANCEL writes in gates (the safe
 *     direction; availability, not safety). WHO CAN NOTIFY: PostgreSQL has no privilege for NOTIFY — ANY role that can connect to
 *     the database can send on any channel (proven on _test with SET ROLE pg_monitor). A peer adapter cap
 *     (OT_STOP_EPOCH_PEER_ADAPTERS_MAX) bounds the memory a flood can take.
 *   • LIVENESS — bounded LISTEN (OT_STOP_EPOCH_LISTEN_DEADLINE_MS), retried in the background, boot never blocked (call without
 *     awaiting). A heartbeat: every OT_STOP_EPOCH_PING_MS this process NOTIFYs a ping only it accepts; not received within
 *     OT_STOP_EPOCH_PING_DEADLINE_MS ⇒ the LISTEN is considered LOST: an alert (once per episode), the old subscription is made inert
 *     and a fresh LISTEN is made. postgres.js re-LISTENs by itself after a dropped connection — that re-listen is seen (onlisten)
 *     and reported as a lost + recovered episode, because notifications sent in the gap were never delivered.
 *   • DEGRADED = per process (the Đợt 11 behaviour): while the LISTEN is lost, this replica does not learn of STOPs sent by others.
 *     Writes are not blocked for it (the alert says so).
 *   • REMAINING WINDOW = the NOTIFY latency (commit → delivery → this handler): a write in B whose device write starts before A's
 *     notification is handled still runs after A's STOP. Measured on _test: docs/EDGE_GATEWAY.md §8.14.
 *   • The EDGE has no DB: never started there (its epoch stays per process — an edge-owned adapter is written only by its edge).
 */
import { randomUUID } from "node:crypto";
import { bumpAdapterStopEpochFromPeer, setStopEpochBroadcaster, type StopEpochBroadcast } from "./otDeviceWrite";
import { withDeadline } from "./drivers/boundedClose";
import { getDb, isEdgeProcessRole } from "../../db/connection";

export const OT_STOP_EPOCH_CHANNEL = "ot_stop_epoch";
export const OT_STOP_EPOCH_LISTEN_DEADLINE_MS = 5_000;
export const OT_STOP_EPOCH_LISTEN_RETRY_MS = 10_000;
export const OT_STOP_EPOCH_PING_MS = 10_000;
export const OT_STOP_EPOCH_PING_DEADLINE_MS = 5_000;
export const OT_STOP_EPOCH_NOTIFY_DEADLINE_MS = 2_000;
export const OT_STOP_EPOCH_MAX_PAYLOAD = 512;
/** inbox rows for the admins at most this often per process (the alert stream + console say every episode) */
export const OT_STOP_EPOCH_INBOX_MIN_INTERVAL_MS = 30 * 60_000;

/** This process's (this module instance's) identity on the channel. */
export const OT_STOP_EPOCH_ORIGIN = randomUUID();

export type StopEpochMessage =
  | { v: 1; kind: "stop"; origin: string; adapterId: number; epoch: number; at: number }
  | { v: 1; kind: "ping"; origin: string; nonce: string; at: number };

const ORIGIN_RE = /^[A-Za-z0-9-]{8,64}$/;
const STOP_KEYS = ["adapterId", "at", "epoch", "kind", "origin", "v"];
const PING_KEYS = ["at", "kind", "nonce", "origin", "v"];
const posInt = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x > 0;

/** STRICT parse of a notification payload; null for anything that is not exactly a v1 stop / ping message. */
export function parseStopEpochPayload(raw: unknown): StopEpochMessage | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > OT_STOP_EPOCH_MAX_PAYLOAD) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== "object" || m === null || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  if (o.v !== 1 || typeof o.origin !== "string" || !ORIGIN_RE.test(o.origin) || !posInt(o.at)) return null;
  if (o.kind === "stop") {
    if (keys.join(",") !== STOP_KEYS.join(",")) return null;
    if (!posInt(o.adapterId) || o.adapterId > 2_147_483_647 || !posInt(o.epoch)) return null;
    return { v: 1, kind: "stop", origin: o.origin, adapterId: o.adapterId, epoch: o.epoch, at: o.at };
  }
  if (o.kind === "ping") {
    if (keys.join(",") !== PING_KEYS.join(",")) return null;
    if (typeof o.nonce !== "string" || !ORIGIN_RE.test(o.nonce)) return null;
    return { v: 1, kind: "ping", origin: o.origin, nonce: o.nonce, at: o.at };
  }
  return null;
}

/** The two calls of the postgres.js client this module uses (the app pool's `$client`); injectable for tests. */
export interface StopEpochPgClient {
  listen(channel: string, fn: (payload: string) => void, onlisten?: () => void): Promise<{ unlisten: () => Promise<unknown> }>;
  notify(channel: string, payload: string): Promise<unknown>;
}

export type StopEpochSyncAlert = { kind: "lost" | "recovered"; origin: string; reason: string; at: number };

type State = "off" | "connecting" | "ok" | "degraded";
const LAT_RING = 512;
const st = {
  running: false,
  state: "off" as State,
  since: null as number | null,
  reason: null as string | null,
  peerStops: 0,
  ignoredOwn: 0,
  rejected: 0,
  peerCapped: 0,
  notifySent: 0,
  notifyFailed: 0,
  reconnects: 0,
  lostEpisodes: 0,
  lastPingRttMs: null as number | null,
  lat: [] as number[],
};

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}
/** Status of this process's sync (health page / tests). peerLatencyMs = sender's `at` → handled here, last ≤ 512 peer STOPs. */
export function otStopEpochSyncStatus() {
  const s = [...st.lat].sort((a, b) => a - b);
  return {
    running: st.running,
    state: st.state,
    origin: OT_STOP_EPOCH_ORIGIN,
    since: st.since,
    reason: st.reason,
    peerStops: st.peerStops,
    ignoredOwn: st.ignoredOwn,
    rejected: st.rejected,
    peerCapped: st.peerCapped,
    notifySent: st.notifySent,
    notifyFailed: st.notifyFailed,
    reconnects: st.reconnects,
    lostEpisodes: st.lostEpisodes,
    lastPingRttMs: st.lastPingRttMs,
    peerLatencyMs: { count: s.length, p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), max: s.length ? s[s.length - 1] : 0 },
  };
}
/** Test seam. */
export function _resetLatencyStatsForTests(): void {
  st.lat.length = 0;
}

let lastInboxAt = 0;
/** Default alert: console + the alert stream every episode; admin inbox rows (NORMAL, own kind, no cap exemption — R-11-b) at most every 30 min. */
async function defaultAlert(a: StopEpochSyncAlert): Promise<void> {
  const text =
    a.kind === "lost"
      ? `STOP epoch sync LOST on this central replica (${a.reason}). Until it reconnects, a STOP sent by ANOTHER replica does not cancel writes still in this replica's checks (per-process behaviour). Reconnecting.`
      : `STOP epoch sync recovered on this central replica (${a.reason}). STOPs sent by other replicas while it was lost were not applied here.`;
  if (a.kind === "lost") console.error(`[OtStopEpochSync] ${text}`);
  else console.warn(`[OtStopEpochSync] ${text}`);
  try {
    const { publishAnomalyDetected } = await import("../ecosystem/ecosystemEvents");
    publishAnomalyDetected({ kind: "ot_stop_epoch_sync", severity: a.kind === "lost" ? "high" : "info", source: "ot", machineId: null, message: text }, "ot");
  } catch {
    /* console line above stays */
  }
  if (a.kind !== "lost" || Date.now() - lastInboxAt < OT_STOP_EPOCH_INBOX_MIN_INTERVAL_MS) return;
  lastInboxAt = Date.now();
  try {
    const { sql } = await import("drizzle-orm");
    const db = (await getDb()) as unknown as { execute: (q: unknown) => Promise<unknown> } | null;
    if (!db) return;
    const r = (await withDeadline(db.execute(sql`SELECT id FROM public.users WHERE "isActive" = true AND role = 'admin'`), 5_000, "admins")) as unknown;
    const rows = (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<{ id: unknown }>;
    const { sendNotification } = await import("../notificationService");
    for (const x of rows) {
      const userId = Number(x.id);
      if (!Number.isSafeInteger(userId) || userId <= 0) continue;
      await sendNotification(userId, {
        type: "ALERT",
        priority: "NORMAL",
        title: "OT STOP sync between central replicas lost",
        message: text,
        entityType: "system",
        metadata: { kind: "ot_stop_epoch_sync", origin: a.origin, state: a.kind },
      }).catch(() => undefined);
    }
  } catch {
    /* the DB may be the cause; console + stream above are the record */
  }
}

let warnAt = 0;
function warnRateLimited(msg: string): void {
  if (Date.now() - warnAt < 60_000) return;
  warnAt = Date.now();
  console.warn(`[OtStopEpochSync] ${msg}`);
}
const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);

let active: (() => Promise<void>) | null = null;

/**
 * Central boot (server/_core/index.ts — the controller's integration hunk; call WITHOUT awaiting, it never blocks listen): installs
 * the broadcaster at once, then LISTENs (bounded, retried every OT_STOP_EPOCH_LISTEN_RETRY_MS) and starts the heartbeat. Returns the
 * stop function. Never on the edge. One per process (a second call returns the first's stop function).
 */
export async function startOtStopEpochSync(
  opts: {
    client?: StopEpochPgClient | (() => Promise<StopEpochPgClient | null>);
    pingMs?: number;
    pingDeadlineMs?: number;
    listenDeadlineMs?: number;
    retryMs?: number;
    notifyDeadlineMs?: number;
    alert?: (a: StopEpochSyncAlert) => void | Promise<void>;
  } = {},
): Promise<() => Promise<void>> {
  if (isEdgeProcessRole()) return async () => undefined;
  if (active) return active;

  let stopped = false;
  const getClient = async (): Promise<StopEpochPgClient | null> => {
    if (typeof opts.client === "function") return opts.client();
    if (opts.client) return opts.client;
    const db = (await getDb()) as unknown as { $client?: Partial<StopEpochPgClient> } | null;
    const c = db?.$client;
    return c && typeof c.listen === "function" && typeof c.notify === "function" ? (c as StopEpochPgClient) : null;
  };
  const alert = (a: StopEpochSyncAlert) => {
    try {
      void Promise.resolve((opts.alert ?? defaultAlert)(a)).catch(() => undefined);
    } catch {
      /* never */
    }
  };
  const markLost = (reason: string) => {
    if (stopped) return;
    if (st.state !== "degraded") {
      st.state = "degraded";
      st.since = Date.now();
      st.reason = reason;
      st.lostEpisodes += 1;
      alert({ kind: "lost", origin: OT_STOP_EPOCH_ORIGIN, reason, at: Date.now() });
    }
  };
  const markOk = (reason: string) => {
    if (stopped) return;
    const was = st.state;
    st.state = "ok";
    st.since = Date.now();
    st.reason = null;
    if (was === "degraded") alert({ kind: "recovered", origin: OT_STOP_EPOCH_ORIGIN, reason, at: Date.now() });
  };

  const send = async (m: StopEpochMessage): Promise<boolean> => {
    try {
      const c = await getClient();
      if (!c) throw new Error("no NOTIFY-capable client");
      await withDeadline(c.notify(OT_STOP_EPOCH_CHANNEL, JSON.stringify(m)), opts.notifyDeadlineMs ?? OT_STOP_EPOCH_NOTIFY_DEADLINE_MS, `NOTIFY ${OT_STOP_EPOCH_CHANNEL}`);
      st.notifySent += 1;
      return true;
    } catch (e) {
      st.notifyFailed += 1;
      warnRateLimited(`NOTIFY ${OT_STOP_EPOCH_CHANNEL} failed (${errText(e)}) — other replicas may not learn of this ${m.kind}`);
      return false;
    }
  };

  // ── SEND: installed first — even while this replica's LISTEN is down, the others must learn of ITS STOPs.
  const removeBroadcaster = setStopEpochBroadcaster((b: StopEpochBroadcast) => {
    void send({ v: 1, kind: "stop", origin: OT_STOP_EPOCH_ORIGIN, adapterId: b.adapterId, epoch: b.epoch, at: b.at });
  });

  // ── RECEIVE
  let pendingPing: { nonce: string; sentAt: number; timer: NodeJS.Timeout } | null = null;
  /** after a heartbeat loss, a fresh LISTEN is not proof enough (the NOTIFY side may be the broken one): recovered = own ping back */
  let needPing = false;
  const onMessage = (raw: string) => {
    const m = parseStopEpochPayload(raw);
    if (!m) {
      st.rejected += 1;
      warnRateLimited(`dropped a malformed notification on ${OT_STOP_EPOCH_CHANNEL} (${String(raw).length} chars)`);
      return;
    }
    if (m.kind === "ping") {
      const p = pendingPing;
      if (m.origin === OT_STOP_EPOCH_ORIGIN && p && m.nonce === p.nonce) {
        clearTimeout(p.timer);
        pendingPing = null;
        st.lastPingRttMs = Date.now() - p.sentAt;
        needPing = false;
        if (st.state !== "ok") markOk("heartbeat received");
      }
      return;
    }
    if (m.origin === OT_STOP_EPOCH_ORIGIN) {
      st.ignoredOwn += 1; // already bumped locally when this process sent the STOP
      return;
    }
    const e = bumpAdapterStopEpochFromPeer(m.adapterId, { peer: true, origin: m.origin, peerEpoch: m.epoch, at: m.at });
    if (e === null) {
      st.peerCapped += 1;
      warnRateLimited(`peer STOP for unknown adapter ${m.adapterId} dropped: OT_STOP_EPOCH_PEER_ADAPTERS_MAX reached (a NOTIFY flood?)`);
      return;
    }
    st.peerStops += 1;
    const lat = Date.now() - m.at;
    if (lat >= 0 && lat < 3_600_000) {
      st.lat.push(lat);
      if (st.lat.length > LAT_RING) st.lat.shift();
    }
  };

  let gen = 0;
  let sub: { unlisten: () => Promise<unknown> } | null = null;
  let retry: NodeJS.Timeout | null = null;
  const listenOnce = async (): Promise<boolean> => {
    const myGen = ++gen;
    let listens = 0;
    const p = (async () => {
      const c = await getClient();
      if (!c) throw new Error("no LISTEN-capable client");
      return c.listen(
        OT_STOP_EPOCH_CHANNEL,
        (payload: string) => {
          if (myGen === gen && !stopped) onMessage(payload);
        },
        () => {
          listens += 1;
          // postgres.js re-LISTENed after its LISTEN connection dropped: notifications in the gap were never delivered
          if (listens > 1 && myGen === gen && !stopped) {
            st.reconnects += 1;
            markLost("the LISTEN connection dropped (notifications in the gap were lost)");
            markOk("postgres re-LISTENed");
          }
        },
      );
    })();
    try {
      const s = await withDeadline(p, opts.listenDeadlineMs ?? OT_STOP_EPOCH_LISTEN_DEADLINE_MS, `LISTEN ${OT_STOP_EPOCH_CHANNEL}`);
      if (stopped || myGen !== gen) {
        await s.unlisten().catch(() => undefined);
        return true;
      }
      sub = s;
      if (!needPing) markOk("LISTEN registered");
      else setImmediate(ping); // prove it now rather than at the next interval
      return true;
    } catch (e) {
      p.then((s) => s.unlisten().catch(() => undefined)).catch(() => undefined); // a late success is made inert (myGen) and dropped
      markLost(`LISTEN failed: ${errText(e)}`);
      return false;
    }
  };
  const ensureListen = async (): Promise<void> => {
    if (stopped) return;
    if (retry) {
      clearTimeout(retry);
      retry = null;
    }
    if (await listenOnce()) return;
    if (stopped) return;
    retry = setTimeout(() => {
      retry = null;
      void ensureListen();
    }, opts.retryMs ?? OT_STOP_EPOCH_LISTEN_RETRY_MS);
    retry.unref?.();
  };
  const relisten = (reason: string) => {
    markLost(reason);
    needPing = true;
    gen += 1; // the old subscription's callbacks are inert from now on
    const old = sub;
    sub = null;
    if (old) void withDeadline(Promise.resolve(old.unlisten()), 2_000, "UNLISTEN").catch(() => undefined);
    void ensureListen();
  };

  // ── HEARTBEAT
  const ping = () => {
    if (stopped || pendingPing || retry) return; // a retry is already scheduled: the LISTEN is known lost
    const nonce = randomUUID();
    const timer = setTimeout(() => {
      if (pendingPing?.nonce !== nonce) return;
      pendingPing = null;
      relisten("heartbeat not received");
    }, opts.pingDeadlineMs ?? OT_STOP_EPOCH_PING_DEADLINE_MS);
    timer.unref?.();
    pendingPing = { nonce, sentAt: Date.now(), timer };
    void send({ v: 1, kind: "ping", origin: OT_STOP_EPOCH_ORIGIN, nonce, at: Date.now() });
  };

  st.running = true;
  st.state = "connecting";
  st.since = Date.now();
  await ensureListen();
  const hb = setInterval(ping, opts.pingMs ?? OT_STOP_EPOCH_PING_MS);
  hb.unref?.();

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    active = null;
    removeBroadcaster();
    clearInterval(hb);
    if (retry) clearTimeout(retry);
    if (pendingPing) clearTimeout(pendingPing.timer);
    pendingPing = null;
    gen += 1;
    const s = sub;
    sub = null;
    st.running = false;
    st.state = "off";
    st.since = Date.now();
    if (s) await withDeadline(Promise.resolve(s.unlisten()), 2_000, "UNLISTEN").catch(() => undefined);
  };
  active = stop;
  return stop;
}
