/**
 * Apply Phase 3 schema changes:
 * - sessionstatusenum enum
 * - production_sessions table
 * - predictive_alerts.escalationLevel / lastEscalatedAt
 * - alert_escalations table
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

async function enumValueExists(enumName, value) {
  const [{ exists }] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = ${enumName} AND e.enumlabel = ${value}
    ) AS exists`;
  return exists;
}

async function tableExists(table) {
  const [{ exists }] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${table}
    ) AS exists`;
  return exists;
}

async function columnExists(table, column) {
  const [{ exists }] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    ) AS exists`;
  return exists;
}

async function indexExists(indexName) {
  const [{ exists }] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes WHERE indexname = ${indexName}
    ) AS exists`;
  return exists;
}

try {
  console.log('=== Phase 3 Migration Runner ===\n');

  // 1. Create sessionstatusenum if missing
  const enumExists = await sql`
    SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sessionstatusenum') AS exists`;
  if (!enumExists[0].exists) {
    await sql.unsafe(`CREATE TYPE "sessionstatusenum" AS ENUM ('open', 'paused', 'closed', 'transferred')`);
    console.log('[OK] sessionstatusenum created');
  } else {
    for (const v of ['open', 'paused', 'closed', 'transferred']) {
      if (!await enumValueExists('sessionstatusenum', v)) {
        await sql.unsafe(`ALTER TYPE "sessionstatusenum" ADD VALUE '${v}'`);
        console.log(`[OK] sessionstatusenum.${v} added`);
      }
    }
    console.log('[SKIP] sessionstatusenum already exists');
  }

  // 2. Create production_sessions table
  if (!await tableExists('production_sessions')) {
    await sql.unsafe(`
      CREATE TABLE "production_sessions" (
        "id"                    SERIAL PRIMARY KEY,
        "sessionCode"           VARCHAR(64) NOT NULL UNIQUE,
        "shiftConfigId"         INTEGER NOT NULL,
        "factoryId"             INTEGER NOT NULL,
        "workshopId"            INTEGER NOT NULL,
        "lineId"                INTEGER,
        "productionOrderId"     INTEGER,
        "operatorId"            INTEGER NOT NULL,
        "supervisorId"          INTEGER,
        "status"                "sessionstatusenum" NOT NULL DEFAULT 'open',
        "shiftDate"             TIMESTAMP NOT NULL,
        "plannedStart"          TIMESTAMP NOT NULL,
        "plannedEnd"            TIMESTAMP NOT NULL,
        "actualStart"           TIMESTAMP NOT NULL,
        "actualEnd"             TIMESTAMP,
        "handoverToSessionId"   INTEGER,
        "handoverNotes"         TEXT,
        "kpiSnapshot"           JSON,
        "operatorNotes"         TEXT,
        "supervisorSignoff"     BOOLEAN NOT NULL DEFAULT FALSE,
        "supervisorSignoffAt"   TIMESTAMP,
        "createdAt"             TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt"             TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log('[OK] production_sessions table created');

    // Indexes
    const indexes = [
      ['idx_ps_shift_config', '"production_sessions"("shiftConfigId")'],
      ['idx_ps_factory',      '"production_sessions"("factoryId")'],
      ['idx_ps_workshop',     '"production_sessions"("workshopId")'],
      ['idx_ps_line',         '"production_sessions"("lineId")'],
      ['idx_ps_operator',     '"production_sessions"("operatorId")'],
      ['idx_ps_status',       '"production_sessions"("status")'],
      ['idx_ps_shift_date',   '"production_sessions"("shiftDate")'],
      ['idx_ps_order',        '"production_sessions"("productionOrderId")'],
    ];
    for (const [name, cols] of indexes) {
      if (!await indexExists(name)) {
        await sql.unsafe(`CREATE INDEX "${name}" ON ${cols}`);
        console.log(`[OK] ${name} created`);
      }
    }
  } else {
    console.log('[SKIP] production_sessions already exists');
  }

  // 3. Add escalation columns to predictive_alerts
  if (!await columnExists('predictive_alerts', 'escalationLevel')) {
    await sql.unsafe(`ALTER TABLE "predictive_alerts" ADD COLUMN "escalationLevel" INTEGER NOT NULL DEFAULT 0`);
    console.log('[OK] predictive_alerts.escalationLevel added');
  } else {
    console.log('[SKIP] predictive_alerts.escalationLevel already exists');
  }

  if (!await columnExists('predictive_alerts', 'lastEscalatedAt')) {
    await sql.unsafe(`ALTER TABLE "predictive_alerts" ADD COLUMN "lastEscalatedAt" TIMESTAMP`);
    console.log('[OK] predictive_alerts.lastEscalatedAt added');
  } else {
    console.log('[SKIP] predictive_alerts.lastEscalatedAt already exists');
  }

  if (!await indexExists('idx_predictive_alerts_escalation')) {
    await sql.unsafe(`CREATE INDEX "idx_predictive_alerts_escalation" ON "predictive_alerts"("escalationLevel")`);
    console.log('[OK] idx_predictive_alerts_escalation created');
  }

  // 4. Create alert_escalations table
  if (!await tableExists('alert_escalations')) {
    await sql.unsafe(`
      CREATE TABLE "alert_escalations" (
        "id"               SERIAL PRIMARY KEY,
        "alertId"          INTEGER NOT NULL,
        "fromLevel"        INTEGER NOT NULL,
        "toLevel"          INTEGER NOT NULL,
        "reason"           VARCHAR(255) NOT NULL,
        "notifiedUserIds"  JSON DEFAULT '[]',
        "escalatedAt"      TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await sql.unsafe(`CREATE INDEX "idx_alert_esc_alert" ON "alert_escalations"("alertId")`);
    await sql.unsafe(`CREATE INDEX "idx_alert_esc_at" ON "alert_escalations"("escalatedAt")`);
    console.log('[OK] alert_escalations table created');
  } else {
    console.log('[SKIP] alert_escalations already exists');
  }

  // Record in migration history
  await sql`
    INSERT INTO __applied_migrations (filename, checksum, success)
    VALUES ('0105_phase3_sessions_escalation.sql', 'phase3-2026-05-19', true)
    ON CONFLICT (filename) DO UPDATE SET applied_at = NOW(), success = true`;

  console.log('\n=== Phase 3 migrations applied successfully ===');
} catch (e) {
  console.error('FATAL:', e.message);
  process.exit(1);
} finally {
  await sql.end();
}
