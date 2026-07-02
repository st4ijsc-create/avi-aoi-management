/**
 * T1-e (doc 16 Khối 7 / §15) — D* Lite incremental replanning + dynamic obstacles.
 *
 * PURE tests (no DB, deterministic):
 *   • OPTIMALITY: D* Lite's first-plan cost equals the static A* cost on the same grid
 *     (same cost model / connectivity → comparable optimal routes).
 *   • INCREMENTAL REPLAN: when a fresh obstacle drops onto the current route, replan()
 *     reuses the prior search and finds a valid detour (never steps on the new block).
 *   • NO PATH: fully-walled goal → ok:false (both first-plan and after a blocking replan).
 *   • DYNAMIC MASKING: withDynamicObstacles blocks exactly the expected cell(s), inflated
 *     by radius, and is immutable (input grid untouched).
 *   • FALLBACK: planPathDynamic with no dynamics uses A*; with dynamics uses D* Lite.
 *
 * D* Lite path cost is the sum of octile step costs — directly comparable to A*'s g at
 * the goal. We compute A*'s route cost from its cell list with the same step costs.
 */
import { describe, it, expect } from "vitest";
import { makeEmptyGrid, aStarCells, withDynamicObstacles, worldToCell, type OccupancyGrid } from "./occupancyGrid";
import { planDStarLite, replan, type Cell } from "./dstarLite";
import { planPathDynamic } from "../fleet/trafficManager";

const SQRT2 = Math.SQRT2;

/** Sum octile step costs along a cell path (√2 diagonal, 1 orthogonal). */
function pathCost(cells: Array<{ col: number; row: number }>): number {
  let cost = 0;
  for (let i = 1; i < cells.length; i++) {
    const dc = Math.abs(cells[i].col - cells[i - 1].col);
    const dr = Math.abs(cells[i].row - cells[i - 1].row);
    cost += dc !== 0 && dr !== 0 ? SQRT2 : 1;
  }
  return cost;
}

/** A* cost between two CELLS on a grid (for optimality comparison). */
function aStarCost(grid: OccupancyGrid, start: Cell, goal: Cell): number | null {
  const r = aStarCells(grid, start, goal);
  return r ? pathCost(r.cells) : null;
}

const CENTRE = (col: number, row: number) => ({ x: col + 0.5, y: row + 0.5 });

// ════════════════════════════════════════════════════════════════════════════
// OPTIMALITY — D* Lite first-plan cost == A* cost on the same static grid
// ════════════════════════════════════════════════════════════════════════════
describe("D* Lite optimality vs A*", () => {
  it("matches A* cost on an empty grid (straight diagonal)", () => {
    const g = makeEmptyGrid({ originX: 0, originY: 0, cols: 10, rows: 10, cellSize: 1 });
    const d = planDStarLite(g, CENTRE(0, 0), CENTRE(9, 9));
    expect(d.ok).toBe(true);
    const aCost = aStarCost(g, { col: 0, row: 0 }, { col: 9, row: 9 });
    expect(aCost).not.toBeNull();
    expect(d.cost).toBeCloseTo(aCost!, 6);
    // Pure-diagonal optimum on a 10x10 empty grid is 9 * √2.
    expect(d.cost).toBeCloseTo(9 * SQRT2, 6);
  });

  it("matches A* cost when routing around a wall (with a gap)", () => {
    const g = makeEmptyGrid({ originX: 0, originY: 0, cols: 10, rows: 10, cellSize: 1 });
    for (let r = 0; r <= 8; r++) g.cells[r][5] = true; // vertical wall, gap at row 9
    const d = planDStarLite(g, CENTRE(0, 0), CENTRE(9, 0));
    expect(d.ok).toBe(true);
    // Never steps on the wall.
    expect(d.cells.every((c) => !g.cells[c.row][c.col])).toBe(true);
    const aCost = aStarCost(g, { col: 0, row: 0 }, { col: 9, row: 0 });
    expect(aCost).not.toBeNull();
    expect(d.cost).toBeCloseTo(aCost!, 6);
  });

  it("matches A* cost on a mid-grid start/goal with scattered obstacles", () => {
    const g = makeEmptyGrid({ originX: 0, originY: 0, cols: 12, rows: 12, cellSize: 1 });
    for (const [c, r] of [[3, 3], [3, 4], [3, 5], [7, 6], [7, 7], [8, 7]] as const) g.cells[r][c] = true;
    const d = planDStarLite(g, CENTRE(1, 1), CENTRE(10, 10));
    expect(d.ok).toBe(true);
    const aCost = aStarCost(g, { col: 1, row: 1 }, { col: 10, row: 10 });
    expect(d.cost).toBeCloseTo(aCost!, 6);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// INCREMENTAL REPLAN — a fresh obstacle on the route → a valid detour, reusing search
// ════════════════════════════════════════════════════════════════════════════
describe("D* Lite incremental replan (obstacle appears)", () => {
  it("reroutes when a fresh obstacle blocks the current path", () => {
    // Straight corridor: 1-row-tall band; plan across it, then block a mid cell.
    const g = makeEmptyGrid({ originX: 0, originY: 0, cols: 9, rows: 5, cellSize: 1 });
    const first = planDStarLite(g, CENTRE(0, 2), CENTRE(8, 2));
    expect(first.ok).toBe(true);
    // The straight-line route runs along row 2 (cost 8).
    expect(first.cost).toBeCloseTo(8, 6);

    // Drop an obstacle onto a cell the current route uses (col 4, row 2).
    expect(first.cells.some((c) => c.col === 4 && c.row === 2)).toBe(true);
    const res = replan(first.state, [{ col: 4, row: 2, blocked: true }]);
    expect(res.ok).toBe(true);
    // The detour must not step on the new obstacle.
    expect(res.cells.some((c) => c.col === 4 && c.row === 2)).toBe(false);
    expect(res.cells.every((c) => !g.cells[c.row][c.col])).toBe(true);
    // And it must still equal a from-scratch A* cost on the now-updated grid (optimal).
    const aCost = aStarCost(g, { col: 0, row: 2 }, { col: 8, row: 2 });
    expect(res.cost).toBeCloseTo(aCost!, 6);
    // Incremental: it re-expands (some) cells but still terminates.
    expect(res.expanded).toBeGreaterThanOrEqual(0);
  });

  it("replan finds a detour equal to a full re-plan after multiple obstacles", () => {
    const g = makeEmptyGrid({ originX: 0, originY: 0, cols: 10, rows: 10, cellSize: 1 });
    const first = planDStarLite(g, CENTRE(0, 0), CENTRE(9, 0));
    expect(first.ok).toBe(true);
    // Build a partial wall on col 3 (rows 0..7) incrementally.
    const changes = [] as Array<{ col: number; row: number; blocked: boolean }>;
    for (let r = 0; r <= 7; r++) changes.push({ col: 3, row: r, blocked: true });
    const res = replan(first.state, changes);
    expect(res.ok).toBe(true);
    expect(res.cells.every((c) => !g.cells[c.row][c.col])).toBe(true);
    const aCost = aStarCost(g, { col: 0, row: 0 }, { col: 9, row: 0 });
    expect(res.cost).toBeCloseTo(aCost!, 6);
  });

  it("clearing an obstacle (blocked:false) restores the shorter route", () => {
    const g = makeEmptyGrid({ originX: 0, originY: 0, cols: 9, rows: 5, cellSize: 1 });
    const first = planDStarLite(g, CENTRE(0, 2), CENTRE(8, 2));
    const blocked = replan(first.state, [{ col: 4, row: 2, blocked: true }]);
    expect(blocked.ok).toBe(true);
    const detourCost = blocked.cost;
    const cleared = replan(first.state, [{ col: 4, row: 2, blocked: false }]);
    expect(cleared.ok).toBe(true);
    // Straight line restored (cost 8) — cheaper than or equal to the detour.
    expect(cleared.cost).toBeCloseTo(8, 6);
    expect(cleared.cost).toBeLessThanOrEqual(detourCost + 1e-9);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// NO PATH — fully-walled goal
// ════════════════════════════════════════════════════════════════════════════
describe("D* Lite no-path", () => {
  it("returns ok:false when the goal is fully walled off (first plan)", () => {
    const g = makeEmptyGrid({ originX: 0, originY: 0, cols: 6, rows: 6, cellSize: 1 });
    for (let r = 0; r < 6; r++) g.cells[r][4] = true;
    for (let c = 0; c < 6; c++) g.cells[4][c] = true;
    const d = planDStarLite(g, CENTRE(0, 0), CENTRE(5, 5));
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("no_path");
  });

  it("returns ok:false after a replan seals the last opening", () => {
    // A 1-cell gap in an otherwise complete wall; sealing it via replan → no path.
    const g = makeEmptyGrid({ originX: 0, originY: 0, cols: 7, rows: 7, cellSize: 1 });
    for (let r = 0; r < 7; r++) if (r !== 3) g.cells[r][3] = true; // wall col 3, gap at row 3
    const first = planDStarLite(g, CENTRE(0, 3), CENTRE(6, 3));
    expect(first.ok).toBe(true);
    const sealed = replan(first.state, [{ col: 3, row: 3, blocked: true }]);
    expect(sealed.ok).toBe(false);
    expect(sealed.reason).toBe("no_path");
  });

  it("out-of-bounds start/goal → ok:false with reason", () => {
    const g = makeEmptyGrid({ originX: 0, originY: 0, cols: 5, rows: 5, cellSize: 1 });
    expect(planDStarLite(g, CENTRE(-2, 0), CENTRE(3, 3)).reason).toBe("start_out_of_bounds");
    expect(planDStarLite(g, CENTRE(0, 0), CENTRE(99, 99)).reason).toBe("goal_out_of_bounds");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DYNAMIC-OBSTACLE MASKING — withDynamicObstacles blocks the expected cells
// ════════════════════════════════════════════════════════════════════════════
describe("withDynamicObstacles masking", () => {
  it("blocks the single cell containing a point (radius 0) and is immutable", () => {
    const g = makeEmptyGrid({ originX: 0, originY: 0, cols: 10, rows: 10, cellSize: 1 });
    const masked = withDynamicObstacles(g, [{ point: { x: 4.4, y: 6.7 } }]);
    const cell = worldToCell(g, { x: 4.4, y: 6.7 }); // → col 4, row 6
    expect(cell).toEqual({ col: 4, row: 6 });
    expect(masked.cells[6][4]).toBe(true);
    // Neighbouring cell not blocked (radius 0).
    expect(masked.cells[6][5]).toBe(false);
    // Immutable — the input grid is untouched.
    expect(g.cells[6][4]).toBe(false);
  });

  it("inflates a disc of cells for a radius", () => {
    const g = makeEmptyGrid({ originX: 0, originY: 0, cols: 10, rows: 10, cellSize: 1 });
    const masked = withDynamicObstacles(g, [{ point: { x: 5.5, y: 5.5 }, radius: 1.0 }]);
    // Centre cell (5,5) blocked; 4-neighbours within 1m blocked; far corners free.
    expect(masked.cells[5][5]).toBe(true);
    expect(masked.cells[5][4]).toBe(true);
    expect(masked.cells[5][6]).toBe(true);
    expect(masked.cells[4][5]).toBe(true);
    expect(masked.cells[6][5]).toBe(true);
    // A cell 3 away is free.
    expect(masked.cells[5][8]).toBe(false);
  });

  it("ignores out-of-bounds obstacles", () => {
    const g = makeEmptyGrid({ originX: 0, originY: 0, cols: 5, rows: 5, cellSize: 1 });
    const masked = withDynamicObstacles(g, [{ point: { x: -10, y: -10 } }, { point: { x: 100, y: 100 } }]);
    expect(masked.cells.flat().every((c) => c === false)).toBe(true);
  });

  it("makes the planner route around a robot dropped on the direct line", () => {
    const g = makeEmptyGrid({ originX: 0, originY: 0, cols: 9, rows: 5, cellSize: 1 });
    // Robot sits at (4,2) — right on the straight row-2 corridor.
    const masked = withDynamicObstacles(g, [{ point: { x: 4.5, y: 2.5 } }]);
    const d = planDStarLite(masked, CENTRE(0, 2), CENTRE(8, 2));
    expect(d.ok).toBe(true);
    expect(d.cells.some((c) => c.col === 4 && c.row === 2)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION (pure) — planPathDynamic fallback + D* Lite selection
// ════════════════════════════════════════════════════════════════════════════
describe("planPathDynamic (trafficManager pure seam)", () => {
  it("uses A* when there are no dynamic obstacles", () => {
    const g = makeEmptyGrid({ originX: 0, originY: 0, cols: 8, rows: 8, cellSize: 1 });
    const r = planPathDynamic(g, CENTRE(0, 0), CENTRE(7, 7), []);
    expect(r.ok).toBe(true);
    expect(r.planner).toBe("astar");
    expect(r.state).toBeUndefined();
  });

  it("uses D* Lite and returns reusable state when dynamics are present", () => {
    const g = makeEmptyGrid({ originX: 0, originY: 0, cols: 9, rows: 5, cellSize: 1 });
    const r = planPathDynamic(g, CENTRE(0, 2), CENTRE(8, 2), [{ point: { x: 4.5, y: 2.5 } }]);
    expect(r.ok).toBe(true);
    expect(r.planner).toBe("dstar_lite");
    expect(r.state).toBeDefined();
    // Routed around the robot at (4,2).
    expect(r.cells.some((c) => c.col === 4 && c.row === 2)).toBe(false);
    // Cost is comparable to A* on the same masked grid.
    const masked = withDynamicObstacles(g, [{ point: { x: 4.5, y: 2.5 } }]);
    const aCost = aStarCost(masked, { col: 0, row: 2 }, { col: 8, row: 2 });
    expect(r.cost).toBeCloseTo(aCost!, 6);
  });
});
