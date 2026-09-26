/**
 * B5.2 (doc 69 Wave 6 F2) — drift → retrain HITL escalation scheduler tests
 * (server/services/aiSelfLearningScheduler.ts).
 *
 * Covers:
 *   • runSelfLearningScanOnce: HIGH/CRITICAL drift (confidence-PSI OR concept-drift
 *     KS) + a satisfied checkAutoRetrainTrigger → proposeRetrainJob is called
 *     (a PROPOSED/QUEUED row, never an auto-started/auto-activated one).
 *   • MEDIUM/NONE drift, or an unsatisfied trigger → no proposal.
 *   • A per-model failure never aborts the scan (other models still processed).
 *   • AI_SELF_LEARNING_ENABLED=false → the escalation is a no-op (isolated module
 *     instance, since the flag is a module-load-time const).
 *
 * Review remediation (F2): the parallel performance-snapshot sweep this file used
 * to also cover (runPerformanceSnapshotSweepOnce / AI_PERF_SNAPSHOT_SWEEP_ENABLED)
 * was REMOVED — see the header comment in aiSelfLearningScheduler.ts. It was the
 * first-ever writer of driftScore, which silently armed
 * modelAutoRollback.ts's no-HITL `auto_drift` auto-activate branch, and it
 * duplicated the pre-existing modelPerfSnapshotProducer.ts as a second writer of
 * model_performance_snapshots. Snapshots are covered by that pre-existing,
 * already-scheduled producer; this file only tests the drift→retrain escalation.
 *
 * All collaborators mocked — no DB, no cron timer actually firing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Flag must be ON at module-load (the SUT captures the const at import time).
// vi.hoisted runs BEFORE the hoisted static import below, so this lands in time.
vi.hoisted(() => {
  process.env.AI_SELF_LEARNING_ENABLED = "true";
});

// ── DB (aiModels list) ──────────────────────────────────────────────────────
const whereMock = vi.fn(async () => [] as any[]);
const fromMock = vi.fn(() => ({ where: whereMock }));
const selectMock = vi.fn(() => ({ from: fromMock }));
const fakeDb = { select: selectMock };
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => fakeDb) }));
vi.mock("../../drizzle/schema", () => ({
  aiModels: { id: "id", status: "status", currentVersion: "currentVersion" },
}));

// ── Uncertainty scan (unrelated pass — kept a harmless no-op) ───────────────
const scanInferenceForUncertaintyMock = vi.fn(async () => ({
  scanned: 0, enqueued: 0, skippedExisting: 0, belowThreshold: 0,
}));
vi.mock("./aiActiveLearningAuto", () => ({
  scanInferenceForUncertainty: (...a: any[]) => scanInferenceForUncertaintyMock(...a),
}));

// ── Drift monitor ────────────────────────────────────────────────────────────
const isDriftMonitorEnabledMock = vi.fn(() => true);
const checkConfidenceDriftMock = vi.fn(async () => ({
  enabled: true, modelId: 1, evaluated: true, drift: false, severity: "NONE" as const,
  psi: 0, meanShift: 0, stdShift: 0, baseline: {}, recent: {}, reasons: [] as string[],
}));
const checkConceptDriftKSMock = vi.fn(async () => ({
  enabled: true, modelId: 1, evaluated: true, drift: false, d: 0, pValue: 1, n1: 0, n2: 0,
  reasons: [] as string[],
}));
vi.mock("./aiDriftMonitor", () => ({
  isDriftMonitorEnabled: () => isDriftMonitorEnabledMock(),
  checkConfidenceDrift: (...a: any[]) => checkConfidenceDriftMock(...a),
  checkConceptDriftKS: (...a: any[]) => checkConceptDriftKSMock(...a),
}));

// ── Training pipeline (trigger + HITL job creator) ───────────────────────────
const checkAutoRetrainTriggerMock = vi.fn(async () => ({
  shouldRetrain: false, feedbackCount: 0, labeledCount: 0,
}));
const proposeRetrainJobMock = vi.fn(async (opts: any) => ({ id: 999, modelId: opts.modelId, status: "QUEUED" }));
vi.mock("./aiTrainingPipeline", () => ({
  checkAutoRetrainTrigger: (...a: any[]) => checkAutoRetrainTriggerMock(...a),
  proposeRetrainJob: (...a: any[]) => proposeRetrainJobMock(...a),
}));

import { runSelfLearningScanOnce } from "./aiSelfLearningScheduler";

beforeEach(() => {
  vi.clearAllMocks();
  whereMock.mockResolvedValue([{ id: 1, currentVersion: "1.0.0" }]);
  scanInferenceForUncertaintyMock.mockResolvedValue({ scanned: 0, enqueued: 0, skippedExisting: 0, belowThreshold: 0 });
  isDriftMonitorEnabledMock.mockReturnValue(true);
  checkConfidenceDriftMock.mockResolvedValue({
    enabled: true, modelId: 1, evaluated: true, drift: false, severity: "NONE" as const,
    psi: 0, meanShift: 0, stdShift: 0, baseline: {} as any, recent: {} as any, reasons: [],
  });
  checkConceptDriftKSMock.mockResolvedValue({
    enabled: true, modelId: 1, evaluated: true, drift: false, d: 0, pValue: 1, n1: 0, n2: 0, reasons: [],
  });
  checkAutoRetrainTriggerMock.mockResolvedValue({ shouldRetrain: false, feedbackCount: 0, labeledCount: 0 });
  proposeRetrainJobMock.mockImplementation(async (opts: any) => ({ id: 999, modelId: opts.modelId, status: "QUEUED" }));
});

describe("runSelfLearningScanOnce — drift → retrain HITL escalation", () => {
  it("HIGH confidence drift + satisfied trigger → proposes a retrain job (PROPOSED, not started)", async () => {
    checkConfidenceDriftMock.mockResolvedValue({
      enabled: true, modelId: 1, evaluated: true, drift: true, severity: "HIGH" as const,
      psi: 0.3, meanShift: 0.2, stdShift: 0.1, baseline: {} as any, recent: {} as any,
      reasons: ["confidence PSI 0.300 > 0.25"],
    });
    checkAutoRetrainTriggerMock.mockResolvedValue({
      shouldRetrain: true, reason: "120 labeled samples available for retraining",
      feedbackCount: 50, labeledCount: 120,
    });

    const stats = await runSelfLearningScanOnce();

    expect(checkAutoRetrainTriggerMock).toHaveBeenCalledTimes(1);
    expect(proposeRetrainJobMock).toHaveBeenCalledTimes(1);
    const arg = proposeRetrainJobMock.mock.calls[0]![0];
    expect(arg).toMatchObject({
      modelId: 1,
      driftSeverity: "HIGH",
      driftSource: "confidence-psi",
      feedbackCount: 50,
      labeledCount: 120,
    });
    expect(stats.retrainProposed).toBe(1);
    expect(stats.driftFlagged).toBe(1);
  });

  it("CRITICAL confidence drift + satisfied trigger → proposes with severity CRITICAL", async () => {
    checkConfidenceDriftMock.mockResolvedValue({
      enabled: true, modelId: 1, evaluated: true, drift: true, severity: "CRITICAL" as const,
      psi: 0.6, meanShift: 0.4, stdShift: 0.2, baseline: {} as any, recent: {} as any,
      reasons: ["confidence PSI 0.600 > 0.25"],
    });
    checkAutoRetrainTriggerMock.mockResolvedValue({
      shouldRetrain: true, reason: "high error rate", feedbackCount: 150, labeledCount: 10,
    });

    const stats = await runSelfLearningScanOnce();

    expect(proposeRetrainJobMock).toHaveBeenCalledTimes(1);
    expect(proposeRetrainJobMock.mock.calls[0]![0]).toMatchObject({ driftSeverity: "CRITICAL" });
    expect(stats.retrainProposed).toBe(1);
  });

  it("concept drift (KS) alone (no confidence-PSI drift) also escalates, as HIGH/concept-drift-ks", async () => {
    checkConfidenceDriftMock.mockResolvedValue({
      enabled: true, modelId: 1, evaluated: true, drift: false, severity: "NONE" as const,
      psi: 0, meanShift: 0, stdShift: 0, baseline: {} as any, recent: {} as any, reasons: [],
    });
    checkConceptDriftKSMock.mockResolvedValue({
      enabled: true, modelId: 1, evaluated: true, drift: true, d: 0.9, pValue: 0.001, n1: 200, n2: 200,
      reasons: ["KS p-value 1.00e-3 < 0.01 (D=0.900) — concept drift"],
    });
    checkAutoRetrainTriggerMock.mockResolvedValue({ shouldRetrain: true, reason: "ok", feedbackCount: 0, labeledCount: 100 });

    const stats = await runSelfLearningScanOnce();

    expect(proposeRetrainJobMock).toHaveBeenCalledTimes(1);
    expect(proposeRetrainJobMock.mock.calls[0]![0]).toMatchObject({ driftSeverity: "HIGH", driftSource: "concept-drift-ks" });
    expect(stats.retrainProposed).toBe(1);
  });

  it("MEDIUM drift (not HIGH/CRITICAL) → does not even check the retrain trigger, no proposal", async () => {
    checkConfidenceDriftMock.mockResolvedValue({
      enabled: true, modelId: 1, evaluated: true, drift: false, severity: "MEDIUM" as const,
      psi: 0.15, meanShift: 0.05, stdShift: 0.02, baseline: {} as any, recent: {} as any,
      reasons: ["moderate PSI 0.150 (watch)"],
    });
    // Even if the trigger WOULD be satisfied, it must never be consulted for MEDIUM drift.
    checkAutoRetrainTriggerMock.mockResolvedValue({ shouldRetrain: true, reason: "would trigger", feedbackCount: 999, labeledCount: 999 });

    const stats = await runSelfLearningScanOnce();

    expect(checkAutoRetrainTriggerMock).not.toHaveBeenCalled();
    expect(proposeRetrainJobMock).not.toHaveBeenCalled();
    expect(stats.retrainProposed).toBe(0);
  });

  it("HIGH drift but trigger NOT satisfied → no proposal", async () => {
    checkConfidenceDriftMock.mockResolvedValue({
      enabled: true, modelId: 1, evaluated: true, drift: true, severity: "HIGH" as const,
      psi: 0.3, meanShift: 0.2, stdShift: 0.1, baseline: {} as any, recent: {} as any, reasons: ["drift"],
    });
    checkAutoRetrainTriggerMock.mockResolvedValue({ shouldRetrain: false, feedbackCount: 10, labeledCount: 5 });

    const stats = await runSelfLearningScanOnce();

    expect(checkAutoRetrainTriggerMock).toHaveBeenCalledTimes(1);
    expect(proposeRetrainJobMock).not.toHaveBeenCalled();
    expect(stats.retrainProposed).toBe(0);
  });

  it("a per-model failure does not abort the scan — other models are still processed", async () => {
    whereMock.mockResolvedValue([{ id: 1, currentVersion: "1.0.0" }, { id: 2, currentVersion: "1.0.0" }]);
    checkConfidenceDriftMock.mockImplementation(async (opts: any) => {
      if (opts.modelId === 1) throw new Error("boom — drift check failed for model 1");
      return {
        enabled: true, modelId: opts.modelId, evaluated: true, drift: true, severity: "HIGH" as const,
        psi: 0.3, meanShift: 0.2, stdShift: 0.1, baseline: {} as any, recent: {} as any, reasons: ["drift"],
      };
    });
    checkAutoRetrainTriggerMock.mockResolvedValue({ shouldRetrain: true, reason: "ok", feedbackCount: 0, labeledCount: 100 });

    const stats = await runSelfLearningScanOnce();

    // model 1 failed entirely (caught by the per-model try/catch); model 2 still proposed.
    expect(proposeRetrainJobMock).toHaveBeenCalledTimes(1);
    expect(proposeRetrainJobMock.mock.calls[0]![0]).toMatchObject({ modelId: 2 });
    expect(stats.retrainProposed).toBe(1);
    expect(stats.models).toBe(2);
  });

  it("never calls proposeRetrainJob when isDriftMonitorEnabled() is false, regardless of trigger", async () => {
    isDriftMonitorEnabledMock.mockReturnValue(false);
    checkAutoRetrainTriggerMock.mockResolvedValue({ shouldRetrain: true, reason: "ok", feedbackCount: 0, labeledCount: 200 });

    const stats = await runSelfLearningScanOnce();

    expect(checkConfidenceDriftMock).not.toHaveBeenCalled();
    expect(checkConceptDriftKSMock).not.toHaveBeenCalled();
    expect(proposeRetrainJobMock).not.toHaveBeenCalled();
    expect(stats.retrainProposed).toBe(0);
  });

  it("de-dup: when proposeRetrainJob reports a duplicate (returns null/falsy), the scan does NOT count it as a new proposal", async () => {
    // proposeRetrainJob owns the de-dup check (queries training_jobs itself — see
    // aiTrainingPipeline.proposeRetrain.test.ts); it signals "skipped, already
    // proposed" by resolving falsy instead of a created row. The scheduler must
    // treat that as zero NEW proposals, not increment retrainProposed, and not
    // crash reading `.id` off a null result.
    checkConfidenceDriftMock.mockResolvedValue({
      enabled: true, modelId: 1, evaluated: true, drift: true, severity: "HIGH" as const,
      psi: 0.3, meanShift: 0.2, stdShift: 0.1, baseline: {} as any, recent: {} as any, reasons: ["drift"],
    });
    checkAutoRetrainTriggerMock.mockResolvedValue({
      shouldRetrain: true, reason: "still qualifies", feedbackCount: 50, labeledCount: 120,
    });
    proposeRetrainJobMock.mockResolvedValue(null);

    const stats = await runSelfLearningScanOnce();

    expect(proposeRetrainJobMock).toHaveBeenCalledTimes(1);
    expect(stats.retrainProposed).toBe(0);
  });
});

describe("runSelfLearningScanOnce — AI_SELF_LEARNING_ENABLED=false (isolated module instance)", () => {
  it("HIGH drift + satisfied trigger → escalation is a no-op when the flag is off", async () => {
    vi.resetModules();
    const prevSelfLearning = process.env.AI_SELF_LEARNING_ENABLED;
    process.env.AI_SELF_LEARNING_ENABLED = "false";

    vi.doMock("../db/connection", () => ({ getDb: vi.fn(async () => fakeDb) }));
    vi.doMock("../../drizzle/schema", () => ({
      aiModels: { id: "id", status: "status", currentVersion: "currentVersion" },
    }));
    vi.doMock("./aiActiveLearningAuto", () => ({
      scanInferenceForUncertainty: vi.fn(async () => ({ scanned: 0, enqueued: 0, skippedExisting: 0, belowThreshold: 0 })),
    }));
    vi.doMock("./aiDriftMonitor", () => ({
      isDriftMonitorEnabled: () => true,
      checkConfidenceDrift: vi.fn(async () => ({
        enabled: true, modelId: 1, evaluated: true, drift: true, severity: "CRITICAL",
        psi: 0.9, meanShift: 0.5, stdShift: 0.3, baseline: {}, recent: {}, reasons: ["drift"],
      })),
      checkConceptDriftKS: vi.fn(async () => ({
        enabled: true, modelId: 1, evaluated: true, drift: false, d: 0, pValue: 1, n1: 0, n2: 0, reasons: [],
      })),
    }));
    const proposeRetrainJobFreshMock = vi.fn(async () => ({ id: 1, status: "QUEUED" }));
    vi.doMock("./aiTrainingPipeline", () => ({
      checkAutoRetrainTrigger: vi.fn(async () => ({ shouldRetrain: true, reason: "ok", feedbackCount: 0, labeledCount: 999 })),
      proposeRetrainJob: (...a: any[]) => proposeRetrainJobFreshMock(...a),
    }));
    whereMock.mockResolvedValue([{ id: 1, currentVersion: "1.0.0" }]);

    const mod = await import("./aiSelfLearningScheduler");
    const stats = await mod.runSelfLearningScanOnce();

    expect(proposeRetrainJobFreshMock).not.toHaveBeenCalled();
    expect(stats.retrainProposed).toBe(0);

    process.env.AI_SELF_LEARNING_ENABLED = prevSelfLearning;
  });
});
