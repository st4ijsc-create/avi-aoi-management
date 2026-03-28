-- Migration: Add AI Quality Gate columns to product_inspections
-- These columns are defined in the Drizzle schema but missing from the actual database table

-- Create the aidecisionenum type if it doesn't exist
DO $$ BEGIN
  CREATE TYPE "aidecisionenum" AS ENUM ('AUTO_OK', 'AUTO_NG', 'NEEDS_REVIEW', 'MANUAL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add missing AI columns to product_inspections
ALTER TABLE "product_inspections" ADD COLUMN IF NOT EXISTS "aiDecision" "aidecisionenum";
ALTER TABLE "product_inspections" ADD COLUMN IF NOT EXISTS "aiConfidence" numeric(5, 4);
ALTER TABLE "product_inspections" ADD COLUMN IF NOT EXISTS "aiModelId" integer;
ALTER TABLE "product_inspections" ADD COLUMN IF NOT EXISTS "aiProcessedAt" timestamp;
ALTER TABLE "product_inspections" ADD COLUMN IF NOT EXISTS "aiDetails" json;
