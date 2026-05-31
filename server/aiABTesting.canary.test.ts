/**
 * B6 — A/B canary live unit tests.
 *
 * Covers (per plan §B6):
 *   - selectCanaryVariant: traffic split ~% over 1000 ids (±2%); deterministic
 *     (same inspectionId → same variant; idempotent for offline sync).
 *   - runABInference: after N runs, modelAInferences + modelBInferences ==
 *     totalInferences == N, AND the payload passed to updateABTestExperiment uses the
 *     REAL column names (proves the field-name bug is gone).
 *   - concludeExperiment: chi-squared winner (acc 0.80 vs 0.92, n=200 → p<0.05 →
 *     winner B); n<30 → INCONCLUSIVE; payload uses modelA/BAvgLatency (not …Ms).
 *   - evaluateCanaryGuardrail: acc_B < acc_A − δ → shouldRollback + PAUSED.
 *
 * Strategy: mock the data-access (../db/aiAdvanced) and inference engine so no real
 * DB is touched. selectCanaryVariant is exercised for real (pure hash function).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../server/db/aiAdvanced");
vi.mock("../server/services/aiInferenceEngine");
vi.mock("../server/db/ai");

import * as db from "../server/db/aiAdvanced";
import * as engine from "../server/services/aiInferenceEngine";
import {
  selectCanaryVariant,
  runABInference,
  concludeExperiment,
  evaluateCanaryGuardrail,
} from "../server/services/aiABTesting";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("selectCanaryVariant", () => {
  it("splits traffic to ~trafficSplitPercent (±2%) over 1000 ids", () => {
    const exp = { trafficSplitPercent: 30 };
    let bCount = 0;
    for (let id = 1; id <= 1000; id++) {
      if (selectCanaryVariant(exp, id) === "B") bCount++;
    }
    const pctB = (bCount / 1000) * 100;
    expect(pctB).toBeGreaterThanOrEqual(28);
    expect(pctB).toBeLessThanOrEqual(32);
  });

  it("is deterministic — same inspectionId always maps to the same variant", () => {
    const exp = { trafficSplitPercent: 50 };
    for (const id of [1, 42, 777, 123456]) {
      const first = selectCanaryVariant(exp, id);
      for (let k = 0; k < 5; k++) {
        expect(selectCanaryVariant(exp, id)).toBe(first);
      }
    }
  });

  it("routes 0% → all A and 100% → all B", () => {
    for (let id = 1; id <= 50; id++) {
      expect(selectCanaryVariant({ trafficSplitPercent: 0 }, id)).toBe("A");
      expect(selectCanaryVariant({ trafficSplitPercent: 100 }, id)).toBe("B");
    }
  });
});

describe("runABInference counters (field-name bug fix)", () => {
  it("after N runs, modelAInferences + modelBInferences == totalInferences == N with REAL column names", async () => {
    const N = 40;
    // In-memory experiment whose counters are mutated by the mocked update.
    const exp: any = {
      id: 1,
      status: "RUNNING",
      trafficSplitPercent: 50,
      modelAId: 10,
      modelBId: 20,
      modelAVersion: "vA",
      modelBVersion: "vB",
      totalInferences: 0,
      modelAInferences: 0,
      modelBInferences: 0,
    };

    (db.getABTestExperiment as any).mockImplementation(async () => ({ ...exp }));
    (db.createABTestResult as any).mockResolvedValue({ id: 1 });

    const seenPayloadKeys = new Set<string>();
    (db.updateABTestExperiment as any).mockImplementation(async (_id: number, data: any) => {
      for (const k of Object.keys(data)) seenPayloadKeys.add(k);
      // Apply the update so subsequent reads see incremented counters.
      Object.assign(exp, data);
      return { ...exp };
    });

    (engine.runInference as any).mockResolvedValue({
      modelCode: "m",
      modelVersion: "v",
      predictions: [{ label: "OK", confidence: 0.9 }],
      topLabel: "OK",
      confidence: 0.9,
      processingTimeMs: 5,
      status: "COMPLETED",
    });

    for (let i = 0; i < N; i++) {
      await runABInference(1, Buffer.from("x"), { inspectionId: i + 1 });
    }

    // Real schema column names were used (the buggy modelAInferenceCount must NOT appear).
    expect(seenPayloadKeys.has("modelAInferences") || seenPayloadKeys.has("modelBInferences")).toBe(true);
    expect(seenPayloadKeys.has("totalInferences")).toBe(true);
    expect(seenPayloadKeys.has("modelAInferenceCount")).toBe(false);
    expect(seenPayloadKeys.has("modelBInferenceCount")).toBe(false);

    expect(exp.totalInferences).toBe(N);
    expect(exp.modelAInferences + exp.modelBInferences).toBe(N);
    expect(exp.modelAInferences + exp.modelBInferences).toBe(exp.totalInferences);
  });
});

describe("concludeExperiment winner determination", () => {
  function mockExp() {
    (db.getABTestExperiment as any).mockResolvedValue({
      id: 1,
      status: "RUNNING",
      trafficSplitPercent: 50,
      modelAId: 10,
      modelBId: 20,
      modelAVersion: "vA",
      modelBVersion: "vB",
    });
  }

  it("acc 0.80 vs 0.92 with n=200 → p<0.05 → winner B; payload uses modelA/BAvgLatency", async () => {
    mockExp();
    (db.getABTestStats as any).mockResolvedValue({
      modelACount: 200, modelBCount: 200,
      modelAAvgConfidence: 0.8, modelBAvgConfidence: 0.9,
      modelAAvgLatency: 30, modelBAvgLatency: 35,
      modelAAccuracy: 0.8, modelBAccuracy: 0.92,
      modelAFeedbackCount: 200, modelBFeedbackCount: 200,
    });

    let payload: any;
    (db.updateABTestExperiment as any).mockImplementation(async (_id: number, data: any) => {
      payload = data;
      return data;
    });

    const res = await concludeExperiment(1);
    expect(res.significance).not.toBeNull();
    expect(res.significance!).toBeLessThan(0.05);
    expect(res.winner).toBe("B");

    // B6 field-name fix: latency columns must be the real names.
    expect(payload).toHaveProperty("modelAAvgLatency");
    expect(payload).toHaveProperty("modelBAvgLatency");
    expect(payload).not.toHaveProperty("modelAAvgLatencyMs");
    expect(payload).not.toHaveProperty("modelBAvgLatencyMs");
  });

  it("insufficient feedback (n<30) → INCONCLUSIVE", async () => {
    mockExp();
    (db.getABTestStats as any).mockResolvedValue({
      modelACount: 10, modelBCount: 10,
      modelAAvgConfidence: 0.8, modelBAvgConfidence: 0.9,
      modelAAvgLatency: 30, modelBAvgLatency: 35,
      modelAAccuracy: 0.8, modelBAccuracy: 0.92,
      modelAFeedbackCount: 10, modelBFeedbackCount: 10,
    });
    (db.updateABTestExperiment as any).mockResolvedValue({});

    const res = await concludeExperiment(1);
    expect(res.significance).toBeNull();
    expect(res.winner).toBe("INCONCLUSIVE");
  });
});

describe("evaluateCanaryGuardrail", () => {
  it("acc_B < acc_A − δ (enough feedback) → shouldRollback=true and experiment PAUSED", async () => {
    (db.getABTestExperiment as any).mockResolvedValue({
      id: 1, status: "RUNNING", trafficSplitPercent: 50,
      modelAId: 10, modelBId: 20, modelAVersion: "vA", modelBVersion: "vB",
    });
    (db.getABTestStats as any).mockResolvedValue({
      modelACount: 200, modelBCount: 200,
      modelAAvgConfidence: 0.9, modelBAvgConfidence: 0.7,
      modelAAvgLatency: 30, modelBAvgLatency: 32,
      modelAAccuracy: 0.92, modelBAccuracy: 0.70, // gap 0.22 ≫ δ
      modelAFeedbackCount: 200, modelBFeedbackCount: 200,
    });
    let paused = false;
    (db.updateABTestExperiment as any).mockImplementation(async (_id: number, data: any) => {
      if (data.status === "PAUSED") paused = true;
      return data;
    });

    const res = await evaluateCanaryGuardrail(1);
    expect(res.shouldRollback).toBe(true);
    expect(res.paused).toBe(true);
    expect(paused).toBe(true);
    expect(res.reasons.length).toBeGreaterThan(0);
  });

  it("B at least as good → no rollback, stays RUNNING", async () => {
    (db.getABTestExperiment as any).mockResolvedValue({
      id: 1, status: "RUNNING", trafficSplitPercent: 50,
      modelAId: 10, modelBId: 20, modelAVersion: "vA", modelBVersion: "vB",
    });
    (db.getABTestStats as any).mockResolvedValue({
      modelACount: 200, modelBCount: 200,
      modelAAvgConfidence: 0.9, modelBAvgConfidence: 0.92,
      modelAAvgLatency: 30, modelBAvgLatency: 31,
      modelAAccuracy: 0.90, modelBAccuracy: 0.93,
      modelAFeedbackCount: 200, modelBFeedbackCount: 200,
    });
    const updateSpy = db.updateABTestExperiment as any;
    updateSpy.mockResolvedValue({});

    const res = await evaluateCanaryGuardrail(1);
    expect(res.shouldRollback).toBe(false);
    expect(res.paused).toBe(false);
    // No PAUSED write should have happened.
    for (const call of updateSpy.mock.calls) {
      expect(call[1]?.status).not.toBe("PAUSED");
    }
  });
});
