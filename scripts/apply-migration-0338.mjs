#!/usr/bin/env node
/**
 * 0338 — cây CẤU HÌNH 4 cấp: `product_surfaces` → `product_positions` → `product_captures`,
 * neo `measurement_point_defs` (đã là cấp component) lên `product_captures` qua `captureRowId`.
 *
 * ⚠⚠ DDL PHẢI chạy bằng owner `aoi` (`avi_app` bị 42501). Script tự ĐỔI user trong
 * DATABASE_URL sang `aoi` trừ khi có MIGRATION_DB_URL/MIGRATION_DB_USER đè lên.
 *
 * ⚠⚠ NGHIỆM THU PHẢI CHẠY BẰNG VAI ỨNG DỤNG `avi_app`, KHÔNG PHẢI `aoi`.
 * `aoi` là superuser + BYPASSRLS + chủ sở hữu bảng ⇒ mọi phép đo QUYỀN (GRANT) chạy bằng
 * `aoi` sẽ XANH kể cả khi GRANT hoàn toàn hỏng (42501 không bao giờ xảy ra với `aoi`).
 * Một lưới nghiệm thu chạy bằng `aoi` không chứng minh được gì về `avi_app`. Script này vì
 * thế mở HAI kết nối: `sql` (owner `aoi`, chạy DDL) và `appSql` (vai `avi_app`, nghiệm thu).
 *
 *   node scripts/apply-migration-0338.mjs            # dev + test
 *   node scripts/apply-migration-0338.mjs --dev-only
 *   node scripts/apply-migration-0338.mjs --test-only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0338_product_config_tree.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);
const PROBE_SURFACE_NAME = "_probe_0338";

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
  const sql = postgres(ownerUrl, { max: 1, onnotice: (n) => console.log(`  [0338] ${label} NOTICE: ${n.message}`) });
  // Kết nối NGHIỆM THU bằng ĐÚNG vai ứng dụng — `aoi` bỏ qua mọi kiểm tra quyền nên đo bằng nó vô nghĩa.
  const appSql = postgres(rawUrl, { max: 1, onnotice: () => {} });
  try {
    const content = fs.readFileSync(MIGRATION_PATH, "utf8");
    await sql.unsafe(content);
    console.log(`[0338] ${label}: DDL applied (owner aoi)`);

    // ── 0) Vai nghiệm thu PHẢI thực sự là vai ứng dụng, không phải superuser/owner.
    const [vai] = await appSql`
      SELECT current_user AS u, r.rolsuper, r.rolbypassrls
      FROM pg_roles r WHERE r.rolname = current_user`;
    if (vai.rolsuper || vai.rolbypassrls) {
      throw new Error(
        `nghiem thu VO NGHIA: vai "${vai.u}" co rolsuper=${vai.rolsuper} rolbypassrls=${vai.rolbypassrls} ` +
        `=> khong the do quyen GRANT bang vai nay. Phai do bang vai ung dung khong dac quyen (avi_app).`,
      );
    }
    console.log(`  [0338] ${label} nghiệm thu chạy bằng vai "${vai.u}" (rolsuper=${vai.rolsuper}, rolbypassrls=${vai.rolbypassrls})`);

    // ── 1) SELECT phải chạy được, không 42501.
    const [cnt] = await appSql`SELECT count(*)::int n FROM product_surfaces`;
    console.log(`  [0338] ${label} avi_app SELECT product_surfaces OK — ${cnt.n} hàng`);

    // ── 2) INSERT/DELETE phải chạy được — dùng một productModelId THẬT lấy từ DB (không hard-code).
    const [modelThat] = await appSql`SELECT id FROM product_models ORDER BY id LIMIT 1`;
    if (!modelThat) {
      throw new Error(`nghiem thu KHONG CHAY DUOC: bang product_models rong tren "${label}", khong co id that de probe`);
    }
    // ⚠ Migration 0347 (Khối B Task 5) làm `product_surfaces."machineId"` NOT NULL —
    // probe cũ (chỉ productModelId + surfaceName) sẽ vỡ `23502` nếu 0347 đã áp. Lấy
    // một máy THẬT y như đã lấy một product model THẬT: không hard-code, và probe
    // vẫn chạy được trên DB CHƯA áp 0347 (cột chưa có thì bỏ qua).
    const [mayThat] = await appSql`SELECT id FROM machines ORDER BY id LIMIT 1`;
    const coCotMay = (await appSql`
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'product_surfaces' AND column_name = 'machineId'`).length > 0;
    if (coCotMay && !mayThat) {
      throw new Error(`nghiem thu KHONG CHAY DUOC: 0347 da ap (product_surfaces.machineId NOT NULL) nhung bang machines rong tren "${label}"`);
    }
    await appSql`DELETE FROM product_surfaces WHERE "surfaceName" = ${PROBE_SURFACE_NAME}`;
    const [inserted] = coCotMay
      ? await appSql`
          INSERT INTO product_surfaces ("productModelId", "machineId", "surfaceName")
          VALUES (${modelThat.id}, ${mayThat.id}, ${PROBE_SURFACE_NAME})
          RETURNING id`
      : await appSql`
          INSERT INTO product_surfaces ("productModelId", "surfaceName")
          VALUES (${modelThat.id}, ${PROBE_SURFACE_NAME})
          RETURNING id`;
    if (!inserted?.id) {
      throw new Error(`verification failed: avi_app INSERT vao product_surfaces khong tra ve id`);
    }
    const delResult = await appSql`DELETE FROM product_surfaces WHERE "surfaceName" = ${PROBE_SURFACE_NAME}`;
    if (delResult.count !== 1) {
      throw new Error(`verification failed: avi_app DELETE probe xoa ${delResult.count} hang (phai la 1)`);
    }
    console.log(`  [0338] ${label} avi_app INSERT+DELETE product_surfaces OK (productModelId=${modelThat.id}, probe id=${inserted.id})`);

    // ── 3) product_positions / product_captures cũng phải SELECT được bằng avi_app (GRANT phủ đủ 3 bảng).
    await appSql`SELECT count(*)::int n FROM product_positions`;
    await appSql`SELECT count(*)::int n FROM product_captures`;
    console.log(`  [0338] ${label} avi_app SELECT product_positions/product_captures OK`);

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

    console.log(`[0338] ${label}: applied + verified (avi_app SELECT/INSERT/DELETE OK, khong 42501)`);
  } finally {
    await sql.end();
    await appSql.end();
  }
}

const args = process.argv.slice(2);
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error("[0338] DATABASE_URL not set (checked .env)");
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
    console.error(`[0338] ${label} FAILED:`, e?.message ?? e);
  }
}
process.exit(failed ? 1 : 0);
