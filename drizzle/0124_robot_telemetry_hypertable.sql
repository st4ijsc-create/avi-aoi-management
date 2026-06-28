-- ============================================================================
-- Ecosystem P3e — convert robot_telemetry to a TimescaleDB hypertable.
-- Robot/AGV fleets emit high-frequency state (pose/mode/estop/battery); this
-- aligns robot_telemetry with the other time-series hypertables (migration 0118).
--
-- SAFE & IDEMPOTENT (mirrors 0118):
--   * No-op if timescaledb is not AVAILABLE (RAISE NOTICE, never errors a deploy).
--   * create_hypertable(..., migrate_data => TRUE, if_not_exists => TRUE) — safe on
--     existing data and safe to re-run.
--   * Retention (data deletion) intentionally LEFT COMMENTED — pick native here OR
--     the app-level dataRetentionService, not both.
--
-- ⚠️ On a populated DB: back up + run off-peak (migrate_data rewrites into chunks).
-- ============================================================================

DO $$
DECLARE has_ts boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') INTO has_ts;
  IF NOT has_ts THEN
    RAISE NOTICE '[0124] timescaledb extension not available on this server — skipping robot_telemetry hypertable conversion.';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS timescaledb;

  -- robot_telemetry (partition: timestamp; segment: robotId)
  ALTER TABLE robot_telemetry DROP CONSTRAINT IF EXISTS robot_telemetry_pkey;
  ALTER TABLE robot_telemetry ADD PRIMARY KEY (id, "timestamp");
  PERFORM create_hypertable('robot_telemetry', 'timestamp',
    chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE, migrate_data => TRUE);
  ALTER TABLE robot_telemetry SET (
    timescaledb.compress,
    timescaledb.compress_orderby = '"timestamp" DESC',
    timescaledb.compress_segmentby = '"robotId"');
  PERFORM add_compression_policy('robot_telemetry', INTERVAL '14 days', if_not_exists => TRUE);
  -- PERFORM add_retention_policy('robot_telemetry', INTERVAL '90 days', if_not_exists => TRUE);

  RAISE NOTICE '[0124] robot_telemetry converted to hypertable (compress after 14d; retention commented).';
END $$;
