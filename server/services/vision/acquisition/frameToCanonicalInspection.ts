/**
 * frameToCanonicalInspection — bridge a grabbed Frame into the SAME canonical inspection
 * shape the vision adapters produce (visionAdapterRegistry.CanonicalInspection), so an
 * acquired image flows into the exact SAME downstream path (submitInspection persistence,
 * image upload, embed-at-ingest) as a vendor result payload.
 *
 * ── HONESTY: acquisition ≠ judgement ────────────────────────────────────────
 * A raw frame carries pixels, not a verdict. So the canonical inspection built from a bare
 * frame defaults `overallResult` to "NTF" (needs inspection) — it is NOT claimed OK/NG. A
 * caller that has ALSO run the frame through an actual inspection algorithm passes the real
 * verdict + per-point measurements via `ctx.overallResult` / `ctx.measurements`.
 *
 * ── EMBEDDING ───────────────────────────────────────────────────────────────
 * `frameImageBuffer(frame)` returns the exact Buffer that aiImageEmbedding.extractEmbedding
 * consumes, and `embedFrame()` is a thin, honest-degrading convenience: it resolves the
 * DINOv2 model + calls extractEmbedding, returning null (never fabricated vectors) when no
 * model/DB is available. The heavy embedding module is imported LAZILY so this file adds no
 * onnxruntime load at import time; tests inject `embed` directly.
 */
import {
  type CanonicalInspection,
  type CanonicalMeasurement,
  type CanonicalResult,
} from "../visionAdapterRegistry";
import {
  type Frame,
  isEncodedImageFormat,
  mimeForPixelFormat,
} from "./imageSource";
import type { EmbeddingResult } from "../../aiImageEmbedding";

export interface FrameInspectionContext {
  /** Machine identity to stamp onto the inspection (one of machineCode / apiKey is required downstream). */
  machineCode?: string;
  apiKey?: string;
  /** Board/part serial. Defaults to `<sourceId>-<frameId>` when the acquisition has no barcode. */
  serialNumber?: string;
  productModel?: string;
  batchNumber?: string;
  /** Overall verdict IF the caller inspected the frame. Default "NTF" (uninspected capture). */
  overallResult?: CanonicalResult;
  /** Point code for the whole-frame capture point. Default "FRAME". */
  pointCode?: string;
  /**
   * Real per-point measurements when the caller has inspected the frame. When provided these
   * REPLACE the single synthetic whole-frame point (and drive the derived overall if
   * overallResult is omitted).
   */
  measurements?: CanonicalMeasurement[];
  /** Attach the frame as a renderable data-URL on the capture point. Default true. */
  encodeImage?: boolean;
}

/** The raw bytes of a frame — exactly what extractEmbedding(modelId, buffer) expects. */
export function frameImageBuffer(frame: Frame): Buffer {
  return frame.data;
}

/**
 * Wrap a frame's bytes into a data-URL, but ONLY when it is an encoded image (jpeg/png/…).
 * Raw sensor formats (Mono8/BayerRG8/RGB8) are NOT renderable as-is, so this returns
 * undefined for them (honest — no fake image); encode them with a real codec first.
 */
export function frameToDataUrl(frame: Frame): string | undefined {
  const mime = mimeForPixelFormat(frame.metadata.pixelFormat);
  if (!mime) return undefined;
  return `data:${mime};base64,${frame.data.toString("base64")}`;
}

function deriveOverall(measurements: CanonicalMeasurement[]): CanonicalResult {
  if (measurements.some((m) => m.result === "NG")) return "NG";
  if (measurements.some((m) => m.result === "NTF")) return "NTF";
  return "OK";
}

/** Build a canonical inspection from an acquired frame (+ optional inspection context). */
export function frameToCanonicalInspection(
  frame: Frame,
  ctx: FrameInspectionContext = {},
): CanonicalInspection {
  const meta = frame.metadata;

  const serialNumber =
    (ctx.serialNumber ?? "").toString().trim() || `${meta.sourceId}-${meta.frameId}`;

  let measurements: CanonicalMeasurement[];
  if (ctx.measurements && ctx.measurements.length > 0) {
    measurements = ctx.measurements;
  } else {
    // No inspection yet: one synthetic whole-frame capture point (result mirrors overall).
    const result: CanonicalResult = ctx.overallResult ?? "NTF";
    const point: CanonicalMeasurement = {
      pointCode: ctx.pointCode ?? "FRAME",
      result,
      remark: `Acquired frame #${meta.frameId} from ${meta.sourceId} (${meta.triggerMode})${
        result === "NTF" ? " — not yet inspected" : ""
      }`,
    };
    const encode = ctx.encodeImage ?? true;
    if (encode && isEncodedImageFormat(meta.pixelFormat)) {
      const url = frameToDataUrl(frame);
      if (url) point.imageBase64 = url;
    }
    measurements = [point];
  }

  const overallResult: CanonicalResult = ctx.overallResult ?? deriveOverall(measurements);

  return {
    machineCode: ctx.machineCode,
    apiKey: ctx.apiKey,
    serialNumber,
    productModel: ctx.productModel,
    batchNumber: ctx.batchNumber,
    overallResult,
    inspectionTime: meta.timestamp,
    measurements,
  };
}

export interface EmbedFrameOptions {
  /** ONNX model code to resolve (default AOI_EMBEDDING_MODEL_CODE / "dinov2-small"). */
  modelCode?: string;
  /**
   * Injectable embedder (for tests / custom pipelines). When provided it is used verbatim
   * with the frame's image buffer. When omitted, a lazy default resolves the DINOv2 model +
   * calls extractEmbedding, degrading to null if no model/DB is available.
   */
  embed?: (buffer: Buffer) => Promise<EmbeddingResult | null>;
}

/**
 * Embed a frame's image (honest-degrading). Returns the embedding, or null when no ONNX
 * model / DB is available — it NEVER fabricates a vector. The default path imports the
 * embedding stack lazily so this module stays light for callers that only convert frames.
 */
export async function embedFrame(
  frame: Frame,
  opts: EmbedFrameOptions = {},
): Promise<EmbeddingResult | null> {
  const buffer = frameImageBuffer(frame);
  if (opts.embed) return opts.embed(buffer);

  const modelCode =
    opts.modelCode ?? process.env.AOI_EMBEDDING_MODEL_CODE ?? "dinov2-small";
  try {
    const { getAiModelByCode } = await import("../../../db/ai");
    const model = await getAiModelByCode(modelCode);
    if (!model || model.status !== "ACTIVE") return null; // honest degradation: no active model
    const { extractEmbedding } = await import("../../aiImageEmbedding");
    return await extractEmbedding(model.id, buffer);
  } catch {
    return null; // DB/model/onnx unavailable → no fabricated embedding
  }
}
