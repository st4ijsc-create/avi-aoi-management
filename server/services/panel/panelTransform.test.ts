/**
 * W8-B (doc 29 §2.2) — panel ↔ board transform math, hand-computed cases.
 * Convention under test: b = M( R(−rotationDeg) · (p − offset) ), X-right/Y-down,
 * mirror flips X about the board width.
 */
import { describe, it, expect } from "vitest";
import {
  panelToBoard,
  boardToPanel,
  assignBoard,
  generateGridBoards,
  resolveBoardDims,
  type BoardPlacement,
} from "./panelTransform";

const board = (over: Partial<BoardPlacement> = {}): BoardPlacement => ({
  boardIndex: 1,
  offsetXMm: 0,
  offsetYMm: 0,
  rotationDeg: 0,
  mirrored: false,
  ...over,
});

describe("panelToBoard (hand-computed)", () => {
  it("rotation 0: pure translation — p(15,27) − offset(10,20) = b(5,7)", () => {
    const b = panelToBoard({ x: 15, y: 27 }, board({ offsetXMm: 10, offsetYMm: 20 }));
    expect(b.x).toBeCloseTo(5, 9);
    expect(b.y).toBeCloseTo(7, 9);
  });

  it("rotation 90: b = R(−90)·(p−offset) = (dy, −dx) — p(3,25), offset(10,20) → b(5,7)", () => {
    // Forward check: p = offset + R(90)·b = (10 − 7, 20 + 5) = (3, 25).
    const b = panelToBoard({ x: 3, y: 25 }, board({ offsetXMm: 10, offsetYMm: 20, rotationDeg: 90 }));
    expect(b.x).toBeCloseTo(5, 9);
    expect(b.y).toBeCloseTo(7, 9);
  });

  it("rotation 180: b = −(p−offset) — p(45,44), offset(50,50) → b(5,6)", () => {
    const b = panelToBoard({ x: 45, y: 44 }, board({ offsetXMm: 50, offsetYMm: 50, rotationDeg: 180 }));
    expect(b.x).toBeCloseTo(5, 9);
    expect(b.y).toBeCloseTo(6, 9);
  });

  it("rotation 270: b = (−dy, dx) — offset(0,0), p(7,−5) → b(5,7)", () => {
    // Forward: p = R(270)·b = (cos270·5 − sin270·7, sin270·5 + cos270·7) = (7, −5).
    const b = panelToBoard({ x: 7, y: -5 }, board({ rotationDeg: 270 }));
    expect(b.x).toBeCloseTo(5, 9);
    expect(b.y).toBeCloseTo(7, 9);
  });

  it("mirror with board width: x → W − x — p(30,40), W=100 → b(70,40)", () => {
    const b = panelToBoard({ x: 30, y: 40 }, board({ mirrored: true }), 100);
    expect(b.x).toBeCloseTo(70, 9);
    expect(b.y).toBeCloseTo(40, 9);
  });

  it("mirror without board width falls back to x → −x (documented)", () => {
    const b = panelToBoard({ x: 30, y: 40 }, board({ mirrored: true }));
    expect(b.x).toBeCloseTo(-30, 9);
    expect(b.y).toBeCloseTo(40, 9);
  });

  it("rotation 90 + mirror (mirror applied AFTER rotation, in board space)", () => {
    // p−offset = (−7, 5); R(−90) → (5, 7); mirror W=20 → (15, 7).
    const b = panelToBoard(
      { x: 3, y: 25 },
      board({ offsetXMm: 10, offsetYMm: 20, rotationDeg: 90, mirrored: true }),
      20,
    );
    expect(b.x).toBeCloseTo(15, 9);
    expect(b.y).toBeCloseTo(7, 9);
  });
});

describe("boardToPanel is the exact inverse", () => {
  const cases: Array<{ b: BoardPlacement; w?: number }> = [
    { b: board({ offsetXMm: 10, offsetYMm: 20 }) },
    { b: board({ offsetXMm: 10, offsetYMm: 20, rotationDeg: 90 }) },
    { b: board({ offsetXMm: 5, offsetYMm: 5, rotationDeg: 180, mirrored: true }), w: 40 },
    { b: board({ offsetXMm: 0, offsetYMm: 0, rotationDeg: 270 }) },
    { b: board({ offsetXMm: 12.5, offsetYMm: 7.25, rotationDeg: 45 }) }, // non-quadrant angle
  ];
  it("round-trips panel → board → panel for rotations 0/90/180/270/45 ± mirror", () => {
    for (const { b, w } of cases) {
      const p = { x: 33.75, y: 18.5 };
      const local = panelToBoard(p, b, w);
      const back = boardToPanel(local, b, w);
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });
});

describe("assignBoard", () => {
  // 2×2 panel of 50×30 boards, row-major indices.
  const boards: BoardPlacement[] = [
    board({ boardIndex: 1, offsetXMm: 0, offsetYMm: 0 }),
    board({ boardIndex: 2, offsetXMm: 50, offsetYMm: 0 }),
    board({ boardIndex: 3, offsetXMm: 0, offsetYMm: 30 }),
    board({ boardIndex: 4, offsetXMm: 50, offsetYMm: 30, skipped: true }),
  ];
  const dims = { boardWidthMm: 50, boardHeightMm: 30 };

  it("assigns interior points to the right board with board-local coords", () => {
    const a = assignBoard({ x: 60, y: 40 }, boards, dims);
    expect(a).not.toBeNull();
    expect(a!.boardIndex).toBe(4);
    expect(a!.local.x).toBeCloseTo(10, 9);
    expect(a!.local.y).toBeCloseTo(10, 9);
    expect(a!.skipped).toBe(true); // X-out flag carried, match not suppressed
  });

  it("first matching board wins on shared edges (deterministic)", () => {
    const a = assignBoard({ x: 50, y: 10 }, boards, dims);
    expect(a!.boardIndex).toBe(1); // x=50 is on board 1's right edge AND board 2's left
  });

  it("returns null for points on no board (rails) — never guesses", () => {
    expect(assignBoard({ x: 200, y: 200 }, boards, dims)).toBeNull();
    expect(assignBoard({ x: -5, y: 10 }, boards, dims)).toBeNull();
  });

  it("respects rotation: a point inside a 90°-rotated board's footprint", () => {
    // Board 30 wide × 50 tall in panel space when rotated 90° with offset (80,0):
    // forward corners: b(0,0)→(80,0), b(50,0)→(80,50), b(0,30)→(50,0).
    const rot = [board({ boardIndex: 9, offsetXMm: 80, offsetYMm: 0, rotationDeg: 90 })];
    const a = assignBoard({ x: 70, y: 20 }, rot, dims); // R(−90)·(−10,20) = (20,10) ∈ 50×30 ✓
    expect(a).not.toBeNull();
    expect(a!.boardIndex).toBe(9);
    expect(a!.local.x).toBeCloseTo(20, 9);
    expect(a!.local.y).toBeCloseTo(10, 9);
  });
});

describe("generateGridBoards / resolveBoardDims", () => {
  it("generates row-major 1..n with even offsets from explicit board dims", () => {
    const g = generateGridBoards({ rows: 2, cols: 3, boardWidthMm: 10, boardHeightMm: 20 });
    expect(g).toHaveLength(6);
    expect(g.map((b) => b.boardIndex)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(g[0]).toMatchObject({ offsetXMm: 0, offsetYMm: 0 });
    expect(g[2]).toMatchObject({ offsetXMm: 20, offsetYMm: 0 });
    expect(g[3]).toMatchObject({ offsetXMm: 0, offsetYMm: 20 }); // row 2 starts
    expect(g[5]).toMatchObject({ offsetXMm: 20, offsetYMm: 20, rotationDeg: 0, mirrored: false, skipped: false });
  });

  it("divides panel dims evenly when board dims are absent", () => {
    const g = generateGridBoards({ rows: 2, cols: 2, panelWidthMm: 100, panelHeightMm: 60 });
    expect(g[3]).toMatchObject({ offsetXMm: 50, offsetYMm: 30 });
  });

  it("resolveBoardDims prefers explicit dims, falls back to panel/cols-rows, else null", () => {
    expect(resolveBoardDims({ cols: 2, rows: 2, boardWidthMm: "50", boardHeightMm: 30 }))
      .toEqual({ boardWidthMm: 50, boardHeightMm: 30 });
    expect(resolveBoardDims({ cols: 4, rows: 2, panelWidthMm: 200, panelHeightMm: 60 }))
      .toEqual({ boardWidthMm: 50, boardHeightMm: 30 });
    expect(resolveBoardDims({ cols: 2, rows: 2 })).toBeNull();
  });
});
