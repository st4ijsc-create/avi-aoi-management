/**
 * Phase B4 — unit tests for the Management/Analytics READ tools.
 *
 * Strategy (mirrors handlersF6.test.ts): mock getDb, checkPermission, and the
 * underlying analytics service functions so each tool's RBAC gate, zod param
 * validation, structured shape, and read-only safety contract are exercised
 * WITHOUT a real Postgres.
 *
 * Asserts per tool:
 *   - RBAC-gated: denied role (checkPermission=false) OR missing __authCtx →
 *     no data (note PERMISSION_DENIED), and the backing service is NOT called.
 *   - params validated by zod (strict schema, bad args rejected).
 *   - returns the documented structured shape on the allow path.
 *   - read-only: kind 'read', no preview/execute, has a handler, declares
 *     requiredPermission (analytics_* module).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock getDb (a truthy opaque db; service fns are mocked separately) ──
const getDbMock = vi.fn();
vi.mock("../../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...a) }));

// ── mock RBAC ──
const checkPermissionMock = vi.fn();
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
}));

// ── mock analytics services ──
const paretoByDefectType = vi.fn();
const paretoByMachine = vi.fn();
vi.mock("../paretoAnalysisService", () => ({
  paretoByDefectType: (...a: unknown[]) => paretoByDefectType(...a),
  paretoByMachine: (...a: unknown[]) => paretoByMachine(...a),
}));

const getYieldTrendData = vi.fn();
const getTopNGMeasurementPointsEnhanced = vi.fn();
vi.mock("../../db/statistics", () => ({
  getYieldTrendData: (...a: unknown[]) => getYieldTrendData(...a),
  getTopNGMeasurementPointsEnhanced: (...a: unknown[]) => getTopNGMeasurementPointsEnhanced(...a),
}));

const computeFailureRisk = vi.fn();
vi.mock("../predictiveMaintenanceService", () => ({
  computeFailureRisk: (...a: unknown[]) => computeFailureRisk(...a),
}));

const resolveLineIdByCode = vi.fn();
vi.mock("../../db/lineBalance", () => ({
  resolveLineIdByCode: (...a: unknown[]) => resolveLineIdByCode(...a),
}));

// Schema tables → opaque sentinels (Drizzle calls go through the fake db below).
vi.mock("../../../drizzle/schema", () => ({
  machines: { code: { __c: "code" }, id: { __c: "id" } },
  oeeMetrics: {
    timestamp: { __c: "timestamp" },
    machineCode: { __c: "machineCode" },
    availability: {},
    performance: {},
    quality: {},
    oee: {},
  },
}));

// aiTimeSeriesEngine is pure math — use the REAL module (no DB), so forecast/
// trend interpretation is genuinely exercised.

import {
  analyticsQueryOee,
  analyticsDefectPareto,
  analyticsDefectHeatmapSummary,
  analyticsQueryYield,
  analyticsSpcStatus,
  analyticsPdmForecast,
  analyticsForecastSeries,
} from "./analyticsTools";

const ALL_TOOLS = [
  analyticsQueryOee,
  analyticsDefectPareto,
  analyticsDefectHeatmapSummary,
  analyticsQueryYield,
  analyticsSpcStatus,
  analyticsPdmForecast,
  analyticsForecastSeries,
];

const AUTH = { userId: 42, role: "manager" } as const;

/** Chainable fake db. OEE select(...).from(...).where(...) resolves to `oeeRows`;
 *  machine resolution select(...).from(...).where(...).limit() → `machineRows`. */
function fakeDb(opts: { oeeRows?: any[]; machineRows?: any[] } = {}) {
  const oeeRows = opts.oeeRows ?? [];
  const machineRows = opts.machineRows ?? [];
  return {
    select: () => ({
      from: () => ({
        where: (..._a: unknown[]) => {
          // Two shapes: OEE agg query (awaited directly) and machine lookup (.limit()).
          const thenable: any = Promise.resolve(oeeRows);
          thenable.limit = async () => machineRows;
          return thenable;
        },
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getDbMock.mockResolvedValue(fakeDb());
  checkPermissionMock.mockResolvedValue(true); // allow by default; deny tests override
});

// ─────────────────────────────────────────────────────────────────────────────
describe("analytics tools — READ-ONLY + RBAC safety contract", () => {
  it("every tool is a read tool with a requiredPermission and no write surface", () => {
    for (const t of ALL_TOOLS) {
      expect(t.kind).toBe("read");
      expect(t.preview).toBeUndefined();
      expect(t.execute).toBeUndefined();
      expect(typeof t.handler).toBe("function");
      expect(t.requiredPermission).toBeDefined();
      expect(t.requiredPermission!.module.startsWith("analytics_")).toBe(true);
      expect(t.requiredPermission!.action).toBe("canView");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("RBAC gating", () => {
  it("denies (no data) when __authCtx is missing — fail-safe, service not called", async () => {
    const r = await analyticsDefectPareto.handler!({ groupBy: "defectType", days: 7, topN: 5 } as any);
    expect(r.note).toBe("PERMISSION_DENIED");
    expect(r.data).toBeNull();
    expect(paretoByDefectType).not.toHaveBeenCalled();
    expect(checkPermissionMock).not.toHaveBeenCalled(); // missing ctx short-circuits before lookup
  });

  it("denies (no data) when checkPermission returns false — service not called", async () => {
    checkPermissionMock.mockResolvedValue(false);
    const r = await analyticsDefectPareto.handler!({
      groupBy: "defectType", days: 7, topN: 5, __authCtx: AUTH,
    } as any);
    expect(r.note).toBe("PERMISSION_DENIED");
    expect(r.data).toBeNull();
    expect(checkPermissionMock).toHaveBeenCalledWith(AUTH.userId, AUTH.role, "analytics_root_cause", "canView");
    expect(paretoByDefectType).not.toHaveBeenCalled();
  });

  it("localizes the denial message (en)", async () => {
    const r = await analyticsQueryOee.handler!({ period: "week", __authCtx: undefined, lang: "en" } as any);
    expect(r.note).toBe("PERMISSION_DENIED");
    expect(r.textSummary).toContain("permission");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("param validation (zod strict)", () => {
  it("rejects unknown keys / bad enum on each tool's schema", () => {
    expect(analyticsDefectPareto.parameters.safeParse({ groupBy: "WRONG" }).success).toBe(false);
    expect(analyticsQueryOee.parameters.safeParse({ period: "year" }).success).toBe(false);
    expect(analyticsForecastSeries.parameters.safeParse({ metric: "voltage" }).success).toBe(false);
    expect(analyticsPdmForecast.parameters.safeParse({}).success).toBe(false); // needs machineId|machineCode
    // valid:
    expect(analyticsQueryOee.parameters.safeParse({ period: "month", __authCtx: AUTH }).success).toBe(true);
    expect(analyticsPdmForecast.parameters.safeParse({ machineCode: "M-1", __authCtx: AUTH }).success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("analytics_query_oee", () => {
  it("computes avg OEE + period compare from seeded oee_metrics rows", async () => {
    // current period rows then previous period rows — return same set both calls.
    getDbMock.mockResolvedValue(
      fakeDb({ oeeRows: [{ availability: 9000, performance: 8000, quality: 9500, oee: 6840 }] }),
    );
    const r = await analyticsQueryOee.handler!({ period: "week", compareToPrior: true, __authCtx: AUTH } as any);
    expect(r.type).toBe("analytics_oee");
    expect(r.data).not.toBeNull();
    // 6840 / 100 = 68.4
    expect(r.data!.current.avgOee).toBe(68.4);
    expect(r.data!.current.avgA).toBe(90);
    expect(r.data!.previous).not.toBeNull();
    expect(r.data!.deltaPct).toBe(0); // same rows → no change
    expect(r.textSummary).toContain("OEE");
  });

  it("returns NOT_FOUND when no OEE rows in the period", async () => {
    getDbMock.mockResolvedValue(fakeDb({ oeeRows: [] }));
    const r = await analyticsQueryOee.handler!({ period: "week", __authCtx: AUTH } as any);
    expect(r.note).toBe("NOT_FOUND");
  });

  it("returns DB_UNAVAILABLE when getDb is null", async () => {
    getDbMock.mockResolvedValue(null);
    const r = await analyticsQueryOee.handler!({ period: "week", __authCtx: AUTH } as any);
    expect(r.note).toBe("DB_UNAVAILABLE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("analytics_defect_pareto", () => {
  it("returns top-N structured Pareto from the service", async () => {
    paretoByDefectType.mockResolvedValue({
      items: [
        { category: "Solder", count: 60, percentage: 60, cumulativePercentage: 60 },
        { category: "Misalign", count: 25, percentage: 25, cumulativePercentage: 85 },
      ],
      totalDefects: 100,
      pareto80Count: 2,
      pareto80Categories: ["Solder", "Misalign"],
      analysisType: "defect_type",
      dateRange: { start: new Date(), end: new Date() },
    });
    const r = await analyticsDefectPareto.handler!({ groupBy: "defectType", days: 7, topN: 5, __authCtx: AUTH } as any);
    expect(r.type).toBe("analytics_pareto");
    expect(r.data!.totalDefects).toBe(100);
    expect(r.data!.topN).toHaveLength(2);
    expect(r.data!.topN[0].category).toBe("Solder");
    expect(r.textSummary).toContain("Solder");
  });

  it("routes groupBy=machine to paretoByMachine", async () => {
    paretoByMachine.mockResolvedValue({
      items: [{ category: "M-01", count: 10, percentage: 100, cumulativePercentage: 100 }],
      totalDefects: 10, pareto80Count: 1, pareto80Categories: ["M-01"],
      analysisType: "machine", dateRange: { start: new Date(), end: new Date() },
    });
    const r = await analyticsDefectPareto.handler!({ groupBy: "machine", days: 7, topN: 5, __authCtx: AUTH } as any);
    expect(paretoByMachine).toHaveBeenCalled();
    expect(paretoByDefectType).not.toHaveBeenCalled();
    expect(r.data!.groupBy).toBe("machine");
  });

  it("fails safe (QUERY_ERROR, no throw) when the service throws", async () => {
    paretoByDefectType.mockRejectedValue(new Error("boom"));
    const r = await analyticsDefectPareto.handler!({ groupBy: "defectType", days: 7, topN: 5, __authCtx: AUTH } as any);
    expect(r.note).toBe("QUERY_ERROR");
    expect(r.data!.topN).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("analytics_defect_heatmap_summary", () => {
  it("summarizes hotspot points with percentages", async () => {
    getTopNGMeasurementPointsEnhanced.mockResolvedValue([
      { pointCode: "P1", pointName: "Pad1", ngCount: 30, ngRate: "12.50" },
      { pointCode: "P2", pointName: "Pad2", ngCount: 10, ngRate: "4.00" },
    ]);
    const r = await analyticsDefectHeatmapSummary.handler!({ days: 7, topN: 5, __authCtx: AUTH } as any);
    expect(r.type).toBe("analytics_heatmap");
    expect(r.data!.totalNG).toBe(40);
    expect(r.data!.hotspots[0].percentage).toBe(75); // 30/40
    expect(r.textSummary).toContain("Pad1");
  });

  it("NOT_FOUND when no NG", async () => {
    getTopNGMeasurementPointsEnhanced.mockResolvedValue([]);
    const r = await analyticsDefectHeatmapSummary.handler!({ days: 7, topN: 5, __authCtx: AUTH } as any);
    expect(r.note).toBe("NOT_FOUND");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("analytics_query_yield", () => {
  it("computes avg yield + declining trend from a falling series", async () => {
    getYieldTrendData.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({
        timeInterval: new Date(Date.now() - (6 - i) * 86400_000),
        totalCount: 100,
        okCount: 95 - i * 3,
        ngCount: 5 + i * 3,
        ntfCount: 0,
        yieldRate: 95 - i * 3,
        ngRate: 5 + i * 3,
      })),
    );
    const r = await analyticsQueryYield.handler!({ days: 14, interval: "day", __authCtx: AUTH } as any);
    expect(r.type).toBe("analytics_yield");
    expect(r.data!.points).toBe(6);
    expect(r.data!.trend).toBe("declining");
    expect(r.data!.series).toHaveLength(6);
  });

  it("NOT_FOUND when no trend data", async () => {
    getYieldTrendData.mockResolvedValue([]);
    const r = await analyticsQueryYield.handler!({ days: 14, interval: "day", __authCtx: AUTH } as any);
    expect(r.note).toBe("NOT_FOUND");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("analytics_spc_status", () => {
  it("flags out-of-control points beyond ±kσ", async () => {
    // Mostly ~95 with one wild outlier → should breach control limits.
    const base = Array.from({ length: 9 }, () => ({
      timeInterval: new Date(), totalCount: 100, okCount: 95, ngCount: 5, ntfCount: 0, yieldRate: 95, ngRate: 5,
    }));
    base.push({ timeInterval: new Date(), totalCount: 100, okCount: 40, ngCount: 60, ntfCount: 0, yieldRate: 40, ngRate: 60 } as any);
    getYieldTrendData.mockResolvedValue(base);
    const r = await analyticsSpcStatus.handler!({ days: 14, sigma: 2, __authCtx: AUTH } as any);
    expect(r.type).toBe("analytics_spc");
    expect(r.data!.anomalyCount).toBeGreaterThanOrEqual(1);
    expect(r.textSummary).toContain("VƯỢT KIỂM SOÁT");
  });

  it("NOT_FOUND with fewer than 3 points", async () => {
    getYieldTrendData.mockResolvedValue([
      { timeInterval: new Date(), totalCount: 1, okCount: 1, ngCount: 0, ntfCount: 0, yieldRate: 100, ngRate: 0 },
    ]);
    const r = await analyticsSpcStatus.handler!({ days: 14, sigma: 3, __authCtx: AUTH } as any);
    expect(r.note).toBe("NOT_FOUND");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("analytics_pdm_forecast", () => {
  it("returns risk + interpretation context and a threshold breach flag", async () => {
    getDbMock.mockResolvedValue(fakeDb({ machineRows: [{ id: 7 }] }));
    computeFailureRisk.mockResolvedValue({
      machineId: 7,
      failureRisk: 72,
      confidenceScore: 65,
      predictedTimeframe: "within 18 hours",
      predictedTimeframeHours: 18,
      recommendedMaintenanceDate: new Date(),
      maintenanceUrgency: "HIGH",
      factors: [
        { name: "reliability", contribution: 80, description: "overdue" },
        { name: "trend", contribution: 40, description: "declining" },
      ],
      dataPoints: 50,
    });
    const r = await analyticsPdmForecast.handler!({ machineCode: "M-7", __authCtx: AUTH } as any);
    expect(r.type).toBe("analytics_pdm_forecast");
    expect(r.data!.failureRisk).toBe(72);
    expect(r.data!.thresholdBreach).toBe(true); // 72 >= default 60
    expect(r.data!.topFactors[0].name).toBe("reliability"); // sorted by contribution
    expect(computeFailureRisk).toHaveBeenCalledWith(7);
  });

  it("NOT_FOUND for an unknown machineCode", async () => {
    getDbMock.mockResolvedValue(fakeDb({ machineRows: [] }));
    const r = await analyticsPdmForecast.handler!({ machineCode: "NOPE", __authCtx: AUTH } as any);
    expect(r.note).toBe("NOT_FOUND");
    expect(computeFailureRisk).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("analytics_forecast_series", () => {
  it("forecasts yield with confidence interval + trend context", async () => {
    getYieldTrendData.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        timeInterval: new Date(), totalCount: 100, okCount: 90, ngCount: 10, ntfCount: 0,
        yieldRate: 90 - i, ngRate: 10 + i,
      })),
    );
    const r = await analyticsForecastSeries.handler!({
      metric: "yield", days: 30, horizon: 5, algorithm: "ewma", threshold: 85, __authCtx: AUTH,
    } as any);
    expect(r.type).toBe("analytics_forecast");
    expect(r.data!.forecast.length).toBe(5);
    expect(r.data!.forecast[0]).toHaveProperty("predicted");
    expect(r.data!.forecast[0]).toHaveProperty("lower");
    expect(r.data!.forecast[0]).toHaveProperty("upper");
    // declining series below threshold 85 → breach reported
    expect(r.data!.thresholdBreach).not.toBeNull();
    expect(r.data!.thresholdBreach!.threshold).toBe(85);
  });

  it("NOT_FOUND with fewer than 3 history points", async () => {
    getYieldTrendData.mockResolvedValue([
      { timeInterval: new Date(), totalCount: 1, okCount: 1, ngCount: 0, ntfCount: 0, yieldRate: 100, ngRate: 0 },
    ]);
    const r = await analyticsForecastSeries.handler!({ metric: "yield", days: 30, horizon: 5, __authCtx: AUTH } as any);
    expect(r.note).toBe("NOT_FOUND");
  });
});
