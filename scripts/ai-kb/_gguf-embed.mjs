/**
 * WS-G4 — Self-contained GGUF embedding helper for build/backfill scripts.
 *
 * Loads node-llama-cpp directly (no server runtime) and embeds text with the
 * dedicated mxbai embedding model, so KB/image embeddings can be (re)generated
 * offline without an Ollama daemon. Uses the SAME mxbai GGUF the server uses →
 * vectors land in the same 1024-dim space as the existing corpus.
 *
 * node-llama-cpp 3.18.x API used here:
 *   getLlama() → llama.loadModel({ modelPath }) → model.createEmbeddingContext()
 *   → ctx.getEmbeddingFor(text) → { vector }
 * (createEmbeddingContext is the public factory; the LlamaEmbeddingContext
 *  constructor is private — do NOT `new` it.)
 *
 * ENV:
 *   GGUF_MODELS_DIR   (default ./uploads/gguf-models) — directory holding .gguf files
 *   GGUF_EMBED_MODEL  (default mxbai-embed-large-v1-f16.gguf) — embedding model filename
 *   GGUF_GPU          ("false" → CPU only; otherwise auto CUDA/Vulkan)
 *
 * Exports:
 *   embedTextGguf(text) → Promise<number[]>  (L2-normalized unit vector)
 *   disposeGgufEmbed()  → Promise<void>       (free model/context at end of a batch)
 */
import path from "node:path";
import fs from "node:fs";

const GGUF_MODELS_DIR = process.env.GGUF_MODELS_DIR
  ? path.resolve(process.env.GGUF_MODELS_DIR)
  : path.join(process.cwd(), "uploads", "gguf-models");

// Allow the env value with or without a ".gguf" extension.
const GGUF_EMBED_MODEL_FILE = (() => {
  const raw = process.env.GGUF_EMBED_MODEL || "mxbai-embed-large-v1-f16.gguf";
  return raw.endsWith(".gguf") ? raw : `${raw}.gguf`;
})();

function resolveEmbedModelPath() {
  // Absolute path?
  if (path.isAbsolute(GGUF_EMBED_MODEL_FILE) && fs.existsSync(GGUF_EMBED_MODEL_FILE)) {
    return GGUF_EMBED_MODEL_FILE;
  }
  const inDir = path.join(GGUF_MODELS_DIR, GGUF_EMBED_MODEL_FILE);
  if (fs.existsSync(inDir)) return inDir;
  throw new Error(
    `GGUF embedding model not found: ${GGUF_EMBED_MODEL_FILE} ` +
      `(looked in ${GGUF_MODELS_DIR}). Set GGUF_MODELS_DIR / GGUF_EMBED_MODEL.`,
  );
}

// ─── Singletons (one model + one embedding context per process) ───────────────
let _llama = null;
let _model = null;
let _embedCtx = null;

async function getEmbedContext() {
  if (_embedCtx) return _embedCtx;

  let getLlama;
  try {
    ({ getLlama } = await import("node-llama-cpp"));
  } catch (e) {
    throw new Error(
      `node-llama-cpp not available (${e?.message ?? e}). Install with: pnpm add node-llama-cpp`,
    );
  }

  _llama = await getLlama({ gpu: process.env.GGUF_GPU === "false" ? false : "auto" });
  const modelPath = resolveEmbedModelPath();
  _model = await _llama.loadModel({ modelPath, gpuLayers: -1 });
  // Public factory in node-llama-cpp v3 (do NOT `new LlamaEmbeddingContext`).
  _embedCtx = await _model.createEmbeddingContext({ contextSize: "auto" });
  return _embedCtx;
}

function l2norm(vec) {
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/**
 * Embed a single string → L2-normalized number[] in the mxbai 1024-dim space.
 */
export async function embedTextGguf(text) {
  const ctx = await getEmbedContext();
  const result = await ctx.getEmbeddingFor(text);
  const vec = Array.from(result.vector);
  if (!vec.length) throw new Error("GGUF getEmbeddingFor returned empty vector");
  return l2norm(vec);
}

/** Free the loaded model + embedding context (call once a batch finishes). */
export async function disposeGgufEmbed() {
  try {
    if (_embedCtx) await _embedCtx.dispose();
  } catch {
    /* best-effort */
  }
  try {
    if (_model) await _model.dispose();
  } catch {
    /* best-effort */
  }
  _embedCtx = null;
  _model = null;
  _llama = null;
}

/** The model filename this helper embeds with (for meta.model). */
export function ggufEmbedModelName() {
  return path.basename(GGUF_EMBED_MODEL_FILE, ".gguf");
}
