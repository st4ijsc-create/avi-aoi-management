-- ============================================================================
-- Migration 0298: MACHINE OPERATING CONFIG (Task 6, docs/MACHINE_CONFIG_DESIGN.md §6).
--
-- What a machine ACTUALLY runs, reported machine→server. The server-side
-- "recommendation" (§2's `baseline`) already exists as machine_recipes.payload;
-- this table is the report-UP direction and is a SEPARATE table on purpose — a
-- report-settings write here must NEVER mutate machine_recipes or any baseline
-- (design doc §2: "báo cáo cấu hình THỰC TẾ, KHÔNG phải ghi đè baseline chung").
--
-- One row per (machineId, configKind, productModelId-or-null):
--   • productModelId IS NULL     → machine-scoped layer (applies to every product).
--   • productModelId IS NOT NULL → machine×product-scoped layer.
--   `scope` ('machine'|'machine_product') mirrors that nullness explicitly; the
--   CHECK constraint keeps the two from ever disagreeing.
--
-- UNIQUENESS: plain Postgres UNIQUE treats NULL as DISTINCT, so ONE composite
-- unique constraint over (machineId, configKind, productModelId) would NOT stop
-- two machine-scoped rows (productModelId NULL) from coexisting. Two PARTIAL
-- unique indexes close that gap: at most one machine-scoped row per
-- (machine, configKind), and at most one row per (machine, configKind, product)
-- for the product-scoped layer — so the machine-scoped row and any number of
-- per-product rows coexist without collision.
--
-- `machineId`/`productModelId` are soft refs (no FK) — mirrors machine_config_state
-- (0293) / ot_telemetry: a machine-write path must never be blocked by a
-- referential check, and a later machine/product deletion must not orphan-block
-- historic reports.
--
-- WRITTEN BY NOTHING until MACHINE_OPERATING_CONFIG_REPORT_ENABLED (default OFF)
-- is flipped ON at the reportSettings router procedure → safe to ship dark.
--
-- ADDITIVE + IDEMPOTENT: CREATE TABLE IF NOT EXISTS; indexes/constraint IF NOT EXISTS.
-- ROLLBACK: DROP TABLE IF EXISTS "machine_operating_config";
-- ============================================================================

CREATE TABLE IF NOT EXISTS "machine_operating_config" (
  "id"               serial PRIMARY KEY,
  "machineId"        integer NOT NULL,
  "configKind"       varchar(32) NOT NULL,
  "productModelId"   integer,
  "scope"            varchar(16) NOT NULL,
  "baselineVersion"  varchar(64),
  "adjustments"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "effective"        jsonb NOT NULL DEFAULT '{}'::jsonb,
  "checksum"         varchar(128),
  "reportedBy"       varchar(128),
  "reportedAt"       timestamp NOT NULL DEFAULT now(),
  "createdAt"        timestamp NOT NULL DEFAULT now(),
  "updatedAt"        timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

-- scope must always agree with productModelId's nullness.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_moc_scope_matches_product'
  ) THEN
    ALTER TABLE "machine_operating_config"
      ADD CONSTRAINT "ck_moc_scope_matches_product" CHECK (
        ("scope" = 'machine' AND "productModelId" IS NULL) OR
        ("scope" = 'machine_product' AND "productModelId" IS NOT NULL)
      );
  END IF;
END $$;--> statement-breakpoint

-- At most ONE machine-scoped row per (machine, configKind).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_moc_machine_scope"
  ON "machine_operating_config" ("machineId","configKind")
  WHERE "productModelId" IS NULL;--> statement-breakpoint
-- At most ONE row per (machine, configKind, product) for the product-scoped layer.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_moc_product_scope"
  ON "machine_operating_config" ("machineId","configKind","productModelId")
  WHERE "productModelId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_moc_machine" ON "machine_operating_config" ("machineId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_moc_product" ON "machine_operating_config" ("productModelId");
