/**
 * doc 54 P2.5 — unit tests for the PURE recursive-lineage tree builder.
 * Edges are (child, parent) tuples (child = unit, parent = its parent).
 */
import { describe, it, expect } from "vitest";
import { buildLineageTree, type LineageEdge } from "./genealogyLineageService";

// A ─┬─ B ─── D
//    └─ C
const edges: LineageEdge[] = [
  { child: "B", parent: "A" },
  { child: "C", parent: "A" },
  { child: "D", parent: "B" },
];

describe("buildLineageTree — descendants", () => {
  it("walks parent→child recursively (multi-level)", () => {
    const { root, nodeCount, truncated } = buildLineageTree(edges, "A", "descendants", 10);
    expect(root.serialNumber).toBe("A");
    expect(root.children.map((c) => c.serialNumber)).toEqual(["B", "C"]); // sorted
    const b = root.children.find((c) => c.serialNumber === "B")!;
    expect(b.children.map((c) => c.serialNumber)).toEqual(["D"]);
    expect(b.depth).toBe(1);
    expect(b.children[0].depth).toBe(2);
    expect(nodeCount).toBe(3); // B, C, D (root excluded)
    expect(truncated).toBe(false);
  });

  it("returns a lone-root tree for a serial with no edges (honest)", () => {
    const { root, nodeCount } = buildLineageTree(edges, "ZZZ", "descendants", 10);
    expect(root.serialNumber).toBe("ZZZ");
    expect(root.children).toEqual([]);
    expect(nodeCount).toBe(0);
  });
});

describe("buildLineageTree — ancestors", () => {
  it("walks child→parent recursively", () => {
    const { root, nodeCount } = buildLineageTree(edges, "D", "ancestors", 10);
    expect(root.serialNumber).toBe("D");
    expect(root.children.map((c) => c.serialNumber)).toEqual(["B"]);
    const b = root.children[0];
    expect(b.children.map((c) => c.serialNumber)).toEqual(["A"]);
    expect(nodeCount).toBe(2); // B, A
  });
});

describe("buildLineageTree — safety", () => {
  it("is cycle-safe (never expands a serial twice on a path)", () => {
    const cyclic: LineageEdge[] = [
      { child: "B", parent: "A" },
      { child: "A", parent: "B" }, // A↔B cycle
    ];
    const { root, nodeCount } = buildLineageTree(cyclic, "A", "descendants", 10);
    expect(root.serialNumber).toBe("A");
    expect(root.children.map((c) => c.serialNumber)).toEqual(["B"]);
    // B's only child would be A, which is on the path → pruned.
    expect(root.children[0].children).toEqual([]);
    expect(nodeCount).toBe(1);
  });

  it("bounds depth and flags truncation", () => {
    // A ← B ← C ← D (each child of the previous)
    const chain: LineageEdge[] = [
      { child: "B", parent: "A" },
      { child: "C", parent: "B" },
      { child: "D", parent: "C" },
    ];
    const { nodeCount, truncated } = buildLineageTree(chain, "A", "descendants", 2);
    expect(nodeCount).toBe(2); // B (d1), C (d2); D beyond maxDepth
    expect(truncated).toBe(true);
  });
});
