/**
 * Doc 32 Wave R1 — shift resolution + real shift_configs-driven getShiftStats /
 * getShiftReport (decision #3 = join production_sessions, NO ingest change).
 *
 * Covers:
 *  - pure TS classifiers (factory-local minutes, window match wrap-aware, fallback);
 *  - getShiftStats with 2-shift and 3-shift factory configs (deterministic via
 *    FACTORY-SPECIFIC shift_configs, which override any global seed);
 *  - factory-TZ correctness (23:30 UTC → 06:30 VN → the DAY shift, not NIGHT);
 *  - resolveShiftForInspections tiers: window (config), session-overrides-window,
 *    and hour-bucket fallback for a time in a gap between configured shifts;
 *  - getShiftReport rollup shape (window, machinesActive, yield, defectTypeCount).
 *
 * Runs against the isolated cloned test DB (vitest.setup.ts).
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as db from "./db";
import { shiftConfigs, productionSessions } from "../drizzle/schema";
import {
  resolveShiftForInspections,
  classifyShiftByWindow,
  factoryLocalMinutesOfDay,
  buildShiftClassifierSql,
  FALLBACK_SHIFTS,
  type ShiftWindowMeta,
} from "./db/shiftResolution";
import { getFactoryTimezone } from "./utils/kpi";

const rangeStart = new Date("2026-03-01T00:00:00Z");
const rangeEnd = new Date("2026-03-20T00:00:00Z");

// VN = UTC+7 (no DST). 23:30Z→06:30, 02:00Z→09:00, 14:00Z→21:00, 16:00Z→23:00.
const at0630vn = new Date("2026-03-10T23:30:00Z");
const at0900vn = new Date("2026-03-10T02:00:00Z");
const at2100vn = new Date("2026-03-10T14:00:00Z");
const at2300vn = new Date("2026-03-10T16:00:00Z");
const at1500vn = new Date("2026-03-10T08:00:00Z");

function meta(over: Partial<ShiftWindowMeta> & { code: string; startHour: number; endHour: number }): ShiftWindowMeta {
  return {
    name: over.code,
    shiftConfigId: null,
    startMinute: 0,
    endMinute: 0,
    orderIndex: 0,
    window: "",
    ...over,
  } as ShiftWindowMeta;
}

describe("shift resolution — pure classifiers", () => {
  it("factoryLocalMinutesOfDay converts UTC to factory-local minutes-of-day", () => {
    const tz = getFactoryTimezone(); // Asia/Ho_Chi_Minh
    expect(factoryLocalMinutesOfDay(at0630vn, tz)).toBe(6 * 60 + 30);
    expect(factoryLocalMinutesOfDay(at0900vn, tz)).toBe(9 * 60);
    expect(factoryLocalMinutesOfDay(at2100vn, tz)).toBe(21 * 60);
  });

  it("classifyShiftByWindow matches normal and midnight-wrapping shifts", () => {
    const day = meta({ code: "DAY", startHour: 6, endHour: 18 });
    const night = meta({ code: "NIGHT", startHour: 18, endHour: 6 }); // wraps
    const set = [day, night];
    expect(classifyShiftByWindow(6 * 60 + 30, set)?.code).toBe("DAY");
    expect(classifyShiftByWindow(17 * 60 + 59, set)?.code).toBe("DAY");
    expect(classifyShiftByWindow(18 * 60, set)?.code).toBe("NIGHT");
    expect(classifyShiftByWindow(2 * 60, set)?.code).toBe("NIGHT"); // after midnight
    expect(classifyShiftByWindow(23 * 60, set)?.code).toBe("NIGHT");
  });

  it("classifyShiftByWindow returns null in a gap between shifts", () => {
    const set = [meta({ code: "D", startHour: 6, endHour: 14 }), meta({ code: "N", startHour: 22, endHour: 6 })];
    expect(classifyShiftByWindow(21 * 60, set)).toBeNull(); // 21:00 not covered
    // The legacy fallback still classifies it (afternoon 14-22).
    expect(classifyShiftByWindow(21 * 60, FALLBACK_SHIFTS)?.code).toBe("afternoon");
  });

  it("buildShiftClassifierSql falls back to legacy hour buckets when no configs", () => {
    const { isFallback, metas } = buildShiftClassifierSql([], { getSQL: () => ({} as any) } as any);
    expect(isFallback).toBe(true);
    expect(metas.map((m) => m.code)).toEqual(["morning", "afternoon", "night"]);
  });
});

describe("getShiftStats / getShiftReport — real shift_configs windows", () => {
  const ts = Date.now();
  // shift_configs.code is varchar(20) — keep codes compact + unique.
  const sfx = ts.toString(36);
  let f2Code = "";
  let f2NightId = 0;
  let f2Line = "";
  let f2MachineId = 0;
  let f2Id = 0;
  let f3Id = 0;
  let fgapCode = "";
  let fgapId = 0;

  async function seedShift(over: {
    factoryId: number;
    name: string;
    code: string;
    startHour: number;
    endHour: number;
    orderIndex: number;
  }): Promise<number> {
    const raw = await db.getDb();
    const [row] = await raw!
      .insert(shiftConfigs)
      .values({
        factoryId: over.factoryId,
        name: over.name,
        code: over.code,
        startHour: over.startHour,
        startMinute: 0,
        endHour: over.endHour,
        endMinute: 0,
        orderIndex: over.orderIndex,
        isActive: true,
      })
      .returning({ id: shiftConfigs.id });
    return row.id;
  }

  async function buildFactory(prefix: string) {
    const code = `${prefix}_${ts}`;
    const factoryId = await db.createFactory({ code, name: `${prefix} factory` });
    const workshopId = await db.createWorkshop({ factoryId, code: `${prefix}_WS_${ts}`, name: "ws" });
    const lineCode = `${prefix}_LINE_${ts}`;
    const lineId = await db.createProductionLine({ workshopId, code: lineCode, name: "line" });
    const stationId = await db.createStation({ lineId, code: `${prefix}_ST_${ts}`, name: "st", sequence: 1 });
    const machineId = await db.createMachine({
      stationId,
      code: `${prefix}_M_${ts}`,
      name: "m",
      machineType: "AOI",
      apiKey: `test_${prefix}_${ts}`,
    });
    return { code, factoryId, workshopId, lineCode, lineId, stationId, machineId };
  }

  beforeAll(async () => {
    const productModelId = await db.createProductModel({ code: `PM_SHIFT_${ts}`, name: "pm", version: "1.0" });

    // ── F2: clean 2-shift (DAY 06-18, NIGHT 18-06) covering 24h ──
    const f2 = await buildFactory("SHIFT_F2");
    f2Code = f2.code;
    f2Line = f2.lineCode;
    f2MachineId = f2.machineId;
    f2Id = f2.factoryId;
    await seedShift({ factoryId: f2.factoryId, name: "Ca ngày", code: `F2D${sfx}`, startHour: 6, endHour: 18, orderIndex: 1 });
    f2NightId = await seedShift({ factoryId: f2.factoryId, name: "Ca đêm", code: `F2N${sfx}`, startHour: 18, endHour: 6, orderIndex: 2 });

    const f2Rows: Array<[string, "OK" | "NG", Date]> = [
      [`SN_F2_A_${ts}`, "OK", at0630vn], // DAY
      [`SN_F2_B_${ts}`, "NG", at0900vn], // DAY
      [`SN_F2_C_${ts}`, "OK", at2100vn], // NIGHT
    ];
    for (const [serialNumber, overallResult, inspectionTime] of f2Rows) {
      await db.createProductInspection({
        machineId: f2.machineId,
        productModelId,
        serialNumber,
        overallResult,
        originalResult: overallResult,
        inspectionTime,
        factoryCode: f2.code,
        lineCode: f2.lineCode,
      });
    }

    // ── F3: 3-shift (S1 06-14, S2 14-22, S3 22-06) ──
    const f3 = await buildFactory("SHIFT_F3");
    f3Id = f3.factoryId;
    await seedShift({ factoryId: f3.factoryId, name: "Ca 1", code: `F3A${sfx}`, startHour: 6, endHour: 14, orderIndex: 1 });
    await seedShift({ factoryId: f3.factoryId, name: "Ca 2", code: `F3B${sfx}`, startHour: 14, endHour: 22, orderIndex: 2 });
    await seedShift({ factoryId: f3.factoryId, name: "Ca 3", code: `F3C${sfx}`, startHour: 22, endHour: 6, orderIndex: 3 });
    const f3Rows: Array<[string, Date]> = [
      [`SN_F3_1_${ts}`, at0900vn], // S1
      [`SN_F3_2_${ts}`, at1500vn], // S2
      [`SN_F3_3_${ts}`, at2300vn], // S3
    ];
    for (const [serialNumber, inspectionTime] of f3Rows) {
      await db.createProductInspection({
        machineId: f3.machineId,
        productModelId,
        serialNumber,
        overallResult: "OK",
        originalResult: "OK",
        inspectionTime,
        factoryCode: f3.code,
        lineCode: f3.lineCode,
      });
    }

    // ── F_gap: 2 shifts with a 14:00-22:00 gap (DAY 06-14, NIGHT 22-06) ──
    const fgap = await buildFactory("SHIFT_FG");
    fgapCode = fgap.code;
    fgapId = fgap.factoryId;
    await seedShift({ factoryId: fgap.factoryId, name: "Ngày", code: `FGD${sfx}`, startHour: 6, endHour: 14, orderIndex: 1 });
    await seedShift({ factoryId: fgap.factoryId, name: "Đêm", code: `FGN${sfx}`, startHour: 22, endHour: 6, orderIndex: 2 });

    // ── Session that ran the NIGHT shift but covers a 06:30 VN inspection
    //    (late overtime) — used to prove tier-1 overrides window classification. ──
    const rawDb = await db.getDb();
    await rawDb!
      .insert(productionSessions)
      .values({
        sessionCode: `SESS_F2_${ts}`,
        shiftConfigId: f2NightId,
        factoryId: f2.factoryId,
        workshopId: f2.workshopId,
        lineId: f2.lineId,
        operatorId: 1,
        status: "closed",
        shiftDate: new Date("2026-03-10T00:00:00Z"),
        plannedStart: new Date("2026-03-10T23:00:00Z"),
        plannedEnd: new Date("2026-03-11T01:00:00Z"),
        actualStart: new Date("2026-03-10T23:00:00Z"),
        actualEnd: new Date("2026-03-11T01:00:00Z"),
      });
  });

  it("getShiftStats: 2-shift factory returns exactly its 2 configured shifts", async () => {
    const rows = await db.getShiftStats({ factoryId: f2Id, startDate: rangeStart, endDate: rangeEnd });
    const byCode = new Map(rows.map((r: any) => [r.shift, r]));
    expect(rows).toHaveLength(2);
    const day = byCode.get(`F2D${sfx}`);
    const night = byCode.get(`F2N${sfx}`);
    expect(day).toBeDefined();
    expect(night).toBeDefined();
    // 23:30 UTC (06:30 VN) landed in DAY, not NIGHT → factory-TZ correctness.
    expect(day.total).toBe(2);
    expect(day.ok).toBe(1);
    expect(day.ng).toBe(1);
    expect(day.finalYield).toBe(50); // (1 OK + 0 NTF)/2
    expect(day.shiftWindow).toBe("06:00-18:00");
    expect(night.total).toBe(1);
    expect(night.ok).toBe(1);
    expect(night.finalYield).toBe(100);
  });

  it("getShiftStats: 3-shift factory returns exactly its 3 configured shifts", async () => {
    const rows = await db.getShiftStats({ factoryId: f3Id, startDate: rangeStart, endDate: rangeEnd });
    expect(rows).toHaveLength(3);
    for (const r of rows as any[]) {
      expect(r.total).toBe(1);
      expect(String(r.shift)).toMatch(new RegExp(`^F3[ABC]${sfx}$`));
    }
  });

  it("getShiftReport: per-shift rollup with window, machinesActive, yield", async () => {
    const rows = await db.getShiftReport({ factoryId: f2Id, startDate: rangeStart, endDate: rangeEnd });
    const day = rows.find((r) => r.shift === `F2D${sfx}`)!;
    expect(day).toBeDefined();
    expect(day.shiftWindow).toBe("06:00-18:00");
    expect(day.total).toBe(2);
    expect(day.yieldPct).toBe(50);
    expect(day.machinesActive).toBe(1);
    expect(day.defectTypeCount).toBe(0); // no measurement_results seeded
    expect(day.source).toBe("config");
    // Every configured shift is present (zero-filled) even if it had no output.
    expect(rows.some((r) => r.shift === `F2N${sfx}`)).toBe(true);
  });

  it("resolveShiftForInspections: window tier classifies by shift_configs", async () => {
    const map = await resolveShiftForInspections(
      [
        { id: "a", machineId: f2MachineId, lineCode: f2Line, factoryCode: f2Code, inspectionTime: at0630vn },
        { id: "b", machineId: f2MachineId, lineCode: f2Line, factoryCode: f2Code, inspectionTime: at2100vn },
      ],
      { factoryId: f2Id, useSessions: false },
    );
    expect(map.get("a")!.code).toBe(`F2D${sfx}`);
    expect(map.get("a")!.source).toBe("config");
    expect(map.get("b")!.code).toBe(`F2N${sfx}`);
  });

  it("resolveShiftForInspections: a covering production_session overrides the window", async () => {
    const insp = { id: "s", machineId: f2MachineId, lineCode: f2Line, factoryCode: f2Code, inspectionTime: at0630vn };
    // Without sessions → window says DAY.
    const windowed = await resolveShiftForInspections([insp], { factoryId: f2Id, useSessions: false });
    expect(windowed.get("s")!.code).toBe(`F2D${sfx}`);
    // With sessions → the covering NIGHT session wins.
    const sessioned = await resolveShiftForInspections([insp], { factoryId: f2Id, useSessions: true });
    expect(sessioned.get("s")!.code).toBe(`F2N${sfx}`);
    expect(sessioned.get("s")!.source).toBe("session");
  });

  it("resolveShiftForInspections: falls back to hour buckets for a gap time", async () => {
    const map = await resolveShiftForInspections(
      [
        { id: "gap", machineId: 0, lineCode: null, factoryCode: fgapCode, inspectionTime: at2100vn }, // 21:00 VN — in the 14-22 gap
        { id: "cfg", machineId: 0, lineCode: null, factoryCode: fgapCode, inspectionTime: at0900vn }, // 09:00 VN — FGDAY
      ],
      { factoryId: fgapId, useSessions: false },
    );
    expect(map.get("gap")!.source).toBe("fallback");
    expect(map.get("gap")!.code).toBe("afternoon");
    expect(map.get("cfg")!.source).toBe("config");
    expect(map.get("cfg")!.code).toBe(`FGD${sfx}`);
  });
});
