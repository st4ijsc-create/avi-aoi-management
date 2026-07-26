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

interface ConnectionEvent {
  type: 'connect' | 'disconnect' | 'error' | 'reconnect';
  timestamp: Date;
  message: string;
}

type ConnectionListener = (event: ConnectionEvent) => void;
type InvalidateListener = (pattern: string) => void;

class RedisService {
  private redis: Redis | null = null;
  private subscriber: Redis | null = null;
  private isConnected = false;
  private configured = false;
  private lastError: string | null = null;
  private startTime = Date.now();
  // W4-B (doc 27 B8): listeners notified when a cache-invalidation broadcast
  // arrives from ANOTHER instance (Redis pub/sub) so upper cache tiers
  // (cacheService L1) can drop matching keys too.
  private invalidateListeners: InvalidateListener[] = [];
  
  // In-memory fallback
  private memoryCache: Map<string, { data: string; expiresAt: number }> = new Map();
  
  // Stats
  private stats = {
    hits: 0,
    misses: 0,
  };
  
  // Connection monitoring
  private connectionListeners: ConnectionListener[] = [];
  private connectionHistory: ConnectionEvent[] = [];
  private readonly MAX_HISTORY = 100;
  
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
    this.configured = true;

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
        const wasDisconnected = !this.isConnected;
        this.isConnected = true;
        this.lastError = null;
        
        // Emit connection event
        this.emitConnectionEvent({
          type: wasDisconnected ? 'reconnect' : 'connect',
          timestamp: new Date(),
          message: wasDisconnected ? 'Redis reconnected after disconnection' : 'Redis connected successfully',
        });
      });

      this.redis.on('error', (err) => {
        console.error('[Redis] Connection error:', err.message);
        this.lastError = err.message;
        this.isConnected = false;
        
        // Emit error event
        this.emitConnectionEvent({
          type: 'error',
          timestamp: new Date(),
          message: `Redis error: ${err.message}`,
        });
      });

      this.redis.on('close', () => {
        console.log('[Redis] Connection closed');
        const wasConnected = this.isConnected;
        this.isConnected = false;
        
        // Emit disconnect event only if was previously connected
        if (wasConnected) {
          this.emitConnectionEvent({
            type: 'disconnect',
            timestamp: new Date(),
            message: 'Redis connection closed - falling back to in-memory cache',
          });
        }
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
          // W4-B (B8): propagate to registered upper tiers (cacheService L1)
          // so cross-instance invalidations clear EVERY layer, not just this
          // service's fallback map. Self-published messages also land here —
          // the extra local clear is idempotent.
          this.notifyInvalidateListeners(pattern);
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
   * P2.3 (doc 54) — ATOMIC cluster-wide cooldown/dedup claim (`SET key 1 EX ttl NX`).
   *
   * Trả về:
   *   • true  — GIÀNH được khoá (key chưa tồn tại) → caller là instance ĐƯỢC PHÉP kích hoạt.
   *   • false — key đã tồn tại (đang cooldown do instance khác / lần trước) → caller BỎ QUA.
   *   • null  — Redis không sẵn sàng / lỗi → caller TỰ fallback sang bộ nhớ cục bộ (single-node).
   *
   * Best-effort theo hợp đồng: MỌI lỗi Redis → null (KHÔNG BAO GIỜ throw), nên vòng đánh giá
   * cảnh báo không bao giờ vỡ vì Redis. TTL ≤ 0 → null (không có cửa sổ cooldown để giữ).
   */
  async acquireCooldown(key: string, ttlSeconds: number): Promise<boolean | null> {
    if (!(this.isConnected && this.redis) || !(ttlSeconds > 0)) return null;
    const fullKey = this.getFullKey(key);
    try {
      // SET NX + EX là NGUYÊN TỬ: đúng một instance trong cụm set thành công mỗi cửa sổ.
      const res = await this.redis.set(fullKey, '1', 'EX', Math.ceil(ttlSeconds), 'NX');
      return res === 'OK';
    } catch (err: any) {
      console.error(`[Redis] acquireCooldown error: ${err?.message ?? err}`);
      return null; // báo hiệu fallback sang bộ nhớ
    }
  }

  /**
   * Review fix (doc69 G2-4 W1-4) — single Lua script for `incrWithExpire`: `INCR`, read
   * `PTTL`, and (re)apply `PEXPIRE` in ONE atomic round-trip whenever the key is brand-new
   * (`count == 1`) OR was found with no/expired TTL (`pttl <= 0`) despite `count > 1` — the
   * self-heal branch. `ARGV[1]` is the window length in milliseconds. Returns `{count, pttl}`
   * as a 2-element array (Redis/Lua table → ioredis array).
   */
  private static readonly INCR_WITH_EXPIRE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local pttl = redis.call('PTTL', KEYS[1])
if count == 1 or pttl <= 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  pttl = tonumber(ARGV[1])
end
return {count, pttl}
`.trim();

  /**
   * doc69 G2-4 (+ review fix W1-4) — ATOMIC durable counter for a fixed-window rate limiter.
   * Backs aiGateway's Redis rate limit so the count survives a process restart and is shared
   * correctly across multiple app instances/nodes (unlike the previous in-process `Map`-based
   * counter).
   *
   * Review fix: previously this ran `INCR` then a SEPARATE `EXPIRE` round-trip on the first
   * increment — if the `EXPIRE` call ever failed/threw AFTER the `INCR` had already landed
   * (count=1), the key would persist with NO TTL forever: every later call would `INCR` past 1
   * and skip the `if (count===1)` branch, permanently rate-limiting that bucket until a manual
   * `DEL`. Now the whole `INCR` + conditional `PEXPIRE` decision happens inside ONE Lua `EVAL`
   * (`INCR_WITH_EXPIRE_SCRIPT` above), which Redis executes atomically — no window where the
   * counter can be bumped without its TTL being set. The script ALSO self-heals: if it ever
   * observes `count > 1` on a key whose `pttl <= 0` (a stuck key from before this fix, or any
   * other cause of a lost TTL), it re-applies `PEXPIRE` right then, so a stuck bucket recovers
   * on its very next hit instead of staying stuck until a manual `DEL`.
   *
   * Trả về:
   *   • `{ count, ttlMs }` — count sau lần tăng này, cùng TTL còn lại (ms) của cửa sổ.
   *   • `null` — Redis chưa kết nối/chưa cấu hình, hoặc thao tác lỗi. Caller BẮT BUỘC fallback
   *     sang cơ chế đếm khác (vd in-memory) — fail-open, KHÔNG BAO GIỜ throw.
   */
  async incrWithExpire(key: string, windowSeconds: number): Promise<{ count: number; ttlMs: number } | null> {
    if (!(this.isConnected && this.redis) || !(windowSeconds > 0)) return null;
    const fullKey = this.getFullKey(key);
    const windowMs = Math.ceil(windowSeconds * 1000);
    try {
      const result = (await this.redis.eval(
        RedisService.INCR_WITH_EXPIRE_SCRIPT,
        1,
        fullKey,
        windowMs,
      )) as [number, number];
      const count = Number(result[0]);
      const pttl = Number(result[1]);
      return { count, ttlMs: pttl > 0 ? pttl : windowMs };
    } catch (err: any) {
      console.error(`[Redis] incrWithExpire error: ${err?.message ?? err}`);
      return null; // fail-open: caller falls back to in-memory
    }
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
   * Emit connection event to all listeners
   */
  private emitConnectionEvent(event: ConnectionEvent): void {
    // Add to history
    this.connectionHistory.push(event);
    if (this.connectionHistory.length > this.MAX_HISTORY) {
      this.connectionHistory.shift();
    }
    
    // Notify all listeners
    this.connectionListeners.forEach(listener => {
      try {
        listener(event);
      } catch (err: any) {
        console.error('[Redis] Listener error:', err.message);
      }
    });
    
    console.log(`[Redis] Connection event: ${event.type} - ${event.message}`);
  }

  /**
   * True when REDIS_URL was set at startup (regardless of current connection
   * health — when down, this service degrades to its in-memory map).
   * The cacheService facade uses this to decide whether an L2 tier exists.
   */
  isConfigured(): boolean {
    return this.configured;
  }

  /**
   * Register a listener fired when a cache-invalidation broadcast arrives on
   * the `cache:invalidate` pub/sub channel (typically published by another
   * instance). Returns an unsubscribe function. (W4-B, doc 27 B8)
   */
  onInvalidateBroadcast(listener: InvalidateListener): () => void {
    this.invalidateListeners.push(listener);
    return () => {
      const index = this.invalidateListeners.indexOf(listener);
      if (index > -1) this.invalidateListeners.splice(index, 1);
    };
  }

  private notifyInvalidateListeners(pattern: string): void {
    for (const listener of this.invalidateListeners) {
      try {
        listener(pattern);
      } catch (err: any) {
        console.error('[Redis] Invalidate listener error:', err?.message ?? err);
      }
    }
  }

  /**
   * Add connection event listener
   */
  onConnectionChange(listener: ConnectionListener): () => void {
    this.connectionListeners.push(listener);
    return () => {
      const index = this.connectionListeners.indexOf(listener);
      if (index > -1) {
        this.connectionListeners.splice(index, 1);
      }
    };
  }

  /**
   * Get connection history
   */
  getConnectionHistory(): ConnectionEvent[] {
    return [...this.connectionHistory];
  }

  /**
   * Get current connection status
   */
  getConnectionStatus(): {
    isConnected: boolean;
    lastError: string | null;
    mode: 'redis' | 'memory';
    uptime: number;
    recentEvents: ConnectionEvent[];
  } {
    return {
      isConnected: this.isConnected,
      lastError: this.lastError,
      mode: this.isConnected ? 'redis' : 'memory',
      uptime: Date.now() - this.startTime,
      recentEvents: this.connectionHistory.slice(-10),
    };
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
    this.connectionListeners = [];
    this.invalidateListeners = [];
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
