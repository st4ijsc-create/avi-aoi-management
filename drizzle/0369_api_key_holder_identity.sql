-- ════════════════════════════════════════════════════════════════════════════
-- 0369 — doc 81 Đợt 9 task R1 (owner decision 2026-10-12, option A): API-KEY HOLDER IDENTITY
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY: a bearer secret has no human identity, so four-eyes ("approved by someone other than the run owner") could not be
--   enforced against the person holding an API key (doc 81 item 24). Đợt 5 E1 (option C) therefore refused every non-STOP
--   OT/robot command of an API-started run. Option A replaces that: a key records WHO IT IS ISSUED TO, a run records WHICH
--   KEY STARTED IT, and an approval of an API-started run counts only when the approver is none of
--   {the run's starter, the key's holder (now and every earlier holder), the key's creator} — re-derived from these rows by
--   the engine and both dispatchers (foeGateApproval.deriveRunApprovalIdentity), never taken from the action.
--
--   • api_keys."holderUserId" — the user the key is ISSUED TO. Defaults to the creator (backfilled below for existing keys;
--     apiKeyRouter.create writes it for new keys). Changed only by an admin (apiKeyRouter.setHolder), every change audited.
--     NULL ⇒ the key has no holder ⇒ an API-started run is owner-less ⇒ refused (ownerUnknown), as before.
--   • api_key_holder_changes — APPEND-ONLY history of every holder value a key has had, written by a TRIGGER (so a change by
--     any path — router, psql, script — is recorded). Every user in it stays excluded from approving that key's runs: changing
--     the holder does not change the secret, the earlier holder may still have it.
--   • orchestration_runs."startedViaApiKeyId" — the key that started the run (written by foeEngine.startRun, server side
--     only). WRITE-ONCE (trigger): once set it can never be changed or cleared.
--
-- WHY THE NEW COLUMNS ARE NOT ON THE MAIN DRIZZLE TABLE OBJECTS (0368 lesson): `select().from(apiKeys)` is on the API v1
--   AUTH path and `select().from(orchestrationRuns)` is on the ABORT / STOP paths. Code with these columns on the full-row
--   objects, running before this migration is applied, would break both (42703). They are read and written through narrow
--   projections (server/services/orchestration/foe/runApiKeyIdentity.ts): missing columns only mean "API runs cannot be
--   identified ⇒ refused (apiRun), keys show no holder" — fail-closed for the approval rule only, every other path unchanged.
--
-- GRANTS avi_app: api_key_holder_changes SELECT + INSERT only (WORM: no UPDATE / DELETE / TRUNCATE). The new columns inherit
--   the existing table grants of api_keys / orchestration_runs.
--
-- ⚠ DDL runs as owner `aoi`: `node scripts/apply-migration-0369.mjs --test-only` (dev: `--dev-only`, the owner decides; no
--   flag ⇒ the script REFUSES — R-3-g). ⚠ The repo forbids `drizzle-kit push/generate`.
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_orch_runs_api_key_write_once ON "orchestration_runs";
--   DROP TRIGGER IF EXISTS trg_api_keys_holder_history ON "api_keys";
--   DROP FUNCTION IF EXISTS orch_runs_api_key_write_once(); DROP FUNCTION IF EXISTS api_keys_holder_history();
--   DROP TABLE IF EXISTS "api_key_holder_changes";
--   ALTER TABLE "orchestration_runs" DROP COLUMN IF EXISTS "startedViaApiKeyId";
--   ALTER TABLE "api_keys" DROP COLUMN IF EXISTS "holderUserId";
--
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "holderUserId" integer;
ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "ck_api_keys_holder_real";
ALTER TABLE "api_keys" ADD CONSTRAINT "ck_api_keys_holder_real" CHECK ("holderUserId" IS NULL OR "holderUserId" > 0);
COMMENT ON COLUMN "api_keys"."holderUserId" IS
  'doc 81 Dot 9 R1 (option A): user the key is issued to (default = creator). Admin-only change, every change recorded in api_key_holder_changes. NULL = no holder => API runs owner-less (refused).';

-- Default = the creator, for every existing key that has one (idempotent: only keys that never had a holder).
UPDATE "api_keys" SET "holderUserId" = "createdBy" WHERE "holderUserId" IS NULL AND "createdBy" IS NOT NULL AND "createdBy" > 0;

CREATE TABLE IF NOT EXISTS "api_key_holder_changes" (
  "id" serial PRIMARY KEY,
  "apiKeyId" integer NOT NULL,
  "fromUserId" integer,
  "toUserId" integer,
  -- the acting user (session setting aoi.actor_user_id, set by apiKeyRouter inside its transaction); NULL = changed outside
  -- the application (psql / script) — still recorded.
  "changedBy" integer,
  "reason" text,
  "changedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_api_key_holder_changes_key" ON "api_key_holder_changes" ("apiKeyId");
COMMENT ON TABLE "api_key_holder_changes" IS
  'doc 81 Dot 9 R1: append-only history of api_keys.holderUserId (trigger). Every user in it is excluded from approving runs started with that key.';

CREATE OR REPLACE FUNCTION api_keys_holder_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actor integer := NULLIF(current_setting('aoi.actor_user_id', true), '')::integer;
  why text := NULLIF(current_setting('aoi.holder_change_reason', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."holderUserId" IS NOT NULL THEN
      INSERT INTO "api_key_holder_changes" ("apiKeyId", "fromUserId", "toUserId", "changedBy", "reason")
      VALUES (NEW."id", NULL, NEW."holderUserId", actor, why);
    END IF;
  ELSIF NEW."holderUserId" IS DISTINCT FROM OLD."holderUserId" THEN
    INSERT INTO "api_key_holder_changes" ("apiKeyId", "fromUserId", "toUserId", "changedBy", "reason")
    VALUES (NEW."id", OLD."holderUserId", NEW."holderUserId", actor, why);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_api_keys_holder_history ON "api_keys";
CREATE TRIGGER trg_api_keys_holder_history AFTER INSERT OR UPDATE OF "holderUserId" ON "api_keys"
  FOR EACH ROW EXECUTE FUNCTION api_keys_holder_history();

-- The backfill above ran before the trigger existed: record those defaults once (idempotent — only keys with no history).
INSERT INTO "api_key_holder_changes" ("apiKeyId", "fromUserId", "toUserId", "changedBy", "reason")
SELECT k."id", NULL, k."holderUserId", NULL, 'mig 0369 default = creator'
  FROM "api_keys" k
 WHERE k."holderUserId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "api_key_holder_changes" h WHERE h."apiKeyId" = k."id");

ALTER TABLE "orchestration_runs" ADD COLUMN IF NOT EXISTS "startedViaApiKeyId" integer;
ALTER TABLE "orchestration_runs" DROP CONSTRAINT IF EXISTS "ck_orch_runs_api_key_real";
ALTER TABLE "orchestration_runs" ADD CONSTRAINT "ck_orch_runs_api_key_real" CHECK ("startedViaApiKeyId" IS NULL OR "startedViaApiKeyId" > 0);
COMMENT ON COLUMN "orchestration_runs"."startedViaApiKeyId" IS
  'doc 81 Dot 9 R1 (option A): the API key that started this run (server-written by foeEngine.startRun). Write-once.';

CREATE OR REPLACE FUNCTION orch_runs_api_key_write_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."startedViaApiKeyId" IS NOT NULL AND NEW."startedViaApiKeyId" IS DISTINCT FROM OLD."startedViaApiKeyId" THEN
    RAISE EXCEPTION 'orchestration_runs.startedViaApiKeyId is write-once (run %)', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_orch_runs_api_key_write_once ON "orchestration_runs";
CREATE TRIGGER trg_orch_runs_api_key_write_once BEFORE UPDATE OF "startedViaApiKeyId" ON "orchestration_runs"
  FOR EACH ROW EXECUTE FUNCTION orch_runs_api_key_write_once();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    -- explicit REVOKE: the dev default ACL grants avi_app everything (0357, measured 2026-09-15).
    REVOKE UPDATE, DELETE, TRUNCATE ON "api_key_holder_changes" FROM avi_app;
    GRANT SELECT, INSERT ON "api_key_holder_changes" TO avi_app;
    GRANT USAGE ON SEQUENCE "api_key_holder_changes_id_seq" TO avi_app;
  END IF;
END $$;
