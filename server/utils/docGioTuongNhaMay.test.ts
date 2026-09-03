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
