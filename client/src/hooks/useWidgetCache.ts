import { useState, useCallback, useRef, useEffect } from 'react';

// Widget cache configuration
interface CacheConfig {
  ttl: number; // Time to live in milliseconds
  staleWhileRevalidate: boolean;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  isStale: boolean;
}

interface WidgetCacheState<T> {
  data: T | null;
  isLoading: boolean;
  isStale: boolean;
  lastUpdated: number | null;
  error: Error | null;
}

// Default TTL values per widget type (in milliseconds)
const DEFAULT_TTL: Record<string, number> = {
  'overview': 60000,           // 1 minute
  'machine-status': 30000,     // 30 seconds (real-time)
  'alerts': 30000,             // 30 seconds
  'yield-rate': 120000,        // 2 minutes
  'throughput': 120000,        // 2 minutes
  'recent-inspections': 60000, // 1 minute
  'defect-distribution': 180000, // 3 minutes
  'corporate-stats': 300000,   // 5 minutes
};

// In-memory cache store
const cacheStore = new Map<string, CacheEntry<unknown>>();

// Cache statistics
let cacheHits = 0;
let cacheMisses = 0;

export function getCacheStats() {
  return {
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: cacheHits + cacheMisses > 0 
      ? Math.round((cacheHits / (cacheHits + cacheMisses)) * 100) 
      : 0,
    entries: cacheStore.size,
  };
}

export function clearWidgetCache(widgetId?: string) {
  if (widgetId) {
    // Clear specific widget cache
    const keysToDelete: string[] = [];
    cacheStore.forEach((_, key) => {
      if (key.startsWith(`widget:${widgetId}:`)) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => cacheStore.delete(key));
  } else {
    // Clear all widget cache
    cacheStore.clear();
  }
}

export function useWidgetCache<T>(
  widgetId: string,
  fetchFn: () => Promise<T>,
  config?: Partial<CacheConfig>
): WidgetCacheState<T> & {
  refresh: () => Promise<void>;
  invalidate: () => void;
} {
  const ttl = config?.ttl ?? DEFAULT_TTL[widgetId] ?? 60000;
  const staleWhileRevalidate = config?.staleWhileRevalidate ?? true;
  
  const cacheKey = `widget:${widgetId}:data`;
  const fetchingRef = useRef(false);
  
  const [state, setState] = useState<WidgetCacheState<T>>(() => {
    // Initialize from cache if available
    const cached = cacheStore.get(cacheKey) as CacheEntry<T> | undefined;
    if (cached) {
      const isStale = Date.now() - cached.timestamp > ttl;
      return {
        data: cached.data,
        isLoading: false,
        isStale,
        lastUpdated: cached.timestamp,
        error: null,
      };
    }
    return {
      data: null,
      isLoading: true,
      isStale: false,
      lastUpdated: null,
      error: null,
    };
  });

  const fetchData = useCallback(async (force = false) => {
    if (fetchingRef.current && !force) return;
    
    const cached = cacheStore.get(cacheKey) as CacheEntry<T> | undefined;
    const now = Date.now();
    
    // Check if cache is still valid
    if (!force && cached && now - cached.timestamp < ttl) {
      cacheHits++;
      setState(prev => ({
        ...prev,
        data: cached.data,
        isLoading: false,
        isStale: false,
        lastUpdated: cached.timestamp,
      }));
      return;
    }
    
    cacheMisses++;
    
    // If stale-while-revalidate and we have cached data, show it while fetching
    if (staleWhileRevalidate && cached) {
      setState(prev => ({
        ...prev,
        data: cached.data,
        isLoading: true,
        isStale: true,
        lastUpdated: cached.timestamp,
      }));
    } else {
      setState(prev => ({ ...prev, isLoading: true }));
    }
    
    fetchingRef.current = true;
    
    try {
      const data = await fetchFn();
      const timestamp = Date.now();
      
      // Update cache
      cacheStore.set(cacheKey, {
        data,
        timestamp,
        isStale: false,
      });
      
      setState({
        data,
        isLoading: false,
        isStale: false,
        lastUpdated: timestamp,
        error: null,
      });
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
      }));
    } finally {
      fetchingRef.current = false;
    }
  }, [cacheKey, ttl, staleWhileRevalidate, fetchFn]);

  const refresh = useCallback(async () => {
    await fetchData(true);
  }, [fetchData]);

  const invalidate = useCallback(() => {
    cacheStore.delete(cacheKey);
    setState(prev => ({
      ...prev,
      isStale: true,
    }));
  }, [cacheKey]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh when TTL expires
  useEffect(() => {
    const interval = setInterval(() => {
      const cached = cacheStore.get(cacheKey) as CacheEntry<T> | undefined;
      if (cached && Date.now() - cached.timestamp > ttl) {
        setState(prev => ({ ...prev, isStale: true }));
      }
    }, ttl / 2);

    return () => clearInterval(interval);
  }, [cacheKey, ttl]);

  return {
    ...state,
    refresh,
    invalidate,
  };
}

// Hook for managing widget cache across the dashboard
export function useDashboardWidgetCache() {
  const [stats, setStats] = useState(getCacheStats());

  useEffect(() => {
    const interval = setInterval(() => {
      setStats(getCacheStats());
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const clearAll = useCallback(() => {
    clearWidgetCache();
    setStats(getCacheStats());
  }, []);

  const clearWidget = useCallback((widgetId: string) => {
    clearWidgetCache(widgetId);
    setStats(getCacheStats());
  }, []);

  return {
    stats,
    clearAll,
    clearWidget,
  };
}
