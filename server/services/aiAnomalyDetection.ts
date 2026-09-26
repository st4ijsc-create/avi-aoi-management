/**
 * B3 — Unsupervised Anomaly Detection (PatchCore-style memory bank)
 *
 * Ý tưởng: thu thập embedding của ảnh OK vào một "memory bank" (đã coreset
 * subsample), rồi cho ảnh test → kNN distance tới bank. Nếu distance vượt
 * threshold (= percentile p99 của phân bố khoảng cách nội bộ bank) → anomaly.
 * KHÔNG cần nhãn lỗi → unsupervised.
 *
 * Nguồn embedding 3 tầng degrade trung thực (mọi tầng trả cờ source/degraded):
 *   1. ONNX  (extractEmbedding)          → source "onnx",          degraded false
 *   2. GGUF text-of-image (embedImageAsText) → source "text-of-image", degraded true
 *   3. heuristic sharp (handcrafted)     → source "heuristic",     degraded true
 *
 * Offline-first; backward-compatible (service mới, không đụng pipeline cũ);
 * degrade trung thực (không bịa kết quả — luôn báo rõ tầng đang dùng).
 */
import sharp from "sharp";
import {
  extractEmbedding,
  embedImageAsText,
  l2normalize,
  cosineSimilarity,
} from "./aiImageEmbedding";
import {
  insertBankRows,
  loadBank,
  clearBank,
  upsertProfile,
  getProfile,
  getBankStats,
  readStoredEmbeddings,
  writeAnomalyMetadata,
  type AnomalyScope,
  type ProfileInput,
} from "../db/aiAnomaly";
// Type-only import (erased at compile time → no runtime import cycle with the
// value imports aiPatchAnomaly makes back into this module).
import type { PatchScoreResult } from "./aiPatchAnomaly";

// ─── Cờ cấu hình (env, có default an toàn) ─────────────────────────────────────

/** Số chiều vector heuristic (cố định để cosine có nghĩa giữa các ảnh). */
const HEURISTIC_GRID = Math.max(2, Math.min(Number(process.env.ANOMALY_HEURISTIC_GRID ?? 4), 8)); // lưới NxN
const HEURISTIC_HIST_BINS = 16;
/** k cho kNN scoring (mean-of-k distance). */
const DEFAULT_KNN_K = Math.max(1, Math.min(Number(process.env.ANOMALY_KNN_K ?? 5), 50));
/** Giới hạn số dòng bank tải về khi scoring (bảo vệ RAM/CPU brute-force JS). */
const ANOMALY_BANK_SCAN_LIMIT = Math.max(50, Math.min(Number(process.env.ANOMALY_BANK_SCAN_LIMIT ?? 4000), 50000));
/** Percentile dùng cho threshold (p99 mặc định). */
const THRESHOLD_PERCENTILE = Math.max(50, Math.min(Number(process.env.ANOMALY_THRESHOLD_PCT ?? 99), 100));
/** Tỉ lệ coreset mặc định (greedy farthest-point subsample). */
const DEFAULT_CORESET_RATIO = Math.max(0.01, Math.min(Number(process.env.ANOMALY_CORESET_RATIO ?? 0.25), 1));

export type EmbeddingSource = "onnx" | "text-of-image" | "heuristic";

export interface AnomalyEmbedding {
  vector: number[];
  source: EmbeddingSource;
  degraded: boolean;
}

export interface AnomalyEmbeddingOpts {
  /** ONNX embedding model id. Khi có → tầng 1 (source "onnx"). */
  modelId?: number | null;
}

export interface ScoreResult {
  score: number;
  isAnomaly: boolean;
  threshold: number | null;
  source: EmbeddingSource | "none";
  degraded: boolean;
  bankSize: number;
  k: number;
  /** Lý do (i18n key-free, để router/UI map). */
  reason?: string;
  /**
   * PATCH-LEVEL localization (pixel heatmap + hotspots). ONLY present when
   * ANOMALY_PATCH_ENABLED=true AND a patch bank exists for the scope. Flag OFF →
   * undefined → whole-image behaviour byte-for-byte unchanged. Additive.
   */
  patch?: PatchScoreResult;
  /**
   * F3/D2 (doc69 G9) — true when `threshold` came from an ROC calibration
   * (`aiAnomalyCalibration.calibrateThreshold`, `ai_anomaly_profiles.calibratedThreshold`),
   * false when it's the fixed p99 self-distance (uncalibrated, the pre-existing
   * behaviour). Additive/informational only — does not change isAnomaly's meaning.
   */
  calibrated?: boolean;
}

export interface BuildBankResult {
  scope: AnomalyScope;
  bankSize: number;
  rawCount: number;
  threshold: number;
  k: number;
  source: EmbeddingSource;
  degraded: boolean;
  distStats: DistStats;
  embedFailures: number;
}

export interface DistStats {
  count: number;
  min: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
}

// ─── Distance helpers ──────────────────────────────────────────────────────────

/**
 * Khoảng cách cosine (1 - cosineSimilarity) ∈ [0,2]. Cả hai vector đã được
 * L2-normalize ở mọi tầng embedding → ổn định và so sánh được.
 */
export function cosineDistance(a: number[], b: number[]): number {
  return 1 - cosineSimilarity(a, b);
}

/** Quantile tuyến tính (đã sort tăng dần). p ∈ [0,100]. */
export function quantileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const clamped = Math.max(0, Math.min(p, 100));
  const idx = (clamped / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

export function computeDistStats(distances: number[]): DistStats {
  if (distances.length === 0) {
    return { count: 0, min: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 };
  }
  const sorted = [...distances].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    mean: sum / sorted.length,
    p50: quantileSorted(sorted, 50),
    p90: quantileSorted(sorted, 90),
    p95: quantileSorted(sorted, 95),
    p99: quantileSorted(sorted, 99),
    max: sorted[sorted.length - 1],
  };
}

// ─── Handcrafted features (sharp-only fallback) ───────────────────────────────

/**
 * Trích đặc trưng thủ công bằng sharp (không cần model). Vector cố định chiều,
 * đã L2-normalize:
 *   • Histogram cường độ grayscale (HEURISTIC_HIST_BINS bins, chuẩn hóa theo tổng).
 *   • Laplacian variance theo từng ô lưới GxG (đo độ nét/biến thiên cục bộ).
 *   • Edge-density theo từng ô lưới GxG (tỉ lệ pixel "cạnh" qua ngưỡng gradient).
 *
 * Nhạy với thay đổi kết cấu/độ sáng/cạnh cục bộ → đủ để phát hiện sai khác thô
 * khi KHÔNG có model thật. degrade trung thực: đây là fallback, không phải feature
 * học sâu.
 */
export async function extractHandcraftedFeatures(imageBuffer: Buffer): Promise<number[]> {
  const G = HEURISTIC_GRID;
  const targetW = 128;
  const targetH = 128;

  const { data, info } = await sharp(imageBuffer)
    .removeAlpha()
    .grayscale()
    .resize(targetW, targetH, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const gray = data; // 1 channel, length = w*h

  // 1) Histogram cường độ.
  const hist = new Array<number>(HEURISTIC_HIST_BINS).fill(0);
  for (let i = 0; i < gray.length; i++) {
    const bin = Math.min(HEURISTIC_HIST_BINS - 1, Math.floor((gray[i] / 256) * HEURISTIC_HIST_BINS));
    hist[bin]++;
  }
  const histSum = gray.length || 1;
  for (let b = 0; b < hist.length; b++) hist[b] /= histSum;

  // 2 & 3) Laplacian variance + edge-density theo ô lưới.
  // Tích lũy per-cell: sum/sumSq của Laplacian (variance) và đếm pixel cạnh.
  const cellLapSum = new Float64Array(G * G);
  const cellLapSumSq = new Float64Array(G * G);
  const cellLapCount = new Float64Array(G * G);
  const cellEdge = new Float64Array(G * G);
  const cellEdgeCount = new Float64Array(G * G);

  const at = (x: number, y: number) => gray[y * w + x];
  const EDGE_THRESHOLD = 32; // gradient magnitude threshold (0..255)

  for (let y = 1; y < h - 1; y++) {
    const cy = Math.min(G - 1, Math.floor((y / h) * G));
    for (let x = 1; x < w - 1; x++) {
      const cx = Math.min(G - 1, Math.floor((x / w) * G));
      const cell = cy * G + cx;
      const c = at(x, y);

      // Laplacian (4-neighbour).
      const lap = at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1) - 4 * c;
      cellLapSum[cell] += lap;
      cellLapSumSq[cell] += lap * lap;
      cellLapCount[cell]++;

      // Gradient magnitude (Sobel-lite: dx, dy bậc 1).
      const gx = at(x + 1, y) - at(x - 1, y);
      const gy = at(x, y + 1) - at(x, y - 1);
      const mag = Math.sqrt(gx * gx + gy * gy);
      if (mag >= EDGE_THRESHOLD) cellEdge[cell]++;
      cellEdgeCount[cell]++;
    }
  }

  const lapFeat: number[] = [];
  const edgeFeat: number[] = [];
  for (let i = 0; i < G * G; i++) {
    const n = cellLapCount[i] || 1;
    const mean = cellLapSum[i] / n;
    const variance = Math.max(0, cellLapSumSq[i] / n - mean * mean);
    // Chuẩn hóa mềm về [0,1) để cân bằng với histogram (variance có thể lớn).
    lapFeat.push(variance / (variance + 1000));
    edgeFeat.push(cellEdge[i] / (cellEdgeCount[i] || 1));
  }

  const raw = [...hist, ...lapFeat, ...edgeFeat];
  return l2normalize(raw);
}

// ─── 3-tier embedding ─────────────────────────────────────────────────────────

/**
 * Lấy embedding cho anomaly theo 3 tầng degrade:
 *   1. ONNX (nếu opts.modelId) — source "onnx", degraded false.
 *   2. GGUF text-of-image (nếu GGUF khả dụng) — source "text-of-image", degraded true.
 *   3. heuristic sharp — source "heuristic", degraded true (luôn chạy được offline).
 *
 * Mọi tầng trả vector ĐÃ L2-normalize → cosineDistance ổn định.
 */
export async function getEmbeddingForAnomaly(
  imageBuffer: Buffer,
  opts: AnomalyEmbeddingOpts = {},
): Promise<AnomalyEmbedding> {
  // Tầng 1 — ONNX.
  if (opts.modelId != null) {
    try {
      const r = await extractEmbedding(opts.modelId, imageBuffer);
      if (Array.isArray(r.embedding) && r.embedding.length > 0) {
        // extractEmbedding đã L2-normalize; normalize lại là idempotent + an toàn.
        return { vector: l2normalize(r.embedding), source: "onnx", degraded: false };
      }
    } catch (e) {
      console.warn("[aiAnomalyDetection] ONNX embedding failed, degrading:", (e as Error)?.message);
    }
  }

  // Tầng 2 — GGUF text-of-image (chỉ khi GGUF khả dụng để tránh ném/chậm vô ích).
  try {
    const { isGgufAvailable } = await import("./aiGgufEngine");
    if (await isGgufAvailable()) {
      const r = await embedImageAsText(imageBuffer);
      if (Array.isArray(r.embedding) && r.embedding.length > 0) {
        return { vector: l2normalize(r.embedding), source: "text-of-image", degraded: true };
      }
    }
  } catch (e) {
    console.warn("[aiAnomalyDetection] text-of-image embedding failed, degrading to heuristic:", (e as Error)?.message);
  }

  // Tầng 3 — heuristic sharp (luôn có).
  const vector = await extractHandcraftedFeatures(imageBuffer);
  return { vector, source: "heuristic", degraded: true };
}

// ─── Coreset subsample (greedy farthest-point, thuần JS) ──────────────────────

/**
 * Greedy farthest-point coreset: chọn tập con đại diện bằng cách lặp lấy điểm xa
 * nhất so với tập đã chọn (k-center). Giữ phân bố biên của bank → kNN ổn định mà
 * giảm số phần tử. Trả về danh sách INDEX của vectors được giữ.
 */
export function greedyCoreset(vectors: number[][], ratio: number): number[] {
  const n = vectors.length;
  if (n === 0) return [];
  const target = Math.max(1, Math.min(n, Math.round(n * Math.max(0.01, Math.min(ratio, 1)))));
  if (target >= n) return vectors.map((_, i) => i);

  const selected: number[] = [];
  const minDist = new Array<number>(n).fill(Infinity);

  // Hạt giống: phần tử đầu (xác định → idempotent cho offline).
  let current = 0;
  selected.push(current);

  while (selected.length < target) {
    // Cập nhật khoảng cách min tới tập đã chọn (chỉ với điểm vừa thêm).
    for (let i = 0; i < n; i++) {
      if (minDist[i] === 0) continue;
      const d = cosineDistance(vectors[current], vectors[i]);
      if (d < minDist[i]) minDist[i] = d;
    }
    // Chọn điểm xa nhất.
    let best = -1;
    let bestDist = -1;
    for (let i = 0; i < n; i++) {
      if (minDist[i] > bestDist && !selected.includes(i)) {
        bestDist = minDist[i];
        best = i;
      }
    }
    if (best === -1) break;
    selected.push(best);
    current = best;
  }
  return selected;
}

// ─── kNN scoring helper (pure, exported for tests) ────────────────────────────

/**
 * Điểm anomaly = mean-of-k khoảng cách nhỏ nhất tới bank (PatchCore dùng min;
 * mean-of-k ổn định hơn với nhiễu). Trả 0 khi bank rỗng.
 */
export function knnScore(query: number[], bank: number[][], k: number): number {
  if (bank.length === 0) return 0;
  const dists = bank.map((v) => cosineDistance(query, v));
  dists.sort((a, b) => a - b);
  const kk = Math.max(1, Math.min(k, dists.length));
  let sum = 0;
  for (let i = 0; i < kk; i++) sum += dists[i];
  return sum / kk;
}

// ─── Build memory bank ────────────────────────────────────────────────────────

export interface BuildBankParams {
  productModelId?: number | null;
  machineId?: number | null;
  /** ONNX embedding model id. null → degrade text-of-image/heuristic. */
  modelId?: number | null;
  images: Array<{ buffer: Buffer; imageUrl?: string | null }>;
  coresetRatio?: number;
  k?: number;
}

/**
 * Build memory bank từ ảnh OK:
 *   1. Trích embedding mỗi ảnh (3 tầng) — gộp về cùng source chủ đạo.
 *   2. greedy coreset subsample (thuần JS).
 *   3. Lưu ai_anomaly_memory_bank (xóa bank cũ cùng scope trước).
 *   4. Tính phân bố khoảng cách nội bộ (kNN tự thân) → threshold = quantile p99.
 *   5. Lưu ai_anomaly_profiles.
 *
 * getDb null → ném lỗi rõ ràng cho caller (admin action, không phải hot path).
 */
export async function buildMemoryBank(params: BuildBankParams): Promise<BuildBankResult> {
  const k = params.k ?? DEFAULT_KNN_K;
  const coresetRatio = params.coresetRatio ?? DEFAULT_CORESET_RATIO;

  // 1) Embedding tất cả ảnh OK.
  const embedded: Array<{ vector: number[]; source: EmbeddingSource; imageUrl: string | null }> = [];
  let embedFailures = 0;
  const sourceVotes: Record<EmbeddingSource, number> = { onnx: 0, "text-of-image": 0, heuristic: 0 };

  for (const img of params.images) {
    try {
      const emb = await getEmbeddingForAnomaly(img.buffer, { modelId: params.modelId ?? null });
      embedded.push({ vector: emb.vector, source: emb.source, imageUrl: img.imageUrl ?? null });
      sourceVotes[emb.source]++;
    } catch (e) {
      embedFailures++;
      console.warn("[aiAnomalyDetection] buildMemoryBank: skip image (embed failed):", (e as Error)?.message);
    }
  }

  if (embedded.length === 0) {
    throw new Error("No images could be embedded for the memory bank");
  }

  // source chủ đạo + degraded nếu bất kỳ ảnh nào không phải ONNX.
  const primarySource: EmbeddingSource =
    sourceVotes.onnx >= embedded.length ? "onnx" :
    sourceVotes["text-of-image"] > 0 && sourceVotes.heuristic === 0 ? "text-of-image" :
    sourceVotes.onnx === 0 && sourceVotes["text-of-image"] === 0 ? "heuristic" :
    // hỗn hợp → báo theo tầng degrade thấp nhất gặp phải
    sourceVotes.heuristic > 0 ? "heuristic" : "text-of-image";
  const degraded = primarySource !== "onnx";

  const result = await buildBankFromVectors({
    vectors: embedded.map((e) => ({ vector: e.vector, imageUrl: e.imageUrl })),
    scope: {
      productModelId: params.productModelId ?? null,
      machineId: params.machineId ?? null,
      modelCode: anomalyModelCode(primarySource, params.modelId ?? null),
    },
    source: primarySource,
    degraded,
    coresetRatio,
    k,
  });

  return { ...result, embedFailures };
}

// ─── Shared build core (vectors → coreset → bank + profile) ───────────────────

export interface BuildBankFromVectorsParams {
  vectors: Array<{ vector: number[]; imageUrl?: string | null }>;
  scope: AnomalyScope;
  source: EmbeddingSource;
  degraded: boolean;
  coresetRatio?: number;
  k?: number;
  /** Cờ bootstrap/low-confidence (ít vector OK). Đẩy vào profile.distStats để UI thấy. */
  bootstrap?: boolean;
}

/**
 * LÕI dùng chung của build memory bank, thuần vector (không cần ảnh/model):
 *   1. greedy coreset subsample.
 *   2. Lưu ai_anomaly_memory_bank (xóa bank cũ cùng scope trước).
 *   3. Tính phân bố khoảng cách nội bộ (kNN tự thân) → threshold = quantile p99.
 *   4. Lưu ai_anomaly_profiles.
 *
 * `buildMemoryBank` (từ ảnh) và `buildBankFromStoredEmbeddings` (từ vector DB) đều
 * gọi hàm này → KHÔNG nhân đôi math coreset/kNN/threshold.
 */
export async function buildBankFromVectors(
  params: BuildBankFromVectorsParams,
): Promise<Omit<BuildBankResult, "embedFailures">> {
  const k = params.k ?? DEFAULT_KNN_K;
  const coresetRatio = params.coresetRatio ?? DEFAULT_CORESET_RATIO;
  const { scope, source } = params;

  if (params.vectors.length === 0) {
    throw new Error("No vectors provided to build the memory bank");
  }

  // 1) Coreset subsample.
  const allVectors = params.vectors.map((e) => e.vector);
  const keepIdx = greedyCoreset(allVectors, coresetRatio);
  const keptSet = new Set(keepIdx);
  const bank = params.vectors.filter((_, i) => keptSet.has(i));
  const bankVectors = bank.map((b) => b.vector);

  // 2) Lưu bank (xóa cũ trước → rebuild sạch).
  await clearBank(scope);
  await insertBankRows(
    scope,
    bank.map((b) => ({ vector: b.vector, dim: b.vector.length, source, imageUrl: b.imageUrl ?? null })),
  );

  // 3) Phân bố khoảng cách nội bộ: với mỗi điểm bank, kNN distance tới các điểm còn lại.
  const distances: number[] = [];
  for (let i = 0; i < bankVectors.length; i++) {
    const others = bankVectors.filter((_, j) => j !== i);
    if (others.length === 0) continue;
    distances.push(knnScore(bankVectors[i], others, k));
  }
  const distStats = computeDistStats(distances);
  // threshold = quantile p99 (THRESHOLD_PERCENTILE). Bank quá nhỏ → dùng max làm cận.
  const sortedDist = [...distances].sort((a, b) => a - b);
  const threshold = distances.length > 0
    ? Math.max(quantileSorted(sortedDist, THRESHOLD_PERCENTILE), distStats.max)
    : 0;

  // 4) Lưu profile. bootstrap → đánh dấu degraded (low-confidence) + cờ trong distStats.
  const profileDegraded = params.degraded || !!params.bootstrap;
  await upsertProfile(scope, {
    threshold,
    k,
    distStats: params.bootstrap
      ? ({ ...distStats, bootstrap: true } as ProfileInput["distStats"])
      : distStats,
    bankSize: bank.length,
    source,
    degraded: profileDegraded,
  });

  return {
    scope,
    bankSize: bank.length,
    rawCount: params.vectors.length,
    threshold,
    k,
    source,
    degraded: profileDegraded,
    distStats,
  };
}

// ─── Build bank from STORED embeddings (no image bytes, no model load) ─────────

/** Dưới ngưỡng này → bank coi là bootstrap/low-confidence (cảnh báo rõ ràng). */
const BOOTSTRAP_MIN_OK = Math.max(2, Number(process.env.ANOMALY_BOOTSTRAP_MIN_OK ?? 10));

export interface BuildBankFromStoredParams {
  machineId?: number | null;
  productModelId?: number | null;
  /** modelCode trong ai_image_embeddings (mặc định "dinov2-small"). */
  modelCode?: string;
  /** Chỉ lấy ảnh OK (JOIN product_inspections.overallResult='OK'). Mặc định true. */
  okOnly?: boolean;
  coresetRatio?: number;
  k?: number;
}

export interface BuildBankFromStoredResult extends Omit<BuildBankResult, "embedFailures"> {
  storedCount: number;
  bootstrap: boolean;
  embeddingModelCode: string;
}

/**
 * Dựng PatchCore memory bank từ vector ĐÃ LƯU trong ai_image_embeddings (DINOv2 384-d).
 * KHÔNG cần ảnh gốc, KHÔNG load model — đọc vector text → coreset → bank + threshold.
 *
 * scope bank tách theo embeddingModelCode (vd "dinov2-small") để query backfill khớp
 * đúng không gian vector. okOnly → chỉ ảnh OK (normal) như PatchCore yêu cầu.
 *
 * Trung thực với dữ liệu nhỏ: nếu < BOOTSTRAP_MIN_OK vector OK → VẪN build nhưng đánh
 * dấu profile/metadata bootstrap=low-confidence + log cảnh báo rõ.
 */
export async function buildBankFromStoredEmbeddings(
  params: BuildBankFromStoredParams,
): Promise<BuildBankFromStoredResult> {
  const embeddingModelCode = params.modelCode ?? "dinov2-small";
  const okOnly = params.okOnly ?? true;

  const stored = await readStoredEmbeddings({
    machineId: params.machineId ?? null,
    productModelId: params.productModelId ?? null,
    modelCode: embeddingModelCode,
    okOnly,
  });

  if (stored.length === 0) {
    throw new Error(
      `No stored embeddings found for modelCode=${embeddingModelCode}` +
      `${okOnly ? " (okOnly=true → no OK-labelled vectors)" : ""}`,
    );
  }

  // Chỉ giữ vector cùng chiều (an toàn nếu DB lẫn dim khác nhau) — lấy dim đa số.
  const dimCounts = new Map<number, number>();
  for (const r of stored) dimCounts.set(r.vector.length, (dimCounts.get(r.vector.length) ?? 0) + 1);
  let majorityDim = stored[0].vector.length;
  let majorityCount = 0;
  for (const [d, c] of dimCounts) if (c > majorityCount) { majorityCount = c; majorityDim = d; }
  const usable = stored.filter((r) => r.vector.length === majorityDim);

  const bootstrap = usable.length < BOOTSTRAP_MIN_OK;
  if (bootstrap) {
    console.warn(
      `[aiAnomalyDetection] buildBankFromStoredEmbeddings: only ${usable.length} usable OK vector(s) ` +
      `(< ${BOOTSTRAP_MIN_OK}) for modelCode=${embeddingModelCode} machineId=${params.machineId ?? "any"} ` +
      `→ building BOOTSTRAP / low-confidence bank. Threshold is weak; embed more OK images and rebuild.`,
    );
  }

  // Vector DINOv2 lưu sẵn coi là source "onnx" (feature học sâu thật, không degrade
  // theo tầng heuristic). modelCode bank = "anomaly:onnx:<embeddingModelCode>".
  const source: EmbeddingSource = "onnx";
  const scope: AnomalyScope = {
    productModelId: params.productModelId ?? null,
    machineId: params.machineId ?? null,
    modelCode: `anomaly:onnx:${embeddingModelCode}`,
  };

  const core = await buildBankFromVectors({
    vectors: usable.map((r) => ({ vector: r.vector, imageUrl: r.imageUrl })),
    scope,
    source,
    degraded: false,
    coresetRatio: params.coresetRatio,
    k: params.k,
    bootstrap,
  });

  return { ...core, storedCount: usable.length, bootstrap, embeddingModelCode };
}

// ─── Backfill anomaly scores from STORED embeddings ───────────────────────────

export interface BackfillParams {
  machineId?: number | null;
  productModelId?: number | null;
  /** modelCode trong ai_image_embeddings (mặc định "dinov2-small"). */
  modelCode?: string;
  limit?: number;
}

export interface BackfillResult {
  scope: ScoreFromVectorScope;
  scanned: number;
  scored: number;
  flaggedAnomaly: number;
  failures: number;
  bankAvailable: boolean;
  threshold: number | null;
}

/**
 * Chấm anomaly cho TẤT CẢ vector đã lưu trong scope (không chỉ OK) bằng scoreFromVector
 * vs bank, rồi ghi metadata.anomaly (idempotent jsonb merge, cùng shape worker + cờ
 * backfill:true). KHÔNG cần ảnh/model — thuần vector.
 *
 * Fail-safe per row: 1 dòng lỗi → đếm failures, không dừng. Idempotent ở tầng SQL
 * (jsonb '||' ghi đè "anomaly") → re-run an toàn.
 */
export async function backfillAnomalyScores(params: BackfillParams): Promise<BackfillResult> {
  const embeddingModelCode = params.modelCode ?? "dinov2-small";
  const scope: ScoreFromVectorScope = {
    productModelId: params.productModelId ?? null,
    machineId: params.machineId ?? null,
    modelCode: `anomaly:onnx:${embeddingModelCode}`,
  };

  // Đọc MỌI vector trong scope (okOnly=false) — kể cả NG → chấm để phát hiện anomaly.
  const stored = await readStoredEmbeddings({
    machineId: params.machineId ?? null,
    productModelId: params.productModelId ?? null,
    modelCode: embeddingModelCode,
    okOnly: false,
    limit: params.limit,
  });

  let scored = 0;
  let flaggedAnomaly = 0;
  let failures = 0;
  let threshold: number | null = null;
  let bankAvailable = false;

  for (const row of stored) {
    try {
      const r = await scoreFromVector(row.vector, scope, { source: "onnx", degraded: false });
      if (r.bankSize > 0) bankAvailable = true;
      if (r.threshold != null) threshold = r.threshold;

      const anomaly = {
        score: Number(r.score.toFixed(6)),
        threshold: r.threshold,
        isAnomaly: r.isAnomaly,
        source: r.source,
        degraded: r.degraded,
        bankSize: r.bankSize,
        k: r.k,
        reason: r.reason ?? null,
        backfill: true,
        scoredAt: new Date().toISOString(),
      };
      await writeAnomalyMetadata(row.id, anomaly);
      scored++;
      if (r.isAnomaly) flaggedAnomaly++;
    } catch (e) {
      failures++;
      console.warn(`[aiAnomalyDetection] backfill emb#${row.id} failed:`, (e as Error)?.message ?? e);
    }
  }

  return {
    scope,
    scanned: stored.length,
    scored,
    flaggedAnomaly,
    failures,
    bankAvailable,
    threshold,
  };
}

// ─── Score image ──────────────────────────────────────────────────────────────

export interface ScoreParams {
  buffer: Buffer;
  productModelId?: number | null;
  machineId?: number | null;
  /** ONNX model id để embed query — nên KHỚP model dùng khi build bank. */
  modelId?: number | null;
}

/**
 * Cho ảnh test → kNN distance tới bank → so threshold profile.
 *
 * Degrade trung thực + an toàn:
 *   • getDb null / không có profile / bank rỗng → trả score an toàn (isAnomaly
 *     false, threshold null, reason rõ) — KHÔNG throw (best-effort hot path).
 *   • embedding rơi tầng → cờ source/degraded phản ánh đúng.
 */
export async function scoreImage(params: ScoreParams): Promise<ScoreResult> {
  const scopeBase = {
    productModelId: params.productModelId ?? null,
    machineId: params.machineId ?? null,
  };

  // Embed query trước (cần source để chọn đúng modelCode/scope).
  let emb: AnomalyEmbedding;
  try {
    emb = await getEmbeddingForAnomaly(params.buffer, { modelId: params.modelId ?? null });
  } catch (e) {
    return {
      score: 0, isAnomaly: false, threshold: null, source: "none", degraded: true,
      bankSize: 0, k: DEFAULT_KNN_K, reason: `embedding_failed:${(e as Error)?.message ?? "unknown"}`,
    };
  }

  const scope: AnomalyScope = {
    ...scopeBase,
    modelCode: anomalyModelCode(emb.source, params.modelId ?? null),
  };

  const result = await scoreFromVector(emb.vector, scope, { source: emb.source, degraded: emb.degraded });

  // ADDITIVE patch-level localization (heatmap + hotspots). Gated by ANOMALY_PATCH_ENABLED
  // (default OFF). Flag OFF → env read is false → `result` is returned untouched (whole-image
  // path unchanged). Flag ON → augment with `patch`; any failure is swallowed (best-effort
  // hot path). Env read inline (not a static import) to avoid an import cycle at module eval.
  if ((process.env.ANOMALY_PATCH_ENABLED ?? "false").toLowerCase() === "true") {
    try {
      const { scoreImagePatch } = await import("./aiPatchAnomaly");
      result.patch = await scoreImagePatch({
        buffer: params.buffer,
        productModelId: params.productModelId ?? null,
        machineId: params.machineId ?? null,
        modelId: params.modelId ?? null,
      });
    } catch (e) {
      console.warn("[aiAnomalyDetection] patch localization skipped:", (e as Error)?.message);
    }
  }

  return result;
}

// ─── Score from VECTOR (pure kNN-vs-threshold core, exported) ──────────────────

export interface ScoreFromVectorScope {
  productModelId: number | null;
  machineId: number | null;
  /** Scope-key bank (vd "anomaly:onnx:dinov2-small"). */
  modelCode: string;
}

/**
 * LÕI scoring thuần: vector → kNN distance tới bank (scope) → so threshold profile.
 * `scoreImage` = embed ảnh rồi gọi hàm này; backfill cũng gọi trực tiếp (không embed).
 *
 * Fail-safe tuyệt đối: DB null / không profile / bank rỗng / lệch chiều → score an
 * toàn (isAnomaly false, reason rõ), KHÔNG throw.
 */
export async function scoreFromVector(
  vector: number[],
  scope: ScoreFromVectorScope,
  opts: { source?: EmbeddingSource | "none"; degraded?: boolean } = {},
): Promise<ScoreResult> {
  const source = opts.source ?? "onnx";

  let profile: Awaited<ReturnType<typeof getProfile>> = null;
  let bank: number[][] = [];
  try {
    profile = await getProfile(scope);
    bank = await loadBank(scope, ANOMALY_BANK_SCAN_LIMIT);
  } catch (e) {
    return {
      score: 0, isAnomaly: false, threshold: null, source, degraded: true,
      bankSize: 0, k: profile?.k ?? DEFAULT_KNN_K, reason: `bank_unavailable:${(e as Error)?.message ?? "db"}`,
    };
  }

  if (!profile || bank.length === 0) {
    const eff = profile ? resolveEffectiveThreshold(profile) : null;
    return {
      score: 0, isAnomaly: false, threshold: eff?.threshold ?? null,
      source, degraded: true, bankSize: bank.length, k: profile?.k ?? DEFAULT_KNN_K,
      reason: !profile ? "no_profile" : "empty_bank",
      calibrated: eff?.calibrated,
    };
  }

  const k = profile.k ?? DEFAULT_KNN_K;
  // Chỉ so cùng chiều (an toàn khi bank build bằng source khác query).
  const dim = vector.length;
  const sameDimBank = bank.filter((v) => v.length === dim);
  if (sameDimBank.length === 0) {
    const eff = resolveEffectiveThreshold(profile);
    return {
      score: 0, isAnomaly: false, threshold: eff.threshold,
      source, degraded: true, bankSize: bank.length, k,
      reason: "dim_mismatch",
      calibrated: eff.calibrated,
    };
  }

  const score = knnScore(vector, sameDimBank, k);
  const { threshold, calibrated } = resolveEffectiveThreshold(profile);
  const isAnomaly = score > threshold;

  return {
    score,
    isAnomaly,
    threshold,
    source,
    // degraded = cờ embedding HOẶC profile build ở chế độ degrade.
    degraded: !!opts.degraded || !!profile.degraded,
    bankSize: sameDimBank.length,
    k,
    calibrated,
  };
}

/**
 * F3/D2 (doc69 G9) — resolve the threshold `scoreFromVector` should use:
 * `ai_anomaly_profiles.calibratedThreshold` (ROC-swept to a target recall/FPR)
 * when set, else the existing fixed p99 self-distance `threshold`. Absent
 * calibratedThreshold (never calibrated, OR migration 0300 not yet applied on
 * this DB — see server/db/aiAnomaly.ts getProfile()'s fallback) → byte-for-byte
 * the pre-D2 behaviour.
 */
function resolveEffectiveThreshold(
  profile: NonNullable<Awaited<ReturnType<typeof getProfile>>>,
): { threshold: number; calibrated: boolean } {
  const calibratedRaw = (profile as { calibratedThreshold?: string | null }).calibratedThreshold;
  if (calibratedRaw != null) return { threshold: Number(calibratedRaw), calibrated: true };
  return { threshold: Number(profile.threshold), calibrated: false };
}

// ─── Scope / modelCode helper ─────────────────────────────────────────────────

/**
 * modelCode scope-key cho anomaly. Phân tách không gian theo nguồn embedding để
 * KHÔNG trộn vector ONNX (chiều khác) với heuristic/text-of-image (1024-dim).
 *   onnx          → "anomaly:onnx:<modelId>"
 *   text-of-image → "anomaly:text-of-image"
 *   heuristic     → "anomaly:heuristic"
 */
export function anomalyModelCode(source: EmbeddingSource, modelId: number | null): string {
  if (source === "onnx" && modelId != null) return `anomaly:onnx:${modelId}`;
  return `anomaly:${source}`;
}

// ─── Stats passthrough ─────────────────────────────────────────────────────────

export async function getAnomalyStats(scope: { productModelId?: number | null; machineId?: number | null; modelId?: number | null }) {
  // Stats tổng hợp theo cả 3 modelCode khả dĩ (onnx/text-of-image/heuristic) cho scope.
  return getBankStats({
    productModelId: scope.productModelId ?? null,
    machineId: scope.machineId ?? null,
  });
}

// ─── B3.2 / B8ter — VL escalation gate ─────────────────────────────────────────
//
// SIZING (§B8ter): tải = 20.000 ảnh/ca 8h ≈ 0,69 ảnh/s. DINOv2 embed/anomaly
// (~150ms) chạy 100% ảnh là rẻ (~10–20% công suất). Qwen3-VL (~1,23s/ảnh) NẾU
// chạy mọi ảnh ≈ 50s công việc/60s → NGHẼN. Vì vậy chỉ ảnh NG/nghi ngờ
// (anomaly-flagged hoặc đã NG, thường 2–10%) mới leo lên VL.
//
// `shouldEscalateToVision` là CỔNG đó: một hàm thuần, rõ ràng, để mọi call-site
// dùng chung quy tắc + đo lường. Ngưỡng nghi ngờ cấu hình qua env (mặc định = bội
// số của threshold profile, hoặc tuyệt đối).

/** Ngưỡng "nghi ngờ" tương đối: score > threshold × hệ số này → leo VL. Mặc định 1.0
 *  (tức bất kỳ ảnh nào isAnomaly). Đặt <1 để nới (bắt thêm "borderline"), >1 để siết. */
const VL_SUSPECT_THRESHOLD_RATIO = Math.max(
  0.1,
  Math.min(Number(process.env.ANOMALY_VL_SUSPECT_RATIO ?? 1.0), 10),
);
/** Ngưỡng tuyệt đối tùy chọn: nếu set (>0) → score > giá trị này cũng leo VL (bỏ qua ratio).
 *  Để rỗng/<=0 → chỉ dùng ratio so với threshold profile. */
const VL_SUSPECT_ABS = Number(process.env.ANOMALY_VL_SUSPECT_ABS ?? 0);
/** Trần tỉ lệ leo VL theo phút (back-pressure cứng) — bảo vệ sidecar khỏi burst NG
 *  bất thường (vd >20% NG) làm VL nghẽn. 0 = tắt trần. Mặc định 6/phút (an toàn cho
 *  ~10% của tải cao điểm). */
const VL_ESCALATION_MAX_PER_MIN = Math.max(0, Number(process.env.ANOMALY_VL_MAX_PER_MIN ?? 6));

export interface VisionEscalationDecision {
  escalate: boolean;
  /** Lý do (machine-readable): "ng_classified" | "anomaly_suspect" | "below_threshold" |
   *  "no_threshold" | "rate_limited" | "disabled". */
  reason: string;
  /** Ngưỡng nghi ngờ hiệu lực đã so (null khi không có threshold profile). */
  suspectThreshold: number | null;
}

/** Bộ đếm leo VL (in-memory, reset theo cửa sổ phút) — để operator thấy cổng đang chặn. */
interface EscalationMeter {
  windowStartMs: number;
  inWindow: number;
  totalSeen: number;
  totalEscalated: number;
  totalRateLimited: number;
}
const _vlMeter: EscalationMeter = {
  windowStartMs: Date.now(),
  inWindow: 0,
  totalSeen: 0,
  totalEscalated: 0,
  totalRateLimited: 0,
};

function _rollWindow(now: number): void {
  if (now - _vlMeter.windowStartMs >= 60_000) {
    _vlMeter.windowStartMs = now;
    _vlMeter.inWindow = 0;
  }
}

/**
 * CỔNG LEO TẦNG (B3.2 + B8ter): quyết định một ảnh có nên leo lên Qwen3-VL không.
 *
 * Quy tắc (rẻ→đắt; tầng rẻ lọc, tầng đắt chỉ xử lý phần khó):
 *   1. classification === "NG"               → escalate (đã chắc lỗi, cần mô tả).
 *   2. score > suspectThreshold              → escalate (anomaly nghi ngờ).
 *   3. còn lại                               → KHÔNG escalate (đại đa số ảnh OK).
 *
 * suspectThreshold = ANOMALY_VL_SUSPECT_ABS (nếu >0) HOẶC profileThreshold × ratio.
 * Khi không có threshold profile → chỉ leo theo classification NG.
 *
 * KHÔNG side-effect ngoài việc cập nhật meter (đo lường). Trần VL_ESCALATION_MAX_PER_MIN
 * áp dụng để chặn burst (back-pressure cứng) — vượt trần → reason "rate_limited".
 *
 * `opts.enabled=false` (mặc định theo ANOMALY_DETECTION_ENABLED) → luôn trả escalate:false.
 */
export function shouldEscalateToVision(
  score: number,
  classification: string | null | undefined,
  opts: {
    profileThreshold?: number | null;
    enabled?: boolean;
    /** Bỏ qua trần rate-limit (vd test / admin). */
    ignoreRateLimit?: boolean;
  } = {},
): VisionEscalationDecision {
  const enabled = opts.enabled ?? isAnomalyDetectionEnabled();
  if (!enabled) {
    return { escalate: false, reason: "disabled", suspectThreshold: null };
  }

  _vlMeter.totalSeen++;
  const now = Date.now();
  _rollWindow(now);

  const isNg = (classification ?? "").toUpperCase() === "NG";

  // suspectThreshold hiệu lực.
  let suspectThreshold: number | null = null;
  if (VL_SUSPECT_ABS > 0) {
    suspectThreshold = VL_SUSPECT_ABS;
  } else if (opts.profileThreshold != null && opts.profileThreshold > 0) {
    suspectThreshold = opts.profileThreshold * VL_SUSPECT_THRESHOLD_RATIO;
  }

  const suspect = suspectThreshold != null && score > suspectThreshold;
  const wantEscalate = isNg || suspect;

  if (!wantEscalate) {
    return {
      escalate: false,
      reason: suspectThreshold == null ? "no_threshold" : "below_threshold",
      suspectThreshold,
    };
  }

  // Trần rate-limit (back-pressure): bảo vệ sidecar khỏi burst NG.
  if (!opts.ignoreRateLimit && VL_ESCALATION_MAX_PER_MIN > 0 && _vlMeter.inWindow >= VL_ESCALATION_MAX_PER_MIN) {
    _vlMeter.totalRateLimited++;
    return { escalate: false, reason: "rate_limited", suspectThreshold };
  }

  _vlMeter.inWindow++;
  _vlMeter.totalEscalated++;
  return {
    escalate: true,
    reason: isNg ? "ng_classified" : "anomaly_suspect",
    suspectThreshold,
  };
}

/** Snapshot bộ đếm cổng VL (cho operator/UI/metrics) — tỉ lệ leo thực vs ảnh đã xét. */
export function getVisionEscalationMeter(): {
  totalSeen: number;
  totalEscalated: number;
  totalRateLimited: number;
  escalationRate: number;
  inCurrentWindow: number;
  maxPerMinute: number;
} {
  return {
    totalSeen: _vlMeter.totalSeen,
    totalEscalated: _vlMeter.totalEscalated,
    totalRateLimited: _vlMeter.totalRateLimited,
    escalationRate: _vlMeter.totalSeen > 0 ? _vlMeter.totalEscalated / _vlMeter.totalSeen : 0,
    inCurrentWindow: _vlMeter.inWindow,
    maxPerMinute: VL_ESCALATION_MAX_PER_MIN,
  };
}

/** Cờ master B3 (ANOMALY_DETECTION_ENABLED, mặc định OFF). Khi OFF → không scoring/leo VL. */
export function isAnomalyDetectionEnabled(): boolean {
  return (process.env.ANOMALY_DETECTION_ENABLED ?? "false").toLowerCase() === "true";
}
