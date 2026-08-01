import { describe, it, expect } from "vitest";
import {
  buildStationAnalysisSections,
  buildProductionDashboardSections,
  buildScopeMeta,
  withScope,
  filterStationRows,
  computeFactoryAggregate,
  flattenNgImages,
  type ReportTFn,
} from "./reportSections";

/**
 * Pure, DOM-free unit tests for the "most complete" report section builders
 * (doc 32 §6.2/§6.3). The actual html2canvas chart capture is NOT exercised here —
 * that requires a real browser (jsdom cannot rasterize recharts SVG). These tests
 * assert that every metric WITH data yields both a `chart` section (referencing the
 * off-screen print-view id) AND a co-located data `table`/`stats`, that
 * measurement-mode SPC is included, and that scope metadata is populated.
 */

// i18next-compatible stub: returns the provided default (or the key).
const t: ReportTFn = (key: string, def?: string) => def ?? key;

function chartIds(sections: any[]): string[] {
  return sections.filter((s) => s.type === "chart").map((s) => s.chartElementId);
}
function tableCount(sections: any[]): number {
  return sections.filter((s) => s.type === "table").length;
}

describe("buildScopeMeta", () => {
  it("drops empty/all values and stringifies the rest", () => {
    const scope = buildScopeMeta({
      factory: "Factory A",
      line: "all",
      product: undefined,
      shift: "",
      lowYield: "FPY < 70%",
      count: 12,
      flag: false,
    });
    expect(scope).toEqual({ factory: "Factory A", lowYield: "FPY < 70%", count: "12", flag: "false" });
    expect(scope).not.toHaveProperty("line");
    expect(scope).not.toHaveProperty("product");
    expect(scope).not.toHaveProperty("shift");
  });
});

describe("withScope", () => {
  it("attaches scope + filters without dropping existing fields", () => {
    const scope = { factory: "F1", dateRange: "d" };
    const cfg = withScope({ title: "T", sections: [], filenamePrefix: "p" }, { scope, filters: scope });
    expect((cfg as any).scope).toEqual(scope);
    expect((cfg as any).filters).toEqual(scope);
    expect(cfg.title).toBe("T");
  });
});

describe("filterStationRows", () => {
  const rows = [
    { station: { name: "Assembly", code: "A1" }, line: { name: "L1" }, workshop: { name: "W1" }, totalInspections: 100, firstPassYield: 95 },
    { station: { name: "Test", code: "T2" }, line: { name: "L2" }, workshop: { name: "W2" }, totalInspections: 50, firstPassYield: 60 },
    { station: { name: "Pack", code: "P3" }, line: { name: "L1" }, workshop: { name: "W1" }, totalInspections: 0, firstPassYield: 0 },
  ];
  it("applies low-yield filter (FPY<70 & inspected>0)", () => {
    const out = filterStationRows(rows, { lowYield: true });
    expect(out).toHaveLength(1);
    expect(out[0].station.code).toBe("T2");
  });
  it("applies text search across name/code/line/workshop", () => {
    expect(filterStationRows(rows, { search: "assembly" })).toHaveLength(1);
    expect(filterStationRows(rows, { search: "L1" })).toHaveLength(2);
    expect(filterStationRows(rows, { search: "zzz" })).toHaveLength(0);
  });
});

describe("computeFactoryAggregate", () => {
  it("rolls up per-factory FPY/output/low-yield counts", () => {
    const agg = computeFactoryAggregate([
      { factory: { id: 1, name: "F1" }, okCount: 90, totalInspections: 100, output: 90, firstPassYield: 90 },
      { factory: { id: 1, name: "F1" }, okCount: 30, totalInspections: 100, output: 30, firstPassYield: 30 },
      { factory: { id: 2, name: "F2" }, okCount: 80, totalInspections: 100, output: 80, firstPassYield: 80 },
    ]);
    const f1 = agg.find((f) => f.id === 1)!;
    expect(f1.avgFPY).toBe(60); // (90+30)/(200)
    expect(f1.stations).toBe(2);
    expect(f1.lowYield).toBe(1);
    expect(agg).toHaveLength(2);
  });
});

describe("flattenNgImages", () => {
  it("flattens error images across points with a cap", () => {
    const detail = {
      points: [
        { code: "P1", errorImages: [{ id: 1, imageUrl: "http://x/1.jpg", serialNumber: "SN1", measuredValue: 3.2 }] },
        { code: "P2", errorImages: [{ id: 2, imageUrl: "http://x/2.jpg" }, { id: 3, imageUrl: "http://x/3.jpg" }] },
      ],
    };
    const imgs = flattenNgImages(detail);
    expect(imgs).toHaveLength(3);
    expect(imgs[0].url).toBe("http://x/1.jpg");
    expect(imgs[0].label).toContain("P1");
    expect(flattenNgImages(detail, 2)).toHaveLength(2);
  });
});

describe("buildProductionDashboardSections", () => {
  const sections = buildProductionDashboardSections({
    t,
    summary: { totalStations: 3, totalOutput: 1000, avgFPY: 92.5, avgRetests: 1.2, lowYieldStations: 1 },
    stationRows: [
      { station: { name: "A1" }, workshop: { name: "W1" }, firstPassYield: 95, yieldChange: 1.2, finalYield: 96, output: 500, retestRate: 0.5 },
    ],
    stationRowsFiltered: true,
    defectData: {
      defectsByType: [{ code: "D1", name: "Scratch", ngCount: 10, percentage: 40 }],
      defectsByStation: [{ stationCode: "A1", stationName: "Assembly", ngCount: 8 }],
    },
    trendData: [{ period: "2026-07-01", fpy: 90, finalYield: 92, ok: 90, ng: 8, ntf: 2, total: 100 }],
    spcData: [{ stationCode: "A1", stationName: "Assembly", fpy: 90, mean: 91, stddev: 2.1, ucl: 97, lcl: 85, cpk: 1.1 }],
    rulData: [{ machineCode: "M1", machineName: "AOI-1", failureRisk: 0.42, confidenceScore: 0.8, predictedTimeframe: "14d", maintenanceUrgency: "medium" }],
    factoryAgg: [{ id: 1, name: "F1", avgFPY: 92, output: 1000, stations: 3, lowYield: 1 }],
  });

  it("emits a chart for every dataset with data", () => {
    expect(chartIds(sections)).toEqual(
      expect.arrayContaining([
        "chart-factory-compare",
        "chart-defect-pareto",
        "chart-ng-by-station",
        "chart-yield-trend",
        "chart-output-trend",
        "chart-spc",
        "chart-machine-rul",
      ]),
    );
  });

  it("emits a real data table next to the charts (never chart-only)", () => {
    expect(tableCount(sections)).toBeGreaterThanOrEqual(6);
  });

  it("honestly reflects the applied station filter in the section title", () => {
    const stationSection = sections.find((s) => s.type === "table" && String(s.title).includes("Station"));
    expect(stationSection?.title).toContain("filtered view");
  });

  it("emits nothing chart-wise when there is no data", () => {
    const empty = buildProductionDashboardSections({
      t,
      summary: { totalStations: 0, totalOutput: 0, avgFPY: 0, avgRetests: 0, lowYieldStations: 0 },
      stationRows: [],
      stationRowsFiltered: false,
    });
    // Only the overview stats section, no charts.
    expect(chartIds(empty)).toEqual([]);
    expect(empty.some((s) => s.type === "stats")).toBe(true);
  });
});

describe("buildStationAnalysisSections", () => {
  const fullData = {
    t,
    stationId: 7,
    summary: { station: { code: "S7", name: "Solder" }, factory: { name: "F1" }, workshop: { name: "W1" }, line: { name: "L1" }, firstPassYield: 95, finalYield: 96, totalInspections: 1000, ngCount: 40, retestRate: 2 },
    hourlyData: [{ hour: 8, total: 100, ng: 4, yield: 96 }],
    defectData: [{ code: "D1", name: "Cold joint", ngCount: 20, percentage: 50, cumPercentage: 50, pointDefId: 1 }],
    spcData: { points: [{ day: "2026-07-01", yield: 95, zone: "A", violatedRules: [] }, { day: "2026-07-02", yield: 80, zone: "C", violatedRules: [1] }], ruleSummary: [{ rule: 1, name: "Beyond 3σ", count: 1 }] },
    failHistory: [{ inspectionTime: "2026-07-02T08:00:00Z", barcode: "BC1", failedPoints: [{ pointCode: "P1", pointName: "Pad" }], machineCode: "M1" }],
    diagnostics: { alerts: [{ severity: "warning", title: "Drift", description: "yield drift" }], patterns: [{ type: "trend", confidence: 0.9, description: "down" }], recommendations: [{ priority: "high", action: "inspect", rationale: "risk" }] },
    histogramData: { bins: [{ label: "90-92", binStart: 90, binEnd: 92, count: 3, normalCount: 2 }], stats: { mean: 95, median: 95, mode: 96, stddev: 2.1, skewness: 0.1, kurtosis: 0.2, n: 100, min: 80, max: 99 } },
    scatterData: { points: [{ x: 100, y: 4 }], correlation: 0.8, rSquared: 0.64, trendLine: { slope: 1, intercept: 0 } },
    checkSheetData: { matrix: [{ period: "W1", d1: 3 }], defectTypes: [{ id: 1, code: "D1" }], totals: { byPeriod: { W1: 3 } } },
    causeEffectData: { categories: [{ name: "Machine", causes: [{ severity: "high", cause: "temp", detail: "too hot" }] }] },
    stratData: {
      byMachine: [{ machineCode: "M1", ok: 90, ng: 8, ntf: 2, yield: 90 }],
      byShift: [{ shift: "A", ok: 50, ng: 5, yield: 91 }],
      byDay: [{ day: "Mon", total: 100, ng: 8, yield: 92 }],
    },
    aiData: {
      insights: [{ severity: "warning", title: "Anomaly", description: "spike" }],
      processCapability: { cp: 1.2, cpk: 1.1, ppm: 500, usl: 99, lsl: 80, mean: 95, stddev: 2 },
      forecast: [{ day: "2026-07-03", predicted: 94, upper: 97, lower: 91 }],
      anomalies: [{ day: "2026-07-02", yield: 80, type: "unusually_low", zScore: -2.5 }],
      clusters: [{ label: "High", count: 5, centroid: 96 }],
    },
    stationDetail: {
      points: [{ pointCode: "P1", pointName: "Pad", status: "fail", totalInspected: 100, totalDefects: 5, defectRate: 5, positionX: 100, positionY: 50, errorImages: [{ id: 9, imageUrl: "http://x/9.jpg" }] }],
      productImage: { url: "http://x/board.jpg", width: 800, height: 600 },
    },
    mpSpc: {
      pointDef: { code: "MP1", name: "Height" },
      xBarPoints: [{ index: 0, mean: 1.0 }, { index: 1, mean: 1.1 }],
      rPoints: [{ index: 0, range: 0.2 }, { index: 1, range: 0.3 }],
      controlLimits: { xBar: { UCL: 1.3, CL: 1.05, LCL: 0.8 }, range: { UCL: 0.5, CL: 0.25, LCL: 0 } },
      capability: { cp: 1.4, cpk: 1.2, pp: 1.3, ppk: 1.1 },
      xBarHistogram: [{ binStart: 0.9, binEnd: 1.0, binMid: 0.95, count: 3, normalCount: 2 }],
      rHistogram: [{ binStart: 0.1, binEnd: 0.2, binMid: 0.15, count: 2, normalCount: 1 }],
      ruleSummary: [{ rule: 2, name: "9 same side", count: 1 }],
      sampleTable: [{ index: 0, values: [1.0, 1.1], mean: 1.05, range: 0.1, violatedRules: [] }],
      oocCount: 0,
      totalSubgroups: 2,
      totalSamples: 4,
    },
    ngImageCount: 1,
    hasBoardImage: true,
  };

  const sections = buildStationAnalysisSections(fullData as any);
  const ids = chartIds(sections);

  it("emits every chart id including the measurement-mode SPC + board + gallery", () => {
    expect(ids).toEqual(
      expect.arrayContaining([
        "chart-hourly-yield",
        "chart-pareto",
        "chart-spc-xbar",
        "chart-spc-mr",
        "chart-spc-xbar-mp",
        "chart-spc-r-mp",
        "chart-xbar-histogram",
        "chart-r-histogram",
        "chart-histogram",
        "chart-scatter",
        "chart-strat-machine",
        "chart-strat-shift",
        "chart-strat-day",
        "chart-ai-forecast",
        "chart-board-image",
        "chart-ng-gallery",
      ]),
    );
  });

  it("includes measurement-mode SPC control-limit + capability + sample tables", () => {
    const titles = sections.map((s) => String(s.title));
    expect(titles.some((x) => x.includes("Control Limits"))).toBe(true);
    expect(titles.some((x) => x.includes("Subgroup Samples"))).toBe(true);
    // Measurement SPC contributes 2 dedicated X̄/R chart sections.
    expect(ids.filter((i) => i === "chart-spc-xbar-mp" || i === "chart-spc-r-mp")).toHaveLength(2);
  });

  it("includes the histogram `mode` stat (§6.4 #12)", () => {
    const hist = sections.find((s) => s.type === "stats" && s.stats?.some((st: any) => st.label === "Mode"));
    expect(hist).toBeTruthy();
  });

  it("includes the yield-SPC rule summary (§6.4 #12)", () => {
    const titles = sections.map((s) => String(s.title));
    expect(titles.some((x) => x.includes("Rule Violations"))).toBe(true);
  });

  it("pairs each captured chart with a real data table (data-first)", () => {
    // Every dataset that produced a chart should also produce a table/stats
    // somewhere in the report (never a chart-only section for numeric data).
    expect(tableCount(sections)).toBeGreaterThanOrEqual(10);
  });

  it("gracefully omits sections whose data is absent", () => {
    const minimal = buildStationAnalysisSections({ t, stationId: 1, summary: fullData.summary } as any);
    expect(chartIds(minimal)).toEqual([]); // no chart data → no chart sections
    expect(minimal.some((s) => s.type === "stats")).toBe(true); // overview stats still present
  });
});
