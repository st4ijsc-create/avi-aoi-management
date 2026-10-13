#!/usr/bin/env node
/**
 * 0377 — doc 81 Đợt 11 task H: (A) the last six unpinned public functions (Đợt 10 Group A fix round 3, N4 backlog) and (B) ONE
 * lock order (device row FIRST, then the STOP request) for edge_stop_ack_edge / edge_stop_ack_central / edge_stop_resolve against
 * the owner change. Applies `drizzle/0377_pin_invoker_functions_and_stop_lock_order.sql` as owner `aoi`, then VERIFIES as
 * `avi_app` (pattern 0363–0376, shared runner apply-migration-dot10-common.mjs — exactly one target flag, lock_timeout 5 s,
 * statement_timeout 60 s, the verifying role must be neither superuser nor BYPASSRLS, `__applied_migrations` ledger row):
 *   (a) catalog: the 3 STOP functions pinned, SECURITY DEFINER, avi_app EXECUTE, no PUBLIC (verifyFunctionHygiene); the 2
 *       plpgsql functions pinned; the 4 sql functions WITHOUT a SET clause (inline by design) and really inlined (EXPLAIN as
 *       avi_app); all 6 keep PUBLIC EXECUTE (ACL untouched); the 0327 branch is in app_tenant_allows; the census: EVERY
 *       non-extension public function is pinned exactly, or one of the 4 inline-by-design; each STOP function locks the device
 *       row (FOR SHARE) before the request (FOR UPDATE) in its source;
 *   (b) behaviour in an ALWAYS-rolled-back transaction as avi_app: shadow TEMP tables never steer refresh_qw_caches /
 *       ensure_measurement_samples_partition; the 0327 truth table + time-zone answers; the STOP functions answer as before
 *       (edge ack done ⇒ true, refused ⇒ true, an epoch mismatch ⇒ false + evidence 'epoch_mismatch', resolve by an admin ⇒ ok,
 *       central ack against a recorded execution ⇒ ok, central ack of an edge-owned device ⇒ 23514); 0 probe rows left;
 *   (c) `__applied_migrations` has exactly 1 row for this file.
 *
 *   node scripts/apply-migration-0377.mjs --test-only | --dev-only | --both   (NO flag ⇒ refused — R-3-g)
 */
import { expectExact, maLoi, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

const PIN = "search_path=pg_catalog, public, pg_temp";
const INLINE = ["app_tenant_allows", "factory_timezone", "db_storage_timezone", "to_factory_time"];
const PINNED_INVOKER = ["refresh_qw_caches", "ensure_measurement_samples_partition"];
const STOP_FNS = ["edge_stop_ack_central", "edge_stop_ack_edge", "edge_stop_resolve"];

await runMigration({
  file: "0377_pin_invoker_functions_and_stop_lock_order.sql",
  tag: "[0377]",
  hygiene: { publicByDesign: new Set([...INLINE, ...PINNED_INVOKER]), inlineByDesign: new Set(INLINE) },
  async verify({ appSql, log }) {
    // (a) catalog
    const census = await appSql`
      SELECT p.proname AS name, p.oid::regprocedure::text AS sig, l.lanname AS lang, p.prosecdef AS definer, p.proconfig AS cfg
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
       WHERE n.nspname = 'public'
         AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')`;
    const off = census.filter((r) =>
      INLINE.includes(r.name) ? !(r.lang === "sql" && !r.definer && r.cfg === null) : JSON.stringify(r.cfg) !== JSON.stringify([PIN]),
    );
    if (off.length) throw new Error(`(a) census: ${off.map((r) => `${r.sig} ${JSON.stringify(r.cfg)}`).join("; ")}`);
    const plan = async (q) => (await appSql.unsafe(`EXPLAIN (VERBOSE, COSTS OFF) ${q}`)).map((r) => String(Object.values(r)[0])).join("\n");
    const inlined = {
      tenant: !/app_tenant_allows\(/.test(await plan(`SELECT public.app_tenant_allows(g::text, NULL) FROM generate_series(1, 3) g`)),
      tz: !/to_factory_time\(|factory_timezone\(|db_storage_timezone\(/.test(await plan(`SELECT public.to_factory_time(LOCALTIMESTAMP - make_interval(secs => g)) FROM generate_series(1, 3) g`)),
    };
    expectExact("(a) inlined", inlined, { tenant: true, tz: true });
    const [def] = await appSql`SELECT pg_get_functiondef('public.app_tenant_allows(text,text)'::regprocedure) AS d`;
    if (!/p_factory\s+IS\s+NULL\s+AND\s+p_corporate\s+IS\s+NULL/i.test(def.d)) throw new Error("(a) app_tenant_allows lost the 0327 branch");
    for (const f of STOP_FNS) {
      const [{ d }] = await appSql`SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = ${f}`;
      // every request lock FOR UPDATE is preceded (in the source) by a device FOR SHARE
      const share = d.indexOf("FOR SHARE");
      const update = d.indexOf("FOR UPDATE");
      if (share < 0 || update < 0 || share > update) throw new Error(`(a) ${f}: the device row is not locked before the request (FOR SHARE at ${share}, FOR UPDATE at ${update})`);
    }
    log(`(a) census ${census.length} functions: pinned or inline-by-design (${INLINE.length}, inlined); 0327 branch kept; STOP functions lock device → request`);

    // (b) behaviour — avi_app, rolled back
    const CODE = `__probe_0377_${Date.now()}`;
    const r = await rolledBack(appSql, async (tx) => {
      const out = {};
      await tx`CREATE TEMP TABLE machine_status_latest (x integer) ON COMMIT DROP`;
      await tx`CREATE TEMP TABLE measurement_samples (x integer) ON COMMIT DROP`;
      out.refreshShadowed = await maLoi(tx, (sp) => sp`SELECT public.refresh_qw_caches()`);
      const [p] = await tx`SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = to_regclass('public.measurement_samples') AND c.relname ~ '_y[0-9]{4}m[0-9]{2}$' ORDER BY 1 LIMIT 1`;
      if (p) {
        const m = String(p.relname).match(/_y(\d{4})m(\d{2})$/);
        out.partitionShadowed = await maLoi(tx, (sp) => sp`SELECT public.ensure_measurement_samples_partition(${Number(m[1])}, ${Number(m[2])})`);
      } else out.partitionShadowed = null; // measurement_samples not partitioned on this DB: the function is a no-op
      await tx`SET LOCAL app.tenant_rls_active = 'on'`;
      await tx`SET LOCAL app.tenant_factory_codes = 'F1'`;
      const [t] = await tx`SELECT public.app_tenant_allows('X', NULL) AS other, public.app_tenant_allows('F1', NULL) AS own, public.app_tenant_allows(NULL, NULL) AS shared,
                                  public.to_factory_time('2026-01-01 00:00:00'::timestamp)::text AS tz`;
      out.tenant = `${t.other}/${t.own}/${t.shared}`;
      await tx`SET LOCAL app.factory_tz = ''`;
      await tx`SET LOCAL app.factory_storage_tz = ''`;
      out.tz = (await tx`SELECT public.to_factory_time('2026-01-01 00:00:00'::timestamp)::text AS t`)[0].t;
      // the STOP functions answer as before
      const [admin] = await tx`INSERT INTO public.users ("openId", role, "isActive") VALUES (${CODE + "-a"}, 'admin', true) RETURNING id`;
      const [n1] = await tx`INSERT INTO public.edge_nodes (code, name, status) VALUES (${CODE}, ${CODE}, 'offline') RETURNING id`;
      const [rb] = await tx`INSERT INTO public.robots (code, name, vendor, endpoint) VALUES (${CODE}, ${CODE}, 'sim', 'sim://probe') RETURNING id`;
      await tx`UPDATE public.robots SET "edgeNodeId" = ${n1.id} WHERE id = ${rb.id}`;
      const [{ e }] = await tx`SELECT "ownerEpoch" AS e FROM public.robots WHERE id = ${rb.id}`;
      const stop = async () => (await tx`INSERT INTO public.robot_motion_lock_requests ("robotId", "edgeNodeId", "ownerEpoch", kind, "requestedBy", "expiresAt", reason) VALUES (${rb.id}, ${n1.id}, ${e}, 'stop', ${admin.id}, now() + interval '1 minute', 'probe 0377') RETURNING id`)[0].id;
      const ack = async (q, outcome, epoch = e) => (await tx`SELECT public.edge_stop_ack_edge(${q}, ${n1.id}, ${rb.id}::integer, NULL::integer, ${epoch}::bigint, ${outcome}, false, NULL) AS ok`)[0].ok;
      const q1 = await stop();
      const q2 = await stop();
      const q3 = await stop();
      out.ackDone = await ack(q1, "done");
      out.ackRefused = await ack(q2, "refused");
      out.ackEpochMismatch = await ack(q3, "done", Number(e) + 7);
      out.evidence = (await tx`SELECT reason FROM public.edge_stop_ack_refusals WHERE "requestId" = ${q3} ORDER BY id DESC LIMIT 1`)[0]?.reason ?? null;
      out.resolve = await maLoi(tx, (sp) => sp`SELECT public.edge_stop_resolve(${q2}, ${admin.id}, 'probe 0377 resolved')`);
      const [ex] = await tx`SELECT public.edge_stop_record_central_execution('robot', ${rb.id}, true, 'probe 0377') AS id`;
      out.centralOnEdgeOwned = await maLoi(tx, (sp) => sp`SELECT public.edge_stop_ack_central(${q3}, 'done', ${ex.id}::bigint)`);
      await tx`UPDATE public.robots SET "edgeNodeId" = NULL WHERE id = ${rb.id}`;
      const [ex2] = await tx`SELECT public.edge_stop_record_central_execution('robot', ${rb.id}, true, 'probe 0377 central') AS id`;
      out.centralAck = await maLoi(tx, (sp) => sp`SELECT public.edge_stop_ack_central(${q3}, 'done', ${ex2.id}::bigint)`);
      out.q3 = (await tx`SELECT outcome FROM public.robot_motion_lock_requests WHERE id = ${q3}`)[0].outcome;
      return out;
    });
    expectExact("(b) behaviour", r, {
      refreshShadowed: null, partitionShadowed: null, tenant: "false/true/true", tz: "2026-01-01 07:00:00",
      ackDone: true, ackRefused: true, ackEpochMismatch: false, evidence: "epoch_mismatch", resolve: null, centralOnEdgeOwned: "23514", centralAck: null, q3: "done",
    });
    const [left] = await appSql`SELECT (SELECT count(*)::int FROM public.edge_nodes WHERE code LIKE ${CODE + "%"}) + (SELECT count(*)::int FROM public.robots WHERE code LIKE ${CODE + "%"}) AS n`;
    if (left.n !== 0) throw new Error(`(b) probe NOT rolled back: ${left.n} rows left`);
    log(`(b) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
