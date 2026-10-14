/**
 * doc 81 Dot 11 task G - SIZE WATCH of the append-only (WORM) safety / evidence tables.
 *
 * Owner decision (2026-10-14): these tables are kept FOREVER; nothing deletes, truncates or archives them. The only thing that
 * can be done about growth is to SEE it: this module measures each table (pg_total_relation_size + the planner row estimate
 * reltuples) once an hour (WORM_SIZE_CHECK_INTERVAL_MS) and raises an alert of its own kind (worm_table_size: alert stream + a
 * normal / high-priority inbox row per active admin, NOT safety-critical, NOT cap-exempt - R-11-b) the first time a table crosses a
 * level - "warn", then "critical"; delivery is remembered in the inbox rows themselves, so a restart never re-raises.
 * Final fix wave (R-11-k 4): a recipient whose own preferences suppress the row is not retried by the process (logged once), and the
 * alert stream / console line is said once per process per (table, level) - not every hour. READ-ONLY: only SELECTs on the catalog; no DDL, no DML on the tables, no delete path anywhere.
 */
import { sql } from "drizzle-orm";

/** The append-only tables of migrations 0363-0376 (+ older WORM ledgers of the same class). A missing table is skipped. */
export const WORM_TABLES = [
  "edge_node_report_records", // 0373 - WORM report stream
  "edge_node_program_reports", // 0373
  "edge_stop_ack_refusals", // 0374 - refused edge STOP acks (evidence)
  "central_stop_executions", // 0374 - every central STOP attempt
  "device_owner_changes", // 0374 - ownership history
  "ot_write_late_result_reviews", // 0374 - late OT write result reviews
  "edge_step_authorizations", // 0372
  "edge_robot_trust_approvals", // 0375 - trust approvals
  "api_key_holder_changes", // 0369 - holder history
  "safety_plc_config_trust", // 0368 - config trust
  "safety_event_trust", // 0371
  "command_log", // 0279 - true append-only command ledger
  "control_audit_log", // 0224 - WORM control audit
] as const;

export type WormLevel = 0 | 1 | 2; // 0 ok, 1 warn, 2 critical
export interface WormThresholds {
  warnBytes: number;
  criticalBytes: number;
  warnRows: number;
  criticalRows: number;
}
export const DEFAULT_WORM_THRESHOLDS: WormThresholds = {
  warnBytes: 2 * 1024 ** 3,
  criticalBytes: 10 * 1024 ** 3,
  warnRows: 20_000_000,
  criticalRows: 100_000_000,
};
export const DEFAULT_WORM_CHECK_INTERVAL_MS = 3_600_000;
export const MIN_WORM_CHECK_INTERVAL_MS = 60_000;

function posNum(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return v != null && v.trim() !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
}
/** Thresholds from env (WORM_SIZE_WARN_BYTES, WORM_SIZE_CRITICAL_BYTES, WORM_ROWS_WARN, WORM_ROWS_CRITICAL); bad values fall back; critical is never below warn. */
export function wormThresholdsFromEnv(env: NodeJS.ProcessEnv = process.env): WormThresholds {
  const d = DEFAULT_WORM_THRESHOLDS;
  const warnBytes = posNum(env.WORM_SIZE_WARN_BYTES, d.warnBytes);
  const warnRows = posNum(env.WORM_ROWS_WARN, d.warnRows);
  return {
    warnBytes,
    warnRows,
    criticalBytes: Math.max(warnBytes, posNum(env.WORM_SIZE_CRITICAL_BYTES, d.criticalBytes)),
    criticalRows: Math.max(warnRows, posNum(env.WORM_ROWS_CRITICAL, d.criticalRows)),
  };
}
export function wormCheckIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  return Math.max(MIN_WORM_CHECK_INTERVAL_MS, posNum(env.WORM_SIZE_CHECK_INTERVAL_MS, DEFAULT_WORM_CHECK_INTERVAL_MS));
}

/** THE compare: a value AT the threshold has crossed it (>=). Either measure crossing is enough; critical wins. */
export function wormLevel(bytes: number, rows: number, t: WormThresholds): WormLevel {
  if (bytes >= t.criticalBytes || rows >= t.criticalRows) return 2;
  if (bytes >= t.warnBytes || rows >= t.warnRows) return 1;
  return 0;
}

export interface WormTableSize {
  table: string;
  bytes: number;
  /** planner estimate (reltuples); 0 when the table was never analysed (-1) */
  rowsEstimate: number;
  level: WormLevel;
}

type Executor = { execute: (q: unknown) => Promise<unknown> };
function rowsOf(r: unknown): Array<Record<string, unknown>> {
  return (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, unknown>>;
}

/** Read the size of every WORM table that exists. Read-only. */
export async function readWormTableSizes(db: Executor, t: WormThresholds = wormThresholdsFromEnv(), tables: ReadonlyArray<string> = WORM_TABLES): Promise<WormTableSize[]> {
  const out: WormTableSize[] = [];
  for (const table of tables) {
    const r = rowsOf(
      await db.execute(sql`
        SELECT pg_total_relation_size(c.oid)::bigint AS bytes, c.reltuples::float8 AS rows
          FROM pg_class c
         WHERE c.oid = to_regclass(${"public." + table}) `),
    );
    if (r.length === 0) continue;
    const bytes = Number(r[0].bytes) || 0;
    const rowsEstimate = Math.max(0, Math.round(Number(r[0].rows) || 0));
    out.push({ table, bytes, rowsEstimate, level: wormLevel(bytes, rowsEstimate, t) });
  }
  return out;
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GiB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  return `${Math.round(n / 1024)} KiB`;
}

/**
 * R-11-b - dedup is PERSISTENT and derived from the existing alert rows (notifications.metadata {kind:"worm_table_size", table,
 * level}), per (recipient, table): the highest level already delivered. A restart therefore never re-raises; a recipient whose row
 * could not be written is simply tried again at the next check.
 */
export async function readDeliveredLevels(db: Executor): Promise<Map<string, WormLevel>> {
  const r = rowsOf(
    await db.execute(sql`
      SELECT "userId" AS uid, metadata->>'table' AS tbl, max((metadata->>'level')::int) AS lvl
        FROM public.notifications
       WHERE metadata->>'kind' = 'worm_table_size'
       GROUP BY "userId", metadata->>'table'`),
  );
  const m = new Map<string, WormLevel>();
  for (const x of r) m.set(`${Number(x.uid)}:${String(x.tbl)}`, Math.min(2, Math.max(0, Number(x.lvl) || 0)) as WormLevel);
  return m;
}

export interface WormAlert {
  kind: "worm_table_size";
  table: string;
  level: 1 | 2;
  title: string;
  message: string;
  /** only the recipients that do not yet hold this level (or a higher one) */
  recipients: number[];
}
/**
 * doc 81 Dot 11 final fix wave (R-11-k 4, final review M-2) - a sink may report the recipients whose row was SUPPRESSED by their own
 * preferences (in-app alerts off, quiet hours: sendNotification answered null). Those are NOT retried by this process (logged once);
 * a recipient whose send FAILED (threw) is still retried at the next check.
 */
export type WormAlertSink = (a: WormAlert) => Promise<void | { suppressed?: number[] }>;

/** per process: `${userId}:${table}:${level}` suppressed by the recipient's preferences - never retried, logged once (R-11-k 4) */
const suppressedByPrefs = new Set<string>();
/** per process: `${table}:${level}` already announced on the alert stream + console - said once, not every hour (R-11-k 4) */
const announced = new Set<string>();
/** Test seam: forget the per-process memory (a "restart"). */
export function _resetWormMonitorMemoryForTests(): void {
  suppressedByPrefs.clear();
  announced.clear();
}

async function adminRecipients(db: Executor): Promise<number[]> {
  return rowsOf(await db.execute(sql`SELECT id FROM public.users WHERE "isActive" = true AND role = 'admin'`))
    .map((x) => Number(x.id))
    .filter((x) => Number.isSafeInteger(x) && x > 0);
}

/**
 * Own kind, plain notifications: warn = NORMAL, critical = HIGH priority. NO safetyCritical, NO capExempt (R-8-d reserves the
 * exemptions for alarms where a STOP is at stake) - the recipient's preferences and the normal caps apply.
 */
export async function defaultWormSink(a: WormAlert): Promise<{ suppressed: number[] }> {
  const once = `${a.table}:${a.level}`;
  if (!announced.has(once)) {
    announced.add(once);
    console.error(`[WormSize] ${a.level === 2 ? "CRITICAL" : "WARN"}: ${a.message}`);
    try {
      const { publishAnomalyDetected } = await import("../ecosystem/ecosystemEvents");
      publishAnomalyDetected({ kind: "worm_table_size", severity: a.level === 2 ? "critical" : "warning", source: "ot", machineId: null, message: a.message }, "ot");
    } catch {
      /* the notification rows below are the durable part */
    }
  }
  const { sendNotification } = await import("../notificationService");
  const suppressed: number[] = [];
  for (const userId of a.recipients) {
    const FAILED = Symbol("failed");
    const r = await sendNotification(userId, {
      type: "ALERT",
      priority: a.level === 2 ? "HIGH" : "NORMAL",
      title: a.title,
      message: a.message,
      entityType: "db_table",
      metadata: { kind: "worm_table_size", table: a.table, level: a.level },
    }).catch(() => FAILED);
    if (r === null) suppressed.push(userId); // the recipient's preferences suppressed it (no row) - not an error
  }
  return { suppressed };
}

/** One check: measure, alert each new (recipient, table, level) crossing once. Never throws, never writes to a WORM table. */
export async function checkWormTableSizes(opts: { db?: Executor; thresholds?: WormThresholds; sink?: WormAlertSink; tables?: ReadonlyArray<string> } = {}): Promise<WormTableSize[]> {
  try {
    const db = opts.db ?? ((await (await import("../../db/connection")).getDb()) as unknown as Executor | null);
    if (!db) return [];
    const thresholds = opts.thresholds ?? wormThresholdsFromEnv();
    const sizes = await readWormTableSizes(db, thresholds, opts.tables);
    const over = sizes.filter((s) => s.level > 0);
    if (over.length > 0) {
      const [recipients, delivered] = [await adminRecipients(db), await readDeliveredLevels(db)];
      const sink = opts.sink ?? defaultWormSink;
      for (const s of over) {
        const need = recipients.filter((u) => (delivered.get(`${u}:${s.table}`) ?? 0) < s.level && !suppressedByPrefs.has(`${u}:${s.table}:${s.level}`));
        if (need.length === 0) continue;
        const lvl = s.level === 2 ? "critical" : "warn";
        const out = await sink({
          kind: "worm_table_size",
          table: s.table,
          level: s.level as 1 | 2,
          title: `Append-only table ${s.table} is large (${lvl})`,
          message: `Append-only table ${s.table}: ${formatBytes(s.bytes)}, about ${s.rowsEstimate} rows (${lvl} threshold crossed). The table is kept forever and is never deleted automatically - plan storage / archiving with the owner.`,
          recipients: need,
        }).catch((e) => {
          console.error(`[WormSize] alert for ${s.table} failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
          return undefined;
        });
        const blocked = (out && Array.isArray(out.suppressed) ? out.suppressed : []).filter((u) => need.includes(u) && !suppressedByPrefs.has(`${u}:${s.table}:${s.level}`));
        if (blocked.length > 0) {
          for (const u of blocked) suppressedByPrefs.add(`${u}:${s.table}:${s.level}`);
          console.warn(`[WormSize] the ${lvl} alert for ${s.table} was suppressed by the preferences of user(s) ${blocked.join(", ")} - not retried by this process`);
        }
      }
    }
    return sizes;
  } catch (e) {
    console.error(`[WormSize] check failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
    return [];
  }
}

/** Start the periodic check (first run shortly after boot, then every WORM_SIZE_CHECK_INTERVAL_MS). Returns the stop function. */
export function startWormSizeMonitor(): () => void {
  const every = wormCheckIntervalMs();
  const first = setTimeout(() => void checkWormTableSizes(), 30_000);
  const timer = setInterval(() => void checkWormTableSizes(), every);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
