/**
 * doc 44 W2-A1 / G2.3 — unsAggregates tests (_line/_area/_site nodes).
 *
 *  - flag OFF (default) → startUnsAggregates is a no-op (no timer)
 *  - runUnsAggregatesOnce publishes RETAINED _line/state per line using the
 *    CANONICAL oeeService.getLineOEE numbers (never re-derived), then rolls up
 *    _area (workshop) and _site (factory) with honest-partial performance/OEE
 *  - one line failing does NOT block the other lines/rollups
 *  - line without a hierarchy row → skipped with warn
 *  - empty data / no DB → no throw, zero publishes
 *
 * oeeService / DB / unsPublisher are mocked — no broker, no DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  execute: vi.fn(),
  dbAvailable: true,
  getLineOEE: vi.fn(),
  publishUnsV2: vi.fn((..._args: any[]) => true),
}));

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => (h.dbAvailable ? { execute: h.execute } : null)),
}));
vi.mock("../oeeService", () => ({ getLineOEE: h.getLineOEE }));
vi.mock("../unsPublisher", () => ({ publishUnsV2: h.publishUnsV2 }));

import {
  runUnsAggregatesOnce,
  startUnsAggregates,
  stopUnsAggregates,
  getUnsAggregatesStatus,
  isUnsAggregatesEnabled,
} from "./unsAggregates";

// Two lines in two different workshops/factories.
const HIER_ROWS = [
  { line_id: 1, line_code: "Line 1", workshop_id: 10, workshop_code: "Xưởng A", factory_id: 100, factory_code: "HANOI" },
  { line_id: 2, line_code: "Line 2", workshop_id: 20, workshop_code: "Xưởng B", factory_id: 200, factory_code: "DANANG" },
];

function lineMetric(over: Partial<any> = {}, details: Partial<any> = {}) {
  return {
    lineId: 1,
    lineName: "Line 1",
    availability: 90,
    performance: 80,
    quality: 95,
    oee: 68.4,
    details: {
      from: new Date("2026-07-12T00:00:00Z"),
      to: new Date("2026-07-12T01:00:00Z"),
      machineCount: 3,
      onlineSeconds: 3000,
      offlineSeconds: 600,
      totalCount: 120,
      goodCount: 114,
      rejectCount: 6,
      hasUptimeData: true,
      hasProductionData: true,
      hasIdeal: true,
      ...details,
    },
    ...over,
  };
}

beforeEach(() => {
  stopUnsAggregates();
  delete process.env.UNS_AGGREGATES_ENABLED;
  delete process.env.UNS_AGGREGATES_INTERVAL_MS;
  delete process.env.UNS_AGGREGATES_WINDOW_MS;
  h.execute.mockReset().mockResolvedValue({ rows: HIER_ROWS });
  h.dbAvailable = true;
  h.getLineOEE.mockReset();
  h.publishUnsV2.mockReset().mockReturnValue(true);
});

describe("flag gate", () => {
  it("default OFF → startUnsAggregates is a no-op (no timer)", () => {
    expect(isUnsAggregatesEnabled()).toBe(false);
    startUnsAggregates();
    expect(getUnsAggregatesStatus().running).toBe(false);
  });

  it("flag ON → timer registered, stop clears it", () => {
    process.env.UNS_AGGREGATES_ENABLED = "true";
    startUnsAggregates();
    expect(getUnsAggregatesStatus().running).toBe(true);
    stopUnsAggregates();
    expect(getUnsAggregatesStatus().running).toBe(false);
  });
});

describe("runUnsAggregatesOnce — _line/_area/_site publish", () => {
  it("publishes retained _line/state per line + _area/_site rollups (slugged real hierarchy)", async () => {
    h.getLineOEE.mockResolvedValue([
      lineMetric(),
      lineMetric({ lineId: 2, lineName: "Line 2", oee: null, performance: null }, {
        machineCount: 2,
        onlineSeconds: 1000,
        offlineSeconds: 0,
        totalCount: 50,
        goodCount: 50,
        rejectCount: 0,
        hasIdeal: false,
      }),
    ]);

    const stats = await runUnsAggregatesOnce(new Date("2026-07-12T01:00:00Z"));
    expect(stats.lines).toBe(2);
    expect(stats.areas).toBe(2);
    expect(stats.sites).toBe(2);
    expect(stats.published).toBe(6);
    expect(stats.errors).toBe(0);

    const topics = h.publishUnsV2.mock.calls.map((c: any[]) => c[0]);
    expect(topics).toContain("syn/hanoi/xuong-a/line-1/_line/state");
    expect(topics).toContain("syn/danang/xuong-b/line-2/_line/state");
    expect(topics).toContain("syn/hanoi/xuong-a/_area/state");
    expect(topics).toContain("syn/danang/xuong-b/_area/state");
    expect(topics).toContain("syn/hanoi/_site/state");
    expect(topics).toContain("syn/danang/_site/state");
    // every aggregate node publishes on the retained `state` aspect
    for (const call of h.publishUnsV2.mock.calls) expect(call[2]).toBe("state");
  });

  it("_line payload: canonical StateSnapshot shape + oeeService numbers (not re-derived)", async () => {
    h.getLineOEE.mockResolvedValue([lineMetric()]);
    await runUnsAggregatesOnce(new Date("2026-07-12T01:00:00Z"));

    const call = h.publishUnsV2.mock.calls.find((c: any[]) => String(c[0]).includes("/_line/"));
    expect(call).toBeTruthy();
    const p = call![1];
    // canonical state schema required fields
    expect(p.path).toBe("hanoi/xuong-a/line-1/_line");
    expect(typeof p.ts).toBe("string");
    expect(p.state).toBe("EXECUTE"); // produced in window
    // semantic-layer numbers passed through, never recomputed
    expect(p.values.oee_pct).toBe(68.4);
    expect(p.values.availability_pct).toBe(90);
    expect(p.values.performance_pct).toBe(80);
    expect(p.values.quality_pct).toBe(95);
    expect(p.values.throughput_units).toBe(120);
    expect(p.values.throughput_per_hour).toBe(120); // 120 units / 1h window
    expect(p.values.ng_rate_pct).toBe(5); // 6/120
    expect(p.metric_source).toBe("oeeService.getLineOEE");
    expect(p.partial).toBe(false);
  });

  it("_area/_site rollups: availability/quality via canonical accumulation, perf/OEE honest-null partial", async () => {
    h.getLineOEE.mockResolvedValue([lineMetric()]);
    await runUnsAggregatesOnce(new Date("2026-07-12T01:00:00Z"));

    const area = h.publishUnsV2.mock.calls.find((c: any[]) => String(c[0]).includes("/_area/"))![1];
    expect(area.path).toBe("hanoi/xuong-a/_area");
    expect(area.values.availability_pct).toBeCloseTo((3000 / 3600) * 100, 1);
    expect(area.values.quality_pct).toBeCloseTo(95, 1);
    expect(area.values.performance_pct).toBeNull();
    expect(area.values.oee_pct).toBeNull();
    expect(area.partial).toBe(true);
    expect(String(area.partial_reason)).toMatch(/not derivable/);

    const site = h.publishUnsV2.mock.calls.find((c: any[]) => String(c[0]).includes("/_site/"))![1];
    expect(site.path).toBe("hanoi/_site");
    expect(site.values.line_count).toBe(1);
    expect(site.values.machine_count).toBe(3);
  });

  it("line with NO production → state IDLE, ng_rate null (honest)", async () => {
    h.getLineOEE.mockResolvedValue([
      lineMetric({ oee: null, availability: null, performance: null, quality: null }, {
        totalCount: 0,
        goodCount: 0,
        rejectCount: 0,
        onlineSeconds: 0,
        offlineSeconds: 0,
        hasUptimeData: false,
        hasProductionData: false,
        hasIdeal: false,
      }),
    ]);
    await runUnsAggregatesOnce();
    const p = h.publishUnsV2.mock.calls.find((c: any[]) => String(c[0]).includes("/_line/"))![1];
    expect(p.state).toBe("IDLE");
    expect(p.values.ng_rate_pct).toBeNull();
    expect(p.values.oee_pct).toBeNull();
    expect(p.partial).toBe(true);
  });

  it("one line failing does NOT block the other (error isolated + counted)", async () => {
    h.getLineOEE.mockResolvedValue([lineMetric(), lineMetric({ lineId: 2, lineName: "Line 2" })]);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    h.publishUnsV2.mockImplementation((topic: string) => {
      if (String(topic).includes("line-1/_line")) throw new Error("boom");
      return true;
    });
    const stats = await runUnsAggregatesOnce();
    expect(stats.errors).toBe(1);
    const topics = h.publishUnsV2.mock.calls.map((c: any[]) => c[0]);
    expect(topics).toContain("syn/danang/xuong-b/line-2/_line/state"); // line 2 still published
    // the failed line never fed the rollups, but line 2's area/site still did
    expect(topics).toContain("syn/danang/xuong-b/_area/state");
    err.mockRestore();
  });

  it("line without hierarchy row → skipped with warn, others continue", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.getLineOEE.mockResolvedValue([lineMetric({ lineId: 999, lineName: "Ghost" }), lineMetric()]);
    const stats = await runUnsAggregatesOnce();
    expect(stats.skipped).toBeGreaterThanOrEqual(1);
    expect(warn).toHaveBeenCalled();
    const topics = h.publishUnsV2.mock.calls.map((c: any[]) => c[0]);
    expect(topics).toContain("syn/hanoi/xuong-a/line-1/_line/state");
    warn.mockRestore();
  });

  it("no lines / no DB → zero publishes, never throws", async () => {
    h.getLineOEE.mockResolvedValue([]);
    let stats = await runUnsAggregatesOnce();
    expect(stats.published).toBe(0);
    expect(h.publishUnsV2).not.toHaveBeenCalled();

    h.dbAvailable = false;
    stats = await runUnsAggregatesOnce();
    expect(stats.published).toBe(0);
  });

  it("publisher not connected (publishUnsV2 → false) → counted skipped, no throw", async () => {
    h.getLineOEE.mockResolvedValue([lineMetric()]);
    h.publishUnsV2.mockReturnValue(false);
    const stats = await runUnsAggregatesOnce();
    expect(stats.published).toBe(0);
    expect(stats.skipped).toBe(3); // line + area + site
  });
});
