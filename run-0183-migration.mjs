#!/usr/bin/env node
/**
 * Targeted runner for migration 0183 (doc 27 Đợt 5 / W5-B — gap F2):
 *   0183_defect_dispositions.sql
 *     - defect_dispositions table (disposition ledger + repair lifecycle)
 *     - indexes on inspectionId / status / serialNumber
 *
 * TARGETED on purpose: other Đợt-5 agents own their own migrations — this
 * runner must not assume/apply them (do NOT use scripts/migrate-standalone.mjs).
 *
 * After applying, VERIFIES (read-only + a rolled-back transaction):
 *   1. table + 3 indexes exist, status default 'open'
 *   2. functional: insert → legal-looking status update → rollback clean
 *
 * Usage:  node run-0183-migration.mjs [--force] [--test]
 *         --test  apply to the derived <db>_test database (same derivation as
 *                 vitest.setup.ts; TEST_DATABASE_URL wins when set)
 *         (DATABASE_URL from env or .env)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FORCE = process.argv.includes('--force');
const USE_TEST_DB = process.argv.includes('--test');

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

let dbUrl = process.env.DATABASE_URL;
if (USE_TEST_DB) {
  // Same derivation + guard as vitest.setup.ts.
  if (process.env.TEST_DATABASE_URL) {
    dbUrl = process.env.TEST_DATABASE_URL;
  } else {
    const u = new URL(dbUrl);
    const devName = u.pathname.replace(/^\//, '') || 'postgres';
    u.pathname = '/' + devName + '_test';
    dbUrl = u.toString();
  }
  const testName = new URL(dbUrl).pathname.replace(/^\//, '');
  if (!/test/i.test(testName)) {
    console.error(`ERROR: derived test DB "${testName}" does not contain "test" — refusing.`);
    process.exit(1);
  }
  console.log(`[target] TEST database: ${testName}`);
}

const { default: postgres } = await import('postgres');
const needsSsl = dbUrl.includes('sslmode=require');
const sql = postgres(dbUrl, {
  ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  max: 1,
  connect_timeout: 30,
});

const FILE = '0183_defect_dispositions.sql';

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
  const [tbl] = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name='defect_dispositions'`;
  console.log(tbl ? '[verify] table defect_dispositions present' : '[verify][FAIL] table defect_dispositions MISSING');
  if (!tbl) failed = true;

  const [statusCol] = await sql`
    SELECT column_default, is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name='defect_dispositions' AND column_name='status'`;
  const defOk = statusCol && String(statusCol.column_default ?? '').includes('open');
  console.log(defOk
    ? `[verify] status default: ${statusCol.column_default} nullable=${statusCol.is_nullable}`
    : `[verify][FAIL] status default wrong: ${statusCol?.column_default ?? 'column missing'}`);
  if (!defOk) failed = true;

  const idx = await sql`
    SELECT indexname FROM pg_indexes
    WHERE schemaname='public' AND tablename='defect_dispositions'
      AND indexname IN ('idx_defect_disp_inspection','idx_defect_disp_status','idx_defect_disp_serial')`;
  console.log(idx.length === 3
    ? '[verify] all 3 indexes present (inspectionId, status, serialNumber)'
    : `[verify][FAIL] only ${idx.length}/3 indexes present: ${idx.map((r) => r.indexname).join(', ')}`);
  if (idx.length !== 3) failed = true;

  // ── Verification 2: functional insert + update (rolled back) ───────────────
  try {
    await sql.begin(async (tx) => {
      const [ins] = await tx`
        INSERT INTO defect_dispositions ("inspectionId", "serialNumber", disposition, "createdBy", note)
        VALUES (0, ${'W5B-VERIFY-' + Date.now()}, 'rework', NULL, 'runner verify row')
        RETURNING id, status`;
      const openOk = ins.status === 'open';
      console.log(openOk
        ? `[verify] insert OK — id ${ins.id}, status defaulted to 'open'`
        : `[verify][FAIL] insert defaulted status to '${ins.status}' (expected 'open')`);
      if (!openOk) failed = true;
      const [upd] = await tx`
        UPDATE defect_dispositions SET status='in_repair', "updatedAt"=NOW() WHERE id=${ins.id}
        RETURNING status`;
      console.log(upd.status === 'in_repair'
        ? "[verify] status update open→in_repair OK"
        : `[verify][FAIL] status update produced '${upd.status}'`);
      if (upd.status !== 'in_repair') failed = true;
      throw new Error('__ROLLBACK__'); // never persist verify rows
    });
  } catch (e) {
    if (e?.message !== '__ROLLBACK__') throw e;
  }
  const [leftover] = await sql`SELECT count(*)::int AS n FROM defect_dispositions WHERE note = 'runner verify row'`;
  console.log(`[verify] rollback clean — leftover verify rows: ${leftover.n}`);
  if (leftover.n !== 0) failed = true;

  console.log(failed ? '\n[RESULT] FAIL — see [FAIL] lines above' : '\n[RESULT] 0183 applied + verified OK');
  if (failed) process.exitCode = 1;
} catch (e) {
  console.error('[FAIL]', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
