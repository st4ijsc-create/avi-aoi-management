import { useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import {
  PageHeader,
  PageContainer,
  ThemedLineChart,
  type ChartSeries,
} from "@/components/patterns";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TrendingUp,
  Activity,
  AlertTriangle,
  BarChart3,
  GitBranch,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

type AnalysisType = "analyze" | "forecast" | "anomaly" | "decompose" | "changepoints";

/** A single result row as returned by `aiTimeSeries.analyzeMetric`. */
interface ResultPoint {
  timestamp?: string | number;
  time?: string | number;
  value?: number;
  predicted?: number;
  lower?: number;
  upper?: number;
  isAnomaly?: boolean;
}

/** Compact numeric formatter for axis ticks / tooltips (light + dark safe). */
const formatMetric = (v: number): string =>
  v.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function AITimeSeriesPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<AnalysisType>("analyze");
  const [metric, setMetric] = useState("defect_rate");
  const [period, setPeriod] = useState("7d");

  // Single mutation: fetch + analyse DB metric data
  const analyzeMetric = trpc.aiTimeSeries.analyzeMetric.useMutation({
    onError: (err: { message: string }) => toast.error(err.message),
  });

  const isRunning = analyzeMetric.isPending;

  const handleRun = () => {
    analyzeMetric.mutate({ metric: metric as any, period: period as any, analysisType: activeTab });
  };

  const renderResult = (data: any) => {
    if (!data) return null;

    // ── Chart model: map the SAME result rows into chart series ───────────────
    const rawPoints: ResultPoint[] = Array.isArray(data.dataPoints) ? data.dataPoints : [];
    const hasPredicted = rawPoints.some((p) => typeof p.predicted === "number");
    const hasBounds = rawPoints.some(
      (p) => typeof p.lower === "number" && typeof p.upper === "number",
    );
    const anomalyPoints = rawPoints.filter((p) => p.isAnomaly === true);

    const chartData: Array<Record<string, number | string | null>> = rawPoints.map((p) => ({
      x: String(p.timestamp ?? p.time ?? ""),
      value: typeof p.value === "number" ? p.value : null,
      predicted: typeof p.predicted === "number" ? p.predicted : null,
      lower: typeof p.lower === "number" ? p.lower : null,
      upper: typeof p.upper === "number" ? p.upper : null,
    }));

    const chartSeries: ChartSeries[] = [
      { key: "value", name: t("ts.actual", "Thực tế") },
    ];
    if (hasPredicted) {
      chartSeries.push({
        key: "predicted",
        name:
          activeTab === "forecast"
            ? t("ts.forecast", "Dự báo")
            : t("ts.predicted", "Dự đoán"),
      });
    }
    if (hasBounds) {
      // Best-effort confidence band rendered as its two boundary lines (muted).
      chartSeries.push({ key: "upper", name: t("ts.upperBound", "Cận trên"), color: "var(--muted-foreground)" });
      chartSeries.push({ key: "lower", name: t("ts.lowerBound", "Cận dưới"), color: "var(--muted-foreground)" });
    }

    return (
      <div className="space-y-4">
        {/* Summary text */}
        {data.summary && (
          <div className="bg-muted p-4 rounded-lg">
            <p className="text-sm whitespace-pre-wrap">{data.summary}</p>
          </div>
        )}

        {/* PRIMARY view: time-series chart (actual vs predicted, + bounds) */}
        {rawPoints.length > 0 && (
          <div className="rounded-lg border p-3 space-y-2">
            <h3 className="text-sm font-medium flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4 text-primary" />
              {t("ts.chartTitle", "Biểu đồ chuỗi thời gian")}
            </h3>
            <ThemedLineChart
              data={chartData}
              xKey="x"
              series={chartSeries}
              height={320}
              yTickFormatter={formatMetric}
              emptyText={t("ts.noChartData", "Không có dữ liệu để vẽ biểu đồ")}
              aria-label={t("ts.chartTitle", "Biểu đồ chuỗi thời gian")}
            />
            {/* Anomaly / change-point points marked as a note below the chart */}
            {anomalyPoints.length > 0 && (
              <p className="text-xs text-destructive flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  {t("ts.anomalyMarks", "Điểm bất thường")} ({anomalyPoints.length}):{" "}
                  <span className="font-mono">
                    {anomalyPoints
                      .map((p) => String(p.timestamp ?? p.time ?? ""))
                      .join(", ")}
                  </span>
                </span>
              </p>
            )}
          </div>
        )}

        {/* DETAIL view: data points as table rows */}
        {data.dataPoints && Array.isArray(data.dataPoints) && data.dataPoints.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-3 py-2">{t("ts.time", "Thời gian")}</th>
                  <th className="text-right px-3 py-2">{t("ts.value", "Giá trị")}</th>
                  {data.dataPoints[0]?.predicted != null && (
                    <th className="text-right px-3 py-2">{t("ts.predicted", "Dự đoán")}</th>
                  )}
                  {data.dataPoints[0]?.isAnomaly != null && (
                    <th className="text-center px-3 py-2">{t("ts.anomaly", "Bất thường")}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {data.dataPoints.slice(0, 20).map((dp: any, idx: number) => (
                  <tr key={idx} className={dp.isAnomaly ? "bg-destructive/10" : ""}>
                    <td className="px-3 py-1.5 text-xs font-mono">{dp.timestamp || dp.time || idx}</td>
                    <td className="px-3 py-1.5 text-right">{typeof dp.value === "number" ? dp.value.toFixed(3) : dp.value}</td>
                    {dp.predicted != null && (
                      <td className="px-3 py-1.5 text-right text-info">{dp.predicted.toFixed(3)}</td>
                    )}
                    {dp.isAnomaly != null && (
                      <td className="px-3 py-1.5 text-center">
                        {dp.isAnomaly && <AlertTriangle className="h-4 w-4 text-destructive inline" />}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {data.dataPoints.length > 20 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                {t("ts.showingFirst", "Hiển thị 20 / {{total}} điểm dữ liệu", { total: data.dataPoints.length })}
              </p>
            )}
          </div>
        )}

        {/* Anomalies list */}
        {data.anomalies && Array.isArray(data.anomalies) && data.anomalies.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              {t("ts.anomaliesFound", "Phát hiện bất thường")}: {data.anomalies.length}
            </h3>
            <div className="space-y-2">
              {data.anomalies.map((a: any, idx: number) => (
                <div key={idx} className="border border-destructive/30 rounded-lg p-3 bg-destructive/5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-mono">{a.timestamp || a.time}</span>
                    <Badge variant="destructive">{a.severity || "anomaly"}</Badge>
                  </div>
                  {a.description && <p className="text-xs text-muted-foreground mt-1">{a.description}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Change points */}
        {data.changePoints && Array.isArray(data.changePoints) && data.changePoints.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-1.5">
              <GitBranch className="h-4 w-4 text-primary" />
              {t("ts.changePoints", "Điểm thay đổi")}: {data.changePoints.length}
            </h3>
            <div className="space-y-2">
              {data.changePoints.map((cp: any, idx: number) => (
                <div key={idx} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-mono">{cp.timestamp || cp.time}</span>
                    <Badge variant="outline">{cp.type || "change"}</Badge>
                  </div>
                  {cp.description && <p className="text-xs text-muted-foreground mt-1">{cp.description}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Generic JSON fallback */}
        {!data.summary && !data.dataPoints && !data.anomalies && !data.changePoints && (
          <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-lg">
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    );
  };

  const getActiveResult = () => analyzeMetric.data;

  const getActivePending = () => analyzeMetric.isPending;

  return (
    <DashboardLayout>
      <PageContainer>
        {/* Header */}
        <PageHeader
          icon={<TrendingUp className="h-6 w-6" />}
          title={t("ts.title", "Phân tích chuỗi thời gian")}
          description={t("ts.subtitle", "Phân tích xu hướng, dự báo, phát hiện bất thường bằng AI")}
        />

        {/* Controls */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <Label className="text-sm">{t("ts.metric", "Chỉ số")}</Label>
                <Select value={metric} onValueChange={setMetric}>
                  <SelectTrigger className="w-48 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="defect_rate">Defect Rate</SelectItem>
                    <SelectItem value="yield_rate">Yield Rate</SelectItem>
                    <SelectItem value="inspection_count">Inspection Count</SelectItem>
                    <SelectItem value="model_accuracy">Model Accuracy</SelectItem>
                    <SelectItem value="throughput">Throughput</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm">{t("ts.period", "Khoảng thời gian")}</Label>
                <Select value={period} onValueChange={setPeriod}>
                  <SelectTrigger className="w-36 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1d">1 {t("ts.day", "ngày")}</SelectItem>
                    <SelectItem value="7d">7 {t("ts.days", "ngày")}</SelectItem>
                    <SelectItem value="30d">30 {t("ts.days", "ngày")}</SelectItem>
                    <SelectItem value="90d">90 {t("ts.days", "ngày")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleRun} disabled={isRunning}>
                <Activity className="h-4 w-4 mr-1.5" />
                {isRunning
                  ? t("ts.running", "Đang phân tích...")
                  : t("ts.run", "Phân tích")}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Analysis Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as AnalysisType)}>
          <TabsList>
            <TabsTrigger value="analyze">
              <BarChart3 className="h-4 w-4 mr-1.5" />
              {t("ts.analyze", "Phân tích")}
            </TabsTrigger>
            <TabsTrigger value="forecast">
              <TrendingUp className="h-4 w-4 mr-1.5" />
              {t("ts.forecast", "Dự báo")}
            </TabsTrigger>
            <TabsTrigger value="anomaly">
              <AlertTriangle className="h-4 w-4 mr-1.5" />
              {t("ts.anomalyDetect", "Phát hiện bất thường")}
            </TabsTrigger>
            <TabsTrigger value="decompose">
              <Activity className="h-4 w-4 mr-1.5" />
              {t("ts.decompose", "Phân rã")}
            </TabsTrigger>
            <TabsTrigger value="changepoints">
              <GitBranch className="h-4 w-4 mr-1.5" />
              {t("ts.changePoints", "Điểm thay đổi")}
            </TabsTrigger>
          </TabsList>

          {["analyze", "forecast", "anomaly", "decompose", "changepoints"].map((tab) => (
            <TabsContent key={tab} value={tab}>
              <Card>
                <CardContent className="pt-6">
                  {getActivePending() ? (
                    <div className="space-y-3">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-32 w-full" />
                    </div>
                  ) : getActiveResult() ? (
                    renderResult(getActiveResult())
                  ) : (
                    <div className="text-center text-muted-foreground py-12">
                      <Activity className="h-10 w-10 mx-auto mb-2 opacity-40" />
                      <p>{t("ts.clickRun", "Chọn chỉ số, khoảng thời gian và bấm 'Phân tích' để xem kết quả")}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </PageContainer>
    </DashboardLayout>
  );
}
