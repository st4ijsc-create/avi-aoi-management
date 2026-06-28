/**
 * MachineAISummary — UX group B (P0): production-embedded AI signals.
 *
 * A compact, glanceable card showing per-machine AI signals for operators
 * watching the line (big readable text/colors, tablet/kiosk-friendly):
 *   1. Anomaly status   ← aiAnomaly.latestForMachine (realtime latest score + recent rate)
 *   2. PdM risk         ← predictiveMaintenance.getMachineRisk (failure risk + days-to-failure)
 *   3. Latest AI insight ← aiInsight.list (advisory insight for this machine)
 *
 * Data sources & guarding:
 *   - aiAnomaly.latestForMachine reads the most-recent scored AOI image embeddings
 *     for THIS machine (metadata->'anomaly') and returns latestScore/threshold +
 *     a recent anomaly-rate window. hasData:false → degrade to
 *     "Chưa có tín hiệu AI" / "Chưa thiết lập giám sát".
 *   - Every query is optional-chained and the card renders gracefully when a
 *     procedure errors, is loading, or returns nothing.
 *
 * Each card exposes an "Hỏi AI" link → opens the full chat (/ai-chat) with a
 * prefilled question about THIS machine (read-only; no write).
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Activity, ShieldAlert, Lightbulb, MessageCircle, Bot, Search } from "lucide-react";

type Tone = "green" | "amber" | "red" | "muted";

const toneText: Record<Tone, string> = {
  green: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-red-600 dark:text-red-400",
  muted: "text-muted-foreground",
};
const toneDot: Record<Tone, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  muted: "bg-muted-foreground/40",
};

export interface MachineAISummaryProps {
  machineId: number;
  machineCode?: string;
  machineName?: string;
  className?: string;
  /** Compact spacing for dense grids/kiosks. */
  compact?: boolean;
}

export default function MachineAISummary({
  machineId,
  machineCode,
  machineName,
  className,
  compact,
}: MachineAISummaryProps) {
  const { t, i18n } = useTranslation();
  const [, navigate] = useLocation();

  // ── PdM risk (guarded) ──────────────────────────────────────────────────────
  const riskQuery = trpc.predictiveMaintenance.getMachineRisk.useQuery(
    { machineId },
    { enabled: machineId > 0, staleTime: 60_000, retry: false },
  );
  // ── Anomaly realtime latest-score (guarded) ─────────────────────────────────
  const anomalyQuery = trpc.aiAnomaly.latestForMachine.useQuery(
    { machineId },
    { enabled: machineId > 0, staleTime: 30_000, retry: false },
  );
  // ── Latest advisory insight for this machine (guarded) ──────────────────────
  const insightQuery = trpc.aiInsight.list.useQuery(
    { machineCode: machineCode ?? undefined, status: "new", limit: 1 },
    { enabled: !!machineCode, staleTime: 60_000, retry: false },
  );

  const risk = riskQuery.data;
  const anomaly = anomalyQuery.data;
  const insight = Array.isArray(insightQuery.data) ? insightQuery.data[0] : undefined;

  const loading = riskQuery.isLoading || anomalyQuery.isLoading || insightQuery.isLoading;

  // ── Derive PdM signal ───────────────────────────────────────────────────────
  const pdm = useMemo(() => {
    if (!risk) return null;
    const urgency = (risk.maintenanceUrgency ?? "LOW") as string;
    const tone: Tone =
      urgency === "CRITICAL" || urgency === "HIGH" ? "red"
      : urgency === "MEDIUM" ? "amber"
      : "green";
    const hours = risk.predictedTimeframeHours;
    const days = typeof hours === "number" && hours > 0 ? Math.max(1, Math.round(hours / 24)) : null;
    return { tone, urgency, failureRisk: Math.round(risk.failureRisk ?? 0), days };
  }, [risk]);

  // ── Derive anomaly signal (realtime latest score) ───────────────────────────
  const anom = useMemo(() => {
    if (!anomaly?.hasData) return null;
    const score = typeof anomaly.latestScore === "number" ? anomaly.latestScore : null;
    const threshold = typeof anomaly.latestThreshold === "number" ? anomaly.latestThreshold : null;
    // Color rule: red if flagged anomaly (or score ≥ threshold);
    // amber if "warm" (score ≥ 80% of threshold); else green.
    let tone: Tone = "green";
    if (anomaly.isAnomaly || (score != null && threshold != null && score >= threshold)) {
      tone = "red";
    } else if (score != null && threshold != null && threshold > 0 && score >= threshold * 0.8) {
      tone = "amber";
    }
    const windowCount = anomaly.recent?.windowCount ?? 0;
    const anomalyCount = anomaly.recent?.anomalyCount ?? 0;
    const latestAt = anomaly.latestAt ? new Date(anomaly.latestAt) : null;
    return { tone, score, threshold, windowCount, anomalyCount, latestAt };
  }, [anomaly]);

  // Lightweight, locale-aware "x ago" for the latest scored timestamp.
  const timeAgo = (date: Date | null): string | null => {
    if (!date) return null;
    const sec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    const lang = i18n.language?.startsWith("vi") ? "vi" : i18n.language?.startsWith("zh") ? "zh" : "en";
    const pick = (vi: string, en: string, zh: string) => (lang === "vi" ? vi : lang === "zh" ? zh : en);
    if (sec < 60) return pick("vừa xong", "just now", "刚刚");
    const min = Math.floor(sec / 60);
    if (min < 60) return pick(`${min} phút trước`, `${min}m ago`, `${min}分钟前`);
    const hr = Math.floor(min / 60);
    if (hr < 24) return pick(`${hr} giờ trước`, `${hr}h ago`, `${hr}小时前`);
    const day = Math.floor(hr / 24);
    return pick(`${day} ngày trước`, `${day}d ago`, `${day}天前`);
  };

  // ── Derive insight signal ───────────────────────────────────────────────────
  const ins = useMemo(() => {
    if (!insight) return null;
    const sev = (insight.severity ?? "info") as string;
    const tone: Tone = sev === "critical" ? "red" : sev === "warning" ? "amber" : "green";
    return { tone, title: insight.title as string, severity: sev };
  }, [insight]);

  const hasAnySignal = !!pdm || !!anom || !!ins;

  const askAI = () => {
    const label = machineCode ?? machineName ?? `#${machineId}`;
    const question = t(
      "machineAI.askQuestion",
      "Máy {{machine}} đang có tín hiệu AI gì? Tóm tắt rủi ro hỏng hóc và bất thường.",
      { machine: label },
    );
    navigate(`/ai-chat?q=${encodeURIComponent(question)}`);
  };

  // Deep-link to the RCA Copilot for THIS machine (auto-runs the diagnosis).
  const diagnose = () => {
    navigate(`/technician-copilot?machineId=${machineId}`);
  };

  return (
    <div
      className={cn(
        "rounded-lg border bg-card",
        compact ? "p-2.5" : "p-3",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Bot className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground truncate">
            {t("machineAI.title", "Tín hiệu AI")}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={diagnose}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            title={t("machineAI.diagnose", "Chẩn đoán")}
          >
            <Search className="h-3.5 w-3.5" />
            {t("machineAI.diagnose", "Chẩn đoán")}
          </button>
          <button
            type="button"
            onClick={askAI}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            title={t("machineAI.askAI", "Hỏi AI")}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {t("machineAI.askAI", "Hỏi AI")}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground py-1">{t("machineAI.loading", "Đang tải...")}</p>
      ) : !hasAnySignal ? (
        <p className="text-sm text-muted-foreground py-1">
          {t("machineAI.noSignal", "Chưa có tín hiệu AI")}
        </p>
      ) : (
        <div className="space-y-2">
          {/* Anomaly — realtime latest score */}
          {!anom ? (
            <SignalRow
              icon={Activity}
              label={t("machineAI.anomaly", "Bất thường")}
              tone="muted"
              value={t("machineAI.anomalyNotMonitored", "Chưa thiết lập giám sát")}
            />
          ) : (
            <div className="flex items-start justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground pt-0.5">
                <Activity className="h-3.5 w-3.5" />
                {t("machineAI.anomaly", "Bất thường")}
              </span>
              <div className="flex flex-col items-end gap-0.5 min-w-0">
                <span className={cn("flex items-center gap-1.5 text-sm font-semibold", toneText[anom.tone])}>
                  <span className={cn("inline-block h-2 w-2 rounded-full", toneDot[anom.tone])} />
                  {anom.score != null
                    ? t("machineAI.anomalyScore", "Điểm {{score}}", { score: anom.score.toFixed(2) })
                    : t("machineAI.anomalyReady", "Đang giám sát")}
                </span>
                <span className="text-[11px] text-muted-foreground leading-tight text-right">
                  {t("machineAI.anomalyRecent", "{{n}}/{{total}} bất thường gần đây", {
                    n: anom.anomalyCount,
                    total: anom.windowCount,
                  })}
                  {anom.latestAt && (
                    <span className="opacity-70"> · {timeAgo(anom.latestAt)}</span>
                  )}
                </span>
              </div>
            </div>
          )}
          {/* PdM risk */}
          <SignalRow
            icon={ShieldAlert}
            label={t("machineAI.pdm", "Rủi ro hỏng hóc")}
            tone={pdm ? pdm.tone : "muted"}
            value={
              !pdm
                ? t("machineAI.noData", "—")
                : pdm.days != null
                  ? t("machineAI.pdmValueDays", "{{risk}}% · ~{{days}} ngày", {
                      risk: pdm.failureRisk,
                      days: pdm.days,
                    })
                  : t("machineAI.pdmValue", "{{risk}}%", { risk: pdm.failureRisk })
            }
          />
          {/* Latest insight */}
          {ins && (
            <div className="flex items-start gap-2 pt-1.5 border-t border-border/40">
              <Lightbulb className={cn("h-4 w-4 shrink-0 mt-0.5", toneText[ins.tone])} />
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground leading-none mb-0.5">
                  {t("machineAI.latestInsight", "Khuyến nghị mới nhất")}
                </p>
                <p className="text-xs leading-snug line-clamp-2">{ins.title}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SignalRow({
  icon: Icon,
  label,
  tone,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone: Tone;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className={cn("flex items-center gap-1.5 text-sm font-semibold", toneText[tone])}>
        <span className={cn("inline-block h-2 w-2 rounded-full", toneDot[tone])} />
        {value}
      </span>
    </div>
  );
}
