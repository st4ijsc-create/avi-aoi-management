/**
 * Tests for `docGioTuongNhaMay` (server/utils/factoryTime.ts) — BG-96 (spec Khối
 * C QĐ-1). Reads a user-typed date/time string as FACTORY wall-clock time and
 * returns the real UTC instant, replacing the old fake-UTC trick
 * (`d.getTime() - d.getTimezoneOffset()*60000`, which depended on the
 * PROCESS's timezone, not the factory's).
 *
 * `FACTORY_TZ` is pinned via `vi.stubEnv` so these tests pass identically on
 * any host timezone (UTC CI box, Windows dev box, etc).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { docGioTuongNhaMay } from "./factoryTime";
import { resolveFactoryDateWindow } from "./kpi";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("docGioTuongNhaMay", () => {
  it("date-only string → factory-local midnight, as UTC", () => {
    vi.stubEnv("FACTORY_TZ", "Asia/Ho_Chi_Minh");
    const d = docGioTuongNhaMay("2026-09-03");
    expect(d?.toISOString()).toBe("2026-09-02T17:00:00.000Z");
  });

  it("date-only string + endOfDay → factory-local 23:59:59.999, as UTC", () => {
    vi.stubEnv("FACTORY_TZ", "Asia/Ho_Chi_Minh");
    const d = docGioTuongNhaMay("2026-09-03", true);
    expect(d?.toISOString()).toBe("2026-09-03T16:59:59.999Z");
  });

  it("date+time string (no zone) → interpreted as factory-local wall clock", () => {
    vi.stubEnv("FACTORY_TZ", "Asia/Ho_Chi_Minh");
    const d = docGioTuongNhaMay("2026-09-03T08:30:00");
    expect(d?.toISOString()).toBe("2026-09-03T01:30:00.000Z");
  });

  it("string with explicit 'Z' offset is passed through unchanged (caller already named the frame)", () => {
    vi.stubEnv("FACTORY_TZ", "Asia/Ho_Chi_Minh");
    const d = docGioTuongNhaMay("2026-09-03T08:30:00Z");
    expect(d?.toISOString()).toBe(new Date("2026-09-03T08:30:00Z").toISOString());
  });

  it("empty string → undefined", () => {
    vi.stubEnv("FACTORY_TZ", "Asia/Ho_Chi_Minh");
    expect(docGioTuongNhaMay("")).toBeUndefined();
  });

  it("garbage string → undefined", () => {
    vi.stubEnv("FACTORY_TZ", "Asia/Ho_Chi_Minh");
    expect(docGioTuongNhaMay("rác")).toBeUndefined();
  });

  it("đối chứng: cùng ngày, khớp resolveFactoryDateWindow(...).start", () => {
    vi.stubEnv("FACTORY_TZ", "Asia/Ho_Chi_Minh");
    const fromHelper = docGioTuongNhaMay("2026-09-03");
    const fromWindow = resolveFactoryDateWindow("2026-09-03", "2026-09-03").start;
    expect(fromHelper?.getTime()).toBe(fromWindow.getTime());
  });
});

/**
 * doc 81 Đợt 4 Task B5 — `docGioTuongNhaMay` dùng LUẬT CHUNG `coMuiGioTuongMinh` (thay regex `Z$|[+-]\d{2}:?\d{2}$` cũ).
 * Regex cũ coi đuôi `-2026` của ngày kiểu Mỹ `"09-28-2026"` là OFFSET (cùng lỗi M2 đã vá ở coMuiGioTuongMinh) ⇒
 * `new Date(s)` đọc theo nửa đêm TZ TIẾN TRÌNH (UTC trong container, +07 trên máy dev) và bỏ qua endOfDay. Nay: chuỗi
 * không có múi giờ tường minh ⇒ giờ TƯỜNG NHÀ MÁY, độc lập TZ tiến trình. Oracle: instant tính tay theo FACTORY_TZ.
 */
describe("B5 — '09-28-2026' is a FACTORY wall-clock date, not an offset", () => {
  const savedTz = process.env.TZ;
  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  for (const processTz of ["UTC", "America/New_York", "Asia/Bangkok"]) {
    it(`process TZ ${processTz}: '09-28-2026' ⇒ factory midnight; endOfDay ⇒ factory 23:59:59.999`, () => {
      process.env.TZ = processTz;
      vi.stubEnv("FACTORY_TZ", "Asia/Ho_Chi_Minh");
      expect(docGioTuongNhaMay("09-28-2026")?.toISOString()).toBe("2026-09-27T17:00:00.000Z");
      expect(docGioTuongNhaMay("09-28-2026", true)?.toISOString()).toBe("2026-09-28T16:59:59.999Z");
      // a naive non-ISO date + time is factory wall clock too
      expect(docGioTuongNhaMay("09-28-2026 08:30")?.toISOString()).toBe("2026-09-28T01:30:00.000Z");
    });
  }

  it("★ fix 1 (R-4-s #9): an alphabetic zone abbreviation names the frame — parsed as before B5 (process TZ irrelevant)", () => {
    process.env.TZ = "UTC";
    vi.stubEnv("FACTORY_TZ", "Asia/Ho_Chi_Minh");
    expect(docGioTuongNhaMay("Sep 28 2026 08:30 EST")?.toISOString()).toBe("2026-09-28T13:30:00.000Z");
    expect(docGioTuongNhaMay("Sep 28 2026 08:30 PDT")?.toISOString()).toBe("2026-09-28T15:30:00.000Z");
    // fix 2 (N4): a zone + short offset is a designator too (V8 parses it; process TZ irrelevant)
    expect(docGioTuongNhaMay("Sep 28 2026 08:30 UTC+7")?.toISOString()).toBe("2026-09-28T01:30:00.000Z");
    expect(docGioTuongNhaMay("Sep 28 2026 08:30 GMT+7")?.toISOString()).toBe("2026-09-28T01:30:00.000Z");
    process.env.TZ = "America/New_York";
    expect(docGioTuongNhaMay("Sep 28 2026 08:30 GMT+7")?.toISOString()).toBe("2026-09-28T01:30:00.000Z");
    process.env.TZ = "UTC";
    // AM/PM is not a zone: still factory wall clock (20:30 +07 ⇒ 13:30Z)
    expect(docGioTuongNhaMay("09-28-2026 08:30 PM")?.toISOString()).toBe("2026-09-28T13:30:00.000Z");
  });

  it("explicit offsets still pass straight through (same rule as coMuiGioTuongMinh)", () => {
    vi.stubEnv("FACTORY_TZ", "Asia/Ho_Chi_Minh");
    expect(docGioTuongNhaMay("2026-09-28T08:30:00+07:00")?.toISOString()).toBe("2026-09-28T01:30:00.000Z");
    expect(docGioTuongNhaMay("2026-09-28T08:30:00-0500")?.toISOString()).toBe("2026-09-28T13:30:00.000Z");
    expect(docGioTuongNhaMay("Mon Sep 28 2026 08:30:00 GMT+0700 (Indochina Time)")?.toISOString()).toBe("2026-09-28T01:30:00.000Z");
  });
});
