/**
 * Element-aware PDF pagination (doc 32 §6.4 #7, §6.5).
 *
 * The old exporter rendered the whole report body to one tall canvas and sliced
 * it by blind page-height pixel math, cutting charts and table rows in half.
 * This module lays blocks out onto pages so a page break NEVER falls inside a
 * block:
 *   - "atomic" blocks (stat groups, charts, text) move whole to the next page
 *     when they don't fit; if a single block is taller than a page it is scaled
 *     down to fit its own page (never cropped).
 *   - "table" blocks break BETWEEN ROWS; the header region (column header +
 *     section title) is re-emitted at the top of every continuation page.
 *
 * The function is PURE (mm in, layout out) so the pagination logic is unit-
 * testable on synthetic heights without any DOM.
 */

export type BlockKind = "atomic" | "table";

export interface PaginationBlock {
  kind: BlockKind;
  /** Natural height in mm (atomic: whole block). Informational for tables. */
  heightMm: number;
  /** Table only: height of the repeated header region (title + column header) in mm. */
  headerMm?: number;
  /** Table only: ordered per-row heights in mm. */
  rowsMm?: number[];
  /** Opaque payload forwarded to placements (e.g. canvas slice coordinates). */
  meta?: unknown;
}

export interface AtomicPlacement {
  kind: "atomic";
  blockIndex: number;
  /** Top offset within the page content area (mm). */
  yMm: number;
  /** Rendered height (mm). */
  heightMm: number;
  /** 1 unless the block was too tall for a page and had to be scaled to fit. */
  scale: number;
  meta?: unknown;
}

export interface TableSlicePlacement {
  kind: "table-slice";
  blockIndex: number;
  yMm: number;
  /** Repeated header region height (mm). */
  headerMm: number;
  /** First row index in this slice (inclusive). */
  rowStart: number;
  /** One past the last row index in this slice (exclusive). */
  rowEnd: number;
  /** Sum of the row heights in this slice (mm). */
  rowsHeightMm: number;
  /** headerMm + rowsHeightMm. */
  heightMm: number;
  /** True when further rows of this table continue on a later page. */
  continued: boolean;
  /** True when this slice continues a table started on an earlier page. */
  continuation: boolean;
  meta?: unknown;
}

export type Placement = AtomicPlacement | TableSlicePlacement;

export interface PaginatedPage {
  placements: Placement[];
}

export interface PaginateOptions {
  /** Vertical gap inserted after each fully-placed block (mm). Default 4. */
  blockGapMm?: number;
}

const EPS = 1e-6;

/**
 * Lay `blocks` out onto pages of `usableHeightMm` usable content height,
 * breaking only between blocks / between table rows.
 */
export function paginateBlocks(
  blocks: PaginationBlock[],
  usableHeightMm: number,
  options: PaginateOptions = {},
): PaginatedPage[] {
  const gap = options.blockGapMm ?? 4;
  const usable = Math.max(1, usableHeightMm);
  const pages: PaginatedPage[] = [{ placements: [] }];
  let cursor = 0; // current fill position on the current page (mm)

  const cur = () => pages[pages.length - 1];
  const newPage = () => {
    pages.push({ placements: [] });
    cursor = 0;
  };

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];

    if (block.kind === "atomic") {
      const h = block.heightMm;
      if (h <= usable + EPS) {
        // Fits on a page — move to a fresh page if it doesn't fit the remainder.
        if (cursor > 0 && cursor + h > usable + EPS) newPage();
        cur().placements.push({
          kind: "atomic", blockIndex: bi, yMm: cursor, heightMm: h, scale: 1, meta: block.meta,
        });
        cursor += h + gap;
      } else {
        // Taller than a whole page — scale to fit on its own page (never crop).
        if (cursor > 0) newPage();
        cur().placements.push({
          kind: "atomic", blockIndex: bi, yMm: 0, heightMm: usable, scale: usable / h, meta: block.meta,
        });
        cursor = usable + gap; // force the next block onto a new page
      }
      continue;
    }

    // ── table block ──
    const headerMm = block.headerMm ?? 0;
    const rows = block.rowsMm ?? [];

    if (rows.length === 0) {
      // Header-only table — treat like an atomic header band.
      if (cursor > 0 && cursor + headerMm > usable + EPS) newPage();
      cur().placements.push({
        kind: "table-slice", blockIndex: bi, yMm: cursor, headerMm,
        rowStart: 0, rowEnd: 0, rowsHeightMm: 0, heightMm: headerMm,
        continued: false, continuation: false, meta: block.meta,
      });
      cursor += headerMm + gap;
      continue;
    }

    let r = 0;
    let continuation = false;
    while (r < rows.length) {
      // Need room for the header + at least the next row; else start a new page.
      if (usable - cursor < headerMm + rows[r] - EPS) {
        if (cursor > 0) {
          newPage();
          continue;
        }
        // Fresh page and header+row STILL doesn't fit (pathological) → force it.
      }
      const budget = usable - cursor;
      const start = r;
      let used = headerMm;
      while (r < rows.length && used + rows[r] <= budget + EPS) {
        used += rows[r];
        r++;
      }
      if (r === start) {
        // Fresh page couldn't fit even one row after the header — force one so we
        // always make progress (row taller than a full page).
        used += rows[r];
        r++;
      }
      const rowsHeightMm = used - headerMm;
      const more = r < rows.length;
      cur().placements.push({
        kind: "table-slice", blockIndex: bi, yMm: cursor, headerMm,
        rowStart: start, rowEnd: r, rowsHeightMm, heightMm: used,
        continued: more, continuation, meta: block.meta,
      });
      continuation = true;
      if (more) newPage();
      else cursor += used + gap;
    }
  }

  return pages;
}
