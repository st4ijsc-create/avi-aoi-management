#!/usr/bin/env node
/**
 * 0372 — doc 81 Đợt 10 task A: `edge_step_authorizations` (per-step signed edge authorisations). Applies
 * `drizzle/0372_edge_step_authorizations.sql` as owner `aoi`, then VERIFIES as `avi_app` (pattern 0363–0371):
 *   (a) every column, the 7 CHECKs, the UNIQUE (runId, claimSeq, stepId, attempt), both triggers, the comment;
 *   (b) grants (catalog — EXACT): SELECT / INSERT; no table UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER; column UPDATE
 *       exactly on resultReportedAt, resultStatus, supersededAt; then BEHAVIOUR in an ALWAYS-rolled-back transaction:
 *       an authorisation under the CURRENT claim ⇒ ok; a 2nd one for the same (run, claim, step, attempt) ⇒ 23505; one for a
 *       stale claim / another node's credential / an unclaimed run / pre-filled result / TTL > 60 s / a bad payload hash /
 *       a bad kid ⇒ 23514; an identity column UPDATE ⇒ 42501; the result written once ⇒ ok, again ⇒ 23514; result status
 *       without time ⇒ 23514; supersededAt once ⇒ ok, changed ⇒ 23514; DELETE ⇒ 42501; deleting the run cascades; deleting
 *       the node ⇒ 23503; AS OWNER (the trigger, below privileges): a change / clear / LATE FIRST WRITE of an identity column
 *       (payloadHash, approvalJson NULL → value, kid, expiresAt) ⇒ 23514; 0 probe rows left;
 *   (c) `__applied_migrations` has exactly 1 row for this file.
 *
 *   node scripts/apply-migration-0372.mjs --test-only   # _test DB
 *   node scripts/apply-migration-0372.mjs --dev-only    # dev DB (the owner decides)
 *   node scripts/apply-migration-0372.mjs --both        # NO flag ⇒ refused (R-3-g)
 */
import { columnsOf, expectExact, maLoi, rolledBack, runMigration, tablePriv, updatableCols } from "./apply-migration-dot10-common.mjs";

const T = "edge_step_authorizations";
const COLS = ["jti", "edgeNodeId", "credentialId", "runId", "claimSeq", "stepId", "attempt", "idempotencyKey", "kind", "payloadHash", "approvalJson", "verdictJson", "kid", "reqNonceHash", "issuedAt", "expiresAt", "resultReportedAt", "resultStatus", "supersededAt"];
const H = (c) => c.repeat(64);
const PH = (c) => "sha256:" + H(c);
const KID = "edk_" + "A".repeat(22);
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** node + credential + workflow + queued run + assignment, claimed (claimSeq 1) — the 0370 fixtures. */
async function fixtures(tx, code) {
  const [node] = await tx`INSERT INTO edge_nodes (code, name, status) VALUES (${code}, ${code}, 'offline') RETURNING id`;
  const [node2] = await tx`INSERT INTO edge_nodes (code, name, status) VALUES (${code + "-2"}, ${code}, 'offline') RETURNING id`;
  const pfx = (c) => "edn_" + c.repeat(12);
  const [cred] = await tx`INSERT INTO edge_node_credentials ("edgeNodeId", "keyPrefix", "secretHash") VALUES (${node.id}, ${pfx(code.slice(-1) === "o" ? "e" : "a")}, ${H("a")}) RETURNING id`;
  const [cred2] = await tx`INSERT INTO edge_node_credentials ("edgeNodeId", "keyPrefix", "secretHash") VALUES (${node2.id}, ${pfx(code.slice(-1) === "o" ? "f" : "b")}, ${H("b")}) RETURNING id`;
  const [wf] = await tx`INSERT INTO orchestration_workflows (ref, name, "definitionJson", "scopeKey") VALUES (${code}, ${code}, ${tx.json({ ref: code, name: code, steps: [] })}, ${code}) RETURNING id`;
  const [run] = await tx`INSERT INTO orchestration_runs ("workflowId", status) VALUES (${wf.id}, 'queued') RETURNING id`;
  const [run2] = await tx`INSERT INTO orchestration_runs ("workflowId", status) VALUES (${wf.id}, 'queued') RETURNING id`;
  await tx`INSERT INTO orchestration_run_edge_assignments ("runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash") VALUES (${run.id}, ${node.id}, ${wf.id}, 1, ${H("1")})`;
  await tx`INSERT INTO orchestration_run_edge_assignments ("runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash") VALUES (${run2.id}, ${node.id}, ${wf.id}, 1, ${H("1")})`;
  await tx`UPDATE orchestration_run_edge_assignments SET "claimSeq" = 1, "claimTokenHash" = ${H("3")}, "claimedByCredentialId" = ${cred.id}, "claimedAt" = now(), "progressSeq" = 0 WHERE "runId" = ${run.id}`;
  return { node, node2, cred, cred2, run, run2 };
}
function ins(sp, f, over = {}) {
  const r = {
    jti: uuid(1), edgeNodeId: f.node.id, credentialId: f.cred.id, runId: f.run.id, claimSeq: 1, stepId: "m1", attempt: 1, idempotencyKey: "foe:m1:1",
    kind: "robot", payloadHash: PH("c"), approvalJson: null, verdictJson: { commissioned: true }, kid: KID, reqNonceHash: H("d"), ttl: 10, ...over,
  };
  return sp`INSERT INTO ${sp(T)} (jti, "edgeNodeId", "credentialId", "runId", "claimSeq", "stepId", attempt, "idempotencyKey", kind, "payloadHash", "approvalJson", "verdictJson", kid, "reqNonceHash", "issuedAt", "expiresAt", "resultReportedAt", "resultStatus", "supersededAt")
    VALUES (${r.jti}, ${r.edgeNodeId}, ${r.credentialId}, ${r.runId}, ${r.claimSeq}, ${r.stepId}, ${r.attempt}, ${r.idempotencyKey}, ${r.kind}, ${r.payloadHash},
            ${r.approvalJson === null ? null : sp.json(r.approvalJson)}, ${sp.json(r.verdictJson)}, ${r.kid}, ${r.reqNonceHash}, now(), now() + (${r.ttl} * interval '1 second'),
            ${r.resultReportedAt ?? null}, ${r.resultStatus ?? null}, ${r.supersededAt ?? null})`;
}

await runMigration({
  file: "0372_edge_step_authorizations.sql",
  tag: "[0372]",
  async verify({ sql, appSql, log }) {
    // (a)
    const cols = await columnsOf(appSql, T);
    for (const c of COLS) if (!cols.includes(c)) throw new Error(`(a) ${T}.${c} missing`);
    const cks = (await appSql`SELECT conname FROM pg_constraint WHERE conrelid = ${"public." + T}::regclass AND contype = 'c'`).map((r) => r.conname).sort();
    const wantCks = ["ck_edge_step_auth_kid", "ck_edge_step_auth_kind", "ck_edge_step_auth_nonce", "ck_edge_step_auth_payload", "ck_edge_step_auth_result", "ck_edge_step_auth_seq", "ck_edge_step_auth_ttl"];
    if (JSON.stringify(cks) !== JSON.stringify(wantCks)) throw new Error(`(a) CHECKs: ${JSON.stringify(cks)}`);
    const [uq] = await appSql`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'uq_edge_step_auth_attempt'`;
    if (!uq || !/UNIQUE \("runId", "claimSeq", "stepId", attempt\)/.test(uq.d)) throw new Error(`(a) unique: ${uq?.d}`);
    const trg = await appSql`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'D' AND tgname IN ('trg_edge_step_auth_insert', 'trg_edge_step_auth_guard')`;
    if (trg.length !== 2) throw new Error(`(a) triggers: ${JSON.stringify(trg.map((r) => r.tgname))}`);
    const [ct] = await appSql`SELECT obj_description(${"public." + T}::regclass, 'pg_class') AS c`;
    if (!ct?.c || !/Dot 10 A \(0372\)/.test(ct.c)) throw new Error(`(a) comment missing`);
    log(`(a) ${T}: ${COLS.length} cols, CHECKs ${cks.length}, unique (run, claim, step, attempt), triggers 2`);
    // (b) grants — catalog
    const p = await tablePriv(appSql, T);
    if (!p.sel || !p.ins || p.upd || p.del || p.trunc || p.refs || p.trig) throw new Error(`(b) table grants not exact: ${JSON.stringify(p)}`);
    const upd = await updatableCols(appSql, T, COLS);
    if (JSON.stringify(upd) !== JSON.stringify(["resultReportedAt", "resultStatus", "supersededAt"])) throw new Error(`(b) column UPDATE not exact: ${JSON.stringify(upd)}`);
    // (b) behaviour as avi_app
    const CODE = `__probe_0372_${Date.now()}`;
    const kq = await rolledBack(appSql, async (tx) => {
      const f = await fixtures(tx, CODE);
      const ok = await maLoi(tx, (sp) => ins(sp, f));
      const dupAttempt = await maLoi(tx, (sp) => ins(sp, f, { jti: uuid(2), reqNonceHash: H("e") }));
      const nextAttempt = await maLoi(tx, (sp) => ins(sp, f, { jti: uuid(3), attempt: 2 }));
      const staleClaim = await maLoi(tx, (sp) => ins(sp, f, { jti: uuid(4), claimSeq: 2 }));
      const foreignCred = await maLoi(tx, (sp) => ins(sp, f, { jti: uuid(5), stepId: "m2", credentialId: f.cred2.id }));
      const otherNode = await maLoi(tx, (sp) => ins(sp, f, { jti: uuid(6), stepId: "m3", edgeNodeId: f.node2.id, credentialId: f.cred2.id }));
      const unclaimed = await maLoi(tx, (sp) => ins(sp, f, { jti: uuid(7), runId: f.run2.id }));
      const preResult = await maLoi(tx, (sp) => ins(sp, f, { jti: uuid(8), stepId: "m4", resultReportedAt: new Date(), resultStatus: "acked" }));
      const longTtl = await maLoi(tx, (sp) => ins(sp, f, { jti: uuid(9), stepId: "m5", ttl: 61 }));
      const badHash = await maLoi(tx, (sp) => ins(sp, f, { jti: uuid(10), stepId: "m6", payloadHash: "sha256:xyz" }));
      const badKid = await maLoi(tx, (sp) => ins(sp, f, { jti: uuid(11), stepId: "m7", kid: "k1" }));
      const idUpd = await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET "payloadHash" = ${PH("f")} WHERE jti = ${uuid(1)}`);
      const halfResult = await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET "resultStatus" = 'acked' WHERE jti = ${uuid(1)}`);
      const result1 = await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET "resultReportedAt" = now(), "resultStatus" = 'acked' WHERE jti = ${uuid(1)}`);
      const result2 = await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET "resultStatus" = 'failed' WHERE jti = ${uuid(1)}`);
      const sup1 = await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET "supersededAt" = now() WHERE jti = ${uuid(3)}`);
      const sup2 = await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET "supersededAt" = now() + interval '1 hour' WHERE jti = ${uuid(3)}`);
      const del = await maLoi(tx, (sp) => sp`DELETE FROM ${sp(T)} WHERE jti = ${uuid(1)}`);
      const nodeDel = await maLoi(tx, (sp) => sp`DELETE FROM edge_nodes WHERE id = ${f.node.id}`);
      const runDel = await maLoi(tx, (sp) => sp`DELETE FROM orchestration_runs WHERE id = ${f.run.id}`);
      const [gone] = await tx`SELECT count(*)::int AS n FROM ${tx(T)} WHERE "runId" = ${f.run.id}`;
      return { ok, dupAttempt, nextAttempt, staleClaim, foreignCred, otherNode, unclaimed, preResult, longTtl, badHash, badKid, idUpd, halfResult, result1, result2, sup1, sup2, del, nodeDel, runDel, gone: gone.n };
    });
    expectExact("(b) avi_app behaviour", kq, {
      ok: null, dupAttempt: "23505", nextAttempt: null, staleClaim: "23514", foreignCred: "23514", otherNode: "23514", unclaimed: "23514", preResult: "23514",
      longTtl: "23514", badHash: "23514", badKid: "23514", idUpd: "42501", halfResult: "23514", result1: null, result2: "23514", sup1: null, sup2: "23514",
      del: "42501", nodeDel: "23503", runDel: null, gone: 0,
    });
    // (b) the trigger itself, below privileges (as the owner)
    const ko = await rolledBack(sql, async (tx) => {
      const f = await fixtures(tx, CODE + "-o");
      await ins(tx, f);
      return {
        payloadHash: await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET "payloadHash" = ${PH("f")} WHERE jti = ${uuid(1)}`),
        lateApproval: await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET "approvalJson" = ${sp.json({ approvedBy: 1 })} WHERE jti = ${uuid(1)}`),
        kid: await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET kid = ${"edk_" + "B".repeat(22)} WHERE jti = ${uuid(1)}`),
        expiresAt: await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET "expiresAt" = "expiresAt" + interval '1 second' WHERE jti = ${uuid(1)}`),
        verdictClear: await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET "verdictJson" = '{}'::jsonb WHERE jti = ${uuid(1)}`),
      };
    });
    expectExact("(b) owner-level write-once", ko, { payloadHash: "23514", lateApproval: "23514", kid: "23514", expiresAt: "23514", verdictClear: "23514" });
    const [left] = await appSql`SELECT count(*)::int AS n FROM edge_nodes WHERE code LIKE ${CODE + "%"}`;
    if (left.n !== 0) throw new Error(`(b) probe NOT rolled back: ${left.n} probe nodes left`);
    log(`(b) grants exact (UPDATE ${JSON.stringify(upd)}); behaviour ${JSON.stringify(kq)}; owner-level ${JSON.stringify(ko)}; ROLLED BACK`);
  },
});
