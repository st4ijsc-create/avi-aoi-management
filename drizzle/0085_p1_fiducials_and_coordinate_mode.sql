-- ============================================================================
-- Migration 0085: P1 - Fiducial Marks + Coordinate Mode
-- ============================================================================
-- Phase 1 of products/measurement points upgrade.
--
--   1. Adds `coordinateMode` (default 'pixel') to product_models to declare the
--      coordinate system (pixel | mm) used by measurement points and fiducials
--      for that product model.
--   2. Creates fiducial_marks table — alignment reference marks on the product
--      reference image used by AOI machines for frame registration.
--
-- All operations are idempotent (IF NOT EXISTS). Safe to re-run.
-- This migration does NOT broaden the measurement_point_defs.shape enum;
-- shape is already varchar(20) and accepts new values without DDL change.
-- ============================================================================

-- 1) coordinateMode on product_models
ALTER TABLE "product_models"
  ADD COLUMN IF NOT EXISTS "coordinateMode" varchar(20) NOT NULL DEFAULT 'pixel';

-- 2) fiducial_marks table
CREATE TABLE IF NOT EXISTS "fiducial_marks" (
  "id"               serial PRIMARY KEY,
  "productModelId"   integer NOT NULL,
  "code"             varchar(50) NOT NULL,
  "name"             varchar(255) NOT NULL,
  "description"      text,
  "type"             varchar(20) NOT NULL DEFAULT 'cross',
  "positionX"        integer NOT NULL,
  "positionY"        integer NOT NULL,
  "normalizedX"      numeric(10, 8),
  "normalizedY"      numeric(10, 8),
  "searchWindowW"    integer NOT NULL DEFAULT 80,
  "searchWindowH"    integer NOT NULL DEFAULT 80,
  "templateImageUrl" text,
  "templateImageKey" varchar(255),
  "orderIndex"       integer NOT NULL DEFAULT 0,
  "isActive"         boolean NOT NULL DEFAULT true,
  "deletedAt"        timestamp,
  "createdAt"        timestamp NOT NULL DEFAULT NOW(),
  "updatedAt"        timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_fiducial_marks_product"     ON "fiducial_marks" ("productModelId");
CREATE INDEX IF NOT EXISTS "idx_fiducial_marks_code"        ON "fiducial_marks" ("code");
CREATE INDEX IF NOT EXISTS "idx_fiducial_marks_deleted_at"  ON "fiducial_marks" ("deletedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_fiducial_marks_product_code"
  ON "fiducial_marks" ("productModelId", "code")
  WHERE "deletedAt" IS NULL;
