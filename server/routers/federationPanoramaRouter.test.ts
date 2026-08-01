/**
 * U5 (doc 21 §6 / §3 G-7) — federationRouter drill/alert/category procedures.
 *
 *   • siteDetail assembles station → device tree from the RETAINED detailRows;
 *     a site with no detail yields hasDetail=false (honest, not fabricated).
 *   • alertRollup aggregates each site's landed alertRollup + reports the honest
 *     basis (sitesWithAlertFeed) — a site with no alert feed contributes nothing.
 *   • categoryRollup returns per-site category snapshots + honest metric totals
 *     (only sites that reported a metric contribute; hasData=false for absent).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Route DB reads by a __key tag stamped on the schema tables.
let sitesRows: any[] = [];
let rollupRows: any[] = [];
function terminal(rows: any[]): any {
  return {
    where: () => terminal(rows),
    orderBy: () => terminal(rows),
    limit: async () => rows,
    then: (res: (v: any[]) => void) => res(rows),
  };
}
function makeDb() {
  return {
    select: () => ({
      from: (t: any) => {
        const key = t?.__key ?? "";
        return terminal(key === "sites" ? sitesRows : key === "siteKpiRollup" ? rollupRows : []);
      },
    }),
  };
}
vi.mock("../db", () => ({ getDb: async () => makeDb(), createAuditLog: vi.fn(async () => {}) }));
vi.mock("../../drizzle/schema", async (orig) => {
  const mod: any = await (orig as any)();
  const tag = (o: any, k: string) => (o ? Object.assign(o, { __key: k }) : o);
  tag(mod.sites, "sites");
  tag(mod.siteKpiRollup, "siteKpiRollup");
  tag(mod.siteSyncLog, "siteSyncLog");
  return mod;
});

import { federationRouter } from "./federationRouter";
const caller = (federationRouter as any).createCaller({ user: { id: 1, role: "admin", name: "T" } });

const now = new Date();
function site(over: any = {}) {
  return { id: 1, code: "HCM01", name: "HCM", corporateCode: "ACME", region: "VN", isLocal: false, status: "active", pollIntervalSec: 60, lastSyncAt: now, lastError: null, consecutiveFailures: 0, ...over };
}
function overallSnap(over: any = {}) {
  return {
    id: 10, siteId: 1, category: "overall", window: "snapshot", bucketStart: null, asOf: now, fetchedAt: now,
    totalInspections: 100, okCount: 95, ngCount: 5, yieldRate: 95, ngRate: 5, throughput: 100, oee: 82.5, avgCycleTime: 13,
    defectPareto: [], detailRows: [], alertRollup: null, metrics: null, source: "poll", ...over,
  };
}

beforeEach(() => {
  sitesRows = [];
  rollupRows = [];
});

describe("federation.siteDetail — drill from retained detail", () => {
  it("assembles station → device tree from detailRows", async () => {
    sitesRows = [site()];
    rollupRows = [overallSnap({
      detailRows: [
        { machineId: 7, machineCode: "M7", machineName: "AOI-7", stationId: 3, stationCode: "ST3", stationName: "Station 3", totalInspections: 60, okCount: 58, ngCount: 2, yieldRate: 96.7, avgCycleTime: 12 },
        { machineId: 8, machineCode: "M8", machineName: "AOI-8", stationId: 3, stationCode: "ST3", stationName: "Station 3", totalInspections: 40, okCount: 37, ngCount: 3, yieldRate: 92.5, avgCycleTime: 15 },
        { machineId: 9, machineCode: "M9", machineName: "AVI-9", stationId: 4, stationCode: "ST4", stationName: "Station 4", totalInspections: 20, okCount: 20, ngCount: 0, yieldRate: 100, avgCycleTime: 9 },
      ],
    })];
    const r = await caller.siteDetail({ siteCode: "HCM01" });
    expect(r.hasDetail).toBe(true);
    expect(r.stations).toHaveLength(2); // ST3 (2 devices) + ST4 (1 device)
    const st3 = r.stations.find((s: any) => s.stationCode === "ST3");
    expect(st3.deviceCount).toBe(2);
    expect(st3.devices.map((d: any) => d.machineCode).sort()).toEqual(["M7", "M8"]);
  });

  it("HONEST: a REMOTE leaf site with no detailRows → hasDetail=false, empty tree", async () => {
    sitesRows = [site()];
    rollupRows = [overallSnap({ detailRows: null })];
    const r = await caller.siteDetail({ siteCode: "HCM01" });
    expect(r.hasDetail).toBe(false);
    expect(r.stations).toEqual([]);
  });
});

describe("federation.alertRollup — cross-site alert aggregation", () => {
  it("sums open/critical from sites with an alert feed and reports the honest basis", async () => {
    sitesRows = [site({ id: 1, code: "HCM01" }), site({ id: 2, code: "HN01" })];
    rollupRows = [
      overallSnap({ id: 10, siteId: 1, alertRollup: { open: 5, critical: 2, nearMiss: 1, top: [{ kind: "andon", severity: "critical", count: 2, title: "Line down" }] } }),
      overallSnap({ id: 11, siteId: 2, alertRollup: null }), // no alert feed → not counted
    ];
    const r = await caller.alertRollup();
    expect(r.sitesTotal).toBe(2);
    expect(r.sitesWithAlertFeed).toBe(1); // honest: only 1 site reported alerts
    expect(r.totals.open).toBe(5);
    expect(r.totals.critical).toBe(2);
    expect(r.top[0].kind).toBe("andon");
    expect(r.top[0].siteCode).toBe("HCM01");
  });
});

describe("federation.categoryRollup — per-category cross-site view", () => {
  it("returns per-site category snapshots + honest metric totals", async () => {
    sitesRows = [site({ id: 1, code: "HCM01" }), site({ id: 2, code: "HN01" })];
    // Only HCM01 reported the fleet category (HN01 absent → hasData=false).
    rollupRows = [
      { id: 20, siteId: 1, category: "fleet", window: "snapshot", bucketStart: null, asOf: now, fetchedAt: now, yieldRate: null, ngRate: null, throughput: null, oee: null, metrics: { tasksPending: 3, tasksRunning: 1, robotsOnline: 2 }, source: "poll" },
    ];
    const r = await caller.categoryRollup({ category: "fleet" });
    expect(r.category).toBe("fleet");
    expect(r.sitesTotal).toBe(2);
    expect(r.sitesReporting).toBe(1);
    const hcm = r.perSite.find((p: any) => p.siteCode === "HCM01");
    const hn = r.perSite.find((p: any) => p.siteCode === "HN01");
    expect(hcm.hasData).toBe(true);
    expect(hn.hasData).toBe(false); // honest absence
    expect(r.metricTotals.tasksPending).toBe(3);
    expect(r.metricReporting.tasksPending).toBe(1); // basis: 1 site contributed
  });
});
