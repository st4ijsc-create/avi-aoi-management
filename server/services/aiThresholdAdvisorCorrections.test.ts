/**
 * Doc 31 OP6 — the threshold advisor excludes operator-overturned (NTF/OK)
 * measurement rows before recomputing limits, so false calls don't skew them.
 * Integration: seed 10 values, correct 4 to NTF, and assert the advisor's
 * sampleSize drops from 10 (exclusion off) to 6 (exclusion on).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { appRouter } from "../routers";
import * as db from "../db";
import {
  productInspections,
  measurementResults,
  measurementPointDefs,
  measurementCorrections,
} from "../../drizzle/schema";
import { recommendForMeasurementPoint } from "./aiThresholdAdvisor";

const STAMP = Date.now();
const API_KEY = `OP6-${STAMP}`;
const MODEL_CODE = `OP6_MODEL_${STAMP}`;
const POINT_CODE = `OP6_PT_${STAMP}`;

let machineId: number;
let productModelId: number;
let pointDefId: number;
const inspectionIds: number[] = [];
const correctionIds: number[] = [];

let prevEnabled: string | undefined;
let prevExclude: string | undefined;

function caller() {
  return appRouter.createCaller({ user: null } as never);
}

beforeAll(async () => {
  prevEnabled = process.env.AI_THRESHOLD_ADVISOR_ENABLED;
  prevExclude = process.env.AI_THRESHOLD_ADVISOR_EXCLUDE_NTF;
  process.env.AI_THRESHOLD_ADVISOR_ENABLED = "true";

  machineId = await db.createMachine({
    stationId: 1, code: `OP6-${STAMP}`, name: "OP6 advisor corrections test", machineType: "AOI", apiKey: API_KEY, isActive: true,
  });
  productModelId = await db.createProductModel({ code: MODEL_CODE, name: "OP6 test model" });
  pointDefId = await db.createMeasurementPointDef({
    productModelId, code: POINT_CODE, name: "OP6 point", measurementType: "DIMENSION",
    positionX: 10, positionY: 10,
  });

  const d = await db.getDb();
  // 10 numeric values; the first 4 measurement rows will be "corrected" to NTF.
  for (let i = 0; i < 10; i++) {
    const r = await caller().machineApi.submitInspection({
      apiKey: API_KEY,
      serialNumber: `SN-OP6-${STAMP}-${i}`,
      productModel: MODEL_CODE,
      overallResult: "OK",
      measurements: [{ pointCode: POINT_CODE, result: "OK", measuredValue: 10 + (i % 3) * 0.1 }],
    });
    inspectionIds.push(r.inspectionId!);
    const rows = await db.getMeasurementResultsByInspection(r.inspectionId!);
    if (i < 4 && d) {
      const [corr] = await d.insert(measurementCorrections).values({
        measurementResultId: rows[0].id,
        inspectionId: r.inspectionId!,
        machineId,
        pointDefId,
        originalResult: "NG",
        correctedResult: "NTF",
        source: "confirm_ntf",
        operatorUserId: 1,
      }).returning({ id: measurementCorrections.id });
      correctionIds.push(corr.id);
    }
  }
});

afterAll(async () => {
  const d = await db.getDb();
  if (d) {
    if (correctionIds.length) await d.delete(measurementCorrections).where(inArray(measurementCorrections.id, correctionIds));
    if (inspectionIds.length) {
      await d.delete(measurementResults).where(inArray(measurementResults.inspectionId, inspectionIds));
      await d.delete(productInspections).where(inArray(productInspections.id, inspectionIds));
    }
    await d.delete(measurementPointDefs).where(eq(measurementPointDefs.id, pointDefId));
  }
  if (machineId) await db.deleteMachine(machineId);
  if (prevEnabled === undefined) delete process.env.AI_THRESHOLD_ADVISOR_ENABLED; else process.env.AI_THRESHOLD_ADVISOR_ENABLED = prevEnabled;
  if (prevExclude === undefined) delete process.env.AI_THRESHOLD_ADVISOR_EXCLUDE_NTF; else process.env.AI_THRESHOLD_ADVISOR_EXCLUDE_NTF = prevExclude;
});

describe("aiThresholdAdvisor NTF-corrected exclusion (OP6)", () => {
  it("counts all rows when exclusion is OFF", async () => {
    process.env.AI_THRESHOLD_ADVISOR_EXCLUDE_NTF = "false";
    const rec = await recommendForMeasurementPoint({ measurementPointId: pointDefId, windowDays: 3650 });
    expect(rec.sampleSize).toBe(10);
  });

  it("drops the NTF-corrected rows when exclusion is ON (default)", async () => {
    process.env.AI_THRESHOLD_ADVISOR_EXCLUDE_NTF = "true";
    const rec = await recommendForMeasurementPoint({ measurementPointId: pointDefId, windowDays: 3650 });
    expect(rec.sampleSize).toBe(6);
  });
});
