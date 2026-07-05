-- ============================================================================
-- Migration 0182: Inspection-program approval workflow + golden one-active
-- invariant (doc 27 §2 gaps M9 + M10, Đợt 3 item 3.4 — agent W3-C).
--
-- PART 1 — M9: inspection_program_releases
--   PROBLEM: the measurement-point set (the "inspection program") of a product
--   had NO approval/release workflow — measurement_point_versions only snapshots
--   per-point edits, product_models.pointsConfigVersion is a bare counter, and
--   threshold_approvals covers thresholds only. Nothing records WHICH complete
--   program was signed off and running in production.
--   FIX: append-only release ledger mirroring the proven machine_recipes flow:
--   draft → pending_approval → approved (SoD: approver ≠ creator, enforced in
--   server/services/inspectionProgramService.ts) → released (atomic FOR UPDATE;
--   previous released version of the same scope becomes superseded) | rejected.
--   `snapshot` jsonb holds the FULL point-set + thresholds at release time,
--   `checksum` is a stable sha256 for dedup/diff/tamper-evidence.
--
-- PART 2 — M10: golden_sample_references one-active invariant
--   PROBLEM: "one ACTIVE golden per (productCode, recipeCode, stationCode,
--   roiKey)" lived only in app code (db/goldenSample.ts) — two concurrent
--   set-active calls could commit TWO active rows for the same key.
--   FIX (two-phase, deterministic):
--     a) pre-clean: deactivate all-but-newest (keep max(id)) active row per
--        key, logging what was deactivated via RAISE NOTICE;
--     b) partial UNIQUE expression index WHERE active = true. Scope columns
--        are nullable → folded with COALESCE(x,'') so NULL scopes are also
--        constrained (Postgres unique treats bare NULLs as distinct).
--
-- Additive + idempotent: CREATE TABLE/INDEX IF NOT EXISTS + guarded DO block.
-- No ALTER TYPE, no new pg enum, no change to any existing table's columns.
-- NOTE: product_inspections is intentionally NOT touched (hypertable, owned by
-- Đợt 1/7) — stamping inspections with programReleaseId is a Đợt 7 wiring item.
--
-- Applied by a targeted runner (other agents' 0179–0181 may still be pending),
-- tracked in __applied_migrations. Re-runnable.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- PART 1 — M9: inspection_program_releases
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "inspection_program_releases" (
  "id"                serial PRIMARY KEY,
  "productModelId"    integer NOT NULL,
  -- NULL = product-level program; set = machine-specific program.
  "machineId"         integer,
  -- Monotonic per productModelId (service computes max+1).
  "version"           integer NOT NULL,
  -- draft | pending_approval | approved | released | superseded | rejected
  "status"            varchar(20) NOT NULL DEFAULT 'draft',
  -- Immutable full point-set + thresholds at snapshot time.
  "snapshot"          jsonb NOT NULL,
  "checksum"          varchar(64) NOT NULL,
  "pointCount"        integer NOT NULL DEFAULT 0,
  "notes"             text,
  "createdBy"         integer,
  "submittedAt"       timestamp,
  -- SoD: MUST differ from createdBy (enforced in service, like machine_recipes).
  "approvedBy"        integer,
  "approvedAt"        timestamp,
  "approvalNote"      text,
  "rejectedBy"        integer,
  "rejectedAt"        timestamp,
  "rejectReason"      text,
  "releasedBy"        integer,
  "releasedAt"        timestamp,
  "supersededAt"      timestamp,
  -- Genealogy: which release this one superseded when it went live.
  "previousReleaseId" integer,
  "createdAt"         timestamp NOT NULL DEFAULT now(),
  "updatedAt"         timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_prog_rel_product"
  ON "inspection_program_releases" ("productModelId");
CREATE INDEX IF NOT EXISTS "idx_prog_rel_machine"
  ON "inspection_program_releases" ("machineId");
CREATE INDEX IF NOT EXISTS "idx_prog_rel_status"
  ON "inspection_program_releases" ("status");
CREATE INDEX IF NOT EXISTS "idx_prog_rel_created_by"
  ON "inspection_program_releases" ("createdBy");

-- Version numbers never collide per product (service computes under app logic;
-- this is the DB safety net).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_prog_rel_product_version"
  ON "inspection_program_releases" ("productModelId", "version");

-- At most ONE released program per (product, machine-scope). NULL machineId is
-- folded to 0 so the product-level scope is also single-released.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_prog_rel_one_released"
  ON "inspection_program_releases" ("productModelId", (COALESCE("machineId", 0)))
  WHERE "status" = 'released';

-- ────────────────────────────────────────────────────────────────────────────
-- PART 2 — M10: golden_sample_references one-active invariant
-- ────────────────────────────────────────────────────────────────────────────

-- Phase a) pre-clean duplicates BEFORE building the index (a partial unique
-- index build fails if violating rows exist). Deterministic: keep max(id) per
-- key, deactivate the rest, and log exactly which ids were deactivated.
DO $$
DECLARE
  deactivated_ids integer[];
BEGIN
  -- Skip when the table does not exist yet (fresh DB where 0158 has not run —
  -- ordering safety; the normal runner applies 0158 first anyway).
  IF to_regclass('public.golden_sample_references') IS NULL THEN
    RAISE NOTICE '0182/M10: golden_sample_references missing — skip pre-clean';
    RETURN;
  END IF;

  WITH ranked AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY COALESCE("productCode", ''),
                          COALESCE("recipeCode", ''),
                          COALESCE("stationCode", ''),
                          COALESCE("roiKey", '')
             ORDER BY id DESC
           ) AS rn
    FROM golden_sample_references
    WHERE active = true
  ),
  updated AS (
    UPDATE golden_sample_references g
    SET active = false, "updatedAt" = now()
    FROM ranked r
    WHERE g.id = r.id AND r.rn > 1
    RETURNING g.id
  )
  SELECT COALESCE(array_agg(id ORDER BY id), '{}') INTO deactivated_ids FROM updated;

  IF COALESCE(array_length(deactivated_ids, 1), 0) > 0 THEN
    RAISE NOTICE '0182/M10: deactivated % duplicate active golden rows (kept max(id) per key): ids=%',
      array_length(deactivated_ids, 1), deactivated_ids;
  ELSE
    RAISE NOTICE '0182/M10: no duplicate active golden rows found — nothing deactivated';
  END IF;
END $$;

-- Phase b) the invariant itself. COALESCE folds nullable scope columns so a
-- fully-NULL or partially-NULL key is constrained too (bare NULL columns in a
-- unique index are "distinct" in Postgres and would defeat the invariant).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_golden_ref_one_active"
  ON "golden_sample_references" (
    (COALESCE("productCode", '')),
    (COALESCE("recipeCode", '')),
    (COALESCE("stationCode", '')),
    (COALESCE("roiKey", ''))
  )
  WHERE "active" = true;
