/**
 * AdvancedTooltip Component for Recharts
 * Displays detailed information on hover for analytics charts
 */

import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface AdvancedTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number | string;
    color: string;
    payload: Record<string, any>;
  }>;
  label?: string | number;
  currency?: boolean;
  decimalPlaces?: number;
  unit?: string;
}

export const AdvancedTooltip = React.memo(function AdvancedTooltip({
  active,
  payload,
  label,
  currency = false,
  decimalPlaces = 2,
  unit = '',
}: AdvancedTooltipProps) {
  if (!active || !payload) return null;

  const formatValue = (value: number | string): string => {
    if (typeof value === 'string') return value;
    
    if (currency) {
      return `$${value.toFixed(decimalPlaces)}`;
    }
    
    if (Number.isFinite(value)) {
      return `${value.toFixed(decimalPlaces)}${unit}`;
    }
    
    return String(value);
  };

  return (
    <div className="pointer-events-none">
      <Card className="shadow-lg border bg-background/95 backdrop-blur-sm p-3 text-xs max-w-xs">
        <div className="space-y-2">
          {label && (
            <div className="font-semibold text-sm border-b pb-2">
              {label}
            </div>
          )}
          
          {payload.map((entry, index) => (
            <div key={index} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-muted-foreground">{entry.name}</span>
              </div>
              <strong className="font-semibold">
                {formatValue(entry.value)}
              </strong>
            </div>
          ))}

          {/* Additional stats if available in payload */}
          {payload[0]?.payload && (
            <>
              {payload[0].payload.confidence !== undefined && (
                <div className="pt-2 border-t mt-2">
                  <Badge variant="outline" className="text-xs">
                    Confidence: {(payload[0].payload.confidence * 100).toFixed(0)}%
                  </Badge>
                </div>
              )}
              
              {payload[0].payload.status && (
                <div className="flex gap-1">
                  <Badge
                    className="text-xs"
                    variant={
                      payload[0].payload.status === 'good'
                        ? 'default'
                        : payload[0].payload.status === 'warning'
                          ? 'secondary'
                          : 'destructive'
                    }
                  >
                    {payload[0].payload.status}
                  </Badge>
                </div>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
});

AdvancedTooltip.displayName = 'AdvancedTooltip';
