-- ============================================================================
-- Migration 0167: Orchestration workflow VERSION history (audit doc 25 · T3 /
-- task W3-11).
--
-- PROBLEM: deployWorkflow() UPSERTS by ref and OVERWRITES definitionJson on the
--   existing orchestration_workflows row (bumping `version`), so every prior
--   version's definition was LOST — no diff, no rollback possible.
--
-- WHAT THIS DOES (additive + idempotent — CREATE TABLE/INDEX IF NOT EXISTS only,
-- no ALTER TYPE, no new pg enum):
--   1. CREATE TABLE orchestration_workflow_versions — one append-only snapshot row
--      per deployed version (workflowId + version + full definitionJson). The
--      "head" (latest) still lives on orchestration_workflows for startRun/getRun;
--      this table PRESERVES every version so the Studio can diff + roll back.
--   2. Unique (workflowId, version) so a version is snapshotted exactly once; the
--      supporting indexes back the "list versions of a workflow" + "by ref" reads.
--
-- HONESTY: SCHEMA + snapshot only. Opens NO device-control path. A rollback simply
-- RE-DEPLOYS an older snapshot as a NEW version (append-only) through the existing
-- validated deployWorkflow gate — it never mutates history in place.
--
-- Applied by the normal migrate step (scripts/migrate-standalone.mjs), tracked in
-- __applied_migrations. Re-runnable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "orchestration_workflow_versions" (
  "id"             serial PRIMARY KEY,
  "workflowId"     integer NOT NULL,
  "ref"            varchar(128) NOT NULL,
  "version"        integer NOT NULL,
  "name"           varchar(255) NOT NULL,
  "description"    text,
  "definitionJson" jsonb NOT NULL,
  "createdBy"      integer,
  "createdAt"      timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_orch_wf_version"
  ON "orchestration_workflow_versions" ("workflowId", "version");
CREATE INDEX IF NOT EXISTS "idx_orch_wf_versions_workflow"
  ON "orchestration_workflow_versions" ("workflowId");
CREATE INDEX IF NOT EXISTS "idx_orch_wf_versions_ref"
  ON "orchestration_workflow_versions" ("ref");
