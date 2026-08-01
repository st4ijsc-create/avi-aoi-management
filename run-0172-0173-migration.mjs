#!/usr/bin/env node
/**
 * Targeted runner for migrations 0172 + 0173 (doc 27 §11 decisions #1/#2):
 *   0172_inspection_hypertables.sql — TimescaleDB hypertables for inspection core
 *   0173_retention_12mo.sql         — native 12-month retention on hypertables
 *
 * Both files are idempotent and self-guarding: on a server WITHOUT timescaledb
 * they RAISE WARNING, record status in db_feature_status and change nothing
 * else. Re-run after moving the DB to timescale/timescaledb-ha (see
 * scripts/migrate-to-timescaledb.md) — use --force to re-apply.
 *
 * Usage:  node run-0172-0173-migration.mjs [--force]
 *         (DATABASE_URL from env or .env)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FORCE = process.argv.includes('--force');

// Minimal .env loader (no deps) — same behaviour as scripts/migrate-standalone.mjs
if (!process.env.DATABASE_URL) {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  }
}
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set (env or .env).');
  process.exit(1);
}

const { default: postgres } = await import('postgres');
const needsSsl = process.env.DATABASE_URL.includes('sslmode=require');
const sql = postgres(process.env.DATABASE_URL, {
  ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  max: 1,
  connect_timeout: 30,
});

const FILES = ['0172_inspection_hypertables.sql', '0173_retention_12mo.sql'];

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

try {
  await sql`
    CREATE TABLE IF NOT EXISTS "__applied_migrations" (
      "id" SERIAL PRIMARY KEY,
      "filename" VARCHAR(500) NOT NULL UNIQUE,
      "applied_at" TIMESTAMP DEFAULT NOW(),
      "checksum" VARCHAR(64),
      "success" BOOLEAN DEFAULT true
    )`;

  for (const file of FILES) {
    const [row] = await sql`SELECT success FROM "__applied_migrations" WHERE filename = ${file}`;
    if (row?.success && !FORCE) {
      console.log(`[skip] ${file} already applied (use --force to re-run — it is idempotent)`);
      continue;
    }
    const content = fs.readFileSync(path.join(__dirname, 'drizzle', file), 'utf-8');
    console.log(`[apply] ${file} ...`);
    // Whole-file unsafe exec (simple-query mode) so DO $$ ... $$ blocks stay intact.
    await sql.unsafe(content);
    await sql`
      INSERT INTO "__applied_migrations" (filename, checksum, success)
      VALUES (${file}, ${simpleHash(content)}, true)
      ON CONFLICT (filename) DO UPDATE SET applied_at = NOW(), checksum = EXCLUDED.checksum, success = true`;
    console.log(`[ok] ${file}`);
  }

  const status = await sql`SELECT feature, status, detail FROM db_feature_status ORDER BY feature`;
  console.log('\ndb_feature_status:');
  for (const s of status) console.log(`  ${s.feature}: ${s.status} — ${s.detail}`);

  const hyper = await sql`
    SELECT hypertable_name FROM timescaledb_information.hypertables
    WHERE hypertable_schema = 'public'`.catch(() => []);
  console.log(hyper.length
    ? `hypertables: ${hyper.map((h) => h.hypertable_name).join(', ')}`
    : 'hypertables: none (timescaledb absent — see banner at server startup + runbook)');
} catch (e) {
  console.error('[FAIL]', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
