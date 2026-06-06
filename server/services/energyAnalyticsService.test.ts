/**
 * Sprint G2.6a — energyAnalyticsService tests.
 * Mocks db/energy + db/timescale so no real DB/TSDB is touched.
 *
 * Asserts:
 *  - per-recipe LEAD()-window attribution (2 deploys on one machine at t0/t10,
 *    readings t0..t20 → A/B split correctly) + direct recipeRef path.
 *  - kwhPerUnit = null when goodUnits = 0.
 *  - peak demand MAX + peakAt + rolling 15-min.
 *  - forecast ≥3 points → series; <3 → available:false (no throw).
 *  - power factor: all NULL → available:false; mixed → avg over non-NULL only.
 *  - SAFETY: service source does NOT import commandDispatcher / writeTags;
 *    suggestDemandResponse returns text+i18n keys only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// ── db/energy mock ──────────────────────────────────────────────
const energyState = {
  readings: [] as any[],
  windows: [] as any[],
  goodUnits: [] as any[],
  peak: { instantaneousPeakKw: null as number | null, peakAt: null as Date | null },
  rollingBuckets: [] as any[],
  pf: { samples: 0, pfSamples: 0, avgPf: null as number | null, minPf: null as number | null, belowThreshold: 0 },
};
vi.mock("../db/energy", () => ({
  getEnergyReadings: vi.fn(async () => energyState.readings),
  getRecipeDeploymentWindows: vi.fn(async () => energyState.windows),
  getGoodUnitsByRecipe: vi.fn(async () => energyState.goodUnits),
  getPeakDemandRows: vi.fn(async () => energyState.peak),
  getRollingDemandBuckets: vi.fn(async () => energyState.rollingBuckets),
  getPowerFactorStats: vi.fn(async () => energyState.pf),
}));

// ── db/timescale mock (default disabled → main-PG path) ─────────
const tsdbState = { enabled: false, buckets: [] as any[] };
vi.mock("../db/timescale", () => ({
  isTsdbEnabled: vi.fn(() => tsdbState.enabled),
  queryEnergyBuckets: vi.fn(async () => tsdbState.buckets),
  insertEnergyReading: vi.fn(async () => false),
}));

import {
  computeRecipeEnergy,
  computePeakDemand,
  computePowerFactor,
  forecastEnergy,
  suggestDemandResponse,
} from "./energyAnalyticsService";

const T0 = new Date("2026-06-01T00:00:00.000Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

beforeEach(() => {
  energyState.readings = [];
  energyState.windows = [];
  energyState.goodUnits = [];
  energyState.peak = { instantaneousPeakKw: null, peakAt: null };
  energyState.rollingBuckets = [];
  energyState.pf = { samples: 0, pfSamples: 0, avgPf: null, minPf: null, belowThreshold: 0 };
  tsdbState.enabled = false;
  tsdbState.buckets = [];
});

describe("computeRecipeEnergy — LEAD() window attribution", () => {
  it("splits readings across two deployments on one machine", async () => {
    // Recipe A deployed at t0, recipe B at t10 → A covers [t0,t10), B covers [t10,∞).
    energyState.windows = [
      { recipeId: 1, machineId: 7, recipeCode: "RA", startAt: minutes(0), endAt: minutes(10) },
      { recipeId: 2, machineId: 7, recipeCode: "RB", startAt: minutes(10), endAt: null },
    ];
    energyState.readings = [
      { machineId: 7, value: 1, powerKw: 10, recipeRef: null, timestamp: minutes(0) },
      { machineId: 7, value: 1, powerKw: 12, recipeRef: null, timestamp: minutes(5) },
      { machineId: 7, value: 1, powerKw: 20, recipeRef: null, timestamp: minutes(10) },
      { machineId: 7, value: 1, powerKw: 22, recipeRef: null, timestamp: minutes(20) },
    ];
    energyState.goodUnits = [
      { recipeRef: "RA", machineId: 7, goodUnits: 2 },
      { recipeRef: "RB", machineId: 7, goodUnits: 4 },
    ];

    const rows = await computeRecipeEnergy({ from: minutes(0), to: minutes(30), machineId: 7 });
    const A = rows.find((r) => r.recipeCode === "RA")!;
    const B = rows.find((r) => r.recipeCode === "RB")!;
    expect(A.totalKwh).toBe(2); // t0 + t5
    expect(B.totalKwh).toBe(2); // t10 + t20
    expect(A.recipeId).toBe(1);
    expect(B.recipeId).toBe(2);
    expect(A.kwhPerUnit).toBeCloseTo(2 / 2, 6);
    expect(B.kwhPerUnit).toBeCloseTo(2 / 4, 6);
    expect(B.peakDemandKw).toBe(22);
  });

  it("uses direct recipeRef when present (overrides window)", async () => {
    energyState.windows = [
      { recipeId: 9, machineId: 7, recipeCode: "RW", startAt: minutes(0), endAt: null },
    ];
    energyState.readings = [
      { machineId: 7, value: 5, powerKw: 8, recipeRef: "RDIRECT", timestamp: minutes(3) },
    ];
    energyState.goodUnits = [{ recipeRef: "RDIRECT", machineId: 7, goodUnits: 5 }];

    const rows = await computeRecipeEnergy({ from: minutes(0), to: minutes(30), machineId: 7 });
    expect(rows).toHaveLength(1);
    expect(rows[0].recipeRef).toBe("RDIRECT");
    expect(rows[0].totalKwh).toBe(5);
    expect(rows[0].kwhPerUnit).toBeCloseTo(1, 6);
  });

  it("kwhPerUnit is null when goodUnits = 0", async () => {
    energyState.windows = [
      { recipeId: 1, machineId: 7, recipeCode: "RA", startAt: minutes(0), endAt: null },
    ];
    energyState.readings = [
      { machineId: 7, value: 3, powerKw: 5, recipeRef: null, timestamp: minutes(1) },
    ];
    energyState.goodUnits = []; // no units produced
    const rows = await computeRecipeEnergy({ from: minutes(0), to: minutes(30), machineId: 7 });
    expect(rows[0].totalKwh).toBe(3);
    expect(rows[0].unitsProduced).toBe(0);
    expect(rows[0].kwhPerUnit).toBeNull();
  });
});

describe("computePeakDemand", () => {
  it("returns instantaneous MAX + peakAt and rolling max (main-PG path)", async () => {
    energyState.peak = { instantaneousPeakKw: 42.5, peakAt: minutes(8) };
    energyState.rollingBuckets = [
      { bucket: minutes(0), avgPowerKw: 10 },
      { bucket: minutes(15), avgPowerKw: 30 },
      { bucket: minutes(30), avgPowerKw: 25 },
    ];
    const out = await computePeakDemand({ from: minutes(0), to: minutes(60), machineId: 7, windowMin: 15 });
    expect(out.instantaneousPeakKw).toBe(42.5);
    expect(out.peakAt).toEqual(minutes(8));
    expect(out.rollingDemandKw).toBe(30);
    expect(out.rollingWindowMin).toBe(15);
    expect(out.source).toBe("main_pg");
  });

  it("uses TSDB time_bucket path when TSDB enabled", async () => {
    tsdbState.enabled = true;
    tsdbState.buckets = [
      { bucket: minutes(0), avgPowerKw: 50, totalValue: 5 },
      { bucket: minutes(15), avgPowerKw: 40, totalValue: 4 },
    ];
    energyState.peak = { instantaneousPeakKw: 60, peakAt: minutes(2) };
    const out = await computePeakDemand({ from: minutes(0), to: minutes(60) });
    expect(out.source).toBe("tsdb");
    expect(out.rollingDemandKw).toBe(50);
    expect(out.instantaneousPeakKw).toBe(60);
  });
});

describe("computePowerFactor", () => {
  it("all NULL → available:false", async () => {
    energyState.pf = { samples: 10, pfSamples: 0, avgPf: null, minPf: null, belowThreshold: 0 };
    const out = await computePowerFactor({ from: minutes(0), to: minutes(60) });
    expect(out.available).toBe(false);
    expect(out.avgPowerFactor).toBeNull();
  });

  it("mixed → avg over non-NULL subset + % below threshold", async () => {
    energyState.pf = { samples: 10, pfSamples: 6, avgPf: 0.85, minPf: 0.7, belowThreshold: 3 };
    const out = await computePowerFactor({ from: minutes(0), to: minutes(60), threshold: 0.9 });
    expect(out.available).toBe(true);
    expect(out.avgPowerFactor).toBe(0.85);
    expect(out.minPowerFactor).toBe(0.7);
    expect(out.pfSamples).toBe(6);
    expect(out.pctBelowThreshold).toBeCloseTo((3 / 6) * 100, 4);
  });
});

describe("forecastEnergy", () => {
  it("≥3 points → returns a forecast series (main-PG kwh path)", async () => {
    // 4 readings spread across 4 hourly buckets → 4 series points.
    energyState.readings = [
      { machineId: 7, value: 10, powerKw: 5, recipeRef: null, timestamp: minutes(0) },
      { machineId: 7, value: 12, powerKw: 6, recipeRef: null, timestamp: minutes(60) },
      { machineId: 7, value: 11, powerKw: 5, recipeRef: null, timestamp: minutes(120) },
      { machineId: 7, value: 13, powerKw: 7, recipeRef: null, timestamp: minutes(180) },
    ];
    const out = await forecastEnergy({ from: minutes(0), to: minutes(300), machineId: 7, metric: "kwh", horizon: 6, bucketMin: 60 });
    expect(out.available).toBe(true);
    expect(out.pointsUsed).toBe(4);
    expect(out.forecast.length).toBe(6);
    expect(out.predictedPeak).not.toBeNull();
  });

  it("<3 points → available:false, no throw", async () => {
    energyState.readings = [
      { machineId: 7, value: 10, powerKw: 5, recipeRef: null, timestamp: minutes(0) },
    ];
    const out = await forecastEnergy({ from: minutes(0), to: minutes(120), machineId: 7, metric: "kwh", bucketMin: 60 });
    expect(out.available).toBe(false);
    expect(out.reason).toBe("energy.forecast.insufficientData");
    expect(out.forecast).toEqual([]);
  });
});

describe("suggestDemandResponse — TEXT ONLY", () => {
  it("flags critical when observed peak exceeds threshold", () => {
    const peak: any = { rollingDemandKw: 120, instantaneousPeakKw: 130, rollingWindowMin: 15 };
    const out = suggestDemandResponse(null, peak, 100);
    expect(out[0].severity).toBe("critical");
    expect(out[0].messageKey).toBe("energy.demandResponse.peakExceeded");
    // text+i18n keys only — no action/dispatch fields
    for (const s of out) {
      expect(s).toHaveProperty("messageKey");
      expect(s).not.toHaveProperty("command");
      expect(s).not.toHaveProperty("action");
    }
  });

  it("returns withinLimits info when under threshold", () => {
    const peak: any = { rollingDemandKw: 50, instantaneousPeakKw: 60, rollingWindowMin: 15 };
    const out = suggestDemandResponse(null, peak, 100);
    expect(out).toHaveLength(1);
    expect(out[0].messageKey).toBe("energy.demandResponse.withinLimits");
  });
});

describe("SAFETY — no machine-write path", () => {
  const importsModule = (src: string, name: string) =>
    new RegExp(`(import|require)[^\\n]*${name}`, "i").test(
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
    );

  it("energyAnalyticsService source does NOT import commandDispatcher or writeTags", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "server", "services", "energyAnalyticsService.ts"), "utf-8");
    expect(importsModule(src, "commandDispatcher")).toBe(false);
    expect(importsModule(src, "writeTags")).toBe(false);
  });
});
