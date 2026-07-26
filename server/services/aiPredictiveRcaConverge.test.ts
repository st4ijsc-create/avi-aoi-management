/**
 * Tests for doc69 Wave 2 / A2 — both halves of "converge onto the real engines":
 *
 *  (1) deriveDefectSpikeSignal (server/services/aiPredictiveAlertService.ts) — the
 *      predictive-alert SIGNAL now comes from the REAL yield-forecast engine
 *      (aiInspectionAnalytics.forecastYield: Holt-Winters/EWMA/Linear per
 *      data-length, confidence tied to real forecast error), not the old inline
 *      7-point OLS + hardcoded 10% threshold + hardcoded recommendation strings
 *      mislabeled `modelUsed: 'Linear Regression'`.
 *
 *  (2) aiBatchRcaScheduler.runBatchRCAOnce — batch RCA converges onto the
 *      evidence-rich aiRcaCopilot when AI_RCA_COPILOT_ENABLED is on, and keeps
 *      the existing shallow generateRCAInsights path as the FALLBACK when the
 *      flag is off (default, unchanged behavior). Fail-safe per machine.
 *
 * Part (2) mocks aiRcaCopilot/aiInsightsService/aiLocalKnowledgeService/db
 * entirely — pure orchestration test, no real DB/LLM.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ════════════════════════════════════════════════════════════════════════════
// Part 1 — deriveDefectSpikeSignal (pure, no mocks needed)
// ════════════════════════════════════════════════════════════════════════════
import { deriveDefectSpikeSignal } from "./aiPredictiveAlertService";
import type { DefectTrendPoint, DefectParetoItem, YieldForecast } from "./aiInspectionAnalytics";
import type { FactorCorrelation } from "./ai/defectCorrelationService";

function day(offset: number): string {
  const d = new Date("2026-01-01T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function trendPoint(offset: number, defectRatePct: number): DefectTrendPoint {
  const total = 100;
  const fail = Math.round((total * defectRatePct) / 100);
  return { date: day(offset), total, pass: total - fail, fail, yieldRate: 100 - defectRatePct, defectRate: defectRatePct };
}

function flatTrend(days: number, defectRatePct: number): DefectTrendPoint[] {
  return Array.from({ length: days }, (_, i) => trendPoint(i, defectRatePct));
}

describe("deriveDefectSpikeSignal — real forecast signal (doc69 A2)", () => {
  it("honestly returns null when there is not enough trend data (mirrors the old min-data gate)", () => {
    const trend = [trendPoint(0, 5)]; // 1 day only
    const forecast: YieldForecast[] = [{ date: day(7), predicted: 90, lowerBound: 80, upperBound: 100, confidence: 0.3 }];
    expect(deriveDefectSpikeSignal({ trend, forecast, pareto: [] })).toBeNull();
  });

  it("honestly returns null when the forecast engine produced no forecast", () => {
    const trend = flatTrend(14, 5);
    expect(deriveDefectSpikeSignal({ trend, forecast: [], pareto: [] })).toBeNull();
  });

  it("derives predictedValue/currentValue/confidence FROM the real forecast — not a hardcoded 10% gate", () => {
    const trend = flatTrend(14, 5); // 14-day flat 5% baseline → Holt-Winters range (>=14 days)
    // Predicted defect rate at the horizon is 10% — i.e. AT (not clearly over) the old
    // hardcoded "predictedRate > 10%" gate — but it IS a real +5pp rise over this
    // machine's OWN baseline, so the new engine alerts on the real delta instead.
    const forecast: YieldForecast[] = [
      { date: day(15), predicted: 92, lowerBound: 85, upperBound: 99, confidence: 0.5 },
      { date: day(16), predicted: 90, lowerBound: 80, upperBound: 100, confidence: 0.45 },
    ];
    const signal = deriveDefectSpikeSignal({ trend, forecast, pareto: [] });
    expect(signal).not.toBeNull();
    expect(signal!.currentValue).toBeCloseTo(5, 5);
    expect(signal!.predictedValue).toBeCloseTo(10, 5); // 100 - 90 (last horizon point)
    expect(signal!.confidenceScore).toBeCloseTo(45, 5); // 0.45 * 100 — REAL, from forecast.confidence
    expect(signal!.dataPoints).toBe(14);
    expect(signal!.modelUsed).toContain("holt-winters");
    expect(signal!.modelUsed).not.toBe("Linear Regression"); // the old mislabel is gone
  });

  it("labels modelUsed with the ACTUAL method for 7-13 days of data (EWMA), not a fixed label", () => {
    const trend = flatTrend(8, 4);
    const forecast: YieldForecast[] = [{ date: day(9), predicted: 90, lowerBound: 80, upperBound: 99, confidence: 0.6 }];
    const signal = deriveDefectSpikeSignal({ trend, forecast, pareto: [] });
    expect(signal!.modelUsed).toContain("ewma");
  });

  it("does not fabricate an alert on a flat/noisy trend even at a high absolute level", () => {
    const trend = flatTrend(14, 12); // baseline already above the OLD hardcoded 10% level
    const forecast: YieldForecast[] = [{ date: day(15), predicted: 87.5, lowerBound: 80, upperBound: 95, confidence: 0.8 }]; // barely moves
    expect(deriveDefectSpikeSignal({ trend, forecast, pareto: [] })).toBeNull();
  });

  it("derives severity from delta × confidence — scaling with the real signal, not a fixed absolute cutoff", () => {
    const trend = flatTrend(14, 5);
    const bigDelta: YieldForecast[] = [{ date: day(15), predicted: 75, lowerBound: 60, upperBound: 90, confidence: 0.9 }]; // defect 25%, delta 20pp, conf .9
    const smallDelta: YieldForecast[] = [{ date: day(15), predicted: 92, lowerBound: 85, upperBound: 99, confidence: 0.4 }]; // defect 8%, delta 3pp, conf .4
    expect(deriveDefectSpikeSignal({ trend, forecast: bigDelta, pareto: [] })!.severity).toBe("CRITICAL");
    expect(deriveDefectSpikeSignal({ trend, forecast: smallDelta, pareto: [] })!.severity).toBe("MEDIUM");
  });

  it("recommendations + factors are DATA-DERIVED from the real Pareto, not the old hardcoded strings", () => {
    const trend = flatTrend(14, 5);
    const forecast: YieldForecast[] = [{ date: day(15), predicted: 85, lowerBound: 70, upperBound: 95, confidence: 0.7 }];
    const pareto: DefectParetoItem[] = [
      { defectType: "Solder Bridge", count: 40, percentage: 66.7, cumulativePercentage: 66.7 },
      { defectType: "Missing Component", count: 20, percentage: 33.3, cumulativePercentage: 100 },
    ];
    const signal = deriveDefectSpikeSignal({ trend, forecast, pareto });
    expect(signal!.factors[0]).toEqual({ name: "Solder Bridge", contribution: 66.7, description: "40 NG in window (66.7% of defects)" });
    expect(signal!.recommendations[0]).toContain("Solder Bridge");
    // The old hardcoded, non-data-derived recommendation strings must be gone.
    for (const old of ["Review machine calibration", "Check material quality", "Inspect tooling wear"]) {
      expect(signal!.recommendations.join(" ")).not.toContain(old);
    }
  });

  it("falls back to an honest GENERIC recommendation (not a fabricated specific) with no pareto/correlation evidence", () => {
    const trend = flatTrend(14, 5);
    const forecast: YieldForecast[] = [{ date: day(15), predicted: 85, lowerBound: 70, upperBound: 95, confidence: 0.7 }];
    const signal = deriveDefectSpikeSignal({ trend, forecast, pareto: [] });
    expect(signal!.recommendations).toHaveLength(1);
    expect(signal!.recommendations[0]).toMatch(/no single dominant factor/i);
  });

  it("surfaces quantitative upstream-correlation factors in recommendations when supplied (optional, additive)", () => {
    const trend = flatTrend(14, 5);
    const forecast: YieldForecast[] = [{ date: day(15), predicted: 85, lowerBound: 70, upperBound: 95, confidence: 0.7 }];
    const correlationFactors: FactorCorrelation[] = [
      {
        factor: "reflow.peakTempC",
        n: 40,
        pearson: 0.62,
        pValue: 0.0004,
        logisticCoef: 0.11,
        direction: "higher_more_defects",
        significant: true,
        meanDefect: 251,
        meanOk: 244,
      },
    ];
    const signal = deriveDefectSpikeSignal({ trend, forecast, pareto: [], correlationFactors });
    expect(signal!.recommendations[0]).toContain("reflow.peakTempC");
    expect(signal!.recommendations[0]).toContain("higher values");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Part 2 — aiBatchRcaScheduler convergence onto aiRcaCopilot (flag-gated)
// ════════════════════════════════════════════════════════════════════════════

const isRcaCopilotEnabled = vi.fn();
const runRca = vi.fn();
const persistRca = vi.fn();
vi.mock("./aiRcaCopilot", () => ({
  isRcaCopilotEnabled: (...a: any[]) => isRcaCopilotEnabled(...a),
  runRca: (...a: any[]) => runRca(...a),
  persistRca: (...a: any[]) => persistRca(...a),
}));

const generateRCAInsights = vi.fn();
vi.mock("./aiInsightsService", () => ({
  generateRCAInsights: (...a: any[]) => generateRCAInsights(...a),
}));

const ingestKnowledgeRecordAsync = vi.fn();
vi.mock("./aiLocalKnowledgeService", () => ({
  ingestKnowledgeRecordAsync: (...a: any[]) => ingestKnowledgeRecordAsync(...a),
}));

vi.mock("../../drizzle/schema", () => ({ rootCauseAnalysis: {} }));

// db.execute is called once per fetchActiveMachines() and (legacy path only) once
// per fetchInspectionRows() — queued responses consumed in call order.
let executeResponses: any[][] = [];
let executeCallIndex = 0;
const insertValues = vi.fn(async () => undefined);
const fakeDb = {
  execute: vi.fn(async () => {
    const r = executeResponses[executeCallIndex] ?? [];
    executeCallIndex++;
    return r;
  }),
  insert: vi.fn(() => ({ values: insertValues })),
};
vi.mock("../db", () => ({ getDb: async () => fakeDb }));

import { runBatchRCAOnce } from "./aiBatchRcaScheduler";

beforeEach(() => {
  vi.clearAllMocks();
  executeResponses = [];
  executeCallIndex = 0;
});

describe("aiBatchRcaScheduler.runBatchRCAOnce — converge onto aiRcaCopilot (doc69 A2)", () => {
  it("AI_RCA_COPILOT_ENABLED=on: runs the evidence-rich copilot per machine, not the shallow Pareto path", async () => {
    isRcaCopilotEnabled.mockReturnValue(true);
    executeResponses = [[{ id: 7, code: "M-07", ng_count: 5 }]]; // fetchActiveMachines only
    const rcaResult = {
      ok: true,
      machineId: 7,
      lang: "vi",
      evidence: { paretoTop: [], spc: null, anomaly: null, visionDescription: null, recentConfigChanges: [], similarIncidents: [], recentCorrections: [], causalText: "", quantitativeCorrelations: [], notes: [] },
      hypotheses: [{ cause: "Reflow temp drift", confidence: 0.8, evidence: ["spc out-of-control"], recommendedFix: { kind: "INVESTIGATE", rationale: "Check reflow oven profile", oneTap: false } }],
      needsHumanInvestigation: false,
    };
    runRca.mockResolvedValue(rcaResult);
    persistRca.mockResolvedValue(555);

    const stats = await runBatchRCAOnce();

    expect(runRca).toHaveBeenCalledWith({ machineId: 7, lang: "vi" });
    expect(persistRca).toHaveBeenCalledWith(expect.objectContaining({ result: rcaResult, requestedByName: "SYSTEM_BATCH" }));
    expect(generateRCAInsights).not.toHaveBeenCalled(); // shallow fallback untouched
    expect(insertValues).not.toHaveBeenCalled(); // no direct legacy insert — persistRca owns persistence
    expect(ingestKnowledgeRecordAsync).toHaveBeenCalledWith(expect.objectContaining({ sourceId: expect.stringContaining("M-07") }));
    expect(stats.succeeded).toBe(1);
    expect(stats.failed).toBe(0);
  });

  it("AI_RCA_COPILOT_ENABLED=off (default): falls back to generateRCAInsights unchanged", async () => {
    isRcaCopilotEnabled.mockReturnValue(false);
    executeResponses = [
      [{ id: 7, code: "M-07", ng_count: 3 }], // fetchActiveMachines
      [
        { id: 1, result: "NG", measurement_result: "NG", measurement_point_name: "P1" },
        { id: 2, result: "OK", measurement_result: "OK", measurement_point_name: "P1" },
      ], // fetchInspectionRows
    ];
    generateRCAInsights.mockResolvedValue({ summary: "s", rootCauses: [], recommendations: ["r"], preventiveMeasures: [] });

    const stats = await runBatchRCAOnce();

    expect(generateRCAInsights).toHaveBeenCalledTimes(1);
    expect(runRca).not.toHaveBeenCalled();
    expect(persistRca).not.toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledTimes(1); // legacy direct db.insert(rootCauseAnalysis)
    expect(stats.succeeded).toBe(1);
    expect(stats.failed).toBe(0);
  });

  it("is fail-safe per machine: a persist failure on one machine doesn't abort the batch", async () => {
    isRcaCopilotEnabled.mockReturnValue(true);
    executeResponses = [[
      { id: 1, code: "M-01", ng_count: 2 },
      { id: 2, code: "M-02", ng_count: 4 },
    ]];
    runRca.mockResolvedValue({ ok: true, machineId: 1, lang: "vi", evidence: {} as any, hypotheses: [], needsHumanInvestigation: true, note: "NO_CONFIDENT_HYPOTHESIS" });
    persistRca.mockResolvedValueOnce(null).mockResolvedValueOnce(999);

    const stats = await runBatchRCAOnce();

    expect(runRca).toHaveBeenCalledTimes(2);
    expect(stats.machinesProcessed).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.succeeded).toBe(1);
  });

  it("is fail-safe per machine: an unexpected throw from the copilot is isolated (outer try/catch)", async () => {
    isRcaCopilotEnabled.mockReturnValue(true);
    executeResponses = [[
      { id: 1, code: "M-01", ng_count: 2 },
      { id: 2, code: "M-02", ng_count: 4 },
    ]];
    runRca
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        ok: true,
        machineId: 2,
        lang: "vi",
        evidence: {} as any,
        hypotheses: [{ cause: "x", confidence: 0.9, evidence: [], recommendedFix: { kind: "MANUAL", steps: ["a"], rationale: "r", oneTap: false } }],
        needsHumanInvestigation: false,
      });
    persistRca.mockResolvedValue(42);

    const stats = await runBatchRCAOnce();

    expect(stats.failed).toBe(1);
    expect(stats.succeeded).toBe(1);
  });
});
