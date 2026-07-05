/**
 * DB-integration tests for the canonical KPI fixes (doc 27 W1-C):
 *  - factory-timezone day bucketing (gap A2): a 23:30 UTC inspection must
 *    land on the NEXT day in Asia/Ho_Chi_Minh (UTC+7 → 06:30 next day);
 *  - canonical final yield (NTF = PASS) + true FPY (first inspection per
 *    serial; NTF/retests excluded) per §11 decision #4 (gaps A3/A4).
 *
 * Runs against the isolated cloned test DB (vitest.setup.ts).
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as db from "./db";
import { getFactoryTimezone } from "./utils/kpi";

/** Calendar day (YYYY-MM-DD) of a UTC instant in the factory timezone. */
function factoryDayOf(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: getFactoryTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

describe("canonical KPI + factory-timezone bucketing", () => {
  const timestamp = Date.now();
  let tzMachineId: number;
  let fpyMachineId: number;
  let productModelId: number;

  // Fixed instants: 23:30 UTC is 06:30 (+7) the NEXT VN day; 02:00 UTC is
  // 09:00 the SAME VN day.
  const lateUtc = new Date("2026-03-10T23:30:00Z");
  const earlyUtc = new Date("2026-03-10T02:00:00Z");
  const rangeStart = new Date("2026-03-01T00:00:00Z");
  const rangeEnd = new Date("2026-03-20T00:00:00Z");

  beforeAll(async () => {
    const factoryId = await db.createFactory({
      code: `TEST_FAC_KPI_${timestamp}`,
      name: "KPI test factory",
    });
    const workshopId = await db.createWorkshop({
      factoryId,
      code: `TEST_WS_KPI_${timestamp}`,
      name: "KPI test workshop",
    });
    const lineId = await db.createProductionLine({
      workshopId,
      code: `TEST_LINE_KPI_${timestamp}`,
      name: "KPI test line",
    });
    const stationId = await db.createStation({
      lineId,
      code: `TEST_ST_KPI_${timestamp}`,
      name: "KPI test station",
      sequence: 1,
    });
    tzMachineId = await db.createMachine({
      stationId,
      code: `M_KPI_TZ_${timestamp}`,
      name: "KPI TZ machine",
      machineType: "AOI",
      apiKey: `test_kpi_tz_${timestamp}`,
    });
    fpyMachineId = await db.createMachine({
      stationId,
      code: `M_KPI_FPY_${timestamp}`,
      name: "KPI FPY machine",
      machineType: "AOI",
      apiKey: `test_kpi_fpy_${timestamp}`,
    });
    productModelId = await db.createProductModel({
      code: `PROD_KPI_${timestamp}`,
      name: "KPI test product",
      version: "1.0",
    });

    // ── TZ machine: one inspection either side of VN midnight ──
    await db.createProductInspection({
      machineId: tzMachineId,
      productModelId,
      serialNumber: `SN_KPI_TZ_LATE_${timestamp}`,
      overallResult: "NG",
      originalResult: "NG",
      inspectionTime: lateUtc,
    });
    await db.createProductInspection({
      machineId: tzMachineId,
      productModelId,
      serialNumber: `SN_KPI_TZ_EARLY_${timestamp}`,
      overallResult: "OK",
      originalResult: "OK",
      inspectionTime: earlyUtc,
    });

    // ── FPY machine: 3 serials / 5 inspections (decision #4 fixture) ──
    //  S1: OK  then NG retest → first inspection = OK  (counts as first pass)
    //  S2: NTF               → first inspection = NTF (NOT a first pass)
    //  S3: NG  then OK retest → first inspection = NG
    // All rows: ok=2, ntf=1, ng=2, total=5 → final yield = 60%
    // Firsts: pass 1 of 3 → FPY = 33.33%
    const base = new Date("2026-03-12T03:00:00Z").getTime();
    const rows: Array<[string, "OK" | "NG" | "NTF", number]> = [
      [`SN_KPI_S1_${timestamp}`, "OK", 0],
      [`SN_KPI_S1_${timestamp}`, "NG", 60],
      [`SN_KPI_S2_${timestamp}`, "NTF", 5],
      [`SN_KPI_S3_${timestamp}`, "NG", 10],
      [`SN_KPI_S3_${timestamp}`, "OK", 70],
    ];
    for (const [serialNumber, overallResult, minutes] of rows) {
      await db.createProductInspection({
        machineId: fpyMachineId,
        productModelId,
        serialNumber,
        overallResult,
        originalResult: overallResult === "NTF" ? "NG" : overallResult,
        inspectionTime: new Date(base + minutes * 60_000),
      });
    }
  });

  it("buckets a 23:30 UTC inspection on the NEXT factory-local (VN) day", async () => {
    const expectedLateDay = factoryDayOf(lateUtc);   // 2026-03-11 in Asia/Ho_Chi_Minh
    const expectedEarlyDay = factoryDayOf(earlyUtc); // 2026-03-10
    expect(expectedLateDay).not.toBe(expectedEarlyDay); // sanity: crosses VN midnight

    const trend = await db.getNGTrendByDayDirect({
      machineId: tzMachineId,
      startDate: rangeStart,
      endDate: rangeEnd,
    });

    expect(trend).toHaveLength(2);
    const byDay = new Map(trend.map((r: any) => [String(r.date), r]));
    expect([...byDay.keys()].sort()).toEqual([expectedEarlyDay, expectedLateDay]);
    expect(Number(byDay.get(expectedLateDay)!.ngCount)).toBe(1);
    expect(Number(byDay.get(expectedEarlyDay)!.okCount)).toBe(1);
  });

  it("getMachineStats: final yield counts NTF as pass; FPY excludes NTF and retests", async () => {
    const stats = await db.getMachineStats(fpyMachineId, rangeStart, rangeEnd);
    expect(stats.total).toBe(5);
    expect(stats.ok).toBe(2);
    expect(stats.ng).toBe(2);
    expect(stats.ntf).toBe(1);
    // Final yield = (2 OK + 1 NTF) / 5 = 60%
    expect(stats.yieldRate).toBe(60);
    // FPY = 1 first-pass (S1) / 3 serials = 33.33%
    expect(stats.firstTotal).toBe(3);
    expect(stats.firstPass).toBe(1);
    expect(stats.fpy).toBe(33.33);
  });

  it("getDashboardStats agrees with getMachineStats on the same slice", async () => {
    const stats = await db.getDashboardStats({
      machineId: fpyMachineId,
      startDate: rangeStart,
      endDate: rangeEnd,
    });
    expect(stats.total).toBe(5);
    expect(stats.yieldRate).toBe(60);
    expect(stats.fpy).toBe(33.33);
  });

  it("getTopBottomMachines reports true FPY per machine (wire name kept)", async () => {
    const { top, bottom } = await db.getTopBottomMachines({
      startDate: rangeStart,
      endDate: rangeEnd,
      limit: 1000,
    });
    const all = [...top, ...bottom];
    const mine = all.find((m: any) => m.id === fpyMachineId);
    expect(mine).toBeDefined();
    expect(mine!.fpy).toBe(33.3);         // true FPY, 1 decimal
    expect((mine as any).finalYield).toBe(60); // canonical final yield alongside
  });

  it("getShiftStats runs the factory-local shift + per-shift FPY queries", async () => {
    // Doc 32 R1: shift codes now come from shift_configs windows when the
    // factory has configured shifts (else the legacy morning/afternoon/night
    // fallback) — assert the shape, not a fixed code set.
    const shifts = await db.getShiftStats({ startDate: rangeStart, endDate: rangeEnd });
    expect(Array.isArray(shifts)).toBe(true);
    for (const s of shifts) {
      expect(typeof s.shift).toBe("string");
      expect(s.shift.length).toBeGreaterThan(0);
      expect(typeof s.shiftName).toBe("string");
      expect(typeof (s as any).shiftWindow).toBe("string");
      expect(Number.isFinite(s.fpy)).toBe(true);
      expect(Number.isFinite((s as any).finalYield)).toBe(true);
    }
  });

  it("remaining rewired statistics read paths execute (smoke)", async () => {
    const daily = await db.getDailyStats(undefined, undefined, 30);
    expect(Array.isArray(daily)).toBe(true);
    const hourly = await db.getHourlyStats({ machineId: fpyMachineId, hours: 24 });
    expect(Array.isArray(hourly)).toBe(true);
    const trend = await db.getYieldTrendData({
      startDate: rangeStart,
      endDate: rangeEnd,
      machineId: fpyMachineId,
      interval: "day",
    });
    expect(trend.length).toBeGreaterThan(0);
    // Canonical final yield in the trend too: (2 OK + 1 NTF) / 5 = 60%
    const totals = trend.reduce(
      (acc, t) => ({
        ok: acc.ok + t.okCount,
        ntf: acc.ntf + t.ntfCount,
        total: acc.total + t.totalCount,
      }),
      { ok: 0, ntf: 0, total: 0 },
    );
    expect(totals.total).toBe(5);
    const weighted = trend.reduce((s, t) => s + t.yieldRate * t.totalCount, 0) / totals.total;
    expect(weighted).toBeCloseTo(60, 5);
    const ws = await db.getWorkstationSummary({});
    expect(Array.isArray(ws)).toBe(true);
    const throughput = await db.getThroughputByCorporate({
      startDate: rangeStart,
      endDate: rangeEnd,
      interval: "day",
    });
    expect(Array.isArray(throughput)).toBe(true);
    const recent = await db.getRecentYieldData({ machineId: fpyMachineId, days: 30 });
    expect(Array.isArray(recent)).toBe(true);
  });

  // Generous timeout: 6 sequential DB-integration analytics queries take
  // ~2.5s alone but can exceed vitest's 5s default under full-suite load.
  it("aiInspectionAnalytics queries run and use canonical yield (they previously threw on invalid 'PASS'/'FAIL' enum literals)", { timeout: 20_000 }, async () => {
    const analytics = await import("./services/aiInspectionAnalytics");
    const period = { startDate: rangeStart, endDate: rangeEnd, machineId: fpyMachineId };

    const defectTrend = await analytics.getDefectTrend(period);
    expect(defectTrend).toHaveLength(1); // all 5 rows fall on one VN day
    expect(defectTrend[0].total).toBe(5);
    expect(defectTrend[0].pass).toBe(3); // OK + NTF (canonical final-yield pass)
    expect(defectTrend[0].fail).toBe(2);
    expect(defectTrend[0].yieldRate).toBeCloseTo(60, 5);

    const perf = await analytics.getMachinePerformance(period);
    const minePerf = perf.find(p => p.machineId === fpyMachineId);
    expect(minePerf).toBeDefined();
    expect(minePerf!.yieldRate).toBeCloseTo(60, 5);

    const shifts = await analytics.getShiftAnalysis(period);
    expect(Array.isArray(shifts)).toBe(true);

    const heatmap = await analytics.getDefectHeatmap(period);
    expect(Array.isArray(heatmap)).toBe(true);

    const pareto = await analytics.getDefectPareto(period);
    expect(Array.isArray(pareto)).toBe(true);
  });
});
