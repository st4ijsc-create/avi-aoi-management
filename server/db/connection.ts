import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { ENV } from '../_core/env';
import { instrumentPostgresClient } from "../queryMonitor";

let _db: ReturnType<typeof drizzle> | null = null;
let _client: ReturnType<typeof postgres> | null = null;

// W4-D (doc 27 §8 B5) — pool sizing is env-tunable. The primary pool serves
// API/socket request traffic; a SEPARATE, smaller pool (getJobsDb below) serves
// background jobs so a scheduler storm can never exhaust the request pool.
// Exported for tests (pure, no connection side-effect).
export function resolvePoolMax(): number {
  const n = Number(process.env.DB_POOL_MAX);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 25;
}
export function resolveJobsPoolMax(): number {
  const n = Number(process.env.DB_POOL_MAX_JOBS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 8;
}
// T-3 (doc 38 R-2a) — read-replica pool sizing (env DB_POOL_MAX_READ, default 15).
export function resolveReadPoolMax(): number {
  const n = Number(process.env.DB_POOL_MAX_READ);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15;
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      console.log("[Database] Connecting to PostgreSQL...");
      // G0: statement_timeout chống truy vấn treo (feature-flag qua ENV, mặc định 30s).
      // Đặt 0 để tắt. Áp dụng ở cấp connection để mọi query đều có trần thời gian.
      const stmtTimeoutMs = Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 30000);
      _client = postgres(process.env.DATABASE_URL, {
        max: resolvePoolMax(), // W4-D (B5): env DB_POOL_MAX, default 25 (was hard-coded 10)
        idle_timeout: 20,
        connect_timeout: 30,
        max_lifetime: 60 * 10,
        connection: stmtTimeoutMs > 0
          ? { statement_timeout: stmtTimeoutMs }
          : undefined,
      });
      // W4-A (doc 27 gap B1): time every query drizzle sends through this client
      // and feed the in-memory slow-query monitor. No-op when
      // QUERY_MONITOR_ENABLED=false (client left untouched — zero overhead).
      instrumentPostgresClient(_client);
      _db = drizzle(_client);
      console.log("[Database] Connected successfully");
    } catch (error) {
      console.error("[Database] Failed to connect:", error);
      _db = null;
      _client = null;
    }
  }
  return _db;
}

// ── W4-D (doc 27 §8 B5) — dedicated background-jobs pool ─────────────────────
// Distinct postgres-js client (default max 8, env DB_POOL_MAX_JOBS) used by
// long-running background sweeps (dataRetentionService, integrityScanService,
// materializedViewRefreshService). Keeps bulk DELETE/scan work from starving
// interactive API queries on the primary pool. Same statement_timeout policy
// and the same W4-A slow-query instrumentation as the primary client.
let _jobsDb: ReturnType<typeof drizzle> | null = null;
let _jobsClient: ReturnType<typeof postgres> | null = null;

export async function getJobsDb() {
  if (!_jobsDb && process.env.DATABASE_URL) {
    try {
      const stmtTimeoutMs = Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 30000);
      _jobsClient = postgres(process.env.DATABASE_URL, {
        max: resolveJobsPoolMax(),
        idle_timeout: 20,
        connect_timeout: 30,
        max_lifetime: 60 * 10,
        connection: stmtTimeoutMs > 0
          ? { statement_timeout: stmtTimeoutMs }
          : undefined,
      });
      instrumentPostgresClient(_jobsClient);
      _jobsDb = drizzle(_jobsClient);
      console.log(`[Database] Jobs pool ready (max ${resolveJobsPoolMax()})`);
    } catch (error) {
      console.error("[Database] Jobs pool failed to connect:", error);
      _jobsDb = null;
      _jobsClient = null;
    }
  }
  return _jobsDb;
}

// ── T-3 (doc 38 R-2a) — read-replica seam `getReadDb()` ──────────────────────
// A THIRD, separate postgres-js client that routes heavy READ-ONLY analytics /
// BI / report queries to a physical read replica (env DATABASE_READ_URL) so
// long dashboard/report scans never compete with request/write traffic on the
// primary pool. Distinct pool (default max 15, env DB_POOL_MAX_READ), same
// statement_timeout policy and W4-A slow-query instrumentation as the primary.
//
// HONEST-DEGRADE (single-node stays working with zero config):
//   • DATABASE_READ_URL absent            → returns the PRIMARY getDb().
//   • replica pool fails to connect        → returns the PRIMARY getDb().
// Same correctness in both cases; you simply lose the read/write split.
//
// ⚠ EVENTUAL CONSISTENCY (replica lag): a streaming replica trails the primary
// by ms–seconds. Route ONLY queries that TOLERATE a slightly stale snapshot
// (dashboards, reports, BI rollups). NEVER route here:
//   • any INSERT/UPDATE/DELETE or transaction (a replica is read-only),
//   • a read-your-own-write that must observe a just-committed row,
//   • anything whose correctness depends on the very latest committed state.
// The write path (getDb / getJobsDb) is UNCHANGED — this seam is additive.
let _readDb: ReturnType<typeof drizzle> | null = null;
let _readClient: ReturnType<typeof postgres> | null = null;

export async function getReadDb() {
  // No replica configured → honest-degrade to the primary pool.
  if (!process.env.DATABASE_READ_URL) {
    return getDb();
  }
  if (!_readDb) {
    try {
      const stmtTimeoutMs = Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 30000);
      _readClient = postgres(process.env.DATABASE_READ_URL, {
        max: resolveReadPoolMax(),
        idle_timeout: 20,
        connect_timeout: 30,
        max_lifetime: 60 * 10,
        connection: stmtTimeoutMs > 0
          ? { statement_timeout: stmtTimeoutMs }
          : undefined,
      });
      instrumentPostgresClient(_readClient);
      _readDb = drizzle(_readClient);
      console.log(`[Database] Read-replica pool ready (max ${resolveReadPoolMax()})`);
    } catch (error) {
      // Honest-degrade: a broken replica must NOT take down reads — fall back
      // to the primary pool (correct, just no split) instead of throwing.
      console.error("[Database] Read-replica pool failed to connect — falling back to primary:", error);
      _readDb = null;
      _readClient = null;
      return getDb();
    }
  }
  return _readDb;
}
