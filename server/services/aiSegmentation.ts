/**
 * B7 — Segmentation decode (thuần JS, KHÔNG import onnxruntime).
 *
 * Decode output của model segmentation thành danh sách mask theo lớp:
 *   • Semantic logits  [1, C, H, W]  → argmax theo kênh C (C>1).
 *   • Binary sigmoid   [1, 1, H, W]  → sigmoid + threshold.
 *   • (YOLOv8-seg proto+coeff: GHI CHÚ — chưa hỗ trợ ở đợt này; ưu tiên semantic.
 *      Khi có model YOLO-seg, bổ sung nhánh combineProtoCoeff tại đây.)
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
