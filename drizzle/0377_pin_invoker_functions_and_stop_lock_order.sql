-- ════════════════════════════════════════════════════════════════════════════
-- 0377 — doc 81 Đợt 11 task H: (A) THE LAST SIX UNPINNED public FUNCTIONS (Đợt 10 Group A fix round 3, N4 backlog) and
--        (B) ONE LOCK ORDER — DEVICE ROW FIRST, THEN THE STOP REQUEST — for edge_stop_ack_edge / edge_stop_ack_central /
--        edge_stop_resolve against the owner change (Đợt 10 re-review N3, F-B2-4)
-- ════════════════════════════════════════════════════════════════════════════
--
-- (A) INVENTORY, measured on _test 2026-10-14 (catalog: every function of schema public that is not an extension member — 55 —
--   whose proconfig is not exactly {search_path=pg_catalog, public, pg_temp}): exactly the six of the Đợt 10 backlog, all
--   INVOKER, owner aoi, ACL default (PUBLIC EXECUTE):
--     app_tenant_allows(text,text)                  sql      — in 82 RLS policies (41 tables)        0122 / 0125 / … / 0327
--     factory_timezone() · db_storage_timezone()    sql      — to_factory_time; app SQL                0174
--     to_factory_time(timestamp)                    sql      — hourly_yield_cache, BI day buckets      0174
--     refresh_qw_caches()                           plpgsql  — materializedViewRefreshService (avi_app) 0111 / 0174
--     ensure_measurement_samples_partition(int,int) plpgsql  — server/db/product.ts (avi_app)           0092
--   Measured shadow holes (functionSearchPath0377.dot11.db.test.ts, RED before this file): a TEMP table `machine_status_latest`
--   made refresh_qw_caches() fail (0A000); a TEMP `measurement_samples` made ensure_measurement_samples_partition() fail (21000)
--   and, as owner, created NO partition; a schema placed before pg_catalog with its own current_setting() / `=` changed what
--   app_tenant_allows / factory_timezone / db_storage_timezone / to_factory_time answer.
--
--   • the two plpgsql functions: SAME body, every relation `public.` (dynamic DDL `public.%I`; the catalog lookups bound to
--     the public namespace), `SET search_path = pg_catalog, public, pg_temp` (pg_temp LAST).
--   • the four sql functions: NOT given a SET clause — a function with proconfig is never INLINED by the planner. Measured on
--     _test (300 000 rows, owner tx rolled back — scratchpad dot11-H/inline.mjs): app_tenant_allows 117 → 588 ms, to_factory_time
--     105 → 5 060 ms (×48: three GUC push/pops per row). Instead each body names EVERY function `pg_catalog.` / `public.` and
--     every operator `OPERATOR(pg_catalog.…)` (NULLIF — whose `=` is looked up through the search_path — becomes the equal CASE),
--     so the answer no longer depends on the caller's search_path at all, and the planner still inlines them. Same semantics
--     (truth table + time-zone cases pinned by the test). The 0327 branch `p_factory IS NULL AND p_corporate IS NULL` is kept
--     verbatim (scripts/migrationEffectiveProbes.mjs reads it).
--   • GRANTS: unchanged on purpose — CREATE OR REPLACE keeps the ACL (default: PUBLIC EXECUTE). RLS policies evaluate
--     app_tenant_allows as whichever role reads the table; the app (avi_app) calls the other five. The pin censuses list all six
--     as PUBLIC-executable by design, the four sql ones as INLINE_BY_DESIGN (no SET).
--
-- (B) LOCK ORDER. The owner change (UPDATE robots / device_adapters SET "edgeNodeId") locks the DEVICE row before its triggers
--   run; device_owner_stop_carry then locks the device's pending STOP requests FOR UPDATE. It cannot take them in any other
--   order. 0374's ack functions locked the REQUEST first, then the device FOR SHARE ⇒ a 40P01 deadlock, measured RED on _test
--   (stopAckLockOrder.dot11.db.test.ts: 24/25 and 22/25 iterations 40P01, every staged case 40P01). THE ORDER, for every writer:
--     1. the device row FOR SHARE (robots or device_adapters — a request names exactly one; its target columns are write-once,
--        so an unlocked read of them names the right device);
--     2. then the request row(s) FOR UPDATE (several: ascending id).
--   Re-created below with that order and otherwise the SAME bodies / results: edge_stop_ack_central, edge_stop_ack_edge (both
--   branches), edge_stop_resolve. The app follows it too (same commit): lockAckRequestsInOrder (edge batch prelock),
--   resolvePendingStop and the central STOP sweep take the device rows FOR SHARE before any request row.
--   L-7: a STOP ack still waits only on a holder of the DEVICE row (FOR SHARE conflicts only with an UPDATE of that row — the
--   bounded owner change, a status / admin write); it never waits on a request row held across that wait.
--
-- ⚠ DDL runs as owner `aoi`: `node scripts/apply-migration-0377.mjs --test-only` (dev: `--dev-only`, the owner decides; no flag ⇒
--   refused — R-3-g). Requires 0374 (+ 0376). Idempotent. ⚠ Re-applying 0374 AFTER this file would put the request-first ack
--   bodies back: apply-migration-0374 refuses that unless --then-0377 (scripts/migration0377Guard.mjs — measured: a test:serial
--   run re-applying 0374 reverted the lock order on _test); re-applying 0092 / 0111 / 0122 / 0125 / 0142–0148 / 0150 / 0153 / 0154 / 0156 / 0159 / 0169 / 0174 / 0327
--   puts an unpinned / unqualified body back — refused the same way by apply-migration-0327 and migrate-standalone (fix 1,
--   R-11-f; migrate-standalone also re-appends 0377 for --then-0376); otherwise re-apply 0377 afterwards (the catalog census functionSearchPath0377.dot11 and stopAckLockOrder.dot11 turn red).
-- ROLLBACK: re-apply 0374 (ack functions) and 0327 / 0174 / 0111 / 0092 (the six bodies).
--

-- ══ (A) the six ════════════════════════════════════════════════════════════════════════════════════════════════════════

-- 0327 body, every call / operator qualified; NO SET (inlined into 82 RLS policies)
CREATE OR REPLACE FUNCTION public.app_tenant_allows(p_factory text, p_corporate text)
  RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(pg_catalog.current_setting('app.tenant_rls_active', true), 'off') OPERATOR(pg_catalog.<>) 'on'   -- trơ khi chưa kích hoạt
      OR coalesce(pg_catalog.current_setting('app.tenant_bypass',     true), 'off') OPERATOR(pg_catalog.=)  'on'   -- admin / dịch vụ
      -- ── 0327: hàng KHÔNG mang mã tenant nào = dữ liệu dùng chung ⇒ CHO XEM ──
      OR (p_factory IS NULL AND p_corporate IS NULL)
      OR (p_factory   IS NOT NULL AND p_factory   OPERATOR(pg_catalog.=) ANY (pg_catalog.string_to_array(coalesce(pg_catalog.current_setting('app.tenant_factory_codes',   true), ''), ',')))
      OR (p_corporate IS NOT NULL AND p_corporate OPERATOR(pg_catalog.=) ANY (pg_catalog.string_to_array(coalesce(pg_catalog.current_setting('app.tenant_corporate_codes', true), ''), ',')))
$$;

-- 0174 bodies; NULLIF(x, '') ≡ CASE WHEN x = '' THEN NULL ELSE x END with the operator qualified; NO SET (inlined)
CREATE OR REPLACE FUNCTION public.factory_timezone() RETURNS text
LANGUAGE sql STABLE AS $factory_tz$
  SELECT COALESCE(CASE WHEN pg_catalog.current_setting('app.factory_tz', true) OPERATOR(pg_catalog.=) '' THEN NULL
                       ELSE pg_catalog.current_setting('app.factory_tz', true) END, 'Asia/Ho_Chi_Minh');
$factory_tz$;

CREATE OR REPLACE FUNCTION public.db_storage_timezone() RETURNS text
LANGUAGE sql STABLE AS $storage_tz$
  SELECT COALESCE(CASE WHEN pg_catalog.current_setting('app.factory_storage_tz', true) OPERATOR(pg_catalog.=) '' THEN NULL
                       ELSE pg_catalog.current_setting('app.factory_storage_tz', true) END, 'UTC');
$storage_tz$;

-- 0174 body unchanged (already qualified: AT TIME ZONE is pg_catalog.timezone()); re-created so its last definition is here
CREATE OR REPLACE FUNCTION public.to_factory_time(ts timestamp) RETURNS timestamp
LANGUAGE sql STABLE AS $to_factory$
  SELECT (ts AT TIME ZONE public.db_storage_timezone()) AT TIME ZONE public.factory_timezone();
$to_factory$;

-- 0174 body, views public.-qualified, pinned
CREATE OR REPLACE FUNCTION public.refresh_qw_caches() RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.machine_status_latest;
  EXCEPTION WHEN OTHERS THEN
    REFRESH MATERIALIZED VIEW public.machine_status_latest;
  END;
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.hourly_yield_cache;
  EXCEPTION WHEN OTHERS THEN
    REFRESH MATERIALIZED VIEW public.hourly_yield_cache;
  END;
END;
$$;

-- 0092 body: the catalog lookups bound to the public namespace, the dynamic DDL names public.%I; pinned
CREATE OR REPLACE FUNCTION public.ensure_measurement_samples_partition(p_year integer, p_month integer) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  partition_name text;
  start_ts text;
  end_ts text;
BEGIN
  -- Bảng chưa partition (vd bị giữ nguyên vì đã có dữ liệu) → no-op an toàn,
  -- tránh lỗi "is not partitioned" khi cron/migration gọi hàm này.
  IF (SELECT c.relkind FROM pg_catalog.pg_class c
       WHERE c.relname = 'measurement_samples' AND c.relnamespace = 'public'::pg_catalog.regnamespace) IS DISTINCT FROM 'p' THEN
    RETURN;
  END IF;
  partition_name := format('measurement_samples_y%sm%s',
    to_char(p_year, 'FM0000'),
    to_char(p_month, 'FM00'));
  start_ts := format('%s-%s-01 00:00:00',
    to_char(p_year, 'FM0000'),
    to_char(p_month, 'FM00'));
  end_ts := format('%s-%s-01 00:00:00',
    to_char(CASE WHEN p_month = 12 THEN p_year + 1 ELSE p_year END, 'FM0000'),
    to_char(CASE WHEN p_month = 12 THEN 1 ELSE p_month + 1 END, 'FM00'));
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                  WHERE c.relname = partition_name AND c.relnamespace = 'public'::pg_catalog.regnamespace) THEN
    EXECUTE format(
      'CREATE TABLE public.%I PARTITION OF public.measurement_samples FOR VALUES FROM (%L) TO (%L)',
      partition_name, start_ts, end_ts
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I ("pointDefId","sampledAt")',
      'idx_' || partition_name || '_point_time', partition_name
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I ("machineId","sampledAt")',
      'idx_' || partition_name || '_machine_time', partition_name
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I ("serialNumber")',
      'idx_' || partition_name || '_serial', partition_name
    );
  END IF;
END;
$$;

-- ══ (B) one lock order: the device row FOR SHARE, then the request FOR UPDATE ═══════════════════════════════════════════

-- 0374 (fix review 9, R-10-ba) — same body; only the lock order changed (device first)
CREATE OR REPLACE FUNCTION public.edge_stop_ack_central(p_request integer, p_outcome text, p_execution bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  q record;
  ex record;
  tgt record;
  cur_owner integer;
  found_device boolean := false;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('done', 'failed') THEN
    RAISE EXCEPTION 'edge_stop_ack_central: outcome must be done or failed (got %)', p_outcome USING ERRCODE = 'check_violation';
  END IF;
  -- 0377 lock order: the device row FOR SHARE first (the request's target columns are write-once), then the request FOR UPDATE
  SELECT x."robotId", x."adapterId" INTO tgt FROM public."robot_motion_lock_requests" x WHERE x."id" = p_request;
  IF FOUND THEN
    IF tgt."robotId" IS NOT NULL THEN
      SELECT r."edgeNodeId" INTO cur_owner FROM public."robots" r WHERE r."id" = tgt."robotId" FOR SHARE;
    ELSE
      SELECT a."edgeNodeId" INTO cur_owner FROM public."device_adapters" a WHERE a."id" = tgt."adapterId" FOR SHARE;
    END IF;
    found_device := FOUND;
  END IF;
  SELECT * INTO q FROM public."robot_motion_lock_requests" x WHERE x."id" = p_request FOR UPDATE;
  IF NOT FOUND OR q."kind" <> 'stop' OR q."ackedAt" IS NOT NULL OR q."resolvedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'edge_stop_ack_central: request % is not a pending STOP', p_request USING ERRCODE = 'check_violation';
  END IF;
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

-- 0374 (fix reviews 3 / 4 / 7 / 9) — same body; only the lock order changed (device first) in both branches
CREATE OR REPLACE FUNCTION public.edge_stop_ack_edge(p_request integer, p_node integer, p_robot integer, p_adapter integer,
  p_owner_epoch bigint, p_outcome text, p_unsigned boolean, p_generation integer DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  q record;
  tgt record;
  cur_owner integer;
  cur_epoch bigint;
  why text;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('done', 'refused', 'failed') THEN
    IF p_outcome = 'notOwnedHere' AND p_node IS NOT NULL AND p_owner_epoch IS NOT NULL AND ((p_robot IS NULL) <> (p_adapter IS NULL)) THEN
      -- 0377 lock order: the device row FOR SHARE first, then the request FOR UPDATE
      SELECT x."robotId", x."adapterId" INTO tgt FROM public."robot_motion_lock_requests" x WHERE x."id" = p_request;
      IF FOUND AND tgt."robotId" IS NOT DISTINCT FROM p_robot AND tgt."adapterId" IS NOT DISTINCT FROM p_adapter THEN
        IF tgt."robotId" IS NOT NULL THEN
          SELECT r."edgeNodeId", r."ownerEpoch" INTO cur_owner, cur_epoch FROM public."robots" r WHERE r."id" = tgt."robotId" FOR SHARE;
        ELSE
          SELECT a."edgeNodeId", a."ownerEpoch" INTO cur_owner, cur_epoch FROM public."device_adapters" a WHERE a."id" = tgt."adapterId" FOR SHARE;
        END IF;
        SELECT * INTO q FROM public."robot_motion_lock_requests" x WHERE x."id" = p_request FOR UPDATE;
        IF FOUND AND q."kind" = 'stop' AND q."ackedAt" IS NULL AND q."resolvedAt" IS NULL AND q."ownerCannotListAt" IS NULL
           AND q."robotId" IS NOT DISTINCT FROM p_robot AND q."adapterId" IS NOT DISTINCT FROM p_adapter
           AND cur_owner = p_node AND cur_epoch = p_owner_epoch THEN
          UPDATE public."robot_motion_lock_requests" SET "ownerCannotListAt" = now(), "ownerCannotListBy" = p_node WHERE "id" = p_request;
        END IF;
      END IF;
    END IF;
    INSERT INTO public."edge_stop_ack_refusals" ("requestId", "edgeNodeId", "robotId", "adapterId", "ownerEpoch", "outcome", "viaUnsigned", "reason")
      VALUES (p_request, p_node, p_robot, p_adapter, p_owner_epoch, left(COALESCE(p_outcome, 'null'), 16), p_unsigned,
              CASE WHEN p_outcome = 'notOwnedHere' THEN 'not_owned_here' ELSE 'bad_outcome' END);
    RETURN false;
  END IF;
  IF p_node IS NULL OR p_owner_epoch IS NULL OR p_unsigned IS NULL OR ((p_robot IS NULL) = (p_adapter IS NULL)) THEN
    INSERT INTO public."edge_stop_ack_refusals" ("requestId", "edgeNodeId", "robotId", "adapterId", "ownerEpoch", "outcome", "viaUnsigned", "reason")
      VALUES (p_request, p_node, p_robot, p_adapter, p_owner_epoch, p_outcome, p_unsigned, 'malformed');
    RETURN false;
  END IF;
  -- 0377 lock order: the device row FOR SHARE first (target columns are write-once), then the request FOR UPDATE
  SELECT x."robotId", x."adapterId" INTO tgt FROM public."robot_motion_lock_requests" x WHERE x."id" = p_request;
  IF FOUND THEN
    IF tgt."robotId" IS NOT NULL THEN
      SELECT r."edgeNodeId", r."ownerEpoch" INTO cur_owner, cur_epoch FROM public."robots" r WHERE r."id" = tgt."robotId" FOR SHARE;
    ELSE
      SELECT a."edgeNodeId", a."ownerEpoch" INTO cur_owner, cur_epoch FROM public."device_adapters" a WHERE a."id" = tgt."adapterId" FOR SHARE;
    END IF;
  END IF;
  SELECT * INTO q FROM public."robot_motion_lock_requests" x WHERE x."id" = p_request FOR UPDATE;
  IF NOT FOUND THEN
    why := 'not_pending';
  ELSE
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

-- 0374 (fix reviews 3 / 12) — same body; the device row FOR SHARE before the request FOR UPDATE
CREATE OR REPLACE FUNCTION public.edge_stop_resolve(p_request integer, p_actor integer, p_resolution text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  q record;
  tgt record;
  unrestricted boolean;
BEGIN
  unrestricted := public.edge_human_resolver_authorize(p_actor, 'edge_stop_resolve'); -- fix review 12 (R-10-bm)
  IF p_resolution IS NULL OR length(btrim(p_resolution)) < 3 THEN
    RAISE EXCEPTION 'edge_stop_resolve: a resolution (at least 3 characters) is required' USING ERRCODE = 'check_violation';
  END IF;
  -- 0377 lock order: the device row FOR SHARE first (target columns are write-once), then the request FOR UPDATE
  SELECT x."robotId", x."adapterId" INTO tgt FROM public."robot_motion_lock_requests" x WHERE x."id" = p_request;
  IF FOUND THEN
    IF tgt."robotId" IS NOT NULL THEN
      PERFORM 1 FROM public."robots" r WHERE r."id" = tgt."robotId" FOR SHARE;
    ELSE
      PERFORM 1 FROM public."device_adapters" a WHERE a."id" = tgt."adapterId" FOR SHARE;
    END IF;
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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    GRANT EXECUTE ON FUNCTION public.edge_stop_ack_central(integer, text, bigint) TO avi_app;
    GRANT EXECUTE ON FUNCTION public.edge_stop_ack_edge(integer, integer, integer, integer, bigint, text, boolean, integer) TO avi_app;
    GRANT EXECUTE ON FUNCTION public.edge_stop_resolve(integer, integer, text) TO avi_app;
  END IF;
END $$;
