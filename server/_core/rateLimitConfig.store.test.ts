/**
 * W4-D (doc 27 §8 gap B6) — rate-limit store selection + Redis store unit tests.
 *
 * The Redis path is unit-tested against a fake MinimalRedisClient (no real
 * Redis needed); the memory fallback is asserted via resolveRateLimitStoreKind
 * and by constructing the limiter with REDIS_URL unset. The end-to-end 429
 * behaviour of the memory store is already covered by
 * server/rateLimitConfig.test.ts (real HTTP requests).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { COOKIE_NAME } from "@shared/const";
import {
  resolveRateLimitStoreKind,
  RedisRateLimitStore,
  apiKeyGenerator,
  createApiLimiter,
  type MinimalRedisClient,
} from "./rateLimitConfig";

const ENV_KEYS = ["REDIS_URL", "RATE_LIMIT_REDIS"] as const;
const envBackup: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) envBackup[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  }
});

describe("store selection (B6)", () => {
  it("falls back to the in-memory store when REDIS_URL is unset", () => {
    delete process.env.REDIS_URL;
    delete process.env.RATE_LIMIT_REDIS;
    expect(resolveRateLimitStoreKind()).toBe("memory");
    // and the limiter constructs fine on the memory path
    const limiter = createApiLimiter();
    expect(typeof limiter).toBe("function");
  });

  it("selects the Redis store when REDIS_URL is present", () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    delete process.env.RATE_LIMIT_REDIS;
    expect(resolveRateLimitStoreKind()).toBe("redis");
  });

  it("honours the RATE_LIMIT_REDIS=false escape hatch", () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.RATE_LIMIT_REDIS = "false";
    expect(resolveRateLimitStoreKind()).toBe("memory");
    const limiter = createApiLimiter(); // must not construct a Redis client
    expect(typeof limiter).toBe("function");
  });
});

function fakeRedis() {
  const counters = new Map<string, number>();
  const ttls = new Map<string, number>();
  const calls = { pexpire: 0 };
  const client: MinimalRedisClient = {
    async incr(k) {
      const v = (counters.get(k) ?? 0) + 1;
      counters.set(k, v);
      return v;
    },
    async pttl(k) {
      return ttls.has(k) ? ttls.get(k)! : -1;
    },
    async pexpire(k, ms) {
      calls.pexpire++;
      ttls.set(k, ms);
      return 1;
    },
    async decr(k) {
      const v = (counters.get(k) ?? 0) - 1;
      counters.set(k, v);
      return v;
    },
    async del(k) {
      counters.delete(k);
      ttls.delete(k);
      return 1;
    },
  };
  return { client, counters, ttls, calls };
}

describe("RedisRateLimitStore (fixed window: INCR + PEXPIRE)", () => {
  it("counts hits, arms the window TTL exactly once, and reports resetTime", async () => {
    const { client, counters, ttls, calls } = fakeRedis();
    const store = new RedisRateLimitStore({ prefix: "rl:test:", client });
    store.init({ windowMs: 60_000 } as any);

    const before = Date.now();
    const first = await store.increment("client-a");
    expect(first.totalHits).toBe(1);
    expect(first.resetTime).toBeInstanceOf(Date);
    expect(first.resetTime!.getTime()).toBeGreaterThanOrEqual(before + 59_000);
    expect(first.resetTime!.getTime()).toBeLessThanOrEqual(Date.now() + 61_000);
    expect(counters.get("rl:test:client-a")).toBe(1);
    expect(ttls.get("rl:test:client-a")).toBe(60_000);

    const second = await store.increment("client-a");
    expect(second.totalHits).toBe(2);
    expect(calls.pexpire).toBe(1); // TTL only armed on first hit of the window

    // independent buckets per key
    const other = await store.increment("client-b");
    expect(other.totalHits).toBe(1);
  });

  it("decrement and resetKey operate on the prefixed key", async () => {
    const { client, counters } = fakeRedis();
    const store = new RedisRateLimitStore({ prefix: "rl:test:", client });
    store.init({ windowMs: 1_000 } as any);

    await store.increment("k");
    await store.increment("k");
    await store.decrement("k");
    expect(counters.get("rl:test:k")).toBe(1);

    await store.resetKey("k");
    expect(counters.has("rl:test:k")).toBe(false);
  });

  it("is shared-friendly: localKeys is false (counters live in Redis)", () => {
    const { client } = fakeRedis();
    const store = new RedisRateLimitStore({ prefix: "p:", client });
    expect(store.localKeys).toBe(false);
  });
});

describe("apiKeyGenerator (B6 key strategy)", () => {
  const reqOf = (headers: Record<string, string>, ip = "10.0.0.9") =>
    ({ headers, ip }) as any;

  it("keys API-key clients by hashed x-api-key (never the raw credential)", () => {
    const key = apiKeyGenerator(reqOf({ "x-api-key": "mk_super_secret_value" }));
    expect(key).toMatch(/^key:[0-9a-f]{32}$/);
    expect(key).not.toContain("mk_super_secret_value");
    // deterministic per credential, distinct across credentials
    expect(apiKeyGenerator(reqOf({ "x-api-key": "mk_super_secret_value" }))).toBe(key);
    expect(apiKeyGenerator(reqOf({ "x-api-key": "mk_other" }))).not.toBe(key);
  });

  it("keys bearer clients by hashed token", () => {
    const key = apiKeyGenerator(reqOf({ authorization: "Bearer tok123" }));
    expect(key).toMatch(/^bearer:[0-9a-f]{32}$/);
    expect(key).not.toContain("tok123");
  });

  it("keys browser sessions by hashed session cookie", () => {
    const key = apiKeyGenerator(
      reqOf({ cookie: `other=1; ${COOKIE_NAME}=sess-jwt-value; x=2` }),
    );
    expect(key).toMatch(/^sess:[0-9a-f]{32}$/);
    expect(key).not.toContain("sess-jwt-value");
  });

  it("falls back to the bare IP (pre-B6-compatible resetKey semantics)", () => {
    expect(apiKeyGenerator(reqOf({}, "10.0.0.9"))).toBe("10.0.0.9");
  });

  it("prefers API key over session cookie when both are present", () => {
    const key = apiKeyGenerator(
      reqOf({ "x-api-key": "mk_x", cookie: `${COOKIE_NAME}=sess` }),
    );
    expect(key.startsWith("key:")).toBe(true);
  });
});
