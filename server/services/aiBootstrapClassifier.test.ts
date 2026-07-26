/**
 * doc 69 Wave 6 (F1) — bootstrapFirstClassifier orchestration.
 *
 * Every DB/trainer/eval touchpoint is injected — NO GPU training, NO ONNX
 * session, NO live DB is ever exercised here (matches the brief: "verify by
 * unit tests with the trainer/eval MOCKED", "do NOT run live GPU training").
 *
 * Covers: few-shot invoked → eval → gate PASS → registered + activated (via the
 * gated activateModelVersionManual path); gate FAIL → registered but NOT
 * activated (honest); insufficient labeled samples → honest error BEFORE any
 * training/registration, no model fabricated; trainer failure → honest error,
 * no registration.
 */
import { describe, it, expect, vi } from "vitest";
import {
  bootstrapFirstClassifier,
  InsufficientLabeledSamplesError,
  type BootstrapDeps,
  type BootstrapFirstClassifierOptions,
} from "./aiBootstrapClassifier";
import type { LocalTrainingResult } from "./aiLocalTraining";
import type { CompareReport } from "./aiEvalHarness";
import type { ModelVersion } from "../../drizzle/schema";

const PASSING_TRAIN_RESULT: LocalTrainingResult = {
  jobId: 1,
  success: true,
  outputModelPath: "/uploads/models/trained/fewshot_1_bootstrap.json",
  trainingSamples: 14,
  validationSamples: 6,
  durationMs: 12,
  finalMetrics: { accuracy: 0.9, precision: 0.9, recall: 0.9, f1Score: 0.9, confusionMatrix: [[7, 0], [0, 7]] },
};

function passingReport(): CompareReport {
  return {
    baseline: null,
    candidate: {
      accuracy: 0.9, precision: 0.9, recall: 0.9, f1Score: 0.9,
      microPrecision: 0.9, microRecall: 0.9, microF1: 0.9, perClass: [],
      confusionMatrix: [[7, 0], [0, 7]], evaluated: 14, skipped: 0, labels: ["OK", "NG"], split: "test",
    },
    gate: { pass: true, reason: "No baseline — candidate accepted as first version.", accuracyDelta: 0.9, epsilon: 0 },
    split: "test",
    generatedAt: new Date().toISOString(),
  };
}

function failingReport(): CompareReport {
  return {
    baseline: {
      accuracy: 0.95, precision: 0.95, recall: 0.95, f1Score: 0.95,
      microPrecision: 0.95, microRecall: 0.95, microF1: 0.95, perClass: [],
      confusionMatrix: [], evaluated: 20, skipped: 0, labels: ["OK", "NG"], split: "test",
    },
    candidate: {
      accuracy: 0.6, precision: 0.6, recall: 0.6, f1Score: 0.6,
      microPrecision: 0.6, microRecall: 0.6, microF1: 0.6, perClass: [],
      confusionMatrix: [], evaluated: 10, skipped: 0, labels: ["OK", "NG"], split: "test",
    },
    gate: {
      pass: false,
      reason: "Candidate accuracy 0.6000 regressed below baseline 0.9500 - eps 0.",
      accuracyDelta: -0.35,
      epsilon: 0,
    },
    split: "test",
    generatedAt: new Date().toISOString(),
  };
}

function makeDeps(overrides: Partial<BootstrapDeps> = {}): Required<BootstrapDeps> & {
  countLabeledSamples: ReturnType<typeof vi.fn>;
  ensureClassifierModel: ReturnType<typeof vi.fn>;
  getActiveBaseline: ReturnType<typeof vi.fn>;
  buildDatasetForModel: ReturnType<typeof vi.fn>;
  trainFewShot: ReturnType<typeof vi.fn>;
  evalAndGate: ReturnType<typeof vi.fn>;
  registerVersion: ReturnType<typeof vi.fn>;
  activate: ReturnType<typeof vi.fn>;
} {
  return {
    countLabeledSamples: vi.fn(async () => ({ OK: 10, NG: 10 })),
    ensureClassifierModel: vi.fn(async () => 42),
    getActiveBaseline: vi.fn(async () => null),
    buildDatasetForModel: vi.fn(async () => 99),
    trainFewShot: vi.fn(async (): Promise<LocalTrainingResult> => PASSING_TRAIN_RESULT),
    evalAndGate: vi.fn(async (): Promise<CompareReport> => passingReport()),
    registerVersion: vi.fn(async (data: any): Promise<ModelVersion> => ({ id: 501, ...data }) as ModelVersion),
    activate: vi.fn(async (): Promise<ModelVersion> => ({ id: 501, status: "ACTIVE" }) as unknown as ModelVersion),
    ...overrides,
  } as any;
}

const baseOpts: BootstrapFirstClassifierOptions = {
  baseModelId: 1,
  classifierCode: "bootstrap-defect-clf",
  classLabels: ["OK", "NG"],
};

describe("bootstrapFirstClassifier", () => {
  it("gate PASS: few-shot invoked → eval+gate → version registered + activated via the gated path", async () => {
    const deps = makeDeps();

    const result = await bootstrapFirstClassifier(baseOpts, deps);

    expect(deps.countLabeledSamples).toHaveBeenCalledWith(1, ["OK", "NG"]);
    expect(deps.trainFewShot).toHaveBeenCalledTimes(1);
    expect(deps.trainFewShot.mock.calls[0]![0]).toMatchObject({
      modelId: 1, strategy: "fewshot", classLabels: ["OK", "NG"],
    });
    expect(deps.evalAndGate).toHaveBeenCalledTimes(1);
    expect(deps.evalAndGate.mock.calls[0]![0]).toMatchObject({
      modelId: 1,
      candidateClassifierPath: PASSING_TRAIN_RESULT.outputModelPath,
      split: "test",
    });
    expect(deps.registerVersion).toHaveBeenCalledTimes(1);
    expect(deps.registerVersion.mock.calls[0]![0]).toMatchObject({ modelId: 42, status: "READY" });
    // Activated via the GATED manual path — not the raw activateModelVersion.
    expect(deps.activate).toHaveBeenCalledTimes(1);
    expect(deps.activate).toHaveBeenCalledWith(42, 501, expect.objectContaining({ actorUserId: null }));

    expect(result.ok).toBe(true);
    expect(result.activated).toBe(true);
    expect(result.classifierModelId).toBe(42);
    expect(result.versionId).toBe(501);
    expect(result.gate.pass).toBe(true);
  });

  it("gate FAIL: version is registered as READY for audit but NOT activated (honest)", async () => {
    const deps = makeDeps({ evalAndGate: vi.fn(async () => failingReport()) });

    const result = await bootstrapFirstClassifier(baseOpts, deps);

    expect(deps.trainFewShot).toHaveBeenCalledTimes(1);
    expect(deps.registerVersion).toHaveBeenCalledTimes(1);
    expect(deps.registerVersion.mock.calls[0]![0]).toMatchObject({ status: "READY" });
    expect(deps.activate).not.toHaveBeenCalled();

    expect(result.ok).toBe(true);
    expect(result.activated).toBe(false);
    expect(result.gate.pass).toBe(false);
    expect(result.reason).toMatch(/NOT activated/);
  });

  it("insufficient labeled samples: honest error BEFORE training/registration, no model fabricated", async () => {
    const deps = makeDeps({ countLabeledSamples: vi.fn(async () => ({ OK: 10, NG: 2 })) });

    await expect(bootstrapFirstClassifier(baseOpts, deps)).rejects.toThrow(InsufficientLabeledSamplesError);

    expect(deps.ensureClassifierModel).not.toHaveBeenCalled();
    expect(deps.buildDatasetForModel).not.toHaveBeenCalled();
    expect(deps.trainFewShot).not.toHaveBeenCalled();
    expect(deps.evalAndGate).not.toHaveBeenCalled();
    expect(deps.registerVersion).not.toHaveBeenCalled();
    expect(deps.activate).not.toHaveBeenCalled();
  });

  it("insufficient-samples error names the short class and the required count", async () => {
    const deps = makeDeps({ countLabeledSamples: vi.fn(async () => ({ OK: 10, NG: 2 })) });
    try {
      await bootstrapFirstClassifier(baseOpts, deps);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientLabeledSamplesError);
      const e = err as InsufficientLabeledSamplesError;
      expect(e.shortfalls).toEqual([{ label: "NG", have: 2, need: 5 }]);
      expect(e.message).toMatch(/NG.*2\/5/);
    }
  });

  it("trainer failure (honest 'insufficient data' from the trainer itself) aborts before registration", async () => {
    const deps = makeDeps({
      trainFewShot: vi.fn(async (): Promise<LocalTrainingResult> => ({
        jobId: 2, success: false, trainingSamples: 0, validationSamples: 0, durationMs: 4,
        error: "Insufficient training data",
      })),
    });

    await expect(bootstrapFirstClassifier(baseOpts, deps)).rejects.toThrow(/Bootstrap training failed/);
    expect(deps.registerVersion).not.toHaveBeenCalled();
    expect(deps.activate).not.toHaveBeenCalled();
  });

  it("requires at least 2 distinct class labels", async () => {
    const deps = makeDeps();
    await expect(
      bootstrapFirstClassifier({ ...baseOpts, classLabels: ["OK"] }, deps),
    ).rejects.toThrow(/at least 2/);
    expect(deps.countLabeledSamples).not.toHaveBeenCalled();
  });

  it("re-bootstrap with an existing ACTIVE baseline: gate compares against it", async () => {
    const deps = makeDeps({
      getActiveBaseline: vi.fn(async () => ({ id: 77, filePath: "/uploads/models/trained/old.json" })),
    });

    await bootstrapFirstClassifier(baseOpts, deps);

    expect(deps.evalAndGate.mock.calls[0]![0]).toMatchObject({
      baselineClassifierPath: "/uploads/models/trained/old.json",
      baselineVersionId: 77,
    });
    expect(deps.registerVersion.mock.calls[0]![0]).toMatchObject({ baselineVersionId: 77 });
  });
});
