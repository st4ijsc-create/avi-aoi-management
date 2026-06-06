-- ============================================================================
-- Migration 0084: P0 Foundation - Soft Delete, Audit, Versioning, Shapes
-- ============================================================================
-- Phase 0 of products/measurement points upgrade.
--
--   1. Adds `deletedAt` soft-delete marker to product_models and
--      measurement_point_defs (NULL = live, timestamp = deleted).
--   2. Adds `shape` (default 'circle') and `geometry` (jsonb) to
--      measurement_point_defs to support non-circle shapes in P1+.
--   3. Creates measurement_point_versions to snapshot each edit of a
--      measurement_point_defs row.
--
-- All operations are idempotent (IF NOT EXISTS). Safe to re-run.
-- This migration does NOT touch productModels.pointsConfigVersion.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Soft-delete columns
-- ----------------------------------------------------------------------------
ALTER TABLE "product_models"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp;

ALTER TABLE "measurement_point_defs"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp;

CREATE INDEX IF NOT EXISTS "idx_product_models_deleted_at"
  ON "product_models" USING btree ("deletedAt");

CREATE INDEX IF NOT EXISTS "idx_point_defs_deleted_at"
  ON "measurement_point_defs" USING btree ("deletedAt");

-- ----------------------------------------------------------------------------
-- 2. Shape + geometry on measurement_point_defs
-- ----------------------------------------------------------------------------
ALTER TABLE "measurement_point_defs"
  ADD COLUMN IF NOT EXISTS "shape" varchar(20) DEFAULT 'circle' NOT NULL;

ALTER TABLE "measurement_point_defs"
  ADD COLUMN IF NOT EXISTS "geometry" jsonb;

-- ----------------------------------------------------------------------------
-- 3. measurement_point_versions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "measurement_point_versions" (
  "id" serial PRIMARY KEY,
  "pointDefId" integer NOT NULL,
  "version" integer NOT NULL,
  "snapshotJson" jsonb NOT NULL,
  "changedBy" integer,
  "changeReason" varchar(500),
  "changedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "uq_point_versions_point_version" UNIQUE ("pointDefId", "version")
);

CREATE INDEX IF NOT EXISTS "idx_point_versions_point"
  ON "measurement_point_versions" USING btree ("pointDefId");

CREATE INDEX IF NOT EXISTS "idx_point_versions_changed_at"
  ON "measurement_point_versions" USING btree ("changedAt");
