/**
 * Tests for server/utils/factoryTime.ts (doc 27 §6 gap A1 — P0).
 *
 * Every expectation is an absolute UTC instant (toISOString), so these tests
 * prove the helpers are independent of the server/OS timezone: they must pass
 * identically on a UTC host, an Asia/Ho_Chi_Minh host, or a Windows dev box.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DEFAULT_FACTORY_TZ,
  dayKeyInZone,
  getFactoryTimezone,
  isValidTimeZone,
  nextRunInZone,
  parseHHmm,
  startOfDayInZone,
  wallClockInZone,
  wallClockToUtc,
  zoneOffsetMs,
} from "./factoryTime";

const VN = "Asia/Ho_Chi_Minh";
const NY = "America/New_York";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getFactoryTimezone", () => {
  it("defaults to Asia/Ho_Chi_Minh when FACTORY_TZ is unset/empty", () => {
    vi.stubEnv("FACTORY_TZ", "");
    expect(getFactoryTimezone()).toBe(DEFAULT_FACTORY_TZ);
    expect(DEFAULT_FACTORY_TZ).toBe(VN);
  });

  it("honors a valid FACTORY_TZ override", () => {
    vi.stubEnv("FACTORY_TZ", "Asia/Tokyo");
    expect(getFactoryTimezone()).toBe("Asia/Tokyo");
  });

  it("falls back to the default for an invalid FACTORY_TZ", () => {
    vi.stubEnv("FACTORY_TZ", "Not/AZone");
    expect(getFactoryTimezone()).toBe(DEFAULT_FACTORY_TZ);
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA identifiers", () => {
    expect(isValidTimeZone(VN)).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone(NY)).toBe(true);
  });

  it("rejects junk", () => {
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});

describe("wallClockInZone", () => {
  it("converts a UTC instant to Vietnam wall clock (+07:00, no DST)", () => {
    const wc = wallClockInZone(new Date("2026-07-04T01:30:45Z"), VN);
    expect(wc).toEqual({
      year: 2026,
      month: 7,
      day: 4,
      hour: 8,
      minute: 30,
      second: 45,
      dayOfWeek: 6, // 2026-07-04 is a Saturday
    });
  });

  it("handles the midnight boundary (hour 0, next wall date)", () => {
    const wc = wallClockInZone(new Date("2026-07-04T17:00:00Z"), VN);
    expect(wc.year).toBe(2026);
    expect(wc.month).toBe(7);
    expect(wc.day).toBe(5);
    expect(wc.hour).toBe(0);
    expect(wc.minute).toBe(0);
    expect(wc.dayOfWeek).toBe(0); // Sunday
  });
});

describe("zoneOffsetMs", () => {
  it("is a constant +7h for Vietnam year-round", () => {
    expect(zoneOffsetMs(new Date("2026-01-15T00:00:00Z"), VN)).toBe(7 * 3600_000);
    expect(zoneOffsetMs(new Date("2026-07-15T00:00:00Z"), VN)).toBe(7 * 3600_000);
  });

  it("tracks DST for America/New_York (-5h EST, -4h EDT)", () => {
    expect(zoneOffsetMs(new Date("2026-01-15T12:00:00Z"), NY)).toBe(-5 * 3600_000);
    expect(zoneOffsetMs(new Date("2026-07-15T12:00:00Z"), NY)).toBe(-4 * 3600_000);
  });
});

describe("wallClockToUtc", () => {
  it("06:00 Vietnam wall clock is 23:00Z of the previous day", () => {
    const d = wallClockToUtc({ year: 2026, month: 7, day: 5, hour: 6, minute: 0 }, VN);
    expect(d.toISOString()).toBe("2026-07-04T23:00:00.000Z");
  });

  it("is DST-correct across the US spring-forward (2026-03-08)", () => {
    // Day before the switch: EST (-5)
    expect(
      wallClockToUtc({ year: 2026, month: 3, day: 7, hour: 6 }, NY).toISOString(),
    ).toBe("2026-03-07T11:00:00.000Z");
    // Day of the switch, after 02:00 local: EDT (-4)
    expect(
      wallClockToUtc({ year: 2026, month: 3, day: 8, hour: 6 }, NY).toISOString(),
    ).toBe("2026-03-08T10:00:00.000Z");
  });

  it("resolves nonexistent local times (spring-forward gap) deterministically", () => {
    const d = wallClockToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, NY);
    // 02:30 local does not exist on 2026-03-08 in NY; the two-pass conversion
    // must land on one side of the gap without throwing.
    expect(["2026-03-08T06:30:00.000Z", "2026-03-08T07:30:00.000Z"]).toContain(d.toISOString());
  });
});

describe("parseHHmm", () => {
  it("parses valid times", () => {
    expect(parseHHmm("06:00")).toEqual({ hour: 6, minute: 0 });
    expect(parseHHmm("6:30")).toEqual({ hour: 6, minute: 30 });
    expect(parseHHmm("23:59")).toEqual({ hour: 23, minute: 59 });
  });

  it("falls back on invalid input", () => {
    expect(parseHHmm("24:00")).toEqual({ hour: 8, minute: 0 });
    expect(parseHHmm("nonsense")).toEqual({ hour: 8, minute: 0 });
    expect(parseHHmm(null)).toEqual({ hour: 8, minute: 0 });
    expect(parseHHmm(undefined, "06:15")).toEqual({ hour: 6, minute: 15 });
  });
});

describe("nextRunInZone — daily", () => {
  it("06:00 daily means 06:00 Asia/Ho_Chi_Minh: fires tomorrow when today's slot passed", () => {
    // 2026-07-04T01:00Z = 08:00 VN → today's 06:00 VN already passed
    const next = nextRunInZone({
      frequency: "daily",
      time: "06:00",
      timeZone: VN,
      after: new Date("2026-07-04T01:00:00Z"),
    });
    // 2026-07-05 06:00 VN
    expect(next.toISOString()).toBe("2026-07-04T23:00:00.000Z");
  });

  it("fires later today when the slot is still ahead", () => {
    // 2026-07-03T22:00Z = 05:00 VN on Jul 4 → today's 06:00 VN is 1h ahead
    const next = nextRunInZone({
      frequency: "daily",
      time: "06:00",
      timeZone: VN,
      after: new Date("2026-07-03T22:00:00Z"),
    });
    // 2026-07-04 06:00 VN
    expect(next.toISOString()).toBe("2026-07-03T23:00:00.000Z");
  });

  it("is strictly after `after` (exact-boundary instant advances a full day)", () => {
    const next = nextRunInZone({
      frequency: "daily",
      time: "06:00",
      timeZone: VN,
      after: new Date("2026-07-03T23:00:00Z"), // exactly 06:00 VN Jul 4
    });
    expect(next.toISOString()).toBe("2026-07-04T23:00:00.000Z");
  });
});

describe("nextRunInZone — weekly", () => {
  it("honors dayOfWeek in the factory zone", () => {
    // after = Sat 2026-07-04 08:00 VN; want Monday 06:00 VN → Mon Jul 6
    const next = nextRunInZone({
      frequency: "weekly",
      time: "06:00",
      dayOfWeek: 1,
      timeZone: VN,
      after: new Date("2026-07-04T01:00:00Z"),
    });
    expect(next.toISOString()).toBe("2026-07-05T23:00:00.000Z");
  });

  it("jumps a full week when today's target slot already passed", () => {
    // after = Sat 08:00 VN; target Saturday 06:00 already passed → next Saturday
    const next = nextRunInZone({
      frequency: "weekly",
      time: "06:00",
      dayOfWeek: 6,
      timeZone: VN,
      after: new Date("2026-07-04T01:00:00Z"),
    });
    expect(next.toISOString()).toBe("2026-07-10T23:00:00.000Z"); // Sat Jul 11, 06:00 VN
  });

  it("defaults dayOfWeek to the current factory weekday (advance-by-period)", () => {
    const next = nextRunInZone({
      frequency: "weekly",
      time: "06:00",
      timeZone: VN,
      after: new Date("2026-07-04T01:00:00Z"), // Sat 08:00 VN
    });
    expect(next.toISOString()).toBe("2026-07-10T23:00:00.000Z");
  });

  it("stays wall-clock-correct across a DST transition", () => {
    // after = Wed 2026-03-04 19:00 NY (EST); want Monday 06:00 NY.
    // Next Monday is Mar 9, AFTER the Mar 8 spring-forward → EDT (-4).
    const next = nextRunInZone({
      frequency: "weekly",
      time: "06:00",
      dayOfWeek: 1,
      timeZone: NY,
      after: new Date("2026-03-05T00:00:00Z"),
    });
    expect(next.toISOString()).toBe("2026-03-09T10:00:00.000Z");
  });
});

describe("nextRunInZone — monthly", () => {
  it("fires later this month when the day is still ahead", () => {
    const next = nextRunInZone({
      frequency: "monthly",
      time: "06:00",
      dayOfMonth: 31,
      timeZone: VN,
      after: new Date("2026-01-15T00:00:00Z"),
    });
    expect(next.toISOString()).toBe("2026-01-30T23:00:00.000Z"); // Jan 31 06:00 VN
  });

  it("clamps dayOfMonth to the target month length (31 → Feb 28)", () => {
    // after = Jan 31 09:00 VN (past 06:00) → next occurrence in February
    const next = nextRunInZone({
      frequency: "monthly",
      time: "06:00",
      dayOfMonth: 31,
      timeZone: VN,
      after: new Date("2026-01-31T02:00:00Z"),
    });
    expect(next.toISOString()).toBe("2026-02-27T23:00:00.000Z"); // Feb 28 06:00 VN
  });

  it("defaults dayOfMonth to the current factory day (advance one month)", () => {
    const next = nextRunInZone({
      frequency: "monthly",
      time: "06:00",
      timeZone: VN,
      after: new Date("2026-07-04T01:00:00Z"), // Jul 4 08:00 VN, 06:00 passed
    });
    expect(next.toISOString()).toBe("2026-08-03T23:00:00.000Z"); // Aug 4 06:00 VN
  });

  it("rolls over the year boundary", () => {
    const next = nextRunInZone({
      frequency: "monthly",
      time: "06:00",
      dayOfMonth: 15,
      timeZone: VN,
      after: new Date("2026-12-20T00:00:00Z"),
    });
    expect(next.toISOString()).toBe("2027-01-14T23:00:00.000Z"); // Jan 15 2027 06:00 VN
  });
});

describe("day bucketing helpers", () => {
  it("dayKeyInZone buckets by the factory wall date, not UTC", () => {
    // 18:30Z is already 01:30 the NEXT day in Vietnam
    expect(dayKeyInZone(new Date("2026-07-04T18:30:00Z"), VN)).toBe("2026-07-05");
    expect(dayKeyInZone(new Date("2026-07-04T10:00:00Z"), VN)).toBe("2026-07-04");
  });

  it("startOfDayInZone returns the UTC instant of factory-local midnight", () => {
    const d = startOfDayInZone(new Date("2026-07-04T18:30:00Z"), VN);
    expect(d.toISOString()).toBe("2026-07-04T17:00:00.000Z"); // Jul 5 00:00 VN
  });
});
