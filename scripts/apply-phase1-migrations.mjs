/**
 * Apply Phase 1 Professional Upgrade migrations directly to the DB.
 * Uses IF NOT EXISTS guards everywhere — safe to run multiple times.
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

async function run() {
  console.log('=== Phase 1 Migration Runner ===\n');

  // 1. Check PostgreSQL version
  const [{ version }] = await sql`SELECT version()`;
  console.log('PG:', version.split(' ').slice(0, 2).join(' '));

  // 2. Enum: machineTypeEnum - add new values
  const newMachineTypes = ['SPI', 'AXI', 'ICT', 'FCT', 'CMM'];
  for (const val of newMachineTypes) {
    const [{ exists }] = await sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'machinetypeenum' AND e.enumlabel = ${val}
      ) as exists`;
    if (!exists) {
      await sql.unsafe(`ALTER TYPE machinetypeenum ADD VALUE IF NOT EXISTS '${val}'`);
      console.log(`[OK] machinetypeenum + ${val}`);
    } else {
      console.log(`[SKIP] machinetypeenum.${val} already exists`);
    }
  }

  // 3. Enum: operationStatusEnum - add new values
  const newOpStatuses = ['warming_up', 'changeover', 'starved', 'blocked'];
  for (const val of newOpStatuses) {
    const [{ exists }] = await sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'operationstatusenum' AND e.enumlabel = ${val}
      ) as exists`;
    if (!exists) {
      await sql.unsafe(`ALTER TYPE operationstatusenum ADD VALUE IF NOT EXISTS '${val}'`);
      console.log(`[OK] operationstatusenum + ${val}`);
    } else {
      console.log(`[SKIP] operationstatusenum.${val} already exists`);
    }
  }

  // 4. Create corporates table
  const [{ tableExists }] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'corporates'
    ) as "tableExists"`;
  if (!tableExists) {
    await sql`
      CREATE TABLE corporates (
        id          SERIAL PRIMARY KEY,
        code        VARCHAR(50)  NOT NULL UNIQUE,
        name        VARCHAR(255) NOT NULL,
        description TEXT,
        country     VARCHAR(100),
        "contactEmail" VARCHAR(320),
        "logoUrl"   TEXT,
        "isActive"  BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_corporates_code ON corporates (code)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_corporates_active ON corporates ("isActive")`;
    console.log('[OK] CREATE TABLE corporates');
  } else {
    console.log('[SKIP] corporates table already exists');
  }

  // 5. factories: add corporateCode and timezone columns
  const factoryCols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'factories' AND table_schema = 'public'`;
  const factoryColNames = new Set(factoryCols.map(c => c.column_name));

  if (!factoryColNames.has('corporateCode')) {
    await sql`ALTER TABLE factories ADD COLUMN "corporateCode" VARCHAR(50)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_factories_corporate ON factories ("corporateCode")`;
    console.log('[OK] factories + corporateCode');
  } else {
    console.log('[SKIP] factories.corporateCode already exists');
  }

  if (!factoryColNames.has('timezone')) {
    await sql`ALTER TABLE factories ADD COLUMN timezone VARCHAR(64) DEFAULT 'Asia/Ho_Chi_Minh'`;
    console.log('[OK] factories + timezone');
  } else {
    console.log('[SKIP] factories.timezone already exists');
  }

  // 6. measurement_results: add defect bbox columns
  const mrCols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'measurement_results' AND table_schema = 'public'`;
  const mrColNames = new Set(mrCols.map(c => c.column_name));

  const bboxCols = [
    ['defectBboxX', 'INTEGER'],
    ['defectBboxY', 'INTEGER'],
    ['defectBboxW', 'INTEGER'],
    ['defectBboxH', 'INTEGER'],
    ['defectCropUrl', 'TEXT'],
    ['defectCropKey', 'VARCHAR(255)'],
  ];
  for (const [colName, colType] of bboxCols) {
    if (!mrColNames.has(colName)) {
      await sql.unsafe(`ALTER TABLE measurement_results ADD COLUMN "${colName}" ${colType}`);
      console.log(`[OK] measurement_results + ${colName}`);
    } else {
      console.log(`[SKIP] measurement_results.${colName} already exists`);
    }
  }

  // 7. user_corporate_assignments: ensure unique index
  const [{ idxExists }] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE tablename = 'user_corporate_assignments'
        AND indexname = 'idx_user_corporate_unique'
    ) as "idxExists"`;
  if (!idxExists) {
    await sql`
      CREATE UNIQUE INDEX idx_user_corporate_unique
        ON user_corporate_assignments ("userId", "corporateCode")`;
    console.log('[OK] UNIQUE INDEX user_corporate_assignments (userId, corporateCode)');
  } else {
    // Check if it's a unique index already
    const [{ isUnique }] = await sql`
      SELECT ix.indisunique as "isUnique"
      FROM pg_indexes pi
      JOIN pg_class c ON c.relname = pi.indexname
      JOIN pg_index ix ON ix.indexrelid = c.oid
      WHERE pi.tablename = 'user_corporate_assignments'
        AND pi.indexname = 'idx_user_corporate_unique'`;
    if (!isUnique) {
      await sql`DROP INDEX idx_user_corporate_unique`;
      await sql`
        CREATE UNIQUE INDEX idx_user_corporate_unique
          ON user_corporate_assignments ("userId", "corporateCode")`;
      console.log('[OK] Replaced non-unique with UNIQUE INDEX on user_corporate_assignments');
    } else {
      console.log('[SKIP] idx_user_corporate_unique already is UNIQUE');
    }
  }

  // 8. RLS on audit_logs (append-only protection)
  const [{ rlsEnabled }] = await sql`
    SELECT relrowsecurity as "rlsEnabled"
    FROM pg_class WHERE relname = 'audit_logs'`;
  if (!rlsEnabled) {
    await sql`ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY`;
    // Only create policies if they don't exist
    const policies = await sql`
      SELECT policyname FROM pg_policies WHERE tablename = 'audit_logs'`;
    const policyNames = new Set(policies.map(p => p.policyname));
    if (!policyNames.has('audit_logs_insert_only')) {
      await sql`
        CREATE POLICY audit_logs_insert_only ON audit_logs
          FOR INSERT TO PUBLIC WITH CHECK (true)`;
    }
    if (!policyNames.has('audit_logs_select_only')) {
      await sql`
        CREATE POLICY audit_logs_select_only ON audit_logs
          FOR SELECT TO PUBLIC USING (true)`;
    }
    console.log('[OK] RLS enabled on audit_logs (append-only: no UPDATE/DELETE)');
  } else {
    console.log('[SKIP] audit_logs RLS already enabled');
  }

  // 9. Record this migration in __applied_migrations
  await sql`
    CREATE TABLE IF NOT EXISTS __applied_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(500) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT NOW(),
      checksum VARCHAR(64),
      success BOOLEAN DEFAULT true
    )`;
  await sql`
    INSERT INTO __applied_migrations (filename, checksum, success)
    VALUES ('0103_phase1_professional_upgrades.sql', 'phase1-2026-05-19', true)
    ON CONFLICT (filename) DO UPDATE SET applied_at = NOW(), success = true`;

  console.log('\n=== Phase 1 migrations applied successfully ===');
}

run().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
}).finally(() => sql.end());
