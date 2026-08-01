/**
 * Doc 31 MP6 (decision #2) — end-to-end spec gate + sync payload.
 *  1. submitInspection with a 3D value OUT of the point's height range and a
 *     machine "OK" verdict → the persisted measurement result is NG and the
 *     inspection overall is reconciled to NG.
 *  2. an in-range value keeps OK.
 *  3. deltaSyncPoints carries the point's 3D limits, criteria, and lighting recipe.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { appRouter } from "../routers";
import * as db from "../db";
import {
  productInspections,
  measurementResults,
  measurementPointDefs,
  mpLightingProfiles,
} from "../../drizzle/schema";

const STAMP = Date.now();
const API_KEY = `MP6-${STAMP}`;
const MODEL_CODE = `MP6_MODEL_${STAMP}`;
const POINT_CODE = `MP6_PT_${STAMP}`;

let machineId: number;
let productModelId: number;
let pointDefId: number;
let lightingId: number;
const inspectionIds: number[] = [];

function caller() {
  return appRouter.createCaller({ user: null } as never);
}

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1, code: `MP6-${STAMP}`, name: "MP6 spec-gate test", machineType: "AOI", apiKey: API_KEY, isActive: true,
  });
  productModelId = await db.createProductModel({ code: MODEL_CODE, name: "MP6 test model" });
  pointDefId = await db.createMeasurementPointDef({
    productModelId,
    code: POINT_CODE,
    name: "MP6 solder-height point",
    measurementType: "OTHER",
    measurementTypeCode: "SOLDER.HEIGHT",
    heightMin: "10",
    heightMax: "20",
    criteria: [{ kind: "numeric_range", metric: "volume", min: "80", max: "120" }] as any,
    positionX: 10,
    positionY: 10,
  });
  lightingId = await db.createMpLightingProfile({
    pointDefId, shotIndex: 1, lightSource: "coaxial", color: "white", intensityPct: 80, purpose: "solder_height", isActive: true,
  });
});

afterAll(async () => {
  const d = await db.getDb();
  if (d) {
    if (inspectionIds.length) {
      await d.delete(measurementResults).where(inArray(measurementResults.inspectionId, inspectionIds));
      await d.delete(productInspections).where(inArray(productInspections.id, inspectionIds));
    }
    if (lightingId) await d.delete(mpLightingProfiles).where(eq(mpLightingProfiles.id, lightingId));
    await d.delete(measurementPointDefs).where(eq(measurementPointDefs.id, pointDefId));
  }
  if (machineId) await db.deleteMachine(machineId);
});

describe("point spec-gate at ingest (MP6)", () => {
  it("downgrades OK → NG when height exceeds heightMax, and reconciles the overall", async () => {
    const r = await caller().machineApi.submitInspection({
      apiKey: API_KEY,
      serialNumber: `SN-MP6-${STAMP}-ng`,
      productModel: MODEL_CODE,
      overallResult: "OK",
      measurements: [{ pointCode: POINT_CODE, result: "OK", valueHeight: 25 }],
    });
    inspectionIds.push(r.inspectionId!);

    const rows = await db.getMeasurementResultsByInspection(r.inspectionId!);
    expect(rows.length).toBe(1);
    expect(rows[0].result).toBe("NG");
    expect(rows[0].remark).toContain("Spec gate");

    const insp = await db.getProductInspectionById(r.inspectionId!);
    expect(insp?.overallResult).toBe("NG");
    // The machine's original verdict is preserved for audit.
    expect(insp?.originalResult).toBe("OK");
  });

  it("keeps OK when height is within range", async () => {
    const r = await caller().machineApi.submitInspection({
      apiKey: API_KEY,
      serialNumber: `SN-MP6-${STAMP}-ok`,
      productModel: MODEL_CODE,
      overallResult: "OK",
      measurements: [{ pointCode: POINT_CODE, result: "OK", valueHeight: 15 }],
    });
    inspectionIds.push(r.inspectionId!);
    const rows = await db.getMeasurementResultsByInspection(r.inspectionId!);
    expect(rows[0].result).toBe("OK");
  });
});

describe("deltaSyncPoints carries 3D limits + criteria + lighting (MP6)", () => {
  it("projects the point with its 3D limits, criteria and lighting recipe", async () => {
    const res = await caller().machineApi.deltaSyncPoints({
      apiKey: API_KEY,
      productModelCode: MODEL_CODE,
      sinceVersion: 0,
    });
    const pt = (res.points as any[]).find((p) => p.code === POINT_CODE);
    expect(pt).toBeTruthy();
    expect(Number(pt.heightMin)).toBe(10);
    expect(Number(pt.heightMax)).toBe(20);
    expect(pt.measurementTypeCode).toBe("SOLDER.HEIGHT");
    expect(Array.isArray(pt.criteria)).toBe(true);
    expect(pt.criteria[0].metric).toBe("volume");
    expect(Array.isArray(pt.lighting)).toBe(true);
    expect(pt.lighting.length).toBeGreaterThanOrEqual(1);
    expect(pt.lighting[0].lightSource).toBe("coaxial");
    expect(pt.lighting[0].intensityPct).toBe(80);
  });
});
