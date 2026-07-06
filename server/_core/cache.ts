/**
 * Statistics cache facade (doc 38 R-2b · P1-B)
 * ============================================
 * Historically THIS module was a standalone, UNBOUNDED `Map` with local-only
 * invalidation:
 *   - keys embed userId + date windows ⇒ cardinality grew without bound (a
 *     slow memory leak on a long-lived process), and
 *   - `invalidate()` only ever cleared THIS replica's map, so a multi-instance
 *     deployment kept serving stale dashboards after a new inspection arrived.
 *
 * It now delegates every operation to the single, bounded, LRU-capped cache
 * facade (`services/cacheService` — `TieredCacheService`), which already
 * provides: a hard `CACHE_MAX_ENTRIES` cap with LRU eviction, TTL cleanup, an
 * optional Redis L2 (active only when `REDIS_URL` is set — honest-degrades to
 * pure in-memory otherwise) and cross-instance invalidation broadcast.
 *
 * The public API (get/set/invalidate/generateKey/getStats + CACHE_KEYS /
 * CACHE_TTL) is unchanged so existing callers (dashboardStatsRouters,
 * productionDashboardRouter, machineApiRouters) need no edits. `generateKey`
 * keeps its exact previous key format so cached reads behave identically.
 */

import { cacheService } from "../services/cacheService";

class StatisticsCache {
  /**
   * Get cached data if valid, otherwise return null.
   * Routes to the bounded LRU facade (L1; sync — same semantics as before).
   */
  get<T>(key: string): T | null {
    return cacheService.get<T>(key);
  }

  /**
   * Set cache data with optional TTL (ms). Preserves the previous 1-minute
   * default of this module (cacheService's own default is 5 minutes).
   */
  set<T>(key: string, data: T, ttl?: number): void {
    cacheService.set(key, data, ttl ?? 60 * 1000);
  }

  /**
   * Invalidate cache by key or substring pattern.
   *
   * The legacy behavior was a SUBSTRING match (`key.includes(pattern)`); the
   * facade uses anchored glob matching, so wrap the pattern in `*…*` to
   * preserve the exact previous semantics. The facade also fans the
   * invalidation out to the Redis tier + broadcasts it to other instances
   * (the multi-replica staleness fix).
   */
  invalidate(pattern?: string): void {
    if (!pattern) {
      // Previous behavior cleared ALL stats entries. The facade is shared with
      // other subsystems, so instead of clear() (which would nuke unrelated
      // callers) pattern-clear every known stats prefix.
      for (const p of Object.values(CACHE_KEYS)) {
        cacheService.invalidateByPattern(`*${p}*`);
      }
      return;
    }
    cacheService.invalidateByPattern(`*${pattern}*`);
  }

  /**
   * Generate cache key from parameters. Byte-for-byte identical to the prior
   * implementation so read/write keys stay stable across this change.
   */
  generateKey(prefix: string, params: Record<string, unknown>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .filter(k => params[k] !== undefined && params[k] !== null)
      .map(k => `${k}=${JSON.stringify(params[k])}`)
      .join("&");
    return `${prefix}:${sortedParams}`;
  }

  /**
   * Get cache stats for monitoring (delegates to the facade's L1 counters).
   */
  getStats(): { size: number; keys: string[] } {
    const s = cacheService.getStats();
    // The facade does not expose its key list (bounded + shared); size is the
    // meaningful signal here.
    return { size: s.size, keys: [] };
  }
}

// Singleton instance (thin facade over the shared bounded cacheService).
export const statsCache = new StatisticsCache();

// Cache keys constants
export const CACHE_KEYS = {
  DASHBOARD_STATS: "dashboard:stats",
  DAILY_STATS: "dashboard:daily",
  MACHINE_STATS: "machine:stats",
  INSPECTION_SEARCH: "inspection:search",
};

// TTL constants (in milliseconds)
export const CACHE_TTL = {
  SHORT: 30 * 1000,      // 30 seconds
  MEDIUM: 60 * 1000,     // 1 minute
  LONG: 5 * 60 * 1000,   // 5 minutes
  VERY_LONG: 15 * 60 * 1000, // 15 minutes
};
