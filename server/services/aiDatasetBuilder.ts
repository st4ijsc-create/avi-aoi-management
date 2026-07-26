/**
 * AI Dataset Builder — WS-1
 *
 * Materializes a training dataset from the two canonical label sources, dedupes
 * by image URL, performs a STRATIFIED split (train/val/test) with a fixed seed
 * (reproducible), writes JSONL manifests to uploads/datasets/<id>/, and updates
 * the `training_datasets` row (storageKey / totalSamples / labelDistribution /
 * status). val + test are locked so before/after evaluation is fair.
 *
 * Offline-first: only DB + local filesystem, no network.
 */

import path from "path";
import fs from "fs";
import crypto from "crypto";
import { getDb } from "../db/connection";
import { getAiModelById } from "../db/ai";
import * as dbAdvanced from "../db/aiAdvanced";
import { eq, and, inArray, gte, desc, sql } from "drizzle-orm";
import {
  aiLabelQueue,
  aiFeedback,
  aiSuggestions,
  measurementResults,
  trainingDatasets,
} from "../../drizzle/schema";
import { listDefectSegmentations } from "../db/aiSegmentation";
import { normalizeLabel, displayLabel, seededShuffle, hashString } from "./aiMetrics";

export interface DatasetSample {
  imageUrl: string;
  /** Canonical (display) label. */
  label: string;
  source: "label_queue" | "feedback";
}

export interface DatasetSplit {
  train: DatasetSample[];
  val: DatasetSample[];
  test: DatasetSample[];
}

export interface BuildDatasetResult {
  datasetId: number;
  totalSamples: number;
  labelDistribution: Record<string, number>;
  split: { train: number; val: number; test: number };
  storageKey: string;
  manifestPaths: { train: string; val: string; test: string };
  labels: string[];
  /** F3/D3 — sha256 lineage hash over sorted (imageUrl,label) sample ids (see computeContentHash). */
  contentHash: string;
}

/** Default seed — keep stable across machines for reproducible splits. */
export const DEFAULT_SPLIT_SEED = 1337;

/**
 * Collect deduped labeled samples for a model from both sources.
 * Exported for reuse by the eval harness (so eval uses the same data view).
 */
export async function collectDatasetSamples(
  modelId: number,
  options?: { since?: Date },
): Promise<DatasetSample[]> {
  const db = await getDb();
  if (!db) return [];

  const model = await getAiModelById(modelId);
  const modelCode = model?.code;

  // imageUrl → { label, source } — first writer wins (queue prioritized).
  const byUrl = new Map<string, DatasetSample>();

  // ── Source 1: ai_label_queue (LABELED / AUTO_LABELED) ──────────
  const queueConds = [
    eq(aiLabelQueue.modelId, modelId),
    inArray(aiLabelQueue.status, ["LABELED", "AUTO_LABELED"]),
  ];
  if (options?.since) queueConds.push(gte(aiLabelQueue.createdAt, options.since));

  const queueRows = await db.select({
    imageUrl: aiLabelQueue.imageUrl,
    humanLabel: aiLabelQueue.humanLabel,
    predictedLabel: aiLabelQueue.predictedLabel,
  })
    .from(aiLabelQueue)
    .where(and(...queueConds))
    .orderBy(desc(aiLabelQueue.createdAt));

  for (const row of queueRows) {
    if (!row.imageUrl) continue;
    const labelRaw = row.humanLabel ?? row.predictedLabel;
    const label = displayLabel(labelRaw);
    if (!label) continue;
    if (!byUrl.has(row.imageUrl)) {
      byUrl.set(row.imageUrl, { imageUrl: row.imageUrl, label, source: "label_queue" });
    }
  }

  // ── Source 2: ai_feedback ⋈ ai_suggestions ⋈ measurement_results ─
  if (modelCode) {
    const fbConds = [eq(aiSuggestions.modelName, modelCode)];
    if (options?.since) fbConds.push(gte(aiFeedback.feedbackAt, options.since));

    const fbRows = await db.select({
      imageUrl: measurementResults.imageUrl,
      correctedValue: aiFeedback.correctedValue,
    })
      .from(aiFeedback)
      .innerJoin(aiSuggestions, eq(aiFeedback.suggestionId, aiSuggestions.id))
      .innerJoin(measurementResults, eq(aiSuggestions.inspectionId, measurementResults.inspectionId))
      .where(and(...fbConds))
      .orderBy(desc(aiFeedback.feedbackAt));

    for (const row of fbRows) {
      if (!row.imageUrl || !row.correctedValue) continue;
      const label = displayLabel(row.correctedValue);
      if (!label) continue;
      if (!byUrl.has(row.imageUrl)) {
        byUrl.set(row.imageUrl, { imageUrl: row.imageUrl, label, source: "feedback" });
      }
    }
  }

  return Array.from(byUrl.values());
}

/**
 * Stratified split: split EACH class independently by the configured ratios,
 * so train/val/test all preserve the class distribution. Deterministic for a
 * given seed (the per-class shuffle seed is derived from the seed + class key).
 */
export function stratifiedSplit(
  samples: DatasetSample[],
  splitConfig: { train: number; validation: number; test: number },
  seed: number = DEFAULT_SPLIT_SEED,
): DatasetSplit {
  // Group by NORMALIZED label so casing variants don't fork a class.
  const byClass = new Map<string, DatasetSample[]>();
  for (const s of samples) {
    const key = normalizeLabel(s.label);
    if (!byClass.has(key)) byClass.set(key, []);
    byClass.get(key)!.push(s);
  }

  const train: DatasetSample[] = [];
  const val: DatasetSample[] = [];
  const test: DatasetSample[] = [];

  const total = Math.max(splitConfig.train + splitConfig.validation + splitConfig.test, 1e-9);
  const trainR = splitConfig.train / total;
  const valR = splitConfig.validation / total;

  // Sort class keys for deterministic iteration order.
  for (const key of Array.from(byClass.keys()).sort()) {
    const items = byClass.get(key)!;
    // Sort by imageUrl first for a stable base order, then seeded shuffle.
    const sorted = items.slice().sort((a, b) => (a.imageUrl < b.imageUrl ? -1 : a.imageUrl > b.imageUrl ? 1 : 0));
    const shuffled = seededShuffle(sorted, (seed ^ hashString(key)) >>> 0);

    const n = shuffled.length;
    const nTrain = Math.floor(n * trainR);
    const nVal = Math.floor(n * valR);
    // Remainder → test (keeps val/test non-empty when possible).
    train.push(...shuffled.slice(0, nTrain));
    val.push(...shuffled.slice(nTrain, nTrain + nVal));
    test.push(...shuffled.slice(nTrain + nVal));
  }

  return { train, val, test };
}

/** Where dataset manifests live. */
export function datasetDir(datasetId: number): string {
  return path.join(process.cwd(), "uploads", "datasets", String(datasetId));
}

function writeJsonl(filePath: string, samples: DatasetSample[]): void {
  const lines = samples.map(s => JSON.stringify({ imageUrl: s.imageUrl, label: s.label, source: s.source }));
  fs.writeFileSync(filePath, lines.join("\n") + (lines.length ? "\n" : ""), "utf-8");
}

/** Read a JSONL manifest back into samples (used by eval harness). */
export function readJsonl(filePath: string): DatasetSample[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8").trim();
  if (!content) return [];
  return content.split("\n").map(line => JSON.parse(line) as DatasetSample);
}

// ════════════════════════════════════════════════════════════════════════════
// F3/D3 — Dataset lineage content-hash (doc69 G10)
//
// Deterministic sha256 over the SORTED sample ids of a materialized dataset,
// so the exact data a model version was trained/evaluated on can be pinned
// (into `training_datasets.contentHash` — additive, migration 0301, NOT run —
// AND into `model_versions.evalReport.datasetContentHash`, an EXISTING JSON
// column, see aiEvalHarness.compareBeforeAfter). Sorted → order-independent
// (collection order / DB query order never changes the hash). Deterministic:
// same set of (imageUrl,label) pairs → identical hash; any addition, removal,
// or label edit → a different hash.
// ════════════════════════════════════════════════════════════════════════════

/** Deterministic sha256 (hex) over a SORTED list of sample ids. Pure, no I/O. */
export function computeContentHash(sampleIds: string[]): string {
  const sorted = sampleIds.slice().sort();
  const h = crypto.createHash("sha256");
  for (const id of sorted) h.update(id).update("\n");
  return h.digest("hex");
}

/** Content-hash of a classification dataset (imageUrl + label — editing a label changes the hash). */
export function hashDatasetSamples(samples: DatasetSample[]): string {
  return computeContentHash(samples.map((s) => `${s.imageUrl}::${s.label}`));
}

/** Content-hash of a segmentation dataset (imageUrl + sorted mask labels of that image). */
export function hashSegDatasetSamples(samples: SegSample[]): string {
  return computeContentHash(
    samples.map((s) => `${s.imageUrl}::${s.masks.map((m) => m.label).sort().join(",")}`),
  );
}

/**
 * Recompute a dataset's content-hash directly from its MATERIALIZED manifest
 * files on disk (train+val+test jsonl) — the source of truth. Used by the eval
 * harness to pin the exact dataset a model version was evaluated against
 * WITHOUT depending on a DB column (works whether or not migration 0301 has
 * run). Missing/empty manifests degrade to `readJsonl`'s `[]` → deterministic
 * hash of the empty set, never throws.
 */
export function computeDatasetManifestHash(datasetId: number): string {
  const dir = datasetDir(datasetId);
  const train = readJsonl(path.join(dir, "train.jsonl"));
  const val = readJsonl(path.join(dir, "val.jsonl"));
  const test = readJsonl(path.join(dir, "test.jsonl"));
  return hashDatasetSamples([...train, ...val, ...test]);
}

/**
 * Best-effort pin of a content-hash into `training_datasets.contentHash`
 * (additive column, migration 0301, NOT applied by this task — see brief).
 * Uses a raw, narrow UPDATE (not the typed pgTable) so it never touches the
 * columns `getTrainingDataset`/`getTrainingDatasets` already select — those
 * keep working byte-for-byte whether or not the column exists yet. Failure
 * (e.g. undefined_column before the migration runs) is caught + logged, NEVER
 * thrown — pinning is an audit nicety, not required for the dataset build to
 * succeed (the hash is always returned in the build result regardless).
 */
async function pinDatasetContentHash(datasetId: number, contentHash: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.execute(sql`UPDATE training_datasets SET "contentHash" = ${contentHash} WHERE id = ${datasetId}`);
  } catch (e) {
    console.warn(
      `[aiDatasetBuilder] contentHash column unavailable (migration 0301 pending?) — dataset ${datasetId} not pinned:`,
      (e as Error)?.message ?? e,
    );
  }
}

/**
 * Build (materialize) a dataset that was previously created in
 * `training_datasets`. Idempotent: re-running overwrites the manifests with the
 * same content for the same seed + data.
 */
export async function buildDataset(
  datasetId: number,
  opts?: { seed?: number },
): Promise<BuildDatasetResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const dataset = await dbAdvanced.getTrainingDataset(datasetId);
  if (!dataset) throw new Error(`Training dataset ${datasetId} not found`);
  if (dataset.modelId == null) throw new Error(`Dataset ${datasetId} has no modelId; cannot collect labeled data`);

  await db.update(trainingDatasets).set({ status: "PROCESSING", updatedAt: new Date() }).where(eq(trainingDatasets.id, datasetId));

  try {
    const seed = opts?.seed ?? DEFAULT_SPLIT_SEED;
    const splitConfig = dataset.splitConfig ?? { train: 0.8, validation: 0.15, test: 0.05 };

    const since = dataset.filterConfig?.dateRange?.from ? new Date(dataset.filterConfig.dateRange.from) : undefined;
    const samples = await collectDatasetSamples(dataset.modelId, { since });

    const split = stratifiedSplit(samples, splitConfig, seed);

    // Label distribution (display labels).
    const labelDistribution: Record<string, number> = {};
    for (const s of samples) labelDistribution[s.label] = (labelDistribution[s.label] ?? 0) + 1;
    const labels = Object.keys(labelDistribution).sort();

    // Write manifests.
    const dir = datasetDir(datasetId);
    fs.mkdirSync(dir, { recursive: true });
    const manifestPaths = {
      train: path.join(dir, "train.jsonl"),
      val: path.join(dir, "val.jsonl"),
      test: path.join(dir, "test.jsonl"),
    };
    writeJsonl(manifestPaths.train, split.train);
    writeJsonl(manifestPaths.val, split.val);
    writeJsonl(manifestPaths.test, split.test);

    const storageKey = `datasets/${datasetId}`;
    const totalSamples = samples.length;

    await db.update(trainingDatasets).set({
      storageKey,
      totalSamples,
      labelDistribution,
      status: "COMPLETED",
      updatedAt: new Date(),
    }).where(eq(trainingDatasets.id, datasetId));

    // F3/D3 — lineage hash over ALL samples (pre-split, matches the manifests
    // just written). Best-effort DB pin; the hash itself is always returned.
    const contentHash = hashDatasetSamples(samples);
    await pinDatasetContentHash(datasetId, contentHash);

    return {
      datasetId,
      totalSamples,
      labelDistribution,
      split: { train: split.train.length, val: split.val.length, test: split.test.length },
      storageKey,
      manifestPaths,
      labels,
      contentHash,
    };
  } catch (err) {
    await db.update(trainingDatasets).set({ status: "FAILED", updatedAt: new Date() }).where(eq(trainingDatasets.id, datasetId));
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// B8 — SEGMENTATION dataset builder
//
// Materializes a YOLOv8-seg training dataset from QC-drawn masks in
// `defect_segmentations` (source="human"). One manifest line per IMAGE, with all
// polygons of that image grouped under masks[]. Points are NORMALIZED 0..1
// (x/width, y/height) so the manifest is resolution-independent and maps 1:1 to
// the format `tools/trainer/train.py` (load_seg_manifest) expects:
//   {imageUrl, masks:[{label, points:[[x,y],...]}], source}
//
// Additive: does NOT touch the classification path above. Degrades truthfully —
// masks without valid width/height or with <3 points are skipped + logged, never
// fabricated.
// ════════════════════════════════════════════════════════════════════════════

/** One segmentation polygon (one defect instance), points normalized 0..1. */
export interface SegMask {
  label: string;
  /** Normalized polygon: [[x,y],...] with each coord in [0,1]. */
  points: Array<[number, number]>;
}

/** One manifest record = one image with all its QC polygons. */
export interface SegSample {
  imageUrl: string;
  masks: SegMask[];
  /** Provenance tag written into the manifest (matches train.py examples). */
  source: "qc_segmentation";
}

export interface SegDatasetSplit {
  train: SegSample[];
  val: SegSample[];
  test: SegSample[];
}

export interface BuildSegmentationResult {
  datasetId: number;
  /** Number of IMAGES (manifest lines), not polygons. */
  totalSamples: number;
  /** Per-class polygon counts across all images. */
  labelDistribution: Record<string, number>;
  /** Unique class labels in STABLE (sorted) order — class index = position. */
  classLabels: string[];
  split: { train: number; val: number; test: number };
  storageKey: string;
  manifestPaths: { train: string; val: string; test: string };
  /** Masks skipped for missing width/height or <3 points (degrade audit). */
  skipped: { noDimensions: number; tooFewPoints: number; emptyImages: number };
  /** F3/D3 — sha256 lineage hash over sorted (imageUrl,sorted-mask-labels) sample ids. */
  contentHash: string;
}

const SEG_SOURCE_TAG = "qc_segmentation" as const;

/**
 * Collect QC (human) segmentation masks grouped by image, with points
 * normalized 0..1. Pure aside from the DB read (which is mocked in tests).
 * Exported for reuse/testing.
 *
 * `rows` may be passed directly (tests / callers that already have the rows);
 * otherwise it reads source="human" masks for the dataset's filter.
 */
export function buildSegSamplesFromRows(
  rows: Array<{
    imageUrl: string | null;
    classLabel: string;
    maskData: { width?: number; height?: number; points?: Array<{ x: number; y: number }> } | null;
  }>,
): { samples: SegSample[]; labelDistribution: Record<string, number>; classLabels: string[]; skipped: BuildSegmentationResult["skipped"] } {
  const skipped = { noDimensions: 0, tooFewPoints: 0, emptyImages: 0 };
  const labelDistribution: Record<string, number> = {};

  // imageUrl → accumulated masks. Stable iteration: insertion order, then sorted
  // by imageUrl before splitting for full reproducibility.
  const byImage = new Map<string, SegMask[]>();

  for (const row of rows) {
    if (!row.imageUrl) continue;
    const md = row.maskData;
    const label = displayLabel(row.classLabel);
    if (!label) continue;

    const w = md?.width;
    const h = md?.height;
    if (!md || typeof w !== "number" || typeof h !== "number" || !(w > 0) || !(h > 0)) {
      skipped.noDimensions++;
      console.warn(`[buildSegmentationDataset] skip mask: missing/invalid maskData width/height for image ${row.imageUrl} (label=${label})`);
      continue;
    }
    const pts = md.points ?? [];
    if (pts.length < 3) {
      skipped.tooFewPoints++;
      console.warn(`[buildSegmentationDataset] skip polygon with <3 points for image ${row.imageUrl} (label=${label})`);
      continue;
    }

    // Normalize + clamp to [0,1].
    const norm: Array<[number, number]> = pts.map((p) => {
      const x = Math.min(1, Math.max(0, p.x / w));
      const y = Math.min(1, Math.max(0, p.y / h));
      return [x, y];
    });

    if (!byImage.has(row.imageUrl)) byImage.set(row.imageUrl, []);
    byImage.get(row.imageUrl)!.push({ label, points: norm });
    labelDistribution[label] = (labelDistribution[label] ?? 0) + 1;
  }

  const samples: SegSample[] = [];
  for (const [imageUrl, masks] of byImage) {
    if (masks.length === 0) {
      skipped.emptyImages++;
      console.warn(`[buildSegmentationDataset] skip image with no usable masks: ${imageUrl}`);
      continue;
    }
    samples.push({ imageUrl, masks, source: SEG_SOURCE_TAG });
  }

  const classLabels = Object.keys(labelDistribution).sort();
  return { samples, labelDistribution, classLabels, skipped };
}

/**
 * Split segmentation samples BY IMAGE (each image is atomic — all its polygons
 * stay together). Deterministic for a given seed. Stratified by the image's
 * dominant class (most-frequent label, ties broken by sorted label) so the class
 * mix is preserved across train/val/test as much as multi-label images allow.
 */
export function splitSegmentationByImage(
  samples: SegSample[],
  splitConfig: { train: number; validation: number; test: number },
  seed: number = DEFAULT_SPLIT_SEED,
): SegDatasetSplit {
  // Stratify key = dominant (most frequent, then sorted) label of the image.
  const keyOf = (s: SegSample): string => {
    const counts = new Map<string, number>();
    for (const m of s.masks) counts.set(m.label, (counts.get(m.label) ?? 0) + 1);
    let best = "";
    let bestN = -1;
    for (const k of Array.from(counts.keys()).sort()) {
      const n = counts.get(k)!;
      if (n > bestN) { bestN = n; best = k; }
    }
    return normalizeLabel(best);
  };

  const byClass = new Map<string, SegSample[]>();
  for (const s of samples) {
    const key = keyOf(s);
    if (!byClass.has(key)) byClass.set(key, []);
    byClass.get(key)!.push(s);
  }

  const train: SegSample[] = [];
  const val: SegSample[] = [];
  const test: SegSample[] = [];

  const total = Math.max(splitConfig.train + splitConfig.validation + splitConfig.test, 1e-9);
  const trainR = splitConfig.train / total;
  const valR = splitConfig.validation / total;

  for (const key of Array.from(byClass.keys()).sort()) {
    const items = byClass.get(key)!;
    const sorted = items.slice().sort((a, b) => (a.imageUrl < b.imageUrl ? -1 : a.imageUrl > b.imageUrl ? 1 : 0));
    const shuffled = seededShuffle(sorted, (seed ^ hashString(key)) >>> 0);
    const n = shuffled.length;
    const nTrain = Math.floor(n * trainR);
    const nVal = Math.floor(n * valR);
    train.push(...shuffled.slice(0, nTrain));
    val.push(...shuffled.slice(nTrain, nTrain + nVal));
    test.push(...shuffled.slice(nTrain + nVal));
  }

  return { train, val, test };
}

function writeSegJsonl(filePath: string, samples: SegSample[]): void {
  const lines = samples.map((s) =>
    JSON.stringify({ imageUrl: s.imageUrl, masks: s.masks.map((m) => ({ label: m.label, points: m.points })), source: s.source }),
  );
  fs.writeFileSync(filePath, lines.join("\n") + (lines.length ? "\n" : ""), "utf-8");
}

/**
 * Build (materialize) a SEGMENTATION dataset from QC-drawn masks. Mirrors
 * buildDataset's lifecycle (PROCESSING → COMPLETED/FAILED, manifest write,
 * trainingDatasets update) but writes the seg manifest format. Idempotent for a
 * given seed + data.
 *
 * sourceType is set to "segmentation" on the dataset row so downstream
 * (pipeline / job task selection) can distinguish it. classLabels are returned
 * (stable sorted order) — feed them as `classLabels` to the training pipeline so
 * the class index ordering matches the manifest.
 */
export async function buildSegmentationDataset(
  datasetId: number,
  opts?: { seed?: number },
): Promise<BuildSegmentationResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const dataset = await dbAdvanced.getTrainingDataset(datasetId);
  if (!dataset) throw new Error(`Training dataset ${datasetId} not found`);

  await db.update(trainingDatasets).set({ status: "PROCESSING", updatedAt: new Date() }).where(eq(trainingDatasets.id, datasetId));

  try {
    const seed = opts?.seed ?? DEFAULT_SPLIT_SEED;
    const splitConfig = dataset.splitConfig ?? { train: 0.8, validation: 0.15, test: 0.05 };

    // QC human masks only (model-generated masks are not ground truth).
    const rows = await listDefectSegmentations({ source: "human", limit: 100000 });
    const { samples, labelDistribution, classLabels, skipped } = buildSegSamplesFromRows(rows);

    const split = splitSegmentationByImage(samples, splitConfig, seed);

    const dir = datasetDir(datasetId);
    fs.mkdirSync(dir, { recursive: true });
    const manifestPaths = {
      train: path.join(dir, "train.jsonl"),
      val: path.join(dir, "val.jsonl"),
      test: path.join(dir, "test.jsonl"),
    };
    writeSegJsonl(manifestPaths.train, split.train);
    writeSegJsonl(manifestPaths.val, split.val);
    writeSegJsonl(manifestPaths.test, split.test);

    const storageKey = `datasets/${datasetId}`;
    const totalSamples = samples.length; // images

    await db.update(trainingDatasets).set({
      storageKey,
      totalSamples,
      labelDistribution,
      sourceType: "segmentation",
      status: "COMPLETED",
      updatedAt: new Date(),
    }).where(eq(trainingDatasets.id, datasetId));

    // F3/D3 — lineage hash over ALL images (pre-split, matches the manifests
    // just written). Best-effort DB pin; the hash itself is always returned.
    const contentHash = hashSegDatasetSamples(samples);
    await pinDatasetContentHash(datasetId, contentHash);

    return {
      datasetId,
      totalSamples,
      labelDistribution,
      classLabels,
      split: { train: split.train.length, val: split.val.length, test: split.test.length },
      storageKey,
      manifestPaths,
      skipped,
      contentHash,
    };
  } catch (err) {
    await db.update(trainingDatasets).set({ status: "FAILED", updatedAt: new Date() }).where(eq(trainingDatasets.id, datasetId));
    throw err;
  }
}
