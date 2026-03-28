import { useState, useCallback, useRef, useEffect } from 'react';

interface CursorPaginationResult<T> {
  data: T[];
  nextCursor: string | null;
  prevCursor: string | null;
  hasMore: boolean;
  total?: number;
}

interface UseInfiniteScrollOptions<T> {
  fetchFn: (cursor?: string) => Promise<CursorPaginationResult<T>>;
  enabled?: boolean;
  initialData?: T[];
}

interface UseInfiniteScrollReturn<T> {
  data: T[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => void;
  total?: number;
  // For intersection observer
  loadMoreRef: (node: HTMLElement | null) => void;
}

export function useInfiniteScroll<T>({
  fetchFn,
  enabled = true,
  initialData = [],
}: UseInfiniteScrollOptions<T>): UseInfiniteScrollReturn<T> {
  const [data, setData] = useState<T[]>(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState<number | undefined>(undefined);
  
  const nextCursorRef = useRef<string | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreNodeRef = useRef<HTMLElement | null>(null);

  // Initial load
  const loadInitial = useCallback(async () => {
    if (!enabled) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await fetchFn();
      setData(result.data);
      nextCursorRef.current = result.nextCursor;
      setHasMore(result.hasMore);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch data'));
    } finally {
      setIsLoading(false);
    }
  }, [fetchFn, enabled]);

  // Load more
  const loadMore = useCallback(async () => {
    if (!enabled || !hasMore || isLoadingMore || !nextCursorRef.current) return;
    
    setIsLoadingMore(true);
    setError(null);
    
    try {
      const result = await fetchFn(nextCursorRef.current);
      setData(prev => [...prev, ...result.data]);
      nextCursorRef.current = result.nextCursor;
      setHasMore(result.hasMore);
      if (result.total !== undefined) {
        setTotal(result.total);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load more data'));
    } finally {
      setIsLoadingMore(false);
    }
  }, [fetchFn, enabled, hasMore, isLoadingMore]);

  // Refresh (reload from beginning)
  const refresh = useCallback(async () => {
    nextCursorRef.current = null;
    setData([]);
    setHasMore(true);
    await loadInitial();
  }, [loadInitial]);

  // Reset state
  const reset = useCallback(() => {
    nextCursorRef.current = null;
    setData(initialData);
    setIsLoading(false);
    setIsLoadingMore(false);
    setError(null);
    setHasMore(true);
    setTotal(undefined);
  }, [initialData]);

  // Intersection Observer callback
  const loadMoreRef = useCallback((node: HTMLElement | null) => {
    if (isLoadingMore) return;
    
    if (observerRef.current) {
      observerRef.current.disconnect();
    }
    
    loadMoreNodeRef.current = node;
    
    if (node) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
            loadMore();
          }
        },
        {
          root: null,
          rootMargin: '100px',
          threshold: 0.1,
        }
      );
      observerRef.current.observe(node);
    }
  }, [hasMore, isLoadingMore, loadMore]);

  // Initial load on mount
  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  return {
    data,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
    refresh,
    reset,
    total,
    loadMoreRef,
  };
}

export default useInfiniteScroll;
