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
 *  - Approvals (doc 67 W8): AI-inbox PROPOSAL items get an INLINE 1-tap
 *    Duyệt/Bỏ qua — Duyệt reuses the EXISTING `aiCopilot.confirmAction` HITL
 *    mutation (token == actionId from aiInbox.list; no step-up/2FA on that path —
 *    verified against server/services/aiCopilotActions.ts, same call
 *    ApprovalsInbox makes inline) behind a one-step AlertDialog; Bỏ qua reuses
 *    `aiInbox.dismiss`. Threshold + deploy approvals stay DEEP-LINK ONLY on
 *    purpose: both need SoD context (and deploy adds step-up 2FA) that lives in
 *    the full inbox. Every row deep-links to /approvals-inbox?focus=… which
 *    scrolls-and-highlights the item (W8 việc 2).
 *
 * This page does not mount its own <DashboardLayout>: it is a lean, installable
 * landing. NOTE (doc 67 W4): with the persistent app-shell flag ON (default since
 * doc 46 FE-W4.1) and /executive absent from CHROMELESS_SHELL_ROUTES, App.tsx DOES
 * wrap this route in the shared DashboardLayout shell — which owns the single
 * <main id="main-content"> landmark. Our content root is therefore a <div>, and
 * the page title is the route's <h1>. Global providers (tRPC, i18n, theme, auth)
 * live at the app root, so everything still works standalone if rendered bare.
 */
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PollFreshness } from "@/components/PollFreshness";
import { RelatedViews } from "@/components/RelatedViews";
import { EmptyState } from "@/components/EmptyState";
import { ContextDrawer } from "@/components/workspace/ContextDrawer";
import { fmtInt, fmtIntCompact, fmtPct } from "@/lib/format";
import {
  oeeTone,
  severityTone,
  TONE_TEXT_CLASS,
  yieldTone,
  type SemanticTone,
} from "@/components/patterns/isaStateBadges";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
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
  XCircle,
} from "lucide-react";

// ── Query options shared by the "live-ish" queries ─────────────────────────────
// Global QueryClient defaults are staleTime 30s + refetchOnWindowFocus:false
// (main.tsx). An exec briefing wants the opposite: refetch when they re-open the
// tab, plus a slow poll as a fallback. We opt in per-query.
// doc 67 W6 (việc 3) — mobile-network poll trim: only the KPI-briefing trio
// (getStats + getAllOEE + warRoom.briefing) keeps the 60s cadence. Everything
// else (insights/approvals feeds) moved to SLOW_OPTS below — 5' poll + focus
// refetch is plenty for lists an exec acts on via the full inbox anyway.
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

// doc 67 W6 (việc 3) — non-KPI feeds (aiInsight / thresholdApproval / aiInbox /
// listDeployApprovals): 5' poll; refetchOnWindowFocus:true stays explicit because
// the global QueryClient default is false (main.tsx). PollFreshness is untouched:
// freshestAt derives ONLY from the three 60s queries above, so its
// staleAfterMs=150_000 (2.5× the 60s cadence) remains correct.
const SLOW_OPTS = {
  refetchOnWindowFocus: true,
  refetchInterval: 300_000,
  staleTime: 60_000,
} as const;

// W7 GĐ2: fmtInt/fmtPct/fmtIntCompact local → lib/format (fmtIntCompact GĐ1 vốn
// chuẩn hóa từ chính bản này). Tone/TONE_CLASS local → SemanticTone/TONE_TEXT_CLASS
// shared (isaStateBadges). Lưu ý fmtPct shared giữ 1 chữ số ("95.0%") và chỉ bỏ
// phần thập phân từ 100 trở lên — quy ước đã chốt doc 67.

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
  tone = "muted",
  sub,
  loading,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  unit?: string;
  tone?: SemanticTone;
  sub?: React.ReactNode;
  loading?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <Card className={`min-w-0 ${className ?? ""}`}>
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
          /* doc 67 W4.3: NEVER truncate a KPI figure ("100.0…" is a wrong number).
             Instead the font clamps down on narrow screens (8vw ≈ 31px @390px) and
             the value itself is kept short by fmtPct/fmtIntCompact. */
          <div className={`flex min-w-0 items-baseline gap-1 text-[clamp(1.5rem,8vw,2.25rem)] font-bold leading-none tabular-nums ${TONE_TEXT_CLASS[tone]}`}>
            <span>{value ?? "—"}</span>
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

// W7 GĐ2: severityTone local → bản shared isaStateBadges. Khác biệt CÓ CHỦ ĐÍCH
// (đã duyệt GĐ1): mức không nhận diện / low / info → muted (trước đây → info xanh).

export default function ExecutiveMobile(): React.JSX.Element {
  const { t, i18n } = useTranslation();
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
  const insightsQ = trpc.aiInsight.list.useQuery({ status: "new", limit: 20 }, SLOW_OPTS);

  // ── (2) AI executive summary ─────────────────────────────────────────────────
  const summaryQ = trpc.executiveReport.latest.useQuery(undefined, SUMMARY_OPTS);

  // ── (3) Pending approvals (read-only counts + top items) ─────────────────────
  const thresholdQ = trpc.thresholdApproval.list.useQuery(
    { status: "requested", limit: 50 },
    { ...SLOW_OPTS, enabled: canViewThresholds },
  );
  const aiInboxQ = trpc.aiInbox.list.useQuery({ limit: 50 }, SLOW_OPTS);
  const deployQ = trpc.programming.listDeployApprovals.useQuery(undefined, {
    ...SLOW_OPTS,
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
  const aiInboxRaw = (aiInboxQ.data?.items ?? []) as Array<{
    id: string;
    title: string;
    type: string;
    // proposal-only HITL fields (server/services/aiActionInbox.ts InboxItem):
    // actionId == token == ai_pending_actions.id — the confirm token for
    // aiCopilot.confirmAction. `actions` lists the supported 1-tap verbs.
    actions?: string[];
    actionId?: string;
    token?: string;
    tool?: string;
  }>;
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

  // doc 67 W8 — each row now carries a contextual deep-link (?focus= is handled by
  // ApprovalsInbox: scroll + 3s highlight) and, for AI PROPOSALS only, the HITL
  // confirm token for the inline Duyệt/Bỏ qua. Threshold/deploy stay link-only
  // (SoD / step-up-2FA flows live in the full inbox — see header note).
  const approvalItems = useMemo(() => {
    const items: Array<{
      key: string;
      kind: string;
      label: string;
      title: string;
      href: string;
      proposal?: { actionId: string; token: string; tool?: string };
    }> = [];
    for (const r of thresholdRows.slice(0, 3)) {
      items.push({
        key: `th-${r.id}`,
        kind: t("executiveMobile.approvals.threshold", "Threshold"),
        label: r.pointCode?.trim() || `MP-${r.pointDefId}`,
        title: r.productCode?.trim() || "",
        href: `/approvals-inbox?tab=threshold&focus=th-${r.id}`,
      });
    }
    for (const it of aiInboxProposals.slice(0, 3)) {
      const actionId = it.actionId ?? it.id;
      const token = it.token ?? it.id;
      // Only offer inline approve when the server explicitly lists the verb AND
      // the confirm token is present (contract: aiCopilot.confirmAction).
      const canApprove = (it.actions ?? []).includes("approve") && !!actionId && !!token;
      items.push({
        key: `ai-${it.id}`,
        kind: t("executiveMobile.approvals.aiInbox", "AI inbox"),
        label: it.title,
        title: "",
        href: `/approvals-inbox?tab=ai&focus=proposal-${it.id}`,
        proposal: canApprove ? { actionId, token, tool: it.tool } : undefined,
      });
    }
    for (const r of deployRows.slice(0, 3)) {
      items.push({
        key: `dp-${r.deployment.id}`,
        kind: t("executiveMobile.approvals.deploy", "Deploy"),
        label: r.project?.code?.trim() || `#${r.deployment.projectId}`,
        title: "",
        href: `/approvals-inbox?tab=deploy&focus=dp-${r.deployment.id}`,
      });
    }
    return items.slice(0, 5);
  }, [thresholdRows, aiInboxProposals, deployRows, t]);

  // ── doc 67 W8 (việc 1) — 1-tap Duyệt/Bỏ qua on AI proposals ─────────────────
  // Duyệt reuses the EXISTING HITL confirm (aiCopilot.confirmAction, token ==
  // actionId — same call ApprovalsInbox/AIActionInbox make; NO step-up on this
  // path) behind a one-step AlertDialog; Bỏ qua reuses aiInbox.dismiss (HITL
  // cancel). Both invalidate aiInbox.list (+count badge) and toast the REAL
  // server outcome — never an optimistic success.
  const utils = trpc.useUtils();
  const confirmM = trpc.aiCopilot.confirmAction.useMutation();
  const dismissM = trpc.aiInbox.dismiss.useMutation();
  const aiActionBusy = confirmM.isPending || dismissM.isPending;
  const [confirmTarget, setConfirmTarget] = useState<{
    actionId: string;
    token: string;
    tool?: string;
    label: string;
  } | null>(null);

  const invalidateAiInbox = useCallback(() => {
    void utils.aiInbox.list.invalidate();
    void utils.aiInbox.count.invalidate();
  }, [utils]);

  const approveConfirmed = useCallback(async () => {
    const target = confirmTarget;
    if (!target) return;
    setConfirmTarget(null);
    try {
      const res = await confirmM.mutateAsync({
        actionId: target.actionId,
        token: target.token,
        lang: (i18n.language as "vi" | "en" | "zh") ?? "vi",
      });
      if (res.ok) {
        toast.success(res.message ?? t("executiveMobile.approvals.approved", "Action approved"));
      } else {
        toast.error(res.message ?? t("executiveMobile.approvals.actionFailed", "Could not complete the action"));
      }
    } catch {
      toast.error(t("executiveMobile.approvals.actionFailed", "Could not complete the action"));
    } finally {
      invalidateAiInbox();
    }
  }, [confirmTarget, confirmM, i18n.language, t, invalidateAiInbox]);

  const dismissProposal = useCallback(
    async (id: string) => {
      try {
        const res = await dismissM.mutateAsync({ type: "proposal", id });
        if (res.ok) {
          toast.success(t("executiveMobile.approvals.dismissed", "Dismissed"));
        } else {
          toast.error(res.message ?? t("executiveMobile.approvals.actionFailed", "Could not complete the action"));
        }
      } catch {
        toast.error(t("executiveMobile.approvals.actionFailed", "Could not complete the action"));
      } finally {
        invalidateAiInbox();
      }
    },
    [dismissM, t, invalidateAiInbox],
  );

  // ── doc 68 §3.9 (P2) — right-side ContextDrawer for risk / approval detail ────
  // Clicking a risk or approval row opens the shared ContextDrawer (Sheet, right)
  // INSTEAD of hard-navigating to /approvals-inbox — the exec reads (and, where the
  // action is safe, acts) without losing the briefing behind it. Risks acknowledge
  // in place via the EXISTING aiInsight.setStatus (advisory, no SoD). AI proposals
  // keep the 1-tap Duyệt/Bỏ qua (reusing the same confirm/dismiss flow). Threshold +
  // deploy stay deep-link only (SoD / step-up-2FA live in the full inbox); each
  // drawer surfaces an "Open full inbox" CTA as the step-2.
  const [riskDrawer, setRiskDrawer] = useState<(typeof topRisks)[number] | null>(null);
  const [approvalDrawer, setApprovalDrawer] = useState<(typeof approvalItems)[number] | null>(null);
  const insightStatusM = trpc.aiInsight.setStatus.useMutation();
  const riskActionBusy = insightStatusM.isPending;
  const setRiskStatus = useCallback(
    async (id: number, status: "acknowledged" | "dismissed") => {
      try {
        await insightStatusM.mutateAsync({ id, status });
        toast.success(
          status === "acknowledged"
            ? t("executiveMobile.risks.acknowledged", "Risk acknowledged")
            : t("executiveMobile.risks.dismissedToast", "Risk dismissed"),
        );
      } catch {
        toast.error(t("executiveMobile.approvals.actionFailed", "Could not complete the action"));
      } finally {
        void utils.aiInsight.list.invalidate();
        setRiskDrawer(null);
      }
    },
    [insightStatusM, t, utils],
  );

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
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3 lg:max-w-6xl">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Gauge className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            {/* doc 67 W5 (việc 2) — 1 key/trang: h1 = breadcrumb = menu = nav.executiveMobile. */}
            <h1 className="truncate text-base font-semibold leading-tight">
              {t("nav.executiveMobile", "Executive Briefing")}
            </h1>
            {/* AUD-01: the ONLY freshness indicator on this page — driven by
                react-query dataUpdatedAt (poll surface, no socket), so it goes
                amber-stale by itself when polling silently stops delivering. */}
            {/* doc 67 W4: aria-live so SR users hear the stamp move on refresh. */}
            <div aria-live="polite">
              <PollFreshness
                updatedAt={freshestAt}
                isFetching={anyFetching}
                staleAfterMs={150_000}
                className="mt-0.5"
              />
            </div>
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

      {/* doc 67 W4.2: the persistent app-shell (APP_SHELL_PERSISTENT default ON, and
          /executive is NOT a chromeless route) wraps this page in DashboardLayout,
          which already renders <main id="main-content"> — a second nested <main>
          here is a landmark violation, so the content root is a <div>.
          W4.5 (decision #3): ≥lg the four sections form 2 columns (left: KPI + Top
          risks · right: AI summary + Pending approvals) via explicit col/row starts;
          mobile keeps the original single-column DOM order. flex+gap-6 replaces
          space-y-6 so a null OfflineBanner leaves no phantom gap. */}
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-24 pt-4 lg:max-w-6xl">
        <OfflineBanner />

        {/* doc 67 W5 (việc 6) — rail 2-chiều từ map tập trung (RelatedViews.tsx):
            trang đã rút khỏi menu, đường về Tổng quan nhà máy + Tổng quan tập đoàn. */}
        <RelatedViews pageId="executive" />

        {/* ── LEAD (doc 68 §3.9 P1) — the AI's single #1 executive sentence lifted
            OUT of the AI card to a full-width hero band above the grid / first in
            the mobile DOM. The exec anchors on it in 5-10s; the full AI narrative
            (highlights/risks) still renders in the card below. Only on a clean,
            non-degenerate headline (looksDegenerate already filtered cleanHeadline). */}
        {cleanHeadline && (
          <section
            aria-label={t("executiveMobile.ai.lead", "Executive headline")}
            className="min-w-0"
          >
            <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4">
              <span
                aria-hidden
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
              >
                <Sparkles className="h-5 w-5" />
              </span>
              <p className="min-w-0 text-base font-semibold leading-relaxed sm:text-lg">
                {cleanHeadline}
              </p>
            </div>
          </section>
        )}

        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start">

        {/* ── (1) KPI briefing ─────────────────────────────────────────────── */}
        <section
          aria-label={t("executiveMobile.kpi.title", "KPI briefing")}
          className="min-w-0 lg:col-start-1 lg:row-start-1"
        >
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
              /* W7 GĐ2: ngưỡng local 70/50 → oeeTone shared 80/60 — NGƯỠNG ĐỔI LÀ
                 CHỦ ĐÍCH đã duyệt (OEE 72% từ xanh thành vàng). null → muted. */
              tone={oeeTone(avgOee)}
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
              label={t("executiveMobile.kpi.yield", "Yield")}
              value={yieldRate != null ? fmtPct(yieldRate) : null}
              /* W7 GĐ2: 95/85 local → yieldTone shared 95/90 (ngưỡng đổi đã duyệt). */
              tone={yieldTone(yieldRate)}
              loading={statsQ.isLoading}
              /* doc 68 §3.9 (P1): "(today)" moved off the truncating headline label
                 down to the sub line so the big label no longer clips on mobile. */
              sub={t("executiveMobile.kpi.finalYield", "Final yield · today")}
            />
            <KpiTile
              icon={<Target />}
              label={t("executiveMobile.kpi.fpy", "FPY")}
              value={fpy != null ? fmtPct(fpy) : null}
              /* W7 GĐ2: 95/85 local → yieldTone shared 95/90 (ngưỡng đổi đã duyệt). */
              tone={yieldTone(fpy)}
              loading={statsQ.isLoading}
              sub={t("executiveMobile.kpi.firstPass", "First-pass yield · today")}
            />
            <KpiTile
              icon={<Package />}
              label={t("executiveMobile.kpi.output", "Output")}
              value={outputToday != null ? fmtIntCompact(outputToday, i18n.language) : null}
              tone="info"
              loading={statsQ.isLoading}
              sub={t("executiveMobile.kpi.inspected", "Units inspected · today")}
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
        <section
          aria-label={t("executiveMobile.risks.title", "Top risks")}
          className="min-w-0 lg:col-start-1 lg:row-start-2"
        >
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
                /* W7 GĐ2: empty tự chế → EmptyState allClear (GĐ1) — "không có rủi
                   ro" là TIN TỐT. Điều kiện chỉ-khi-success của W2 giữ nguyên
                   (nhánh isError đã render ErrorInline ở trên). */
                <EmptyState
                  allClear
                  compact
                  title={t("executiveMobile.risks.empty", "No active risks flagged")}
                />
              ) : (
                <ul className="space-y-2">
                  {topRisks.map((r) => {
                    const tone = severityTone(r.severity);
                    return (
                      /* doc 67 W8 (việc 2) — tappable row: deep-link to the full
                         inbox with ?focus=insight-{id} (scroll + highlight there).
                         NOTE: a per-machine target was considered but risks only
                         carry machineCode (a code string) while the machine
                         cockpit route is /machine/:id (numeric id; /machines/{id}
                         does not exist) — no client-side code→id resolution, so
                         the inbox is the honest contextual target. */
                      <li key={r.id}>
                        <button
                          type="button"
                          /* doc 68 §3.9 P2: open the right-side ContextDrawer (read +
                             ack in place) instead of leaving the briefing. */
                          onClick={() => setRiskDrawer(r)}
                          className="flex min-h-11 w-full items-start gap-2.5 rounded-md border p-2.5 text-left hover:bg-accent"
                        >
                          <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${TONE_TEXT_CLASS[tone]}`} aria-hidden />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">{r.title || t("executiveMobile.risks.untitled", "Risk")}</span>
                              {r.machineCode && (
                                <Badge variant="outline" className="h-4 shrink-0 py-0 text-[10px]">{r.machineCode}</Badge>
                              )}
                            </div>
                            {r.body && <p className="line-clamp-2 text-xs text-muted-foreground">{r.body}</p>}
                          </div>
                          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ── (2) Pending approvals ────────────────────────────────────────────
            doc 68 §3.9 P1/P3: decisions BEFORE the narrative. On desktop this sits
            at col2/row1 (level with the KPI briefing); on mobile it now precedes the
            AI summary in DOM order (act first, read the story after). */}
        <section
          aria-label={t("executiveMobile.approvals.title", "Pending approvals")}
          className="min-w-0 lg:col-start-2 lg:row-start-1"
        >
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
                        /* doc 67 W8 — row body = deep-link button (?focus= scroll +
                           highlight in the full inbox); PROPOSAL rows add the
                           inline Duyệt/Bỏ qua strip below (separate buttons — a
                           row-wide button would nest interactive elements). */
                        <li key={it.key} className="overflow-hidden rounded-md border">
                          <button
                            type="button"
                            /* doc 68 §3.9 P2: open the right-side ContextDrawer (keeps
                               the briefing behind it); its step-2 CTA deep-links. */
                            onClick={() => setApprovalDrawer(it)}
                            className="flex h-11 w-full min-w-0 items-center gap-2 px-3 text-left hover:bg-accent"
                            aria-label={t("executiveMobile.approvals.openItemAria", "Review: {{title}}", { title: it.label })}
                          >
                            <Badge variant="outline" className="h-5 shrink-0 py-0 text-[10px]">{it.kind}</Badge>
                            <span className="min-w-0 flex-1 truncate text-sm">{it.label}</span>
                            {it.title && <span className="shrink-0 text-xs text-muted-foreground">{it.title}</span>}
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                          </button>
                          {it.proposal && (
                            <div className="flex gap-2 border-t bg-muted/30 px-3 py-2">
                              <Button
                                className="h-11 flex-1"
                                disabled={aiActionBusy}
                                onClick={() =>
                                  setConfirmTarget({ ...it.proposal!, label: it.label })
                                }
                                aria-label={t("executiveMobile.approvals.approveAria", "Approve: {{title}}", { title: it.label })}
                              >
                                <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden />
                                {t("executiveMobile.approvals.approve", "Approve")}
                              </Button>
                              <Button
                                variant="outline"
                                className="h-11 flex-1"
                                disabled={aiActionBusy}
                                onClick={() => void dismissProposal(it.proposal!.actionId)}
                                aria-label={t("executiveMobile.approvals.dismissAria", "Dismiss: {{title}}", { title: it.label })}
                              >
                                <XCircle className="mr-1 h-4 w-4" aria-hidden />
                                {t("executiveMobile.approvals.dismiss", "Dismiss")}
                              </Button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Honest empty state: only on real success, and never while the
                      truncated feed may still hide proposals beyond the cap.
                      W7 GĐ2: tự chế → EmptyState allClear ("đã xử lý hết" = tin tốt). */}
                  {!approvalsLoading && approvalsTotal === 0 && !aiInboxTruncated && (
                    <EmptyState
                      allClear
                      compact
                      title={t("executiveMobile.approvals.empty", "You're all caught up.")}
                    />
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

          {/* doc 67 W8 — one-step confirm before executing an AI proposal: names
              the action (tool) + the object (server-built summary). Confirm calls
              the EXISTING HITL aiCopilot.confirmAction — nothing new executes. */}
          <AlertDialog
            open={confirmTarget != null}
            onOpenChange={(o) => {
              if (!o) setConfirmTarget(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("executiveMobile.approvals.confirmTitle", "Approve this AI action?")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("executiveMobile.approvals.confirmBody", "The proposed action below will be executed immediately.")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {confirmTarget && (
                <div className="space-y-2 rounded-md bg-muted/40 p-3">
                  {confirmTarget.tool && (
                    <Badge variant="outline" className="font-mono text-[10px]">{confirmTarget.tool}</Badge>
                  )}
                  <div className="text-sm font-medium leading-relaxed">{confirmTarget.label}</div>
                </div>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel className="h-11">{t("common.cancel", "Cancel")}</AlertDialogCancel>
                <AlertDialogAction className="h-11" onClick={() => void approveConfirmed()}>
                  <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden />
                  {t("executiveMobile.approvals.approve", "Approve")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>

        {/* ── (3) AI executive summary ─────────────────────────────────────────
            doc 68 §3.9 P1: the headline is lifted out to the LEAD band above; this
            card carries only the fuller narrative (highlights + risks). Desktop:
            col2/row2 (level with Top risks); mobile: after the approvals decisions. */}
        <section
          aria-label={t("executiveMobile.ai.title", "AI summary")}
          className="min-w-0 lg:col-start-2 lg:row-start-2"
        >
          <SectionTitle
            icon={<Sparkles />}
            right={
              <Button
                variant="ghost"
                size="sm"
                className="h-11"
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
                /* W7 GĐ2: empty tự chế → EmptyState compact. KHÔNG allClear — "chưa
                   có báo cáo" là thiếu dữ liệu, không phải tin tốt. Icon Sparkles giữ
                   ngữ nghĩa AI của bản cũ; điều kiện chỉ-khi-success W2 giữ nguyên. */
                <EmptyState
                  compact
                  icon={Sparkles}
                  title={t("executiveMobile.ai.empty", "No executive report yet.")}
                  description={t("executiveMobile.ai.emptyHint", "Scheduled summaries appear here; generate one in Management Insight.")}
                />
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

                  {/* doc 68 §3.9 P1: the headline is now the full-width LEAD band
                      above the grid — the card keeps highlights + risks only. */}
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
        </div>

        {/* ── doc 68 §3.9 P2 — Risk detail ContextDrawer (right, overlay) ───────
            Read the flagged risk WITHOUT leaving the briefing; acknowledge/dismiss
            in place via the EXISTING aiInsight.setStatus (advisory — no SoD). The
            step-2 CTA deep-links into the full inbox for the wider context. */}
        <ContextDrawer
          open={riskDrawer != null}
          onOpenChange={(o) => { if (!o) setRiskDrawer(null); }}
          title={riskDrawer?.title || t("executiveMobile.risks.untitled", "Risk")}
          description={riskDrawer?.machineCode ?? undefined}
        >
          {riskDrawer && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {riskDrawer.machineCode && (
                  <Badge variant="outline">{riskDrawer.machineCode}</Badge>
                )}
                {riskDrawer.severity && (
                  <Badge variant="secondary" className="capitalize">{riskDrawer.severity}</Badge>
                )}
              </div>
              {riskDrawer.body && (
                <p className="text-sm leading-relaxed text-muted-foreground">{riskDrawer.body}</p>
              )}
              <div className="flex gap-2">
                <Button
                  className="h-11 flex-1"
                  disabled={riskActionBusy}
                  onClick={() => void setRiskStatus(riskDrawer.id, "acknowledged")}
                >
                  <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden />
                  {t("executiveMobile.risks.acknowledge", "Acknowledge")}
                </Button>
                <Button
                  variant="outline"
                  className="h-11 flex-1"
                  disabled={riskActionBusy}
                  onClick={() => void setRiskStatus(riskDrawer.id, "dismissed")}
                >
                  <XCircle className="mr-1 h-4 w-4" aria-hidden />
                  {t("executiveMobile.risks.dismissAction", "Dismiss")}
                </Button>
              </div>
              <Button
                variant="outline"
                className="h-11 w-full justify-between"
                onClick={() => setLocation(`/approvals-inbox?focus=insight-${riskDrawer.id}`)}
              >
                {t("executiveMobile.approvals.open", "Open full inbox")}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          )}
        </ContextDrawer>

        {/* ── doc 68 §3.9 P2 — Approval detail ContextDrawer (right, overlay) ───
            AI proposals keep the 1-tap Duyệt/Bỏ qua here too (Duyệt routes through
            the SAME one-step confirm dialog). Threshold + deploy stay deep-link only
            — their SoD / step-up-2FA flow lives in the full inbox (the step-2 CTA). */}
        <ContextDrawer
          open={approvalDrawer != null}
          onOpenChange={(o) => { if (!o) setApprovalDrawer(null); }}
          title={approvalDrawer?.label || t("executiveMobile.approvals.title", "Pending approvals")}
          description={approvalDrawer?.kind}
        >
          {approvalDrawer && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{approvalDrawer.kind}</Badge>
                {approvalDrawer.title && (
                  <span className="text-sm text-muted-foreground">{approvalDrawer.title}</span>
                )}
              </div>
              {approvalDrawer.proposal ? (
                <>
                  {approvalDrawer.proposal.tool && (
                    <Badge variant="outline" className="font-mono text-[10px]">{approvalDrawer.proposal.tool}</Badge>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {t("executiveMobile.approvals.proposalHint", "Approve to run this AI action now, or dismiss it.")}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      className="h-11 flex-1"
                      disabled={aiActionBusy}
                      onClick={() => {
                        const p = approvalDrawer.proposal!;
                        const label = approvalDrawer.label;
                        setApprovalDrawer(null);
                        setConfirmTarget({ ...p, label });
                      }}
                    >
                      <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden />
                      {t("executiveMobile.approvals.approve", "Approve")}
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 flex-1"
                      disabled={aiActionBusy}
                      onClick={() => {
                        const actionId = approvalDrawer.proposal!.actionId;
                        setApprovalDrawer(null);
                        void dismissProposal(actionId);
                      }}
                    >
                      <XCircle className="mr-1 h-4 w-4" aria-hidden />
                      {t("executiveMobile.approvals.dismiss", "Dismiss")}
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("executiveMobile.approvals.deepLinkHint", "This approval needs segregation-of-duties context — complete it in the full inbox.")}
                </p>
              )}
              <Button
                variant="outline"
                className="h-11 w-full justify-between"
                onClick={() => setLocation(approvalDrawer.href)}
              >
                {t("executiveMobile.approvals.open", "Open full inbox")}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          )}
        </ContextDrawer>

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
      </div>
    </div>
  );
}
