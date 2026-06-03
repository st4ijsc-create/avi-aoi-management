/**
 * B7 — Segmentation decode (thuần JS, KHÔNG import onnxruntime).
 *
 * Decode output của model segmentation thành danh sách mask theo lớp:
 *   • Semantic logits  [1, C, H, W]  → argmax theo kênh C (C>1).
 *   • Binary sigmoid   [1, 1, H, W]  → sigmoid + threshold.
 *   • YOLOv8-seg proto+coeff (2 output: output0 [1,4+nc+32,N] + output1
 *     [1,32,mh,mw]) → decodeYoloSeg (proto · coeff → mask, NMS theo lớp).
 *
 * Trả mỗi mask kèm polygon (contour đơn giản) + bbox + confidence trung bình.
 *
 * Hàm decode TÁCH RỜI engine để test bằng tensor giả (không cần ONNX runtime).
 */

import { measureMask, type MaskGrid } from "./aiMetrology";

export interface DecodedMask {
  /** Nhãn lớp (từ labels model, hoặc class_<i>). */
  label: string;
  classIndex: number;
  /** Độ tin cậy trung bình của vùng (xác suất sau softmax/sigmoid). */
  confidence: number;
  /** Polygon contour (toạ độ pixel theo lưới H×W của mask). */
  polygon: Array<{ x: number; y: number }>;
  /** Bounding box pixel. */
  bbox: { x: number; y: number; w: number; h: number };
  /** Lưới mask probability (để metrology sub-pixel). */
  grid: MaskGrid;
  /** Số pixel thuộc lớp. */
  pixelCount: number;
}

export type SegOutputType = "semantic-argmax" | "binary-sigmoid";

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * Softmax theo kênh tại từng pixel cho tensor [1,C,H,W] (channel-first).
 * Trả prob[c][p] và argmax index per pixel.
 */
function channelSoftmaxArgmax(
  data: ArrayLike<number>,
  C: number,
  H: number,
  W: number,
): { argmax: Int32Array; prob: Float32Array } {
  const HW = H * W;
  const argmax = new Int32Array(HW);
  const prob = new Float32Array(HW); // xác suất của lớp argmax
  for (let p = 0; p < HW; p++) {
    let mx = -Infinity;
    for (let c = 0; c < C; c++) {
      const v = Number(data[c * HW + p]);
      if (v > mx) mx = v;
    }
    let sum = 0;
    let bestC = 0;
    let bestExp = 0;
    for (let c = 0; c < C; c++) {
      const e = Math.exp(Number(data[c * HW + p]) - mx);
      sum += e;
      if (e > bestExp) { bestExp = e; bestC = c; }
    }
    argmax[p] = bestC;
    prob[p] = sum > 0 ? bestExp / sum : 0;
  }
  return { argmax, prob };
}

/** Contour đơn giản: biên (boundary pixel) → sắp xếp theo góc quanh tâm. Đủ cho overlay. */
function simpleContour(grid: MaskGrid): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= grid.width || y >= grid.height ? 0 : Number(grid.data[y * grid.width + x]);
  let cx = 0, cy = 0, n = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (at(x, y) < 0.5) continue;
      n++; cx += x; cy += y;
      const edge = at(x - 1, y) < 0.5 || at(x + 1, y) < 0.5 || at(x, y - 1) < 0.5 || at(x, y + 1) < 0.5;
      if (edge) pts.push({ x, y });
    }
  }
  if (n === 0 || pts.length < 3) return pts;
  cx /= n; cy /= n;
  pts.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  return pts;
}

function bboxOf(grid: MaskGrid): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (Number(grid.data[y * grid.width + x]) < 0.5) continue;
      n++;
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
  }
  if (n === 0) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export interface DecodeOptions {
  labels?: string[];
  /** Ngưỡng cho binary sigmoid (mặc định 0.5). */
  threshold?: number;
  /** Bỏ qua lớp background index (mặc định 0 cho semantic, không áp cho binary). */
  backgroundIndex?: number | null;
  /** Số pixel tối thiểu để giữ một mask (lọc nhiễu). */
  minPixels?: number;
}

/**
 * Decode tensor segmentation thô.
 *
 * @param data  Float array channel-first.
 * @param dims  [1,C,H,W] (hoặc [C,H,W]).
 */
export function decodeSegmentation(
  data: ArrayLike<number>,
  dims: number[],
  opts: DecodeOptions = {},
): { masks: DecodedMask[]; outputType: SegOutputType } {
  let C: number, H: number, W: number;
  if (dims.length === 4) { C = dims[1]; H = dims[2]; W = dims[3]; }
  else if (dims.length === 3) { C = dims[0]; H = dims[1]; W = dims[2]; }
  else throw new Error(`Unsupported segmentation dims: [${dims.join(",")}]`);

  const labels = opts.labels ?? [];
  const minPixels = opts.minPixels ?? 1;
  const HW = H * W;
  const masks: DecodedMask[] = [];

  if (C === 1) {
    // ── Binary sigmoid ─────────────────────────────────────────────────────
    const threshold = opts.threshold ?? 0.5;
    const prob = new Float32Array(HW);
    let count = 0;
    let confSum = 0;
    for (let p = 0; p < HW; p++) {
      const s = sigmoid(Number(data[p]));
      const on = s >= threshold ? s : 0; // giữ probability để metrology sub-pixel
      prob[p] = on;
      if (s >= threshold) { count++; confSum += s; }
    }
    if (count >= minPixels) {
      const grid: MaskGrid = { data: prob, width: W, height: H };
      masks.push({
        label: labels[0] ?? "defect",
        classIndex: 0,
        confidence: count > 0 ? Number((confSum / count).toFixed(6)) : 0,
        polygon: simpleContour(grid),
        bbox: bboxOf(grid),
        grid,
        pixelCount: count,
      });
    }
    return { masks, outputType: "binary-sigmoid" };
  }

  // ── Semantic argmax (C>1) ──────────────────────────────────────────────────
  const bg = opts.backgroundIndex === undefined ? 0 : opts.backgroundIndex;
  const { argmax, prob } = channelSoftmaxArgmax(data, C, H, W);

  // Mỗi lớp (trừ background) → 1 mask probability.
  for (let c = 0; c < C; c++) {
    if (bg !== null && c === bg) continue;
    const g = new Float32Array(HW);
    let count = 0;
    let confSum = 0;
    for (let p = 0; p < HW; p++) {
      if (argmax[p] === c) {
        g[p] = prob[p]; // probability của lớp tại pixel (sub-pixel friendly)
        count++;
        confSum += prob[p];
      }
    }
    if (count < minPixels) continue;
    const grid: MaskGrid = { data: g, width: W, height: H };
    masks.push({
      label: labels[c] ?? `class_${c}`,
      classIndex: c,
      confidence: count > 0 ? Number((confSum / count).toFixed(6)) : 0,
      polygon: simpleContour(grid),
      bbox: bboxOf(grid),
      grid,
      pixelCount: count,
    });
  }
  return { masks, outputType: "semantic-argmax" };
}

// ════════════════════════════════════════════════════════════════════════════
// YOLOv8-seg decode (proto + coeff). Output ONNX của Ultralytics YOLOv8-seg:
//   output0 [1, 4 + nc + 32, N]  — N anchors:
//       hàng 0..3      = box (cx, cy, w, h) tính theo PIXEL của imgsz
//       hàng 4..4+nc-1 = điểm số mỗi lớp (đã sigmoid)
//       hàng 4+nc..+32 = 32 hệ số mask (mask coefficients) mỗi anchor
//   output1 [1, 32, mh, mw]      — 32 mask prototype.
//   Mask 1 instance = sigmoid( coeff[32] · proto[32, mh*mw] ) reshape [mh,mw],
//   crop theo box, threshold 0.5.
//
// Hàm này TÁCH RỜI runtime (nhận Float32 thô) để test bằng tensor giả.
// outputType trả "yolo-seg".
// ════════════════════════════════════════════════════════════════════════════

const NUM_PROTO = 32;

export interface YoloSegOptions extends DecodeOptions {
  /** Ngưỡng score lớp để giữ một detection (mặc định 0.25). */
  scoreThreshold?: number;
  /** Ngưỡng IoU cho NMS (mặc định 0.45). */
  iouThreshold?: number;
  /** Ngưỡng nhị phân hoá mask sau sigmoid (mặc định 0.5). */
  maskThreshold?: number;
  /** Số detection tối đa giữ sau NMS (mặc định 100). */
  maxDetections?: number;
}

interface YoloDet {
  classIndex: number;
  score: number;
  // box tính theo pixel imgsz (cx,cy,w,h) → góc.
  x1: number; y1: number; x2: number; y2: number;
  coeffs: Float32Array; // [32]
}

function iou(a: YoloDet, b: YoloDet): number {
  const ix1 = Math.max(a.x1, b.x1), iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2), iy2 = Math.min(a.y2, b.y2);
  const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Decode YOLOv8-seg ONNX outputs → danh sách mask theo instance.
 *
 * @param det      Float array của output0, channel-first theo [1, A, N].
 * @param detDims  [1, A, N] với A = 4 + nc + 32.
 * @param proto    Float array của output1.
 * @param protoDims [1, 32, mh, mw].
 * @param imgSize  imgsz model train (để scale box về lưới proto).
 */
export function decodeYoloSeg(
  det: ArrayLike<number>,
  detDims: number[],
  proto: ArrayLike<number>,
  protoDims: number[],
  imgSize: number,
  opts: YoloSegOptions = {},
): { masks: DecodedMask[]; outputType: "yolo-seg"; maskWidth: number; maskHeight: number } {
  if (detDims.length !== 3) throw new Error(`Unsupported yolo-seg det dims: [${detDims.join(",")}]`);
  if (protoDims.length !== 4) throw new Error(`Unsupported yolo-seg proto dims: [${protoDims.join(",")}]`);
  const A = detDims[1];
  const N = detDims[2];
  const np = protoDims[1]; // 32
  const mh = protoDims[2];
  const mw = protoDims[3];
  const nc = A - 4 - np;
  if (nc <= 0) throw new Error(`yolo-seg: invalid attr count A=${A} (nc=${nc})`);

  const labels = opts.labels ?? [];
  const scoreThr = opts.scoreThreshold ?? 0.25;
  const iouThr = opts.iouThreshold ?? 0.45;
  const maskThr = opts.maskThreshold ?? 0.5;
  const maxDet = opts.maxDetections ?? 100;
  const minPixels = opts.minPixels ?? 1;

  // det là channel-first [A, N]: phần tử (attr a, anchor n) = det[a*N + n].
  const get = (a: number, n: number) => Number(det[a * N + n]);

  // 1) Lọc theo score lớp tốt nhất mỗi anchor.
  const dets: YoloDet[] = [];
  for (let n = 0; n < N; n++) {
    let bestC = 0, bestS = 0;
    for (let c = 0; c < nc; c++) {
      const s = get(4 + c, n);
      if (s > bestS) { bestS = s; bestC = c; }
    }
    if (bestS < scoreThr) continue;
    const cx = get(0, n), cy = get(1, n), w = get(2, n), h = get(3, n);
    const coeffs = new Float32Array(np);
    for (let k = 0; k < np; k++) coeffs[k] = get(4 + nc + k, n);
    dets.push({
      classIndex: bestC, score: bestS,
      x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2,
      coeffs,
    });
  }

  // 2) NMS theo lớp.
  dets.sort((a, b) => b.score - a.score);
  const kept: YoloDet[] = [];
  for (const d of dets) {
    if (kept.length >= maxDet) break;
    let suppressed = false;
    for (const k of kept) {
      if (k.classIndex === d.classIndex && iou(d, k) > iouThr) { suppressed = true; break; }
    }
    if (!suppressed) kept.push(d);
  }

  // 3) Mỗi detection → mask: sigmoid(coeff · proto) trên lưới [mh,mw], crop theo box.
  const protoHW = mh * mw;
  const masks: DecodedMask[] = [];
  const scale = imgSize > 0 ? imgSize : Math.max(mh, mw); // box pixel → tỉ lệ lưới proto
  for (const d of kept) {
    const g = new Float32Array(protoHW);
    // box trong không gian lưới proto.
    const bx1 = Math.max(0, Math.floor((d.x1 / scale) * mw));
    const by1 = Math.max(0, Math.floor((d.y1 / scale) * mh));
    const bx2 = Math.min(mw, Math.ceil((d.x2 / scale) * mw));
    const by2 = Math.min(mh, Math.ceil((d.y2 / scale) * mh));
    let count = 0, confSum = 0;
    for (let y = by1; y < by2; y++) {
      for (let x = bx1; x < bx2; x++) {
        const p = y * mw + x;
        let acc = 0;
        for (let k = 0; k < np; k++) acc += d.coeffs[k] * Number(proto[k * protoHW + p]);
        const s = sigmoid(acc);
        if (s >= maskThr) { g[p] = s; count++; confSum += s; }
      }
    }
    if (count < minPixels) continue;
    const grid: MaskGrid = { data: g, width: mw, height: mh };
    masks.push({
      label: labels[d.classIndex] ?? `class_${d.classIndex}`,
      classIndex: d.classIndex,
      // Kết hợp score detection và độ tin cậy mask trung bình.
      confidence: Number((d.score * (count > 0 ? confSum / count : 0)).toFixed(6)),
      polygon: simpleContour(grid),
      bbox: bboxOf(grid),
      grid,
      pixelCount: count,
    });
  }
  return { masks, outputType: "yolo-seg", maskWidth: mw, maskHeight: mh };
}

/** Kèm metrology cho mỗi mask đã decode. */
export function measureDecodedMasks(masks: DecodedMask[], umPerPx?: number | null) {
  return masks.map((m) => ({
    label: m.label,
    classIndex: m.classIndex,
    confidence: m.confidence,
    polygon: m.polygon,
    bbox: m.bbox,
    pixelCount: m.pixelCount,
    metrology: measureMask(m.grid, umPerPx),
  }));
}
