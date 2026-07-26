/**
 * doc69 G2-4 — durable (Redis-backed) rate limit.
 *
 * Proves:
 *   1. When Redis is configured, `planInference`'s rate-limit check uses the atomic
 *      `redisService.incrWithExpire` counter (increments on every request, rate-limits once
 *      the tier's per-minute budget is exceeded) — the DURABLE path.
 *   2. When Redis is unavailable (not configured, or `incrWithExpire` returns null because a
 *      call failed), the gateway transparently falls back to the original in-process counter
 *      — fail-open, exactly as before this task.
 *   3. `AI_RATE_LIMIT_REDIS_ENABLED=false` skips Redis entirely even when it IS configured.
 *
 * `./redisService` is mocked so these tests never touch a real Redis connection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const isConfiguredMock = vi.fn();
const incrWithExpireMock = vi.fn();

vi.mock("./redisService", () => ({
  redisService: {
    isConfigured: (...a: unknown[]) => isConfiguredMock(...a),
    incrWithExpire: (...a: unknown[]) => incrWithExpireMock(...a),
  },
}));

async function loadFresh() {
  vi.resetModules();
  return import("./aiGateway");
}

const ENV_KEYS = [
  "AI_GATEWAY_LIMIT_CHEAP_PER_MIN",
  "AI_GATEWAY_LIMIT_DEEP_PER_MIN",
  "AI_RATE_LIMIT_REDIS_ENABLED",
  "AI_SAFETY_ENABLED",
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  isConfiguredMock.mockReturnValue(false); // default: behave as if Redis isn't configured
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("aiGateway — durable rate limit (Redis path)", () => {
  it("uses the Redis atomic counter when configured: increments and eventually rate-limits", async () => {
    process.env.AI_GATEWAY_LIMIT_DEEP_PER_MIN = "2";
    isConfiguredMock.mockReturnValue(true);
    let count = 0;
    incrWithExpireMock.mockImplementation(async () => {
      count += 1;
      return { count, ttlMs: 60_000 };
    });
    const gateway = await loadFresh();

    await gateway.planInference({ task: "report", text: "one" }); // count=1, allowed
    await gateway.planInference({ task: "report", text: "two" }); // count=2, allowed (== max)
    await expect(gateway.planInference({ task: "report", text: "three" })).rejects.toThrow(
      gateway.RateLimitError,
    ); // count=3 > max=2

    expect(incrWithExpireMock).toHaveBeenCalledTimes(3);
  });

  it("survives a restart: a FRESH module (empty in-memory Map) still rate-limits immediately when Redis already holds an elevated count from before the restart", async () => {
    process.env.AI_GATEWAY_LIMIT_DEEP_PER_MIN = "3";
    isConfiguredMock.mockReturnValue(true);
    // Simulates a process restart mid-window: the in-process `windows` Map is gone (fresh
    // module load below), but Redis — a separate process — still remembers count=4 from
    // before the restart. A purely in-memory limiter would wrongly allow this request
    // (its own counter would start back at 0); the durable path must not.
    incrWithExpireMock.mockResolvedValue({ count: 4, ttlMs: 1000 });
    const gateway = await loadFresh();

    await expect(gateway.planInference({ task: "report", text: "x" })).rejects.toThrow(gateway.RateLimitError);
  });

  it("falls back to the in-memory limiter (fail-open) when Redis errors (incrWithExpire → null)", async () => {
    process.env.AI_GATEWAY_LIMIT_DEEP_PER_MIN = "1";
    isConfiguredMock.mockReturnValue(true);
    incrWithExpireMock.mockResolvedValue(null); // Redis unavailable/errored at call time
    const gateway = await loadFresh();

    await gateway.planInference({ task: "report", text: "one" }); // memory count=1, allowed
    await expect(gateway.planInference({ task: "report", text: "two" })).rejects.toThrow(
      gateway.RateLimitError,
    ); // memory count=2 > max=1

    expect(incrWithExpireMock).toHaveBeenCalled(); // it DID try Redis first each time
  });

  it("falls back to in-memory when redisService.isConfigured() is false (no REDIS_URL)", async () => {
    process.env.AI_GATEWAY_LIMIT_DEEP_PER_MIN = "1";
    isConfiguredMock.mockReturnValue(false);
    const gateway = await loadFresh();

    await gateway.planInference({ task: "report", text: "one" });
    await expect(gateway.planInference({ task: "report", text: "two" })).rejects.toThrow(gateway.RateLimitError);

    expect(incrWithExpireMock).not.toHaveBeenCalled(); // never attempted Redis
  });

  it("AI_RATE_LIMIT_REDIS_ENABLED=false skips Redis even when it IS configured", async () => {
    process.env.AI_GATEWAY_LIMIT_DEEP_PER_MIN = "1";
    process.env.AI_RATE_LIMIT_REDIS_ENABLED = "false";
    isConfiguredMock.mockReturnValue(true);
    const gateway = await loadFresh();

    await gateway.planInference({ task: "report", text: "one" });
    await expect(gateway.planInference({ task: "report", text: "two" })).rejects.toThrow(gateway.RateLimitError);

    expect(incrWithExpireMock).not.toHaveBeenCalled();
  });

  it("a request that survives the limit still returns a usable plan (decision/record/safeText)", async () => {
    isConfiguredMock.mockReturnValue(true);
    incrWithExpireMock.mockResolvedValue({ count: 1, ttlMs: 60_000 });
    const gateway = await loadFresh();

    const plan = await gateway.planInference({ task: "chat", text: "hello" });
    expect(plan.decision).toBeTruthy();
    expect(typeof plan.record).toBe("function");
    expect(plan.safeText).toBe("hello");
  });
});
