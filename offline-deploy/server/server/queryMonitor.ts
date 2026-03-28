/**
 * Query Performance Monitoring
 * Tracks query execution time and detects slow queries
 */

export interface QueryMetrics {
  query: string;
  executionTime: number; // milliseconds
  timestamp: Date;
  isSlowQuery: boolean;
  params?: unknown[];
}

const SLOW_QUERY_THRESHOLD = 1000; // 1 second
const MAX_METRICS_HISTORY = 1000; // Keep last 1000 metrics

let metricsHistory: QueryMetrics[] = [];

/**
 * Log query execution time
 */
export function logQueryMetrics(
  query: string,
  executionTime: number,
  params?: unknown[]
): QueryMetrics {
  const isSlowQuery = executionTime > SLOW_QUERY_THRESHOLD;
  
  const metrics: QueryMetrics = {
    query,
    executionTime,
    timestamp: new Date(),
    isSlowQuery,
    params,
  };

  metricsHistory.push(metrics);
  
  // Keep history size manageable
  if (metricsHistory.length > MAX_METRICS_HISTORY) {
    metricsHistory = metricsHistory.slice(-MAX_METRICS_HISTORY);
  }

  // Log slow queries to console
  if (isSlowQuery) {
    console.warn(`[SLOW QUERY] ${executionTime}ms: ${query.substring(0, 100)}...`);
    if (params) {
      console.warn(`  Params: ${JSON.stringify(params)}`);
    }
  }

  return metrics;
}

/**
 * Get all slow queries from history
 */
export function getSlowQueries(limit = 50): QueryMetrics[] {
  return metricsHistory
    .filter(m => m.isSlowQuery)
    .sort((a, b) => b.executionTime - a.executionTime)
    .slice(0, limit);
}

/**
 * Get query performance statistics
 */
export function getQueryStats() {
  if (metricsHistory.length === 0) {
    return {
      totalQueries: 0,
      slowQueries: 0,
      averageExecutionTime: 0,
      maxExecutionTime: 0,
      minExecutionTime: 0,
    };
  }

  const executionTimes = metricsHistory.map(m => m.executionTime);
  const slowQueryCount = metricsHistory.filter(m => m.isSlowQuery).length;

  return {
    totalQueries: metricsHistory.length,
    slowQueries: slowQueryCount,
    slowQueryPercentage: ((slowQueryCount / metricsHistory.length) * 100).toFixed(2),
    averageExecutionTime: (executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length).toFixed(2),
    maxExecutionTime: Math.max(...executionTimes),
    minExecutionTime: Math.min(...executionTimes),
  };
}

/**
 * Get queries by execution time range
 */
export function getQueriesByTimeRange(minMs: number, maxMs: number): QueryMetrics[] {
  return metricsHistory.filter(m => m.executionTime >= minMs && m.executionTime <= maxMs);
}

/**
 * Clear metrics history
 */
export function clearMetricsHistory(): void {
  metricsHistory = [];
}

/**
 * Get recent queries
 */
export function getRecentQueries(limit = 50): QueryMetrics[] {
  return metricsHistory.slice(-limit).reverse();
}

/**
 * Analyze query patterns - find most frequently executed queries
 */
export function analyzeQueryPatterns(limit = 20) {
  const patterns = new Map<string, { count: number; totalTime: number; avgTime: number }>();

  metricsHistory.forEach(metric => {
    // Normalize query by removing parameters
    const normalizedQuery = metric.query.replace(/\?/g, '?').substring(0, 200);
    
    if (!patterns.has(normalizedQuery)) {
      patterns.set(normalizedQuery, { count: 0, totalTime: 0, avgTime: 0 });
    }

    const pattern = patterns.get(normalizedQuery)!;
    pattern.count++;
    pattern.totalTime += metric.executionTime;
    pattern.avgTime = pattern.totalTime / pattern.count;
  });

  return Array.from(patterns.entries())
    .map(([query, stats]) => ({
      query,
      ...stats,
    }))
    .sort((a, b) => b.totalTime - a.totalTime)
    .slice(0, limit);
}

/**
 * Decorator for measuring function execution time
 */
export function measureQueryTime(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value;

  descriptor.value = async function (...args: any[]) {
    const startTime = performance.now();
    try {
      const result = await originalMethod.apply(this, args);
      const executionTime = performance.now() - startTime;
      
      logQueryMetrics(
        `${target.constructor.name}.${propertyKey}`,
        executionTime,
        args
      );
      
      return result;
    } catch (error) {
      const executionTime = performance.now() - startTime;
      logQueryMetrics(
        `${target.constructor.name}.${propertyKey} [ERROR]`,
        executionTime,
        args
      );
      throw error;
    }
  };

  return descriptor;
}
