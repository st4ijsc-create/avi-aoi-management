-- ============================================================================
-- Migration 0171: Factory floor-plan background + real metric scale + zones
-- (audit doc 25 · Trụ E / task W6-25).
--
-- PROBLEM: the Factory Floor Editor placed machines on an abstract 0–1 grid with
-- no real background (CAD/photo), no metric scale, and no notion of named areas
-- (zones). It could not become a world-class floor editor without: a background
-- image, real floor dimensions in metres, and drawable polygon zones.
--
-- WHAT THIS DOES (additive + idempotent — ADD COLUMN / CREATE TABLE IF NOT EXISTS
-- only; no ALTER TYPE, no new pg enum; existing rows unaffected):
--   1. factories: floorPlanImageUrl / floorPlanImageKey (uploaded background,
--      mirrors machines.image2DUrl/Key convention) + floorWidthM / floorDepthM
--      (real floor size in metres, for a true-scale overlay & area maths).
--   2. CREATE TABLE factory_zones — one drawable polygon area per row
--      (name, color, points jsonb = array of {x,y} normalized 0–1 vertices).
--      CRUD is app-gated by machine_control/canEdit (same as machine layout).
--
-- HONESTY: SCHEMA + storage only. Opens NO device-control path; changes no existing
-- query behaviour; strictly ADDS floor-plan metadata + a zones table.
--
-- Applied by the normal migrate step (scripts/migrate-standalone.mjs), tracked in
-- __applied_migrations. Re-runnable.
-- ============================================================================

ALTER TABLE "factories" ADD COLUMN IF NOT EXISTS "floorPlanImageUrl" text;
ALTER TABLE "factories" ADD COLUMN IF NOT EXISTS "floorPlanImageKey" varchar(255);
ALTER TABLE "factories" ADD COLUMN IF NOT EXISTS "floorWidthM" decimal(10, 2);
ALTER TABLE "factories" ADD COLUMN IF NOT EXISTS "floorDepthM" decimal(10, 2);

CREATE TABLE IF NOT EXISTS "factory_zones" (
  "id"        serial PRIMARY KEY,
  "factoryId" integer NOT NULL,
  "name"      varchar(120) NOT NULL,
  "color"     varchar(24) NOT NULL DEFAULT '#0ea5e9',
  "points"    jsonb NOT NULL DEFAULT '[]'::jsonb,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_factory_zones_factory" ON "factory_zones" ("factoryId");
