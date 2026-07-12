/**
 * doc 44 W4 / G2.7 — NATS JetStream StreamBridge adapter (WIRED).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Real cross-process durable log over NATS JetStream. Enabled by
 * STREAM_BRIDGE_BACKEND=nats + NATS_URL, and requires the `nats` client
 * (`npm i nats`). HONEST POSTURE preserved: if the client is absent, NATS_URL is
 * unset, or the connection cannot be made, every op refuses with
 * StreamNotAvailableError("NATS_NOT_AVAILABLE") — it NEVER fakes durability, and
 * construction NEVER throws (getStreamBridge stays safe).
 *
 * MAPPING: topic `a/b/c` → subject `a.b.c`; one JetStream stream named
 * `${prefix}_bridge` covering `${prefix}.>`. publish → js.publish (msgID = dedup);
 * subscribe(fromSeq) → ordered push consumer (deliver-policy by-start-sequence for
 * replay-then-live, else new); replay → pull consumer drained to idle. seq is the
 * JetStream stream sequence (monotonic). The METHOD CONTRACT matches
 * inProcessAdapter so producers/consumers swap with zero change.
 * ════════════════════════════════════════════════════════════════════════════
 */

import type {
  StreamBridge,
  StreamHandler,
  StreamMessage,
  Subscription,
  PublishOptions,
  PublishResult,
  ReplayResult,
  SubscribeOptions,
} from "./streamBridge";
import { StreamNotAvailableError } from "./streamBridge";

const NOT_AVAILABLE =
  "NATS JetStream backend selected (STREAM_BRIDGE_BACKEND=nats) but it is not usable: " +
  "either the 'nats' client is not installed (run `npm i nats`), NATS_URL is unset, or the " +
  "connection failed. Until then set STREAM_BRIDGE_BACKEND=inprocess to run on the in-process bridge.";

/** NATS server URL (owner-provided when the real backend is enabled). */
export function natsUrl(): string | null {
  return process.env.NATS_URL?.trim() || null;
}

/** JetStream stream/subject prefix. */
export function natsStreamPrefix(): string {
  return process.env.NATS_STREAM_PREFIX?.trim() || "syn";
}

/** Topic (`a/b/c`) → NATS subject (`a.b.c`). Trailing `*` wildcard → `>` (NATS multi-level). */
export function topicToSubject(topic: string): string {
  const t = topic.endsWith("/*") ? topic.slice(0, -2) + "/>" : topic;
  return t.replace(/\//g, ".");
}

/** Subject (`a.b.c`) → topic (`a/b/c`). Inverse of topicToSubject for delivered messages. */
function subjectToTopic(subject: string): string {
  return subject.replace(/\./g, "/");
}

/**
 * True when the `nats` client can be imported. Uses a COMPUTED specifier so tsc
 * does not hard-resolve the (optional) module at build time.
 */
export async function natsClientAvailable(): Promise<boolean> {
  const pkg = "nats";
  const mod: unknown = await import(pkg).catch(() => null);
  return mod != null;
}

let seamLogged = false;
function logSeamOnce(reason?: string): void {
  if (seamLogged) return;
  seamLogged = true;
  console.warn(`[StreamBridge:nats] ${reason ?? NOT_AVAILABLE}`);
}

/** @internal test hook — reset the once-logged seam flag. */
export function __resetNatsSeamLog(): void {
  seamLogged = false;
}

// ─── Lazy connection (shared, fail-safe) ──────────────────────────────────────

interface NatsRuntime {
  nc: any;
  js: any;
  codec: { encode: (v: unknown) => Uint8Array; decode: (u: Uint8Array) => unknown };
  consumerOpts: () => any;
  stream: string;
  prefix: string;
}

export function createNatsStreamBridge(): StreamBridge {
  const url = natsUrl();
  const prefix = natsStreamPrefix();
  const streamName = `${prefix}_bridge`;
  let rt: NatsRuntime | null = null;
  let connecting: Promise<NatsRuntime | null> | null = null;

  /** Connect + ensure the JetStream stream exists. Returns null (never throws) on any failure. */
  async function ensure(): Promise<NatsRuntime | null> {
    if (rt) return rt;
    if (!url) return null;
    if (connecting) return connecting;
    connecting = (async () => {
      try {
        const pkg = "nats";
        const mod: any = await import(pkg).catch(() => null);
        if (!mod?.connect) return null;
        const nc = await mod.connect({ servers: url, name: "synapse-stream-bridge", maxReconnectAttempts: -1 });
        const jsm = await nc.jetstreamManager();
        // Idempotent stream covering the whole prefix subtree.
        try {
          await jsm.streams.add({ name: streamName, subjects: [`${prefix}.>`] });
        } catch {
          // already exists (or subjects overlap) — update is best-effort.
          try {
            await jsm.streams.update(streamName, { subjects: [`${prefix}.>`] });
          } catch {
            /* keep existing config */
          }
        }
        const codec = mod.JSONCodec();
        rt = { nc, js: nc.jetstream(), codec, consumerOpts: mod.consumerOpts, stream: streamName, prefix };
        return rt;
      } catch (err) {
        logSeamOnce(`[StreamBridge:nats] connect failed: ${(err as Error)?.message ?? err}`);
        return null;
      } finally {
        connecting = null;
      }
    })();
    return connecting;
  }

  function toStreamMessage<T>(m: any): StreamMessage<T> {
    const subject: string = m.subject ?? "";
    const headers: Record<string, string> = {};
    if (m.headers) {
      for (const k of m.headers.keys?.() ?? []) headers[k] = m.headers.get(k);
    }
    return {
      topic: subjectToTopic(subject),
      seq: Number(m.seq ?? m.info?.streamSequence ?? 0),
      ts: m.info?.timestampNanos ? Math.floor(Number(m.info.timestampNanos) / 1e6) : Date.now(),
      headers: Object.keys(headers).length ? headers : undefined,
      payload: rt!.codec.decode(m.data) as T,
    };
  }

  const bridge: StreamBridge = {
    backend: "nats",
    crossProcessDurable: true,

    async available() {
      if (!url) return false;
      return (await ensure()) != null;
    },

    async publish<T>(topic: string, payload: T, opts?: PublishOptions): Promise<PublishResult> {
      const r = await ensure();
      if (!r) {
        logSeamOnce();
        return { ok: false, reason: "NATS_NOT_AVAILABLE" };
      }
      try {
        const mod: any = await import("nats");
        const pubOpts: any = {};
        if (opts?.msgId) pubOpts.msgID = opts.msgId;
        if (opts?.headers) {
          const h = mod.headers();
          for (const [k, v] of Object.entries(opts.headers)) h.set(k, v);
          pubOpts.headers = h;
        }
        const ack = await r.js.publish(topicToSubject(topic), r.codec.encode(payload), pubOpts);
        return { ok: true, seq: Number(ack.seq) };
      } catch (err) {
        return { ok: false, reason: `NATS_PUBLISH_FAILED: ${(err as Error)?.message ?? err}` };
      }
    },

    subscribe<T>(topic: string, handler: StreamHandler<T>, opts?: SubscribeOptions): Subscription {
      let sub: any = null;
      let closed = false;
      void (async () => {
        const r = await ensure();
        if (!r || closed) {
          if (!r) logSeamOnce();
          return;
        }
        try {
          const co = r.consumerOpts();
          co.deliverTo((await import("nats")).createInbox());
          co.ackNone();
          if (opts?.fromSeq != null && opts.fromSeq > 0) co.startSequence(opts.fromSeq);
          else co.deliverNew();
          co.callback((err: any, m: any) => {
            if (err || !m) return;
            try {
              void handler(toStreamMessage<T>(m));
            } catch {
              /* handler error never breaks the loop */
            }
          });
          sub = await r.js.subscribe(topicToSubject(topic), co);
        } catch (err) {
          logSeamOnce(`[StreamBridge:nats] subscribe failed: ${(err as Error)?.message ?? err}`);
        }
      })();
      return {
        topic,
        unsubscribe: () => {
          closed = true;
          try {
            sub?.unsubscribe?.();
          } catch {
            /* best-effort */
          }
        },
      };
    },

    async replay<T>(topic: string, fromSeq: number, handler: StreamHandler<T>): Promise<ReplayResult> {
      const r = await ensure();
      if (!r) {
        logSeamOnce();
        throw new StreamNotAvailableError("NATS_NOT_AVAILABLE", NOT_AVAILABLE);
      }
      let delivered = 0;
      let toSeq: number | null = null;
      try {
        const mod: any = await import("nats");
        // Ordered PUSH consumer from opt_start_seq; drain until idle (caught up),
        // then tear down. Avoids the finicky pull API — the push path is what the
        // live subscribe uses, so it is the most robust across nats 2.x.
        const co = r.consumerOpts();
        co.deliverTo(mod.createInbox());
        co.ackNone();
        co.startSequence(Math.max(1, fromSeq));
        let lastAt = Date.now();
        co.callback((err: any, m: any) => {
          if (err || !m) return;
          delivered++;
          toSeq = Number(m.seq ?? toSeq ?? 0);
          lastAt = Date.now();
          try {
            void handler(toStreamMessage<T>(m));
          } catch {
            /* per-message */
          }
        });
        const sub = await r.js.subscribe(topicToSubject(topic), co);
        // Idle-drain: resolve once no message has arrived for `idleMs`.
        const idleMs = 500;
        await new Promise<void>((resolve) => {
          const timer = setInterval(() => {
            if (Date.now() - lastAt >= idleMs) {
              clearInterval(timer);
              resolve();
            }
          }, 100);
        });
        try {
          sub.unsubscribe?.();
        } catch {
          /* best-effort */
        }
        return { ok: true, delivered, fromSeq, toSeq };
      } catch (err) {
        return { ok: false, delivered, fromSeq, toSeq, reason: `NATS_REPLAY_FAILED: ${(err as Error)?.message ?? err}` };
      }
    },

    async close() {
      try {
        await rt?.nc?.drain?.();
      } catch {
        /* best-effort */
      }
      rt = null;
    },
  };

  return bridge;
}
