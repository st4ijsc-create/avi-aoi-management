-- ============================================================================
-- Migration 0123: MASTER DATA EXTRAS (Audit doc 07 §③ "nice-to-have")
-- Units-of-Measure (+conversions) / Plant-Shift Calendar (+days) /
-- Warehouse-Inventory master (warehouses + storage locations + balances).
-- ADDITIVE ONLY — creates new enum types + new tables/indexes; NO ALTER on any
-- existing table or enum. Idempotent (IF NOT EXISTS + guarded DO blocks for enum
-- types). Relates to existing masters (materials/warehouses/uom) BY CODE.
-- Follows the 0100 / 0122 conventions.
-- ============================================================================

-- ── Enum types (guarded create) ────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "uomdimensionenum" AS ENUM ('length','mass','volume','time','temperature','count','percent','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "calendardaytypeenum" AS ENUM ('working','holiday','planned_downtime');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "warehousetypeenum" AS ENUM ('raw','wip','fg','spare','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "storagelocationkindenum" AS ENUM ('bin','shelf','zone');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Units of Measure ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "units_of_measure" (
  "id" serial PRIMARY KEY,
  "code" varchar(32) NOT NULL UNIQUE,
  "name" varchar(128) NOT NULL,
  "dimension" "uomdimensionenum" NOT NULL DEFAULT 'count',
  "isBase" boolean NOT NULL DEFAULT false,
  "isActive" boolean NOT NULL DEFAULT true,
  "notes" text,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "updatedAt" timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_uom_code"      ON "units_of_measure" ("code");
CREATE INDEX IF NOT EXISTS "idx_uom_dimension" ON "units_of_measure" ("dimension");
CREATE INDEX IF NOT EXISTS "idx_uom_active"    ON "units_of_measure" ("isActive");

-- ── Unit Conversions (value_to = value_from * factor + offset) ───────────────
CREATE TABLE IF NOT EXISTS "unit_conversions" (
  "id" serial PRIMARY KEY,
  "fromUomCode" varchar(32) NOT NULL,
  "toUomCode" varchar(32) NOT NULL,
  "factor" numeric(24,12) NOT NULL,
  "offset" numeric(24,12) NOT NULL DEFAULT 0,
  "notes" text,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "updatedAt" timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_uomconv_from" ON "unit_conversions" ("fromUomCode");
CREATE INDEX IF NOT EXISTS "idx_uomconv_to"   ON "unit_conversions" ("toUomCode");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_uomconv_from_to" ON "unit_conversions" ("fromUomCode","toUomCode");

-- ── Plant Calendars ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "plant_calendars" (
  "id" serial PRIMARY KEY,
  "code" varchar(64) NOT NULL UNIQUE,
  "name" varchar(256) NOT NULL,
  "factoryCode" varchar(50),
  "timezone" varchar(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  "isActive" boolean NOT NULL DEFAULT true,
  "notes" text,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "updatedAt" timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_plantcal_code"    ON "plant_calendars" ("code");
CREATE INDEX IF NOT EXISTS "idx_plantcal_factory" ON "plant_calendars" ("factoryCode");
CREATE INDEX IF NOT EXISTS "idx_plantcal_active"  ON "plant_calendars" ("isActive");

-- ── Calendar Days ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "calendar_days" (
  "id" serial PRIMARY KEY,
  "calendarId" integer NOT NULL,
  "date" varchar(10) NOT NULL,
  "dayType" "calendardaytypeenum" NOT NULL DEFAULT 'working',
  "notes" text,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "updatedAt" timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_caldays_calendar" ON "calendar_days" ("calendarId");
CREATE INDEX IF NOT EXISTS "idx_caldays_date"     ON "calendar_days" ("date");
CREATE INDEX IF NOT EXISTS "idx_caldays_type"     ON "calendar_days" ("dayType");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_caldays_calendar_date" ON "calendar_days" ("calendarId","date");

-- ── Warehouses ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "warehouses" (
  "id" serial PRIMARY KEY,
  "code" varchar(64) NOT NULL UNIQUE,
  "name" varchar(256) NOT NULL,
  "factoryCode" varchar(50),
  "type" "warehousetypeenum" NOT NULL DEFAULT 'other',
  "isActive" boolean NOT NULL DEFAULT true,
  "notes" text,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "updatedAt" timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_warehouses_code"    ON "warehouses" ("code");
CREATE INDEX IF NOT EXISTS "idx_warehouses_factory" ON "warehouses" ("factoryCode");
CREATE INDEX IF NOT EXISTS "idx_warehouses_type"    ON "warehouses" ("type");
CREATE INDEX IF NOT EXISTS "idx_warehouses_active"  ON "warehouses" ("isActive");

-- ── Storage Locations ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "storage_locations" (
  "id" serial PRIMARY KEY,
  "warehouseId" integer NOT NULL,
  "code" varchar(64) NOT NULL,
  "name" varchar(256),
  "kind" "storagelocationkindenum" NOT NULL DEFAULT 'bin',
  "isActive" boolean NOT NULL DEFAULT true,
  "notes" text,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "updatedAt" timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_stgloc_warehouse" ON "storage_locations" ("warehouseId");
CREATE INDEX IF NOT EXISTS "idx_stgloc_code"      ON "storage_locations" ("code");
CREATE INDEX IF NOT EXISTS "idx_stgloc_kind"      ON "storage_locations" ("kind");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_stgloc_warehouse_code" ON "storage_locations" ("warehouseId","code");

-- ── Inventory Balances ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_balances" (
  "id" serial PRIMARY KEY,
  "materialCode" varchar(64) NOT NULL,
  "warehouseCode" varchar(64) NOT NULL,
  "locationCode" varchar(64),
  "lotCode" varchar(64),
  "quantityOnHand" numeric(24,6) NOT NULL DEFAULT 0,
  "uomCode" varchar(32) NOT NULL DEFAULT 'pcs',
  "notes" text,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "updatedAt" timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_invbal_material"  ON "inventory_balances" ("materialCode");
CREATE INDEX IF NOT EXISTS "idx_invbal_warehouse" ON "inventory_balances" ("warehouseCode");
CREATE INDEX IF NOT EXISTS "idx_invbal_location"  ON "inventory_balances" ("locationCode");
CREATE INDEX IF NOT EXISTS "idx_invbal_lot"       ON "inventory_balances" ("lotCode");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_invbal_mat_wh_loc_lot" ON "inventory_balances" ("materialCode","warehouseCode","locationCode","lotCode");
