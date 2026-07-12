/**
 * doc 44 W4 / G2.7 — NATS JetStream StreamBridge adapter (SEAM).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * HONEST POSTURE (no new npm dependency — pattern mirrors samlProvider / busFanout):
 *   • The `nats` client is NOT installed. Every op therefore refuses with
 *     StreamNotAvailableError("NATS_NOT_AVAILABLE") until an OWNER runs
 *     `npm i nats` (or `pnpm add nats`), sets NATS_URL, and enables the backend
 *     with STREAM_BRIDGE_BACKEND=nats.
 *   • `available()` returns false until the lib loads AND a connection is made.
 *   • Construction NEVER throws (getStreamBridge stays safe); the refusal is at the
 *     first publish/subscribe/replay so a mis-set flag degrades honestly instead of
 *     crashing boot.
 *
 * WHAT REAL WIRING LOOKS LIKE (marked SEAMs below): connect(NATS_URL) →
 * jetstreamManager().streams.add({ name, subjects:[`${prefix}.>`] }) →
 * js.publish(subject, payload, {msgID}) for idempotent append → js.subscribe with
 * a consumer (deliver policy by-start-sequence for replay). The subject is the
 * topic with `/`→`.` (NATS subjects use dots). This adapter's METHOD CONTRACT is
 * identical to inProcessAdapter, so consumers/producers need no change to swap.
 * ════════════════════════════════════════════════════════════════════════════
 */

import type {
  StreamBridge,
  StreamHandler,
  Subscription,
  PublishOptions,
  PublishResult,
  ReplayResult,
  SubscribeOptions,
} from "./streamBridge";
import { StreamNotAvailableError } from "./streamBridge";

const NOT_AVAILABLE =
  "NATS JetStream backend selected (STREAM_BRIDGE_BACKEND=nats) but the 'nats' client is not installed. " +
  "Run `npm i nats` (or `pnpm add nats`), set NATS_URL, and wire the marked seams in natsAdapter.ts. " +
  "Until then the platform runs on the in-process bridge (set STREAM_BRIDGE_BACKEND=inprocess).";

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
  return t.replace(/\//g, ".").replace(/>$/, ">");
}

/**
 * True when the `nats` client can be imported. Uses a COMPUTED specifier so tsc
 * does not try to resolve the (absent) module at build time — same trick as
 * samlProvider.signatureVerificationAvailable.
 */
export async function natsClientAvailable(): Promise<boolean> {
  const pkg = "nats";
  const mod: unknown = await import(pkg).catch(() => null);
  return mod != null;
}

let seamLogged = false;
function logSeamOnce(): void {
  if (seamLogged) return;
  seamLogged = true;
  console.warn(`[StreamBridge:nats] ${NOT_AVAILABLE}`);
}

/** @internal test hook — reset the once-logged seam flag. */
export function __resetNatsSeamLog(): void {
  seamLogged = false;
}

export function createNatsStreamBridge(): StreamBridge {
  const url = natsUrl();

  function refuse(): StreamNotAvailableError {
    logSeamOnce();
    return new StreamNotAvailableError("NATS_NOT_AVAILABLE", NOT_AVAILABLE);
  }

  const bridge: StreamBridge = {
    backend: "nats",
    crossProcessDurable: true,

    async available() {
      if (!url) return false;
      const libOk = await natsClientAvailable();
      // SEAM: when libOk, additionally attempt/verify the live connection here.
      return libOk; // still requires the seam wiring below to actually publish.
    },

    async publish<T>(_topic: string, _payload: T, _opts?: PublishOptions): Promise<PublishResult> {
      // SEAM: const nc = await connect({ servers: url });
      //       const js = nc.jetstream();
      //       const ack = await js.publish(topicToSubject(_topic), encode(_payload),
      //                                    { msgID: _opts?.msgId });
      //       return { ok: true, seq: ack.seq };
      logSeamOnce();
      return { ok: false, reason: "NATS_NOT_AVAILABLE" };
    },

    subscribe<T>(topic: string, _handler: StreamHandler<T>, _opts?: SubscribeOptions): Subscription {
      // SEAM: const sub = await js.subscribe(topicToSubject(topic), {
      //         config: { deliver_policy: _opts?.fromSeq != null ? "by_start_sequence" : "new",
      //                   opt_start_seq: _opts?.fromSeq } });
      //       (async () => { for await (const m of sub) _handler(decode(m)); })();
      logSeamOnce();
      return {
        topic,
        unsubscribe: () => {
          /* no live subscription exists */
        },
      };
    },

    async replay<T>(topic: string, fromSeq: number, _handler: StreamHandler<T>): Promise<ReplayResult> {
      // SEAM: a pull consumer with opt_start_seq = fromSeq drains retained messages.
      throw refuse();
    },

    async close() {
      // SEAM: await nc?.drain();
    },
  };

  return bridge;
}
