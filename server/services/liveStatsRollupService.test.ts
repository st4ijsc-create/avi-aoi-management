/**
 * liveStatsRollupService — PURE unit tests for the ok/ng/ntf aggregation mapping
 * (doc 54 §11 P1.2). No DB: these assert the canonical bucket rules that the
 * GROUP BY CASE-sums in rollupDailyStatisticsNow mirror.
 *
 *   ntf  ⇐ overallResult='NTF'  OR  ntfConfirmedAt not null   (highest precedence)
 *   ng   ⇐ overallResult='NG'   AND ntfConfirmedAt null
 *   ok   ⇐ overallResult='OK'   AND ntfConfirmedAt null
 * Invariant: ok + ng + ntf === total (mutually exclusive).
 */
import { describe, it, expect } from "vitest";
import {
  classifyInspectionResult,
  aggregateInspectionResults,
  rollupIntervalMs,
  type InspectionResultRow,
} from "./liveStatsRollupService";

describe("classifyInspectionResult", () => {
  it("maps plain OK/NG/NTF enum values", () => {
    expect(classifyInspectionResult({ overallResult: "OK", ntfConfirmedAt: null })).toBe("ok");
    expect(classifyInspectionResult({ overallResult: "NG", ntfConfirmedAt: null })).toBe("ng");
    expect(classifyInspectionResult({ overallResult: "NTF", ntfConfirmedAt: null })).toBe("ntf");
  });

  it("treats a confirmed-NTF timestamp as NTF even when overallResult is still NG (precedence)", () => {
    // A row confirmed as false-call (ntfConfirmedAt set) counts as NTF, not NG —
    // so it is not double-counted and yieldRate credits it as a pass.
    expect(classifyInspectionResult({ overallResult: "NG", ntfConfirmedAt: new Date() })).toBe("ntf");
    expect(classifyInspectionResult({ overallResult: "OK", ntfConfirmedAt: "2026-07-17T00:00:00Z" })).toBe("ntf");
  });

  it("NTF enum with a timestamp still maps to ntf (idempotent)", () => {
    expect(classifyInspectionResult({ overallResult: "NTF", ntfConfirmedAt: new Date() })).toBe("ntf");
  });
});

describe("aggregateInspectionResults", () => {
  it("counts each bucket and keeps ok+ng+ntf === total", () => {
    const rows: InspectionResultRow[] = [
      { overallResult: "OK", ntfConfirmedAt: null },
      { overallResult: "OK", ntfConfirmedAt: null },
      { overallResult: "NG", ntfConfirmedAt: null },
      { overallResult: "NTF", ntfConfirmedAt: null },
      { overallResult: "NG", ntfConfirmedAt: new Date() }, // confirmed false-call → ntf
    ];
    const c = aggregateInspectionResults(rows);
    expect(c).toEqual({ total: 5, ok: 2, ng: 1, ntf: 2 });
    expect(c.ok + c.ng + c.ntf).toBe(c.total);
  });

  it("returns zeros for an empty set", () => {
    expect(aggregateInspectionResults([])).toEqual({ total: 0, ok: 0, ng: 0, ntf: 0 });
  });
});

describe("rollupIntervalMs", () => {
  const saved = process.env.LIVE_STATS_ROLLUP_MS;
  const restore = () => {
    if (saved === undefined) delete process.env.LIVE_STATS_ROLLUP_MS;
    else process.env.LIVE_STATS_ROLLUP_MS = saved;
  };

  it("defaults to 60s and enforces the 15s floor / NaN-safety", () => {
    delete process.env.LIVE_STATS_ROLLUP_MS;
    expect(rollupIntervalMs()).toBe(60_000);
    process.env.LIVE_STATS_ROLLUP_MS = "5000"; // below floor
    expect(rollupIntervalMs()).toBe(60_000);
    process.env.LIVE_STATS_ROLLUP_MS = "not-a-number";
    expect(rollupIntervalMs()).toBe(60_000);
    process.env.LIVE_STATS_ROLLUP_MS = "30000";
    expect(rollupIntervalMs()).toBe(30_000);
    restore();
  });
});
