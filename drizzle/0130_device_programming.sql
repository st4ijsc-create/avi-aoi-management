-- Doc 09 / Phase D0 — Device Programming & Control (DPC) persistence.
-- Additive + IDEMPOTENT: guarded enums (CREATE TYPE has no IF NOT EXISTS) + new
-- tables (CREATE TABLE IF NOT EXISTS) + indexes (IF NOT EXISTS). No existing table
-- is destructively altered. Do NOT run automatically (operator applies).
--
-- SAFETY: these tables hold program DEFINITIONS + an append-only DEPLOY AUDIT only.
-- No row writes a device. A deploy reaches hardware ONLY via programmingService when
-- DPC_DEPLOY_ENABLED is on AND a human signed off; otherwise it is recorded 'simulated'.

-- ── Enums (guarded) ──
DO $$ BEGIN
  CREATE TYPE "programmingkindenum" AS ENUM
    ('stub', 'zmotion-basic', 'gcode', 'mitsubishi-engineering', 'robot-tm', 'iec61131-st', 'iec61131-ld');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "programartifactstatusenum" AS ENUM ('draft', 'validated', 'released', 'archived');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "programbuildstatusenum" AS ENUM ('pending', 'ok', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "programdeploystageenum" AS ENUM ('staging', 'production');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "programdeploystatusenum" AS ENUM
    ('pending', 'simulated', 'deployed', 'verified', 'failed', 'rolled_back', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── program_projects ──
CREATE TABLE IF NOT EXISTS "program_projects" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" varchar(128) NOT NULL,
  "name" varchar(255) NOT NULL,
  "kind" "programmingkindenum" NOT NULL,
  "deviceId" integer,
  "description" text,
  "defaultBranch" varchar(64) DEFAULT 'main' NOT NULL,
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "program_projects_code_unique" UNIQUE ("code")
);
CREATE INDEX IF NOT EXISTS "idx_prog_projects_kind" ON "program_projects" ("kind");
CREATE INDEX IF NOT EXISTS "idx_prog_projects_device" ON "program_projects" ("deviceId");

-- ── program_artifacts ──
CREATE TABLE IF NOT EXISTS "program_artifacts" (
  "id" serial PRIMARY KEY NOT NULL,
  "projectId" integer NOT NULL,
  "branch" varchar(64) DEFAULT 'main' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "kind" "programmingkindenum" NOT NULL,
  "language" varchar(32) NOT NULL,
  "content" text,
  "contentHash" varchar(64),
  "status" "programartifactstatusenum" DEFAULT 'draft' NOT NULL,
  "diagnosticsJson" jsonb,
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "uq_prog_artifact_version" UNIQUE ("projectId", "branch", "version")
);
CREATE INDEX IF NOT EXISTS "idx_prog_artifacts_project" ON "program_artifacts" ("projectId");
CREATE INDEX IF NOT EXISTS "idx_prog_artifacts_status" ON "program_artifacts" ("status");

-- ── program_builds ──
CREATE TABLE IF NOT EXISTS "program_builds" (
  "id" serial PRIMARY KEY NOT NULL,
  "artifactId" integer NOT NULL,
  "adapterKind" "programmingkindenum" NOT NULL,
  "status" "programbuildstatusenum" DEFAULT 'pending' NOT NULL,
  "ok" boolean DEFAULT false NOT NULL,
  "diagnosticsJson" jsonb,
  "outputRef" text,
  "durationMs" integer,
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_prog_builds_artifact" ON "program_builds" ("artifactId");
CREATE INDEX IF NOT EXISTS "idx_prog_builds_status" ON "program_builds" ("status");

-- ── program_sim_runs ──
CREATE TABLE IF NOT EXISTS "program_sim_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  "buildId" integer NOT NULL,
  "scenarioJson" jsonb,
  "ok" boolean DEFAULT false NOT NULL,
  "timelineJson" jsonb,
  "warningsJson" jsonb,
  "durationMs" integer,
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_prog_sim_runs_build" ON "program_sim_runs" ("buildId");

-- ── program_deployments (append-only audit) ──
CREATE TABLE IF NOT EXISTS "program_deployments" (
  "id" serial PRIMARY KEY NOT NULL,
  "buildId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "deviceId" integer,
  "stage" "programdeploystageenum" DEFAULT 'staging' NOT NULL,
  "status" "programdeploystatusenum" DEFAULT 'pending' NOT NULL,
  "simulated" boolean DEFAULT true NOT NULL,
  "signedOffBy" integer,
  "requestedBy" integer,
  "idempotencyKey" varchar(128),
  "rolledBackFromId" integer,
  "detailJson" jsonb,
  "error" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "uq_prog_deploy_idem" UNIQUE ("idempotencyKey")
);
CREATE INDEX IF NOT EXISTS "idx_prog_deploy_project" ON "program_deployments" ("projectId");
CREATE INDEX IF NOT EXISTS "idx_prog_deploy_build" ON "program_deployments" ("buildId");
CREATE INDEX IF NOT EXISTS "idx_prog_deploy_status" ON "program_deployments" ("status");

-- ── program_symbols ──
CREATE TABLE IF NOT EXISTS "program_symbols" (
  "id" serial PRIMARY KEY NOT NULL,
  "projectId" integer NOT NULL,
  "name" varchar(128) NOT NULL,
  "address" varchar(128),
  "dataType" varchar(32),
  "comment" varchar(500),
  "watchable" boolean DEFAULT true NOT NULL,
  "forceable" boolean DEFAULT false NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "uq_prog_symbol_name" UNIQUE ("projectId", "name")
);
CREATE INDEX IF NOT EXISTS "idx_prog_symbols_project" ON "program_symbols" ("projectId");
