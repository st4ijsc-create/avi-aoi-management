/**
 * Materialized view refresh scheduler (QW3 / GAP G4).
 *
 * Periodically refreshes the `machine_status_latest` and `hourly_yield_cache`
 * materialized views via the `refresh_qw_caches()` SQL function.
 *
 * Disabled by default. Enable with MATVIEW_REFRESH_ENABLED=true once the
 * 0111 migration has been applied. Interval is configurable via
 * MATVIEW_REFRESH_INTERVAL_MS (default 60000ms).
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";

let timer: NodeJS.Timeout | null = null;

export function startMaterializedViewRefresh(): void {
  if (process.env.MATVIEW_REFRESH_ENABLED !== "true") {
    return; // feature-flagged off — no-op
  }
  if (timer) return;

  const intervalMs = Number(process.env.MATVIEW_REFRESH_INTERVAL_MS ?? 60000);

  const refresh = async () => {
    try {
      const db = await getDb();
      if (!db) return;
      await db.execute(sql`SELECT refresh_qw_caches()`);
    } catch (err: any) {
      console.error("[MatviewRefresh] refresh failed:", err?.message ?? err);
    }
  };

  // Kick off once, then on interval.
  void refresh();
  timer = setInterval(refresh, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[MatviewRefresh] enabled — refreshing every ${intervalMs}ms`);
}

export function stopMaterializedViewRefresh(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
