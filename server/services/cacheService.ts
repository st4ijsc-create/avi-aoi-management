/**
 * In-memory Cache Service for Statistics Queries
 * 
 * Features:
 * - TTL-based expiration (default 5 minutes)
 * - Automatic cleanup of expired entries
 * - Cache invalidation by key pattern
 * - Hit/miss logging for monitoring
 */

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

class CacheService {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    size: 0,
    lastCleanup: null,
  };
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

  constructor() {
    // Start automatic cleanup every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
  }

  /**
   * Get cached value by key
   * @param key Cache key
   * @returns Cached value or null if not found/expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      console.log(`[Cache] MISS: ${key}`);
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.size = this.cache.size;
      this.stats.misses++;
      console.log(`[Cache] EXPIRED: ${key}`);
      return null;
    }

    this.stats.hits++;
    console.log(`[Cache] HIT: ${key} (age: ${Math.round((Date.now() - entry.createdAt) / 1000)}s)`);
    return entry.data as T;
  }

  /**
   * Set cached value with optional TTL
   * @param key Cache key
   * @param data Data to cache
   * @param ttl Time to live in milliseconds (default: 5 minutes)
   */
  set<T>(key: string, data: T, ttl: number = this.DEFAULT_TTL): void {
    const entry: CacheEntry<T> = {
      data,
      expiresAt: Date.now() + ttl,
      createdAt: Date.now(),
    };
    
    this.cache.set(key, entry);
    this.stats.size = this.cache.size;
    console.log(`[Cache] SET: ${key} (TTL: ${ttl / 1000}s)`);
  }

  /**
   * Delete specific cache entry
   * @param key Cache key to delete
   */
  delete(key: string): boolean {
    const result = this.cache.delete(key);
    this.stats.size = this.cache.size;
    if (result) {
      console.log(`[Cache] DELETE: ${key}`);
    }
    return result;
  }

  /**
   * Invalidate cache entries matching a pattern
   * @param pattern Pattern to match (supports * wildcard)
   * @returns Number of entries invalidated
   */
  invalidateByPattern(pattern: string): number {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
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
      console.log(`[Cache] INVALIDATE: Pattern "${pattern}" matched ${count} entries`);
    }
    return count;
  }

  /**
   * Invalidate all statistics caches
   * Called when new inspection data is submitted
   */
  invalidateStatistics(): void {
    this.invalidateByPattern('stats:*');
    this.invalidateByPattern('yield:*');
    this.invalidateByPattern('throughput:*');
    console.log('[Cache] All statistics caches invalidated');
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.stats.size = 0;
    console.log('[Cache] CLEAR: All entries removed');
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats & { hitRate: string } {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) + '%' : '0%';
    return {
      ...this.stats,
      hitRate,
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
    this.clear();
  }
}

// Singleton instance
export const cacheService = new CacheService();

// Helper functions for common cache operations
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
