/**
 * Redis Service with Fallback to In-Memory Cache
 * 
 * Features:
 * - Redis connection with automatic reconnection
 * - Fallback to in-memory cache when Redis is unavailable
 * - Health check endpoint
 * - Pub/Sub for cache invalidation across instances
 */

import Redis from 'ioredis';

interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  memoryUsage: number;
  isRedisConnected: boolean;
  lastError: string | null;
  uptime: number;
}

class RedisService {
  private redis: Redis | null = null;
  private subscriber: Redis | null = null;
  private isConnected = false;
  private lastError: string | null = null;
  private startTime = Date.now();
  
  // In-memory fallback
  private memoryCache: Map<string, { data: string; expiresAt: number }> = new Map();
  
  // Stats
  private stats = {
    hits: 0,
    misses: 0,
  };
  
  private readonly DEFAULT_TTL = 300; // 5 minutes in seconds
  private readonly KEY_PREFIX = 'avi:';

  constructor() {
    this.initializeRedis();
  }

  private initializeRedis(): void {
    const redisUrl = process.env.REDIS_URL;
    
    if (!redisUrl) {
      console.log('[Redis] REDIS_URL not configured, using in-memory cache fallback');
      return;
    }

    try {
      this.redis = new Redis(redisUrl, {
        retryStrategy: (times) => {
          if (times > 3) {
            console.log('[Redis] Max retries reached, falling back to in-memory cache');
            return null;
          }
          return Math.min(times * 200, 2000);
        },
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      });

      this.redis.on('connect', () => {
        console.log('[Redis] Connected successfully');
        this.isConnected = true;
        this.lastError = null;
      });

      this.redis.on('error', (err) => {
        console.error('[Redis] Connection error:', err.message);
        this.lastError = err.message;
        this.isConnected = false;
      });

      this.redis.on('close', () => {
        console.log('[Redis] Connection closed');
        this.isConnected = false;
      });

      // Initialize subscriber for pub/sub
      this.initializeSubscriber(redisUrl);

      // Attempt connection
      this.redis.connect().catch((err) => {
        console.error('[Redis] Initial connection failed:', err.message);
        this.lastError = err.message;
      });
    } catch (err: any) {
      console.error('[Redis] Initialization error:', err.message);
      this.lastError = err.message;
    }
  }

  private initializeSubscriber(redisUrl: string): void {
    try {
      this.subscriber = new Redis(redisUrl, {
        retryStrategy: (times) => {
          if (times > 3) return null;
          return Math.min(times * 200, 2000);
        },
        lazyConnect: true,
      });

      this.subscriber.on('message', (channel, message) => {
        if (channel === 'cache:invalidate') {
          const pattern = message;
          console.log(`[Redis] Received invalidation broadcast: ${pattern}`);
          // Clear local memory cache for the pattern
          this.clearMemoryCacheByPattern(pattern);
        }
      });

      this.subscriber.connect().then(() => {
        this.subscriber?.subscribe('cache:invalidate');
      }).catch((err) => {
        console.error('[Redis] Subscriber connection failed:', err.message);
      });
    } catch (err: any) {
      console.error('[Redis] Subscriber initialization error:', err.message);
    }
  }

  private getFullKey(key: string): string {
    return `${this.KEY_PREFIX}${key}`;
  }

  /**
   * Get cached value
   */
  async get<T>(key: string): Promise<T | null> {
    const fullKey = this.getFullKey(key);

    // Try Redis first
    if (this.isConnected && this.redis) {
      try {
        const value = await this.redis.get(fullKey);
        if (value) {
          this.stats.hits++;
          console.log(`[Redis] HIT: ${key}`);
          return JSON.parse(value) as T;
        }
        this.stats.misses++;
        console.log(`[Redis] MISS: ${key}`);
        return null;
      } catch (err: any) {
        console.error(`[Redis] GET error: ${err.message}`);
        // Fall through to memory cache
      }
    }

    // Fallback to memory cache
    const entry = this.memoryCache.get(fullKey);
    if (entry) {
      if (Date.now() < entry.expiresAt) {
        this.stats.hits++;
        console.log(`[Memory] HIT: ${key}`);
        return JSON.parse(entry.data) as T;
      }
      this.memoryCache.delete(fullKey);
    }
    
    this.stats.misses++;
    console.log(`[Memory] MISS: ${key}`);
    return null;
  }

  /**
   * Set cached value with TTL
   */
  async set<T>(key: string, value: T, ttl: number = this.DEFAULT_TTL): Promise<void> {
    const fullKey = this.getFullKey(key);
    const serialized = JSON.stringify(value);

    // Try Redis first
    if (this.isConnected && this.redis) {
      try {
        await this.redis.setex(fullKey, ttl, serialized);
        console.log(`[Redis] SET: ${key} (TTL: ${ttl}s)`);
      } catch (err: any) {
        console.error(`[Redis] SET error: ${err.message}`);
        // Fall through to memory cache
      }
    }

    // Always set in memory cache as backup
    this.memoryCache.set(fullKey, {
      data: serialized,
      expiresAt: Date.now() + (ttl * 1000),
    });
    console.log(`[Memory] SET: ${key} (TTL: ${ttl}s)`);
  }

  /**
   * Delete cached value
   */
  async delete(key: string): Promise<boolean> {
    const fullKey = this.getFullKey(key);
    let deleted = false;

    if (this.isConnected && this.redis) {
      try {
        const result = await this.redis.del(fullKey);
        deleted = result > 0;
        console.log(`[Redis] DELETE: ${key}`);
      } catch (err: any) {
        console.error(`[Redis] DELETE error: ${err.message}`);
      }
    }

    if (this.memoryCache.delete(fullKey)) {
      deleted = true;
      console.log(`[Memory] DELETE: ${key}`);
    }

    return deleted;
  }

  /**
   * Invalidate by pattern (supports * wildcard)
   */
  async invalidateByPattern(pattern: string): Promise<number> {
    const fullPattern = this.getFullKey(pattern);
    let count = 0;

    // Redis pattern invalidation
    if (this.isConnected && this.redis) {
      try {
        const keys = await this.redis.keys(fullPattern.replace(/\*/g, '*'));
        if (keys.length > 0) {
          count = await this.redis.del(...keys);
          console.log(`[Redis] INVALIDATE: Pattern "${pattern}" matched ${count} entries`);
        }

        // Broadcast invalidation to other instances
        await this.redis.publish('cache:invalidate', pattern);
      } catch (err: any) {
        console.error(`[Redis] INVALIDATE error: ${err.message}`);
      }
    }

    // Memory cache pattern invalidation
    const memoryCount = this.clearMemoryCacheByPattern(pattern);
    count = Math.max(count, memoryCount);

    return count;
  }

  private clearMemoryCacheByPattern(pattern: string): number {
    const regex = new RegExp('^' + this.KEY_PREFIX + pattern.replace(/\*/g, '.*') + '$');
    let count = 0;
    
    const keysToDelete: string[] = [];
    this.memoryCache.forEach((_, key) => {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    });
    
    keysToDelete.forEach(key => {
      this.memoryCache.delete(key);
      count++;
    });

    if (count > 0) {
      console.log(`[Memory] INVALIDATE: Pattern "${pattern}" matched ${count} entries`);
    }
    return count;
  }

  /**
   * Invalidate all statistics caches
   */
  async invalidateStatistics(): Promise<void> {
    await this.invalidateByPattern('stats:*');
    await this.invalidateByPattern('yield:*');
    await this.invalidateByPattern('throughput:*');
    console.log('[Cache] All statistics caches invalidated');
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    if (this.isConnected && this.redis) {
      try {
        const keys = await this.redis.keys(`${this.KEY_PREFIX}*`);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
        console.log('[Redis] CLEAR: All entries removed');
      } catch (err: any) {
        console.error(`[Redis] CLEAR error: ${err.message}`);
      }
    }

    this.memoryCache.clear();
    console.log('[Memory] CLEAR: All entries removed');
  }

  /**
   * Generate cache key
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
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    let memoryUsage = 0;
    let size = this.memoryCache.size;

    // Calculate memory usage from memory cache
    this.memoryCache.forEach((entry) => {
      memoryUsage += entry.data.length * 2; // Approximate bytes
    });

    // Get Redis info if connected
    if (this.isConnected && this.redis) {
      try {
        const info = await this.redis.info('memory');
        const usedMemoryMatch = info.match(/used_memory:(\d+)/);
        if (usedMemoryMatch) {
          memoryUsage = parseInt(usedMemoryMatch[1], 10);
        }

        const dbSize = await this.redis.dbsize();
        size = dbSize;
      } catch (err: any) {
        console.error(`[Redis] Stats error: ${err.message}`);
      }
    }

    const total = this.stats.hits + this.stats.misses;
    
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      size,
      memoryUsage,
      isRedisConnected: this.isConnected,
      lastError: this.lastError,
      uptime: Date.now() - this.startTime,
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    redis: boolean;
    memory: boolean;
    latency?: number;
  }> {
    const result = {
      status: 'healthy' as 'healthy' | 'degraded' | 'unhealthy',
      redis: false,
      memory: true,
      latency: undefined as number | undefined,
    };

    // Check Redis
    if (this.redis) {
      try {
        const start = Date.now();
        await this.redis.ping();
        result.latency = Date.now() - start;
        result.redis = true;
      } catch (err) {
        result.redis = false;
      }
    }

    // Determine overall status
    if (result.redis) {
      result.status = 'healthy';
    } else if (result.memory) {
      result.status = 'degraded';
    } else {
      result.status = 'unhealthy';
    }

    return result;
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit();
    }
    if (this.redis) {
      await this.redis.quit();
    }
    this.memoryCache.clear();
  }
}

// Singleton instance
export const redisService = new RedisService();

// Helper function for cached fetch
export async function getCachedOrFetch<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttl?: number
): Promise<T> {
  const cached = await redisService.get<T>(key);
  if (cached !== null) {
    return cached;
  }
  
  const data = await fetchFn();
  await redisService.set(key, data, ttl);
  return data;
}

export default redisService;
