/**
 * Simple in-memory cache for statistics queries
 * Reduces database load for frequently accessed statistics
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

class StatisticsCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private defaultTTL = 60 * 1000; // 1 minute default TTL

  /**
   * Get cached data if valid, otherwise return null
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      // Cache expired
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Set cache data with optional TTL
   */
  set<T>(key: string, data: T, ttl?: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
    });
  }

  /**
   * Invalidate cache by key or pattern
   */
  invalidate(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      return;
    }

    // Invalidate keys matching pattern
    const keys = Array.from(this.cache.keys());
    for (const key of keys) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Generate cache key from parameters
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
   * Get cache stats for monitoring
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

// Singleton instance
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
