#!/usr/bin/env node
/**
 * 0344 — Pha 1D Task 5 (BG-52 ⛔). Thêm giá trị `'dead'` vào `packagestatusenum`
 * (chốt chặn retry vô hạn ở cửa ZIP — xem docblock đầy đủ trong
 * `drizzle/0344_them_trang_thai_goi_zip_chet.sql`).
 *
 * ⚠⚠ DDL PHẢI chạy bằng owner `aoi` (`avi_app` bị 42501). Script tự ĐỔI user
 * trong DATABASE_URL sang `aoi` trừ khi có MIGRATION_DB_URL/MIGRATION_DB_USER
 * đè lên — cùng khuôn `scripts/apply-migration-0340.mjs`.
 *
 * ⚠⚠ NGHIỆM THU PHẢI CHẠY BẰNG VAI ỨNG DỤNG `avi_app`, KHÔNG PHẢI `aoi` — `aoi`
 * là superuser + BYPASSRLS nên một phép đo bằng `aoi` không chứng minh được gì
 * về quyền của `avi_app`. Script mở HAI kết nối: `sql` (owner `aoi`, chạy DDL)
 * và `appSql` (vai `avi_app`, nghiệm thu).
 *
 * ⚠⚠ `ALTER TYPE … ADD VALUE` không chạy được trong transaction khối — file SQL
 * chỉ có đúng một câu lệnh, không gộp DDL nào khác.
 *
 *   node scripts/apply-migration-0344.mjs            # dev + test
 *   node scripts/apply-migration-0344.mjs --dev-only
 *   node scripts/apply-migration-0344.mjs --test-only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0344_them_trang_thai_goi_zip_chet.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);
const ENUM_TYPE = "packagestatusenum";
const NEW_VALUE = "dead";

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

async function applyTo(rawUrl, label) {
  const ownerUrl = asOwner(rawUrl);
  const sql = postgres(ownerUrl, { max: 1, onnotice: (n) => console.log(`  [0344] ${label} NOTICE: ${n.message}`) });
  const appSql = postgres(rawUrl, { max: 1, onnotice: () => {} });
  try {
    // ── 0) Vai nghiệm thu PHẢI thực sự là vai ứng dụng, không phải superuser/owner.
    const [vai] = await appSql`
      SELECT current_user AS u, r.rolsuper, r.rolbypassrls
      FROM pg_roles r WHERE r.rolname = current_user`;
    if (vai.rolsuper || vai.rolbypassrls) {
      throw new Error(
        `nghiem thu VO NGHIA: vai "${vai.u}" co rolsuper=${vai.rolsuper} rolbypassrls=${vai.rolbypassrls} ` +
        `=> khong the do quyen bang vai nay. Phai do bang vai ung dung khong dac quyen (avi_app).`,
      );
    }
    console.log(`  [0344] ${label} nghiệm thu chạy bằng vai "${vai.u}" (rolsuper=${vai.rolsuper}, rolbypassrls=${vai.rolbypassrls})`);

    // ── 1) Đo TRƯỚC: giá trị 'dead' chưa tồn tại (lượt chạy đầu) hoặc đã tồn tại
    // (lượt chạy lại, idempotent) — chỉ để log, không chặn gì.
    const truoc = await appSql`
      SELECT enumlabel FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = ${ENUM_TYPE}
      ORDER BY e.enumsortorder`;
    console.log(`  [0344] ${label} giá trị enum TRƯỚC: [${truoc.map((r) => r.enumlabel).join(", ")}]`);

    const content = fs.readFileSync(MIGRATION_PATH, "utf8");
    await sql.unsafe(content);
    console.log(`[0344] ${label}: DDL applied (owner aoi)`);

    // ── 2) HÀNH VI THẬT, không đọc SQL rồi tin: đọc lại pg_enum bằng vai avi_app.
    const sau = await appSql`
      SELECT enumlabel FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = ${ENUM_TYPE}
      ORDER BY e.enumsortorder`;
    const nhanSau = sau.map((r) => r.enumlabel);
    console.log(`  [0344] ${label} giá trị enum SAU: [${nhanSau.join(", ")}]`);
    if (!nhanSau.includes(NEW_VALUE)) {
      throw new Error(`verification failed (${label}): pg_enum KHÔNG có nhãn '${NEW_VALUE}' sau khi ALTER TYPE`);
    }
    // Năm giá trị cũ vẫn còn nguyên — additive, không mất giá trị nào.
    const CU = ["pending", "uploading", "uploaded", "committed", "failed"];
    const thieu = CU.filter((v) => !nhanSau.includes(v));
    if (thieu.length > 0) {
      throw new Error(`verification failed (${label}): mất giá trị enum CŨ: ${thieu.join(", ")}`);
    }
    console.log(`  [0344] ${label} xác nhận: '${NEW_VALUE}' có mặt, 5 giá trị cũ còn nguyên — OK`);

    // ── 3) HÀNH VI THẬT thứ hai: CAST một literal 'dead' vào cột status thật sự
    // chấp nhận được (không chỉ pg_enum liệt kê tên) — SELECT thuần, không ghi hàng.
    const [ep] = await appSql`SELECT 'dead'::${appSql(ENUM_TYPE)} AS v`;
    if (ep.v !== "dead") {
      throw new Error(`verification failed (${label}): CAST 'dead'::${ENUM_TYPE} không trả đúng giá trị`);
    }
    console.log(`  [0344] ${label} CAST 'dead'::${ENUM_TYPE} thành công bằng vai avi_app — OK`);

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

    console.log(`[0344] ${label}: applied + verified (pg_enum co 'dead', 5 gia tri cu con nguyen, CAST OK)`);
  } finally {
    await sql.end();
    await appSql.end();
  }
}

const args = process.argv.slice(2);
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error("[0344] DATABASE_URL not set (checked .env)");
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
    console.error(`[0344] ${label} FAILED:`, e?.message ?? e);
  }
}
process.exit(failed ? 1 : 0);
