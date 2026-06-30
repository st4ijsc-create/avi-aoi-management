-- P2 (doc 12 §5) — ot_telemetry canonical telemetry hypertable on the DEDICATED
-- TimescaleDB (container avi-aoi-management-timescaledb-1, db avi_aoi_ts), NOT the
-- main pgvector PG (which cannot host the timescaledb extension).
--
-- Apply:
--   docker exec -i avi-aoi-management-timescaledb-1 psql -U tsdb -d avi_aoi_ts \
--     < drizzle/timescale/0003_ot_telemetry_hypertable.sql
--
-- Mirrors drizzle/timescale/0001_energy_readings_hypertable.sql (the TSDB lives
-- in this container so timescaledb is always present — no pg_available_extensions
-- guard needed, unlike the deprecated main-DB attempt in drizzle/0133). The
-- column set matches the canonical drizzle/schema/ot.ts ot_telemetry table so the
-- TSDB hypertable and the main-DB fallback table stay identical.
--
-- Hypertable rule: the partition column (`ts`) must be in every unique index/PK →
-- PRIMARY KEY (id, ts). Idempotent: IF NOT EXISTS / if_not_exists throughout.

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS ot_telemetry (
  id           BIGINT GENERATED ALWAYS AS IDENTITY,
  "ts"         TIMESTAMPTZ NOT NULL,
  "machineId"  INTEGER,
  "deviceId"   TEXT,
  protocol     TEXT        NOT NULL,
  metric       TEXT        NOT NULL,
  "numValue"   DOUBLE PRECISION,
  "textValue"  TEXT,
  "boolValue"  BOOLEAN,
  unit         TEXT,
  quality      TEXT        NOT NULL DEFAULT 'good',
  meta         JSONB,
  "ingestedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, "ts")
);

-- Hypertable on `ts` (chunk per 7 days). Idempotent via if_not_exists.
SELECT create_hypertable(
  'ot_telemetry',
  'ts',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists       => TRUE
);

-- High-volume read patterns: latest-per-machine, per-metric series, per-protocol.
CREATE INDEX IF NOT EXISTS idx_ot_telemetry_machine_ts  ON ot_telemetry ("machineId", "ts" DESC);
CREATE INDEX IF NOT EXISTS idx_ot_telemetry_metric_ts   ON ot_telemetry ("metric", "ts" DESC);
CREATE INDEX IF NOT EXISTS idx_ot_telemetry_protocol_ts ON ot_telemetry (protocol, "ts" DESC);

-- ── Compression (segment by machineId/metric, newest-first ordering) ──────────
-- Compress chunks older than 30 days (tunable). Old raw samples stay queryable.
ALTER TABLE ot_telemetry SET (
  timescaledb.compress,
  timescaledb.compress_orderby   = '"ts" DESC',
  timescaledb.compress_segmentby = '"machineId", "metric"'
);
SELECT add_compression_policy('ot_telemetry', INTERVAL '30 days', if_not_exists => TRUE);

-- ── Retention: drop raw-sample chunks older than 90 days (tunable) ────────────
-- ⚠ This is the NATIVE retention path for ot_telemetry. Once applied, DISABLE the
-- app-level dataRetentionService for ot_telemetry (RETENTION_OT_TELEMETRY_DAYS=0)
-- so the two do not double-delete. The 1m/1h CAGGs below are NOT covered by this
-- retention policy and persist the rollups beyond 90 days.
SELECT add_retention_policy('ot_telemetry', INTERVAL '90 days', if_not_exists => TRUE);

-- ── Continuous aggregates (rollups of numeric samples per machineId+metric) ───
-- Created OUTSIDE any DO block (CREATE MATERIALIZED VIEW cannot run inside
-- PL/pgSQL). avg/min/max/count of numValue. Safe to re-run (IF NOT EXISTS).

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

-- ── Refresh policies for the CAGGs (auto-incremental refresh) ─────────────────
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
