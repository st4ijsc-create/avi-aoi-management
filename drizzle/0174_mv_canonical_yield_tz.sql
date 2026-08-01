-- ============================================================================
-- Migration 0174 (doc 27 W1-C — gaps A2/A4, §11 decision #4):
-- Recreate the hourly_yield_cache materialized view (from 0111) with
--   1. CANONICAL final-yield math: NTF counts as PASS → (ok + ntf) / total
--      (0111 used ok / total — one of the three divergent yield formulas).
--   2. FACTORY-TIMEZONE hour bucketing instead of raw/UTC-session buckets.
--
-- Timezone configuration (mirrors server/utils/kpi.ts):
--   * factory_timezone():    GUC app.factory_tz,         default 'Asia/Ho_Chi_Minh'
--   * db_storage_timezone(): GUC app.factory_storage_tz, default 'UTC'.
--     The app's canonical write path (drizzle typed inserts, incl. machine
--     ingest) serializes Dates via toISOString(), so the naive `timestamp`
--     columns hold UTC wall time (verified 2026-07-04). Legacy rows written
--     by raw-driver/seed scripts may hold local (+07) wall time instead —
--     for a dataset that is predominantly local-wall, set:
--        ALTER DATABASE <db> SET app.factory_storage_tz = 'Asia/Ho_Chi_Minh';
--   To change the factory timezone:
--        ALTER DATABASE <db> SET app.factory_tz = '<IANA name>';
--   Keep these in sync with the FACTORY_TZ / FACTORY_DB_STORAGE_TZ envs.
--
-- Idempotent. Safe to re-run. The refresh function refresh_qw_caches() from
-- 0111 keeps working (it references the view by name).
-- ============================================================================

-- NOTE: all cross-references are schema-qualified (public.*) because
-- CREATE/REFRESH MATERIALIZED VIEW execute the query as a
-- security-restricted operation with a minimal search_path — unqualified
-- function calls inside SQL function bodies would fail there.

CREATE OR REPLACE FUNCTION public.factory_timezone() RETURNS text
LANGUAGE sql STABLE AS $factory_tz$
  SELECT COALESCE(NULLIF(current_setting('app.factory_tz', true), ''), 'Asia/Ho_Chi_Minh');
$factory_tz$;

CREATE OR REPLACE FUNCTION public.db_storage_timezone() RETURNS text
LANGUAGE sql STABLE AS $storage_tz$
  SELECT COALESCE(NULLIF(current_setting('app.factory_storage_tz', true), ''), 'UTC');
$storage_tz$;

-- Naive stored timestamp -> factory-local naive wall time.
CREATE OR REPLACE FUNCTION public.to_factory_time(ts timestamp) RETURNS timestamp
LANGUAGE sql STABLE AS $to_factory$
  SELECT (ts AT TIME ZONE public.db_storage_timezone()) AT TIME ZONE public.factory_timezone();
$to_factory$;

DROP MATERIALIZED VIEW IF EXISTS hourly_yield_cache;

CREATE MATERIALIZED VIEW hourly_yield_cache AS
SELECT
  pi."machineId"                                                  AS machine_id,
  date_trunc('hour', public.to_factory_time(pi."inspectionTime")) AS bucket_hour,
  COUNT(*)                                                    AS total,
  COUNT(*) FILTER (WHERE pi."overallResult" = 'OK')           AS ok,
  COUNT(*) FILTER (WHERE pi."overallResult" = 'NG')           AS ng,
  COUNT(*) FILTER (WHERE pi."overallResult" = 'NTF')          AS ntf,
  -- CANONICAL final yield (decision #4): NTF counts as PASS.
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE pi."overallResult" IN ('OK', 'NTF'))
    / NULLIF(COUNT(*), 0), 2
  )                                                           AS yield_rate
FROM product_inspections pi
GROUP BY 1, 2;

-- Unique index is required for REFRESH ... CONCURRENTLY (same key as 0111).
CREATE UNIQUE INDEX IF NOT EXISTS idx_hourly_yield_cache_key
  ON hourly_yield_cache (machine_id, bucket_hour);
