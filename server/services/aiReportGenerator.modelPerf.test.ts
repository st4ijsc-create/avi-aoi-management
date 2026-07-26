/**
 * doc69 W0-5 item 2 (T5) established HONEST-EMPTY: `collectModelPerformanceData`
 * used to hardcode currentAccuracy=0, driftDetected=false, totalPredictions=0,
 * avgLatencyMs=0 for every ACTIVE model (no real performance-tracking table/join
 * existed) — so `generateModelPerformanceReport` ALWAYS reported every model as
 * "healthy", regardless of reality. T5's fix marked every model `dataAvailable:
 * false` with null metrics instead.
 *
 * doc69 A4 (this file) wires the REAL signals that now exist:
 *  - latency/throughput/error-rate ← `inference_results` (per modelId, in-window)
 *  - drift ← aiDriftMonitor.checkConfidenceDrift (mocked here — its own unit tests
 *    at aiDriftMonitor.test.ts cover the PSI/KS math)
 *  - accuracy stays null — still no real accuracy source anywhere in this codebase
 * These tests prove: (1) the honest-empty T5 behaviour survives unchanged when
 * there is truly no signal, (2) real inference_results rows now flow through as
 * real numbers, (3) driftDetected is null (not false) when the monitor didn't
 * evaluate, and (4) the drift check is called with emitAlert:false (report
 * generation must not have the side effect of writing alert rows).
 *
 * Mocking follows the established pattern in aiReportGenerator.rcaScope.test.ts —
 * a DB spy that records each `.select({...})` call's column "shape" (which
 * sub-query it is) plus its chained calls, and resolves per-shape from test-owned
 * fixtures (`modelRows` / `statsRowsByModel`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm", () => {
  const sqlTag = (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const node: Record<string, unknown> = { __op: "sql", strings, vals };
    (node as { as?: (alias: string) => unknown }).as = (alias: string) => ({ ...node, __alias: alias });
    return node;
  };
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

type Marker = { __op: string; args: unknown[] };
type Call = { method: string; args: unknown[] };
type SelectRecord = { shape: Record<string, unknown>; calls: Call[] };

let modelRows: Array<{ modelId: number; modelCode: string; modelVersion: string | null; status: string }> = [];
/** keyed by modelId → the single aggregated inference_results row (or absent ⇒ empty result set). */
let statsRowsByModel: Record<number, { total: number; avgLatencyMs: number; p50LatencyMs: number; p95LatencyMs: number; errCount: number }> = {};

let selects: SelectRecord[] = [];

function modelIdFromWhere(record: SelectRecord): number | undefined {
  const whereCall = record.calls.find((c) => c.method === "where");
  const cond = whereCall?.args[0] as Marker | undefined;
  const args = cond?.args ?? [];
  for (const a of args) {
    const m = a as Marker;
    // eq(inferenceResults.modelId, X) — the marker's args[1] is the literal modelId.
    if (m?.__op === "eq" && typeof m.args[1] === "number") return m.args[1] as number;
  }
  return undefined;
}

function makeDb() {
  return {
    select: vi.fn((shape: Record<string, unknown>) => {
      const record: SelectRecord = { shape, calls: [] };
      selects.push(record);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        then: (resolve: (v: unknown[]) => void) => {
          // aiModels query — shape has modelCode/status.
          if ("modelCode" in shape && "status" in shape) {
            resolve(modelRows);
            return;
          }
          // inferenceResults operational-stats query — shape has p50LatencyMs.
          if ("p50LatencyMs" in shape) {
            const modelId = modelIdFromWhere(record);
            const row = modelId != null ? statsRowsByModel[modelId] : undefined;
            resolve(row ? [row] : []);
            return;
          }
          resolve([]);
        },
      };
      for (const m of ["from", "innerJoin", "leftJoin", "where", "groupBy", "orderBy", "limit"]) {
        chain[m] = vi.fn((...args: unknown[]) => {
          record.calls.push({ method: m, args });
          return chain;
        });
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

const mockCheckConfidenceDrift = vi.fn();
vi.mock("./aiDriftMonitor", () => ({
  checkConfidenceDrift: (...a: unknown[]) => mockCheckConfidenceDrift(...a),
}));

import { generateModelPerformanceReport } from "./aiReportGenerator";

const period = { startDate: new Date("2026-07-01T00:00:00Z"), endDate: new Date("2026-07-02T00:00:00Z") };

/** Not-evaluated drift result — the default for every test unless overridden (monitor off / under-sampled). */
function notEvaluatedDrift(modelId: number) {
  return {
    enabled: false,
    modelId,
    evaluated: false,
    drift: false,
    severity: "NONE" as const,
    psi: 0,
    meanShift: 0,
    stdShift: 0,
    baseline: { count: 0, mean: 0, std: 0, histogram: [] },
    recent: { count: 0, mean: 0, std: 0, histogram: [] },
    reasons: ["AI_DRIFT_MONITOR_ENABLED is off — no-op"],
  };
}

beforeEach(() => {
  modelRows = [];
  statsRowsByModel = {};
  selects = [];
  mockGetDb.mockReset();
  mockGetDb.mockResolvedValue(makeDb());
  mockGenerateNarrative.mockClear();
  mockCheckConfidenceDrift.mockReset();
  mockCheckConfidenceDrift.mockImplementation(async (opts: { modelId: number }) => notEvaluatedDrift(opts.modelId));
});

describe("generateModelPerformanceReport — honest-empty survives (doc69 W0-5 item 2 / A4)", () => {
  it("no inference_results rows + drift not evaluated → dataAvailable:false, every metric null (NOT fabricated)", async () => {
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
      driftSeverity: null,
      totalPredictions: null,
      avgLatencyMs: null,
      p50LatencyMs: null,
      p95LatencyMs: null,
      errorRate: null,
    });
  });

  it("does NOT claim 'within acceptable ranges' when no real signal exists at all", async () => {
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

  it("multiple ACTIVE models, none with real signal → every one honest-empty", async () => {
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

describe("generateModelPerformanceReport — real signals (doc69 A4)", () => {
  it("real inference_results rows → dataAvailable:true with REAL latency/error/volume; accuracy STAYS null (no fabrication)", async () => {
    modelRows = [{ modelId: 1, modelCode: "aoi-defect-v3", modelVersion: "3", status: "ACTIVE" }];
    statsRowsByModel[1] = { total: 120, avgLatencyMs: 45, p50LatencyMs: 38, p95LatencyMs: 90, errCount: 4 };

    const report = await generateModelPerformanceReport({ ...period, reportType: "model_performance", language: "en" });

    expect(report.models[0]).toMatchObject({
      modelId: 1,
      dataAvailable: true,
      currentAccuracy: null, // still no real accuracy source — must not be fabricated
      accuracyTrend: null,
      totalPredictions: 120,
      avgLatencyMs: 45,
      p50LatencyMs: 38,
      p95LatencyMs: 90,
      errorRate: 4 / 120,
    });
  });

  it("zero inference_results rows for THIS model but drift evaluated → dataAvailable:true via drift alone, latency stays null", async () => {
    modelRows = [{ modelId: 1, modelCode: "m1", modelVersion: "1", status: "ACTIVE" }];
    mockCheckConfidenceDrift.mockResolvedValue({
      enabled: true,
      modelId: 1,
      evaluated: true,
      drift: false,
      severity: "NONE",
      psi: 0.03,
      meanShift: 0.01,
      stdShift: 0.01,
      baseline: { count: 80, mean: 0.9, std: 0.05, histogram: [] },
      recent: { count: 80, mean: 0.89, std: 0.05, histogram: [] },
      reasons: [],
    });

    const report = await generateModelPerformanceReport({ ...period, reportType: "model_performance", language: "en" });

    expect(report.models[0]).toMatchObject({
      dataAvailable: true,
      driftDetected: false,
      driftSeverity: "NONE",
      totalPredictions: null,
      avgLatencyMs: null,
    });
  });

  it("drift evaluated + real drift found → driftDetected:true, driftSeverity real, retrain recommendation mentions drift", async () => {
    modelRows = [{ modelId: 1, modelCode: "aoi-defect-v3", modelVersion: "3", status: "ACTIVE" }];
    statsRowsByModel[1] = { total: 50, avgLatencyMs: 20, p50LatencyMs: 18, p95LatencyMs: 40, errCount: 0 };
    mockCheckConfidenceDrift.mockResolvedValue({
      enabled: true,
      modelId: 1,
      evaluated: true,
      drift: true,
      severity: "HIGH",
      psi: 0.4,
      meanShift: 0.2,
      stdShift: 0.1,
      baseline: { count: 80, mean: 0.9, std: 0.05, histogram: [] },
      recent: { count: 80, mean: 0.6, std: 0.1, histogram: [] },
      reasons: ["confidence PSI 0.400 > 0.25"],
    });

    const report = await generateModelPerformanceReport({ ...period, reportType: "model_performance", language: "en" });

    expect(report.models[0].driftDetected).toBe(true);
    expect(report.models[0].driftSeverity).toBe("HIGH");
    expect(report.retrainRecommendations.some((r) => /drift/i.test(r))).toBe(true);
  });

  it("drift NOT evaluated (monitor off / under-sampled) → driftDetected is null, NEVER false (must not read as 'checked, no drift')", async () => {
    modelRows = [{ modelId: 1, modelCode: "aoi-defect-v3", modelVersion: "3", status: "ACTIVE" }];
    statsRowsByModel[1] = { total: 50, avgLatencyMs: 20, p50LatencyMs: 18, p95LatencyMs: 40, errCount: 0 };
    // default mock already returns evaluated:false

    const report = await generateModelPerformanceReport({ ...period, reportType: "model_performance", language: "en" });

    expect(report.models[0].driftDetected).toBeNull();
    expect(report.models[0].driftSeverity).toBeNull();
    // dataAvailable is still true — latency/error/volume ARE real even though drift wasn't checked.
    expect(report.models[0].dataAvailable).toBe(true);
  });

  it("high error rate over a real sample → adds an error-rate retrain recommendation (new doc69 A4 signal)", async () => {
    modelRows = [{ modelId: 1, modelCode: "aoi-defect-v3", modelVersion: "3", status: "ACTIVE" }];
    statsRowsByModel[1] = { total: 40, avgLatencyMs: 30, p50LatencyMs: 28, p95LatencyMs: 60, errCount: 10 }; // 25% errors

    const report = await generateModelPerformanceReport({ ...period, reportType: "model_performance", language: "en" });

    expect(report.models[0].errorRate).toBeCloseTo(0.25, 5);
    expect(report.retrainRecommendations.some((r) => /error rate/i.test(r))).toBe(true);
  });

  it("tiny sample (below MIN_SAMPLES_FOR_ERROR_ALERT) with a high error rate does NOT trigger the error-rate recommendation (avoid noise)", async () => {
    modelRows = [{ modelId: 1, modelCode: "aoi-defect-v3", modelVersion: "3", status: "ACTIVE" }];
    statsRowsByModel[1] = { total: 2, avgLatencyMs: 30, p50LatencyMs: 28, p95LatencyMs: 60, errCount: 2 }; // 100% but n=2

    const report = await generateModelPerformanceReport({ ...period, reportType: "model_performance", language: "en" });

    expect(report.retrainRecommendations.some((r) => /error rate/i.test(r))).toBe(false);
  });

  it("calls checkConfidenceDrift with emitAlert:false — report generation must not write drift-alert rows as a side effect", async () => {
    modelRows = [{ modelId: 1, modelCode: "m1", modelVersion: "1", status: "ACTIVE" }];

    await generateModelPerformanceReport({ ...period, reportType: "model_performance", language: "en" });

    expect(mockCheckConfidenceDrift).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 1, modelVersion: "1", emitAlert: false }),
    );
  });

  it("mixed fleet: one model with real data, one fully honest-empty — independent per model", async () => {
    modelRows = [
      { modelId: 1, modelCode: "healthy-model", modelVersion: "1", status: "ACTIVE" },
      { modelId: 2, modelCode: "silent-model", modelVersion: "1", status: "ACTIVE" },
    ];
    statsRowsByModel[1] = { total: 200, avgLatencyMs: 15, p50LatencyMs: 12, p95LatencyMs: 30, errCount: 1 };
    // model 2 has no inference_results rows and drift stays not-evaluated (default mock).

    const report = await generateModelPerformanceReport({ ...period, reportType: "model_performance", language: "en" });

    const m1 = report.models.find((m) => m.modelId === 1)!;
    const m2 = report.models.find((m) => m.modelId === 2)!;
    expect(m1.dataAvailable).toBe(true);
    expect(m1.totalPredictions).toBe(200);
    expect(m2.dataAvailable).toBe(false);
    expect(m2.totalPredictions).toBeNull();
  });
});

/**
 * Review-found gap (same PR as A4, doc69/T5 parity): `generateOfflineNarrative`'s
 * model-performance branch computed `driftCount` and, when it was 0, always printed
 * "All models performing within acceptable ranges" — WITHOUT checking whether any
 * model actually had `dataAvailable:true`. So when every model was honest-empty,
 * the offline-template narrative read self-contradictorily: "...All models
 * performing within acceptable ranges. Recommendation: Model performance metrics
 * unavailable for this period — no real inference activity recorded yet."
 *
 * T5 already guarded the sibling `retrainRecommendations` offline fallback (~:665)
 * with an `allUnavailable` check; these tests prove `generateOfflineNarrative`
 * mirrors that guard. The offline template is reached by making the mocked
 * aiProviderRouter `generateNarrative` reject, which drives the real
 * `generateNarrative` wrapper in aiReportGenerator.ts to its offline-template
 * last resort (see `report.narrativeMetadata.generatedBy === "offline"`).
 */
describe("generateModelPerformanceReport — offline narrative honesty (doc69/T5 parity, review fix)", () => {
  it("offline fallback + every model honest-empty → narrative must NOT claim 'within acceptable ranges'; must say unavailable instead", async () => {
    modelRows = [{ modelId: 1, modelCode: "m1", modelVersion: "1", status: "ACTIVE" }];
    mockGenerateNarrative.mockRejectedValueOnce(new Error("router unavailable"));

    const report = await generateModelPerformanceReport({ ...period, reportType: "model_performance", language: "en" });

    expect(report.narrativeMetadata?.generatedBy).toBe("offline");
    expect(report.narrative).not.toMatch(/within acceptable ranges/i);
    expect(report.narrative).not.toMatch(/within range/i);
    expect(report.narrative).toMatch(/unavailable/i);
  });

  it("offline fallback + vi language + every model honest-empty → localized text, no fabricated health claim", async () => {
    modelRows = [{ modelId: 1, modelCode: "m1", modelVersion: "1", status: "ACTIVE" }];
    mockGenerateNarrative.mockRejectedValueOnce(new Error("router unavailable"));

    const report = await generateModelPerformanceReport({ ...period, reportType: "model_performance", language: "vi" });

    expect(report.narrativeMetadata?.generatedBy).toBe("offline");
    expect(report.narrative).not.toMatch(/ngưỡng cho phép/);
    expect(report.narrative).toContain("chưa khả dụng");
  });

  it("offline fallback + multiple models all honest-empty → narrative still must not fabricate health", async () => {
    modelRows = [
      { modelId: 1, modelCode: "m1", modelVersion: "1", status: "ACTIVE" },
      { modelId: 2, modelCode: "m2", modelVersion: "2", status: "ACTIVE" },
    ];
    mockGenerateNarrative.mockRejectedValueOnce(new Error("router unavailable"));

    const report = await generateModelPerformanceReport({ ...period, reportType: "model_performance", language: "en" });

    expect(report.narrative).not.toMatch(/within acceptable ranges/i);
    expect(report.narrative).toMatch(/unavailable/i);
  });

  it("offline fallback + at least one model has REAL data and no drift → narrative still reports health normally (not weakened)", async () => {
    modelRows = [{ modelId: 1, modelCode: "aoi-defect-v3", modelVersion: "3", status: "ACTIVE" }];
    statsRowsByModel[1] = { total: 120, avgLatencyMs: 45, p50LatencyMs: 38, p95LatencyMs: 90, errCount: 0 };
    mockGenerateNarrative.mockRejectedValueOnce(new Error("router unavailable"));

    const report = await generateModelPerformanceReport({ ...period, reportType: "model_performance", language: "en" });

    expect(report.narrativeMetadata?.generatedBy).toBe("offline");
    expect(report.narrative).toMatch(/within acceptable ranges/i);
  });

  it("offline fallback + mixed fleet (one real, one honest-empty), no drift → narrative still reports health normally (driftCount 0, not allUnavailable)", async () => {
    modelRows = [
      { modelId: 1, modelCode: "healthy-model", modelVersion: "1", status: "ACTIVE" },
      { modelId: 2, modelCode: "silent-model", modelVersion: "1", status: "ACTIVE" },
    ];
    statsRowsByModel[1] = { total: 200, avgLatencyMs: 15, p50LatencyMs: 12, p95LatencyMs: 30, errCount: 0 };
    mockGenerateNarrative.mockRejectedValueOnce(new Error("router unavailable"));

    const report = await generateModelPerformanceReport({ ...period, reportType: "model_performance", language: "en" });

    expect(report.narrative).toMatch(/within acceptable ranges/i);
  });

  it("offline fallback + drift found on a real model → narrative reports drift count, not the acceptable-ranges/unavailable clause", async () => {
    modelRows = [{ modelId: 1, modelCode: "aoi-defect-v3", modelVersion: "3", status: "ACTIVE" }];
    statsRowsByModel[1] = { total: 50, avgLatencyMs: 20, p50LatencyMs: 18, p95LatencyMs: 40, errCount: 0 };
    mockCheckConfidenceDrift.mockResolvedValue({
      enabled: true,
      modelId: 1,
      evaluated: true,
      drift: true,
      severity: "HIGH",
      psi: 0.4,
      meanShift: 0.2,
      stdShift: 0.1,
      baseline: { count: 80, mean: 0.9, std: 0.05, histogram: [] },
      recent: { count: 80, mean: 0.6, std: 0.1, histogram: [] },
      reasons: ["confidence PSI 0.400 > 0.25"],
    });
    mockGenerateNarrative.mockRejectedValueOnce(new Error("router unavailable"));

    const report = await generateModelPerformanceReport({ ...period, reportType: "model_performance", language: "en" });

    expect(report.narrative).toMatch(/1 model\(s\) show accuracy drift/i);
    expect(report.narrative).not.toMatch(/within acceptable ranges/i);
    expect(report.narrative).not.toMatch(/unavailable/i);
  });
});
