import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import ReportExportButton from "@/components/ReportExportButton";
import AIGuidedActionCards from "@/components/AIGuidedActionCards";
import { buildAiExportConfig } from "@/lib/aiReportExport";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { PageHeader, PageContainer } from "@/components/patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FileText,
  Calendar,
  BarChart3,
  AlertTriangle,
  TrendingUp,
  FileBarChart,
  CheckCircle2,
} from "lucide-react";

type ReportType = "daily" | "rca" | "model" | "executive";

type NarrativeMeta = { generatedBy?: string; confidence?: number; model?: string } | undefined;

/**
 * doc69 A4 (audit U3) — provenance chip for an AI-narrative section: is the prose
 * model-authored (GGUF llama.cpp / OpenAI) or a rule-based offline template? Fed
 * by the `narrativeMetadata.generatedBy` field every report already returns
 * (server/services/aiReportGenerator.ts `generateNarrative`) — this only renders
 * it, no new server wiring needed. Renders nothing when metadata is absent (older
 * cached results / unexpected shape) rather than guessing.
 */
function NarrativeProvenanceBadge({ meta, t }: { meta: NarrativeMeta; t: (k: string, d?: string) => string }) {
  if (!meta?.generatedBy) return null;
  const isOffline = meta.generatedBy === "offline";
  const label =
    meta.generatedBy === "gguf"
      ? t("rp.provenanceGguf", "AI (GGUF Qwen3 cục bộ)")
      : meta.generatedBy === "openai"
        ? t("rp.provenanceOpenai", "AI (OpenAI)")
        : t("rp.provenanceOffline", "Bản mẫu (ngoại tuyến)");
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <Badge
        variant={isOffline ? "secondary" : "outline"}
        className="text-[10px] py-0 h-5 font-normal"
        title={t("rp.provenanceHint", "Nguồn tạo nội dung tường thuật của báo cáo này")}
      >
        {label}
      </Badge>
      {!isOffline && meta.model && (
        <span className="text-[10px] text-muted-foreground font-mono">{meta.model}</span>
      )}
    </div>
  );
}

/**
 * ★★★ G4-A VIỆC 1 lớp ① — **NGÔN NGỮ CỦA BÁO CÁO PHẢI ĐI THEO NGÔN NGỮ GIAO DIỆN.**
 *
 * Trước bản vá, `handleGenerate` gửi `{ startDate, endDate }` cho **cả 4 tab** và **không hề có ô
 * `language`**; máy chủ khai `.default("en")` ⇒ trong một nhà máy Việt Nam, mọi báo cáo điều hành
 * đều ra tiếng Anh, và **không có bề mặt nào để người dùng chọn khác đi**.
 *
 * ⚠ `i18n.language` có thể là mã vùng (`"vi-VN"`, `"zh-CN"`) hoặc một ngôn ngữ hệ chưa hỗ trợ.
 * Hàm này quy về đúng ba mã mà `aiReportRouter` nhận. Rơi về `"vi"` (không phải `"en"`) là lựa
 * chọn có chủ ý: đây là mặc định của hệ, và một mã lạ **không được** lặng lẽ biến báo cáo thành
 * tiếng Anh — đó chính là hình dạng của lỗi vừa vá.
 */
function ngonNguBaoCao(lng: string | undefined): "vi" | "en" | "zh" {
  const g = (lng ?? "vi").toLowerCase();
  if (g.startsWith("en")) return "en";
  if (g.startsWith("zh")) return "zh";
  return "vi";
}

export default function AIReportsPage() {
  const { t, i18n } = useTranslation();
  // i18next's TFunction has an overloaded signature that TS won't structurally
  // match against a plain `(k, d?) => string` prop type (same reason
  // buildExportConfig below wraps `t` instead of passing it directly) — wrap
  // once here and reuse for every NarrativeProvenanceBadge instance.
  const tr = useCallback((k: string, d?: string) => (d !== undefined ? t(k, d) : t(k)), [t]);
  const [activeTab, setActiveTab] = useState<ReportType>("daily");
  const [dateRange, setDateRange] = useState({
    from: new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0],
    to: new Date().toISOString().split("T")[0],
  });

  // Mutations for generating reports
  const dailySummary = trpc.aiReport.dailySummary.useMutation({
    onError: (err) => toastTrpcError(err),
  });
  const rcaReport = trpc.aiReport.rcaReport.useMutation({
    onError: (err) => toastTrpcError(err),
  });
  const modelPerformance = trpc.aiReport.modelPerformance.useMutation({
    onError: (err) => toastTrpcError(err),
  });
  const executiveSummary = trpc.aiReport.executiveSummary.useMutation({
    onError: (err) => toastTrpcError(err),
  });

  const isGenerating =
    dailySummary.isPending || rcaReport.isPending || modelPerformance.isPending || executiveSummary.isPending;

  const handleGenerate = () => {
    // ⚠ `language` phải nằm ở ĐÂY — một object `params` dùng chung cho cả bốn nhánh — chứ không
    //   thêm vào từng `mutate()`. Bốn chỗ khai riêng là bốn chỗ để quên chỗ thứ tư, và đó đúng là
    //   hình dạng cũ của lỗi (một ô thiếu, lặp lại y hệt ở cả 4 tab).
    const params = {
      startDate: dateRange.from,
      endDate: dateRange.to,
      language: ngonNguBaoCao(i18n.language),
    };
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

  // Data of the CURRENTLY-selected tab (what's on screen) — drives the export.
  const activeData =
    activeTab === "daily"
      ? dailySummary.data
      : activeTab === "rca"
        ? rcaReport.data
        : activeTab === "model"
          ? modelPerformance.data
          : executiveSummary.data;

  // Build a ReportExportConfig from the on-screen AI report so the richest
  // management content can leave the page as PDF / XLSX / HTML (doc 32 P0 #3).
  // Logic lives in lib/aiReportExport.buildAiExportConfig (unit-tested).
  const buildExportConfig = useCallback(
    () =>
      buildAiExportConfig(activeTab, activeData, dateRange, (k: string, d?: string) =>
        d !== undefined ? t(k, d) : t(k),
      ),
    [activeTab, activeData, dateRange, t],
  );

  return (
    <DashboardLayout>
      <PageContainer>
        {/* Header */}
        <PageHeader
          icon={<FileText className="h-6 w-6 text-primary" />}
          title={t("rp.title", "Báo cáo AI")}
          description={t("rp.subtitle", "Tạo báo cáo phân tích AI tự động - Tổng hợp, RCA, Hiệu suất mô hình")}
        />

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
              {/* Export the on-screen AI report (PDF / XLSX / HTML) — doc 32 P0 #3. */}
              {activeData && <ReportExportButton getConfig={buildExportConfig} />}
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
                        <p className="text-lg font-bold text-success">{dailySummary.data.okCount}</p>
                      </div>
                      <div className="border rounded-lg p-3">
                        <span className="text-xs text-muted-foreground">NG</span>
                        <p className="text-lg font-bold text-destructive">{dailySummary.data.ngCount}</p>
                      </div>
                      <div className="border rounded-lg p-3">
                        <span className="text-xs text-muted-foreground">{t("rp.yield", "Yield")}</span>
                        <p className="text-lg font-bold">{(dailySummary.data.yieldRate * 100).toFixed(1)}%</p>
                      </div>
                    </div>
                    {dailySummary.data.narrative && (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <NarrativeProvenanceBadge meta={dailySummary.data.narrativeMetadata as NarrativeMeta} t={tr} />
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
                        <NarrativeProvenanceBadge meta={rcaReport.data.narrativeMetadata as NarrativeMeta} t={tr} />
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

                    {/* doc69 Wave2 A3 — close the loop: 1-tap propose buttons for any
                        action item above that maps to a KNOWN write-tool (server-side
                        RBAC-gated; hidden entirely when nothing maps or the machine
                        wasn't scoped, or the viewer isn't permitted). */}
                    {Array.isArray((rcaReport.data as any)?.suggestedActions) &&
                      (rcaReport.data as any).suggestedActions.length > 0 && (
                        <AIGuidedActionCards
                          onSend={() => {}}
                          hideStaticActions
                          suggestedActions={(rcaReport.data as any).suggestedActions}
                        />
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
                        <NarrativeProvenanceBadge meta={modelPerformance.data.narrativeMetadata as NarrativeMeta} t={tr} />
                        <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-lg">
                          {modelPerformance.data.narrative}
                        </pre>
                      </div>
                    )}
                    {modelPerformance.data.models?.length > 0 && (
                      <div className="border rounded-lg overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Model</TableHead>
                              <TableHead>{t("rp.volume", "Số lượt suy luận")}</TableHead>
                              <TableHead>{t("rp.latencyP95", "Độ trễ p95")}</TableHead>
                              <TableHead>{t("rp.errorRate", "Tỷ lệ lỗi")}</TableHead>
                              <TableHead>{t("rp.accuracy", "Độ chính xác")}</TableHead>
                              <TableHead>Drift</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {modelPerformance.data.models.map((m: any) => (
                              <TableRow key={m.modelId}>
                                <TableCell className="font-mono text-xs">{m.modelCode}</TableCell>
                                {m.dataAvailable === false ? (
                                  <TableCell colSpan={5} className="text-xs text-muted-foreground">
                                    {t("rp.metricsUnavailable", "Số liệu chưa khả dụng")}
                                  </TableCell>
                                ) : (
                                  <>
                                    {/* doc69 A4 — dataAvailable:true only guarantees SOME field
                                        is real; each cell below still branches on its own
                                        nullness (e.g. currentAccuracy has no real source yet
                                        even when latency/error/drift do) rather than assuming
                                        every metric is populated. */}
                                    <TableCell>{m.totalPredictions ?? "—"}</TableCell>
                                    <TableCell>{m.p95LatencyMs != null ? `${m.p95LatencyMs} ms` : "—"}</TableCell>
                                    <TableCell>{m.errorRate != null ? `${(m.errorRate * 100).toFixed(1)}%` : "—"}</TableCell>
                                    <TableCell>{m.currentAccuracy != null ? `${(m.currentAccuracy * 100).toFixed(1)}%` : "—"}</TableCell>
                                    <TableCell>
                                      {m.driftDetected === true ? (
                                        <AlertTriangle className="h-4 w-4 text-warning" aria-label={t("rp.driftDetected", "Phát hiện dịch chuyển")} />
                                      ) : m.driftDetected === false ? (
                                        <CheckCircle2 className="h-4 w-4 text-success" aria-label={t("rp.noDrift", "Không dịch chuyển")} />
                                      ) : (
                                        <span className="text-xs text-muted-foreground" aria-label={t("rp.driftUnknown", "Chưa kiểm tra")}>—</span>
                                      )}
                                    </TableCell>
                                  </>
                                )}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
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
                        <NarrativeProvenanceBadge meta={executiveSummary.data.narrativeMetadata as NarrativeMeta} t={tr} />
                        <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-lg">
                          {executiveSummary.data.narrative}
                        </pre>
                      </div>
                    )}
                    {executiveSummary.data.forecast && (
                      <div className="bg-info/10 border border-info/30 p-4 rounded-lg">
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
      </PageContainer>
    </DashboardLayout>
  );
}
