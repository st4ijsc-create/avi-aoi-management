/**
 * Panel ↔ board coordinate transform — PURE math (doc 29 §2.2, agent W8-B).
 *
 * A panel is an N-up array of identical boards. Each board placement
 * (product_panel_boards) carries:
 *   • offsetXMm/offsetYMm — the board's ORIGIN inside the panel coordinate space;
 *   • rotationDeg        — the board's rotation about its own origin;
 *   • mirrored           — bottom-side panel → the board's X axis is flipped.
 *
 * Forward model (board-local point b → panel point p):
 *     p = offset + R(rotationDeg) · M(b)
 * Inverse (what analytics need — panel point p → board-local point b):
 *     b = M( R(−rotationDeg) · (p − offset) )
 * where M is the mirror operator: M(x, y) = (boardWidth − x, y) when `mirrored`
 * (its own inverse), identity otherwise. When boardWidth is unknown a mirrored
 * transform falls back to x → −x (documented, still involutive) — callers that
 * need in-bounds coordinates must supply board dims.
 *
 * AXES: the panel space is X-right / Y-down (same as the platform's pixel/image
 * convention). rotationDeg is the standard math rotation matrix
 * [[cos,−sin],[sin,cos]] — in a Y-down space a positive angle APPEARS clockwise
 * on screen. 0/90/180/270 are exact (no float fuzz).
 */

export interface XY {
  x: number;
  y: number;
}

/** One board placement inside a panel (numeric mirror of product_panel_boards). */
export interface BoardPlacement {
  boardIndex: number;
  offsetXMm: number;
  offsetYMm: number;
  rotationDeg: number;
  mirrored: boolean;
  skipped?: boolean;
}

/** Board physical extent (single-board dims in mm). */
export interface BoardDims {
  boardWidthMm: number;
  boardHeightMm: number;
}

const DEG2RAD = Math.PI / 180;

/** cos/sin exact for the quadrant angles so 90/180/270 round-trip losslessly. */
function cosSin(deg: number): { c: number; s: number } {
  const norm = ((deg % 360) + 360) % 360;
  if (norm === 0) return { c: 1, s: 0 };
  if (norm === 90) return { c: 0, s: 1 };
  if (norm === 180) return { c: -1, s: 0 };
  if (norm === 270) return { c: 0, s: -1 };
  return { c: Math.cos(deg * DEG2RAD), s: Math.sin(deg * DEG2RAD) };
}

function applyMirror(pt: XY, mirrored: boolean, boardWidthMm?: number): XY {
  if (!mirrored) return pt;
  return { x: boardWidthMm != null ? boardWidthMm - pt.x : -pt.x, y: pt.y };
}

/**
 * Panel-space point (mm) → board-local point (mm) for ONE board placement:
 * b = M( R(−rotationDeg) · (p − offset) ).
 */
export function panelToBoard(p: XY, board: BoardPlacement, boardWidthMm?: number): XY {
  const dx = p.x - board.offsetXMm;
  const dy = p.y - board.offsetYMm;
  // R(−θ) = [[cosθ, sinθ], [−sinθ, cosθ]]
  const { c, s } = cosSin(board.rotationDeg);
  const rotated = { x: c * dx + s * dy, y: -s * dx + c * dy };
  return applyMirror(rotated, board.mirrored, boardWidthMm);
}

/**
 * Board-local point (mm) → panel-space point (mm) — exact inverse of
 * panelToBoard: p = offset + R(rotationDeg) · M(b).
 */
export function boardToPanel(b: XY, board: BoardPlacement, boardWidthMm?: number): XY {
  const m = applyMirror(b, board.mirrored, boardWidthMm);
  const { c, s } = cosSin(board.rotationDeg);
  return {
    x: board.offsetXMm + c * m.x - s * m.y,
    y: board.offsetYMm + s * m.x + c * m.y,
  };
}

export interface BoardAssignment {
  boardIndex: number;
  /** Board-local coordinates (mm), origin = the board's own top-left. */
  local: XY;
  skipped: boolean;
}

/**
 * Assign a panel-space point to the board whose local extent contains it
 * (0 ≤ x ≤ W, 0 ≤ y ≤ H, with a small epsilon for edge hits). Returns null when
 * the point lands on no board (rail/tooling area) — callers report it honestly
 * as "unassigned", never guess. X-out (`skipped`) boards still match (a defect
 * physically on a skipped board is real) — the flag is carried for the caller.
 */
export function assignBoard(
  p: XY,
  boards: BoardPlacement[],
  dims: BoardDims,
  epsilonMm = 1e-6,
): BoardAssignment | null {
  for (const board of boards) {
    const local = panelToBoard(p, board, dims.boardWidthMm);
    if (
      local.x >= -epsilonMm &&
      local.x <= dims.boardWidthMm + epsilonMm &&
      local.y >= -epsilonMm &&
      local.y <= dims.boardHeightMm + epsilonMm
    ) {
      return { boardIndex: board.boardIndex, local, skipped: board.skipped === true };
    }
  }
  return null;
}

/**
 * Quick-generate a rows×cols grid of board placements (row-major boardIndex
 * 1..rows*cols, rotation 0, no mirror). Cell size = explicit board dims when
 * given, else panel dims divided evenly. Pure — the editor previews this and
 * the user then adjusts offsets/rotation per board.
 */
export function generateGridBoards(opts: {
  rows: number;
  cols: number;
  panelWidthMm?: number | null;
  panelHeightMm?: number | null;
  boardWidthMm?: number | null;
  boardHeightMm?: number | null;
}): Array<Omit<BoardPlacement, "skipped"> & { skipped: boolean }> {
  const rows = Math.max(1, Math.floor(opts.rows));
  const cols = Math.max(1, Math.floor(opts.cols));
  const cellW =
    opts.boardWidthMm ?? (opts.panelWidthMm != null ? opts.panelWidthMm / cols : 0);
  const cellH =
    opts.boardHeightMm ?? (opts.panelHeightMm != null ? opts.panelHeightMm / rows : 0);
  const boards: Array<Omit<BoardPlacement, "skipped"> & { skipped: boolean }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      boards.push({
        boardIndex: r * cols + c + 1,
        offsetXMm: round3(c * cellW),
        offsetYMm: round3(r * cellH),
        rotationDeg: 0,
        mirrored: false,
        skipped: false,
      });
    }
  }
  return boards;
}

/**
 * Resolve the single-board dims of a panel def: explicit boardWidthMm/HeightMm
 * when present, else panel dims divided by cols/rows (exact only for unrotated,
 * gap-less grids), else null — callers must degrade honestly (no fabricated dims).
 */
export function resolveBoardDims(def: {
  cols: number;
  rows: number;
  panelWidthMm?: number | string | null;
  panelHeightMm?: number | string | null;
  boardWidthMm?: number | string | null;
  boardHeightMm?: number | string | null;
}): BoardDims | null {
  const bw = toNum(def.boardWidthMm);
  const bh = toNum(def.boardHeightMm);
  if (bw != null && bh != null && bw > 0 && bh > 0) {
    return { boardWidthMm: bw, boardHeightMm: bh };
  }
  const pw = toNum(def.panelWidthMm);
  const ph = toNum(def.panelHeightMm);
  if (pw != null && ph != null && pw > 0 && ph > 0 && def.cols > 0 && def.rows > 0) {
    return { boardWidthMm: pw / def.cols, boardHeightMm: ph / def.rows };
  }
  return null;
}

function toNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
