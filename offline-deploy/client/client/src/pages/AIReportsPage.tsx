import { useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText,
  RefreshCw,
  Download,
  Calendar,
  BarChart3,
  AlertTriangle,
  TrendingUp,
  FileBarChart,
} from "lucide-react";
import { toast } from "sonner";

type ReportType = "daily" | "rca" | "model" | "executive";

export default function AIReportsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ReportType>("daily");
  const [dateRange, setDateRange] = useState({
    from: new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0],
    to: new Date().toISOString().split("T")[0],
  });

  // Mutations for generating reports
  const dailySummary = trpc.aiReport.dailySummary.useMutation({
    onError: (err) => toast.error(err.message),
  });
  const rcaReport = trpc.aiReport.rcaReport.useMutation({
    onError: (err) => toast.error(err.message),
  });
  const modelPerformance = trpc.aiReport.modelPerformance.useMutation({
    onError: (err) => toast.error(err.message),
  });
  const executiveSummary = trpc.aiReport.executiveSummary.useMutation({
    onError: (err) => toast.error(err.message),
  });

  const isGenerating =
    dailySummary.isPending || rcaReport.isPending || modelPerformance.isPending || executiveSummary.isPending;

  const handleGenerate = () => {
    const params = { startDate: dateRange.from, endDate: dateRange.to };
    switch (activeTab) {
      case "daily":
        dailySummary.mutate(params);
        break;
      case "rca":
        rcaReport.mutate(params);
        break;
      case "model":
        modelPerformance.mutate(params);
        break;
      case "executive":
        executiveSummary.mutate(params);
        break;
    }
  };

  const currentReport =
    dailySummary.data || rcaReport.data || modelPerformance.data || executiveSummary.data;

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-indigo-500/10 flex items-center justify-center">
              <FileText className="h-6 w-6 text-indigo-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{t("rp.title", "Báo cáo AI")}</h1>
              <p className="text-sm text-muted-foreground">
                {t("rp.subtitle", "Tạo báo cáo phân tích AI tự động - Tổng hợp, RCA, Hiệu suất mô hình")}
              </p>
            </div>
          </div>
        </div>

        {/* Date Range + Generate */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <Label className="text-sm">{t("rp.from", "Từ ngày")}</Label>
                <Input
                  type="date"
                  value={dateRange.from}
                  onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
                  className="mt-1 w-44"
                />
              </div>
              <div>
                <Label className="text-sm">{t("rp.to", "Đến ngày")}</Label>
                <Input
                  type="date"
                  value={dateRange.to}
                  onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
                  className="mt-1 w-44"
                />
              </div>
              <Button onClick={handleGenerate} disabled={isGenerating}>
                <FileBarChart className="h-4 w-4 mr-1.5" />
                {isGenerating
                  ? t("rp.generating", "Đang tạo...")
                  : t("rp.generate", "Tạo báo cáo")}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Report Type Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ReportType)}>
          <TabsList>
            <TabsTrigger value="daily">
              <Calendar className="h-4 w-4 mr-1.5" />
              {t("rp.daily", "Tổng hợp hàng ngày")}
            </TabsTrigger>
            <TabsTrigger value="rca">
              <AlertTriangle className="h-4 w-4 mr-1.5" />
              {t("rp.rca", "Phân tích nguyên nhân")}
            </TabsTrigger>
            <TabsTrigger value="model">
              <TrendingUp className="h-4 w-4 mr-1.5" />
              {t("rp.model", "Hiệu suất mô hình")}
            </TabsTrigger>
            <TabsTrigger value="executive">
              <BarChart3 className="h-4 w-4 mr-1.5" />
              {t("rp.executive", "Báo cáo tổng quan")}
            </TabsTrigger>
          </TabsList>

          {/* Daily Summary */}
          <TabsContent value="daily">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  {t("rp.dailyTitle", "Báo cáo tổng hợp hàng ngày")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {dailySummary.isPending ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                ) : dailySummary.data ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="border rounded-lg p-3">
                        <span className="text-xs text-muted-foreground">{t("rp.totalInspections", "Tổng kiểm tra")}</span>
                        <p className="text-lg font-bold">{dailySummary.data.totalInspections}</p>
                      </div>
                      <div className="border rounded-lg p-3">
                        <span className="text-xs text-muted-foreground">OK</span>
                        <p className="text-lg font-bold text-green-600">{dailySummary.data.okCount}</p>
                      </div>
                      <div className="border rounded-lg p-3">
                        <span className="text-xs text-muted-foreground">NG</span>
                        <p className="text-lg font-bold text-red-600">{dailySummary.data.ngCount}</p>
                      </div>
                      <div className="border rounded-lg p-3">
                        <span className="text-xs text-muted-foreground">{t("rp.yield", "Yield")}</span>
                        <p className="text-lg font-bold">{(dailySummary.data.yieldRate * 100).toFixed(1)}%</p>
                      </div>
                    </div>
                    {dailySummary.data.narrative && (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-lg">
                          {dailySummary.data.narrative}
                        </pre>
                      </div>
                    )}
                    {dailySummary.data.recommendations?.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">{t("rp.recommendations", "Khuyến nghị")}</h4>
                        <ul className="list-disc list-inside text-sm space-y-1">
                          {dailySummary.data.recommendations.map((r: string, i: number) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {t("rp.clickGenerate", "Chọn khoảng thời gian và bấm 'Tạo báo cáo' để xem kết quả")}
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* RCA Report */}
          <TabsContent value="rca">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  {t("rp.rcaTitle", "Phân tích nguyên nhân gốc (RCA)")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {rcaReport.isPending ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                ) : rcaReport.data ? (
                  <div className="space-y-4">
                    {rcaReport.data.narrative && (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-lg">
                          {rcaReport.data.narrative}
                        </pre>
                      </div>
                    )}
                    {rcaReport.data.actionItems?.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">{t("rp.actionItems", "Hành động cần làm")}</h4>
                        <ul className="list-disc list-inside text-sm space-y-1">
                          {rcaReport.data.actionItems.map((item: string, i: number) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {t("rp.clickGenerate", "Chọn khoảng thời gian và bấm 'Tạo báo cáo' để xem kết quả")}
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Model Performance */}
          <TabsContent value="model">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  {t("rp.modelTitle", "Báo cáo hiệu suất mô hình AI")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {modelPerformance.isPending ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                ) : modelPerformance.data ? (
                  <div className="space-y-4">
                    {modelPerformance.data.narrative && (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-lg">
                          {modelPerformance.data.narrative}
                        </pre>
                      </div>
                    )}
                    {modelPerformance.data.models?.length > 0 && (
                      <div className="border rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-muted">
                            <tr>
                              <th className="px-3 py-2 text-left">Model</th>
                              <th className="px-3 py-2 text-left">{t("rp.accuracy", "Độ chính xác")}</th>
                              <th className="px-3 py-2 text-left">{t("rp.trend", "Xu hướng")}</th>
                              <th className="px-3 py-2 text-left">Drift</th>
                            </tr>
                          </thead>
                          <tbody>
                            {modelPerformance.data.models.map((m: any) => (
                              <tr key={m.modelId} className="border-t">
                                <td className="px-3 py-2 font-mono text-xs">{m.modelCode}</td>
                                <td className="px-3 py-2">{(m.currentAccuracy * 100).toFixed(1)}%</td>
                                <td className="px-3 py-2">
                                  <Badge variant={m.accuracyTrend === "improving" ? "default" : m.accuracyTrend === "declining" ? "destructive" : "secondary"}>
                                    {m.accuracyTrend}
                                  </Badge>
                                </td>
                                <td className="px-3 py-2">{m.driftDetected ? "⚠️" : "✅"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {t("rp.clickGenerate", "Chọn khoảng thời gian và bấm 'Tạo báo cáo' để xem kết quả")}
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Executive Summary */}
          <TabsContent value="executive">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  {t("rp.executiveTitle", "Báo cáo tổng quan dành cho lãnh đạo")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {executiveSummary.isPending ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                ) : executiveSummary.data ? (
                  <div className="space-y-4">
                    {executiveSummary.data.kpis && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="border rounded-lg p-3">
                          <span className="text-xs text-muted-foreground">{t("rp.totalProduction", "Tổng sản xuất")}</span>
                          <p className="text-lg font-bold">{executiveSummary.data.kpis.totalProduction}</p>
                        </div>
                        <div className="border rounded-lg p-3">
                          <span className="text-xs text-muted-foreground">Yield</span>
                          <p className="text-lg font-bold">{(executiveSummary.data.kpis.overallYield * 100).toFixed(1)}%</p>
                        </div>
                        <div className="border rounded-lg p-3">
                          <span className="text-xs text-muted-foreground">{t("rp.defectRate", "Tỷ lệ lỗi")}</span>
                          <p className="text-lg font-bold">{(executiveSummary.data.kpis.avgDefectRate * 100).toFixed(1)}%</p>
                        </div>
                        <div className="border rounded-lg p-3">
                          <span className="text-xs text-muted-foreground">{t("rp.bestMachine", "Máy tốt nhất")}</span>
                          <p className="text-lg font-bold">{executiveSummary.data.kpis.topPerformingMachine}</p>
                        </div>
                      </div>
                    )}
                    {executiveSummary.data.narrative && (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-lg">
                          {executiveSummary.data.narrative}
                        </pre>
                      </div>
                    )}
                    {executiveSummary.data.forecast && (
                      <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg">
                        <h4 className="text-sm font-medium mb-1">{t("rp.forecast", "Dự báo")}</h4>
                        <p className="text-sm">{executiveSummary.data.forecast}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {t("rp.clickGenerate", "Chọn khoảng thời gian và bấm 'Tạo báo cáo' để xem kết quả")}
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
