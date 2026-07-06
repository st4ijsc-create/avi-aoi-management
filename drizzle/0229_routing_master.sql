-- ============================================================================
-- Migration 0229: Routing Master (ISA-95 operations sequence) — doc 35 W4-E
--
-- The ERP order-intake path (server/api/v1/erpIntake.ts) notes that POST /routing
-- and operation resolution are NOT possible because "no routing / process_routing
-- master table exists in the schema". These two additive tables close that gap:
--
--   1. routing_master — one header per (product, code, version). Lifecycle status
--      {draft, active, archived} is a plain varchar (NO new pg enum). A PARTIAL
--      unique index guarantees at most ONE `active` routing per product so
--      getActiveRouting(productModelId) is deterministic.
--   2. routing_steps — the ordered operation sequence (operationCode +
--      stationOrMachineType + standardTimeSec) for a routing. Unique (routingId,
--      stepNo). Soft ref to routing_master (no hard FK — mirrors neighbouring
--      additive-ledger tables, migrations 0226/0227).
--
-- ADDITIVE + IDEMPOTENT: CREATE TABLE / INDEX IF NOT EXISTS only. No ALTER TYPE.
-- RBAC-gated CRUD, NO feature flag. Inert until routingRouter / erpIntake read it.
--
-- Applied by the normal migrate step (scripts/migrate-standalone.mjs), tracked in
-- __applied_migrations. Re-runnable.
-- ============================================================================

-- 1) Routing master header ----------------------------------------------------
CREATE TABLE IF NOT EXISTS "routing_master" (
  "id"             serial PRIMARY KEY,
  "productModelId" integer NOT NULL,
  "code"           varchar(64) NOT NULL,
  "version"        integer NOT NULL DEFAULT 1,
  "name"           varchar(255),
  "description"    text,
  "status"         varchar(16) NOT NULL DEFAULT 'draft',
  "createdBy"      integer,
  "createdAt"      timestamp NOT NULL DEFAULT now(),
  "updatedAt"      timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_routing_product" ON "routing_master" ("productModelId");
CREATE INDEX IF NOT EXISTS "idx_routing_status"  ON "routing_master" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_routing_code_version" ON "routing_master" ("code", "version");
-- At most ONE active routing per product (partial unique).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_routing_one_active_per_product"
  ON "routing_master" ("productModelId") WHERE ("status" = 'active');

-- 2) Routing steps (operation sequence) --------------------------------------
CREATE TABLE IF NOT EXISTS "routing_steps" (
  "id"                   serial PRIMARY KEY,
  "routingId"            integer NOT NULL,
  "stepNo"               integer NOT NULL,
  "operationCode"        varchar(64) NOT NULL,
  "stationOrMachineType" varchar(128),
  "standardTimeSec"      integer,
  "description"          text,
  "createdAt"            timestamp NOT NULL DEFAULT now(),
  "updatedAt"            timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_routing_step_routing" ON "routing_steps" ("routingId");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_routing_step_no" ON "routing_steps" ("routingId", "stepNo");
