-- ============================================================================
-- Migration 0144: Digital Twin — Equipment 3D Model Registry (Khối 7, doc 16 §11.2 / §15 T1)
--
-- Creates the ONE registry mapping equipment (a specific machine/robot OR an
-- equipment CLASS) → an already-converted, web-ready 3D model URI (glTF/URDF),
-- consumed by the FE drei <Gltf> loader and the scene-graph builder so sim + viz
-- share ONE model source. Behind the TWIN_LIVE_ENABLED flag at the service layer.
--
-- HONESTY (CAD→glTF conversion is NOT in-process): the STEP/IGES/URDF → glTF
-- conversion needs external CAD/robotics tooling and is OUT OF SCOPE for T1. This
-- table is an HONEST SEAM — callers register an ALREADY-CONVERTED model URI plus a
-- `conversionStatus`; the backend never pretends to convert anything itself.
--
-- TENANT SCOPE: corporateCode (varchar) + factoryId (int) mirror the fleet tables.
-- RLS uses the shared, inert-by-default app_tenant_allows() helper on corporateCode
-- (mirrors 0142/0143) — a complete no-op unless TENANT_RLS_ENABLED=true sets the
-- session GUC. The helper is (re)defined idempotently here so this migration is
-- self-contained.
--
-- status / modelKind / sourceFormat / conversionStatus columns are varchar (NOT new
-- pg enums) → migration stays additive (CREATE TABLE/INDEX/POLICY only, no ALTER
-- TYPE). Additive + idempotent: re-runnable (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ============================================================================

-- ── Ensure the inert-by-default tenant helper exists (mirrors 0142/0122/0002) ─
CREATE OR REPLACE FUNCTION app_tenant_allows(p_factory text, p_corporate text)
  RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.tenant_rls_active', true), 'off') <> 'on'   -- inert unless activated
      OR coalesce(current_setting('app.tenant_bypass',     true), 'off') =  'on'   -- admin/service bypass
      OR (p_factory   IS NOT NULL AND p_factory   = ANY (string_to_array(coalesce(current_setting('app.tenant_factory_codes',   true), ''), ',')))
      OR (p_corporate IS NOT NULL AND p_corporate = ANY (string_to_array(coalesce(current_setting('app.tenant_corporate_codes', true), ''), ',')))
$$;

-- ----------------------------------------------------------------------------
-- equipment_3d_models
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "equipment_3d_models" (
  "id"               serial PRIMARY KEY,
  "modelKey"         varchar(128) NOT NULL,
  "machineId"        integer,
  "equipmentId"      varchar(128),
  "equipmentClass"   varchar(64),
  "modelUri"         text         NOT NULL,
  "modelKind"        varchar(16)  NOT NULL DEFAULT 'gltf',
  "version"          integer      NOT NULL DEFAULT 1,
  "sourceFormat"     varchar(16)  NOT NULL DEFAULT 'gltf',
  "conversionStatus" varchar(16)  NOT NULL DEFAULT 'ready',
  "bounds"           jsonb,
  "status"           varchar(16)  NOT NULL DEFAULT 'active',
  "scope"            varchar(64),
  "notes"            text,
  "corporateCode"    varchar(50),
  "factoryId"        integer,
  "createdBy"        integer,
  "createdAt"        timestamp    NOT NULL DEFAULT now(),
  "updatedAt"        timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX        IF NOT EXISTS "idx_eq3d_machine"   ON "equipment_3d_models" ("machineId");
CREATE INDEX        IF NOT EXISTS "idx_eq3d_equipment" ON "equipment_3d_models" ("equipmentId");
CREATE INDEX        IF NOT EXISTS "idx_eq3d_class"     ON "equipment_3d_models" ("equipmentClass");
CREATE INDEX        IF NOT EXISTS "idx_eq3d_status"    ON "equipment_3d_models" ("status");
-- Idempotent registration: a modelKey is unique (re-register updates in place).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_eq3d_model_key"  ON "equipment_3d_models" ("modelKey");

-- ============================================================================
-- RLS — inert-by-default (mirrors 0142). corporateCode is the predicate column;
-- factory is passed NULL because these rows scope by factoryId (int), not a
-- factory CODE string. WITHOUT the session GUC (flag OFF / table owner / any query
-- not wrapped in withTenantScope) app_tenant_allows() returns TRUE = allow-all.
-- ============================================================================
ALTER TABLE "equipment_3d_models" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "equipment_3d_models";
CREATE POLICY tenant_select ON "equipment_3d_models" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "equipment_3d_models";
CREATE POLICY tenant_modify ON "equipment_3d_models" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));
