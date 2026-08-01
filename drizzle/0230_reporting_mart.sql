-- ============================================================================
-- Migration 0230: Reporting Mart (dimensional star schema) — doc 35 B8 / doc 32 R1
--
-- The reporting audit found NO dimensional / mart layer: 0 dim_/fact_ tables,
-- every dashboard aggregates on-the-fly over raw product_inspections, and shift
-- is a derived string not a dimension. TimescaleDB is NOT installed on the main
-- DB, so continuous aggregates are unavailable — this mart is PLAIN tables
-- refreshed by an app job (server/services/reportingMartService.ts) that is
-- FLAG-GATED off by default (REPORTING_MART_ENABLED).
--
--   1. dim_shift   — one row per (shiftCode, factoryId) synced from shift_configs.
--                    factoryId 0 = global/all-factory shift (COALESCE sentinel of
--                    the nullable shift_configs.factoryId) so the UNIQUE key never
--                    contains a NULL (Postgres treats NULLs as distinct — that
--                    would break the idempotent upsert).
--   2. dim_product — one row per product model synced from product_models.
--   3. fact_inspection_hourly — hourly grain fact. UNIQUE
--        (bucketHour, machineId, productModelId, shiftCode) so refresh is an
--        idempotent UPSERT. bucketHour is FACTORY-LOCAL naive wall time
--        (date_trunc('hour', ts AT TIME ZONE storage AT TIME ZONE factory) — the
--        same bucketing utils/kpi uses), so the mart's shift/hour match the rest
--        of the app. productModelId defaults to 0 (COALESCE sentinel of the
--        nullable product_inspections.productModelId) for the same NULL-in-unique
--        reason.
--
-- ADDITIVE + IDEMPOTENT: CREATE TABLE / INDEX IF NOT EXISTS only. No ALTER TYPE,
-- no feature flag on the DDL. Inert until the service writes / router reads.
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- ============================================================================

-- 1) Dimension: shift ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS "dim_shift" (
  "id"          serial PRIMARY KEY,
  "shiftCode"   varchar(32) NOT NULL,
  "name"        varchar(100) NOT NULL,
  "startHour"   integer NOT NULL DEFAULT 0,
  "startMinute" integer NOT NULL DEFAULT 0,
  "endHour"     integer NOT NULL DEFAULT 0,
  "endMinute"   integer NOT NULL DEFAULT 0,
  "factoryId"   integer NOT NULL DEFAULT 0,
  "updatedAt"   timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_dim_shift_code_factory"
  ON "dim_shift" ("shiftCode", "factoryId");

-- 2) Dimension: product -------------------------------------------------------
CREATE TABLE IF NOT EXISTS "dim_product" (
  "id"             serial PRIMARY KEY,
  "productModelId" integer NOT NULL,
  "code"           varchar(100) NOT NULL,
  "name"           varchar(255),
  "category"       varchar(100),
  "revision"       varchar(32),
  "updatedAt"      timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_dim_product_model"
  ON "dim_product" ("productModelId");

-- 3) Fact: inspection hourly grain -------------------------------------------
CREATE TABLE IF NOT EXISTS "fact_inspection_hourly" (
  "id"             serial PRIMARY KEY,
  "bucketHour"     timestamp NOT NULL,
  "factoryId"      integer,
  "machineId"      integer NOT NULL,
  "productModelId" integer NOT NULL DEFAULT 0,
  "shiftCode"      varchar(32) NOT NULL,
  "totalCount"     integer NOT NULL DEFAULT 0,
  "okCount"        integer NOT NULL DEFAULT 0,
  "ngCount"        integer NOT NULL DEFAULT 0,
  "ntfCount"       integer NOT NULL DEFAULT 0,
  "yieldPct"       numeric(5, 2),
  "fpyPct"         numeric(5, 2),
  "computedAt"     timestamp NOT NULL DEFAULT now()
);
-- The grain — refresh UPSERTs (ON CONFLICT) against this, so it is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_fact_insp_hourly_grain"
  ON "fact_inspection_hourly" ("bucketHour", "machineId", "productModelId", "shiftCode");
CREATE INDEX IF NOT EXISTS "idx_fact_insp_hourly_bucket"  ON "fact_inspection_hourly" ("bucketHour");
CREATE INDEX IF NOT EXISTS "idx_fact_insp_hourly_factory" ON "fact_inspection_hourly" ("factoryId");
CREATE INDEX IF NOT EXISTS "idx_fact_insp_hourly_machine" ON "fact_inspection_hourly" ("machineId");
CREATE INDEX IF NOT EXISTS "idx_fact_insp_hourly_product" ON "fact_inspection_hourly" ("productModelId");
CREATE INDEX IF NOT EXISTS "idx_fact_insp_hourly_shift"   ON "fact_inspection_hourly" ("shiftCode");
