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
import { getDb } from "../db/connection";
import { getAiModelById } from "../db/ai";
import * as dbAdvanced from "../db/aiAdvanced";
import { eq, and, inArray, gte, desc } from "drizzle-orm";
import {
  aiLabelQueue,
  aiFeedback,
  aiSuggestions,
  measurementResults,
  trainingDatasets,
} from "../../drizzle/schema";
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

    return {
      datasetId,
      totalSamples,
      labelDistribution,
      split: { train: split.train.length, val: split.val.length, test: split.test.length },
      storageKey,
      manifestPaths,
      labels,
    };
  } catch (err) {
    await db.update(trainingDatasets).set({ status: "FAILED", updatedAt: new Date() }).where(eq(trainingDatasets.id, datasetId));
    throw err;
  }
}
