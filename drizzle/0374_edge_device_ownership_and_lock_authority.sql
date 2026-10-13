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
-- fix review 2 (ruling R-10-i, L-7 — the scan flagged M1 "STOP dropped"): (a) a device moved to CENTRAL keeps its STOP pending;
--   view device_pending_stops lists every unacked STOP (centralMustExecute / overdue / stale) and central acks only through
--   edge_stop_ack_central (done | failed, central-owned device, real actor, "ackedBy"); (b) a STOP is delivered even after its
--   expiry (overdue) and is never acked 'expired'; (c) the carry also fires on an epoch-only change; (d) an unacknowledged STOP
--   is never deleted while its device exists (the node FK cascade wiped it — the scan's path).
--   Second scan ("STOP orphaned"): (e) a device with a pending STOP is never DELETED (its FK cascade took the STOP); (f/g) the
--   carry moves every pending HEAD of an earlier epoch (edge → central → edge, several hops) exactly once — carriedToId links
--   the chain, the view shows heads only; (h) view column "undeliverable" (edge-owned, the request's node has no active
--   credential) + the node's status / last heartbeat. R-10-k: a STOP is never acked 'expired' by any writer.
-- fix review 3 (ruling R-10-aa): N1 — the request guard locks the device row FOR SHARE on INSERT (a STOP racing an owner change
--   is either carried or refused, never stranded); N2 — a STOP's ack / resolution only via edge_stop_ack_edge (node + target +
--   epoch bound, R-10-o) / edge_stop_ack_central / edge_stop_resolve (direct UPDATE refused); refused / failed STOPs stay in
--   device_pending_stops ("needsResolution") and keep their device undeletable until resolved.
-- fix review 5 (ruling R-10-ap): robot_motion_locks."writerInstanceId" uuid — NOT NULL for new rows, write-once (changes only
--   with generation + 1), set by the relock / edge apply too; replaces Group D's random µs tag in lockedAt.
-- fix review 6 (D re-review NF-1): the adapter owner change is refused only while a write is UNRESOLVED (an intent without
--   a result row, or a 'timeout' / legacy 'sent' row within a 10-minute stale-write window) — resolved history no longer blocks.
-- fix review 7 (R-10-au / R-10-k): edge_stop_ack_edge never raises on an outcome — notOwnedHere ⇒ refusal 'not_owned_here'
--   (STOP stays pending), expired / unknown / NULL ⇒ 'bad_outcome'; both return false.
-- fix review 8 (R-10-ay, L-7): device_pending_stops."ownerCannotList" (and centralMustExecute) for an unacked STOP of an
--   EDGE-owned device whose latest edge ack refusal is 'not_owned_here' from its CURRENT owner at the current epoch;
--   edge_stop_ack_central acks exactly those (done | failed; an active user or the STOP's requester), besides central-owned ones.
-- fix review 9 (ruling R-10-ba; scan "safety-state suppression" on 098155f76): edge_stop_ack_central(request, outcome, execution)
--   — no actor; only the STOP sweep after a recorded central execution (central_stop_executions, WORM, via
--   edge_stop_record_central_execution); done ⇔ the attempt was ok. ownerCannotList is STICKY (ownerCannotListAt, set by
--   edge_stop_ack_edge). A person closes a STOP only via edge_stop_resolve; resolved rows stay visible (resolvedByHuman).
-- fix review 10 (ruling R-10-bj): ot_write_intent_resolve(intent, actor, reason) — the guarded, exactly-once outcome-unknown
--   result of a crash-orphaned OT write intent (active user, reason, intent ≥ 10 min old); trg_command_log_result_guard refuses a
--   direct manual-resolution INSERT and any second result row of an intent.
-- fix review 11 (ruling R-10-bk): exactly one result per intent under concurrency — a per-intent advisory xact lock in BOTH
--   writer paths + the partial UNIQUE index ux_command_log_one_result_per_intent (backstop). A REAL device result landing after a
--   manual resolution is kept (ledger 'late_result', lateAfterResolutionId, key 'late:<id>:<key>'); it holds the adapter's owner
--   change until a person calls ot_write_late_result_review (WORM ot_write_late_result_reviews), on top of the 10-minute
--   timeout window every 'timeout' result (manual included) already holds.
-- fix review 12 (ruling R-10-bm): edge_stop_resolve / ot_write_intent_resolve / ot_write_late_result_review authorize the actor
--   IN THE DB (edge_human_resolver_authorize: active, admin | supervisor, machine_control canEdit — stricter of both
--   RBAC_SCOPED_ADMIN modes; edge_actor_in_factory_scope over edge_device_factory_id for a non-admin) ⇒ 23514, nothing written.
-- fix review 4 (ruling R-10-ah, re-review F1): edge_stop_ack_edge also requires the device to be owned by the calling node at
--   the row's epoch NOW; every refused edge ack is kept as WORM evidence in edge_stop_ack_refusals (avi_app SELECT only).
--
-- ⚠ DDL runs as owner `aoi`: `node scripts/apply-migration-0374.mjs --test-only` (dev: `--dev-only`, the owner decides; no
--   flag ⇒ refused — R-3-g). Requires 0372 + 0373. Idempotent. ⚠ The repo forbids `drizzle-kit push/generate`.
-- ROLLBACK:
--   DROP TABLE IF EXISTS "robot_motion_lock_requests"; DROP TABLE IF EXISTS "device_owner_changes";
--   DROP TRIGGER IF EXISTS trg_robots_owner_change ON "robots"; DROP TRIGGER IF EXISTS trg_robots_owner_insert ON "robots";
--   DROP TRIGGER IF EXISTS trg_robots_owner_relock ON "robots"; DROP TRIGGER IF EXISTS trg_robots_owner_stop_carry ON "robots";
--   DROP TRIGGER IF EXISTS trg_adapters_owner_stop_carry ON "device_adapters";
--   DROP VIEW IF EXISTS device_pending_stops; DROP FUNCTION IF EXISTS edge_stop_ack_central(integer, text, integer), robot_motion_lock_request_keep_stop();
--   DROP TRIGGER IF EXISTS trg_robots_keep_pending_stop ON "robots"; DROP TRIGGER IF EXISTS trg_adapters_keep_pending_stop ON "device_adapters";
--   DROP FUNCTION IF EXISTS device_keep_pending_stop(); ALTER TABLE "robot_motion_lock_requests" DROP COLUMN IF EXISTS "carriedToId";
--   DROP FUNCTION IF EXISTS edge_stop_ack_edge(integer, integer, integer, integer, bigint, text, boolean, integer), edge_stop_resolve(integer, integer, text);
--   DROP TABLE IF EXISTS "edge_stop_ack_refusals"; DROP FUNCTION IF EXISTS edge_stop_ack_refusals_worm();
--   DROP TABLE IF EXISTS "central_stop_executions"; DROP FUNCTION IF EXISTS central_stop_executions_worm(), edge_stop_record_central_execution(text, integer, boolean, text);
--   ALTER TABLE "robot_motion_lock_requests" DROP COLUMN IF EXISTS "centralExecutionId", DROP COLUMN IF EXISTS "ownerCannotListAt", DROP COLUMN IF EXISTS "ownerCannotListBy";
--   DROP TRIGGER IF EXISTS trg_command_log_result_guard ON "command_log"; DROP FUNCTION IF EXISTS command_log_result_guard(), ot_write_intent_resolve(integer, integer, text);
--   DROP FUNCTION IF EXISTS ot_write_late_result_review(integer, integer, text); DROP TABLE IF EXISTS "ot_write_late_result_reviews";
--   DROP FUNCTION IF EXISTS ot_write_late_result_reviews_worm(); DROP INDEX IF EXISTS "ux_command_log_one_result_per_intent";
--   DROP FUNCTION IF EXISTS edge_human_resolver_authorize(integer, text), edge_actor_in_factory_scope(integer, integer), edge_device_factory_id(integer, integer);
--   DROP TRIGGER IF EXISTS trg_robot_motion_lock_writer_instance ON "robot_motion_locks"; DROP FUNCTION IF EXISTS robot_motion_lock_writer_guard();
--   ALTER TABLE "robot_motion_locks" DROP COLUMN IF EXISTS "writerInstanceId";
--   ALTER TABLE "robot_motion_lock_requests" DROP COLUMN IF EXISTS "ackViaUnsigned", DROP COLUMN IF EXISTS "resolvedAt", DROP COLUMN IF EXISTS "resolvedBy", DROP COLUMN IF EXISTS "resolution";
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

-- ── fix review 5 (ruling R-10-ap): the WRITER INSTANCE of a lock row ─────────────────────────────────────────────────────────
-- Central replicas told their rows apart by a random 1..999 tag in the microseconds of lockedAt (1-in-999 collision ⇒ one replica
-- could silently replace another's safety lock). A real column: "writerInstanceId" uuid — the writing process instance (central:
-- a per-process uuid; DB-side writers use a deterministic one: the owner-change relock md5('relock:<robot>:<epoch>'), an edge
-- authority md5('edge:<node>')). NOT NULL for every NEW row (trigger); legacy rows written before this column may stay NULL.
-- WRITE-ONCE per row: it changes only when the row is rewritten with generation ≥ old + 1 (a merge / supersession); never back to
-- NULL. 0364 is on dev — this is an ALTER in 0374, 0364 is untouched.
ALTER TABLE public."robot_motion_locks" ADD COLUMN IF NOT EXISTS "writerInstanceId" uuid;
CREATE OR REPLACE FUNCTION public.robot_motion_lock_writer_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."writerInstanceId" IS NULL THEN
      RAISE EXCEPTION 'robot_motion_locks: a new lock row names its writer instance ("writerInstanceId", robot %)', NEW."robotId"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."writerInstanceId" IS NOT NULL AND NEW."writerInstanceId" IS NULL THEN
    RAISE EXCEPTION 'robot_motion_locks: "writerInstanceId" is never cleared (robot %)', OLD."robotId" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."writerInstanceId" IS NOT NULL AND NEW."writerInstanceId" IS DISTINCT FROM OLD."writerInstanceId"
     AND NEW."generation" < OLD."generation" + 1 THEN
    RAISE EXCEPTION 'robot_motion_locks: another writer (robot %) takes over a lock row only with generation + 1 (% -> %)', OLD."robotId", OLD."generation", NEW."generation"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.robot_motion_lock_writer_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_robot_motion_lock_writer_instance ON "robot_motion_locks";
CREATE TRIGGER trg_robot_motion_lock_writer_instance BEFORE INSERT OR UPDATE ON "robot_motion_locks"
  FOR EACH ROW EXECUTE FUNCTION public.robot_motion_lock_writer_guard();

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
      -- fix review 6 (D re-review NF-1, R-10-at): only an UNRESOLVED write blocks the owner change. Intent rows (status 'sent',
      -- ackValue.ledger 'intent') are WORM and stay 'sent' forever; a write is resolved by its RESULT row (ackValue.ledger
      -- 'result', ackValue.intentId = the intent's id — otDeviceWrite / commandDispatcher). In flight (fail-closed):
      --   • an intent WITHOUT a result, at any age (crashed mid-write ⇒ the result row is what resolves it);
      --   • a result 'timeout' (outcome unknown — the driver write may still land) within the stale-write window (10 min ≫ the
      --     bounded write, OT_CONTROL_TIMEOUT_MS 5 s default, per-command deadline capped);
      --   • a legacy 'sent' row with no ledger marker (pre-intent ledger, nothing can link a result) within the same window.
      -- fix review 11 (R-10-bk): a REAL device result that landed AFTER a manual "outcome unknown" resolution (ledger
      -- 'late_result') holds the owner change until a person has reviewed it (ot_write_late_result_review) — fail-closed; checked first so the refusal names it.
      IF EXISTS (SELECT 1 FROM public."command_log" l
                  WHERE l."adapterId" = OLD."id" AND l."ackValue" ->> 'ledger' = 'late_result'
                    AND NOT EXISTS (SELECT 1 FROM public."ot_write_late_result_reviews" v WHERE v."lateResultId" = l."id")) THEN
        RAISE EXCEPTION 'device_adapters: adapter % has a device write result that landed after a manual resolution — a person must review it (ot_write_late_result_review) before ownership can change', OLD."id" USING ERRCODE = 'check_violation';
      END IF;
      IF EXISTS (SELECT 1 FROM public."command_log" i
                  WHERE i."adapterId" = OLD."id" AND i."status" = 'sent' AND i."ackValue" ->> 'ledger' = 'intent'
                    AND NOT EXISTS (SELECT 1 FROM public."command_log" r
                                     WHERE r."adapterId" = OLD."id" AND r."ackValue" ->> 'ledger' = 'result'
                                       AND r."ackValue" ->> 'intentId' = i."id"::text))
         OR EXISTS (SELECT 1 FROM public."command_log" r
                     WHERE r."adapterId" = OLD."id" AND r."status" = 'timeout' AND r."createdAt" > LOCALTIMESTAMP - interval '10 minutes')
         OR EXISTS (SELECT 1 FROM public."command_log" l
                     WHERE l."adapterId" = OLD."id" AND l."status" = 'sent' AND l."ackValue" ->> 'ledger' IS DISTINCT FROM 'intent'
                       AND l."createdAt" > LOCALTIMESTAMP - interval '10 minutes') THEN
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
  INSERT INTO public."robot_motion_locks" ("robotId", "reasonCode", "detail", "generation", "authority", "authorityNodeId", "ownerEpoch", "lockedAt", "writerInstanceId")
    VALUES (NEW."id", 'ownerChanged', 'ownership changed (owner epoch ' || NEW."ownerEpoch" || ') — locked until a confirmed STOP',
            NEW."motionLockGenerationFloor", CASE WHEN NEW."edgeNodeId" IS NULL THEN 'central' ELSE 'edge:' || NEW."edgeNodeId" END,
            NEW."edgeNodeId", NEW."ownerEpoch", now(), md5('relock:' || NEW."id" || ':' || NEW."ownerEpoch")::uuid)
  ON CONFLICT ("robotId") DO UPDATE SET "reasonCode" = EXCLUDED."reasonCode", "detail" = EXCLUDED."detail", "generation" = EXCLUDED."generation",
    "authority" = EXCLUDED."authority", "authorityNodeId" = EXCLUDED."authorityNodeId", "ownerEpoch" = EXCLUDED."ownerEpoch", "lockedAt" = EXCLUDED."lockedAt",
    "writerInstanceId" = EXCLUDED."writerInstanceId";
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
-- fix review 2 (R-10-i (a)) — who acknowledged a STOP that CENTRAL executed (edge_stop_ack_central); written once with the ack
ALTER TABLE "robot_motion_lock_requests" ADD COLUMN IF NOT EXISTS "ackedBy" integer;
ALTER TABLE "robot_motion_lock_requests" DROP CONSTRAINT IF EXISTS "ck_lock_req_acked_by";
ALTER TABLE "robot_motion_lock_requests" ADD CONSTRAINT "ck_lock_req_acked_by" CHECK ("ackedBy" IS NULL OR ("ackedBy" > 0 AND "ackedAt" IS NOT NULL));
CREATE INDEX IF NOT EXISTS "idx_lock_req_pending_stop" ON "robot_motion_lock_requests" ("robotId", "adapterId") WHERE "kind" = 'stop' AND "ackedAt" IS NULL;
-- fix review 2 (second scan, "STOP orphaned") — the request this STOP was CARRIED to (written once, by the carry only): a pending
-- STOP with carriedToId NULL is the HEAD of its chain — the one obligation still open for that device.
ALTER TABLE "robot_motion_lock_requests" ADD COLUMN IF NOT EXISTS "carriedToId" integer;
-- fix review 3 (R-10-aa N2): a STOP is acked ONLY through edge_stop_ack_edge / edge_stop_ack_central; the edge ack records whether
-- it came over the unsigned-STOP channel (R-10-k / R-10-o); a refused / failed STOP stays OPEN until a person resolves it
-- (edge_stop_resolve: resolvedAt / resolvedBy / resolution, written once together).
ALTER TABLE "robot_motion_lock_requests" ADD COLUMN IF NOT EXISTS "ackViaUnsigned" boolean;
ALTER TABLE "robot_motion_lock_requests" ADD COLUMN IF NOT EXISTS "resolvedAt" timestamptz;
ALTER TABLE "robot_motion_lock_requests" ADD COLUMN IF NOT EXISTS "resolvedBy" integer;
ALTER TABLE "robot_motion_lock_requests" ADD COLUMN IF NOT EXISTS "resolution" text;
-- fix review 9 (ruling R-10-ba): a central ack names the central EXECUTION it reports (central_stop_executions.id, written
-- once with the ack); "ownerCannotListAt / By" make the R-10-ay flag STICKY — set once (by edge_stop_ack_edge, when the
-- device's CURRENT owner at the current epoch answers notOwnedHere) and kept whatever the edge answers later.
ALTER TABLE "robot_motion_lock_requests" ADD COLUMN IF NOT EXISTS "centralExecutionId" bigint;
ALTER TABLE "robot_motion_lock_requests" ADD COLUMN IF NOT EXISTS "ownerCannotListAt" timestamptz;
ALTER TABLE "robot_motion_lock_requests" ADD COLUMN IF NOT EXISTS "ownerCannotListBy" integer;
ALTER TABLE "robot_motion_lock_requests" DROP CONSTRAINT IF EXISTS "ck_lock_req_owner_cannot_list";
ALTER TABLE "robot_motion_lock_requests" ADD CONSTRAINT "ck_lock_req_owner_cannot_list" CHECK (
  (("ownerCannotListAt" IS NULL) = ("ownerCannotListBy" IS NULL)) AND ("ownerCannotListAt" IS NULL OR "kind" = 'stop')
  AND ("centralExecutionId" IS NULL OR ("kind" = 'stop' AND "ackedAt" IS NOT NULL)));

-- fix review 9 (R-10-ba): the WORM record of every CENTRAL STOP execution attempt (the server's STOP sweep only, through
-- edge_stop_record_central_execution). A central STOP ack must reference one for the same device, made after the request.
CREATE TABLE IF NOT EXISTS "central_stop_executions" (
  "id" bigserial PRIMARY KEY,
  "deviceKind" varchar(8) NOT NULL,
  "deviceId" integer NOT NULL,
  "ok" boolean NOT NULL,
  "detail" text,
  "executor" varchar(64) NOT NULL,
  "executedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ck_central_stop_exec_kind" CHECK ("deviceKind" IN ('robot', 'adapter'))
);
CREATE INDEX IF NOT EXISTS "idx_central_stop_exec_device" ON "central_stop_executions" ("deviceKind", "deviceId", "executedAt");
COMMENT ON TABLE "central_stop_executions" IS
  'doc 81 Dot 10 A (0374, fix review 9 R-10-ba): WORM record of every central STOP execution attempt by the server STOP sweep; the evidence a central STOP ack must reference.';
CREATE OR REPLACE FUNCTION public.central_stop_executions_worm() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'central_stop_executions is append-only (WORM)' USING ERRCODE = 'check_violation';
END $$;
REVOKE ALL ON FUNCTION public.central_stop_executions_worm() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_central_stop_executions_worm ON "central_stop_executions";
CREATE TRIGGER trg_central_stop_executions_worm BEFORE UPDATE OR DELETE ON "central_stop_executions"
  FOR EACH ROW EXECUTE FUNCTION public.central_stop_executions_worm();
DROP TRIGGER IF EXISTS trg_central_stop_executions_worm_truncate ON "central_stop_executions";
CREATE TRIGGER trg_central_stop_executions_worm_truncate BEFORE TRUNCATE ON "central_stop_executions"
  FOR EACH STATEMENT EXECUTE FUNCTION public.central_stop_executions_worm();
ALTER TABLE "robot_motion_lock_requests" DROP CONSTRAINT IF EXISTS "ck_lock_req_resolved";
ALTER TABLE "robot_motion_lock_requests" ADD CONSTRAINT "ck_lock_req_resolved" CHECK (
  (("resolvedAt" IS NULL) = ("resolvedBy" IS NULL)) AND (("resolvedAt" IS NULL) = ("resolution" IS NULL))
  AND ("resolvedAt" IS NULL OR ("kind" = 'stop' AND "outcome" IN ('refused', 'failed') AND "resolvedBy" > 0)));
COMMENT ON TABLE "robot_motion_lock_requests" IS
  'doc 81 Dot 10 A (0374): central -> edge lock / clear / stop requests for edge-owned devices, bound to (device, owner, ownerEpoch); identity write-once, delivered once (only while the epoch holds), acked once.';

CREATE OR REPLACE FUNCTION public.robot_motion_lock_request_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  cur_owner integer;
  cur_epoch bigint;
  tbl_owner name;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- fix review 3 (R-10-aa N1): lock the device row FOR SHARE before reading its owner — an owner change in flight (NO KEY
    -- UPDATE) makes this insert WAIT and then see the new owner (⇒ 23514, the caller re-queues); an insert that got here first
    -- makes the owner change wait until it commits, so its carry sees this STOP. Never stranded at an old (node, epoch).
    IF NEW."robotId" IS NOT NULL THEN
      SELECT r."edgeNodeId", r."ownerEpoch" INTO cur_owner, cur_epoch FROM public."robots" r WHERE r."id" = NEW."robotId" FOR SHARE;
    ELSE
      SELECT a."edgeNodeId", a."ownerEpoch" INTO cur_owner, cur_epoch FROM public."device_adapters" a WHERE a."id" = NEW."adapterId" FOR SHARE;
    END IF;
  ELSIF NEW."robotId" IS NOT NULL THEN
    SELECT r."edgeNodeId", r."ownerEpoch" INTO cur_owner, cur_epoch FROM public."robots" r WHERE r."id" = NEW."robotId";
  ELSE
    SELECT a."edgeNodeId", a."ownerEpoch" INTO cur_owner, cur_epoch FROM public."device_adapters" a WHERE a."id" = NEW."adapterId";
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."deliveredAt" IS NOT NULL OR NEW."ackedAt" IS NOT NULL OR NEW."outcome" IS NOT NULL OR NEW."ackGeneration" IS NOT NULL
       OR NEW."ackedBy" IS NOT NULL OR NEW."carriedToId" IS NOT NULL OR NEW."ackViaUnsigned" IS NOT NULL OR NEW."resolvedAt" IS NOT NULL
       OR NEW."resolvedBy" IS NOT NULL OR NEW."resolution" IS NOT NULL OR NEW."centralExecutionId" IS NOT NULL
       OR NEW."ownerCannotListAt" IS NOT NULL OR NEW."ownerCannotListBy" IS NOT NULL THEN
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
     OR NEW."ackGeneration" IS DISTINCT FROM OLD."ackGeneration" OR NEW."deliveredAt" IS DISTINCT FROM OLD."deliveredAt"
     OR NEW."ackedBy" IS DISTINCT FROM OLD."ackedBy") THEN
    RAISE EXCEPTION 'robot_motion_lock_requests: the ack is written once (request %)', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."carriedToId" IS NOT NULL AND NEW."carriedToId" IS DISTINCT FROM OLD."carriedToId" THEN
    RAISE EXCEPTION 'robot_motion_lock_requests: carriedToId is written once (request %)', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  -- fix review 3 (R-10-aa N2): a STOP's ack / resolution is written ONLY by the guarded functions (owner aoi:
  -- edge_stop_ack_edge, edge_stop_ack_central, edge_stop_resolve) — never by a direct UPDATE of the app
  IF OLD."kind" = 'stop'
     AND (NEW."ackedAt" IS DISTINCT FROM OLD."ackedAt" OR NEW."outcome" IS DISTINCT FROM OLD."outcome"
          OR NEW."ackGeneration" IS DISTINCT FROM OLD."ackGeneration" OR NEW."ackedBy" IS DISTINCT FROM OLD."ackedBy"
          OR NEW."ackViaUnsigned" IS DISTINCT FROM OLD."ackViaUnsigned" OR NEW."resolvedAt" IS DISTINCT FROM OLD."resolvedAt"
          OR NEW."resolvedBy" IS DISTINCT FROM OLD."resolvedBy" OR NEW."resolution" IS DISTINCT FROM OLD."resolution"
          OR NEW."centralExecutionId" IS DISTINCT FROM OLD."centralExecutionId" OR NEW."ownerCannotListAt" IS DISTINCT FROM OLD."ownerCannotListAt"
          OR NEW."ownerCannotListBy" IS DISTINCT FROM OLD."ownerCannotListBy") THEN
    SELECT pg_catalog.pg_get_userbyid(c.relowner) INTO tbl_owner FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID;
    IF current_user IS DISTINCT FROM tbl_owner THEN
      RAISE EXCEPTION 'robot_motion_lock_requests: a STOP (request %) is acknowledged / resolved only via edge_stop_ack_edge / edge_stop_ack_central / edge_stop_resolve', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF (OLD."centralExecutionId" IS NOT NULL AND NEW."centralExecutionId" IS DISTINCT FROM OLD."centralExecutionId")
     OR (OLD."ownerCannotListAt" IS NOT NULL AND (NEW."ownerCannotListAt" IS DISTINCT FROM OLD."ownerCannotListAt"
         OR NEW."ownerCannotListBy" IS DISTINCT FROM OLD."ownerCannotListBy")) THEN
    RAISE EXCEPTION 'robot_motion_lock_requests: centralExecutionId / ownerCannotList are written once (request %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."ackViaUnsigned" IS NOT NULL AND NEW."ackViaUnsigned" IS DISTINCT FROM OLD."ackViaUnsigned" THEN
    RAISE EXCEPTION 'robot_motion_lock_requests: the ack is written once (request %)', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."resolvedAt" IS NOT NULL AND (NEW."resolvedAt" IS DISTINCT FROM OLD."resolvedAt" OR NEW."resolvedBy" IS DISTINCT FROM OLD."resolvedBy"
     OR NEW."resolution" IS DISTINCT FROM OLD."resolution") THEN
    RAISE EXCEPTION 'robot_motion_lock_requests: a resolution is written once (request %)', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  -- fix scan 2 — monotonic: delivery before expiry, never in the future.
  -- fix review 2 (R-10-i (b), L-7): a STOP is delivered EVEN AFTER its expiry — expiry only makes it OVERDUE
  -- (device_pending_stops.overdue); lock / clear keep the expiry.
  IF OLD."deliveredAt" IS NULL AND NEW."deliveredAt" IS NOT NULL
     AND (NEW."deliveredAt" < OLD."createdAt" OR (OLD."kind" <> 'stop' AND NEW."deliveredAt" > OLD."expiresAt")
          OR NEW."deliveredAt" > now() + interval '5 seconds') THEN
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
    -- fix review 2 (R-10-i (b)): a STOP never expires silently — it stays pending until done / refused / failed
    IF NEW."outcome" = 'expired' AND OLD."kind" = 'stop' THEN
      RAISE EXCEPTION 'robot_motion_lock_requests: STOP request % never expires — deliver it (overdue) or ack done / failed', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."outcome" = 'expired' AND NEW."deliveredAt" IS NOT NULL AND NEW."ackedAt" < OLD."expiresAt" THEN
      RAISE EXCEPTION 'robot_motion_lock_requests: delivered request % expires only at / after its expiry', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."ackGeneration" IS NOT NULL AND NEW."outcome" <> 'done' THEN
      RAISE EXCEPTION 'robot_motion_lock_requests: ackGeneration only with outcome done (request %)', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF OLD."ackedAt" IS NULL AND NEW."ackedAt" IS NULL AND (NEW."ackGeneration" IS DISTINCT FROM OLD."ackGeneration" OR NEW."ackedBy" IS NOT NULL) THEN
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
DECLARE
  q record;
  nid integer;
BEGIN
  IF NEW."edgeNodeId" IS NULL THEN
    RETURN NULL;
  END IF;
  -- fix review 2 (second scan): carry EVERY pending HEAD of an EARLIER epoch — not only those of the epoch just left (an
  -- edge → central → edge move, or several hops, stranded the STOP at the first node) — exactly once (the head is linked to
  -- its carry through carriedToId, so A → B → C never duplicates).
  FOR q IN
    SELECT x.* FROM public."robot_motion_lock_requests" x
     WHERE x."kind" = 'stop' AND x."ackedAt" IS NULL AND x."carriedToId" IS NULL AND x."ownerEpoch" < NEW."ownerEpoch"
       AND (CASE WHEN TG_TABLE_NAME = 'robots' THEN x."robotId" = NEW."id" ELSE x."adapterId" = NEW."id" END)
     ORDER BY x."id"
     FOR UPDATE
  LOOP
    INSERT INTO public."robot_motion_lock_requests" ("robotId", "adapterId", "edgeNodeId", "ownerEpoch", "kind", "reason", "requestedBy", "createdAt", "expiresAt")
      VALUES (q."robotId", q."adapterId", NEW."edgeNodeId", NEW."ownerEpoch", 'stop',
              'carried from request #' || q."id" || ' (owner change, epoch ' || q."ownerEpoch" || ' -> ' || NEW."ownerEpoch" || ')'
                || COALESCE(': ' || q."reason", ''),
              q."requestedBy", now(), now() + GREATEST(q."expiresAt" - q."createdAt", interval '60 seconds'))
      RETURNING "id" INTO nid;
    UPDATE public."robot_motion_lock_requests" SET "carriedToId" = nid WHERE "id" = q."id";
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.device_owner_stop_carry() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_robots_owner_stop_carry ON "robots";
CREATE TRIGGER trg_robots_owner_stop_carry AFTER UPDATE OF "edgeNodeId", "ownerEpoch" ON "robots"
  FOR EACH ROW WHEN (OLD."edgeNodeId" IS DISTINCT FROM NEW."edgeNodeId" OR OLD."ownerEpoch" IS DISTINCT FROM NEW."ownerEpoch")
  EXECUTE FUNCTION public.device_owner_stop_carry();
DROP TRIGGER IF EXISTS trg_adapters_owner_stop_carry ON "device_adapters";
CREATE TRIGGER trg_adapters_owner_stop_carry AFTER UPDATE OF "edgeNodeId", "ownerEpoch" ON "device_adapters"
  FOR EACH ROW WHEN (OLD."edgeNodeId" IS DISTINCT FROM NEW."edgeNodeId" OR OLD."ownerEpoch" IS DISTINCT FROM NEW."ownerEpoch")
  EXECUTE FUNCTION public.device_owner_stop_carry();

-- fix review 2 (R-10-i (d) — the scan's path): an UNACKNOWLEDGED STOP is never deleted while its device exists. The request's
-- node FK is ON DELETE CASCADE, so deleting the OLD node (deletable once the device moved away) silently wiped the pending STOP.
-- A device deleted itself takes its requests with it (the cascade from robots / device_adapters runs after the device row is
-- gone, so the guard lets it through). Applies to every writer, the owner included.
CREATE OR REPLACE FUNCTION public.robot_motion_lock_request_keep_stop() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD."kind" = 'stop' AND OLD."carriedToId" IS NULL
     AND (OLD."ackedAt" IS NULL OR (OLD."outcome" IN ('refused', 'failed') AND OLD."resolvedAt" IS NULL))
     AND (EXISTS (SELECT 1 FROM public."robots" r WHERE r."id" = OLD."robotId")
          OR EXISTS (SELECT 1 FROM public."device_adapters" a WHERE a."id" = OLD."adapterId")) THEN
    RAISE EXCEPTION 'robot_motion_lock_requests: STOP request % is not acknowledged — it is never deleted (L-7)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.robot_motion_lock_request_keep_stop() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_robot_motion_lock_request_keep_stop ON "robot_motion_lock_requests";
CREATE TRIGGER trg_robot_motion_lock_request_keep_stop BEFORE DELETE ON "robot_motion_lock_requests"
  FOR EACH ROW EXECUTE FUNCTION public.robot_motion_lock_request_keep_stop();

-- fix review 2 (second scan, "STOP orphaned" — the measured path): DELETING the device (robot / adapter) cascade-deleted its
-- pending STOP (the cascade runs after the device row is gone, past the guard above). A device with a pending STOP HEAD is never
-- deleted: execute + acknowledge the STOP first. Applies to every writer, the owner included.
CREATE OR REPLACE FUNCTION public.device_keep_pending_stop() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public."robot_motion_lock_requests" q
              WHERE q."kind" = 'stop' AND q."carriedToId" IS NULL
                AND (q."ackedAt" IS NULL OR (q."outcome" IN ('refused', 'failed') AND q."resolvedAt" IS NULL))
                AND (CASE WHEN TG_TABLE_NAME = 'robots' THEN q."robotId" = OLD."id" ELSE q."adapterId" = OLD."id" END)) THEN
    RAISE EXCEPTION '%: device % has an unacknowledged STOP — execute and acknowledge it before deleting the device (L-7)', TG_TABLE_NAME, OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.device_keep_pending_stop() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_robots_keep_pending_stop ON "robots";
CREATE TRIGGER trg_robots_keep_pending_stop BEFORE DELETE ON "robots"
  FOR EACH ROW EXECUTE FUNCTION public.device_keep_pending_stop();
DROP TRIGGER IF EXISTS trg_adapters_keep_pending_stop ON "device_adapters";
CREATE TRIGGER trg_adapters_keep_pending_stop BEFORE DELETE ON "device_adapters"
  FOR EACH ROW EXECUTE FUNCTION public.device_keep_pending_stop();

-- fix review 4 (R-10-ah, re-review F1): EVIDENCE of every edge STOP ack that was NOT accepted (WORM; written only by
-- edge_stop_ack_edge as owner). Reason: malformed | not_pending | other_node | target_mismatch | epoch_mismatch | not_current_owner |
-- not_owned_here (the node reports it no longer holds the device; non-terminal) | bad_outcome (expired / unknown — R-10-k).
CREATE TABLE IF NOT EXISTS "edge_stop_ack_refusals" (
  "id" bigserial PRIMARY KEY,
  "requestId" integer,
  "edgeNodeId" integer,
  "robotId" integer,
  "adapterId" integer,
  "ownerEpoch" bigint,
  "outcome" varchar(16),
  "viaUnsigned" boolean,
  "reason" varchar(32) NOT NULL,
  "at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ck_edge_stop_ack_refusal_reason" CHECK ("reason" IN ('malformed', 'not_pending', 'other_node', 'target_mismatch', 'epoch_mismatch', 'not_current_owner', 'not_owned_here', 'bad_outcome'))
);
CREATE INDEX IF NOT EXISTS "idx_edge_stop_ack_refusals_req" ON "edge_stop_ack_refusals" ("requestId");
ALTER TABLE "edge_stop_ack_refusals" DROP CONSTRAINT IF EXISTS "ck_edge_stop_ack_refusal_reason";
ALTER TABLE "edge_stop_ack_refusals" ADD CONSTRAINT "ck_edge_stop_ack_refusal_reason"
  CHECK ("reason" IN ('malformed', 'not_pending', 'other_node', 'target_mismatch', 'epoch_mismatch', 'not_current_owner', 'not_owned_here', 'bad_outcome'));
COMMENT ON TABLE "edge_stop_ack_refusals" IS
  'doc 81 Dot 10 A (0374, fix review 4 R-10-ah): WORM evidence of edge STOP acks that were refused (e.g. a former owner answering for a device it no longer owns). Written only by edge_stop_ack_edge.';
CREATE OR REPLACE FUNCTION public.edge_stop_ack_refusals_worm() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'edge_stop_ack_refusals is append-only (WORM)' USING ERRCODE = 'check_violation';
END $$;
REVOKE ALL ON FUNCTION public.edge_stop_ack_refusals_worm() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_edge_stop_ack_refusals_worm ON "edge_stop_ack_refusals";
CREATE TRIGGER trg_edge_stop_ack_refusals_worm BEFORE UPDATE OR DELETE ON "edge_stop_ack_refusals"
  FOR EACH ROW EXECUTE FUNCTION public.edge_stop_ack_refusals_worm();
DROP TRIGGER IF EXISTS trg_edge_stop_ack_refusals_worm_truncate ON "edge_stop_ack_refusals";
CREATE TRIGGER trg_edge_stop_ack_refusals_worm_truncate BEFORE TRUNCATE ON "edge_stop_ack_refusals"
  FOR EACH STATEMENT EXECUTE FUNCTION public.edge_stop_ack_refusals_worm();

-- fix review 2 (R-10-i (a)): every STOP nobody acknowledged, with where it stands NOW — for central (Group D's ownership-change
-- service executes those of central-owned devices) and for alerting (overdue = past expiresAt, still pending).
CREATE OR REPLACE VIEW public.device_pending_stops AS
SELECT q."id" AS "requestId", q."robotId", q."adapterId",
       q."edgeNodeId" AS "requestEdgeNodeId", q."ownerEpoch" AS "requestOwnerEpoch",
       COALESCE(r."edgeNodeId", a."edgeNodeId") AS "currentEdgeNodeId",
       COALESCE(r."ownerEpoch", a."ownerEpoch") AS "currentOwnerEpoch",
       q."requestedBy", q."reason", q."createdAt", q."expiresAt", q."deliveredAt",
       (now() > q."expiresAt") AS "overdue",
       -- fix review 8 (R-10-ay): central also executes the STOP of an EDGE-owned device whose CURRENT owner (at the current epoch)
       -- answered its latest ack "notOwnedHere" — it owns the device but cannot list / reach it (e.g. factory moved / cleared)
       (COALESCE(r."edgeNodeId", a."edgeNodeId") IS NULL
        OR (q."ackedAt" IS NULL AND q."ownerCannotListAt" IS NOT NULL AND COALESCE(r."edgeNodeId", a."edgeNodeId") IS NOT NULL))
       AND q."resolvedAt" IS NULL AS "centralMustExecute",
       (q."edgeNodeId" IS DISTINCT FROM COALESCE(r."edgeNodeId", a."edgeNodeId")
        OR q."ownerEpoch" IS DISTINCT FROM COALESCE(r."ownerEpoch", a."ownerEpoch")) AS "stale",
       -- the request's node can never pick it up: the device is edge-owned and that node has no ACTIVE credential (revoked /
       -- never issued — it cannot pull); central must act (re-own the device, or a person)
       (COALESCE(r."edgeNodeId", a."edgeNodeId") IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public."edge_node_credentials" c WHERE c."edgeNodeId" = q."edgeNodeId" AND c."status" = 'active')) AS "undeliverable",
       n."status"::text AS "requestNodeStatus", n."lastHeartbeatAt" AS "requestNodeLastHeartbeatAt",
       -- fix review 3 (R-10-aa N2): a STOP the edge / central answered refused or failed is NOT closed — a person resolves it
       q."outcome" AS "outcome", (q."ackedAt" IS NOT NULL AND q."resolvedAt" IS NULL) AS "needsResolution",
       (q."ackedAt" IS NULL AND q."resolvedAt" IS NULL AND q."ownerCannotListAt" IS NOT NULL AND COALESCE(r."edgeNodeId", a."edgeNodeId") IS NOT NULL) AS "ownerCannotList",
       -- fix review 9 (R-10-ba): a STOP a person closed (edge_stop_resolve) stays VISIBLE, marked resolved-by-human
       (q."resolvedAt" IS NOT NULL) AS "resolvedByHuman"
  FROM public."robot_motion_lock_requests" q
  LEFT JOIN public."robots" r ON r."id" = q."robotId"
  LEFT JOIN public."device_adapters" a ON a."id" = q."adapterId"
  LEFT JOIN public."edge_nodes" n ON n."id" = q."edgeNodeId"
 WHERE q."kind" = 'stop' AND q."carriedToId" IS NULL
   AND (q."ackedAt" IS NULL OR q."outcome" IN ('refused', 'failed'));
COMMENT ON VIEW public.device_pending_stops IS
  'doc 81 Dot 10 A fix review 2 (R-10-i): the pending STOP HEAD of each chain (unacked, not carried on) and its device''s CURRENT owner; centralMustExecute = central-owned now; overdue = past expiresAt; undeliverable = edge-owned but the request''s node has no active credential.';

-- fix review 9 (ruling R-10-ba): the server's STOP SWEEP records each central STOP execution attempt (WORM) and gets its id —
-- the evidence a central STOP ack must reference. ok = the STOP reached the device (sent / simulated as configured).
CREATE OR REPLACE FUNCTION public.edge_stop_record_central_execution(p_kind text, p_device integer, p_ok boolean, p_detail text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  nid bigint;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('robot', 'adapter') OR p_device IS NULL OR p_ok IS NULL THEN
    RAISE EXCEPTION 'edge_stop_record_central_execution: kind robot | adapter, a device and an ok flag are required' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT ((p_kind = 'robot' AND EXISTS (SELECT 1 FROM public."robots" r WHERE r."id" = p_device))
          OR (p_kind = 'adapter' AND EXISTS (SELECT 1 FROM public."device_adapters" a WHERE a."id" = p_device))) THEN
    RAISE EXCEPTION 'edge_stop_record_central_execution: % % does not exist', p_kind, p_device USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public."central_stop_executions" ("deviceKind", "deviceId", "ok", "detail", "executor")
    VALUES (p_kind, p_device, p_ok, left(p_detail, 2000), 'central-stop-sweep') RETURNING "id" INTO nid;
  RETURN nid;
END $$;
REVOKE ALL ON FUNCTION public.edge_stop_record_central_execution(text, integer, boolean, text) FROM PUBLIC;

-- fix review 2 (R-10-i (a)) + fix review 9 (R-10-ba): the ONE way central acknowledges a STOP — ONLY the server's STOP sweep,
-- AFTER a central execution attempt it recorded (p_execution: central_stop_executions.id of the SAME device, made after the
-- request, at most 10 minutes ago; done ⇔ that attempt ok, failed ⇔ not ok). No user ever acks (a person closes a STOP only
-- through edge_stop_resolve). Allowed for a pending, unresolved STOP whose device is CENTRAL-owned now, or EDGE-owned with the
-- sticky "ownerCannotList" flag (R-10-ay). A failed ack keeps the row listed (needsResolution).
DROP FUNCTION IF EXISTS public.edge_stop_ack_central(integer, text, integer);
CREATE OR REPLACE FUNCTION public.edge_stop_ack_central(p_request integer, p_outcome text, p_execution bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  q record;
  ex record;
  cur_owner integer;
  found_device boolean;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('done', 'failed') THEN
    RAISE EXCEPTION 'edge_stop_ack_central: outcome must be done or failed (got %)', p_outcome USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO q FROM public."robot_motion_lock_requests" x WHERE x."id" = p_request FOR UPDATE;
  IF NOT FOUND OR q."kind" <> 'stop' OR q."ackedAt" IS NOT NULL OR q."resolvedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'edge_stop_ack_central: request % is not a pending STOP', p_request USING ERRCODE = 'check_violation';
  END IF;
  IF q."robotId" IS NOT NULL THEN
    SELECT r."edgeNodeId" INTO cur_owner FROM public."robots" r WHERE r."id" = q."robotId" FOR SHARE;
  ELSE
    SELECT a."edgeNodeId" INTO cur_owner FROM public."device_adapters" a WHERE a."id" = q."adapterId" FOR SHARE;
  END IF;
  found_device := FOUND;
  IF NOT found_device THEN
    RAISE EXCEPTION 'edge_stop_ack_central: the device of request % does not exist', p_request USING ERRCODE = 'check_violation';
  END IF;
  IF cur_owner IS NOT NULL AND q."ownerCannotListAt" IS NULL THEN
    RAISE EXCEPTION 'edge_stop_ack_central: the device of request % is edge-owned and its owner has not declared it cannot list it — its edge acknowledges it', p_request
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO ex FROM public."central_stop_executions" e WHERE e."id" = p_execution;
  IF NOT FOUND
     OR ex."deviceKind" IS DISTINCT FROM (CASE WHEN q."robotId" IS NOT NULL THEN 'robot' ELSE 'adapter' END)
     OR ex."deviceId" IS DISTINCT FROM COALESCE(q."robotId", q."adapterId")
     OR ex."executedAt" < q."createdAt" OR ex."executedAt" < now() - interval '10 minutes'
     OR (p_outcome = 'done') IS DISTINCT FROM ex."ok" THEN
    RAISE EXCEPTION 'edge_stop_ack_central: execution % is not a recent central STOP attempt of this device matching outcome % (request %)', p_execution, p_outcome, p_request
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public."robot_motion_lock_requests"
     SET "deliveredAt" = COALESCE("deliveredAt", now()), "ackedAt" = GREATEST(now(), COALESCE("deliveredAt", now())), "outcome" = p_outcome,
         "centralExecutionId" = p_execution
   WHERE "id" = p_request;
END $$;
REVOKE ALL ON FUNCTION public.edge_stop_ack_central(integer, text, bigint) FROM PUBLIC;

-- fix review 3 (R-10-aa N2, R-10-o): THE way a node acknowledges a STOP — B's ackEdgeCommand calls it for every STOP ack (signed
-- or over the unsigned-STOP channel). Accepted only for a pending STOP bound to THIS node whose target (robot XOR adapter) and
-- owner epoch equal what the node reports it actually stopped; outcome done | refused | failed (never expired, R-10-k).
-- Returns true when recorded; false (nothing changed — the request stays pending, the caller records an anomaly) otherwise.
CREATE OR REPLACE FUNCTION public.edge_stop_ack_edge(p_request integer, p_node integer, p_robot integer, p_adapter integer,
  p_owner_epoch bigint, p_outcome text, p_unsigned boolean, p_generation integer DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  q record;
  cur_owner integer;
  cur_epoch bigint;
  why text;
BEGIN
  -- fix review 7 (R-10-au, R-10-k): NO outcome ever raises — every refused ack leaves WORM evidence and returns false:
  --   • notOwnedHere — the node no longer holds the device: NON-terminal, the STOP stays pending for its current executor;
  --   • expired / any other unknown / NULL outcome — a STOP is never acked expired.
  IF p_outcome IS NULL OR p_outcome NOT IN ('done', 'refused', 'failed') THEN
    -- fix review 9 (R-10-ba): notOwnedHere from the device's CURRENT owner at the current epoch, for exactly the request's target,
    -- sets the STICKY ownerCannotList flag of a pending STOP (once; nothing the edge answers later clears it)
    IF p_outcome = 'notOwnedHere' AND p_node IS NOT NULL AND p_owner_epoch IS NOT NULL AND ((p_robot IS NULL) <> (p_adapter IS NULL)) THEN
      SELECT * INTO q FROM public."robot_motion_lock_requests" x WHERE x."id" = p_request FOR UPDATE;
      IF FOUND AND q."kind" = 'stop' AND q."ackedAt" IS NULL AND q."resolvedAt" IS NULL AND q."ownerCannotListAt" IS NULL
         AND q."robotId" IS NOT DISTINCT FROM p_robot AND q."adapterId" IS NOT DISTINCT FROM p_adapter THEN
        IF q."robotId" IS NOT NULL THEN
          SELECT r."edgeNodeId", r."ownerEpoch" INTO cur_owner, cur_epoch FROM public."robots" r WHERE r."id" = q."robotId" FOR SHARE;
        ELSE
          SELECT a."edgeNodeId", a."ownerEpoch" INTO cur_owner, cur_epoch FROM public."device_adapters" a WHERE a."id" = q."adapterId" FOR SHARE;
        END IF;
        IF cur_owner = p_node AND cur_epoch = p_owner_epoch THEN
          UPDATE public."robot_motion_lock_requests" SET "ownerCannotListAt" = now(), "ownerCannotListBy" = p_node WHERE "id" = p_request;
        END IF;
      END IF;
    END IF;
    INSERT INTO public."edge_stop_ack_refusals" ("requestId", "edgeNodeId", "robotId", "adapterId", "ownerEpoch", "outcome", "viaUnsigned", "reason")
      VALUES (p_request, p_node, p_robot, p_adapter, p_owner_epoch, left(COALESCE(p_outcome, 'null'), 16), p_unsigned,
              CASE WHEN p_outcome = 'notOwnedHere' THEN 'not_owned_here' ELSE 'bad_outcome' END);
    RETURN false;
  END IF;
  -- fix review 4: a malformed ack (no / two targets, no node / epoch / channel) is REFUSED like any other mismatch — false +
  -- evidence, the request stays pending (B answers 409); only an outcome outside done | refused | failed is an error
  IF p_node IS NULL OR p_owner_epoch IS NULL OR p_unsigned IS NULL OR ((p_robot IS NULL) = (p_adapter IS NULL)) THEN
    INSERT INTO public."edge_stop_ack_refusals" ("requestId", "edgeNodeId", "robotId", "adapterId", "ownerEpoch", "outcome", "viaUnsigned", "reason")
      VALUES (p_request, p_node, p_robot, p_adapter, p_owner_epoch, p_outcome, p_unsigned, 'malformed');
    RETURN false;
  END IF;
  SELECT * INTO q FROM public."robot_motion_lock_requests" x WHERE x."id" = p_request FOR UPDATE;
  -- fix review 4 (R-10-ah, F1): the device must be owned by THIS node at the row's epoch NOW (locked, so an owner change
  -- cannot slip in between) — a former owner never answers for a device it no longer controls (a central-must-execute STOP
  -- stays for central; a carried STOP stays for the new owner)
  IF NOT FOUND THEN
    why := 'not_pending';
  ELSE
    IF q."robotId" IS NOT NULL THEN
      SELECT r."edgeNodeId", r."ownerEpoch" INTO cur_owner, cur_epoch FROM public."robots" r WHERE r."id" = q."robotId" FOR SHARE;
    ELSE
      SELECT a."edgeNodeId", a."ownerEpoch" INTO cur_owner, cur_epoch FROM public."device_adapters" a WHERE a."id" = q."adapterId" FOR SHARE;
    END IF;
    why := CASE
      WHEN q."kind" <> 'stop' OR q."ackedAt" IS NOT NULL THEN 'not_pending'
      WHEN q."edgeNodeId" IS DISTINCT FROM p_node THEN 'other_node'
      WHEN q."robotId" IS DISTINCT FROM p_robot OR q."adapterId" IS DISTINCT FROM p_adapter THEN 'target_mismatch'
      WHEN q."ownerEpoch" IS DISTINCT FROM p_owner_epoch THEN 'epoch_mismatch'
      WHEN cur_owner IS DISTINCT FROM p_node OR cur_epoch IS DISTINCT FROM q."ownerEpoch" THEN 'not_current_owner'
      ELSE NULL END;
  END IF;
  IF why IS NOT NULL THEN
    INSERT INTO public."edge_stop_ack_refusals" ("requestId", "edgeNodeId", "robotId", "adapterId", "ownerEpoch", "outcome", "viaUnsigned", "reason")
      VALUES (p_request, p_node, p_robot, p_adapter, p_owner_epoch, p_outcome, p_unsigned, why);
    RETURN false;
  END IF;
  UPDATE public."robot_motion_lock_requests"
     SET "deliveredAt" = COALESCE("deliveredAt", now()), "ackedAt" = GREATEST(now(), COALESCE("deliveredAt", now())), "outcome" = p_outcome,
         "ackGeneration" = CASE WHEN p_outcome = 'done' THEN p_generation ELSE NULL END, "ackViaUnsigned" = p_unsigned
   WHERE "id" = p_request;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.edge_stop_ack_edge(integer, integer, integer, integer, bigint, text, boolean, integer) FROM PUBLIC;

-- fix review 3 (R-10-aa N2): a STOP answered refused / failed stays in device_pending_stops until a REAL, ACTIVE user records
-- how it was resolved (written once). Nothing else closes it.
-- ── fix review 12 (ruling R-10-bm): WHO may resolve — checked in the DB, not only in the router ───────────────────────────
-- The human-resolution functions (edge_stop_resolve, ot_write_intent_resolve, ot_write_late_result_review) are SECURITY
-- DEFINER and avi_app may call them with any actor id; the rule below is the router's (F2 edgeResolutionRouter:
-- supervisorProcedure = admin | supervisor, requirePermission('machine_control', 'canEdit'), resolveTenantFactoryScope strict),
-- read from the same tables (users, permissions, user_factory_assignments, user_corporate_assignments, factories; read-only).
-- Insufficient or unknown ⇒ 23514 before anything is written. Not checkable here: the session's 2FA (router only).
-- The device's factory — the same chain as F2's ROBOT_FACTORY / ADAPTER_FACTORY (robot: station → line, else its line;
-- adapter: machine → station → line; line → workshop → factory). NULL = no chain (only an unrestricted caller may resolve).
CREATE OR REPLACE FUNCTION public.edge_device_factory_id(p_robot integer, p_adapter integer) RETURNS integer
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  fid integer;
BEGIN
  IF p_robot IS NOT NULL THEN
    SELECT w."factoryId" INTO fid FROM public."robots" r
      LEFT JOIN public."stations" s ON s."id" = r."stationId"
      LEFT JOIN public."production_lines" l ON l."id" = COALESCE(s."lineId", r."lineId")
      LEFT JOIN public."workshops" w ON w."id" = l."workshopId"
     WHERE r."id" = p_robot;
  END IF;
  IF fid IS NULL AND p_adapter IS NOT NULL THEN
    SELECT w."factoryId" INTO fid FROM public."device_adapters" a
      LEFT JOIN public."machines" m ON m."id" = a."machineId"
      LEFT JOIN public."stations" s ON s."id" = m."stationId"
      LEFT JOIN public."production_lines" l ON l."id" = s."lineId"
      LEFT JOIN public."workshops" w ON w."id" = l."workshopId"
     WHERE a."id" = p_adapter;
  END IF;
  RETURN fid;
END $$;
REVOKE ALL ON FUNCTION public.edge_device_factory_id(integer, integer) FROM PUBLIC;

-- The actor: active, not 0; role admin | supervisor; machine_control canEdit as accessControl.checkPermission reads it. The DB
-- cannot see RBAC_SCOPED_ADMIN, so it takes the STRICTER of both modes: an admin passes unless an explicit machine_control row
-- still in force says canEdit is not true; a supervisor needs a row in force with canEdit = true. "In force" is fail-closed
-- across the naive-timestamp reading (postgres.js writes UTC wall time into timestamp-without-tz): a grant must be unexpired in
-- BOTH readings, a denial counts if unexpired in EITHER. Returns true for an unrestricted (admin) actor.
CREATE OR REPLACE FUNCTION public.edge_human_resolver_authorize(p_actor integer, p_what text) RETURNS boolean
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  u record;
BEGIN
  IF p_actor IS NULL OR p_actor <= 0 THEN
    RAISE EXCEPTION '%: actor % is not an active user', p_what, p_actor USING ERRCODE = 'check_violation';
  END IF;
  SELECT x."role"::text AS role, x."isActive" AS active INTO u FROM public."users" x WHERE x."id" = p_actor;
  IF NOT FOUND OR u.active IS NOT TRUE THEN
    RAISE EXCEPTION '%: actor % is not an active user', p_what, p_actor USING ERRCODE = 'check_violation';
  END IF;
  IF u.role IS NULL OR u.role NOT IN ('admin', 'supervisor') THEN
    RAISE EXCEPTION '%: actor % (role %) may not resolve — admin or supervisor only', p_what, p_actor, u.role USING ERRCODE = 'check_violation';
  END IF;
  IF u.role = 'admin' THEN
    IF EXISTS (SELECT 1 FROM public."permissions" pm
                WHERE pm."userId" = p_actor AND pm."moduleName" = 'machine_control' AND pm."canEdit" IS NOT TRUE
                  AND (pm."expiresAt" IS NULL OR pm."expiresAt" > LEAST(LOCALTIMESTAMP, (now() AT TIME ZONE 'UTC')))) THEN
      RAISE EXCEPTION '%: actor % has machine_control edit explicitly withheld', p_what, p_actor USING ERRCODE = 'check_violation';
    END IF;
    RETURN true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."permissions" pm
                  WHERE pm."userId" = p_actor AND pm."moduleName" = 'machine_control' AND pm."canEdit" = true
                    AND (pm."expiresAt" IS NULL OR pm."expiresAt" > GREATEST(LOCALTIMESTAMP, (now() AT TIME ZONE 'UTC')))) THEN
    RAISE EXCEPTION '%: actor % holds no machine_control edit grant in force', p_what, p_actor USING ERRCODE = 'check_violation';
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.edge_human_resolver_authorize(integer, text) FROM PUBLIC;

-- The factory scope of a scoped (non-admin) actor — resolveTenantFactoryScope: factories whose code is one of the actor's
-- factory assignments or whose corporateCode is one of the actor's corporate assignments. A device with no factory chain is
-- outside every scope.
CREATE OR REPLACE FUNCTION public.edge_actor_in_factory_scope(p_actor integer, p_factory integer) RETURNS boolean
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF p_factory IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM public."factories" f
                  WHERE f."id" = p_factory
                    AND (EXISTS (SELECT 1 FROM public."user_factory_assignments" ufa WHERE ufa."userId" = p_actor AND ufa."factoryCode" = f."code")
                         OR (f."corporateCode" IS NOT NULL
                             AND EXISTS (SELECT 1 FROM public."user_corporate_assignments" uca WHERE uca."userId" = p_actor AND uca."corporateCode" = f."corporateCode"))));
END $$;
REVOKE ALL ON FUNCTION public.edge_actor_in_factory_scope(integer, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.edge_stop_resolve(p_request integer, p_actor integer, p_resolution text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  q record;
  unrestricted boolean;
BEGIN
  unrestricted := public.edge_human_resolver_authorize(p_actor, 'edge_stop_resolve'); -- fix review 12 (R-10-bm)
  IF p_resolution IS NULL OR length(btrim(p_resolution)) < 3 THEN
    RAISE EXCEPTION 'edge_stop_resolve: a resolution (at least 3 characters) is required' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO q FROM public."robot_motion_lock_requests" x WHERE x."id" = p_request FOR UPDATE;
  IF NOT FOUND OR q."kind" <> 'stop' OR q."outcome" IS NULL OR q."outcome" NOT IN ('refused', 'failed') OR q."resolvedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'edge_stop_resolve: request % is not an unresolved refused / failed STOP', p_request USING ERRCODE = 'check_violation';
  END IF;
  IF NOT unrestricted AND NOT public.edge_actor_in_factory_scope(p_actor, public.edge_device_factory_id(q."robotId", q."adapterId")) THEN
    RAISE EXCEPTION 'edge_stop_resolve: request % is outside actor %''s factory scope', p_request, p_actor USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public."robot_motion_lock_requests" SET "resolvedAt" = now(), "resolvedBy" = p_actor, "resolution" = left(btrim(p_resolution), 2000)
   WHERE "id" = p_request;
END $$;
REVOKE ALL ON FUNCTION public.edge_stop_resolve(integer, integer, text) FROM PUBLIC;

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
  INSERT INTO public."robot_motion_locks" AS l ("robotId", "reasonCode", "detail", "generation", "authority", "authorityNodeId", "ownerEpoch", "lockedAt", "writerInstanceId")
    VALUES (p_robot, left(p_reason, 64), p_detail, p_generation, 'edge:' || p_node, p_node, p_epoch, now(), md5('edge:' || p_node)::uuid)
  ON CONFLICT ("robotId") DO UPDATE SET "reasonCode" = EXCLUDED."reasonCode", "detail" = EXCLUDED."detail", "generation" = EXCLUDED."generation",
    "lockedAt" = EXCLUDED."lockedAt", "writerInstanceId" = COALESCE(l."writerInstanceId", EXCLUDED."writerInstanceId")
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

-- ── fix review 10 (ruling R-10-bj): resolving a crash-ORPHANED OT write intent ─────────────────────────────────────────────
-- A write intent (command_log status 'sent', ackValue.ledger 'intent') whose process crashed mid-write has no RESULT row, so
-- it stays "in flight" forever (the owner-change guard above keeps blocking — fail-closed). ot_write_intent_resolve writes its
-- outcome-UNKNOWN result ('timeout', ackValue {ledger 'result', intentId, outcome 'unknown', resolvedByOperator, resolution})
-- EXACTLY once, for an ACTIVE user with a reason, only when the intent is at least 10 minutes old (a younger one may still be
-- in flight — the bound of Group F's admin action, INTENT_RESOLVE_MIN_AGE_MINUTES). avi_app KEEPS its INSERT on command_log
-- (the device-stage writer, otDeviceWrite / commandDispatcher, writes intents and results directly); a trigger refuses a
-- direct (non-owner) INSERT of a manual-resolution row and, for every writer, a SECOND result row of the same intent.
CREATE OR REPLACE FUNCTION public.ot_write_intent_resolve(p_intent integer, p_actor integer, p_reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  i record;
  why text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  rid integer;
  unrestricted boolean;
BEGIN
  unrestricted := public.edge_human_resolver_authorize(p_actor, 'ot_write_intent_resolve'); -- fix review 12 (R-10-bm)
  IF why IS NULL OR length(why) < 3 THEN
    RAISE EXCEPTION 'ot_write_intent_resolve: a reason (at least 3 characters) is required' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO i FROM public."command_log" c WHERE c."id" = p_intent FOR UPDATE;
  IF NOT FOUND OR i."status"::text <> 'sent' OR i."ackValue" ->> 'ledger' IS DISTINCT FROM 'intent' THEN
    RAISE EXCEPTION 'ot_write_intent_resolve: % is not a write intent', p_intent USING ERRCODE = 'check_violation';
  END IF;
  IF NOT unrestricted AND NOT public.edge_actor_in_factory_scope(p_actor, public.edge_device_factory_id(NULL, i."adapterId")) THEN
    RAISE EXCEPTION 'ot_write_intent_resolve: write intent % is outside actor %''s factory scope', p_intent, p_actor USING ERRCODE = 'check_violation';
  END IF;
  -- fix review 11 (R-10-bk): the SAME per-intent lock every result INSERT takes (trg_command_log_result_guard) ⇒ a device-stage
  -- result in flight is waited for, then seen (READ COMMITTED: the next query takes a fresh snapshot).
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ot.intent.result'), i."id");
  IF EXISTS (SELECT 1 FROM public."command_log" r WHERE r."ackValue" ->> 'ledger' = 'result'
              AND r."ackValue" ->> 'intentId' = i."id"::text) THEN
    RAISE EXCEPTION 'ot_write_intent_resolve: write intent % already has a result', p_intent USING ERRCODE = 'check_violation';
  END IF;
  IF i."createdAt" > LOCALTIMESTAMP - interval '10 minutes' THEN
    RAISE EXCEPTION 'ot_write_intent_resolve: write intent % is younger than 10 minutes — it may still be in flight', p_intent USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public."command_log" ("actionId", "adapterId", "machineId", "tagKey", "address", "commandType", "requestedValue", "requestedBy",
      "confirmedBy", "status", "triggerKind", "interlockRuleId", "interlockEventId", "approvedBy", "correlation_id", "errorText", "ackValue", "idempotencyKey")
    VALUES (i."actionId", i."adapterId", i."machineId", i."tagKey", i."address", i."commandType", i."requestedValue", i."requestedBy",
      p_actor, 'timeout', i."triggerKind", i."interlockRuleId", i."interlockEventId", i."approvedBy", i."correlation_id",
      left('OUTCOME_UNKNOWN_RESOLVED_BY_OPERATOR: ' || why, 2000),
      jsonb_build_object('ledger', 'result', 'intentId', i."id", 'outcome', 'unknown', 'resolvedByOperator', p_actor, 'resolution', left(why, 2000)),
      left(CASE WHEN i."idempotencyKey" LIKE 'intent:%' THEN substr(i."idempotencyKey", 8) ELSE 'resolve:' || i."id" END, 128))
  RETURNING "id" INTO rid;
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.ot_write_intent_resolve(integer, integer, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.command_log_result_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  tbl_owner name;
  iid integer;
  prior record;
BEGIN
  IF NEW."ackValue" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT pg_catalog.pg_get_userbyid(c.relowner) INTO tbl_owner FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID;
  -- fix review 11: evidence of a late result is made only below (from a real result row), never inserted directly.
  IF NEW."ackValue" ->> 'ledger' = 'late_result' AND current_user IS DISTINCT FROM tbl_owner THEN
    RAISE EXCEPTION 'command_log: a late_result row is recorded only by the result guard' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."ackValue" ->> 'ledger' IS DISTINCT FROM 'result' THEN
    RETURN NEW;
  END IF;
  IF current_user IS DISTINCT FROM tbl_owner AND (NEW."ackValue" ? 'resolvedByOperator' OR NEW."ackValue" ->> 'outcome' = 'unknown') THEN
    RAISE EXCEPTION 'command_log: an orphaned write intent is resolved only via ot_write_intent_resolve' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (NEW."ackValue" ? 'intentId') THEN
    RETURN NEW;
  END IF;
  IF (NEW."ackValue" ->> 'intentId') IS NULL OR (NEW."ackValue" ->> 'intentId') !~ '^[0-9]{1,9}$' THEN
    RAISE EXCEPTION 'command_log: ackValue.intentId must be a command_log id' USING ERRCODE = 'check_violation';
  END IF;
  iid := (NEW."ackValue" ->> 'intentId')::integer;
  -- fix review 11 (R-10-bk): every writer of a result of this intent (device stage, ot_write_intent_resolve) serializes here;
  -- after the lock the query below sees the other writer's committed row. ux_command_log_one_result_per_intent is the backstop.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ot.intent.result'), iid);
  SELECT r."id", (r."ackValue" ? 'resolvedByOperator') AS manual INTO prior
    FROM public."command_log" r WHERE r."ackValue" ->> 'ledger' = 'result' AND r."ackValue" ->> 'intentId' = iid::text
   ORDER BY r."id" LIMIT 1;
  IF FOUND THEN
    IF prior.manual AND NOT (NEW."ackValue" ? 'resolvedByOperator') THEN
      -- a REAL result after a manual "outcome unknown" resolution: never lost — kept as evidence (the INSERT succeeds, so the
      -- device-stage writer is unchanged), linked to the resolution; it holds the adapter's owner change until reviewed.
      NEW."ackValue" := NEW."ackValue" || jsonb_build_object('ledger', 'late_result', 'lateAfterResolutionId', prior."id");
      NEW."idempotencyKey" := left('late:' || NEW."id" || ':' || COALESCE(NEW."idempotencyKey", ''), 128);
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'command_log: write intent % already has a result', iid USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.command_log_result_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_command_log_result_guard ON "command_log";
CREATE TRIGGER trg_command_log_result_guard BEFORE INSERT ON "command_log"
  FOR EACH ROW EXECUTE FUNCTION public.command_log_result_guard();

-- ── fix review 11 (ruling R-10-bk): exactly ONE result per intent, in the DB; a late real result is reviewed by a person ───
-- The backstop of the per-intent lock above (e.g. a REPEATABLE READ writer that cannot see the other's row). Refused if the
-- table already holds two results of one intent — find them first (none on _test when this was written).
CREATE UNIQUE INDEX IF NOT EXISTS "ux_command_log_one_result_per_intent" ON "command_log" (("ackValue" ->> 'intentId'))
  WHERE "ackValue" ->> 'ledger' = 'result' AND "ackValue" ? 'intentId';

CREATE TABLE IF NOT EXISTS "ot_write_late_result_reviews" (
  "lateResultId" integer PRIMARY KEY REFERENCES "command_log"("id"),
  "reviewedBy" integer NOT NULL REFERENCES "users"("id"),
  "note" text NOT NULL,
  "reviewedAt" timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE "ot_write_late_result_reviews" IS
  'doc 81 Dot 10 A (0374, fix review 11 R-10-bk): WORM - a person saw a device write result (command_log ledger late_result) that landed after a manual outcome-unknown resolution; until then the adapter owner change is refused.';
CREATE OR REPLACE FUNCTION public.ot_write_late_result_reviews_worm() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'ot_write_late_result_reviews is append-only (WORM)' USING ERRCODE = 'check_violation';
END $$;
REVOKE ALL ON FUNCTION public.ot_write_late_result_reviews_worm() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_ot_write_late_result_reviews_worm ON "ot_write_late_result_reviews";
CREATE TRIGGER trg_ot_write_late_result_reviews_worm BEFORE UPDATE OR DELETE ON "ot_write_late_result_reviews"
  FOR EACH ROW EXECUTE FUNCTION public.ot_write_late_result_reviews_worm();
DROP TRIGGER IF EXISTS trg_ot_write_late_result_reviews_worm_truncate ON "ot_write_late_result_reviews";
CREATE TRIGGER trg_ot_write_late_result_reviews_worm_truncate BEFORE TRUNCATE ON "ot_write_late_result_reviews"
  FOR EACH STATEMENT EXECUTE FUNCTION public.ot_write_late_result_reviews_worm();

CREATE OR REPLACE FUNCTION public.ot_write_late_result_review(p_late_result integer, p_actor integer, p_note text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  why text := NULLIF(btrim(COALESCE(p_note, '')), '');
  unrestricted boolean;
  lr record;
BEGIN
  unrestricted := public.edge_human_resolver_authorize(p_actor, 'ot_write_late_result_review'); -- fix review 12 (R-10-bm)
  IF why IS NULL OR length(why) < 3 THEN
    RAISE EXCEPTION 'ot_write_late_result_review: a note (at least 3 characters) is required' USING ERRCODE = 'check_violation';
  END IF;
  SELECT c."adapterId" AS "adapterId" INTO lr FROM public."command_log" c WHERE c."id" = p_late_result AND c."ackValue" ->> 'ledger' = 'late_result';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ot_write_late_result_review: % is not a late device write result', p_late_result USING ERRCODE = 'check_violation';
  END IF;
  IF NOT unrestricted AND NOT public.edge_actor_in_factory_scope(p_actor, public.edge_device_factory_id(NULL, lr."adapterId")) THEN
    RAISE EXCEPTION 'ot_write_late_result_review: % is outside actor %''s factory scope', p_late_result, p_actor USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public."ot_write_late_result_reviews" ("lateResultId", "reviewedBy", "note")
    VALUES (p_late_result, p_actor, left(why, 2000)) ON CONFLICT ("lateResultId") DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ot_write_late_result_review: % was already reviewed', p_late_result USING ERRCODE = 'check_violation';
  END IF;
  RETURN p_late_result;
END $$;
REVOKE ALL ON FUNCTION public.ot_write_late_result_review(integer, integer, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    GRANT EXECUTE ON FUNCTION public.edge_motion_lock_apply(integer, integer, bigint, integer, text, text) TO avi_app;
    GRANT EXECUTE ON FUNCTION public.edge_motion_lock_clear(integer, integer, bigint, integer) TO avi_app;
    GRANT EXECUTE ON FUNCTION public.edge_stop_ack_central(integer, text, bigint) TO avi_app; -- fix review 9 (R-10-ba): (request, outcome, execution)
    GRANT EXECUTE ON FUNCTION public.edge_stop_record_central_execution(text, integer, boolean, text) TO avi_app; -- fix review 9
    GRANT EXECUTE ON FUNCTION public.ot_write_intent_resolve(integer, integer, text) TO avi_app; -- fix review 10 (R-10-bj)
    GRANT EXECUTE ON FUNCTION public.ot_write_late_result_review(integer, integer, text) TO avi_app; -- fix review 11 (R-10-bk)
    REVOKE ALL ON "ot_write_late_result_reviews" FROM avi_app; -- evidence of a person's review: read-only for the app
    GRANT SELECT ON "ot_write_late_result_reviews" TO avi_app;
    REVOKE ALL ON "central_stop_executions" FROM avi_app;
    GRANT SELECT ON "central_stop_executions" TO avi_app;
    REVOKE ALL ON SEQUENCE "central_stop_executions_id_seq" FROM avi_app;
    GRANT EXECUTE ON FUNCTION public.edge_stop_ack_edge(integer, integer, integer, integer, bigint, text, boolean, integer) TO avi_app; -- fix review 3
    GRANT EXECUTE ON FUNCTION public.edge_stop_resolve(integer, integer, text) TO avi_app; -- fix review 3
    REVOKE ALL ON "edge_stop_ack_refusals" FROM avi_app; -- fix review 4 (R-10-ah): evidence, read-only for the app
    GRANT SELECT ON "edge_stop_ack_refusals" TO avi_app;
    REVOKE ALL ON SEQUENCE "edge_stop_ack_refusals_id_seq" FROM avi_app;
    REVOKE ALL ON public.device_pending_stops FROM avi_app;
    GRANT SELECT ON public.device_pending_stops TO avi_app;
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
