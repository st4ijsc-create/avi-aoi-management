-- Phase E2 — Factory Control Plane: Factory Orchestration Engine (FOE) persistence.
-- Additive + IDEMPOTENT: new enums (guarded) + 3 new tables (CREATE TABLE IF NOT EXISTS)
-- + indexes (IF NOT EXISTS). No existing table is altered. Do NOT run automatically.
--
-- Tables:
--   orchestration_workflows  — deployed, versioned, portable JSON workflow definitions
--   orchestration_runs       — one execution of a workflow (run-level status machine)
--   orchestration_run_steps  — per-step audit (state/attempt/result/error)

-- ── Enums (guarded — CREATE TYPE has no IF NOT EXISTS, so wrap in DO blocks) ──
DO $$ BEGIN
  CREATE TYPE "orchestrationworkflowstatusenum" AS ENUM ('draft', 'active', 'archived');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "orchestrationrunstatusenum" AS ENUM (
    'queued', 'running', 'held', 'awaiting_confirm',
    'completed', 'failed', 'aborted', 'compensating'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "orchestrationrunstepstatusenum" AS ENUM (
    'pending', 'running', 'awaiting_confirm', 'held',
    'completed', 'failed', 'skipped', 'compensated'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── orchestration_workflows ──
CREATE TABLE IF NOT EXISTS "orchestration_workflows" (
  "id" serial PRIMARY KEY NOT NULL,
  "ref" varchar(128) NOT NULL,
  "name" varchar(255) NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "description" text,
  "definitionJson" jsonb NOT NULL,
  "status" "orchestrationworkflowstatusenum" DEFAULT 'active' NOT NULL,
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "orchestration_workflows_ref_unique" UNIQUE ("ref")
);
CREATE INDEX IF NOT EXISTS "idx_orch_workflows_status" ON "orchestration_workflows" ("status");
CREATE INDEX IF NOT EXISTS "idx_orch_workflows_ref" ON "orchestration_workflows" ("ref");

-- ── orchestration_runs ──
CREATE TABLE IF NOT EXISTS "orchestration_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  "workflowId" integer NOT NULL,
  "workflowRef" varchar(128),
  "status" "orchestrationrunstatusenum" DEFAULT 'queued' NOT NULL,
  "paramsJson" jsonb,
  "contextJson" jsonb,
  "currentStepId" varchar(128),
  "startedBy" integer,
  "startedAt" timestamp,
  "finishedAt" timestamp,
  "error" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_orch_runs_workflow" ON "orchestration_runs" ("workflowId");
CREATE INDEX IF NOT EXISTS "idx_orch_runs_status" ON "orchestration_runs" ("status");
CREATE INDEX IF NOT EXISTS "idx_orch_runs_created" ON "orchestration_runs" ("createdAt");

-- ── orchestration_run_steps ──
CREATE TABLE IF NOT EXISTS "orchestration_run_steps" (
  "id" serial PRIMARY KEY NOT NULL,
  "runId" integer NOT NULL,
  "stepId" varchar(128) NOT NULL,
  "stepType" varchar(32) NOT NULL,
  "status" "orchestrationrunstepstatusenum" DEFAULT 'pending' NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL,
  "resultJson" jsonb,
  "startedAt" timestamp,
  "finishedAt" timestamp,
  "error" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "uq_orch_run_step" UNIQUE ("runId", "stepId")
);
CREATE INDEX IF NOT EXISTS "idx_orch_run_steps_run" ON "orchestration_run_steps" ("runId");
CREATE INDEX IF NOT EXISTS "idx_orch_run_steps_status" ON "orchestration_run_steps" ("status");
