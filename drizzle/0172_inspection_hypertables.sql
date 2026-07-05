-- ============================================================================
-- Migration 0172: TimescaleDB hypertables for the AOI/AVI inspection core
-- (doc 27 §4 R1/R2 · §11 decision #1 — TimescaleDB MANDATORY on the MAIN DB).
--
-- PROBLEM (R1/R2): `product_inspections` + `measurement_results` are plain,
-- unpartitioned tables growing without bound (~500k rows/day at production
-- volume), and migration 0118 was a SILENT no-op on the main DB (the main
-- image had pgvector but no timescaledb) so the four telemetry tables never
-- became hypertables either.
--
-- WHAT THIS DOES when the timescaledb extension is AVAILABLE:
--   1. CREATE EXTENSION timescaledb.
--   2. Recreates PKs as composite (id, <time column>) — Timescale requires the
--      partitioning column in every unique index — then converts to hypertables
--      with migrate_data => TRUE:
--        · product_inspections  → partition "inspectionTime", 1-month chunks
--        · measurement_results  → partition "createdAt",      1-month chunks
--      NOTE: no compression on these two — operators UPDATE old rows
--      (verify OK/NG/NTF, acknowledge, archive) and compressed-chunk updates
--      are slow; retention (0173) bounds their size instead.
--   3. Converts the four 0118 tables on the MAIN DB (closing the 0118 no-op):
--      ot_telemetry (event-time column is now "ts", renamed since 0118),
--      oee_metrics, machine_heartbeats, process_results — with the original
--      0118 compression settings.
--   4. Records the outcome in `db_feature_status` (small status table created
--      below) so ops/dashboards can see whether decision #1 is actually met.
--
-- WHEN timescaledb IS NOT AVAILABLE (e.g. native Windows PG dev install):
--   RAISES A WARNING (loud, greppable, references doc 27 decision #1) and
--   records status 'missing' in db_feature_status. It does NOT fail the whole
--   migration run — dev environments must keep working — but the server
--   bootstrap check (server/services/dbRequirementsCheck.ts) prints an error
--   banner on every startup until the DB is moved to an image that ships
--   timescaledb (see docker-compose.yml `postgres` service — now
--   timescale/timescaledb-ha, which ships timescaledb + pgvector — and the
--   runbook scripts/migrate-to-timescaledb.md).
--
-- IDEMPOTENT: re-runnable; every conversion is guarded by a hypertable check
-- and create_hypertable uses if_not_exists => TRUE.
--
-- ⚠️ On a POPULATED production DB run in an off-peak window with a fresh
--    backup — migrate_data => TRUE rewrites each table into chunks.
--
-- Applied by the normal migrate step (scripts/migrate-standalone.mjs), tracked
-- in __applied_migrations. See also run-0172-0173-migration.mjs.
-- ============================================================================

-- Tiny ops-visible status table (also used by 0173 + the startup check).
CREATE TABLE IF NOT EXISTS "db_feature_status" (
  "feature"   varchar(100) PRIMARY KEY,
  "status"    varchar(20) NOT NULL,          -- 'ok' | 'missing' | 'partial'
  "detail"    text,
  "checkedAt" timestamp NOT NULL DEFAULT now()
);

DO $$
DECLARE
  has_ts boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') INTO has_ts;

  IF NOT has_ts THEN
    RAISE WARNING '[0172] TimescaleDB is REQUIRED on the MAIN DB by doc 27 decision #1 but the extension is NOT AVAILABLE on this server — product_inspections / measurement_results / telemetry tables remain UNPARTITIONED. Swap the DB to timescale/timescaledb-ha (ships timescaledb + pgvector) per scripts/migrate-to-timescaledb.md, then re-apply this migration.';
    INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
    VALUES (
      'timescaledb_hypertables',
      'missing',
      'timescaledb extension not available on this server — doc 27 decision #1 UNMET; inspection tables are unpartitioned. Runbook: scripts/migrate-to-timescaledb.md',
      now()
    )
    ON CONFLICT ("feature") DO UPDATE
      SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS timescaledb;

  -- ── product_inspections (partition: inspectionTime, 1-month chunks) ───────
  IF NOT EXISTS (SELECT 1 FROM timescaledb_information.hypertables
                 WHERE hypertable_name = 'product_inspections') THEN
    ALTER TABLE product_inspections DROP CONSTRAINT IF EXISTS product_inspections_pkey;
    ALTER TABLE product_inspections ADD PRIMARY KEY (id, "inspectionTime");
    PERFORM create_hypertable('product_inspections', 'inspectionTime',
      chunk_time_interval => INTERVAL '1 month', if_not_exists => TRUE, migrate_data => TRUE);
  END IF;

  -- ── measurement_results (partition: createdAt, 1-month chunks) ────────────
  -- createdAt (NOT NULL, DEFAULT now()) tracks inspectionTime within seconds on
  -- the machine-push path; it is the only timestamp column on this table.
  IF NOT EXISTS (SELECT 1 FROM timescaledb_information.hypertables
                 WHERE hypertable_name = 'measurement_results') THEN
    ALTER TABLE measurement_results DROP CONSTRAINT IF EXISTS measurement_results_pkey;
    ALTER TABLE measurement_results ADD PRIMARY KEY (id, "createdAt");
    PERFORM create_hypertable('measurement_results', 'createdAt',
      chunk_time_interval => INTERVAL '1 month', if_not_exists => TRUE, migrate_data => TRUE);
  END IF;

  -- ── ot_telemetry (partition: ts — renamed from legacy "timestamp") ────────
  IF NOT EXISTS (SELECT 1 FROM timescaledb_information.hypertables
                 WHERE hypertable_name = 'ot_telemetry') THEN
    ALTER TABLE ot_telemetry DROP CONSTRAINT IF EXISTS ot_telemetry_pkey;
    ALTER TABLE ot_telemetry ADD PRIMARY KEY (id, "ts");
    PERFORM create_hypertable('ot_telemetry', 'ts',
      chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE, migrate_data => TRUE);
    ALTER TABLE ot_telemetry SET (
      timescaledb.compress,
      timescaledb.compress_orderby = '"ts" DESC',
      timescaledb.compress_segmentby = '"adapterId"');
    PERFORM add_compression_policy('ot_telemetry', INTERVAL '30 days', if_not_exists => TRUE);
  END IF;

  -- ── oee_metrics (partition: timestamp) ────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM timescaledb_information.hypertables
                 WHERE hypertable_name = 'oee_metrics') THEN
    ALTER TABLE oee_metrics DROP CONSTRAINT IF EXISTS oee_metrics_pkey;
    ALTER TABLE oee_metrics ADD PRIMARY KEY (id, "timestamp");
    PERFORM create_hypertable('oee_metrics', 'timestamp',
      chunk_time_interval => INTERVAL '30 days', if_not_exists => TRUE, migrate_data => TRUE);
    ALTER TABLE oee_metrics SET (
      timescaledb.compress,
      timescaledb.compress_orderby = '"timestamp" DESC',
      timescaledb.compress_segmentby = '"machineId"');
    PERFORM add_compression_policy('oee_metrics', INTERVAL '90 days', if_not_exists => TRUE);
  END IF;

  -- ── machine_heartbeats (partition: timestamp) ─────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM timescaledb_information.hypertables
                 WHERE hypertable_name = 'machine_heartbeats') THEN
    ALTER TABLE machine_heartbeats DROP CONSTRAINT IF EXISTS machine_heartbeats_pkey;
    ALTER TABLE machine_heartbeats ADD PRIMARY KEY (id, "timestamp");
    PERFORM create_hypertable('machine_heartbeats', 'timestamp',
      chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE, migrate_data => TRUE);
    ALTER TABLE machine_heartbeats SET (
      timescaledb.compress,
      timescaledb.compress_orderby = '"timestamp" DESC',
      timescaledb.compress_segmentby = '"machineId"');
    PERFORM add_compression_policy('machine_heartbeats', INTERVAL '14 days', if_not_exists => TRUE);
  END IF;

  -- ── process_results (partition: measuredAt) ───────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM timescaledb_information.hypertables
                 WHERE hypertable_name = 'process_results') THEN
    ALTER TABLE process_results DROP CONSTRAINT IF EXISTS process_results_pkey;
    ALTER TABLE process_results ADD PRIMARY KEY (id, "measuredAt");
    PERFORM create_hypertable('process_results', 'measuredAt',
      chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE, migrate_data => TRUE);
    ALTER TABLE process_results SET (
      timescaledb.compress,
      timescaledb.compress_orderby = '"measuredAt" DESC',
      timescaledb.compress_segmentby = '"machineId"');
    PERFORM add_compression_policy('process_results', INTERVAL '60 days', if_not_exists => TRUE);
  END IF;

  INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
  VALUES (
    'timescaledb_hypertables',
    'ok',
    'hypertables: product_inspections (1mo), measurement_results (1mo), ot_telemetry, oee_metrics, machine_heartbeats, process_results — doc 27 decision #1 met',
    now()
  )
  ON CONFLICT ("feature") DO UPDATE
    SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();

  RAISE NOTICE '[0172] TimescaleDB hypertables configured for inspection + telemetry tables (doc 27 decision #1).';
END $$;
