-- ============================================================================
-- Phase 1 WS1.1b — TimescaleDB hypertables on the MAIN database.
-- Converts high-volume time-series tables to hypertables with composite PKs
-- (id + time column) and enables native compression.
--
-- SAFE & IDEMPOTENT:
--   * Guarded: if the timescaledb extension is not AVAILABLE on the server,
--     the whole block is a no-op (RAISE NOTICE) — never errors a deploy.
--   * create_hypertable(..., migrate_data => TRUE, if_not_exists => TRUE) so it
--     can run against existing data and is safe to re-run.
--   * Retention (chunk dropping = data deletion) is intentionally LEFT COMMENTED.
--     Choose ONE retention mechanism: native add_retention_policy() below, OR
--     the app-level dataRetentionService (DATA_RETENTION_ENABLED). Do not run both.
--
-- ⚠️ Before applying to a populated production DB: take a backup and run in an
--    off-peak window — migrate_data rewrites the table into chunks.
-- ============================================================================

DO $$
DECLARE has_ts boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') INTO has_ts;
  IF NOT has_ts THEN
    RAISE NOTICE '[0118] timescaledb extension not available on this server — skipping hypertable conversion.';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS timescaledb;

  -- ── ot_telemetry (partition: timestamp; segment: adapterId) ───────────────
  ALTER TABLE ot_telemetry DROP CONSTRAINT IF EXISTS ot_telemetry_pkey;
  ALTER TABLE ot_telemetry ADD PRIMARY KEY (id, "timestamp");
  PERFORM create_hypertable('ot_telemetry', 'timestamp',
    chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE, migrate_data => TRUE);
  ALTER TABLE ot_telemetry SET (
    timescaledb.compress,
    timescaledb.compress_orderby = '"timestamp" DESC',
    timescaledb.compress_segmentby = '"adapterId"');
  PERFORM add_compression_policy('ot_telemetry', INTERVAL '30 days', if_not_exists => TRUE);
  -- PERFORM add_retention_policy('ot_telemetry', INTERVAL '90 days', if_not_exists => TRUE);

  -- ── oee_metrics (partition: timestamp; segment: machineId) ────────────────
  ALTER TABLE oee_metrics DROP CONSTRAINT IF EXISTS oee_metrics_pkey;
  ALTER TABLE oee_metrics ADD PRIMARY KEY (id, "timestamp");
  PERFORM create_hypertable('oee_metrics', 'timestamp',
    chunk_time_interval => INTERVAL '30 days', if_not_exists => TRUE, migrate_data => TRUE);
  ALTER TABLE oee_metrics SET (
    timescaledb.compress,
    timescaledb.compress_orderby = '"timestamp" DESC',
    timescaledb.compress_segmentby = '"machineId"');
  PERFORM add_compression_policy('oee_metrics', INTERVAL '90 days', if_not_exists => TRUE);
  -- PERFORM add_retention_policy('oee_metrics', INTERVAL '365 days', if_not_exists => TRUE);

  -- ── machine_heartbeats (partition: timestamp; segment: machineId) ─────────
  ALTER TABLE machine_heartbeats DROP CONSTRAINT IF EXISTS machine_heartbeats_pkey;
  ALTER TABLE machine_heartbeats ADD PRIMARY KEY (id, "timestamp");
  PERFORM create_hypertable('machine_heartbeats', 'timestamp',
    chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE, migrate_data => TRUE);
  ALTER TABLE machine_heartbeats SET (
    timescaledb.compress,
    timescaledb.compress_orderby = '"timestamp" DESC',
    timescaledb.compress_segmentby = '"machineId"');
  PERFORM add_compression_policy('machine_heartbeats', INTERVAL '14 days', if_not_exists => TRUE);
  -- PERFORM add_retention_policy('machine_heartbeats', INTERVAL '30 days', if_not_exists => TRUE);

  -- ── process_results (partition: measuredAt; segment: machineId) ───────────
  ALTER TABLE process_results DROP CONSTRAINT IF EXISTS process_results_pkey;
  ALTER TABLE process_results ADD PRIMARY KEY (id, "measuredAt");
  PERFORM create_hypertable('process_results', 'measuredAt',
    chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE, migrate_data => TRUE);
  ALTER TABLE process_results SET (
    timescaledb.compress,
    timescaledb.compress_orderby = '"measuredAt" DESC',
    timescaledb.compress_segmentby = '"machineId"');
  PERFORM add_compression_policy('process_results', INTERVAL '60 days', if_not_exists => TRUE);
  -- PERFORM add_retention_policy('process_results', INTERVAL '180 days', if_not_exists => TRUE);

  RAISE NOTICE '[0118] TimescaleDB hypertables + compression configured.';
END $$;
