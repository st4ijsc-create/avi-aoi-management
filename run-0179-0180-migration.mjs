#!/usr/bin/env node
/**
 * Targeted runner for migrations 0179 + 0180 (doc 27 §2 M1/M6/M11 — W3-A):
 *   0179_integrity_orphan_scan.sql       — orphan/duplicate AUDIT + report table
 *   0180_integrity_enforce_fk_unique.sql — conditional FK/unique ENFORCEMENT
 *
 * Both files are idempotent and self-guarding: FKs are added NOT VALID and only
 * VALIDATEd when the relationship is clean; unique indexes build only when
 * duplicate-free; hypertable-blocked FKs are skipped + recorded in
 * db_feature_status. Re-run (with --force) after repairing orphans via
 * scripts/repair-orphans.mjs to validate/build anything still deferred.
 *
 * Runs ONLY these two files (0181/0182 belong to other Đợt-3 agents and are
 * applied by their own runners / the normal migrate step).
 *
 * Usage:  node run-0179-0180-migration.mjs [--force]
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
  // Surface RAISE WARNING lines from the DO blocks (orphan/deferral reports).
  onnotice: (n) => console.log(`  [pg:${(n.severity || 'NOTICE').toLowerCase()}] ${n.message}`),
});

const FILES = ['0179_integrity_orphan_scan.sql', '0180_integrity_enforce_fk_unique.sql'];

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

  // ── Report: latest orphan/duplicate snapshot ───────────────────────────────
  const scans = await sql`
    SELECT DISTINCT ON ("scanKey") "scanKey", "violationCount", "scannedAt"
    FROM integrity_scan_results ORDER BY "scanKey", "scannedAt" DESC`;
  console.log('\nintegrity_scan_results (latest per relationship):');
  for (const s of scans) {
    console.log(`  ${s.violationCount > 0 ? '✗' : '✓'} ${s.scanKey}: ${s.violationCount}`);
  }

  // ── Report: which constraints actually enforce ─────────────────────────────
  const fks = await sql`
    SELECT conname, convalidated FROM pg_constraint
    WHERE conname LIKE 'fk\\_%' AND contype = 'f'
      AND conname IN (
        'fk_machines_station','fk_stations_line','fk_production_lines_workshop',
        'fk_workshops_factory','fk_factories_corporate','fk_product_inspections_machine',
        'fk_measurement_results_inspection','fk_measurement_results_point_def',
        'fk_measurement_results_defect_catalog','fk_pm_mappings_product',
        'fk_pm_mappings_machine','fk_machine_recipes_machine','fk_recipe_deployments_recipe',
        'fk_recipe_deployments_machine','fk_recipe_deployments_previous_recipe')
    ORDER BY conname`;
  console.log('\nforeign keys:');
  for (const f of fks) console.log(`  ${f.convalidated ? '✓ VALIDATED ' : '⚠ NOT VALID '} ${f.conname}`);

  const idx = await sql`
    SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
      'uq_workshops_factory_code_active','uq_production_lines_workshop_code_active',
      'uq_stations_line_code_active','uq_pm_mappings_pair') ORDER BY indexname`;
  console.log('\nunique indexes built:');
  const built = new Set(idx.map((i) => i.indexname));
  for (const name of ['uq_workshops_factory_code_active','uq_production_lines_workshop_code_active','uq_stations_line_code_active','uq_pm_mappings_pair']) {
    console.log(`  ${built.has(name) ? '✓' : '✗ (deferred)'} ${name}`);
  }

  const status = await sql`
    SELECT feature, status, detail FROM db_feature_status
    WHERE feature LIKE 'integrity\\_%' AND status <> 'ok' ORDER BY feature`;
  if (status.length) {
    console.log('\ndb_feature_status (non-ok integrity entries):');
    for (const s of status) console.log(`  ${s.feature}: ${s.status} — ${s.detail}`);
  }
} catch (e) {
  console.error('[FAIL]', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
