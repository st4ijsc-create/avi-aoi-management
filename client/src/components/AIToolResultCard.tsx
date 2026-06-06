/**
 * AIToolResultCard
 *
 * Renders structured real-time tool results returned by the local AI tool
 * registry. Dispatches by `type` to a small dedicated card.
 */

import { Activity, AlertTriangle, CheckCircle2, Database, Gauge, TrendingUp, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ToolResultPayload =
  | {
      type: "today_stats";
      title: string;
      data: {
        date: string;
        total: number;
        ok: number;
        ng: number;
        ntf: number;
        ngRate: number;
        byMachine: Array<{ machineId: number; machineName: string; total: number; ng: number; ngRate: number }>;
      };
      textSummary: string;
      note?: string;
    }
  | {
      type: "lot_status";
      title: string;
      data: {
        orderCode: string;
        status: string;
        targetQuantity: number;
        completedQuantity: number;
        okQuantity: number;
        ngQuantity: number;
        ntfQuantity: number;
        progressPct: number;
        ngRate: number;
      } | null;
      textSummary: string;
      note?: string;
    }
  | {
      type: "machine_status";
      title: string;
      data: Array<{
        id: number;
        code: string;
        name: string;
        type: string;
        operationStatus: string;
        isOnline: boolean;
        lastHeartbeat: string | null;
        minutesSinceHeartbeat: number | null;
      }>;
      textSummary: string;
      note?: string;
    }
  | {
      type: "defect_trend";
      title: string;
      data: {
        days: number;
        series: Array<{ date: string; total: number; ng: number; ngRate: number }>;
      };
      textSummary: string;
      note?: string;
    }
  | {
      type: "top_defects";
      title: string;
      data: Array<{
        pointCode: string;
        pointName: string;
        ngCount: number;
        totalCount: number;
        ngRate: number;
      }>;
      textSummary: string;
      note?: string;
    };

interface Props {
  toolResult: ToolResultPayload;
}

export function AIToolResultCard({ toolResult }: Props) {
  return (
    <div className="rounded-xl border border-primary/20 bg-background/80 p-2.5 space-y-2 text-xs">
      <div className="flex items-center gap-1.5">
        <Database className="size-3.5 text-primary" />
        <span className="font-semibold text-primary">{toolResult.title}</span>
        <Badge variant="outline" className="ml-auto h-4 px-1.5 text-[10px]">Real-time</Badge>
      </div>

      {toolResult.note === "DB_UNAVAILABLE" && (
        <div className="flex items-center gap-1.5 text-amber-600">
          <AlertTriangle className="size-3" />
          <span>Không có kết nối CSDL.</span>
        </div>
      )}

      {toolResult.note === "NOT_FOUND" && (
        <div className="text-muted-foreground italic">{toolResult.textSummary}</div>
      )}

      {toolResult.type === "today_stats" && toolResult.note !== "DB_UNAVAILABLE" && (
        <TodayStatsBody data={toolResult.data} />
      )}
      {toolResult.type === "lot_status" && toolResult.data && toolResult.note !== "DB_UNAVAILABLE" && (
        <LotStatusBody data={toolResult.data} />
      )}
      {toolResult.type === "machine_status" && toolResult.note !== "DB_UNAVAILABLE" && (
        <MachineStatusBody data={toolResult.data} />
      )}
      {toolResult.type === "defect_trend" && toolResult.note !== "DB_UNAVAILABLE" && (
        <DefectTrendBody data={toolResult.data} />
      )}
      {toolResult.type === "top_defects" && toolResult.note !== "DB_UNAVAILABLE" && (
        <TopDefectsBody data={toolResult.data} />
      )}
    </div>
  );
}

// ---- today_stats ----
function TodayStatsBody({ data }: { data: Extract<ToolResultPayload, { type: "today_stats" }>["data"] }) {
  const ngColor = data.ngRate >= 5 ? "text-red-600" : data.ngRate >= 2 ? "text-amber-600" : "text-emerald-600";
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-1.5">
        <Stat label="Tổng" value={data.total} icon={<Gauge className="size-3" />} />
        <Stat label="OK" value={data.ok} color="text-emerald-600" icon={<CheckCircle2 className="size-3" />} />
        <Stat label="NG" value={data.ng} color="text-red-600" icon={<XCircle className="size-3" />} />
        <Stat label="NTF" value={data.ntf} color="text-amber-600" icon={<AlertTriangle className="size-3" />} />
      </div>
      <div className={cn("flex items-center gap-1.5 font-medium", ngColor)}>
        <TrendingUp className="size-3" />
        Tỉ lệ NG: {data.ngRate}%
      </div>
      {data.byMachine.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-muted-foreground text-[11px]">Top máy NG:</div>
          {data.byMachine.slice(0, 3).map((m) => (
            <div key={m.machineId} className="flex items-center justify-between text-[11px]">
              <span className="truncate">{m.machineName}</span>
              <span className="text-red-600">{m.ng}/{m.total} ({m.ngRate}%)</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- lot_status ----
function LotStatusBody({ data }: { data: NonNullable<Extract<ToolResultPayload, { type: "lot_status" }>["data"]> }) {
  const statusColor: Record<string, string> = {
    completed: "bg-emerald-100 text-emerald-700",
    in_progress: "bg-blue-100 text-blue-700",
    pending: "bg-slate-100 text-slate-700",
    cancelled: "bg-red-100 text-red-700",
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="font-semibold">{data.orderCode}</span>
        <span className={cn("text-[10px] px-1.5 py-0.5 rounded", statusColor[data.status] ?? "bg-slate-100 text-slate-700")}>
          {data.status}
        </span>
      </div>
      <div>
        <div className="flex justify-between text-[11px] mb-0.5">
          <span>{data.completedQuantity} / {data.targetQuantity}</span>
          <span className="font-medium">{data.progressPct}%</span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, data.progressPct)}%` }} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="OK" value={data.okQuantity} color="text-emerald-600" />
        <Stat label="NG" value={data.ngQuantity} color="text-red-600" />
        <Stat label="NTF" value={data.ntfQuantity} color="text-amber-600" />
      </div>
      <div className="text-[11px] text-muted-foreground">Tỉ lệ NG: {data.ngRate}%</div>
    </div>
  );
}

// ---- machine_status ----
function MachineStatusBody({ data }: { data: Extract<ToolResultPayload, { type: "machine_status" }>["data"] }) {
  if (data.length === 0) {
    return <div className="text-muted-foreground italic text-[11px]">Không có máy.</div>;
  }
  return (
    <div className="space-y-1 max-h-48 overflow-y-auto">
      {data.slice(0, 12).map((m) => (
        <div key={m.id} className="flex items-center gap-1.5 text-[11px]">
          <span
            className={cn(
              "size-2 rounded-full shrink-0",
              m.isOnline ? "bg-emerald-500" : "bg-slate-400",
            )}
            title={m.isOnline ? "Online" : "Offline"}
          />
          <span className="font-mono font-medium">{m.code}</span>
          <span className="text-muted-foreground truncate flex-1">{m.name}</span>
          <Badge
            variant="outline"
            className={cn(
              "h-4 px-1 text-[9px]",
              m.operationStatus === "running" && "border-emerald-300 text-emerald-700",
              m.operationStatus === "stopped" && "border-slate-300 text-slate-700",
              m.operationStatus === "error" && "border-red-300 text-red-700",
              m.operationStatus === "maintenance" && "border-amber-300 text-amber-700",
            )}
          >
            {m.operationStatus}
          </Badge>
        </div>
      ))}
      {data.length > 12 && (
        <div className="text-[10px] text-muted-foreground italic">… +{data.length - 12} máy nữa</div>
      )}
    </div>
  );
}

// ---- defect_trend ----
function DefectTrendBody({ data }: { data: Extract<ToolResultPayload, { type: "defect_trend" }>["data"] }) {
  const max = Math.max(1, ...data.series.map((s) => s.ngRate));
  return (
    <div className="space-y-1.5">
      <div className="flex items-end gap-1 h-16">
        {data.series.map((s) => {
          const h = (s.ngRate / max) * 100;
          const color = s.ngRate >= 5 ? "bg-red-500" : s.ngRate >= 2 ? "bg-amber-500" : "bg-emerald-500";
          return (
            <div key={s.date} className="flex-1 flex flex-col items-center justify-end" title={`${s.date}: ${s.ngRate}% (${s.ng}/${s.total})`}>
              <div className={cn("w-full rounded-sm", color)} style={{ height: `${Math.max(4, h)}%` }} />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{data.series[0]?.date.slice(5) ?? ""}</span>
        <span>{data.series[data.series.length - 1]?.date.slice(5) ?? ""}</span>
      </div>
    </div>
  );
}

// ---- top_defects ----
function TopDefectsBody({ data }: { data: Extract<ToolResultPayload, { type: "top_defects" }>["data"] }) {
  if (data.length === 0) {
    return <div className="text-muted-foreground italic text-[11px]">Không có điểm đo nào lỗi.</div>;
  }
  return (
    <div className="space-y-1">
      {data.map((item, i) => (
        <div key={item.pointCode} className="flex items-center gap-1.5 text-[11px]">
          <span className="font-semibold text-primary w-4">{i + 1}.</span>
          <div className="flex-1 min-w-0">
            <div className="font-mono font-medium truncate">{item.pointCode}</div>
            <div className="text-muted-foreground truncate text-[10px]">{item.pointName}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-red-600 font-medium">{item.ngCount}/{item.totalCount}</div>
            <div className="text-[10px] text-muted-foreground">{item.ngRate}%</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- shared mini stat ----
function Stat({ label, value, color, icon }: { label: string; value: number; color?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md bg-muted/60 px-1.5 py-1 text-center">
      <div className="flex items-center justify-center gap-0.5 text-[10px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={cn("font-semibold tabular-nums", color)}>{value}</div>
    </div>
  );
}

export default AIToolResultCard;
