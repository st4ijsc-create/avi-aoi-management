#!/usr/bin/env node
/**
 * 0330 — cấp bit `ai_repo_read` (canView) cho `engineer` + `admin` (doc 78 PHA A).
 *
 * ⚠⚠ DML PHẢI chạy bằng owner `aoi` (`avi_app` bị 42501). Script tự ĐỔI user trong
 * DATABASE_URL sang `aoi` trừ khi có MIGRATION_DB_URL/MIGRATION_DB_USER đè lên.
 *
 * ⚠⚠ NGHIỆM THU **ĐO TRẠNG THÁI THẬT SAU KHI CHẠY**, không tin "lệnh đã chạy xong":
 *   (a) MỌI tài khoản vai `engineer`/`admin` đều có hàng `ai_repo_read` với `canView = true`;
 *   (b) **KHÔNG** tài khoản vai khác nào có hàng ấy — đây là vế chống "cấp rộng tay", và nó là
 *       vế duy nhất phát biểu được điều chủ dự án thật sự quyết (*ghim theo vai*);
 *   (c) mọi hàng đều VIEW-ONLY: `canCreate/canEdit/canDelete/canExport` đều `false` — pha C sẽ xin
 *       `canEdit` riêng, nên một `canEdit = true` lọt vào đây là mở trước cửa của pha sau.
 *
 * ⚠ CHỐNG "LƯỢNG TỪ TỰ THOẢ": nếu CSDL không có tài khoản `engineer`/`admin` nào thì (a) đúng một
 *   cách rỗng tuếch. Script vì thế ĐẾM số tài khoản mục tiêu và **VỠ** khi bằng 0 — một lượt cấp
 *   quyền cho 0 người không phải "thành công", nó là "chưa đo được gì".
 *
 *   node scripts/apply-migration-0330.mjs            # dev + test
 *   node scripts/apply-migration-0330.mjs --dev-only
 *   node scripts/apply-migration-0330.mjs --test-only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0330_grant_ai_repo_read_engineer.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);
const MODULE = "ai_repo_read";
const VAI = ["engineer", "admin"];

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

/** `avi_app` không có quyền ghi bảng quyền — ép sang owner `aoi`. */
function asOwner(url) {
  if (process.env.MIGRATION_DB_URL) return process.env.MIGRATION_DB_URL;
  const u = new URL(url);
  u.username = process.env.MIGRATION_DB_USER ?? "aoi";
  u.password = process.env.MIGRATION_DB_PASSWORD ?? "aoi";
  return u.toString();
}

async function applyTo(rawUrl, label) {
  const sql = postgres(asOwner(rawUrl), { max: 1, onnotice: (n) => console.log(`  [0330] ${label} NOTICE: ${n.message}`) });
  try {
    const [truoc] = await sql`
      SELECT
        (SELECT count(*)::int FROM users WHERE role = ANY(${VAI})) AS muc_tieu,
        (SELECT count(*)::int FROM permissions WHERE "moduleName" = ${MODULE}) AS da_co`;
    console.log(`  [0330] ${label} TRƯỚC: tài khoản engineer+admin=${truoc.muc_tieu} · hàng ${MODULE} đã có=${truoc.da_co}`);

    const content = fs.readFileSync(MIGRATION_PATH, "utf-8");
    await sql.unsafe(content);

    // ── NGHIỆM THU: đo lại TRẠNG THÁI, không tin lệnh ─────────────────────────────────────────
    const [sau] = await sql`
      SELECT
        (SELECT count(*)::int FROM users WHERE role = ANY(${VAI})) AS muc_tieu,
        (SELECT count(*)::int FROM users u
           WHERE u.role = ANY(${VAI})
             AND NOT EXISTS (SELECT 1 FROM permissions p
                             WHERE p."userId" = u.id AND p."moduleName" = ${MODULE} AND p."canView")) AS con_thieu,
        (SELECT count(*)::int FROM permissions p
           JOIN users u ON u.id = p."userId"
           WHERE p."moduleName" = ${MODULE} AND NOT (u.role = ANY(${VAI}))) AS cap_lan,
        (SELECT count(*)::int FROM permissions
           WHERE "moduleName" = ${MODULE}
             AND ("canCreate" OR "canEdit" OR "canDelete" OR "canExport")) AS khong_view_only,
        (SELECT count(*)::int FROM permissions WHERE "moduleName" = ${MODULE}) AS tong`;

    const loi = [];
    if (sau.muc_tieu === 0) loi.push("KHÔNG có tài khoản engineer/admin nào ⇒ phép đo là chân lý rỗng, không phải thành công");
    if (sau.con_thieu !== 0) loi.push(`${sau.con_thieu} tài khoản engineer/admin vẫn KHÔNG có canView`);
    if (sau.cap_lan !== 0) loi.push(`${sau.cap_lan} hàng ${MODULE} nằm trên vai KHÁC engineer/admin ⇒ cấp rộng tay`);
    if (sau.khong_view_only !== 0) loi.push(`${sau.khong_view_only} hàng KHÔNG view-only ⇒ mở trước cửa của pha C`);
    if (loi.length > 0) throw new Error(`verification failed (${label}): ${loi.join(" · ")}`);
    console.log(`  [0330] ${label} SAU: ${sau.tong} hàng ${MODULE}, đủ cho ${sau.muc_tieu} tài khoản, 0 cấp lan, 0 hàng ghi`);

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
    console.log(`  [0330] ${label} ✔ đã áp + nghiệm thu`);
  } finally {
    await sql.end();
  }
}

const base = process.env.DATABASE_URL;
if (!base) {
  console.error("[0330] thiếu DATABASE_URL");
  process.exit(1);
}
const devOnly = process.argv.includes("--dev-only");
const testOnly = process.argv.includes("--test-only");
const muc = [];
if (!testOnly) muc.push([base, "dev"]);
if (!devOnly) muc.push([base.replace(/\/aoi_management(\?|$)/, "/aoi_management_test$1"), "test"]);

for (const [url, label] of muc) {
  await applyTo(url, label);
}
console.log("[0330] XONG");
