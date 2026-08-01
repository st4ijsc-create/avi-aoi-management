/**
 * doc 44 W6-1 (G5.11) — ISA-18.2 alarm KPI math tests (pure).
 */
import { describe, it, expect } from "vitest";
import {
  normalizeAndonState,
  normalizePredictiveSeverity,
  priorityBucket,
  computeAlarmRate,
  computeFlood,
  computeStanding,
  computeBadActors,
  computePriorityDistribution,
  summarizeAlarmKpi,
  ISA_182,
  type AlarmEventLite,
  type AlarmPriority,
} from "./alarmKpiMath";

const HOUR = 3600_000;
const MIN = 60_000;

function ev(overrides: Partial<AlarmEventLite> & { raisedAt: number }): AlarmEventLite {
  return {
    id: overrides.id ?? `e${overrides.raisedAt}`,
    source: overrides.source ?? "andon",
    priority: overrides.priority ?? "low",
    raisedAt: overrides.raisedAt,
    acknowledgedAt: overrides.acknowledgedAt ?? null,
    resolvedAt: overrides.resolvedAt ?? null,
    actorKey: overrides.actorKey ?? "machine:1",
    actorLabel: overrides.actorLabel ?? "M1",
    title: overrides.title ?? "t",
  };
}

describe("priority normalization", () => {
  it("maps andon states", () => {
    expect(normalizeAndonState("red")).toBe("high");
    expect(normalizeAndonState("yellow")).toBe("medium");
    expect(normalizeAndonState("call")).toBe("critical");
    expect(normalizeAndonState("green")).toBe("low");
    expect(normalizeAndonState(undefined)).toBe("low");
  });
  it("maps predictive severity", () => {
    expect(normalizePredictiveSeverity("CRITICAL")).toBe("critical");
    expect(normalizePredictiveSeverity("high")).toBe("high");
    expect(normalizePredictiveSeverity("xyz")).toBe("low");
  });
  it("buckets high+critical together", () => {
    expect(priorityBucket("critical")).toBe("high");
    expect(priorityBucket("high")).toBe("high");
    expect(priorityBucket("medium")).toBe("medium");
    expect(priorityBucket("low")).toBe("low");
  });
});

describe("computeAlarmRate", () => {
  it("computes per-hour-per-operator + ISA status", () => {
    const now = Date.now();
    // 24 alarms over 8h, 2 operators → 24/8/2 = 1.5/hr/op → ok
    const events = Array.from({ length: 24 }, (_, i) => ev({ raisedAt: now - i * 10 * MIN }));
    const r = computeAlarmRate(events, 8 * HOUR, 2);
    expect(r.alarmsPerHour).toBe(3);
    expect(r.alarmsPerHourPerOperator).toBe(1.5);
    expect(r.status).toBe("ok");
  });
  it("flags warning above target and critical above max", () => {
    const now = Date.now();
    // 1 operator, 1h window. 8 alarms → 8/hr/op → warning (>6, ≤12)
    const warn = computeAlarmRate(Array.from({ length: 8 }, (_, i) => ev({ raisedAt: now - i })), HOUR, 1);
    expect(warn.status).toBe("warning");
    // 20 alarms → 20/hr/op → critical (>12)
    const crit = computeAlarmRate(Array.from({ length: 20 }, (_, i) => ev({ raisedAt: now - i })), HOUR, 1);
    expect(crit.status).toBe("critical");
  });
});

describe("computeFlood", () => {
  it("detects >10 alarms within a 10-minute window", () => {
    const t0 = 1_000_000_000_000;
    // 12 alarms in 5 minutes → flood (maxInWindow = 12 > 10)
    const burst = Array.from({ length: 12 }, (_, i) => ev({ raisedAt: t0 + i * 25_000 }));
    const f = computeFlood(burst);
    expect(f.maxInWindow).toBe(12);
    expect(f.isFlooding).toBe(true);
    expect(f.threshold).toBe(ISA_182.floodThreshold);
  });
  it("no flood when alarms are spread out", () => {
    const t0 = 1_000_000_000_000;
    // 6 alarms 30 min apart → never >10 in any 10-min window
    const spread = Array.from({ length: 6 }, (_, i) => ev({ raisedAt: t0 + i * 30 * MIN }));
    const f = computeFlood(spread);
    expect(f.maxInWindow).toBe(1);
    expect(f.isFlooding).toBe(false);
  });
  it("empty → no flood", () => {
    expect(computeFlood([]).isFlooding).toBe(false);
  });
});

describe("computeStanding", () => {
  it("counts unresolved alarms older than 24h", () => {
    const now = Date.now();
    const events = [
      ev({ raisedAt: now - 30 * HOUR }),                       // standing (30h, unresolved)
      ev({ raisedAt: now - 40 * HOUR }),                       // standing (40h)
      ev({ raisedAt: now - 30 * HOUR, resolvedAt: now - HOUR }), // resolved → not standing
      ev({ raisedAt: now - 2 * HOUR }),                        // too young
    ];
    const s = computeStanding(events, now);
    expect(s.count).toBe(2);
    expect(s.worst[0].ageHours).toBeGreaterThanOrEqual(s.worst[1].ageHours); // sorted desc
  });
  it("warns at/above the standing max", () => {
    const now = Date.now();
    const many = Array.from({ length: ISA_182.standingCountMax }, (_, i) => ev({ raisedAt: now - (30 + i) * HOUR }));
    expect(computeStanding(many, now).status).toBe("warning");
  });
});

describe("computeBadActors", () => {
  it("groups by actorKey and ranks desc with percent", () => {
    const now = Date.now();
    const events = [
      ...Array.from({ length: 5 }, () => ev({ raisedAt: now, actorKey: "machine:1", actorLabel: "M1" })),
      ...Array.from({ length: 3 }, () => ev({ raisedAt: now, actorKey: "machine:2", actorLabel: "M2" })),
      ...Array.from({ length: 2 }, () => ev({ raisedAt: now, actorKey: "machine:3", actorLabel: "M3" })),
    ];
    const top = computeBadActors(events, 2);
    expect(top).toHaveLength(2);
    expect(top[0].actorKey).toBe("machine:1");
    expect(top[0].count).toBe(5);
    expect(top[0].percent).toBe(50);
  });
});

describe("computePriorityDistribution", () => {
  it("computes counts, percent and high-over-target flag", () => {
    const now = Date.now();
    const prios: AlarmPriority[] = ["low", "low", "low", "low", "medium", "high", "high", "critical"];
    const events = prios.map((p) => ev({ raisedAt: now, priority: p }));
    const d = computePriorityDistribution(events);
    expect(d.counts.low).toBe(4);
    expect(d.counts.medium).toBe(1);
    expect(d.counts.high).toBe(3); // high + critical
    expect(d.total).toBe(8);
    expect(d.highOverTarget).toBe(true); // 37.5% >> 2×5%
  });
});

describe("summarizeAlarmKpi", () => {
  it("aggregates and reports breaches", () => {
    const now = Date.now();
    // burst of 12 high alarms within 5 min, 1 operator, 1h window
    const events = Array.from({ length: 12 }, (_, i) => ev({ raisedAt: now - i * 20_000, priority: "high" }));
    const s = summarizeAlarmKpi(events, { windowMs: HOUR, now, operatorCount: 1 });
    expect(s.totalAlarms).toBe(12);
    expect(s.breaches).toContain("flood");
    expect(s.breaches).toContain("rate"); // 12/hr/op = at max, but >target → warning; >max? equal → warning
    expect(s.breaches).toContain("distribution");
  });
  it("clean state → no breaches", () => {
    const now = Date.now();
    const events = Array.from({ length: 4 }, (_, i) => ev({ raisedAt: now - i * HOUR, priority: "low" }));
    const s = summarizeAlarmKpi(events, { windowMs: 8 * HOUR, now, operatorCount: 3 });
    expect(s.breaches).toHaveLength(0);
  });
});
