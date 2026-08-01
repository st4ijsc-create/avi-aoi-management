/**
 * AIThresholdSuggestButton — LUỒNG ② "Threshold/Param Advisor".
 *
 * A reusable "🤖 AI đề xuất" button that, given a target (a measurement-point
 * id OR an ng-threshold id), fetches an AI recommendation and shows a
 * decision-ready card: current vs recommended values, Cpk before→after with a
 * colored indicator (MP), sampleSize + basis ("Vì sao").
 *
 * Governance (doc 31 OP1/MP2 — no self-approval):
 *   - measurement point → thresholdApproval.request ONLY. This creates a
 *     threshold-change request (advisor's suggested limits + reasoning +
 *     evidence in the payload); a DIFFERENT reviewer must approve it in the
 *     Threshold Approvals queue. The button never approves/applies — the server
 *     enforces decidedBy ≠ requestedBy, so self-approval is impossible and the
 *     UI does not even offer an approve action here.
 *   - ng-threshold → aiThresholdAdvisor.applyNgThreshold (proposeAction) →
 *     aiCopilot.confirmAction (token == actionId) — the EXISTING HITL confirm.
 *
 * Honest-degrade: shows the "chưa đủ mẫu (cần ≥N)" note and still allows a
 * cautious submit. Flag-off / not-found → friendly disabled note. vi/en/zh.
 * Everything optional-chained; renders fine while loading / empty / disabled.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import { Sparkles, Loader2, CheckCircle2, ArrowRight, Info, AlertTriangle } from "lucide-react";

type Lang = "vi" | "en" | "zh";

type Target =
  | { kind: "point"; measurementPointId: number; productModelId?: number; machineId?: number }
  | { kind: "ng"; ngThresholdId: number };

interface Props {
  target: Target;
  /** Called after a successful NG-threshold apply so the parent can refetch. */
  onApplied?: () => void;
  /** Called after a measurement-point request is submitted for approval. */
  onSubmitted?: () => void;
  className?: string;
  size?: "sm" | "default";
  variant?: "outline" | "secondary" | "default" | "ghost";
}

function cpkTone(cpk: number | null | undefined): string {
  if (cpk == null || !Number.isFinite(cpk)) return "text-muted-foreground";
  if (cpk >= 1.33) return "text-emerald-600 dark:text-emerald-400";
  if (cpk >= 1.0) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function fmt(v: number | null | undefined, unit?: string | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v}${unit ? ` ${unit}` : ""}`;
}

export default function AIThresholdSuggestButton({
  target,
  onApplied,
  onSubmitted,
  className,
  size = "sm",
  variant = "outline",
}: Props) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language?.startsWith("vi") ? "vi" : i18n.language?.startsWith("zh") ? "zh" : "en") as Lang;
  const [open, setOpen] = useState(false);
  // Point path ends in "submitted" (request queued for a different reviewer);
  // NG path ends in "applied" (HITL confirm writes the threshold). Never both.
  const [outcome, setOutcome] = useState<null | "submitted" | "applied">(null);

  const isPoint = target.kind === "point";

  // ── Queries (enabled only while the popover is open) ──────────────────────────
  const pointQuery = trpc.aiThresholdAdvisor.recommendForPoint.useQuery(
    isPoint ? { measurementPointId: (target as any).measurementPointId, productModelId: (target as any).productModelId, machineId: (target as any).machineId } : (undefined as any),
    { enabled: open && isPoint, retry: false, staleTime: 30_000 },
  );
  const ngQuery = trpc.aiThresholdAdvisor.recommendNgThreshold.useQuery(
    !isPoint ? { ngThresholdId: (target as any).ngThresholdId } : (undefined as any),
    { enabled: open && !isPoint, retry: false, staleTime: 30_000 },
  );

  // ── Mutations ─────────────────────────────────────────────────────────────────
  // Point path is REQUEST-ONLY (no approve mutation here) — self-approval is a
  // governance violation (doc 31 OP1). NG path keeps its HITL confirm flow.
  const requestMutation = trpc.thresholdApproval.request.useMutation();
  const applyNgMutation = trpc.aiThresholdAdvisor.applyNgThreshold.useMutation();
  const confirmActionMutation = trpc.aiCopilot.confirmAction.useMutation();

  const loading = isPoint ? pointQuery.isLoading : ngQuery.isLoading;
  const data: any = isPoint ? pointQuery.data : ngQuery.data;
  const busy =
    requestMutation.isPending ||
    applyNgMutation.isPending ||
    confirmActionMutation.isPending;

  const disabled = data?.disabled === true;
  const notFound = data && data.ok === false;
  const degraded = data?.degraded === true;
  const needsReview = (data as any)?.needsReview === true;

  // ── Submit: measurement point → thresholdApproval.request ONLY ────────────────
  // Creates a change request carrying the advisor's suggested limits + reasoning
  // + any evidence so the reviewer can decide. A DIFFERENT reviewer must approve
  // it (server enforces SoD) — this button never approves/applies.
  const submitPoint = async () => {
    if (!data?.recommended) return;
    try {
      const req = await requestMutation.mutateAsync({
        pointDefId: (target as any).measurementPointId,
        proposedLsl: data.recommended.lsl,
        proposedUsl: data.recommended.usl,
        proposedNominal: data.recommended.target,
        suggestion: {
          source: "aiThresholdAdvisor",
          basis: data.basis,
          sampleSize: data.sampleSize,
          confidence: data.confidence,
          currentCpk: data.current?.cpk,
          // page reads s.cpk ?? s.Cpk ?? s.proposedCpk → surface projected Cpk
          proposedCpk: data.recommended?.projectedCpk,
          code: data.code,
          name: data.name,
          unit: data.unit,
          degraded: data.degraded === true,
          needsReview: data.needsReview === true,
          recommended: {
            lsl: data.recommended.lsl,
            usl: data.recommended.usl,
            target: data.recommended.target,
          },
          ...(Array.isArray(data.evidence?.recentNg) ? { evidence: { recentNg: data.evidence.recentNg } } : {}),
        },
        comment: t("thresholdAdvisor.requestComment", "AI-suggested threshold — submitted for review"),
      });
      const id = (req as any)?.id;
      if (!id) {
        toast.error(t("thresholdAdvisor.submitFailed", "Submit failed"));
        return;
      }
      setOutcome("submitted");
      toast.success(t("thresholdAdvisor.submitted", "Submitted for approval — a different reviewer must approve"));
      onSubmitted?.();
    } catch {
      toast.error(t("thresholdAdvisor.submitFailed", "Submit failed"));
    }
  };

  // ── Apply: ng-threshold → applyNgThreshold (propose) + confirmAction ──────────
  const applyNg = async () => {
    if (!data?.recommended) return;
    try {
      const proposed = await applyNgMutation.mutateAsync({
        ngThresholdId: (target as any).ngThresholdId,
        warningThreshold: data.recommended.warning,
        criticalThreshold: data.recommended.critical,
        lang,
      });
      const actionId = (proposed as any)?.actionId;
      if (!proposed?.ok || !actionId) {
        toast.error((proposed as any)?.message ?? t("thresholdAdvisor.applyFailed", "Áp dụng thất bại"));
        return;
      }
      const confirmed = await confirmActionMutation.mutateAsync({ actionId, token: actionId, lang });
      if (confirmed?.ok) {
        setOutcome("applied");
        toast.success(confirmed.message ?? t("thresholdAdvisor.applied", "Đã áp dụng ngưỡng mới"));
        onApplied?.();
      } else {
        toast.error(confirmed?.message ?? t("thresholdAdvisor.applyFailed", "Áp dụng thất bại"));
      }
    } catch {
      toast.error(t("thresholdAdvisor.applyFailed", "Áp dụng thất bại"));
    }
  };

  const onAction = () => (isPoint ? submitPoint() : applyNg());

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setOutcome(null); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant={variant} size={size} className={cn("gap-1", className)}>
          <Sparkles className="h-3.5 w-3.5" />
          {t("thresholdAdvisor.suggestBtn", "🤖 AI đề xuất")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            {t("thresholdAdvisor.title", "Đề xuất ngưỡng (AI)")}
          </p>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
          {loading && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("thresholdAdvisor.loading", "AI đang tính toán...")}
            </div>
          )}

          {!loading && disabled && (
            <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 p-3 text-sm">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{data?.note ?? t("thresholdAdvisor.disabled", "Trợ lý đặt ngưỡng chưa bật.")}</span>
            </div>
          )}

          {!loading && notFound && !disabled && (
            <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span>{data?.note ?? t("thresholdAdvisor.notFound", "Không tính được đề xuất.")}</span>
            </div>
          )}

          {!loading && data && !disabled && !notFound && (
            <div className="space-y-3">
              {/* ── Measurement-point recommendation ─────────────────────── */}
              {isPoint ? (
                <>
                  <div className="grid grid-cols-3 gap-1 text-center text-xs">
                    <div />
                    <div className="font-semibold text-muted-foreground">{t("thresholdAdvisor.current", "Hiện tại")}</div>
                    <div className="font-semibold text-primary">{t("thresholdAdvisor.recommended", "Đề xuất")}</div>

                    <div className="text-left font-medium">LSL</div>
                    <div className="tabular-nums">{fmt(data.current?.lsl, data.unit)}</div>
                    <div className="tabular-nums font-semibold">{fmt(data.recommended?.lsl, data.unit)}</div>

                    <div className="text-left font-medium">USL</div>
                    <div className="tabular-nums">{fmt(data.current?.usl, data.unit)}</div>
                    <div className="tabular-nums font-semibold">{fmt(data.recommended?.usl, data.unit)}</div>

                    <div className="text-left font-medium">{t("thresholdAdvisor.target", "Mục tiêu")}</div>
                    <div className="tabular-nums">{fmt(data.current?.target, data.unit)}</div>
                    <div className="tabular-nums font-semibold">{fmt(data.recommended?.target, data.unit)}</div>
                  </div>

                  {/* Cpk before → after */}
                  <div className="flex items-center justify-center gap-2 rounded-md bg-muted/50 py-2 text-sm">
                    <span className="text-muted-foreground">Cpk</span>
                    <span className={cn("font-bold tabular-nums", cpkTone(data.current?.cpk))}>
                      {data.current?.cpk != null ? Number(data.current.cpk).toFixed(2) : "—"}
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    <span className={cn("font-bold tabular-nums", cpkTone(data.recommended?.projectedCpk))}>
                      {data.recommended?.projectedCpk != null ? Number(data.recommended.projectedCpk).toFixed(2) : "—"}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  {/* ── NG-threshold recommendation ─────────────────────── */}
                  <div className="grid grid-cols-3 gap-1 text-center text-xs">
                    <div />
                    <div className="font-semibold text-muted-foreground">{t("thresholdAdvisor.current", "Hiện tại")}</div>
                    <div className="font-semibold text-primary">{t("thresholdAdvisor.recommended", "Đề xuất")}</div>

                    <div className="text-left font-medium">{t("thresholdAdvisor.warning", "Cảnh báo")}</div>
                    <div className="tabular-nums">{fmt(data.current?.warning)}%</div>
                    <div className="tabular-nums font-semibold text-amber-600 dark:text-amber-400">{fmt(data.recommended?.warning)}%</div>

                    <div className="text-left font-medium">{t("thresholdAdvisor.critical", "Nghiêm trọng")}</div>
                    <div className="tabular-nums">{fmt(data.current?.critical)}%</div>
                    <div className="tabular-nums font-semibold text-red-600 dark:text-red-400">{fmt(data.recommended?.critical)}%</div>
                  </div>
                </>
              )}

              {/* Sample size + basis ("Vì sao") */}
              <div className="rounded-md border bg-muted/30 p-2.5 text-xs">
                <p className="flex items-center gap-1 font-semibold">
                  <Info className="h-3.5 w-3.5" />
                  {t("thresholdAdvisor.why", "Vì sao")}
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    {t("thresholdAdvisor.samples", "{{n}} mẫu", { n: data.sampleSize ?? 0 })}
                  </Badge>
                </p>
                <p className="mt-1 leading-snug text-muted-foreground break-words">{data.basis || "—"}</p>
              </div>

              {/* Needs-review note (data inconsistent with limits → block apply) */}
              {needsReview && (
                <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{data?.note ?? t("thresholdAdvisor.needsReview", "Dữ liệu lệch xa giới hạn — cần kỹ sư xem lại trước khi áp dụng.")}</span>
                </div>
              )}

              {/* Degraded note */}
              {degraded && !needsReview && (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{data.note ?? t("thresholdAdvisor.degraded", "Chưa đủ mẫu — hãy duyệt thận trọng.")}</span>
                </div>
              )}

              {/* Submit (point) / Apply (ng) / done */}
              {outcome === "submitted" ? (
                <div className="flex items-start gap-2 rounded-md border border-sky-300 bg-sky-50 p-2.5 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{t("thresholdAdvisor.submitted", "Submitted for approval — a different reviewer must approve")}</span>
                </div>
              ) : outcome === "applied" ? (
                <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-2.5 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {t("thresholdAdvisor.applied", "Đã áp dụng ngưỡng mới")}
                </div>
              ) : (
                <>
                  <Button className="w-full gap-1.5" disabled={busy || needsReview} onClick={onAction}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {needsReview
                      ? t("thresholdAdvisor.reviewFirst", "Cần xem lại trước")
                      : isPoint
                        ? t("thresholdAdvisor.submitBtn", "Submit for approval")
                        : t("thresholdAdvisor.applyBtn", "✅ Áp dụng")}
                  </Button>
                  {isPoint && !needsReview && (
                    <p className="flex items-start gap-1 text-[11px] leading-snug text-muted-foreground">
                      <Info className="mt-0.5 h-3 w-3 shrink-0" />
                      {t("thresholdAdvisor.sodHint", "This only submits a request — a different reviewer must approve it (you cannot approve your own).")}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
