/**
 * W4-A (doc 27 gap B1) — systemHealth.dbIngestHealth endpoint shape + RBAC:
 *   • returns { queryMonitor (stats + topSlow + recentSlow), inspectionWal,
 *     dbFeatures } — one read-only snapshot for the admin "DB & Ingest" card.
 *   • admin_system/canView gate is enforced (FORBIDDEN otherwise).
 *   • db_feature_status read degrades honestly (available:false) when the
 *     table/DB is missing instead of throwing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// RBAC middleware — toggled per test
const perm = { allow: true };
vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => {
    if (!perm.allow) {
      const { TRPCError } = await import("@trpc/server");
      throw new TRPCError({ code: "FORBIDDEN", message: "no admin_system/canView" });
    }
    return next({ ctx });
  },
}));

// The other health getters this router imports — keep them inert.
vi.mock("../services/ot/storeForward", () => ({
  getStatus: vi.fn(() => ({ enabled: false })),
}));
vi.mock("../services/ot/otManager", () => ({
  listSupervisorStatuses: vi.fn(() => []),
  isConnHaEnabled: vi.fn(() => false),
  isOtRunning: vi.fn(() => false),
}));
vi.mock("../services/aiImageEmbedding", () => ({
  getDinov2ModelHealth: vi.fn(async () => ({ modelPresent: false })),
}));

// Inspection WAL getter (deferred W2-C surfacing)
const walStatus = {
  enabled: true,
  bufferedCount: 3,
  bufferedBytes: 1024,
  maxEntries: 5000,
  maxAgeMs: 86_400_000,
  maxBytes: 268_435_456,
  walFile: "/data/inspection-wal.jsonl",
  deadLetterFile: "/data/inspection-dead-letter.jsonl",
  buffered: 10,
  backfilled: 7,
  deduped: 1,
  deadLettered: 0,
  droppedOverflow: 0,
  droppedAge: 0,
  droppedBytes: 0,
  lastBackfillAt: null,
  lastBufferedAt: null,
};
vi.mock("../services/inspection/inspectionStoreForward", () => ({
  getInspectionStoreForwardStatus: vi.fn(() => walStatus),
}));

// db_feature_status read — fake drizzle db with execute()
const dbState = { mode: "ok" as "ok" | "throws" | "nodb" };
const featureRows = [
  { feature: "retention_12mo", status: "ok", detail: null, checkedAt: new Date("2026-07-01T00:00:00Z") },
  { feature: "timescaledb_hypertables", status: "missing", detail: "extension not available", checkedAt: new Date("2026-07-01T00:00:00Z") },
];
vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => {
    if (dbState.mode === "nodb") return null;
    return {
      execute: vi.fn(async () => {
        if (dbState.mode === "throws") throw new Error('relation "db_feature_status" does not exist');
        return featureRows;
      }),
    };
  }),
}));

import { systemHealthRouter } from "./systemHealthRouter";
import { recordQuery, clearMetricsHistory } from "../queryMonitor";

const ctx = { user: { id: 1, role: "admin", name: "Admin" } } as any;
const caller = systemHealthRouter.createCaller(ctx);

const savedSlowMs = process.env.SLOW_QUERY_MS;

beforeEach(() => {
  perm.allow = true;
  dbState.mode = "ok";
  clearMetricsHistory();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  if (savedSlowMs === undefined) delete process.env.SLOW_QUERY_MS;
  else process.env.SLOW_QUERY_MS = savedSlowMs;
  clearMetricsHistory();
  vi.restoreAllMocks();
});

describe("systemHealth.dbIngestHealth", () => {
  it("returns monitor stats + top slow queries + WAL depth + db feature rows", async () => {
    process.env.SLOW_QUERY_MS = "200";
    recordQuery("select * from product_inspections where id = $1", 350);
    recordQuery("select * from product_inspections where id = $1", 450);
    recordQuery("select 1", 2);

    const res = await caller.dbIngestHealth();

    // query monitor block
    expect(res.queryMonitor.enabled).toBe(true);
    expect(res.queryMonitor.thresholdMs).toBe(200);
    expect(res.queryMonitor.totalQueries).toBe(3);
    expect(res.queryMonitor.slowQueries).toBe(2);
    expect(res.queryMonitor.topSlow).toHaveLength(1);
    expect(res.queryMonitor.topSlow[0]).toMatchObject({
      count: 2,
      slowCount: 2,
      avgTime: 400,
      maxTime: 450,
    });
    expect(res.queryMonitor.topSlow[0].query).toContain("product_inspections");
    expect(res.queryMonitor.topSlow[0].query).toContain("$?"); // normalized
    expect(res.queryMonitor.recentSlow).toHaveLength(2);
    expect(res.queryMonitor.recentSlow[0].isSlowQuery).toBe(true);

    // inspection WAL block (deferred W2-C)
    expect(res.inspectionWal.bufferedCount).toBe(3);
    expect(res.inspectionWal.enabled).toBe(true);

    // db_feature_status block (deferred W1-A)
    expect(res.dbFeatures.available).toBe(true);
    expect(res.dbFeatures.rows).toHaveLength(2);
    expect(res.dbFeatures.rows[1]).toMatchObject({
      feature: "timescaledb_hypertables",
      status: "missing",
    });
  });

  it("degrades honestly when db_feature_status is missing (no throw)", async () => {
    dbState.mode = "throws";
    const res = await caller.dbIngestHealth();
    expect(res.dbFeatures).toEqual({ available: false, rows: [] });
  });

  it("degrades honestly when the DB is not connected", async () => {
    dbState.mode = "nodb";
    const res = await caller.dbIngestHealth();
    expect(res.dbFeatures).toEqual({ available: false, rows: [] });
  });

  it("is FORBIDDEN without admin_system/canView", async () => {
    perm.allow = false;
    await expect(caller.dbIngestHealth()).rejects.toThrow(/FORBIDDEN|canView/i);
  });
});
