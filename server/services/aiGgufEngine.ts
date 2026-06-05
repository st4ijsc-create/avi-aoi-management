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
import { withGgufSlot, withGgufSlotGenerator, getGgufQueueStats } from "./ggufConcurrency";

// ─── Types ─────────────────────────────────────────────────────

export interface GgufModelConfig {
  /** Model file path (absolute or relative to uploads) */
  modelPath: string;
  /** Context size in tokens. Default 4096 */
  contextSize?: number;
  /** Number of GPU layers to offload (-1 = all). Default -1 */
  gpuLayers?: number;
  /** Number of threads for CPU inference. Default: auto */
  threads?: number;
  /** Batch size for prompt processing. Default 512 */
  batchSize?: number;
  /** Enable Flash Attention. Default true */
  flashAttention?: boolean;
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
}

const loadedModels = new Map<string, LoadedModel>();
let llamaInstance: any = null;

const GGUF_MODELS_DIR = process.env.GGUF_MODELS_DIR
  ? path.resolve(process.env.GGUF_MODELS_DIR)
  : path.join(process.cwd(), "uploads", "gguf-models");

// ─── Config from env ───────────────────────────────────────────

/** Dedicated embedding model id (e.g. mxbai). When generateEmbedding is called without a modelId,
 * this is used so we never fall back to the text model (Qwen), which would return wrong dimensions. */
const GGUF_EMBED_MODEL = process.env.GGUF_EMBED_MODEL || "";
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
/** Number of parallel sequences per context. Default 4. */
const GGUF_SEQUENCES = (() => {
  const n = parseInt(process.env.GGUF_SEQUENCES || "4", 10);
  return Number.isFinite(n) && n > 0 ? n : 4;
})();

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

  try {
    const { getLlama: initLlama } = await import("node-llama-cpp");
    llamaInstance = await initLlama({
      gpu: process.env.GGUF_GPU === "false" ? false : "auto",
    });
    console.log("[aiGgufEngine] llama.cpp engine initialized (GPU:", process.env.GGUF_GPU !== "false" ? "auto" : "disabled", ")");
    return llamaInstance;
  } catch (err) {
    console.error("[aiGgufEngine] Failed to initialize llama.cpp:", err);
    throw new Error("node-llama-cpp is not available. Install with: pnpm add node-llama-cpp");
  }
}

// ─── LRU eviction & memory guard ───────────────────────────────

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
 * Evicts the LRU idle model(s). If no idle candidate exists (all in use), logs a warning
 * and allows a temporary overflow rather than throwing.
 */
async function ensureCapacity(): Promise<void> {
  // Count-based cap: make room so that loading one more stays within the limit.
  let guard = 0;
  while (loadedModels.size >= GGUF_MAX_LOADED_MODELS && guard++ < loadedModels.size + 1) {
    const evicted = await evictLRU();
    if (!evicted) {
      console.warn(
        `[aiGgufEngine] At capacity (${loadedModels.size}/${GGUF_MAX_LOADED_MODELS}) but all models are in use (refCount>0); allowing temporary overflow.`,
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
            `[aiGgufEngine] VRAM used (${Math.round((vram.used) / 1024 / 1024)}MB) over cap (${GGUF_MAX_VRAM_MB}MB) but no idle model to evict; allowing temporary overflow.`,
          );
          break;
        }
      }
    } catch (err) {
      // getVramState unsupported / failed — VRAM cap is best-effort only.
      console.warn("[aiGgufEngine] getVramState failed; skipping VRAM cap enforcement:", (err as any)?.message ?? err);
    }
  }
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

  const llama = await getLlama();

  // Free memory before loading another model (LRU + VRAM guard).
  await ensureCapacity();

  console.log(`[aiGgufEngine] Loading model: ${resolvedPath}`);
  const startTime = Date.now();

  const model = await llama.loadModel({
    modelPath: resolvedPath,
    gpuLayers: config.gpuLayers ?? -1,
  });

  const context = await model.createContext({
    contextSize: config.contextSize ?? 4096,
    batchSize: config.batchSize ?? 512,
    flashAttention: config.flashAttention !== false,
    sequences: GGUF_SEQUENCES,
  });

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
  });

  return modelId;
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
    await loaded.context.dispose();
    await loaded.model.dispose();
    loadedModels.delete(modelId);
    console.log(`[aiGgufEngine] Model unloaded: ${modelId}`);
    return true;
  } catch (err) {
    console.error(`[aiGgufEngine] Error unloading model ${modelId}:`, err);
    loadedModels.delete(modelId);
    return false;
  }
}

/**
 * Release an in-flight reference acquired via getOrLoadModel().
 * Call in a `finally` block so eviction can reclaim the model once idle.
 */
function releaseModel(loaded: LoadedModel | undefined): void {
  if (loaded && loaded.refCount > 0) loaded.refCount--;
}

/**
 * Get or load a model — loads from default path if not already in memory
 */
async function getOrLoadModel(modelId?: string): Promise<{ modelId: string; loaded: LoadedModel }> {
  if (modelId && loadedModels.has(modelId)) {
    const loaded = loadedModels.get(modelId)!;
    loaded.lastUsedAt = new Date();
    loaded.useCount++;
    loaded.refCount++;
    return { modelId, loaded };
  }

  // If no specific model requested, try the default or first available
  if (!modelId) {
    // Check if any model is already loaded
    if (loadedModels.size > 0) {
      const [firstId, firstModel] = loadedModels.entries().next().value!;
      firstModel.lastUsedAt = new Date();
      firstModel.useCount++;
      firstModel.refCount++;
      return { modelId: firstId as string, loaded: firstModel };
    }

    // Try to auto-load the default model from env
    const defaultModel = process.env.GGUF_DEFAULT_MODEL;
    if (defaultModel) {
      const id = await loadGgufModel({ modelPath: defaultModel });
      return getOrLoadModel(id);
    }

    // Try first .gguf file in models directory
    ensureModelsDir();
    const files = fs.readdirSync(GGUF_MODELS_DIR).filter(f => f.endsWith(".gguf"));
    if (files.length > 0) {
      const id = await loadGgufModel({ modelPath: files[0] });
      return getOrLoadModel(id);
    }

    throw new Error("No GGUF model available. Upload a .gguf file or set GGUF_DEFAULT_MODEL env var.");
  }

  // Try to load the specified model
  const id = await loadGgufModel({ modelPath: `${modelId}.gguf` });
  return getOrLoadModel(id);
}

// ─── Text Generation ───────────────────────────────────────────

/**
 * Generate text using a loaded GGUF model
 */
export async function generateText(options: GgufGenerateOptions, modelId?: string): Promise<GgufGenerateResult> {
  const { modelId: resolvedId, loaded } = await getOrLoadModel(modelId);
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
      releaseModel(loaded);
    }
  });
}

/**
 * Chat completion with message history
 */
export async function chatCompletion(options: GgufChatOptions, modelId?: string): Promise<GgufGenerateResult> {
  const { modelId: resolvedId, loaded } = await getOrLoadModel(modelId);
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
      releaseModel(loaded);
    }
  });
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
  const { modelId: resolvedId, loaded } = await getOrLoadModel(modelId);
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
      releaseModel(loaded);
    }
  });
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
  const { loaded } = await getOrLoadModel(modelId);
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
  const { modelId: resolvedId, loaded } = await getOrLoadModel(modelId);
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
  yield* withGgufSlotGenerator<GgufStreamChunk>(async function* () {
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
      releaseModel(loaded);
    }
  });
}

/**
 * Streaming chat completion — yields token-by-token via async generator
 */
export async function* chatCompletionStream(
  options: GgufChatOptions,
  modelId?: string,
  signal?: AbortSignal,
): AsyncGenerator<GgufStreamChunk> {
  const { modelId: resolvedId, loaded } = await getOrLoadModel(modelId);
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
  yield* withGgufSlotGenerator<GgufStreamChunk>(async function* () {
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
      releaseModel(loaded);
    }
  });
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
    ? `Bạn là chuyên gia phân tích chất lượng trong nhà máy sản xuất AOI/AVI. Phân tích ngắn gọn và chính xác về lỗi kiểm tra.`
    : `You are a quality analysis expert in an AOI/AVI manufacturing factory. Provide concise and accurate defect analysis.`;

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
  const effectiveId = modelId ?? (GGUF_EMBED_MODEL || undefined);
  const { modelId: resolvedId, loaded } = await getOrLoadModel(effectiveId);

  // Mục 4: embeddings are light but still share the single GGUF slot to keep the
  // 6GB VRAM budget simple and safe.
  return withGgufSlot(async () => {
    try {
      const embeddingContext = await getEmbeddingContext(loaded);
      const embedding = await embeddingContext.getEmbeddingFor(text);
      const vector = Array.from(embedding.vector as readonly number[]);
      assertEmbeddingDim(vector.length, resolvedId);
      return {
        embedding: vector,
        dimensions: vector.length,
        modelId: resolvedId,
      };
    } finally {
      releaseModel(loaded);
    }
  });
}

/**
 * Generate embeddings for multiple texts in batch.
 */
export async function generateEmbeddings(
  texts: string[],
  modelId?: string,
): Promise<{ embeddings: number[][]; dimensions: number; modelId: string }> {
  const effectiveId = modelId ?? (GGUF_EMBED_MODEL || undefined);
  const { modelId: resolvedId, loaded } = await getOrLoadModel(effectiveId);

  // Mục 4: batch embeddings hold the single GGUF slot for the whole loop.
  return withGgufSlot(async () => {
    try {
      const embeddingContext = await getEmbeddingContext(loaded);
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
      releaseModel(loaded);
    }
  });
}

/**
 * Lazily create (and cache on the LoadedModel) an embedding context for the given model.
 * Uses model.createEmbeddingContext (the public API in node-llama-cpp 3.18.1 — the
 * LlamaEmbeddingContext constructor is private). The context is created once and reused;
 * it is disposed when the model is unloaded.
 */
async function getEmbeddingContext(loaded: LoadedModel): Promise<any> {
  if (loaded.embeddingContext) return loaded.embeddingContext;
  try {
    loaded.embeddingContext = await loaded.model.createEmbeddingContext({
      contextSize: "auto",
      batchSize: loaded.config.batchSize ?? 512,
    });
  } catch (err: any) {
    throw new Error(
      `Model does not support embeddings (createEmbeddingContext failed: ${err?.message ?? err}). ` +
        `Set GGUF_EMBED_MODEL to point to an embedding model such as mxbai-embed-large. ` +
        `[VI] Mô hình không hỗ trợ embedding — cấu hình GGUF_EMBED_MODEL trỏ tới mxbai.`,
    );
  }
  return loaded.embeddingContext;
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

// ─── Utilities ─────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
