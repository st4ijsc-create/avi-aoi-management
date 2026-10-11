#!/usr/bin/env node
/**
 * 0370 — doc 81 Đợt 9 task S1 (owner decision 2026-10-12, edge workflow execution): per-node EDGE CREDENTIAL + the EDGE
 * ASSIGNMENT of an orchestration run (ID mapping). Applies `drizzle/0370_edge_run_execution.sql` as owner `aoi`, then
 * VERIFIES it as the application role `avi_app` (pattern 0363/0367/0369).
 *
 * Measurements after the DDL (role avi_app, Đ-28 current_database):
 *   (a) both tables with every column, the CHECKs, the partial unique index (one ACTIVE credential per node), the three
 *       triggers and both table comments;
 *   (b) grants (catalog, fix 1 — the EXACT set): SELECT / INSERT on both tables; NO table-level UPDATE, DELETE, TRUNCATE,
 *       REFERENCES, TRIGGER; column UPDATE exactly on the revocation columns + lastUsedAt (credentials) and the claim columns
 *       (assignments) — every other column (secretHash, identity, ID mapping) has none — then BEHAVIOUR in an
 *       ALWAYS-rolled-back transaction: a 2nd active credential for a node ⇒ 23505; a bad hash / prefix ⇒ 23514; revoke ⇒ ok,
 *       un-revoke / change the secret ⇒ 23514; DELETE a credential ⇒ 42501; an assignment of a queued run ⇒ ok, of a run in
 *       another state / with another workflow id / pre-claimed ⇒ 23514; identity change (defHash, node) ⇒ 23514; a claim
 *       (seq 0→1 + token, progress 0) ⇒ ok; a skipped claim (1→3), a claim without token, progress going back ⇒ 23514; a token
 *       swapped inside a claim ⇒ 23514; clearing the token (release) ⇒ ok; DELETE an assignment ⇒ 42501; deleting the RUN
 *       removes its assignment (cascade); deleting a NODE with an assignment ⇒ 23503, without one its credentials go with it;
 *       fix 1 (write-once): as avi_app, UPDATE of secretHash / an identity column ⇒ 42501 (no privilege); a late revokedBy on an
 *       ACTIVE credential ⇒ 23514; the claimant changed inside a claim ⇒ 23514; a claim naming ANOTHER node's credential ⇒
 *       23514; the workflowId of an ASSIGNED run ⇒ 23514 (an unassigned run's is not touched by 0370); the startedViaApiKeyId
 *       of an assigned run written late ⇒ 23514 (0369's insert-only trigger); and AS OWNER (the triggers, below privileges): a
 *       change / clear / LATE FIRST WRITE of rotatedFromId, createdBy, assignedBy, workflowId, defHash ⇒ 23514;
 *       0 probe rows left;
 *   (c) `__applied_migrations` has exactly 1 row for this file.
 *
 *   node scripts/apply-migration-0370.mjs --dev-only    # dev DB (owner decides)
 *   node scripts/apply-migration-0370.mjs --test-only   # _test DB
 *   node scripts/apply-migration-0370.mjs --both        # both — NO flag ⇒ refused (R-3-g)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0370_edge_run_execution.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);
const TAG = "[0370]";
const CRED = "edge_node_credentials";
const ASSIGN = "orchestration_run_edge_assignments";
const CRED_COLS = ["id", "edgeNodeId", "keyPrefix", "secretHash", "status", "createdBy", "createdAt", "rotatedFromId", "revokedAt", "revokedBy", "revokeReason", "lastUsedAt"];
const ASSIGN_COLS = ["runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash", "assignedBy", "assignedAt", "claimSeq", "claimTokenHash", "claimedByCredentialId", "claimedAt", "progressSeq", "lastProgressAt"];

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.substring(0, idx).trim();
    let value = trimmed.substring(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(path.join(__dirname, "..", ".env"));

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/** `avi_app` không có quyền DDL (42501) — ép sang owner `aoi`. */
function asOwner(url) {
  if (process.env.MIGRATION_DB_URL) return process.env.MIGRATION_DB_URL;
  const u = new URL(url);
  u.username = process.env.MIGRATION_DB_USER ?? "aoi";
  u.password = process.env.MIGRATION_DB_PASSWORD ?? "aoi";
  return u.toString();
}

/** Bắt mã lỗi SQLSTATE của một câu chạy trong SAVEPOINT (lỗi không làm hỏng giao dịch dò). */
async function maLoi(tx, fn) {
  try {
    await tx.savepoint(async (sp) => fn(sp));
    return null;
  } catch (e) {
    return e?.code ?? String(e?.message ?? e);
  }
}

async function applyTo(rawUrl, label) {
  const sql = postgres(asOwner(rawUrl), { max: 1, onnotice: (n) => console.log(`  ${TAG} ${label} NOTICE: ${n.message}`) });
  const appSql = postgres(rawUrl, { max: 1, onnotice: () => {} });
  try {
    const [vai] = await appSql`
      SELECT current_user AS u, r.rolsuper, r.rolbypassrls
      FROM pg_roles r WHERE r.rolname = current_user`;
    if (vai.rolsuper || vai.rolbypassrls) {
      throw new Error(`verification MEANINGLESS: role "${vai.u}" is privileged => must measure as avi_app.`);
    }
    const [db0] = await appSql`SELECT current_database() AS d`;
    console.log(`  ${TAG} ${label} verifying as: current_database()=${db0.d} role="${vai.u}"`);
    const [truoc] = await appSql`SELECT to_regclass(${"public." + CRED}) IS NOT NULL AS co`;
    console.log(`  ${TAG} ${label} BEFORE: ${CRED} ${truoc.co ? "present" : "absent"}`);

    const content = fs.readFileSync(MIGRATION_PATH, "utf-8");
    // pattern 0362 (#6) — the FKs take a lock on edge_nodes / orchestration_runs: wait at most 5 s.
    await sql`SET lock_timeout = '5s'`;
    await sql`SET statement_timeout = '60s'`;
    try {
      await sql.unsafe(content);
    } catch (e) {
      if (e?.code === "55P03") throw new Error(`could not take the lock within 5 s (lock_timeout, ${e.code}: ${e.message}). Nothing changed. Retry when idle.`);
      if (e?.code === "57014") throw new Error(`DDL ${MIGRATION_FILE} exceeded 60 s (statement_timeout, ${e.code}). Nothing changed.`);
      throw e;
    }
    console.log(`${TAG} ${label}: DDL applied (owner aoi, lock_timeout 5s)`);

    // (a) columns, constraints, index, triggers, comments
    const cols = async (t) =>
      (await appSql`SELECT column_name AS c FROM information_schema.columns WHERE table_schema='public' AND table_name=${t}`).map((r) => r.c);
    const credCols = await cols(CRED);
    const assignCols = await cols(ASSIGN);
    for (const c of CRED_COLS) if (!credCols.includes(c)) throw new Error(`(a) ${CRED}.${c} missing`);
    for (const c of ASSIGN_COLS) if (!assignCols.includes(c)) throw new Error(`(a) ${ASSIGN}.${c} missing`);
    const cks = (
      await appSql`SELECT conname FROM pg_constraint WHERE conrelid IN (${"public." + CRED}::regclass, ${"public." + ASSIGN}::regclass) AND contype = 'c'`
    ).map((r) => r.conname).sort();
    const wantCks = ["ck_edge_assign_claim_hash", "ck_edge_assign_defhash", "ck_edge_assign_seqs", "ck_edge_assign_workflow", "ck_edge_cred_active_clean", "ck_edge_cred_hash", "ck_edge_cred_prefix", "ck_edge_cred_revoked", "ck_edge_cred_status"];
    if (JSON.stringify(cks) !== JSON.stringify(wantCks)) throw new Error(`(a) CHECKs: ${JSON.stringify(cks)}`);
    const [ix] = await appSql`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='uq_edge_node_credentials_one_active'`;
    if (!ix || !/UNIQUE/.test(ix.indexdef) || !/WHERE/.test(ix.indexdef)) throw new Error(`(a) partial unique index: ${ix?.indexdef}`);
    const trg = await appSql`
      SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'D'
        AND tgname IN ('trg_edge_node_credentials_guard', 'trg_edge_run_assignment_insert', 'trg_edge_run_assignment_guard', 'trg_orch_runs_edge_workflow_pinned')`;
    if (trg.length !== 4) throw new Error(`(a) triggers: ${JSON.stringify(trg.map((r) => r.tgname))}`);
    for (const t of [CRED, ASSIGN]) {
      const [ct] = await appSql`SELECT obj_description(${"public." + t}::regclass, 'pg_class') AS c`;
      if (!ct?.c || !/Dot 9 S1/.test(ct.c)) throw new Error(`(a) ${t} comment missing`);
    }
    console.log(`  ${TAG} ${label} (a) ${CRED} (${CRED_COLS.length} cols) + ${ASSIGN} (${ASSIGN_COLS.length} cols); CHECKs ${cks.length}; one-active index; triggers ${trg.length}`);

    // (b) grants — catalog (the script grants nothing outside the SQL file: it only measures)
    const priv = async (t) => {
      const [p] = await appSql`
        SELECT has_table_privilege(${t}, 'SELECT') AS sel, has_table_privilege(${t}, 'INSERT') AS ins,
               has_table_privilege(${t}, 'UPDATE') AS upd, has_table_privilege(${t}, 'DELETE') AS del,
               has_table_privilege(${t}, 'TRUNCATE') AS trunc, has_table_privilege(${t}, 'REFERENCES') AS refs,
               has_table_privilege(${t}, 'TRIGGER') AS trig`;
      return p;
    };
    const updCols = async (t, cols) => {
      const out = [];
      for (const c of cols) if ((await appSql`SELECT has_column_privilege(${t}, ${c}, 'UPDATE') AS u`)[0].u) out.push(c);
      return out.sort();
    };
    const pc = await priv(CRED);
    const pa = await priv(ASSIGN);
    for (const [t, p] of [[CRED, pc], [ASSIGN, pa]]) {
      if (!p.sel || !p.ins || p.upd || p.del || p.trunc || p.refs || p.trig) throw new Error(`(b) avi_app table grants on ${t} not exact: ${JSON.stringify(p)}`);
    }
    const credUpd = await updCols(CRED, CRED_COLS);
    const assignUpd = await updCols(ASSIGN, ASSIGN_COLS);
    const wantCredUpd = ["lastUsedAt", "revokeReason", "revokedAt", "revokedBy", "status"];
    const wantAssignUpd = ["claimSeq", "claimTokenHash", "claimedAt", "claimedByCredentialId", "lastProgressAt", "progressSeq"];
    if (JSON.stringify(credUpd) !== JSON.stringify(wantCredUpd)) throw new Error(`(b) column UPDATE on ${CRED} not exact: ${JSON.stringify(credUpd)}`);
    if (JSON.stringify(assignUpd) !== JSON.stringify(wantAssignUpd)) throw new Error(`(b) column UPDATE on ${ASSIGN} not exact: ${JSON.stringify(assignUpd)}`);
    const [seqP] = await appSql`SELECT has_sequence_privilege('edge_node_credentials_id_seq', 'USAGE') AS u, has_sequence_privilege('edge_node_credentials_id_seq', 'UPDATE') AS upd`;
    if (!seqP.u || seqP.upd) throw new Error(`(b) sequence grants not exact: ${JSON.stringify(seqP)}`);
    // (b) behaviour, in an ALWAYS-rolled-back transaction
    const ROLLBACK = new Error("probe-0370-rollback");
    const CODE = `__probe_0370_${Date.now()}`;
    const H = (c) => c.repeat(64);
    let kq = null;
    try {
      await appSql.begin(async (tx) => {
        const [node] = await tx`INSERT INTO edge_nodes (code, name, status) VALUES (${CODE}, ${CODE}, 'offline') RETURNING id`;
        const [node2] = await tx`INSERT INTO edge_nodes (code, name, status) VALUES (${CODE + "-2"}, ${CODE}, 'offline') RETURNING id`;
        const [c1] = await tx`INSERT INTO ${tx(CRED)} ("edgeNodeId", "keyPrefix", "secretHash") VALUES (${node.id}, 'edn_aaaaaaaaaaaa', ${H("a")}) RETURNING id`;
        const secondActive = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(CRED)} ("edgeNodeId", "keyPrefix", "secretHash") VALUES (${node.id}, 'edn_bbbbbbbbbbbb', ${H("b")})`);
        const badHash = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(CRED)} ("edgeNodeId", "keyPrefix", "secretHash") VALUES (${node2.id}, 'edn_cccccccccccc', 'plaintext')`);
        const badPrefix = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(CRED)} ("edgeNodeId", "keyPrefix", "secretHash") VALUES (${node2.id}, 'ak_cccccccccccc', ${H("c")})`);
        const swapSecret = await maLoi(tx, (sp) => sp`UPDATE ${sp(CRED)} SET "secretHash" = ${H("d")} WHERE id = ${c1.id}`);
        const revoke = await maLoi(tx, (sp) => sp`UPDATE ${sp(CRED)} SET status = 'revoked', "revokedAt" = now(), "revokedBy" = 7, "revokeReason" = 'probe' WHERE id = ${c1.id}`);
        const unrevoke = await maLoi(tx, (sp) => sp`UPDATE ${sp(CRED)} SET status = 'active', "revokedAt" = NULL WHERE id = ${c1.id}`);
        const [c2] = await tx`INSERT INTO ${tx(CRED)} ("edgeNodeId", "keyPrefix", "secretHash", "rotatedFromId") VALUES (${node.id}, 'edn_dddddddddddd', ${H("e")}, ${c1.id}) RETURNING id`;
        const credDel = await maLoi(tx, (sp) => sp`DELETE FROM ${sp(CRED)} WHERE id = ${c2.id}`);
        const [wf] = await tx`INSERT INTO orchestration_workflows (ref, name, "definitionJson", "scopeKey") VALUES (${CODE}, ${CODE}, ${tx.json({ ref: CODE, name: CODE, steps: [] })}, ${CODE}) RETURNING id`;
        const [run] = await tx`INSERT INTO orchestration_runs ("workflowId", status) VALUES (${wf.id}, 'queued') RETURNING id`;
        const [runR] = await tx`INSERT INTO orchestration_runs ("workflowId", status) VALUES (${wf.id}, 'running') RETURNING id`;
        const [runQ] = await tx`INSERT INTO orchestration_runs ("workflowId", status) VALUES (${wf.id}, 'queued') RETURNING id`;
        const assign = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(ASSIGN)} ("runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash") VALUES (${run.id}, ${node.id}, ${wf.id}, 1, ${H("1")})`);
        const notQueued = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(ASSIGN)} ("runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash") VALUES (${runR.id}, ${node.id}, ${wf.id}, 1, ${H("1")})`);
        const otherWf = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(ASSIGN)} ("runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash") VALUES (${runQ.id}, ${node.id}, ${wf.id + 1}, 1, ${H("1")})`);
        const preClaimed = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(ASSIGN)} ("runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash", "claimSeq", "claimTokenHash") VALUES (${runQ.id}, ${node.id}, ${wf.id}, 1, ${H("1")}, 1, ${H("f")})`);
        const idDef = await maLoi(tx, (sp) => sp`UPDATE ${sp(ASSIGN)} SET "defHash" = ${H("2")} WHERE "runId" = ${run.id}`);
        const idNode = await maLoi(tx, (sp) => sp`UPDATE ${sp(ASSIGN)} SET "edgeNodeId" = ${node2.id} WHERE "runId" = ${run.id}`);
        const claim = await maLoi(tx, (sp) => sp`UPDATE ${sp(ASSIGN)} SET "claimSeq" = 1, "claimTokenHash" = ${H("3")}, "claimedByCredentialId" = ${c2.id}, "claimedAt" = now(), "progressSeq" = 0 WHERE "runId" = ${run.id}`);
        const progress = await maLoi(tx, (sp) => sp`UPDATE ${sp(ASSIGN)} SET "progressSeq" = 5, "lastProgressAt" = now() WHERE "runId" = ${run.id}`);
        const back = await maLoi(tx, (sp) => sp`UPDATE ${sp(ASSIGN)} SET "progressSeq" = 3 WHERE "runId" = ${run.id}`);
        const skip = await maLoi(tx, (sp) => sp`UPDATE ${sp(ASSIGN)} SET "claimSeq" = 3, "claimTokenHash" = ${H("4")}, "progressSeq" = 0 WHERE "runId" = ${run.id}`);
        const noToken = await maLoi(tx, (sp) => sp`UPDATE ${sp(ASSIGN)} SET "claimSeq" = 2, "claimTokenHash" = NULL, "progressSeq" = 0 WHERE "runId" = ${run.id}`);
        const swapToken = await maLoi(tx, (sp) => sp`UPDATE ${sp(ASSIGN)} SET "claimTokenHash" = ${H("5")} WHERE "runId" = ${run.id}`);
        const release = await maLoi(tx, (sp) => sp`UPDATE ${sp(ASSIGN)} SET "claimTokenHash" = NULL WHERE "runId" = ${run.id}`);
        // fix 1 — write-once of the claimant / the run side of the ID mapping / a live credential
        const claimantSwap = await maLoi(tx, (sp) => sp`UPDATE ${sp(ASSIGN)} SET "claimedByCredentialId" = ${c1.id} WHERE "runId" = ${run.id}`);
        const [node3] = await tx`INSERT INTO edge_nodes (code, name, status) VALUES (${CODE + "-3"}, ${CODE}, 'offline') RETURNING id`;
        const [cOther] = await tx`INSERT INTO ${tx(CRED)} ("edgeNodeId", "keyPrefix", "secretHash") VALUES (${node3.id}, 'edn_ffffffffffff', ${H("7")}) RETURNING id`;
        const foreignClaim = await maLoi(tx, (sp) => sp`UPDATE ${sp(ASSIGN)} SET "claimSeq" = 2, "claimTokenHash" = ${H("8")}, "claimedByCredentialId" = ${cOther.id}, "claimedAt" = now(), "progressSeq" = 0 WHERE "runId" = ${run.id}`);
        const runWfPinned = await maLoi(tx, (sp) => sp`UPDATE orchestration_runs SET "workflowId" = ${wf.id + 1} WHERE id = ${run.id}`);
        const runWfFree = await maLoi(tx, (sp) => sp`UPDATE orchestration_runs SET "workflowId" = ${wf.id} WHERE id = ${runR.id}`);
        const lateRunKey = await maLoi(tx, (sp) => sp`UPDATE orchestration_runs SET "startedViaApiKeyId" = 999999 WHERE id = ${run.id}`);
        const lateRevoker = await maLoi(tx, (sp) => sp`UPDATE ${sp(CRED)} SET "revokedBy" = 7 WHERE id = ${cOther.id}`);
        const credNodeMove = await maLoi(tx, (sp) => sp`UPDATE ${sp(CRED)} SET "edgeNodeId" = ${node.id} WHERE id = ${cOther.id}`);
        const assignDel = await maLoi(tx, (sp) => sp`DELETE FROM ${sp(ASSIGN)} WHERE "runId" = ${run.id}`);
        const nodeDelBlocked = await maLoi(tx, (sp) => sp`DELETE FROM edge_nodes WHERE id = ${node.id}`);
        const [after] = await tx`SELECT "claimSeq" AS s, "progressSeq" AS p, "defHash" AS h FROM ${tx(ASSIGN)} WHERE "runId" = ${run.id}`;
        const runDel = await maLoi(tx, (sp) => sp`DELETE FROM orchestration_runs WHERE id = ${run.id}`);
        const [gone] = await tx`SELECT count(*)::int AS n FROM ${tx(ASSIGN)} WHERE "runId" = ${run.id}`;
        const [c3] = await tx`INSERT INTO ${tx(CRED)} ("edgeNodeId", "keyPrefix", "secretHash") VALUES (${node2.id}, 'edn_eeeeeeeeeeee', ${H("6")}) RETURNING id`;
        const node2Del = await maLoi(tx, (sp) => sp`DELETE FROM edge_nodes WHERE id = ${node2.id}`);
        const [credGone] = await tx`SELECT count(*)::int AS n FROM ${tx(CRED)} WHERE id = ${c3.id}`;
        kq = {
          secondActive, badHash, badPrefix, swapSecret, revoke, unrevoke, credDel, assign, notQueued, otherWf, preClaimed, idDef, idNode,
          claim, progress, back, skip, noToken, swapToken, release, assignDel, nodeDelBlocked, runDel,
          claimantSwap, foreignClaim, runWfPinned, runWfFree, lateRunKey, lateRevoker, credNodeMove,
          after: after ? { s: after.s, p: Number(after.p), h: after.h === H("1") } : null, gone: gone.n, node2Del, credGone: credGone.n,
        };
        throw ROLLBACK; // ALWAYS rolled back
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    }
    const want = {
      secondActive: "23505", badHash: "23514", badPrefix: "23514", swapSecret: "42501", revoke: null, unrevoke: "23514", credDel: "42501",
      assign: null, notQueued: "23514", otherWf: "23514", preClaimed: "23514", idDef: "42501", idNode: "42501",
      claimantSwap: "23514", foreignClaim: "23514", runWfPinned: "23514", runWfFree: null, lateRunKey: "23514", lateRevoker: "23514", credNodeMove: "42501",
      claim: null, progress: null, back: "23514", skip: "23514", noToken: "23514", swapToken: "23514", release: null, assignDel: "42501",
      nodeDelBlocked: "23503", runDel: null, gone: 0, node2Del: null, credGone: 0,
    };
    const bad = !kq || Object.entries(want).some(([k, v]) => kq[k] !== v) || !kq.after || kq.after.s !== 1 || kq.after.p !== 5 || !kq.after.h;
    if (bad) throw new Error(`(b) avi_app behaviour wrong: ${JSON.stringify(kq)}`);
    // fix 1 — the TRIGGERS themselves (below privileges: as the owner, who has every column), always rolled back
    let ko = null;
    try {
      await sql.begin(async (tx) => {
        const [node] = await tx`INSERT INTO edge_nodes (code, name, status) VALUES (${CODE + "-o"}, ${CODE}, 'offline') RETURNING id`;
        const [c1] = await tx`INSERT INTO ${tx(CRED)} ("edgeNodeId", "keyPrefix", "secretHash") VALUES (${node.id}, 'edn_a0a0a0a0a0a0', ${H("a")}) RETURNING id`;
        const lateRotatedFrom = await maLoi(tx, (sp) => sp`UPDATE ${sp(CRED)} SET "rotatedFromId" = ${c1.id} WHERE id = ${c1.id}`);
        const lateCreatedBy = await maLoi(tx, (sp) => sp`UPDATE ${sp(CRED)} SET "createdBy" = 5 WHERE id = ${c1.id}`);
        const ownerSecret = await maLoi(tx, (sp) => sp`UPDATE ${sp(CRED)} SET "secretHash" = ${H("b")} WHERE id = ${c1.id}`);
        const [wf] = await tx`INSERT INTO orchestration_workflows (ref, name, "definitionJson", "scopeKey") VALUES (${CODE + "-o"}, ${CODE}, ${tx.json({ ref: CODE, name: CODE, steps: [] })}, ${CODE + "-o"}) RETURNING id`;
        const [run] = await tx`INSERT INTO orchestration_runs ("workflowId", status) VALUES (${wf.id}, 'queued') RETURNING id`;
        await tx`INSERT INTO ${tx(ASSIGN)} ("runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash") VALUES (${run.id}, ${node.id}, ${wf.id}, 1, ${H("1")})`;
        const lateAssignedBy = await maLoi(tx, (sp) => sp`UPDATE ${sp(ASSIGN)} SET "assignedBy" = 5 WHERE "runId" = ${run.id}`);
        const ownerMapping = await maLoi(tx, (sp) => sp`UPDATE ${sp(ASSIGN)} SET "workflowId" = ${wf.id + 1} WHERE "runId" = ${run.id}`);
        const ownerDef = await maLoi(tx, (sp) => sp`UPDATE ${sp(ASSIGN)} SET "defHash" = ${H("2")} WHERE "runId" = ${run.id}`);
        const ownerNode = await maLoi(tx, (sp) => sp`UPDATE ${sp(ASSIGN)} SET "edgeNodeId" = ${node.id} + 0, "workflowVersion" = 2 WHERE "runId" = ${run.id}`);
        ko = { lateRotatedFrom, lateCreatedBy, ownerSecret, lateAssignedBy, ownerMapping, ownerDef, ownerNode };
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    }
    if (!ko || Object.values(ko).some((v) => v !== "23514")) throw new Error(`(b) owner-level write-once triggers wrong: ${JSON.stringify(ko)}`);
    console.log(`  ${TAG} ${label} (b) exact column UPDATE: ${CRED} ${JSON.stringify(credUpd)}, ${ASSIGN} ${JSON.stringify(assignUpd)}; owner-level write-once ${JSON.stringify(ko)}; ROLLED BACK`);
    const [left] = await appSql`SELECT count(*)::int AS n FROM edge_nodes WHERE code LIKE ${CODE + "%"}`;
    if (left.n !== 0) throw new Error(`(b) probe transaction NOT rolled back: ${left.n} probe nodes left`);
    console.log(`  ${TAG} ${label} (b) catalog ${JSON.stringify({ [CRED]: pc, [ASSIGN]: pa })}; behaviour ${JSON.stringify(kq)}; ROLLED BACK`);

    // (c)
    await sql`
      CREATE TABLE IF NOT EXISTS "__applied_migrations" (
        "id" SERIAL PRIMARY KEY,
        "filename" VARCHAR(500) NOT NULL UNIQUE,
        "applied_at" TIMESTAMP DEFAULT NOW(),
        "checksum" VARCHAR(64),
        "success" BOOLEAN DEFAULT true
      )`;
    const checksum = simpleHash(content);
    await sql`
      INSERT INTO "__applied_migrations" (filename, checksum, success)
      VALUES (${MIGRATION_FILE}, ${checksum}, true)
      ON CONFLICT (filename) DO UPDATE SET applied_at = NOW(), checksum = ${checksum}, success = true`;
    const [rows] = await sql`SELECT count(*)::int AS n FROM "__applied_migrations" WHERE filename = ${MIGRATION_FILE}`;
    if (rows.n !== 1) throw new Error(`__applied_migrations has ${rows.n} rows (must be 1)`);

    console.log(`${TAG} ${label}: applied + verified (tables · checks · one-active index · triggers · grants · behaviour · ledger)`);
  } finally {
    await sql.end();
    await appSql.end();
  }
}

const args = process.argv.slice(2);
// R-3-g — PHẢI chỉ rõ ĐÚNG MỘT đích. Không cờ ⇒ TỪ CHỐI, không mở kết nối nào.
const CO_DICH = ["--dev-only", "--test-only", "--both"].filter((f) => args.includes(f));
if (CO_DICH.length !== 1) {
  console.error(`${TAG} phai chi ro DUNG MOT dich: --dev-only | --test-only | --both (nhan: ${CO_DICH.join(" ") || "khong co"}). Khong chay gi.`);
  process.exit(2);
}
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error(`${TAG} DATABASE_URL not set`);
  process.exit(1);
}
const targets = [];
if (!args.includes("--test-only")) targets.push([devUrl, "dev"]);
if (!args.includes("--dev-only")) {
  let testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    const u = new URL(devUrl);
    u.pathname = "/" + u.pathname.replace(/^\//, "") + "_test";
    testUrl = u.toString();
  }
  targets.push([testUrl, "test"]);
}
let failed = false;
for (const [url, label] of targets) {
  try {
    await applyTo(url, label);
  } catch (e) {
    failed = true;
    console.error(`${TAG} ${label} FAILED:`, e?.message ?? e);
  }
}
process.exit(failed ? 1 : 0);
