import * as ort from "onnxruntime-node";
import sharp from "sharp";
// ★★★ Pha 2B Task 5 — vị từ "lỗi này có phải LỜI TỪ CHỐI không". Import TĨNH của một module
// LÁ (không import gì, không I/O): nó phải dùng được NGAY TRONG `catch` của một lượt
// `await import()` vừa hỏng. Xem `vramRefusalSignal.ts` để biết vì sao so TÊN, không `instanceof`.
import { isVramRefusal } from "./vram/vramRefusalSignal";
import path from "path";
import fs from "fs";
import { getAiModelById } from "../db/ai";
import { createInferenceResult } from "../db/ai";
import type { AiModel } from "../../drizzle/schema";
import { MicroBatcher, Semaphore, type BatchOutcome } from "./ai/microBatcher";
// W5-B2 (doc 44 G4.16) — vision-inference-p95 SLO budget observation. Pure helper
// (no ONNX/DB imports); recordVisionInferenceLatency is a NO-OP unless
// VISION_SLO_OBSERVE_ENABLED, so this import is bit-compatible when the flag is off.
import { recordVisionInferenceLatency } from "./ai/visionInferenceSlo";
// Pha 1 Task 5 (điều phối VRAM) — `import type` bị xoá hoàn toàn lúc biên dịch; module telemetry
// chỉ được nạp bằng `import()` động tại đúng điểm cấp phát, không nằm trên đường nạp file này.
import type { VramTicket } from "./vram/vramWiring";
import { sessionCacheMax } from "./vram/vramCaps";

/**
 * Pha 1 Task 5 — mở MỘT giấy phép VRAM quanh một lượt cấp phát. KHÔNG BAO GIỜ ném.
 * ⚠ Session ONNX phục vụ ĐƯỜNG KIỂM TRA AOI — tiền của nhà máy (spec §5.2) — nên giấy phép
 * ở đây mang mức `production`, cao hơn cả chat/RCA (`interactive`) lẫn RAG (`background`).
 */
async function beginVram(
  opts: import("./vram/vramWiring").VramAllocationOptions,
): Promise<VramTicket> {
  try {
    const { beginVramAllocation } = await import("./vram/vramWiring");
    return await beginVramAllocation(opts);
  } catch (err) {
    // ★★★ Pha 2B Task 5 — TỪ CHỐI ≠ TELEMETRY HỎNG: nuốt ở đây là TẮT cưỡng chế tại điểm gọi này.
    if (isVramRefusal(err)) throw err;
    return { commitMeasured: async () => {}, release: () => {}, noteRefCount: () => {} };
  }
}

/**
 * Pha 1 Task 5 — giấy phép VRAM theo cacheKey của session. Phải TRẢ khi session rời cache
 * (LRU đẩy ra hoặc `evictSessionCache()`), nếu không sổ giữ chỗ cho một session không còn tồn
 * tại và `vramReconciler` báo lệch ÂM giả.
 */
const sessionVramTickets = new Map<string, VramTicket>();

function releaseSessionVramTicket(key: string): void {
  try {
    const t = sessionVramTickets.get(key);
    if (!t) return;
    sessionVramTickets.delete(key);
    t.release();
  } catch {
    /* telemetry KHÔNG được làm hỏng vòng đời cache */
  }
}

// ─── W7-D (doc 27 gap V6) — GPU micro-batching + concurrency knobs ───────────
//   AI_SESSION_CACHE_MAX  LRU ONNX session cache size (default 5; 8 documented-OK
//                         on RTX 5090 32GB — see models/README.md).
//   AI_BATCH_MAX          max images coalesced into ONE [N,C,H,W] session.run
//                         (default 8; 1 disables micro-batching).
//   AI_BATCH_WINDOW_MS    collection window before a partial batch flushes (25ms).
//   AI_GPU_CONCURRENCY    max concurrent session.run calls across ALL models (2).
function envInt(name: string, def: number, min: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= min ? Math.floor(v) : def;
}
/**
 * ⚠⚠ I-5 (review TOÀN NHÁNH Pha 2A) — **TRẦN CACHE LÀ 5, KHÔNG PHẢI VÔ HẠN**, và đó là ĐIỀU KIỆN
 * CHƯA ĐƯỢC NÓI RA của kết luận "phiên ONNX được cache nên chi phí đo chấp nhận được".
 *
 * Từ Pha 2A, mỗi lượt tạo phiên mở một CỬA SỔ ĐO có giá **~3,35 s** (2 × ~1,5 s đầu dò
 * `powershell.exe` + 250 ms biên lắng — `vram/vramProcessProbe.ts`), và các cửa sổ `self`
 * **NỐI TIẾP NHAU** (`vram/vramMeasureLock.ts`). Ba điều kiện làm chi phí đó rơi vào một request
 * `production` chứ không rơi vào lúc khởi động:
 *   1. **`AI_SESSION_CACHE_MAX` mặc định 5** (`.env` để dòng này bị chú thích ⇒ chạy mặc định).
 *      Quá 5 model AOI hoạt động ⇒ đuổi LRU ⇒ lượt kiểm kế tiếp trượt cache ⇒ vào lại TRỌN VẸN
 *      cửa sổ ~3,35 s, **bên trong một request `production`**.
 *   2. **`getSession()` KHÔNG có khoá in-flight** (xem `:245-251`): hai request đồng thời cùng một
 *      model chưa cache mở **HAI** cửa sổ, rồi hai cửa sổ đó **nối tiếp nhau** ⇒ **2 × 3,35 s**
 *      cho cùng một model.
 *   3. `cacheKey` gồm `currentVersion` (`:190`) ⇒ mọi lượt `activateVersion`/`promoteStage`/
 *      auto-rollback đổi khoá ⇒ lượt nạp CÓ ĐO bị hoãn sang **request kiểm tra đầu tiên sau khi
 *      deploy**, không rơi vào lượt deploy.
 * Để so sánh: khởi động nguội mở **4 cửa sổ nối tiếp ≈ 13,4 s** chi phí đo thuần
 * (`cuda-backend` · `gguf:<30B>` · `gguf:<0,6B embed>` · `gguf-embed-ctx`).
 *
 * ⚠ Nâng `AI_SESSION_CACHE_MAX` để né lớp (1) là đổi lượng VRAM thường trú — quyết định của Pha 2B,
 * không phải một nút vặn cho tiện. Xem thêm đảo ngược ưu tiên (I-3) ở `vram/vramWiring.ts`: lượt
 * kiểm `production` này xếp hàng vào khoá đo theo FIFO, KHÔNG theo ưu tiên.
 */
/**
 * ★ Pha 2B Task 7 (§8) — **KHÔNG CÒN ĐỌC `process.env` Ở ĐÂY.** `AI_SESSION_CACHE_MAX` có MỘT
 * người đọc duy nhất (`vram/vramCaps.ts`) vì nó nay là trần của **hai** kho phiên ONNX: kho này
 * và `ai/ocrService.recSessionCache` (trước Task 7 kho đó **không có trần nào**).
 * ⚠ Gọi hàm ở ĐIỂM DÙNG chứ không chụp vào một `const` mức module: xem `vramCaps.ts` — hơn hai
 * chục bộ test đặt biến này trong `beforeEach`.
 */
function sessionCacheMaxHienTai(): number {
  return sessionCacheMax();
}
const BATCH_MAX = envInt("AI_BATCH_MAX", 8, 1);
const BATCH_WINDOW_MS = envInt("AI_BATCH_WINDOW_MS", 25, 0);
const GPU_CONCURRENCY = envInt("AI_GPU_CONCURRENCY", 2, 1);

/**
 * Shared per-GPU semaphore around EVERY session.run in this module (and the
 * embedding path in aiImageEmbedding). Unbounded concurrent session.run only
 * thrashes VRAM/scheduler — onnxruntime already parallelises intra-op.
 */
export const gpuSessionSemaphore = new Semaphore(GPU_CONCURRENCY);
class LruSessionCache {
  private map = new Map<string, ort.InferenceSession>();

  get(key: string): ort.InferenceSession | undefined {
    if (!this.map.has(key)) return undefined;
    // Move to end (most-recently used)
    const session = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, session);
    return session;
  }

  set(key: string, session: ort.InferenceSession): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, session);
    if (this.map.size > sessionCacheMaxHienTai()) {
      // Evict the oldest (first) entry
      // Pha 1 Task 5 — giữ lại key trước khi xoá để TRẢ giấy phép VRAM tương ứng.
      // Ngữ nghĩa y hệt dòng cũ `this.map.delete(this.map.keys().next().value!)`.
      //
      // ⚠ I-1 (review TOÀN NHÁNH) — ĐÂY LÀ MỘT LƯỢT NHẢ **KHÔNG CÓ BẰNG CHỨNG**, và nó được
      // đánh dấu tường minh như vậy (`releaseProof: "unverified"` ở `getSession()`), KHÔNG được
      // im lặng coi như đã nhả thật. Đuổi khỏi cache chỉ gỡ THAM CHIẾU JS; bộ nhớ native của
      // onnxruntime chỉ chắc chắn trả khi `session.release()` chạy — mà **không một session CÓ
      // KHẢ NĂNG GPU nào trong repo được `release()`**.
      //
      // ⚠⚠ I-2 (review TOÀN NHÁNH) — CÂU NÀY TRƯỚC ĐÂY VIẾT "toàn repo KHÔNG có một lời gọi nào
      // như vậy", RỘNG HƠN SỰ THẬT: `server/services/aiLocalTraining.ts` có NĂM lời gọi
      // `session.release()` (`:332`, `:504`, `:765`, `:889`, `:954`). Kết luận KHÔNG đổi — bốn
      // session của file đó ghim `executionProviders: ["cpu"]` nên chúng không chiếm VRAM — nhưng
      // một câu SAI dùng làm chỗ dựa vẫn là lập luận hỏng, và đính chính không được nằm ở file khác.
      //
      // Không thêm ở đây được: `getSession()` không có khoá in-flight
      // (:245-251) và `gpuSessionSemaphore` cho phép 2 lượt `session.run` song song ⇒ nhả native
      // dưới chân một lượt run đang bay là ABORT ở tầng native, không phải exception bắt được.
      // Sửa đúng cần đếm tham chiếu = ĐỔI HÀNH VI đường suy luận nóng nhất ⇒ báo cáo §10, Pha 2.
      // Kỷ luật đầy đủ + bảng bốn điểm nhả: đầu `vram/vramWiring.ts`.
      const evictedKey = this.map.keys().next().value!;
      this.map.delete(evictedKey);
      releaseSessionVramTicket(evictedKey);
    }
  }

  delete(key: string): void { this.map.delete(key); releaseSessionVramTicket(key); }
  keys(): IterableIterator<string> { return this.map.keys(); }
  [Symbol.iterator](): IterableIterator<[string, ort.InferenceSession]> { return this.map[Symbol.iterator](); }
  get size(): number { return this.map.size; }
}
const sessionCache = new LruSessionCache();

/**
 * Detect available ONNX execution providers based on environment and hardware.
 *
 * Order of resolution:
 *   1. AI_INFER_EP (explicit override, comma list) wins — e.g. "dml" | "cuda" | "tensorrt" | "cpu".
 *   2. Else legacy flags: ENABLE_TENSORRT, ENABLE_CUDA.
 *   3. ENABLE_GPU=true → DirectML ("dml") — GPU on Windows via DirectX 12, KHÔNG cần CUDA Toolkit
 *      (onnxruntime-node bundles the DML EP on Windows x64; CUDA EP is NOT bundled).
 *   4. CPU is always the final fallback.
 */
function getExecutionProviders(): string[] {
  const providers: string[] = [];
  const known = ["tensorrt", "cuda", "dml", "cpu"];
  const explicit = (process.env.AI_INFER_EP || "").toLowerCase().trim();

  if (explicit) {
    for (const p of explicit.split(/[,\s]+/).filter(Boolean)) {
      if (known.includes(p) && !providers.includes(p)) providers.push(p);
    }
  } else {
    if (process.env.ENABLE_TENSORRT === "true") providers.push("tensorrt");
    if (process.env.ENABLE_CUDA === "true") providers.push("cuda");
    // DirectML: bật GPU trên Windows + Node mà không cần CUDA/cuDNN.
    if (process.env.ENABLE_GPU === "true") providers.push("dml");
  }

  // CPU is always the final fallback.
  if (!providers.includes("cpu")) providers.push("cpu");
  return providers;
}

/** Log once which providers are configured */
let _providerLogged = false;
function logProviders(providers: string[]) {
  if (_providerLogged) return;
  _providerLogged = true;
  console.log(`[aiInferenceEngine] Execution providers: ${providers.join(" → ")}`);
}

/**
 * Get or create an ONNX inference session for a model
 */
async function getSession(model: AiModel): Promise<ort.InferenceSession> {
  const cacheKey = `${model.id}:${model.currentVersion}`;
  const cached = sessionCache.get(cacheKey);
  if (cached) return cached;

  if (!model.filePath) throw new Error(`Model ${model.code} has no file path`);

  // Resolve file path — handle both local paths and URLs
  let modelPath = model.filePath;
  if (modelPath.startsWith("/uploads/")) {
    const uploadsRoot = process.env.LOCAL_STORAGE_DIR
      ? path.resolve(process.env.LOCAL_STORAGE_DIR)
      : path.join(process.cwd(), "uploads");
    modelPath = path.join(uploadsRoot, modelPath.replace("/uploads/", ""));
  }

  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model file not found: ${modelPath}`);
  }

  const executionProviders = getExecutionProviders();
  logProviders(executionProviders);

  // Pha 1 Task 5 — CHỈ KHAI BÁO, không quyết định gì: không có hàng rào nào ở đây bị đổi.
  const vramTicket = await beginVram({
    owner: `onnx:${model.code}`,
    kind: "onnx-session",
    priority: "production",
    filePath: modelPath,
    // I-1 — lượt nhả của hộ này KHÔNG chứng minh được thiết bị đã nhả (đuổi LRU chỉ gỡ tham
    // chiếu JS; `ort.InferenceSession.release()` không được gọi ở đâu trong repo). Đánh dấu để
    // truy vấn được thay vì phải đọc comment mà tin — xem bảng bốn điểm nhả ở `vramWiring.ts`.
    releaseProof: "unverified",
  });

  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders,
    graphOptimizationLevel: "all",
    // ⚠ `.catch()` chứ không bọc try/catch, để dòng `create(...)` ở trên đứng NGUYÊN VĂN như
    // trước — Task 5 phải chứng minh bằng diff rằng đường cấp phát không bị sửa. Nhánh này chỉ
    // trả chỗ rồi ném lại NGUYÊN lỗi cũ.
  }).catch((err: unknown) => {
    vramTicket.release();
    throw err;
  });

  // Số THẬT = VRAM tăng thêm do session này. Với EP là CPU thì đúng bằng 0 — và 0 LÀ số liệu
  // thật, được ghi để sổ không phình lên theo kích thước file .onnx (xem vramWiring.ts).
  await vramTicket.commitMeasured();
  // ⚠ `getSession()` KHÔNG có khoá in-flight: hai lượt cùng cacheKey chạy song song đều trượt
  // cache và cùng tạo session (hành vi CÓ SẴN, không thuộc phạm vi Task 5). Trả giấy phép cũ
  // trước khi ghi đè, nếu không cái cũ treo vĩnh viễn trong sổ và sinh báo động lệch ÂM giả.
  //
  // ⚠⚠ I-5 (review TOÀN NHÁNH) — TỪ PHA 2A, "KHÔNG có khoá in-flight" KHÔNG CÒN chỉ là lãng phí
  // một lượt tạo phiên: hai lượt song song mở HAI cửa sổ đo, và hai cửa sổ `self` **nối tiếp
  // nhau** ⇒ **2 × ~3,35 s** chồng lên một request `production`. Xem khối số đo đầy đủ ở
  // `SESSION_CACHE_MAX`. Thêm khoá in-flight ở đây là ĐỔI HÀNH VI đường suy luận — Pha 2B.
  //
  // ⚠ Dòng `releaseSessionVramTicket()` ngay dưới, và lượt đuổi LRU trong `sessionCache.set()`,
  // đều là ĐIỂM NHẢ: từ bản vá C-1 (review TOÀN NHÁNH) chúng ghi vào mọi cửa sổ đo CÙNG PHẠM VI
  // đang mở, khiến phép đo của người đang đo khai `measureFailed` thay vì commit một delta HỤT.
  // Đó là hành vi ĐÚNG và KHÔNG chặn gì cả — xem `vram/vramWiring.ts`, khối `OpenMeasureWindow`.
  releaseSessionVramTicket(cacheKey);
  sessionVramTickets.set(cacheKey, vramTicket);

  sessionCache.set(cacheKey, session);
  return session;
}

/**
 * Evict a model session from cache (e.g. when model is updated).
 * Also drops the model's micro-batcher + no-batch marker so a new version
 * re-negotiates batchability from scratch.
 */
export function evictSessionCache(modelId: number) {
  for (const [key] of sessionCache) {
    if (key.startsWith(`${modelId}:`)) {
      sessionCache.delete(key);
    }
  }
  for (const key of Array.from(batchers.keys())) {
    if (key.startsWith(`${modelId}:`)) batchers.delete(key);
  }
  for (const key of Array.from(noBatchModels)) {
    if (key.startsWith(`${modelId}:`)) noBatchModels.delete(key);
  }
}

// ─── W7-D (gap V6) — micro-batching internals ────────────────────────────────

interface RunOutput {
  data: Float32Array;
  dims: number[];
}

/** Models whose graph rejected/garbled a stacked [N>1,…] input → permanently N=1. */
const noBatchModels = new Set<string>();
/** One MicroBatcher per model cacheKey (modelId:currentVersion). */
const batchers = new Map<string, MicroBatcher<Float32Array, RunOutput>>();

/**
 * Batch eligibility:
 *  – BATCH_MAX 1 disables coalescing outright.
 *  – DETECTION STAYS N=1 (documented decision): YOLO-style outputs
 *    ([N,boxes,attrs] — sometimes flattened 2-D, box count possibly
 *    data-dependent with dynamic shapes) are not reliably splittable per image,
 *    and parseDetectionOutput + NMS are per-image anyway.
 *  – Only canonical [1,C,H,W] inputs can be stacked along dim 0.
 */
function canMicroBatch(model: AiModel, inputShape: number[], outputType: string): boolean {
  if (BATCH_MAX <= 1) return false;
  if (outputType === "detection") return false;
  if (inputShape.length !== 4 || inputShape[0] !== 1) return false;
  return !noBatchModels.has(`${model.id}:${model.currentVersion}`);
}

/** One session.run with the given dims (N=1 or stacked). GPU-semaphore guarded. */
async function runSessionOnce(model: AiModel, data: Float32Array, dims: number[]): Promise<RunOutput> {
  const session = await getSession(model);
  const inputName = session.inputNames[0];
  if (!inputName) throw new Error("Model has no input names");
  const outputName = session.outputNames[0];
  if (!outputName) throw new Error("Model has no output names");
  const results = await gpuSessionSemaphore.run(() =>
    session.run({ [inputName]: new ort.Tensor("float32", data, dims) }),
  );
  const output = results[outputName];
  if (!output) throw new Error("No output from model");
  return { data: output.data as Float32Array, dims: output.dims as number[] };
}

/**
 * Execute one flush of the micro-batcher: stack N preprocessed [1,C,H,W]
 * tensors into ONE [N,C,H,W] session.run, then split the output along dim 0.
 * Per-item error isolation: if the stacked run fails (e.g. static batch=1
 * graph) the model is remembered as no-batch and every item re-runs
 * individually — a failing item rejects only its own promise.
 */
async function runStackedBatch(
  key: string,
  model: AiModel,
  inputShape: number[],
  inputs: Float32Array[],
): Promise<Array<BatchOutcome<RunOutput>>> {
  const N = inputs.length;
  const per = inputs[0]?.length ?? 0;
  const uniform = per > 0 && inputs.every((t) => t.length === per);

  if (N > 1 && uniform && !noBatchModels.has(key)) {
    try {
      const stacked = new Float32Array(N * per);
      for (let i = 0; i < N; i++) stacked.set(inputs[i], i * per);
      const out = await runSessionOnce(model, stacked, [N, ...inputShape.slice(1)]);
      if (out.dims[0] === N && out.data.length % N === 0) {
        const stride = out.data.length / N;
        const itemDims = [1, ...out.dims.slice(1)];
        return inputs.map((_, i) => ({
          status: "fulfilled" as const,
          value: { data: out.data.slice(i * stride, (i + 1) * stride), dims: itemDims },
        }));
      }
      // Output does not lead with the batch axis — cannot split safely.
      noBatchModels.add(key);
      console.warn(
        `[aiInferenceEngine] model ${model.code}: batched output dims ${JSON.stringify(out.dims)} ` +
          `do not lead with N=${N} — marked no-batch, running per-item`,
      );
    } catch (err) {
      noBatchModels.add(key);
      console.warn(
        `[aiInferenceEngine] model ${model.code}: stacked session.run failed ` +
          `(${err instanceof Error ? err.message : String(err)}) — marked no-batch, running per-item`,
      );
    }
  }

  // Per-item path (fallback + N=1): isolate errors per item.
  const outcomes: Array<BatchOutcome<RunOutput>> = [];
  for (const input of inputs) {
    try {
      outcomes.push({
        status: "fulfilled",
        value: await runSessionOnce(model, input, [1, ...inputShape.slice(1)]),
      });
    } catch (err) {
      outcomes.push({ status: "rejected", reason: err });
    }
  }
  return outcomes;
}

function getBatcher(model: AiModel, inputShape: number[]): MicroBatcher<Float32Array, RunOutput> {
  const key = `${model.id}:${model.currentVersion}`;
  let batcher = batchers.get(key);
  if (!batcher) {
    batcher = new MicroBatcher<Float32Array, RunOutput>({
      batchMax: BATCH_MAX,
      windowMs: BATCH_WINDOW_MS,
      runBatch: (inputs) => runStackedBatch(key, model, inputShape, inputs),
    });
    batchers.set(key, batcher);
  }
  return batcher;
}

/**
 * Model execution entry for runInference: classification goes through the
 * per-model micro-batcher (coalesced [N,C,H,W]); detection and non-stackable
 * shapes run N=1 — all under the shared GPU semaphore.
 */
async function runModelForInference(
  model: AiModel,
  tensorData: Float32Array,
  inputShape: number[],
  outputType: string,
): Promise<RunOutput> {
  if (canMicroBatch(model, inputShape, outputType)) {
    return getBatcher(model, inputShape).enqueue(tensorData);
  }
  return runSessionOnce(model, tensorData, inputShape);
}

/** Telemetry snapshot for health/tests (V6). */
export function getMicroBatchStats() {
  return {
    batchMax: BATCH_MAX,
    batchWindowMs: BATCH_WINDOW_MS,
    gpuConcurrency: GPU_CONCURRENCY,
    sessionCacheMax: sessionCacheMaxHienTai(),
    activeBatchers: batchers.size,
    noBatchModels: Array.from(noBatchModels),
    gpuRunning: gpuSessionSemaphore.running,
    gpuWaiting: gpuSessionSemaphore.waiting,
  };
}

/**
 * Preprocess image buffer according to model config
 */
async function preprocessImage(
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
  const channelFirst = config.channelFirst !== false; // default true

  const totalPixels = width * height;
  const tensor = new Float32Array(channels * totalPixels);

  for (let c = 0; c < channels; c++) {
    for (let i = 0; i < totalPixels; i++) {
      const rawIndex = i * channels + c;
      const pixelValue = raw[rawIndex] / 255.0;
      const normalized = (pixelValue - (mean[c] ?? 0)) / (std[c] ?? 1);

      if (channelFirst) {
        tensor[c * totalPixels + i] = normalized;
      } else {
        tensor[i * channels + c] = normalized;
      }
    }
  }

  return tensor;
}

/**
 * Run inference on an image using a specific model
 */
export async function runInference(
  modelId: number,
  imageBuffer: Buffer,
  options?: {
    inspectionId?: number;
    measurementResultId?: number;
    inputReference?: string;
  },
) {
  const startTime = Date.now();
  const model = await getAiModelById(modelId);
  if (!model) throw new Error(`Model ${modelId} not found`);
  if (model.status !== "ACTIVE") throw new Error(`Model ${model.code} is not active (status: ${model.status})`);

  // ── AOI-C — flag-gated embedding-head dispatch (doc 24 Wave-3) ──────────────
  // When the ACTIVE model is a first-party embedding-head classifier and
  // AOI_DL_HEAD_ENABLED is on, serve it via the head path (image → DINOv2 embedding
  // → logreg head) instead of ONNX. EVERY caller of runInference (quality gate,
  // ensemble, A/B canary, active-learning auto-label) inherits this transparently.
  // The env-flag gate keeps the hot ONNX path free of the head import when off.
  const headFlag = String(process.env.AOI_DL_HEAD_ENABLED ?? "false").toLowerCase();
  if (headFlag === "true" || headFlag === "1") {
    const { isEmbeddingHeadModel, runEmbeddingHeadInference } = await import("./ai/embeddingHead");
    if (isEmbeddingHeadModel(model)) {
      const r = await runEmbeddingHeadInference(model, imageBuffer, options);
      return {
        modelCode: r.modelCode,
        modelVersion: r.modelVersion,
        predictions: r.predictions,
        topLabel: r.topLabel,
        confidence: r.confidence,
        processingTimeMs: r.processingTimeMs,
        status: "COMPLETED" as const,
      };
    }
  }

  try {
    // Preprocess
    const preprocessConfig = (model.preprocessConfig as AiModel["preprocessConfig"]) ?? {
      resize: { width: 224, height: 224 },
      colorSpace: "RGB" as const,
      channelFirst: true,
    };
    const tensorData = await preprocessImage(imageBuffer, preprocessConfig);

    // Build input shape
    const inputShape = (model.inputShape as number[]) ?? [1, 3, preprocessConfig.resize?.height ?? 224, preprocessConfig.resize?.width ?? 224];

    // Parse predictions based on output type
    const labels = (model.labels as string[]) ?? [];
    const postprocess = (model.postprocessConfig as AiModel["postprocessConfig"]);
    const confidenceThreshold = postprocess?.confidenceThreshold ?? 0.1;
    const topK = postprocess?.topK ?? 5;
    const outputType: string = (postprocess as any)?.outputType ?? "classification";

    // W7-D (gap V6): classification is coalesced by the per-model micro-batcher
    // (up to AI_BATCH_MAX images / AI_BATCH_WINDOW_MS into ONE [N,C,H,W]
    // session.run, output split per item); detection stays N=1. Both paths run
    // under the shared AI_GPU_CONCURRENCY semaphore. Public API unchanged.
    const output = await runModelForInference(model, tensorData, inputShape, outputType);
    const outputData = output.data;

    let predictions: Array<{ label: string; confidence: number; box?: { x: number; y: number; w: number; h: number } }>;

    if (outputType === "detection") {
      // YOLO-style detection: output shape [1, num_boxes, 5+num_classes]
      // Each row: [cx, cy, w, h, obj_conf, class_conf_0, ..., class_conf_n]
      predictions = parseDetectionOutput(outputData, output.dims, labels, confidenceThreshold);
    } else {
      // Classification: apply temperature scaling then softmax
      // T > 1 softens overconfident logits; T < 1 sharpens (T=1 is identity)
      const temperature: number = postprocess?.temperatureScale ?? 1.0;
      const scaledLogits = temperature !== 1.0
        ? (outputData.map(v => v / temperature) as Float32Array)
        : outputData;
      const probabilities = softmax(scaledLogits);
      const allPredictions = Array.from(probabilities).map((conf, idx) => ({
        label: labels[idx] ?? `class_${idx}`,
        confidence: Number(conf.toFixed(6)),
      }));
      allPredictions.sort((a, b) => b.confidence - a.confidence);
      predictions = allPredictions
        .filter(p => p.confidence >= confidenceThreshold)
        .slice(0, topK);
    }

    const topPrediction = predictions[0];
    const processingTimeMs = Date.now() - startTime;

    // W5-B2 (doc 44 G4.16) — feed the vision-inference-p95 SLO from THIS (ONNX)
    // path only. Observe-only (never blocks); no-op unless VISION_SLO_OBSERVE_ENABLED.
    recordVisionInferenceLatency(processingTimeMs);

    // Save result (fire-and-forget)
    createInferenceResult({
      modelId: model.id,
      modelVersion: model.currentVersion,
      inspectionId: options?.inspectionId,
      measurementResultId: options?.measurementResultId,
      inputType: "image",
      inputReference: options?.inputReference,
      predictions,
      confidence: topPrediction?.confidence?.toString(),
      topLabel: topPrediction?.label,
      processingTimeMs,
      status: "COMPLETED",
    }).catch(() => {});

    return {
      modelCode: model.code,
      modelVersion: model.currentVersion,
      predictions,
      topLabel: topPrediction?.label ?? null,
      confidence: topPrediction?.confidence ?? 0,
      processingTimeMs,
      status: "COMPLETED" as const,
    };
  } catch (err: unknown) {
    const processingTimeMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);

    createInferenceResult({
      modelId: model.id,
      modelVersion: model.currentVersion,
      inspectionId: options?.inspectionId,
      measurementResultId: options?.measurementResultId,
      inputType: "image",
      predictions: [],
      status: "FAILED",
      errorMessage,
      processingTimeMs,
    }).catch(() => {});

    throw err;
  }
}

// ─── B5 — Inference with feature map (for XAI CAM / Score-CAM) ────────────────

export interface FeatureMapTensor {
  /** Tên output trong ONNX graph. */
  name: string;
  /** Dữ liệu phẳng (channel-first NCHW giả định: [1,C,H,W] hoặc [C,H,W]). */
  data: Float32Array;
  /** dims gốc từ ONNX. */
  dims: number[];
}

export interface InferenceWithFeatureMap {
  modelCode: string;
  /** Logits/probabilities thô của output phân loại (chưa softmax nếu là logits). */
  logits: Float32Array;
  logitsDims: number[];
  labels: string[];
  /** Feature map cuối cùng nếu model expose (regex feature|conv|map); null nếu không. */
  featureMap: FeatureMapTensor | null;
  inputName: string;
  inputShape: number[];
}

/** Regex phát hiện output là feature map (conv/feature/map). */
const FEATURE_MAP_RX = /feature|conv|map|stage|backbone/i;

/**
 * B5 — Chạy inference lấy CẢ feature map (nếu có) + logits. KHÔNG đổi runInference cũ;
 * KHÔNG ghi createInferenceResult (đây là đường XAI, không phải inference sản xuất).
 *
 * Phát hiện feature map qua session.outputNames: ưu tiên output 4-D ([N,C,H,W]) có tên
 * khớp FEATURE_MAP_RX; logits chọn output còn lại (ưu tiên 2-D hoặc output cuối).
 * Trả featureMap=null nếu không tìm được → caller (aiExplainability) degrade sang occlusion.
 */
export async function runInferenceWithFeatureMap(
  modelId: number,
  imageBuffer: Buffer,
): Promise<InferenceWithFeatureMap> {
  const model = await getAiModelById(modelId);
  if (!model) throw new Error(`Model ${modelId} not found`);
  if (model.status !== "ACTIVE") throw new Error(`Model ${model.code} is not active (status: ${model.status})`);

  const session = await getSession(model);

  const preprocessConfig = (model.preprocessConfig as AiModel["preprocessConfig"]) ?? {
    resize: { width: 224, height: 224 },
    colorSpace: "RGB" as const,
    channelFirst: true,
  };
  const tensorData = await preprocessImage(imageBuffer, preprocessConfig);

  const inputShape = (model.inputShape as number[]) ??
    [1, 3, preprocessConfig.resize?.height ?? 224, preprocessConfig.resize?.width ?? 224];
  const inputTensor = new ort.Tensor("float32", tensorData, inputShape);

  const inputName = session.inputNames[0];
  if (!inputName) throw new Error("Model has no input names");

  // V6: XAI path stays N=1 (needs the full multi-output graph) but shares the
  // GPU concurrency semaphore with the production inference path.
  const results = await gpuSessionSemaphore.run(() => session.run({ [inputName]: inputTensor }));

  // ── Tách feature map vs logits ─────────────────────────────────────────────
  let featureMap: FeatureMapTensor | null = null;
  let logitsName: string | null = null;

  // Ưu tiên: output 4-D tên khớp regex → feature map.
  for (const name of session.outputNames) {
    const out = results[name];
    if (!out) continue;
    const dims = out.dims as number[];
    if (dims.length === 4 && FEATURE_MAP_RX.test(name)) {
      featureMap = { name, data: out.data as Float32Array, dims };
      break;
    }
  }
  // Nếu chưa có, chấp nhận BẤT KỲ output 4-D nào làm feature map (nhiều backbone không
  // đặt tên gợi ý) — nhưng chỉ khi có >1 output (output còn lại là logits).
  if (!featureMap && session.outputNames.length > 1) {
    for (const name of session.outputNames) {
      const out = results[name];
      if (out && (out.dims as number[]).length === 4) {
        featureMap = { name, data: out.data as Float32Array, dims: out.dims as number[] };
        break;
      }
    }
  }

  // logits = output 2-D đầu tiên (hoặc 1-D), khác feature map; fallback output cuối.
  for (const name of session.outputNames) {
    if (featureMap && name === featureMap.name) continue;
    const out = results[name];
    if (!out) continue;
    const dims = out.dims as number[];
    if (dims.length <= 2) { logitsName = name; break; }
  }
  if (!logitsName) {
    logitsName = session.outputNames.find((n) => !featureMap || n !== featureMap.name)
      ?? session.outputNames[session.outputNames.length - 1];
  }

  const logitsOut = logitsName ? results[logitsName] : undefined;
  if (!logitsOut) throw new Error("No logits output from model");

  return {
    modelCode: model.code,
    logits: logitsOut.data as Float32Array,
    logitsDims: logitsOut.dims as number[],
    labels: (model.labels as string[]) ?? [],
    featureMap,
    inputName,
    inputShape,
  };
}

// ─── B7 — Segmentation inference ──────────────────────────────────────────────

export interface SegmentationMask {
  label: string;
  classIndex: number;
  confidence: number;
  polygon: Array<{ x: number; y: number }>;
  bbox: { x: number; y: number; w: number; h: number };
  pixelCount: number;
}

export interface SegmentationResult {
  modelCode: string;
  modelVersion: string | null;
  outputType: "semantic-argmax" | "binary-sigmoid" | "yolo-seg";
  /** Kích thước lưới mask (theo output model). */
  maskWidth: number;
  maskHeight: number;
  masks: SegmentationMask[];
  processingTimeMs: number;
  status: "COMPLETED";
  /**
   * X5: true khi kết quả đến từ nhánh YOLOv8-seg. Nhánh này (decodeYoloSeg +
   * metrology) mới chỉ smoke-test bằng tensor giả, CHƯA validate trên .onnx
   * thật (xem RUNBOOK §6). Số đo metrology có thể sai — caller/UI nên hiển thị
   * cảnh báo và KHÔNG dùng cho quyết định đo lường chính thức.
   */
  experimental?: boolean;
  /** Ghi chú trung thực kèm theo khi experimental=true. */
  experimentalNote?: string;
}

/** Lỗi degrade trung thực khi model không phải segmentation / không tồn tại. */
export class SegmentationUnavailableError extends Error {
  code: "MODEL_NOT_AVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "SegmentationUnavailableError";
    this.code = "MODEL_NOT_AVAILABLE";
  }
}

/**
 * B7 — Chạy model segmentation, decode mask theo lớp. KHÔNG đổi runInference cũ.
 *
 * Degrade trung thực: nếu model không tồn tại / không ACTIVE / postprocess.type !=
 * "segmentation" → ném SegmentationUnavailableError (code MODEL_NOT_AVAILABLE) để
 * router trả lỗi rõ ràng thay vì crash. Decode tách trong aiSegmentation (pure).
 *
 * Trả mask trong KHÔNG GIAN LƯỚI OUTPUT của model (H×W); caller scale về ảnh gốc.
 */
export async function runSegmentation(
  modelId: number,
  imageBuffer: Buffer,
): Promise<SegmentationResult> {
  const startTime = Date.now();
  const model = await getAiModelById(modelId);
  if (!model) throw new SegmentationUnavailableError(`Model ${modelId} not found`);
  if (model.status !== "ACTIVE") {
    throw new SegmentationUnavailableError(`Model ${model.code} is not active (status: ${model.status})`);
  }
  const postprocess = model.postprocessConfig as AiModel["postprocessConfig"];
  const outputType: string = (postprocess as { type?: string } | null)?.type ?? "classification";
  if (outputType !== "segmentation") {
    throw new SegmentationUnavailableError(
      `Model ${model.code} is not a segmentation model (postprocessConfig.type=${outputType})`,
    );
  }

  // import động để tránh nạp aiSegmentation vào nhánh classification/detection nóng.
  const { decodeSegmentation, decodeYoloSeg } = await import("./aiSegmentation");

  const session = await getSession(model);
  const preprocessConfig = (model.preprocessConfig as AiModel["preprocessConfig"]) ?? {
    resize: { width: 224, height: 224 },
    colorSpace: "RGB" as const,
    channelFirst: true,
  };
  const tensorData = await preprocessImage(imageBuffer, preprocessConfig);
  const inputShape = (model.inputShape as number[]) ??
    [1, 3, preprocessConfig.resize?.height ?? 224, preprocessConfig.resize?.width ?? 224];
  const inputTensor = new ort.Tensor("float32", tensorData, inputShape);

  const inputName = session.inputNames[0];
  if (!inputName) throw new Error("Model has no input names");
  // V6: segmentation stays N=1 (multi-output YOLO-seg / semantic graphs are not
  // split-safe) but shares the GPU concurrency semaphore.
  const results = await gpuSessionSemaphore.run(() => session.run({ [inputName]: inputTensor }));

  const outputName = session.outputNames[0];
  if (!outputName) throw new Error("Model has no output names");
  const output = results[outputName];
  if (!output) throw new Error("No output from segmentation model");

  // ── YOLOv8-seg: 2 output (det [1,4+nc+32,N] + proto [1,32,mh,mw]). ──
  // Nhận diện: có >=2 output VÀ output0 là 3-D, output1 là 4-D với 32 kênh.
  // Cho phép postprocessConfig.format === "yolo-seg" ép buộc rõ ràng.
  const segFormat = (postprocess as { format?: string } | null)?.format;
  const out0Dims = output.dims as number[];
  const secondName = session.outputNames[1];
  const second = secondName ? results[secondName] : undefined;
  const isYoloSeg =
    segFormat === "yolo-seg" ||
    (second !== undefined && out0Dims.length === 3 &&
      (second.dims as number[]).length === 4 && (second.dims as number[])[1] === 32);

  if (isYoloSeg && second) {
    const imgSize = preprocessConfig.resize?.width ?? inputShape[3] ?? 224;
    const yolo = decodeYoloSeg(
      output.data as Float32Array,
      out0Dims,
      second.data as Float32Array,
      second.dims as number[],
      imgSize,
      {
        labels: (model.labels as string[]) ?? [],
        scoreThreshold: postprocess?.confidenceThreshold ?? 0.25,
      },
    );
    return {
      modelCode: model.code,
      modelVersion: model.currentVersion,
      outputType: yolo.outputType,
      maskWidth: yolo.maskWidth,
      maskHeight: yolo.maskHeight,
      masks: yolo.masks.map((m) => ({
        label: m.label,
        classIndex: m.classIndex,
        confidence: m.confidence,
        polygon: m.polygon,
        bbox: m.bbox,
        pixelCount: m.pixelCount,
      })),
      processingTimeMs: Date.now() - startTime,
      status: "COMPLETED",
      // X5: nhánh YOLO-seg chưa validate model .onnx thật → đánh dấu experimental.
      experimental: true,
      experimentalNote:
        "YOLOv8-seg decode + metrology chưa được validate trên model .onnx thật " +
        "(mới smoke-test tensor giả, RUNBOOK §6). Số đo có thể sai — chỉ tham khảo.",
    };
  }

  const dims = output.dims as number[];
  const { masks, outputType: decodedType } = decodeSegmentation(
    output.data as Float32Array,
    dims,
    {
      labels: (model.labels as string[]) ?? [],
      threshold: postprocess?.confidenceThreshold ?? 0.5,
    },
  );

  const H = dims.length === 4 ? dims[2] : dims[1];
  const W = dims.length === 4 ? dims[3] : dims[2];

  return {
    modelCode: model.code,
    modelVersion: model.currentVersion,
    outputType: decodedType,
    maskWidth: W,
    maskHeight: H,
    masks: masks.map((m) => ({
      label: m.label,
      classIndex: m.classIndex,
      confidence: m.confidence,
      polygon: m.polygon,
      bbox: m.bbox,
      pixelCount: m.pixelCount,
    })),
    processingTimeMs: Date.now() - startTime,
    status: "COMPLETED",
  };
}

/** B5 — softmax export cho aiExplainability (tái dùng logic nội bộ). */
export function softmaxArray(data: Float32Array | number[]): number[] {
  const arr = Array.from(data);
  const maxVal = Math.max(...arr);
  const exp = arr.map((v) => Math.exp(v - maxVal));
  const sum = exp.reduce((a, b) => a + b, 0) || 1;
  return exp.map((v) => v / sum);
}

/**
 * Parse YOLO-style detection output into bounding boxes with labels.
 * Expected tensor shape: [batch, num_boxes, 5+num_classes]
 * Each box row: [cx, cy, w, h, objectness, class_conf_0, ..., class_conf_n]
 * Coordinates are normalised [0, 1] relative to image size.
 */
function parseDetectionOutput(
  data: Float32Array,
  dims: number[],
  labels: string[],
  threshold: number,
): Array<{ label: string; confidence: number; box: { x: number; y: number; w: number; h: number } }> {
  // Support [batch, boxes, attrs] or flattened [boxes, attrs]
  let numBoxes: number;
  let numAttrs: number;
  if (dims.length === 3) {
    numBoxes = dims[1];
    numAttrs = dims[2];
  } else if (dims.length === 2) {
    numBoxes = dims[0];
    numAttrs = dims[1];
  } else {
    return [];
  }

  const numClasses = Math.max(0, numAttrs - 5);
  const candidates: Array<{ label: string; confidence: number; box: { x: number; y: number; w: number; h: number } }> = [];

  for (let b = 0; b < numBoxes; b++) {
    const offset = b * numAttrs;
    const cx   = data[offset];
    const cy   = data[offset + 1];
    const w    = data[offset + 2];
    const h    = data[offset + 3];
    const objConf = data[offset + 4];

    if (objConf < threshold) continue;

    let bestClass = 0;
    let bestConf  = 0;
    if (numClasses > 0) {
      for (let c = 0; c < numClasses; c++) {
        const conf = objConf * data[offset + 5 + c];
        if (conf > bestConf) { bestConf = conf; bestClass = c; }
      }
    } else {
      bestConf = objConf;
    }

    if (bestConf < threshold) continue;

    candidates.push({
      label: labels[bestClass] ?? `class_${bestClass}`,
      confidence: Number(bestConf.toFixed(6)),
      box: {
        x: Number((cx - w / 2).toFixed(4)),
        y: Number((cy - h / 2).toFixed(4)),
        w: Number(w.toFixed(4)),
        h: Number(h.toFixed(4)),
      },
    });
  }

  // Non-Maximum Suppression (IoU threshold 0.45)
  return applyNMS(candidates, 0.45);
}

function iou(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const ax2 = a.x + a.w, ay2 = a.y + a.h;
  const bx2 = b.x + b.w, by2 = b.y + b.h;
  const interX = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const interY = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter  = interX * interY;
  const union  = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

function applyNMS<T extends { confidence: number; box: { x: number; y: number; w: number; h: number } }>(
  boxes: T[],
  iouThreshold: number,
): T[] {
  boxes.sort((a, b) => b.confidence - a.confidence);
  const kept: T[] = [];
  const suppressed = new Set<number>();
  for (let i = 0; i < boxes.length; i++) {
    if (suppressed.has(i)) continue;
    kept.push(boxes[i]);
    for (let j = i + 1; j < boxes.length; j++) {
      if (!suppressed.has(j) && iou(boxes[i].box, boxes[j].box) > iouThreshold) {
        suppressed.add(j);
      }
    }
  }
  return kept;
}

/**
 * Softmax normalization
 */
function softmax(data: Float32Array): Float32Array {
  const maxVal = Math.max(...data);
  const expValues = data.map(v => Math.exp(v - maxVal));
  const sumExp = expValues.reduce((a, b) => a + b, 0);
  return expValues.map(v => v / sumExp) as Float32Array;
}

/**
 * Get cached model info for health check
 */
export function getLoadedModels(): string[] {
  return Array.from(sessionCache.keys());
}

export function getSessionCacheSize(): number {
  return sessionCache.size;
}
