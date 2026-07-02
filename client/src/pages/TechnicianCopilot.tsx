/**
 * TechnicianCopilot — LUỒNG ③ "RCA Copilot" surface (doc 06).
 *
 * A technician lands on / picks a machine (and optionally a defect type), the AI
 * diagnoses the root cause, and the technician approves the recommended fix in
 * ONE tap. Decision-ready cards: ranked hypotheses with confidence, cited
 * evidence, and a recommended fix per kind:
 *   - WRITE + oneTap → applyTopFix(rcaId) [HITL propose] → confirmAction({actionId,
 *     token: actionId}) [the EXISTING HITL confirm used by the inbox/chat]. The page
 *     NEVER calls a write endpoint directly.
 *   - MANUAL → step checklist + acknowledge.
 *   - INVESTIGATE → rationale + "Hỏi AI" deep-link.
 * "Không đúng → #2" cycles to the next hypothesis.
 *
 * Honest-degrade: flag off / insufficient evidence → friendly "cần người xem" /
 * "RCA Copilot chưa bật" states. Everything optional-chained; renders fine while
 * loading / empty / disabled. Big text + large buttons (kiosk/tablet). vi/en/zh.
 *
 * Structured so future sections (Threshold Advisor ②, Setup Advisor ①) can be
 * added as sibling cards under the same page.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import AIThresholdSuggestButton from "@/components/AIThresholdSuggestButton";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { PageHeader, PageContainer } from "@/components/patterns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Wrench,
  Search,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  MessageCircle,
  ChevronDown,
  ListChecks,
  History,
  Sparkles,
  SlidersHorizontal,
} from "lucide-react";

// ─── Mirror of server RcaResult shapes (read-only; optional-chained on use) ─────

type RcaFixKind = "WRITE" | "MANUAL" | "INVESTIGATE";
interface RcaRecommendedFix {
  kind: RcaFixKind;
  tool?: string;
  args?: Record<string, unknown>;
  steps?: string[];
  rationale: string;
  oneTap: boolean;
}
interface RcaHypothesis {
  cause: string;
  confidence: number; // 0..1
  evidence: string[];
  recommendedFix: RcaRecommendedFix;
}
interface RcaResult {
  ok: boolean;
  rcaId?: number | null;
  machineId?: number;
  defectType?: string;
  hypotheses?: RcaHypothesis[];
  needsHumanInvestigation?: boolean;
  note?: string;
}

type Lang = "vi" | "en" | "zh";

// ─── Confidence → tone ──────────────────────────────────────────────────────────
function confTone(c: number): { bar: string; text: string } {
  if (c >= 0.7) return { bar: "bg-success", text: "text-success" };
  if (c >= 0.4) return { bar: "bg-warning", text: "text-warning" };
  return { bar: "bg-destructive", text: "text-destructive" };
}

export default function TechnicianCopilot() {
  const { t, i18n } = useTranslation();
  const [, navigate] = useLocation();
  const lang = (i18n.language?.startsWith("vi") ? "vi" : i18n.language?.startsWith("zh") ? "zh" : "en") as Lang;

  // Read ?machineId= once on mount (deep-link from MachineAISummary).
  const initialMachineId = useMemo(() => {
    if (typeof window === "undefined") return undefined;
    const raw = new URLSearchParams(window.location.search).get("machineId");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }, []);

  const [machineId, setMachineId] = useState<number | undefined>(initialMachineId);
  const [defectType, setDefectType] = useState<string>("");
  const [result, setResult] = useState<RcaResult | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [done, setDone] = useState(false);
  const [autoRan, setAutoRan] = useState(false);

  // ── Machine picker ──────────────────────────────────────────────────────────
  const machinesQuery = trpc.machine.list.useQuery(undefined, { staleTime: 60_000, retry: false });
  const machines = (machinesQuery.data ?? []) as Array<{ id: number; code?: string; name?: string }>;

  // ── Recent persisted RCAs ─────────────────────────────────────────────────────
  const latestQuery = trpc.aiRcaCopilot.latest.useQuery(
    { machineId, limit: 5 },
    { staleTime: 30_000, retry: false },
  );

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const diagnoseMutation = trpc.aiRcaCopilot.diagnose.useMutation();
  const applyTopFixMutation = trpc.aiRcaCopilot.applyTopFix.useMutation();
  const confirmActionMutation = trpc.aiCopilot.confirmAction.useMutation();
  const utils = trpc.useUtils();

  const diagnosing = diagnoseMutation.isPending;
  const applying = applyTopFixMutation.isPending || confirmActionMutation.isPending;

  const runDiagnose = async () => {
    setDone(false);
    setActiveIdx(0);
    setResult(null);
    try {
      const res = (await diagnoseMutation.mutateAsync({
        machineId,
        defectType: defectType.trim() ? defectType.trim() : undefined,
        lang,
      })) as RcaResult;
      setResult(res);
      void utils.aiRcaCopilot.latest.invalidate();
    } catch {
      toast.error(t("technicianCopilot.toast.diagnoseFailed", "Chẩn đoán thất bại"));
    }
  };

  // Auto-run once when arriving with ?machineId=.
  useEffect(() => {
    if (initialMachineId && !autoRan) {
      setAutoRan(true);
      void runDiagnose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMachineId, autoRan]);

  const hypotheses = result?.hypotheses ?? [];
  const active = hypotheses[activeIdx];

  // ── Apply WRITE fix: applyTopFix → confirmAction (one user tap, two server calls) ──
  const handleApplyFix = async () => {
    if (!result?.rcaId) return;
    try {
      const proposed = await applyTopFixMutation.mutateAsync({ rcaId: result.rcaId, lang });
      const actionId = proposed?.actionId;
      if (!proposed?.ok || !actionId) {
        toast.error(proposed?.message ?? t("technicianCopilot.toast.applyFailed", "Không thể đề xuất sửa"));
        return;
      }
      // Reuse the EXISTING HITL confirm (token == actionId) — server re-checks RBAC + executes.
      const confirmed = await confirmActionMutation.mutateAsync({ actionId, token: actionId, lang });
      if (confirmed?.ok) {
        setDone(true);
        toast.success(confirmed.message ?? t("technicianCopilot.toast.applied", "Đã áp dụng"));
        void utils.aiRcaCopilot.latest.invalidate();
      } else {
        toast.error(confirmed?.message ?? t("technicianCopilot.toast.applyFailed", "Không thể áp dụng"));
      }
    } catch {
      toast.error(t("technicianCopilot.toast.applyFailed", "Không thể áp dụng"));
    }
  };

  const handleAckManual = () => {
    setDone(true);
    toast.success(t("technicianCopilot.toast.acknowledged", "Đã đánh dấu xử lý"));
  };

  const askAI = (cause: string) => {
    const label =
      machines.find((m) => m.id === machineId)?.code ??
      (machineId ? `#${machineId}` : t("technicianCopilot.machineUnspecified", "máy"));
    const q = t(
      "technicianCopilot.askQuestion",
      "Nguyên nhân lỗi có thể là \"{{cause}}\" trên máy {{machine}}. Phân tích sâu giúp tôi.",
      { cause, machine: label },
    );
    navigate(`/ai-chat?q=${encodeURIComponent(q)}`);
  };

  const nextHypothesis = () => {
    setActiveIdx((i) => (i + 1) % Math.max(1, hypotheses.length));
  };

  // ── Empty / degrade detection ─────────────────────────────────────────────────
  const flagOff = result != null && result.ok === false; // diagnose returned ok:false → flag disabled
  const needsHuman =
    result != null && result.ok === true && (result.needsHumanInvestigation || hypotheses.length === 0);

  return (
    <DashboardLayout>
      <PageContainer className="max-w-4xl">
        {/* Header — DS PageHeader (shared pattern) */}
        <PageHeader
          icon={<Wrench className="h-6 w-6" />}
          title={t("technicianCopilot.title", "Trợ lý Kỹ thuật")}
          description={t("technicianCopilot.subtitle", "AI chẩn đoán nguyên nhân lỗi — bạn chỉ cần duyệt một chạm")}
        />

        {/* ── RCA Copilot section ─────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Search className="h-5 w-5 text-primary" />
              {t("technicianCopilot.rca.title", "Chẩn đoán nguyên nhân lỗi (RCA)")}
            </CardTitle>
            <CardDescription>
              {t("technicianCopilot.rca.subtitle", "Chọn máy (và loại lỗi nếu biết) rồi để AI phân tích.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Pickers */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">
                  {t("technicianCopilot.rca.machineLabel", "Máy")}
                </label>
                <Select
                  value={machineId != null ? String(machineId) : ""}
                  onValueChange={(v) => setMachineId(v ? Number(v) : undefined)}
                >
                  <SelectTrigger className="h-12 text-base">
                    <SelectValue
                      placeholder={t("technicianCopilot.rca.machinePlaceholder", "Chọn máy...")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {machines.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)} className="text-base">
                        {m.code ? `${m.code} — ${m.name ?? ""}` : (m.name ?? `#${m.id}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">
                  {t("technicianCopilot.rca.defectLabel", "Loại lỗi (tuỳ chọn)")}
                </label>
                <Input
                  type="text"
                  value={defectType}
                  onChange={(e) => setDefectType(e.target.value)}
                  placeholder={t("technicianCopilot.rca.defectPlaceholder", "VD: chân chì, lệch linh kiện...")}
                  className="h-12 text-base"
                />
              </div>
            </div>

            {/* Diagnose button */}
            <Button
              className="h-14 w-full text-base font-semibold sm:w-auto sm:px-8"
              disabled={diagnosing}
              onClick={runDiagnose}
            >
              {diagnosing ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Search className="mr-2 h-5 w-5" />
              )}
              {t("technicianCopilot.rca.diagnoseBtn", "Chẩn đoán")}
            </Button>

            {/* Loading state */}
            {diagnosing && (
              <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-4">
                <Loader2 className="h-6 w-6 animate-spin text-primary shrink-0" />
                <div>
                  <p className="text-base font-semibold">
                    {t("technicianCopilot.rca.analyzing", "AI đang phân tích...")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t("technicianCopilot.rca.analyzingHint", "Thu thập bằng chứng và xếp hạng nguyên nhân.")}
                  </p>
                </div>
              </div>
            )}

            {/* Flag-off state */}
            {!diagnosing && flagOff && (
              <div className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/30 p-4">
                <Sparkles className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-base font-semibold">
                    {t("technicianCopilot.rca.disabled", "RCA Copilot chưa bật")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t("technicianCopilot.rca.disabledHint", "Tính năng đang tắt. Liên hệ quản trị để bật.")}
                  </p>
                </div>
              </div>
            )}

            {/* Needs-human / empty state */}
            {!diagnosing && needsHuman && (
              <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
                <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                <div>
                  <p className="text-base font-semibold text-warning">
                    {t("technicianCopilot.rca.needsHuman", "Chưa đủ dữ liệu để chẩn đoán chắc chắn — cần người xem")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t("technicianCopilot.rca.needsHumanHint", "Hãy bổ sung dữ liệu hoặc kiểm tra trực tiếp tại máy.")}
                  </p>
                </div>
              </div>
            )}

            {/* Hypothesis card */}
            {!diagnosing && active && (
              <HypothesisCard
                hyp={active}
                index={activeIdx}
                total={hypotheses.length}
                done={done}
                applying={applying}
                hasNext={hypotheses.length > 1}
                onApply={handleApplyFix}
                onAck={handleAckManual}
                onAsk={askAI}
                onNext={nextHypothesis}
              />
            )}
          </CardContent>
        </Card>

        {/* ── Recent RCAs ──────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-muted-foreground" />
              {t("technicianCopilot.recent.title", "Chẩn đoán gần đây")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {latestQuery.isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (latestQuery.data ?? []).length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                {t("technicianCopilot.recent.empty", "Chưa có chẩn đoán nào.")}
              </p>
            ) : (
              <ul className="divide-y">
                {(latestQuery.data ?? []).map((r: any) => {
                  const summary = r?.aiInsights?.summary ?? r?.topFactors?.[0]?.factor ?? "—";
                  const when = r?.createdAt ? new Date(r.createdAt) : null;
                  return (
                    <li key={r.id} className="flex items-start gap-2 py-2.5">
                      <Lightbulb className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-snug break-words">{summary}</p>
                        {when && (
                          <p className="text-xs text-muted-foreground">
                            {when.toLocaleString()}
                            {r?.machineId ? ` · #${r.machineId}` : ""}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── Threshold Advisor section (LUỒNG ②) ──────────────────────────── */}
        <ThresholdAdvisorSection />

        {/* ── Future sections placeholder ──────────────────────────────────── */}
        <p className="text-center text-xs text-muted-foreground">
          {t(
            "technicianCopilot.futureNote",
            "Sắp có: Trợ lý cài đặt máy mới.",
          )}
        </p>
      </PageContainer>
    </DashboardLayout>
  );
}

// ─── Decision-ready hypothesis card ─────────────────────────────────────────────

function HypothesisCard({
  hyp,
  index,
  total,
  done,
  applying,
  hasNext,
  onApply,
  onAck,
  onAsk,
  onNext,
}: {
  hyp: RcaHypothesis;
  index: number;
  total: number;
  done: boolean;
  applying: boolean;
  hasNext: boolean;
  onApply: () => void;
  onAck: () => void;
  onAsk: (cause: string) => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const pct = Math.round(Math.max(0, Math.min(1, hyp.confidence)) * 100);
  const tone = confTone(hyp.confidence);
  const fix = hyp.recommendedFix;

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      {/* Rank + cause */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Badge variant="outline" className="mb-1.5 text-xs">
            {t("technicianCopilot.card.rank", "Nguyên nhân #{{n}}", { n: index + 1 })}
            {total > 1 ? ` / ${total}` : ""}
          </Badge>
          <p className="text-lg font-semibold leading-snug break-words">{hyp.cause}</p>
        </div>
        <span className={cn("shrink-0 text-2xl font-bold tabular-nums", tone.text)}>{pct}%</span>
      </div>

      {/* Confidence bar */}
      <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", tone.bar)} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("technicianCopilot.card.confidence", "Độ tin cậy")}
      </p>

      {/* Evidence */}
      {hyp.evidence?.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-semibold text-muted-foreground">
            {t("technicianCopilot.card.evidence", "Bằng chứng")}
          </p>
          <ul className="mt-1 space-y-1">
            {hyp.evidence.map((e, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                <span className="break-words">{e}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommended fix */}
      <div className="mt-3 rounded-lg bg-muted/50 p-3">
        <p className="text-sm font-semibold">
          {t("technicianCopilot.card.recommendedFix", "Đề xuất sửa")}
          <Badge variant="secondary" className="ml-2 text-[11px]">
            {t(`technicianCopilot.fixKind.${fix.kind}`, fix.kind)}
          </Badge>
        </p>
        <p className="mt-1 text-sm leading-snug text-muted-foreground break-words">{fix.rationale}</p>

        {/* MANUAL steps checklist */}
        {fix.kind === "MANUAL" && fix.steps?.length ? (
          <ul className="mt-2 space-y-1.5">
            {fix.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span className="break-words">{s}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Done banner */}
      {done && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 p-3 text-success">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span className="text-sm font-semibold">
            {t("technicianCopilot.card.doneBanner", "Đã xử lý xong.")}
          </span>
        </div>
      )}

      {/* Actions */}
      {!done && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {/* WRITE + oneTap → one-tap apply */}
          {fix.kind === "WRITE" && fix.oneTap && (
            <Button className="h-12 px-6 text-base font-semibold" disabled={applying} onClick={onApply}>
              {applying ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-5 w-5" />
              )}
              {t("technicianCopilot.card.applyBtn", "Đồng ý áp dụng")}
            </Button>
          )}

          {/* MANUAL → acknowledge */}
          {fix.kind === "MANUAL" && (
            <Button className="h-12 px-6 text-base font-semibold" onClick={onAck}>
              <CheckCircle2 className="mr-2 h-5 w-5" />
              {t("technicianCopilot.card.ackBtn", "Đánh dấu đã xử lý")}
            </Button>
          )}

          {/* INVESTIGATE → ask AI */}
          {fix.kind === "INVESTIGATE" && (
            <Button
              variant="default"
              className="h-12 px-6 text-base font-semibold"
              onClick={() => onAsk(hyp.cause)}
            >
              <MessageCircle className="mr-2 h-5 w-5" />
              {t("technicianCopilot.card.askBtn", "Hỏi AI")}
            </Button>
          )}

          {/* Always offer "Hỏi AI" for WRITE/MANUAL too (secondary) */}
          {fix.kind !== "INVESTIGATE" && (
            <Button variant="outline" className="h-12 px-4 text-base" onClick={() => onAsk(hyp.cause)}>
              <MessageCircle className="mr-2 h-4 w-4" />
              {t("technicianCopilot.card.askBtn", "Hỏi AI")}
            </Button>
          )}

          {/* Cycle to next hypothesis */}
          {hasNext && (
            <Button variant="ghost" className="h-12 px-4 text-base text-muted-foreground" onClick={onNext}>
              <ChevronDown className="mr-1.5 h-4 w-4" />
              {t("technicianCopilot.card.nextBtn", "Không đúng → xem #{{n}}", {
                n: ((index + 1) % total) + 1,
              })}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Threshold Advisor section (LUỒNG ②) ────────────────────────────────────────
// Pick a measurement point OR an NG threshold; the reusable AIThresholdSuggestButton
// fetches the AI recommendation and handles the HITL apply. Honest-degrade + i18n
// live inside that component.

function ThresholdAdvisorSection() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"point" | "ng">("point");
  const [pointId, setPointId] = useState<number | undefined>(undefined);
  const [ngId, setNgId] = useState<number | undefined>(undefined);

  const pointsQuery = trpc.measurementPoint.list.useQuery(undefined, { staleTime: 60_000, retry: false });
  const points = (pointsQuery.data ?? []) as Array<{ id: number; code?: string; name?: string }>;

  const ngQuery = trpc.ngRateThreshold.list.useQuery(undefined, { staleTime: 60_000, retry: false });
  const ngThresholds = (ngQuery.data ?? []) as Array<{ id: number; name?: string }>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <SlidersHorizontal className="h-5 w-5 text-primary" />
          {t("technicianCopilot.advisor.title", "Trợ lý đặt ngưỡng / thông số")}
        </CardTitle>
        <CardDescription>
          {t("technicianCopilot.advisor.subtitle", "Chọn điểm đo hoặc ngưỡng NG để AI đề xuất giá trị — bạn chỉ cần duyệt.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Mode toggle */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant={mode === "point" ? "default" : "outline"}
            className="h-11 px-4 text-base"
            onClick={() => setMode("point")}
          >
            {t("technicianCopilot.advisor.modePoint", "Giới hạn điểm đo (LSL/USL)")}
          </Button>
          <Button
            variant={mode === "ng" ? "default" : "outline"}
            className="h-11 px-4 text-base"
            onClick={() => setMode("ng")}
          >
            {t("technicianCopilot.advisor.modeNg", "Ngưỡng NG (cảnh báo/nghiêm trọng)")}
          </Button>
        </div>

        {mode === "point" ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">
                {t("technicianCopilot.advisor.pointLabel", "Điểm đo")}
              </label>
              <Select value={pointId != null ? String(pointId) : ""} onValueChange={(v) => setPointId(v ? Number(v) : undefined)}>
                <SelectTrigger className="h-12 text-base">
                  <SelectValue placeholder={t("technicianCopilot.advisor.pointPlaceholder", "Chọn điểm đo...")} />
                </SelectTrigger>
                <SelectContent>
                  {points.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)} className="text-base">
                      {p.code ? `${p.code} — ${p.name ?? ""}` : (p.name ?? `#${p.id}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="shrink-0">
              {pointId != null ? (
                <AIThresholdSuggestButton
                  target={{ kind: "point", measurementPointId: pointId }}
                  size="default"
                  variant="default"
                  onApplied={() => pointsQuery.refetch()}
                />
              ) : (
                <Button size="default" disabled variant="default" className="gap-1">
                  <Sparkles className="h-4 w-4" />
                  {t("thresholdAdvisor.suggestBtn", "🤖 AI đề xuất")}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">
                {t("technicianCopilot.advisor.ngLabel", "Ngưỡng NG")}
              </label>
              <Select value={ngId != null ? String(ngId) : ""} onValueChange={(v) => setNgId(v ? Number(v) : undefined)}>
                <SelectTrigger className="h-12 text-base">
                  <SelectValue placeholder={t("technicianCopilot.advisor.ngPlaceholder", "Chọn ngưỡng NG...")} />
                </SelectTrigger>
                <SelectContent>
                  {ngThresholds.map((n) => (
                    <SelectItem key={n.id} value={String(n.id)} className="text-base">
                      {n.name ?? `#${n.id}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="shrink-0">
              {ngId != null ? (
                <AIThresholdSuggestButton
                  target={{ kind: "ng", ngThresholdId: ngId }}
                  size="default"
                  variant="default"
                  onApplied={() => ngQuery.refetch()}
                />
              ) : (
                <Button size="default" disabled variant="default" className="gap-1">
                  <Sparkles className="h-4 w-4" />
                  {t("thresholdAdvisor.suggestBtn", "🤖 AI đề xuất")}
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
