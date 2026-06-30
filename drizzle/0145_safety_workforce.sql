-- ============================================================================
-- Migration 0145: Safety Audit & Mixed Workforce (Khối 3, doc 16 §8 / §15 S1)
--
-- The SOFTWARE-ONLY slice of Khối 3 (Human-Robot Collaboration), behind the flags
-- WORKFORCE_ENABLED + SAFETY_AUDIT_ENABLED:
--
--   • operator_assignments   — who (a human operator) is rostered to which
--                              line/station for a shift window (+ skill level + confirm).
--   • collaboration_sessions — one human↔robot handover handshake per task/operation
--                              (phase human_prep → robot_work → human_verify → done).
--   • safety_events          — an ADVISORY, append-style record of every
--                              e-stop/collision/intrusion/force-limit/speed-violation/
--                              near-miss the software OBSERVES (SIL-tagged for PDCA).
--
-- ⚠ CRITICAL HONESTY / SAFETY: NOTHING here is safety-rated. safety_events is an
--   ADVISORY monitoring/logging record — NOT a substitute for a safety-rated
--   controller. The software does NOT perform a SIL 2/3 stop and gives NO sub-second
--   guarantee; a real hardware-rated stop (Safety PLC / UWB / LiDAR) is deferred to
--   S2. These tables are pure monitoring/logging/orchestration STATE — no
--   device-control path is opened. Actual robot/device commands still route through
--   the EXISTING gated dispatchers (robotCommandDispatcher / commandDispatcher,
--   dry-run by default).
--
-- TENANT SCOPE: corporateCode (varchar) + factoryId (int) + a free `scope` tag mirror
-- production_orders / fleet tables. RLS uses the shared, inert-by-default
-- app_tenant_allows() helper on corporateCode (mirrors 0142) — a complete no-op
-- unless TENANT_RLS_ENABLED=true sets the session GUC. The helper is (re)defined
-- idempotently here so this migration is self-contained.
--
-- status / type columns are varchar (NOT new pg enums) → migration stays additive
-- (CREATE TABLE/INDEX/POLICY only, no ALTER TYPE). Additive + idempotent: re-runnable
-- (IF NOT EXISTS / DROP POLICY IF EXISTS throughout).
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
-- operator_assignments (S1-a)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "operator_assignments" (
  "id"             serial PRIMARY KEY,
  "operatorId"     integer      NOT NULL,
  "lineId"         integer,
  "stationId"      integer,
  "shiftConfigId"  integer,
  "skillLevel"     varchar(24),
  "role"           varchar(16)  NOT NULL DEFAULT 'human',
  "status"         varchar(16)  NOT NULL DEFAULT 'planned',
  "assignedStart"  timestamp,
  "assignedEnd"    timestamp,
  "confirmedBy"    integer,
  "confirmedAt"    timestamp,
  "notes"          text,
  "scope"          varchar(64),
  "corporateCode"  varchar(50),
  "factoryId"      integer,
  "createdAt"      timestamp    NOT NULL DEFAULT now(),
  "updatedAt"      timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_opassign_operator" ON "operator_assignments" ("operatorId");
CREATE INDEX IF NOT EXISTS "idx_opassign_line"     ON "operator_assignments" ("lineId");
CREATE INDEX IF NOT EXISTS "idx_opassign_station"  ON "operator_assignments" ("stationId");
CREATE INDEX IF NOT EXISTS "idx_opassign_status"   ON "operator_assignments" ("status");
CREATE INDEX IF NOT EXISTS "idx_opassign_shift"    ON "operator_assignments" ("shiftConfigId");

-- ----------------------------------------------------------------------------
-- collaboration_sessions (S1-a handover)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "collaboration_sessions" (
  "id"               serial PRIMARY KEY,
  "taskId"           integer,
  "operationCode"    varchar(64),
  "humanOperatorId"  integer,
  "robotDeviceId"    integer,
  "phase"            varchar(24)  NOT NULL DEFAULT 'human_prep',
  "handshakeState"   varchar(16)  NOT NULL DEFAULT 'pending',
  "startedAt"        timestamp    NOT NULL DEFAULT now(),
  "endedAt"          timestamp,
  "notes"            text,
  "scope"            varchar(64),
  "corporateCode"    varchar(50),
  "factoryId"        integer,
  "createdAt"        timestamp    NOT NULL DEFAULT now(),
  "updatedAt"        timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_collab_task"  ON "collaboration_sessions" ("taskId");
CREATE INDEX IF NOT EXISTS "idx_collab_human" ON "collaboration_sessions" ("humanOperatorId");
CREATE INDEX IF NOT EXISTS "idx_collab_robot" ON "collaboration_sessions" ("robotDeviceId");
CREATE INDEX IF NOT EXISTS "idx_collab_phase" ON "collaboration_sessions" ("phase");

-- ----------------------------------------------------------------------------
-- safety_events (S1-b / S1-d) — ADVISORY, SIL-tagged audit (NOT safety-rated)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "safety_events" (
  "id"                       serial PRIMARY KEY,
  "eventType"                varchar(24)  NOT NULL,
  "robotId"                  integer,
  "deviceId"                 integer,
  "lineId"                   integer,
  "stationId"                integer,
  "sourceInterlockEventId"   integer,
  "humanPosition"            jsonb,
  "robotState"               jsonb,
  "responseTimeMs"           integer,
  "detectedBy"               varchar(16),
  "handledBy"                varchar(24),
  "outcome"                  varchar(24)  NOT NULL DEFAULT 'logged_only',
  "isNearMiss"               boolean      NOT NULL DEFAULT false,
  "notes"                    text,
  "scope"                    varchar(64),
  "corporateCode"            varchar(50),
  "factoryId"                integer,
  "createdAt"                timestamp    NOT NULL DEFAULT now(),
  "auditedAt"                timestamp,
  "auditedBy"                integer
);

CREATE INDEX IF NOT EXISTS "idx_safetyev_type"             ON "safety_events" ("eventType");
CREATE INDEX IF NOT EXISTS "idx_safetyev_robot"            ON "safety_events" ("robotId");
CREATE INDEX IF NOT EXISTS "idx_safetyev_station"          ON "safety_events" ("stationId");
CREATE INDEX IF NOT EXISTS "idx_safetyev_created"          ON "safety_events" ("createdAt");
CREATE INDEX IF NOT EXISTS "idx_safetyev_nearmiss"         ON "safety_events" ("isNearMiss");
CREATE INDEX IF NOT EXISTS "idx_safetyev_source_interlock" ON "safety_events" ("sourceInterlockEventId");

-- ============================================================================
-- RLS — inert-by-default (mirrors 0142). corporateCode is the predicate column;
-- factory is passed NULL because these tables scope by factoryId (int), not a
-- factory CODE string. WITHOUT the session GUC (flag OFF / table owner / any query
-- not wrapped in withTenantScope) app_tenant_allows() returns TRUE = allow-all.
-- ============================================================================
ALTER TABLE "operator_assignments" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "operator_assignments";
CREATE POLICY tenant_select ON "operator_assignments" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "operator_assignments";
CREATE POLICY tenant_modify ON "operator_assignments" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));

ALTER TABLE "collaboration_sessions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "collaboration_sessions";
CREATE POLICY tenant_select ON "collaboration_sessions" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "collaboration_sessions";
CREATE POLICY tenant_modify ON "collaboration_sessions" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));

ALTER TABLE "safety_events" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "safety_events";
CREATE POLICY tenant_select ON "safety_events" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "safety_events";
CREATE POLICY tenant_modify ON "safety_events" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));
