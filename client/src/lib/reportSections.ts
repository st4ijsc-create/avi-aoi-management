/**
 * reportSections.ts — pure, DOM-free helpers for the "most complete" report
 * export on /production-dashboard and /station-analysis (doc 32 §6.2/§6.3/§6.5).
 *
 * This module is intentionally free of any runtime DOM / React / recharts import
 * (only *type* imports) so it can be unit-tested in the node vitest environment
 * (see reportSections.unit.test.ts). The pages consume the builders below to turn
 * prefetched tRPC data into `ReportExportButton` sections that always carry BOTH a
 * chart image (captured from the off-screen print view) AND a real data table.
 *
 * Integration with R4-A's ReportExportButton:
 *  - `withScope()` attaches a `scope`/`filters` metadata object to the config so
 *    R4-A's repeated filter-band renders on every page. It is attached via
 *    Object.assign (not an object literal) so it compiles whether or not R4-A has
 *    yet added `scope`/`filters` to the `ReportExportConfig` interface.
 *  - chart sections reference DOM ids that the page mounts in an off-screen
 *    "print view" (all charts, regardless of active tab). `ReportExportButton`'s
 *    capture step (current `captureVisibleCharts`, or R4-A's dedicated print-view
 *    helper once present) resolves those ids and screenshots them.
 */

import type { CSSProperties } from "react";
import type { ReportSection } from "@/components/ReportExportButton";

export type ReportScopeMeta = Record<string, string | undefined>;

/** Minimal translation-fn shape the builders need (i18next `t` is assignable). */
export type ReportTFn = (key: string, defaultValue?: string) => string;

/**
 * Off-screen container style for the print view. Uses left:-100000px (NOT
 * display:none / visibility:hidden) so recharts' ResponsiveContainer still gets a
 * measured width and lays out. Rendered BEFORE the visible content so that, for a
 * chart that also exists on the active tab, `getElementById` resolves the
 * light-themed print-view copy first — giving uniform, tab/theme-independent output.
 */
export const OFFSCREEN_PRINT_STYLE: CSSProperties = {
  position: "fixed",
  left: "-100000px",
  top: 0,
  width: "1120px",
  background: "#ffffff",
  color: "#0f172a",
  zIndex: -1,
  pointerEvents: "none",
  opacity: 1,
};

/**
 * Attach `scope`/`filters` metadata to an export config without tripping the
 * excess-property check (R4-A owns the interface and may not have added the fields
 * yet). Returns the same object, widened. When R4-A's ReportExportButton reads
 * `config.scope` at runtime, the data is present; older builds simply ignore it.
 */
export function withScope<T extends object>(
  config: T,
  meta: { scope?: ReportScopeMeta; filters?: ReportScopeMeta },
): T {
  return Object.assign(config, {
    ...(meta.scope ? { scope: meta.scope } : {}),
    ...(meta.filters ? { filters: meta.filters } : {}),
  });
}

/** Build a compact scope metadata object, dropping empty/all values. */
export function buildScopeMeta(
  fields: Record<string, string | number | boolean | null | undefined>,
): ReportScopeMeta {
  const out: ReportScopeMeta = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === "" || v === "all") continue;
    out[k] = String(v);
  }
  return out;
}

/**
 * Wait for React to commit the off-screen print view + recharts to lay out and
 * finish its (default) mount animation before html2canvas captures. Two rAFs cover
 * the commit; the delay covers recharts' ~1.5s animation. No-ops fast in node.
 */
export async function waitForChartRender(delayMs = 1900): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    } else {
      resolve();
    }
  });
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

/* ═══════════════════════════════════════════════════════════════════════
   ProductionDashboard helpers
   ═══════════════════════════════════════════════════════════════════════ */

export interface StationFilterOpts {
  search?: string;
  lowYield?: boolean;
}

/** Same filter semantics as StationViewTab so the export honestly reflects the view. */
export function filterStationRows(rows: any[], opts: StationFilterOpts): any[] {
  let out = Array.isArray(rows) ? rows : [];
  if (opts.lowYield) {
    out = out.filter((r: any) => r.totalInspections > 0 && r.firstPassYield < 70);
  }
  const q = (opts.search || "").toLowerCase().trim();
  if (q) {
    out = out.filter((r: any) => {
      const name = (r.station?.name || "").toLowerCase();
      const code = (r.station?.code || "").toLowerCase();
      const line = (r.line?.name || "").toLowerCase();
      const workshop = (r.workshop?.name || "").toLowerCase();
      return name.includes(q) || code.includes(q) || line.includes(q) || workshop.includes(q);
    });
  }
  return out;
}

export interface FactoryAggRow {
  id: number;
  name: string;
  avgFPY: number;
  output: number;
  stations: number;
  lowYield: number;
}

/** Per-factory rollup from station-overview rows (works regardless of compare mode). */
export function computeFactoryAggregate(stationData: any[]): FactoryAggRow[] {
  const rows = Array.isArray(stationData) ? stationData : [];
  const map = new Map<number, { id: number; name: string; okSum: number; inspSum: number; output: number; stations: number; lowYield: number }>();
  for (const r of rows) {
    const f = (r as any).factory;
    if (!f?.id) continue;
    const cur = map.get(f.id) || { id: f.id, name: f.name || `#${f.id}`, okSum: 0, inspSum: 0, output: 0, stations: 0, lowYield: 0 };
    cur.okSum += r.okCount || 0;
    cur.inspSum += r.totalInspections || 0;
    cur.output += r.output || 0;
    cur.stations += 1;
    if (r.firstPassYield < 70) cur.lowYield += 1;
    map.set(f.id, cur);
  }
  return Array.from(map.values())
    .map((x) => ({
      id: x.id,
      name: x.name,
      avgFPY: x.inspSum > 0 ? Math.round((x.okSum / x.inspSum) * 10000) / 100 : 0,
      output: x.output,
      stations: x.stations,
      lowYield: x.lowYield,
    }))
    .sort((a, b) => b.output - a.output);
}

export interface ProductionSectionsInput {
  t: ReportTFn;
  summary: { totalStations: number; totalOutput: number; avgFPY: number; avgRetests: number; lowYieldStations: number };
  /** Station rows AFTER applying the active search / low-yield filter. */
  stationRows: any[];
  /** Whether the exported station table reflects an applied filter (vs all rows). */
  stationRowsFiltered: boolean;
  defectData?: any;
  trendData?: any;
  spcData?: any[];
  rulData?: any[];
  factoryAgg?: FactoryAggRow[];
}

/** Max per-item caps so a single export never balloons a table/image set. */
export const PROD_SPC_TABLE_CAP = 500;
export const RUL_TABLE_CAP = 200;

export function buildProductionDashboardSections(input: ProductionSectionsInput): ReportSection[] {
  const { t } = input;
  const tt = (k: string, d: string) => t(`productionDashboard.${k}`, d);
  const sections: ReportSection[] = [];

  // 1 — Overview KPIs
  sections.push({
    title: tt("exportOverview", "Overview"),
    type: "stats",
    stats: [
      { label: tt("totalStations", "Stations"), value: input.summary.totalStations },
      { label: tt("avgFPY", "Avg FPY"), value: `${input.summary.avgFPY}%` },
      { label: tt("totalOutput", "Total Output"), value: input.summary.totalOutput.toLocaleString() },
      { label: tt("avgRetests", "Avg Retests"), value: `${input.summary.avgRetests}%` },
      { label: tt("lowYieldStations", "Low Yield"), value: input.summary.lowYieldStations },
    ],
  });

  // 2 — Factory comparison (chart + table) — from all rows regardless of compare mode
  const agg = input.factoryAgg && input.factoryAgg.length ? input.factoryAgg : computeFactoryAggregate(input.stationRows);
  if (agg.length > 0) {
    sections.push({ title: tt("compareTitle", "Factory Comparison"), type: "chart", chartElementId: "chart-factory-compare" });
    sections.push({
      title: tt("compareTitle", "Factory Comparison"),
      type: "table",
      tableHeaders: [
        tt("factoriesShort", "Factory"),
        tt("avgFPY", "Avg FPY %"),
        tt("totalOutput", "Output"),
        tt("totalStations", "Stations"),
        tt("lowYieldStations", "Low Yield"),
      ],
      tableRows: agg.map((f) => [f.name, f.avgFPY.toFixed(1), f.output, f.stations, f.lowYield]),
    });
  }

  // 3 — Station performance table (honest: reflects applied filter)
  if (input.stationRows.length > 0) {
    sections.push({
      title:
        tt("exportStationPerf", "Station Performance") +
        (input.stationRowsFiltered ? ` — ${tt("exportFilteredRows", "filtered view")}` : ` — ${tt("exportAllRows", "all rows")}`),
      type: "table",
      tableHeaders: [
        tt("colStation", "Station"),
        tt("colCategory", "Category"),
        tt("colFPY", "FPY %"),
        tt("colChange", "Change %"),
        tt("colFinalYield", "Final Yield %"),
        tt("colOutput", "Output"),
        tt("colRetests", "Retest %"),
      ],
      tableRows: input.stationRows.map((r: any) => [
        r.station?.name ?? "",
        r.workshop?.name || r.line?.name || "",
        Number(r.firstPassYield ?? 0).toFixed(1),
        Number(r.yieldChange ?? 0).toFixed(2),
        Number(r.finalYield ?? 0).toFixed(1),
        r.output ?? 0,
        Number(r.retestRate ?? 0).toFixed(1),
      ]),
    });
  }

  // 4 — Defect Pareto (chart + table) + NG-by-station (chart)
  const defectsByType: any[] = input.defectData?.defectsByType || [];
  const defectsByStation: any[] = input.defectData?.defectsByStation || [];
  if (defectsByType.length) {
    sections.push({ title: tt("defectPareto", "Defect Pareto Analysis"), type: "chart", chartElementId: "chart-defect-pareto" });
    sections.push({
      title: tt("topDefectTypes", "Top Defect Types"),
      type: "table",
      tableHeaders: [tt("colCode", "Code"), tt("colName", "Name"), tt("colCount", "Count"), tt("colRate", "Rate")],
      tableRows: defectsByType.map((d: any) => [d.code, d.name, d.ngCount, `${(d.percentage ?? 0).toFixed?.(1) ?? d.percentage}%`]),
    });
  }
  if (defectsByStation.length) {
    sections.push({ title: tt("defectsByStation", "NG Distribution by Station"), type: "chart", chartElementId: "chart-ng-by-station" });
    sections.push({
      title: tt("defectsByStation", "NG Distribution by Station"),
      type: "table",
      tableHeaders: [tt("colStation", "Station"), tt("colName", "Name"), tt("colCount", "NG Count")],
      tableRows: defectsByStation.map((s: any) => [s.stationCode, s.stationName, s.ngCount]),
    });
  }

  // 5 — Trend datasets (yield + output/NG charts + table)
  const trendRows: any[] = Array.isArray(input.trendData) ? input.trendData : [];
  if (trendRows.length) {
    sections.push({ title: tt("yieldTrend", "Yield Trend"), type: "chart", chartElementId: "chart-yield-trend" });
    sections.push({ title: tt("outputTrend", "Output & NG Trend"), type: "chart", chartElementId: "chart-output-trend" });
    sections.push({
      title: tt("exportTrendData", "Trend Data"),
      type: "table",
      tableHeaders: [
        tt("colPeriod", "Period"),
        tt("colFPY", "FPY %"),
        tt("colFinalYield", "Final Yield %"),
        "OK",
        "NG",
        "NTF",
        tt("colTotal", "Total"),
      ],
      tableRows: trendRows.map((r: any) => [
        r.period,
        Number(r.fpy ?? 0).toFixed(1),
        Number(r.finalYield ?? 0).toFixed(1),
        r.ok ?? 0,
        r.ng ?? 0,
        r.ntf ?? 0,
        r.total ?? 0,
      ]),
    });
  }

  // 6 — SPC (Cpk overview chart + full per-station table)
  const spcRows: any[] = Array.isArray(input.spcData) ? input.spcData : [];
  if (spcRows.length) {
    sections.push({ title: tt("tabSpc", "SPC"), type: "chart", chartElementId: "chart-spc" });
    sections.push({
      title: tt("exportSpcSummary", "SPC Summary"),
      type: "table",
      tableHeaders: ["Station", tt("colFPY", "FPY %"), "Mean", "Std Dev", "UCL", "LCL", "Cpk"],
      tableRows: spcRows.slice(0, PROD_SPC_TABLE_CAP).map((r: any) => [
        `${r.stationCode ?? ""}: ${r.stationName ?? ""}`,
        r.fpy != null ? `${r.fpy.toFixed(1)}%` : "—",
        r.mean != null ? `${r.mean.toFixed(1)}%` : "—",
        r.stddev != null ? r.stddev.toFixed(2) : "—",
        r.ucl != null ? `${r.ucl.toFixed(1)}%` : "—",
        r.lcl != null ? `${r.lcl.toFixed(1)}%` : "—",
        r.cpk != null ? r.cpk.toFixed(2) : "—",
      ]),
    });
  }

  // 7 — Machine-AI RUL forecast (risk chart + table)
  const rulRows: any[] = Array.isArray(input.rulData) ? input.rulData : [];
  if (rulRows.length) {
    sections.push({ title: tt("machineRul", "Machine Failure Risk (RUL)"), type: "chart", chartElementId: "chart-machine-rul" });
    sections.push({
      title: tt("machineRul", "Machine Failure Risk (RUL)"),
      type: "table",
      tableHeaders: [
        tt("colMachine", "Machine"),
        tt("colRisk", "Failure Risk"),
        tt("colConfidence", "Confidence"),
        tt("colTimeframe", "Timeframe"),
        tt("colUrgency", "Urgency"),
      ],
      tableRows: rulRows.slice(0, RUL_TABLE_CAP).map((m: any) => [
        `${m.machineCode ?? ""}: ${m.machineName ?? ""}`,
        m.failureRisk != null ? `${Math.round(m.failureRisk * 100)}%` : "—",
        m.confidenceScore != null ? `${Math.round(m.confidenceScore * 100)}%` : "—",
        m.predictedTimeframe ?? "—",
        m.maintenanceUrgency ?? "—",
      ]),
    });
  }

  return sections;
}

/* ═══════════════════════════════════════════════════════════════════════
   StationAnalysis helpers
   ═══════════════════════════════════════════════════════════════════════ */

export interface StationSectionsInput {
  t: ReportTFn;
  stationId: number;
  summary?: any;
  hourlyData?: any;
  defectData?: any;
  spcData?: any;
  failHistory?: any;
  diagnostics?: any;
  histogramData?: any;
  scatterData?: any;
  checkSheetData?: any;
  causeEffectData?: any;
  stratData?: any;
  aiData?: any;
  stationDetail?: any;
  /** Measurement-mode SPC (X̄/R + histograms + capability) — doc 32 §6.4 #3. */
  mpSpc?: any;
  /** NG defect images flattened across all inspection points (for the gallery). */
  ngImageCount?: number;
  /** True when a board reference image is available for the print view. */
  hasBoardImage?: boolean;
}

/** getFailHistory server cap (see stationAnalysisRouter — limit.max(200)). */
export const STATION_FAIL_HISTORY_CAP = 200;
export const STATION_SAMPLE_TABLE_CAP = 500;

export function buildStationAnalysisSections(input: StationSectionsInput): ReportSection[] {
  const { t } = input;
  const e = (k: string, d?: string) => t(`stationAnalysis.export.${k}`, d ?? "");
  const sections: ReportSection[] = [];

  const summary = input.summary;
  const hourlyData = input.hourlyData;
  const defectData = input.defectData;
  const spcData = input.spcData as any;
  const failHistory = input.failHistory;
  const diagnostics = input.diagnostics as any;
  const histogramData = input.histogramData as any;
  const scatterData = input.scatterData as any;
  const checkSheetData = input.checkSheetData as any;
  const causeEffectData = input.causeEffectData as any;
  const stratData = input.stratData as any;
  const aiData = input.aiData as any;
  const stationDetail = input.stationDetail as any;
  const mpSpc = input.mpSpc as any;

  /* ── 1. Overview stats ───────────────────────────── */
  if (summary) {
    const s = summary as any;
    sections.push({
      title: e("overviewSection", "Overview"),
      type: "stats",
      stats: [
        { label: "FPY", value: `${s.firstPassYield}%` },
        { label: "Final Yield", value: `${s.finalYield}%` },
        { label: e("total", "Total"), value: s.totalInspections?.toLocaleString?.() ?? s.totalInspections },
        { label: "NG", value: s.ngCount },
        { label: "Retest", value: `${s.retestRate}%` },
      ],
    });
  }

  /* ── 2. Hourly yield chart + table ───────────────── */
  if (hourlyData && (hourlyData as any[])?.length) {
    sections.push({ title: e("hourlyYieldSection", "Hourly Yield"), type: "chart", chartElementId: "chart-hourly-yield" });
    sections.push({
      title: e("hourlyYieldSection", "Hourly Yield"),
      type: "table",
      tableHeaders: [e("hour", "Hour"), e("total", "Total"), e("ng", "NG"), e("yield", "Yield")],
      tableRows: (hourlyData as any[]).map((h: any) => [`${h.hour}:00`, h.total, h.ng, `${h.yield}%`]),
    });
  }

  /* ── 3. Top defects table + Pareto chart ─────────── */
  const defects = Array.isArray(defectData) ? defectData : [];
  if (defects.length) {
    sections.push({
      title: e("topDefectsSection", "Top Defects"),
      type: "table",
      tableHeaders: [e("code", "Code"), e("name", "Name"), e("count", "Count"), e("rate", "Rate")],
      tableRows: defects.map((d: any) => [d.code, d.name, d.ngCount, `${d.percentage?.toFixed?.(1) ?? d.percentage}%`]),
    });
    sections.push({ title: e("topDefectsSection", "Top Defects") + " — Pareto", type: "chart", chartElementId: "chart-pareto" });
  }

  /* ── 4. Fail history table (full up to server cap, doc 32 §6.4 #12) ── */
  const records = Array.isArray(failHistory) ? failHistory : [];
  if (records.length) {
    sections.push({
      title: `${e("failHistorySection", "Fail History")} (${records.length})`,
      type: "table",
      tableHeaders: [e("time", "Time"), e("barcode", "Barcode"), e("failedPoints", "Failed Points"), e("machine", "Machine")],
      tableRows: records.map((r: any) => [
        new Date(r.inspectionTime).toLocaleString(),
        r.barcode || "—",
        r.failedPoints?.map((fp: any) => `${fp.pointCode}: ${fp.pointName}`).join(", ") || "—",
        r.machineCode || "—",
      ]),
    });
  }

  /* ── 5. Yield SPC charts + table + rule summary (doc 32 §6.4 #12) ── */
  if (spcData?.points?.length > 1) {
    sections.push({ title: e("spcSection", "SPC") + " — X̄", type: "chart", chartElementId: "chart-spc-xbar" });
    sections.push({ title: e("spcSection", "SPC") + " — MR", type: "chart", chartElementId: "chart-spc-mr" });
    sections.push({
      title: e("spcSection", "SPC"),
      type: "table",
      tableHeaders: [e("day", "Day"), e("yieldPct", "Yield %"), e("zone", "Zone"), e("violatedRules", "Violated Rules")],
      tableRows: spcData.points.map((p: any) => [p.day, `${p.yield}%`, p.zone || "—", (p.violatedRules || []).join(", ") || "—"]),
    });
    if (Array.isArray(spcData.ruleSummary) && spcData.ruleSummary.length) {
      sections.push({
        title: e("spcRuleSummarySection", "SPC Western Electric Rule Violations"),
        type: "table",
        tableHeaders: [e("rule", "Rule"), e("name", "Name"), e("count", "Count")],
        tableRows: spcData.ruleSummary.map((rs: any) => [`R${rs.rule}`, rs.name, rs.count]),
      });
    }
  }

  /* ── 6. Measurement-mode SPC (doc 32 §6.4 #3) ─────── */
  if (mpSpc?.xBarPoints?.length > 1) {
    const cl = mpSpc.controlLimits;
    const cap = mpSpc.capability;
    const pointLabel = mpSpc.pointDef ? ` — ${mpSpc.pointDef.code || ""} ${mpSpc.pointDef.name || ""}`.trimEnd() : "";
    sections.push({ title: e("spcMeasurementSection", "Measurement SPC") + `${pointLabel} — X̄`, type: "chart", chartElementId: "chart-spc-xbar-mp" });
    sections.push({ title: e("spcMeasurementSection", "Measurement SPC") + " — R", type: "chart", chartElementId: "chart-spc-r-mp" });
    if (cl?.xBar && cl?.range) {
      sections.push({
        title: e("spcControlLimitsSection", "Control Limits"),
        type: "table",
        tableHeaders: [e("chart", "Chart"), "UCL", "CL", "LCL"],
        tableRows: [
          ["X̄", cl.xBar.UCL, cl.xBar.CL, cl.xBar.LCL],
          ["R", cl.range.UCL, cl.range.CL, cl.range.LCL],
        ],
      });
    }
    if (cap) {
      sections.push({
        title: e("capabilitySection", "Process Capability"),
        type: "stats",
        stats: [
          ...(cap.cp != null ? [{ label: "Cp", value: String(cap.cp) }] : []),
          ...(cap.cpk != null ? [{ label: "Cpk", value: String(cap.cpk) }] : []),
          ...(cap.pp != null ? [{ label: "Pp", value: String(cap.pp) }] : []),
          ...(cap.ppk != null ? [{ label: "Ppk", value: String(cap.ppk) }] : []),
          ...(cap.cpu != null ? [{ label: "Cpu", value: String(cap.cpu) }] : []),
          ...(cap.cpl != null ? [{ label: "Cpl", value: String(cap.cpl) }] : []),
        ],
      });
    }
    if (mpSpc.xBarHistogram?.length) {
      sections.push({ title: e("spcMeasurementSection", "Measurement SPC") + " — X̄ " + e("histogram", "Histogram"), type: "chart", chartElementId: "chart-xbar-histogram" });
    }
    if (mpSpc.rHistogram?.length) {
      sections.push({ title: e("spcMeasurementSection", "Measurement SPC") + " — R " + e("histogram", "Histogram"), type: "chart", chartElementId: "chart-r-histogram" });
    }
    if (Array.isArray(mpSpc.ruleSummary) && mpSpc.ruleSummary.length) {
      sections.push({
        title: e("spcMeasurementSection", "Measurement SPC") + " — " + e("spcRuleSummarySection", "Rule Violations"),
        type: "table",
        tableHeaders: [e("rule", "Rule"), e("name", "Name"), e("count", "Count")],
        tableRows: mpSpc.ruleSummary.map((rs: any) => [`R${rs.rule}`, rs.name, rs.count]),
      });
    }
    if (Array.isArray(mpSpc.sampleTable) && mpSpc.sampleTable.length) {
      sections.push({
        title: e("spcSampleTableSection", "SPC Subgroup Samples"),
        type: "table",
        tableHeaders: ["#", e("values", "Values"), "X̄", "R", e("violatedRules", "Rules")],
        tableRows: mpSpc.sampleTable.slice(0, STATION_SAMPLE_TABLE_CAP).map((row: any) => [
          row.index,
          Array.isArray(row.values) ? row.values.join(", ") : "",
          row.mean,
          row.range,
          (row.violatedRules || []).map((r: number) => `R${r}`).join(" ") || "—",
        ]),
      });
    }
  }

  /* ── 7. Histogram chart + stats (incl. mode, doc 32 §6.4 #12) ── */
  if (histogramData?.bins?.length) {
    sections.push({ title: e("histogramSection", "Histogram"), type: "chart", chartElementId: "chart-histogram" });
    const s = histogramData.stats;
    if (s) {
      sections.push({
        title: e("histogramSection", "Histogram"),
        type: "stats",
        stats: [
          { label: "Mean", value: `${s.mean}%` },
          { label: "Median", value: `${s.median}%` },
          ...(s.mode != null ? [{ label: "Mode", value: `${s.mode}%` }] : []),
          { label: "Std Dev", value: s.stddev?.toFixed?.(2) ?? s.stddev },
          { label: "Skewness", value: s.skewness?.toFixed?.(2) ?? s.skewness },
          { label: "Kurtosis", value: s.kurtosis?.toFixed?.(2) ?? s.kurtosis },
          { label: "N", value: String(s.n) },
          { label: "Min", value: `${s.min}%` },
          { label: "Max", value: `${s.max}%` },
        ],
      });
    }
  }

  /* ── 8. Scatter chart + correlation stats ─────────── */
  if (scatterData?.points?.length) {
    sections.push({ title: e("scatterSection", "Scatter"), type: "chart", chartElementId: "chart-scatter" });
    sections.push({
      title: e("scatterSection", "Scatter"),
      type: "stats",
      stats: [
        { label: e("correlation", "Correlation"), value: String(scatterData.correlation) },
        { label: e("rSquared", "R²"), value: String(scatterData.rSquared) },
        {
          label: e("relationship", "Relationship"),
          value: `${Math.abs(scatterData.correlation) > 0.7 ? "Strong" : Math.abs(scatterData.correlation) > 0.3 ? "Moderate" : "Weak"} ${scatterData.correlation >= 0 ? "+" : "−"}`,
        },
      ],
    });
  }

  /* ── 9. Ishikawa (Cause-Effect) text ─────────────── */
  if (causeEffectData?.categories?.length) {
    const catText = causeEffectData.categories
      .map((cat: any) => {
        const causes = cat.causes?.map((c: any) => `  • [${c.severity}] ${c.cause}: ${c.detail}`).join("\n") || "";
        return `${cat.name}:\n${causes}`;
      })
      .join("\n\n");
    sections.push({ title: e("ishikawaSection", "Cause & Effect"), type: "text", text: catText });
  }

  /* ── 10. Check sheet ─────────────────────────────── */
  if (checkSheetData?.matrix?.length) {
    const dt = checkSheetData.defectTypes || [];
    sections.push({
      title: e("checkSheetSection", "Check Sheet"),
      type: "table",
      tableHeaders: [e("date", "Date"), ...dt.map((d: any) => d.code), e("total", "Total")],
      tableRows: checkSheetData.matrix.map((row: any) => [
        row.period,
        ...dt.map((d: any) => row[`d${d.id}`] || 0),
        checkSheetData.totals?.byPeriod?.[row.period] || 0,
      ]),
    });
  }

  /* ── 11. Stratification charts + tables ───────────── */
  if (stratData?.byMachine?.length) {
    sections.push({ title: e("stratByMachine", "Stratification by Machine"), type: "chart", chartElementId: "chart-strat-machine" });
    sections.push({
      title: e("stratByMachine", "Stratification by Machine"),
      type: "table",
      tableHeaders: [e("machineCode", "Machine"), e("ok", "OK"), e("ng", "NG"), e("ntf", "NTF"), e("yield", "Yield")],
      tableRows: stratData.byMachine.map((m: any) => [m.machineCode, m.ok, m.ng, m.ntf, `${m.yield}%`]),
    });
  }
  if (stratData?.byShift?.length) {
    sections.push({ title: e("stratByShift", "Stratification by Shift"), type: "chart", chartElementId: "chart-strat-shift" });
    sections.push({
      title: e("stratByShift", "Stratification by Shift"),
      type: "table",
      tableHeaders: [e("shift", "Shift"), e("ok", "OK"), e("ng", "NG"), e("yield", "Yield")],
      tableRows: stratData.byShift.map((s: any) => [s.shift, s.ok, s.ng, `${s.yield}%`]),
    });
  }
  if (stratData?.byDay?.length) {
    sections.push({ title: e("stratByDay", "Stratification by Day"), type: "chart", chartElementId: "chart-strat-day" });
    sections.push({
      title: e("stratByDay", "Stratification by Day"),
      type: "table",
      tableHeaders: [e("dayOfWeek", "Day"), e("total", "Total"), e("ng", "NG"), e("yield", "Yield")],
      tableRows: stratData.byDay.map((d: any) => [d.day, d.total, d.ng, `${d.yield}%`]),
    });
  }

  /* ── 12. AI insights / capability / forecast / anomalies / clusters ── */
  if (aiData?.insights?.length) {
    sections.push({
      title: e("aiInsightsSection", "AI Insights"),
      type: "text",
      text: aiData.insights.map((ins: any) => `[${ins.severity}] ${ins.title}: ${ins.description}`).join("\n"),
    });
  }
  if (aiData?.processCapability) {
    const pc = aiData.processCapability;
    sections.push({
      title: e("processCapSection", "Process Capability"),
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
  if (aiData?.forecast?.length) {
    sections.push({ title: e("forecastSection", "Forecast"), type: "chart", chartElementId: "chart-ai-forecast" });
    sections.push({
      title: e("forecastSection", "Forecast"),
      type: "table",
      tableHeaders: [e("day", "Day"), e("predicted", "Predicted"), e("upper", "Upper"), e("lower", "Lower")],
      tableRows: aiData.forecast.map((f: any) => [
        (() => { try { return new Date(f.day).toLocaleDateString(); } catch { return f.day; } })(),
        `${f.predicted}%`, `${f.upper}%`, `${f.lower}%`,
      ]),
    });
  }
  if (aiData?.anomalies?.length) {
    sections.push({
      title: e("anomaliesSection", "Anomalies"),
      type: "table",
      tableHeaders: [e("day", "Day"), e("yield", "Yield"), e("type", "Type"), e("zScore", "Z-Score")],
      tableRows: aiData.anomalies.map((a: any) => [
        (() => { try { return new Date(a.day).toLocaleDateString(); } catch { return a.day; } })(),
        `${a.yield}%`, a.type?.replace("_", " "), a.zScore,
      ]),
    });
  }
  if (aiData?.clusters?.length) {
    sections.push({
      title: e("clusterSection", "Clustering"),
      type: "stats",
      stats: aiData.clusters.map((cl: any) => ({
        label: `${cl.label} (${cl.count} ${e("days", "days")})`,
        value: `${e("centroid", "centroid")}: ${cl.centroid}%`,
      })),
    });
  }

  /* ── 13. Diagnostics ─────────────────────────────── */
  if (diagnostics?.alerts?.length) {
    sections.push({
      title: e("diagnosticsAlertsSection", "Diagnostics — Alerts"),
      type: "table",
      tableHeaders: [e("severity", "Severity"), e("alertTitle", "Title"), e("description", "Description")],
      tableRows: diagnostics.alerts.map((a: any) => [a.severity, a.title, a.description]),
    });
  }
  if (diagnostics?.patterns?.length) {
    sections.push({
      title: e("diagnosticsPatternsSection", "Diagnostics — Patterns"),
      type: "table",
      tableHeaders: [e("type", "Type"), e("confidence", "Confidence"), e("description", "Description")],
      tableRows: diagnostics.patterns.map((p: any) => [p.type, `${Math.round(p.confidence * 100)}%`, p.description]),
    });
  }
  if (diagnostics?.recommendations?.length) {
    sections.push({
      title: e("diagnosticsRecsSection", "Diagnostics — Recommendations"),
      type: "table",
      tableHeaders: [e("priority", "Priority"), e("action", "Action"), e("rationale", "Rationale")],
      tableRows: diagnostics.recommendations.map((r: any) => [r.priority, r.action, r.rationale]),
    });
  }

  /* ── 14. Station detail — points table + board/gallery visuals (doc 32 §6.4 #6) ── */
  if (stationDetail?.points?.length) {
    sections.push({
      title: e("stationDetailSection", "Station Detail — Inspection Points"),
      type: "table",
      tableHeaders: [
        e("pointCode", "Code"), e("pointName", "Name"), e("status", "Status"),
        e("totalInspected", "Inspected"), e("totalDefects", "Defects"), e("defectRate", "Defect Rate"),
      ],
      tableRows: stationDetail.points.map((p: any) => [
        p.pointCode ?? p.code, p.pointName ?? p.name, p.status,
        p.totalInspected ?? "—", p.totalDefects ?? p.ngCount ?? "—",
        p.defectRate != null ? `${p.defectRate}%` : "—",
      ]),
    });
  }
  if (input.hasBoardImage) {
    sections.push({ title: e("boardImageSection", "Board — Inspection Point Map"), type: "chart", chartElementId: "chart-board-image" });
  }
  if (input.ngImageCount && input.ngImageCount > 0) {
    sections.push({ title: `${e("ngGallerySection", "NG Defect Images")} (${input.ngImageCount})`, type: "chart", chartElementId: "chart-ng-gallery" });
  }

  return sections;
}

/** Flatten NG error images across all inspection points for the gallery print view. */
export function flattenNgImages(stationDetail: any, cap = 24): Array<{ id: any; url: string; label: string }> {
  const points: any[] = stationDetail?.points ?? [];
  const out: Array<{ id: any; url: string; label: string }> = [];
  for (const p of points) {
    for (const img of p.errorImages ?? []) {
      if (!img?.imageUrl) continue;
      out.push({
        id: img.id ?? `${p.code}-${out.length}`,
        url: img.imageUrl,
        label: `${p.code || p.pointCode || ""}${img.serialNumber ? ` · ${img.serialNumber}` : ""}${img.measuredValue != null && img.measuredValue !== "—" ? ` · ${img.measuredValue}` : ""}`,
      });
      if (out.length >= cap) return out;
    }
  }
  return out;
}
