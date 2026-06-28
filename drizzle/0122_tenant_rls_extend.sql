-- ============================================================================
-- Phase 1 WS4 — Tenant Row-Level Security EXTEND (master-data + hot tables)
-- Audit doc 07 §③: "RLS fully designed but INERT" → extend policy coverage.
--
-- NOTE ON FILE NUMBER: the brief asked for "0101_tenant_rls_extend" ("next
-- after 0100"), but the top-level drizzle/ runner auto-applies every drizzle/*.sql
-- and 0101 is ALREADY TAKEN (0101_hotfix_mp_msa_align.sql, 0101_b7_segmentation.sql).
-- To avoid a collision this uses the next FREE top-level number (0122; latest is
-- 0121). The earlier RLS templates (0001/0002) live in drizzle/optional/ and are
-- operator-applied; this one is written to be safe even if auto-applied (see below).
--
-- ============================================================================
-- SAFETY MODEL — FAIL-OPEN, INERT-BY-DEFAULT (do not remove):
--   This migration only ENABLES RLS and ADDS policies. It changes ZERO columns
--   and inserts ZERO data. The policy predicate is the shared, inert-by-default
--   helper app_tenant_allows() (defined in drizzle/optional/0002_tenant_rls_all.sql):
--
--     allow IF  app.tenant_rls_active <> 'on'   -- GUC unset / flag OFF → ALLOW ALL
--           OR  app.tenant_bypass     =  'on'   -- admin / service     → ALLOW ALL
--           OR  row's factory/corporate code ∈ the session's code list
--
--   So WITHOUT the session GUC set (flag OFF, legacy connections, table OWNER,
--   any query not wrapped in withTenantScope) the policy evaluates TRUE = no
--   lockout. Enforcement only kicks in when server/db/tenantContext sets
--   app.tenant_rls_active='on' (SET LOCAL, inside withTenantScope) — which only
--   happens when TENANT_RLS_ENABLED=true. Default OFF ⇒ this migration is inert.
--
--   PRECONDITION for enforcement to ever take effect: the app must connect as a
--   NON-owner, NOBYPASSRLS role (RLS is skipped for the table owner/superuser).
--   See the role template at the bottom of drizzle/optional/0002_tenant_rls_all.sql.
--
-- IDEMPOTENT: re-running is harmless (ENABLE RLS is a no-op if already on;
-- policies are DROP ... IF EXISTS then re-created).
-- ============================================================================

-- ── Ensure the inert-by-default helper exists ───────────────────────────────
-- Mirrors drizzle/optional/0002_tenant_rls_all.sql so this migration is
-- self-contained: if an operator applied 0001 (the OLD, always-on helper) but
-- not 0002, this redefines it to the safe inert form. CREATE OR REPLACE keeps it
-- idempotent and consistent with 0002.
CREATE OR REPLACE FUNCTION app_tenant_allows(p_factory text, p_corporate text)
  RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.tenant_rls_active', true), 'off') <> 'on'   -- inert unless activated
      OR coalesce(current_setting('app.tenant_bypass',     true), 'off') =  'on'   -- admin/service bypass
      OR (p_factory   IS NOT NULL AND p_factory   = ANY (string_to_array(coalesce(current_setting('app.tenant_factory_codes',   true), ''), ',')))
      OR (p_corporate IS NOT NULL AND p_corporate = ANY (string_to_array(coalesce(current_setting('app.tenant_corporate_codes', true), ''), ',')))
$$;

-- ============================================================================
-- MASTER-DATA tables — these DO carry denormalized corporateCode + factoryCode
-- (drizzle/schema/masterdata.ts). Same pattern as 0002's product_inspections.
--   suppliers, materials, customers, tools
-- (material_classes, skills, user_certifications intentionally OMITTED — they
--  have NO tenant columns and are global reference data.)
-- ============================================================================

-- ── suppliers ───────────────────────────────────────────────────────────────
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON suppliers;
CREATE POLICY tenant_select ON suppliers FOR SELECT
  USING (app_tenant_allows("factoryCode", "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON suppliers;
CREATE POLICY tenant_modify ON suppliers FOR ALL
  USING (app_tenant_allows("factoryCode", "corporateCode"))
  WITH CHECK (app_tenant_allows("factoryCode", "corporateCode"));

-- ── materials ───────────────────────────────────────────────────────────────
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON materials;
CREATE POLICY tenant_select ON materials FOR SELECT
  USING (app_tenant_allows("factoryCode", "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON materials;
CREATE POLICY tenant_modify ON materials FOR ALL
  USING (app_tenant_allows("factoryCode", "corporateCode"))
  WITH CHECK (app_tenant_allows("factoryCode", "corporateCode"));

-- ── customers ───────────────────────────────────────────────────────────────
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON customers;
CREATE POLICY tenant_select ON customers FOR SELECT
  USING (app_tenant_allows("factoryCode", "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON customers;
CREATE POLICY tenant_modify ON customers FOR ALL
  USING (app_tenant_allows("factoryCode", "corporateCode"))
  WITH CHECK (app_tenant_allows("factoryCode", "corporateCode"));

-- ── tools ───────────────────────────────────────────────────────────────────
ALTER TABLE tools ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON tools;
CREATE POLICY tenant_select ON tools FOR SELECT
  USING (app_tenant_allows("factoryCode", "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON tools;
CREATE POLICY tenant_modify ON tools FOR ALL
  USING (app_tenant_allows("factoryCode", "corporateCode"))
  WITH CHECK (app_tenant_allows("factoryCode", "corporateCode"));

-- ============================================================================
-- HOT operational tables — process_results / oee_metrics / wip_tracking.
--
-- HONEST FINDING (verified against drizzle/schema/{process,oee,mes}.ts):
-- these tables DO NOT have denormalized corporateCode/factoryCode columns:
--   * process_results : has lineCode only          (no factory/corporate code)
--   * oee_metrics      : has machineCode only       (no factory/corporate code)
--   * wip_tracking     : has lineId/productCode only (no factory/corporate code)
--
-- Applying the column-based policy above would reference columns that do not
-- exist and the migration would ERROR. Enforcing tenancy here requires either
-- (a) denormalizing a factory/corporate code onto the row (forbidden in this
-- pass — "do not touch existing columns"), or (b) an EXISTS-subquery policy that
-- resolves the tenant via a multi-hop join (the hot-table keys are lineCode /
-- machineCode / lineId, none of which carry a factory code directly — see the
-- hierarchy note below). Option (b) is left COMMENTED OUT as a SKELETON only:
-- enabling RLS without a working predicate would make every
-- scoped query on these tables return ZERO rows (a silent lockout) the moment
-- the flag is turned on. They stay UNENFORCED until a join key is validated.
--
-- The templates below are still fail-open (app_tenant_allows short-circuits to
-- TRUE while inert), but DO NOT UNCOMMENT until the join column/table names are
-- confirmed against the live schema and tested on staging.
-- ============================================================================

-- NOTE the factory code is NOT one hop away: per drizzle/schema/hierarchy.ts
-- the hierarchy is machine(stationId) -> station(lineId) ->
-- production_line(workshopId) -> workshop -> factory(code). Neither
-- production_lines nor machines carries a factoryCode column, so the factory
-- must be resolved through the full chain. The skeletons below leave that
-- multi-hop join as an explicit TODO so nobody ships an unverified predicate.

-- ── process_results — SKELETON ONLY (factory via lineCode, multi-hop) ─────────
-- ALTER TABLE process_results ENABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS tenant_select ON process_results;
-- CREATE POLICY tenant_select ON process_results FOR SELECT
--   USING (
--     app_tenant_allows(
--       (/* TODO: lineCode -> production_lines -> workshops -> factories.code */ NULL),
--       NULL
--     )
--   );
-- -- (add a matching FOR ALL / WITH CHECK policy once the join is validated)

-- ── oee_metrics — SKELETON ONLY (factory via machineCode, multi-hop) ──────────
-- ALTER TABLE oee_metrics ENABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS tenant_select ON oee_metrics;
-- CREATE POLICY tenant_select ON oee_metrics FOR SELECT
--   USING (
--     app_tenant_allows(
--       (/* TODO: machineCode -> machines -> stations -> lines -> workshops -> factories.code */ NULL),
--       NULL
--     )
--   );

-- ── wip_tracking — SKELETON ONLY (factory via lineId, multi-hop) ──────────────
-- ALTER TABLE wip_tracking ENABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS tenant_select ON wip_tracking;
-- CREATE POLICY tenant_select ON wip_tracking FOR SELECT
--   USING (
--     app_tenant_allows(
--       (/* TODO: lineId -> production_lines -> workshops -> factories.code */ NULL),
--       NULL
--     )
--   );

-- ============================================================================
-- ROLLBACK (per table):
--   ALTER TABLE suppliers DISABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS tenant_select ON suppliers;
--   DROP POLICY IF EXISTS tenant_modify ON suppliers;
--   -- …repeat for materials, customers, tools…
-- Disabling RLS (or simply leaving TENANT_RLS_ENABLED=false so the GUC is never
-- set) restores full allow-all access immediately.
-- ============================================================================
