/**
 * WS-1 Tier 2 (B8) — pipeline branching tests.
 *
 * Verifies Stage 2 routing in runTrainingPipeline:
 *  - default / env OFF  → Tier-1 (runTransferLearning), dispatchTier2 throws.
 *  - trainingMode "local-sidecar" + env ON → sidecar result flows into Stage 3-6
 *    (eval/gate) with the sidecar's outputModelPath, version created on gate pass.
 *
 * All collaborators mocked — no DB, ONNX, fs, or child process.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB (aiAdvanced) ─────────────────────────────────────────────
const job: any = {
  id: 42, modelId: 7, targetVersion: "1.3.0",
  datasetConfig: { classLabels: ["NG", "OK"] },
  trainingConfig: { epochs: 5 },
  trainingMode: "local-embedding",
};
const updateTrainingJobMock = vi.fn(async () => ({}));
vi.mock("../db/aiAdvanced", () => ({
  createTrainingJob: vi.fn(async () => ({ id: 42 })),
  getTrainingJob: vi.fn(async () => job),
  updateTrainingJob: (id: number, d: unknown) => updateTrainingJobMock(id, d),
  createTrainingDataset: vi.fn(async () => ({ id: 12 })),
  getTrainingDataStats: vi.fn(),
}));

// ── DB (ai) ─────────────────────────────────────────────────────
const createModelVersionMock = vi.fn(async () => ({ id: 99 }));
vi.mock("../db/ai", () => ({
  getAiModelById: vi.fn(async () => ({ id: 7, code: "M7", filePath: "/uploads/models/base.onnx", currentVersion: "1.0.0" })),
  createModelVersion: (v: unknown) => createModelVersionMock(v),
  updateModelVersion: vi.fn(async () => ({})),
  getModelVersions: vi.fn(async () => []),
  updateAiModel: vi.fn(async () => ({})),
}));
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("../../drizzle/schema", () => ({ modelVersions: {} }));

// ── Dataset builder ─────────────────────────────────────────────
vi.mock("./aiDatasetBuilder", () => ({
  buildDataset: vi.fn(async () => ({ split: { train: 30, val: 6, test: 4 } })),
}));

// ── Tier-1 trainers ─────────────────────────────────────────────
const runTransferLearningMock = vi.fn(async () => ({
  jobId: 42, success: true, outputModelPath: "/tier1/classifier_42.json",
  finalMetrics: { accuracy: 0.9, precision: 0.9, recall: 0.9, f1Score: 0.9, confusionMatrix: [] },
  trainingSamples: 30, validationSamples: 6, durationMs: 1,
}));
const runFewShotLearningMock = vi.fn(async () => ({ jobId: 42, success: true, outputModelPath: "/tier1/fs.json", trainingSamples: 1, validationSamples: 1, durationMs: 1 }));
vi.mock("./aiLocalTraining", () => ({
  runTransferLearning: (r: unknown) => runTransferLearningMock(r),
  runFewShotLearning: (r: unknown) => runFewShotLearningMock(r),
}));

// ── Sidecar (Tier 2) ────────────────────────────────────────────
const isSidecarEnabledMock = vi.fn(() => false);
const runSidecarTrainingMock = vi.fn(async () => ({
  jobId: 42, success: true, outputModelPath: "/uploads/models/trained/sidecar_42_1.3.0.onnx",
  finalMetrics: { accuracy: 0.96, precision: 0.96, recall: 0.96, f1Score: 0.96, confusionMatrix: [] },
  trainingSamples: 30, validationSamples: 6, durationMs: 1,
}));
vi.mock("./localSidecarTrainer", () => ({
  isSidecarEnabled: () => isSidecarEnabledMock(),
  runSidecarTraining: (r: unknown) => runSidecarTrainingMock(r),
}));

// ── Eval harness ────────────────────────────────────────────────
const evaluateModelVersionMock = vi.fn(async () => ({ accuracy: 0.95, precision: 0.95, recall: 0.95, f1Score: 0.95, confusionMatrix: [] }));
const compareBeforeAfterMock = vi.fn(async () => ({
  candidate: { accuracy: 0.95, precision: 0.95, recall: 0.95, f1Score: 0.95 },
  gate: { pass: true, reason: "ok" },
}));
vi.mock("./aiEvalHarness", () => ({
  evaluateModelVersion: (a: unknown) => evaluateModelVersionMock(a),
  compareBeforeAfter: (a: unknown) => compareBeforeAfterMock(a),
}));
vi.mock("./aiInferenceEngine", () => ({ evictSessionCache: vi.fn() }));

import { runTrainingPipeline, dispatchTier2 } from "./aiTrainingPipeline";

beforeEach(() => {
  vi.clearAllMocks();
  isSidecarEnabledMock.mockReturnValue(false);
  job.trainingMode = "local-embedding";
});

describe("dispatchTier2", () => {
  it("throws when sidecar disabled", async () => {
    isSidecarEnabledMock.mockReturnValue(false);
    await expect(dispatchTier2({ jobId: 42, modelId: 7, targetVersion: "1.3.0", datasetId: 12, classLabels: ["NG", "OK"] }))
      .rejects.toThrow(/disabled/i);
  });

  it("delegates to runSidecarTraining when enabled", async () => {
    isSidecarEnabledMock.mockReturnValue(true);
    const r = await dispatchTier2({ jobId: 42, modelId: 7, targetVersion: "1.3.0", datasetId: 12, classLabels: ["NG", "OK"] });
    expect(runSidecarTrainingMock).toHaveBeenCalledTimes(1);
    expect(r.outputModelPath).toMatch(/sidecar_42/);
  });
});

describe("runTrainingPipeline Stage 2 routing", () => {
  it("default → Tier 1, sidecar not invoked", async () => {
    await runTrainingPipeline(42, { classLabels: ["NG", "OK"], datasetId: 12, strategy: "transfer", gateEpsilon: 0 });
    expect(runTransferLearningMock).toHaveBeenCalledTimes(1);
    expect(runSidecarTrainingMock).not.toHaveBeenCalled();
    // eval/gate ran against the Tier-1 path.
    const evalArg = evaluateModelVersionMock.mock.calls[0]![0] as any;
    expect(evalArg.classifierPath).toBe("/tier1/classifier_42.json");
    expect(createModelVersionMock).toHaveBeenCalled();
  });

  it("trainingMode local-sidecar but env OFF → falls back to Tier 1", async () => {
    job.trainingMode = "local-sidecar";
    isSidecarEnabledMock.mockReturnValue(false);
    await runTrainingPipeline(42, { classLabels: ["NG", "OK"], datasetId: 12, strategy: "transfer", gateEpsilon: 0 });
    expect(runTransferLearningMock).toHaveBeenCalledTimes(1);
    expect(runSidecarTrainingMock).not.toHaveBeenCalled();
  });

  it("trainingMode local-sidecar + env ON → sidecar result drives eval/gate", async () => {
    job.trainingMode = "local-sidecar";
    isSidecarEnabledMock.mockReturnValue(true);
    await runTrainingPipeline(42, { classLabels: ["NG", "OK"], datasetId: 12, strategy: "transfer", gateEpsilon: 0 });
    expect(runSidecarTrainingMock).toHaveBeenCalledTimes(1);
    expect(runTransferLearningMock).not.toHaveBeenCalled();
    const evalArg = evaluateModelVersionMock.mock.calls[0]![0] as any;
    expect(evalArg.classifierPath).toBe("/uploads/models/trained/sidecar_42_1.3.0.onnx");
    const cmpArg = compareBeforeAfterMock.mock.calls[0]![0] as any;
    expect(cmpArg.candidateClassifierPath).toBe("/uploads/models/trained/sidecar_42_1.3.0.onnx");
    // gate passed → model version created.
    expect(createModelVersionMock).toHaveBeenCalled();
    const versionArg = createModelVersionMock.mock.calls[0]![0] as any;
    expect(versionArg.filePath).toBe("/uploads/models/trained/sidecar_42_1.3.0.onnx");
  });
});
