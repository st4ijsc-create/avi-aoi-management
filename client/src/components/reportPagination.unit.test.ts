import { describe, expect, it } from "vitest";
import {
  paginateBlocks,
  type PaginationBlock,
  type TableSlicePlacement,
  type AtomicPlacement,
} from "./reportPagination";

describe("paginateBlocks — element-aware pagination", () => {
  it("moves a whole atomic block to the next page instead of splitting it", () => {
    const blocks: PaginationBlock[] = [
      { kind: "atomic", heightMm: 40 },
      { kind: "atomic", heightMm: 40 },
      { kind: "atomic", heightMm: 40 },
    ];
    // usable=100, gap=4: b0@0(→44), b1@44(→88), b2 doesn't fit (88+40>100) → page 2.
    const pages = paginateBlocks(blocks, 100, { blockGapMm: 4 });
    expect(pages).toHaveLength(2);
    expect(pages[0].placements.map((p) => p.blockIndex)).toEqual([0, 1]);
    expect(pages[1].placements.map((p) => p.blockIndex)).toEqual([2]);
    // No block is ever scaled (all fit whole) and none is cut.
    for (const page of pages) {
      for (const pl of page.placements) {
        expect((pl as AtomicPlacement).scale).toBe(1);
      }
    }
    // Block 1 keeps its full height (not truncated to fill the page).
    expect(pages[0].placements[1].heightMm).toBe(40);
  });

  it("scales an oversized atomic block to fit its own page (never crops)", () => {
    const pages = paginateBlocks([{ kind: "atomic", heightMm: 150 }], 100);
    expect(pages).toHaveLength(1);
    const pl = pages[0].placements[0] as AtomicPlacement;
    expect(pl.kind).toBe("atomic");
    expect(pl.heightMm).toBeCloseTo(100);
    expect(pl.scale).toBeCloseTo(100 / 150);
    expect(pl.scale).toBeLessThan(1);
  });

  it("breaks a tall table BETWEEN rows and repeats the header on every page", () => {
    const rowsMm = Array.from({ length: 20 }, () => 10); // 20 rows × 10mm
    const blocks: PaginationBlock[] = [{ kind: "table", heightMm: 210, headerMm: 10, rowsMm }];
    const pages = paginateBlocks(blocks, 100, { blockGapMm: 4 });

    // Each page carries a table-slice with the header repeated.
    const slices = pages.map((p) => p.placements[0] as TableSlicePlacement);
    expect(slices.length).toBeGreaterThan(1);
    for (const s of slices) {
      expect(s.kind).toBe("table-slice");
      expect(s.headerMm).toBe(10); // header re-emitted on every page
    }

    // Row ranges are contiguous, cover all 20 rows exactly once, none split.
    let expectedStart = 0;
    let covered = 0;
    for (const s of slices) {
      expect(s.rowStart).toBe(expectedStart);
      expect(s.rowEnd).toBeGreaterThan(s.rowStart);
      expect(Number.isInteger(s.rowStart)).toBe(true);
      expect(Number.isInteger(s.rowEnd)).toBe(true);
      covered += s.rowEnd - s.rowStart;
      expectedStart = s.rowEnd;
    }
    expect(covered).toBe(20);
    expect(expectedStart).toBe(20);

    // Continuation flags are consistent.
    expect(slices[0].continuation).toBe(false);
    expect(slices[slices.length - 1].continued).toBe(false);
    for (let i = 1; i < slices.length; i++) expect(slices[i].continuation).toBe(true);

    // header(10) + 9 rows(90) = 100 fits exactly on the first page.
    expect(slices[0].rowEnd - slices[0].rowStart).toBe(9);
  });

  it("keeps a small table whole and appends the next block after it", () => {
    const blocks: PaginationBlock[] = [
      { kind: "table", heightMm: 30, headerMm: 10, rowsMm: [10, 10] },
      { kind: "atomic", heightMm: 20 },
    ];
    const pages = paginateBlocks(blocks, 100, { blockGapMm: 4 });
    expect(pages).toHaveLength(1);
    expect(pages[0].placements).toHaveLength(2);
    const table = pages[0].placements[0] as TableSlicePlacement;
    expect(table.continued).toBe(false);
    expect(table.rowEnd).toBe(2);
    // Second block sits below the table (header 10 + rows 20 + gap 4 = 34).
    const atomic = pages[0].placements[1] as AtomicPlacement;
    expect(atomic.yMm).toBeCloseTo(34);
  });

  it("forces progress when a single row is taller than a whole page", () => {
    const blocks: PaginationBlock[] = [{ kind: "table", heightMm: 300, headerMm: 10, rowsMm: [120, 120] }];
    const pages = paginateBlocks(blocks, 100);
    // Header(10)+row(120) > 100, but each row must still be placed exactly once.
    const slices = pages.map((p) => p.placements[0] as TableSlicePlacement);
    let covered = 0;
    for (const s of slices) covered += s.rowEnd - s.rowStart;
    expect(covered).toBe(2);
  });
});
