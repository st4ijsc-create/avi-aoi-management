-- Doc 31 Đợt E (WE-3) — Defect taxonomy consolidation
-- WB-2 finding: the catalog carries 5 duplicate pairs, seeded twice — the older
-- 0086/0089 IPC-A-610 codes AND the newer 0137 "p4e" taxonomy seed:
--     BRIDGING (0086)               ↔ SOLDER_BRIDGE (0137)
--     COLD_JOINT (0086)             ↔ COLD_SOLDER (0137)
--     VOID (0086)                   ↔ SOLDER_VOID (0137)
--     COMPONENT_MISALIGNMENT (0086) ↔ MISALIGNMENT (0137)
--     REVERSE_POLARITY (0086)       ↔ REVERSED_POLARITY (0137)
--
-- CANONICAL SURVIVORS = the 0086/0089 codes. Rationale: every vendor DEFECT_MAP
-- (ictAoi/mirtec/sakiAoi/genericJson) ALREADY normalises incoming tokens to these
-- (e.g. `SOLDER_BRIDGE → BRIDGING`, `COLD_SOLDER → COLD_JOINT`,
-- `MISALIGNMENT → COMPONENT_MISALIGNMENT`), so the survivors are what the ingest
-- path already resolves to. The 0137 duplicates are only reachable when a raw code
-- is submitted directly (genericJson passthrough / manual / VLM classification).
--
-- Strategy (no hard delete): re-point any operational references to the survivor,
-- then retire the duplicate (isActive=false) and record `aliasOfCode` so an incoming
-- duplicate code still resolves forward (getDefectCatalogByCode falls back to the
-- alias). Idempotent — safe to re-run.

-- 1) Forward-alias column + partial index.
ALTER TABLE "defect_catalog" ADD COLUMN IF NOT EXISTS "aliasOfCode" varchar(50);
CREATE INDEX IF NOT EXISTS "idx_defect_catalog_alias_of_code"
  ON "defect_catalog" ("aliasOfCode") WHERE "aliasOfCode" IS NOT NULL;

-- 2) Merge each pair: re-point data → survivor, retire + alias the duplicate.
DO $$
DECLARE
  pair      RECORD;
  survivor_id int;
  dup_id      int;
BEGIN
  FOR pair IN
    SELECT * FROM (VALUES
      ('BRIDGING',               'SOLDER_BRIDGE'),
      ('COLD_JOINT',             'COLD_SOLDER'),
      ('VOID',                   'SOLDER_VOID'),
      ('COMPONENT_MISALIGNMENT', 'MISALIGNMENT'),
      ('REVERSE_POLARITY',       'REVERSED_POLARITY')
    ) AS t(survivor, dup)
  LOOP
    SELECT id INTO survivor_id FROM defect_catalog
      WHERE code = pair.survivor AND "deletedAt" IS NULL
      ORDER BY id LIMIT 1;
    SELECT id INTO dup_id FROM defect_catalog
      WHERE code = pair.dup AND "deletedAt" IS NULL
      ORDER BY id LIMIT 1;

    -- Nothing to do if either side is missing or they are the same row.
    IF survivor_id IS NULL OR dup_id IS NULL OR survivor_id = dup_id THEN
      CONTINUE;
    END IF;

    -- Re-point every column that references defect_catalog.id (all guarded).
    IF to_regclass('public.measurement_results') IS NOT NULL THEN
      UPDATE measurement_results SET "defectCatalogId" = survivor_id
        WHERE "defectCatalogId" = dup_id;
    END IF;
    IF to_regclass('public.defect_segmentations') IS NOT NULL THEN
      UPDATE defect_segmentations SET "defectCatalogId" = survivor_id
        WHERE "defectCatalogId" = dup_id;
    END IF;
    IF to_regclass('public.unmatched_defect_codes') IS NOT NULL THEN
      UPDATE unmatched_defect_codes SET "resolvedCatalogId" = survivor_id
        WHERE "resolvedCatalogId" = dup_id;
    END IF;

    -- Retire the duplicate and record the forward alias.
    UPDATE defect_catalog
      SET "isActive" = false,
          "aliasOfCode" = pair.survivor,
          "updatedAt" = now()
      WHERE id = dup_id;

    RAISE NOTICE '[0201] merged % (id=%) -> % (id=%)', pair.dup, dup_id, pair.survivor, survivor_id;
  END LOOP;
END $$;
