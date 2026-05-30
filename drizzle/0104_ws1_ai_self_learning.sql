-- WS-1 — AI self-learning loop (additive, nullable, idempotent)
-- All columns NULLABLE; safe to run on existing data. The partial unique index
-- dedupes existing auto-scan rows BEFORE creation.

-- ── model_versions: link to dataset + baseline + full eval report ──
ALTER TABLE "model_versions" ADD COLUMN IF NOT EXISTS "datasetId" integer;
--> statement-breakpoint
ALTER TABLE "model_versions" ADD COLUMN IF NOT EXISTS "baselineVersionId" integer;
--> statement-breakpoint
ALTER TABLE "model_versions" ADD COLUMN IF NOT EXISTS "evalReport" json;
--> statement-breakpoint

-- ── training_jobs: dataset link + training mode ──
ALTER TABLE "training_jobs" ADD COLUMN IF NOT EXISTS "datasetId" integer;
--> statement-breakpoint
ALTER TABLE "training_jobs" ADD COLUMN IF NOT EXISTS "trainingMode" varchar(40) DEFAULT 'local-embedding';
--> statement-breakpoint

-- ── ai_label_queue: dedupe then partial unique index for idempotent auto-scan ──
-- Keep the lowest id per (modelId, inspectionId, measurementResultId) where the
-- key columns are NOT NULL (the auto-scan path always sets modelId, and at least
-- one of inspectionId/measurementResultId). NULLs are excluded from the index so
-- manually-enqueued rows without inspection context are never blocked.
DELETE FROM "ai_label_queue" a
USING "ai_label_queue" b
WHERE a."id" > b."id"
  AND a."modelId" = b."modelId"
  AND a."inspectionId" IS NOT DISTINCT FROM b."inspectionId"
  AND a."measurementResultId" IS NOT DISTINCT FROM b."measurementResultId"
  AND a."inspectionId" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_label_queue_model_insp_meas"
  ON "ai_label_queue" ("modelId", "inspectionId", "measurementResultId")
  WHERE "inspectionId" IS NOT NULL;
