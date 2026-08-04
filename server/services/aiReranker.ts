/**
 * Phase B2.2 — RAG Reranker. (doc 11 follow-up: gguf-mode hardening.)
 *
 * FALLBACK ORDER (never throws, never disables reranking):
 *   gguf  →  (on missing/invalid file OR not-a-reranker OR rankAll error)  llm
 *         →  (on no GGUF text model available OR error)                     identity
 * mode=gguf activates the MOMENT a valid reranker .gguf is dropped under
 * GGUF_MODELS_DIR and GGUF_RERANKER_MODEL points at it — no code change needed.
 * Until then, mode=gguf is a safe no-op that transparently uses the llm backend.
 *
 * Re-orders a candidate list (already retrieved by bruteforce cosine in
 * aiLocalKnowledgeService) so the most query-relevant chunks float to the top
 * before they reach the LLM prompt. This is the single biggest precision lever
 * for the file-based KB (we keep bruteforce jsonl; pgvector stays off).
 *
 * DESIGN
 * ──────
 * Flag-gated and FAIL-SAFE: when disabled — or on ANY error — `rerank()` returns
 * the input candidates unchanged (truncated to `topN`), so the caller's behavior
 * is identical to plain cosine retrieval. The reranker NEVER throws.
 *
 * Two backends behind RAG_RERANKER_MODE:
 *   (a) "llm"  (DEFAULT) — uses the existing fast GGUF text model (Qwen3-4B) via
 *       aiGgufEngine.generateText with a compact JSON scoring prompt. Needs NO
 *       new model. One generation call scores ALL candidates (cheap, ~1 call).
 *   (b) "gguf" (optional) — if GGUF_RERANKER_MODEL is set, uses a native
 *       cross-encoder ranking context. node-llama-cpp 3.18.1 DOES expose
 *       LlamaRankingContext (model.createRankingContext().rankAll(...)), so this
 *       is implemented. If the configured model isn't a reranker / load fails,
 *       it degrades to the "llm" backend, then to identity.
 *
 * NO model downloads happen here. The "gguf" path only loads a model the user
 * has already placed under GGUF_MODELS_DIR and pointed GGUF_RERANKER_MODEL at.
 */

import path from "node:path";
import fs from "node:fs";
// doc69 W1 "modelfix" — shared env→GGUF-basename resolver. The "llm" backend below documents that
// it scores with the FAST model (Qwen3-4B); that intent is now PINNED rather than implicit.
import { resolveLogicalModel } from "./ai/modelResolver";

// ─── Public interface ─────────────────────────────────────────────────────────

export interface RerankCandidate {
  /** Stable id (chunk id) — preserved through reranking so the caller can map back. */
  id: string;
  /** The text the reranker scores against the query. */
  text: string;
  /** Original retrieval score (cosine). Used as a tiebreaker / blend signal. */
  score?: number;
  /** Optional title — included in the document the reranker sees. */
  title?: string;
}

export interface RerankResult<T extends RerankCandidate = RerankCandidate> {
  candidate: T;
  /** Reranker relevance score in [0,1]. For identity passthrough this mirrors the input order. */
  rerankScore: number;
}

// ─── Flags / config (all default OFF) ─────────────────────────────────────────

export function isRerankerEnabled(): boolean {
  return (process.env.RAG_RERANKER_ENABLED ?? "false").toLowerCase() === "true";
}

type RerankerMode = "llm" | "gguf";
function getMode(): RerankerMode {
  const m = (process.env.RAG_RERANKER_MODE ?? "llm").toLowerCase();
  return m === "gguf" ? "gguf" : "llm";
}

// Cap on candidates fed to the reranker (cost guard). top-20 in is plenty.
const MAX_CANDIDATES = Number(process.env.RAG_RERANKER_MAX_CANDIDATES ?? 20);
// Per-document char cap so the scoring prompt / ranking ctx stays small.
const DOC_CHAR_CAP = Number(process.env.RAG_RERANKER_DOC_CHARS ?? 480);
// Blend weight: final = blend*rerank + (1-blend)*origCosine. Keeps reranker
// dominant while letting a strong cosine prior break near-ties. 1 = pure rerank.
const BLEND = (() => {
  const n = Number(process.env.RAG_RERANKER_BLEND ?? 0.85);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.85;
})();

function clip(text: string): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > DOC_CHAR_CAP ? t.slice(0, DOC_CHAR_CAP) + "…" : t;
}

function docOf(c: RerankCandidate): string {
  const title = c.title ? c.title.trim() + " — " : "";
  return clip(title + (c.text ?? ""));
}

/**
 * Rerank `candidates` against `query`, returning the top `topN` ranked results.
 *
 * FAIL-SAFE: if disabled or anything goes wrong, returns the first `topN`
 * candidates in their original order (with rerankScore mirroring that order),
 * so the caller's retrieval is unchanged.
 */
export async function rerank<T extends RerankCandidate>(
  query: string,
  candidates: T[],
  topN = 5,
): Promise<RerankResult<T>[]> {
  const identity = (): RerankResult<T>[] =>
    candidates.slice(0, Math.max(1, topN)).map((candidate, i) => ({
      candidate,
      // Descending pseudo-score so downstream sort-by-rerankScore is a no-op.
      rerankScore: candidates.length > 0 ? 1 - i / Math.max(1, candidates.length) : 0,
    }));

  if (!isRerankerEnabled()) return identity();
  if (!Array.isArray(candidates) || candidates.length === 0) return identity();

  const pool = candidates.slice(0, MAX_CANDIDATES);

  try {
    let scores: number[] | null = null;
    let activeBackend: "gguf" | "llm" | "identity" = "identity";
    if (getMode() === "gguf") {
      scores = await rankWithGguf(query, pool);
      if (scores) {
        activeBackend = "gguf";
      } else {
        // gguf backend declined (file missing/invalid / model not a reranker) →
        // fall back to the llm backend (which itself degrades to identity below).
        scores = await rankWithLlm(query, pool);
        if (scores) activeBackend = "llm";
      }
    } else {
      scores = await rankWithLlm(query, pool);
      if (scores) activeBackend = "llm";
    }
    logActiveBackendOnce(activeBackend);
    if (!scores || scores.length !== pool.length) return identity();

    const blended = pool.map((candidate, i) => {
      const orig = typeof candidate.score === "number" ? clamp01(candidate.score) : 0;
      const rr = clamp01(scores![i]);
      const rerankScore = BLEND * rr + (1 - BLEND) * orig;
      return { candidate, rerankScore };
    });
    blended.sort((a, b) => b.rerankScore - a.rerankScore);
    return blended.slice(0, Math.max(1, topN));
  } catch (err) {
    console.warn("[aiReranker] rerank failed, returning original order:", err);
    return identity();
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ─── Backend (a): LLM scoring via the fast GGUF model ─────────────────────────

/**
 * Score every candidate in ONE generation call. We ask the fast model for a JSON
 * array of {i, s} where s ∈ [0,1] is relevance. Robust parse: tolerate fenced
 * JSON, missing entries (default 0), and out-of-range scores.
 */
async function rankWithLlm(query: string, pool: RerankCandidate[]): Promise<number[] | null> {
  const { generateText, isGgufAvailable } = await import("./aiGgufEngine");
  if (!(await isGgufAvailable())) return null;

  const docs = pool
    .map((c, i) => `[${i}] ${docOf(c)}`)
    .join("\n");

  const systemPrompt =
    "You are a precise search reranker. Score how well each document answers the user query. " +
    "Output ONLY a compact JSON array, no prose.";

  const prompt =
    `Query: ${query.replace(/\s+/g, " ").trim().slice(0, 400)}\n\n` +
    `Documents:\n${docs}\n\n` +
    `For each document index, output its relevance to the Query as a number from 0.0 (irrelevant) ` +
    `to 1.0 (directly answers it). Respond with ONLY a JSON array of objects ` +
    `like [{"i":0,"s":0.9},{"i":1,"s":0.2}] covering every index 0..${pool.length - 1}.`;

  const maxTokens = Math.min(900, 40 + pool.length * 14);
  const result = await generateText({
    systemPrompt,
    prompt,
    maxTokens,
    temperature: 0,
    topP: 1,
    jsonMode: true,
    // FAST tier — this module's header explicitly specifies "the existing fast GGUF text model
    // (Qwen3-4B)" for the llm backend. If GGUF_FAST_MODEL is unset this resolves to undefined and
    // the engine falls back to GGUF_DEFAULT_MODEL (still a real text model, never the embedder).
  }, resolveLogicalModel("fast"));

  const parsed = parseScoreArray(result.text, pool.length);
  return parsed;
}

/**
 * Tolerant parser: extracts the first JSON array of {i,s} (or bare numbers) from
 * the model output. Returns a dense score[] of length `n` (missing → 0).
 */
export function parseScoreArray(text: string | undefined | null, n: number): number[] | null {
  if (!text) return null;
  const scores = new Array<number>(n).fill(0);
  let any = false;

  // Prefer a structured [{i,s}] array.
  const objRe = /\{\s*"?i"?\s*:\s*(\d+)\s*,\s*"?s"?\s*:\s*([0-9]*\.?[0-9]+)\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(text)) !== null) {
    const idx = Number(m[1]);
    const s = Number(m[2]);
    if (idx >= 0 && idx < n && Number.isFinite(s)) {
      scores[idx] = s > 1 ? s / 10 : s; // tolerate a 0–10 scale
      any = true;
    }
  }
  if (any) return scores;

  // Fallback: a bare array of numbers in order, e.g. [0.9, 0.1, 0.5].
  const arrMatch = text.match(/\[[\s\S]*?\]/);
  if (arrMatch) {
    const nums = arrMatch[0].match(/[0-9]*\.?[0-9]+/g);
    if (nums && nums.length >= 1) {
      for (let i = 0; i < Math.min(n, nums.length); i++) {
        const s = Number(nums[i]);
        if (Number.isFinite(s)) {
          scores[i] = s > 1 ? s / 10 : s;
          any = true;
        }
      }
    }
  }
  return any ? scores : null;
}

// ─── Backend (b): native cross-encoder GGUF ranking context ───────────────────
//
// node-llama-cpp 3.18.1 exposes LlamaRankingContext via
// model.createRankingContext(). rankAll(query, docs[]) returns scores in [0,1].
// We load the reranker model directly here (separate from aiGgufEngine's slot
// manager — we MUST NOT edit aiGgufEngine) and cache a single ranking context.
// If the configured model is not a reranker, createRankingContext throws and we
// fall back to the LLM backend.

let _rankLlama: unknown = null;
let _rankModel: unknown = null;
/**
 * Pha 1 Task 5 — giấy phép VRAM của HỘ TIÊU THỤ THỨ SÁU.
 *
 * ⚠ Đây là hộ tiêu thụ mà không công cụ nào của ba đợt trước nhìn thấy: `getRankingContext()`
 * bên dưới gọi THẲNG `llama.loadModel` (dòng ~361) — KHÔNG qua `loadGgufModel()` của
 * aiGgufEngine — nên nó vắng mặt khỏi `loadedModels`, khỏi `evictLRU()` và khỏi MỌI phép cộng
 * VRAM đã làm. Hôm nay nó chiếm 0 MiB CHỈ VÌ `RAG_RERANKER_GPU=false` (mặc định); đổi đúng một
 * cờ môi trường là có ngay một model nữa trên card mà không bảng nào cộng vào.
 */
let _rankVramTicket: import("./vram/vramWiring").VramTicket | null = null;
/**
 * ★ I-1 (Pha 1.5, vá sau review TOÀN NHÁNH) — giấy phép của BACKEND CUDA **THỨ HAI** của tiến trình.
 *
 * Task 2 đã đưa backend CUDA (~430 MiB — khoản LỚN NHẤT của "sàn cấu trúc" mà Pha 1 đo được) vào
 * sổ, nhưng chỉ khép **MỘT** thể hiện: `aiGgufEngine.getLlama()`. Hàm bên dưới gọi `getLlama()`
 * của node-llama-cpp **THẲNG** và mở giấy phép mãi SAU đó ⇒ ~430 MiB của backend nằm gọn trong
 * `beforeUsed` của giấy phép model và **KHÔNG BAO GIỜ vào sổ**. Chính comment cạnh lượt gọi đó tự
 * khai: *"Runs on the reranker's own backend instance"*.
 *
 * ⚠ Hôm nay vô hại vì `.env` đang `RAG_RERANKER_GPU=false` ⇒ `gpu:false` ⇒ backend không chiếm
 * VRAM. **Một lần lật cờ** là Pha 2 tính `headroom` thiếu ~430 MiB — đúng quy luật Ư0 đã tự rút
 * ("Task 2 chỉ khép MỘT thể hiện") và đúng lớp mù đã sinh ra hộ tiêu thụ thứ sáu/thứ bảy.
 *
 * ⚠ GIỮ QUA `disposeReranker()`, CỐ Ý: hàm đó dispose ranking-context và model, nhưng KHÔNG hề
 * dispose thể hiện `Llama` — backend vẫn sống trong tiến trình. Trả giấy phép ở đó là nói dối sổ.
 * Biến này còn là KHOÁ chống cộng trùng: `getLlama()` của node-llama-cpp cache theo tham số, nên
 * một lượt gọi thứ hai sau `disposeReranker()` sẽ KHÔNG cấp phát lại — mở giấy phép thứ hai ở đó
 * là ghi CÙNG MỘT KHỐI BYTE hai lần, đúng lỗi C-1 mà Task 8 vừa vá ở chỗ khác.
 */
let _rankBackendTicket: import("./vram/vramWiring").VramTicket | null = null;
let _rankCtx: { rankAll: (q: string, docs: string[]) => Promise<number[]> } | null = null;
let _rankCtxFailed = false;
// One-time "which backend is active" log guard, so we emit exactly one clear line
// per process the first time reranking is exercised.
let _backendLogged = false;

/**
 * Resolve the configured reranker GGUF to an absolute path on disk.
 * Mirrors aiGgufEngine.resolveModelPath: accepts an absolute path or a bare
 * filename (with/without .gguf) resolved under GGUF_MODELS_DIR (or the default
 * uploads/gguf-models). Returns null if unset or not found — NEVER throws.
 */
function resolveRerankerModelPath(): string | null {
  const raw = process.env.GGUF_RERANKER_MODEL;
  if (!raw) return null;
  const file = raw.endsWith(".gguf") ? raw : `${raw}.gguf`;
  if (path.isAbsolute(file) && fs.existsSync(file)) return file;
  const dir = process.env.GGUF_MODELS_DIR
    ? path.resolve(process.env.GGUF_MODELS_DIR)
    : path.join(process.cwd(), "uploads", "gguf-models");
  const full = path.join(dir, file);
  return fs.existsSync(full) ? full : null;
}

/**
 * Cheap, NON-throwing GGUF sanity check (mirrors aiGgufEngine.validateGgufFile):
 * verifies the first 4 bytes are the GGUF magic "GGUF" (0x47 47 55 46) and the
 * file is plausibly large. This catches a truncated/placeholder/wrong file BEFORE
 * we hand it to node-llama-cpp. It does NOT prove the model has a ranking head —
 * that is decided when createRankingContext() succeeds or throws. Returns false
 * (never throws) so the caller can fall back to the llm backend.
 */
const RERANKER_MIN_FILE_BYTES = 1 * 1024 * 1024; // 1 MB; a real reranker GGUF exceeds this
function isPlausibleGgufFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < RERANKER_MIN_FILE_BYTES) return false;
    const fd = fs.openSync(filePath, "r");
    try {
      const header = Buffer.alloc(4);
      const bytesRead = fs.readSync(fd, header, 0, 4, 0);
      return (
        bytesRead === 4 &&
        header[0] === 0x47 && // G
        header[1] === 0x47 && // G
        header[2] === 0x55 && // U
        header[3] === 0x46 //   F
      );
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

async function getRankingContext(): Promise<typeof _rankCtx> {
  if (_rankCtx) return _rankCtx;
  if (_rankCtxFailed) return null;

  const modelPath = resolveRerankerModelPath();
  if (!modelPath) {
    // Configured filename didn't resolve (or GGUF_RERANKER_MODEL is unset).
    console.warn(
      `[aiReranker] gguf model not found (GGUF_RERANKER_MODEL=${
        process.env.GGUF_RERANKER_MODEL ?? "<unset>"
      }) → falling back to llm (Qwen3-4B). Drop the reranker .gguf under GGUF_MODELS_DIR to enable mode=gguf.`,
    );
    _rankCtxFailed = true;
    return null;
  }

  // Magic-header / size guard BEFORE handing the file to node-llama-cpp, so a
  // truncated / placeholder / non-GGUF file degrades cleanly instead of crashing
  // the native loader. Cache the failure so we don't re-stat every request.
  if (!isPlausibleGgufFile(modelPath)) {
    console.warn(
      `[aiReranker] gguf model at ${modelPath} is not a valid GGUF (bad magic header or too small) ` +
        `→ falling back to llm (Qwen3-4B).`,
    );
    _rankCtxFailed = true;
    return null;
  }

  // ⚠ M-2 (review vòng 1): giấy phép của CHÍNH lượt gọi này, khai báo NGOÀI `try` để nhánh
  // `catch` ở cuối hàm trả được chỗ. Bản trước commit qua biến module `_rankVramTicket`, nên khi
  // hai lượt nạp chạy song song (không có khoá in-flight — hành vi CÓ SẴN), lượt ĐẦU commit
  // nhầm lease của lượt SAU.
  let localTicket: import("./vram/vramWiring").VramTicket | null = null;
  // ★ I-1 — giấy phép của backend CUDA riêng của reranker. Khai NGOÀI `try` cùng lý do với
  // `localTicket`: nhánh `catch` ở cuối hàm phải trả được chỗ khi `getLlama()` ném giữa chừng.
  let backendTicket: import("./vram/vramWiring").VramTicket | null = null;

  try {
    // doc 11 fix — the reranker is a tiny cross-encoder (~0.6B). By DEFAULT we load
    // it on CPU so it does NOT compete for VRAM with the big chat/RCA models
    // (Qwen3-30B ~17GB). Loading it on the GPU previously caused the 30B load to
    // OOM on a 32GB card. CPU rerank of ~20 short docs is only tens of ms. Opt back
    // onto the GPU with RAG_RERANKER_GPU=true (only if VRAM headroom allows).
    const useGpu = String(process.env.RAG_RERANKER_GPU ?? "false").toLowerCase() === "true";
    const nlc = (await import("node-llama-cpp")) as any;
    const { getLlama, LlamaLogLevel } = nlc;
    const L = LlamaLogLevel ?? {};
    // ★ I-1 — MỞ giấy phép NGAY TRƯỚC lượt gọi `getLlama()` thật (và đóng NGAY SAU, dưới đây):
    // đó là cách DUY NHẤT để delta đo được là của backend chứ không phải của trọng số model nạp
    // sau nó. CHỈ QUAN SÁT — thời điểm/tham số lượt gọi `getLlama()` KHÔNG ĐỔI.
    // ⚠ Chỉ mở khi CHƯA có giấy phép backend (xem docstring `_rankBackendTicket`): `getLlama()`
    // cache theo tham số nên lượt gọi thứ hai không cấp phát lại, mở thêm là cộng trùng.
    if (_rankBackendTicket === null) {
      try {
        const { beginVramAllocation, CUDA_BACKEND_FALLBACK_BYTES } = await import("./vram/vramWiring");
        backendTicket = await beginVramAllocation({
          owner: "cuda-backend:reranker",
          kind: "gguf-backend",
          /**
           * ★★★ Pha 2A Task 4 (T5-15) — giấy phép này CỐ Ý sống qua `disposeReranker()` (thể hiện
           * `Llama` vẫn sống) ⇒ nó KHÔNG có đường release nào ⇒ một lượt đo hỏng ghim
           * `actualBytes = null` VĨNH VIỄN và khoá lá chắn nền tới lúc khởi động lại tiến trình.
           *
           * ⚠ SỐ DỰ PHÒNG PHẢI THEO ĐÚNG THAM SỐ `gpu` TRUYỀN CHO `getLlama()` NGAY DƯỚI:
           * `RAG_RERANKER_GPU=false` (MẶC ĐỊNH của `.env` hôm nay) ⇒ `gpu:false` ⇒ backend này
           * chiếm **0 byte**. Dùng 431,6 MiB ở cấu hình đó là bơm một khoản MA bằng 84 % ngân sách
           * ngưỡng 512 MiB vào sổ — đúng lý do `fallbackBytes` là opt-in theo ĐIỂM GỌI chứ không
           * theo `kind`. `0` vẫn gỡ được chặn nền, nên cả hai cấu hình đều thoát T5-15.
           */
          fallbackBytes: useGpu && process.env.GGUF_GPU !== "false" ? CUDA_BACKEND_FALLBACK_BYTES : 0,
          // `background` (KHÁC `production` của backend aiGgufEngine): backend này chỉ phục vụ
          // rerank — tiện ích của RAG — nên nó phải nhường chỗ trước AOI và chat/RCA.
          priority: "background",
        });
      } catch {
        /* telemetry KHÔNG được làm hỏng đường nạp reranker */
        backendTicket = null;
      }
    }
    const llama = (await getLlama({
      gpu: useGpu ? (process.env.GGUF_GPU === "false" ? false : "auto") : false,
      // Quiet the benign llama.cpp ranking-context init spam ("embeddings required
      // but some input tokens were not marked as outputs -> overriding") while still
      // forwarding real warnings/errors. Runs on the reranker's own backend instance.
      logLevel: L.warn ?? "warn",
      logger: (level: unknown, message: unknown) => {
        if (typeof message === "string" && message.includes("some input tokens were not marked as outputs")) return;
        const msg = typeof message === "string" ? message : String(message ?? "");
        if (level === L.fatal || level === L.error) console.error(msg);
        else if (level === L.warn) console.warn(msg);
        // drop info/log/debug
      },
    // ⚠ Pha 2B Task 3 (I-3) — `gpuLayers` của node-llama-cpp 3.x là `"auto" | "max" | number | {…}`,
    // KHÔNG phải `number`. Chữ ký hẹp cũ ở đây chính là thứ làm `-1` trông như lựa chọn hợp lệ duy
    // nhất để nói "tất cả các lớp" — trong khi `-1` nghĩa là 0 lớp. Nới cho khớp thư viện thật.
    })) as { loadModel: (o: { modelPath: string; gpuLayers?: "auto" | "max" | number }) => Promise<unknown> };
    // ★ I-1 — ĐÓNG cửa sổ đo của backend NGAY, TRƯỚC khi mở cửa sổ của model bên dưới. Giữ nó mở
    // qua `loadModel()` sẽ làm HAI cửa sổ CHỒNG nhau và Task 8 (C-1) gắn `measureFailed` cho CẢ
    // HAI — bản vá này tự tay làm mù đúng phép đo nó vừa thêm. `wiring.rerankerBackend.test.ts`
    // ca 2 canh chính xác điều đó.
    if (backendTicket) {
      // ★★ N-1 (review cổng cuối) — TRẢ GIẤY PHÉP CŨ TRƯỚC KHI GHI ĐÈ CON TRỎ. Đúng khuôn mà
      // đường model ngay dưới đã dùng từ M-2 vòng 1 (`_rankVramTicket?.release()`).
      // ⚠ BẮT BUỘC vì `getRankingContext()` KHÔNG có khoá in-flight: hai lượt `rerank()` song song
      // đều thấy `_rankBackendTicket === null` ở lượt kiểm phía trên, ĐỀU mở giấy phép, và lượt sau
      // đè con trỏ ⇒ lượt đầu treo VĨNH VIỄN (`disposeReranker()` CỐ Ý không đụng giấy phép này).
      // Hậu quả 1: `getLlama()` cache theo tham số nên lượt hai KHÔNG cấp phát lại ⇒ lease thừa là
      //   một lease MA, cộng trùng +430 MiB = 84 % ngân sách ngưỡng 512 MiB.
      // Hậu quả 2 (KHÔNG phụ thuộc cờ GPU, nặng hơn): hai cửa sổ đo chồng nhau ⇒ Task 8 gắn
      //   `measureFailed` cho CẢ HAI ⇒ `actualBytes === null` vĩnh viễn trên giấy phép KHÔNG có
      //   đường release ⇒ lá chắn HOÃN (T5-1) chặn nền VĨNH VIỄN, không tự lành kể cả sau
      //   unload/evict. Đó là ngoại lệ DUY NHẤT của lời hứa "≤ 1 nhịp" ở báo cáo §11.4 — và dòng
      //   release dưới đây là thứ đóng nó lại.
      if (_rankBackendTicket && _rankBackendTicket !== backendTicket) {
        try {
          _rankBackendTicket.release();
        } catch {
          /* telemetry KHÔNG được làm hỏng đường nạp reranker */
        }
      }
      _rankBackendTicket = backendTicket;
      try {
        await backendTicket.commitMeasured();
      } catch {
        /* telemetry KHÔNG được làm hỏng đường nạp reranker */
      }
    }
    _rankLlama = llama;
    // Pha 1 Task 5 — KHAI BÁO hộ tiêu thụ thứ sáu vào sổ cái. `background`: rerank là tiện ích
    // của RAG, phải nhường chỗ cho AOI (`production`) và cho chat/RCA (`interactive`).
    // Telemetry hỏng ⇒ giấy phép rỗng; lượt nạp reranker chạy y nguyên như trước.
    try {
      const { beginVramAllocation } = await import("./vram/vramWiring");
      localTicket = await beginVramAllocation({
        owner: `reranker:${modelPath}`,
        kind: "gguf-model",
        priority: "background",
        filePath: modelPath,
      });
      // Trả giấy phép cũ trước khi ghi đè, không để nó treo trong sổ.
      _rankVramTicket?.release();
      _rankVramTicket = localTicket;
    } catch {
      /* telemetry KHÔNG được làm hỏng đường nạp reranker */
    }
    /**
     * ★★ Pha 2B Task 3, I-3 (review vòng 1) — `-1` GHIM CỨNG Ở ĐÂY LÀ MỘT SUY BIẾN IM LẶNG THẬT.
     *
     * `node-llama-cpp` 3.x (`gguf/insights/utils/resolveModelGpuLayersOption.js:23`) tính
     * `Math.max(0, Math.min(totalLayers, gpuLayers))` ⇒ **mọi số âm nghĩa là 0 LỚP TRÊN GPU**, tức
     * suy luận chạy CPU, chậm gấp bội, **không một dòng cảnh báo**. `-1` = "tất cả các lớp" là quy
     * ước của llama.cpp **CLI**, KHÔNG phải của thư viện này.
     *
     * **Đo trên phần cứng thật, đúng file model này** (`bge-reranker-v2-m3-Q8_0.gguf`, reviewer
     * 2026-08-04): `gpuLayers: -1` ⇒ `model.gpuLayers === 0` trong khi `totalLayers === 25`.
     *
     * Hôm nay `.env` có `RAG_RERANKER_GPU=false` nên nhánh này truyền `0` và vô hại — nhưng
     * `vramAllocationSites.ts` đã ghi *"Mở khoá bằng RAG_RERANKER_GPU=true"*, và bật đúng một cờ
     * đó là có ngay một hộ tiêu thụ chạy CPU trong im lặng.
     *
     * ⚠ Dùng `"auto"` chứ KHÔNG phải `"max"`: reranker ở mức `background` (nó phải nhường chỗ cho
     * AOI/chat), nên "nạp nhiều lớp nhất còn vừa" là đúng ngữ nghĩa của nó, còn `"max"` sẽ NÉM khi
     * không đủ chỗ và làm hỏng cả lượt rerank thay vì chạy chậm hơn.
     * ⚠ Điểm gọi này KHÔNG đi qua `loadWithVramOutcomes()` (nó không phải lượt nạp model sinh chữ),
     * nên `chuanHoaSoLop()` không với tới — hằng số phải đúng NGAY TẠI CHỖ.
     */
    const model = (await llama.loadModel({ modelPath, gpuLayers: useGpu ? "auto" : 0 })) as {
      createRankingContext: (o?: { contextSize?: "auto" | number }) => Promise<{
        rankAll: (q: string, docs: string[]) => Promise<number[]>;
      }>;
    };
    _rankModel = model;
    /**
     * ★★ N-4 (re-review) — LÁ CHẮN THỨ HAI, VÀ NÓ LÀ CÁI DIỆT ĐƯỢC LỚP LỖI.
     *
     * Đổi `-1` → `"auto"` ở trên mới hạ suy biến im lặng từ **"luôn luôn"** xuống **"mỗi khi thiết
     * bị đầy"**: `"auto"` **KHÔNG BAO GIỜ NÉM** (`resolveModelGpuLayersOption` nhánh chuỗi kết bằng
     * `?? 0`), nên máy chật cho ra một lượt nạp "thành công" chạy CPU thuần. Chỉ ĐỌC LẠI
     * `model.gpuLayers` mới bắt được — đúng lá chắn `zero-gpu-layers-on-success` mà lượt nạp model
     * sinh chữ đã có. KHÔNG BAO GIỜ ném, và im lặng ở đường ĐÚNG (số lớp > 0).
     */
    if (useGpu) {
      try {
        const { noteGpuLayersResolved } = await import("./vram/vramLoadOutcome");
        noteGpuLayersResolved({
          owner: `reranker:${modelPath}`,
          kind: "gguf-model",
          priority: "background",
          site: "aiReranker.loadModel",
          requestedGpuLayers: "auto",
          resolvedGpuLayers: (model as unknown as { gpuLayers?: unknown }).gpuLayers,
        });
      } catch {
        /* telemetry KHÔNG được làm hỏng đường nạp reranker (chính sách của file này) */
      }
    }
    _rankCtx = await model.createRankingContext({ contextSize: "auto" });
    // Số THẬT sau khi CẢ trọng số LẪN ranking context đã cấp phát. Chạy CPU (mặc định) thì
    // delta đúng bằng 0 — và 0 được ghi làm số liệu thật, nên sổ KHÔNG cộng nhầm cả trăm MiB
    // theo kích thước file cho một model không hề ở trên card.
    await localTicket?.commitMeasured();
    console.log(
      `[aiReranker] mode=gguf model=${path.basename(modelPath, ".gguf")} device=${useGpu ? "gpu" : "cpu"} (ranking context ready)`,
    );
    return _rankCtx;
  } catch (err) {
    // Pha 1 Task 5 — nạp/tạo ranking context hỏng ⇒ TRẢ chỗ ngay, không để giấy phép treo.
    //
    // ⚠ NEW-6 (review vòng 2): CHỈ trả giấy phép của CHÍNH lượt này. Bản trước còn thu hồi cả
    // `_rankVramTicket` khi nó khác `localTicket` — nghĩa là một lượt nạp HỎNG đi cướp giấy
    // phép của một lượt nạp THÀNH CÔNG chạy song song (getRankingContext() không có khoá
    // in-flight — hành vi CÓ SẴN), làm model đang sống biến mất khỏi sổ.
    try {
      localTicket?.release();
    } catch {
      /* telemetry KHÔNG được làm hỏng đường degrade sang backend llm */
    }
    // ★ I-1 — giấy phép backend: TRẢ chỉ khi `getLlama()` ĐÃ NÉM (khi đó `_rankBackendTicket` chưa
    // được gán, tức backend KHÔNG hình thành thật). Nếu backend đã sống mà `loadModel()`/
    // `createRankingContext()` mới ném thì KHÔNG trả — backend vẫn đang giữ VRAM, trả là nói dối sổ
    // và mở lại đúng lỗ hổng "hộ tiêu thụ vô hình" mà bản vá này vừa bịt.
    if (backendTicket && _rankBackendTicket !== backendTicket) {
      try {
        backendTicket.release();
      } catch {
        /* telemetry KHÔNG được làm hỏng đường degrade sang backend llm */
      }
    }
    // Chỉ xoá con trỏ chung nếu nó ĐANG trỏ vào giấy phép vừa trả. Lượt song song thành công
    // giữ nguyên giấy phép của nó.
    if (_rankVramTicket === localTicket) _rankVramTicket = null;
    // Most common cause: the model isn't a reranker (no rank head) → llama.cpp
    // throws on createRankingContext. Mark failed so we don't retry per-query.
    console.warn(
      "[aiReranker] native GGUF ranking context unavailable (model not a reranker?) — " +
        "falling back to LLM reranker:",
      err,
    );
    _rankCtxFailed = true;
    return null;
  }
}

async function rankWithGguf(query: string, pool: RerankCandidate[]): Promise<number[] | null> {
  const ctx = await getRankingContext();
  if (!ctx) return null;
  try {
    const docs = pool.map((c) => docOf(c));
    const scores = await ctx.rankAll(query.slice(0, 1000), docs);
    if (!Array.isArray(scores) || scores.length !== pool.length) return null;
    return scores.map((s) => clamp01(Number(s)));
  } catch (err) {
    console.warn("[aiReranker] GGUF rankAll failed, falling back:", err);
    return null;
  }
}

/**
 * Emit exactly ONE clear line per process the first time reranking runs, stating
 * which backend is actually serving requests. For mode=gguf the gguf-specific
 * details (model name / "not found" reason) are already logged by
 * getRankingContext(); this complements them with the resolved end-state.
 */
function logActiveBackendOnce(active: "gguf" | "llm" | "identity"): void {
  if (_backendLogged) return;
  _backendLogged = true;
  const requested = getMode();
  if (active === "gguf") {
    // getRankingContext already logged "mode=gguf model=… (ranking context ready)".
    return;
  }
  if (requested === "gguf" && active === "llm") {
    console.log("[aiReranker] gguf model not found/invalid → falling back to llm (Qwen3-4B)");
  } else if (active === "llm") {
    console.log("[aiReranker] mode=llm (Qwen3-4B scoring) active");
  } else {
    console.log("[aiReranker] no GGUF backend available → identity passthrough (original cosine order)");
  }
}

/**
 * Lightweight, side-effect-free diagnostics for health endpoints / dashboards.
 * Reports the configured intent vs. the resolvable reality. `activeBackend` is
 * the backend that WOULD serve a request right now given current resolution +
 * cached failure state:
 *   - "gguf"     : a ranking context is live (model loaded & validated)
 *   - "llm"      : gguf unavailable/declined → llm scoring would be used
 *   - "identity" : reranker disabled → input order is returned unchanged
 * This NEVER loads a model or runs inference — it only reads env + cached state.
 */
export function getRerankerStatus(): {
  enabled: boolean;
  mode: RerankerMode;
  modelConfigured: boolean;
  modelResolved: boolean;
  activeBackend: "gguf" | "llm" | "identity";
} {
  const enabled = isRerankerEnabled();
  const mode = getMode();
  const modelConfigured = !!process.env.GGUF_RERANKER_MODEL;
  const resolvedPath = resolveRerankerModelPath();
  const modelResolved = !!resolvedPath && isPlausibleGgufFile(resolvedPath);

  let activeBackend: "gguf" | "llm" | "identity";
  if (!enabled) {
    activeBackend = "identity";
  } else if (mode === "gguf") {
    // gguf only serves if a context is already live, or could still load
    // (resolved + valid + not previously marked failed).
    activeBackend = _rankCtx || (modelResolved && !_rankCtxFailed) ? "gguf" : "llm";
  } else {
    activeBackend = "llm";
  }
  return { enabled, mode, modelConfigured, modelResolved, activeBackend };
}

/** Free the native ranking context/model (best-effort; not normally needed). */
export async function disposeReranker(): Promise<void> {
  try {
    const ctx = _rankCtx as unknown as { dispose?: () => Promise<void> } | null;
    if (ctx && typeof ctx.dispose === "function") {
      await ctx.dispose();
    }
  } catch {
    /* best-effort */
  }
  try {
    if (_rankModel && typeof (_rankModel as { dispose?: () => Promise<void> }).dispose === "function") {
      await (_rankModel as { dispose: () => Promise<void> }).dispose();
    }
  } catch {
    /* best-effort */
  }
  // Pha 1 Task 5 — trả giấy phép của hộ tiêu thụ thứ sáu SAU khi đã dispose thật.
  try {
    _rankVramTicket?.release();
  } catch {
    /* best-effort — telemetry không được làm hỏng lượt dispose */
  }
  _rankVramTicket = null;
  _rankCtx = null;
  _rankModel = null;
  _rankLlama = null;
  _rankCtxFailed = false;
  _backendLogged = false;
}
