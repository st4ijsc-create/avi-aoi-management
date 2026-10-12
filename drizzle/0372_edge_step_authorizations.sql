-- ════════════════════════════════════════════════════════════════════════════
-- 0372 — doc 81 Đợt 10 task A (owner decision 2026-10-12, "Đợt 10: bỏ DB login khỏi edge", design §2.5 / §3):
--        PER-STEP EDGE AUTHORISATIONS (`edge_step_authorizations`)
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY: the edge gateway no longer holds a central DB login. Every NON-STOP command step it executes needs a fresh, single-use
--   authorisation that central signs (Ed25519, edgeSigning.ts typ `auth`) at POST /api/v1/edge/node/runs/:id/authorize. This
--   table is central's record of each one: who got it (node + credential), for what (run, claim, step, attempt, idempotency
--   key, kind, payloadHash), under which approval / verdicts, signed by which kid, the hash of the edge's request nonce, its
--   validity, and — later — the ONE result the edge reported under it (a result report must quote a jti issued for that
--   exact (run, claim, step, attempt); central accepts one result per jti).
--
-- SEMANTICS:
--   • jti (uuid) = the authorisation id inside the signed claims;
--   • UNIQUE (runId, claimSeq, stepId, attempt): at most one authorisation per attempt — a repeated /authorize with the SAME
--     nonce returns the stored token (reqNonceHash matches), another nonce gets 409 already_authorized;
--   • INSERT guard: the run must be assigned to that node with that claim CURRENT (claimSeq equal, token set), the credential
--     must be the node's, the result / supersede columns start empty, and expiresAt ∈ (issuedAt, issuedAt + 60 s];
--   • WRITE-ONCE (trigger, IS DISTINCT FROM — a change, a clear AND a late first write are all refused): every identity
--     column; resultReportedAt / resultStatus are written once, together (CHECK), then frozen; supersededAt is written once.
--
-- avi_app (EXACT set): SELECT, INSERT, and UPDATE ONLY of ("resultReportedAt", "resultStatus", "supersededAt"); no DELETE /
--   TRUNCATE (rows go with their run: ON DELETE CASCADE; a node with authorisations cannot be deleted: RESTRICT).
-- Read / written only through the narrow projection in server/services/edge/edgeControlSchema.ts (0368 lesson).
--
-- ⚠ DDL runs as owner `aoi`: `node scripts/apply-migration-0372.mjs --test-only` (dev: `--dev-only`, the owner decides; no
--   flag ⇒ refused — R-3-g). ⚠ The repo forbids `drizzle-kit push/generate`.
-- ROLLBACK:
--   DROP TABLE IF EXISTS "edge_step_authorizations";
--   DROP FUNCTION IF EXISTS edge_step_auth_insert_guard(); DROP FUNCTION IF EXISTS edge_step_auth_guard();
--
CREATE TABLE IF NOT EXISTS "edge_step_authorizations" (
  "jti" uuid PRIMARY KEY,
  "edgeNodeId" integer NOT NULL REFERENCES "edge_nodes"("id") ON DELETE RESTRICT,
  "credentialId" integer NOT NULL REFERENCES "edge_node_credentials"("id"),
  "runId" integer NOT NULL REFERENCES "orchestration_runs"("id") ON DELETE CASCADE,
  "claimSeq" integer NOT NULL,
  "stepId" varchar(128) NOT NULL,
  "attempt" integer NOT NULL,
  "idempotencyKey" varchar(128) NOT NULL,
  "kind" varchar(8) NOT NULL,
  "payloadHash" varchar(71) NOT NULL,
  "approvalJson" jsonb,
  "verdictJson" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "kid" varchar(64) NOT NULL,
  "reqNonceHash" varchar(64) NOT NULL,
  "issuedAt" timestamptz NOT NULL DEFAULT now(),
  "expiresAt" timestamptz NOT NULL,
  "resultReportedAt" timestamptz,
  "resultStatus" varchar(32),
  "supersededAt" timestamptz,
  CONSTRAINT "uq_edge_step_auth_attempt" UNIQUE ("runId", "claimSeq", "stepId", "attempt"),
  CONSTRAINT "ck_edge_step_auth_seq" CHECK ("claimSeq" > 0 AND "attempt" >= 1),
  CONSTRAINT "ck_edge_step_auth_kind" CHECK ("kind" IN ('ot', 'robot')),
  CONSTRAINT "ck_edge_step_auth_payload" CHECK ("payloadHash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "ck_edge_step_auth_kid" CHECK ("kid" ~ '^edk_[A-Za-z0-9_-]{22}$'),
  CONSTRAINT "ck_edge_step_auth_nonce" CHECK ("reqNonceHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_edge_step_auth_ttl" CHECK ("expiresAt" > "issuedAt" AND "expiresAt" <= "issuedAt" + interval '60 seconds'),
  CONSTRAINT "ck_edge_step_auth_result" CHECK (("resultReportedAt" IS NULL) = ("resultStatus" IS NULL))
);
CREATE INDEX IF NOT EXISTS "idx_edge_step_auth_node" ON "edge_step_authorizations" ("edgeNodeId");
CREATE INDEX IF NOT EXISTS "idx_edge_step_auth_run" ON "edge_step_authorizations" ("runId", "claimSeq");
COMMENT ON TABLE "edge_step_authorizations" IS
  'doc 81 Dot 10 A (0372): per-step signed edge authorisations (jti). One per (run, claim, step, attempt); identity write-once; one result per jti.';

CREATE OR REPLACE FUNCTION edge_step_auth_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM "orchestration_run_edge_assignments" a
        WHERE a."runId" = NEW."runId" AND a."edgeNodeId" = NEW."edgeNodeId"
          AND a."claimSeq" = NEW."claimSeq" AND a."claimTokenHash" IS NOT NULL) THEN
    RAISE EXCEPTION 'edge_step_authorizations: run % is not under a current claim % of node %', NEW."runId", NEW."claimSeq", NEW."edgeNodeId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "edge_node_credentials" c WHERE c."id" = NEW."credentialId" AND c."edgeNodeId" = NEW."edgeNodeId") THEN
    RAISE EXCEPTION 'edge_step_authorizations: credential % is not a credential of node %', NEW."credentialId", NEW."edgeNodeId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."resultReportedAt" IS NOT NULL OR NEW."resultStatus" IS NOT NULL OR NEW."supersededAt" IS NOT NULL THEN
    RAISE EXCEPTION 'edge_step_authorizations: a new authorisation carries no result (jti %)', NEW."jti" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_edge_step_auth_insert ON "edge_step_authorizations";
CREATE TRIGGER trg_edge_step_auth_insert BEFORE INSERT ON "edge_step_authorizations"
  FOR EACH ROW EXECUTE FUNCTION edge_step_auth_insert_guard();

CREATE OR REPLACE FUNCTION edge_step_auth_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."jti" IS DISTINCT FROM OLD."jti" OR NEW."edgeNodeId" IS DISTINCT FROM OLD."edgeNodeId"
     OR NEW."credentialId" IS DISTINCT FROM OLD."credentialId" OR NEW."runId" IS DISTINCT FROM OLD."runId"
     OR NEW."claimSeq" IS DISTINCT FROM OLD."claimSeq" OR NEW."stepId" IS DISTINCT FROM OLD."stepId"
     OR NEW."attempt" IS DISTINCT FROM OLD."attempt" OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
     OR NEW."kind" IS DISTINCT FROM OLD."kind" OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash"
     OR NEW."approvalJson" IS DISTINCT FROM OLD."approvalJson" OR NEW."verdictJson" IS DISTINCT FROM OLD."verdictJson"
     OR NEW."kid" IS DISTINCT FROM OLD."kid" OR NEW."reqNonceHash" IS DISTINCT FROM OLD."reqNonceHash"
     OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt" OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" THEN
    RAISE EXCEPTION 'edge_step_authorizations: identity is write-once (jti %)', OLD."jti" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."resultReportedAt" IS NOT NULL AND (NEW."resultReportedAt" IS DISTINCT FROM OLD."resultReportedAt"
     OR NEW."resultStatus" IS DISTINCT FROM OLD."resultStatus") THEN
    RAISE EXCEPTION 'edge_step_authorizations: one result per authorisation (jti %)', OLD."jti" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."supersededAt" IS NOT NULL AND NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt" THEN
    RAISE EXCEPTION 'edge_step_authorizations: supersededAt is written once (jti %)', OLD."jti" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_edge_step_auth_guard ON "edge_step_authorizations";
CREATE TRIGGER trg_edge_step_auth_guard BEFORE UPDATE ON "edge_step_authorizations"
  FOR EACH ROW EXECUTE FUNCTION edge_step_auth_guard();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    -- the EXACT privilege set: everything revoked first (the dev default ACL grants avi_app everything), then only what
    -- the code needs; UPDATE is column-level.
    REVOKE ALL ON "edge_step_authorizations" FROM avi_app;
    GRANT SELECT, INSERT ON "edge_step_authorizations" TO avi_app;
    GRANT UPDATE ("resultReportedAt", "resultStatus", "supersededAt") ON "edge_step_authorizations" TO avi_app;
  END IF;
END $$;
