/**
 * Executive Mobile / PWA view (doc 46 FE-W3.5, decision D5).
 *
 * A mobile-first, touch-friendly executive surface an exec opens on their phone:
 * today's KPI briefing (live OEE + yield/FPY + output + plan attainment + top
 * risks), the AI executive summary, and pending approvals — installable as a PWA
 * landing at /executive.
 *
 * PRINCIPLES
 *  - REUSE, never re-derive: every number comes from an EXISTING tRPC procedure
 *    (same sources CorporateDashboard / ManagementInsight / ApprovalsInbox use).
 *    No new backend, no fabricated figures.
 *  - HONEST-DEGRADATION everywhere: live OEE with no telemetry → "N/A" (not 0),
 *    plan attainment behind a permission the user lacks → an honest restricted
 *    note, and the AI summary renders its server-guarded offline/rule-based
 *    template gracefully (the FE-W0.3 guardrail already strips degenerate LLM
 *    loops server-side, so we only ever render clean structured fields).
 *  - Real-time-light: refetch on window focus + a manual refresh button + a poll
 *    fallback (no sockets). Big glanceable numbers, large tap targets.
 *  - Read-only: approvals are shown as counts + top items with a deep-link to the
 *    full inbox where the real, permission-gated approve/reject actions live.
 *
 * This page is intentionally NOT wrapped in <DashboardLayout>: it is a lean,
 * full-bleed installable landing. Global providers (tRPC, i18n, theme, auth) live
 * at the app root, so everything still works standalone.
 */
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PollFreshness } from "@/components/PollFreshness";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  ClipboardCheck,
  Gauge,
  Info,
  Lightbulb,
  Package,
  Percent,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";

// ── Query options shared by the "live-ish" queries ─────────────────────────────
// Global QueryClient defaults are staleTime 30s + refetchOnWindowFocus:false
// (main.tsx). An exec briefing wants the opposite: refetch when they re-open the
// tab, plus a slow poll as a fallback. We opt in per-query.
const LIVE_OPTS = {
  refetchOnWindowFocus: true,
  refetchInterval: 60_000,
  staleTime: 15_000,
} as const;

// The AI summary is generated on a schedule (expensive) — poll it much slower.
const SUMMARY_OPTS = {
  refetchOnWindowFocus: true,
  refetchInterval: 300_000,
  staleTime: 120_000,
} as const;

type Tone = "default" | "success" | "warning" | "info" | "destructive";

const TONE_CLASS: Record<Tone, string> = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  info: "text-info",
  destructive: "text-destructive",
};

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString();
}
function fmtPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

/**
 * Client-side defence against degenerate LLM text (doc 46 FE-W0.3 spirit).
 *
 * The server guardrail strips "cell cell cell…" / "slide slide slide…" loops
 * BEFORE persistence, but older persisted reports (and any that slip through with
 * `degraded` unset) can still carry a gibberish narrative. HONEST-DEGRADATION: we
 * detect an obvious repetition loop and refuse to render it — never gibberish.
 */
function looksDegenerate(text?: string | null): boolean {
  if (!text) return false;
  const words = text.trim().split(/\s+/);
  if (words.length < 12) return false; // too short to judge; let it render
  const counts = new Map<string, number>();
  let max = 0;
  for (const w of words) {
    const n = (counts.get(w) ?? 0) + 1;
    counts.set(w, n);
    if (n > max) max = n;
  }
  const uniqueRatio = counts.size / words.length;
  const topRatio = max / words.length;
  // Very few distinct words, or one word dominating → a repetition loop.
  return uniqueRatio < 0.35 || topRatio > 0.3;
}

// ── Big glanceable KPI tile ────────────────────────────────────────────────────
function KpiTile({
  icon,
  label,
  value,
  unit,
  tone = "default",
  sub,
  loading,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  unit?: string;
  tone?: Tone;
  sub?: React.ReactNode;
  loading?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <span aria-hidden className="shrink-0 text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
            {icon}
          </span>
        </div>
        {loading ? (
          <Skeleton className="h-9 w-20" />
        ) : (
          <div className={`flex items-baseline gap-1 text-4xl font-bold leading-none tabular-nums ${TONE_CLASS[tone]}`}>
            <span className="truncate">{value ?? "—"}</span>
            {value != null && unit && (
              <span className="text-lg font-semibold text-muted-foreground">{unit}</span>
            )}
          </div>
        )}
        {sub != null && <div className="mt-1.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ── Section heading ────────────────────────────────────────────────────────────
function SectionTitle({
  icon,
  children,
  right,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  right?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span aria-hidden className="text-primary [&_svg]:h-5 [&_svg]:w-5">{icon}</span>
      <h2 className="text-base font-semibold">{children}</h2>
      {right != null && <span className="ml-auto">{right}</span>}
    </div>
  );
}

// ── Honest inline error block (AUD-01 error-honesty) ──────────────────────────
// Each section renders this INSTEAD of its reassuring empty-state when its query
// failed — "no risks flagged" / "all caught up" may only ever render on success.
function ErrorInline({
  onRetry,
  className,
}: {
  onRetry: () => void;
  className?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className={`flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 ${className ?? ""}`}
    >
      <div className="flex min-w-0 items-center gap-2 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">{t("executiveMobile.error.load", "Couldn't load data")}</span>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 shrink-0 gap-1.5"
        onClick={onRetry}
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        {t("executiveMobile.error.retry", "Retry")}
      </Button>
    </div>
  );
}

function severityTone(sev?: string | null): Tone {
  switch ((sev ?? "").toLowerCase()) {
    case "critical":
    case "error":
      return "destructive";
    case "warning":
      return "warning";
    default:
      return "info";
  }
}

export default function ExecutiveMobile(): React.JSX.Element {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { hasPermission } = usePermissions();

  // Stable "start of today" so the getStats query key does not churn every render
  // (an ever-changing `now` endDate would trigger an infinite refetch loop).
  const startOfToday = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // ── Permission gates (honest degradation, mirrors ApprovalsInbox / war-room) ──
  const canViewWarRoom = hasPermission("machine_status", "canView");
  const canViewThresholds = hasPermission("settings_alerts", "canView");
  const canViewDeploys = hasPermission("machine_monitoring", "canView");

  // ── (1) KPI briefing sources ─────────────────────────────────────────────────
  // Today's throughput / yield / FPY (same shape CorporateDashboard consumes).
  const statsQ = trpc.dashboard.getStats.useQuery({ startDate: startOfToday }, LIVE_OPTS);
  // Live per-machine OEE — corporate-wide average, honest-null when no telemetry.
  const oeeQ = trpc.mqttClient.getAllOEE.useQuery(undefined, LIVE_OPTS);
  // War-room briefing → output-vs-plan (permission-gated; honest N/A otherwise).
  const warRoomQ = trpc.warRoom.briefing.useQuery(undefined, {
    ...LIVE_OPTS,
    enabled: canViewWarRoom,
  });
  // Live advisory AI insights → "top risks" (distinct real source from the AI narrative).
  const insightsQ = trpc.aiInsight.list.useQuery({ status: "new", limit: 20 }, LIVE_OPTS);

  // ── (2) AI executive summary ─────────────────────────────────────────────────
  const summaryQ = trpc.executiveReport.latest.useQuery(undefined, SUMMARY_OPTS);

  // ── (3) Pending approvals (read-only counts + top items) ─────────────────────
  const thresholdQ = trpc.thresholdApproval.list.useQuery(
    { status: "requested", limit: 50 },
    { ...LIVE_OPTS, enabled: canViewThresholds },
  );
  const aiInboxQ = trpc.aiInbox.list.useQuery({ limit: 50 }, LIVE_OPTS);
  const deployQ = trpc.programming.listDeployApprovals.useQuery(undefined, {
    ...LIVE_OPTS,
    enabled: canViewDeploys,
  });

  // ── Manual refresh — refetch everything ──────────────────────────────────────
  const anyFetching =
    statsQ.isFetching ||
    oeeQ.isFetching ||
    warRoomQ.isFetching ||
    insightsQ.isFetching ||
    summaryQ.isFetching ||
    thresholdQ.isFetching ||
    aiInboxQ.isFetching ||
    deployQ.isFetching;

  const refreshAll = useCallback(() => {
    void statsQ.refetch();
    void oeeQ.refetch();
    if (canViewWarRoom) void warRoomQ.refetch();
    void insightsQ.refetch();
    void summaryQ.refetch();
    if (canViewThresholds) void thresholdQ.refetch();
    void aiInboxQ.refetch();
    if (canViewDeploys) void deployQ.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewWarRoom, canViewThresholds, canViewDeploys]);

  // ── Freshness (AUD-01) — derived ONLY from react-query dataUpdatedAt ─────────
  // This surface is poll-based (60s interval, no socket): the header indicator is
  // PollFreshness fed by the newest successful fetch across the KPI-bearing
  // queries. A never-fetched query reports dataUpdatedAt=0 → filtered out, so the
  // stamp is undefined (honest "unknown") until real data lands. No client-side
  // "Updated now" stamping — a refresh only moves the stamp when a fetch SUCCEEDS.
  const freshestAt = useMemo(() => {
    const ts = [statsQ.dataUpdatedAt, oeeQ.dataUpdatedAt, warRoomQ.dataUpdatedAt].filter(
      (v) => v > 0,
    );
    return ts.length > 0 ? Math.max(...ts) : undefined;
  }, [statsQ.dataUpdatedAt, oeeQ.dataUpdatedAt, warRoomQ.dataUpdatedAt]);

  // ── Derived KPI values ───────────────────────────────────────────────────────
  const stats = statsQ.data;
  const yieldRate = stats ? stats.yieldRate : null;
  const fpy = stats ? stats.fpy : null;
  const outputToday = stats ? stats.total : null;

  // Corporate-wide live OEE = mean of per-machine live OEE. null when none report.
  const avgOee = useMemo<number | null>(() => {
    const rows = oeeQ.data;
    if (!rows || rows.length === 0) return null;
    const valid = rows.filter((m) => typeof m.oee === "number" && !Number.isNaN(m.oee));
    if (valid.length === 0) return null;
    return Math.round((valid.reduce((a, m) => a + m.oee, 0) / valid.length) * 10) / 10;
  }, [oeeQ.data]);

  // Output-vs-plan pace: aggregate the set-based planVsActual (expected = share of
  // shift elapsed × target). null when there is no plan target on any line.
  const plan = useMemo(() => {
    const b = warRoomQ.data;
    if (!b || b.planVsActual.length === 0) return null;
    let expected = 0;
    let actual = 0;
    for (const p of b.planVsActual) {
      expected += p.expected;
      actual += p.actual;
    }
    if (expected <= 0) return null;
    return { expected, actual, pct: Math.round((actual / expected) * 1000) / 10 };
  }, [warRoomQ.data]);

  // Top risks = live advisory insights (critical/warning first), then the rest.
  // Exclude `exec_report` echoes (those are summaries, not risks — and can carry a
  // pre-guardrail degenerate body) and defensively drop any gibberish body.
  const topRisks = useMemo(() => {
    const rows = (insightsQ.data ?? []) as Array<{
      id: number;
      source?: string | null;
      title?: string | null;
      body?: string | null;
      severity?: string | null;
      machineCode?: string | null;
    }>;
    const rank = (s?: string | null) =>
      (s ?? "").toLowerCase() === "critical" ? 0 : (s ?? "").toLowerCase() === "warning" ? 1 : 2;
    return rows
      .filter((r) => r.source !== "exec_report")
      .map((r) => ({ ...r, body: looksDegenerate(r.body) ? null : r.body }))
      .sort((a, b) => rank(a.severity) - rank(b.severity))
      .slice(0, 3);
  }, [insightsQ.data]);

  // ── AI summary shape (PersistedExecSummary.summary = ExecutiveSummaryStructured) ─
  const report = summaryQ.data as
    | {
        period?: string | null;
        createdAt?: string | Date | null;
        summary?: {
          headline?: string;
          highlights?: string[];
          risks?: string[];
          recommendations?: string[];
          generatedAt?: string;
          generatedBy?: "gguf" | "offline";
          degraded?: boolean;
        } | null;
      }
    | null
    | undefined;
  const summary = report?.summary ?? null;
  const summaryOffline = summary?.generatedBy === "offline";
  // Honest narrative filtering: only render clean text. If the (LLM) headline is a
  // degenerate loop, suppress it and flag the summary as degraded — the structured
  // highlights/risks (rule-based, clean) still carry the briefing.
  const headlineDegenerate = looksDegenerate(summary?.headline);
  const summaryDegraded = !!summary && (summary.degraded === true || headlineDegenerate);
  const cleanHeadline = summary && summary.headline && !headlineDegenerate ? summary.headline : null;
  const cleanHighlights = (summary?.highlights ?? []).filter((h) => !looksDegenerate(h)).slice(0, 4);
  const cleanRisks = (summary?.risks ?? []).filter((r) => !looksDegenerate(r)).slice(0, 4);

  // ── Approvals aggregation ────────────────────────────────────────────────────
  const thresholdRows = (canViewThresholds ? thresholdQ.data ?? [] : []) as Array<{
    id: number;
    pointCode?: string | null;
    pointDefId: number;
    productCode?: string | null;
  }>;
  // aiInbox.list mixes proposal | insight | alert (server/services/aiActionInbox.ts
  // InboxItemType). Only `proposal` items actually await a decision — insight/alert
  // are FYI (and insights already surface in "Top risks" above), so counting them
  // here would inflate the number AND double-show insights. Keep proposals only.
  const aiInboxRaw = (aiInboxQ.data?.items ?? []) as Array<{ id: string; title: string; type: string }>;
  const aiInboxProposals = useMemo(
    () => aiInboxRaw.filter((it) => it.type === "proposal"),
    [aiInboxQ.data], // eslint-disable-line react-hooks/exhaustive-deps -- aiInboxRaw is derived from aiInboxQ.data
  );
  // The unified feed is capped server-side at our `limit: 50` (listInbox slices the
  // severity-sorted merge). A full page means proposals beyond the cap may have been
  // cut, so the total is only a lower bound → render "N+" instead of an exact count.
  const aiInboxTruncated = aiInboxRaw.length >= 50;
  const deployRows = (canViewDeploys ? deployQ.data ?? [] : []) as Array<{
    deployment: { id: number; projectId: number };
    project?: { code?: string | null } | null;
  }>;

  const approvalsTotal = thresholdRows.length + aiInboxProposals.length + deployRows.length;
  const approvalsDisplay = aiInboxTruncated ? `${approvalsTotal}+` : String(approvalsTotal);

  const approvalItems = useMemo(() => {
    const items: Array<{ key: string; kind: string; label: string; title: string }> = [];
    for (const r of thresholdRows.slice(0, 3)) {
      items.push({
        key: `th-${r.id}`,
        kind: t("executiveMobile.approvals.threshold", "Threshold"),
        label: r.pointCode?.trim() || `MP-${r.pointDefId}`,
        title: r.productCode?.trim() || "",
      });
    }
    for (const it of aiInboxProposals.slice(0, 3)) {
      items.push({
        key: `ai-${it.id}`,
        kind: t("executiveMobile.approvals.aiInbox", "AI inbox"),
        label: it.title,
        title: "",
      });
    }
    for (const r of deployRows.slice(0, 3)) {
      items.push({
        key: `dp-${r.deployment.id}`,
        kind: t("executiveMobile.approvals.deploy", "Deploy"),
        label: r.project?.code?.trim() || `#${r.deployment.projectId}`,
        title: "",
      });
    }
    return items.slice(0, 5);
  }, [thresholdRows, aiInboxProposals, deployRows, t]);

  const approvalsLoading =
    (canViewThresholds && thresholdQ.isLoading) ||
    aiInboxQ.isLoading ||
    (canViewDeploys && deployQ.isLoading);

  // AUD-01: any failed approvals feed poisons the aggregate — a partial count
  // (and especially "all caught up") would be a lie. Only permission-enabled
  // queries participate.
  const approvalsError =
    (canViewThresholds && thresholdQ.isError) ||
    aiInboxQ.isError ||
    (canViewDeploys && deployQ.isError);
  const retryApprovals = useCallback(() => {
    if (canViewThresholds && thresholdQ.isError) void thresholdQ.refetch();
    if (aiInboxQ.isError) void aiInboxQ.refetch();
    if (canViewDeploys && deployQ.isError) void deployQ.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canViewThresholds,
    canViewDeploys,
    thresholdQ.isError,
    aiInboxQ.isError,
    deployQ.isError,
  ]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Sticky app bar — big title, honest poll-freshness stamp, manual refresh. */}
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Gauge className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold leading-tight">
              {t("executiveMobile.title", "Executive briefing")}
            </div>
            {/* AUD-01: the ONLY freshness indicator on this page — driven by
                react-query dataUpdatedAt (poll surface, no socket), so it goes
                amber-stale by itself when polling silently stops delivering. */}
            <PollFreshness
              updatedAt={freshestAt}
              isFetching={anyFetching}
              staleAfterMs={150_000}
              className="mt-0.5"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0"
            onClick={refreshAll}
            disabled={anyFetching}
            aria-label={t("executiveMobile.refresh", "Refresh")}
          >
            <RefreshCw className={`h-5 w-5 ${anyFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl space-y-6 px-4 pb-24 pt-4">
        <OfflineBanner />

        {/* ── (1) KPI briefing ─────────────────────────────────────────────── */}
        <section aria-label={t("executiveMobile.kpi.title", "KPI briefing")}>
          {/* AUD-01: no unconditional "Live" badge — this is a 60s poll surface;
              the header PollFreshness is the single source of freshness truth. */}
          <SectionTitle icon={<Activity />}>
            {t("executiveMobile.kpi.title", "KPI briefing")}
          </SectionTitle>

          {/* Error-honesty: a failed KPI query renders an explicit error block —
              the tiles alone would show a misleading quiet "—" / "no telemetry". */}
          {(statsQ.isError || oeeQ.isError) && (
            <ErrorInline
              className="mb-3"
              onRetry={() => {
                if (statsQ.isError) void statsQ.refetch();
                if (oeeQ.isError) void oeeQ.refetch();
              }}
            />
          )}

          <div className="grid grid-cols-2 gap-3">
            <KpiTile
              icon={<Gauge />}
              label={t("executiveMobile.kpi.oee", "Live OEE")}
              value={avgOee != null ? fmtPct(avgOee) : null}
              tone={avgOee == null ? "default" : avgOee >= 70 ? "success" : avgOee >= 50 ? "warning" : "destructive"}
              loading={oeeQ.isLoading}
              sub={
                oeeQ.isError
                  ? null // error block above already explains — "no telemetry" would be a lie
                  : avgOee == null
                    ? t("executiveMobile.kpi.noOee", "No live telemetry")
                    : t("executiveMobile.kpi.machinesReporting", "{{count}} machines reporting", {
                        count: oeeQ.data?.length ?? 0,
                      })
              }
            />
            <KpiTile
              icon={<Percent />}
              label={t("executiveMobile.kpi.yield", "Yield (today)")}
              value={yieldRate != null ? fmtPct(yieldRate) : null}
              tone={yieldRate == null ? "default" : yieldRate >= 95 ? "success" : yieldRate >= 85 ? "warning" : "destructive"}
              loading={statsQ.isLoading}
              sub={t("executiveMobile.kpi.finalYield", "Final yield")}
            />
            <KpiTile
              icon={<Target />}
              label={t("executiveMobile.kpi.fpy", "FPY (today)")}
              value={fpy != null ? fmtPct(fpy) : null}
              tone={fpy == null ? "default" : fpy >= 95 ? "success" : fpy >= 85 ? "warning" : "destructive"}
              loading={statsQ.isLoading}
              sub={t("executiveMobile.kpi.firstPass", "First-pass yield")}
            />
            <KpiTile
              icon={<Package />}
              label={t("executiveMobile.kpi.output", "Output (today)")}
              value={outputToday != null ? fmtInt(outputToday) : null}
              tone="info"
              loading={statsQ.isLoading}
              sub={t("executiveMobile.kpi.inspected", "Units inspected")}
            />
          </div>

          {/* Output vs plan — full-width, honest permission/empty degradation. */}
          <Card className="mt-3">
            <CardContent className="p-4">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("executiveMobile.kpi.planAttainment", "Plan attainment (on pace)")}
                </span>
                <Target aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              {!canViewWarRoom ? (
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
                  {t("executiveMobile.kpi.planRestricted", "Requires production-monitoring access")}
                </div>
              ) : warRoomQ.isError ? (
                <ErrorInline onRetry={() => void warRoomQ.refetch()} />
              ) : warRoomQ.isLoading ? (
                <Skeleton className="h-9 w-32" />
              ) : plan == null ? (
                <div className="text-sm text-muted-foreground">
                  {t("executiveMobile.kpi.noPlan", "No plan target set for today")}
                </div>
              ) : (
                <div className="flex items-end justify-between gap-3">
                  <div
                    className={`text-4xl font-bold leading-none tabular-nums ${
                      plan.pct >= 100 ? "text-success" : plan.pct >= 90 ? "text-warning" : "text-destructive"
                    }`}
                  >
                    {fmtPct(plan.pct, 0)}
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>
                      {t("executiveMobile.kpi.actual", "Actual")}: <span className="tabular-nums font-medium text-foreground">{fmtInt(plan.actual)}</span>
                    </div>
                    <div>
                      {t("executiveMobile.kpi.expected", "Expected")}: <span className="tabular-nums">{fmtInt(plan.expected)}</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ── Top risks ────────────────────────────────────────────────────── */}
        <section aria-label={t("executiveMobile.risks.title", "Top risks")}>
          <SectionTitle icon={<AlertTriangle />}>{t("executiveMobile.risks.title", "Top risks")}</SectionTitle>
          <Card>
            <CardContent className="p-3">
              {insightsQ.isError ? (
                /* AUD-01: NEVER show "no active risks" on a failed query. */
                <ErrorInline onRetry={() => void insightsQ.refetch()} />
              ) : insightsQ.isLoading ? (
                <div className="space-y-2">
                  {[0, 1].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : topRisks.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {t("executiveMobile.risks.empty", "No active risks flagged")}
                </div>
              ) : (
                <ul className="space-y-2">
                  {topRisks.map((r) => {
                    const tone = severityTone(r.severity);
                    return (
                      <li key={r.id} className="flex items-start gap-2.5 rounded-md border p-2.5">
                        <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${TONE_CLASS[tone]}`} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{r.title || t("executiveMobile.risks.untitled", "Risk")}</span>
                            {r.machineCode && (
                              <Badge variant="outline" className="h-4 shrink-0 py-0 text-[10px]">{r.machineCode}</Badge>
                            )}
                          </div>
                          {r.body && <p className="line-clamp-2 text-xs text-muted-foreground">{r.body}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ── (2) AI executive summary ─────────────────────────────────────── */}
        <section aria-label={t("executiveMobile.ai.title", "AI summary")}>
          <SectionTitle
            icon={<Sparkles />}
            right={
              <Button
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={() => setLocation("/management-insight")}
              >
                {t("executiveMobile.ai.viewFull", "Full report")}
                <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
              </Button>
            }
          >
            {t("executiveMobile.ai.title", "AI summary")}
          </SectionTitle>
          <Card>
            <CardContent className="space-y-3 p-4">
              {summaryQ.isError ? (
                /* AUD-01: a failed fetch is NOT "no report yet". */
                <ErrorInline onRetry={() => void summaryQ.refetch()} />
              ) : summaryQ.isLoading ? (
                <>
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </>
              ) : !summary ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
                  <Sparkles className="h-6 w-6" aria-hidden />
                  <div>{t("executiveMobile.ai.empty", "No executive report yet.")}</div>
                  <div className="text-xs">
                    {t("executiveMobile.ai.emptyHint", "Scheduled summaries appear here; generate one in Management Insight.")}
                  </div>
                </div>
              ) : (
                <>
                  {/* Meta row: period + generated time + honest source badge. */}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {report?.period && (
                      <Badge variant="outline" className="h-5 py-0 text-[10px] capitalize">{report.period}</Badge>
                    )}
                    {summary.generatedAt && (
                      <span>{t("executiveMobile.ai.generatedAt", "As of {{time}}", { time: new Date(summary.generatedAt).toLocaleString() })}</span>
                    )}
                    {summaryOffline && (
                      <Badge variant="secondary" className="h-5 gap-1 py-0 text-[10px]">
                        <Info className="h-3 w-3" aria-hidden />
                        {t("executiveMobile.ai.offlineMode", "Rule-based")}
                      </Badge>
                    )}
                  </div>

                  {/* Honest degradation note (FE-W0.3 guardrail fell back to rules,
                      or we detected a degenerate narrative client-side). */}
                  {summaryDegraded && (
                    <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                      {t("executiveMobile.ai.degraded", "AI narrative unavailable — showing a rule-based summary from real KPIs.")}
                    </div>
                  )}

                  {cleanHeadline && (
                    <div className="rounded-md bg-muted/40 p-3 text-sm font-medium leading-relaxed">
                      {cleanHeadline}
                    </div>
                  )}

                  {cleanHighlights.length > 0 && (
                    <div>
                      <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
                        <TrendingUp className="h-4 w-4 text-success" aria-hidden />
                        {t("executiveMobile.ai.highlights", "Highlights")}
                      </div>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        {cleanHighlights.map((h, i) => <li key={i}>{h}</li>)}
                      </ul>
                    </div>
                  )}

                  {cleanRisks.length > 0 && (
                    <div>
                      <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
                        <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
                        {t("executiveMobile.ai.risks", "Risks")}
                      </div>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        {cleanRisks.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ── (3) Pending approvals ────────────────────────────────────────── */}
        <section aria-label={t("executiveMobile.approvals.title", "Pending approvals")}>
          <SectionTitle icon={<ClipboardCheck />}>{t("executiveMobile.approvals.title", "Pending approvals")}</SectionTitle>
          <Card>
            <CardContent className="space-y-3 p-4">
              {/* AUD-01: on any failed feed, show the error INSTEAD of a partial
                  count — the deep-link below stays available either way. */}
              {approvalsError ? (
                <ErrorInline onRetry={retryApprovals} />
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    {approvalsLoading ? (
                      <Skeleton className="h-12 w-16" />
                    ) : (
                      <div className={`text-5xl font-bold tabular-nums ${approvalsTotal > 0 ? "text-primary" : "text-muted-foreground"}`}>
                        {approvalsDisplay}
                      </div>
                    )}
                    <div className="text-sm text-muted-foreground">
                      {t("executiveMobile.approvals.awaiting", "items awaiting a decision")}
                    </div>
                  </div>

                  {!approvalsLoading && approvalItems.length > 0 && (
                    <ul className="space-y-1.5">
                      {approvalItems.map((it) => (
                        <li key={it.key} className="flex items-center gap-2 rounded-md border px-3 py-2">
                          <Badge variant="outline" className="h-5 shrink-0 py-0 text-[10px]">{it.kind}</Badge>
                          <span className="min-w-0 flex-1 truncate text-sm">{it.label}</span>
                          {it.title && <span className="shrink-0 text-xs text-muted-foreground">{it.title}</span>}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Honest empty state: only on real success, and never while the
                      truncated feed may still hide proposals beyond the cap. */}
                  {!approvalsLoading && approvalsTotal === 0 && !aiInboxTruncated && (
                    <div className="py-2 text-sm text-muted-foreground">
                      {t("executiveMobile.approvals.empty", "You're all caught up.")}
                    </div>
                  )}
                </>
              )}

              <Button
                variant="outline"
                className="h-11 w-full justify-between"
                onClick={() => setLocation("/approvals-inbox")}
              >
                {t("executiveMobile.approvals.open", "Open full inbox")}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            </CardContent>
          </Card>
        </section>

        {/* ── Quick links to the full-desktop surfaces ─────────────────────── */}
        <nav aria-label={t("executiveMobile.links.title", "More")} className="space-y-1.5">
          {[
            { href: "/corporate-dashboard", label: t("executiveMobile.links.corporate", "Corporate dashboard") },
            { href: "/management-insight", label: t("executiveMobile.links.insight", "Management insight") },
            { href: "/", label: t("executiveMobile.links.home", "Home") },
          ].map((l) => (
            <button
              key={l.href}
              type="button"
              onClick={() => setLocation(l.href)}
              className="flex h-11 w-full items-center justify-between rounded-md border px-3 text-sm hover:bg-accent"
            >
              <span>{l.label}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
            </button>
          ))}
        </nav>

        <p className="pt-1 text-center text-[11px] text-muted-foreground">
          <Lightbulb className="mr-1 inline h-3 w-3" aria-hidden />
          {t("executiveMobile.footerNote", "All figures come from live plant data — no estimates.")}
        </p>
      </main>
    </div>
  );
}
