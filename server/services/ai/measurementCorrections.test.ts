/**
 * W7-B (doc 27 §9 gap V2) — operator-correction harvest integration tests.
 *
 * Runs against the ISOLATED test DB (vitest.setup.ts rewrites DATABASE_URL to
 * <db>_test; migration 0188 applied via scripts/apply-migration-0188.mjs).
 * Tests soft-skip when no DB is reachable.
 *
 * Verifies:
 *  - correctResult keeps its ORIGINAL behaviour (result overwrite + remark +
 *    overall recalculation) AND additionally banks a measurement_corrections
 *    row + an ai_label_queue LABELED row (image present);
 *  - a no-op correction (same verdict) harvests nothing;
 *  - confirmNTF keeps its original behaviour AND harvests one correction per
 *    NG measurement (source confirm_ntf);
 *  - agreement math: getMachineFalseCallSummary / getAgreementTrend counts;
 *  - training export source: getCorrectionTrainingSamples shape.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initTRPC } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import * as dbApi from "../../db";
import {
  productInspections,
  measurementResults,
  measurementCorrections,
  aiLabelQueue,
} from "../../../drizzle/schema";
import { inspectionRouter, measurementResultRouter } from "../../routers/inspectionRouters";
import {
  getAgreementTrend,
  getCorrectionTrainingSamples,
  getMachineFalseCallSummary,
  recordCorrection,
} from "./measurementCorrectionsService";

const TEST_USER_ID = 970_101;
const STAMP = Date.now();
const SERIAL_PREFIX = `V2-CORR-${STAMP}`;

const t = initTRPC.context<any>().create();
const makeMeasurementCaller = t.createCallerFactory(measurementResultRouter);
const makeInspectionCaller = t.createCallerFactory(inspectionRouter);
// qualityProcedure = role admin/supervisor/quality_inspector + 2FA enabled.
const qcUser = { id: TEST_USER_ID, name: "V2 Tester", role: "admin", twoFactorEnabled: true };
const measurementCaller = makeMeasurementCaller({ user: qcUser });
const inspectionCaller = makeInspectionCaller({ user: qcUser });

let db: Awaited<ReturnType<typeof getDb>>;
let machineId: number;
let productModelId: number;
let pointDefId: number;

async function insertInspection(suffix: string, overall: "OK" | "NG" | "NTF" = "NG"): Promise<number> {
  return dbApi.createProductInspection({
    machineId,
    productModelId,
    serialNumber: `${SERIAL_PREFIX}-${suffix}`,
    overallResult: overall,
    originalResult: overall === "OK" ? "OK" : "NG",
    inspectionTime: new Date(),
  });
}

async function insertMeasurement(inspectionId: number, opts: {
  result?: "OK" | "NG" | "NTF";
  imageUrl?: string | null;
  imageKey?: string | null;
  measuredValue?: string;
} = {}): Promise<number> {
  return dbApi.createMeasurementResult({
    inspectionId,
    pointDefId,
    result: opts.result ?? "NG",
    measuredValue: opts.measuredValue ?? "2.500000",
    imageUrl: opts.imageUrl === undefined ? `https://img.local/${SERIAL_PREFIX}.jpg` : opts.imageUrl,
    imageKey: opts.imageKey === undefined ? `key/${SERIAL_PREFIX}.jpg` : opts.imageKey,
  });
}

beforeAll(async () => {
  db = await getDb();
  if (!db) return;
  const factoryId = await dbApi.createFactory({ code: `TF_V2_${STAMP}`, name: "V2 factory" });
  const workshopId = await dbApi.createWorkshop({ factoryId, code: `TW_V2_${STAMP}`, name: "V2 ws" });
  const lineId = await dbApi.createProductionLine({ workshopId, code: `TL_V2_${STAMP}`, name: "V2 line" });
  const stationId = await dbApi.createStation({ lineId, code: `TS_V2_${STAMP}`, name: "V2 st", sequence: 1 });
  machineId = await dbApi.createMachine({
    stationId,
    code: `TM_V2_${STAMP}`,
    name: "V2 machine",
    machineType: "AOI",
    apiKey: `test_v2_corr_${STAMP}`,
  });
  productModelId = await dbApi.createProductModel({
    code: `TP_V2_${STAMP}`,
    name: "V2 product",
    version: "1.0",
  });
  pointDefId = await dbApi.createMeasurementPointDef({
    productModelId,
    code: `MP_V2_${STAMP}`,
    name: "V2 point",
    measurementType: "DIMENSION",
    lowerLimit: "1.000000",
    upperLimit: "2.000000",
    positionX: 10,
    positionY: 10,
  });
});

afterAll(async () => {
  if (!db) return;
  const inspIds = (
    await db.select({ id: productInspections.id }).from(productInspections)
      .where(sql`${productInspections.serialNumber} LIKE ${SERIAL_PREFIX + "%"}`)
  ).map((r) => r.id);
  if (inspIds.length > 0) {
    await db.delete(aiLabelQueue).where(inArray(aiLabelQueue.inspectionId, inspIds));
    await db.delete(measurementCorrections).where(inArray(measurementCorrections.inspectionId, inspIds));
    await db.delete(measurementResults).where(inArray(measurementResults.inspectionId, inspIds));
    await db.delete(productInspections).where(inArray(productInspections.id, inspIds));
  }
});

describe("correctResult harvest (V2) — original behaviour unchanged + corrections banked", () => {
  it("overwrites result + remark, recalculates overall, AND banks a correction + label-queue row", async () => {
    if (!db) return; // soft skip
    const inspectionId = await insertInspection("a1", "NG");
    const ngMeasurementId = await insertMeasurement(inspectionId, { result: "NG" });
    await insertMeasurement(inspectionId, { result: "OK" });

    const res = await measurementCaller.correctResult({
      id: ngMeasurementId,
      result: "NTF",
      reason: "Bụi trên board",
    });
    // ── original behaviour ──
    expect(res.success).toBe(true);
    expect(res.newOverallResult).toBe("NTF"); // NG point cleared → NTF wins over OK
    const [m] = await db.select().from(measurementResults).where(eq(measurementResults.id, ngMeasurementId));
    expect(m.result).toBe("NTF");
    expect(m.remark).toContain("Bụi trên board");
    const [insp] = await db.select().from(productInspections).where(eq(productInspections.id, inspectionId));
    expect(insp.overallResult).toBe("NTF");

    // ── harvest (additive) ──
    const corrections = await db.select().from(measurementCorrections)
      .where(eq(measurementCorrections.inspectionId, inspectionId));
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({
      measurementResultId: ngMeasurementId,
      machineId,
      pointDefId,
      originalResult: "NG",
      correctedResult: "NTF",
      source: "correct_result",
      operatorUserId: TEST_USER_ID,
      reason: "Bụi trên board",
    });
    expect(corrections[0].imageKey).toBeTruthy(); // image ref snapshotted

    const queueRows = await db.select().from(aiLabelQueue)
      .where(and(eq(aiLabelQueue.inspectionId, inspectionId), eq(aiLabelQueue.status, "LABELED")));
    expect(queueRows).toHaveLength(1);
    expect(queueRows[0].humanLabel).toBe("NTF");
    expect(queueRows[0].predictedLabel).toBe("NG");
    expect(queueRows[0].reviewedBy).toBe(TEST_USER_ID);
    expect((queueRows[0].metadata as any)?.source).toBe("operator_correction");
  });

  it("no-op correction (same verdict) harvests nothing", async () => {
    if (!db) return;
    const inspectionId = await insertInspection("a2", "NG");
    const measurementId = await insertMeasurement(inspectionId, { result: "NG" });

    await measurementCaller.correctResult({ id: measurementId, result: "NG", reason: "re-confirm" });

    const corrections = await db.select().from(measurementCorrections)
      .where(eq(measurementCorrections.inspectionId, inspectionId));
    expect(corrections).toHaveLength(0);
  });

  it("recordCorrection is fail-open on nonsense input (never throws)", async () => {
    const result = await recordCorrection({
      measurementResultId: null,
      inspectionId: -1,
      machineId: -1,
      pointDefId: null,
      originalResult: "NG",
      correctedResult: "NG", // no-op path
      operatorUserId: TEST_USER_ID,
      source: "correct_result",
    });
    expect(result.skipped).toBe(true);
  });
});

describe("confirmNTF harvest (V2)", () => {
  it("keeps NTF stamps AND harvests one correction per NG measurement (source confirm_ntf)", async () => {
    if (!db) return;
    const inspectionId = await insertInspection("b1", "NG");
    const ng1 = await insertMeasurement(inspectionId, { result: "NG" });
    const ng2 = await insertMeasurement(inspectionId, { result: "NG", imageUrl: null, imageKey: null });
    await insertMeasurement(inspectionId, { result: "OK" });

    const res = await inspectionCaller.confirmNTF({ id: inspectionId, reason: "Khách xác nhận không lỗi" });
    expect(res.success).toBe(true);

    // ── original behaviour ──
    const [insp] = await db.select().from(productInspections).where(eq(productInspections.id, inspectionId));
    expect(insp.overallResult).toBe("NTF");
    expect(insp.ntfConfirmedBy).toBe(TEST_USER_ID);
    expect(insp.ntfReason).toBe("Khách xác nhận không lỗi");

    // ── harvest ──
    const corrections = await db.select().from(measurementCorrections)
      .where(eq(measurementCorrections.inspectionId, inspectionId));
    expect(corrections).toHaveLength(2); // one per NG measurement, OK row untouched
    expect(new Set(corrections.map((c) => c.measurementResultId))).toEqual(new Set([ng1, ng2]));
    for (const c of corrections) {
      expect(c.source).toBe("confirm_ntf");
      expect(c.originalResult).toBe("NG");
      expect(c.correctedResult).toBe("NTF");
    }
    // Label queue only for the measurement WITH an image (imageUrl NOT NULL there).
    const queueRows = await db.select().from(aiLabelQueue)
      .where(eq(aiLabelQueue.inspectionId, inspectionId));
    expect(queueRows).toHaveLength(1);
    expect(queueRows[0].measurementResultId).toBe(ng1);
  });
});

describe("agreement metrics (V2)", () => {
  const start = new Date(Date.now() - 86_400_000);
  const end = new Date(Date.now() + 86_400_000);

  it("getMachineFalseCallSummary: falseCallRate/agreement/harvested counts add up", async () => {
    if (!db) return;
    // Window so far (this machine): a1 NG→NTF (cleared), a2 NG kept NG,
    // b1 NG→NTF (cleared). Add one untouched NG for a clean denominator.
    await insertInspection("c1", "NG");

    const rows = await getMachineFalseCallSummary({ startDate: start, endDate: end, machineId });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.machineId).toBe(machineId);
    expect(r.ngCalls).toBe(4); // a1, a2, b1, c1
    expect(r.humanCleared).toBe(2); // a1, b1
    expect(r.falseCallRate).toBe(50);
    // reviewed = cleared (2) + acknowledged (0) → agreement = 1 − 2/2 = 0%.
    expect(r.reviewed).toBe(2);
    expect(r.agreementRate).toBe(0);
    expect(r.correctionsHarvested).toBe(3); // 1 (correctResult) + 2 (confirmNTF)
  });

  it("getAgreementTrend returns factory-local day buckets with consistent counts", async () => {
    if (!db) return;
    const trend = await getAgreementTrend({ startDate: start, endDate: end, machineId });
    expect(trend.length).toBeGreaterThanOrEqual(1);
    const totalNg = trend.reduce((a, p) => a + p.ngCalls, 0);
    const totalCleared = trend.reduce((a, p) => a + p.humanCleared, 0);
    const totalCorr = trend.reduce((a, p) => a + p.correctionsHarvested, 0);
    expect(totalNg).toBe(4);
    expect(totalCleared).toBe(2);
    expect(totalCorr).toBe(3);
    expect(trend[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("getCorrectionTrainingSamples exposes machineLabel/humanLabel + image snapshot", async () => {
    if (!db) return;
    const samples = await getCorrectionTrainingSamples({ limit: 100 });
    const mine = samples.filter((s) => s.machineId === machineId);
    expect(mine.length).toBe(3);
    for (const s of mine) {
      expect(s.machineLabel).toBe("NG");
      expect(s.humanLabel).toBe("NTF");
      expect(s.correctedBy).toBe(TEST_USER_ID);
      expect(["correct_result", "confirm_ntf"]).toContain(s.source);
    }
    expect(mine.some((s) => s.imageKey)).toBe(true);
  });
});
