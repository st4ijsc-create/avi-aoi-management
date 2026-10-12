-- ════════════════════════════════════════════════════════════════════════════
-- 0374 — doc 81 Đợt 10 task A (design §2.11 / §2.12 / §3, D2 "one owner"; fix scan 2 ruling R-10-b "owner epoch"):
--        DEVICE OWNERSHIP + OWNER EPOCH + MOTION-LOCK AUTHORITY
-- ════════════════════════════════════════════════════════════════════════════
--
-- • robots."edgeNodeId", device_adapters."edgeNodeId" (nullable, NULL = central; FK edge_nodes ON DELETE RESTRICT): ONE owner
--   decides connect, ingest, control and motion-lock authority. Central's managers skip edge-owned devices; an edge's config
--   holds only its own.
-- • R-10-b — robots."ownerEpoch", device_adapters."ownerEpoch" bigint NOT NULL DEFAULT 1: an IMMUTABLE owner epoch. Every
--   ownership change bumps it by one (trigger); nothing else may change it. Everything that carries authority over a device is
--   bound to (device, owner, ownerEpoch) — never to a node id alone, which an old row could otherwise keep matching (an owner
--   change and back, or a node row re-created under a reused id):
--     – robot_motion_locks gets "authorityNodeId" (FK edge_nodes ON DELETE RESTRICT — a node with a lock row cannot be
--       deleted) and "ownerEpoch"; an 'edge:N' row must name N in authorityNodeId AND carry the robot's CURRENT owner and
--       epoch (trigger, on insert and whenever authority / node / epoch / generation change) — a stale-epoch lock event is
--       refused; a clear deletes WHERE (robotId, authority, ownerEpoch) match, so a stale clear deletes nothing;
--     – an OWNER CHANGE (AFTER trigger) locks the robot at once under the NEW authority and epoch (reasonCode 'ownerChanged',
--       generation = the raised floor), replacing whatever row the previous authority had (design §2.11);
--     – robot_motion_lock_requests carry "ownerEpoch": inserted only for the device's current (owner, epoch), DELIVERED only
--       while that still holds (else 23514 — central expires it);
--     – edge_node_program_reports carry the adapter's "ownerEpoch" (stamped by the trigger at write time);
--     – device_owner_changes records fromOwnerEpoch / toOwnerEpoch.
-- • robots."motionLockGenerationFloor" integer DEFAULT 0: never decreases; an OWNER CHANGE raises it to
--   max(floor, the mirrored lock row's generation) + 1, so the new authority starts beyond every generation seen.
-- • OWNER CHANGE (trigger, both tables): refused while the device has an in-flight ledger row (robot_jobs 'running' /
--   command_log 'sent' — the OT intent written before the device write); every change (and an INSERT already owned) is
--   recorded in device_owner_changes (WORM) with the actor from `SET LOCAL avi.actor` (else the session user). History and
--   the owner-change lock are written by SECURITY DEFINER functions: avi_app has no INSERT on the history.
--   The history has no FK to devices / nodes on purpose: it is a log that outlives them (it grants nothing).
-- • robot_motion_locks."authority" varchar(40) NOT NULL DEFAULT 'central' CHECK ('central' ⇔ authorityNodeId NULL;
--   'edge:<authorityNodeId>' otherwise). Existing central writes are unchanged: a 'central' row gets its ownerEpoch filled from
--   the robot (trigger).
-- • fix scan 2 (safety-lock bypass): avi_app may write a robot_motion_locks row DIRECTLY only while it is a 'central' row of
--   a CENTRAL-owned robot (or an orphan row — the 0364 rule) and stays 'central' (trigger trg_robot_motion_lock_write_guard;
--   central's existing upsert / generation-guarded delete keep working unchanged). An EDGE-authority row is applied / cleared
--   ONLY through the SECURITY DEFINER functions edge_motion_lock_apply / edge_motion_lock_clear (owner aoi): matched on
--   (robot, 'edge:<node>', node, ownerEpoch) and generation-checked (apply ⇔ stored generation ≤ g; clear ⇔ generation ≤ g).
--   avi_app can therefore never delete / rewrite an edge lock, move a row between authorities, or lock / unlock a robot it does
--   not own centrally. The owner-change relock (AFTER UPDATE trigger, SECURITY DEFINER) runs in the SAME statement as the
--   ownership change, so a plain UPDATE of edgeNodeId always leaves the robot locked under the new authority + epoch.
-- • lock requests: deliveredAt / ackedAt are write-once AND monotonic — delivered only before expiry and before the ack, not in
--   the future; acked not before creation / delivery; done / refused / failed only after a delivery; expired only when never
--   delivered or at / after expiry; ackGeneration only with outcome done.
-- • robot_motion_lock_requests: central → edge lock / clear / stop requests (signed commands, typ cmd): exactly one target
--   (robot, or adapter for a stop); clear ⇔ expectedGeneration; identity write-once; deliveredAt written once; the ack
--   (ackedAt, outcome, ackGeneration) written once together.
--   NOTE (deviation, reported): `adapterId` is added beside `robotId` so a console STOP of an edge-owned ADAPTER is a request
--   too (design §2.8 `stop {robotId | adapterId}`); the design's §3 table lists robotId only.
--
-- avi_app: robot_motion_lock_requests SELECT, INSERT, UPDATE ("deliveredAt", "ackedAt", "ackGeneration", "outcome") + the id
--   sequence; device_owner_changes SELECT only (WORM: UPDATE / DELETE / TRUNCATE refused by trigger for everyone). The new
--   columns on robots / device_adapters / robot_motion_locks / edge_node_program_reports follow those tables' grants. All are
--   read through the narrow projections in server/services/edge/edgeControlSchema.ts — never the full drizzle objects.
--
-- fix review 1:
--   • R-10-e (C1/I1 — PROVEN bypass: a session TEMP robot_jobs / robot_motion_locks / device_owner_changes shadowed the real
--     tables inside the SECURITY DEFINER owner-change trigger ⇒ owner change while a job ran, NO relock, NO history): every
--     function pins `search_path = pg_catalog, public, pg_temp` and names every relation `public."…"`; EXECUTE revoked from
--     PUBLIC; only edge_motion_lock_apply / _clear are granted (to avi_app);
--   • M1 (L-7): a STOP request at a stale owner epoch stays deliverable to its node, and an unacknowledged STOP of the previous
--     ownership is carried to a new edge owner (device_owner_stop_carry); lock / clear at a stale epoch are still refused;
--   • M2: edge_motion_lock_apply / _clear refuse a generation below robots."motionLockGenerationFloor".
--
-- ⚠ DDL runs as owner `aoi`: `node scripts/apply-migration-0374.mjs --test-only` (dev: `--dev-only`, the owner decides; no
--   flag ⇒ refused — R-3-g). Requires 0372 + 0373. Idempotent. ⚠ The repo forbids `drizzle-kit push/generate`.
-- ROLLBACK:
--   DROP TABLE IF EXISTS "robot_motion_lock_requests"; DROP TABLE IF EXISTS "device_owner_changes";
--   DROP TRIGGER IF EXISTS trg_robots_owner_change ON "robots"; DROP TRIGGER IF EXISTS trg_robots_owner_insert ON "robots";
--   DROP TRIGGER IF EXISTS trg_robots_owner_relock ON "robots"; DROP TRIGGER IF EXISTS trg_robots_owner_stop_carry ON "robots";
--   DROP TRIGGER IF EXISTS trg_adapters_owner_stop_carry ON "device_adapters";
--   DROP TRIGGER IF EXISTS trg_adapters_owner_change ON "device_adapters"; DROP TRIGGER IF EXISTS trg_adapters_owner_insert ON "device_adapters";
--   DROP TRIGGER IF EXISTS trg_robot_motion_lock_authority ON "robot_motion_locks"; DROP TRIGGER IF EXISTS trg_robot_motion_lock_write_guard ON "robot_motion_locks";
--   DROP FUNCTION IF EXISTS edge_motion_lock_apply(integer, integer, bigint, integer, text, text), edge_motion_lock_clear(integer, integer, bigint, integer), robot_motion_lock_write_guard(); DROP TRIGGER IF EXISTS trg_edge_program_owned ON "edge_node_program_reports";
--   ALTER TABLE "robots" DROP COLUMN IF EXISTS "edgeNodeId", DROP COLUMN IF EXISTS "motionLockGenerationFloor", DROP COLUMN IF EXISTS "ownerEpoch";
--   ALTER TABLE "device_adapters" DROP COLUMN IF EXISTS "edgeNodeId", DROP COLUMN IF EXISTS "ownerEpoch";
--   ALTER TABLE "robot_motion_locks" DROP COLUMN IF EXISTS "authority", DROP COLUMN IF EXISTS "authorityNodeId", DROP COLUMN IF EXISTS "ownerEpoch";
--   ALTER TABLE "edge_node_program_reports" DROP COLUMN IF EXISTS "ownerEpoch";
--   DROP FUNCTION IF EXISTS device_owner_change_guard(), device_owner_insert_log(), robot_owner_relock(), robot_motion_lock_authority_guard(),
--     edge_program_report_owned(), robot_motion_lock_request_guard(), device_owner_changes_worm(), device_owner_stop_carry();
--
ALTER TABLE "robots" ADD COLUMN IF NOT EXISTS "edgeNodeId" integer;
ALTER TABLE "robots" ADD COLUMN IF NOT EXISTS "motionLockGenerationFloor" integer NOT NULL DEFAULT 0;
ALTER TABLE "robots" ADD COLUMN IF NOT EXISTS "ownerEpoch" bigint NOT NULL DEFAULT 1;
ALTER TABLE "device_adapters" ADD COLUMN IF NOT EXISTS "edgeNodeId" integer;
ALTER TABLE "device_adapters" ADD COLUMN IF NOT EXISTS "ownerEpoch" bigint NOT NULL DEFAULT 1;
ALTER TABLE "robot_motion_locks" ADD COLUMN IF NOT EXISTS "authority" varchar(40) NOT NULL DEFAULT 'central';
ALTER TABLE "robot_motion_locks" ADD COLUMN IF NOT EXISTS "authorityNodeId" integer;
ALTER TABLE "robot_motion_locks" ADD COLUMN IF NOT EXISTS "ownerEpoch" bigint;
ALTER TABLE "edge_node_program_reports" ADD COLUMN IF NOT EXISTS "ownerEpoch" bigint;
ALTER TABLE "robots" DROP CONSTRAINT IF EXISTS "fk_robots_edge_node";
ALTER TABLE "robots" ADD CONSTRAINT "fk_robots_edge_node" FOREIGN KEY ("edgeNodeId") REFERENCES "edge_nodes"("id") ON DELETE RESTRICT;
ALTER TABLE "device_adapters" DROP CONSTRAINT IF EXISTS "fk_device_adapters_edge_node";
ALTER TABLE "device_adapters" ADD CONSTRAINT "fk_device_adapters_edge_node" FOREIGN KEY ("edgeNodeId") REFERENCES "edge_nodes"("id") ON DELETE RESTRICT;
ALTER TABLE "robot_motion_locks" DROP CONSTRAINT IF EXISTS "fk_robot_motion_locks_authority_node";
ALTER TABLE "robot_motion_locks" ADD CONSTRAINT "fk_robot_motion_locks_authority_node" FOREIGN KEY ("authorityNodeId") REFERENCES "edge_nodes"("id") ON DELETE RESTRICT;
ALTER TABLE "robots" DROP CONSTRAINT IF EXISTS "ck_robots_lock_floor";
ALTER TABLE "robots" ADD CONSTRAINT "ck_robots_lock_floor" CHECK ("motionLockGenerationFloor" >= 0);
ALTER TABLE "robots" DROP CONSTRAINT IF EXISTS "ck_robots_owner_epoch";
ALTER TABLE "robots" ADD CONSTRAINT "ck_robots_owner_epoch" CHECK ("ownerEpoch" >= 1);
ALTER TABLE "device_adapters" DROP CONSTRAINT IF EXISTS "ck_device_adapters_owner_epoch";
ALTER TABLE "device_adapters" ADD CONSTRAINT "ck_device_adapters_owner_epoch" CHECK ("ownerEpoch" >= 1);
ALTER TABLE "robot_motion_locks" DROP CONSTRAINT IF EXISTS "ck_robot_motion_locks_authority";
ALTER TABLE "robot_motion_locks" ADD CONSTRAINT "ck_robot_motion_locks_authority" CHECK (
  ("authority" = 'central' AND "authorityNodeId" IS NULL)
  OR ("authorityNodeId" IS NOT NULL AND "authority" = 'edge:' || "authorityNodeId"));
CREATE INDEX IF NOT EXISTS "idx_robots_edge_node" ON "robots" ("edgeNodeId") WHERE "edgeNodeId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_device_adapters_edge_node" ON "device_adapters" ("edgeNodeId") WHERE "edgeNodeId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_robot_motion_locks_authority_node" ON "robot_motion_locks" ("authorityNodeId") WHERE "authorityNodeId" IS NOT NULL;

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
ALTER TABLE "device_owner_changes" ADD COLUMN IF NOT EXISTS "fromOwnerEpoch" bigint;
ALTER TABLE "device_owner_changes" ADD COLUMN IF NOT EXISTS "toOwnerEpoch" bigint;
CREATE INDEX IF NOT EXISTS "idx_device_owner_changes_device" ON "device_owner_changes" ("deviceKind", "deviceId", "changedAt");
COMMENT ON TABLE "device_owner_changes" IS
  'doc 81 Dot 10 A (0374): WORM history of device ownership (robots / device_adapters edgeNodeId + ownerEpoch). Written only by the owner-change triggers.';

CREATE OR REPLACE FUNCTION public.device_owner_changes_worm() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'device_owner_changes is append-only (WORM)' USING ERRCODE = 'check_violation';
END $$;
DROP TRIGGER IF EXISTS trg_device_owner_changes_worm ON "device_owner_changes";
CREATE TRIGGER trg_device_owner_changes_worm BEFORE UPDATE OR DELETE ON "device_owner_changes"
  FOR EACH ROW EXECUTE FUNCTION public.device_owner_changes_worm();
DROP TRIGGER IF EXISTS trg_device_owner_changes_worm_truncate ON "device_owner_changes";
CREATE TRIGGER trg_device_owner_changes_worm_truncate BEFORE TRUNCATE ON "device_owner_changes"
  FOR EACH STATEMENT EXECUTE FUNCTION public.device_owner_changes_worm();
REVOKE ALL ON FUNCTION public.device_owner_changes_worm() FROM PUBLIC;

-- ── owner change: refused while in flight; bumps the epoch; raises the robot floor; logs (SECURITY DEFINER) ─────────
CREATE OR REPLACE FUNCTION public.device_owner_change_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  actor text := COALESCE(NULLIF(current_setting('avi.actor', true), ''), session_user);
  lockgen integer;
BEGIN
  IF NEW."edgeNodeId" IS NOT DISTINCT FROM OLD."edgeNodeId" AND NEW."ownerEpoch" IS DISTINCT FROM OLD."ownerEpoch" THEN
    RAISE EXCEPTION '%: ownerEpoch changes only with the owner (device %)', TG_TABLE_NAME, OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'robots' THEN
    IF NEW."motionLockGenerationFloor" < OLD."motionLockGenerationFloor" THEN
      RAISE EXCEPTION 'robots: motionLockGenerationFloor never decreases (robot %)', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."edgeNodeId" IS DISTINCT FROM OLD."edgeNodeId" THEN
      IF EXISTS (SELECT 1 FROM public."robot_jobs" j WHERE j."robotId" = OLD."id" AND j."status" = 'running') THEN
        RAISE EXCEPTION 'robots: robot % has a running job — ownership cannot change now', OLD."id" USING ERRCODE = 'check_violation';
      END IF;
      NEW."ownerEpoch" := OLD."ownerEpoch" + 1;
      SELECT l."generation" INTO lockgen FROM public."robot_motion_locks" l WHERE l."robotId" = OLD."id";
      NEW."motionLockGenerationFloor" := GREATEST(OLD."motionLockGenerationFloor", NEW."motionLockGenerationFloor", COALESCE(lockgen, 0)) + 1;
      INSERT INTO public."device_owner_changes" ("deviceKind", "deviceId", "fromEdgeNodeId", "toEdgeNodeId", "generationFloor", "fromOwnerEpoch", "toOwnerEpoch", "changedBy")
        VALUES ('robot', OLD."id", OLD."edgeNodeId", NEW."edgeNodeId", NEW."motionLockGenerationFloor", OLD."ownerEpoch", NEW."ownerEpoch", left(actor, 128));
    END IF;
  ELSE
    IF NEW."edgeNodeId" IS DISTINCT FROM OLD."edgeNodeId" THEN
      IF EXISTS (SELECT 1 FROM public."command_log" c WHERE c."adapterId" = OLD."id" AND c."status" = 'sent') THEN
        RAISE EXCEPTION 'device_adapters: adapter % has an in-flight command — ownership cannot change now', OLD."id" USING ERRCODE = 'check_violation';
      END IF;
      NEW."ownerEpoch" := OLD."ownerEpoch" + 1;
      INSERT INTO public."device_owner_changes" ("deviceKind", "deviceId", "fromEdgeNodeId", "toEdgeNodeId", "generationFloor", "fromOwnerEpoch", "toOwnerEpoch", "changedBy")
        VALUES ('adapter', OLD."id", OLD."edgeNodeId", NEW."edgeNodeId", NULL, OLD."ownerEpoch", NEW."ownerEpoch", left(actor, 128));
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.device_owner_change_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_robots_owner_change ON "robots";
CREATE TRIGGER trg_robots_owner_change BEFORE UPDATE OF "edgeNodeId", "motionLockGenerationFloor", "ownerEpoch" ON "robots"
  FOR EACH ROW EXECUTE FUNCTION public.device_owner_change_guard();
DROP TRIGGER IF EXISTS trg_adapters_owner_change ON "device_adapters";
CREATE TRIGGER trg_adapters_owner_change BEFORE UPDATE OF "edgeNodeId", "ownerEpoch" ON "device_adapters"
  FOR EACH ROW EXECUTE FUNCTION public.device_owner_change_guard();

-- the robot is LOCKED under the new authority + epoch at once (design §2.11): replaces the previous authority's row
CREATE OR REPLACE FUNCTION public.robot_owner_relock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  INSERT INTO public."robot_motion_locks" ("robotId", "reasonCode", "detail", "generation", "authority", "authorityNodeId", "ownerEpoch", "lockedAt")
    VALUES (NEW."id", 'ownerChanged', 'ownership changed (owner epoch ' || NEW."ownerEpoch" || ') — locked until a confirmed STOP',
            NEW."motionLockGenerationFloor", CASE WHEN NEW."edgeNodeId" IS NULL THEN 'central' ELSE 'edge:' || NEW."edgeNodeId" END,
            NEW."edgeNodeId", NEW."ownerEpoch", now())
  ON CONFLICT ("robotId") DO UPDATE SET "reasonCode" = EXCLUDED."reasonCode", "detail" = EXCLUDED."detail", "generation" = EXCLUDED."generation",
    "authority" = EXCLUDED."authority", "authorityNodeId" = EXCLUDED."authorityNodeId", "ownerEpoch" = EXCLUDED."ownerEpoch", "lockedAt" = EXCLUDED."lockedAt";
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.robot_owner_relock() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_robots_owner_relock ON "robots";
CREATE TRIGGER trg_robots_owner_relock AFTER UPDATE OF "edgeNodeId" ON "robots"
  FOR EACH ROW WHEN (OLD."edgeNodeId" IS DISTINCT FROM NEW."edgeNodeId") EXECUTE FUNCTION public.robot_owner_relock();

CREATE OR REPLACE FUNCTION public.device_owner_insert_log() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  actor text := COALESCE(NULLIF(current_setting('avi.actor', true), ''), session_user);
BEGIN
  INSERT INTO public."device_owner_changes" ("deviceKind", "deviceId", "fromEdgeNodeId", "toEdgeNodeId", "generationFloor", "fromOwnerEpoch", "toOwnerEpoch", "changedBy")
    VALUES (CASE WHEN TG_TABLE_NAME = 'robots' THEN 'robot' ELSE 'adapter' END, NEW."id", NULL, NEW."edgeNodeId",
            CASE WHEN TG_TABLE_NAME = 'robots' THEN (to_jsonb(NEW) ->> 'motionLockGenerationFloor')::integer ELSE NULL END,
            NULL, NEW."ownerEpoch", left(actor, 128));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.device_owner_insert_log() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_robots_owner_insert ON "robots";
CREATE TRIGGER trg_robots_owner_insert AFTER INSERT ON "robots"
  FOR EACH ROW WHEN (NEW."edgeNodeId" IS NOT NULL) EXECUTE FUNCTION public.device_owner_insert_log();
DROP TRIGGER IF EXISTS trg_adapters_owner_insert ON "device_adapters";
CREATE TRIGGER trg_adapters_owner_insert AFTER INSERT ON "device_adapters"
  FOR EACH ROW WHEN (NEW."edgeNodeId" IS NOT NULL) EXECUTE FUNCTION public.device_owner_insert_log();

-- ── lock authority bound to (robot, owner, ownerEpoch) ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.robot_motion_lock_authority_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  r record;
BEGIN
  SELECT x."edgeNodeId", x."ownerEpoch" INTO r FROM public."robots" x WHERE x."id" = NEW."robotId";
  IF NEW."authority" = 'central' THEN
    -- a central row (existing central code never names an epoch): stamp the robot's current epoch
    IF NEW."ownerEpoch" IS NULL AND FOUND THEN NEW."ownerEpoch" := r."ownerEpoch"; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' OR NEW."authority" IS DISTINCT FROM OLD."authority" OR NEW."authorityNodeId" IS DISTINCT FROM OLD."authorityNodeId"
     OR NEW."ownerEpoch" IS DISTINCT FROM OLD."ownerEpoch" OR NEW."generation" IS DISTINCT FROM OLD."generation" THEN
    IF NOT FOUND OR r."edgeNodeId" IS DISTINCT FROM NEW."authorityNodeId" OR NEW."ownerEpoch" IS DISTINCT FROM r."ownerEpoch" THEN
      RAISE EXCEPTION 'robot_motion_locks: % (owner epoch %) is not the current owner of robot %', NEW."authority", NEW."ownerEpoch", NEW."robotId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_robot_motion_lock_authority ON "robot_motion_locks";
CREATE TRIGGER trg_robot_motion_lock_authority BEFORE INSERT OR UPDATE ON "robot_motion_locks"
  FOR EACH ROW EXECUTE FUNCTION public.robot_motion_lock_authority_guard();
REVOKE ALL ON FUNCTION public.robot_motion_lock_authority_guard() FROM PUBLIC;

-- ── program reports: only for adapters the node owns; stamped with the adapter's owner epoch ───────────────────────
CREATE OR REPLACE FUNCTION public.edge_program_report_owned() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  e bigint;
BEGIN
  SELECT a."ownerEpoch" INTO e FROM public."device_adapters" a WHERE a."id" = NEW."adapterId" AND a."edgeNodeId" = NEW."edgeNodeId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'edge_node_program_reports: adapter % is not owned by node %', NEW."adapterId", NEW."edgeNodeId" USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."edgeNodeId" IS DISTINCT FROM OLD."edgeNodeId" OR NEW."adapterId" IS DISTINCT FROM OLD."adapterId") THEN
    RAISE EXCEPTION 'edge_node_program_reports: the key is write-once' USING ERRCODE = 'check_violation';
  END IF;
  NEW."ownerEpoch" := e;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_edge_program_owned ON "edge_node_program_reports";
CREATE TRIGGER trg_edge_program_owned BEFORE INSERT OR UPDATE ON "edge_node_program_reports"
  FOR EACH ROW EXECUTE FUNCTION public.edge_program_report_owned();
REVOKE ALL ON FUNCTION public.edge_program_report_owned() FROM PUBLIC;

-- ── central → edge lock / clear / stop requests, bound to (device, owner, ownerEpoch) ──────────────────────────────
CREATE TABLE IF NOT EXISTS "robot_motion_lock_requests" (
  "id" serial PRIMARY KEY,
  "robotId" integer REFERENCES "robots"("id") ON DELETE CASCADE,
  "adapterId" integer REFERENCES "device_adapters"("id") ON DELETE CASCADE,
  "edgeNodeId" integer NOT NULL REFERENCES "edge_nodes"("id") ON DELETE CASCADE,
  "ownerEpoch" bigint NOT NULL,
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
-- fix scan 2 (R-10-b) — re-apply on a DB where the table predates the epoch (0374 was applied to _test only, empty table)
ALTER TABLE "robot_motion_lock_requests" ADD COLUMN IF NOT EXISTS "ownerEpoch" bigint NOT NULL DEFAULT 0;
ALTER TABLE "robot_motion_lock_requests" ALTER COLUMN "ownerEpoch" DROP DEFAULT;
ALTER TABLE "robot_motion_lock_requests" DROP CONSTRAINT IF EXISTS "ck_lock_req_epoch";
ALTER TABLE "robot_motion_lock_requests" ADD CONSTRAINT "ck_lock_req_epoch" CHECK ("ownerEpoch" >= 1);
CREATE INDEX IF NOT EXISTS "idx_lock_req_pending" ON "robot_motion_lock_requests" ("edgeNodeId", "createdAt") WHERE "ackedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_lock_req_robot" ON "robot_motion_lock_requests" ("robotId") WHERE "robotId" IS NOT NULL;
COMMENT ON TABLE "robot_motion_lock_requests" IS
  'doc 81 Dot 10 A (0374): central -> edge lock / clear / stop requests for edge-owned devices, bound to (device, owner, ownerEpoch); identity write-once, delivered once (only while the epoch holds), acked once.';

CREATE OR REPLACE FUNCTION public.robot_motion_lock_request_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  cur_owner integer;
  cur_epoch bigint;
BEGIN
  IF NEW."robotId" IS NOT NULL THEN
    SELECT r."edgeNodeId", r."ownerEpoch" INTO cur_owner, cur_epoch FROM public."robots" r WHERE r."id" = NEW."robotId";
  ELSE
    SELECT a."edgeNodeId", a."ownerEpoch" INTO cur_owner, cur_epoch FROM public."device_adapters" a WHERE a."id" = NEW."adapterId";
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."deliveredAt" IS NOT NULL OR NEW."ackedAt" IS NOT NULL OR NEW."outcome" IS NOT NULL OR NEW."ackGeneration" IS NOT NULL THEN
      RAISE EXCEPTION 'robot_motion_lock_requests: a new request is neither delivered nor acked' USING ERRCODE = 'check_violation';
    END IF;
    IF cur_owner IS DISTINCT FROM NEW."edgeNodeId" OR cur_epoch IS DISTINCT FROM NEW."ownerEpoch" THEN
      RAISE EXCEPTION 'robot_motion_lock_requests: the device is not owned by node % at owner epoch %', NEW."edgeNodeId", NEW."ownerEpoch"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."robotId" IS DISTINCT FROM OLD."robotId" OR NEW."adapterId" IS DISTINCT FROM OLD."adapterId"
     OR NEW."edgeNodeId" IS DISTINCT FROM OLD."edgeNodeId" OR NEW."ownerEpoch" IS DISTINCT FROM OLD."ownerEpoch" OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."expectedGeneration" IS DISTINCT FROM OLD."expectedGeneration" OR NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."requestedBy" IS DISTINCT FROM OLD."requestedBy" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" THEN
    RAISE EXCEPTION 'robot_motion_lock_requests: identity is write-once (request %)', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."deliveredAt" IS NOT NULL AND NEW."deliveredAt" IS DISTINCT FROM OLD."deliveredAt" THEN
    RAISE EXCEPTION 'robot_motion_lock_requests: deliveredAt is written once (request %)', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  -- fix review 1 (M1, L-7): a STOP is never dropped — a STOP for the OLD owner stays DELIVERABLE to that node (it may still
  -- hold the device session until it applies the new config; a STOP is never harmful) and is carried to a new edge owner by
  -- public.device_owner_stop_carry(); lock / clear at a stale epoch are refused (expire them).
  IF OLD."deliveredAt" IS NULL AND NEW."deliveredAt" IS NOT NULL AND OLD."kind" <> 'stop'
     AND (cur_owner IS DISTINCT FROM OLD."edgeNodeId" OR cur_epoch IS DISTINCT FROM OLD."ownerEpoch") THEN
    RAISE EXCEPTION 'robot_motion_lock_requests: request % is stale (owner / owner epoch changed) — expire it, never deliver it', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."ackedAt" IS NOT NULL AND (NEW."ackedAt" IS DISTINCT FROM OLD."ackedAt" OR NEW."outcome" IS DISTINCT FROM OLD."outcome"
     OR NEW."ackGeneration" IS DISTINCT FROM OLD."ackGeneration" OR NEW."deliveredAt" IS DISTINCT FROM OLD."deliveredAt") THEN
    RAISE EXCEPTION 'robot_motion_lock_requests: the ack is written once (request %)', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  -- fix scan 2 — monotonic: delivery before expiry, never in the future
  IF OLD."deliveredAt" IS NULL AND NEW."deliveredAt" IS NOT NULL
     AND (NEW."deliveredAt" < OLD."createdAt" OR NEW."deliveredAt" > OLD."expiresAt" OR NEW."deliveredAt" > now() + interval '5 seconds') THEN
    RAISE EXCEPTION 'robot_motion_lock_requests: delivery time of request % out of order', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  -- fix scan 2 — monotonic ack: not before creation / delivery, never in the future; outcomes need the matching history
  IF OLD."ackedAt" IS NULL AND NEW."ackedAt" IS NOT NULL THEN
    IF NEW."ackedAt" < OLD."createdAt" OR NEW."ackedAt" > now() + interval '5 seconds'
       OR (NEW."deliveredAt" IS NOT NULL AND NEW."ackedAt" < NEW."deliveredAt") THEN
      RAISE EXCEPTION 'robot_motion_lock_requests: ack time of request % out of order', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."outcome" IN ('done', 'refused', 'failed') AND NEW."deliveredAt" IS NULL THEN
      RAISE EXCEPTION 'robot_motion_lock_requests: request % was never delivered — only expired', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."outcome" = 'expired' AND NEW."deliveredAt" IS NOT NULL AND NEW."ackedAt" < OLD."expiresAt" THEN
      RAISE EXCEPTION 'robot_motion_lock_requests: delivered request % expires only at / after its expiry', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."ackGeneration" IS NOT NULL AND NEW."outcome" <> 'done' THEN
      RAISE EXCEPTION 'robot_motion_lock_requests: ackGeneration only with outcome done (request %)', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF OLD."ackedAt" IS NULL AND NEW."ackedAt" IS NULL AND NEW."ackGeneration" IS DISTINCT FROM OLD."ackGeneration" THEN
    RAISE EXCEPTION 'robot_motion_lock_requests: ackGeneration is written with the ack (request %)', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_robot_motion_lock_request_guard ON "robot_motion_lock_requests";
CREATE TRIGGER trg_robot_motion_lock_request_guard BEFORE INSERT OR UPDATE ON "robot_motion_lock_requests"
  FOR EACH ROW EXECUTE FUNCTION public.robot_motion_lock_request_guard();
REVOKE ALL ON FUNCTION public.robot_motion_lock_request_guard() FROM PUBLIC;

-- fix review 1 (M1, L-7 — a STOP is never dropped): when a device changes owner, every STOP request of the PREVIOUS ownership
-- (ownerEpoch = OLD epoch) that nobody acknowledged is CARRIED to a new EDGE owner as a new request at the new epoch (same
-- requester; reason names the original). The original stays visible and stays deliverable to the old node (request guard). A
-- device moved to CENTRAL keeps its pending STOP visible in this table (central holds the session and stops it directly).
-- Fail-safe direction only: more STOPs, never fewer. SECURITY DEFINER (avi_app cannot forge carried rows).
CREATE OR REPLACE FUNCTION public.device_owner_stop_carry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW."edgeNodeId" IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public."robot_motion_lock_requests" ("robotId", "adapterId", "edgeNodeId", "ownerEpoch", "kind", "reason", "requestedBy", "createdAt", "expiresAt")
  SELECT q."robotId", q."adapterId", NEW."edgeNodeId", NEW."ownerEpoch", 'stop',
         'carried from request #' || q."id" || ' (owner change, epoch ' || OLD."ownerEpoch" || ' -> ' || NEW."ownerEpoch" || ')'
           || COALESCE(': ' || q."reason", ''),
         q."requestedBy", now(), now() + GREATEST(q."expiresAt" - q."createdAt", interval '60 seconds')
    FROM public."robot_motion_lock_requests" q
   WHERE q."kind" = 'stop' AND q."ackedAt" IS NULL AND q."ownerEpoch" = OLD."ownerEpoch"
     AND (CASE WHEN TG_TABLE_NAME = 'robots' THEN q."robotId" = NEW."id" ELSE q."adapterId" = NEW."id" END)
   ORDER BY q."id";
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.device_owner_stop_carry() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_robots_owner_stop_carry ON "robots";
CREATE TRIGGER trg_robots_owner_stop_carry AFTER UPDATE OF "edgeNodeId" ON "robots"
  FOR EACH ROW WHEN (OLD."edgeNodeId" IS DISTINCT FROM NEW."edgeNodeId") EXECUTE FUNCTION public.device_owner_stop_carry();
DROP TRIGGER IF EXISTS trg_adapters_owner_stop_carry ON "device_adapters";
CREATE TRIGGER trg_adapters_owner_stop_carry AFTER UPDATE OF "edgeNodeId" ON "device_adapters"
  FOR EACH ROW WHEN (OLD."edgeNodeId" IS DISTINCT FROM NEW."edgeNodeId") EXECUTE FUNCTION public.device_owner_stop_carry();

-- ── fix scan 2 (safety-lock bypass): direct writes only for central rows of central robots; edge rows via the guarded path ──
CREATE OR REPLACE FUNCTION public.robot_motion_lock_write_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  tbl_owner name;
  rid integer := COALESCE(NEW."robotId", OLD."robotId");
  edge_owned boolean;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(c.relowner) INTO tbl_owner FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID;
  IF current_user = tbl_owner THEN
    RETURN COALESCE(NEW, OLD); -- the owner: the migration, or the SECURITY DEFINER guarded path / owner-change relock
  END IF;
  edge_owned := EXISTS (SELECT 1 FROM public."robots" r WHERE r."id" = rid AND r."edgeNodeId" IS NOT NULL);
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD."authority" <> 'central' THEN
    RAISE EXCEPTION 'robot_motion_locks: the % lock of robot % is applied / cleared only via edge_motion_lock_apply / _clear', OLD."authority", rid
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (NEW."authority" <> 'central' OR NEW."authorityNodeId" IS NOT NULL) THEN
    RAISE EXCEPTION 'robot_motion_locks: an edge-authority lock of robot % is written only via edge_motion_lock_apply', rid USING ERRCODE = 'check_violation';
  END IF;
  IF edge_owned THEN
    RAISE EXCEPTION 'robot_motion_locks: robot % is edge-owned — central does not lock / unlock it directly', rid USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."ownerEpoch" IS NOT NULL AND NEW."ownerEpoch" IS DISTINCT FROM OLD."ownerEpoch" THEN
    RAISE EXCEPTION 'robot_motion_locks: the owner epoch of a lock row is not rewritten (robot %)', rid USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_robot_motion_lock_write_guard ON "robot_motion_locks";
CREATE TRIGGER trg_robot_motion_lock_write_guard BEFORE INSERT OR UPDATE OR DELETE ON "robot_motion_locks"
  FOR EACH ROW EXECUTE FUNCTION public.robot_motion_lock_write_guard();
REVOKE ALL ON FUNCTION public.robot_motion_lock_write_guard() FROM PUBLIC;

-- an edge lock event `locked` (design §2.11): upsert under (robot, 'edge:<node>', ownerEpoch) where the stored generation ≤ g.
-- Returns true when applied, false when a newer / other-authority row stands; a stale (node, epoch) raises 23514 (authority guard).
-- fix review 1 (M2): a generation BELOW the robot's motionLockGenerationFloor is from before the last ownership change ⇒ false.
CREATE OR REPLACE FUNCTION public.edge_motion_lock_apply(p_robot integer, p_node integer, p_epoch bigint, p_generation integer, p_reason text, p_detail text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  done_ boolean;
  floor_ integer;
BEGIN
  SELECT r."motionLockGenerationFloor" INTO floor_ FROM public."robots" r WHERE r."id" = p_robot;
  IF floor_ IS NULL OR p_generation IS NULL OR p_generation < floor_ THEN
    RETURN false;
  END IF;
  INSERT INTO public."robot_motion_locks" AS l ("robotId", "reasonCode", "detail", "generation", "authority", "authorityNodeId", "ownerEpoch", "lockedAt")
    VALUES (p_robot, left(p_reason, 64), p_detail, p_generation, 'edge:' || p_node, p_node, p_epoch, now())
  ON CONFLICT ("robotId") DO UPDATE SET "reasonCode" = EXCLUDED."reasonCode", "detail" = EXCLUDED."detail", "generation" = EXCLUDED."generation",
    "lockedAt" = EXCLUDED."lockedAt"
  WHERE l."authority" = EXCLUDED."authority" AND l."authorityNodeId" = EXCLUDED."authorityNodeId"
    AND l."ownerEpoch" = EXCLUDED."ownerEpoch" AND l."generation" <= EXCLUDED."generation"
  RETURNING true INTO done_;
  RETURN COALESCE(done_, false);
END $$;

-- an edge lock event `cleared`: delete ONLY the row of (robot, 'edge:<node>', node, ownerEpoch) with generation ≤ g, and only
-- while the robot is still owned by the node at that epoch. Returns the number of rows removed (0 = stale / newer lock).
-- fix review 1 (M2): g must be ≥ the robot's motionLockGenerationFloor (a clear from before the last ownership change ⇒ 0).
CREATE OR REPLACE FUNCTION public.edge_motion_lock_clear(p_robot integer, p_node integer, p_epoch bigint, p_generation integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM public."robot_motion_locks" l
   WHERE l."robotId" = p_robot AND l."authority" = 'edge:' || p_node AND l."authorityNodeId" = p_node AND l."ownerEpoch" = p_epoch
     AND l."generation" <= p_generation
     AND EXISTS (SELECT 1 FROM public."robots" r WHERE r."id" = p_robot AND r."edgeNodeId" = p_node AND r."ownerEpoch" = p_epoch
                   AND p_generation >= r."motionLockGenerationFloor");
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.edge_motion_lock_apply(integer, integer, bigint, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.edge_motion_lock_clear(integer, integer, bigint, integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    GRANT EXECUTE ON FUNCTION public.edge_motion_lock_apply(integer, integer, bigint, integer, text, text) TO avi_app;
    GRANT EXECUTE ON FUNCTION public.edge_motion_lock_clear(integer, integer, bigint, integer) TO avi_app;
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
