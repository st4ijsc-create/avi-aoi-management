/**
 * WS-4 — Unit tests for predictiveMaintenanceService.
 *
 * computeReliabilityStats is exercised against a mocked DB (MTBF/MTTR formula).
 * computeFailureRiskFromInputs is pure — declining series -> higher risk with a
 * bounded timeframe; stable series -> low risk and no alert.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB + oeeService so computeReliabilityStats runs without Postgres.
const downtimeRows: any[] = [];
let stateDurations: any = { PT: 0, SB: 0, ET: 0, SD: 0, UD: 0, NS: 0, totalWindow: 0, equipmentUptime: 0, operationsTime: 0 };

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          // computeReliabilityStats only needs the downtime event rows here.
          orderBy: () => Promise.resolve(downtimeRows),
          then: (res: any) => res(downtimeRows),
        }),
      }),
    }),
  })),
}));

vi.mock("./oeeService", () => ({
  computeStateDurations: vi.fn(async () => stateDurations),
}));

vi.mock("../db/machine", () => ({
  recordMachineHealthSnapshot: vi.fn(async () => 1),
}));

import {
  computeReliabilityStats,
  computeFailureRiskFromInputs,
  initSuppressionTally,
  type RiskInputs,
} from "./predictiveMaintenanceService";
import type { TimeSeriesPoint, MultivariatePoint } from "./aiTimeSeriesEngine";

beforeEach(() => {
  downtimeRows.length = 0;
});

describe("computeReliabilityStats — MTBF / MTTR", () => {
  it("matches hand calculation: MTBF = uptime/#UD, MTTR = UD minutes/#UD", async () => {
    // 3 unplanned events; UD minutes = 90; equipment uptime = 1800 min (30h).
    const now = Date.now();
    downtimeRows.push(
      { category: "unplanned", startTime: new Date(now - 20 * 3600_000), endTime: new Date(now - 19.5 * 3600_000), duration: 30 },
      { category: "breakdown", startTime: new Date(now - 10 * 3600_000), endTime: new Date(now - 9.5 * 3600_000), duration: 30 },
      { category: "failure", startTime: new Date(now - 2 * 3600_000), endTime: new Date(now - 1.5 * 3600_000), duration: 30 },
      { category: "planned", startTime: new Date(now - 5 * 3600_000), endTime: new Date(now - 4.5 * 3600_000), duration: 30 }, // not UD
    );
    stateDurations = {
      PT: 1700, SB: 10, ET: 0, SD: 30, UD: 90, NS: 0,
      totalWindow: 1820, equipmentUptime: 1800, operationsTime: 1700,
    };

    const stats = await computeReliabilityStats(1, 24 * 30);

    expect(stats.unplannedEvents).toBe(3); // planned excluded
    expect(stats.totalUnplannedMinutes).toBe(90);
    // MTBF = 1800 min / 3 / 60 = 10h ; MTTR = 90 / 3 / 60 = 0.5h
    expect(stats.mtbfHours).toBeCloseTo(10, 5);
    expect(stats.mttrHours).toBeCloseTo(0.5, 5);
  });

  it("returns null MTBF/MTTR when there are no unplanned events (cold start)", async () => {
    stateDurations = { PT: 100, SB: 0, ET: 0, SD: 0, UD: 0, NS: 0, totalWindow: 100, equipmentUptime: 100, operationsTime: 100 };
    const stats = await computeReliabilityStats(1, 24);
    expect(stats.unplannedEvents).toBe(0);
    expect(stats.mtbfHours).toBeNull();
    expect(stats.mttrHours).toBeNull();
  });
});

// ── Helpers to build synthetic series ────────────────────────────────────────

function series(values: number[], stepMs = 3600_000): TimeSeriesPoint[] {
  const start = Date.now() - values.length * stepMs;
  return values.map((v, i) => ({ timestamp: start + i * stepMs, value: v }));
}

function heartbeats(n: number, anomalyEvery = 0): MultivariatePoint[] {
  const start = Date.now() - n * 3600_000;
  const pts: MultivariatePoint[] = [];
  for (let i = 0; i < n; i++) {
    const spike = anomalyEvery > 0 && i % anomalyEvery === 0;
    pts.push({
      timestamp: start + i * 3600_000,
      values: {
        cpu: spike ? 99 : 30 + (i % 3),
        mem: spike ? 98 : 40 + (i % 2),
        disk: spike ? 95 : 50,
        temp: spike ? 90 : 45 + (i % 2),
      },
    });
  }
  return pts;
}

describe("computeFailureRiskFromInputs", () => {
  it("declining health series -> elevated risk, bounded timeframe, confidence in [0,100]", () => {
    const declining = series([95, 88, 80, 70, 58, 48, 42, 38, 34, 30]); // clear downward
    const inputs: RiskInputs = {
      machineId: 1,
      reliability: {
        machineId: 1, windowHours: 24 * 14, unplannedEvents: 5, totalUnplannedMinutes: 150,
        uptimeMinutes: 6000, mtbfHours: 20, mttrHours: 0.5, failuresPerDay: 0.4, trend: "increasing",
      },
      healthSeries: declining,
      heartbeatSeries: heartbeats(24, 4), // ~25% anomalous
      tempSeries: series([45, 45, 46, 45, 60, 62, 63, 64, 65, 66, 67, 68]), // upward shift
      uptimeSinceLastHours: 18,
    };

    const r = computeFailureRiskFromInputs(inputs);

    expect(r.failureRisk).toBeGreaterThan(40);
    expect(r.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(r.confidenceScore).toBeLessThanOrEqual(100);
    expect(r.predictedTimeframeHours).not.toBeNull();
    expect(r.predictedTimeframeHours!).toBeLessThanOrEqual(20); // capped by MTBF
    expect(r.factors.length).toBeGreaterThan(0);
  });

  it("stable healthy series -> low risk (below alert threshold 60)", () => {
    const stable = series([92, 91, 92, 93, 92, 91, 92, 93, 92, 91]);
    const inputs: RiskInputs = {
      machineId: 2,
      reliability: {
        machineId: 2, windowHours: 24 * 14, unplannedEvents: 0, totalUnplannedMinutes: 0,
        uptimeMinutes: 8000, mtbfHours: null, mttrHours: null, failuresPerDay: 0, trend: "stable",
      },
      healthSeries: stable,
      heartbeatSeries: heartbeats(24, 0), // no anomalies
      tempSeries: series([45, 45, 46, 45, 45, 46, 45, 45, 46, 45, 45, 46]), // stable temp
      uptimeSinceLastHours: 50,
    };

    const r = computeFailureRiskFromInputs(inputs);
    expect(r.failureRisk).toBeLessThan(60);
    expect(r.maintenanceUrgency === "LOW" || r.maintenanceUrgency === "MEDIUM").toBe(true);
  });

  it("clamps risk + confidence to [0,100] even with extreme inputs", () => {
    const crash = series([100, 5, 100, 0, 100, 0, 100, 0, 100, 0]);
    const r = computeFailureRiskFromInputs({
      machineId: 3,
      reliability: {
        machineId: 3, windowHours: 24, unplannedEvents: 50, totalUnplannedMinutes: 5000,
        uptimeMinutes: 100, mtbfHours: 0.1, mttrHours: 2, failuresPerDay: 50, trend: "increasing",
      },
      healthSeries: crash,
      heartbeatSeries: heartbeats(40, 2),
      tempSeries: series([10, 90, 10, 90, 10, 90, 10, 90, 10, 90, 10, 90]),
      uptimeSinceLastHours: 100,
    });
    expect(r.failureRisk).toBeGreaterThanOrEqual(0);
    expect(r.failureRisk).toBeLessThanOrEqual(100);
    expect(r.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(r.confidenceScore).toBeLessThanOrEqual(100);
  });
});

describe("initSuppressionTally — vòng sửa cuối (review toàn nhánh, mục 4)", () => {
  it("khởi tạo đủ 4 nhãn = 0, KHÔNG object rỗng — nhãn đúng-0 phải HIỆN trong JSON.stringify", () => {
    const tally = initSuppressionTally();
    expect(tally).toEqual({ emit: 0, "low-risk": 0, "low-confidence": 0, "out-of-timeframe": 0 });
    // Chứng minh trực tiếp lỗi mà mục 4 mô tả: object rỗng bị JSON.stringify bỏ hẳn
    // key có đếm=0 (JS không lặp key không tồn tại); object đủ-key thì không.
    const asLogged = JSON.parse(JSON.stringify(tally));
    for (const label of ["emit", "low-risk", "low-confidence", "out-of-timeframe"]) {
      expect(asLogged).toHaveProperty(label, 0);
    }
  });

  it("chỉ tăng 1 nhãn vẫn giữ 3 nhãn kia = 0 và HIỆN trong log — không im lặng biến mất", () => {
    const tally = initSuppressionTally();
    tally["low-risk"] += 3;
    const logged = `[PredictiveMaintenance] ứng viên theo kết cục: ${JSON.stringify(tally)}`;
    expect(logged).toContain('"emit":0');
    expect(logged).toContain('"low-risk":3');
    expect(logged).toContain('"low-confidence":0');
    expect(logged).toContain('"out-of-timeframe":0');
  });
});
