/**
 * Doc 27 W5-A (gap A6) — defect-CLASS Pareto tests.
 *
 * Pure builder tests (true cumulative %, top-N + "OTHERS" tail, honest
 * "UNCLASSIFIED" bucket) + a DB-integration pass grouping real
 * measurement_results.defectCatalogId against defect_catalog.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { buildDefectClassPareto, getDefectClassPareto } from "./aiInspectionAnalytics";
import * as db from "../db";

function classRow(id: number | null, code: string | null, count: number, severity: string | null = "major") {
  return {
    defectCatalogId: id,
    code,
    name: code,
    severity,
    category: "solder",
    ipcReference: null,
    count,
  };
}

describe("buildDefectClassPareto (pure)", () => {
  it("computes TRUE cumulative % reaching 100 at the last item", () => {
    const r = buildDefectClassPareto(
      [classRow(1, "A", 50), classRow(2, "B", 30), classRow(3, "C", 20)],
      10,
    );
    expect(r.totalDefects).toBe(100);
    expect(r.items.map((i) => i.cumulativePercentage)).toEqual([50, 80, 100]);
    expect(r.items.map((i) => i.percentage)).toEqual([50, 30, 20]);
    expect(r.unclassifiedDefects).toBe(0);
    expect(r.classifiedDefects).toBe(100);
  });

  it("folds the tail beyond topN into one OTHERS bucket (cumulative still 100)", () => {
    const r = buildDefectClassPareto(
      [
        classRow(1, "A", 50),
        classRow(2, "B", 30),
        classRow(3, "C", 15),
        classRow(null, null, 5), // unclassified — ranks last here
      ],
      3,
    );
    expect(r.items).toHaveLength(4); // A, B, C + OTHERS
    const others = r.items[3];
    expect(others.bucket).toBe("others");
    expect(others.code).toBe("OTHERS");
    expect(others.count).toBe(5);
    expect(others.cumulativePercentage).toBe(100);
    // Unclassified is reported honestly even when folded into OTHERS.
    expect(r.unclassifiedDefects).toBe(5);
    expect(r.classifiedDefects).toBe(95);
  });

  it("keeps UNCLASSIFIED as a ranked, visible bucket when it is a top contributor", () => {
    const r = buildDefectClassPareto(
      [classRow(null, null, 60), classRow(1, "A", 40)],
      10,
    );
    expect(r.items[0]).toMatchObject({
      code: "UNCLASSIFIED",
      bucket: "unclassified",
      count: 60,
      percentage: 60,
    });
    expect(r.unclassifiedDefects).toBe(60);
  });

  it("sorts descending regardless of input order and drops zero-count rows", () => {
    const r = buildDefectClassPareto(
      [classRow(2, "B", 10), classRow(3, "Z", 0), classRow(1, "A", 90)],
      10,
    );
    expect(r.items.map((i) => i.code)).toEqual(["A", "B"]);
  });

  it("handles the empty case", () => {
    const r = buildDefectClassPareto([], 10);
    expect(r.items).toEqual([]);
    expect(r.totalDefects).toBe(0);
  });
});

// ─── DB integration ─────────────────────────────────────────────────────────

describe("getDefectClassPareto (DB integration)", () => {
  const ts = Date.now();
  let machineId: number;
  let productModelId: number;
  let catA: number;
  let catB: number;
  const windowStart = new Date("2026-04-01T00:00:00Z");
  const windowEnd = new Date("2026-04-10T00:00:00Z");

  beforeAll(async () => {
    const factoryId = await db.createFactory({ code: `TEST_FAC_DCP_${ts}`, name: "DCP fac" });
    const workshopId = await db.createWorkshop({ factoryId, code: `TEST_WS_DCP_${ts}`, name: "DCP ws" });
    const lineId = await db.createProductionLine({ workshopId, code: `TEST_LINE_DCP_${ts}`, name: "DCP line" });
    const stationId = await db.createStation({ lineId, code: `TEST_ST_DCP_${ts}`, name: "DCP st", sequence: 1 });
    machineId = await db.createMachine({
      stationId,
      code: `M_DCP_${ts}`,
      name: "DCP machine",
      machineType: "AOI",
      apiKey: `test_dcp_${ts}`,
    });
    productModelId = await db.createProductModel({ code: `PROD_DCP_${ts}`, name: "DCP product", version: "1.0" });
    const pointDefId = await db.createMeasurementPointDef({
      productModelId,
      code: `MP_DCP_${ts}`,
      name: "DCP point",
      measurementType: "VISUAL",
      positionX: 0,
      positionY: 0,
    });
    catA = await db.createDefectCatalog({
      code: `TEST_DCP_A_${ts}`,
      name: "DCP class A",
      severity: "critical",
      category: "solder",
    });
    catB = await db.createDefectCatalog({
      code: `TEST_DCP_B_${ts}`,
      name: "DCP class B",
      severity: "minor",
      category: "component",
    });

    const inspectionId = await db.createProductInspection({
      machineId,
      productModelId,
      serialNumber: `SN_DCP_${ts}`,
      overallResult: "NG",
      originalResult: "NG",
      inspectionTime: new Date("2026-04-05T03:00:00Z"),
    });

    await db.createMeasurementResults([
      { inspectionId, pointDefId, result: "NG", defectCatalogId: catA },
      { inspectionId, pointDefId, result: "NG", defectCatalogId: catA },
      { inspectionId, pointDefId, result: "NG", defectCatalogId: catA },
      { inspectionId, pointDefId, result: "NG", defectCatalogId: catB },
      { inspectionId, pointDefId, result: "NG", defectCatalogId: catB },
      { inspectionId, pointDefId, result: "NG" }, // unclassified NG
      { inspectionId, pointDefId, result: "OK", defectCatalogId: catA }, // OK — not a defect
    ] as any);
  });

  it("groups NG results by defect catalog with true cumulative % and honest unclassified count", async () => {
    const r = await getDefectClassPareto({
      startDate: windowStart,
      endDate: windowEnd,
      machineId,
      productModelId,
      topN: 10,
    });

    expect(r.totalDefects).toBe(6);
    expect(r.unclassifiedDefects).toBe(1);
    expect(r.classifiedDefects).toBe(5);

    expect(r.items[0]).toMatchObject({
      defectCatalogId: catA,
      code: `TEST_DCP_A_${ts}`,
      severity: "critical",
      count: 3,
      percentage: 50,
      cumulativePercentage: 50,
      bucket: "class",
    });
    expect(r.items[1]).toMatchObject({ defectCatalogId: catB, count: 2 });
    expect(r.items[1].cumulativePercentage).toBeCloseTo(83.33, 1);
    expect(r.items[2]).toMatchObject({ code: "UNCLASSIFIED", bucket: "unclassified", count: 1 });
    expect(r.items[2].cumulativePercentage).toBeCloseTo(100, 1);
  });

  it("applies the topN + OTHERS folding on real data", async () => {
    const r = await getDefectClassPareto({
      startDate: windowStart,
      endDate: windowEnd,
      machineId,
      productModelId,
      topN: 1,
    });
    expect(r.items).toHaveLength(2); // top class + OTHERS
    expect(r.items[0].code).toBe(`TEST_DCP_A_${ts}`);
    expect(r.items[1]).toMatchObject({ code: "OTHERS", bucket: "others", count: 3 });
    expect(r.items[1].cumulativePercentage).toBeCloseTo(100, 1);
  });
});
