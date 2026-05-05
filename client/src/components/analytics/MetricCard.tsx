/**
 * MetricCard Component
 * Displays a key metric with trend indicator and color coding
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowUpRight, ArrowDownRight, Minus, LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  icon?: LucideIcon;
  trend?: {
    direction: 'up' | 'down' | 'stable';
    change: number; // percentage change
    color?: string;
  };
  color?: 'green' | 'red' | 'yellow' | 'blue' | 'purple' | 'cyan';
  isLoading?: boolean;
  comparison?: string; // e.g., "vs last period"
  className?: string;
}

const colorClasses: Record<string, string> = {
  green: 'bg-green-500/10 text-green-600',
  red: 'bg-red-500/10 text-red-600',
  yellow: 'bg-yellow-500/10 text-yellow-600',
  blue: 'bg-blue-500/10 text-blue-600',
  purple: 'bg-purple-500/10 text-purple-600',
  cyan: 'bg-cyan-500/10 text-cyan-600',
};

const iconColors: Record<string, string> = {
  green: 'text-green-600',
  red: 'text-red-600',
  yellow: 'text-yellow-600',
  blue: 'text-blue-600',
  purple: 'text-purple-600',
  cyan: 'text-cyan-600',
};

export const MetricCard = React.memo(function MetricCard({
  label,
  value,
  unit,
  icon: Icon,
  trend,
  color = 'blue',
  isLoading = false,
  comparison,
  className,
}: MetricCardProps) {
  const trendColor = trend
    ? trend.direction === 'up'
      ? 'text-green-600'
      : trend.direction === 'down'
        ? 'text-red-600'
        : 'text-gray-600'
    : undefined;

  const TrendIcon =
    trend?.direction === 'up'
      ? ArrowUpRight
      : trend?.direction === 'down'
        ? ArrowDownRight
        : Minus;

  return (
    <Card className={className}>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-tight">
              {label}
            </p>

            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold">
                  {value}
                  {unit && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
                </span>
              </div>
            )}

            {comparison && (
              <p className="text-xs text-muted-foreground">{comparison}</p>
            )}
          </div>

          <div className={cn('p-2 rounded-lg flex-shrink-0', colorClasses[color])}>
            {Icon ? (
              <Icon className="h-5 w-5" />
            ) : trend ? (
              <TrendIcon className={cn('h-5 w-5', trendColor)} />
            ) : null}
          </div>
        </div>

        {trend && (
          <div className="mt-3 flex items-center gap-1">
            <TrendIcon className={cn('h-3 w-3', trendColor)} />
            <span className={cn('text-xs font-medium', trendColor)}>
              {trend.direction === 'up' ? '+' : trend.direction === 'down' ? '-' : ''}
              {Math.abs(trend.change).toFixed(1)}%
            </span>
            <span className="text-xs text-muted-foreground">
              {trend.direction === 'up'
                ? 'Improving'
                : trend.direction === 'down'
                  ? 'Declining'
                  : 'Stable'}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

MetricCard.displayName = 'MetricCard';
