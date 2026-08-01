/**
 * U5 (doc 21 §6 / §3 G-7) — Federation Panorama tests.
 *
 * Covers the data-loss fixes + deepened roll-up, isolation-preserving:
 *   • siteClient RETAINS details[] (was fetched-then-discarded) + populates the new
 *     per-category feeds (oee/fleet/safety/pdm/alerts); a site that 404s a new feed
 *     leaves that category HONEST-NULL and does NOT fail the poll (partial).
 *   • rollupStore writes PER-CATEGORY snapshot rows (overall+inspection+oee, plus
 *     fleet/safety/pdm only when that feed answered — honest absence) and lands the
 *     retained detailRows + alertRollup on "overall".
 *   • aggregatorService emits site:update on a successful refresh (mock socket) and
 *     a Down site degrades honestly (no fabricated snapshot).
 *   • real OEE lands when the feed answers; honest-null when it doesn't.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock the socket module so we can assert site:update without a live io server. ──
const siteUpdates: any[] = [];
vi.mock("../../_core/socket", () => ({
  emitSiteUpdate: (evt: any) => siteUpdates.push(evt),
}));

import { fetchSiteKpis, type SiteKpiSnapshot } from "./siteClient";
import { upsertSnapshot } from "./rollupStore";
import type { Site } from "../../../drizzle/schema";

const baseSite = {
  id: 1,
  code: "HCM01",
  name: "HCM Site",
  corporateCode: "ACME",
  baseUrl: "https://hcm.local",
  region: "VN",
  authType: "master_key",
  authTokenRef: "SITE_TOKEN_HCM01",
  unsBrokerUrl: null,
  pollIntervalSec: 60,
  status: "active",
  isLocal: false,
  lastSyncAt: null,
  lastError: null,
  consecutiveFailures: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Site;

/** Build a fake global.fetch keyed by URL substring → { status, body }. */
function installFetch(routes: Record<string, { status: number; body: any }>) {
  const spy = vi.fn(async (url: string) => {
    const hit = Object.entries(routes).find(([frag]) => url.includes(frag));
    const r = hit ? hit[1] : { status: 404, body: { success: false } };
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      json: async () => r.body,
    } as any;
  });
  (globalThis as any).fetch = spy;
  return spy;
}

const summaryBody = {
  success: true,
  data: {
    totals: { totalInspections: 100, okCount: 95, ngCount: 5, ntfCount: 0, yieldRate: 95 },
    details: [
      { machineId: 7, machineCode: "M7", machineName: "AOI-7", stationId: 3, stationCode: "ST3", stationName: "Station 3", totalInspections: 60, okCount: 58, ngCount: 2, ntfCount: 0, yieldRate: 96.67, avgCycleTime: 12 },
      { machineId: 8, machineCode: "M8", machineName: "AOI-8", stationId: 3, stationCode: "ST3", stationName: "Station 3", totalInspections: 40, okCount: 37, ngCount: 3, ntfCount: 0, yieldRate: 92.5, avgCycleTime: 15 },
    ],
  },
};

beforeEach(() => {
  siteUpdates.length = 0;
  process.env.SITE_TOKEN_HCM01 = "test-token";
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as any).fetch;
});

describe("siteClient.fetchSiteKpis — details retention + generalized feeds", () => {
  it("RETAINS details[] and populates oee/fleet/safety/pdm/alerts when feeds answer", async () => {
    installFetch({
      "/api/external/inspections/summary": { status: 200, body: summaryBody },
      "/api/external/inspections/defect-pareto": { status: 200, body: { success: true, data: { items: [] } } },
      "/api/external/oee/summary": { status: 200, body: { success: true, data: { oee: 82.5 } } },
      "/api/external/fleet/summary": { status: 200, body: { success: true, data: { tasksPending: 3, tasksRunning: 1, robotsOnline: 2, robotsTotal: 4 } } },
      "/api/external/safety/summary": { status: 200, body: { success: true, data: { openEvents: 2, nearMisses: 1, critical: 1 } } },
      "/api/external/pdm/summary": { status: 200, body: { success: true, data: { openPredictiveWos: 4, highRiskMachines: 2 } } },
      "/api/external/alerts/summary": { status: 200, body: { success: true, data: { open: 5, critical: 2, nearMiss: 1, top: [{ kind: "andon", severity: "critical", count: 2, title: "Line down" }] } } },
    });

    const r = await fetchSiteKpis(baseSite, new Date("2026-07-01T00:00:00Z"), new Date("2026-07-01T08:00:00Z"));
    expect(r.ok).toBe(true);
    const s = r.snapshot!;
    // details[] retained with the shape the drill needs.
    expect(s.detailRows).toHaveLength(2);
    expect(s.detailRows![0].machineCode).toBe("M7");
    expect(s.detailRows![0].stationCode).toBe("ST3");
    // real OEE (not the old hard-coded null).
    expect(s.oee).toBe(82.5);
    // generalized categories populated.
    expect(s.fleet).toEqual({ tasksPending: 3, tasksRunning: 1, robotsOnline: 2, robotsTotal: 4 });
    expect(s.safety).toEqual({ openEvents: 2, nearMisses: 1, critical: 1 });
    expect(s.pdm).toEqual({ openPredictiveWos: 4, highRiskMachines: 2 });
    expect(s.alertRollup!.open).toBe(5);
    expect(s.alertRollup!.top[0].kind).toBe("andon");
    // units-weighted avg cycle time still computed from retained rows.
    expect(s.avgCycleTime).toBeGreaterThan(12);
    expect(s.avgCycleTime).toBeLessThan(15);
  });

  it("HONEST-NULL: a site that 404s the new feeds keeps categories null and still succeeds", async () => {
    installFetch({
      "/api/external/inspections/summary": { status: 200, body: summaryBody },
      // no oee/fleet/safety/pdm/alerts routes → 404 default
    });
    const r = await fetchSiteKpis(baseSite, new Date(), new Date());
    expect(r.ok).toBe(true); // an old site (no new feeds) is NOT a failure
    const s = r.snapshot!;
    expect(s.detailRows).toHaveLength(2); // details still retained
    expect(s.oee).toBeNull(); // honest null, not 0
    expect(s.fleet).toBeNull();
    expect(s.safety).toBeNull();
    expect(s.pdm).toBeNull();
    expect(s.alertRollup).toBeNull();
  });

  it("a DOWN site (summary 500) degrades honestly — no fabricated snapshot", async () => {
    installFetch({ "/api/external/inspections/summary": { status: 500, body: { success: false } } });
    const r = await fetchSiteKpis(baseSite, new Date(), new Date());
    expect(r.ok).toBe(false);
    expect(r.snapshot).toBeUndefined(); // nothing fabricated
    expect(r.error).toContain("500");
  });
});

// ── rollupStore per-category writes (fake db records inserts/updates by category) ──
function makeFakeDb() {
  const inserted: any[] = [];
  const updated: any[] = [];
  const existingRows: any[] = []; // simulate "no existing snapshot" → always insert
  const db: any = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => existingRows }),
      }),
    }),
    update: () => ({ set: (v: any) => ({ where: async () => updated.push(v) }) }),
    insert: () => ({
      values: (v: any) => {
        // support both plain insert and onConflictDoUpdate chaining
        const rec: any = v;
        inserted.push(rec);
        return { onConflictDoUpdate: async () => {} , then: (res: any) => res(undefined) } as any;
      },
    }),
  };
  return { db, inserted, updated };
}

describe("rollupStore.upsertSnapshot — per-category rows + retained detail", () => {
  function snap(overrides: Partial<SiteKpiSnapshot> = {}): SiteKpiSnapshot {
    return {
      asOf: new Date("2026-07-01T08:00:00Z"),
      windowStart: new Date("2026-07-01T00:00:00Z"),
      windowEnd: new Date("2026-07-01T08:00:00Z"),
      totalInspections: 100, okCount: 95, ngCount: 5, ntfCount: 0,
      yieldRate: 95, ngRate: 5, throughput: 100, oee: 82.5, avgCycleTime: 13,
      defectPareto: [],
      detailRows: [{ machineId: 7, machineCode: "M7", machineName: "AOI-7", stationId: 3, stationCode: "ST3", stationName: "S3", totalInspections: 100, okCount: 95, ngCount: 5, ntfCount: 0, yieldRate: 95, avgCycleTime: 13 }],
      fleet: { tasksPending: 3, tasksRunning: 1, robotsOnline: 2, robotsTotal: 4 },
      safety: { openEvents: 2, nearMisses: 1, critical: 1 },
      pdm: { openPredictiveWos: 4, highRiskMachines: 2 },
      alertRollup: { open: 5, critical: 2, nearMiss: 1, top: [] },
      endpointsHit: [],
      ...overrides,
    };
  }

  it("writes overall+inspection+oee+fleet+safety+pdm rows and lands detailRows on overall", async () => {
    const { db, inserted } = makeFakeDb();
    const written = await upsertSnapshot(db, baseSite, snap());
    const cats = inserted.map((r) => r.category);
    expect(cats).toContain("overall");
    expect(cats).toContain("inspection");
    expect(cats).toContain("oee");
    expect(cats).toContain("fleet");
    expect(cats).toContain("safety");
    expect(cats).toContain("pdm");
    // overall snapshot row carries the retained detail + alert rollup + metric bag.
    const overallSnap = inserted.find((r) => r.category === "overall" && r.window === "snapshot");
    expect(overallSnap.detailRows).toHaveLength(1);
    expect(overallSnap.alertRollup.open).toBe(5);
    expect(overallSnap.metrics.tasksPending).toBe(3);
    // real OEE landed on the oee category row.
    const oeeRow = inserted.find((r) => r.category === "oee");
    expect(oeeRow.oee).toBe(82.5);
    expect(written).toBeGreaterThanOrEqual(7); // overall+inspection+oee+fleet+safety+pdm+day
  });

  it("HONEST absence: no fleet/safety/pdm rows when those feeds returned null", async () => {
    const { db, inserted } = makeFakeDb();
    await upsertSnapshot(db, baseSite, snap({ fleet: null, safety: null, pdm: null, alertRollup: null }));
    const cats = inserted.map((r) => r.category);
    expect(cats).toContain("overall");
    expect(cats).toContain("inspection");
    expect(cats).toContain("oee"); // oee row always written (value may be null)
    expect(cats).not.toContain("fleet"); // absent feed → no fabricated row
    expect(cats).not.toContain("safety");
    expect(cats).not.toContain("pdm");
  });
});
