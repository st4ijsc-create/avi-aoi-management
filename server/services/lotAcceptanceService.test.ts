/**
 * Doc 31 OP5 (decision #3) — AQL lot-acceptance tests.
 *  • Pure: sample-size derivation (Z1.4 Level II), plan resolution, Ac/Re decision.
 *  • DB integration: a real lot (batchNumber) is accepted/rejected/pending per plan.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { appRouter } from "../routers";
import * as db from "../db";
import {
  productInspections,
  measurementResults,
  samplingPlans,
} from "../../drizzle/schema";
import {
  resolveAcceptancePlan,
  decideDisposition,
  z1_4SampleSize,
  evaluateLotAcceptance,
} from "./lotAcceptanceService";

describe("z1_4SampleSize (ANSI/ASQ Z1.4 General Level II)", () => {
  it("maps lot size → code letter + sample size", () => {
    expect(z1_4SampleSize(10)).toEqual({ letter: "B", sampleSize: 3 });
    expect(z1_4SampleSize(100)).toEqual({ letter: "F", sampleSize: 20 });
    expect(z1_4SampleSize(1000)).toEqual({ letter: "J", sampleSize: 80 });
  });
  it("never samples more than the lot", () => {
    expect(z1_4SampleSize(2).sampleSize).toBe(2);
  });
});

describe("resolveAcceptancePlan", () => {
  const base = { id: 1, code: "P", strategy: "aql", lotSize: null, aqlCritical: null, aqlMajor: "1.0", aqlMinor: null, sampleSize: null, acceptanceQty: null, rejectionQty: null };

  it("prefers explicit sampleSize + Ac/Re", () => {
    const r = resolveAcceptancePlan({ ...base, sampleSize: 50, acceptanceQty: 2, rejectionQty: 3 });
    expect(r).toMatchObject({ sampleSize: 50, acceptNumber: 2, rejectNumber: 3, source: "explicit" });
  });

  it("derives Z1.4 sample size + c=0 when only AQL + lot size given", () => {
    const r = resolveAcceptancePlan({ ...base, lotSize: 500 }, 500);
    expect(r.source).toBe("z1.4_c0");
    expect(r.sampleSize).toBe(50); // code H
    expect(r.acceptNumber).toBe(0);
    expect(r.rejectNumber).toBe(1);
  });

  it("forces Re > Ac", () => {
    const r = resolveAcceptancePlan({ ...base, sampleSize: 20, acceptanceQty: 5, rejectionQty: 5 });
    expect(r.rejectNumber).toBeGreaterThan(r.acceptNumber);
  });
});

describe("decideDisposition", () => {
  const plan = { sampleSize: 5, acceptNumber: 0, rejectNumber: 1, source: "explicit" as const };

  it("pending when the lot hasn't reached the sample size", () => {
    expect(decideDisposition(plan, 3, 3, 0)).toBe("pending");
  });
  it("accept when defectives ≤ Ac", () => {
    expect(decideDisposition(plan, 5, 5, 0)).toBe("accept");
  });
  it("reject when defectives ≥ Re", () => {
    expect(decideDisposition(plan, 5, 5, 1)).toBe("reject");
  });
  it("continue (pending) between Ac and Re when Re > Ac+1", () => {
    const p2 = { sampleSize: 10, acceptNumber: 1, rejectNumber: 3, source: "explicit" as const };
    expect(decideDisposition(p2, 10, 10, 2)).toBe("pending");
  });
});

// ── DB integration ────────────────────────────────────────────────────────────
const STAMP = Date.now();
const API_KEY = `OP5-${STAMP}`;
const MODEL_CODE = `OP5_MODEL_${STAMP}`;
const ACCEPT_BATCH = `LOT_ACC_${STAMP}`;
const REJECT_BATCH = `LOT_REJ_${STAMP}`;
const PENDING_BATCH = `LOT_PEND_${STAMP}`;

let machineId: number;
let productModelId: number;
let planId: number;
const inspectionIds: number[] = [];

async function submit(batch: string, overall: "OK" | "NG", n: number) {
  for (let i = 0; i < n; i++) {
    const r = await caller().machineApi.submitInspection({
      apiKey: API_KEY,
      serialNumber: `SN-${batch}-${i}`,
      productModel: MODEL_CODE,
      batchNumber: batch,
      overallResult: overall,
      measurements: [{ pointCode: "MP-X", result: overall === "NG" ? "NG" : "OK" }],
    });
    inspectionIds.push(r.inspectionId!);
  }
}

function caller() {
  return appRouter.createCaller({ user: null } as never);
}

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1, code: `OP5-${STAMP}`, name: "OP5 lot-accept test", machineType: "AOI", apiKey: API_KEY, isActive: true,
  });
  productModelId = await db.createProductModel({ code: MODEL_CODE, name: "OP5 test model" });
  planId = await db.createSamplingPlan({
    productModelId, code: `AQL-${STAMP}`, name: "AQL c=0 n=5", strategy: "aql",
    sampleSize: 5, acceptanceQty: 0, rejectionQty: 1, aqlMajor: "1.0", isActive: true,
  });
  // Accept lot: 5 OK. Reject lot: 4 OK + 1 NG. Pending lot: 3 OK (< sample size 5).
  await submit(ACCEPT_BATCH, "OK", 5);
  await submit(REJECT_BATCH, "OK", 4);
  await submit(REJECT_BATCH, "NG", 1);
  await submit(PENDING_BATCH, "OK", 3);
});

afterAll(async () => {
  const d = await db.getDb();
  if (d) {
    if (inspectionIds.length) {
      await d.delete(measurementResults).where(inArray(measurementResults.inspectionId, inspectionIds));
      await d.delete(productInspections).where(inArray(productInspections.id, inspectionIds));
    }
    if (planId) await d.delete(samplingPlans).where(eq(samplingPlans.id, planId));
  }
  if (machineId) await db.deleteMachine(machineId);
});

describe("evaluateLotAcceptance (DB)", () => {
  it("accepts a clean lot (0 defectives ≤ Ac)", async () => {
    const r = await evaluateLotAcceptance({ productModelId, batchNumber: ACCEPT_BATCH });
    expect(r.inspected).toBe(5);
    expect(r.defectives).toBe(0);
    expect(r.plan?.sampleSize).toBe(5);
    expect(r.disposition).toBe("accept");
  });

  it("rejects a lot with a defective in the sample (≥ Re)", async () => {
    const r = await evaluateLotAcceptance({ productModelId, batchNumber: REJECT_BATCH });
    expect(r.inspected).toBe(5);
    expect(r.defectives).toBe(1);
    expect(r.disposition).toBe("reject");
  });

  it("marks a lot pending when fewer than the sample size are inspected", async () => {
    const r = await evaluateLotAcceptance({ productModelId, batchNumber: PENDING_BATCH });
    expect(r.inspected).toBe(3);
    expect(r.disposition).toBe("pending");
  });
});
