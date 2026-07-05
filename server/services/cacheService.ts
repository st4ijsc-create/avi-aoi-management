/**
 * Unified Cache Facade (W4-B, doc 27 gap B8)
 *
 * Previously the codebase ran TWO independent cache layers with divergent
 * invalidation: this in-memory Map (5-min TTL) and a Redis layer in
 * redisService used by functions/cachedStatistics — `invalidateStatistics`
 * only ever hit the Redis tier, so dashboards could keep serving stale
 * in-memory entries after a new inspection arrived.
 *
 * This service is now the SINGLE cache facade:
 *  - L1: bounded in-process LRU map (always present; sync API unchanged).
 *  - L2: Redis via redisService WHEN `REDIS_URL` is configured (async API).
 *    When Redis is not configured there is no L2 — the L1 LRU is the
 *    fallback. When Redis is configured but DOWN, redisService degrades to
 *    its own in-memory map, which still behaves like an L2 here.
 *  - Pattern invalidation clears BOTH tiers and (via redisService pub/sub)
 *    broadcasts to other instances, whose L1 is cleared through the
 *    `onInvalidateBroadcast` hook registered below.
 *
 * Backward compatibility: the original sync API (get/set/delete/
 * invalidateByPattern/invalidateStatistics/clear/getStats/generateKey)
 * keeps its exact signatures and L1 semantics — existing callers
 * (aiProviderRouter, aiInspectionAnalytics, tests) need no changes.
 * `invalidateStatistics` now ALSO clears L2 and returns a promise (callers
 * that ignored the previous `void` return are unaffected; the L1 clear
 * still completes synchronously before the first await).
 */

import { redisService } from './redisService';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  createdAt: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  lastCleanup: Date | null;
}

/**
 * Minimal L2 tier contract (implemented by redisService; injectable for
 * tests so the two-tier behaviour is verifiable without a live Redis).
 */
export interface CacheL2 {
  isConfigured(): boolean;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  invalidateByPattern(pattern: string): Promise<number>;
  clear(): Promise<void>;
  onInvalidateBroadcast?(cb: (pattern: string) => void): () => void;
}

/** Envelope stored in L2 so the true expiry survives the tier round-trip. */
interface L2Envelope<T> {
  v: T;
  exp: number; // epoch ms
}

export class TieredCacheService {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    size: 0,
    lastCleanup: null,
  };
  private cleanupInterval: NodeJS.Timeout | null = null;
  private unsubscribeBroadcast: (() => void) | null = null;
  private readonly DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
  private readonly maxEntries: number;
  private readonly l2: CacheL2 | null;

  constructor(opts: { l2?: CacheL2 | null; maxEntries?: number } = {}) {
    this.l2 = opts.l2 === undefined ? (redisService as CacheL2) : opts.l2;
    const envMax = Number(process.env.CACHE_MAX_ENTRIES);
    this.maxEntries =
      opts.maxEntries ?? (Number.isFinite(envMax) && envMax > 0 ? envMax : 5000);

    // Start automatic cleanup every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
    if (typeof this.cleanupInterval.unref === 'function') this.cleanupInterval.unref();

    // Cross-instance invalidation (B8): when another instance broadcasts a
    // pattern invalidation over Redis pub/sub, drop matching L1 keys here too.
    if (this.l2?.onInvalidateBroadcast) {
      this.unsubscribeBroadcast = this.l2.onInvalidateBroadcast((pattern) => {
        this.invalidateL1Pattern(pattern, { fromBroadcast: true });
      });
    }
  }

  private hasL2(): boolean {
    return !!this.l2 && this.l2.isConfigured();
  }

  /**
   * Get cached value by key — L1 (in-process) only; synchronous.
   * Use getAsync() for the two-tier (L1 → Redis) read path.
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.size = this.cache.size;
      this.stats.misses++;
      return null;
    }

    // LRU touch: re-insert so Map iteration order reflects recency.
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.stats.hits++;
    return entry.data as T;
  }

  /**
   * Set cached value with optional TTL — L1 only; synchronous.
   * Use setAsync() to also populate the Redis tier.
   * @param ttl Time to live in milliseconds (default: 5 minutes)
   */
  set<T>(key: string, data: T, ttl: number = this.DEFAULT_TTL): void {
    const entry: CacheEntry<T> = {
      data,
      expiresAt: Date.now() + ttl,
      createdAt: Date.now(),
    };

    if (!this.cache.has(key) && this.cache.size >= this.maxEntries) {
      // Evict least-recently-used (first key in insertion/recency order).
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, entry);
    this.stats.size = this.cache.size;
  }

  /**
   * Two-tier read: L1 first, then Redis (when configured). A Redis hit
   * re-populates L1 with the entry's REMAINING lifetime.
   */
  async getAsync<T>(key: string): Promise<T | null> {
    const l1 = this.get<T>(key);
    if (l1 !== null) return l1;

    if (!this.hasL2()) return null;
    try {
      const envelope = await this.l2!.get<L2Envelope<T>>(key);
      if (
        envelope &&
        typeof envelope === 'object' &&
        'v' in envelope &&
        typeof envelope.exp === 'number' &&
        envelope.exp > Date.now()
      ) {
        // Re-populate L1 for the remaining lifetime (stats already counted
        // a miss above; keep it — L1 genuinely missed).
        this.set(key, envelope.v, envelope.exp - Date.now());
        return envelope.v;
      }
    } catch (err: any) {
      console.error(`[Cache] L2 GET error for ${key}: ${err?.message ?? err}`);
    }
    return null;
  }

  /**
   * Two-tier write: populates L1 (JSON-normalised so hits are shaped the
   * same as Redis-tier hits — e.g. Date fields come back as ISO strings on
   * BOTH paths) and Redis (when configured).
   */
  async setAsync<T>(key: string, data: T, ttl: number = this.DEFAULT_TTL): Promise<void> {
    let normalised: T = data;
    if (data !== undefined) {
      try {
        normalised = JSON.parse(JSON.stringify(data)) as T;
      } catch {
        normalised = data; // non-serialisable — keep the reference in L1 only
      }
    }
    const exp = Date.now() + ttl;
    this.set(key, normalised, ttl);

    if (!this.hasL2()) return;
    try {
      const envelope: L2Envelope<T> = { v: normalised, exp };
      await this.l2!.set(key, envelope, Math.max(1, Math.ceil(ttl / 1000)));
    } catch (err: any) {
      console.error(`[Cache] L2 SET error for ${key}: ${err?.message ?? err}`);
    }
  }

  /** Two-tier read-through helper. TTL in milliseconds. */
  async getOrFetchAsync<T>(key: string, fetchFn: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = await this.getAsync<T>(key);
    if (cached !== null) return cached;
    const data = await fetchFn();
    await this.setAsync(key, data, ttl);
    return data;
  }

  /**
   * Delete specific cache entry (L1 sync; L2 fire-and-forget when configured).
   */
  delete(key: string): boolean {
    const result = this.cache.delete(key);
    this.stats.size = this.cache.size;
    if (this.hasL2()) {
      void this.l2!.delete(key).catch(() => {});
    }
    return result;
  }

  /**
   * Delete from BOTH tiers and broadcast so other instances drop their L1
   * copy too (an exact key is a valid pattern — no wildcard needed).
   */
  async deleteAsync(key: string): Promise<boolean> {
    const l1Deleted = this.cache.delete(key);
    this.stats.size = this.cache.size;
    if (this.hasL2()) {
      try {
        // invalidateByPattern (not delete) so the removal is broadcast to
        // other instances' L1 via the cache:invalidate channel.
        await this.l2!.invalidateByPattern(key);
      } catch (err: any) {
        console.error(`[Cache] L2 DELETE error for ${key}: ${err?.message ?? err}`);
      }
    }
    return l1Deleted;
  }

  private invalidateL1Pattern(pattern: string, opts: { fromBroadcast?: boolean } = {}): number {
    const regex = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    let count = 0;

    const keysToDelete: string[] = [];
    this.cache.forEach((_, key) => {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => {
      this.cache.delete(key);
      count++;
    });

    this.stats.size = this.cache.size;
    if (count > 0) {
      const source = opts.fromBroadcast ? ' (broadcast)' : '';
      console.log(`[Cache] INVALIDATE${source}: Pattern "${pattern}" matched ${count} L1 entries`);
    }
    return count;
  }

  /**
   * Invalidate cache entries matching a pattern (supports * wildcard).
   * Clears L1 synchronously (return value = L1 count, unchanged contract)
   * and fires the L2 invalidation + cross-instance broadcast in the
   * background. Use invalidateByPatternAsync when you must await both tiers.
   */
  invalidateByPattern(pattern: string): number {
    const count = this.invalidateL1Pattern(pattern);
    if (this.hasL2()) {
      void this.l2!.invalidateByPattern(pattern).catch((err: any) => {
        console.error(`[Cache] L2 INVALIDATE error for ${pattern}: ${err?.message ?? err}`);
      });
    }
    return count;
  }

  /** Pattern invalidation awaited across BOTH tiers. Returns L1 + L2 count. */
  async invalidateByPatternAsync(pattern: string): Promise<number> {
    let count = this.invalidateL1Pattern(pattern);
    if (this.hasL2()) {
      try {
        count += await this.l2!.invalidateByPattern(pattern);
      } catch (err: any) {
        console.error(`[Cache] L2 INVALIDATE error for ${pattern}: ${err?.message ?? err}`);
      }
    }
    return count;
  }

  /**
   * Invalidate all statistics caches — BOTH tiers (B8 fix: the previous
   * split implementation cleared only one layer depending on the caller).
   * L1 is cleared synchronously before the first await; the returned
   * promise resolves once the Redis tier + broadcast are done.
   */
  invalidateStatistics(): Promise<void> {
    const patterns = ['stats:*', 'yield:*', 'throughput:*'];
    for (const p of patterns) this.invalidateL1Pattern(p);
    console.log('[Cache] All statistics caches invalidated (L1)');
    if (!this.hasL2()) return Promise.resolve();
    return (async () => {
      for (const p of patterns) {
        try {
          await this.l2!.invalidateByPattern(p);
        } catch (err: any) {
          console.error(`[Cache] L2 INVALIDATE error for ${p}: ${err?.message ?? err}`);
        }
      }
      console.log('[Cache] All statistics caches invalidated (L2)');
    })();
  }

  /**
   * Clear all L1 entries (and L2 in the background when configured).
   */
  clear(): void {
    this.cache.clear();
    this.stats.size = 0;
    if (this.hasL2()) {
      void this.l2!.clear().catch(() => {});
    }
    console.log('[Cache] CLEAR: All entries removed');
  }

  /**
   * Get cache statistics (L1 counters + tier configuration).
   */
  getStats(): CacheStats & { hitRate: string; l2Configured: boolean; maxEntries: number } {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) + '%' : '0%';
    return {
      ...this.stats,
      hitRate,
      l2Configured: this.hasL2(),
      maxEntries: this.maxEntries,
    };
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    const keysToDelete: string[] = [];
    this.cache.forEach((entry, key) => {
      if (now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => {
      this.cache.delete(key);
      cleaned++;
    });

    this.stats.size = this.cache.size;
    this.stats.lastCleanup = new Date();

    if (cleaned > 0) {
      console.log(`[Cache] CLEANUP: Removed ${cleaned} expired entries`);
    }
  }

  /**
   * Generate cache key for statistics queries
   */
  generateKey(prefix: string, params: Record<string, any>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .filter(k => params[k] !== undefined && params[k] !== null)
      .map(k => {
        const value = params[k];
        if (value instanceof Date) {
          return `${k}=${value.toISOString().split('T')[0]}`;
        }
        return `${k}=${value}`;
      })
      .join('&');

    return `${prefix}:${sortedParams || 'all'}`;
  }

  /**
   * Destroy the cache service (cleanup interval)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.unsubscribeBroadcast) {
      this.unsubscribeBroadcast();
      this.unsubscribeBroadcast = null;
    }
    this.cache.clear();
    this.stats.size = 0;
  }
}

// Singleton instance (default L2 = redisService, active only when REDIS_URL is set)
export const cacheService = new TieredCacheService();

// Helper functions for common cache operations (L1-only path — unchanged
// semantics for existing callers that rely on object identity of cached
// values; use cacheService.getOrFetchAsync for the two-tier path).
export function getCachedOrFetch<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttl?: number
): Promise<T> {
  const cached = cacheService.get<T>(key);
  if (cached !== null) {
    return Promise.resolve(cached);
  }

  return fetchFn().then(data => {
    cacheService.set(key, data, ttl);
    return data;
  });
}

export default cacheService;
