/**
 * W7-A (doc 27 Đợt 7.1 — V1/V5 + migration 0187) — INLINE AI-gate integration
 * tests through the REAL machineApi.submitInspection pipeline against the
 * isolated test DB. Only runInference is mocked (no ONNX model needed):
 *
 *   • the flag-gated post-hook fires AFTER the ingest ACK and stamps
 *     aiDecision/aiConfidence/aiModelId/aiProcessedAt/aiDetails +
 *     ai_quality_gate_results — the same shape as the on-demand UI path;
 *   • ACK latency is unaffected — the ACK resolves while inference is still
 *     pending (fire-and-forget semantics proven, not assumed);
 *   • V5: inline traffic feeds the A/B canary — ab_test_results gets a REAL
 *     row + experiment counters bump when a RUNNING experiment is wired;
 *   • 0187: programReleaseId is stamped when a released program exists for
 *     (product, machine) and stays NULL when none does;
 *   • flag OFF (code default) ⇒ zero behavior change.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { eq, inArray } from "drizzle-orm";

vi.mock("../services/aiInferenceEngine");
// W7-B seam — mocked for determinism (the seam is fail-open either way).
vi.mock("../services/ai/ntfPredictorService", () => ({
  scoreInspectionNtf: vi.fn(async () => undefined),
}));

import * as engine from "../services/aiInferenceEngine";
import { machineApiRouter } from "./machineApiRouters";
import * as db from "../db";
import {
  aiQualityGateConfigs,
  aiQualityGateResults,
  abTestExperiments,
  abTestResults,
  productInspections,
  measurementResults,
  measurementPointDefs,
  inspectionProgramReleases,
} from "../../drizzle/schema";
import { invalidateConfigCache, _resetInlineGateBreaker } from "../services/aiQualityGate";
import type { TrpcContext } from "../_core/context";

const STAMP = Date.now();
const API_KEY = `W7A-INLINE-${STAMP}`;
const PM_CODE = `W7A-PM-${STAMP}`;
const POINT_CODE = `W7A-P-${STAMP}`;
// > 200 chars (submitInspection's minimum for an image payload); content is
// arbitrary bytes — runInference is mocked, so no real image is needed.
const IMG_B64 = Buffer.from(`W7A-fake-defect-image-${STAMP}-`.repeat(12)).toString("base64");

const GATE_MODEL_ID = 990_001;
const CANARY_MODEL_B_ID = 990_002;

let machineId: number;
let productModelId: number;
let configId: number;
let experimentId: number;
let releaseId: number;
const inspectionIds: number[] = [];

const OK_INFERENCE = {
  modelCode: "w7a-mock",
  modelVersion: "v1",
  predictions: [{ label: "ok", confidence: 0.99 }],
  topLabel: "ok",
  confidence: 0.99,
  processingTimeMs: 3,
  status: "COMPLETED" as const,
};

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}

function basePayload(serial: string, over: Record<string, unknown> = {}) {
  return {
    apiKey: API_KEY,
    serialNumber: serial,
    overallResult: "NG" as const,
    measurements: [{ pointCode: POINT_CODE, result: "NG" as const, imageBase64: IMG_B64 }],
    ...over,
  };
}

async function waitForAiDecision(inspectionId: number, expected: string) {
  await vi.waitFor(
    async () => {
      const row = await db.getProductInspectionById(inspectionId);
      expect(row?.aiDecision).toBe(expected);
    },
    { timeout: 15_000, interval: 100 },
  );
}

beforeAll(async () => {
  // Keep image uploads local + throwaway (no network storage in tests).
  process.env.STORAGE_MODE = "local";
  process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `w7a-inline-gate-${STAMP}`);

  machineId = await db.createMachine({
    stationId: 1, // soft-ref pattern used by sibling machineApi tests
    code: `W7A-INLINE-${STAMP}`,
    name: "W7-A inline-gate test machine",
    machineType: "AOI",
    apiKey: API_KEY,
    isActive: true,
  });
  productModelId = await db.createProductModel({ code: PM_CODE, name: "W7-A inline-gate PM" });

  const d = await db.getDb();
  const [cfg] = await d!
    .insert(aiQualityGateConfigs)
    .values({
      name: `W7A inline gate ${STAMP}`,
      machineId,
      productModelId: null, // machine-wide → applies with and without a product
      modelId: GATE_MODEL_ID,
      enabled: true,
      autoOkThreshold: "0.9",
      autoNgThreshold: "0.8",
      reviewThreshold: "0.5",
      ngLabels: ["defect"],
      okLabels: ["ok"],
    })
    .returning({ id: aiQualityGateConfigs.id });
  configId = cfg.id;

  const [exp] = await d!
    .insert(abTestExperiments)
    .values({
      name: `W7A inline canary ${STAMP}`,
      modelAId: GATE_MODEL_ID,
      modelBId: CANARY_MODEL_B_ID,
      trafficSplitPercent: 50,
      status: "RUNNING",
    })
    .returning({ id: abTestExperiments.id });
  experimentId = exp.id;

  // Released inspection program for the 0187 stamping test (product-level scope).
  const [rel] = await d!
    .insert(inspectionProgramReleases)
    .values({
      productModelId,
      machineId: null,
      version: 1,
      status: "released",
      snapshot: { points: [] },
      checksum: `w7a-${STAMP}`,
      pointCount: 0,
      releasedAt: new Date(),
    })
    .returning({ id: inspectionProgramReleases.id });
  releaseId = rel.id;
});

afterAll(async () => {
  const d = await db.getDb();
  if (d) {
    if (inspectionIds.length > 0) {
      await d.delete(measurementResults).where(inArray(measurementResults.inspectionId, inspectionIds));
      await d.delete(aiQualityGateResults).where(inArray(aiQualityGateResults.inspectionId, inspectionIds));
      await d.delete(productInspections).where(inArray(productInspections.id, inspectionIds));
    }
    if (experimentId) {
      await d.delete(abTestResults).where(eq(abTestResults.experimentId, experimentId));
      await d.delete(abTestExperiments).where(eq(abTestExperiments.id, experimentId));
    }
    if (configId) await d.delete(aiQualityGateConfigs).where(eq(aiQualityGateConfigs.id, configId));
    if (releaseId) await d.delete(inspectionProgramReleases).where(eq(inspectionProgramReleases.id, releaseId));
    await d.delete(measurementPointDefs).where(eq(measurementPointDefs.code, POINT_CODE));
  }
  if (productModelId) await db.deleteProductModel(productModelId).catch(() => undefined);
  if (machineId) await db.deleteMachine(machineId);
  invalidateConfigCache();
  delete process.env.AI_INLINE_GATE_ENABLED;
  await fsp.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
});

beforeEach(() => {
  vi.clearAllMocks();
  _resetInlineGateBreaker();
  invalidateConfigCache();
  process.env.AI_INLINE_GATE_ENABLED = "true";
  (engine.runInference as any).mockResolvedValue(OK_INFERENCE);
});

afterEach(() => {
  delete process.env.AI_INLINE_GATE_ENABLED;
});

describe("submitInspection × inline AI gate (V1)", () => {
  it("ACK is not blocked; the hook then stamps the verdict with the on-demand write shape", async () => {
    let releaseGate!: () => void;
    let gateResolved = false;
    (engine.runInference as any).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseGate = () => {
            gateResolved = true;
            resolve(OK_INFERENCE);
          };
        }),
    );

    const caller = machineApiRouter.createCaller(ctx());
    const r = await caller.submitInspection(basePayload(`SN-W7A-${STAMP}-1`));
    expect(r.success).toBe(true);
    expect(r.inspectionId).toBeTruthy();
    inspectionIds.push(r.inspectionId!);

    // Fire-and-forget PROVEN: the machine already has its ACK while the AI
    // inference promise is still unresolved.
    expect(gateResolved).toBe(false);
    const before = await db.getProductInspectionById(r.inspectionId!);
    expect(before?.aiDecision ?? null).toBeNull();

    // The hook must reach the (deferred) inference — then release it.
    await vi.waitFor(() => expect(engine.runInference).toHaveBeenCalled(), { timeout: 10_000 });
    releaseGate();

    await waitForAiDecision(r.inspectionId!, "AUTO_OK");
    const row = await db.getProductInspectionById(r.inspectionId!);
    expect(Number(row!.aiConfidence)).toBeCloseTo(0.99, 3);
    expect(row!.aiModelId).toBe(GATE_MODEL_ID);
    expect(row!.aiProcessedAt).toBeTruthy();
    expect(row!.aiDetails?.predictions?.[0]?.label).toBe("ok");
    expect(row!.aiDetails?.skipped).toBeUndefined();

    const d = await db.getDb();
    const qg = await d!
      .select()
      .from(aiQualityGateResults)
      .where(eq(aiQualityGateResults.inspectionId, r.inspectionId!));
    expect(qg).toHaveLength(1);
    expect(qg[0].decision).toBe("AUTO_OK");
    expect(qg[0].configId).toBe(configId);
  });

  it("V5: inline traffic populates ab_test_results when a RUNNING experiment is wired", async () => {
    const d = await db.getDb();
    await d!
      .update(aiQualityGateConfigs)
      .set({ activeExperimentId: experimentId })
      .where(eq(aiQualityGateConfigs.id, configId));
    invalidateConfigCache();

    try {
      const caller = machineApiRouter.createCaller(ctx());
      const r = await caller.submitInspection(basePayload(`SN-W7A-${STAMP}-2`));
      expect(r.success).toBe(true);
      inspectionIds.push(r.inspectionId!);

      await waitForAiDecision(r.inspectionId!, "AUTO_OK");

      // Canary row recorded from INLINE (machine-initiated, no user) traffic.
      await vi.waitFor(
        async () => {
          const rows = await d!
            .select()
            .from(abTestResults)
            .where(eq(abTestResults.inputReference, String(r.inspectionId!)));
          expect(rows).toHaveLength(1);
          expect(["A", "B"]).toContain(rows[0].variant);
          expect(rows[0].experimentId).toBe(experimentId);
          expect(rows[0].predictions?.length).toBeGreaterThan(0);
        },
        { timeout: 15_000, interval: 100 },
      );

      // Experiment counters stay in sync.
      const [exp] = await d!
        .select()
        .from(abTestExperiments)
        .where(eq(abTestExperiments.id, experimentId));
      expect(exp.totalInferences).toBeGreaterThanOrEqual(1);
      expect(exp.modelAInferences + exp.modelBInferences).toBe(exp.totalInferences);
    } finally {
      await d!
        .update(aiQualityGateConfigs)
        .set({ activeExperimentId: null })
        .where(eq(aiQualityGateConfigs.id, configId));
      invalidateConfigCache();
    }
  });

  it("flag OFF (code default) ⇒ zero behavior change: no inference, no AI fields", async () => {
    delete process.env.AI_INLINE_GATE_ENABLED;

    const caller = machineApiRouter.createCaller(ctx());
    const r = await caller.submitInspection(basePayload(`SN-W7A-${STAMP}-3`));
    expect(r.success).toBe(true);
    inspectionIds.push(r.inspectionId!);

    // Give any (wrongly) scheduled hook ample time to surface.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(engine.runInference).not.toHaveBeenCalled();
    const row = await db.getProductInspectionById(r.inspectionId!);
    expect(row?.aiDecision ?? null).toBeNull();
    expect(row?.aiDetails ?? null).toBeNull();
  });
});

describe("submitInspection × programReleaseId stamping (0187)", () => {
  it("stamps the RELEASED program id when one exists for the product", async () => {
    delete process.env.AI_INLINE_GATE_ENABLED; // stamping is independent of the AI flag

    const caller = machineApiRouter.createCaller(ctx());
    const r = await caller.submitInspection(
      basePayload(`SN-W7A-${STAMP}-4`, { productModel: PM_CODE, measurements: [] }),
    );
    expect(r.success).toBe(true);
    inspectionIds.push(r.inspectionId!);

    const row = await db.getProductInspectionById(r.inspectionId!);
    expect(row?.programReleaseId).toBe(releaseId);
  });

  it("stays NULL when no product model / released program applies", async () => {
    delete process.env.AI_INLINE_GATE_ENABLED;

    const caller = machineApiRouter.createCaller(ctx());
    const r = await caller.submitInspection(
      basePayload(`SN-W7A-${STAMP}-5`, { measurements: [] }), // no productModel
    );
    expect(r.success).toBe(true);
    inspectionIds.push(r.inspectionId!);

    const row = await db.getProductInspectionById(r.inspectionId!);
    expect(row?.programReleaseId ?? null).toBeNull();
  });
});
