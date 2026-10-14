/**
 * doc 81 Đợt 12 task P fix 1 (R-12-b, M-1) — ONE helper for the central pg LISTEN channels (`ot_stop_epoch`, `device_owner_changed`):
 * a bounded LISTEN retried in the background, a HEARTBEAT, an alert per lost episode, a reconnect — so a channel can never go silent.
 *
 *   • LISTEN — bounded (listenDeadlineMs); a failure / hang ⇒ "lost" alert, retried every retryMs; boot never blocked.
 *   • HEARTBEAT — every pingMs the listener NOTIFYs `{"hb":1,"listener":<its id>,"nonce":<fresh>}` on its own channel through the
 *     DEDICATED notify client (never the app pool). The deadline starts when that NOTIFY has been SENT (a slow send is not a lost
 *     LISTEN). Not back within pingDeadlineMs ⇒ "lost": the old subscription is made inert (generation), a fresh LISTEN is made, and
 *     the episode ends only when the listener's own ping comes back (a fresh LISTEN alone is not proof). A ping that cannot be SENT
 *     is reported as lost too ("NOTIFY unavailable") but does not re-LISTEN (the LISTEN side is not the suspect).
 *   • postgres.js re-LISTENs by itself after its LISTEN connection dropped (onlisten fires again) — notifications of the gap were
 *     never delivered: reported as a lost + recovered episode. (If that automatic re-LISTEN fails, postgres.js drops the channel
 *     silently — the heartbeat catches it.)
 *   • Heartbeats never reach onPayload (every replica's are filtered out here). A heartbeat needs no MAC: only a LISTEN that
 *     DELIVERS can see one, so a forged ping can never make a dead subscription look alive; only the pending nonce counts.
 *   • Alerts: console + alert stream every episode; admin inbox (NORMAL, own kind, no cap exemption — R-11-b) at most every 30 min
 *     per (process, kind). Never carries secrets.
 */
import { randomUUID } from "node:crypto";
import { withDeadline } from "../ot/drivers/boundedClose";
import { getDb, getNotifyClient } from "../../db/connection";

export interface PgListenClient {
  listen(channel: string, fn: (payload: string) => void, onlisten?: () => void): Promise<{ unlisten: () => Promise<unknown> }>;
}
export interface PgNotifyClient {
  notify(channel: string, payload: string): Promise<unknown>;
}
export type ChannelListenerAlert = { kind: "lost" | "recovered"; channel: string; listener: string; reason: string; at: number };
export type ChannelState = "connecting" | "ok" | "degraded" | "off";
export interface ChannelListenerStatus {
  channel: string;
  state: ChannelState;
  since: number;
  reason: string | null;
  reconnects: number;
  lostEpisodes: number;
  lastPingRttMs: number | null;
  pingSendFailures: number;
}
export interface ChannelListener {
  readonly id: string;
  status(): ChannelListenerStatus;
  stop(): Promise<void>;
}

export const CHANNEL_LISTEN_DEADLINE_MS = 5_000;
export const CHANNEL_LISTEN_RETRY_MS = 10_000;
export const CHANNEL_PING_MS = 10_000;
export const CHANNEL_PING_DEADLINE_MS = 5_000;
export const CHANNEL_NOTIFY_DEADLINE_MS = 2_000;
export const CHANNEL_INBOX_MIN_INTERVAL_MS = 30 * 60_000;

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
/** A heartbeat of ANY listener (exactly {hb:1, listener, nonce}); never handed to onPayload. */
export function parseHeartbeat(raw: unknown): { listener: string; nonce: string } | null {
  if (typeof raw !== "string" || raw.length > 256 || !raw.includes('"hb"')) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o !== "object" || o === null || Array.isArray(o) || o.hb !== 1) return null;
    if (Object.keys(o).sort().join(",") !== "hb,listener,nonce") return null;
    if (typeof o.listener !== "string" || !ID_RE.test(o.listener) || typeof o.nonce !== "string" || !ID_RE.test(o.nonce)) return null;
    return { listener: o.listener, nonce: o.nonce };
  } catch {
    return null;
  }
}
const isHeartbeatShaped = (raw: string): boolean => {
  if (!raw.includes('"hb"')) return false;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return typeof o === "object" && o !== null && !Array.isArray(o) && "hb" in o;
  } catch {
    return false;
  }
};

/** A bounded NOTIFY through the given client; never throws (false = not sent). */
export async function notifyBounded(client: () => Promise<PgNotifyClient | null> | PgNotifyClient | null, channel: string, payload: string, ms = CHANNEL_NOTIFY_DEADLINE_MS): Promise<{ ok: boolean; error?: string }> {
  try {
    const c = await client();
    if (!c) throw new Error("no NOTIFY-capable client");
    await withDeadline(Promise.resolve(c.notify(channel, payload)), ms, `NOTIFY ${channel}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}

/** The default dedicated notify client (connection.getNotifyClient), null on the edge / without a DB URL. */
export async function defaultNotifyClient(): Promise<PgNotifyClient | null> {
  return getNotifyClient() as unknown as PgNotifyClient | null;
}
/** The default LISTEN client: the dedicated client's own LISTEN connection. */
export async function defaultListenClient(): Promise<PgListenClient | null> {
  return getNotifyClient() as unknown as PgListenClient | null;
}

const inboxAt = new Map<string, number>();
/** Console + alert stream every time; admin inbox rows at most every 30 min per (process, key). Never throws. */
export async function raiseOpsAlert(a: { key: string; kind: string; severity: "high" | "info"; title: string; message: string; inbox: boolean; metadata?: Record<string, unknown> }): Promise<void> {
  if (a.severity === "high") console.error(`[${a.kind}] ${a.message}`);
  else console.warn(`[${a.kind}] ${a.message}`);
  try {
    const { publishAnomalyDetected } = await import("../ecosystem/ecosystemEvents");
    publishAnomalyDetected({ kind: a.kind, severity: a.severity, source: "ot", machineId: null, message: a.message }, "ot");
  } catch {
    /* the console line stays */
  }
  if (!a.inbox) return;
  const last = inboxAt.get(a.key) ?? 0;
  if (Date.now() - last < CHANNEL_INBOX_MIN_INTERVAL_MS) return;
  inboxAt.set(a.key, Date.now());
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
      await sendNotification(userId, { type: "ALERT", priority: "NORMAL", title: a.title, message: a.message, entityType: "system", metadata: { kind: a.kind, ...(a.metadata ?? {}) } }).catch(() => undefined);
    }
  } catch {
    /* the DB may be the cause; console + stream above are the record */
  }
}

/**
 * Start one channel listener. Resolves after the FIRST LISTEN attempt (bounded) — call it without awaiting from boot code.
 */
export async function startChannelListener(o: {
  channel: string;
  /** log / alert tag, e.g. "OtStopEpochSync" */
  tag: string;
  onPayload: (raw: string) => void;
  listenClient?: () => Promise<PgListenClient | null> | PgListenClient | null;
  notifyClient?: () => Promise<PgNotifyClient | null> | PgNotifyClient | null;
  pingMs?: number;
  pingDeadlineMs?: number;
  listenDeadlineMs?: number;
  retryMs?: number;
  notifyDeadlineMs?: number;
  alert?: (a: ChannelListenerAlert) => void | Promise<void>;
  /** what a lost episode means for this channel (alert text) */
  lostMeaning: string;
}): Promise<ChannelListener> {
  const id = randomUUID();
  const listenClient = o.listenClient ?? defaultListenClient;
  const notifyClient = o.notifyClient ?? defaultNotifyClient;
  const st: ChannelListenerStatus = { channel: o.channel, state: "connecting", since: Date.now(), reason: null, reconnects: 0, lostEpisodes: 0, lastPingRttMs: null, pingSendFailures: 0 };
  let stopped = false;

  const alert = (kind: "lost" | "recovered", reason: string) => {
    const a: ChannelListenerAlert = { kind, channel: o.channel, listener: id, reason, at: Date.now() };
    try {
      const sink =
        o.alert ??
        ((x: ChannelListenerAlert) =>
          raiseOpsAlert({
            key: `${o.channel}:${x.kind}`,
            kind: `pg_channel_${o.channel}`,
            severity: x.kind === "lost" ? "high" : "info",
            title: x.kind === "lost" ? `pg channel ${o.channel} lost on a central replica` : `pg channel ${o.channel} recovered`,
            message:
              x.kind === "lost"
                ? `[${o.tag}] LISTEN ${o.channel} LOST on this central replica (${x.reason}). ${o.lostMeaning} Reconnecting.`
                : `[${o.tag}] LISTEN ${o.channel} recovered (${x.reason}). Notifications sent while it was lost were not received here.`,
            inbox: x.kind === "lost",
            metadata: { channel: o.channel },
          }));
      void Promise.resolve(sink(a)).catch(() => undefined);
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
      alert("lost", reason);
    }
  };
  const markOk = (reason: string) => {
    if (stopped) return;
    const was = st.state;
    st.state = "ok";
    st.since = Date.now();
    st.reason = null;
    if (was === "degraded") alert("recovered", reason);
  };

  let pending: { nonce: string; sentAt: number; timer: NodeJS.Timeout | null } | null = null;
  let needPing = false;
  const deliver = (raw: string) => {
    if (typeof raw !== "string") return;
    const hb = parseHeartbeat(raw);
    if (hb) {
      const p = pending;
      if (hb.listener === id && p && hb.nonce === p.nonce) {
        if (p.timer) clearTimeout(p.timer);
        pending = null;
        st.lastPingRttMs = Date.now() - p.sentAt;
        needPing = false;
        if (st.state !== "ok") markOk("heartbeat received");
      }
      return;
    }
    if (isHeartbeatShaped(raw)) return; // a malformed heartbeat: dropped here, never a payload
    try {
      o.onPayload(raw);
    } catch (e) {
      console.warn(`[${o.tag}] payload handler failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
    }
  };

  let gen = 0;
  let sub: { unlisten: () => Promise<unknown> } | null = null;
  let retry: NodeJS.Timeout | null = null;
  const listenOnce = async (): Promise<boolean> => {
    const myGen = ++gen;
    let listens = 0;
    const p = (async () => {
      const c = await listenClient();
      if (!c) throw new Error("no LISTEN-capable client");
      return c.listen(
        o.channel,
        (payload: string) => {
          if (myGen === gen && !stopped) deliver(payload);
        },
        () => {
          listens += 1;
          if (listens > 1 && myGen === gen && !stopped) {
            st.reconnects += 1;
            markLost("the LISTEN connection dropped (notifications in the gap were lost)");
            markOk("postgres re-LISTENed");
          }
        },
      );
    })();
    try {
      const s = await withDeadline(p, o.listenDeadlineMs ?? CHANNEL_LISTEN_DEADLINE_MS, `LISTEN ${o.channel}`);
      if (stopped || myGen !== gen) {
        await s.unlisten().catch(() => undefined);
        return true;
      }
      sub = s;
      if (!needPing) markOk("LISTEN registered");
      else setImmediate(ping); // after a heartbeat loss: proven only by the own ping
      return true;
    } catch (e) {
      p.then((s) => s.unlisten().catch(() => undefined)).catch(() => undefined);
      markLost(`LISTEN failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
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
    }, o.retryMs ?? CHANNEL_LISTEN_RETRY_MS);
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
  function ping(): void {
    if (stopped || pending || retry) return; // a retry is scheduled: the LISTEN is already known lost
    const nonce = randomUUID();
    const mine = { nonce, sentAt: Date.now(), timer: null as NodeJS.Timeout | null };
    pending = mine;
    void notifyBounded(notifyClient, o.channel, JSON.stringify({ hb: 1, listener: id, nonce }), o.notifyDeadlineMs ?? CHANNEL_NOTIFY_DEADLINE_MS).then((r) => {
      if (stopped || pending !== mine) return;
      if (!r.ok) {
        pending = null;
        st.pingSendFailures += 1;
        markLost(`heartbeat could not be sent (NOTIFY unavailable: ${r.error})`);
        return;
      }
      mine.sentAt = Date.now(); // M-1: the deadline starts once the ping is SENT
      mine.timer = setTimeout(() => {
        if (pending !== mine) return;
        pending = null;
        relisten("heartbeat not received");
      }, o.pingDeadlineMs ?? CHANNEL_PING_DEADLINE_MS);
      mine.timer.unref?.();
    });
  }

  await ensureListen();
  const hb = setInterval(ping, o.pingMs ?? CHANNEL_PING_MS);
  hb.unref?.();

  return {
    id,
    status: () => ({ ...st }),
    stop: async () => {
      if (stopped) return;
      stopped = true;
      clearInterval(hb);
      if (retry) clearTimeout(retry);
      if (pending?.timer) clearTimeout(pending.timer);
      pending = null;
      gen += 1;
      const s = sub;
      sub = null;
      st.state = "off";
      st.since = Date.now();
      if (s) await withDeadline(Promise.resolve(s.unlisten()), 2_000, "UNLISTEN").catch(() => undefined);
    },
  };
}
