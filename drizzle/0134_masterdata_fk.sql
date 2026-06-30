-- ============================================================================
-- P2 — Master-data backbone: add nullable FK id columns ALONGSIDE the existing
-- free-text code columns on BOM / feeder / material-flow tables, backfill by
-- code match where a master row exists, then add nullable + NOT VALID FK
-- constraints so existing/unmatched rows never fail.
--
-- ADDITIVE & NON-DESTRUCTIVE: the original free-text columns (supplierCode,
-- materialCode, componentCode) are intentionally KEPT for the transition period.
-- Fully idempotent (IF NOT EXISTS / guarded constraint adds).
-- ============================================================================

-- ── material_receipts: supplierCode -> suppliers.id, materialCode -> materials.id
ALTER TABLE material_receipts ADD COLUMN IF NOT EXISTS "supplierId" integer;
ALTER TABLE material_receipts ADD COLUMN IF NOT EXISTS "materialId" integer;

UPDATE material_receipts mr
SET "supplierId" = s.id
FROM suppliers s
WHERE mr."supplierId" IS NULL
  AND mr."supplierCode" IS NOT NULL
  AND s.code = mr."supplierCode";

UPDATE material_receipts mr
SET "materialId" = m.id
FROM materials m
WHERE mr."materialId" IS NULL
  AND mr."materialCode" IS NOT NULL
  AND m.code = mr."materialCode";

CREATE INDEX IF NOT EXISTS idx_matrecv_supplierid ON material_receipts ("supplierId");
CREATE INDEX IF NOT EXISTS idx_matrecv_materialid ON material_receipts ("materialId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_matrecv_supplier') THEN
    ALTER TABLE material_receipts
      ADD CONSTRAINT fk_matrecv_supplier FOREIGN KEY ("supplierId") REFERENCES suppliers (id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_matrecv_material') THEN
    ALTER TABLE material_receipts
      ADD CONSTRAINT fk_matrecv_material FOREIGN KEY ("materialId") REFERENCES materials (id) NOT VALID;
  END IF;
END $$;

-- ── supplier_lots: materialCode -> materials.id
ALTER TABLE supplier_lots ADD COLUMN IF NOT EXISTS "materialId" integer;

UPDATE supplier_lots sl
SET "materialId" = m.id
FROM materials m
WHERE sl."materialId" IS NULL
  AND sl."materialCode" IS NOT NULL
  AND m.code = sl."materialCode";

CREATE INDEX IF NOT EXISTS idx_suplot_materialid ON supplier_lots ("materialId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_suplot_material') THEN
    ALTER TABLE supplier_lots
      ADD CONSTRAINT fk_suplot_material FOREIGN KEY ("materialId") REFERENCES materials (id) NOT VALID;
  END IF;
END $$;

-- ── bom_line_items: componentCode -> materials.id
ALTER TABLE bom_line_items ADD COLUMN IF NOT EXISTS "materialId" integer;

UPDATE bom_line_items bli
SET "materialId" = m.id
FROM materials m
WHERE bli."materialId" IS NULL
  AND bli."componentCode" IS NOT NULL
  AND m.code = bli."componentCode";

CREATE INDEX IF NOT EXISTS idx_bomline_materialid ON bom_line_items ("materialId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_bomline_material') THEN
    ALTER TABLE bom_line_items
      ADD CONSTRAINT fk_bomline_material FOREIGN KEY ("materialId") REFERENCES materials (id) NOT VALID;
  END IF;
END $$;

-- ── feeder_materials: componentCode -> materials.id
ALTER TABLE feeder_materials ADD COLUMN IF NOT EXISTS "materialId" integer;

UPDATE feeder_materials fm
SET "materialId" = m.id
FROM materials m
WHERE fm."materialId" IS NULL
  AND fm."componentCode" IS NOT NULL
  AND m.code = fm."componentCode";

CREATE INDEX IF NOT EXISTS idx_feeder_materialid ON feeder_materials ("materialId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_feeder_material') THEN
    ALTER TABLE feeder_materials
      ADD CONSTRAINT fk_feeder_material FOREIGN KEY ("materialId") REFERENCES materials (id) NOT VALID;
  END IF;
END $$;
