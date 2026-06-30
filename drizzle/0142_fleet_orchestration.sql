-- ============================================================================
-- Migration 0142: Fleet & Task Orchestration (Khối 2, doc 16 §7 / §15 G1)
--
-- Creates the Khối-2 core entities behind the Dynamic Task Allocation Engine and
-- the Zone / Traffic & Path manager, all behind the FLEET_ORCH_ENABLED flag:
--
--   • tasks             — a unit of work decomposed from a production order; the
--                         allocator scores candidate devices (capability + distance
--                         + battery + queue + priority) and assigns the best one.
--   • zones             — a physical/logical area with a concurrency cap (the
--                         "virtual traffic light"). current_occupancy is DERIVED
--                         from active zone_reservations (no denormalized counter).
--   • zone_reservations — a device's claim on a zone for a window (reservation-based
--                         navigation + deadlock wait-graph).
--
-- SAFETY: these tables are pure orchestration STATE. No device-control path is
-- opened here — actual robot/device commands still route through the EXISTING gated
-- dispatchers (robotCommandDispatcher / commandDispatcher, dry-run by default).
--
-- TENANT SCOPE: corporateCode (varchar) + factoryId (int) mirror production_orders.
-- RLS uses the shared, inert-by-default app_tenant_allows() helper on corporateCode
-- (mirrors 0122) — a complete no-op unless TENANT_RLS_ENABLED=true sets the session
-- GUC. The helper is (re)defined idempotently here so this migration is self-contained.
--
-- status columns are varchar (NOT new pg enums) → migration stays additive
-- (CREATE TABLE/INDEX/POLICY only, no ALTER TYPE). Additive + idempotent:
-- re-runnable (IF NOT EXISTS / DROP POLICY IF EXISTS throughout).
-- ============================================================================

-- ── Ensure the inert-by-default tenant helper exists (mirrors 0122/0002) ─────
CREATE OR REPLACE FUNCTION app_tenant_allows(p_factory text, p_corporate text)
  RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.tenant_rls_active', true), 'off') <> 'on'   -- inert unless activated
      OR coalesce(current_setting('app.tenant_bypass',     true), 'off') =  'on'   -- admin/service bypass
      OR (p_factory   IS NOT NULL AND p_factory   = ANY (string_to_array(coalesce(current_setting('app.tenant_factory_codes',   true), ''), ',')))
      OR (p_corporate IS NOT NULL AND p_corporate = ANY (string_to_array(coalesce(current_setting('app.tenant_corporate_codes', true), ''), ',')))
$$;

-- ----------------------------------------------------------------------------
-- tasks
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "tasks" (
  "id"                  serial PRIMARY KEY,
  "taskKey"             varchar(128) NOT NULL,
  "sourceWorkOrderId"   integer,
  "requiredCapability"  varchar(64)  NOT NULL,
  "priority"            integer      NOT NULL DEFAULT 3,
  "status"              varchar(16)  NOT NULL DEFAULT 'pending',
  "assignedDeviceId"    integer,
  "assignedDeviceKind"  varchar(16),
  "locationStart"       varchar(64),
  "locationEnd"         varchar(64),
  "estimatedDurationMs" integer,
  "actualDurationMs"    integer,
  "retryCount"          integer      NOT NULL DEFAULT 0,
  "payload"             jsonb,
  "corporateCode"       varchar(50),
  "factoryId"           integer,
  "lastError"           text,
  "createdAt"           timestamp    NOT NULL DEFAULT now(),
  "updatedAt"           timestamp    NOT NULL DEFAULT now(),
  "assignedAt"          timestamp,
  "startedAt"           timestamp,
  "completedAt"         timestamp
);

CREATE INDEX        IF NOT EXISTS "idx_tasks_status"              ON "tasks" ("status");
CREATE INDEX        IF NOT EXISTS "idx_tasks_capability"          ON "tasks" ("requiredCapability");
CREATE INDEX        IF NOT EXISTS "idx_tasks_priority"            ON "tasks" ("priority");
CREATE INDEX        IF NOT EXISTS "idx_tasks_status_capability"   ON "tasks" ("status", "requiredCapability");
CREATE INDEX        IF NOT EXISTS "idx_tasks_device"              ON "tasks" ("assignedDeviceId");
CREATE INDEX        IF NOT EXISTS "idx_tasks_source_order"        ON "tasks" ("sourceWorkOrderId");
-- Idempotent order-decomposition: a (source order, task key) is unique.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tasks_key"                  ON "tasks" ("taskKey");

-- ----------------------------------------------------------------------------
-- zones
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "zones" (
  "id"                   serial PRIMARY KEY,
  "code"                 varchar(64)  NOT NULL,
  "name"                 varchar(255) NOT NULL,
  "zoneType"             varchar(24)  NOT NULL DEFAULT 'production',
  "maxConcurrentRobots"  integer      NOT NULL DEFAULT 1,
  "bounds"               jsonb,
  "corporateCode"        varchar(50),
  "factoryId"            integer,
  "createdAt"            timestamp    NOT NULL DEFAULT now(),
  "updatedAt"            timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX        IF NOT EXISTS "idx_zones_type" ON "zones" ("zoneType");
-- A zone code is unique (per deployment) so reservations can key by code.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_zones_code" ON "zones" ("code");

-- ----------------------------------------------------------------------------
-- zone_reservations
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "zone_reservations" (
  "id"            serial PRIMARY KEY,
  "zoneId"        integer      NOT NULL,
  "deviceId"      integer      NOT NULL,
  "deviceKind"    varchar(16)  NOT NULL DEFAULT 'robot',
  "taskId"        integer,
  "status"        varchar(16)  NOT NULL DEFAULT 'active',
  "reservedFrom"  timestamp    NOT NULL DEFAULT now(),
  "reservedUntil" timestamp,
  "releasedAt"    timestamp,
  "corporateCode" varchar(50),
  "factoryId"     integer,
  "createdAt"     timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_zone_res_zone_status" ON "zone_reservations" ("zoneId", "status");
CREATE INDEX IF NOT EXISTS "idx_zone_res_device"      ON "zone_reservations" ("deviceId");
CREATE INDEX IF NOT EXISTS "idx_zone_res_task"        ON "zone_reservations" ("taskId");

-- ============================================================================
-- RLS — inert-by-default (mirrors 0122). corporateCode is the predicate column;
-- factory is passed NULL because these tables scope by factoryId (int), not a
-- factory CODE string. WITHOUT the session GUC (flag OFF / table owner / any query
-- not wrapped in withTenantScope) app_tenant_allows() returns TRUE = allow-all.
-- ============================================================================
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "tasks";
CREATE POLICY tenant_select ON "tasks" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "tasks";
CREATE POLICY tenant_modify ON "tasks" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));

ALTER TABLE "zones" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "zones";
CREATE POLICY tenant_select ON "zones" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "zones";
CREATE POLICY tenant_modify ON "zones" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));

ALTER TABLE "zone_reservations" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "zone_reservations";
CREATE POLICY tenant_select ON "zone_reservations" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "zone_reservations";
CREATE POLICY tenant_modify ON "zone_reservations" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));
