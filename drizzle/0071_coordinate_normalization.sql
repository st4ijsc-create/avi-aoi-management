-- Add normalized coordinates to measurement_point_defs
-- normalizedX/normalizedY store coordinates as percentage (0.0 - 1.0) of the reference image dimensions
-- This ensures coordinate portability across different image resolutions
ALTER TABLE "measurement_point_defs" ADD COLUMN IF NOT EXISTS "normalizedX" decimal(10, 8);
ALTER TABLE "measurement_point_defs" ADD COLUMN IF NOT EXISTS "normalizedY" decimal(10, 8);
ALTER TABLE "measurement_point_defs" ADD COLUMN IF NOT EXISTS "normalizedRadius" decimal(10, 8);

-- Add points config version to product_models for sync protocol
ALTER TABLE "product_models" ADD COLUMN IF NOT EXISTS "pointsConfigVersion" integer DEFAULT 1 NOT NULL;

-- Backfill normalized coordinates for existing data where imageWidth/imageHeight are available
UPDATE "measurement_point_defs" mpd
SET
  "normalizedX" = CASE WHEN pm."imageWidth" > 0 THEN CAST(mpd."positionX" AS decimal(10,8)) / pm."imageWidth" ELSE NULL END,
  "normalizedY" = CASE WHEN pm."imageHeight" > 0 THEN CAST(mpd."positionY" AS decimal(10,8)) / pm."imageHeight" ELSE NULL END,
  "normalizedRadius" = CASE WHEN pm."imageWidth" > 0 THEN CAST(mpd."radius" AS decimal(10,8)) / pm."imageWidth" ELSE NULL END
FROM "product_models" pm
WHERE mpd."productModelId" = pm."id"
  AND mpd."normalizedX" IS NULL
  AND pm."imageWidth" IS NOT NULL
  AND pm."imageHeight" IS NOT NULL;
