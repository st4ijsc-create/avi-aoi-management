-- AOI Image Upload - ZIP Package System
-- Migration: inspection_packages, package_images, upload_queue_metrics

DO $$ BEGIN
  CREATE TYPE "packagestatusenum" AS ENUM ('pending', 'uploading', 'uploaded', 'committed', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Inspection Packages - Gói ZIP ảnh AOI
CREATE TABLE IF NOT EXISTS "inspection_packages" (
  "id" serial PRIMARY KEY,
  "inspectionId" integer,
  "machineId" integer NOT NULL,
  "packageId" varchar(100) NOT NULL UNIQUE,
  "storageKey" varchar(500),
  "storageUrl" text,
  "serialNumber" varchar(100),
  "productModel" varchar(100),
  "factoryCode" varchar(50),
  "lineCode" varchar(50),
  "machineCode" varchar(50),
  "inspectionTime" timestamp,
  "overallResult" "overallresultenum",
  "totalPoints" integer DEFAULT 0,
  "okCount" integer DEFAULT 0,
  "ngCount" integer DEFAULT 0,
  "fileSizeBytes" bigint,
  "imageCount" integer DEFAULT 0,
  "status" "packagestatusenum" DEFAULT 'pending' NOT NULL,
  "errorMessage" text,
  "presignExpiresAt" timestamp,
  "uploadedAt" timestamp,
  "committedAt" timestamp,
  "metaJson" json,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_pkg_inspection" ON "inspection_packages" ("inspectionId");
CREATE INDEX IF NOT EXISTS "idx_pkg_machine" ON "inspection_packages" ("machineId");
CREATE INDEX IF NOT EXISTS "idx_pkg_package_id" ON "inspection_packages" ("packageId");
CREATE INDEX IF NOT EXISTS "idx_pkg_serial" ON "inspection_packages" ("serialNumber");
CREATE INDEX IF NOT EXISTS "idx_pkg_status" ON "inspection_packages" ("status");
CREATE INDEX IF NOT EXISTS "idx_pkg_inspection_time" ON "inspection_packages" ("inspectionTime");
CREATE INDEX IF NOT EXISTS "idx_pkg_machine_time" ON "inspection_packages" ("machineId", "inspectionTime");

-- Package Images - Thông tin từng ảnh trong gói ZIP
CREATE TABLE IF NOT EXISTS "package_images" (
  "id" serial PRIMARY KEY,
  "packageId" integer NOT NULL,
  "pointCode" varchar(50) NOT NULL,
  "pointName" varchar(255),
  "fileName" varchar(255) NOT NULL,
  "result" "overallresultenum",
  "measurementValue" varchar(100),
  "cachedUrl" text,
  "cachedAt" timestamp,
  "cacheExpiresAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_pkgimg_package" ON "package_images" ("packageId");
CREATE INDEX IF NOT EXISTS "idx_pkgimg_point" ON "package_images" ("pointCode");

-- Upload Queue Metrics - Theo dõi hàng đợi upload từ các máy
CREATE TABLE IF NOT EXISTS "upload_queue_metrics" (
  "id" serial PRIMARY KEY,
  "machineId" integer NOT NULL,
  "queuedCount" integer DEFAULT 0 NOT NULL,
  "uploadingCount" integer DEFAULT 0 NOT NULL,
  "failedCount" integer DEFAULT 0 NOT NULL,
  "completedCount" integer DEFAULT 0 NOT NULL,
  "diskUsedBytes" bigint,
  "diskFreeBytes" bigint,
  "avgUploadLatencyMs" integer,
  "lastUploadAt" timestamp,
  "lastErrorMessage" text,
  "recordedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_uqm_machine" ON "upload_queue_metrics" ("machineId");
CREATE INDEX IF NOT EXISTS "idx_uqm_recorded" ON "upload_queue_metrics" ("recordedAt");
