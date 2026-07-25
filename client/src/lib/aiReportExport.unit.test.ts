import { describe, it, expect } from "vitest";
import { buildAiExportConfig } from "./aiReportExport";

// doc 32 P0 #3 — AIReportsPage previously had NO export. These prove the export
// config builder (fed to ReportExportButton) emits the right sections per tab.
const t = (_k: string, d?: string) => d ?? _k;
const RANGE = { from: "2026-07-01", to: "2026-07-05" };

describe("buildAiExportConfig", () => {
  it("daily → stats + narrative + recommendations table", () => {
    const cfg = buildAiExportConfig(
      "daily",
      { totalInspections: 500, okCount: 480, ngCount: 20, yieldRate: 0.96, narrative: "Good day", recommendations: ["Tune AOI-01"] },
      RANGE,
      t,
    );
    expect(cfg.filenamePrefix).toBe("ai_report_daily");
    expect(cfg.subtitle).toBe("2026-07-01 → 2026-07-05");
    const types = cfg.sections.map((s) => s.type);
    expect(types).toContain("stats");
    expect(types).toContain("text");
    expect(types).toContain("table");
    const stats = cfg.sections.find((s) => s.type === "stats")!;
    expect(stats.stats).toEqual(
      expect.arrayContaining([{ label: "Yield", value: "96.0%" }]),
    );
  });

  it("model → table of models with accuracy + drift", () => {
    const cfg = buildAiExportConfig(
      "model",
      { narrative: "n", models: [{ modelCode: "m1", currentAccuracy: 0.987, accuracyTrend: "improving", driftDetected: false }] },
      RANGE,
      t,
    );
    const table = cfg.sections.find((s) => s.type === "table")!;
    expect(table.tableRows?.[0]).toEqual(["m1", "98.7%", "improving", "OK"]);
  });

  // doc69 W0-5 item 2 — model-performance is now HONEST-EMPTY (dataAvailable:false)
  // when there's no real signal wired; the export must say "unavailable", not a
  // fabricated 0.0% / OK row.
  it("model → dataAvailable:false renders 'metrics unavailable', not a fabricated 0.0%/OK row", () => {
    const cfg = buildAiExportConfig(
      "model",
      {
        narrative: "n",
        models: [{ modelCode: "m1", dataAvailable: false, currentAccuracy: null, accuracyTrend: null, driftDetected: null }],
      },
      RANGE,
      t,
    );
    const table = cfg.sections.find((s) => s.type === "table")!;
    expect(table.tableRows?.[0]).toEqual(["m1", "Số liệu chưa khả dụng", "", ""]);
  });

  it("executive → KPI stats + forecast", () => {
    const cfg = buildAiExportConfig(
      "executive",
      { kpis: { totalProduction: 1000, overallYield: 0.94, avgDefectRate: 0.06, topPerformingMachine: "AVI-9" }, forecast: "up" },
      RANGE,
      t,
    );
    expect(cfg.sections.some((s) => s.type === "stats")).toBe(true);
    expect(cfg.sections.some((s) => s.type === "text" && s.text === "up")).toBe(true);
  });

  it("no data → still a valid config with a title and zero sections", () => {
    const cfg = buildAiExportConfig("rca", undefined, RANGE, t);
    expect(cfg.title).toBeTruthy();
    expect(cfg.sections).toEqual([]);
  });
});
