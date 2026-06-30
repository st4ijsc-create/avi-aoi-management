// aiSemanticGraph.ts (doc 11 follow-up — GraphRAG 1-hop expansion)
// ───────────────────────────────────────────────────────────────────────────
// Best-effort loader + pure-logic helpers for the precomputed semantic graph
// (knowledge/semantic-graph.json). The graph links chunk → chunk by embedding
// similarity (topK=3, minSimilarity=0.72 at build time). Node id == chunk id
// (e.g. "router:server/routers/aiChatRouter.ts#0").
//
// Used by aiLocalKnowledgeService.retrieveKnowledge to OPTIONALLY widen the
// cosine candidate pool with 1-hop neighbours of the top seeds, so the
// reranker/LLM can see semantically-linked context (a multi-part doc, or a
// router that references a schema). The whole feature is flag-gated and
// fail-safe: a missing/corrupt graph file simply disables expansion.
//
// This module holds NO retrieval state of its own beyond a lazy cache of the
// adjacency map; the expansion algorithm (expandWithGraph) is a PURE function
// so it can be unit-tested without touching the filesystem or embeddings.

import fs from "node:fs";
import path from "node:path";

const KNOWLEDGE_DIR = path.join(process.cwd(), "knowledge");
const SEMANTIC_GRAPH_FILE = path.join(KNOWLEDGE_DIR, "semantic-graph.json");

/** One outgoing edge from a chunk to a semantically-similar neighbour. */
export interface GraphEdge {
  to: string;
  similarity: number;
}

/** chunkId → list of neighbours, sorted DESC by edge similarity. */
export type GraphAdjacency = Map<string, GraphEdge[]>;

// Raw on-disk shapes (only the fields we read).
interface RawGraphEdge {
  from?: unknown;
  to?: unknown;
  similarity?: unknown;
}
interface RawSemanticGraph {
  edges?: RawGraphEdge[];
}

// Lazy cache (like the embeddings bundle). `null` = not yet attempted;
// once loaded it is either a populated adjacency map or an empty map (which
// disables expansion harmlessly — every lookup misses).
let adjacencyCache: GraphAdjacency | null = null;

/**
 * Build an adjacency map from the raw edge list. Pure (no I/O) so it can be
 * unit-tested. Skips malformed edges. Each chunk's neighbour list is sorted
 * DESC by similarity so the caller can take the strongest N with a simple slice.
 */
export function buildAdjacency(edges: RawGraphEdge[]): GraphAdjacency {
  const adj: GraphAdjacency = new Map();
  for (const e of edges) {
    const from = typeof e?.from === "string" ? e.from : null;
    const to = typeof e?.to === "string" ? e.to : null;
    const sim = typeof e?.similarity === "number" ? e.similarity : NaN;
    if (!from || !to || from === to || !Number.isFinite(sim)) continue;
    const list = adj.get(from);
    if (list) list.push({ to, similarity: sim });
    else adj.set(from, [{ to, similarity: sim }]);
  }
  for (const list of adj.values()) {
    list.sort((a, b) => b.similarity - a.similarity);
  }
  return adj;
}

/**
 * Lazily load + cache the semantic-graph adjacency map. Best-effort: a missing
 * or malformed file returns an EMPTY map (expansion silently disabled) and
 * never throws. Mirrors the embeddings cache lifetime (process-lifetime).
 */
export function loadSemanticGraph(forceReload = false): GraphAdjacency {
  if (adjacencyCache && !forceReload) return adjacencyCache;
  try {
    if (!fs.existsSync(SEMANTIC_GRAPH_FILE)) {
      adjacencyCache = new Map();
      return adjacencyCache;
    }
    const raw = JSON.parse(fs.readFileSync(SEMANTIC_GRAPH_FILE, "utf8")) as RawSemanticGraph;
    const edges = Array.isArray(raw?.edges) ? raw.edges : [];
    adjacencyCache = buildAdjacency(edges);
  } catch {
    // Any parse/read error → disable expansion, never break retrieval.
    adjacencyCache = new Map();
  }
  return adjacencyCache;
}

/** Test-only: reset the cache so a fixture graph can be re-loaded. */
export function __resetSemanticGraphCache(): void {
  adjacencyCache = null;
}

/** A scored candidate as seen by the expansion step. `id` is the chunk id. */
export interface GraphCandidate {
  id: string;
  score: number;
}

export interface ExpandOptions {
  /** How many of the top (already-sorted) candidates seed the expansion. */
  seeds: number;
  /** Max neighbours pulled in per seed. */
  hopsPerSeed: number;
  /** Drop edges below this similarity. */
  minSim: number;
  /** Multiplier applied to seedScore × edgeSimilarity for injected neighbours. */
  decay: number;
  /** Hard cap on total injected neighbours (bounds prompt growth). */
  maxInject: number;
}

export interface ExpandResult<T extends GraphCandidate> {
  /** The original pool plus injected neighbours (originals come first, order preserved). */
  pool: T[];
  /** How many neighbours were injected (for debug logging). */
  injected: number;
}

/**
 * PURE 1-hop graph expansion. Given a score-sorted candidate `pool`, the graph
 * `adj`, and a way to materialise a neighbour chunkId into a candidate object,
 * inject up to `maxInject` neighbours of the top `seeds` candidates that are
 * NOT already in the pool.
 *
 * Injected-neighbour scoring blends the seed's own score with the edge
 * similarity and a decay factor:
 *     injectedScore = seedScore × edge.similarity × decay
 * so neighbours can compete in the reranker pool but, because edge.similarity
 * (≤1) and decay (<1) both shrink the score, they do NOT outrank genuine
 * cosine hits. If the same neighbour is reachable from multiple seeds, the
 * HIGHEST blended score wins (and it is injected only once).
 *
 * `makeCandidate(id, score)` returns the candidate object to inject, or null
 * if the neighbour chunk is unknown / unusable (then it is skipped). The
 * function never mutates `pool`; it returns a new array (originals first).
 */
export function expandWithGraph<T extends GraphCandidate>(
  pool: T[],
  adj: GraphAdjacency,
  opts: ExpandOptions,
  makeCandidate: (id: string, score: number) => T | null,
): ExpandResult<T> {
  // Cheap exits — keep flag-OFF / empty-graph paths effectively free.
  if (!adj || adj.size === 0 || pool.length === 0 || opts.maxInject <= 0) {
    return { pool, injected: 0 };
  }

  const present = new Set(pool.map((c) => c.id));
  // Best blended score per candidate neighbour id (highest wins across seeds).
  const bestScore = new Map<string, number>();

  const seedCount = Math.max(0, Math.min(opts.seeds, pool.length));
  for (let i = 0; i < seedCount; i += 1) {
    const seed = pool[i];
    const neighbours = adj.get(seed.id);
    if (!neighbours || neighbours.length === 0) continue;
    let taken = 0;
    for (const edge of neighbours) {
      if (taken >= opts.hopsPerSeed) break;
      if (edge.similarity < opts.minSim) break; // sorted DESC → rest are smaller
      if (present.has(edge.to)) continue; // already a real cosine hit
      taken += 1;
      const blended = seed.score * edge.similarity * opts.decay;
      const prev = bestScore.get(edge.to);
      if (prev === undefined || blended > prev) bestScore.set(edge.to, blended);
    }
  }

  if (bestScore.size === 0) return { pool, injected: 0 };

  // Inject strongest-first, capped at maxInject.
  const ranked = Array.from(bestScore.entries()).sort((a, b) => b[1] - a[1]);
  const injectedCandidates: T[] = [];
  for (const [id, score] of ranked) {
    if (injectedCandidates.length >= opts.maxInject) break;
    const cand = makeCandidate(id, score);
    if (cand) injectedCandidates.push(cand);
  }

  if (injectedCandidates.length === 0) return { pool, injected: 0 };
  return { pool: pool.concat(injectedCandidates), injected: injectedCandidates.length };
}
