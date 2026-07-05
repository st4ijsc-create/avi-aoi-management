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
