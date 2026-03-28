import React from 'react';
import { cn } from '@/lib/utils';
import { WIDGET_DEFINITIONS } from './ResizableDashboard';

interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TemplatePreviewProps {
  widgets: string[];
  layout: LayoutItem[];
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

// Color mapping for different widget types
const WIDGET_COLORS: Record<string, string> = {
  kpiCards: 'bg-blue-500/80',
  trendChart: 'bg-green-500/80',
  machineStatus: 'bg-purple-500/80',
  alerts: 'bg-red-500/80',
  topMachines: 'bg-orange-500/80',
  factoryStats: 'bg-cyan-500/80',
  recentInspections: 'bg-yellow-500/80',
  shiftStats: 'bg-pink-500/80',
};

export function TemplatePreview({ widgets, layout, className, size = 'sm' }: TemplatePreviewProps) {
  // Calculate grid bounds
  const maxX = Math.max(...layout.map(item => item.x + item.w), 4);
  const maxY = Math.max(...layout.map(item => item.y + item.h), 4);
  
  // Size configurations
  const sizeConfig = {
    sm: { width: 80, height: 50, cellSize: 20 },
    md: { width: 120, height: 75, cellSize: 30 },
    lg: { width: 160, height: 100, cellSize: 40 },
  };
  
  const config = sizeConfig[size];
  const cellWidth = config.width / maxX;
  const cellHeight = config.height / maxY;
  
  return (
    <div 
      className={cn(
        'relative rounded border border-border/50 bg-muted/30 overflow-hidden',
        className
      )}
      style={{ width: config.width, height: config.height }}
    >
      {/* Grid background */}
      <div className="absolute inset-0 opacity-20">
        {Array.from({ length: maxX }).map((_, x) => (
          <div
            key={`v-${x}`}
            className="absolute top-0 bottom-0 border-l border-border/30"
            style={{ left: x * cellWidth }}
          />
        ))}
        {Array.from({ length: maxY }).map((_, y) => (
          <div
            key={`h-${y}`}
            className="absolute left-0 right-0 border-t border-border/30"
            style={{ top: y * cellHeight }}
          />
        ))}
      </div>
      
      {/* Widget blocks */}
      {layout.map((item) => {
        const def = WIDGET_DEFINITIONS[item.i];
        if (!def || !widgets.includes(item.i)) return null;
        
        return (
          <div
            key={item.i}
            className={cn(
              'absolute rounded-sm transition-all',
              WIDGET_COLORS[item.i] || 'bg-gray-500/80'
            )}
            style={{
              left: item.x * cellWidth + 1,
              top: item.y * cellHeight + 1,
              width: item.w * cellWidth - 2,
              height: item.h * cellHeight - 2,
            }}
            title={def.name}
          >
            {size !== 'sm' && (
              <span className="absolute inset-0 flex items-center justify-center text-[8px] text-white font-medium truncate px-1">
                {def.name.split(' ').map(w => w[0]).join('')}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Preset template definitions for preview
export const PRESET_TEMPLATES = {
  default: {
    name: 'Default',
    description: 'Standard layout with all widgets',
    widgets: ['kpiCards', 'trendChart', 'machineStatus', 'alerts', 'topMachines', 'factoryStats', 'recentInspections'],
    layout: [
      { i: 'kpiCards', x: 0, y: 0, w: 4, h: 1 },
      { i: 'trendChart', x: 0, y: 1, w: 2, h: 2 },
      { i: 'machineStatus', x: 2, y: 1, w: 2, h: 2 },
      { i: 'alerts', x: 0, y: 3, w: 2, h: 2 },
      { i: 'topMachines', x: 2, y: 3, w: 2, h: 2 },
      { i: 'factoryStats', x: 0, y: 5, w: 2, h: 2 },
      { i: 'recentInspections', x: 2, y: 5, w: 2, h: 2 },
    ],
  },
  compact: {
    name: 'Compact',
    description: 'Smaller widgets, more density',
    widgets: ['kpiCards', 'trendChart', 'machineStatus', 'alerts'],
    layout: [
      { i: 'kpiCards', x: 0, y: 0, w: 2, h: 2 },
      { i: 'trendChart', x: 2, y: 0, w: 2, h: 2 },
      { i: 'machineStatus', x: 0, y: 2, w: 2, h: 2 },
      { i: 'alerts', x: 2, y: 2, w: 2, h: 2 },
    ],
  },
  wide: {
    name: 'Wide',
    description: 'Full-width charts and tables',
    widgets: ['kpiCards', 'trendChart', 'recentInspections', 'factoryStats'],
    layout: [
      { i: 'kpiCards', x: 0, y: 0, w: 4, h: 2 },
      { i: 'trendChart', x: 0, y: 2, w: 4, h: 2 },
      { i: 'recentInspections', x: 0, y: 4, w: 4, h: 2 },
      { i: 'factoryStats', x: 0, y: 6, w: 4, h: 2 },
    ],
  },
  analytics: {
    name: 'Analytics',
    description: 'Focus on charts and trends',
    widgets: ['kpiCards', 'trendChart', 'topMachines', 'factoryStats', 'shiftStats'],
    layout: [
      { i: 'kpiCards', x: 0, y: 0, w: 4, h: 1 },
      { i: 'trendChart', x: 0, y: 1, w: 2, h: 2 },
      { i: 'topMachines', x: 2, y: 1, w: 2, h: 2 },
      { i: 'factoryStats', x: 0, y: 3, w: 2, h: 2 },
      { i: 'shiftStats', x: 2, y: 3, w: 2, h: 2 },
    ],
  },
};

export default TemplatePreview;
