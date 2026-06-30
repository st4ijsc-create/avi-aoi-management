/**
 * Data retention / pruning scheduler (Phase 1 WS1.1).
 *
 * Periodically deletes aged rows from high-volume time-series / log tables so
 * they don't grow unbounded. Works on plain PostgreSQL (no TimescaleDB needed);
 * when the data is later moved to TimescaleDB hypertables, native
 * `add_retention_policy()` should supersede this service.
 *
 * SAFETY:
 *  - Disabled by default. Master switch DATA_RETENTION_ENABLED=true.
 *  - DATA_RETENTION_DRY_RUN=true logs what WOULD be deleted without deleting —
 *    recommended for the first run in any environment.
 *  - Deletes in bounded batches (DATA_RETENTION_BATCH, default 5000) to avoid
 *    long locks / bloat spikes.
 *  - Per-table window via env; a value <= 0 disables retention for that table.
 *  - Compliance / append-only tables (audit_logs, command_log, genealogy_chain,
 *    interlock_events, license_sync_logs, production_sessions, …) are NEVER
 *    included here — pruning those would break traceability requirements.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";

interface RetentionTarget {
  /** Physical table name */
  table: string;
  /** Timestamp column used as the age cutoff */
  column: string;
  /** Env var overriding the retention window (in days) */
  envKey: string;
  /** Default retention window in days */
  defaultDays: number;
}

// High-volume, non-compliance tables only. Conservative defaults; tune via env.
//
// P2 / RETENTION DECISION: ot_telemetry is the canonical telemetry store. The
// Timescale retention policy (DEFERRED migration drizzle/0133_*.sql — hypertable +
// add_retention_policy) is NOT yet applied, so this service remains the ACTIVE
// retention path for ot_telemetry today. ⚠ Once 0133 is applied, REMOVE the
// ot_telemetry row below (or set RETENTION_OT_TELEMETRY_DAYS=0) so the hypertable's
// native retention policy does not double-delete with this sweeper.
// Canonical ot_telemetry uses event-time column `ts` (renamed from legacy `timestamp`).
const TARGETS: RetentionTarget[] = [
  { table: "ot_telemetry",        column: "ts",        envKey: "RETENTION_OT_TELEMETRY_DAYS",       defaultDays: 90 },
  { table: "machine_heartbeats",  column: "timestamp", envKey: "RETENTION_MACHINE_HEARTBEATS_DAYS", defaultDays: 30 },
  { table: "mqtt_message_logs",   column: "createdAt", envKey: "RETENTION_MQTT_LOGS_DAYS",          defaultDays: 60 },
  { table: "mqtt_message_history", column: "timestamp", envKey: "RETENTION_MQTT_HISTORY_DAYS",      defaultDays: 60 },
  { table: "oee_metrics",         column: "timestamp", envKey: "RETENTION_OEE_METRICS_DAYS",        defaultDays: 365 },
  { table: "process_results",     column: "measuredAt", envKey: "RETENTION_PROCESS_RESULTS_DAYS",   defaultDays: 180 },
  { table: "inference_results",   column: "createdAt", envKey: "RETENTION_INFERENCE_RESULTS_DAYS",  defaultDays: 180 },
];

let timer: NodeJS.Timeout | null = null;

function envInt(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
}

function resolveDays(t: RetentionTarget): number {
  return envInt(t.envKey, t.defaultDays);
}

async function pruneTarget(t: RetentionTarget, dryRun: boolean, batch: number): Promise<void> {
  const days = resolveDays(t);
  if (days <= 0) return; // retention disabled for this table

  const db = await getDb();
  if (!db) return;

  const tableId = sql.identifier(t.table);
  const colId = sql.identifier(t.column);
  const cutoff = sql`now() - make_interval(days => ${days})`;

  if (dryRun) {
    const rows = (await db.execute(
      sql`SELECT count(*)::int AS n FROM ${tableId} WHERE ${colId} < ${cutoff}`,
    )) as unknown as Array<{ n: number }>;
    const n = rows?.[0]?.n ?? 0;
    if (n > 0) console.log(`[Retention] DRY-RUN ${t.table}: would delete ${n} rows older than ${days}d`);
    return;
  }

  let total = 0;
  // Bounded loop: at most enough iterations to clear a large backlog once.
  for (let i = 0; i < 1000; i++) {
    const deleted = (await db.execute(
      sql`DELETE FROM ${tableId}
          WHERE ctid IN (
            SELECT ctid FROM ${tableId} WHERE ${colId} < ${cutoff} LIMIT ${batch}
          )
          RETURNING 1`,
    )) as unknown as unknown[];
    const n = Array.isArray(deleted) ? deleted.length : 0;
    total += n;
    if (n < batch) break;
  }
  if (total > 0) console.log(`[Retention] ${t.table}: deleted ${total} rows older than ${days}d`);
}

async function runOnce(): Promise<void> {
  const dryRun = process.env.DATA_RETENTION_DRY_RUN === "true";
  const batch = Math.max(100, envInt("DATA_RETENTION_BATCH", 5000));
  for (const t of TARGETS) {
    try {
      await pruneTarget(t, dryRun, batch);
    } catch (err: any) {
      console.error(`[Retention] ${t.table} failed:`, err?.message ?? err);
    }
  }
}

export function startDataRetention(): void {
  if (process.env.DATA_RETENTION_ENABLED !== "true") {
    return; // feature-flagged off — no-op (safe default; this deletes data)
  }
  if (timer) return;

  const intervalMs = Math.max(60_000, envInt("DATA_RETENTION_INTERVAL_MS", 24 * 60 * 60 * 1000));
  const dryRun = process.env.DATA_RETENTION_DRY_RUN === "true";

  // Run shortly after boot, then on interval (don't block startup).
  setTimeout(() => void runOnce(), 30_000);
  timer = setInterval(() => void runOnce(), intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  console.log(
    `[Retention] enabled${dryRun ? " (DRY-RUN)" : ""} — sweeping every ${Math.round(intervalMs / 3600000)}h ` +
      `across ${TARGETS.length} tables`,
  );
}

export function stopDataRetention(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
