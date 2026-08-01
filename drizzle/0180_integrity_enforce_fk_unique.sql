-- ============================================================================
-- Migration 0180: Master-data FK + UNIQUE ENFORCEMENT, conditional (doc 27 §2
-- M1 P1 / M6 P2 / M11 P2 — Đợt 3 item 3.1, agent W3-A). PHASE 2 of 2.
-- Run 0179 (orphan audit) first — this file assumes integrity_scan_results
-- and db_feature_status (0172) exist.
--
-- STRATEGY (safe on a dirty, live database):
--   • Each FK is added with NOT VALID → NEW writes are checked immediately,
--     existing rows are untouched, and the ADD takes only a brief lock.
--   • VALIDATE CONSTRAINT runs ONLY when the live orphan count is zero at
--     migration time (EXISTS probe first, full count only when dirty).
--     Dirty relationships stay NOT VALID with a RAISE WARNING + a
--     db_feature_status row ('deferred') until scripts/repair-orphans.mjs
--     cleans them; re-running this migration then validates (idempotent).
--   • Unique indexes are built ONLY when no duplicates exist; otherwise
--     deferred the same way. Hierarchy code uniqueness is PARTIAL
--     (WHERE "isActive") because hierarchy deletes are soft and a retired
--     code may be reused. The mapping-pair unique is FULL (join table).
--
-- ON DELETE decisions (deliberate, per relationship):
--   RESTRICT  — structure + traceability: hierarchy chain, machines.stationId,
--               product_inspections.machineId (can't hard-delete a machine
--               that owns inspection history), measurement_results.pointDefId
--               (NOT NULL ⇒ SET NULL impossible; app soft-deletes point defs
--               anyway), machine_recipes.machineId, recipe_deployments
--               .recipeId/.machineId (audit-grade deploy records).
--   CASCADE   — children die with their parent: measurement_results
--               .inspectionId (a result is meaningless without its
--               inspection), product_machine_mappings both sides (pure join
--               rows).
--   SET NULL  — soft annotations: measurement_results.defectCatalogId [M11],
--               recipe_deployments.previousRecipeId (rollback pointer).
--
-- ⚠ TIMESCALEDB / HYPERTABLE CAVEAT (0172 converts product_inspections +
--   measurement_results to hypertables when the extension is present):
--   • FKs FROM a hypertable to a plain table ARE supported by Timescale —
--     product_inspections.machineId, measurement_results.pointDefId /
--     .defectCatalogId enforce normally. If a Timescale version rejects the
--     ADD (e.g. NOT VALID unsupported on hypertables) the per-constraint
--     EXCEPTION handler retries a plain ADD when clean, else records
--     'skipped' in db_feature_status instead of failing the migration.
--   • FKs TO a hypertable are NOT supported: measurement_results
--     .inspectionId → product_inspections is hypertable→hypertable, so when
--     either table is a hypertable (or product_inspections has the composite
--     (id,"inspectionTime") PK from 0172) that FK is SKIPPED with a WARNING
--     and recorded in db_feature_status — app-level integrity + the weekly
--     integrityScanService orphan scan cover that relationship instead.
--     On plain-PG dev it enforces normally.
--   • ⚠ ORDER-OF-OPERATIONS: if this ran on plain PG (FK enforced) and the DB
--     is LATER moved to a Timescale image, re-applying 0172 will FAIL at
--     create_hypertable('product_inspections') while the incoming FK exists.
--     Drop it first:  ALTER TABLE measurement_results
--                       DROP CONSTRAINT fk_measurement_results_inspection;
--     then re-run 0172 (the orphan scanner keeps covering the relationship).
--
-- PERFORMANCE NOTES: product_inspections.machineId FK adds a per-insert
-- parent-PK lookup (machines is small — negligible, and idx_inspections_machine
-- already exists for parent-side checks). Index builds below cannot use
-- CONCURRENTLY (transactional migration) — on a populated production DB run
-- in an off-peak window.
--
-- IDEMPOTENT: constraints/indexes guarded by existence checks; VALIDATE on an
-- already-valid constraint is a no-op. Re-run after repairing orphans.
-- Applied by scripts/migrate-standalone.mjs or run-0179-0180-migration.mjs.
-- ============================================================================

-- ── Supporting indexes for the SET NULL scans (parent-delete side) ───────────
-- measurement_results.defectCatalogId had NO index — ON DELETE SET NULL on a
-- defect_catalog row would seq-scan the results table without this. Partial:
-- only rows that actually carry a defect reference.
CREATE INDEX IF NOT EXISTS "idx_results_defect_catalog"
  ON "measurement_results" ("defectCatalogId") WHERE "defectCatalogId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_recipe_deployments_previous"
  ON "recipe_deployments" ("previousRecipeId") WHERE "previousRecipeId" IS NOT NULL;

-- ── Foreign keys: add NOT VALID, validate only when clean ────────────────────
DO $$
DECLARE
  spec record;
  v_skip_mr_pi boolean := false;
  v_has_ts boolean;
  v_exists boolean;
  v_validated boolean;
  v_dirty boolean;
  v_count bigint;
  v_feature text;
BEGIN
  -- Hypertable / composite-PK detection for the mr→pi FK (see header).
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') INTO v_has_ts;
  IF v_has_ts THEN
    SELECT EXISTS (
      SELECT 1 FROM timescaledb_information.hypertables
      WHERE hypertable_schema = 'public'
        AND hypertable_name IN ('product_inspections', 'measurement_results')
    ) INTO v_skip_mr_pi;
  END IF;
  IF NOT v_skip_mr_pi THEN
    -- Also skip when product_inspections has no unique constraint on (id) alone
    -- (0172 composite PK) — an FK on inspectionId could not bind to it anyway.
    SELECT NOT EXISTS (
      SELECT 1 FROM pg_constraint pc
      WHERE pc.conrelid = 'product_inspections'::regclass
        AND pc.contype IN ('p', 'u')
        AND pc.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                               WHERE attrelid = 'product_inspections'::regclass
                                 AND attname = 'id')]
    ) INTO v_skip_mr_pi;
  END IF;

  FOR spec IN
    SELECT * FROM (VALUES
      -- (conname, child table, FK column list, parent table, referenced cols,
      --  ON DELETE, orphan-probe FROM/WHERE fragment)
      ('fk_machines_station', 'machines', '"stationId"', 'stations', '(id)', 'RESTRICT',
       'FROM machines c LEFT JOIN stations p ON c."stationId" = p.id WHERE p.id IS NULL'),
      ('fk_stations_line', 'stations', '"lineId"', 'production_lines', '(id)', 'RESTRICT',
       'FROM stations c LEFT JOIN production_lines p ON c."lineId" = p.id WHERE p.id IS NULL'),
      ('fk_production_lines_workshop', 'production_lines', '"workshopId"', 'workshops', '(id)', 'RESTRICT',
       'FROM production_lines c LEFT JOIN workshops p ON c."workshopId" = p.id WHERE p.id IS NULL'),
      ('fk_workshops_factory', 'workshops', '"factoryId"', 'factories', '(id)', 'RESTRICT',
       'FROM workshops c LEFT JOIN factories p ON c."factoryId" = p.id WHERE p.id IS NULL'),
      ('fk_factories_corporate', 'factories', '"corporateCode"', 'corporates', '(code)', 'RESTRICT',
       'FROM factories c LEFT JOIN corporates p ON c."corporateCode" = p.code WHERE c."corporateCode" IS NOT NULL AND p.id IS NULL'),
      ('fk_product_inspections_machine', 'product_inspections', '"machineId"', 'machines', '(id)', 'RESTRICT',
       'FROM product_inspections c LEFT JOIN machines p ON c."machineId" = p.id WHERE p.id IS NULL'),
      ('fk_measurement_results_inspection', 'measurement_results', '"inspectionId"', 'product_inspections', '(id)', 'CASCADE',
       'FROM measurement_results c LEFT JOIN product_inspections p ON c."inspectionId" = p.id WHERE p.id IS NULL'),
      ('fk_measurement_results_point_def', 'measurement_results', '"pointDefId"', 'measurement_point_defs', '(id)', 'RESTRICT',
       'FROM measurement_results c LEFT JOIN measurement_point_defs p ON c."pointDefId" = p.id WHERE p.id IS NULL'),
      ('fk_measurement_results_defect_catalog', 'measurement_results', '"defectCatalogId"', 'defect_catalog', '(id)', 'SET NULL',
       'FROM measurement_results c LEFT JOIN defect_catalog p ON c."defectCatalogId" = p.id WHERE c."defectCatalogId" IS NOT NULL AND p.id IS NULL'),
      ('fk_pm_mappings_product', 'product_machine_mappings', '"productModelId"', 'product_models', '(id)', 'CASCADE',
       'FROM product_machine_mappings c LEFT JOIN product_models p ON c."productModelId" = p.id WHERE p.id IS NULL'),
      ('fk_pm_mappings_machine', 'product_machine_mappings', '"machineId"', 'machines', '(id)', 'CASCADE',
       'FROM product_machine_mappings c LEFT JOIN machines p ON c."machineId" = p.id WHERE p.id IS NULL'),
      ('fk_machine_recipes_machine', 'machine_recipes', '"machineId"', 'machines', '(id)', 'RESTRICT',
       'FROM machine_recipes c LEFT JOIN machines p ON c."machineId" = p.id WHERE c."machineId" IS NOT NULL AND p.id IS NULL'),
      ('fk_recipe_deployments_recipe', 'recipe_deployments', '"recipeId"', 'machine_recipes', '(id)', 'RESTRICT',
       'FROM recipe_deployments c LEFT JOIN machine_recipes p ON c."recipeId" = p.id WHERE p.id IS NULL'),
      ('fk_recipe_deployments_machine', 'recipe_deployments', '"machineId"', 'machines', '(id)', 'RESTRICT',
       'FROM recipe_deployments c LEFT JOIN machines p ON c."machineId" = p.id WHERE p.id IS NULL'),
      ('fk_recipe_deployments_previous_recipe', 'recipe_deployments', '"previousRecipeId"', 'machine_recipes', '(id)', 'SET NULL',
       'FROM recipe_deployments c LEFT JOIN machine_recipes p ON c."previousRecipeId" = p.id WHERE c."previousRecipeId" IS NOT NULL AND p.id IS NULL')
    ) AS t(conname, child, fkcols, parent, refcols, ondelete, orphan_frag)
  LOOP
    v_feature := 'integrity_' || spec.conname;

    -- Hypertable-blocked relationship: skip + record, scanner covers it.
    IF spec.conname = 'fk_measurement_results_inspection' AND v_skip_mr_pi THEN
      RAISE WARNING '[0180] SKIP % — product_inspections/measurement_results are TimescaleDB hypertables (or composite-PK); Timescale does not support FKs referencing a hypertable. App-level integrity + the weekly integrityScanService orphan scan cover this relationship.', spec.conname;
      INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
      VALUES (v_feature, 'skipped-hypertable',
              'FK to a hypertable is unsupported by TimescaleDB — covered by app-level checks + weekly orphan scan (integrity_scan_results). See 0180 header.',
              now())
      ON CONFLICT ("feature") DO UPDATE
        SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
      CONTINUE;
    END IF;

    -- 1. Ensure the constraint exists (NOT VALID first — cheap + safe).
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = spec.conname AND conrelid = spec.child::regclass
    ) INTO v_exists;

    IF NOT v_exists THEN
      BEGIN
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES %I %s ON DELETE %s NOT VALID',
                       spec.child, spec.conname, spec.fkcols, spec.parent, spec.refcols, spec.ondelete);
        v_exists := true;
      EXCEPTION WHEN OTHERS THEN
        -- e.g. a Timescale version that rejects NOT VALID on hypertables →
        -- retry a plain (immediately-validating) ADD, but only when clean.
        EXECUTE 'SELECT EXISTS (SELECT 1 ' || spec.orphan_frag || ')' INTO v_dirty;
        IF NOT v_dirty THEN
          BEGIN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES %I %s ON DELETE %s',
                           spec.child, spec.conname, spec.fkcols, spec.parent, spec.refcols, spec.ondelete);
            v_exists := true;
          EXCEPTION WHEN OTHERS THEN
            v_exists := false;
          END;
        ELSE
          v_exists := false;
        END IF;
        IF NOT v_exists THEN
          RAISE WARNING '[0180] could not add FK % on % (%). Recorded as skipped in db_feature_status; the weekly orphan scan still covers it.',
            spec.conname, spec.child, SQLERRM;
          INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
          VALUES (v_feature, 'skipped', 'ADD CONSTRAINT failed: ' || SQLERRM, now())
          ON CONFLICT ("feature") DO UPDATE
            SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
          CONTINUE;
        END IF;
      END;
    END IF;

    -- 2. Validate only when clean (EXISTS probe first — cheap on huge tables).
    SELECT convalidated INTO v_validated
    FROM pg_constraint WHERE conname = spec.conname AND conrelid = spec.child::regclass;

    IF v_validated THEN
      INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
      VALUES (v_feature, 'ok', 'FK enforced + validated (ON DELETE ' || spec.ondelete || ')', now())
      ON CONFLICT ("feature") DO UPDATE
        SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
      CONTINUE;
    END IF;

    EXECUTE 'SELECT EXISTS (SELECT 1 ' || spec.orphan_frag || ')' INTO v_dirty;
    IF NOT v_dirty THEN
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', spec.child, spec.conname);
      INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
      VALUES (v_feature, 'ok', 'FK enforced + validated (ON DELETE ' || spec.ondelete || ')', now())
      ON CONFLICT ("feature") DO UPDATE
        SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
    ELSE
      EXECUTE 'SELECT count(*) ' || spec.orphan_frag INTO v_count;
      RAISE WARNING '[0180] % added NOT VALID but left UNVALIDATED — % orphan row(s) in %. New writes ARE checked; existing orphans remain. Repair: node scripts/repair-orphans.mjs, then re-run this migration.',
        spec.conname, v_count, spec.child;
      INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
      VALUES (v_feature, 'deferred',
              'FK NOT VALID — ' || v_count || ' pre-existing orphan(s); new writes checked. Repair then re-apply 0180.',
              now())
      ON CONFLICT ("feature") DO UPDATE
        SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
    END IF;
  END LOOP;
END $$;

-- ── Unique indexes [M6]: build only when duplicate-free ──────────────────────
DO $$
DECLARE
  spec record;
  v_dirty boolean;
  v_count bigint;
  v_feature text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('uq_workshops_factory_code_active', 'workshops', '("factoryId", code)', ' WHERE "isActive"',
       'SELECT 1 FROM workshops WHERE "isActive" GROUP BY "factoryId", code HAVING count(*) > 1'),
      ('uq_production_lines_workshop_code_active', 'production_lines', '("workshopId", code)', ' WHERE "isActive"',
       'SELECT 1 FROM production_lines WHERE "isActive" GROUP BY "workshopId", code HAVING count(*) > 1'),
      ('uq_stations_line_code_active', 'stations', '("lineId", code)', ' WHERE "isActive"',
       'SELECT 1 FROM stations WHERE "isActive" GROUP BY "lineId", code HAVING count(*) > 1'),
      ('uq_pm_mappings_pair', 'product_machine_mappings', '("productModelId", "machineId")', '',
       'SELECT 1 FROM product_machine_mappings GROUP BY "productModelId", "machineId" HAVING count(*) > 1')
    ) AS t(idxname, tbl, cols, predicate, dup_probe)
  LOOP
    v_feature := 'integrity_' || spec.idxname;

    IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = spec.idxname) THEN
      INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
      VALUES (v_feature, 'ok', 'unique index present', now())
      ON CONFLICT ("feature") DO UPDATE
        SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
      CONTINUE;
    END IF;

    EXECUTE 'SELECT EXISTS (' || spec.dup_probe || ')' INTO v_dirty;
    IF v_dirty THEN
      EXECUTE 'SELECT count(*) FROM (' || spec.dup_probe || ') d' INTO v_count;
      RAISE WARNING '[0180] unique index % on % DEFERRED — % duplicate group(s). Dedupe (see integrity_scan_results samples / scripts/repair-orphans.mjs guidance), then re-run this migration.',
        spec.idxname, spec.tbl, v_count;
      INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
      VALUES (v_feature, 'deferred',
              'unique index NOT built — ' || v_count || ' duplicate group(s). Dedupe then re-apply 0180.',
              now())
      ON CONFLICT ("feature") DO UPDATE
        SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
    ELSE
      BEGIN
        EXECUTE format('CREATE UNIQUE INDEX %I ON %I %s%s', spec.idxname, spec.tbl, spec.cols, spec.predicate);
        INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
        VALUES (v_feature, 'ok', 'unique index built', now())
        ON CONFLICT ("feature") DO UPDATE
          SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
      EXCEPTION WHEN OTHERS THEN
        -- Duplicates raced in between probe and build — defer, don't fail.
        RAISE WARNING '[0180] unique index % build failed (%) — deferred.', spec.idxname, SQLERRM;
        INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
        VALUES (v_feature, 'deferred', 'index build failed: ' || SQLERRM, now())
        ON CONFLICT ("feature") DO UPDATE
          SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
      END;
    END IF;
  END LOOP;
END $$;
