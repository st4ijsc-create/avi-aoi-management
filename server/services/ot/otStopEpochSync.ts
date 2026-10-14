/**
 * doc 81 Đợt 12 task P (+ fix 1) — the per-adapter STOP epoch (R-11-d) ACROSS central replicas.
 *
 * The epoch lives in one process (otDeviceWrite): a non-STOP write whose gates began in replica B before a verified STOP was SENT by
 * replica A used to reach the device after that STOP. This module closes most of that window, best effort:
 *   • SEND — every local bump (a verified STOP actually sent, otDeviceWrite.bumpAdapterStopEpoch) is broadcast on the dedicated pg
 *     channel `ot_stop_epoch`, AUTHENTICATED (R-12-c): {v:2, kind:"stop", replicaId, seq, issuedAt, adapterId, mac}. The broadcaster
 *     runs on the macrotask AFTER the STOP's driver call, is never awaited, goes through the DEDICATED notify client (not the app
 *     pool — fix 1 M-1), bounded — it NEVER delays or gates the STOP (L-7).
 *   • RECEIVE — every central replica LISTENs (pgChannelListener: bounded, retried, heartbeat, alert on loss) and, for a message that
 *     passes every check, moves its PEER epoch for that adapter (bumpAdapterStopEpochFromPeer, never re-broadcast) ⇒ NON-STOP writes
 *     in its gates since before that moment are cancelled STOPPED_BEFORE_WRITE. A peer move never supersedes a stop-typed command
 *     (fix 1 I-2, L-7). The peer map is capped without failing open (fix 1 I-3: eviction + floor, alert on overflow).
 *   • AUTH (R-12-c / scan #110) — PostgreSQL has no privilege for NOTIFY: ANY role that can connect can send on any channel (proven on
 *     _test as avi_app). So every stop message carries an HMAC-SHA256 over a canonical string (channel, v, kind, replicaId, seq,
 *     issuedAt, adapterId), keyed with a subkey: HKDF-SHA256(OT_STOP_EPOCH_HMAC_KEY if set, else SECRET_ENCRYPTION_KEY,
 *     info "ot_stop_epoch/hmac/v1"). Neither set ⇒ FAIL CLOSED: nothing is sent, nothing is accepted, one alert (never a JWT_SECRET
 *     fallback). The key is never logged, never in the status.
 *     Receive order: strict shape → MAC (timingSafeEqual) → own replica (ignored) → freshness |now − issuedAt| ≤ 30 s (future
 *     included) → replay WINDOW per replicaId (seqs seen within the freshness window; the pool / connections can reorder, so not a
 *     strict seq) → apply. replicaId is random per boot (seq needs no persistence). Rejections are counted; ONE alert per rejection
 *     episode (an episode ends after 5 quiet minutes). Receive state is bounded (64 replicas, 4096 seqs each; overflow evicts — a
 *     replay of an evicted seq can only cancel writes — and alerts).
 *   • NO KEY (final fix wave R-12-e M-1) ⇒ the sync is DISABLED on this replica: no LISTEN, nothing sent or applied; status
 *     "disabled: no HMAC key" (env NAMES only); ONE alert per key-missing EPISODE, remembered across boots in the alert rows
 *     (otStopEpochKeyEpisode — a restart without a key is silent; a boot with a key closes the episode).
 *   • HELLO (R-12-e M-2) — at start each replica NOTIFYs a signed `{v:2, kind:"hello", replicaId, seq, issuedAt, mac}`; a replica
 *     that cannot verify a hello raises a key_mismatch alert (rate-limited, counted) — a key that differs between replicas shows at
 *     boot, not at the first real STOP. A hello from a new replica is answered once (so the earlier replica checks the later one
 *     too); a hello never moves an epoch.
 *   • DEGRADED = per process (the Đợt 11 behaviour) — LISTEN lost, or a rejected message.
 *   • REMAINING WINDOW = the NOTIFY latency (docs/EDGE_GATEWAY.md §8.14).
 *   • The EDGE has no DB: never started there (its epoch stays per process).
 */
import { createHmac, hkdfSync, randomUUID, timingSafeEqual } from "node:crypto";
import { bumpAdapterStopEpochFromPeer, peerStopEpochStats, setStopEpochBroadcaster, type StopEpochBroadcast } from "./otDeviceWrite";
import { isEdgeProcessRole } from "../../db/connection";
import { NO_KEY_FIX, defaultKeyEpisodeIo, settleKeyEpisode, type KeyEpisodeIo, type KeyEpisodeOutcome } from "./otStopEpochKeyEpisode";
import { STOP_PIN_PRESENCE_TTL_MS, invalidateStopPinPresence, setStopPinChangeBroadcaster } from "./stopPinPresence"; // R-12-g
import { withDeadline } from "./drivers/boundedClose";
import {
  startChannelListener,
  notifyBounded,
  defaultNotifyClient,
  raiseOpsAlert,
  type ChannelListener,
  type ChannelListenerAlert,
  type ChannelListenerStatus,
  type PgListenClient,
  type PgNotifyClient,
} from "../ops/pgChannelListener";

export const OT_STOP_EPOCH_CHANNEL = "ot_stop_epoch";
export const OT_STOP_EPOCH_MAX_PAYLOAD = 512;
/** freshness bound (R-12-c c): larger than the worst queueing seen (~270 ms with the old pooled send) + clock skew */
export const OT_STOP_EPOCH_MAX_AGE_MS = 30_000;
export const OT_STOP_EPOCH_REPLICAS_MAX = 64;
export const OT_STOP_EPOCH_SEQS_PER_REPLICA_MAX = 4_096;
export const OT_STOP_EPOCH_REJECT_EPISODE_QUIET_MS = 5 * 60_000;
export const OT_STOP_EPOCH_HKDF_INFO = "ot_stop_epoch/hmac/v1";

/** This process's identity on the channel (random per boot / module instance). */
export const OT_STOP_EPOCH_REPLICA_ID = randomUUID();
/** @deprecated name kept for the status field `origin` */
export const OT_STOP_EPOCH_ORIGIN = OT_STOP_EPOCH_REPLICA_ID;

export type StopEpochMessage = { v: 2; kind: "stop"; replicaId: string; seq: number; issuedAt: number; adapterId: number; mac: string };
/** R-12-e M-2 — the start handshake: proves (to every replica that can verify it) that this replica signs with the same key */
export type StopEpochHello = { v: 2; kind: "hello"; replicaId: string; seq: number; issuedAt: number; mac: string };
/** R-12-e M-2 — at most one key_mismatch alert per this interval (every mismatch is counted) */
export const OT_STOP_EPOCH_KEY_MISMATCH_ALERT_MS = 30 * 60_000;
/** R-12-e M-2 — replicas remembered for the hello status / the one-time answer (bounded) */
export const OT_STOP_EPOCH_HELLO_PEERS_MAX = 64;
/** R-12-e M-2 — answers to hellos at most this often (a flood of forged hellos cannot make this replica NOTIFY in a loop) */
export const OT_STOP_EPOCH_HELLO_REPLY_MIN_MS = 1_000;

// ── key ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type StopEpochKey = { key: Buffer; source: "OT_STOP_EPOCH_HMAC_KEY" | "SECRET_ENCRYPTION_KEY" } | { key: null; source: null; reason: string };
/** R-12-c — the HMAC subkey (never the raw secret). Fail closed: null when neither variable holds a usable secret. Never logs. */
export function resolveStopEpochKey(env: NodeJS.ProcessEnv = process.env): StopEpochKey {
  const derive = (ikm: string) => Buffer.from(hkdfSync("sha256", Buffer.from(ikm, "utf8"), Buffer.alloc(0), Buffer.from(OT_STOP_EPOCH_HKDF_INFO, "utf8"), 32));
  const o = (env.OT_STOP_EPOCH_HMAC_KEY ?? "").trim();
  if (o) {
    if (o.length < 32) return { key: null, source: null, reason: "OT_STOP_EPOCH_HMAC_KEY is set but shorter than 32 characters" };
    return { key: derive(o), source: "OT_STOP_EPOCH_HMAC_KEY" };
  }
  const s = (env.SECRET_ENCRYPTION_KEY ?? "").trim();
  if (s) {
    if (s.length < 16) return { key: null, source: null, reason: "SECRET_ENCRYPTION_KEY is shorter than 16 characters" };
    return { key: derive(s), source: "SECRET_ENCRYPTION_KEY" };
  }
  return { key: null, source: null, reason: "neither OT_STOP_EPOCH_HMAC_KEY nor SECRET_ENCRYPTION_KEY is set" };
}

// the kind is signed: a hello MAC (adapterId 0, kind hello) never verifies as a STOP
const canonical = (m: Omit<StopEpochMessage, "mac"> | Omit<StopEpochHello, "mac"> | Omit<StopPinChangeMessage, "mac">) =>
  `${OT_STOP_EPOCH_CHANNEL}\nv${m.v}\n${m.kind}\n${m.replicaId}\n${m.seq}\n${m.issuedAt}\n${"adapterId" in m ? m.adapterId : 0}`;
/** R-12-g — "a stop pin of this adapter changed on the sending replica" (same shape as a stop; the kind is signed) */
export type StopPinChangeMessage = Omit<StopEpochMessage, "kind"> & { kind: "pins" };
export function macOf(key: Buffer, m: Omit<StopEpochMessage, "mac"> | Omit<StopEpochHello, "mac"> | Omit<StopPinChangeMessage, "mac">): string {
  return createHmac("sha256", key).update(canonical(m), "utf8").digest("hex");
}
/** R-12-e M-2 — build a signed hello (tests / the start). */
export function signHelloMessage(key: Buffer, m: Omit<StopEpochHello, "mac" | "v" | "kind">): StopEpochHello {
  const base = { v: 2 as const, kind: "hello" as const, ...m };
  return { ...base, mac: macOf(key, base) };
}
/** R-12-g — build a signed pin-change message (tests / the broadcaster). */
export function signPinChangeMessage(key: Buffer, m: Omit<StopPinChangeMessage, "mac" | "v" | "kind">): StopPinChangeMessage {
  const base = { v: 2 as const, kind: "pins" as const, ...m };
  return { ...base, mac: macOf(key, base) };
}
/** Build a signed message (tests / the broadcaster). */
export function signStopEpochMessage(key: Buffer, m: Omit<StopEpochMessage, "mac" | "v" | "kind">): StopEpochMessage {
  const base = { v: 2 as const, kind: "stop" as const, ...m };
  return { ...base, mac: macOf(key, base) };
}
function macOk(key: Buffer, m: StopEpochMessage | StopEpochHello | StopPinChangeMessage): boolean {
  const want = Buffer.from(macOf(key, m), "hex");
  const got = Buffer.from(m.mac, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

// ── strict parse ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const MAC_RE = /^[0-9a-f]{64}$/;
const KEYS = "adapterId,issuedAt,kind,mac,replicaId,seq,v";
const posInt = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x > 0;
/** STRICT parse; null for anything that is not exactly a v2 stop message (the MAC is checked separately). */
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
  if (Object.keys(o).sort().join(",") !== KEYS) return null;
  if (o.v !== 2 || o.kind !== "stop") return null;
  if (typeof o.replicaId !== "string" || !ID_RE.test(o.replicaId)) return null;
  if (!posInt(o.seq) || !posInt(o.issuedAt) || !posInt(o.adapterId) || o.adapterId > 2_147_483_647) return null;
  if (typeof o.mac !== "string" || !MAC_RE.test(o.mac)) return null;
  return { v: 2, kind: "stop", replicaId: o.replicaId, seq: o.seq, issuedAt: o.issuedAt, adapterId: o.adapterId, mac: o.mac };
}

/** R-12-g — STRICT parse of a pin-change message (exactly the stop shape with kind "pins"). */
export function parsePinChangePayload(raw: unknown): StopPinChangeMessage | null {
  if (typeof raw !== "string" || !raw.includes('"pins"')) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof o !== "object" || o === null || Array.isArray(o) || o.kind !== "pins") return null;
  const asStop = parseStopEpochPayload(JSON.stringify({ ...o, kind: "stop" }));
  if (!asStop || raw.length > OT_STOP_EPOCH_MAX_PAYLOAD) return null;
  return { ...asStop, kind: "pins" };
}

const HELLO_KEYS = "issuedAt,kind,mac,replicaId,seq,v";
/** R-12-e M-2 — STRICT parse of a hello; null for anything else (the MAC is checked separately). */
export function parseHelloPayload(raw: unknown): StopEpochHello | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > OT_STOP_EPOCH_MAX_PAYLOAD) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== "object" || m === null || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  if (Object.keys(o).sort().join(",") !== HELLO_KEYS) return null;
  if (o.v !== 2 || o.kind !== "hello") return null;
  if (typeof o.replicaId !== "string" || !ID_RE.test(o.replicaId)) return null;
  if (!posInt(o.seq) || !posInt(o.issuedAt)) return null;
  if (typeof o.mac !== "string" || !MAC_RE.test(o.mac)) return null;
  return { v: 2, kind: "hello", replicaId: o.replicaId, seq: o.seq, issuedAt: o.issuedAt, mac: o.mac };
}

// ── status ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type StopEpochSyncAlert =
  | ChannelListenerAlert
  | { kind: "no_key" | "rejected" | "peer_overflow" | "replica_overflow" | "key_mismatch" | "pin_broadcast_failed"; channel: string; reason: string; at: number };
export type RejectReason = "malformed" | "no_key" | "bad_mac" | "stale" | "replay";
const LAT_RING = 512;
const st = {
  running: false,
  keySource: null as string | null,
  keyProblem: null as string | null,
  /** R-12-e M-1 — "no_hmac_key": the sync is disabled on this replica (null: enabled) */
  disabled: null as "no_hmac_key" | null,
  /** R-12-e M-1 — how this boot settled the persisted key episode (null until settled) */
  keyEpisode: null as KeyEpisodeOutcome | null,
  /** R-12-e M-2 — the start handshake */
  helloSent: 0,
  helloMismatches: 0,
  helloLastMismatchAt: null as number | null,
  helloPeers: new Map<string, { lastSeenAt: number; verified: boolean }>(),
  /** R-12-f — a peer replica proved itself since this start (a verified hello or an applied peer STOP) */
  peerSeen: false,
  /** R-12-g — pin changes broadcast / received / not sent */
  pinChangesSent: 0,
  pinChangesReceived: 0,
  pinChangesNotSent: 0,
  peerStops: 0,
  ignoredOwn: 0,
  rejected: { malformed: 0, no_key: 0, bad_mac: 0, stale: 0, replay: 0 } as Record<RejectReason, number>,
  peerEvictions: 0,
  replicaEvictions: 0,
  notifySent: 0,
  notifyFailed: 0,
  unsignedNotSent: 0,
  lat: [] as number[],
};
let listener: ChannelListener | null = null;
let seq = 0;

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}
/** Status of this process's sync (system health). Never contains key material. */
export function otStopEpochSyncStatus() {
  const s = [...st.lat].sort((a, b) => a - b);
  const l: ChannelListenerStatus | null = listener?.status() ?? null;
  const rejectedTotal = Object.values(st.rejected).reduce((a, b) => a + b, 0);
  return {
    running: st.running,
    state: !st.running ? "off" : st.disabled ? "disabled" : st.keyProblem ? "degraded" : (l?.state ?? "connecting"),
    origin: OT_STOP_EPOCH_REPLICA_ID,
    keySource: st.keySource,
    keyProblem: st.keyProblem,
    disabled: st.disabled,
    keyEpisode: st.keyEpisode,
    hello: {
      sent: st.helloSent,
      verifiedPeers: [...st.helloPeers.values()].filter((p) => p.verified).length,
      mismatches: st.helloMismatches,
      lastMismatchAt: st.helloLastMismatchAt,
      // replica ids are random per boot; shortened for display
      peers: [...st.helloPeers].filter(([, p]) => p.verified).map(([id, p]) => ({ replica: `${id.slice(0, 8)}…`, lastSeenAt: p.lastSeenAt })),
    },
    listen: l,
    reconnects: l?.reconnects ?? 0,
    peerStops: st.peerStops,
    ignoredOwn: st.ignoredOwn,
    rejected: rejectedTotal,
    rejectedBy: { ...st.rejected },
    peerEvictions: st.peerEvictions,
    peerMap: peerStopEpochStats(),
    replicaEvictions: st.replicaEvictions,
    notifySent: st.notifySent,
    notifyFailed: st.notifyFailed,
    unsignedNotSent: st.unsignedNotSent,
    peerLatencyMs: { count: s.length, p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), max: s.length ? s[s.length - 1] : 0 },
    pinChanges: { sent: st.pinChangesSent, received: st.pinChangesReceived, notSent: st.pinChangesNotSent },
  };
}
/**
 * doc 81 Đợt 12 final fix wave residual (R-12-f item 1) — can a PEER replica move this process's STOP epochs at all? Only while the
 * sync runs with a key AND another replica has been seen (a verified hello, or a peer STOP applied). False on a single central
 * process — the dispatcher then skips the adapter pin read of the peer-STOP exemption (no peer move can happen to exempt from).
 */
export function otStopEpochSyncSeesPeers(): boolean {
  return st.running && !st.disabled && st.peerSeen;
}
/** Test seam. */
export function _resetLatencyStatsForTests(): void {
  st.lat.length = 0;
}

let warnAt = 0;
function warnRateLimited(msg: string): void {
  if (Date.now() - warnAt < 60_000) return;
  warnAt = Date.now();
  console.warn(`[OtStopEpochSync] ${msg}`);
}

let active: Promise<() => Promise<void>> | null = null;

/**
 * Central boot (server/_core/index.ts — the controller's integration hunk; EVERY central process, whatever OT_GATEWAY_ENABLED says:
 * central sweep / fallback STOPs run with the gateway off — fix 1 I-1; call WITHOUT awaiting). Installs the broadcaster at once (when
 * a key exists), then LISTENs through pgChannelListener. Returns the stop function. Never on the edge. One per process.
 */
export function startOtStopEpochSync(
  opts: {
    listenClient?: () => Promise<PgListenClient | null> | PgListenClient | null;
    notifyClient?: () => Promise<PgNotifyClient | null> | PgNotifyClient | null;
    env?: NodeJS.ProcessEnv;
    pingMs?: number;
    pingDeadlineMs?: number;
    listenDeadlineMs?: number;
    retryMs?: number;
    notifyDeadlineMs?: number;
    alert?: (a: StopEpochSyncAlert) => void | Promise<void>;
    /** R-12-e M-1 — the persisted key episode (default: the notification rows of the app DB) */
    keyEpisodeIo?: KeyEpisodeIo;
  } = {},
): Promise<() => Promise<void>> {
  if (isEdgeProcessRole()) return Promise.resolve(async () => undefined);
  if (active) return active;
  active = start(opts);
  return active;
}

async function start(opts: Parameters<typeof startOtStopEpochSync>[0] & object): Promise<() => Promise<void>> {
  let stopped = false;
  const notifyClient = opts.notifyClient ?? defaultNotifyClient;
  const alert = (a: StopEpochSyncAlert) => {
    try {
      const sink =
        opts.alert ??
        ((x: StopEpochSyncAlert) => {
          if (x.kind === "lost" || x.kind === "recovered") return; // the channel listener's default alert already said it
          return raiseOpsAlert({
            key: `ot_stop_epoch:${x.kind}`,
            kind: "ot_stop_epoch_sync",
            severity: "high",
            title: x.kind === "no_key" ? "OT STOP sync between central replicas DISABLED: no HMAC key" : x.kind === "key_mismatch" ? "OT STOP sync: a central replica signs with another key" : "OT STOP sync between central replicas degraded",
            message: `[OtStopEpochSync] ${x.reason}`,
            // R-12-e M-1 — the no_key inbox rows are written once per EPISODE by otStopEpochKeyEpisode (never on every boot)
            inbox: x.kind !== "no_key",
            metadata: { problem: x.kind },
          });
        });
      void Promise.resolve(sink(a)).catch(() => undefined);
    } catch {
      /* never */
    }
  };

  // ── key (R-12-c): fail closed
  const k = resolveStopEpochKey(opts.env);
  st.keySource = k.source;
  st.keyProblem = k.key ? null : k.reason;
  st.disabled = k.key ? null : "no_hmac_key";
  st.keyEpisode = null;
  // R-12-e M-1 — settle the persisted key episode (boot only, never awaited, bounded): ONE alert per key-missing episode
  const episodeIo = opts.keyEpisodeIo ?? defaultKeyEpisodeIo();
  void (async () => {
    let outcome: KeyEpisodeOutcome;
    try {
      outcome = (await withDeadline(settleKeyEpisode(k.key !== null, k.key ? null : k.reason, episodeIo), 10_000, "OT STOP sync key episode")).outcome;
    } catch (e) {
      // unreadable ⇒ tell (fail toward alerting); nothing is remembered for this boot
      console.warn(`[OtStopEpochSync] the key episode could not be read (${String((e as Error)?.message ?? e).slice(0, 200)})`);
      outcome = k.key ? "nothing" : "new_episode";
    }
    st.keyEpisode = outcome;
    if (k.key) {
      if (outcome === "episode_closed") console.warn("[OtStopEpochSync] an HMAC key is configured: cross-replica STOP sync enabled (the 'no HMAC key' episode is closed)");
      return;
    }
    if (outcome === "new_episode") {
      alert({
        kind: "no_key",
        channel: OT_STOP_EPOCH_CHANNEL,
        reason: `cross-replica STOP sync DISABLED on this replica (${k.reason}): its STOPs are not broadcast and other replicas' STOPs are not applied here (per-process behaviour; harmless with ONE central process). ${NO_KEY_FIX}`,
        at: Date.now(),
      });
    } else {
      console.warn(`[OtStopEpochSync] cross-replica STOP sync disabled on this replica (${k.reason}) — this episode was already alerted; not repeated on restart`);
    }
  })();
  const key = k.key;

  // ── rejection episodes (one alert per episode)
  let episodeUntil = 0;
  const reject = (reason: RejectReason, detail: string) => {
    st.rejected[reason] += 1;
    const now = Date.now();
    if (now > episodeUntil) {
      alert({ kind: "rejected", channel: OT_STOP_EPOCH_CHANNEL, reason: `rejected a notification on ${OT_STOP_EPOCH_CHANNEL} (${reason}: ${detail}); further rejections in this episode are only counted`, at: now });
    }
    episodeUntil = now + OT_STOP_EPOCH_REJECT_EPISODE_QUIET_MS;
  };
  let peerOverflowAlerted = false;
  let replicaOverflowAlerted = false;

  // ── SEND (installed first, if a key exists — even while this replica's LISTEN is down, the others must learn of ITS STOPs)
  const removeBroadcaster = setStopEpochBroadcaster((b: StopEpochBroadcast) => {
    if (!key) {
      st.unsignedNotSent += 1;
      return;
    }
    seq += 1;
    const m = signStopEpochMessage(key, { replicaId: OT_STOP_EPOCH_REPLICA_ID, seq, issuedAt: b.at, adapterId: b.adapterId });
    void notifyBounded(notifyClient, OT_STOP_EPOCH_CHANNEL, JSON.stringify(m), opts.notifyDeadlineMs).then((r) => {
      if (r.ok) st.notifySent += 1;
      else {
        st.notifyFailed += 1;
        warnRateLimited(`NOTIFY ${OT_STOP_EPOCH_CHANNEL} failed (${r.error}) — other replicas may not learn of this STOP`);
      }
    });
  });

  // ── HELLO (R-12-e M-2)
  st.helloPeers.clear();
  st.peerSeen = false;
  let mismatchAlertAt = 0;
  let lastReplyAt = 0;
  const sendHello = () => {
    if (!key || stopped) return;
    seq += 1;
    const h = signHelloMessage(key, { replicaId: OT_STOP_EPOCH_REPLICA_ID, seq, issuedAt: Date.now() });
    void notifyBounded(notifyClient, OT_STOP_EPOCH_CHANNEL, JSON.stringify(h), opts.notifyDeadlineMs).then((r) => {
      if (r.ok) st.helloSent += 1;
      else warnRateLimited(`hello on ${OT_STOP_EPOCH_CHANNEL} not sent (${r.error})`);
    });
  };
  const onHello = (h: StopEpochHello) => {
    if (!key) return;
    if (h.replicaId === OT_STOP_EPOCH_REPLICA_ID && macOk(key, h)) return; // its own hello
    const verified = macOk(key, h);
    const now = Date.now();
    const known = st.helloPeers.has(h.replicaId);
    if (!known && st.helloPeers.size >= OT_STOP_EPOCH_HELLO_PEERS_MAX) {
      let oldest: string | null = null;
      let t = Infinity;
      for (const [id, x] of st.helloPeers) if (x.lastSeenAt < t) ((t = x.lastSeenAt), (oldest = id));
      if (oldest) st.helloPeers.delete(oldest);
    }
    st.helloPeers.set(h.replicaId, { lastSeenAt: now, verified: verified || (st.helloPeers.get(h.replicaId)?.verified ?? false) });
    if (verified) st.peerSeen = true; // R-12-f
    if (!verified) {
      st.helloMismatches += 1;
      st.helloLastMismatchAt = now;
      if (now - mismatchAlertAt >= OT_STOP_EPOCH_KEY_MISMATCH_ALERT_MS || mismatchAlertAt === 0) {
        mismatchAlertAt = now;
        alert({
          kind: "key_mismatch",
          channel: OT_STOP_EPOCH_CHANNEL,
          reason: `a central replica (${h.replicaId.slice(0, 8)}…) announced itself on ${OT_STOP_EPOCH_CHANNEL} signed with another key (or the hello is forged): STOPs between it and this replica are rejected (bad MAC) — writes there are not cancelled by STOPs sent here and vice versa. ${NO_KEY_FIX} Further mismatches within ${OT_STOP_EPOCH_KEY_MISMATCH_ALERT_MS / 60_000} min are only counted.`,
          at: now,
        });
      }
    }
    // answer a NEW replica once (it booted after us: it must check OUR key too), rate-limited
    if (!known && now - lastReplyAt >= OT_STOP_EPOCH_HELLO_REPLY_MIN_MS) {
      lastReplyAt = now;
      sendHello();
    }
  };

  // ── PIN CHANGES (R-12-g) — every local stop-pin change is broadcast signed; every replica forgets its cached presence for it
  let pinFailAlertAt = 0;
  const removePinBroadcaster = key
    ? setStopPinChangeBroadcaster((adapterId: number) => {
        seq += 1;
        const pm = signPinChangeMessage(key, { replicaId: OT_STOP_EPOCH_REPLICA_ID, seq, issuedAt: Date.now(), adapterId });
        void notifyBounded(notifyClient, OT_STOP_EPOCH_CHANNEL, JSON.stringify(pm), opts.notifyDeadlineMs).then((r) => {
          if (r.ok) {
            st.pinChangesSent += 1;
            return;
          }
          st.pinChangesNotSent += 1;
          const now = Date.now();
          if (pinFailAlertAt === 0 || now - pinFailAlertAt >= OT_STOP_EPOCH_KEY_MISMATCH_ALERT_MS) {
            pinFailAlertAt = now;
            alert({
              kind: "pin_broadcast_failed",
              channel: OT_STOP_EPOCH_CHANNEL,
              reason: `a stop-pin change of adapter ${adapterId} could NOT be broadcast to the other central replicas (${r.error}): until their cached pin presence expires (${STOP_PIN_PRESENCE_TTL_MS / 1000} s) they may still treat the adapter as having no pin — a command's own tag rows still show a pin it writes. Further failures within ${OT_STOP_EPOCH_KEY_MISMATCH_ALERT_MS / 60_000} min are only counted.`,
              at: now,
            });
          }
        });
      })
    : () => undefined;
  const onPinChange = (pm: StopPinChangeMessage) => {
    if (!key) return;
    if (!macOk(key, pm)) return reject("bad_mac", `pin change of adapter ${pm.adapterId}`);
    if (pm.replicaId === OT_STOP_EPOCH_REPLICA_ID) return; // forgotten locally already
    invalidateStopPinPresence(pm.adapterId); // forgetting is always the safe direction: no freshness / replay check needed
    st.pinChangesReceived += 1;
    st.peerSeen = true;
  };

  // ── RECEIVE
  const replicas = new Map<string, { seen: Map<number, number>; lastSeen: number }>();
  const onPayload = (raw: string) => {
    const m = parseStopEpochPayload(raw);
    if (!m) {
      const h = parseHelloPayload(raw);
      if (h) return onHello(h);
      const pc = parsePinChangePayload(raw);
      if (pc) return onPinChange(pc);
      return reject("malformed", `${String(raw).length} chars`);
    }
    if (!key) return reject("no_key", "no HMAC key on this replica");
    if (!macOk(key, m)) return reject("bad_mac", `adapter ${m.adapterId}`);
    if (m.replicaId === OT_STOP_EPOCH_REPLICA_ID) {
      st.ignoredOwn += 1; // already bumped locally when this process sent the STOP
      return;
    }
    const now = Date.now();
    if (Math.abs(now - m.issuedAt) > OT_STOP_EPOCH_MAX_AGE_MS) return reject("stale", `issued ${now - m.issuedAt} ms ago (bound ${OT_STOP_EPOCH_MAX_AGE_MS} ms; clock skew between replicas?)`);
    // replay window: seqs of this replica seen within the freshness window (pruned by issuedAt)
    let r = replicas.get(m.replicaId);
    if (!r) {
      if (replicas.size >= OT_STOP_EPOCH_REPLICAS_MAX) {
        for (const [id, x] of replicas) if (now - x.lastSeen > OT_STOP_EPOCH_MAX_AGE_MS) replicas.delete(id);
      }
      if (replicas.size >= OT_STOP_EPOCH_REPLICAS_MAX) {
        let oldest: string | null = null;
        let t = Infinity;
        for (const [id, x] of replicas) if (x.lastSeen < t) ((t = x.lastSeen), (oldest = id));
        if (oldest) replicas.delete(oldest);
        st.replicaEvictions += 1;
        if (!replicaOverflowAlerted) {
          replicaOverflowAlerted = true;
          alert({ kind: "replica_overflow", channel: OT_STOP_EPOCH_CHANNEL, reason: `more than ${OT_STOP_EPOCH_REPLICAS_MAX} signing replicas within ${OT_STOP_EPOCH_MAX_AGE_MS / 1000} s — replay state evicted (a replay can then only cancel writes)`, at: now });
        }
      }
      r = { seen: new Map(), lastSeen: now };
      replicas.set(m.replicaId, r);
    }
    for (const [s, at] of r.seen) {
      if (now - at > OT_STOP_EPOCH_MAX_AGE_MS) r.seen.delete(s);
      else break; // insertion order ≈ arrival order; an older straggler is pruned on a later pass
    }
    if (r.seen.has(m.seq)) return reject("replay", `replica ${m.replicaId.slice(0, 8)}… seq ${m.seq}`);
    r.seen.set(m.seq, m.issuedAt);
    if (r.seen.size > OT_STOP_EPOCH_SEQS_PER_REPLICA_MAX) r.seen.delete(r.seen.keys().next().value as number);
    r.lastSeen = now;

    const b = bumpAdapterStopEpochFromPeer(m.adapterId, { peer: true, origin: m.replicaId, peerSeq: m.seq, at: m.issuedAt });
    st.peerStops += 1;
    st.peerSeen = true; // R-12-f
    if (b.evicted !== null) {
      st.peerEvictions += 1;
      if (!peerOverflowAlerted) {
        peerOverflowAlerted = true;
        alert({ kind: "peer_overflow", channel: OT_STOP_EPOCH_CHANNEL, reason: `peer STOP map full (${peerStopEpochStats().max} adapters): oldest entries evicted, the epoch floor raised — writes in progress on adapters without an entry are cancelled (safe direction). Flood of signed STOPs?`, at: now });
      }
    }
    const lat = now - m.issuedAt;
    if (lat >= 0) {
      st.lat.push(lat);
      if (st.lat.length > LAT_RING) st.lat.shift();
    }
  };

  st.running = true;
  if (!key) {
    // R-12-e M-1 — DISABLED: no LISTEN (nothing could be verified), nothing sent (the broadcaster above only counts)
    return async () => {
      if (stopped) return;
      stopped = true;
      removeBroadcaster();
      st.running = false;
      active = null;
    };
  }
  listener = await startChannelListener({
    channel: OT_STOP_EPOCH_CHANNEL,
    tag: "OtStopEpochSync",
    onPayload,
    listenClient: opts.listenClient,
    notifyClient,
    pingMs: opts.pingMs,
    pingDeadlineMs: opts.pingDeadlineMs,
    listenDeadlineMs: opts.listenDeadlineMs,
    retryMs: opts.retryMs,
    notifyDeadlineMs: opts.notifyDeadlineMs,
    alert: opts.alert ? (a) => opts.alert!(a) : undefined,
    lostMeaning: "Until it reconnects, a STOP sent by ANOTHER replica does not cancel writes still in this replica's checks (per-process behaviour).",
  });
  sendHello(); // R-12-e M-2 — once listening: the replicas already up verify this one (and answer, so this one verifies them)

  return async () => {
    if (stopped) return;
    stopped = true;
    removeBroadcaster();
    removePinBroadcaster();
    const l = listener;
    listener = null;
    st.running = false;
    active = null;
    if (l) await l.stop();
  };
}
