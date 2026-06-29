-- 0131 — P0-A data-integrity backfill: eliminate measurement_results.pointDefId = 0
-- ===========================================================================
-- BACKGROUND (audit E)
--   The AOI-ZIP ingest path (aoiPackageRouter.commit) historically inserted
--   measurement_results with a HARD-CODED pointDefId = 0. All SPC / capability /
--   defect-heatmap analytics GROUP BY pointDefId, so every pointDefId=0 row was
--   invisible to analytics. The code fix routes both ingest paths through
--   server/services/measurementPointResolver.ts (resolve-or-create → never 0).
--
-- THIS MIGRATION
--   1. Provisions a synthetic "__UNMAPPED__" product model + one synthetic
--      "__UNMAPPED__" measurement_point_defs row PER affected product model
--      (and one global one for inspections with a NULL productModelId).
--   2. Re-points existing pointDefId = 0 rows to the matching synthetic def,
--      grouped by the inspection's product model so heatmaps/SPC at least bucket
--      them coherently per product instead of collapsing everything onto id 0.
--      (The original per-point CODE was never stored on measurement_results — only
--      a free-text remark — so exact per-point re-resolution is not possible. The
--      synthetic-def grouping is the documented best-effort fallback.)
--   3. Adds a CHECK constraint (pointDefId > 0) so the bug can never recur.
--
-- FK NOTE: a hard FK measurement_results.pointDefId -> measurement_point_defs.id
--   is intentionally NOT added. ~53k legacy rows carry non-zero pointDefIds that
--   reference hard-deleted seed/test defs; an FK would fail or require deleting
--   that history. measurement_results uses soft references by design (see the
--   defectCatalogId comment in drizzle/schema/inspection.ts). The CHECK
--   constraint is the recurrence guard.
--
-- Targets at authoring time: 150 rows with pointDefId = 0
--   (103 under a NULL productModelId inspection, 27 → product 22, 20 → product 20).
-- Idempotent: safe to run multiple times.
-- Do NOT run automatically — the operator applies migrations.

-- ── 1. Synthetic UNMAPPED product model ──
INSERT INTO "product_models" ("code", "name", "description")
SELECT '__UNMAPPED__',
       'Unmapped (auto-provisioned) measurement points',
       'System placeholder for measurement-point definitions auto-created during ingest when no product model could be resolved. Re-map to the real product model when possible.'
WHERE NOT EXISTS (
  SELECT 1 FROM "product_models" WHERE "code" = '__UNMAPPED__'
);

-- ── 2. One synthetic UNMAPPED point def per affected product model ──
-- 2a. For affected inspections that DO have a productModelId.
INSERT INTO "measurement_point_defs"
  ("productModelId", "code", "name", "description", "measurementType", "positionX", "positionY")
SELECT DISTINCT pi."productModelId",
       '__UNMAPPED__',
       'Unmapped point (backfilled)',
       'Backfilled by migration 0131 for legacy AOI-ZIP rows that were stored with pointDefId = 0.',
       'VISUAL'::"measurementtypeenum",
       0, 0
FROM "measurement_results" mr
JOIN "product_inspections" pi ON pi."id" = mr."inspectionId"
WHERE mr."pointDefId" = 0
  AND pi."productModelId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "measurement_point_defs" d
    WHERE d."productModelId" = pi."productModelId"
      AND d."code" = '__UNMAPPED__'
      AND d."deletedAt" IS NULL
  );

-- 2b. One global synthetic def under the UNMAPPED product model for inspections
--     whose productModelId is NULL.
INSERT INTO "measurement_point_defs"
  ("productModelId", "code", "name", "description", "measurementType", "positionX", "positionY")
SELECT pm."id",
       '__UNMAPPED__',
       'Unmapped point (backfilled, no product model)',
       'Backfilled by migration 0131 for legacy AOI-ZIP rows (pointDefId = 0) whose inspection had no product model.',
       'VISUAL'::"measurementtypeenum",
       0, 0
FROM "product_models" pm
WHERE pm."code" = '__UNMAPPED__'
  AND NOT EXISTS (
    SELECT 1 FROM "measurement_point_defs" d
    WHERE d."productModelId" = pm."id"
      AND d."code" = '__UNMAPPED__'
      AND d."deletedAt" IS NULL
  );

-- ── 3. Re-point the orphaned rows ──
-- 3a. Rows whose inspection has a real product model → that model's synthetic def.
UPDATE "measurement_results" mr
SET "pointDefId" = d."id"
FROM "product_inspections" pi
JOIN "measurement_point_defs" d
  ON d."productModelId" = pi."productModelId"
 AND d."code" = '__UNMAPPED__'
 AND d."deletedAt" IS NULL
WHERE mr."pointDefId" = 0
  AND mr."inspectionId" = pi."id"
  AND pi."productModelId" IS NOT NULL;

-- 3b. Rows whose inspection has no product model → global UNMAPPED def.
UPDATE "measurement_results" mr
SET "pointDefId" = d."id"
FROM "product_inspections" pi,
     "product_models" pm,
     "measurement_point_defs" d
WHERE mr."pointDefId" = 0
  AND mr."inspectionId" = pi."id"
  AND pi."productModelId" IS NULL
  AND pm."code" = '__UNMAPPED__'
  AND d."productModelId" = pm."id"
  AND d."code" = '__UNMAPPED__'
  AND d."deletedAt" IS NULL;

-- ── 4. Recurrence guard: CHECK (pointDefId > 0) ──
-- pointDefId is already NOT NULL at the column level; this also bans the 0 sentinel.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_measurement_results_pointdefid_positive'
  ) THEN
    ALTER TABLE "measurement_results"
      ADD CONSTRAINT chk_measurement_results_pointdefid_positive
      CHECK ("pointDefId" > 0) NOT VALID;
  END IF;
END $$;

-- VALIDATE separately so the (already-backfilled) table is checked without a long
-- exclusive lock during the ADD. Safe to re-run; VALIDATE is a no-op once valid.
DO $$ BEGIN
  ALTER TABLE "measurement_results"
    VALIDATE CONSTRAINT chk_measurement_results_pointdefid_positive;
EXCEPTION WHEN others THEN
  RAISE WARNING 'Could not validate chk_measurement_results_pointdefid_positive: %', SQLERRM;
END $$;
