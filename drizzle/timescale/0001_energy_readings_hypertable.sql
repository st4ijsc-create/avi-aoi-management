-- G1/G3 — TimescaleDB hypertable cho energy_readings (chạy trên container timescaledb, KHÔNG phải PG18 chính).
-- Áp dụng: docker exec -i avi-aoi-management-timescaledb-1 psql -U tsdb -d avi_aoi_ts < drizzle/timescale/0001_energy_readings_hypertable.sql
-- Lưu ý hypertable: cột phân vùng ("timestamp") phải nằm trong mọi unique index → PK = (id, "timestamp").

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS energy_readings (
  id          BIGINT GENERATED ALWAYS AS IDENTITY,
  "machineId" INTEGER,
  "layoutId"  INTEGER,
  source      TEXT          NOT NULL DEFAULT 'electricity',
  value       NUMERIC(14,4) NOT NULL,
  unit        VARCHAR(16)   NOT NULL DEFAULT 'kWh',
  "powerKw"   NUMERIC(12,4),
  "timestamp" TIMESTAMPTZ   NOT NULL DEFAULT now(),
  "createdAt" TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (id, "timestamp")
);

-- Chuyển thành hypertable (chunk theo 7 ngày). Idempotent nhờ if_not_exists.
SELECT create_hypertable(
  'energy_readings',
  'timestamp',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_energy_machine ON energy_readings ("machineId", "timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_energy_source  ON energy_readings (source, "timestamp" DESC);
