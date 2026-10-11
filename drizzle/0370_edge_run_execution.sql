-- ════════════════════════════════════════════════════════════════════════════
-- 0370 — doc 81 Đợt 9 task S1 (owner decision 2026-10-12, "edge workflow execution — do it fully"):
--        PER-NODE EDGE CREDENTIAL + the EDGE ASSIGNMENT of an orchestration run (ID mapping)
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY: until now an edge node could only PUSH results (POST /api/v1/edge/sync, a shared API key with scope edge:sync) and the
--   edge half of execution was latent (Đợt 8 Q1): no node identity, no pull, and an edge re-execution created a NEW local run
--   (another id) that central then had to map back. Đợt 9 S gives every node its OWN credential and lets central hand a run to
--   exactly one node, which executes THE CENTRAL RUN ROW (same run id, same workflow id — the edge gateway's DATABASE_URL is
--   the central control-plane DB, deploy/edge/docker-compose.edge.yml) under a claim central mints.
--
--   • edge_node_credentials — one secret per node, stored as SHA-256 of the whole token (256-bit random secret ⇒ a fast hash
--     is the right one; the plaintext is shown ONCE at issue and never stored or logged). `keyPrefix` (edn_<12 hex>) is the
--     public lookup id. ROTATION = revoke the active row + insert a new one in ONE transaction (at most one ACTIVE row per node,
--     partial unique index); REVOKE is terminal (trigger: a revoked row never becomes active again, its secret / node / prefix
--     never change). Rows go away only with their node (ON DELETE CASCADE, which itself is refused while the node has run
--     assignments — see below). avi_app: SELECT / INSERT / UPDATE (revoke, lastUsedAt); no DELETE / TRUNCATE.
--   • orchestration_run_edge_assignments — "orchestration_runs gets an edge assignment": 1 row per run handed to a node, keyed
--     by the CENTRAL run id. ID MAPPING: the edge executes `runId` / `workflowId` exactly (never a copy); `workflowVersion` +
--     `defHash` pin the definition snapshot handed out (a redeploy after assignment ⇒ the edge refuses to claim). WRITE-ONCE
--     identity (trigger): runId, edgeNodeId, workflowId, workflowVersion, defHash, assignedBy, assignedAt never change; the
--     insert must match the run row (same workflowId, run still 'queued'). CLAIM: each execution segment (start, and every
--     resume after a central approval / Continue) is claimed by the node through central — `claimSeq` +1, a NEW claim token
--     whose SHA-256 is `claimTokenHash` (the token only ever goes to the edge), the credential that claimed it, and the
--     progress sequence restarts at 0. `claimSeq` never decreases; within a claim `progressSeq` never decreases (a replayed
--     progress report is refused by the application AND cannot move the row back). avi_app: SELECT / INSERT / UPDATE; rows go
--     away only with their run (ON DELETE CASCADE).
--
-- WHY NEW TABLES, NOT NEW COLUMNS ON orchestration_runs (0368 lesson, Group R interface note): `select().from(orchestrationRuns)`
--   is on the ABORT / STOP paths; nothing here is added to that full-row object. The tables are read and written through
--   narrow projections (server/services/edge/edgeExecutionSchema.ts). Missing 0370 ⇒ (42P01) no run can be assigned to a node
--   (refused), node authentication fails (401), every central path is unchanged.
--
-- ⚠ DDL runs as owner `aoi`: `node scripts/apply-migration-0370.mjs --test-only` (dev: `--dev-only`, the owner decides; no
--   flag ⇒ the script REFUSES — R-3-g). ⚠ The repo forbids `drizzle-kit push/generate`.
-- ROLLBACK:
--   DROP TABLE IF EXISTS "orchestration_run_edge_assignments";
--   DROP TABLE IF EXISTS "edge_node_credentials";
--   DROP FUNCTION IF EXISTS edge_run_assignment_guard(); DROP FUNCTION IF EXISTS edge_run_assignment_insert_guard();
--   DROP FUNCTION IF EXISTS edge_node_credentials_guard();
--
CREATE TABLE IF NOT EXISTS "edge_node_credentials" (
  "id" serial PRIMARY KEY,
  "edgeNodeId" integer NOT NULL REFERENCES "edge_nodes"("id") ON DELETE CASCADE,
  "keyPrefix" varchar(32) NOT NULL,
  "secretHash" varchar(64) NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'active',
  "createdBy" integer,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "rotatedFromId" integer REFERENCES "edge_node_credentials"("id"),
  "revokedAt" timestamptz,
  "revokedBy" integer,
  "revokeReason" text,
  "lastUsedAt" timestamptz,
  CONSTRAINT "uq_edge_node_credentials_prefix" UNIQUE ("keyPrefix"),
  CONSTRAINT "ck_edge_cred_status" CHECK ("status" IN ('active', 'revoked')),
  CONSTRAINT "ck_edge_cred_hash" CHECK ("secretHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_edge_cred_prefix" CHECK ("keyPrefix" ~ '^edn_[0-9a-f]{12}$'),
  CONSTRAINT "ck_edge_cred_revoked" CHECK (("status" = 'revoked') = ("revokedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_edge_node_credentials_one_active" ON "edge_node_credentials" ("edgeNodeId") WHERE "status" = 'active';
COMMENT ON TABLE "edge_node_credentials" IS
  'doc 81 Dot 9 S1: per-node edge credential (sha256 of the token; plaintext never stored). Rotation = revoke + insert in one tx; revoke is terminal.';

CREATE OR REPLACE FUNCTION edge_node_credentials_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."edgeNodeId" IS DISTINCT FROM OLD."edgeNodeId" OR NEW."keyPrefix" IS DISTINCT FROM OLD."keyPrefix"
     OR NEW."secretHash" IS DISTINCT FROM OLD."secretHash" OR NEW."createdBy" IS DISTINCT FROM OLD."createdBy"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW."rotatedFromId" IS DISTINCT FROM OLD."rotatedFromId" THEN
    RAISE EXCEPTION 'edge_node_credentials: identity columns are write-once (credential %)', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'revoked' AND (NEW."status" <> 'revoked' OR NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt"
     OR NEW."revokedBy" IS DISTINCT FROM OLD."revokedBy" OR NEW."revokeReason" IS DISTINCT FROM OLD."revokeReason") THEN
    RAISE EXCEPTION 'edge_node_credentials: a revoked credential stays revoked (credential %)', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_edge_node_credentials_guard ON "edge_node_credentials";
CREATE TRIGGER trg_edge_node_credentials_guard BEFORE UPDATE ON "edge_node_credentials"
  FOR EACH ROW EXECUTE FUNCTION edge_node_credentials_guard();

CREATE TABLE IF NOT EXISTS "orchestration_run_edge_assignments" (
  "runId" integer PRIMARY KEY REFERENCES "orchestration_runs"("id") ON DELETE CASCADE,
  "edgeNodeId" integer NOT NULL REFERENCES "edge_nodes"("id") ON DELETE RESTRICT,
  "workflowId" integer NOT NULL,
  "workflowVersion" integer NOT NULL,
  "defHash" varchar(64) NOT NULL,
  "assignedBy" integer,
  "assignedAt" timestamptz NOT NULL DEFAULT now(),
  "claimSeq" integer NOT NULL DEFAULT 0,
  "claimTokenHash" varchar(64),
  "claimedByCredentialId" integer REFERENCES "edge_node_credentials"("id"),
  "claimedAt" timestamptz,
  "progressSeq" bigint NOT NULL DEFAULT 0,
  "lastProgressAt" timestamptz,
  CONSTRAINT "ck_edge_assign_workflow" CHECK ("workflowId" > 0 AND "workflowVersion" > 0),
  CONSTRAINT "ck_edge_assign_defhash" CHECK ("defHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_edge_assign_claim_hash" CHECK ("claimTokenHash" IS NULL OR "claimTokenHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_edge_assign_seqs" CHECK ("claimSeq" >= 0 AND "progressSeq" >= 0)
);
CREATE INDEX IF NOT EXISTS "idx_orch_run_edge_assign_node" ON "orchestration_run_edge_assignments" ("edgeNodeId");
COMMENT ON TABLE "orchestration_run_edge_assignments" IS
  'doc 81 Dot 9 S1: the edge assignment of an orchestration run (ID mapping: the edge executes this central runId/workflowId). Identity write-once; claimSeq/progressSeq never decrease.';

CREATE OR REPLACE FUNCTION edge_run_assignment_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  SELECT "workflowId", "status" INTO r FROM "orchestration_runs" WHERE "id" = NEW."runId";
  IF NOT FOUND OR r."workflowId" IS DISTINCT FROM NEW."workflowId" OR r."status" <> 'queued' THEN
    RAISE EXCEPTION 'orchestration_run_edge_assignments: run % must exist, be queued and carry workflow %', NEW."runId", NEW."workflowId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."claimSeq" <> 0 OR NEW."claimTokenHash" IS NOT NULL OR NEW."progressSeq" <> 0 THEN
    RAISE EXCEPTION 'orchestration_run_edge_assignments: a new assignment starts unclaimed (run %)', NEW."runId" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_edge_run_assignment_insert ON "orchestration_run_edge_assignments";
CREATE TRIGGER trg_edge_run_assignment_insert BEFORE INSERT ON "orchestration_run_edge_assignments"
  FOR EACH ROW EXECUTE FUNCTION edge_run_assignment_insert_guard();

CREATE OR REPLACE FUNCTION edge_run_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."runId" IS DISTINCT FROM OLD."runId" OR NEW."edgeNodeId" IS DISTINCT FROM OLD."edgeNodeId"
     OR NEW."workflowId" IS DISTINCT FROM OLD."workflowId" OR NEW."workflowVersion" IS DISTINCT FROM OLD."workflowVersion"
     OR NEW."defHash" IS DISTINCT FROM OLD."defHash" OR NEW."assignedBy" IS DISTINCT FROM OLD."assignedBy"
     OR NEW."assignedAt" IS DISTINCT FROM OLD."assignedAt" THEN
    RAISE EXCEPTION 'orchestration_run_edge_assignments: identity is write-once (run %)', OLD."runId" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."claimSeq" < OLD."claimSeq" OR NEW."claimSeq" > OLD."claimSeq" + 1 THEN
    RAISE EXCEPTION 'orchestration_run_edge_assignments: claimSeq only moves up by one (run %)', OLD."runId" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."claimSeq" = OLD."claimSeq" + 1 AND (NEW."claimTokenHash" IS NULL OR NEW."progressSeq" <> 0) THEN
    RAISE EXCEPTION 'orchestration_run_edge_assignments: a new claim needs a token and restarts progress (run %)', OLD."runId" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."claimSeq" = OLD."claimSeq" AND NEW."progressSeq" < OLD."progressSeq" THEN
    RAISE EXCEPTION 'orchestration_run_edge_assignments: progressSeq never decreases within a claim (run %)', OLD."runId" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."claimSeq" = OLD."claimSeq" AND NEW."claimTokenHash" IS NOT NULL AND NEW."claimTokenHash" IS DISTINCT FROM OLD."claimTokenHash" THEN
    RAISE EXCEPTION 'orchestration_run_edge_assignments: a claim token is set only by a new claim (run %)', OLD."runId" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_edge_run_assignment_guard ON "orchestration_run_edge_assignments";
CREATE TRIGGER trg_edge_run_assignment_guard BEFORE UPDATE ON "orchestration_run_edge_assignments"
  FOR EACH ROW EXECUTE FUNCTION edge_run_assignment_guard();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    -- explicit REVOKE: the dev default ACL grants avi_app everything (0357, measured 2026-09-15).
    REVOKE DELETE, TRUNCATE ON "edge_node_credentials" FROM avi_app;
    REVOKE DELETE, TRUNCATE ON "orchestration_run_edge_assignments" FROM avi_app;
    GRANT SELECT, INSERT, UPDATE ON "edge_node_credentials" TO avi_app;
    GRANT SELECT, INSERT, UPDATE ON "orchestration_run_edge_assignments" TO avi_app;
    GRANT USAGE ON SEQUENCE "edge_node_credentials_id_seq" TO avi_app;
  END IF;
END $$;
