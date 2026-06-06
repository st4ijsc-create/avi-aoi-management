/**
 * AI Inspection Analytics Page (Improved)
 * ========================================
 * PERFORMANCE & UX IMPROVEMENTS:
 * ✓ Query batching with parallel execution
 * ✓ Error boundaries & handling  
 * ✓ Empty states & loading skeletons
 * ✓ Pagination for machine tables (10/20/50 per page)
 * ✓ Advanced tooltips with confidence scores
 * ✓ Date range selector with localStorage persistence
 * ✓ Trend indicators (↑/↓/→) with % change
 * ✓ Export functionality (CSV/JSON)
 * ✓ Tab preference persistence
 * ✓ Responsive design with mobile support
 * ✓ Comprehensive error handling & retry buttons
 */

import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Cell,
  ReferenceLine,
  Scatter,
} from "recharts";
import {
  TrendingUp,
  BarChart3,
  Activity,
  Target,
  AlertTriangle,
  Shield,
  Thermometer,
  Clock,
  RefreshCw,
  Calendar,
  Cpu,
} from "lucide-react";

// Hooks & Utilities
import { useAnalyticsBatch } from "@/hooks/useAnalyticsBatch";
import { usePagination } from "@/hooks/usePagination";
import { useAnalyticsErrorHandler } from "@/hooks/useAnalyticsErrorHandler";

// Components
import { ChartCard } from "@/components/analytics/ChartCard";
import { MetricCard } from "@/components/analytics/MetricCard";
import { TrendIndicator } from "@/components/analytics/TrendIndicator";
import { DateRangeSelector } from "@/components/analytics/DateRangeSelector";
import { HeatmapGrid } from "@/components/analytics/HeatmapGrid";
import { PaginationControls } from "@/components/analytics/PaginationControls";
import { AdvancedTooltip } from "@/components/analytics/AdvancedTooltip";
import { AnalyticsErrorBoundary } from "@/components/analytics/AnalyticsErrorBoundary";

// Utilities
import { exportToCSV, exportToJSON, exportChartToPNG, formatChartDataForExport } from "@/lib/exportUtils";
import { ANALYTICS_COLORS, LOCAL_STORAGE_KEYS } from "@/lib/analyticsConstants";

// ─── Helpers ───────────────────────────────────────────────────────────
function fmt(d: Date): string {
  return d.toISOString().split("T")[0];
}

function getDefaultRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date();
  start.setDate(now.getDate() - 30);
  return { start: fmt(start), end: fmt(now) };
}

function getLastDateRange(): { start: string; end: string } | null {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEYS.lastDateRange);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { start: parsed.start, end: parsed.end };
    }
  } catch (error) {
    console.error("Error parsing date range from localStorage:", error);
  }
  return null;
}

// ─── Main Component ────────────────────────────────────────────────────
export default function AIInspectionAnalyticsPage() {
  const { t } = useTranslation();

  // State: Date Range (with localStorage persistence)
  const defaultRange = getDefaultRange();
  const savedRange = getLastDateRange();

  const [startDate, setStartDate] = useState(savedRange?.start || defaultRange.start);
  const [endDate, setEndDate] = useState(savedRange?.end || defaultRange.end);

  // State: Filters
  const [machineId, setMachineId] = useState<string>("");
  const [productModel, setProductModel] = useState("");

  // State: Active Tab (with localStorage persistence)
  const [activeTab, setActiveTab] = useState(() => {
    try {
      return localStorage.getItem(LOCAL_STORAGE_KEYS.lastActiveTab) || "overview";
    } catch {
      return "overview";
    }
  });

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    try {
      localStorage.setItem(LOCAL_STORAGE_KEYS.lastActiveTab, tab);
    } catch (error) {
      console.error("Error saving tab preference:", error);
    }
  };

  // Error Handler
  const { parseError, getUserMessage } = useAnalyticsErrorHandler();

  // Query Parameters
  const period = useMemo(
    () => ({
      startDate,
      endDate,
      ...(machineId ? { machineId: Number(machineId) } : {}),
      ...(productModel ? { productModel } : {}),
    }),
    [startDate, endDate, machineId, productModel]
  );

  // Batch Queries (All parallel with selective tab-based execution)
  const batch = useAnalyticsBatch(period, {
    overview: true,
    trend: activeTab === "trend",
    machines: activeTab === "machines",
    spc: activeTab === "spc",
    forecast: activeTab === "forecast",
    risk: activeTab === "risk",
  });

  // Computed Stats
  const stats = useMemo(() => {
    if (!batch.trend.data?.length) return null;
    const data = batch.trend.data;
    const totalInsp = data.reduce((s: number, d: any) => s + d.total, 0);
    const totalPass = data.reduce((s: number, d: any) => s + d.pass, 0);
    const yieldRate = totalInsp > 0 ? (totalPass / totalInsp) * 100 : 0;
    const avgDefectRate = data.reduce((s: number, d: any) => s + d.defectRate, 0) / data.length;

    // Calculate trend
    if (data.length > 1) {
      const prevAvg =
        data.slice(0, Math.floor(data.length / 2)).reduce((s: number, d: any) => s + d.defectRate, 0) /
        Math.floor(data.length / 2);
      const currAvg =
        data.slice(Math.floor(data.length / 2)).reduce((s: number, d: any) => s + d.defectRate, 0) /
        Math.ceil(data.length / 2);
      const trend = ((currAvg - prevAvg) / prevAvg) * 100;
      return { totalInsp, totalPass, yieldRate, avgDefectRate, days: data.length, defectTrend: -trend };
    }
    return { totalInsp, totalPass, yieldRate, avgDefectRate, days: data.length, defectTrend: 0 };
  }, [batch.trend.data]);

  // Pagination
  const machPerfPagination = usePagination(batch.machPerf.data || [], 10);

  // Export Handler
  const handleExportChartData = async (
    format: "csv" | "json" | "png" | "pdf",
    context?: { title: string; exportId: string }
  ) => {
    if (!batch.trend.data?.length) {
      toast.error(t("common.noData", "No data available"));
      return;
    }

    try {
      const data = formatChartDataForExport(batch.trend.data, context?.title || "Inspection Trend");
      const baseName = `inspection-trend-${startDate}-${endDate}`;

      if (format === "csv") {
        exportToCSV(data, `${baseName}.csv`);
        toast.success(t("common.export", "Export") + " CSV");
        return;
      }

      if (format === "json") {
        exportToJSON(data, `${baseName}.json`);
        toast.success(t("common.export", "Export") + " JSON");
        return;
      }

      if (format === "png") {
        if (!context?.exportId) {
          throw new Error("Missing chart export target id");
        }
        await exportChartToPNG(context.exportId, `${baseName}.png`);
        toast.success(t("common.export", "Export") + " PNG");
        return;
      }

      throw new Error(`Unsupported export format: ${format}`);
    } catch (error) {
      console.error("[AIInspectionAnalyticsPage] Export failed", error);
      toast.error(t("common.error", "Error") + ": " + t("aiAnalytics.exportFailed", "Export failed. Please try again."));
    }
  };

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
              <BarChart3 className="h-6 w-6 text-cyan-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {t("aiAnalytics.title", "AI Inspection Analytics")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("aiAnalytics.subtitle", "Trends, forecasts, risk assessment & insights")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={() => batch.refetch()} disabled={batch.isLoading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${batch.isLoading ? "animate-spin" : ""}`} />
              {t("common.refresh", "Refresh")}
            </Button>
          </div>
        </div>

        {/* Date Range Selector */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              {t("common.dateRange", "Date Range")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DateRangeSelector
              startDate={startDate}
              endDate={endDate}
              onDateChange={(start, end) => {
                setStartDate(start);
                setEndDate(end);
              }}
            />
          </CardContent>
        </Card>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("common.filters", "Filters")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col md:flex-row flex-wrap items-end gap-3">
            <div className="flex-1 min-w-40">
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                {t("aiAnalytics.machineId", "Machine ID")}
              </label>
              <Input
                placeholder="e.g., AOI-001"
                value={machineId}
                onChange={(e) => setMachineId(e.target.value)}
              />
            </div>
            <div className="flex-1 min-w-40">
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                {t("aiAnalytics.productModel", "Product Model")}
              </label>
              <Input
                placeholder="e.g., MODEL-A1"
                value={productModel}
                onChange={(e) => setProductModel(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Summary Metrics */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <MetricCard
              label={t("aiAnalytics.totalInspections", "Total Inspections")}
              value={stats.totalInsp}
              icon={Activity}
              color="blue"
              isLoading={batch.trend.isLoading}
            />
            <MetricCard
              label={t("aiAnalytics.yieldRate", "Yield Rate")}
              value={`${stats.yieldRate.toFixed(1)}%`}
              color={stats.yieldRate >= 95 ? "green" : stats.yieldRate >= 90 ? "yellow" : "red"}
              trend={{
                direction: stats.defectTrend > 0.1 ? "down" : stats.defectTrend < -0.1 ? "up" : "stable",
                change: Math.abs(stats.defectTrend),
              }}
            />
            <MetricCard
              label={t("aiAnalytics.avgDefectRate", "Avg Defect Rate")}
              value={`${stats.avgDefectRate.toFixed(2)}%`}
              color={stats.avgDefectRate < 5 ? "green" : stats.avgDefectRate < 10 ? "yellow" : "red"}
              icon={AlertTriangle}
            />
            <MetricCard
              label={t("aiAnalytics.analysisPeriod", "Analysis Period")}
              value={stats.days}
              unit="days"
              icon={Clock}
              color="cyan"
            />
          </div>
        )}

        {/* Error Boundary */}
        {batch.isError && (
          <Card className="border-red-500/30 bg-red-500/5">
            <CardContent className="pt-6">
              <div className="flex gap-4">
                <AlertTriangle className="h-6 w-6 text-red-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold text-sm text-red-700">
                    {t("common.error", "Error")}
                  </h3>
                  <p className="text-sm text-red-600 mt-1">
                    {t("aiAnalytics.loadError", "Failed to load analytics data. Please try again.")}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => batch.refetch()} className="mt-3">
                    <RefreshCw className="h-3 w-3 mr-1" />
                    {t("common.tryAgain", "Try again")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="grid grid-cols-3 md:grid-cols-6 w-full">
            <TabsTrigger value="overview">{t("aiAnalytics.tabs.overview", "Overview")}</TabsTrigger>
            <TabsTrigger value="trend">{t("aiAnalytics.tabs.trend", "Trends")}</TabsTrigger>
            <TabsTrigger value="machines">{t("aiAnalytics.tabs.machines", "Machines")}</TabsTrigger>
            <TabsTrigger value="spc">{t("aiAnalytics.tabs.spc", "SPC")}</TabsTrigger>
            <TabsTrigger value="forecast">{t("aiAnalytics.tabs.forecast", "Forecast")}</TabsTrigger>
            <TabsTrigger value="risk">{t("aiAnalytics.tabs.risk", "Risk")}</TabsTrigger>
          </TabsList>

          {/* ─── OVERVIEW TAB ─── */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Defect Trend Chart */}
              <AnalyticsErrorBoundary title={t("aiAnalytics.defectTrend", "Defect Trend")}>
                <ChartCard
                  title={t("aiAnalytics.defectTrend", "Defect Trend")}
                  icon={TrendingUp}
                  isLoading={batch.trend.isLoading}
                  isError={batch.trend.isError}
                  errorMessage={batch.trend.error?.message}
                  onRefresh={() => batch.trend.refetch()}
                  onExport={handleExportChartData}
                >
                  {batch.trend.data?.length ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <AreaChart data={batch.trend.data}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <RechartsTooltip content={<AdvancedTooltip decimalPlaces={2} unit="%" />} />
                        <Area
                          type="monotone"
                          dataKey="defectRate"
                          stroke="#ef4444"
                          fill="#ef444420"
                          name={t("aiAnalytics.defectRate", "Defect Rate %")}
                        />
                        <Area
                          type="monotone"
                          dataKey="yieldRate"
                          stroke="#22c55e"
                          fill="#22c55e20"
                          name={t("aiAnalytics.yieldRate2", "Yield %")}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-250 flex items-center justify-center text-muted-foreground text-sm">
                      {t("common.noData", "No data available")}
                    </div>
                  )}
                </ChartCard>
              </AnalyticsErrorBoundary>

              {/* Pareto Analysis */}
              <AnalyticsErrorBoundary title={t("aiAnalytics.pareto", "Pareto Analysis")}>
                <ChartCard
                  title={t("aiAnalytics.pareto", "Pareto Analysis")}
                  icon={BarChart3}
                  isLoading={batch.pareto.isLoading}
                  isError={batch.pareto.isError}
                  errorMessage={batch.pareto.error?.message}
                  onRefresh={() => batch.pareto.refetch()}
                >
                  {batch.pareto.data?.length ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <ComposedChart data={batch.pareto.data}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis
                          dataKey="defectType"
                          tick={{ fontSize: 10 }}
                          angle={-20}
                          textAnchor="end"
                          height={60}
                        />
                        <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          domain={[0, 100]}
                          tick={{ fontSize: 11 }}
                        />
                        <RechartsTooltip content={<AdvancedTooltip decimalPlaces={1} />} />
                        <Bar
                          yAxisId="left"
                          dataKey="count"
                          name={t("aiAnalytics.count", "Count")}
                          radius={[4, 4, 0, 0]}
                        >
                          {batch.pareto.data.map((_: any, i: number) => (
                            <Cell key={i} fill={ANALYTICS_COLORS[i % ANALYTICS_COLORS.length]} />
                          ))}
                        </Bar>
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="cumulativePercentage"
                          stroke="#f97316"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          name={t("aiAnalytics.cumulative", "Cumulative %")}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-250 flex items-center justify-center text-muted-foreground text-sm">
                      {t("common.noData", "No data available")}
                    </div>
                  )}
                </ChartCard>
              </AnalyticsErrorBoundary>
            </div>

            {/* Risk Assessment Overview */}
            {batch.risk.data?.length ? (
              <AnalyticsErrorBoundary title={t("aiAnalytics.risks", "Risk Assessment")}>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Shield className="h-4 w-4 text-red-500" />
                      {t("aiAnalytics.risks", "Risk Assessment")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {batch.risk.data.map((r: any, i: number) => (
                        <RiskCard key={i} risk={r} t={t} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </AnalyticsErrorBoundary>
            ) : null}
          </TabsContent>

          {/* ─── TREND TAB ─── */}
          <TabsContent value="trend" className="space-y-4">
            <AnalyticsErrorBoundary>
              <div className="grid grid-cols-1 gap-4">
                {/* Full Trend Chart */}
                <ChartCard
                  title={t("aiAnalytics.dailyTrend", "Daily Trend")}
                  icon={TrendingUp}
                  isLoading={batch.trend.isLoading}
                  isError={batch.trend.isError}
                  onRefresh={() => batch.trend.refetch()}
                  onExport={handleExportChartData}
                >
                  {batch.trend.data?.length ? (
                    <ResponsiveContainer width="100%" height={350}>
                      <LineChart data={batch.trend.data}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <RechartsTooltip content={<AdvancedTooltip decimalPlaces={1} />} />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="total"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          name={t("aiAnalytics.totalInsp", "Total Inspections")}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="pass"
                          stroke="#22c55e"
                          strokeWidth={2}
                          name={t("aiAnalytics.pass", "Pass")}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="fail"
                          stroke="#ef4444"
                          strokeWidth={2}
                          name={t("aiAnalytics.fail", "Fail")}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-350 flex items-center justify-center text-muted-foreground text-sm">
                      {t("common.noData", "No data available")}
                    </div>
                  )}
                </ChartCard>

                {/* Shift Analysis */}
                {batch.shift.data?.length ? (
                  <ChartCard
                    title={t("aiAnalytics.shiftAnalysis", "Shift Analysis")}
                    icon={Clock}
                    isLoading={batch.shift.isLoading}
                  >
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={batch.shift.data}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="shift" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <RechartsTooltip content={<AdvancedTooltip decimalPlaces={1} />} />
                        <Legend />
                        <Bar
                          dataKey="totalInspections"
                          fill="#3b82f6"
                          name={t("aiAnalytics.totalInsp", "Total Inspections")}
                          radius={[4, 4, 0, 0]}
                        />
                        <Bar
                          dataKey="yieldRate"
                          fill="#22c55e"
                          name={t("aiAnalytics.yieldRate2", "Yield %")}
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>
                ) : null}

                {/* Heatmap */}
                {batch.heatmap.data ? (
                  <ChartCard
                    title={t("aiAnalytics.heatmap", "Defect Heatmap")}
                    icon={Thermometer}
                    description={t("aiAnalytics.heatmapDesc", "Hourly defect rate by machine")}
                    isLoading={batch.heatmap.isLoading}
                  >
                    <HeatmapGrid data={batch.heatmap.data} />
                  </ChartCard>
                ) : null}
              </div>
            </AnalyticsErrorBoundary>
          </TabsContent>

          {/* ─── MACHINES TAB ─── */}
          <TabsContent value="machines" className="space-y-4">
            <AnalyticsErrorBoundary>
              <ChartCard
                title={t("aiAnalytics.machineComparison", "Machine Performance")}
                icon={Cpu}
                isLoading={batch.machPerf.isLoading}
                isError={batch.machPerf.isError}
              >
                {batch.machPerf.data?.length ? (
                  <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={batch.machPerf.data} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="machineCode" width={100} tick={{ fontSize: 11 }} />
                      <RechartsTooltip content={<AdvancedTooltip decimalPlaces={1} unit="%" />} />
                      <Legend />
                      <Bar
                        dataKey="yieldRate"
                        fill="#22c55e"
                        name={t("aiAnalytics.yieldRate2", "Yield %")}
                        radius={[0, 4, 4, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-350 flex items-center justify-center text-muted-foreground text-sm">
                    {t("common.noData", "No data available")}
                  </div>
                )}
              </ChartCard>

              {/* Machine Details Table with Pagination */}
              {batch.machPerf.data?.length ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{t("aiAnalytics.machineDetails", "Machine Details")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <ScrollArea className="h-75">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left">
                            <th className="py-2 px-3 font-medium">{t("aiAnalytics.machine", "Machine")}</th>
                            <th className="py-2 px-3 font-medium text-right">
                              {t("aiAnalytics.totalInsp", "Total Inspections")}
                            </th>
                            <th className="py-2 px-3 font-medium text-right">Yield</th>
                            <th className="py-2 px-3 font-medium text-right">{t("aiAnalytics.failRate", "Fail %")}</th>
                            <th className="py-2 px-3 font-medium text-right">
                              {t("aiAnalytics.avgCycleTime", "Cycle (s)")}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {machPerfPagination.paginatedData.map((m: any, i: number) => (
                            <tr key={i} className="border-b hover:bg-muted/50">
                              <td className="py-2 px-3 font-medium">{m.machineCode}</td>
                              <td className="py-2 px-3 text-right">{m.totalInspections.toLocaleString()}</td>
                              <td className="py-2 px-3 text-right">
                                <Badge
                                  variant={
                                    m.yieldRate >= 95
                                      ? "default"
                                      : m.yieldRate >= 90
                                        ? "secondary"
                                        : "destructive"
                                  }
                                >
                                  {m.yieldRate.toFixed(1)}%
                                </Badge>
                              </td>
                              <td className="py-2 px-3 text-right">{(100 - m.yieldRate).toFixed(2)}%</td>
                              <td className="py-2 px-3 text-right">{m.avgCycleTime?.toFixed(1) ?? "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </ScrollArea>

                    {/* Pagination Controls */}
                    <PaginationControls
                      pageIndex={machPerfPagination.pageIndex}
                      pageSize={machPerfPagination.pageSize}
                      pageCount={machPerfPagination.pageCount}
                      canPreviousPage={machPerfPagination.canPreviousPage}
                      canNextPage={machPerfPagination.canNextPage}
                      totalItems={batch.machPerf.data?.length || 0}
                      onPageIndexChange={machPerfPagination.setPageIndex}
                      onPageSizeChange={machPerfPagination.setPageSize}
                      compact
                    />
                  </CardContent>
                </Card>
              ) : null}

              {/* Correlations */}
              {batch.corr.data?.length ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Target className="h-4 w-4 text-blue-500" />
                      {t("aiAnalytics.correlations", "Factor Correlations")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {batch.corr.data.map((c: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                          <div>
                            <span className="font-medium text-sm">{c.factor1}</span>
                            <span className="text-muted-foreground mx-2">↔</span>
                            <span className="font-medium text-sm">{c.factor2}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={
                                Math.abs(c.correlation) > 0.7
                                  ? "destructive"
                                  : Math.abs(c.correlation) > 0.4
                                    ? "secondary"
                                    : "outline"
                              }
                            >
                              r = {c.correlation.toFixed(3)}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{c.strength}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </AnalyticsErrorBoundary>
          </TabsContent>

          {/* ─── SPC TAB ─── */}
          <TabsContent value="spc" className="space-y-4">
            <AnalyticsErrorBoundary>
              <ChartCard
                title={t("aiAnalytics.controlChart", "SPC Control Chart")}
                icon={Activity}
                description={t("aiAnalytics.spcDesc", "UCL/LCL ± 3σ — Out-of-control points highlighted")}
                isLoading={batch.control.isLoading}
                isError={batch.control.isError}
              >
                {batch.control.data ? (
                  <div>
                    {/* Statistics */}
                    <div className="flex gap-4 mb-4 text-xs flex-wrap">
                      <span>
                        UCL: <strong className="text-red-500">{batch.control.data.summary.ucl.toFixed(2)}</strong>
                      </span>
                      <span>
                        CL: <strong className="text-blue-500">{batch.control.data.summary.mean.toFixed(2)}</strong>
                      </span>
                      <span>
                        LCL: <strong className="text-red-500">{batch.control.data.summary.lcl.toFixed(2)}</strong>
                      </span>
                      {batch.control.data.summary.cpk != null && (
                        <span>
                          Cpk:{" "}
                          <strong
                            className={
                              batch.control.data.summary.cpk >= 1.33
                                ? "text-green-500"
                                : batch.control.data.summary.cpk >= 1.0
                                  ? "text-yellow-500"
                                  : "text-red-500"
                            }
                          >
                            {batch.control.data.summary.cpk.toFixed(2)}
                          </strong>
                        </span>
                      )}
                      {batch.control.data.summary.cpk == null && batch.control.data.summary.cpkNote && (
                        <span className="text-muted-foreground italic">
                          Cpk: {t(batch.control.data.summary.cpkNote, "N/A")}
                        </span>
                      )}
                      <Badge
                        variant={batch.control.data.summary.outOfControlCount > 0 ? "destructive" : "default"}
                        className="text-xs"
                      >
                        OOC: {batch.control.data.summary.outOfControlCount}
                      </Badge>
                    </div>

                    {/* Chart */}
                    <ResponsiveContainer width="100%" height={350}>
                      <ComposedChart
                        data={batch.control.data.points.map((p: any) => ({
                          ...p,
                          oocValue: p.outOfControl ? p.value : undefined,
                        }))}
                      >
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                        <RechartsTooltip content={<AdvancedTooltip decimalPlaces={2} />} />
                        <ReferenceLine
                          y={batch.control.data.summary.ucl}
                          stroke="#ef4444"
                          strokeDasharray="5 5"
                          label={{ value: "UCL", position: "right", fontSize: 10 }}
                        />
                        <ReferenceLine
                          y={batch.control.data.summary.mean}
                          stroke="#3b82f6"
                          strokeDasharray="3 3"
                          label={{ value: "CL", position: "right", fontSize: 10 }}
                        />
                        <ReferenceLine
                          y={batch.control.data.summary.lcl}
                          stroke="#ef4444"
                          strokeDasharray="5 5"
                          label={{ value: "LCL", position: "right", fontSize: 10 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke="#3b82f6"
                          strokeWidth={1.5}
                          dot={false}
                          name={t("aiAnalytics.value", "Value")}
                        />
                        <Scatter
                          dataKey="oocValue"
                          fill="#ef4444"
                          name={t("aiAnalytics.oocPoint", "Out of Control")}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-350 flex items-center justify-center text-muted-foreground text-sm">
                    {t("common.noData", "No data available")}
                  </div>
                )}
              </ChartCard>
            </AnalyticsErrorBoundary>
          </TabsContent>

          {/* ─── FORECAST TAB ─── */}
          <TabsContent value="forecast" className="space-y-4">
            <AnalyticsErrorBoundary>
              <ChartCard
                title={t("aiAnalytics.yieldForecast", "Yield Forecast")}
                icon={TrendingUp}
                description={t("aiAnalytics.forecastDesc", "7-day forecast with confidence intervals")}
                isLoading={batch.forecast.isLoading}
                isError={batch.forecast.isError}
              >
                {batch.forecast.data ? (
                  <div>
                    {/* Statistics & Trend */}
                    <div className="flex gap-4 mb-4 text-xs flex-wrap">
                      <span>{t("aiAnalytics.forecastTrend", "Trend")}:</span>
                      <TrendIndicator
                        direction={
                          batch.forecast.data.trend === "improving"
                            ? "up"
                            : batch.forecast.data.trend === "declining"
                              ? "down"
                              : "stable"
                        }
                        value={5}
                        size="sm"
                        variant="inline"
                      />
                      <span>
                        RMSE: <strong>{batch.forecast.data.rmse?.toFixed(3)}</strong>
                      </span>
                    </div>

                    {/* Chart */}
                    <ResponsiveContainer width="100%" height={350}>
                      <AreaChart
                        data={[
                          ...batch.forecast.data.historical.map((h: any) => ({ ...h, type: "actual" })),
                          ...batch.forecast.data.predicted.map((p: any) => ({ ...p, type: "forecast" })),
                        ]}
                      >
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                        <RechartsTooltip content={<AdvancedTooltip decimalPlaces={1} unit="%" />} />
                        <Legend />
                        <Area
                          type="monotone"
                          dataKey="upper"
                          stroke="none"
                          fill="#22c55e10"
                          name={t("aiAnalytics.upperBound", "Upper Bound")}
                        />
                        <Area
                          type="monotone"
                          dataKey="lower"
                          stroke="none"
                          fill="#22c55e10"
                          name={t("aiAnalytics.lowerBound", "Lower Bound")}
                        />
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          dot={false}
                          name={t("aiAnalytics.actual", "Actual")}
                        />
                        <Line
                          type="monotone"
                          dataKey="predicted"
                          stroke="#22c55e"
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          dot={false}
                          name={t("aiAnalytics.predicted", "Forecast")}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-350 flex items-center justify-center text-muted-foreground text-sm">
                    {t("common.noData", "No data available")}
                  </div>
                )}
              </ChartCard>
            </AnalyticsErrorBoundary>
          </TabsContent>

          {/* ─── RISK TAB ─── */}
          <TabsContent value="risk" className="space-y-4">
            <AnalyticsErrorBoundary>
              {batch.risk.isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-40" />
                  ))}
                </div>
              ) : batch.risk.data?.length ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {batch.risk.data.map((r: any, i: number) => (
                    <RiskCard key={i} risk={r} t={t} detailed />
                  ))}
                </div>
              ) : (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    <Shield className="h-12 w-12 mx-auto mb-3 text-green-500" />
                    <p className="font-medium">
                      {t("aiAnalytics.noRisks", "No risks detected in this period")}
                    </p>
                  </CardContent>
                </Card>
              )}
            </AnalyticsErrorBoundary>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

// ─── Risk Card Component ───────────────────────────────────────────────
function RiskCard({ risk, t, detailed }: { risk: any; t: any; detailed?: boolean }) {
  const levelColor: Record<string, string> = {
    critical: "bg-red-500",
    high: "bg-orange-500",
    medium: "bg-yellow-500",
    low: "bg-green-500",
  };

  return (
    <Card
      className="border-l-4"
      style={{
        borderLeftColor:
          risk.level === "critical"
            ? "#ef4444"
            : risk.level === "high"
              ? "#f97316"
              : risk.level === "medium"
                ? "#eab308"
                : "#22c55e",
      }}
    >
      <CardContent className="py-3">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${levelColor[risk.level] ?? "bg-gray-400"}`} />
            <span className="font-medium text-sm">{risk.category}</span>
          </div>
          <Badge
            variant={risk.level === "critical" || risk.level === "high" ? "destructive" : "secondary"}
            className="text-xs"
          >
            {t(
              `aiAnalytics.severity.${risk.level}`,
              risk.level.charAt(0).toUpperCase() + risk.level.slice(1)
            )}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{risk.description}</p>
        {risk.score != null && (
          <div className="mt-2 text-xs text-muted-foreground">
            {t("aiAnalytics.riskScore", "Risk Score")}: <strong>{risk.score.toFixed(0)}</strong>/100
          </div>
        )}
        {detailed && risk.recommendation && (
          <div className="mt-2 p-2 bg-muted/50 rounded text-xs">
            <strong>{t("aiAnalytics.recommendation", "Recommendation")}:</strong> {risk.recommendation}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
