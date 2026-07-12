/**
 * doc 44 W4 / G2.7 — STREAMING BRIDGE abstraction (SYNAPSE_Tang2 Ch.7 "streaming
 * bus + xử lý luồng"; DEVPLAN D2 = NATS JetStream first, Kafka when Site scales).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ONE durable-log abstraction over the platform so producers/consumers do not
 * bind to a concrete broker. Two adapters behind the SAME interface:
 *
 *   • inProcessAdapter  — usable RIGHT NOW, zero infra. Wraps an in-memory
 *     pub/sub + a BOUNDED ring buffer that simulates a durable log (monotonic per
 *     topic `seq`, in-session `replay(fromSeq)`). Correct for Machine/Line edition
 *     where everything runs in one process.
 *
 *   • natsAdapter       — SEAM. NATS JetStream via the `nats` client. Because that
 *     client is NOT a dependency yet, every op HONESTLY refuses with
 *     NATS_NOT_AVAILABLE until an owner runs `npm i nats` and the flag is flipped
 *     (same posture as samlProvider / busFanout). It NEVER fakes cross-process
 *     durability.
 *
 * FOLDABLE ARCHITECTURE (ADR-007): default backend is `inprocess` so nothing in
 * the codebase assumes a broker exists. `STREAM_BRIDGE_BACKEND=nats` opts a Site
 * deployment up to a real durable log without touching producer/consumer code.
 *
 * SAFETY: this bus carries telemetry/events for replay/reprocessing ONLY — it is
 * NOT a device-command path (same invariant as telemetryBus / busFanout).
 *
 * Env (all optional; default = in-process, zero infra):
 *   STREAM_BRIDGE_BACKEND     "inprocess" (default) | "nats"
 *   STREAM_RING_MAX           in-process ring capacity (default 50000 messages)
 *   NATS_URL                  NATS server URL (nats adapter; e.g. nats://127.0.0.1:4222)
 *   NATS_STREAM_PREFIX        JetStream stream/subject prefix (default "syn")
 * ════════════════════════════════════════════════════════════════════════════
 */

export type StreamBackend = "inprocess" | "nats";

/** One message on the log. `seq` is the per-topic monotonic sequence (JetStream stream seq). */
export interface StreamMessage<T = unknown> {
  topic: string;
  seq: number;
  /** Publish (append) time, epoch ms. */
  ts: number;
  headers?: Record<string, string>;
  payload: T;
}

export type StreamHandler<T = unknown> = (msg: StreamMessage<T>) => void | Promise<void>;

export interface Subscription {
  readonly topic: string;
  unsubscribe(): void | Promise<void>;
}

export interface PublishOptions {
  headers?: Record<string, string>;
  /** Idempotency key — adapters that support dedup (JetStream Nats-Msg-Id) use it. */
  msgId?: string;
}

export interface PublishResult {
  ok: boolean;
  /** Assigned per-topic seq when the append was durable. */
  seq?: number;
  /** Honest failure reason, e.g. "NATS_NOT_AVAILABLE". */
  reason?: string;
}

export interface ReplayResult {
  ok: boolean;
  delivered: number;
  fromSeq: number;
  /** Highest seq delivered (null when nothing replayed). */
  toSeq: number | null;
  /** True when the ring had already evicted messages ≥ fromSeq (bounded-log truncation). */
  truncated?: boolean;
  reason?: string;
}

export interface SubscribeOptions {
  /**
   * When set, the adapter first REPLAYS retained messages with seq ≥ fromSeq to the
   * handler, then delivers live messages (JetStream deliver-policy by-start-sequence).
   */
  fromSeq?: number;
}

/**
 * The bus contract. Topic strings are opaque and hierarchical with `/` (e.g.
 * "syn/telemetry"); the nats adapter maps `/`→`.` for subjects. `subscribe`
 * supports a single trailing `*` wildcard ("syn/telemetry/*") — see topicMatches.
 */
export interface StreamBridge {
  readonly backend: StreamBackend;
  /** True when the backend can DURABLY persist across processes (nats), false for in-process ring. */
  readonly crossProcessDurable: boolean;
  /** Whether the underlying transport is actually usable right now (nats lib installed + connected). */
  available(): Promise<boolean>;
  publish<T>(topic: string, payload: T, opts?: PublishOptions): Promise<PublishResult>;
  subscribe<T>(topic: string, handler: StreamHandler<T>, opts?: SubscribeOptions): Subscription;
  replay<T>(topic: string, fromSeq: number, handler: StreamHandler<T>): Promise<ReplayResult>;
  close(): Promise<void>;
}

/** Raised by an adapter whose transport lib/connection is absent (honest seam). */
export class StreamNotAvailableError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "StreamNotAvailableError";
  }
}

// ─── Topic matching (exact + single trailing `*` wildcard) ────────────────────

/**
 * Match a subscription `pattern` against a concrete `topic`. Supports an exact
 * match and a trailing `*` meaning "this segment and everything below":
 *   "syn/telemetry"    matches only "syn/telemetry"
 *   "syn/telemetry/*"  matches "syn/telemetry/l1", "syn/telemetry/l1/dev0", …
 *   "*"                matches everything
 * Pure — used by inProcessAdapter and unit-tested.
 */
export function topicMatches(pattern: string, topic: string): boolean {
  if (pattern === topic) return true;
  if (pattern === "*") return true;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1); // keep trailing "/"
    return topic.startsWith(prefix);
  }
  return false;
}

// ─── Flags / config ───────────────────────────────────────────────────────────

/** Selected backend (read at call time — test-friendly). Default in-process. */
export function streamBackend(): StreamBackend {
  return process.env.STREAM_BRIDGE_BACKEND === "nats" ? "nats" : "inprocess";
}

export function ringMax(): number {
  const n = parseInt(String(process.env.STREAM_RING_MAX ?? ""), 10);
  return Number.isFinite(n) && n >= 100 ? n : 50000;
}

// ─── Singleton factory ────────────────────────────────────────────────────────

let singleton: StreamBridge | null = null;

/**
 * Get the process-wide StreamBridge for the configured backend. Lazily created;
 * `resetStreamBridge()` (tests) tears it down. The nats adapter construction never
 * throws for a missing lib — it defers the honest refusal to the first op.
 */
export async function getStreamBridge(): Promise<StreamBridge> {
  if (singleton) return singleton;
  if (streamBackend() === "nats") {
    const { createNatsStreamBridge } = await import("./natsAdapter");
    singleton = createNatsStreamBridge();
  } else {
    const { createInProcessStreamBridge } = await import("./inProcessAdapter");
    singleton = createInProcessStreamBridge();
  }
  return singleton;
}

/** Tear down + clear the singleton (tests / graceful shutdown). */
export async function resetStreamBridge(): Promise<void> {
  if (singleton) {
    try {
      await singleton.close();
    } catch {
      /* best-effort */
    }
    singleton = null;
  }
}
