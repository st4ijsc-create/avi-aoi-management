/**
 * useAnalyticsErrorBoundary Hook
 * Wraps analytics queries and provides error handling
 */

import { useCallback } from 'react';
import { TRPCClientErrorLike } from '@trpc/client';
import { mapTrpcError } from "@/lib/trpcErrors";

export interface ErrorInfo {
  message: string;
  code?: string;
  details?: string;
  retryable: boolean;
}

export function useAnalyticsErrorHandler() {
  const parseError = useCallback((error: any): ErrorInfo => {
    if (!error) {
      return {
        message: 'Unknown error occurred',
        retryable: false,
      };
    }

    // tRPC error
    // i18n-raw-ok: điều kiện ĐIỀU KHIỂN luồng (có message hay không), không hiện ra.
    if (error.message) {
      return {
        message: mapTrpcError(error),
        code: error.code || 'INTERNAL_ERROR',
        details: error.data?.zodError ? JSON.stringify(error.data.zodError) : undefined,
        retryable: error.code === 'TIMEOUT' || error.code === 'TOO_MANY_REQUESTS',
      };
    }

    return {
      message: String(error),
      retryable: false,
    };
  }, []);

  const getUserMessage = useCallback((errorInfo: ErrorInfo): string => {
    if (errorInfo.code === 'TIMEOUT') {
      return 'Request timed out. Please try again.';
    }
    if (errorInfo.code === 'TOO_MANY_REQUESTS') {
      return 'Too many requests. Please wait a moment and try again.';
    }
    if (errorInfo.code === 'FORBIDDEN') {
      return 'You do not have permission to view this data.';
    }
    if (errorInfo.code === 'UNATHENTICATED') {
      return 'Please sign in to continue.';
    }
    return errorInfo.message || 'Failed to load data. Please try again.';
  }, []);

  return {
    parseError,
    getUserMessage,
  };
}
