#!/usr/bin/env node
/**
 * Áp `drizzle/0324_defect_heatmap_data_factory_scope.sql` lên CSDL dev (DATABASE_URL trong .env)
 * VÀ CSDL test đã nhân bản (`<db>_test`), ghi tên file vào `__applied_migrations` y hệt
 * migrate-standalone để `npm run db:push` sau này không chạy lại.
 *
 * ⚠ DDL PHẢI chạy bằng OWNER `aoi`. `.env` trỏ `DATABASE_URL` vào `avi_app` (doc48 R1 WORM) —
 *   vai đó chỉ có DML nên `ALTER TABLE` sẽ 42501 permission denied. Script vì thế THAY vai
 *   trong chuỗi kết nối bằng `MIGRATION_DB_USER`/`MIGRATION_DB_PASSWORD` (mặc định `aoi`/`aoi`),
 *   giữ nguyên host/port/tên CSDL lấy từ `.env` — không có URL nào bị viết cứng.
 *
 *   node scripts/apply-migration-0324.mjs            # dev + test
 *   node scripts/apply-migration-0324.mjs --dev-only
 *   node scripts/apply-migration-0324.mjs --test-only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0324_defect_heatmap_data_factory_scope.sql";
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

/** checksum giống hệt simpleHash của migrate-standalone. */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/** Đổi vai sang owner DDL, giữ nguyên host/port/db. */
function asOwner(url) {
  const u = new URL(url);
  u.username = process.env.MIGRATION_DB_USER || "aoi";
  u.password = process.env.MIGRATION_DB_PASSWORD || "aoi";
  return u.toString();
}

async function applyTo(url, label) {
  const sql = postgres(asOwner(url), { max: 1, onnotice: () => {} });
  try {
    const content = fs.readFileSync(MIGRATION_PATH, "utf8");
    await sql.unsafe(content);

    // Nghiệm thu artefact: hai cột phải TỒN TẠI và phải NULLable (fail-closed đọc dựa vào đó).
    const cols = await sql`
      SELECT column_name, is_nullable, character_maximum_length AS len
        FROM information_schema.columns
       WHERE table_name = 'defect_heatmap_data'
         AND column_name IN ('corporateCode', 'factoryCode')`;
    if (cols.length !== 2) throw new Error(`verification failed: expected 2 scope columns, got ${cols.length}`);
    for (const c of cols) {
      if (c.is_nullable !== "YES") throw new Error(`verification failed: ${c.column_name} must stay NULLable`);
    }
    const [rows] = await sql`
      SELECT count(*)::int AS total,
             count("factoryCode")::int AS with_factory_code
        FROM defect_heatmap_data`;

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
    const [tracked] = await sql`SELECT count(*)::int AS n FROM "__applied_migrations" WHERE filename = ${MIGRATION_FILE}`;

    console.log(
      `[0324] ${label}: applied + verified — corporateCode/factoryCode NULLable; ` +
      `rows=${rows.total}, with factoryCode=${rows.with_factory_code}; __applied_migrations rows for this file=${tracked.n}`,
    );
  } finally {
    await sql.end();
  }
}

const args = process.argv.slice(2);
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error("[0324] DATABASE_URL not set (checked .env)");
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

for (const [url, label] of targets) {
  try {
    await applyTo(url, label);
  } catch (err) {
    if (label === "test" && /does not exist/i.test(String(err?.message))) {
      console.warn(`[0324] ${label}: database not found — run \`node scripts/setup-test-db.mjs\` first.`);
    } else {
      console.error(`[0324] ${label}: FAILED —`, err?.message ?? err);
      process.exitCode = 1;
    }
  }
}
