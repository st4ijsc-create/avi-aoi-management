/**
 * doc69 W0-5 item 2 — server/services/aiReportGenerator.ts `collectModelPerformanceData`
 * used to hardcode currentAccuracy=0, driftDetected=false, totalPredictions=0,
 * avgLatencyMs=0 for every ACTIVE model (no real performance-tracking table/join
 * exists yet) — so `generateModelPerformanceReport` ALWAYS reported every model as
 * "healthy" (accuracy 0% read as "within range" once currentAccuracy<0.9 && totalPredictions>100
 * both evaluated false, and driftDetected was permanently false), regardless of reality.
 *
 * Wave-0 scope = STOP LYING, not full wiring: the fix marks each model
 * `dataAvailable: false` with null metrics instead, and the report's fallback message
 * says "metrics unavailable" rather than "all models performing within acceptable
 * ranges". Full wiring (ai_gateway_metrics / aiDriftMonitor) is deferred (TODO doc69 A4).
 *
 * Mocking follows the established pattern in aiReportGenerator.rcaScope.test.ts (plain
 * drizzle-orm marker replacement + a DB stub whose `.select().from().where().orderBy()`
 * resolves to a controllable row array).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm", () => {
  const sqlTag = (strings: TemplateStringsArray, ...vals: unknown[]) => ({ __op: "sql", strings, vals });
  return {
    sql: sqlTag,
    and: (...args: unknown[]) => ({ __op: "and", args }),
    or: (...args: unknown[]) => ({ __op: "or", args }),
    eq: (...args: unknown[]) => ({ __op: "eq", args }),
    gte: (...args: unknown[]) => ({ __op: "gte", args }),
    lte: (...args: unknown[]) => ({ __op: "lte", args }),
    desc: (arg: unknown) => ({ __op: "desc", args: [arg] }),
  };
});

let modelRows: Array<{ modelId: number; modelCode: string; modelVersion: string | null; status: string }> = [];

function makeDb() {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: vi.fn((_shape: Record<string, unknown>) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = { then: (resolve: (v: unknown[]) => void) => resolve(modelRows) };
      for (const m of ["from", "where", "orderBy"]) {
        chain[m] = vi.fn(() => chain);
      }
      return chain;
    }),
  };
}

const mockGetDb = vi.fn();
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => mockGetDb(...a) }));

const mockGenerateNarrative = vi.fn(async () => ({
  text: "mock narrative",
  provider: "gguf" as const,
  fallbackUsed: false,
  totalTimeMs: 1,
  model: "mock-model",
}));
vi.mock("./aiProviderRouter", () => ({
  generateNarrative: (...a: unknown[]) => mockGenerateNarrative(...a),
}));

import { generateModelPerformanceReport } from "./aiReportGenerator";

const period = { startDate: new Date("2026-07-01T00:00:00Z"), endDate: new Date("2026-07-02T00:00:00Z") };

beforeEach(() => {
  modelRows = [];
  mockGetDb.mockReset();
  mockGetDb.mockResolvedValue(makeDb());
  mockGenerateNarrative.mockClear();
});

describe("generateModelPerformanceReport — honest-empty (doc69 W0-5 item 2)", () => {
  it("marks each ACTIVE model dataAvailable:false with null metrics — NOT fabricated healthy zeros", async () => {
    modelRows = [{ modelId: 1, modelCode: "aoi-defect-v3", modelVersion: "3", status: "ACTIVE" }];

    const report = await generateModelPerformanceReport({ ...period, reportType: "model_performance", language: "en" });

    expect(report.models).toHaveLength(1);
    expect(report.models[0]).toMatchObject({
      modelId: 1,
      modelCode: "aoi-defect-v3",
      dataAvailable: false,
      currentAccuracy: null,
      accuracyTrend: null,
      driftDetected: null,
      totalPredictions: null,
      avgLatencyMs: null,
    });
  });

  it("does NOT claim 'within acceptable ranges' (the old fabricated-healthy message) when no real signal exists", async () => {
    modelRows = [{ modelId: 1, modelCode: "m1", modelVersion: "1", status: "ACTIVE" }];

    const report = await generateModelPerformanceReport({ ...period, reportType: "model_performance", language: "en" });

    expect(report.retrainRecommendations).toHaveLength(1);
    expect(report.retrainRecommendations[0]).toMatch(/unavailable/i);
    expect(report.retrainRecommendations[0]).not.toMatch(/within acceptable ranges/i);
  });

  it("vi language → unavailable message is localized (not the acceptable-ranges fallback)", async () => {
    modelRows = [{ modelId: 1, modelCode: "m1", modelVersion: "1", status: "ACTIVE" }];

    const report = await generateModelPerformanceReport({ ...period, reportType: "model_performance", language: "vi" });

    expect(report.retrainRecommendations[0]).toContain("chưa khả dụng");
  });

  it("multiple ACTIVE models → every one is honest-empty (no per-model fabrication)", async () => {
    modelRows = [
      { modelId: 1, modelCode: "m1", modelVersion: "1", status: "ACTIVE" },
      { modelId: 2, modelCode: "m2", modelVersion: "2", status: "ACTIVE" },
    ];

    const report = await generateModelPerformanceReport({ ...period, reportType: "model_performance", language: "en" });

    expect(report.models).toHaveLength(2);
    expect(report.models.every((m) => m.dataAvailable === false)).toBe(true);
    expect(report.models.every((m) => m.currentAccuracy === null && m.driftDetected === null)).toBe(true);
  });

  it("DB unavailable → empty (not fabricated) models array, no throw", async () => {
    mockGetDb.mockResolvedValue(null);

    const report = await generateModelPerformanceReport({ ...period, reportType: "model_performance", language: "en" });

    expect(report.models).toEqual([]);
  });
});
