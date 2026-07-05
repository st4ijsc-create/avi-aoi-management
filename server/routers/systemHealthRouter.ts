/**
 * Doc 24 / Tier-1b — SYSTEM HEALTH read router (key "systemHealth").
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Surfaces the internal health/status GETTERS that Waves 1/3 built but never
 * exposed over tRPC (they existed only as in-process getters with no route):
 *
 *   • storeForwardStatus   → OT telemetry store-and-forward WAL buffer snapshot
 *                            (buffered / backfilled / dropped / last-backfill …).
 *                            [server/services/ot/storeForward.ts → getStatus()]
 *   • connectionSupervisors → per-adapter OT connection HA state (reconnects /
 *                            failovers / active endpoint / last error).
 *                            [server/services/ot/otManager.ts → listSupervisorStatuses()]
 *   • aiModelHealth        → DINOv2 ONNX model path / present? / active tier.
 *                            [server/services/aiImageEmbedding.ts → getDinov2ModelHealth()]
 *
 * SAFETY (ABSOLUTE): every procedure is READ-ONLY. This router imports NO
 * command/dispatch path, calls NO driver, and writes NOTHING. It only reads the
 * in-process metric snapshots the underlying services already maintain. When a
 * flag is off / nothing is running the getters return honest empty/degraded
 * shapes (enabled:false, empty list, degraded tier) — the UI renders those as-is.
 *
 * RBAC: module 'machine_monitoring' / canView (mirrors fieldRouter / twinRouter
 * read ops). ctx.user is the source of truth — never the request body.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getStatus as getStoreForwardStatus } from "../services/ot/storeForward";
import { listSupervisorStatuses, isConnHaEnabled, isOtRunning } from "../services/ot/otManager";
import { getDinov2ModelHealth } from "../services/aiImageEmbedding";
import { getInspectionStoreForwardStatus } from "../services/inspection/inspectionStoreForward";
import { getQueryStats, getSlowQueries, getTopSlowQueries } from "../queryMonitor";

// ── W4-A (doc 27 gap B1 + deferred W1-A/W2-C surfacing) ──────────────────────

interface DbFeatureStatusRow {
  feature: string;
  status: string;
  detail: string | null;
  checkedAt: Date | string | null;
}

/**
 * Read the tiny ops-status table written by migrations 0172/0173/0180
 * (timescaledb hypertables / retention / integrity FKs). READ-ONLY. On DBs
 * where the table does not exist (migrations not applied) we return an honest
 * `available:false` instead of throwing.
 */
async function readDbFeatureStatus(): Promise<{ available: boolean; rows: DbFeatureStatusRow[] }> {
  try {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (!db) return { available: false, rows: [] };
    const result = await db.execute(
      sql`SELECT "feature", "status", "detail", "checkedAt" FROM db_feature_status ORDER BY "feature"`,
    );
    return { available: true, rows: Array.from(result as unknown as DbFeatureStatusRow[]) };
  } catch {
    return { available: false, rows: [] };
  }
}

export const systemHealthRouter = router({
  /**
   * OT telemetry store-and-forward WAL buffer snapshot. Pure in-memory getter
   * (no I/O). When OT_STORE_FORWARD_ENABLED is off the snapshot reports
   * enabled:false with a zeroed buffer — the passthrough (today's) behaviour.
   */
  storeForwardStatus: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => getStoreForwardStatus()),

  /**
   * Per-adapter OT connection supervisor status (HA / failover). Empty list
   * unless OT_CONN_HA_ENABLED is on AND adapters are supervised. `haEnabled` /
   * `otRunning` let the UI explain an empty list honestly.
   */
  connectionSupervisors: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({
      haEnabled: isConnHaEnabled(),
      otRunning: isOtRunning(),
      supervisors: listSupervisorStatuses(),
    })),

  /**
   * DINOv2 ONNX model health: resolved path, present?, and the active embedding
   * tier (onnx / text-of-image / heuristic). Async because it probes GGUF
   * availability to report the honest degrade tier when the model is absent.
   */
  aiModelHealth: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => getDinov2ModelHealth()),

  /**
   * W4-A (doc 27 gap B1): one READ-ONLY snapshot for the admin "DB & Ingest
   * health" card —
   *   • queryMonitor: live slow-query stats from the instrumented drizzle
   *     client (top offending normalized patterns + recent slow entries).
   *   • inspectionWal: inspection ingest store-and-forward WAL depth
   *     (deferred W2-C surfacing).
   *   • dbFeatures: db_feature_status rows — timescaledb/partitioning/
   *     integrity state written by migrations 0172/0173/0180 (deferred W1-A).
   *   • authCache: session-auth cache hit/miss stats (W4-B, gap B4).
   * Normalized SQL only (params/literals stripped) — still admin-gated because
   * query shapes reveal schema internals.
   */
  dbIngestHealth: protectedProcedure
    .use(requirePermission("admin_system", "canView"))
    .query(async () => {
      const dbFeatures = await readDbFeatureStatus();
      const { getAuthCacheStats } = await import("../services/authSessionCache");
      const { getInlineGateBreakerState } = await import("../services/aiQualityGate");
      return {
        queryMonitor: {
          ...getQueryStats(),
          topSlow: getTopSlowQueries(10),
          recentSlow: getSlowQueries(10),
        },
        inspectionWal: getInspectionStoreForwardStatus(),
        authCache: getAuthCacheStats(),
        aiInlineGateBreaker: getInlineGateBreakerState(),
        dbFeatures,
      };
    }),
});
