import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { ENV } from '../_core/env';
import { instrumentPostgresClient } from "../queryMonitor";
import { edgeDbRefused } from "./edgeDbTrap";

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

// ── doc 81 Đợt 10 task A (design §2.15) — EDGE-ROLE DB TRAP ──────────────────────────────────────────────────────────
// The edge gateway (server/edge/edgeGatewayMain.ts sets AVI_PROCESS_ROLE=edge before any import) holds NO central DB login.
// In that role getDb / getJobsDb / getReadDb never construct a postgres client, whatever DATABASE_URL says (the shared guard
// ./edgeDbTrap.ts — fix review 1 (I2): the SAME guard now precedes every raw postgres() construction under server/):
//   • default (production): return null, log loudly ONCE, count every attempt (edgeDbTrapCount — the E2E asserts 0);
//   • EDGE_DB_TRAP=throw (tests / CI): throw EdgeDbTrapError (code EDGE_DB_TRAP).
// Any other EDGE_DB_TRAP value is the default (null) — there is no "allow".
export { EdgeDbTrapError, edgeDbRefused, edgeDbTrapCount, edgeDbTrapStats, isEdgeProcessRole } from "./edgeDbTrap";
export async function getDb() {
  if (edgeDbRefused("getDb")) return null;
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
  if (edgeDbRefused("getJobsDb")) return null;
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
  if (edgeDbRefused("getReadDb")) return null;
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

// ── ★ Đợt 8.0 — kết nối PHIÊN RIÊNG cho khoá advisory cấp phiên (bầu chủ Luồng AI) ─────────────────────────────────────────────
// Khoá `pg_try_advisory_lock` sống theo KẾT NỐI nên cần một kết nối giữ riêng (max 1, không idle) ngoài pool ứng dụng. Nhà máy client này nằm Ở ĐÂY để
// mọi nơi cần phiên riêng đi qua CÙNG bẫy edge (edgeDbRefused) và tệp gọi (services/flow/bauChu.ts) không phải import driver. Người gọi phải .end().
// Trên edge: trả null (đếm + log một lần), hoặc ném EdgeDbTrapError khi EDGE_DB_TRAP=throw — KHÔNG mở kết nối, KHÔNG treo.
export function openSessionClient(name: string, url: string | undefined = process.env.DATABASE_URL): ReturnType<typeof postgres> | null {
  if (edgeDbRefused(`openSessionClient:${name}`)) return null;
  if (!url) return null;
  return postgres(url, {
    max: 1,
    idle_timeout: 0,
    connect_timeout: 10,
    connection: { application_name: `avi-${name}` },
    onnotice: () => undefined,
  });
}

// ── doc 81 Đợt 12 task P fix 1 (M-1) — the DEDICATED LISTEN / NOTIFY client ────────────────────────────────────────────────────
// One postgres client OUTSIDE the app pool for the pg channels (`ot_stop_epoch`, `device_owner_changed`): its NOTIFY connection
// (max 1) carries the cross-replica STOP broadcast and the listeners' heartbeats, and its own LISTEN connection (postgres.js opens one
// per client) carries the subscriptions. A saturated app pool therefore neither delays a broadcast nor fakes a lost heartbeat.
// Short statement timeout (a NOTIFY is one tiny statement). Never on the edge (no DB login there).
let _notifyClient: ReturnType<typeof postgres> | null = null;
export function getNotifyClient(): ReturnType<typeof postgres> | null {
  if (edgeDbRefused("getNotifyClient")) return null;
  if (!_notifyClient && process.env.DATABASE_URL) {
    try {
      _notifyClient = postgres(process.env.DATABASE_URL, {
        max: 1,
        idle_timeout: 0,
        connect_timeout: 10,
        max_lifetime: null,
        connection: { statement_timeout: 5_000, application_name: "avi-notify" },
        onnotice: () => undefined,
      });
    } catch (error) {
      console.error("[Database] LISTEN/NOTIFY client failed:", (error as Error)?.message ?? error);
      _notifyClient = null;
    }
  }
  return _notifyClient;
}
