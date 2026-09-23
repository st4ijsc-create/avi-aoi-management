#!/usr/bin/env node
/**
 * 0359 — R1 (kế hoạch AI Local 2026-09-22 §4): bảng `kb_eval_runs` (sổ lượt eval Training Studio).
 * Áp `drizzle/0359_kb_eval_runs.sql` bằng owner `aoi`, rồi NGHIỆM THU bằng vai ứng dụng `avi_app`
 * (cùng khuôn `apply-migration-0358.mjs`).
 *
 * Phép đo sau DDL (vai avi_app, Đ-28 current_database):
 *   (a) bảng tồn tại với đủ 18 cột; `tongHop` NULLABLE (lượt không đo được ⇒ NULL, không 0);
 *   (b) avi_app INSERT + SELECT được một hàng dò; UPDATE và DELETE bị TỪ CHỐI (42501) — sổ chỉ ghi
 *       thêm là sự thật đo được, không phải lời khai; hàng dò xoá bằng owner;
 *   (c) `__applied_migrations` có đúng 1 hàng cho tệp này.
 *
 *   node scripts/apply-migration-0359.mjs            # dev + test
 *   node scripts/apply-migration-0359.mjs --dev-only
 *   node scripts/apply-migration-0359.mjs --test-only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0359_kb_eval_runs.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);
const TAG = "[0359]";

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

const COT = [
  "id", "corpus", "boVang", "trangThai", "lyDo", "k", "nguong", "tangDuongOng", "soChunk", "soNguon",
  "lanNapCuoi", "embedModel", "boVangHash", "tongHop", "ketQua", "msTong", "createdBy", "createdAt",
];

async function tuChoi(fn) {
  try {
    await fn();
    return false;
  } catch (e) {
    return e?.code === "42501";
  }
}

async function applyTo(rawUrl, label) {
  const ownerUrl = asOwner(rawUrl);
  const sql = postgres(ownerUrl, { max: 1, onnotice: (n) => console.log(`  ${TAG} ${label} NOTICE: ${n.message}`) });
  const appSql = postgres(rawUrl, { max: 1, onnotice: () => {} });
  try {
    const [vai] = await appSql`
      SELECT current_user AS u, r.rolsuper, r.rolbypassrls
      FROM pg_roles r WHERE r.rolname = current_user`;
    if (vai.rolsuper || vai.rolbypassrls) {
      throw new Error(`nghiem thu VO NGHIA: vai "${vai.u}" co dac quyen => phai do bang avi_app.`);
    }
    const [db0] = await appSql`SELECT current_database() AS d`;
    console.log(`  ${TAG} ${label} nghiệm thu: current_database()=${db0.d} vai="${vai.u}"`);

    const [truoc] = await appSql`SELECT to_regclass('public.kb_eval_runs') AS t`;
    console.log(`  ${TAG} ${label} TRƯỚC: bảng ${truoc.t ? "đã có" : "chưa có"}`);

    const content = fs.readFileSync(MIGRATION_PATH, "utf-8");
    await sql.unsafe(content);
    console.log(`${TAG} ${label}: DDL applied (owner aoi)`);

    // (a)
    const cot = await appSql`
      SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'kb_eval_runs'`;
    const ten = new Set(cot.map((c) => c.column_name));
    const thieu = COT.filter((c) => !ten.has(c));
    if (thieu.length) throw new Error(`(a) thieu cot: ${thieu.join(", ")}`);
    if (cot.find((c) => c.column_name === "tongHop").is_nullable !== "YES") throw new Error(`(a) tongHop phai NULLABLE`);
    console.log(`  ${TAG} ${label} (a) ${COT.length} cột, tongHop nullable: OK`);

    // (b)
    const [row] = await appSql`
      INSERT INTO "kb_eval_runs" ("corpus","boVang","trangThai","k","nguong","tangDuongOng","soChunk","soNguon","boVangHash","ketQua","msTong")
      VALUES ('probe-0359','probe','khong-do-duoc',5,0.5,false,0,0,'0',${appSql.json([])},1)
      RETURNING "id","tongHop"`;
    if (row.tongHop !== null) throw new Error(`(b) tongHop khong dat phai NULL: ${JSON.stringify(row.tongHop)}`);
    const doc = await appSql`SELECT id FROM "kb_eval_runs" WHERE id = ${row.id}`;
    if (doc.length !== 1) throw new Error(`(b) SELECT lai hang do that bai`);
    const upd = await tuChoi(() => appSql`UPDATE "kb_eval_runs" SET "msTong" = 2 WHERE id = ${row.id}`);
    const del = await tuChoi(() => appSql`DELETE FROM "kb_eval_runs" WHERE id = ${row.id}`);
    if (!upd || !del) throw new Error(`(b) avi_app phai bi tu choi UPDATE(${upd})/DELETE(${del}) — so chi ghi them`);
    const xoa = await sql`DELETE FROM "kb_eval_runs" WHERE "corpus" = 'probe-0359' RETURNING id`;
    if (xoa.length !== 1) throw new Error(`(b) owner xoa hang do: ${xoa.length} (phai la 1)`);
    console.log(`  ${TAG} ${label} (b) avi_app INSERT/SELECT OK, UPDATE+DELETE bị từ chối 42501, owner xoá hàng dò: OK`);

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
    if (rows.n !== 1) throw new Error(`__applied_migrations co ${rows.n} hang (phai la 1)`);

    console.log(`${TAG} ${label}: applied + verified (cột · quyền chỉ-ghi-thêm · sổ migration)`);
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
