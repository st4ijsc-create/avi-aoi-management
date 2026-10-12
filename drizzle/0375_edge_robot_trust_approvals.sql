-- ════════════════════════════════════════════════════════════════════════════
-- 0375 — doc 81 Đợt 10 task A (owner decision D6 2026-10-12: edge-ingested robot e-stops are PLAIN by default, TRUSTED only
--        after a MAKER-CHECKER approval per (node, robot)) — design §2.7 / §3
-- ════════════════════════════════════════════════════════════════════════════
--
-- • safety_event_trust (0371): the origin CHECK also allows 'edge_robot_telemetry' — the origin central records when it
--   derives an e-stop transition from an edge node's robot states AND (node, robot) is approved here AND the vendor is in
--   TRUSTED_ROBOT_TELEMETRY_VENDORS. The edge itself never names an origin or a trust (edgeProtocol strict schemas).
-- • edge_robot_trust_approvals — one row per (node, robot): `digest` = what is being approved (computed centrally, ONE place,
--   Group B), `editedBy` = the MAKER (who requested / last changed it), `approvedBy` = the CHECKER (an admin, never the maker:
--   CHECK + trigger). Semantics (0368 pattern):
--     • a new row is never pre-approved (INSERT guard);
--     • changing the digest or the maker CLEARS the approval in the same statement — an edit with approvedBy still set is
--       refused (trigger), so an approval can never outlive what it approved;
--     • an approval is only ever written onto an unapproved row (no silent approver swap); revoking = clearing it;
--     • fix scan 2 (R-10-b) — bound to the robot's OWNER EPOCH (0374): written / approved only while robots.(edgeNodeId,
--       ownerEpoch) = (row node, row ownerEpoch); an ownership change (even away and back to the same node) makes the row
--       stale — central treats it as NOT approved; re-requesting moves it to the current epoch and clears any approval.
--   avi_app: SELECT, INSERT, UPDATE ("digest", "ownerEpoch", "editedBy", "editedAt", "approvedBy", "approvedAt"); no DELETE / TRUNCATE (rows
--   go with their node / robot: ON DELETE CASCADE).
--
-- ⚠ DDL runs as owner `aoi`: `node scripts/apply-migration-0375.mjs --test-only` (dev: `--dev-only`, the owner decides; no
--   flag ⇒ refused — R-3-g). Requires 0371 + 0374. ⚠ The repo forbids `drizzle-kit push/generate`.
-- ROLLBACK:
--   DROP TABLE IF EXISTS "edge_robot_trust_approvals"; DROP FUNCTION IF EXISTS edge_robot_trust_guard();
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
  "approvedBy" integer,
  "approvedAt" timestamptz,
  PRIMARY KEY ("edgeNodeId", "robotId"),
  CONSTRAINT "ck_edge_robot_trust_digest" CHECK ("digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_edge_robot_trust_actors" CHECK ("editedBy" > 0 AND ("approvedBy" IS NULL OR "approvedBy" > 0)),
  CONSTRAINT "ck_edge_robot_trust_sod" CHECK ("approvedBy" IS NULL OR "approvedBy" <> "editedBy"),
  CONSTRAINT "ck_edge_robot_trust_approved" CHECK (("approvedBy" IS NULL) = ("approvedAt" IS NULL))
);
-- fix scan 2 (R-10-b) — re-apply on a DB where the table predates the epoch (0375 was applied to _test only, empty table)
ALTER TABLE "edge_robot_trust_approvals" ADD COLUMN IF NOT EXISTS "ownerEpoch" bigint NOT NULL DEFAULT 0;
ALTER TABLE "edge_robot_trust_approvals" ALTER COLUMN "ownerEpoch" DROP DEFAULT;
ALTER TABLE "edge_robot_trust_approvals" DROP CONSTRAINT IF EXISTS "ck_edge_robot_trust_epoch";
ALTER TABLE "edge_robot_trust_approvals" ADD CONSTRAINT "ck_edge_robot_trust_epoch" CHECK ("ownerEpoch" >= 1);
COMMENT ON TABLE "edge_robot_trust_approvals" IS
  'doc 81 Dot 10 A (0375, D6): maker-checker approval that makes edge-ingested robot e-stops of (node, robot) TRUSTED. approvedBy <> editedBy; an edit clears the approval.';

CREATE OR REPLACE FUNCTION edge_robot_trust_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."approvedBy" IS NOT NULL OR NEW."approvedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'edge_robot_trust_approvals: a new row is never pre-approved (node %, robot %)', NEW."edgeNodeId", NEW."robotId" USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW."edgeNodeId" IS DISTINCT FROM OLD."edgeNodeId" OR NEW."robotId" IS DISTINCT FROM OLD."robotId" THEN
      RAISE EXCEPTION 'edge_robot_trust_approvals: the key is write-once' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW."digest" IS DISTINCT FROM OLD."digest" OR NEW."editedBy" IS DISTINCT FROM OLD."editedBy" OR NEW."ownerEpoch" IS DISTINCT FROM OLD."ownerEpoch")
       AND NEW."approvedBy" IS NOT NULL THEN
      RAISE EXCEPTION 'edge_robot_trust_approvals: an edit clears the approval (node %, robot %)', OLD."edgeNodeId", OLD."robotId" USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."approvedBy" IS NOT NULL AND NEW."approvedBy" IS NOT NULL
       AND (NEW."approvedBy" IS DISTINCT FROM OLD."approvedBy" OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt") THEN
      RAISE EXCEPTION 'edge_robot_trust_approvals: an approval is written only onto an unapproved row (node %, robot %)', OLD."edgeNodeId", OLD."robotId"
        USING ERRCODE = 'check_violation';
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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    REVOKE ALL ON "edge_robot_trust_approvals" FROM avi_app;
    GRANT SELECT, INSERT ON "edge_robot_trust_approvals" TO avi_app;
    GRANT UPDATE ("digest", "ownerEpoch", "editedBy", "editedAt", "approvedBy", "approvedAt") ON "edge_robot_trust_approvals" TO avi_app;
  END IF;
END $$;
