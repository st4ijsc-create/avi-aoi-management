#!/usr/bin/env node
/**
 * 0326 — THỐNG KÊ PLANNER cho `measurement_results` × `product_inspections`.
 *
 * ⚠⚠ DDL PHẢI chạy bằng owner `aoi` (`avi_app` bị 42501). Script tự ĐỔI user trong
 * DATABASE_URL sang `aoi` trừ khi có MIGRATION_DB_URL/MIGRATION_DB_USER đè lên.
 *
 *   node scripts/apply-migration-0326.mjs            # dev + test
 *   node scripts/apply-migration-0326.mjs --dev-only
 *   node scripts/apply-migration-0326.mjs --test-only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0326_measurement_results_planner_stats.sql";
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
  const url = asOwner(rawUrl);
  const sql = postgres(url, { max: 1, onnotice: (n) => console.log(`  [0326] ${label} NOTICE: ${n.message}`) });
  try {
    // ANALYZE trên hypertable lớn có thể lâu hơn statement_timeout mặc định của app.
    await sql.unsafe(`SET statement_timeout = '600s'`);
    const content = fs.readFileSync(MIGRATION_PATH, "utf8");
    await sql.unsafe(content);

    // ── NGHIỆM THU: thống kê ĐÃ CÓ THẬT chưa? ────────────────────────────────────────────
    // `reltuples = -1` nghĩa là "planner chưa biết gì" — đúng trạng thái đã gây ra kế hoạch
    // 184 giây. Sau migration, MỌI chunk có dữ liệu phải khai một con số >= 0.
    const [stale] = await sql`
      SELECT count(*)::int AS n
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND c.reltuples < 0
        AND (
          c.relname IN ('measurement_results', 'product_inspections')
          OR EXISTS (
            SELECT 1 FROM timescaledb_information.chunks ch
            WHERE ch.chunk_schema = n.nspname AND ch.chunk_name = c.relname
              AND ch.hypertable_name IN ('measurement_results', 'product_inspections')
          )
        )`;
    if (stale.n > 0) throw new Error(`verification failed: ${stale.n} bang/chunk van co reltuples < 0 sau ANALYZE`);

    // Index PHẢI còn đó (đo: bỏ đi ⇒ chậm 555 lần ở quy mô 5 triệu hàng).
    const [idx] = await sql`
      SELECT count(*)::int AS n FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'measurement_results'
        AND indexdef LIKE '%("inspectionId"%'`;
    if (idx.n < 1) throw new Error("verification failed: khong con index nao dan dau bang \"inspectionId\"");

    const [opt] = await sql`
      SELECT count(*)::int AS n FROM pg_class
      WHERE relname IN ('measurement_results', 'product_inspections')
        AND array_to_string(reloptions, ',') LIKE '%autovacuum_analyze_scale_factor=0.02%'`;
    if (opt.n < 2) throw new Error("verification failed: reloptions autoanalyze chua duoc dat tren ca hai hypertable");

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

    console.log(`[0326] ${label}: applied + verified (ANALYZE xong, index inspectionId con nguyen, __applied_migrations = 1 hang)`);
  } finally {
    await sql.end();
  }
}

const args = process.argv.slice(2);
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error("[0326] DATABASE_URL not set (checked .env)");
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
      console.warn(`[0326] ${label}: database not found — run \`node scripts/setup-test-db.mjs\` first.`);
    } else {
      console.error(`[0326] ${label}: FAILED —`, err?.message ?? err);
      process.exitCode = 1;
    }
  }
}
