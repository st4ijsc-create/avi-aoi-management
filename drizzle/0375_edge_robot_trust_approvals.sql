-- ════════════════════════════════════════════════════════════════════════════
-- 0375 — doc 81 Đợt 10 task A (owner decision D6 2026-10-12: edge-ingested robot e-stops are PLAIN by default, TRUSTED only
--        after a MAKER-CHECKER approval per (node, robot)) — design §2.7 / §3; fix scan 2 (R-8-a lessons, R-10-b owner epoch)
-- ════════════════════════════════════════════════════════════════════════════
--
-- • safety_event_trust (0371): the origin CHECK also allows 'edge_robot_telemetry' — the origin central records when it
--   derives an e-stop transition from an edge node's robot states AND edge_robot_trust_is_approved(node, robot, digest) AND the
--   vendor is in TRUSTED_ROBOT_TELEMETRY_VENDORS. The edge itself never names an origin or a trust (strict protocol schemas).
-- • edge_robot_trust_approvals — one row per (node, robot). The Đợt 8 lesson (0368, R-8-a) enforced IN THE DB:
--     – `digest` = what is approved (computed centrally, ONE place, Group B) and `ownerEpoch` = the robot's owner epoch
--       (0374, R-10-b); the approval records approvedDigest + approvedOwnerEpoch and counts ONLY while both still equal the row
--       AND the robot's current (owner, epoch) — edge_robot_trust_is_approved;
--     – "editorsSinceApproval" = EVERY user who requested / edited since the approval in force (the creator included); the
--       approver must be none of them (CHECK + trigger), must be a real user (> 0) and an ACTIVE ADMIN (function);
--     – any edit (digest, owner epoch, editor) CLEARS the approval in the same write (trigger) — an approval never outlives
--       what it approved; an approval is written only onto an unapproved row, bound to the digest the approver SAW;
--     – avi_app has NO write privilege on the table: SELECT only + EXECUTE on the guarded functions
--       edge_robot_trust_request / _approve / _revoke (SECURITY DEFINER, owner aoi) and edge_robot_trust_is_approved;
--     – legacy rows (an approval without approvedDigest) start UNTRUSTED (cleared below).
--
-- ⚠ DDL runs as owner `aoi`: `node scripts/apply-migration-0375.mjs --test-only` (dev: `--dev-only`, the owner decides; no
--   flag ⇒ refused — R-3-g). Requires 0371 + 0374. Idempotent. ⚠ The repo forbids `drizzle-kit push/generate`.
-- ROLLBACK:
--   DROP TABLE IF EXISTS "edge_robot_trust_approvals";
--   DROP FUNCTION IF EXISTS edge_robot_trust_guard(), edge_robot_trust_request(integer, integer, text, integer),
--     edge_robot_trust_approve(integer, integer, text, integer), edge_robot_trust_revoke(integer, integer, integer),
--     edge_robot_trust_is_approved(integer, integer, text);
--   ALTER TABLE "safety_event_trust" DROP CONSTRAINT IF EXISTS "ck_safety_event_trust_origin";
--   ALTER TABLE "safety_event_trust" ADD CONSTRAINT "ck_safety_event_trust_origin" CHECK ("origin" IN ('robot_telemetry', 'safety_plc'));
--
ALTER TABLE "safety_event_trust" DROP CONSTRAINT IF EXISTS "ck_safety_event_trust_origin";
ALTER TABLE "safety_event_trust" ADD CONSTRAINT "ck_safety_event_trust_origin"
  CHECK ("origin" IN ('robot_telemetry', 'safety_plc', 'edge_robot_telemetry'));

CREATE TABLE IF NOT EXISTS "edge_robot_trust_approvals" (
  "edgeNodeId" integer NOT NULL REFERENCES "edge_nodes"("id") ON DELETE CASCADE,
  "robotId" integer NOT NULL REFERENCES "robots"("id") ON DELETE CASCADE,
  "digest" varchar(64) NOT NULL,
  "ownerEpoch" bigint NOT NULL,
  "editedBy" integer NOT NULL,
  "editedAt" timestamptz NOT NULL DEFAULT now(),
  "editorsSinceApproval" integer[] NOT NULL DEFAULT '{}',
  "approvedBy" integer,
  "approvedAt" timestamptz,
  "approvedDigest" varchar(64),
  "approvedOwnerEpoch" bigint,
  PRIMARY KEY ("edgeNodeId", "robotId")
);
-- re-apply on a DB where the table predates fix scan 2 (0375 was applied to _test only)
ALTER TABLE "edge_robot_trust_approvals" ADD COLUMN IF NOT EXISTS "ownerEpoch" bigint NOT NULL DEFAULT 0;
ALTER TABLE "edge_robot_trust_approvals" ALTER COLUMN "ownerEpoch" DROP DEFAULT;
ALTER TABLE "edge_robot_trust_approvals" ADD COLUMN IF NOT EXISTS "editorsSinceApproval" integer[] NOT NULL DEFAULT '{}';
ALTER TABLE "edge_robot_trust_approvals" ADD COLUMN IF NOT EXISTS "approvedDigest" varchar(64);
ALTER TABLE "edge_robot_trust_approvals" ADD COLUMN IF NOT EXISTS "approvedOwnerEpoch" bigint;
ALTER TABLE "edge_robot_trust_approvals" DROP CONSTRAINT IF EXISTS "ck_edge_robot_trust_digest";
ALTER TABLE "edge_robot_trust_approvals" DROP CONSTRAINT IF EXISTS "ck_edge_robot_trust_actors";
ALTER TABLE "edge_robot_trust_approvals" DROP CONSTRAINT IF EXISTS "ck_edge_robot_trust_sod";
ALTER TABLE "edge_robot_trust_approvals" DROP CONSTRAINT IF EXISTS "ck_edge_robot_trust_approved";
ALTER TABLE "edge_robot_trust_approvals" DROP CONSTRAINT IF EXISTS "ck_edge_robot_trust_epoch";
ALTER TABLE "edge_robot_trust_approvals" DROP CONSTRAINT IF EXISTS "ck_edge_robot_trust_editors";
ALTER TABLE "edge_robot_trust_approvals" DROP CONSTRAINT IF EXISTS "ck_edge_robot_trust_binding";
COMMENT ON TABLE "edge_robot_trust_approvals" IS
  'doc 81 Dot 10 A (0375, D6): maker-checker approval that makes edge-ingested robot e-stops of (node, robot) TRUSTED. Bound to digest + owner epoch; approver outside editorsSinceApproval; written only via guarded functions.';

-- the trigger function (applies to every writer, the owner included)
CREATE OR REPLACE FUNCTION edge_robot_trust_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."approvedBy" IS NOT NULL OR NEW."approvedAt" IS NOT NULL OR NEW."approvedDigest" IS NOT NULL OR NEW."approvedOwnerEpoch" IS NOT NULL THEN
      RAISE EXCEPTION 'edge_robot_trust_approvals: a new row is never pre-approved (node %, robot %)', NEW."edgeNodeId", NEW."robotId" USING ERRCODE = 'check_violation';
    END IF;
    IF NOT (NEW."editedBy" = ANY (NEW."editorsSinceApproval")) THEN
      NEW."editorsSinceApproval" := array_append(NEW."editorsSinceApproval", NEW."editedBy");
    END IF;
  ELSE
    IF NEW."edgeNodeId" IS DISTINCT FROM OLD."edgeNodeId" OR NEW."robotId" IS DISTINCT FROM OLD."robotId" THEN
      RAISE EXCEPTION 'edge_robot_trust_approvals: the key is write-once' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."digest" IS DISTINCT FROM OLD."digest" OR NEW."ownerEpoch" IS DISTINCT FROM OLD."ownerEpoch" OR NEW."editedBy" IS DISTINCT FROM OLD."editedBy" THEN
      -- an EDIT: never in the same write as an approval; it clears the approval and joins the editors
      IF NEW."approvedBy" IS NOT NULL AND OLD."approvedBy" IS NULL THEN
        RAISE EXCEPTION 'edge_robot_trust_approvals: an approval cannot be written together with an edit' USING ERRCODE = 'check_violation';
      END IF;
      IF OLD."approvedBy" IS NOT NULL THEN
        NEW."editorsSinceApproval" := ARRAY[NEW."editedBy"];
      ELSIF NOT (NEW."editedBy" = ANY (NEW."editorsSinceApproval")) THEN
        NEW."editorsSinceApproval" := array_append(NEW."editorsSinceApproval", NEW."editedBy");
      END IF;
      NEW."approvedBy" := NULL; NEW."approvedAt" := NULL; NEW."approvedDigest" := NULL; NEW."approvedOwnerEpoch" := NULL;
    ELSIF NEW."editorsSinceApproval" IS DISTINCT FROM OLD."editorsSinceApproval" AND OLD."approvedBy" IS NULL
          AND NOT (OLD."editorsSinceApproval" <@ NEW."editorsSinceApproval") THEN
      RAISE EXCEPTION 'edge_robot_trust_approvals: the editor history only grows until an approval' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."approvedBy" IS NOT NULL AND NEW."approvedBy" IS NOT NULL
       AND (NEW."approvedBy" IS DISTINCT FROM OLD."approvedBy" OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
            OR NEW."approvedDigest" IS DISTINCT FROM OLD."approvedDigest" OR NEW."approvedOwnerEpoch" IS DISTINCT FROM OLD."approvedOwnerEpoch") THEN
      RAISE EXCEPTION 'edge_robot_trust_approvals: an approval is written only onto an unapproved row' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."approvedBy" IS NULL AND NEW."approvedBy" IS NOT NULL THEN
      IF NEW."approvedBy" = ANY (NEW."editorsSinceApproval") OR NEW."approvedBy" = NEW."editedBy" THEN
        RAISE EXCEPTION 'edge_robot_trust_approvals: the approver edited since the last approval (maker-checker)' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW."approvedDigest" IS DISTINCT FROM NEW."digest" OR NEW."approvedOwnerEpoch" IS DISTINCT FROM NEW."ownerEpoch" THEN
        RAISE EXCEPTION 'edge_robot_trust_approvals: an approval is bound to the current digest and owner epoch' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  IF (TG_OP = 'INSERT' OR NEW."approvedBy" IS NOT NULL OR NEW."ownerEpoch" IS DISTINCT FROM OLD."ownerEpoch") AND NOT EXISTS (
       SELECT 1 FROM "robots" r WHERE r."id" = NEW."robotId" AND r."edgeNodeId" = NEW."edgeNodeId" AND r."ownerEpoch" = NEW."ownerEpoch") THEN
    RAISE EXCEPTION 'edge_robot_trust_approvals: robot % is not owned by node % at owner epoch %', NEW."robotId", NEW."edgeNodeId", NEW."ownerEpoch"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_edge_robot_trust_guard ON "edge_robot_trust_approvals";
CREATE TRIGGER trg_edge_robot_trust_guard BEFORE INSERT OR UPDATE ON "edge_robot_trust_approvals"
  FOR EACH ROW EXECUTE FUNCTION edge_robot_trust_guard();

-- legacy rows start UNTRUSTED (an approval recorded before approvedDigest existed binds nothing); editor history seeded
UPDATE "edge_robot_trust_approvals" SET "approvedBy" = NULL, "approvedAt" = NULL, "approvedOwnerEpoch" = NULL
  WHERE "approvedBy" IS NOT NULL AND "approvedDigest" IS NULL;
UPDATE "edge_robot_trust_approvals" SET "editorsSinceApproval" = ARRAY["editedBy"] WHERE cardinality("editorsSinceApproval") = 0;

ALTER TABLE "edge_robot_trust_approvals" ADD CONSTRAINT "ck_edge_robot_trust_digest" CHECK ("digest" ~ '^[0-9a-f]{64}$' AND ("approvedDigest" IS NULL OR "approvedDigest" ~ '^[0-9a-f]{64}$'));
ALTER TABLE "edge_robot_trust_approvals" ADD CONSTRAINT "ck_edge_robot_trust_actors" CHECK ("editedBy" > 0 AND ("approvedBy" IS NULL OR "approvedBy" > 0) AND 0 < ALL ("editorsSinceApproval"));
ALTER TABLE "edge_robot_trust_approvals" ADD CONSTRAINT "ck_edge_robot_trust_sod" CHECK ("approvedBy" IS NULL OR ("approvedBy" <> "editedBy" AND NOT ("approvedBy" = ANY ("editorsSinceApproval"))));
ALTER TABLE "edge_robot_trust_approvals" ADD CONSTRAINT "ck_edge_robot_trust_approved" CHECK (
  ("approvedBy" IS NULL) = ("approvedAt" IS NULL) AND ("approvedBy" IS NULL) = ("approvedDigest" IS NULL) AND ("approvedBy" IS NULL) = ("approvedOwnerEpoch" IS NULL));
ALTER TABLE "edge_robot_trust_approvals" ADD CONSTRAINT "ck_edge_robot_trust_epoch" CHECK ("ownerEpoch" >= 1);
ALTER TABLE "edge_robot_trust_approvals" ADD CONSTRAINT "ck_edge_robot_trust_editors" CHECK ("editedBy" = ANY ("editorsSinceApproval"));
ALTER TABLE "edge_robot_trust_approvals" ADD CONSTRAINT "ck_edge_robot_trust_binding" CHECK (
  "approvedBy" IS NULL OR ("approvedDigest" = "digest" AND "approvedOwnerEpoch" = "ownerEpoch"));

-- ── the guarded path (SECURITY DEFINER, owner aoi) ───────────────────────────────────────────────────────────────
-- request / edit: a real user; the robot must be owned by the node; stamps the CURRENT owner epoch; clears any approval.
CREATE OR REPLACE FUNCTION edge_robot_trust_request(p_node integer, p_robot integer, p_digest text, p_editor integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e bigint;
BEGIN
  IF p_editor IS NULL OR p_editor <= 0 OR NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = p_editor) THEN
    RAISE EXCEPTION 'edge_robot_trust_request: editor % is not a user', p_editor USING ERRCODE = 'check_violation';
  END IF;
  SELECT r."ownerEpoch" INTO e FROM "robots" r WHERE r."id" = p_robot AND r."edgeNodeId" = p_node;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'edge_robot_trust_request: robot % is not owned by node %', p_robot, p_node USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO "edge_robot_trust_approvals" ("edgeNodeId", "robotId", "digest", "ownerEpoch", "editedBy", "editedAt", "editorsSinceApproval")
    VALUES (p_node, p_robot, p_digest, e, p_editor, now(), ARRAY[p_editor])
  ON CONFLICT ("edgeNodeId", "robotId") DO UPDATE SET "digest" = EXCLUDED."digest", "ownerEpoch" = EXCLUDED."ownerEpoch",
    "editedBy" = EXCLUDED."editedBy", "editedAt" = EXCLUDED."editedAt",
    "editorsSinceApproval" = CASE WHEN "edge_robot_trust_approvals"."approvedBy" IS NOT NULL THEN ARRAY[p_editor]
      WHEN p_editor = ANY ("edge_robot_trust_approvals"."editorsSinceApproval") THEN "edge_robot_trust_approvals"."editorsSinceApproval"
      ELSE array_append("edge_robot_trust_approvals"."editorsSinceApproval", p_editor) END,
    "approvedBy" = NULL, "approvedAt" = NULL, "approvedDigest" = NULL, "approvedOwnerEpoch" = NULL;
END $$;

-- approve: an ACTIVE ADMIN who is not among the editors since the last approval; bound to the digest the approver SAW and to
-- the robot's CURRENT owner + epoch; only onto an unapproved row.
CREATE OR REPLACE FUNCTION edge_robot_trust_approve(p_node integer, p_robot integer, p_digest text, p_approver integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  row_ record;
BEGIN
  IF p_approver IS NULL OR p_approver <= 0 OR NOT EXISTS (
       SELECT 1 FROM "users" u WHERE u."id" = p_approver AND u."role"::text = 'admin' AND u."isActive" = true) THEN
    RAISE EXCEPTION 'edge_robot_trust_approve: approver % is not an active admin', p_approver USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO row_ FROM "edge_robot_trust_approvals" a WHERE a."edgeNodeId" = p_node AND a."robotId" = p_robot FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'edge_robot_trust_approve: nothing requested for node %, robot %', p_node, p_robot USING ERRCODE = 'check_violation';
  END IF;
  IF row_."approvedBy" IS NOT NULL THEN
    RAISE EXCEPTION 'edge_robot_trust_approve: already approved (revoke first)' USING ERRCODE = 'check_violation';
  END IF;
  IF row_."digest" IS DISTINCT FROM p_digest THEN
    RAISE EXCEPTION 'edge_robot_trust_approve: the digest changed since it was shown — re-review' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE "edge_robot_trust_approvals" SET "approvedBy" = p_approver, "approvedAt" = now(), "approvedDigest" = row_."digest",
    "approvedOwnerEpoch" = row_."ownerEpoch"
  WHERE "edgeNodeId" = p_node AND "robotId" = p_robot;
END $$;

CREATE OR REPLACE FUNCTION edge_robot_trust_revoke(p_node integer, p_robot integer, p_actor integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_actor IS NULL OR p_actor <= 0 THEN
    RAISE EXCEPTION 'edge_robot_trust_revoke: actor % is not a user', p_actor USING ERRCODE = 'check_violation';
  END IF;
  UPDATE "edge_robot_trust_approvals" SET "approvedBy" = NULL, "approvedAt" = NULL, "approvedDigest" = NULL, "approvedOwnerEpoch" = NULL
  WHERE "edgeNodeId" = p_node AND "robotId" = p_robot;
END $$;

-- THE one predicate central uses: approved, for this digest, for the robot's CURRENT owner and epoch.
CREATE OR REPLACE FUNCTION edge_robot_trust_is_approved(p_node integer, p_robot integer, p_digest text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM "edge_robot_trust_approvals" a JOIN "robots" r ON r."id" = a."robotId"
     WHERE a."edgeNodeId" = p_node AND a."robotId" = p_robot AND a."approvedBy" IS NOT NULL
       AND a."approvedDigest" = p_digest AND a."digest" = p_digest
       AND a."approvedOwnerEpoch" = a."ownerEpoch" AND r."ownerEpoch" = a."ownerEpoch" AND r."edgeNodeId" = p_node)
$$;

REVOKE ALL ON FUNCTION edge_robot_trust_request(integer, integer, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION edge_robot_trust_approve(integer, integer, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION edge_robot_trust_revoke(integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION edge_robot_trust_is_approved(integer, integer, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    -- fix scan 2 (R-8-a): NO direct write — every change goes through the guarded functions
    REVOKE ALL ON "edge_robot_trust_approvals" FROM avi_app;
    GRANT SELECT ON "edge_robot_trust_approvals" TO avi_app;
    GRANT EXECUTE ON FUNCTION edge_robot_trust_request(integer, integer, text, integer) TO avi_app;
    GRANT EXECUTE ON FUNCTION edge_robot_trust_approve(integer, integer, text, integer) TO avi_app;
    GRANT EXECUTE ON FUNCTION edge_robot_trust_revoke(integer, integer, integer) TO avi_app;
    GRANT EXECUTE ON FUNCTION edge_robot_trust_is_approved(integer, integer, text) TO avi_app;
  END IF;
END $$;
