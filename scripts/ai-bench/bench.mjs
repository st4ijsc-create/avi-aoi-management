#!/usr/bin/env node
/**
 * scripts/ai-bench/bench.mjs — Doc 34 P0 benchmark harness (§IV-P0 exit criterion:
 * "benchmark harness (tok/s prefill/decode + VRAM); records baseline").
 *
 * WHAT IT DOES
 *   For a configurable set of LOGICAL models (deep / fast / embed, plus optional
 *   code / fim), it measures, on the real hardware, per model:
 *     - model LOAD time (ms)               — llama.loadModel + createContext
 *     - PREFILL throughput (tok/s)         — promptTokens / time-to-first-token, at
 *                                            a couple of prompt sizes ("context sizes")
 *     - DECODE  throughput (tok/s)         — generatedTokens / (total − TTFT)
 *     - peak VRAM (MiB)                     — nvidia-smi sampling + llama.getVramState()
 *   Runs N warmup + M timed iterations and writes a baseline JSON with hardware /
 *   model / config metadata to scripts/ai-bench/baselines/<label>.json.
 *
 *   Embedding models are benchmarked with embed latency + input tok/s (no decode).
 *
 * IT IS SELF-CONTAINED: it loads node-llama-cpp directly (same API the server's
 * aiGgufEngine.ts uses) — it does NOT import any server/ source, so it can run
 * without booting the app. This matches scripts/ai-kb/_gguf-embed.mjs conventions.
 *
 * ⚠ dot2 Task 1 (2026-08-02) — SAI BA LẦN LIÊN TIẾP vì tự dựng tham số context
 * độc lập với đường sản xuất (server/services/aiGgufEngine.ts): thiếu "vision"
 * khỏi mọi phép cộng (Đợt 0), embedding context hard-code "auto" cho contextSize
 * (thay vì EMBED_CTX) hụt 2.030 MiB (Đợt 1 Task 2), model.createContext() thiếu
 * `sequences` hụt ~1.360 MiB/model text (Đợt 1 Task 4). Lần thứ ba làm tài liệu quyết định của Đợt 0
 * sai ~3.400 MiB theo hướng lạc quan. SỬA: vẫn KHÔNG import server/ code (import
 * `loadGgufModel` là lựa chọn ưu tiên theo brief, nhưng `npm run ai:bench` chạy
 * bằng `node` thuần — aiGgufEngine.ts import các module TS nội bộ bằng đường dẫn
 * KHÔNG đuôi mở rộng ("./ggufConcurrency") mà `node` thuần không resolve được
 * (ERR_MODULE_NOT_FOUND — xác nhận thủ công); ép chạy qua tsx sẽ đổi runtime của
 * `npm run ai:bench` cho MỌI người dùng bench, ngoài phạm vi Task 1. Thay vào đó:
 * đọc CÙNG biến môi trường (GGUF_SEQUENCES/GGUF_DEFAULT_CTX/GGUF_MAX_CTX/
 * GGUF_EMBED_CTX) và tái tạo CHÍNH XÁC cùng công thức mặc định/clamp production
 * dùng — xem khối "PRODUCTION CONTEXT-SIZING PARITY" bên dưới, mỗi hằng số trỏ
 * thẳng dòng sản xuất tương ứng. Cổng chống drift:
 * scripts/ai-bench/bench.production-parity.test.ts (đọc mã nguồn, khẳng định
 * không còn hard-code). Số liệu trước/sau: docs/superpowers/reports/2026-08-02-dot2-report.md §1.
 *
 * ⚠ dot2 Task 3 (2026-08-02) — Task 1 (trên) từng thêm một khối MÔ PHỎNG bug production vào
 * benchEmbedModel() (tạo THÊM một context thường trước context nhúng) để bench khớp hành vi
 * SAI của production lúc đó (loadGgufModel() tạo context thường cho CẢ model chỉ-nhúng). Task 3
 * đã sửa bug đó tại production (aiGgufEngine.ts ~684-708, cờ config.embeddingOnly) nên khối mô
 * phỏng đã XOÁ khỏi benchEmbedModel() — nếu còn, bench sẽ đếm thừa ~3,6 GB cho `embed` (drift
 * lần thứ TƯ). Số liệu trước/sau: docs/superpowers/reports/2026-08-02-dot2-report.md §3.
 *
 * DESIGN NOTES / APPROXIMATIONS
 *   - Prefill tok/s uses LlamaChatSession + onTextChunk to get TTFT. The chat
 *     template adds a handful of tokens, so promptTokens is a close approximation
 *     of the tokens actually prefilled (dominant term at 1k+ prompt sizes).
 *   - Timing uses perf_hooks.performance.now() (monotonic). The output LABEL uses
 *     new Date().toISOString() but falls back to a fixed label if Date is restricted
 *     (accept --label to pin it).
 *   - A logical model whose env is unset is skipped (logged). A model whose file is
 *     missing / not a valid GGUF is skipped and recorded under "skipped".
 *
 * USAGE (see README.md for the full matrix):
 *   node scripts/ai-bench/bench.mjs --selfcheck            # wiring check, NO big model load
 *   node scripts/ai-bench/bench.mjs                        # full run, all configured models
 *   node scripts/ai-bench/bench.mjs --models deep,fast --iters 5 --label 2026-07-05
 *   node scripts/ai-bench/bench.mjs --cpu                  # force CPU (no CUDA)
 *
 * ENV (read from repo-root .env via dotenv; same vars the engine reads):
 *   GGUF_MODELS_DIR   (default ./uploads/gguf-models)
 *   GGUF_DEFAULT_MODEL  → logical "deep"
 *   GGUF_FAST_MODEL     → logical "fast"
 *   GGUF_EMBED_MODEL    → logical "embed"
 *   GGUF_CODE_MODEL     → logical "code"  (optional; unset → skipped)
 *   GGUF_FIM_MODEL      → logical "fim"   (optional; unset → skipped)
 *   GGUF_GPU=false      → force CPU (also --cpu)
 *   GGUF_CUDA_BIN / CUDA_PATH → CUDA runtime bin prepended to PATH (Windows)
 *   GGUF_SEQUENCES      → parallel sequences per text context (default 4, aiGgufEngine.ts ~206-209)
 *   GGUF_DEFAULT_CTX    → default text contextSize (default 4096, aiGgufEngine.ts ~215-218)
 *   GGUF_MAX_CTX        → hard clamp ceiling (default 32768, aiGgufEngine.ts ~220-223)
 *   GGUF_EMBED_CTX      → embedding contextSize (default 2048, aiGgufEngine.ts ~246-254)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_VERSION = 1;

// Monotonic clock for measurements (falls back if performance is unavailable).
const now = () => (typeof performance?.now === "function" ? performance.now() : Date.now());

// ─── PRODUCTION CONTEXT-SIZING PARITY (dot2 Task 1) ─────────────────────────────
// Mỗi hằng số/hàm dưới đây là bản SAO CHÍNH XÁC công thức đọc-env + mặc định +
// clamp mà server/services/aiGgufEngine.ts dùng khi nạp model thật (loadGgufModel
// ~623-719) và tạo context nhúng (getEmbeddingContext ~2281-2296). Không import
// trực tiếp được vì `npm run ai:bench` chạy bằng `node` thuần, còn aiGgufEngine.ts
// import nội bộ bằng đường dẫn không đuôi mở rộng (chỉ tsx/vite-node resolve
// được) — xem giải thích đầy đủ ở header file. NẾU production đổi công thức ở
// các dòng trỏ tới bên dưới, PHẢI đồng bộ lại khối này (cổng chống drift:
// bench.production-parity.test.ts đọc mã nguồn, không đo được sai lệch công thức
// — chỉ phép đo VRAM trước/sau mới chứng minh được, xem báo cáo §1).
/** aiGgufEngine.ts ~205-209 (GGUF_SEQUENCES). */
const PROD_GGUF_SEQUENCES = (() => {
  const n = parseInt(process.env.GGUF_SEQUENCES || "4", 10);
  return Number.isFinite(n) && n > 0 ? n : 4;
})();
/** aiGgufEngine.ts ~210-218 (GGUF_DEFAULT_CTX). */
const PROD_GGUF_DEFAULT_CTX = (() => {
  const n = parseInt(process.env.GGUF_DEFAULT_CTX || "4096", 10);
  return Number.isFinite(n) && n > 0 ? n : 4096;
})();
/** aiGgufEngine.ts ~219-223 (GGUF_MAX_CTX). */
const PROD_GGUF_MAX_CTX = (() => {
  const n = parseInt(process.env.GGUF_MAX_CTX || "32768", 10);
  return Number.isFinite(n) && n > 0 ? n : 32768;
})();
/** aiGgufEngine.ts ~225-231 (resolveContextSize) — dùng bởi loadGgufModel ~684-691. */
function prodResolveContextSize(requested) {
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) {
    return PROD_GGUF_DEFAULT_CTX;
  }
  return Math.min(Math.max(Math.floor(requested), 256), PROD_GGUF_MAX_CTX);
}
/** aiGgufEngine.ts ~246-254 (EMBED_CTX) — dùng bởi getEmbeddingContext ~2284-2287. */
const PROD_EMBED_CTX = (() => {
  const raw = Number(process.env.GGUF_EMBED_CTX);
  const DEFAULT_EMBED_CTX = 2048;
  const value = Number.isFinite(raw) && raw >= 256 ? Math.floor(raw) : DEFAULT_EMBED_CTX;
  return Math.min(value, PROD_GGUF_MAX_CTX);
})();

// ─── Logical model registry (env → benchmark type) ─────────────────────────────
const LOGICAL_MODELS = [
  { key: "deep", env: "GGUF_DEFAULT_MODEL", type: "text", optional: false },
  { key: "fast", env: "GGUF_FAST_MODEL", type: "text", optional: false },
  { key: "code", env: "GGUF_CODE_MODEL", type: "text", optional: true },
  { key: "fim", env: "GGUF_FIM_MODEL", type: "text", optional: true, fim: true },
  { key: "embed", env: "GGUF_EMBED_MODEL", type: "embed", optional: false },
];

// ─── CLI parsing ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = {
    selfcheck: false,
    cpu: false,
    models: null, // null = all configured
    warmup: 1,
    iters: 3,
    maxTokens: 256,
    prefill: [128, 1024],
    ctx: null, // derived unless set
    label: null,
    out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    switch (t) {
      case "--selfcheck": a.selfcheck = true; break;
      case "--cpu": a.cpu = true; break;
      case "--models": a.models = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--warmup": a.warmup = Math.max(0, parseInt(next(), 10) || 0); break;
      case "--iters": a.iters = Math.max(1, parseInt(next(), 10) || 1); break;
      case "--maxTokens": a.maxTokens = Math.max(1, parseInt(next(), 10) || 1); break;
      case "--prefill": a.prefill = next().split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0); break;
      case "--ctx": a.ctx = Math.max(256, parseInt(next(), 10) || 256); break;
      case "--label": a.label = next(); break;
      case "--out": a.out = next(); break;
      case "-h": case "--help": a.help = true; break;
      default:
        if (t.startsWith("--")) console.warn(`[bench] unknown flag ignored: ${t}`);
    }
  }
  if (!a.prefill.length) a.prefill = [128, 1024];
  return a;
}

// ─── Timestamp label (Date may be restricted → fall back) ──────────────────────
function safeLabel(explicit) {
  if (explicit) return String(explicit).replace(/[^\w.\-:]+/g, "_");
  try {
    // Prefer ISO; make it filesystem-safe (no ':').
    const iso = new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z");
    if (iso && iso.length > 4) return iso;
  } catch {
    /* Date restricted */
  }
  return "bench-latest";
}

// ─── Model file resolution + GGUF magic validation ─────────────────────────────
function resolveModelsDir() {
  return process.env.GGUF_MODELS_DIR
    ? path.resolve(process.env.GGUF_MODELS_DIR)
    : path.join(process.cwd(), "uploads", "gguf-models");
}

function resolveModelPath(nameOrPath, modelsDir) {
  const file = /\.gguf$/i.test(nameOrPath) ? nameOrPath : `${nameOrPath}.gguf`;
  if (path.isAbsolute(file) && fs.existsSync(file)) return file;
  const inDir = path.join(modelsDir, file);
  if (fs.existsSync(inDir)) return inDir;
  return null; // not found
}

/** Verify GGUF magic header ("GGUF") + minimum size. Returns { ok, sizeBytes, reason }. */
function validateGguf(filePath) {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return { ok: false, reason: "not a file" };
    if (st.size < 1024 * 1024) return { ok: false, sizeBytes: st.size, reason: `too small (${st.size}B)` };
    const fd = fs.openSync(filePath, "r");
    try {
      const h = Buffer.alloc(4);
      const n = fs.readSync(fd, h, 0, 4, 0);
      if (n < 4 || h[0] !== 0x47 || h[1] !== 0x47 || h[2] !== 0x55 || h[3] !== 0x46) {
        return { ok: false, sizeBytes: st.size, reason: "bad magic (not GGUF)" };
      }
    } finally {
      fs.closeSync(fd);
    }
    return { ok: true, sizeBytes: st.size };
  } catch (e) {
    return { ok: false, reason: e?.message ?? String(e) };
  }
}

// ─── VRAM sampling ─────────────────────────────────────────────────────────────
/** nvidia-smi snapshot → { name, totalMib, usedMib } or null (never throws). */
function readNvidiaSmi() {
  try {
    const out = execFileSync(
      "nvidia-smi",
      ["--query-gpu=name,memory.total,memory.used", "--format=csv,noheader,nounits"],
      { timeout: 4000, windowsHide: true },
    ).toString();
    const line = out.split(/\r?\n/).find((l) => l.trim().length > 0) || "";
    const parts = line.split(",").map((s) => s.trim());
    const name = parts[0] || "unknown";
    const totalMib = parseInt(parts[1], 10);
    const usedMib = parseInt(parts[2], 10);
    if (Number.isFinite(totalMib) && Number.isFinite(usedMib)) return { name, totalMib, usedMib };
  } catch {
    /* nvidia-smi missing or not a GPU host */
  }
  return null;
}

// ─── Stats helpers ─────────────────────────────────────────────────────────────
function stats(nums) {
  const arr = nums.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!arr.length) return { n: 0, mean: null, median: null, min: null, max: null };
  const sum = arr.reduce((a, b) => a + b, 0);
  const mid = Math.floor(arr.length / 2);
  const median = arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  return {
    n: arr.length,
    mean: round(sum / arr.length),
    median: round(median),
    min: round(arr[0]),
    max: round(arr[arr.length - 1]),
  };
}
const round = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);

// ─── CUDA PATH setup (mirror aiGgufEngine.getLlama) ────────────────────────────
function ensureCudaOnPath(gpuEnabled) {
  if (!gpuEnabled) return null;
  const cudaBin = process.env.GGUF_CUDA_BIN || (process.env.CUDA_PATH ? `${process.env.CUDA_PATH}\\bin` : "");
  if (cudaBin && !(process.env.PATH || "").includes(cudaBin)) {
    process.env.PATH = `${cudaBin};${process.env.PATH || ""}`;
    return cudaBin;
  }
  return cudaBin || null;
}

// ─── node-llama-cpp loader ─────────────────────────────────────────────────────
async function importLlama() {
  try {
    return await import("node-llama-cpp");
  } catch (e) {
    throw new Error(`node-llama-cpp not available (${e?.message ?? e}). Install with: pnpm add node-llama-cpp`);
  }
}

function nodeLlamaCppVersion() {
  try {
    const pkg = path.join(process.cwd(), "node_modules", "node-llama-cpp", "package.json");
    if (fs.existsSync(pkg)) return JSON.parse(fs.readFileSync(pkg, "utf8")).version || "unknown";
  } catch {
    /* best-effort */
  }
  return "unknown";
}

// ─── Prompt construction ───────────────────────────────────────────────────────
const SYSTEM_PROMPT =
  "You are a senior industrial automation, PLC and robotics programming engineer.";
const TASK_SUFFIX =
  "\n\nTask: Write a well-structured function that computes a moving average over a sensor ring buffer, and briefly explain the approach.";
const FILLER =
  "Consider the manufacturing line context, cycle-time budget, safety interlocks and I/O mapping carefully. ";

/** Build a user prompt padded to ~targetTokens tokens (using the model tokenizer). */
function buildPrefillPrompt(model, targetTokens) {
  let body = "";
  // Grow filler until body+task reaches the target token count.
  let guard = 0;
  while (model.tokenize(body + TASK_SUFFIX).length < targetTokens && guard++ < 100000) {
    body += FILLER;
  }
  return body + TASK_SUFFIX;
}

// ─── Text model benchmark (deep / fast / code / fim) ───────────────────────────
async function benchTextModel(llama, LlamaChatSession, model, cfg, sampleVram) {
  // dot2 Task 1 — contextSize/sequences PHẢI khớp production (loadGgufModel,
  // aiGgufEngine.ts ~684-691). "--ctx" đóng vai trò "requested" giống hệt
  // config.contextSize (per-task hint) rồi đi qua ĐÚNG hàm clamp production
  // dùng; khi KHÔNG truyền --ctx, "requested" là max(GGUF_DEFAULT_CTX, nhu cầu
  // prefill lớn nhất + maxTokens + đệm) — dưới CLI mặc định (prefill 128,1024 ·
  // maxTokens 256) giá trị này BẰNG hệt GGUF_DEFAULT_CTX (4096) nên phép đo mặc
  // định khớp production nguyên vẹn; nếu người dùng yêu cầu prefill lớn hơn cửa
  // sổ mặc định, context vẫn tự lớn đủ để không throw (không đổi số đo mặc định).
  // `sequences` là tham số THIẾU trong 3 lần đo sai trước (mặc định 1 khi vắng
  // mặt, production luôn 4) ⇒ hụt ~1.360 MiB/model text đo được ở Đợt 1 Task 4.
  const requestedCtx =
    cfg.ctx ?? Math.max(PROD_GGUF_DEFAULT_CTX, Math.max(...cfg.prefill) + cfg.maxTokens + 512);
  const contextSize = prodResolveContextSize(requestedCtx);
  const context = await model.createContext({
    contextSize,
    batchSize: 512,
    flashAttention: true,
    sequences: PROD_GGUF_SEQUENCES,
  });
  sampleVram("after-ctx");

  const perTarget = [];
  try {
    for (const target of cfg.prefill) {
      const promptText = buildPrefillPrompt(model, target);
      const promptTokens = model.tokenize(SYSTEM_PROMPT + "\n\n" + promptText).length;

      // one generation run → { ttftMs, totalMs, genTokens }
      const runOnce = async () => {
        const seq = context.getSequence();
        const session = new LlamaChatSession({ contextSequence: seq, systemPrompt: SYSTEM_PROMPT });
        try {
          const t0 = now();
          let tFirst = null;
          const response = await session.prompt(promptText, {
            maxTokens: cfg.maxTokens,
            temperature: 0, // deterministic
            onTextChunk() {
              if (tFirst === null) tFirst = now();
            },
          });
          const t1 = now();
          const genTokens = model.tokenize(response).length;
          const ttftMs = tFirst === null ? t1 - t0 : tFirst - t0;
          const decodeMs = Math.max(0.001, t1 - (tFirst === null ? t0 : tFirst));
          return { ttftMs, totalMs: t1 - t0, decodeMs, genTokens };
        } finally {
          seq.dispose();
        }
      };

      // warmup (discard)
      for (let w = 0; w < cfg.warmup; w++) await runOnce();
      // timed
      const runs = [];
      for (let it = 0; it < cfg.iters; it++) {
        const r = await runOnce();
        r.prefillTokPerSec = r.ttftMs > 0 ? (promptTokens / r.ttftMs) * 1000 : null;
        r.decodeTokPerSec = r.decodeMs > 0 ? (r.genTokens / r.decodeMs) * 1000 : null;
        runs.push(r);
        sampleVram(`gen-${target}-${it}`);
      }

      perTarget.push({
        prefillTargetTokens: target,
        promptTokens,
        contextSize,
        prefillTokPerSec: stats(runs.map((r) => r.prefillTokPerSec)),
        decodeTokPerSec: stats(runs.map((r) => r.decodeTokPerSec)),
        ttftMs: stats(runs.map((r) => r.ttftMs)),
        totalMs: stats(runs.map((r) => r.totalMs)),
        genTokens: stats(runs.map((r) => r.genTokens)),
        rawIters: runs.map((r) => ({
          ttftMs: round(r.ttftMs),
          totalMs: round(r.totalMs),
          decodeMs: round(r.decodeMs),
          genTokens: r.genTokens,
          prefillTokPerSec: round(r.prefillTokPerSec),
          decodeTokPerSec: round(r.decodeTokPerSec),
        })),
      });
    }
  } finally {
    try { await context.dispose(); } catch { /* best-effort */ }
  }
  return { contextSize, results: perTarget };
}

// ─── Embedding model benchmark ─────────────────────────────────────────────────
async function benchEmbedModel(model, cfg, sampleVram) {
  // dot2 Task 1 — "auto" cấp TOÀN BỘ cửa sổ ngữ cảnh gốc của model (hàng chục nghìn
  // token) thay vì EMBED_CTX production thật sự dùng (getEmbeddingContext,
  // aiGgufEngine.ts ~2281-2296). Hụt 2.030 MiB đo được ở Đợt 1 Task 2.
  //
  // dot2 Task 3 — ĐÃ XOÁ khối mô phỏng "context thường cho model chỉ-nhúng" từng
  // nằm ở đây (tạo model.createContext() trước ctx nhúng, mô phỏng bug thật của
  // loadGgufModel() lúc đó). Task 3 đã sửa PRODUCTION (server/services/
  // aiGgufEngine.ts ~684-691): loadGgufModel() giờ BỎ QUA context thường khi
  // config.embeddingOnly===true — model chỉ-nhúng không còn tạo context thường
  // nữa. Nếu khối mô phỏng còn ở đây, bench sẽ ĐẾM THỪA ~3,6 GB cho embed — nói
  // dối theo hướng LẠC QUAN NGƯỢC (báo VRAM CAO hơn production thật) — đây sẽ là
  // lần drift thứ TƯ của công cụ đo này. Số đo TRƯỚC/SAU thật (production path,
  // không phải bench): docs/superpowers/reports/2026-08-02-dot2-report.md §3.
  const ctx = await model.createEmbeddingContext({
    contextSize: PROD_EMBED_CTX,
    batchSize: 512,
  });
  sampleVram("after-embed-ctx");
  const text =
    "Compute the moving average of a PLC sensor buffer and detect out-of-tolerance drift " +
    "in an AOI/AVI inspection line with configurable window size and alarm thresholds.";
  const inputTokens = model.tokenize(text).length;
  try {
    const runOnce = async () => {
      const t0 = now();
      const res = await ctx.getEmbeddingFor(text);
      const t1 = now();
      const dims = Array.from(res.vector || []).length;
      return { ms: t1 - t0, dims };
    };
    for (let w = 0; w < cfg.warmup; w++) await runOnce();
    const runs = [];
    for (let it = 0; it < cfg.iters; it++) {
      const r = await runOnce();
      runs.push(r);
      sampleVram(`embed-${it}`);
    }
    const dims = runs[0]?.dims ?? 0;
    return {
      results: [{
        inputTokens,
        dimensions: dims,
        embedMs: stats(runs.map((r) => r.ms)),
        inputTokPerSec: stats(runs.map((r) => (r.ms > 0 ? (inputTokens / r.ms) * 1000 : null))),
        rawIters: runs.map((r) => ({ ms: round(r.ms), dims: r.dims })),
      }],
    };
  } finally {
    try { await ctx.dispose(); } catch { /* best-effort */ }
  }
}

// ─── Resolve which logical models to run ───────────────────────────────────────
function resolveTargets(cfg, modelsDir) {
  const wanted = cfg.models; // null = all
  const targets = [];
  const skipped = [];
  for (const lm of LOGICAL_MODELS) {
    if (wanted && !wanted.includes(lm.key)) continue;
    const envVal = (process.env[lm.env] || "").trim();
    if (!envVal) {
      skipped.push({ logical: lm.key, env: lm.env, reason: "env unset" });
      continue;
    }
    const resolved = resolveModelPath(envVal, modelsDir);
    if (!resolved) {
      skipped.push({ logical: lm.key, env: lm.env, file: envVal, reason: "file not found" });
      continue;
    }
    const v = validateGguf(resolved);
    if (!v.ok) {
      skipped.push({ logical: lm.key, env: lm.env, file: resolved, reason: `invalid GGUF: ${v.reason}` });
      continue;
    }
    targets.push({ ...lm, envVal, path: resolved, sizeBytes: v.sizeBytes });
  }
  return { targets, skipped };
}

// ─── SELF-CHECK (NO big model load) ────────────────────────────────────────────
async function runSelfcheck(cfg, modelsDir, outDir) {
  console.log("=== ai-bench selfcheck (no models are loaded) ===\n");
  let critical = 0;
  const line = (ok, label, detail) =>
    console.log(`  ${ok ? "OK  " : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);

  // 1. models dir
  const dirOk = fs.existsSync(modelsDir) && fs.statSync(modelsDir).isDirectory();
  line(dirOk, "GGUF models dir", `${modelsDir}${dirOk ? "" : " (missing)"}`);
  if (!dirOk) critical++;

  // 2. logical model files present + valid GGUF (no load)
  console.log("  logical models:");
  for (const lm of LOGICAL_MODELS) {
    const envVal = (process.env[lm.env] || "").trim();
    if (!envVal) {
      console.log(`      -    ${lm.key.padEnd(5)} (${lm.env}) unset${lm.optional ? " [optional]" : ""}`);
      if (!lm.optional) console.log(`           note: required logical "${lm.key}" has no model configured`);
      continue;
    }
    const resolved = resolveModelPath(envVal, modelsDir);
    if (!resolved) { console.log(`      x    ${lm.key.padEnd(5)} ${envVal} — NOT FOUND`); continue; }
    const v = validateGguf(resolved);
    const sz = v.sizeBytes ? `${(v.sizeBytes / 1024 / 1024 / 1024).toFixed(2)}GB` : "?";
    console.log(`      ${v.ok ? "OK" : "x "}   ${lm.key.padEnd(5)} ${path.basename(resolved)} (${sz})${v.ok ? "" : " — " + v.reason}`);
  }

  // 3. node-llama-cpp importable (do NOT init the engine / load a model)
  let llamaOk = false;
  try {
    const mod = await import("node-llama-cpp");
    llamaOk = typeof mod.getLlama === "function" && typeof mod.LlamaChatSession === "function";
  } catch (e) {
    line(false, "node-llama-cpp import", e?.message ?? String(e));
  }
  if (llamaOk) line(true, "node-llama-cpp import", `v${nodeLlamaCppVersion()} (getLlama + LlamaChatSession present; engine NOT initialized)`);
  if (!llamaOk) critical++;

  // 4. GPU / CUDA reachability (non-critical: could run CPU)
  const gpuEnabled = !cfg.cpu && process.env.GGUF_GPU !== "false";
  const cudaBin = ensureCudaOnPath(gpuEnabled);
  if (!gpuEnabled) {
    line(true, "GPU mode", "disabled (--cpu or GGUF_GPU=false) — CPU benchmark");
  } else {
    const smi = readNvidiaSmi();
    if (smi) line(true, "nvidia-smi", `${smi.name}, ${smi.usedMib}/${smi.totalMib} MiB used`);
    else console.log("  WARN  nvidia-smi not reachable — VRAM sampling will be null (bench still runs)");
    const cudaOk = cudaBin && fs.existsSync(cudaBin);
    if (cudaBin) line(!!cudaOk, "CUDA bin", `${cudaBin}${cudaOk ? "" : " (path does not exist)"}`);
    else console.log("  WARN  CUDA bin not resolved (GGUF_CUDA_BIN / CUDA_PATH unset) — relies on system PATH");
  }

  // 5. output dir writable
  let outOk = false;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const probe = path.join(outDir, `.selfcheck-${Math.random().toString(36).slice(2)}.tmp`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    outOk = true;
  } catch (e) {
    line(false, "output dir writable", e?.message ?? String(e));
  }
  if (outOk) line(true, "output dir writable", outDir);
  if (!outOk) critical++;

  console.log(`\n=== selfcheck ${critical === 0 ? "PASSED" : "FAILED"} (${critical} critical issue${critical === 1 ? "" : "s"}) ===`);
  console.log("Critical = models dir + node-llama-cpp import + writable output. GPU/CUDA/nvidia-smi are warnings (CPU fallback possible).");
  return critical === 0 ? 0 : 1;
}

// ─── FULL BENCHMARK RUN ────────────────────────────────────────────────────────
async function runBench(cfg, modelsDir, outDir) {
  const label = safeLabel(cfg.label);
  const gpuEnabled = !cfg.cpu && process.env.GGUF_GPU !== "false";
  const cudaBin = ensureCudaOnPath(gpuEnabled);
  if (cudaBin) console.log(`[bench] CUDA bin on PATH: ${cudaBin}`);

  const { targets, skipped } = resolveTargets(cfg, modelsDir);
  for (const s of skipped) console.log(`[bench] SKIP ${s.logical} — ${s.reason}${s.file ? " (" + s.file + ")" : ""}`);
  if (!targets.length) {
    console.error("[bench] No runnable models. Configure GGUF_* env / place .gguf files, or run --selfcheck.");
  }

  const smi0 = readNvidiaSmi();
  const hardware = {
    platform: `${os.platform()} ${os.release()}`,
    nodeVersion: process.version,
    cpu: os.cpus?.()[0]?.model ?? "unknown",
    cpuCores: os.cpus?.().length ?? null,
    totalMemGb: round(os.totalmem() / 1024 / 1024 / 1024),
    gpuName: smi0?.name ?? null,
    vramTotalMib: smi0?.totalMib ?? null,
    vramUsedBaselineMib: smi0?.usedMib ?? null,
  };

  const { getLlama, LlamaChatSession } = await importLlama();
  const llama = await getLlama({ gpu: gpuEnabled ? "auto" : false });

  const engineMeta = {
    nodeLlamaCppVersion: nodeLlamaCppVersion(),
    gpuMode: gpuEnabled ? "auto (CUDA/Vulkan)" : "cpu",
  };

  const modelResults = [];
  for (const t of targets) {
    console.log(`\n[bench] ===== ${t.key} (${path.basename(t.path)}) =====`);
    const vramSamples = [];
    const sampleVram = (tag) => {
      const s = readNvidiaSmi();
      if (s) vramSamples.push({ tag, usedMib: s.usedMib });
      // Also try the engine's own VRAM state (best-effort).
    };
    const baseUsed = smi0?.usedMib ?? null;

    const entry = {
      logical: t.key,
      type: t.type,
      fim: !!t.fim,
      file: path.basename(t.path),
      modelId: path.basename(t.path, ".gguf"),
      env: t.env,
      present: true,
      sizeBytes: t.sizeBytes,
      sizeGb: round(t.sizeBytes / 1024 / 1024 / 1024),
    };

    let model = null;
    try {
      sampleVram("before-load");
      const tLoad0 = now();
      model = await llama.loadModel({ modelPath: t.path, gpuLayers: gpuEnabled ? "max" : 0 });
      const tLoad1 = now();
      entry.loadTimeMs = round(tLoad1 - tLoad0);
      console.log(`[bench] loaded in ${entry.loadTimeMs}ms`);
      sampleVram("after-load");

      // engine-reported VRAM (node-llama-cpp getVramState) — best-effort
      try {
        const vs = await llama.getVramState();
        if (vs && typeof vs.used === "number") {
          entry.engineVram = {
            totalMib: round(vs.total / 1024 / 1024),
            usedMib: round(vs.used / 1024 / 1024),
            freeMib: round(vs.free / 1024 / 1024),
          };
        }
      } catch { /* best-effort */ }

      if (t.type === "embed") {
        const r = await benchEmbedModel(model, cfg, sampleVram);
        Object.assign(entry, r);
      } else {
        const r = await benchTextModel(llama, LlamaChatSession, model, cfg, sampleVram);
        entry.contextSize = r.contextSize;
        entry.results = r.results;
        // Log a quick summary
        for (const res of r.results) {
          console.log(
            `[bench]   prefill@${res.prefillTargetTokens} (${res.promptTokens}tok): ` +
              `prefill ${res.prefillTokPerSec.median} tok/s, decode ${res.decodeTokPerSec.median} tok/s`,
          );
        }
      }

      // Peak / delta VRAM from samples.
      if (vramSamples.length) {
        const peak = Math.max(...vramSamples.map((s) => s.usedMib));
        entry.vram = {
          baselineUsedMib: baseUsed,
          peakUsedMib: peak,
          modelDeltaMib: baseUsed != null ? peak - baseUsed : null,
          samples: vramSamples,
        };
      } else {
        entry.vram = { baselineUsedMib: baseUsed, peakUsedMib: null, modelDeltaMib: null, samples: [] };
      }
    } catch (e) {
      entry.error = e?.message ?? String(e);
      console.error(`[bench] ERROR benchmarking ${t.key}: ${entry.error}`);
    } finally {
      if (model) { try { await model.dispose(); } catch { /* best-effort */ } }
    }
    modelResults.push(entry);
  }

  const report = {
    schemaVersion: SCHEMA_VERSION,
    label,
    startedAt: (() => { try { return new Date().toISOString(); } catch { return null; } })(),
    hardware,
    engine: engineMeta,
    config: {
      warmup: cfg.warmup,
      iters: cfg.iters,
      maxTokens: cfg.maxTokens,
      prefillTargetTokens: cfg.prefill,
      ctxOverride: cfg.ctx,
      gpu: gpuEnabled,
      modelsDir,
    },
    models: modelResults,
    skipped,
  };

  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${label}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\n[bench] baseline written: ${outFile}`);
  console.log(`[bench] ${modelResults.filter((m) => !m.error).length}/${modelResults.length} model(s) benchmarked, ${skipped.length} skipped.`);
  return 0;
}

// ─── Entry ─────────────────────────────────────────────────────────────────────
async function main() {
  // Load repo-root .env (best-effort; selfcheck must still work without dotenv).
  try { await import("dotenv/config"); } catch { /* dotenv optional */ }

  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) {
    console.log(fs.readFileSync(path.join(__dirname, "README.md"), "utf8"));
    return 0;
  }
  const modelsDir = resolveModelsDir();
  const outDir = cfg.out ? path.resolve(cfg.out) : path.join(__dirname, "baselines");

  return cfg.selfcheck
    ? runSelfcheck(cfg, modelsDir, outDir)
    : runBench(cfg, modelsDir, outDir);
}

main()
  .then((code) => process.exit(typeof code === "number" ? code : 0))
  .catch((err) => { console.error("[bench] fatal:", err?.stack ?? err); process.exit(1); });
