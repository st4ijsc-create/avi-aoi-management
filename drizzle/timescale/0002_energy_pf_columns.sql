-- 0002 G2.6a — Đồng bộ cột power-quality + per-recipe cho energy_readings (TSDB hypertable).
-- Chạy RIÊNG trên container timescaledb (KHÔNG phải PG18 chính, KHÔNG do migrate-standalone.mjs apply).
-- Tổng giám sát apply:
--   docker exec -i avi-aoi-management-timescaledb-1 psql -U tsdb -d avi_aoi_ts < drizzle/timescale/0002_energy_pf_columns.sql
-- Additive ONLY, idempotent (ADD COLUMN IF NOT EXISTS). Giữ schema TSDB đồng bộ với main PG (0117).

ALTER TABLE energy_readings ADD COLUMN IF NOT EXISTS "reactivePowerKvar" NUMERIC(12,4);
ALTER TABLE energy_readings ADD COLUMN IF NOT EXISTS "apparentPowerKva" NUMERIC(12,4);
ALTER TABLE energy_readings ADD COLUMN IF NOT EXISTS "powerFactor" NUMERIC(5,4);
ALTER TABLE energy_readings ADD COLUMN IF NOT EXISTS "recipeRef" VARCHAR(128);
