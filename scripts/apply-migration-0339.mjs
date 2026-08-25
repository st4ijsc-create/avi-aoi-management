#!/usr/bin/env node
/**
 * 0339 — cây KẾT QUẢ 3 cấp: `inspection_surfaces` → `inspection_positions` →
 * `inspection_captures` (FK thật GIỮA CHÚNG, ON DELETE CASCADE), soft-ref lên
 * `product_inspections` (hypertable — Postgres cấm FK tới nó). Mở rộng
 * `product_inspections` (+4 cột) và `measurement_results` (+8 cột), tất cả NULLABLE.
 *
 * ⚠⚠ HAI HYPERTABLE ĐÃ BẬT NÉN (`product_inspections`, `measurement_results`).
 * Mọi cột mới PHẢI nullable — KHÔNG NOT NULL DEFAULT (chưa chứng minh an toàn trên
 * chunk đã nén). Nếu ALTER TABLE báo lỗi liên quan nén/compression/chunk, script
 * này KHÔNG bắt và vòng qua — nó literally throw và dừng, để người vận hành đọc
 * nguyên văn lỗi.
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
 *   node scripts/apply-migration-0339.mjs            # dev + test
 *   node scripts/apply-migration-0339.mjs --dev-only
 *   node scripts/apply-migration-0339.mjs --test-only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0339_inspection_result_tree.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);
const PROBE_SURFACE_NAME = "_probe_0339";
// Soft ref — không có FK thật tới product_inspections nên bất kỳ số nguyên nào cũng
// hợp lệ ở CSDL; chọn một giá trị KHÔNG THỂ trùng id thật (âm) để không lẫn với dữ
// liệu sản xuất.
const PROBE_INSPECTION_ID = -999000339;

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
  const sql = postgres(ownerUrl, { max: 1, onnotice: (n) => console.log(`  [0339] ${label} NOTICE: ${n.message}`) });
  // Kết nối NGHIỆM THU bằng ĐÚNG vai ứng dụng — `aoi` bỏ qua mọi kiểm tra quyền nên đo bằng nó vô nghĩa.
  const appSql = postgres(rawUrl, { max: 1, onnotice: () => {} });
  try {
    const content = fs.readFileSync(MIGRATION_PATH, "utf8");
    try {
      await sql.unsafe(content);
    } catch (ddlErr) {
      const msg = String(ddlErr?.message ?? ddlErr);
      if (/compress|chunk/i.test(msg)) {
        throw new Error(
          `BLOCKED (${label}): ALTER TABLE bao loi lien quan NEN/CHUNK, DUNG NGAY, KHONG thu giai nen. ` +
          `Nguyen van loi: ${msg}`,
        );
      }
      throw ddlErr;
    }
    console.log(`[0339] ${label}: DDL applied (owner aoi)`);

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
    console.log(`  [0339] ${label} nghiệm thu chạy bằng vai "${vai.u}" (rolsuper=${vai.rolsuper}, rolbypassrls=${vai.rolbypassrls})`);

    // ── 1) SELECT phải chạy được trên cả 3 bảng mới, không 42501.
    await appSql`SELECT count(*)::int n FROM inspection_surfaces`;
    await appSql`SELECT count(*)::int n FROM inspection_positions`;
    await appSql`SELECT count(*)::int n FROM inspection_captures`;
    console.log(`  [0339] ${label} avi_app SELECT inspection_surfaces/positions/captures OK`);

    // ── 2) SELECT các cột MỚI trên hai hypertable phải chạy được (không 42703/42501).
    await appSql`SELECT "ntfSource", "machineProductIndex", "configDriftFlags", "summaryCounts" FROM product_inspections LIMIT 1`;
    await appSql`SELECT "captureRowId", "componentExtId", "ntf", "ntfSource", "errorCode", "errorDesc", "startedAt", "completedAt" FROM measurement_results LIMIT 1`;
    console.log(`  [0339] ${label} avi_app SELECT cột mới trên product_inspections/measurement_results OK`);

    // ── 3) INSERT phải chạy được trên cả 3 bảng mới, dựng một chuỗi surface → position →
    //     capture THẬT bằng vai avi_app, rồi XOÁ surface và xác nhận CASCADE THẬT xoá sạch
    //     position + capture con (không phải suy diễn từ SQL, đo bằng SELECT count sau khi xoá).
    await appSql`DELETE FROM inspection_surfaces WHERE "surfaceName" = ${PROBE_SURFACE_NAME}`;
    const [surface] = await appSql`
      INSERT INTO inspection_surfaces ("inspectionId", "inspectionTime", "surfaceName", "result", "rolledResult")
      VALUES (${PROBE_INSPECTION_ID}, now(), ${PROBE_SURFACE_NAME}, 'OK', 'OK')
      RETURNING id`;
    if (!surface?.id) throw new Error(`verification failed: avi_app INSERT vao inspection_surfaces khong tra ve id`);

    const [position] = await appSql`
      INSERT INTO inspection_positions ("surfaceRowId", "inspectionId", "inspectionTime", "positionId", "result", "rolledResult")
      VALUES (${surface.id}, ${PROBE_INSPECTION_ID}, now(), 'P1', 'OK', 'OK')
      RETURNING id`;
    if (!position?.id) throw new Error(`verification failed: avi_app INSERT vao inspection_positions khong tra ve id`);

    const [capture] = await appSql`
      INSERT INTO inspection_captures ("positionRowId", "inspectionId", "inspectionTime", "captureExtId", "result", "rolledResult")
      VALUES (${position.id}, ${PROBE_INSPECTION_ID}, now(), 'C1', 'OK', 'OK')
      RETURNING id`;
    if (!capture?.id) throw new Error(`verification failed: avi_app INSERT vao inspection_captures khong tra ve id`);

    console.log(`  [0339] ${label} avi_app INSERT chuỗi surface(${surface.id})→position(${position.id})→capture(${capture.id}) OK`);

    const delResult = await appSql`DELETE FROM inspection_surfaces WHERE id = ${surface.id}`;
    if (delResult.count !== 1) {
      throw new Error(`verification failed: avi_app DELETE probe surface xoa ${delResult.count} hang (phai la 1)`);
    }
    const [conPosition] = await appSql`SELECT count(*)::int n FROM inspection_positions WHERE id = ${position.id}`;
    const [conCapture] = await appSql`SELECT count(*)::int n FROM inspection_captures WHERE id = ${capture.id}`;
    if (conPosition.n !== 0 || conCapture.n !== 0) {
      throw new Error(
        `verification failed: CASCADE KHONG that — sau khi xoa surface con lai position=${conPosition.n} capture=${conCapture.n} (phai la 0/0)`,
      );
    }
    console.log(`  [0339] ${label} CASCADE THẬT xác nhận: xoá surface(${surface.id}) ⇒ position(${position.id})=0 hàng, capture(${capture.id})=0 hàng`);

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

    console.log(`[0339] ${label}: applied + verified (avi_app SELECT/INSERT/DELETE OK, CASCADE thật OK, khong 42501)`);
  } finally {
    await sql.end();
    await appSql.end();
  }
}

const args = process.argv.slice(2);
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error("[0339] DATABASE_URL not set (checked .env)");
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
    console.error(`[0339] ${label} FAILED:`, e?.message ?? e);
  }
}
process.exit(failed ? 1 : 0);
