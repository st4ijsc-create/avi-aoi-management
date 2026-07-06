-- ============================================================================
-- Migration 0228 (doc 35 Wave W4-D) — Engineering Change control (ECN / ECO).
--
-- Adds the missing GENERAL engineering-change workflow: a change-REQUEST header
-- (engineering_changes) with maker-checker lifecycle + impact analysis (jsonb)
-- + effectivity date, plus an optional per-affected-entity line table
-- (engineering_change_items).
--
-- NO new pg enums and NO ALTER TYPE — every state / kind / action column is
-- plain varchar (mirrors ncr.ts / defect_dispositions reasoning) so this stays
-- CREATE TABLE / INDEX only.
--
-- No feature flag is required: the workflow is RBAC-gated (create = any
-- authenticated user; decisions = admin / supervisor / quality / engineering
-- role), exactly like the threshold-approval queue. Applying this migration
-- changes NOTHING in existing flows until an engineer opens the ECN page.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

-- ── 1. Engineering Change header (ECN / ECO) ───────────────────────────────
CREATE TABLE IF NOT EXISTS "engineering_changes" (
  "id" serial PRIMARY KEY,
  "ecnKey" varchar(64) NOT NULL,
  "title" varchar(256) NOT NULL,
  -- product | bom | recipe | program | process | document
  "changeType" varchar(20) NOT NULL,
  -- SOFT refs (no FK); whichever apply for the changeType are set, rest NULL
  "productModelId" integer,
  "bomId" integer,
  "recipeId" integer,
  "programId" integer,
  "processId" integer,
  "targetDescription" text,
  "reason" text,
  -- structured impact analysis: { affectedProducts[], affectedPrograms[], affectedLines[], notes }
  "impactSummary" jsonb,
  -- draft | submitted | in_review | approved | rejected | implemented | closed
  "status" varchar(20) NOT NULL DEFAULT 'draft',
  -- when the change takes effect (NULL until planned / approved)
  "effectivityDate" timestamp,
  -- actors (users.id); SoD approvedBy != requestedBy is app-enforced
  "requestedBy" integer,
  "reviewedBy" integer,
  "approvedBy" integer,
  "implementedBy" integer,
  "closedBy" integer,
  "decisionComment" text,
  "note" text,
  "submittedAt" timestamp,
  "reviewedAt" timestamp,
  "approvedAt" timestamp,
  "implementedAt" timestamp,
  "closedAt" timestamp,
  "corporateCode" varchar(50),
  "factoryId" integer,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_ecn_key" ON "engineering_changes" ("ecnKey");
CREATE INDEX IF NOT EXISTS "idx_ecn_status" ON "engineering_changes" ("status");
CREATE INDEX IF NOT EXISTS "idx_ecn_change_type" ON "engineering_changes" ("changeType");
CREATE INDEX IF NOT EXISTS "idx_ecn_product" ON "engineering_changes" ("productModelId");
CREATE INDEX IF NOT EXISTS "idx_ecn_effectivity" ON "engineering_changes" ("effectivityDate");

-- ── 2. Engineering Change items (per-affected-entity lines) ─────────────────
CREATE TABLE IF NOT EXISTS "engineering_change_items" (
  "id" serial PRIMARY KEY,
  "ecnId" integer NOT NULL,
  "entityType" varchar(32) NOT NULL,
  "entityRef" integer,
  "entityCode" varchar(128),
  -- add | modify | remove
  "action" varchar(16) NOT NULL DEFAULT 'modify',
  "description" text,
  "note" text,
  "createdAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_ecn_item_ecn" ON "engineering_change_items" ("ecnId");
CREATE INDEX IF NOT EXISTS "idx_ecn_item_entity" ON "engineering_change_items" ("entityType", "entityRef");
