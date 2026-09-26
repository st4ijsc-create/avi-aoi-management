/**
 * "Today" Briefing — a compact, glanceable, role-aware card shown at the TOP of
 * the landing page so the user SEES a personalized summary with ZERO clicks.
 *
 * Design ref: docs/ECOSYSTEM/05_AI_MINIMAL_EFFORT_UX_IDEAS_2026-06.md (§2).
 *
 * Consumes trpc.aiToday.get() (read-only, role-routed on the server). Renders a
 * big localized headline + a few key chips/metrics + up to ~3 "needs attention"
 * rows, each deep-linking to the AI assistant prefilled with a question. Has a
 * loading skeleton, a "good news" empty state, and is session-dismissible
 * (collapse). Optional-chains everything; never assumes a payload shape.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { getSharedSocket } from "@/lib/socketManager";
import { RealtimeBadge, useSocketConnected } from "@/components/RealtimeBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Inbox,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types (mirror server/services/aiTodayBriefing.ts) ─────────────────────────

type Severity = "critical" | "warning" | "info" | "ok";

interface AttentionRow {
  machineCode: string;
  reason: string;
  severity: Severity;
  pdmRisk?: number;
  anomaly?: number;
}

interface Briefing {
  role?: "maintenance" | "operator" | "manager" | "quality" | "viewer";
  lang?: string;
  severity?: Severity;
  headline?: string;
  payload?: any;
  warnings?: string[];
  generatedAt?: string;
}

// ─── Severity → accent ─────────────────────────────────────────────────────────

function accent(sev: Severity | undefined) {
  switch (sev) {
    case "critical":
      return { bar: "border-l-red-500", chip: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300", icon: "text-red-600 dark:text-red-400" };
    case "warning":
      return { bar: "border-l-amber-500", chip: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300", icon: "text-amber-600 dark:text-amber-400" };
    case "info":
      return { bar: "border-l-blue-500", chip: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300", icon: "text-blue-600 dark:text-blue-400" };
    default:
      return { bar: "border-l-emerald-500", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300", icon: "text-emerald-600 dark:text-emerald-400" };
  }
}

// ─── A single metric chip ──────────────────────────────────────────────────────

function MetricChip({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="rounded-lg border bg-card/60 px-3 py-1.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums text-foreground">{value ?? "—"}</div>
    </div>
  );
}

// ─── A "needs attention" row (deep-linkable) ───────────────────────────────────

function AttentionItem({ row, onClick }: { row: AttentionRow; onClick: () => void }) {
  const a = accent(row?.severity);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg border border-l-4 bg-card/60 px-3 py-2 text-left transition-colors hover:bg-muted/50",
        a.bar,
      )}
    >
      <AlertTriangle className={cn("size-4 shrink-0", a.icon)} />
      <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
        <Cpu className="size-3" />
        {row?.machineCode}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{row?.reason}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

// ─── Per-role body ─────────────────────────────────────────────────────────────

function BriefingBody({
  briefing,
  onAsk,
  onInbox,
}: {
  briefing: Briefing;
  onAsk: (row: AttentionRow) => void;
  onInbox: () => void;
}) {
  const { t } = useTranslation();
  const role = briefing?.role;
  const p = briefing?.payload ?? {};

  if (role === "maintenance") {
    const rows: AttentionRow[] = p?.machinesNeedingAttention ?? [];
    return (
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onInbox}>
            <Inbox className="size-3.5" />
            {t("today.openProposals", { count: p?.openProposals ?? 0 })}
          </Button>
        </div>
        {rows.length > 0 ? (
          <div className="space-y-1.5">
            {rows.map((r) => (
              <AttentionItem key={r.machineCode} row={r} onClick={() => onAsk(r)} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (role === "operator") {
    const alerts: AttentionRow[] = p?.activeAlerts ?? [];
    return (
      <div className="space-y-2.5">
        <div className="flex flex-wrap gap-2">
          <MetricChip label={t("today.yield")} value={p?.myLineStatus?.yield != null ? `${p.myLineStatus.yield}%` : null} />
          <MetricChip label={t("today.ngCount")} value={p?.myLineStatus?.ngCount ?? 0} />
        </div>
        {alerts.length > 0 ? (
          <div className="space-y-1.5">
            {alerts.map((r) => (
              <AttentionItem key={r.machineCode} row={r} onClick={() => onAsk(r)} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (role === "manager") {
    const k = p?.shiftKpis ?? {};
    const exceptions: AttentionRow[] = p?.exceptions ?? [];
    return (
      <div className="space-y-2.5">
        <div className="flex flex-wrap gap-2">
          <MetricChip label={t("today.oee")} value={k?.oee != null ? `${k.oee}%` : null} />
          <MetricChip label={t("today.yield")} value={k?.yield != null ? `${k.yield}%` : null} />
          <MetricChip label={t("today.ngRate")} value={k?.ngRate != null ? `${k.ngRate}%` : null} />
          <MetricChip label={t("today.throughput")} value={k?.throughput ?? 0} />
        </div>
        {(p?.topDefect || (p?.pdmRiskCount ?? 0) > 0) && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {p?.topDefect && (
              <Badge variant="outline" className="font-normal">
                {t("today.topDefect")}: {p.topDefect?.type} ({p.topDefect?.count})
              </Badge>
            )}
            {(p?.pdmRiskCount ?? 0) > 0 && (
              <Badge variant="outline" className="font-normal">
                {t("today.pdmRiskCount", { count: p.pdmRiskCount })}
              </Badge>
            )}
          </div>
        )}
        {exceptions.length > 0 ? (
          <div className="space-y-1.5">
            {exceptions.map((r) => (
              <AttentionItem key={r.machineCode} row={r} onClick={() => onAsk(r)} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  // quality / viewer — read-only subset
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
        <MetricChip label={t("today.yield")} value={p?.yield != null ? `${p.yield}%` : null} />
        <MetricChip label={t("today.ngRate")} value={p?.ngRate != null ? `${p.ngRate}%` : null} />
        <MetricChip label={t("today.ngCount")} value={p?.ngCount ?? 0} />
      </div>
      {p?.topDefect && (
        <Badge variant="outline" className="font-normal">
          {t("today.topDefect")}: {p.topDefect?.type} ({p.topDefect?.count})
        </Badge>
      )}
    </div>
  );
}

// ─── The card ──────────────────────────────────────────────────────────────────

export function TodayBriefing({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const [, setLocation] = useLocation();
  const [dismissed, setDismissed] = useState(false);

  const lang = (i18n.language?.slice(0, 2) as "vi" | "en" | "zh") ?? "vi";
  const connected = useSocketConnected();
  const query = trpc.aiToday.get.useQuery(
    { lang },
    { refetchOnWindowFocus: false, retry: false, staleTime: 60_000 },
  );

  // Realtime: the briefing summarizes today's state — refresh it when a relevant
  // shop-floor event lands so the headline never goes stale on screen.
  useEffect(() => {
    const socket = getSharedSocket();
    const refresh = () => void query.refetch();
    const events = [
      "andon:event",
      "inspection:alert",
      "ng:alert",
      "yield:warning",
      "machine:status_change",
    ];
    events.forEach((e) => socket.on(e, refresh));
    return () => {
      events.forEach((e) => socket.off(e, refresh));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (dismissed) return null;

  // Loading skeleton
  if (query.isLoading) {
    return (
      <div className={cn("rounded-xl border bg-card p-4 shadow-sm", className)}>
        <Skeleton className="h-6 w-2/3" />
        <div className="mt-3 flex gap-2">
          <Skeleton className="h-12 w-24" />
          <Skeleton className="h-12 w-24" />
          <Skeleton className="h-12 w-24" />
        </div>
        <Skeleton className="mt-3 h-9 w-full" />
      </div>
    );
  }

  // On error → render nothing (additive, never breaks the page).
  if (query.isError || !query.data) return null;

  const briefing = query.data as Briefing;
  const sev = briefing?.severity ?? "ok";
  const a = accent(sev);
  const isOk = sev === "ok";

  const handleAsk = (row: AttentionRow) => {
    const q = `${t("today.askPrefix")} ${row?.machineCode ?? ""} — ${row?.reason ?? ""}`.trim();
    setLocation(`/ai-chat?q=${encodeURIComponent(q)}`);
  };
  // doc 69 T6 — /ai-hub retired/merged into /ai-home.
  const handleInbox = () => setLocation("/ai-home");

  return (
    <div
      className={cn(
        "rounded-xl border border-l-4 bg-card p-4 shadow-sm",
        a.bar,
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className={cn("mt-0.5 shrink-0", a.icon)}>
          {isOk ? <CheckCircle2 className="size-6" /> : <Sparkles className="size-6" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("today.title")}
            </span>
            {!isOk && (
              <Badge className={cn("text-[11px] font-semibold", a.chip)}>
                {t(`today.severity.${sev}`)}
              </Badge>
            )}
            <RealtimeBadge connected={connected} pollingFallback={false} className="ml-1" />
          </div>
          <h2 className="mt-0.5 text-lg font-semibold leading-snug text-foreground break-words">
            {briefing?.headline ?? t("today.empty")}
          </h2>

          <div className="mt-3">
            {isOk && !briefing?.payload ? (
              <p className="text-sm text-muted-foreground">{t("today.emptyHint")}</p>
            ) : (
              <BriefingBody briefing={briefing} onAsk={handleAsk} onInbox={handleInbox} />
            )}
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground"
          onClick={() => setDismissed(true)}
          title={t("today.dismiss")}
          aria-label={t("today.dismiss")}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export default TodayBriefing;
