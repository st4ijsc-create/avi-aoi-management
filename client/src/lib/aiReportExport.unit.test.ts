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

  it("model → table of models with real latency/error/volume (doc69 A4), accuracy still null (no real source)", () => {
    const cfg = buildAiExportConfig(
      "model",
      {
        narrative: "n",
        models: [{
          modelCode: "m1",
          dataAvailable: true,
          currentAccuracy: null,
          accuracyTrend: null,
          driftDetected: false,
          totalPredictions: 120,
          p95LatencyMs: 340,
          errorRate: 0.032,
        }],
      },
      RANGE,
      t,
    );
    const table = cfg.sections.find((s) => s.type === "table")!;
    expect(table.tableRows?.[0]).toEqual(["m1", "120", "340 ms", "3.2%", "—", "OK"]);
  });

  it("model → currentAccuracy real (future source) renders as a percentage, not '—'", () => {
    const cfg = buildAiExportConfig(
      "model",
      {
        narrative: "n",
        models: [{ modelCode: "m1", dataAvailable: true, currentAccuracy: 0.987, accuracyTrend: "improving", driftDetected: true }],
      },
      RANGE,
      t,
    );
    const table = cfg.sections.find((s) => s.type === "table")!;
    expect(table.tableRows?.[0]).toEqual(["m1", "—", "—", "—", "98.7%", "⚠"]);
  });

  // doc69 W0-5 item 2 / A4 — model-performance is HONEST-EMPTY (dataAvailable:false)
  // when there's no real signal wired at all; the export must say "unavailable", not a
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
    expect(table.tableRows?.[0]).toEqual(["m1", "Số liệu chưa khả dụng", "", "", "", ""]);
  });

  // doc69 A4 — driftDetected can now be null (monitor disabled/under-sampled) even
  // when OTHER fields (latency/error/volume) are real; must render "—", not fabricate
  // "OK" (which would falsely claim "checked, no drift found").
  it("model → driftDetected null (monitor not evaluated) renders '—', not a fabricated OK", () => {
    const cfg = buildAiExportConfig(
      "model",
      {
        narrative: "n",
        models: [{ modelCode: "m1", dataAvailable: true, currentAccuracy: null, accuracyTrend: null, driftDetected: null, totalPredictions: 5 }],
      },
      RANGE,
      t,
    );
    const table = cfg.sections.find((s) => s.type === "table")!;
    expect(table.tableRows?.[0]).toEqual(["m1", "5", "—", "—", "—", "—"]);
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
