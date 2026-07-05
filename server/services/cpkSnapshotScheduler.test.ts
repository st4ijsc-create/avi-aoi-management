/**
 * Doc 31 OP9 — the periodic Cpk snapshot job writes cpk_history.
 * Integration: seed a point with spec limits + N measured values, run the job,
 * assert a cpk_history row was written for that point over the window.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { appRouter } from "../routers";
import * as db from "../db";
import {
  productInspections,
  measurementResults,
  measurementPointDefs,
  cpkHistory,
} from "../../drizzle/schema";
import { runCpkSnapshotNow } from "./cpkSnapshotScheduler";

const STAMP = Date.now();
const API_KEY = `OP9-${STAMP}`;
const MODEL_CODE = `OP9_MODEL_${STAMP}`;
const POINT_CODE = `OP9_PT_${STAMP}`;

let machineId: number;
let productModelId: number;
let pointDefId: number;
const inspectionIds: number[] = [];

function caller() {
  return appRouter.createCaller({ user: null } as never);
}

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1, code: `OP9-${STAMP}`, name: "OP9 cpk snapshot test", machineType: "AOI", apiKey: API_KEY, isActive: true,
  });
  productModelId = await db.createProductModel({ code: MODEL_CODE, name: "OP9 test model" });
  pointDefId = await db.createMeasurementPointDef({
    productModelId,
    code: POINT_CODE,
    name: "OP9 dimensional point",
    measurementType: "DIMENSION",
    lowerLimit: "9",
    upperLimit: "11",
    nominalValue: "10",
    positionX: 10,
    positionY: 10,
  });

  // 12 in-spec values around nominal 10 (spread so σ > 0).
  const values = [9.8, 10.1, 9.9, 10.2, 10.0, 9.7, 10.3, 9.95, 10.05, 9.85, 10.15, 10.0];
  for (let i = 0; i < values.length; i++) {
    const r = await caller().machineApi.submitInspection({
      apiKey: API_KEY,
      serialNumber: `SN-OP9-${STAMP}-${i}`,
      productModel: MODEL_CODE,
      overallResult: "OK",
      measurements: [{ pointCode: POINT_CODE, result: "OK", measuredValue: values[i] }],
    });
    inspectionIds.push(r.inspectionId!);
  }
});

afterAll(async () => {
  const d = await db.getDb();
  if (d) {
    await d.delete(cpkHistory).where(eq(cpkHistory.measurementPointDefId, pointDefId));
    if (inspectionIds.length) {
      await d.delete(measurementResults).where(inArray(measurementResults.inspectionId, inspectionIds));
      await d.delete(productInspections).where(inArray(productInspections.id, inspectionIds));
    }
    await d.delete(measurementPointDefs).where(eq(measurementPointDefs.id, pointDefId));
  }
  if (machineId) await db.deleteMachine(machineId);
});

describe("runCpkSnapshotNow (OP9)", () => {
  it("computes + persists a cpk_history snapshot for a capable point", async () => {
    const stats = await runCpkSnapshotNow({ minSamples: 5, windowDays: 3650 });
    expect(stats.snapshotted).toBeGreaterThanOrEqual(1);

    const d = await db.getDb();
    const rows = await d!
      .select()
      .from(cpkHistory)
      .where(eq(cpkHistory.measurementPointDefId, pointDefId));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const snap = rows[rows.length - 1];
    expect(snap.sampleSize).toBe(12);
    expect(Number(snap.usl)).toBe(11);
    expect(Number(snap.lsl)).toBe(9);
    expect(snap.cpk).not.toBeNull();
    expect(Number(snap.mean)).toBeGreaterThan(9);
    expect(Number(snap.mean)).toBeLessThan(11);
  });
});
