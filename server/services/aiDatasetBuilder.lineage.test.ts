/**
 * F3/D3 — dataset lineage content-hash tests (doc69 G10). Pure function tests
 * (no DB) + a small fs round-trip for `computeDatasetManifestHash` proving the
 * manifest-file-based recompute used by the eval harness.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";

// The module imports DB helpers transitively — mock them so the import graph
// never touches a real DB / onnxruntime (same pattern as aiDatasetBuilder.test.ts).
vi.mock("../db/connection", () => ({ getDb: vi.fn() }));
vi.mock("../db/ai", () => ({ getAiModelById: vi.fn() }));
vi.mock("../db/aiAdvanced", () => ({ getTrainingDataset: vi.fn() }));

import {
  computeContentHash,
  hashDatasetSamples,
  hashSegDatasetSamples,
  computeDatasetManifestHash,
  datasetDir,
  type DatasetSample,
  type SegSample,
} from "./aiDatasetBuilder";

describe("computeContentHash", () => {
  it("is a 64-char hex sha256 digest", () => {
    const h = computeContentHash(["a", "b", "c"]);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is order-independent (sorts internally) — same set, different collection order → same hash", () => {
    const h1 = computeContentHash(["c.jpg", "a.jpg", "b.jpg"]);
    const h2 = computeContentHash(["a.jpg", "b.jpg", "c.jpg"]);
    expect(h1).toBe(h2);
  });

  it("different sets → different hash", () => {
    const h1 = computeContentHash(["a.jpg", "b.jpg"]);
    const h2 = computeContentHash(["a.jpg", "b.jpg", "c.jpg"]);
    expect(h1).not.toBe(h2);
  });
});

describe("hashDatasetSamples", () => {
  const base: DatasetSample[] = [
    { imageUrl: "1.jpg", label: "OK", source: "label_queue" },
    { imageUrl: "2.jpg", label: "NG", source: "label_queue" },
  ];

  it("same manifest (any order) → identical hash", () => {
    const shuffled: DatasetSample[] = [base[1], base[0]];
    expect(hashDatasetSamples(base)).toBe(hashDatasetSamples(shuffled));
  });

  it("adding a sample → different hash", () => {
    const withExtra: DatasetSample[] = [...base, { imageUrl: "3.jpg", label: "OK", source: "feedback" }];
    expect(hashDatasetSamples(base)).not.toBe(hashDatasetSamples(withExtra));
  });

  it("editing a label → different hash (lineage is content-sensitive, not just image-set-sensitive)", () => {
    const relabelled: DatasetSample[] = [{ ...base[0], label: "NG" }, base[1]];
    expect(hashDatasetSamples(base)).not.toBe(hashDatasetSamples(relabelled));
  });
});

describe("hashSegDatasetSamples", () => {
  it("same images+labels (mask order shuffled within an image) → identical hash", () => {
    const a: SegSample[] = [{
      imageUrl: "img1.jpg",
      masks: [{ label: "scratch", points: [[0, 0], [1, 0], [1, 1]] }, { label: "dent", points: [[0, 0], [1, 0], [1, 1]] }],
      source: "qc_segmentation",
    }];
    const b: SegSample[] = [{
      imageUrl: "img1.jpg",
      masks: [{ label: "dent", points: [[9, 9], [8, 8], [7, 7]] }, { label: "scratch", points: [[2, 2], [3, 3], [4, 4]] }],
      source: "qc_segmentation",
    }];
    // Mask geometry (points) doesn't affect the id — only imageUrl + sorted labels — so this
    // is same hash even though point coordinates differ (the id is imageUrl+labels by design).
    expect(hashSegDatasetSamples(a)).toBe(hashSegDatasetSamples(b));
  });

  it("different image set → different hash", () => {
    const a: SegSample[] = [{ imageUrl: "img1.jpg", masks: [{ label: "scratch", points: [[0, 0], [1, 0], [1, 1]] }], source: "qc_segmentation" }];
    const b: SegSample[] = [{ imageUrl: "img2.jpg", masks: [{ label: "scratch", points: [[0, 0], [1, 0], [1, 1]] }], source: "qc_segmentation" }];
    expect(hashSegDatasetSamples(a)).not.toBe(hashSegDatasetSamples(b));
  });
});

describe("computeDatasetManifestHash (fs round-trip)", () => {
  const TEST_DATASET_ID = 900001;
  const OTHER_DATASET_ID = 900002;

  function writeManifests(id: number, train: DatasetSample[], val: DatasetSample[], test: DatasetSample[]): void {
    const dir = datasetDir(id);
    fs.mkdirSync(dir, { recursive: true });
    const write = (name: string, samples: DatasetSample[]) => {
      const lines = samples.map((s) => JSON.stringify(s));
      fs.writeFileSync(path.join(dir, name), lines.join("\n") + (lines.length ? "\n" : ""), "utf-8");
    };
    write("train.jsonl", train);
    write("val.jsonl", val);
    write("test.jsonl", test);
  }

  afterEach(() => {
    for (const id of [TEST_DATASET_ID, OTHER_DATASET_ID]) {
      fs.rmSync(datasetDir(id), { recursive: true, force: true });
    }
  });

  it("same materialized manifest, read twice → identical hash", () => {
    writeManifests(
      TEST_DATASET_ID,
      [{ imageUrl: "1.jpg", label: "OK", source: "label_queue" }],
      [{ imageUrl: "2.jpg", label: "NG", source: "label_queue" }],
      [{ imageUrl: "3.jpg", label: "OK", source: "feedback" }],
    );
    const h1 = computeDatasetManifestHash(TEST_DATASET_ID);
    const h2 = computeDatasetManifestHash(TEST_DATASET_ID);
    expect(h1).toBe(h2);
  });

  it("a different manifest (different dataset dir) → a different hash", () => {
    writeManifests(
      TEST_DATASET_ID,
      [{ imageUrl: "1.jpg", label: "OK", source: "label_queue" }],
      [], [],
    );
    writeManifests(
      OTHER_DATASET_ID,
      [{ imageUrl: "1.jpg", label: "NG", source: "label_queue" }], // different label
      [], [],
    );
    expect(computeDatasetManifestHash(TEST_DATASET_ID)).not.toBe(computeDatasetManifestHash(OTHER_DATASET_ID));
  });

  it("missing manifest dir (never built) → deterministic hash of the empty set, never throws", () => {
    const NEVER_BUILT_ID = 900099;
    expect(() => computeDatasetManifestHash(NEVER_BUILT_ID)).not.toThrow();
    expect(computeDatasetManifestHash(NEVER_BUILT_ID)).toBe(computeContentHash([]));
  });
});
