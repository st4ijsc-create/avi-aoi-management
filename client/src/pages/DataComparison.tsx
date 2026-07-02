import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PageHeader,
  MetricCard,
  EmptyState,
  chartColor,
  chartTooltipStyle,
  chartGridProps,
  chartAxisTick,
} from "@/components/patterns";
import { trpc } from "@/lib/trpc";
import {
  GitCompare, Minus, ArrowRight,
  Calendar, RefreshCw,
  ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import { useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, Area, AreaChart,
} from "recharts";

const PERIOD_OPTIONS = [
  { value: "week", labelKey: "reports.weekVsWeek" },
  { value: "month", labelKey: "reports.monthVsMonth" },
  { value: "quarter", labelKey: "reports.quarterVsQuarter" },
  { value: "custom", labelKey: "common.custom" },
];

const CHANGE_COLORS = {
  positive: "text-success",
  negative: "text-destructive",
  neutral: "text-muted-foreground",
};

export function DataComparisonContent() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [period, setPeriod] = useState<"week" | "month" | "quarter" | "custom">("week");
  const [customDates, setCustomDates] = useState({
    currentFrom: "",
    currentTo: "",
    previousFrom: "",
    previousTo: "",
  });
  const [factoryId, setFactoryId] = useState<number | undefined>(undefined);
  const [machineId, setMachineId] = useState<number | undefined>(undefined);

  const { data: factories } = trpc.factory.list.useQuery();

  // Compute dates from period selection
  const computedDates = useMemo(() => {
    const now = new Date();
    if (period === "custom") {
      return {
        currentStart: customDates.currentFrom ? new Date(customDates.currentFrom) : now,
        currentEnd: customDates.currentTo ? new Date(customDates.currentTo) : now,
        previousStart: customDates.previousFrom ? new Date(customDates.previousFrom) : undefined,
        previousEnd: customDates.previousTo ? new Date(customDates.previousTo) : undefined,
      };
    }
    let currentStart: Date;
    const currentEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    switch (period) {
      case "week": {
        const dayOfWeek = now.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        currentStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset, 0, 0, 0);
        break;
      }
      case "month":
        currentStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
        break;
      case "quarter": {
        const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
        currentStart = new Date(now.getFullYear(), quarterMonth, 1, 0, 0, 0);
        break;
      }
      default:
        currentStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    }
    return { currentStart, currentEnd, previousStart: undefined, previousEnd: undefined };
  }, [period, customDates]);

  // Main comparison query
  const { data: comparison, isLoading, refetch } = trpc.dataComparison.compare.useQuery({
    periodType: period,
    currentStart: computedDates.currentStart,
    currentEnd: computedDates.currentEnd,
    previousStart: computedDates.previousStart,
    previousEnd: computedDates.previousEnd,
    factoryId,
    machineId,
  }, {
    enabled: period !== "custom" || (
      !!customDates.currentFrom && !!customDates.currentTo &&
      !!customDates.previousFrom && !!customDates.previousTo
    ),
  });

  // Quick compare
  const { data: quickData } = trpc.dataComparison.quickCompare.useQuery({
    preset: "this_week_vs_last_week",
  });

  function getChangeIcon(change: number) {
    if (change > 0) return <ArrowUpRight className="h-4 w-4 text-success" />;
    if (change < 0) return <ArrowDownRight className="h-4 w-4 text-destructive" />;
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  }

  function getChangeColor(change: number, invert = false) {
    const isPositive = invert ? change < 0 : change > 0;
    if (Math.abs(change) < 0.01) return CHANGE_COLORS.neutral;
    return isPositive ? CHANGE_COLORS.positive : CHANGE_COLORS.negative;
  }

  function formatPercent(val: number | undefined) {
    if (val == null) return "N/A";
    return `${val >= 0 ? "+" : ""}${val.toFixed(2)}%`;
  }

  return (
    <>
      <div className="p-6 space-y-6">
        {/* Header — DS PageHeader (shared pattern) */}
        <PageHeader
          icon={<GitCompare className="h-6 w-6" />}
          title={t('reports.dataComparison')}
          description={t('reports.dataComparisonDesc')}
          actions={
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> {t('common.refresh')}
            </Button>
          }
        />

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t('reports.comparisonPeriod')}</Label>
                <Select value={period} onValueChange={(v: any) => setPeriod(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PERIOD_OPTIONS.map(p => (
                      <SelectItem key={p.value} value={p.value}>{t(p.labelKey)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('common.factory')}</Label>
                <Select
                  value={factoryId?.toString() || "all"}
                  onValueChange={(v) => setFactoryId(v === "all" ? undefined : parseInt(v))}
                >
                  <SelectTrigger><SelectValue placeholder={t('common.all')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('common.all')}</SelectItem>
                    {(factories || []).map((f: any) => (
                      <SelectItem key={f.id} value={f.id.toString()}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {period === "custom" && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('reports.previousPeriodFromTo')}</Label>
                    <div className="flex gap-1">
                      <Input
                        type="date"
                        value={customDates.previousFrom}
                        onChange={(e) => setCustomDates(d => ({ ...d, previousFrom: e.target.value }))}
                        className="text-xs"
                      />
                      <Input
                        type="date"
                        value={customDates.previousTo}
                        onChange={(e) => setCustomDates(d => ({ ...d, previousTo: e.target.value }))}
                        className="text-xs"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('reports.currentPeriodFromTo')}</Label>
                    <div className="flex gap-1">
                      <Input
                        type="date"
                        value={customDates.currentFrom}
                        onChange={(e) => setCustomDates(d => ({ ...d, currentFrom: e.target.value }))}
                        className="text-xs"
                      />
                      <Input
                        type="date"
                        value={customDates.currentTo}
                        onChange={(e) => setCustomDates(d => ({ ...d, currentTo: e.target.value }))}
                        className="text-xs"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
            <Skeleton className="h-[380px] w-full" />
          </div>
        ) : comparison ? (
          <>
            {/* Period labels */}
            <div className="flex items-center gap-4 text-sm">
              <Badge variant="outline" className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {t('reports.previousPeriod')}: {comparison.previousPeriod?.start} → {comparison.previousPeriod?.end}
              </Badge>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <Badge variant="outline" className="flex items-center gap-1 border-primary">
                <Calendar className="h-3 w-3" />
                {t('reports.currentPeriod')}: {comparison.currentPeriod?.start} → {comparison.currentPeriod?.end}
              </Badge>
            </div>

            {/* KPI comparison cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                {
                  label: t('reports.totalInspections'),
                  prev: comparison.previousPeriod?.summary.totalInspections,
                  curr: comparison.currentPeriod?.summary.totalInspections,
                  change: comparison.changes?.totalInspections.percent,
                },
                {
                  label: t('reports.yieldPercent'),
                  prev: comparison.previousPeriod?.summary.yieldRate,
                  curr: comparison.currentPeriod?.summary.yieldRate,
                  change: comparison.changes?.yieldRate.value,
                  suffix: "%",
                },
                {
                  label: t('reports.totalNG'),
                  prev: comparison.previousPeriod?.summary.ngCount,
                  curr: comparison.currentPeriod?.summary.ngCount,
                  change: comparison.changes?.ngCount.percent,
                  invert: true,
                },
                {
                  label: t('reports.ngRatePercent'),
                  prev: comparison.previousPeriod?.summary.ngRate,
                  curr: comparison.currentPeriod?.summary.ngRate,
                  change: comparison.changes?.ngRate.value,
                  suffix: "%",
                  invert: true,
                },
              ].map((kpi, i) => (
                <MetricCard
                  key={i}
                  label={kpi.label}
                  value={`${kpi.curr != null ? kpi.curr.toLocaleString() : "N/A"}${kpi.suffix || ""}`}
                  delta={
                    <span className="flex items-center gap-2">
                      <span>
                        {t('reports.previousPeriod')}: {kpi.prev != null ? kpi.prev.toLocaleString() : "N/A"}{kpi.suffix || ""}
                      </span>
                      <span className="flex items-center gap-0.5">
                        {getChangeIcon(kpi.change || 0)}
                        <span className={`font-medium ${getChangeColor(kpi.change || 0, kpi.invert)}`}>
                          {formatPercent(kpi.change)}
                        </span>
                      </span>
                    </span>
                  }
                />
              ))}
            </div>

            {/* Charts */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Daily trend comparison */}
              {comparison.dailyBreakdown && (
                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-base">{t('reports.dailyTrend')}</CardTitle>
                    <CardDescription>{t('reports.compareProductionYield')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[350px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={comparison.dailyBreakdown.map((d: any) => ({
                          date: d.date,
                          previousTotal: d.previous?.totalInspections ?? 0,
                          currentTotal: d.current?.totalInspections ?? 0,
                        }))}>
                          <defs>
                            <linearGradient id="prevGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={chartColor(0)} stopOpacity={0.3} />
                              <stop offset="95%" stopColor={chartColor(0)} stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="currGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={chartColor(1)} stopOpacity={0.3} />
                              <stop offset="95%" stopColor={chartColor(1)} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid {...chartGridProps} />
                          <XAxis dataKey="date" tick={chartAxisTick} />
                          <YAxis tick={chartAxisTick} />
                          <Tooltip contentStyle={chartTooltipStyle} />
                          <Legend />
                          <Area
                            type="monotone"
                            dataKey="previousTotal"
                            name={t('reports.previousPeriod')}
                            stroke={chartColor(0)}
                            fill="url(#prevGrad)"
                            strokeWidth={2}
                          />
                          <Area
                            type="monotone"
                            dataKey="currentTotal"
                            name={t('reports.currentPeriod')}
                            stroke={chartColor(1)}
                            fill="url(#currGrad)"
                            strokeWidth={2}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Machine comparison */}
              {comparison.machineComparison && comparison.machineComparison.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t('reports.compareByMachine')}</CardTitle>
                    <CardDescription>{t('reports.yieldChangeByMachine')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={comparison.machineComparison.slice(0, 10).map((m: any) => ({
                          machineName: m.machineName,
                          previousYield: m.previous?.yieldRate ?? 0,
                          currentYield: m.current?.yieldRate ?? 0,
                        }))} layout="vertical">
                          <CartesianGrid {...chartGridProps} />
                          <XAxis type="number" tick={chartAxisTick} />
                          <YAxis dataKey="machineName" type="category" width={120} tick={chartAxisTick} />
                          <Tooltip contentStyle={chartTooltipStyle} />
                          <Legend />
                          <Bar dataKey="previousYield" name={t('reports.previousPeriod')} fill={chartColor(0)} radius={[0, 4, 4, 0]} />
                          <Bar dataKey="currentYield" name={t('reports.currentPeriod')} fill={chartColor(1)} radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Top changed points */}
              {comparison.topImprovedPoints && comparison.topImprovedPoints.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t('reports.mostChangedPoints')}</CardTitle>
                    <CardDescription>{t('reports.mostChangedPointsDesc')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {comparison.topImprovedPoints.slice(0, 8).map((point: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                          <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                              {i + 1}
                            </div>
                            <span className="text-sm font-medium truncate max-w-[200px]">{point.pointName}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {point.previousNG} → {point.currentNG}
                            </span>
                            <Badge
                              variant="outline"
                              className={
                                point.improvement
                                  ? "text-success border-success/30"
                                  : "text-destructive border-destructive/30"
                              }
                            >
                              {point.change > 0 ? "+" : ""}{point.change}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </>
        ) : (
          <EmptyState
            icon={GitCompare}
            title={t('reports.selectPeriodPrompt')}
            description={t('reports.comparisonSupportDesc')}
          />
        )}
      </div>
    </>
  );
}

export default function DataComparison() {
  return (
    <DashboardLayout>
      <DataComparisonContent />
    </DashboardLayout>
  );
}
