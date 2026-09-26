/**
 * F3/D1 — reference-value tests for segmentation/detection evaluators
 * (IoU/Dice/mAP) + the seg/detection quality gate. All hand-computed —
 * perfect overlap → 1.0, disjoint → 0, partial → a known value.
 */
import { describe, it, expect } from "vitest";
import {
  iouBox,
  iouMask,
  diceMask,
  computeAveragePrecision,
  evaluateSegmentation,
  evaluateDetection,
  evaluateSegDetectionGate,
  type MaskLike,
  type EvalBox,
} from "./aiSegDetectEval";

// ── Box IoU ──────────────────────────────────────────────────────────────────

describe("iouBox", () => {
  it("identical boxes → 1.0", () => {
    const a: EvalBox = { x: 0, y: 0, w: 4, h: 4, classIndex: 0 };
    expect(iouBox(a, { ...a })).toBe(1);
  });
  it("disjoint boxes → 0", () => {
    const a: EvalBox = { x: 0, y: 0, w: 4, h: 4, classIndex: 0 };
    const b: EvalBox = { x: 100, y: 100, w: 4, h: 4, classIndex: 0 };
    expect(iouBox(a, b)).toBe(0);
  });
  it("half-overlap → known value 8/24 = 0.3333", () => {
    // A=[0,0,4,4] area16; B=[2,0,4,4] area16; intersection=[2,0]..[4,4]=2x4=8; union=16+16-8=24.
    const a: EvalBox = { x: 0, y: 0, w: 4, h: 4, classIndex: 0 };
    const b: EvalBox = { x: 2, y: 0, w: 4, h: 4, classIndex: 0 };
    expect(iouBox(a, b)).toBeCloseTo(8 / 24, 10);
  });
});

// ── Mask IoU / Dice ──────────────────────────────────────────────────────────

function grid(width: number, height: number, data: number[]): MaskLike {
  return { width, height, data };
}

describe("iouMask / diceMask", () => {
  it("perfect overlap → IoU 1.0, Dice 1.0", () => {
    const a = grid(2, 2, [1, 1, 0, 0]);
    const b = grid(2, 2, [1, 1, 0, 0]);
    expect(iouMask(a, b)).toBe(1);
    expect(diceMask(a, b)).toBe(1);
  });

  it("disjoint (top row vs bottom row) → IoU 0, Dice 0", () => {
    const a = grid(2, 2, [1, 1, 0, 0]);
    const b = grid(2, 2, [0, 0, 1, 1]);
    expect(iouMask(a, b)).toBe(0);
    expect(diceMask(a, b)).toBe(0);
  });

  it("partial overlap (3 fg each, 2 shared) → IoU 0.5, Dice 0.6667", () => {
    // A = [1,1,1,0], B = [0,1,1,1]: intersection = {1,2} = 2, union = {0,1,2,3} = 4.
    const a = grid(4, 1, [1, 1, 1, 0]);
    const b = grid(4, 1, [0, 1, 1, 1]);
    expect(iouMask(a, b)).toBeCloseTo(0.5, 10);
    expect(diceMask(a, b)).toBeCloseTo(4 / 6, 10);
  });

  it("both empty → IoU 1, Dice 1 (nothing to miss, nothing extra)", () => {
    const a = grid(2, 2, [0, 0, 0, 0]);
    const b = grid(2, 2, [0, 0, 0, 0]);
    expect(iouMask(a, b)).toBe(1);
    expect(diceMask(a, b)).toBe(1);
  });

  it("throws on grid size mismatch", () => {
    const a = grid(2, 2, [1, 1, 0, 0]);
    const b = grid(3, 3, new Array(9).fill(0));
    expect(() => iouMask(a, b)).toThrow(/mismatch/);
  });
});

describe("evaluateSegmentation", () => {
  it("aggregates per-class + macro mean IoU/Dice, missing prediction scores 0", () => {
    const perfect = grid(2, 2, [1, 1, 0, 0]);
    const partialA = grid(4, 1, [1, 1, 1, 0]);
    const partialB = grid(4, 1, [0, 1, 1, 1]);

    const report = evaluateSegmentation([
      { classIndex: 0, label: "scratch", predicted: perfect, groundTruth: perfect },
      { classIndex: 1, label: "dent", predicted: partialA, groundTruth: partialB },
      // class 2: ground truth present but nothing predicted → missed detection → 0/0.
      { classIndex: 2, label: "void", predicted: null, groundTruth: perfect },
    ]);

    expect(report.evaluated).toBe(3);
    const byClass = new Map(report.perClass.map((c) => [c.classIndex, c]));
    expect(byClass.get(0)!.iou).toBe(1);
    expect(byClass.get(1)!.iou).toBeCloseTo(0.5, 4);
    expect(byClass.get(2)!.iou).toBe(0);
    // macro mean over 3 classes = (1 + 0.5 + 0) / 3.
    expect(report.meanIoU).toBeCloseTo((1 + 0.5 + 0) / 3, 4);
  });

  it("both sides null for every pair → nothing evaluated, means 0", () => {
    const report = evaluateSegmentation([{ classIndex: 0, predicted: null, groundTruth: null }]);
    expect(report.evaluated).toBe(0);
    expect(report.meanIoU).toBe(0);
    expect(report.meanDice).toBe(0);
  });
});

// ── Detection mAP ────────────────────────────────────────────────────────────

describe("computeAveragePrecision", () => {
  it("perfect single match → AP 1.0", () => {
    const gt: EvalBox[] = [{ x: 0, y: 0, w: 4, h: 4, classIndex: 0 }];
    const pred: EvalBox[] = [{ x: 0, y: 0, w: 4, h: 4, classIndex: 0, score: 0.9 }];
    expect(computeAveragePrecision(pred, gt, 0.5)).toBe(1);
  });

  it("disjoint prediction (no overlap) → AP 0", () => {
    const gt: EvalBox[] = [{ x: 0, y: 0, w: 4, h: 4, classIndex: 0 }];
    const pred: EvalBox[] = [{ x: 100, y: 100, w: 4, h: 4, classIndex: 0, score: 0.9 }];
    expect(computeAveragePrecision(pred, gt, 0.5)).toBe(0);
  });

  it("one TP (high-score, IoU>=0.5) + one FP (low-score, no overlap) → AP 0.5 (hand-computed)", () => {
    // gt1=[0,0,10,10], gt2=[100,100,10,10].
    // p1 (score .9) vs gt1: intersection=[2,0]..[10,10]=8x10=80; union=100+100-80=120; IoU=0.667 (TP).
    // p2 (score .8) has no overlap with anything → FP.
    // Ranking: p1 → recall 0.5, precision 1.0 → ΔAP = 0.5*1 = 0.5.
    //          p2 → recall stays 0.5, precision 0.5 → ΔAP = 0*0.5 = 0.
    const gt: EvalBox[] = [
      { x: 0, y: 0, w: 10, h: 10, classIndex: 0 },
      { x: 100, y: 100, w: 10, h: 10, classIndex: 0 },
    ];
    const pred: EvalBox[] = [
      { x: 2, y: 0, w: 10, h: 10, classIndex: 0, score: 0.9 },
      { x: 500, y: 500, w: 10, h: 10, classIndex: 0, score: 0.8 },
    ];
    expect(computeAveragePrecision(pred, gt, 0.5)).toBeCloseTo(0.5, 10);
  });

  it("no ground truth + no predictions → AP 1 (trivial); no ground truth + predictions → AP 0", () => {
    expect(computeAveragePrecision([], [], 0.5)).toBe(1);
    expect(computeAveragePrecision([{ x: 0, y: 0, w: 1, h: 1, classIndex: 0, score: 1 }], [], 0.5)).toBe(0);
  });
});

describe("evaluateDetection (mAP across classes)", () => {
  it("mAP = macro mean of per-class AP", () => {
    const gt: EvalBox[] = [
      { x: 0, y: 0, w: 10, h: 10, classIndex: 0 },
      { x: 100, y: 100, w: 10, h: 10, classIndex: 0 },
      { x: 0, y: 0, w: 4, h: 4, classIndex: 1 },
    ];
    const pred: EvalBox[] = [
      { x: 2, y: 0, w: 10, h: 10, classIndex: 0, score: 0.9 }, // TP for class0
      { x: 500, y: 500, w: 10, h: 10, classIndex: 0, score: 0.8 }, // FP for class0
      { x: 0, y: 0, w: 4, h: 4, classIndex: 1, score: 0.99 }, // perfect TP for class1
    ];
    const report = evaluateDetection(pred, gt, { iouThreshold: 0.5 });
    const byClass = new Map(report.perClass.map((c) => [c.classIndex, c.ap]));
    expect(byClass.get(0)).toBeCloseTo(0.5, 4);
    expect(byClass.get(1)).toBe(1);
    expect(report.mAP).toBeCloseTo(0.75, 4);
  });
});

// ── Quality gate ──────────────────────────────────────────────────────────────

describe("evaluateSegDetectionGate", () => {
  it("passes when there is no baseline (first version)", () => {
    const r = evaluateSegDetectionGate({ metric: "meanIoU", candidateValue: 0.7 });
    expect(r.pass).toBe(true);
  });

  it("passes when candidate >= baseline - epsilon", () => {
    const r = evaluateSegDetectionGate({ metric: "meanIoU", candidateValue: 0.62, baselineValue: 0.6, epsilon: 0 });
    expect(r.pass).toBe(true);
    expect(r.delta).toBeCloseTo(0.02, 4);
  });

  it("BLOCKS a regression beyond epsilon", () => {
    const r = evaluateSegDetectionGate({ metric: "mAP", candidateValue: 0.5, baselineValue: 0.6, epsilon: 0 });
    expect(r.pass).toBe(false);
    expect(r.delta).toBeCloseTo(-0.1, 4);
  });

  it("allows a drop within epsilon tolerance", () => {
    const r = evaluateSegDetectionGate({ metric: "mAP", candidateValue: 0.58, baselineValue: 0.6, epsilon: 0.05 });
    expect(r.pass).toBe(true);
  });

  it("BLOCKS below an absolute floor even with no baseline", () => {
    const r = evaluateSegDetectionGate({ metric: "meanIoU", candidateValue: 0.4, floor: 0.5 });
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/floor/);
  });
});
