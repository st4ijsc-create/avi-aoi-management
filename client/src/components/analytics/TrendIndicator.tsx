/**
 * TrendIndicator Component
 * Shows trend direction with icon, percentage change, and interpretation
 */

import React from 'react';
import { ArrowUpRight, ArrowDownRight, Minus, TrendingUp, TrendingDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface TrendIndicatorProps {
  direction: 'up' | 'down' | 'stable';
  value: number; // percentage change
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'inline' | 'badge' | 'full';
  compactMode?: boolean;
  pValue?: number; // for statistical significance
}

export const TrendIndicator = React.memo(function TrendIndicator({
  direction,
  value,
  label,
  size = 'md',
  variant = 'inline',
  compactMode = false,
  pValue,
}: TrendIndicatorProps) {
  const isSignificant = pValue ? pValue < 0.05 : true;

  const colorClass =
    direction === 'up'
      ? 'text-green-600'
      : direction === 'down'
        ? 'text-red-600'
        : 'text-gray-600';

  const bgClass =
    direction === 'up'
      ? 'bg-green-500/10'
      : direction === 'down'
        ? 'bg-red-500/10'
        : 'bg-gray-500/10';

  const Icon =
    direction === 'up'
      ? ArrowUpRight
      : direction === 'down'
        ? ArrowDownRight
        : Minus;

  const sizeClass =
    size === 'sm'
      ? 'h-3 w-3'
      : size === 'md'
        ? 'h-4 w-4'
        : 'h-5 w-5';

  if (variant === 'badge') {
    return (
      <Badge
        variant={direction === 'up' ? 'default' : direction === 'down' ? 'destructive' : 'secondary'}
        className="whitespace-nowrap"
      >
        <Icon className={cn('mr-1', sizeClass)} />
        {direction === 'up' ? '+' : direction === 'down' ? '-' : ''}
        {Math.abs(value).toFixed(1)}%
        {label && <span className="ml-1">{label}</span>}
        {!isSignificant && <span className="ml-1 text-xs">*</span>}
      </Badge>
    );
  }

  if (variant === 'full') {
    return (
      <div className={cn('flex items-center gap-2 p-2 rounded-lg', bgClass)}>
        <Icon className={cn(sizeClass, colorClass)} />
        <div className="flex flex-col gap-0.5">
          <span className={cn('text-sm font-semibold', colorClass)}>
            {direction === 'up' ? '+' : direction === 'down' ? '-' : ''}
            {Math.abs(value).toFixed(1)}%
          </span>
          {label && (
            <span className="text-xs text-muted-foreground">{label}</span>
          )}
          {pValue !== undefined && (
            <span className="text-xs text-muted-foreground">
              p-value: {pValue.toFixed(4)}
              {!isSignificant && ' (not significant)'}
            </span>
          )}
        </div>
      </div>
    );
  }

  // inline (default)
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-sm font-medium', colorClass)}>
      <Icon className={sizeClass} />
      {direction === 'up' ? '+' : direction === 'down' ? '-' : ''}
      {Math.abs(value).toFixed(compactMode ? 0 : 1)}%
      {label && !compactMode && <span className="ml-1 text-muted-foreground">{label}</span>}
      {!isSignificant && <span className="ml-1 text-xs">*</span>}
    </span>
  );
});

TrendIndicator.displayName = 'TrendIndicator';
