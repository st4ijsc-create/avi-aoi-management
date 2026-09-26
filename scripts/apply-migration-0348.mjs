#!/usr/bin/env node
/**
 * 0348 — Lô 7 Mục 1 (BG-111). DROP NOT NULL cho
 * `threshold_approvals."proposedLsl"/"proposedUsl"` (docblock đầy đủ trong
 * `drizzle/0348_bo_not_null_de_xuat_lsl_usl.sql`).
 *
 * ⚠⚠ DDL PHẢI chạy bằng owner `aoi` (`avi_app` bị 42501). Script tự ĐỔI user
 * trong DATABASE_URL sang `aoi` trừ khi có MIGRATION_DB_URL/MIGRATION_DB_USER
 * đè lên — cùng khuôn `scripts/apply-migration-0338.mjs`/`0347.mjs`.
 *
 * ⚠⚠ CẦU CHÌ NGHIỆM THU (tái dùng nguyên văn `apply-migration-0338.mjs:74-84`):
 * đọc `rolsuper`/`rolbypassrls` của vai nghiệm thu và **TỪ CHỐI CHẠY** nếu đó là
 * superuser — `aoi` bỏ qua mọi kiểm tra quyền nên một phép đo bằng nó là XANH GIẢ.
 *
 * ⚠ Migration này **KHÔNG có một câu DELETE/UPDATE nào** — chỉ DROP NOT NULL,
 * tái-chạy-được tự nhiên (BG-95: không tạo lại ràng buộc nào bị bỏ).
 *
 *   node scripts/apply-migration-0348.mjs            # dev + test
 *   node scripts/apply-migration-0348.mjs --dev-only
 *   node scripts/apply-migration-0348.mjs --test-only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0348_bo_not_null_de_xuat_lsl_usl.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);

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
  const sql = postgres(ownerUrl, { max: 1, onnotice: (n) => console.log(`  [0348] ${label} NOTICE: ${n.message}`) });
  const appSql = postgres(rawUrl, { max: 1, onnotice: () => {} });
  try {
    // ── 0) CẦU CHÌ: vai nghiệm thu phải là vai ỨNG DỤNG, không phải superuser.
    const [vai] = await appSql`
      SELECT current_user AS u, r.rolsuper, r.rolbypassrls
      FROM pg_roles r WHERE r.rolname = current_user`;
    if (vai.rolsuper || vai.rolbypassrls) {
      throw new Error(
        `nghiem thu VO NGHIA: vai "${vai.u}" co rolsuper=${vai.rolsuper} rolbypassrls=${vai.rolbypassrls} ` +
        `=> khong the do quyen bang vai nay. Phai do bang vai ung dung khong dac quyen (avi_app).`,
      );
    }
    const [db0] = await appSql`SELECT current_database() AS d`;
    console.log(`  [0348] ${label} nghiệm thu: current_database()=${db0.d} vai="${vai.u}" (rolsuper=${vai.rolsuper}, rolbypassrls=${vai.rolbypassrls})`);

    // ── 1) ĐO TRƯỚC — information_schema.columns + số hàng theo status (Đ-28).
    const truoc = await appSql`
      SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'threshold_approvals' AND column_name IN ('proposedLsl','proposedUsl')
       ORDER BY column_name`;
    const truocMap = Object.fromEntries(truoc.map((r) => [r.column_name, r.is_nullable]));
    const [soHang] = await appSql`SELECT count(*)::int AS n FROM threshold_approvals`;
    const theoStatus = await appSql`SELECT status, count(*)::int AS n FROM threshold_approvals GROUP BY status ORDER BY status`;
    console.log(`  [0348] ${label} TRƯỚC: proposedLsl.is_nullable=${truocMap.proposedLsl} proposedUsl.is_nullable=${truocMap.proposedUsl} tong_hang=${soHang.n} theo_status=${JSON.stringify(theoStatus)}`);

    const content = fs.readFileSync(MIGRATION_PATH, "utf8");
    await sql.unsafe(content);
    console.log(`[0348] ${label}: DDL applied (owner aoi)`);

    // ── 2) HÀNH VI THẬT bằng vai avi_app: information_schema SAU + ghi thử một
    //      hàng CHỈ đề xuất heightMax (proposedLsl/Usl NULL) để CHỨNG MINH ràng
    //      buộc thật sự đã gỡ (không chỉ đọc catalog rồi tin).
    const sau = await appSql`
      SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'threshold_approvals' AND column_name IN ('proposedLsl','proposedUsl')
       ORDER BY column_name`;
    const sauMap = Object.fromEntries(sau.map((r) => [r.column_name, r.is_nullable]));
    if (sauMap.proposedLsl !== "YES" || sauMap.proposedUsl !== "YES") {
      throw new Error(`verification failed (${label}): SAU migration proposedLsl=${sauMap.proposedLsl} proposedUsl=${sauMap.proposedUsl} — phải cả hai YES (nullable)`);
    }
    console.log(`  [0348] ${label} (a) information_schema SAU: proposedLsl.is_nullable=YES proposedUsl.is_nullable=YES — OK`);

    const [pointDef] = await appSql`SELECT id FROM measurement_point_defs ORDER BY id LIMIT 1`;
    if (!pointDef) throw new Error(`nghiem thu KHONG CHAY DUOC: measurement_point_defs rỗng trên "${label}"`);
    const [probe] = await appSql`
      INSERT INTO threshold_approvals
        ("pointDefId", "requestedBy", suggestion, "proposedLsl", "proposedUsl", status)
      VALUES (${pointDef.id}, -1, ${appSql.json({ deXuat: { heightMax: "9.999000" }, probe: "PROBE-0348" })}, NULL, NULL, 'requested')
      RETURNING id`;
    if (!probe?.id) throw new Error(`verification failed (${label}): INSERT chỉ-heightMax (proposedLsl/Usl NULL) không trả id — ràng buộc NOT NULL vẫn còn`);
    const del = await appSql`DELETE FROM threshold_approvals WHERE id = ${probe.id}`;
    if (del.count !== 1) throw new Error(`verification failed (${label}): DELETE probe xoá ${del.count} hàng (phải là 1)`);
    console.log(`  [0348] ${label} (b) INSERT hàng chỉ-heightMax (proposedLsl/Usl NULL) + DELETE probe OK (id=${probe.id})`);

    // ── 3) KHÔNG mất dữ liệu: tổng hàng + phân bố theo status phải Y NGUYÊN.
    const [soHangSau] = await appSql`SELECT count(*)::int AS n FROM threshold_approvals`;
    if (soHangSau.n !== soHang.n) {
      throw new Error(`verification failed (${label}): threshold_approvals ${soHang.n} → ${soHangSau.n} — migration này KHÔNG được đụng một hàng nào`);
    }
    console.log(`  [0348] ${label} (c) threshold_approvals vẫn ${soHangSau.n} hàng — không mất dữ liệu`);

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

    console.log(`[0348] ${label}: applied + verified (3 phép đo hành vi bằng vai avi_app)`);
  } finally {
    await sql.end();
    await appSql.end();
  }
}

const args = process.argv.slice(2);
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error("[0348] DATABASE_URL not set (checked .env)");
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
    console.error(`[0348] ${label} FAILED:`, e?.message ?? e);
  }
}
process.exit(failed ? 1 : 0);
