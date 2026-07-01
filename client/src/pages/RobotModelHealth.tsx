/**
 * I2 (doc 16 §9 Khối 4 / doc 18 §6) — ROBOT & MODEL HEALTH surface.
 *
 * A light, read-mostly cockpit over the aiRobotAnomalyRouter that completes the
 * AI/analytics loop (Khối 4). Two append-only ADVISORY ledgers, two independent
 * flags, organised into tabs:
 *   • "Robot anomalies" (I2-a) — robot_behavior_anomalies feed (robot, kind,
 *       score, confidence, evidence summary, acknowledged); acknowledge action +
 *       a manual "Scan robot" (robot picker → scanRobot, flag- + RBAC-gated).
 *   • "Model rollback" (I2-b) — model_rollback_events audit (from→to version,
 *       reason badge, key metrics); "Evaluate now" (evaluateRollback, flag-gated)
 *       and a manual rollback dialog (manualRollback — perm-gated, flag-independent).
 *
 * ⚠ HONESTY / SAFETY (mirrors the router): NOTHING here issues a robot command.
 *   Anomalies are advisory records; rollback only flips a model_versions.status
 *   (the SAME operation manual activation performs). Two honest seams the UI states
 *   plainly: grip_force detection is DORMANT until a driver surfaces force telemetry,
 *   and auto-rollback stays INERT until a model_performance_snapshots signal exists.
 *
 * Flags (read from aiRobotAnomaly.status — independent of each other):
 *   • AI_ROBOT_ANOMALY_ENABLED    → scanRobot
 *   • AI_MODEL_AUTOROLLBACK_ENABLED → evaluateRollback
 *   (acknowledgeAnomaly + manualRollback are perm-gated but flag-independent.)
 * When a flag is OFF the page shows a calm preview banner and surfaces the CONFLICT
 * error gracefully (toast.info, not red) — mirrors FleetOrchestration / SafetyWorkforce.
 *
 * RBAC: read → machine_monitoring/canView; mutations → machine_control/canEdit.
 * i18n: t("robotHealth.*", "English default") fallback pattern (nav keys are in the
 * locale files; page strings use inline defaults).
 */
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { MetricCard, PageHeader, SectionCard, StatusBadge, Text } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bot, RefreshCw, Info, AlertTriangle, Activity, Lock, CheckCircle2,
  ScanLine, History, GitBranch, Waypoints, Gauge, Hand, Undo2, Play,
} from "lucide-react";
import { toast } from "sonner";

// ── Typesafe shapes inferred from the aiRobotAnomalyRouter output ─────────────
type RouterOutputs = inferRouterOutputs<AppRouter>;
type RobotAnomaly = RouterOutputs["aiRobotAnomaly"]["listAnomalies"][number];
type RollbackEvent = RouterOutputs["aiRobotAnomaly"]["rollbackHistory"][number];
type RobotRow = RouterOutputs["robot"]["list"][number];

const ANOMALY_KINDS = ["trajectory_deviation", "grip_force", "cycle_time_trend"] as const;

// ── kind badge (icon + colour by anomaly kind; grip_force flagged as a seam) ──
function kindBadge(kind: string, t: (k: string, f: string) => string) {
  const map: Record<string, { cls: string; icon: ReactNode; label: string }> = {
    trajectory_deviation: {
      cls: "bg-blue-500 text-white",
      icon: <Waypoints className="mr-1 h-3 w-3" />,
      label: t("robotHealth.kind.trajectory", "Trajectory"),
    },
    grip_force: {
      cls: "bg-violet-500 text-white",
      icon: <Hand className="mr-1 h-3 w-3" />,
      label: t("robotHealth.kind.grip_force", "Grip force"),
    },
    cycle_time_trend: {
      cls: "bg-amber-500 text-white",
      icon: <Gauge className="mr-1 h-3 w-3" />,
      label: t("robotHealth.kind.cycle_time", "Cycle time"),
    },
  };
  const e = map[kind] ?? { cls: "", icon: <></>, label: kind };
  return e.cls
    ? <Badge className={e.cls}>{e.icon}{e.label}</Badge>
    : <Badge variant="outline">{kind}</Badge>;
}

// ── rollback trigger/reason badge ─────────────────────────────────────────────
function reasonBadge(trigger: string, t: (k: string, f: string) => string) {
  switch (trigger) {
    case "auto_drift":
      return <StatusBadge status="auto_drift" tone="warning" label={t("robotHealth.reason.auto_drift", "Auto · drift")} />;
    case "auto_accuracy":
      return <StatusBadge status="auto_accuracy" tone="warning" label={t("robotHealth.reason.auto_accuracy", "Auto · accuracy")} />;
    case "manual":
    default:
      return <StatusBadge status="manual" tone="info" label={t("robotHealth.reason.manual", "Manual")} />;
  }
}

function fmtNum(v: string | number | null | undefined, digits = 3): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtConfidence(v: string | number | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function fmtDateTime(d?: string | Date | null): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString();
}

/** Compact one-line summary of the jsonb evidence blob (honest data behind the score). */
function evidenceSummary(evidence: Record<string, unknown> | null | undefined): string {
  if (!evidence || typeof evidence !== "object") return "—";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(evidence)) {
    if (v == null || typeof v === "object") continue;
    parts.push(`${k}: ${typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(2)) : String(v)}`);
    if (parts.length >= 4) break;
  }
  return parts.length ? parts.join(" · ") : "—";
}

export default function RobotModelHealth() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("machine_monitoring", "canView");
  const canControl = hasPermission("machine_control", "canEdit");

  const [tab, setTab] = useState("anomalies");
  const [kindFilter, setKindFilter] = useState<string>("");
  const [scanOpen, setScanOpen] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);

  const utils = trpc.useUtils();

  // ── Reads (machine_monitoring/canView) ──────────────────────────────────────
  const statusQ = trpc.aiRobotAnomaly.status.useQuery(undefined, { enabled: canView });
  const anomaliesQ = trpc.aiRobotAnomaly.listAnomalies.useQuery({ limit: 200 }, { enabled: canView });
  const rollbackQ = trpc.aiRobotAnomaly.rollbackHistory.useQuery({ limit: 200 }, { enabled: canView });
  const robotsQ = trpc.robot.list.useQuery(undefined, { enabled: canView });

  const anomalies = (anomaliesQ.data ?? []) as RobotAnomaly[];
  const rollbacks = (rollbackQ.data ?? []) as RollbackEvent[];
  const robots = (robotsQ.data ?? []) as RobotRow[];

  // Two INDEPENDENT flags — honest preview banners. Default true so an errored/
  // missing status query doesn't paint a false "disabled" state.
  const robotAnomalyEnabled = statusQ.data?.robotAnomalyEnabled ?? true;
  const modelAutoRollbackEnabled = statusQ.data?.modelAutoRollbackEnabled ?? true;

  const refetchAll = () => {
    void utils.aiRobotAnomaly.status.invalidate();
    void utils.aiRobotAnomaly.listAnomalies.invalidate();
    void utils.aiRobotAnomaly.rollbackHistory.invalidate();
  };

  // Flag-off CONFLICT → calm info (not a scary red error). Both I2 flags surface a
  // "disabled" CONFLICT message from the router.
  const onMutationError = (e: { data?: { code?: string } | null; message: string }) => {
    if (e.data?.code === "CONFLICT" && /disabled/i.test(e.message)) {
      if (/rollback/i.test(e.message)) {
        toast.info(t("robotHealth.rollbackFlagOffToast", "Model auto-rollback is disabled (preview). Set AI_MODEL_AUTOROLLBACK_ENABLED=true to evaluate."));
      } else {
        toast.info(t("robotHealth.anomalyFlagOffToast", "Robot anomaly detection is disabled (preview). Set AI_ROBOT_ANOMALY_ENABLED=true to scan."));
      }
      void utils.aiRobotAnomaly.status.invalidate();
    } else {
      toast.error(e.message);
    }
  };

  // ── Mutations (machine_control/canEdit) ─────────────────────────────────────
  const acknowledgeM = trpc.aiRobotAnomaly.acknowledgeAnomaly.useMutation({
    onSuccess: () => { toast.success(t("robotHealth.acknowledged", "Anomaly acknowledged")); refetchAll(); },
    onError: onMutationError,
  });
  const scanM = trpc.aiRobotAnomaly.scanRobot.useMutation({
    onSuccess: (r) => {
      const n = r && "count" in r ? r.count : 0;
      toast.success(
        n > 0
          ? t("robotHealth.scanRaised", "Scan complete — {{n}} advisory anomaly(ies) raised").replace("{{n}}", String(n))
          : t("robotHealth.scanClean", "Scan complete — no anomaly raised (advisory)"),
      );
      setScanOpen(false);
      refetchAll();
    },
    onError: onMutationError,
  });
  const evaluateM = trpc.aiRobotAnomaly.evaluateRollback.useMutation({
    onSuccess: (r) => {
      const rolled = r && typeof r === "object" && "rolledBack" in r ? (r as { rolledBack?: boolean }).rolledBack : false;
      toast.success(
        rolled
          ? t("robotHealth.evalRolled", "Evaluation complete — a rollback was recorded")
          : t("robotHealth.evalNoop", "Evaluation complete — no rollback needed (advisory)"),
      );
      refetchAll();
    },
    onError: onMutationError,
  });
  const manualRollbackM = trpc.aiRobotAnomaly.manualRollback.useMutation({
    onSuccess: () => { toast.success(t("robotHealth.rolledBack", "Manual rollback recorded")); setRollbackOpen(false); refetchAll(); },
    onError: onMutationError,
  });

  // ── Derived KPIs ─────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const open = anomalies.filter((a) => a.status !== "acknowledged").length;
    const byKind: Record<string, number> = {};
    for (const a of anomalies) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
    return {
      open,
      trajectory: byKind.trajectory_deviation ?? 0,
      gripForce: byKind.grip_force ?? 0,
      cycleTime: byKind.cycle_time_trend ?? 0,
      rollbacks: rollbacks.length,
    };
  }, [anomalies, rollbacks]);

  const filteredAnomalies = useMemo(
    () => (kindFilter ? anomalies.filter((a) => a.kind === kindFilter) : anomalies),
    [anomalies, kindFilter],
  );

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
              {t("robotHealth.noPermission", "You do not have permission to view robot & model health.")}
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {/* ── PageHeader (DS F1b shared pattern) ─────────────────────────────── */}
        <PageHeader
          icon={<Bot className="h-6 w-6" />}
          title={t("robotHealth.title", "Robot & Model Health")}
          badge={!canControl ? <ViewOnlyBadge module="machine_control" /> : undefined}
          description={t("robotHealth.subtitle", "Advisory robot-behaviour anomaly monitoring + AI model rollback audit — records only, no direct device commands.")}
          actions={
            <Button size="icon" variant="ghost" onClick={refetchAll} title={t("common.refresh", "Refresh")}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          }
        />

        {/* ── Honest advisory note — the two seams stated plainly ────────────── */}
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <Text className="font-medium text-foreground">
              {t("robotHealth.advisoryTitle", "Advisory monitoring only — no device commands")}
            </Text>
            <div className="mt-0.5">
              {t(
                "robotHealth.advisoryNote",
                "Anomalies are advisory records (they raise a smart alert, never a robot command). Grip-force detection stays dormant until a driver surfaces force telemetry. Auto-rollback stays inert until a live model_performance_snapshots signal exists — manual rollback only flips a model version's status, the same operation as manual activation.",
              )}
            </div>
          </div>
        </div>

        {/* ── Flag-off preview banners (two independent flags, calm/honest) ──── */}
        {!robotAnomalyEnabled && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              {t(
                "robotHealth.anomalyFlagOffBanner",
                "Preview mode: robot anomaly detection is disabled (AI_ROBOT_ANOMALY_ENABLED is off). Reads work; manual scans are blocked until the flag is enabled.",
              )}
            </span>
          </div>
        )}
        {!modelAutoRollbackEnabled && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              {t(
                "robotHealth.rollbackFlagOffBanner",
                "Preview mode: model auto-rollback is disabled (AI_MODEL_AUTOROLLBACK_ENABLED is off). Reads + manual rollback work; automatic evaluation is blocked until the flag is enabled.",
              )}
            </span>
          </div>
        )}

        {/* ── KPI strip ──────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard icon={<AlertTriangle className="h-4 w-4" />} label={t("robotHealth.kpi.open", "Open anomalies")} value={kpis.open} tone={kpis.open > 0 ? "warning" : "default"} />
          <MetricCard icon={<Waypoints className="h-4 w-4" />} label={t("robotHealth.kpi.trajectory", "Trajectory")} value={kpis.trajectory} />
          <MetricCard icon={<Hand className="h-4 w-4" />} label={t("robotHealth.kpi.gripForce", "Grip force")} value={kpis.gripForce} tone={kpis.gripForce > 0 ? "warning" : "default"} />
          <MetricCard icon={<Gauge className="h-4 w-4" />} label={t("robotHealth.kpi.cycleTime", "Cycle time")} value={kpis.cycleTime} />
          <MetricCard icon={<History className="h-4 w-4" />} label={t("robotHealth.kpi.rollbacks", "Rollbacks recorded")} value={kpis.rollbacks} />
        </div>

        {/* ── Tabbed surface ─────────────────────────────────────────────────── */}
        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="anomalies"><Activity className="mr-1 h-4 w-4" />{t("robotHealth.tab.anomalies", "Robot anomalies")}</TabsTrigger>
            <TabsTrigger value="rollback"><GitBranch className="mr-1 h-4 w-4" />{t("robotHealth.tab.rollback", "Model rollback")}</TabsTrigger>
          </TabsList>

          {/* ════════════════ TAB: Robot anomalies (I2-a) ════════════════ */}
          <TabsContent value="anomalies" className="flex flex-col gap-4">
            <SectionCard
              icon={<Activity className="h-4 w-4" />}
              title={t("robotHealth.anomaliesTitle", "Robot-behaviour anomalies (advisory)")}
              action={
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">{t("robotHealth.filterKind", "Kind")}</Label>
                  <select
                    className="flex h-8 w-40 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                    value={kindFilter}
                    onChange={(e) => setKindFilter(e.target.value)}
                  >
                    <option value="">{t("robotHealth.all", "All")}</option>
                    {ANOMALY_KINDS.map((k) => (
                      <option key={k} value={k}>{t(`robotHealth.kindOpt.${k}`, k)}</option>
                    ))}
                  </select>
                  {canControl && (
                    <Button size="sm" variant="outline" className="h-8" onClick={() => setScanOpen(true)}>
                      <ScanLine className="mr-1 h-4 w-4" />{t("robotHealth.scan", "Scan robot")}
                    </Button>
                  )}
                </div>
              }
              contentClassName="p-0"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("robotHealth.col.robot", "Robot")}</TableHead>
                    <TableHead>{t("robotHealth.col.kind", "Kind")}</TableHead>
                    <TableHead>{t("robotHealth.col.score", "Score")}</TableHead>
                    <TableHead>{t("robotHealth.col.confidence", "Confidence")}</TableHead>
                    <TableHead>{t("robotHealth.col.evidence", "Evidence")}</TableHead>
                    <TableHead>{t("robotHealth.col.status", "Status")}</TableHead>
                    <TableHead>{t("robotHealth.col.when", "When")}</TableHead>
                    <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {anomaliesQ.isLoading && (
                    <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">{t("robotHealth.loading", "Loading…")}</TableCell></TableRow>
                  )}
                  {!anomaliesQ.isLoading && filteredAnomalies.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                        {t("robotHealth.anomaliesEmpty", "No anomalies recorded. This ledger is advisory — grip-force rows only appear once force telemetry exists.")}
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredAnomalies.map((a) => {
                    const acked = a.status === "acknowledged";
                    const robot = robots.find((r) => r.id === a.robotId);
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="text-xs">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                            title={t("robotHealth.openCockpit", "Open robot cockpit")}
                            onClick={() => setLocation(`/robot/${a.robotId}`)}
                          >
                            <Bot className="h-3 w-3" />
                            {robot ? <span className="font-mono">{robot.code}</span> : <span>#{a.robotId}</span>}
                          </button>
                        </TableCell>
                        <TableCell>{kindBadge(a.kind, t)}</TableCell>
                        <TableCell className="text-xs tabular-nums">{fmtNum(a.score)}</TableCell>
                        <TableCell className="text-xs tabular-nums">{fmtConfidence(a.confidence)}</TableCell>
                        <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground" title={evidenceSummary(a.evidence)}>
                          {evidenceSummary(a.evidence)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={a.status}
                            tone={acked ? "success" : "warning"}
                            label={acked ? t("robotHealth.acked", "Acknowledged") : t("robotHealth.raised", "Raised")}
                          />
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{fmtDateTime(a.detectedAt)}</TableCell>
                        <TableCell className="text-right">
                          {canControl && !acked ? (
                            <Button size="sm" variant="ghost" className="h-7" disabled={acknowledgeM.isPending} onClick={() => acknowledgeM.mutate({ id: a.id })}>
                              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />{t("robotHealth.acknowledge", "Acknowledge")}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </SectionCard>
          </TabsContent>

          {/* ════════════════ TAB: Model rollback (I2-b) ════════════════ */}
          <TabsContent value="rollback" className="flex flex-col gap-4">
            <SectionCard
              icon={<History className="h-4 w-4" />}
              title={t("robotHealth.rollbackTitle", "Model rollback history (audit)")}
              action={
                canControl && (
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" className="h-8" onClick={() => setRollbackOpen(true)}>
                      <Undo2 className="mr-1 h-4 w-4" />{t("robotHealth.manualRollback", "Manual rollback")}
                    </Button>
                  </div>
                )
              }
              contentClassName="p-0"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("robotHealth.col.model", "Model")}</TableHead>
                    <TableHead>{t("robotHealth.col.version", "From → To")}</TableHead>
                    <TableHead>{t("robotHealth.col.reason", "Reason")}</TableHead>
                    <TableHead>{t("robotHealth.col.metrics", "Key metrics")}</TableHead>
                    <TableHead>{t("robotHealth.col.when", "When")}</TableHead>
                    <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rollbackQ.isLoading && (
                    <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("robotHealth.loading", "Loading…")}</TableCell></TableRow>
                  )}
                  {!rollbackQ.isLoading && rollbacks.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        {t("robotHealth.rollbackEmpty", "No rollbacks recorded. Automatic evaluation stays inert until a live model performance signal exists.")}
                      </TableCell>
                    </TableRow>
                  )}
                  {rollbacks.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">
                        <span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3" />#{r.modelId}</span>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        <span className="font-mono">{r.fromVersion ?? (r.fromVersionId != null ? `#${r.fromVersionId}` : "—")}</span>
                        <span className="mx-1 text-muted-foreground">→</span>
                        <span className="font-mono">{r.toVersion ?? (r.toVersionId != null ? `#${r.toVersionId}` : "—")}</span>
                      </TableCell>
                      <TableCell>{reasonBadge(r.trigger, t)}</TableCell>
                      <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground" title={evidenceSummary(r.metrics)}>
                        {evidenceSummary(r.metrics)}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{fmtDateTime(r.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        {canControl ? (
                          <Button
                            size="sm" variant="ghost" className="h-7"
                            disabled={evaluateM.isPending}
                            title={t("robotHealth.evaluateTip", "Run the auto-rollback evaluation for this model now (flag-gated)")}
                            onClick={() => evaluateM.mutate({ modelId: r.modelId })}
                          >
                            <Play className="mr-1 h-3.5 w-3.5" />{t("robotHealth.evaluate", "Evaluate now")}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">{t("robotHealth.viewOnly", "View only")}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </SectionCard>

            {/* Honest seam callout for the rollback tab */}
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {t(
                  "robotHealth.evaluateNote",
                  "\"Evaluate now\" asks the auto-rollback engine to compare the active version against its baseline. With no live model_performance_snapshots signal it is a safe no-op; a manual rollback (perm-gated) always works and only flips a model version's status.",
                )}
              </span>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Scan robot dialog (flag- + perm-gated) ───────────────────────────── */}
      {scanOpen && (
        <ScanRobotDialog
          robots={robots}
          pending={scanM.isPending}
          onClose={() => setScanOpen(false)}
          onSubmit={(robotId) => scanM.mutate({ robotId })}
        />
      )}

      {/* ── Manual rollback dialog (perm-gated, flag-independent) ─────────────── */}
      {rollbackOpen && (
        <ManualRollbackDialog
          pending={manualRollbackM.isPending}
          onClose={() => setRollbackOpen(false)}
          onSubmit={(v) => manualRollbackM.mutate(v)}
        />
      )}
    </DashboardLayout>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Dialogs
// ══════════════════════════════════════════════════════════════════════════════
function ScanRobotDialog({
  robots, pending, onClose, onSubmit,
}: {
  robots: RobotRow[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (robotId: number) => void;
}) {
  const { t } = useTranslation();
  const [robotId, setRobotId] = useState<string>(robots[0] ? String(robots[0].id) : "");

  const submit = () => {
    const n = Number(robotId);
    if (!Number.isInteger(n) || n <= 0) {
      toast.error(t("robotHealth.robotRequired", "Pick a robot to scan."));
      return;
    }
    onSubmit(n);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-4 w-4" />{t("robotHealth.scanTitle", "Scan robot for anomalies")}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
            {t("robotHealth.scanHint", "Runs the advisory anomaly detector over recent telemetry/jobs for this robot. It NEVER issues a robot command; any finding raises a smart alert only. Requires AI_ROBOT_ANOMALY_ENABLED.")}
          </div>
          <div className="grid gap-1">
            <Label>{t("robotHealth.robot", "Robot")}</Label>
            {robots.length > 0 ? (
              <select
                className="flex h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                value={robotId}
                onChange={(e) => setRobotId(e.target.value)}
              >
                {robots.map((r) => (
                  <option key={r.id} value={r.id}>{r.code} — {r.name}</option>
                ))}
              </select>
            ) : (
              <Input
                type="number" min={1} value={robotId}
                placeholder={t("robotHealth.robotIdPlaceholder", "e.g. 1")}
                onChange={(e) => setRobotId(e.target.value)}
              />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}>
            <ScanLine className="mr-1 h-4 w-4" />{t("robotHealth.scan", "Scan robot")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManualRollbackDialog({
  pending, onClose, onSubmit,
}: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (v: { modelId: number; toVersionId: number; reason?: string }) => void;
}) {
  const { t } = useTranslation();
  const [modelId, setModelId] = useState("");
  const [toVersionId, setToVersionId] = useState("");
  const [reason, setReason] = useState("");

  const submit = () => {
    const m = Number(modelId);
    const v = Number(toVersionId);
    if (!Number.isInteger(m) || m <= 0) {
      toast.error(t("robotHealth.modelIdRequired", "Enter a valid model id."));
      return;
    }
    if (!Number.isInteger(v) || v <= 0) {
      toast.error(t("robotHealth.versionIdRequired", "Enter a valid target version id."));
      return;
    }
    onSubmit({ modelId: m, toVersionId: v, reason: reason.trim() || undefined });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="h-4 w-4" />{t("robotHealth.manualRollbackTitle", "Manual model rollback")}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
            {t("robotHealth.manualRollbackHint", "Perm-gated (machine_control/canEdit) and flag-independent. Flips the active model to the chosen version — the SAME operation as manual activation. No device command is issued.")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("robotHealth.modelId", "Model id")}</Label>
              <Input type="number" min={1} value={modelId} placeholder="e.g. 1" onChange={(e) => setModelId(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("robotHealth.toVersionId", "Target version id")}</Label>
              <Input type="number" min={1} value={toVersionId} placeholder="e.g. 3" onChange={(e) => setToVersionId(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>{t("robotHealth.reason", "Reason (optional)")}</Label>
            <Input value={reason} placeholder={t("robotHealth.reasonPlaceholder", "Why roll back?")} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}>
            <Undo2 className="mr-1 h-4 w-4" />{t("robotHealth.confirmRollback", "Roll back")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
