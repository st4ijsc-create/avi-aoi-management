-- Migration 0072: Sync Improvements
-- Adds sync logging, image hash deduplication, and delta sync support

-- Enum for sync operation types
DO $$ BEGIN
  CREATE TYPE "syncoperationenum" AS ENUM ('POINTS_PUSH', 'POINTS_PULL', 'IMAGE_PUSH', 'IMAGE_PULL', 'FULL_SYNC', 'DELTA_SYNC');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Enum for sync status
DO $$ BEGIN
  CREATE TYPE "syncstatusenum" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 1. Add imageHash and lastModifiedAt to measurement_point_defs
ALTER TABLE "measurement_point_defs" ADD COLUMN IF NOT EXISTS "imageHash" varchar(64);
ALTER TABLE "measurement_point_defs" ADD COLUMN IF NOT EXISTS "lastModifiedAt" timestamp DEFAULT now();

-- 2. Add imageHash to product_models
ALTER TABLE "product_models" ADD COLUMN IF NOT EXISTS "imageHash" varchar(64);

-- 3. Create sync_logs table for tracking all sync operations
CREATE TABLE IF NOT EXISTS "sync_logs" (
  "id" serial PRIMARY KEY,
  "machineId" integer NOT NULL,
  "machineCode" varchar(50) NOT NULL,
  "productModelId" integer,
  "productModelCode" varchar(100),
  "syncOperation" syncoperationenum NOT NULL,
  "syncStatus" syncstatusenum NOT NULL DEFAULT 'SUCCESS',
  -- Sync details
  "pointsSynced" integer DEFAULT 0,
  "pointsCreated" integer DEFAULT 0,
  "pointsUpdated" integer DEFAULT 0,
  "pointsFailed" integer DEFAULT 0,
  "errorDetails" json,
  -- Coordinate transformation info
  "sourceImageWidth" integer,
  "sourceImageHeight" integer,
  "serverImageWidth" integer,
  "serverImageHeight" integer,
  "coordTransformations" integer DEFAULT 0,
  -- Delta sync info
  "fromVersion" integer,
  "toVersion" integer,
  -- Image sync info
  "imageHashBefore" varchar(64),
  "imageHashAfter" varchar(64),
  "imageSizeBytes" integer,
  "imageSkipped" boolean DEFAULT false,
  -- Performance
  "durationMs" integer,
  "requestSizeBytes" integer,
  -- Metadata
  "clientVersion" varchar(50),
  "ipAddress" varchar(45),
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- 4. Indexes for sync_logs
CREATE INDEX IF NOT EXISTS "idx_sync_logs_machine" ON "sync_logs" ("machineId");
CREATE INDEX IF NOT EXISTS "idx_sync_logs_machine_code" ON "sync_logs" ("machineCode");
CREATE INDEX IF NOT EXISTS "idx_sync_logs_product" ON "sync_logs" ("productModelId");
CREATE INDEX IF NOT EXISTS "idx_sync_logs_operation" ON "sync_logs" ("syncOperation");
CREATE INDEX IF NOT EXISTS "idx_sync_logs_status" ON "sync_logs" ("syncStatus");
CREATE INDEX IF NOT EXISTS "idx_sync_logs_created" ON "sync_logs" ("createdAt");
CREATE INDEX IF NOT EXISTS "idx_sync_logs_machine_product" ON "sync_logs" ("machineId", "productModelId");

-- 5. Index for delta sync queries on measurement_point_defs
CREATE INDEX IF NOT EXISTS "idx_point_defs_last_modified" ON "measurement_point_defs" ("lastModifiedAt");
CREATE INDEX IF NOT EXISTS "idx_point_defs_product_modified" ON "measurement_point_defs" ("productModelId", "lastModifiedAt");

-- 6. Index for image hash lookups
CREATE INDEX IF NOT EXISTS "idx_point_defs_image_hash" ON "measurement_point_defs" ("imageHash");
CREATE INDEX IF NOT EXISTS "idx_product_models_image_hash" ON "product_models" ("imageHash");

-- 7. Update existing measurement_point_defs to set lastModifiedAt = updatedAt
UPDATE "measurement_point_defs" SET "lastModifiedAt" = "updatedAt" WHERE "lastModifiedAt" IS NULL;
