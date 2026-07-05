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
import { registerToReference, type GrayImage } from "./imageRegistration";

// B4.2 / AOI-B — align golden-sample before pixel-diff on the LAB two-upload paths
// (compareOkVsNg / generateDefectHeatmap). Opt-in, default OFF (honest) — unchanged.
const ALIGN_BEFORE_DIFF = (process.env.ALIGN_BEFORE_DIFF ?? "false").toLowerCase() === "true";

// W7-C (doc 27 V7) — GLOBAL KILL-SWITCH for the STORED-GOLDEN diff path
// (goldenDiffForKey): alignment there is enabled PER GOLDEN ROW (alignBeforeDiff,
// default true); setting ALIGN_BEFORE_DIFF=false in env disables it everywhere.
// (Unset/other values do NOT disable — the per-row flag governs.)
const ALIGN_KILLED_GLOBALLY = (process.env.ALIGN_BEFORE_DIFF ?? "").toLowerCase() === "false";

export interface AlignmentInfo {
  aligned: boolean;
  dx: number;
  dy: number;
  angle: number;
  confidence: number;
  // AOI-B — richer sub-pixel registration diagnostics (present on the affine path).
  method?: "subpixel-affine" | "subpixel-homography" | "none";
  scale?: number;
  rmsResidual?: number;
  overlap?: number;
  /** Reason when aligned=false (e.g. low confidence / high residual) — honest gate. */
  reason?: string;
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
 * AOI-B — Register `candidate` (grayscale raw) onto `reference` before diff.
 *
 * Only runs when ALIGN_BEFORE_DIFF is on. Uses SUB-PIXEL affine registration
 * (imageRegistration.registerToReference: inverse-compositional / ECC-style
 * Gauss–Newton on a Gaussian pyramid) with a CONFIDENCE + RESIDUAL GATE. When the
 * gate fails (low confidence / high residual / insufficient overlap) it returns the
 * candidate UNCHANGED (caller diffs the raw pair) and reports aligned:false with a
 * reason — honest degradation, never a fake pass on a bad alignment.
 *
 * `ref`/`cand` are already resized to the same W×H (grayscale raw 1-channel).
 */
async function maybeAlign(
  ref: { data: Buffer; width: number; height: number },
  cand: { data: Buffer; width: number; height: number },
): Promise<{ candData: Buffer; info: AlignmentInfo }> {
  if (!ALIGN_BEFORE_DIFF) {
    return {
      candData: cand.data,
      info: { aligned: false, dx: 0, dy: 0, angle: 0, confidence: 0, method: "none" },
    };
  }
  try {
    const refImg: GrayImage = ref;
    const testImg: GrayImage = cand;
    const res = await registerToReference(refImg, testImg, {});
    const info: AlignmentInfo = {
      aligned: res.aligned,
      dx: Math.round(res.dx),
      dy: Math.round(res.dy),
      angle: res.rotationDeg,
      confidence: res.confidence,
      method: res.model === "homography" ? "subpixel-homography" : "subpixel-affine",
      scale: res.scale,
      rmsResidual: res.rmsResidual,
      overlap: res.overlap,
      reason: res.reason,
    };
    // Gate fails → use the raw candidate (no warp) but report the honest flag/reason.
    return { candData: res.aligned ? Buffer.from(res.alignedBuffer) : cand.data, info };
  } catch (err) {
    return {
      candData: cand.data,
      info: {
        aligned: false, dx: 0, dy: 0, angle: 0, confidence: 0, method: "none",
        reason: `registration error: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

// ─── W7-C (doc 27 V15) — Illumination (flat-field) normalization ─────────────
//
// ALGORITHM (pure TS + sharp on the gray plane — honest about scope):
//   1. Estimate the illumination field B as a LARGE-KERNEL GAUSSIAN BLUR of the
//      gray plane (σ defaults to min(w,h)/8, ≥8): smooth-varying background ≈
//      lamp falloff / vignetting / brightness gradient.
//   2. Flat-field DIVISION: out(x) = I(x) · mean(B) / max(B(x), ε) — corrects a
//      MULTIPLICATIVE smooth illumination model and re-anchors the global mean,
//      so the same board under a tilted lamp normalizes to near-identical planes.
//
// LIMITS (documented honestly):
//   * Corrects smooth ILLUMINATION drift only — NOT lens geometric distortion
//     (no camera calibration / undistort here) and NOT specular highlights.
//   * Assumes the illumination varies at a scale ≫ defect size; defects smaller
//     than ~σ are preserved, illumination structure at or below defect scale is
//     indistinguishable from content and cannot be separated by this method.
//   * ε-clamp (default 8) prevents noise blow-up in near-black regions, which
//     means truly dark regions are normalized conservatively.
//   * Output is a normalized-intensity plane: diff both images through the SAME
//     normalization so thresholds stay comparable.

export interface NormalizeIlluminationOptions {
  /** Gaussian σ for the background estimate. Default max(8, min(w,h)/8). */
  sigma?: number;
  /** Lower clamp for the background divisor (noise guard in dark areas). Default 8. */
  epsilon?: number;
}

export async function normalizeIllumination(
  img: GrayImage,
  opts: NormalizeIlluminationOptions = {},
): Promise<{ data: Buffer; width: number; height: number }> {
  const w = img.width;
  const h = img.height;
  const src = Buffer.isBuffer(img.data) ? img.data : Buffer.from(img.data);
  const sigma = Math.min(1000, Math.max(0.3, opts.sigma ?? Math.max(8, Math.min(w, h) / 8)));
  const epsilon = Math.max(1, opts.epsilon ?? 8);

  // 1. Background (illumination field) estimate.
  // NOTE: .toColourspace("b-w") pins the output to ONE channel — sharp raw
  // pipelines otherwise promote 1-channel input to 3-channel sRGB on output,
  // which would silently triple the buffer and scramble plane math.
  const bg = await sharp(src, { raw: { width: w, height: h, channels: 1 } })
    .blur(sigma)
    .toColourspace("b-w")
    .raw()
    .toBuffer();

  // 2. Flat-field division, re-anchored to the background's global mean.
  let sum = 0;
  for (let i = 0; i < bg.length; i++) sum += bg[i];
  const meanBg = bg.length > 0 ? sum / bg.length : 1;

  const out = Buffer.alloc(w * h);
  for (let i = 0; i < out.length; i++) {
    const b = Math.max(bg[i], epsilon);
    const v = Math.round((src[i] * meanBg) / b);
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return { data: out, width: w, height: h };
}

// ─── W7-C — shared pixel-diff → heatmap core (used by C. and goldenDiff) ─────

interface DiffHeatmapCoreResult {
  heatmapPng: Buffer;
  hotspots: Array<{ x: number; y: number; w: number; h: number; intensity: number }>;
  totalDiffPixels: number;
  diffRatio: number;
}

/**
 * Per-pixel |a−b| over two same-size gray planes → red-overlay heatmap PNG +
 * coarse-grid hotspots + diff ratio. Extracted verbatim from generateDefectHeatmap
 * so the stored-golden path (goldenDiffAgainstGray) reuses the EXACT diff logic.
 */
async function renderDiffHeatmap(
  aR: Buffer,
  bR: Buffer,
  W: number,
  H: number,
  threshold = 25,
): Promise<DiffHeatmapCoreResult> {
  const rgba = Buffer.alloc(W * H * 4);
  let totalDiff = 0;
  const diff = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const d = Math.abs(aR[i] - bR[i]);
    diff[i] = d;
    if (d > threshold) totalDiff++;
    rgba[i * 4 + 0] = d > threshold ? 255 : 0;                    // R
    rgba[i * 4 + 1] = 0;                                          // G
    rgba[i * 4 + 2] = d > threshold ? 0 : Math.min(255, bR[i]);   // B fallback shows context
    rgba[i * 4 + 3] = d > threshold ? 200 : 60;                   // A
  }

  const heatmapPng = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toBuffer();

  // Connected-region hotspot extraction (coarse grid 32px cells).
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
    heatmapPng,
    hotspots: hotspots.slice(0, 20),
    totalDiffPixels: totalDiff,
    diffRatio: Number((totalDiff / (W * H)).toFixed(4)),
  };
}

// ─── W7-C (doc 27 V7 + V15) — STORED-GOLDEN diff pipeline ────────────────────
// normalize (V15) → register candidate onto golden (V7, sub-pixel — REAL
// imageRegistration.registerToReference) → pixel-diff heatmap (same core as C.).
// Honest degradation at every stage: failed registration diffs the raw pair and
// reports aligned:false + reason; normalization is optional per call.

export interface GoldenDiffOptions {
  /** Apply flat-field illumination normalization to BOTH planes first. Default true. */
  normalize?: boolean;
  /** Run sub-pixel registration before diff. Default true (caller resolves the
   *  per-golden flag + env kill-switch — see goldenDiffForKey). */
  align?: boolean;
  /** Per-pixel diff threshold (0..255). Default 25 (same as generateDefectHeatmap). */
  diffThreshold?: number;
}

export interface GoldenDiffResult {
  width: number;
  height: number;
  heatmapPng: Buffer;
  hotspots: Array<{ x: number; y: number; w: number; h: number; intensity: number }>;
  totalDiffPixels: number;
  /** Fraction of pixels above the diff threshold, 0..1. */
  diffRatio: number;
  /** diffRatio as a 0..100 score (percent of differing pixels). */
  diffScore: number;
  /** Whether flat-field normalization ran on both planes. */
  normalized: boolean;
  /** Whether the candidate was warped onto the golden (gate passed). */
  aligned: boolean;
  /** Full registration diagnostics (null when align was disabled). */
  alignment: AlignmentInfo | null;
}

/**
 * Diff an encoded candidate image against a golden GRAY plane (pure — no DB).
 * The candidate is decoded to gray at the golden's exact W×H first.
 */
export async function goldenDiffAgainstGray(
  golden: GrayImage,
  candidate: Buffer,
  opts: GoldenDiffOptions = {},
): Promise<GoldenDiffResult> {
  const W = golden.width;
  const H = golden.height;
  const candRaw = await sharp(candidate)
    .grayscale()
    .resize(W, H, { fit: "fill" })
    .raw()
    .toBuffer();

  const normalize = opts.normalize ?? true;
  let refPlane: { data: Buffer; width: number; height: number } = {
    data: Buffer.isBuffer(golden.data) ? golden.data : Buffer.from(golden.data),
    width: W,
    height: H,
  };
  let candPlane: { data: Buffer; width: number; height: number } = { data: candRaw, width: W, height: H };
  if (normalize) {
    // V15 — both planes through the SAME normalization so thresholds stay comparable.
    refPlane = await normalizeIllumination(refPlane);
    candPlane = await normalizeIllumination(candPlane);
  }

  let alignment: AlignmentInfo | null = null;
  let candForDiff = candPlane.data;
  if (opts.align ?? true) {
    try {
      const res = await registerToReference(refPlane, candPlane, {});
      alignment = {
        aligned: res.aligned,
        dx: Math.round(res.dx),
        dy: Math.round(res.dy),
        angle: res.rotationDeg,
        confidence: res.confidence,
        method: res.model === "homography" ? "subpixel-homography" : "subpixel-affine",
        scale: res.scale,
        rmsResidual: res.rmsResidual,
        overlap: res.overlap,
        reason: res.reason,
      };
      // Gate fails → diff the raw pair, report honestly (never diff on a bad warp).
      if (res.aligned) candForDiff = Buffer.from(res.alignedBuffer);
    } catch (err) {
      alignment = {
        aligned: false, dx: 0, dy: 0, angle: 0, confidence: 0, method: "none",
        reason: `registration error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Same σ=2 pre-blur as generateDefectHeatmap (suppresses sensor noise).
  // toColourspace("b-w") keeps the planes single-channel (see normalizeIllumination).
  const refBlur = await sharp(refPlane.data, { raw: { width: W, height: H, channels: 1 } })
    .blur(2).toColourspace("b-w").raw().toBuffer();
  const candBlur = await sharp(candForDiff, { raw: { width: W, height: H, channels: 1 } })
    .blur(2).toColourspace("b-w").raw().toBuffer();

  const core = await renderDiffHeatmap(refBlur, candBlur, W, H, opts.diffThreshold ?? 25);
  return {
    width: W,
    height: H,
    heatmapPng: core.heatmapPng,
    hotspots: core.hotspots,
    totalDiffPixels: core.totalDiffPixels,
    diffRatio: core.diffRatio,
    diffScore: Number((core.diffRatio * 100).toFixed(2)),
    normalized: normalize,
    aligned: alignment?.aligned ?? false,
    alignment,
  };
}

export interface GoldenDiffForKeyResult extends GoldenDiffResult {
  golden: {
    id: number;
    version: number;
    productCode: string | null;
    recipeCode: string | null;
    stationCode: string | null;
    roiKey: string | null;
    matchedLevel: "exact" | "product";
    alignBeforeDiff: boolean;
    status: string;
  };
}

/**
 * Resolve the ACTIVE APPROVED golden for a key (exact → product-level fallback,
 * W5-B resolver) and diff the candidate against it. Alignment runs when the
 * golden row's `alignBeforeDiff` is true AND the ALIGN_BEFORE_DIFF env kill-switch
 * is not "false". Returns null when no approved golden exists (honest — caller
 * decides how to surface "no golden").
 */
export async function goldenDiffForKey(
  key: { productCode?: string | null; recipeCode?: string | null; stationCode?: string | null; roiKey?: string | null },
  candidate: Buffer,
  opts: { normalize?: boolean; diffThreshold?: number; fallbackToProductLevel?: boolean } = {},
): Promise<GoldenDiffForKeyResult | null> {
  const { resolveActiveReference, decodeReference } = await import("./goldenSampleService");
  const resolved = await resolveActiveReference(key, {
    fallbackToProductLevel: opts.fallbackToProductLevel ?? true,
  });
  if (!resolved) return null;
  const { row, matchedLevel } = resolved;

  const goldenGray = decodeReference({
    grayBase64: row.grayBase64,
    width: row.width,
    height: row.height,
    format: "gray-raw",
  });
  const align = row.alignBeforeDiff !== false && !ALIGN_KILLED_GLOBALLY;
  const result = await goldenDiffAgainstGray(goldenGray, candidate, {
    normalize: opts.normalize,
    align,
    diffThreshold: opts.diffThreshold,
  });
  return {
    ...result,
    golden: {
      id: row.id,
      version: row.version,
      productCode: row.productCode,
      recipeCode: row.recipeCode,
      stationCode: row.stationCode,
      roiKey: row.roiKey,
      matchedLevel,
      alignBeforeDiff: row.alignBeforeDiff,
      status: row.status,
    },
  };
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
  // W7-C fix — pin single-channel output (see generateDefectHeatmap comment).
  const aResized = (await sharp(a.data, { raw: { width: a.width, height: a.height, channels: 1 } })
    .resize(W, H, { fit: "fill" }).toColourspace("b-w").raw().toBuffer());
  const bResizedRaw = (await sharp(b.data, { raw: { width: b.width, height: b.height, channels: 1 } })
    .resize(W, H, { fit: "fill" }).toColourspace("b-w").raw().toBuffer());

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
  // W7-C fix — .toColourspace("b-w") pins single-channel output: sharp raw
  // pipelines otherwise promote to 3-channel sRGB, which previously made these
  // planes 3×W×H (diff values were still correct per byte since channels are
  // replicated, but heatmap geometry and the alignment input were scrambled).
  const aR = await sharp(a.data, { raw: { width: a.width, height: a.height, channels: 1 } })
    .resize(W, H, { fit: "fill" }).blur(2).toColourspace("b-w").raw().toBuffer();
  const bRraw = await sharp(b.data, { raw: { width: b.width, height: b.height, channels: 1 } })
    .resize(W, H, { fit: "fill" }).blur(2).toColourspace("b-w").raw().toBuffer();

  // B4.2 — căn candidate (bR) ↔ reference (aR) trước diff nếu cờ bật.
  const { candData: bR, info: alignment } = await maybeAlign(
    { data: aR, width: W, height: H },
    { data: bRraw, width: W, height: H },
  );

  // W7-C — diff core extracted to renderDiffHeatmap (shared with goldenDiff);
  // behavior identical to the previous inline block.
  const core = await renderDiffHeatmap(aR, bR, W, H, 25);

  return {
    width: W,
    height: H,
    heatmapPng: core.heatmapPng,
    hotspots: core.hotspots,
    totalDiffPixels: core.totalDiffPixels,
    diffRatio: core.diffRatio,
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

/**
 * B3.3 — Crop an image to its detected ROI before sending to a VL model.
 *
 * Ảnh AOI thường lớn, vùng quan tâm (linh kiện/mối hàn) chỉ chiếm một phần →
 * `autoDetectRoi` (edge-density bounding box) cắt ROI để VL nhận ảnh nhỏ hơn:
 *   • nhanh hơn (ít pixel/token),
 *   • chính xác hơn (loại nền/khoảng trống gây nhiễu).
 *
 * Degrade trung thực: nếu ROI suy biến (cả ảnh, edgeDensity 0, hoặc nhỏ hơn
 * `minAreaRatio` của ảnh → nghi ngờ phát hiện sai) → trả NGUYÊN ảnh gốc, cờ
 * `cropped:false`. Không bao giờ ném ra (best-effort tiền-xử-lý).
 */
export async function cropToRoiForVision(
  image: Buffer,
  opts: { padRatio?: number; minAreaRatio?: number } = {},
): Promise<{ buffer: Buffer; cropped: boolean; roi: RoiBox | null }> {
  try {
    const meta = await sharp(image).metadata();
    const fullW = meta.width ?? 0;
    const fullH = meta.height ?? 0;
    if (!fullW || !fullH) return { buffer: image, cropped: false, roi: null };

    // autoDetectRoi chạy trên ảnh đã downscale (toGrayRaw → MAX_DIM, fit "inside",
    // GIỮ tỉ lệ khung hình). Tọa độ ROI nằm trong không gian downscale đó → suy hệ
    // số scale về ảnh GỐC. Vì fit "inside" giữ tỉ lệ, sx ≈ sy → dùng một hệ số chung.
    const roi = await autoDetectRoi(image);
    if (roi.edgeDensity <= 0) return { buffer: image, cropped: false, roi };

    // Kích thước không gian downscale (cùng công thức "inside" của toGrayRaw).
    const overMax = fullW > MAX_DIM || fullH > MAX_DIM;
    const fitScale = overMax ? MAX_DIM / Math.max(fullW, fullH) : 1;
    const dsW = Math.max(1, Math.round(fullW * fitScale));
    const dsH = Math.max(1, Math.round(fullH * fitScale));
    const sx = fullW / dsW;
    const sy = fullH / dsH;

    let left = Math.round(roi.x * sx);
    let top = Math.round(roi.y * sy);
    let cw = Math.round(roi.width * sx);
    let ch = Math.round(roi.height * sy);

    // Clamp về biên ảnh gốc.
    left = Math.max(0, Math.min(left, fullW - 1));
    top = Math.max(0, Math.min(top, fullH - 1));
    cw = Math.max(1, Math.min(cw, fullW - left));
    ch = Math.max(1, Math.min(ch, fullH - top));

    const areaRatio = (cw * ch) / (fullW * fullH);
    const minAreaRatio = opts.minAreaRatio ?? 0.02;
    // ROI ~ cả ảnh (>95%) hoặc quá nhỏ (<minAreaRatio, nghi sai) → dùng ảnh gốc.
    if (areaRatio >= 0.95 || areaRatio < minAreaRatio) {
      return { buffer: image, cropped: false, roi };
    }

    const cropped = await sharp(image)
      .extract({ left, top, width: cw, height: ch })
      .jpeg({ quality: 90 })
      .toBuffer();
    return { buffer: cropped, cropped: true, roi };
  } catch {
    // Bất kỳ lỗi sharp/decode → ảnh gốc (degrade trung thực).
    return { buffer: image, cropped: false, roi: null };
  }
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
