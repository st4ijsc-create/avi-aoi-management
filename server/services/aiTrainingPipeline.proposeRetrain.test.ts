/**
 * B5.2 (doc 69 Wave 6 F2) — proposeRetrainJob unit tests.
 *
 * proposeRetrainJob is the HITL job-creator used by aiSelfLearningScheduler's
 * drift→retrain escalation. Unlike createTrainingJob (which fire-and-forgets
 * runTrainingPipeline right after the DB insert on every existing path), this
 * function must ONLY insert a training_jobs row (db.createTrainingJob) and must
 * NEVER call runTrainingPipeline / start any trainer / activate any model
 * version — this is what makes the proposal HITL (never auto-started).
 *
 * All collaborators mocked (mirrors aiTrainingPipeline.tier2.test.ts's mock set)
 * so importing aiTrainingPipeline.ts pulls in no DB, ONNX, fs, or child process.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB (aiAdvanced) — createTrainingJob + the getTrainingJobs de-dup lookup are
// exercised by proposeRetrainJob.
const createTrainingJobMock = vi.fn(async (data: any) => ({ id: 501, ...data }));
const getTrainingJobsMock = vi.fn(async (_opts: any) => [] as any[]);
vi.mock("../db/aiAdvanced", () => ({
  createTrainingJob: (d: unknown) => createTrainingJobMock(d),
  getTrainingJobs: (o: unknown) => getTrainingJobsMock(o),
  getTrainingJob: vi.fn(),
  updateTrainingJob: vi.fn(),
  createTrainingDataset: vi.fn(),
  getTrainingDataStats: vi.fn(),
}));

// ── DB (ai) — getAiModelById resolves the model; other exports unused here.
const getAiModelByIdMock = vi.fn(async () => ({ id: 7, code: "M7", currentVersion: "1.4.0" }));
vi.mock("../db/ai", () => ({
  getAiModelById: (...a: any[]) => getAiModelByIdMock(...a),
  createModelVersion: vi.fn(),
  updateModelVersion: vi.fn(),
  getModelVersions: vi.fn(),
  updateAiModel: vi.fn(),
}));

vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("../../drizzle/schema", () => ({ modelVersions: {} }));

// ── Heavy collaborators — never touched by proposeRetrainJob, but imported by
// the module, so they must exist as mocks to keep this test offline (no ONNX).
const runTransferLearningMock = vi.fn();
const runFewShotLearningMock = vi.fn();
vi.mock("./aiLocalTraining", () => ({
  runTransferLearning: (...a: any[]) => runTransferLearningMock(...a),
  runFewShotLearning: (...a: any[]) => runFewShotLearningMock(...a),
}));
const isSidecarEnabledMock = vi.fn(() => false);
const runSidecarTrainingMock = vi.fn();
vi.mock("./localSidecarTrainer", () => ({
  isSidecarEnabled: () => isSidecarEnabledMock(),
  runSidecarTraining: (...a: any[]) => runSidecarTrainingMock(...a),
}));
const buildDatasetMock = vi.fn();
vi.mock("./aiDatasetBuilder", () => ({ buildDataset: (...a: any[]) => buildDatasetMock(...a) }));
const evaluateModelVersionMock = vi.fn();
const compareBeforeAfterMock = vi.fn();
vi.mock("./aiEvalHarness", () => ({
  evaluateModelVersion: (...a: any[]) => evaluateModelVersionMock(...a),
  compareBeforeAfter: (...a: any[]) => compareBeforeAfterMock(...a),
}));
const evictSessionCacheMock = vi.fn();
vi.mock("./aiInferenceEngine", () => ({ evictSessionCache: (...a: any[]) => evictSessionCacheMock(...a) }));

import { proposeRetrainJob } from "./aiTrainingPipeline";

beforeEach(() => {
  vi.clearAllMocks();
  getAiModelByIdMock.mockResolvedValue({ id: 7, code: "M7", currentVersion: "1.4.0" });
  createTrainingJobMock.mockImplementation(async (data: any) => ({ id: 501, ...data }));
  getTrainingJobsMock.mockResolvedValue([]); // default: no open proposal → dedup never blocks
});

describe("proposeRetrainJob", () => {
  it("inserts a QUEUED training_jobs row via db.createTrainingJob — nothing else", async () => {
    const job = await proposeRetrainJob({
      modelId: 7,
      reason: "120 labeled samples available for retraining",
      driftSeverity: "HIGH",
      driftSource: "confidence-psi",
      feedbackCount: 42,
      labeledCount: 120,
    });

    expect(createTrainingJobMock).toHaveBeenCalledTimes(1);
    const payload = createTrainingJobMock.mock.calls[0]![0] as any;
    expect(payload.modelId).toBe(7);
    expect(payload.status).toBe("QUEUED");
    expect(payload.trainingConfig).toMatchObject({
      proposedBy: "aiSelfLearningScheduler",
      proposalKind: "drift_retrain",
      requiresHumanApproval: true,
      driftSeverity: "HIGH",
      driftSource: "confidence-psi",
      reason: "120 labeled samples available for retraining",
    });
    expect(job).toMatchObject({ id: 501, modelId: 7, status: "QUEUED" });

    // Checked the de-dup lookup (scoped to this model + QUEUED) before inserting.
    expect(getTrainingJobsMock).toHaveBeenCalledWith({ modelId: 7, status: "QUEUED" });

    // NEVER starts training or touches any activation/eval path.
    expect(runTransferLearningMock).not.toHaveBeenCalled();
    expect(runFewShotLearningMock).not.toHaveBeenCalled();
    expect(runSidecarTrainingMock).not.toHaveBeenCalled();
    expect(buildDatasetMock).not.toHaveBeenCalled();
    expect(evaluateModelVersionMock).not.toHaveBeenCalled();
    expect(compareBeforeAfterMock).not.toHaveBeenCalled();
    expect(evictSessionCacheMock).not.toHaveBeenCalled();
  });

  it("derives targetVersion from the model's currentVersion when not given explicitly", async () => {
    await proposeRetrainJob({ modelId: 7, reason: "r", driftSeverity: "CRITICAL", driftSource: "concept-drift-ks" });
    const payload = createTrainingJobMock.mock.calls[0]![0] as any;
    expect(payload.targetVersion).toBe("1.4.0-proposed-retrain");
  });

  it("falls back to a timestamp-based targetVersion when the model has no currentVersion", async () => {
    getAiModelByIdMock.mockResolvedValue({ id: 8, code: "M8", currentVersion: null });
    await proposeRetrainJob({ modelId: 8, reason: "r", driftSeverity: "HIGH", driftSource: "confidence-psi" });
    const payload = createTrainingJobMock.mock.calls[0]![0] as any;
    expect(payload.targetVersion).toMatch(/^proposed-retrain-\d+$/);
  });

  it("throws when the model does not exist (fail-safe — caller's per-model try/catch handles it)", async () => {
    getAiModelByIdMock.mockResolvedValue(null);
    await expect(
      proposeRetrainJob({ modelId: 999, reason: "r", driftSeverity: "HIGH", driftSource: "confidence-psi" }),
    ).rejects.toThrow(/not found/i);
    expect(createTrainingJobMock).not.toHaveBeenCalled();
  });
});

// Review remediation (F2) — de-dup: at most one open (QUEUED) drift-retrain
// proposal per model. Mirrors aiThresholdTuneScheduler's throttle intent, but
// implemented as a DB lookup (training_jobs has no in-memory scheduler state).
describe("proposeRetrainJob — de-dup (at most one open proposal per model)", () => {
  it("skips (returns null, no insert) when a QUEUED drift_retrain proposal already exists for the model", async () => {
    getTrainingJobsMock.mockResolvedValue([
      { id: 501, modelId: 7, status: "QUEUED", trainingConfig: { proposalKind: "drift_retrain" } },
    ]);

    const result = await proposeRetrainJob({
      modelId: 7, reason: "still qualifies", driftSeverity: "HIGH", driftSource: "confidence-psi",
    });

    expect(result).toBeFalsy();
    expect(createTrainingJobMock).not.toHaveBeenCalled();
  });

  it("does NOT dedup against QUEUED jobs that aren't drift-retrain proposals (different proposalKind, or a human-created job with no marker)", async () => {
    getTrainingJobsMock.mockResolvedValue([
      { id: 10, modelId: 7, status: "QUEUED", trainingConfig: { proposalKind: "threshold_tune" } },
      { id: 11, modelId: 7, status: "QUEUED", trainingConfig: null },
      { id: 12, modelId: 7, status: "QUEUED", trainingConfig: {} },
    ]);

    const result = await proposeRetrainJob({
      modelId: 7, reason: "r", driftSeverity: "HIGH", driftSource: "confidence-psi",
    });

    expect(result).toBeTruthy();
    expect(createTrainingJobMock).toHaveBeenCalledTimes(1);
  });

  it("a second scan while an un-actioned proposal exists creates NO duplicate; once consumed/cancelled, a new one can be created", async () => {
    // Scan 1: no open proposal yet → creates.
    getTrainingJobsMock.mockResolvedValueOnce([]);
    const first = await proposeRetrainJob({
      modelId: 7, reason: "r1", driftSeverity: "HIGH", driftSource: "confidence-psi",
    });
    expect(first).toBeTruthy();
    expect(createTrainingJobMock).toHaveBeenCalledTimes(1);

    // Scan 2: the proposal from scan 1 is still QUEUED and un-actioned → skip.
    getTrainingJobsMock.mockResolvedValueOnce([
      { id: 501, modelId: 7, status: "QUEUED", trainingConfig: { proposalKind: "drift_retrain" } },
    ]);
    const second = await proposeRetrainJob({
      modelId: 7, reason: "r2", driftSeverity: "HIGH", driftSource: "confidence-psi",
    });
    expect(second).toBeFalsy();
    expect(createTrainingJobMock).toHaveBeenCalledTimes(1); // still just the one from scan 1

    // The proposal is consumed/cancelled (no longer a QUEUED drift_retrain row —
    // e.g. an operator started training from it, or cancelled/deleted it).
    getTrainingJobsMock.mockResolvedValueOnce([]);
    const third = await proposeRetrainJob({
      modelId: 7, reason: "r3", driftSeverity: "HIGH", driftSource: "confidence-psi",
    });
    expect(third).toBeTruthy();
    expect(createTrainingJobMock).toHaveBeenCalledTimes(2); // a fresh proposal was allowed
  });

  it("de-dup is scoped per model — a different model's open proposal never blocks this one (queried with this model's id)", async () => {
    getTrainingJobsMock.mockImplementation(async (opts: any) => {
      // Simulate a real per-model filter: only model 42 has an open proposal.
      if (opts.modelId === 42) {
        return [{ id: 900, modelId: 42, status: "QUEUED", trainingConfig: { proposalKind: "drift_retrain" } }];
      }
      return [];
    });

    const result = await proposeRetrainJob({
      modelId: 7, reason: "r", driftSeverity: "HIGH", driftSource: "confidence-psi",
    });

    expect(result).toBeTruthy();
    expect(createTrainingJobMock).toHaveBeenCalledTimes(1);
    expect(getTrainingJobsMock).toHaveBeenCalledWith({ modelId: 7, status: "QUEUED" });
  });
});
