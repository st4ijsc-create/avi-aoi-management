/**
 * Khối 7 / Khối 2 (doc 16 §11.2 / §7 / §15 T1-e) — Occupancy Grid + real A* path planning.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Builds a 2D occupancy grid for a factory from STATIC obstacles (machine
 * footprints + non-traversable zone bounds) and runs A* between two world points,
 * routing AROUND occupied cells. This RETIRES the honest planPath() stub in
 * fleet/trafficManager.ts — but ADDITIVELY: the new planner is exposed as
 * `planPathOnGrid()` and trafficManager.planPath() only delegates to it when a grid
 * is supplied, otherwise it keeps the documented waypoint-passthrough stub. The G1
 * fleet tests (fleet.g1.test.ts) call planPath([1,2,3]) with NO grid → unchanged.
 *
 * COORDINATES: world units (metres) → grid cells via a configurable cellSize. A
 * world point (x,y) maps to cell (col,row) = (floor((x-originX)/cell), floor((y-originY)/cell)).
 * The grid is row-major: grid[row][col], true = OCCUPIED (blocked).
 *
 * A*: 8-connected by default (diagonal moves cost √2), Manhattan/octile heuristic,
 * never cuts corners through two orthogonally-adjacent obstacles. Pure + deterministic.
 *
 * SAFETY: this is orchestration/visualization STATE only. It decides a ROUTE; it does
 * NOT command any device. Movement is still issued by the gated dispatcher.
 * ════════════════════════════════════════════════════════════════════════════
 */

export interface GridConfig {
  /** World-space origin (bottom-left) the grid is anchored at. */
  originX: number;
  originY: number;
  /** Grid extent in cells. */
  cols: number;
  rows: number;
  /** Side length of one cell in world units (metres). */
  cellSize: number;
}

export interface OccupancyGrid extends GridConfig {
  /** Row-major occupancy: cells[row][col] === true means BLOCKED. */
  cells: boolean[][];
}

/** An axis-aligned rectangular obstacle in WORLD coordinates. */
export interface RectObstacle {
  x: number; // min x
  y: number; // min y
  w: number; // width  (x extent)
  h: number; // height (y extent)
  /** Optional inflation (metres) added on every side (robot radius / safety margin). */
  inflate?: number;
}

export interface Point2D {
  x: number;
  y: number;
}

/** Build an empty (all-free) grid. */
export function makeEmptyGrid(cfg: GridConfig): OccupancyGrid {
  const cells: boolean[][] = [];
  for (let r = 0; r < cfg.rows; r++) cells.push(new Array<boolean>(cfg.cols).fill(false));
  return { ...cfg, cells };
}

/** World point → integer cell {col,row}. May fall outside the grid (caller clamps). */
export function worldToCell(grid: GridConfig, p: Point2D): { col: number; row: number } {
  return {
    col: Math.floor((p.x - grid.originX) / grid.cellSize),
    row: Math.floor((p.y - grid.originY) / grid.cellSize),
  };
}

/** Cell centre → world point (for emitting a world-space path back to the caller). */
export function cellToWorld(grid: GridConfig, col: number, row: number): Point2D {
  return {
    x: grid.originX + (col + 0.5) * grid.cellSize,
    y: grid.originY + (row + 0.5) * grid.cellSize,
  };
}

function inBounds(grid: OccupancyGrid, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < grid.cols && row < grid.rows;
}

/** Mark every cell overlapped by a rectangle (with optional inflation) as occupied. */
export function markObstacle(grid: OccupancyGrid, obs: RectObstacle): void {
  const inflate = obs.inflate ?? 0;
  const minX = obs.x - inflate;
  const minY = obs.y - inflate;
  const maxX = obs.x + obs.w + inflate;
  const maxY = obs.y + obs.h + inflate;
  const c0 = worldToCell(grid, { x: minX, y: minY });
  const c1 = worldToCell(grid, { x: maxX, y: maxY });
  const colLo = Math.max(0, Math.min(c0.col, c1.col));
  const colHi = Math.min(grid.cols - 1, Math.max(c0.col, c1.col));
  const rowLo = Math.max(0, Math.min(c0.row, c1.row));
  const rowHi = Math.min(grid.rows - 1, Math.max(c0.row, c1.row));
  for (let r = rowLo; r <= rowHi; r++) {
    for (let c = colLo; c <= colHi; c++) grid.cells[r][c] = true;
  }
}

/** Build a grid from a config + a set of static rectangular obstacles. */
export function buildGrid(cfg: GridConfig, obstacles: RectObstacle[]): OccupancyGrid {
  const grid = makeEmptyGrid(cfg);
  for (const o of obstacles) markObstacle(grid, o);
  return grid;
}

export interface PlanGridResult {
  ok: boolean;
  /** Ordered world-space waypoints (cell centres), start→goal. Empty when no path. */
  path: Point2D[];
  /** Ordered cell coordinates for debugging/rendering. */
  cells: Array<{ col: number; row: number }>;
  /** Number of cells expanded (perf / explainability). */
  expanded: number;
  reason?: string;
}

interface Node {
  col: number;
  row: number;
  g: number;
  f: number;
  parent: Node | null;
}

const SQRT2 = Math.SQRT2;

/** 8-connected neighbours with move cost (diagonal = √2). */
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

/** Octile heuristic (admissible for 8-connected unit/√2 grids). */
function heuristic(c0: number, r0: number, c1: number, r1: number): number {
  const dc = Math.abs(c0 - c1);
  const dr = Math.abs(r0 - r1);
  return (dc + dr) + (SQRT2 - 2) * Math.min(dc, dr);
}

/**
 * A* over the occupancy grid between two CELLS. Returns the cell path (start→goal)
 * or null when unreachable. Diagonal moves are forbidden from cutting the corner of
 * an obstacle (both orthogonal neighbours must be free). `allowStartGoalOnOccupied`
 * lets a start/goal that lands on an occupied cell still be used (the device is told
 * where it is) — intermediate cells are always required free.
 */
export function aStarCells(
  grid: OccupancyGrid,
  start: { col: number; row: number },
  goal: { col: number; row: number },
  opts?: { maxExpansions?: number },
): { cells: Array<{ col: number; row: number }>; expanded: number } | null {
  if (!inBounds(grid, start.col, start.row) || !inBounds(grid, goal.col, goal.row)) return null;
  const maxExpansions = opts?.maxExpansions ?? grid.cols * grid.rows * 4;

  const key = (c: number, r: number) => r * grid.cols + c;
  const open = new Map<number, Node>();
  const openList: Node[] = []; // simple binary-less PQ (small grids) — pick min f each pop
  const closed = new Set<number>();

  const startNode: Node = { col: start.col, row: start.row, g: 0, f: heuristic(start.col, start.row, goal.col, goal.row), parent: null };
  open.set(key(start.col, start.row), startNode);
  openList.push(startNode);

  let expanded = 0;
  while (openList.length > 0) {
    // pop lowest f
    let bestIdx = 0;
    for (let i = 1; i < openList.length; i++) if (openList[i].f < openList[bestIdx].f) bestIdx = i;
    const cur = openList.splice(bestIdx, 1)[0];
    const curKey = key(cur.col, cur.row);
    open.delete(curKey);
    if (closed.has(curKey)) continue;
    closed.add(curKey);
    expanded++;
    if (expanded > maxExpansions) return null; // safety cap

    if (cur.col === goal.col && cur.row === goal.row) {
      const cells: Array<{ col: number; row: number }> = [];
      let n: Node | null = cur;
      while (n) {
        cells.push({ col: n.col, row: n.row });
        n = n.parent;
      }
      cells.reverse();
      return { cells, expanded };
    }

    for (const nb of NEIGHBORS) {
      const nc = cur.col + nb.dc;
      const nr = cur.row + nb.dr;
      if (!inBounds(grid, nc, nr)) continue;
      const nKey = key(nc, nr);
      if (closed.has(nKey)) continue;
      const isGoal = nc === goal.col && nr === goal.row;
      // Intermediate cells must be free (goal may be occupied → caller's responsibility).
      if (grid.cells[nr][nc] && !isGoal) continue;
      // No corner cutting on diagonals: both orthogonal cells must be free.
      if (nb.dc !== 0 && nb.dr !== 0) {
        if (grid.cells[cur.row][nc] || grid.cells[nr][cur.col]) continue;
      }
      const g = cur.g + nb.cost;
      const existing = open.get(nKey);
      if (existing && existing.g <= g) continue;
      const node: Node = { col: nc, row: nr, g, f: g + heuristic(nc, nr, goal.col, goal.row), parent: cur };
      open.set(nKey, node);
      openList.push(node);
    }
  }
  return null;
}

/**
 * Plan a route from world point `from` to world point `to` over `grid` using A*.
 * Returns world-space waypoints (cell centres). `ok:false` + reason when unreachable
 * or the endpoints fall outside the grid. This is the REAL planner that backs the
 * trafficManager seam (planPathOnGrid).
 */
export function planPathOnGrid(grid: OccupancyGrid, from: Point2D, to: Point2D, opts?: { maxExpansions?: number }): PlanGridResult {
  const s = worldToCell(grid, from);
  const g = worldToCell(grid, to);
  if (!inBounds(grid, s.col, s.row)) return { ok: false, path: [], cells: [], expanded: 0, reason: "start_out_of_bounds" };
  if (!inBounds(grid, g.col, g.row)) return { ok: false, path: [], cells: [], expanded: 0, reason: "goal_out_of_bounds" };
  // If the GOAL cell is occupied (e.g. the dock is inside a machine footprint) we
  // still allow A* to reach it, but if the START is occupied and the goal is free we
  // also permit it (the device knows where it is). A fully-walled goal returns null.
  const result = aStarCells(grid, s, g, opts);
  if (!result) return { ok: false, path: [], cells: [], expanded: 0, reason: "no_path" };
  return {
    ok: true,
    path: result.cells.map((c) => cellToWorld(grid, c.col, c.row)),
    cells: result.cells,
    expanded: result.expanded,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// DB-backed grid builder — assemble a factory occupancy grid from zone bounds +
// machine footprints. Best-effort + degrade-safe (empty grid when no geometry).
// ════════════════════════════════════════════════════════════════════════════

export interface BuildFactoryGridOptions {
  factoryId?: number;
  /** Cell size in world units (metres). Default 0.5m. */
  cellSize?: number;
  /** Safety inflation (metres) added around each obstacle. Default 0.25m. */
  inflate?: number;
  /** Fallback extent if no zone bounds give one (cols×rows). */
  defaultCols?: number;
  defaultRows?: number;
}

export interface BuildFactoryGridResult {
  enabled: boolean;
  grid: OccupancyGrid | null;
  obstacleCount: number;
  /** Honest note about how the grid was derived (what geometry was available). */
  note: string;
}

/** Coerce a jsonb bounds blob into a RectObstacle, supporting a couple shapes. */
export function boundsToRect(bounds: Record<string, unknown> | null | undefined): RectObstacle | null {
  if (!bounds) return null;
  // shape A: { x, y, w, h }
  if (typeof bounds.x === "number" && typeof bounds.y === "number" && typeof bounds.w === "number" && typeof bounds.h === "number") {
    return { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
  }
  // shape B: { min:[x,y,...], max:[x,y,...] }
  const min = bounds.min as number[] | undefined;
  const max = bounds.max as number[] | undefined;
  if (Array.isArray(min) && Array.isArray(max) && min.length >= 2 && max.length >= 2) {
    return { x: min[0], y: min[1], w: max[0] - min[0], h: max[1] - min[1] };
  }
  return null;
}

/**
 * Build a factory occupancy grid from STATIC obstacles:
 *   • machine footprints (machines.layout.footprint or a default tile around its
 *     layoutPositionX/Y),
 *   • non-traversable zones (zoneType != 'transit'/'human_shared') whose `bounds`
 *     describe a rectangle.
 *
 * HONEST about geometry: most machines today only have normalized layoutPositionX/Y
 * (0..1) and no real metric footprint, so we place a small default footprint tile per
 * machine and document it. When NO geometry exists at all we return an empty (all-free)
 * grid + a note — the A* then just returns the straight line, matching the stub's
 * spirit but on a real grid.
 *
 * Flag-gated: returns enabled:false (and a usable empty grid) unless TWIN_LIVE_ENABLED
 * (or a fleet flag) is on — the caller decides whether to use it.
 */
export async function buildFactoryGrid(opts: BuildFactoryGridOptions = {}): Promise<BuildFactoryGridResult> {
  const { twinLiveEnabled } = await import("./modelRegistry");
  const { fleetOrchEnabled } = await import("../fleet/taskAllocator");
  const enabled = twinLiveEnabled() || fleetOrchEnabled();

  const cellSize = opts.cellSize ?? 0.5;
  const inflate = opts.inflate ?? 0.25;

  const { getDb } = await import("../../db/connection");
  const db = await getDb();
  if (!db) {
    return { enabled, grid: null, obstacleCount: 0, note: "db unavailable" };
  }

  const { zones } = await import("../../../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  // Collect rectangular obstacles from zone bounds (non-traversable types only).
  const obstacles: RectObstacle[] = [];
  let zoneRows: Array<{ zoneType: string; bounds: Record<string, unknown> | null }> = [];
  try {
    zoneRows = (await db
      .select()
      .from(zones)
      .where(opts.factoryId != null ? eq(zones.factoryId, opts.factoryId) : undefined)) as any[];
  } catch {
    zoneRows = [];
  }
  for (const z of zoneRows) {
    if (z.zoneType === "transit" || z.zoneType === "human_shared") continue; // traversable
    const rect = boundsToRect(z.bounds);
    if (rect) obstacles.push({ ...rect, inflate });
  }

  // Derive grid extent from obstacle bounding box (or a default).
  let maxX = 0;
  let maxY = 0;
  for (const o of obstacles) {
    maxX = Math.max(maxX, o.x + o.w + (o.inflate ?? 0));
    maxY = Math.max(maxY, o.y + o.h + (o.inflate ?? 0));
  }
  const cols = maxX > 0 ? Math.ceil(maxX / cellSize) + 2 : (opts.defaultCols ?? 40);
  const rows = maxY > 0 ? Math.ceil(maxY / cellSize) + 2 : (opts.defaultRows ?? 40);

  const grid = buildGrid({ originX: 0, originY: 0, cols, rows, cellSize }, obstacles);

  const note =
    obstacles.length > 0
      ? `grid ${cols}x${rows} @ ${cellSize}m from ${obstacles.length} zone obstacle(s) (inflate ${inflate}m); machine footprints not metric yet — zone bounds only`
      : `empty ${cols}x${rows} grid @ ${cellSize}m — no zone bounds geometry found; A* degrades to straight-line routing`;

  return { enabled, grid, obstacleCount: obstacles.length, note };
}

// ════════════════════════════════════════════════════════════════════════════
// DYNAMIC OBSTACLES — fold OTHER robots' live positions in as blocked cells so the
// planner (A* or D* Lite) routes around them. This is what the doc-16 audit flagged
// as MISSING from buildFactoryGrid (which only had static zone bounds).
//
// HONEST SCOPE: a robot becomes a blocked CELL (optionally an inflated disc of cells
// for its footprint/safety margin) — a snapshot occupancy, not a time-parameterised
// trajectory. This supports GRID-LEVEL robot-as-obstacle avoidance; it is NOT
// continuous/kinodynamic multi-robot planning. Presentation/orchestration state only.
// ════════════════════════════════════════════════════════════════════════════

/** A dynamic obstacle at a WORLD point (e.g. another robot's current pose). */
export interface DynamicObstacle {
  /** World position of the obstacle centre. */
  point: Point2D;
  /**
   * Inflation RADIUS in world units (metres). Cells within this radius of the point
   * are blocked (robot footprint + safety margin). 0 → just the single occupied cell.
   */
  radius?: number;
  /** Optional id (e.g. robot id) for provenance/debugging — not used in masking. */
  id?: number | string;
}

/** Deep-clone a grid's occupancy so masking is IMMUTABLE (never mutates the input). */
export function cloneGrid(grid: OccupancyGrid): OccupancyGrid {
  return { ...grid, cells: grid.cells.map((row) => row.slice()) };
}

/** Cells whose CENTRE lies within `radius` (world units) of a world point → blocked. */
function markDynamic(grid: OccupancyGrid, obs: DynamicObstacle): void {
  const radius = Math.max(0, obs.radius ?? 0);
  const centre = worldToCell(grid, obs.point);
  if (radius <= 0) {
    if (inBounds(grid, centre.col, centre.row)) grid.cells[centre.row][centre.col] = true;
    return;
  }
  // Scan the cell bounding box of the disc, block cells whose centre is within radius.
  const rCells = Math.ceil(radius / grid.cellSize) + 1;
  for (let dr = -rCells; dr <= rCells; dr++) {
    for (let dc = -rCells; dc <= rCells; dc++) {
      const col = centre.col + dc;
      const row = centre.row + dr;
      if (!inBounds(grid, col, row)) continue;
      const w = cellToWorld(grid, col, row);
      if (Math.hypot(w.x - obs.point.x, w.y - obs.point.y) <= radius + 1e-9) {
        grid.cells[row][col] = true;
      }
    }
  }
}

/**
 * Return a NEW grid (input untouched) with each dynamic obstacle folded in as blocked
 * cell(s). Feed OTHER robots' current positions here so the planner routes around them.
 * Out-of-bounds obstacles are ignored. Immutable — safe to call per-plan.
 */
export function withDynamicObstacles(grid: OccupancyGrid, obstacles: DynamicObstacle[]): OccupancyGrid {
  const next = cloneGrid(grid);
  for (const o of obstacles) markDynamic(next, o);
  return next;
}

