/**
 * Observability tests — SYNAPSE §5.12 (doc 33 F6 · H2).
 * SLO error-budget + burn-rate · decision-trace · correlation backbone.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { sloStatus, burnRate, DEFAULT_SLOS, type SloTarget } from "./slo";
import {
  recordDecision,
  queryDecisions,
  explainDecision,
  _clearDecisionTraces,
} from "./decisionTrace";
import { withCorrelation, getCorrelationId, newCorrelationId, setAttribute, getCorrelationContext } from "./correlation";

const avail: SloTarget = {
  id: "t",
  name: "test",
  kind: "availability",
  objective: 0.99,
  windowSec: 3600,
};

describe("SLO error-budget", () => {
  it("no events → full budget, healthy", () => {
    const s = sloStatus(avail, { good: 0, total: 0 });
    expect(s.sli).toBe(1);
    expect(s.budgetRemaining).toBe(1);
    expect(s.healthy).toBe(true);
  });
  it("half the error budget consumed", () => {
    // objective 0.99 → error budget 0.01. Observe 0.5% error → consumes 50% budget.
    const s = sloStatus(avail, { good: 995, total: 1000 });
    expect(s.sli).toBeCloseTo(0.995, 3);
    expect(s.budgetConsumed).toBeCloseTo(0.5, 2);
    expect(s.healthy).toBe(true);
  });
  it("budget exhausted → unhealthy", () => {
    const s = sloStatus(avail, { good: 970, total: 1000 }); // 3% error >> 1% budget
    expect(s.budgetConsumed).toBeGreaterThan(1);
    expect(s.healthy).toBe(false);
  });
  it("catalogue has the SDD targets", () => {
    expect(DEFAULT_SLOS.map((s) => s.id)).toContain("dispatch-latency-p95");
    expect(DEFAULT_SLOS.map((s) => s.id)).toContain("control-api-availability");
  });
});

describe("burn-rate multi-window", () => {
  it("fast burn on both windows → critical", () => {
    const bad = { good: 800, total: 1000 }; // 20% error vs 1% budget = 20x burn
    const b = burnRate(avail, bad, bad);
    expect(b.severity).toBe("critical");
    expect(b.shortBurn).toBeGreaterThan(14);
  });
  it("healthy → ok", () => {
    const good = { good: 1000, total: 1000 };
    expect(burnRate(avail, good, good).severity).toBe("ok");
  });
});

describe("decision-trace", () => {
  beforeEach(() => _clearDecisionTraces());
  it("records + queries most-recent-first with filters", () => {
    recordDecision({
      decisionType: "task-allocation",
      subject: "task-1",
      chosen: "robot-A",
      candidates: [
        { id: "robot-A", score: 0.9, factors: { distance: 0.4, battery: 0.5 } },
        { id: "robot-B", score: 0.3, eliminatedBy: "battery<20%" },
      ],
      version: "heuristic-v1",
      ts: 1000,
    });
    recordDecision({ decisionType: "dispatch", subject: "task-2", chosen: null, candidates: [], version: "v1", ts: 1001 });
    const all = queryDecisions();
    expect(all[0].subject).toBe("task-2"); // most recent first
    expect(queryDecisions({ decisionType: "task-allocation" })).toHaveLength(1);
    expect(queryDecisions({ subject: "task-1" })[0].chosen).toBe("robot-A");
  });
  it("explainDecision is human-readable", () => {
    const t = recordDecision({
      decisionType: "task-allocation",
      subject: "task-9",
      chosen: "robot-A",
      candidates: [
        { id: "robot-A", score: 0.9 },
        { id: "robot-B", score: 0.3, eliminatedBy: "skill" },
      ],
      version: "v1",
      ts: 1,
    });
    const s = explainDecision(t);
    expect(s).toContain("chose robot-A");
    expect(s).toContain("1 eliminated");
  });
});

describe("correlation backbone", () => {
  it("propagates an id across nested async scopes", async () => {
    const id = newCorrelationId();
    await withCorrelation({ correlationId: id }, async () => {
      expect(getCorrelationId()).toBe(id);
      await withCorrelation({ attributes: { step: "child" } }, async () => {
        expect(getCorrelationId()).toBe(id); // inherited
        setAttribute("k", 1);
        expect(getCorrelationContext()?.attributes.k).toBe(1);
      });
    });
    expect(getCorrelationId()).toBeUndefined(); // outside any context
  });
  it("a recorded decision auto-attaches the current correlation id", () => {
    _clearDecisionTraces();
    const id = newCorrelationId();
    withCorrelation({ correlationId: id }, () => {
      recordDecision({ decisionType: "d", subject: "s", chosen: null, candidates: [], version: "v", ts: 1 });
    });
    expect(queryDecisions()[0].correlationId).toBe(id);
  });
});
