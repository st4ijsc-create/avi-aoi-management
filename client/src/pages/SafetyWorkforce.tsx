/**
 * S1 (doc 16 §8 + §12 design system) — SAFETY & WORKFORCE surface.
 *
 * Read-mostly cockpit over the safetyRouter, organised into tabs:
 *   • "Safety cockpit" (S1-b/d) — live safety_events feed (feed + `safety:event`
 *       socket), near-miss PDCA trend (Recharts), audit-event + report-proximity
 *       advisory actions.
 *   • "Workforce board" (S1-a) — currentBoard (humans + robots per station) +
 *       assignments table with assign / reassign / confirm / close.
 *   • "Collaboration" (S1-a) — human↔robot handover sessions with a phase indicator
 *       + handshake state and start / signal / advance / abort actions.
 *
 * ⚠ CRITICAL HONESTY / SAFETY: NOTHING on this page is safety-rated. The safety feed
 *   is an ADVISORY monitoring/logging record — no SIL 2/3 stop, no sub-second
 *   guarantee. Physical safety relies on certified hardware, deferred to a hardware
 *   phase. A persistent banner states this. Mutations open NO device-control path.
 *
 * Flags (read from safety.status):
 *   • SAFETY_AUDIT_ENABLED → recordEvent / auditEvent / ingestProximity
 *   • WORKFORCE_ENABLED    → assignments + collaboration mutations
 * When a flag is OFF the page shows a calm preview banner and surfaces the CONFLICT
 * error gracefully (toast.info, not red) — mirrors FleetOrchestration.
 *
 * RBAC: read → machine_monitoring/canView; mutations → machine_control/canCreate.
 * i18n: uses the t("key", "English default") fallback pattern (no locale-file edits).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { getSharedSocket, releaseSharedSocket } from "@/lib/socketManager";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import {
  MetricCard, PageHeader, PageContainer,
  chartColor, chartTooltipStyle, chartTooltipLabelStyle, chartGridProps, chartAxisTick,
} from "@/components/patterns";
import { buildBreadcrumbs } from "@/lib/breadcrumbs";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip,
} from "recharts";
import {
  ShieldAlert, RefreshCw, Info, AlertTriangle, Activity, Users, Workflow,
  Bot, User, Clock, CheckCircle2, Lock, Radio, Send, UserPlus, RefreshCcw,
  Ban, ScanLine, ClipboardCheck, HandMetal, Handshake, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

// ── Typesafe shapes inferred from the safetyRouter output ─────────────────────
type RouterOutputs = inferRouterOutputs<AppRouter>;
type SafetyEvent = RouterOutputs["safety"]["feed"][number];
type TrendBucket = RouterOutputs["safety"]["nearMissTrend"][number];
type BoardStation = RouterOutputs["safety"]["currentBoard"][number];
type Assignment = RouterOutputs["safety"]["listAssignments"][number];
type Collaboration = RouterOutputs["safety"]["listCollaborations"][number];

// Wire shape of the live `safety:event` socket broadcast (server emitSafetyEvent).
type SafetyLiveEvent = {
  id: number;
  eventType: string;
  robotId?: number | null;
  lineId?: number | null;
  stationId?: number | null;
  detectedBy?: string | null;
  outcome: string;
  isNearMiss: boolean;
  createdAt: Date | string;
};

const EVENT_TYPES = ["estop", "collision", "intrusion", "force_limit", "speed_violation", "near_miss"] as const;
const COLLAB_PHASES = ["human_prep", "robot_work", "human_verify", "done"] as const;
const ASSIGN_STATUSES = ["planned", "active", "completed", "cancelled"] as const;

// ── Colour-by-status badges (mirror the FleetOrchestration discipline) ─────────
function eventTypeBadge(eventType: string, t: (k: string, f: string) => string) {
  const map: Record<string, { cls: string; label: string }> = {
    estop: { cls: "bg-red-600 text-white", label: t("safety.evt.estop", "E-stop") },
    collision: { cls: "bg-red-500 text-white", label: t("safety.evt.collision", "Collision") },
    intrusion: { cls: "bg-orange-500 text-white", label: t("safety.evt.intrusion", "Intrusion") },
    force_limit: { cls: "bg-amber-500 text-white", label: t("safety.evt.force_limit", "Force limit") },
    speed_violation: { cls: "bg-yellow-500 text-black", label: t("safety.evt.speed_violation", "Speed violation") },
    near_miss: { cls: "bg-violet-500 text-white", label: t("safety.evt.near_miss", "Near-miss") },
  };
  const e = map[eventType] ?? { cls: "", label: eventType };
  return e.cls ? <Badge className={e.cls}>{e.label}</Badge> : <Badge variant="outline">{eventType}</Badge>;
}

function outcomeBadge(outcome: string, t: (k: string, f: string) => string) {
  switch (outcome) {
    case "stopped":
      return <Badge className="bg-red-500 text-white">{t("safety.outcome.stopped", "Stopped")}</Badge>;
    case "reduced_speed":
      return <Badge className="bg-amber-500 text-white">{t("safety.outcome.reduced_speed", "Reduced speed")}</Badge>;
    case "manual_override":
      return <Badge className="bg-blue-500 text-white">{t("safety.outcome.manual_override", "Manual override")}</Badge>;
    case "logged_only":
    default:
      return <Badge variant="outline" className="text-muted-foreground">{t("safety.outcome.logged_only", "Logged only")}</Badge>;
  }
}

function detectedByBadge(detectedBy: string | null | undefined, t: (k: string, f: string) => string) {
  if (!detectedBy) return <span className="text-muted-foreground">—</span>;
  return <Badge variant="secondary" className="text-xs">{t(`safety.detectedBy.${detectedBy}`, detectedBy)}</Badge>;
}

function skillBadge(skillLevel: string | null | undefined, t: (k: string, f: string) => string) {
  if (!skillLevel) return null;
  const map: Record<string, string> = {
    trainee: "bg-slate-400 text-white",
    qualified: "bg-emerald-500 text-white",
    expert: "bg-blue-500 text-white",
    trainer: "bg-violet-500 text-white",
  };
  const cls = map[skillLevel] ?? "";
  return cls
    ? <Badge className={`${cls} text-xs`}>{t(`safety.skill.${skillLevel}`, skillLevel)}</Badge>
    : <Badge variant="outline" className="text-xs">{skillLevel}</Badge>;
}

function assignStatusBadge(status: string, t: (k: string, f: string) => string) {
  switch (status) {
    case "active":
      return <Badge className="bg-emerald-500 text-white">{t("safety.assign.active", "Active")}</Badge>;
    case "planned":
      return <Badge className="bg-amber-500 text-white">{t("safety.assign.planned", "Planned")}</Badge>;
    case "completed":
      return <Badge variant="outline" className="text-muted-foreground">{t("safety.assign.completed", "Completed")}</Badge>;
    case "cancelled":
    default:
      return <Badge variant="outline" className="text-muted-foreground">{t("safety.assign.cancelled", "Cancelled")}</Badge>;
  }
}

function handshakeBadge(state: string, t: (k: string, f: string) => string) {
  switch (state) {
    case "ack":
      return <Badge className="bg-blue-500 text-white">{t("safety.handshake.ack", "Acknowledged")}</Badge>;
    case "clear":
      return <Badge className="bg-emerald-500 text-white">{t("safety.handshake.clear", "Zone clear")}</Badge>;
    case "pending":
    default:
      return <Badge className="bg-amber-500 text-white">{t("safety.handshake.pending", "Pending")}</Badge>;
  }
}

function fmtDateTime(d?: string | Date | null): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString();
}

export default function SafetyWorkforce() {
  const { t } = useTranslation();
  // U3 (doc 26) — breadcrumb "Kỹ thuật › Section › Trang" + link về Hub.
  const [location] = useLocation();
  const crumbs = buildBreadcrumbs(location, t);
  const { hasPermission } = usePermissions();
  const canView = hasPermission("machine_monitoring", "canView");
  const canControl = hasPermission("machine_control", "canCreate");
  // U4 (doc 26 §2.4) — hiện-nhưng-khoá: lý do khi thiếu quyền điều khiển máy.
  const permReason = !canControl
    ? t("common.gate.needPerm", "Requires {{perm}} permission", { perm: "machine_control" })
    : undefined;

  const [tab, setTab] = useState("cockpit");
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("");
  const [assignStatusFilter, setAssignStatusFilter] = useState<string>("");
  const [auditTarget, setAuditTarget] = useState<SafetyEvent | null>(null);
  const [proximityOpen, setProximityOpen] = useState(false);
  // Live events received over the socket (newest first), kept separate from the feed.
  const [liveEvents, setLiveEvents] = useState<SafetyLiveEvent[]>([]);

  // Assignment dialog state
  const [assignOpen, setAssignOpen] = useState(false);
  const [reassignTarget, setReassignTarget] = useState<Assignment | null>(null);
  const [closeTarget, setCloseTarget] = useState<Assignment | null>(null);

  // Collaboration dialog state
  const [startCollabOpen, setStartCollabOpen] = useState(false);
  const [abortTarget, setAbortTarget] = useState<Collaboration | null>(null);

  const utils = trpc.useUtils();

  // ── Reads ──────────────────────────────────────────────────────────────────
  const statusQ = trpc.safety.status.useQuery(undefined, { enabled: canView });
  const feedQ = trpc.safety.feed.useQuery(
    { eventType: (eventTypeFilter || undefined) as (typeof EVENT_TYPES)[number] | undefined, limit: 200 },
    { enabled: canView },
  );
  const trendQ = trpc.safety.nearMissTrend.useQuery({ sinceDays: 30 }, { enabled: canView });
  const boardQ = trpc.safety.currentBoard.useQuery(undefined, { enabled: canView });
  const assignmentsQ = trpc.safety.listAssignments.useQuery(
    { status: (assignStatusFilter || undefined) as (typeof ASSIGN_STATUSES)[number] | undefined, limit: 200 },
    { enabled: canView },
  );
  const collabsQ = trpc.safety.listCollaborations.useQuery({ limit: 100 }, { enabled: canView });

  const feed = (feedQ.data ?? []) as SafetyEvent[];
  const trend = (trendQ.data ?? []) as TrendBucket[];
  const board = (boardQ.data ?? []) as BoardStation[];
  const assignments = (assignmentsQ.data ?? []) as Assignment[];
  const collabs = (collabsQ.data ?? []) as Collaboration[];

  // Flag state — honest preview banners. The router only exposes two flags here.
  const safetyAuditEnabled = statusQ.data?.safetyAudit ?? true;
  const workforceEnabled = statusQ.data?.workforce ?? true;

  const refetchAll = () => {
    void utils.safety.status.invalidate();
    void utils.safety.feed.invalidate();
    void utils.safety.nearMissTrend.invalidate();
    void utils.safety.currentBoard.invalidate();
    void utils.safety.listAssignments.invalidate();
    void utils.safety.listCollaborations.invalidate();
  };

  // ── LIVE socket: listen to `safety:event` advisory broadcasts ────────────────
  useEffect(() => {
    if (!canView) return;
    const socket = getSharedSocket();
    const join = () => socket.emit("subscribe", {});
    const onSafety = (event: SafetyLiveEvent) => {
      setLiveEvents((prev) => [event, ...prev].slice(0, 50));
      // Pull the canonical row into the feed/KPIs too.
      void utils.safety.feed.invalidate();
      void utils.safety.nearMissTrend.invalidate();
    };
    socket.on("connect", join);
    socket.on("safety:event", onSafety);
    if (socket.connected) join();
    return () => {
      socket.off("connect", join);
      socket.off("safety:event", onSafety);
      releaseSharedSocket();
    };
  }, [canView, utils]);

  // ── Mutation error handler — flag-off CONFLICT → calm info (not red) ─────────
  const onMutationError = (e: { data?: { code?: string } | null; message: string }) => {
    if (e.data?.code === "CONFLICT" && /disabled/i.test(e.message)) {
      if (/workforce/i.test(e.message)) {
        toast.info(t("workforce.flagOffToast", "Workforce is disabled (preview). Set WORKFORCE_ENABLED=true to act."));
        void utils.safety.status.invalidate();
      } else {
        toast.info(t("safety.flagOffToast", "Safety audit is disabled (preview). Set SAFETY_AUDIT_ENABLED=true to act."));
        void utils.safety.status.invalidate();
      }
    } else if (e.data?.code === "CONFLICT") {
      // Non-flag CONFLICT (e.g. double-booking) — still calm, but informative.
      toast.info(e.message);
    } else {
      toast.error(e.message);
    }
  };

  // ── Mutations ────────────────────────────────────────────────────────────────
  const auditM = trpc.safety.auditEvent.useMutation({
    onSuccess: () => { toast.success(t("safety.audited", "Event audited")); setAuditTarget(null); refetchAll(); },
    onError: onMutationError,
  });
  const ingestM = trpc.safety.ingestProximity.useMutation({
    onSuccess: (r) => {
      if (r && "triggered" in r && r.triggered) {
        toast.success(t("safety.proximityTriggered", "Near-miss recorded (advisory) — yellow Andon raised, no device command issued"));
      } else {
        toast.info(t("safety.proximityNoop", "Above margin / low confidence — no near-miss recorded (advisory)"));
      }
      setProximityOpen(false);
      refetchAll();
    },
    onError: onMutationError,
  });
  const assignM = trpc.safety.assignOperator.useMutation({
    onSuccess: () => { toast.success(t("workforce.assigned", "Operator assigned")); setAssignOpen(false); refetchAll(); },
    onError: onMutationError,
  });
  const reassignM = trpc.safety.reassignOperator.useMutation({
    onSuccess: () => { toast.success(t("workforce.reassigned", "Assignment updated")); setReassignTarget(null); refetchAll(); },
    onError: onMutationError,
  });
  const confirmM = trpc.safety.confirmAssignment.useMutation({
    onSuccess: () => { toast.success(t("workforce.confirmed", "Assignment confirmed")); refetchAll(); },
    onError: onMutationError,
  });
  const closeM = trpc.safety.closeAssignment.useMutation({
    onSuccess: () => { toast.success(t("workforce.closed", "Assignment closed")); setCloseTarget(null); refetchAll(); },
    onError: onMutationError,
  });
  const startCollabM = trpc.safety.startCollaboration.useMutation({
    onSuccess: () => { toast.success(t("workforce.collabStarted", "Collaboration started")); setStartCollabOpen(false); refetchAll(); },
    onError: onMutationError,
  });
  const signalM = trpc.safety.signalHandshake.useMutation({
    onSuccess: () => { toast.success(t("workforce.handshakeSignalled", "Handshake signalled")); refetchAll(); },
    onError: onMutationError,
  });
  const advanceM = trpc.safety.advancePhase.useMutation({
    onSuccess: () => { toast.success(t("workforce.phaseAdvanced", "Phase advanced")); refetchAll(); },
    onError: onMutationError,
  });
  const abortM = trpc.safety.abortCollaboration.useMutation({
    onSuccess: () => { toast.success(t("workforce.collabAborted", "Collaboration aborted")); setAbortTarget(null); refetchAll(); },
    onError: onMutationError,
  });

  // ── Derived KPIs ─────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const openSafetyEvents = feed.filter((e) => e.auditedAt == null).length;
    const todayKey = new Date().toISOString().slice(0, 10);
    const nearMissesToday = trend.find((b) => b.day === todayKey)?.count ?? 0;
    const activeAssignments = assignments.filter((a) => a.status === "active").length;
    const activeCollaborations = collabs.filter((c) => c.phase !== "done" && c.endedAt == null).length;
    return { openSafetyEvents, nearMissesToday, activeAssignments, activeCollaborations };
  }, [feed, trend, assignments, collabs]);

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
              {t("safety.noPermission", "You do not have permission to view safety & workforce.")}
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const feedLoading = feedQ.isLoading;

  return (
    <DashboardLayout>
      <PageContainer className="flex flex-col gap-4 space-y-0">
        {/* ── PageHeader (DS F1b shared pattern) ─────────────────────────────── */}
        <PageHeader
          breadcrumbs={crumbs}
          icon={<ShieldAlert className="h-6 w-6" />}
          title={t("safety.title", "Safety & Workforce")}
          badge={!canControl ? <ViewOnlyBadge module="machine_control" /> : undefined}
          description={t("safety.subtitle", "Advisory safety monitoring, mixed-workforce assignments and human↔robot handover coordination.")}
          actions={
            <Button size="icon" variant="ghost" onClick={refetchAll} title={t("common.refresh", "Refresh")}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          }
        />

        {/* U7 (doc 26 §2.1) — "Khi nào dùng": trang LÀ GÌ / DÙNG KHI NÀO cho KTV mới. */}
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span>{t("safety.whenToUse", "When to use — monitor safety-relevant events and coordinate mixed human↔robot workforce assignments. Advisory only — not a safety-rated controller.")}</span>
        </div>

        {/* ── PERSISTENT advisory banner (always visible — critical honesty) ──── */}
        <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <div className="font-semibold text-amber-700 dark:text-amber-400">
              {t("safety.advisoryTitle", "Advisory monitoring only — not a safety-rated system")}
            </div>
            <div className="mt-0.5 text-muted-foreground">
              {t(
                "safety.advisoryBanner",
                "This surface logs and coordinates safety-relevant observations. It is NOT a SIL 2/3 safety controller and provides NO sub-second stop guarantee. Physical safety relies on certified hardware (Safety PLC / interlocks), deferred to a hardware phase. No action here issues a direct device command.",
              )}
            </div>
          </div>
        </div>

        {/* ── Flag-off preview banners (calm, honest) ────────────────────────── */}
        {!safetyAuditEnabled && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              {t(
                "safety.auditFlagOffBanner",
                "Preview mode: safety audit is disabled (SAFETY_AUDIT_ENABLED is off). Reads work; recording, auditing and proximity ingest are blocked until the flag is enabled.",
              )}
            </span>
          </div>
        )}
        {!workforceEnabled && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              {t(
                "workforce.flagOffBanner",
                "Preview mode: workforce is disabled (WORKFORCE_ENABLED is off). Reads work; assignment and collaboration actions are blocked until the flag is enabled.",
              )}
            </span>
          </div>
        )}

        {/* ── KPI strip ──────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard icon={<AlertTriangle className="h-4 w-4" />} label={t("safety.kpi.openEvents", "Open safety events (unaudited)")} value={kpis.openSafetyEvents} tone={kpis.openSafetyEvents > 0 ? "warning" : "default"} />
          <MetricCard icon={<ScanLine className="h-4 w-4" />} label={t("safety.kpi.nearMissesToday", "Near-misses today")} value={kpis.nearMissesToday} tone={kpis.nearMissesToday > 0 ? "warning" : "good"} />
          <MetricCard icon={<Users className="h-4 w-4" />} label={t("safety.kpi.activeAssignments", "Active assignments")} value={kpis.activeAssignments} tone={kpis.activeAssignments > 0 ? "good" : "default"} />
          <MetricCard icon={<Handshake className="h-4 w-4" />} label={t("safety.kpi.activeCollabs", "Active collaborations")} value={kpis.activeCollaborations} tone={kpis.activeCollaborations > 0 ? "good" : "default"} />
        </div>

        {/* ── Tabbed surface ─────────────────────────────────────────────────── */}
        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="cockpit"><Activity className="mr-1 h-4 w-4" />{t("safety.tab.cockpit", "Safety cockpit")}</TabsTrigger>
            <TabsTrigger value="workforce"><Users className="mr-1 h-4 w-4" />{t("safety.tab.workforce", "Workforce board")}</TabsTrigger>
            <TabsTrigger value="collaboration"><Workflow className="mr-1 h-4 w-4" />{t("safety.tab.collaboration", "Collaboration")}</TabsTrigger>
          </TabsList>

          {/* ════════════════ TAB: Safety cockpit (S1-b/d) ════════════════ */}
          <TabsContent value="cockpit" className="flex flex-col gap-4">
            {/* Near-miss PDCA trend */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ScanLine className="h-4 w-4" />
                  {t("safety.trendTitle", "Near-miss trend (PDCA, last 30 days)")}
                </CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                {trend.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trend}>
                      <CartesianGrid {...chartGridProps} className="opacity-30" />
                      <XAxis dataKey="day" tick={chartAxisTick} />
                      <YAxis width={36} allowDecimals={false} tick={chartAxisTick} />
                      <Tooltip contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} />
                      <Area type="monotone" dataKey="count" name={t("safety.nearMissCount", "Near-misses")} stroke={chartColor(0)} fill={chartColor(0)} fillOpacity={0.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    {t("safety.trendEmpty", "No near-misses recorded in the window.")}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Live ticker + report-proximity action */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Radio className="h-4 w-4" />
                  {t("safety.liveTitle", "Live advisory ticker")}
                  {liveEvents.length > 0 && (
                    <Badge variant="secondary" className="ml-1 text-xs">{liveEvents.length}</Badge>
                  )}
                </CardTitle>
                <Button size="sm" variant="outline" className="h-8" disabled={!canControl} title={permReason} onClick={() => setProximityOpen(true)}>
                  <ScanLine className="mr-1 h-4 w-4" />{t("safety.reportProximity", "Report proximity (advisory test)")}
                </Button>
              </CardHeader>
              <CardContent>
                {liveEvents.length === 0 ? (
                  <p className="py-2 text-xs text-muted-foreground">
                    {t("safety.liveEmpty", "Waiting for live safety:event broadcasts… (advisory only)")}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {liveEvents.slice(0, 12).map((e, i) => (
                      <div key={`${e.id}-${i}`} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs">
                        {eventTypeBadge(e.eventType, t)}
                        <span className="text-muted-foreground">#{e.id}</span>
                        <span className="text-muted-foreground">{fmtDateTime(e.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Safety events feed */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4" />
                  {t("safety.feedTitle", "Safety event feed")}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">{t("safety.filterType", "Type")}</Label>
                  <Select
                    value={eventTypeFilter || "all"}
                    onValueChange={(v) => setEventTypeFilter(v === "all" ? "" : v)}
                  >
                    <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("safety.all", "All")}</SelectItem>
                      {EVENT_TYPES.map((s) => (
                        <SelectItem key={s} value={s}>{t(`safety.evt.${s}`, s)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("safety.col.id", "ID")}</TableHead>
                      <TableHead>{t("safety.col.type", "Type")}</TableHead>
                      <TableHead>{t("safety.col.detectedBy", "Detected by")}</TableHead>
                      <TableHead>{t("safety.col.outcome", "Outcome")}</TableHead>
                      <TableHead>{t("safety.col.robotStation", "Robot / Station")}</TableHead>
                      <TableHead>{t("safety.col.response", "Response")}</TableHead>
                      <TableHead>{t("safety.col.when", "When")}</TableHead>
                      <TableHead>{t("safety.col.audit", "Audit")}</TableHead>
                      <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {feedLoading && (
                      <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">{t("safety.loading", "Loading…")}</TableCell></TableRow>
                    )}
                    {!feedLoading && feed.length === 0 && (
                      <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">{t("safety.feedEmpty", "No safety events recorded. This feed is advisory monitoring only.")}</TableCell></TableRow>
                    )}
                    {feed.map((e) => (
                      <TableRow key={e.id} className={e.isNearMiss ? "bg-violet-500/5" : undefined}>
                        <TableCell className="font-mono text-xs">#{e.id}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {eventTypeBadge(e.eventType, t)}
                            {e.isNearMiss && <Badge variant="outline" className="text-[10px]">{t("safety.nearMissTag", "near-miss")}</Badge>}
                          </div>
                        </TableCell>
                        <TableCell>{detectedByBadge(e.detectedBy, t)}</TableCell>
                        <TableCell>{outcomeBadge(e.outcome, t)}</TableCell>
                        <TableCell className="text-xs">
                          <span className="inline-flex items-center gap-2">
                            {e.robotId != null ? <span className="inline-flex items-center gap-1"><Bot className="h-3 w-3" />#{e.robotId}</span> : <span className="text-muted-foreground">—</span>}
                            {e.stationId != null && <span className="text-muted-foreground">@{e.stationId}</span>}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs tabular-nums">{e.responseTimeMs != null ? `${e.responseTimeMs}ms` : "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{fmtDateTime(e.createdAt)}</TableCell>
                        <TableCell className="text-xs">
                          {e.auditedAt != null
                            ? <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />{t("safety.audited", "Audited")}</span>
                            : <span className="text-muted-foreground">{t("safety.unaudited", "Pending")}</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          {canControl && e.auditedAt == null ? (
                            <Button size="sm" variant="ghost" className="h-7" disabled={auditM.isPending} onClick={() => setAuditTarget(e)}>
                              <ClipboardCheck className="mr-1 h-3.5 w-3.5" />{t("safety.audit", "Audit")}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ════════════════ TAB: Workforce board (S1-a) ════════════════ */}
          <TabsContent value="workforce" className="flex flex-col gap-4">
            {/* Current board — humans + robots per station */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4" />
                  {t("workforce.boardTitle", "Current board — who & which robot is at each station now")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {boardQ.isLoading && <p className="py-6 text-center text-sm text-muted-foreground">{t("safety.loading", "Loading…")}</p>}
                {!boardQ.isLoading && board.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {t("workforce.boardEmpty", "No active assignments or enabled robots to show on the board.")}
                  </p>
                )}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {board.map((st, idx) => (
                    <Card key={`${st.stationId ?? "_"}-${st.lineId ?? "_"}-${idx}`} className="border-border/60">
                      <CardContent className="space-y-2 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">
                            {st.stationId != null ? t("workforce.station", "Station") + ` ${st.stationId}` : t("workforce.unassignedStation", "Unassigned")}
                          </div>
                          {st.lineId != null && <Badge variant="outline" className="text-xs">{t("workforce.line", "Line")} {st.lineId}</Badge>}
                        </div>
                        {/* Humans */}
                        <div className="space-y-1">
                          {st.humans.length === 0 && <div className="text-xs text-muted-foreground">{t("workforce.noHumans", "No humans")}</div>}
                          {st.humans.map((h) => (
                            <div key={`h-${h.assignmentId}`} className="flex items-center justify-between gap-2 text-xs">
                              <span className="inline-flex items-center gap-1"><User className="h-3 w-3 text-blue-500" />{t("workforce.operator", "Operator")} #{h.operatorId}</span>
                              {skillBadge(h.skillLevel, t)}
                            </div>
                          ))}
                        </div>
                        {/* Robots */}
                        <div className="space-y-1 border-t border-border/60 pt-1">
                          {st.robots.length === 0 && <div className="text-xs text-muted-foreground">{t("workforce.noRobots", "No robots")}</div>}
                          {st.robots.map((r) => (
                            <div key={`r-${r.robotId}`} className="flex items-center justify-between gap-2 text-xs">
                              <span className="inline-flex items-center gap-1"><Bot className="h-3 w-3 text-violet-500" />{r.code}</span>
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <span>{r.status}</span>
                                <Badge variant="secondary" className="text-[10px]">{r.openTaskCount} {t("workforce.openTasks", "tasks")}</Badge>
                              </span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Assignments table */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardCheck className="h-4 w-4" />
                  {t("workforce.assignmentsTitle", "Operator assignments")}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Select
                    value={assignStatusFilter || "all"}
                    onValueChange={(v) => setAssignStatusFilter(v === "all" ? "" : v)}
                  >
                    <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("safety.all", "All")}</SelectItem>
                      {ASSIGN_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{t(`safety.assign.${s}`, s)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" className="h-8" disabled={!canControl} title={permReason} onClick={() => setAssignOpen(true)}>
                    <UserPlus className="mr-1 h-4 w-4" />{t("workforce.assign", "Assign")}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("workforce.col.operator", "Operator")}</TableHead>
                      <TableHead>{t("workforce.col.lineStation", "Line / Station")}</TableHead>
                      <TableHead>{t("workforce.col.skill", "Skill")}</TableHead>
                      <TableHead>{t("workforce.col.status", "Status")}</TableHead>
                      <TableHead>{t("workforce.col.window", "Window")}</TableHead>
                      <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignmentsQ.isLoading && (
                      <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("safety.loading", "Loading…")}</TableCell></TableRow>
                    )}
                    {!assignmentsQ.isLoading && assignments.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("workforce.assignmentsEmpty", "No operator assignments yet.")}</TableCell></TableRow>
                    )}
                    {assignments.map((a) => {
                      const terminal = a.status === "completed" || a.status === "cancelled";
                      return (
                        <TableRow key={a.id}>
                          <TableCell className="text-xs"><span className="inline-flex items-center gap-1"><User className="h-3 w-3" />#{a.operatorId}</span></TableCell>
                          <TableCell className="text-xs">
                            {a.lineId != null ? `L${a.lineId}` : "—"}{" / "}{a.stationId != null ? `S${a.stationId}` : "—"}
                          </TableCell>
                          <TableCell>{skillBadge(a.skillLevel, t) ?? <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                          <TableCell>{assignStatusBadge(a.status, t)}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{fmtDateTime(a.assignedStart)} → {fmtDateTime(a.assignedEnd)}</TableCell>
                          <TableCell className="text-right">
                            {canControl ? (
                              <div className="flex justify-end gap-1">
                                {a.status === "planned" && (
                                  <Button size="sm" variant="ghost" className="h-7" disabled={confirmM.isPending} onClick={() => confirmM.mutate({ assignmentId: a.id })}>
                                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />{t("workforce.confirm", "Confirm")}
                                  </Button>
                                )}
                                <Button size="sm" variant="ghost" className="h-7" disabled={terminal} onClick={() => setReassignTarget(a)}>
                                  <RefreshCcw className="mr-1 h-3.5 w-3.5" />{t("workforce.reassign", "Reassign")}
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7" disabled={terminal} onClick={() => setCloseTarget(a)}>
                                  <Ban className="mr-1 h-3.5 w-3.5 text-muted-foreground" />{t("workforce.close", "Close")}
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">{t("safety.viewOnly", "View only")}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ════════════════ TAB: Collaboration (S1-a handover) ════════════════ */}
          <TabsContent value="collaboration" className="flex flex-col gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Handshake className="h-4 w-4" />
                  {t("workforce.collabTitle", "Human↔robot handover sessions")}
                </CardTitle>
                <Button size="sm" variant="outline" className="h-8" disabled={!canControl} title={permReason} onClick={() => setStartCollabOpen(true)}>
                  <HandMetal className="mr-1 h-4 w-4" />{t("workforce.startCollab", "Start collaboration")}
                </Button>
              </CardHeader>
              <CardContent>
                {collabsQ.isLoading && <p className="py-6 text-center text-sm text-muted-foreground">{t("safety.loading", "Loading…")}</p>}
                {!collabsQ.isLoading && collabs.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {t("workforce.collabEmpty", "No collaboration sessions. Handover coordination is advisory only — no device command is issued.")}
                  </p>
                )}
                <div className="grid gap-3 lg:grid-cols-2">
                  {collabs.map((c) => {
                    const terminal = c.phase === "done" || c.endedAt != null;
                    return (
                      <Card key={c.id} className="border-border/60">
                        <CardContent className="space-y-3 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-medium">
                                {t("workforce.session", "Session")} #{c.id}
                                {c.operationCode && <span className="ml-1 font-mono text-xs text-muted-foreground">{c.operationCode}</span>}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {c.humanOperatorId != null && <span className="mr-2 inline-flex items-center gap-1"><User className="h-3 w-3" />#{c.humanOperatorId}</span>}
                                {c.robotDeviceId != null && <span className="inline-flex items-center gap-1"><Bot className="h-3 w-3" />#{c.robotDeviceId}</span>}
                              </div>
                            </div>
                            {handshakeBadge(c.handshakeState, t)}
                          </div>

                          {/* Phase indicator: human_prep → robot_work → human_verify → done */}
                          <div className="flex items-center gap-1">
                            {COLLAB_PHASES.map((p, i) => {
                              const reached = COLLAB_PHASES.indexOf(c.phase as (typeof COLLAB_PHASES)[number]) >= i;
                              const current = c.phase === p;
                              return (
                                <div key={p} className="flex items-center gap-1">
                                  <span
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                      current ? "bg-primary text-primary-foreground"
                                      : reached ? "bg-emerald-500/15 text-emerald-600"
                                      : "bg-muted text-muted-foreground"
                                    }`}
                                  >
                                    {t(`workforce.phase.${p}`, p)}
                                  </span>
                                  {i < COLLAB_PHASES.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                                </div>
                              );
                            })}
                          </div>
                          <Progress
                            value={((COLLAB_PHASES.indexOf(c.phase as (typeof COLLAB_PHASES)[number]) + 1) / COLLAB_PHASES.length) * 100}
                          />

                          {canControl && !terminal && (
                            <div className="flex flex-wrap gap-1">
                              <Button size="sm" variant="ghost" className="h-7" disabled={signalM.isPending} onClick={() => signalM.mutate({ sessionId: c.id, state: "ack" })}>
                                <Send className="mr-1 h-3.5 w-3.5" />{t("workforce.signalAck", "Ack")}
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7" disabled={signalM.isPending} onClick={() => signalM.mutate({ sessionId: c.id, state: "clear" })}>
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />{t("workforce.signalClear", "Clear")}
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7" disabled={advanceM.isPending} onClick={() => advanceM.mutate({ sessionId: c.id })}>
                                <ChevronRight className="mr-1 h-3.5 w-3.5" />{t("workforce.advance", "Advance phase")}
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7" onClick={() => setAbortTarget(c)}>
                                <Ban className="mr-1 h-3.5 w-3.5 text-destructive" />{t("workforce.abort", "Abort")}
                              </Button>
                            </div>
                          )}
                          {terminal && (
                            <div className="text-xs text-muted-foreground">
                              {t("workforce.collabClosed", "Closed")} · {fmtDateTime(c.endedAt ?? c.updatedAt)}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Footer safety note — reinforces the advisory nature */}
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t(
              "safety.footerNote",
              "All writes on this page are monitoring / logging / coordination state only. Near-miss ingest raises a yellow Andon and PROPOSES (never executes) a speed reduction through the existing gated dispatcher.",
            )}
          </span>
        </div>
      </PageContainer>

      {/* ── Audit confirm ────────────────────────────────────────────────────── */}
      <AlertDialog open={!!auditTarget} onOpenChange={(o) => !o && setAuditTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("safety.auditConfirmTitle", "Audit this safety event?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("safety.auditConfirmBody", "Stamps a human PDCA review on the record (who reviewed it, when). Advisory — it does not change any device.")}
              {auditTarget && <span className="mt-1 block font-mono text-xs">#{auditTarget.id} · {auditTarget.eventType}</span>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => auditTarget && auditM.mutate({ eventId: auditTarget.id })}>
              {t("safety.confirmAudit", "Audit event")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Report proximity (advisory test) dialog ──────────────────────────── */}
      {proximityOpen && (
        <ProximityDialog
          pending={ingestM.isPending}
          onClose={() => setProximityOpen(false)}
          onSubmit={(v) => ingestM.mutate(v)}
        />
      )}

      {/* ── Assign / reassign dialogs ────────────────────────────────────────── */}
      {assignOpen && (
        <AssignmentDialog
          mode="assign"
          pending={assignM.isPending}
          onClose={() => setAssignOpen(false)}
          onSubmit={(v) => assignM.mutate(v)}
        />
      )}
      {reassignTarget && (
        <AssignmentDialog
          mode="reassign"
          existing={reassignTarget}
          pending={reassignM.isPending}
          onClose={() => setReassignTarget(null)}
          onSubmit={(v) => reassignM.mutate({ assignmentId: reassignTarget.id, ...v })}
        />
      )}

      {/* ── Close assignment confirm ─────────────────────────────────────────── */}
      <AlertDialog open={!!closeTarget} onOpenChange={(o) => !o && setCloseTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("workforce.closeConfirmTitle", "Close this assignment?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("workforce.closeConfirmBody", "Marks the assignment completed (terminal).")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => closeTarget && closeM.mutate({ assignmentId: closeTarget.id })}>
              {t("workforce.confirmClose", "Close assignment")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Start collaboration dialog ───────────────────────────────────────── */}
      {startCollabOpen && (
        <StartCollabDialog
          pending={startCollabM.isPending}
          onClose={() => setStartCollabOpen(false)}
          onSubmit={(v) => startCollabM.mutate(v)}
        />
      )}

      {/* ── Abort collaboration confirm ──────────────────────────────────────── */}
      <AlertDialog open={!!abortTarget} onOpenChange={(o) => !o && setAbortTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("workforce.abortConfirmTitle", "Abort this collaboration?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("workforce.abortConfirmBody", "Terminally aborts the handover session. Advisory coordination only — no device command is issued.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => abortTarget && abortM.mutate({ sessionId: abortTarget.id })}>
              {t("workforce.confirmAbort", "Abort")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Dialogs
// ══════════════════════════════════════════════════════════════════════════════
function ProximityDialog({
  pending, onClose, onSubmit,
}: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (v: { deviceId?: number; stationId?: number; distance: number; confidence: number; source: "vision" | "manual" | "test" }) => void;
}) {
  const { t } = useTranslation();
  const [deviceId, setDeviceId] = useState("");
  const [stationId, setStationId] = useState("");
  const [distance, setDistance] = useState("150");
  const [confidence, setConfidence] = useState("0.9");

  const submit = () => {
    const dist = Number(distance);
    const conf = Number(confidence);
    if (!Number.isFinite(dist) || dist < 0) {
      toast.error(t("safety.distanceRequired", "Enter a valid distance (mm)."));
      return;
    }
    if (!Number.isFinite(conf) || conf < 0 || conf > 1) {
      toast.error(t("safety.confidenceRequired", "Confidence must be between 0 and 1."));
      return;
    }
    const dev = deviceId ? Number(deviceId) : undefined;
    const st = stationId ? Number(stationId) : undefined;
    onSubmit({
      deviceId: Number.isInteger(dev) && (dev as number) > 0 ? dev : undefined,
      stationId: Number.isInteger(st) && (st as number) > 0 ? st : undefined,
      distance: dist,
      confidence: conf,
      source: "test",
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ScanLine className="h-4 w-4" />{t("safety.proximityTitle", "Report proximity (advisory test)")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-muted-foreground">
            {t("safety.proximityHint", "Advisory test ingest. Below the configured margin (and at/above min confidence) → records a near_miss + raises a yellow Andon. It NEVER issues a device command. source is tagged 'test'.")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("safety.distance", "Distance (mm)")}</Label>
              <Input type="number" min={0} value={distance} placeholder="150" onChange={(e) => setDistance(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("safety.confidence", "Confidence (0–1)")}</Label>
              <Input type="number" min={0} max={1} step={0.05} value={confidence} placeholder="0.9" onChange={(e) => setConfidence(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("safety.deviceIdOpt", "Robot/device id (optional)")}</Label>
              <Input type="number" min={1} value={deviceId} placeholder="e.g. 1" onChange={(e) => setDeviceId(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("safety.stationIdOpt", "Station id (optional)")}</Label>
              <Input type="number" min={1} value={stationId} placeholder="e.g. 1" onChange={(e) => setStationId(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}><ScanLine className="mr-1 h-4 w-4" />{t("safety.ingest", "Ingest (advisory)")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type AssignmentFormValue = {
  operatorId: number;
  lineId?: number;
  stationId?: number;
  skillLevel?: string;
};

function AssignmentDialog({
  mode, existing, pending, onClose, onSubmit,
}: {
  mode: "assign" | "reassign";
  existing?: Assignment;
  pending: boolean;
  onClose: () => void;
  onSubmit: (v: AssignmentFormValue) => void;
}) {
  const { t } = useTranslation();
  const [operatorId, setOperatorId] = useState(existing?.operatorId != null ? String(existing.operatorId) : "");
  const [lineId, setLineId] = useState(existing?.lineId != null ? String(existing.lineId) : "");
  const [stationId, setStationId] = useState(existing?.stationId != null ? String(existing.stationId) : "");
  const [skillLevel, setSkillLevel] = useState(existing?.skillLevel ?? "");

  const submit = () => {
    const op = Number(operatorId);
    if (!Number.isInteger(op) || op <= 0) {
      toast.error(t("workforce.operatorIdRequired", "Enter a valid operator (user) id."));
      return;
    }
    const ln = lineId ? Number(lineId) : undefined;
    const st = stationId ? Number(stationId) : undefined;
    onSubmit({
      operatorId: op,
      lineId: Number.isInteger(ln) && (ln as number) > 0 ? ln : undefined,
      stationId: Number.isInteger(st) && (st as number) > 0 ? st : undefined,
      skillLevel: skillLevel.trim() || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            {mode === "assign" ? t("workforce.assignTitle", "Assign operator") : t("workforce.reassignTitle", "Reassign operator")}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1">
            <Label>{t("workforce.operatorId", "Operator (user) id")}</Label>
            <Input type="number" min={1} value={operatorId} placeholder="e.g. 1" onChange={(e) => setOperatorId(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("workforce.lineId", "Line id (optional)")}</Label>
              <Input type="number" min={1} value={lineId} placeholder="e.g. 1" onChange={(e) => setLineId(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("workforce.stationId", "Station id (optional)")}</Label>
              <Input type="number" min={1} value={stationId} placeholder="e.g. 1" onChange={(e) => setStationId(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>{t("workforce.skillLevel", "Skill level (optional)")}</Label>
            <Select
              value={skillLevel || "none"}
              onValueChange={(v) => setSkillLevel(v === "none" ? "" : v)}
            >
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("workforce.skillNone", "— none —")}</SelectItem>
                {["trainee", "qualified", "expert", "trainer"].map((s) => (
                  <SelectItem key={s} value={s}>{t(`safety.skill.${s}`, s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}>
            <CheckCircle2 className="mr-1 h-4 w-4" />
            {mode === "assign" ? t("workforce.assign", "Assign") : t("workforce.reassign", "Reassign")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StartCollabDialog({
  pending, onClose, onSubmit,
}: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (v: { operationCode?: string; humanOperatorId?: number; robotDeviceId?: number; taskId?: number }) => void;
}) {
  const { t } = useTranslation();
  const [operationCode, setOperationCode] = useState("");
  const [humanOperatorId, setHumanOperatorId] = useState("");
  const [robotDeviceId, setRobotDeviceId] = useState("");
  const [taskId, setTaskId] = useState("");

  const submit = () => {
    const human = humanOperatorId ? Number(humanOperatorId) : undefined;
    const robot = robotDeviceId ? Number(robotDeviceId) : undefined;
    const task = taskId ? Number(taskId) : undefined;
    onSubmit({
      operationCode: operationCode.trim() || undefined,
      humanOperatorId: Number.isInteger(human) && (human as number) > 0 ? human : undefined,
      robotDeviceId: Number.isInteger(robot) && (robot as number) > 0 ? robot : undefined,
      taskId: Number.isInteger(task) && (task as number) > 0 ? task : undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><HandMetal className="h-4 w-4" />{t("workforce.startCollabTitle", "Start human↔robot collaboration")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
            {t("workforce.startCollabHint", "Starts an advisory handover handshake (human_prep → robot_work → human_verify → done). Coordination metadata only — NOT a safety interlock and issues no device command.")}
          </div>
          <div className="grid gap-1">
            <Label>{t("workforce.operationCode", "Operation code (optional)")}</Label>
            <Input value={operationCode} placeholder="OP-WELD-01" onChange={(e) => setOperationCode(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("workforce.humanId", "Human operator id")}</Label>
              <Input type="number" min={1} value={humanOperatorId} placeholder="e.g. 1" onChange={(e) => setHumanOperatorId(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("workforce.robotId", "Robot device id")}</Label>
              <Input type="number" min={1} value={robotDeviceId} placeholder="e.g. 1" onChange={(e) => setRobotDeviceId(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>{t("workforce.taskId", "Task id (optional)")}</Label>
            <Input type="number" min={1} value={taskId} placeholder="e.g. 1" onChange={(e) => setTaskId(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}><Handshake className="mr-1 h-4 w-4" />{t("workforce.startCollab", "Start collaboration")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
