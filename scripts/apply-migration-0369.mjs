#!/usr/bin/env node
/**
 * 0369 — doc 81 Đợt 9 task R1 (owner decision 2026-10-12, option A): API-key HOLDER identity. Applies
 * `drizzle/0369_api_key_holder_identity.sql` as owner `aoi`, then VERIFIES it as the application role `avi_app`
 * (pattern 0363/0367/0368).
 *
 * Measurements after the DDL (role avi_app, Đ-28 current_database):
 *   (a) columns api_keys."holderUserId" / orchestration_runs."startedViaApiKeyId" (integer) + table api_key_holder_changes
 *       (7 columns) + CHECKs ck_api_keys_holder_real / ck_orch_runs_api_key_real + both triggers + table comment;
 *   (b) grants: api_key_holder_changes SELECT/INSERT = true, UPDATE/DELETE/TRUNCATE = false; column UPDATE on the two new
 *       columns = true; then BEHAVIOUR in an ALWAYS-rolled-back transaction: holder 0 ⇒ 23514; a key inserted with a holder
 *       ⇒ 1 history row; an admin change (aoi.actor_user_id set) ⇒ a history row naming the actor and the reason; UPDATE /
 *       DELETE of a history row ⇒ 42501; a run's startedViaApiKeyId set IN THE INSERT ⇒ ok; changed / cleared / a late
 *       first write (NULL → key, R fix 1 #4) ⇒ 23514; an INSERT with 0 ⇒ 23514; an UPDATE of another column passes;
 *       0 probe rows left;
 *   (c) backfill: no key with a creator and no holder; every key with a holder has ≥1 history row;
 *   (d) `__applied_migrations` has exactly 1 row for this file.
 *
 *   node scripts/apply-migration-0369.mjs --dev-only    # dev DB (owner decides)
 *   node scripts/apply-migration-0369.mjs --test-only   # _test DB
 *   node scripts/apply-migration-0369.mjs --both        # both — NO flag ⇒ refused (R-3-g)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0369_api_key_holder_identity.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);
const TAG = "[0369]";
const HIST = "api_key_holder_changes";
const HIST_COLS = ["id", "apiKeyId", "fromUserId", "toUserId", "changedBy", "reason", "changedAt"];

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
    const [truoc] = await appSql`
      SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='api_keys' AND column_name='holderUserId') AS co`;
    console.log(`  ${TAG} ${label} BEFORE: api_keys."holderUserId" ${truoc.co ? "present" : "absent"}`);

    const content = fs.readFileSync(MIGRATION_PATH, "utf-8");
    // pattern 0362 (#6) — ALTER TABLE on api_keys / orchestration_runs takes an ACCESS EXCLUSIVE lock: wait at most 5 s.
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

    // (a) columns, constraints, triggers, comments
    const colType = async (t, c) =>
      (await appSql`SELECT data_type AS t FROM information_schema.columns WHERE table_schema='public' AND table_name=${t} AND column_name=${c}`)[0]?.t;
    if ((await colType("api_keys", "holderUserId")) !== "integer") throw new Error(`(a) api_keys.holderUserId missing / wrong type`);
    if ((await colType("orchestration_runs", "startedViaApiKeyId")) !== "integer") throw new Error(`(a) orchestration_runs.startedViaApiKeyId missing / wrong type`);
    for (const c of HIST_COLS) if (!(await colType(HIST, c))) throw new Error(`(a) ${HIST}.${c} missing`);
    const ck = async (t, name) =>
      (await appSql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = ${"public." + t}::regclass AND conname = ${name}`)[0]?.def;
    const ck1 = await ck("api_keys", "ck_api_keys_holder_real");
    const ck2 = await ck("orchestration_runs", "ck_orch_runs_api_key_real");
    if (!ck1 || !/"holderUserId" > 0/.test(ck1)) throw new Error(`(a) CHECK ck_api_keys_holder_real: ${ck1}`);
    if (!ck2 || !/"startedViaApiKeyId" > 0/.test(ck2)) throw new Error(`(a) CHECK ck_orch_runs_api_key_real: ${ck2}`);
    const trg = await appSql`
      SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_api_keys_holder_history', 'trg_orch_runs_api_key_write_once') AND tgenabled <> 'D'`;
    if (trg.length !== 2) throw new Error(`(a) triggers: ${JSON.stringify(trg.map((r) => r.tgname))}`);
    const [ct] = await appSql`SELECT obj_description(${"public." + HIST}::regclass, 'pg_class') AS c`;
    if (!ct?.c || !/Dot 9 R1/.test(ct.c)) throw new Error(`(a) table comment missing`);
    console.log(`  ${TAG} ${label} (a) 2 columns + ${HIST} (${HIST_COLS.length} cols); ${ck1}; ${ck2}; triggers ${trg.length}`);

    // (b) grants — catalog (the script grants nothing outside the SQL file: it only measures)
    const [q] = await appSql`
      SELECT has_table_privilege(${HIST}, 'SELECT') AS sel, has_table_privilege(${HIST}, 'INSERT') AS ins,
             has_table_privilege(${HIST}, 'UPDATE') AS upd, has_table_privilege(${HIST}, 'DELETE') AS del,
             has_table_privilege(${HIST}, 'TRUNCATE') AS trunc,
             has_column_privilege('api_keys', 'holderUserId', 'UPDATE') AS holder_upd,
             has_column_privilege('orchestration_runs', 'startedViaApiKeyId', 'UPDATE') AS run_upd`;
    if (!q.sel || !q.ins || q.upd || q.del || q.trunc || !q.holder_upd || !q.run_upd) throw new Error(`(b) avi_app grants wrong: ${JSON.stringify(q)}`);
    // (b) behaviour, in an ALWAYS-rolled-back transaction
    const ROLLBACK = new Error("probe-0369-rollback");
    const CODE = `__probe_0369_${Date.now()}`;
    let kq = null;
    try {
      await appSql.begin(async (tx) => {
        const holder0 = await maLoi(tx, (sp) => sp`INSERT INTO api_keys (name, "keyHash", scopes, "holderUserId") VALUES (${CODE + "-0"}, ${CODE + "-0"}, ${sp.json([])}, 0)`);
        const [k] = await tx`INSERT INTO api_keys (name, "keyHash", scopes, "createdBy", "holderUserId") VALUES (${CODE}, ${CODE}, ${tx.json([])}, 901, 901) RETURNING id`;
        await tx`SELECT set_config('aoi.actor_user_id', '7', true), set_config('aoi.holder_change_reason', 'probe', true)`;
        await tx`UPDATE api_keys SET "holderUserId" = 902 WHERE id = ${k.id}`;
        const hist = await tx`SELECT "fromUserId", "toUserId", "changedBy", reason FROM ${tx(HIST)} WHERE "apiKeyId" = ${k.id} ORDER BY id`;
        const histUpd = await maLoi(tx, (sp) => sp`UPDATE ${sp(HIST)} SET reason = 'x' WHERE "apiKeyId" = ${k.id}`);
        const histDel = await maLoi(tx, (sp) => sp`DELETE FROM ${sp(HIST)} WHERE "apiKeyId" = ${k.id}`);
        const [wf] = await tx`INSERT INTO orchestration_workflows (ref, name, "definitionJson", "scopeKey") VALUES (${CODE}, ${CODE}, ${tx.json({ ref: CODE, name: CODE, steps: [] })}, ${CODE}) RETURNING id`;
        let run = null;
        const setOnce = await maLoi(tx, async (sp) => {
          [run] = await sp`INSERT INTO orchestration_runs ("workflowId", status, "startedViaApiKeyId") VALUES (${wf.id}, 'queued', ${k.id}) RETURNING id`;
        });
        const change = await maLoi(tx, (sp) => sp`UPDATE orchestration_runs SET "startedViaApiKeyId" = ${k.id + 1} WHERE id = ${run.id}`);
        const clear = await maLoi(tx, (sp) => sp`UPDATE orchestration_runs SET "startedViaApiKeyId" = NULL WHERE id = ${run.id}`);
        const other = await maLoi(tx, (sp) => sp`UPDATE orchestration_runs SET status = 'running', "startedViaApiKeyId" = ${k.id} WHERE id = ${run.id}`); // same value ⇒ allowed
        const [run2] = await tx`INSERT INTO orchestration_runs ("workflowId", status) VALUES (${wf.id}, 'queued') RETURNING id`;
        const lateFirst = await maLoi(tx, (sp) => sp`UPDATE orchestration_runs SET "startedViaApiKeyId" = ${k.id} WHERE id = ${run2.id}`);
        const zero = await maLoi(tx, (sp) => sp`INSERT INTO orchestration_runs ("workflowId", status, "startedViaApiKeyId") VALUES (${wf.id}, 'queued', 0)`);
        const [still] = await tx`SELECT "startedViaApiKeyId" AS v FROM orchestration_runs WHERE id = ${run.id}`;
        const [still2] = await tx`SELECT "startedViaApiKeyId" AS v FROM orchestration_runs WHERE id = ${run2.id}`;
        kq = { holder0, hist, histUpd, histDel, setOnce, change, clear, other, lateFirst, zero, still: still.v === k.id && still2.v === null };
        throw ROLLBACK; // ALWAYS rolled back
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    }
    const histOk =
      kq &&
      kq.hist.length === 2 &&
      kq.hist[0].fromUserId === null && kq.hist[0].toUserId === 901 &&
      kq.hist[1].fromUserId === 901 && kq.hist[1].toUserId === 902 && kq.hist[1].changedBy === 7 && kq.hist[1].reason === "probe";
    if (!kq || kq.holder0 !== "23514" || !histOk || kq.histUpd !== "42501" || kq.histDel !== "42501" || kq.setOnce !== null || kq.change !== "23514" || kq.clear !== "23514" || kq.other !== null || kq.lateFirst !== "23514" || kq.zero !== "23514" || !kq.still) {
      throw new Error(`(b) avi_app behaviour wrong: ${JSON.stringify(kq)}`);
    }
    const [left] = await appSql`SELECT count(*)::int AS n FROM api_keys WHERE name LIKE ${CODE + "%"}`;
    if (left.n !== 0) throw new Error(`(b) probe transaction NOT rolled back: ${left.n} probe keys left`);
    console.log(`  ${TAG} ${label} (b) catalog ${JSON.stringify(q)}; behaviour ${JSON.stringify({ ...kq, hist: kq.hist.length })}; ROLLED BACK`);

    // (c) backfill
    const [bf] = await appSql`
      SELECT count(*) FILTER (WHERE "holderUserId" IS NULL AND "createdBy" > 0)::int AS missing,
             count(*) FILTER (WHERE "holderUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM api_key_holder_changes h WHERE h."apiKeyId" = k.id))::int AS no_hist,
             count(*)::int AS keys
        FROM api_keys k`;
    if (bf.missing !== 0 || bf.no_hist !== 0) throw new Error(`(c) backfill incomplete: ${JSON.stringify(bf)}`);
    console.log(`  ${TAG} ${label} (c) backfill ${JSON.stringify(bf)}`);

    // (d)
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

    console.log(`${TAG} ${label}: applied + verified (columns · history · triggers · grants · behaviour · backfill · ledger)`);
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
