/**
 * Doc 27 W5-A (gap A5) — REAL bbox-based defect heatmap tests.
 *
 * Pure bucketing math (no DB) + a DB-integration pass against the isolated
 * cloned test DB (vitest.setup.ts): seeded bboxes land in the expected grid
 * cells, NULL-bbox NG rows are EXCLUDED but counted (no silent drops), the
 * coordinate space is resolved honestly, and the pointDef fallback is
 * labeled as logical (realCoordinates:false).
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  resolveBoardExtent,
  bucketSpatialDefects,
  computeSpatialHeatmap,
  severityWeight,
  type SpatialDefectRow,
} from "./defectSpatialHeatmap";
import * as db from "../db";
import { getDb } from "../db/connection";

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

// ─── DB integration ─────────────────────────────────────────────────────────

describe("computeSpatialHeatmap (DB integration)", () => {
  const ts = Date.now();
  let machineId: number;
  let productModelId: number;
  let catalogId: number;
  const windowStart = new Date("2026-04-01T00:00:00Z");
  const windowEnd = new Date("2026-04-10T00:00:00Z");

  beforeAll(async () => {
    const factoryId = await db.createFactory({ code: `TEST_FAC_HM_${ts}`, name: "Heatmap fac" });
    const workshopId = await db.createWorkshop({ factoryId, code: `TEST_WS_HM_${ts}`, name: "Heatmap ws" });
    const lineId = await db.createProductionLine({ workshopId, code: `TEST_LINE_HM_${ts}`, name: "Heatmap line" });
    const stationId = await db.createStation({ lineId, code: `TEST_ST_HM_${ts}`, name: "Heatmap st", sequence: 1 });
    machineId = await db.createMachine({
      stationId,
      code: `M_HM_${ts}`,
      name: "Heatmap machine",
      machineType: "AOI",
      apiKey: `test_hm_${ts}`,
    });
    productModelId = await db.createProductModel({
      code: `PROD_HM_${ts}`,
      name: "Heatmap product",
      version: "1.0",
      imageWidth: 1000,
      imageHeight: 800,
    });
    const pointDefId = await db.createMeasurementPointDef({
      productModelId,
      code: `MP_HM_${ts}`,
      name: "Heatmap point",
      measurementType: "VISUAL",
      positionX: 0,
      positionY: 0,
    });
    catalogId = await db.createDefectCatalog({
      code: `TEST_HM_BRIDGE_${ts}`,
      name: "Test bridging",
      severity: "critical",
      category: "solder",
    });

    const inspectionId = await db.createProductInspection({
      machineId,
      productModelId,
      serialNumber: `SN_HM_${ts}`,
      overallResult: "NG",
      originalResult: "NG",
      inspectionTime: new Date("2026-04-05T03:00:00Z"),
    });

    await db.createMeasurementResults([
      // 3 NG WITH bbox → grid (cells derived from centers over 1000×800):
      // center (50,40)   → cell (0,0) on a 10×10 grid
      { inspectionId, pointDefId, result: "NG", defectCatalogId: catalogId, defectBboxX: 40, defectBboxY: 30, defectBboxW: 20, defectBboxH: 20 },
      // center (55,45)   → cell (0,0)
      { inspectionId, pointDefId, result: "NG", defectCatalogId: catalogId, defectBboxX: 55, defectBboxY: 45, defectBboxW: 0, defectBboxH: 0 },
      // center (550,440) → cell (5,5)
      { inspectionId, pointDefId, result: "NG", defectBboxX: 540, defectBboxY: 430, defectBboxW: 20, defectBboxH: 20 },
      // 2 NG WITHOUT bbox → excluded, counted
      { inspectionId, pointDefId, result: "NG" },
      { inspectionId, pointDefId, result: "NG", defectBboxX: null as any, defectBboxY: null as any },
      // 1 OK row with bbox → not a defect, ignored entirely
      { inspectionId, pointDefId, result: "OK", defectBboxX: 10, defectBboxY: 10, defectBboxW: 5, defectBboxH: 5 },
    ] as any);
  });

  it("aggregates real bboxes into the expected cells and counts NULL-bbox exclusions", async () => {
    const conn = await getDb();
    expect(conn).toBeTruthy();
    const r = await computeSpatialHeatmap(conn!, {
      startDate: windowStart,
      endDate: windowEnd,
      machineId,
      productModelId,
      gridWidth: 10,
      gridHeight: 10,
      mode: "bbox",
    });

    expect(r.realCoordinates).toBe(true);
    expect(r.mode).toBe("bbox");
    // Product dims stored + all bboxes fit → product_image space, 1000×800.
    expect(r.coordinateSpace).toBe("product_image");
    expect(r.boardWidth).toBe(1000);
    expect(r.boardHeight).toBe(800);

    expect(r.totalDefects).toBe(3);
    expect(r.excludedNoBbox).toBe(2);
    expect(r.excludedNoBboxPct).toBe(40); // 2 of 5 NG rows

    expect(r.grid[0][0]).toBe(2);
    expect(r.grid[5][5]).toBe(1);
    expect(r.maxDefectsInCell).toBe(2);

    const top = r.hotspots[0];
    expect(top).toMatchObject({ x: 0, y: 0, defectCount: 2, topDefectClass: `TEST_HM_BRIDGE_${ts}` });
    const second = r.hotspots[1];
    expect(second).toMatchObject({ x: 5, y: 5, defectCount: 1, topDefectClass: "UNCLASSIFIED" });
  });

  it("filters by defect class", async () => {
    const conn = await getDb();
    const r = await computeSpatialHeatmap(conn!, {
      startDate: windowStart,
      endDate: windowEnd,
      machineId,
      productModelId,
      defectCatalogId: catalogId,
      gridWidth: 10,
      gridHeight: 10,
      mode: "bbox",
    });
    expect(r.totalDefects).toBe(2); // only the two classified rows
    expect(r.grid[0][0]).toBe(2);
  });

  it("pointDef fallback is honestly labeled as logical, not spatial", async () => {
    const conn = await getDb();
    const r = await computeSpatialHeatmap(conn!, {
      startDate: windowStart,
      endDate: windowEnd,
      machineId,
      productModelId,
      gridWidth: 10,
      gridHeight: 10,
      mode: "pointDef",
    });
    expect(r.realCoordinates).toBe(false);
    expect(r.mode).toBe("pointDef");
    expect(r.coordinateSpace).toBe("logical_point_index");
    // All 5 NG rows participate (bbox irrelevant in logical mode).
    expect(r.totalDefects).toBe(5);
    expect(r.excludedNoBbox).toBe(0);
  });
});
