/**
 * Space-time route planner — SYNAPSE §5.4.3 (doc 33 §3.6 / H4 Traffic).
 *
 * Earliest-arrival search over a node-edge graph WITH a time axis: entering an edge requires its
 * space-time slot to be free (checked against the reservation table); if busy, the robot WAITS at
 * the current node until the edge clears. Returns the route (edge chain + entry/exit times) or null.
 * Pure + deterministic (bounded by a horizon). Additive; complements SpaceTimeReservations.
 */
import { overlaps, type SpaceTimeReservations, type TimeInterval } from "./spaceTimeReservation";

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  /** Traversal time (ms/ticks). */
  travelMs: number;
}

export interface RouteGraph {
  edges: GraphEdge[];
}

export interface RouteStep {
  edgeId: string;
  from: string;
  to: string;
  tIn: number;
  tOut: number;
}

export interface PlannedRoute {
  path: RouteStep[];
  arrivalTs: number;
}

/** Earliest depart time ≥ fromTs at which `[t, t+travelMs]` on an edge is free. null if none by horizon. */
export function earliestFreeDeparture(
  intervals: readonly TimeInterval[],
  robotId: string,
  fromTs: number,
  travelMs: number,
  buffer: number,
  horizon: number,
): number | null {
  const others = intervals.filter((iv) => iv.robotId !== robotId).sort((a, b) => a.start - b.start);
  let t = fromTs;
  // At most one advance per blocking interval (+ a final check).
  for (let i = 0; i <= others.length && t <= horizon; i++) {
    const slot: TimeInterval = { start: t, end: t + travelMs, robotId };
    const blocker = others.find((iv) => overlaps(iv, slot, buffer));
    if (!blocker) return t;
    t = blocker.end + buffer + 1; // wait until the blocker clears
  }
  return t <= horizon ? t : null;
}

export interface PlanOptions {
  robotId: string;
  departTs?: number;
  /** Reservation table to avoid (optional → no time conflicts). */
  reservations?: SpaceTimeReservations;
  bufferMs?: number;
  /** Search horizon (ms) — refuse a route that would arrive after departTs + horizon. */
  horizonMs?: number;
}

/**
 * Plan the earliest-arrival space-time route from `start` to `goal`. Waits at nodes when an edge
 * is reserved. Returns null when goal is unreachable within the horizon.
 */
export function planSpaceTimeRoute(graph: RouteGraph, start: string, goal: string, opts: PlanOptions): PlannedRoute | null {
  const departTs = opts.departTs ?? 0;
  const buffer = opts.bufferMs ?? 1500;
  const horizon = departTs + (opts.horizonMs ?? 3_600_000);
  const adj = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    const list = adj.get(e.from) ?? [];
    list.push(e);
    adj.set(e.from, list);
  }

  const best = new Map<string, number>([[start, departTs]]);
  const parent = new Map<string, RouteStep>();
  // Simple priority list (small graphs); pop the min-arrival node.
  const open: Array<{ node: string; arrival: number }> = [{ node: start, arrival: departTs }];

  while (open.length > 0) {
    open.sort((a, b) => a.arrival - b.arrival);
    const cur = open.shift()!;
    if (cur.node === goal) break;
    if (cur.arrival > (best.get(cur.node) ?? Infinity)) continue;

    for (const edge of adj.get(cur.node) ?? []) {
      const intervals = opts.reservations?.onEdge(edge.id) ?? [];
      const depart = earliestFreeDeparture(intervals, opts.robotId, cur.arrival, edge.travelMs, buffer, horizon);
      if (depart === null) continue;
      const arrival = depart + edge.travelMs;
      if (arrival > horizon) continue;
      if (arrival < (best.get(edge.to) ?? Infinity)) {
        best.set(edge.to, arrival);
        parent.set(edge.to, { edgeId: edge.id, from: edge.from, to: edge.to, tIn: depart, tOut: arrival });
        open.push({ node: edge.to, arrival });
      }
    }
  }

  if (!best.has(goal)) return null;
  // Reconstruct path.
  const path: RouteStep[] = [];
  let node = goal;
  while (node !== start) {
    const step = parent.get(node);
    if (!step) return null; // start unreachable
    path.unshift(step);
    node = step.from;
  }
  return { path, arrivalTs: best.get(goal)! };
}
