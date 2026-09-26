#!/usr/bin/env node
/**
 * scripts/ai-bench/bench-longctx.mjs — G0/B Nhiệm vụ 1: ĐO CTX DÀI (2k → 32k).
 *
 * VÌ SAO CẦN FILE RIÊNG (bench.mjs KHÔNG đủ):
 *   bench.mjs tạo MỘT context duy nhất, kích thước = max(prefill)+maxTokens+512, rồi chạy MỌI
 *   mức prefill trong context đó. Muốn biết "VRAM ở ctx 8k so với ctx 32k" thì phải tạo context
 *   RIÊNG cho từng mức — đúng như production làm (loadGgufModel → resolveContextSize(config
 *   .contextSize) mỗi lần nạp). File này giữ NGUYÊN mọi tham số production
 *   (batchSize 512 · flashAttention true · sequences=GGUF_SEQUENCES) và chỉ thay đổi ctx.
 *
 * ⚠ SỰ THẬT QUAN TRỌNG VỀ node-llama-cpp (đọc từ node_modules/node-llama-cpp/dist/evaluator/
 *   LlamaContext/LlamaContext.js:106):
 *       contextSize: padSafeContextSize(this._contextSize * this._totalSequences, "up")
 *   ⇒ `contextSize` là PER-SEQUENCE. Tổng ô KV thật = contextSize × sequences.
 *   Production dùng sequences=4 ⇒ xin ctx 32768 nghĩa là cấp phát KV cho 131.072 token.
 *
 * KHÔNG import server/ (giống bench.mjs) — chạy được bằng `node` thuần, không cần boot app.
 *
 * RUN:
 *   node scripts/ai-bench/bench-longctx.mjs --model deep --levels 2048,4096,8192,16384,31000 \
 *        --sequences 4,1 --iters 2 --warmup 1 --maxTokens 96 --label longctx-2026-08-16
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const now = () => (typeof performance?.now === "function" ? performance.now() : Date.now());
const round = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);

const LOGICAL_ENV = { deep: "GGUF_DEFAULT_MODEL", fast: "GGUF_FAST_MODEL", code: "GGUF_CODE_MODEL", fim: "GGUF_FIM_MODEL" };

function parseArgs(argv) {
  const a = {
    model: "deep",
    levels: [2048, 4096, 8192, 16384, 31000],
    sequences: [4],
    iters: 2,
    warmup: 1,
    maxTokens: 96,
    label: null,
    out: null,
    cpu: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    switch (t) {
      case "--model": a.model = next(); break;
      case "--levels": a.levels = next().split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0); break;
      case "--sequences": a.sequences = next().split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0); break;
      case "--iters": a.iters = Math.max(1, parseInt(next(), 10) || 1); break;
      case "--warmup": a.warmup = Math.max(0, parseInt(next(), 10) || 0); break;
      case "--maxTokens": a.maxTokens = Math.max(1, parseInt(next(), 10) || 1); break;
      case "--label": a.label = next(); break;
      case "--out": a.out = next(); break;
      case "--cpu": a.cpu = true; break;
      default: if (t.startsWith("--")) console.warn(`[longctx] unknown flag ignored: ${t}`);
    }
  }
  return a;
}

// production parity: aiGgufEngine.ts ~225-231
const PROD_GGUF_MAX_CTX = (() => {
  const n = parseInt(process.env.GGUF_MAX_CTX || "32768", 10);
  return Number.isFinite(n) && n > 0 ? n : 32768;
})();
const PROD_GGUF_DEFAULT_CTX = (() => {
  const n = parseInt(process.env.GGUF_DEFAULT_CTX || "4096", 10);
  return Number.isFinite(n) && n > 0 ? n : 4096;
})();
const prodResolveContextSize = (req) =>
  typeof req !== "number" || !Number.isFinite(req) || req <= 0
    ? PROD_GGUF_DEFAULT_CTX
    : Math.min(Math.max(Math.floor(req), 256), PROD_GGUF_MAX_CTX);

function readNvidiaSmi() {
  try {
    const out = execFileSync("nvidia-smi", ["--query-gpu=name,memory.total,memory.used", "--format=csv,noheader,nounits"], { timeout: 5000, windowsHide: true }).toString();
    const p = (out.split(/\r?\n/).find((l) => l.trim()) || "").split(",").map((s) => s.trim());
    const totalMib = parseInt(p[1], 10), usedMib = parseInt(p[2], 10);
    if (Number.isFinite(totalMib) && Number.isFinite(usedMib)) return { name: p[0], totalMib, usedMib };
  } catch { /* no gpu */ }
  return null;
}

function stats(nums) {
  const arr = nums.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!arr.length) return { n: 0, mean: null, median: null, min: null, max: null };
  const mid = Math.floor(arr.length / 2);
  return {
    n: arr.length,
    mean: round(arr.reduce((x, y) => x + y, 0) / arr.length),
    median: round(arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2),
    min: round(arr[0]), max: round(arr[arr.length - 1]),
  };
}

function ensureCudaOnPath(gpu) {
  if (!gpu) return null;
  const bin = process.env.GGUF_CUDA_BIN || (process.env.CUDA_PATH ? `${process.env.CUDA_PATH}\\bin` : "");
  if (bin && !(process.env.PATH || "").includes(bin)) process.env.PATH = `${bin};${process.env.PATH || ""}`;
  return bin || null;
}

const SYSTEM_PROMPT = "You are a senior industrial automation, PLC and robotics programming engineer.";
const TASK_SUFFIX = "\n\nTask: Write a well-structured function that computes a moving average over a sensor ring buffer, and briefly explain the approach.";
const FILLER = "Consider the manufacturing line context, cycle-time budget, safety interlocks and I/O mapping carefully. ";

/** Prompt padded to ~targetTokens using the model tokenizer (doubling search, then linear top-up). */
function buildPrompt(model, targetTokens) {
  const fillerTokens = Math.max(1, model.tokenize(FILLER).length);
  let reps = Math.max(0, Math.floor((targetTokens - model.tokenize(TASK_SUFFIX).length) / fillerTokens));
  let body = FILLER.repeat(reps);
  let guard = 0;
  while (model.tokenize(body + TASK_SUFFIX).length < targetTokens && guard++ < 200000) body += FILLER;
  return body + TASK_SUFFIX;
}

async function main() {
  try { await import("dotenv/config"); } catch { /* optional */ }
  const cfg = parseArgs(process.argv.slice(2));
  const gpu = !cfg.cpu && process.env.GGUF_GPU !== "false";
  ensureCudaOnPath(gpu);

  const modelsDir = process.env.GGUF_MODELS_DIR ? path.resolve(process.env.GGUF_MODELS_DIR) : path.join(process.cwd(), "uploads", "gguf-models");
  const envKey = LOGICAL_ENV[cfg.model];
  const nameOrPath = envKey ? (process.env[envKey] || "").trim() : cfg.model;
  if (!nameOrPath) throw new Error(`no model configured (${envKey || cfg.model})`);
  const file = /\.gguf$/i.test(nameOrPath) ? nameOrPath : `${nameOrPath}.gguf`;
  const modelPath = path.isAbsolute(file) && fs.existsSync(file) ? file : path.join(modelsDir, file);
  if (!fs.existsSync(modelPath)) throw new Error(`model file not found: ${modelPath}`);

  const smi0 = readNvidiaSmi();
  console.log(`[longctx] baseline VRAM used=${smi0?.usedMib} / ${smi0?.totalMib} MiB`);
  console.log(`[longctx] model: ${modelPath}`);

  const { getLlama, LlamaChatSession } = await import("node-llama-cpp");
  const tL0 = now();
  const llama = await getLlama({ gpu: gpu ? "auto" : false });
  const smiAfterBackend = readNvidiaSmi();
  console.log(`[longctx] CUDA backend up in ${round(now() - tL0)}ms — VRAM used=${smiAfterBackend?.usedMib} MiB`);

  const tM0 = now();
  const model = await llama.loadModel({ modelPath, gpuLayers: gpu ? "max" : 0 });
  const modelLoadMs = round(now() - tM0);
  const trainContextSize = model.trainContextSize ?? null;
  const modelSizeGb = round(fs.statSync(modelPath).size / 1024 ** 3);
  const smiAfterModel = readNvidiaSmi();
  console.log(`[longctx] model loaded in ${modelLoadMs}ms — VRAM used=${smiAfterModel?.usedMib} MiB (trainCtx=${model.trainContextSize})`);

  const levelResults = [];
  for (const seqCount of cfg.sequences) {
    for (const level of cfg.levels) {
      const requestedCtx = prodResolveContextSize(level + cfg.maxTokens + 512);
      const rec = {
        promptTargetTokens: level,
        sequences: seqCount,
        requestedContextSize: requestedCtx,
        totalKvCells: requestedCtx * seqCount,
        vramBeforeCtxMib: readNvidiaSmi()?.usedMib ?? null,
      };
      console.log(`\n[longctx] ── level ${level} tok · sequences=${seqCount} · ctx=${requestedCtx} (KV cells ${requestedCtx * seqCount}) ──`);
      let context = null;
      try {
        const tC0 = now();
        context = await model.createContext({
          contextSize: requestedCtx,
          batchSize: 512,
          flashAttention: true,
          sequences: seqCount,
          failedCreationRemedy: false, // KHÔNG tự thu nhỏ ctx — nếu không đủ VRAM thì phải BÁO, không được im lặng đổi số đo
        });
        rec.contextCreateMs = round(now() - tC0);
        rec.actualContextSize = context.contextSize;
        rec.vramAfterCtxMib = readNvidiaSmi()?.usedMib ?? null;
        rec.kvCacheDeltaMib = rec.vramBeforeCtxMib != null && rec.vramAfterCtxMib != null ? rec.vramAfterCtxMib - rec.vramBeforeCtxMib : null;
        console.log(`[longctx]   ctx created in ${rec.contextCreateMs}ms · actualCtx=${rec.actualContextSize} · VRAM ${rec.vramBeforeCtxMib}→${rec.vramAfterCtxMib} MiB (Δ${rec.kvCacheDeltaMib})`);

        const promptText = buildPrompt(model, level);
        rec.promptTokens = model.tokenize(SYSTEM_PROMPT + "\n\n" + promptText).length;
        console.log(`[longctx]   prompt tokens (system+user) = ${rec.promptTokens}`);

        const runOnce = async () => {
          const seq = context.getSequence();
          const session = new LlamaChatSession({ contextSequence: seq, systemPrompt: SYSTEM_PROMPT });
          try {
            const t0 = now();
            let tFirst = null;
            const response = await session.prompt(promptText, {
              maxTokens: cfg.maxTokens,
              temperature: 0,
              onTextChunk() { if (tFirst === null) tFirst = now(); },
            });
            const t1 = now();
            const genTokens = model.tokenize(response).length;
            const ttftMs = tFirst === null ? t1 - t0 : tFirst - t0;
            const decodeMs = Math.max(0.001, t1 - (tFirst === null ? t0 : tFirst));
            return { ttftMs, totalMs: t1 - t0, decodeMs, genTokens };
          } finally { seq.dispose(); }
        };

        for (let w = 0; w < cfg.warmup; w++) { await runOnce(); }
        const peaks = [rec.vramAfterCtxMib];
        const runs = [];
        for (let i = 0; i < cfg.iters; i++) {
          const r = await runOnce();
          r.prefillTokPerSec = r.ttftMs > 0 ? (rec.promptTokens / r.ttftMs) * 1000 : null;
          r.decodeTokPerSec = r.decodeMs > 0 ? (r.genTokens / r.decodeMs) * 1000 : null;
          runs.push(r);
          peaks.push(readNvidiaSmi()?.usedMib ?? null);
          console.log(`[longctx]     iter${i}: TTFT ${round(r.ttftMs)}ms · prefill ${round(r.prefillTokPerSec)} tok/s · decode ${round(r.decodeTokPerSec)} tok/s · total ${round(r.totalMs)}ms`);
        }
        rec.ttftMs = stats(runs.map((r) => r.ttftMs));
        rec.prefillTokPerSec = stats(runs.map((r) => r.prefillTokPerSec));
        rec.decodeTokPerSec = stats(runs.map((r) => r.decodeTokPerSec));
        rec.totalMs = stats(runs.map((r) => r.totalMs));
        rec.genTokens = stats(runs.map((r) => r.genTokens));
        rec.vramPeakMib = Math.max(...peaks.filter((n) => Number.isFinite(n)));
        rec.rawIters = runs.map((r) => ({ ttftMs: round(r.ttftMs), totalMs: round(r.totalMs), decodeMs: round(r.decodeMs), genTokens: r.genTokens, prefillTokPerSec: round(r.prefillTokPerSec), decodeTokPerSec: round(r.decodeTokPerSec) }));
        rec.ok = true;
      } catch (e) {
        rec.ok = false;
        rec.error = e?.message ?? String(e);
        rec.vramAtFailureMib = readNvidiaSmi()?.usedMib ?? null;
        console.error(`[longctx]   FAILED at level ${level} / sequences=${seqCount}: ${rec.error}`);
      } finally {
        if (context) { try { await context.dispose(); } catch { /* best-effort */ } }
      }
      levelResults.push(rec);
    }
  }

  try { await model.dispose(); } catch { /* best-effort */ }
  const smiEnd = readNvidiaSmi();

  const label = (cfg.label || `longctx-${new Date().toISOString().replace(/[:.]/g, "-")}`).replace(/[^\w.\-]+/g, "_");
  const outDir = cfg.out ? path.resolve(cfg.out) : path.join(__dirname, "baselines");
  fs.mkdirSync(outDir, { recursive: true });
  const report = {
    schemaVersion: 1,
    kind: "longctx",
    label,
    startedAt: new Date().toISOString(),
    note: "contextSize trong node-llama-cpp là PER-SEQUENCE: tổng ô KV = contextSize × sequences (LlamaContext.js:106).",
    hardware: {
      platform: `${os.platform()} ${os.release()}`, nodeVersion: process.version,
      cpu: os.cpus?.()[0]?.model ?? "unknown", cpuCores: os.cpus?.().length ?? null,
      totalMemGb: round(os.totalmem() / 1024 / 1024 / 1024),
      gpuName: smi0?.name ?? null, vramTotalMib: smi0?.totalMib ?? null, vramUsedBaselineMib: smi0?.usedMib ?? null,
    },
    model: { path: modelPath, file: path.basename(modelPath), sizeGb: modelSizeGb, loadTimeMs: modelLoadMs, trainContextSize },
    vram: { baselineMib: smi0?.usedMib ?? null, afterCudaBackendMib: smiAfterBackend?.usedMib ?? null, afterModelLoadMib: smiAfterModel?.usedMib ?? null, afterDisposeMib: smiEnd?.usedMib ?? null },
    config: { levels: cfg.levels, sequences: cfg.sequences, iters: cfg.iters, warmup: cfg.warmup, maxTokens: cfg.maxTokens, gpu, prodDefaultCtx: PROD_GGUF_DEFAULT_CTX, prodMaxCtx: PROD_GGUF_MAX_CTX },
    levels: levelResults,
  };
  const outFile = path.join(outDir, `${label}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\n[longctx] report written: ${outFile}`);
  console.log(`[longctx] VRAM after dispose: ${smiEnd?.usedMib} MiB (baseline was ${smi0?.usedMib} MiB)`);
  return 0;
}

main().then((c) => process.exit(c || 0)).catch((e) => { console.error("[longctx] fatal:", e?.stack ?? e); process.exit(1); });
