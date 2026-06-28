-- Phase E4 — Factory Control Plane: EDGE CONTROL RUNTIME persistence.
-- Additive + IDEMPOTENT: a new enum (guarded) + a new edge_nodes table
-- (CREATE TABLE IF NOT EXISTS) + an ADDITIVE nullable column on orchestration_runs
-- + indexes (IF NOT EXISTS). No existing table is destructively altered.
-- Do NOT run automatically.
--
-- HONEST SCOPE: this is COORDINATION + an OFFLINE BUFFER + an execution wrapper that
-- REUSES the E2 FOE engine on an edge host. It does NOT provide hard real-time /
-- sub-ms determinism (a dedicated edge host is required for that) and it NEVER moves
-- safety off the certified L1 PLC. Every edge-issued command still routes through the
-- existing equipmentRegistry → HITL/dry-run dispatcher.

-- ── Enum (guarded — CREATE TYPE has no IF NOT EXISTS) ──
DO $$ BEGIN
  CREATE TYPE "edgenodestatusenum" AS ENUM ('online', 'offline', 'degraded');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── edge_nodes — the central registry of known edge control runtimes ──
CREATE TABLE IF NOT EXISTS "edge_nodes" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" varchar(128) NOT NULL,
  "name" varchar(255) NOT NULL,
  "factoryCode" varchar(128),
  "status" "edgenodestatusenum" DEFAULT 'offline' NOT NULL,
  "lastHeartbeatAt" timestamp,
  "assignedLineCodes" jsonb,
  "version" varchar(64),
  "healthJson" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "edge_nodes_code_unique" UNIQUE ("code")
);
CREATE INDEX IF NOT EXISTS "idx_edge_nodes_status" ON "edge_nodes" ("status");
CREATE INDEX IF NOT EXISTS "idx_edge_nodes_factory" ON "edge_nodes" ("factoryCode");
CREATE INDEX IF NOT EXISTS "idx_edge_nodes_heartbeat" ON "edge_nodes" ("lastHeartbeatAt");

-- ── orchestration_runs.edgeNodeId — ADDITIVE nullable column (which node a run is
--    delegated to; NULL = executed centrally). Guarded so re-runs are safe. ──
DO $$ BEGIN
  ALTER TABLE "orchestration_runs" ADD COLUMN "edgeNodeId" integer;
EXCEPTION WHEN duplicate_column THEN null; END $$;

CREATE INDEX IF NOT EXISTS "idx_orch_runs_edge_node" ON "orchestration_runs" ("edgeNodeId");
