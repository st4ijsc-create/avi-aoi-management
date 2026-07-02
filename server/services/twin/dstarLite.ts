/**
 * Khối 7 / Khối 2 (doc 16 §11.2 / §7 / §15 T1-e) — D* Lite incremental replanning.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Standard D* Lite (Koenig & Likhachev, 2002 — the "optimized" variant) over the SAME
 * OccupancyGrid representation, cost model, and connectivity as the static A* in
 * occupancyGrid.ts, so a first plan is COST-COMPARABLE to A*:
 *   • 8-connected, diagonal move cost = √2 (octile),
 *   • octile heuristic (admissible + consistent → D* Lite key ordering is correct),
 *   • no corner-cutting on diagonals (both orthogonal cells must be free),
 *   • blocked cells (cells[row][col] === true) are non-traversable; start/goal may sit
 *     on a blocked cell (the device knows where it is) but no intermediate step may.
 *
 * WHY D* Lite over re-running A*: when obstacles APPEAR or MOVE (another robot rolls
 * into the current route), D* Lite REUSES the prior search — it only re-expands cells
 * whose cost actually changed — instead of planning from scratch. `planDStarLite()`
 * does the first plan; `replan()` takes the previous state + the cells that changed and
 * finds the new (still optimal) route incrementally. That reuse is the entire point.
 *
 * D* Lite searches BACKWARD from goal→start (g/rhs are "cost-to-goal"); we walk the
 * greedy min-cost successor chain from start to extract the path, which is why moving
 * the "start" (the robot's current cell) between replans is cheap (the km key offset).
 *
 * HONEST SCOPE: this is GRID-LEVEL D* Lite with robots folded in as blocked CELLS
 * (see withDynamicObstacles in occupancyGrid.ts). It is NOT continuous / kinodynamic
 * planning — no velocity/accel/turning-radius, no time-parameterised trajectories, no
 * reciprocal collision avoidance. It decides a discretised ROUTE for presentation /
 * orchestration state; it does NOT command any device.
 *
 * Pure + deterministic + iteration-capped (no wall-clock, no RNG, stable tie-breaks).
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { OccupancyGrid, Point2D } from "./occupancyGrid";
import { worldToCell, cellToWorld } from "./occupancyGrid";

const SQRT2 = Math.SQRT2;

/** 8-connected neighbour offsets with move cost — IDENTICAL to occupancyGrid A*. */
const NEIGHBORS: Array<{ dc: number; dr: number; cost: number }> = [
  { dc: 1, dr: 0, cost: 1 },
  { dc: -1, dr: 0, cost: 1 },
  { dc: 0, dr: 1, cost: 1 },
  { dc: 0, dr: -1, cost: 1 },
  { dc: 1, dr: 1, cost: SQRT2 },
  { dc: 1, dr: -1, cost: SQRT2 },
  { dc: -1, dr: 1, cost: SQRT2 },
  { dc: -1, dr: -1, cost: SQRT2 },
];

/** Octile heuristic — same as occupancyGrid A* (admissible + consistent). */
function heuristic(c0: number, r0: number, c1: number, r1: number): number {
  const dc = Math.abs(c0 - c1);
  const dr = Math.abs(r0 - r1);
  return dc + dr + (SQRT2 - 2) * Math.min(dc, dr);
}

export interface Cell {
  col: number;
  row: number;
}

/** D* Lite priority key: lexicographic [k1, k2]. */
type Key = readonly [number, number];

/**
 * Persistent D* Lite search state. Opaque to callers except that they pass the whole
 * object back into `replan()` so the incremental machinery can reuse it. `g`/`rhs` are
 * indexed by cell key (row*cols+col); the open list is a lazily-cleaned array PQ (small
 * factory grids — no external heap dependency, mirrors the A* implementation's choice).
 */
export interface DStarLiteState {
  grid: OccupancyGrid;
  start: Cell;
  goal: Cell;
  /** Priority offset accumulated as the start moves between replans (D* Lite `km`). */
  km: number;
  /** g[key] — current estimate of cost-to-goal. Sparse (Infinity when absent). */
  g: Map<number, number>;
  /** rhs[key] — one-step-lookahead cost-to-goal. Sparse (Infinity when absent). */
  rhs: Map<number, number>;
  /** Open queue entries; may contain stale entries (validated on pop). */
  open: Array<{ key: number; k: Key }>;
  /** Membership marker so we don't double-scan the array for `contains`. */
  inOpen: Set<number>;
  /** The cell the last search was seeded from (for km recomputation). */
  lastStart: Cell;
  /** Cumulative cell expansions across all searches on this state (perf). */
  expansions: number;
  /** Per-search expansion cap (safety — deterministic bound). */
  maxExpansions: number;
}

export interface DStarLiteResult {
  ok: boolean;
  /** Ordered world-space waypoints (cell centres), start→goal. Empty when no path. */
  path: Point2D[];
  /** Ordered cell coordinates for debugging/rendering. */
  cells: Cell[];
  /** Total cost of the returned path (comparable to A* g at the goal). */
  cost: number;
  /** Cell expansions performed by THIS call (incremental cost visibility). */
  expanded: number;
  /** Live search state — pass back into `replan()` for incremental updates. */
  state: DStarLiteState;
  reason?: string;
}

const cellKey = (grid: OccupancyGrid, col: number, row: number) => row * grid.cols + col;

function inBounds(grid: OccupancyGrid, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < grid.cols && row < grid.rows;
}

const getG = (s: DStarLiteState, k: number): number => s.g.get(k) ?? Infinity;
const getRhs = (s: DStarLiteState, k: number): number => s.rhs.get(k) ?? Infinity;

/** Key comparison — lexicographic [k1, k2] with a tiny epsilon (float √2 costs). */
const EPS = 1e-9;
function keyLess(a: Key, b: Key): boolean {
  if (a[0] < b[0] - EPS) return true;
  if (a[0] > b[0] + EPS) return false;
  return a[1] < b[1] - EPS;
}

/**
 * Traversal cost between two ADJACENT cells given the grid. Infinity when the move is
 * illegal (target blocked, or a diagonal that would cut an obstacle corner). Start/goal
 * occupancy is handled by the caller (endpoints allowed on a blocked cell). This is the
 * single source of "cost" used by both the g/rhs update and the path extraction, so the
 * search and the extracted route agree.
 */
function moveCost(
  grid: OccupancyGrid,
  fromC: number,
  fromR: number,
  toC: number,
  toR: number,
  step: { dc: number; dr: number; cost: number },
  endpoints: { start: number; goal: number },
): number {
  const fromKey = cellKey(grid, fromC, fromR);
  const toKey = cellKey(grid, toC, toR);
  // An intermediate cell (neither start nor goal) that is blocked is impassable.
  const toBlocked = grid.cells[toR][toC] && toKey !== endpoints.start && toKey !== endpoints.goal;
  const fromBlocked = grid.cells[fromR][fromC] && fromKey !== endpoints.start && fromKey !== endpoints.goal;
  if (toBlocked || fromBlocked) return Infinity;
  // No corner cutting on diagonals: both shared-orthogonal cells must be free.
  if (step.dc !== 0 && step.dr !== 0) {
    if (grid.cells[fromR][toC] || grid.cells[toR][fromC]) return Infinity;
  }
  return step.cost;
}

/** D* Lite CalcKey for a cell (backward search — h measured from START). */
function calcKey(s: DStarLiteState, col: number, row: number): Key {
  const k = cellKey(s.grid, col, row);
  const min = Math.min(getG(s, k), getRhs(s, k));
  const h = heuristic(s.start.col, s.start.row, col, row);
  return [min + h + s.km, min];
}

function pushOpen(s: DStarLiteState, col: number, row: number): void {
  const k = cellKey(s.grid, col, row);
  s.open.push({ key: k, k: calcKey(s, col, row) });
  s.inOpen.add(k);
}

/** Remove a cell's OPEN membership (entries are lazily discarded on pop). */
function removeOpen(s: DStarLiteState, k: number): void {
  s.inOpen.delete(k);
}

/** Pop the min-key OPEN entry that is still valid (its cell is still in inOpen). */
function popMin(s: DStarLiteState): { col: number; row: number; k: Key } | null {
  while (s.open.length > 0) {
    let bestIdx = -1;
    for (let i = 0; i < s.open.length; i++) {
      if (!s.inOpen.has(s.open[i].key)) continue; // stale
      if (bestIdx < 0 || keyLess(s.open[i].k, s.open[bestIdx].k) ||
          (!keyLess(s.open[bestIdx].k, s.open[i].k) && s.open[i].key < s.open[bestIdx].key)) {
        bestIdx = i;
      }
    }
    if (bestIdx < 0) { s.open.length = 0; return null; } // only stale entries left
    const e = s.open.splice(bestIdx, 1)[0];
    if (!s.inOpen.has(e.key)) continue; // became stale between scan and splice — skip
    s.inOpen.delete(e.key);
    const col = e.key % s.grid.cols;
    const row = Math.floor(e.key / s.grid.cols);
    return { col, row, k: e.k };
  }
  return null;
}

/** Peek the min VALID key without removing (for the ComputeShortestPath loop guard). */
function topKey(s: DStarLiteState): Key {
  let best: Key | null = null;
  for (let i = 0; i < s.open.length; i++) {
    if (!s.inOpen.has(s.open[i].key)) continue;
    if (best === null || keyLess(s.open[i].k, best)) best = s.open[i].k;
  }
  return best ?? [Infinity, Infinity];
}

const endpointKeys = (s: DStarLiteState) => ({
  start: cellKey(s.grid, s.start.col, s.start.row),
  goal: cellKey(s.grid, s.goal.col, s.goal.row),
});

/** UpdateVertex — recompute rhs (except goal) and (re)insert/remove from OPEN. */
function updateVertex(s: DStarLiteState, col: number, row: number): void {
  const k = cellKey(s.grid, col, row);
  const ep = endpointKeys(s);
  if (k !== ep.goal) {
    // rhs(u) = min over successors s' of ( cost(u, s') + g(s') ).
    let best = Infinity;
    for (const nb of NEIGHBORS) {
      const nc = col + nb.dc;
      const nr = row + nb.dr;
      if (!inBounds(s.grid, nc, nr)) continue;
      const c = moveCost(s.grid, col, row, nc, nr, nb, ep);
      if (c === Infinity) continue;
      const cand = c + getG(s, cellKey(s.grid, nc, nr));
      if (cand < best) best = cand;
    }
    if (best === Infinity) s.rhs.delete(k); else s.rhs.set(k, best);
  }
  removeOpen(s, k);
  if (Math.abs(getG(s, k) - getRhs(s, k)) > EPS) pushOpen(s, col, row);
}

/**
 * ComputeShortestPath — the core D* Lite propagation. Expands locally-inconsistent
 * cells (g ≠ rhs) in key order until the start is consistent and no OPEN cell has a
 * smaller key than the start. Bounded by maxExpansions (deterministic safety cap).
 * Returns true if it terminated cleanly, false if it hit the cap.
 */
function computeShortestPath(s: DStarLiteState): boolean {
  let iter = 0;
  const startKey = cellKey(s.grid, s.start.col, s.start.row);
  while (true) {
    const top = topKey(s);
    const startConsistent = Math.abs(getG(s, startKey) - getRhs(s, startKey)) <= EPS;
    const startKcalc = calcKey(s, s.start.col, s.start.row);
    if (!keyLess(top, startKcalc) && startConsistent) break;

    if (iter++ > s.maxExpansions) return false;
    s.expansions++;

    const u = popMin(s);
    if (!u) break;
    const uKey = cellKey(s.grid, u.col, u.row);
    const kNew = calcKey(s, u.col, u.row);

    if (keyLess(u.k, kNew)) {
      // Key was under-estimated (start moved) → reinsert with the corrected key.
      pushOpen(s, u.col, u.row);
      continue;
    }

    const gU = getG(s, uKey);
    const rhsU = getRhs(s, uKey);
    if (gU > rhsU + EPS) {
      // Over-consistent → lower g to rhs and relax predecessors.
      if (rhsU === Infinity) s.g.delete(uKey); else s.g.set(uKey, rhsU);
      for (const nb of NEIGHBORS) {
        const pc = u.col + nb.dc;
        const pr = u.row + nb.dr;
        if (!inBounds(s.grid, pc, pr)) continue;
        updateVertex(s, pc, pr);
      }
    } else {
      // Under-consistent → raise g to Infinity and re-evaluate u + predecessors.
      s.g.delete(uKey);
      updateVertex(s, u.col, u.row);
      for (const nb of NEIGHBORS) {
        const pc = u.col + nb.dc;
        const pr = u.row + nb.dr;
        if (!inBounds(s.grid, pc, pr)) continue;
        updateVertex(s, pc, pr);
      }
    }
  }
  return true;
}

/**
 * Extract the start→goal cell path by greedily following the min-cost successor
 * (cost(u,s') + g(s')) from the start. Returns null if start is unreachable
 * (g(start) === Infinity) or a cost-consistent successor cannot be found (cap/cycle
 * guard). Deterministic tie-break: lowest (cost+g), then lowest cell key.
 */
function extractPath(s: DStarLiteState): { cells: Cell[]; cost: number } | null {
  const startKey = cellKey(s.grid, s.start.col, s.start.row);
  if (getG(s, startKey) === Infinity) return null;
  const cells: Cell[] = [{ col: s.start.col, row: s.start.row }];
  const ep = endpointKeys(s);
  let cur: Cell = { col: s.start.col, row: s.start.row };
  let total = 0;
  const guard = s.grid.cols * s.grid.rows + 1; // no path is longer than every cell once
  for (let step = 0; step < guard; step++) {
    if (cur.col === s.goal.col && cur.row === s.goal.row) return { cells, cost: total };
    let best: { col: number; row: number; move: number } | null = null;
    let bestKey = Infinity;
    for (const nb of NEIGHBORS) {
      const nc = cur.col + nb.dc;
      const nr = cur.row + nb.dr;
      if (!inBounds(s.grid, nc, nr)) continue;
      const c = moveCost(s.grid, cur.col, cur.row, nc, nr, nb, ep);
      if (c === Infinity) continue;
      const val = c + getG(s, cellKey(s.grid, nc, nr));
      const nKey = cellKey(s.grid, nc, nr);
      if (best === null || val < best.move - EPS || (Math.abs(val - best.move) <= EPS && nKey < bestKey)) {
        best = { col: nc, row: nr, move: val };
        bestKey = nKey;
      }
    }
    if (!best || best.move === Infinity) return null;
    total += best.move - getG(s, cellKey(s.grid, best.col, best.row));
    cur = { col: best.col, row: best.row };
    cells.push(cur);
  }
  return null; // exceeded guard → treat as no path (cycle safety)
}

function emptyResult(state: DStarLiteState, reason: string): DStarLiteResult {
  return { ok: false, path: [], cells: [], cost: 0, expanded: 0, state, reason };
}

/**
 * First plan with D* Lite from world point `from` to world point `to` over `grid`.
 * Initialises the search state (rhs(goal)=0, goal in OPEN) and runs ComputeShortestPath
 * once. Returns the route AND the reusable `state` — feed changed cells into `replan()`
 * for incremental updates without re-planning from scratch.
 */
export function planDStarLite(
  grid: OccupancyGrid,
  from: Point2D,
  to: Point2D,
  opts?: { maxExpansions?: number },
): DStarLiteResult {
  const start = worldToCell(grid, from);
  const goal = worldToCell(grid, to);
  const state: DStarLiteState = {
    grid,
    start,
    goal,
    km: 0,
    g: new Map(),
    rhs: new Map(),
    open: [],
    inOpen: new Set(),
    lastStart: { ...start },
    expansions: 0,
    maxExpansions: opts?.maxExpansions ?? grid.cols * grid.rows * 8,
  };
  if (!inBounds(grid, start.col, start.row)) return emptyResult(state, "start_out_of_bounds");
  if (!inBounds(grid, goal.col, goal.row)) return emptyResult(state, "goal_out_of_bounds");

  // Initialize: rhs(goal) = 0, insert goal into OPEN.
  state.rhs.set(cellKey(grid, goal.col, goal.row), 0);
  pushOpen(state, goal.col, goal.row);

  const beforeExp = state.expansions;
  const ok = computeShortestPath(state);
  const expanded = state.expansions - beforeExp;
  if (!ok) return { ...emptyResult(state, "expansion_cap"), expanded };

  const path = extractPath(state);
  if (!path) return { ...emptyResult(state, "no_path"), expanded };
  return {
    ok: true,
    path: path.cells.map((c) => cellToWorld(grid, c.col, c.row)),
    cells: path.cells,
    cost: path.cost,
    expanded,
    state,
  };
}

/** A cell whose occupancy changed since the last plan (dynamic obstacle appear/clear). */
export interface CellChange {
  col: number;
  row: number;
  /** New occupancy: true = now BLOCKED, false = now FREE. */
  blocked: boolean;
}

export interface ReplanOptions {
  /**
   * The robot's current cell (world→cell done by caller as {col,row}) if it has moved
   * since the last plan. Supplying it applies the D* Lite `km` offset so prior search
   * effort is preserved as the start advances. Omit to keep the original start.
   */
  newStart?: Cell;
}

/**
 * INCREMENTAL replan. Applies `changedCells` to the grid, updates only the affected
 * vertices, optionally advances the start (km offset), and re-runs ComputeShortestPath —
 * reusing all prior g/rhs values. This is why D* Lite beats re-running A* when a robot
 * appears on the route: only the changed region is re-expanded.
 *
 * Mutates `state.grid.cells` in place to reflect the new occupancy (the state owns its
 * grid). Returns the new route + the (same, updated) state for the next replan.
 */
export function replan(
  state: DStarLiteState,
  changedCells: CellChange[],
  opts?: ReplanOptions,
): DStarLiteResult {
  const grid = state.grid;

  // Advance the start (moving-robot case): km += h(lastStart, newStart), then re-seed.
  if (opts?.newStart && inBounds(grid, opts.newStart.col, opts.newStart.row)) {
    state.km += heuristic(state.lastStart.col, state.lastStart.row, opts.newStart.col, opts.newStart.row);
    state.start = { col: opts.newStart.col, row: opts.newStart.row };
    state.lastStart = { ...state.start };
  }

  // Apply each edge-cost change: flip the cell, then UpdateVertex the cell + its
  // neighbours (edge costs into/out of a toggled cell all change).
  const beforeExp = state.expansions;
  for (const ch of changedCells) {
    if (!inBounds(grid, ch.col, ch.row)) continue;
    if (grid.cells[ch.row][ch.col] === ch.blocked) continue; // no actual change
    grid.cells[ch.row][ch.col] = ch.blocked;
    updateVertex(state, ch.col, ch.row);
    for (const nb of NEIGHBORS) {
      const nc = ch.col + nb.dc;
      const nr = ch.row + nb.dr;
      if (!inBounds(grid, nc, nr)) continue;
      updateVertex(state, nc, nr);
    }
  }

  const ok = computeShortestPath(state);
  const expanded = state.expansions - beforeExp;
  if (!ok) return { ...emptyResult(state, "expansion_cap"), expanded };

  const path = extractPath(state);
  if (!path) return { ...emptyResult(state, "no_path"), expanded };
  return {
    ok: true,
    path: path.cells.map((c) => cellToWorld(grid, c.col, c.row)),
    cells: path.cells,
    cost: path.cost,
    expanded,
    state,
  };
}
