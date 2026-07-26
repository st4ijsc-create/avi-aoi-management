/**
 * AI Analysis Hub (Wave W3-C · surfaces doc 35 F1 — trpc.aiAnalysisHub.*).
 * ============================================================================
 * The aiAnalysisHub router exposes 13 user-selectable AI analyses in three
 * families (image / data / report) via `getCapabilities`, but had ZERO UI.
 *
 * This section renders the full capability catalogue (a clean selector), then
 * wires the SELF-CONTAINED analyses — the four report generators whose only
 * inputs are a date window (+ optional factory/machine/language). Their results
 * carry a `narrative` plus structured fields and a `narrativeMetadata` block
 * (generatedBy + confidence) which we surface as the rationale/citation strip.
 *
 * The image analyses (need an uploaded image key) and the time-series analyses
 * (need a raw numeric dataPoints array) are shown in the catalogue but are NOT
 * runnable here — they belong on the image-review / time-series surfaces that
 * own that input. Selecting one shows an honest "run it from …" note.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sparkles,
  FileText,
  Image as ImageIcon,
  LineChart,
  Play,
  Loader2,
  Info,
  AlertTriangle,
  BadgeCheck,
} from "lucide-react";

// Capability ids that are self-contained (report generators — date window only).
const RUNNABLE_REPORTS = new Set([
  "daily_quality_summary",
  "root_cause_analysis",
  "model_performance_report",
  "executive_summary",
]);

type Capability = {
  id: string;
  name: string;
  description: string;
  category: string;
  endpoint: string;
  requiredInputs: string[];
  optionalInputs: string[];
};

function familyIcon(category: string) {
  if (category === "image") return <ImageIcon className="h-4 w-4 text-info" />;
  if (category === "data") return <LineChart className="h-4 w-4 text-warning" />;
  return <FileText className="h-4 w-4 text-success" />;
}

/** Render a labelled list of strings if present. */
function StringList({ title, items, icon }: { title: string; items?: unknown; icon?: React.ReactNode }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div>
      <div className="text-sm font-medium mb-1.5 flex items-center gap-1.5">{icon}{title}</div>
      <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
        {items.map((it, i) => (
          <li key={i}>{typeof it === "string" ? it : JSON.stringify(it)}</li>
        ))}
      </ul>
    </div>
  );
}

export default function AnalysisHubSection() {
  const { t } = useTranslation();
  const capsQ = trpc.aiAnalysisHub.getCapabilities.useQuery(undefined, { staleTime: 300_000 });

  const allCaps = useMemo<Capability[]>(() => {
    const d = capsQ.data as any;
    if (!d) return [];
    return [
      ...(d.imageAnalysis ?? []),
      ...(d.dataAnalysis ?? []),
      ...(d.reportGeneration ?? []),
    ] as Capability[];
  }, [capsQ.data]);

  const [selectedId, setSelectedId] = useState<string>("executive_summary");
  const selected = allCaps.find((c) => c.id === selectedId) ?? null;
  const runnable = selected != null && RUNNABLE_REPORTS.has(selected.id);

  // ── Report-generator inputs (self-contained) ──
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [language, setLanguage] = useState<"vi" | "en">("vi");
  const [triggerReason, setTriggerReason] = useState("");
  const [result, setResult] = useState<any>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // One mutation hook per runnable analysis (hooks must be unconditional).
  const dailyM = trpc.aiAnalysisHub.dailyQualitySummary.useMutation();
  const rcaM = trpc.aiAnalysisHub.rootCauseAnalysis.useMutation();
  const modelPerfM = trpc.aiAnalysisHub.modelPerformanceReport.useMutation();
  const execM = trpc.aiAnalysisHub.executiveSummary.useMutation();
  const pending = dailyM.isPending || rcaM.isPending || modelPerfM.isPending || execM.isPending;

  const run = async () => {
    if (!selected || !runnable) return;
    setRunError(null);
    setResult(null);
    const base = { startDate, endDate, language };
    try {
      let res: any;
      if (selected.id === "daily_quality_summary") res = await dailyM.mutateAsync(base);
      else if (selected.id === "root_cause_analysis") res = await rcaM.mutateAsync({ ...base, triggerReason: triggerReason.trim() || undefined });
      else if (selected.id === "model_performance_report") res = await modelPerfM.mutateAsync(base);
      else if (selected.id === "executive_summary") res = await execM.mutateAsync(base);
      setResult(res);
    } catch (err: unknown) {
      setRunError(err instanceof Error ? err.message : String(err));
    }
  };

  const meta = result?.narrativeMetadata as
    | { generatedBy?: string; confidence?: number; model?: string }
    | undefined;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {t("analysisHub.title", "Trung tâm phân tích AI")}
          </CardTitle>
          <CardDescription>
            {t("analysisHub.desc", "Chọn một phân tích AI có sẵn. Các báo cáo (chỉ cần khoảng thời gian) chạy trực tiếp tại đây; phân tích ảnh & chuỗi thời gian cần dữ liệu đầu vào từ màn hình chuyên biệt.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {capsQ.isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : capsQ.error ? (
            <div className="text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> {capsQ.error.message}
            </div>
          ) : allCaps.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              {t("analysisHub.empty", "Không có phân tích nào khả dụng.")}
            </div>
          ) : (
            <>
              {/* Capability catalogue selector */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                {allCaps.map((c) => {
                  const isRunnable = RUNNABLE_REPORTS.has(c.id);
                  const active = c.id === selectedId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setSelectedId(c.id); setResult(null); setRunError(null); }}
                      className={`text-left rounded-lg border p-3 transition-colors hover:bg-muted/50 ${active ? "border-primary ring-1 ring-primary/40 bg-muted/40" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          {familyIcon(c.category)}{c.name}
                        </span>
                        {isRunnable
                          ? <Badge variant="outline" className="text-[10px] py-0 h-4 shrink-0">{t("analysisHub.runnable", "Chạy được")}</Badge>
                          : <Badge variant="secondary" className="text-[10px] py-0 h-4 shrink-0">{t("analysisHub.needsInput", "Cần dữ liệu")}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.description}</p>
                    </button>
                  );
                })}
              </div>

              {selected && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {familyIcon(selected.category)}{selected.name}
                    </div>

                    {runnable ? (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">{t("analysisHub.startDate", "Từ ngày")}</Label>
                            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">{t("analysisHub.endDate", "Đến ngày")}</Label>
                            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">{t("analysisHub.language", "Ngôn ngữ")}</Label>
                            <Select value={language} onValueChange={(v: "vi" | "en") => setLanguage(v)}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="vi">Tiếng Việt</SelectItem>
                                <SelectItem value="en">English</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {selected.id === "root_cause_analysis" && (
                            <div className="space-y-1">
                              <Label className="text-xs">{t("analysisHub.triggerReason", "Lý do (tùy chọn)")}</Label>
                              <Input value={triggerReason} onChange={(e) => setTriggerReason(e.target.value)} placeholder={t("analysisHub.triggerPlaceHolder", "vd: NG tăng đột biến") ?? ""} />
                            </div>
                          )}
                        </div>
                        <Button onClick={run} disabled={pending}>
                          {pending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                          {t("analysisHub.run", "Chạy phân tích")}
                        </Button>
                      </>
                    ) : (
                      <div className="rounded-md border border-info/30 bg-info/5 p-3 text-sm text-muted-foreground flex items-start gap-2">
                        <Info className="h-4 w-4 mt-0.5 shrink-0 text-info" />
                        <div>
                          {selected.category === "image"
                            ? t("analysisHub.imageNote", "Phân tích ảnh cần một ảnh kiểm tra (image key). Hãy chạy từ màn hình Kiểm tra ảnh / So sánh ảnh.")
                            : t("analysisHub.dataNote", "Phân tích chuỗi thời gian cần dữ liệu số (data points). Hãy chạy từ màn hình phân tích chuỗi thời gian / dự báo.")}
                          <div className="mt-1.5 text-xs">
                            <span className="font-medium">{t("analysisHub.requiredInputs", "Đầu vào bắt buộc")}:</span>{" "}
                            {selected.requiredInputs.join(", ")}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Result */}
      {runError && (
        <Card>
          <CardContent className="p-4 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {runError}
          </CardContent>
        </Card>
      )}

      {result && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base flex items-center gap-2">
                <BadgeCheck className="h-4 w-4 text-success" />
                {selected?.name ?? t("analysisHub.result", "Kết quả")}
              </CardTitle>
              {meta && (
                <div className="flex items-center gap-2 text-xs">
                  {meta.generatedBy && (
                    <Badge variant="outline" className="text-[10px] py-0 h-4">
                      {t("analysisHub.generatedBy", "Nguồn")}: {meta.generatedBy}
                    </Badge>
                  )}
                  {typeof meta.confidence === "number" && (
                    <Badge variant="secondary" className="text-[10px] py-0 h-4">
                      {t("analysisHub.confidence", "Độ tin cậy")}: {(meta.confidence * 100).toFixed(0)}%
                    </Badge>
                  )}
                  {meta.model && (
                    <Badge variant="outline" className="text-[10px] py-0 h-4 font-mono">{meta.model}</Badge>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Narrative */}
            {result.narrative && (
              <div className="rounded-md bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap">
                {result.narrative}
              </div>
            )}

            {/* Daily quality summary structured fields */}
            {result.analysisType === "daily_quality_summary" && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Stat label={t("analysisHub.totalInspections", "Tổng kiểm tra")} value={result.totalInspections} />
                  <Stat label={t("analysisHub.ok", "OK")} value={result.okCount} cls="text-success" />
                  <Stat label={t("analysisHub.ng", "NG")} value={result.ngCount} cls="text-destructive" />
                  <Stat label={t("analysisHub.yieldRate", "Hiệu suất")} value={result.yieldRate != null ? `${result.yieldRate}%` : "—"} />
                </div>
                {Array.isArray(result.topDefects) && result.topDefects.length > 0 && (
                  <StringList
                    title={t("analysisHub.topDefects", "Lỗi hàng đầu")}
                    items={result.topDefects.map((d: any) => `${d.type}: ${d.count} (${d.percentage}%)`)}
                  />
                )}
                <StringList title={t("analysisHub.anomalies", "Bất thường")} items={result.anomalies} icon={<AlertTriangle className="h-4 w-4 text-warning" />} />
                <StringList title={t("analysisHub.recommendations", "Khuyến nghị")} items={result.recommendations} icon={<Sparkles className="h-4 w-4 text-info" />} />
              </>
            )}

            {/* RCA structured fields */}
            {result.analysisType === "root_cause_analysis" && (
              <>
                {Array.isArray(result.contributingFactors) && result.contributingFactors.length > 0 && (
                  <StringList
                    title={t("analysisHub.contributingFactors", "Yếu tố góp phần")}
                    items={result.contributingFactors.map((f: any) => `${f.factor} (${t("analysisHub.impact", "tác động")} ${f.impact}) — ${f.evidence}`)}
                  />
                )}
                <StringList title={t("analysisHub.actionItems", "Hành động")} items={result.actionItems} icon={<Sparkles className="h-4 w-4 text-info" />} />
              </>
            )}

            {/* Model performance structured fields */}
            {result.analysisType === "model_performance_report" && (
              <>
                {Array.isArray(result.models) && result.models.length > 0 && (
                  <StringList
                    title={t("analysisHub.models", "Mô hình")}
                    items={result.models.map((m: any) => {
                      // doc69 A4 — dataAvailable:true no longer guarantees EVERY field is
                      // non-null (currentAccuracy stays null — no real accuracy source
                      // exists yet — even when latency/error/drift ARE real). Build the
                      // summary from whichever real fields are present instead of assuming
                      // currentAccuracy is a number (was a NaN%/undefined-trend bug).
                      if (m.dataAvailable === false) {
                        return `${m.modelCode}: ${t("analysisHub.metricsUnavailable", "số liệu chưa khả dụng")}`;
                      }
                      const parts: string[] = [];
                      if (m.currentAccuracy != null) parts.push(`acc ${(m.currentAccuracy * 100).toFixed(1)}%`);
                      if (m.totalPredictions != null) parts.push(`${m.totalPredictions} ${t("analysisHub.predictions", "lượt suy luận")}`);
                      if (m.p95LatencyMs != null) parts.push(`p95 ${m.p95LatencyMs}ms`);
                      if (m.errorRate != null) parts.push(`${t("analysisHub.errorRate", "lỗi")} ${(m.errorRate * 100).toFixed(1)}%`);
                      if (m.driftDetected === true) parts.push("DRIFT");
                      return `${m.modelCode}: ${parts.length > 0 ? parts.join(" · ") : t("analysisHub.metricsUnavailable", "số liệu chưa khả dụng")}`;
                    })}
                  />
                )}
                <StringList title={t("analysisHub.retrainRecommendations", "Khuyến nghị huấn luyện lại")} items={result.retrainRecommendations} icon={<Sparkles className="h-4 w-4 text-info" />} />
              </>
            )}

            {/* Executive summary structured fields */}
            {result.analysisType === "executive_summary" && (
              <>
                {result.kpis && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Stat label={t("analysisHub.totalProduction", "Sản lượng")} value={result.kpis.totalProduction} />
                    <Stat label={t("analysisHub.overallYield", "Hiệu suất chung")} value={result.kpis.overallYield != null ? `${result.kpis.overallYield}%` : "—"} />
                    <Stat label={t("analysisHub.avgDefectRate", "Tỷ lệ lỗi TB")} value={result.kpis.avgDefectRate != null ? `${result.kpis.avgDefectRate}%` : "—"} />
                    <Stat label={t("analysisHub.topMachine", "Máy tốt nhất")} value={result.kpis.topPerformingMachine ?? "—"} />
                  </div>
                )}
                <StringList title={t("analysisHub.trends", "Xu hướng")} items={result.trends} icon={<LineChart className="h-4 w-4 text-info" />} />
                <StringList title={t("analysisHub.concerns", "Quan ngại")} items={result.concerns} icon={<AlertTriangle className="h-4 w-4 text-warning" />} />
                {result.forecast && (
                  <div>
                    <div className="text-sm font-medium mb-1.5 flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-info" />{t("analysisHub.forecast", "Dự báo")}</div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{result.forecast}</p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: React.ReactNode; cls?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground truncate">{label}</div>
      <div className={`text-lg font-semibold tabular-nums truncate ${cls ?? ""}`}>{value ?? "—"}</div>
    </div>
  );
}
