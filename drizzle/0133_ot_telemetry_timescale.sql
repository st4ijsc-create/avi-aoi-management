-- ============================================================================
-- 0133 — DEFERRED: convert ot_telemetry to a TimescaleDB hypertable + CAGGs +
--        compression + retention (doc 12 §5 / P2).
--
-- ⚠️⚠️ DO NOT RUN until TimescaleDB is installed on the server ⚠️⚠️
--   This migration requires the `timescaledb` extension to be present in
--   pg_available_extensions. It is NOT part of the normal `drizzle migrate`
--   run — the standard pipeline applies 0132 (the plain canonical table) and
--   STOPS. An OPERATOR applies THIS file by hand, once, after installing
--   timescaledb on the Postgres server.
--
--   Verify availability first:
--     SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb';
--   If that returns no row, the extension is not installed — do not proceed.
--
-- The whole body is GUARDED + IDEMPOTENT: if timescaledb is unavailable it is a
-- no-op (RAISE NOTICE, no error), and create_hypertable / policies / CAGGs all
-- use if_not_exists so a re-run is safe.
--
-- ⚠️ On a populated DB take a backup and run off-peak: create_hypertable with
--    migrate_data => TRUE rewrites the table into chunks.
-- ============================================================================

DO $$
DECLARE has_ts boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') INTO has_ts;
  IF NOT has_ts THEN
    RAISE NOTICE '[0133] timescaledb extension not available — ot_telemetry left as a plain table. Install timescaledb then re-run this file.';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS timescaledb;

  -- ── Hypertable on `ts` ────────────────────────────────────────────────────
  -- A hypertable's partition column must be part of every unique index/PK. The
  -- plain table from 0132 has PRIMARY KEY (id); widen it to (id, ts) first.
  ALTER TABLE ot_telemetry DROP CONSTRAINT IF EXISTS ot_telemetry_pkey;
  ALTER TABLE ot_telemetry ADD PRIMARY KEY (id, "ts");

  PERFORM create_hypertable('ot_telemetry', 'ts',
    chunk_time_interval => INTERVAL '7 days',
    migrate_data       => TRUE,
    if_not_exists      => TRUE);

  -- ── Compression (segment by machineId/metric, order newest-first) ─────────
  ALTER TABLE ot_telemetry SET (
    timescaledb.compress,
    timescaledb.compress_orderby   = '"ts" DESC',
    timescaledb.compress_segmentby = '"machineId", "metric"');
  PERFORM add_compression_policy('ot_telemetry', INTERVAL '30 days', if_not_exists => TRUE);

  -- ── Retention: drop chunks (raw samples) older than 90 days ───────────────
  -- Choose ONE retention mechanism. Enabling this here means DISABLE the
  -- app-level dataRetentionService for ot_telemetry (do not run both).
  PERFORM add_retention_policy('ot_telemetry', INTERVAL '90 days', if_not_exists => TRUE);

  RAISE NOTICE '[0133] ot_telemetry is now a TimescaleDB hypertable (compression@30d, retention@90d).';
END $$;

-- ── Continuous aggregates (rollups of numeric samples) ──────────────────────
-- CAGGs must be created OUTSIDE the DO block (CREATE MATERIALIZED VIEW cannot run
-- inside a PL/pgSQL block). These statements assume timescaledb is installed; if
-- you reached here the guard above already confirmed it. Safe to re-run
-- (IF NOT EXISTS). They aggregate numValue per (machineId, metric) bucket.

-- 1-minute rollup (recent, high-resolution dashboards / SPC).
CREATE MATERIALIZED VIEW IF NOT EXISTS ot_telemetry_1m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket(INTERVAL '1 minute', "ts") AS bucket,
  "machineId",
  "metric",
  avg("numValue") AS avg_value,
  min("numValue") AS min_value,
  max("numValue") AS max_value,
  count(*)        AS sample_count
FROM ot_telemetry
WHERE "numValue" IS NOT NULL
GROUP BY bucket, "machineId", "metric"
WITH NO DATA;

-- 1-hour rollup (long-range trends / reports).
CREATE MATERIALIZED VIEW IF NOT EXISTS ot_telemetry_1h
WITH (timescaledb.continuous) AS
SELECT
  time_bucket(INTERVAL '1 hour', "ts") AS bucket,
  "machineId",
  "metric",
  avg("numValue") AS avg_value,
  min("numValue") AS min_value,
  max("numValue") AS max_value,
  count(*)        AS sample_count
FROM ot_telemetry
WHERE "numValue" IS NOT NULL
GROUP BY bucket, "machineId", "metric"
WITH NO DATA;

-- ── Refresh policies for the CAGGs (auto-incremental refresh) ────────────────
SELECT add_continuous_aggregate_policy('ot_telemetry_1m',
  start_offset      => INTERVAL '3 hours',
  end_offset        => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists     => TRUE);

SELECT add_continuous_aggregate_policy('ot_telemetry_1h',
  start_offset      => INTERVAL '3 days',
  end_offset        => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists     => TRUE);
