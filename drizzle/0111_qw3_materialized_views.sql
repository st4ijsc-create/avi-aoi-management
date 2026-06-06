-- 0111 QW3: Materialized views to offload hot dashboard reads (GAP G4/G9)
-- Idempotent. Safe to re-run.

-- ============================================================
-- machine_status_latest: latest connection status per machine
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS machine_status_latest AS
SELECT DISTINCT ON (sl."machineId")
  sl."machineId" AS machine_id,
  sl.status      AS status,
  sl."ipAddress" AS ip_address,
  sl."timestamp" AS status_at
FROM machine_status_logs sl
ORDER BY sl."machineId", sl."timestamp" DESC;

-- Unique index is required for REFRESH ... CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS idx_machine_status_latest_machine
  ON machine_status_latest (machine_id);

-- ============================================================
-- hourly_yield_cache: per machine / per hour inspection rollup
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS hourly_yield_cache AS
SELECT
  pi."machineId"                          AS machine_id,
  date_trunc('hour', pi."inspectionTime") AS bucket_hour,
  COUNT(*)                                                  AS total,
  COUNT(*) FILTER (WHERE pi."overallResult" = 'OK')         AS ok,
  COUNT(*) FILTER (WHERE pi."overallResult" = 'NG')         AS ng,
  COUNT(*) FILTER (WHERE pi."overallResult" = 'NTF')        AS ntf,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE pi."overallResult" = 'OK')
    / NULLIF(COUNT(*), 0), 2
  )                                                         AS yield_rate
FROM product_inspections pi
GROUP BY pi."machineId", date_trunc('hour', pi."inspectionTime");

CREATE UNIQUE INDEX IF NOT EXISTS idx_hourly_yield_cache_key
  ON hourly_yield_cache (machine_id, bucket_hour);

-- ============================================================
-- refresh_qw_caches(): refresh both caches. Falls back to a
-- non-concurrent refresh the first time (before views are populated).
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_qw_caches() RETURNS void AS $$
BEGIN
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY machine_status_latest;
  EXCEPTION WHEN OTHERS THEN
    REFRESH MATERIALIZED VIEW machine_status_latest;
  END;
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY hourly_yield_cache;
  EXCEPTION WHEN OTHERS THEN
    REFRESH MATERIALIZED VIEW hourly_yield_cache;
  END;
END;
$$ LANGUAGE plpgsql;
