/**
 * W4-B (doc 27 A7) — hourly_yield_cache MV read path: freshness gate,
 * live-fallback rules, and exact wire-shape parity with db.getHourlyStats.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const execute = vi.fn();
  return {
    execute,
    getDb: vi.fn(async () => ({ execute })),
    refreshInfo: {
      enabled: true,
      intervalMs: 300_000,
      lastRefreshAt: null as Date | null,
      lastError: null as string | null,
    },
  };
});

vi.mock("./db", () => ({}));
vi.mock("./db/connection", () => ({
  getDb: mocks.getDb,
  getJobsDb: mocks.getDb,
}));
vi.mock("./services/materializedViewRefreshService", () => ({
  MATVIEW_STATUS_FEATURE: "matview_refresh_qw",
  getMatviewRefreshIntervalMs: () => mocks.refreshInfo.intervalMs,
  getMatviewRefreshInfo: () => ({ ...mocks.refreshInfo }),
}));

import {
  __resetMvFreshnessMemo,
  getHourlyStatsViaMV,
  getHourlyYieldFromMV,
  getMvFreshness,
} from "./functions/cachedStatistics";

const MV_ROWS = [
  { hour: "2026-07-04 07:00", total: 100, ok: 90, ng: 5, ntf: 5 },
  { hour: "2026-07-04 08:00", total: 50, ok: 40, ng: 10, ntf: 0 },
];
const FPY_ROWS = [
  { bucket: "2026-07-04 07:00", first_pass: 80, first_total: 100 },
  { bucket: "2026-07-04 08:00", first_pass: 30, first_total: 50 },
];

describe("A7 — MV read path with freshness fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetMvFreshnessMemo();
    mocks.refreshInfo.lastRefreshAt = null;
    mocks.refreshInfo.intervalMs = 300_000;
  });

  it("FRESH MV (refresh < 2× interval): serves rows in the exact live wire shape", async () => {
    mocks.refreshInfo.lastRefreshAt = new Date(Date.now() - 60_000); // 1 min ago
    mocks.execute
      .mockResolvedValueOnce(MV_ROWS) // MV rollup query
      .mockResolvedValueOnce(FPY_ROWS); // live FPY query (not derivable from MV)

    const rows = await getHourlyStatsViaMV({ hours: 24 });

    expect(rows).not.toBeNull();
    expect(rows).toEqual([
      { hour: "2026-07-04 07:00", total: 100, ok: 90, ng: 5, ntf: 5, fpy: "80.0", fy: "95.0", ntfy: "5.0" },
      { hour: "2026-07-04 08:00", total: 50, ok: 40, ng: 10, ntf: 0, fpy: "60.0", fy: "80.0", ntfy: "0.0" },
    ]);
    // 2 queries: MV scan + FPY. The raw-table counts scan is gone.
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("STALE MV (refresh older than 2× interval): returns null WITHOUT querying — caller must go live", async () => {
    mocks.refreshInfo.lastRefreshAt = new Date(Date.now() - 20 * 60_000); // 20 min > 10 min threshold
    const rows = await getHourlyStatsViaMV({ hours: 24 });
    expect(rows).toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("UNKNOWN freshness (no in-process refresh, no db_feature_status row): null → live fallback", async () => {
    mocks.execute.mockResolvedValueOnce([]); // db_feature_status lookup finds nothing
    const rows = await getHourlyStatsViaMV({ hours: 24 });
    expect(rows).toBeNull();
    expect(mocks.execute).toHaveBeenCalledTimes(1); // only the freshness lookup
  });

  it("cross-process freshness: reads epoch-ms from db_feature_status detail JSON", async () => {
    mocks.execute
      .mockResolvedValueOnce([
        { detail: JSON.stringify({ lastRefreshMs: Date.now() - 30_000, intervalMs: 300_000 }) },
      ])
      .mockResolvedValueOnce(MV_ROWS)
      .mockResolvedValueOnce(FPY_ROWS);

    const rows = await getHourlyStatsViaMV({ hours: 24 });
    expect(rows).not.toBeNull();
    expect(rows!.length).toBe(2);
  });

  it("hierarchy filters (factoryId/workshopId/lineId) are not MV-representable → null, no queries", async () => {
    mocks.refreshInfo.lastRefreshAt = new Date();
    expect(await getHourlyStatsViaMV({ factoryId: 1 })).toBeNull();
    expect(await getHourlyStatsViaMV({ workshopId: 2 })).toBeNull();
    expect(await getHourlyStatsViaMV({ lineId: 3 })).toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("machineId filter IS representable and is pushed into both queries", async () => {
    mocks.refreshInfo.lastRefreshAt = new Date();
    mocks.execute.mockResolvedValueOnce([MV_ROWS[0]]).mockResolvedValueOnce([FPY_ROWS[0]]);
    const rows = await getHourlyStatsViaMV({ machineId: 12, hours: 6 });
    expect(rows).toHaveLength(1);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("MV query failure (0111/0174 not applied) degrades to null instead of throwing", async () => {
    mocks.refreshInfo.lastRefreshAt = new Date();
    mocks.execute.mockRejectedValueOnce(new Error('relation "hourly_yield_cache" does not exist'));
    const rows = await getHourlyStatsViaMV({ hours: 24 });
    expect(rows).toBeNull();
  });

  it("getHourlyYieldFromMV exposes freshness metadata (last refresh age vs threshold)", async () => {
    mocks.refreshInfo.lastRefreshAt = new Date(Date.now() - 90_000);
    mocks.execute.mockResolvedValueOnce(MV_ROWS);

    const result = await getHourlyYieldFromMV({ hours: 24 });
    expect(result).not.toBeNull();
    expect(result!.freshness.thresholdMs).toBe(600_000);
    expect(result!.freshness.ageMs).toBeGreaterThanOrEqual(90_000);
    expect(result!.freshness.ageMs).toBeLessThan(600_000);
    // canonical final yield: NTF counts as pass
    expect(result!.rows[0].yieldRate).toBe(95);
  });

  it("getMvFreshness is null when stale and non-null when fresh", async () => {
    mocks.refreshInfo.lastRefreshAt = new Date(Date.now() - 11 * 60_000);
    expect(await getMvFreshness()).toBeNull();

    mocks.refreshInfo.lastRefreshAt = new Date(Date.now() - 60_000);
    expect(await getMvFreshness()).not.toBeNull();
  });
});
