/**
 * WS-1 — Unit tests for aiDatasetBuilder.stratifiedSplit (pure, no DB).
 */
import { describe, it, expect, vi } from "vitest";

// stratifiedSplit is pure, but the module imports DB helpers — mock them so the
// import graph never touches a real DB / onnxruntime.
vi.mock("../db/connection", () => ({ getDb: vi.fn() }));
vi.mock("../db/ai", () => ({ getAiModelById: vi.fn() }));
vi.mock("../db/aiAdvanced", () => ({ getTrainingDataset: vi.fn() }));

import { stratifiedSplit, type DatasetSample } from "./aiDatasetBuilder";

function makeSamples(perClass: Record<string, number>): DatasetSample[] {
  const out: DatasetSample[] = [];
  for (const [label, n] of Object.entries(perClass)) {
    for (let i = 0; i < n; i++) {
      out.push({ imageUrl: `${label}-${i}.jpg`, label, source: "label_queue" });
    }
  }
  return out;
}

const SPLIT = { train: 0.6, validation: 0.2, test: 0.2 };

describe("stratifiedSplit", () => {
  it("is reproducible for the same seed", () => {
    const samples = makeSamples({ OK: 20, NG: 10 });
    const a = stratifiedSplit(samples, SPLIT, 1234);
    const b = stratifiedSplit(samples, SPLIT, 1234);
    expect(a.train.map(s => s.imageUrl)).toEqual(b.train.map(s => s.imageUrl));
    expect(a.val.map(s => s.imageUrl)).toEqual(b.val.map(s => s.imageUrl));
    expect(a.test.map(s => s.imageUrl)).toEqual(b.test.map(s => s.imageUrl));
  });

  it("differs for a different seed", () => {
    const samples = makeSamples({ OK: 20, NG: 10 });
    const a = stratifiedSplit(samples, SPLIT, 1);
    const b = stratifiedSplit(samples, SPLIT, 2);
    expect(a.train.map(s => s.imageUrl)).not.toEqual(b.train.map(s => s.imageUrl));
  });

  it("partitions without overlap or loss", () => {
    const samples = makeSamples({ OK: 20, NG: 10 });
    const { train, val, test } = stratifiedSplit(samples, SPLIT, 7);
    const all = [...train, ...val, ...test].map(s => s.imageUrl).sort();
    const expected = samples.map(s => s.imageUrl).sort();
    expect(all).toEqual(expected);
    expect(new Set(all).size).toBe(samples.length); // no duplicates
  });

  it("preserves per-class proportions (stratified)", () => {
    const samples = makeSamples({ OK: 50, NG: 50 });
    const { train } = stratifiedSplit(samples, SPLIT, 99);
    const okInTrain = train.filter(s => s.label === "OK").length;
    const ngInTrain = train.filter(s => s.label === "NG").length;
    // each class 60% of 50 = 30
    expect(okInTrain).toBe(30);
    expect(ngInTrain).toBe(30);
  });

  it("treats casing variants as the same class (xước vs Xước)", () => {
    const samples: DatasetSample[] = [
      { imageUrl: "a.jpg", label: "xước", source: "label_queue" },
      { imageUrl: "b.jpg", label: "Xước", source: "feedback" },
      { imageUrl: "c.jpg", label: "xước", source: "label_queue" },
      { imageUrl: "d.jpg", label: " XƯỚC ", source: "feedback" },
      { imageUrl: "e.jpg", label: "xước", source: "label_queue" },
    ];
    // 5 samples, all one normalized class → 60% train = 3
    const { train, val, test } = stratifiedSplit(samples, SPLIT, 5);
    expect(train.length).toBe(3);
    expect(val.length + test.length).toBe(2);
  });
});
