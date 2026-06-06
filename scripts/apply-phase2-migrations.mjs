/**
 * Apply Phase 2 schema changes:
 * - users.loginAttempts (INTEGER DEFAULT 0)
 * - users.lockedUntil (TIMESTAMP nullable)
 */
import postgres from 'postgres';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Load .env
const envPath = path.join(projectRoot, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx === -1) continue;
    const k = t.substring(0, idx).trim();
    let v = t.substring(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const sql = postgres(process.env.DATABASE_URL, { connect_timeout: 30, max: 1 });

async function addColumnIfMissing(table, column, definition) {
  const [{ exists }] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = ${table} AND column_name = ${column} AND table_schema = 'public'
    ) as exists`;
  if (!exists) {
    await sql.unsafe(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
    console.log(`[OK] ${table}.${column} added`);
  } else {
    console.log(`[SKIP] ${table}.${column} already exists`);
  }
}

try {
  console.log('=== Phase 2 Migration Runner ===\n');

  // Brute-force lockout columns
  await addColumnIfMissing('users', 'loginAttempts', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing('users', 'lockedUntil', 'TIMESTAMP');

  // Record in migration history
  await sql`
    INSERT INTO __applied_migrations (filename, checksum, success)
    VALUES ('0104_phase2_brute_force_lockout.sql', 'phase2-2026-05-19', true)
    ON CONFLICT (filename) DO UPDATE SET applied_at = NOW(), success = true`;

  console.log('\n=== Phase 2 migrations applied successfully ===');
} catch(e) {
  console.error('FATAL:', e.message);
  process.exit(1);
} finally {
  await sql.end();
}
