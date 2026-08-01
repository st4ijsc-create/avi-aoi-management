/**
 * doc 24 Wave-4 · T5 — DES engine + model unit tests (vitest, deterministic seed).
 *
 * Covers the required cases:
 *   (a) a 3-station serial line with known deterministic rates reproduces the ANALYTIC
 *       flow-shop makespan (Σtᵢ + (N−1)·max tᵢ), the bottleneck, and the throughput.
 *   (b) adding capacity at the bottleneck RAISES throughput.
 *   (c) stochastic yield REDUCES good output as expected (≈ N·Πyieldᵢ).
 *   (d) DETERMINISTIC under a fixed seed (repeatable) — and a different seed differs.
 *   (e) empty / degenerate topology DEGRADES safely (no throw).
 *   + buffers/blocking bound WIP; model builders (scene + routing); scheduling advisory.
 */
import { describe, it, expect } from "vitest";
import {
  runDes,
  makeRng,
  type LineModel,
  type StationSpec,
} from "./desEngine";
import {
  buildLineModelFromScene,
  buildLineModelFromRouting,
  applyScenario,
  runScenarioComparison,
  buildThroughputAdvisory,
  reconcileCapacityAdvisory,
} from "./desModel";
import type { LineNode } from "../twin/sceneGraph";
import type { WorkflowDefinition } from "../orchestration/foe/workflowModel";

/** Build a serial deterministic line: `times` seconds, single/parallel `caps`. */
function serialLine(times: number[], caps: number[], count: number): LineModel {
  const stations: StationSpec[] = times.map((t, i) => ({
    id: `s${i}`,
    name: `Station ${i}`,
    capacity: caps[i] ?? 1,
    processTimeSec: t,
    processDist: "deterministic",
    yield: 1,
  }));
  return { id: "line.test", name: "Test line", stations, source: { kind: "batch", count } };
}

describe("DES engine — (a) analytic flow-shop makespan + bottleneck + throughput", () => {
  it("reproduces makespan = Σtᵢ + (N−1)·max(tᵢ) for a deterministic serial line", () => {
    const times = [5, 10, 5];
    const N = 50;
    const res = runDes(serialLine(times, [1, 1, 1], N), { seed: 1 });

    const sum = times.reduce((a, b) => a + b, 0);
    const bottleneck = Math.max(...times);
    const expectedMakespan = sum + (N - 1) * bottleneck; // 20 + 49*10 = 510

    expect(res.ok).toBe(true);
    expect(res.degraded).toBe(false);
    expect(res.goodCompleted).toBe(N);
    expect(res.scrapped).toBe(0);
    // Exact analytic makespan (deterministic).
    expect(res.makespanSec).toBeCloseTo(expectedMakespan, 6);
    // Bottleneck is the slowest station (index 1).
    expect(res.bottleneckStationId).toBe("s1");
    expect(res.bottleneckEffServiceSec).toBeCloseTo(10, 6);
    // Throughput = N / makespan, approaching the bottleneck rate (1/10 s → 360/h).
    expect(res.throughputPerHour).toBeCloseTo((N / expectedMakespan) * 3600, 4);
    expect(res.throughputPerHour).toBeGreaterThan(340);
    expect(res.throughputPerHour).toBeLessThan(360);
    // Utilization: the bottleneck is the busiest station.
    const util = Object.fromEntries(res.stations.map((s) => [s.id, s.utilization]));
    expect(util.s1).toBeGreaterThan(util.s0);
    expect(util.s1).toBeGreaterThan(util.s2);
    expect(util.s1).toBeCloseTo((N * 10) / expectedMakespan, 6);
    // A queue builds up in front of the bottleneck.
    const s1 = res.stations.find((s) => s.id === "s1")!;
    expect(s1.maxQueueLen).toBeGreaterThan(1);
  });

  it("throughput approaches the bottleneck rate as N grows", () => {
    const res = runDes(serialLine([5, 10, 5], [1, 1, 1], 500), { seed: 7 });
    // 1/10 s → 360/h asymptote.
    expect(res.throughputPerHour).toBeGreaterThan(355);
    expect(res.throughputPerHour).toBeLessThanOrEqual(360.001);
  });
});

describe("DES engine — (b) adding capacity at the bottleneck raises throughput", () => {
  it("doubling the bottleneck's servers roughly doubles throughput", () => {
    const model = serialLine([5, 10, 5], [1, 1, 1], 300);
    const cmp = runScenarioComparison(model, [{ op: "setCapacity", stationId: "s1", capacity: 2 }], { seed: 3 });

    expect(cmp.base.bottleneckStationId).toBe("s1");
    expect(cmp.scenario.throughputPerHour).toBeGreaterThan(cmp.base.throughputPerHour * 1.5);
    expect(cmp.deltas.throughputPerHour).toBeGreaterThan(0);
    // With s1 doubled, its effective service time (10/2=5) matches the others → it is no
    // longer the sole bottleneck, so the bottleneck moves off s1 (or ties away).
    expect(cmp.scenario.bottleneckEffServiceSec).toBeCloseTo(5, 6);
  });

  it("addCapacity op is equivalent to raising capacity", () => {
    const model = serialLine([5, 10, 5], [1, 1, 1], 100);
    const viaSet = applyScenario(model, [{ op: "setCapacity", stationId: "s1", capacity: 2 }]);
    const viaAdd = applyScenario(model, [{ op: "addCapacity", stationId: "s1", delta: 1 }]);
    expect(runDes(viaSet, { seed: 5 }).throughputPerHour).toBeCloseTo(
      runDes(viaAdd, { seed: 5 }).throughputPerHour,
      6,
    );
  });
});

describe("DES engine — (c) stochastic yield reduces good output", () => {
  it("a station with yield 0.8 scraps ~20% of parts (seeded)", () => {
    const N = 2000;
    const stations: StationSpec[] = [
      { id: "s0", capacity: 1, processTimeSec: 2, yield: 1 },
      { id: "s1", capacity: 1, processTimeSec: 2, yield: 0.8, onFail: "scrap" },
      { id: "s2", capacity: 1, processTimeSec: 2, yield: 1 },
    ];
    const model: LineModel = { id: "yl", stations, source: { kind: "batch", count: N } };
    const res = runDes(model, { seed: 42 });

    expect(res.released).toBe(N);
    expect(res.scrapped).toBeGreaterThan(0);
    expect(res.goodCompleted).toBeLessThan(N);
    // Expected good ≈ N·0.8 = 1600 (seeded → within a modest band).
    expect(res.goodCompleted).toBeGreaterThan(N * 0.76);
    expect(res.goodCompleted).toBeLessThan(N * 0.84);
    expect(res.goodCompleted + res.scrapped).toBe(N);
    // The scrap all happens at s1.
    const s1 = res.stations.find((s) => s.id === "s1")!;
    expect(s1.scrapped).toBe(res.scrapped);
  });

  it("rework recovers parts instead of scrapping them", () => {
    const N = 500;
    const scrapModel: LineModel = {
      id: "sc",
      stations: [{ id: "s0", capacity: 1, processTimeSec: 1, yield: 0.7, onFail: "scrap" }],
      source: { kind: "batch", count: N },
    };
    const reworkModel: LineModel = {
      id: "rw",
      stations: [{ id: "s0", capacity: 1, processTimeSec: 1, yield: 0.7, onFail: "rework", maxRework: 3 }],
      source: { kind: "batch", count: N },
    };
    const scrap = runDes(scrapModel, { seed: 11 });
    const rework = runDes(reworkModel, { seed: 11 });
    // Rework recovers most parts → far fewer scrapped, more good output.
    expect(rework.goodCompleted).toBeGreaterThan(scrap.goodCompleted);
    expect(rework.reworked).toBeGreaterThan(0);
    expect(rework.scrapped).toBeLessThan(scrap.scrapped);
  });
});

describe("DES engine — (d) deterministic under a fixed seed", () => {
  it("same seed → byte-identical result (stochastic model)", () => {
    const stations: StationSpec[] = [
      { id: "s0", capacity: 1, processTimeSec: 3, processDist: "exponential" },
      { id: "s1", capacity: 2, processTimeSec: 5, processDist: "normal", processCV: 0.3, yield: 0.9 },
    ];
    const model: LineModel = { id: "det", stations, source: { kind: "batch", count: 400 } };
    const a = runDes(model, { seed: 123 });
    const b = runDes(model, { seed: 123 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("different seeds produce different stochastic outcomes", () => {
    const stations: StationSpec[] = [
      { id: "s0", capacity: 1, processTimeSec: 3, processDist: "exponential" },
      { id: "s1", capacity: 2, processTimeSec: 5, processDist: "normal", processCV: 0.3, yield: 0.9 },
    ];
    const model: LineModel = { id: "det", stations, source: { kind: "batch", count: 400 } };
    const a = runDes(model, { seed: 1 });
    const b = runDes(model, { seed: 2 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("the seeded PRNG itself is repeatable and never uses Math.random", () => {
    const r1 = makeRng(999);
    const r2 = makeRng(999);
    const s1 = [r1.next(), r1.next(), r1.next()];
    const s2 = [r2.next(), r2.next(), r2.next()];
    expect(s1).toEqual(s2);
    for (const v of s1) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("DES engine — (e) empty / degenerate topology degrades safely", () => {
  it("an empty station list returns a degraded, non-throwing result", () => {
    const res = runDes({ id: "empty", stations: [], source: { kind: "batch", count: 10 } });
    expect(res.ok).toBe(false);
    expect(res.degraded).toBe(true);
    expect(res.throughputPerHour).toBe(0);
    expect(res.bottleneckStationId).toBeNull();
    expect(res.notes.length).toBeGreaterThan(0);
  });

  it("coerces bad capacity / process time and reports notes", () => {
    const stations: StationSpec[] = [
      { id: "s0", capacity: 0, processTimeSec: -5, yield: 2 },
      { id: "s1", capacity: -3, processTimeSec: 0, yield: -1 },
    ];
    const res = runDes({ id: "bad", stations, source: { kind: "batch", count: 5 } }, { seed: 1 });
    expect(res.ok).toBe(true);
    expect(res.degraded).toBe(true);
    expect(res.notes.some((n) => /coerced|clamped/.test(n))).toBe(true);
    // It still produces finite KPIs.
    expect(Number.isFinite(res.throughputPerHour)).toBe(true);
  });

  it("a zero-count batch releases nothing but does not throw", () => {
    const res = runDes(serialLine([2, 2], [1, 1], 0), { seed: 1 });
    expect(res.released).toBe(0);
    expect(res.goodCompleted).toBe(0);
    expect(res.degraded).toBe(true);
  });
});

describe("DES engine — buffers/blocking bound WIP", () => {
  it("a finite buffer at a slow station blocks upstream and bounds the queue", () => {
    const stations: StationSpec[] = [
      { id: "fast", capacity: 1, processTimeSec: 1, bufferCapacity: Infinity },
      { id: "slow", capacity: 1, processTimeSec: 10, bufferCapacity: 1 },
    ];
    const model: LineModel = { id: "blk", stations, source: { kind: "batch", count: 20 } };
    const res = runDes(model, { seed: 1 });
    const slow = res.stations.find((s) => s.id === "slow")!;
    const fast = res.stations.find((s) => s.id === "fast")!;
    // The slow station's input buffer never exceeds its cap of 1.
    expect(slow.maxQueueLen).toBeLessThanOrEqual(1);
    // The fast station spends time BLOCKED (finished part cannot move downstream).
    expect(fast.blockedTime).toBeGreaterThan(0);
    // All 20 parts still complete.
    expect(res.goodCompleted).toBe(20);
  });
});

describe("DES model builders", () => {
  it("buildLineModelFromScene maps stations, device-count capacity, and params", () => {
    const line = {
      id: "line:2",
      refId: 2,
      code: "L2",
      name: "SMT Line 2",
      workshopId: 1,
      stations: [
        { id: "station:10", refId: 10, code: "PRINT", name: "Printer", lineId: 2, devices: [{}] },
        { id: "station:11", refId: 11, code: "SPI", name: "SPI", lineId: 2, devices: [{}, {}] },
        { id: "station:12", refId: 12, code: "AOI", name: "AOI", lineId: 2, devices: [] },
      ],
    } as unknown as LineNode;

    const model = buildLineModelFromScene(line, {
      params: {
        PRINT: { processTimeSec: 8, yield: 0.99 },
        SPI: { processTimeSec: 4 },
      },
      source: { kind: "batch", count: 100 },
    });

    expect(model.stations.map((s) => s.id)).toEqual(["station:10", "station:11", "station:12"]);
    // SPI has two devices → capacity 2; AOI has zero devices → coerced to 1 in the engine.
    expect(model.stations[1].capacity).toBe(2);
    expect(model.stations[0].processTimeSec).toBe(8);
    expect(model.stations[0].yield).toBe(0.99);
    // Default param for AOI (no override).
    expect(model.stations[2].processTimeSec).toBe(30);

    const res = runDes(model, { seed: 2 });
    expect(res.ok).toBe(true);
    expect(res.stations).toHaveLength(3);
  });

  it("buildLineModelFromRouting reuses a workflow as a process routing", () => {
    const def: WorkflowDefinition = {
      ref: "wf.route",
      name: "Route",
      steps: [
        { id: "a", type: "command", machineId: 1, command: "start", label: "Feeder" },
        { id: "b", type: "command", machineId: 1, command: "feed" },
        { id: "c", type: "delay", ms: 2000 },
        { id: "d", type: "command", machineId: 2, command: "transfer", label: "Robot" },
        { id: "e", type: "command", machineId: 3, command: "test", label: "RF" },
      ],
    };
    const model = buildLineModelFromRouting(def, { start: 1, feed: 3, transfer: 4, test: 9 }, 2, {
      source: { kind: "batch", count: 50 },
    });
    // Three distinct machines → three stations in first-appearance order.
    expect(model.stations.map((s) => s.id)).toEqual(["machine:1", "machine:2", "machine:3"]);
    // machine:1 = start(1) + feed(3) + delay(2s) = 6s.
    expect(model.stations[0].processTimeSec).toBeCloseTo(6, 6);
    expect(model.stations[2].processTimeSec).toBeCloseTo(9, 6); // RF test = 9s → sole bottleneck
    const res = runDes(model, { seed: 1 });
    expect(res.ok).toBe(true);
    expect(res.bottleneckStationId).toBe("machine:3");
  });
});

describe("DES scheduling feedback (advisory only)", () => {
  it("buildThroughputAdvisory distils a run into a scheduling advisory", () => {
    const res = runDes(serialLine([5, 10, 5], [1, 1, 1], 300), { seed: 9 });
    const adv = buildThroughputAdvisory(res, 2);
    expect(adv.lineId).toBe(2);
    expect(adv.predictedCapacityPerHour).toBe(adv.predictedGoodThroughputPerHour);
    expect(adv.bottleneckStationId).toBe("s1");
    expect(adv.predictedCapacityPerHour).toBeGreaterThan(340);
    expect(adv.advisoryNote).toMatch(/advisory only/i);
  });

  it("reconcileCapacityAdvisory surfaces a delta without changing anything", () => {
    const res = runDes(serialLine([5, 10, 5], [1, 1, 1], 300), { seed: 9 });
    const adv = buildThroughputAdvisory(res, 2);
    // Configured capacity way above what the sim predicts → a 'runs late' warning.
    const rec = reconcileCapacityAdvisory(600, adv);
    expect(rec.configuredPerHour).toBe(600);
    expect(rec.deltaPerHour).toBeLessThan(0);
    expect(rec.recommendation).toMatch(/advisory only/i);
    // No configured capacity → seed suggestion.
    const rec2 = reconcileCapacityAdvisory(null, adv);
    expect(rec2.deltaPerHour).toBeNull();
    expect(rec2.recommendation).toMatch(/seed|consider/i);
  });
});
