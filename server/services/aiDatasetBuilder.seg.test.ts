/**
 * B8 — Unit tests for the SEGMENTATION dataset builder
 * (buildSegSamplesFromRows + splitSegmentationByImage). Pure functions, no DB.
 *
 * Verifies: manifest format {imageUrl, masks:[{label, points 0..1}], source};
 * normalize = px/width, px/height; grouping multiple masks per image; split by
 * image reproducible by seed; missing width/height skipped; <3 points skipped;
 * classLabels stable (sorted); labelDistribution correct.
 */
import { describe, it, expect, vi } from "vitest";

// The module imports DB helpers transitively — mock them so the import graph
// never touches a real DB / onnxruntime.
vi.mock("../db/connection", () => ({ getDb: vi.fn() }));
vi.mock("../db/ai", () => ({ getAiModelById: vi.fn() }));
vi.mock("../db/aiAdvanced", () => ({ getTrainingDataset: vi.fn() }));
vi.mock("../db/aiSegmentation", () => ({ listDefectSegmentations: vi.fn() }));

import {
  buildSegSamplesFromRows,
  splitSegmentationByImage,
  type SegSample,
} from "./aiDatasetBuilder";

type Row = Parameters<typeof buildSegSamplesFromRows>[0][number];

function poly(label: string, imageUrl: string | null, width: number, height: number, points: Array<{ x: number; y: number }>): Row {
  return { imageUrl, classLabel: label, maskData: { width, height, points } };
}

describe("buildSegSamplesFromRows", () => {
  it("normalizes points by width/height and emits the train.py manifest shape", () => {
    const rows: Row[] = [
      poly("scratch", "/uploads/a.jpg", 100, 200, [
        { x: 10, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 100 },
      ]),
    ];
    const { samples, classLabels, labelDistribution } = buildSegSamplesFromRows(rows);
    expect(samples).toHaveLength(1);
    const s = samples[0]!;
    expect(s.imageUrl).toBe("/uploads/a.jpg");
    expect(s.source).toBe("qc_segmentation");
    expect(s.masks).toHaveLength(1);
    expect(s.masks[0]!.label).toBe("scratch");
    // x/100, y/200
    expect(s.masks[0]!.points).toEqual([
      [0.1, 0.1], [0.4, 0.1], [0.4, 0.5],
    ]);
    expect(classLabels).toEqual(["scratch"]);
    expect(labelDistribution).toEqual({ scratch: 1 });
  });

  it("groups multiple polygons of the same image into one record", () => {
    const rows: Row[] = [
      poly("scratch", "/uploads/a.jpg", 10, 10, [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }]),
      poly("dent", "/uploads/a.jpg", 10, 10, [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }]),
      poly("scratch", "/uploads/b.jpg", 10, 10, [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }]),
    ];
    const { samples, labelDistribution, classLabels } = buildSegSamplesFromRows(rows);
    expect(samples).toHaveLength(2); // 2 images
    const a = samples.find((s) => s.imageUrl === "/uploads/a.jpg")!;
    expect(a.masks).toHaveLength(2);
    expect(a.masks.map((m) => m.label).sort()).toEqual(["dent", "scratch"]);
    expect(labelDistribution).toEqual({ scratch: 2, dent: 1 });
    // stable sorted classLabels
    expect(classLabels).toEqual(["dent", "scratch"]);
  });

  it("skips masks with missing/invalid width or height (no fabrication)", () => {
    const rows: Row[] = [
      // missing width
      { imageUrl: "/uploads/a.jpg", classLabel: "scratch", maskData: { height: 100, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }] } as any },
      // zero height
      poly("dent", "/uploads/b.jpg", 100, 0, [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]),
      // valid
      poly("crack", "/uploads/c.jpg", 100, 100, [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]),
    ];
    const { samples, skipped, classLabels } = buildSegSamplesFromRows(rows);
    expect(samples).toHaveLength(1);
    expect(samples[0]!.imageUrl).toBe("/uploads/c.jpg");
    expect(skipped.noDimensions).toBe(2);
    expect(classLabels).toEqual(["crack"]);
  });

  it("skips polygons with fewer than 3 points", () => {
    const rows: Row[] = [
      poly("scratch", "/uploads/a.jpg", 10, 10, [{ x: 1, y: 1 }, { x: 2, y: 2 }]),
      poly("dent", "/uploads/b.jpg", 10, 10, [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]),
    ];
    const { samples, skipped } = buildSegSamplesFromRows(rows);
    expect(samples).toHaveLength(1);
    expect(samples[0]!.masks[0]!.label).toBe("dent");
    expect(skipped.tooFewPoints).toBe(1);
  });

  it("clamps normalized coords into [0,1]", () => {
    const rows: Row[] = [
      poly("scratch", "/uploads/a.jpg", 10, 10, [{ x: -5, y: 0 }, { x: 20, y: 5 }, { x: 5, y: 100 }]),
    ];
    const { samples } = buildSegSamplesFromRows(rows);
    expect(samples[0]!.masks[0]!.points).toEqual([[0, 0], [1, 0.5], [0.5, 1]]);
  });

  it("ignores rows without an imageUrl", () => {
    const rows: Row[] = [
      poly("scratch", null, 10, 10, [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]),
    ];
    const { samples } = buildSegSamplesFromRows(rows);
    expect(samples).toHaveLength(0);
  });
});

const SPLIT = { train: 0.6, validation: 0.2, test: 0.2 };

function mkSamples(n: number, label: string): SegSample[] {
  const out: SegSample[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      imageUrl: `${label}-${i}.jpg`,
      masks: [{ label, points: [[0, 0], [0.1, 0], [0.1, 0.1]] }],
      source: "qc_segmentation",
    });
  }
  return out;
}

describe("splitSegmentationByImage", () => {
  it("is reproducible for the same seed", () => {
    const samples = [...mkSamples(20, "scratch"), ...mkSamples(10, "dent")];
    const a = splitSegmentationByImage(samples, SPLIT, 1234);
    const b = splitSegmentationByImage(samples, SPLIT, 1234);
    expect(a.train.map((s) => s.imageUrl)).toEqual(b.train.map((s) => s.imageUrl));
    expect(a.val.map((s) => s.imageUrl)).toEqual(b.val.map((s) => s.imageUrl));
    expect(a.test.map((s) => s.imageUrl)).toEqual(b.test.map((s) => s.imageUrl));
  });

  it("partitions images without overlap or loss", () => {
    const samples = [...mkSamples(20, "scratch"), ...mkSamples(10, "dent")];
    const { train, val, test } = splitSegmentationByImage(samples, SPLIT, 7);
    const all = [...train, ...val, ...test].map((s) => s.imageUrl).sort();
    const expected = samples.map((s) => s.imageUrl).sort();
    expect(all).toEqual(expected);
    expect(new Set(all).size).toBe(samples.length);
  });

  it("preserves per-class image proportions (stratified by dominant label)", () => {
    const samples = [...mkSamples(50, "scratch"), ...mkSamples(50, "dent")];
    const { train } = splitSegmentationByImage(samples, SPLIT, 99);
    const scratchInTrain = train.filter((s) => s.masks[0]!.label === "scratch").length;
    const dentInTrain = train.filter((s) => s.masks[0]!.label === "dent").length;
    expect(scratchInTrain).toBe(30); // 60% of 50
    expect(dentInTrain).toBe(30);
  });
});
