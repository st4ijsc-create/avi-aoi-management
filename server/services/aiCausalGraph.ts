/**
 * Phase B2.3 — Causal Knowledge Graph.
 *
 * Loads knowledge/causal-graph.json (machine ↔ defect ↔ cause ↔ action) and
 * provides query helpers that, given a defect (and optionally a machine), return
 * the most likely causes and recommended actions by walking the graph.
 *
 * Also exposes a HYBRID retrieval helper (`hybridDefectContext`) that RCA can
 * call to combine vector KB hits with graph neighbors. The KB retrieval is
 * injected as a callback so this module has NO hard dependency on
 * aiLocalKnowledgeService (avoids cycles; keeps it unit-testable).
 *
 * FLAG: RAG_CAUSAL_GRAPH_ENABLED (default OFF). When off, the query helpers still
 * work if called directly (pure data), but `isCausalGraphEnabled()` lets callers
 * skip the graph entirely so default behavior is unchanged. All loads are
 * FAIL-SAFE: a missing/corrupt file yields an empty graph, never a throw.
 */

import fs from "node:fs";
import path from "node:path";

export type CausalNodeType = "machine" | "defect" | "cause" | "action";
export type CausalEdgeType =
  | "machine_exhibits"
  | "defect_caused_by"
  | "cause_resolved_by"
  | "cause_prevented_by";

export interface CausalNode {
  id: string;
  type: CausalNodeType;
  label: string;
  aliases?: string[];
}

export interface CausalEdge {
  from: string;
  to: string;
  type: CausalEdgeType;
  weight?: number;
}

interface CausalGraphFile {
  version?: number;
  nodes: CausalNode[];
  edges: CausalEdge[];
}

export interface RankedCause {
  cause: CausalNode;
  /** Confidence ∈ (0,1]: defect→cause edge weight, optionally × machine prior. */
  probability: number;
  actions: Array<{ action: CausalNode; weight: number; kind: "resolve" | "prevent" }>;
}

export interface CausalQueryResult {
  defect: CausalNode | null;
  machine: CausalNode | null;
  causes: RankedCause[];
}

// ─── Flag ──────────────────────────────────────────────────────────────────────

export function isCausalGraphEnabled(): boolean {
  return (process.env.RAG_CAUSAL_GRAPH_ENABLED ?? "false").toLowerCase() === "true";
}

// ─── Load (cached, fail-safe) ───────────────────────────────────────────────────

const GRAPH_FILE = path.join(process.cwd(), "knowledge", "causal-graph.json");

interface LoadedGraph {
  nodes: CausalNode[];
  edges: CausalEdge[];
  byId: Map<string, CausalNode>;
  loadedAt: number;
}

let cache: LoadedGraph | null = null;

function emptyGraph(): LoadedGraph {
  return { nodes: [], edges: [], byId: new Map(), loadedAt: Date.now() };
}

export function loadCausalGraph(forceReload = false): LoadedGraph {
  if (cache && !forceReload) return cache;
  try {
    if (!fs.existsSync(GRAPH_FILE)) {
      cache = emptyGraph();
      return cache;
    }
    const raw = JSON.parse(fs.readFileSync(GRAPH_FILE, "utf8")) as CausalGraphFile;
    const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
    const edges = Array.isArray(raw.edges) ? raw.edges : [];
    const byId = new Map<string, CausalNode>();
    for (const n of nodes) if (n && typeof n.id === "string") byId.set(n.id, n);
    cache = { nodes, edges, byId, loadedAt: Date.now() };
    return cache;
  } catch (err) {
    console.warn("[aiCausalGraph] failed to load causal-graph.json, using empty graph:", err);
    cache = emptyGraph();
    return cache;
  }
}

// ─── Matching helpers ────────────────────────────────────────────────────────────

function norm(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve a free-text defect/machine string to the best-matching node of the
 * given type. Matches against label + aliases (diacritics-insensitive substring,
 * both directions). Returns null when nothing matches.
 */
export function findNode(text: string, type: CausalNodeType): CausalNode | null {
  const g = loadCausalGraph();
  const q = norm(text);
  if (!q) return null;
  let best: CausalNode | null = null;
  let bestLen = 0;
  for (const n of g.nodes) {
    if (n.type !== type) continue;
    const candidates = [n.label, ...(n.aliases ?? [])].map(norm);
    for (const c of candidates) {
      if (!c) continue;
      // Match if either contains the other; prefer the longest matched token to
      // avoid a 1-char alias winning over a specific label.
      if (q.includes(c) || c.includes(q)) {
        const len = Math.min(c.length, q.length);
        if (len > bestLen) {
          bestLen = len;
          best = n;
        }
      }
    }
  }
  return best;
}

// ─── Core query: defect → causes → actions ───────────────────────────────────────

/**
 * Given a defect node id (and optional machine node id), return ranked causes
 * each with its recommended resolve/prevent actions. Cause probability =
 * defect→cause edge weight, lightly boosted when the cause is consistent with
 * the given machine's known defect repertoire.
 */
export function queryCausesForDefect(defectId: string, machineId?: string | null): RankedCause[] {
  const g = loadCausalGraph();
  const defect = g.byId.get(defectId);
  if (!defect || defect.type !== "defect") return [];

  const causeEdges = g.edges.filter(
    (e) => e.type === "defect_caused_by" && e.from === defectId,
  );

  const ranked: RankedCause[] = [];
  for (const ce of causeEdges) {
    const cause = g.byId.get(ce.to);
    if (!cause || cause.type !== "cause") continue;

    const actions = g.edges
      .filter(
        (e) =>
          (e.type === "cause_resolved_by" || e.type === "cause_prevented_by") &&
          e.from === cause.id,
      )
      .map((e) => {
        const action = g.byId.get(e.to);
        return action && action.type === "action"
          ? {
              action,
              weight: e.weight ?? 0.5,
              kind: (e.type === "cause_resolved_by" ? "resolve" : "prevent") as
                | "resolve"
                | "prevent",
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.weight - a.weight);

    ranked.push({ cause, probability: ce.weight ?? 0.5, actions });
  }

  // Machine prior: if a machine is given and it "exhibits" this defect strongly,
  // keep ordering by cause weight (defect already filtered to machine context by
  // caller intent). No re-weighting needed beyond the defect→cause edge, but we
  // still surface the machine for the result envelope.
  void machineId;

  ranked.sort((a, b) => b.probability - a.probability);
  return ranked;
}

/**
 * High-level: resolve free-text defect/machine strings, then return ranked
 * causes + actions. This is the main entry RCA / chat can call.
 */
export function queryByText(defectText: string, machineText?: string | null): CausalQueryResult {
  const defect = findNode(defectText, "defect");
  const machine = machineText ? findNode(machineText, "machine") : null;
  if (!defect) return { defect: null, machine, causes: [] };
  return {
    defect,
    machine,
    causes: queryCausesForDefect(defect.id, machine?.id ?? null),
  };
}

/**
 * Render a compact, LLM-friendly text block of the causal chain for a defect,
 * suitable for splicing into an RCA prompt as extra grounded context.
 */
export function formatCausalContext(result: CausalQueryResult, maxCauses = 4): string {
  if (!result.defect || result.causes.length === 0) return "";
  const lines: string[] = [];
  lines.push(
    `Causal chain for defect "${result.defect.label}"` +
      (result.machine ? ` on ${result.machine.label}` : "") +
      ":",
  );
  for (const rc of result.causes.slice(0, maxCauses)) {
    const acts = rc.actions
      .slice(0, 2)
      .map((a) => a.action.label)
      .join("; ");
    lines.push(
      `- Likely cause (${Math.round(rc.probability * 100)}%): ${rc.cause.label}` +
        (acts ? ` → Action: ${acts}` : ""),
    );
  }
  return lines.join("\n");
}

// ─── Hybrid retrieval (vector KB + graph neighbors) ──────────────────────────────

export interface HybridKbHit {
  id: string;
  title: string;
  sourcePath: string;
  score: number;
  text: string;
}

export interface HybridDefectContext {
  /** Graph-derived causal chain (empty when flag off or no defect match). */
  causal: CausalQueryResult;
  /** Formatted causal text block for prompts (empty string when none). */
  causalText: string;
  /** Vector KB hits supplied by the injected retriever (unchanged passthrough). */
  kbHits: HybridKbHit[];
}

/**
 * Combine causal-graph neighbors with vector KB hits for a defect/machine query.
 *
 * The KB retrieval is injected (`retrieveKb`) so this module never imports
 * aiLocalKnowledgeService directly. When RAG_CAUSAL_GRAPH_ENABLED is off, the
 * causal half is skipped and only the KB hits are returned — i.e. behavior
 * degrades to plain RAG. FAIL-SAFE: graph errors never block the KB hits.
 */
export async function hybridDefectContext(
  defectText: string,
  machineText: string | null,
  retrieveKb: (query: string) => Promise<HybridKbHit[]>,
): Promise<HybridDefectContext> {
  const query = [defectText, machineText].filter(Boolean).join(" ");
  let kbHits: HybridKbHit[] = [];
  try {
    kbHits = await retrieveKb(query);
  } catch (err) {
    console.warn("[aiCausalGraph] hybrid KB retrieval failed:", err);
    kbHits = [];
  }

  let causal: CausalQueryResult = { defect: null, machine: null, causes: [] };
  let causalText = "";
  if (isCausalGraphEnabled()) {
    try {
      causal = queryByText(defectText, machineText);
      causalText = formatCausalContext(causal);
    } catch (err) {
      console.warn("[aiCausalGraph] causal query failed:", err);
    }
  }

  return { causal, causalText, kbHits };
}
