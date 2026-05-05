/**
 * ChartCard Component
 * Reusable wrapper for analytics charts with export, refresh, and loading states
 */

import React, { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Download,
  RefreshCw,
  AlertCircle,
  Eye,
  EyeOff,
  LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ChartCardProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
  children: ReactNode;
  onRefresh?: () => void;
  onExport?: (format: 'csv' | 'json' | 'png' | 'pdf', context?: { title: string; exportId: string }) => void | Promise<void>;
  showExport?: boolean;
  showRefresh?: boolean;
  showToggle?: boolean;
  isVisible?: boolean;
  onToggleVisibility?: (visible: boolean) => void;
  className?: string;
  contentClassName?: string;
  compact?: boolean;
}

export const ChartCard = React.memo(function ChartCard({
  title,
  description,
  icon: Icon,
  isLoading = false,
  isError = false,
  errorMessage,
  children,
  onRefresh,
  onExport,
  showExport = true,
  showRefresh = true,
  showToggle = false,
  isVisible = true,
  onToggleVisibility,
  className,
  contentClassName,
  compact = false,
}: ChartCardProps) {
  const { t } = useTranslation();
  const exportId = `chart-card-export-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  const handleExport = (format: 'csv' | 'json' | 'png' | 'pdf') => {
    if (!onExport) return;
    Promise.resolve(onExport(format, { title, exportId })).catch((error) => {
      console.error(`[ChartCard] Export failed for ${title} (${format})`, error);
    });
  };

  if (showToggle && !isVisible) {
    return (
      <Card className={className}>
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
              <CardTitle className="text-sm">{title}</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onToggleVisibility?.(true)}
            >
              <Eye className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className={cn('pb-2', compact && 'py-2')}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
              <CardTitle className="text-sm">{title}</CardTitle>
            </div>
            {description && (
              <CardDescription className="text-xs mt-1">{description}</CardDescription>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {showRefresh && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onRefresh}
                disabled={isLoading}
                title={t('common.refresh', 'Refresh')}
              >
                <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
              </Button>
            )}

            {showExport && onExport && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" title={t('common.export', 'Export')}>
                    <Download className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleExport('csv')}>
                    Export CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport('json')}>
                    Export JSON
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport('png')}>
                    Export PNG
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {showToggle && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onToggleVisibility?.(false)}
              >
                <EyeOff className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent id={exportId} className={cn('space-y-2', contentClassName)}>
        {isError && errorMessage && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex gap-2">
            <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-red-700">
              <p className="font-medium">{t('common.error', 'Error')}</p>
              <p className="text-red-600">{errorMessage}</p>
              {onRefresh && (
                <Button
                  variant="link"
                  size="sm"
                  className="p-0 h-auto mt-2 text-xs"
                  onClick={onRefresh}
                >
                  {t('common.tryAgain', 'Try again')}
                </Button>
              )}
            </div>
          </div>
        )}

        {isLoading && <Skeleton className="h-62.5 w-full" />}

        {!isLoading && !isError && children}
      </CardContent>
    </Card>
  );
});

ChartCard.displayName = 'ChartCard';
