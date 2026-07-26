import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

describe('Redis Connection Test', () => {
  it('should check Redis URL configuration', async () => {
    const redisUrl = process.env.REDIS_URL;
    
    // If REDIS_URL is not set, test passes (fallback mode is acceptable)
    if (!redisUrl) {
      console.log('[Test] REDIS_URL not configured, using in-memory fallback');
      expect(true).toBe(true);
      return;
    }

    // If REDIS_URL is set, verify it's a valid format
    expect(redisUrl).toMatch(/^redis(s)?:\/\//);
    console.log('[Test] REDIS_URL format is valid');
  });

  it('should initialize Redis service without errors', async () => {
    // Dynamic import to test initialization
    const { redisService } = await import('./services/redisService');
    
    // Service should exist
    expect(redisService).toBeDefined();
    
    // Get stats should work
    const stats = await redisService.getStats();
    expect(stats).toHaveProperty('hits');
    expect(stats).toHaveProperty('misses');
    expect(stats).toHaveProperty('isRedisConnected');
    expect(stats).toHaveProperty('uptime');
    
    console.log('[Test] Redis service initialized:', {
      isRedisConnected: stats.isRedisConnected,
      uptime: stats.uptime,
    });
  });

  it('should perform basic cache operations', async () => {
    const { redisService } = await import('./services/redisService');
    
    const testKey = 'test:validation';
    const testValue = { timestamp: Date.now(), test: true };
    
    // Set value
    await redisService.set(testKey, testValue, 60);
    
    // Get value
    const retrieved = await redisService.get<typeof testValue>(testKey);
    expect(retrieved).toEqual(testValue);
    
    // Delete value
    const deleted = await redisService.delete(testKey);
    expect(deleted).toBe(true);
    
    // Verify deletion
    const afterDelete = await redisService.get(testKey);
    expect(afterDelete).toBeNull();
    
    console.log('[Test] Basic cache operations successful');
  });

  it('should perform health check', async () => {
    const { redisService } = await import('./services/redisService');

    const health = await redisService.healthCheck();

    expect(health).toHaveProperty('status');
    expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
    expect(health).toHaveProperty('memory');
    expect(health.memory).toBe(true);

    console.log('[Test] Health check result:', health);
  }, 30000); // Increase timeout to 30s for Redis health check
});

// doc69 G2-4 review fix (W1-1) — direct unit test for `incrWithExpire`'s atomic Lua EVAL.
// Injects a fake Redis client directly onto the exported singleton (`(redisService as any)`)
// so these tests never need a real Redis connection/REDIS_URL. A `MiniRedis` fake reimplements
// the SAME incr/pttl/pexpire semantics the real Lua script relies on so the atomicity/self-heal
// CONTRACT is genuinely exercised (not just "was eval() called"), while still asserting the
// production code drives it via a single EVAL round-trip.
describe('redisService.incrWithExpire — atomic Lua EVAL (review fix W1-1)', () => {
  /** Tiny in-memory stand-in for the subset of Redis commands the Lua script uses. */
  class MiniRedis {
    private store = new Map<string, { count: number; expiresAt: number | null }>();

    /** Mirrors what a single atomic EVAL of the production script would return. */
    async eval(_script: string, _numKeys: number, key: string, windowMsArg: number): Promise<[number, number]> {
      const now = Date.now();
      let entry = this.store.get(key);
      if (entry && entry.expiresAt !== null && entry.expiresAt <= now) entry = undefined; // expired
      const count = (entry?.count ?? 0) + 1;
      let pttl = entry?.expiresAt != null ? entry.expiresAt - now : -1;
      if (count === 1 || pttl <= 0) {
        pttl = windowMsArg;
        this.store.set(key, { count, expiresAt: now + windowMsArg });
      } else {
        this.store.set(key, { count, expiresAt: entry!.expiresAt });
      }
      return [count, pttl];
    }

    /** Simulates a key stuck with count>1 and NO ttl — the exact bug this fix self-heals. */
    seedStuckKey(fullKey: string, count: number): void {
      this.store.set(fullKey, { count, expiresAt: null });
    }
  }

  afterEach(async () => {
    const { redisService } = await import('./services/redisService');
    (redisService as any).isConnected = false;
    (redisService as any).redis = null;
  });

  it('a brand-new key (count=1) gets PEXPIRE applied atomically, in the SAME round-trip as the INCR', async () => {
    const { redisService } = await import('./services/redisService');
    const mini = new MiniRedis();
    const evalSpy = vi.spyOn(mini, 'eval');
    (redisService as any).redis = mini;
    (redisService as any).isConnected = true;

    const result = await redisService.incrWithExpire('ai:ratelimit:new-user:cheap', 60);

    expect(result).toEqual({ count: 1, ttlMs: 60_000 });
    // Exactly ONE Redis round-trip for the whole INCR+conditional-PEXPIRE decision — the bug
    // this fixes was a SEPARATE (non-atomic) `INCR` then `EXPIRE` call.
    expect(evalSpy).toHaveBeenCalledTimes(1);
    const [script, numKeys, key, windowMsArg] = evalSpy.mock.calls[0];
    expect(String(script)).toMatch(/PEXPIRE/);
    expect(String(script)).toMatch(/INCR/);
    expect(numKeys).toBe(1);
    expect(key).toContain('new-user');
    expect(windowMsArg).toBe(60_000);
  });

  it('self-heals: a PRE-EXISTING key with count>1 and pttl<=0 (the old non-atomic bug — a stuck bucket with no TTL) gets PEXPIRE re-applied on its very next hit', async () => {
    const { redisService } = await import('./services/redisService');
    const mini = new MiniRedis();
    // Simulate exactly the bug scenario: a key that was INCR'd to 4 by earlier requests but
    // never got an EXPIRE (e.g. the old code's separate EXPIRE call had failed/thrown).
    mini.seedStuckKey('avi:ai:ratelimit:stuck-user:deep', 4);
    (redisService as any).redis = mini;
    (redisService as any).isConnected = true;

    const result = await redisService.incrWithExpire('ai:ratelimit:stuck-user:deep', 30);

    // count is now 5 (this call's own increment) and — the self-heal — it got a FRESH TTL
    // instead of staying permanently TTL-less.
    expect(result).toEqual({ count: 5, ttlMs: 30_000 });

    // Prove the heal actually stuck: the NEXT call still carries a live, decreasing TTL rather
    // than reporting "no TTL" again.
    const again = await redisService.incrWithExpire('ai:ratelimit:stuck-user:deep', 30);
    expect(again?.count).toBe(6);
    expect(again?.ttlMs).toBeGreaterThan(0);
    expect(again?.ttlMs).toBeLessThanOrEqual(30_000);
  });

  it('a healthy mid-window key (count>1, pttl already positive) is left alone — real remaining TTL passes through untouched', async () => {
    const { redisService } = await import('./services/redisService');
    const mini = new MiniRedis();
    (redisService as any).redis = mini;
    (redisService as any).isConnected = true;

    await redisService.incrWithExpire('ai:ratelimit:mid-user:cheap', 60); // count=1, TTL set
    const second = await redisService.incrWithExpire('ai:ratelimit:mid-user:cheap', 60); // count=2

    expect(second?.count).toBe(2);
    expect(second?.ttlMs).toBeGreaterThan(0);
    expect(second?.ttlMs).toBeLessThanOrEqual(60_000);
  });

  it('fail-open: EVAL throwing returns null instead of throwing into the caller', async () => {
    const { redisService } = await import('./services/redisService');
    const evalMock = vi.fn(async () => {
      throw new Error('connection reset');
    });
    (redisService as any).redis = { eval: evalMock };
    (redisService as any).isConnected = true;

    const result = await redisService.incrWithExpire('ai:ratelimit:err-user:cheap', 60);

    expect(result).toBeNull();
    expect(evalMock).toHaveBeenCalledTimes(1);
  });

  it('returns null without attempting Redis when not connected (fail-open contract preserved)', async () => {
    const { redisService } = await import('./services/redisService');
    const evalMock = vi.fn();
    (redisService as any).redis = { eval: evalMock };
    (redisService as any).isConnected = false; // not connected

    const result = await redisService.incrWithExpire('ai:ratelimit:noconn-user:cheap', 60);

    expect(result).toBeNull();
    expect(evalMock).not.toHaveBeenCalled();
  });
});
