/**
 * F3/D2 — ROC calibration tests (doc69 G9). Hand-computed against a fixed
 * labelled sample set so both target-recall and target-FPR calibration land
 * on an exactly-verifiable ROC point.
 *
 * Sample set (isAnomaly = score > threshold, matching scoreFromVector):
 *   NG = [0.9, 0.8, 0.7, 0.3]   (4 samples)
 *   OK = [0.6, 0.5, 0.4, 0.2, 0.1]  (5 samples)
 *
 * Hand-computed ROC points used below:
 *   t=0.6 → NG>0.6={0.9,0.8,0.7}=3/4=0.75 recall; OK>0.6={} = 0/5 = 0 fpr.
 *   t=0.5 → NG>0.5={0.9,0.8,0.7}=3/4=0.75 recall; OK>0.5={0.6}=1/5=0.2 fpr.
 */
import { describe, it, expect, vi } from "vitest";

// vi.mock factories are hoisted above imports/const declarations — use vi.hoisted
// so the mock fn exists before the factory runs (see vitest docs on hoisting).
const { setCalibratedThresholdMock } = vi.hoisted(() => ({ setCalibratedThresholdMock: vi.fn(async () => {}) }));
vi.mock("../db/aiAnomaly", () => ({
  setCalibratedThreshold: setCalibratedThresholdMock,
}));

import { computeRocSweep, calibrateThreshold, calibrateAndStore, type LabelledScore } from "./aiAnomalyCalibration";

const SAMPLES: LabelledScore[] = [
  { score: 0.9, label: "NG" },
  { score: 0.8, label: "NG" },
  { score: 0.7, label: "NG" },
  { score: 0.3, label: "NG" },
  { score: 0.6, label: "OK" },
  { score: 0.5, label: "OK" },
  { score: 0.4, label: "OK" },
  { score: 0.2, label: "OK" },
  { score: 0.1, label: "OK" },
];

describe("computeRocSweep", () => {
  it("recall/fpr are non-increasing as threshold increases, and reach the extremes", () => {
    const points = computeRocSweep(SAMPLES);
    // Lowest threshold (just below min score) → everything flagged → recall=1, fpr=1.
    expect(points[0].recall).toBe(1);
    expect(points[0].fpr).toBe(1);
    // Highest threshold (max score, 0.9) → NG>0.9 = {} → recall=0.
    expect(points[points.length - 1].recall).toBe(0);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].recall).toBeLessThanOrEqual(points[i - 1].recall + 1e-9);
      expect(points[i].fpr).toBeLessThanOrEqual(points[i - 1].fpr + 1e-9);
    }
  });

  it("empty input → empty sweep", () => {
    expect(computeRocSweep([])).toEqual([]);
  });
});

describe("calibrateThreshold — target recall", () => {
  it("targetRecall=0.75 → threshold 0.6 (tightest point still clearing 75% recall), fpr 0 (hand-computed)", () => {
    const r = calibrateThreshold(SAMPLES, { targetRecall: 0.75 });
    expect(r.threshold).toBeCloseTo(0.6, 10);
    expect(r.achievedRecall).toBeCloseTo(0.75, 10);
    expect(r.achievedFpr).toBe(0);
    expect(r.sampleCount).toEqual({ ng: 4, ok: 5 });
  });

  it("unattainable target (>1) degrades to the loosest point (max achievable recall = 1)", () => {
    const r = calibrateThreshold(SAMPLES, { targetRecall: 1.1 });
    expect(r.achievedRecall).toBe(1);
  });
});

describe("calibrateThreshold — target FPR", () => {
  it("targetFpr=0.2 → threshold 0.5 (loosest point still under 20% FPR), recall 0.75 (hand-computed)", () => {
    const r = calibrateThreshold(SAMPLES, { targetFpr: 0.2 });
    expect(r.threshold).toBeCloseTo(0.5, 10);
    expect(r.achievedFpr).toBeCloseTo(0.2, 10);
    expect(r.achievedRecall).toBeCloseTo(0.75, 10);
  });

  it("unattainable target (<0) degrades to the tightest point (min achievable fpr = 0)", () => {
    const r = calibrateThreshold(SAMPLES, { targetFpr: -0.1 });
    expect(r.achievedFpr).toBe(0);
  });
});

describe("calibrateThreshold — input validation", () => {
  it("throws when neither target is given", () => {
    expect(() => calibrateThreshold(SAMPLES, {})).toThrow(/target/);
  });
  it("throws on empty samples", () => {
    expect(() => calibrateThreshold([], { targetRecall: 0.9 })).toThrow(/samples/);
  });
});

describe("calibrateAndStore", () => {
  it("calibrates then persists via setCalibratedThreshold with the achieved operating point", async () => {
    setCalibratedThresholdMock.mockClear();
    const scope = { productModelId: 1, machineId: 1, modelCode: "anomaly:onnx:dinov2-small" };
    const result = await calibrateAndStore(scope, SAMPLES, { targetRecall: 0.75 });

    expect(result.threshold).toBeCloseTo(0.6, 10);
    expect(setCalibratedThresholdMock).toHaveBeenCalledTimes(1);
    const [calledScope, calledThreshold, calledTarget] = setCalibratedThresholdMock.mock.calls[0];
    expect(calledScope).toBe(scope);
    expect(calledThreshold).toBeCloseTo(0.6, 10);
    expect(calledTarget.targetRecall).toBe(0.75);
    expect(calledTarget.achievedRecall).toBeCloseTo(0.75, 10);
    expect(calledTarget.sampleCount).toEqual({ ng: 4, ok: 5 });
    expect(typeof calledTarget.calibratedAt).toBe("string");
  });
});
