-- ============================================================================
-- Migration 0143: Fleet RESOURCE / SKILL / CHARGING (Khối 2, doc 16 §7 c&d / §15 G2)
--
-- Completes Khối 2 on top of G1 (tasks / zones / zone_reservations, migration 0142),
-- all behind the FLEET_RESOURCE_ENABLED flag:
--
--   G2-a Operation → Skill → Program registry
--     • operation_codes        — a MES operation code → requiredCapability +
--                                requiredSkillIds (jsonb int[] → masterdata.skills) +
--                                toolType + estimatedCycleMs.
--     • operation_program_map   — operation → QUALIFIED program_projects (versioned
--                                program store) per deviceKind (compatible flag).
--   G2-b A/B program variants
--     • program_variants        — A | B | control split of a program_project with a
--                                weighted trafficSplitPct + rolling metrics.
--   G2-c Shared resource registry
--     • shared_resources        — claimable jig/gripper/fixture/tool_changer.
--     • resource_reservations   — claim window (mirrors zone_reservations discipline).
--   G2-d Predictive charging
--     • charger_stations        — a charge point in a zone.
--     • battery_charging_plans   — preemptive charge scheduled when projected battery
--                                would dip below the G1 floor before the queue ends.
--
-- SAFETY: pure orchestration STATE. No device-control path is opened — actual robot
-- commands still route through the EXISTING gated dispatchers (robotCommandDispatcher
-- / commandDispatcher, dry-run by default).
--
-- TENANT SCOPE: corporateCode (varchar) + factoryId (int) mirror fleet.ts (0142).
-- RLS uses the shared inert-by-default app_tenant_allows() helper on corporateCode
-- (mirrors 0142) — a no-op unless TENANT_RLS_ENABLED sets the session GUC. The helper
-- is (re)defined idempotently here so this migration is self-contained.
--
-- status / type columns are varchar (NOT new pg enums) → additive (CREATE
-- TABLE/INDEX/POLICY only, no ALTER TYPE). Idempotent: re-runnable throughout
-- (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ============================================================================

-- ── Ensure the inert-by-default tenant helper exists (mirrors 0142/0122) ─────
CREATE OR REPLACE FUNCTION app_tenant_allows(p_factory text, p_corporate text)
  RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.tenant_rls_active', true), 'off') <> 'on'   -- inert unless activated
      OR coalesce(current_setting('app.tenant_bypass',     true), 'off') =  'on'   -- admin/service bypass
      OR (p_factory   IS NOT NULL AND p_factory   = ANY (string_to_array(coalesce(current_setting('app.tenant_factory_codes',   true), ''), ',')))
      OR (p_corporate IS NOT NULL AND p_corporate = ANY (string_to_array(coalesce(current_setting('app.tenant_corporate_codes', true), ''), ',')))
$$;

-- ----------------------------------------------------------------------------
-- G2-a — operation_codes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "operation_codes" (
  "id"                  serial PRIMARY KEY,
  "code"                varchar(64)  NOT NULL,
  "description"         text,
  "requiredCapability"  varchar(64)  NOT NULL,
  "requiredSkillIds"    jsonb,
  "toolType"            varchar(32),
  "estimatedCycleMs"    integer,
  "scope"               varchar(64),
  "isActive"            boolean      NOT NULL DEFAULT true,
  "corporateCode"       varchar(50),
  "factoryId"           integer,
  "createdAt"           timestamp    NOT NULL DEFAULT now(),
  "updatedAt"           timestamp    NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_operation_codes_code"        ON "operation_codes" ("code");
CREATE INDEX        IF NOT EXISTS "idx_operation_codes_capability" ON "operation_codes" ("requiredCapability");

-- ----------------------------------------------------------------------------
-- G2-a — operation_program_map
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "operation_program_map" (
  "id"                serial PRIMARY KEY,
  "operationCodeId"   integer      NOT NULL,
  "programProjectId"  integer      NOT NULL,
  "deviceKind"        varchar(32),
  "compatible"        boolean      NOT NULL DEFAULT true,
  "notes"             text,
  "corporateCode"     varchar(50),
  "factoryId"         integer,
  "createdAt"         timestamp    NOT NULL DEFAULT now(),
  "updatedAt"         timestamp    NOT NULL DEFAULT now()
);
CREATE INDEX        IF NOT EXISTS "idx_op_prog_map_operation" ON "operation_program_map" ("operationCodeId");
CREATE INDEX        IF NOT EXISTS "idx_op_prog_map_program"   ON "operation_program_map" ("programProjectId");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_op_prog_map"            ON "operation_program_map" ("operationCodeId", "programProjectId", "deviceKind");

-- ----------------------------------------------------------------------------
-- G2-b — program_variants
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "program_variants" (
  "id"                serial PRIMARY KEY,
  "programProjectId"  integer      NOT NULL,
  "variant"           varchar(16)  NOT NULL,
  "trafficSplitPct"   integer      NOT NULL DEFAULT 0,
  "status"            varchar(16)  NOT NULL DEFAULT 'active',
  "rolloutStartAt"    timestamp,
  "metrics"           jsonb,
  "scope"             varchar(64),
  "corporateCode"     varchar(50),
  "factoryId"         integer,
  "createdAt"         timestamp    NOT NULL DEFAULT now(),
  "updatedAt"         timestamp    NOT NULL DEFAULT now()
);
CREATE INDEX        IF NOT EXISTS "idx_program_variants_program" ON "program_variants" ("programProjectId");
CREATE INDEX        IF NOT EXISTS "idx_program_variants_status"  ON "program_variants" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_program_variant"          ON "program_variants" ("programProjectId", "variant");

-- ----------------------------------------------------------------------------
-- G2-c — shared_resources
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "shared_resources" (
  "id"                    serial PRIMARY KEY,
  "code"                  varchar(64)  NOT NULL,
  "name"                  varchar(255),
  "type"                  varchar(24)  NOT NULL DEFAULT 'other',
  "currentOwnerDeviceId"  integer,
  "status"                varchar(16)  NOT NULL DEFAULT 'available',
  "locationZoneId"        integer,
  "scope"                 varchar(64),
  "corporateCode"         varchar(50),
  "factoryId"             integer,
  "createdAt"             timestamp    NOT NULL DEFAULT now(),
  "updatedAt"             timestamp    NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_shared_resources_code"   ON "shared_resources" ("code");
CREATE INDEX        IF NOT EXISTS "idx_shared_resources_type"   ON "shared_resources" ("type");
CREATE INDEX        IF NOT EXISTS "idx_shared_resources_status" ON "shared_resources" ("status");

-- ----------------------------------------------------------------------------
-- G2-c — resource_reservations
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "resource_reservations" (
  "id"            serial PRIMARY KEY,
  "resourceId"    integer      NOT NULL,
  "taskId"        integer,
  "deviceId"      integer      NOT NULL,
  "deviceKind"    varchar(16)  NOT NULL DEFAULT 'robot',
  "status"        varchar(16)  NOT NULL DEFAULT 'active',
  "reservedFrom"  timestamp    NOT NULL DEFAULT now(),
  "reservedUntil" timestamp,
  "releasedAt"    timestamp,
  "corporateCode" varchar(50),
  "factoryId"     integer,
  "createdAt"     timestamp    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_res_res_resource_status" ON "resource_reservations" ("resourceId", "status");
CREATE INDEX IF NOT EXISTS "idx_res_res_device"          ON "resource_reservations" ("deviceId");
CREATE INDEX IF NOT EXISTS "idx_res_res_task"            ON "resource_reservations" ("taskId");

-- ----------------------------------------------------------------------------
-- G2-d — charger_stations
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "charger_stations" (
  "id"              serial PRIMARY KEY,
  "code"            varchar(64)  NOT NULL,
  "name"            varchar(255),
  "locationZoneId"  integer,
  "chargerType"     varchar(32)  NOT NULL DEFAULT 'contact',
  "powerWatts"      integer,
  "status"          varchar(16)  NOT NULL DEFAULT 'available',
  "scope"           varchar(64),
  "corporateCode"   varchar(50),
  "factoryId"       integer,
  "createdAt"       timestamp    NOT NULL DEFAULT now(),
  "updatedAt"       timestamp    NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_charger_stations_code"   ON "charger_stations" ("code");
CREATE INDEX        IF NOT EXISTS "idx_charger_stations_zone"   ON "charger_stations" ("locationZoneId");
CREATE INDEX        IF NOT EXISTS "idx_charger_stations_status" ON "charger_stations" ("status");

-- ----------------------------------------------------------------------------
-- G2-d — battery_charging_plans
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "battery_charging_plans" (
  "id"                   serial PRIMARY KEY,
  "deviceId"             integer      NOT NULL,
  "deviceKind"           varchar(16)  NOT NULL DEFAULT 'robot',
  "chargerStationId"     integer,
  "plannedStartAt"       timestamp,
  "estimatedDurationMs"  integer,
  "currentEnergyPct"     integer,
  "reason"               text,
  "status"               varchar(16)  NOT NULL DEFAULT 'planned',
  "corporateCode"        varchar(50),
  "factoryId"            integer,
  "createdAt"            timestamp    NOT NULL DEFAULT now(),
  "updatedAt"            timestamp    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_charging_plans_device" ON "battery_charging_plans" ("deviceId");
CREATE INDEX IF NOT EXISTS "idx_charging_plans_status" ON "battery_charging_plans" ("status");

-- ============================================================================
-- RLS — inert-by-default (mirrors 0142). corporateCode is the predicate column;
-- factory is passed NULL (these tables scope by factoryId int, not a factory CODE).
-- WITHOUT the session GUC (flag OFF / table owner / any query not wrapped in
-- withTenantScope) app_tenant_allows() returns TRUE = allow-all.
-- ============================================================================
ALTER TABLE "operation_codes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "operation_codes";
CREATE POLICY tenant_select ON "operation_codes" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "operation_codes";
CREATE POLICY tenant_modify ON "operation_codes" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));

ALTER TABLE "operation_program_map" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "operation_program_map";
CREATE POLICY tenant_select ON "operation_program_map" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "operation_program_map";
CREATE POLICY tenant_modify ON "operation_program_map" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));

ALTER TABLE "program_variants" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "program_variants";
CREATE POLICY tenant_select ON "program_variants" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "program_variants";
CREATE POLICY tenant_modify ON "program_variants" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));

ALTER TABLE "shared_resources" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "shared_resources";
CREATE POLICY tenant_select ON "shared_resources" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "shared_resources";
CREATE POLICY tenant_modify ON "shared_resources" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));

ALTER TABLE "resource_reservations" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "resource_reservations";
CREATE POLICY tenant_select ON "resource_reservations" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "resource_reservations";
CREATE POLICY tenant_modify ON "resource_reservations" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));

ALTER TABLE "charger_stations" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "charger_stations";
CREATE POLICY tenant_select ON "charger_stations" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "charger_stations";
CREATE POLICY tenant_modify ON "charger_stations" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));

ALTER TABLE "battery_charging_plans" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "battery_charging_plans";
CREATE POLICY tenant_select ON "battery_charging_plans" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "battery_charging_plans";
CREATE POLICY tenant_modify ON "battery_charging_plans" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));
