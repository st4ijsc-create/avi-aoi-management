-- Migration: Package Activity Logs
-- Nhật ký hoạt động upload gói tin AOI - theo dõi presign, upload, commit, lỗi, xem, tải
-- ============================================================

-- 1. Create event enum
DO $$ BEGIN
  CREATE TYPE "package_activity_log_event" AS ENUM (
    'presign',
    'upload_start',
    'upload_success',
    'upload_fail',
    'commit_start',
    'commit_success',
    'commit_fail',
    'retry',
    'image_view',
    'zip_download',
    'status_change'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Create the activity logs table
CREATE TABLE IF NOT EXISTS "package_activity_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "packageDbId" integer NOT NULL,
  "packageId" varchar(100) NOT NULL,
  "machineId" integer,
  "event" "package_activity_log_event" NOT NULL,
  "level" varchar(10) NOT NULL DEFAULT 'info',
  "message" text NOT NULL,
  "detail" text,
  "source" varchar(30),
  "userId" integer,
  "userName" varchar(100),
  "ipAddress" varchar(45),
  "userAgent" varchar(500),
  "durationMs" integer,
  "fileSizeBytes" bigint,
  "metadata" json,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- 3. Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS "idx_pal_package" ON "package_activity_logs" ("packageDbId");
CREATE INDEX IF NOT EXISTS "idx_pal_package_id" ON "package_activity_logs" ("packageId");
CREATE INDEX IF NOT EXISTS "idx_pal_event" ON "package_activity_logs" ("event");
CREATE INDEX IF NOT EXISTS "idx_pal_created" ON "package_activity_logs" ("createdAt");
CREATE INDEX IF NOT EXISTS "idx_pal_machine" ON "package_activity_logs" ("machineId");
