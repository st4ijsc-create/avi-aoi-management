/**
 * doc 44 W6-4 (G5.20) — DORA metrics (pure math).
 */
import { describe, it, expect } from "vitest";
import { computeDoraMetrics, type DeploymentEvent } from "./dora";

const NOW = Date.parse("2026-07-12T00:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const daysAgo = (d: number) => new Date(NOW - d * DAY);

describe("G5.20 — computeDoraMetrics", () => {
  it("degrades to no_data on an empty log (never invents numbers)", () => {
    const m = computeDoraMetrics([], { now: NOW, windowDays: 30 });
    expect(m.totalDeployments).toBe(0);
    expect(m.deploymentFrequency.rating).toBe("no_data");
    expect(m.leadTimeForChanges.medianMs).toBeNull();
    expect(m.leadTimeForChanges.rating).toBe("no_data");
    expect(m.changeFailureRate.rate).toBeNull();
    expect(m.changeFailureRate.rating).toBe("no_data");
    expect(m.meanTimeToRestore.medianMs).toBeNull();
    expect(m.meanTimeToRestore.rating).toBe("no_data");
  });

  it("computes frequency, lead time (median), change-failure rate and MTTR", () => {
    const events: DeploymentEvent[] = [
      // Outside the 30-day window → excluded.
      { environment: "production", status: "success", deployedAt: daysAgo(40), leadTimeMs: 9 * HOUR },
      // In window:
      { environment: "production", status: "success", deployedAt: daysAgo(20), leadTimeMs: 1 * HOUR },
      { environment: "production", status: "failed", deployedAt: daysAgo(15) },
      { environment: "production", status: "success", deployedAt: new Date(daysAgo(15).getTime() + 2 * HOUR), leadTimeMs: 3 * HOUR },
      { environment: "production", status: "success", deployedAt: daysAgo(5), leadTimeMs: 5 * HOUR },
    ];
    const m = computeDoraMetrics(events, { now: NOW, windowDays: 30 });

    expect(m.totalDeployments).toBe(4); // 40-days-ago excluded
    expect(m.successfulDeployments).toBe(3);
    expect(m.failedDeployments).toBe(1);

    // Frequency: 3 successes / 30 days = 0.1/day → medium band (≥ 1/month, < 1/week)
    expect(m.deploymentFrequency.perDay).toBeCloseTo(0.1, 6);
    expect(m.deploymentFrequency.rating).toBe("medium");

    // Lead time: median of [1h, 3h, 5h] = 3h → elite (< 1 day)
    expect(m.leadTimeForChanges.medianMs).toBe(3 * HOUR);
    expect(m.leadTimeForChanges.sampleSize).toBe(3);
    expect(m.leadTimeForChanges.rating).toBe("elite");

    // Change-failure rate: 1 failure / 4 deploys = 0.25 → medium (≤ 0.30)
    expect(m.changeFailureRate.rate).toBeCloseTo(0.25, 6);
    expect(m.changeFailureRate.rating).toBe("medium");

    // MTTR: failure → next success in same env = 2h → high (< 1 day, ≥ 1 hour)
    expect(m.meanTimeToRestore.medianMs).toBe(2 * HOUR);
    expect(m.meanTimeToRestore.sampleSize).toBe(1);
    expect(m.meanTimeToRestore.rating).toBe("high");
  });

  it("rates elite frequency + elite MTTR at the fast end", () => {
    const events: DeploymentEvent[] = [];
    for (let i = 0; i < 60; i++) {
      events.push({ environment: "production", status: "success", deployedAt: new Date(NOW - i * (DAY / 2)), leadTimeMs: 10 * 60_000 });
    }
    // a failure recovered within 30 minutes
    events.push({ environment: "production", status: "failed", deployedAt: new Date(NOW - 3 * DAY) });
    events.push({ environment: "production", status: "success", deployedAt: new Date(NOW - 3 * DAY + 30 * 60_000), leadTimeMs: 10 * 60_000 });

    const m = computeDoraMetrics(events, { now: NOW, windowDays: 30 });
    expect(m.deploymentFrequency.rating).toBe("elite"); // ≥ 1/day
    expect(m.meanTimeToRestore.rating).toBe("elite"); // < 1 hour
    expect(m.leadTimeForChanges.rating).toBe("elite");
  });
});
