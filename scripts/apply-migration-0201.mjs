#!/usr/bin/env node
/**
 * Doc 31 Đợt E (WE-3, WB-2 finding) — targeted apply of
 * drizzle/0201_defect_taxonomy_consolidation.sql to the dev DB (DATABASE_URL from
 * .env) AND the cloned test DB (<db>_test), recording the file in
 * __applied_migrations so a later `npm run db:push` does not re-run it.
 * (Pattern: apply-migration-0197.mjs.)
 *
 *   node scripts/apply-migration-0201.mjs            # dev + test
 *   node scripts/apply-migration-0201.mjs --dev-only
 *   node scripts/apply-migration-0201.mjs --test-only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0201_defect_taxonomy_consolidation.sql";
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

const DUP_CODES = ["SOLDER_BRIDGE", "COLD_SOLDER", "SOLDER_VOID", "MISALIGNMENT", "REVERSED_POLARITY"];

async function applyTo(url, label) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const content = fs.readFileSync(MIGRATION_PATH, "utf8");
    await sql.unsafe(content);

    // Verify: aliasOfCode column exists + all 5 duplicates retired & aliased.
    const [col] = await sql`SELECT count(*)::int AS cnt FROM information_schema.columns WHERE table_name='defect_catalog' AND column_name='aliasOfCode'`;
    const retired = await sql`SELECT code, "isActive", "aliasOfCode" FROM defect_catalog WHERE code = ANY(${DUP_CODES}) ORDER BY code`;
    const badRows = retired.filter((r) => r.isActive === true || !r.aliasOfCode);
    if (!col.cnt || retired.length !== DUP_CODES.length || badRows.length > 0) {
      throw new Error(`verification failed (col=${col.cnt}, retired=${retired.length}/${DUP_CODES.length}, bad=${JSON.stringify(badRows)})`);
    }

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

    console.log(`[0201] ${label}: applied + verified — ${retired.map((r) => `${r.code}→${r.aliasOfCode}`).join(", ")}`);
  } finally {
    await sql.end();
  }
}

const args = process.argv.slice(2);
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error("[0201] DATABASE_URL not set (checked .env)");
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
      console.warn(`[0201] ${label}: database not found — run \`npm run test:db:setup\` first (it clones dev incl. 0201).`);
    } else {
      console.error(`[0201] ${label}: FAILED —`, err?.message ?? err);
      process.exitCode = 1;
    }
  }
}
