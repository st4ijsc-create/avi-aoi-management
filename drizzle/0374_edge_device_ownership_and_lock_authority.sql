-- ════════════════════════════════════════════════════════════════════════════
-- 0374 — doc 81 Đợt 10 task A (design §2.11 / §2.12 / §3, D2 "one owner"): DEVICE OWNERSHIP + MOTION-LOCK AUTHORITY
-- ════════════════════════════════════════════════════════════════════════════
--
-- • robots."edgeNodeId", device_adapters."edgeNodeId" (nullable, NULL = central; FK edge_nodes ON DELETE RESTRICT): ONE owner
--   decides connect, ingest, control and motion-lock authority. Central's managers skip edge-owned devices; an edge's config
--   holds only its own.
-- • robots."motionLockGenerationFloor" integer DEFAULT 0: never decreases; an OWNER CHANGE raises it to
--   max(floor, the mirrored lock row's generation) + 1, so the new authority starts beyond every generation seen.
-- • OWNER CHANGE (trigger, both tables): refused while the device has an in-flight ledger row (robot_jobs 'running' /
--   command_log 'sent' — the OT intent written before the device write); every change (and an INSERT already owned) is
--   recorded in device_owner_changes (WORM) with the actor from `SET LOCAL avi.actor` (else the DB user). The history row is
--   written by a SECURITY DEFINER function: avi_app has no INSERT on the history, so it cannot be forged directly.
-- • robot_motion_locks."authority" varchar(40) NOT NULL DEFAULT 'central' CHECK ('central' | 'edge:<id>'): the mirror is
--   written only by central; an 'edge:N' row requires robots.edgeNodeId = N at write time (trigger) — an edge can never
--   write (through central) a lock row for a robot it does not own. Existing central writes are unchanged (default
--   'central'; the trigger does not judge 'central' rows).
-- • robot_motion_lock_requests: central → edge lock / clear / stop requests (delivered as signed commands, typ cmd):
--   exactly one target (robot, or adapter for a stop); clear ⇔ expectedGeneration; the target must be OWNED by the node at
--   insert; identity write-once; deliveredAt written once; the ack (ackedAt, outcome, ackGeneration) written once together.
--   NOTE (deviation, reported): `adapterId` is added beside `robotId` so a console STOP of an edge-owned ADAPTER is a request
--   too (design §2.8 `stop {robotId | adapterId}`); the design's §3 table lists robotId only.
-- • edge_node_program_reports (0373): the adapter must be OWNED by the reporting node (trigger).
--
-- avi_app: robot_motion_lock_requests SELECT, INSERT, UPDATE ("deliveredAt", "ackedAt", "ackGeneration", "outcome") + the id
--   sequence; device_owner_changes SELECT only (WORM: UPDATE / DELETE / TRUNCATE refused by trigger for everyone). The new
--   columns on robots / device_adapters / robot_motion_locks follow those tables' existing grants. All are read through the
--   narrow projections in server/services/edge/edgeControlSchema.ts — never added to the full drizzle objects (0368 lesson).
--
-- ⚠ DDL runs as owner `aoi`: `node scripts/apply-migration-0374.mjs --test-only` (dev: `--dev-only`, the owner decides; no
--   flag ⇒ refused — R-3-g). Requires 0372 + 0373. ⚠ The repo forbids `drizzle-kit push/generate`.
-- ROLLBACK:
--   DROP TABLE IF EXISTS "robot_motion_lock_requests"; DROP TABLE IF EXISTS "device_owner_changes";
--   DROP TRIGGER IF EXISTS trg_robots_owner_change ON "robots"; DROP TRIGGER IF EXISTS trg_robots_owner_insert ON "robots";
--   DROP TRIGGER IF EXISTS trg_adapters_owner_change ON "device_adapters"; DROP TRIGGER IF EXISTS trg_adapters_owner_insert ON "device_adapters";
--   DROP TRIGGER IF EXISTS trg_robot_motion_lock_authority ON "robot_motion_locks"; DROP TRIGGER IF EXISTS trg_edge_program_owned ON "edge_node_program_reports";
--   ALTER TABLE "robots" DROP COLUMN IF EXISTS "edgeNodeId", DROP COLUMN IF EXISTS "motionLockGenerationFloor";
--   ALTER TABLE "device_adapters" DROP COLUMN IF EXISTS "edgeNodeId"; ALTER TABLE "robot_motion_locks" DROP COLUMN IF EXISTS "authority";
--   DROP FUNCTION IF EXISTS device_owner_change_guard(), device_owner_insert_log(), robot_motion_lock_authority_guard(),
--     edge_program_report_owned(), robot_motion_lock_request_guard(), device_owner_changes_worm();
--
ALTER TABLE "robots" ADD COLUMN IF NOT EXISTS "edgeNodeId" integer;
ALTER TABLE "robots" ADD COLUMN IF NOT EXISTS "motionLockGenerationFloor" integer NOT NULL DEFAULT 0;
ALTER TABLE "device_adapters" ADD COLUMN IF NOT EXISTS "edgeNodeId" integer;
ALTER TABLE "robot_motion_locks" ADD COLUMN IF NOT EXISTS "authority" varchar(40) NOT NULL DEFAULT 'central';
ALTER TABLE "robots" DROP CONSTRAINT IF EXISTS "fk_robots_edge_node";
ALTER TABLE "robots" ADD CONSTRAINT "fk_robots_edge_node" FOREIGN KEY ("edgeNodeId") REFERENCES "edge_nodes"("id") ON DELETE RESTRICT;
ALTER TABLE "device_adapters" DROP CONSTRAINT IF EXISTS "fk_device_adapters_edge_node";
ALTER TABLE "device_adapters" ADD CONSTRAINT "fk_device_adapters_edge_node" FOREIGN KEY ("edgeNodeId") REFERENCES "edge_nodes"("id") ON DELETE RESTRICT;
ALTER TABLE "robots" DROP CONSTRAINT IF EXISTS "ck_robots_lock_floor";
ALTER TABLE "robots" ADD CONSTRAINT "ck_robots_lock_floor" CHECK ("motionLockGenerationFloor" >= 0);
ALTER TABLE "robot_motion_locks" DROP CONSTRAINT IF EXISTS "ck_robot_motion_locks_authority";
ALTER TABLE "robot_motion_locks" ADD CONSTRAINT "ck_robot_motion_locks_authority" CHECK ("authority" = 'central' OR "authority" ~ '^edge:[1-9][0-9]{0,9}$');
CREATE INDEX IF NOT EXISTS "idx_robots_edge_node" ON "robots" ("edgeNodeId") WHERE "edgeNodeId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_device_adapters_edge_node" ON "device_adapters" ("edgeNodeId") WHERE "edgeNodeId" IS NOT NULL;

-- ── WORM ownership history ──────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "device_owner_changes" (
  "id" bigserial PRIMARY KEY,
  "deviceKind" varchar(8) NOT NULL,
  "deviceId" integer NOT NULL,
  "fromEdgeNodeId" integer,
  "toEdgeNodeId" integer,
  "generationFloor" integer,
  "changedBy" varchar(128) NOT NULL,
  "changedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ck_device_owner_kind" CHECK ("deviceKind" IN ('robot', 'adapter')),
  CONSTRAINT "ck_device_owner_floor" CHECK (("deviceKind" = 'robot') = ("generationFloor" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "idx_device_owner_changes_device" ON "device_owner_changes" ("deviceKind", "deviceId", "changedAt");
COMMENT ON TABLE "device_owner_changes" IS
  'doc 81 Dot 10 A (0374): WORM history of device ownership (robots / device_adapters edgeNodeId). Written only by the owner-change triggers.';

CREATE OR REPLACE FUNCTION device_owner_changes_worm() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'device_owner_changes is append-only (WORM)' USING ERRCODE = 'check_violation';
END $$;
DROP TRIGGER IF EXISTS trg_device_owner_changes_worm ON "device_owner_changes";
CREATE TRIGGER trg_device_owner_changes_worm BEFORE UPDATE OR DELETE ON "device_owner_changes"
  FOR EACH ROW EXECUTE FUNCTION device_owner_changes_worm();
DROP TRIGGER IF EXISTS trg_device_owner_changes_worm_truncate ON "device_owner_changes";
CREATE TRIGGER trg_device_owner_changes_worm_truncate BEFORE TRUNCATE ON "device_owner_changes"
  FOR EACH STATEMENT EXECUTE FUNCTION device_owner_changes_worm();

-- ── owner change: refused while in flight; raises the robot floor; logs (SECURITY DEFINER: avi_app has no INSERT on the log) ──
CREATE OR REPLACE FUNCTION device_owner_change_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor text := COALESCE(NULLIF(current_setting('avi.actor', true), ''), session_user);
  lockgen integer;
BEGIN
  IF TG_TABLE_NAME = 'robots' THEN
    IF NEW."motionLockGenerationFloor" < OLD."motionLockGenerationFloor" THEN
      RAISE EXCEPTION 'robots: motionLockGenerationFloor never decreases (robot %)', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."edgeNodeId" IS DISTINCT FROM OLD."edgeNodeId" THEN
      IF EXISTS (SELECT 1 FROM "robot_jobs" j WHERE j."robotId" = OLD."id" AND j."status" = 'running') THEN
        RAISE EXCEPTION 'robots: robot % has a running job — ownership cannot change now', OLD."id" USING ERRCODE = 'check_violation';
      END IF;
      SELECT l."generation" INTO lockgen FROM "robot_motion_locks" l WHERE l."robotId" = OLD."id";
      NEW."motionLockGenerationFloor" := GREATEST(OLD."motionLockGenerationFloor", NEW."motionLockGenerationFloor", COALESCE(lockgen, 0)) + 1;
      INSERT INTO "device_owner_changes" ("deviceKind", "deviceId", "fromEdgeNodeId", "toEdgeNodeId", "generationFloor", "changedBy")
        VALUES ('robot', OLD."id", OLD."edgeNodeId", NEW."edgeNodeId", NEW."motionLockGenerationFloor", left(actor, 128));
    END IF;
  ELSE
    IF NEW."edgeNodeId" IS DISTINCT FROM OLD."edgeNodeId" THEN
      IF EXISTS (SELECT 1 FROM "command_log" c WHERE c."adapterId" = OLD."id" AND c."status" = 'sent') THEN
        RAISE EXCEPTION 'device_adapters: adapter % has an in-flight command — ownership cannot change now', OLD."id" USING ERRCODE = 'check_violation';
      END IF;
      INSERT INTO "device_owner_changes" ("deviceKind", "deviceId", "fromEdgeNodeId", "toEdgeNodeId", "generationFloor", "changedBy")
        VALUES ('adapter', OLD."id", OLD."edgeNodeId", NEW."edgeNodeId", NULL, left(actor, 128));
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION device_owner_change_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_robots_owner_change ON "robots";
CREATE TRIGGER trg_robots_owner_change BEFORE UPDATE OF "edgeNodeId", "motionLockGenerationFloor" ON "robots"
  FOR EACH ROW EXECUTE FUNCTION device_owner_change_guard();
DROP TRIGGER IF EXISTS trg_adapters_owner_change ON "device_adapters";
CREATE TRIGGER trg_adapters_owner_change BEFORE UPDATE OF "edgeNodeId" ON "device_adapters"
  FOR EACH ROW EXECUTE FUNCTION device_owner_change_guard();

CREATE OR REPLACE FUNCTION device_owner_insert_log() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor text := COALESCE(NULLIF(current_setting('avi.actor', true), ''), session_user);
BEGIN
  INSERT INTO "device_owner_changes" ("deviceKind", "deviceId", "fromEdgeNodeId", "toEdgeNodeId", "generationFloor", "changedBy")
    VALUES (CASE WHEN TG_TABLE_NAME = 'robots' THEN 'robot' ELSE 'adapter' END, NEW."id", NULL, NEW."edgeNodeId",
            CASE WHEN TG_TABLE_NAME = 'robots' THEN (to_jsonb(NEW) ->> 'motionLockGenerationFloor')::integer ELSE NULL END, left(actor, 128));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION device_owner_insert_log() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_robots_owner_insert ON "robots";
CREATE TRIGGER trg_robots_owner_insert AFTER INSERT ON "robots"
  FOR EACH ROW WHEN (NEW."edgeNodeId" IS NOT NULL) EXECUTE FUNCTION device_owner_insert_log();
DROP TRIGGER IF EXISTS trg_adapters_owner_insert ON "device_adapters";
CREATE TRIGGER trg_adapters_owner_insert AFTER INSERT ON "device_adapters"
  FOR EACH ROW WHEN (NEW."edgeNodeId" IS NOT NULL) EXECUTE FUNCTION device_owner_insert_log();

-- ── lock authority: an 'edge:N' mirror row only for a robot node N owns (at write time) ─────────────────────────────
CREATE OR REPLACE FUNCTION robot_motion_lock_authority_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."authority" <> 'central' AND (TG_OP = 'INSERT' OR NEW."authority" IS DISTINCT FROM OLD."authority" OR NEW."generation" IS DISTINCT FROM OLD."generation") AND NOT EXISTS (
       SELECT 1 FROM "robots" r WHERE r."id" = NEW."robotId" AND ('edge:' || r."edgeNodeId") = NEW."authority") THEN
    RAISE EXCEPTION 'robot_motion_locks: authority % does not own robot %', NEW."authority", NEW."robotId" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_robot_motion_lock_authority ON "robot_motion_locks";
CREATE TRIGGER trg_robot_motion_lock_authority BEFORE INSERT OR UPDATE ON "robot_motion_locks"
  FOR EACH ROW EXECUTE FUNCTION robot_motion_lock_authority_guard();

-- ── program reports: only for adapters the node owns ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION edge_program_report_owned() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "device_adapters" a WHERE a."id" = NEW."adapterId" AND a."edgeNodeId" = NEW."edgeNodeId") THEN
    RAISE EXCEPTION 'edge_node_program_reports: adapter % is not owned by node %', NEW."adapterId", NEW."edgeNodeId" USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."edgeNodeId" IS DISTINCT FROM OLD."edgeNodeId" OR NEW."adapterId" IS DISTINCT FROM OLD."adapterId") THEN
    RAISE EXCEPTION 'edge_node_program_reports: the key is write-once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_edge_program_owned ON "edge_node_program_reports";
CREATE TRIGGER trg_edge_program_owned BEFORE INSERT OR UPDATE ON "edge_node_program_reports"
  FOR EACH ROW EXECUTE FUNCTION edge_program_report_owned();

-- ── central → edge lock / clear / stop requests ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "robot_motion_lock_requests" (
  "id" serial PRIMARY KEY,
  "robotId" integer REFERENCES "robots"("id") ON DELETE CASCADE,
  "adapterId" integer REFERENCES "device_adapters"("id") ON DELETE CASCADE,
  "edgeNodeId" integer NOT NULL REFERENCES "edge_nodes"("id") ON DELETE CASCADE,
  "kind" varchar(8) NOT NULL,
  "expectedGeneration" integer,
  "reason" text,
  "requestedBy" integer NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "expiresAt" timestamptz NOT NULL,
  "deliveredAt" timestamptz,
  "ackedAt" timestamptz,
  "ackGeneration" integer,
  "outcome" varchar(16),
  CONSTRAINT "ck_lock_req_kind" CHECK ("kind" IN ('lock', 'clear', 'stop')),
  CONSTRAINT "ck_lock_req_one_target" CHECK (("robotId" IS NULL) <> ("adapterId" IS NULL)),
  CONSTRAINT "ck_lock_req_adapter_stop" CHECK ("adapterId" IS NULL OR "kind" = 'stop'),
  CONSTRAINT "ck_lock_req_clear_gen" CHECK (("kind" = 'clear') = ("expectedGeneration" IS NOT NULL) AND ("expectedGeneration" IS NULL OR "expectedGeneration" >= 1)),
  CONSTRAINT "ck_lock_req_actor" CHECK ("requestedBy" > 0),
  CONSTRAINT "ck_lock_req_expiry" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "ck_lock_req_ack" CHECK (("ackedAt" IS NULL) = ("outcome" IS NULL)),
  CONSTRAINT "ck_lock_req_outcome" CHECK ("outcome" IS NULL OR "outcome" IN ('done', 'refused', 'failed', 'expired'))
);
CREATE INDEX IF NOT EXISTS "idx_lock_req_pending" ON "robot_motion_lock_requests" ("edgeNodeId", "createdAt") WHERE "ackedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_lock_req_robot" ON "robot_motion_lock_requests" ("robotId") WHERE "robotId" IS NOT NULL;
COMMENT ON TABLE "robot_motion_lock_requests" IS
  'doc 81 Dot 10 A (0374): central -> edge lock / clear / stop requests for edge-owned devices; identity write-once, delivered once, acked once.';

CREATE OR REPLACE FUNCTION robot_motion_lock_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."deliveredAt" IS NOT NULL OR NEW."ackedAt" IS NOT NULL OR NEW."outcome" IS NOT NULL OR NEW."ackGeneration" IS NOT NULL THEN
      RAISE EXCEPTION 'robot_motion_lock_requests: a new request is neither delivered nor acked' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."robotId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "robots" r WHERE r."id" = NEW."robotId" AND r."edgeNodeId" = NEW."edgeNodeId") THEN
      RAISE EXCEPTION 'robot_motion_lock_requests: robot % is not owned by node %', NEW."robotId", NEW."edgeNodeId" USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."adapterId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "device_adapters" a WHERE a."id" = NEW."adapterId" AND a."edgeNodeId" = NEW."edgeNodeId") THEN
      RAISE EXCEPTION 'robot_motion_lock_requests: adapter % is not owned by node %', NEW."adapterId", NEW."edgeNodeId" USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."robotId" IS DISTINCT FROM OLD."robotId" OR NEW."adapterId" IS DISTINCT FROM OLD."adapterId"
     OR NEW."edgeNodeId" IS DISTINCT FROM OLD."edgeNodeId" OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."expectedGeneration" IS DISTINCT FROM OLD."expectedGeneration" OR NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."requestedBy" IS DISTINCT FROM OLD."requestedBy" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" THEN
    RAISE EXCEPTION 'robot_motion_lock_requests: identity is write-once (request %)', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."deliveredAt" IS NOT NULL AND NEW."deliveredAt" IS DISTINCT FROM OLD."deliveredAt" THEN
    RAISE EXCEPTION 'robot_motion_lock_requests: deliveredAt is written once (request %)', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."ackedAt" IS NOT NULL AND (NEW."ackedAt" IS DISTINCT FROM OLD."ackedAt" OR NEW."outcome" IS DISTINCT FROM OLD."outcome"
     OR NEW."ackGeneration" IS DISTINCT FROM OLD."ackGeneration") THEN
    RAISE EXCEPTION 'robot_motion_lock_requests: the ack is written once (request %)', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."ackedAt" IS NULL AND NEW."ackedAt" IS NULL AND NEW."ackGeneration" IS DISTINCT FROM OLD."ackGeneration" THEN
    RAISE EXCEPTION 'robot_motion_lock_requests: ackGeneration is written with the ack (request %)', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_robot_motion_lock_request_guard ON "robot_motion_lock_requests";
CREATE TRIGGER trg_robot_motion_lock_request_guard BEFORE INSERT OR UPDATE ON "robot_motion_lock_requests"
  FOR EACH ROW EXECUTE FUNCTION robot_motion_lock_request_guard();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    REVOKE ALL ON "robot_motion_lock_requests" FROM avi_app;
    GRANT SELECT, INSERT ON "robot_motion_lock_requests" TO avi_app;
    GRANT UPDATE ("deliveredAt", "ackedAt", "ackGeneration", "outcome") ON "robot_motion_lock_requests" TO avi_app;
    REVOKE ALL ON SEQUENCE "robot_motion_lock_requests_id_seq" FROM avi_app;
    GRANT USAGE ON SEQUENCE "robot_motion_lock_requests_id_seq" TO avi_app;
    REVOKE ALL ON "device_owner_changes" FROM avi_app;
    GRANT SELECT ON "device_owner_changes" TO avi_app;
    REVOKE ALL ON SEQUENCE "device_owner_changes_id_seq" FROM avi_app;
  END IF;
END $$;
