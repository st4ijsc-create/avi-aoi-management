/**
 * Pagination Hook
 * Manages pagination state for tables with localStorage persistence
 */

import { useState, useCallback, useEffect } from 'react';
import { LOCAL_STORAGE_KEYS, PAGINATION } from '@/lib/analyticsConstants';

export interface PaginationState {
  pageIndex: number;
  pageSize: number;
}

export interface UsePaginationReturn {
  pageIndex: number;
  pageSize: number;
  setPageIndex: (index: number) => void;
  setPageSize: (size: number) => void;
  reset: () => void;
  canPreviousPage: boolean;
  canNextPage: boolean;
  pageCount: number;
  paginatedData: any[];
}

export function usePagination(
  data: any[],
  initialPageSize: number = PAGINATION.defaultPageSize,
  persistToStorage: boolean = true
): UsePaginationReturn {
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSizeState] = useState(() => {
    if (!persistToStorage) return initialPageSize;
    
    const stored = localStorage.getItem(LOCAL_STORAGE_KEYS.pageSize);
    return stored ? parseInt(stored, 10) : initialPageSize;
  });

  // Persist page size to localStorage
  const setPageSize = useCallback(
    (size: number) => {
      setPageSizeState(size);
      if (persistToStorage) {
        localStorage.setItem(LOCAL_STORAGE_KEYS.pageSize, String(size));
      }
      setPageIndex(0); // Reset to first page
    },
    [persistToStorage]
  );

  // Reset pagination when data changes
  useEffect(() => {
    setPageIndex(0);
  }, [data]);

  // Calculate pagination info
  const pageCount = Math.ceil(data.length / pageSize);
  const canPreviousPage = pageIndex > 0;
  const canNextPage = pageIndex < pageCount - 1;

  // Get paginated data
  const startIndex = pageIndex * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedData = data.slice(startIndex, endIndex);

  const reset = useCallback(() => {
    setPageIndex(0);
  }, []);

  return {
    pageIndex,
    pageSize,
    setPageIndex,
    setPageSize,
    reset,
    canPreviousPage,
    canNextPage,
    pageCount,
    paginatedData,
  };
}
