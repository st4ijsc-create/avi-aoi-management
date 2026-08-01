-- ============================================================================
-- Migration 0147: Equipment Integration — recipe genealogy load-log (I1, doc 16 §6 / §15)
--
-- Adds the I1 (Khối 1B) multi-vendor equipment-integration GENEALOGY layer, behind the
-- flag EQ_INTEG_ENABLED. It is PURELY ADDITIVE:
--
--   • recipe_load_log — append-only genealogy of recipe lifecycle + load events: WHO did
--                       create | release | archive | rollback | load, WHICH recipe
--                       code@version, onto WHICH machine, WHEN. Denormalized snapshot so
--                       the genealogy survives later recipe edits. Distinct from the
--                       existing recipe_deployments (a control/deploy ledger) — this is
--                       the lightweight, immutable trail orchestration/traceability reads.
--
-- IT DOES NOT ALTER machine_recipes OR recipe_deployments — existing recipe versioning
--   (machine_recipes.version / .status draft|active|archived, recipe_deployments.previousRecipeId
--   for rollback) is REUSED as-is; recipeVersioningService maps the design vocabulary
--   "released" → the existing 'active' enum value. Existing recipe reads are untouched.
--
-- The FOCAS / Euromap adapter frameworks (I1-a) and the adapter→Andon alarm normalizer
--   (I1-c) are CODE-ONLY (no tables) — they reuse the E1 alarm_taxonomy dictionary
--   (migration 0146) and the existing andon_events table. No schema is needed for them.
--
-- SAFETY / NO-OP: recipe_load_log is METADATA only (genealogy). It opens NO device-control
--   path; recipe deploys/commands still route through the EXISTING gated dispatchers
--   (commandDispatcher, dry-run by default). Service mutations are flag-gated (EQ_INTEG_ENABLED).
--
-- action / status columns are varchar (NOT new pg enums) → migration stays additive
-- (CREATE TABLE/INDEX/POLICY only, no ALTER TYPE). Additive + idempotent: re-runnable
-- (IF NOT EXISTS / DROP POLICY IF EXISTS throughout).
--
-- TENANT SCOPE: corporateCode (varchar) + factoryId (int) + a free `scope` tag mirror
--   0142–0146. RLS uses the shared, inert-by-default app_tenant_allows() helper on
--   corporateCode — a complete no-op unless TENANT_RLS_ENABLED=true sets the session GUC.
--   The helper is (re)defined idempotently here so this migration is self-contained.
-- ============================================================================

-- ── Ensure the inert-by-default tenant helper exists (mirrors 0142–0146) ─────
CREATE OR REPLACE FUNCTION app_tenant_allows(p_factory text, p_corporate text)
  RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.tenant_rls_active', true), 'off') <> 'on'   -- inert unless activated
      OR coalesce(current_setting('app.tenant_bypass',     true), 'off') =  'on'   -- admin/service bypass
      OR (p_factory   IS NOT NULL AND p_factory   = ANY (string_to_array(coalesce(current_setting('app.tenant_factory_codes',   true), ''), ',')))
      OR (p_corporate IS NOT NULL AND p_corporate = ANY (string_to_array(coalesce(current_setting('app.tenant_corporate_codes', true), ''), ',')))
$$;

-- ----------------------------------------------------------------------------
-- recipe_load_log (I1-b) — append-only recipe genealogy / load trail
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "recipe_load_log" (
  "id"             serial PRIMARY KEY,
  "action"         varchar(16)  NOT NULL,            -- create|release|archive|rollback|load
  "recipeId"       integer,                          -- machine_recipes.id (nullable)
  "recipeCode"     varchar(64)  NOT NULL,
  "recipeVersion"  integer,
  "machineId"      integer,
  "fromRecipeId"   integer,                          -- rollback: version rolled away FROM
  "fromVersion"    integer,
  "status"         varchar(16),                      -- draft|released|archived (snapshot)
  "performedBy"    integer,                          -- WHO performed the action
  "notes"          text,
  "meta"           jsonb,
  "scope"          varchar(64),
  "corporateCode"  varchar(50),
  "factoryId"      integer,
  "createdAt"      timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_recipe_load_recipe"  ON "recipe_load_log" ("recipeId");
CREATE INDEX IF NOT EXISTS "idx_recipe_load_machine" ON "recipe_load_log" ("machineId");
CREATE INDEX IF NOT EXISTS "idx_recipe_load_code"    ON "recipe_load_log" ("recipeCode");
CREATE INDEX IF NOT EXISTS "idx_recipe_load_action"  ON "recipe_load_log" ("action");
CREATE INDEX IF NOT EXISTS "idx_recipe_load_created" ON "recipe_load_log" ("createdAt");

-- ============================================================================
-- RLS — inert-by-default (mirrors 0142–0146). corporateCode is the predicate column;
-- factory is passed NULL because this table scopes by factoryId (int), not a factory
-- CODE string. WITHOUT the session GUC (flag OFF / table owner / any query not wrapped
-- in withTenantScope) app_tenant_allows() returns TRUE = allow-all.
-- ============================================================================
ALTER TABLE "recipe_load_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "recipe_load_log";
CREATE POLICY tenant_select ON "recipe_load_log" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "recipe_load_log";
CREATE POLICY tenant_modify ON "recipe_load_log" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));
