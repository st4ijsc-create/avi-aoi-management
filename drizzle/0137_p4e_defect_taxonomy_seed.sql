-- ============================================================================
-- Migration 0137: P4.E (audit E / doc 12 §6+§8) — NG → defect-code classification
--   1) Ensure defect_catalog has the classification column used by the flow.
--   2) Seed a canonical IPC-A-610 Class 2/3 defect taxonomy (idempotent).
--
-- The NG-classification link itself is `measurement_results.defectCatalogId`
-- (already present since P0-A — nullable soft reference, no FK constraint, so
-- results from BOTH ingest paths [direct API + AOI ZIP package] are
-- classifiable without a hard dependency on this table).
--
-- Additive + idempotent: re-runnable. Seed rows guard on `code`
-- (ON CONFLICT (code) DO UPDATE) so re-running refreshes labels/rules without
-- creating duplicates.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Safety: make sure the classification + i18n columns exist. These were
--    added in 0089/0098 but are repeated here with IF NOT EXISTS so a fresh DB
--    that runs 0137 in isolation still works.
-- ----------------------------------------------------------------------------
ALTER TABLE "defect_catalog"
  ADD COLUMN IF NOT EXISTS "classRules"     jsonb,
  ADD COLUMN IF NOT EXISTS "ipcSection"     varchar(20),
  ADD COLUMN IF NOT EXISTS "appliesTo"      text[],
  ADD COLUMN IF NOT EXISTS "detectableBy"   text[],
  ADD COLUMN IF NOT EXISTS "nameVi"         varchar(255),
  ADD COLUMN IF NOT EXISTS "descriptionVi"  text,
  ADD COLUMN IF NOT EXISTS "deletedAt"      timestamp;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_defect_catalog_code" ON "defect_catalog" ("code");

-- ----------------------------------------------------------------------------
-- 1) Canonical IPC-A-610 taxonomy seed.
--    Categories: solder, component, pcb, cleanliness, marking, wiring,
--                mechanical, cosmetic.
--    Sections:   §5 Soldering, §8 SMT placement, §9 Through-hole,
--                §10 Cleanliness/marking/PCB, §12 Wiring, MECH, COSM.
-- ----------------------------------------------------------------------------
INSERT INTO "defect_catalog"
  ("code","name","severity","category","ipcReference","ipcSection","acceptanceClass",
   "appliesTo","detectableBy","description","nameVi","classRules","isActive","createdAt","updatedAt")
VALUES
  -- ---- §5 Soldering ----
  ('INSUFFICIENT_SOLDER','Insufficient solder','major','solder','5.2.3','5','2',
   ARRAY['SMT','THT'],ARRAY['AOI','AXI','AVI','SPI'],
   'Solder fillet does not meet minimum wetting / fill requirements per IPC-A-610.','Thiếu thiếc',
   '{"class2":{"accept":"process","severity":"major","limit":"Fillet >= 75% of pad/lead"},"class3":{"accept":"reject","severity":"major","limit":"Fillet >= 100% of pad/lead"}}'::jsonb,true,NOW(),NOW()),
  ('EXCESS_SOLDER','Excess solder','minor','solder','5.2.4','5','3',
   ARRAY['SMT','THT'],ARRAY['AOI','AXI','AVI'],
   'Solder volume exceeds maximum fillet / pad envelope.','Dư thiếc',
   '{"class2":{"accept":"accept","severity":"minor"},"class3":{"accept":"process","severity":"minor"}}'::jsonb,true,NOW(),NOW()),
  ('SOLDER_BRIDGE','Solder bridge / short','critical','solder','5.2.5','5','2',
   ARRAY['SMT','THT','BGA','QFN'],ARRAY['AOI','AXI','AVI','ICT'],
   'Unwanted solder connection between two adjacent conductive features.','Cầu hàn / chập',
   '{"class2":{"accept":"reject","severity":"critical"},"class3":{"accept":"reject","severity":"critical"}}'::jsonb,true,NOW(),NOW()),
  ('COLD_SOLDER','Cold / disturbed solder joint','major','solder','5.2.6','5','2',
   ARRAY['SMT','THT'],ARRAY['AOI','AVI','AXI'],
   'Grainy / dull or fractured joint from insufficient heat or movement.','Mối hàn nguội',
   '{"class2":{"accept":"process","severity":"major"},"class3":{"accept":"reject","severity":"critical"}}'::jsonb,true,NOW(),NOW()),
  ('SOLDER_BALL','Solder ball','minor','solder','5.2.7','5','2',
   ARRAY['SMT'],ARRAY['AOI','AVI'],
   'Free / loose solder spheres that may migrate and cause shorts.','Bi thiếc',
   '{"class2":{"accept":"accept","severity":"minor"},"class3":{"accept":"process","severity":"minor"}}'::jsonb,true,NOW(),NOW()),
  ('SOLDER_VOID','Solder void (BGA / QFN)','major','solder','5.2.8','5','2',
   ARRAY['BGA','QFN','LGA'],ARRAY['AXI'],
   'Internal cavity in a solder joint exceeding the area-percent limit.','Lỗ rỗng trong mối hàn',
   '{"class2":{"accept":"process","severity":"major","limit":"BGA <= 25% area"},"class3":{"accept":"reject","severity":"major","limit":"BGA <= 9% area"}}'::jsonb,true,NOW(),NOW()),
  ('NON_WETTING','Non-wetting','major','solder','5.2.9','5','2',
   ARRAY['SMT','THT'],ARRAY['AOI','AVI'],
   'Solder did not wet to a metallic surface.','Không ngấm thiếc',
   '{"class2":{"accept":"reject","severity":"major"},"class3":{"accept":"reject","severity":"critical"}}'::jsonb,true,NOW(),NOW()),

  -- ---- §8 Component placement ----
  ('TOMBSTONING','Tombstoning','critical','component','8.3.5.1','8','2',
   ARRAY['SMT'],ARRAY['AOI','AVI'],
   'Chip component lifted vertically off one pad.','Linh kiện dựng đứng (tombstone)',
   '{"class2":{"accept":"reject","severity":"critical"},"class3":{"accept":"reject","severity":"critical"}}'::jsonb,true,NOW(),NOW()),
  ('BILLBOARDING','Billboarding','major','component','8.3.5.2','8','2',
   ARRAY['SMT'],ARRAY['AOI','AVI'],
   'Chip component standing on its side rather than seated flat.','Linh kiện nằm nghiêng',
   '{"class2":{"accept":"process","severity":"major"},"class3":{"accept":"reject","severity":"major"}}'::jsonb,true,NOW(),NOW()),
  ('MISALIGNMENT','Component misalignment / offset','major','component','8.3.2','8','2',
   ARRAY['SMT','BGA','QFN'],ARRAY['AOI','AVI','AXI'],
   'Component offset from pad exceeds the overhang limit for the class.','Linh kiện lệch vị trí',
   '{"class2":{"accept":"process","severity":"major","limit":"Side overhang <= 50%"},"class3":{"accept":"reject","severity":"major","limit":"Side overhang <= 25%"}}'::jsonb,true,NOW(),NOW()),
  ('MISSING_COMPONENT','Missing component','critical','component','8.1','8','2',
   ARRAY['SMT','THT'],ARRAY['AOI','AVI'],
   'Component absent from designated location per BOM / design.','Thiếu linh kiện',
   '{"class2":{"accept":"reject","severity":"critical"},"class3":{"accept":"reject","severity":"critical"}}'::jsonb,true,NOW(),NOW()),
  ('WRONG_COMPONENT','Wrong component','critical','component','8.1','8','2',
   ARRAY['SMT','THT'],ARRAY['AOI','AVI','ICT'],
   'Component value / part number does not match BOM.','Sai linh kiện',
   '{"class2":{"accept":"reject","severity":"critical"},"class3":{"accept":"reject","severity":"critical"}}'::jsonb,true,NOW(),NOW()),
  ('REVERSED_POLARITY','Reversed polarity','critical','component','8.1.7','8','2',
   ARRAY['SMT','THT'],ARRAY['AOI','AVI','ICT'],
   'Polarised component installed in opposite orientation.','Sai cực tính',
   '{"class2":{"accept":"reject","severity":"critical"},"class3":{"accept":"reject","severity":"critical"}}'::jsonb,true,NOW(),NOW()),
  ('LIFTED_LEAD','Lifted lead','critical','component','8.3.10','8','2',
   ARRAY['SMT','THT','QFP','SOIC'],ARRAY['AOI','AVI','AXI'],
   'Component lead not in contact with pad / solder fillet.','Chân linh kiện bị nâng',
   '{"class2":{"accept":"reject","severity":"major"},"class3":{"accept":"reject","severity":"critical"}}'::jsonb,true,NOW(),NOW()),
  ('BENT_LEAD','Bent / damaged lead','major','component','8.3.10.4','8','2',
   ARRAY['SMT','THT','QFP'],ARRAY['AOI','AVI'],
   'Lead deformation beyond formed-lead tolerance.','Chân linh kiện cong',
   '{"class2":{"accept":"process","severity":"minor"},"class3":{"accept":"reject","severity":"major"}}'::jsonb,true,NOW(),NOW()),

  -- ---- §9 Through-hole ----
  ('INSUFFICIENT_HOLE_FILL','Insufficient hole fill (THT)','major','solder','9.3.2','9','2',
   ARRAY['THT'],ARRAY['AVI','AXI'],
   'Vertical solder fill in plated through-hole below class minimum.','Thiếu thiếc lỗ xuyên',
   '{"class2":{"accept":"process","severity":"major","limit":"Fill >= 75%"},"class3":{"accept":"reject","severity":"major","limit":"Fill >= 100%"}}'::jsonb,true,NOW(),NOW()),
  ('PIN_PROTRUSION_INSUFFICIENT','Insufficient pin protrusion','minor','component','9.3.5','9','2',
   ARRAY['THT'],ARRAY['AVI'],
   'Lead does not protrude sufficiently beyond solder side of board.','Chân chưa ló đủ',
   '{"class2":{"accept":"accept","severity":"minor"},"class3":{"accept":"process","severity":"minor"}}'::jsonb,true,NOW(),NOW()),

  -- ---- §10 Cleanliness & marking ----
  ('CONTAMINATION_PARTICULATE','Particulate contamination','minor','cleanliness','10.6.2','10','3',
   ARRAY['ASSEMBLY'],ARRAY['AVI'],
   'Loose particles, FOD or debris on assembly surface.','Bụi / dị vật',
   '{"class2":{"accept":"accept","severity":"cosmetic"},"class3":{"accept":"process","severity":"minor"}}'::jsonb,true,NOW(),NOW()),
  ('MARKING_ILLEGIBLE','Illegible marking / label','minor','marking','10.5.1','10','2',
   ARRAY['MARK','LABEL'],ARRAY['AVI','OCR'],
   'Required marking unreadable due to smear, low contrast or print defect.','Nhãn / mã không đọc được',
   '{"class2":{"accept":"process","severity":"minor"},"class3":{"accept":"reject","severity":"major"}}'::jsonb,true,NOW(),NOW()),
  ('BARCODE_UNREADABLE','Barcode / 2D-DMC unreadable','major','marking','10.5.1','10','2',
   ARRAY['MARK','LABEL'],ARRAY['AVI','OCR'],
   'Machine-readable code fails decode at required quality grade.','Mã vạch / DMC không quét được',
   '{"class2":{"accept":"reject","severity":"major"},"class3":{"accept":"reject","severity":"major"}}'::jsonb,true,NOW(),NOW()),

  -- ---- §10/11 PCB ----
  ('PCB_SCRATCH','PCB surface scratch','cosmetic','pcb','10.2.4','10','3',
   ARRAY['PCB'],ARRAY['AVI'],
   'Surface scratch on PCB substrate or solder mask not exposing copper.','Trầy xước PCB',
   '{"class2":{"accept":"accept","severity":"cosmetic"},"class3":{"accept":"process","severity":"minor"}}'::jsonb,true,NOW(),NOW()),
  ('SOLDERMASK_DAMAGE','Solder mask damage','minor','pcb','10.3.3','10','2',
   ARRAY['PCB'],ARRAY['AVI'],
   'Lifted, missing or cracked solder mask exposing conductor.','Hỏng lớp phủ hàn',
   '{"class2":{"accept":"process","severity":"minor"},"class3":{"accept":"reject","severity":"major"}}'::jsonb,true,NOW(),NOW()),
  ('LAMINATE_DAMAGE','Laminate damage / measling','major','pcb','10.2.5','10','2',
   ARRAY['PCB'],ARRAY['AVI'],
   'Internal separation / white spots in PCB laminate.','Hỏng lớp nền PCB',
   '{"class2":{"accept":"process","severity":"major"},"class3":{"accept":"reject","severity":"critical"}}'::jsonb,true,NOW(),NOW()),

  -- ---- §12 Discrete wiring ----
  ('DAMAGED_INSULATION','Damaged wire insulation','major','wiring','12.1.1','12','2',
   ARRAY['WIRING'],ARRAY['AVI'],
   'Cut, burn or abrasion in wire insulation exposing conductor.','Hỏng lớp cách điện dây',
   '{"class2":{"accept":"process","severity":"major"},"class3":{"accept":"reject","severity":"critical"}}'::jsonb,true,NOW(),NOW()),

  -- ---- Mechanical / housing ----
  ('EDGE_BURR','Edge burr (machined housing)','minor','mechanical',NULL,'MECH','3',
   ARRAY['MECH','HOUSING'],ARRAY['AVI','CMM'],
   'Sharp burr along machined edge exceeding max allowed height.','Bavia mép gia công',
   '{"class2":{"accept":"accept","severity":"minor","limit":"Burr <= 0.2 mm"},"class3":{"accept":"process","severity":"minor","limit":"Burr <= 0.05 mm"}}'::jsonb,true,NOW(),NOW()),
  ('DENT','Dent / deformation','major','mechanical',NULL,'MECH','2',
   ARRAY['MECH','HOUSING'],ARRAY['AVI','CMM'],
   'Localised inward deformation beyond cosmetic / functional limit.','Móp / lõm',
   '{"class2":{"accept":"process","severity":"major"},"class3":{"accept":"reject","severity":"major"}}'::jsonb,true,NOW(),NOW()),

  -- ---- Cosmetic ----
  ('COSMETIC_SCRATCH','Cosmetic surface scratch','cosmetic','cosmetic',NULL,'COSM','3',
   ARRAY['COSMETIC','HOUSING'],ARRAY['AVI'],
   'Surface scratch on a visible cosmetic area exceeding zone spec.','Trầy xước bề mặt',
   '{"class2":{"accept":"accept","severity":"cosmetic"},"class3":{"accept":"accept","severity":"cosmetic"}}'::jsonb,true,NOW(),NOW()),
  ('COLOR_MISMATCH','Color / gloss mismatch','minor','cosmetic',NULL,'COSM','3',
   ARRAY['COSMETIC','HOUSING'],ARRAY['AVI','SPECTRO','GLOSS'],
   'Color difference (delta-E) or gloss outside the master swatch tolerance.','Lệch màu / độ bóng',
   '{"class2":{"accept":"process","severity":"minor","limit":"dE2000 <= 1.5"},"class3":{"accept":"process","severity":"minor","limit":"dE2000 <= 1.0"}}'::jsonb,true,NOW(),NOW())
ON CONFLICT ("code") DO UPDATE SET
  "name"          = EXCLUDED."name",
  "severity"      = EXCLUDED."severity",
  "category"      = EXCLUDED."category",
  "ipcReference"  = EXCLUDED."ipcReference",
  "ipcSection"    = EXCLUDED."ipcSection",
  "acceptanceClass" = EXCLUDED."acceptanceClass",
  "appliesTo"     = EXCLUDED."appliesTo",
  "detectableBy"  = EXCLUDED."detectableBy",
  "description"   = EXCLUDED."description",
  "nameVi"        = COALESCE(EXCLUDED."nameVi", "defect_catalog"."nameVi"),
  "classRules"    = EXCLUDED."classRules",
  "isActive"      = true,
  "deletedAt"     = NULL,
  "updatedAt"     = NOW();

-- ----------------------------------------------------------------------------
-- 2) Audit log entry for the seed (best-effort).
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='audit_logs') THEN
    INSERT INTO "audit_logs"
      ("userName","action","entityType","entityId","entityName","details","status","createdAt")
    VALUES
      ('system','seed','defect_catalog',0,
       'IPC-A-610 defect taxonomy seed (P4.E)',
       '{"migration":"0137","purpose":"NG->defect-code classification flow"}',
       'success',NOW());
  END IF;
END $$;
