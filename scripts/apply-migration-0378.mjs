#!/usr/bin/env node
/**
 * 0378 — doc 81 Đợt 12 task O: RETIRE an edge node (never delete it). Applies `drizzle/0378_edge_node_retirement.sql` as owner
 * `aoi`, then VERIFIES as `avi_app` (pattern 0363–0377, shared runner apply-migration-dot10-common.mjs — exactly one target flag,
 * lock_timeout 5 s, statement_timeout 60 s, the verifying role must be neither superuser nor BYPASSRLS, `__applied_migrations`
 * ledger row):
 *   (a) catalog: the three columns + the CHECK; the two trigger functions pinned, not executable by PUBLIC nor avi_app
 *       (verifyFunctionHygiene); the 12 triggers exist, enabled, on their function;
 *   (b) behaviour in an ALWAYS-rolled-back transaction as avi_app: a retirement is refused while a credential is active / a device
 *       is owned / the actor is not an admin, and its refusal names the blocker; refused for an incomplete write or a half-retired
 *       INSERT (CHECK, NULL-safe); allowed
 *       once nothing is left (status forced offline); then the retired node gets no credential, no device (insert or update),
 *       no run assignment, no legacy delegation; it is never un-retired, renamed, brought online or deleted; its label may change;
 *       0 probe rows left;
 *   (c) `__applied_migrations` has exactly 1 row for this file.
 *
 *   node scripts/apply-migration-0378.mjs --test-only | --dev-only | --both   (NO flag ⇒ refused — R-3-g)
 */
import { expectExact, maLoi, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

const TRIGGERS = {
  trg_edge_nodes_retire_guard: ["edge_nodes", "edge_node_retire_guard"],
  trg_edge_nodes_retire_keep: ["edge_nodes", "edge_node_retire_guard"],
  trg_edge_nodes_retire_born: ["edge_nodes", "edge_node_retire_guard"], // fix 1 (O-R1)
  trg_edge_node_credentials_retired_ins: ["edge_node_credentials", "edge_node_refuse_retired_target"],
  trg_robots_edge_retired_ins: ["robots", "edge_node_refuse_retired_target"],
  trg_robots_edge_retired_upd: ["robots", "edge_node_refuse_retired_target"],
  trg_adapters_edge_retired_ins: ["device_adapters", "edge_node_refuse_retired_target"],
  trg_adapters_edge_retired_upd: ["device_adapters", "edge_node_refuse_retired_target"],
  trg_edge_run_assignment_retired_ins: ["orchestration_run_edge_assignments", "edge_node_refuse_retired_target"],
  trg_edge_run_assignment_retired_claim: ["orchestration_run_edge_assignments", "edge_node_refuse_retired_target"],
  trg_orch_runs_edge_retired_ins: ["orchestration_runs", "edge_node_refuse_retired_target"],
  trg_orch_runs_edge_retired_upd: ["orchestration_runs", "edge_node_refuse_retired_target"],
};

await runMigration({
  file: "0378_edge_node_retirement.sql",
  tag: "[0378]",
  async verify({ appSql, log }) {
    // (a) catalog
    const cols = (await appSql`SELECT column_name AS c, data_type AS t FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'edge_nodes' AND column_name IN ('retiredAt', 'retiredBy', 'retireReason') ORDER BY 1`).map((r) => `${r.c}:${r.t}`);
    expectExact("(a) columns", { cols }, { cols: ["retireReason:text", "retiredAt:timestamp with time zone", "retiredBy:integer"] });
    const [ck] = await appSql`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'ck_edge_nodes_retired' AND conrelid = 'public.edge_nodes'::regclass AND contype = 'c'`;
    expectExact("(a) check", ck, { n: 1 });
    const trg = await appSql`
      SELECT t.tgname AS name, c.relname AS rel, p.proname AS fn, t.tgenabled AS en
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE NOT t.tgisinternal AND n.nspname = 'public' AND t.tgname = ANY(${Object.keys(TRIGGERS)})`;
    const got = Object.fromEntries(trg.map((r) => [r.name, [r.rel, r.fn, r.en]]));
    const want = Object.fromEntries(Object.entries(TRIGGERS).map(([k, v]) => [k, [...v, "O"]]));
    expectExact("(a) triggers", got, want);
    log(`(a) 3 columns + CHECK; ${trg.length} triggers on their function, enabled`);

    // (b) behaviour — avi_app, rolled back
    const CODE = `__probe_0378_${Date.now()}`;
    const r = await rolledBack(appSql, async (tx) => {
      const out = {};
      const [admin] = await tx`INSERT INTO public.users ("openId", role, "isActive") VALUES (${CODE + "-a"}, 'admin', true) RETURNING id`;
      const [eng] = await tx`INSERT INTO public.users ("openId", role, "isActive") VALUES (${CODE + "-e"}, 'engineer', true) RETURNING id`;
      const [n] = await tx`INSERT INTO public.edge_nodes (code, name, status) VALUES (${CODE}, ${CODE}, 'online') RETURNING id`;
      const [rb] = await tx`INSERT INTO public.robots (code, name, vendor, endpoint) VALUES (${CODE}, ${CODE}, 'sim', 'sim://probe') RETURNING id`;
      await tx`INSERT INTO public.edge_node_credentials ("edgeNodeId", "keyPrefix", "secretHash", status, "createdBy") VALUES (${n.id}, 'edn_0378aaaaaaaa', ${"c".repeat(64)}, 'active', ${admin.id})`;
      const retire = (sp, by) => sp`UPDATE public.edge_nodes SET "retiredAt" = now(), "retiredBy" = ${by}, "retireReason" = 'probe 0378' WHERE id = ${n.id}`;
      const msg = async (fn) => {
        try {
          await tx.savepoint(async (sp) => fn(sp));
          return null;
        } catch (e) {
          return `${e?.code}:${/active credential/.test(e?.message) ? "cred" : /robot\(s\)/.test(e?.message) ? "robot" : /not an active admin/.test(e?.message) ? "actor" : "other"}`;
        }
      };
      out.withCredential = await msg((sp) => retire(sp, admin.id));
      await tx`UPDATE public.edge_node_credentials SET status = 'revoked', "revokedAt" = now(), "revokedBy" = ${admin.id}, "revokeReason" = 'probe' WHERE "edgeNodeId" = ${n.id}`;
      await tx`UPDATE public.robots SET "edgeNodeId" = ${n.id} WHERE id = ${rb.id}`;
      out.withRobot = await msg((sp) => retire(sp, admin.id));
      await tx`UPDATE public.robots SET "edgeNodeId" = NULL WHERE id = ${rb.id}`;
      out.byEngineer = await msg((sp) => retire(sp, eng.id));
      out.incomplete = await maLoi(tx, (sp) => sp`UPDATE public.edge_nodes SET "retiredAt" = now() WHERE id = ${n.id}`);
      out.halfInsert = await maLoi(tx, (sp) => sp`INSERT INTO public.edge_nodes (code, name, status, "retiredAt") VALUES (${CODE + "-h"}, 'h', 'offline', now())`); // CHECK (NULL-safe)
      // fix 1 (O-R1 / O-R2) — never born retired; the retiring UPDATE freezes the identity and stamps the time itself
      out.bornRetired = await maLoi(tx, (sp) => sp`INSERT INTO public.edge_nodes (code, name, status, "retiredAt", "retiredBy", "retireReason") VALUES (${CODE + "-b"}, 'b', 'online', now(), ${admin.id}, 'squat')`);
      out.retireWithCode = await maLoi(tx, (sp) => sp`UPDATE public.edge_nodes SET "retiredAt" = now(), "retiredBy" = ${admin.id}, "retireReason" = 'probe 0378', code = ${CODE + "-free"} WHERE id = ${n.id}`);
      out.retire = await maLoi(tx, (sp) => sp`UPDATE public.edge_nodes SET "retiredAt" = now() + interval '10 years', "retiredBy" = ${admin.id}, "retireReason" = 'probe 0378' WHERE id = ${n.id}`);
      out.stamped = (await tx`SELECT ("retiredAt" BETWEEN now() - interval '1 minute' AND now() + interval '1 minute') AS ok FROM public.edge_nodes WHERE id = ${n.id}`)[0].ok;
      out.status = (await tx`SELECT status::text AS s FROM public.edge_nodes WHERE id = ${n.id}`)[0].s;
      out.newCredential = await maLoi(tx, (sp) => sp`INSERT INTO public.edge_node_credentials ("edgeNodeId", "keyPrefix", "secretHash", status, "createdBy") VALUES (${n.id}, 'edn_0378bbbbbbbb', ${"d".repeat(64)}, 'active', ${admin.id})`);
      out.assignRobot = await maLoi(tx, (sp) => sp`UPDATE public.robots SET "edgeNodeId" = ${n.id} WHERE id = ${rb.id}`);
      out.insertOwnedAdapter = await maLoi(tx, (sp) => sp`INSERT INTO public.device_adapters (code, name, protocol, endpoint, "edgeNodeId") VALUES (${CODE + "-a"}, 'x', 'stub', 'stub://x', ${n.id})`);
      out.insertOwnedRobot = await maLoi(tx, (sp) => sp`INSERT INTO public.robots (code, name, vendor, endpoint, "edgeNodeId") VALUES (${CODE + "-2"}, 'x', 'sim', 'sim://x', ${n.id})`);
      const [wf] = await tx`INSERT INTO public.orchestration_workflows (ref, name, "definitionJson", status, "scopeKey", version) VALUES (${CODE}, ${CODE}, ${tx.json({ steps: [] })}, 'active', 'global', 1) RETURNING id`;
      const [run] = await tx`INSERT INTO public.orchestration_runs ("workflowId", "workflowRef", status, "paramsJson", "contextJson", "startedBy") VALUES (${wf.id}, ${CODE}, 'queued', ${tx.json({})}, ${tx.json({})}, ${admin.id}) RETURNING id`;
      out.assignRun = await maLoi(tx, (sp) => sp`INSERT INTO public.orchestration_run_edge_assignments ("runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash", "assignedBy") VALUES (${run.id}, ${n.id}, ${wf.id}, 1, ${"e".repeat(64)}, ${admin.id})`);
      out.insertRunOnNode = await maLoi(tx, (sp) => sp`INSERT INTO public.orchestration_runs ("workflowId", "workflowRef", status, "paramsJson", "contextJson", "startedBy", "edgeNodeId") VALUES (${wf.id}, ${CODE}, 'queued', ${sp.json({})}, ${sp.json({})}, ${admin.id}, ${n.id})`);
      out.delegateRun = await maLoi(tx, (sp) => sp`UPDATE public.orchestration_runs SET "edgeNodeId" = ${n.id} WHERE id = ${run.id}`);
      out.unretire = await maLoi(tx, (sp) => sp`UPDATE public.edge_nodes SET "retiredAt" = NULL, "retiredBy" = NULL, "retireReason" = NULL WHERE id = ${n.id}`);
      out.rename = await maLoi(tx, (sp) => sp`UPDATE public.edge_nodes SET code = ${CODE + "-x"} WHERE id = ${n.id}`);
      out.online = await maLoi(tx, (sp) => sp`UPDATE public.edge_nodes SET status = 'online' WHERE id = ${n.id}`);
      out.delete = await maLoi(tx, (sp) => sp`DELETE FROM public.edge_nodes WHERE id = ${n.id}`);
      out.label = await maLoi(tx, (sp) => sp`UPDATE public.edge_nodes SET name = 'probe label', "updatedAt" = now() WHERE id = ${n.id}`);
      return out;
    });
    expectExact("(b) behaviour", r, {
      withCredential: "23514:cred", withRobot: "23514:robot", byEngineer: "23514:actor", incomplete: "23514", halfInsert: "23514", bornRetired: "23514", retireWithCode: "23514", retire: null, stamped: true, status: "offline",
      newCredential: "23514", assignRobot: "23514", insertOwnedAdapter: "23514", insertOwnedRobot: "23514", assignRun: "23514", insertRunOnNode: "23514", delegateRun: "23514",
      unretire: "23514", rename: "23514", online: "23514", delete: "23514", label: null,
    });
    const [left] = await appSql`SELECT (SELECT count(*)::int FROM public.edge_nodes WHERE code LIKE ${CODE + "%"}) + (SELECT count(*)::int FROM public.robots WHERE code LIKE ${CODE + "%"}) AS n`;
    if (left.n !== 0) throw new Error(`(b) probe NOT rolled back: ${left.n} rows left`);
    log(`(b) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
