#!/usr/bin/env node
/**
 * W7-A (doc 27 Đợt 7 — programReleaseId stamping) — targeted apply of
 * drizzle/0187_product_inspections_program_release.sql to the dev DB
 * (DATABASE_URL from .env) AND the cloned test DB (<db>_test), recording the
 * file in __applied_migrations exactly like migrate-standalone so a later
 * `npm run db:push` does not re-run it. (Pattern: apply-migration-0186.mjs.)
 *
 *   node scripts/apply-migration-0187.mjs            # dev + test
 *   node scripts/apply-migration-0187.mjs --dev-only
 *   node scripts/apply-migration-0187.mjs --test-only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0187_product_inspections_program_release.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);

// ── .env loader (same minimal parser as migrate-standalone) ──────────────────
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

// ── checksum identical to migrate-standalone's simpleHash ────────────────────
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

async function applyTo(url, label) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const content = fs.readFileSync(MIGRATION_PATH, "utf8");
    await sql.unsafe(content);

    // Verify artifacts.
    const [col] = await sql`SELECT count(*)::int AS cnt FROM information_schema.columns WHERE table_name = 'product_inspections' AND column_name = 'programReleaseId'`;
    const [idx] = await sql`SELECT count(*)::int AS cnt FROM pg_indexes WHERE tablename = 'product_inspections' AND indexname = 'idx_inspections_program_release'`;
    if (!col.cnt || !idx.cnt) {
      throw new Error(`verification failed (column=${col.cnt}, index=${idx.cnt})`);
    }

    // Record in the standalone runner's tracking table.
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

    console.log(`[0187] ${label}: applied + verified (product_inspections.programReleaseId + partial index)`);
  } finally {
    await sql.end();
  }
}

const args = process.argv.slice(2);
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error("[0187] DATABASE_URL not set (checked .env)");
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
    // Test DB may not exist on machines that never ran test:db:setup — non-fatal there.
    if (label === "test" && /does not exist/i.test(String(err?.message))) {
      console.warn(`[0187] ${label}: database not found — run \`npm run test:db:setup\` first (it clones dev incl. 0187).`);
    } else {
      console.error(`[0187] ${label}: FAILED —`, err?.message ?? err);
      process.exitCode = 1;
    }
  }
}
