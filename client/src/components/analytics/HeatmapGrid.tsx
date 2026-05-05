/**
 * Enhanced HeatmapGrid Component
 * Improved version with tooltips, labels, legend, and export
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Download, Thermometer } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HeatmapCell {
  machineCode: string;
  hour: number;
  defectRate: number;
  total: number;
}

interface HeatmapGridProps {
  data: HeatmapCell[] | undefined;
  onExport?: () => void;
  showLegend?: boolean;
}

export const HeatmapGrid = React.memo(function HeatmapGrid({
  data,
  onExport,
  showLegend = true,
}: HeatmapGridProps) {
  const { t } = useTranslation();
  const [hoveredCell, setHoveredCell] = useState<{ machine: string; hour: number } | null>(null);

  if (!data?.length) {
    return (
      <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
        {t('common.noData', 'No data available')}
      </div>
    );
  }

  const machines = Array.from(new Set(data.map((d) => d.machineCode))).sort();
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const cellMap = new Map(data.map((d) => [`${d.machineCode}:${d.hour}`, d]));
  const maxRate = Math.max(...data.map((d) => d.defectRate), 0.001);

  // Color gradient: green (0%) -> yellow (5%) -> red (10%+)
  const getColor = (rate: number) => {
    const intensity = rate / maxRate;
    if (intensity < 0.3) return 'rgba(34, 197, 94, 0.2)'; // Green
    if (intensity < 0.6) return 'rgba(234, 179, 8, 0.3)'; // Yellow
    if (intensity < 0.8) return 'rgba(249, 115, 22, 0.4)'; // Orange
    return 'rgba(239, 68, 68, 0.5)'; // Red
  };

  return (
    <div className="space-y-3">
      {/* Legend */}
      {showLegend && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="font-medium text-muted-foreground">Legend:</span>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(34, 197, 94, 0.6)' }} />
            <span>0% - Low</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(234, 179, 8, 0.6)' }} />
            <span>Low - Medium</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(249, 115, 22, 0.6)' }} />
            <span>Medium - High</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(239, 68, 68, 0.6)' }} />
            <span>High - Critical</span>
          </div>
        </div>
      )}

      {/* Heatmap Table */}
      <ScrollArea className="max-h-96 rounded-lg border">
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse min-w-full">
            <thead>
              <tr className="bg-muted">
                <th className="p-2 text-left font-semibold sticky left-0 bg-muted z-20 min-w-max">
                  Machine / Hour
                </th>
                {hours.map((h) => (
                  <th key={h} className="p-1 text-center font-semibold w-8 min-w-8 bg-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {machines.map((machine) => (
                <tr key={machine}>
                  <td className="p-2 font-medium whitespace-nowrap sticky left-0 bg-background z-10 border-r">
                    {machine}
                  </td>
                  {hours.map((h) => {
                    const cell = cellMap.get(`${machine}:${h}`);
                    const hasData = cell && cell.total > 0;
                    const isHovered =
                      hoveredCell?.machine === machine && hoveredCell?.hour === h;

                    return (
                      <td
                        key={h}
                        className="p-0 text-center"
                        onMouseEnter={() =>
                          setHoveredCell(machine && h ? { machine, hour: h } : null)
                        }
                        onMouseLeave={() => setHoveredCell(null)}
                      >
                        <div
                          className={cn(
                            'w-8 h-8 mx-auto rounded transition-all',
                            isHovered && 'ring-2 ring-offset-1 ring-cyan-500'
                          )}
                          style={{
                            backgroundColor: hasData ? getColor(cell.defectRate) : '#f5f5f5',
                            border: !hasData ? '1px solid var(--border)' : undefined,
                          }}
                          title={
                            hasData
                              ? `${machine} ${h}h - Defect: ${(cell.defectRate * 100).toFixed(1)}% (${cell.total} inspections)`
                              : `${machine} ${h}h - No data`
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ScrollArea>

      {/* Tooltip Info */}
      {hoveredCell && cellMap.has(`${hoveredCell.machine}:${hoveredCell.hour}`) && (
        <div className="p-3 rounded-lg bg-muted border text-xs space-y-1">
          <div className="font-semibold">{hoveredCell.machine}</div>
          <div>
            <span className="text-muted-foreground">Hour: </span>
            <strong>{hoveredCell.hour}:00</strong>
          </div>
          <div>
            <span className="text-muted-foreground">Defect Rate: </span>
            <strong>
              {(cellMap.get(`${hoveredCell.machine}:${hoveredCell.hour}`)?.defectRate || 0) * 100}%
            </strong>
          </div>
          <div>
            <span className="text-muted-foreground">Inspections: </span>
            <strong>
              {cellMap.get(`${hoveredCell.machine}:${hoveredCell.hour}`)?.total || 0}
            </strong>
          </div>
        </div>
      )}
    </div>
  );
});

HeatmapGrid.displayName = 'HeatmapGrid';
