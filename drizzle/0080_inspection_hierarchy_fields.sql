-- Add enterprise hierarchy and production context columns to product_inspections
-- These fields were accepted by submitInspection API and AOI Package meta.json
-- but were silently dropped / caused crashes because the columns didn't exist.

ALTER TABLE "product_inspections" ADD COLUMN IF NOT EXISTS "workshopCode" varchar(50);
ALTER TABLE "product_inspections" ADD COLUMN IF NOT EXISTS "lineCode" varchar(50);
ALTER TABLE "product_inspections" ADD COLUMN IF NOT EXISTS "stageCode" varchar(50);
ALTER TABLE "product_inspections" ADD COLUMN IF NOT EXISTS "productionOrderCode" varchar(100);
ALTER TABLE "product_inspections" ADD COLUMN IF NOT EXISTS "operatorId" varchar(50);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS "idx_inspections_workshop" ON "product_inspections" ("workshopCode");
CREATE INDEX IF NOT EXISTS "idx_inspections_line" ON "product_inspections" ("lineCode");
CREATE INDEX IF NOT EXISTS "idx_inspections_production_order" ON "product_inspections" ("productionOrderCode");
