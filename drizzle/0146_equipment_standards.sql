-- ============================================================================
-- Migration 0146: Equipment Standardization & Governance (Khối 5, doc 16 §10 / §15 E1)
--
-- Adds the GOVERNANCE / STANDARDIZATION layer on top of the existing capability
-- model (server/services/equipment/capabilityModel.ts + packml.ts), behind the flag
-- EQ_GOVERN_ENABLED. It does NOT replace or fork the capability model — the registry
-- SEEDS from those profiles (deviceTypeRegistry.buildSeedTypes) and versions them.
--
--   • device_types                  — a versioned, multi-level inheritance tree of
--                                      device types (Equipment → Robot →
--                                      CollaborativeRobot, plus AOI/CNC/… classes).
--                                      Each level adds attributes; extensionFields is
--                                      preserved at every level. (typeKey, version)
--                                      is unique. status draft|published|archived.
--   • alarm_taxonomy                — ISA-18.2 map: vendor native alarm code → standard
--                                      internal code + severity + recommended action.
--   • device_type_change_requests   — Equipment Standards Board workflow: submit →
--                                      review → approve → publish a NEW device_types
--                                      version (backward-compat enforced: ADD-only =
--                                      minor|patch; remove/alter = major + flagged) →
--                                      conformance gate → staging → production.
--
-- SAFETY / NO-OP: every write here is GOVERNANCE METADATA only (versioning, taxonomy,
--   change-requests, conformance results). It opens NO device-control path. Actual
--   device commands still route through the EXISTING gated dispatchers
--   (commandDispatcher / robotCommandDispatcher, dry-run by default).
--
-- TENANT SCOPE: corporateCode (varchar) + factoryId (int) + a free `scope` tag mirror
--   the fleet / safetyWorkforce tables. RLS uses the shared, inert-by-default
--   app_tenant_allows() helper on corporateCode (mirrors 0142–0145) — a complete no-op
--   unless TENANT_RLS_ENABLED=true sets the session GUC. The helper is (re)defined
--   idempotently here so this migration is self-contained.
--
-- status / kind / severity columns are varchar (NOT new pg enums) → migration stays
-- additive (CREATE TABLE/INDEX/POLICY only, no ALTER TYPE). Additive + idempotent:
-- re-runnable (IF NOT EXISTS / DROP POLICY IF EXISTS throughout).
-- ============================================================================

-- ── Ensure the inert-by-default tenant helper exists (mirrors 0122/0142) ─────
CREATE OR REPLACE FUNCTION app_tenant_allows(p_factory text, p_corporate text)
  RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.tenant_rls_active', true), 'off') <> 'on'   -- inert unless activated
      OR coalesce(current_setting('app.tenant_bypass',     true), 'off') =  'on'   -- admin/service bypass
      OR (p_factory   IS NOT NULL AND p_factory   = ANY (string_to_array(coalesce(current_setting('app.tenant_factory_codes',   true), ''), ',')))
      OR (p_corporate IS NOT NULL AND p_corporate = ANY (string_to_array(coalesce(current_setting('app.tenant_corporate_codes', true), ''), ',')))
$$;

-- ----------------------------------------------------------------------------
-- device_types (E1-a) — versioned multi-level device type hierarchy
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "device_types" (
  "id"                 serial PRIMARY KEY,
  "typeKey"            varchar(64)  NOT NULL,
  "parentTypeKey"      varchar(64),
  "version"            varchar(24)  NOT NULL DEFAULT '1.0.0',
  "status"             varchar(16)  NOT NULL DEFAULT 'draft',
  "label"              varchar(128),
  "description"        text,
  "attributesSchema"   jsonb        DEFAULT '[]'::jsonb,
  "supportedCommands"  jsonb        DEFAULT '[]'::jsonb,
  "supportedStates"    jsonb        DEFAULT '[]'::jsonb,
  "extensionFields"    jsonb        DEFAULT '{}'::jsonb,
  "mappedMachineTypes" jsonb        DEFAULT '[]'::jsonb,
  "adapterKind"        varchar(32),
  "changelog"          text,
  "publishedAt"        timestamp,
  "origin"             varchar(16)  NOT NULL DEFAULT 'manual',
  "scope"              varchar(64),
  "corporateCode"      varchar(50),
  "factoryId"          integer,
  "createdBy"          integer,
  "createdAt"          timestamp    NOT NULL DEFAULT now(),
  "updatedAt"          timestamp    NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_devtype_key_version" ON "device_types" ("typeKey", "version");
CREATE INDEX IF NOT EXISTS "idx_devtype_key"    ON "device_types" ("typeKey");
CREATE INDEX IF NOT EXISTS "idx_devtype_parent" ON "device_types" ("parentTypeKey");
CREATE INDEX IF NOT EXISTS "idx_devtype_status" ON "device_types" ("status");

-- ----------------------------------------------------------------------------
-- alarm_taxonomy (E1-b) — ISA-18.2 vendor native → standard code mapping
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "alarm_taxonomy" (
  "id"                 serial PRIMARY KEY,
  "vendor"             varchar(48)  NOT NULL,
  "machineType"        varchar(32),
  "deviceTypeKey"      varchar(64),
  "nativeCode"         varchar(64)  NOT NULL,
  "standardCode"       varchar(64)  NOT NULL,
  "severity"           varchar(16)  NOT NULL DEFAULT 'medium',
  "description"        text,
  "recommendedAction"  text,
  "scope"              varchar(64),
  "corporateCode"      varchar(50),
  "factoryId"          integer,
  "createdBy"          integer,
  "createdAt"          timestamp    NOT NULL DEFAULT now(),
  "updatedAt"          timestamp    NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_alarmtax_vendor_native" ON "alarm_taxonomy" ("vendor", "nativeCode");
CREATE INDEX IF NOT EXISTS "idx_alarmtax_vendor"      ON "alarm_taxonomy" ("vendor");
CREATE INDEX IF NOT EXISTS "idx_alarmtax_standard"    ON "alarm_taxonomy" ("standardCode");
CREATE INDEX IF NOT EXISTS "idx_alarmtax_machinetype" ON "alarm_taxonomy" ("machineType");

-- ----------------------------------------------------------------------------
-- device_type_change_requests (E1-c) — Equipment Standards Board workflow
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "device_type_change_requests" (
  "id"                    serial PRIMARY KEY,
  "crKey"                 varchar(64)  NOT NULL,
  "targetTypeKey"         varchar(64)  NOT NULL,
  "kind"                  varchar(16)  NOT NULL,
  "proposedSchema"        jsonb        DEFAULT '{}'::jsonb,
  "requestedBy"           integer,
  "status"                varchar(16)  NOT NULL DEFAULT 'pending',
  "reviewedBy"            integer,
  "reviewNotes"           text,
  "conformanceStatus"     varchar(16)  NOT NULL DEFAULT 'pending',
  "stage"                 varchar(16)  NOT NULL DEFAULT 'none',
  "semverBump"            varchar(8),
  "publishedVersion"      varchar(24),
  "backwardIncompatible"  varchar(8),
  "scope"                 varchar(64),
  "corporateCode"         varchar(50),
  "factoryId"             integer,
  "createdAt"             timestamp    NOT NULL DEFAULT now(),
  "updatedAt"             timestamp    NOT NULL DEFAULT now(),
  "reviewedAt"            timestamp,
  "publishedAt"           timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_devtype_cr_key" ON "device_type_change_requests" ("crKey");
CREATE INDEX IF NOT EXISTS "idx_devtype_cr_target" ON "device_type_change_requests" ("targetTypeKey");
CREATE INDEX IF NOT EXISTS "idx_devtype_cr_status" ON "device_type_change_requests" ("status");
CREATE INDEX IF NOT EXISTS "idx_devtype_cr_kind"   ON "device_type_change_requests" ("kind");

-- ============================================================================
-- RLS — inert-by-default (mirrors 0142–0145). corporateCode is the predicate column;
-- factory is passed NULL because these tables scope by factoryId (int), not a factory
-- CODE string. WITHOUT the session GUC (flag OFF / table owner / any query not wrapped
-- in withTenantScope) app_tenant_allows() returns TRUE = allow-all.
-- ============================================================================
ALTER TABLE "device_types" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "device_types";
CREATE POLICY tenant_select ON "device_types" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "device_types";
CREATE POLICY tenant_modify ON "device_types" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));

ALTER TABLE "alarm_taxonomy" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "alarm_taxonomy";
CREATE POLICY tenant_select ON "alarm_taxonomy" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "alarm_taxonomy";
CREATE POLICY tenant_modify ON "alarm_taxonomy" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));

ALTER TABLE "device_type_change_requests" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "device_type_change_requests";
CREATE POLICY tenant_select ON "device_type_change_requests" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "device_type_change_requests";
CREATE POLICY tenant_modify ON "device_type_change_requests" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));
