/**
 * AI GGUF Model Engine — Local LLM inference via node-llama-cpp
 * 
 * Supports .gguf model files for:
 *  - Text generation (defect description, report narration)
 *  - Chat completions (manufacturing copilot)
 *  - Structured JSON output (analysis, classification)
 *  - Embedding extraction (for similarity search)
 * 
 * Key features:
 *  - Session/model caching for fast repeated inference
 *  - GPU acceleration (CUDA/Vulkan) when available
 *  - Configurable context size, temperature, top-p
 *  - Streaming support for chat UIs
 *  - Automatic model discovery from uploads directory
 */

import path from "path";
import fs from "fs";
// ★★★ Pha 2B Task 5 — vị từ "lỗi này có phải LỜI TỪ CHỐI không". Import TĨNH của một module
// LÁ (không import gì, không I/O): nó phải dùng được NGAY TRONG `catch` của một lượt
// `await import()` vừa hỏng. Xem `vramRefusalSignal.ts` để biết vì sao so TÊN, không `instanceof`.
import { isVramRefusal } from "./vram/vramRefusalSignal";
import { withGgufSlot, withGgufSlotGenerator, getGgufQueueStats } from "./ggufConcurrency";
// Read-only telemetry hook (TASK A): observeInference is a no-op when METRICS_ENABLED is off
// and never throws. Imported only to record per-generation latency into the histogram.
import { observeInference } from "./aiMetrics";
// doc69 G2-5b — shared env→basename resolver (see server/services/ai/modelResolver.ts). Aliased
// on import because this file re-exports its OWN codeModelBasename()/fimModelBasename() (kept for
// backward compat) which now simply delegate to these.
// doc69 W1-4 review fix — also import embedModelBasename(): the shared, suffix-safe resolver for
// GGUF_EMBED_MODEL (see the FIX comment at generateEmbedding/generateEmbeddings below for the
// live ".gguf.gguf" bug this closes).
// doc69 W1 "modelfix" — also import defaultModelBasename()/toBasename(): getOrLoadModel now has to
// tell a TEXT-GENERATION model from the EMBEDDING model, and it must do so by comparing against the
// SAME resolver every other call site uses (never a hard-coded ".gguf" filename).
import {
  codeModelBasename as resolveCodeModelBasename,
  fimModelBasename as resolveFimModelBasename,
  embedModelBasename as resolveEmbedModelBasename,
  defaultModelBasename as resolveDefaultModelBasename,
  toBasename,
} from "./ai/modelResolver";
// Pha 1 Task 5 — dây nối sổ cái VRAM. `import type` (bị xoá hoàn toàn lúc biên dịch) + `import()`
// động ở từng điểm cấp phát, để module telemetry KHÔNG nằm trên đường nạp của file này.
import type { VramTicket } from "./vram/vramWiring";

// ─── Types ─────────────────────────────────────────────────────

export interface GgufModelConfig {
  /** Model file path (absolute or relative to uploads) */
  modelPath: string;
  /** Context size in tokens. Default 4096 */
  contextSize?: number;
  /** GPU layers to offload. "max" = all (default), "auto" = as many as fit VRAM, or a number.
   *  NOTE: node-llama-cpp 3.x treats -1 as 0 (CPU) — do NOT use -1 to mean "all". */
  gpuLayers?: number | "max" | "auto";
  /** Number of threads for CPU inference. Default: auto */
  threads?: number;
  /** Batch size for prompt processing. Default 512 */
  batchSize?: number;
  /** Enable Flash Attention. Default true */
  flashAttention?: boolean;
  /** Đợt 2 Task 3 — TÍN HIỆU Ý ĐỊNH của lượt gọi (do getOrLoadModel() truyền khi
   *  purpose==="embed"), KHÔNG phải một đảm bảo model này không bao giờ sinh chữ. ⚠ review
   *  round 1 Critical-1: modelId có thể đến từ HTTP (aiGgufRouter.ts, protectedProcedure) và
   *  TRÙNG một model TEXT — cờ này KHÔNG đoán theo tên file nên không thể tự phát hiện trùng
   *  đó. Khi true, loadGgufModel() BỎ QUA context thường lúc nạp (model.createContext(),
   *  GGUF_DEFAULT_CTX×GGUF_SEQUENCES) để giành lại VRAM (đo Đợt 1: model+ctx thường thừa
   *  3.649 MiB so với embedding ctx thật 654 MiB, ~2,0 GB). Nếu model đó SAU ĐÓ bị dùng để
   *  sinh chữ (đúng modelId trùng lặp), ensureTextContext() (xem định nghĩa, gần
   *  unloadGgufModel()) tạo LƯỜI context còn thiếu — không throw, không cần restart. Model
   *  text nạp qua đường bình thường (purpose!=="embed") KHÔNG bị ảnh hưởng. */
  embeddingOnly?: boolean;
}

export interface GgufGenerateOptions {
  /** The prompt/system message */
  systemPrompt?: string;
  /** User message */
  prompt: string;
  /** Max tokens to generate. Default 1024 */
  maxTokens?: number;
  /** Temperature (0-2). Default 0.7 */
  temperature?: number;
  /** Top-p sampling. Default 0.9 */
  topP?: number;
  /** Top-k sampling. Default 40 */
  topK?: number;
  /** Repeat penalty. Default 1.1 */
  repeatPenalty?: number;
  /** Stop sequences */
  stopSequences?: string[];
  /** Force JSON output */
  jsonMode?: boolean;
  /** Language hint */
  language?: "en" | "vi";
  /**
   * B0.2 — Per-task KV-cache sizing hint. Requested context size (n_ctx) for the model
   * the FIRST time it is loaded. Trivial/fast tasks pass a small value so they don't
   * allocate a huge KV-cache. Ignored if the model is already resident (context is shared).
   */
  contextSize?: number;
}

export interface GgufChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GgufChatOptions {
  messages: GgufChatMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  jsonMode?: boolean;
  /** B0.2 — Per-task KV-cache sizing hint (n_ctx on first load). See GgufGenerateOptions.contextSize. */
  contextSize?: number;
}

export interface GgufModelInfo {
  id: string;
  filename: string;
  filePath: string;
  fileSize: number;
  fileSizeHuman: string;
  lastModified: Date;
  loaded: boolean;
}

export interface GgufGenerateResult {
  text: string;
  tokensGenerated: number;
  tokensPrompt: number;
  totalTimeMs: number;
  tokensPerSecond: number;
  modelId: string;
}

export interface GgufStreamChunk {
  type: "token" | "done" | "error";
  token?: string;
  /** Accumulated text so far (only on "done") */
  fullText?: string;
  tokensGenerated?: number;
  tokensPrompt?: number;
  totalTimeMs?: number;
  tokensPerSecond?: number;
  modelId?: string;
  error?: string;
}

// ─── Model Registry & Caching ──────────────────────────────────

interface LoadedModel {
  llama: any;
  model: any;
  /** Đợt 2 Task 3 — có thể là `undefined` NGAY SAU KHI NẠP khi `config.embeddingOnly===true`
   *  (model chỉ-nhúng — xem `loadGgufModel()`). ⚠ review round 1 Critical-1 SỬA LẠI bất biến sai
   *  ở bản đầu ("không bao giờ chạm model embeddingOnly"): `embeddingOnly` là cờ theo LƯỢT GỌI
   *  (`purpose==="embed"`), không phải theo MODEL — `loadedModels` cache theo `modelId` dùng
   *  CHUNG cho mọi purpose, và `modelId` của `generateEmbedding()` có thể đến từ HTTP
   *  (`aiGgufRouter.ts`, `protectedProcedure`) TRÙNG một model TEXT. Vì vậy KHÔNG có bất biến
   *  "model text luôn có `.context`" — 6 hàm sinh chữ đều gọi `ensureTextContext()` TRƯỚC khi
   *  đọc `.context` (tạo lười nếu thiếu, tự lành); `unloadGgufModel()` guard bằng
   *  `if (loaded.context)` trước khi dispose. */
  context: any;
  /** Cached embedding context — created lazily on first generateEmbedding(s) call, reused afterwards. */
  embeddingContext?: any;
  config: GgufModelConfig;
  loadedAt: Date;
  lastUsedAt: Date;
  useCount: number;
  /** Approx model size in bytes (from model.size). 0 if unavailable. */
  sizeBytes: number;
  /** In-flight reference count — a model with refCount > 0 must NOT be evicted. */
  refCount: number;
  /** Pha 1 Task 5 — giấy phép VRAM của TRỌNG SỐ (+ context tạo lúc nạp). Trả ở unloadGgufModel(). */
  vramTicket?: VramTicket;
  /** Pha 1 Task 5 — giấy phép VRAM của embedding context tạo LƯỜI (getEmbeddingContext). */
  embedCtxVramTicket?: VramTicket;
  /** Pha 1 Task 5 — giấy phép VRAM của context thường tạo LƯỜI (ensureTextContext). */
  textCtxVramTicket?: VramTicket;
}

const loadedModels = new Map<string, LoadedModel>();
let llamaInstance: any = null;
/**
 * Pha 1.5 Task 2 review vòng 1 (Important) — khoá in-flight cho `getLlama()`, đúng khuôn
 * `inFlightLoads`/`embeddingContextInFlight`/`textContextInFlight` của chính module này.
 * `getLlama()` không có "key" (một backend CHO CẢ TIẾN TRÌNH, không phải theo modelId) nên
 * đây là MỘT biến, không phải Map. Xem `getLlama()` để biết vì sao cần khoá này.
 */
let llamaInitInFlight: Promise<any> | null = null;

/** Đợt 1 Task 1 — chống race double-warm: hai nơi độc lập cùng gọi warmModel()
 *  (backgroundJobs.ts:126-127 delay 3000ms và aiLocalKnowledgeApi.ts:268 delay
 *  2000ms) khiến cùng một model 17 GB bị nạp hai lần chồng nhau ⇒ cudaMalloc lỗi
 *  (30B) hoặc rò bản sao mồ côi (4B, ~3.474 MiB, evictLRU không với tới).
 *  Khoá theo modelId: lượt thứ hai chờ lượt đầu thay vì nạp song song. */
const inFlightLoads = new Map<string, Promise<string>>();

const GGUF_MODELS_DIR = process.env.GGUF_MODELS_DIR
  ? path.resolve(process.env.GGUF_MODELS_DIR)
  : path.join(process.cwd(), "uploads", "gguf-models");

// ─── Config from env ───────────────────────────────────────────

// Dedicated embedding model id (e.g. mxbai) — resolved on-demand via modelResolver's
// `embedModelBasename()` at each call site (see generateEmbedding/generateEmbeddings below), NOT
// a raw module-level constant. FIX (doc69 W1-4 review) — this USED to be
// `const GGUF_EMBED_MODEL = process.env.GGUF_EMBED_MODEL || "";`, read RAW with no ".gguf" strip:
// a live `.env` value of `GGUF_EMBED_MODEL=Qwen3-Embedding-0.6B-f16.gguf` (suffix already present)
// fell straight through to `getOrLoadModel()`, which appends ".gguf" itself →
// "...f16.gguf.gguf" → throws. `embedModelBasename()` normalizes through the SAME
// `toBasename()`/`ensureGgufSuffix()` suffix-safe path every other resolver in this file uses, so
// a value with OR without ".gguf" always resolves to the correct single-".gguf" basename.
/** Expected embedding dimensions. Default 1024 (mxbai-embed-large). Mismatch => explicit error. */
const GGUF_EMBED_DIM = (() => {
  const n = parseInt(process.env.GGUF_EMBED_DIM || "1024", 10);
  return Number.isFinite(n) && n > 0 ? n : 1024;
})();
/** Max number of GGUF models kept resident simultaneously. Default 2. */
const GGUF_MAX_LOADED_MODELS = (() => {
  const n = parseInt(process.env.GGUF_MAX_LOADED_MODELS || "2", 10);
  return Number.isFinite(n) && n > 0 ? n : 2;
})();
/** Soft VRAM cap in MB. 0 = disabled (default). Opt-in because getVramState is unreliable on CPU/unified memory. */
const GGUF_MAX_VRAM_MB = (() => {
  const n = parseInt(process.env.GGUF_MAX_VRAM_MB || "0", 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
})();
/**
 * B0.1 — VRAM threshold guard (%): before loading another model, if VRAM usage is at/above
 * this percentage of total, evict LRU idle model(s) first; if none can be freed, log a clear
 * warning and DEFER rather than crash. ⚠ Pha 2B Task 5: đây KHÔNG còn là cổng quyết định —
 * `beginVramAllocation()` (cổng SỔ) đã chặn TRƯỚC lượt nạp; guard này chỉ còn dọn chỗ. Default 90. Set 0/100+ to
 * disable. Best-effort & fail-safe: telemetry failures never throw.
 */
const GGUF_VRAM_GUARD_PCT = (() => {
  const n = parseInt(process.env.GGUF_VRAM_GUARD_PCT || "90", 10);
  return Number.isFinite(n) && n > 0 && n < 100 ? n : 90;
})();
/** Number of parallel sequences per context. Default 4. */
const GGUF_SEQUENCES = (() => {
  const n = parseInt(process.env.GGUF_SEQUENCES || "4", 10);
  return Number.isFinite(n) && n > 0 ? n : 4;
})();
/**
 * B0.2 — Default context size (n_ctx) when neither caller nor router supplies a per-task hint.
 * Kept modest so we don't allocate a huge KV-cache by default (Qwen3 supports up to 256K but
 * that would cost large VRAM). Per-task hints from the Model Router override this on first load.
 */
const GGUF_DEFAULT_CTX = (() => {
  const n = parseInt(process.env.GGUF_DEFAULT_CTX || "4096", 10);
  return Number.isFinite(n) && n > 0 ? n : 4096;
})();
/** Hard upper bound for any requested per-task context size (guards against absurd KV-cache). */
const GGUF_MAX_CTX = (() => {
  const n = parseInt(process.env.GGUF_MAX_CTX || "32768", 10);
  return Number.isFinite(n) && n > 0 ? n : 32768;
})();

/** Clamp a requested context size into [256, GGUF_MAX_CTX]; undefined → GGUF_DEFAULT_CTX. */
function resolveContextSize(requested?: number): number {
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) {
    return GGUF_DEFAULT_CTX;
  }
  return Math.min(Math.max(Math.floor(requested), 256), GGUF_MAX_CTX);
}

/** Đợt 1 Task 2 — "auto" cấp TOÀN BỘ cửa sổ ngữ cảnh model được huấn luyện, trong khi
 *  chunk RAG dài nhất chỉ cần một phần nhỏ của cửa sổ đó. Đo được: embedding 0.6B (file
 *  1,2 GB) chiếm 5.664 MiB — phần lớn là buffer.
 *  SỬA review vòng 1 (Important): mặc định 1024 ban đầu dựa trên `maxChunkChars=1800`
 *  (knowledge/chunks-stats.json) ⇒ ước ~600 token — đây là TRẦN CÔNG BỐ, không phải trần
 *  được thực thi (build-knowledge-chunks.mjs không chặn cứng khi gặp khối không có ranh
 *  giới câu/đoạn, ví dụ bảng markdown). Đo THẬT bằng tokenizer của chính model nhúng trên
 *  chunk dài nhất thực tế trong knowledge/chunks.jsonl (6.135 ký tự,
 *  "doc:docs/ECOSYSTEM/27_AOI_AVI_END_TO_END_AUDIT_UPGRADE_PLAN_2026-07.md#23"): 1.879
 *  token — vượt 1024 tới 83%. node-llama-cpp KHÔNG cắt âm thầm khi input vượt contextSize,
 *  nó THROW.
 *  ⚠ ĐÍNH CHÍNH 2026-08-02 (Đợt 2 Task 4 + Task 6): bản cũ viết tiếp *"throw đó bị
 *  kbVectorStore.ts (ingestKbChunks) nuốt thành skipped++"* — SAI. Hàm nằm ở
 *  `server/services/kb/kbVectorStore.ts`, và `catch` quanh generateEmbedding() ĐÃ log
 *  `[KB] embed/store failed for <docId>: <err.message>` từ commit gốc `e4e24aa6` (2026-06-24),
 *  trước cả Đợt 0 — chưa từng im lặng. Hệ quả thật của throw là chunk bị BỎ QUA và thiếu khỏi
 *  `kb_chunks` (ồn ào trong log, nhưng vẫn mất dữ liệu nếu không ai đọc log).
 *  Nâng lên 2048 (biên ~9% so với 1.879) — vẫn giữ phần lớn khoản tiết kiệm so với "auto"
 *  trong khi phủ được chunk dài nhất THẬT. */
const EMBED_CTX = (() => {
  const raw = Number(process.env.GGUF_EMBED_CTX);
  const DEFAULT_EMBED_CTX = 2048;
  const value = Number.isFinite(raw) && raw >= 256 ? Math.floor(raw) : DEFAULT_EMBED_CTX;
  // Minor 1 (review vòng 1): trần trên nhất quán với resolveContextSize()/GGUF_MAX_CTX ở trên
  // — cùng mục đích (chặn KV-cache phi lý) áp dụng cho cùng file, không có lý do EMBED_CTX
  // là ngoại lệ duy nhất không có trần.
  return Math.min(value, GGUF_MAX_CTX);
})();

/** TASK A — Basename of the configured fast model (GGUF_FAST_MODEL), sans ".gguf". Empty if unset. */
const GGUF_FAST_MODEL_BASENAME = (() => {
  const v = (process.env.GGUF_FAST_MODEL || "").trim();
  return v ? path.basename(v).replace(/\.gguf$/i, "") : "";
})();

/**
 * TASK A — Coarse tier label for the latency histogram, derived locally from the resolved
 * model basename (no call-site changes): "fast" when it matches GGUF_FAST_MODEL, else "deep".
 * (embed/vision are observed elsewhere / out of scope here.)
 */
function tierLabelForModel(modelId: string): "fast" | "deep" {
  return GGUF_FAST_MODEL_BASENAME && modelId === GGUF_FAST_MODEL_BASENAME ? "fast" : "deep";
}

/**
 * TASK A — Record one completed generation's wall-clock latency. Fully fail-safe:
 * observeInference is itself a no-op/never-throws, but we still guard to be certain telemetry
 * can never affect inference.
 */
function recordInferenceLatency(modelId: string, startTimeMs: number): void {
  try {
    observeInference(tierLabelForModel(modelId), modelId, (Date.now() - startTimeMs) / 1000);
  } catch {
    /* telemetry must never affect inference */
  }
}

/**
 * Ensure the GGUF models directory exists
 */
function ensureModelsDir() {
  if (!fs.existsSync(GGUF_MODELS_DIR)) {
    fs.mkdirSync(GGUF_MODELS_DIR, { recursive: true });
  }
}

/**
 * Get or initialize the llama instance (singleton)
 */
async function getLlama(): Promise<any> {
  if (llamaInstance) return llamaInstance;

  // Pha 1.5 Task 2 review vòng 1 (Important) — KHOÁ IN-FLIGHT. `if (llamaInstance) return
  // llamaInstance` ở trên KHÔNG nguyên tử: hai lượt `loadGgufModel()` cho HAI MODEL KHÁC NHAU
  // (`inFlightLoads` khoá theo modelId — KHÔNG chặn được ca này) có thể cùng gọi `getLlama()`
  // trong lúc lượt đầu còn đang `await import("node-llama-cpp")`; cả hai đều thấy
  // `llamaInstance === null` và chạy tiếp xuống dưới. Race có sẵn từ BASE (trước Task 2); Task 2
  // NỚI cửa sổ đua đó (thêm hai `await` — `beginVram()`/`commitMeasured()`) và gắn một hệ quả
  // MỚI: sổ ghi HAI giấy phép "cuda-backend" cho MỘT backend thật — đúng dữ liệu Task 6 (Ư0) sẽ
  // đọc để biết "lúc đó ai đang giữ gì" khi CUDA context được tạo. Khoá ở đây để lượt gọi THỨ
  // HAI CHỜ lượt thứ NHẤT thay vì đua.
  //
  // ⚠ KHÔNG VI PHẠM "CHỈ QUAN SÁT": khoá không đổi THỜI ĐIỂM lượt `initLlama()` THỨ NHẤT được
  // gọi — nó chỉ ngăn một lượt `initLlama()` THỨ HAI chạy đồng thời. Biến Ư0 quan tâm (thời
  // điểm CUDA context ĐẦU TIÊN của tiến trình được tạo) không đổi.
  //
  // ⚠ Bài học Đợt 1: KHÔNG được có `await` nào giữa đọc `llamaInitInFlight` và gán nó — đó
  // chính là lớp lỗi khoá-vô-dụng. Hai dòng dưới đây liền kề, không có await xen giữa (đọc rồi
  // gán ngay trong CÙNG một tick đồng bộ).
  const pending = llamaInitInFlight;
  if (pending) return pending;

  const initPromise = (async (): Promise<any> => {
    try {
      // Ensure CUDA runtime DLLs (cudart/cublas) are discoverable when offloading to GPU.
      // The CUDA Toolkit installer adds its bin to system PATH, but prepend it explicitly
      // for robustness (covers the app launched before a PATH refresh). GGUF_CUDA_BIN
      // overrides; otherwise fall back to %CUDA_PATH%\bin.
      if (process.env.GGUF_GPU !== "false") {
        const cudaBin = process.env.GGUF_CUDA_BIN
          || (process.env.CUDA_PATH ? `${process.env.CUDA_PATH}\\bin` : "");
        if (cudaBin && !(process.env.PATH || "").includes(cudaBin)) {
          process.env.PATH = `${cudaBin};${process.env.PATH || ""}`;
          console.log("[aiGgufEngine] prepended CUDA bin to PATH:", cudaBin);
        }
      }

      const { getLlama: initLlama } = await import("node-llama-cpp");

      // Pha 1.5 Task 2 — backend CUDA của initLlama() là khoản ~430 MiB LỚN NHẤT của "sàn cấu
      // trúc" mà Pha 1 đo được (+431/+430/+431 MiB, 3 lượt) nhưng KHÔNG đưa vào sổ được — đây là
      // lý do ngưỡng báo động 512 MiB từng vô dụng. CHỈ QUAN SÁT: thời điểm/tham số gọi
      // `initLlama()` ngay dưới KHÔNG ĐỔI so với trước; chỉ bọc thêm ba lời gọi telemetry quanh
      // lượt khởi tạo ĐÃ CÓ. `beginVram()` ngay TRƯỚC lượt gọi thật, `commitMeasured()` ngay SAU
      // — đó là cách duy nhất delta đo được là của backend, không phải của thứ khác.
      //
      // ⚠ Backend là SINGLETON cả tiến trình — dòng `if (llamaInstance) return llamaInstance` ở
      // đầu `getLlama()` đảm bảo khối này chỉ chạy MỘT LẦN khi thành công (khoá in-flight ở trên
      // đảm bảo thêm: kể cả khi ĐANG chạy, không có lượt thứ hai nào chạy CHỒNG lên nó). Vì vậy:
      // KHÔNG có đường release — không ai gọi `ticket.release()` khi backend đã sống. Khai
      // `releaseProof: "unverified"` ở đây sẽ SAI ngữ nghĩa (nó ngụ ý "có thể nhả, chỉ chưa xác
      // minh được"); sự thật là backend này KHÔNG BAO GIỜ được nhả trong suốt vòng đời tiến
      // trình, và đó là ĐÚNG — không phải một lỗ hổng cần vá.
      //
      // ★★★ Pha 2A Task 4 (T5-15) — `fallbackBytes` LÀ HỆ QUẢ TRỰC TIẾP của đoạn trên: vì giấy
      // phép này KHÔNG có đường release, một lượt đo hỏng ghim `actualBytes = null` VĨNH VIỄN,
      // và lá chắn HOÃN chụp nền (vramReconciler) đóng theo nó ⇒ báo động không bao giờ tự lành,
      // BẮT BUỘC khởi động lại. Khai số dự phòng ở ĐÂY (chứ không theo `kind` trong vramWiring)
      // vì chỉ chỗ này biết `gpu` được truyền là gì: `gpu:false` ⇒ backend chiếm ĐÚNG 0 byte, và
      // 0 cũng là một con số chắc chắn — nó gỡ chặn nền mà không bơm byte MA vào sổ.
      const backendTicket = await beginVram({
        owner: "cuda-backend",
        kind: "gguf-backend",
        priority: "production",
        fallbackBytes: await cudaBackendFallbackBytes(),
      });
      let backendCommitted = false;
      try {
        llamaInstance = await initLlama({
          gpu: process.env.GGUF_GPU === "false" ? false : "auto",
        });
        await backendTicket.commitMeasured();
        backendCommitted = true;
      } finally {
        // `initLlama()` ném GIỮA reserve() và commit() ⇒ backend KHÔNG hình thành thật. TRẢ giấy
        // phép để lượt retry sau (llamaInstance vẫn null ⇒ getLlama() sẽ chạy lại khối này) không
        // đẻ thêm một giấy phép treo vĩnh viễn mỗi lần thử — chỉ nhánh THẤT BẠI mới release; nhánh
        // thành công không bao giờ chạm release (xem cảnh báo SINGLETON ở trên).
        if (!backendCommitted) releaseVramTicketQuietly(backendTicket);
      }

      console.log("[aiGgufEngine] llama.cpp engine initialized (GPU:", process.env.GGUF_GPU !== "false" ? "auto" : "disabled", ")");
      // Pha 1 Task 5 — NỐI ĐẦU DÒ VRAM vào thể hiện llama vừa tạo. Không nối thì
      // `vram/vramProbe.readDeviceVram()` LUÔN lùi về `nvidia-smi` (~80 ms/lượt đo trên máy này,
      // tới ~3 s ở trường hợp xấu — xem vramProbe.ts:7-10) dù `llamaInstance.getVramState()`
      // native đã sẵn ở đây. CHỈ nối dây, không đổi hành vi; lỗi bị nuốt vì telemetry không bao
      // giờ được làm hỏng lượt khởi tạo engine.
      try {
        const { setLlamaInstanceHandle } = await import("./vram/llamaHandle");
        setLlamaInstanceHandle(llamaInstance);
      } catch {
        /* telemetry KHÔNG được làm hỏng đường khởi tạo engine */
      }
      return llamaInstance;
    } catch (err) {
      console.error("[aiGgufEngine] Failed to initialize llama.cpp:", err);
      throw new Error("node-llama-cpp is not available. Install with: pnpm add node-llama-cpp");
    }
  })();

  llamaInitInFlight = initPromise;
  try {
    return await initPromise;
  } finally {
    // Bắt buộc (bài học Đợt 1): thiếu dòng này thì MỌI lượt gọi getLlama() sau — kể cả sau khi
    // backend đã khởi tạo XONG hay đã THẤT BẠI — đều bị khoá vĩnh viễn vào đúng promise (đã
    // resolve hay đã reject) này, không bao giờ thử lại được. Chạy trong CẢ HAI nhánh thành
    // công/thất bại: nhánh thành công không cần (llamaInstance đã set, lượt sau thoát ở dòng đầu
    // hàm) nhưng dọn cho sạch; nhánh thất bại thì bắt buộc để lượt retry sau không kẹt vĩnh viễn.
    llamaInitInFlight = null;
  }
}

// ─── LRU eviction & memory guard ───────────────────────────────

/**
 * B0.1 — Best-effort VRAM snapshot in bytes. Primary source is node-llama-cpp's
 * `getVramState()` ({ total, used, free }); if that is unavailable/zero (e.g. CPU build
 * or unified memory), fall back to `nvidia-smi`. NEVER throws — returns null on any failure
 * so the load path degrades truthfully instead of crashing.
 */
async function readVramState(): Promise<{ used: number; total: number } | null> {
  // 1) node-llama-cpp native VRAM state.
  if (llamaInstance && typeof llamaInstance.getVramState === "function") {
    try {
      const v = await llamaInstance.getVramState();
      if (v && typeof v.used === "number" && typeof v.total === "number" && v.total > 0) {
        return { used: v.used, total: v.total };
      }
    } catch {
      // fall through to nvidia-smi
    }
  }
  // 2) nvidia-smi fallback (bytes = MiB * 1024 * 1024).
  // R-1 (doc 38): use the ASYNC execFile so the ~3s nvidia-smi call never blocks
  // the event loop (the sync variant froze all request handling for its duration).
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      ["--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
      { timeout: 3000, windowsHide: true },
    );
    const out = stdout.toString();
    const first = out.split(/\r?\n/).find((l) => l.trim().length > 0) || "";
    const [usedMib, totalMib] = first.split(",").map((s) => parseInt(s.trim(), 10));
    if (Number.isFinite(usedMib) && Number.isFinite(totalMib) && totalMib > 0) {
      return { used: usedMib * 1024 * 1024, total: totalMib * 1024 * 1024 };
    }
  } catch {
    // nvidia-smi missing / not a GPU host — telemetry unavailable.
  }
  return null;
}

/**
 * B0.1 — VRAM threshold guard. Before loading the Nth model, if VRAM usage is at/above
 * GGUF_VRAM_GUARD_PCT of total, evict LRU idle model(s) until back under threshold.
 *
 * ★★★ Pha 2B Task 5 — VAI TRÒ CỦA HÀM NÀY ĐÃ ĐỔI, dù một dòng mã cũng không đổi (Task 7 mới xoá
 * nó). Trước đây nó là **lớp quyết định cuối**: hết chỗ mà không đuổi được ai thì *"cảnh báo rồi
 * vẫn làm"* — đúng cái tràn im lặng mà spec này tồn tại để diệt (ràng buộc 9). Từ Task 5, quyết
 * định CHO/KHÔNG CHO nằm ở **cổng sổ** (`beginVramAllocation()` → `broker.reserve()`), và cổng đó
 * chạy SAU hàm này (`ensureCapacity()` ở `loadGgufModel`, trước `loadWithVramOutcomes`). Nên hàm
 * này nay chỉ còn một việc: **DỌN CHỖ TRƯỚC** để cổng sổ nhìn thấy một cuốn sổ đã gọn.
 * ⇒ Nhánh "không đuổi được ai" không còn là một lượt cho-qua: nó chỉ nói *"tôi không dọn được gì"*,
 * rồi cổng sổ sẽ TỪ CHỐI nếu thật sự không đủ chỗ.
 *
 * Fail-safe: telemetry failure skips the guard silently.
 */
async function enforceVramGuard(): Promise<void> {
  if (!llamaInstance) return; // engine not initialized → nothing loaded yet
  let guard = 0;
  while (guard++ < loadedModels.size + 1) {
    const vram = await readVramState();
    if (!vram) return; // telemetry unavailable → best-effort: skip guard
    const usedPct = (vram.used / vram.total) * 100;
    if (usedPct < GGUF_VRAM_GUARD_PCT) return; // under threshold → ok to load
    const usedMb = Math.round(vram.used / 1024 / 1024);
    const totalMb = Math.round(vram.total / 1024 / 1024);
    const evicted = await evictLRU();
    if (!evicted) {
      console.warn(
        `[aiGgufEngine] VRAM guard: used ${usedMb}/${totalMb}MB (${usedPct.toFixed(0)}%) ` +
          `≥ ${GGUF_VRAM_GUARD_PCT}% và KHÔNG có model nhàn rỗi nào để dọn. ` +
          `KHÔNG cho qua ở đây: cổng SỔ (beginVramAllocation → reserve) quyết định ngay sau bước này.`,
      );
      return;
    }
    console.warn(
      `[aiGgufEngine] VRAM guard: used ${usedMb}/${totalMb}MB (${usedPct.toFixed(0)}%) ` +
        `≥ ${GGUF_VRAM_GUARD_PCT}% — evicted LRU model "${evicted}" before loading.`,
    );
  }
}

/**
 * Pick the least-recently-used model with refCount === 0 and unload it.
 * Returns the evicted modelId, or null if no eligible candidate exists.
 */
async function evictLRU(): Promise<string | null> {
  let oldestId: string | null = null;
  let oldestTime = Infinity;
  for (const [id, m] of loadedModels) {
    if (m.refCount > 0) continue; // never evict a model that is in use
    const t = m.lastUsedAt.getTime();
    if (t < oldestTime) {
      oldestTime = t;
      oldestId = id;
    }
  }
  if (!oldestId) return null;
  await unloadGgufModel(oldestId);
  console.log(`[aiGgufEngine] Evicted LRU model: ${oldestId}`);
  return oldestId;
}

/**
 * Ensure there is capacity for one more model before loading.
 * Enforces GGUF_MAX_LOADED_MODELS (count) and, if enabled, GGUF_MAX_VRAM_MB (best-effort).
 * Evicts the LRU idle model(s).
 *
 * ★ Pha 2B Task 5 — ĐÂY LÀ BƯỚC **DỌN CHỖ**, KHÔNG PHẢI BƯỚC **CHO PHÉP** (xem docstring
 * `enforceVramGuard`). Không còn nhánh nào ở đây "cho qua vì không đuổi được ai": việc cho/không
 * cho thuộc về cổng sổ chạy ngay sau. Hai bộ đếm này là trần theo SỐ MODEL, còn cưỡng chế theo
 * BYTE nằm ở broker — Task 7 hấp thụ nốt.
 */
async function ensureCapacity(): Promise<void> {
  // Count-based cap: make room so that loading one more stays within the limit.
  let guard = 0;
  while (loadedModels.size >= GGUF_MAX_LOADED_MODELS && guard++ < loadedModels.size + 1) {
    const evicted = await evictLRU();
    if (!evicted) {
      console.warn(
        `[aiGgufEngine] Đã kín khe (${loadedModels.size}/${GGUF_MAX_LOADED_MODELS}) và MỌI model đang ` +
          `được dùng (refCount>0) ⇒ không dọn được khe nào. Cổng SỔ (reserve) quyết định lượt nạp này.`,
      );
      break;
    }
  }

  // VRAM-based cap (opt-in). Best-effort: getVramState may be inaccurate on CPU/unified memory.
  if (GGUF_MAX_VRAM_MB > 0 && llamaInstance) {
    try {
      const capBytes = GGUF_MAX_VRAM_MB * 1024 * 1024;
      let vguard = 0;
      while (vguard++ < loadedModels.size + 1) {
        const vram = await llamaInstance.getVramState();
        if (!vram || typeof vram.used !== "number" || vram.used < capBytes) break;
        const evicted = await evictLRU();
        if (!evicted) {
          console.warn(
            `[aiGgufEngine] VRAM đang dùng (${Math.round((vram.used) / 1024 / 1024)}MB) vượt trần ` +
              `(${GGUF_MAX_VRAM_MB}MB) và không có model nhàn rỗi để dọn. Cổng SỔ quyết định lượt nạp này.`,
          );
          break;
        }
      }
    } catch (err) {
      // getVramState unsupported / failed — VRAM cap is best-effort only.
      console.warn("[aiGgufEngine] getVramState failed; skipping VRAM cap enforcement:", (err as any)?.message ?? err);
    }
  }

  // B0.1 — percentage-based VRAM threshold guard (default on at 90%). Evicts LRU idle
  // model(s) when VRAM is near full before loading another; never throws on telemetry failure.
  await enforceVramGuard();
}

/**
 * Resolve model file path — supports absolute, relative, and uploads directory
 */
function resolveModelPath(modelPath: string): string {
  if (path.isAbsolute(modelPath) && fs.existsSync(modelPath)) return modelPath;

  // Check uploads/gguf-models directory
  const inModelsDir = path.join(GGUF_MODELS_DIR, modelPath);
  if (fs.existsSync(inModelsDir)) return inModelsDir;

  // Check uploads root
  const uploadsRoot = process.env.LOCAL_STORAGE_DIR
    ? path.resolve(process.env.LOCAL_STORAGE_DIR)
    : path.join(process.cwd(), "uploads");
  const inUploads = path.join(uploadsRoot, modelPath);
  if (fs.existsSync(inUploads)) return inUploads;

  throw new Error(`GGUF model file not found: ${modelPath}`);
}

// ─── GGUF file validation ──────────────────────────────────────

/** Minimum plausible size for a real GGUF model file. Catches the ~70MB corrupt
 *  LLaVA placeholder and truncated downloads. Even small quantized models exceed this. */
const GGUF_MIN_FILE_BYTES = 1 * 1024 * 1024; // 1 MB — mmproj files can be small-ish; magic header is the strong check

/**
 * Validate that a file on disk is a real GGUF model:
 *  - exists
 *  - first 4 bytes are the GGUF magic "GGUF" (0x47 0x47 0x55 0x46)
 *  - at least a minimum plausible size
 * Throws a clear error otherwise. Used before configuring/spawning a vision model
 * so a corrupt 70MB file or a missing download fails loudly instead of silently.
 */
export function validateGgufFile(filePath: string): { sizeBytes: number } {
  let resolved = filePath;
  if (!path.isAbsolute(filePath)) {
    // Best-effort resolution against the models dir (does not throw if absent).
    const candidate = path.join(GGUF_MODELS_DIR, filePath);
    resolved = fs.existsSync(candidate) ? candidate : filePath;
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`GGUF validation failed: file not found: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`GGUF validation failed: not a file: ${resolved}`);
  }
  if (stat.size < GGUF_MIN_FILE_BYTES) {
    throw new Error(
      `GGUF validation failed: file too small (${stat.size} bytes, min ${GGUF_MIN_FILE_BYTES}): ${resolved} — likely corrupt or a placeholder.`,
    );
  }
  const fd = fs.openSync(resolved, "r");
  try {
    const header = Buffer.alloc(4);
    const bytesRead = fs.readSync(fd, header, 0, 4, 0);
    if (
      bytesRead < 4 ||
      header[0] !== 0x47 || // G
      header[1] !== 0x47 || // G
      header[2] !== 0x55 || // U
      header[3] !== 0x46 // F
    ) {
      throw new Error(
        `GGUF validation failed: bad magic header (expected "GGUF" / 0x47475546): ${resolved} — file is not a valid GGUF model.`,
      );
    }
  } finally {
    fs.closeSync(fd);
  }
  return { sizeBytes: stat.size };
}

/**
 * B6.2 — Best-effort check that a GGUF model basename (or filename) resolves to a real file
 * on disk inside GGUF_MODELS_DIR / uploads. Used by the Model Router as a FAIL-SAFE before
 * routing the hardest tasks to an optional Thinking model: if the file is absent we must fall
 * back to the default deep model rather than attempt a load that throws. NEVER throws — returns
 * false on any error or if the input is empty.
 */
export function ggufModelFileExists(modelIdOrFile?: string): boolean {
  const v = (modelIdOrFile || "").trim();
  if (!v) return false;
  try {
    const file = /\.gguf$/i.test(v) ? v : `${v}.gguf`;
    resolveModelPath(file); // throws if not found
    return true;
  } catch {
    return false;
  }
}

/**
 * W0.2 (doc 11) — honest "is a TEXT LLM actually loadable?" check for health.
 * Today getKbHealth only proves the KB files parse; the bubble then shows
 * "Sẵn sàng" even when no GGUF text model can be loaded → answers silently
 * degrade to extractive. This verifies, cheaply and WITHOUT running inference:
 *   1. node-llama-cpp can be imported (engine present), AND
 *   2. a real text GGUF model file resolves on disk + passes the GGUF magic
 *      header check (validateGgufFile) — preferring GGUF_DEFAULT_MODEL (deep QA
 *      model), then GGUF_FAST_MODEL, else the first non-embedding .gguf found.
 * NEVER throws — returns false on any error. We deliberately skip the embedding
 * model so a config with only an embed model (no QA model) reports llmReady:false.
 */
export async function isGgufModelLoadable(): Promise<boolean> {
  try {
    if (!(await isGgufAvailable())) return false;

    const embedBase = (process.env.GGUF_EMBED_MODEL || "")
      .trim()
      .replace(/\.gguf$/i, "")
      .toLowerCase();

    // Candidate text models in preference order (deep → fast).
    const candidates = [process.env.GGUF_DEFAULT_MODEL, process.env.GGUF_FAST_MODEL]
      .map((v) => (v || "").trim())
      .filter(Boolean);

    for (const c of candidates) {
      const file = /\.gguf$/i.test(c) ? c : `${c}.gguf`;
      try {
        const resolved = resolveModelPath(file);
        validateGgufFile(resolved); // magic header + min size; throws if bad
        return true;
      } catch {
        // try next candidate
      }
    }

    // No explicit text model configured/valid → look for any non-embedding
    // .gguf in the models dir and validate it.
    ensureModelsDir();
    const files = fs.readdirSync(GGUF_MODELS_DIR).filter((f) => f.endsWith(".gguf"));
    for (const f of files) {
      const base = f.replace(/\.gguf$/i, "").toLowerCase();
      if (embedBase && base === embedBase) continue; // skip the embed model
      if (/embed/i.test(base)) continue; // heuristic: skip obvious embedders
      try {
        validateGgufFile(path.join(GGUF_MODELS_DIR, f));
        return true;
      } catch {
        // try next file
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Pha 1 Task 5 — mở MỘT giấy phép VRAM quanh một lượt cấp phát. KHÔNG BAO GIỜ ném:
 * `beginVramAllocation()` đã tự nuốt mọi lỗi bên trong, lớp bọc này chỉ chặn nốt trường hợp
 * chính lượt `import()` module telemetry hỏng. Telemetry chết thì hệ vẫn phải nạp được model.
 */
async function beginVram(
  opts: import("./vram/vramWiring").VramAllocationOptions,
): Promise<VramTicket> {
  try {
    const { beginVramAllocation } = await import("./vram/vramWiring");
    return await beginVramAllocation(opts);
  } catch (err) {
    /**
     * ★★★ Pha 2B Task 5 — CỬA CUỐI CỦA ĐƯỜNG GGUF, và là cửa mà cưỡng chế dễ chết nhất: bốn điểm
     * cấp phát của `aiGgufEngine` (backend CUDA · model · context · embedding context) đều đi qua
     * lớp bọc này. Một lời từ chối bị nuốt ở đây = model 17 GB vẫn nạp sau khi cổng sổ đã chặn.
     */
    if (isVramRefusal(err)) throw err;
    /**
     * ★★ Pha 2B Task 3 — `catch` NÀY TRƯỚC ĐÂY RỖNG TUYỆT ĐỐI, và nó là **cửa cuối cùng** của cả
     * chuỗi: từ khi Task 3 đổi ba `await import()` bên trong `vramWiring` thành import TĨNH, một
     * lỗi nạp của `vramBroker`/`vramEstimator`/`vramEventLog` rơi **thẳng vào đây**. Nuốt im lặng
     * ở đây nghĩa là cả module sổ cái biến mất mà không ai biết.
     * ⚠ VẪN KHÔNG NÉM (chính sách Pha 1, giữ nguyên): hệ phải nạp được model kể cả khi telemetry
     * chết. Chỉ thêm TIẾNG.
     */
    console.error(
      `[aiGgufEngine] KHÔNG nạp/chạy được vram/vramWiring cho "${opts.owner}" ⇒ lượt cấp phát này ` +
        `chạy NGOÀI SỔ (dư địa bị phóng đại đúng khối byte đó, cưỡng chế mù với nó): ` +
        `${(err as Error)?.message ?? String(err)}`,
    );
    return { commitMeasured: async () => {}, release: () => {}, noteRefCount: () => {} };
  }
}

/**
 * ★★ Pha 2B Task 3, I-1 (review vòng 1) — CHO BỐN ĐƯỜNG CẤP PHÁT CÒN LẠI MỘT CÁI MIỆNG.
 *
 * `loadWithVramOutcomes()` chỉ bọc lượt nạp **TRỌNG SỐ**. Bốn đường khác vẫn cấp phát VRAM thật và
 * trước bản vá này im lặng tuyệt đối khi hết chỗ:
 *   1. `loadGgufModel` → `model.createContext()` — **đỉnh áp lực VRAM**: trọng số 16,7 GB đã trên
 *      card, giờ mới xin KV cache. Đây là hình dạng hỏng dễ xảy ra nhất khi VRAM sát trần.
 *   2. `ensureTextContext` → `createContext()` (context LƯỜI).
 *   3. `getEmbeddingContext` → `createEmbeddingContext()` — đường này còn **nói SAI nguyên nhân**.
 *   4. `loadGgufModel` đường DỰ PHÒNG (`runner === null`) — do chính Task 3 đẻ ra.
 *
 * ⚠⚠ N-2 (re-review) — ĐÍNH CHÍNH: **BA TRÊN BỐN** điểm gọi ném lại NGUYÊN lỗi cũ, không đổi nhánh
 * nào. Điểm gọi (3) `getEmbeddingContext` **CÓ ĐỔI luồng lỗi**, cố ý: nó dùng `verdict` để chọn câu
 * lỗi, vì câu cũ (*"Model does not support embeddings"*) **nói sai nguyên nhân**. Vòng trước tôi
 * viết "không đổi một nhánh điều khiển nào" — câu đó rộng hơn sự thật, và một lời khai rộng hơn sự
 * thật là đúng lớp lỗi pha này đang diệt.
 * ⚠ Chính sách "telemetry không bao giờ làm hỏng đường cấp phát" giữ nguyên — hàm này KHÔNG ném.
 * ⚠ `await` có chủ ý (không `void`): sự kiện phải nằm TRƯỚC lượt ném lại trong nhật ký, và điểm gọi
 * (3) cần phán quyết để chọn câu lỗi đúng.
 */
async function noteContextFailure(
  owner: string,
  kind: import("./vram/types").VramLeaseKind,
  priority: import("./vram/types").VramPriority,
  site: string,
  err: unknown,
  detail?: Record<string, unknown>,
): Promise<import("./vram/vramLoadOutcome").VramExhaustionVerdict | null> {
  try {
    const { noteVramAllocationFailure } = await import("./vram/vramLoadOutcome");
    return noteVramAllocationFailure({ owner, kind, priority, site, err, detail });
  } catch (e) {
    console.warn(
      `[aiGgufEngine] KHÔNG ghi được sự kiện cấp phát hỏng cho "${owner}" tại ${site} — đường này ` +
        `trở lại IM LẶNG: ${(e as Error)?.message ?? String(e)}`,
    );
    return null;
  }
}

/**
 * ★★★ Pha 2B Task 3 — nạp module CHÍNH SÁCH ba kết cục (§5.5). `null` = không nạp được.
 *
 * ⚠ VÌ SAO CÓ ĐƯỜNG `null` THAY VÌ ĐỂ NÉM: `loadGgufModel()` phục vụ MỌI lượt suy luận của hệ.
 * Một lỗi nạp module telemetry không được phép làm cả hệ mất khả năng nạp model — đó là chính
 * sách có từ Pha 1 và Task 3 không được đổi nó. Nhưng "không ném" ≠ "không nói": nhánh này kêu ở
 * mức `error`, và người gọi ghi rõ mình đang chạy ở hình dạng TỐI THIỂU (không ba kết cục).
 */
async function loadOutcomeRunner(): Promise<
  typeof import("./vram/vramLoadOutcome").loadWithVramOutcomes | null
> {
  try {
    const { loadWithVramOutcomes } = await import("./vram/vramLoadOutcome");
    return loadWithVramOutcomes;
  } catch (err) {
    console.error(
      `[aiGgufEngine] KHÔNG nạp được vram/vramLoadOutcome ⇒ lượt nạp model chạy KHÔNG CÓ ba kết cục ` +
        `§5.5 (không trả giấy phép sớm, không thử lại, không hạ số lớp, không sự kiện): ` +
        `${(err as Error)?.message ?? String(err)}`,
    );
    return null;
  }
}

/**
 * Pha 2A Task 4 (T5-15) — số byte DỰ PHÒNG cho giấy phép backend CUDA, dùng KHI VÀ CHỈ KHI phép đo
 * hỏng (xem `VramAllocationOptions.fallbackBytes`). KHÔNG BAO GIỜ ném: module telemetry hỏng ⇒
 * `undefined` ⇒ hành vi y hệt trước Task 4.
 *
 * ⚠ `GGUF_GPU=false` ⇒ `initLlama({gpu:false})` ⇒ backend chiếm ĐÚNG 0 byte VRAM. Trả `0` chứ
 * KHÔNG trả `undefined`: `0` là số CHẮC CHẮN và nó vẫn gỡ được lá chắn nền, trong khi `undefined`
 * để nguyên T5-15 cho cấu hình chạy CPU. Hằng số nằm ở MỘT chỗ (`vramWiring`) — không chép số.
 *
 * ⚠ GIỚI HẠN ĐÃ BIẾT, CHẤP NHẬN TƯỜNG MINH: `gpu:"auto"` trên máy KHÔNG CÓ GPU cũng lùi về CPU,
 * nhưng ta không biết điều đó tại thời điểm này (phải gọi `initLlama()` xong mới biết `llama.gpu`
 * lùi về đâu, mà số dự phòng thì phải khai TRƯỚC). Ở ca đó sổ giữ thừa 431,6 MiB. BÁN KÍNH ĐO
 * ĐƯỢC, không phải "chiều an toàn" nói suông (M-5, review vòng 1) — hai ca, hai con số:
 *   • nền chụp **SAU** lượt dự phòng (ca thường: `startVramReconciler()` chạy ở boot còn backend
 *     hình thành ở lượt nạp model đầu): `committedBytes` đã gồm 431,6 MiB **và** `ledgerTotal`
 *     cũng gồm đúng 431,6 MiB đó ⇒ `drift = (raw − nền) − ledgerTotal` **triệt tiêu hoàn toàn**
 *     khoản ma, sai số **0**;
 *   • nền chụp **TRƯỚC** (backend đã sống trước lượt chụp đầu tiên): nền không chứa khoản ma
 *     nhưng `ledgerTotal` có ⇒ `drift = −431,6 MiB` **cố định**, vẫn **dưới** ngưỡng 512 MiB
 *     (dùng 84,3 % ngân sách phía ÂM) ⇒ không đẻ báo động, nhưng ăn gần hết dư địa phía đó.
 * Và trên máy không GPU thì `readDeviceVram()` trả `null` ⇒ reconciler IM LẶNG, không nhánh nào
 * trong hai ca trên chạy. Với Pha 2B, chiều sai là chiều AN TOÀN (`headroom` dè dặt hơn thật).
 */
async function cudaBackendFallbackBytes(): Promise<number | undefined> {
  if (process.env.GGUF_GPU === "false") return 0;
  try {
    const { CUDA_BACKEND_FALLBACK_BYTES } = await import("./vram/vramWiring");
    return CUDA_BACKEND_FALLBACK_BYTES;
  } catch {
    return undefined;
  }
}

/** Pha 1 Task 5 — trả MỘT giấy phép (có thể chưa mở được). KHÔNG BAO GIỜ ném. */
function releaseVramTicketQuietly(ticket: VramTicket | null | undefined): void {
  try {
    ticket?.release();
  } catch {
    /* telemetry KHÔNG được làm hỏng đường lỗi của người gọi */
  }
}

/** Pha 1 Task 5 — trả MỌI giấy phép VRAM gắn với một model đã nạp. KHÔNG BAO GIỜ ném. */
function releaseModelVramTickets(loaded: LoadedModel): void {
  try {
    loaded.vramTicket?.release();
    loaded.embedCtxVramTicket?.release();
    loaded.textCtxVramTicket?.release();
  } catch {
    /* telemetry KHÔNG được làm hỏng lượt unload */
  }
}

/**
 * Load a GGUF model into memory and create a context/session
 */
export async function loadGgufModel(config: GgufModelConfig): Promise<string> {
  const resolvedPath = resolveModelPath(config.modelPath);
  const modelId = path.basename(resolvedPath, ".gguf");

  // Return existing if already loaded
  if (loadedModels.has(modelId)) {
    const existing = loadedModels.get(modelId)!;
    existing.lastUsedAt = new Date();
    return modelId;
  }

  // Đợt 1 Task 1 — khoá in-flight: nếu modelId này đang được nạp bởi một lượt gọi khác
  // (xem giải thích ở khai báo inFlightLoads), CHỜ lượt đó thay vì nạp song song.
  const pending = inFlightLoads.get(modelId);
  if (pending) return pending;

  // Pha 1 Task 5 — giữ giấy phép NGOÀI IIFE để nhánh `catch` bên dưới trả được chỗ khi lượt
  // nạp hỏng giữa chừng (không thì sổ giữ một giấy phép MA cho model chưa bao giờ tồn tại).
  // Dùng object holder chứ không `let` để TypeScript không thu hẹp kiểu về `null` ở nơi dùng.
  const vramHolder: { ticket: VramTicket | null } = { ticket: null };

  const loadPromise = (async () => {
    const llama = await getLlama();

    // Free memory before loading another model (LRU + VRAM guard).
    await ensureCapacity();

    console.log(`[aiGgufEngine] Loading model: ${resolvedPath}`);
    const startTime = Date.now();

    // Pha 1 Task 5 — CHỈ KHAI BÁO. `ensureCapacity()`/`enforceVramGuard()`/`evictLRU()` ngay
    // bên trên vẫn chạy y nguyên; các lời gọi telemetry ở đây không quyết định gì.
    // ⚠ Pha 2B Task 3 — `beginVram()` KHÔNG còn gọi ở đây: giấy phép nay mở/đóng THEO TỪNG LƯỢT
    // THỬ bên trong `loadWithVramOutcomes()` (lý do đầy đủ ở khối ngay dưới).
    const requestedGpuLayers = config.gpuLayers ?? "max";
    /**
     * ★★★ Pha 2B Task 3 — BA KẾT CỤC (§5.5). Toàn bộ chính sách (phân loại lỗi thật · trả giấy
     * phép NGAY · thử lại 2×5 s · hạ số lớp · từ chối trung thực) nằm ở
     * `server/services/vram/vramLoadOutcome.ts` — đọc khối docstring đầu file đó trước khi sửa.
     *
     * ⚠ VÌ SAO GIẤY PHÉP CHUYỂN VÀO TRONG: bản cũ mở MỘT giấy phép ở đây rồi giữ nó qua CẢ lượt
     * nạp đầu LẪN lượt lùi. Khi driver từ chối, giấy phép đó **còn treo** ⇒ sổ cộng dư vĩnh viễn
     * và lượt xin kế tiếp bị từ chối trên BYTE MA. Nay mỗi lượt thử có đúng một giấy phép, lượt
     * hỏng trả chỗ ngay tại chỗ hỏng, và `outcome.ticket` là giấy phép CÒN MỞ của lượt thắng —
     * `commitMeasured()` bên dưới vẫn chạy đúng một lần, đúng ngữ nghĩa cũ.
     * ⚠ TÁC DỤNG PHỤ CÓ LỢI, ghi ra để không ai tưởng là tình cờ: `evictLRU()` nay chạy **NGOÀI**
     * cửa sổ đo (giấy phép đã trả trước đó), nên nó thôi là nguồn delta-âm mà `vramWiring.ts`
     * (nhánh `actual < 0`) mô tả đích danh là "đuổi 17 GB rồi nạp 4 GB giữa hai đầu đo".
     */
    let model;
    {
      const runner = await loadOutcomeRunner();
      if (runner) {
        const outcome = await runner({
          owner: `gguf:${modelId}`,
          kind: "gguf-model",
          priority: "interactive",
          filePath: resolvedPath,
          requestedGpuLayers,
          load: async (plan) =>
            await llama.loadModel({
              modelPath: resolvedPath,
              // "max" offloads ALL layers to GPU (full speed). When the engine runs CPU-only
              // (GGUF_GPU=false → getLlama gpu:false), node-llama-cpp ignores this.
              // ⚠ `plan.gpuLayers` KHÔNG BAO GIỜ là số âm — `chuanHoaSoLop()` chặn ở cửa, vì
              // node-llama-cpp 3.x đọc -1 thành 0 lớp (suy luận CPU IM LẶNG).
              gpuLayers: plan.gpuLayers,
            } as any),
          // `LlamaModel.gpuLayers` — getter số lớp THẬT đã nạp (LlamaModel.d.ts:189).
          resolvedGpuLayers: (m: any) => (typeof m?.gpuLayers === "number" ? m.gpuLayers : null),
          reclaim: async () => {
            while (await evictLRU()) {
              /* evict every idle (refCount===0) model to reclaim maximum VRAM */
            }
          },
        });
        model = outcome.value;
        vramHolder.ticket = outcome.ticket;
        if (outcome.outcome !== "loaded") {
          console.warn(
            `[aiGgufEngine] ${modelId}: nạp được ở kết cục "${outcome.outcome}" sau ${outcome.attempts} lượt ` +
              `(gpuLayers xin "${requestedGpuLayers}" ⇒ chạy "${outcome.plan.gpuLayers}", số lớp THẬT ` +
              `${outcome.resolvedGpuLayers ?? "không đọc được"}).`,
          );
        }
      } else {
        // Module chính sách không nạp được. Đã kêu to ở `loadOutcomeRunner()`. Lượt nạp vẫn phải
        // chạy (telemetry không được làm hỏng đường nạp) — nhưng chạy ở hình dạng TỐI THIỂU và
        // KHÔNG có ba kết cục: một lượt, một giấy phép, hỏng thì ném.
        vramHolder.ticket = await beginVram({
          owner: `gguf:${modelId}`,
          kind: "gguf-model",
          priority: "interactive",
          filePath: resolvedPath,
        });
        try {
          model = await llama.loadModel({
            modelPath: resolvedPath,
            // ⚠ Chặn -1 NGAY CẢ Ở ĐƯỜNG DỰ PHÒNG: đây đúng là đường mà một cấu hình hỏng đi qua.
            gpuLayers: typeof requestedGpuLayers === "number" && requestedGpuLayers < 0 ? "auto" : requestedGpuLayers,
          } as any);
        } catch (err) {
          // ★★ I-1 — CỬA IM LẶNG THỨ TƯ, và nó do CHÍNH Task 3 đẻ ra: bảng ★★ "không đường nào im
          // lặng" của vòng trước không có dòng nào cho nhánh này. Reviewer bắt đúng.
          await noteContextFailure(`gguf:${modelId}`, "gguf-model", "interactive", "loadGgufModel.fallbackNoRunner", err, {
            requestedGpuLayers,
            note2: "đường DỰ PHÒNG (vramLoadOutcome không nạp được) — không thử lại, không hạ số lớp",
          });
          throw err;
        }
      }
    }

    // Đợt 2 Task 3 — model chỉ-nhúng (config.embeddingOnly, truyền tường minh từ đường nhúng —
    // xem GgufModelConfig.embeddingOnly) KHÔNG BAO GIỜ sinh chữ nên KHÔNG cần context thường
    // (model.createContext, GGUF_DEFAULT_CTX×GGUF_SEQUENCES) — nó chỉ dùng
    // model.createEmbeddingContext() qua getEmbeddingContext(). Bỏ qua bước này giành lại
    // ~2,0 GB (đo Đợt 1: model+ctx thường 3.649 MiB so với embedding ctx thật 654 MiB).
    // Model text (embeddingOnly falsy/undefined) KHÔNG đổi hành vi — vẫn luôn tạo context.
    let context: any = undefined;
    if (!config.embeddingOnly) {
      // B0.2 — respect a requested per-task contextSize (clamped); else GGUF_DEFAULT_CTX.
      const resolvedCtx = resolveContextSize(config.contextSize);
      try {
        context = await model.createContext({
          contextSize: resolvedCtx,
          batchSize: config.batchSize ?? 512,
          flashAttention: config.flashAttention !== false,
          sequences: GGUF_SEQUENCES,
        });
      } catch (err) {
        // ★★ I-1 (review vòng 1) — ĐƯỜNG HỎNG DỄ XẢY RA NHẤT KHI VRAM SÁT TRẦN, và trước bản vá
        // này nó IM LẶNG TUYỆT ĐỐI: trọng số 16,7 GB đã nằm trên card, giờ mới xin thêm KV cache.
        // Không đổi một nhánh điều khiển nào — chỉ thêm sự kiện rồi ném lại NGUYÊN lỗi cũ.
        await noteContextFailure(`gguf:${modelId}`, "gguf-model", "interactive", "loadGgufModel.createContext", err, {
          contextSize: resolvedCtx,
          sequences: GGUF_SEQUENCES,
        });
        throw err;
      }
    }

    // Pha 1 Task 5 — GHI SỐ THẬT. ⚠ Số này là TRỌNG SỐ + CONTEXT, **CHƯA GỒM** buffer suy luận:
    // llama.cpp cấp phát compute buffer LƯỜI, ở lượt suy luận ĐẦU TIÊN — tức là SAU điểm này.
    // Người sau đọc `actualBytes` của giấy phép `gguf:*` đừng tưởng đó là tổng VRAM của model.
    // Phần chênh còn lại lộ ra ở `vramReconciler` dưới dạng lệch DƯƠNG sau lượt suy luận đầu.
    await vramHolder.ticket.commitMeasured();

    const loadTimeMs = Date.now() - startTime;
    console.log(`[aiGgufEngine] Model loaded in ${loadTimeMs}ms: ${modelId}`);

    loadedModels.set(modelId, {
      llama,
      model,
      context,
      config,
      loadedAt: new Date(),
      lastUsedAt: new Date(),
      useCount: 0,
      sizeBytes: typeof model.size === "number" ? model.size : 0,
      refCount: 0,
      vramTicket: vramHolder.ticket ?? undefined,
    });

    return modelId;
  })();

  inFlightLoads.set(modelId, loadPromise);
  try {
    return await loadPromise;
  } catch (err) {
    // Pha 1 Task 5 — lượt nạp hỏng ⇒ TRẢ chỗ. Không trả thì sổ giữ một giấy phép treo mãi mãi
    // và `vramReconciler` sẽ báo lệch ÂM (sổ > thiết bị) — đúng lớp báo động giả phải tránh.
    // Ném lại NGUYÊN lỗi cũ: nhánh này không đổi hành vi của lượt nạp.
    releaseVramTicketQuietly(vramHolder.ticket);
    throw err;
  } finally {
    // Bắt buộc: nạp thất bại mà không xoá khỏi map thì mọi lượt sau sẽ nhận lại đúng
    // promise lỗi đó vĩnh viễn (không bao giờ thử nạp lại).
    inFlightLoads.delete(modelId);
  }
}

/** Đợt 2 Task 3 — review round 1 Critical-1: khoá in-flight cho ensureTextContext() (tạo LƯỜI
 *  context thường khi thiếu), cùng khuôn inFlightLoads/embeddingContextInFlight. */
const textContextInFlight = new Map<string, Promise<any>>();

/**
 * Đợt 2 Task 3 — review round 1 Critical-1: LƯỚI AN TOÀN cho model TEXT thiếu context thường.
 *
 * BỐI CẢNH LỖI: `embeddingOnly` (cờ `purpose === "embed"` truyền từ `getOrLoadModel()`) là
 * thuộc tính của LƯỢT GỌI, không phải của MODEL — nhưng `loadedModels` cache theo `modelId`
 * DÙNG CHUNG cho mọi purpose. `modelId` trong `generateEmbedding(text, modelId)` đến từ HTTP
 * (`server/routers/aiGgufRouter.ts`, `protectedProcedure`, `modelId: z.string().optional()` —
 * bất kỳ user đã đăng nhập nào truyền được): nếu trùng basename với một model TEXT (kể cả
 * `GGUF_DEFAULT_MODEL`), model đó bị nạp với `context===undefined` rồi CACHE VĨNH VIỄN;
 * `getGenerationModel()` bước 1 (`takeLoadedModel`) trả lại y nguyên cho lượt sinh chữ sau đó
 * mà không kiểm `.context` ⇒ `loaded.context.getSequence()` throw, KHÔNG tự lành.
 *
 * SỬA: mọi nơi ĐỌC `.context` để sinh chữ (6 hàm: generateText/chatCompletion/generateJSON/
 * generateFimNative/generateTextStream/chatCompletionStream) gọi hàm này TRƯỚC. Đường ĐA SỐ
 * (model text nạp bình thường, `.context` đã có sẵn từ `loadGgufModel()`) trả về ngay — không
 * tốn gì thêm, không đổi hành vi. Đường HIẾM (model bị nạp `embeddingOnly` nhưng nay có lượt
 * sinh chữ xin đúng modelId đó) tạo context LƯỜI, ĐÚNG công thức production `loadGgufModel()`
 * dùng (`resolveContextSize`/`GGUF_SEQUENCES` — không rẽ nhánh riêng), cache lại — model TỰ
 * LÀNH ngay lượt gọi kế tiếp thay vì kẹt tới khi restart/admin unload. Khoá in-flight tránh 2
 * lượt sinh chữ đồng thời cùng tạo 2 context lười cho cùng modelId.
 */
async function ensureTextContext(
  modelId: string,
  loaded: LoadedModel,
  requestedContextSize?: number,
): Promise<any> {
  // review round 2 M-b — modelId này được KHAI BÁO (qua env: GGUF_EMBED_MODEL/
  // GGUF_EMBEDDING_MODEL/GGUF_RERANKER_MODEL/GGUF_VISION_MMPROJ — identity, KHÔNG đoán theo
  // tên file) là embedder/reranker/projector THẬT, không có đầu sinh văn bản. Tạo context
  // thường rồi để LlamaChatSession sinh chữ trên nó sẽ cho ra chuỗi lặp vô nghĩa — đúng
  // "dishonest degradation" mà getGenerationModel() bước 0 được viết ra để chặn, nhưng hàng
  // rào đó chỉ áp cho đường KHÔNG ghim modelId. Ở đây modelId ĐÃ GHIM, nên chặn NGAY TẠI ĐÂY:
  // từ chối trung thực thay vì âm thầm sinh rác. Khác với model TEXT bị alias nhầm (ca chính của
  // Critical-1) — model đó KHÔNG khai báo non-generative nên vẫn đi tiếp xuống nhánh tạo context
  // lười bên dưới và TỰ LÀNH như trước.
  //
  // ⚠ review TOÀN NHÁNH I-2 — CỔNG NÀY PHẢI ĐỨNG TRƯỚC `if (loaded.context) return ...`.
  // Bản trước đặt nó SAU lối thoát sớm ⇒ chỉ đóng được NỬA VẾ: model đã khai báo là embedder mà
  // lỡ nạp KÈM context thường (lượt gọi ĐẦU TIÊN chạm nó có purpose="generate" — mặc định của
  // getOrLoadModel, ví dụ ngay sau boot khi chưa lượt nhúng nào nạp nó trước) thoát ở dòng đầu và
  // KHÔNG BAO GIỜ tới cổng ⇒ sinh chuỗi lặp vô nghĩa rồi trình bày như câu trả lời thật. Đường
  // HTTP có thật: routes/openaiGateway.ts:365 → resolveModelId → resolveLogicalModel("embed")
  // (services/ai/modelResolver.ts:238) → chatCompletion(). Rác trình bày như câu trả lời tệ hơn
  // một lỗi ném ra — xem aiGgufEngine.nonGenerativeGuardOrder.test.ts.
  if (isConfiguredNonGenerativeModelId(modelId)) {
    throw new Error(
      `Refusing to create a text-generation context for "${modelId}": it is DECLARED as the ` +
        `embedding/reranker/vision-projector model (GGUF_EMBED_MODEL/GGUF_EMBEDDING_MODEL/` +
        `GGUF_RERANKER_MODEL/GGUF_VISION_MMPROJ). It has no text-generation head — forced to ` +
        `generate it would emit token-repetition garbage. [VI] Từ chối tạo context sinh chữ cho ` +
        `"${modelId}" — model này đã khai báo (qua .env) là nhúng/rerank/projector, không có đầu ` +
        `sinh văn bản.`,
    );
  }

  if (loaded.context) return loaded.context;

  const pending = textContextInFlight.get(modelId);
  if (pending) return pending;

  console.warn(
    `[aiGgufEngine] ${modelId}: sinh chữ trên model KHÔNG có context thường (trước đó nạp qua ` +
      `đường nhúng — embeddingOnly) — tạo LƯỜI ngay bây giờ. Nếu log này lặp lại, kiểm tra modelId ` +
      `truyền vào generateEmbedding()/generateEmbeddings() có đang trùng một model TEXT không ` +
      `(xem review round 1 Critical-1, docs/superpowers/reports/2026-08-02-dot2-report.md §3).`,
  );

  // Pha 1 Task 5 — giữ giấy phép NGOÀI IIFE để nhánh `catch` bên dưới trả được chỗ khi
  // createContext() ném (VRAM gần đầy) — cùng lý do đã ghi ở loadGgufModel().
  const vramHolder: { ticket: VramTicket | null } = { ticket: null };

  const createPromise = (async () => {
    // review round 2 M-a — cùng hàng rào loadGgufModel() dùng TRƯỚC khi cấp phát VRAM: giải
    // phóng model rảnh (LRU + GGUF_MAX_VRAM_MB) trước khi tạo context ~2GB. Thiếu bước này,
    // kịch bản alias khi VRAM gần đầy sẽ OOM (ném ở createContext bên dưới) thay vì evict được
    // model rảnh trước — đây chính xác là điều kiện kích hoạt Important-mới (rò refCount) dễ
    // xảy ra nhất trên thực tế.
    await ensureCapacity();
    const resolvedCtx = resolveContextSize(requestedContextSize ?? loaded.config.contextSize);
    // Pha 1 Task 5 — CHỈ KHAI BÁO. `ensureCapacity()` ngay trên vẫn chạy y nguyên.
    // KHÔNG có file trên đĩa để suy ra kích thước context ⇒ ước lượng nấc "unknown" ở lượt
    // ĐẦU; `commitMeasured()` bên dưới ghi số THẬT và từ lượt sau nấc "learned" tiếp quản.
    // ⚠ CỐ Ý không truyền `configDefaultBytes`: một hằng số bịa ra ở đây chính là thứ đã trôi
    // bốn lần (spec §7) — thà nhận "không biết" rồi ĐO, còn hơn nhận nhầm một con số.
    vramHolder.ticket = await beginVram({
      owner: `gguf-ctx:${modelId}`,
      kind: "gguf-context",
      priority: "interactive",
    });
    let ctx: any;
    try {
      ctx = await loaded.model.createContext({
        contextSize: resolvedCtx,
        batchSize: loaded.config.batchSize ?? 512,
        flashAttention: loaded.config.flashAttention !== false,
        sequences: GGUF_SEQUENCES,
      });
    } catch (err) {
      // ★★ I-1 — cùng lớp với `loadGgufModel.createContext`. Ngữ nghĩa `ensureTextContext` KHÔNG
      // đổi (ràng buộc của task): `catch` bên dưới vẫn trả giấy phép và ném lại nguyên lỗi cũ.
      await noteContextFailure(`gguf-ctx:${modelId}`, "gguf-context", "interactive", "ensureTextContext.createContext", err, {
        contextSize: resolvedCtx,
        sequences: GGUF_SEQUENCES,
      });
      throw err;
    }
    await vramHolder.ticket.commitMeasured();
    loaded.textCtxVramTicket = vramHolder.ticket;
    loaded.context = ctx;
    // Hết đúng nghĩa "chỉ-nhúng" — giữ metadata (getLoadedGgufModels()) khớp thực tế, tránh
    // hiển thị nhầm cho admin xem trạng thái model.
    loaded.config.embeddingOnly = false;
    return ctx;
  })();

  textContextInFlight.set(modelId, createPromise);
  try {
    return await createPromise;
  } catch (err) {
    // Pha 1 Task 5 — tạo context hỏng ⇒ TRẢ chỗ, rồi ném lại NGUYÊN lỗi cũ (không đổi hành vi).
    releaseVramTicketQuietly(vramHolder.ticket);
    throw err;
  } finally {
    // Bắt buộc: tạo thất bại mà không xoá khỏi map thì mọi lượt sau nhận lại đúng promise lỗi
    // đó vĩnh viễn — cùng lý do inFlightLoads/embeddingContextInFlight đã ghi.
    textContextInFlight.delete(modelId);
  }
}

/**
 * Unload a model from memory
 */
export async function unloadGgufModel(modelId: string): Promise<boolean> {
  const loaded = loadedModels.get(modelId);
  if (!loaded) return false;

  try {
    // Dispose the cached embedding context first (if any) — it holds extra VRAM.
    if (loaded.embeddingContext) {
      try {
        await loaded.embeddingContext.dispose();
      } catch (e) {
        console.warn(`[aiGgufEngine] Error disposing embedding context for ${modelId}:`, (e as any)?.message ?? e);
      }
      loaded.embeddingContext = undefined;
    }
    // Đợt 2 Task 3 — model chỉ-nhúng không có context thường (loaded.context===undefined,
    // xem loadGgufModel()); guard trước khi dispose, nếu không .dispose() trên undefined
    // throw và toàn bộ nhánh try rơi xuống catch (model KHÔNG được unload sạch).
    if (loaded.context) {
      await loaded.context.dispose();
    }
    await loaded.model.dispose();
    loadedModels.delete(modelId);
    // Pha 1 Task 5 — trả chỗ SAU khi đã dispose thật, để sổ không rỗng trước thiết bị.
    releaseModelVramTickets(loaded);
    console.log(`[aiGgufEngine] Model unloaded: ${modelId}`);
    return true;
  } catch (err) {
    console.error(`[aiGgufEngine] Error unloading model ${modelId}:`, err);
    loadedModels.delete(modelId);
    // Pha 1 Task 5 — model đã bị gỡ khỏi registry kể cả khi dispose lỗi ⇒ sổ cũng phải nhả,
    // nếu không giấy phép treo vĩnh viễn.
    releaseModelVramTickets(loaded);
    return false;
  }
}

/**
 * ★★★ Pha 2B Task 5 (§5.2) — ĐỒNG BỘ `refCount` CỦA ENGINE SANG SỔ CÁI VRAM.
 *
 * `evictLRU()` đã dùng `refCount === 0` làm điều kiện đuổi từ trước khi có broker; cưỡng chế dùng
 * ĐÚNG con số đó để trả lời *"giấy phép này có nhàn rỗi không"*. Không có bốn lời gọi này thì mọi
 * giấy phép mãi mãi ở trạng thái ĐANG DÙNG (mặc định an toàn của `reserve()`), và câu từ chối sẽ
 * luôn nói *"có thể nhường: không có"* — tức cơ chế nhường chỗ có mã, có test, mà **không bao giờ
 * có ứng viên trên máy thật**.
 *
 * ⚠ KHÔNG đổi một nhánh điều khiển nào của engine (ràng buộc 2 — không viết lại `aiGgufEngine`):
 * hàm này chỉ CHÉP một con số đã có sang một cuốn sổ khác, và nó KHÔNG BAO GIỜ ném.
 * ⚠ Chép ĐÚNG SỐ, không chép một cờ `idle`: một phép dịch `n → boolean` ở đây là bản cài đặt THỨ
 * HAI của cùng một vị từ, ở phía không ai kiểm.
 */
function dongBoRefCountVaoSo(loaded: LoadedModel | undefined): void {
  try {
    loaded?.vramTicket?.noteRefCount(loaded.refCount);
  } catch {
    /* telemetry KHÔNG BAO GIỜ được làm hỏng đường suy luận — và một lượt chép hỏng chỉ có nghĩa
       "giấy phép vẫn coi như ĐANG DÙNG", tức chiều AN TOÀN (không ai bị thu hồi nhầm). */
  }
}

/**
 * Release an in-flight reference acquired via getOrLoadModel().
 * Call in a `finally` block so eviction can reclaim the model once idle.
 */
function releaseModel(loaded: LoadedModel | undefined): void {
  if (loaded && loaded.refCount > 0) loaded.refCount--;
  dongBoRefCountVaoSo(loaded);
}

/**
 * review TOÀN NHÁNH I-1 — nhả tham chiếu ĐÚNG MỘT LẦN cho MỘT lượt gọi.
 *
 * LỖI ĐANG VÁ: khuôn `getOrLoadModel()` (refCount++) → `withGgufSlot(fn)` với `releaseModel()`
 * nằm TRONG `fn` bị rò vĩnh viễn khi slot bị TỪ CHỐI, vì `withGgufSlot` reject **trước khi `fn`
 * chạy** ở hai đường: hàng đợi đầy (`ggufConcurrency.ts:80-81`, `GgufOverloadError`) và hết hạn
 * chờ (`:87-92`, `GgufSlotTimeoutError`, mặc định 120 s). `evictLRU()` (`:435`) bỏ qua mọi model
 * `refCount>0` ⇒ ~19 GB trọng số bị ghim tới khi restart, mỗi lượt bị từ chối cộng thêm 1.
 *
 * CÁCH VÁ: mỗi lượt gọi tạo MỘT releaser; gọi nó ở `finally` TRONG `fn` (đường chạy thật, nhả
 * đúng lúc suy luận xong) VÀ ở `finally` NGOÀI `withGgufSlot` (bắt đường bị từ chối). Cờ `done`
 * làm lần gọi thứ hai thành vô hại — không có bản vá nào trừ hai lần vào tham chiếu của lượt
 * khác, thứ sẽ khiến `evictLRU()` đuổi nhầm một model ĐANG DÙNG (hỏng theo hướng ngược lại, khó
 * thấy hơn). Xem aiGgufEngine.refcountSlotReject.test.ts.
 */
function makeOnceReleaser(loaded: LoadedModel | undefined): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    releaseModel(loaded);
  };
}

/**
 * doc69 W1 "modelfix" — CALLER INTENT for `getOrLoadModel`.
 *
 * The same function serves three very different needs, and before this fix it treated them
 * identically ("reuse whatever is resident"), which is precisely what let an EMBEDDING model be
 * handed to a text-generation request:
 *
 *   "generate" — text generation (generateText / chatCompletion / generateJSON / the streaming
 *                variants / native FIM). MUST have a real text-generation head. An embedding model
 *                here produces token-repetition garbage that LOOKS like an answer — the exact
 *                dishonest-degradation failure this platform must never have. Guarded below.
 *   "embed"    — generateEmbedding(s). These already resolve GGUF_EMBED_MODEL themselves and pass
 *                it EXPLICITLY, so they never reach the no-modelId branch unless GGUF_EMBED_MODEL
 *                is unset; the legacy resolution is preserved verbatim for them so the RAG path
 *                cannot regress.
 *   "tokenize" — countTokens(). Touches only `model.tokenize`, never a generation head. It has a
 *                single production caller — the tRPC `aiGgufRouter.tokenCount` query, which lets
 *                the caller pass its own `modelId` — so forcing a ~16.7 GB deep-model load just to
 *                answer "how many tokens is this string?" would be pure waste. It therefore keeps
 *                the legacy reuse-whatever-is-resident behavior. (Token COUNTS are not affected:
 *                every Qwen3 GGUF in this deployment shares one tokenizer.)
 *
 * The intent is an explicit PARAMETER rather than something inferred from the arguments: inferring
 * it is exactly the kind of guess that produced the original bug.
 */
type ModelPurpose = "generate" | "embed" | "tokenize";

/**
 * Is `id` the configured EMBEDDING model? Compared through the shared, suffix-safe
 * `toBasename()`/`embedModelBasename()` resolvers — never a hard-coded filename, so changing
 * GGUF_EMBED_MODEL in `.env` keeps the guard correct with no code change. Returns false when
 * GGUF_EMBED_MODEL is unset (nothing to exclude — the strict text-model preference below still
 * applies).
 */
function isEmbeddingModelId(id: string): boolean {
  const embed = resolveEmbedModelBasename();
  if (!embed) return false;
  return toBasename(id).toLowerCase() === toBasename(embed).toLowerCase();
}

/**
 * doc69 W1 modelfix, FIX ROUND 1 — basenames this deployment has EXPLICITLY DECLARED (via env) to
 * play a non-generative role. Same class of hazard as the embedder: a cross-encoder reranker and a
 * vision projector have no text-generation head either, so "generating" with one yields the same
 * repetition garbage. Env-driven, never hard-coded filenames.
 *
 * `GGUF_EMBEDDING_MODEL` is included deliberately: `.env` carries it alongside `GGUF_EMBED_MODEL`
 * and nothing reads it, which is exactly the sort of near-duplicate that invites a copy/paste
 * mistake into `GGUF_DEFAULT_MODEL`.
 */
function configuredNonGenerativeBasenames(): string[] {
  return [
    process.env.GGUF_EMBED_MODEL,
    process.env.GGUF_EMBEDDING_MODEL, // legacy alias present in .env, read by nothing else
    process.env.GGUF_RERANKER_MODEL,
    process.env.GGUF_VISION_MMPROJ,
  ]
    .map((v) => toBasename(v).toLowerCase())
    .filter(Boolean);
}

/**
 * STRICT check for a model the operator CHOSE (i.e. GGUF_DEFAULT_MODEL, or one a caller loaded
 * explicitly): is that exact file also declared as the embedder / reranker / projector? Identity
 * comparison only — no name guessing — so an operator whose legitimate chat model merely happens to
 * contain "embed" in its filename is never blocked by this.
 */
function isConfiguredNonGenerativeModelId(id: string): boolean {
  const base = toBasename(id).toLowerCase();
  if (!base) return false;
  return configuredNonGenerativeBasenames().includes(base);
}

/**
 * The name heuristic, as ONE constant so the refusal message can quote the exact pattern the
 * operator's filename tripped — "matches /embed|rerank|mmproj|projector/i" is actionable,
 * "looks wrong" is not.
 */
const NON_GENERATIVE_NAME_RE = /embed|rerank|mmproj|projector/i;

/**
 * HEURISTIC check. Used on the blind degradation rungs (steps 3-4 below) where nobody chose
 * the model for generation and we are guessing anyway. On those rungs the asymmetry is clear:
 * wrongly skipping a usable model costs an honest error message, wrongly ACCEPTING a reranker or a
 * projector costs the user a page of plausible-looking garbage. So it errs toward skipping.
 */
function isLikelyNonGenerativeModelId(id: string): boolean {
  if (isEmbeddingModelId(id) || isConfiguredNonGenerativeModelId(id)) return true;
  return NON_GENERATIVE_NAME_RE.test(toBasename(id));
}

/**
 * doc69 W1 modelfix, FIX ROUND 2 — escape hatch for the ONE legitimate false positive: a real chat
 * model whose filename happens to trip the name heuristic. That is not hypothetical in this product
 * (a fine-tune for *embedded* systems / PLC work would match `/embed/`), so the override exists —
 * but it DEFAULTS OFF, it is named in the refusal message, and it deliberately does NOT override the
 * self-contradictory case (a default that IS the declared embedder/reranker/projector).
 */
function allowNonGenerativeDefault(): boolean {
  const v = (process.env.GGUF_ALLOW_NONGENERATIVE_DEFAULT || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Take an already-resident model: bump LRU/usage counters and acquire an in-flight reference. */
function takeLoadedModel(modelId: string): { modelId: string; loaded: LoadedModel } | null {
  const loaded = loadedModels.get(modelId);
  if (!loaded) return null;
  loaded.lastUsedAt = new Date();
  loaded.useCount++;
  loaded.refCount++;
  dongBoRefCountVaoSo(loaded);
  return { modelId, loaded };
}

/**
 * doc69 W1 "modelfix" — resolve a model for TEXT GENERATION when the caller pinned nothing.
 *
 * THE BUG THIS REPLACES (measured live, 6 runs, modelId read back from the DB): the old code took
 * `loadedModels.entries().next()` — "whatever loaded first" — BEFORE it ever looked at
 * GGUF_DEFAULT_MODEL. RAG's `retrieveKnowledge()` loads the 0.6B embedder first, so it won, and
 * every un-pinned generation call produced `"result result result…"` garbage that the UI then
 * showed to a factory engineer as an answer.
 *
 * PRIORITY (deliberately inverted vs. the old code):
 *   0. reject a MISCONFIGURED default              — GGUF_DEFAULT_MODEL pointing at an embedder /
 *                                                    reranker / projector is the same bug via a
 *                                                    typo; drop it and keep descending. Checked by
 *                                                    DECLARED role (no override) AND by name
 *                                                    (override: GGUF_ALLOW_NONGENERATIVE_DEFAULT),
 *                                                    because an UNREGISTERED embedder is invisible
 *                                                    to identity matching alone.
 *   1. GGUF_DEFAULT_MODEL if already resident      — the configured chat model, zero load cost.
 *   2. GGUF_DEFAULT_MODEL, loading it              — configuration beats load-order. Never
 *                                                    silently downgrade to a smaller model.
 *   3. any OTHER resident GENERATIVE model         — honest degradation when (2) fails (VRAM/OOM):
 *                                                    still a real text model, just not the deep one.
 *   4. first GENERATIVE .gguf in the models dir    — last resort for an unconfigured install.
 *   5. THROW                                       — no text model ⇒ say so. Returning the embedder
 *                                                    "so something comes back" IS the bug.
 */
async function getGenerationModel(contextSize?: number): Promise<{ modelId: string; loaded: LoadedModel }> {
  let defaultId = resolveDefaultModelBasename();
  const why: string[] = [];

  // 0 — FIX ROUND 1+2: refuse a MISCONFIGURED default before steps 1-2 can hand it back. Pointing
  // GGUF_DEFAULT_MODEL at an embedder (or a reranker/projector) restores the exact bug this whole
  // guard exists to kill — via one `.env` typo instead of load order. Rejecting it HERE covers BOTH
  // the "already resident" and the "load it" branch in one place, and lets the ladder fall through
  // to a genuine text model rather than failing outright.
  //
  // TWO tiers, deliberately (round 2 — the re-review reproduced a real hole in exact-matching only):
  //   (a) DECLARED role — the same file is also assigned to GGUF_EMBED_MODEL / GGUF_EMBEDDING_MODEL /
  //       GGUF_RERANKER_MODEL / GGUF_VISION_MMPROJ. Self-contradictory config; NO override.
  //   (b) NAME heuristic — an UNREGISTERED embedder (a second index model, a leftover download) that
  //       exact matching cannot see at all. Refused by default; overridable via
  //       GGUF_ALLOW_NONGENERATIVE_DEFAULT for the rare legitimately-named chat model.
  // Cost asymmetry decides (b): a false positive costs the operator one clear error message; a false
  // negative costs every user a page of convincing-looking garbage, silently.
  if (defaultId) {
    const declaredRole = isConfiguredNonGenerativeModelId(defaultId);
    const trippedNameHeuristic = !declaredRole && isLikelyNonGenerativeModelId(defaultId);
    const overridden = trippedNameHeuristic && allowNonGenerativeDefault();

    if (declaredRole || (trippedNameHeuristic && !overridden)) {
      const reason = declaredRole
        ? "it is ALSO assigned to GGUF_EMBED_MODEL / GGUF_EMBEDDING_MODEL / GGUF_RERANKER_MODEL / " +
          "GGUF_VISION_MMPROJ, which is a self-contradictory configuration (no override available)"
        : `its basename matches the non-generative name pattern ${NON_GENERATIVE_NAME_RE} — if this ` +
          "really IS a chat model, set GGUF_ALLOW_NONGENERATIVE_DEFAULT=true to override this refusal";
      const msg =
        `GGUF_DEFAULT_MODEL "${defaultId}" was REFUSED as a NON-GENERATIVE model because ${reason}. ` +
        "Embedding/reranker/projector models have no text-generation head: forced to generate they " +
        "emit token-repetition garbage that reads like a real answer. FIX: point GGUF_DEFAULT_MODEL " +
        "at a chat model (e.g. Qwen3-30B-A3B-Instruct)";
      why.push(msg);
      console.error(`[aiGgufEngine] ${msg}`);
      defaultId = undefined;
    } else if (overridden) {
      console.warn(
        `[aiGgufEngine] GGUF_DEFAULT_MODEL "${defaultId}" matches the non-generative name pattern ` +
          `${NON_GENERATIVE_NAME_RE} but GGUF_ALLOW_NONGENERATIVE_DEFAULT is set — using it for text ` +
          "generation anyway. If answers come back as repeated tokens, this override is why.",
      );
    }
  }

  // 1 — configured chat model already resident.
  if (defaultId) {
    const hot = takeLoadedModel(defaultId);
    if (hot) return hot;
  }

  // 2 — load the configured chat model. Configuration wins over "whatever is hot".
  if (defaultId) {
    try {
      // B0.2 — forward the per-task contextSize hint on first load (KV-cache sizing).
      const id = await loadGgufModel({ modelPath: `${defaultId}.gguf`, contextSize });
      const got = takeLoadedModel(id);
      if (got) return got;
      why.push(`GGUF_DEFAULT_MODEL "${defaultId}" reported loaded but is not resident`);
    } catch (err) {
      const msg = (err as any)?.message ?? String(err);
      why.push(`GGUF_DEFAULT_MODEL "${defaultId}" failed to load: ${msg}`);
      console.error(`[aiGgufEngine] could not load GGUF_DEFAULT_MODEL "${defaultId}": ${msg}`);
    }
  } else {
    why.push("GGUF_DEFAULT_MODEL is not set");
  }

  // 3 — honest degradation: any OTHER resident model that can actually generate text.
  for (const id of loadedModels.keys()) {
    if (isLikelyNonGenerativeModelId(id)) continue;
    const got = takeLoadedModel(id);
    if (got) {
      console.warn(
        `[aiGgufEngine] GGUF_DEFAULT_MODEL unavailable — generating with the already-resident text model "${id}" instead.`,
      );
      return got;
    }
  }

  // 4 — last resort: first GENERATIVE .gguf on disk. FIX ROUND 1 — readdir order is arbitrary and
  // GGUF_MODELS_DIR also holds a cross-encoder reranker and a vision projector, so skipping only
  // embedders (as isGgufModelLoadable does) left two more ways to "generate" with a model that has
  // no generation head. isLikelyNonGenerativeModelId covers all three by role AND by name.
  try {
    ensureModelsDir();
    const files = fs.readdirSync(GGUF_MODELS_DIR).filter((f) => f.endsWith(".gguf"));
    for (const f of files) {
      const base = toBasename(f);
      if (isLikelyNonGenerativeModelId(base)) continue;
      try {
        const id = await loadGgufModel({ modelPath: f, contextSize });
        const got = takeLoadedModel(id);
        if (got) {
          console.warn(`[aiGgufEngine] no configured chat model — generating with on-disk "${id}".`);
          return got;
        }
      } catch (err) {
        why.push(`"${f}" failed to load: ${(err as any)?.message ?? String(err)}`);
      }
    }
  } catch (err) {
    why.push(`models dir scan failed: ${(err as any)?.message ?? String(err)}`);
  }

  // 5 — HONEST FAILURE. Never substitute the embedding model for a generation request.
  throw new Error(
    "No text-generation model available (GGUF_DEFAULT_MODEL not loadable); refusing to generate " +
      `with the embedding model. Cause: ${why.join(" | ") || "no candidate models found"}. ` +
      "Set GGUF_DEFAULT_MODEL to a chat model (e.g. Qwen3-30B-A3B-Instruct) that exists under " +
      "GGUF_MODELS_DIR. [VI] Không có model sinh văn bản khả dụng — TỪ CHỐI sinh chữ bằng model " +
      "nhúng (model nhúng không có đầu sinh văn bản, chỉ trả ra chuỗi lặp vô nghĩa).",
  );
}

/**
 * Get or load a model — loads from default path if not already in memory.
 *
 * `purpose` (doc69 W1 modelfix) selects the resolution policy when NO modelId is pinned; see
 * `ModelPurpose` above. An EXPLICIT modelId always wins and is loaded verbatim for every purpose
 * (a caller that deliberately asks for the embedder — the embedding path does — still gets it).
 */
async function getOrLoadModel(
  modelId?: string,
  contextSize?: number,
  purpose: ModelPurpose = "generate",
): Promise<{ modelId: string; loaded: LoadedModel }> {
  if (modelId && loadedModels.has(modelId)) {
    const loaded = loadedModels.get(modelId)!;
    loaded.lastUsedAt = new Date();
    loaded.useCount++;
    loaded.refCount++;
    dongBoRefCountVaoSo(loaded);
    return { modelId, loaded };
  }

  // If no specific model requested, resolve according to the caller's INTENT.
  if (!modelId) {
    // Text generation: strict, embedder-proof, fails loudly (see getGenerationModel).
    if (purpose === "generate") return getGenerationModel(contextSize);

    // "embed"/"tokenize": legacy resolution, preserved VERBATIM. Neither drives a generation
    // head, and generateEmbedding(s) already pin GGUF_EMBED_MODEL explicitly, so this branch is
    // only reached when GGUF_EMBED_MODEL is unset (embed) or nothing was pinned (tokenize).
    // Check if any model is already loaded
    if (loadedModels.size > 0) {
      const [firstId, firstModel] = loadedModels.entries().next().value!;
      firstModel.lastUsedAt = new Date();
      firstModel.useCount++;
      firstModel.refCount++;
      dongBoRefCountVaoSo(firstModel);
      return { modelId: firstId as string, loaded: firstModel };
    }

    // Try to auto-load the default model from env
    const defaultModel = process.env.GGUF_DEFAULT_MODEL;
    if (defaultModel) {
      // B0.2 — forward the per-task contextSize hint on first load (KV-cache sizing).
      // Đợt 2 Task 3 — embeddingOnly truyền từ INTENT của caller (purpose), không đoán theo
      // tên file: mọi model nạp qua nhánh "embed" ở đây (đường nhúng dự phòng khi
      // GGUF_EMBED_MODEL chưa cấu hình) không bao giờ sinh chữ, nên không cần context thường.
      const id = await loadGgufModel({ modelPath: defaultModel, contextSize, embeddingOnly: purpose === "embed" });
      return getOrLoadModel(id, contextSize, purpose);
    }

    // Try first .gguf file in models directory
    ensureModelsDir();
    const files = fs.readdirSync(GGUF_MODELS_DIR).filter(f => f.endsWith(".gguf"));
    if (files.length > 0) {
      const id = await loadGgufModel({ modelPath: files[0], contextSize, embeddingOnly: purpose === "embed" });
      return getOrLoadModel(id, contextSize, purpose);
    }

    throw new Error("No GGUF model available. Upload a .gguf file or set GGUF_DEFAULT_MODEL env var.");
  }

  // Try to load the specified model. Đợt 2 Task 3 — embeddingOnly: purpose==="embed" là ĐƯỜNG
  // CHÍNH mà generateEmbedding()/generateEmbeddings() đi qua (modelId tường minh — GGUF_EMBED_MODEL
  // hoặc modelId caller truyền). purpose "generate"/"tokenize" giữ nguyên hành vi (embeddingOnly
  // falsy → context thường vẫn được tạo như trước).
  const id = await loadGgufModel({ modelPath: `${modelId}.gguf`, contextSize, embeddingOnly: purpose === "embed" });
  return getOrLoadModel(id, contextSize, purpose);
}

// ─── Text Generation ───────────────────────────────────────────

/**
 * Warm (pre-load) a model into GPU memory so the LARGE model is resident BEFORE any small one.
 * node-llama-cpp fragments VRAM when a large model (30B ~16.7 GB) loads AFTER a small one (e.g.
 * the 0.6B embedder pulled in by RAG) — the large alloc then fails even with plenty of free VRAM.
 * Warming the deep model first (a 1-token generation) sidesteps it. Best-effort: never throws.
 * Returns true if the model is now resident. Callers that do RAG-embed-THEN-deep (codegen, and
 * ideally the ops chat/RCA paths) should call this before the RAG step. See doc 34 §P4.
 */
export async function warmModel(modelId?: string, contextSize?: number): Promise<boolean> {
  let available = false;
  try {
    available = await isGgufAvailable();
  } catch (err) {
    noteWarmFailure(modelId, "availability-probe-threw", err);
    return false;
  }
  if (!available) {
    // ⚠ M-5 (review vòng 1) — `warm_skipped`, KHÔNG PHẢI `warm_failed`. Một cài đặt cố ý không cấu
    // hình GGUF sẽ ghi một dòng MỖI LẦN KHỞI ĐỘNG; để nó mang tên "failed" là bắt Task 7 phải lọc
    // rác trong chính bảng nó dùng để đếm thất bại. Vẫn có sự kiện (người gọi vẫn nhận `false`,
    // nên vẫn phải phân biệt được với hai nhánh kia), chỉ khác TÊN.
    noteWarmFailure(modelId, "gguf-unavailable", null, "warm_skipped");
    return false;
  }
  try {
    await generateText({ prompt: "ok", maxTokens: 1, contextSize }, modelId);
    return true;
  } catch (err) {
    noteWarmFailure(modelId, "generate-threw", err);
    return false;
  }
}

/**
 * ★★★ Pha 2B Task 3 — NGUYÊN NHÂN THỨ HAI (độc lập) CỦA `0/24` LƯỢT KHÔNG CÓ VẾT.
 *
 * `warmModel()` là điểm gọi nạp model 30B (~16,7 GB) LỚN NHẤT của cả hệ và là lượt nạp mà Ư0 đo,
 * nhưng nhánh lỗi của nó là một `catch` **nuốt trọn**: `return false`, không log, không sự kiện.
 * Người gọi duy nhất ở boot (`initDeepModelWarmup`) chỉ in *"deep model warm FAILED"* — một câu
 * KHÔNG mang lỗi, KHÔNG mang model, KHÔNG vào DB. Kết quả: mọi thất bại nạp lúc khởi động — kể cả
 * chính lượt `cudaMalloc failed` mà cả Đợt 1 lẫn Đợt 2 đi tìm — **vô hình với Task 7**.
 *
 * Ba nhánh trả `false`, ba lý do KHÁC HẲN nhau, nay ba `reason` riêng:
 *   • `availability-probe-threw` — `isGgufAvailable()` NÉM (đường hiếm; trước đây lẫn hoàn toàn
 *     vào nhánh dưới vì cả hai nằm trong cùng một `try`);
 *   • `gguf-unavailable` — không cấu hình/không có file. KHÔNG phải lỗi, nhưng người gọi vẫn nhận
 *     `false` nên vẫn phải phân biệt được với hai nhánh kia;
 *   • `generate-threw` — lượt nạp/suy luận THẬT hỏng. **Đây là nhánh mà Ư0 cần.**
 *
 * ⚠ KHÔNG BAO GIỜ ném (`warmModel` hứa "best-effort, never throws" và `initDeepModelWarmup` dựa
 * vào đó để không làm hỏng boot). Mọi thứ trong đây bọc `try`.
 */
function noteWarmFailure(
  modelId: string | undefined,
  reason: string,
  err: unknown,
  event: "warm_failed" | "warm_skipped" = "warm_failed",
): void {
  const message = err === null || err === undefined ? null : (err as Error)?.message ?? String(err);
  try {
    console.warn(
      `[aiGgufEngine] warmModel("${modelId ?? "(mặc định)"}") trả FALSE — ${reason}` +
        (message ? `: ${message}` : "") +
        `. Trước Pha 2B nhánh này im lặng tuyệt đối; đó là lý do 0/24 lượt của Ư0 không có vết nào.`,
    );
  } catch {
    /* console hỏng thì cũng không được làm ngã boot */
  }
  void (async () => {
    try {
      const { logVramEvent } = await import("./vram/vramEventLog");
      logVramEvent({
        event,
        owner: `gguf:${modelId ?? "default"}`,
        leaseKind: "gguf-model",
        priority: "interactive",
        detail: {
          reason,
          modelId: modelId ?? null,
          error: message,
          note:
            "warmModel() trả false. Đây là điểm gọi nạp model 30B lớn nhất của hệ và là lượt nạp " +
            "mà Ư0 đo được 0/24 lượt CÓ VẾT — vì nhánh này từng là một catch nuốt trọn.",
        },
      });
    } catch {
      /* nhật ký hỏng KHÔNG được làm hỏng lượt warm (đã có console.warn ở trên) */
    }
  })();
}

/**
 * doc69 W1 "modelfix" — BOOT-TIME deep-model warm. `warmModel` above was written specifically to
 * defuse the VRAM-ordering trap it documents, but nothing in production ever called it (grep: only
 * tests + the copilot/RCA paths, which warm a CODE model), so the trap stayed armed: RAG made the
 * 0.6B embedder resident first on every boot.
 *
 * Registered from `server/_core/backgroundJobs.ts` alongside the other schedulers. Best-effort and
 * fail-safe by construction — `warmModel` never throws, the timer is unref'd (never holds the
 * event loop open) and the whole body is defensive, so a missing/unloadable model can never affect
 * boot. Idempotent: a second call is a no-op.
 *
 * Env:
 *   GGUF_WARM_DEEP_MODEL_ON_BOOT=false → skip entirely (e.g. a low-VRAM box, or ROLE=worker hosts
 *                                        that never serve chat).
 *   GGUF_WARM_DELAY_MS                 → delay before warming (default 3000ms).
 *
 * ⚠ ĐÍNH CHÍNH 2026-08-02 (Đợt 1 + Đợt 2 Task 5/Task 6) — LÝ DO ghi kèm GGUF_WARM_DELAY_MS ở bản
 * cũ SAI, đã gỡ: bản cũ viết *"so the warm never competes with the rest of boot"*. Đo thật nói
 * NGƯỢC LẠI: hoãn KHÔNG giúp gì — chính việc CUDA context được tạo **SAU** khi app boot mới là
 * ĐIỀU KIỆN gây lỗi. Bằng chứng: `GGUF_WARM_DELAY_MS=120000` vẫn hỏng (Đợt 1); tại HEAD Đợt 2 lỗi
 * tái hiện **3/3 lượt** (reviewer tái hiện độc lập thêm 3 lượt), nguyên văn
 * `ggml_backend_cuda_buffer_type_alloc_buffer: allocating 16698.37 MiB ... cudaMalloc failed: out of
 * memory`, trong khi thiết bị mới dùng ~1,6 GB / 32.607 MiB. Hỏng cả trên `npm run dev` lẫn
 * `npm run dev:worker` (không có HTTP/Vite). ⇒ **Tăng delay chỉ làm hỏng chắc hơn, không phải nhẹ đi.**
 * Ngược lại: nếu CUDA context đã tồn tại **TRƯỚC** khi app boot — chỉ cần *chạm* `getLlama()`, giá
 * ~420-430 MiB VRAM / ~1,2-2,3 s, không cần nạp model nào — thì chính đường warm này nạp 30B THÀNH
 * CÔNG (đo 3/3 nhánh).
 * ⚠ **CƠ CHẾ VẪN CHƯA BIẾT ⇒ KHÔNG vá theo mô tả này.** Trần quan sát được KHÔNG tái hiện giữa hai
 * phiên đo cùng ngày (mọi ngưỡng trung gian đã bị RÚT; số duy nhất còn trích được là 16.698,37 MiB).
 * Phép thử phải chạy trước mọi bản vá: lặp cùng một lượt thử 5 lần để biết trần có tất định không.
 * Chi tiết: docs/superpowers/reports/2026-08-02-dot2-report.md §5.
 */
let deepWarmStarted = false;
export function initDeepModelWarmup(): void {
  if (deepWarmStarted) return;
  deepWarmStarted = true;

  if ((process.env.GGUF_WARM_DEEP_MODEL_ON_BOOT || "").trim().toLowerCase() === "false") {
    console.log("[aiGgufEngine] deep-model boot warm disabled (GGUF_WARM_DEEP_MODEL_ON_BOOT=false)");
    return;
  }

  const raw = Number(process.env.GGUF_WARM_DELAY_MS);
  const delayMs = Number.isFinite(raw) && raw > 0 ? raw : 3000;

  const timer = setTimeout(() => {
    void (async () => {
      try {
        const deep = resolveDefaultModelBasename();
        if (!deep) {
          console.warn("[aiGgufEngine] deep-model boot warm skipped — GGUF_DEFAULT_MODEL is not set.");
          return;
        }
        const ok = await warmModel(deep);
        console.log(
          ok
            ? `[aiGgufEngine] deep model warm OK — "${deep}" resident before RAG loads the embedder.`
            : `[aiGgufEngine] deep model warm FAILED for "${deep}" — un-pinned generation will now fail LOUDLY rather than degrade to the embedder.`,
        );
      } catch (err) {
        console.error("[aiGgufEngine] deep-model boot warm errored:", (err as any)?.message ?? err);
      }
    })();
  }, delayMs);
  if (typeof timer.unref === "function") timer.unref();
}

/**
 * Generate text using a loaded GGUF model
 */
export async function generateText(options: GgufGenerateOptions, modelId?: string): Promise<GgufGenerateResult> {
  // R5 — offload deep-model text generation to a PERSISTENT llama-server (own
  // VRAM) when configured, keeping the in-process embedder free of contention.
  // OFF by default → falls straight through to the in-process path below.
  // doc69 G2-6 — FAIL-SAFE: a short preflightHealthy() probe runs first so a down/unreachable
  // server is skipped in ~2s (LLAMA_SERVER_HEALTH_TIMEOUT_MS) instead of waiting out the full
  // generation timeout; the try/catch below still covers a server that passes preflight but
  // fails/times out during the actual call. Either way, in-process runs and the answer is
  // still returned — unless LLAMA_SERVER_STRICT=true, which throws instead of silently
  // degrading (see module header of aiLlamaServerClient.ts).
  {
    const srv = await import("./aiLlamaServerClient");
    if (srv.shouldUseServerForText(modelId)) {
      const healthy = await srv.preflightHealthy().catch(() => false);
      if (!healthy) {
        if (srv.llamaServerStrict()) {
          throw new Error("[aiGgufEngine] llama-server preflight health check failed (LLAMA_SERVER_STRICT=true)");
        }
        console.warn(
          "[aiGgufEngine] llama-server preflight health check failed — falling back in-process (server unreachable/unhealthy)",
        );
      } else {
        try {
          return await srv.serverGenerateText(options, modelId);
        } catch (e) {
          if (srv.llamaServerStrict()) throw e;
          console.warn(
            `[aiGgufEngine] llama-server generation failed, falling back in-process: ${(e as Error)?.message || e}`,
          );
        }
      }
    }
  }

  const { modelId: resolvedId, loaded } = await getOrLoadModel(modelId, options.contextSize);
  // review toàn nhánh I-1 — nhả tham chiếu đúng MỘT lần cho lượt gọi này, kể cả khi withGgufSlot()
  // TỪ CHỐI slot (khi đó `fn` không chạy ⇒ `finally` bên trong nó cũng không chạy). Xem
  // makeOnceReleaser() và aiGgufEngine.refcountSlotReject.test.ts.
  const release = makeOnceReleaser(loaded);
  // Đợt 2 Task 3 — review round 1 Critical-1: lưới an toàn, xem ensureTextContext(). review
  // round 2 Important-mới — getOrLoadModel() đã refCount++; nếu ensureTextContext() ném (OOM
  // là lúc dễ ném nhất), release() TRƯỚC khi rethrow — thiếu bước này refCount kẹt >0
  // vĩnh viễn, evictLRU() bỏ qua model này mãi mãi.
  try {
    await ensureTextContext(resolvedId, loaded, options.contextSize);
  } catch (e) {
    release();
    throw e;
  }
  const startTime = Date.now();

  // Build prompt with system message
  let fullPrompt = options.prompt;
  if (options.systemPrompt) {
    fullPrompt = `${options.systemPrompt}\n\n${options.prompt}`;
  }

  if (options.jsonMode) {
    fullPrompt += "\n\nRespond with valid JSON only. No markdown, no explanations.";
  }

  const { LlamaChatSession } = await import("node-llama-cpp");

  // Mục 4: serialize GGUF inference through the global concurrency semaphore to
  // protect VRAM. The slot is held across getSequence()→prompt→dispose.
  return withGgufSlot(async () => {
    // Create a fresh session for each generation to avoid context contamination
    const sequence = loaded.context.getSequence();
    const session = new LlamaChatSession({ contextSequence: sequence });

    try {
      const response = await session.prompt(fullPrompt, {
        maxTokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.7,
        topP: options.topP ?? 0.9,
        topK: options.topK ?? 40,
        repeatPenalty: {
          penalty: options.repeatPenalty ?? 1.1,
        },
        stopGenerationTrigger: options.stopSequences
          ? options.stopSequences.map(s => [{ type: "text" as const, text: s }])
          : undefined,
      } as any);

      const totalTimeMs = Date.now() - startTime;
      recordInferenceLatency(resolvedId, startTime); // TASK A: per-generation latency histogram
      // Accurate token counting using model tokenizer
      const tokensPrompt = loaded.model.tokenize(fullPrompt).length;
      const tokensGenerated = loaded.model.tokenize(response).length;
      const tokensPerSecond = totalTimeMs > 0 ? (tokensGenerated / totalTimeMs) * 1000 : 0;

      return {
        text: response,
        tokensGenerated,
        tokensPrompt,
        totalTimeMs,
        tokensPerSecond: Number(tokensPerSecond.toFixed(1)),
        modelId: resolvedId,
      };
    } finally {
      sequence.dispose();
      release();
    }
  }).finally(release); // I-1: bắt đường withGgufSlot TỪ CHỐI slot (fn không chạy) — idempotent
}

/**
 * Chat completion with message history
 */
export async function chatCompletion(options: GgufChatOptions, modelId?: string): Promise<GgufGenerateResult> {
  const { modelId: resolvedId, loaded } = await getOrLoadModel(modelId, options.contextSize);
  // review toàn nhánh I-1 — nhả tham chiếu đúng MỘT lần cho lượt gọi này, kể cả khi withGgufSlot()
  // TỪ CHỐI slot (khi đó `fn` không chạy ⇒ `finally` bên trong nó cũng không chạy). Xem
  // makeOnceReleaser() và aiGgufEngine.refcountSlotReject.test.ts.
  const release = makeOnceReleaser(loaded);
  // Đợt 2 Task 3 — review round 1 Critical-1: lưới an toàn, xem ensureTextContext(). review
  // round 2 Important-mới — getOrLoadModel() đã refCount++; nếu ensureTextContext() ném (OOM
  // là lúc dễ ném nhất), release() TRƯỚC khi rethrow — thiếu bước này refCount kẹt >0
  // vĩnh viễn, evictLRU() bỏ qua model này mãi mãi.
  try {
    await ensureTextContext(resolvedId, loaded, options.contextSize);
  } catch (e) {
    release();
    throw e;
  }
  const startTime = Date.now();

  // Build conversation from message history
  const systemMsg = options.messages.find(m => m.role === "system");
  const userMessages = options.messages.filter(m => m.role !== "system");

  let prompt = "";
  if (systemMsg) {
    prompt += `System: ${systemMsg.content}\n\n`;
  }
  for (const msg of userMessages) {
    prompt += `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}\n`;
  }
  prompt += "Assistant: ";

  if (options.jsonMode) {
    prompt += "(Respond with valid JSON only)\n";
  }

  const { LlamaChatSession } = await import("node-llama-cpp");

  // Mục 4: hold a GGUF concurrency slot across the whole inference block.
  return withGgufSlot(async () => {
    const sequence = loaded.context.getSequence();
    const session = new LlamaChatSession({ contextSequence: sequence });

    try {
      const response = await session.prompt(prompt, {
        maxTokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.7,
        topP: options.topP ?? 0.9,
        topK: options.topK ?? 40,
        repeatPenalty: { penalty: options.repeatPenalty ?? 1.1 },
      });

      const totalTimeMs = Date.now() - startTime;
      recordInferenceLatency(resolvedId, startTime); // TASK A: per-generation latency histogram
      const tokensPrompt = loaded.model.tokenize(prompt).length;
      const tokensGenerated = loaded.model.tokenize(response).length;

      return {
        text: response,
        tokensGenerated,
        tokensPrompt,
        totalTimeMs,
        tokensPerSecond: Number(((tokensGenerated / totalTimeMs) * 1000).toFixed(1)),
        modelId: resolvedId,
      };
    } finally {
      sequence.dispose();
      release();
    }
  }).finally(release); // I-1: bắt đường withGgufSlot TỪ CHỐI slot (fn không chạy) — idempotent
}

// ─── JSON-constrained generation (GBNF / JSON Schema) ─────────

/**
 * Generate a JSON object that conforms to a JSON Schema using node-llama-cpp
 * grammar-constrained decoding. Guarantees valid JSON output (no parse errors).
 *
 * Usage:
 *   const schema = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] } as const;
 *   const obj = await generateJSON<{ summary: string }>(schema, { prompt: "..." });
 */
export async function generateJSON<T = unknown>(
  jsonSchema: object,
  options: GgufGenerateOptions,
  modelId?: string,
): Promise<{ data: T; raw: string; tokensGenerated: number; tokensPrompt: number; totalTimeMs: number; tokensPerSecond: number; modelId: string; }> {
  // R5 — schema-constrained JSON via the PERSISTENT llama-server when configured
  // (own VRAM), keeping the in-process embedder free. OFF by default → in-process.
  // doc69 G2-6 — same preflight-then-generate fail-safe as generateText() above.
  {
    const srv = await import("./aiLlamaServerClient");
    if (srv.shouldUseServerForText(modelId)) {
      const healthy = await srv.preflightHealthy().catch(() => false);
      if (!healthy) {
        if (srv.llamaServerStrict()) {
          throw new Error("[aiGgufEngine] llama-server preflight health check failed (LLAMA_SERVER_STRICT=true)");
        }
        console.warn(
          "[aiGgufEngine] llama-server preflight health check failed — falling back in-process (server unreachable/unhealthy)",
        );
      } else {
        try {
          return await srv.serverGenerateJSON<T>(jsonSchema, options, modelId);
        } catch (e) {
          if (srv.llamaServerStrict()) throw e;
          console.warn(
            `[aiGgufEngine] llama-server JSON generation failed, falling back in-process: ${(e as Error)?.message || e}`,
          );
        }
      }
    }
  }

  const { modelId: resolvedId, loaded } = await getOrLoadModel(modelId, options.contextSize);
  // review toàn nhánh I-1 — nhả tham chiếu đúng MỘT lần cho lượt gọi này, kể cả khi withGgufSlot()
  // TỪ CHỐI slot (khi đó `fn` không chạy ⇒ `finally` bên trong nó cũng không chạy). Xem
  // makeOnceReleaser() và aiGgufEngine.refcountSlotReject.test.ts.
  const release = makeOnceReleaser(loaded);
  // Đợt 2 Task 3 — review round 1 Critical-1: lưới an toàn, xem ensureTextContext(). review
  // round 2 Important-mới — getOrLoadModel() đã refCount++; nếu ensureTextContext() ném (OOM
  // là lúc dễ ném nhất), release() TRƯỚC khi rethrow — thiếu bước này refCount kẹt >0
  // vĩnh viễn, evictLRU() bỏ qua model này mãi mãi.
  try {
    await ensureTextContext(resolvedId, loaded, options.contextSize);
  } catch (e) {
    release();
    throw e;
  }
  const startTime = Date.now();

  const llamaMod: any = await import("node-llama-cpp");
  const llama = loaded.llama;

  // Create JSON Schema grammar (GBNF) — constrains decoder output to valid JSON
  let grammar: any;
  try {
    if (typeof llama.createGrammarForJsonSchema === "function") {
      grammar = await llama.createGrammarForJsonSchema(jsonSchema);
    } else if (llamaMod.LlamaJsonSchemaGrammar) {
      grammar = new llamaMod.LlamaJsonSchemaGrammar(llama, jsonSchema);
    } else {
      throw new Error("JSON schema grammar API not available in node-llama-cpp");
    }
  } catch (err: any) {
    throw new Error(`Failed to build JSON schema grammar: ${err?.message || err}`);
  }

  const { LlamaChatSession } = llamaMod;

  let fullPrompt = options.prompt;
  if (options.systemPrompt) {
    fullPrompt = `${options.systemPrompt}\n\n${options.prompt}`;
  }
  // No "respond with JSON" suffix needed — grammar enforces it.

  // Mục 4: hold a GGUF concurrency slot across the whole inference block.
  return withGgufSlot(async () => {
    const sequence = loaded.context.getSequence();
    const session = new LlamaChatSession({ contextSequence: sequence });

    try {
      const response: string = await session.prompt(fullPrompt, {
        grammar,
        maxTokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.2,
        topP: options.topP ?? 0.9,
        topK: options.topK ?? 40,
        repeatPenalty: { penalty: options.repeatPenalty ?? 1.1 },
      });

      const totalTimeMs = Date.now() - startTime;
      recordInferenceLatency(resolvedId, startTime); // TASK A: per-generation latency histogram
      const tokensPrompt = loaded.model.tokenize(fullPrompt).length;
      const tokensGenerated = loaded.model.tokenize(response).length;

      let data: T;
      try {
        // Prefer grammar.parse if available (handles trailing whitespace, etc.)
        data = typeof grammar.parse === "function" ? grammar.parse(response) : JSON.parse(response);
      } catch (err: any) {
        throw new Error(`Grammar produced invalid JSON: ${err?.message || err}; raw=${response.slice(0, 200)}`);
      }

      return {
        data,
        raw: response,
        tokensGenerated,
        tokensPrompt,
        totalTimeMs,
        tokensPerSecond: totalTimeMs > 0 ? Number(((tokensGenerated / totalTimeMs) * 1000).toFixed(1)) : 0,
        modelId: resolvedId,
      };
    } finally {
      sequence.dispose();
      release();
    }
  }).finally(release); // I-1: bắt đường withGgufSlot TỪ CHỐI slot (fn không chạy) — idempotent
}

// ─── Doc 34 (P0) — Code / FIM model resolution + fill-in-middle ─
// doc69 G2-5b — both resolvers below now delegate to the shared modelResolver (see
// server/services/ai/modelResolver.ts's header for the full STEP 0 comparison of this file's
// previous inline copy vs. aiModelRouter.ts's vs. openaiGateway.ts's). Exported names/signatures
// are unchanged so existing callers (internal `generateFim` below, and any external importer)
// keep working exactly as before.

/**
 * Doc 34 (P0) — Resolve the CODE model basename (sans ".gguf") for the Automation Programming
 * Copilot. Reads GGUF_CODE_MODEL; when unset, falls back to GGUF_DEFAULT_MODEL (decision D2
 * §VI-bis: reuse the resident 30B-A3B-Instruct rather than downloading a separate coder model).
 * Returns an EXPLICIT basename — never undefined for a configured system — so callers pin the
 * intended model instead of reusing whatever is hot. Returns undefined ONLY when neither env is set.
 * Mirrors aiModelRouter.codeModelId(); exposed here for the OpenAI gateway / codegen callers.
 */
export function codeModelBasename(): string | undefined {
  return resolveCodeModelBasename();
}

/**
 * Doc 34 (P0) — Resolve the FIM (fill-in-middle / inline-completion) model basename. Reads
 * GGUF_FIM_MODEL; when unset, falls back to the fast model (GGUF_FAST_MODEL) and finally to
 * GGUF_DEFAULT_MODEL, so autocomplete degrades gracefully on a system with no dedicated small FIM
 * model. Never undefined for a configured system. Mirrors aiModelRouter.fimModelId().
 */
export function fimModelBasename(): string | undefined {
  return resolveFimModelBasename();
}

export interface GgufFimOptions {
  /** Code BEFORE the cursor (required for a meaningful completion). */
  prefix: string;
  /** Code AFTER the cursor (optional — enables true fill-in-middle context). */
  suffix?: string;
  /** Max tokens for the infill. Default 128 (autocomplete is short). */
  maxTokens?: number;
  /** Temperature. Default 0.1 (deterministic inline completion). */
  temperature?: number;
  topP?: number;
  topK?: number;
  /** Extra stop sequences appended to the FIM sentinels. */
  stopSequences?: string[];
  /** KV-cache sizing hint (n_ctx on first load). Small by default (see router `fim` tier). */
  contextSize?: number;
}

/**
 * Standard FIM sentinel strings for the Qwen2.5/3-Coder & StarCoder families. These are used only
 * as TEXT markers to shape the prompt for a coder model — genuine special-token infill decoding
 * (plus prefix-cache) is the job of the persistent llama-server coder gateway (doc 34 §3.3a / P0).
 */
const FIM_SENTINELS = {
  prefix: "<|fim_prefix|>",
  suffix: "<|fim_suffix|>",
  middle: "<|fim_middle|>",
} as const;
const FIM_STOP = ["<|endoftext|>", "<|fim_pad|>", "<|file_sep|>", "<|repo_name|>"];

/**
 * Best-effort signal that the resolved model supports fill-in-middle. Authoritative when the model
 * is already resident (node-llama-cpp exposes `model.tokens.infill.*` for FIM-capable GGUFs);
 * otherwise heuristic: trust FIM only when a DEDICATED GGUF_FIM_MODEL is configured. The reused
 * default instruct model (D2 fallback) is deliberately NOT treated as FIM-capable, so we do not
 * feed it raw sentinels it never trained on — we degrade to plain prefix completion instead.
 * Fully fail-safe: any error → false (→ prefix completion).
 */
function modelSupportsFim(modelId?: string): boolean {
  try {
    if (modelId && loadedModels.has(modelId)) {
      const infill = (loadedModels.get(modelId) as any)?.model?.tokens?.infill;
      return !!(infill && (infill.prefix != null || infill.middle != null || infill.suffix != null));
    }
  } catch {
    /* fall through to the config heuristic */
  }
  return !!(process.env.GGUF_FIM_MODEL || "").trim();
}

/**
 * Doc 34 (P0) — Best-effort fill-in-middle (inline autocomplete) using the resident coder/fast
 * model. High-quality FIM with native special-token infill + prefix-cache under a PERSISTENT
 * llama-server (doc 34 §3.3a / P0) is now wired below (doc69 Wave 4 C2) — gated OFF by default
 * (LLAMA_SERVER_ENABLED). When it's off/unhealthy/erroring, this falls through to the in-process
 * path exactly as before C2:
 *   • Prefer TRUE native infill via node-llama-cpp's `LlamaCompletion` (`generateFimNative`) — it
 *     feeds the raw prefix/suffix through the model's own FIM tokens (no chat template), so a
 *     coder model like Qwen2.5-Coder returns clean inline code instead of a chat reply.
 *   • Otherwise (or if that throws) `generateFimChatFallback`: if the resolved model advertises
 *     FIM tokens (or a dedicated GGUF_FIM_MODEL is configured) AND a suffix is given, assemble a
 *     Prefix–Suffix–Middle (PSM) template with the standard sentinels; else degrade to a plain
 *     PREFIX completion, passing the suffix as trailing context.
 * Reuses generateText() (via the chat fallback) so it inherits the GGUF concurrency slot, latency
 * telemetry and KV sizing. Never throws for a missing FIM model — falls back to the fast/default
 * model (or, under LLAMA_SERVER_STRICT, surfaces a server error instead of silently degrading).
 */
export async function generateFim(
  options: GgufFimOptions,
  modelId?: string,
): Promise<GgufGenerateResult> {
  const prefix = typeof options.prefix === "string" ? options.prefix : "";
  const suffix = typeof options.suffix === "string" ? options.suffix : "";
  // Resolve the model: explicit arg → FIM model → fast → default (fimModelBasename()).
  const effectiveId = modelId ?? fimModelBasename();

  // doc69 Wave 4 C2 — offload FIM to the PERSISTENT llama-server (prefix-cache, kept-loaded
  // coder model) when configured, mirroring generateText's server→in-process fallback EXACTLY
  // (preflight → generate → fall back in-process, or throw under LLAMA_SERVER_STRICT). OFF by
  // default (LLAMA_SERVER_ENABLED unset) → shouldUseServerForFim() returns false immediately and
  // this block is a no-op, so behavior is byte-identical to before C2 (see aiLlamaServerClient.ts
  // module header + docs/ECOSYSTEM/70_AI_PERSISTENT_LLAMA_SERVER_RUNBOOK_2026-07-26.md §10).
  {
    const srv = await import("./aiLlamaServerClient");
    if (srv.shouldUseServerForFim(effectiveId)) {
      const healthy = await srv.preflightHealthyForFim().catch(() => false);
      if (!healthy) {
        if (srv.llamaServerStrict()) {
          throw new Error("[aiGgufEngine] llama-server FIM preflight health check failed (LLAMA_SERVER_STRICT=true)");
        }
        console.warn(
          "[aiGgufEngine] llama-server FIM preflight health check failed — falling back in-process (server unreachable/unhealthy)",
        );
      } else {
        try {
          return await srv.generateFimViaServer(prefix, suffix, options);
        } catch (e) {
          if (srv.llamaServerStrict()) throw e;
          console.warn(
            `[aiGgufEngine] llama-server FIM generation failed, falling back in-process: ${(e as Error)?.message || e}`,
          );
        }
      }
    }
  }

  // Prefer TRUE native infill via node-llama-cpp's LlamaCompletion — it feeds the raw
  // prefix/suffix through the model's own FIM tokens (no chat template), so a coder model
  // like Qwen2.5-Coder returns clean inline code instead of a chat reply. Falls back to the
  // chat-wrapped path below if the binding/model doesn't support infill or anything throws.
  try {
    return await generateFimNative(prefix, suffix, options, effectiveId);
  } catch (e) {
    console.warn("[aiGgufEngine] native FIM unavailable, using chat-wrap fallback:", (e as Error)?.message ?? e);
    return generateFimChatFallback(prefix, suffix, options, effectiveId);
  }
}

/** True native fill-in-middle via LlamaCompletion.generateInfillCompletion (no chat template). */
async function generateFimNative(
  prefix: string,
  suffix: string,
  options: GgufFimOptions,
  effectiveId: string | undefined,
): Promise<GgufGenerateResult> {
  const { modelId: resolvedId, loaded } = await getOrLoadModel(effectiveId, options.contextSize);
  // review toàn nhánh I-1 — nhả tham chiếu đúng MỘT lần cho lượt gọi này, kể cả khi withGgufSlot()
  // TỪ CHỐI slot (khi đó `fn` không chạy ⇒ `finally` bên trong nó cũng không chạy). Xem
  // makeOnceReleaser() và aiGgufEngine.refcountSlotReject.test.ts.
  const release = makeOnceReleaser(loaded);
  // Đợt 2 Task 3 — review round 1 Critical-1: lưới an toàn, xem ensureTextContext(). review
  // round 2 Important-mới — getOrLoadModel() đã refCount++; nếu ensureTextContext() ném (OOM
  // là lúc dễ ném nhất), release() TRƯỚC khi rethrow — thiếu bước này refCount kẹt >0
  // vĩnh viễn, evictLRU() bỏ qua model này mãi mãi.
  try {
    await ensureTextContext(resolvedId, loaded, options.contextSize);
  } catch (e) {
    release();
    throw e;
  }
  const startTime = Date.now();
  const { LlamaCompletion } = await import("node-llama-cpp");
  const stops = [...(options.stopSequences ?? []), ...FIM_STOP].filter((s) => !!s);
  return withGgufSlot(async () => {
    const sequence = loaded.context.getSequence();
    const completion = new (LlamaCompletion as any)({ contextSequence: sequence });
    try {
      const genOpts: any = {
        maxTokens: options.maxTokens ?? 128,
        temperature: options.temperature ?? 0.1,
        topP: options.topP ?? 0.9,
        ...(options.topK != null ? { topK: options.topK } : {}),
        ...(stops.length ? { customStopTriggers: stops } : {}),
      };
      // Use real infill when we have a suffix AND the loaded model advertises infill support;
      // otherwise a plain raw completion of the prefix (still no chat template).
      const text: string =
        suffix && completion.infillSupported
          ? await completion.generateInfillCompletion(prefix, suffix, genOpts)
          : await completion.generateCompletion(prefix, genOpts);
      const totalTimeMs = Date.now() - startTime;
      recordInferenceLatency(resolvedId, startTime);
      const tokensGenerated = loaded.model.tokenize(text || "").length;
      const tokensPrompt = loaded.model.tokenize(prefix + suffix).length;
      const tokensPerSecond = totalTimeMs > 0 ? (tokensGenerated / totalTimeMs) * 1000 : 0;
      return {
        text: text || "",
        tokensGenerated,
        tokensPrompt,
        totalTimeMs,
        tokensPerSecond: Number(tokensPerSecond.toFixed(1)),
        modelId: resolvedId,
      };
    } finally {
      try { completion.dispose?.(); } catch { /* best-effort */ }
      sequence.dispose();
      release();
    }
  }).finally(release); // I-1: bắt đường withGgufSlot TỪ CHỐI slot (fn không chạy) — idempotent
}

/** Fallback: FIM-sentinel prompt (or prefix + suffix-as-context) routed through the chat path. */
async function generateFimChatFallback(
  prefix: string,
  suffix: string,
  options: GgufFimOptions,
  effectiveId: string | undefined,
): Promise<GgufGenerateResult> {
  const useFim = !!suffix && modelSupportsFim(effectiveId);
  const stop = [...(options.stopSequences ?? []), ...FIM_STOP].filter((s) => !!s);
  let systemPrompt: string | undefined;
  let prompt: string;
  if (useFim) {
    prompt = `${FIM_SENTINELS.prefix}${prefix}${FIM_SENTINELS.suffix}${suffix}${FIM_SENTINELS.middle}`;
  } else {
    systemPrompt = suffix
      ? "You are an inline code completion engine. Continue the code at the cursor so it fits the " +
        "code that FOLLOWS. Output ONLY the missing code, no explanation, no fences.\n\n" +
        `// ---- code after the cursor ----\n${suffix}`
      : "You are an inline code completion engine. Continue the code at the cursor. Output ONLY the " +
        "missing code, no explanation, no fences.";
    prompt = prefix;
  }
  return generateText(
    {
      systemPrompt,
      prompt,
      maxTokens: options.maxTokens ?? 128,
      temperature: options.temperature ?? 0.1,
      topP: options.topP ?? 0.9,
      topK: options.topK,
      stopSequences: stop.length ? stop : undefined,
      contextSize: options.contextSize,
    },
    effectiveId,
  );
}

// ─── Vision (LLaVA) ────────────────────────────────────────────

export interface LlavaModelConfig extends GgufModelConfig {
  /** Path to the multimodal projector file (mmproj-*.gguf) — required for vision */
  mmprojPath: string;
}

export interface DescribeImageOptions {
  /** Raw image bytes (PNG/JPEG/WebP) */
  image: Buffer;
  /** Text prompt to accompany the image */
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  language?: "en" | "vi";
}

/**
 * @deprecated WS-G2: node-llama-cpp 3.18.1 does NOT bind llama.cpp's multimodal (mtmd)
 * projector to JS — passing `mmproj` to loadModel is silently ignored, so in-process
 * vision is impossible on this version. Real vision now runs through the local
 * `llama-server` mtmd sidecar (see server/services/llamaVisionSidecar.ts).
 *
 * This function is retained as an export for backward compatibility but no longer
 * loads a multimodal model. It throws to prevent silently loading a vision model that
 * cannot actually see images. Use describeImage() (which routes to the sidecar) instead.
 */
export async function loadLlavaModel(_config: LlavaModelConfig): Promise<string> {
  throw new Error(
    "loadLlavaModel is deprecated: node-llama-cpp 3.18.1 has no multimodal binding. " +
      "Vision now runs via the local llama-server mtmd sidecar (llamaVisionSidecar.ts). " +
      "Call describeImage() / aiProviderRouter.describeImage() which auto-routes to the sidecar.",
  );
}

/**
 * Describe / analyze an image.
 *
 * WS-G2: in-process node-llama-cpp vision is not possible (no mtmd JS binding). When a
 * local llama-server mtmd sidecar is configured (LLAMA_SERVER_BIN + GGUF_VISION_MODEL +
 * GGUF_VISION_MMPROJ all present on disk), this delegates to it over localhost HTTP.
 * Otherwise it throws `VISION_NOT_AVAILABLE` — it NEVER fabricates a description.
 *
 * Return shape (GgufGenerateResult) and signature are unchanged for backward compat.
 */
export async function describeImage(
  options: DescribeImageOptions,
  _modelId?: string,
): Promise<GgufGenerateResult> {
  const { isVisionSidecarAvailable, describeImageViaSidecar } = await import("./llamaVisionSidecar");

  if (!isVisionSidecarAvailable()) {
    throw new Error(
      "VISION_NOT_AVAILABLE: no local vision sidecar configured. " +
        "Set LLAMA_SERVER_BIN, GGUF_VISION_MODEL and GGUF_VISION_MMPROJ (see docs/upgrade-2026/WS-G2-vision-local.md). " +
        "In-process node-llama-cpp vision is not supported on 3.18.1.",
    );
  }

  return describeImageViaSidecar({
    image: options.image,
    prompt: options.prompt,
    systemPrompt: options.systemPrompt,
    language: options.language,
    maxTokens: options.maxTokens,
    temperature: options.temperature,
  });
}

// ─── Specialized AOI Functions ─────────────────────────────────

/**
 * Count tokens accurately using the model's tokenizer
 */
export async function countTokens(text: string, modelId?: string): Promise<number> {
  // purpose "tokenize" — tokenizer only, no generation head involved (see ModelPurpose).
  const { loaded } = await getOrLoadModel(modelId, undefined, "tokenize");
  try {
    const tokens = loaded.model.tokenize(text);
    return tokens.length;
  } finally {
    releaseModel(loaded);
  }
}

/**
 * Streaming text generation — yields token-by-token via async generator
 */
export async function* generateTextStream(
  options: GgufGenerateOptions,
  modelId?: string,
  signal?: AbortSignal,
): AsyncGenerator<GgufStreamChunk> {
  const { modelId: resolvedId, loaded } = await getOrLoadModel(modelId, options.contextSize);
  // review toàn nhánh I-1 — nhả tham chiếu đúng MỘT lần cho lượt gọi này, kể cả khi withGgufSlot()
  // TỪ CHỐI slot (khi đó `fn` không chạy ⇒ `finally` bên trong nó cũng không chạy). Xem
  // makeOnceReleaser() và aiGgufEngine.refcountSlotReject.test.ts.
  const release = makeOnceReleaser(loaded);
  // Đợt 2 Task 3 — review round 1 Critical-1: lưới an toàn, xem ensureTextContext(). review
  // round 2 Important-mới — getOrLoadModel() đã refCount++; nếu ensureTextContext() ném (OOM
  // là lúc dễ ném nhất), release() TRƯỚC khi rethrow — thiếu bước này refCount kẹt >0
  // vĩnh viễn, evictLRU() bỏ qua model này mãi mãi.
  try {
    await ensureTextContext(resolvedId, loaded, options.contextSize);
  } catch (e) {
    release();
    throw e;
  }
  const startTime = Date.now();

  let fullPrompt = options.prompt;
  if (options.systemPrompt) {
    fullPrompt = `${options.systemPrompt}\n\n${options.prompt}`;
  }
  if (options.jsonMode) {
    fullPrompt += "\n\nRespond with valid JSON only. No markdown, no explanations.";
  }

  const { LlamaChatSession } = await import("node-llama-cpp");

  // Mục 4: hold ONE GGUF concurrency slot for the entire lifetime of this
  // generator. withGgufSlotGenerator acquires before the first yield and
  // releases in finally — covering normal completion, early consumer return()
  // (client abort) and throws, so the slot is never leaked.
  //
  // I-1: withGgufSlotGenerator acquire ở lần .next() đầu; nếu acquire BỊ TỪ CHỐI thì `makeGen`
  // KHÔNG bao giờ chạy ⇒ `finally` bên trong nó không chạy ⇒ refCount rò. Gán ra biến (gọi một
  // async generator function KHÔNG chạy thân hàm — thân chỉ chạy khi bắt đầu lặp) rồi bọc
  // `yield*` trong try/finally để nhả tham chiếu ở MỌI đường ra.
  const slotted = withGgufSlotGenerator<GgufStreamChunk>(async function* () {
    const sequence = loaded.context.getSequence();
    const session = new LlamaChatSession({ contextSequence: sequence });

    try {
      let fullText = "";
      const tokenQueue: string[] = [];
      let resolveWait: (() => void) | null = null;
      let isDone = false;

      const promptPromise = session.prompt(fullPrompt, {
        signal,
        maxTokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.7,
        topP: options.topP ?? 0.9,
        topK: options.topK ?? 40,
        repeatPenalty: { penalty: options.repeatPenalty ?? 1.1 },
        stopGenerationTrigger: options.stopSequences
          ? options.stopSequences.map(s => [{ type: "text" as const, text: s }])
          : undefined,
        onTextChunk(chunk: string) {
          fullText += chunk;
          tokenQueue.push(chunk);
          if (resolveWait) {
            resolveWait();
            resolveWait = null;
          }
        },
      } as any);

      // Drain tokens as they arrive
      while (!isDone) {
        if (tokenQueue.length > 0) {
          const token = tokenQueue.shift()!;
          yield { type: "token", token };
        } else {
          // Wait for next token or completion
          await Promise.race([
            promptPromise.then(() => { isDone = true; }),
            new Promise<void>(resolve => { resolveWait = resolve; }),
          ]);
        }
      }

      // Drain remaining tokens
      while (tokenQueue.length > 0) {
        yield { type: "token", token: tokenQueue.shift()! };
      }

      const response = await promptPromise;
      const totalTimeMs = Date.now() - startTime;
      recordInferenceLatency(resolvedId, startTime); // TASK A: per-generation latency histogram
      const tokensPrompt = loaded.model.tokenize(fullPrompt).length;
      const tokensGenerated = loaded.model.tokenize(response).length;

      yield {
        type: "done",
        fullText: response,
        tokensGenerated,
        tokensPrompt,
        totalTimeMs,
        tokensPerSecond: totalTimeMs > 0 ? Number(((tokensGenerated / totalTimeMs) * 1000).toFixed(1)) : 0,
        modelId: resolvedId,
      };
    } catch (err: any) {
      yield { type: "error", error: err.message || "Streaming generation failed" };
    } finally {
      sequence.dispose();
      release();
    }
  });
  try {
    yield* slotted;
  } finally {
    release(); // I-1: idempotent — no-op nếu thân generator đã chạy và nhả rồi
  }
}

/**
 * Streaming chat completion — yields token-by-token via async generator
 */
export async function* chatCompletionStream(
  options: GgufChatOptions,
  modelId?: string,
  signal?: AbortSignal,
): AsyncGenerator<GgufStreamChunk> {
  const { modelId: resolvedId, loaded } = await getOrLoadModel(modelId, options.contextSize);
  // review toàn nhánh I-1 — nhả tham chiếu đúng MỘT lần cho lượt gọi này, kể cả khi withGgufSlot()
  // TỪ CHỐI slot (khi đó `fn` không chạy ⇒ `finally` bên trong nó cũng không chạy). Xem
  // makeOnceReleaser() và aiGgufEngine.refcountSlotReject.test.ts.
  const release = makeOnceReleaser(loaded);
  // Đợt 2 Task 3 — review round 1 Critical-1: lưới an toàn, xem ensureTextContext(). review
  // round 2 Important-mới — getOrLoadModel() đã refCount++; nếu ensureTextContext() ném (OOM
  // là lúc dễ ném nhất), release() TRƯỚC khi rethrow — thiếu bước này refCount kẹt >0
  // vĩnh viễn, evictLRU() bỏ qua model này mãi mãi.
  try {
    await ensureTextContext(resolvedId, loaded, options.contextSize);
  } catch (e) {
    release();
    throw e;
  }
  const startTime = Date.now();

  const systemMsg = options.messages.find(m => m.role === "system");
  const userMessages = options.messages.filter(m => m.role !== "system");

  let prompt = "";
  if (systemMsg) {
    prompt += `System: ${systemMsg.content}\n\n`;
  }
  for (const msg of userMessages) {
    prompt += `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}\n`;
  }
  prompt += "Assistant: ";

  if (options.jsonMode) {
    prompt += "(Respond with valid JSON only)\n";
  }

  const { LlamaChatSession } = await import("node-llama-cpp");

  // Mục 4: hold ONE GGUF concurrency slot for the whole generator lifetime;
  // released in finally even on early consumer return() / abort / throw.
  // I-1: xem generateTextStream() ở trên — acquire bị từ chối thì thân generator không chạy.
  const slotted = withGgufSlotGenerator<GgufStreamChunk>(async function* () {
    const sequence = loaded.context.getSequence();
    const session = new LlamaChatSession({ contextSequence: sequence });

    try {
      let fullText = "";
      const tokenQueue: string[] = [];
      let resolveWait: (() => void) | null = null;
      let isDone = false;

      const promptPromise = session.prompt(prompt, {
        signal,
        maxTokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.7,
        topP: options.topP ?? 0.9,
        topK: options.topK ?? 40,
        repeatPenalty: { penalty: options.repeatPenalty ?? 1.1 },
        onTextChunk(chunk: string) {
          fullText += chunk;
          tokenQueue.push(chunk);
          if (resolveWait) {
            resolveWait();
            resolveWait = null;
          }
        },
      });

      while (!isDone) {
        if (tokenQueue.length > 0) {
          const token = tokenQueue.shift()!;
          yield { type: "token", token };
        } else {
          await Promise.race([
            promptPromise.then(() => { isDone = true; }),
            new Promise<void>(resolve => { resolveWait = resolve; }),
          ]);
        }
      }

      while (tokenQueue.length > 0) {
        yield { type: "token", token: tokenQueue.shift()! };
      }

      const response = await promptPromise;
      const totalTimeMs = Date.now() - startTime;
      recordInferenceLatency(resolvedId, startTime); // TASK A: per-generation latency histogram
      const tokensPrompt = loaded.model.tokenize(prompt).length;
      const tokensGenerated = loaded.model.tokenize(response).length;

      yield {
        type: "done",
        fullText: response,
        tokensGenerated,
        tokensPrompt,
        totalTimeMs,
        tokensPerSecond: totalTimeMs > 0 ? Number(((tokensGenerated / totalTimeMs) * 1000).toFixed(1)) : 0,
        modelId: resolvedId,
      };
    } catch (err: any) {
      yield { type: "error", error: err.message || "Streaming chat completion failed" };
    } finally {
      sequence.dispose();
      release();
    }
  });
  try {
    yield* slotted;
  } finally {
    release(); // I-1: idempotent — no-op nếu thân generator đã chạy và nhả rồi
  }
}

/**
 * Generate a defect analysis description in natural language
 */
export async function analyzeDefect(
  defectInfo: {
    productModel: string;
    measurementPoint: string;
    result: string;
    measuredValue?: number;
    confidence?: number;
    machineCode?: string;
  },
  modelId?: string,
  language: "en" | "vi" = "vi",
): Promise<string> {
  const systemPrompt = language === "vi"
    ? `Bạn là chuyên gia phân tích chất lượng của hệ thống SYNAPSE trong nhà máy dùng kiểm tra AOI/AVI. Phân tích ngắn gọn và chính xác về lỗi kiểm tra.`
    : `You are a quality analysis expert for the SYNAPSE system in a factory using AOI/AVI inspection. Provide concise and accurate defect analysis.`;

  const prompt = language === "vi"
    ? `Phân tích lỗi kiểm tra:
- Sản phẩm: ${defectInfo.productModel}
- Điểm đo: ${defectInfo.measurementPoint}
- Kết quả: ${defectInfo.result}
${defectInfo.measuredValue != null ? `- Giá trị đo: ${defectInfo.measuredValue}` : ""}
${defectInfo.confidence != null ? `- Độ tin cậy AI: ${(defectInfo.confidence * 100).toFixed(1)}%` : ""}
${defectInfo.machineCode ? `- Máy: ${defectInfo.machineCode}` : ""}

Đưa ra phân tích nguyên nhân có thể và đề xuất khắc phục.`
    : `Analyze inspection defect:
- Product: ${defectInfo.productModel}
- Measurement point: ${defectInfo.measurementPoint}
- Result: ${defectInfo.result}
${defectInfo.measuredValue != null ? `- Measured value: ${defectInfo.measuredValue}` : ""}
${defectInfo.confidence != null ? `- AI confidence: ${(defectInfo.confidence * 100).toFixed(1)}%` : ""}
${defectInfo.machineCode ? `- Machine: ${defectInfo.machineCode}` : ""}

Provide possible root cause analysis and remediation suggestions.`;

  const result = await generateText({ systemPrompt, prompt, maxTokens: 512, temperature: 0.3 }, modelId);
  return result.text;
}

/**
 * JSON Schema enforced (via GBNF grammar) for generateQualityInsights output.
 * Guarantees a stable, parseable shape regardless of the model.
 */
const QUALITY_INSIGHTS_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    trends: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "trends", "risks", "recommendations"],
} as const;

/**
 * Generate structured quality insights from inspection data as JSON
 */
export async function generateQualityInsights(
  data: {
    totalInspections: number;
    passRate: number;
    topDefects: Array<{ type: string; count: number; percentage: number }>;
    periodStart: string;
    periodEnd: string;
    machineCode?: string;
  },
  modelId?: string,
  language: "en" | "vi" = "vi",
): Promise<{
  summary: string;
  trends: string[];
  risks: string[];
  recommendations: string[];
}> {
  const systemPrompt = language === "vi"
    ? `Bạn là AI phân tích chất lượng sản xuất. Trả lời bằng JSON hợp lệ với cấu trúc: {"summary":"...","trends":["..."],"risks":["..."],"recommendations":["..."]}`
    : `You are a manufacturing quality AI analyst. Respond with valid JSON: {"summary":"...","trends":["..."],"risks":["..."],"recommendations":["..."]}`;

  const prompt = language === "vi"
    ? `Phân tích dữ liệu kiểm tra chất lượng:
- Khoảng thời gian: ${data.periodStart} đến ${data.periodEnd}
- Tổng kiểm tra: ${data.totalInspections}
- Tỷ lệ đạt: ${data.passRate.toFixed(1)}%
- Top lỗi: ${data.topDefects.map(d => `${d.type}: ${d.count} (${d.percentage.toFixed(1)}%)`).join(", ")}
${data.machineCode ? `- Máy: ${data.machineCode}` : ""}`
    : `Analyze quality inspection data:
- Period: ${data.periodStart} to ${data.periodEnd}
- Total inspections: ${data.totalInspections}
- Pass rate: ${data.passRate.toFixed(1)}%
- Top defects: ${data.topDefects.map(d => `${d.type}: ${d.count} (${d.percentage.toFixed(1)}%)`).join(", ")}
${data.machineCode ? `- Machine: ${data.machineCode}` : ""}`;

  try {
    const { data } = await generateJSON<{
      summary: string;
      trends: string[];
      risks: string[];
      recommendations: string[];
    }>(QUALITY_INSIGHTS_SCHEMA, {
      systemPrompt,
      prompt,
      maxTokens: 1024,
      temperature: 0.3,
    }, modelId);

    // Grammar guarantees the shape; normalize defensively in case fields are absent.
    return {
      summary: data?.summary ?? "",
      trends: Array.isArray(data?.trends) ? data.trends : [],
      risks: Array.isArray(data?.risks) ? data.risks : [],
      recommendations: Array.isArray(data?.recommendations) ? data.recommendations : [],
    };
  } catch (err: any) {
    // Safe bilingual fallback if the model/grammar is unavailable.
    console.warn("[aiGgufEngine] generateQualityInsights grammar generation failed, returning fallback:", err?.message ?? err);
    const fallbackSummary = language === "vi"
      ? `Phân tích ${data.totalInspections} lượt kiểm tra (tỷ lệ đạt ${data.passRate.toFixed(1)}%) từ ${data.periodStart} đến ${data.periodEnd}. Không tạo được phân tích chi tiết bằng AI.`
      : `Analyzed ${data.totalInspections} inspections (pass rate ${data.passRate.toFixed(1)}%) from ${data.periodStart} to ${data.periodEnd}. Detailed AI insights unavailable.`;
    return {
      summary: fallbackSummary,
      trends: [],
      risks: [],
      recommendations: [],
    };
  }
}

// ─── Model Management ──────────────────────────────────────────

/**
 * List all available GGUF models (found in models directory and loaded models)
 */
export function listGgufModels(): GgufModelInfo[] {
  ensureModelsDir();

  const files = fs.readdirSync(GGUF_MODELS_DIR).filter(f => f.endsWith(".gguf"));
  const models: GgufModelInfo[] = files.map(filename => {
    const filePath = path.join(GGUF_MODELS_DIR, filename);
    const stats = fs.statSync(filePath);
    const modelId = filename.replace(".gguf", "");
    return {
      id: modelId,
      filename,
      filePath,
      fileSize: stats.size,
      fileSizeHuman: formatBytes(stats.size),
      lastModified: stats.mtime,
      loaded: loadedModels.has(modelId),
    };
  });

  return models;
}

/**
 * Get status of loaded models
 */
export function getLoadedGgufModels(): Array<{
  modelId: string;
  loadedAt: Date;
  lastUsedAt: Date;
  useCount: number;
  sizeBytes: number;
  sizeHuman: string;
  refCount: number;
  hasEmbeddingContext: boolean;
  config: GgufModelConfig;
}> {
  return Array.from(loadedModels.entries()).map(([id, m]) => ({
    modelId: id,
    loadedAt: m.loadedAt,
    lastUsedAt: m.lastUsedAt,
    useCount: m.useCount,
    sizeBytes: m.sizeBytes,
    sizeHuman: formatBytes(m.sizeBytes),
    refCount: m.refCount,
    hasEmbeddingContext: !!m.embeddingContext,
    config: m.config,
  }));
}

/**
 * Check if GGUF engine is available (node-llama-cpp installed)
 */
export async function isGgufAvailable(): Promise<boolean> {
  try {
    await import("node-llama-cpp");
    return true;
  } catch {
    return false;
  }
}

/**
 * Get loaded models with memory-safe name extraction
 */
export function getLoadedGgufModelNames(): string[] {
  return Array.from(loadedModels.keys());
}

/**
 * Health check including engine info, GPU status, and model count
 */
export async function getEngineHealth(): Promise<{
  operational: boolean;
  engineReady: boolean;
  modelsLoaded: number;
  modelsAvailable: number;
  maxLoadedModels: number;
  totalLoadedBytes: number;
  totalLoadedHuman: string;
  vram: { total: number; used: number; free: number; unifiedSize: number } | null;
  vramCapMb: number;
  gpuMode: string;
  modelsDir: string;
  queue: { running: number; queued: number; max: number };
  /** doc69 G2-6 — thinking-tier HONESTY: surfaces whether AI_THINKING_TIER_ENABLED is
   *  actually active (flag + GGUF_THINKING_MODEL + file all line up) so operators aren't
   *  misled by a flag that silently falls back to the default deep model. */
  thinkingTier: { enabled: boolean; modelConfigured: boolean; fileExists: boolean; active: boolean; reason: string };
  /** doc69 G2-6 — persistent llama-server status. `healthy` is only probed (network) when
   *  `enabled` is true, so this stays a zero-cost no-op for everyone with the default OFF. */
  llamaServer: { enabled: boolean; strict: boolean; healthy: boolean | null };
}> {
  const engineReady = !!llamaInstance;
  ensureModelsDir();
  const available = fs.readdirSync(GGUF_MODELS_DIR).filter(f => f.endsWith(".gguf")).length;

  const totalLoadedBytes = Array.from(loadedModels.values()).reduce((s, m) => s + (m.sizeBytes || 0), 0);

  // Best-effort VRAM snapshot — may fail on CPU / unified memory.
  let vram: { total: number; used: number; free: number; unifiedSize: number } | null = null;
  if (llamaInstance) {
    try {
      vram = await llamaInstance.getVramState();
    } catch {
      vram = null;
    }
  }

  // Dynamic imports: avoid a static circular import (aiModelRouter imports this module for
  // ggufModelFileExists) and keep this health check cheap when llama-server is off (no network).
  const { getThinkingTierStatus } = await import("./aiModelRouter");
  const thinkingTier = getThinkingTierStatus();

  const srv = await import("./aiLlamaServerClient");
  const llamaServerEnabled = srv.llamaServerEnabled();
  const llamaServer = {
    enabled: llamaServerEnabled,
    strict: srv.llamaServerStrict(),
    healthy: llamaServerEnabled ? await srv.llamaServerHealthy().catch(() => false) : null,
  };

  return {
    operational: engineReady && loadedModels.size > 0,
    engineReady,
    modelsLoaded: loadedModels.size,
    modelsAvailable: available,
    maxLoadedModels: GGUF_MAX_LOADED_MODELS,
    totalLoadedBytes,
    totalLoadedHuman: formatBytes(totalLoadedBytes),
    vram,
    vramCapMb: GGUF_MAX_VRAM_MB,
    gpuMode: process.env.GGUF_GPU === "false" ? "cpu" : "auto (CUDA/Vulkan)",
    modelsDir: GGUF_MODELS_DIR,
    queue: getGgufQueueStats(),
    thinkingTier,
    llamaServer,
  };
}

// ─── Embedding Generation ──────────────────────────────────────

/**
 * Generate text embeddings using a loaded GGUF model.
 * Useful for similarity search and RAG.
 */
export async function generateEmbedding(
  text: string,
  modelId?: string,
): Promise<{ embedding: number[]; dimensions: number; modelId: string }> {
  // When no modelId is given, prefer the dedicated embedding model (mxbai) so we never
  // fall back to the text model (Qwen), which would yield wrong-dimension vectors.
  // FIX (doc69 W1-4 review) — resolved via the shared, suffix-safe embedModelBasename(), not a
  // raw env read (see the module-level comment above for the ".gguf.gguf" bug this closes).
  const effectiveId = modelId ?? resolveEmbedModelBasename();
  // purpose "embed" — the embedding model is the CORRECT answer here; the text-generation guard
  // must not apply (doc69 W1 modelfix, see ModelPurpose).
  const { modelId: resolvedId, loaded } = await getOrLoadModel(effectiveId, undefined, "embed");
  // review toàn nhánh I-1 — nhả tham chiếu đúng MỘT lần, kể cả khi withGgufSlot() TỪ CHỐI slot
  // (fn không chạy ⇒ finally bên trong không chạy). Xem makeOnceReleaser().
  const release = makeOnceReleaser(loaded);

  // Mục 4: embeddings are light but still share the single GGUF slot to keep the
  // 6GB VRAM budget simple and safe.
  try {
    return await withGgufSlot(async () => {
      try {
        const embeddingContext = await getEmbeddingContext(resolvedId, loaded);
        const embedding = await embeddingContext.getEmbeddingFor(text);
        const vector = Array.from(embedding.vector as readonly number[]);
        assertEmbeddingDim(vector.length, resolvedId);
        return {
          embedding: vector,
          dimensions: vector.length,
          modelId: resolvedId,
        };
      } finally {
        release();
      }
    });
  } finally {
    release();
  }
}

/**
 * Generate embeddings for multiple texts in batch.
 */
export async function generateEmbeddings(
  texts: string[],
  modelId?: string,
): Promise<{ embeddings: number[][]; dimensions: number; modelId: string }> {
  // FIX (doc69 W1-4 review) — see generateEmbedding() above: resolved via the shared,
  // suffix-safe embedModelBasename(), not a raw env read.
  const effectiveId = modelId ?? resolveEmbedModelBasename();
  // purpose "embed" — see generateEmbedding() above.
  const { modelId: resolvedId, loaded } = await getOrLoadModel(effectiveId, undefined, "embed");
  // review toàn nhánh I-1 — xem generateEmbedding() ở trên.
  const release = makeOnceReleaser(loaded);

  // Mục 4: batch embeddings hold the single GGUF slot for the whole loop.
  try {
    return await withGgufSlot(async () => {
      try {
        const embeddingContext = await getEmbeddingContext(resolvedId, loaded);
        const embeddings: number[][] = [];
        let dims = 0;
        for (const text of texts) {
          const result = await embeddingContext.getEmbeddingFor(text);
          const vec = Array.from(result.vector as readonly number[]);
          assertEmbeddingDim(vec.length, resolvedId);
          embeddings.push(vec);
          if (!dims) dims = vec.length;
        }
        return { embeddings, dimensions: dims, modelId: resolvedId };
      } finally {
        release();
      }
    });
  } finally {
    release();
  }
}

/** Đợt 2 Task 3 — khoá in-flight cho getEmbeddingContext(), CÙNG KHUÔN với inFlightLoads của
 *  loadGgufModel() (Đợt 1 Task 1, ~163): nhiều lượt generateEmbedding()/generateEmbeddings()
 *  đồng thời trên CÙNG modelId đều thấy loaded.embeddingContext còn rỗng (chưa kịp ghi — dòng
 *  cache chỉ chạy SAU khi await createEmbeddingContext() xong) và cùng gọi
 *  model.createEmbeddingContext() song song. Đo: 4 lượt tuần tự = 654 MiB; đồng thời = 2.430
 *  MiB (+1.776 MiB, đỉnh nhất thời vài giây, không rò vĩnh viễn). Tới được thật vì
 *  GGUF_MAX_CONCURRENCY=4 (.env) và 6 nơi gọi generateEmbedding(s) do HTTP điều khiển. */
const embeddingContextInFlight = new Map<string, Promise<any>>();

/**
 * Lazily create (and cache on the LoadedModel) an embedding context for the given model.
 * Uses model.createEmbeddingContext (the public API in node-llama-cpp 3.18.1 — the
 * LlamaEmbeddingContext constructor is private). The context is created once and reused;
 * it is disposed when the model is unloaded.
 */
async function getEmbeddingContext(modelId: string, loaded: LoadedModel): Promise<any> {
  if (loaded.embeddingContext) return loaded.embeddingContext;

  // Đợt 2 Task 3 — nếu modelId này đang được tạo embedding context bởi một lượt gọi khác
  // (xem giải thích ở khai báo embeddingContextInFlight), CHỜ lượt đó thay vì tạo song song.
  const pending = embeddingContextInFlight.get(modelId);
  if (pending) return pending;

  const createPromise = (async () => {
    // Pha 1 Task 5 — CHỈ KHAI BÁO. Cùng lý do đã ghi ở ensureTextContext(): không có file
    // trên đĩa để suy ra kích thước, và CỐ Ý không bịa `configDefaultBytes` — đo rồi học.
    // Mức `background`: đường nhúng phục vụ RAG, nhường chỗ cho suy luận và cho AOI.
    const vramTicket = await beginVram({
      owner: `gguf-embed-ctx:${modelId}`,
      kind: "gguf-embed-context",
      priority: "background",
    });
    try {
      const ctx = await loaded.model.createEmbeddingContext({
        contextSize: EMBED_CTX,
        batchSize: loaded.config.batchSize ?? 512,
      });
      await vramTicket.commitMeasured();
      loaded.embedCtxVramTicket = vramTicket;
      loaded.embeddingContext = ctx;
      return ctx;
    } catch (err: any) {
      releaseVramTicketQuietly(vramTicket);
      /**
       * ★★ I-1 (review vòng 1) — ĐƯỜNG NÀY KHÔNG CHỈ IM LẶNG, NÓ CÒN **NÓI SAI NGUYÊN NHÂN**.
       * Câu `"Model does not support embeddings"` gửi người trực đi đổi `GGUF_EMBED_MODEL` trong
       * khi sự thật có thể là hết VRAM — đúng lớp "chỉ người trực đi sai hướng" mà cả pha này
       * sinh ra để diệt. Nay: sự kiện luôn có, và câu chữ ĐỔI THEO phán quyết.
       */
      const verdict = await noteContextFailure(
        `gguf-embed-ctx:${modelId}`, "gguf-embed-context", "background",
        "getEmbeddingContext.createEmbeddingContext", err, { contextSize: EMBED_CTX },
      );
      if (verdict?.exhausted) {
        /**
         * ⚠ N-3 (re-review) — CÂU NÀY TỪNG NÓI *"OUT OF VRAM"* CHO MỌI PHÁN QUYẾT, KỂ CẢ KHI TÍN
         * HIỆU LÀ **RAM HỆ THỐNG** (`…too large for the available ram`) hoặc **không rõ**
         * (`Failed to create context` — native nuốt nguyên nhân). Người trực đọc "VRAM" rồi chạy
         * `nvidia-smi`, thấy 30 GB trống, kết luận "sổ nói láo" — đúng lớp *chỉ người trực đi sai
         * hướng* mà cả pha này sinh ra để diệt, chỉ đổi trục. Câu chữ nay đi theo `verdict.scope`,
         * và `"unknown"` được NÓI RA là không biết thay vì đoán bừa một thiết bị.
         */
        const cai =
          verdict.scope === "device-vram" ? "VRAM (bộ nhớ GPU)"
          : verdict.scope === "host-ram" ? "RAM HỆ THỐNG (KHÔNG phải VRAM — đừng đi kiểm GPU)"
          : "BỘ NHỚ, nhưng KHÔNG XÁC ĐỊNH ĐƯỢC là VRAM hay RAM hệ thống (llama.cpp nuốt nguyên nhân) — kiểm CẢ HAI";
        throw new Error(
          `createEmbeddingContext failed: out of memory (scope=${verdict.scope}, signal=${verdict.signal}; ` +
            `${err?.message ?? err}). This is NOT a model-capability problem — do not change GGUF_EMBED_MODEL. ` +
            `[VI] Không tạo được embedding context vì HẾT ${cai} — KHÔNG phải do model thiếu khả năng ` +
            `nhúng, đừng đổi GGUF_EMBED_MODEL.`,
        );
      }
      throw new Error(
        `Model does not support embeddings (createEmbeddingContext failed: ${err?.message ?? err}). ` +
          `Set GGUF_EMBED_MODEL to point to an embedding model such as mxbai-embed-large. ` +
          `[VI] Mô hình không hỗ trợ embedding — cấu hình GGUF_EMBED_MODEL trỏ tới mxbai.`,
      );
    }
  })();

  embeddingContextInFlight.set(modelId, createPromise);
  try {
    return await createPromise;
  } finally {
    // Bắt buộc: lượt tạo thất bại mà không xoá khỏi map thì mọi lượt sau sẽ nhận lại đúng
    // promise lỗi đó vĩnh viễn (không bao giờ thử tạo lại) — cùng lý do Đợt 1 Task 1 đã ghi
    // ở inFlightLoads.
    embeddingContextInFlight.delete(modelId);
  }
}

/**
 * Validate the produced embedding dimension against the configured GGUF_EMBED_DIM.
 * A mismatch almost always means the wrong (text) model was used for embeddings.
 */
function assertEmbeddingDim(dim: number, resolvedId: string): void {
  if (dim !== GGUF_EMBED_DIM) {
    throw new Error(
      `Embedding dimension mismatch: model "${resolvedId}" returned ${dim}, expected ${GGUF_EMBED_DIM}. ` +
        `Set GGUF_EMBED_MODEL to a model with ${GGUF_EMBED_DIM}-dim output (e.g. mxbai-embed-large) ` +
        `or adjust GGUF_EMBED_DIM. ` +
        `[VI] Sai số chiều embedding (${dim}≠${GGUF_EMBED_DIM}) — cấu hình GGUF_EMBED_MODEL trỏ tới mxbai.`,
    );
  }
}

// ─── Thinking / reasoning model output handling (B6.2) ─────────

/**
 * B6.2 — Strip a "Thinking" model's chain-of-thought block from its final answer.
 *
 * Qwen3-*-Thinking models emit their reasoning inside `<think>...</think>` before the
 * user-facing answer. We must NEVER leak that raw reasoning into the product UI, so the
 * caller passes generated text through this helper to separate the two parts.
 *
 * Behaviour:
 *  - Removes every `<think>…</think>` pair (case-insensitive, multi-line, multiple blocks).
 *  - Tolerates an UNCLOSED `<think>` (output truncated by maxTokens): everything from the
 *    opening tag to end-of-string is treated as reasoning and dropped.
 *  - Tolerates a stray leading `</think>` with no opening tag (some chat templates pre-open
 *    the think block) by dropping everything up to and including that first `</think>`.
 *  - Fail-safe: any unexpected input returns the original text rather than throwing, and if
 *    stripping would leave an EMPTY answer we keep the original (better a noisy answer than none).
 *
 * Returns both the cleaned `answer` and the extracted `thinking` (joined, for optional
 * audit/telemetry) so a caller can log reasoning separately without exposing it.
 */
export function stripThinking(text: string): { answer: string; thinking: string } {
  if (typeof text !== "string" || text.length === 0) {
    return { answer: text ?? "", thinking: "" };
  }
  try {
    const thoughts: string[] = [];

    // 1) Stray leading "</think>" without a matching "<think>" → everything before it is reasoning.
    let work = text;
    const firstOpen = work.search(/<think>/i);
    const firstClose = work.search(/<\/think>/i);
    if (firstClose !== -1 && (firstOpen === -1 || firstClose < firstOpen)) {
      thoughts.push(work.slice(0, firstClose));
      work = work.slice(firstClose + "</think>".length);
    }

    // 2) Remove all well-formed <think>…</think> pairs.
    work = work.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, inner) => {
      thoughts.push(String(inner));
      return "";
    });

    // 3) Unclosed trailing <think> (truncated by maxTokens) → drop to end.
    const danglingOpen = work.search(/<think>/i);
    if (danglingOpen !== -1) {
      thoughts.push(work.slice(danglingOpen + "<think>".length));
      work = work.slice(0, danglingOpen);
    }

    const answer = work.trim();
    const thinking = thoughts.join("\n").trim();
    // Fail-safe: never return an empty answer if the original had content.
    if (!answer && text.trim()) {
      return { answer: text.trim(), thinking };
    }
    return { answer, thinking };
  } catch {
    // Never let reasoning-stripping break a generation result.
    return { answer: text, thinking: "" };
  }
}

// ─── Utilities ─────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
