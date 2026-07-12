/**
 * doc 44 W7-3 (G1.19 / G2.20) — benchmark harness PURE math + determinism tests.
 *
 * The harness itself lives in scripts/bench (ESM, no infra); this test (under
 * server/ so vitest's include picks it up) exercises its pure, load-bearing pieces:
 *   • percentile / summarize / throughputPerSec / gate  (bench-report scoring math)
 *   • makeLoadGenerator determinism                      (reproducible load runs)
 */
import { describe, it, expect } from "vitest";
// scripts/ is outside the server tree — reach it explicitly (vite resolves .mjs).
import { percentile, summarize, throughputPerSec, gate, round } from "../../../scripts/bench/lib/stats.mjs";
import { makeLoadGenerator, mulberry32 } from "../../../scripts/bench/lib/loadgen.mjs";

describe("stats.percentile", () => {
  it("interpolates between closest ranks", () => {
    const v = [10, 20, 30, 40, 50];
    expect(percentile(v, 50)).toBe(30); // rank = 0.5*4 = 2 → arr[2]
    expect(percentile(v, 0)).toBe(10);
    expect(percentile(v, 100)).toBe(50);
    expect(round(percentile(v, 95), 2)).toBe(48); // 0.95*4=3.8 → 40 + 0.8*10
    expect(round(percentile(v, 99), 2)).toBe(49.6); // 0.99*4=3.96 → 40 + 0.96*10
  });
  it("is order-independent (sorts internally) and non-mutating", () => {
    const v = [50, 10, 40, 20, 30];
    const copy = v.slice();
    expect(percentile(v, 50)).toBe(30);
    expect(v).toEqual(copy); // input not mutated
  });
  it("handles empty + singleton + non-finite", () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([1, NaN, 3], 50)).toBe(2); // NaN dropped → [1,3] → 2
  });
});

describe("stats.summarize", () => {
  it("returns full percentile summary", () => {
    const s = summarize([10, 20, 30, 40, 50], 2);
    expect(s.n).toBe(5);
    expect(s.min).toBe(10);
    expect(s.max).toBe(50);
    expect(s.mean).toBe(30);
    expect(s.p50).toBe(30);
  });
  it("empty sample → all null but n=0", () => {
    const s = summarize([]);
    expect(s.n).toBe(0);
    expect(s.p95).toBeNull();
  });
});

describe("stats.throughputPerSec + gate", () => {
  it("computes events/sec, 0 when elapsed ≤ 0", () => {
    expect(throughputPerSec(100, 1000)).toBe(100);
    expect(throughputPerSec(100, 0)).toBe(0);
  });
  it("gate max/min pass-fail + honest not-measured", () => {
    expect(gate("lat", 200, 250, "max", "ms").pass).toBe(true);
    expect(gate("lat", 300, 250, "max", "ms").pass).toBe(false);
    expect(gate("tp", 120000, 100000, "min").pass).toBe(true);
    expect(gate("tp", 80000, 100000, "min").pass).toBe(false);
    expect(gate("lat", null, 250, "max").pass).toBeNull(); // not measured — never a silent pass
  });
});

describe("loadgen determinism", () => {
  it("mulberry32 is deterministic for a seed", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it("same seed → byte-identical batches", () => {
    const g1 = makeLoadGenerator({ tagCount: 300, seed: 42 });
    const g2 = makeLoadGenerator({ tagCount: 300, seed: 42 });
    expect(JSON.stringify(g1.generateBatch(100, 0))).toBe(JSON.stringify(g2.generateBatch(100, 0)));
  });
  it("different seed → different batches", () => {
    const g1 = makeLoadGenerator({ tagCount: 300, seed: 1 });
    const g2 = makeLoadGenerator({ tagCount: 300, seed: 2 });
    expect(JSON.stringify(g1.generateBatch(100, 0))).not.toBe(JSON.stringify(g2.generateBatch(100, 0)));
  });
  it("generates the requested count with CanonicalSample shape", () => {
    const g = makeLoadGenerator({ tagCount: 60, seed: 7 });
    const batch = g.generateBatch(20, 1000);
    expect(batch).toHaveLength(20);
    for (const s of batch) {
      expect(typeof s.deviceId).toBe("string");
      expect(typeof s.metric).toBe("string");
      expect("value" in s).toBe(true);
      expect(s.protocol).toBe("opcua");
      expect(typeof s.ts).toBe("string"); // ISO
    }
  });
});
