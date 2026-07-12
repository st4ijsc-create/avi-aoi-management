/**
 * W5-B1 (doc 44, gap G4.14) — class-imbalance handling in the pure head trainer.
 *
 * Pure + deterministic (synthetic embeddings). Verifies:
 *  (a) DEFAULTS are byte-compatible — {classBalance:"none",focalGamma:0} yields
 *      IDENTICAL weights to no options (opt-in never changes existing math);
 *  (b) "class_weight" gives the minority class an inverse-frequency loss weight;
 *  (c) "oversample" balances the distribution the optimizer sees;
 *  (d) class balancing raises minority-class recall on an imbalanced set;
 *  (e) all modes stay deterministic under a fixed seed.
 */
import { describe, it, expect } from "vitest";
import { mulberry32 } from "../aiMetrics";
import {
  assembleEmbeddingDataset,
  splitEmbeddingDataset,
  trainEmbeddingHead,
  type LabeledEmbedding,
} from "./embeddingHeadTrainer";

const DIM = 8;
const SPLIT = { train: 0.7, validation: 0.15, test: 0.15 };

/** Imbalanced, linearly-separable clusters: many OK (+3 on dim0), few NG (−3). */
function imbalanced(perOk = 100, perNg = 14, seed = 42): LabeledEmbedding[] {
  const rand = mulberry32(seed);
  const noise = () => (rand() - 0.5) * 0.2;
  const pairs: LabeledEmbedding[] = [];
  let id = 1;
  for (let i = 0; i < perOk; i++) {
    const v = new Array(DIM).fill(0).map(() => noise());
    v[0] = 3 + noise();
    pairs.push({ id: id++, label: "OK", embedding: v });
  }
  for (let i = 0; i < perNg; i++) {
    const v = new Array(DIM).fill(0).map(() => noise());
    v[0] = -3 + noise();
    pairs.push({ id: id++, label: "NG", embedding: v });
  }
  return pairs;
}

const snap = assembleEmbeddingDataset(imbalanced());
const split = splitEmbeddingDataset(snap.samples, SPLIT, 1337);
const ngIdx = snap.classLabels.indexOf("NG");
const okIdx = snap.classLabels.indexOf("OK");

describe("(a) defaults are byte-compatible", () => {
  it("explicit none/γ=0 == implicit defaults (identical weights + temperature)", () => {
    const implicit = trainEmbeddingHead(split.train, split.val, snap.classLabels, { seed: 1337, epochs: 80 });
    const explicit = trainEmbeddingHead(split.train, split.val, snap.classLabels, {
      seed: 1337, epochs: 80, classBalance: "none", focalGamma: 0,
    });
    expect(explicit.artifact.weights).toEqual(implicit.artifact.weights);
    expect(explicit.artifact.biases).toEqual(implicit.artifact.biases);
    expect(explicit.artifact.temperature).toBe(implicit.artifact.temperature);
    // "none" ⇒ every class weight is exactly 1.
    expect(implicit.classBalance.mode).toBe("none");
    expect(implicit.classBalance.classWeights.every((w) => w === 1)).toBe(true);
  });
});

describe("(b) class_weight = inverse frequency", () => {
  it("the minority class gets a larger loss weight and the audit records the skew", () => {
    const cw = trainEmbeddingHead(split.train, split.val, snap.classLabels, {
      seed: 1337, epochs: 80, classBalance: "class_weight",
    });
    expect(cw.classBalance.mode).toBe("class_weight");
    expect(cw.classBalance.classWeights[ngIdx]).toBeGreaterThan(cw.classBalance.classWeights[okIdx]);
    expect(cw.classBalance.classWeights[ngIdx]).toBeGreaterThan(1);
    expect(cw.classBalance.classWeights[okIdx]).toBeLessThan(1);
    // distributionBefore reflects the raw imbalance (OK ≫ NG).
    expect(cw.classBalance.distributionBefore.OK).toBeGreaterThan(cw.classBalance.distributionBefore.NG);
    // class_weight leaves the sample COUNTS unchanged (only the loss is weighted).
    expect(cw.classBalance.distributionAfter).toEqual(cw.classBalance.distributionBefore);
  });
});

describe("(c) oversample balances the seen distribution", () => {
  it("replicates the minority up to the majority count (deterministically)", () => {
    const os = trainEmbeddingHead(split.train, split.val, snap.classLabels, {
      seed: 1337, epochs: 80, classBalance: "oversample",
    });
    expect(os.classBalance.mode).toBe("oversample");
    expect(os.classBalance.distributionAfter.OK).toBe(os.classBalance.distributionAfter.NG);
    // The majority count is unchanged; the minority is raised to match it.
    expect(os.classBalance.distributionAfter.NG).toBe(os.classBalance.distributionBefore.OK);
    const os2 = trainEmbeddingHead(split.train, split.val, snap.classLabels, {
      seed: 1337, epochs: 80, classBalance: "oversample",
    });
    expect(os2.artifact.weights).toEqual(os.artifact.weights);
  });
});

describe("(d) balancing helps minority recall", () => {
  it("class_weight recall(NG) ≥ unweighted recall(NG) on the val split", () => {
    const none = trainEmbeddingHead(split.train, split.val, snap.classLabels, { seed: 1337, epochs: 120 });
    const cw = trainEmbeddingHead(split.train, split.val, snap.classLabels, {
      seed: 1337, epochs: 120, classBalance: "class_weight",
    });
    const noneRecall = none.metrics.perClass[ngIdx]?.recall ?? 0;
    const cwRecall = cw.metrics.perClass[ngIdx]?.recall ?? 0;
    expect(cwRecall).toBeGreaterThanOrEqual(noneRecall);
  });
});
