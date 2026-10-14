-- ════════════════════════════════════════════════════════════════════════════
-- 0378 — doc 81 Đợt 12 task O: RETIRE an edge node (never delete it)
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY: a decommissioned edge node could only have its credential revoked. Its row stayed "offline" with nothing saying it is
--   gone for good: an admin could issue it a new credential, hand it devices or runs again, re-register its code, or delete the
--   row (WORM evidence references it ON DELETE RESTRICT — 0370 assignments, 0372 step authorisations, 0374 lock authority). The
--   status enum (online | offline | degraded) has no "retired", and the status is rewritten by heartbeats / the stale sweep, so
--   it cannot carry a terminal state. A retirement is three WRITE-ONCE columns instead, enforced HERE (not only in the app):
--
-- • edge_nodes."retiredAt" timestamptz, "retiredBy" integer (> 0), "retireReason" text (≥ 3 chars): all NULL or all set (CHECK).
-- • public.edge_node_retire_guard() — BEFORE UPDATE OR DELETE ON edge_nodes:
--     – RETIRING (retiredAt NULL → set): refused unless "retiredBy" is an ACTIVE ADMIN and the node has NOTHING left — no active
--       credential, no robot / adapter it owns, no unacknowledged STOP (pending head, or a refused / failed one not resolved by a
--       person), no unacknowledged lock / clear request, no non-terminal run (an edge assignment, or a legacy v1 delegation via
--       orchestration_runs."edgeNodeId"). The refusal NAMES every blocker (ids). The status is forced to 'offline'.
--     – RETIRED: the three columns, "code", "factoryCode", "assignedLineCodes" and "protocolVersion" never change (never
--       un-retired; its code is never freed for a re-registration); the status stays 'offline'. ("name" — a label — may change.)
--     – a retired node is NEVER DELETED (the evidence that references it stays resolvable).
-- • public.edge_node_refuse_retired_target() — a retired node is GIVEN NOTHING again (BEFORE INSERT, and BEFORE UPDATE when the
--   node column changes to it): edge_node_credentials (no new credential — a revoked one never comes back, 0370), robots /
--   device_adapters ("edgeNodeId" — no device), orchestration_run_edge_assignments (no run) and a NEW CLAIM on one of its
--   assignments (claimSeq + 1), orchestration_runs."edgeNodeId" (no legacy delegation).
--   Each reads the node row FOR SHARE: a retirement (which takes the row FOR NO KEY UPDATE) and any of these writes are
--   SERIALISED — whichever commits second sees the other (a retirement re-checks its blockers in the guard above with a fresh
--   snapshot; a write after the retirement sees "retiredAt"). Never a retired owner, never a credential of a retired node.
--
-- L-7: nothing here is on the STOP path. A STOP request's FK check on edge_nodes takes FOR KEY SHARE, which a retirement's FOR NO
--   KEY UPDATE does not block (measured: edge-node-credential.retire.dot12.db.test.ts). A node with a pending STOP is NOT
--   retired — the STOP is executed / acknowledged / resolved first (§8.9). Requests are never refused by this file.
--
-- avi_app: SELECT / UPDATE on edge_nodes as before (table grant; the guard decides what an UPDATE may do); the two functions are
--   trigger functions (no EXECUTE for anyone). The app reads the columns through to_jsonb(row) (works before this file too).
--
-- ⚠ DDL runs as owner `aoi`: `node scripts/apply-migration-0378.mjs --test-only` (dev: `--dev-only`, the owner decides; no flag ⇒
--   refused — R-3-g). Requires 0370 + 0374 (+ 0376 / 0377). Idempotent. Redefines no function of 0376 / 0377.
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_edge_nodes_retire_guard ON "edge_nodes"; DROP TRIGGER IF EXISTS trg_edge_nodes_retire_keep ON "edge_nodes";
--   DROP TRIGGER IF EXISTS trg_edge_node_credentials_retired_ins ON "edge_node_credentials";
--   DROP TRIGGER IF EXISTS trg_robots_edge_retired_ins ON "robots"; DROP TRIGGER IF EXISTS trg_robots_edge_retired_upd ON "robots";
--   DROP TRIGGER IF EXISTS trg_adapters_edge_retired_ins ON "device_adapters"; DROP TRIGGER IF EXISTS trg_adapters_edge_retired_upd ON "device_adapters";
--   DROP TRIGGER IF EXISTS trg_edge_run_assignment_retired_ins ON "orchestration_run_edge_assignments";
--   DROP TRIGGER IF EXISTS trg_edge_run_assignment_retired_claim ON "orchestration_run_edge_assignments";
--   DROP TRIGGER IF EXISTS trg_orch_runs_edge_retired_ins ON "orchestration_runs"; DROP TRIGGER IF EXISTS trg_orch_runs_edge_retired_upd ON "orchestration_runs";
--   DROP FUNCTION IF EXISTS public.edge_node_retire_guard(), public.edge_node_refuse_retired_target();
--   ALTER TABLE "edge_nodes" DROP CONSTRAINT IF EXISTS "ck_edge_nodes_retired",
--     DROP COLUMN IF EXISTS "retiredAt", DROP COLUMN IF EXISTS "retiredBy", DROP COLUMN IF EXISTS "retireReason";
--

ALTER TABLE public."edge_nodes" ADD COLUMN IF NOT EXISTS "retiredAt" timestamptz;
ALTER TABLE public."edge_nodes" ADD COLUMN IF NOT EXISTS "retiredBy" integer;
ALTER TABLE public."edge_nodes" ADD COLUMN IF NOT EXISTS "retireReason" text;
ALTER TABLE public."edge_nodes" DROP CONSTRAINT IF EXISTS "ck_edge_nodes_retired";
ALTER TABLE public."edge_nodes" ADD CONSTRAINT "ck_edge_nodes_retired" CHECK (
  ("retiredAt" IS NULL AND "retiredBy" IS NULL AND "retireReason" IS NULL)
  -- every operand NOT NULL explicitly: a CHECK passes on NULL, so `"retiredBy" > 0` alone would let a half-retired row in
  OR ("retiredAt" IS NOT NULL AND "retiredBy" IS NOT NULL AND "retiredBy" > 0
      AND "retireReason" IS NOT NULL AND length(btrim("retireReason")) >= 3));
CREATE INDEX IF NOT EXISTS "idx_edge_nodes_retired" ON public."edge_nodes" ("retiredAt") WHERE "retiredAt" IS NOT NULL;
COMMENT ON COLUMN public."edge_nodes"."retiredAt" IS
  'doc 81 Dot 12 O (mig 0378): when the node was RETIRED (write-once; never un-retired, never deleted; given no credential / device / run again).';

-- ══ the node row ═══════════════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.edge_node_retire_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  blockers text[] := ARRAY[]::text[];
  ids text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."retiredAt" IS NOT NULL THEN
      RAISE EXCEPTION 'edge_nodes: node % (id %) is retired — it is kept (evidence references it) and never deleted', OLD."code", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."retiredAt" IS NOT NULL THEN
    IF NEW."retiredAt" IS DISTINCT FROM OLD."retiredAt" OR NEW."retiredBy" IS DISTINCT FROM OLD."retiredBy"
       OR NEW."retireReason" IS DISTINCT FROM OLD."retireReason" OR NEW."code" IS DISTINCT FROM OLD."code"
       OR NEW."factoryCode" IS DISTINCT FROM OLD."factoryCode" OR NEW."assignedLineCodes" IS DISTINCT FROM OLD."assignedLineCodes"
       OR NEW."protocolVersion" IS DISTINCT FROM OLD."protocolVersion" THEN
      RAISE EXCEPTION 'edge_nodes: node % (id %) is retired — its retirement, code, factory, lines and protocol never change', OLD."code", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."status" IS DISTINCT FROM 'offline' THEN
      RAISE EXCEPTION 'edge_nodes: node % (id %) is retired — it never comes online again', OLD."code", OLD."id" USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."retiredAt" IS NULL THEN
    RETURN NEW;
  END IF;
  -- RETIRING now: a proven admin's id, and nothing left on the node
  IF NOT EXISTS (SELECT 1 FROM public."users" u WHERE u."id" = NEW."retiredBy" AND u."role" = 'admin' AND u."isActive" IS NOT FALSE) THEN
    RAISE EXCEPTION 'edge_nodes: node % (id %) — retiredBy % is not an active admin', OLD."code", OLD."id", NEW."retiredBy" USING ERRCODE = 'check_violation';
  END IF;
  SELECT string_agg(x."id"::text, ', ' ORDER BY x."id") INTO ids
    FROM (SELECT c."id" FROM public."edge_node_credentials" c WHERE c."edgeNodeId" = OLD."id" AND c."status" = 'active' ORDER BY c."id" LIMIT 20) x;
  IF ids IS NOT NULL THEN blockers := blockers || ('active credential(s) ' || ids); END IF;
  SELECT string_agg(x."id"::text, ', ' ORDER BY x."id") INTO ids
    FROM (SELECT r."id" FROM public."robots" r WHERE r."edgeNodeId" = OLD."id" ORDER BY r."id" LIMIT 20) x;
  IF ids IS NOT NULL THEN blockers := blockers || ('it owns robot(s) ' || ids); END IF;
  SELECT string_agg(x."id"::text, ', ' ORDER BY x."id") INTO ids
    FROM (SELECT a."id" FROM public."device_adapters" a WHERE a."edgeNodeId" = OLD."id" ORDER BY a."id" LIMIT 20) x;
  IF ids IS NOT NULL THEN blockers := blockers || ('it owns adapter(s) ' || ids); END IF;
  SELECT string_agg(x."id"::text, ', ' ORDER BY x."id") INTO ids
    FROM (SELECT q."id" FROM public."robot_motion_lock_requests" q
           WHERE q."edgeNodeId" = OLD."id" AND q."kind" = 'stop' AND q."carriedToId" IS NULL AND q."resolvedAt" IS NULL
             AND (q."ackedAt" IS NULL OR q."outcome" IN ('refused', 'failed'))
           ORDER BY q."id" LIMIT 20) x;
  IF ids IS NOT NULL THEN blockers := blockers || ('unacknowledged STOP request(s) ' || ids); END IF;
  SELECT string_agg(x."id"::text, ', ' ORDER BY x."id") INTO ids
    FROM (SELECT q."id" FROM public."robot_motion_lock_requests" q
           WHERE q."edgeNodeId" = OLD."id" AND q."kind" IN ('lock', 'clear') AND q."ackedAt" IS NULL ORDER BY q."id" LIMIT 20) x;
  IF ids IS NOT NULL THEN blockers := blockers || ('unacknowledged lock / clear request(s) ' || ids); END IF;
  SELECT string_agg(x."id"::text, ', ' ORDER BY x."id") INTO ids
    FROM (SELECT o."id" FROM public."orchestration_runs" o
           WHERE o."status" NOT IN ('completed', 'failed', 'aborted')
             AND (o."edgeNodeId" = OLD."id"
                  OR EXISTS (SELECT 1 FROM public."orchestration_run_edge_assignments" e WHERE e."runId" = o."id" AND e."edgeNodeId" = OLD."id"))
           ORDER BY o."id" LIMIT 20) x;
  IF ids IS NOT NULL THEN blockers := blockers || ('non-terminal run(s) ' || ids); END IF;
  IF cardinality(blockers) > 0 THEN
    RAISE EXCEPTION 'edge_nodes: node % (id %) cannot be retired: %', OLD."code", OLD."id", array_to_string(blockers, '; ')
      USING ERRCODE = 'check_violation';
  END IF;
  NEW."status" := 'offline';
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.edge_node_retire_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_edge_nodes_retire_guard ON public."edge_nodes";
CREATE TRIGGER trg_edge_nodes_retire_guard BEFORE UPDATE ON public."edge_nodes"
  FOR EACH ROW EXECUTE FUNCTION public.edge_node_retire_guard();
DROP TRIGGER IF EXISTS trg_edge_nodes_retire_keep ON public."edge_nodes";
CREATE TRIGGER trg_edge_nodes_retire_keep BEFORE DELETE ON public."edge_nodes"
  FOR EACH ROW EXECUTE FUNCTION public.edge_node_retire_guard();

-- ══ nothing is given to a retired node ═════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.edge_node_refuse_retired_target() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  retired timestamptz;
  ncode text;
BEGIN
  -- FOR SHARE: serialised against a retirement of this node (FOR NO KEY UPDATE) — see the header
  SELECT n."retiredAt", n."code" INTO retired, ncode FROM public."edge_nodes" n WHERE n."id" = NEW."edgeNodeId" FOR SHARE;
  IF retired IS NOT NULL THEN
    RAISE EXCEPTION '%: edge node % (id %) is retired (since %) — it is given no credential, device, run or claim again',
      TG_TABLE_NAME, ncode, NEW."edgeNodeId", retired USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.edge_node_refuse_retired_target() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_edge_node_credentials_retired_ins ON public."edge_node_credentials";
CREATE TRIGGER trg_edge_node_credentials_retired_ins BEFORE INSERT ON public."edge_node_credentials"
  FOR EACH ROW EXECUTE FUNCTION public.edge_node_refuse_retired_target();
-- trigger names sort BEFORE 0374's trg_*_owner_change: the retired refusal is the one reported
DROP TRIGGER IF EXISTS trg_robots_edge_retired_ins ON public."robots";
CREATE TRIGGER trg_robots_edge_retired_ins BEFORE INSERT ON public."robots"
  FOR EACH ROW WHEN (NEW."edgeNodeId" IS NOT NULL) EXECUTE FUNCTION public.edge_node_refuse_retired_target();
DROP TRIGGER IF EXISTS trg_robots_edge_retired_upd ON public."robots";
CREATE TRIGGER trg_robots_edge_retired_upd BEFORE UPDATE OF "edgeNodeId" ON public."robots"
  FOR EACH ROW WHEN (NEW."edgeNodeId" IS NOT NULL AND NEW."edgeNodeId" IS DISTINCT FROM OLD."edgeNodeId") EXECUTE FUNCTION public.edge_node_refuse_retired_target();
DROP TRIGGER IF EXISTS trg_adapters_edge_retired_ins ON public."device_adapters";
CREATE TRIGGER trg_adapters_edge_retired_ins BEFORE INSERT ON public."device_adapters"
  FOR EACH ROW WHEN (NEW."edgeNodeId" IS NOT NULL) EXECUTE FUNCTION public.edge_node_refuse_retired_target();
DROP TRIGGER IF EXISTS trg_adapters_edge_retired_upd ON public."device_adapters";
CREATE TRIGGER trg_adapters_edge_retired_upd BEFORE UPDATE OF "edgeNodeId" ON public."device_adapters"
  FOR EACH ROW WHEN (NEW."edgeNodeId" IS NOT NULL AND NEW."edgeNodeId" IS DISTINCT FROM OLD."edgeNodeId") EXECUTE FUNCTION public.edge_node_refuse_retired_target();
DROP TRIGGER IF EXISTS trg_edge_run_assignment_retired_ins ON public."orchestration_run_edge_assignments";
CREATE TRIGGER trg_edge_run_assignment_retired_ins BEFORE INSERT ON public."orchestration_run_edge_assignments"
  FOR EACH ROW EXECUTE FUNCTION public.edge_node_refuse_retired_target();
DROP TRIGGER IF EXISTS trg_edge_run_assignment_retired_claim ON public."orchestration_run_edge_assignments";
CREATE TRIGGER trg_edge_run_assignment_retired_claim BEFORE UPDATE OF "claimSeq" ON public."orchestration_run_edge_assignments"
  FOR EACH ROW WHEN (NEW."claimSeq" > OLD."claimSeq") EXECUTE FUNCTION public.edge_node_refuse_retired_target();
DROP TRIGGER IF EXISTS trg_orch_runs_edge_retired_ins ON public."orchestration_runs";
CREATE TRIGGER trg_orch_runs_edge_retired_ins BEFORE INSERT ON public."orchestration_runs"
  FOR EACH ROW WHEN (NEW."edgeNodeId" IS NOT NULL) EXECUTE FUNCTION public.edge_node_refuse_retired_target();
DROP TRIGGER IF EXISTS trg_orch_runs_edge_retired_upd ON public."orchestration_runs";
CREATE TRIGGER trg_orch_runs_edge_retired_upd BEFORE UPDATE OF "edgeNodeId" ON public."orchestration_runs"
  FOR EACH ROW WHEN (NEW."edgeNodeId" IS NOT NULL AND NEW."edgeNodeId" IS DISTINCT FROM OLD."edgeNodeId") EXECUTE FUNCTION public.edge_node_refuse_retired_target();
