/**
 * Doc 31 Đợt B (WB-2 / MP3) — __UNMAPPED__ unmatched-rate metric + bulk remap.
 *
 * Integration test against the isolated test DB. Proves:
 *   • computeUnmappedPointRate math: rate = results-under-__UNMAPPED__ / total
 *     (filtered by machine so the assertion is deterministic).
 *   • remapMeasurementPoints: a same-code target def is MERGED (its results are
 *     re-pointed to the target def, the empty unmapped def is retired); a def
 *     with no match is MOVED to the target model. After remap the machine's
 *     unmatched rate drops to 0.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import * as db from "../db";
import { getUnmappedProductModelId } from "./measurementPointResolver";
import {
  productInspections,
  measurementResults,
  measurementPointDefs,
  productModels,
} from "../../drizzle/schema";

const STAMP = Date.now();
const TGT_CODE = `WB2_TGT_${STAMP}`;

let machineId: number;
let unmappedModelId: number;
let targetModelId: number;
let tgtDefR1: number;
let unmappedR1: number;
let unmappedR99: number;
const inspectionIds: number[] = [];

async function newInspection(serialSuffix: string): Promise<number> {
  const id = await db.createProductInspection({
    machineId,
    serialNumber: `SN-MP3-${STAMP}-${serialSuffix}`,
    overallResult: "NG",
    originalResult: "NG",
    inspectionTime: new Date(),
  });
  inspectionIds.push(id);
  return id;
}

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1,
    code: `WB2-MP3-${STAMP}`,
    name: "WB2 MP3 remap test machine",
    machineType: "AOI",
    apiKey: `WB2-MP3-${STAMP}`,
    isActive: true,
  });

  // Ensure the synthetic __UNMAPPED__ model exists (get-or-create).
  const existing = await db.getProductModelByCode("__UNMAPPED__");
  unmappedModelId = existing ? existing.id : await db.createProductModel({
    code: "__UNMAPPED__",
    name: "Unmapped (auto-provisioned) measurement points",
  });

  targetModelId = await db.createProductModel({ code: TGT_CODE, name: "WB2 MP3 target model" });

  // Target has an active def "R1" (merge target for the unmapped R1).
  tgtDefR1 = await db.createMeasurementPointDef({
    productModelId: targetModelId, machineId, code: "R1", name: "R1 target",
    measurementType: "VISUAL", positionX: 0, positionY: 0,
  });

  // Two __UNMAPPED__ defs: R1 (will MERGE) and R99 (will MOVE).
  unmappedR1 = await db.createMeasurementPointDef({
    productModelId: unmappedModelId, machineId, code: "R1", name: "R1 unmapped",
    measurementType: "VISUAL", positionX: 0, positionY: 0,
  });
  unmappedR99 = await db.createMeasurementPointDef({
    productModelId: unmappedModelId, machineId, code: "R99", name: "R99 unmapped",
    measurementType: "VISUAL", positionX: 0, positionY: 0,
  });

  // Results: 1 under unmappedR1, 1 under unmappedR99 (both unmatched),
  // 1 under the real target def (matched). total=3, unmatched=2 for this machine.
  const i1 = await newInspection("a");
  const i2 = await newInspection("b");
  const i3 = await newInspection("c");
  await db.createMeasurementResults([
    { inspectionId: i1, pointDefId: unmappedR1, result: "NG" },
    { inspectionId: i2, pointDefId: unmappedR99, result: "NG" },
    { inspectionId: i3, pointDefId: tgtDefR1, result: "NG" },
  ]);
});

afterAll(async () => {
  const d = await db.getDb();
  if (d) {
    if (inspectionIds.length) {
      await d.delete(measurementResults).where(inArray(measurementResults.inspectionId, inspectionIds));
      await d.delete(productInspections).where(inArray(productInspections.id, inspectionIds));
    }
    await d.delete(measurementPointDefs).where(inArray(measurementPointDefs.id, [tgtDefR1, unmappedR1, unmappedR99].filter(Boolean)));
    await d.delete(productModels).where(eq(productModels.id, targetModelId));
  }
  if (machineId) await db.deleteMachine(machineId);
});

describe("MP3 — unmatched-rate metric", () => {
  it("computes rate = unmatched / total for a machine (2 of 3)", async () => {
    const m = await db.computeUnmappedPointRate({ unmappedModelId, machineId });
    expect(m.total).toBe(3);
    expect(m.unmatched).toBe(2);
    expect(m.rate).toBeCloseTo(2 / 3, 5);
    expect(m.byMachine.find((x) => x.machineId === machineId)?.unmatched).toBe(2);
  });

  it("resolver getUnmappedProductModelId is a read-only getter", async () => {
    const id = await getUnmappedProductModelId();
    expect(id).toBe(unmappedModelId);
  });
});

describe("MP3 — bulk remap", () => {
  it("MERGES a same-code def and MOVES an unmatched one; rate → 0 after", async () => {
    const summary = await db.remapMeasurementPoints({
      pointDefIds: [unmappedR1, unmappedR99],
      targetProductModelId: targetModelId,
      unmappedModelId,
    });
    expect(summary.merged).toBe(1);          // R1 → merged into target R1
    expect(summary.moved).toBe(1);           // R99 → moved to target
    expect(summary.resultsReassigned).toBe(1); // the one result under unmapped R1

    // The unmapped R1 def is retired (soft-deleted); its result now points to target R1.
    const [mergedDef] = await (await db.getDb())!
      .select().from(measurementPointDefs).where(eq(measurementPointDefs.id, unmappedR1)).limit(1);
    expect(mergedDef.deletedAt).not.toBeNull();

    const [movedDef] = await (await db.getDb())!
      .select().from(measurementPointDefs).where(eq(measurementPointDefs.id, unmappedR99)).limit(1);
    expect(movedDef.productModelId).toBe(targetModelId);
    expect(movedDef.deletedAt).toBeNull();

    // After remap, none of this machine's results are under __UNMAPPED__.
    const after = await db.computeUnmappedPointRate({ unmappedModelId, machineId });
    expect(after.unmatched).toBe(0);
    expect(after.rate).toBe(0);
    expect(after.total).toBe(3); // results preserved (nothing dropped)
  });
});
