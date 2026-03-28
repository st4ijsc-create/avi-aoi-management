import * as ort from "onnxruntime-node";
import sharp from "sharp";
import path from "path";
import fs from "fs";
import { getAiModelById } from "../db/ai";
import { createInferenceResult } from "../db/ai";
import type { AiModel } from "../../drizzle/schema";

// Cache loaded sessions to avoid re-loading the same model
const sessionCache = new Map<string, ort.InferenceSession>();

/**
 * Detect available ONNX execution providers based on environment and hardware.
 * Priority: TensorRT > CUDA > CPU
 */
function getExecutionProviders(): string[] {
  const providers: string[] = [];

  if (process.env.ENABLE_TENSORRT === "true") {
    providers.push("tensorrt");
  }
  if (process.env.ENABLE_CUDA === "true") {
    providers.push("cuda");
  }
  // CPU is always the fallback
  providers.push("cpu");
  return providers;
}

/** Log once which providers are configured */
let _providerLogged = false;
function logProviders(providers: string[]) {
  if (_providerLogged) return;
  _providerLogged = true;
  console.log(`[aiInferenceEngine] Execution providers: ${providers.join(" → ")}`);
}

/**
 * Get or create an ONNX inference session for a model
 */
async function getSession(model: AiModel): Promise<ort.InferenceSession> {
  const cacheKey = `${model.id}:${model.currentVersion}`;
  const cached = sessionCache.get(cacheKey);
  if (cached) return cached;

  if (!model.filePath) throw new Error(`Model ${model.code} has no file path`);

  // Resolve file path — handle both local paths and URLs
  let modelPath = model.filePath;
  if (modelPath.startsWith("/uploads/")) {
    const uploadsRoot = process.env.LOCAL_STORAGE_DIR
      ? path.resolve(process.env.LOCAL_STORAGE_DIR)
      : path.join(process.cwd(), "uploads");
    modelPath = path.join(uploadsRoot, modelPath.replace("/uploads/", ""));
  }

  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model file not found: ${modelPath}`);
  }

  const executionProviders = getExecutionProviders();
  logProviders(executionProviders);

  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders,
    graphOptimizationLevel: "all",
  });

  sessionCache.set(cacheKey, session);
  return session;
}

/**
 * Evict a model session from cache (e.g. when model is updated)
 */
export function evictSessionCache(modelId: number) {
  for (const [key] of sessionCache) {
    if (key.startsWith(`${modelId}:`)) {
      sessionCache.delete(key);
    }
  }
}

/**
 * Preprocess image buffer according to model config
 */
async function preprocessImage(
  imageBuffer: Buffer,
  config: NonNullable<AiModel["preprocessConfig"]>,
): Promise<Float32Array> {
  const width = config.resize?.width ?? 224;
  const height = config.resize?.height ?? 224;
  const channels = config.colorSpace === "GRAY" ? 1 : 3;

  let pipeline = sharp(imageBuffer).resize(width, height);
  if (config.colorSpace === "GRAY") {
    pipeline = pipeline.grayscale();
  }
  const raw = await pipeline.removeAlpha().raw().toBuffer();

  const mean = config.normalize?.mean ?? [0.485, 0.456, 0.406];
  const std = config.normalize?.std ?? [0.229, 0.224, 0.225];
  const channelFirst = config.channelFirst !== false; // default true

  const totalPixels = width * height;
  const tensor = new Float32Array(channels * totalPixels);

  for (let c = 0; c < channels; c++) {
    for (let i = 0; i < totalPixels; i++) {
      const rawIndex = i * channels + c;
      const pixelValue = raw[rawIndex] / 255.0;
      const normalized = (pixelValue - (mean[c] ?? 0)) / (std[c] ?? 1);

      if (channelFirst) {
        tensor[c * totalPixels + i] = normalized;
      } else {
        tensor[i * channels + c] = normalized;
      }
    }
  }

  return tensor;
}

/**
 * Run inference on an image using a specific model
 */
export async function runInference(
  modelId: number,
  imageBuffer: Buffer,
  options?: {
    inspectionId?: number;
    measurementResultId?: number;
    inputReference?: string;
  },
) {
  const startTime = Date.now();
  const model = await getAiModelById(modelId);
  if (!model) throw new Error(`Model ${modelId} not found`);
  if (model.status !== "ACTIVE") throw new Error(`Model ${model.code} is not active (status: ${model.status})`);

  try {
    const session = await getSession(model);

    // Preprocess
    const preprocessConfig = (model.preprocessConfig as AiModel["preprocessConfig"]) ?? {
      resize: { width: 224, height: 224 },
      colorSpace: "RGB" as const,
      channelFirst: true,
    };
    const tensorData = await preprocessImage(imageBuffer, preprocessConfig);

    // Build input shape  
    const inputShape = (model.inputShape as number[]) ?? [1, 3, preprocessConfig.resize?.height ?? 224, preprocessConfig.resize?.width ?? 224];
    const inputTensor = new ort.Tensor("float32", tensorData, inputShape);

    // Get input name from model
    const inputName = session.inputNames[0];
    if (!inputName) throw new Error("Model has no input names");

    const feeds: Record<string, ort.Tensor> = { [inputName]: inputTensor };
    const results = await session.run(feeds);

    // Get output
    const outputName = session.outputNames[0];
    if (!outputName) throw new Error("Model has no output names");
    const output = results[outputName];
    if (!output) throw new Error("No output from model");
    const outputData = output.data as Float32Array;

    // Parse predictions based on output type
    const labels = (model.labels as string[]) ?? [];
    const postprocess = (model.postprocessConfig as AiModel["postprocessConfig"]);
    const confidenceThreshold = postprocess?.confidenceThreshold ?? 0.1;
    const topK = postprocess?.topK ?? 5;
    const outputType: string = (postprocess as any)?.outputType ?? "classification";

    let predictions: Array<{ label: string; confidence: number; box?: { x: number; y: number; w: number; h: number } }>;

    if (outputType === "detection") {
      // YOLO-style detection: output shape [1, num_boxes, 5+num_classes]
      // Each row: [cx, cy, w, h, obj_conf, class_conf_0, ..., class_conf_n]
      predictions = parseDetectionOutput(outputData, output.dims as number[], labels, confidenceThreshold);
    } else {
      // Classification: apply softmax and return top-K
      const probabilities = softmax(outputData);
      const allPredictions = Array.from(probabilities).map((conf, idx) => ({
        label: labels[idx] ?? `class_${idx}`,
        confidence: Number(conf.toFixed(6)),
      }));
      allPredictions.sort((a, b) => b.confidence - a.confidence);
      predictions = allPredictions
        .filter(p => p.confidence >= confidenceThreshold)
        .slice(0, topK);
    }

    const topPrediction = predictions[0];
    const processingTimeMs = Date.now() - startTime;

    // Save result (fire-and-forget)
    createInferenceResult({
      modelId: model.id,
      modelVersion: model.currentVersion,
      inspectionId: options?.inspectionId,
      measurementResultId: options?.measurementResultId,
      inputType: "image",
      inputReference: options?.inputReference,
      predictions,
      confidence: topPrediction?.confidence?.toString(),
      topLabel: topPrediction?.label,
      processingTimeMs,
      status: "COMPLETED",
    }).catch(() => {});

    return {
      modelCode: model.code,
      modelVersion: model.currentVersion,
      predictions,
      topLabel: topPrediction?.label ?? null,
      confidence: topPrediction?.confidence ?? 0,
      processingTimeMs,
      status: "COMPLETED" as const,
    };
  } catch (err: unknown) {
    const processingTimeMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);

    createInferenceResult({
      modelId: model.id,
      modelVersion: model.currentVersion,
      inspectionId: options?.inspectionId,
      measurementResultId: options?.measurementResultId,
      inputType: "image",
      predictions: [],
      status: "FAILED",
      errorMessage,
      processingTimeMs,
    }).catch(() => {});

    throw err;
  }
}

/**
 * Parse YOLO-style detection output into bounding boxes with labels.
 * Expected tensor shape: [batch, num_boxes, 5+num_classes]
 * Each box row: [cx, cy, w, h, objectness, class_conf_0, ..., class_conf_n]
 * Coordinates are normalised [0, 1] relative to image size.
 */
function parseDetectionOutput(
  data: Float32Array,
  dims: number[],
  labels: string[],
  threshold: number,
): Array<{ label: string; confidence: number; box: { x: number; y: number; w: number; h: number } }> {
  // Support [batch, boxes, attrs] or flattened [boxes, attrs]
  let numBoxes: number;
  let numAttrs: number;
  if (dims.length === 3) {
    numBoxes = dims[1];
    numAttrs = dims[2];
  } else if (dims.length === 2) {
    numBoxes = dims[0];
    numAttrs = dims[1];
  } else {
    return [];
  }

  const numClasses = Math.max(0, numAttrs - 5);
  const candidates: Array<{ label: string; confidence: number; box: { x: number; y: number; w: number; h: number } }> = [];

  for (let b = 0; b < numBoxes; b++) {
    const offset = b * numAttrs;
    const cx   = data[offset];
    const cy   = data[offset + 1];
    const w    = data[offset + 2];
    const h    = data[offset + 3];
    const objConf = data[offset + 4];

    if (objConf < threshold) continue;

    let bestClass = 0;
    let bestConf  = 0;
    if (numClasses > 0) {
      for (let c = 0; c < numClasses; c++) {
        const conf = objConf * data[offset + 5 + c];
        if (conf > bestConf) { bestConf = conf; bestClass = c; }
      }
    } else {
      bestConf = objConf;
    }

    if (bestConf < threshold) continue;

    candidates.push({
      label: labels[bestClass] ?? `class_${bestClass}`,
      confidence: Number(bestConf.toFixed(6)),
      box: {
        x: Number((cx - w / 2).toFixed(4)),
        y: Number((cy - h / 2).toFixed(4)),
        w: Number(w.toFixed(4)),
        h: Number(h.toFixed(4)),
      },
    });
  }

  // Non-Maximum Suppression (IoU threshold 0.45)
  return applyNMS(candidates, 0.45);
}

function iou(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const ax2 = a.x + a.w, ay2 = a.y + a.h;
  const bx2 = b.x + b.w, by2 = b.y + b.h;
  const interX = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const interY = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter  = interX * interY;
  const union  = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

function applyNMS<T extends { confidence: number; box: { x: number; y: number; w: number; h: number } }>(
  boxes: T[],
  iouThreshold: number,
): T[] {
  boxes.sort((a, b) => b.confidence - a.confidence);
  const kept: T[] = [];
  const suppressed = new Set<number>();
  for (let i = 0; i < boxes.length; i++) {
    if (suppressed.has(i)) continue;
    kept.push(boxes[i]);
    for (let j = i + 1; j < boxes.length; j++) {
      if (!suppressed.has(j) && iou(boxes[i].box, boxes[j].box) > iouThreshold) {
        suppressed.add(j);
      }
    }
  }
  return kept;
}

/**
 * Softmax normalization
 */
function softmax(data: Float32Array): Float32Array {
  const maxVal = Math.max(...data);
  const expValues = data.map(v => Math.exp(v - maxVal));
  const sumExp = expValues.reduce((a, b) => a + b, 0);
  return expValues.map(v => v / sumExp) as Float32Array;
}

/**
 * Get cached model info for health check
 */
export function getLoadedModels(): string[] {
  return Array.from(sessionCache.keys());
}
