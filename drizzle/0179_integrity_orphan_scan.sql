-- ============================================================================
-- Migration 0179: Master-data ORPHAN AUDIT + repair scaffold (doc 27 §2
-- M1 P1 / M6 P2 / M11 P2 — Đợt 3 item 3.1, agent W3-A). PHASE 1 of 2.
--
-- PROBLEM (M1): the master-data domain has near-zero DB-level integrity —
-- machines.stationId, the whole hierarchy chain, product_inspections.machineId,
-- measurement_results.{inspectionId,pointDefId,defectCatalogId},
-- product_machine_mappings, machine_recipes/recipe_deployments are ALL
-- soft references. (M6): workshop/line/station codes are not unique per
-- parent and product↔machine mapping pairs can duplicate. (M11): defect
-- references can dangle when the catalog changes.
--
-- DISCIPLINE — two-phase enforcement on a LIVE, possibly-dirty database:
--   0179 (this file)  = AUDIT ONLY. Creates the `integrity_scan_results`
--                       report table and records the CURRENT orphan /
--                       duplicate count + sample ids for every target
--                       relationship. NO constraint is added here; nothing
--                       can fail on dirty data. Read-only apart from the
--                       report table.
--   0180 (next file)  = ENFORCE conditionally. Adds each FK NOT VALID (new
--                       writes checked immediately, existing rows untouched)
--                       and VALIDATEs only when the live orphan count is 0;
--                       unique indexes are built only when no duplicates
--                       exist. Dirty relationships stay NOT VALID / deferred
--                       with a loud WARNING until repaired.
--
-- REPAIR PATH: node scripts/repair-orphans.mjs  (--dry-run default; --fix
-- NULLs out soft refs; structural orphans get printed guidance only).
-- ONGOING GUARD: server/services/integrityScanService.ts re-runs these exact
-- scans weekly (+ on demand via the `integrity` tRPC router) and appends to
-- integrity_scan_results, so drift is visible during the transition period.
--
-- SCAN KEY CONTRACT: the "scanKey" strings below are shared verbatim with
-- 0180, integrityScanService.ts and scripts/repair-orphans.mjs. Keep in sync.
--
-- IDEMPOTENT: re-runnable; each run appends a fresh dated snapshot (that is
-- intentional — the table is a scan LOG, latest row per key wins).
-- Applied by scripts/migrate-standalone.mjs (tracked in __applied_migrations)
-- or targeted via run-0179-0180-migration.mjs.
-- ============================================================================

-- ── Report table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "integrity_scan_results" (
  "id"             serial PRIMARY KEY,
  -- Stable relationship identifier, e.g. 'fk:machines.stationId->stations.id'
  -- or 'uq:workshops(factoryId,code)[active]'. Shared with 0180 + services.
  "scanKey"        varchar(160) NOT NULL,
  "kind"           varchar(20)  NOT NULL,  -- 'fk-orphan' | 'unique-duplicate'
  "childTable"     varchar(100) NOT NULL,
  "childColumn"    varchar(200) NOT NULL,  -- for uniques: the composite column list
  "parentTable"    varchar(100),           -- NULL for unique-duplicate scans
  "parentColumn"   varchar(100),
  "violationCount" integer      NOT NULL,  -- orphan rows / duplicate GROUPS
  "sampleIds"      jsonb,                  -- ≤20 child ids, or duplicate key tuples
  "scanSource"     varchar(30)  NOT NULL,  -- 'migration-0179' | 'service' | 'manual'
  "scannedAt"      timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_integrity_scan_key_time"
  ON "integrity_scan_results" ("scanKey", "scannedAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_integrity_scan_time"
  ON "integrity_scan_results" ("scannedAt" DESC);

-- ── FK-orphan scans (one INSERT…SELECT per relationship) ─────────────────────
-- Sample = first 20 child PKs so an operator can inspect concrete rows.

-- 1. machines.stationId → stations.id  (0180: ON DELETE RESTRICT)
INSERT INTO integrity_scan_results ("scanKey","kind","childTable","childColumn","parentTable","parentColumn","violationCount","sampleIds","scanSource")
SELECT 'fk:machines.stationId->stations.id','fk-orphan','machines','stationId','stations','id',
  (SELECT count(*) FROM machines c LEFT JOIN stations p ON c."stationId" = p.id WHERE p.id IS NULL),
  (SELECT COALESCE(jsonb_agg(t.id), '[]'::jsonb) FROM (
     SELECT c.id FROM machines c LEFT JOIN stations p ON c."stationId" = p.id WHERE p.id IS NULL ORDER BY c.id LIMIT 20) t),
  'migration-0179';

-- 2. stations.lineId → production_lines.id  (RESTRICT)
INSERT INTO integrity_scan_results ("scanKey","kind","childTable","childColumn","parentTable","parentColumn","violationCount","sampleIds","scanSource")
SELECT 'fk:stations.lineId->production_lines.id','fk-orphan','stations','lineId','production_lines','id',
  (SELECT count(*) FROM stations c LEFT JOIN production_lines p ON c."lineId" = p.id WHERE p.id IS NULL),
  (SELECT COALESCE(jsonb_agg(t.id), '[]'::jsonb) FROM (
     SELECT c.id FROM stations c LEFT JOIN production_lines p ON c."lineId" = p.id WHERE p.id IS NULL ORDER BY c.id LIMIT 20) t),
  'migration-0179';

-- 3. production_lines.workshopId → workshops.id  (RESTRICT)
INSERT INTO integrity_scan_results ("scanKey","kind","childTable","childColumn","parentTable","parentColumn","violationCount","sampleIds","scanSource")
SELECT 'fk:production_lines.workshopId->workshops.id','fk-orphan','production_lines','workshopId','workshops','id',
  (SELECT count(*) FROM production_lines c LEFT JOIN workshops p ON c."workshopId" = p.id WHERE p.id IS NULL),
  (SELECT COALESCE(jsonb_agg(t.id), '[]'::jsonb) FROM (
     SELECT c.id FROM production_lines c LEFT JOIN workshops p ON c."workshopId" = p.id WHERE p.id IS NULL ORDER BY c.id LIMIT 20) t),
  'migration-0179';

-- 4. workshops.factoryId → factories.id  (RESTRICT)
INSERT INTO integrity_scan_results ("scanKey","kind","childTable","childColumn","parentTable","parentColumn","violationCount","sampleIds","scanSource")
SELECT 'fk:workshops.factoryId->factories.id','fk-orphan','workshops','factoryId','factories','id',
  (SELECT count(*) FROM workshops c LEFT JOIN factories p ON c."factoryId" = p.id WHERE p.id IS NULL),
  (SELECT COALESCE(jsonb_agg(t.id), '[]'::jsonb) FROM (
     SELECT c.id FROM workshops c LEFT JOIN factories p ON c."factoryId" = p.id WHERE p.id IS NULL ORDER BY c.id LIMIT 20) t),
  'migration-0179';

-- 5. factories.corporateCode → corporates.code  (RESTRICT)
--    NOTE: the actual schema links factory→corporate by CODE (varchar,
--    corporates.code UNIQUE), not by id — the FK follows the real column.
INSERT INTO integrity_scan_results ("scanKey","kind","childTable","childColumn","parentTable","parentColumn","violationCount","sampleIds","scanSource")
SELECT 'fk:factories.corporateCode->corporates.code','fk-orphan','factories','corporateCode','corporates','code',
  (SELECT count(*) FROM factories c LEFT JOIN corporates p ON c."corporateCode" = p.code
    WHERE c."corporateCode" IS NOT NULL AND p.id IS NULL),
  (SELECT COALESCE(jsonb_agg(t.id), '[]'::jsonb) FROM (
     SELECT c.id FROM factories c LEFT JOIN corporates p ON c."corporateCode" = p.code
      WHERE c."corporateCode" IS NOT NULL AND p.id IS NULL ORDER BY c.id LIMIT 20) t),
  'migration-0179';

-- 6. product_inspections.machineId → machines.id  (RESTRICT)
--    High-volume table: the FK adds a per-insert parent-PK lookup (cheap,
--    machines is small + PK-indexed); child side already has
--    idx_inspections_machine for parent-side delete checks.
INSERT INTO integrity_scan_results ("scanKey","kind","childTable","childColumn","parentTable","parentColumn","violationCount","sampleIds","scanSource")
SELECT 'fk:product_inspections.machineId->machines.id','fk-orphan','product_inspections','machineId','machines','id',
  (SELECT count(*) FROM product_inspections c LEFT JOIN machines p ON c."machineId" = p.id WHERE p.id IS NULL),
  (SELECT COALESCE(jsonb_agg(t.id), '[]'::jsonb) FROM (
     SELECT c.id FROM product_inspections c LEFT JOIN machines p ON c."machineId" = p.id WHERE p.id IS NULL ORDER BY c.id LIMIT 20) t),
  'migration-0179';

-- 7. measurement_results.inspectionId → product_inspections.id  (CASCADE)
--    ⚠ 0180 enforces this ONLY on plain PostgreSQL: when 0172 has converted
--    these two tables to TimescaleDB hypertables, FKs referencing a
--    hypertable are NOT supported — the scan below is then the ONLY guard.
INSERT INTO integrity_scan_results ("scanKey","kind","childTable","childColumn","parentTable","parentColumn","violationCount","sampleIds","scanSource")
SELECT 'fk:measurement_results.inspectionId->product_inspections.id','fk-orphan','measurement_results','inspectionId','product_inspections','id',
  (SELECT count(*) FROM measurement_results c LEFT JOIN product_inspections p ON c."inspectionId" = p.id WHERE p.id IS NULL),
  (SELECT COALESCE(jsonb_agg(t.id), '[]'::jsonb) FROM (
     SELECT c.id FROM measurement_results c LEFT JOIN product_inspections p ON c."inspectionId" = p.id WHERE p.id IS NULL ORDER BY c.id LIMIT 20) t),
  'migration-0179';

-- 8. measurement_results.pointDefId → measurement_point_defs.id  (RESTRICT)
--    Column is NOT NULL so ON DELETE SET NULL is impossible; point defs are
--    soft-deleted by the app (deletedAt), so RESTRICT only blocks raw-SQL
--    hard deletes — the historically hard-deleted defs are the orphans here.
INSERT INTO integrity_scan_results ("scanKey","kind","childTable","childColumn","parentTable","parentColumn","violationCount","sampleIds","scanSource")
SELECT 'fk:measurement_results.pointDefId->measurement_point_defs.id','fk-orphan','measurement_results','pointDefId','measurement_point_defs','id',
  (SELECT count(*) FROM measurement_results c LEFT JOIN measurement_point_defs p ON c."pointDefId" = p.id WHERE p.id IS NULL),
  (SELECT COALESCE(jsonb_agg(t.id), '[]'::jsonb) FROM (
     SELECT c.id FROM measurement_results c LEFT JOIN measurement_point_defs p ON c."pointDefId" = p.id WHERE p.id IS NULL ORDER BY c.id LIMIT 20) t),
  'migration-0179';

-- 9. measurement_results.defectCatalogId → defect_catalog.id  (SET NULL) [M11]
INSERT INTO integrity_scan_results ("scanKey","kind","childTable","childColumn","parentTable","parentColumn","violationCount","sampleIds","scanSource")
SELECT 'fk:measurement_results.defectCatalogId->defect_catalog.id','fk-orphan','measurement_results','defectCatalogId','defect_catalog','id',
  (SELECT count(*) FROM measurement_results c LEFT JOIN defect_catalog p ON c."defectCatalogId" = p.id
    WHERE c."defectCatalogId" IS NOT NULL AND p.id IS NULL),
  (SELECT COALESCE(jsonb_agg(t.id), '[]'::jsonb) FROM (
     SELECT c.id FROM measurement_results c LEFT JOIN defect_catalog p ON c."defectCatalogId" = p.id
      WHERE c."defectCatalogId" IS NOT NULL AND p.id IS NULL ORDER BY c.id LIMIT 20) t),
  'migration-0179';

-- 10. product_machine_mappings.productModelId → product_models.id  (CASCADE) [M6]
INSERT INTO integrity_scan_results ("scanKey","kind","childTable","childColumn","parentTable","parentColumn","violationCount","sampleIds","scanSource")
SELECT 'fk:product_machine_mappings.productModelId->product_models.id','fk-orphan','product_machine_mappings','productModelId','product_models','id',
  (SELECT count(*) FROM product_machine_mappings c LEFT JOIN product_models p ON c."productModelId" = p.id WHERE p.id IS NULL),
  (SELECT COALESCE(jsonb_agg(t.id), '[]'::jsonb) FROM (
     SELECT c.id FROM product_machine_mappings c LEFT JOIN product_models p ON c."productModelId" = p.id WHERE p.id IS NULL ORDER BY c.id LIMIT 20) t),
  'migration-0179';

-- 11. product_machine_mappings.machineId → machines.id  (CASCADE) [M6]
INSERT INTO integrity_scan_results ("scanKey","kind","childTable","childColumn","parentTable","parentColumn","violationCount","sampleIds","scanSource")
SELECT 'fk:product_machine_mappings.machineId->machines.id','fk-orphan','product_machine_mappings','machineId','machines','id',
  (SELECT count(*) FROM product_machine_mappings c LEFT JOIN machines p ON c."machineId" = p.id WHERE p.id IS NULL),
  (SELECT COALESCE(jsonb_agg(t.id), '[]'::jsonb) FROM (
     SELECT c.id FROM product_machine_mappings c LEFT JOIN machines p ON c."machineId" = p.id WHERE p.id IS NULL ORDER BY c.id LIMIT 20) t),
  'migration-0179';

-- 12. machine_recipes.machineId → machines.id  (RESTRICT; column nullable —
--     NULL means a machine-TYPE recipe, which is legitimate, not an orphan)
INSERT INTO integrity_scan_results ("scanKey","kind","childTable","childColumn","parentTable","parentColumn","violationCount","sampleIds","scanSource")
SELECT 'fk:machine_recipes.machineId->machines.id','fk-orphan','machine_recipes','machineId','machines','id',
  (SELECT count(*) FROM machine_recipes c LEFT JOIN machines p ON c."machineId" = p.id
    WHERE c."machineId" IS NOT NULL AND p.id IS NULL),
  (SELECT COALESCE(jsonb_agg(t.id), '[]'::jsonb) FROM (
     SELECT c.id FROM machine_recipes c LEFT JOIN machines p ON c."machineId" = p.id
      WHERE c."machineId" IS NOT NULL AND p.id IS NULL ORDER BY c.id LIMIT 20) t),
  'migration-0179';

-- 13. recipe_deployments.recipeId → machine_recipes.id  (RESTRICT — audit-grade)
INSERT INTO integrity_scan_results ("scanKey","kind","childTable","childColumn","parentTable","parentColumn","violationCount","sampleIds","scanSource")
SELECT 'fk:recipe_deployments.recipeId->machine_recipes.id','fk-orphan','recipe_deployments','recipeId','machine_recipes','id',
  (SELECT count(*) FROM recipe_deployments c LEFT JOIN machine_recipes p ON c."recipeId" = p.id WHERE p.id IS NULL),
  (SELECT COALESCE(jsonb_agg(t.id), '[]'::jsonb) FROM (
     SELECT c.id FROM recipe_deployments c LEFT JOIN machine_recipes p ON c."recipeId" = p.id WHERE p.id IS NULL ORDER BY c.id LIMIT 20) t),
  'migration-0179';

-- 14. recipe_deployments.machineId → machines.id  (RESTRICT — audit-grade)
INSERT INTO integrity_scan_results ("scanKey","kind","childTable","childColumn","parentTable","parentColumn","violationCount","sampleIds","scanSource")
SELECT 'fk:recipe_deployments.machineId->machines.id','fk-orphan','recipe_deployments','machineId','machines','id',
  (SELECT count(*) FROM recipe_deployments c LEFT JOIN machines p ON c."machineId" = p.id WHERE p.id IS NULL),
  (SELECT COALESCE(jsonb_agg(t.id), '[]'::jsonb) FROM (
     SELECT c.id FROM recipe_deployments c LEFT JOIN machines p ON c."machineId" = p.id WHERE p.id IS NULL ORDER BY c.id LIMIT 20) t),
  'migration-0179';

-- 15. recipe_deployments.previousRecipeId → machine_recipes.id  (SET NULL —
--     one-step-rollback pointer; losing it degrades gracefully)
INSERT INTO integrity_scan_results ("scanKey","kind","childTable","childColumn","parentTable","parentColumn","violationCount","sampleIds","scanSource")
SELECT 'fk:recipe_deployments.previousRecipeId->machine_recipes.id','fk-orphan','recipe_deployments','previousRecipeId','machine_recipes','id',
  (SELECT count(*) FROM recipe_deployments c LEFT JOIN machine_recipes p ON c."previousRecipeId" = p.id
    WHERE c."previousRecipeId" IS NOT NULL AND p.id IS NULL),
  (SELECT COALESCE(jsonb_agg(t.id), '[]'::jsonb) FROM (
     SELECT c.id FROM recipe_deployments c LEFT JOIN machine_recipes p ON c."previousRecipeId" = p.id
      WHERE c."previousRecipeId" IS NOT NULL AND p.id IS NULL ORDER BY c.id LIMIT 20) t),
  'migration-0179';

-- ── Unique-duplicate scans [M6] ──────────────────────────────────────────────
-- Hierarchy deletes are SOFT (isActive=false) and soft-deleted rows keep their
-- code, so uniqueness is enforced among ACTIVE rows only (partial index in
-- 0180) — a re-created workshop/line/station may reuse a retired code.
-- violationCount = number of duplicate GROUPS; samples = the duplicate keys.

-- 16. workshops (factoryId, code) among active rows
INSERT INTO integrity_scan_results ("scanKey","kind","childTable","childColumn","parentTable","parentColumn","violationCount","sampleIds","scanSource")
SELECT 'uq:workshops(factoryId,code)[active]','unique-duplicate','workshops','factoryId,code',NULL,NULL,
  (SELECT count(*) FROM (SELECT 1 FROM workshops WHERE "isActive" GROUP BY "factoryId", code HAVING count(*) > 1) d),
  (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
     SELECT "factoryId", code, count(*)::int AS n FROM workshops WHERE "isActive"
      GROUP BY "factoryId", code HAVING count(*) > 1 ORDER BY "factoryId", code LIMIT 20) t),
  'migration-0179';

-- 17. production_lines (workshopId, code) among active rows
INSERT INTO integrity_scan_results ("scanKey","kind","childTable","childColumn","parentTable","parentColumn","violationCount","sampleIds","scanSource")
SELECT 'uq:production_lines(workshopId,code)[active]','unique-duplicate','production_lines','workshopId,code',NULL,NULL,
  (SELECT count(*) FROM (SELECT 1 FROM production_lines WHERE "isActive" GROUP BY "workshopId", code HAVING count(*) > 1) d),
  (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
     SELECT "workshopId", code, count(*)::int AS n FROM production_lines WHERE "isActive"
      GROUP BY "workshopId", code HAVING count(*) > 1 ORDER BY "workshopId", code LIMIT 20) t),
  'migration-0179';

-- 18. stations (lineId, code) among active rows
INSERT INTO integrity_scan_results ("scanKey","kind","childTable","childColumn","parentTable","parentColumn","violationCount","sampleIds","scanSource")
SELECT 'uq:stations(lineId,code)[active]','unique-duplicate','stations','lineId,code',NULL,NULL,
  (SELECT count(*) FROM (SELECT 1 FROM stations WHERE "isActive" GROUP BY "lineId", code HAVING count(*) > 1) d),
  (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
     SELECT "lineId", code, count(*)::int AS n FROM stations WHERE "isActive"
      GROUP BY "lineId", code HAVING count(*) > 1 ORDER BY "lineId", code LIMIT 20) t),
  'migration-0179';

-- 19. product_machine_mappings (productModelId, machineId) — FULL unique (a
--     join-table pair must exist at most once; reactivate, don't re-insert)
INSERT INTO integrity_scan_results ("scanKey","kind","childTable","childColumn","parentTable","parentColumn","violationCount","sampleIds","scanSource")
SELECT 'uq:product_machine_mappings(productModelId,machineId)','unique-duplicate','product_machine_mappings','productModelId,machineId',NULL,NULL,
  (SELECT count(*) FROM (SELECT 1 FROM product_machine_mappings GROUP BY "productModelId", "machineId" HAVING count(*) > 1) d),
  (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
     SELECT "productModelId", "machineId", count(*)::int AS n FROM product_machine_mappings
      GROUP BY "productModelId", "machineId" HAVING count(*) > 1 ORDER BY 1, 2 LIMIT 20) t),
  'migration-0179';

-- ── Loud summary so orphans are impossible to miss in migration output ──────
DO $$
DECLARE
  r record;
  dirty int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT ON ("scanKey") "scanKey", "violationCount"
    FROM integrity_scan_results
    WHERE "scanSource" = 'migration-0179' AND "scannedAt" >= now() - interval '1 hour'
    ORDER BY "scanKey", "scannedAt" DESC
  LOOP
    IF r."violationCount" > 0 THEN
      dirty := dirty + 1;
      RAISE WARNING '[0179] % has % violation(s) — 0180 will add the FK NOT VALID (new writes checked) but DEFER validation / index build. Repair: node scripts/repair-orphans.mjs',
        r."scanKey", r."violationCount";
    END IF;
  END LOOP;
  IF dirty = 0 THEN
    RAISE NOTICE '[0179] integrity scan clean — 0180 will fully validate every constraint.';
  ELSE
    RAISE WARNING '[0179] % relationship(s) dirty — see integrity_scan_results (scanSource=migration-0179) for counts + sample ids.', dirty;
  END IF;
END $$;
