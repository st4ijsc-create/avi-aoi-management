/**
 * G1 (doc 16 §7 Khối 2 / §12 design system) — FLEET & TASK ORCHESTRATION surface.
 *
 * Read-mostly cockpit over the fleetRouter (Dynamic Task Allocation Engine +
 * Zone Traffic/Path manager). Surfaces:
 *   1. KPI strip — task counts by status + active reservations + zones at capacity
 *      + detected deadlocks (warning).
 *   2. Task queue table — allocate / reassign / cancel (flag- + RBAC-gated).
 *   3. Zones panel — occupancy vs maxConcurrentRobots (progress bar) + reservations,
 *      reserve/release actions, deadlock cycles.
 *
 * SAFETY (mirrors the router): this page writes orchestration STATE only — it opens
 * NO device path. All mutations are additionally gated behind FLEET_ORCH_ENABLED;
 * when the flag is OFF the page shows an honest "preview" banner and surfaces the
 * CONFLICT error gracefully. Read RBAC: machine_monitoring/canView. Actions:
 * machine_control/canCreate (hidden when not held).
 *
 * i18n: uses the t("key", "English default") fallback pattern (no locale-file edits).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
import {
  Truck, RefreshCw, ListChecks, Layers, AlertTriangle, ShieldAlert, Info,
  Play, Send, Ban, MapPin, Bot, Clock, Activity, Lock, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

// ── Typesafe shapes inferred from the fleetRouter output ──────────────────────
type RouterOutputs = inferRouterOutputs<AppRouter>;
type FleetTask = RouterOutputs["fleet"]["listTasks"][number];
type FleetZone = RouterOutputs["fleet"]["listZones"][number];
type FleetReservation = RouterOutputs["fleet"]["listReservations"][number];

const TASK_STATUSES = ["pending", "assigned", "running", "completed", "failed", "cancelled"] as const;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function taskStatusBadge(status: string, t: (k: string, f: string) => string) {
  switch (status) {
    case "running":
      return <Badge className="bg-blue-500 text-white">{t("fleet.task.running", "Running")}</Badge>;
    case "assigned":
      return <Badge className="bg-cyan-500 text-white">{t("fleet.task.assigned", "Assigned")}</Badge>;
    case "completed":
      return <Badge className="bg-emerald-500 text-white">{t("fleet.task.completed", "Completed")}</Badge>;
    case "failed":
      return <Badge variant="destructive">{t("fleet.task.failed", "Failed")}</Badge>;
    case "cancelled":
      return <Badge variant="outline" className="text-muted-foreground">{t("fleet.task.cancelled", "Cancelled")}</Badge>;
    case "pending":
    default:
      return <Badge className="bg-amber-500 text-white">{t("fleet.task.pending", "Pending")}</Badge>;
  }
}

function resStatusBadge(status: string, t: (k: string, f: string) => string) {
  switch (status) {
    case "active":
      return <Badge className="bg-emerald-500 text-white">{t("fleet.res.active", "Active")}</Badge>;
    case "queued":
      return <Badge className="bg-amber-500 text-white">{t("fleet.res.queued", "Queued")}</Badge>;
    case "rejected":
      return <Badge variant="destructive">{t("fleet.res.rejected", "Rejected")}</Badge>;
    case "released":
    default:
      return <Badge variant="outline" className="text-muted-foreground">{t("fleet.res.released", "Released")}</Badge>;
  }
}

function zoneTypeBadge(zoneType: string, t: (k: string, f: string) => string) {
  const map: Record<string, { cls: string; label: string }> = {
    production: { cls: "bg-slate-500 text-white", label: t("fleet.zoneType.production", "Production") },
    transit: { cls: "bg-indigo-500 text-white", label: t("fleet.zoneType.transit", "Transit") },
    charging: { cls: "bg-emerald-500 text-white", label: t("fleet.zoneType.charging", "Charging") },
    human_shared: { cls: "bg-amber-500 text-white", label: t("fleet.zoneType.human_shared", "Human-shared") },
  };
  const e = map[zoneType] ?? { cls: "", label: zoneType };
  return e.cls ? <Badge className={e.cls}>{e.label}</Badge> : <Badge variant="outline">{e.label}</Badge>;
}

function fmtDuration(ms?: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function MetricCard({
  icon, label, value, tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone?: "default" | "warning" | "danger" | "good";
}) {
  const toneCls =
    tone === "danger" ? "text-destructive"
    : tone === "warning" ? "text-amber-500"
    : tone === "good" ? "text-emerald-500"
    : "text-foreground";
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0">
          <div className={`text-2xl font-bold tabular-nums ${toneCls}`}>{value}</div>
          <div className="truncate text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function FleetOrchestration() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("machine_monitoring", "canView");
  const canControl = hasPermission("machine_control", "canCreate");

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [assignTask, setAssignTask] = useState<FleetTask | null>(null);
  const [cancelTarget, setCancelTarget] = useState<FleetTask | null>(null);
  const [reserveZoneTarget, setReserveZoneTarget] = useState<FleetZone | null>(null);

  const utils = trpc.useUtils();

  // ── Reads ──────────────────────────────────────────────────────────────────
  const statusQ = trpc.fleet.status.useQuery(undefined, { enabled: canView });
  const tasksQ = trpc.fleet.listTasks.useQuery(
    { status: (statusFilter || undefined) as (typeof TASK_STATUSES)[number] | undefined, limit: 200 },
    { enabled: canView },
  );
  const zonesQ = trpc.fleet.listZones.useQuery(undefined, { enabled: canView });
  const reservationsQ = trpc.fleet.listReservations.useQuery({ limit: 500 }, { enabled: canView });
  const deadlocksQ = trpc.fleet.deadlocks.useQuery(undefined, { enabled: canView });

  const tasks = (tasksQ.data ?? []) as FleetTask[];
  const zones = (zonesQ.data ?? []) as FleetZone[];
  const reservations = (reservationsQ.data ?? []) as FleetReservation[];
  const deadlocks = deadlocksQ.data;

  // Flag state — honest preview banner. Prefer the explicit status query.
  const flagEnabled = statusQ.data?.enabled ?? true;

  const refetchAll = () => {
    void utils.fleet.status.invalidate();
    void utils.fleet.listTasks.invalidate();
    void utils.fleet.listZones.invalidate();
    void utils.fleet.listReservations.invalidate();
    void utils.fleet.deadlocks.invalidate();
  };

  // Surface the FLAG-OFF CONFLICT gracefully (info, not a scary red error).
  const onMutationError = (e: { data?: { code?: string } | null; message: string }) => {
    if (e.data?.code === "CONFLICT" && /disabled/i.test(e.message)) {
      toast.info(t("fleet.flagOffToast", "Fleet orchestration is disabled (preview). Set FLEET_ORCH_ENABLED=true to act."));
      void utils.fleet.status.invalidate();
    } else {
      toast.error(e.message);
    }
  };

  const allocateM = trpc.fleet.allocate.useMutation({
    onSuccess: () => { toast.success(t("fleet.allocated", "Allocation run")); refetchAll(); },
    onError: onMutationError,
  });
  const assignM = trpc.fleet.assign.useMutation({
    onSuccess: () => { toast.success(t("fleet.assigned", "Task reassigned")); setAssignTask(null); refetchAll(); },
    onError: onMutationError,
  });
  const cancelM = trpc.fleet.cancelTask.useMutation({
    onSuccess: () => { toast.success(t("fleet.cancelled", "Task cancelled")); setCancelTarget(null); refetchAll(); },
    onError: onMutationError,
  });
  const reserveM = trpc.fleet.reserve.useMutation({
    onSuccess: () => { toast.success(t("fleet.reserved", "Reservation requested")); setReserveZoneTarget(null); refetchAll(); },
    onError: onMutationError,
  });
  const releaseM = trpc.fleet.release.useMutation({
    onSuccess: () => { toast.success(t("fleet.released", "Released")); refetchAll(); },
    onError: onMutationError,
  });

  // ── Derived KPIs ─────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const byStatus: Record<string, number> = {};
    for (const tk of tasks) byStatus[tk.status] = (byStatus[tk.status] ?? 0) + 1;
    const activeReservations = reservations.filter((r) => r.status === "active").length;
    const queuedReservations = reservations.filter((r) => r.status === "queued").length;
    const zonesAtCapacity = zones.filter((z) => z.occupancy >= z.maxConcurrentRobots).length;
    return {
      pending: byStatus.pending ?? 0,
      assigned: byStatus.assigned ?? 0,
      running: byStatus.running ?? 0,
      failed: byStatus.failed ?? 0,
      activeReservations,
      queuedReservations,
      zonesAtCapacity,
      deadlockCount: deadlocks?.cycles?.length ?? 0,
    };
  }, [tasks, reservations, zones, deadlocks]);

  // Reservations grouped by zone (for the zones panel).
  const resByZone = useMemo(() => {
    const m = new Map<number, FleetReservation[]>();
    for (const r of reservations) {
      if (r.status === "released" || r.status === "rejected") continue;
      const list = m.get(r.zoneId) ?? [];
      list.push(r);
      m.set(r.zoneId, list);
    }
    return m;
  }, [reservations]);

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
              {t("fleet.noPermission", "You do not have permission to view fleet orchestration.")}
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const anyLoading = tasksQ.isLoading || zonesQ.isLoading || reservationsQ.isLoading;

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {/* ── PageHeader ─────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Truck className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight">
              {t("fleet.title", "Fleet & Task Orchestration")}
            </h1>
            {!canControl && <ViewOnlyBadge module="machine_control" />}
            <p className="text-sm text-muted-foreground">
              {t("fleet.subtitle", "Dynamic task allocation + zone traffic control — orchestration state only, no direct device commands.")}
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={refetchAll}
            title={t("common.refresh", "Refresh")}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* ── Flag-off preview banner (honest) ───────────────────────────────── */}
        {!flagEnabled && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              {t(
                "fleet.flagOffBanner",
                "Preview mode: fleet orchestration is disabled (FLEET_ORCH_ENABLED is off). Reads work; actions (allocate / reassign / cancel / reserve / release) are blocked until the flag is enabled.",
              )}
            </span>
          </div>
        )}

        {/* Safety note — mirrors RobotControl honesty */}
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t(
              "fleet.safetyNote",
              "This page writes orchestration state only (tasks / zones / reservations). Actual robot motion always routes through the gated HITL dispatcher — never from this screen.",
            )}
          </span>
        </div>

        {/* ── 1. KPI strip ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          <MetricCard icon={<Clock className="h-4 w-4" />} label={t("fleet.kpi.pending", "Pending")} value={kpis.pending} tone={kpis.pending > 0 ? "warning" : "default"} />
          <MetricCard icon={<Send className="h-4 w-4" />} label={t("fleet.kpi.assigned", "Assigned")} value={kpis.assigned} />
          <MetricCard icon={<Activity className="h-4 w-4" />} label={t("fleet.kpi.running", "Running")} value={kpis.running} tone={kpis.running > 0 ? "good" : "default"} />
          <MetricCard icon={<AlertTriangle className="h-4 w-4" />} label={t("fleet.kpi.failed", "Failed")} value={kpis.failed} tone={kpis.failed > 0 ? "danger" : "default"} />
          <MetricCard icon={<MapPin className="h-4 w-4" />} label={t("fleet.kpi.activeRes", "Active reservations")} value={kpis.activeReservations} />
          <MetricCard icon={<Layers className="h-4 w-4" />} label={t("fleet.kpi.atCapacity", "Zones at capacity")} value={`${kpis.zonesAtCapacity}/${zones.length}`} tone={kpis.zonesAtCapacity > 0 ? "warning" : "default"} />
          <MetricCard icon={<ShieldAlert className="h-4 w-4" />} label={t("fleet.kpi.deadlocks", "Deadlocks")} value={kpis.deadlockCount} tone={kpis.deadlockCount > 0 ? "danger" : "default"} />
        </div>

        {/* Deadlock detail banner */}
        {(deadlocks?.cycles?.length ?? 0) > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <div className="font-medium text-destructive">
                {t("fleet.deadlockTitle", "Deadlock cycle(s) detected")}
              </div>
              <div className="mt-1 space-y-0.5 text-muted-foreground">
                {deadlocks!.cycles.map((cycle, i) => (
                  <div key={i} className="font-mono text-xs">
                    {t("fleet.deadlockDevices", "Devices")}: {cycle.join(" → ")} → {cycle[0]}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── 2. Task queue ──────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4" />
              {t("fleet.tasksTitle", "Task queue")}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">{t("fleet.filterStatus", "Status")}</Label>
              <select
                className="flex h-8 w-36 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">{t("fleet.all", "All")}</option>
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>{t(`fleet.task.${s}`, s)}</option>
                ))}
              </select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("fleet.col.taskKey", "Task key")}</TableHead>
                  <TableHead>{t("fleet.col.capability", "Capability")}</TableHead>
                  <TableHead>{t("fleet.col.priority", "Priority")}</TableHead>
                  <TableHead>{t("fleet.col.status", "Status")}</TableHead>
                  <TableHead>{t("fleet.col.device", "Device")}</TableHead>
                  <TableHead>{t("fleet.col.duration", "Est / Act")}</TableHead>
                  <TableHead>{t("fleet.col.retries", "Retries")}</TableHead>
                  <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {anyLoading && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      {t("fleet.loading", "Loading…")}
                    </TableCell>
                  </TableRow>
                )}
                {!anyLoading && tasks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      {t("fleet.tasksEmpty", "No tasks. Tasks are decomposed from production orders or created by an admin.")}
                    </TableCell>
                  </TableRow>
                )}
                {tasks.map((tk) => {
                  const terminal = TERMINAL.has(tk.status);
                  return (
                    <TableRow key={tk.id}>
                      <TableCell className="font-mono text-xs">{tk.taskKey}</TableCell>
                      <TableCell><Badge variant="outline">{tk.requiredCapability}</Badge></TableCell>
                      <TableCell>
                        <Badge variant={tk.priority <= 2 ? "destructive" : "outline"}>P{tk.priority}</Badge>
                      </TableCell>
                      <TableCell>{taskStatusBadge(tk.status, t)}</TableCell>
                      <TableCell className="text-xs">
                        {tk.assignedDeviceId != null
                          ? <span className="inline-flex items-center gap-1"><Bot className="h-3 w-3" />#{tk.assignedDeviceId}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {fmtDuration(tk.estimatedDurationMs)} / {fmtDuration(tk.actualDurationMs)}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">{tk.retryCount}</TableCell>
                      <TableCell className="text-right">
                        {canControl ? (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm" variant="ghost" className="h-7"
                              disabled={terminal || tk.status === "running" || allocateM.isPending}
                              title={t("fleet.allocateTip", "Run the allocator (assign best device)")}
                              onClick={() => allocateM.mutate({ taskId: tk.id })}
                            >
                              <Play className="mr-1 h-3.5 w-3.5" />{t("fleet.allocate", "Allocate")}
                            </Button>
                            <Button
                              size="sm" variant="ghost" className="h-7"
                              disabled={terminal}
                              title={t("fleet.reassignTip", "Manually (re)assign to a device")}
                              onClick={() => setAssignTask(tk)}
                            >
                              <Send className="mr-1 h-3.5 w-3.5" />{t("fleet.reassign", "Reassign")}
                            </Button>
                            <Button
                              size="sm" variant="ghost" className="h-7"
                              disabled={terminal}
                              title={t("fleet.cancelTip", "Cancel this task")}
                              onClick={() => setCancelTarget(tk)}
                            >
                              <Ban className="mr-1 h-3.5 w-3.5 text-destructive" />{t("fleet.cancel", "Cancel")}
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">{t("fleet.viewOnly", "View only")}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* ── 3. Zones panel ─────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4" />
              {t("fleet.zonesTitle", "Zones & occupancy")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!anyLoading && zones.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("fleet.zonesEmpty", "No zones defined yet.")}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {zones.map((z) => {
                const pct = z.maxConcurrentRobots > 0
                  ? Math.min(100, (z.occupancy / z.maxConcurrentRobots) * 100)
                  : 0;
                const atCap = z.occupancy >= z.maxConcurrentRobots;
                const zoneRes = resByZone.get(z.id) ?? [];
                return (
                  <Card key={z.id} className="border-border/60">
                    <CardContent className="space-y-2 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{z.name}</div>
                          <div className="font-mono text-xs text-muted-foreground">{z.code}</div>
                        </div>
                        {zoneTypeBadge(z.zoneType, t)}
                      </div>
                      <div>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{t("fleet.occupancy", "Occupancy")}</span>
                          <span className={`tabular-nums font-medium ${atCap ? "text-amber-500" : ""}`}>
                            {z.occupancy} / {z.maxConcurrentRobots}
                          </span>
                        </div>
                        <Progress
                          value={pct}
                          className={atCap ? "[&>[data-slot=progress-indicator]]:bg-amber-500" : ""}
                        />
                      </div>
                      {/* Reservations on this zone */}
                      {zoneRes.length > 0 && (
                        <div className="space-y-1 pt-1">
                          {zoneRes.map((r) => (
                            <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
                              <span className="inline-flex items-center gap-1">
                                <Bot className="h-3 w-3" />#{r.deviceId}
                                {resStatusBadge(r.status, t)}
                              </span>
                              {canControl && r.status !== "released" && r.status !== "rejected" && (
                                <Button
                                  size="sm" variant="ghost" className="h-6 px-2 text-xs"
                                  disabled={releaseM.isPending}
                                  onClick={() => releaseM.mutate({ deviceId: r.deviceId, zoneId: z.id })}
                                >
                                  {t("fleet.release", "Release")}
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {canControl && (
                        <Button
                          size="sm" variant="outline" className="mt-1 h-7 w-full"
                          onClick={() => setReserveZoneTarget(z)}
                        >
                          <MapPin className="mr-1 h-3.5 w-3.5" />{t("fleet.reserve", "Reserve")}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Reassign dialog ──────────────────────────────────────────────────── */}
      {assignTask && (
        <AssignDialog
          task={assignTask}
          pending={assignM.isPending}
          onClose={() => setAssignTask(null)}
          onSubmit={(deviceId) => assignM.mutate({ taskId: assignTask.id, deviceId })}
        />
      )}

      {/* ── Reserve dialog ───────────────────────────────────────────────────── */}
      {reserveZoneTarget && (
        <ReserveDialog
          zone={reserveZoneTarget}
          pending={reserveM.isPending}
          onClose={() => setReserveZoneTarget(null)}
          onSubmit={(deviceId, queueIfFull) =>
            reserveM.mutate({ zoneId: reserveZoneTarget.id, deviceId, queueIfFull })}
        />
      )}

      {/* ── Cancel confirm ───────────────────────────────────────────────────── */}
      <AlertDialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("fleet.cancelConfirmTitle", "Cancel task?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("fleet.cancelConfirmBody", "This marks the task cancelled (terminal). It cannot be undone.")}
              {cancelTarget && <span className="mt-1 block font-mono text-xs">{cancelTarget.taskKey}</span>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => cancelTarget && cancelM.mutate({ taskId: cancelTarget.id })}>
              {t("fleet.confirmCancelTask", "Cancel task")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}

function AssignDialog({
  task, pending, onClose, onSubmit,
}: {
  task: FleetTask;
  pending: boolean;
  onClose: () => void;
  onSubmit: (deviceId: number) => void;
}) {
  const { t } = useTranslation();
  const [deviceId, setDeviceId] = useState<string>(task.assignedDeviceId != null ? String(task.assignedDeviceId) : "");

  const submit = () => {
    const n = Number(deviceId);
    if (!Number.isInteger(n) || n <= 0) {
      toast.error(t("fleet.deviceIdRequired", "Enter a valid device id."));
      return;
    }
    onSubmit(n);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" />{t("fleet.reassignTitle", "Reassign task")}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="text-sm text-muted-foreground">
            <span className="font-mono text-xs">{task.taskKey}</span>
            {" · "}{task.requiredCapability}
          </div>
          <div className="grid gap-1">
            <Label>{t("fleet.deviceId", "Device id (robot)")}</Label>
            <Input
              type="number" min={1} value={deviceId}
              placeholder={t("fleet.deviceIdPlaceholder", "e.g. 1")}
              onChange={(e) => setDeviceId(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}>
            <CheckCircle2 className="mr-1 h-4 w-4" />{t("fleet.assign", "Assign")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReserveDialog({
  zone, pending, onClose, onSubmit,
}: {
  zone: FleetZone;
  pending: boolean;
  onClose: () => void;
  onSubmit: (deviceId: number, queueIfFull: boolean) => void;
}) {
  const { t } = useTranslation();
  const [deviceId, setDeviceId] = useState<string>("");
  const [queueIfFull, setQueueIfFull] = useState(true);

  const submit = () => {
    const n = Number(deviceId);
    if (!Number.isInteger(n) || n <= 0) {
      toast.error(t("fleet.deviceIdRequired", "Enter a valid device id."));
      return;
    }
    onSubmit(n, queueIfFull);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />{t("fleet.reserveTitle", "Reserve zone")}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{zone.name}</span>
            {" · "}<span className="font-mono text-xs">{zone.code}</span>
            {" · "}{zone.occupancy}/{zone.maxConcurrentRobots}
          </div>
          <div className="grid gap-1">
            <Label>{t("fleet.deviceId", "Device id (robot)")}</Label>
            <Input
              type="number" min={1} value={deviceId}
              placeholder={t("fleet.deviceIdPlaceholder", "e.g. 1")}
              onChange={(e) => setDeviceId(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={queueIfFull}
              onChange={(e) => setQueueIfFull(e.target.checked)}
            />
            {t("fleet.queueIfFull", "Queue if zone is at capacity (otherwise reject)")}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}>
            <MapPin className="mr-1 h-4 w-4" />{t("fleet.reserve", "Reserve")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
