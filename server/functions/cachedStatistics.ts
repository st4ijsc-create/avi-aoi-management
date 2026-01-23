/**
 * Cached Statistics Functions
 * 
 * Wrapper functions that add caching layer to statistics queries.
 * Cache TTL: 5 minutes (300,000ms)
 */

import { cacheService, getCachedOrFetch } from '../services/cacheService';
import * as db from '../db';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get yield rate by corporate with caching
 */
export async function getCachedYieldRateByCorporate(filters: {
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const cacheKey = cacheService.generateKey('yield:corporate', {
    startDate: filters.startDate,
    endDate: filters.endDate,
    userId: filters.userId,
    userRole: filters.userRole,
  });

  return getCachedOrFetch(
    cacheKey,
    () => db.getYieldRateByCorporate(filters),
    CACHE_TTL
  );
}

/**
 * Get yield rate by factory with caching
 */
export async function getCachedYieldRateByFactory(filters: {
  corporateCode?: string;
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const cacheKey = cacheService.generateKey('yield:factory', {
    corporateCode: filters.corporateCode,
    startDate: filters.startDate,
    endDate: filters.endDate,
    userId: filters.userId,
    userRole: filters.userRole,
  });

  return getCachedOrFetch(
    cacheKey,
    () => db.getYieldRateByFactory(filters),
    CACHE_TTL
  );
}

/**
 * Get throughput by corporate with caching
 */
export async function getCachedThroughputByCorporate(filters: {
  startDate?: Date;
  endDate?: Date;
  interval?: 'hour' | 'day' | 'week';
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const cacheKey = cacheService.generateKey('throughput:corporate', {
    startDate: filters.startDate,
    endDate: filters.endDate,
    interval: filters.interval,
    userId: filters.userId,
    userRole: filters.userRole,
  });

  return getCachedOrFetch(
    cacheKey,
    () => db.getThroughputByCorporate(filters),
    CACHE_TTL
  );
}

/**
 * Get throughput by factory with caching
 */
export async function getCachedThroughputByFactory(filters: {
  corporateCode?: string;
  startDate?: Date;
  endDate?: Date;
  interval?: 'hour' | 'day' | 'week';
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const cacheKey = cacheService.generateKey('throughput:factory', {
    corporateCode: filters.corporateCode,
    startDate: filters.startDate,
    endDate: filters.endDate,
    interval: filters.interval,
    userId: filters.userId,
    userRole: filters.userRole,
  });

  return getCachedOrFetch(
    cacheKey,
    () => db.getThroughputByFactory(filters),
    CACHE_TTL
  );
}

interface MachineStats {
  total: number;
  okCount: number;
  ngCount: number;
  ntfCount: number;
  yieldRate: string;
  trend: Array<{
    date: string;
    total: number;
    ok: number;
    ng: number;
    ntf: number;
    yieldRate: string;
  }>;
  recentInspections: Array<{
    id: number;
    serialNumber: string;
    overallResult: string;
    inspectionTime: Date;
  }>;
}

/**
 * Get machine statistics with caching
 */
export async function getCachedMachineStats(filters: {
  machineId: number;
  startDate?: Date;
  endDate?: Date;
}): Promise<MachineStats> {
  const cacheKey = cacheService.generateKey('stats:machine', {
    machineId: filters.machineId,
    startDate: filters.startDate,
    endDate: filters.endDate,
  });

  return getCachedOrFetch(
    cacheKey,
    async (): Promise<MachineStats> => {
      // Get machine inspections and calculate stats
      const result = await db.getProductInspections({
        machineId: filters.machineId,
        startDate: filters.startDate,
        endDate: filters.endDate,
        limit: 1000,
      });

      const inspections = result.data;
      const total = inspections.length;
      const okCount = inspections.filter(i => i.overallResult === 'OK').length;
      const ngCount = inspections.filter(i => i.overallResult === 'NG').length;
      const ntfCount = inspections.filter(i => i.overallResult === 'NTF').length;
      const yieldRate = total > 0 ? ((okCount / total) * 100).toFixed(2) : '0.00';

      // Group by date for trend
      const byDate = inspections.reduce((acc, insp) => {
        const date = new Date(insp.inspectionTime).toISOString().split('T')[0];
        if (!acc[date]) {
          acc[date] = { total: 0, ok: 0, ng: 0, ntf: 0 };
        }
        acc[date].total++;
        if (insp.overallResult === 'OK') acc[date].ok++;
        if (insp.overallResult === 'NG') acc[date].ng++;
        if (insp.overallResult === 'NTF') acc[date].ntf++;
        return acc;
      }, {} as Record<string, { total: number; ok: number; ng: number; ntf: number }>);

      const trend = Object.entries(byDate)
        .map(([date, stats]) => ({
          date,
          total: stats.total,
          ok: stats.ok,
          ng: stats.ng,
          ntf: stats.ntf,
          yieldRate: stats.total > 0 ? ((stats.ok / stats.total) * 100).toFixed(2) : '0.00',
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        total,
        okCount,
        ngCount,
        ntfCount,
        yieldRate,
        trend,
        recentInspections: inspections.slice(0, 20).map(i => ({
          id: i.id,
          serialNumber: i.serialNumber,
          overallResult: i.overallResult,
          inspectionTime: i.inspectionTime,
        })),
      };
    },
    CACHE_TTL
  );
}

/**
 * Invalidate all statistics caches
 * Should be called when new inspection data is submitted
 */
export function invalidateStatisticsCache(): void {
  cacheService.invalidateStatistics();
}

/**
 * Get cache statistics for monitoring
 */
export function getCacheStats() {
  return cacheService.getStats();
}
