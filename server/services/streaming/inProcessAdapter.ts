/**
 * doc 44 W4 / G2.7 — IN-PROCESS StreamBridge adapter (usable now, zero infra).
 *
 * Wraps an in-memory pub/sub over a BOUNDED ring buffer that simulates a durable
 * log for the Machine/Line edition (single process):
 *   • append: each publish assigns a per-topic monotonic `seq` (survives eviction —
 *     seq keeps counting even after the oldest messages are dropped) and pushes the
 *     message into a global ring of capacity STREAM_RING_MAX. Oldest is evicted
 *     when full (bounded memory — never OOM under sustained load).
 *   • deliver: live subscribers whose pattern matches (topicMatches) get the message.
 *   • replay(topic, fromSeq): re-delivers retained messages with per-topic seq ≥
 *     fromSeq. If the ring already evicted some of them, `truncated: true` is set —
 *     honest about the bound (an in-memory log is NOT infinite retention; that is
 *     exactly why the nats adapter exists for Site scale).
 *
 * This is the SAME semantics the nats adapter must honour, so a consumer written
 * against inProcess works unchanged on JetStream. It bridges telemetryBus only via
 * the OPTIONAL, flag-gated tap in telemetryStreamTap.ts — this file itself never
 * imports telemetryBus (keeps the abstraction free of the ingest path).
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
import { topicMatches, ringMax } from "./streamBridge";

interface LocalSub {
  id: number;
  topic: string;
  handler: StreamHandler<any>;
}

export function createInProcessStreamBridge(): StreamBridge {
  // Global bounded ring (FIFO). Each entry is a full StreamMessage.
  const ring: StreamMessage<any>[] = [];
  const cap = ringMax();
  // Per-topic monotonic sequence — continues past eviction (never resets).
  const seqByTopic = new Map<string, number>();
  // Lowest per-topic seq still retained in the ring (for truncation detection).
  const oldestRetainedSeq = new Map<string, number>();
  const subs = new Map<number, LocalSub>();
  let subId = 0;
  let closed = false;

  function nextSeq(topic: string): number {
    const s = (seqByTopic.get(topic) ?? 0) + 1;
    seqByTopic.set(topic, s);
    return s;
  }

  function evictIfNeeded(): void {
    while (ring.length > cap) {
      const dropped = ring.shift();
      if (!dropped) break;
      // The next-oldest retained seq for that topic is now dropped.seq + 1 (approx —
      // exact enough for the truncation flag; a scan would be O(n)).
      oldestRetainedSeq.set(dropped.topic, dropped.seq + 1);
    }
  }

  async function deliver(msg: StreamMessage<any>): Promise<void> {
    for (const sub of subs.values()) {
      if (!topicMatches(sub.topic, msg.topic)) continue;
      try {
        await sub.handler(msg);
      } catch (err) {
        // Isolate subscriber faults — one bad handler never blocks delivery.
        console.error(`[StreamBridge:inprocess] subscriber for ${sub.topic} threw:`, (err as Error)?.message ?? err);
      }
    }
  }

  const bridge: StreamBridge = {
    backend: "inprocess",
    crossProcessDurable: false,

    async available() {
      return !closed;
    },

    async publish<T>(topic: string, payload: T, opts?: PublishOptions): Promise<PublishResult> {
      if (closed) return { ok: false, reason: "BRIDGE_CLOSED" };
      const seq = nextSeq(topic);
      const msg: StreamMessage<T> = {
        topic,
        seq,
        ts: Date.now(),
        ...(opts?.headers ? { headers: opts.headers } : {}),
        payload,
      };
      if (!oldestRetainedSeq.has(topic)) oldestRetainedSeq.set(topic, seq);
      ring.push(msg);
      evictIfNeeded();
      await deliver(msg);
      return { ok: true, seq };
    },

    subscribe<T>(topic: string, handler: StreamHandler<T>, opts?: SubscribeOptions): Subscription {
      const id = ++subId;
      subs.set(id, { id, topic, handler: handler as StreamHandler<any> });
      // Optional replay-on-subscribe (deliver-by-start-sequence).
      if (opts?.fromSeq != null) {
        void this.replay(topic, opts.fromSeq, handler);
      }
      return {
        topic,
        unsubscribe: () => {
          subs.delete(id);
        },
      };
    },

    async replay<T>(topic: string, fromSeq: number, handler: StreamHandler<T>): Promise<ReplayResult> {
      if (closed) return { ok: false, delivered: 0, fromSeq, toSeq: null, reason: "BRIDGE_CLOSED" };
      const oldest = oldestRetainedSeq.get(topic);
      const truncated = oldest != null && fromSeq < oldest;
      let delivered = 0;
      let toSeq: number | null = null;
      // Snapshot the matching retained messages, in seq order (ring is already FIFO).
      const matching = ring.filter(
        (m) => topicMatches(topic, m.topic) && m.seq >= fromSeq,
      );
      for (const m of matching) {
        try {
          await (handler as StreamHandler<any>)(m);
          delivered++;
          toSeq = m.seq;
        } catch (err) {
          console.error(`[StreamBridge:inprocess] replay handler threw at seq ${m.seq}:`, (err as Error)?.message ?? err);
        }
      }
      return { ok: true, delivered, fromSeq, toSeq, ...(truncated ? { truncated: true } : {}) };
    },

    async close() {
      closed = true;
      subs.clear();
      ring.length = 0;
      seqByTopic.clear();
      oldestRetainedSeq.clear();
    },
  };

  return bridge;
}
