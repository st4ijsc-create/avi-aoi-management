/**
 * doc 44 W2-A1 / G2.1 — isa95Resolver unit tests (DB mocked).
 *
 *  - machine → full slugged ISA-95 path from the REAL hierarchy joins
 *  - missing intermediate levels → 'unassigned' + honest console.warn
 *  - machine/station not found → null (v2 publish skipped, nothing invented)
 *  - LRU/TTL cache: repeat resolution hits cache (ONE query), TTL expiry and
 *    invalidateIsa95ResolverCache() force a re-query
 *  - adapter id/code → machineId
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  execute: vi.fn(),
  dbAvailable: true,
}));

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => (h.dbAvailable ? { execute: h.execute } : null)),
}));

import {
  resolveIsa95Path,
  resolveIsa95PathByStation,
  resolveMachineIdByAdapterId,
  resolveMachineIdByAdapterCode,
  invalidateIsa95ResolverCache,
} from "./isa95Resolver";

const FULL_ROW = {
  machine_code: "AOI-01",
  station_code: "Cell 3",
  line_code: "Line 1",
  workshop_code: "Xưởng Lắp Ráp",
  factory_code: "HANOI",
};

beforeEach(() => {
  invalidateIsa95ResolverCache();
  h.execute.mockReset();
  h.dbAvailable = true;
  delete process.env.UNS_TOPIC_V2_CACHE_TTL_MS;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveIsa95Path (machine → station → line → workshop → factory)", () => {
  it("resolves the full slugged path from hierarchy codes", async () => {
    h.execute.mockResolvedValueOnce({ rows: [FULL_ROW] });
    const path = await resolveIsa95Path(5);
    expect(path).toEqual({
      site: "hanoi",
      area: "xuong-lap-rap",
      line: "line-1",
      cell: "cell-3",
      equipment: "aoi-01",
    });
  });

  it("missing levels → 'unassigned' + one honest warn (never fabricated)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.execute.mockResolvedValueOnce({
      rows: [{ ...FULL_ROW, line_code: null, workshop_code: null, factory_code: null }],
    });
    const path = await resolveIsa95Path(6);
    expect(path).toEqual({
      site: "unassigned",
      area: "unassigned",
      line: "unassigned",
      cell: "cell-3",
      equipment: "aoi-01",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/missing hierarchy level/);
    warn.mockRestore();
  });

  it("machine not found → null (+warn), cached", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.execute.mockResolvedValue({ rows: [] });
    expect(await resolveIsa95Path(999)).toBeNull();
    expect(await resolveIsa95Path(999)).toBeNull(); // cached null
    expect(h.execute).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("invalid ids / no DB → null without querying", async () => {
    expect(await resolveIsa95Path(0)).toBeNull();
    expect(await resolveIsa95Path(-3)).toBeNull();
    expect(await resolveIsa95Path(1.5 as any)).toBeNull();
    h.dbAvailable = false;
    expect(await resolveIsa95Path(5)).toBeNull();
    expect(h.execute).not.toHaveBeenCalled();
  });

  it("DB error → null, never throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    h.execute.mockRejectedValueOnce(new Error("boom"));
    await expect(resolveIsa95Path(5)).resolves.toBeNull();
    err.mockRestore();
  });

  it("cache: second call = ONE query; invalidate → re-query; TTL expiry → re-query", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T00:00:00Z"));
    h.execute.mockResolvedValue({ rows: [FULL_ROW] });

    await resolveIsa95Path(5);
    await resolveIsa95Path(5);
    expect(h.execute).toHaveBeenCalledTimes(1); // cache hit

    invalidateIsa95ResolverCache();
    await resolveIsa95Path(5);
    expect(h.execute).toHaveBeenCalledTimes(2); // explicit invalidation

    // TTL (default 5 min): advance past it → entry expired → re-query.
    vi.setSystemTime(new Date("2026-07-12T00:06:00Z"));
    await resolveIsa95Path(5);
    expect(h.execute).toHaveBeenCalledTimes(3);
  });
});

describe("resolveIsa95PathByStation (station → first active machine)", () => {
  it("resolves with the station's first active machine as equipment", async () => {
    h.execute.mockResolvedValueOnce({ rows: [FULL_ROW] });
    const path = await resolveIsa95PathByStation(3);
    expect(path?.equipment).toBe("aoi-01");
    expect(path?.cell).toBe("cell-3");
  });

  it("station with NO active machine → equipment 'unassigned' (+warn)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.execute.mockResolvedValueOnce({ rows: [{ ...FULL_ROW, machine_code: null }] });
    const path = await resolveIsa95PathByStation(3);
    expect(path?.equipment).toBe("unassigned");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("station not found → null", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.execute.mockResolvedValueOnce({ rows: [] });
    expect(await resolveIsa95PathByStation(404)).toBeNull();
    warn.mockRestore();
  });
});

describe("adapter → machineId resolution", () => {
  it("by adapter id (cached)", async () => {
    h.execute.mockResolvedValue({ rows: [{ machine_id: 12 }] });
    expect(await resolveMachineIdByAdapterId(10)).toBe(12);
    expect(await resolveMachineIdByAdapterId(10)).toBe(12);
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it("by adapter code; unmapped adapter (machineId null) → null", async () => {
    h.execute.mockResolvedValueOnce({ rows: [{ machine_id: null }] });
    expect(await resolveMachineIdByAdapterCode("ADP-X")).toBeNull();
    h.execute.mockResolvedValueOnce({ rows: [] });
    expect(await resolveMachineIdByAdapterCode("NOPE")).toBeNull();
    expect(await resolveMachineIdByAdapterCode("")).toBeNull();
  });
});
