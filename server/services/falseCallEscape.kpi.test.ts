/**
 * Doc 27 W5-A (gap A9) — false-call ↔ escape paired KPI tests.
 *
 * Pure: tuning-hint classification, threshold evaluation, and the factory-TZ
 * date-window resolution (resolveFactoryDateWindow). DB integration: seeded
 * OK/NG/NTF inspections + station_traces rows → endpoint shape, honest
 * rates, and FACTORY-local trend day buckets (a 23:30 UTC inspection lands
 * on the NEXT Asia/Ho_Chi_Minh day — the doc-27 A2 proof for this endpoint).
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  computeTuningHint,
  evaluateThresholdLevel,
  getFalseCallEscapeKpi,
} from "./falseCallEscapeService";
import { resolveFactoryDateWindow, getFactoryTimezone } from "../utils/kpi";
import * as db from "../db";

describe("computeTuningHint (pure)", () => {
  it("flags overSensitive when false calls rise while escapes fall", () => {
    expect(computeTuningHint([1, 1, 10, 10], [10, 10, 1, 1])).toBe("overSensitive");
  });
  it("flags underSensitive when escapes rise while false calls fall", () => {
    expect(computeTuningHint([10, 10, 1, 1], [1, 1, 10, 10])).toBe("underSensitive");
  });
  it("flags processDrift when both rise", () => {
    expect(computeTuningHint([1, 1, 10, 10], [1, 1, 10, 10])).toBe("processDrift");
  });
  it("flags improving when both fall", () => {
    expect(computeTuningHint([10, 10, 1, 1], [10, 10, 1, 1])).toBe("improving");
  });
  it("stays stable inside the 1pp deadband", () => {
    expect(computeTuningHint([5, 5.2, 5.1, 5.3], [3, 3.1, 2.9, 3])).toBe("stable");
  });
  it("refuses to over-read short series", () => {
    expect(computeTuningHint([1, 10], [10, 1])).toBe("insufficientData");
    expect(computeTuningHint([1, 2, 3, 4], [])).toBe("insufficientData");
    expect(computeTuningHint([1, 2, 3, null], [1, 2, 3, 4])).toBe("insufficientData");
  });
});

describe("evaluateThresholdLevel (pure)", () => {
  const row = { warningThreshold: "10", criticalThreshold: "20", comparisonOperator: "lte" };
  it("healthy-direction semantics: lte means healthy while rate <= threshold", () => {
    expect(evaluateThresholdLevel(5, row)).toBe("ok");
    expect(evaluateThresholdLevel(15, row)).toBe("warning");
    expect(evaluateThresholdLevel(25, row)).toBe("critical");
  });
  it("returns null with no row or no computable rate", () => {
    expect(evaluateThresholdLevel(15, null)).toBeNull();
    expect(evaluateThresholdLevel(null, row)).toBeNull();
  });
});

describe("resolveFactoryDateWindow (factory-TZ windows)", () => {
  it("interprets date-only strings as FACTORY-local calendar days", () => {
    // Assumes default FACTORY_TZ Asia/Ho_Chi_Minh (+07:00, no DST).
    expect(getFactoryTimezone()).toBe("Asia/Ho_Chi_Minh");
    const w = resolveFactoryDateWindow("2026-03-10", "2026-03-10");
    expect(w.start.toISOString()).toBe("2026-03-09T17:00:00.000Z"); // 00:00 VN
    expect(w.end.toISOString()).toBe("2026-03-10T17:00:00.000Z");   // next 00:00 VN
    expect(w.endExclusive).toBe(true);
  });
  it("passes full ISO timestamps through unchanged", () => {
    const w = resolveFactoryDateWindow("2026-03-10T01:02:03.000Z", "2026-03-11T04:05:06.000Z");
    expect(w.start.toISOString()).toBe("2026-03-10T01:02:03.000Z");
    expect(w.end.toISOString()).toBe("2026-03-11T04:05:06.000Z");
    expect(w.endExclusive).toBe(false);
  });
});

// ─── DB integration ─────────────────────────────────────────────────────────

describe("getFalseCallEscapeKpi (DB integration)", () => {
  const ts = Date.now();
  let machineId: number;
  let productModelId: number;
  const windowStart = new Date("2026-03-01T00:00:00Z");
  const windowEnd = new Date("2026-03-20T00:00:00Z");
  // 23:30 UTC = 06:30 NEXT day in Asia/Ho_Chi_Minh — the TZ-bucket proof row.
  const lateUtc = new Date("2026-03-10T23:30:00Z");

  function factoryDayOf(instant: Date): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: getFactoryTimezone(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  }

  beforeAll(async () => {
    const factoryId = await db.createFactory({ code: `TEST_FAC_FCE_${ts}`, name: "FCE fac" });
    const workshopId = await db.createWorkshop({ factoryId, code: `TEST_WS_FCE_${ts}`, name: "FCE ws" });
    const lineId = await db.createProductionLine({ workshopId, code: `TEST_LINE_FCE_${ts}`, name: "FCE line" });
    const stationId = await db.createStation({ lineId, code: `TEST_ST_FCE_${ts}`, name: "FCE st", sequence: 1 });
    machineId = await db.createMachine({
      stationId,
      code: `M_FCE_${ts}`,
      name: "FCE machine",
      machineType: "AVI",
      apiKey: `test_fce_${ts}`,
    });
    productModelId = await db.createProductModel({ code: `PROD_FCE_${ts}`, name: "FCE product", version: "1.0" });

    // 5 inspections on 2026-03-05 (VN daytime) + 1 NTF at 23:30 UTC on 03-10
    // (VN day 03-11): totals → machineNgCalls 4 (2 NG + 2 NTF), falseCalls 2.
    const base = new Date("2026-03-05T03:00:00Z").getTime();
    const rows: Array<["OK" | "NG" | "NTF", "OK" | "NG", number]> = [
      ["OK", "OK", 0],
      ["OK", "OK", 10],
      ["NG", "NG", 20],
      ["NG", "NG", 30],
      ["NTF", "NG", 40], // machine said NG, human cleared → false call
    ];
    let i = 0;
    for (const [overallResult, originalResult, minutes] of rows) {
      await db.createProductInspection({
        machineId,
        productModelId,
        serialNumber: `SN_FCE_${ts}_${i++}`,
        overallResult,
        originalResult,
        inspectionTime: new Date(base + minutes * 60_000),
      });
    }
    await db.createProductInspection({
      machineId,
      productModelId,
      serialNumber: `SN_FCE_${ts}_LATE`,
      overallResult: "NTF",
      originalResult: "NG",
      inspectionTime: lateUtc,
    });

    // Station traces (escape side; product+window scope):
    //  T1: defective + escaped, T2: defective only, T3: clean.
    await db.upsertStationTrace({
      serialNumber: `SN_FCE_TRACE1_${ts}`,
      productModelId,
      lotCode: `LOT_FCE_${ts}`,
      firstSeenAt: new Date("2026-03-06T01:00:00Z"),
      lastSeenAt: new Date("2026-03-06T02:00:00Z"),
      stationsTouched: ["AOI_PRE", "AOI_POST"],
      firstDefectStation: "AOI_POST",
      firstEscapeStation: "AOI_POST",
      totalDefects: 2,
      totalEscapes: 1,
      summary: {},
    } as any);
    await db.upsertStationTrace({
      serialNumber: `SN_FCE_TRACE2_${ts}`,
      productModelId,
      lotCode: `LOT_FCE_${ts}`,
      firstSeenAt: new Date("2026-03-06T01:00:00Z"),
      lastSeenAt: new Date("2026-03-06T03:00:00Z"),
      stationsTouched: ["AOI_PRE"],
      firstDefectStation: "AOI_PRE",
      firstEscapeStation: null,
      totalDefects: 1,
      totalEscapes: 0,
      summary: {},
    } as any);
    await db.upsertStationTrace({
      serialNumber: `SN_FCE_TRACE3_${ts}`,
      productModelId,
      lotCode: `LOT_FCE_${ts}`,
      firstSeenAt: new Date("2026-03-07T01:00:00Z"),
      lastSeenAt: new Date("2026-03-07T02:00:00Z"),
      stationsTouched: ["AOI_PRE", "AOI_POST"],
      firstDefectStation: null,
      firstEscapeStation: null,
      totalDefects: 0,
      totalEscapes: 0,
      summary: {},
    } as any);
  });

  it("returns honest paired rates + trends with factory-local day buckets", async () => {
    const r = await getFalseCallEscapeKpi({
      startDate: windowStart,
      endDate: windowEnd,
      machineIds: [machineId],
      productModelId,
    });

    // False-call side: 4 machine NG calls (2 NG + 2 NTF), 2 cleared as NTF.
    expect(r.falseCall.totalInspections).toBe(6);
    expect(r.falseCall.machineNgCalls).toBe(4);
    expect(r.falseCall.falseCalls).toBe(2);
    expect(r.falseCall.confirmedNg).toBe(2);
    expect(r.falseCall.falseCallRate).toBe(50);

    // Factory-TZ proof: the 23:30 UTC NTF lands on the NEXT VN day.
    const lateDay = factoryDayOf(lateUtc); // 2026-03-11 in Asia/Ho_Chi_Minh
    expect(lateDay).toBe("2026-03-11");
    const lateBucket = r.falseCall.trend.find((p) => p.day === lateDay);
    expect(lateBucket).toBeTruthy();
    expect(lateBucket!.machineNgCalls).toBe(1);
    expect(lateBucket!.falseCalls).toBe(1);
    expect(lateBucket!.falseCallRate).toBe(100);
    // And NO bucket on the UTC day for that row alone.
    const utcDayBucket = r.falseCall.trend.find((p) => p.day === "2026-03-10");
    expect(utcDayBucket).toBeUndefined();

    // Escape side: 3 traced, 2 defective, 1 escaped → 50 %.
    expect(r.escape.available).toBe(true);
    expect(r.escape.tracedSerials).toBe(3);
    expect(r.escape.defectSerials).toBe(2);
    expect(r.escape.escapedSerials).toBe(1);
    expect(r.escape.totalEscapes).toBe(1);
    expect(r.escape.escapeRate).toBe(50);
    expect(r.escape.scope).toBe("product_window");

    // Hint: only 2 false-call days / 2 escape days → refuses to guess.
    expect(r.tuningHint).toBe("insufficientData");

    // Threshold wiring is visual-only and evaluated from yield_alert_thresholds.
    expect(r.threshold.visualOnly).toBe(true);
    expect([null, "ok", "warning", "critical"]).toContain(r.threshold.level);
  });

  it("returns an honest empty result when the machine scope resolves to nothing", async () => {
    const r = await getFalseCallEscapeKpi({
      startDate: windowStart,
      endDate: windowEnd,
      machineIds: [],
    });
    expect(r.falseCall.totalInspections).toBe(0);
    expect(r.falseCall.falseCallRate).toBeNull();
    expect(r.escape.available).toBe(false);
    expect(r.tuningHint).toBe("insufficientData");
  });
});
