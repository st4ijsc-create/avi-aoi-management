/**
 * APS Scheduling Panel (G2.5b) — DRAFT-only APS workflow UI.
 *
 * SAFETY: Apply goes through applyScheduleRun (adminProcedure HITL) which only
 * updates production order plannedStart/End + lineId — it does NOT control any
 * machine/recipe. compareScheduleKpi is read-only (no DB writes). This component
 * never calls a command dispatcher.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { getActiveLocale } from "@/lib/format";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Cpu, Play, BarChart3, ShieldAlert, CheckCircle2, Eye } from "lucide-react";
import { toast } from "sonner";

const STATION_COLORS = [
  "#2563eb", "#16a34a", "#d97706", "#9333ea", "#dc2626", "#0891b2", "#ca8a04", "#db2777",
];

export default function ApsSchedulingPanel({ factoryId = 1 }: { factoryId?: number }) {
  const { t } = useTranslation();
  const { isAdmin } = usePermissions();
  const utils = trpc.useUtils();

  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  const { data: runs, isLoading: runsLoading, refetch: refetchRuns } =
    trpc.productionOrder.listScheduleRuns.useQuery({ factoryId, limit: 50 });

  const { data: runDetail, isLoading: detailLoading } =
    trpc.productionOrder.getScheduleRun.useQuery(
      { id: selectedRunId ?? 0 },
      { enabled: selectedRunId != null },
    );

  const generateMutation = trpc.productionOrder.generateApsScheduleRun.useMutation({
    onSuccess: (data: any) => {
      const mode = data?.solverMode === "cpsat"
        ? t("aps.modeCpsat", "CP-SAT")
        : t("aps.modeFallback", "Heuristic (fallback)");
      toast.success(t("aps.generated", "APS schedule generated (run #{{id}}) · {{mode}}", { id: data?.runId, mode }));
      if (data?.runId) setSelectedRunId(data.runId);
      refetchRuns();
    },
    onError: (err) => toast.error(err.message),
  });

  const applyMutation = trpc.productionOrder.applyScheduleRun.useMutation({
    onSuccess: (data: any) => {
      toast.success(t("aps.applied", "Applied {{count}} orders", { count: data?.applied || 0 }));
      refetchRuns();
      utils.productionOrder.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const dismissMutation = trpc.productionOrder.dismissScheduleRun.useMutation({
    onSuccess: () => {
      toast.success(t("aps.dismissed", "Run dismissed"));
      refetchRuns();
    },
    onError: (err) => toast.error(err.message),
  });

  // compareScheduleKpi is a query — fetched on demand via utils (read-only).
  const [compareData, setCompareData] = useState<any | null>(null);
  const [comparing, setComparing] = useState(false);

  const handleCompare = async () => {
    setComparing(true);
    try {
      const res = await utils.productionOrder.compareScheduleKpi.fetch({ factoryId });
      setCompareData(res);
    } catch (e: any) {
      toast.error(e?.message ?? "Compare failed");
    } finally {
      setComparing(false);
    }
  };

  const draftRuns = useMemo(
    () => (runs ?? []).filter((r: any) => r.status === "DRAFT"),
    [runs],
  );

  const compareChartData = useMemo(() => {
    if (!compareData) return [];
    return [
      {
        name: "APS",
        makespan: compareData.aps?.makespanHours ?? 0,
        lateOrders: compareData.aps?.lateOrders ?? 0,
      },
      {
        name: "FIFO",
        makespan: compareData.fifo?.makespanHours ?? 0,
        lateOrders: compareData.fifo?.lateOrders ?? 0,
      },
      {
        name: "Priority",
        makespan: compareData.priority?.makespanHours ?? 0,
        lateOrders: compareData.priority?.lateOrders ?? 0,
      },
    ];
  }, [compareData]);

  return (
    <div className="space-y-4">
      {/* Safety banner */}
      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>{t("aps.title", "Advanced Planning & Scheduling (APS)")}</AlertTitle>
        <AlertDescription>
          {t(
            "aps.safetyBanner",
            "APS only proposes a schedule. Applying updates the order plan only (it does NOT control machines/recipes — that goes through a separate HITL flow).",
          )}
        </AlertDescription>
      </Alert>

      {/* Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            {t("aps.description", "Optimize the schedule with CP-SAT (OR-Tools) — DRAFT proposals, applied via an approver")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => (generateMutation as any).mutate({ factoryId })}
              disabled={!isAdmin || generateMutation.isPending}
            >
              <Play className="h-4 w-4 mr-2" />
              {generateMutation.isPending
                ? t("aps.generating", "Generating...")
                : t("aps.generate", "Generate APS schedule")}
            </Button>
            <Button variant="outline" onClick={handleCompare} disabled={comparing}>
              <BarChart3 className="h-4 w-4 mr-2" />
              {comparing ? t("aps.comparing", "Comparing...") : t("aps.compareKpi", "Compare KPI")}
            </Button>
            {!isAdmin && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Eye className="h-3 w-3" />
                {t("aps.viewOnly", "You don't have permission to generate/apply schedules (view only).")}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* KPI compare */}
      {compareData && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("aps.kpiCompare", "KPI comparison: APS vs FIFO vs Priority")}</CardTitle>
            <CardDescription>{t("aps.kpiNote", "Read-only — no DB writes.")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={compareChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="left" dataKey="makespan" name={t("aps.makespan", "Makespan (h)")} fill="#2563eb" />
                  <Bar yAxisId="right" dataKey="lateOrders" name={t("aps.lateOrders", "Late orders")} fill="#dc2626" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* DRAFT runs list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("aps.runs", "APS schedule runs (DRAFT)")}</CardTitle>
        </CardHeader>
        <CardContent>
          {runsLoading ? (
            <Skeleton className="h-[200px] w-full" />
          ) : draftRuns.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              {t("aps.noRuns", 'No runs yet. Click "Generate APS schedule".')}
            </div>
          ) : (
            <div className="max-h-[40vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead>{t("aps.runId", "Run")}</TableHead>
                    <TableHead>{t("aps.algorithm", "Algorithm")}</TableHead>
                    <TableHead>{t("aps.solverMode", "Solver")}</TableHead>
                    <TableHead className="text-right">{t("aps.makespan", "Makespan (h)")}</TableHead>
                    <TableHead className="text-right">{t("aps.lateOrders", "Late orders")}</TableHead>
                    <TableHead className="text-right">{t("aps.scheduled", "Scheduled")}</TableHead>
                    <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {draftRuns.map((r: any) => {
                    const kpi = r.kpiSummary ?? {};
                    const isCpsat = kpi.solverMode === "cpsat";
                    return (
                      <TableRow
                        key={r.id}
                        className={selectedRunId === r.id ? "bg-muted/50" : "cursor-pointer"}
                        onClick={() => setSelectedRunId(r.id)}
                      >
                        <TableCell className="font-mono font-semibold">#{r.id}</TableCell>
                        <TableCell>{r.algorithm}</TableCell>
                        <TableCell>
                          <Badge variant={isCpsat ? "default" : "secondary"}>
                            {isCpsat ? t("aps.modeCpsat", "CP-SAT") : t("aps.modeFallback", "Heuristic (fallback)")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">{kpi.makespanHours ?? "-"}</TableCell>
                        <TableCell className="text-right font-mono">
                          {kpi.lateOrders != null ? (
                            <span className={kpi.lateOrders > 0 ? "text-red-500" : ""}>{kpi.lateOrders}</span>
                          ) : "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {kpi.scheduledOrders ?? "-"}/{kpi.totalOrders ?? "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            <Button size="sm" variant="ghost" onClick={() => setSelectedRunId(r.id)}>
                              {t("aps.loadDetail", "View Gantt")}
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="default" disabled={!isAdmin || applyMutation.isPending}>
                                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                  {t("aps.apply", "Apply")}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>{t("aps.applyConfirmTitle", "Apply this schedule?")}</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {t(
                                      "aps.applyConfirmDescription",
                                      "Applying this schedule updates the production order plan (plannedStart/End + line). It does NOT control machines.",
                                    )}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => (applyMutation as any).mutate({ runId: r.id })}
                                  >
                                    {t("aps.apply", "Apply")}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!isAdmin || dismissMutation.isPending}
                              onClick={() => (dismissMutation as any).mutate({ runId: r.id })}
                            >
                              {t("aps.dismiss", "Dismiss")}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Gantt by station */}
      {selectedRunId != null && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              {t("aps.gantt", "Gantt by station")} — #{selectedRunId}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {detailLoading ? (
              <Skeleton className="h-[240px] w-full" />
            ) : (
              <StationGantt items={(runDetail as any)?.items ?? []} t={t} />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Simple per-station timeline Gantt rendered as proportional divs. */
function StationGantt({ items, t }: { items: any[]; t: any }) {
  const rows = useMemo(() => {
    if (!items.length) return [];
    const min = Math.min(...items.map((i) => new Date(i.suggestedStart).getTime()));
    const max = Math.max(...items.map((i) => new Date(i.suggestedEnd).getTime()));
    const span = Math.max(1, max - min);

    const byStation = new Map<string, any[]>();
    for (const it of items) {
      const key = it.stationId != null ? String(it.stationId) : "__none__";
      if (!byStation.has(key)) byStation.set(key, []);
      byStation.get(key)!.push(it);
    }
    return Array.from(byStation.entries()).map(([key, list], idx) => ({
      key,
      stationId: key === "__none__" ? null : Number(key),
      color: STATION_COLORS[idx % STATION_COLORS.length],
      bars: list
        .slice()
        .sort((a, b) => (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0))
        .map((it) => {
          const s = new Date(it.suggestedStart).getTime();
          const e = new Date(it.suggestedEnd).getTime();
          return {
            ...it,
            leftPct: ((s - min) / span) * 100,
            widthPct: Math.max(1, ((e - s) / span) * 100),
          };
        }),
    }));
  }, [items]);

  if (!items.length) {
    return <div className="text-sm text-muted-foreground py-6 text-center">{t("aps.noItems", "No schedule items to display.")}</div>;
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.key} className="flex items-center gap-3">
          <div className="w-28 shrink-0 text-sm font-medium">
            {row.stationId != null
              ? `${t("aps.station", "Station")} ${row.stationId}`
              : t("aps.noStation", "No station assigned")}
          </div>
          <div className="relative flex-1 h-9 rounded bg-muted/40">
            {row.bars.map((b: any, i: number) => (
              <div
                key={i}
                className="absolute top-1 bottom-1 rounded px-2 text-[11px] text-white flex items-center overflow-hidden whitespace-nowrap"
                style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%`, backgroundColor: row.color }}
                title={`#${b.productionOrderId} · ${new Date(b.suggestedStart).toLocaleString(getActiveLocale())} → ${new Date(b.suggestedEnd).toLocaleString(getActiveLocale())}${b.setupMinutes ? ` · ${t("aps.setup", "Changeover: {{min}} min", { min: b.setupMinutes })}` : ""}`}
              >
                {b.sequenceIndex != null && (
                  <span className="opacity-80 mr-1">{t("aps.seq", "#")}{b.sequenceIndex}</span>
                )}
                #{b.productionOrderId}
                {b.setupMinutes ? <span className="ml-1 opacity-80">(+{b.setupMinutes}m)</span> : null}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
