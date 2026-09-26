-- ============================================================================
-- Migration 0301: training_datasets — content-hash lineage (doc69 F3/D3, G10).
--
-- Ties a `training_datasets` row to a deterministic sha256 fingerprint of the
-- exact samples it was materialized from (sorted (imageUrl,label) sample ids —
-- see server/services/aiDatasetBuilder.ts computeContentHash/hashDatasetSamples/
-- hashSegDatasetSamples). Same samples → identical hash; any addition,
-- removal, or label edit → a different hash. The eval harness
-- (aiEvalHarness.compareBeforeAfter) independently recomputes the SAME hash
-- from the materialized manifest files (computeDatasetManifestHash) and pins
-- it into `model_versions.evalReport.datasetContentHash` (an EXISTING JSON
-- column, migration 0104 — no new column needed there) — so this column is a
-- convenience/audit pin on the dataset row itself, not a dependency of the
-- harness's lineage guarantee.
--
-- ADDITIVE + IDEMPOTENT. Run by owner `aoi` (DDL convention — do not run as a
-- non-owner role). NOT RUN as part of this task: aiDatasetBuilder.ts writes
-- this column via a narrow raw SQL UPDATE wrapped in try/catch
-- (pinDatasetContentHash) — absence degrades to a logged warning, never
-- throws; the hash is always returned from buildDataset/buildSegmentationDataset
-- regardless of whether this column exists. This column is intentionally NOT
-- added to the Drizzle `trainingDatasets` pgTable (drizzle/schema/ai.ts) so the
-- existing full-row `getTrainingDataset`/`getTrainingDatasets` selects
-- (server/db/aiAdvanced.ts, used across the app) are never at risk of a 42703
-- undefined_column error before this migration runs.
-- ROLLBACK: ALTER TABLE "training_datasets" DROP COLUMN IF EXISTS "contentHash";
-- ============================================================================

ALTER TABLE "training_datasets"
  ADD COLUMN IF NOT EXISTS "contentHash" varchar(64);
