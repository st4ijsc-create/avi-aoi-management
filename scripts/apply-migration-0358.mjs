#!/usr/bin/env node
/**
 * 0358 — B7 (kế hoạch nâng cấp AI Local 2026-09-22): `ai_gateway_metrics` + `reasoningTokens` ·
 * `thinking` · `samplingProfile` (cả ba NULLABLE — không biết ≠ 0).
 * Áp `drizzle/0358_ai_gateway_metrics_b7_suy_luan.sql` bằng owner `aoi`, rồi NGHIỆM THU bằng vai
 * ứng dụng `avi_app` (cùng khuôn `apply-migration-0357.mjs`).
 *
 * Phép đo sau DDL (vai avi_app, Đ-28 current_database):
 *   (a) ba cột tồn tại, đúng kiểu (integer · boolean · character varying(24)) và is_nullable = YES;
 *   (b) INSERT một hàng dò có cả ba cột + SELECT lại đúng giá trị + INSERT hàng KHÔNG có ba cột ⇒ NULL
 *       (không default 0) — rồi XOÁ cả hai hàng dò;
 *   (c) `__applied_migrations` có đúng 1 hàng cho tệp này.
 *
 *   node scripts/apply-migration-0358.mjs            # dev + test
 *   node scripts/apply-migration-0358.mjs --dev-only
 *   node scripts/apply-migration-0358.mjs --test-only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0358_ai_gateway_metrics_b7_suy_luan.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);
const TAG = "[0358]";

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

const COT_MONG = [
  ["reasoningTokens", "integer", null],
  ["thinking", "boolean", null],
  ["samplingProfile", "character varying", 24],
];

async function applyTo(rawUrl, label) {
  const ownerUrl = asOwner(rawUrl);
  const sql = postgres(ownerUrl, { max: 1, onnotice: (n) => console.log(`  ${TAG} ${label} NOTICE: ${n.message}`) });
  const appSql = postgres(rawUrl, { max: 1, onnotice: () => {} });
  try {
    // ── 0) CẦU CHÌ: vai nghiệm thu phải là vai ỨNG DỤNG, không phải superuser.
    const [vai] = await appSql`
      SELECT current_user AS u, r.rolsuper, r.rolbypassrls
      FROM pg_roles r WHERE r.rolname = current_user`;
    if (vai.rolsuper || vai.rolbypassrls) {
      throw new Error(
        `nghiem thu VO NGHIA: vai "${vai.u}" co rolsuper=${vai.rolsuper} rolbypassrls=${vai.rolbypassrls} ` +
          `=> phai do bang vai ung dung khong dac quyen (avi_app).`,
      );
    }
    const [db0] = await appSql`SELECT current_database() AS d`;
    console.log(`  ${TAG} ${label} nghiệm thu: current_database()=${db0.d} vai="${vai.u}"`);

    // ── 1) ĐO TRƯỚC ─────────────────────────────────────────────────────
    const truoc = await appSql`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'ai_gateway_metrics'
         AND column_name IN ('reasoningTokens','thinking','samplingProfile')`;
    console.log(`  ${TAG} ${label} TRƯỚC: đã có ${truoc.length}/3 cột`);

    // ── 2) DDL bằng owner ────────────────────────────────────────────────
    const content = fs.readFileSync(MIGRATION_PATH, "utf-8");
    await sql.unsafe(content);
    console.log(`${TAG} ${label}: DDL applied (owner aoi)`);

    // ── 3) NGHIỆM THU (vai avi_app) ─────────────────────────────────────
    // (a) ba cột, đúng kiểu, nullable
    const cot = await appSql`
      SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'ai_gateway_metrics'
         AND column_name IN ('reasoningTokens','thinking','samplingProfile')`;
    for (const [ten, kieu, dai] of COT_MONG) {
      const c = cot.find((x) => x.column_name === ten);
      if (!c) throw new Error(`(a) thieu cot "${ten}"`);
      if (c.data_type !== kieu) throw new Error(`(a) cot "${ten}" kieu ${c.data_type}, mong ${kieu}`);
      if (dai !== null && Number(c.character_maximum_length) !== dai) throw new Error(`(a) cot "${ten}" dai ${c.character_maximum_length}, mong ${dai}`);
      if (c.is_nullable !== "YES") throw new Error(`(a) cot "${ten}" phai NULLABLE (khong biet != 0)`);
      if (c.column_default !== null) throw new Error(`(a) cot "${ten}" khong duoc co default (${c.column_default})`);
    }
    console.log(`  ${TAG} ${label} (a) 3 cột đúng kiểu, nullable, không default: OK`);

    // (b) INSERT/SELECT bằng vai ứng dụng — có và không có ba cột; rồi xoá hàng dò
    const [co] = await appSql`
      INSERT INTO "ai_gateway_metrics" ("tier","task","model","tokensIn","tokensOut","latencyMs","outcome","fastModelConfigured","reasoningTokens","thinking","samplingProfile")
      VALUES (2, 'probe-0358', 'probe', 1, 2, 3, 'ok', false, 4321, true, 'chinh-hang')
      RETURNING "id","reasoningTokens","thinking","samplingProfile"`;
    if (co.reasoningTokens !== 4321 || co.thinking !== true || co.samplingProfile !== "chinh-hang") {
      throw new Error(`(b) hang do doc lai sai: ${JSON.stringify(co)}`);
    }
    const [khong] = await appSql`
      INSERT INTO "ai_gateway_metrics" ("tier","task","model","tokensIn","tokensOut","latencyMs","outcome","fastModelConfigured")
      VALUES (2, 'probe-0358', 'probe', 1, 2, 3, 'ok', false)
      RETURNING "id","reasoningTokens","thinking","samplingProfile"`;
    if (khong.reasoningTokens !== null || khong.thinking !== null || khong.samplingProfile !== null) {
      throw new Error(`(b) hang KHONG co ba cot phai ra NULL, dang ra: ${JSON.stringify(khong)}`);
    }
    const xoa = await appSql`DELETE FROM "ai_gateway_metrics" WHERE "task" = 'probe-0358' RETURNING "id"`;
    if (xoa.length !== 2) throw new Error(`(b) xoa hang do: ${xoa.length} hang (phai la 2)`);
    console.log(`  ${TAG} ${label} (b) vai avi_app INSERT/SELECT có & không ba cột (NULL, không 0), xoá 2 hàng dò: OK`);

    // (c) sổ migration
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
    if (rows.n !== 1) throw new Error(`__applied_migrations co ${rows.n} hang cho ${MIGRATION_FILE} (phai la 1)`);

    console.log(`${TAG} ${label}: applied + verified (3 phép đo: cột/kiểu/nullable, quyền ứng dụng + NULL, sổ migration)`);
  } finally {
    await sql.end();
    await appSql.end();
  }
}

const args = process.argv.slice(2);
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error(`${TAG} DATABASE_URL not set (checked .env)`);
  process.exit(1);
}

const targets = [];
if (!args.includes("--test-only")) targets.push([devUrl, "dev"]);
if (!args.includes("--dev-only")) {
  let testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    const u = new URL(devUrl);
    const devName = u.pathname.replace(/^\//, "");
    u.pathname = "/" + devName + "_test";
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
