/**
 * AI Local Training Service — Phase 4.2
 *
 * Built-in lightweight training without external service dependency.
 * Capabilities:
 *  1. Transfer Learning — fine-tune final layer of pretrained ONNX model
 *  2. Few-shot Learning — Siamese / prototypical approach with limited samples
 *  3. Incremental Learning — add new data without full retraining
 */

import * as ort from "onnxruntime-node";
import { appError } from "../_core/appError";
import sharp from "sharp";
import path from "path";
import fs from "fs";
import { getDb } from "../db/connection";
import { getAiModelById } from "../db/ai";
import * as dbAdvanced from "../db/aiAdvanced";
import { sql, eq, and, gte, desc, count, inArray } from "drizzle-orm";
import {
  aiLabelQueue,
  aiFeedback,
  aiSuggestions,
  measurementResults,
} from "../../drizzle/schema";
import {
  softmax,
  argmax,
  buildConfusionMatrix,
  computeMetrics,
  normalizeLabel,
} from "./aiMetrics";

// ─── Types ─────────────────────────────────────────────────────

export type TrainingStrategy = "transfer" | "fewshot" | "incremental";

export interface LocalTrainingRequest {
  modelId: number;
  strategy: TrainingStrategy;
  targetVersion: string;
  /** Class labels for classification */
  classLabels: string[];
  /** Training configuration overrides */
  config?: {
    epochs?: number;
    learningRate?: number;
    batchSize?: number;
    earlyStopping?: boolean;
    patience?: number;
    validationSplit?: number;
    /** For few-shot: samples per class */
    samplesPerClass?: number;
    /** For incremental: only train on data since this date */
    incrementalSince?: Date;
  };
  createdBy?: number;
}

export interface TrainingProgress {
  jobId: number;
  epoch: number;
  totalEpochs: number;
  loss: number;
  accuracy: number;
  valLoss: number;
  valAccuracy: number;
  phase: string;
}

export interface LocalTrainingResult {
  jobId: number;
  success: boolean;
  outputModelPath?: string;
  finalMetrics?: {
    accuracy: number;
    precision: number;
    recall: number;
    f1Score: number;
    confusionMatrix: number[][];
  };
  trainingSamples: number;
  validationSamples: number;
  durationMs: number;
  error?: string;
}

// ─── Feature Embeddings Cache ──────────────────────────────────
const embeddingCache = new Map<string, Float32Array>();

// ─── Transfer Learning ─────────────────────────────────────────

/**
 * Run transfer learning: extract features from pretrained model, train a
 * lightweight classifier on top (logistic regression / softmax).
 *
 * We extract feature embeddings from the penultimate layer of the ONNX model
 * and train a final classification layer using gradient-free optimization
 * (no onnxruntime-training needed).
 */
export async function runTransferLearning(request: LocalTrainingRequest): Promise<LocalTrainingResult> {
  const startTime = Date.now();
  const config = {
    epochs: request.config?.epochs ?? 30,
    learningRate: request.config?.learningRate ?? 0.01,
    batchSize: request.config?.batchSize ?? 32,
    validationSplit: request.config?.validationSplit ?? 0.2,
    patience: request.config?.patience ?? 5,
    earlyStopping: request.config?.earlyStopping ?? true,
  };

  // Create training job in DB
  const job = await dbAdvanced.createTrainingJob({
    name: `Transfer-${request.modelId}-${request.targetVersion}`,
    modelId: request.modelId,
    targetVersion: request.targetVersion,
    datasetConfig: { strategy: "transfer", classLabels: request.classLabels } as any,
    trainingConfig: config,
    totalEpochs: config.epochs,
    createdBy: request.createdBy,
  });

  try {
    await dbAdvanced.updateTrainingJob(job.id, { status: "PREPARING_DATA", startedAt: new Date(), progress: 5 });

    // 1. Load base model and extract feature extractor
    const model = await getAiModelById(request.modelId);
    if (!model) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "aiModel" }, `Model ${request.modelId} not found`);
    if (!model.filePath) throw new Error(`Model ${model.code} has no file path`);

    const session = await ort.InferenceSession.create(
      resolveModelPath(model.filePath),
      { executionProviders: ["cpu"] }
    );

    // 2. Collect labeled data from feedback / annotations
    const { trainData, valData } = await collectLabeledData(
      request.modelId,
      request.classLabels,
      config.validationSplit
    );

    if (trainData.length < request.classLabels.length * 2) {
      throw new Error(`Insufficient training data: ${trainData.length} samples for ${request.classLabels.length} classes. Need at least ${request.classLabels.length * 2}.`);
    }

    await dbAdvanced.updateTrainingJob(job.id, {
      status: "PREPARING_DATA",
      progress: 20,
      trainingDataCount: trainData.length,
      validationDataCount: valData.length,
    });

    // 3. Extract feature embeddings
    await dbAdvanced.updateTrainingJob(job.id, { status: "TRAINING", progress: 25 });

    const trainEmbeddings = await extractEmbeddings(session, trainData.map(d => d.imagePath));
    const valEmbeddings = valData.length > 0
      ? await extractEmbeddings(session, valData.map(d => d.imagePath))
      : [];

    await dbAdvanced.updateTrainingJob(job.id, { progress: 40 });

    // 4. Train softmax classifier on embeddings
    const numFeatures = trainEmbeddings[0]?.length ?? 512;
    const numClasses = request.classLabels.length;

    // Initialize weights (Xavier init)
    const weights = new Float32Array(numFeatures * numClasses);
    const biases = new Float32Array(numClasses);
    const scale = Math.sqrt(2.0 / (numFeatures + numClasses));
    for (let i = 0; i < weights.length; i++) {
      weights[i] = (Math.random() - 0.5) * 2 * scale;
    }

    const trainLabels = trainData.map(d => request.classLabels.indexOf(d.label));
    const valLabels = valData.map(d => request.classLabels.indexOf(d.label));

    let bestValAccuracy = 0;
    let bestWeights = new Float32Array(weights);
    let bestBiases = new Float32Array(biases);
    let noImproveCount = 0;

    const metricsHistory = { loss: [] as number[], accuracy: [] as number[], valLoss: [] as number[], valAccuracy: [] as number[] };

    for (let epoch = 1; epoch <= config.epochs; epoch++) {
      // Mini-batch SGD
      const indices = shuffleIndices(trainEmbeddings.length);
      let epochLoss = 0;
      let correct = 0;

      for (let b = 0; b < indices.length; b += config.batchSize) {
        const batchIdx = indices.slice(b, b + config.batchSize);
        const gradW = new Float32Array(weights.length);
        const gradB = new Float32Array(numClasses);

        for (const idx of batchIdx) {
          const embedding = trainEmbeddings[idx]!;
          const label = trainLabels[idx]!;

          // Forward: logits = embedding * weights + biases
          const logits = new Float32Array(numClasses);
          for (let c = 0; c < numClasses; c++) {
            let sum = biases[c]!;
            for (let f = 0; f < numFeatures; f++) {
              sum += embedding[f]! * weights[f * numClasses + c]!;
            }
            logits[c] = sum;
          }

          // Softmax
          const probs = softmax(logits);
          epochLoss += -Math.log(Math.max(probs[label]!, 1e-10));
          if (argmax(probs) === label) correct++;

          // Backward: gradient of cross-entropy w.r.t logits
          for (let c = 0; c < numClasses; c++) {
            const grad = probs[c]! - (c === label ? 1 : 0);
            gradB[c] += grad;
            for (let f = 0; f < numFeatures; f++) {
              gradW[f * numClasses + c] += embedding[f]! * grad;
            }
          }
        }

        // Update weights
        const batchScale = config.learningRate / batchIdx.length;
        for (let i = 0; i < weights.length; i++) {
          weights[i] -= gradW[i]! * batchScale;
        }
        for (let i = 0; i < biases.length; i++) {
          biases[i] -= gradB[i]! * batchScale;
        }
      }

      epochLoss /= trainEmbeddings.length;
      const epochAcc = correct / trainEmbeddings.length;

      // Validation
      let valLoss = 0;
      let valCorrect = 0;
      for (let i = 0; i < valEmbeddings.length; i++) {
        const embedding = valEmbeddings[i]!;
        const label = valLabels[i]!;
        const logits = new Float32Array(numClasses);
        for (let c = 0; c < numClasses; c++) {
          let sum = biases[c]!;
          for (let f = 0; f < numFeatures; f++) {
            sum += embedding[f]! * weights[f * numClasses + c]!;
          }
          logits[c] = sum;
        }
        const probs = softmax(logits);
        valLoss += -Math.log(Math.max(probs[label]!, 1e-10));
        if (argmax(probs) === label) valCorrect++;
      }
      valLoss = valEmbeddings.length > 0 ? valLoss / valEmbeddings.length : 0;
      const valAcc = valEmbeddings.length > 0 ? valCorrect / valEmbeddings.length : 0;

      metricsHistory.loss.push(Number(epochLoss.toFixed(4)));
      metricsHistory.accuracy.push(Number(epochAcc.toFixed(4)));
      metricsHistory.valLoss.push(Number(valLoss.toFixed(4)));
      metricsHistory.valAccuracy.push(Number(valAcc.toFixed(4)));

      if (valAcc > bestValAccuracy) {
        bestValAccuracy = valAcc;
        bestWeights = new Float32Array(weights);
        bestBiases = new Float32Array(biases);
        noImproveCount = 0;
      } else {
        noImproveCount++;
      }

      const progress = 40 + Math.round((epoch / config.epochs) * 45);
      await dbAdvanced.updateTrainingJob(job.id, {
        currentEpoch: epoch,
        progress,
        trainingMetrics: metricsHistory,
        bestMetrics: {
          epoch: metricsHistory.valAccuracy.indexOf(bestValAccuracy) + 1,
          accuracy: bestValAccuracy,
          loss: metricsHistory.loss[metricsHistory.valAccuracy.indexOf(bestValAccuracy)] ?? 0,
          valAccuracy: bestValAccuracy,
          valLoss: metricsHistory.valLoss[metricsHistory.valAccuracy.indexOf(bestValAccuracy)] ?? 0,
        },
      });

      if (config.earlyStopping && noImproveCount >= config.patience) {
        break;
      }
    }

    // 5. Save classifier weights
    await dbAdvanced.updateTrainingJob(job.id, { status: "VALIDATING", progress: 90 });

    const classifierData = {
      type: "softmax_classifier",
      numFeatures,
      numClasses,
      classLabels: request.classLabels,
      weights: Array.from(bestWeights),
      biases: Array.from(bestBiases),
      baseModelId: request.modelId,
      baseModelVersion: model.currentVersion,
    };

    const outputDir = path.join(process.cwd(), "uploads", "models", "trained");
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `classifier_${job.id}_${request.targetVersion}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(classifierData, null, 2));

    // 6. Compute final validation metrics
    const confusionMatrix = computeConfusionMatrix(
      valEmbeddings, valLabels, bestWeights, bestBiases, numFeatures, numClasses
    );
    const { precision, recall, f1Score } = computePRF1(confusionMatrix, numClasses);

    const validationMetrics = {
      accuracy: bestValAccuracy,
      precision,
      recall,
      f1Score,
    };

    await dbAdvanced.updateTrainingJob(job.id, {
      status: "COMPLETED",
      progress: 100,
      completedAt: new Date(),
      outputModelPath: `/uploads/models/trained/classifier_${job.id}_${request.targetVersion}.json`,
      validationMetrics,
    });

    session.release();

    return {
      jobId: job.id,
      success: true,
      outputModelPath: outputPath,
      finalMetrics: { accuracy: bestValAccuracy, precision, recall, f1Score, confusionMatrix },
      trainingSamples: trainData.length,
      validationSamples: valData.length,
      durationMs: Date.now() - startTime,
    };
  } catch (err: unknown) {
    await dbAdvanced.updateTrainingJob(job.id, {
      status: "FAILED",
      errorMessage: err instanceof Error ? err.message : String(err),
      completedAt: new Date(),
    });
    return {
      jobId: job.id,
      success: false,
      trainingSamples: 0,
      validationSamples: 0,
      durationMs: Date.now() - startTime,
      // data-raw-ok: kết quả một lượt HUẤN LUYỆN cục bộ. Người đọc là kỹ sư AI đang chỉnh
      // bộ dữ liệu/siêu tham số — chuỗi gốc của bộ huấn luyện là thứ chỉ ra sai ở bước nào.
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Few-Shot Learning ─────────────────────────────────────────

/**
 * Few-shot learning using prototypical networks approach.
 * Computes class prototypes from a small support set and classifies
 * query images by nearest prototype in embedding space.
 */
export async function runFewShotLearning(request: LocalTrainingRequest): Promise<LocalTrainingResult> {
  const startTime = Date.now();
  const samplesPerClass = request.config?.samplesPerClass ?? 5;

  const job = await dbAdvanced.createTrainingJob({
    name: `FewShot-${request.modelId}-${request.targetVersion}`,
    modelId: request.modelId,
    targetVersion: request.targetVersion,
    datasetConfig: { strategy: "fewshot", classLabels: request.classLabels, samplesPerClass } as any,
    trainingConfig: { samplesPerClass },
    totalEpochs: 1,
    createdBy: request.createdBy,
  });

  try {
    await dbAdvanced.updateTrainingJob(job.id, { status: "PREPARING_DATA", startedAt: new Date(), progress: 10 });

    const model = await getAiModelById(request.modelId);
    if (!model?.filePath) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "aiModel" }, `Model ${request.modelId} not found or has no file path`);

    const session = await ort.InferenceSession.create(
      resolveModelPath(model.filePath),
      { executionProviders: ["cpu"] }
    );

    // Collect support set: N samples per class
    const { trainData: supportSet, valData: querySet } = await collectLabeledData(
      request.modelId,
      request.classLabels,
      0.3, // 30% for query/evaluation
      samplesPerClass
    );

    await dbAdvanced.updateTrainingJob(job.id, {
      progress: 30,
      trainingDataCount: supportSet.length,
      validationDataCount: querySet.length,
    });

    // Extract embeddings for support and query sets
    await dbAdvanced.updateTrainingJob(job.id, { status: "TRAINING", progress: 40 });

    const supportEmbeddings = await extractEmbeddings(session, supportSet.map(d => d.imagePath));
    const queryEmbeddings = querySet.length > 0
      ? await extractEmbeddings(session, querySet.map(d => d.imagePath))
      : [];

    await dbAdvanced.updateTrainingJob(job.id, { progress: 60 });

    // Compute class prototypes (mean embedding per class)
    const numFeatures = supportEmbeddings[0]?.length ?? 512;
    const prototypes: Record<string, Float32Array> = {};
    const classCounts: Record<string, number> = {};

    for (let i = 0; i < supportSet.length; i++) {
      const label = supportSet[i]!.label;
      if (!prototypes[label]) {
        prototypes[label] = new Float32Array(numFeatures);
        classCounts[label] = 0;
      }
      classCounts[label]!++;
      const emb = supportEmbeddings[i]!;
      for (let f = 0; f < numFeatures; f++) {
        prototypes[label]![f] += emb[f]!;
      }
    }
    // Average
    for (const label of Object.keys(prototypes)) {
      const cnt = classCounts[label]!;
      for (let f = 0; f < numFeatures; f++) {
        prototypes[label]![f] /= cnt;
      }
    }

    await dbAdvanced.updateTrainingJob(job.id, { status: "VALIDATING", progress: 80 });

    // Evaluate on query set
    let correct = 0;
    const predictions: number[] = [];
    const queryLabels = querySet.map(d => request.classLabels.indexOf(d.label));
    const numClasses = request.classLabels.length;

    for (let i = 0; i < queryEmbeddings.length; i++) {
      const emb = queryEmbeddings[i]!;
      let bestDist = Infinity;
      let bestLabel = 0;

      for (let c = 0; c < numClasses; c++) {
        const proto = prototypes[request.classLabels[c]!];
        if (!proto) continue;
        let dist = 0;
        for (let f = 0; f < numFeatures; f++) {
          const diff = emb[f]! - proto[f]!;
          dist += diff * diff;
        }
        if (dist < bestDist) {
          bestDist = dist;
          bestLabel = c;
        }
      }
      predictions.push(bestLabel);
      if (bestLabel === queryLabels[i]) correct++;
    }

    const accuracy = queryEmbeddings.length > 0 ? correct / queryEmbeddings.length : 0;

    // Save prototypes as the model
    const protoData = {
      type: "prototypical_network",
      numFeatures,
      numClasses,
      classLabels: request.classLabels,
      prototypes: Object.fromEntries(
        Object.entries(prototypes).map(([k, v]) => [k, Array.from(v)])
      ),
      baseModelId: request.modelId,
      baseModelVersion: model.currentVersion,
    };

    const outputDir = path.join(process.cwd(), "uploads", "models", "trained");
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `fewshot_${job.id}_${request.targetVersion}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(protoData, null, 2));

    const confusionMatrix = buildConfusionFromPredictions(predictions, queryLabels, numClasses);
    const { precision, recall, f1Score } = computePRF1(confusionMatrix, numClasses);

    await dbAdvanced.updateTrainingJob(job.id, {
      status: "COMPLETED",
      progress: 100,
      completedAt: new Date(),
      currentEpoch: 1,
      outputModelPath: `/uploads/models/trained/fewshot_${job.id}_${request.targetVersion}.json`,
      validationMetrics: { accuracy, precision, recall, f1Score },
      bestMetrics: { epoch: 1, accuracy, loss: 0, valAccuracy: accuracy, valLoss: 0 },
    });

    session.release();

    return {
      jobId: job.id,
      success: true,
      outputModelPath: outputPath,
      finalMetrics: { accuracy, precision, recall, f1Score, confusionMatrix },
      trainingSamples: supportSet.length,
      validationSamples: querySet.length,
      durationMs: Date.now() - startTime,
    };
  } catch (err: unknown) {
    await dbAdvanced.updateTrainingJob(job.id, {
      status: "FAILED",
      errorMessage: err instanceof Error ? err.message : String(err),
      completedAt: new Date(),
    });
    return {
      jobId: job.id, success: false, trainingSamples: 0, validationSamples: 0,
      // data-raw-ok: như trên — kết quả lượt huấn luyện.
      durationMs: Date.now() - startTime, error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Incremental Learning ──────────────────────────────────────

/**
 * Incremental learning: load existing classifier weights and continue training
 * on only the new data (since a given date). Uses elastic weight consolidation
 * inspired approach to mitigate catastrophic forgetting.
 */
export async function runIncrementalLearning(request: LocalTrainingRequest): Promise<LocalTrainingResult> {
  const startTime = Date.now();
  const since = request.config?.incrementalSince ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const config = {
    epochs: request.config?.epochs ?? 10,
    learningRate: (request.config?.learningRate ?? 0.01) * 0.1, // Lower LR for incremental
    batchSize: request.config?.batchSize ?? 16,
    validationSplit: request.config?.validationSplit ?? 0.2,
  };

  const job = await dbAdvanced.createTrainingJob({
    name: `Incremental-${request.modelId}-${request.targetVersion}`,
    modelId: request.modelId,
    targetVersion: request.targetVersion,
    datasetConfig: { strategy: "incremental", classLabels: request.classLabels, since: since.toISOString() } as any,
    trainingConfig: config,
    totalEpochs: config.epochs,
    createdBy: request.createdBy,
  });

  try {
    await dbAdvanced.updateTrainingJob(job.id, { status: "PREPARING_DATA", startedAt: new Date(), progress: 5 });

    const model = await getAiModelById(request.modelId);
    if (!model?.filePath) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "aiModel" }, `Model ${request.modelId} not found or has no file path`);

    // Try to load existing classifier
    const existingClassifier = await loadExistingClassifier(request.modelId);

    const session = await ort.InferenceSession.create(
      resolveModelPath(model.filePath),
      { executionProviders: ["cpu"] }
    );

    // Collect only NEW labeled data (since the cutoff date)
    const { trainData, valData } = await collectLabeledData(
      request.modelId,
      request.classLabels,
      config.validationSplit,
      undefined,
      since
    );

    if (trainData.length < 5) {
      throw new Error(`Insufficient new data since ${since.toISOString()}: only ${trainData.length} samples.`);
    }

    await dbAdvanced.updateTrainingJob(job.id, {
      progress: 20,
      trainingDataCount: trainData.length,
      validationDataCount: valData.length,
    });

    // Extract embeddings
    await dbAdvanced.updateTrainingJob(job.id, { status: "TRAINING", progress: 30 });

    const trainEmbeddings = await extractEmbeddings(session, trainData.map(d => d.imagePath));
    const valEmbeddings = valData.length > 0
      ? await extractEmbeddings(session, valData.map(d => d.imagePath))
      : [];

    const numFeatures = trainEmbeddings[0]?.length ?? 512;
    const numClasses = request.classLabels.length;

    // Initialize from existing or random
    const weights = existingClassifier && existingClassifier.numFeatures === numFeatures
      ? new Float32Array(existingClassifier.weights)
      : (() => {
          const w = new Float32Array(numFeatures * numClasses);
          const s = Math.sqrt(2.0 / (numFeatures + numClasses));
          for (let i = 0; i < w.length; i++) w[i] = (Math.random() - 0.5) * 2 * s;
          return w;
        })();
    const biases = existingClassifier && existingClassifier.numFeatures === numFeatures
      ? new Float32Array(existingClassifier.biases)
      : new Float32Array(numClasses);

    // Store old weights for EWC penalty
    const oldWeights = new Float32Array(weights);
    const ewcLambda = 0.5; // Regularization strength

    const trainLabels = trainData.map(d => request.classLabels.indexOf(d.label));
    const valLabels = valData.map(d => request.classLabels.indexOf(d.label));

    let bestValAcc = 0;
    let bestWeights = new Float32Array(weights);
    let bestBiases = new Float32Array(biases);
    const metricsHistory = { loss: [] as number[], accuracy: [] as number[], valLoss: [] as number[], valAccuracy: [] as number[] };

    for (let epoch = 1; epoch <= config.epochs; epoch++) {
      const indices = shuffleIndices(trainEmbeddings.length);
      let epochLoss = 0;
      let correct = 0;

      for (let b = 0; b < indices.length; b += config.batchSize) {
        const batchIdx = indices.slice(b, b + config.batchSize);
        const gradW = new Float32Array(weights.length);
        const gradB = new Float32Array(numClasses);

        for (const idx of batchIdx) {
          const embedding = trainEmbeddings[idx]!;
          const label = trainLabels[idx]!;

          const logits = new Float32Array(numClasses);
          for (let c = 0; c < numClasses; c++) {
            let sum = biases[c]!;
            for (let f = 0; f < numFeatures; f++) {
              sum += embedding[f]! * weights[f * numClasses + c]!;
            }
            logits[c] = sum;
          }

          const probs = softmax(logits);
          epochLoss += -Math.log(Math.max(probs[label]!, 1e-10));
          if (argmax(probs) === label) correct++;

          for (let c = 0; c < numClasses; c++) {
            const grad = probs[c]! - (c === label ? 1 : 0);
            gradB[c] += grad;
            for (let f = 0; f < numFeatures; f++) {
              gradW[f * numClasses + c] += embedding[f]! * grad;
            }
          }
        }

        // Update with EWC regularization
        const batchScale = config.learningRate / batchIdx.length;
        for (let i = 0; i < weights.length; i++) {
          const ewcGrad = ewcLambda * (weights[i]! - oldWeights[i]!);
          weights[i] -= (gradW[i]! + ewcGrad) * batchScale;
        }
        for (let i = 0; i < biases.length; i++) {
          biases[i] -= gradB[i]! * batchScale;
        }
      }

      epochLoss /= trainEmbeddings.length;
      const epochAcc = correct / trainEmbeddings.length;

      // Validation
      let valLoss = 0;
      let valCorrect = 0;
      for (let i = 0; i < valEmbeddings.length; i++) {
        const emb = valEmbeddings[i]!;
        const label = valLabels[i]!;
        const logits = new Float32Array(numClasses);
        for (let c = 0; c < numClasses; c++) {
          let sum = biases[c]!;
          for (let f = 0; f < numFeatures; f++) {
            sum += emb[f]! * weights[f * numClasses + c]!;
          }
          logits[c] = sum;
        }
        const probs = softmax(logits);
        valLoss += -Math.log(Math.max(probs[label]!, 1e-10));
        if (argmax(probs) === label) valCorrect++;
      }
      valLoss = valEmbeddings.length > 0 ? valLoss / valEmbeddings.length : 0;
      const valAcc = valEmbeddings.length > 0 ? valCorrect / valEmbeddings.length : 0;

      metricsHistory.loss.push(Number(epochLoss.toFixed(4)));
      metricsHistory.accuracy.push(Number(epochAcc.toFixed(4)));
      metricsHistory.valLoss.push(Number(valLoss.toFixed(4)));
      metricsHistory.valAccuracy.push(Number(valAcc.toFixed(4)));

      if (valAcc > bestValAcc) {
        bestValAcc = valAcc;
        bestWeights = new Float32Array(weights);
        bestBiases = new Float32Array(biases);
      }

      const progress = 30 + Math.round((epoch / config.epochs) * 55);
      await dbAdvanced.updateTrainingJob(job.id, {
        currentEpoch: epoch,
        progress,
        trainingMetrics: metricsHistory,
      });
    }

    // Save
    await dbAdvanced.updateTrainingJob(job.id, { status: "VALIDATING", progress: 90 });

    const classifierData = {
      type: "softmax_classifier",
      incremental: true,
      numFeatures,
      numClasses,
      classLabels: request.classLabels,
      weights: Array.from(bestWeights),
      biases: Array.from(bestBiases),
      baseModelId: request.modelId,
      baseModelVersion: model.currentVersion,
      trainedAt: new Date().toISOString(),
      incrementalSince: since.toISOString(),
    };

    const outputDir = path.join(process.cwd(), "uploads", "models", "trained");
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `incremental_${job.id}_${request.targetVersion}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(classifierData, null, 2));

    const valPredictions: number[] = [];
    for (let i = 0; i < valEmbeddings.length; i++) {
      const emb = valEmbeddings[i]!;
      const logits = new Float32Array(numClasses);
      for (let c = 0; c < numClasses; c++) {
        let sum = bestBiases[c]!;
        for (let f = 0; f < numFeatures; f++) {
          sum += emb[f]! * bestWeights[f * numClasses + c]!;
        }
        logits[c] = sum;
      }
      valPredictions.push(argmax(softmax(logits)));
    }

    const confusionMatrix = buildConfusionFromPredictions(valPredictions, valLabels, numClasses);
    const { precision, recall, f1Score } = computePRF1(confusionMatrix, numClasses);

    await dbAdvanced.updateTrainingJob(job.id, {
      status: "COMPLETED",
      progress: 100,
      completedAt: new Date(),
      outputModelPath: `/uploads/models/trained/incremental_${job.id}_${request.targetVersion}.json`,
      validationMetrics: { accuracy: bestValAcc, precision, recall, f1Score },
      bestMetrics: {
        epoch: metricsHistory.valAccuracy.indexOf(bestValAcc) + 1,
        accuracy: bestValAcc, loss: 0, valAccuracy: bestValAcc, valLoss: 0,
      },
    });

    session.release();

    return {
      jobId: job.id,
      success: true,
      outputModelPath: outputPath,
      finalMetrics: { accuracy: bestValAcc, precision, recall, f1Score, confusionMatrix },
      trainingSamples: trainData.length,
      validationSamples: valData.length,
      durationMs: Date.now() - startTime,
    };
  } catch (err: unknown) {
    await dbAdvanced.updateTrainingJob(job.id, {
      status: "FAILED",
      errorMessage: err instanceof Error ? err.message : String(err),
      completedAt: new Date(),
    });
    return {
      jobId: job.id, success: false, trainingSamples: 0, validationSamples: 0,
      // data-raw-ok: như trên — kết quả lượt huấn luyện.
      durationMs: Date.now() - startTime, error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Unified Entry Point ───────────────────────────────────────

/**
 * Start a local training job using the specified strategy.
 */
export async function startLocalTraining(request: LocalTrainingRequest): Promise<LocalTrainingResult> {
  switch (request.strategy) {
    case "transfer":
      return runTransferLearning(request);
    case "fewshot":
      return runFewShotLearning(request);
    case "incremental":
      return runIncrementalLearning(request);
    default:
      throw new Error(`Unknown training strategy: ${request.strategy}`);
  }
}

/**
 * Get capabilities / info about local training for a given model.
 */
export async function getTrainingCapabilities(modelId: number) {
  const model = await getAiModelById(modelId);
  if (!model) return null;

  // Check data availability
  const db = await getDb();
  if (!db) return null;

  // Real label availability comes from the human-labeled queue for THIS model
  // (ai_label_queue.modelId), not the global ai_feedback table (which has no
  // modelId column). LABELED + AUTO_LABELED rows are usable training samples.
  const labeledCount = await db.select({ cnt: count() })
    .from(aiLabelQueue)
    .where(and(
      eq(aiLabelQueue.modelId, modelId),
      inArray(aiLabelQueue.status, ["LABELED", "AUTO_LABELED"]),
    ));

  const totalFeedback = labeledCount[0]?.cnt ?? 0;

  // Check for existing trained classifiers
  const outputDir = path.join(process.cwd(), "uploads", "models", "trained");
  let existingClassifiers: string[] = [];
  if (fs.existsSync(outputDir)) {
    existingClassifiers = fs.readdirSync(outputDir)
      .filter(f => f.includes(`_${modelId}_`) || f.endsWith(".json"));
  }

  return {
    modelId,
    modelCode: model.code,
    modelVersion: model.currentVersion,
    hasONNXModel: !!model.filePath,
    strategies: {
      transfer: {
        available: !!model.filePath && totalFeedback >= 20,
        minSamples: 20,
        currentSamples: totalFeedback,
        description: "Fine-tune final classification layer on production data",
      },
      fewshot: {
        available: !!model.filePath && totalFeedback >= 5,
        minSamples: 5,
        currentSamples: totalFeedback,
        description: "Learn from 5-10 samples per class using prototypical networks",
      },
      incremental: {
        available: !!model.filePath && existingClassifiers.length > 0 && totalFeedback > 0,
        hasExistingClassifier: existingClassifiers.length > 0,
        currentSamples: totalFeedback,
        description: "Continue training on new data without full retraining",
      },
    },
    existingClassifiers: existingClassifiers.length,
  };
}

/**
 * Predict using a locally trained classifier (transfer/fewshot/incremental).
 */
export async function predictWithLocalClassifier(
  modelId: number,
  classifierPath: string,
  imagePath: string,
): Promise<{ label: string; confidence: number; allProbabilities: Record<string, number> } | null> {
  if (!fs.existsSync(classifierPath)) return null;

  const classifierData = JSON.parse(fs.readFileSync(classifierPath, "utf-8"));

  const model = await getAiModelById(modelId);
  if (!model?.filePath) return null;

  const session = await ort.InferenceSession.create(
    resolveModelPath(model.filePath),
    { executionProviders: ["cpu"] }
  );

  const [embedding] = await extractEmbeddings(session, [imagePath]);
  if (!embedding) {
    session.release();
    return null;
  }

  let result: { label: string; confidence: number; allProbabilities: Record<string, number> };

  if (classifierData.type === "prototypical_network") {
    // Few-shot: nearest prototype
    const classLabels: string[] = classifierData.classLabels;
    const prototypes: Record<string, number[]> = classifierData.prototypes;
    let bestDist = Infinity;
    let bestLabel = classLabels[0]!;
    const distances: Record<string, number> = {};

    for (const label of classLabels) {
      const proto = prototypes[label];
      if (!proto) continue;
      let dist = 0;
      for (let f = 0; f < embedding.length; f++) {
        const diff = embedding[f]! - proto[f]!;
        dist += diff * diff;
      }
      distances[label] = dist;
      if (dist < bestDist) {
        bestDist = dist;
        bestLabel = label;
      }
    }

    // Convert distances to probabilities via softmax of negative distances
    const negDists = classLabels.map(l => -(distances[l] ?? 0));
    const probs = softmax(new Float32Array(negDists));
    const allProbabilities: Record<string, number> = {};
    for (let i = 0; i < classLabels.length; i++) {
      allProbabilities[classLabels[i]!] = Number(probs[i]!.toFixed(4));
    }

    result = { label: bestLabel, confidence: allProbabilities[bestLabel] ?? 0, allProbabilities };
  } else {
    // Softmax classifier (transfer / incremental)
    const w = new Float32Array(classifierData.weights);
    const b = new Float32Array(classifierData.biases);
    const numClasses = classifierData.numClasses;
    const numFeatures = classifierData.numFeatures;
    const classLabels: string[] = classifierData.classLabels;

    const logits = new Float32Array(numClasses);
    for (let c = 0; c < numClasses; c++) {
      let sum = b[c]!;
      for (let f = 0; f < numFeatures; f++) {
        sum += embedding[f]! * w[f * numClasses + c]!;
      }
      logits[c] = sum;
    }
    const probs = softmax(logits);
    const bestIdx = argmax(probs);

    const allProbabilities: Record<string, number> = {};
    for (let i = 0; i < classLabels.length; i++) {
      allProbabilities[classLabels[i]!] = Number(probs[i]!.toFixed(4));
    }

    result = { label: classLabels[bestIdx]!, confidence: probs[bestIdx]!, allProbabilities };
  }

  session.release();
  return result;
}

// ─── Helper Functions ──────────────────────────────────────────

function resolveModelPath(filePath: string): string {
  if (filePath.startsWith("/uploads/")) {
    return path.join(process.cwd(), filePath);
  }
  if (path.isAbsolute(filePath)) return filePath;
  return path.join(process.cwd(), filePath);
}

async function extractEmbeddings(session: ort.InferenceSession, imagePaths: string[]): Promise<Float32Array[]> {
  const embeddings: Float32Array[] = [];

  for (const imgPath of imagePaths) {
    const cacheKey = imgPath;
    const cached = embeddingCache.get(cacheKey);
    if (cached) {
      embeddings.push(cached);
      continue;
    }

    const resolvedPath = resolveModelPath(imgPath);
    if (!fs.existsSync(resolvedPath)) {
      // Generate a zero embedding for missing images
      embeddings.push(new Float32Array(512));
      continue;
    }

    try {
      // Preprocess image to 224x224x3 normalized
      const imgBuffer = await sharp(resolvedPath)
        .resize(224, 224)
        .toFormat("png")
        .removeAlpha()
        .raw()
        .toBuffer();

      const floatData = new Float32Array(3 * 224 * 224);
      // HWC → CHW with normalization
      for (let c = 0; c < 3; c++) {
        for (let h = 0; h < 224; h++) {
          for (let w = 0; w < 224; w++) {
            const srcIdx = (h * 224 + w) * 3 + c;
            const dstIdx = c * 224 * 224 + h * 224 + w;
            floatData[dstIdx] = (imgBuffer[srcIdx]! / 255.0 - 0.485) / 0.229;
          }
        }
      }

      const inputTensor = new ort.Tensor("float32", floatData, [1, 3, 224, 224]);
      const inputName = session.inputNames[0]!;
      const feeds: Record<string, ort.Tensor> = { [inputName]: inputTensor };
      const results = await session.run(feeds);

      // Use the last output (typically the feature vector before classification)
      const outputNames = session.outputNames;
      const featureOutput = outputNames.length > 1
        ? results[outputNames[outputNames.length - 2]!]
        : results[outputNames[0]!];

      if (featureOutput) {
        const data = featureOutput.data as Float32Array;
        embeddingCache.set(cacheKey, data);
        embeddings.push(data);
      } else {
        embeddings.push(new Float32Array(512));
      }
    } catch {
      embeddings.push(new Float32Array(512));
    }
  }

  return embeddings;
}

interface LabeledSample {
  imagePath: string;
  label: string;
}

/**
 * Collect REAL labeled samples for a model from the two canonical sources:
 *
 *  Source 1 — ai_label_queue (status LABELED/AUTO_LABELED): imageUrl +
 *    humanLabel (preferred) or predictedLabel, filtered by modelId.
 *  Source 2 — ai_feedback ⋈ ai_suggestions (suggestionId → inspectionId,
 *    modelName, correctedValue). The image is taken from
 *    measurement_results.imageUrl (NOT product_inspections.imagePath which does
 *    not exist). Filtered to suggestions whose modelName matches this model's code.
 *
 * Labels are normalized (trim + NFC + lowercase) so "xước" and " Xước " collapse.
 * Samples are deduped by image url. classLabels are matched on the normalized form.
 */
async function collectLabeledData(
  modelId: number,
  classLabels: string[],
  validationSplit: number,
  maxPerClass?: number,
  since?: Date,
): Promise<{ trainData: LabeledSample[]; valData: LabeledSample[] }> {
  const db = await getDb();
  if (!db) return { trainData: [], valData: [] };

  const model = await getAiModelById(modelId);
  const modelCode = model?.code;

  // Map requested labels by their normalized key for matching.
  const labelByNorm = new Map<string, string>();
  for (const l of classLabels) labelByNorm.set(normalizeLabel(l), l);

  const byUrl = new Map<string, string>(); // imageUrl → canonical label (first wins)

  // ── Source 1: ai_label_queue ────────────────────────────────
  const queueConds = [
    eq(aiLabelQueue.modelId, modelId),
    inArray(aiLabelQueue.status, ["LABELED", "AUTO_LABELED"]),
  ];
  if (since) queueConds.push(gte(aiLabelQueue.createdAt, since));

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
    const canonical = labelByNorm.get(normalizeLabel(row.humanLabel ?? row.predictedLabel));
    if (!canonical) continue;
    if (!byUrl.has(row.imageUrl)) byUrl.set(row.imageUrl, canonical);
  }

  // ── Source 2: ai_feedback ⋈ ai_suggestions ⋈ measurement_results ─
  if (modelCode) {
    const fbConds = [eq(aiSuggestions.modelName, modelCode)];
    if (since) fbConds.push(gte(aiFeedback.feedbackAt, since));

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
      const canonical = labelByNorm.get(normalizeLabel(row.correctedValue));
      if (!canonical) continue;
      if (!byUrl.has(row.imageUrl)) byUrl.set(row.imageUrl, canonical);
    }
  }

  // Apply maxPerClass cap.
  const allSamples: LabeledSample[] = [];
  const perClassCount: Record<string, number> = {};
  for (const [imageUrl, label] of byUrl) {
    perClassCount[label] = (perClassCount[label] ?? 0) + 1;
    if (maxPerClass && perClassCount[label]! > maxPerClass) continue;
    allSamples.push({ imagePath: imageUrl, label });
  }

  // Deterministic shuffle (seeded by modelId) for reproducibility.
  const shuffled = seededShuffleLocal(allSamples, modelId);
  const splitIdx = Math.floor(shuffled.length * (1 - validationSplit));

  return {
    trainData: shuffled.slice(0, splitIdx),
    valData: shuffled.slice(splitIdx),
  };
}

function seededShuffleLocal<T>(items: T[], seed: number): T[] {
  const arr = items.slice();
  let a = (seed >>> 0) || 1;
  const rand = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

async function loadExistingClassifier(modelId: number): Promise<{
  numFeatures: number;
  numClasses: number;
  weights: number[];
  biases: number[];
} | null> {
  const outputDir = path.join(process.cwd(), "uploads", "models", "trained");
  if (!fs.existsSync(outputDir)) return null;

  // Find most recent classifier for this model
  const files = fs.readdirSync(outputDir)
    .filter(f => f.endsWith(".json"))
    .sort()
    .reverse();

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(outputDir, file), "utf-8"));
      if (data.baseModelId === modelId && data.weights && data.biases) {
        return {
          numFeatures: data.numFeatures,
          numClasses: data.numClasses,
          weights: data.weights,
          biases: data.biases,
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

// softmax / argmax are imported from ./aiMetrics (shared with eval harness).

function shuffleIndices(length: number): number[] {
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
  }
  return indices;
}

function computeConfusionMatrix(
  embeddings: Float32Array[],
  labels: number[],
  weights: Float32Array,
  biases: Float32Array,
  numFeatures: number,
  numClasses: number,
): number[][] {
  const matrix = Array.from({ length: numClasses }, () => new Array(numClasses).fill(0) as number[]);
  for (let i = 0; i < embeddings.length; i++) {
    const emb = embeddings[i]!;
    const logits = new Float32Array(numClasses);
    for (let c = 0; c < numClasses; c++) {
      let sum = biases[c]!;
      for (let f = 0; f < numFeatures; f++) {
        sum += emb[f]! * weights[f * numClasses + c]!;
      }
      logits[c] = sum;
    }
    const pred = argmax(softmax(logits));
    matrix[labels[i]!]![pred]++;
  }
  return matrix;
}

function buildConfusionFromPredictions(predictions: number[], labels: number[], numClasses: number): number[][] {
  // matrix[actual][predicted] — delegated to shared helper.
  return buildConfusionMatrix(predictions, labels, numClasses);
}

function computePRF1(confusionMatrix: number[][], _numClasses: number): {
  precision: number;
  recall: number;
  f1Score: number;
} {
  // Reuse shared macro-averaged metrics (single source of truth).
  const m = computeMetrics(confusionMatrix);
  return { precision: m.precision, recall: m.recall, f1Score: m.f1Score };
}
