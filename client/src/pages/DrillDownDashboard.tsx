/**
 * doc 46 FE-W3.2 — DRILL-DOWN DASHBOARD (the interactive Corporate→Machine spine).
 *
 * ONE consistent hierarchical drill-down over the `drillDown.*` router:
 *   Corporate → Factory → (Workshop*) → Line → (Station*) → Machine
 *
 * Each tier shows its real inspection KPI rollup (Output / OK / NG / Yield). The
 * drill is a continuous NAVIGATION SPINE, not a dead-end dashboard: clicking a
 * node continues drilling, a Line row exposes "Open Line View →" (/line-view/:id)
 * and a Machine row "Open Cockpit →" (/machine/:id).
 *
 * HONEST-DEGRADATION: (*) the Workshop & Station tiers are NOT rolled up by the
 * drillDown backend — `linesByFactory` collapses workshops (no workshopId in its
 * output) and `machinesByLine` collapses stations (no stationId) — so those two
 * tiers are shown in the canonical spine but carry NO fabricated numbers. OEE is
 * likewise not part of this inspection-based rollup, so it is not displayed.
 *
 * Realtime: U1 socket-first (invalidate drillDown on inspection/ng/yield/quality
 * events, debounced) + a 60s poll fallback so the numbers never freeze.
 */
import { useMemo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import DashboardLayout from "@/components/DashboardLayout";
import { RelatedViews } from "@/components/RelatedViews";
import {
  useEcosystemEvents,
  type EcosystemEvent,
  type EcosystemKind,
} from "@/hooks/useEcosystemEvents";
import {
  MetricCard,
  EmptyState,
  SectionCard,
  chartTooltipStyle,
  chartGridProps,
  chartAxisTick,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import {
  DrillSpine,
  type DrillLevel,
  type DrillDownState,
} from "@/components/drilldown/DrillSpine";
import { DrillNode, type DrillRow } from "@/components/drilldown/DrillNode";
import {
  Building2,
  Factory,
  GitBranch,
  Cpu,
  TrendingUp,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity,
  BarChart3,
  Info,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

// ── Typesafe drillDown router output shapes (converged to the CommandCenter
//    pattern: inferred router types instead of `any`). ─────────────────────────
type RouterOutputs = inferRouterOutputs<AppRouter>;
type CorporateStat = RouterOutputs["drillDown"]["corporateStats"][number];
type FactoryStat = RouterOutputs["drillDown"]["factoriesByCorporate"][number];
type LineStat = RouterOutputs["drillDown"]["linesByFactory"][number];
type MachineStat = RouterOutputs["drillDown"]["machinesByLine"][number];
type AnyStat = CorporateStat | FactoryStat | LineStat | MachineStat;

/**
 * U1 (ecosystem:event) kinds that move drill-down production numbers (OK/NG/NTF/
 * yield). These are the real inspection/NG/yield/quality-gate alert-layer kinds
 * in the server stream; routine inspections often don't hit this stream, so the
 * 60s poll fallback keeps background freshness.
 */
const DRILLDOWN_EVENT_KINDS: ReadonlySet<EcosystemKind> = new Set<EcosystemKind>([
  "inspection",
  "ng",
  "yield",
  "quality_gate",
]);

/** Normalise any tier's stat into the shared KPI row. */
function toRow(item: AnyStat): DrillRow {
  const id = "id" in item ? item.id : undefined;
  return {
    key: String(id ?? item.code ?? item.name),
    id,
    code: item.code,
    name: item.name,
    total: item.total ?? 0,
    ok: item.ok ?? 0,
    ng: item.ng ?? 0,
    ntf: item.ntf ?? 0,
    yieldRate: item.yieldRate ?? (item.total > 0 ? (item.ok / item.total) * 100 : 0),
  };
}

export default function DrillDownDashboard(): React.JSX.Element {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [drillState, setDrillState] = useState<DrillDownState>({ level: "corporate" });

  // ── Queries per level. Realtime = socket-first (U1 invalidate); refetchInterval
  //    60s is the POLL FALLBACK so an enabled level never freezes if the socket
  //    drops. Only the enabled level polls. ────────────────────────────────────
  const { data: corporateStats, isLoading: corporateLoading } = trpc.drillDown.corporateStats.useQuery(
    undefined,
    { enabled: drillState.level === "corporate", refetchInterval: 60_000 },
  );
  const { data: factoryStats, isLoading: factoryLoading } = trpc.drillDown.factoriesByCorporate.useQuery(
    { corporateCode: drillState.corporateCode! },
    { enabled: drillState.level === "factory" && !!drillState.corporateCode, refetchInterval: 60_000 },
  );
  const { data: lineStats, isLoading: lineLoading } = trpc.drillDown.linesByFactory.useQuery(
    { factoryId: drillState.factoryId! },
    { enabled: drillState.level === "line" && !!drillState.factoryId, refetchInterval: 60_000 },
  );
  const { data: machineStats, isLoading: machineLoading } = trpc.drillDown.machinesByLine.useQuery(
    { lineId: drillState.lineId! },
    { enabled: drillState.level === "machine" && !!drillState.lineId, refetchInterval: 60_000 },
  );

  // ── Realtime U1: socket-first + poll fallback ──
  const utils = trpc.useUtils();
  const invalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleDrillRefresh = useCallback(() => {
    if (invalidateTimer.current) clearTimeout(invalidateTimer.current);
    invalidateTimer.current = setTimeout(() => {
      void utils.drillDown.invalidate();
    }, 1_500);
  }, [utils]);
  const onEcoEvent = useCallback(
    (evt: EcosystemEvent) => {
      if (DRILLDOWN_EVENT_KINDS.has(evt.kind)) scheduleDrillRefresh();
    },
    [scheduleDrillRefresh],
  );
  const { isConnected: liveConnected } = useEcosystemEvents({ onEvent: onEcoEvent });
  useEffect(
    () => () => {
      if (invalidateTimer.current) clearTimeout(invalidateTimer.current);
    },
    [],
  );

  // ── Navigation within the drill ──
  const handleNavigate = useCallback((level: DrillLevel, data?: Partial<DrillDownState>) => {
    if (level === "corporate") setDrillState({ level: "corporate" });
    else setDrillState({ level, ...data } as DrillDownState);
  }, []);

  const drillInto = useCallback((row: DrillRow) => {
    setDrillState((prev) => {
      if (prev.level === "corporate") {
        return { level: "factory", corporateCode: row.code, corporateName: row.name };
      }
      if (prev.level === "factory") {
        return { ...prev, level: "line", factoryId: row.id, factoryName: row.name };
      }
      if (prev.level === "line") {
        return { ...prev, level: "machine", lineId: row.id, lineName: row.name };
      }
      return prev;
    });
  }, []);

  // ── Leaf-out navigation (continuous spine) ──
  const openLineView = useCallback((lineId: number) => setLocation(`/line-view/${lineId}`), [setLocation]);
  const openCockpit = useCallback((machineId: number) => setLocation(`/machine/${machineId}`), [setLocation]);

  // ── Current level's rows + rollup ──
  const rows = useMemo<DrillRow[]>(() => {
    let data: AnyStat[] = [];
    if (drillState.level === "corporate" && corporateStats) data = corporateStats;
    else if (drillState.level === "factory" && factoryStats) data = factoryStats;
    else if (drillState.level === "line" && lineStats) data = lineStats;
    else if (drillState.level === "machine" && machineStats) data = machineStats;
    return data.map(toRow);
  }, [drillState.level, corporateStats, factoryStats, lineStats, machineStats]);

  const rollup = useMemo(() => {
    let total = 0, ok = 0, ng = 0, ntf = 0;
    for (const r of rows) {
      total += r.total;
      ok += r.ok;
      ng += r.ng;
      ntf += r.ntf;
    }
    return { total, ok, ng, ntf, yieldRate: total > 0 ? (ok / total) * 100 : 0 };
  }, [rows]);

  const isLoading = corporateLoading || factoryLoading || lineLoading || machineLoading;
  const maxValue = Math.max(...rows.map((r) => r.total), 1);

  const pieData = [
    { name: "OK", value: rollup.ok, color: "var(--success)" },
    { name: "NG", value: rollup.ng, color: "var(--destructive)" },
    { name: "NTF", value: rollup.ntf, color: "var(--warning)" },
  ].filter((d) => d.value > 0);

  // ── Level presentation (title + node icon + how a row behaves) ──
  const levelMeta = {
    corporate: {
      title: t("dashboard.drill.corporatesTitle", "All corporates"),
      icon: <Building2 className="h-4 w-4" />,
      hint: t("dashboard.clickToViewDetails", "Click to view details"),
    },
    factory: {
      title: t("dashboard.drill.factoriesTitle", "Factories in {{name}}", {
        name: drillState.corporateName || drillState.corporateCode,
      }),
      icon: <Factory className="h-4 w-4" />,
      hint: t("dashboard.clickToViewDetails", "Click to view details"),
    },
    line: {
      title: t("dashboard.drill.linesTitle", "Lines in {{name}}", { name: drillState.factoryName }),
      icon: <GitBranch className="h-4 w-4" />,
      hint: t("dashboard.drill.lineHint", "Drill into this line's machines, or open the full Line View."),
    },
    machine: {
      title: t("dashboard.drill.machinesTitle", "Machines in {{name}}", { name: drillState.lineName }),
      icon: <Cpu className="h-4 w-4" />,
      hint: t("dashboard.drill.machineHint", "Machine is the leaf tier — open its cockpit for full detail."),
    },
  }[drillState.level];

  // Build the correct per-row behaviour for the active tier.
  const rowFor = (row: DrillRow) => {
    if (drillState.level === "line") {
      return {
        onDrill: () => drillInto(row),
        leafAction:
          row.id != null
            ? {
                label: t("dashboard.drill.openLineView", "Open Line View"),
                ariaLabel: t("dashboard.drill.openLineViewAria", "Open Line View for {{name}}", { name: row.name }),
                onClick: () => openLineView(row.id!),
              }
            : undefined,
      };
    }
    if (drillState.level === "machine") {
      // Leaf tier: the whole row opens the cockpit (no deeper drill).
      return {
        onDrill: undefined,
        leafAction:
          row.id != null
            ? {
                label: t("dashboard.drill.openCockpit", "Open Cockpit"),
                ariaLabel: t("dashboard.drill.openCockpitAria", "Open cockpit for {{name}}", { name: row.name }),
                onClick: () => openCockpit(row.id!),
              }
            : undefined,
      };
    }
    // corporate / factory: click continues drilling, no leaf-out.
    return { onDrill: () => drillInto(row), leafAction: undefined };
  };

  return (
    <DashboardLayout title={t("dashboard.drillDownDashboard", "Drill down dashboard")}>
      <div className="space-y-6">
        {/* Canonical spine: breadcrumb + 6-tier stepper (honest degradation) */}
        <DrillSpine state={drillState} onNavigate={handleNavigate} live={liveConnected} />

        {/* U7 cross-links — the Command Center offers the live hierarchy TREE +
            factory twin of the same estate; this page is the interactive drill. */}
        <RelatedViews
          links={[
            { href: "/command-center", labelKey: "nav.commandCenter", labelDefault: "Command Center" },
            { href: "/corporate-dashboard", labelKey: "nav.corporateDashboard", labelDefault: "Corporate Dashboard" },
          ]}
        />

        {/* Summary rollup — real inspection metrics only (no fabricated OEE). */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label={t("dashboard.totalProduction", "Output")}
            value={rollup.total.toLocaleString()}
            icon={<Activity className="h-5 w-5" />}
            tone="info"
          />
          <MetricCard
            label={t("dashboard.okProducts", "OK")}
            value={rollup.ok.toLocaleString()}
            delta={`${((rollup.ok / rollup.total) * 100 || 0).toFixed(1)}%`}
            icon={<CheckCircle2 className="h-5 w-5" />}
            tone="good"
          />
          <MetricCard
            label={t("dashboard.ngProducts", "NG")}
            value={rollup.ng.toLocaleString()}
            delta={`${((rollup.ng / rollup.total) * 100 || 0).toFixed(1)}%`}
            icon={<XCircle className="h-5 w-5" />}
            tone="danger"
          />
          <MetricCard
            label={t("dashboard.yieldRate", "Yield")}
            value={`${rollup.yieldRate.toFixed(2)}%`}
            icon={<TrendingUp className="h-5 w-5" />}
            tone={rollup.yieldRate >= 95 ? "good" : rollup.yieldRate >= 90 ? "warning" : "danger"}
          />
        </div>

        {/* Honest note on rollup source */}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t(
            "dashboard.drill.metricsSource",
            "Rollup from inspection results (OK / NG / NTF). OEE isn't part of this inspection-based drill.",
          )}
        </p>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Main drill-down list */}
          <div className="lg:col-span-2">
            <SectionCard
              icon={<BarChart3 className="h-5 w-5" />}
              title={levelMeta.title}
              description={levelMeta.hint}
            >
              {isLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-24 w-full" />
                  ))}
                </div>
              ) : rows.length === 0 ? (
                <EmptyState variant="no-data" icon={AlertTriangle} title={t("common.noData", "No data")} compact />
              ) : (
                <div className="space-y-3">
                  {rows.map((row) => {
                    const behaviour = rowFor(row);
                    return (
                      <DrillNode
                        key={row.key}
                        data={row}
                        maxValue={maxValue}
                        icon={levelMeta.icon}
                        onDrill={behaviour.onDrill}
                        leafAction={behaviour.leafAction}
                      />
                    );
                  })}
                </div>
              )}
            </SectionCard>
          </div>

          {/* Pie + quick stats */}
          <div className="space-y-4">
            <SectionCard title={t("dashboard.resultDistribution", "Result distribution")}>
              {isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : pieData.length === 0 ? (
                <div className="flex h-64 items-center justify-center text-muted-foreground">
                  {t("common.noData", "No data")}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={chartTooltipStyle} formatter={(value: number) => value.toLocaleString()} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            <SectionCard title={t("dashboard.quickStats", "Quick stats")}>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{t("common.quantity", "Quantity")}</span>
                  <Badge variant="outline">{rows.length}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{t("dashboard.highestYield", "Highest yield")}</span>
                  <Badge variant="default">{Math.max(...rows.map((r) => r.yieldRate), 0).toFixed(1)}%</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{t("dashboard.lowestYield", "Lowest yield")}</span>
                  <Badge variant="destructive">
                    {rows.length > 0 ? Math.min(...rows.map((r) => r.yieldRate)).toFixed(1) : 0}%
                  </Badge>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>

        {/* Bar chart comparison */}
        <SectionCard title={t("dashboard.productionComparison", "Production comparison")}>
          {isLoading ? (
            <Skeleton className="h-80 w-full" />
          ) : rows.length === 0 ? (
            <div className="flex h-80 items-center justify-center text-muted-foreground">
              {t("common.noData", "No data")}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={rows.slice(0, 10)}>
                <CartesianGrid {...chartGridProps} />
                <XAxis dataKey="name" tick={chartAxisTick} interval={0} angle={-45} textAnchor="end" height={80} />
                <YAxis tick={chartAxisTick} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(value: number) => value.toLocaleString()} />
                <Legend />
                <Bar dataKey="ok" name="OK" fill="var(--success)" />
                <Bar dataKey="ng" name="NG" fill="var(--destructive)" />
                <Bar dataKey="ntf" name="NTF" fill="var(--warning)" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>
    </DashboardLayout>
  );
}
