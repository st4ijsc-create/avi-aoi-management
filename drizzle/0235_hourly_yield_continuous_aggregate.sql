-- ============================================================================
-- Migration 0235: hourly-yield TimescaleDB CONTINUOUS AGGREGATE — doc 38 Đợt S (P0-B).
--
-- WHY: hourly_yield_cache (0111/0174) is a plain PostgreSQL materialized view that
-- REFRESH ... CONCURRENTLY rescans ALL of product_inspections every 5 minutes
-- (materializedViewRefreshService.ts). At ~180M rows/year that full rescan competes
-- with ingest I/O. A TimescaleDB continuous aggregate refreshes INCREMENTALLY — only
-- the chunks whose data changed — so cost is bounded by recent activity, not table size.
--
-- GUARDED + ADDITIVE + IDEMPOTENT (mirrors 0172's pattern):
--   * Runs the CAgg body ONLY when the timescaledb extension is installed AND
--     product_inspections is already a hypertable (i.e. AFTER the 0172 cutover —
--     see scripts/migrate-to-timescaledb.md). Otherwise it RAISEs a NOTICE, records
--     db_feature_status, and no-ops — applying it on plain PostgreSQL changes nothing.
--   * Does NOT drop or alter hourly_yield_cache. The matview stays as the read source
--     until the owner has validated the CAgg (timezone bucketing differs — see below),
--     so this migration is safe to apply pre-validation and never breaks dashboards.
--
-- TIMEZONE CAVEAT (read before switching the dashboard read-path):
--   hourly_yield_cache buckets by FACTORY-LOCAL hour via to_factory_time() (0174).
--   A continuous aggregate must bucket on the raw hypertable time column with
--   time_bucket(); Timescale's timezone-aware time_bucket() needs a timestamptz
--   column, but product_inspections."inspectionTime" is a naive timestamp holding
--   UTC wall time. This CAgg therefore buckets by UTC hour. For a factory not on UTC
--   the hour boundaries differ from the matview by the UTC offset. Options for the
--   read-path swap (a follow-up, NOT done here):
--     (a) keep bucketing UTC in the CAgg and convert/re-bucket at read time, or
--     (b) migrate inspectionTime to timestamptz and use
--         time_bucket('1 hour', "inspectionTime", 'Asia/Ho_Chi_Minh').
--   Yield MATH is identical to 0174 (NTF counts as PASS).
-- ============================================================================

DO $mig$
DECLARE
  has_ts    boolean;
  is_hyper  boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') INTO has_ts;

  IF NOT has_ts THEN
    RAISE NOTICE '[0235] timescaledb extension not installed — skipping continuous aggregate (plain-PG no-op). Run after the cutover in scripts/migrate-to-timescaledb.md.';
    INSERT INTO db_feature_status (feature, status, detail, checked_at)
    VALUES ('cagg_hourly_yield', 'missing',
            'timescaledb not installed — hourly_yield_cache matview remains the active source (full-refresh). CAgg pending cutover.',
            now())
    ON CONFLICT (feature) DO UPDATE SET status = EXCLUDED.status, detail = EXCLUDED.detail, checked_at = EXCLUDED.checked_at;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM timescaledb_information.hypertables
    WHERE hypertable_name = 'product_inspections'
  ) INTO is_hyper;

  IF NOT is_hyper THEN
    RAISE NOTICE '[0235] product_inspections is not a hypertable yet — apply 0172 first. Skipping CAgg.';
    INSERT INTO db_feature_status (feature, status, detail, checked_at)
    VALUES ('cagg_hourly_yield', 'missing',
            'product_inspections not a hypertable (0172 not applied) — CAgg pending.',
            now())
    ON CONFLICT (feature) DO UPDATE SET status = EXCLUDED.status, detail = EXCLUDED.detail, checked_at = EXCLUDED.checked_at;
    RETURN;
  END IF;

  -- ── Continuous aggregate (incremental hourly yield, UTC bucket) ────────────
  -- CREATE MATERIALIZED VIEW ... WITH (timescaledb.continuous) cannot run inside a
  -- transaction block on some Timescale versions; if your runner wraps files in a
  -- transaction, run this file standalone (psql -f, no -1). Guarded by IF NOT EXISTS
  -- via the catalog check below to stay idempotent.
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.continuous_aggregates
    WHERE view_name = 'hourly_yield_cagg'
  ) THEN
    EXECUTE $cagg$
      CREATE MATERIALIZED VIEW hourly_yield_cagg
      WITH (timescaledb.continuous) AS
      SELECT
        pi."machineId"                                             AS machine_id,
        time_bucket(INTERVAL '1 hour', pi."inspectionTime")        AS bucket_hour,
        COUNT(*)                                                   AS total,
        COUNT(*) FILTER (WHERE pi."overallResult" = 'OK')          AS ok,
        COUNT(*) FILTER (WHERE pi."overallResult" = 'NG')          AS ng,
        COUNT(*) FILTER (WHERE pi."overallResult" = 'NTF')         AS ntf,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE pi."overallResult" IN ('OK','NTF'))
          / NULLIF(COUNT(*), 0), 2
        )                                                          AS yield_rate
      FROM product_inspections pi
      GROUP BY 1, 2
      WITH NO DATA;
    $cagg$;

    -- Incremental refresh policy: keep the last 90 days fresh, refresh hourly,
    -- exclude the most recent 1h (still being written). Tune to workload.
    PERFORM add_continuous_aggregate_policy('hourly_yield_cagg',
      start_offset => INTERVAL '90 days',
      end_offset   => INTERVAL '1 hour',
      schedule_interval => INTERVAL '1 hour');

    RAISE NOTICE '[0235] continuous aggregate hourly_yield_cagg created (WITH NO DATA). Run CALL refresh_continuous_aggregate(''hourly_yield_cagg'', NULL, NULL); to backfill.';
  END IF;

  INSERT INTO db_feature_status (feature, status, detail, checked_at)
  VALUES ('cagg_hourly_yield', 'ok',
          'hourly_yield_cagg continuous aggregate present (UTC bucket). Validate timezone vs hourly_yield_cache matview before swapping the dashboard read-path.',
          now())
  ON CONFLICT (feature) DO UPDATE SET status = EXCLUDED.status, detail = EXCLUDED.detail, checked_at = EXCLUDED.checked_at;
END $mig$;
