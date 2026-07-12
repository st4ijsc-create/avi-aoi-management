/**
 * doc 44 W6-2 / G5.21 — DataTable row-windowing math (pure, node env).
 */
import { describe, it, expect } from "vitest";
import { computeVirtualWindow } from "./DataTable";

describe("computeVirtualWindow", () => {
  it("at the top, renders the first viewport-worth of rows + overscan below only", () => {
    const w = computeVirtualWindow({
      scrollTop: 0,
      viewportHeight: 440,
      rowHeight: 44,
      rowCount: 1000,
      overscan: 5,
    });
    // 10 visible rows + 5 overscan below; overscan above clamps to 0
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBe(15);
    expect(w.paddingTop).toBe(0);
    expect(w.paddingBottom).toBe((1000 - 15) * 44);
  });

  it("scrolled into the middle: window brackets the visible band with overscan both sides", () => {
    const w = computeVirtualWindow({
      scrollTop: 4400, // 100 rows scrolled
      viewportHeight: 440, // 10 rows
      rowHeight: 44,
      rowCount: 1000,
      overscan: 5,
    });
    expect(w.startIndex).toBe(95); // 100 - 5
    expect(w.endIndex).toBe(115); // 100 + 10 + 5
    expect(w.paddingTop).toBe(95 * 44);
    expect(w.paddingBottom).toBe((1000 - 115) * 44);
  });

  it("only renders a SUBSET, never all rows", () => {
    const rowCount = 5000;
    const w = computeVirtualWindow({ scrollTop: 22000, viewportHeight: 480, rowHeight: 44, rowCount, overscan: 8 });
    const rendered = w.endIndex - w.startIndex;
    expect(rendered).toBeLessThan(rowCount);
    expect(rendered).toBeLessThanOrEqual(Math.ceil(480 / 44) + 8 * 2 + 1);
    // spacers + rendered rows total the full scroll height
    const total = w.paddingTop + rendered * 44 + w.paddingBottom;
    expect(total).toBe(rowCount * 44);
  });

  it("clamps the window to the end of the list", () => {
    const w = computeVirtualWindow({ scrollTop: 1_000_000, viewportHeight: 440, rowHeight: 44, rowCount: 200, overscan: 5 });
    expect(w.endIndex).toBe(200);
    expect(w.paddingBottom).toBe(0);
    expect(w.startIndex).toBeLessThanOrEqual(200);
  });

  it("empty / degenerate inputs → empty window (fallback, non-virtualized render)", () => {
    expect(computeVirtualWindow({ scrollTop: 0, viewportHeight: 440, rowHeight: 44, rowCount: 0 })).toEqual({
      startIndex: 0,
      endIndex: 0,
      paddingTop: 0,
      paddingBottom: 0,
    });
    expect(computeVirtualWindow({ scrollTop: 0, viewportHeight: 440, rowHeight: 0, rowCount: 10 })).toEqual({
      startIndex: 0,
      endIndex: 0,
      paddingTop: 0,
      paddingBottom: 0,
    });
  });

  it("negative scrollTop is treated as top (defensive)", () => {
    const w = computeVirtualWindow({ scrollTop: -50, viewportHeight: 440, rowHeight: 44, rowCount: 100, overscan: 3 });
    expect(w.startIndex).toBe(0);
    expect(w.paddingTop).toBe(0);
  });
});
