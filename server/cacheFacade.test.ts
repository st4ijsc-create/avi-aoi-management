/**
 * W4-B (doc 27 B8) — consolidated cache facade tests: single-source
 * invalidation across BOTH tiers + cross-instance L1 clearing via the
 * invalidation broadcast, using a fake L2 shared by two facade instances
 * (deterministic — no live Redis needed; the real L2 is redisService).
 */
import { afterEach, describe, expect, it } from "vitest";
import { TieredCacheService, type CacheL2 } from "./services/cacheService";

/** In-memory stand-in for the Redis tier + its pub/sub broadcast. */
class FakeL2 implements CacheL2 {
  store = new Map<string, { value: unknown; expiresAt: number }>();
  listeners: Array<(pattern: string) => void> = [];

  isConfigured(): boolean {
    return true;
  }
  async get<T>(key: string): Promise<T | null> {
    const e = this.store.get(key);
    if (!e) return null;
    if (Date.now() > e.expiresAt) {
      this.store.delete(key);
      return null;
    }
    // JSON round-trip like the real Redis tier
    return JSON.parse(JSON.stringify(e.value)) as T;
  }
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }
  async invalidateByPattern(pattern: string): Promise<number> {
    const regex = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    let count = 0;
    for (const key of [...this.store.keys()]) {
      if (regex.test(key)) {
        this.store.delete(key);
        count++;
      }
    }
    // simulate the pub/sub broadcast reaching EVERY instance
    for (const cb of this.listeners) cb(pattern);
    return count;
  }
  async clear(): Promise<void> {
    this.store.clear();
  }
  onInvalidateBroadcast(cb: (pattern: string) => void): () => void {
    this.listeners.push(cb);
    return () => {
      const i = this.listeners.indexOf(cb);
      if (i > -1) this.listeners.splice(i, 1);
    };
  }
}

describe("TieredCacheService (B8 consolidation)", () => {
  const created: TieredCacheService[] = [];
  const make = (l2: CacheL2 | null, maxEntries?: number) => {
    const svc = new TieredCacheService({ l2, maxEntries });
    created.push(svc);
    return svc;
  };

  afterEach(() => {
    while (created.length) created.pop()!.destroy();
  });

  it("setAsync writes BOTH tiers; getAsync reads L1 first, then L2", async () => {
    const l2 = new FakeL2();
    const cache = make(l2);

    await cache.setAsync("yield:corporate:x", { rate: 98.5 }, 60_000);
    // L1 has it (sync read)
    expect(cache.get("yield:corporate:x")).toEqual({ rate: 98.5 });
    // L2 has the envelope
    expect(l2.store.size).toBe(1);
    expect(await cache.getAsync("yield:corporate:x")).toEqual({ rate: 98.5 });
  });

  it("an L2 hit repopulates another instance's L1 (two facades, one Redis)", async () => {
    const l2 = new FakeL2();
    const instanceA = make(l2);
    const instanceB = make(l2);

    await instanceA.setAsync("stats:machine:1", { total: 10 }, 60_000);
    // B has nothing in L1 …
    expect(instanceB.get("stats:machine:1")).toBeNull();
    // … but the async path finds it in the shared L2 and repopulates L1
    expect(await instanceB.getAsync("stats:machine:1")).toEqual({ total: 10 });
    expect(instanceB.get("stats:machine:1")).toEqual({ total: 10 });
  });

  it("pattern invalidation clears BOTH tiers on EVERY instance (the B8 gap)", async () => {
    const l2 = new FakeL2();
    const instanceA = make(l2);
    const instanceB = make(l2);

    await instanceA.setAsync("yield:corporate:x", 1, 60_000);
    await instanceB.setAsync("yield:factory:y", 2, 60_000);
    await instanceB.setAsync("other:z", 3, 60_000);
    // warm B's L1 with A's entry too
    await instanceB.getAsync("yield:corporate:x");

    await instanceA.invalidateByPatternAsync("yield:*");

    // L2 empty for the pattern
    expect(await l2.get("yield:corporate:x")).toBeNull();
    expect(await l2.get("yield:factory:y")).toBeNull();
    // BOTH instances' L1 dropped the matching keys (broadcast)
    expect(instanceA.get("yield:corporate:x")).toBeNull();
    expect(instanceB.get("yield:corporate:x")).toBeNull();
    expect(instanceB.get("yield:factory:y")).toBeNull();
    // unrelated keys survive everywhere (L2 stores {v,exp} envelopes)
    expect(instanceB.get("other:z")).toBe(3);
    expect(((await l2.get("other:z")) as { v: number } | null)?.v).toBe(3);
  });

  it("invalidateStatistics clears stats:*/yield:*/throughput:* in both tiers", async () => {
    const l2 = new FakeL2();
    const cache = make(l2);

    await cache.setAsync("stats:machine:1", 1, 60_000);
    await cache.setAsync("yield:corporate:a", 2, 60_000);
    await cache.setAsync("throughput:factory:b", 3, 60_000);
    await cache.setAsync("auth:session:c", 4, 60_000);

    await cache.invalidateStatistics();

    for (const key of ["stats:machine:1", "yield:corporate:a", "throughput:factory:b"]) {
      expect(cache.get(key)).toBeNull();
      expect(await l2.get(key)).toBeNull();
    }
    expect(cache.get("auth:session:c")).toBe(4);
  });

  it("deleteAsync removes the exact key from both tiers and broadcasts", async () => {
    const l2 = new FakeL2();
    const instanceA = make(l2);
    const instanceB = make(l2);

    await instanceA.setAsync("auth:session:abc", "u", 60_000);
    await instanceB.getAsync("auth:session:abc"); // warm B's L1

    await instanceA.deleteAsync("auth:session:abc");

    expect(instanceA.get("auth:session:abc")).toBeNull();
    expect(instanceB.get("auth:session:abc")).toBeNull();
    expect(await l2.get("auth:session:abc")).toBeNull();
  });

  it("without an L2 (REDIS_URL unset) the facade is a pure in-process LRU", async () => {
    const cache = make(null);
    await cache.setAsync("k", 1, 60_000);
    expect(await cache.getAsync("k")).toBe(1);
    expect(cache.invalidateByPattern("k")).toBe(1);
    expect(await cache.getAsync("k")).toBeNull();
  });

  it("L1 is bounded: LRU eviction at maxEntries", () => {
    const cache = make(null, 3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.get("a"); // touch a → b is now least-recently-used
    cache.set("d", 4); // evicts b
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeNull();
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
  });
});
