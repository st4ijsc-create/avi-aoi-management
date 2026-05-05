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
  config: GgufModelConfig;
  loadedAt: Date;
  lastUsedAt: Date;
  useCount: number;
}

const loadedModels = new Map<string, LoadedModel>();
let llamaInstance: any = null;

const GGUF_MODELS_DIR = process.env.GGUF_MODELS_DIR
  ? path.resolve(process.env.GGUF_MODELS_DIR)
  : path.join(process.cwd(), "uploads", "gguf-models");

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
    sequences: 4,
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
 * Get or load a model — loads from default path if not already in memory
 */
async function getOrLoadModel(modelId?: string): Promise<{ modelId: string; loaded: LoadedModel }> {
  if (modelId && loadedModels.has(modelId)) {
    const loaded = loadedModels.get(modelId)!;
    loaded.lastUsedAt = new Date();
    loaded.useCount++;
    return { modelId, loaded };
  }

  // If no specific model requested, try the default or first available
  if (!modelId) {
    // Check if any model is already loaded
    if (loadedModels.size > 0) {
      const [firstId, firstModel] = loadedModels.entries().next().value!;
      firstModel.lastUsedAt = new Date();
      firstModel.useCount++;
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
    });

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
  }
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
  }
}

// ─── Specialized AOI Functions ─────────────────────────────────

/**
 * Count tokens accurately using the model's tokenizer
 */
export async function countTokens(text: string, modelId?: string): Promise<number> {
  const { loaded } = await getOrLoadModel(modelId);
  const tokens = loaded.model.tokenize(text);
  return tokens.length;
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
    });

    // Drain tokens as they arrive
    while (!isDone) {
      if (tokenQueue.length > 0) {
        const token = tokenQueue.shift()!;
        yield { type: "token", token };
      } else {
        // Wait for next token or completion
        const result = await Promise.race([
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

  const result = await generateText({
    systemPrompt,
    prompt,
    maxTokens: 1024,
    temperature: 0.3,
    jsonMode: true,
  }, modelId);

  try {
    return JSON.parse(result.text);
  } catch {
    return {
      summary: result.text,
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
  config: GgufModelConfig;
}> {
  return Array.from(loadedModels.entries()).map(([id, m]) => ({
    modelId: id,
    loadedAt: m.loadedAt,
    lastUsedAt: m.lastUsedAt,
    useCount: m.useCount,
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
  gpuMode: string;
  modelsDir: string;
}> {
  const engineReady = !!llamaInstance;
  ensureModelsDir();
  const available = fs.readdirSync(GGUF_MODELS_DIR).filter(f => f.endsWith(".gguf")).length;

  return {
    operational: engineReady && loadedModels.size > 0,
    engineReady,
    modelsLoaded: loadedModels.size,
    modelsAvailable: available,
    gpuMode: process.env.GGUF_GPU === "false" ? "cpu" : "auto (CUDA/Vulkan)",
    modelsDir: GGUF_MODELS_DIR,
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
  const { modelId: resolvedId, loaded } = await getOrLoadModel(modelId);

  const { LlamaEmbeddingContext } = await import("node-llama-cpp");
  const embeddingContext = new LlamaEmbeddingContext({ model: loaded.model });
  try {
    const embedding = await embeddingContext.getEmbeddingFor(text);
    const vector = Array.from(embedding.vector as Float32Array);
    return {
      embedding: vector,
      dimensions: vector.length,
      modelId: resolvedId,
    };
  } finally {
    await embeddingContext.dispose();
  }
}

/**
 * Generate embeddings for multiple texts in batch.
 */
export async function generateEmbeddings(
  texts: string[],
  modelId?: string,
): Promise<{ embeddings: number[][]; dimensions: number; modelId: string }> {
  const { modelId: resolvedId, loaded } = await getOrLoadModel(modelId);

  const { LlamaEmbeddingContext } = await import("node-llama-cpp");
  const embeddingContext = new LlamaEmbeddingContext({ model: loaded.model });
  try {
    const embeddings: number[][] = [];
    let dims = 0;
    for (const text of texts) {
      const result = await embeddingContext.getEmbeddingFor(text);
      const vec = Array.from(result.vector as Float32Array);
      embeddings.push(vec);
      if (!dims) dims = vec.length;
    }
    return { embeddings, dimensions: dims, modelId: resolvedId };
  } finally {
    await embeddingContext.dispose();
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
