import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import ReportExportButton, { type ReportExportConfig } from "@/components/ReportExportButton";
import {
  Factory,
  Filter,
  Search,
  ArrowUpDown,
  CalendarDays,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Target,
  BarChart3,
} from "lucide-react";
import { useLocation } from "wouter";
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

const PARETO_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#a855f7",
  "#64748b", "#d946ef", "#0ea5e9", "#84cc16", "#f43f5e",
];

/* ── Helpers ── */

function getYieldLevel(value: number | null): "good" | "warn" | "bad" | "none" {
  if (value === null || value === undefined) return "none";
  if (value >= 90) return "good";
  if (value >= 70) return "warn";
  return "bad";
}

const yieldColorMap: Record<string, string> = {
  good: "text-emerald-500",
  warn: "text-yellow-500",
  bad: "text-red-500",
  none: "text-muted-foreground/40",
};

const yieldBarBg: Record<string, string> = {
  good: "bg-emerald-500",
  warn: "bg-yellow-500",
  bad: "bg-red-500",
  none: "bg-muted",
};

function getDefectTagStyle(code: string, name: string) {
  const lower = (code + " " + name).toLowerCase();
  if (lower.includes("irregular") || lower.includes("shift") || lower.includes("gap") || lower.includes("misalign") || lower.includes("loose") || lower.includes("flatness"))
    return { label: "Irregular", cls: "text-purple-400 border-purple-600/25 bg-purple-600/5" };
  if (lower.includes("assy") || lower.includes("missing") || lower.includes("thiếu") || lower.includes("screw") || lower.includes("clip") || lower.includes("orient") || lower.includes("lắp") || lower.includes("lệch") || lower.includes("ssd"))
    return { label: "ASSY", cls: "text-blue-400 border-blue-500/25 bg-blue-500/5" };
  if (lower.includes("damage") || lower.includes("buckle") || lower.includes("wrinkle") || lower.includes("scratch") || lower.includes("crack"))
    return { label: "Damage", cls: "text-red-400 border-red-500/25 bg-red-500/5" };
  if (lower.includes("pollution") || lower.includes("spot") || lower.includes("stain") || lower.includes("dirt") || lower.includes("dust"))
    return { label: "Pollution", cls: "text-yellow-400 border-yellow-500/25 bg-yellow-500/5" };
  if (lower.includes("ntf") || lower.includes("cable") || lower.includes("contact") || lower.includes("lỏng") || lower.includes("flying") || lower.includes("blockage"))
    return { label: "NTF", cls: "text-emerald-400 border-emerald-500/25 bg-emerald-500/5" };
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
    <div className="w-[68px] h-[52px] rounded-md border border-border/50 overflow-hidden shrink-0 bg-[#252a38]">
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
        <Skeleton className="w-[68px] h-[52px] rounded-md" />
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

/* ── Main Component ── */

export default function ProductionDashboard() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [selectedFactory, setSelectedFactory] = useState<string>("all");
  const [selectedLine, setSelectedLine] = useState<string>("all");
  const [activeTab, setActiveTab] = useState("station");
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [trendInterval, setTrendInterval] = useState<"hour" | "day" | "week">("day");

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
    factoryId: selectedFactory !== "all" ? Number(selectedFactory) : undefined,
    lineId: selectedLine !== "all" ? Number(selectedLine) : undefined,
    startDate: dateRange.start,
    endDate: dateRange.end,
  };

  const { data: stationDataRaw, isLoading } = trpc.productionDashboard.getStationOverview.useQuery(commonInput);
  const stationData = Array.isArray(stationDataRaw) ? stationDataRaw : [];

  // Tab-specific queries (only fetch when active)
  const { data: defectData, isLoading: defectLoading } = trpc.productionDashboard.getDefectAnalysis.useQuery(
    commonInput,
    { enabled: activeTab === "defect" },
  );
  const { data: trendData, isLoading: trendLoading } = trpc.productionDashboard.getTrendData.useQuery(
    { ...commonInput, interval: trendInterval },
    { enabled: activeTab === "trend" },
  );
  const { data: spcData, isLoading: spcLoading } = trpc.productionDashboard.getSpcSummary.useQuery(
    commonInput,
    { enabled: activeTab === "spc" },
  );

  // Summary KPIs
  const summary = useMemo(() => {
    if (stationData.length === 0)
      return { totalStations: 0, totalOutput: 0, avgFPY: 0, avgRetests: 0, lowYieldStations: 0 };
    const totalOutput = stationData.reduce((s, r) => s + r.output, 0);
    const totalOK = stationData.reduce((s, r) => s + r.okCount, 0);
    const totalInsp = stationData.reduce((s, r) => s + r.totalInspections, 0);
    const avgFPY = totalInsp > 0 ? (totalOK / totalInsp) * 100 : 0;
    const avgRetests = stationData.reduce((s, r) => s + r.retestRate, 0) / stationData.length;
    const lowYieldStations = stationData.filter((r) => r.firstPassYield < 70).length;
    return {
      totalStations: stationData.length,
      totalOutput,
      avgFPY: Math.round(avgFPY * 100) / 100,
      avgRetests: Math.round(avgRetests * 100) / 100,
      lowYieldStations,
    };
  }, [stationData]);

  const todayStr = useMemo(
    () => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    [],
  );

  const getExportConfig = useCallback((): ReportExportConfig => {
    const dateStr = `${dateRange.start.toLocaleDateString()} — ${dateRange.end.toLocaleDateString()}`;
    const sections: ReportExportConfig["sections"] = [];

    sections.push({
      title: "Overview",
      type: "stats",
      stats: [
        { label: "Stations", value: summary.totalStations },
        { label: "Avg FPY", value: `${summary.avgFPY}%` },
        { label: "Total Output", value: summary.totalOutput.toLocaleString() },
        { label: "Avg Retests", value: `${summary.avgRetests}%` },
        { label: "Low Yield", value: summary.lowYieldStations },
      ],
    });

    if (stationData.length > 0) {
      sections.push({
        title: "Station Performance",
        type: "table",
        tableHeaders: ["Station", "Category", "FPY %", "Change %", "Final Yield %", "Output", "Retest %"],
        tableRows: stationData.map((r: any) => [
          r.station.name, r.workshop?.name || r.line?.name || "",
          r.firstPassYield.toFixed(1), r.yieldChange.toFixed(2), r.finalYield.toFixed(1),
          r.output, r.retestRate.toFixed(1),
        ]),
      });
    }

    if (defectData?.topDefects) {
      sections.push({
        title: "Top Defects",
        type: "table",
        tableHeaders: ["Code", "Name", "Count", "Rate"],
        tableRows: defectData.topDefects.map((d: any) => [d.code || d.defectCode, d.name || d.defectName, d.count, `${d.percentage || d.rate || 0}%`]),
      });
    }

    return {
      title: "Production Dashboard Report",
      subtitle: dateStr,
      sections,
      filenamePrefix: "production_dashboard",
      orientation: "landscape",
    };
  }, [summary, stationData, defectData, dateRange]);

  return (
    <DashboardLayout>
      <div className="flex flex-col min-h-0">
        {/* ── Summary Strip ── */}
        <div className="bg-card border-b border-border px-7 py-2.5 flex items-center gap-8 overflow-x-auto">
          {/* Live badge */}
          <div className="flex items-center gap-2 border border-emerald-500/30 bg-emerald-500/10 rounded-full px-3 py-1 shrink-0">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-xs font-medium text-emerald-500">{t("productionDashboard.live", "Live")}</span>
          </div>

          <span className="text-xs text-muted-foreground shrink-0">{t("productionDashboard.todayLabel", "Today")} &middot; {todayStr}</span>

          <div className="w-px h-8 bg-border shrink-0" />

          <div className="flex flex-col gap-0.5 min-w-fit">
            <span className="text-lg font-semibold font-mono">{summary.totalStations}</span>
            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
              {t("productionDashboard.totalStations", "Stations")}
            </span>
          </div>
          <div className="w-px h-8 bg-border shrink-0" />
          <div className="flex flex-col gap-0.5 min-w-fit">
            <span className="text-lg font-semibold font-mono text-emerald-500">
              {summary.avgFPY.toFixed(1)}%
            </span>
            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
              {t("productionDashboard.avgFPY", "Avg First Pass Yield")}
            </span>
          </div>
          <div className="w-px h-8 bg-border shrink-0" />
          <div className="flex flex-col gap-0.5 min-w-fit">
            <span className="text-lg font-semibold font-mono">{summary.totalOutput.toLocaleString()}</span>
            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
              {t("productionDashboard.totalOutput", "Total Output")}
            </span>
          </div>
          <div className="w-px h-8 bg-border shrink-0" />
          <div className="flex flex-col gap-0.5 min-w-fit">
            <span
              className={`text-lg font-semibold font-mono ${
                summary.avgRetests > 5 ? "text-red-500" : summary.avgRetests > 2 ? "text-yellow-500" : ""
              }`}
            >
              {summary.avgRetests.toFixed(1)}%
            </span>
            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
              {t("productionDashboard.avgRetests", "Avg Retests")}
            </span>
          </div>
          <div className="w-px h-8 bg-border shrink-0" />
          <div className="flex flex-col gap-0.5 min-w-fit">
            <span
              className={`text-lg font-semibold font-mono ${summary.lowYieldStations > 0 ? "text-yellow-500" : ""}`}
            >
              {summary.lowYieldStations}
            </span>
            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
              {t("productionDashboard.lowYieldStations", "Low Yield Stations")}
            </span>
          </div>
        </div>

        {/* ── Toolbar ── */}
        <div className="bg-card border-b border-border px-7 py-2.5 flex items-center gap-3 overflow-x-auto">
          {/* Tabs */}
          <div className="flex gap-0.5 bg-background border border-border rounded-lg p-0.5 shrink-0">
            {[
              { key: "station", label: t("productionDashboard.tabStation", "Station View") },
              { key: "defect", label: t("productionDashboard.tabDefect", "Defect Analysis") },
              { key: "trend", label: t("productionDashboard.tabTrend", "Trend") },
              { key: "spc", label: t("productionDashboard.tabSpc", "SPC") },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
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

          <div className="w-px h-6 bg-border shrink-0" />

          {/* Date Presets */}
          <div className="flex gap-0.5 bg-background border border-border rounded-lg p-0.5 shrink-0">
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
                    ? "bg-purple-600/20 text-purple-400 border border-purple-600/30"
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
                      ? "bg-purple-600/20 text-purple-400 border border-purple-600/30"
                      : "text-muted-foreground/60 hover:text-muted-foreground"
                  }`}
                >
                  <CalendarDays className="h-3 w-3" />
                  {datePreset === "custom" && customRange?.from
                    ? `${customRange.from.toLocaleDateString("en-US", { month: "short", day: "numeric" })}${customRange.to ? ` – ${customRange.to.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}`
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

          <div className="flex-1" />

          {/* Filters */}
          <Select
            value={selectedFactory}
            onValueChange={(val) => {
              setSelectedFactory(val);
              setSelectedLine("all");
            }}
          >
            <SelectTrigger className="w-[160px] h-8 text-xs shrink-0">
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

          <Select value={selectedLine} onValueChange={setSelectedLine}>
            <SelectTrigger className="w-[160px] h-8 text-xs shrink-0">
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

          <ReportExportButton getConfig={getExportConfig} />
        </div>

        {/* ── Tab Content ── */}
        <div className="overflow-auto flex-1">
          {activeTab === "station" && (
            <StationViewTab
              stationData={stationData}
              isLoading={isLoading}
              navigate={navigate}
              t={t}
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
            />
          )}
        </div>
      </div>

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
   Station View Tab (existing table)
   ══════════════════════════════════════════════════════════ */

function StationViewTab({
  stationData,
  isLoading,
  navigate,
  t,
}: {
  stationData: any[];
  isLoading: boolean;
  navigate: (path: string) => void;
  t: any;
}) {
  const [searchText, setSearchText] = useState("");

  const filteredData = useMemo(() => {
    if (!searchText.trim()) return stationData;
    const q = searchText.toLowerCase().trim();
    return stationData.filter((row: any) => {
      const name = (row.station?.name || "").toLowerCase();
      const code = (row.station?.code || "").toLowerCase();
      const line = (row.line?.name || "").toLowerCase();
      const workshop = (row.workshop?.name || "").toLowerCase();
      return name.includes(q) || code.includes(q) || line.includes(q) || workshop.includes(q);
    });
  }, [stationData, searchText]);

  return (
    <div className="min-w-[1100px]">
      {/* Search Bar */}
      <div className="px-7 py-2.5 border-b border-border bg-card sticky top-0 z-20">
        <div className="relative max-w-xs">
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
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Table Header */}
      <div
        className="grid px-7 py-2.5 border-b border-border bg-card sticky top-[41px] z-10"
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
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/50">
          <Factory className="h-12 w-12 mb-3" />
          <p className="text-sm">
            {searchText
              ? t("productionDashboard.noSearchResults", "No stations match '{{query}}'", { query: searchText })
              : t("productionDashboard.noStations", "No stations found for the selected filters")}
          </p>
        </div>
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
                    <div className="w-[68px] h-[52px] rounded-md border border-border/50 overflow-hidden shrink-0 bg-[#252a38]">
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
                      {row.machineCount} Image monitors &bull; {row.measurementPointCount} Measurements
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
                  <div className="h-[3px] bg-border rounded-sm overflow-hidden mt-1 w-full">
                    <div
                      className={`h-full rounded-sm transition-all duration-1000 ease-out ${yieldBarBg[fpyLevel]}`}
                      style={{ width: isNoData ? "0%" : `${Math.min(row.firstPassYield, 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground/50 leading-none mt-0.5">
                    First pass yield
                  </span>
                </div>

                {/* Point Change */}
                <div className="flex flex-col gap-0.5">
                  <span
                    className={`font-mono text-[15px] font-semibold leading-none flex items-center gap-1 ${
                      changeDir === "up"
                        ? "text-emerald-500"
                        : changeDir === "down"
                          ? "text-red-500"
                          : "text-muted-foreground/40"
                    }`}
                  >
                    {isNoData ? "--" : `${Math.abs(row.yieldChange).toFixed(1)}%`}
                    {changeDir === "up" && <span className="text-[10px]">▲</span>}
                    {changeDir === "down" && <span className="text-[10px]">▼</span>}
                  </span>
                  <span className="text-[10px] text-muted-foreground/50 leading-none mt-0.5">
                    Point change
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
                  <div className="h-[3px] bg-border rounded-sm overflow-hidden mt-1 w-full">
                    <div
                      className={`h-full rounded-sm transition-all duration-1000 ease-out ${yieldBarBg[fyLevel]}`}
                      style={{ width: isNoData ? "0%" : `${Math.min(row.finalYield, 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground/50 leading-none mt-0.5">
                    Final yield
                  </span>
                </div>

                {/* Output */}
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[15px] font-semibold leading-none">
                    {row.output.toLocaleString()}
                  </span>
                  <span className="text-[10px] text-muted-foreground/50 leading-none mt-0.5">Output</span>
                </div>

                {/* Retests */}
                <div className="flex flex-col gap-0.5">
                  <span
                    className={`font-mono text-[15px] font-semibold leading-none ${
                      isNoData
                        ? "text-muted-foreground/40"
                        : row.retestRate > 5
                          ? "text-yellow-500"
                          : ""
                    }`}
                  >
                    {isNoData ? "— %" : `${row.retestRate.toFixed(1)}%`}
                  </span>
                  <span className="text-[10px] text-muted-foreground/50 leading-none mt-0.5">Retests</span>
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
                          <span className="text-muted-foreground truncate max-w-[130px]">
                            {defect.name}
                          </span>
                          <span className="font-mono font-semibold min-w-[32px] text-right">
                            {defect.percentage.toFixed(1)}%
                          </span>
                          <button
                            onClick={() => navigate(`/correlation-analysis?pointDefId=${defect.pointDefId}`)}
                            className="text-[10px] text-purple-400 hover:underline whitespace-nowrap shrink-0"
                          >
                            Correlate ↗
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* View Button */}
                <div className="flex justify-end">
                  <button
                    onClick={() => navigate(`/station-analysis/${row.station.id}`)}
                    className="bg-purple-600 hover:bg-purple-700 active:translate-y-0 text-white rounded-md px-3.5 py-2 text-xs font-semibold transition-all hover:-translate-y-px whitespace-nowrap"
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
      <div className="p-7 grid grid-cols-2 gap-6">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-card border border-border rounded-xl p-6">
            <Skeleton className="h-5 w-40 mb-4" />
            <Skeleton className="h-[260px] w-full" />
          </div>
        ))}
      </div>
    );
  }

  const defectsByType = data?.defectsByType || [];
  const defectsByStation = data?.defectsByStation || [];

  if (defectsByType.length === 0 && defectsByStation.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/50">
        <BarChart3 className="h-12 w-12 mb-3" />
        <p className="text-sm">{t("productionDashboard.noDefectData", "No defect data for the selected period")}</p>
      </div>
    );
  }

  return (
    <div className="p-7 space-y-6">
      {/* Pareto Chart + Table */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Pareto Bar Chart */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-purple-400" />
            {t("productionDashboard.defectPareto", "Defect Pareto Analysis")}
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={defectsByType} margin={{ top: 5, right: 20, bottom: 50, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis
                dataKey="code"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                angle={-35}
                textAnchor="end"
                interval={0}
              />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                formatter={(value: any, name: string) =>
                  name === "cumPercentage" ? [`${value}%`, "Cumulative %"] : [value, "NG Count"]
                }
              />
              <Bar yAxisId="left" dataKey="ngCount" radius={[4, 4, 0, 0]}>
                {defectsByType.map((_: any, i: number) => (
                  <Cell key={i} fill={PARETO_COLORS[i % PARETO_COLORS.length]} />
                ))}
              </Bar>
              <Line yAxisId="right" type="monotone" dataKey="cumPercentage" stroke="#a855f7" strokeWidth={2} dot={{ r: 3 }} />
              <ReferenceLine yAxisId="right" y={80} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "80%", position: "right", fill: "#ef4444", fontSize: 10 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Defect Table */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="text-sm font-semibold mb-4">
            {t("productionDashboard.topDefectTypes", "Top Defect Types")}
          </h3>
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
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
                        backgroundColor: PARETO_COLORS[i % PARETO_COLORS.length],
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
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold mb-4">
          {t("productionDashboard.defectsByStation", "NG Distribution by Station")}
        </h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={defectsByStation} margin={{ top: 5, right: 20, bottom: 40, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis
              dataKey="stationCode"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              angle={-25}
              textAnchor="end"
              interval={0}
            />
            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
              formatter={(value: any) => [value, "NG Count"]}
              labelFormatter={(label) => {
                const s = defectsByStation.find((d: any) => d.stationCode === label);
                return s ? `${s.stationCode}: ${s.stationName}` : label;
              }}
            />
            <Bar dataKey="ngCount" radius={[4, 4, 0, 0]}>
              {defectsByStation.map((_: any, i: number) => (
                <Cell key={i} fill={PARETO_COLORS[i % PARETO_COLORS.length]} opacity={0.85} />
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
      <div className="p-7 space-y-6">
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-[350px] w-full rounded-xl" />
        <Skeleton className="h-[250px] w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-7 space-y-6">
      {/* Interval selector */}
      <div className="flex items-center gap-3">
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
              {v === "hour" ? "Hourly" : v === "day" ? "Daily" : "Weekly"}
            </button>
          ))}
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/50">
          <TrendingUp className="h-12 w-12 mb-3" />
          <p className="text-sm">{t("productionDashboard.noTrendData", "No trend data for the selected period")}</p>
        </div>
      ) : (
        <>
          {/* Yield Trend */}
          <div className="bg-card border border-border rounded-xl p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              {t("productionDashboard.yieldTrend", "Yield Trend")}
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any, name: string) => [`${Number(v).toFixed(1)}%`, name === "fpy" ? "First Pass Yield" : "Final Yield"]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="fpy" name="FPY" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} />
                <Line type="monotone" dataKey="finalYield" name="Final Yield" stroke="#06b6d4" strokeWidth={2} dot={{ r: 2 }} strokeDasharray="5 5" />
                <ReferenceLine y={90} stroke="#22c55e" strokeDasharray="3 3" opacity={0.5} />
                <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" opacity={0.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Output & NG Trend */}
          <div className="bg-card border border-border rounded-xl p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-400" />
              {t("productionDashboard.outputTrend", "Output & NG Trend")}
            </h3>
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="ok" name="OK" fill="#22c55e" stackId="a" radius={[0, 0, 0, 0]} opacity={0.7} />
                <Bar dataKey="ng" name="NG" fill="#ef4444" stackId="a" radius={[0, 0, 0, 0]} opacity={0.7} />
                <Bar dataKey="ntf" name="NTF" fill="#eab308" stackId="a" radius={[4, 4, 0, 0]} opacity={0.7} />
                <Line type="monotone" dataKey="total" name="Total" stroke="#a855f7" strokeWidth={2} dot={false} />
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
    if (interval === "hour") return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit" });
    if (interval === "week") return `W${getISOWeek(d)} ${d.toLocaleString("en-US", { month: "short" })}`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
}: {
  data: any[];
  isLoading: boolean;
  navigate: (path: string) => void;
  t: any;
}) {
  const spcRows = Array.isArray(data) ? data : [];

  if (isLoading) {
    return (
      <div className="p-7 space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-card border border-border rounded-xl p-6">
            <Skeleton className="h-5 w-40 mb-3" />
            <div className="grid grid-cols-5 gap-4">
              {[1, 2, 3, 4, 5].map(j => <Skeleton key={j} className="h-16" />)}
            </div>
            <Skeleton className="h-[120px] mt-4" />
          </div>
        ))}
      </div>
    );
  }

  if (spcRows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/50">
        <Target className="h-12 w-12 mb-3" />
        <p className="text-sm">{t("productionDashboard.noSpcData", "No SPC data for the selected period")}</p>
      </div>
    );
  }

  return (
    <div className="p-7 space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SpcKpiCard
          label="Avg Cpk"
          value={spcRows.length > 0 ? (spcRows.reduce((s: number, r: any) => s + (r?.cpk || 0), 0) / spcRows.length).toFixed(2) : "—"}
          color={spcRows.some((r: any) => r?.cpk < 1) ? "text-red-500" : "text-emerald-500"}
        />
        <SpcKpiCard
          label="Avg Yield"
          value={spcRows.length > 0 ? `${(spcRows.reduce((s: number, r: any) => s + (r?.fpy || 0), 0) / spcRows.length).toFixed(1)}%` : "—"}
          color="text-blue-400"
        />
        <SpcKpiCard
          label="Out of Control"
          value={String(spcRows.filter((r: any) => r?.cpk < 1).length)}
          color={spcRows.some((r: any) => r?.cpk < 1) ? "text-yellow-500" : "text-emerald-500"}
        />
        <SpcKpiCard
          label="Total Stations"
          value={String(spcRows.length)}
          color=""
        />
      </div>

      {/* Per-station SPC cards */}
      {spcRows.map((row: any) => (
        <div
          key={row?.stationId}
          className={`bg-card border rounded-xl p-5 transition-colors ${
            row?.cpk < 1 ? "border-red-500/30" : "border-border"
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h4 className="text-sm font-semibold">{row?.stationCode}: {row?.stationName}</h4>
              {row?.cpk < 1 && (
                <span className="text-[10px] bg-red-500/15 text-red-400 border border-red-500/25 rounded px-1.5 py-0.5 font-mono">
                  <AlertTriangle className="h-2.5 w-2.5 inline mr-0.5" />
                  Out of control
                </span>
              )}
              {row?.cpk >= 1.33 && (
                <span className="text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 rounded px-1.5 py-0.5 font-mono">
                  Capable
                </span>
              )}
            </div>
            <button
              onClick={() => navigate(`/station-analysis/${row?.stationId}`)}
              className="text-[11px] text-purple-400 hover:underline"
            >
              Deep analysis →
            </button>
          </div>

          <div className="grid grid-cols-6 gap-4 text-center mb-3">
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
              <span className="block text-lg font-mono font-semibold text-emerald-400">{row?.ucl?.toFixed(1)}%</span>
              <span className="text-[10px] text-muted-foreground/60">UCL</span>
            </div>
            <div>
              <span className="block text-lg font-mono font-semibold text-red-400">{row?.lcl?.toFixed(1)}%</span>
              <span className="text-[10px] text-muted-foreground/60">LCL</span>
            </div>
            <div>
              <span className={`block text-lg font-mono font-semibold ${row?.cpk < 1 ? "text-red-500" : row?.cpk >= 1.33 ? "text-emerald-500" : "text-yellow-500"}`}>
                {row?.cpk?.toFixed(2)}
              </span>
              <span className="text-[10px] text-muted-foreground/60">Cpk</span>
            </div>
          </div>

          {/* Mini control chart */}
          {row?.dailyYields?.length > 1 && (
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={row.dailyYields} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis dataKey="day" tick={false} />
                <YAxis
                  domain={[
                    Math.max(0, Math.floor(row.lcl - 5)),
                    Math.min(100, Math.ceil(row.ucl + 5)),
                  ]}
                  tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v) => `${v}%`}
                  width={40}
                />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: any) => [`${Number(v).toFixed(1)}%`, "Yield"]}
                  labelFormatter={(l) => {
                    try { return new Date(l).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
                    catch { return l; }
                  }}
                />
                <ReferenceLine y={row.ucl} stroke="#22c55e" strokeDasharray="4 4" strokeWidth={1} />
                <ReferenceLine y={row.mean} stroke="#a855f7" strokeDasharray="2 2" strokeWidth={1} />
                <ReferenceLine y={row.lcl} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} />
                <Line
                  type="monotone"
                  dataKey="yield"
                  stroke="#3b82f6"
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
                        fill={ooc ? "#ef4444" : "#3b82f6"}
                        stroke={ooc ? "#ef4444" : "none"}
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

function SpcKpiCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 text-center">
      <span className={`block text-2xl font-mono font-semibold ${color}`}>{value}</span>
      <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">{label}</span>
    </div>
  );
}
