/**
 * W8-B (doc 29 §2.2) — panel-aware heatmap mode ("panelBoard"): defect bboxes
 * in panel-image pixels are folded onto the single-board mm space via the
 * product's ACTIVE panel def + per-board Pareto; honest fallback labels when no
 * panel def exists. Separate file from W5-A's defectSpatialHeatmap.test.ts
 * (that suite is untouched and must stay green).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { computeSpatialHeatmap } from "./defectSpatialHeatmap";
import { createPanelDef } from "./panel/panelService";
import * as db from "../db";
import { getDb } from "../db/connection";
import { productPanelDefs, productPanelBoards, measurementResults, productInspections } from "../../drizzle/schema";

const ts = Date.now();
let machineId: number;
let productModelId: number; // WITH panel def
let plainProductId: number; // WITHOUT panel def
let panelDefId: number;
let inspectionId: number;
let plainInspectionId: number;
const windowStart = new Date("2026-05-01T00:00:00Z");
const windowEnd = new Date("2026-05-10T00:00:00Z");

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1,
    code: `M_PNHM_${ts}`,
    name: "Panel heatmap machine",
    machineType: "AOI",
    apiKey: `test_pnhm_${ts}`,
  });
  // Panel image = 400×300 px ⇒ panel 200×150 mm ⇒ scale 0.5 mm/px.
  productModelId = await db.createProductModel({
    code: `PROD_PNHM_${ts}`,
    name: "Panel heatmap product",
    imageWidth: 400,
    imageHeight: 300,
  });
  plainProductId = await db.createProductModel({
    code: `PROD_PNHM_PLAIN_${ts}`,
    name: "Plain product (no panel)",
    imageWidth: 400,
    imageHeight: 300,
  });
  const pointDefId = await db.createMeasurementPointDef({
    productModelId,
    code: `MP_PNHM_${ts}`,
    name: "P",
    measurementType: "VISUAL",
    positionX: 0,
    positionY: 0,
  });

  // 2×2 panel, 100×75 mm boards; board 4 = X-out.
  panelDefId = await createPanelDef(
    {
      productModelId,
      code: `PNL_HM_${ts}`,
      rows: 2,
      cols: 2,
      panelWidthMm: 200,
      panelHeightMm: 150,
      boardWidthMm: 100,
      boardHeightMm: 75,
    },
    [
      { boardIndex: 1, offsetXMm: 0, offsetYMm: 0 },
      { boardIndex: 2, offsetXMm: 100, offsetYMm: 0 },
      { boardIndex: 3, offsetXMm: 0, offsetYMm: 75 },
      { boardIndex: 4, offsetXMm: 100, offsetYMm: 75, skipped: true },
    ],
  );

  inspectionId = await db.createProductInspection({
    machineId,
    productModelId,
    serialNumber: `SN_PNHM_${ts}`,
    overallResult: "NG",
    originalResult: "NG",
    inspectionTime: new Date("2026-05-05T03:00:00Z"),
  });
  plainInspectionId = await db.createProductInspection({
    machineId,
    productModelId: plainProductId,
    serialNumber: `SN_PNHM_PLAIN_${ts}`,
    overallResult: "NG",
    originalResult: "NG",
    inspectionTime: new Date("2026-05-05T03:00:00Z"),
  });

  await db.createMeasurementResults([
    // px center (40,30) → mm (20,15) → board 1 local (20,15) → cell (2,2) on 10×10 over 100×75.
    { inspectionId, pointDefId, result: "NG", defectBboxX: 30, defectBboxY: 20, defectBboxW: 20, defectBboxH: 20 },
    // px center (240,30) → mm (120,15) → board 2 local (20,15) → SAME folded cell (2,2).
    { inspectionId, pointDefId, result: "NG", defectBboxX: 230, defectBboxY: 20, defectBboxW: 20, defectBboxH: 20 },
    // px center (340,260) → mm (170,130) → board 4 (X-out) local (70,55) → cell (7,7).
    { inspectionId, pointDefId, result: "NG", defectBboxX: 340, defectBboxY: 260, defectBboxW: 0, defectBboxH: 0 },
    // no bbox → excluded, counted.
    { inspectionId, pointDefId, result: "NG" },
    // Plain product: one bbox'd NG for the fallback test.
    { inspectionId: plainInspectionId, pointDefId, result: "NG", defectBboxX: 10, defectBboxY: 10, defectBboxW: 0, defectBboxH: 0 },
  ] as any);
});

afterAll(async () => {
  const d = await getDb();
  if (d) {
    await d.delete(measurementResults).where(inArray(measurementResults.inspectionId, [inspectionId, plainInspectionId]));
    await d.delete(productInspections).where(inArray(productInspections.id, [inspectionId, plainInspectionId]));
    await d.delete(productPanelBoards).where(eq(productPanelBoards.panelDefId, panelDefId));
    await d.delete(productPanelDefs).where(eq(productPanelDefs.id, panelDefId));
  }
  await db.deleteProductModel(productModelId).catch(() => undefined);
  await db.deleteProductModel(plainProductId).catch(() => undefined);
  await db.deleteMachine(machineId).catch(() => undefined);
});

describe("computeSpatialHeatmap mode=panelBoard", () => {
  it("folds boards onto the single-board mm grid + per-board Pareto (hand-computed)", async () => {
    const conn = await getDb();
    const r = await computeSpatialHeatmap(conn!, {
      startDate: windowStart,
      endDate: windowEnd,
      machineId,
      productModelId,
      gridWidth: 10,
      gridHeight: 10,
      mode: "panelBoard",
    });

    expect(r.mode).toBe("panelBoard");
    expect(r.panelAware).toBe(true);
    expect(r.panelDefId).toBe(panelDefId);
    expect(r.realCoordinates).toBe(true);
    expect(r.coordinateSpace).toBe("board_local_mm");
    expect(r.boardWidth).toBeCloseTo(100);
    expect(r.boardHeight).toBeCloseTo(75);

    // Boards 1+2 fold onto the same board-local point (20,15) → one cell with 2.
    // Cell: x = floor(20/100*10)=2, y = floor(15/75*10)=2.
    expect(r.grid[2][2]).toBe(2);
    // Board 4 defect: local (70,55) → x=7, y=floor(55/75*10)=7.
    expect(r.grid[7][7]).toBe(1);
    expect(r.totalDefects).toBe(3);
    expect(r.excludedNoBbox).toBe(1); // the NULL-bbox NG row, still counted
    expect(r.unassigned).toBe(0);

    expect(r.perBoard).toEqual([
      { boardIndex: 1, defectCount: 1, skipped: false },
      { boardIndex: 2, defectCount: 1, skipped: false },
      { boardIndex: 3, defectCount: 0, skipped: false },
      { boardIndex: 4, defectCount: 1, skipped: true }, // X-out flagged, not hidden
    ]);
  });

  it("falls back HONESTLY to bbox mode when the product has no panel def", async () => {
    const conn = await getDb();
    const r = await computeSpatialHeatmap(conn!, {
      startDate: windowStart,
      endDate: windowEnd,
      machineId,
      productModelId: plainProductId,
      gridWidth: 10,
      gridHeight: 10,
      mode: "panelBoard",
    });
    expect(r.mode).toBe("bbox"); // ran the ordinary spatial mode
    expect(r.panelAware).toBe(false);
    expect(r.panelDefId).toBeNull();
    expect(r.panelFallbackReason).toBe("no_panel_def");
    expect(r.totalDefects).toBe(1);
  });

  it("falls back with no_product_filter when productModelId is absent", async () => {
    const conn = await getDb();
    const r = await computeSpatialHeatmap(conn!, {
      startDate: windowStart,
      endDate: windowEnd,
      machineId,
      gridWidth: 10,
      gridHeight: 10,
      mode: "panelBoard",
    });
    expect(r.panelAware).toBe(false);
    expect(r.panelFallbackReason).toBe("no_product_filter");
  });
});
