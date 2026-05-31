/**
 * B5 — XAI heatmap THẬT (thay pixel-diff), 3 tầng degrade, đặt tên method ĐÚNG sự thật.
 *
 * onnxruntime-node KHÔNG có gradient → Grad-CAM "thật" BẤT KHẢ THI. Vì vậy:
 *   Tầng 1 (degraded:false): model expose feature map → CAM (nếu có trọng số lớp cuối)
 *           hoặc Score-CAM (KHÔNG cần gradient, chỉ forward lại) → method "score-cam"/"cam".
 *   Tầng 2 (approximate:true): classifier không feature map → occlusion sensitivity
 *           (che ô lưới sharp, đo sụt confidence) → method "occlusion". Vẫn là XAI thật của model.
 *   Tầng 3 (degraded:true): không model → pixel-diff cũ (cần reference) → method "pixel-diff".
 *
 * KHÔNG quảng cáo Grad-CAM. method/cờ phản ánh đúng thuật toán đã chạy.
 * Offline-first, backward-compatible (không đụng runInference/generateDefectHeatmap).
 */

import sharp from "sharp";
import {
  runInference,
  runInferenceWithFeatureMap,
  softmaxArray,
  type FeatureMapTensor,
} from "./aiInferenceEngine";

export type ExplainMethod = "score-cam" | "cam" | "occlusion" | "pixel-diff";

export interface ExplainResult {
  method: ExplainMethod;
  /** true chỉ khi tầng 3 (pixel-diff) — không phải XAI thật của model. */
  degraded: boolean;
  /** true khi occlusion (xấp xỉ, không phải CAM gradient/feature). */
  approximate: boolean;
  /** PNG overlay heatmap (base64-able buffer). */
  heatmapPng: Buffer;
  width: number;
  height: number;
  /** Nhãn dự đoán hàng đầu (nếu có model). */
  topLabel: string | null;
  topConfidence: number | null;
  /** Lớp được giải thích (index). */
  targetClass: number | null;
  notes: string[];
}

export interface ExplainParams {
  modelId?: number;
  imageBuffer: Buffer;
  /** Tên/index lớp muốn giải thích. Nếu undefined → dùng top-1. */
  targetClass?: number;
  /** Tầng 3 pixel-diff cần ảnh reference (golden OK). */
  referenceBuffer?: Buffer;
  /** Giới hạn top-K channel cho Score-CAM (chống nghẽn). Default 16. */
  scoreCamTopK?: number;
  /** Lưới occlusion (số ô mỗi cạnh). Default 8. */
  occlusionGrid?: number;
  /** Kích thước heatmap nội bộ (downscale chống nghẽn). Default 224. */
  heatmapSize?: number;
}

// ─── Colorize: value [0,1] → RGBA (jet-ish: xanh→đỏ), reuse pattern aiAdvancedVision ─

/** Map cường độ chuẩn hoá [0,1] → màu heatmap (R tăng theo intensity). */
function colorizeToRgba(norm: Float32Array, w: number, h: number): Buffer {
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(1, norm[i]));
    // jet-ish: thấp = xanh dương, trung = xanh lá, cao = đỏ
    let r = 0, g = 0, b = 0;
    if (v < 0.5) {
      const t = v / 0.5;
      b = Math.round(255 * (1 - t));
      g = Math.round(255 * t);
    } else {
      const t = (v - 0.5) / 0.5;
      g = Math.round(255 * (1 - t));
      r = Math.round(255 * t);
    }
    rgba[i * 4 + 0] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = Math.round(80 + 150 * v); // alpha tăng theo intensity
  }
  return rgba;
}

/** Render heatmap (norm w×h) → PNG overlay lên ảnh gốc (resize về cùng size). */
async function renderHeatmapPng(
  original: Buffer,
  norm: Float32Array,
  w: number,
  h: number,
): Promise<Buffer> {
  const rgba = colorizeToRgba(norm, w, h);
  const overlay = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();
  // Composite lên ảnh gốc resize về w×h.
  const base = await sharp(original).resize(w, h, { fit: "fill" }).removeAlpha().png().toBuffer();
  return sharp(base).composite([{ input: overlay, blend: "over" }]).png().toBuffer();
}

/** Min-max normalize → [0,1]. Mảng phẳng độ dài len. */
function minMaxNormalize(arr: Float32Array): Float32Array {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] < min) min = arr[i];
    if (arr[i] > max) max = arr[i];
  }
  const range = max - min;
  const out = new Float32Array(arr.length);
  if (range < 1e-9) return out; // phẳng → 0
  for (let i = 0; i < arr.length; i++) out[i] = (arr[i] - min) / range;
  return out;
}

// ─── Feature-map helpers (export cho test) ────────────────────────────────────

/** Tách feature map NCHW phẳng → mảng channel [C] mỗfi channel là Float32Array(H*W). */
export function splitChannels(fm: FeatureMapTensor): { channels: Float32Array[]; fh: number; fw: number } {
  // dims [N,C,H,W] (giả định N=1) hoặc [C,H,W].
  let C: number, H: number, W: number, base = 0;
  if (fm.dims.length === 4) {
    C = fm.dims[1]; H = fm.dims[2]; W = fm.dims[3];
  } else if (fm.dims.length === 3) {
    C = fm.dims[0]; H = fm.dims[1]; W = fm.dims[2];
  } else {
    return { channels: [], fh: 0, fw: 0 };
  }
  const plane = H * W;
  const channels: Float32Array[] = [];
  for (let c = 0; c < C; c++) {
    const ch = new Float32Array(plane);
    for (let i = 0; i < plane; i++) ch[i] = fm.data[base + c * plane + i];
    channels.push(ch);
  }
  return { channels, fh: H, fw: W };
}

/**
 * CAM: tổ hợp tuyến tính các channel feature map theo weights[c] (trọng số lớp cuối cho
 * targetClass). Trả map (H*W) đã ReLU + min-max normalize.
 */
export function computeCAM(channels: Float32Array[], weights: number[], plane: number): Float32Array {
  const cam = new Float32Array(plane);
  const C = Math.min(channels.length, weights.length);
  for (let c = 0; c < C; c++) {
    const w = weights[c];
    const ch = channels[c];
    for (let i = 0; i < plane; i++) cam[i] += w * ch[i];
  }
  // ReLU
  for (let i = 0; i < plane; i++) if (cam[i] < 0) cam[i] = 0;
  return minMaxNormalize(cam);
}

/**
 * Score-CAM weights (KHÔNG cần gradient): với mỗi channel (đã normalize → mask),
 * forward lại ảnh*mask, weight = confidence của targetClass. Trả map normalize.
 *
 * `forwardScore(maskedFeatureNorm)` được inject để test mock (tránh chạy ONNX thật).
 */
export async function computeScoreCAM(
  channels: Float32Array[],
  plane: number,
  topK: number,
  forwardScore: (channelIdx: number, maskNorm: Float32Array) => Promise<number>,
): Promise<{ map: Float32Array; weights: number[] }> {
  // Chọn top-K channel theo activation tổng (chống nghẽn).
  const energy = channels.map((ch, idx) => {
    let s = 0; for (let i = 0; i < ch.length; i++) s += ch[i];
    return { idx, s };
  });
  energy.sort((a, b) => b.s - a.s);
  const pick = energy.slice(0, Math.min(topK, channels.length)).map((e) => e.idx);

  const weights = new Array(channels.length).fill(0);
  const cam = new Float32Array(plane);
  for (const c of pick) {
    const maskNorm = minMaxNormalize(channels[c]);
    const score = await forwardScore(c, maskNorm);
    weights[c] = score;
    for (let i = 0; i < plane; i++) cam[i] += score * maskNorm[i];
  }
  for (let i = 0; i < plane; i++) if (cam[i] < 0) cam[i] = 0;
  return { map: minMaxNormalize(cam), weights };
}

/**
 * Occlusion sensitivity: che từng ô lưới grid×grid, đo SỤT confidence của targetLabel.
 * `scoreFn(occludedBuffer)` trả confidence (0..1). Trả map (grid*grid) normalize +
 * scale lên heatmapSize (caller).
 *
 * `baselineConfidence` = confidence ảnh gốc (không che). drop = base - occluded (dương = vùng quan trọng).
 */
export function occlusionMapFromDrops(drops: number[], grid: number): Float32Array {
  const f = new Float32Array(grid * grid);
  for (let i = 0; i < drops.length && i < f.length; i++) f[i] = Math.max(0, drops[i]);
  return minMaxNormalize(f);
}

/** Upscale map nhỏ (gh×gw) → (H×W) nearest-neighbour (thuần JS). */
export function upscaleNearest(small: Float32Array, gw: number, gh: number, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(gh - 1, Math.floor((y / H) * gh));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(gw - 1, Math.floor((x / W) * gw));
      out[y * W + x] = small[sy * gw + sx];
    }
  }
  return out;
}

// ─── Main entry: 3-tier resolve ───────────────────────────────────────────────

export async function explain(params: ExplainParams): Promise<ExplainResult> {
  const heatmapSize = params.heatmapSize ?? 224;
  const notes: string[] = [];

  // ── Không có model → Tầng 3: pixel-diff (degraded) ──
  if (params.modelId == null) {
    return pixelDiffExplain(params, heatmapSize, notes);
  }

  let fm: Awaited<ReturnType<typeof runInferenceWithFeatureMap>>;
  try {
    fm = await runInferenceWithFeatureMap(params.modelId, params.imageBuffer);
  } catch (e) {
    notes.push(`feature-map inference failed: ${(e as Error).message}; degrade to pixel-diff`);
    return pixelDiffExplain(params, heatmapSize, notes);
  }

  const probs = softmaxArray(fm.logits);
  let targetClass = params.targetClass;
  if (targetClass == null || targetClass < 0 || targetClass >= probs.length) {
    targetClass = probs.reduce((best, p, i) => (p > probs[best] ? i : best), 0);
  }
  const topConfidence = probs[targetClass] ?? null;
  const topLabel = fm.labels[targetClass] ?? `class_${targetClass}`;

  // ── Tầng 1: có feature map → Score-CAM (không cần gradient) ──
  if (fm.featureMap) {
    const { channels, fh, fw } = splitChannels(fm.featureMap);
    if (channels.length > 0) {
      const plane = fh * fw;
      const topK = params.scoreCamTopK ?? 16;

      // forwardScore: che ảnh gốc bằng mask channel (upscale → multiply) → forward lại,
      // weight = confidence targetClass. KHÔNG cần gradient (thuần forward).
      const forwardScore = async (_c: number, maskNorm: Float32Array): Promise<number> => {
        const masked = await applyMaskToImage(params.imageBuffer, maskNorm, fw, fh, heatmapSize);
        try {
          const r = await runInference(params.modelId!, masked);
          // map theo label nếu khớp, else dùng confidence top.
          if (r.topLabel === topLabel) return r.confidence;
          const hit = r.predictions.find((p) => p.label === topLabel);
          return hit?.confidence ?? 0;
        } catch {
          return 0;
        }
      };

      const { map } = await computeScoreCAM(channels, plane, topK, forwardScore);
      const up = upscaleNearest(map, fw, fh, heatmapSize, heatmapSize);
      const heatmapPng = await renderHeatmapPng(params.imageBuffer, up, heatmapSize, heatmapSize);
      notes.push(`score-cam over top-${Math.min(topK, channels.length)} channels (${fw}×${fh})`);
      return {
        method: "score-cam",
        degraded: false,
        approximate: false,
        heatmapPng,
        width: heatmapSize,
        height: heatmapSize,
        topLabel,
        topConfidence,
        targetClass,
        notes,
      };
    }
  }

  // ── Tầng 2: không feature map → occlusion sensitivity (approximate) ──
  return occlusionExplain(params, fm.labels, targetClass, topLabel, topConfidence, heatmapSize, notes);
}

/** Áp mask (gw×gh, [0,1]) lên ảnh: nhân pixel theo mask đã upscale → buffer PNG. */
async function applyMaskToImage(
  image: Buffer,
  maskNorm: Float32Array,
  gw: number,
  gh: number,
  size: number,
): Promise<Buffer> {
  const up = upscaleNearest(maskNorm, gw, gh, size, size);
  const base = await sharp(image).resize(size, size, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const out = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    const m = up[i];
    out[i * 3 + 0] = Math.round(base[i * 3 + 0] * m);
    out[i * 3 + 1] = Math.round(base[i * 3 + 1] * m);
    out[i * 3 + 2] = Math.round(base[i * 3 + 2] * m);
  }
  return sharp(out, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

/** Tầng 2 — occlusion sensitivity. */
async function occlusionExplain(
  params: ExplainParams,
  _labels: string[],
  targetClass: number,
  topLabel: string,
  topConfidence: number | null,
  heatmapSize: number,
  notes: string[],
): Promise<ExplainResult> {
  const grid = params.occlusionGrid ?? 8;
  const size = heatmapSize;

  // Baseline confidence ảnh gốc.
  let baseline = topConfidence ?? 0;
  try {
    const r0 = await runInference(params.modelId!, params.imageBuffer);
    baseline = r0.topLabel === topLabel
      ? r0.confidence
      : (r0.predictions.find((p) => p.label === topLabel)?.confidence ?? baseline);
  } catch { /* dùng topConfidence */ }

  const baseRaw = await sharp(params.imageBuffer).resize(size, size, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const cellW = Math.floor(size / grid);
  const cellH = Math.floor(size / grid);
  const drops: number[] = [];

  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const occ = Buffer.from(baseRaw);
      const x0 = gx * cellW, y0 = gy * cellH;
      const x1 = gx === grid - 1 ? size : x0 + cellW;
      const y1 = gy === grid - 1 ? size : y0 + cellH;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * size + x) * 3;
          occ[i] = 128; occ[i + 1] = 128; occ[i + 2] = 128; // che xám trung tính
        }
      }
      const occPng = await sharp(occ, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
      let conf = 0;
      try {
        const r = await runInference(params.modelId!, occPng);
        conf = r.topLabel === topLabel
          ? r.confidence
          : (r.predictions.find((p) => p.label === topLabel)?.confidence ?? 0);
      } catch { conf = 0; }
      drops.push(baseline - conf); // dương → che vùng này làm tụt conf → vùng quan trọng
    }
  }

  const small = occlusionMapFromDrops(drops, grid);
  const up = upscaleNearest(small, grid, grid, size, size);
  const heatmapPng = await renderHeatmapPng(params.imageBuffer, up, size, size);
  notes.push(`occlusion sensitivity ${grid}×${grid} grid (drop in '${topLabel}' confidence)`);

  return {
    method: "occlusion",
    degraded: false,
    approximate: true,
    heatmapPng,
    width: size,
    height: size,
    topLabel,
    topConfidence,
    targetClass,
    notes,
  };
}

/** Tầng 3 — pixel-diff (degraded). Cần reference; nếu thiếu → diff với chính ảnh blur. */
async function pixelDiffExplain(
  params: ExplainParams,
  size: number,
  notes: string[],
): Promise<ExplainResult> {
  const aRaw = await sharp(params.imageBuffer).grayscale().resize(size, size, { fit: "fill" }).raw().toBuffer();
  let bRaw: Buffer;
  if (params.referenceBuffer) {
    bRaw = await sharp(params.referenceBuffer).grayscale().resize(size, size, { fit: "fill" }).raw().toBuffer();
    notes.push("pixel-diff vs reference (no model available)");
  } else {
    // Không có reference → diff với phiên bản blur (self-saliency thô).
    bRaw = await sharp(params.imageBuffer).grayscale().resize(size, size, { fit: "fill" }).blur(8).raw().toBuffer();
    notes.push("pixel-diff vs self-blur (no model & no reference)");
  }
  const norm = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) norm[i] = Math.abs(aRaw[i] - bRaw[i]) / 255;
  const heatmapPng = await renderHeatmapPng(params.imageBuffer, minMaxNormalize(norm), size, size);
  return {
    method: "pixel-diff",
    degraded: true,
    approximate: false,
    heatmapPng,
    width: size,
    height: size,
    topLabel: null,
    topConfidence: null,
    targetClass: null,
    notes,
  };
}
