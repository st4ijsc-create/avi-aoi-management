-- doc 44 Batch W3-B1 (G3.3 + phần còn lại G3.2 — SYNAPSE LDS-L3 PHẦN II Chương 5-6).
--
-- ════════════════════════════════════════════════════════════════════════════
-- RecipeSet cấp tuyến (spec §6.1 "phân phối recipe & khóa phiên bản" + §12.3):
--
--   recipe_sets       — bộ recipe theo sản phẩm, code phát hành "MODEL-X@v3".
--                       locked = khóa phiên bản SUỐT LÔ (set khi xác nhận nạp đủ,
--                       gỡ chỉ khi mọi tuyến dùng set ở idle/completing/fault).
--                       status ∈ draft|active|retired — text + app-validation
--                       (repo convention, KHÔNG pg enum).
--   recipe_set_items  — máy nào nạp recipe VERSION nào: machine_recipe_id trỏ
--                       MỘT row machine_recipes (phiên bản cụ thể) — tái dùng
--                       catalog recipe versioned + đường deploy recipe_deployments
--                       SẴN CÓ, không nhân đôi payload. RESTRICT máy/recipe (cấu
--                       hình khóa suốt lô không được rút ruột âm thầm); CASCADE
--                       theo set (item là dữ liệu phái sinh của set).
--
--   line_state_transitions.metadata (jsonb) — genealogy v1 (spec §6.3): transition
--   dính pha producing khi tuyến có đơn hàng mang {orderId, recipeSetRef} —
--   truy vết lô ↔ recipe ↔ line.
--
-- ADDITIVE + IDEMPOTENT: CREATE TABLE/INDEX IF NOT EXISTS; ADD COLUMN IF NOT
-- EXISTS; FK guarded qua DO $$ ... duplicate_object. Applied by
-- scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0259 (0258 = order lifecycle W3-A3).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "recipe_sets" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "product_model_id" integer,
  "version" integer DEFAULT 1 NOT NULL,
  "locked" boolean DEFAULT false NOT NULL,
  "locked_at" timestamptz,
  "locked_by" text,
  "status" text DEFAULT 'draft' NOT NULL,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "recipe_sets_code_unique" UNIQUE("code")
);

DO $$ BEGIN
  ALTER TABLE "recipe_sets"
    ADD CONSTRAINT "recipe_sets_product_model_id_product_models_id_fk"
    FOREIGN KEY ("product_model_id") REFERENCES "public"."product_models"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "idx_recipe_sets_status" ON "recipe_sets" ("status");

CREATE TABLE IF NOT EXISTS "recipe_set_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "recipe_set_id" integer NOT NULL,
  "station_id" integer,
  "machine_id" integer NOT NULL,
  "machine_recipe_id" integer NOT NULL,
  "required" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uq_recipe_set_items_set_machine" UNIQUE("recipe_set_id","machine_id")
);

DO $$ BEGIN
  ALTER TABLE "recipe_set_items"
    ADD CONSTRAINT "recipe_set_items_recipe_set_id_recipe_sets_id_fk"
    FOREIGN KEY ("recipe_set_id") REFERENCES "public"."recipe_sets"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "recipe_set_items"
    ADD CONSTRAINT "recipe_set_items_machine_id_machines_id_fk"
    FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id")
    ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "recipe_set_items"
    ADD CONSTRAINT "recipe_set_items_machine_recipe_id_machine_recipes_id_fk"
    FOREIGN KEY ("machine_recipe_id") REFERENCES "public"."machine_recipes"("id")
    ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "idx_recipe_set_items_set" ON "recipe_set_items" ("recipe_set_id");

-- Genealogy v1 (§6.3): metadata {orderId, recipeSetRef} trên sổ transition.
ALTER TABLE "line_state_transitions" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
