/**
 * DateRangeSelector Component
 * Smart date range selection with presets, persistence, and locale support
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Calendar } from 'lucide-react';
import { format, subDays, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter } from 'date-fns';
import { LOCAL_STORAGE_KEYS } from '@/lib/analyticsConstants';

interface DateRangeSelectorProps {
  startDate: string;
  endDate: string;
  onDateChange: (startDate: string, endDate: string) => void;
  compact?: boolean;
  persistToStorage?: boolean;
}

interface DateRange {
  label: string;
  getRange: () => { start: Date; end: Date };
}

export const DateRangeSelector = React.memo(function DateRangeSelector({
  startDate,
  endDate,
  onDateChange,
  compact = false,
  persistToStorage = true,
}: DateRangeSelectorProps) {
  const { t } = useTranslation();
  const [durationDays, setDurationDays] = useState<number>(0);

  // Calculate duration
  useEffect(() => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    setDurationDays(days);
  }, [startDate, endDate]);

  // Preset date ranges
  const presets: Record<string, DateRange> = {
    '7d': {
      label: t('common.sevenDays', 'Last 7 days'),
      getRange: () => ({
        start: subDays(new Date(), 7),
        end: new Date(),
      }),
    },
    '14d': {
      label: t('common.fourteenDays', 'Last 14 days'),
      getRange: () => ({
        start: subDays(new Date(), 14),
        end: new Date(),
      }),
    },
    '30d': {
      label: t('common.thirtyDays', 'Last 30 days'),
      getRange: () => ({
        start: subDays(new Date(), 30),
        end: new Date(),
      }),
    },
    '90d': {
      label: t('common.ninetyDays', 'Last 90 days'),
      getRange: () => ({
        start: subDays(new Date(), 90),
        end: new Date(),
      }),
    },
    'month': {
      label: t('common.thisMonth', 'This month'),
      getRange: () => ({
        start: startOfMonth(new Date()),
        end: endOfMonth(new Date()),
      }),
    },
    'quarter': {
      label: t('common.thisQuarter', 'This quarter'),
      getRange: () => ({
        start: startOfQuarter(new Date()),
        end: endOfQuarter(new Date()),
      }),
    },
  };

  const applyPreset = (presetKey: string) => {
    const preset = presets[presetKey];
    if (preset) {
      const range = preset.getRange();
      const formattedStart = format(range.start, 'yyyy-MM-dd');
      const formattedEnd = format(range.end, 'yyyy-MM-dd');

      onDateChange(formattedStart, formattedEnd);

      if (persistToStorage) {
        localStorage.setItem(
          LOCAL_STORAGE_KEYS.lastDateRange,
          JSON.stringify({ start: formattedStart, end: formattedEnd, preset: presetKey })
        );
      }
    }
  };

  const handleStartDateChange = (value: string) => {
    const start = new Date(value);
    const end = new Date(endDate);

    if (start < end) {
      onDateChange(value, endDate);
      if (persistToStorage) {
        localStorage.setItem(
          LOCAL_STORAGE_KEYS.lastDateRange,
          JSON.stringify({ start: value, end: endDate })
        );
      }
    }
  };

  const handleEndDateChange = (value: string) => {
    const start = new Date(startDate);
    const end = new Date(value);

    if (start < end) {
      onDateChange(startDate, value);
      if (persistToStorage) {
        localStorage.setItem(
          LOCAL_STORAGE_KEYS.lastDateRange,
          JSON.stringify({ start: startDate, end: value })
        );
      }
    }
  };

  // Disable future dates
  const today = format(new Date(), 'yyyy-MM-dd');

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <Badge variant="outline">
          <Calendar className="h-3 w-3 mr-1" />
          {durationDays} days
        </Badge>
        <span className="text-muted-foreground">
          {format(new Date(startDate), 'MMM dd')} - {format(new Date(endDate), 'MMM dd, yyyy')}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Quick presets */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground">Quick:</span>
        {Object.entries(presets).map(([key, preset]) => (
          <Button
            key={key}
            variant="outline"
            size="sm"
            onClick={() => applyPreset(key)}
            className="text-xs"
          >
            {preset.label}
          </Button>
        ))}
      </div>

      {/* Custom date range */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1">
          <label className="text-xs font-medium text-muted-foreground w-10">From:</label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => handleStartDateChange(e.target.value)}
            max={endDate}
            className="w-32 text-xs"
          />
        </div>

        <div className="flex items-center gap-2 flex-1">
          <label className="text-xs font-medium text-muted-foreground w-6">To:</label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => handleEndDateChange(e.target.value)}
            min={startDate}
            max={today}
            className="w-32 text-xs"
          />
        </div>

        <Badge variant="secondary" className="text-xs">
          {durationDays} days
        </Badge>
      </div>
    </div>
  );
});

DateRangeSelector.displayName = 'DateRangeSelector';
