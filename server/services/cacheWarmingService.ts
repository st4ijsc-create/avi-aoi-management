/**
 * Cache Warming Service
 * 
 * Pre-caches frequently accessed statistics when server starts
 * to reduce cold start latency and improve user experience.
 */

// W4-B (doc 27 B8): warming now writes through the consolidated cacheService
// facade (L1 + Redis L2) instead of redisService directly, so warmed entries
// are readable by the facade read path and cleared by pattern invalidation
// across BOTH tiers.
import { cacheService } from './cacheService';
import * as db from '../db';

interface WarmingConfig {
  enabled: boolean;
  intervalMinutes: number;
  warmOnStart: boolean;
}

const DEFAULT_CONFIG: WarmingConfig = {
  enabled: true,
  intervalMinutes: 30, // Re-warm every 30 minutes
  warmOnStart: true,
};

class CacheWarmingService {
  private config: WarmingConfig;
  private warmingInterval: NodeJS.Timeout | null = null;
  private isWarming = false;
  private lastWarmingTime: Date | null = null;
  private warmingStats = {
    totalWarms: 0,
    successfulWarms: 0,
    failedWarms: 0,
    lastDuration: 0,
  };

  constructor(config: Partial<WarmingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize cache warming service
   */
  async initialize(): Promise<void> {
    console.log('[CacheWarming] Initializing cache warming service...');
    
    if (!this.config.enabled) {
      console.log('[CacheWarming] Cache warming is disabled');
      return;
    }

    // Warm cache on start if configured
    if (this.config.warmOnStart) {
      // Delay initial warming to allow server to fully start
      setTimeout(() => {
        this.warmCache().catch(err => {
          console.error('[CacheWarming] Initial warming failed:', err.message);
        });
      }, 5000); // Wait 5 seconds after server start
    }

    // Set up periodic warming
    if (this.config.intervalMinutes > 0) {
      const intervalMs = this.config.intervalMinutes * 60 * 1000;
      this.warmingInterval = setInterval(() => {
        this.warmCache().catch(err => {
          console.error('[CacheWarming] Periodic warming failed:', err.message);
        });
      }, intervalMs);
      
      console.log(`[CacheWarming] Periodic warming scheduled every ${this.config.intervalMinutes} minutes`);
    }
  }

  /**
   * Warm all statistics caches
   */
  async warmCache(): Promise<void> {
    if (this.isWarming) {
      console.log('[CacheWarming] Warming already in progress, skipping...');
      return;
    }

    this.isWarming = true;
    this.warmingStats.totalWarms++;
    const startTime = Date.now();
    
    console.log('[CacheWarming] Starting cache warming...');

    try {
      // Get date range for last 30 days
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      // Warm yield rate by corporate
      await this.warmYieldRateByCorporate(startDate, endDate);
      
      // Warm yield rate by factory
      await this.warmYieldRateByFactory(startDate, endDate);
      
      // Warm throughput by corporate
      await this.warmThroughputByCorporate(startDate, endDate);
      
      // Warm throughput by factory
      await this.warmThroughputByFactory(startDate, endDate);

      // Warm dashboard stats
      await this.warmDashboardStats();

      this.warmingStats.successfulWarms++;
      this.lastWarmingTime = new Date();
      this.warmingStats.lastDuration = Date.now() - startTime;
      
      console.log(`[CacheWarming] Cache warming completed in ${this.warmingStats.lastDuration}ms`);
    } catch (error: any) {
      this.warmingStats.failedWarms++;
      console.error('[CacheWarming] Cache warming failed:', error.message);
      throw error;
    } finally {
      this.isWarming = false;
    }
  }

  /**
   * Warm yield rate by corporate cache
   */
  private async warmYieldRateByCorporate(startDate: Date, endDate: Date): Promise<void> {
    try {
      const cacheKey = cacheService.generateKey('yield:corporate', {
        startDate,
        endDate,
      });
      
      const data = await db.getYieldRateByCorporate({
        startDate,
        endDate,
      });
      
      await cacheService.setAsync(cacheKey, data, 300_000); // 5 minutes TTL
      console.log(`[CacheWarming] Warmed yield rate by corporate: ${data.length} records`);
    } catch (error: any) {
      console.error('[CacheWarming] Failed to warm yield rate by corporate:', error.message);
    }
  }

  /**
   * Warm yield rate by factory cache
   */
  private async warmYieldRateByFactory(startDate: Date, endDate: Date): Promise<void> {
    try {
      const cacheKey = cacheService.generateKey('yield:factory', {
        startDate,
        endDate,
      });
      
      const data = await db.getYieldRateByFactory({
        startDate,
        endDate,
      });
      
      await cacheService.setAsync(cacheKey, data, 300_000);
      console.log(`[CacheWarming] Warmed yield rate by factory: ${data.length} records`);
    } catch (error: any) {
      console.error('[CacheWarming] Failed to warm yield rate by factory:', error.message);
    }
  }

  /**
   * Warm throughput by corporate cache
   */
  private async warmThroughputByCorporate(startDate: Date, endDate: Date): Promise<void> {
    try {
      const cacheKey = cacheService.generateKey('throughput:corporate', {
        startDate,
        endDate,
        interval: 'day',
      });
      
      const data = await db.getThroughputByCorporate({
        startDate,
        endDate,
        interval: 'day',
      });
      
      await cacheService.setAsync(cacheKey, data, 300_000);
      console.log(`[CacheWarming] Warmed throughput by corporate: ${data.length} records`);
    } catch (error: any) {
      console.error('[CacheWarming] Failed to warm throughput by corporate:', error.message);
    }
  }

  /**
   * Warm throughput by factory cache
   */
  private async warmThroughputByFactory(startDate: Date, endDate: Date): Promise<void> {
    try {
      const cacheKey = cacheService.generateKey('throughput:factory', {
        startDate,
        endDate,
        interval: 'day',
      });
      
      const data = await db.getThroughputByFactory({
        startDate,
        endDate,
        interval: 'day',
      });
      
      await cacheService.setAsync(cacheKey, data, 300_000);
      console.log(`[CacheWarming] Warmed throughput by factory: ${data.length} records`);
    } catch (error: any) {
      console.error('[CacheWarming] Failed to warm throughput by factory:', error.message);
    }
  }

  /**
   * Warm dashboard stats cache
   */
  private async warmDashboardStats(): Promise<void> {
    try {
      const cacheKey = 'stats:dashboard:overview';
      
      // Get basic dashboard stats
      const factories = await db.getFactories();
      const machines = await db.getMachines();
      
      const stats = {
        totalFactories: factories.length,
        activeFactories: factories.filter((f: { isActive: boolean }) => f.isActive).length,
        totalMachines: machines.length,
        activeMachines: machines.filter((m: { isActive: boolean }) => m.isActive).length,
        warmedAt: new Date().toISOString(),
      };
      
      await cacheService.setAsync(cacheKey, stats, 300_000);
      console.log('[CacheWarming] Warmed dashboard stats');
    } catch (error: any) {
      console.error('[CacheWarming] Failed to warm dashboard stats:', error.message);
    }
  }

  /**
   * Get warming statistics
   */
  getStats(): {
    isWarming: boolean;
    lastWarmingTime: Date | null;
    config: WarmingConfig;
    stats: {
      totalWarms: number;
      successfulWarms: number;
      failedWarms: number;
      lastDuration: number;
    };
  } {
    return {
      isWarming: this.isWarming,
      lastWarmingTime: this.lastWarmingTime,
      config: this.config,
      stats: { ...this.warmingStats },
    };
  }

  /**
   * Manually trigger cache warming
   */
  async triggerWarming(): Promise<void> {
    await this.warmCache();
  }

  /**
   * Update configuration
   * @param config - Partial config with optional warmOnStartup (maps to warmOnStart)
   */
  updateConfig(config: Partial<WarmingConfig> & { warmOnStartup?: boolean }): void {
    // Map warmOnStartup to warmOnStart for API compatibility
    const mappedConfig: Partial<WarmingConfig> = { ...config };
    if ('warmOnStartup' in config) {
      mappedConfig.warmOnStart = config.warmOnStartup;
      delete (mappedConfig as any).warmOnStartup;
    }
    this.config = { ...this.config, ...mappedConfig };
    
    // Restart interval if needed
    if (this.warmingInterval) {
      clearInterval(this.warmingInterval);
      this.warmingInterval = null;
    }
    
    if (this.config.enabled && this.config.intervalMinutes > 0) {
      const intervalMs = this.config.intervalMinutes * 60 * 1000;
      const self = this;
      this.warmingInterval = setInterval(() => {
        self.warmCache().catch((err: Error) => {
          console.error('[CacheWarming] Periodic warming failed:', err.message);
        });
      }, intervalMs);
    }
  }

  /**
   * Stop cache warming service
   */
  stop(): void {
    if (this.warmingInterval) {
      clearInterval(this.warmingInterval);
      this.warmingInterval = null;
    }
    console.log('[CacheWarming] Cache warming service stopped');
  }
}

// Singleton instance
export const cacheWarmingService = new CacheWarmingService();

// Export for testing
export { CacheWarmingService };
