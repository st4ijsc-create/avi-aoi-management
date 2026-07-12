import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { useEcosystemEvents } from "@/hooks/useEcosystemEvents";
import DashboardLayout from "@/components/DashboardLayout";
import { RelatedViews } from "@/components/RelatedViews";
import { useLocaleDate, getActiveLocale } from "@/lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import ReportExportButton, { type ReportExportConfig } from "@/components/ReportExportButton";
import {
  OFFSCREEN_PRINT_STYLE,
  withScope,
  buildScopeMeta,
  filterStationRows,
  computeFactoryAggregate,
  buildProductionDashboardSections,
  waitForChartRender,
  type ReportTFn,
} from "@/lib/reportSections";
import MachineAISummary from "@/components/MachineAISummary";
import QuickIssueReport from "@/components/QuickIssueReport";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  PageHeader,
  PageContainer,
  MetricCard,
  StatusBadge,
  chartColor,
  chartTooltipStyle,
  chartGridProps,
  chartAxisTick,
  EmptyState,
} from "@/components/patterns";
import {
  Factory,
  Filter,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CalendarDays,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Target,
  BarChart3,
  Link2,
  RefreshCw,
  Layers,
  Sparkles,
  Gauge,
  PackageCheck,
  RotateCcw,
  X,
  ChevronUp,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import { useLocation, useSearch } from "wouter";
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
} from "recharts";
import type { DateRange } from "react-day-picker";

/* ── Date Preset Helpers ── */

type DatePreset = "today" | "yesterday" | "week" | "month" | "year" | "custom";

function getPresetDateRange(preset: DatePreset): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  switch (preset) {
    case "today":
      start.setHours(0, 0, 0, 0);
      break;
    case "yesterday":
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      break;
    case "week":
      start.setDate(start.getDate() - 7);
      break;
    case "month":
      start.setMonth(start.getMonth() - 1);
      break;
    case "year":
      start.setFullYear(start.getFullYear() - 1);
      break;
    default:
      start.setHours(0, 0, 0, 0);
  }
  return { start, end };
}

/* F4a (doc 23): categorical series colours now cycle the DS chart tokens
   (`--chart-1..5`) via chartColor(i) instead of a hardcoded hex palette, so
   charts follow the theme and flip correctly between light/dark. */
const paretoColor = (i: number) => chartColor(i);

/* ── Helpers ── */

function getYieldLevel(value: number | null): "good" | "warn" | "bad" | "none" {
  if (value === null || value === undefined) return "none";
  if (value >= 90) return "good";
  if (value >= 70) return "warn";
  return "bad";
}

const yieldColorMap: Record<string, string> = {
  good: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
  none: "text-muted-foreground/40",
};

const yieldBarBg: Record<string, string> = {
  good: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
  none: "bg-muted",
};

/* doc 46 B8 — a station is "low yield" ONLY when it has real inspection data.
   A 0% first-pass-yield derived from ZERO inspections is NO DATA, not a genuine
   low-yield alarm — flagging those produced ~36 phantom "low yield" stations.
   Requires a has-data guard (totalInspections > 0) AND real low yield, mirroring
   the filterStationRows() predicate so the KPI count, the low-yield filter chip
   and the export all agree. */
function isLowYieldStation(r: { totalInspections?: number; firstPassYield?: number }): boolean {
  return (r.totalInspections ?? 0) > 0 && (r.firstPassYield ?? 0) < 70;
}

/* F4a (doc 23): tag tints now use the SEMANTIC theme tokens (primary/info/
   destructive/warning/success) instead of literal palette classes, so the
   categories stay visually distinct AND flip correctly between light/dark. */
function getDefectTagStyle(code: string, name: string) {
  const lower = (code + " " + name).toLowerCase();
  if (lower.includes("irregular") || lower.includes("shift") || lower.includes("gap") || lower.includes("misalign") || lower.includes("loose") || lower.includes("flatness"))
    return { label: "Irregular", cls: "text-primary border-primary/25 bg-primary/5" };
  if (lower.includes("assy") || lower.includes("missing") || lower.includes("thiếu") || lower.includes("screw") || lower.includes("clip") || lower.includes("orient") || lower.includes("lắp") || lower.includes("lệch") || lower.includes("ssd"))
    return { label: "ASSY", cls: "text-info border-info/25 bg-info/5" };
  if (lower.includes("damage") || lower.includes("buckle") || lower.includes("wrinkle") || lower.includes("scratch") || lower.includes("crack"))
    return { label: "Damage", cls: "text-destructive border-destructive/25 bg-destructive/5" };
  if (lower.includes("pollution") || lower.includes("spot") || lower.includes("stain") || lower.includes("dirt") || lower.includes("dust"))
    return { label: "Pollution", cls: "text-warning border-warning/25 bg-warning/5" };
  if (lower.includes("ntf") || lower.includes("cable") || lower.includes("contact") || lower.includes("lỏng") || lower.includes("flying") || lower.includes("blockage"))
    return { label: "NTF", cls: "text-success border-success/25 bg-success/5" };
  return { label: code || "Other", cls: "text-muted-foreground border-border bg-muted/30" };
}

/* ── PCB Thumbnail ── */

function PcbThumbnail({ seed }: { seed: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = (canvas.width = 136);
    const h = (canvas.height = 104);
    const rng = (s: number) => { const x = Math.sin(s) * 10000; return x - Math.floor(x); };

    ctx.fillStyle = "#1a2035";
    ctx.fillRect(0, 0, w, h);
    // grid
    ctx.strokeStyle = "#253050";
    ctx.lineWidth = 0.5;
    for (let i = 0; i < w; i += 8) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); }
    for (let i = 0; i < h; i += 8) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
    // traces
    const colors = ["#1d4e89", "#1a5c3a", "#5c3a1a"];
    for (let t = 0; t < 8; t++) {
      ctx.strokeStyle = colors[t % 3]; ctx.lineWidth = 1.5; ctx.beginPath();
      let x = rng(seed + t * 7) * w, y = rng(seed + t * 13) * h; ctx.moveTo(x, y);
      for (let s = 0; s < 4; s++) { x = rng(seed + t * 7 + s) * w; y = rng(seed + t * 13 + s) * h; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // components
    const fills = ["#243860", "#1e3b2a", "#3a2418", "#2d2d3a"];
    const strokes = ["#3a5a9a", "#2a6a44", "#7a4a28", "#4a4a6a"];
    for (let c = 0; c < 6; c++) {
      const cx = rng(seed + c * 3 + 1) * (w - 20) + 5;
      const cy = rng(seed + c * 5 + 2) * (h - 16) + 4;
      const cw = rng(seed + c * 7) * 22 + 8;
      const ch = rng(seed + c * 11) * 14 + 6;
      ctx.fillStyle = fills[c % 4]; ctx.fillRect(cx, cy, cw, ch);
      ctx.strokeStyle = strokes[c % 4]; ctx.lineWidth = 0.7; ctx.strokeRect(cx, cy, cw, ch);
    }
    // chip
    const chipX = rng(seed + 99) * (w - 40) + 10;
    const chipY = rng(seed + 77) * (h - 30) + 8;
    ctx.fillStyle = "#111827"; ctx.fillRect(chipX, chipY, 36, 24);
    ctx.strokeStyle = "#4a5c8a"; ctx.lineWidth = 1; ctx.strokeRect(chipX, chipY, 36, 24);
    for (let p = 0; p < 5; p++) {
      ctx.fillStyle = "#8aacdc";
      ctx.fillRect(chipX + 4 + p * 6, chipY - 3, 3, 3);
      ctx.fillRect(chipX + 4 + p * 6, chipY + 24, 3, 3);
    }
  }, [seed]);

  return (
    <div className="w-17 h-13 rounded-md border border-border/50 overflow-hidden shrink-0 bg-muted">
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}

/* ── Row skeleton ── */

const GRID_COLS = "280px 110px 110px 110px 80px 80px 1fr 140px";

function StationRowSkeleton() {
  return (
    <div className="grid items-center px-7 py-3.5 border-b border-border" style={{ gridTemplateColumns: GRID_COLS }}>
      <div className="flex items-center gap-3">
        <Skeleton className="w-17 h-13 rounded-md" />
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2.5 w-40" />
        </div>
      </div>
      <Skeleton className="h-8 w-16 self-center" />
      <Skeleton className="h-8 w-14 self-center" />
      <Skeleton className="h-8 w-16 self-center" />
      <Skeleton className="h-6 w-10 self-center" />
      <Skeleton className="h-6 w-10 self-center" />
      <Skeleton className="h-10 w-full self-center" />
      <Skeleton className="h-8 w-28 self-center justify-self-end" />
    </div>
  );
}

/* ── Report print-view data snapshot (all charts mounted off-screen) ── */
interface ProductionPrintData {
  defect: any;
  trend: any;
  spc: any[];
  rul: any[];
  factoryAgg: ReturnType<typeof computeFactoryAggregate>;
  interval: "hour" | "day" | "week";
}

/* ── Main Component ── */

export default function ProductionDashboard() {
  const { t } = useTranslation();
  const formatDate = useLocaleDate();
  const [, navigate] = useLocation();
  const search = useSearch();
  const initialParams = useMemo(() => new URLSearchParams(search), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [selectedFactory, setSelectedFactory] = useState<string>(() => initialParams.get("factory") || "all");
  const [selectedLine, setSelectedLine] = useState<string>(() => initialParams.get("line") || "all");
  const [activeTab, setActiveTab] = useState(() => initialParams.get("tab") || "station");
  const [lowYieldFilter, setLowYieldFilter] = useState<boolean>(() => initialParams.get("lowYield") === "1");
  const [autoRefresh, setAutoRefresh] = useState<boolean>(() => initialParams.get("autoRefresh") === "1");
  const [compareMode, setCompareMode] = useState<boolean>(() => initialParams.get("compare") === "1");
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [trendInterval, setTrendInterval] = useState<"hour" | "day" | "week">("day");
  // Station-table search is lifted here so the export can honestly reflect the
  // applied filter (search + low-yield) in its scope metadata (doc 32 §6.4 #9).
  const [stationSearch, setStationSearch] = useState("");

  // tRPC utils to prefetch every dataset for the "most complete" export, plus a
  // snapshot of that data that the off-screen print view renders all charts from.
  const utils = trpc.useUtils();
  const [printData, setPrintData] = useState<ProductionPrintData | null>(null);
  const printCleanupRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dateRange = useMemo(() => {
    if (datePreset === "custom" && customRange?.from) {
      return {
        start: customRange.from,
        end: customRange.to || new Date(),
      };
    }
    return getPresetDateRange(datePreset);
  }, [datePreset, customRange]);

  const { data: factoriesData } = trpc.factory.list.useQuery();
  const { data: lines } = trpc.line.list.useQuery();

  const commonInput = {
    factoryId: !compareMode && selectedFactory !== "all" ? Number(selectedFactory) : undefined,
    lineId: !compareMode && selectedLine !== "all" ? Number(selectedLine) : undefined,
    startDate: dateRange.start,
    endDate: dateRange.end,
  };

  const refetchInterval = autoRefresh ? 30000 : false;

  const { data: stationDataRaw, isLoading } = trpc.productionDashboard.getStationOverview.useQuery(
    commonInput,
    { refetchInterval },
  );
  const stationData = Array.isArray(stationDataRaw) ? stationDataRaw : [];

  // Tab-specific queries (only fetch when active)
  const { data: defectData, isLoading: defectLoading } = trpc.productionDashboard.getDefectAnalysis.useQuery(
    commonInput,
    { enabled: activeTab === "defect", refetchInterval: activeTab === "defect" ? refetchInterval : false },
  );
  const { data: trendData, isLoading: trendLoading } = trpc.productionDashboard.getTrendData.useQuery(
    { ...commonInput, interval: trendInterval },
    { enabled: activeTab === "trend", refetchInterval: activeTab === "trend" ? refetchInterval : false },
  );
  const { data: spcData, isLoading: spcLoading } = trpc.productionDashboard.getSpcSummary.useQuery(
    commonInput,
    { enabled: activeTab === "spc", refetchInterval: activeTab === "spc" ? refetchInterval : false },
  );

  // doc 46 FE-W2 — socket-first freshness. Every inspection/quality event on the
  // unified U1 stream (`inspection` | `ng` | `yield` | `spc` | `quality_gate`)
  // invalidates the production datasets so the board updates live even when the
  // opt-in auto-refresh poll is OFF. A short trailing debounce collapses a burst of
  // events into ONE refetch. The Auto-refresh (30s) poll remains the fallback backstop.
  const prodInvalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleProdInvalidate = useCallback(() => {
    if (prodInvalidateTimer.current) clearTimeout(prodInvalidateTimer.current);
    prodInvalidateTimer.current = setTimeout(() => {
      utils.productionDashboard.getStationOverview.invalidate();
      utils.productionDashboard.getDefectAnalysis.invalidate();
      utils.productionDashboard.getTrendData.invalidate();
      utils.productionDashboard.getSpcSummary.invalidate();
    }, 1500);
  }, [utils]);
  useEffect(() => () => { if (prodInvalidateTimer.current) clearTimeout(prodInvalidateTimer.current); }, []);
  const { isConnected: liveConnected } = useEcosystemEvents({
    alertsOnly: true,
    bufferSize: 1,
    onEvent: (evt) => {
      if (
        evt.kind === "inspection" || evt.kind === "ng" || evt.kind === "yield" ||
        evt.kind === "spc" || evt.kind === "quality_gate"
      ) {
        scheduleProdInvalidate();
      }
    },
  });

  // Summary KPIs
  const summary = useMemo(() => {
    if (stationData.length === 0)
      return { totalStations: 0, totalOutput: 0, avgFPY: 0, avgRetests: 0, lowYieldStations: 0 };
    const totalOutput = stationData.reduce((s, r) => s + r.output, 0);
    const totalOK = stationData.reduce((s, r) => s + r.okCount, 0);
    const totalInsp = stationData.reduce((s, r) => s + r.totalInspections, 0);
    const avgFPY = totalInsp > 0 ? (totalOK / totalInsp) * 100 : 0;
    const avgRetests = stationData.reduce((s, r) => s + r.retestRate, 0) / stationData.length;
    // doc 46 B8 — exclude no-data (0 inspections) stations from the low-yield alarm.
    const lowYieldStations = stationData.filter(isLowYieldStation).length;
    return {
      totalStations: stationData.length,
      totalOutput,
      avgFPY: Math.round(avgFPY * 100) / 100,
      avgRetests: Math.round(avgRetests * 100) / 100,
      lowYieldStations,
    };
  }, [stationData]);

  // Per-factory aggregates for compare mode
  const factoryAgg = useMemo(() => {
    if (!compareMode || stationData.length === 0) return [] as Array<{ id: number; name: string; avgFPY: number; output: number; stations: number; lowYield: number }>;
    const map = new Map<number, { id: number; name: string; okSum: number; inspSum: number; output: number; stations: number; lowYield: number }>();
    for (const r of stationData) {
      const f = (r as any).factory;
      if (!f?.id) continue;
      const cur = map.get(f.id) || { id: f.id, name: f.name || `#${f.id}`, okSum: 0, inspSum: 0, output: 0, stations: 0, lowYield: 0 };
      cur.okSum += r.okCount;
      cur.inspSum += r.totalInspections;
      cur.output += r.output;
      cur.stations += 1;
      if (isLowYieldStation(r)) cur.lowYield += 1; // doc 46 B8 — has-data guard
      map.set(f.id, cur);
    }
    return Array.from(map.values()).map((x) => ({
      id: x.id,
      name: x.name,
      avgFPY: x.inspSum > 0 ? Math.round((x.okSum / x.inspSum) * 10000) / 100 : 0,
      output: x.output,
      stations: x.stations,
      lowYield: x.lowYield,
    })).sort((a, b) => b.output - a.output);
  }, [compareMode, stationData]);

  const todayStr = useMemo(
    () => formatDate.long(new Date()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [formatDate.long],
  );

  // ── URL ⇄ State sync ──
  const updateUrl = useCallback(
    (next: { tab?: string; lowYield?: boolean; factory?: string; line?: string; autoRefresh?: boolean; compare?: boolean }) => {
      const params = new URLSearchParams(window.location.search);
      const tab = next.tab ?? activeTab;
      const ly = next.lowYield ?? lowYieldFilter;
      const fac = next.factory ?? selectedFactory;
      const ln = next.line ?? selectedLine;
      const ar = next.autoRefresh ?? autoRefresh;
      const cmp = next.compare ?? compareMode;
      if (tab && tab !== "station") params.set("tab", tab); else params.delete("tab");
      if (ly) params.set("lowYield", "1"); else params.delete("lowYield");
      if (fac && fac !== "all") params.set("factory", fac); else params.delete("factory");
      if (ln && ln !== "all") params.set("line", ln); else params.delete("line");
      if (ar) params.set("autoRefresh", "1"); else params.delete("autoRefresh");
      if (cmp) params.set("compare", "1"); else params.delete("compare");
      const qs = params.toString();
      navigate(`/production-dashboard${qs ? `?${qs}` : ""}`, { replace: true } as any);
    },
    [activeTab, lowYieldFilter, selectedFactory, selectedLine, autoRefresh, compareMode, navigate],
  );

  const handleTabChange = useCallback(
    (tab: string) => {
      setActiveTab(tab);
      updateUrl({ tab });
    },
    [updateUrl],
  );

  const handleLowYieldClick = useCallback(() => {
    const next = !lowYieldFilter;
    setLowYieldFilter(next);
    setActiveTab("station");
    updateUrl({ tab: "station", lowYield: next });
  }, [lowYieldFilter, updateUrl]);

  // Sync state when URL changes (back/forward)
  useEffect(() => {
    const params = new URLSearchParams(search);
    const urlTab = params.get("tab") || "station";
    const urlLY = params.get("lowYield") === "1";
    const urlFac = params.get("factory") || "all";
    const urlLine = params.get("line") || "all";
    const urlCmp = params.get("compare") === "1";
    if (urlTab !== activeTab) setActiveTab(urlTab);
    if (urlLY !== lowYieldFilter) setLowYieldFilter(urlLY);
    if (urlFac !== selectedFactory) setSelectedFactory(urlFac);
    if (urlLine !== selectedLine) setSelectedLine(urlLine);
    if (urlCmp !== compareMode) setCompareMode(urlCmp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Keep the off-screen print view mounted long enough for the export capture to
  // finish, then unmount it to free the recharts instances.
  const schedulePrintCleanup = useCallback(() => {
    if (printCleanupRef.current) clearTimeout(printCleanupRef.current);
    printCleanupRef.current = setTimeout(() => setPrintData(null), 20000);
  }, []);
  useEffect(() => () => { if (printCleanupRef.current) clearTimeout(printCleanupRef.current); }, []);

  // Async prefetch so the export always carries EVERY chart + full data, no matter
  // which tab is active (doc 32 §6.2). Datasets are fetched via tRPC utils, an
  // off-screen print view mounts all charts, then sections reference their ids.
  const getExportConfig = useCallback(async (): Promise<ReportExportConfig> => {
    const dateStr = `${formatDate.short(dateRange.start)} — ${formatDate.short(dateRange.end)}`;

    const [defectRes, trendRes, spcRes, rulRes] = await Promise.allSettled([
      utils.productionDashboard.getDefectAnalysis.fetch(commonInput),
      utils.productionDashboard.getTrendData.fetch({ ...commonInput, interval: trendInterval }),
      utils.productionDashboard.getSpcSummary.fetch(commonInput),
      utils.predictiveMaintenance.listRulForecast.fetch({ limit: 50 }).catch(() => []),
    ]);
    const val = <T,>(r: PromiseSettledResult<T>): T | undefined => (r.status === "fulfilled" ? r.value : undefined);
    const defect = val(defectRes) as any;
    const trend = val(trendRes) as any;
    const spc = ((val(spcRes) as any[]) || []) as any[];
    const rul = ((val(rulRes) as any[]) || []) as any[];

    const factoryAgg = computeFactoryAggregate(stationData);
    const filteredRows = filterStationRows(stationData, { search: stationSearch, lowYield: lowYieldFilter });
    const stationRowsFiltered = !!(stationSearch.trim() || lowYieldFilter);

    // Mount off-screen charts + wait for recharts layout/animation before capture.
    setPrintData({ defect, trend, spc, rul, factoryAgg, interval: trendInterval });
    await waitForChartRender();
    schedulePrintCleanup();

    const sections = buildProductionDashboardSections({
      t: t as unknown as ReportTFn,
      summary,
      stationRows: filteredRows,
      stationRowsFiltered,
      defectData: defect,
      trendData: trend,
      spcData: spc,
      rulData: rul,
      factoryAgg,
    });

    const factoryName = factoriesData?.find((f: any) => String(f.id) === selectedFactory)?.name;
    const lineName = lines?.find((l: any) => String(l.id) === selectedLine)?.name;
    const scope = buildScopeMeta({
      factory: selectedFactory === "all" ? undefined : factoryName || `#${selectedFactory}`,
      line: selectedLine === "all" ? undefined : lineName || `#${selectedLine}`,
      dateRange: dateStr,
      interval: trendInterval,
      search: stationSearch.trim() || undefined,
      lowYield: lowYieldFilter ? "FPY < 70%" : undefined,
      compareMode: compareMode ? "on" : undefined,
      stationRows: stationRowsFiltered ? "filtered view" : "all rows",
    });

    return withScope(
      {
        title: t("productionDashboard.exportTitle", "Production Dashboard Report"),
        subtitle: dateStr,
        sections,
        filenamePrefix: "production_dashboard",
        orientation: "landscape",
      } as ReportExportConfig,
      { scope, filters: scope },
    );
  }, [
    t, utils, commonInput, stationData, summary, dateRange, formatDate, trendInterval,
    stationSearch, lowYieldFilter, selectedFactory, selectedLine, compareMode,
    factoriesData, lines, schedulePrintCleanup,
  ]);

  return (
    <DashboardLayout>
      {/* ── Off-screen report print view: mounts EVERY chart from prefetched data
          so ReportExportButton can capture them regardless of the active tab
          (doc 32 §6.5). Rendered first so getElementById resolves these
          light-themed copies. ── */}
      {printData && (
        <div style={OFFSCREEN_PRINT_STYLE} aria-hidden data-report-print-view>
          <div style={{ padding: 24 }}>
            {printData.factoryAgg.length > 0 && (
              <div id="chart-factory-compare" style={{ width: 1040, height: 300, background: "#fff", marginBottom: 24 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={printData.factoryAgg} margin={{ top: 10, right: 16, left: 0, bottom: 24 }}>
                    <CartesianGrid {...chartGridProps} opacity={0.2} />
                    <XAxis dataKey="name" tick={chartAxisTick} interval={0} angle={-15} textAnchor="end" height={50} />
                    <YAxis yAxisId="left" tick={chartAxisTick} domain={[0, 100]} />
                    <YAxis yAxisId="right" orientation="right" tick={chartAxisTick} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="right" dataKey="output" name={t("productionDashboard.totalOutput", "Total Output")} fill={chartColor(0)} isAnimationActive={false} radius={[4, 4, 0, 0]} />
                    <Line yAxisId="left" type="monotone" dataKey="avgFPY" name={t("productionDashboard.avgFPY", "Avg FPY")} stroke={chartColor(1)} strokeWidth={2} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
            <DefectAnalysisTab data={printData.defect} isLoading={false} navigate={() => {}} t={t} />
            <TrendTab data={printData.trend} isLoading={false} interval={printData.interval} onIntervalChange={() => {}} t={t} />
            {printData.spc.length > 0 && (
              <SpcTab data={printData.spc.slice(0, 15) as any} isLoading={false} navigate={() => {}} t={t} datePreset={datePreset} dateRange={dateRange} />
            )}
            {printData.rul.length > 0 && (
              <div id="chart-machine-rul" style={{ width: 1040, height: 300, background: "#fff", marginTop: 24 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={printData.rul.map((m: any) => ({ code: m.machineCode, risk: Math.round((m.failureRisk || 0) * 100) }))}
                    margin={{ top: 10, right: 16, left: 0, bottom: 40 }}
                  >
                    <CartesianGrid {...chartGridProps} opacity={0.2} />
                    <XAxis dataKey="code" tick={chartAxisTick} interval={0} angle={-25} textAnchor="end" height={60} />
                    <YAxis domain={[0, 100]} tick={chartAxisTick} tickFormatter={(v) => `${v}%`} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Bar dataKey="risk" name={t("productionDashboard.machineRul", "Failure Risk %")} fill={chartColor(3)} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}
      {/* F4a: adopt the DS PageContainer shell (fluid = full-bleed monitor page).
          Padding/rhythm are zeroed here because this dense layout owns its own
          edge-to-edge sticky strips + horizontal-scroll table. */}
      <PageContainer fluid className="flex flex-col min-h-0 p-0 md:p-0 space-y-0">
        {/* ── Page header (F4a: visible <h1> via PageHeader, replacing the
            former sr-only heading) + KPI cards ── */}
        <div className="bg-card border-b border-border px-3 sm:px-7 py-3 sm:py-4">
          <PageHeader
            icon={<Factory className="h-6 w-6" />}
            title={t("productionDashboard.pageTitle", "Production Dashboard")}
            description={`${t("productionDashboard.todayLabel", "Today")} · ${todayStr}`}
            actions={
              liveConnected ? (
                <span className="inline-flex items-center gap-2 border border-success/30 bg-success/10 rounded-full px-3 py-1" title={t("productionDashboard.liveHint", "Live updates over socket")}>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
                  </span>
                  <span className="text-xs font-medium text-success">{t("productionDashboard.live", "Live")}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 border border-warning/30 bg-warning/10 rounded-full px-3 py-1" title={t("productionDashboard.pollingHint", "Socket offline — using refresh fallback")}>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-warning" />
                  <span className="text-xs font-medium text-warning">{t("productionDashboard.polling", "Polling")}</span>
                </span>
              )
            }
          />

          {/* ── KPI cards (F4a: responsive MetricCard grid, replacing the dense
              horizontal scroll-strip) ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
            <MetricCard
              icon={<Factory className="h-4 w-4" />}
              label={t("productionDashboard.totalStations", "Stations")}
              value={summary.totalStations}
            />
            <MetricCard
              icon={<Gauge className="h-4 w-4" />}
              label={t("productionDashboard.avgFPY", "Avg First Pass Yield")}
              value={`${summary.avgFPY.toFixed(1)}%`}
              tone="success"
            />
            <MetricCard
              icon={<PackageCheck className="h-4 w-4" />}
              label={t("productionDashboard.totalOutput", "Total Output")}
              value={summary.totalOutput.toLocaleString()}
            />
            <MetricCard
              icon={<RotateCcw className="h-4 w-4" />}
              label={t("productionDashboard.avgRetests", "Avg Retests")}
              value={`${summary.avgRetests.toFixed(1)}%`}
              tone={summary.avgRetests > 5 ? "danger" : summary.avgRetests > 2 ? "warning" : "default"}
            />
            <button
              type="button"
              onClick={handleLowYieldClick}
              title={t("productionDashboard.lowYieldFilterHint", "Click to filter low-yield stations")}
              aria-pressed={lowYieldFilter}
              className={`text-left rounded-xl transition-shadow focus:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                lowYieldFilter ? "ring-1 ring-warning/50" : ""
              }`}
            >
              <MetricCard
                icon={<AlertTriangle className="h-4 w-4" />}
                label={t("productionDashboard.lowYieldStations", "Low Yield Stations")}
                value={summary.lowYieldStations}
                tone={summary.lowYieldStations > 0 ? "warning" : "default"}
                delta={
                  lowYieldFilter
                    ? t("productionDashboard.lowYieldFilterActive", "Filter active")
                    : undefined
                }
                className={lowYieldFilter ? "bg-warning/5" : undefined}
              />
            </button>
          </div>
        </div>

        {/* U7 cross-links — station-level production view; MES Control Tower + the
            Command Center give the broader hub / panorama. */}
        <div className="bg-card border-b border-border px-3 sm:px-7 py-2">
          <RelatedViews
            links={[
              { href: "/mes-control-tower", labelKey: "nav.mesControlTower", labelDefault: "MES Control Tower" },
              { href: "/command-center", labelKey: "nav.commandCenter", labelDefault: "Command Center" },
            ]}
          />
        </div>

        {/* ── Toolbar (F4a: grouped + wraps responsively instead of one long
            horizontal scroll strip) ── */}
        <div className="bg-card border-b border-border px-3 sm:px-7 py-2 sm:py-2.5 flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Tabs */}
          <div className="flex flex-wrap gap-0.5 bg-background border border-border rounded-lg p-0.5 shrink-0">
            {[
              { key: "station", label: t("productionDashboard.tabStation", "Station View") },
              { key: "defect", label: t("productionDashboard.tabDefect", "Defect Analysis") },
              { key: "trend", label: t("productionDashboard.tabTrend", "Trend") },
              { key: "spc", label: t("productionDashboard.tabSpc", "SPC") },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`px-3.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  activeTab === tab.key
                    ? "bg-secondary text-foreground border border-border"
                    : "text-muted-foreground/60 hover:text-muted-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="w-px h-6 bg-border shrink-0 hidden sm:block" />

          {/* Date Presets */}
          <div className="flex flex-wrap gap-0.5 bg-background border border-border rounded-lg p-0.5 shrink-0">
            {([
              { key: "today", label: t("productionDashboard.today", "Today") },
              { key: "yesterday", label: t("productionDashboard.yesterday", "Yesterday") },
              { key: "week", label: t("productionDashboard.week", "1 Week") },
              { key: "month", label: t("productionDashboard.month", "1 Month") },
              { key: "year", label: t("productionDashboard.year", "Year") },
            ] as const).map((p) => (
              <button
                key={p.key}
                onClick={() => setDatePreset(p.key)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  datePreset === p.key
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "text-muted-foreground/60 hover:text-muted-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1 ${
                    datePreset === "custom"
                      ? "bg-primary/15 text-primary border border-primary/30"
                      : "text-muted-foreground/60 hover:text-muted-foreground"
                  }`}
                >
                  <CalendarDays className="h-3 w-3" />
                  {datePreset === "custom" && customRange?.from
                    ? `${formatDate.short(customRange.from)}${customRange.to ? ` – ${formatDate.short(customRange.to)}` : ""}`
                    : t("productionDashboard.custom", "Custom")}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={customRange}
                  onSelect={(range) => {
                    setCustomRange(range);
                    setDatePreset("custom");
                  }}
                  numberOfMonths={2}
                  disabled={{ after: new Date() }}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="hidden lg:block flex-1" />

          {/* Filters */}
          <Select
            value={selectedFactory}
            onValueChange={(val) => {
              setSelectedFactory(val);
              setSelectedLine("all");
              updateUrl({ factory: val, line: "all" });
            }}
          >
            <SelectTrigger className="w-40 h-8 text-xs shrink-0">
              <Filter className="h-3 w-3 mr-1.5 opacity-50" />
              <SelectValue placeholder={t("productionDashboard.allFactories", "All Factories")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("productionDashboard.allFactories", "All Factories")}</SelectItem>
              {factoriesData?.map((f: any) => (
                <SelectItem key={f.id} value={String(f.id)}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedLine} onValueChange={(val) => { setSelectedLine(val); updateUrl({ line: val }); }}>
            <SelectTrigger className="w-40 h-8 text-xs shrink-0">
              <SelectValue placeholder={t("productionDashboard.allLines", "All Lines")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("productionDashboard.allLines", "All Lines")}</SelectItem>
              {lines?.map((l: any) => (
                <SelectItem key={l.id} value={String(l.id)}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs shrink-0"
            onClick={() => {
              const next = !autoRefresh;
              setAutoRefresh(next);
              updateUrl({ autoRefresh: next });
              toast.success(
                next
                  ? t("productionDashboard.autoRefreshOn", "Auto-refresh enabled (every 30s)")
                  : t("productionDashboard.autoRefreshOff", "Auto-refresh disabled"),
              );
            }}
            aria-label={t("productionDashboard.toggleAutoRefresh", "Toggle auto-refresh")}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${autoRefresh ? "animate-spin" : ""}`} />
            {autoRefresh
              ? t("productionDashboard.autoRefreshOnLabel", "Auto 30s")
              : t("productionDashboard.autoRefreshLabel", "Auto-refresh")}
          </Button>

          <Button
            variant={compareMode ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs shrink-0"
            onClick={() => {
              const next = !compareMode;
              setCompareMode(next);
              // When entering compare mode, clear single-factory filter so we see all
              if (next && selectedFactory !== "all") {
                setSelectedFactory("all");
                setSelectedLine("all");
                updateUrl({ compare: next, factory: "all", line: "all" });
              } else {
                updateUrl({ compare: next });
              }
              toast.success(
                next
                  ? t("productionDashboard.compareOn", "Factory comparison enabled")
                  : t("productionDashboard.compareOff", "Factory comparison disabled"),
              );
            }}
            aria-label={t("productionDashboard.toggleCompare", "Toggle factory comparison")}
            title={t("productionDashboard.compareHint", "Compare KPIs across factories")}
          >
            <Layers className="h-3 w-3 mr-1" />
            {t("productionDashboard.compareFactories", "Compare")}
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs shrink-0"
            onClick={() => {
              const url = window.location.href;
              navigator.clipboard?.writeText(url).then(
                () => toast.success(t("productionDashboard.linkCopied", "Link copied to clipboard")),
                () => toast.error(t("productionDashboard.linkCopyFailed", "Failed to copy link")),
              );
            }}
            aria-label={t("productionDashboard.copyLink", "Copy link with current filters")}
          >
            <Link2 className="h-3 w-3 mr-1" />
            {t("productionDashboard.copyLink", "Copy link")}
          </Button>

          {/* Operator 1-tap issue report → AI-classified → routed to Andon. */}
          <QuickIssueReport size="sm" className="h-8 text-xs shrink-0" />

          <ReportExportButton getConfig={getExportConfig} />
        </div>

        {/* ── AI signals (production-embedded) ── */}
        <MachineAISignalsSection t={t} />

        {/* ── Tab Content ── */}
        <div className="overflow-auto flex-1">
          {compareMode && factoryAgg.length > 0 && (
            <div className="px-3 sm:px-7 pt-3 sm:pt-4">
              <div className="bg-card border border-border rounded-md p-3 sm:p-4">
                <div className="flex items-center justify-between mb-2 sm:mb-3 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">
                      {t("productionDashboard.compareTitle", "Factory Comparison")}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      ({factoryAgg.length} {t("productionDashboard.factoriesShort", "factories")})
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {t("productionDashboard.compareHint", "Compare KPIs across factories")}
                  </span>
                </div>
                <div id="chart-factory-compare" className="h-56 sm:h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={factoryAgg} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
                      <CartesianGrid {...chartGridProps} opacity={0.2} />
                      <XAxis dataKey="name" tick={chartAxisTick} interval={0} angle={-15} textAnchor="end" height={50} />
                      <YAxis yAxisId="left" tick={chartAxisTick} label={{ value: "%", position: "insideLeft", fontSize: 10 }} domain={[0, 100]} />
                      <YAxis yAxisId="right" orientation="right" tick={chartAxisTick} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="right" dataKey="output" name={t("productionDashboard.totalOutput", "Total Output")} fill={chartColor(0)} radius={[4, 4, 0, 0]} />
                      <Line yAxisId="left" type="monotone" dataKey="avgFPY" name={t("productionDashboard.avgFPY", "Avg FPY")} stroke={chartColor(1)} strokeWidth={2} dot={{ r: 4 }} />
                      <ReferenceLine yAxisId="left" y={70} stroke="var(--destructive)" strokeDasharray="4 4" label={{ value: "70%", fontSize: 10, fill: "var(--destructive)" }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mt-3">
                  {factoryAgg.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => {
                        setCompareMode(false);
                        setSelectedFactory(String(f.id));
                        updateUrl({ compare: false, factory: String(f.id) });
                      }}
                      className="text-left bg-muted/40 hover:bg-muted rounded p-2 transition-colors"
                      title={t("productionDashboard.drilldownFactory", "Click to filter by this factory")}
                    >
                      <div className="text-xs font-medium truncate">{f.name}</div>
                      <div className="text-[11px] text-muted-foreground flex items-center justify-between mt-0.5">
                        <span>FPY: <b className={f.avgFPY < 70 ? "text-destructive" : "text-success"}>{f.avgFPY}%</b></span>
                        <span>{f.output.toLocaleString()}</span>
                      </div>
                      {f.lowYield > 0 && (
                        <div className="text-[10px] text-warning mt-0.5 flex items-center gap-1">
                          <AlertTriangle className="h-2.5 w-2.5" /> {f.lowYield} {t("productionDashboard.lowYieldStations", "Low Yield")}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {activeTab === "station" && (
            <StationViewTab
              stationData={stationData}
              isLoading={isLoading}
              navigate={navigate}
              t={t}
              datePreset={datePreset}
              dateRange={dateRange}
              lowYieldFilter={lowYieldFilter}
              searchText={stationSearch}
              onSearchChange={setStationSearch}
              onClearLowYieldFilter={() => {
                setLowYieldFilter(false);
                updateUrl({ lowYield: false });
              }}
            />
          )}

          {activeTab === "defect" && (
            <DefectAnalysisTab
              data={defectData}
              isLoading={defectLoading}
              navigate={navigate}
              t={t}
            />
          )}

          {activeTab === "trend" && (
            <TrendTab
              data={trendData}
              isLoading={trendLoading}
              interval={trendInterval}
              onIntervalChange={setTrendInterval}
              t={t}
            />
          )}

          {activeTab === "spc" && (
            <SpcTab
              data={spcData as any}
              isLoading={spcLoading}
              navigate={navigate}
              t={t}
              datePreset={datePreset}
              dateRange={dateRange}
            />
          )}
        </div>
      </PageContainer>

      <style>{`
        @keyframes rowFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </DashboardLayout>
  );
}

/* ══════════════════════════════════════════════════════════
   AI Signals Section (production-embedded MachineAISummary cards)
   ══════════════════════════════════════════════════════════ */

function MachineAISignalsSection({ t }: { t: any }) {
  const [collapsed, setCollapsed] = useState(false);
  // Top machines by failure risk — guarded: renders nothing if the procedure
  // is unavailable / empty so the dashboard is unaffected when PdM is off.
  const { data, isLoading } = trpc.predictiveMaintenance.listRulForecast.useQuery(
    { limit: 6 },
    { staleTime: 60_000, retry: false },
  );
  const machines = Array.isArray(data) ? data : [];

  // Hide entirely when there is no PdM data (no noise on the kiosk).
  if (!isLoading && machines.length === 0) return null;

  return (
    <div className="px-3 sm:px-7 pt-3 sm:pt-4">
      <div id="chart-machine-rul" className="bg-card border border-border rounded-md p-3 sm:p-4">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center justify-between w-full mb-2"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">
              {t("machineAI.sectionTitle", "Tín hiệu AI theo máy")}
            </h3>
            <span className="text-xs text-muted-foreground">
              {t("machineAI.sectionHint", "Rủi ro hỏng hóc · bất thường · khuyến nghị")}
            </span>
          </div>
          {collapsed ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {!collapsed && (
          isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28 w-full rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {machines.map((m: any) => (
                <MachineAISummary
                  key={m.machineId}
                  machineId={m.machineId}
                  machineCode={m.machineCode}
                  machineName={m.machineName}
                  compact
                />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Station View Tab (existing table)
   ══════════════════════════════════════════════════════════ */

function StationViewTab({
  stationData,
  isLoading,
  navigate,
  t,
  datePreset,
  dateRange,
  lowYieldFilter,
  searchText,
  onSearchChange,
  onClearLowYieldFilter,
}: {
  stationData: any[];
  isLoading: boolean;
  navigate: (path: string) => void;
  t: any;
  datePreset: string;
  dateRange: { start: Date; end: Date };
  lowYieldFilter?: boolean;
  searchText: string;
  onSearchChange: (v: string) => void;
  onClearLowYieldFilter?: () => void;
}) {
  const setSearchText = onSearchChange;

  const filteredData = useMemo(
    () => filterStationRows(stationData, { search: searchText, lowYield: lowYieldFilter }),
    [stationData, searchText, lowYieldFilter],
  );

  return (
    <div className="min-w-275">
      {/* Search Bar */}
      <div className="px-7 py-2.5 border-b border-border bg-card sticky top-0 z-20 flex items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder={t("productionDashboard.searchStation", "Search station name, code, line...")}
            className="w-full h-8 pl-8 pr-3 rounded-md border border-border bg-background text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {searchText && (
            <button
              onClick={() => setSearchText("")}
              aria-label={t("common.clear", "Clear")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {lowYieldFilter && (
          <button
            type="button"
            onClick={onClearLowYieldFilter}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-medium bg-warning/10 text-warning border border-warning/30 hover:bg-warning/20"
            title={t("productionDashboard.clearLowYieldFilter", "Clear filter")}
          >
            <AlertTriangle className="h-3 w-3" />
            {t("productionDashboard.lowYieldFilterChip", "Low Yield Stations (FPY < 70%)")}
            <X className="h-3 w-3 ml-1 opacity-70" />
          </button>
        )}
      </div>

      {/* Table Header */}
      <div
        className="grid px-7 py-2.5 border-b border-border bg-card sticky top-10.25 z-10"
        style={{ gridTemplateColumns: GRID_COLS }}
      >
        {[
          { label: t("productionDashboard.colStation", "Station"), sort: false },
          { label: t("productionDashboard.colFPY", "First Pass Yield"), sort: true },
          { label: t("productionDashboard.colChange", "Point Change"), sort: true },
          { label: t("productionDashboard.colFinalYield", "Final Yield"), sort: true },
          { label: t("productionDashboard.colOutput", "Output"), sort: true },
          { label: t("productionDashboard.colRetests", "Retests"), sort: true },
          { label: t("productionDashboard.colTopDefects", "Top Issues"), sort: false },
          { label: "", sort: false },
        ].map((col, i) => (
          <div
            key={i}
            className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider select-none"
          >
            {col.label}
            {col.sort && <ArrowUpDown className="h-2.5 w-2.5 opacity-40" />}
          </div>
        ))}
      </div>

      {/* Rows */}
      {isLoading ? (
        <div>
          {Array.from({ length: 6 }).map((_, i) => (
            <StationRowSkeleton key={i} />
          ))}
        </div>
      ) : filteredData.length === 0 ? (
        searchText ? (
          <EmptyState
            variant="no-results"
            icon={Search}
            title={t("productionDashboard.noSearchResultsTitle", "No matching stations")}
            description={t("productionDashboard.noSearchResults", "No stations match '{{query}}'.", { query: searchText })}
          />
        ) : (
          <EmptyState
            variant="no-data"
            icon={Factory}
            title={t("productionDashboard.noStationsTitle", "No station data")}
            description={t("productionDashboard.noStations", "No station data found for the selected filters.")}
          />
        )
      ) : (
        <div>
          {filteredData.map((row: any, idx: number) => {
            const isNoData = row.totalInspections === 0;
            const fpyLevel = getYieldLevel(isNoData ? null : row.firstPassYield);
            const fyLevel = getYieldLevel(isNoData ? null : row.finalYield);
            const changeDir =
              row.yieldChange > 0 ? "up" : row.yieldChange < 0 ? "down" : "neutral";

            return (
              <div
                key={row.station.id}
                className={`grid px-7 py-3.5 border-b border-border items-center transition-colors duration-100 hover:bg-accent/30 ${
                  isNoData ? "opacity-50" : ""
                }`}
                style={{
                  gridTemplateColumns: GRID_COLS,
                  animation: `rowFadeIn 0.3s ease both`,
                  animationDelay: `${idx * 50}ms`,
                }}
              >
                {/* Station Info */}
                <div className="flex items-center gap-3 min-w-0">
                  {row.latestProductImage ? (
                    <div className="w-17 h-13 rounded-md border border-border/50 overflow-hidden shrink-0 bg-muted">
                      <img
                        src={row.latestProductImage}
                        alt={row.station.name}
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).parentElement!.innerHTML = ''; }}
                      />
                    </div>
                  ) : (
                    <PcbThumbnail seed={row.station.id * 31 + 17} />
                  )}
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold truncate">
                      {row.station.code}: {row.station.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground/60 font-mono mt-0.5 truncate">
                      {row.workshop?.name || row.line?.name || ""}
                    </div>
                    <div className="text-[10.5px] text-muted-foreground/40 mt-0.5">
                      {row.machineCount} {t("productionDashboard.imageMonitors", "Image monitors")} &bull; {row.measurementPointCount} {t("productionDashboard.measurements", "Measurements")}
                    </div>
                  </div>
                </div>

                {/* First Pass Yield */}
                <div className="flex flex-col gap-0.5">
                  <span
                    className={`font-mono text-base font-semibold leading-none ${
                      isNoData ? "text-muted-foreground/40" : yieldColorMap[fpyLevel]
                    }`}
                  >
                    {isNoData ? "— %" : `${row.firstPassYield.toFixed(1)}%`}
                  </span>
                  <div className="h-0.75 bg-border rounded-sm overflow-hidden mt-1 w-full">
                    <div
                      className={`h-full rounded-sm transition-all duration-1000 ease-out ${yieldBarBg[fpyLevel]}`}
                      style={{ width: isNoData ? "0%" : `${Math.min(row.firstPassYield, 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground/50 leading-none mt-0.5">
                    {t("productionDashboard.firstPassYieldLabel", "First pass yield")}
                  </span>
                </div>

                {/* Point Change */}
                <div className="flex flex-col gap-0.5">
                  <span
                    className={`font-mono text-[15px] font-semibold leading-none flex items-center gap-1 ${
                      changeDir === "up"
                        ? "text-success"
                        : changeDir === "down"
                          ? "text-destructive"
                          : "text-muted-foreground/40"
                    }`}
                  >
                    {isNoData ? "--" : `${Math.abs(row.yieldChange).toFixed(1)}%`}
                    {changeDir === "up" && <ArrowUp className="h-2.5 w-2.5" />}
                    {changeDir === "down" && <ArrowDown className="h-2.5 w-2.5" />}
                  </span>
                  <span className="text-[10px] text-muted-foreground/50 leading-none mt-0.5">
                    {t("productionDashboard.pointChangeLabel", "Point change")}
                  </span>
                </div>

                {/* Final Yield */}
                <div className="flex flex-col gap-0.5">
                  <span
                    className={`font-mono text-base font-semibold leading-none ${
                      isNoData ? "text-muted-foreground/40" : ""
                    }`}
                  >
                    {isNoData ? "— %" : `${row.finalYield.toFixed(1)}%`}
                  </span>
                  <div className="h-0.75 bg-border rounded-sm overflow-hidden mt-1 w-full">
                    <div
                      className={`h-full rounded-sm transition-all duration-1000 ease-out ${yieldBarBg[fyLevel]}`}
                      style={{ width: isNoData ? "0%" : `${Math.min(row.finalYield, 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground/50 leading-none mt-0.5">
                    {t("productionDashboard.finalYieldLabel", "Final yield")}
                  </span>
                </div>

                {/* Output */}
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[15px] font-semibold leading-none">
                    {row.output.toLocaleString()}
                  </span>
                  <span className="text-[10px] text-muted-foreground/50 leading-none mt-0.5">{t("productionDashboard.outputLabel", "Output")}</span>
                </div>

                {/* Retests */}
                <div className="flex flex-col gap-0.5">
                  <span
                    className={`font-mono text-[15px] font-semibold leading-none ${
                      isNoData
                        ? "text-muted-foreground/40"
                        : row.retestRate > 5
                          ? "text-warning"
                          : ""
                    }`}
                  >
                    {isNoData ? "— %" : `${row.retestRate.toFixed(1)}%`}
                  </span>
                  <span className="text-[10px] text-muted-foreground/50 leading-none mt-0.5">{t("productionDashboard.retestsLabel", "Retests")}</span>
                </div>

                {/* Top Issues */}
                <div className="flex flex-col gap-1 pr-4">
                  {row.topDefects.length === 0 ? (
                    <span className="text-[11px] text-muted-foreground/40">
                      {t("productionDashboard.noDefects", "No defect data")}
                    </span>
                  ) : (
                    row.topDefects.map((defect: any) => {
                      const tag = getDefectTagStyle(defect.code || "", defect.name || "");
                      return (
                        <div key={defect.pointDefId} className="flex items-center gap-1.5 text-[11px]">
                          <span
                            className={`border rounded px-1 py-px text-[9.5px] font-mono whitespace-nowrap ${tag.cls}`}
                          >
                            [{tag.label}]
                          </span>
                          <span className="text-muted-foreground truncate max-w-32.5">
                            {defect.name}
                          </span>
                          <span className="font-mono font-semibold min-w-8 text-right">
                            {defect.percentage.toFixed(1)}%
                          </span>
                          <button
                            onClick={() => navigate(`/correlation-analysis?pointDefId=${defect.pointDefId}`)}
                            className="text-[10px] text-primary hover:underline whitespace-nowrap shrink-0 inline-flex items-center gap-0.5"
                          >
                            {t("productionDashboard.correlate", "Correlate")}
                            <ExternalLink className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* View Button */}
                <div className="flex justify-end">
                  <button
                    onClick={() => navigate(`/station-analysis/${row.station.id}?dp=${datePreset}&from=${dateRange.start.toISOString()}&to=${dateRange.end.toISOString()}`)}
                    className="bg-primary hover:bg-primary/90 active:translate-y-0 text-primary-foreground rounded-md px-3.5 py-2 text-xs font-semibold transition-all hover:-translate-y-px whitespace-nowrap"
                  >
                    {t("productionDashboard.viewTopIssues", "View top issues")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Defect Analysis Tab
   ══════════════════════════════════════════════════════════ */

function DefectAnalysisTab({
  data,
  isLoading,
  navigate,
  t,
}: {
  data: any;
  isLoading: boolean;
  navigate: (path: string) => void;
  t: any;
}) {
  if (isLoading) {
    return (
      <div className="p-4 sm:p-7 grid grid-cols-1 md:grid-cols-2 gap-6">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-card border border-border rounded-xl p-6">
            <Skeleton className="h-5 w-40 mb-4" />
            <Skeleton className="h-65 w-full" />
          </div>
        ))}
      </div>
    );
  }

  const defectsByType = data?.defectsByType || [];
  const defectsByStation = data?.defectsByStation || [];

  if (defectsByType.length === 0 && defectsByStation.length === 0) {
    return (
      <EmptyState
        variant="no-analytics"
        icon={BarChart3}
        title={t("productionDashboard.noDefectDataTitle", "No defect data")}
        description={t("productionDashboard.noDefectData", "No defect data for the selected period")}
      />
    );
  }

  return (
    <div className="p-4 sm:p-7 space-y-6">
      {/* Pareto Chart + Table */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Pareto Bar Chart */}
        <div id="chart-defect-pareto" className="bg-card border border-border rounded-xl p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            {t("productionDashboard.defectPareto", "Defect Pareto Analysis")}
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={defectsByType} margin={{ top: 5, right: 20, bottom: 50, left: 0 }}>
              <CartesianGrid {...chartGridProps} opacity={0.3} />
              <XAxis
                dataKey="code"
                tick={chartAxisTick}
                angle={-35}
                textAnchor="end"
                interval={0}
              />
              <YAxis yAxisId="left" tick={chartAxisTick} />
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={[0, 100]}
                tick={chartAxisTick}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={chartTooltipStyle}
                formatter={(value: any, name: string) =>
                  name === "cumPercentage" ? [`${value}%`, "Cumulative %"] : [value, "NG Count"]
                }
              />
              <Bar yAxisId="left" dataKey="ngCount" radius={[4, 4, 0, 0]}>
                {defectsByType.map((_: any, i: number) => (
                  <Cell key={i} fill={paretoColor(i)} />
                ))}
              </Bar>
              <Line yAxisId="right" type="monotone" dataKey="cumPercentage" stroke={chartColor(4)} strokeWidth={2} dot={{ r: 3 }} />
              <ReferenceLine yAxisId="right" y={80} stroke="var(--destructive)" strokeDasharray="4 4" label={{ value: "80%", position: "right", fill: "var(--destructive)", fontSize: 10 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Defect Table */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="text-sm font-semibold mb-4">
            {t("productionDashboard.topDefectTypes", "Top Defect Types")}
          </h3>
          <div className="space-y-1.5 max-h-75 overflow-y-auto">
            {defectsByType.map((d: any, i: number) => {
              const tag = getDefectTagStyle(d.code, d.name);
              return (
                <div
                  key={d.pointDefId}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent/30 transition-colors"
                >
                  <span className="text-[11px] font-mono text-muted-foreground/50 w-5">{i + 1}</span>
                  <span className={`border rounded px-1.5 py-0.5 text-[10px] font-mono whitespace-nowrap ${tag.cls}`}>
                    {tag.label}
                  </span>
                  <span className="text-xs truncate flex-1">{d.name}</span>
                  <span className="font-mono text-xs font-semibold">{d.ngCount}</span>
                  <div className="w-20 h-2 bg-border rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(d.percentage, 100)}%`,
                        backgroundColor: paretoColor(i),
                      }}
                    />
                  </div>
                  <span className="font-mono text-[11px] text-muted-foreground w-12 text-right">
                    {d.percentage.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Defects by Station */}
      <div id="chart-ng-by-station" className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold mb-4">
          {t("productionDashboard.defectsByStation", "NG Distribution by Station")}
        </h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={defectsByStation} margin={{ top: 5, right: 20, bottom: 40, left: 0 }}>
            <CartesianGrid {...chartGridProps} opacity={0.3} />
            <XAxis
              dataKey="stationCode"
              tick={chartAxisTick}
              angle={-25}
              textAnchor="end"
              interval={0}
            />
            <YAxis tick={chartAxisTick} />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(value: any) => [value, "NG Count"]}
              labelFormatter={(label) => {
                const s = defectsByStation.find((d: any) => d.stationCode === label);
                return s ? `${s.stationCode}: ${s.stationName}` : label;
              }}
            />
            <Bar dataKey="ngCount" radius={[4, 4, 0, 0]}>
              {defectsByStation.map((_: any, i: number) => (
                <Cell key={i} fill={paretoColor(i)} opacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Trend Tab
   ══════════════════════════════════════════════════════════ */

function TrendTab({
  data,
  isLoading,
  interval,
  onIntervalChange,
  t,
}: {
  data: any;
  isLoading: boolean;
  interval: "hour" | "day" | "week";
  onIntervalChange: (v: "hour" | "day" | "week") => void;
  t: any;
}) {
  const trendRows = Array.isArray(data) ? data : [];

  const chartData = useMemo(() =>
    trendRows.map((r: any) => ({
      ...r,
      label: formatPeriodLabel(r.period, interval),
    })),
    [trendRows, interval],
  );

  if (isLoading) {
    return (
      <div className="p-4 sm:p-7 space-y-6">
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-87.5 w-full rounded-xl" />
        <Skeleton className="h-62.5 w-full rounded-xl" />
      </div>
    );
  }

  const intervalLabels: Record<"hour" | "day" | "week", string> = {
    hour: t("productionDashboard.intervalHour", "Hourly"),
    day: t("productionDashboard.intervalDay", "Daily"),
    week: t("productionDashboard.intervalWeek", "Weekly"),
  };

  return (
    <div className="p-4 sm:p-7 space-y-6">
      {/* Interval selector */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">{t("productionDashboard.interval", "Interval")}:</span>
        <div className="flex gap-0.5 bg-background border border-border rounded-lg p-0.5">
          {(["hour", "day", "week"] as const).map((v) => (
            <button
              key={v}
              onClick={() => onIntervalChange(v)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                interval === v
                  ? "bg-secondary text-foreground border border-border"
                  : "text-muted-foreground/60 hover:text-muted-foreground"
              }`}
            >
              {intervalLabels[v]}
            </button>
          ))}
        </div>
      </div>

      {chartData.length === 0 ? (
        <EmptyState
          variant="no-analytics"
          icon={TrendingUp}
          title={t("productionDashboard.noTrendDataTitle", "No trend data")}
          description={t("productionDashboard.noTrendData", "No trend data for the selected period")}
        />
      ) : (
        <>
          {/* Yield Trend */}
          <div id="chart-yield-trend" className="bg-card border border-border rounded-xl p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-success" />
              {t("productionDashboard.yieldTrend", "Yield Trend")}
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid {...chartGridProps} opacity={0.3} />
                <XAxis dataKey="label" tick={chartAxisTick} />
                <YAxis domain={[0, 100]} tick={chartAxisTick} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(v: any, name: string) => [`${Number(v).toFixed(1)}%`, name === "fpy" ? "First Pass Yield" : "Final Yield"]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="fpy" name="FPY" stroke="var(--success)" strokeWidth={2} dot={{ r: 2 }} />
                <Line type="monotone" dataKey="finalYield" name="Final Yield" stroke={chartColor(0)} strokeWidth={2} dot={{ r: 2 }} strokeDasharray="5 5" />
                <ReferenceLine y={90} stroke="var(--success)" strokeDasharray="3 3" opacity={0.5} />
                <ReferenceLine y={70} stroke="var(--destructive)" strokeDasharray="3 3" opacity={0.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Output & NG Trend */}
          <div id="chart-output-trend" className="bg-card border border-border rounded-xl p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-info" />
              {t("productionDashboard.outputTrend", "Output & NG Trend")}
            </h3>
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid {...chartGridProps} opacity={0.3} />
                <XAxis dataKey="label" tick={chartAxisTick} />
                <YAxis tick={chartAxisTick} />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="ok" name="OK" fill="var(--success)" stackId="a" radius={[0, 0, 0, 0]} opacity={0.7} />
                <Bar dataKey="ng" name="NG" fill="var(--destructive)" stackId="a" radius={[0, 0, 0, 0]} opacity={0.7} />
                <Bar dataKey="ntf" name="NTF" fill="var(--warning)" stackId="a" radius={[4, 4, 0, 0]} opacity={0.7} />
                <Line type="monotone" dataKey="total" name="Total" stroke={chartColor(4)} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

function formatPeriodLabel(period: string, interval: string): string {
  try {
    const d = new Date(period);
    if (isNaN(d.getTime())) return period;
    const locale = getActiveLocale();
    if (interval === "hour") return d.toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit" });
    if (interval === "week") return `W${getISOWeek(d)} ${d.toLocaleString(locale, { month: "short" })}`;
    return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
  } catch { return period; }
}

function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/* ══════════════════════════════════════════════════════════
   SPC Tab
   ══════════════════════════════════════════════════════════ */

function SpcTab({
  data,
  isLoading,
  navigate,
  t,
  datePreset,
  dateRange,
}: {
  data: any[];
  isLoading: boolean;
  navigate: (path: string) => void;
  t: any;
  datePreset: string;
  dateRange: { start: Date; end: Date };
}) {
  const spcRows = Array.isArray(data) ? data : [];

  if (isLoading) {
    return (
      <div className="p-4 sm:p-7 space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-card border border-border rounded-xl p-6">
            <Skeleton className="h-5 w-40 mb-3" />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {[1, 2, 3, 4, 5].map(j => <Skeleton key={j} className="h-16" />)}
            </div>
            <Skeleton className="h-30 mt-4" />
          </div>
        ))}
      </div>
    );
  }

  if (spcRows.length === 0) {
    return (
      <EmptyState
        variant="no-analytics"
        icon={Target}
        title={t("productionDashboard.noSpcDataTitle", "No SPC data")}
        description={t("productionDashboard.noSpcData", "No SPC data for the selected period")}
      />
    );
  }

  const anyOutOfControl = spcRows.some((r: any) => r?.cpk < 1);

  return (
    <div id="chart-spc" className="p-4 sm:p-7 space-y-4">
      {/* Summary Cards (F4a: MetricCard grid) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <MetricCard
          icon={<Gauge className="h-4 w-4" />}
          label={t("productionDashboard.spcAvgCpk", "Avg Cpk")}
          value={spcRows.length > 0 ? (spcRows.reduce((s: number, r: any) => s + (r?.cpk || 0), 0) / spcRows.length).toFixed(2) : "—"}
          tone={anyOutOfControl ? "danger" : "success"}
        />
        <MetricCard
          icon={<TrendingUp className="h-4 w-4" />}
          label={t("productionDashboard.spcAvgYield", "Avg Yield")}
          value={spcRows.length > 0 ? `${(spcRows.reduce((s: number, r: any) => s + (r?.fpy || 0), 0) / spcRows.length).toFixed(1)}%` : "—"}
          tone="info"
        />
        <MetricCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label={t("productionDashboard.spcOutOfControl", "Out of Control")}
          value={String(spcRows.filter((r: any) => r?.cpk < 1).length)}
          tone={anyOutOfControl ? "warning" : "success"}
        />
        <MetricCard
          icon={<Factory className="h-4 w-4" />}
          label={t("productionDashboard.spcTotalStations", "Total Stations")}
          value={String(spcRows.length)}
        />
      </div>

      {/* Per-station SPC cards */}
      {spcRows.map((row: any) => (
        <div
          key={row?.stationId}
          className={`bg-card border rounded-xl p-5 transition-colors ${
            row?.cpk < 1 ? "border-destructive/30" : "border-border"
          }`}
        >
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h4 className="text-sm font-semibold">{row?.stationCode}: {row?.stationName}</h4>
              {row?.cpk < 1 && (
                <StatusBadge
                  status="out-of-control"
                  tone="error"
                  label={
                    <span className="inline-flex items-center gap-0.5">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      {t("productionDashboard.spcOutOfControlBadge", "Out of control")}
                    </span>
                  }
                  className="font-mono"
                />
              )}
              {row?.cpk >= 1.33 && (
                <StatusBadge
                  status="capable"
                  tone="success"
                  label={t("productionDashboard.spcCapable", "Capable")}
                  className="font-mono"
                />
              )}
            </div>
            <button
              onClick={() => navigate(`/station-analysis/${row?.stationId}?dp=${datePreset}&from=${dateRange.start.toISOString()}&to=${dateRange.end.toISOString()}`)}
              className="text-[11px] text-primary hover:underline inline-flex items-center gap-0.5"
            >
              {t("productionDashboard.spcDeepAnalysis", "Deep analysis")}
              <ArrowUp className="h-2.5 w-2.5 rotate-45" />
            </button>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 text-center mb-3">
            <div>
              <span className="block text-lg font-mono font-semibold">{row?.fpy?.toFixed(1)}%</span>
              <span className="text-[10px] text-muted-foreground/60">FPY</span>
            </div>
            <div>
              <span className="block text-lg font-mono font-semibold">{row?.mean?.toFixed(1)}%</span>
              <span className="text-[10px] text-muted-foreground/60">Mean</span>
            </div>
            <div>
              <span className="block text-lg font-mono font-semibold">{row?.stddev?.toFixed(2)}</span>
              <span className="text-[10px] text-muted-foreground/60">Std Dev</span>
            </div>
            <div>
              <span className="block text-lg font-mono font-semibold text-success">{row?.ucl?.toFixed(1)}%</span>
              <span className="text-[10px] text-muted-foreground/60">UCL</span>
            </div>
            <div>
              <span className="block text-lg font-mono font-semibold text-destructive">{row?.lcl?.toFixed(1)}%</span>
              <span className="text-[10px] text-muted-foreground/60">LCL</span>
            </div>
            <div>
              <span className={`block text-lg font-mono font-semibold ${row?.cpk < 1 ? "text-destructive" : row?.cpk >= 1.33 ? "text-success" : "text-warning"}`}>
                {row?.cpk?.toFixed(2)}
              </span>
              <span className="text-[10px] text-muted-foreground/60">Cpk</span>
            </div>
          </div>

          {/* Mini control chart */}
          {row?.dailyYields?.length > 1 && (
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={row.dailyYields} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid {...chartGridProps} opacity={0.2} />
                <XAxis dataKey="day" tick={false} />
                <YAxis
                  domain={[
                    Math.max(0, Math.floor(row.lcl - 5)),
                    Math.min(100, Math.ceil(row.ucl + 5)),
                  ]}
                  tick={chartAxisTick}
                  tickFormatter={(v) => `${v}%`}
                  width={40}
                />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(v: any) => [`${Number(v).toFixed(1)}%`, "Yield"]}
                  labelFormatter={(l) => {
                    try { return new Date(l).toLocaleDateString(getActiveLocale(), { month: "short", day: "numeric" }); }
                    catch { return l; }
                  }}
                />
                <ReferenceLine y={row.ucl} stroke="var(--success)" strokeDasharray="4 4" strokeWidth={1} />
                <ReferenceLine y={row.mean} stroke={chartColor(4)} strokeDasharray="2 2" strokeWidth={1} />
                <ReferenceLine y={row.lcl} stroke="var(--destructive)" strokeDasharray="4 4" strokeWidth={1} />
                <Line
                  type="monotone"
                  dataKey="yield"
                  stroke={chartColor(0)}
                  strokeWidth={1.5}
                  dot={(props: any) => {
                    const { cx, cy, payload } = props;
                    const ooc = payload.yield > row.ucl || payload.yield < row.lcl;
                    return (
                      <circle
                        key={`dot-${cx}-${cy}`}
                        cx={cx}
                        cy={cy}
                        r={ooc ? 4 : 2}
                        fill={ooc ? "var(--destructive)" : chartColor(0)}
                        stroke={ooc ? "var(--destructive)" : "none"}
                        strokeWidth={ooc ? 2 : 0}
                      />
                    );
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      ))}
    </div>
  );
}
