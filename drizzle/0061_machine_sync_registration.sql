-- Migration: Add machine sync/registration fields
-- Date: 2026-02-13
-- Description: Add serialNumber, firmwareVersion, registrationStatus, syncMode, lastSyncAt, pendingConfig fields to machines table

-- Add new columns to machines table
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "serialNumber" varchar(100);
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "firmwareVersion" varchar(50);
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "registrationStatus" varchar(20) NOT NULL DEFAULT 'approved';
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "syncMode" "statusenum_1" NOT NULL DEFAULT 'online';
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "lastSyncAt" timestamp;
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "pendingConfig" text;

-- Make apiKey nullable (allow null for pending machines)
ALTER TABLE "machines" ALTER COLUMN "apiKey" DROP NOT NULL;

-- Create indexes
CREATE INDEX IF NOT EXISTS "idx_machines_registration_status" ON "machines" ("registrationStatus");
CREATE INDEX IF NOT EXISTS "idx_machines_syncmode" ON "machines" ("syncMode");
CREATE INDEX IF NOT EXISTS "idx_machines_serial_number" ON "machines" ("serialNumber");

-- Set existing machines as approved
UPDATE "machines" SET "registrationStatus" = 'approved' WHERE "registrationStatus" IS NULL OR "registrationStatus" = 'pending';
