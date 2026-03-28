import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface InfiniteScrollListProps<T> {
  data: T[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMoreRef: (node: HTMLElement | null) => void;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  total?: number;
  renderItem: (item: T, index: number) => ReactNode;
  keyExtractor: (item: T, index: number) => string | number;
  renderEmpty?: () => ReactNode;
  renderHeader?: () => ReactNode;
  className?: string;
  itemClassName?: string;
  loadingText?: string;
  loadMoreText?: string;
  emptyText?: string;
  showTotal?: boolean;
}

export function InfiniteScrollList<T>({
  data,
  isLoading,
  isLoadingMore,
  error,
  hasMore,
  loadMoreRef,
  loadMore,
  refresh,
  total,
  renderItem,
  keyExtractor,
  renderEmpty,
  renderHeader,
  className = '',
  itemClassName = '',
  loadingText,
  loadMoreText,
  emptyText,
  showTotal = true,
}: InfiniteScrollListProps<T>) {
  const { t } = useTranslation();
  const resolvedLoadingText = loadingText ?? t('common.loading');
  const resolvedLoadMoreText = loadMoreText ?? t('common.loadMore');
  const resolvedEmptyText = emptyText ?? t('common.noData');
  // Initial loading state
  if (isLoading && data.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center py-12 ${className}`}>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">{resolvedLoadingText}</p>
      </div>
    );
  }

  // Error state
  if (error && data.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="mt-2 text-sm text-destructive">{error.message}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            className="mt-4"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('common.retry')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (!isLoading && data.length === 0) {
    if (renderEmpty) {
      return <>{renderEmpty()}</>;
    }
    return (
      <Card className={className}>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">{resolvedEmptyText}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={className}>
      {/* Header with total count */}
      {renderHeader && renderHeader()}
      
      {showTotal && total !== undefined && (
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-muted-foreground">
            {t('common.showingResults', { shown: data.length, total })}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
        </div>
      )}

      {/* List items */}
      <div className="space-y-2">
        {data.map((item, index) => (
          <div key={keyExtractor(item, index)} className={itemClassName}>
            {renderItem(item, index)}
          </div>
        ))}
      </div>

      {/* Load more trigger */}
      {hasMore && (
        <div
          ref={loadMoreRef}
          className="flex items-center justify-center py-4"
        >
          {isLoadingMore ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">{resolvedLoadingText}</span>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={loadMore}
              className="w-full max-w-xs"
            >
              {resolvedLoadMoreText}
            </Button>
          )}
        </div>
      )}

      {/* End of list indicator */}
      {!hasMore && data.length > 0 && (
        <div className="flex items-center justify-center py-4">
          <p className="text-sm text-muted-foreground">
            {t('common.showingAll', { count: data.length })}
          </p>
        </div>
      )}

      {/* Error while loading more */}
      {error && data.length > 0 && (
        <div className="flex items-center justify-center gap-2 py-4 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">{error.message}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore}
          >
            {t('common.retry')}
          </Button>
        </div>
      )}
    </div>
  );
}

export default InfiniteScrollList;
