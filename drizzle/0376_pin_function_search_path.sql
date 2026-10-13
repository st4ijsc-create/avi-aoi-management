-- ════════════════════════════════════════════════════════════════════════════
-- 0376 — doc 81 Đợt 10 task A fix review 2 (ruling R-10-h): PIN THE search_path OF EVERY FUNCTION OF 0363–0371
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY: a plpgsql / sql function WITHOUT `SET search_path` (or with `search_path = public`) resolves an unqualified relation
--   through the CALLER's search_path, where pg_temp is searched FIRST for relations. avi_app has TEMP on the database (the
--   telemetryBus COPY path needs it), so an app session that created `TEMP TABLE api_key_holder_changes / orchestration_runs /
--   edge_node_credentials / orchestration_run_edge_assignments` steered the 0369 / 0370 triggers onto its own fake rows —
--   measured on _test before this migration (edgeDbSearchPath0376.dot10.db.test.ts, RED):
--     • 0369 api_keys_holder_history: the holder history went into the TEMP table (0 real rows) — the SoD exclusion of
--       holders from approving runs started with that key lost its history;
--     • 0370 edge_run_assignment_insert_guard: a RUNNING run was assigned to an edge node;
--     • 0370 edge_run_assignment_guard: a claim named ANOTHER node's credential;
--     • 0370 orch_runs_edge_workflow_pinned: the workflow of an assigned run was changed.
--   0363–0371 are applied on DEV, so they are NOT edited in place: this migration re-creates each function with the SAME body,
--   every relation named `public."…"`, and `SET search_path = pg_catalog, public, pg_temp` (pg_temp LAST). Trigger functions
--   need no EXECUTE to fire: EXECUTE is revoked from PUBLIC (they were PUBLIC-executable by default; nothing calls them).
--   CREATE OR REPLACE keeps each function's oid, so every trigger keeps pointing at it — no trigger is re-created.
--
-- INVENTORY (every CREATE FUNCTION of 0363–0371; 0364 / 0365 / 0366 / 0367 / 0368 create none):
--   0363 orchestration_runs_bump_pending_epoch   — row-only (no relation)                       → pinned, PUBLIC revoked
--   0369 api_keys_holder_history                 — INSERT api_key_holder_changes  (SHADOWABLE)  → qualified + pinned
--   0369 orch_runs_api_key_write_once            — row-only                                     → pinned
--   0370 edge_node_credentials_guard             — row-only                                     → pinned
--   0370 edge_run_assignment_insert_guard        — reads orchestration_runs       (SHADOWABLE)  → qualified + pinned
--   0370 edge_run_assignment_guard               — reads edge_node_credentials    (SHADOWABLE)  → qualified + pinned
--   0370 orch_runs_edge_workflow_pinned          — reads orchestration_run_edge_assignments (SHADOWABLE) → qualified + pinned
--   0371 safety_event_trust_guard                — row-only                                     → pinned
-- fix review 3 (ruling R-10-aa N4): `_test` catalog inventory of EVERY trigger or SECURITY DEFINER plpgsql / sql function in
--   public (37) — the only one without the pin was 0316 kiem_xac_thuc_noi_bo (trigger on users / user_secrets — SHADOWABLE,
--   measured) → re-created below (same body, public.-qualified, pinned). Backlog (INVOKER, not triggers, not on auth / safety
--   tables — a shadow only fools its own caller): app_tenant_allows, factory_timezone, db_storage_timezone, to_factory_time,
--   refresh_qw_caches, ensure_measurement_samples_partition.
-- OLDER SECURITY DEFINER functions owned by aoi (sweep of drizzle/*.sql < 0363): only 0125's app_factory_of_machine_code /
--   _line_id / _line_code (RLS scope helpers). They already name every relation `public.` and run with
--   `search_path = public, pg_temp` (pg_temp last — not shadowable). Cheap + safe: re-pinned to the standard value with
--   ALTER FUNCTION (body untouched). Their EXECUTE grant is NOT changed: RLS policies evaluate them as whichever role queries
--   the hot tables, so they stay PUBLIC-executable (reported; the census test lists them as the one exception).
--
-- ⚠ DDL runs as owner `aoi`: `node scripts/apply-migration-0376.mjs --test-only` (dev: `--dev-only`, the owner decides; no
--   flag ⇒ refused — R-3-g). Requires 0363 + 0369 + 0370 + 0371. Idempotent. ⚠ Re-applying 0363 / 0369 / 0370 / 0371 AFTER
--   this file would put the unpinned bodies back — re-apply 0376 after any of them (the catalog census test catches it).
-- ROLLBACK: re-apply 0363 / 0369 / 0370 / 0371 (their original bodies) and
--   ALTER FUNCTION app_factory_of_machine_code(text) SET search_path = public, pg_temp; (same for _line_id(integer), _line_code(text)).
--

-- ── 0363 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public."orchestration_runs_bump_pending_epoch"() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $fn$
BEGIN
  IF NEW.status::text IN ('held', 'awaiting_confirm') AND OLD.status::text NOT IN ('held', 'awaiting_confirm') THEN
    NEW.pending_epoch := OLD.pending_epoch + 1;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public."orchestration_runs_bump_pending_epoch"() FROM PUBLIC;

-- ── 0369 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.api_keys_holder_history() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  actor integer := NULLIF(current_setting('aoi.actor_user_id', true), '')::integer;
  why text := NULLIF(current_setting('aoi.holder_change_reason', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."holderUserId" IS NOT NULL THEN
      INSERT INTO public."api_key_holder_changes" ("apiKeyId", "fromUserId", "toUserId", "changedBy", "reason")
      VALUES (NEW."id", NULL, NEW."holderUserId", actor, why);
    END IF;
  ELSIF NEW."holderUserId" IS DISTINCT FROM OLD."holderUserId" THEN
    INSERT INTO public."api_key_holder_changes" ("apiKeyId", "fromUserId", "toUserId", "changedBy", "reason")
    VALUES (NEW."id", OLD."holderUserId", NEW."holderUserId", actor, why);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.api_keys_holder_history() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.orch_runs_api_key_write_once() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW."startedViaApiKeyId" IS DISTINCT FROM OLD."startedViaApiKeyId" THEN
    RAISE EXCEPTION 'orchestration_runs.startedViaApiKeyId is set only when the run is inserted (run %)', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orch_runs_api_key_write_once() FROM PUBLIC;

-- ── 0370 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edge_node_credentials_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
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
REVOKE ALL ON FUNCTION public.edge_node_credentials_guard() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.edge_run_assignment_insert_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  r record;
BEGIN
  SELECT x."workflowId", x."status" INTO r FROM public."orchestration_runs" x WHERE x."id" = NEW."runId";
  IF NOT FOUND OR r."workflowId" IS DISTINCT FROM NEW."workflowId" OR r."status" <> 'queued' THEN
    RAISE EXCEPTION 'orchestration_run_edge_assignments: run % must exist, be queued and carry workflow %', NEW."runId", NEW."workflowId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."claimSeq" <> 0 OR NEW."claimTokenHash" IS NOT NULL OR NEW."progressSeq" <> 0 THEN
    RAISE EXCEPTION 'orchestration_run_edge_assignments: a new assignment starts unclaimed (run %)', NEW."runId" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.edge_run_assignment_insert_guard() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.edge_run_assignment_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
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
  IF NEW."claimSeq" = OLD."claimSeq" AND (NEW."claimedByCredentialId" IS DISTINCT FROM OLD."claimedByCredentialId"
     OR NEW."claimedAt" IS DISTINCT FROM OLD."claimedAt") THEN
    RAISE EXCEPTION 'orchestration_run_edge_assignments: the claimant is recorded only by a new claim (run %)', OLD."runId" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."claimSeq" = OLD."claimSeq" + 1 AND NOT EXISTS (
       SELECT 1 FROM public."edge_node_credentials" c WHERE c."id" = NEW."claimedByCredentialId" AND c."edgeNodeId" = NEW."edgeNodeId") THEN
    RAISE EXCEPTION 'orchestration_run_edge_assignments: a claim must name a credential of node % (run %)', NEW."edgeNodeId", OLD."runId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.edge_run_assignment_guard() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.orch_runs_edge_workflow_pinned() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW."workflowId" IS DISTINCT FROM OLD."workflowId"
     AND EXISTS (SELECT 1 FROM public."orchestration_run_edge_assignments" a WHERE a."runId" = OLD."id") THEN
    RAISE EXCEPTION 'orchestration_runs: run % is assigned to an edge node — its workflow is pinned (ID mapping)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orch_runs_edge_workflow_pinned() FROM PUBLIC;

-- ── 0371 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.safety_event_trust_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD."consumedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'safety_event_trust % already consumed (one-way)', OLD."eventId" USING ERRCODE = '23514';
  END IF;
  IF NEW."eventId" IS DISTINCT FROM OLD."eventId" OR NEW."origin" IS DISTINCT FROM OLD."origin"
     OR NEW."eventType" IS DISTINCT FROM OLD."eventType" OR NEW."digest" IS DISTINCT FROM OLD."digest"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'safety_event_trust % content is immutable', OLD."eventId" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.safety_event_trust_guard() FROM PUBLIC;

-- ── 0316 (fix review 3, ruling R-10-aa N4 — measured: a TEMP user_secrets let avi_app switch a user WITH a password hash to
--    loginMethod 'oauth'). Same body, relations public.-qualified, pinned; a trigger function: EXECUTE for nobody. ───────────
CREATE OR REPLACE FUNCTION public.kiem_xac_thuc_noi_bo() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  noi_bo   CONSTANT text[] := ARRAY['local','password'];
  ph       text;
  lm       text;
  uid      integer;
BEGIN
  IF TG_TABLE_NAME = 'user_secrets' THEN
    uid := NEW."userId";
    ph  := NEW."passwordHash";
    SELECT u."loginMethod" INTO lm FROM public."users" u WHERE u.id = uid;
  ELSE
    uid := NEW.id;
    lm  := NEW."loginMethod";
    SELECT s."passwordHash" INTO ph FROM public."user_secrets" s WHERE s."userId" = uid;
  END IF;

  IF ph IS NOT NULL AND NOT (lm = ANY (noi_bo)) THEN
    RAISE EXCEPTION
      'users.id=% có passwordHash nhưng loginMethod=% không được công nhận là xác thực nội bộ; '
      'chủ tài khoản sẽ KHÔNG đổi được mật khẩu (nhà tù I-4). Tập nội bộ: %',
      uid, COALESCE(lm,'<NULL>'), array_to_string(noi_bo, ',')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.kiem_xac_thuc_noi_bo() FROM PUBLIC;

-- ── 0125 SECURITY DEFINER RLS helpers: re-pinned (body and grants untouched; already public.-qualified, pg_temp last) ─
DO $$
BEGIN
  IF to_regprocedure('public.app_factory_of_machine_code(text)') IS NOT NULL THEN
    ALTER FUNCTION public.app_factory_of_machine_code(text) SET search_path = pg_catalog, public, pg_temp;
  END IF;
  IF to_regprocedure('public.app_factory_of_line_id(integer)') IS NOT NULL THEN
    ALTER FUNCTION public.app_factory_of_line_id(integer) SET search_path = pg_catalog, public, pg_temp;
  END IF;
  IF to_regprocedure('public.app_factory_of_line_code(text)') IS NOT NULL THEN
    ALTER FUNCTION public.app_factory_of_line_code(text) SET search_path = pg_catalog, public, pg_temp;
  END IF;
END $$;
