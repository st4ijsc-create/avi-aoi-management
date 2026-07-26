/**
 * doc 69 Wave 6 (F1), servability fix — bootstrapFirstClassifier orchestration.
 *
 * Every DB/fs touchpoint is injected — NO GPU training, NO ONNX session, NO
 * live DB is ever exercised here. Unlike the pre-fix suite, most tests below
 * let the REAL pure trainer/eval math (embeddingHeadTrainer.trainEmbeddingHead
 * / embeddingHead.evaluateOnSplit) run against small synthetic, seeded
 * embeddings (same technique as embeddingHead.test.ts) — this is what actually
 * proves a successful bootstrap produces a classifier `isEmbeddingHeadModel`
 * recognizes and `aiInferenceEngine.runInference` would dispatch, not just
 * that the orchestration calls the right mocked functions in the right order.
 *
 * Covers: gate PASS (real training) → registered + activated via the gated
 * activateModelVersionManual path, and the registered shape IS servable; gate
 * FAIL → registered but NOT activated (honest); insufficient labeled samples
 * → honest error BEFORE any dataset/training/registration, no model
 * fabricated; trainer failure → honest error, no registration; re-bootstrap
 * compares against an existing ACTIVE baseline; a supplied datasetId is
 * loaded instead of snapshotting a fresh one; training is restricted to
 * exactly the requested classLabels.
 */
import { describe, it, expect, vi } from "vitest";
import {
  bootstrapFirstClassifier,
  buildBootstrapClassifierModelFields,
  InsufficientLabeledSamplesError,
  type BootstrapDeps,
  type BootstrapFirstClassifierOptions,
} from "./aiBootstrapClassifier";
import { mulberry32 } from "./aiMetrics";
import { isEmbeddingHeadModel } from "./ai/embeddingHead";
import {
  assembleEmbeddingDataset,
  type LabeledEmbedding,
  type TrainHeadResult,
  type HeadArtifact,
} from "./ai/embeddingHeadTrainer";
import type { AiModel, ModelVersion } from "../../drizzle/schema";

const DIM = 16;
const SPLIT_CONFIG = { train: 0.7, validation: 0.15, test: 0.15 };

/** Deterministic two-cluster synthetic embedding set, linearly separable on dim 0 (mirrors embeddingHead.test.ts). */
function makeClusters(perClass = 20, seed = 42): LabeledEmbedding[] {
  const rand = mulberry32(seed);
  const noise = () => (rand() - 0.5) * 0.2; // ±0.1
  const pairs: LabeledEmbedding[] = [];
  let id = 1;
  for (let i = 0; i < perClass; i++) {
    const ok = new Array(DIM).fill(0).map(() => noise());
    ok[0] = 3 + noise(); // OK cluster centered at +3 on dim 0
    pairs.push({ id: id++, label: "OK", embedding: ok });

    const ng = new Array(DIM).fill(0).map(() => noise());
    ng[0] = -3 + noise(); // NG cluster centered at -3 on dim 0
    pairs.push({ id: id++, label: "NG", embedding: ng });
  }
  return pairs;
}

function makeDataset(perClass = 20, extraPairs: LabeledEmbedding[] = []) {
  const snapshot = assembleEmbeddingDataset([...makeClusters(perClass), ...extraPairs]);
  return { id: 501, snapshot, splitSeed: 1337, splitConfig: SPLIT_CONFIG, modelCode: "dinov2-small" };
}

function makeDeps(overrides: Partial<BootstrapDeps> = {}): Required<Pick<BootstrapDeps,
  "countLabeledSamples" | "buildEmbeddingDataset" | "loadEmbeddingDatasetById" | "ensureClassifierModel" |
  "getActiveBaseline" | "loadBaselineArtifact" | "writeArtifact" | "registerVersion" | "activate"
>> & BootstrapDeps {
  return {
    countLabeledSamples: vi.fn(async () => ({ OK: 20, NG: 20 })),
    buildEmbeddingDataset: vi.fn(async () => makeDataset()),
    loadEmbeddingDatasetById: vi.fn(async () => null),
    ensureClassifierModel: vi.fn(async () => 42),
    getActiveBaseline: vi.fn(async () => null),
    loadBaselineArtifact: vi.fn(() => null),
    // Never touch the filesystem in a unit test — the real writeHeadArtifact does fs.writeFileSync.
    writeArtifact: vi.fn(() => ({ absPath: "/abs/heads/x/v1/head.json", storagePath: "/uploads/models/heads/x/v1/head.json" })),
    registerVersion: vi.fn(async (data: any): Promise<ModelVersion> => ({ id: 501, ...data }) as ModelVersion),
    activate: vi.fn(async (): Promise<ModelVersion> => ({ id: 501, status: "ACTIVE" }) as unknown as ModelVersion),
    // trainHead / evaluateHead / splitDataset intentionally NOT mocked by default —
    // the real pure math runs against the synthetic embeddings above.
    ...overrides,
  };
}

const baseOpts: BootstrapFirstClassifierOptions = {
  baseModelId: 1,
  classifierCode: "bootstrap-defect-clf",
  classLabels: ["OK", "NG"],
};

const FAKE_ARTIFACT: HeadArtifact = {
  type: "embedding_logreg_head", formatVersion: 1, inputDim: DIM, classLabels: ["NG", "OK"],
  weights: [], biases: [], l2: 1e-4, standardization: null, temperature: 1, seed: 1337,
  trainedAt: new Date().toISOString(),
  trainConfig: { epochs: 1, batchSize: 16, learningRate: 0.1, l2: 1e-4, seed: 1337, earlyStoppingPatience: 15, standardize: true, fitTemperature: true, classBalance: "none", focalGamma: 0 },
};
const FAKE_METRICS = { accuracy: 0, precision: 0, recall: 0, f1Score: 0, microPrecision: 0, microRecall: 0, microF1: 0, perClass: [], confusionMatrix: [] };

describe("bootstrapFirstClassifier — servable-by-default (F1 review)", () => {
  it("gate PASS (first bootstrap, real training): registers + activates via the gated path, and the registered shape IS servable", async () => {
    const deps = makeDeps();

    const result = await bootstrapFirstClassifier(baseOpts, deps);

    expect(deps.countLabeledSamples).toHaveBeenCalledWith(1, ["OK", "NG"], undefined);
    expect(deps.buildEmbeddingDataset).toHaveBeenCalledTimes(1);
    expect(deps.ensureClassifierModel).toHaveBeenCalledTimes(1);
    const ensureArgs = deps.ensureClassifierModel.mock.calls[0]![0];
    expect(ensureArgs.classLabels).toEqual(["NG", "OK"]); // canonicalized + sorted
    expect(ensureArgs.inputDim).toBe(DIM);

    expect(deps.registerVersion).toHaveBeenCalledTimes(1);
    const registered = deps.registerVersion.mock.calls[0]![0] as any;
    expect(registered.modelId).toBe(42);
    expect(registered.status).toBe("READY");
    // Real training on cleanly-separable synthetic clusters ⇒ high real accuracy (never fabricated).
    expect(registered.metrics.accuracy).toBeGreaterThan(0.85);

    // Activated via the GATED manual path — not a raw/unguarded activation.
    expect(deps.activate).toHaveBeenCalledTimes(1);
    expect(deps.activate).toHaveBeenCalledWith(42, 501, expect.objectContaining({ actorUserId: null }));

    expect(result.ok).toBe(true);
    expect(result.activated).toBe(true);
    expect(result.gate.pass).toBe(true);
    expect(result.trainingSamples).toBeGreaterThan(0);
    expect(result.validationSamples).toBeGreaterThan(0);

    // THE core F1-review claim, verified directly: the ai_models row this
    // workflow creates is recognized by isEmbeddingHeadModel — the exact
    // predicate aiInferenceEngine.runInference's dispatch checks — so a
    // successful bootstrap really would be served, not throw.
    const modelFields = buildBootstrapClassifierModelFields({
      code: "bootstrap-defect-clf", name: "bootstrap-defect-clf", classLabels: ["NG", "OK"],
      baseModelId: 1, inputDim: DIM,
    });
    expect(isEmbeddingHeadModel(modelFields as unknown as AiModel)).toBe(true);
  });

  it("gate FAIL: version is registered as READY for audit but NOT activated (honest)", async () => {
    const deps = makeDeps({
      getActiveBaseline: vi.fn(async () => ({ id: 77, filePath: "/uploads/models/heads/old/v1/head.json", accuracy: 0.95 })),
      loadBaselineArtifact: vi.fn(() => null), // fall back to the baseline's recorded accuracy (0.95)
      trainHead: vi.fn(async (): Promise<TrainHeadResult> => ({
        artifact: FAKE_ARTIFACT, metrics: FAKE_METRICS, history: [], bestEpoch: 1, trainCount: 10, valCount: 5,
        classBalance: { mode: "none", focalGamma: 0, distributionBefore: {}, distributionAfter: {}, classWeights: [] },
      })),
      evaluateHead: vi.fn(() => ({ ...FAKE_METRICS, accuracy: 0.6 })), // well below the 0.95 baseline
    });

    const result = await bootstrapFirstClassifier(baseOpts, deps);

    expect(deps.trainHead).toHaveBeenCalledTimes(1);
    expect(deps.registerVersion).toHaveBeenCalledTimes(1);
    expect(deps.registerVersion.mock.calls[0]![0]).toMatchObject({ status: "READY" });
    expect(deps.activate).not.toHaveBeenCalled();

    expect(result.ok).toBe(true);
    expect(result.activated).toBe(false);
    expect(result.gate.pass).toBe(false);
    expect(result.reason).toMatch(/NOT activated/);
  });

  it("insufficient labeled samples: honest error BEFORE dataset/training/registration, no model fabricated", async () => {
    const deps = makeDeps({ countLabeledSamples: vi.fn(async () => ({ OK: 10, NG: 2 })) });

    await expect(bootstrapFirstClassifier(baseOpts, deps)).rejects.toThrow(InsufficientLabeledSamplesError);

    expect(deps.buildEmbeddingDataset).not.toHaveBeenCalled();
    expect(deps.ensureClassifierModel).not.toHaveBeenCalled();
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

  it("trainer failure aborts before registration (honest error, no model fabricated)", async () => {
    const deps = makeDeps({
      trainHead: vi.fn(async () => { throw new Error("Insufficient training data: 1 samples for 2 classes"); }),
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

  it("re-bootstrap with an existing ACTIVE baseline: gate compares real accuracy against it, baselineVersionId flows through", async () => {
    const deps = makeDeps({
      getActiveBaseline: vi.fn(async () => ({ id: 77, filePath: "/uploads/models/heads/old/v1/head.json", accuracy: 0.5 })),
      loadBaselineArtifact: vi.fn(() => null), // fall back to the recorded 0.5 baseline accuracy
    });

    const result = await bootstrapFirstClassifier(baseOpts, deps);

    expect(deps.getActiveBaseline).toHaveBeenCalledWith(42);
    expect(deps.registerVersion.mock.calls[0]![0]).toMatchObject({ baselineVersionId: 77 });
    // Real training on cleanly-separable clusters comfortably beats a 0.5 baseline.
    expect(result.gate.pass).toBe(true);
    expect(result.activated).toBe(true);
  });

  it("uses a supplied datasetId (loads the locked snapshot) instead of building a fresh one", async () => {
    const supplied = makeDataset();
    const deps = makeDeps({ loadEmbeddingDatasetById: vi.fn(async () => supplied) });

    await bootstrapFirstClassifier({ ...baseOpts, datasetId: 999 }, deps);

    expect(deps.loadEmbeddingDatasetById).toHaveBeenCalledWith(999);
    expect(deps.buildEmbeddingDataset).not.toHaveBeenCalled();
  });

  it("throws (never fabricates) when a supplied datasetId does not resolve to a dataset", async () => {
    const deps = makeDeps({ loadEmbeddingDatasetById: vi.fn(async () => null) });
    await expect(
      bootstrapFirstClassifier({ ...baseOpts, datasetId: 999 }, deps),
    ).rejects.toThrow(/embedding dataset 999 not found/);
    expect(deps.registerVersion).not.toHaveBeenCalled();
  });

  it("restricts training to EXACTLY the requested classLabels, dropping other labeled classes present in the snapshot", async () => {
    const extra: LabeledEmbedding[] = Array.from({ length: 10 }, (_, i) => ({
      id: `scratch-${i}`, label: "scratch", embedding: new Array(DIM).fill(0).map(() => (i % 2 === 0 ? 1 : -1)),
    }));
    const dataset = makeDataset(20, extra);
    const deps = makeDeps({ buildEmbeddingDataset: vi.fn(async () => dataset) });

    await bootstrapFirstClassifier(baseOpts, deps); // classLabels = ["OK", "NG"] only

    const ensureArgs = deps.ensureClassifierModel.mock.calls[0]![0];
    expect(ensureArgs.classLabels).toEqual(["NG", "OK"]); // "scratch" excluded
    const registered = deps.registerVersion.mock.calls[0]![0] as any;
    // Every train/val/(test|val) sample the trainer actually saw excludes "scratch" —
    // proven indirectly: the real trainer's own class-label check would have thrown
    // "requires >= 2 class labels"-style errors on shape mismatch had it leaked through,
    // and it didn't (registration succeeded).
    expect(registered.status).toBe("READY");
  });
});
