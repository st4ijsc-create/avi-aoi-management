/**
 * W4-B (doc 27 A7) — the MV refresh service must run refresh_qw_caches()
 * (0111 fn, CONCURRENTLY with fallback; body of hourly_yield_cache is the
 * canonical+TZ 0174 version) and record a TZ-proof epoch-ms completion
 * marker in db_feature_status for cross-process freshness checks.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const execute = vi.fn();
  return { execute, getJobsDb: vi.fn(async () => ({ execute })) };
});

vi.mock("./db/connection", () => ({
  getDb: mocks.getJobsDb,
  getJobsDb: mocks.getJobsDb,
}));

import { PgDialect } from "drizzle-orm/pg-core";
import {
  getMatviewRefreshInfo,
  getMatviewRefreshIntervalMs,
  refreshQwCachesOnce,
} from "./services/materializedViewRefreshService";

const dialect = new PgDialect();
function renderedQuery(call: unknown[]): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(call[0] as any);
}

describe("materializedViewRefreshService (A7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MATVIEW_REFRESH_INTERVAL_MS;
  });

  it("default cadence is 5 minutes; env override wins", () => {
    expect(getMatviewRefreshIntervalMs()).toBe(300_000);
    process.env.MATVIEW_REFRESH_INTERVAL_MS = "120000";
    expect(getMatviewRefreshIntervalMs()).toBe(120_000);
  });

  it("successful refresh calls refresh_qw_caches() and records epoch-ms status", async () => {
    mocks.execute.mockResolvedValue([]);

    const ok = await refreshQwCachesOnce();

    expect(ok).toBe(true);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(renderedQuery(mocks.execute.mock.calls[0]).sql).toContain("refresh_qw_caches");
    const status = renderedQuery(mocks.execute.mock.calls[1]);
    expect(status.sql).toContain("db_feature_status");

    const info = getMatviewRefreshInfo();
    expect(info.lastRefreshAt).toBeInstanceOf(Date);
    expect(info.lastError).toBeNull();
    // the detail param carries a numeric lastRefreshMs (TZ-proof)
    const detailParam = status.params.find((p) => typeof p === "string" && p.includes("lastRefreshMs"));
    expect(detailParam).toBeDefined();
    expect(JSON.parse(detailParam as string).lastRefreshMs).toBeTypeOf("number");
  });

  it("failed refresh records the error and returns false", async () => {
    mocks.execute
      .mockRejectedValueOnce(new Error("relation refresh_qw_caches does not exist"))
      .mockResolvedValueOnce([]); // status upsert

    const ok = await refreshQwCachesOnce();

    expect(ok).toBe(false);
    const info = getMatviewRefreshInfo();
    expect(info.lastError).toMatch(/does not exist/);
  });
});
