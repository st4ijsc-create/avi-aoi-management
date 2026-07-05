#!/usr/bin/env node
/**
 * Targeted runner for migration 0181 (doc 27 Đợt 3 / W3-B — gaps M2 + M3):
 *   0181_machine_lifecycle_softdelete.sql
 *     - machines.lifecycleStatus (varchar enum + one-shot backfill)
 *     - machines_code_unique → partial unique index uq_machines_code_active
 *       (code unique among isActive=true rows only)
 *
 * TARGETED on purpose: other Đợt-3 agents own 0179/0180/0182 — this runner
 * must not assume/apply them (do NOT use scripts/migrate-standalone.mjs here).
 *
 * After applying, VERIFIES (read-only + a rolled-back transaction):
 *   1. column + index exist, old global unique is gone
 *   2. lifecycleStatus distribution (backfill sanity)
 *   3. functional: same code twice-active → 23505; active+inactive → OK
 *
 * Usage:  node run-0181-migration.mjs [--force]
 *         (DATABASE_URL from env or .env)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FORCE = process.argv.includes('--force');

// Minimal .env loader (no deps) — same behaviour as run-0172-0173-migration.mjs
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

const FILE = '0181_machine_lifecycle_softdelete.sql';

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
    await sql.unsafe(content); // whole-file simple-query mode keeps DO $$ blocks intact
    await sql`
      INSERT INTO "__applied_migrations" (filename, checksum, success)
      VALUES (${FILE}, ${simpleHash(content)}, true)
      ON CONFLICT (filename) DO UPDATE SET applied_at = NOW(), checksum = EXCLUDED.checksum, success = true`;
    console.log(`[ok] ${FILE}`);
  }

  // ── Verification 1: structure ──────────────────────────────────────────────
  const [col] = await sql`
    SELECT data_type, column_default, is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name='machines' AND column_name='lifecycleStatus'`;
  console.log(col
    ? `[verify] machines."lifecycleStatus": ${col.data_type} default ${col.column_default} nullable=${col.is_nullable}`
    : '[verify][FAIL] machines."lifecycleStatus" column MISSING');
  if (!col) failed = true;

  const [oldUq] = await sql`
    SELECT conname FROM pg_constraint WHERE conname='machines_code_unique'`;
  console.log(oldUq
    ? '[verify][FAIL] global unique machines_code_unique STILL EXISTS'
    : '[verify] global unique machines_code_unique dropped');
  if (oldUq) failed = true;

  const [newIdx] = await sql`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname='public' AND tablename='machines' AND indexname='uq_machines_code_active'`;
  console.log(newIdx
    ? `[verify] partial unique present: ${newIdx.indexdef}`
    : '[verify][FAIL] uq_machines_code_active MISSING');
  if (!newIdx) failed = true;

  // ── Verification 2: backfill distribution ──────────────────────────────────
  const dist = await sql`
    SELECT "lifecycleStatus", "isActive", count(*)::int AS n
    FROM machines GROUP BY 1, 2 ORDER BY 1, 2`;
  console.log('[verify] lifecycleStatus distribution:');
  for (const d of dist) console.log(`  ${d.lifecycleStatus} (isActive=${d.isActive}): ${d.n}`);

  // ── Verification 3: functional partial-unique check (rolled back) ──────────
  const [station] = await sql`SELECT id FROM stations ORDER BY id LIMIT 1`;
  if (!station) {
    console.log('[verify] no stations in DB — skipping functional insert check (structure checks above are authoritative)');
  } else {
    const code = `W3B-VERIFY-${Date.now()}`;
    try {
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO machines ("stationId", code, name, "machineType", "apiKey", "isActive")
          VALUES (${station.id}, ${code}, 'W3B verify active', 'AOI', ${'w3b_' + Math.random().toString(36).slice(2)}, true)`;
        await tx`
          INSERT INTO machines ("stationId", code, name, "machineType", "apiKey", "isActive")
          VALUES (${station.id}, ${code}, 'W3B verify tombstone', 'AOI', ${'w3b_' + Math.random().toString(36).slice(2)}, false)`;
        console.log('[verify] active + inactive with SAME code inserted OK (tombstone allowed)');
        let dupBlocked = false;
        try {
          await tx.savepoint(async (sp) => {
            await sp`
              INSERT INTO machines ("stationId", code, name, "machineType", "apiKey", "isActive")
              VALUES (${station.id}, ${code}, 'W3B verify dup-active', 'AOI', ${'w3b_' + Math.random().toString(36).slice(2)}, true)`;
          });
        } catch (e) {
          dupBlocked = e?.code === '23505';
          if (!dupBlocked) throw e;
        }
        console.log(dupBlocked
          ? '[verify] second ACTIVE machine with same code correctly rejected (23505 on uq_machines_code_active)'
          : '[verify][FAIL] second ACTIVE duplicate was NOT rejected');
        if (!dupBlocked) failed = true;
        throw new Error('__ROLLBACK__'); // never persist verify rows
      });
    } catch (e) {
      if (e?.message !== '__ROLLBACK__') throw e;
    }
    const [leftover] = await sql`SELECT count(*)::int AS n FROM machines WHERE code = ${code}`;
    console.log(`[verify] rollback clean — leftover verify rows: ${leftover.n}`);
    if (leftover.n !== 0) failed = true;
  }

  console.log(failed ? '\n[RESULT] FAIL — see [FAIL] lines above' : '\n[RESULT] 0181 applied + verified OK');
  if (failed) process.exitCode = 1;
} catch (e) {
  console.error('[FAIL]', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
