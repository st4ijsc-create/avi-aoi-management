/**
 * Rate-limit configuration (extended by W4-D — doc 27 §8 gap B6).
 *
 * Store selection:
 *   - REDIS_URL set (and RATE_LIMIT_REDIS !== "false") → a small Redis-backed
 *     fixed-window store (dedicated ioredis connection — deliberately NOT the
 *     redisService cache client, so cache pipelines and rate-limit INCRs never
 *     queue behind each other). Counters are shared across instances, which
 *     the in-memory default cannot do.
 *   - otherwise → express-rate-limit's built-in MemoryStore (previous
 *     behaviour, unchanged). Single-instance only.
 *
 * Fail-open posture: `passOnStoreError: true` — if Redis is down, requests are
 * ALLOWED (and the error logged) instead of 500-ing all traffic. The store
 * client uses `enableOfflineQueue: false` so a dead Redis fails fast instead
 * of buffering commands.
 *
 * Key strategy (API limiter, gap B6 "key theo API-key/user"): machine/API-key
 * clients are keyed by a SHA-256 hash of their `x-api-key`; browser sessions
 * by a hash of the session cookie; bearer tokens by a hash of the token; only
 * anonymous clients fall back to the client IP (IPv6-safe via ipKeyGenerator).
 * This fixes the factory-NAT problem where all machines/operators behind one
 * IP shared a single bucket. Hashing keeps raw credentials out of Redis keys
 * and logs. The AUTH limiter deliberately stays IP-keyed (anti-brute-force on
 * login, where no credential exists yet).
 *
 * NOTE (W2-C interim limiter): machineAuthService's per-machine ingest limiter
 * is a non-pluggable in-memory Map — it stays instance-local for now (see
 * doc 27 Đợt 2 note; honest interim until it grows a pluggable store).
 */
import rateLimit, {
  ipKeyGenerator,
  type ClientRateLimitInfo,
  type Options,
  type Store,
} from "express-rate-limit";
import { createHash } from "crypto";
import type { Request } from "express";
import Redis from "ioredis";
import { COOKIE_NAME } from "@shared/const";

const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const API_PER_MIN = envInt("RATE_LIMIT_PER_MINUTE", 300);
const AUTH_PER_15MIN = envInt("AUTH_RATE_LIMIT_PER_15MIN", 30);

export const API_RATE_LIMIT = {
  windowMs: 60 * 1000,
  max: API_PER_MIN,
};

export const AUTH_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  max: AUTH_PER_15MIN,
};

// ── Store selection (B6) ─────────────────────────────────────────────────────

export type RateLimitStoreKind = "redis" | "memory";

/** Which store the limiters will use, given current env. Pure — exported for tests. */
export function resolveRateLimitStoreKind(): RateLimitStoreKind {
  if (process.env.RATE_LIMIT_REDIS === "false") return "memory"; // escape hatch
  return process.env.REDIS_URL ? "redis" : "memory";
}

/** Minimal Redis surface the store needs — lets tests inject a fake client. */
export interface MinimalRedisClient {
  incr(key: string): Promise<number>;
  pttl(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<unknown>;
  decr(key: string): Promise<number>;
  del(key: string): Promise<unknown>;
}

/**
 * Fixed-window Redis store for express-rate-limit v7+/v8 (INCR + PEXPIRE).
 * Small on purpose (no extra dependency): INCR the counter, stamp the window
 * TTL on first hit (or when the key somehow lost its TTL), report resetTime
 * from PTTL. Any thrown error is handled by the limiter's passOnStoreError.
 */
export class RedisRateLimitStore implements Store {
  /** Counters live in Redis — shared across instances. */
  readonly localKeys = false;
  prefix: string;
  windowMs = 60 * 1000;
  private client: MinimalRedisClient;

  constructor(opts: { prefix: string; client: MinimalRedisClient }) {
    this.prefix = opts.prefix;
    this.client = opts.client;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const k = this.prefix + key;
    const totalHits = await this.client.incr(k);
    let ttl = await this.client.pttl(k);
    if (ttl < 0) {
      // First hit of a window (or TTL lost) — start the window now.
      await this.client.pexpire(k, this.windowMs);
      ttl = this.windowMs;
    }
    return { totalHits, resetTime: new Date(Date.now() + ttl) };
  }

  async decrement(key: string): Promise<void> {
    await this.client.decr(this.prefix + key);
  }

  async resetKey(key: string): Promise<void> {
    await this.client.del(this.prefix + key);
  }
}

// One shared (lazy) ioredis connection for all limiters in this process.
let _redisClient: MinimalRedisClient | null = null;
let _redisInitFailed = false;

function getRateLimitRedis(): MinimalRedisClient | null {
  if (_redisClient || _redisInitFailed) return _redisClient;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    // Dedicated connection: rate-limit INCRs must not queue behind cache
    // pipelines (redisService), and redisService gives up reconnecting after
    // 3 tries while a limiter store should keep trying (capped backoff).
    const client = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false, // fail fast → passOnStoreError lets requests through
      maxRetriesPerRequest: 1,
      retryStrategy: (times: number) => Math.min(times * 200, 5000),
    });
    client.on("error", (err: Error) => {
      console.error("[RateLimit] Redis store error (fail-open):", err.message);
    });
    client.connect().catch((err: Error) => {
      console.error("[RateLimit] Redis store initial connect failed (fail-open):", err.message);
    });
    _redisClient = client;
    console.log("[RateLimit] Using Redis-backed rate-limit store");
  } catch (err: any) {
    _redisInitFailed = true;
    console.error("[RateLimit] Redis store init failed — falling back to memory:", err?.message ?? err);
  }
  return _redisClient;
}

/** `{ store }` option when Redis mode is active, `{}` for the memory default. */
function storeOption(prefix: string): { store?: Store } {
  if (resolveRateLimitStoreKind() !== "redis") return {};
  const client = getRateLimitRedis();
  if (!client) return {}; // init failed → memory fallback
  return { store: new RedisRateLimitStore({ prefix, client }) };
}

// ── Key strategy (B6) ────────────────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 32);
}

/**
 * Per-client key for the general API limiter: API-key > bearer token >
 * session cookie > IP. Credentials are hashed — never stored/logged raw.
 * The IP fallback is deliberately UN-prefixed (bare ipKeyGenerator output) so
 * it stays compatible with pre-B6 behaviour (`limiter.resetKey("<ip>")`).
 * Exported for tests.
 */
export function apiKeyGenerator(req: Request): string {
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.length > 0) return `key:${hashToken(apiKey)}`;

  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ") && auth.length > 7) {
    return `bearer:${hashToken(auth.slice(7))}`;
  }

  const cookies = req.headers.cookie;
  if (typeof cookies === "string" && cookies.length > 0) {
    const m = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
    if (m?.[1]) return `sess:${hashToken(m[1])}`;
  }

  return ipKeyGenerator(req.ip ?? "", 56);
}

// ── Limiter factories ────────────────────────────────────────────────────────

export function createApiLimiter() {
  return rateLimit({
    ...API_RATE_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
    keyGenerator: apiKeyGenerator,
    passOnStoreError: true, // Redis down → allow (fail-open), never 500 all traffic
    ...storeOption("rl:api:"),
  });
}

export function createAuthLimiter() {
  return rateLimit({
    ...AUTH_RATE_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many login attempts, please try again later" },
    // Deliberately IP-keyed (default): brute-force protection happens before
    // any credential exists to key on.
    passOnStoreError: true,
    ...storeOption("rl:auth:"),
  });
}
