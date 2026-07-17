/**
 * doc 54 P2.5 — unit tests for the PURE production-analytics helpers in oeeService:
 * downtime Pareto, MTBF/MTTR reliability, and line-balance. These exercise the math
 * only (no DB), matching the existing oeeService.test.ts style.
 */
import { describe, it, expect } from "vitest";
import {
  computeParetoRows,
  computeReliability,
  computeLineBalance,
  DEFAULT_FAILURE_CATEGORIES,
} from "./oeeService";

describe("computeParetoRows", () => {
  it("sorts by downtime desc and accumulates to 100%", () => {
    const { rows, totalEvents, totalDowntimeMinutes } = computeParetoRows([
      { key: "A", eventCount: 2, downtimeMinutes: 30 },
      { key: "B", eventCount: 1, downtimeMinutes: 70 },
    ]);
    expect(rows.map((r) => r.key)).toEqual(["B", "A"]);
    expect(rows[0].pct).toBe(70);
    expect(rows[1].pct).toBe(30);
    expect(rows[1].cumulativePct).toBe(100);
    expect(totalEvents).toBe(3);
    expect(totalDowntimeMinutes).toBe(100);
  });

  it("folds groups beyond the limit into a single 'Other' bucket (denominator preserved)", () => {
    const { rows, totalDowntimeMinutes } = computeParetoRows([
      { key: "X", eventCount: 1, downtimeMinutes: 50 },
      { key: "Y", eventCount: 1, downtimeMinutes: 30 },
      { key: "Z", eventCount: 1, downtimeMinutes: 20 },
    ], 2);
    expect(rows.map((r) => r.key)).toEqual(["X", "Y", "Other"]);
    const other = rows.find((r) => r.key === "Other")!;
    expect(other.downtimeMinutes).toBe(20);
    expect(other.eventCount).toBe(1);
    // percentages still sum over the FULL population (100 minutes), not the kept head.
    expect(totalDowntimeMinutes).toBe(100);
    expect(rows[rows.length - 1].cumulativePct).toBe(100);
  });

  it("is honest on empty input", () => {
    const { rows, totalEvents, totalDowntimeMinutes } = computeParetoRows([]);
    expect(rows).toEqual([]);
    expect(totalEvents).toBe(0);
    expect(totalDowntimeMinutes).toBe(0);
  });
});

describe("computeReliability (MTBF / MTTR)", () => {
  const from = new Date("2026-01-01T00:00:00Z");
  const to = new Date("2026-01-01T10:00:00Z"); // 600-minute window

  it("MTBF = uptime/failures, MTTR = repair/failures for breakdown events", () => {
    const r = computeReliability(
      [
        { machineId: 1, category: "breakdown", startTime: new Date("2026-01-01T01:00:00Z"), endTime: new Date("2026-01-01T01:30:00Z") },
        { machineId: 1, category: "breakdown", startTime: new Date("2026-01-01T05:00:00Z"), endTime: new Date("2026-01-01T05:30:00Z") },
      ],
      from, to,
    );
    expect(r.failureCount).toBe(2);
    // uptime = 600 - 60 = 540 min → MTBF = 540/2 = 270 min = 4.5 h
    expect(r.mtbfHours).toBe(4.5);
    // repair = 60 min → MTTR = 60/2 = 30 min = 0.5 h
    expect(r.mttrHours).toBe(0.5);
    expect(r.perMachine[0].totalDowntimeMinutes).toBe(60);
  });

  it("planned downtime nets out of uptime but is NOT counted as a failure", () => {
    const r = computeReliability(
      [
        { machineId: 1, category: "breakdown", startTime: new Date("2026-01-01T01:00:00Z"), endTime: new Date("2026-01-01T01:30:00Z") },
        { machineId: 1, category: "breakdown", startTime: new Date("2026-01-01T05:00:00Z"), endTime: new Date("2026-01-01T05:30:00Z") },
        { machineId: 1, category: "planned", startTime: new Date("2026-01-01T08:00:00Z"), endTime: new Date("2026-01-01T08:30:00Z") },
      ],
      from, to,
    );
    expect(r.failureCount).toBe(2);
    // uptime = 600 - 90 = 510 min → MTBF = 510/2 = 255 min = 4.25 h
    expect(r.mtbfHours).toBe(4.25);
    // repair time only over failures = 60 min → MTTR = 0.5 h
    expect(r.mttrHours).toBe(0.5);
  });

  it("returns null MTBF/MTTR for a machine with no failures (honest N/A)", () => {
    const r = computeReliability(
      [{ machineId: 7, category: "planned", startTime: new Date("2026-01-01T02:00:00Z"), endTime: new Date("2026-01-01T02:30:00Z") }],
      from, to,
    );
    expect(r.failureCount).toBe(0);
    expect(r.mtbfHours).toBeNull();
    expect(r.mttrHours).toBeNull();
    expect(r.perMachine[0].mtbfHours).toBeNull();
  });

  it("clips open events (endTime null) to the window end", () => {
    const r = computeReliability(
      [{ machineId: 3, category: "unplanned", startTime: new Date("2026-01-01T09:30:00Z"), endTime: null }],
      from, to,
    );
    // open event runs 09:30 → 10:00 = 30 min
    expect(r.perMachine[0].failureDowntimeMinutes).toBe(30);
    expect(DEFAULT_FAILURE_CATEGORIES).toContain("unplanned");
  });
});

describe("computeLineBalance", () => {
  it("balance rate = mean/max cycle; bottleneck = slowest station", () => {
    const r = computeLineBalance([
      { stationId: 1, cycleTimeSec: 10 },
      { stationId: 2, cycleTimeSec: 20 },
      { stationId: 3, cycleTimeSec: null },
      { stationId: 4, cycleTimeSec: 30 },
    ]);
    // mean(10,20,30)=20, max=30 → 66.67%
    expect(r.balanceRatePct).toBe(66.67);
    expect(r.bottleneckStationId).toBe(4);
  });

  it("is null when no station has a cycle time", () => {
    const r = computeLineBalance([{ stationId: 1, cycleTimeSec: null }]);
    expect(r.balanceRatePct).toBeNull();
    expect(r.bottleneckStationId).toBeNull();
  });
});
