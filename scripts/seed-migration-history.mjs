/**
 * One-time script: marks all existing SQL migration files as 'success=true'
 * in __applied_migrations, so future runs only apply truly NEW files.
 *
 * Safe to run: uses ON CONFLICT DO UPDATE so duplicate entries are just updated.
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

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }

const sql = postgres(DATABASE_URL, { connect_timeout: 30, max: 1 });

const DRIZZLE_DIR = path.join(projectRoot, 'drizzle');
const sqlFiles = fs.readdirSync(DRIZZLE_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort();

console.log(`Found ${sqlFiles.length} SQL files. Marking all as applied...`);

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

try {
  await sql`
    CREATE TABLE IF NOT EXISTS __applied_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(500) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT NOW(),
      checksum VARCHAR(64),
      success BOOLEAN DEFAULT true
    )`;

  let count = 0;
  for (const file of sqlFiles) {
    const content = fs.readFileSync(path.join(DRIZZLE_DIR, file), 'utf-8');
    const checksum = simpleHash(content);
    await sql`
      INSERT INTO __applied_migrations (filename, checksum, success)
      VALUES (${file}, ${checksum}, true)
      ON CONFLICT (filename) DO UPDATE SET
        checksum = ${checksum},
        success = true,
        applied_at = COALESCE(__applied_migrations.applied_at, NOW())`;
    count++;
  }
  console.log(`[OK] Marked ${count} migrations as applied (success=true)`);
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
} finally {
  await sql.end();
}
