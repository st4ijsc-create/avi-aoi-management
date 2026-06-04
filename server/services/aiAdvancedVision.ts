/**
 * AI Advanced Vision Service
 * 
 * 8 advanced image-processing features built on top of:
 *  - sharp (pixel manipulation, resize, edge detection, augmentation)
 *  - aiProviderRouter.describeImage (local LLaVA-1.6-Mistral-7B / GGUF vision sidecar)
 * 
 * Features:
 *  A. compareOkVsNg      — pairwise OK vs NG semantic comparison
 *  B. imageQualityCheck  — sharpness (Laplacian variance) + brightness + blur score
 *  C. generateDefectHeatmap — pixel-difference heatmap between OK reference and NG sample
 *  D. extractText        — OCR via LLaVA prompt (printed labels / serial numbers)
 *  E. autoDetectRoi      — automatic ROI bounding box from edge density
 *  F. augmentImage       — rotate / flip / brightness / noise augmentation for training
 *  G. visualQA           — free-form visual question answering
 *  H. batchTriage        — auto-classify images into OK / NG / REVIEW based on LLaVA confidence
 */

import sharp from "sharp";
import { describeImage } from "./aiProviderRouter";
import { alignToReference, type GrayImage, type AlignmentResult } from "./imageAlignment";

// B4.2 — căn golden-sample trước pixel-diff. Opt-in, default OFF (trung thực).
const ALIGN_BEFORE_DIFF = (process.env.ALIGN_BEFORE_DIFF ?? "false").toLowerCase() === "true";

export interface AlignmentInfo {
  aligned: boolean;
  dx: number;
  dy: number;
  angle: number;
  confidence: number;
}

// ─── Types ────────────────────────────────────────────────────

export interface OkVsNgComparison {
  verdict: "MATCH" | "MISMATCH" | "BORDERLINE";
  similarityScore: number; // 0..1
  pixelDiffRatio: number;  // 0..1
  semanticSummary: string;
  differences: string[];
  generatedBy: "openai" | "gguf" | "offline";
  // B4.2 — căn golden-sample trước diff (chỉ có khi ALIGN_BEFORE_DIFF=true & confidence đủ).
  aligned?: boolean;
  alignment?: AlignmentInfo;
}

export interface ImageQualityReport {
  sharpness: number;     // Laplacian variance (higher = sharper)
  brightness: number;    // mean luminance 0..255
  contrast: number;      // std-dev of luminance
  blurScore: number;     // 0..1 (1 = very blurry)
  underExposed: boolean;
  overExposed: boolean;
  acceptable: boolean;
  notes: string[];
}

export interface DefectHeatmap {
  width: number;
  height: number;
  heatmapPng: Buffer;     // colored overlay PNG
  hotspots: Array<{ x: number; y: number; w: number; h: number; intensity: number }>;
  totalDiffPixels: number;
  diffRatio: number;
  // B4.2 — căn golden-sample trước diff (chỉ có khi ALIGN_BEFORE_DIFF=true & confidence đủ).
  aligned?: boolean;
  alignment?: AlignmentInfo;
}

export interface ExtractedText {
  text: string;
  language: "en" | "vi" | "auto";
  confidence: "high" | "medium" | "low";
  generatedBy: "openai" | "gguf" | "offline";
}

export interface RoiBox {
  x: number;
  y: number;
  width: number;
  height: number;
  edgeDensity: number;
}

export interface AugmentedImage {
  buffer: Buffer;
  transform: string;
  width: number;
  height: number;
}

export interface VisualQAResult {
  question: string;
  answer: string;
  generatedBy: "openai" | "gguf" | "offline";
  totalTimeMs: number;
}

export interface TriageItem {
  index: number;
  verdict: "OK" | "NG" | "REVIEW";
  reasoning: string;
  confidence: number; // 0..1
}

export interface BatchTriageResult {
  total: number;
  ok: number;
  ng: number;
  review: number;
  items: TriageItem[];
  totalTimeMs: number;
}

// ─── Internal helpers ─────────────────────────────────────────

const MAX_DIM = 1024;

/** Decode + downscale (preserve aspect) and return raw grayscale Uint8 buffer + meta. */
async function toGrayRaw(image: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const meta = await sharp(image).metadata();
  let pipe = sharp(image).grayscale();
  if ((meta.width ?? 0) > MAX_DIM || (meta.height ?? 0) > MAX_DIM) {
    pipe = pipe.resize({ width: MAX_DIM, height: MAX_DIM, fit: "inside" });
  }
  const { data, info } = await pipe.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Discrete 3x3 Laplacian variance on a grayscale plane. Higher = sharper. */
function laplacianVariance(gray: Buffer, w: number, h: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap =
        -gray[i - w - 1] - gray[i - w] - gray[i - w + 1] -
        gray[i - 1] + 8 * gray[i] - gray[i + 1] -
        gray[i + w - 1] - gray[i + w] - gray[i + w + 1];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

function meanStd(buf: Buffer): { mean: number; std: number } {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i];
  const mean = sum / buf.length;
  let sq = 0;
  for (let i = 0; i < buf.length; i++) sq += (buf[i] - mean) * (buf[i] - mean);
  return { mean, std: Math.sqrt(sq / buf.length) };
}

/**
 * B4.2 — Thử căn `candidate` (grayscale raw) về `reference` trước khi diff.
 * Chỉ chạy khi cờ ALIGN_BEFORE_DIFF bật. Khi confidence < ngưỡng → aligned:false,
 * trả candidate NGUYÊN (caller dùng diff cũ) → degrade trung thực.
 *
 * `ref`/`cand` đã resize về cùng W×H (grayscale raw 1-channel).
 */
async function maybeAlign(
  ref: { data: Buffer; width: number; height: number },
  cand: { data: Buffer; width: number; height: number },
): Promise<{ candData: Buffer; info: AlignmentInfo }> {
  if (!ALIGN_BEFORE_DIFF) {
    return {
      candData: cand.data,
      info: { aligned: false, dx: 0, dy: 0, angle: 0, confidence: 0 },
    };
  }
  try {
    const refImg: GrayImage = ref;
    const testImg: GrayImage = cand;
    const res: AlignmentResult = await alignToReference(refImg, testImg, {});
    const info: AlignmentInfo = {
      aligned: res.aligned,
      dx: res.dx,
      dy: res.dy,
      angle: res.angle,
      confidence: res.confidence,
    };
    // confidence thấp → dùng candidate gốc (không align) nhưng vẫn báo cờ thật.
    return { candData: res.aligned ? Buffer.from(res.alignedBuffer) : cand.data, info };
  } catch {
    return {
      candData: cand.data,
      info: { aligned: false, dx: 0, dy: 0, angle: 0, confidence: 0 },
    };
  }
}

// ─── A. Compare OK vs NG ──────────────────────────────────────

export async function compareOkVsNg(
  okImage: Buffer,
  ngImage: Buffer,
  language: "en" | "vi" = "vi",
): Promise<OkVsNgComparison> {
  // Pixel diff
  const [a, b] = await Promise.all([toGrayRaw(okImage), toGrayRaw(ngImage)]);
  // Resize to common size for diff
  const W = Math.min(a.width, b.width);
  const H = Math.min(a.height, b.height);
  const aResized = (await sharp(a.data, { raw: { width: a.width, height: a.height, channels: 1 } })
    .resize(W, H, { fit: "fill" }).raw().toBuffer());
  const bResizedRaw = (await sharp(b.data, { raw: { width: b.width, height: b.height, channels: 1 } })
    .resize(W, H, { fit: "fill" }).raw().toBuffer());

  // B4.2 — căn candidate (b) ↔ reference (a) trước diff nếu cờ bật.
  const { candData: bResized, info: alignment } = await maybeAlign(
    { data: aResized, width: W, height: H },
    { data: bResizedRaw, width: W, height: H },
  );
  let diffCount = 0;
  const threshold = 30;
  for (let i = 0; i < aResized.length; i++) {
    if (Math.abs(aResized[i] - bResized[i]) > threshold) diffCount++;
  }
  const pixelDiffRatio = diffCount / aResized.length;
  const similarityScore = 1 - pixelDiffRatio;

  // Semantic compare via LLaVA — combine into single prompt with two images packed side-by-side
  const sideBySide = await sharp({
    create: { width: W * 2, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([
      { input: await sharp(okImage).resize(W, H, { fit: "fill" }).toBuffer(), left: 0, top: 0 },
      { input: await sharp(ngImage).resize(W, H, { fit: "fill" }).toBuffer(), left: W, top: 0 },
    ])
    .jpeg({ quality: 85 })
    .toBuffer();

  const prompt = language === "vi"
    ? `Ảnh ghép gồm 2 phần: TRÁI là sản phẩm OK (chuẩn), PHẢI là sản phẩm cần kiểm. Liệt kê NGẮN GỌN các khác biệt và đưa ra kết luận MATCH/MISMATCH/BORDERLINE.`
    : `Side-by-side: LEFT is the OK reference, RIGHT is the candidate. List differences briefly and conclude MATCH/MISMATCH/BORDERLINE.`;

  const desc = await describeImage({
    image: sideBySide,
    prompt,
    language,
    maxTokens: 400,
    temperature: 0.2,
  });

  const upper = desc.text.toUpperCase();
  let verdict: OkVsNgComparison["verdict"] = "BORDERLINE";
  if (upper.includes("MISMATCH") || pixelDiffRatio > 0.15) verdict = "MISMATCH";
  else if (upper.includes("MATCH") && pixelDiffRatio < 0.05) verdict = "MATCH";

  // Naive bullet extraction
  const differences = desc.text
    .split(/\r?\n/)
    .map(l => l.replace(/^[\s\-\*\d\.\)]+/, "").trim())
    .filter(l => l.length > 5 && l.length < 200)
    .slice(0, 8);

  return {
    verdict,
    similarityScore: Number(similarityScore.toFixed(3)),
    pixelDiffRatio: Number(pixelDiffRatio.toFixed(3)),
    semanticSummary: desc.text.slice(0, 500),
    differences,
    generatedBy: desc.provider as "openai" | "gguf",
    aligned: alignment.aligned,
    alignment,
  };
}

// ─── B. Image Quality Check ───────────────────────────────────

export async function imageQualityCheck(image: Buffer): Promise<ImageQualityReport> {
  const { data, width, height } = await toGrayRaw(image);
  const sharpness = laplacianVariance(data, width, height);
  const { mean, std } = meanStd(data);

  // Normalize blur: empirically <100 → blurry, >500 → sharp
  const blurScore = Math.max(0, Math.min(1, 1 - sharpness / 500));

  const underExposed = mean < 50;
  const overExposed = mean > 210;
  const lowContrast = std < 20;
  const tooBlurry = blurScore > 0.7;

  const notes: string[] = [];
  if (underExposed) notes.push("Ảnh quá tối (under-exposed)");
  if (overExposed) notes.push("Ảnh quá sáng (over-exposed)");
  if (lowContrast) notes.push("Độ tương phản thấp");
  if (tooBlurry) notes.push("Ảnh bị mờ/nhòe");

  return {
    sharpness: Number(sharpness.toFixed(1)),
    brightness: Number(mean.toFixed(1)),
    contrast: Number(std.toFixed(1)),
    blurScore: Number(blurScore.toFixed(3)),
    underExposed,
    overExposed,
    acceptable: !(underExposed || overExposed || lowContrast || tooBlurry),
    notes,
  };
}

// ─── C. Defect Heatmap ────────────────────────────────────────

export async function generateDefectHeatmap(
  okReference: Buffer,
  candidate: Buffer,
): Promise<DefectHeatmap> {
  const [a, b] = await Promise.all([toGrayRaw(okReference), toGrayRaw(candidate)]);
  const W = Math.min(a.width, b.width);
  const H = Math.min(a.height, b.height);
  const aR = await sharp(a.data, { raw: { width: a.width, height: a.height, channels: 1 } })
    .resize(W, H, { fit: "fill" }).blur(2).raw().toBuffer();
  const bRraw = await sharp(b.data, { raw: { width: b.width, height: b.height, channels: 1 } })
    .resize(W, H, { fit: "fill" }).blur(2).raw().toBuffer();

  // B4.2 — căn candidate (bR) ↔ reference (aR) trước diff nếu cờ bật.
  const { candData: bR, info: alignment } = await maybeAlign(
    { data: aR, width: W, height: H },
    { data: bRraw, width: W, height: H },
  );

  // RGBA heatmap — red intensity proportional to abs difference
  const rgba = Buffer.alloc(W * H * 4);
  let totalDiff = 0;
  const diff = new Uint8Array(W * H);
  for (let i = 0; i < aR.length; i++) {
    const d = Math.abs(aR[i] - bR[i]);
    diff[i] = d;
    if (d > 25) totalDiff++;
    rgba[i * 4 + 0] = d > 25 ? 255 : 0;          // R
    rgba[i * 4 + 1] = 0;                          // G
    rgba[i * 4 + 2] = d > 25 ? 0 : Math.min(255, bR[i]); // B fallback shows context
    rgba[i * 4 + 3] = d > 25 ? 200 : 60;          // A
  }

  const heatmapPng = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toBuffer();

  // Connected-region hotspot extraction (coarse grid 16x16)
  const cell = 32;
  const hotspots: Array<{ x: number; y: number; w: number; h: number; intensity: number }> = [];
  for (let y = 0; y < H; y += cell) {
    for (let x = 0; x < W; x += cell) {
      let acc = 0;
      const hh = Math.min(cell, H - y);
      const ww = Math.min(cell, W - x);
      for (let yy = 0; yy < hh; yy++) {
        for (let xx = 0; xx < ww; xx++) {
          acc += diff[(y + yy) * W + (x + xx)];
        }
      }
      const avg = acc / (hh * ww);
      if (avg > 30) {
        hotspots.push({ x, y, w: ww, h: hh, intensity: Number(avg.toFixed(1)) });
      }
    }
  }
  hotspots.sort((p, q) => q.intensity - p.intensity);

  return {
    width: W,
    height: H,
    heatmapPng,
    hotspots: hotspots.slice(0, 20),
    totalDiffPixels: totalDiff,
    diffRatio: Number((totalDiff / (W * H)).toFixed(4)),
    aligned: alignment.aligned,
    alignment,
  };
}

// ─── D. Extract Text (OCR via LLaVA) ─────────────────────────

export async function extractText(
  image: Buffer,
  language: "en" | "vi" | "auto" = "auto",
): Promise<ExtractedText> {
  const prompt = language === "vi"
    ? "Hãy trích xuất CHÍNH XÁC mọi văn bản (chữ, số, mã serial, nhãn) hiển thị trong ảnh. Trả về NGUYÊN văn, mỗi dòng văn bản trên một dòng. Nếu không có chữ, trả về 'NO_TEXT'."
    : "Extract EXACTLY all visible text (letters, digits, serial numbers, labels) in the image. Return verbatim, one line per text block. If no text, return 'NO_TEXT'.";

  const r = await describeImage({
    image,
    prompt,
    language: language === "auto" ? "en" : language,
    maxTokens: 512,
    temperature: 0,
  });

  const text = r.text.trim();
  let confidence: ExtractedText["confidence"] = "medium";
  if (text === "NO_TEXT" || text.length < 3) confidence = "low";
  else if (text.length > 20 && /[A-Za-z0-9]/.test(text)) confidence = "high";

  return {
    text: text === "NO_TEXT" ? "" : text,
    language,
    confidence,
    generatedBy: r.provider as "openai" | "gguf",
  };
}

// ─── E. Auto-detect ROI ──────────────────────────────────────

export async function autoDetectRoi(image: Buffer): Promise<RoiBox> {
  const { data, width, height } = await toGrayRaw(image);
  // Sobel-like edge magnitude (cheap approximation: |dx|+|dy|)
  const edges = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const dx = data[i + 1] - data[i - 1];
      const dy = data[i + width] - data[i - width];
      edges[i] = Math.min(255, Math.abs(dx) + Math.abs(dy));
    }
  }
  // Find tight bounding box of pixels with edge > threshold
  const T = 60;
  let minX = width, minY = height, maxX = 0, maxY = 0, count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (edges[y * width + x] > T) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        count++;
      }
    }
  }
  if (count === 0) {
    return { x: 0, y: 0, width, height, edgeDensity: 0 };
  }
  // Pad 5%
  const padX = Math.floor(width * 0.05);
  const padY = Math.floor(height * 0.05);
  minX = Math.max(0, minX - padX);
  minY = Math.max(0, minY - padY);
  maxX = Math.min(width - 1, maxX + padX);
  maxY = Math.min(height - 1, maxY + padY);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  return {
    x: minX,
    y: minY,
    width: w,
    height: h,
    edgeDensity: Number((count / (w * h)).toFixed(4)),
  };
}

// ─── F. Augment Image ────────────────────────────────────────

export type AugmentTransform =
  | "rotate90" | "rotate180" | "rotate270"
  | "flipH" | "flipV"
  | "brightnessUp" | "brightnessDown"
  | "contrastUp" | "noise";

export async function augmentImage(
  image: Buffer,
  transforms: AugmentTransform[],
): Promise<AugmentedImage[]> {
  const out: AugmentedImage[] = [];
  for (const t of transforms) {
    let p = sharp(image);
    switch (t) {
      case "rotate90": p = p.rotate(90); break;
      case "rotate180": p = p.rotate(180); break;
      case "rotate270": p = p.rotate(270); break;
      case "flipH": p = p.flop(); break;
      case "flipV": p = p.flip(); break;
      case "brightnessUp": p = p.modulate({ brightness: 1.25 }); break;
      case "brightnessDown": p = p.modulate({ brightness: 0.75 }); break;
      case "contrastUp": p = p.linear(1.3, -30); break;
      case "noise": {
        // overlay random noise via composite
        const meta = await sharp(image).metadata();
        const w = meta.width ?? 256, h = meta.height ?? 256;
        const noiseBuf = Buffer.alloc(w * h * 3);
        for (let i = 0; i < noiseBuf.length; i++) noiseBuf[i] = Math.floor(Math.random() * 255);
        const noisePng = await sharp(noiseBuf, { raw: { width: w, height: h, channels: 3 } })
          .png().toBuffer();
        p = p.composite([{ input: noisePng, blend: "overlay" }]);
        break;
      }
    }
    const { data, info } = await p.jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
    out.push({ buffer: data, transform: t, width: info.width, height: info.height });
  }
  return out;
}

// ─── G. Visual QA ────────────────────────────────────────────

export async function visualQA(
  image: Buffer,
  question: string,
  language: "en" | "vi" = "vi",
): Promise<VisualQAResult> {
  const sys = language === "vi"
    ? "Bạn là chuyên gia kiểm tra ngoại quan AOI. Trả lời ngắn gọn, chính xác, dựa hoàn toàn trên ảnh."
    : "You are an AOI visual inspection expert. Answer concisely and strictly based on the image.";
  const r = await describeImage({
    image,
    prompt: question,
    systemPrompt: sys,
    language,
    maxTokens: 400,
    temperature: 0.2,
  });
  return {
    question,
    answer: r.text,
    generatedBy: r.provider as "openai" | "gguf",
    totalTimeMs: r.totalTimeMs,
  };
}

// ─── H. Batch Triage ─────────────────────────────────────────

export async function batchTriage(
  images: Buffer[],
  language: "en" | "vi" = "vi",
): Promise<BatchTriageResult> {
  const start = Date.now();
  const items: TriageItem[] = [];
  let ok = 0, ng = 0, review = 0;

  const prompt = language === "vi"
    ? "Đánh giá ảnh kiểm tra AOI. Trả về DUY NHẤT 1 dòng theo định dạng: VERDICT|CONFIDENCE|REASON. VERDICT là OK/NG/REVIEW. CONFIDENCE là số 0..1. REASON ngắn dưới 80 ký tự."
    : "Evaluate this AOI inspection image. Return EXACTLY one line: VERDICT|CONFIDENCE|REASON. VERDICT in OK/NG/REVIEW. CONFIDENCE in 0..1. REASON < 80 chars.";

  // Process sequentially to avoid GPU contention on local LLaVA.
  for (let i = 0; i < images.length; i++) {
    try {
      const r = await describeImage({
        image: images[i],
        prompt,
        language,
        maxTokens: 100,
        temperature: 0,
      });
      const line = r.text.trim().split(/\r?\n/)[0] ?? "";
      const parts = line.split("|").map(s => s.trim());
      const v = (parts[0] ?? "REVIEW").toUpperCase();
      const conf = Number(parts[1]);
      const reason = (parts[2] ?? r.text.slice(0, 80)).trim();
      let verdict: TriageItem["verdict"] = "REVIEW";
      if (v === "OK") verdict = "OK";
      else if (v === "NG") verdict = "NG";
      const confidence = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5;

      // Confidence-gating: if low, force REVIEW
      const finalVerdict: TriageItem["verdict"] = confidence < 0.55 ? "REVIEW" : verdict;
      items.push({ index: i, verdict: finalVerdict, reasoning: reason, confidence });
      if (finalVerdict === "OK") ok++;
      else if (finalVerdict === "NG") ng++;
      else review++;
    } catch (err) {
      items.push({
        index: i,
        verdict: "REVIEW",
        reasoning: `error: ${err instanceof Error ? err.message : String(err)}`,
        confidence: 0,
      });
      review++;
    }
  }

  return {
    total: images.length,
    ok,
    ng,
    review,
    items,
    totalTimeMs: Date.now() - start,
  };
}
