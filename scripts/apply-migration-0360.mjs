#!/usr/bin/env node
/**
 * 0360 — R4 (kế hoạch AI Local 2026-09-22 §4): cột `kb_ingest_jobs."ketQuaMay"` jsonb NULLABLE.
 * Áp bằng owner `aoi`, NGHIỆM THU bằng vai ứng dụng `avi_app` (khuôn `apply-migration-0359.mjs`):
 *   (a) cột tồn tại, kiểu jsonb, nullable, không default;
 *   (b) hàng CŨ đọc ra NULL (không biết ≠ "ổn"); avi_app INSERT một job dò có ketQuaMay + đọc lại đúng,
 *       rồi xoá hàng dò bằng owner;
 *   (c) `__applied_migrations` có đúng 1 hàng.
 *
 *   node scripts/apply-migration-0360.mjs [--dev-only|--test-only]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0360_kb_ingest_jobs_ket_qua_may.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);
const TAG = "[0360]";

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.substring(0, idx).trim();
    let value = trimmed.substring(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
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

function asOwner(url) {
  if (process.env.MIGRATION_DB_URL) return process.env.MIGRATION_DB_URL;
  const u = new URL(url);
  u.username = process.env.MIGRATION_DB_USER ?? "aoi";
  u.password = process.env.MIGRATION_DB_PASSWORD ?? "aoi";
  return u.toString();
}

async function applyTo(rawUrl, label) {
  const sql = postgres(asOwner(rawUrl), { max: 1, onnotice: (n) => console.log(`  ${TAG} ${label} NOTICE: ${n.message}`) });
  const appSql = postgres(rawUrl, { max: 1, onnotice: () => {} });
  try {
    const [vai] = await appSql`SELECT current_user AS u, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`;
    if (vai.rolsuper || vai.rolbypassrls) throw new Error(`nghiem thu VO NGHIA: vai "${vai.u}" co dac quyen`);
    const [db0] = await appSql`SELECT current_database() AS d`;
    console.log(`  ${TAG} ${label} nghiệm thu: current_database()=${db0.d} vai="${vai.u}"`);
    const [soCu] = await appSql`SELECT count(*)::int AS n FROM "kb_ingest_jobs"`;

    const content = fs.readFileSync(MIGRATION_PATH, "utf-8");
    await sql.unsafe(content);
    console.log(`${TAG} ${label}: DDL applied (owner aoi)`);

    const [c] = await appSql`
      SELECT data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema='public' AND table_name='kb_ingest_jobs' AND column_name='ketQuaMay'`;
    if (!c) throw new Error("(a) thieu cot ketQuaMay");
    if (c.data_type !== "jsonb" || c.is_nullable !== "YES" || c.column_default !== null) throw new Error(`(a) sai hinh dang: ${JSON.stringify(c)}`);
    console.log(`  ${TAG} ${label} (a) jsonb · nullable · không default: OK`);

    await sql`DELETE FROM "kb_ingest_jobs" WHERE "corpus"='probe-0360'`; // dọn hàng dò của lượt chạy hỏng trước
    const [khac] = await appSql`SELECT count(*)::int AS n FROM "kb_ingest_jobs" WHERE "ketQuaMay" IS NOT NULL`;
    if (khac.n !== 0) throw new Error(`(b) ${khac.n} hang cu co ketQuaMay khac NULL`);
    const mau = { soTrang: 3, soKyTu: 12, soDoan: 1, canhBao: ["pdf-quet-khong-ocr"] };
    const [row] = await appSql`
      INSERT INTO "kb_ingest_jobs" ("corpus","sourceType","sourceRef","status","ketQuaMay")
      VALUES ('probe-0360','pdf','probe.pdf','succeeded',${appSql.json(mau)}) RETURNING id, "ketQuaMay"`;
    const chuan = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))));
    // jsonb KHÔNG giữ thứ tự khoá ⇒ so theo khoá đã sắp.
    if (chuan(row.ketQuaMay) !== chuan(mau)) throw new Error(`(b) doc lai sai: ${JSON.stringify(row.ketQuaMay)}`);
    const xoa = await sql`DELETE FROM "kb_ingest_jobs" WHERE "corpus"='probe-0360' RETURNING id`;
    if (xoa.length < 1) throw new Error(`(b) xoa hang do: ${xoa.length}`);
    console.log(`  ${TAG} ${label} (b) ${soCu.n} hàng cũ đều NULL · avi_app ghi/đọc jsonb đúng · xoá hàng dò: OK`);

    await sql`CREATE TABLE IF NOT EXISTS "__applied_migrations" ("id" SERIAL PRIMARY KEY, "filename" VARCHAR(500) NOT NULL UNIQUE, "applied_at" TIMESTAMP DEFAULT NOW(), "checksum" VARCHAR(64), "success" BOOLEAN DEFAULT true)`;
    const checksum = simpleHash(content);
    await sql`INSERT INTO "__applied_migrations" (filename, checksum, success) VALUES (${MIGRATION_FILE}, ${checksum}, true)
      ON CONFLICT (filename) DO UPDATE SET applied_at = NOW(), checksum = ${checksum}, success = true`;
    const [r] = await sql`SELECT count(*)::int AS n FROM "__applied_migrations" WHERE filename = ${MIGRATION_FILE}`;
    if (r.n !== 1) throw new Error(`__applied_migrations co ${r.n} hang`);
    console.log(`${TAG} ${label}: applied + verified`);
  } finally {
    await sql.end();
    await appSql.end();
  }
}

const args = process.argv.slice(2);
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
