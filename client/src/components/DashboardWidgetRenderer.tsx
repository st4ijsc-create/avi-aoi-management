/**
 * DashboardWidgetRenderer - renders real widget content based on type & config
 * Connects to tRPC data sources for live data
 */
import { useMemo, useState, useEffect } from "react";
import { useTranslation } from 'react-i18next';
import { trpc } from "@/lib/trpc";
import { isScopeEmpty } from "@/lib/scopeEmpty";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Cpu,
  Clock,
  Target,
  BarChart3,
  Loader2,
  Wifi,
  WifiOff,
  Info,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ---- types ----
interface WidgetRendererProps {
  type: string;
  config: Record<string, any>;
  size: "small" | "medium" | "large" | "full";
  /** auto-refresh interval in seconds (0 = disabled) */
  autoRefreshInterval?: number;
}

// ---- color palette ----
const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];
const STATUS_COLORS: Record<string, string> = {
  ok: "#10b981",
  ng: "#ef4444",
  ntf: "#f59e0b",
};

// ---- helpers ----
function getRefetchInterval(config: Record<string, any>, fallback: number): number | false {
  const v = config.autoRefresh ? (config.refreshInterval || 30) * 1000 : fallback * 1000;
  return v > 0 ? v : false;
}

function getDateRange(timeRange: string): { startDate: Date; endDate: Date } {
  const end = new Date();
  const start = new Date();
  switch (timeRange) {
    case "7d":
      start.setDate(start.getDate() - 7);
      break;
    case "30d":
      start.setDate(start.getDate() - 30);
      break;
    case "today":
    default:
      start.setHours(0, 0, 0, 0);
      break;
  }
  return { startDate: start, endDate: end };
}

function formatPercent(v: number | undefined | null): string {
  if (v == null || isNaN(v)) return "—";
  return `${v.toFixed(1)}%`;
}

function formatNumber(v: number | undefined | null): string {
  if (v == null || isNaN(v)) return "—";
  return v.toLocaleString();
}

// ---- loading / error states ----
function WidgetLoading() {
  const { t } = useTranslation();
  return (
    <div className="h-full flex items-center justify-center text-muted-foreground">
      <Loader2 className="w-5 h-5 animate-spin mr-2" />
      <span className="text-xs">{t('dashboard.loading')}</span>
    </div>
  );
}

function WidgetError({ message }: { message?: string }) {
  const { t } = useTranslation();
  return (
    <div className="h-full flex items-center justify-center text-destructive">
      <AlertTriangle className="w-4 h-4 mr-1" />
      <span className="text-xs">{message || t('dashboard.errorLoadData')}</span>
    </div>
  );
}

/**
 * ⚠ 2026-08-17 — ô rỗng của widget nói ĐÚNG LÝ DO khi phạm vi rỗng.
 *
 * Không có `reason` (hoặc `reason` là null) thì câu cũ giữ nguyên: một widget của dây chuyền
 * thật sự chưa chạy VẪN phải nói "chưa có dữ liệu". Chỉ khi máy chủ khai
 * `scopeEmptyReason="no_factory_assignment"` thì ô này mới đổi câu.
 */
function WidgetEmpty({ reason }: { reason?: string | null } = {}) {
  const { t } = useTranslation();
  const scopeEmpty = isScopeEmpty(reason);
  return (
    <div className={`h-full flex items-center justify-center ${scopeEmpty ? "text-warning" : "text-muted-foreground"}`}>
      {scopeEmpty ? <AlertTriangle className="w-4 h-4 mr-1" /> : <Info className="w-4 h-4 mr-1" />}
      <span className="text-xs">{scopeEmpty ? t('common.scopeEmpty.badge') : t('dashboard.noData')}</span>
    </div>
  );
}

// ============================================================
// WIDGET RENDERERS
// ============================================================

// ---- Yield Rate Widget ----
function YieldRateWidget({ config, size }: { config: Record<string, any>; size: string }) {
  const timeRange = config.timeRange || "today";
  const { startDate, endDate } = getDateRange(timeRange);
  const targetYield = Number(config.targetYield) || 95;
  const accentColor = config.color || "#3b82f6";

  const { data: stats, isLoading, isError } = trpc.dashboard.getStatsWithComparison.useQuery(
    { startDate, endDate },
    { refetchInterval: getRefetchInterval(config, 30) }
  );

  if (isLoading) return <WidgetLoading />;
  if (isError || !stats) return <WidgetError />;
  // ⚠ 0% tỷ lệ đạt của một phạm vi rỗng KHÔNG phải một phép đo — đừng vẽ nó thành đồng hồ.
  if (isScopeEmpty(((stats as any).current ?? {}).scopeEmptyReason)) {
    return <WidgetEmpty reason={((stats as any).current ?? {}).scopeEmptyReason} />;
  }

  const current = (stats as any).current as { yieldRate: number; total: number; ok: number; ng: number; ntf: number } | undefined;
  const trends = (stats as any).trends as { fpy: number } | null | undefined;
  const yieldRate = current?.yieldRate ?? 0;
  const trend = trends?.fpy ?? 0;
  const isAboveTarget = yieldRate >= targetYield;

  // gauge arc (180 deg semicircle)
  const pct = Math.min(yieldRate, 100) / 100;
  const radius = 50;
  const circumference = Math.PI * radius;
  const offset = circumference * (1 - pct);

  return (
    <div className="h-full flex flex-col items-center justify-center gap-1 px-2">
      {/* Gauge */}
      <svg viewBox="0 0 120 70" className="w-full max-w-40">
        {/* background arc */}
        <path
          d="M 10 65 A 50 50 0 0 1 110 65"
          fill="none"
          stroke="currentColor"
          className="text-muted/20"
          strokeWidth="8"
          strokeLinecap="round"
        />
        {/* value arc */}
        <path
          d="M 10 65 A 50 50 0 0 1 110 65"
          fill="none"
          stroke={isAboveTarget ? "#10b981" : "#ef4444"}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={`${offset}`}
        />
        <text x="60" y="58" textAnchor="middle" className="text-xl font-bold" fill="currentColor" fontSize="18">
          {formatPercent(yieldRate)}
        </text>
      </svg>

      <div className="flex items-center gap-1 text-xs">
        {config.showTrend !== false && trend !== 0 && (
          <span className={`flex items-center gap-0.5 ${trend > 0 ? "text-green-600" : "text-red-500"}`}>
            {trend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
        <span className="text-muted-foreground">
          Target: {targetYield}%
        </span>
      </div>

      {size !== "small" && current && (
        <div className="flex gap-3 text-xs text-muted-foreground mt-1">
          <span className="text-green-600">OK {formatNumber(current.ok)}</span>
          <span className="text-red-500">NG {formatNumber(current.ng)}</span>
          <span className="text-amber-500">NTF {formatNumber(current.ntf)}</span>
        </div>
      )}
    </div>
  );
}

// ---- Production Volume Widget ----
function ProductionVolumeWidget({ config, size }: { config: Record<string, any>; size: string }) {
  const { t } = useTranslation();
  const timeRange = config.timeRange || "7d";
  const days = timeRange === "today" ? 1 : timeRange === "7d" ? 7 : 30;
  const showStacked = config.showStacked !== false;

  const { data, isLoading, isError } = trpc.dashboard.getDailyStats.useQuery(
    { days },
    { refetchInterval: getRefetchInterval(config, 60) }
  );

  if (isLoading) return <WidgetLoading />;
  if (isError) return <WidgetError />;

  const chartData = Array.isArray(data)
    ? data.map((d: any) => ({
        date: d.date ? new Date(d.date).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }) : "",
        OK: Number(d.ok) || 0,
        NG: Number(d.ng) || 0,
        NTF: Number(d.ntf) || 0,
        total: Number(d.total) || 0,
      }))
    : [];

  if (chartData.length === 0) return <WidgetEmpty />;

  const totalProduction = chartData.reduce((s, d) => s + d.total, 0);

  return (
    <div className="h-full flex flex-col">
      {config.showTotal !== false && (
        <div className="text-sm font-semibold mb-1 px-1">
          {t('common.total')}: {formatNumber(totalProduction)}
        </div>
      )}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--foreground)' }} axisLine={{ stroke: 'var(--border)' }} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--foreground)' }} axisLine={{ stroke: 'var(--border)' }} />
            <RechartsTooltip contentStyle={{ fontSize: 12, backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
            {showStacked ? (
              <>
                <Bar dataKey="OK" stackId="a" fill={STATUS_COLORS.ok} radius={[0, 0, 0, 0]} />
                <Bar dataKey="NG" stackId="a" fill={STATUS_COLORS.ng} />
                <Bar dataKey="NTF" stackId="a" fill={STATUS_COLORS.ntf} radius={[2, 2, 0, 0]} />
              </>
            ) : (
              <Bar dataKey="total" fill={CHART_COLORS[0]} radius={[2, 2, 0, 0]} />
            )}
            {size !== "small" && <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---- Machine Status Widget ----
function MachineStatusWidget({ config, size }: { config: Record<string, any>; size: string }) {
  const { t } = useTranslation();
  const displayMode = config.displayMode || "grid";

  const { data, isLoading, isError } = trpc.dashboard.getAllMachinesStats.useQuery(
    {},
    { refetchInterval: getRefetchInterval(config, 30) }
  );

  if (isLoading) return <WidgetLoading />;
  if (isError) return <WidgetError />;

  const machines = Array.isArray(data) ? data : [];
  if (machines.length === 0) return <WidgetEmpty />;

  const total = machines.length;
  const active = machines.filter((m: any) => (m.stats?.total ?? 0) > 0).length;

  if (displayMode === "compact") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-primary" />
          <span className="text-2xl font-bold">{active}/{total}</span>
        </div>
        <span className="text-xs text-muted-foreground">{t('dashboard.machinesActive')}</span>
      </div>
    );
  }

  if (displayMode === "list") {
    return (
      <ScrollArea className="h-full">
        <div className="space-y-1 pr-2">
          {machines.slice(0, 20).map((m: any, i: number) => {
            const isActive = (m.stats?.total ?? 0) > 0;
            return (
              <div key={m.machine?.id ?? i} className="flex items-center justify-between text-xs p-1.5 rounded hover:bg-muted/50">
                <div className="flex items-center gap-2">
                  {isActive ? <Wifi className="w-3 h-3 text-green-500" /> : <WifiOff className="w-3 h-3 text-muted-foreground" />}
                  <span className="font-medium truncate max-w-30">{m.machine?.name || `Machine ${i + 1}`}</span>
                </div>
                <div className="flex gap-2 text-muted-foreground">
                  <span className="text-green-600">{m.stats?.ok ?? 0}</span>
                  <span className="text-red-500">{m.stats?.ng ?? 0}</span>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    );
  }

  // grid mode (default)
  return (
    <div className="h-full flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><Wifi className="w-3 h-3 text-green-500" /> {active} active</span>
        <span className="flex items-center gap-1"><WifiOff className="w-3 h-3" /> {total - active} idle</span>
      </div>
      <div className="flex-1 grid grid-cols-4 gap-1 auto-rows-min overflow-hidden">
        {machines.slice(0, size === "small" ? 8 : size === "medium" ? 16 : 32).map((m: any, i: number) => {
          const isActive = (m.stats?.total ?? 0) > 0;
          const yr = m.stats?.yieldRate ?? 0;
          return (
            <div
              key={m.machine?.id ?? i}
              className={`p-1 rounded text-center text-[10px] border ${
                isActive
                  ? yr >= 95
                    ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800"
                    : yr >= 85
                    ? "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800"
                    : "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800"
                  : "bg-muted/50 border-muted"
              }`}
              title={`${m.machine?.name || ""}: ${yr.toFixed(1)}%`}
            >
              <div className="truncate font-medium">{m.machine?.code || `M${i + 1}`}</div>
              {isActive && <div className="text-[9px]">{yr.toFixed(0)}%</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Recent Alerts Widget ----
function RecentAlertsWidget({ config, size }: { config: Record<string, any>; size: string }) {
  const { t } = useTranslation();
  const maxItems = Number(config.maxItems) || 10;

  const { data: alertCount, isLoading } = trpc.dashboard.getActiveAlertsCount.useQuery(
    undefined,
    { refetchInterval: getRefetchInterval(config, 15) }
  );

  // Also use latest inspections with NG results as "alerts"
  const { data: recentNG } = trpc.inspection.list.useQuery(
    { result: "NG", limit: maxItems },
    { refetchInterval: getRefetchInterval(config, 15) }
  );

  if (isLoading) return <WidgetLoading />;

  const ngItems = Array.isArray(recentNG)
    ? recentNG
    : Array.isArray((recentNG as any)?.inspections)
    ? (recentNG as any).inspections
    : [];

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <Badge variant="destructive" className="text-xs">
          <AlertTriangle className="w-3 h-3 mr-1" />
          {typeof alertCount === "number" ? alertCount : (alertCount as any)?.count ?? 0} active
        </Badge>
      </div>
      {ngItems.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          <CheckCircle2 className="w-4 h-4 mr-1 text-green-500" /> {t('dashboard.noAlerts')}
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="space-y-1.5 pr-2">
            {ngItems.slice(0, maxItems).map((item: any, i: number) => (
              <div
                key={item.id ?? i}
                className="flex items-start gap-2 text-xs p-1.5 rounded bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900"
              >
                <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {item.serialNumber || `Alert #${item.id}`}
                  </div>
                  {config.showTimestamp !== false && item.createdAt && (
                    <div className="text-muted-foreground text-[10px]">
                      {new Date(item.createdAt).toLocaleString("vi-VN")}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// ---- Top NG Points Widget ----
function TopNGPointsWidget({ config, size }: { config: Record<string, any>; size: string }) {
  const topN = Number(config.topN) || 10;
  const timeRange = config.timeRange || "30d";
  const { startDate, endDate } = getDateRange(timeRange);

  // Use daily stats to derive NG info, or top/bottom machines as proxy
  const { data: topBottom, isLoading, isError } = trpc.dashboard.getTopBottomMachines.useQuery(
    { startDate, endDate, limit: topN },
    { refetchInterval: getRefetchInterval(config, 60) }
  );

  if (isLoading) return <WidgetLoading />;
  if (isError) return <WidgetError />;

  // bottom machines (highest NG rate = lowest yield)
  const bottomMachines: Array<{ name: string; ng: number; total: number; ngRate: number }> = [];
  if ((topBottom as any)?.bottom) {
    (topBottom as any).bottom.forEach((m: any) => {
      bottomMachines.push({
        name: m.name || m.code || `M${m.id}`,
        ng: Number(m.ng) || 0,
        total: Number(m.total) || 0,
        ngRate: m.total > 0 ? ((m.ng / m.total) * 100) : 0,
      });
    });
  }

  if (bottomMachines.length === 0) return <WidgetEmpty reason={(topBottom as any)?.scopeEmptyReason} />;

  // sort by NG count desc
  bottomMachines.sort((a, b) => b.ng - a.ng);

  // pareto cumulative
  const totalNG = bottomMachines.reduce((s, m) => s + m.ng, 0);
  let cumulative = 0;
  const chartData = bottomMachines.slice(0, topN).map((m) => {
    cumulative += m.ng;
    return {
      name: m.name.length > 10 ? m.name.slice(0, 10) + "…" : m.name,
      NG: m.ng,
      cumPct: totalNG > 0 ? ((cumulative / totalNG) * 100) : 0,
    };
  });

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: config.showPareto ? 30 : 4, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
            <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--foreground)' }} interval={0} angle={-30} textAnchor="end" height={50} axisLine={{ stroke: 'var(--border)' }} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--foreground)' }} axisLine={{ stroke: 'var(--border)' }} />
            <RechartsTooltip contentStyle={{ fontSize: 12, backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
            <Bar yAxisId="left" dataKey="NG" fill="#ef4444" radius={[2, 2, 0, 0]} />
            {config.showPareto !== false && (
              <>
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Line yAxisId="right" type="monotone" dataKey="cumPct" stroke="#f59e0b" dot={false} strokeWidth={2} />
              </>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---- Throughput Widget ----
function ThroughputWidget({ config, size }: { config: Record<string, any>; size: string }) {
  const { t } = useTranslation();
  const timeRange = config.timeRange || "today";
  const { startDate, endDate } = getDateRange(timeRange);
  const unit = config.unit || "per_hour";
  const targetValue = Number(config.targetValue) || 0;

  const { data: stats, isLoading, isError } = trpc.dashboard.getStats.useQuery(
    { startDate, endDate },
    { refetchInterval: getRefetchInterval(config, 30) }
  );

  const { data: hourlyData } = trpc.dashboard.getHourlyStats.useQuery(
    { hours: 24 },
    { refetchInterval: getRefetchInterval(config, 60) }
  );

  if (isLoading) return <WidgetLoading />;
  if (isError || !stats) return <WidgetError />;
  // ⚠ Phạm vi rỗng KHÔNG phải lỗi tải — trước bản vá nó rơi vào ô đỏ ở dòng trên khi `stats`
  // vắng, và người dùng đi báo hỏng hệ thống.
  if (isScopeEmpty((stats as any).scopeEmptyReason)) return <WidgetEmpty reason={(stats as any).scopeEmptyReason} />;

  const total = (stats as any)?.total ?? 0;
  const hoursElapsed = Math.max(1, (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60));
  const shiftsElapsed = Math.max(1, hoursElapsed / 8);
  const daysElapsed = Math.max(1, hoursElapsed / 24);

  let throughput: number;
  let unitLabel: string;
  switch (unit) {
    case "per_shift":
      throughput = total / shiftsElapsed;
      unitLabel = t('dashboard.perShift');
      break;
    case "per_day":
      throughput = total / daysElapsed;
      unitLabel = t('dashboard.perDay');
      break;
    default:
      throughput = total / hoursElapsed;
      unitLabel = t('dashboard.perHour');
  }

  const hourly = Array.isArray(hourlyData)
    ? hourlyData.map((h: any) => ({
        hour: h.hour ?? h.label ?? "",
        value: Number(h.total) || 0,
      }))
    : [];

  return (
    <div className="h-full flex flex-col items-center justify-center gap-2">
      <div className="text-3xl font-bold">{Math.round(throughput)}</div>
      <div className="text-xs text-muted-foreground">{t('dashboard.products')}{unitLabel}</div>

      {config.showTarget && targetValue > 0 && (
        <div className={`text-xs flex items-center gap-1 ${throughput >= targetValue ? "text-green-600" : "text-red-500"}`}>
          <Target className="w-3 h-3" />
          {throughput >= targetValue ? t('dashboard.achieved') : t('dashboard.notAchieved')} {t('dashboard.target')} ({targetValue})
        </div>
      )}

      {hourly.length > 0 && size !== "small" && (
        <div className="w-full flex-1 min-h-0 max-h-20">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={hourly.slice(-12)} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
              <Area type="monotone" dataKey="value" fill="#3b82f6" fillOpacity={0.15} stroke="#3b82f6" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ---- KPI Card Widget ----
function KPICardWidget({ config }: { config: Record<string, any> }) {
  const timeRange = config.timeRange || "today";
  const { startDate, endDate } = getDateRange(timeRange);
  const metric = config.metric || "total";

  const { data: stats, isLoading } = trpc.dashboard.getStatsWithComparison.useQuery(
    { startDate, endDate },
    { refetchInterval: getRefetchInterval(config, 30) }
  );

  if (isLoading) return <WidgetLoading />;
  if (!stats) return <WidgetEmpty />;
  if (isScopeEmpty(((stats as any).current ?? {}).scopeEmptyReason)) {
    return <WidgetEmpty reason={((stats as any).current ?? {}).scopeEmptyReason} />;
  }

  const current = (stats as any).current;
  const trends = (stats as any).trends;
  const value = current?.[metric] ?? current?.total ?? 0;
  const trend = trends?.[metric === "yieldRate" ? "fpy" : metric === "total" ? "output" : metric] ?? 0;

  return (
    <div className="h-full flex flex-col items-center justify-center gap-1">
      <div className="text-3xl font-bold">
        {metric === "yieldRate" ? formatPercent(value) : formatNumber(value)}
      </div>
      <div className="text-xs text-muted-foreground capitalize">
        {config.label || metric.replace(/([A-Z])/g, " $1")}
      </div>
      {trend !== 0 && (
        <div className={`text-xs flex items-center gap-0.5 ${trend > 0 ? "text-green-600" : "text-red-500"}`}>
          {trend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {Math.abs(trend).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

// ---- Bar Chart Widget ----
function BarChartWidget({ config, size }: { config: Record<string, any>; size: string }) {
  const days = Number(config.days) || 7;
  const { data, isLoading } = trpc.dashboard.getDailyStats.useQuery(
    { days },
    { refetchInterval: getRefetchInterval(config, 60) }
  );

  if (isLoading) return <WidgetLoading />;

  const chartData = Array.isArray(data)
    ? data.map((d: any) => ({
        label: d.date ? new Date(d.date).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }) : "",
        value: Number(d[config.dataKey || "total"]) || 0,
      }))
    : [];

  if (chartData.length === 0) return <WidgetEmpty />;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--foreground)' }} axisLine={{ stroke: 'var(--border)' }} />
        <YAxis tick={{ fontSize: 10, fill: 'var(--foreground)' }} axisLine={{ stroke: 'var(--border)' }} />
        <RechartsTooltip contentStyle={{ fontSize: 12, backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
        <Bar dataKey="value" fill={config.color || CHART_COLORS[0]} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---- Line Chart Widget ----
function LineChartWidget({ config, size }: { config: Record<string, any>; size: string }) {
  const days = Number(config.days) || 7;
  const { data, isLoading } = trpc.dashboard.getDailyStats.useQuery(
    { days },
    { refetchInterval: getRefetchInterval(config, 60) }
  );

  if (isLoading) return <WidgetLoading />;

  const chartData = Array.isArray(data)
    ? data.map((d: any) => ({
        label: d.date ? new Date(d.date).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }) : "",
        value: Number(d[config.dataKey || "total"]) || 0,
      }))
    : [];

  if (chartData.length === 0) return <WidgetEmpty />;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--foreground)' }} axisLine={{ stroke: 'var(--border)' }} />
        <YAxis tick={{ fontSize: 10, fill: 'var(--foreground)' }} axisLine={{ stroke: 'var(--border)' }} />
        <RechartsTooltip contentStyle={{ fontSize: 12, backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
        <Line type="monotone" dataKey="value" stroke={config.color || CHART_COLORS[0]} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ---- Pie Chart Widget ----
function PieChartWidget({ config }: { config: Record<string, any> }) {
  const timeRange = config.timeRange || "today";
  const { startDate, endDate } = getDateRange(timeRange);

  const { data: stats, isLoading } = trpc.dashboard.getStats.useQuery(
    { startDate, endDate },
    { refetchInterval: getRefetchInterval(config, 30) }
  );

  if (isLoading) return <WidgetLoading />;
  if (!stats) return <WidgetEmpty />;
  if (isScopeEmpty((stats as any).scopeEmptyReason)) return <WidgetEmpty reason={(stats as any).scopeEmptyReason} />;

  const s = stats as any;
  const pieData = [
    { name: "OK", value: Number(s.ok) || 0, color: STATUS_COLORS.ok },
    { name: "NG", value: Number(s.ng) || 0, color: STATUS_COLORS.ng },
    { name: "NTF", value: Number(s.ntf) || 0, color: STATUS_COLORS.ntf },
  ].filter(d => d.value > 0);

  if (pieData.length === 0) return <WidgetEmpty reason={(stats as any).scopeEmptyReason} />;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={pieData}
          cx="50%"
          cy="50%"
          innerRadius="40%"
          outerRadius="75%"
          dataKey="value"
          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
          labelLine={false}
        >
          {pieData.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Pie>
        <RechartsTooltip contentStyle={{ fontSize: 12, backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ---- Gauge Widget ----
function GaugeWidget({ config }: { config: Record<string, any> }) {
  const timeRange = config.timeRange || "today";
  const { startDate, endDate } = getDateRange(timeRange);

  const { data: stats, isLoading } = trpc.dashboard.getStats.useQuery(
    { startDate, endDate },
    { refetchInterval: getRefetchInterval(config, 30) }
  );

  if (isLoading) return <WidgetLoading />;
  if (!stats) return <WidgetEmpty />;
  if (isScopeEmpty((stats as any).scopeEmptyReason)) return <WidgetEmpty reason={(stats as any).scopeEmptyReason} />;

  const value = (stats as any)?.yieldRate ?? 0;
  const min = Number(config.min) || 0;
  const max = Number(config.max) || 100;
  const pct = Math.min(Math.max((value - min) / (max - min), 0), 1);

  const color = pct >= 0.95 ? "#10b981" : pct >= 0.85 ? "#f59e0b" : "#ef4444";

  return (
    <div className="h-full flex flex-col items-center justify-center">
      <svg viewBox="0 0 120 80" className="w-full max-w-45">
        <path d="M 10 70 A 50 50 0 0 1 110 70" fill="none" stroke="currentColor" className="text-muted/20" strokeWidth="10" strokeLinecap="round" />
        <path
          d="M 10 70 A 50 50 0 0 1 110 70"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${Math.PI * 50}`}
          strokeDashoffset={`${Math.PI * 50 * (1 - pct)}`}
        />
        <text x="60" y="65" textAnchor="middle" fill="currentColor" fontSize="20" fontWeight="bold">
          {value.toFixed(1)}%
        </text>
      </svg>
      <div className="text-xs text-muted-foreground mt-1">{config.label || "Yield Rate"}</div>
    </div>
  );
}

// ---- Table Widget ----
function TableWidget({ config }: { config: Record<string, any> }) {
  const { t } = useTranslation();
  const limit = Number(config.limit) || 10;

  const { data, isLoading } = trpc.inspection.list.useQuery(
    { limit },
    { refetchInterval: getRefetchInterval(config, 30) }
  );

  if (isLoading) return <WidgetLoading />;

  const items = Array.isArray(data)
    ? data
    : Array.isArray((data as any)?.inspections)
    ? (data as any).inspections
    : [];

  if (items.length === 0) return <WidgetEmpty />;

  return (
    <ScrollArea className="h-full">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="text-left p-1">S/N</th>
            <th className="text-left p-1">{t('dashboard.result')}</th>
            <th className="text-left p-1">{t('dashboard.time')}</th>
          </tr>
        </thead>
        <tbody>
          {items.slice(0, limit).map((item: any, i: number) => (
            <tr key={item.id ?? i} className="border-b border-muted/30 hover:bg-muted/30">
              <td className="p-1 font-mono truncate max-w-25">{item.serialNumber || "—"}</td>
              <td className="p-1">
                <Badge variant={item.overallResult === "OK" ? "default" : "destructive"} className="text-[10px] px-1 py-0">
                  {item.overallResult}
                </Badge>
              </td>
              <td className="p-1 text-muted-foreground">
                {item.createdAt ? new Date(item.createdAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}

// ---- Alert List Widget ----
function AlertListWidget({ config }: { config: Record<string, any> }) {
  return <RecentAlertsWidget config={config} size="medium" />;
}

// ---- Activity Feed Widget ----
function ActivityFeedWidget({ config }: { config: Record<string, any> }) {
  const limit = Number(config.limit) || 10;

  const { data, isLoading } = trpc.inspection.list.useQuery(
    { limit },
    { refetchInterval: getRefetchInterval(config, 15) }
  );

  if (isLoading) return <WidgetLoading />;

  const items = Array.isArray(data)
    ? data
    : Array.isArray((data as any)?.inspections)
    ? (data as any).inspections
    : [];

  if (items.length === 0) return <WidgetEmpty />;

  return (
    <ScrollArea className="h-full">
      <div className="space-y-1.5 pr-2">
        {items.slice(0, limit).map((item: any, i: number) => (
          <div key={item.id ?? i} className="flex items-start gap-2 text-xs p-1.5">
            <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${
              item.overallResult === "OK" ? "bg-green-500" : item.overallResult === "NG" ? "bg-red-500" : "bg-amber-500"
            }`} />
            <div className="flex-1 min-w-0">
              <span className="font-medium">{item.serialNumber || "—"}</span>
              <span className="text-muted-foreground"> — {item.overallResult}</span>
              {item.createdAt && (
                <div className="text-[10px] text-muted-foreground">
                  {new Date(item.createdAt).toLocaleString("vi-VN")}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

// ---- Trend Indicator Widget ----
function TrendIndicatorWidget({ config }: { config: Record<string, any> }) {
  const { t } = useTranslation();
  const timeRange = config.timeRange || "today";
  const { startDate, endDate } = getDateRange(timeRange);

  const { data: stats, isLoading } = trpc.dashboard.getStatsWithComparison.useQuery(
    { startDate, endDate },
    { refetchInterval: getRefetchInterval(config, 30) }
  );

  if (isLoading) return <WidgetLoading />;
  if (!stats) return <WidgetEmpty />;

  const trendScopeReason = ((stats as any).current ?? {}).scopeEmptyReason;
  const trends = (stats as any).trends;
  if (isScopeEmpty(trendScopeReason) || !trends) return <WidgetEmpty reason={trendScopeReason} />;

  const items = [
    { label: t('dashboard.output'), value: trends.output, icon: <Activity className="w-3 h-3" /> },
    { label: "FPY", value: trends.fpy, icon: <Target className="w-3 h-3" /> },
    { label: "OK", value: trends.ok, icon: <CheckCircle2 className="w-3 h-3" /> },
    { label: "NG", value: trends.ng, icon: <XCircle className="w-3 h-3" />, invert: true },
  ];

  return (
    <div className="h-full flex flex-col justify-center gap-2 px-1">
      {items.map((item, i) => (
        <div key={i} className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            {item.icon}
            <span>{item.label}</span>
          </div>
          <div
            className={`flex items-center gap-0.5 font-medium ${
              (item.invert ? -item.value : item.value) > 0
                ? "text-green-600"
                : item.value < 0
                ? "text-red-500"
                : "text-muted-foreground"
            }`}
          >
            {item.value > 0 ? (
              <TrendingUp className="w-3 h-3" />
            ) : item.value < 0 ? (
              <TrendingDown className="w-3 h-3" />
            ) : (
              <Minus className="w-3 h-3" />
            )}
            {Math.abs(item.value).toFixed(1)}%
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Clock Widget ----
function ClockWidget({ config }: { config: Record<string, any> }) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const format = config.format || "24h";
  const showDate = config.showDate !== false;
  const showSeconds = config.showSeconds !== false;

  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    ...(showSeconds ? { second: "2-digit" } : {}),
    hour12: format === "12h",
  };

  return (
    <div className="h-full flex flex-col items-center justify-center gap-1">
      <Clock className="w-5 h-5 text-muted-foreground mb-1" />
      <div className="text-2xl font-mono font-bold tabular-nums">
        {time.toLocaleTimeString("vi-VN", options)}
      </div>
      {showDate && (
        <div className="text-xs text-muted-foreground">
          {time.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })}
        </div>
      )}
    </div>
  );
}

// ---- Target Progress Widget ----
function TargetProgressWidget({ config }: { config: Record<string, any> }) {
  const { t } = useTranslation();
  const timeRange = config.timeRange || "today";
  const { startDate, endDate } = getDateRange(timeRange);
  const target = Number(config.target) || 1000;

  const { data: stats, isLoading } = trpc.dashboard.getStats.useQuery(
    { startDate, endDate },
    { refetchInterval: getRefetchInterval(config, 30) }
  );

  if (isLoading) return <WidgetLoading />;
  if (!stats) return <WidgetEmpty />;
  if (isScopeEmpty((stats as any).scopeEmptyReason)) return <WidgetEmpty reason={(stats as any).scopeEmptyReason} />;

  const current = (stats as any)?.total ?? 0;
  const pct = Math.min((current / target) * 100, 100);
  const isOnTrack = pct >= 50; // rough heuristic

  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 px-4">
      <div className="text-sm text-muted-foreground">
        {formatNumber(current)} / {formatNumber(target)}
      </div>

      {/* progress bar */}
      <div className="w-full bg-muted rounded-full h-4 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-green-500" : pct >= 70 ? "bg-blue-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="text-lg font-bold">{pct.toFixed(1)}%</div>
      <div className="text-xs text-muted-foreground">{config.label || "Tiến độ mục tiêu"}</div>
    </div>
  );
}

// ---- Map Widget (placeholder) ----
function MapWidget() {
  const { t } = useTranslation();
  return (
    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
      <BarChart3 className="w-5 h-5 mr-2" />
      {t('dashboard.factoryMap')}
    </div>
  );
}

// ============================================================
// MAIN RENDERER
// ============================================================

export default function DashboardWidgetRenderer({ type, config, size, autoRefreshInterval }: WidgetRendererProps) {
  const mergedConfig = useMemo(() => ({
    ...config,
    ...(autoRefreshInterval && autoRefreshInterval > 0 ? { autoRefresh: true, refreshInterval: autoRefreshInterval } : {}),
  }), [config, autoRefreshInterval]);

  switch (type) {
    case "yield-rate":
      return <YieldRateWidget config={mergedConfig} size={size} />;
    case "production-volume":
      return <ProductionVolumeWidget config={mergedConfig} size={size} />;
    case "machine-status":
      return <MachineStatusWidget config={mergedConfig} size={size} />;
    case "recent-alerts":
      return <RecentAlertsWidget config={mergedConfig} size={size} />;
    case "top-ng-points":
      return <TopNGPointsWidget config={mergedConfig} size={size} />;
    case "throughput":
      return <ThroughputWidget config={mergedConfig} size={size} />;
    case "kpi-card":
      return <KPICardWidget config={mergedConfig} />;
    case "bar-chart":
      return <BarChartWidget config={mergedConfig} size={size} />;
    case "line-chart":
      return <LineChartWidget config={mergedConfig} size={size} />;
    case "pie-chart":
      return <PieChartWidget config={mergedConfig} />;
    case "gauge":
      return <GaugeWidget config={mergedConfig} />;
    case "table":
      return <TableWidget config={mergedConfig} />;
    case "alert-list":
      return <AlertListWidget config={mergedConfig} />;
    case "activity-feed":
      return <ActivityFeedWidget config={mergedConfig} />;
    case "trend-indicator":
      return <TrendIndicatorWidget config={mergedConfig} />;
    case "clock":
      return <ClockWidget config={mergedConfig} />;
    case "target-progress":
      return <TargetProgressWidget config={mergedConfig} />;
    case "map":
      return <MapWidget />;
    default:
      return (
        <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
          [{type}]
        </div>
      );
  }
}
