/**
 * Doc 31 Đợt B (WB-2 / OP3) — defect classification honesty at ingest.
 *
 * Integration test against the isolated test DB. Proves:
 *   1. A defect code that IS in defect_catalog resolves → measurement_results
 *      .defectCatalogId is set (this is the field the vision *_DEFECT_MAP
 *      adapters emit — it survives normalize → submitInspection → persist).
 *   2. A defect code that is NOT in the catalog is NOT dropped: the row is still
 *      persisted (defectCatalogId NULL), the raw code is kept in defectCodeRaw,
 *      and it is rolled up into unmatched_defect_codes for curation.
 *
 * Root cause note (verified on dev DB): the 15.6k historical NG rows were 0%
 * classified because the feed that produced them carried NO defect code at all —
 * so the resolver was never entered. The adapter path itself is correct (every
 * *_DEFECT_MAP output code IS seeded). This test locks BOTH: seeded → classified,
 * unseeded → visible+recoverable (never silently dropped).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { appRouter } from "../routers";
import * as db from "../db";
import {
  productInspections,
  measurementResults,
  measurementPointDefs,
  defectCatalog,
  unmatchedDefectCodes,
} from "../../drizzle/schema";

const STAMP = Date.now();
const API_KEY = `WB2-OP3-${STAMP}`;
const MODEL_CODE = `WB2_MODEL_${STAMP}`;
const SEEDED_CODE = `WB2_SEEDED_${STAMP}`;
const BOGUS_CODE = `WB2_BOGUS_${STAMP}`;

let machineId: number;
let productModelId: number;
let seededDefectId: number;
const inspectionIds: number[] = [];

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1,
    code: `WB2-OP3-${STAMP}`,
    name: "WB2 OP3 defect-classification test machine",
    machineType: "AOI",
    apiKey: API_KEY,
    isActive: true,
  });
  productModelId = await db.createProductModel({
    code: MODEL_CODE,
    name: "WB2 OP3 test model",
  });
  seededDefectId = await db.createDefectCatalog({
    code: SEEDED_CODE,
    name: "WB2 seeded bridge",
    severity: "critical",
    category: "solder",
  });
});

afterAll(async () => {
  const d = await db.getDb();
  if (d) {
    if (inspectionIds.length) {
      await d.delete(measurementResults).where(inArray(measurementResults.inspectionId, inspectionIds));
      await d.delete(productInspections).where(inArray(productInspections.id, inspectionIds));
    }
    await d.delete(measurementPointDefs).where(eq(measurementPointDefs.productModelId, productModelId));
    await d.delete(unmatchedDefectCodes).where(eq(unmatchedDefectCodes.code, BOGUS_CODE));
    if (seededDefectId) await d.delete(defectCatalog).where(eq(defectCatalog.id, seededDefectId));
  }
  if (machineId) await db.deleteMachine(machineId);
});

function caller() {
  return appRouter.createCaller({ user: null } as never);
}

describe("submitInspection × defect-catalog classification (OP3)", () => {
  it("a SEEDED defect code resolves → defectCatalogId set, defectCodeRaw null", async () => {
    const r = await caller().machineApi.submitInspection({
      apiKey: API_KEY,
      serialNumber: `SN-OP3-${STAMP}-1`,
      productModel: MODEL_CODE,
      overallResult: "NG",
      measurements: [
        { pointCode: "MP-A", result: "NG", defectCatalogCode: SEEDED_CODE },
      ],
    });
    expect(r.success).toBe(true);
    inspectionIds.push(r.inspectionId!);

    const rows = await db.getMeasurementResultsByInspection(r.inspectionId!);
    expect(rows.length).toBe(1);
    expect(rows[0].defectCatalogId).toBe(seededDefectId);
    expect(rows[0].defectCode).toBe(SEEDED_CODE);
    expect(rows[0].defectCodeRaw).toBeNull();
  });

  it("an UNMATCHED defect code is kept (defectCodeRaw) + rolled up, never dropped", async () => {
    const r = await caller().machineApi.submitInspection({
      apiKey: API_KEY,
      serialNumber: `SN-OP3-${STAMP}-2`,
      productModel: MODEL_CODE,
      overallResult: "NG",
      measurements: [
        { pointCode: "MP-B", result: "NG", defectCatalogCode: BOGUS_CODE },
      ],
    });
    expect(r.success).toBe(true);
    inspectionIds.push(r.inspectionId!);

    // Row persisted (NOT dropped), catalog id null, raw code retained.
    const rows = await db.getMeasurementResultsByInspection(r.inspectionId!);
    expect(rows.length).toBe(1);
    expect(rows[0].defectCatalogId).toBeNull();
    expect(rows[0].defectCodeRaw).toBe(BOGUS_CODE);

    // Telemetry rollup recorded.
    const d = await db.getDb();
    const [tele] = await d!
      .select()
      .from(unmatchedDefectCodes)
      .where(eq(unmatchedDefectCodes.code, BOGUS_CODE))
      .limit(1);
    expect(tele).toBeTruthy();
    expect(tele.seenCount).toBeGreaterThanOrEqual(1);
    expect(tele.machineId).toBe(machineId);
  });

  it("curating the code into the catalog marks the rollup resolved", async () => {
    const adminCtx = { user: { id: 1, role: "admin", twoFactorEnabled: true, name: "Admin" }, req: { ip: null, headers: {} } } as never;
    const c = appRouter.createCaller(adminCtx);
    const created = await c.defectCatalog.create({
      code: BOGUS_CODE,
      name: "WB2 curated defect",
      category: "solder",
      severity: "major",
    });
    expect(created.id).toBeGreaterThan(0);

    const d = await db.getDb();
    const [tele] = await d!
      .select()
      .from(unmatchedDefectCodes)
      .where(eq(unmatchedDefectCodes.code, BOGUS_CODE))
      .limit(1);
    expect(tele.resolvedCatalogId).toBe(created.id);

    // cleanup the curated row
    await d!.delete(defectCatalog).where(eq(defectCatalog.id, created.id));
  });
});
