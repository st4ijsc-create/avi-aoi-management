-- ============================================================================
-- Migration 0226 (doc 35 Wave W4-B) — Quality HOLD enforcement + NCR/MRB +
-- FAI gate + golden-diff enforcement.
--
-- Adds two additive tables (nonconformance_reports, golden_revalidation_flags).
-- NO new pg enums and NO ALTER TYPE — every state/kind column is plain varchar
-- (mirrors goldenSample.ts / defect_dispositions reasoning) so this stays
-- CREATE TABLE/INDEX only.
--
-- The quality-HOLD enum mismatch (code wrote wip_tracking.status='on_hold' but
-- wipstatusenum only defines 'hold') is fixed IN CODE (wipIngestService now
-- writes 'hold', an existing enum value) — so NO ALTER TYPE ADD VALUE is needed
-- and no enum migration ships here. See the wave report for the decision.
--
-- All new enforcement is FLAG-OFF by default (WIP_HOLD_ENFORCED / FAI_GATE_ENABLED
-- / GOLDEN_REVALIDATION_REQUIRED), so applying this migration changes NOTHING in
-- current flows until an operator opts in.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

-- ── 1. Non-Conformance Reports (NCR / MRB) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "nonconformance_reports" (
  "id" serial PRIMARY KEY,
  "ncrKey" varchar(64) NOT NULL,
  -- inspection | lot | audit
  "source" varchar(20) NOT NULL,
  -- SOFT refs (no FK — product_inspections may be a hypertable)
  "linkedInspectionId" integer,
  "lotNumber" varchar(128),
  "serialNumber" varchar(128),
  "productModelId" integer,
  "defectSummary" text,
  -- MRB decision: use_as_is | rework | scrap | return | rtv  (NULL until decided)
  "disposition" varchar(20),
  -- open | in_review | dispositioned | closed
  "status" varchar(20) NOT NULL DEFAULT 'open',
  "quarantineLocationId" integer,
  -- actors (users.id); SoD raisedBy != decidedBy is app-enforced
  "raisedBy" integer,
  "reviewedBy" integer,
  "decidedBy" integer,
  "closedBy" integer,
  "reason" text,
  "note" text,
  "raisedAt" timestamp NOT NULL DEFAULT now(),
  "reviewedAt" timestamp,
  "decidedAt" timestamp,
  "closedAt" timestamp,
  "corporateCode" varchar(50),
  "factoryId" integer,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_ncr_key" ON "nonconformance_reports" ("ncrKey");
CREATE INDEX IF NOT EXISTS "idx_ncr_status" ON "nonconformance_reports" ("status");
CREATE INDEX IF NOT EXISTS "idx_ncr_source" ON "nonconformance_reports" ("source");
CREATE INDEX IF NOT EXISTS "idx_ncr_lot" ON "nonconformance_reports" ("lotNumber");
CREATE INDEX IF NOT EXISTS "idx_ncr_serial" ON "nonconformance_reports" ("serialNumber");
CREATE INDEX IF NOT EXISTS "idx_ncr_inspection" ON "nonconformance_reports" ("linkedInspectionId");
CREATE INDEX IF NOT EXISTS "idx_ncr_product" ON "nonconformance_reports" ("productModelId");

-- ── 2. Golden-revalidation flags (advisory "revalidation pending" status) ───
CREATE TABLE IF NOT EXISTS "golden_revalidation_flags" (
  "id" serial PRIMARY KEY,
  "productModelId" integer NOT NULL,
  -- pending | cleared
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "reason" text,
  "triggeredByReleaseId" integer,
  "clearedBy" integer,
  "clearedByRef" varchar(128),
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "clearedAt" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_golden_reval_product" ON "golden_revalidation_flags" ("productModelId");
CREATE INDEX IF NOT EXISTS "idx_golden_reval_status" ON "golden_revalidation_flags" ("status");
-- At most one PENDING flag per product (partial unique).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_golden_reval_one_pending"
  ON "golden_revalidation_flags" ("productModelId") WHERE ("status" = 'pending');
