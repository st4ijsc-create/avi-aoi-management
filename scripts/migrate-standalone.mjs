#!/usr/bin/env node
/**
 * Standalone Database Migration Runner
 * 
 * Chạy tất cả migration SQL files trong thư mục drizzle/ lên PostgreSQL.
 * Không phụ thuộc drizzle-kit, chỉ cần driver `postgres` (đã có trong node_modules).
 * 
 * Cách sử dụng:
 *   node migrate.mjs                    (đọc DATABASE_URL từ file .env)
 *   DATABASE_URL=postgresql://... node migrate.mjs
 *   node migrate.mjs --dry-run          (xem danh sách migration sẽ chạy, không thực thi)
 *   node migrate.mjs --force            (chạy lại tất cả, kể cả đã applied)
 * 
 * Tracking:
 *   Tạo bảng __applied_migrations để theo dõi migration đã chạy.
 *   Mỗi file .sql chỉ chạy 1 lần (trừ khi dùng --force).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Parse arguments ──────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
// Strict mode (Phase 0 WS0.1): fail-fast on genuine errors instead of
// silently continuing. "already exists" errors and legacy MySQL files remain
// tolerated. Opt-in via --strict or MIGRATE_STRICT=1 (default off to preserve
// the existing lenient provisioning behaviour).
const STRICT = args.includes('--strict')
  || process.env.MIGRATE_STRICT === '1'
  || process.env.MIGRATE_STRICT === 'true';

// Legacy migrations that may have been partially applied outside the tracker.
// For these files only, we can treat "already exists" errors as success,
// but ONLY when explicit probe checks confirm key artifacts are present.
const LEGACY_TOLERANT_MIGRATIONS = new Set(
  (process.env.LEGACY_MIGRATION_TOLERANT_LIST ?? '0009_numerous_wilson_fisk.sql')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);

// ─── Load .env file (simple parser, no dependencies needed) ───
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.substring(0, idx).trim();
    let value = trimmed.substring(idx + 1).trim();
    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

// Try to load .env from current directory
loadEnvFile(path.join(process.cwd(), '.env'));
// Also try from script directory (if running from a different cwd)
loadEnvFile(path.join(__dirname, '.env'));

// ─── Resolve drizzle folder ──────────────────────────────────
// Script lives in scripts/, drizzle/ is one level up at project root
const DRIZZLE_DIR = path.join(__dirname, '..', 'drizzle');
if (!fs.existsSync(DRIZZLE_DIR)) {
  console.error('ERROR: drizzle/ folder not found at:', DRIZZLE_DIR);
  console.error('       Expected drizzle/ at the project root.');
  process.exit(1);
}

// ─── Get DATABASE_URL ────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set.');
  console.error('       Set it in .env file or as environment variable.');
  console.error('       Example: DATABASE_URL=postgresql://postgres:password@localhost:5432/avi_aoi_db');
  process.exit(1);
}

// ─── Collect SQL migration files ─────────────────────────────
const sqlFiles = fs.readdirSync(DRIZZLE_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort(); // Sort alphabetically (0000...0080 etc.)

if (sqlFiles.length === 0) {
  console.log('No migration files found in drizzle/ folder.');
  process.exit(0);
}

// ─── Import postgres driver (from node_modules) ──────────────
let postgres;
try {
  const pg = await import('postgres');
  postgres = pg.default;
} catch (e) {
  console.error('ERROR: Cannot import "postgres" driver.');
  console.error('       Make sure node_modules is installed (npm install).');
  console.error('       Error:', e.message);
  process.exit(1);
}

// ─── Connect to database ─────────────────────────────────────
console.log('');
console.log('══════════════════════════════════════════════════════════════');
console.log('  AVI AOI - Database Migration Runner');
console.log('══════════════════════════════════════════════════════════════');

// Mask password in connection string for display
const displayUrl = DATABASE_URL.replace(/:([^@:]+)@/, ':****@');
console.log(`  Database: ${displayUrl}`);
console.log(`  Migrations: ${sqlFiles.length} files found`);
console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : FORCE ? 'FORCE (re-run all)' : 'Normal'}`);
console.log('══════════════════════════════════════════════════════════════');

// Only use SSL if the connection string requests it (e.g. sslmode=require)
const needsSsl = DATABASE_URL.includes('sslmode=require') || DATABASE_URL.includes('ssl=true');
const sql = postgres(DATABASE_URL, {
  ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  connect_timeout: 30,
  max: 1,
});

try {
  // Test connection
  const [{ now }] = await sql`SELECT NOW() as now`;
  console.log(`\n  Connected successfully at ${now}`);
} catch (e) {
  console.error('\nERROR: Cannot connect to database.');
  console.error('       Check DATABASE_URL in .env file.');
  console.error('       Error:', e.message);
  await sql.end();
  process.exit(1);
}

// ─── Create tracking table ───────────────────────────────────
await sql`
  CREATE TABLE IF NOT EXISTS "__applied_migrations" (
    "id" SERIAL PRIMARY KEY,
    "filename" VARCHAR(500) NOT NULL UNIQUE,
    "applied_at" TIMESTAMP DEFAULT NOW(),
    "checksum" VARCHAR(64),
    "success" BOOLEAN DEFAULT true
  )
`;

// ─── Get already-applied migrations ──────────────────────────
let applied = new Set();
if (!FORCE) {
  const rows = await sql`SELECT filename FROM "__applied_migrations" WHERE success = true`;
  applied = new Set(rows.map(r => r.filename));
}

// ─── Filter pending migrations ───────────────────────────────
const pending = sqlFiles.filter(f => !applied.has(f));

if (pending.length === 0) {
  console.log('\n  All migrations are already applied. Database is up to date! ✓');
  await sql.end();
  process.exit(0);
}

console.log(`\n  ${applied.size} migrations already applied`);
console.log(`  ${pending.length} migrations pending:\n`);

for (const file of pending) {
  console.log(`    → ${file}`);
}

if (DRY_RUN) {
  console.log('\n  [DRY RUN] No changes made. Remove --dry-run to apply.');
  await sql.end();
  process.exit(0);
}

// ─── Apply pending migrations ─────────────────────────────────
console.log('\n  Applying migrations...\n');

let successCount = 0;
let failCount = 0;

for (const file of pending) {
  const filePath = path.join(DRIZZLE_DIR, file);
  const content = fs.readFileSync(filePath, 'utf-8').trim();

  if (!content) {
    console.log(`    [SKIP] ${file} (empty file)`);
    continue;
  }

  // Simple checksum (sum of char codes, not crypto - just for tracking)
  const checksum = simpleHash(content);

  // Skip dead legacy MySQL-syntax migrations (Phase 0 WS0.1). These predate
  // the Postgres rebaseline and always errored on Postgres (then got swallowed,
  // producing noisy FAIL rows). Backticks / AUTO_INCREMENT / ENGINE= never
  // appear in valid Postgres DDL, so detection is unambiguous. Record them as
  // applied so they leave the pending list permanently.
  if (isLegacyMysqlMigration(content)) {
    try {
      await sql`
        INSERT INTO "__applied_migrations" (filename, checksum, success)
        VALUES (${file}, ${checksum}, true)
        ON CONFLICT (filename) DO UPDATE SET applied_at = NOW(), checksum = ${checksum}, success = true
      `;
    } catch (_) { /* ignore tracking errors */ }
    console.log(`    [SKIP-LEGACY] ${file} (MySQL-syntax, not applicable to Postgres)`);
    continue;
  }

  try {
    // Split by statement breakpoints (drizzle uses --> statement-breakpoint)
    // Also handle standard semicolons for statements
    const statements = splitStatements(content);
    
    for (const stmt of statements) {
      if (stmt.trim()) {
        await sql.unsafe(stmt);
      }
    }

    // Record success
    await sql`
      INSERT INTO "__applied_migrations" (filename, checksum, success)
      VALUES (${file}, ${checksum}, true)
      ON CONFLICT (filename) DO UPDATE SET 
        applied_at = NOW(),
        checksum = ${checksum},
        success = true
    `;

    successCount++;
    console.log(`    [OK]   ${file}`);
  } catch (e) {
    // Controlled legacy fallback: only allow for known old migrations with
    // already-exists failures and positive probe checks.
    const canTreatAsLegacySuccess = await shouldTreatAsLegacySuccess(file, e, sql);
    if (canTreatAsLegacySuccess) {
      await sql`
        INSERT INTO "__applied_migrations" (filename, checksum, success)
        VALUES (${file}, ${checksum}, true)
        ON CONFLICT (filename) DO UPDATE SET
          applied_at = NOW(),
          checksum = ${checksum},
          success = true
      `;
      successCount++;
      console.warn(`    [LEGACY-OK] ${file}`);
      console.warn(`               ${e.message}`);
      continue;
    }

    failCount++;
    console.error(`    [FAIL] ${file}`);
    console.error(`           ${e.message}`);
    
    // Record failure
    try {
      await sql`
        INSERT INTO "__applied_migrations" (filename, checksum, success)
        VALUES (${file}, ${checksum}, false)
        ON CONFLICT (filename) DO UPDATE SET 
          applied_at = NOW(),
          checksum = ${checksum},
          success = false
      `;
    } catch (_) { /* ignore tracking errors */ }

    // Strict mode: a genuine (non-"already exists") error stops the run so it
    // is not silently recorded and skipped. "already exists" stays tolerated.
    if (STRICT && !isAlreadyExistsError(e)) {
      console.error('\n  [STRICT] Stopping on genuine migration error (MIGRATE_STRICT enabled).');
      await sql.end();
      process.exit(1);
    }

    // Default (lenient): don't stop on failure - some migrations may fail
    // because tables/columns already exist. The IF NOT EXISTS patterns make
    // this safe for routine provisioning.
  }
}

// ─── Summary ──────────────────────────────────────────────────
console.log('');
console.log('══════════════════════════════════════════════════════════════');
console.log('  MIGRATION COMPLETE');
console.log('══════════════════════════════════════════════════════════════');
console.log(`  ✓ Success: ${successCount}`);
if (failCount > 0) {
  console.log(`  ✗ Failed:  ${failCount}`);
  console.log('');
  console.log('  Some migrations failed. This may be normal if tables/columns');
  console.log('  already exist. Check the errors above.');
}
console.log(`  Total:   ${successCount + failCount} / ${pending.length}`);
console.log('══════════════════════════════════════════════════════════════');

await sql.end();
process.exit(failCount > 0 ? 1 : 0);

// ═══════════════════════════════════════════════════════════════
// Helper functions
// ═══════════════════════════════════════════════════════════════

function splitStatements(content) {
  // Drizzle uses "--> statement-breakpoint" as delimiter
  if (content.includes('--> statement-breakpoint')) {
    return content.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
  }
  
  // For custom migration files, split by semicolons outside of $$ blocks
  // But handle DO $$ ... END $$; blocks correctly
  const statements = [];
  let current = '';
  let inDollarBlock = false;
  
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines and comments at statement boundaries
    if (!trimmed || trimmed.startsWith('--')) {
      if (inDollarBlock) {
        current += line + '\n';
      }
      continue;
    }
    
    current += line + '\n';
    
    // Track $$ blocks
    const dollarMatches = (line.match(/\$\$/g) || []).length;
    if (dollarMatches % 2 !== 0) {
      inDollarBlock = !inDollarBlock;
    }
    
    // If we're not in a $$ block and line ends with ;, it's a statement boundary
    if (!inDollarBlock && trimmed.endsWith(';')) {
      statements.push(current.trim());
      current = '';
    }
  }
  
  if (current.trim()) {
    statements.push(current.trim());
  }
  
  return statements;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function isLegacyMysqlMigration(content) {
  // MySQL-only DDL markers that never appear in valid Postgres migrations.
  // Deliberately conservative: we do NOT key off backticks alone (some valid
  // Postgres files contain a stray backtick in comments/strings). AUTO_INCREMENT
  // and ENGINE=InnoDB are unambiguous and match exactly the dead legacy set.
  // A false negative is harmless (file is simply attempted as before); a false
  // positive (skipping a real Postgres migration) must never happen.
  if (/\bAUTO_INCREMENT\b/i.test(content)) return true;
  if (/\bENGINE\s*=\s*InnoDB\b/i.test(content)) return true;
  return false;
}

function isAlreadyExistsError(error) {
  const code = error?.code;
  const msg = String(error?.message ?? '').toLowerCase();
  return code === '42710' || code === '42P07' || msg.includes('already exists');
}

async function shouldTreatAsLegacySuccess(file, error, sql) {
  if (!LEGACY_TOLERANT_MIGRATIONS.has(file)) return false;
  if (!isAlreadyExistsError(error)) return false;

  // Probe checks per migration. Keep minimal and deterministic.
  if (file === '0009_numerous_wilson_fisk.sql') {
    const [{ hasEnum }] = await sql`
      SELECT EXISTS(
        SELECT 1 FROM pg_type WHERE typname = 'aipendingactionstatus'
      ) AS "hasEnum"
    `;
    const [{ hasTable }] = await sql`
      SELECT to_regclass('public.ai_pending_actions') IS NOT NULL AS "hasTable"
    `;
    return Boolean(hasEnum && hasTable);
  }

  return false;
}
