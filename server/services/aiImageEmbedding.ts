import * as ort from "onnxruntime-node";
import { DbUnavailableError } from "../_core/dbErrors";
import sharp from "sharp";
// ★★★ Pha 2B Task 5 — vị từ "lỗi này có phải LỜI TỪ CHỐI không". Import TĨNH của một module
// LÁ (không import gì, không I/O): nó phải dùng được NGAY TRONG `catch` của một lượt
// `await import()` vừa hỏng. Xem `vramRefusalSignal.ts` để biết vì sao so TÊN, không `instanceof`.
import { isVramRefusal } from "./vram/vramRefusalSignal";
import path from "path";
import fs from "fs";
import { getDb } from "../db/connection";
import { aiImageEmbeddings } from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { getAiModelById, getActiveModelForProduct, getAiModels } from "../db/ai";
import type { AiModel } from "../../drizzle/schema";
import { describeDefect } from "./aiVisionLanguage";
import { gpuSessionSemaphore } from "./aiInferenceEngine";

// B4.1 — nguồn embedding ảnh trả về UI (trung thực):
//  - "onnx":          model ONNX embedding ACTIVE (vector thật, khác chiều 1024).
//  - "text-of-image": describeDefect → embed text mxbai 1024-d (mặc định khi không ONNX).
//  - "metadata":      fallback keyword (khi vision/DB lỗi).
export type EmbeddingSource = "onnx" | "text-of-image" | "metadata";

// B4.1 — override chọn nguồn embedding ảnh mặc định: "onnx" | "text".
// Default (unset/"text") → giữ nguyên hành vi text-of-image (backward-compatible).
const IMAGE_EMBEDDING_DEFAULT = (process.env.IMAGE_EMBEDDING_DEFAULT ?? "text").toLowerCase();

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EmbeddingResult {
  embedding: number[];
  dim: number;
  modelCode: string;
  processingTimeMs: number;
}

export interface SimilarImage {
  id: number;
  inspectionId: number | null;
  measurementResultId: number | null;
  imageUrl: string;
  label: string | null;
  defectType: string | null;
  machineId: number | null;
  productModelId: number | null;
  similarity: number;
  createdAt: Date;
}

/**
 * Cờ chế độ tìm kiếm trả về UI (offline-first, nhiều tầng fallback):
 *  - "hnsw":      dùng HNSW index trên cột embedding_vec (nhanh nhất).
 *  - "exact":     cast runtime embedding::vector(D) <=> ... (full scan, chính xác).
 *  - "bruteforce": parse TEXT + cosine trong Node (khi DB không cast được).
 *  - "metadata":  fallback keyword theo label/defectType (khi không có vector/Ollama).
 */
export type SearchMode = "hnsw" | "exact" | "bruteforce" | "metadata";

/** Số chiều thống nhất với knowledge base (mxbai-embed-large). */
export const DEFAULT_EMBEDDING_DIM = 1024;
/** modelCode ghi cho embedding sinh từ pipeline text-of-image Ollama. */
export const TEXT_OF_IMAGE_MODEL_CODE = "ollama-text-of-image:mxbai-embed-large";

const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "mxbai-embed-large";

// WS-G4 — rollback switch. USE_LEGACY_OLLAMA=true → embed text qua Ollama HTTP (cũ).
// Mặc định (false) → embed qua GGUF in-process (aiGgufEngine), không cần daemon.
const USE_LEGACY_OLLAMA = (process.env.USE_LEGACY_OLLAMA ?? "false").toLowerCase() === "true";
// Model id GGUF cho embedding (mxbai). aiGgufEngine resolve model theo basename không ".gguf".
const GGUF_EMBED_MODEL_ID = path.basename(
  process.env.GGUF_EMBED_MODEL || "mxbai-embed-large-v1-f16.gguf",
  ".gguf",
);
/** Giới hạn số dòng quét cho brute-force cosine trong Node (bảo vệ RAM/CPU). */
const BRUTEFORCE_SCAN_LIMIT = Number(process.env.IMG_EMB_BRUTEFORCE_LIMIT ?? 5000);

// ─── DINOv2 ONNX model path (AOI-A: configurable, honest degradation) ──────────
//
// AOI-A — CẤU HÌNH ĐƯỜNG DẪN MODEL (không còn hardcode absolute).
//   AI_DINOV2_MODEL_PATH  đường dẫn tới file .onnx (DINOv2). Có thể absolute hoặc
//                         relative theo repo root. Mặc định: models/dinov2.onnx.
//   DINOV2_MODEL_PATH     alias LEGACY (script cũ) — vẫn được đọc để backward-compat.
//
// Nếu file KHÔNG tồn tại → loader/registry degrade TRUNG THỰC theo tier hiện có
// (ONNX → text-of-image → heuristic/metadata). KHÔNG BAO GIỜ bịa embedding.

/** Default repo-relative path (documented models dir). Không commit binary. */
export const DEFAULT_DINOV2_MODEL_PATH = "models/dinov2.onnx";

/**
 * Resolve đường dẫn tuyệt đối tới file DINOv2 ONNX từ env (AOI-A).
 * Ưu tiên AI_DINOV2_MODEL_PATH → DINOV2_MODEL_PATH (legacy) → default repo-relative.
 * Đường dẫn relative được resolve theo process.cwd() (repo root khi chạy server/script).
 */
export function getDinov2ModelPath(): string {
  const raw =
    process.env.AI_DINOV2_MODEL_PATH ||
    process.env.DINOV2_MODEL_PATH ||
    DEFAULT_DINOV2_MODEL_PATH;
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

/** File model DINOv2 có tồn tại tại đường dẫn cấu hình không? (best-effort, không ném). */
export function dinov2ModelExists(): boolean {
  try {
    return fs.existsSync(getDinov2ModelPath());
  } catch {
    return false;
  }
}

export type EmbeddingTier = "onnx" | "text-of-image" | "heuristic";

export interface Dinov2ModelHealth {
  /** Đường dẫn tuyệt đối đã resolve từ env (AI_DINOV2_MODEL_PATH / legacy / default). */
  modelPath: string;
  /** Giá trị env thô đã dùng (để debug cấu hình). */
  configuredPath: string;
  /** Nguồn cấu hình: "AI_DINOV2_MODEL_PATH" | "DINOV2_MODEL_PATH" | "default". */
  source: "AI_DINOV2_MODEL_PATH" | "DINOV2_MODEL_PATH" | "default";
  /** File .onnx có tồn tại tại modelPath không. */
  modelPresent: boolean;
  /**
   * Tier embedding sẽ được dùng cho ẢNH khi model vắng mặt:
   *   • "onnx"          — file model có mặt (vector DINOv2 thật).
   *   • "text-of-image" — không có model nhưng GGUF khả dụng (mô tả→embed 1024-d).
   *   • "heuristic"     — không model + không GGUF (sharp handcrafted, anomaly fallback).
   */
  activeTier: EmbeddingTier;
  /** true khi tier != "onnx" (không dùng feature học sâu thật) → phải báo cho UI/health. */
  degraded: boolean;
  /** Ghi chú người-đọc-được, trung thực. */
  note: string;
}

/**
 * AOI-A — Health check cho DINOv2 ONNX (dùng được cho health endpoint tương lai).
 * KHÔNG UI. Báo trung thực: đường dẫn cấu hình, file có mặt?, tier embedding đang hiệu lực.
 *
 * Khi model vắng mặt, tier hiệu lực được suy từ GGUF (text-of-image) hoặc heuristic —
 * đúng chuỗi degrade mà loader/anomaly áp dụng, nên health khớp hành vi thực tế.
 */
export async function getDinov2ModelHealth(): Promise<Dinov2ModelHealth> {
  const configuredPath =
    process.env.AI_DINOV2_MODEL_PATH ||
    process.env.DINOV2_MODEL_PATH ||
    DEFAULT_DINOV2_MODEL_PATH;
  const source: Dinov2ModelHealth["source"] = process.env.AI_DINOV2_MODEL_PATH
    ? "AI_DINOV2_MODEL_PATH"
    : process.env.DINOV2_MODEL_PATH
      ? "DINOV2_MODEL_PATH"
      : "default";
  const modelPath = getDinov2ModelPath();
  const modelPresent = dinov2ModelExists();

  let activeTier: EmbeddingTier;
  let note: string;
  if (modelPresent) {
    activeTier = "onnx";
    note = `DINOv2 ONNX present at ${modelPath} — real visual embeddings active.`;
  } else {
    // Model vắng mặt → suy tier degrade y hệt anomaly/embedding pipeline.
    let ggufAvailable = false;
    try {
      const { isGgufAvailable } = await import("./aiGgufEngine");
      ggufAvailable = await isGgufAvailable();
    } catch {
      ggufAvailable = false;
    }
    activeTier = ggufAvailable ? "text-of-image" : "heuristic";
    note =
      `DINOv2 ONNX NOT found at ${modelPath} (source=${source}); ` +
      `falling back to ${activeTier} tier — embeddings are degraded, NOT fabricated. ` +
      `Drop a real DINOv2 .onnx at the configured path to activate the onnx tier.`;
  }

  return {
    modelPath,
    configuredPath,
    source,
    modelPresent,
    activeTier,
    degraded: activeTier !== "onnx",
    note,
  };
}

// ─── Vector math helpers (exported for unit tests) ─────────────────────────────

/** L2-normalize → unit vector. Vector 0 trả lại nguyên (norm=1). */
export function l2normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/**
 * Cosine similarity. Khi cả hai đã L2-normalize, đây chính là dot product.
 * Trả về 0 nếu khác chiều hoặc rỗng.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

/** Format vector → chuỗi pgvector `"[v1,v2,...]"`. */
export function formatVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

/** Parse chuỗi pgvector/JSON `"[v1,...]"` → number[]. Trả [] khi hỏng. */
export function parseVectorLiteral(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(Number) : [];
  } catch {
    return [];
  }
}

// ─── Text-of-image embedding pipeline (Ollama mxbai-embed-large, 1024-dim) ─────

/**
 * Embed text qua Ollama /api/embed (mxbai-embed-large), trả vector đã L2-normalize.
 * Thống nhất pipeline với knowledge base. Ném lỗi nếu Ollama không khả dụng →
 * caller fallback sang metadata search.
 */
export async function embedTextOllama(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input: text }),
  });
  if (!res.ok) {
    throw new Error(`Ollama /api/embed failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const json = (await res.json()) as { embeddings?: number[][] };
  const vec = json.embeddings?.[0];
  if (!Array.isArray(vec) || vec.length === 0) {
    throw new Error("Ollama /api/embed returned no embeddings");
  }
  return l2normalize(vec);
}

/**
 * WS-G4 — Embed text vào không gian mxbai 1024-dim, đã L2-normalize.
 * Mặc định dùng GGUF in-process (aiGgufEngine, không cần Ollama daemon); chỉ định
 * GGUF_EMBED_MODEL_ID để không rơi vào model text (Qwen) sai chiều. Khi
 * USE_LEGACY_OLLAMA=true → dùng đường Ollama HTTP cũ (rollback). Ném lỗi nếu cả
 * engine không khả dụng → caller (searchByImage) fallback metadata.
 */
async function embedTextLocal(text: string): Promise<number[]> {
  if (USE_LEGACY_OLLAMA) {
    return embedTextOllama(text);
  }
  const { generateEmbedding, isGgufAvailable } = await import("./aiGgufEngine");
  if (await isGgufAvailable()) {
    const { embedding } = await generateEmbedding(text, GGUF_EMBED_MODEL_ID);
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("GGUF generateEmbedding returned empty vector");
    }
    // L2-normalize giống pipeline KB → cùng không gian với dữ liệu cũ.
    return l2normalize(embedding);
  }
  // GGUF không khả dụng → thử Ollama như fallback offline-first.
  return embedTextOllama(text);
}

/**
 * Mô tả ảnh bằng LLM (describeDefect) → ghép thành text → embed (GGUF mặc định).
 * Đây là nguồn embedding ảnh đã chốt cho WS-3 (text-of-image, offline-first).
 * GIỮ NGUYÊN modelCode (TEXT_OF_IMAGE_MODEL_CODE) để tương thích dữ liệu cũ trong
 * ai_image_embeddings — cả Ollama mxbai và GGUF mxbai cùng không gian 1024-dim.
 */
export async function embedImageAsText(
  imageBuffer: Buffer,
  context?: { productModel?: string; machineCode?: string; existingLabels?: string[] },
): Promise<EmbeddingResult> {
  const startTime = Date.now();
  const description = await describeDefect(imageBuffer, { ...context, useCloudVision: false });
  const text = [
    description.description,
    description.location,
    ...(description.possibleCauses ?? []),
    ...(description.suggestedActions ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  const embedding = await embedTextLocal(text || "inspection image");
  return {
    embedding,
    dim: embedding.length,
    modelCode: TEXT_OF_IMAGE_MODEL_CODE,
    processingTimeMs: Date.now() - startTime,
  };
}

export interface ClusterResult {
  clusterId: number;
  centroidImageId: number;
  memberCount: number;
  members: Array<{
    id: number;
    imageUrl: string;
    label: string | null;
    similarity: number;
  }>;
}

function buildSearchKeywords(textParts: Array<string | undefined | null>): string[] {
  const rawText = textParts.filter(Boolean).join(" ").toLowerCase();
  const words = rawText.match(/[a-z0-9\-]{3,}/g) ?? [];
  return [...new Set(words)].slice(0, 12);
}

async function searchByMetadataFallback(
  imageBuffer: Buffer,
  limit: number,
  filters?: {
    machineId?: number;
    productModelId?: number;
    label?: string;
    defectType?: string;
    minSimilarity?: number;
    excludeId?: number;
  },
): Promise<{ results: SimilarImage[]; embedding: EmbeddingResult }> {
  const db = await getDb();
  if (!db) {
    return {
      results: [],
      embedding: {
        embedding: [],
        dim: 0,
        modelCode: "metadata-fallback",
        processingTimeMs: 0,
      },
    };
  }

  let descriptionText = "";
  try {
    const description = await describeDefect(imageBuffer, { useCloudVision: false });
    descriptionText = [
      description.description,
      description.location,
      ...(description.possibleCauses ?? []),
      ...(description.suggestedActions ?? []),
    ].join(" ");
  } catch {
    descriptionText = "";
  }

  const keywords = buildSearchKeywords([descriptionText]);
  const candidateLimit = Math.max(Math.min(limit * 10, 200), limit);

  const conditions: ReturnType<typeof eq>[] = [] as any;
  if (filters?.excludeId != null) conditions.push(sql`id != ${Number(filters.excludeId)}` as any);
  if (filters?.machineId != null) conditions.push(eq(aiImageEmbeddings.machineId, Number(filters.machineId)) as any);
  if (filters?.productModelId != null) conditions.push(eq(aiImageEmbeddings.productModelId, Number(filters.productModelId)) as any);
  if (filters?.label) conditions.push(eq(aiImageEmbeddings.label, filters.label) as any);
  if (filters?.defectType) conditions.push(eq(aiImageEmbeddings.defectType, filters.defectType) as any);

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: aiImageEmbeddings.id,
      inspectionId: aiImageEmbeddings.inspectionId,
      measurementResultId: aiImageEmbeddings.measurementResultId,
      imageUrl: aiImageEmbeddings.imageUrl,
      label: aiImageEmbeddings.label,
      defectType: aiImageEmbeddings.defectType,
      machineId: aiImageEmbeddings.machineId,
      productModelId: aiImageEmbeddings.productModelId,
      createdAt: aiImageEmbeddings.createdAt,
    })
    .from(aiImageEmbeddings)
    .where(whereClause)
    .orderBy(desc(aiImageEmbeddings.createdAt))
    .limit(candidateLimit);

  const scored = rows.map((row) => {
    const haystack = `${row.label ?? ""} ${row.defectType ?? ""}`.toLowerCase();
    const matchCount = keywords.reduce((count, keyword) => count + (haystack.includes(keyword) ? 1 : 0), 0);
    const similarity = keywords.length > 0
      ? Math.max(0.15, Math.min(0.75, matchCount / Math.max(keywords.length, 1)))
      : 0.15;

    return {
      id: row.id,
      inspectionId: row.inspectionId,
      measurementResultId: row.measurementResultId,
      imageUrl: row.imageUrl,
      label: row.label,
      defectType: row.defectType,
      machineId: row.machineId,
      productModelId: row.productModelId,
      similarity,
      createdAt: new Date(row.createdAt),
    } satisfies SimilarImage;
  });

  scored.sort((left, right) => right.similarity - left.similarity || right.createdAt.getTime() - left.createdAt.getTime());

  return {
    results: scored.slice(0, limit),
    embedding: {
      embedding: [],
      dim: 0,
      modelCode: "metadata-fallback",
      processingTimeMs: 0,
    },
  };
}

// ─── Session Cache (separate from inference engine) ──────────────────────────

const embeddingSessionCache = new Map<string, ort.InferenceSession>();

/**
 * Pha 1 điều phối VRAM (Task 5 review vòng 1, I-2) — HỘ TIÊU THỤ THỨ BẢY.
 *
 * `getEmbeddingSession()` bên dưới tạo `ort.InferenceSession` với EP **`cuda`** khi
 * `ENABLE_CUDA=true`, và cache trong `embeddingSessionCache` RIÊNG (không dùng chung
 * `LruSessionCache` của aiInferenceEngine) ⇒ vô hình với mọi phép cộng VRAM đã làm. Nó được
 * gọi từ ≥9 module đang SỐNG: phát hiện bất thường · tìm ảnh tương tự · học chủ động ·
 * featureStore · embeddingHead.
 *
 * Hôm nay 0 MiB CHỈ VÌ `ENABLE_CUDA` không có trong `.env` — đúng lớp mù đã sinh ra hộ thứ sáu
 * (reranker, 0 MiB chỉ vì `RAG_RERANKER_GPU=false`). Đổi một cờ là có ngay một hộ tiêu thụ mà
 * không công cụ nào thấy.
 *
 * ⚠ `embeddingSessionCache` KHÔNG có giới hạn kích thước và KHÔNG có LRU — chỉ
 * `evictEmbeddingSessionCache()` mới gỡ. Giấy phép theo đúng vòng đời đó.
 */
const embeddingSessionVramTickets = new Map<string, import("./vram/vramWiring").VramTicket>();

function releaseEmbeddingSessionVramTicket(key: string): void {
  try {
    const t = embeddingSessionVramTickets.get(key);
    if (!t) return;
    embeddingSessionVramTickets.delete(key);
    t.release();
  } catch {
    /* telemetry KHÔNG được làm hỏng vòng đời cache */
  }
}

async function getEmbeddingSession(model: AiModel): Promise<ort.InferenceSession> {
  const cacheKey = `emb:${model.id}:${model.currentVersion}`;
  const cached = embeddingSessionCache.get(cacheKey);
  if (cached) return cached;

  if (!model.filePath) throw new Error(`Model ${model.code} has no file path`);

  let modelPath = model.filePath;
  if (modelPath.startsWith("/uploads/")) {
    const uploadsRoot = process.env.LOCAL_STORAGE_DIR
      ? path.resolve(process.env.LOCAL_STORAGE_DIR)
      : path.join(process.cwd(), "uploads");
    modelPath = path.join(uploadsRoot, modelPath.replace("/uploads/", ""));
  }

  // AOI-A — nếu đường DB (có thể là absolute cũ) không tồn tại, thử đường cấu hình env
  // (AI_DINOV2_MODEL_PATH / default repo-relative) trước khi ném. Loader vẫn TRUNG THỰC:
  // không có file ở CẢ HAI nơi → ném lỗi rõ ràng → caller degrade sang tier khác.
  if (!fs.existsSync(modelPath)) {
    const envPath = getDinov2ModelPath();
    if (envPath !== modelPath && fs.existsSync(envPath)) {
      console.warn(
        `[aiImageEmbedding] model ${model.code} DB filePath not found (${modelPath}); ` +
          `using configured AI_DINOV2_MODEL_PATH instead: ${envPath}`,
      );
      modelPath = envPath;
    } else {
      throw new Error(
        `Embedding model file not found for ${model.code}: DB path ${modelPath}` +
          (envPath !== modelPath ? ` (also absent at configured path ${envPath})` : "") +
          ` — falling back to degraded embedding tier (text-of-image/heuristic); no embedding fabricated.`,
      );
    }
  }

  const providers: string[] = [];
  if (process.env.ENABLE_CUDA === "true") providers.push("cuda");
  providers.push("cpu");

  // Pha 1 Task 5 (I-2) — CHỈ KHAI BÁO. Mức `production`: embedding ảnh phục vụ phát hiện bất
  // thường trên đường kiểm tra AOI (spec §5.2). Telemetry hỏng ⇒ giấy phép rỗng, lượt tạo
  // session chạy y nguyên như trước.
  let vramTicket: import("./vram/vramWiring").VramTicket = {
    commitMeasured: async () => {},
    release: () => {},
    noteRefCount: () => {},
  };
  try {
    const { beginVramAllocation } = await import("./vram/vramWiring");
    vramTicket = await beginVramAllocation({
      owner: `onnx-img:${model.code}`,
      kind: "onnx-session",
      priority: "production",
      filePath: modelPath,
      // I-1 — cùng ca với `aiInferenceEngine`: `evictEmbeddingSessionCache()` chỉ gỡ tham chiếu
      // JS, `ort.InferenceSession.release()` không được gọi ở đâu trong repo ⇒ KHÔNG chứng minh
      // được thiết bị đã nhả. Đánh dấu tường minh thay vì im lặng. Xem bảng bốn điểm nhả ở
      // `vram/vramWiring.ts`.
      releaseProof: "unverified",
    });
  } catch (err) {
    // ★★★ Pha 2B Task 5 — TỪ CHỐI ≠ TELEMETRY HỎNG: nuốt ở đây là TẮT cưỡng chế tại điểm gọi này.
    if (isVramRefusal(err)) throw err;
    /* telemetry KHÔNG được làm hỏng đường tạo session */
  }

  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: providers,
    graphOptimizationLevel: "all",
    // ⚠ `.catch()` để dòng `create(...)` đứng nguyên văn — xem ghi chú cùng loại ở
    // aiInferenceEngine.getSession(). Chỉ trả chỗ rồi ném lại NGUYÊN lỗi cũ.
  }).catch((err: unknown) => {
    vramTicket.release();
    throw err;
  });

  await vramTicket.commitMeasured();
  // Không có khoá in-flight ⇒ trả giấy phép cũ trước khi ghi đè (cùng khuôn ba hộ ONNX kia).
  releaseEmbeddingSessionVramTicket(cacheKey);
  embeddingSessionVramTickets.set(cacheKey, vramTicket);

  embeddingSessionCache.set(cacheKey, session);
  return session;
}

/**
 * ⚠ I-1 (review TOÀN NHÁNH) — hai điều người sau phải biết trước khi tin hàm này:
 *
 *   1. **Hàm này KHÔNG CÓ NGƯỜI GỌI trong mã sản xuất** (grep toàn repo: chỉ định nghĩa ở đây và
 *      một lời gọi trong test). `embeddingSessionCache` không có LRU, không có trần kích thước.
 *      ⇒ trên thực tế giấy phép của hộ thứ bảy KHÔNG BAO GIỜ được trả trong một tiến trình sống.
 *      Điều đó nghe như rò rỉ, nhưng nó TRUNG THỰC: session cũng không bao giờ được nhả khỏi
 *      thiết bị, nên sổ và thiết bị vẫn khớp nhau. Cái sai nằm ở tầng dưới (session rò), không
 *      phải ở sổ.
 *   2. Khi có người gọi, lượt nhả này là lượt nhả **KHÔNG CÓ BẰNG CHỨNG** — xoá khỏi Map chỉ gỡ
 *      tham chiếu JS, `ort.InferenceSession.release()` không tồn tại trong repo. Vì vậy giấy
 *      phép được xin kèm `releaseProof: "unverified"` (xem `getEmbeddingSession()`), và sự kiện
 *      `release` ghi lại đúng như thế.
 *
 * Kỷ luật đầy đủ + bảng bốn điểm nhả: đầu `server/services/vram/vramWiring.ts`.
 */
export function evictEmbeddingSessionCache(modelId: number) {
  for (const [key] of embeddingSessionCache) {
    if (key.startsWith(`emb:${modelId}:`)) {
      embeddingSessionCache.delete(key);
      // Pha 1 Task 5 (I-2) — session rời cache thì sổ cũng phải nhả, nếu không giấy phép treo
      // vĩnh viễn và reconciler báo lệch ÂM giả.
      releaseEmbeddingSessionVramTicket(key);
    }
  }
}

// ─── Image Preprocessing ─────────────────────────────────────────────────────

async function preprocessForEmbedding(
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
  const totalPixels = width * height;
  const tensor = new Float32Array(channels * totalPixels);

  for (let c = 0; c < channels; c++) {
    for (let i = 0; i < totalPixels; i++) {
      const rawIndex = i * channels + c;
      const pixelValue = raw[rawIndex] / 255.0;
      const normalized = (pixelValue - (mean[c] ?? 0)) / (std[c] ?? 1);
      tensor[c * totalPixels + i] = normalized; // channel-first
    }
  }

  return tensor;
}

// ─── Extract Embedding ───────────────────────────────────────────────────────

/**
 * B4 — Pool một vector embedding 1-D từ output ONNX thô + dims thật của tensor.
 *
 * Hỗ trợ generic theo LAYOUT (không đoán — đọc `dims` thật từ tensor):
 *  - 3-D `[batch, T, D]` (vd DINOv2 `[1,257,384]` / dinov2-base `[1,257,768]`):
 *      transformer last_hidden_state → lấy CLS token = token 0 = D giá trị ĐẦU TIÊN
 *      (slice(0, D)). pooling="cls".
 *  - 2-D `[1, D]` hoặc 1-D `[D]` (embedding đã phẳng — ResNet/CLIP/pooled cũ):
 *      dùng nguyên toàn bộ data. pooling="flat" (backward-compatible).
 *  - Khác / dims rỗng: fallback dùng nguyên data phẳng (an toàn, không ném lỗi).
 *
 * Trả vector CHƯA L2-normalize (caller chịu trách nhiệm normalize) + dim + pooling.
 * Pure → unit-test được không cần ONNX session.
 */
export function poolEmbeddingFromOutput(
  data: ArrayLike<number>,
  dims: number[] | undefined | null,
): { vector: number[]; dim: number; pooling: "cls" | "flat" } {
  const flat = Array.from(data as ArrayLike<number>);

  // 3-D transformer output [batch, tokens, dim] → CLS = token 0 = slice(0, D).
  if (Array.isArray(dims) && dims.length === 3) {
    const D = dims[2];
    if (D > 0 && flat.length >= D) {
      return { vector: flat.slice(0, D), dim: D, pooling: "cls" };
    }
  }

  // 2-D [1, D] / 1-D [D] / phẳng → dùng nguyên.
  return { vector: flat, dim: flat.length, pooling: "flat" };
}

/**
 * Extract embedding vector from an image using an ONNX model.
 *
 * Hỗ trợ 2 họ model:
 *  - Transformer embedding (DINOv2): output 3-D `last_hidden_state [1, T, D]` →
 *    pool CLS token (token 0) → vector D-dim (vd 384 cho dinov2-small, 768 cho base).
 *  - Embedding phẳng cũ (ResNet/CLIP/pooled): output 2-D `[1,D]` / 1-D `[D]` →
 *    dùng nguyên (backward-compatible).
 * Layout được suy từ `output.dims` THẬT (không đoán). Vector trả về đã L2-normalize.
 */
export async function extractEmbedding(
  modelId: number,
  imageBuffer: Buffer,
): Promise<EmbeddingResult> {
  const startTime = Date.now();
  const model = await getAiModelById(modelId);
  if (!model) throw new Error(`Embedding model ${modelId} not found`);
  if (model.status !== "ACTIVE") throw new Error(`Model ${model.code} is not active`);

  const session = await getEmbeddingSession(model);

  const preprocessConfig = (model.preprocessConfig as AiModel["preprocessConfig"]) ?? {
    resize: { width: 224, height: 224 },
    colorSpace: "RGB" as const,
    channelFirst: true,
  };
  const tensorData = await preprocessForEmbedding(imageBuffer, preprocessConfig);

  const inputShape = (model.inputShape as number[]) ?? [1, 3, 224, 224];
  const inputTensor = new ort.Tensor("float32", tensorData, inputShape);
  const inputName = session.inputNames[0];
  if (!inputName) throw new Error("Model has no input names");

  // W7-D (gap V6): embedding extraction shares the per-GPU concurrency
  // semaphore (AI_GPU_CONCURRENCY) with the inference engine so DINOv2 +
  // classifier sessions cannot thrash the GPU concurrently.
  const results = await gpuSessionSemaphore.run(() => session.run({ [inputName]: inputTensor }));

  // Try to find an "embedding" or "feature" output, otherwise use last output
  const embOutputName =
    session.outputNames.find((n) => /embed|feature|pool/i.test(n)) ??
    session.outputNames[session.outputNames.length - 1];

  const embOutput = results[embOutputName!];
  if (!embOutput) throw new Error("No embedding output found");

  // Pool theo dims THẬT của tensor: 3-D [1,T,D] → CLS token (slice 0..D); phẳng → nguyên.
  const { vector } = poolEmbeddingFromOutput(
    embOutput.data as Float32Array,
    embOutput.dims as number[],
  );

  // L2 normalize → unit vector (cosine = dot).
  const embedding = l2normalize(vector);

  return {
    embedding,
    dim: embedding.length,
    modelCode: model.code,
    processingTimeMs: Date.now() - startTime,
  };
}

// ─── Ensure pgvector extension ───────────────────────────────────────────────

let _pgvectorChecked = false;
let _pgvectorAvailable = false;

async function ensurePgvector() {
  if (_pgvectorChecked) {
    if (!_pgvectorAvailable) {
      throw new Error(
        "Image similarity search requires PostgreSQL pgvector support. Install the 'vector' extension on the database server, then retry the similarity search action.",
      );
    }
    return;
  }

  const db = await getDb();
  if (!db) {
    throw new DbUnavailableError();
  }

  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    _pgvectorChecked = true;
    _pgvectorAvailable = true;
  } catch (e) {
    console.warn("[aiImageEmbedding] Could not create vector extension:", e);
    _pgvectorChecked = true;
    _pgvectorAvailable = false;
    throw new Error(
      "Image similarity search requires PostgreSQL pgvector support. Install the 'vector' extension on the database server, then retry the similarity search action.",
    );
  }
}

// ─── Store Embedding ─────────────────────────────────────────────────────────

export async function storeEmbedding(params: {
  inspectionId?: number;
  measurementResultId?: number;
  imageUrl: string;
  embedding: number[];
  dim: number;
  modelCode: string;
  label?: string;
  confidence?: number;
  defectType?: string;
  machineId?: number;
  productModelId?: number;
  metadata?: Record<string, unknown>;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();

  const embeddingStr = formatVectorLiteral(params.embedding);
  const metaStr = params.metadata != null ? JSON.stringify(params.metadata) : null;

  // INSERT bằng raw SQL chỉ nêu các cột CÓ THẬT — KHÔNG đụng `embedding_vec` (cột pgvector).
  // Lý do: drizzle `.insert().values()` luôn phát cột embedding_vec=default, sẽ FAIL trên DB
  // không cài pgvector (cột không tồn tại). Cột pgvector vẫn được set ở bước UPDATE bên dưới
  // (chỉ cho dim 1024 + best-effort). Trên DB có pgvector, embedding_vec để NULL rồi UPDATE.
  const inserted: any = await db.execute(sql`
    INSERT INTO ai_image_embeddings
      ("inspectionId", "measurementResultId", "imageUrl", "embedding", "embeddingDim",
       "modelCode", "label", "confidence", "defectType", "machineId", "productModelId", "metadata")
    VALUES
      (${params.inspectionId ?? null}, ${params.measurementResultId ?? null}, ${params.imageUrl},
       ${embeddingStr}, ${params.dim}, ${params.modelCode}, ${params.label ?? null},
       ${params.confidence?.toFixed(4) ?? null}, ${params.defectType ?? null},
       ${params.machineId ?? null}, ${params.productModelId ?? null}, ${metaStr}::json)
    RETURNING id
  `);
  // db.execute shape varies by driver (postgres-js RowList vs node-postgres {rows}).
  const insertedId: number = Array.isArray(inserted)
    ? inserted[0]?.id
    : inserted?.rows?.[0]?.id;

  // Ghi đồng thời cột pgvector embedding_vec cho dòng 1024-dim (cùng không gian KB).
  // Best-effort: nếu pgvector/cột chưa sẵn sàng → bỏ qua, cột TEXT vẫn là nguồn raw.
  if (params.dim === DEFAULT_EMBEDDING_DIM && insertedId != null) {
    try {
      await db.execute(
        sql`UPDATE ai_image_embeddings SET embedding_vec = ${embeddingStr}::vector(${sql.raw(String(DEFAULT_EMBEDDING_DIM))}) WHERE id = ${insertedId}`,
      );
    } catch (e) {
      console.warn("[aiImageEmbedding] storeEmbedding: skip embedding_vec write (pgvector unavailable):", (e as Error)?.message);
    }
  }

  return insertedId;
}

// ─── Find Similar Images ─────────────────────────────────────────────────────

export interface VectorSearchFilters {
  machineId?: number;
  productModelId?: number;
  label?: string;
  defectType?: string;
  minSimilarity?: number;
  excludeId?: number;
  // B4.1 — ràng buộc không gian vector: chỉ so với rows cùng modelCode (tránh trộn
  // ONNX-dim vs text-of-image dù trùng dim). Khi không set → không lọc theo modelCode.
  modelCode?: string;
}

export interface SimilarSearchOutcome {
  results: SimilarImage[];
  searchMode: SearchMode;
}

/** HNSW ef_search runtime tuning (recall/latency tradeoff). */
const HNSW_EF_SEARCH = Math.max(10, Math.min(Number(process.env.IMG_EMB_HNSW_EF_SEARCH ?? 64), 1000));

function buildVectorWhere(filters?: VectorSearchFilters, opts?: { requireVecCol?: boolean }) {
  const whereParts: ReturnType<typeof sql>[] = [];
  if (filters?.excludeId != null) whereParts.push(sql`id != ${Number(filters.excludeId)}`);
  if (filters?.machineId != null) whereParts.push(sql`"machineId" = ${Number(filters.machineId)}`);
  if (filters?.productModelId != null) whereParts.push(sql`"productModelId" = ${Number(filters.productModelId)}`);
  if (filters?.label) whereParts.push(sql`"label" = ${filters.label}`);
  if (filters?.defectType) whereParts.push(sql`"defectType" = ${filters.defectType}`);
  if (filters?.modelCode) whereParts.push(sql`"modelCode" = ${filters.modelCode}`);
  if (opts?.requireVecCol) whereParts.push(sql`embedding_vec IS NOT NULL`);
  return whereParts.length > 0 ? sql`WHERE ${sql.join(whereParts, sql` AND `)}` : sql``;
}

function mapRowToSimilar(r: any): SimilarImage {
  return {
    id: r.id,
    inspectionId: r.inspectionId,
    measurementResultId: r.measurementResultId,
    imageUrl: r.imageUrl,
    label: r.label,
    defectType: r.defectType,
    machineId: r.machineId,
    productModelId: r.productModelId,
    similarity: parseFloat(r.similarity),
    createdAt: new Date(r.createdAt),
  };
}

/**
 * Brute-force cosine trong Node: tải tối đa BRUTEFORCE_SCAN_LIMIT dòng (cùng dim),
 * parse TEXT embedding, tính dot/cosine, sort giảm dần. Fallback khi DB không
 * cast được vector (pgvector thiếu). Chỉ hợp quy mô nhỏ.
 */
async function bruteForceCosine(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  embedding: number[],
  dim: number,
  limit: number,
  filters?: VectorSearchFilters,
): Promise<SimilarImage[]> {
  const conditions = [];
  if (filters?.excludeId != null) conditions.push(sql`id != ${Number(filters.excludeId)}` as any);
  if (filters?.machineId != null) conditions.push(eq(aiImageEmbeddings.machineId, Number(filters.machineId)));
  if (filters?.productModelId != null) conditions.push(eq(aiImageEmbeddings.productModelId, Number(filters.productModelId)));
  if (filters?.label) conditions.push(eq(aiImageEmbeddings.label, filters.label));
  if (filters?.defectType) conditions.push(eq(aiImageEmbeddings.defectType, filters.defectType));
  if (filters?.modelCode) conditions.push(eq(aiImageEmbeddings.modelCode, filters.modelCode));
  // Chỉ so cùng không gian chiều.
  conditions.push(eq(aiImageEmbeddings.embeddingDim, dim));

  const rows = await db
    .select({
      id: aiImageEmbeddings.id,
      inspectionId: aiImageEmbeddings.inspectionId,
      measurementResultId: aiImageEmbeddings.measurementResultId,
      imageUrl: aiImageEmbeddings.imageUrl,
      label: aiImageEmbeddings.label,
      defectType: aiImageEmbeddings.defectType,
      machineId: aiImageEmbeddings.machineId,
      productModelId: aiImageEmbeddings.productModelId,
      embedding: aiImageEmbeddings.embedding,
      createdAt: aiImageEmbeddings.createdAt,
    })
    .from(aiImageEmbeddings)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(aiImageEmbeddings.createdAt))
    .limit(BRUTEFORCE_SCAN_LIMIT);

  const minSim = filters?.minSimilarity ?? 0;
  const scored: SimilarImage[] = [];
  for (const row of rows) {
    const vec = parseVectorLiteral(row.embedding);
    if (vec.length !== embedding.length) continue;
    const sim = cosineSimilarity(embedding, vec);
    if (sim < minSim) continue;
    scored.push({
      id: row.id,
      inspectionId: row.inspectionId,
      measurementResultId: row.measurementResultId,
      imageUrl: row.imageUrl,
      label: row.label,
      defectType: row.defectType,
      machineId: row.machineId,
      productModelId: row.productModelId,
      similarity: sim,
      createdAt: new Date(row.createdAt),
    });
  }
  scored.sort((a, b) => b.similarity - a.similarity || b.createdAt.getTime() - a.createdAt.getTime());
  return scored.slice(0, limit);
}

/**
 * Tìm ảnh tương tự theo vector + cờ chế độ (nhiều tầng fallback, offline-first):
 *   HNSW (embedding_vec) → cast runtime (embedding TEXT) → brute-force Node.
 * Trả về kèm searchMode để UI hiển thị.
 */
export async function findSimilarByVectorWithMode(
  embedding: number[],
  dim: number,
  limit: number = 10,
  filters?: VectorSearchFilters,
): Promise<SimilarSearchOutcome> {
  const db = await getDb();
  if (!db) return { results: [], searchMode: "metadata" };

  const embStr = formatVectorLiteral(embedding);
  const minSim = filters?.minSimilarity ?? 0;
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 100));
  const safeDim = Math.max(1, Math.min(Number(dim) || DEFAULT_EMBEDDING_DIM, 4096));
  const dimRaw = sql.raw(String(safeDim));

  // ── Tầng 1: HNSW trên cột embedding_vec (chỉ áp dụng không gian 1024-dim) ──
  if (safeDim === DEFAULT_EMBEDDING_DIM) {
    try {
      await db.execute(sql`SET LOCAL hnsw.ef_search = ${sql.raw(String(HNSW_EF_SEARCH))}`);
    } catch {
      // SET LOCAL chỉ có hiệu lực trong transaction; ngoài transaction sẽ NOTICE — bỏ qua.
    }
    try {
      const whereClause = buildVectorWhere(filters, { requireVecCol: true });
      const query = sql`
        SELECT
          id, "inspectionId", "measurementResultId", "imageUrl",
          "label", "defectType", "machineId", "productModelId", "createdAt",
          1 - (embedding_vec <=> ${embStr}::vector(${dimRaw})) as similarity
        FROM ai_image_embeddings
        ${whereClause}
        ORDER BY embedding_vec <=> ${embStr}::vector(${dimRaw})
        LIMIT ${safeLimit}
      `;
      const result = (await db.execute(query)) as any;
      const results = (result.rows as any[])
        .filter((r) => parseFloat(r.similarity) >= minSim)
        .map(mapRowToSimilar);
      return { results, searchMode: "hnsw" };
    } catch (e) {
      console.warn("[aiImageEmbedding] HNSW search unavailable, falling back to runtime cast:", (e as Error)?.message);
    }
  }

  // ── Tầng 2: cast runtime trên cột TEXT (full scan, chính xác) ──
  try {
    const whereClause = buildVectorWhere({ ...filters }, { requireVecCol: false });
    // Ràng buộc cùng dim để tránh trộn vector khác chiều khi cast.
    const dimGuard = sql`"embeddingDim" = ${safeDim}`;
    const fullWhere = whereClause === sql``
      ? sql`WHERE ${dimGuard}`
      : sql`${whereClause} AND ${dimGuard}`;
    const query = sql`
      SELECT
        id, "inspectionId", "measurementResultId", "imageUrl",
        "label", "defectType", "machineId", "productModelId", "createdAt",
        1 - (embedding::vector(${dimRaw}) <=> ${embStr}::vector(${dimRaw})) as similarity
      FROM ai_image_embeddings
      ${fullWhere}
      ORDER BY embedding::vector(${dimRaw}) <=> ${embStr}::vector(${dimRaw})
      LIMIT ${safeLimit}
    `;
    const result = (await db.execute(query)) as any;
    const results = (result.rows as any[])
      .filter((r) => parseFloat(r.similarity) >= minSim)
      .map(mapRowToSimilar);
    return { results, searchMode: "exact" };
  } catch (e) {
    console.warn("[aiImageEmbedding] Runtime vector cast unavailable, falling back to Node brute-force:", (e as Error)?.message);
  }

  // ── Tầng 3: brute-force cosine trong Node ──
  const results = await bruteForceCosine(db, embedding, safeDim, safeLimit, filters);
  return { results, searchMode: "bruteforce" };
}

/**
 * Back-compat: trả về SimilarImage[] (bỏ cờ mode). Giữ chữ ký cũ cho callers hiện có.
 */
export async function findSimilarByVector(
  embedding: number[],
  dim: number,
  limit: number = 10,
  filters?: VectorSearchFilters,
): Promise<SimilarImage[]> {
  const { results } = await findSimilarByVectorWithMode(embedding, dim, limit, filters);
  return results;
}

/**
 * Find similar images by embedding ID. Trả kèm searchMode.
 */
export async function findSimilarByIdWithMode(
  imageEmbeddingId: number,
  limit: number = 10,
  filters?: Omit<VectorSearchFilters, "excludeId">,
): Promise<SimilarSearchOutcome> {
  const db = await getDb();
  if (!db) return { results: [], searchMode: "metadata" };

  const source = await db
    .select()
    .from(aiImageEmbeddings)
    .where(eq(aiImageEmbeddings.id, imageEmbeddingId))
    .limit(1);

  if (!source[0]) throw new Error(`Embedding ${imageEmbeddingId} not found`);

  return findSimilarByVectorWithMode(
    parseVectorLiteral(source[0].embedding),
    source[0].embeddingDim,
    limit,
    { ...filters, excludeId: imageEmbeddingId },
  );
}

/** Back-compat: trả về SimilarImage[]. */
export async function findSimilarById(
  imageEmbeddingId: number,
  limit: number = 10,
  filters?: Omit<VectorSearchFilters, "excludeId">,
): Promise<SimilarImage[]> {
  const { results } = await findSimilarByIdWithMode(imageEmbeddingId, limit, filters);
  return results;
}

/**
 * Upload image → embedding → tìm ảnh tương tự (WS-3 pipeline text-of-image).
 *
 * Mặc định (modelId == null): mô tả ảnh bằng LLM (describeDefect) → embed text
 * qua Ollama (mxbai-embed-large, 1024-dim) → vector search nhiều tầng.
 * Nếu Ollama/describe lỗi → fallback metadata keyword (searchMode="metadata").
 *
 * Khi truyền modelId (legacy ONNX), vẫn hỗ trợ extractEmbedding để back-compat.
 */
/**
 * B4.1 — Resolve model ONNX embedding mặc định cho image search.
 *
 * Quy tắc:
 *  - IMAGE_EMBEDDING_DEFAULT="text" (mặc định) → KHÔNG dùng ONNX (giữ text-of-image).
 *  - IMAGE_EMBEDDING_DEFAULT="onnx" → tìm model ONNX modelType "embedding" ACTIVE:
 *      • nếu có productModelId → ưu tiên getActiveModelForProduct(productModelId,"embedding").
 *      • không có/không khớp → model embedding ACTIVE đầu tiên (getAiModels).
 *  - Không có model phù hợp → null (caller degrade về text-of-image).
 *
 * Trả model (hoặc null). Hàm thuần đọc DB, an toàn khi DB null (getAiModels → []).
 */
export async function resolveDefaultImageEmbeddingModel(
  productModelId?: number,
): Promise<AiModel | null> {
  if (IMAGE_EMBEDDING_DEFAULT !== "onnx") return null;

  if (productModelId != null) {
    const m = await getActiveModelForProduct(productModelId, "embedding");
    if (m && m.status === "ACTIVE" && m.format === "ONNX") return m;
  }

  const candidates = await getAiModels({
    modelType: "embedding",
    format: "ONNX",
    status: "ACTIVE",
    limit: 1,
  });
  return candidates[0] ?? null;
}

export async function searchByImage(
  modelId: number | undefined,
  imageBuffer: Buffer,
  limit: number = 10,
  filters?: VectorSearchFilters,
): Promise<{
  results: SimilarImage[];
  embedding: EmbeddingResult;
  searchMode: SearchMode;
  embeddingSource: EmbeddingSource;
}> {
  try {
    let embResult: EmbeddingResult;
    let embeddingSource: EmbeddingSource;

    if (modelId != null) {
      // Legacy/explicit ONNX model → vector thật.
      embResult = await extractEmbedding(modelId, imageBuffer);
      embeddingSource = "onnx";
    } else {
      // B4.1 — thử resolve model ONNX embedding mặc định; không có → text-of-image.
      const onnxModel = await resolveDefaultImageEmbeddingModel(filters?.productModelId);
      if (onnxModel) {
        embResult = await extractEmbedding(onnxModel.id, imageBuffer);
        embeddingSource = "onnx";
      } else {
        embResult = await embedImageAsText(imageBuffer);
        embeddingSource = "text-of-image";
      }
    }

    // RÀNG BUỘC KHÔNG GIAN VECTOR (B4.1): với nguồn ONNX, lọc thêm theo modelCode để
    // không trộn vector ONNX-dim với text-of-image (kể cả khi tình cờ trùng dim).
    // findSimilarByVectorWithMode cũng đã guard theo dim (HNSW chỉ cho 1024-dim; ONNX-dim
    // ≠ 1024 rơi exact-cast/brute-force cùng dim → degrade hiệu năng trung thực).
    const vectorFilters: VectorSearchFilters =
      embeddingSource === "onnx"
        ? { ...filters, modelCode: embResult.modelCode }
        : (filters ?? {});
    const { results, searchMode } = await findSimilarByVectorWithMode(
      embResult.embedding,
      embResult.dim,
      limit,
      vectorFilters,
    );
    return { results, embedding: embResult, searchMode, embeddingSource };
  } catch (error) {
    console.warn("[aiImageEmbedding] Falling back to metadata search:", error);
    const fallback = await searchByMetadataFallback(imageBuffer, limit, filters);
    return { ...fallback, searchMode: "metadata", embeddingSource: "metadata" };
  }
}

// ─── Batch Embedding ─────────────────────────────────────────────────────────

/**
 * Bulk extract and store embeddings for multiple images.
 * Returns count of successfully processed images.
 */
export async function batchStoreEmbeddings(
  modelId: number,
  images: Array<{
    imageBuffer: Buffer;
    imageUrl: string;
    inspectionId?: number;
    measurementResultId?: number;
    label?: string;
    confidence?: number;
    defectType?: string;
    machineId?: number;
    productModelId?: number;
  }>,
): Promise<{ processed: number; failed: number; errors: string[] }> {
  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const img of images) {
    try {
      const embResult = await extractEmbedding(modelId, img.imageBuffer);
      await storeEmbedding({
        inspectionId: img.inspectionId,
        measurementResultId: img.measurementResultId,
        imageUrl: img.imageUrl,
        embedding: embResult.embedding,
        dim: embResult.dim,
        modelCode: embResult.modelCode,
        label: img.label,
        confidence: img.confidence,
        defectType: img.defectType,
        machineId: img.machineId,
        productModelId: img.productModelId,
      });
      processed++;
    } catch (err: any) {
      failed++;
      errors.push(`${img.imageUrl}: ${err.message}`);
    }
  }

  return { processed, failed, errors };
}

// ─── Cluster Defects ─────────────────────────────────────────────────────────

/**
 * Simple greedy clustering: pick unclustered item with most neighbors,
 * form cluster from all items within similarity threshold, repeat.
 */
export async function clusterDefects(params: {
  machineId?: number;
  productModelId?: number;
  label?: string;
  minSimilarity?: number;
  maxClusters?: number;
  limit?: number;
}): Promise<ClusterResult[]> {
  const db = await getDb();
  if (!db) return [];

  // Fetch all embeddings matching filters
  const conditions = [];
  if (params.machineId != null) {
    conditions.push(eq(aiImageEmbeddings.machineId, params.machineId));
  }
  if (params.productModelId != null) {
    conditions.push(eq(aiImageEmbeddings.productModelId, params.productModelId));
  }
  if (params.label) {
    conditions.push(eq(aiImageEmbeddings.label, params.label));
  }

  const queryLimit = params.limit ?? 500;
  const rows = await db
    .select({
      id: aiImageEmbeddings.id,
      imageUrl: aiImageEmbeddings.imageUrl,
      label: aiImageEmbeddings.label,
      embedding: aiImageEmbeddings.embedding,
      embeddingDim: aiImageEmbeddings.embeddingDim,
    })
    .from(aiImageEmbeddings)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(aiImageEmbeddings.createdAt))
    .limit(queryLimit);

  if (rows.length === 0) return [];

  // Parse embeddings
  const items = rows.map((r: { id: number; imageUrl: string; label: string | null; embedding: string; embeddingDim: number }) => ({
    id: r.id,
    imageUrl: r.imageUrl,
    label: r.label,
    vec: JSON.parse(r.embedding) as number[],
  }));

  const threshold = params.minSimilarity ?? 0.85;
  const maxClusters = params.maxClusters ?? 20;
  const assigned = new Set<number>();
  const clusters: ClusterResult[] = [];

  // Cosine similarity between L2-normalized vectors = dot product
  function cosineSim(a: number[], b: number[]): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
  }

  while (assigned.size < items.length && clusters.length < maxClusters) {
    // Find unassigned item with most neighbors above threshold
    let bestIdx = -1;
    let bestNeighborCount = -1;

    for (let i = 0; i < items.length; i++) {
      if (assigned.has(i)) continue;
      let neighborCount = 0;
      for (let j = 0; j < items.length; j++) {
        if (i === j || assigned.has(j)) continue;
        if (cosineSim(items[i].vec, items[j].vec) >= threshold) neighborCount++;
      }
      if (neighborCount > bestNeighborCount) {
        bestNeighborCount = neighborCount;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;

    // Form cluster
    const centroid = items[bestIdx];
    const members: ClusterResult["members"] = [];
    assigned.add(bestIdx);
    members.push({ id: centroid.id, imageUrl: centroid.imageUrl, label: centroid.label, similarity: 1.0 });

    for (let j = 0; j < items.length; j++) {
      if (assigned.has(j)) continue;
      const sim = cosineSim(centroid.vec, items[j].vec);
      if (sim >= threshold) {
        assigned.add(j);
        members.push({ id: items[j].id, imageUrl: items[j].imageUrl, label: items[j].label, similarity: sim });
      }
    }

    members.sort((a, b) => b.similarity - a.similarity);

    clusters.push({
      clusterId: clusters.length + 1,
      centroidImageId: centroid.id,
      memberCount: members.length,
      members,
    });
  }

  return clusters;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export async function getEmbeddingStats(filters?: {
  machineId?: number;
  productModelId?: number;
}) {
  const empty = {
    totalEmbeddings: 0,
    distinctModels: 0,
    distinctLabels: 0,
    latestAt: null as Date | null,
    indexedCount: 0,
    pgvectorAvailable: false,
    defaultDim: DEFAULT_EMBEDDING_DIM,
  };

  const db = await getDb();
  if (!db) return empty;

  const conditions = [];
  if (filters?.machineId != null) {
    conditions.push(eq(aiImageEmbeddings.machineId, filters.machineId));
  }
  if (filters?.productModelId != null) {
    conditions.push(eq(aiImageEmbeddings.productModelId, filters.productModelId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db
    .select({
      totalEmbeddings: sql<number>`count(*)`,
      distinctModels: sql<number>`count(distinct ${aiImageEmbeddings.modelCode})`,
      distinctLabels: sql<number>`count(distinct ${aiImageEmbeddings.label})`,
      latestAt: sql<Date>`max(${aiImageEmbeddings.createdAt})`,
    })
    .from(aiImageEmbeddings)
    .where(whereClause);

  const base = result[0] ?? { totalEmbeddings: 0, distinctModels: 0, distinctLabels: 0, latestAt: null };

  // indexedCount = số dòng đã có embedding_vec (đã index pgvector). pgvectorAvailable
  // suy ra từ việc query cột thành công. Best-effort: nếu cột/pgvector chưa có → 0/false.
  let indexedCount = 0;
  let pgvectorAvailable = false;
  try {
    // Truy vấn cột mới qua raw SQL, bọc try/catch để không lỗi nếu cột/pgvector chưa có.
    const vecConds: ReturnType<typeof sql>[] = [sql`embedding_vec IS NOT NULL`];
    if (filters?.machineId != null) vecConds.push(sql`"machineId" = ${Number(filters.machineId)}`);
    if (filters?.productModelId != null) vecConds.push(sql`"productModelId" = ${Number(filters.productModelId)}`);
    const vecRes = (await db.execute(
      sql`SELECT count(*)::int AS c FROM ai_image_embeddings WHERE ${sql.join(vecConds, sql` AND `)}`,
    )) as any;
    indexedCount = Number(vecRes.rows?.[0]?.c ?? 0);
    pgvectorAvailable = true;
  } catch {
    indexedCount = 0;
    pgvectorAvailable = false;
  }

  return {
    totalEmbeddings: Number(base.totalEmbeddings ?? 0),
    distinctModels: Number(base.distinctModels ?? 0),
    distinctLabels: Number(base.distinctLabels ?? 0),
    latestAt: base.latestAt ?? null,
    indexedCount,
    pgvectorAvailable,
    defaultDim: DEFAULT_EMBEDDING_DIM,
  };
}
