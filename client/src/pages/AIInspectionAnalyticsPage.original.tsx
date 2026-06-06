/**
 * AI Inspection Analytics Page
 * Comprehensive visual dashboard for inspection data analysis:
 * - Defect Trends, Pareto, Machine Performance
 * - Yield Forecast, SPC Control Charts, Risk Assessment
 * - Shift Analysis, Defect Heatmap, Correlation Analysis
 */

import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  Download,
  Calendar,
  Factory,
  Cpu,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────
function fmt(d: Date) {
  return d.toISOString().split("T")[0];
}

function defaultRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 30);
  return { start: fmt(start), end: fmt(end) };
}

const COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f59e0b",
];

// ─── Component ────────────────────────────────────────
export default function AIInspectionAnalyticsPage() {
  const { t } = useTranslation();
  const range = defaultRange();
  const [startDate, setStartDate] = useState(range.start);
  const [endDate, setEndDate] = useState(range.end);
  const [machineId, setMachineId] = useState<string>("");
  const [productModel, setProductModel] = useState("");
  const [activeTab, setActiveTab] = useState("overview");

  const period = useMemo(() => ({
    startDate,
    endDate,
    ...(machineId ? { machineId: Number(machineId) } : {}),
    ...(productModel ? { productModel } : {}),
  }), [startDate, endDate, machineId, productModel]);

  // ─── Queries ──────────────────────────────────────
  const trend = trpc.aiInspectionAnalytics.defectTrend.useQuery(period);
  const pareto = trpc.aiInspectionAnalytics.defectPareto.useQuery(period);
  const machPerf = trpc.aiInspectionAnalytics.machinePerformance.useQuery(period, { enabled: activeTab === "overview" || activeTab === "machines" });
  const forecast = trpc.aiInspectionAnalytics.yieldForecast.useQuery({ ...period, horizonDays: 7 }, { enabled: activeTab === "forecast" });
  const risk = trpc.aiInspectionAnalytics.riskAssessment.useQuery(period, { enabled: activeTab === "overview" || activeTab === "risk" });
  const control = trpc.aiInspectionAnalytics.controlChart.useQuery({ ...period, metric: "yield" }, { enabled: activeTab === "spc" });
  const shift = trpc.aiInspectionAnalytics.shiftAnalysis.useQuery(period, { enabled: activeTab === "overview" || activeTab === "trend" });
  const heatmap = trpc.aiInspectionAnalytics.defectHeatmap.useQuery(period, { enabled: activeTab === "trend" });
  const corr = trpc.aiInspectionAnalytics.correlations.useQuery(period, { enabled: activeTab === "machines" });

  const isLoading = trend.isLoading || pareto.isLoading;

  // ─── Summary Stats ───────────────────────────────
  const stats = useMemo(() => {
    if (!trend.data?.length) return null;
    const totalInsp = trend.data.reduce((s, d) => s + d.total, 0);
    const totalPass = trend.data.reduce((s, d) => s + d.pass, 0);
    const yieldRate = totalInsp > 0 ? (totalPass / totalInsp) * 100 : 0;
    const avgDefectRate = trend.data.reduce((s, d) => s + d.defectRate, 0) / trend.data.length;
    return { totalInsp, totalPass, yieldRate, avgDefectRate, days: trend.data.length };
  }, [trend.data]);

  function refetchAll() {
    trend.refetch();
    pareto.refetch();
    machPerf.refetch();
    forecast.refetch();
    risk.refetch();
    control.refetch();
    shift.refetch();
    heatmap.refetch();
    corr.refetch();
  }

  function exportTrendCsv() {
    if (!trend.data?.length) return;
    const header = "Date,Total,Pass,Fail,YieldRate,DefectRate";
    const rows = trend.data
      .map(d => `${d.date},${d.total},${d.pass},${d.fail},${d.yieldRate.toFixed(2)},${d.defectRate.toFixed(2)}`)
      .join("\n");
    const blob = new Blob([header + "\n" + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inspection-trend-${startDate}-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Render ───────────────────────────────────────
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
                {t("aiAnalytics.title", "Phân Tích Kiểm Tra AI")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("aiAnalytics.subtitle", "Xu hướng, dự báo, phòng ngừa và báo cáo trực quan")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={refetchAll} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
              {t("common.refresh", "Làm mới")}
            </Button>            <Button variant="outline" size="sm" onClick={exportTrendCsv} disabled={!trend.data?.length}>
              <Download className="h-4 w-4 mr-1" />
              {t("common.export", "Xuất CSV")}
            </Button>          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="py-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-40" />
              <span className="text-muted-foreground">→</span>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-40" />
            </div>
            <Input
              placeholder={t("aiAnalytics.machineId", "Machine ID")}
              value={machineId}
              onChange={e => setMachineId(e.target.value)}
              className="w-32"
            />
            <Input
              placeholder={t("aiAnalytics.productModel", "Model sản phẩm")}
              value={productModel}
              onChange={e => setProductModel(e.target.value)}
              className="w-44"
            />
          </CardContent>
        </Card>

        {/* Summary Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard
              title={t("aiAnalytics.totalInspections", "Tổng kiểm tra")}
              value={stats.totalInsp.toLocaleString()}
              icon={<Activity className="h-4 w-4" />}
              color="text-blue-500"
            />
            <SummaryCard
              title={t("aiAnalytics.yieldRate", "Tỷ lệ đạt")}
              value={`${stats.yieldRate.toFixed(1)}%`}
              icon={stats.yieldRate >= 95 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
              color={stats.yieldRate >= 95 ? "text-green-500" : "text-red-500"}
            />
            <SummaryCard
              title={t("aiAnalytics.avgDefectRate", "Tỷ lệ lỗi TB")}
              value={`${stats.avgDefectRate.toFixed(2)}%`}
              icon={<AlertTriangle className="h-4 w-4" />}
              color={stats.avgDefectRate < 5 ? "text-green-500" : "text-orange-500"}
            />
            <SummaryCard
              title={t("aiAnalytics.analysisPeriod", "Khoảng phân tích")}
              value={`${stats.days} ${t("common.days", "ngày")}`}
              icon={<Clock className="h-4 w-4" />}
              color="text-slate-500"
            />
          </div>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-4 md:grid-cols-6 w-full">
            <TabsTrigger value="overview">{t("aiAnalytics.tabs.overview", "Tổng quan")}</TabsTrigger>
            <TabsTrigger value="trend">{t("aiAnalytics.tabs.trend", "Xu hướng")}</TabsTrigger>
            <TabsTrigger value="machines">{t("aiAnalytics.tabs.machines", "Máy")}</TabsTrigger>
            <TabsTrigger value="spc">{t("aiAnalytics.tabs.spc", "SPC")}</TabsTrigger>
            <TabsTrigger value="forecast">{t("aiAnalytics.tabs.forecast", "Dự báo")}</TabsTrigger>
            <TabsTrigger value="risk">{t("aiAnalytics.tabs.risk", "Rủi ro")}</TabsTrigger>
          </TabsList>

          {/* ═══ OVERVIEW TAB ═══ */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Defect Trend */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-cyan-500" />
                    {t("aiAnalytics.defectTrend", "Xu hướng lỗi")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {trend.isLoading ? <Skeleton className="h-62.5" /> :
                    trend.data?.length ? (
                      <ResponsiveContainer width="100%" height={250}>
                        <AreaChart data={trend.data}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <RechartsTooltip />
                          <Area type="monotone" dataKey="defectRate" stroke="#ef4444" fill="#ef444420" name={t("aiAnalytics.defectRate", "Tỷ lệ lỗi %")} />
                          <Area type="monotone" dataKey="yieldRate" stroke="#22c55e" fill="#22c55e20" name={t("aiAnalytics.yieldRate2", "Yield %")} />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : <EmptyChart />}
                </CardContent>
              </Card>

              {/* Pareto */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-orange-500" />
                    {t("aiAnalytics.pareto", "Phân tích Pareto lỗi")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {pareto.isLoading ? <Skeleton className="h-62.5" /> :
                    pareto.data?.length ? (
                      <ResponsiveContainer width="100%" height={250}>
                        <ComposedChart data={pareto.data}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis dataKey="defectType" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
                          <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                          <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} />
                          <RechartsTooltip />
                          <Bar yAxisId="left" dataKey="count" name={t("aiAnalytics.count", "Số lượng")} radius={[4, 4, 0, 0]}>
                            {pareto.data.map((_, i) => (
                              <Cell key={i} fill={COLORS[i % COLORS.length]} />
                            ))}
                          </Bar>
                          <Line yAxisId="right" type="monotone" dataKey="cumulativePercentage" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} name={t("aiAnalytics.cumulative", "T�ch lũy %")} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    ) : <EmptyChart />}
                </CardContent>
              </Card>
            </div>

            {/* Risk Assessment Overview */}
            {risk.data?.length ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Shield className="h-4 w-4 text-red-500" />
                    {t("aiAnalytics.risks", "Đánh giá rủi ro")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {risk.data.map((r, i) => (
                      <RiskCard key={i} risk={r} t={t} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          {/* ═══ TREND TAB ═══ */}
          <TabsContent value="trend" className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
              {/* Full trend chart */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{t("aiAnalytics.dailyTrend", "Xu hướng hàng ngày")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {trend.isLoading ? <Skeleton className="h-87.5" /> :
                    trend.data?.length ? (
                      <ResponsiveContainer width="100%" height={350}>
                        <LineChart data={trend.data}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <RechartsTooltip />
                          <Legend />
                          <Line type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2} name={t("aiAnalytics.totalInsp", "Tổng KT")} dot={false} />
                          <Line type="monotone" dataKey="pass" stroke="#22c55e" strokeWidth={2} name={t("aiAnalytics.pass", "Đạt")} dot={false} />
                          <Line type="monotone" dataKey="fail" stroke="#ef4444" strokeWidth={2} name={t("aiAnalytics.fail", "Lỗi")} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : <EmptyChart />}
                </CardContent>
              </Card>

              {/* Shift analysis */}
              {shift.data?.length ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Clock className="h-4 w-4 text-purple-500" />
                      {t("aiAnalytics.shiftAnalysis", "Phân tích theo ca")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={shift.data}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="shift" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <RechartsTooltip />
                        <Legend />
                        <Bar dataKey="totalInspections" fill="#3b82f6" name={t("aiAnalytics.totalInsp", "Tổng KT")} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="yieldRate" fill="#22c55e" name={t("aiAnalytics.yieldRate2", "Yield %")} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              ) : null}

              {/* Heatmap */}
              {heatmap.data ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Thermometer className="h-4 w-4 text-red-500" />
                      {t("aiAnalytics.heatmap", "Heatmap lỗi")}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {t("aiAnalytics.heatmapDesc", "Ma trận lỗi theo máy và loại lỗi (màu đậm = lỗi nhiều)")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <HeatmapGrid data={heatmap.data} />
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </TabsContent>

          {/* ═══ MACHINES TAB ═══ */}
          <TabsContent value="machines" className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-violet-500" />
                  {t("aiAnalytics.machineComparison", "So sánh hiệu suất máy")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {machPerf.isLoading ? <Skeleton className="h-87.5" /> :
                  machPerf.data?.length ? (
                    <ResponsiveContainer width="100%" height={350}>
                      <BarChart data={machPerf.data} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="machineCode" width={100} tick={{ fontSize: 11 }} />
                        <RechartsTooltip />
                        <Legend />
                        <Bar dataKey="yieldRate" fill="#22c55e" name={t("aiAnalytics.yieldRate2", "Yield %")} radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <EmptyChart />}
              </CardContent>
            </Card>

            {/* Machine stats table */}
            {machPerf.data?.length ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{t("aiAnalytics.machineDetails", "Chi tiết máy")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-75">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="py-2 px-3 font-medium">{t("aiAnalytics.machine", "Máy")}</th>
                          <th className="py-2 px-3 font-medium text-right">{t("aiAnalytics.totalInsp", "Tổng KT")}</th>
                          <th className="py-2 px-3 font-medium text-right">Yield</th>
                          <th className="py-2 px-3 font-medium text-right">{t("aiAnalytics.failRate", "Lỗi %")}</th>
                          <th className="py-2 px-3 font-medium text-right">{t("aiAnalytics.avgCycleTime", "Cycle (s)")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {machPerf.data.map((m, i) => (
                          <tr key={i} className="border-b hover:bg-muted/50">
                            <td className="py-2 px-3 font-medium">{m.machineCode}</td>
                            <td className="py-2 px-3 text-right">{m.totalInspections.toLocaleString()}</td>
                            <td className="py-2 px-3 text-right">
                              <Badge variant={m.yieldRate >= 95 ? "default" : m.yieldRate >= 90 ? "secondary" : "destructive"}>
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
                </CardContent>
              </Card>
            ) : null}

            {/* Correlation */}
            {corr.data?.length ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Target className="h-4 w-4 text-blue-500" />
                    {t("aiAnalytics.correlations", "Tương quan các yếu tố")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {corr.data.map((c, i) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                        <div>
                          <span className="font-medium text-sm">{c.factor1}</span>
                          <span className="text-muted-foreground mx-2">↔</span>
                          <span className="font-medium text-sm">{c.factor2}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={Math.abs(c.correlation) > 0.7 ? "destructive" : Math.abs(c.correlation) > 0.4 ? "secondary" : "outline"}>
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
          </TabsContent>

          {/* ═══ SPC TAB ═══ */}
          <TabsContent value="spc" className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4 text-green-500" />
                  {t("aiAnalytics.controlChart", "Biểu đồ kiểm soát (SPC X̄)")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("aiAnalytics.spcDesc", "UCL/LCL ± 3σ — Các điểm ngoài giới hạn được đánh dấu")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {control.isLoading ? <Skeleton className="h-95" /> :
                  control.data ? (
                    <div>
                      {/* Stats strip */}
                      <div className="flex gap-4 mb-4 text-xs">
                        <span>UCL: <strong className="text-red-500">{control.data.summary.ucl.toFixed(2)}</strong></span>
                        <span>CL: <strong className="text-blue-500">{control.data.summary.mean.toFixed(2)}</strong></span>
                        <span>LCL: <strong className="text-red-500">{control.data.summary.lcl.toFixed(2)}</strong></span>
                        {control.data.summary.cpk != null && (
                          <span>Cpk: <strong className={control.data.summary.cpk >= 1.33 ? "text-green-500" : control.data.summary.cpk >= 1.0 ? "text-yellow-500" : "text-red-500"}>{control.data.summary.cpk.toFixed(2)}</strong></span>
                        )}
                        <Badge variant={control.data.summary.outOfControlCount > 0 ? "destructive" : "default"} className="text-xs">
                          {t("aiAnalytics.oocPoints", "Ngo�i KS: {{count}}", { count: control.data.summary.outOfControlCount })}
                        </Badge>
                      </div>
                      <ResponsiveContainer width="100%" height={350}>
                        <ComposedChart data={control.data.points.map((p: any) => ({ ...p, oocValue: p.outOfControl ? p.value : undefined }))}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                          <RechartsTooltip />
                          <ReferenceLine y={control.data.summary.ucl} stroke="#ef4444" strokeDasharray="5 5" label={{ value: "UCL", position: "right", fontSize: 10 }} />
                          <ReferenceLine y={control.data.summary.mean} stroke="#3b82f6" strokeDasharray="3 3" label={{ value: "CL", position: "right", fontSize: 10 }} />
                          <ReferenceLine y={control.data.summary.lcl} stroke="#ef4444" strokeDasharray="5 5" label={{ value: "LCL", position: "right", fontSize: 10 }} />
                          <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={1.5} dot={false} name={t("aiAnalytics.value", "Giá trị")} />
                          <Scatter dataKey="oocValue" fill="#ef4444" name={t("aiAnalytics.oocPoint", "Ngoài kiểm soát")} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  ) : <EmptyChart />}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ FORECAST TAB ═══ */}
          <TabsContent value="forecast" className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-500" />
                  {t("aiAnalytics.yieldForecast", "Dự báo Yield (Holt-Winters)")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("aiAnalytics.forecastDesc", "Dự báo 7 ngày tới với khoảng tin cậy")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {forecast.isLoading ? <Skeleton className="h-87.5" /> :
                  forecast.data ? (
                    <div>
                      <div className="flex gap-4 mb-4 text-xs">
                        <span>{t("aiAnalytics.forecastTrend", "Xu hướng")}: <strong className={forecast.data.trend === "improving" ? "text-green-500" : forecast.data.trend === "declining" ? "text-red-500" : "text-yellow-500"}>{forecast.data.trend}</strong></span>
                        <span>RMSE: <strong>{forecast.data.rmse?.toFixed(3)}</strong></span>
                      </div>
                      <ResponsiveContainer width="100%" height={350}>
                        <AreaChart data={[
                          ...forecast.data.historical.map((h: any) => ({ ...h, type: "actual" })),
                          ...forecast.data.predicted.map((p: any) => ({ ...p, type: "forecast" })),
                        ]}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                          <RechartsTooltip />
                          <Legend />
                          <Area type="monotone" dataKey="upper" stroke="none" fill="#22c55e10" name={t("aiAnalytics.upperBound", "Giới hạn trên")} />
                          <Area type="monotone" dataKey="lower" stroke="none" fill="#22c55e10" name={t("aiAnalytics.lowerBound", "Giới hạn dưới")} />
                          <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={false} name={t("aiAnalytics.actual", "Thực tế")} />
                          <Line type="monotone" dataKey="predicted" stroke="#22c55e" strokeWidth={2} strokeDasharray="5 5" dot={false} name={t("aiAnalytics.predicted", "Dự báo")} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : <EmptyChart />}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ RISK TAB ═══ */}
          <TabsContent value="risk" className="space-y-4">
            {risk.isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40" />)}
              </div>
            ) : risk.data?.length ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {risk.data.map((r, i) => (
                  <RiskCard key={i} risk={r} t={t} detailed />
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Shield className="h-12 w-12 mx-auto mb-3 text-green-500" />
                  <p className="font-medium">{t("aiAnalytics.noRisks", "Không phát hiện rủi ro trong giai đoạn này")}</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

// ─── Sub-Components ───────────────────────────────────

function SummaryCard({ title, value, icon, color }: { title: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <Card>
      <CardContent className="py-4 flex items-center gap-3">
        <div className={`${color}`}>{icon}</div>
        <div>
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="text-lg font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyChart() {
  const { t } = useTranslation();
  return (
    <div className="h-62.5 flex items-center justify-center text-muted-foreground text-sm">
      {t("aiAnalytics.noData", "Không có dữ liệu trong khoảng thời gian này")}
    </div>
  );
}

function RiskCard({ risk, t, detailed }: { risk: any; t: any; detailed?: boolean }) {
  const levelColor: Record<string, string> = {
    critical: "bg-red-500",
    high: "bg-orange-500",
    medium: "bg-yellow-500",
    low: "bg-green-500",
  };
  return (
    <Card className="border-l-4" style={{ borderLeftColor: risk.level === "critical" ? "#ef4444" : risk.level === "high" ? "#f97316" : risk.level === "medium" ? "#eab308" : "#22c55e" }}>
      <CardContent className="py-3">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${levelColor[risk.level] ?? "bg-gray-400"}`} />
            <span className="font-medium text-sm">{risk.category}</span>
          </div>
          <Badge variant={risk.level === "critical" || risk.level === "high" ? "destructive" : "secondary"} className="text-xs">
            {t(`aiAnalytics.severity.${risk.level}`, risk.level)}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{risk.description}</p>
        {risk.score != null && (
          <div className="mt-2 text-xs text-muted-foreground">
            {t("aiAnalytics.riskScore", "Điểm rủi ro")}: <strong>{risk.score.toFixed(0)}</strong>/100
          </div>
        )}
        {detailed && risk.recommendation && (
          <div className="mt-2 p-2 bg-muted/50 rounded text-xs">
            <strong>{t("aiAnalytics.recommendation", "Khuyến nghị")}:</strong> {risk.recommendation}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// HeatmapGrid: accepts flat array {machineCode, hour, defectRate, total} from defectHeatmap endpoint
function HeatmapGrid({ data }: { data: Array<{ machineCode: string; hour: number; defectRate: number; total: number }> | undefined }) {
  if (!data?.length) return <EmptyChart />;

  const machines = Array.from(new Set(data.map(d => d.machineCode))).sort();
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const cellMap = new Map(data.map(d => [`${d.machineCode}:${d.hour}`, d]));
  const maxRate = Math.max(...data.map(d => d.defectRate), 0.001);

  return (
    <ScrollArea className="max-h-96">
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className="p-2 text-left font-medium sticky left-0 bg-background z-10 whitespace-nowrap">
                M&aacute;y / Gi&#x1EDD;
              </th>
              {hours.map(h => (
                <th key={h} className="p-1 text-center font-medium w-7 min-w-[28px]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {machines.map(machine => (
              <tr key={machine}>
                <td className="p-2 font-medium whitespace-nowrap sticky left-0 bg-background z-10">{machine}</td>
                {hours.map(h => {
                  const cell = cellMap.get(`${machine}:${h}`);
                  const intensity = cell ? cell.defectRate / maxRate : 0;
                  const bg = cell && cell.total > 0
                    ? `rgba(239,68,68,${Math.max(0.08, intensity)})`
                    : "transparent";
                  return (
                    <td
                      key={h}
                      className="p-0.5 text-center"
                      title={cell ? `${machine} ${h}h \u2014 ${(cell.defectRate * 100).toFixed(1)}% (${cell.total})` : `${machine} ${h}h \u2014 kh\u00f4ng c\u00f3 d\u1eef li\u1ec7u`}
                    >
                      <div
                        className="w-6 h-6 mx-auto rounded-sm flex items-center justify-center"
                        style={{
                          backgroundColor: bg,
                          border: (!cell || cell.total === 0) ? "1px solid var(--border)" : undefined,
                        }}
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
  );
}
