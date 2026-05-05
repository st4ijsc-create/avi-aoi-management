/**
 * PaginationControls Component
 * Reusable pagination UI for tables
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PAGINATION } from '@/lib/analyticsConstants';

interface PaginationControlsProps {
  pageIndex: number;
  pageSize: number;
  pageCount: number;
  canPreviousPage: boolean;
  canNextPage: boolean;
  totalItems: number;
  onPageIndexChange: (index: number) => void;
  onPageSizeChange: (size: number) => void;
  compact?: boolean;
}

export const PaginationControls = React.memo(function PaginationControls({
  pageIndex,
  pageSize,
  pageCount,
  canPreviousPage,
  canNextPage,
  totalItems,
  onPageIndexChange,
  onPageSizeChange,
  compact = false,
}: PaginationControlsProps) {
  const { t } = useTranslation();

  const startItem = pageIndex * pageSize + 1;
  const endItem = Math.min((pageIndex + 1) * pageSize, totalItems);

  if (compact) {
    return (
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {t('common.showing', 'Showing')} {startItem}-{endItem} of {totalItems}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageIndexChange(pageIndex - 1)}
            disabled={!canPreviousPage}
            className="h-7"
          >
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <span className="text-xs px-2">
            Page {pageIndex + 1} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageIndexChange(pageIndex + 1)}
            disabled={!canNextPage}
            className="h-7"
          >
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="text-sm text-muted-foreground">
        {t('common.showing', 'Showing')} <strong>{startItem}</strong>-<strong>{endItem}</strong> of{' '}
        <strong>{totalItems}</strong>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <label htmlFor="page-size" className="text-sm text-muted-foreground">
            {t('common.perPage', 'Per page')}:
          </label>
          <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(parseInt(v))}>
            <SelectTrigger id="page-size" className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGINATION.pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageIndexChange(pageIndex - 1)}
            disabled={!canPreviousPage}
          >
            <ChevronLeft className="h-4 w-4" />
            {t('common.previous', 'Previous')}
          </Button>

          <div className="text-sm text-muted-foreground px-3">
            Page {pageIndex + 1} of {pageCount}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageIndexChange(pageIndex + 1)}
            disabled={!canNextPage}
          >
            {t('common.next', 'Next')}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
});

PaginationControls.displayName = 'PaginationControls';
