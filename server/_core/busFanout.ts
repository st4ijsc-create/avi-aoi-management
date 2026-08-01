/**
 * U6-b (doc 21 §6 U6 / G-10) — OPTIONAL cross-instance pub/sub fan-out adapter.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * PROBLEM (G-10): server/_core/eventBus.ts + server/services/telemetryBus.ts are
 * single-instance in-process EventEmitters. With ≥2 app instances (multi-site /
 * 10x scale) an event published on instance A is NEVER seen by a subscriber on
 * instance B — a hard ceiling for horizontal scale.
 *
 * THIS FILE provides a small pub/sub ABSTRACTION that the buses use to OPTIONALLY
 * mirror their events across instances via Redis, WITHOUT changing their default
 * behaviour:
 *   • Default: in-process only (no fan-out). Zero overhead, no dependency touched.
 *   • Opt-in: when EVENTBUS_REDIS_ENABLED=true AND a Redis client is available
 *     (REDIS_URL set + `ioredis` installed — which it IS in this repo), each locally
 *     ORIGINATED event is PUBLISHED to a Redis channel, and events from OTHER
 *     instances are SUBSCRIBED back and re-injected into the local bus.
 *   • Honest seam: if the flag is on but no Redis client can be created (no
 *     REDIS_URL / dep missing / connect fails) it logs ONCE and stays in-process.
 *     It NEVER fakes cross-instance delivery.
 *
 * LOOPBACK SAFETY: every published message carries an `origin` = this process's
 * unique id. A message received from Redis whose origin === our own id is dropped
 * (we already delivered it locally), and a message injected from Redis is NOT
 * re-published to Redis (the inject path is separate from the publish path). So an
 * event makes exactly one round trip and is delivered once per remote instance.
 *
 * SAFETY: this carries notifications/telemetry only — same invariant as the buses
 * it backs. It MUST NOT be used to issue device-control commands.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from "crypto";

/** Wire envelope for one fanned-out message. `d` is the bus-specific payload. */
export interface FanoutEnvelope {
  /** Unique id of the ORIGIN process (loopback guard). */
  o: string;
  /** Bus channel key ("event" | "telemetry"). */
  c: string;
  /** Bus-specific payload (already JSON-safe). */
  d: unknown;
}

/** A local injector: called with a remote message's payload to re-emit locally. */
export type FanoutInjector = (payload: unknown) => void;

/** Common shape both bus adapters expose. */
export interface BusFanout {
  /** True when cross-instance fan-out is actually active (flag ON + client up). */
  readonly active: boolean;
  /** Publish a locally-originated payload to remote instances (no-op if inactive). */
  publish(payload: unknown): void;
  /** Register the local injector invoked for each REMOTE message. Returns unsub. */
  onRemote(inject: FanoutInjector): () => void;
  /** Tear down (tests / shutdown). */
  close(): Promise<void>;
}

/** This process's stable origin id — the loopback discriminator. */
export const PROCESS_ORIGIN = randomUUID();

const REDIS_CHANNEL_PREFIX = "avi:busfanout:";

function fanoutFlagOn(): boolean {
  return String(process.env.EVENTBUS_REDIS_ENABLED ?? "").toLowerCase() === "true";
}

/**
 * Factory used by an ioredis-like duplex client. Extracted so tests can inject a
 * mock pub/sub pair without a real Redis. `makeClient` must return two clients
 * (publisher + subscriber) or null when none can be created (honest seam).
 */
export interface RedisLikePubSub {
  pub: {
    publish(channel: string, message: string): unknown;
    quit?(): Promise<unknown> | unknown;
  };
  sub: {
    subscribe(channel: string, cb?: (err: Error | null) => void): unknown;
    on(event: "message", cb: (channel: string, message: string) => void): unknown;
    quit?(): Promise<unknown> | unknown;
  };
}

let seamLogged = false;
function logSeamOnce(busKey: string): void {
  if (seamLogged) return;
  seamLogged = true;
  console.warn(
    `[BusFanout:${busKey}] EVENTBUS_REDIS_ENABLED=true but no Redis client is available ` +
      "(set REDIS_URL and ensure ioredis is installed). Staying IN-PROCESS — " +
      "cross-instance fan-out is NOT active. This is an honest seam, not a fake.",
  );
}

/** @internal test hook — reset the once-logged seam flag. */
export function __resetSeamLog(): void {
  seamLogged = false;
}

/**
 * Build the ioredis-backed pub/sub pair, or null (honest seam). Guarded + dynamic
 * so nothing breaks when REDIS_URL is unset. ioredis IS a dependency of this repo,
 * so when REDIS_URL is present this genuinely fans out cross-instance.
 */
async function defaultRedisFactory(): Promise<RedisLikePubSub | null> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;
  try {
    const mod: any = await import("ioredis").catch(() => null);
    if (!mod) return null;
    const Redis = mod.default ?? mod;
    const pub = new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: 3 });
    const sub = pub.duplicate();
    pub.on("error", (err: Error) => console.error("[BusFanout][pub] error:", err.message));
    sub.on("error", (err: Error) => console.error("[BusFanout][sub] error:", err.message));
    return { pub, sub };
  } catch (err) {
    console.error("[BusFanout] Redis client init failed:", (err as Error)?.message ?? err);
    return null;
  }
}

/**
 * Create a fan-out adapter for one bus channel.
 *
 * @param busKey        stable channel key, e.g. "event" or "telemetry".
 * @param redisFactory  DI hook for the pub/sub pair (defaults to ioredis). Tests
 *                      pass a mock. Return null → honest in-process seam.
 * @param flagOn        DI hook for the enable flag (defaults to env). Tests override.
 */
export function createBusFanout(
  busKey: string,
  redisFactory: () => Promise<RedisLikePubSub | null> = defaultRedisFactory,
  flagOn: () => boolean = fanoutFlagOn,
): BusFanout {
  const channel = REDIS_CHANNEL_PREFIX + busKey;
  const injectors = new Set<FanoutInjector>();

  let clients: RedisLikePubSub | null = null;
  let active = false;

  // Wire up asynchronously when (and only when) the flag is on. If the flag is
  // off we never touch Redis at all — pure in-process, zero overhead.
  const ready: Promise<void> = (async () => {
    if (!flagOn()) return; // in-process default
    const c = await redisFactory();
    if (!c) {
      logSeamOnce(busKey); // honest seam — no fake cross-instance delivery
      return;
    }
    clients = c;
    try {
      c.sub.subscribe(channel);
      c.sub.on("message", (ch, message) => {
        if (ch !== channel) return;
        let env: FanoutEnvelope | null = null;
        try {
          env = JSON.parse(message) as FanoutEnvelope;
        } catch {
          return; // malformed — ignore
        }
        // LOOPBACK GUARD: drop our own echoes (already delivered locally).
        if (!env || env.o === PROCESS_ORIGIN || env.c !== busKey) return;
        for (const inject of injectors) {
          try {
            inject(env.d);
          } catch (err) {
            console.error(`[BusFanout:${busKey}] injector failed:`, (err as Error)?.message ?? err);
          }
        }
      });
      active = true;
      console.log(`[BusFanout:${busKey}] cross-instance fan-out ACTIVE (Redis channel ${channel}).`);
    } catch (err) {
      console.error(`[BusFanout:${busKey}] subscribe failed, staying in-process:`, (err as Error)?.message ?? err);
      clients = null;
      active = false;
    }
  })();

  return {
    get active() {
      return active;
    },
    publish(payload: unknown) {
      // Only publish once the async wiring has settled AND a client is up.
      if (!clients) return; // inactive (flag off, seam, or not-yet-ready) → in-process only
      const env: FanoutEnvelope = { o: PROCESS_ORIGIN, c: busKey, d: payload };
      try {
        clients.pub.publish(channel, JSON.stringify(env));
      } catch (err) {
        console.error(`[BusFanout:${busKey}] publish failed:`, (err as Error)?.message ?? err);
      }
    },
    onRemote(inject: FanoutInjector) {
      injectors.add(inject);
      return () => injectors.delete(inject);
    },
    async close() {
      await ready.catch(() => {});
      injectors.clear();
      const c = clients;
      clients = null;
      active = false;
      if (c) {
        try { await c.pub.quit?.(); } catch { /* ignore */ }
        try { await c.sub.quit?.(); } catch { /* ignore */ }
      }
    },
  };
}
