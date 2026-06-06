-- 0117 G2.6a Energy advanced: per-recipe + peak demand + power factor + forecast
-- Additive ONLY. Idempotent (ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS).
-- KHÔNG ALTER/DROP cột cũ, KHÔNG tạo enum mới. Safe to re-run.
-- SAFETY: chỉ thêm cột dữ liệu telemetry energy + chỉ số EnPI — KHÔNG ghi lệnh máy.
-- LƯU Ý: bảng energy_readings (TSDB) là hypertable trên container timescaledb riêng;
--        các cột tương ứng được thêm bởi drizzle/timescale/0002_energy_pf_columns.sql.

-- ============================================================
-- RBAC: thêm category 'energy' vào permissioncategoryenum sẵn có (giống mes_bom ở 0115).
-- ADD VALUE IF NOT EXISTS chạy ngoài transaction (migrate-standalone autocommit). Idempotent.
-- ============================================================
ALTER TYPE "permissioncategoryenum" ADD VALUE IF NOT EXISTS 'energy';

-- ============================================================
-- energy_readings (main PG): power-quality + per-recipe attribution
-- ============================================================
ALTER TABLE energy_readings ADD COLUMN IF NOT EXISTS "reactivePowerKvar" DECIMAL(12,4);
ALTER TABLE energy_readings ADD COLUMN IF NOT EXISTS "apparentPowerKva" DECIMAL(12,4);
ALTER TABLE energy_readings ADD COLUMN IF NOT EXISTS "powerFactor" DECIMAL(5,4);
ALTER TABLE energy_readings ADD COLUMN IF NOT EXISTS "recipeRef" VARCHAR(128);

-- ============================================================
-- enpi_metrics: peak demand + avg power factor + recipe attribution
-- ============================================================
ALTER TABLE enpi_metrics ADD COLUMN IF NOT EXISTS "peakDemandKw" DECIMAL(12,4);
ALTER TABLE enpi_metrics ADD COLUMN IF NOT EXISTS "avgPowerFactor" DECIMAL(5,4);
ALTER TABLE enpi_metrics ADD COLUMN IF NOT EXISTS "recipeId" INTEGER;
ALTER TABLE enpi_metrics ADD COLUMN IF NOT EXISTS "recipeCode" VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_enpi_recipe ON enpi_metrics ("recipeId");
