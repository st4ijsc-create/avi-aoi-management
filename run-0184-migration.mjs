#!/usr/bin/env node
/**
 * Targeted runner for migration 0184 (doc 27 Đợt 5 / W5-C — gap A12):
 *   0184_role_dashboard_defaults.sql
 *     - role_dashboard_defaults (role varchar UNIQUE → dashboardTemplateId |
 *       customDashboardId | landingPath, updatedBy/At)
 *
 * TARGETED on purpose: other Đợt-5 agents own their own migration numbers —
 * this runner must not assume/apply them (do NOT use scripts/migrate-standalone.mjs).
 *
 * After applying, VERIFIES (read-only + a rolled-back transaction):
 *   1. table + unique constraint + FKs exist
 *   2. functional: same role twice → 23505; FK ON DELETE SET NULL behaviour
 *
 * Usage:  node run-0184-migration.mjs [--force]
 *         (DATABASE_URL from env or .env — set it to the *_test DB to apply there)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FORCE = process.argv.includes('--force');

// Minimal .env loader (no deps) — same behaviour as run-0181-migration.mjs
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

const dbName = new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '');
console.log(`[target] database: ${dbName}`);

const FILE = '0184_role_dashboard_defaults.sql';

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

let failed = false;
try {
  await sql`
    CREATE TABLE IF NOT EXISTS "__applied_migrations" (
      "id" SERIAL PRIMARY KEY,
      "filename" VARCHAR(500) NOT NULL UNIQUE,
      "applied_at" TIMESTAMP DEFAULT NOW(),
      "checksum" VARCHAR(64),
      "success" BOOLEAN DEFAULT true
    )`;

  const [row] = await sql`SELECT success FROM "__applied_migrations" WHERE filename = ${FILE}`;
  if (row?.success && !FORCE) {
    console.log(`[skip] ${FILE} already applied (idempotent — use --force to re-run)`);
  } else {
    const content = fs.readFileSync(path.join(__dirname, 'drizzle', FILE), 'utf-8');
    console.log(`[apply] ${FILE} ...`);
    await sql.unsafe(content);
    await sql`
      INSERT INTO "__applied_migrations" (filename, checksum, success)
      VALUES (${FILE}, ${simpleHash(content)}, true)
      ON CONFLICT (filename) DO UPDATE SET applied_at = NOW(), checksum = EXCLUDED.checksum, success = true`;
    console.log(`[ok] ${FILE}`);
  }

  // ── Verification 1: structure ──────────────────────────────────────────────
  const cols = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='role_dashboard_defaults'
    ORDER BY ordinal_position`;
  const colNames = cols.map((c) => c.column_name);
  const expected = ['id', 'role', 'dashboardTemplateId', 'customDashboardId', 'landingPath', 'updatedBy', 'createdAt', 'updatedAt'];
  const missing = expected.filter((c) => !colNames.includes(c));
  console.log(missing.length === 0
    ? `[verify] role_dashboard_defaults columns OK (${colNames.join(', ')})`
    : `[verify][FAIL] missing columns: ${missing.join(', ')}`);
  if (missing.length > 0) failed = true;

  const [uq] = await sql`
    SELECT conname FROM pg_constraint WHERE conname='uq_role_dashboard_defaults_role'`;
  console.log(uq
    ? '[verify] unique constraint uq_role_dashboard_defaults_role present'
    : '[verify][FAIL] unique constraint uq_role_dashboard_defaults_role MISSING');
  if (!uq) failed = true;

  const fks = await sql`
    SELECT conname, confdeltype FROM pg_constraint
    WHERE conrelid = 'role_dashboard_defaults'::regclass AND contype = 'f'`;
  const setNullFks = fks.filter((f) => f.confdeltype === 'n');
  console.log(setNullFks.length === 2
    ? `[verify] 2 FKs with ON DELETE SET NULL present (${fks.map((f) => f.conname).join(', ')})`
    : `[verify][FAIL] expected 2 ON DELETE SET NULL FKs, found ${setNullFks.length}`);
  if (setNullFks.length !== 2) failed = true;

  // ── Verification 2: functional (rolled back — never persists) ─────────────
  try {
    await sql.begin(async (tx) => {
      await tx`INSERT INTO role_dashboard_defaults ("role", "landingPath") VALUES ('__w5c_verify__', '/dashboard')`;
      let dupBlocked = false;
      try {
        await tx.savepoint(async (sp) => {
          await sp`INSERT INTO role_dashboard_defaults ("role") VALUES ('__w5c_verify__')`;
        });
      } catch (e) {
        dupBlocked = e?.code === '23505';
        if (!dupBlocked) throw e;
      }
      console.log(dupBlocked
        ? '[verify] duplicate role correctly rejected (23505 on uq_role_dashboard_defaults_role)'
        : '[verify][FAIL] duplicate role was NOT rejected');
      if (!dupBlocked) failed = true;

      // FK SET NULL behaviour against a throwaway template row
      const [tpl] = await tx`
        INSERT INTO dashboard_templates ("name", "templateType", "widgets", "layout", "isPublic", "createdBy")
        VALUES ('__w5c_verify_tpl__', 'shared', '[]'::json, '[]'::json, false, 0)
        RETURNING id`;
      await tx`UPDATE role_dashboard_defaults SET "dashboardTemplateId" = ${tpl.id} WHERE "role" = '__w5c_verify__'`;
      await tx`DELETE FROM dashboard_templates WHERE id = ${tpl.id}`;
      const [after] = await tx`SELECT "dashboardTemplateId" FROM role_dashboard_defaults WHERE "role" = '__w5c_verify__'`;
      const setNullOk = after && after.dashboardTemplateId === null;
      console.log(setNullOk
        ? '[verify] FK ON DELETE SET NULL works (template delete nulled the binding)'
        : '[verify][FAIL] FK SET NULL did not null the binding');
      if (!setNullOk) failed = true;

      throw new Error('__ROLLBACK__'); // never persist verify rows
    });
  } catch (e) {
    if (e?.message !== '__ROLLBACK__') throw e;
  }
  const [leftover] = await sql`SELECT count(*)::int AS n FROM role_dashboard_defaults WHERE "role" = '__w5c_verify__'`;
  console.log(`[verify] rollback clean — leftover verify rows: ${leftover.n}`);
  if (leftover.n !== 0) failed = true;

  console.log(failed ? '\n[RESULT] FAIL — see [FAIL] lines above' : '\n[RESULT] 0184 applied + verified OK');
  if (failed) process.exitCode = 1;
} catch (e) {
  console.error('[FAIL]', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
