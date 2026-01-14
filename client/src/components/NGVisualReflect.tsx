import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, XCircle, TrendingDown, TrendingUp, Minus } from "lucide-react";

// Types
interface WorkstationNGData {
  id: number;
  code: string;
  name: string;
  total: number;
  ng: number;
  ngRate: number;
  trend?: "up" | "down" | "stable";
}

interface MeasurementPointNGData {
  id: number;
  code: string;
  name: string;
  workstationId?: number;
  workstationName?: string;
  total: number;
  ng: number;
  ngRate: number;
  trend?: "up" | "down" | "stable";
}

interface NGVisualReflectProps {
  workstationData?: WorkstationNGData[];
  measurementPointData?: MeasurementPointNGData[];
  className?: string;
  showLegend?: boolean;
  compact?: boolean;
}

// Color coding based on NG rate
function getNGColor(ngRate: number): string {
  if (ngRate <= 2) return "bg-green-500";
  if (ngRate <= 5) return "bg-yellow-500";
  if (ngRate <= 10) return "bg-orange-500";
  return "bg-red-500";
}

function getNGColorClass(ngRate: number): string {
  if (ngRate <= 2) return "text-green-500 border-green-500";
  if (ngRate <= 5) return "text-yellow-500 border-yellow-500";
  if (ngRate <= 10) return "text-orange-500 border-orange-500";
  return "text-red-500 border-red-500";
}

function getNGBgClass(ngRate: number): string {
  if (ngRate <= 2) return "bg-green-500/10";
  if (ngRate <= 5) return "bg-yellow-500/10";
  if (ngRate <= 10) return "bg-orange-500/10";
  return "bg-red-500/10";
}

function getNGStatus(ngRate: number): { label: string; icon: React.ReactNode } {
  if (ngRate <= 2) return { label: "Tốt", icon: <CheckCircle2 className="h-4 w-4 text-green-500" /> };
  if (ngRate <= 5) return { label: "Chấp nhận", icon: <Minus className="h-4 w-4 text-yellow-500" /> };
  if (ngRate <= 10) return { label: "Cảnh báo", icon: <AlertTriangle className="h-4 w-4 text-orange-500" /> };
  return { label: "Nghiêm trọng", icon: <XCircle className="h-4 w-4 text-red-500" /> };
}

function getTrendIcon(trend?: "up" | "down" | "stable") {
  if (trend === "up") return <TrendingUp className="h-3 w-3 text-red-500" />;
  if (trend === "down") return <TrendingDown className="h-3 w-3 text-green-500" />;
  return <Minus className="h-3 w-3 text-muted-foreground" />;
}

// Workstation Heatmap Component
export function WorkstationNGHeatmap({ 
  data, 
  className,
  compact = false 
}: { 
  data: WorkstationNGData[];
  className?: string;
  compact?: boolean;
}) {
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => b.ngRate - a.ngRate);
  }, [data]);

  if (data.length === 0) {
    return (
      <div className={cn("text-center py-8 text-muted-foreground", className)}>
        <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>Không có dữ liệu công trạm</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className={cn("grid gap-2", compact ? "grid-cols-4 sm:grid-cols-6 lg:grid-cols-8" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4", className)}>
        {sortedData.map((ws) => {
          const status = getNGStatus(ws.ngRate);
          return (
            <Tooltip key={ws.id}>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "relative rounded-lg border-2 p-3 cursor-pointer transition-all hover:scale-105",
                    getNGColorClass(ws.ngRate),
                    getNGBgClass(ws.ngRate),
                    compact && "p-2"
                  )}
                >
                  {/* NG Rate indicator bar */}
                  <div className="absolute top-0 left-0 right-0 h-1 rounded-t-lg overflow-hidden">
                    <div 
                      className={cn("h-full", getNGColor(ws.ngRate))}
                      style={{ width: `${Math.min(100, ws.ngRate * 10)}%` }}
                    />
                  </div>
                  
                  <div className={cn("flex items-center gap-2", compact && "flex-col gap-1")}>
                    {status.icon}
                    <div className={cn("flex-1 min-w-0", compact && "text-center")}>
                      <p className={cn("font-medium truncate", compact ? "text-xs" : "text-sm")}>
                        {ws.code}
                      </p>
                      {!compact && (
                        <p className="text-xs text-muted-foreground truncate">
                          {ws.name}
                        </p>
                      )}
                    </div>
                    <div className={cn("text-right", compact && "text-center")}>
                      <p className={cn("font-bold", compact ? "text-sm" : "text-lg", getNGColorClass(ws.ngRate).split(" ")[0])}>
                        {ws.ngRate.toFixed(1)}%
                      </p>
                      {!compact && ws.trend && (
                        <div className="flex items-center justify-end gap-1">
                          {getTrendIcon(ws.trend)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <div className="space-y-1">
                  <p className="font-semibold">{ws.name}</p>
                  <p className="text-xs text-muted-foreground">Mã: {ws.code}</p>
                  <div className="flex justify-between gap-4 text-sm">
                    <span>Tổng kiểm tra:</span>
                    <span className="font-medium">{ws.total.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between gap-4 text-sm">
                    <span>Số lỗi (NG):</span>
                    <span className="font-medium text-red-500">{ws.ng.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between gap-4 text-sm">
                    <span>Tỉ lệ NG:</span>
                    <span className={cn("font-bold", getNGColorClass(ws.ngRate).split(" ")[0])}>
                      {ws.ngRate.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pt-1 border-t">
                    {status.icon}
                    <span className="text-xs">{status.label}</span>
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

// Measurement Point NG List Component
export function MeasurementPointNGList({
  data,
  className,
  maxItems = 10,
  showWorkstation = true,
}: {
  data: MeasurementPointNGData[];
  className?: string;
  maxItems?: number;
  showWorkstation?: boolean;
}) {
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => b.ngRate - a.ngRate).slice(0, maxItems);
  }, [data, maxItems]);

  if (data.length === 0) {
    return (
      <div className={cn("text-center py-8 text-muted-foreground", className)}>
        <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>Không có dữ liệu điểm đo</p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {sortedData.map((mp, index) => {
        const status = getNGStatus(mp.ngRate);
        return (
          <div
            key={mp.id}
            className={cn(
              "flex items-center gap-3 p-3 rounded-lg border transition-colors hover:bg-muted/50",
              getNGBgClass(mp.ngRate)
            )}
          >
            {/* Rank */}
            <div className={cn(
              "flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold",
              index < 3 ? "bg-red-500/20 text-red-500" : "bg-muted text-muted-foreground"
            )}>
              {index + 1}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium truncate">{mp.name}</p>
                <Badge variant="outline" className="text-xs shrink-0">
                  {mp.code}
                </Badge>
              </div>
              {showWorkstation && mp.workstationName && (
                <p className="text-xs text-muted-foreground truncate">
                  Công trạm: {mp.workstationName}
                </p>
              )}
            </div>

            {/* Stats */}
            <div className="text-right shrink-0">
              <div className="flex items-center gap-2">
                {status.icon}
                <span className={cn("font-bold text-lg", getNGColorClass(mp.ngRate).split(" ")[0])}>
                  {mp.ngRate.toFixed(1)}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {mp.ng.toLocaleString()} / {mp.total.toLocaleString()}
              </p>
            </div>

            {/* Trend */}
            {mp.trend && (
              <div className="shrink-0">
                {getTrendIcon(mp.trend)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Combined NG Visual Reflect Component
export default function NGVisualReflect({
  workstationData = [],
  measurementPointData = [],
  className,
  showLegend = true,
  compact = false,
}: NGVisualReflectProps) {
  return (
    <div className={cn("space-y-6", className)}>
      {/* Legend */}
      {showLegend && (
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="text-muted-foreground">Mức độ NG:</span>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-green-500" />
            <span>≤2% (Tốt)</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-yellow-500" />
            <span>2-5% (Chấp nhận)</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-orange-500" />
            <span>5-10% (Cảnh báo)</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-red-500" />
            <span>&gt;10% (Nghiêm trọng)</span>
          </div>
        </div>
      )}

      {/* Workstation Heatmap */}
      {workstationData.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Tỉ lệ NG theo Công trạm</CardTitle>
            <CardDescription>
              Hiển thị tỉ lệ lỗi của từng công trạm, màu sắc thể hiện mức độ nghiêm trọng
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WorkstationNGHeatmap data={workstationData} compact={compact} />
          </CardContent>
        </Card>
      )}

      {/* Measurement Point List */}
      {measurementPointData.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Top Điểm đo có tỉ lệ NG cao</CardTitle>
            <CardDescription>
              Các điểm đo có tỉ lệ lỗi cao nhất, cần ưu tiên kiểm tra và cải thiện
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MeasurementPointNGList data={measurementPointData} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Export individual components
export { getNGColor, getNGColorClass, getNGBgClass, getNGStatus };
