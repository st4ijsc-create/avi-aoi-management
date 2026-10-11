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

// doc 81 Đợt 7 task K4 — on dev the log said only "refresh failed: Failed query: SELECT refresh_qw_caches()": drizzle wraps
// the Postgres error in `cause`, and the service printed the wrapper. The real cause (42501 "permission denied for
// materialized view machine_status_latest" — the app role avi_app is not the owner and has no MAINTAIN) never reached the
// log nor db_feature_status. The service must surface the driver cause + SQLSTATE and, for 42501, name the fix.
describe("K4 — a failed refresh surfaces the Postgres cause, not drizzle's wrapper", () => {
  beforeEach(() => vi.clearAllMocks());

  function wrapped(): Error {
    const pg = Object.assign(new Error("permission denied for materialized view machine_status_latest"), {
      code: "42501",
      severity: "ERROR",
    });
    return new Error("Failed query: SELECT refresh_qw_caches()\nparams: ", { cause: pg });
  }

  it("lastError, console and db_feature_status carry the cause message and SQLSTATE", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.execute.mockRejectedValueOnce(wrapped()).mockResolvedValueOnce([]);

    const ok = await refreshQwCachesOnce();

    expect(ok).toBe(false);
    const info = getMatviewRefreshInfo();
    expect(info.lastError).toContain("permission denied for materialized view machine_status_latest");
    expect(info.lastError).toContain("42501");
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("permission denied for materialized view machine_status_latest");
    expect(logged).toContain("42501");
    const status = renderedQuery(mocks.execute.mock.calls[1]);
    const detail = status.params.find((p) => typeof p === "string" && p.includes("lastRefreshMs"));
    expect(JSON.parse(detail as string).error).toContain("permission denied for materialized view");
    spy.mockRestore();
  });

  it("42501 names the fix (MAINTAIN grant, migration 0366); another SQLSTATE does not", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.execute.mockRejectedValueOnce(wrapped()).mockResolvedValueOnce([]);
    await refreshQwCachesOnce();
    expect(getMatviewRefreshInfo().lastError).toMatch(/MAINTAIN.*0366|0366.*MAINTAIN/);

    const other = new Error("Failed query: SELECT refresh_qw_caches()", {
      cause: Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }),
    });
    mocks.execute.mockRejectedValueOnce(other).mockResolvedValueOnce([]);
    await refreshQwCachesOnce();
    const e = getMatviewRefreshInfo().lastError ?? "";
    expect(e).toContain("canceling statement due to statement timeout");
    expect(e).toContain("57014");
    expect(e).not.toContain("0366");
    spy.mockRestore();
  });
});
