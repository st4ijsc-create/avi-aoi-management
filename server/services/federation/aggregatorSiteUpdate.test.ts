/**
 * U5 (doc 21 §6 / §3 G-7) — aggregator site:update live layer + honest degradation.
 *
 *   • a successful poll EMITS site:update (mock socket) carrying compact freshness +
 *     headline KPIs + alert counts.
 *   • a DOWN site does NOT emit site:update and does NOT fabricate a snapshot — it
 *     records a failed sync + increments consecutiveFailures (isolation preserved).
 *   • flag-off: startFederationAggregator is a no-op when FEDERATION_AGGREGATOR_ENABLED
 *     is unset (never fires a cycle / never emits).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Site } from "../../../drizzle/schema";

const siteUpdates: any[] = [];
vi.mock("../../_core/socket", () => ({ emitSiteUpdate: (e: any) => siteUpdates.push(e) }));

// siteClient result is swapped per-test via the holder.
const holder: { result: any } = { result: null };
vi.mock("./siteClient", () => ({ fetchSiteKpis: vi.fn(async () => holder.result) }));

// rollupStore is a no-op sink (we assert emit, not persistence, here).
const store = { upserts: 0, syncLogs: [] as any[] };
vi.mock("./rollupStore", () => ({
  upsertSnapshot: vi.fn(async () => { store.upserts++; return 7; }),
  writeSyncLog: vi.fn(async (_db: any, row: any) => { store.syncLogs.push(row); }),
}));

// A fake db whose sites.update captures the status write; select returns one due site.
const dbState = { siteUpdateSet: null as any };
function makeSite(overrides: Partial<Site> = {}): Site {
  return {
    id: 1, code: "HCM01", name: "HCM", corporateCode: "ACME", baseUrl: "https://hcm.local",
    region: "VN", authType: "master_key", authTokenRef: null, unsBrokerUrl: null,
    pollIntervalSec: 60, status: "active", isLocal: false, lastSyncAt: null, lastError: null,
    consecutiveFailures: 0, createdAt: new Date(), updatedAt: new Date(), ...overrides,
  } as unknown as Site;
}
let siteRows: Site[] = [];
function makeDb() {
  return {
    select: () => ({ from: () => Promise.resolve(siteRows) }),
    update: () => ({ set: (v: any) => ({ where: async () => { dbState.siteUpdateSet = v; } }) }),
  };
}
vi.mock("../../db/connection", () => ({ getDb: async () => makeDb() }));

const okSnapshot = {
  asOf: new Date("2026-07-01T08:00:00Z"),
  windowStart: new Date(), windowEnd: new Date(),
  totalInspections: 100, okCount: 95, ngCount: 5, ntfCount: 0,
  yieldRate: 95, ngRate: 5, throughput: 100, oee: 82.5, avgCycleTime: 13,
  defectPareto: [], detailRows: [], fleet: null, safety: null, pdm: null,
  alertRollup: { open: 5, critical: 2, nearMiss: 1, top: [] }, endpointsHit: [],
};

beforeEach(() => {
  siteUpdates.length = 0;
  store.upserts = 0;
  store.syncLogs.length = 0;
  dbState.siteUpdateSet = null;
  // a due site: lastSyncAt null → always due; consecutiveFailures 0 → circuit closed.
  siteRows = [makeSite()];
  delete process.env.FEDERATION_AGGREGATOR_ENABLED;
});
afterEach(() => vi.restoreAllMocks());

describe("aggregator site:update + honest degradation", () => {
  it("emits site:update with KPIs + alert counts on a successful poll", async () => {
    holder.result = { ok: true, httpStatus: 200, endpointsHit: [], snapshot: okSnapshot };
    const { triggerAggregationCycle } = await import("./aggregatorService");
    await triggerAggregationCycle();

    expect(store.upserts).toBe(1);
    expect(siteUpdates).toHaveLength(1);
    const u = siteUpdates[0];
    expect(u.siteCode).toBe("HCM01");
    expect(u.freshness).toBe("ok");
    expect(u.kpi.yieldRate).toBe(95);
    expect(u.kpi.oee).toBe(82.5);
    expect(u.alerts).toEqual({ open: 5, critical: 2 });
  });

  it("a DOWN site does NOT emit site:update and does NOT fabricate a snapshot", async () => {
    holder.result = { ok: false, httpStatus: 503, endpointsHit: [], error: "summary HTTP 503" };
    const { triggerAggregationCycle } = await import("./aggregatorService");
    await triggerAggregationCycle();

    expect(store.upserts).toBe(0); // nothing landed
    expect(siteUpdates).toHaveLength(0); // no live emit for a failed poll
    // isolation: status flips to error + consecutiveFailures increments (honest).
    expect(dbState.siteUpdateSet?.status).toBe("error");
    expect(dbState.siteUpdateSet?.consecutiveFailures).toBe(1);
    expect(store.syncLogs[0]?.status).toBe("failed");
  });

  it("flag-off: startFederationAggregator is a no-op (no cycle, no emit)", async () => {
    holder.result = { ok: true, httpStatus: 200, endpointsHit: [], snapshot: okSnapshot };
    const { startFederationAggregator, stopFederationAggregator } = await import("./aggregatorService");
    startFederationAggregator(); // flag unset → should not run
    // give any (erroneously) scheduled immediate cycle a tick — there should be none.
    await new Promise((r) => setTimeout(r, 10));
    expect(siteUpdates).toHaveLength(0);
    expect(store.upserts).toBe(0);
    stopFederationAggregator();
  });
});
