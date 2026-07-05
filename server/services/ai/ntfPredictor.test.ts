/**
 * W7-B (doc 27 §9 gap V3) — NTF/false-call predictor tests.
 *
 * Pure pieces (laplaceRate / limitMarginScore / blendSignals) are unit-tested;
 * scoring runs against the ISOLATED test DB (soft-skip when unreachable).
 *
 * Verifies:
 *  - ingest seam contract: scoreInspectionNtf exists, is fail-open (bad id /
 *    disabled env → resolves, never throws), and persists ntfScore;
 *  - seeded repeat-offender (machine, pointDef) history + barely-over value
 *    → HIGH score; fresh point far out of spec → LOW score;
 *  - non-NG inspections are never scored;
 *  - inspectionListProjection exposes ntfScore + searchInspections sortBy
 *    ("ntfScore" DESC NULLS LAST) + inspection.search accepts the param.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initTRPC } from "@trpc/server";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import * as dbApi from "../../db";
import {
  productInspections,
  measurementResults,
  measurementCorrections,
} from "../../../drizzle/schema";
import { inspectionListProjection } from "../../db/inspection";
import { inspectionRouter } from "../../routers/inspectionRouters";
import {
  blendSignals,
  computeNtfScore,
  isNtfPredictorEnabled,
  laplaceRate,
  limitMarginScore,
  ntfBadgeThreshold,
  scoreInspectionNtf,
} from "./ntfPredictorService";

const STAMP = Date.now();
const SERIAL_PREFIX = `V3-NTF-${STAMP}`;

let db: Awaited<ReturnType<typeof getDb>>;
let machineId: number;
let productModelId: number;
let offenderPointId: number; // seeded false-call history
let freshPointId: number;    // no history

async function insertInspection(suffix: string, opts: {
  overall?: "OK" | "NG" | "NTF";
  original?: "OK" | "NG";
} = {}): Promise<number> {
  return dbApi.createProductInspection({
    machineId,
    productModelId,
    serialNumber: `${SERIAL_PREFIX}-${suffix}`,
    overallResult: opts.overall ?? "NG",
    originalResult: opts.original ?? "NG",
    inspectionTime: new Date(),
  });
}

async function insertNgMeasurement(inspectionId: number, pointId: number, value: string): Promise<number> {
  return dbApi.createMeasurementResult({
    inspectionId,
    pointDefId: pointId,
    result: "NG",
    measuredValue: value,
  });
}

beforeAll(async () => {
  db = await getDb();
  if (!db) return;
  const factoryId = await dbApi.createFactory({ code: `TF_V3_${STAMP}`, name: "V3 factory" });
  const workshopId = await dbApi.createWorkshop({ factoryId, code: `TW_V3_${STAMP}`, name: "V3 ws" });
  const lineId = await dbApi.createProductionLine({ workshopId, code: `TL_V3_${STAMP}`, name: "V3 line" });
  const stationId = await dbApi.createStation({ lineId, code: `TS_V3_${STAMP}`, name: "V3 st", sequence: 1 });
  machineId = await dbApi.createMachine({
    stationId,
    code: `TM_V3_${STAMP}`,
    name: "V3 machine",
    machineType: "AOI",
    apiKey: `test_v3_ntf_${STAMP}`,
  });
  productModelId = await dbApi.createProductModel({
    code: `TP_V3_${STAMP}`,
    name: "V3 product",
    version: "1.0",
  });
  offenderPointId = await dbApi.createMeasurementPointDef({
    productModelId,
    code: `MP_V3_OFF_${STAMP}`,
    name: "V3 repeat offender",
    measurementType: "DIMENSION",
    lowerLimit: "1.000000",
    upperLimit: "2.000000",
    positionX: 10,
    positionY: 10,
  });
  freshPointId = await dbApi.createMeasurementPointDef({
    productModelId,
    code: `MP_V3_FRESH_${STAMP}`,
    name: "V3 fresh point",
    measurementType: "DIMENSION",
    lowerLimit: "1.000000",
    upperLimit: "2.000000",
    positionX: 20,
    positionY: 20,
  });

  // ── Seed repeat-offender history: 8 NG inspections at offenderPoint, 7
  // cleared to NTF by humans (+ matching harvested corrections). Machine trend
  // (7d) sees the same 7/8 clears.
  for (let i = 0; i < 8; i++) {
    const cleared = i < 7;
    const histId = await insertInspection(`hist-${i}`, { overall: cleared ? "NTF" : "NG" });
    const mid = await insertNgMeasurement(histId, offenderPointId, "2.010000");
    if (cleared) {
      await db.insert(measurementCorrections).values({
        measurementResultId: mid,
        inspectionId: histId,
        machineId,
        pointDefId: offenderPointId,
        originalResult: "NG",
        correctedResult: "NTF",
        source: "confirm_ntf",
        operatorUserId: 970_201,
      });
    }
  }
});

afterAll(async () => {
  if (!db) return;
  const inspIds = (
    await db.select({ id: productInspections.id }).from(productInspections)
      .where(sql`${productInspections.serialNumber} LIKE ${SERIAL_PREFIX + "%"}`)
  ).map((r) => r.id);
  if (inspIds.length > 0) {
    await db.delete(measurementCorrections).where(inArray(measurementCorrections.inspectionId, inspIds));
    await db.delete(measurementResults).where(inArray(measurementResults.inspectionId, inspIds));
    await db.delete(productInspections).where(inArray(productInspections.id, inspIds));
  }
});

// ─── Pure heuristic pieces ───────────────────────────────────────────────────

describe("heuristic v1 building blocks (pure)", () => {
  it("laplaceRate smooths thin history toward 0.5", () => {
    expect(laplaceRate(0, 0)).toBe(0.5);
    expect(laplaceRate(7, 8)).toBeCloseTo(0.8, 5);
    expect(laplaceRate(0, 8)).toBeCloseTo(0.1, 5);
  });

  it("limitMarginScore: barely-over → high, far-out → low, no limits → null", () => {
    expect(limitMarginScore(2.01, 1, 2)).toBe(0.9);           // 1% overshoot of width 1
    expect(limitMarginScore(10, 1, 2)).toBe(0.05);            // 8x width outside
    const mid = limitMarginScore(2.26, 1, 2);                 // 26% overshoot → linear zone
    expect(mid).toBeGreaterThan(0.05);
    expect(mid).toBeLessThan(0.9);
    expect(limitMarginScore(1.5, 1, 2)).toBeNull();           // inside limits (attribute NG)
    expect(limitMarginScore(2.01, null, null)).toBeNull();    // no limits
    expect(limitMarginScore(0.98, 1, null)).not.toBeNull();   // single-limit fallback works
  });

  it("blendSignals renormalizes over available signals and clamps", () => {
    expect(blendSignals({ repeatOffender: null, limitMargin: null, machineTrend: null })).toBeNull();
    expect(blendSignals({ repeatOffender: 0.8, limitMargin: null, machineTrend: null })).toBe(0.8);
    const s = blendSignals({ repeatOffender: 0.8, limitMargin: 0.9, machineTrend: 0.8 });
    expect(s).toBeCloseTo((0.5 * 0.8 + 0.3 * 0.9 + 0.2 * 0.8) / 1, 4);
  });

  it("env gates: predictor default ON, badge threshold default 0.7", () => {
    expect(isNtfPredictorEnabled()).toBe(true);
    expect(ntfBadgeThreshold()).toBe(0.7);
  });
});

// ─── Seam contract + DB scoring ──────────────────────────────────────────────

describe("scoreInspectionNtf ingest seam (W7-A contract)", () => {
  it("is exported and FAIL-OPEN: nonexistent id resolves without throwing", async () => {
    expect(typeof scoreInspectionNtf).toBe("function");
    await expect(scoreInspectionNtf(2_000_000_000)).resolves.toBeUndefined();
  });

  it("respects NTF_PREDICTOR_ENABLED=false (no-op, no write)", async () => {
    if (!db) return;
    const inspectionId = await insertInspection("gated");
    await insertNgMeasurement(inspectionId, offenderPointId, "2.010000");
    process.env.NTF_PREDICTOR_ENABLED = "false";
    try {
      await expect(scoreInspectionNtf(inspectionId)).resolves.toBeUndefined();
      const [row] = await db.select().from(productInspections).where(eq(productInspections.id, inspectionId));
      expect(row.ntfScore).toBeNull();
    } finally {
      delete process.env.NTF_PREDICTOR_ENABLED;
    }
  });

  it("repeat-offender point + barely-over value → HIGH score, persisted", async () => {
    if (!db) return;
    const inspectionId = await insertInspection("hot");
    await insertNgMeasurement(inspectionId, offenderPointId, "2.010000"); // 1% over usl

    const computed = await computeNtfScore(inspectionId);
    expect(computed).not.toBeNull();
    expect(computed!.score).toBeGreaterThanOrEqual(0.6);
    expect(computed!.signals.repeatOffender).toBeGreaterThan(0.6);
    expect(computed!.signals.limitMargin).toBe(0.9);

    await scoreInspectionNtf(inspectionId);
    const [row] = await db.select().from(productInspections).where(eq(productInspections.id, inspectionId));
    expect(row.ntfScore).not.toBeNull();
    expect(Number(row.ntfScore)).toBeCloseTo(computed!.score, 3);
  });

  it("fresh point far out of spec → LOW score", async () => {
    if (!db) return;
    const inspectionId = await insertInspection("cold");
    await insertNgMeasurement(inspectionId, freshPointId, "10.000000"); // 8x width outside

    const computed = await computeNtfScore(inspectionId);
    expect(computed).not.toBeNull();
    expect(computed!.signals.limitMargin).toBe(0.05);
    expect(computed!.score).toBeLessThan(0.6);
    // And strictly below the badge threshold — a far-out real defect must
    // never be badged as a suspected false call by the margin signal.
    expect(computed!.score).toBeLessThan(ntfBadgeThreshold());
  });

  it("never scores a non-NG inspection", async () => {
    if (!db) return;
    const okId = await insertInspection("ok", { overall: "OK", original: "OK" });
    expect(await computeNtfScore(okId)).toBeNull();
    await scoreInspectionNtf(okId);
    const [row] = await db.select().from(productInspections).where(eq(productInspections.id, okId));
    expect(row.ntfScore).toBeNull();
  });
});

// ─── Queue projection + sort ─────────────────────────────────────────────────

describe("History queue integration (projection + sort)", () => {
  it("inspectionListProjection includes ntfScore (W4-C column set + 1)", () => {
    expect(Object.keys(inspectionListProjection)).toContain("ntfScore");
  });

  it("searchInspections sortBy='ntfScore' orders DESC NULLS LAST", async () => {
    if (!db) return;
    // Deterministic scores on two rows of this test's machine; the "cold"/"ok"
    // rows keep NULL. Search is scoped by our unique machine code.
    const hi = await insertInspection("sort-hi");
    const lo = await insertInspection("sort-lo");
    await db.update(productInspections).set({ ntfScore: 0.95 }).where(eq(productInspections.id, hi));
    await db.update(productInspections).set({ ntfScore: 0.2 }).where(eq(productInspections.id, lo));

    const res = await dbApi.searchInspections({
      machineCode: `TM_V3_${STAMP}`,
      result: "NG",
      sortBy: "ntfScore",
      limit: 100,
      userRole: "admin",
    });
    const scores = res.data.map((r: any) => (r.ntfScore == null ? null : Number(r.ntfScore)));
    expect(scores[0]).toBeCloseTo(0.95, 5);
    // All non-null scores are sorted DESC and precede all NULLs.
    const firstNull = scores.findIndex((s) => s == null);
    const nonNull = (firstNull === -1 ? scores : scores.slice(0, firstNull)) as number[];
    expect([...nonNull].sort((a, b) => b - a)).toEqual(nonNull);
    if (firstNull !== -1) {
      expect(scores.slice(firstNull).every((s) => s == null)).toBe(true);
    }
  });

  it("inspection.search accepts the sortBy param end-to-end", async () => {
    if (!db) return;
    const t = initTRPC.context<any>().create();
    const caller = t.createCallerFactory(inspectionRouter)({
      user: { id: 970_301, name: "V3 Search", role: "admin" },
    });
    const res = await caller.search({ machineCode: `TM_V3_${STAMP}`, sortBy: "ntfScore", limit: 10 });
    expect(res).toHaveProperty("data");
    expect(res).toHaveProperty("total");
  });
});
