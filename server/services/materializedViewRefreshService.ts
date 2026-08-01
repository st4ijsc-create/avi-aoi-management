/**
 * Materialized view refresh scheduler (QW3 / GAP G4 — upgraded by W4-B for
 * doc 27 gap A7).
 *
 * Periodically refreshes the `machine_status_latest` and `hourly_yield_cache`
 * materialized views via the `refresh_qw_caches()` SQL function (created in
 * 0111; the hourly_yield_cache body was recreated canonical+factory-TZ by
 * 0174 — refresh_qw_caches references the view BY NAME so it keeps working,
 * and uses REFRESH ... CONCURRENTLY with a non-concurrent first-run
 * fallback).
 *
 * Enable with MATVIEW_REFRESH_ENABLED=true. Interval is configurable via
 * MATVIEW_REFRESH_INTERVAL_MS (default 300000ms = 5 min — the dashboard
 * read path in functions/cachedStatistics treats the MV as FRESH only when
 * the last successful refresh is younger than 2× this interval, falling
 * back to the live query otherwise, so data is never silently stale beyond
 * that threshold).
 *
 * After every successful refresh the completion time is recorded
 *  (a) in-process (getMatviewRefreshInfo — used by same-process readers) and
 *  (b) in db_feature_status (feature 'matview_refresh_qw', detail JSON with
 *      epoch ms — TZ-proof) so readers in OTHER processes/workers can check
 *      freshness too.
 */
import { sql } from "drizzle-orm";
// W4-D (doc 27 §8 B5): matview refreshes can hold connections for a while —
// route them through the dedicated background-jobs pool (DB_POOL_MAX_JOBS).
import { getJobsDb as getDb } from "../db/connection";

export const MATVIEW_STATUS_FEATURE = "matview_refresh_qw";

const DEFAULT_INTERVAL_MS = 300_000; // 5 minutes

let timer: NodeJS.Timeout | null = null;
let lastRefreshAt: Date | null = null;
let lastError: string | null = null;
let statusTableWarned = false;

export function getMatviewRefreshIntervalMs(): number {
  const raw = Number(process.env.MATVIEW_REFRESH_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INTERVAL_MS;
}

export function getMatviewRefreshInfo(): {
  enabled: boolean;
  intervalMs: number;
  lastRefreshAt: Date | null;
  lastError: string | null;
} {
  return {
    enabled: process.env.MATVIEW_REFRESH_ENABLED === "true",
    intervalMs: getMatviewRefreshIntervalMs(),
    lastRefreshAt,
    lastError,
  };
}

async function recordRefreshStatus(ok: boolean, detailError?: string): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const detail = JSON.stringify({
      lastRefreshMs: ok ? Date.now() : lastRefreshAt?.getTime() ?? null,
      intervalMs: getMatviewRefreshIntervalMs(),
      ...(detailError ? { error: detailError.slice(0, 500) } : {}),
    });
    await db.execute(sql`
      INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
      VALUES (${MATVIEW_STATUS_FEATURE}, ${ok ? "ok" : "error"}, ${detail}, now())
      ON CONFLICT ("feature") DO UPDATE
        SET "status" = EXCLUDED."status",
            "detail" = EXCLUDED."detail",
            "checkedAt" = EXCLUDED."checkedAt"
    `);
  } catch (err: any) {
    // db_feature_status ships with migration 0172 — only warn once if absent.
    if (!statusTableWarned) {
      statusTableWarned = true;
      console.warn(
        "[MatviewRefresh] could not record refresh status (db_feature_status missing? apply 0172):",
        err?.message ?? err,
      );
    }
  }
}

/** One refresh cycle; exported for tests and manual triggering. */
export async function refreshQwCachesOnce(): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    await db.execute(sql`SELECT refresh_qw_caches()`);
    lastRefreshAt = new Date();
    lastError = null;
    await recordRefreshStatus(true);
    return true;
  } catch (err: any) {
    lastError = String(err?.message ?? err);
    console.error("[MatviewRefresh] refresh failed:", lastError);
    await recordRefreshStatus(false, lastError);
    return false;
  }
}

export function startMaterializedViewRefresh(): void {
  if (process.env.MATVIEW_REFRESH_ENABLED !== "true") {
    return; // feature-flagged off — no-op
  }
  if (timer) return;

  const intervalMs = getMatviewRefreshIntervalMs();

  // Kick off once, then on interval.
  void refreshQwCachesOnce();
  timer = setInterval(() => void refreshQwCachesOnce(), intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[MatviewRefresh] enabled — refreshing every ${intervalMs}ms`);
}

export function stopMaterializedViewRefresh(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
