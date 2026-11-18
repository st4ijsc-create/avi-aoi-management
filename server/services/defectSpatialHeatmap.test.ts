/**
 * Doc 27 W5-A (gap A5) — REAL bbox-based defect heatmap tests: phần THUẦN (không DB).
 *
 * Pure bucketing math: seeded bboxes land in the expected grid cells and the coordinate space is resolved honestly.
 * Phần tích hợp DB (NULL-bbox NG bị loại nhưng được đếm, pointDef fallback gắn nhãn logic) nằm ở `defectSpatialHeatmap.db.test.ts`
 * (giao dịch HOÀN TÁC) — tách ra vì tệp cũ INSERT thẳng vào `_test` mà không dọn.
 */
import { describe, it, expect } from "vitest";
import {
  resolveBoardExtent,
  bucketSpatialDefects,
  severityWeight,
  type SpatialDefectRow,
} from "./defectSpatialHeatmap";

function row(partial: Partial<SpatialDefectRow> & { bboxX: number; bboxY: number }): SpatialDefectRow {
  return {
    bboxW: 0,
    bboxH: 0,
    defectClassCode: null,
    defectClassName: null,
    severity: null,
    ...partial,
  };
}

describe("resolveBoardExtent (coordinate-space honesty)", () => {
  it("uses product image dims when every bbox fits inside them", () => {
    const rows = [row({ bboxX: 700, bboxY: 500, bboxW: 50, bboxH: 40 })];
    const r = resolveBoardExtent(rows, { imageWidth: 1000, imageHeight: 800 });
    expect(r).toEqual({ boardWidth: 1000, boardHeight: 800, coordinateSpace: "product_image" });
  });

  it("falls back to observed extent when a bbox exceeds the product dims", () => {
    const rows = [row({ bboxX: 1100, bboxY: 200, bboxW: 20, bboxH: 20 })];
    const r = resolveBoardExtent(rows, { imageWidth: 1000, imageHeight: 800 });
    expect(r.coordinateSpace).toBe("observed_extent");
    expect(r.boardWidth).toBe(1120); // 1100 + 20
    expect(r.boardHeight).toBe(220);
  });

  it("uses observed extent when no product dims are stored", () => {
    const rows = [
      row({ bboxX: 10, bboxY: 20, bboxW: 30, bboxH: 40 }),
      row({ bboxX: 200, bboxY: 100 }),
    ];
    const r = resolveBoardExtent(rows, null);
    expect(r).toEqual({ boardWidth: 200, boardHeight: 100, coordinateSpace: "observed_extent" });
  });

  it("guards the degenerate all-at-origin case with a 1px extent", () => {
    const r = resolveBoardExtent([row({ bboxX: 0, bboxY: 0 })], null);
    expect(r.boardWidth).toBe(1);
    expect(r.boardHeight).toBe(1);
  });
});

describe("bucketSpatialDefects (seeded bboxes → expected cells)", () => {
  const opts = { gridWidth: 10, gridHeight: 10, boardWidth: 100, boardHeight: 100 };

  it("buckets by bbox CENTER into the expected cells", () => {
    const rows = [
      row({ bboxX: 5, bboxY: 5 }),                         // center (5,5)   → cell (0,0)
      row({ bboxX: 45, bboxY: 5, bboxW: 10, bboxH: 0 }),   // center (50,5)  → cell (5,0)
      row({ bboxX: 12, bboxY: 33, bboxW: 6, bboxH: 4 }),   // center (15,35) → cell (1,3)
    ];
    const r = bucketSpatialDefects(rows, opts);
    expect(r.totalDefects).toBe(3);
    expect(r.grid[0][0]).toBe(1);
    expect(r.grid[0][5]).toBe(1);
    expect(r.grid[3][1]).toBe(1);
    expect(r.maxDefectsInCell).toBe(1);
  });

  it("clamps bboxes touching the right/bottom edge into the last cell", () => {
    const r = bucketSpatialDefects([row({ bboxX: 90, bboxY: 90, bboxW: 20, bboxH: 20 })], opts); // center (100,100)
    expect(r.grid[9][9]).toBe(1);
  });

  it("ranks hotspots by raw count and reports the per-cell top defect class", () => {
    const rows = [
      row({ bboxX: 5, bboxY: 5, defectClassCode: "BRIDGING" }),
      row({ bboxX: 6, bboxY: 6, defectClassCode: "BRIDGING" }),
      row({ bboxX: 7, bboxY: 4, defectClassCode: "TOMBSTONE" }),
      row({ bboxX: 55, bboxY: 55 }), // unclassified, different cell
    ];
    const r = bucketSpatialDefects(rows, opts);
    expect(r.hotspots[0]).toMatchObject({
      x: 0,
      y: 0,
      defectCount: 3,
      topDefectClass: "BRIDGING",
    });
    expect(r.hotspots[0].percentage).toBeCloseTo(75, 5);
    expect(r.hotspots[0].defectTypes).toEqual([
      { type: "BRIDGING", count: 2 },
      { type: "TOMBSTONE", count: 1 },
    ]);
    expect(r.hotspots[1]).toMatchObject({ x: 5, y: 5, defectCount: 1, topDefectClass: "UNCLASSIFIED" });
    // Cell center in board pixels (cell 0,0 of a 10×10 grid over 100×100 px).
    expect(r.hotspots[0].realX).toBe(5);
    expect(r.hotspots[0].realY).toBe(5);
  });

  it("weights the grid by severity when asked (counts stay raw)", () => {
    const rows = [
      row({ bboxX: 5, bboxY: 5, severity: "critical" }), // weight 4
      row({ bboxX: 6, bboxY: 6, severity: "cosmetic" }), // weight 1
    ];
    const r = bucketSpatialDefects(rows, { ...opts, weightBySeverity: true });
    expect(r.grid[0][0]).toBe(5); // 4 + 1 weighted
    expect(r.hotspots[0].defectCount).toBe(2); // raw count
    expect(severityWeight("major")).toBe(3);
    expect(severityWeight(null)).toBe(1);
    expect(severityWeight("weird")).toBe(1);
  });
});
