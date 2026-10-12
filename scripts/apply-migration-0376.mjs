#!/usr/bin/env node
/**
 * 0376 — doc 81 Đợt 10 task A fix review 2 (ruling R-10-h): pin the search_path of every function of 0363–0371 (and re-pin
 * 0125's SECURITY DEFINER RLS helpers). Applies `drizzle/0376_pin_function_search_path.sql` as owner `aoi`, then VERIFIES as
 * `avi_app` (pattern 0363–0375, shared runner apply-migration-dot10-common.mjs — exactly one target flag, lock_timeout 5 s,
 * statement_timeout 60 s, the verifying role must be neither superuser nor BYPASSRLS, `__applied_migrations` ledger row):
 *   (a) catalog: the 8 re-created functions are schema-qualified, run with EXACTLY `search_path = pg_catalog, public, pg_temp`,
 *       are NOT executable by PUBLIC nor avi_app (trigger functions — firing needs no EXECUTE) — verifyFunctionHygiene; every
 *       trigger still points at its function (same oid), enabled; the 0125 helpers are pinned and still PUBLIC-executable (RLS);
 *   (b) behaviour in an ALWAYS-rolled-back transaction as avi_app, with shadow TEMP tables created BEFORE any guarded function
 *       runs in that session: holder history lands in the REAL table; a running run is not assignable; a claim naming another
 *       node's credential is refused; an assigned run's workflow stays pinned — and the unshadowed semantics are unchanged
 *       (queued run assignable, pending_epoch bumps on → held, startedViaApiKeyId write-once, credential identity write-once,
 *       a consumed safety_event_trust is frozen); 0 probe rows left;
 *   (c) `__applied_migrations` has exactly 1 row for this file.
 *
 *   node scripts/apply-migration-0376.mjs --test-only | --dev-only | --both   (NO flag ⇒ refused — R-3-g)
 */
import { randomBytes } from "node:crypto";
import { expectExact, maLoi, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

const FNS = [
  "orchestration_runs_bump_pending_epoch", "api_keys_holder_history", "orch_runs_api_key_write_once", "edge_node_credentials_guard",
  "edge_run_assignment_insert_guard", "edge_run_assignment_guard", "orch_runs_edge_workflow_pinned", "safety_event_trust_guard",
];
const TRIGGERS = {
  trg_orchestration_runs_pending_epoch: "orchestration_runs_bump_pending_epoch",
  trg_api_keys_holder_history: "api_keys_holder_history",
  trg_orch_runs_api_key_write_once: "orch_runs_api_key_write_once",
  trg_edge_node_credentials_guard: "edge_node_credentials_guard",
  trg_edge_run_assignment_insert: "edge_run_assignment_insert_guard",
  trg_edge_run_assignment_guard: "edge_run_assignment_guard",
  trg_orch_runs_edge_workflow_pinned: "orch_runs_edge_workflow_pinned",
  trg_safety_event_trust_guard: "safety_event_trust_guard",
};
const RLS_HELPERS = ["app_factory_of_machine_code", "app_factory_of_line_id", "app_factory_of_line_code"];
const hex = (n) => randomBytes(n).toString("hex");

await runMigration({
  file: "0376_pin_function_search_path.sql",
  tag: "[0376]",
  async verify({ appSql, log }) {
    // (a) catalog
    const rows = await appSql`SELECT p.proname AS n, p.proconfig AS c, has_function_privilege('public', p.oid, 'EXECUTE') AS pub, has_function_privilege(current_user, p.oid, 'EXECUTE') AS app
                                FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = ANY(${[...FNS, ...RLS_HELPERS]})`;
    const by = Object.fromEntries(rows.map((r) => [r.n, r]));
    for (const f of FNS) if (!by[f] || by[f].pub || by[f].app) throw new Error(`(a) ${f}: ${JSON.stringify(by[f])}`);
    for (const f of RLS_HELPERS) {
      if (!by[f]) continue; // 0125 not applied on this DB
      if (JSON.stringify(by[f].c) !== JSON.stringify(["search_path=pg_catalog, public, pg_temp"]) || !by[f].pub) throw new Error(`(a) ${f}: ${JSON.stringify(by[f])}`);
    }
    const trg = await appSql`SELECT t.tgname AS t, p.proname AS f FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE NOT t.tgisinternal AND t.tgenabled <> 'D' AND t.tgname = ANY(${Object.keys(TRIGGERS)})`;
    const tmap = Object.fromEntries(trg.map((r) => [r.t, r.f]));
    expectExact("(a) triggers → functions", tmap, TRIGGERS);
    log(`(a) ${FNS.length} functions pinned + no PUBLIC / avi_app EXECUTE; ${trg.length} triggers bound; RLS helpers ${RLS_HELPERS.filter((f) => by[f]).length} re-pinned, PUBLIC-executable`);
    // (b) behaviour (avi_app, shadows FIRST — before any guarded function runs in this session)
    const CODE = `__probe_0376_${Date.now()}`;
    const r = await rolledBack(appSql, async (tx) => {
      await tx`CREATE TEMP TABLE api_key_holder_changes ("apiKeyId" integer, "fromUserId" integer, "toUserId" integer, "changedBy" integer, reason text) ON COMMIT DROP`;
      await tx`CREATE TEMP TABLE orchestration_runs (id integer, "workflowId" integer, status text) ON COMMIT DROP`;
      await tx`CREATE TEMP TABLE edge_node_credentials (id integer, "edgeNodeId" integer) ON COMMIT DROP`;
      await tx`CREATE TEMP TABLE orchestration_run_edge_assignments ("runId" integer) ON COMMIT DROP`;
      const out = {};
      const [u1] = await tx`INSERT INTO public.users ("openId", role, "isActive") VALUES (${CODE + "-1"}, 'admin', true) RETURNING id`;
      const [u2] = await tx`INSERT INTO public.users ("openId", role, "isActive") VALUES (${CODE + "-2"}, 'user', true) RETURNING id`;
      const [k] = await tx`INSERT INTO public.api_keys (name, "keyHash", scopes, "createdBy", "holderUserId") VALUES (${CODE}, ${CODE + "-h"}, ${tx.json(["orchestration:write"])}, ${u1.id}, ${u1.id}) RETURNING id`;
      await tx`UPDATE public.api_keys SET "holderUserId" = ${u2.id} WHERE id = ${k.id}`;
      out.holderHistoryReal = (await tx`SELECT count(*)::int AS n FROM public.api_key_holder_changes WHERE "apiKeyId" = ${k.id}`)[0].n;
      out.holderHistoryShadow = (await tx`SELECT count(*)::int AS n FROM pg_temp.api_key_holder_changes`)[0].n;
      const [node] = await tx`INSERT INTO public.edge_nodes (code, name, status) VALUES (${CODE}, ${CODE}, 'offline') RETURNING id`;
      const [node2] = await tx`INSERT INTO public.edge_nodes (code, name, status) VALUES (${CODE + "-2"}, ${CODE}, 'offline') RETURNING id`;
      const [cred] = await tx`INSERT INTO public.edge_node_credentials ("edgeNodeId", "keyPrefix", "secretHash") VALUES (${node.id}, ${"edn_" + hex(6)}, ${hex(32)}) RETURNING id`;
      const [cred2] = await tx`INSERT INTO public.edge_node_credentials ("edgeNodeId", "keyPrefix", "secretHash") VALUES (${node2.id}, ${"edn_" + hex(6)}, ${hex(32)}) RETURNING id`;
      const [wf] = await tx`INSERT INTO public.orchestration_workflows (ref, name, "definitionJson", "scopeKey") VALUES (${CODE}, ${CODE}, ${tx.json({ ref: CODE, name: CODE, steps: [] })}, ${CODE}) RETURNING id`;
      const [wf2] = await tx`INSERT INTO public.orchestration_workflows (ref, name, "definitionJson", "scopeKey") VALUES (${CODE + "-2"}, ${CODE}, ${tx.json({ ref: CODE + "-2", name: CODE, steps: [] })}, ${CODE + "-2"}) RETURNING id`;
      const [runQ] = await tx`INSERT INTO public.orchestration_runs ("workflowId", status) VALUES (${wf.id}, 'queued') RETURNING id`;
      const [runR] = await tx`INSERT INTO public.orchestration_runs ("workflowId", status) VALUES (${wf.id}, 'running') RETURNING id`;
      await tx`INSERT INTO pg_temp.orchestration_runs VALUES (${runR.id}, ${wf.id}, 'queued')`;
      await tx`INSERT INTO pg_temp.edge_node_credentials VALUES (${cred2.id}, ${node.id})`;
      const assign = (sp, run) => sp`INSERT INTO public.orchestration_run_edge_assignments ("runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash") VALUES (${run}, ${node.id}, ${wf.id}, 1, ${hex(32)})`;
      out.assignRunning = await maLoi(tx, (sp) => assign(sp, runR.id));
      out.assignQueued = await maLoi(tx, (sp) => assign(sp, runQ.id));
      out.claimOtherNodeCred = await maLoi(tx, (sp) => sp`UPDATE public.orchestration_run_edge_assignments SET "claimSeq" = 1, "claimTokenHash" = ${hex(32)}, "claimedByCredentialId" = ${cred2.id}, "claimedAt" = now() WHERE "runId" = ${runQ.id}`);
      out.claimOwnCred = await maLoi(tx, (sp) => sp`UPDATE public.orchestration_run_edge_assignments SET "claimSeq" = 1, "claimTokenHash" = ${hex(32)}, "claimedByCredentialId" = ${cred.id}, "claimedAt" = now() WHERE "runId" = ${runQ.id}`);
      out.workflowRepin = await maLoi(tx, (sp) => sp`UPDATE public.orchestration_runs SET "workflowId" = ${wf2.id} WHERE id = ${runQ.id}`);
      // unshadowed semantics, unchanged
      const [e0] = await tx`SELECT pending_epoch AS e FROM public.orchestration_runs WHERE id = ${runR.id}`;
      await tx`UPDATE public.orchestration_runs SET status = 'held' WHERE id = ${runR.id}`;
      out.pendingEpochBump = (await tx`SELECT pending_epoch AS e FROM public.orchestration_runs WHERE id = ${runR.id}`)[0].e - e0.e;
      out.apiKeyWriteOnce = await maLoi(tx, (sp) => sp`UPDATE public.orchestration_runs SET "startedViaApiKeyId" = ${k.id} WHERE id = ${runR.id}`);
      out.credIdentity = await maLoi(tx, (sp) => sp`UPDATE public.edge_node_credentials SET status = 'revoked', "revokedAt" = now(), "revokedBy" = ${u1.id}, "revokeReason" = 'x' WHERE id = ${cred.id}`);
      out.credRevive = await maLoi(tx, (sp) => sp`UPDATE public.edge_node_credentials SET status = 'active', "revokedAt" = NULL, "revokedBy" = NULL, "revokeReason" = NULL WHERE id = ${cred.id}`);
      return out;
    });
    expectExact("(b) behaviour (shadowed + unchanged semantics)", r, {
      holderHistoryReal: 2, holderHistoryShadow: 0, assignRunning: "23514", assignQueued: null, claimOtherNodeCred: "23514", claimOwnCred: null,
      workflowRepin: "23514", pendingEpochBump: 1, apiKeyWriteOnce: "23514", credIdentity: null, credRevive: "23514",
    });
    const [left] = await appSql`SELECT (SELECT count(*)::int FROM edge_nodes WHERE code LIKE ${CODE + "%"}) + (SELECT count(*)::int FROM api_keys WHERE name LIKE ${CODE + "%"}) AS n`;
    if (left.n !== 0) throw new Error(`(b) probe NOT rolled back: ${left.n} rows left`);
    log(`(b) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
