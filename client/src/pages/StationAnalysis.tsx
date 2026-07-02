import { useState, useMemo, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useParams, Link, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import ReportExportButton, { type ReportExportConfig } from "@/components/ReportExportButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";

import { ImageGallery, type GalleryImage } from "@/components/ImageGallery";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  ArrowLeft,
  CalendarDays,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Target,
  BarChart3,
  Activity,
  Clock,
  ShieldAlert,
  Lightbulb,
  ChevronRight,
  ChevronDown,
  XCircle,
  Brain,
  FileBarChart,
  ScatterChart as ScatterIcon,
  Table2,
  Layers,
  GitBranch,
  Crosshair,
  Maximize2,
  ImageIcon,
} from "lucide-react";
import {
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  ReferenceLine,
  LineChart,
  Cell,
  ScatterChart,
  Scatter,
  ZAxis,
  Area,
  AreaChart,
} from "recharts";
import { chartColor, chartTooltipStyle, chartGridProps } from "@/components/patterns";

type DatePreset = "today" | "yesterday" | "1w" | "1m" | "year" | "custom";

function getPresetDateRange(preset: DatePreset): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  switch (preset) {
    case "today":
      return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()), to };
    case "yesterday": {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      return { from: new Date(y.getFullYear(), y.getMonth(), y.getDate()), to: new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59, 999) };
    }
    case "1w": {
      const f = new Date(now); f.setDate(f.getDate() - 7);
      return { from: f, to };
    }
    case "1m": {
      const f = new Date(now); f.setMonth(f.getMonth() - 1);
      return { from: f, to };
    }
    case "year": {
      return { from: new Date(now.getFullYear(), 0, 1), to };
    }
    default:
      return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()), to };
  }
}

const PARETO_COLORS = Array.from({ length: 15 }, (_, i) => chartColor(i));

const TABS = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "stationdetail", label: "Station Detail", icon: Crosshair },
  { id: "defects", label: "History & Defects", icon: BarChart3 },
  { id: "spc", label: "SPC Control", icon: Target },
  { id: "qctools", label: "QC Tool", icon: FileBarChart },
  { id: "ai", label: "AI Analysis", icon: Brain },
] as const;

type QcSubTab = "histogram" | "scatter" | "ishikawa" | "checksheet" | "stratification";
type AiSubTab = "aianalysis" | "diagnostics";

const QC_SUB_TABS: { id: QcSubTab; label: string; icon: any }[] = [
  { id: "histogram", label: "Histogram", icon: FileBarChart },
  { id: "scatter", label: "Scatter", icon: ScatterIcon },
  { id: "ishikawa", label: "Cause-Effect", icon: GitBranch },
  { id: "checksheet", label: "Check Sheet", icon: Table2 },
  { id: "stratification", label: "Stratification", icon: Layers },
];

const AI_SUB_TABS: { id: AiSubTab; label: string; icon: any }[] = [
  { id: "aianalysis", label: "AI Analysis", icon: Brain },
  { id: "diagnostics", label: "Diagnostics", icon: Lightbulb },
];

type TabId = (typeof TABS)[number]["id"];

export default function StationAnalysis() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const stationId = Number(params.id);

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [qcSubTab, setQcSubTab] = useState<QcSubTab>("histogram");
  const [aiSubTab, setAiSubTab] = useState<AiSubTab>("aianalysis");
  const search = useSearch();

  // Initialize date state from URL search params (synced from ProductionDashboard)
  const initialDateState = useMemo(() => {
    const params = new URLSearchParams(search);
    const dp = params.get("dp");
    const from = params.get("from");
    const to = params.get("to");
    // Map ProductionDashboard preset names to StationAnalysis preset names
    const presetMap: Record<string, DatePreset> = { today: "today", yesterday: "yesterday", week: "1w", month: "1m", year: "year", custom: "custom", "1w": "1w", "1m": "1m" };
    const preset = (dp && presetMap[dp]) || "1w";
    let range: DateRange | undefined;
    if (preset === "custom" && from) {
      range = { from: new Date(from), to: to ? new Date(to) : new Date() };
    }
    return { preset, range };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  const [datePreset, setDatePreset] = useState<DatePreset>(initialDateState.preset);
  const [customRange, setCustomRange] = useState<DateRange | undefined>(initialDateState.range);
  const [customOpen, setCustomOpen] = useState(false);
  const [productModelId, setProductModelId] = useState<number | undefined>();

  const dateRange = useMemo(() => {
    if (datePreset === "custom" && customRange?.from && customRange?.to) {
      return { from: customRange.from, to: customRange.to };
    }
    return getPresetDateRange(datePreset);
  }, [datePreset, customRange]);

  // Fetch product models for this station
  const { data: stationProductModels } = trpc.stationAnalysis.getStationProductModels.useQuery({ stationId });

  const commonInput = { stationId, startDate: dateRange.from, endDate: dateRange.to, productModelId };

  // Queries (must be declared before useCallback that references them)
  const { data: summary, isLoading: summaryLoading } = trpc.stationAnalysis.getStationSummary.useQuery(commonInput);
  const { data: hourlyData, isLoading: hourlyLoading } = trpc.stationAnalysis.getHourlyYield.useQuery(commonInput, { enabled: activeTab === "overview" });
  const { data: defectData, isLoading: defectLoading } = trpc.stationAnalysis.getStationDefects.useQuery(commonInput, { enabled: activeTab === "defects" || activeTab === "overview" });
  const { data: spcData, isLoading: spcLoading } = trpc.stationAnalysis.getYieldControlChart.useQuery(commonInput, { enabled: activeTab === "spc" || activeTab === "overview" });
  const { data: failHistory, isLoading: failLoading } = trpc.stationAnalysis.getFailHistory.useQuery({ ...commonInput, limit: 50 }, { enabled: activeTab === "defects" });
  const { data: diagnostics, isLoading: diagLoading } = trpc.stationAnalysis.getDiagnostics.useQuery(commonInput, { enabled: (activeTab === "ai" && aiSubTab === "diagnostics") || activeTab === "overview" });
  const { data: histogramData, isLoading: histogramLoading } = trpc.stationAnalysis.getHistogramData.useQuery(commonInput, { enabled: activeTab === "qctools" && qcSubTab === "histogram" });
  const { data: scatterData, isLoading: scatterLoading } = trpc.stationAnalysis.getScatterData.useQuery(commonInput, { enabled: activeTab === "qctools" && qcSubTab === "scatter" });
  const { data: checkSheetData, isLoading: checkSheetLoading } = trpc.stationAnalysis.getCheckSheetData.useQuery(commonInput, { enabled: activeTab === "qctools" && qcSubTab === "checksheet" });
  const { data: causeEffectData, isLoading: causeEffectLoading } = trpc.stationAnalysis.getCauseEffectData.useQuery(commonInput, { enabled: activeTab === "qctools" && qcSubTab === "ishikawa" });
  const { data: stratData, isLoading: stratLoading } = trpc.stationAnalysis.getStratificationData.useQuery(commonInput, { enabled: activeTab === "qctools" && qcSubTab === "stratification" });
  const { data: aiData, isLoading: aiLoading } = trpc.stationAnalysis.getAiAnalysis.useQuery(commonInput, { enabled: activeTab === "ai" && aiSubTab === "aianalysis" });
  const { data: stationDetail, isLoading: detailLoading } = trpc.stationAnalysis.getStationDetail.useQuery(commonInput, { enabled: activeTab === "stationdetail" });

  // tRPC utils for prefetching data during export
  const utils = trpc.useUtils();

  // Export config builder — async to prefetch all data from non-active tabs
  const getExportConfig = useCallback(async (): Promise<ReportExportConfig> => {
    const e = (k: string) => t(`stationAnalysis.export.${k}`);

    // Prefetch all queries in parallel (returns cached data if already fetched)
    const results = await Promise.allSettled([
      utils.stationAnalysis.getStationSummary.fetch(commonInput),
      utils.stationAnalysis.getHourlyYield.fetch(commonInput),
      utils.stationAnalysis.getStationDefects.fetch(commonInput),
      utils.stationAnalysis.getYieldControlChart.fetch(commonInput),
      utils.stationAnalysis.getFailHistory.fetch({ ...commonInput, limit: 50 }),
      utils.stationAnalysis.getDiagnostics.fetch(commonInput),
      utils.stationAnalysis.getHistogramData.fetch(commonInput),
      utils.stationAnalysis.getScatterData.fetch(commonInput),
      utils.stationAnalysis.getCheckSheetData.fetch(commonInput),
      utils.stationAnalysis.getCauseEffectData.fetch(commonInput),
      utils.stationAnalysis.getStratificationData.fetch(commonInput),
      utils.stationAnalysis.getAiAnalysis.fetch(commonInput),
      utils.stationAnalysis.getStationDetail.fetch(commonInput),
    ]);

    const val = <T,>(r: PromiseSettledResult<T>): T | undefined =>
      r.status === "fulfilled" ? r.value : undefined;

    const summary = val(results[0]);
    const hourlyData = val(results[1]);
    const defectData = val(results[2]);
    const spcData = val(results[3]) as any;
    const failHistory = val(results[4]);
    const diagnostics = val(results[5]) as any;
    const histogramData = val(results[6]) as any;
    const scatterData = val(results[7]) as any;
    const checkSheetData = val(results[8]) as any;
    const causeEffectData = val(results[9]) as any;
    const stratData = val(results[10]) as any;
    const aiData = val(results[11]) as any;
    const stationDetail = val(results[12]) as any;

    const stationName = summary ? `${(summary as any).station.code}: ${(summary as any).station.name}` : `Station ${stationId}`;
    const dateStr = `${dateRange.from.toLocaleDateString()} — ${dateRange.to.toLocaleDateString()}`;
    const sections: ReportExportConfig["sections"] = [];

    /* ── 1. Overview stats ───────────────────────────── */
    if (summary) {
      const s = summary as any;
      sections.push({
        title: e("overviewSection"),
        type: "stats",
        stats: [
          { label: "FPY", value: `${s.firstPassYield}%` },
          { label: "Final Yield", value: `${s.finalYield}%` },
          { label: e("total"), value: s.totalInspections.toLocaleString() },
          { label: "NG", value: s.ngCount },
          { label: "Retest", value: `${s.retestRate}%` },
        ],
      });
    }

    /* ── 2. Hourly yield chart + table ───────────────── */
    if (hourlyData && (hourlyData as any[])?.length) {
      sections.push({
        title: e("hourlyYieldSection"),
        type: "chart",
        chartElementId: "chart-hourly-yield",
      });
      sections.push({
        title: e("hourlyYieldSection"),
        type: "table",
        tableHeaders: [e("hour"), e("total"), e("ng"), e("yield")],
        tableRows: (hourlyData as any[]).map((h: any) => [`${h.hour}:00`, h.total, h.ng, `${h.yield}%`]),
      });
    }

    /* ── 3. Top defects table ────────────────────────── */
    if (defectData?.length) {
      const defects = Array.isArray(defectData) ? defectData : [];
      if (defects.length) {
        sections.push({
          title: e("topDefectsSection"),
          type: "table",
          tableHeaders: [e("code"), e("name"), e("count"), e("rate")],
          tableRows: defects.map((d: any) => [d.code, d.name, d.ngCount, `${d.percentage?.toFixed(1)}%`]),
        });
      }
    }

    /* ── 4. Pareto chart ─────────────────────────────── */
    if (defectData?.length) {
      sections.push({
        title: e("topDefectsSection") + " — Pareto",
        type: "chart",
        chartElementId: "chart-pareto",
      });
    }

    /* ── 5. Fail history table ───────────────────────── */
    if (failHistory?.length) {
      const records = Array.isArray(failHistory) ? failHistory : [];
      if (records.length) {
        sections.push({
          title: e("failHistorySection"),
          type: "table",
          tableHeaders: [e("time"), e("barcode"), e("failedPoints"), e("machine")],
          tableRows: records.map((r: any) => [
            new Date(r.inspectionTime).toLocaleString(),
            r.barcode || "—",
            r.failedPoints?.map((fp: any) => `${fp.pointCode}: ${fp.pointName}`).join(", ") || "—",
            r.machineCode || "—",
          ]),
        });
      }
    }

    /* ── 6. SPC charts ───────────────────────────────── */
    if (spcData?.points?.length > 1) {
      sections.push({
        title: e("spcSection") + " — X̄",
        type: "chart",
        chartElementId: "chart-spc-xbar",
      });
      sections.push({
        title: e("spcSection") + " — MR",
        type: "chart",
        chartElementId: "chart-spc-mr",
      });
      sections.push({
        title: e("spcSection"),
        type: "table",
        tableHeaders: [e("day"), e("yieldPct"), e("zone"), e("violatedRules")],
        tableRows: spcData.points.map((p: any) => [
          p.day, `${p.yield}%`, p.zone || "—",
          (p.violatedRules || []).join(", ") || "—",
        ]),
      });
    }

    /* ── 7. Histogram chart + stats ──────────────────── */
    if (histogramData?.bins?.length) {
      sections.push({
        title: e("histogramSection"),
        type: "chart",
        chartElementId: "chart-histogram",
      });
      const s = histogramData.stats;
      if (s) {
        sections.push({
          title: e("histogramSection"),
          type: "stats",
          stats: [
            { label: "Mean", value: `${s.mean}%` },
            { label: "Median", value: `${s.median}%` },
            { label: "Std Dev", value: s.stddev?.toFixed(2) },
            { label: "Skewness", value: s.skewness?.toFixed(2) },
            { label: "Kurtosis", value: s.kurtosis?.toFixed(2) },
            { label: "N", value: String(s.n) },
            { label: "Min", value: `${s.min}%` },
            { label: "Max", value: `${s.max}%` },
          ],
        });
      }
    }

    /* ── 8. Scatter chart + correlation stats ─────────── */
    if (scatterData?.points?.length) {
      sections.push({
        title: e("scatterSection"),
        type: "chart",
        chartElementId: "chart-scatter",
      });
      sections.push({
        title: e("scatterSection"),
        type: "stats",
        stats: [
          { label: e("correlation"), value: String(scatterData.correlation) },
          { label: e("rSquared"), value: String(scatterData.rSquared) },
          { label: e("relationship"), value: `${Math.abs(scatterData.correlation) > 0.7 ? "Strong" : Math.abs(scatterData.correlation) > 0.3 ? "Moderate" : "Weak"} ${scatterData.correlation >= 0 ? "+" : "−"}` },
        ],
      });
    }

    /* ── 9. Ishikawa (Cause-Effect) ──────────────────── */
    if (causeEffectData?.categories?.length) {
      const catText = causeEffectData.categories.map((cat: any) => {
        const causes = cat.causes?.map((c: any) => `  • [${c.severity}] ${c.cause}: ${c.detail}`).join("\n") || "";
        return `${cat.name}:\n${causes}`;
      }).join("\n\n");
      sections.push({
        title: e("ishikawaSection"),
        type: "text",
        text: catText,
      });
    }

    /* ── 10. Check sheet ─────────────────────────────── */
    if (checkSheetData?.matrix?.length) {
      const dt = checkSheetData.defectTypes || [];
      sections.push({
        title: e("checkSheetSection"),
        type: "table",
        tableHeaders: [e("date"), ...dt.map((d: any) => d.code), e("total")],
        tableRows: checkSheetData.matrix.map((row: any) => [
          row.period,
          ...dt.map((d: any) => row[`d${d.id}`] || 0),
          checkSheetData.totals?.byPeriod?.[row.period] || 0,
        ]),
      });
    }

    /* ── 11. Stratification charts + tables ───────────── */
    if (stratData?.byMachine?.length) {
      sections.push({
        title: e("stratByMachine"),
        type: "chart",
        chartElementId: "chart-strat-machine",
      });
      sections.push({
        title: e("stratByMachine"),
        type: "table",
        tableHeaders: [e("machineCode"), e("ok"), e("ng"), e("ntf"), e("yield")],
        tableRows: stratData.byMachine.map((m: any) => [m.machineCode, m.ok, m.ng, m.ntf, `${m.yield}%`]),
      });
    }
    if (stratData?.byShift?.length) {
      sections.push({
        title: e("stratByShift"),
        type: "chart",
        chartElementId: "chart-strat-shift",
      });
      sections.push({
        title: e("stratByShift"),
        type: "table",
        tableHeaders: [e("shift"), e("ok"), e("ng"), e("yield")],
        tableRows: stratData.byShift.map((s: any) => [s.shift, s.ok, s.ng, `${s.yield}%`]),
      });
    }
    if (stratData?.byDay?.length) {
      sections.push({
        title: e("stratByDay"),
        type: "chart",
        chartElementId: "chart-strat-day",
      });
      sections.push({
        title: e("stratByDay"),
        type: "table",
        tableHeaders: [e("dayOfWeek"), e("total"), e("ng"), e("yield")],
        tableRows: stratData.byDay.map((d: any) => [d.day, d.total, d.ng, `${d.yield}%`]),
      });
    }

    /* ── 12. AI insights text ────────────────────────── */
    if (aiData?.insights?.length) {
      sections.push({
        title: e("aiInsightsSection"),
        type: "text",
        text: aiData.insights.map((ins: any) => `[${ins.severity}] ${ins.title}: ${ins.description}`).join("\n"),
      });
    }

    /* ── 13. Process capability stats ────────────────── */
    if (aiData?.processCapability) {
      const pc = aiData.processCapability;
      sections.push({
        title: e("processCapSection"),
        type: "stats",
        stats: [
          { label: "Cp", value: pc.cp },
          { label: "Cpk", value: pc.cpk },
          { label: "PPM", value: pc.ppm },
          { label: "USL", value: `${pc.usl}%` },
          { label: "LSL", value: `${pc.lsl}%` },
          { label: "Mean", value: `${pc.mean}%` },
          { label: "Std Dev", value: pc.stddev },
        ],
      });
    }

    /* ── 14. AI forecast chart ───────────────────────── */
    if (aiData?.forecast?.length) {
      sections.push({
        title: e("forecastSection"),
        type: "chart",
        chartElementId: "chart-ai-forecast",
      });
      sections.push({
        title: e("forecastSection"),
        type: "table",
        tableHeaders: [e("day"), e("predicted"), e("upper"), e("lower")],
        tableRows: aiData.forecast.map((f: any) => [
          (() => { try { return new Date(f.day).toLocaleDateString(); } catch { return f.day; } })(),
          `${f.predicted}%`, `${f.upper}%`, `${f.lower}%`,
        ]),
      });
    }

    /* ── 15. AI anomalies table ──────────────────────── */
    if (aiData?.anomalies?.length) {
      sections.push({
        title: e("anomaliesSection"),
        type: "table",
        tableHeaders: [e("day"), e("yield"), e("type"), e("zScore")],
        tableRows: aiData.anomalies.map((a: any) => [
          (() => { try { return new Date(a.day).toLocaleDateString(); } catch { return a.day; } })(),
          `${a.yield}%`, a.type?.replace("_", " "), a.zScore,
        ]),
      });
    }

    /* ── 16. AI clustering stats ─────────────────────── */
    if (aiData?.clusters?.length) {
      sections.push({
        title: e("clusterSection"),
        type: "stats",
        stats: aiData.clusters.map((cl: any) => ({
          label: `${cl.label} (${cl.count} ${e("days")})`,
          value: `${e("centroid")}: ${cl.centroid}%`,
        })),
      });
    }

    /* ── 17. Diagnostics ─────────────────────────────── */
    if (diagnostics?.alerts?.length) {
      sections.push({
        title: e("diagnosticsAlertsSection"),
        type: "table",
        tableHeaders: [e("severity"), e("alertTitle"), e("description")],
        tableRows: diagnostics.alerts.map((a: any) => [a.severity, a.title, a.description]),
      });
    }
    if (diagnostics?.patterns?.length) {
      sections.push({
        title: e("diagnosticsPatternsSection"),
        type: "table",
        tableHeaders: [e("type"), e("confidence"), e("description")],
        tableRows: diagnostics.patterns.map((p: any) => [p.type, `${Math.round(p.confidence * 100)}%`, p.description]),
      });
    }
    if (diagnostics?.recommendations?.length) {
      sections.push({
        title: e("diagnosticsRecsSection"),
        type: "table",
        tableHeaders: [e("priority"), e("action"), e("rationale")],
        tableRows: diagnostics.recommendations.map((r: any) => [r.priority, r.action, r.rationale]),
      });
    }

    /* ── 18. Station detail — inspection points ──────── */
    if (stationDetail?.points?.length) {
      sections.push({
        title: e("stationDetailSection"),
        type: "table",
        tableHeaders: [e("pointCode"), e("pointName"), e("status"), e("totalInspected"), e("totalDefects"), e("defectRate")],
        tableRows: stationDetail.points.map((p: any) => [
          p.pointCode, p.pointName, p.status,
          p.totalInspected ?? "—", p.totalDefects ?? "—",
          p.defectRate != null ? `${p.defectRate}%` : "—",
        ]),
      });
    }

    return {
      title: `${e("reportTitle")} — ${stationName}`,
      subtitle: dateStr,
      sections,
      filenamePrefix: `station_analysis_${stationId}`,
      orientation: "landscape",
    };
  }, [t, utils, commonInput, stationId, dateRange]);

  if (isNaN(stationId)) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
          <ShieldAlert className="h-12 w-12 mb-3" />
          <p>{t("stationAnalysis.invalidStationId")}</p>
          <Link href="/production-dashboard" className="text-primary hover:underline mt-2 text-sm">
            {t("stationAnalysis.backToDashboard")}
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full bg-background">
        {/* ── Header ── */}
        <div className="border-b border-border bg-card px-7 py-4">
          <div className="flex items-center gap-3 mb-3">
            <Link
              href={
                summary
                  ? `/production-dashboard?factory=${summary.factory.id}&line=${summary.line.id}`
                  : "/production-dashboard"
              }
            >
              <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="h-3.5 w-3.5" />
                {t("stationAnalysis.breadcrumb.dashboard")}
              </button>
            </Link>
            <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
            <span className="text-xs text-muted-foreground">{t("stationAnalysis.breadcrumb.stationAnalysis")}</span>
          </div>

          {summaryLoading ? (
            <div className="flex items-center gap-4">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-5 w-32" />
            </div>
          ) : summary ? (
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-xl font-bold tracking-tight">
                  {summary.station.code}: {summary.station.name}
                </h1>
                <p className="text-xs text-muted-foreground/60 mt-0.5">
                  {summary.factory.name} → {summary.workshop.name} → {summary.line.name}
                  <span className="ml-3">{summary.machineCount} {t("stationAnalysis.machines")}</span>
                </p>
              </div>

              {/* KPI strip */}
              <div className="flex gap-6">
                <KpiMini label={t("stationAnalysis.kpi.fpy")} value={`${summary.firstPassYield}%`} color={summary.firstPassYield >= 90 ? "text-success" : summary.firstPassYield >= 70 ? "text-warning" : "text-destructive"} />
                <KpiMini label={t("stationAnalysis.kpi.finalYield")} value={`${summary.finalYield}%`} color="text-info" />
                <KpiMini
                  label={t("stationAnalysis.kpi.change")}
                  value={`${summary.yieldChange >= 0 ? "+" : ""}${summary.yieldChange}%`}
                  color={summary.yieldChange >= 0 ? "text-success" : "text-destructive"}
                  icon={summary.yieldChange >= 0 ? TrendingUp : TrendingDown}
                />
                <KpiMini label={t("stationAnalysis.kpi.output")} value={summary.totalInspections.toLocaleString()} color="" />
                <KpiMini label={t("stationAnalysis.kpi.ng")} value={String(summary.ngCount)} color={summary.ngCount > 0 ? "text-destructive" : ""} />
                <KpiMini label={t("stationAnalysis.kpi.retest")} value={`${summary.retestRate}%`} color={summary.retestRate > 5 ? "text-warning" : ""} />
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">{t("stationAnalysis.stationNotFound")}</div>
          )}
        </div>

        {/* ── Toolbar: Product + Tabs + Date Filter ── */}
        <div className="flex items-center justify-between border-b border-border bg-card/60 backdrop-blur-sm px-7 py-2">
          <div className="flex items-center gap-3">
            {/* Product Model Filter (first) */}
            {stationProductModels && stationProductModels.length > 0 && (
              <select
                value={productModelId ?? ""}
                onChange={(e) => setProductModelId(e.target.value ? Number(e.target.value) : undefined)}
                className="px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-background border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 min-w-30"
              >
                <option value="">{t("stationAnalysis.allProducts", "All Products")}</option>
                {stationProductModels.map((pm) => (
                  <option key={pm.id} value={pm.id}>{pm.code} - {pm.name}</option>
                ))}
              </select>
            )}

            {/* Tabs */}
            <div className="flex gap-0.5 bg-background border border-border rounded-lg p-0.5">
              {TABS.map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    activeTab === id
                      ? "bg-primary/15 text-primary border border-primary/20"
                      : "text-muted-foreground/60 hover:text-muted-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t(`stationAnalysis.tabs.${id}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Date presets */}
          <div className="flex items-center gap-1.5">
            {([
              ["today", "datePresets.today"], ["yesterday", "datePresets.yesterday"], ["1w", "datePresets.1w"],
              ["1m", "datePresets.1m"], ["year", "datePresets.year"],
            ] as const).map(([key, labelKey]) => (
              <button
                key={key}
                onClick={() => setDatePreset(key)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  datePreset === key
                    ? "bg-primary/15 text-primary border border-primary/20"
                    : "text-muted-foreground/60 hover:text-muted-foreground border border-transparent"
                }`}
              >
                {t(`stationAnalysis.${labelKey}`)}
              </button>
            ))}

            <Popover open={customOpen} onOpenChange={setCustomOpen}>
              <PopoverTrigger asChild>
                <button
                  onClick={() => setDatePreset("custom")}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    datePreset === "custom"
                      ? "bg-primary/15 text-primary border border-primary/20"
                      : "text-muted-foreground/60 hover:text-muted-foreground border border-transparent"
                  }`}
                >
                  <CalendarDays className="h-3 w-3" />
                  {datePreset === "custom" && customRange?.from
                    ? `${customRange.from.toLocaleDateString()} – ${customRange.to?.toLocaleDateString() || "..."}`
                    : t("stationAnalysis.datePresets.custom")}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  selected={customRange}
                  onSelect={(range) => {
                    setCustomRange(range);
                    if (range?.from && range?.to) setCustomOpen(false);
                  }}
                  numberOfMonths={2}
                  disabled={{ after: new Date() }}
                />
              </PopoverContent>
            </Popover>

            <div className="w-px h-5 bg-border mx-1" />
            <ReportExportButton getConfig={getExportConfig} />
          </div>
        </div>

        {/* ── Content ── */}
        <div className="overflow-auto flex-1 p-7">
          {activeTab === "overview" && (
            <OverviewContent
              hourlyData={hourlyData}
              hourlyLoading={hourlyLoading}
              defectData={defectData}
              defectLoading={defectLoading}
              spcData={spcData}
              spcLoading={spcLoading}
              diagnostics={diagnostics}
              diagLoading={diagLoading}
              t={t}
            />
          )}
          {activeTab === "defects" && <DefectsContent data={defectData} isLoading={defectLoading} failHistory={failHistory} failLoading={failLoading} t={t} />}
          {activeTab === "spc" && <SpcContent data={spcData} isLoading={spcLoading} t={t} stationId={stationId} productModelId={productModelId} dateRange={dateRange} />}
          {activeTab === "qctools" && (
            <div className="space-y-4">
              {/* QC Tool Sub-tabs */}
              <div className="flex gap-0.5 bg-background border border-border rounded-lg p-0.5 w-fit">
                {QC_SUB_TABS.map(({ id, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setQcSubTab(id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      qcSubTab === id
                        ? "bg-primary/15 text-primary border border-primary/20"
                        : "text-muted-foreground/60 hover:text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t(`stationAnalysis.tabs.${id}`)}
                  </button>
                ))}
              </div>
              {qcSubTab === "histogram" && <HistogramContent data={histogramData} isLoading={histogramLoading} t={t} />}
              {qcSubTab === "scatter" && <ScatterContent data={scatterData} isLoading={scatterLoading} t={t} />}
              {qcSubTab === "ishikawa" && <IshikawaContent data={causeEffectData} isLoading={causeEffectLoading} t={t} />}
              {qcSubTab === "checksheet" && <CheckSheetContent data={checkSheetData} isLoading={checkSheetLoading} t={t} />}
              {qcSubTab === "stratification" && <StratificationContent data={stratData} isLoading={stratLoading} t={t} />}
            </div>
          )}
          {activeTab === "ai" && (
            <div className="space-y-4">
              {/* AI Sub-tabs */}
              <div className="flex gap-0.5 bg-background border border-border rounded-lg p-0.5 w-fit">
                {AI_SUB_TABS.map(({ id, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setAiSubTab(id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      aiSubTab === id
                        ? "bg-primary/15 text-primary border border-primary/20"
                        : "text-muted-foreground/60 hover:text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t(`stationAnalysis.tabs.${id}`)}
                  </button>
                ))}
              </div>
              {aiSubTab === "aianalysis" && <AiAnalysisContent data={aiData} isLoading={aiLoading} t={t} />}
              {aiSubTab === "diagnostics" && <DiagnosticsContent data={diagnostics} isLoading={diagLoading} t={t} />}
            </div>
          )}
          {activeTab === "stationdetail" && (
            <StationDetailContent data={stationDetail} isLoading={detailLoading} summary={summary} t={t} />
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

/* ── Mini KPI ── */
function KpiMini({ label, value, color, icon: Icon }: { label: string; value: string; color: string; icon?: any }) {
  return (
    <div className="text-center">
      <div className={`text-lg font-mono font-semibold leading-none flex items-center justify-center gap-1 ${color}`}>
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground/50 mt-0.5 uppercase tracking-wider">{label}</div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Overview — summary dashboard combining everything
   ══════════════════════════════════════════════════════════ */
function OverviewContent({
  hourlyData, hourlyLoading,
  defectData, defectLoading,
  spcData, spcLoading,
  diagnostics, diagLoading,
  t,
}: any) {
  return (
    <div className="space-y-6">
      {/* Alerts */}
      {!diagLoading && diagnostics?.alerts?.length > 0 && (
        <div className="space-y-2">
          {diagnostics.alerts.map((a: any, i: number) => (
            <div
              key={i}
              className={`flex items-start gap-3 p-3 rounded-lg border ${
                a.severity === "critical"
                  ? "bg-destructive/10 border-destructive/25 text-destructive"
                  : a.severity === "warning"
                  ? "bg-warning/10 border-warning/25 text-warning"
                  : "bg-info/10 border-info/25 text-info"
              }`}
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <span className="text-xs font-semibold">{a.title}</span>
                <p className="text-[11px] opacity-75 mt-0.5">{a.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Hourly yield chart */}
        <div id="chart-hourly-yield" className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-info" />
            {t("stationAnalysis.overview.hourlyYield")}
          </h3>
          {hourlyLoading ? (
            <Skeleton className="h-55" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={hourlyData || []} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid {...chartGridProps} opacity={0.3} />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(h) => `${h}:00`} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Bar yAxisId="left" dataKey="total" name="Total" fill="var(--chart-1)" opacity={0.3} radius={[3, 3, 0, 0]} />
                <Bar yAxisId="left" dataKey="ng" name="NG" fill="var(--destructive)" opacity={0.7} radius={[3, 3, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="yield" name="Yield %" stroke="var(--success)" strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top defects mini */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            {t("stationAnalysis.overview.topDefects")}
          </h3>
          {defectLoading ? (
            <Skeleton className="h-55" />
          ) : (
            <div className="space-y-2 max-h-55 overflow-y-auto">
              {(defectData || []).slice(0, 8).map((d: any, i: number) => (
                <div key={d.pointDefId} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-muted-foreground/50 w-4">{i + 1}</span>
                  <span className="font-mono text-[10px] bg-muted/50 rounded px-1 py-0.5">{d.code}</span>
                  <span className="truncate flex-1">{d.name}</span>
                  <div className="w-16 h-1.5 bg-border rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(d.percentage, 100)}%`, backgroundColor: PARETO_COLORS[i % PARETO_COLORS.length] }} />
                  </div>
                  <span className="font-mono w-10 text-right">{d.percentage.toFixed(1)}%</span>
                </div>
              ))}
              {(!defectData || defectData.length === 0) && (
                <p className="text-muted-foreground/50 text-xs text-center py-8">{t("stationAnalysis.overview.noDefectData")}</p>
              )}
            </div>
          )}
        </div>

        {/* Mini SPC chart */}
        <div id="chart-overview-spc" className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Target className="h-4 w-4 text-success" />
            {t("stationAnalysis.overview.yieldControlChart")}
            {spcData && (
              <span className={`text-[10px] ml-auto font-mono px-1.5 py-0.5 rounded border ${
                spcData.cpk >= 1.33 ? "bg-success/15 text-success border-success/25"
                : spcData.cpk >= 1 ? "bg-warning/15 text-warning border-warning/25"
                : "bg-destructive/15 text-destructive border-destructive/25"
              }`}>
                Cpk: {spcData.cpk}
              </span>
            )}
          </h3>
          {spcLoading ? (
            <Skeleton className="h-55" />
          ) : spcData?.points?.length > 1 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={spcData.points} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid {...chartGridProps} opacity={0.2} />
                <XAxis dataKey="day" tick={false} />
                <YAxis
                  domain={[Math.max(0, Math.floor(spcData.lcl - 5)), Math.min(100, Math.ceil(spcData.ucl + 5))]}
                  tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v) => `${v}%`}
                  width={40}
                />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(v: any) => [`${Number(v).toFixed(1)}%`, "Yield"]}
                  labelFormatter={(l) => { try { return new Date(l).toLocaleDateString(); } catch { return l; } }}
                />
                <ReferenceLine y={spcData.ucl} stroke="var(--success)" strokeDasharray="4 4" strokeWidth={1} label={{ value: "UCL", position: "right", fontSize: 9 }} />
                <ReferenceLine y={spcData.mean} stroke="var(--primary)" strokeDasharray="2 2" strokeWidth={1} label={{ value: "X̄", position: "right", fontSize: 9 }} />
                <ReferenceLine y={spcData.lcl} stroke="var(--destructive)" strokeDasharray="4 4" strokeWidth={1} label={{ value: "LCL", position: "right", fontSize: 9 }} />
                <Line type="monotone" dataKey="yield" stroke="var(--info)" strokeWidth={1.5}
                  dot={(props: any) => {
                    const { cx, cy, payload } = props;
                    const ooc = payload.outOfControl;
                    return <circle key={`d-${cx}-${cy}`} cx={cx} cy={cy} r={ooc ? 4 : 2} fill={ooc ? "var(--destructive)" : "var(--info)"} stroke={ooc ? "var(--destructive)" : "none"} strokeWidth={ooc ? 2 : 0} />;
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-muted-foreground/50 text-xs text-center py-16">{t("stationAnalysis.overview.notEnoughData")}</p>
          )}
        </div>

        {/* AI Insights mini */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-warning" />
            {t("stationAnalysis.overview.aiInsights")}
          </h3>
          {diagLoading ? (
            <Skeleton className="h-55" />
          ) : (
            <div className="space-y-2 max-h-55 overflow-y-auto">
              {diagnostics?.patterns?.map((p: any, i: number) => (
                <div key={i} className="bg-muted/30 rounded-lg p-2.5">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <span className="text-primary">{p.type}</span>
                    <span className="ml-auto text-[10px] font-mono text-muted-foreground/50">{Math.round(p.confidence * 100)}% conf.</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground/70 mt-1">{p.description}</p>
                </div>
              ))}
              {diagnostics?.recommendations?.slice(0, 2).map((r: any, i: number) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className={`shrink-0 mt-0.5 px-1 py-0.5 rounded text-[9px] font-mono border ${
                    r.priority === "high" ? "bg-destructive/15 text-destructive border-destructive/25"
                    : r.priority === "medium" ? "bg-warning/15 text-warning border-warning/25"
                    : "bg-info/15 text-info border-info/25"
                  }`}>{r.priority}</span>
                  <span className="text-muted-foreground">{r.action}</span>
                </div>
              ))}
              {(!diagnostics?.patterns?.length && !diagnostics?.recommendations?.length) && (
                <p className="text-muted-foreground/50 text-xs text-center py-8">{t("stationAnalysis.overview.noPatterns")}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Defects Tab — Full Pareto
   ══════════════════════════════════════════════════════════ */
function DefectsContent({ data, isLoading, failHistory, failLoading, t }: any) {
  const defects = Array.isArray(data) ? data : [];
  const historyRecords = Array.isArray(failHistory) ? failHistory : [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-87.5 rounded-xl" />
        <Skeleton className="h-62.5 rounded-xl" />
      </div>
    );
  }

  if (defects.length === 0 && historyRecords.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/50">
        <BarChart3 className="h-12 w-12 mb-3" />
        <p className="text-sm">{t("stationAnalysis.defectsTab.noData")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Pareto chart */}
      <div id="chart-pareto" className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          {t("stationAnalysis.defectsTab.paretoChart")}
        </h3>
        <ResponsiveContainer width="100%" height={350}>
          <ComposedChart data={defects} margin={{ top: 5, right: 20, bottom: 60, left: 0 }}>
            <CartesianGrid {...chartGridProps} opacity={0.3} />
            <XAxis dataKey="code" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} angle={-35} textAnchor="end" interval={0} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(value: any, name: string) => name === "cumPercentage" ? [`${value}%`, "Cumulative %"] : [value, "NG Count"]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="left" dataKey="ngCount" name="NG Count" radius={[4, 4, 0, 0]}>
              {defects.map((_: any, i: number) => (
                <Cell key={i} fill={PARETO_COLORS[i % PARETO_COLORS.length]} />
              ))}
            </Bar>
            <Line yAxisId="right" type="monotone" dataKey="cumPercentage" name="Cumulative %" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} />
            <ReferenceLine yAxisId="right" y={80} stroke="var(--destructive)" strokeDasharray="4 4" label={{ value: "80%", position: "right", fill: "var(--destructive)", fontSize: 10 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Defect table */}
      {defects.length > 0 && (
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold mb-4">{t("stationAnalysis.defectsTab.allTypes")}</h3>
        <div className="space-y-1">
          {defects.map((d: any, i: number) => (
            <div key={d.pointDefId} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent/30 transition-colors text-xs">
              <span className="font-mono text-muted-foreground/50 w-5">{i + 1}</span>
              <span className="font-mono text-[10px] bg-muted/50 rounded px-1.5 py-0.5 w-16 text-center">{d.code}</span>
              <span className="truncate flex-1">{d.name}</span>
              <span className="font-mono font-semibold w-12 text-right">{d.ngCount}</span>
              <div className="w-24 h-2 bg-border rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.min(d.percentage, 100)}%`, backgroundColor: PARETO_COLORS[i % PARETO_COLORS.length] }} />
              </div>
              <span className="font-mono text-muted-foreground w-14 text-right">{d.percentage.toFixed(1)}%</span>
              <span className="font-mono text-muted-foreground/50 w-14 text-right">{d.cumPercentage.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Fail History section */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <XCircle className="h-4 w-4 text-destructive" />
          {t("stationAnalysis.tabs.history")}
        </h3>
        {failLoading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}
          </div>
        ) : historyRecords.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 text-center py-6">{t("stationAnalysis.historyTab.noData")}</p>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-[120px_160px_1fr_100px] gap-4 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground/50 font-semibold border-b border-border">
              <span>{t("stationAnalysis.historyTab.time")}</span>
              <span>{t("stationAnalysis.historyTab.barcode")}</span>
              <span>{t("stationAnalysis.historyTab.failedPoints")}</span>
              <span>{t("stationAnalysis.historyTab.machine")}</span>
            </div>
            {historyRecords.map((rec: any) => (
              <div key={rec.id} className="grid grid-cols-[120px_160px_1fr_100px] gap-4 px-4 py-2.5 rounded-lg hover:bg-accent/30 transition-colors items-start border-b border-border/50">
                <span className="text-xs font-mono text-muted-foreground">
                  {new Date(rec.inspectionTime).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="text-xs font-mono truncate">{rec.barcode || "\u2014"}</span>
                <div className="flex flex-wrap gap-1">
                  {rec.failedPoints.map((fp: any, i: number) => (
                    <span key={i} className="text-[10px] bg-destructive/15 text-destructive border border-destructive/25 rounded px-1.5 py-0.5 font-mono">
                      {fp.pointCode}: {fp.pointName}
                    </span>
                  ))}
                  {rec.failedPoints.length === 0 && <span className="text-[10px] text-muted-foreground/40">{t("stationAnalysis.historyTab.noDetail")}</span>}
                </div>
                <span className="text-[10px] font-mono text-muted-foreground/60 truncate">{rec.machineCode}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   SPC Tab — Full Control Chart + Stats
   ══════════════════════════════════════════════════════════ */
function SpcContent({ data, isLoading, t, stationId, productModelId, dateRange }: any) {
  const [spcMode, setSpcMode] = useState<"yield" | "measurement">("yield");
  const [measurementPointDefId, setMeasurementPointDefId] = useState<number | undefined>();
  const [subgroupSize, setSubgroupSize] = useState(5);
  const [enabledRules, setEnabledRules] = useState<number[]>([1, 2, 3, 4, 5, 6, 7, 8]);
  const [customUsl, setCustomUsl] = useState<string>("");
  const [customLsl, setCustomLsl] = useState<string>("");
  const [showSampleTable, setShowSampleTable] = useState(false);

  const { data: mpPoints } = trpc.stationAnalysis.getStationMeasurementPoints.useQuery(
    { stationId, productModelId },
    { enabled: spcMode === "measurement" }
  );

  const { data: mpSpc, isLoading: mpSpcLoading } = trpc.stationAnalysis.getMeasurementPointSPC.useQuery(
    {
      stationId,
      measurementPointDefId: measurementPointDefId!,
      productModelId,
      startDate: dateRange.from,
      endDate: dateRange.to,
      subgroupSize,
      enabledRules,
      uslOverride: customUsl ? Number(customUsl) : undefined,
      lslOverride: customLsl ? Number(customLsl) : undefined,
    },
    { enabled: spcMode === "measurement" && !!measurementPointDefId }
  );

  // Auto-select first measurement point
  useEffect(() => {
    if (mpPoints && mpPoints.length > 0 && !measurementPointDefId) {
      setMeasurementPointDefId(mpPoints[0].id);
    }
  }, [mpPoints, measurementPointDefId]);

  const toggleRule = (rule: number) => {
    setEnabledRules(prev => prev.includes(rule) ? prev.filter(r => r !== rule) : [...prev, rule].sort());
  };

  const RULE_COLORS: Record<number, string> = { 1: "var(--destructive)", 2: "var(--warning)", 3: "var(--warning)", 4: "var(--success)", 5: "var(--chart-5)", 6: "var(--info)", 7: "var(--primary)", 8: "var(--chart-4)" };
  const RULE_LABELS: Record<number, string> = {
    1: "1σ Beyond 3σ", 2: "9 Same Side", 3: "6 Increasing/Decreasing",
    4: "14 Alternating", 5: "2/3 Beyond 2σ", 6: "4/5 Beyond 1σ",
    7: "15 Within 1σ", 8: "8 Beyond 1σ Both",
  };

  return (
    <div className="space-y-6">
      {/* Mode selector + controls */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-0.5 bg-background border border-border rounded-lg p-0.5">
            <button onClick={() => setSpcMode("yield")} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${spcMode === "yield" ? "bg-primary/15 text-primary border border-primary/20" : "text-muted-foreground/60 hover:text-muted-foreground"}`}>
              {t("stationAnalysis.spc.yieldMode")}
            </button>
            <button onClick={() => setSpcMode("measurement")} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${spcMode === "measurement" ? "bg-info/15 text-info border border-info/20" : "text-muted-foreground/60 hover:text-muted-foreground"}`}>
              {t("stationAnalysis.spc.measurementMode")}
            </button>
          </div>
        </div>

        {spcMode === "measurement" && (
          <div className="space-y-3">
            {/* Measurement point selector + subgroup size */}
            <div className="flex items-end gap-3 flex-wrap">
              <div className="min-w-55">
                <label className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1 block">{t("stationAnalysis.spc.measurementPoint")}</label>
                <select
                  value={measurementPointDefId || ""}
                  onChange={(e) => setMeasurementPointDefId(Number(e.target.value))}
                  className="w-full h-9 rounded-md border border-border bg-background px-3 text-xs"
                >
                  <option value="">{t("stationAnalysis.spc.selectPoint")}</option>
                  {mpPoints?.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.code} - {p.name}</option>
                  ))}
                </select>
              </div>
              <div className="w-24">
                <label className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1 block">{t("stationAnalysis.spc.subgroupSize")}</label>
                <Input type="number" min={2} max={25} value={subgroupSize} onChange={(e) => setSubgroupSize(Math.max(2, Math.min(25, Number(e.target.value))))} className="h-9 text-xs" />
              </div>
              <div className="w-28">
                <label className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1 block">USL</label>
                <Input type="number" step="any" value={customUsl} onChange={(e) => setCustomUsl(e.target.value)} placeholder={mpSpc?.specLimits?.usl != null ? String(mpSpc.specLimits.usl) : "—"} className="h-9 text-xs" />
              </div>
              <div className="w-28">
                <label className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1 block">LSL</label>
                <Input type="number" step="any" value={customLsl} onChange={(e) => setCustomLsl(e.target.value)} placeholder={mpSpc?.specLimits?.lsl != null ? String(mpSpc.specLimits.lsl) : "—"} className="h-9 text-xs" />
              </div>
            </div>

            {/* SPC Rules toggles */}
            <div>
              <label className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-2 block">{t("stationAnalysis.spc.enabledRules")}</label>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5, 6, 7, 8].map(r => (
                  <label key={r} className="flex items-center gap-1.5 cursor-pointer text-xs" onClick={() => toggleRule(r)}>
                    <Checkbox checked={enabledRules.includes(r)} className="h-3.5 w-3.5" />
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: RULE_COLORS[r] }} />
                      R{r}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Render yield-based or measurement-based SPC */}
      {spcMode === "yield" ? (
        <YieldSpcView data={data} isLoading={isLoading} t={t} />
      ) : (
        <MeasurementSpcView data={mpSpc} isLoading={mpSpcLoading} t={t} RULE_COLORS={RULE_COLORS} RULE_LABELS={RULE_LABELS} showSampleTable={showSampleTable} setShowSampleTable={setShowSampleTable} />
      )}
    </div>
  );
}

/* ── Yield-based SPC (original, unchanged logic) ── */
function YieldSpcView({ data, isLoading, t }: any) {
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-100 rounded-xl" />
      </div>
    );
  }

  if (!data || data.points?.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/50">
        <Target className="h-12 w-12 mb-3" />
        <p className="text-sm">{t("stationAnalysis.spc.notEnoughData")}</p>
      </div>
    );
  }

  const oocCount = data.points.filter((p: any) => p.outOfControl).length;
  const RULE_COLORS: Record<number, string> = { 1: "var(--destructive)", 2: "var(--warning)", 3: "var(--warning)", 4: "var(--success)", 5: "var(--chart-5)", 6: "var(--info)", 7: "var(--primary)", 8: "var(--chart-4)" };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
        <SpcCard label={t("stationAnalysis.spc.meanLabel")} value={`${data.mean}%`} />
        <SpcCard label={t("stationAnalysis.spc.stdDevLabel")} value={data.stddev.toFixed(2)} />
        <SpcCard label="UCL" value={`${data.ucl}%`} color="text-success" />
        <SpcCard label="LCL" value={`${data.lcl}%`} color="text-destructive" />
        <SpcCard label="Cpk" value={data.cpk.toFixed(2)} color={data.cpk < 1 ? "text-destructive" : data.cpk >= 1.33 ? "text-success" : "text-warning"} />
        <SpcCard label="Ppk" value={data.ppk.toFixed(2)} color={data.ppk < 1 ? "text-destructive" : "text-success"} />
        <SpcCard label={t("stationAnalysis.spc.outOfControl")} value={`${oocCount} / ${data.points.length}`} color={oocCount > 0 ? "text-destructive" : "text-success"} />
      </div>

      {data.ruleSummary && data.ruleSummary.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            {t("stationAnalysis.spc.westernViolations")}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.ruleSummary.map((rs: any) => (
              <div key={rs.rule} className="flex items-center gap-2 bg-muted/30 rounded-lg p-3 border border-border">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: RULE_COLORS[rs.rule] || "var(--muted-foreground)" }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold truncate">{t("stationAnalysis.spc.rule")} {rs.rule}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{rs.name}</div>
                </div>
                <span className="text-xs font-mono font-bold text-destructive">{rs.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div id="chart-spc-xbar" className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Target className="h-4 w-4 text-success" />
          {t("stationAnalysis.spc.xBarChart")}
        </h3>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={data.points} margin={{ top: 10, right: 30, bottom: 20, left: 0 }}>
            <CartesianGrid {...chartGridProps} opacity={0.2} />
            <XAxis dataKey="day" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(d) => { try { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }); } catch { return d; } }} angle={-30} textAnchor="end" />
            <YAxis domain={[Math.max(0, Math.floor(data.lcl - 5)), Math.min(100, Math.ceil(data.ucl + 5))]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `${v}%`} />
            <Tooltip content={({ active, payload, label }: any) => {
              if (!active || !payload?.[0]) return null;
              const pt = payload[0].payload;
              return (
                <div className="bg-card border border-border rounded-lg p-3 shadow-lg text-xs">
                  <div className="font-semibold mb-1">{(() => { try { return new Date(label).toLocaleDateString(); } catch { return label; } })()}</div>
                  <div>Yield: <span className="font-mono font-bold">{Number(pt.yield).toFixed(1)}%</span></div>
                  <div>Zone: <span className="font-mono">{pt.zone}</span></div>
                  {pt.violatedRules?.length > 0 && (
                    <div className="mt-1.5 pt-1.5 border-t border-border space-y-0.5">
                      <div className="text-destructive font-semibold">{t("stationAnalysis.spc.ruleViolations")}</div>
                      {pt.ruleDescriptions?.map((rd: string, i: number) => (
                        <div key={i} className="flex items-start gap-1.5"><div className="w-2 h-2 rounded-full mt-0.5 shrink-0" style={{ backgroundColor: RULE_COLORS[pt.violatedRules[i]] || "var(--muted-foreground)" }} /><span className="text-muted-foreground">{rd}</span></div>
                      ))}
                    </div>
                  )}
                </div>
              );
            }} />
            <ReferenceLine y={data.ucl} stroke="var(--success)" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `UCL: ${data.ucl}%`, position: "insideTopRight", fontSize: 10, fill: "var(--success)" }} />
            <ReferenceLine y={data.mean} stroke="var(--primary)" strokeDasharray="3 3" strokeWidth={1.5} label={{ value: `X̄: ${data.mean}%`, position: "insideTopRight", fontSize: 10, fill: "var(--primary)" }} />
            <ReferenceLine y={data.lcl} stroke="var(--destructive)" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `LCL: ${data.lcl}%`, position: "insideBottomRight", fontSize: 10, fill: "var(--destructive)" }} />
            <ReferenceLine y={data.mean + 2 * data.stddev} stroke="var(--success)" strokeDasharray="2 4" strokeWidth={0.5} opacity={0.4} />
            <ReferenceLine y={data.mean - 2 * data.stddev} stroke="var(--destructive)" strokeDasharray="2 4" strokeWidth={0.5} opacity={0.4} />
            <ReferenceLine y={data.mean + data.stddev} stroke="var(--chart-1)" strokeDasharray="2 4" strokeWidth={0.5} opacity={0.3} />
            <ReferenceLine y={data.mean - data.stddev} stroke="var(--chart-1)" strokeDasharray="2 4" strokeWidth={0.5} opacity={0.3} />
            <Line type="monotone" dataKey="yield" stroke="var(--info)" strokeWidth={2} dot={(props: any) => {
              const { cx, cy, payload } = props;
              const ooc = payload.outOfControl;
              const rules = payload.violatedRules || [];
              const mainColor = rules.length > 0 ? (RULE_COLORS[rules[0]] || "var(--destructive)") : "var(--info)";
              return (
                <g key={`spc-${cx}-${cy}`}>
                  {ooc && <circle cx={cx} cy={cy} r={8} fill={mainColor} opacity={0.15} />}
                  <circle cx={cx} cy={cy} r={ooc ? 5 : 3} fill={ooc ? mainColor : "var(--info)"} stroke={ooc ? "var(--background)" : "none"} strokeWidth={ooc ? 2 : 0} />
                  {rules.length > 1 && <circle cx={cx} cy={cy} r={7} fill="none" stroke="var(--warning)" strokeWidth={1.5} strokeDasharray="3 2" />}
                </g>
              );
            }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div id="chart-spc-mr" className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold mb-4">{t("stationAnalysis.spc.movingRange")}</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data.points.slice(1)} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid {...chartGridProps} opacity={0.2} />
            <XAxis dataKey="day" tick={false} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip contentStyle={chartTooltipStyle} />
            <ReferenceLine y={data.avgMovingRange} stroke="var(--primary)" strokeDasharray="4 4" label={{ value: `MR̄: ${data.avgMovingRange}`, position: "right", fontSize: 9 }} />
            <Bar dataKey="movingRange" name="Moving Range" fill="var(--chart-1)" opacity={0.6} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ── Measurement-value based SPC ── */
function MeasurementSpcView({ data, isLoading, t, RULE_COLORS, RULE_LABELS, showSampleTable, setShowSampleTable }: any) {
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-100 rounded-xl" />
      </div>
    );
  }

  if (!data || !data.xBarPoints || data.xBarPoints.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/50">
        <Target className="h-12 w-12 mb-3" />
        <p className="text-sm">{t("stationAnalysis.spc.notEnoughData")}</p>
        {data?.totalSamples != null && <p className="text-xs mt-1">{t("stationAnalysis.spc.samplesCollected")}: {data.totalSamples}</p>}
      </div>
    );
  }

  const cl = data.controlLimits;
  const cap = data.capability;

  // Compute Y-axis domain for X̄ Chart to include all reference lines + data
  const xBarYDomain = (() => {
    const vals: number[] = [];
    if (data.xBarPoints) data.xBarPoints.forEach((p: any) => { if (p.mean != null) vals.push(Number(p.mean)); });
    vals.push(Number(cl.xBar.UCL), Number(cl.xBar.CL), Number(cl.xBar.LCL));
    if (data.specLimits?.usl != null) vals.push(Number(data.specLimits.usl));
    if (data.specLimits?.lsl != null) vals.push(Number(data.specLimits.lsl));
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const padding = (max - min) * 0.1 || 1;
    return [Math.floor((min - padding) * 1000) / 1000, Math.ceil((max + padding) * 1000) / 1000] as [number, number];
  })();

  // Compute Y-axis domain for R Chart
  const rYDomain = (() => {
    const vals: number[] = [0];
    if (data.rPoints) data.rPoints.forEach((p: any) => { if (p.range != null) vals.push(Number(p.range)); });
    vals.push(Number(cl.range.UCL), Number(cl.range.CL));
    if (cl.range.LCL > 0) vals.push(Number(cl.range.LCL));
    const max = Math.max(...vals);
    const padding = max * 0.1 || 1;
    return [0, Math.ceil((max + padding) * 1000) / 1000] as [number, number];
  })();

  // Compute X-axis domain for X̄ Histogram (numeric) to include all limits
  const xBarHistXDomain = (() => {
    if (!data.xBarHistogram?.length) return undefined;
    const bins = data.xBarHistogram;
    const vals: number[] = [Number(bins[0].binStart), Number(bins[bins.length - 1].binEnd), Number(cl.xBar.UCL), Number(cl.xBar.CL), Number(cl.xBar.LCL)];
    if (data.specLimits?.usl != null) vals.push(Number(data.specLimits.usl));
    if (data.specLimits?.lsl != null) vals.push(Number(data.specLimits.lsl));
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = (max - min) * 0.08 || 1;
    return [min - pad, max + pad] as [number, number];
  })();

  // Compute X-axis domain for R Histogram (numeric) to include all limits
  const rHistXDomain = (() => {
    if (!data.rHistogram?.length) return undefined;
    const bins = data.rHistogram;
    const vals: number[] = [Number(bins[0].binStart), Number(bins[bins.length - 1].binEnd), Number(cl.range.UCL), Number(cl.range.CL)];
    if (cl.range.LCL > 0) vals.push(Number(cl.range.LCL));
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = (max - min) * 0.08 || 1;
    return [Math.max(0, min - pad), max + pad] as [number, number];
  })();

  // Compute bar width for histogram based on bin width
  const xBarHistBarSize = data.xBarHistogram?.length > 0
    ? Math.max(6, Math.round(600 / data.xBarHistogram.length * 0.75))
    : 20;
  const rHistBarSize = data.rHistogram?.length > 0
    ? Math.max(6, Math.round(600 / data.rHistogram.length * 0.75))
    : 20;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <SpcCard label="X̄ (CL)" value={String(cl.xBar.CL)} />
        <SpcCard label="UCL" value={String(cl.xBar.UCL)} color="text-success" />
        <SpcCard label="LCL" value={String(cl.xBar.LCL)} color="text-destructive" />
        <SpcCard label="σ̂" value={String(cl.estimatedSigma)} />
        {cap?.cpk != null && <SpcCard label="Cpk" value={String(cap.cpk)} color={cap.cpk < 1 ? "text-destructive" : cap.cpk >= 1.33 ? "text-success" : "text-warning"} />}
        {cap?.ppk != null && <SpcCard label="Ppk" value={String(cap.ppk)} color={cap.ppk < 1 ? "text-destructive" : "text-success"} />}
        <SpcCard label={t("stationAnalysis.spc.outOfControl")} value={`${data.oocCount} / ${data.totalSubgroups}`} color={data.oocCount > 0 ? "text-destructive" : "text-success"} />
        <SpcCard label={t("stationAnalysis.spc.samples")} value={String(data.totalSamples)} />
      </div>

      {/* Spec limits info */}
      {(data.specLimits?.usl != null || data.specLimits?.lsl != null) && (
        <div className="flex flex-wrap gap-3 text-xs">
          {data.specLimits.usl != null && <span className="bg-success/10 text-success px-3 py-1 rounded-full border border-success/20">USL: {data.specLimits.usl}</span>}
          {data.specLimits.nominal != null && <span className="bg-primary/10 text-primary px-3 py-1 rounded-full border border-primary/20">Nominal: {data.specLimits.nominal}</span>}
          {data.specLimits.lsl != null && <span className="bg-destructive/10 text-destructive px-3 py-1 rounded-full border border-destructive/20">LSL: {data.specLimits.lsl}</span>}
        </div>
      )}

      {/* Rule violations summary */}
      {data.ruleSummary && data.ruleSummary.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            {t("stationAnalysis.spc.westernViolations")}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.ruleSummary.map((rs: any) => (
              <div key={rs.rule} className="flex items-center gap-2 bg-muted/30 rounded-lg p-3 border border-border">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: RULE_COLORS[rs.rule] || "var(--muted-foreground)" }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold truncate">{t("stationAnalysis.spc.rule")} {rs.rule}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{rs.name}</div>
                </div>
                <span className="text-xs font-mono font-bold text-destructive">{rs.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* X-bar Chart */}
      <div id="chart-spc-xbar-mp" className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Target className="h-4 w-4 text-success" />
          X̄ Chart — {data.pointDef?.code || ""} {data.pointDef?.name || ""}
        </h3>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={data.xBarPoints} margin={{ top: 10, right: 30, bottom: 20, left: 0 }}>
            <CartesianGrid {...chartGridProps} opacity={0.2} />
            <XAxis dataKey="index" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} label={{ value: t("stationAnalysis.spc.subgroupIndex"), position: "bottom", fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis domain={xBarYDomain} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip content={({ active, payload }: any) => {
              if (!active || !payload?.[0]) return null;
              const pt = payload[0].payload;
              return (
                <div className="bg-card border border-border rounded-lg p-3 shadow-lg text-xs">
                  <div className="font-semibold mb-1">{t("stationAnalysis.spc.subgroup")} #{pt.index + 1}</div>
                  <div>X̄: <span className="font-mono font-bold">{pt.mean}</span></div>
                  <div>{t("stationAnalysis.spc.samples")}: {pt.sampleCount}</div>
                  {pt.timestamp && <div className="text-muted-foreground">{new Date(pt.timestamp).toLocaleString()}</div>}
                  {pt.violatedRules?.length > 0 && (
                    <div className="mt-1.5 pt-1.5 border-t border-border space-y-0.5">
                      <div className="text-destructive font-semibold">{t("stationAnalysis.spc.ruleViolations")}</div>
                      {pt.ruleDescriptions?.map((rd: string, i: number) => (
                        <div key={i} className="flex items-start gap-1.5"><div className="w-2 h-2 rounded-full mt-0.5 shrink-0" style={{ backgroundColor: RULE_COLORS[pt.violatedRules[i]] || "var(--muted-foreground)" }} /><span className="text-muted-foreground">{rd}</span></div>
                      ))}
                    </div>
                  )}
                </div>
              );
            }} />
            <ReferenceLine y={cl.xBar.UCL} stroke="var(--success)" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `UCL: ${cl.xBar.UCL}`, position: "insideTopRight", fontSize: 10, fill: "var(--success)" }} />
            <ReferenceLine y={cl.xBar.CL} stroke="var(--primary)" strokeDasharray="3 3" strokeWidth={1.5} label={{ value: `X̄: ${cl.xBar.CL}`, position: "insideTopRight", fontSize: 10, fill: "var(--primary)" }} />
            <ReferenceLine y={cl.xBar.LCL} stroke="var(--destructive)" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `LCL: ${cl.xBar.LCL}`, position: "insideBottomRight", fontSize: 10, fill: "var(--destructive)" }} />
            {data.specLimits?.usl != null && <ReferenceLine y={data.specLimits.usl} stroke="var(--success)" strokeDasharray="8 4" strokeWidth={1} label={{ value: `USL: ${data.specLimits.usl}`, position: "insideTopLeft", fontSize: 9, fill: "var(--success)" }} />}
            {data.specLimits?.lsl != null && <ReferenceLine y={data.specLimits.lsl} stroke="var(--destructive)" strokeDasharray="8 4" strokeWidth={1} label={{ value: `LSL: ${data.specLimits.lsl}`, position: "insideBottomLeft", fontSize: 9, fill: "var(--destructive)" }} />}
            <Line type="monotone" dataKey="mean" stroke="var(--info)" strokeWidth={2} dot={(props: any) => {
              const { cx, cy, payload } = props;
              if (cx == null || cy == null) return <g key="empty" />;
              const ooc = payload.outOfControl;
              const rules = payload.violatedRules || [];
              const mainColor = rules.length > 0 ? (RULE_COLORS[rules[0]] || "var(--destructive)") : "var(--info)";
              return (
                <g key={`mp-xbar-${payload.index}`}>
                  {ooc && <circle cx={cx} cy={cy} r={8} fill={mainColor} opacity={0.15} />}
                  <circle cx={cx} cy={cy} r={ooc ? 5 : 3} fill={ooc ? mainColor : "var(--info)"} stroke={ooc ? "var(--background)" : "none"} strokeWidth={ooc ? 2 : 0} />
                  {rules.length > 1 && <circle cx={cx} cy={cy} r={7} fill="none" stroke="var(--warning)" strokeWidth={1.5} strokeDasharray="3 2" />}
                </g>
              );
            }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* R Chart */}
      <div id="chart-spc-r-mp" className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-info" />
          R Chart — {t("stationAnalysis.spc.rangeChart")}
        </h3>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data.rPoints} margin={{ top: 10, right: 30, bottom: 20, left: 0 }}>
            <CartesianGrid {...chartGridProps} opacity={0.2} />
            <XAxis dataKey="index" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis domain={rYDomain} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip content={({ active, payload }: any) => {
              if (!active || !payload?.[0]) return null;
              const pt = payload[0].payload;
              return (
                <div className="bg-card border border-border rounded-lg p-3 shadow-lg text-xs">
                  <div className="font-semibold mb-1">{t("stationAnalysis.spc.subgroup")} #{pt.index + 1}</div>
                  <div>R: <span className="font-mono font-bold">{pt.range}</span></div>
                </div>
              );
            }} />
            <ReferenceLine y={cl.range.UCL} stroke="var(--success)" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `UCL: ${cl.range.UCL}`, position: "insideTopRight", fontSize: 10, fill: "var(--success)" }} />
            <ReferenceLine y={cl.range.CL} stroke="var(--primary)" strokeDasharray="3 3" strokeWidth={1.5} label={{ value: `R̄: ${cl.range.CL}`, position: "insideTopRight", fontSize: 10, fill: "var(--primary)" }} />
            <ReferenceLine y={cl.range.LCL} stroke="var(--destructive)" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `LCL: ${cl.range.LCL}`, position: "insideBottomRight", fontSize: 10, fill: "var(--destructive)" }} />
            <Line type="monotone" dataKey="range" stroke="var(--chart-1)" strokeWidth={2} dot={(props: any) => {
              const { cx, cy, payload } = props;
              if (cx == null || cy == null) return <g key="empty" />;
              const ooc = payload.outOfControl;
              return (
                <g key={`mp-r-${payload.index}`}>
                  <circle cx={cx} cy={cy} r={ooc ? 5 : 3} fill={ooc ? "var(--destructive)" : "var(--chart-1)"} stroke={ooc ? "var(--background)" : "none"} strokeWidth={ooc ? 2 : 0} />
                </g>
              );
            }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Capability Summary Card */}
      {cap && (cap.cp != null || cap.cpk != null) && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="text-sm font-semibold mb-4">{t("stationAnalysis.spc.capabilityIndices")}</h3>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {cap.cp != null && <SpcCard label="Cp" value={String(cap.cp)} color={cap.cp < 1 ? "text-destructive" : cap.cp >= 1.33 ? "text-success" : "text-warning"} />}
            {cap.cpk != null && <SpcCard label="Cpk" value={String(cap.cpk)} color={cap.cpk < 1 ? "text-destructive" : cap.cpk >= 1.33 ? "text-success" : "text-warning"} />}
            {cap.pp != null && <SpcCard label="Pp" value={String(cap.pp)} color={cap.pp < 1 ? "text-destructive" : "text-success"} />}
            {cap.ppk != null && <SpcCard label="Ppk" value={String(cap.ppk)} color={cap.ppk < 1 ? "text-destructive" : "text-success"} />}
            {cap.cpu != null && <SpcCard label="Cpu" value={String(cap.cpu)} />}
            {cap.cpl != null && <SpcCard label="Cpl" value={String(cap.cpl)} />}
          </div>
        </div>
      )}

      {/* X-bar Histogram with Normal Distribution Curve */}
      {data.xBarHistogram?.length > 0 && (
        <div id="chart-xbar-histogram" className="bg-card border border-border rounded-xl p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <FileBarChart className="h-4 w-4 text-info" />
            X̄ {t("stationAnalysis.spc.histogram")}
          </h3>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={data.xBarHistogram} margin={{ top: 10, right: 20, bottom: 40, left: 0 }}>
              <CartesianGrid {...chartGridProps} opacity={0.2} />
              <XAxis type="number" dataKey="binMid" domain={xBarHistXDomain} tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => v.toFixed(2)} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip contentStyle={chartTooltipStyle} labelFormatter={(v: number) => `Bin: ${v.toFixed(3)}`} />
              <Bar dataKey="count" name="Frequency" fill="var(--info)" opacity={0.7} radius={[3, 3, 0, 0]} barSize={xBarHistBarSize} />
              <Line type="monotone" dataKey="normalCount" name="Normal Dist." stroke="var(--destructive)" strokeWidth={2.5} dot={false} />
              <ReferenceLine x={Number(cl.xBar.CL)} stroke="var(--primary)" strokeDasharray="3 3" strokeWidth={1.5} label={{ value: `X̄: ${cl.xBar.CL}`, position: "top", fontSize: 9, fill: "var(--primary)" }} />
              <ReferenceLine x={Number(cl.xBar.UCL)} stroke="var(--success)" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `UCL: ${cl.xBar.UCL}`, position: "top", fontSize: 9, fill: "var(--success)" }} />
              <ReferenceLine x={Number(cl.xBar.LCL)} stroke="var(--destructive)" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `LCL: ${cl.xBar.LCL}`, position: "top", fontSize: 9, fill: "var(--destructive)" }} />
              {data.specLimits?.usl != null && <ReferenceLine x={Number(data.specLimits.usl)} stroke="var(--success)" strokeDasharray="8 4" strokeWidth={1.5} label={{ value: `USL: ${data.specLimits.usl}`, position: "top", fontSize: 9, fill: "var(--success)" }} />}
              {data.specLimits?.lsl != null && <ReferenceLine x={Number(data.specLimits.lsl)} stroke="var(--destructive)" strokeDasharray="8 4" strokeWidth={1.5} label={{ value: `LSL: ${data.specLimits.lsl}`, position: "top", fontSize: 9, fill: "var(--destructive)" }} />}
            </ComposedChart>
          </ResponsiveContainer>
          {/* Legend for reference lines */}
          <div className="flex flex-wrap gap-3 mt-3 justify-center text-[10px]">
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-destructive inline-block" /> Normal Distribution</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-primary inline-block" style={{ borderTop: "2px dashed var(--primary)" }} /> X̄ (CL)</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-success inline-block" style={{ borderTop: "2px dashed var(--success)" }} /> UCL</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-destructive inline-block" style={{ borderTop: "2px dashed var(--destructive)" }} /> LCL</span>
            {data.specLimits?.usl != null && <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-success inline-block" style={{ borderTop: "2px dashed var(--success)" }} /> USL</span>}
            {data.specLimits?.lsl != null && <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-destructive inline-block" style={{ borderTop: "2px dashed var(--destructive)" }} /> LSL</span>}
          </div>
        </div>
      )}

      {/* R Histogram with Normal Distribution Curve */}
      {data.rHistogram?.length > 0 && (
        <div id="chart-r-histogram" className="bg-card border border-border rounded-xl p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <FileBarChart className="h-4 w-4 text-primary" />
            R {t("stationAnalysis.spc.histogram")}
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={data.rHistogram} margin={{ top: 10, right: 20, bottom: 40, left: 0 }}>
              <CartesianGrid {...chartGridProps} opacity={0.2} />
              <XAxis type="number" dataKey="binMid" domain={rHistXDomain} tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => v.toFixed(2)} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip contentStyle={chartTooltipStyle} labelFormatter={(v: number) => `Bin: ${v.toFixed(3)}`} />
              <Bar dataKey="count" name="Frequency" fill="var(--primary)" opacity={0.7} radius={[3, 3, 0, 0]} barSize={rHistBarSize} />
              <Line type="monotone" dataKey="normalCount" name="Normal Dist." stroke="var(--destructive)" strokeWidth={2.5} dot={false} />
              <ReferenceLine x={Number(cl.range.CL)} stroke="var(--primary)" strokeDasharray="3 3" strokeWidth={1.5} label={{ value: `R̄: ${cl.range.CL}`, position: "top", fontSize: 9, fill: "var(--primary)" }} />
              <ReferenceLine x={Number(cl.range.UCL)} stroke="var(--success)" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `UCL: ${cl.range.UCL}`, position: "top", fontSize: 9, fill: "var(--success)" }} />
              {cl.range.LCL > 0 && <ReferenceLine x={Number(cl.range.LCL)} stroke="var(--destructive)" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `LCL: ${cl.range.LCL}`, position: "top", fontSize: 9, fill: "var(--destructive)" }} />}
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-3 mt-3 justify-center text-[10px]">
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-destructive inline-block" /> Normal Distribution</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-primary inline-block" style={{ borderTop: "2px dashed var(--primary)" }} /> R̄ (CL)</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-success inline-block" style={{ borderTop: "2px dashed var(--success)" }} /> UCL</span>
          </div>
        </div>
      )}

      {/* Sample Data Table */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Table2 className="h-4 w-4 text-info" />
            {t("stationAnalysis.spc.sampleTable")}
          </h3>
          <button onClick={() => setShowSampleTable(!showSampleTable)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            {showSampleTable ? t("stationAnalysis.spc.hideTable") : t("stationAnalysis.spc.showTable")}
          </button>
        </div>
        {showSampleTable && (
          <div className="overflow-x-auto max-h-100 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border">
                  <th className="text-left p-2 font-semibold">#</th>
                  <th className="text-left p-2 font-semibold">{t("stationAnalysis.spc.values")}</th>
                  <th className="text-right p-2 font-semibold">X̄</th>
                  <th className="text-right p-2 font-semibold">R</th>
                  <th className="text-left p-2 font-semibold">{t("stationAnalysis.spc.time")}</th>
                  <th className="text-left p-2 font-semibold">{t("stationAnalysis.spc.rules")}</th>
                </tr>
              </thead>
              <tbody>
                {data.sampleTable?.map((row: any) => (
                  <tr key={row.index} className={`border-b border-border/50 ${row.outOfControl ? "bg-destructive/5" : ""}`}>
                    <td className="p-2 font-mono">{row.index}</td>
                    <td className="p-2 font-mono text-muted-foreground">{row.values.join(", ")}</td>
                    <td className="p-2 text-right font-mono font-semibold">{row.mean}</td>
                    <td className="p-2 text-right font-mono">{row.range}</td>
                    <td className="p-2 text-muted-foreground">{row.timestamp ? new Date(row.timestamp).toLocaleString() : "—"}</td>
                    <td className="p-2">
                      {row.violatedRules?.length > 0 && (
                        <div className="flex gap-1">
                          {row.violatedRules.map((r: number) => (
                            <span key={r} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold" style={{ backgroundColor: `color-mix(in srgb, ${RULE_COLORS[r]} 12.5%, transparent)`, color: RULE_COLORS[r] }}>
                              R{r}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SpcCard({ label, value, color = "" }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 text-center">
      <div className={`text-xl font-mono font-semibold ${color}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Histogram Tab — Yield Distribution
   ══════════════════════════════════════════════════════════ */
function HistogramContent({ data, isLoading, t }: any) {
  if (isLoading) return <div className="space-y-6"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-100 rounded-xl" /></div>;
  if (!data || !data.bins?.length) return <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/50"><FileBarChart className="h-12 w-12 mb-3" /><p className="text-sm">{t("stationAnalysis.histogram.noData")}</p></div>;

  const { bins, stats } = data;
  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-3 md:grid-cols-5 xl:grid-cols-9 gap-3">
        {([
          [t("stationAnalysis.histogram.mean"), `${stats.mean}%`], [t("stationAnalysis.histogram.median"), `${stats.median}%`], [t("stationAnalysis.histogram.mode"), `${stats.mode}%`],
          [t("stationAnalysis.histogram.stdDev"), stats.stddev.toFixed(2)], [t("stationAnalysis.histogram.skewness"), stats.skewness.toFixed(2)],
          [t("stationAnalysis.histogram.kurtosis"), stats.kurtosis.toFixed(2)], [t("stationAnalysis.histogram.n"), String(stats.n)],
          [t("stationAnalysis.histogram.min"), `${stats.min}%`], [t("stationAnalysis.histogram.max"), `${stats.max}%`],
        ] as [string, string][]).map(([label, val]) => (
          <SpcCard key={label} label={label} value={val} />
        ))}
      </div>

      {/* Histogram chart with normal overlay */}
      <div id="chart-histogram" className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <FileBarChart className="h-4 w-4 text-info" />
          {t("stationAnalysis.histogram.yieldDistribution")}
          <span className="ml-auto text-[10px] text-muted-foreground/50 font-mono">
            {t("stationAnalysis.histogram.skew")}: {stats.skewness > 0.5 ? t("stationAnalysis.histogram.rightSkewed") : stats.skewness < -0.5 ? t("stationAnalysis.histogram.leftSkewed") : t("stationAnalysis.histogram.symmetric")}
          </span>
        </h3>
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={bins} margin={{ top: 10, right: 20, bottom: 40, left: 0 }}>
            <CartesianGrid {...chartGridProps} opacity={0.2} />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} angle={-30} textAnchor="end" />
            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip contentStyle={chartTooltipStyle} />
            <Bar dataKey="count" name="Frequency" fill="var(--chart-1)" opacity={0.7} radius={[3, 3, 0, 0]} />
            <Line type="monotone" dataKey="normalCount" name="Normal Dist." stroke="var(--success)" strokeWidth={2} dot={false} strokeDasharray="4 4" />
            <ReferenceLine x={bins.findIndex((b: any) => b.binStart <= stats.mean && b.binEnd >= stats.mean) >= 0 ? bins[bins.findIndex((b: any) => b.binStart <= stats.mean && b.binEnd >= stats.mean)]?.label : undefined} stroke="var(--primary)" strokeDasharray="3 3" label={{ value: `μ=${stats.mean}%`, position: "top", fontSize: 10, fill: "var(--primary)" }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Scatter Tab — Output vs NG Rate
   ══════════════════════════════════════════════════════════ */
function ScatterContent({ data, isLoading, t }: any) {
  if (isLoading) return <div className="space-y-6"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-100 rounded-xl" /></div>;
  if (!data || !data.points?.length) return <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/50"><ScatterIcon className="h-12 w-12 mb-3" /><p className="text-sm">{t("stationAnalysis.scatter.noDataMsg")}</p></div>;

  const { points, correlation, rSquared, trendLine } = data;
  const corrStrength = Math.abs(correlation) > 0.7 ? t("stationAnalysis.scatter.strong") : Math.abs(correlation) > 0.3 ? t("stationAnalysis.scatter.moderate") : t("stationAnalysis.scatter.weak");
  const corrDir = correlation > 0 ? t("stationAnalysis.scatter.positive") : correlation < 0 ? t("stationAnalysis.scatter.negative") : "no";

  // Build trend line overlay points
  const xMin = Math.min(...points.map((p: any) => p.x));
  const xMax = Math.max(...points.map((p: any) => p.x));
  const trendData = [
    { x: xMin, y: Math.max(0, trendLine.slope * xMin + trendLine.intercept) },
    { x: xMax, y: Math.max(0, trendLine.slope * xMax + trendLine.intercept) },
  ];

  return (
    <div className="space-y-6">
      {/* Correlation info */}
      <div className="grid grid-cols-3 gap-4">
        <SpcCard label="Correlation (r)" value={String(correlation)} color={Math.abs(correlation) > 0.5 ? "text-warning" : ""} />
        <SpcCard label="R²" value={String(rSquared)} />
        <SpcCard label={t("stationAnalysis.scatter.relationship")} value={`${corrStrength} ${corrDir}`} color={Math.abs(correlation) > 0.5 ? "text-destructive" : "text-success"} />
      </div>

      {/* Scatter chart */}
      <div id="chart-scatter" className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <ScatterIcon className="h-4 w-4 text-info" />
          {t("stationAnalysis.scatter.outputVsNgRate")}
        </h3>
        <ResponsiveContainer width="100%" height={400}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 0 }}>
            <CartesianGrid {...chartGridProps} opacity={0.2} />
            <XAxis dataKey="x" type="number" name="Output" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} label={{ value: t("stationAnalysis.scatter.hourlyOutput"), position: "bottom", fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis dataKey="y" type="number" name="NG Rate %" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => `${v}%`} label={{ value: t("stationAnalysis.scatter.ngRate"), angle: -90, position: "insideLeft", fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
            <ZAxis range={[40, 120]} />
            <Tooltip contentStyle={chartTooltipStyle} formatter={(v: any, name: string) => [name === "NG Rate %" ? `${v}%` : v, name]} />
            <Scatter data={points} fill="var(--chart-1)" opacity={0.7} />
            <Line data={trendData} dataKey="y" stroke="var(--destructive)" strokeWidth={2} strokeDasharray="6 3" dot={false} type="linear" legendType="line" name="Trend" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Ishikawa (Cause-Effect / Fishbone) Tab
   ══════════════════════════════════════════════════════════ */
const ISHIKAWA_COLORS: Record<string, string> = {
  "Man (People)": "var(--info)", "Machine": "var(--destructive)", "Material": "var(--success)",
  "Method": "var(--primary)", "Measurement": "var(--warning)", "Environment": "var(--chart-5)",
};

function IshikawaContent({ data, isLoading, t }: any) {
  if (isLoading) return <div className="space-y-6"><Skeleton className="h-32 rounded-xl" /><Skeleton className="h-112.5 rounded-xl" /></div>;
  if (!data || !data.categories?.length) return <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/50"><GitBranch className="h-12 w-12 mb-3" /><p className="text-sm">{t("stationAnalysis.ishikawa.noData")}</p></div>;

  const { categories, topDefect } = data;

  return (
    <div className="space-y-6">
      {/* Top defect banner */}
      {topDefect && (
        <div className="bg-destructive/10 border border-destructive/25 rounded-xl p-4 flex items-center gap-4">
          <AlertTriangle className="h-6 w-6 text-destructive shrink-0" />
          <div>
            <div className="text-sm font-semibold text-destructive">{t("stationAnalysis.ishikawa.topDefect")}: {topDefect.code}</div>
            <p className="text-xs text-muted-foreground">{topDefect.name} — {topDefect.count} {t("stationAnalysis.ishikawa.occurrences")}</p>
          </div>
        </div>
      )}

      {/* Fishbone / 6M Categories */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold mb-5 flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-primary" />
          {t("stationAnalysis.ishikawa.rootCause")}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {categories.map((cat: any) => {
            const color = ISHIKAWA_COLORS[cat.name] || "var(--muted-foreground)";
            return (
              <div key={cat.name} className="border border-border rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border" style={{ backgroundColor: `${color}15` }}>
                  <span className="text-lg">{cat.icon}</span>
                  <span className="text-sm font-semibold" style={{ color }}>{cat.name}</span>
                </div>
                <div className="divide-y divide-border/50">
                  {cat.causes.map((c: any, i: number) => (
                    <div key={i} className="px-4 py-2.5 flex items-start gap-2">
                      <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${
                        c.severity === "high" ? "bg-destructive" : c.severity === "medium" ? "bg-warning" : "bg-info"
                      }`} />
                      <div>
                        <div className="text-xs font-medium">{c.cause}</div>
                        <div className="text-[10px] text-muted-foreground">{c.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Check Sheet Tab — Defect × Period matrix
   ══════════════════════════════════════════════════════════ */
function CheckSheetContent({ data, isLoading, t }: any) {
  if (isLoading) return <div className="space-y-6"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-100 rounded-xl" /></div>;
  if (!data || !data.matrix?.length) return <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/50"><Table2 className="h-12 w-12 mb-3" /><p className="text-sm">{t("stationAnalysis.checksheet.noData")}</p></div>;

  const { matrix, defectTypes, totals } = data;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <SpcCard label={t("stationAnalysis.checksheet.totalDefects")} value={String(totals.grand)} color="text-destructive" />
        <SpcCard label={t("stationAnalysis.checksheet.defectTypes")} value={String(defectTypes.length)} />
        <SpcCard label={t("stationAnalysis.checksheet.periods")} value={String(matrix.length)} />
      </div>

      {/* Matrix table */}
      <div className="bg-card border border-border rounded-xl p-6 overflow-x-auto">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Table2 className="h-4 w-4 text-info" />
          {t("stationAnalysis.checksheet.defectCheckSheet")}
        </h3>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 px-2 text-muted-foreground/60 font-semibold">{t("stationAnalysis.checksheet.date")}</th>
              {defectTypes.map((dt: any) => (
                <th key={dt.id} className="text-center py-2 px-2 text-muted-foreground/60 font-semibold">
                  <div className="truncate max-w-20" title={dt.name}>{dt.code}</div>
                </th>
              ))}
              <th className="text-center py-2 px-2 text-muted-foreground/60 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {matrix.map((row: any) => (
              <tr key={row.period} className="border-b border-border/30 hover:bg-accent/30 transition-colors">
                <td className="py-2 px-2 font-mono text-muted-foreground">{row.period}</td>
                {defectTypes.map((dt: any) => {
                  const val = row[`d${dt.id}`] || 0;
                  return (
                    <td key={dt.id} className="text-center py-2 px-2">
                      {val > 0 ? (
                        <span className={`font-mono font-semibold ${val > 5 ? "text-destructive" : val > 2 ? "text-warning" : "text-muted-foreground"}`}>{val}</span>
                      ) : (
                        <span className="text-muted-foreground/20">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="text-center py-2 px-2 font-mono font-bold">{totals.byPeriod[row.period] || 0}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-bold">
              <td className="py-2 px-2">Total</td>
              {defectTypes.map((dt: any) => (
                <td key={dt.id} className="text-center py-2 px-2 font-mono">{totals.byDefect[`d${dt.id}`] || 0}</td>
              ))}
              <td className="text-center py-2 px-2 font-mono text-destructive">{totals.grand}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Stratification Tab — Breakdown by Machine/Shift/Day
   ══════════════════════════════════════════════════════════ */
const STRAT_COLORS = Array.from({ length: 8 }, (_, i) => chartColor(i));

function StratificationContent({ data, isLoading, t }: any) {
  if (isLoading) return <div className="space-y-6"><Skeleton className="h-87.5 rounded-xl" /><Skeleton className="h-75 rounded-xl" /></div>;
  if (!data) return <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/50"><Layers className="h-12 w-12 mb-3" /><p className="text-sm">{t("stationAnalysis.stratification.noData")}</p></div>;

  const { byMachine, byShift, byDay } = data;

  return (
    <div className="space-y-6">
      {/* By Machine */}
      {byMachine.length > 0 && (
        <div id="chart-strat-machine" className="bg-card border border-border rounded-xl p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            {t("stationAnalysis.stratification.byMachine")}
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={byMachine} margin={{ top: 5, right: 20, bottom: 40, left: 0 }}>
              <CartesianGrid {...chartGridProps} opacity={0.2} />
              <XAxis dataKey="machineCode" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} angle={-25} textAnchor="end" />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => `${v}%`} />
              <Tooltip contentStyle={chartTooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="ok" name="OK" stackId="a" fill="var(--success)" opacity={0.7} />
              <Bar yAxisId="left" dataKey="ng" name="NG" stackId="a" fill="var(--destructive)" opacity={0.7} />
              <Bar yAxisId="left" dataKey="ntf" name="NTF" stackId="a" fill="var(--warning)" opacity={0.5} radius={[3, 3, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="yield" name="Yield %" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3, fill: "var(--primary)" }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* By Shift */}
        {byShift.length > 0 && (
          <div id="chart-strat-shift" className="bg-card border border-border rounded-xl p-6">
            <h3 className="text-sm font-semibold mb-4">{t("stationAnalysis.stratification.byShift")}</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={byShift} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid {...chartGridProps} opacity={0.2} />
                <XAxis dataKey="shift" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="ok" name="OK" fill="var(--success)" opacity={0.7} />
                <Bar dataKey="ng" name="NG" fill="var(--destructive)" opacity={0.7} />
              </BarChart>
            </ResponsiveContainer>
            {/* Yield per shift text */}
            <div className="flex gap-3 mt-3 justify-center">
              {byShift.map((s: any) => (
                <div key={s.shift} className="text-center">
                  <div className={`text-sm font-mono font-bold ${s.yield >= 90 ? "text-success" : s.yield >= 70 ? "text-warning" : "text-destructive"}`}>{s.yield}%</div>
                  <div className="text-[10px] text-muted-foreground/50">{s.shift}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* By Day of Week */}
        {byDay.length > 0 && (
          <div id="chart-strat-day" className="bg-card border border-border rounded-xl p-6">
            <h3 className="text-sm font-semibold mb-4">{t("stationAnalysis.stratification.byDayOfWeek")}</h3>
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={byDay} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid {...chartGridProps} opacity={0.2} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => `${v}%`} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Bar yAxisId="left" dataKey="total" name="Total" fill="var(--chart-1)" opacity={0.3} radius={[3, 3, 0, 0]} />
                <Bar yAxisId="left" dataKey="ng" name="NG" fill="var(--destructive)" opacity={0.7} radius={[3, 3, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="yield" name="Yield %" stroke="var(--success)" strokeWidth={2} dot={{ r: 3, fill: "var(--success)" }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   AI Analysis Tab — Anomaly Detection, Forecasting, Clustering
   ══════════════════════════════════════════════════════════ */
function AiAnalysisContent({ data, isLoading, t }: any) {
  if (isLoading) return <div className="space-y-6">{[1,2,3,4].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}</div>;
  if (!data) return <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/50"><Brain className="h-12 w-12 mb-3" /><p className="text-sm">{t("stationAnalysis.ai.noData")}</p></div>;

  const { anomalies, forecast, clusters, insights, processCapability: pc } = data;

  return (
    <div className="space-y-6">
      {/* AI Insights banner */}
      {insights.length > 0 && (
        <div className="space-y-3">
          {insights.map((ins: any, i: number) => (
            <div key={i} className={`flex items-start gap-3 p-4 rounded-xl border ${
              ins.severity === "critical" ? "bg-destructive/10 border-destructive/25"
              : ins.severity === "warning" ? "bg-warning/10 border-warning/25"
              : "bg-info/10 border-info/25"
            }`}>
              <Brain className={`h-5 w-5 mt-0.5 shrink-0 ${
                ins.severity === "critical" ? "text-destructive" : ins.severity === "warning" ? "text-warning" : "text-info"
              }`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{ins.title}</span>
                  <span className={`text-[9px] uppercase font-mono px-1.5 py-0.5 rounded border ${
                    ins.severity === "critical" ? "bg-destructive/20 text-destructive border-destructive/30"
                    : ins.severity === "warning" ? "bg-warning/20 text-warning border-warning/30"
                    : "bg-info/20 text-info border-info/30"
                  }`}>{ins.type}</span>
                  <span className="text-[10px] font-mono text-muted-foreground/50 ml-auto">{Math.round(ins.confidence * 100)}% conf.</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{ins.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Process Capability */}
      {pc && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Target className="h-4 w-4 text-success" />
            {t("stationAnalysis.ai.processCapability")}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <SpcCard label="Cp" value={String(pc.cp)} color={pc.cp >= 1.33 ? "text-success" : pc.cp >= 1 ? "text-warning" : "text-destructive"} />
            <SpcCard label="Cpk" value={String(pc.cpk)} color={pc.cpk >= 1.33 ? "text-success" : pc.cpk >= 1 ? "text-warning" : "text-destructive"} />
            <SpcCard label="PPM" value={String(pc.ppm)} color={pc.ppm > 10000 ? "text-destructive" : ""} />
            <SpcCard label="USL" value={`${pc.usl}%`} color="text-success" />
            <SpcCard label="LSL" value={`${pc.lsl}%`} color="text-destructive" />
            <SpcCard label="Mean" value={`${pc.mean}%`} />
            <SpcCard label="Std Dev" value={String(pc.stddev)} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Forecast */}
        {forecast.length > 0 && (
          <div id="chart-ai-forecast" className="bg-card border border-border rounded-xl p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-info" />
              {t("stationAnalysis.ai.forecast7Day")}
            </h3>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={forecast} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid {...chartGridProps} opacity={0.2} />
                <XAxis dataKey="day" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={d => { try { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }); } catch { return d; } }} />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => `${v}%`} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v: any) => [`${v}%`]} />
                <Area dataKey="upper" stroke="none" fill="var(--info)" fillOpacity={0.1} />
                <Area dataKey="lower" stroke="none" fill="var(--card)" fillOpacity={1} />
                <Area dataKey="upper" stroke="none" fill="var(--info)" fillOpacity={0.1} stackId="ci" />
                <Line dataKey="predicted" stroke="var(--info)" strokeWidth={2} dot={{ r: 3, fill: "var(--info)" }} name="Predicted Yield" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Anomalies */}
        {anomalies.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              {t("stationAnalysis.ai.detectedAnomalies")} ({anomalies.length})
            </h3>
            <div className="space-y-2 max-h-62.5 overflow-y-auto">
              {anomalies.map((a: any, i: number) => (
                <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${
                  a.type === "unusually_low" ? "bg-destructive/10 border-destructive/25" : "bg-info/10 border-info/25"
                }`}>
                  <span className="text-xs font-mono text-muted-foreground">{(() => { try { return new Date(a.day).toLocaleDateString(); } catch { return a.day; } })()}</span>
                  <span className="text-xs font-mono font-bold">{a.yield}%</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono border ${
                    a.type === "unusually_low" ? "bg-destructive/20 text-destructive border-destructive/30" : "bg-info/20 text-info border-info/30"
                  }`}>{a.type.replace("_", " ")}</span>
                  <span className="text-[10px] font-mono text-muted-foreground ml-auto">z={a.zScore}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Clusters */}
      {clusters.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            {t("stationAnalysis.ai.performanceClustering")}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {clusters.map((cl: any) => (
              <div key={cl.id} className={`border rounded-lg p-4 ${
                cl.label === "Low Performance" ? "border-destructive/25 bg-destructive/5"
                : cl.label === "High Performance" ? "border-success/25 bg-success/5"
                : "border-border bg-muted/30"
              }`}>
                <div className="text-sm font-semibold mb-1">{cl.label}</div>
                <div className="text-2xl font-mono font-bold">{cl.count} <span className="text-xs text-muted-foreground">{t("stationAnalysis.ai.days")}</span></div>
                <div className="text-xs text-muted-foreground mt-1">{t("stationAnalysis.ai.centroid")}: {cl.centroid}%</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Fail History Tab
   ══════════════════════════════════════════════════════════ */
function HistoryContent({ data, isLoading, t }: any) {
  const records = Array.isArray(data) ? data : [];

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/50">
        <XCircle className="h-12 w-12 mb-3" />
        <p className="text-sm">{t("stationAnalysis.historyTab.noData")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="grid grid-cols-[120px_160px_1fr_100px] gap-4 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground/50 font-semibold border-b border-border">
        <span>{t("stationAnalysis.historyTab.time")}</span>
        <span>{t("stationAnalysis.historyTab.barcode")}</span>
        <span>{t("stationAnalysis.historyTab.failedPoints")}</span>
        <span>{t("stationAnalysis.historyTab.machine")}</span>
      </div>

      {records.map((rec: any) => (
        <div key={rec.id} className="grid grid-cols-[120px_160px_1fr_100px] gap-4 px-4 py-2.5 rounded-lg hover:bg-accent/30 transition-colors items-start border-b border-border/50">
          <span className="text-xs font-mono text-muted-foreground">
            {new Date(rec.inspectionTime).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </span>
          <span className="text-xs font-mono truncate">{rec.barcode || "—"}</span>
          <div className="flex flex-wrap gap-1">
            {rec.failedPoints.map((fp: any, i: number) => (
              <span key={i} className="text-[10px] bg-destructive/15 text-destructive border border-destructive/25 rounded px-1.5 py-0.5 font-mono">
                {fp.pointCode}: {fp.pointName}
              </span>
            ))}
            {rec.failedPoints.length === 0 && <span className="text-[10px] text-muted-foreground/40">{t("stationAnalysis.historyTab.noDetail")}</span>}
          </div>
          <span className="text-[10px] font-mono text-muted-foreground/60 truncate">{rec.machineCode}</span>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   AI Diagnostics Tab
   ══════════════════════════════════════════════════════════ */
function DiagnosticsContent({ data, isLoading, t }: any) {
  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  const { alerts = [], patterns = [], recommendations = [] } = data || {};

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Alerts */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning" />
          {t("stationAnalysis.diagnostics.activeAlerts")}
        </h3>
        {alerts.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 text-center py-6">{t("stationAnalysis.diagnostics.noAlerts")}</p>
        ) : (
          <div className="space-y-3">
            {alerts.map((a: any, i: number) => (
              <div
                key={i}
                className={`flex items-start gap-3 p-4 rounded-lg border ${
                  a.severity === "critical"
                    ? "bg-destructive/10 border-destructive/25"
                    : a.severity === "warning"
                    ? "bg-warning/10 border-warning/25"
                    : "bg-info/10 border-info/25"
                }`}
              >
                <ShieldAlert className={`h-5 w-5 mt-0.5 shrink-0 ${
                  a.severity === "critical" ? "text-destructive" : a.severity === "warning" ? "text-warning" : "text-info"
                }`} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{a.title}</span>
                    <span className={`text-[9px] uppercase tracking-wider font-mono px-1.5 py-0.5 rounded border ${
                      a.severity === "critical" ? "bg-destructive/20 text-destructive border-destructive/30"
                      : a.severity === "warning" ? "bg-warning/20 text-warning border-warning/30"
                      : "bg-info/20 text-info border-info/30"
                    }`}>{a.severity}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{a.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detected patterns */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          {t("stationAnalysis.diagnostics.detectedPatterns")}
        </h3>
        {patterns.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 text-center py-6">{t("stationAnalysis.diagnostics.noPatterns")}</p>
        ) : (
          <div className="space-y-3">
            {patterns.map((p: any, i: number) => (
              <div key={i} className="bg-muted/30 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-primary">{p.type}</span>
                  <div className="flex items-center gap-1">
                    <div className="w-16 h-1.5 bg-border rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${p.confidence * 100}%` }} />
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground/50">{Math.round(p.confidence * 100)}%</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{p.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recommendations */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-warning" />
          {t("stationAnalysis.diagnostics.recommendations")}
        </h3>
        {recommendations.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 text-center py-6">{t("stationAnalysis.diagnostics.noRecommendations")}</p>
        ) : (
          <div className="space-y-3">
            {recommendations.map((r: any, i: number) => (
              <div key={i} className="flex items-start gap-3 p-4 rounded-lg border border-border bg-background">
                <span className={`shrink-0 mt-0.5 px-2 py-0.5 rounded text-[10px] font-mono border font-semibold ${
                  r.priority === "high" ? "bg-destructive/15 text-destructive border-destructive/25"
                  : r.priority === "medium" ? "bg-warning/15 text-warning border-warning/25"
                  : "bg-info/15 text-info border-info/25"
                }`}>{r.priority}</span>
                <div>
                  <p className="text-sm font-medium">{r.action}</p>
                  <p className="text-xs text-muted-foreground mt-1">{r.rationale}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Station Detail — Board-level inspection point visualisation
   Adapted from aoi_station_detail_v2.html reference design
   ══════════════════════════════════════════════════════════ */
type PointFilter = "all" | "fail" | "warn" | "pass";

function StationDetailContent({ data, isLoading, summary, t }: any) {
  const [selectedPointId, setSelectedPointId] = useState<number | null>(null);
  const [pointFilter, setPointFilter] = useState<PointFilter>("all");
  const [showMarkers, setShowMarkers] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [visibleImageCount, setVisibleImageCount] = useState(5);


  const points: any[] = data?.points ?? [];
  const productImage = data?.productImage;
  const boardInfo = data?.boardInfo;

  const counts = useMemo(() => ({
    all: points.length,
    fail: points.filter((p: any) => p.status === "fail").length,
    warn: points.filter((p: any) => p.status === "warn").length,
    pass: points.filter((p: any) => p.status === "pass").length,
  }), [points]);

  const filtered = useMemo(
    () => pointFilter === "all" ? points : points.filter((p: any) => p.status === pointFilter),
    [points, pointFilter],
  );

  const selectedPoint = useMemo(
    () => points.find((p: any) => p.id === selectedPointId) ?? null,
    [points, selectedPointId],
  );

  // Map error images for the selected point to GalleryImage format
  const galleryImages: GalleryImage[] = useMemo(() => {
    if (!selectedPoint?.errorImages?.length) return [];
    return selectedPoint.errorImages.map((img: any) => ({
      id: img.id,
      url: img.imageUrl,
      thumbnailUrl: img.imageUrl.includes('?') ? `${img.imageUrl}&w=320&q=75` : `${img.imageUrl}?w=320&q=75`,
      title: `${selectedPoint.code} — ${img.serialNumber || 'NG'}`,
      description: `Val: ${img.measuredValue}`,
      result: "NG" as const,
      measurementPointId: selectedPoint.id,
      measurementPointName: selectedPoint.name,
      value: img.measuredValue !== '—' ? Number(img.measuredValue) : undefined,
      standardValue: selectedPoint.nominalValue ?? undefined,
      upperLimit: selectedPoint.upperLimit ?? undefined,
      lowerLimit: selectedPoint.lowerLimit ?? undefined,
      timestamp: img.inspectionTime ? new Date(img.inspectionTime) : undefined,
    }));
  }, [selectedPoint]);

  // Reset visible image count when selected point changes
  useEffect(() => { setVisibleImageCount(5); }, [selectedPointId]);

  // Detect actual image natural dimensions for accurate point positioning
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!productImage?.url) { setNaturalSize(null); return; }
    const img = new Image();
    img.onload = () => setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = productImage.url;
  }, [productImage?.url]);

  // Board dimensions: prefer natural image size > db values > defaults
  const boardW = naturalSize?.w ?? productImage?.width ?? 800;
  const boardH = naturalSize?.h ?? productImage?.height ?? 600;

  if (isLoading) {
    return (
      <div className="grid grid-cols-[220px_1fr] gap-0 h-[calc(100vh-220px)] -m-7">
        <div className="border-r border-border bg-card p-4 space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-8" />
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-10" />)}
        </div>
        <div className="p-4">
          <Skeleton className="h-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/50">
        <Crosshair className="h-12 w-12 mb-3" />
        <p className="text-sm">{t("stationAnalysis.stationDetail.noPoints")}</p>
      </div>
    );
  }

  const statusColor = (s: string) => s === "fail" ? "text-destructive" : s === "warn" ? "text-warning" : "text-success";
  const statusBg = (s: string) => s === "fail" ? "bg-destructive" : s === "warn" ? "bg-warning" : "bg-success";
  const statusBorder = (s: string) => s === "fail" ? "border-destructive/30" : s === "warn" ? "border-warning/30" : "border-success/30";
  const statusBgDim = (s: string) => s === "fail" ? "bg-destructive/10" : s === "warn" ? "bg-warning/10" : "bg-success/10";

  return (
    <div className="grid grid-cols-[220px_1fr] gap-0 h-[calc(100vh-220px)] -m-7 relative">
      {/* ── SIDEBAR ── */}
      <aside className="border-r border-border bg-card flex flex-col overflow-hidden">
        {/* Section header */}
        <div className="px-3 py-2 text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-widest border-b border-border">
          {t("stationAnalysis.stationDetail.inspectionPoints")}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 px-2.5 py-2 border-b border-border flex-wrap">
          {([
            ["all", t("stationAnalysis.stationDetail.all"), "bg-muted/40 text-muted-foreground border-border"],
            ["fail", t("stationAnalysis.stationDetail.fail"), "bg-destructive/10 text-destructive border-destructive/25"],
            ["warn", t("stationAnalysis.stationDetail.warn"), "bg-warning/10 text-warning border-warning/25"],
            ["pass", t("stationAnalysis.stationDetail.pass"), "bg-success/10 text-success border-success/25"],
          ] as const).map(([key, label, cls]) => (
            <button
              key={key}
              onClick={() => setPointFilter(key as PointFilter)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border transition-all ${cls} ${
                pointFilter === key ? "ring-1 ring-current" : ""
              }`}
            >
              {label}
              <span className="text-[9px] font-bold opacity-75">{counts[key as PointFilter]}</span>
            </button>
          ))}
        </div>

        {/* Point list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.map((pt: any) => (
            <button
              key={pt.id}
              onClick={() => setSelectedPointId(selectedPointId === pt.id ? null : pt.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left border-l-2 transition-colors hover:bg-accent/30 ${
                selectedPointId === pt.id
                  ? "bg-accent/40 border-l-info"
                  : "border-l-transparent"
              }`}
            >
              <div className={`w-2 h-2 rounded-full shrink-0 ${statusBg(pt.status)} shadow-[0_0_5px_currentColor]`} />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold truncate">{pt.code}</div>
                <div className="text-[10px] text-muted-foreground/50 truncate">{pt.name}</div>
              </div>
              <span className={`text-[11px] font-mono font-bold ${statusColor(pt.status)}`}>
                {pt.defectRate}%
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* ── MAIN AREA ── */}
      <div className="flex flex-col overflow-hidden bg-background/50">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card/60 shrink-0">
          <span className="text-[11px] text-muted-foreground/60">{t("stationAnalysis.stationDetail.overlay")}:</span>
          <button
            onClick={() => setShowMarkers(!showMarkers)}
            className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
              showMarkers
                ? "bg-info/10 border-info/30 text-info"
                : "bg-muted/30 border-border text-muted-foreground/60 hover:text-muted-foreground"
            }`}
          >
            ● {t("stationAnalysis.stationDetail.points")}
          </button>
          <button
            onClick={() => setShowHeatmap(!showHeatmap)}
            className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
              showHeatmap
                ? "bg-info/10 border-info/30 text-info"
                : "bg-muted/30 border-border text-muted-foreground/60 hover:text-muted-foreground"
            }`}
          >
            ◈ {t("stationAnalysis.stationDetail.heatmap")}
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            <button onClick={() => setZoom(z => Math.max(50, z - 10))} className="w-6 h-6 rounded border border-border bg-muted/30 text-muted-foreground hover:text-foreground text-sm grid place-items-center">−</button>
            <span className="text-[11px] text-muted-foreground/60 min-w-9.5 text-center font-mono">{zoom}%</span>
            <button onClick={() => setZoom(z => Math.min(200, z + 10))} className="w-6 h-6 rounded border border-border bg-muted/30 text-muted-foreground hover:text-foreground text-sm grid place-items-center">+</button>
            <button onClick={() => setZoom(100)} className="w-6 h-6 rounded border border-border bg-muted/30 text-muted-foreground hover:text-foreground text-xs grid place-items-center">⊙</button>
          </div>
        </div>

        {/* Board visualization */}
        <div className="flex-1 overflow-auto relative">
          <div className="min-h-full flex items-center justify-center p-4">
            <div
              className="relative border border-border/50 rounded-lg overflow-hidden"
              style={{
                width: boardW * (zoom / 100),
                height: boardH * (zoom / 100),
                background: "linear-gradient(135deg, #0b1e16, #091530)",
              }}
            >
              {/* Product reference image */}
              {productImage?.url && (
                <img
                  src={productImage.url}
                  alt="Board reference"
                  className="absolute inset-0 w-full h-full object-contain opacity-60"
                />
              )}

              {/* Grid overlay */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20">
                <defs>
                  <pattern id="sd-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <path d="M 20 0 L 0 0 0 20" fill="none" stroke="hsl(var(--border))" strokeWidth="0.5" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#sd-grid)" />
              </svg>

              {/* Heatmap overlay */}
              {showHeatmap && (
                <div className="absolute inset-0 pointer-events-none">
                  {points.map((pt: any) => {
                    const x = (pt.positionX / boardW) * 100;
                    const y = (pt.positionY / boardH) * 100;
                    const intensity = Math.min(pt.defectRate / 3, 1);
                    const w = (pt.cropWidth || 100) * (zoom / 100);
                    const h = (pt.cropHeight || 100) * (zoom / 100);
                    const color = intensity > 0.66 ? "255,61,90"
                      : intensity > 0.33 ? "255,187,51"
                      : "16,232,120";
                    const alpha = intensity > 0.66 ? 0.55 : intensity > 0.33 ? 0.45 : 0.30;
                    return (
                      <div
                        key={`heat-${pt.id}`}
                        className="absolute"
                        style={{
                          left: `${x}%`,
                          top: `${y}%`,
                          width: w,
                          height: h,
                          transform: "translate(-50%, -50%)",
                          background: `radial-gradient(ellipse at center, rgba(${color},${alpha}) 0%, rgba(${color},${alpha * 0.6}) 30%, rgba(${color},${alpha * 0.25}) 60%, transparent 100%)`,
                        }}
                      />
                    );
                  })}
                </div>
              )}

              {/* Markers */}
              {showMarkers && points.map((pt: any) => {
                const x = (pt.positionX / boardW) * 100;
                const y = (pt.positionY / boardH) * 100;
                const isActive = selectedPointId === pt.id;
                const ringColor = pt.status === "fail" ? "border-destructive shadow-[0_0_7px_var(--destructive)]"
                  : pt.status === "warn" ? "border-warning shadow-[0_0_7px_var(--warning)]"
                  : "border-success shadow-[0_0_7px_var(--success)]";
                const dotColor = pt.status === "fail" ? "bg-destructive" : pt.status === "warn" ? "bg-warning" : "bg-success";

                return (
                  <div
                    key={`mk-${pt.id}`}
                    className="absolute cursor-pointer group z-10"
                    style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}
                    onClick={() => setSelectedPointId(isActive ? null : pt.id)}
                  >
                    <div className={`w-5 h-5 rounded-full border-2 grid place-items-center bg-background/80 transition-transform ${ringColor} ${
                      isActive ? "scale-[1.4]" : "group-hover:scale-[1.3]"
                    }`}>
                      <div className={`w-1.75 h-1.75 rounded-full ${dotColor} animate-pulse`} />
                    </div>
                    {/* Label on hover/active */}
                    <div className={`absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[8px] font-bold px-1 py-px rounded border bg-background ${
                      pt.status === "fail" ? "text-destructive border-destructive/30"
                      : pt.status === "warn" ? "text-warning border-warning/30"
                      : "text-success border-success/30"
                    } ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"} transition-opacity pointer-events-none`}>
                      {pt.code}
                    </div>
                  </div>
                );
              })}

              {/* Heatmap legend */}
              {showHeatmap && (
                <div className="absolute bottom-3 left-3 bg-background/90 border border-border rounded-md px-3 py-2 z-20">
                  <div className="text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-1.5">{t("stationAnalysis.stationDetail.defectRateHeatmap")}</div>
                  <div className="w-36 h-2 rounded-full bg-linear-to-r from-success/60 via-warning/60 to-destructive/70 mb-1" />
                  <div className="flex justify-between text-[9px] text-muted-foreground/50">
                    <span className="text-success">0%</span>
                    <span>1%</span>
                    <span>2%</span>
                    <span className="text-destructive">3%+</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Info bar */}
        <div className="flex items-center gap-4 px-3 py-1.5 border-t border-border bg-card/60 shrink-0 text-[10px] text-muted-foreground/60">
          <span className="flex items-center gap-1.5"><span className="w-1.75 h-1.75 rounded-full bg-destructive" />{t("stationAnalysis.stationDetail.fail")} <strong className="text-foreground/80">{counts.fail}</strong></span>
          <span className="flex items-center gap-1.5"><span className="w-1.75 h-1.75 rounded-full bg-warning" />{t("stationAnalysis.stationDetail.warn")} <strong className="text-foreground/80">{counts.warn}</strong></span>
          <span className="flex items-center gap-1.5"><span className="w-1.75 h-1.75 rounded-full bg-success" />{t("stationAnalysis.stationDetail.pass")} <strong className="text-foreground/80">{counts.pass}</strong></span>
          <div className="flex-1" />
          {boardInfo && <span>{t("stationAnalysis.stationDetail.board")}: {boardInfo.code} · {boardInfo.model}</span>}
        </div>
      </div>

      {/* ── FLOATING DETAIL PANEL ── */}
      <div
        className={`absolute top-0 right-0 h-full w-92.5 bg-card border-l border-border shadow-[-10px_0_36px_rgba(0,0,0,0.4)] flex flex-col z-30 transition-transform duration-300 ${
          selectedPoint ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {selectedPoint && (
          <>
            {/* Panel header */}
            <div className="px-3.5 py-3 border-b border-border bg-muted/30 flex items-start gap-2.5 shrink-0">
              <div className="flex-1 min-w-0">
                <div className="text-base font-bold leading-tight">{selectedPoint.code}</div>
                <div className="text-[10.5px] text-muted-foreground/60 mt-0.5 truncate">{selectedPoint.name}</div>
                <div className="flex gap-1.5 mt-1.5">
                  {selectedPoint.type && (
                    <span className="px-2 py-0.5 rounded text-[9.5px] font-semibold bg-info/10 border border-info/30 text-info">
                      {selectedPoint.type}
                    </span>
                  )}
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 border ${statusBgDim(selectedPoint.status)} ${statusColor(selectedPoint.status)} ${statusBorder(selectedPoint.status)}`}>
                {selectedPoint.status}
              </span>
              <button
                onClick={() => setSelectedPointId(null)}
                className="w-6 h-6 rounded border border-border bg-muted/30 grid place-items-center text-muted-foreground/60 hover:text-foreground transition-colors shrink-0 text-sm"
              >
                ×
              </button>
            </div>

            {/* Defect rate bar */}
            <div className="flex items-center gap-3 px-3.5 py-2.5 border-b border-border bg-background shrink-0">
              <div className={`text-[28px] font-mono font-bold leading-none min-w-17.5 ${statusColor(selectedPoint.status)}`}>
                {selectedPoint.defectRate}%
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[9.5px] text-muted-foreground/50 uppercase tracking-wider mb-1">{t("stationAnalysis.stationDetail.defectRate")}</div>
                <div className="h-1.25 bg-muted/40 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${statusBg(selectedPoint.status)}`}
                    style={{ width: `${Math.min(selectedPoint.defectRate * 20, 100)}%` }}
                  />
                </div>
                <div className="text-[10px] text-muted-foreground/50 mt-1">
                  {selectedPoint.ngCount} {t("stationAnalysis.kpi.ng")} / {selectedPoint.totalInspected} {t("stationAnalysis.stationDetail.inspected") ?? "inspected"}
                </div>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto">
              {/* Statistics grid */}
              <div className="px-3.5 py-3 border-b border-border">
                <div className="text-[9.5px] font-semibold text-muted-foreground/50 uppercase tracking-widest mb-2 flex items-center gap-2">
                  {t("stationAnalysis.stationDetail.statistics")}
                  <span className="flex-1 h-px bg-border" />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="bg-muted/30 border border-border rounded px-2.5 py-2">
                    <div className={`text-xl font-mono font-bold leading-none ${statusColor(selectedPoint.status)}`}>{selectedPoint.defectRate}%</div>
                    <div className="text-[9.5px] text-muted-foreground/50 mt-0.5">{t("stationAnalysis.stationDetail.defectRate")}</div>
                  </div>
                  <div className="bg-muted/30 border border-border rounded px-2.5 py-2">
                    <div className="text-xl font-mono font-bold leading-none text-destructive">{selectedPoint.ngCount}</div>
                    <div className="text-[9.5px] text-muted-foreground/50 mt-0.5">{t("stationAnalysis.stationDetail.totalDefects")}</div>
                  </div>
                  <div className="bg-muted/30 border border-border rounded px-2.5 py-2">
                    <div className="text-xl font-mono font-bold leading-none">{selectedPoint.totalInspected}</div>
                    <div className="text-[9.5px] text-muted-foreground/50 mt-0.5">{t("stationAnalysis.stationDetail.totalInspected")}</div>
                  </div>
                  <div className="bg-muted/30 border border-border rounded px-2.5 py-2">
                    <div className="text-xl font-mono font-bold leading-none">
                      {selectedPoint.lastValue ?? "—"}
                    </div>
                    <div className="text-[9.5px] text-muted-foreground/50 mt-0.5">{t("stationAnalysis.stationDetail.lastValue")}</div>
                  </div>
                </div>
              </div>

              {/* Measurements */}
              {(selectedPoint.lowerLimit != null || selectedPoint.upperLimit != null || selectedPoint.nominalValue != null) && (
                <div className="px-3.5 py-3 border-b border-border">
                  <div className="text-[9.5px] font-semibold text-muted-foreground/50 uppercase tracking-widest mb-2 flex items-center gap-2">
                    {t("stationAnalysis.stationDetail.measurementSpec")}
                    <span className="flex-1 h-px bg-border" />
                  </div>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-1 px-1.5 text-[9px] font-semibold text-muted-foreground/50 uppercase">{t("stationAnalysis.stationDetail.param")}</th>
                        <th className="text-left py-1 px-1.5 text-[9px] font-semibold text-muted-foreground/50 uppercase">{t("stationAnalysis.stationDetail.value")}</th>
                        <th className="text-left py-1 px-1.5 text-[9px] font-semibold text-muted-foreground/50 uppercase">{t("stationAnalysis.stationDetail.spec")}</th>
                        <th className="text-right py-1 px-1.5 text-[9px] font-semibold text-muted-foreground/50 uppercase">{t("stationAnalysis.stationDetail.result")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPoint.nominalValue != null && (
                        <tr className="border-b border-border/30 hover:bg-accent/20">
                          <td className="py-1.5 px-1.5 text-muted-foreground">{t("stationAnalysis.stationDetail.nominal")}</td>
                          <td className="py-1.5 px-1.5 font-mono font-semibold">{selectedPoint.lastValue ?? "—"} {selectedPoint.unit || ""}</td>
                          <td className="py-1.5 px-1.5 text-muted-foreground/60 text-[10px]">{selectedPoint.nominalValue} {selectedPoint.unit || ""}</td>
                          <td className={`py-1.5 px-1.5 text-right text-[10px] font-bold ${selectedPoint.lastResult === "NG" ? "text-destructive" : "text-success"}`}>
                            {selectedPoint.lastResult || "—"}
                          </td>
                        </tr>
                      )}
                      {selectedPoint.lowerLimit != null && (
                        <tr className="border-b border-border/30 hover:bg-accent/20">
                          <td className="py-1.5 px-1.5 text-muted-foreground">{t("stationAnalysis.stationDetail.lowerLimit")}</td>
                          <td className="py-1.5 px-1.5 font-mono font-semibold">{selectedPoint.lastValue ?? "—"}</td>
                          <td className="py-1.5 px-1.5 text-muted-foreground/60 text-[10px]">≥ {selectedPoint.lowerLimit} {selectedPoint.unit || ""}</td>
                          <td className={`py-1.5 px-1.5 text-right text-[10px] font-bold ${
                            selectedPoint.lastValue != null && Number(selectedPoint.lastValue) < selectedPoint.lowerLimit ? "text-destructive" : "text-success"
                          }`}>
                            {selectedPoint.lastValue != null && Number(selectedPoint.lastValue) < selectedPoint.lowerLimit ? "NG" : "OK"}
                          </td>
                        </tr>
                      )}
                      {selectedPoint.upperLimit != null && (
                        <tr className="border-b border-border/30 hover:bg-accent/20">
                          <td className="py-1.5 px-1.5 text-muted-foreground">{t("stationAnalysis.stationDetail.upperLimit")}</td>
                          <td className="py-1.5 px-1.5 font-mono font-semibold">{selectedPoint.lastValue ?? "—"}</td>
                          <td className="py-1.5 px-1.5 text-muted-foreground/60 text-[10px]">≤ {selectedPoint.upperLimit} {selectedPoint.unit || ""}</td>
                          <td className={`py-1.5 px-1.5 text-right text-[10px] font-bold ${
                            selectedPoint.lastValue != null && Number(selectedPoint.lastValue) > selectedPoint.upperLimit ? "text-destructive" : "text-success"
                          }`}>
                            {selectedPoint.lastValue != null && Number(selectedPoint.lastValue) > selectedPoint.upperLimit ? "NG" : "OK"}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Recent Events */}
              {selectedPoint.events.length > 0 && (
                <div className="px-3.5 py-3 border-b border-border">
                  <div className="text-[9.5px] font-semibold text-muted-foreground/50 uppercase tracking-widest mb-2 flex items-center gap-2">
                    Recent Events
                    <span className="flex-1 h-px bg-border" />
                  </div>
                  <div className="space-y-1.5">
                    {selectedPoint.events.map((ev: any, i: number) => (
                      <div key={i} className="flex items-start gap-2 text-[11px]">
                        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                          ev.result === "NG" ? "bg-destructive" : ev.result === "OK" ? "bg-success" : "bg-warning"
                        }`} />
                        <span className="text-muted-foreground/50 text-[10px] min-w-9 shrink-0">{ev.time}</span>
                        <span className="text-muted-foreground leading-snug">
                          <strong className="text-foreground/80">{ev.result}</strong> — {ev.serial ? `SN: ${ev.serial}` : ""} {ev.value !== "—" ? `Val: ${ev.value}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Error Images (NG) — Hero + Grid Layout */}
              {galleryImages.length > 0 && (
                <div className="px-3.5 py-3 border-b border-border">
                  <h4 className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                    <ImageIcon className="h-3.5 w-3.5 text-destructive" />
                    {selectedPoint.code} — {t("stationAnalysis.stationDetail.errorImages", "Ảnh lỗi")} ({galleryImages.length})
                  </h4>

                  {/* Hero image — latest fail */}
                  <div
                    className="relative w-full aspect-4/3 rounded-md overflow-hidden bg-muted cursor-pointer group mb-2"
                    onClick={() => setLightboxIndex(0)}
                  >
                    <img
                      src={galleryImages[0].thumbnailUrl || galleryImages[0].url}
                      alt={galleryImages[0].title}
                      className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                      loading="eager"
                    />
                    <div className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="absolute bottom-1.5 left-2 right-2 flex items-end justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-[10px] text-white/90 truncate">{galleryImages[0].title}</span>
                      <Maximize2 className="h-3.5 w-3.5 text-white/80 shrink-0" />
                    </div>
                    <div className="absolute top-1.5 left-2">
                      <span className="text-[9px] font-semibold bg-destructive/80 text-white px-1.5 py-0.5 rounded">NG</span>
                    </div>
                  </div>

                  {/* 2×2 grid — next images */}
                  {galleryImages.length > 1 && (
                    <div className="grid grid-cols-2 gap-1.5 mb-2">
                      {galleryImages.slice(1, visibleImageCount).map((img, idx) => (
                        <div
                          key={img.id}
                          className="relative aspect-square rounded-md overflow-hidden bg-muted cursor-pointer group"
                          onClick={() => setLightboxIndex(idx + 1)}
                        >
                          <img
                            src={img.thumbnailUrl || img.url}
                            alt={img.title}
                            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                          <div className="absolute bottom-0.5 left-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="text-[9px] text-white/90 truncate block">{img.description}</span>
                          </div>
                          <div className="absolute top-0.5 right-1">
                            <span className="text-[8px] font-semibold bg-destructive/70 text-white px-1 py-0.5 rounded">NG</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Load more button */}
                  {visibleImageCount < galleryImages.length && (
                    <button
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-colors"
                      onClick={() => setVisibleImageCount(prev => Math.min(prev + 4, galleryImages.length))}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                      {t("common.loadMore", "Xem thêm")} ({galleryImages.length - visibleImageCount})
                    </button>
                  )}
                </div>
              )}

              {/* Lightbox — ImageGallery has its own internal Dialog portal */}
              {lightboxIndex !== null && (
                <div className="hidden">
                  <ImageGallery
                    images={galleryImages}
                    title={`${selectedPoint.code} — ${t("stationAnalysis.stationDetail.errorImages", "Ảnh lỗi")}`}
                    showFilters={false}
                    showSearch={false}
                    columns={3}
                    enableMultiSelect={false}
                    initialSelectedIndex={lightboxIndex}
                    onLightboxClose={() => setLightboxIndex(null)}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
