/**
 * Sprint F6 — handler unit tests for the line-monitoring READ tools.
 *
 * Strategy: mock the db/* helper modules (processResult / otTelemetry /
 * lineBalance) and getDb so the handler LOGIC + Vietnamese textSummary numbers
 * are exercised on seeded data without a real Postgres. Also asserts the
 * READ-ONLY safety contract (kind 'read', no preview/execute/permission) and
 * the noDbResult path when getDb() is null.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock getDb (machineCode resolution + direct queries) ──
const getDbMock = vi.fn();
vi.mock("../../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...a) }));

// ── mock the F6 db helpers ──
const aggregateProcessResultStats = vi.fn();
const listProcessResultsByMachine = vi.fn();
const getProcessMetricSeries = vi.fn();
vi.mock("../../db/processResult", () => ({
  aggregateProcessResultStats: (...a: unknown[]) => aggregateProcessResultStats(...a),
  listProcessResultsByMachine: (...a: unknown[]) => listProcessResultsByMachine(...a),
  getProcessMetricSeries: (...a: unknown[]) => getProcessMetricSeries(...a),
}));

const getLatestTelemetry = vi.fn();
const getTelemetrySeries = vi.fn();
vi.mock("../../db/otTelemetry", () => ({
  getLatestTelemetry: (...a: unknown[]) => getLatestTelemetry(...a),
  getTelemetrySeries: (...a: unknown[]) => getTelemetrySeries(...a),
}));

const getLatestLineBalance = vi.fn();
const getStationDwellAgg = vi.fn();
const resolveLineIdByCode = vi.fn();
vi.mock("../../db/lineBalance", () => ({
  getLatestLineBalance: (...a: unknown[]) => getLatestLineBalance(...a),
  getStationDwellAgg: (...a: unknown[]) => getStationDwellAgg(...a),
  resolveLineIdByCode: (...a: unknown[]) => resolveLineIdByCode(...a),
}));

// Schema tables → opaque sentinels (Drizzle calls go through the fake db below).
vi.mock("../../../drizzle/schema", () => ({
  machines: { code: { __c: "code" }, machineType: { __c: "machineType" }, id: { __c: "id" } },
  processResults: {},
}));

import {
  getMachineProcessResult,
  getProcessMetricTrend,
  getLineBalance,
  getPalletizerStatus,
  getOtTelemetryLatest,
} from "./handlersF6";

/** A chainable fake db whose terminal select returns `queue`-driven rows. */
function fakeDb(machineRows: any[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => machineRows,
          orderBy: () => ({ limit: async () => [] }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("F6 handlers — READ-ONLY safety contract", () => {
  const tools = [
    getMachineProcessResult,
    getProcessMetricTrend,
    getLineBalance,
    getPalletizerStatus,
    getOtTelemetryLatest,
  ];
  it("every F6 tool is a read tool with no write surface", () => {
    for (const t of tools) {
      expect(t.kind ?? "read").toBe("read");
      expect(t.preview).toBeUndefined();
      expect(t.execute).toBeUndefined();
      expect(t.requiredPermission).toBeUndefined();
      expect(typeof t.handler).toBe("function");
    }
  });
});

describe("get_machine_process_result", () => {
  it("returns noDbResult when getDb is null", async () => {
    getDbMock.mockResolvedValue(null);
    const r = await getMachineProcessResult.handler!({ machineCode: "SCR-01", days: 1, limit: 20 } as any);
    expect(r.note).toBe("DB_UNAVAILABLE");
    expect(r.data.summary.pass).toBe(0);
  });

  it("computes failRate + summary from seeded stats", async () => {
    getDbMock.mockResolvedValue(fakeDb([{ id: 5, machineType: "SCREWDRIVE" }]));
    listProcessResultsByMachine.mockResolvedValue([
      { serialNumber: "SN1", machineId: 5, stepType: "torque", result: "fail", measuredAt: new Date(), metrics: { torque: 12 } },
    ]);
    aggregateProcessResultStats.mockResolvedValue({ pass: 8, fail: 2, warn: 0, skip: 0 });
    const r = await getMachineProcessResult.handler!({ machineCode: "SCR-01", days: 1, limit: 20 } as any);
    expect(r.type).toBe("process_result");
    // failRate = 2 / (8+2+0) = 20%
    expect(r.data.summary.failRate).toBe(20);
    expect(r.textSummary).toContain("fail=2");
    expect(r.textSummary).toContain("20%");
  });

  it("returns NOT_FOUND for an unknown machineCode", async () => {
    getDbMock.mockResolvedValue(fakeDb([]));
    const r = await getMachineProcessResult.handler!({ machineCode: "NOPE-99", days: 1, limit: 20 } as any);
    expect(r.note).toBe("NOT_FOUND");
  });
});

describe("get_process_metric_trend", () => {
  it("detects an increasing trend + EWMA forecast from a rising series", async () => {
    getDbMock.mockResolvedValue(fakeDb([{ id: 5, machineType: "SCREWDRIVE" }]));
    const base = Date.now() - 10 * 3600_000;
    getProcessMetricSeries.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({ bucket: "", ts: base + i * 3600_000, value: 10 + i * 2, samples: 3 })),
    );
    const r = await getProcessMetricTrend.handler!({
      machineCode: "SCR-01", metricKey: "torque", stepType: "torque", source: "process", days: 7, bucket: "hour",
    } as any);
    expect(r.type).toBe("process_metric_trend");
    expect(r.data.trend).toBe("increasing");
    expect(r.data.forecastNext).not.toBeNull();
    expect(r.textSummary).toContain("TĂNG");
  });

  it("returns NOT_FOUND when fewer than 2 points", async () => {
    getDbMock.mockResolvedValue(fakeDb([{ id: 5, machineType: "SCREWDRIVE" }]));
    getProcessMetricSeries.mockResolvedValue([{ bucket: "", ts: Date.now(), value: 10, samples: 1 }]);
    const r = await getProcessMetricTrend.handler!({
      machineCode: "SCR-01", metricKey: "torque", source: "process", days: 7, bucket: "hour",
    } as any);
    expect(r.note).toBe("NOT_FOUND");
  });
});

describe("get_line_balance", () => {
  it("flags a takt breach and the top blocked station", async () => {
    getDbMock.mockResolvedValue(fakeDb([]));
    resolveLineIdByCode.mockResolvedValue(7);
    getLatestLineBalance.mockResolvedValue({
      periodStart: new Date().toISOString(),
      taktTimeMs: 1000,
      avgCycleTimeMs: 900,
      maxCycleTimeMs: 1500, // > takt → breach
      utilizationPct: 80,
      balanceRatePct: 75,
      throughputUnits: 100,
      wipCount: 12,
    });
    getStationDwellAgg.mockResolvedValue([
      { stationId: 3, avgDwellMs: 2000, avgStarvedMs: 100, avgBlockedMs: 800, samples: 5 },
      { stationId: 4, avgDwellMs: 1500, avgStarvedMs: 400, avgBlockedMs: 50, samples: 5 },
    ]);
    const r = await getLineBalance.handler!({ lineCode: "A", days: 1 } as any);
    expect(r.type).toBe("line_balance");
    expect(r.textSummary).toContain("CẢNH BÁO");
    expect(r.data!.topBlocked!.stationId).toBe(3);
    expect(r.data!.topStarved!.stationId).toBe(4);
  });

  it("returns NOT_FOUND for an unknown lineCode", async () => {
    getDbMock.mockResolvedValue(fakeDb([]));
    resolveLineIdByCode.mockResolvedValue(null);
    const r = await getLineBalance.handler!({ lineCode: "ZZZ", days: 1 } as any);
    expect(r.note).toBe("NOT_FOUND");
  });
});

describe("get_ot_telemetry_latest", () => {
  it("summarizes latest telemetry with units", async () => {
    getDbMock.mockResolvedValue(fakeDb([{ id: 9, machineType: "PALLETIZER" }]));
    getLatestTelemetry.mockResolvedValue([
      { tagKey: "temp", valueNumeric: 42.5, valueText: null, unit: "°C", quality: "good", timestamp: new Date().toISOString() },
    ]);
    const r = await getOtTelemetryLatest.handler!({ machineCode: "PLC-01", limit: 10 } as any);
    expect(r.type).toBe("ot_telemetry");
    expect(r.textSummary).toContain("temp=42.5");
  });
});
