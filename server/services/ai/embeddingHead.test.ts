/**
 * AOI-C — embedding-head round-trip tests (doc 24 Wave-3).
 *
 * Pure + deterministic, synthetic embeddings only (NO real model / GPU / images):
 *   (a) trainer separates two linearly-separable embedding clusters to high val acc
 *   (b) dataset version is immutable + reproducible (checksum + frozen + split)
 *   (c) predict returns calibrated confidence + routes low-confidence to review
 *   (d) register → A/B → rollback round-trips through the registry (pure cores)
 *   (e) honest degrade when no trained head exists (falls back / labeled)
 */
import { describe, it, expect } from "vitest";
import { mulberry32 } from "../aiMetrics";
import {
  assembleEmbeddingDataset,
  splitEmbeddingDataset,
  trainEmbeddingHead,
  predictWithHead,
  parseHeadArtifact,
  serializeHeadArtifact,
  buildHeadModelVersionPayload,
  HeadInputDimError,
  type LabeledEmbedding,
} from "./embeddingHeadTrainer";
import {
  isEmbeddingHeadEnabled,
  isEmbeddingHeadModel,
  runEmbeddingHeadInference,
  HEAD_KIND,
} from "./embeddingHead";
import { selectCanaryVariant } from "../aiABTesting";
import { evaluateRollback, pickRollbackTarget, baselineAccuracyOf } from "./modelAutoRollback";
import type { AiModel, ModelVersion } from "../../../drizzle/schema";

const DIM = 16;

/** Deterministic two-cluster synthetic embedding set, linearly separable on dim 0. */
function makeClusters(perClass = 60, seed = 42): LabeledEmbedding[] {
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

const SPLIT = { train: 0.7, validation: 0.15, test: 0.15 };

// ── (a) trainer reaches high val accuracy on separable clusters ────────────────
describe("(a) trainEmbeddingHead — separable clusters", () => {
  it("reaches high validation accuracy and is deterministic", () => {
    const snap = assembleEmbeddingDataset(makeClusters());
    const split = splitEmbeddingDataset(snap.samples, SPLIT, 1337);

    const r1 = trainEmbeddingHead(split.train, split.val, snap.classLabels, { seed: 1337, epochs: 120 });
    expect(r1.metrics.accuracy).toBeGreaterThan(0.9);
    expect(r1.valCount).toBeGreaterThan(0);
    // Real metrics — precision/recall/F1 present and sane.
    expect(r1.metrics.f1Score).toBeGreaterThan(0.9);
    expect(r1.artifact.inputDim).toBe(DIM);
    expect(r1.artifact.weights.length).toBe(DIM * snap.classLabels.length);

    // Deterministic: same seed + data ⇒ identical weights.
    const r2 = trainEmbeddingHead(split.train, split.val, snap.classLabels, { seed: 1337, epochs: 120 });
    expect(r2.artifact.weights).toEqual(r1.artifact.weights);
    expect(r2.artifact.biases).toEqual(r1.artifact.biases);
    expect(r2.artifact.temperature).toBe(r1.artifact.temperature);
  });
});

// ── (b) dataset version is immutable + reproducible ────────────────────────────
describe("(b) dataset versioning — immutable + reproducible", () => {
  it("same pairs (any order) ⇒ same checksum, and the snapshot is frozen", () => {
    const pairs = makeClusters();
    const a = assembleEmbeddingDataset(pairs);
    const b = assembleEmbeddingDataset([...pairs].reverse()); // reordered input
    expect(b.checksum).toBe(a.checksum); // order-independent → reproducible
    expect(a.sampleCount).toBe(pairs.length);
    expect(a.classLabels).toEqual(["NG", "OK"]);

    // Immutable: deep-frozen, cannot be mutated.
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.samples)).toBe(true);
    expect(() => {
      // @ts-expect-error — intentionally attempting an illegal mutation
      a.samples.push({ embeddingId: 999, label: "X", vector: [] });
    }).toThrow();
    const before = a.sampleCount;
    expect(a.sampleCount).toBe(before);

    // Reproducible split: same seed ⇒ identical partitions.
    const s1 = splitEmbeddingDataset(a.samples, SPLIT, 7);
    const s2 = splitEmbeddingDataset(a.samples, SPLIT, 7);
    expect(s1.train.map((x) => x.embeddingId)).toEqual(s2.train.map((x) => x.embeddingId));
    expect(s1.val.map((x) => x.embeddingId)).toEqual(s2.val.map((x) => x.embeddingId));
    expect(s1.test.map((x) => x.embeddingId)).toEqual(s2.test.map((x) => x.embeddingId));
    // Stratified: both classes present in train.
    const trainLabels = new Set(s1.train.map((x) => x.label));
    expect(trainLabels.has("OK")).toBe(true);
    expect(trainLabels.has("NG")).toBe(true);
  });

  it("drops bad/mismatched rows honestly (no fabrication)", () => {
    const snap = assembleEmbeddingDataset([
      { id: 1, label: "OK", embedding: [1, 2, 3] },
      { id: 2, label: "", embedding: [1, 2, 3] }, // no label
      { id: 3, label: "NG", embedding: [] }, // bad vector
      { id: 4, label: "NG", embedding: [1, 2] }, // dim mismatch
      { id: 1, label: "OK", embedding: [1, 2, 3] }, // duplicate id
    ]);
    expect(snap.sampleCount).toBe(1);
    expect(snap.dropped).toEqual({ badVector: 1, dimMismatch: 1, noLabel: 1, duplicate: 1 });
  });
});

// ── (c) calibrated confidence + review routing ─────────────────────────────────
describe("(c) predictWithHead — calibrated confidence + review routing", () => {
  it("routes confident → auto and ambiguous → review", () => {
    const snap = assembleEmbeddingDataset(makeClusters());
    const split = splitEmbeddingDataset(snap.samples, SPLIT, 1337);
    const { artifact } = trainEmbeddingHead(split.train, split.val, snap.classLabels, { seed: 1337, epochs: 120 });

    // Confident: deep inside the OK cluster.
    const confidentVec = new Array(DIM).fill(0);
    confidentVec[0] = 3;
    const confident = predictWithHead(artifact, confidentVec);
    expect(confident.confidence).toBeGreaterThanOrEqual(0);
    expect(confident.confidence).toBeLessThanOrEqual(1);
    expect(confident.confidence).toBeGreaterThan(0.7);
    expect(confident.route).toBe("auto");
    expect(confident.label).toBe("OK");

    // Ambiguous: exactly on the decision boundary (dim 0 = 0).
    const ambiguousVec = new Array(DIM).fill(0);
    const ambiguous = predictWithHead(artifact, ambiguousVec);
    expect(ambiguous.route).toBe("review");
    expect(ambiguous.confidence).toBeLessThan(confident.confidence);
    // Probabilities sum to ~1 (a proper calibrated distribution).
    const sum = ambiguous.probabilities.reduce((s, p) => s + p.confidence, 0);
    expect(sum).toBeCloseTo(1, 2);
    // rawConfidence exists alongside the calibrated confidence.
    expect(confident.rawConfidence).toBeGreaterThan(0);

    // Artifact round-trips through JSON serialization.
    const reparsed = parseHeadArtifact(serializeHeadArtifact(artifact));
    const again = predictWithHead(reparsed, confidentVec);
    expect(again.label).toBe(confident.label);
    expect(again.confidence).toBeCloseTo(confident.confidence, 6);
  });
});

// ── (d) register → A/B → rollback round-trips through the registry ─────────────
describe("(d) register → A/B → rollback (registry primitives)", () => {
  it("builds a real-metrics version payload, routes canary deterministically, and rolls back", () => {
    const snap = assembleEmbeddingDataset(makeClusters());
    const split = splitEmbeddingDataset(snap.samples, SPLIT, 1337);
    const trained = trainEmbeddingHead(split.train, split.val, snap.classLabels, { seed: 1337, epochs: 120 });

    // REGISTER — the model_versions payload carries REAL metrics (never fabricated).
    const payload = buildHeadModelVersionPayload({
      modelId: 10,
      version: "1.1.0",
      filePath: "/uploads/models/heads/defect-head/v1.1.0/head.json",
      metrics: trained.metrics,
      datasetId: 5,
      baselineVersionId: 100,
    });
    expect(payload.metrics.accuracy).toBe(trained.metrics.accuracy);
    expect(Number(payload.accuracy)).toBeCloseTo(trained.metrics.accuracy * 100, 2);
    expect(payload.status).toBe("READY");
    expect(payload.datasetId).toBe(5);
    expect(payload.baselineVersionId).toBe(100);

    // A/B — deterministic canary routing (same id ⇒ same variant, idempotent).
    const exp = { trafficSplitPercent: 30 };
    const v1 = selectCanaryVariant(exp, 12345);
    const v2 = selectCanaryVariant(exp, 12345);
    expect(v1).toBe(v2);
    expect(["A", "B"]).toContain(v1);

    // ROLLBACK — model_versions with the head's REAL metrics feed the pure decision.
    const active = mkVersion({ id: 200, version: "1.1.0", status: "ACTIVE", metrics: { accuracy: trained.metrics.accuracy } });
    const prior = mkVersion({ id: 100, version: "1.0.0", status: "INACTIVE", metrics: { accuracy: 0.98 }, createdAt: new Date("2026-01-01") });
    expect(baselineAccuracyOf(active)).toBe(trained.metrics.accuracy);

    const target = pickRollbackTarget([active, prior], active.id);
    expect(target?.id).toBe(100);

    // A live drop below the eval baseline triggers a rollback (auto_accuracy).
    const decision = evaluateRollback(baselineAccuracyOf(active), { liveAccuracy: 0.5, driftScore: 0 }, { accDrop: 0.05, drift: 0.25 });
    expect(decision.shouldRollback).toBe(true);
    expect(decision.trigger).toBe("auto_accuracy");
  });
});

// ── (e) honest degrade / fallback ──────────────────────────────────────────────
describe("(e) honest degrade when no trained head exists", () => {
  it("flag defaults OFF and head detection is precise", () => {
    // Default OFF → runInference keeps today's ONNX/threshold path.
    expect(isEmbeddingHeadEnabled()).toBe(false);
    // Not a head model → today's path.
    const onnx = { format: "ONNX", metadata: null } as unknown as AiModel;
    expect(isEmbeddingHeadModel(onnx)).toBe(false);
    // A registered head model IS detected.
    const head = { format: "CUSTOM", metadata: { headKind: HEAD_KIND, inputDim: DIM } } as unknown as AiModel;
    expect(isEmbeddingHeadModel(head)).toBe(true);
  });

  it("predict throws a typed error on an embedding-space mismatch (no guessing)", () => {
    const snap = assembleEmbeddingDataset(makeClusters());
    const split = splitEmbeddingDataset(snap.samples, SPLIT, 1337);
    const { artifact } = trainEmbeddingHead(split.train, split.val, snap.classLabels, { seed: 1337, epochs: 60 });
    expect(() => predictWithHead(artifact, [1, 2, 3])).toThrow(HeadInputDimError);
  });

  it("serving with no artifact degrades LABELED (empty predictions, review) — never fabricates", async () => {
    const model = {
      id: 999,
      code: "defect-head",
      currentVersion: "1.0.0",
      filePath: null, // no artifact on disk
      productModelId: null,
      format: "CUSTOM",
      metadata: { headKind: HEAD_KIND, inputDim: DIM },
    } as unknown as AiModel;

    const out = await runEmbeddingHeadInference(model, Buffer.from(""), { inspectionId: 1 });
    expect(out.degraded).toBe(true);
    expect(out.predictions).toEqual([]);
    expect(out.confidence).toBe(0);
    expect(out.topLabel).toBeNull();
    expect(out.route).toBe("review");
    expect(out.embeddingSource).toBe("none");
  });
});

function mkVersion(partial: Partial<ModelVersion>): ModelVersion {
  return {
    id: 1, modelId: 10, version: "1.0.0", filePath: null, fileKey: null, fileSize: null,
    fileHash: null, changeLog: null, metrics: null, accuracy: null, status: "READY",
    datasetId: null, baselineVersionId: null, evalReport: null, createdBy: null,
    createdAt: new Date("2026-02-01"), ...partial,
  } as ModelVersion;
}
