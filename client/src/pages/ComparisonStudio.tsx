/**
 * doc 46 FE-W3.3 — Comparison Studio (multi-dimensional comparison).
 *
 * ONE consolidated tool to compare production/quality metrics across four axes:
 *   • Line    — inspection rollup per production line (productionDashboard.getStationOverview,
 *               aggregated station→line): FPY / Final Yield / NG Rate / Output / Throughput.
 *   • Shift   — real shift compare (warRoom.briefing.shiftCompare): OEE / NG Rate / Output.
 *   • Product — per-product yield (reportAggregators.yieldByProduct): FPY / Final Yield /
 *               NG Rate / Output / Throughput.
 *   • Period  — this-vs-previous window (dataComparison.compare): FPY / NG Rate / Output /
 *               Throughput (pairwise — the backend supplies exactly current+previous).
 *
 * Supersedes the three scattered comparison surfaces (DataComparison / ProductComparison /
 * HistoryComparison) with a single dimension picker + side-by-side cards + a focus-metric
 * comparison bar chart (with an optional benchmark/target reference line) + a delta table
 * (A vs B, +/- and % diff) + a font-safe ExportMenu (FE-W2).
 *
 * HONEST-DEGRADATION: the metric picker only offers metrics the ACTIVE dimension's feed can
 * supply; a value the backend does not return renders "—" (never fabricated). OEE, for
 * example, is only carried by the Shift feed and is null in the current Full-Sim env.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  PageHeader,
  EmptyState,
  FactorySelect,
  chartColor,
  chartTooltipStyle,
  chartGridProps,
  chartAxisTick,
} from "@/components/patterns";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumnSpec } from "@/lib/serverReportExport";
import { trpc } from "@/lib/trpc";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, LabelList,
} from "recharts";
import {
  GitCompare, Layers, Clock, Package, CalendarRange, ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";

// ────────────────────────────────────────────────────────────────────────────
// Model
// ────────────────────────────────────────────────────────────────────────────

type DimensionId = "line" | "shift" | "product" | "period";
type MetricId = "oee" | "fpy" | "finalYield" | "ngRate" | "output" | "throughput";
type BenchmarkMode = "none" | "best" | "average" | "target";

interface MetricDef {
  id: MetricId;
  labelKey: string;
  kind: "percent" | "count" | "rate";
  higherIsBetter: boolean;
}

const METRICS: Record<MetricId, MetricDef> = {
  oee: { id: "oee", labelKey: "comparisonStudio.metricOee", kind: "percent", higherIsBetter: true },
  fpy: { id: "fpy", labelKey: "comparisonStudio.metricFpy", kind: "percent", higherIsBetter: true },
  finalYield: { id: "finalYield", labelKey: "comparisonStudio.metricFinalYield", kind: "percent", higherIsBetter: true },
  ngRate: { id: "ngRate", labelKey: "comparisonStudio.metricNgRate", kind: "percent", higherIsBetter: false },
  output: { id: "output", labelKey: "comparisonStudio.metricOutput", kind: "count", higherIsBetter: true },
  throughput: { id: "throughput", labelKey: "comparisonStudio.metricThroughput", kind: "rate", higherIsBetter: true },
};

/** A normalized entity to compare (a line / shift / product / period). */
interface EntitySeries {
  id: string;
  label: string;
  sublabel?: string;
  metrics: Partial<Record<MetricId, number | null>>;
}

/** The active dimension's resolved data. */
interface DimensionData {
  availableMetrics: MetricId[];
  entities: EntitySeries[];
  /** period is a fixed pair — no user entity selection. */
  fixedEntities: boolean;
  isLoading: boolean;
  isError: boolean;
}

const DIMENSIONS: { id: DimensionId; labelKey: string; icon: React.ReactNode }[] = [
  { id: "line", labelKey: "comparisonStudio.dimLine", icon: <Layers className="h-4 w-4" /> },
  { id: "shift", labelKey: "comparisonStudio.dimShift", icon: <Clock className="h-4 w-4" /> },
  { id: "product", labelKey: "comparisonStudio.dimProduct", icon: <Package className="h-4 w-4" /> },
  { id: "period", labelKey: "comparisonStudio.dimPeriod", icon: <CalendarRange className="h-4 w-4" /> },
];

const MAX_ENTITIES = 4;
const MIN_ENTITIES = 2;

// ────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ────────────────────────────────────────────────────────────────────────────

function fmtMetric(kind: MetricDef["kind"], v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  if (kind === "percent") return `${v.toFixed(2)}%`;
  if (kind === "rate") return v.toFixed(1);
  return Math.round(v).toLocaleString();
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoStr(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

/** Current window for a period preset (mirrors DataComparison.tsx). */
function currentWindow(period: "week" | "month" | "quarter"): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  let start: Date;
  switch (period) {
    case "week": {
      const dow = now.getDay();
      const mondayOffset = dow === 0 ? -6 : 1 - dow;
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset, 0, 0, 0);
      break;
    }
    case "month":
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      break;
    case "quarter": {
      const qm = Math.floor(now.getMonth() / 3) * 3;
      start = new Date(now.getFullYear(), qm, 1, 0, 0, 0);
      break;
    }
  }
  return { start, end };
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export function ComparisonStudioContent(): React.JSX.Element {
  const { t } = useTranslation();

  const [dimension, setDimension] = useState<DimensionId>("line");
  const [factoryId, setFactoryId] = useState<number | null>(null);
  const [rangeFrom, setRangeFrom] = useState<string>(daysAgoStr(7));
  const [rangeTo, setRangeTo] = useState<string>(todayStr());
  const [shiftDate, setShiftDate] = useState<string>(todayStr());
  const [periodType, setPeriodType] = useState<"week" | "month" | "quarter">("week");

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedMetrics, setSelectedMetrics] = useState<MetricId[] | null>(null); // null = all available
  const [focusMetric, setFocusMetric] = useState<MetricId | null>(null);
  const [benchmark, setBenchmark] = useState<BenchmarkMode>("best");
  const [targetValue, setTargetValue] = useState<string>("");

  const factoryScope = factoryId ?? undefined;

  // Window Date objects for the inspection-window dimensions (line/product).
  const winStart = useMemo(() => new Date(`${rangeFrom}T00:00:00`), [rangeFrom]);
  const winEnd = useMemo(() => new Date(`${rangeTo}T23:59:59`), [rangeTo]);
  const windowHours = useMemo(
    () => Math.max(1, (winEnd.getTime() - winStart.getTime()) / 3_600_000),
    [winStart, winEnd],
  );

  // ── Data feeds — all four hooks are always called (rules of hooks); only the
  //    active dimension's query is enabled, the rest stay idle. ────────────────
  const lineQ = trpc.productionDashboard.getStationOverview.useQuery(
    { factoryId: factoryScope, startDate: winStart, endDate: winEnd },
    { enabled: dimension === "line" },
  );

  const shiftQ = trpc.warRoom.briefing.useQuery(
    { factoryId: factoryScope, date: new Date(`${shiftDate}T00:00:00`).toISOString() },
    { enabled: dimension === "shift" },
  );

  const productQ = trpc.reportAggregators.yieldByProduct.useQuery(
    { startDate: rangeFrom, endDate: rangeTo, factoryId: factoryScope },
    { enabled: dimension === "product" },
  );

  const periodWin = useMemo(() => currentWindow(periodType), [periodType]);
  const periodQ = trpc.dataComparison.compare.useQuery(
    { periodType, currentStart: periodWin.start, currentEnd: periodWin.end, factoryId: factoryScope },
    { enabled: dimension === "period" },
  );

  // ── Normalize the active dimension into a common shape. ─────────────────────
  const data: DimensionData = useMemo(() => {
    if (dimension === "line") {
      const rows = lineQ.data ?? [];
      // Aggregate station rows → line.
      const byLine = new Map<number, { name: string; total: number; ok: number; ng: number; ntf: number; output: number }>();
      for (const r of rows as any[]) {
        const lid = r.line?.id;
        if (lid == null) continue;
        const acc = byLine.get(lid) ?? { name: r.line?.name ?? `#${lid}`, total: 0, ok: 0, ng: 0, ntf: 0, output: 0 };
        acc.total += Number(r.totalInspections) || 0;
        acc.ok += Number(r.okCount) || 0;
        acc.ng += Number(r.ngCount) || 0;
        acc.ntf += Number(r.ntfCount) || 0;
        acc.output += Number(r.output) || 0;
        byLine.set(lid, acc);
      }
      const entities: EntitySeries[] = [...byLine.entries()]
        .map(([lid, a]) => ({
          id: `line:${lid}`,
          label: a.name,
          metrics: {
            fpy: a.total > 0 ? (a.ok / a.total) * 100 : null,
            finalYield: a.total > 0 ? ((a.ok + a.ntf) / a.total) * 100 : null,
            ngRate: a.total > 0 ? (a.ng / a.total) * 100 : null,
            output: a.output,
            throughput: a.output > 0 ? a.output / windowHours : null,
          } as Partial<Record<MetricId, number | null>>,
        }))
        .sort((x, y) => (y.metrics.output ?? 0) - (x.metrics.output ?? 0));
      return {
        availableMetrics: ["fpy", "finalYield", "ngRate", "output", "throughput"],
        entities,
        fixedEntities: false,
        isLoading: lineQ.isLoading && lineQ.fetchStatus !== "idle",
        isError: lineQ.isError,
      };
    }

    if (dimension === "shift") {
      const sc = (shiftQ.data?.shiftCompare ?? []) as Array<{ shiftLabel: string; oee: number | null; output: number; ngRate: number | null }>;
      const entities: EntitySeries[] = sc.map((s, i) => ({
        id: `shift:${s.shiftLabel}:${i}`,
        label: s.shiftLabel,
        metrics: { oee: s.oee, ngRate: s.ngRate, output: s.output },
      }));
      return {
        availableMetrics: ["oee", "ngRate", "output"],
        entities,
        fixedEntities: false,
        isLoading: shiftQ.isLoading && shiftQ.fetchStatus !== "idle",
        isError: shiftQ.isError,
      };
    }

    if (dimension === "product") {
      const rows = (productQ.data ?? []) as Array<{ productModelId: number | null; productCode: string | null; productName: string | null; total: number; ok: number; ng: number; ntf: number; yieldRate: number }>;
      const entities: EntitySeries[] = rows.map((r) => ({
        id: `product:${r.productModelId ?? "null"}`,
        label: r.productName ?? r.productCode ?? t("comparisonStudio.unassignedProduct"),
        sublabel: r.productCode ?? undefined,
        metrics: {
          fpy: r.total > 0 ? (r.ok / r.total) * 100 : null,
          finalYield: r.yieldRate,
          ngRate: r.total > 0 ? (r.ng / r.total) * 100 : null,
          output: r.total,
          throughput: r.total > 0 ? r.total / windowHours : null,
        },
      }));
      return {
        availableMetrics: ["fpy", "finalYield", "ngRate", "output", "throughput"],
        entities,
        fixedEntities: false,
        isLoading: productQ.isLoading && productQ.fetchStatus !== "idle",
        isError: productQ.isError,
      };
    }

    // period — fixed pair (previous baseline, then current).
    const c = periodQ.data;
    const periodHours = Math.max(1, (periodWin.end.getTime() - periodWin.start.getTime()) / 3_600_000);
    const mk = (label: string, sub: string | undefined, s?: { totalInspections: number; yieldRate: number; ngRate: number }): EntitySeries => ({
      id: label,
      label,
      sublabel: sub,
      metrics: s
        ? {
            fpy: s.yieldRate,
            ngRate: s.ngRate,
            output: s.totalInspections,
            throughput: s.totalInspections > 0 ? s.totalInspections / periodHours : null,
          }
        : {},
    });
    const entities: EntitySeries[] = c
      ? [
          mk(t("comparisonStudio.previousPeriod"), c.previousPeriod.start.slice(0, 10), c.previousPeriod.summary),
          mk(t("comparisonStudio.currentPeriod"), c.currentPeriod.start.slice(0, 10), c.currentPeriod.summary),
        ]
      : [];
    return {
      availableMetrics: ["fpy", "ngRate", "output", "throughput"],
      entities,
      fixedEntities: true,
      isLoading: periodQ.isLoading && periodQ.fetchStatus !== "idle",
      isError: periodQ.isError,
    };
  }, [dimension, lineQ.data, lineQ.isLoading, lineQ.fetchStatus, lineQ.isError, shiftQ.data, shiftQ.isLoading, shiftQ.fetchStatus, shiftQ.isError, productQ.data, productQ.isLoading, productQ.fetchStatus, productQ.isError, periodQ.data, periodQ.isLoading, periodQ.fetchStatus, periodQ.isError, windowHours, periodWin, t]);

  // ── Derived selections (reconciled against the current dimension's data). ───
  const activeMetrics: MetricId[] = useMemo(() => {
    const wanted = selectedMetrics ?? data.availableMetrics;
    const filtered = wanted.filter((m) => data.availableMetrics.includes(m));
    return filtered.length > 0 ? filtered : data.availableMetrics;
  }, [selectedMetrics, data.availableMetrics]);

  const selectedEntities: EntitySeries[] = useMemo(() => {
    if (data.fixedEntities) return data.entities;
    const chosen = data.entities.filter((e) => selectedIds.includes(e.id));
    return chosen;
  }, [data.entities, data.fixedEntities, selectedIds]);

  const activeFocus: MetricId = useMemo(() => {
    if (focusMetric && activeMetrics.includes(focusMetric)) return focusMetric;
    const firstPercent = activeMetrics.find((m) => METRICS[m].kind === "percent");
    return firstPercent ?? activeMetrics[0];
  }, [focusMetric, activeMetrics]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  function changeDimension(d: DimensionId) {
    setDimension(d);
    setSelectedIds([]);
    setSelectedMetrics(null);
    setFocusMetric(null);
  }
  function toggleEntity(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_ENTITIES) return prev;
      return [...prev, id];
    });
  }
  function toggleMetric(m: MetricId) {
    setSelectedMetrics((prev) => {
      const base = prev ?? data.availableMetrics;
      if (base.includes(m)) {
        const next = base.filter((x) => x !== m);
        return next.length > 0 ? next : base; // keep at least one
      }
      return [...base, m];
    });
  }

  const ready = selectedEntities.length >= MIN_ENTITIES;
  const baseline = selectedEntities[0];

  // ── Benchmark value for the focus-metric chart. ─────────────────────────────
  const focusDef = activeFocus ? METRICS[activeFocus] : null;
  const benchmarkValue: number | null = useMemo(() => {
    if (!focusDef || !ready) return null;
    if (benchmark === "target") {
      const v = parseFloat(targetValue);
      return Number.isFinite(v) ? v : null;
    }
    const vals = selectedEntities.map((e) => e.metrics[activeFocus]).filter((v): v is number => v != null);
    if (vals.length === 0) return null;
    if (benchmark === "average") return vals.reduce((a, b) => a + b, 0) / vals.length;
    if (benchmark === "best") return focusDef.higherIsBetter ? Math.max(...vals) : Math.min(...vals);
    return null;
  }, [benchmark, targetValue, focusDef, ready, selectedEntities, activeFocus]);

  const chartData = useMemo(
    () => selectedEntities.map((e) => ({ name: e.label, value: e.metrics[activeFocus] ?? null })),
    [selectedEntities, activeFocus],
  );

  // ── Export (font-safe, FE-W2 ExportMenu). ───────────────────────────────────
  const exportColumns: ExportColumnSpec[] = useMemo(() => {
    const cols: ExportColumnSpec[] = [{ key: "metric", header: t("comparisonStudio.metric"), format: "text" }];
    selectedEntities.forEach((e, i) => cols.push({ key: `e${i}`, header: e.label, format: "text" }));
    if (selectedEntities.length === 2) {
      cols.push({ key: "delta", header: t("comparisonStudio.delta"), format: "text" });
      cols.push({ key: "pct", header: t("comparisonStudio.percentDiff"), format: "text" });
    }
    return cols;
  }, [selectedEntities, t]);

  const exportData: Record<string, unknown>[] = useMemo(() => {
    return activeMetrics.map((m) => {
      const def = METRICS[m];
      const row: Record<string, unknown> = { metric: t(def.labelKey) };
      selectedEntities.forEach((e, i) => {
        row[`e${i}`] = fmtMetric(def.kind, e.metrics[m]);
      });
      if (selectedEntities.length === 2) {
        const a = selectedEntities[0].metrics[m];
        const b = selectedEntities[1].metrics[m];
        if (a != null && b != null) {
          const d = b - a;
          row.delta = `${d >= 0 ? "+" : ""}${def.kind === "count" ? Math.round(d).toLocaleString() : d.toFixed(2)}`;
          row.pct = a !== 0 ? `${d >= 0 ? "+" : ""}${((d / Math.abs(a)) * 100).toFixed(1)}%` : "—";
        } else {
          row.delta = "—";
          row.pct = "—";
        }
      }
      return row;
    });
  }, [activeMetrics, selectedEntities, t]);

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6">
      <PageHeader
        icon={<GitCompare className="h-6 w-6" />}
        title={t("comparisonStudio.title")}
        description={t("comparisonStudio.description")}
        actions={
          <ExportMenu
            title={t("comparisonStudio.title")}
            subtitle={`${t(DIMENSIONS.find((d) => d.id === dimension)!.labelKey)}`}
            type="comparison_studio"
            fileName="comparison_studio"
            columns={exportColumns}
            data={exportData}
            disabled={!ready}
          />
        }
      />

      {/* 1 — Dimension picker */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">{t("comparisonStudio.dimension")}</Label>
            <div className="flex flex-wrap gap-2">
              {DIMENSIONS.map((d) => (
                <Button
                  key={d.id}
                  size="sm"
                  variant={dimension === d.id ? "default" : "outline"}
                  onClick={() => changeDimension(d.id)}
                  className="gap-1.5"
                >
                  {d.icon}
                  {t(d.labelKey)}
                </Button>
              ))}
            </div>
          </div>

          {/* Scope controls — contextual to the dimension */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("comparisonStudio.factory")}</Label>
              <FactorySelect
                value={factoryId}
                onChange={(v) => setFactoryId(v == null ? null : Number(v))}
                placeholder={t("common.all")}
              />
            </div>

            {(dimension === "line" || dimension === "product") && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">{t("comparisonStudio.dateFrom")}</Label>
                  <Input type="date" value={rangeFrom} max={rangeTo} onChange={(e) => setRangeFrom(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("comparisonStudio.dateTo")}</Label>
                  <Input type="date" value={rangeTo} min={rangeFrom} onChange={(e) => setRangeTo(e.target.value)} />
                </div>
              </>
            )}

            {dimension === "shift" && (
              <div className="space-y-1">
                <Label className="text-xs">{t("comparisonStudio.date")}</Label>
                <Input type="date" value={shiftDate} max={todayStr()} onChange={(e) => setShiftDate(e.target.value)} />
              </div>
            )}

            {dimension === "period" && (
              <div className="space-y-1">
                <Label className="text-xs">{t("comparisonStudio.periodType")}</Label>
                <Select value={periodType} onValueChange={(v: "week" | "month" | "quarter") => setPeriodType(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="week">{t("comparisonStudio.weekVsWeek")}</SelectItem>
                    <SelectItem value="month">{t("comparisonStudio.monthVsMonth")}</SelectItem>
                    <SelectItem value="quarter">{t("comparisonStudio.quarterVsQuarter")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Entity multi-select (except period, which is a fixed pair) */}
          {!data.fixedEntities && (
            <div className="space-y-2">
              <Label className="text-xs">
                {t("comparisonStudio.pickEntities", { min: MIN_ENTITIES, max: MAX_ENTITIES })}
              </Label>
              {data.isLoading ? (
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-32" />)}
                </div>
              ) : data.entities.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("comparisonStudio.noEntities")}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {data.entities.map((e) => {
                    const active = selectedIds.includes(e.id);
                    const capped = !active && selectedIds.length >= MAX_ENTITIES;
                    return (
                      <Button
                        key={e.id}
                        size="sm"
                        variant={active ? "secondary" : "outline"}
                        disabled={capped}
                        onClick={() => toggleEntity(e.id)}
                        className={active ? "border-primary" : ""}
                      >
                        {e.label}
                        {e.sublabel ? <span className="ml-1.5 text-xs text-muted-foreground">{e.sublabel}</span> : null}
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Metric set */}
          <div className="space-y-2">
            <Label className="text-xs">{t("comparisonStudio.metricSet")}</Label>
            <div className="flex flex-wrap gap-2">
              {data.availableMetrics.map((m) => {
                const active = activeMetrics.includes(m);
                return (
                  <Badge
                    key={m}
                    variant={active ? "default" : "outline"}
                    className="cursor-pointer select-none"
                    onClick={() => toggleMetric(m)}
                  >
                    {t(METRICS[m].labelKey)}
                  </Badge>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* States */}
      {data.isError ? (
        <EmptyState
          icon={GitCompare}
          title={t("comparisonStudio.dimensionUnavailable")}
          description={t("comparisonStudio.dimensionUnavailableDesc")}
        />
      ) : data.isLoading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
          <Skeleton className="h-[360px] w-full" />
        </div>
      ) : !ready ? (
        <EmptyState
          icon={GitCompare}
          title={t("comparisonStudio.selectPrompt")}
          description={t("comparisonStudio.selectPromptDesc", { min: MIN_ENTITIES })}
        />
      ) : (
        <>
          {/* Side-by-side entity cards */}
          <div className={`grid gap-4 grid-cols-1 sm:grid-cols-2 ${selectedEntities.length >= 3 ? "lg:grid-cols-4" : "lg:grid-cols-2"}`}>
            {selectedEntities.map((e, i) => (
              <Card key={e.id} className="border-t-2" style={{ borderTopColor: chartColor(i) }}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: chartColor(i) }} />
                    <span className="truncate">{e.label}</span>
                    {i === 0 && <Badge variant="outline" className="ml-auto text-[10px]">{t("comparisonStudio.baseline")}</Badge>}
                  </CardTitle>
                  {e.sublabel && <CardDescription className="text-xs">{e.sublabel}</CardDescription>}
                </CardHeader>
                <CardContent className="space-y-2">
                  {activeMetrics.map((m) => {
                    const def = METRICS[m];
                    const val = e.metrics[m];
                    const delta = i > 0 && baseline ? deltaOf(val, baseline.metrics[m]) : null;
                    return (
                      <div key={m} className="flex items-baseline justify-between gap-2">
                        <span className="text-xs text-muted-foreground">{t(def.labelKey)}</span>
                        <span className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold tabular-nums">{fmtMetric(def.kind, val)}</span>
                          {delta != null && <DeltaChip delta={delta} def={def} />}
                        </span>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Focus-metric comparison chart + benchmark */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{t("comparisonStudio.chartTitle")}</CardTitle>
                  <CardDescription>{t("comparisonStudio.chartDesc")}</CardDescription>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">{t("comparisonStudio.focusMetric")}</Label>
                    <Select value={activeFocus} onValueChange={(v: MetricId) => setFocusMetric(v)}>
                      <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {activeMetrics.map((m) => (
                          <SelectItem key={m} value={m}>{t(METRICS[m].labelKey)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">{t("comparisonStudio.benchmark")}</Label>
                    <Select value={benchmark} onValueChange={(v: BenchmarkMode) => setBenchmark(v)}>
                      <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("comparisonStudio.benchNone")}</SelectItem>
                        <SelectItem value="best">{t("comparisonStudio.benchBest")}</SelectItem>
                        <SelectItem value="average">{t("comparisonStudio.benchAverage")}</SelectItem>
                        <SelectItem value="target">{t("comparisonStudio.benchTarget")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {benchmark === "target" && (
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground">{t("comparisonStudio.targetValue")}</Label>
                      <Input
                        type="number"
                        value={targetValue}
                        onChange={(e) => setTargetValue(e.target.value)}
                        className="h-8 w-24"
                        placeholder="0"
                      />
                    </div>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[340px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid {...chartGridProps} />
                    <XAxis dataKey="name" tick={chartAxisTick} />
                    <YAxis
                      tick={chartAxisTick}
                      domain={focusDef?.kind === "percent" ? [0, 100] : [0, "auto"]}
                    />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      formatter={(v: number) => fmtMetric(focusDef?.kind ?? "count", v)}
                    />
                    {benchmarkValue != null && (
                      <ReferenceLine
                        y={benchmarkValue}
                        stroke="var(--chart-4)"
                        strokeDasharray="5 4"
                        label={{
                          value: `${t(`comparisonStudio.bench${benchmark === "average" ? "Average" : benchmark === "best" ? "Best" : "Target"}`)}: ${fmtMetric(focusDef?.kind ?? "count", benchmarkValue)}`,
                          position: "insideTopRight",
                          fill: "var(--muted-foreground)",
                          fontSize: 11,
                        }}
                      />
                    )}
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} name={t(focusDef?.labelKey ?? "comparisonStudio.metric")}>
                      {chartData.map((_, i) => <Cell key={i} fill={chartColor(i)} />)}
                      <LabelList dataKey="value" position="top" fontSize={11} fill="var(--foreground)"
                        formatter={(v: number) => fmtMetric(focusDef?.kind ?? "count", v)} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Delta table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("comparisonStudio.deltaTable")}</CardTitle>
              <CardDescription>
                {selectedEntities.length === 2
                  ? t("comparisonStudio.deltaTableDescPair")
                  : t("comparisonStudio.deltaTableDescMulti", { baseline: baseline?.label ?? "" })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("comparisonStudio.metric")}</TableHead>
                      {selectedEntities.map((e, i) => (
                        <TableHead key={e.id} className="text-right">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: chartColor(i) }} />
                            {e.label}
                            {i === 0 && <span className="text-[10px] text-muted-foreground">({t("comparisonStudio.baseline")})</span>}
                          </span>
                        </TableHead>
                      ))}
                      {selectedEntities.length === 2 && (
                        <>
                          <TableHead className="text-right">{t("comparisonStudio.delta")}</TableHead>
                          <TableHead className="text-right">{t("comparisonStudio.percentDiff")}</TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeMetrics.map((m) => {
                      const def = METRICS[m];
                      const a = baseline?.metrics[m];
                      const b = selectedEntities.length === 2 ? selectedEntities[1].metrics[m] : undefined;
                      const d = a != null && b != null ? b - a : null;
                      const pct = d != null && a != null && a !== 0 ? (d / Math.abs(a)) * 100 : null;
                      return (
                        <TableRow key={m}>
                          <TableCell className="font-medium">{t(def.labelKey)}</TableCell>
                          {selectedEntities.map((e, i) => (
                            <TableCell key={e.id} className="text-right tabular-nums">
                              <span className="inline-flex items-center justify-end gap-1.5">
                                {fmtMetric(def.kind, e.metrics[m])}
                                {i > 0 && baseline && (() => {
                                  const dd = deltaOf(e.metrics[m], baseline.metrics[m]);
                                  return dd != null ? <DeltaChip delta={dd} def={def} /> : null;
                                })()}
                              </span>
                            </TableCell>
                          ))}
                          {selectedEntities.length === 2 && (
                            <>
                              <TableCell className={`text-right tabular-nums ${d != null ? changeColor(d, def.higherIsBetter) : ""}`}>
                                {d != null ? `${d >= 0 ? "+" : ""}${def.kind === "count" ? Math.round(d).toLocaleString() : d.toFixed(2)}` : "—"}
                              </TableCell>
                              <TableCell className={`text-right tabular-nums ${pct != null ? changeColor(pct, def.higherIsBetter) : ""}`}>
                                {pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : "—"}
                              </TableCell>
                            </>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Small presentational helpers
// ────────────────────────────────────────────────────────────────────────────

function deltaOf(v: number | null | undefined, base: number | null | undefined): number | null {
  if (v == null || base == null) return null;
  return v - base;
}

function changeColor(delta: number, higherIsBetter: boolean): string {
  if (Math.abs(delta) < 0.005) return "text-muted-foreground";
  const good = higherIsBetter ? delta > 0 : delta < 0;
  return good ? "text-success" : "text-destructive";
}

function DeltaChip({ delta, def }: { delta: number; def: MetricDef }): React.JSX.Element {
  const cls = changeColor(delta, def.higherIsBetter);
  const Icon = Math.abs(delta) < 0.005 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  const text = def.kind === "count" ? `${delta >= 0 ? "+" : ""}${Math.round(delta).toLocaleString()}` : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${cls}`}>
      <Icon className="h-3 w-3" />
      {text}
    </span>
  );
}

export default function ComparisonStudio(): React.JSX.Element {
  return (
    <DashboardLayout>
      <ComparisonStudioContent />
    </DashboardLayout>
  );
}
