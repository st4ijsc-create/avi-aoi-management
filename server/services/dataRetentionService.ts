/**
 * Data retention / pruning scheduler (Phase 1 WS1.1 · extended by doc 27 §11
 * decision #2 — "12-month retention for everything": raw inspection rows,
 * images, logs).
 *
 * Periodically deletes aged rows from high-volume time-series / log tables so
 * they don't grow unbounded. Works on plain PostgreSQL (no TimescaleDB needed);
 * where the data HAS been converted to TimescaleDB hypertables with a native
 * `add_retention_policy()` (migrations 0172/0173), this service automatically
 * SKIPS those tables at runtime (it inspects timescaledb_information.jobs) so
 * the two mechanisms never double-delete.
 *
 * SAFETY:
 *  - Disabled by default. Master switch DATA_RETENTION_ENABLED=true.
 *  - DATA_RETENTION_DRY_RUN=true logs what WOULD be deleted without deleting —
 *    recommended for the first run in any environment.
 *  - Deletes in bounded batches (DATA_RETENTION_BATCH, default 5000) to avoid
 *    long locks / bloat spikes.
 *  - Per-table window via env; a value <= 0 disables retention for that table.
 *  - `command_log` is DELIBERATELY EXCLUDED: it is the append-only device
 *    control/compliance ledger (who commanded which machine to do what) — the
 *    one table doc 27 gap B2 explicitly carves out. Pruning it would destroy
 *    electronic traceability for control actions. Other compliance-ish tables
 *    (genealogy_chain, interlock_events, license_sync_logs,
 *    production_sessions, …) also remain excluded.
 *  - `audit_logs` WAS excluded pre-doc-27; decision #2 sets a 12-month window
 *    for ALL logs, so it is now pruned at 365 days (env-overridable — set
 *    RETENTION_AUDIT_LOGS_DAYS=0 if a site's compliance regime needs longer,
 *    and archive externally).
 *
 * IMAGE LIFECYCLE COUPLING (doc 27 gap R6 · decision #5): pruning
 * product_inspections / measurement_results rows would orphan their image
 * files under ./uploads. Each prune therefore CAPTURES identifying values
 * from the deleted rows (RETURNING) and hands them to imageLifecycleService,
 * which removes the matching files/directories on the local FS in the same
 * sweep. An age-based fallback sweep in imageLifecycleService covers files
 * whose rows were removed by other paths (e.g. native chunk drops).
 */
import { sql } from "drizzle-orm";
// W4-D (doc 27 §8 B5): retention sweeps run bulk batched DELETEs — route them
// through the dedicated background-jobs pool (DB_POOL_MAX_JOBS, default 8) so
// they can never starve interactive API requests on the primary pool. Same
// database, separate connection budget.
import { getJobsDb as getDb } from "../db/connection";
import { deleteInspectionDirs, deleteStorageKeys } from "./imageLifecycleService";

interface RetentionTarget {
  /** Physical table name */
  table: string;
  /** Timestamp column used as the age cutoff */
  column: string;
  /** Env var overriding the retention window (in days) */
  envKey: string;
  /** Default retention window in days */
  defaultDays: number;
  /**
   * Optional: columns to RETURN from deleted rows; each deleted batch is passed
   * to onDeleted so dependent artifacts (image files) are cleaned up in the
   * same sweep. Ignored in dry-run mode.
   */
  captureColumns?: string[];
  onDeleted?: (rows: Array<Record<string, unknown>>) => Promise<void>;
}

// High-volume, non-compliance tables only. Conservative defaults; tune via env.
//
// P2 / RETENTION DECISION: ot_telemetry is the canonical telemetry store. When
// migration 0172/0173 has been applied on a TimescaleDB-enabled main DB, the
// hypertable's native retention policy takes over and the runtime guard below
// (getNativeRetentionTables) skips it here automatically. On plain-PG installs
// this service remains the ACTIVE retention path.
// Canonical ot_telemetry uses event-time column `ts` (renamed from legacy `timestamp`).
const TARGETS: RetentionTarget[] = [
  { table: "ot_telemetry",        column: "ts",        envKey: "RETENTION_OT_TELEMETRY_DAYS",       defaultDays: 90 },
  { table: "machine_heartbeats",  column: "timestamp", envKey: "RETENTION_MACHINE_HEARTBEATS_DAYS", defaultDays: 30 },
  { table: "mqtt_message_logs",   column: "createdAt", envKey: "RETENTION_MQTT_LOGS_DAYS",          defaultDays: 60 },
  { table: "mqtt_message_history", column: "timestamp", envKey: "RETENTION_MQTT_HISTORY_DAYS",      defaultDays: 60 },
  { table: "oee_metrics",         column: "timestamp", envKey: "RETENTION_OEE_METRICS_DAYS",        defaultDays: 365 },
  { table: "process_results",     column: "measuredAt", envKey: "RETENTION_PROCESS_RESULTS_DAYS",   defaultDays: 180 },
  { table: "inference_results",   column: "createdAt", envKey: "RETENTION_INFERENCE_RESULTS_DAYS",  defaultDays: 180 },

  // ── doc 27 §11 decision #2 — 12-month retention for everything ─────────────
  // Inspection core (gap R1). Deleted rows feed the image lifecycle (gap R6):
  // measurement rows surrender their imageKey/defectCropKey files; inspection
  // rows surrender their whole uploads/inspections/<id>/ directory.
  {
    table: "measurement_results", column: "createdAt",
    envKey: "RETENTION_MEASUREMENT_RESULTS_DAYS", defaultDays: 365,
    captureColumns: ["imageKey", "defectCropKey"],
    onDeleted: async (rows) => {
      const keys = rows.flatMap((r) => [r.imageKey, r.defectCropKey] as Array<string | null>);
      await deleteStorageKeys(keys);
    },
  },
  {
    table: "product_inspections", column: "inspectionTime",
    envKey: "RETENTION_PRODUCT_INSPECTIONS_DAYS", defaultDays: 365,
    captureColumns: ["id"],
    onDeleted: async (rows) => {
      await deleteInspectionDirs(rows.map((r) => r.id as number));
    },
  },
  // Log / history tables (gap B2). command_log is EXCLUDED — see header.
  { table: "audit_logs",                 column: "createdAt",   envKey: "RETENTION_AUDIT_LOGS_DAYS",            defaultDays: 365 },
  { table: "notifications",              column: "createdAt",   envKey: "RETENTION_NOTIFICATIONS_DAYS",         defaultDays: 365 },
  { table: "mqtt_alert_history",         column: "triggeredAt", envKey: "RETENTION_MQTT_ALERT_HISTORY_DAYS",    defaultDays: 365 },
  { table: "mqtt_ng_rate_alert_history", column: "triggeredAt", envKey: "RETENTION_MQTT_NG_RATE_ALERT_DAYS",    defaultDays: 365 },
  { table: "mqtt_connection_logs",       column: "timestamp",   envKey: "RETENTION_MQTT_CONNECTION_LOGS_DAYS",  defaultDays: 365 },
  { table: "mqtt_reconnect_logs",        column: "timestamp",   envKey: "RETENTION_MQTT_RECONNECT_LOGS_DAYS",   defaultDays: 365 },
  { table: "package_activity_logs",      column: "createdAt",   envKey: "RETENTION_PACKAGE_ACTIVITY_LOGS_DAYS", defaultDays: 365 },
];

/** Exposed for tests/inspection — do not mutate. */
export function getRetentionTargets(): ReadonlyArray<Readonly<RetentionTarget>> {
  return TARGETS;
}

let timer: NodeJS.Timeout | null = null;
let loggedNativeSkips = false;

function envInt(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
}

function resolveDays(t: RetentionTarget): number {
  return envInt(t.envKey, t.defaultDays);
}

/**
 * Tables covered by an ACTIVE native TimescaleDB retention policy (migration
 * 0173). App-level pruning must skip those — "choose ONE mechanism per table"
 * (0118 note) — otherwise the two paths double-delete. Returns an empty set on
 * plain PostgreSQL (catalog absent) or on any error.
 */
export async function getNativeRetentionTables(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<Set<string>> {
  try {
    const rows = (await db.execute(
      sql`SELECT hypertable_name FROM timescaledb_information.jobs WHERE proc_name = 'policy_retention'`,
    )) as unknown as Array<{ hypertable_name: string }>;
    return new Set(rows.map((r) => r.hypertable_name));
  } catch {
    return new Set(); // timescaledb not installed — no native policies
  }
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

  const returning =
    t.captureColumns && t.captureColumns.length > 0
      ? sql.join(t.captureColumns.map((c) => sql.identifier(c)), sql.raw(", "))
      : sql.raw("1");

  let total = 0;
  // Bounded loop: at most enough iterations to clear a large backlog once.
  for (let i = 0; i < 1000; i++) {
    const deleted = (await db.execute(
      sql`DELETE FROM ${tableId}
          WHERE ctid IN (
            SELECT ctid FROM ${tableId} WHERE ${colId} < ${cutoff} LIMIT ${batch}
          )
          RETURNING ${returning}`,
    )) as unknown as Array<Record<string, unknown>>;
    const n = Array.isArray(deleted) ? deleted.length : 0;
    total += n;

    // Same-sweep artifact cleanup (image files) for the rows just deleted.
    if (n > 0 && t.onDeleted && t.captureColumns?.length) {
      try {
        await t.onDeleted(deleted);
      } catch (err: any) {
        console.error(`[Retention] ${t.table} post-delete cleanup failed:`, err?.message ?? err);
      }
    }
    if (n < batch) break;
  }
  if (total > 0) console.log(`[Retention] ${t.table}: deleted ${total} rows older than ${days}d`);
}

/**
 * One full retention sweep across all targets. Exported for tests and for
 * manual ops runs; scheduling/enablement is handled by startDataRetention.
 */
export async function runRetentionOnce(): Promise<void> {
  const dryRun = process.env.DATA_RETENTION_DRY_RUN === "true";
  const batch = Math.max(100, envInt("DATA_RETENTION_BATCH", 5000));

  const db = await getDb();
  if (!db) return;
  const nativePolicies = await getNativeRetentionTables(db);
  if (nativePolicies.size > 0 && !loggedNativeSkips) {
    loggedNativeSkips = true;
    console.log(
      `[Retention] native Timescale retention active on: ${[...nativePolicies].sort().join(", ")} — app-level pruning skips these tables`,
    );
  }

  for (const t of TARGETS) {
    if (nativePolicies.has(t.table)) continue; // native policy owns this table (0173)
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
  setTimeout(() => void runRetentionOnce(), 30_000);
  timer = setInterval(() => void runRetentionOnce(), intervalMs);
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
