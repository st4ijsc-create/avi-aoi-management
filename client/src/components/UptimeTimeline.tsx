import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { format, differenceInMinutes, startOfHour, addHours } from "date-fns";
import { vi } from "date-fns/locale";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type TimelineSegment = {
  start: Date;
  end: Date;
  status: string;
  duration: number;
};

type MachineTimeline = {
  machineId: number;
  machineCode: string;
  machineName: string;
  timeline: TimelineSegment[];
  uptimePercent: number;
  totalOnlineTime: number;
  totalOfflineTime: number;
};

interface UptimeTimelineProps {
  data: MachineTimeline[];
  hours: number;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function TimelineBar({ timeline, hours }: { timeline: TimelineSegment[]; hours: number }) {
  const now = new Date();
  const startTime = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const totalMs = hours * 60 * 60 * 1000;

  // Generate hour markers
  const hourMarkers = useMemo(() => {
    const markers = [];
    let currentHour = startOfHour(startTime);
    if (currentHour < startTime) currentHour = addHours(currentHour, 1);
    
    while (currentHour <= now) {
      const position = ((currentHour.getTime() - startTime.getTime()) / totalMs) * 100;
      markers.push({ time: currentHour, position });
      currentHour = addHours(currentHour, 1);
    }
    return markers;
  }, [startTime, now, totalMs]);

  // Calculate segment positions
  const segments = useMemo(() => {
    return timeline.map(seg => {
      const segStart = new Date(seg.start);
      const segEnd = new Date(seg.end);
      
      // Clamp to visible range
      const visibleStart = Math.max(segStart.getTime(), startTime.getTime());
      const visibleEnd = Math.min(segEnd.getTime(), now.getTime());
      
      if (visibleEnd <= visibleStart) return null;
      
      const left = ((visibleStart - startTime.getTime()) / totalMs) * 100;
      const width = ((visibleEnd - visibleStart) / totalMs) * 100;
      
      return {
        ...seg,
        left,
        width,
        visibleStart: new Date(visibleStart),
        visibleEnd: new Date(visibleEnd),
      };
    }).filter(Boolean);
  }, [timeline, startTime, now, totalMs]);

  return (
    <TooltipProvider>
      <div className="relative h-6 bg-muted/30 rounded overflow-hidden">
        {/* Hour markers */}
        {hourMarkers.map((marker, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 w-px bg-border/50"
            style={{ left: `${marker.position}%` }}
          />
        ))}
        
        {/* Timeline segments */}
        {segments.map((seg, i) => (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <div
                className={`absolute top-0 bottom-0 cursor-pointer transition-opacity hover:opacity-80 ${
                  seg!.status === 'online' ? 'bg-emerald-500' : 'bg-red-500'
                }`}
                style={{
                  left: `${seg!.left}%`,
                  width: `${Math.max(seg!.width, 0.5)}%`,
                }}
              />
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-xs">
                <p className="font-medium capitalize">{seg!.status}</p>
                <p>{format(seg!.visibleStart, 'HH:mm:ss', { locale: vi })} - {format(seg!.visibleEnd, 'HH:mm:ss', { locale: vi })}</p>
                <p>Thời gian: {formatDuration(seg!.duration)}</p>
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
        
        {/* No data indicator */}
        {segments.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            Không có dữ liệu
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

export function UptimeTimeline({ data, hours }: UptimeTimelineProps) {
  const { t } = useTranslation();
  const now = new Date();
  const startTime = new Date(now.getTime() - hours * 60 * 60 * 1000);

  // Generate time labels
  const timeLabels = useMemo(() => {
    const labels = [];
    const interval = hours <= 24 ? 4 : hours <= 72 ? 12 : 24;
    
    for (let i = 0; i <= hours; i += interval) {
      const time = new Date(startTime.getTime() + i * 60 * 60 * 1000);
      const position = (i / hours) * 100;
      labels.push({
        time,
        position,
        label: format(time, hours <= 24 ? 'HH:mm' : 'dd/MM HH:mm', { locale: vi }),
      });
    }
    return labels;
  }, [hours, startTime]);

  return (
    <div className="space-y-4">
      {/* Time axis */}
      <div className="relative h-6 ml-48">
        {timeLabels.map((label, i) => (
          <div
            key={i}
            className="absolute text-xs text-muted-foreground"
            style={{ left: `${label.position}%`, transform: 'translateX(-50%)' }}
          >
            {label.label}
          </div>
        ))}
      </div>

      {/* Machine timelines */}
      <div className="space-y-2">
        {data.map((machine) => (
          <div key={machine.machineId} className="flex items-center gap-4">
            <div className="w-44 flex-shrink-0">
              <p className="text-sm font-medium truncate">{machine.machineName}</p>
              <p className="text-xs text-muted-foreground font-mono">{machine.machineCode}</p>
            </div>
            <div className="flex-1">
              <TimelineBar timeline={machine.timeline} hours={hours} />
            </div>
            <div className="w-16 text-right">
              <span className={`text-sm font-medium ${
                machine.uptimePercent >= 90 ? 'text-emerald-500' :
                machine.uptimePercent >= 70 ? 'text-amber-500' : 'text-red-500'
              }`}>
                {machine.uptimePercent}%
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="w-4 h-3 bg-emerald-500 rounded" />
          <span>Online</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-3 bg-red-500 rounded" />
          <span>Offline</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-3 bg-muted/30 rounded" />
          <span>{t("uptimeTl.khongCoDuLieu", "Không có dữ liệu")}</span>
        </div>
      </div>
    </div>
  );
}

export default UptimeTimeline;
