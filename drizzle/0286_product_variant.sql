-- doc 55 Item 3 (PV0) — PRODUCT-VARIANT first-class (PA2). Schema + backfill only;
-- sync/ingest wiring is PV1/PV2 (out of this migration's scope).
--
-- ════════════════════════════════════════════════════════════════════════════
-- QUYẾT ĐỊNH USER (QĐ#10–14, doc 55 §6):
--   • PA2: variant là công dân hạng nhất — bảng product_variants + kế thừa/ghi đè.
--     Mỗi product_models tự có ĐÚNG 1 hàng BASE (isBase=true) — backfill dưới đây.
--   • QĐ#11: ghi đè điểm CHUNG bằng variant_point_overrides:
--       action='exclude'  → biến thể BỎ điểm base đó;
--       action='override' → vá (patchJson) limit/geometry của điểm base.
--     Điểm THÊM riêng của biến thể = hàng measurement_point_defs có "variantId" set
--     (KHÔNG đi qua bảng override).
--   • QĐ#10: pointsConfigVersion PER-VARIANT. Sửa điểm CHUNG ⇒ fan-out bump base +
--     TẤT CẢ biến thể (app, 1 tx). Sửa điểm RIÊNG ⇒ chỉ bump biến thể đó.
--   • QĐ#13: product_models."variant" (varchar nhãn cũ) DEPRECATE — KHÔNG drop.
--
-- LÀM GÌ (ADDITIVE, GUARDED — khuôn 0274/0282):
--   (a) CREATE product_variants (soft-ref productModelId — KHÔNG FK cứng, theo
--       convention claim/enrollment/panel). uq (productModelId, code) partial
--       deletedAt IS NULL.
--   (b) CREATE variant_point_overrides. uq (variantId, basePointDefId).
--   (c) ADD COLUMN measurement_point_defs."variantId" int NULL (KHÔNG backfill →
--       mọi điểm hiện có = NULL = điểm CHUNG/base).
--   (d) ADD COLUMN product_inspections."variantId" int NULL. product_inspections là
--       HYPERTABLE Timescale — ADD COLUMN nullable = metadata-only, an toàn.
--   (e) BACKFILL: mỗi product_models (chưa soft-deleted) → 1 product_variants
--       isBase=true, code='BASE', pointsConfigVersion = model.pointsConfigVersion.
--       Idempotent (WHERE NOT EXISTS).
--   (f) ĐỔI unique index của measurement_point_defs sang composite theo biến thể:
--       DROP uq_point_defs_product_code → CREATE uq_point_defs_product_variant_code
--       = UNIQUE ("productModelId", COALESCE("variantId",0), "code") WHERE deletedAt
--       IS NULL. GUARDED: ĐẾM duplicate theo bộ MỚI TRƯỚC; >0 ⇒ 'partial' + WARNING
--       + GIỮ index cũ (KHÔNG drop/tạo); =0 ⇒ tạo MỚI rồi drop cũ (create-before-drop
--       để mọi lỗi giữa chừng vẫn còn chống-trùng). KHÔNG tự xoá dữ liệu.
--
-- App-side an toàn CẢ KHI index chưa swap:
--   • createMeasurementPointDef vẫn bare ON CONFLICT DO NOTHING (không nêu target) +
--     resolve theo (productModelId, COALESCE(variantId,0), code). Index vắng ⇒ như
--     plain insert cũ (không hồi quy); index có ⇒ chống-trùng theo biến thể.
--   • measurement_point_defs."variantId" chưa có ⇒ resolveEffectivePoints coi mọi
--     điểm là base (variantId NULL) — hành vi = trước variant.
--
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0286 (0285 = product_machine_ideal_cycle_time).
-- ════════════════════════════════════════════════════════════════════════════

-- Bảng trạng thái ops-visible (đã có từ 0172; tạo lại an toàn nếu môi trường mới).
CREATE TABLE IF NOT EXISTS "db_feature_status" (
  "feature"   varchar(100) PRIMARY KEY,
  "status"    varchar(20) NOT NULL,
  "detail"    text,
  "checkedAt" timestamp NOT NULL DEFAULT now()
);

-- ── (a) product_variants ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "product_variants" (
  "id" serial PRIMARY KEY,
  -- Soft ref → product_models.id (no hard FK — claim/enrollment/panel convention).
  "productModelId" integer NOT NULL,
  "code" varchar(100) NOT NULL,
  "name" varchar(255),
  "isBase" boolean DEFAULT false NOT NULL,
  -- QĐ#10 — per-variant points config version.
  "pointsConfigVersion" integer DEFAULT 1 NOT NULL,
  -- Optional per-variant OVERRIDE of the model's reference image / coordinate mode.
  -- NULL = inherit the product_models value.
  "referenceImageUrl" text,
  "referenceImageKey" varchar(255),
  "coordinateMode" varchar(20),
  "lifecycleStatus" varchar(20) DEFAULT 'active' NOT NULL,
  "deletedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_product_variants_model_code"
  ON "product_variants" ("productModelId", "code")
  WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_product_variants_model" ON "product_variants" ("productModelId");
CREATE INDEX IF NOT EXISTS "idx_product_variants_base"
  ON "product_variants" ("productModelId", "isBase") WHERE "isBase" = true;
CREATE INDEX IF NOT EXISTS "idx_product_variants_deleted_at" ON "product_variants" ("deletedAt");

-- ── (b) variant_point_overrides ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "variant_point_overrides" (
  "id" serial PRIMARY KEY,
  -- Soft ref → product_variants.id.
  "variantId" integer NOT NULL,
  -- Soft ref → measurement_point_defs.id (a BASE/common point, variantId NULL).
  "basePointDefId" integer NOT NULL,
  -- 'exclude' = variant drops this base point; 'override' = patch its limits/geometry.
  "action" varchar(20) NOT NULL,
  -- Patch payload for action='override' (limit/geometry fields). NULL for 'exclude'.
  "patchJson" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "chk_variant_override_action" CHECK ("action" IN ('exclude', 'override'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_variant_overrides_variant_point"
  ON "variant_point_overrides" ("variantId", "basePointDefId");
CREATE INDEX IF NOT EXISTS "idx_variant_overrides_variant" ON "variant_point_overrides" ("variantId");
CREATE INDEX IF NOT EXISTS "idx_variant_overrides_base_point" ON "variant_point_overrides" ("basePointDefId");

-- ── (c) measurement_point_defs.variantId — additive, nullable, NO backfill ───
ALTER TABLE "measurement_point_defs"
  ADD COLUMN IF NOT EXISTS "variantId" integer;
COMMENT ON COLUMN "measurement_point_defs"."variantId" IS
  'doc 55 PV0: NULL = base/common point (shared, inherited by every variant). Non-NULL = point ADDED by that specific variant (QĐ#11). Excludes/patches of base points live in variant_point_overrides, NOT here.';

-- ── (d) product_inspections.variantId — hypertable metadata-only add ─────────
ALTER TABLE "product_inspections"
  ADD COLUMN IF NOT EXISTS "variantId" integer;
COMMENT ON COLUMN "product_inspections"."variantId" IS
  'doc 55 PV0: which product_variants row this inspection ran under. NULL = base/legacy (all pre-migration rows). PV2 wires ingest to stamp it; drizzle schema (inspection.ts) declaration is added by the PV2 agent.';

-- ── (e) BACKFILL base variant per live model (idempotent) ────────────────────
INSERT INTO "product_variants"
  ("productModelId", "code", "name", "isBase", "pointsConfigVersion", "lifecycleStatus", "createdAt", "updatedAt")
SELECT pm."id", 'BASE', 'Base', true, COALESCE(pm."pointsConfigVersion", 1), 'active', now(), now()
  FROM "product_models" pm
 WHERE pm."deletedAt" IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM "product_variants" pv
      WHERE pv."productModelId" = pm."id" AND pv."isBase" = true AND pv."deletedAt" IS NULL
   );

-- ── (f) GUARDED composite-uniqueness swap + db_feature_status ────────────────
DO $$
DECLARE
  var_col_ok boolean := false;
  dup_groups bigint  := 0;
  swapped    boolean := false;
  err_detail text    := '';
BEGIN
  -- Confirm (c) actually landed before we build an index that references it.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'measurement_point_defs' AND column_name = 'variantId'
  ) INTO var_col_ok;

  IF NOT var_col_ok THEN
    RAISE WARNING '[0286] "variantId" column absent on measurement_point_defs — cannot build composite live-uniqueness; leaving uq_point_defs_product_code intact (behaviour = pre-variant, no regression).';
  ELSE
    -- ĐẾM duplicate theo bộ MỚI (productModelId, COALESCE(variantId,0), code) — chỉ đọc.
    BEGIN
      SELECT count(*) INTO dup_groups FROM (
        SELECT 1
          FROM measurement_point_defs
         WHERE "deletedAt" IS NULL
         GROUP BY "productModelId", COALESCE("variantId", 0), "code"
        HAVING count(*) > 1
      ) d;
    EXCEPTION WHEN OTHERS THEN
      dup_groups := -1;
      RAISE WARNING '[0286] could not count (model,variant,code) duplicates (%) — NOT swapping the index.', SQLERRM;
    END;

    IF dup_groups = 0 THEN
      -- CREATE-BEFORE-DROP: nếu CREATE lỗi, index cũ vẫn còn (không mất chống-trùng).
      BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "uq_point_defs_product_variant_code"
          ON measurement_point_defs ("productModelId", COALESCE("variantId", 0), "code")
          WHERE "deletedAt" IS NULL;
        DROP INDEX IF EXISTS "uq_point_defs_product_code";
        swapped := true;
        RAISE NOTICE '[0286] uq_point_defs_product_variant_code in force — live-uniqueness now per (productModelId, variant, code). Base points (variantId NULL) fold to COALESCE=0, so base-scope uniqueness is unchanged.';
      EXCEPTION WHEN OTHERS THEN
        swapped    := false;
        err_detail := 'index swap failed: ' || SQLERRM;
        RAISE WARNING '[0286] composite index swap FAILED (%) — uq_point_defs_product_code left intact (no regression). App uses bare ON CONFLICT DO NOTHING either way.', SQLERRM;
      END;
    ELSE
      err_detail := dup_groups || ' live (productModelId, COALESCE(variantId,0), code) duplicate group(s) present';
      RAISE WARNING '[0286] % — NOT swapping (composite unique would fail). Merge (re-point measurement_results, soft-delete the surplus def) then re-apply drizzle/0286. uq_point_defs_product_code stays in force.', err_detail;
    END IF;
  END IF;

  INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
  VALUES (
    'product_variant',
    CASE WHEN var_col_ok AND swapped THEN 'ok' ELSE 'partial' END,
    CASE
      WHEN var_col_ok AND swapped THEN
        'product_variants + variant_point_overrides created; measurement_point_defs."variantId" + product_inspections."variantId" added (nullable, no backfill); one isBase variant backfilled per live product_models; unique index uq_point_defs_product_variant_code ("productModelId", COALESCE("variantId",0), "code") WHERE "deletedAt" IS NULL in force (replaced uq_point_defs_product_code). PV1/PV2 (sync/ingest wiring) pending; behaviour gated by PRODUCT_VARIANT_ENABLED (default OFF).'
      ELSE
        'PARTIAL: variantId column ' || CASE WHEN var_col_ok THEN 'present' ELSE 'MISSING' END ||
        '; index swap ' || CASE WHEN swapped THEN 'done' ELSE COALESCE(NULLIF(err_detail, ''), 'skipped') END ||
        '. Tables + columns + base-variant backfill are additive and applied regardless. Remediate then re-apply drizzle/0286 (idempotent). Until swapped, live-uniqueness remains (productModelId, code) via uq_point_defs_product_code — a second variant sharing a base code cannot yet be enforced-distinct at the DB, but the app resolver scopes by variant either way.'
    END,
    now()
  )
  ON CONFLICT ("feature") DO UPDATE
    SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
END $$;
