/**
 * Unit tests for the GraphRAG pure helpers (doc 11 follow-up):
 * buildAdjacency + expandWithGraph. No filesystem / embedding I/O.
 */
import { describe, it, expect } from "vitest";
import {
  buildAdjacency,
  expandWithGraph,
  type GraphCandidate,
  type ExpandOptions,
} from "./aiSemanticGraph";

const OPTS: ExpandOptions = {
  seeds: 5,
  hopsPerSeed: 3,
  minSim: 0.72,
  decay: 0.85,
  maxInject: 8,
};

// Identity materialiser: any neighbour id is injectable with the blended score.
const makeAny = (id: string, score: number): GraphCandidate => ({ id, score });

describe("buildAdjacency", () => {
  it("builds a map sorted DESC by similarity and skips malformed edges", () => {
    const adj = buildAdjacency([
      { from: "a", to: "b", similarity: 0.8 },
      { from: "a", to: "c", similarity: 0.95 },
      { from: "a", to: "a", similarity: 0.99 }, // self-loop dropped
      { from: "a", to: "d" }, // missing similarity dropped
      { from: 123 as unknown as string, to: "e", similarity: 0.9 }, // bad from dropped
      { from: "b", to: "c", similarity: 0.74 },
    ]);
    expect(adj.get("a")!.map((e) => e.to)).toEqual(["c", "b"]); // sorted desc
    expect(adj.get("a")).toHaveLength(2);
    expect(adj.get("b")).toEqual([{ to: "c", similarity: 0.74 }]);
    expect(adj.has("e")).toBe(false);
  });
});

describe("expandWithGraph", () => {
  const pool: GraphCandidate[] = [
    { id: "s1", score: 1.0 },
    { id: "s2", score: 0.5 },
  ];

  it("is a no-op when the graph is empty", () => {
    const r = expandWithGraph(pool, new Map(), OPTS, makeAny);
    expect(r.injected).toBe(0);
    expect(r.pool).toBe(pool); // same reference → zero-cost
  });

  it("injects 1-hop neighbours with a blended (decayed) score", () => {
    const adj = buildAdjacency([{ from: "s1", to: "n1", similarity: 0.8 }]);
    const r = expandWithGraph(pool, adj, OPTS, makeAny);
    expect(r.injected).toBe(1);
    const n1 = r.pool.find((c) => c.id === "n1")!;
    // 1.0 (seed) * 0.8 (edge) * 0.85 (decay) = 0.68
    expect(n1.score).toBeCloseTo(0.68, 6);
    // blended score must be below the seed's own cosine score (no outranking)
    expect(n1.score).toBeLessThan(pool[0].score);
  });

  it("does not re-inject a neighbour already present in the pool", () => {
    const adj = buildAdjacency([{ from: "s1", to: "s2", similarity: 0.9 }]);
    const r = expandWithGraph(pool, adj, OPTS, makeAny);
    expect(r.injected).toBe(0);
  });

  it("drops edges below minSim and respects hopsPerSeed", () => {
    const adj = buildAdjacency([
      { from: "s1", to: "n1", similarity: 0.9 },
      { from: "s1", to: "n2", similarity: 0.8 },
      { from: "s1", to: "n3", similarity: 0.75 },
      { from: "s1", to: "weak", similarity: 0.5 }, // below minSim
    ]);
    const r = expandWithGraph(pool, adj, { ...OPTS, hopsPerSeed: 2 }, makeAny);
    const ids = r.pool.map((c) => c.id);
    expect(r.injected).toBe(2);
    expect(ids).toContain("n1");
    expect(ids).toContain("n2");
    expect(ids).not.toContain("weak");
  });

  it("keeps the highest blended score when a neighbour is reachable from many seeds", () => {
    const adj = buildAdjacency([
      { from: "s1", to: "shared", similarity: 0.8 }, // 1.0*0.8*0.85 = 0.68
      { from: "s2", to: "shared", similarity: 0.99 }, // 0.5*0.99*0.85 = 0.42
    ]);
    const r = expandWithGraph(pool, adj, OPTS, makeAny);
    expect(r.injected).toBe(1); // injected once
    const shared = r.pool.find((c) => c.id === "shared")!;
    expect(shared.score).toBeCloseTo(0.68, 6); // higher of the two
  });

  it("caps total injection at maxInject", () => {
    const adj = buildAdjacency([
      { from: "s1", to: "n1", similarity: 0.95 },
      { from: "s1", to: "n2", similarity: 0.9 },
      { from: "s1", to: "n3", similarity: 0.85 },
    ]);
    const r = expandWithGraph(pool, adj, { ...OPTS, hopsPerSeed: 5, maxInject: 2 }, makeAny);
    expect(r.injected).toBe(2);
  });

  it("skips neighbours the materialiser cannot resolve (returns null)", () => {
    const adj = buildAdjacency([
      { from: "s1", to: "known", similarity: 0.9 },
      { from: "s1", to: "unknown", similarity: 0.88 },
    ]);
    const make = (id: string, score: number) => (id === "unknown" ? null : { id, score });
    const r = expandWithGraph(pool, adj, OPTS, make);
    expect(r.injected).toBe(1);
    expect(r.pool.map((c) => c.id)).toContain("known");
    expect(r.pool.map((c) => c.id)).not.toContain("unknown");
  });

  it("preserves original candidates first, in order", () => {
    const adj = buildAdjacency([{ from: "s1", to: "n1", similarity: 0.9 }]);
    const r = expandWithGraph(pool, adj, OPTS, makeAny);
    expect(r.pool[0].id).toBe("s1");
    expect(r.pool[1].id).toBe("s2");
    expect(r.pool[2].id).toBe("n1");
  });
});
