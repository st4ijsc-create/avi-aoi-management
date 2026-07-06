/**
 * Report Aggregators Panel (Wave W3-C · surfaces doc 32 R1 + R2).
 * ============================================================================
 * The report data-layer helpers from doc 32 R1 (server/db/reportAggregators.ts →
 * trpc.reportAggregators.*) were built with ZERO UI. This panel finally renders
 * them as three management charts:
 *   • Defect Pareto by category/severity/IPC-section (bar + cumulative % line)
 *   • Yield by product (bar)
 *   • Yield trend by ISO week (line)
 * plus a small "Recent reports" list over the persisted artifact store
 * (trpc.reportArtifact.list / .download — doc 32 R2, of which only 1/5 procs had UI).
 *
 * 100% read-only. Mirrors the design-system chart tokens + loading/empty/error
 * patterns used across AIPerformanceDashboard / OEEDashboard. All windows are
 * factory-local (the server resolves the "YYYY-MM-DD" strings via
 * resolveFactoryDateWindow), so we pass plain date strings.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  chartColor,
  chartTooltipStyle,
  chartTooltipLabelStyle,
  chartGridProps,
  chartAxisTick,
} from "@/components/patterns";
import {
  BarChart,
  Bar,
  ComposedChart,
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  BarChart3,
  TrendingUp,
  PieChart,
  FileArchive,
  Download,
  RefreshCw,
  Loader2,
  AlertTriangle,
} from "lucide-react";

type Dimension = "category" | "severity" | "ipcSection";

/** Convert a "days back" preset into a factory-local YYYY-MM-DD window. */
function windowFor(days: number): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

function ChartCard({
  icon,
  title,
  desc,
  loading,
  error,
  empty,
  emptyMsg,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  desc?: string;
  loading: boolean;
  error?: string | null;
  empty: boolean;
  emptyMsg: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">{icon}{title}</CardTitle>
        {desc && <CardDescription className="text-xs">{desc}</CardDescription>}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : error ? (
          <div className="h-64 flex items-center justify-center text-sm text-destructive gap-2">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        ) : empty ? (
          <div className="h-64 flex items-center justify-center text-sm text-muted-foreground text-center px-4">
            {emptyMsg}
          </div>
        ) : (
          <div className="h-64">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ReportAggregatorsPanel() {
  const { t } = useTranslation();
  const [days, setDays] = useState(30);
  const [dimension, setDimension] = useState<Dimension>("category");
  const win = useMemo(() => windowFor(days), [days]);

  // ── (1) Defect Pareto by category/severity/IPC-section ──
  const paretoQ = trpc.reportAggregators.defectParetoByCategory.useQuery(
    { ...win, dimension, topN: 10 },
    { staleTime: 60_000, retry: false },
  );
  const paretoData = useMemo(
    () =>
      (paretoQ.data?.items ?? []).map((it) => ({
        key: it.key,
        count: it.count,
        cumulative: it.cumulativePercentage,
      })),
    [paretoQ.data],
  );

  // ── (2) Yield by product ──
  const yieldProductQ = trpc.reportAggregators.yieldByProduct.useQuery(win, {
    staleTime: 60_000,
    retry: false,
  });
  const yieldProductData = useMemo(
    () =>
      (yieldProductQ.data ?? []).slice(0, 12).map((r) => ({
        name: r.productCode || r.productName || (r.productModelId ? `#${r.productModelId}` : t("reportAgg.unassigned", "Chưa gán")),
        yieldRate: r.yieldRate,
        total: r.total,
      })),
    [yieldProductQ.data, t],
  );

  // ── (3) Yield trend by week ──
  const yieldTrendQ = trpc.reportAggregators.yieldTrendByWeek.useQuery(win, {
    staleTime: 60_000,
    retry: false,
  });
  const yieldTrendData = useMemo(
    () => (yieldTrendQ.data ?? []).map((r) => ({ week: r.isoWeek, yieldRate: r.yieldRate, total: r.total })),
    [yieldTrendQ.data],
  );

  // ── (4) Recent report artifacts (doc 32 R2) ──
  const artifactsQ = trpc.reportArtifact.list.useQuery({ limit: 8 }, { staleTime: 30_000, retry: false });
  const artifacts: any[] = (artifactsQ.data as any)?.items ?? [];
  const utils = trpc.useUtils();
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const downloadArtifact = async (id: number) => {
    setDownloadingId(id);
    try {
      const dl = await utils.reportArtifact.download.fetch({ id });
      const url = (dl as any)?.downloadUrl as string | undefined;
      if (url) window.open(url, "_blank", "noopener");
    } catch {
      /* surfaced via the disabled/no-op — the list stays intact */
    } finally {
      setDownloadingId(null);
    }
  };

  const refetchAll = () => {
    paretoQ.refetch();
    yieldProductQ.refetch();
    yieldTrendQ.refetch();
    artifactsQ.refetch();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              {t("reportAgg.title", "Phân tích báo cáo sản xuất")}
            </CardTitle>
            <CardDescription>
              {t("reportAgg.desc", "Pareto lỗi theo nhóm, hiệu suất theo sản phẩm & xu hướng theo tuần (chỉ đọc)")}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">{t("common.sevenDays", "7 ngày")}</SelectItem>
                <SelectItem value="30">{t("common.thirtyDays", "30 ngày")}</SelectItem>
                <SelectItem value="90">{t("common.ninetyDays", "90 ngày")}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={refetchAll}>
              <RefreshCw className="h-4 w-4 mr-1" /> {t("common.refresh", "Làm mới")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Defect Pareto */}
          <ChartCard
            icon={<PieChart className="h-4 w-4 text-warning" />}
            title={t("reportAgg.defectPareto", "Pareto lỗi theo nhóm")}
            desc={
              paretoQ.data
                ? t("reportAgg.paretoMeta", "{{c}} lỗi phân loại / {{u}} chưa phân loại", {
                    c: paretoQ.data.classifiedDefects,
                    u: paretoQ.data.unclassifiedDefects,
                  })
                : undefined
            }
            loading={paretoQ.isLoading}
            error={paretoQ.error?.message ?? null}
            empty={paretoData.length === 0}
            emptyMsg={t("reportAgg.emptyPareto", "Không có lỗi NG trong khoảng thời gian này.")}
          >
            <div className="mb-2 flex items-center gap-1">
              {(["category", "severity", "ipcSection"] as Dimension[]).map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={dimension === d ? "default" : "outline"}
                  className="h-6 px-2 text-[11px]"
                  onClick={() => setDimension(d)}
                >
                  {t(`reportAgg.dim.${d}`, d)}
                </Button>
              ))}
            </div>
            <ResponsiveContainer width="100%" height="88%">
              <ComposedChart data={paretoData} margin={{ top: 4, right: 8, bottom: 4, left: -8 }}>
                <CartesianGrid {...chartGridProps} />
                <XAxis dataKey="key" tick={chartAxisTick} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis yAxisId="left" tick={chartAxisTick} />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={chartAxisTick} unit="%" />
                <RTooltip contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} />
                <Bar yAxisId="left" dataKey="count" name={t("reportAgg.count", "Số lỗi")} fill={chartColor(0)} radius={[3, 3, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="cumulative" name={t("reportAgg.cumulative", "Tích lũy %")} stroke={chartColor(3)} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Yield by product */}
          <ChartCard
            icon={<BarChart3 className="h-4 w-4 text-success" />}
            title={t("reportAgg.yieldByProduct", "Hiệu suất theo sản phẩm")}
            loading={yieldProductQ.isLoading}
            error={yieldProductQ.error?.message ?? null}
            empty={yieldProductData.length === 0}
            emptyMsg={t("reportAgg.emptyYield", "Không có dữ liệu kiểm tra trong khoảng thời gian này.")}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={yieldProductData} margin={{ top: 4, right: 8, bottom: 4, left: -8 }}>
                <CartesianGrid {...chartGridProps} />
                <XAxis dataKey="name" tick={chartAxisTick} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis domain={[0, 100]} tick={chartAxisTick} unit="%" />
                <RTooltip contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} />
                <Bar dataKey="yieldRate" name={t("reportAgg.yieldRate", "Hiệu suất %")} fill={chartColor(1)} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Yield trend by week */}
        <ChartCard
          icon={<TrendingUp className="h-4 w-4 text-info" />}
          title={t("reportAgg.yieldTrend", "Xu hướng hiệu suất theo tuần (ISO)")}
          loading={yieldTrendQ.isLoading}
          error={yieldTrendQ.error?.message ?? null}
          empty={yieldTrendData.length === 0}
          emptyMsg={t("reportAgg.emptyTrend", "Không có dữ liệu tuần nào trong khoảng thời gian này.")}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={yieldTrendData} margin={{ top: 4, right: 8, bottom: 4, left: -8 }}>
              <CartesianGrid {...chartGridProps} />
              <XAxis dataKey="week" tick={chartAxisTick} />
              <YAxis domain={[0, 100]} tick={chartAxisTick} unit="%" />
              <RTooltip contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} />
              <Legend />
              <Line type="monotone" dataKey="yieldRate" name={t("reportAgg.yieldRate", "Hiệu suất %")} stroke={chartColor(2)} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Recent report artifacts (doc 32 R2) */}
        <div>
          <div className="flex items-center gap-2 mb-2 text-sm font-medium">
            <FileArchive className="h-4 w-4 text-muted-foreground" />
            {t("reportAgg.recentReports", "Báo cáo gần đây")}
          </div>
          {artifactsQ.isLoading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : artifactsQ.error ? (
            <div className="text-xs text-destructive flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> {artifactsQ.error.message}
            </div>
          ) : artifacts.length === 0 ? (
            <div className="text-sm text-muted-foreground py-3 text-center">
              {t("reportAgg.noReports", "Chưa có báo cáo nào được lưu.")}
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {artifacts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{a.title || a.reportType}</div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px] py-0 h-4 uppercase">{a.format}</Badge>
                      <span>{a.reportType}</span>
                      {a.createdAt && <span>{new Date(a.createdAt).toLocaleString()}</span>}
                      {typeof a.fileSize === "number" && a.fileSize > 0 && (
                        <span>{(a.fileSize / 1024).toFixed(0)} KB</span>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    disabled={downloadingId === a.id}
                    onClick={() => downloadArtifact(a.id)}
                  >
                    {downloadingId === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
