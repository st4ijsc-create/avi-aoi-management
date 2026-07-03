/**
 * AOI Tier-2 — PATCH-LEVEL (pixel-localizing) anomaly detection.
 *
 * Upgrades the WHOLE-IMAGE PatchCore (aiAnomalyDetection.ts: one embedding →
 * one kNN score) to canonical PatchCore behaviour:
 *
 *   patch-memory (tile OK images → embed each patch → coreset memory bank)
 *   + per-patch kNN scoring on a test image
 *   → a low-res anomaly map
 *   → BILINEAR UPSAMPLE to image resolution = a PIXEL HEATMAP that LOCALIZES the
 *     defect (not just a scalar), plus hotspot regions (threshold + connected
 *     components + reuse of the sub-pixel metrology in aiMetrology.ts).
 *
 * ADDITIVE + FLAGGED: everything here is gated by ANOMALY_PATCH_ENABLED (default
 * OFF). When OFF the existing whole-image path in aiAnomalyDetection.ts is byte-
 * for-byte unchanged — scoreImage() only augments its result with a `patch` field
 * when the flag is ON and a patch bank exists.
 *
 * HONEST DEGRADE: reuses the same 3-tier embedding ladder (onnx → text-of-image →
 * heuristic sharp) via getEmbeddingForAnomaly. When no ONNX model / no GGUF, patch
 * embeddings degrade to a fast pure-JS handcrafted tiled feature (no fabrication;
 * every result carries source/degraded/tier). Pure-JS CV + `sharp` only (no OpenCV).
 *
 * The image-level score (max over the patch map) is preserved so callers that only
 * read a scalar keep working; the heatmap + hotspots are extra.
 *
 * UI OVERLAY ATTACH POINTS (no UI built here — see REPORT): the `patch.heatmap`
 * (base64 PNG / normalized array) + `patch.hotspots` (bbox + peak) render as an
 * overlay on client/src/pages/AnomalyBankPage.tsx (per-scope diagnostics) and on
 * the inspection image viewer (InspectionDetail) — draw the PNG at 50% alpha over
 * the source frame and stroke each hotspot bbox.
 */
import sharp from "sharp";
import {
  getEmbeddingForAnomaly,
  buildBankFromVectors,
  knnScore,
  type EmbeddingSource,
} from "./aiAnomalyDetection";
import { l2normalize } from "./aiImageEmbedding";
import { measureMask, type MaskGrid, type MetrologyResult } from "./aiMetrology";
import {
  loadBank,
  getProfile,
  type AnomalyScope,
} from "../db/aiAnomaly";

// ─── Config (env, safe defaults) ───────────────────────────────────────────────

/** Patch grid NxN (canonical PatchCore tiling). Clamp 2..32. Default 8 → 64 patches. */
const PATCH_GRID = Math.max(2, Math.min(Math.round(Number(process.env.ANOMALY_PATCH_GRID ?? 8)), 32));
/** k for per-patch mean-of-k kNN. Patches are noisier than whole images → small k. */
const PATCH_KNN_K = Math.max(1, Math.min(Number(process.env.ANOMALY_PATCH_KNN_K ?? 3), 50));
/** Coreset ratio for the patch bank (patches are cheap → keep more than whole-image). */
const PATCH_CORESET_RATIO = Math.max(0.01, Math.min(Number(process.env.ANOMALY_PATCH_CORESET_RATIO ?? 0.5), 1));
/** Upsample the low-res map to this max dimension (heatmap resolution). Clamp 32..1024. */
const HEATMAP_MAX_DIM = Math.max(32, Math.min(Math.round(Number(process.env.ANOMALY_PATCH_HEATMAP_DIM ?? 256)), 1024));
/** Bank scan limit when loading the patch memory (protect RAM/CPU brute-force JS). */
const PATCH_BANK_SCAN_LIMIT = Math.max(50, Math.min(Number(process.env.ANOMALY_PATCH_BANK_SCAN_LIMIT ?? 20000), 200000));
/** Max hotspot regions returned (kept by peak score). */
const MAX_HOTSPOTS = Math.max(1, Math.min(Number(process.env.ANOMALY_PATCH_MAX_HOTSPOTS ?? 8), 64));
/** Minimum area (heatmap px) for a region to count as a hotspot (noise filter). */
const MIN_HOTSPOT_PX = Math.max(1, Number(process.env.ANOMALY_PATCH_MIN_HOTSPOT_PX ?? 4));

/** Handcrafted per-patch feature layout (heuristic tier, fast tiled extractor). */
const PATCH_HIST_BINS = 8;
/** Internal decode resolution for the heuristic tiled extractor (≈128, cell-aligned). */
const HEURISTIC_WORK = 128;
const EDGE_THRESHOLD = 32; // gradient magnitude threshold (0..255)

/** Master flag. ANOMALY_PATCH_ENABLED=true → scoreImage augments with a patch heatmap. */
export function isPatchAnomalyEnabled(): boolean {
  return (process.env.ANOMALY_PATCH_ENABLED ?? "false").toLowerCase() === "true";
}

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface PatchHotspot {
  /** Bounding box in HEATMAP (upsampled) pixel coordinates. */
  bbox: { x: number; y: number; w: number; h: number };
  /** Peak raw kNN distance (anomaly score) inside the region — comparable to threshold. */
  peakScore: number;
  /** Area in heatmap pixels (connected-component size). */
  areaPx: number;
  /** Centroid in heatmap pixel coordinates. */
  centroid: { x: number; y: number };
  /** Sub-pixel metrology of the region (reuses aiMetrology.measureMask). */
  metrology: MetrologyResult;
}

export interface PatchHeatmap {
  /** Patch grid used (NxN). */
  grid: number;
  /** Low-res map = per-patch scores (row-major, index = gy*grid+gx). */
  lowRes: {
    width: number;
    height: number;
    /** Normalized 0..1 (raw / denom) for display. */
    data: number[];
    /** Raw kNN distances (same units as threshold). */
    raw: number[];
  };
  /** Upsampled heatmap dimensions. */
  width: number;
  height: number;
  /** Normalization denominator used (max(mapMax, threshold)). */
  denom: number;
  /** Full-res normalized 0..1 array (row-major) — only when opts.includeHeatmapArray. */
  data?: number[];
  /** Grayscale heatmap PNG (base64, no data-uri prefix) — only when opts.includeHeatmapPng. */
  pngBase64?: string;
}

export interface PatchScoreResult {
  enabled: boolean;
  /** Image-level score = max over the patch map (canonical PatchCore image score). */
  imageScore: number;
  isAnomaly: boolean;
  threshold: number | null;
  source: EmbeddingSource | "none";
  degraded: boolean;
  /** Honest tier label (same as source; "none" when no bank/profile). */
  tier: EmbeddingSource | "none";
  bankSize: number;
  k: number;
  grid: number;
  patchCount: number;
  heatmap: PatchHeatmap | null;
  hotspots: PatchHotspot[];
  /** Machine-readable reason when degraded/empty. */
  reason?: string;
}

export interface PatchEmbedResult {
  /** grid*grid patch vectors, row-major (index = gy*grid+gx), each L2-normalized. */
  vectors: number[][];
  source: EmbeddingSource;
  degraded: boolean;
  grid: number;
}

// ─── Scope / modelCode helper ────────────────────────────────────────────────────

/**
 * modelCode scope-key for the PATCH bank. Kept DISTINCT from the whole-image bank
 * (which uses "anomaly:<source>[:id]") by the ":patch:" segment, and carries the
 * grid size so scoring only matches a bank built at the same tiling.
 *   onnx          → "anomaly:patch:onnx:<modelId>:g<grid>"
 *   text-of-image → "anomaly:patch:text-of-image:g<grid>"
 *   heuristic     → "anomaly:patch:heuristic:g<grid>"
 */
export function patchAnomalyModelCode(source: EmbeddingSource, modelId: number | null, grid: number): string {
  if (source === "onnx" && modelId != null) return `anomaly:patch:onnx:${modelId}:g${grid}`;
  return `anomaly:patch:${source}:g${grid}`;
}

// ─── Heuristic tiled feature extractor (fast — ONE sharp decode, no per-patch crop) ──

/**
 * Extract a per-patch handcrafted feature vector for every cell of a grid×grid
 * tiling, from a SINGLE grayscale decode. Each patch vector (L2-normalized) mixes:
 *   • intensity histogram (PATCH_HIST_BINS bins, normalized by cell pixel count)
 *   • mean intensity
 *   • Laplacian variance (soft-normalized) — local texture / sharpness
 *   • edge density — fraction of pixels above a gradient threshold
 *   • mean gradient magnitude
 *
 * Row-major output (index = gy*grid + gx). Sensitive to local intensity/texture/
 * edge change → a defect patch differs from the OK patch distribution → high kNN
 * distance at that location. Honest degrade: this is the fallback tier (no deep model).
 */
export async function extractPatchFeatureGrid(imageBuffer: Buffer, grid: number): Promise<number[][]> {
  const G = Math.max(2, Math.min(Math.round(grid), 64));
  const cell = Math.max(4, Math.round(HEURISTIC_WORK / G));
  const W = cell * G;
  const H = cell * G;

  const { data } = await sharp(imageBuffer)
    .removeAlpha()
    .grayscale()
    .resize(W, H, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const gray = data; // 1 channel, length W*H
  const cellOf = (x: number, y: number) => (Math.min(G - 1, Math.floor(y / cell)) * G + Math.min(G - 1, Math.floor(x / cell)));
  const at = (x: number, y: number) => gray[y * W + x];

  const nCells = G * G;
  const hist = Array.from({ length: nCells }, () => new Float64Array(PATCH_HIST_BINS));
  const intSum = new Float64Array(nCells);
  const pxCount = new Float64Array(nCells);
  const lapSum = new Float64Array(nCells);
  const lapSumSq = new Float64Array(nCells);
  const lapCount = new Float64Array(nCells);
  const edgeHit = new Float64Array(nCells);
  const gradSum = new Float64Array(nCells);
  const gradCount = new Float64Array(nCells);

  // 1) Histogram + mean intensity per cell (all pixels).
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = cellOf(x, y);
      const v = at(x, y);
      const bin = Math.min(PATCH_HIST_BINS - 1, Math.floor((v / 256) * PATCH_HIST_BINS));
      hist[c][bin]++;
      intSum[c] += v;
      pxCount[c]++;
    }
  }

  // 2) Laplacian variance + edge density + mean gradient per cell (interior pixels).
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const c = cellOf(x, y);
      const ctr = at(x, y);
      const lap = at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1) - 4 * ctr;
      lapSum[c] += lap;
      lapSumSq[c] += lap * lap;
      lapCount[c]++;
      const gx = at(x + 1, y) - at(x - 1, y);
      const gy = at(x, y + 1) - at(x, y - 1);
      const mag = Math.sqrt(gx * gx + gy * gy);
      if (mag >= EDGE_THRESHOLD) edgeHit[c]++;
      gradSum[c] += mag;
      gradCount[c]++;
    }
  }

  const vectors: number[][] = [];
  for (let c = 0; c < nCells; c++) {
    const px = pxCount[c] || 1;
    const raw: number[] = [];
    for (let b = 0; b < PATCH_HIST_BINS; b++) raw.push(hist[c][b] / px);
    raw.push(intSum[c] / px / 255); // mean intensity ∈ [0,1]
    const ln = lapCount[c] || 1;
    const lmean = lapSum[c] / ln;
    const lvar = Math.max(0, lapSumSq[c] / ln - lmean * lmean);
    raw.push(lvar / (lvar + 1000)); // soft-normalized texture
    raw.push(edgeHit[c] / (gradCount[c] || 1)); // edge density
    raw.push(gradSum[c] / (gradCount[c] || 1) / 255); // mean gradient ∈ [0,1]
    vectors.push(l2normalize(raw));
  }
  return vectors;
}

// ─── Model-tier per-patch crop (reuse the embedding pipeline honestly) ───────────

/** Crop a grid×grid tiling into grid*grid PNG buffers (row-major) via sharp extract. */
export async function cropPatchBuffers(imageBuffer: Buffer, grid: number): Promise<Buffer[]> {
  const G = Math.max(2, Math.min(Math.round(grid), 64));
  const meta = await sharp(imageBuffer).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (W < G || H < G) throw new Error(`image ${W}x${H} too small for a ${G}x${G} patch grid`);
  const cellW = Math.floor(W / G);
  const cellH = Math.floor(H / G);
  const out: Buffer[] = [];
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      const left = gx * cellW;
      const top = gy * cellH;
      const w = gx === G - 1 ? W - left : cellW;
      const h = gy === G - 1 ? H - top : cellH;
      // Fresh sharp instance per crop (extract is stateful).
      const buf = await sharp(imageBuffer).extract({ left, top, width: w, height: h }).png().toBuffer();
      out.push(buf);
    }
  }
  return out;
}

/** Reduce per-patch embedding sources to one primary tier (degrade-lowest wins). */
function primaryPatchSource(votes: Record<EmbeddingSource, number>, total: number): EmbeddingSource {
  if (votes.onnx >= total) return "onnx";
  if (votes.heuristic > 0) return "heuristic";
  if (votes["text-of-image"] > 0) return "text-of-image";
  return "heuristic";
}

/**
 * Embed every patch of an image. Tier decided ONCE for the whole image so all patch
 * vectors live in the same space (kNN meaningful):
 *   • modelId set OR GGUF available → crop each patch, embed via getEmbeddingForAnomaly
 *     (real per-patch deep features). If any patch fails / dims disagree → degrade the
 *     WHOLE image to the heuristic fast path (honest, dim-consistent).
 *   • otherwise → heuristic tiled fast path.
 */
export async function embedPatches(
  imageBuffer: Buffer,
  grid: number,
  opts: { modelId?: number | null } = {},
): Promise<PatchEmbedResult> {
  const modelId = opts.modelId ?? null;
  let useModel = modelId != null;
  if (!useModel) {
    try {
      const { isGgufAvailable } = await import("./aiGgufEngine");
      useModel = await isGgufAvailable();
    } catch {
      useModel = false;
    }
  }

  if (useModel) {
    try {
      const buffers = await cropPatchBuffers(imageBuffer, grid);
      const votes: Record<EmbeddingSource, number> = { onnx: 0, "text-of-image": 0, heuristic: 0 };
      const vectors: number[][] = [];
      for (const pb of buffers) {
        const e = await getEmbeddingForAnomaly(pb, { modelId });
        vectors.push(e.vector);
        votes[e.source]++;
      }
      const dims = new Set(vectors.map((v) => v.length));
      if (vectors.length === grid * grid && dims.size === 1 && vectors[0].length > 0) {
        const source = primaryPatchSource(votes, vectors.length);
        return { vectors, source, degraded: source !== "onnx", grid };
      }
      console.warn("[aiPatchAnomaly] model-tier patch embeddings inconsistent → degrading to heuristic tier");
    } catch (e) {
      console.warn("[aiPatchAnomaly] model-tier patch embed failed, degrading to heuristic:", (e as Error)?.message);
    }
  }

  const vectors = await extractPatchFeatureGrid(imageBuffer, grid);
  return { vectors, source: "heuristic", degraded: true, grid };
}

// ─── Build patch memory bank (additive alongside the whole-image bank) ───────────

export interface BuildPatchBankParams {
  productModelId?: number | null;
  machineId?: number | null;
  modelId?: number | null;
  images: Array<{ buffer: Buffer; imageUrl?: string | null }>;
  grid?: number;
  coresetRatio?: number;
  k?: number;
}

export interface BuildPatchBankResult {
  scope: AnomalyScope;
  grid: number;
  bankSize: number;
  rawPatchCount: number;
  threshold: number;
  k: number;
  source: EmbeddingSource;
  degraded: boolean;
  imagesEmbedded: number;
  embedFailures: number;
}

/**
 * Build a PATCH memory bank from OK images:
 *   1. tile each image → embed every patch (one tier for the whole image).
 *   2. POOL all patches (all positions, all images) — canonical PatchCore memory.
 *   3. reuse buildBankFromVectors (greedy farthest-point coreset + p99 internal
 *      threshold + upsertProfile) under a patch-scoped modelCode.
 *
 * The internal-distance threshold becomes the PER-PATCH anomaly threshold used by
 * the heatmap. Additive: does not touch the whole-image bank/profile.
 */
export async function buildPatchMemoryBank(params: BuildPatchBankParams): Promise<BuildPatchBankResult> {
  const grid = Math.max(2, Math.min(Math.round(params.grid ?? PATCH_GRID), 32));
  const k = params.k ?? PATCH_KNN_K;
  const coresetRatio = params.coresetRatio ?? PATCH_CORESET_RATIO;

  const pooled: number[][] = [];
  const votes: Record<EmbeddingSource, number> = { onnx: 0, "text-of-image": 0, heuristic: 0 };
  let imagesEmbedded = 0;
  let embedFailures = 0;

  for (const img of params.images) {
    try {
      const emb = await embedPatches(img.buffer, grid, { modelId: params.modelId ?? null });
      for (const v of emb.vectors) pooled.push(v);
      votes[emb.source] += emb.vectors.length;
      imagesEmbedded++;
    } catch (e) {
      embedFailures++;
      console.warn("[aiPatchAnomaly] buildPatchMemoryBank: skip image (embed failed):", (e as Error)?.message);
    }
  }

  if (pooled.length === 0) {
    throw new Error("No patch vectors could be embedded for the patch memory bank");
  }

  const source = primaryPatchSource(votes, pooled.length);
  const scope: AnomalyScope = {
    productModelId: params.productModelId ?? null,
    machineId: params.machineId ?? null,
    modelCode: patchAnomalyModelCode(source, params.modelId ?? null, grid),
  };

  const core = await buildBankFromVectors({
    vectors: pooled.map((vector) => ({ vector, imageUrl: null })),
    scope,
    source,
    degraded: source !== "onnx",
    coresetRatio,
    k,
  });

  return {
    scope,
    grid,
    bankSize: core.bankSize,
    rawPatchCount: pooled.length,
    threshold: core.threshold,
    k: core.k,
    source: core.source,
    degraded: core.degraded,
    imagesEmbedded,
    embedFailures,
  };
}

// ─── Pure math: per-patch scoring, bilinear upsample, connected components ────────

/** Per-patch score map = mean-of-k kNN distance of each patch to the bank (same dim). */
export function scorePatchMap(patchVectors: number[][], bank: number[][], k: number): number[] {
  if (patchVectors.length === 0) return [];
  const dim = patchVectors[0].length;
  const sameDimBank = bank.filter((v) => v.length === dim);
  return patchVectors.map((v) => knnScore(v, sameDimBank, k));
}

/**
 * Bilinear upsample a low-res map (gw×gh) to (outW×outH). Standard half-pixel
 * center mapping so patch centers land at the right place. Returns row-major.
 */
export function bilinearUpsample(low: number[], gw: number, gh: number, outW: number, outH: number): number[] {
  const out = new Array<number>(outW * outH);
  const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
  for (let oy = 0; oy < outH; oy++) {
    const sy = clamp(((oy + 0.5) * gh) / outH - 0.5, 0, gh - 1);
    const y0 = Math.floor(sy);
    const y1 = Math.min(gh - 1, y0 + 1);
    const fy = sy - y0;
    for (let ox = 0; ox < outW; ox++) {
      const sx = clamp(((ox + 0.5) * gw) / outW - 0.5, 0, gw - 1);
      const x0 = Math.floor(sx);
      const x1 = Math.min(gw - 1, x0 + 1);
      const fx = sx - x0;
      const v00 = low[y0 * gw + x0];
      const v01 = low[y0 * gw + x1];
      const v10 = low[y1 * gw + x0];
      const v11 = low[y1 * gw + x1];
      const top = v00 * (1 - fx) + v01 * fx;
      const bot = v10 * (1 - fx) + v11 * fx;
      out[oy * outW + ox] = top * (1 - fy) + bot * fy;
    }
  }
  return out;
}

interface CCRegion {
  label: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  count: number;
  sumX: number;
  sumY: number;
  peak: number;
}

/**
 * 4-connectivity connected components over a binary mask. Returns one region record
 * per component (bbox + pixel count + centroid accumulators + peak of `scores`).
 * Iterative stack flood-fill (no recursion → safe for large maps).
 */
export function connectedComponentRegions(
  binary: Uint8Array | number[],
  scores: number[],
  w: number,
  h: number,
): CCRegion[] {
  const labels = new Int32Array(w * h).fill(0);
  const regions: CCRegion[] = [];
  let next = 1;
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!binary[start] || labels[start] !== 0) continue;
    const label = next++;
    const region: CCRegion = {
      label,
      minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity,
      count: 0, sumX: 0, sumY: 0, peak: -Infinity,
    };
    stack.length = 0;
    stack.push(start);
    labels[start] = label;
    while (stack.length > 0) {
      const p = stack.pop() as number;
      const x = p % w;
      const y = (p - x) / w;
      region.count++;
      region.sumX += x;
      region.sumY += y;
      if (x < region.minX) region.minX = x;
      if (y < region.minY) region.minY = y;
      if (x > region.maxX) region.maxX = x;
      if (y > region.maxY) region.maxY = y;
      if (scores[p] > region.peak) region.peak = scores[p];
      // 4-neighbours
      if (x > 0) { const q = p - 1; if (binary[q] && labels[q] === 0) { labels[q] = label; stack.push(q); } }
      if (x < w - 1) { const q = p + 1; if (binary[q] && labels[q] === 0) { labels[q] = label; stack.push(q); } }
      if (y > 0) { const q = p - w; if (binary[q] && labels[q] === 0) { labels[q] = label; stack.push(q); } }
      if (y < h - 1) { const q = p + w; if (binary[q] && labels[q] === 0) { labels[q] = label; stack.push(q); } }
    }
    regions.push(region);
  }
  return regions;
}

/**
 * Threshold an upsampled RAW score map at `thresholdRaw`, find connected hotspot
 * regions, and (reusing aiMetrology.measureMask) attach sub-pixel metrology per
 * region. Sorted by peak score, capped at MAX_HOTSPOTS, filtered by MIN_HOTSPOT_PX.
 */
export function extractHotspots(
  rawUpsampled: number[],
  w: number,
  h: number,
  thresholdRaw: number,
  opts: { umPerPx?: number | null; maxHotspots?: number; minAreaPx?: number } = {},
): PatchHotspot[] {
  const maxHotspots = opts.maxHotspots ?? MAX_HOTSPOTS;
  const minAreaPx = opts.minAreaPx ?? MIN_HOTSPOT_PX;
  const binary = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) binary[i] = rawUpsampled[i] > thresholdRaw ? 1 : 0;

  const regions = connectedComponentRegions(binary, rawUpsampled, w, h)
    .filter((r) => r.count >= minAreaPx)
    .sort((a, b) => b.peak - a.peak)
    .slice(0, maxHotspots);

  return regions.map((r) => {
    const bw = r.maxX - r.minX + 1;
    const bh = r.maxY - r.minY + 1;
    // Build a binary sub-mask over the bbox for metrology (reuse measureMask).
    const sub = new Float32Array(bw * bh);
    for (let i = 0; i < w * h; i++) {
      if (!binary[i]) continue;
      const x = i % w;
      const y = (i - x) / w;
      if (x < r.minX || x > r.maxX || y < r.minY || y > r.maxY) continue;
      sub[(y - r.minY) * bw + (x - r.minX)] = 1;
    }
    const grid: MaskGrid = { data: sub, width: bw, height: bh };
    const metrology = measureMask(grid, opts.umPerPx ?? null);
    // Offset metrology bbox back into full heatmap coordinates.
    metrology.bbox = { x: metrology.bbox.x + r.minX, y: metrology.bbox.y + r.minY, w: metrology.bbox.w, h: metrology.bbox.h };
    return {
      bbox: { x: r.minX, y: r.minY, w: bw, h: bh },
      peakScore: Number(r.peak.toFixed(6)),
      areaPx: r.count,
      centroid: { x: Number((r.sumX / r.count).toFixed(2)), y: Number((r.sumY / r.count).toFixed(2)) },
      metrology,
    };
  });
}

/** Render a normalized 0..1 array → grayscale PNG (base64, no data-uri prefix). */
async function heatmapToPngBase64(norm: number[], w: number, h: number): Promise<string> {
  const gray = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) {
    const v = norm[i] <= 0 ? 0 : norm[i] >= 1 ? 255 : Math.round(norm[i] * 255);
    gray[i] = v;
  }
  const png = await sharp(gray, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
  return png.toString("base64");
}

// ─── Score a test image → heatmap + hotspots (the localization path) ─────────────

export interface PatchScoreParams {
  buffer: Buffer;
  productModelId?: number | null;
  machineId?: number | null;
  modelId?: number | null;
  grid?: number;
  /** Include the full-res normalized heatmap array in the result (larger payload). */
  includeHeatmapArray?: boolean;
  /** Include a base64 grayscale heatmap PNG in the result (for UI overlay). */
  includeHeatmapPng?: boolean;
  /** µm/px for hotspot metrology (optional; absent → px + degraded metrology). */
  umPerPx?: number | null;
}

function safeResult(
  partial: Partial<PatchScoreResult> & { source: EmbeddingSource | "none"; reason: string; grid: number; patchCount: number; k: number },
): PatchScoreResult {
  return {
    enabled: isPatchAnomalyEnabled(),
    imageScore: 0,
    isAnomaly: false,
    threshold: partial.threshold ?? null,
    source: partial.source,
    degraded: true,
    tier: partial.source,
    bankSize: partial.bankSize ?? 0,
    k: partial.k,
    grid: partial.grid,
    patchCount: partial.patchCount,
    heatmap: null,
    hotspots: [],
    reason: partial.reason,
  };
}

/**
 * Patch-level scoring of a test image:
 *   1. tile + embed patches (honest tier).
 *   2. load the patch bank/profile for the matching scope.
 *   3. per-patch kNN → low-res map → BILINEAR UPSAMPLE → pixel heatmap.
 *   4. image-level score = max patch score (preserves whole-image semantics);
 *      isAnomaly = imageScore > profile threshold.
 *   5. hotspot regions (threshold + connected components + metrology).
 *
 * Fail-safe like scoreFromVector: DB null / no profile / empty bank / dim mismatch →
 * a safe result (isAnomaly false, heatmap null, clear reason), never throws.
 */
export async function scoreImagePatch(params: PatchScoreParams): Promise<PatchScoreResult> {
  const grid = Math.max(2, Math.min(Math.round(params.grid ?? PATCH_GRID), 32));
  const patchCount = grid * grid;

  // 1) Embed patches (own try — embedding must not throw out of the hot path).
  let emb: PatchEmbedResult;
  try {
    emb = await embedPatches(params.buffer, grid, { modelId: params.modelId ?? null });
  } catch (e) {
    return safeResult({ source: "none", reason: `patch_embed_failed:${(e as Error)?.message ?? "unknown"}`, grid, patchCount, k: PATCH_KNN_K });
  }

  const scope: AnomalyScope = {
    productModelId: params.productModelId ?? null,
    machineId: params.machineId ?? null,
    modelCode: patchAnomalyModelCode(emb.source, params.modelId ?? null, grid),
  };

  // 2) Load bank + profile (fail-safe).
  let profile: Awaited<ReturnType<typeof getProfile>> = null;
  let bank: number[][] = [];
  try {
    profile = await getProfile(scope);
    bank = await loadBank(scope, PATCH_BANK_SCAN_LIMIT);
  } catch (e) {
    return safeResult({ source: emb.source, reason: `patch_bank_unavailable:${(e as Error)?.message ?? "db"}`, grid, patchCount, k: PATCH_KNN_K });
  }
  if (!profile || bank.length === 0) {
    return safeResult({
      source: emb.source,
      reason: !profile ? "no_patch_profile" : "empty_patch_bank",
      threshold: profile ? Number(profile.threshold) : null,
      grid, patchCount, k: profile?.k ?? PATCH_KNN_K,
    });
  }

  const k = profile.k ?? PATCH_KNN_K;
  const dim = emb.vectors[0]?.length ?? 0;
  const sameDimBank = bank.filter((v) => v.length === dim);
  if (dim === 0 || sameDimBank.length === 0) {
    return safeResult({ source: emb.source, reason: "patch_dim_mismatch", threshold: Number(profile.threshold), bankSize: bank.length, grid, patchCount, k });
  }

  const threshold = Number(profile.threshold);

  // 3) Per-patch scores → low-res map.
  const lowRaw = scorePatchMap(emb.vectors, sameDimBank, k);
  const imageScore = lowRaw.reduce((m, v) => (v > m ? v : m), 0);
  const isAnomaly = imageScore > threshold;

  // Upsample dims: keep the grid aspect (square grid → square heatmap), capped.
  const outW = HEATMAP_MAX_DIM;
  const outH = HEATMAP_MAX_DIM;
  const upRaw = bilinearUpsample(lowRaw, grid, grid, outW, outH);

  // Normalize by max(mapMax, threshold) so a CLEAN image stays dark/flat (raw < threshold),
  // and a DEFECT peaks at 1 — honest, not auto-stretched to look anomalous.
  const mapMax = upRaw.reduce((m, v) => (v > m ? v : m), 0);
  const denom = Math.max(mapMax, threshold, 1e-9);
  const lowMax = Math.max(lowRaw.reduce((m, v) => (v > m ? v : m), 0), threshold, 1e-9);

  const hotspots = extractHotspots(upRaw, outW, outH, threshold, {
    umPerPx: params.umPerPx ?? null,
    maxHotspots: MAX_HOTSPOTS,
    minAreaPx: MIN_HOTSPOT_PX,
  });

  const heatmap: PatchHeatmap = {
    grid,
    lowRes: {
      width: grid,
      height: grid,
      data: lowRaw.map((v) => Number(Math.max(0, Math.min(1, v / lowMax)).toFixed(4))),
      raw: lowRaw.map((v) => Number(v.toFixed(6))),
    },
    width: outW,
    height: outH,
    denom: Number(denom.toFixed(6)),
  };

  const norm = upRaw.map((v) => (v <= 0 ? 0 : v >= denom ? 1 : v / denom));
  if (params.includeHeatmapArray) {
    heatmap.data = norm.map((v) => Number(v.toFixed(4)));
  }
  if (params.includeHeatmapPng) {
    try {
      heatmap.pngBase64 = await heatmapToPngBase64(norm, outW, outH);
    } catch (e) {
      console.warn("[aiPatchAnomaly] heatmap PNG render failed:", (e as Error)?.message);
    }
  }

  return {
    enabled: isPatchAnomalyEnabled(),
    imageScore: Number(imageScore.toFixed(6)),
    isAnomaly,
    threshold,
    source: emb.source,
    degraded: !!emb.degraded || !!profile.degraded,
    tier: emb.source,
    bankSize: sameDimBank.length,
    k,
    grid,
    patchCount,
    heatmap,
    hotspots,
  };
}
