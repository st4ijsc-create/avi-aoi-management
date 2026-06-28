/**
 * Causal-graph WRITE path — validate + atomic save tests.
 *
 * Verifies the management editor's safety contract:
 *  - a valid graph saves and round-trips
 *  - an edge referencing a missing node is REJECTED (referential integrity)
 *  - duplicate node ids are REJECTED (uniqueness)
 *  - an INVALID graph never writes (atomic: the on-disk file is untouched)
 *  - node/edge CRUD helpers maintain integrity (cascade edge removal)
 *
 * GRAPH_FILE is resolved from process.cwd() at import time, so we BACK UP the
 * real knowledge/causal-graph.json before each test and RESTORE it after — the
 * RCA engine's file is never left mutated by the suite.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  validateCausalGraph,
  saveCausalGraph,
  getEditableGraph,
  addCausalNode,
  removeCausalNode,
  addCausalEdge,
  CausalGraphValidationError,
  loadCausalGraph,
  type EditableCausalGraph,
} from "./aiCausalGraph";

const GRAPH_FILE = path.join(process.cwd(), "knowledge", "causal-graph.json");
let backup: string | null = null;

beforeEach(() => {
  backup = fs.existsSync(GRAPH_FILE) ? fs.readFileSync(GRAPH_FILE, "utf8") : null;
});

afterEach(() => {
  if (backup !== null) {
    fs.mkdirSync(path.dirname(GRAPH_FILE), { recursive: true });
    fs.writeFileSync(GRAPH_FILE, backup, "utf8");
  } else if (fs.existsSync(GRAPH_FILE)) {
    fs.rmSync(GRAPH_FILE);
  }
  loadCausalGraph(true); // reset cache to the restored on-disk state
});

const validGraph = (): EditableCausalGraph => ({
  version: 1,
  nodes: [
    { id: "defect:x", type: "defect", label: "Defect X" },
    { id: "cause:y", type: "cause", label: "Cause Y", aliases: ["why"] },
    { id: "action:z", type: "action", label: "Action Z" },
  ],
  edges: [
    { from: "defect:x", to: "cause:y", type: "defect_caused_by", weight: 0.7 },
    { from: "cause:y", to: "action:z", type: "cause_resolved_by", weight: 0.9 },
  ],
});

describe("validateCausalGraph", () => {
  it("accepts a well-formed graph", () => {
    expect(() => validateCausalGraph(validGraph())).not.toThrow();
  });

  it("rejects an edge referencing a missing node", () => {
    const g = validGraph();
    g.edges.push({ from: "defect:x", to: "cause:missing", type: "defect_caused_by" });
    expect(() => validateCausalGraph(g)).toThrow(CausalGraphValidationError);
  });

  it("rejects duplicate node ids", () => {
    const g = validGraph();
    g.nodes.push({ id: "defect:x", type: "defect", label: "Dup" });
    expect(() => validateCausalGraph(g)).toThrow(/Duplicate node id/);
  });

  it("rejects an out-of-range edge weight", () => {
    const g = validGraph();
    g.edges[0].weight = 1.5;
    expect(() => validateCausalGraph(g)).toThrow(CausalGraphValidationError);
  });
});

describe("saveCausalGraph (atomic + fail-safe)", () => {
  it("saves a valid graph and round-trips it", () => {
    saveCausalGraph(validGraph());
    const reloaded = getEditableGraph();
    expect(reloaded.nodes.map((n) => n.id).sort()).toEqual(["action:z", "cause:y", "defect:x"]);
    expect(reloaded.edges).toHaveLength(2);
  });

  it("never writes when validation fails (file untouched)", () => {
    // Seed a known-good file first.
    saveCausalGraph(validGraph());
    const before = fs.readFileSync(GRAPH_FILE, "utf8");

    const bad = validGraph();
    bad.edges.push({ from: "defect:x", to: "cause:missing", type: "defect_caused_by" });
    expect(() => saveCausalGraph(bad)).toThrow(CausalGraphValidationError);

    const after = fs.readFileSync(GRAPH_FILE, "utf8");
    expect(after).toEqual(before); // atomic: invalid write left the file intact
  });

  it("leaves no temp files behind on success", () => {
    saveCausalGraph(validGraph());
    const dir = path.dirname(GRAPH_FILE);
    const leftovers = fs.readdirSync(dir).filter((f) => f.includes(".causal-graph.") && f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });
});

describe("node/edge CRUD helpers", () => {
  beforeEach(() => saveCausalGraph(validGraph()));

  it("addCausalNode rejects a duplicate id", () => {
    expect(() => addCausalNode({ id: "defect:x", type: "defect", label: "dup" })).toThrow(
      CausalGraphValidationError,
    );
  });

  it("addCausalEdge rejects an edge to a missing node", () => {
    expect(() =>
      addCausalEdge({ from: "defect:x", to: "cause:nope", type: "defect_caused_by" }),
    ).toThrow(CausalGraphValidationError);
  });

  it("removeCausalNode cascades to touching edges", () => {
    const g = removeCausalNode("cause:y");
    expect(g.nodes.some((n) => n.id === "cause:y")).toBe(false);
    // Both edges touched cause:y → both removed.
    expect(g.edges).toHaveLength(0);
  });
});
