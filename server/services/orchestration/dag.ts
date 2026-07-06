/**
 * Task DAG + topological check — SYNAPSE §5.1.4 (doc 33 §3.6 / F8 · H3 Durable orchestration).
 *
 * The FOE compiler today validates a sequence/parallel/branch TREE; SYNAPSE compiles a recipe
 * into a DAG with a topological check (cycles forbidden — a data/physical dependency graph). This
 * is the pure DAG primitive: build, validate (missing refs + cycle detection via Kahn), and a
 * ready-set for scheduling (which nodes have all deps satisfied). Additive — a later wave wires
 * it into the compiler; F8 delivers + tests the graph algorithm.
 */

export interface DagNode {
  id: string;
  /** Ids this node depends on (must complete first). */
  deps: string[];
}

export interface DagValidation {
  valid: boolean;
  errors: string[];
  /** Topological order when valid (empty when invalid). */
  order: string[];
  /** The cycle when one exists (node ids), else []. */
  cycle: string[];
}

/** Validate a DAG: unique ids, all dep refs exist, no cycle. Returns a topo order when valid. */
export function validateDag(nodes: readonly DagNode[]): DagValidation {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) errors.push(`duplicate node id "${n.id}"`);
    ids.add(n.id);
  }
  for (const n of nodes) {
    for (const d of n.deps) {
      if (!ids.has(d)) errors.push(`node "${n.id}" depends on missing "${d}"`);
    }
  }
  if (errors.length > 0) return { valid: false, errors, order: [], cycle: [] };

  // Kahn's algorithm for topological sort + cycle detection.
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const n of nodes) {
    for (const d of n.deps) {
      adj.get(d)!.push(n.id);
      indeg.set(n.id, (indeg.get(n.id) ?? 0) + 1);
    }
  }
  const queue = [...indeg.entries()].filter(([, v]) => v === 0).map(([k]) => k).sort();
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id)!) {
      const v = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, v);
      if (v === 0) {
        // keep deterministic order
        queue.push(next);
        queue.sort();
      }
    }
  }
  if (order.length !== nodes.length) {
    const cycle = [...indeg.entries()].filter(([, v]) => v > 0).map(([k]) => k);
    return { valid: false, errors: ["cycle detected (DAG must be acyclic)"], order: [], cycle };
  }
  return { valid: true, errors: [], order, cycle: [] };
}

/**
 * Given the set of completed node ids, return the nodes whose deps are ALL satisfied and which
 * are not yet done — the "ready set" a scheduler can dispatch in parallel.
 */
export function readySet(nodes: readonly DagNode[], completed: ReadonlySet<string>): string[] {
  return nodes
    .filter((n) => !completed.has(n.id) && n.deps.every((d) => completed.has(d)))
    .map((n) => n.id)
    .sort();
}
