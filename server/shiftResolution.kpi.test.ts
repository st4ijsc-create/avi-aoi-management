/**
 * Doc 32 Wave R1 — shift resolution: phần THUẦN (không DB).
 *  - pure TS classifiers (factory-local minutes, window match wrap-aware, fallback).
 * Phần getShiftStats / getShiftReport / resolveShiftForInspections chạy trên `_test` nằm ở `shiftResolution.kpi.db.test.ts`
 * (giao dịch HOÀN TÁC) — tách ra vì tệp cũ INSERT thẳng vào `_test` mà không dọn.
 */
import { describe, it, expect } from "vitest";
import {
  classifyShiftByWindow,
  factoryLocalMinutesOfDay,
  buildShiftClassifierSql,
  FALLBACK_SHIFTS,
  type ShiftWindowMeta,
} from "./db/shiftResolution";
import { getFactoryTimezone } from "./utils/kpi";

// VN = UTC+7 (no DST). 23:30Z→06:30, 02:00Z→09:00, 14:00Z→21:00.
const at0630vn = new Date("2026-03-10T23:30:00Z");
const at0900vn = new Date("2026-03-10T02:00:00Z");
const at2100vn = new Date("2026-03-10T14:00:00Z");

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
