/**
 * H6 tests — SYNAPSE §5.7.3/§5.3.4 (doc 33 H6).
 * Twin drift · Monte-Carlo replication + CI · RL dispatch advisor + circuit breaker.
 */
import { describe, it, expect } from "vitest";

import { detectDrift } from "./driftDetector";
import { monteCarlo, mulberry32 } from "../simulation/monteCarlo";
import {
  newRlAdvisorState,
  adviseDispatch,
  recordKpi,
  resetBreaker,
} from "../ai/rlDispatchAdvisor";

describe("twin drift detector", () => {
  it("flags a metric drifting beyond the threshold", () => {
    const r = detectDrift(
      [
        { metric: "cycleTime", simulated: 11.5, actual: 10 }, // +15% > 10%
        { metric: "throughput", simulated: 98, actual: 100 }, // -2% < 10%
      ],
      0.1,
    );
    expect(r.ok).toBe(false);
    expect(r.drifted).toEqual(["cycleTime"]);
  });
  it("actual=0 with simulated=0 → no drift", () => {
    expect(detectDrift([{ metric: "x", simulated: 0, actual: 0 }]).ok).toBe(true);
  });
});

describe("monteCarlo", () => {
  it("constant sample → zero std + zero-width CI", () => {
    const r = monteCarlo(() => 5, 50);
    expect(r.mean).toBe(5);
    expect(r.std).toBe(0);
    expect(r.ci95.halfWidth).toBe(0);
  });
  it("variable sample → CI brackets the mean, deterministic by seed", () => {
    const r1 = monteCarlo((rng) => 100 + rng() * 20, 40, 999);
    const r2 = monteCarlo((rng) => 100 + rng() * 20, 40, 999);
    expect(r1.mean).toBe(r2.mean); // reproducible
    expect(r1.ci95.low).toBeLessThan(r1.mean);
    expect(r1.ci95.high).toBeGreaterThan(r1.mean);
    expect(r1.n).toBe(40);
    expect(r1.p95).toBeGreaterThanOrEqual(r1.p5);
  });
  it("mulberry32 is deterministic", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect(a()).toBe(b());
  });
});

describe("RL dispatch advisor", () => {
  const cand = ["robotA", "robotB", "robotC"];

  it("shadow/suggest emit heuristic but surface the RL suggestion", () => {
    const shadow = adviseDispatch(newRlAdvisorState("shadow"), { heuristicChoice: "robotA", rlChoice: "robotB", candidateSet: cand });
    expect(shadow.emittedChoice).toBe("robotA");
    expect(shadow.source).toBe("heuristic");
    expect(shadow.suggestion).toBe("robotB");
  });
  it("auto emits the RL choice when in-bounds; falls back when out of bounds", () => {
    const inb = adviseDispatch(newRlAdvisorState("auto"), { heuristicChoice: "robotA", rlChoice: "robotB", candidateSet: cand });
    expect(inb.emittedChoice).toBe("robotB");
    expect(inb.source).toBe("rl");
    const oob = adviseDispatch(newRlAdvisorState("auto"), { heuristicChoice: "robotA", rlChoice: "robotZ", candidateSet: cand });
    expect(oob.emittedChoice).toBe("robotA"); // safety fallback
    expect(oob.inBounds).toBe(false);
  });
  it("circuit breaker trips after 2 consecutive worse cycles → forces heuristic", () => {
    const s = newRlAdvisorState("auto");
    expect(recordKpi(s, 12, 10).tripped).toBe(false); // worse #1 (higher = worse)
    expect(recordKpi(s, 13, 10).tripped).toBe(true); // worse #2 → trip
    const a = adviseDispatch(s, { heuristicChoice: "robotA", rlChoice: "robotB", candidateSet: cand });
    expect(a.source).toBe("heuristic");
    expect(a.note).toMatch(/breaker open/);
  });
  it("a better cycle resets the worse-streak; resetBreaker clears the trip", () => {
    const s = newRlAdvisorState("auto");
    recordKpi(s, 12, 10); // worse #1
    recordKpi(s, 8, 10); // better → reset
    expect(s.consecutiveWorse).toBe(0);
    s.tripped = true;
    resetBreaker(s);
    expect(s.tripped).toBe(false);
  });
});
