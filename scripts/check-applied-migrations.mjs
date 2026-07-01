#!/usr/bin/env node
/**
 * Migration apply-state VERIFIER (doc 22 §C P0.3).
 *
 * Source of truth for what is applied is the `__applied_migrations` table (written by
 * scripts/migrate-standalone.mjs a.k.a. `npm run db:push`). NOTE: drizzle-kit's
 * drizzle/meta/_journal.json is VESTIGIAL here (frozen at an early index) — this repo
 * runs standalone migrations, so `_journal.json` is NOT the apply-state and should not
 * be used to judge it.
 *
 * This tool:
 *   1. reads DATABASE_URL from .env / env (NOT a hardcoded password),
 *   2. lists the tail of `__applied_migrations`,
 *   3. RECONCILES drizzle/*.sql on disk against the table and flags any file that is
 *      missing (never applied) or recorded success=false — with a focus on the
 *      automation range (0141+).
 *
 * Usage:
 *   node scripts/check-applied-migrations.mjs
 *   DATABASE_URL=postgresql://user:pass@host:5432/db node scripts/check-applied-migrations.mjs
 *   node scripts/check-applied-migrations.mjs --from 0141   (reconcile from this prefix)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Args ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const fromIdx = args.indexOf('--from');
const FROM_PREFIX = fromIdx >= 0 ? args[fromIdx + 1] : '0141'; // default: automation range

// ── Minimal .env loader (same convention as migrate-standalone.mjs) ──
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.substring(0, idx).trim();
    let value = trimmed.substring(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(path.join(process.cwd(), '.env'));
loadEnvFile(path.join(__dirname, '..', '.env'));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set (in .env or environment).');
  console.error('       Example: DATABASE_URL=postgresql://postgres:password@localhost:5432/avi_aoi_db');
  process.exit(2);
}

const DRIZZLE_DIR = path.join(__dirname, '..', 'drizzle');
const onDisk = fs.existsSync(DRIZZLE_DIR)
  ? fs.readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith('.sql')).sort()
  : [];

const { default: postgres } = await import('postgres');
const needsSsl = DATABASE_URL.includes('sslmode=require') || DATABASE_URL.includes('ssl=true');
const sql = postgres(DATABASE_URL, { ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}), connect_timeout: 30, max: 1 });

let exitCode = 0;
try {
  const displayUrl = DATABASE_URL.replace(/:([^@:]+)@/, ':****@');
  console.log(`Database: ${displayUrl}`);

  const tableExists = await sql`SELECT to_regclass('public.__applied_migrations') IS NOT NULL AS ok`;
  if (!tableExists[0]?.ok) {
    console.error('\n__applied_migrations table does NOT exist — no migrations have been run via db:push.');
    process.exit(1);
  }

  const rows = await sql`SELECT filename, applied_at, success FROM "__applied_migrations" ORDER BY applied_at DESC`;
  const appliedOk = new Map(rows.filter((r) => r.success).map((r) => [r.filename, r.applied_at]));
  const appliedFail = new Set(rows.filter((r) => !r.success).map((r) => r.filename));

  console.log('\n=== Last 15 applied migrations ===');
  rows.slice(0, 15).forEach((r) => console.log(`  ${r.success ? 'OK  ' : 'FAIL'} ${r.filename}  (${r.applied_at?.toISOString?.() ?? r.applied_at})`));

  // Reconcile disk vs DB for the requested range (default automation 0141+).
  const inRange = onDisk.filter((f) => f >= FROM_PREFIX);
  const missing = inRange.filter((f) => !appliedOk.has(f));
  const failed = inRange.filter((f) => appliedFail.has(f) && !appliedOk.has(f));

  console.log(`\n=== Reconcile drizzle/*.sql >= "${FROM_PREFIX}" (${inRange.length} files) ===`);
  if (missing.length === 0) {
    console.log('  ✓ All on-disk migrations in range are recorded success=true.');
  } else {
    exitCode = 1;
    console.log(`  ✗ ${missing.length} migration file(s) NOT applied (missing from __applied_migrations):`);
    missing.forEach((f) => console.log(`      - ${f}${appliedFail.has(f) ? '  (last attempt FAILED)' : ''}`));
  }
  if (failed.length > 0) {
    console.log(`  ⚠ ${failed.length} recorded as FAILED (success=false): ${failed.join(', ')}`);
  }
} catch (e) {
  console.error('Error:', e.message);
  exitCode = 2;
} finally {
  await sql.end();
}
process.exit(exitCode);
