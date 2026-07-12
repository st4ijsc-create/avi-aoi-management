/**
 * Management Insight (Phase B4.5)
 * Manager-facing surface combining:
 *  (a) NL Q&A over factory data — calls the existing AI chat endpoint (trpc.aiChat.chat).
 *      The server-side NL→analytics read-tools answer "OEE tuần này?", "top 5 lỗi NG?",
 *      PdM/forecast questions through the SAME chat endpoint.
 *  (b) Auto executive summary — trpc.aiReport.executiveSummary (on-demand generate; guarded).
 *  (c) Active AI insights / alerts — trpc.aiInsight.list (advisory, read-only).
 *
 * Read-only / advisory surface — NOT a control panel. Multilingual (vi/en/zh).
 * All backend calls are optional-chained + guarded so the page renders even if a
 * procedure isn't merged yet.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, PageContainer, StatusBadge, type BadgeVariant } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import ReportAggregatorsPanel from "@/components/analytics/ReportAggregatorsPanel";
import {
  Lightbulb,
  Send,
  Sparkles,
  FileBarChart,
  AlertTriangle,
  TrendingUp,
  RefreshCw,
  MessageSquare,
  Bell,
  Loader2,
  Info,
} from "lucide-react";

// Example questions (Vietnamese primary). Translatable via i18n with these as defaults.
const EXAMPLE_QUESTIONS = [
  { key: "q1", default: "OEE dây chuyền 2 tuần này so tuần trước?" },
  { key: "q2", default: "Top 5 lỗi NG tuần này?" },
  { key: "q3", default: "Máy nào sắp cần bảo trì?" },
] as const;

// Severity → shared <StatusBadge> entry for ai_insights (solid, W4). Preserves
// the exact prior variant + amber-warning override class.
function severityVariant(sev?: string): { variant: BadgeVariant; cls: string } {
  switch ((sev ?? "").toLowerCase()) {
    case "critical":
    case "error":
      return { variant: "destructive", cls: "" };
    case "warning":
      return { variant: "default", cls: "bg-warning/15 text-warning border-warning/30" };
    case "info":
      return { variant: "secondary", cls: "" };
    default:
      return { variant: "outline", cls: "" };
  }
}

/** Optional history dropdown of past persisted executive summaries. */
function ExecReportHistory({ lang }: { lang: "vi" | "en" | "zh" }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const history = trpc.executiveReport.list.useQuery({ limit: 10 }, { enabled: open });
  const rows: any[] = history.data ?? [];
  return (
    <>
      <Separator />
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground self-start"
        onClick={() => setOpen((v) => !v)}
      >
        {open
          ? t("mgmtInsight.exec.hideHistory", "Ẩn lịch sử báo cáo")
          : t("mgmtInsight.exec.showHistory", "Xem báo cáo trước đó")}
      </button>
      {open && (
        history.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : rows.length === 0 ? (
          <div className="text-xs text-muted-foreground">{t("mgmtInsight.exec.noHistory", "Chưa có báo cáo nào trước đó.")}</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map((r) => (
              <li key={r?.id} className="flex items-center justify-between gap-2 text-xs border rounded-md px-2.5 py-1.5">
                <span className="truncate">{r?.title ?? "—"}</span>
                <span className="text-muted-foreground shrink-0">
                  {r?.period ? `${String(t(`mgmtInsight.exec.period.${r.period}`, r.period))} · ` : ""}
                  {r?.createdAt ? new Date(r.createdAt).toLocaleString() : ""}
                </span>
              </li>
            ))}
          </ul>
        )
      )}
    </>
  );
}

export default function ManagementInsight() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || "vi").startsWith("vi") ? "vi" : (i18n.language || "vi").startsWith("zh") ? "zh" : "en";

  // ─── (a) NL Q&A ──────────────────────────────────────────────────────────
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [toolsUsed, setToolsUsed] = useState<string[]>([]);
  const [askError, setAskError] = useState<string | null>(null);

  // The chat endpoint persists into a conversation; create one lazily (mirrors AIChatPage).
  const createConv = trpc.aiChat.createConversation.useMutation();
  const chatMutation = trpc.aiChat.chat.useMutation();

  const asking = createConv.isPending || chatMutation.isPending;

  const ask = async (q?: string) => {
    const userMessage = (q ?? question).trim();
    if (!userMessage || asking) return;
    setAskError(null);
    setAnswer(null);
    setToolsUsed([]);
    try {
      // Lazily create a conversation to satisfy the chat endpoint's contract.
      const conv = await createConv.mutateAsync({
        title: userMessage.slice(0, 50),
        context: { surface: "management-insight" },
      });
      const result = await chatMutation.mutateAsync({
        conversationId: String(conv.id),
        userMessage,
        messages: [{ role: "user", content: userMessage }],
        language: lang === "vi" ? "vi" : "en",
      });
      setAnswer(result?.reply ?? "");
      setToolsUsed(result?.toolsUsed ?? []);
    } catch (err: unknown) {
      setAskError(err instanceof Error ? err.message : String(err));
    }
  };

  // ─── (b) Executive summary — persisted auto report (B4.3) ────────────────
  // Default content = latest PERSISTED scheduled summary (executiveReport.latest).
  // The "Generate / Refresh" button triggers executiveReport.generateNow (admin-only),
  // then refetches latest. Non-admins get a graceful read-only fallback (forbidden error).
  const latestReport = trpc.executiveReport.latest.useQuery(undefined);
  const generateReport = trpc.executiveReport.generateNow.useMutation({
    onSuccess: () => { latestReport.refetch(); },
  });
  const generateSummary = () => {
    generateReport.mutate({ period: "day", lang: lang === "vi" ? "vi" : "en" });
  };
  // PersistedExecSummary: { id, period, title, severity, createdAt, summary }
  // summary: ExecutiveSummaryStructured { headline, highlights[], risks[],
  //          recommendations[], kpiTable[{label,value}], window{start,end}, generatedAt }
  const report: any = latestReport.data ?? null;
  const summary: any = report?.summary ?? null;
  const kpiTable: Array<{ label: string; value: string }> = Array.isArray(summary?.kpiTable) ? summary.kpiTable : [];
  // generateNow is admin-only — surface a friendly note instead of a raw forbidden error.
  const genForbidden =
    generateReport.isError &&
    /forbidden|unauthorized|admin|permission/i.test(generateReport.error?.message ?? "");

  // ─── (c) Active AI insights / alerts ─────────────────────────────────────
  const insightsQuery = trpc.aiInsight.list.useQuery(
    { status: "new", limit: 20 },
    { refetchInterval: 30_000 },
  );
  const insights: any[] = insightsQuery.data ?? [];

  return (
    <DashboardLayout>
      <PageContainer fluid>
        <PageHeader
          icon={<Lightbulb className="h-6 w-6 text-primary" />}
          title={t("mgmtInsight.title", "Insight Quản lý")}
          description={t("mgmtInsight.subtitle", "Hỏi đáp dữ liệu nhà máy + tóm tắt điều hành + cảnh báo AI (chỉ tư vấn)")}
          actions={
            <Badge variant="secondary">
              <Info className="h-3 w-3 mr-1" />
              {t("mgmtInsight.advisory", "Chỉ tư vấn / chỉ đọc")}
            </Badge>
          }
        />

        {/* (a) NL Q&A */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              {t("mgmtInsight.qa.title", "Hỏi đáp dữ liệu nhà máy")}
            </CardTitle>
            <CardDescription>
              {t("mgmtInsight.qa.desc", "Đặt câu hỏi bằng ngôn ngữ tự nhiên về OEE, lỗi NG, bảo trì, dự báo…")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {/* Example questions */}
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_QUESTIONS.map((ex) => {
                const label = t(`mgmtInsight.qa.examples.${ex.key}`, ex.default);
                return (
                  <Button
                    key={ex.key}
                    variant="outline"
                    size="sm"
                    className="h-auto py-1 text-xs"
                    disabled={asking}
                    onClick={() => { setQuestion(label); ask(label); }}
                  >
                    <Sparkles className="h-3 w-3 mr-1.5 text-primary" />
                    {label}
                  </Button>
                );
              })}
            </div>

            {/* Prompt input */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={t("mgmtInsight.qa.placeholder", "Nhập câu hỏi của bạn…")}
                rows={2}
                className="flex-1 resize-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); }
                }}
              />
              <Button onClick={() => ask()} disabled={asking || !question.trim()} className="sm:w-auto">
                {asking ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
                {t("mgmtInsight.qa.ask", "Hỏi")}
              </Button>
            </div>

            {/* Answer area */}
            {askError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {askError}
              </div>
            ) : asking ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : answer !== null ? (
              <div className="rounded-md border bg-muted/40 p-3">
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{answer}</p>
                {toolsUsed.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">
                      {t("mgmtInsight.qa.toolsUsed", "Công cụ dữ liệu đã dùng:")}
                    </span>
                    {toolsUsed.map((tool) => (
                      <Badge key={tool} variant="outline" className="text-[10px] py-0 h-4">{tool}</Badge>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-2">
                {t("mgmtInsight.qa.empty", "Chọn một câu hỏi gợi ý hoặc nhập câu hỏi của bạn để bắt đầu.")}
              </div>
            )}
          </CardContent>
        </Card>

        {/* (b) Executive summary — latest persisted auto report */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileBarChart className="h-4 w-4 text-info" />
                  {t("mgmtInsight.exec.title", "Tóm tắt điều hành tự động")}
                </CardTitle>
                <CardDescription>
                  {t("mgmtInsight.exec.desc", "Báo cáo điều hành tự động gần nhất — KPI, điểm nổi bật, rủi ro & khuyến nghị")}
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={generateSummary} disabled={generateReport.isPending}>
                {generateReport.isPending
                  ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  : <RefreshCw className="h-4 w-4 mr-1.5" />}
                {t("mgmtInsight.exec.generate", "Tạo ngay")}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* Admin-only generate forbidden → friendly read-only note (still show latest below). */}
            {genForbidden && (
              <div className="rounded-md border border-warning/30 bg-warning/5 p-2.5 text-xs text-warning flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 shrink-0" />
                {t("mgmtInsight.exec.adminOnly", "Chỉ quản trị viên mới có thể tạo báo cáo. Hiển thị báo cáo gần nhất (chỉ đọc).")}
              </div>
            )}
            {generateReport.isError && !genForbidden && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
                {generateReport.error?.message ?? t("mgmtInsight.exec.unavailable", "Chưa thể tạo báo cáo điều hành lúc này.")}
              </div>
            )}

            {latestReport.isLoading ? (
              <>
                <Skeleton className="h-5 w-1/2" />
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
                <Skeleton className="h-20 w-full" />
              </>
            ) : !summary ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                {t("mgmtInsight.exec.empty", "Chưa có báo cáo điều hành — bấm Tạo ngay.")}
              </div>
            ) : (
              <>
                {/* Period + generation time */}
                <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                  {report?.period && (
                    <Badge variant="outline" className="text-[10px] py-0 h-4">
                      {String(t(`mgmtInsight.exec.period.${report.period}`, report.period))}
                    </Badge>
                  )}
                  {summary?.generatedAt && (
                    <span>{t("mgmtInsight.exec.generatedAt", "Tạo lúc:")} {new Date(summary.generatedAt).toLocaleString()}</span>
                  )}
                  {summary?.generatedBy && (
                    <Badge variant="secondary" className="text-[10px] py-0 h-4">{summary.generatedBy}</Badge>
                  )}
                </div>

                {/* FE-W0.3 (doc 46 §2.3) — honest note when the AI narrative was
                    rejected as a degenerate loop and this is the rule-based fallback. */}
                {summary?.degraded && (
                  <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                    {t(
                      "mgmtInsight.exec.degraded",
                      "Tóm tắt AI tạm không đạt chất lượng — đang hiển thị bản tóm tắt theo quy tắc từ KPI thực.",
                    )}
                  </div>
                )}

                {/* Headline */}
                {summary?.headline && (
                  <div className="rounded-md bg-muted/40 p-3 text-sm font-medium leading-relaxed whitespace-pre-wrap">
                    {summary.headline}
                  </div>
                )}

                {/* KPI table */}
                {kpiTable.length > 0 && (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {kpiTable.map((k, i) => (
                      <div key={i} className="rounded-lg border p-3">
                        <div className="text-xs text-muted-foreground truncate">{k.label}</div>
                        <div className="text-lg font-semibold tabular-nums truncate">{k.value}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Highlights + risks */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Array.isArray(summary?.highlights) && summary.highlights.length > 0 && (
                    <div>
                      <div className="text-sm font-medium mb-1.5 flex items-center gap-1.5">
                        <TrendingUp className="h-4 w-4 text-success" />
                        {t("mgmtInsight.exec.highlights", "Điểm nổi bật")}
                      </div>
                      <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                        {summary.highlights.map((h: string, i: number) => <li key={i}>{h}</li>)}
                      </ul>
                    </div>
                  )}
                  {Array.isArray(summary?.risks) && summary.risks.length > 0 && (
                    <div>
                      <div className="text-sm font-medium mb-1.5 flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4 text-warning" />
                        {t("mgmtInsight.exec.risks", "Rủi ro / Cần chú ý")}
                      </div>
                      <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                        {summary.risks.map((r: string, i: number) => <li key={i}>{r}</li>)}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Recommendations */}
                {Array.isArray(summary?.recommendations) && summary.recommendations.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <div className="text-sm font-medium mb-1.5 flex items-center gap-1.5">
                        <Lightbulb className="h-4 w-4 text-info" />
                        {t("mgmtInsight.exec.recommendations", "Khuyến nghị")}
                      </div>
                      <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                        {summary.recommendations.map((r: string, i: number) => <li key={i}>{r}</li>)}
                      </ul>
                    </div>
                  </>
                )}

                {/* History dropdown (optional past summaries) */}
                <ExecReportHistory lang={lang} />
              </>
            )}
          </CardContent>
        </Card>

        {/* (d) Report aggregators — defect Pareto / yield-by-product / weekly-trend + recent artifacts (doc 32 R1/R2) */}
        <ReportAggregatorsPanel />

        {/* (c) Active AI insights / alerts */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Bell className="h-4 w-4 text-primary" />
                  {t("mgmtInsight.alerts.title", "Cảnh báo / Insight AI đang hoạt động")}
                </CardTitle>
                <CardDescription>
                  {t("mgmtInsight.alerts.desc", "Insight tư vấn gần đây từ bộ giám sát AI (chỉ đọc)")}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{insights.length} {t("mgmtInsight.alerts.count", "mục")}</Badge>
                <Button variant="ghost" size="sm" onClick={() => insightsQuery.refetch()}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {insightsQuery.isLoading ? (
              <>{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</>
            ) : insights.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                {t("mgmtInsight.alerts.empty", "Không có cảnh báo AI nào đang hoạt động.")}
              </div>
            ) : (
              insights.map((ins) => {
                const sev = severityVariant(ins?.severity);
                return (
                  <div key={ins?.id} className="rounded-lg border p-3 flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                        <span className="text-sm font-medium truncate">{ins?.title ?? "—"}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {ins?.machineCode && (
                          <Badge variant="outline" className="text-[10px] py-0 h-4">{ins.machineCode}</Badge>
                        )}
                        <StatusBadge status={ins?.severity ?? "info"} variant={sev.variant} className={sev.cls} />
                      </div>
                    </div>
                    {ins?.body && <p className="text-sm text-muted-foreground">{ins.body}</p>}
                    {ins?.recommendation && (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium">{t("mgmtInsight.alerts.recommendation", "Khuyến nghị:")} </span>
                        {ins.recommendation}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </PageContainer>
    </DashboardLayout>
  );
}
