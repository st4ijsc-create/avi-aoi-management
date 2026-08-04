/**
 * WS-G1 — Unit tests for aiGgufEngine (Tầng A: mock node-llama-cpp, no real model).
 *
 * Covers:
 *  - generateEmbedding uses model.createEmbeddingContext (NOT `new LlamaEmbeddingContext`) and returns dim 1024
 *  - embedding dimension mismatch throws a clear error
 *  - the embedding context is created once and reused (cached on LoadedModel)
 *  - generateQualityInsights returns the stable schema shape via grammar
 *  - LRU evicts by count (GGUF_MAX_LOADED_MODELS)
 *  - models with refCount > 0 are NOT evicted
 *  - unloadGgufModel disposes the cached embedding context
 *
 * node-llama-cpp + fs are fully mocked so no native binary / model file is required.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Spies shared across the mock factory ───────────────────────────────────
const createEmbeddingContextSpy = vi.fn();
const embeddingContextDisposeSpy = vi.fn();
const newEmbeddingContextCtorSpy = vi.fn(); // must NEVER be called

// Each loaded model gets its own fake; `EMBED_DIM` controls the returned vector length.
let EMBED_DIM = 1024;

function makeFakeModel(id: string) {
  const embeddingCtx = {
    getEmbeddingFor: vi.fn(async (_text: string) => ({
      vector: new Array(EMBED_DIM).fill(0).map((_, i) => i / EMBED_DIM),
    })),
    dispose: embeddingContextDisposeSpy,
  };
  createEmbeddingContextSpy.mockResolvedValue(embeddingCtx);
  return {
    __id: id,
    size: 1234,
    embeddingVectorSize: EMBED_DIM,
    tokenize: (t: string) => t.split(" "),
    createEmbeddingContext: createEmbeddingContextSpy,
    createContext: vi.fn(async () => ({
      getSequence: () => ({ dispose: vi.fn() }),
      dispose: vi.fn(),
    })),
    dispose: vi.fn(),
  };
}

const grammarObj = { parse: (s: string) => JSON.parse(s) };

const GiB = 1024 * 1024 * 1024;
const fakeLlama = {
  loadModel: vi.fn(async (opts: any) => makeFakeModel(opts.modelPath)),
  // Report a realistic IDLE GPU (total>0, ~6% used) so readVramState uses this mock
  // instead of falling through to the host's REAL nvidia-smi — otherwise the VRAM
  // guard reads whatever the machine's GPU is doing and evicts non-deterministically
  // (a `total:0` here silently made these tests flaky on GPU-busy hosts).
  getVramState: vi.fn(async () => ({ total: 32 * GiB, used: 2 * GiB, free: 30 * GiB, unifiedSize: 0 })),
  createGrammarForJsonSchema: vi.fn(async () => grammarObj),
};

// LlamaChatSession.prompt returns a valid JSON string for the quality-insights schema.
class FakeChatSession {
  constructor(_opts: any) {}
  async prompt(_p: string, _o: any) {
    return JSON.stringify({
      summary: "ok",
      trends: ["t1"],
      risks: ["r1"],
      recommendations: ["rec1"],
    });
  }
}

vi.mock("node-llama-cpp", () => ({
  getLlama: vi.fn(async () => fakeLlama),
  LlamaChatSession: FakeChatSession,
  // Exposed but must not be instantiated by the engine (constructor is private in 3.18.1).
  LlamaEmbeddingContext: class {
    constructor() {
      newEmbeddingContextCtorSpy();
    }
  },
  LlamaJsonSchemaGrammar: class {},
}));

// Mock fs so resolveModelPath / readdir succeed without real files.
vi.mock("fs", () => {
  const api = {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => [] as string[]),
    statSync: vi.fn(() => ({ size: 1234, mtime: new Date() })),
  };
  return { default: api, ...api };
});

beforeEach(() => {
  vi.clearAllMocks();
  EMBED_DIM = 1024;
  createEmbeddingContextSpy.mockResolvedValue({
    getEmbeddingFor: vi.fn(async () => ({ vector: new Array(EMBED_DIM).fill(0.1) })),
    dispose: embeddingContextDisposeSpy,
  });
  process.env.GGUF_MAX_LOADED_MODELS = "2";
  process.env.GGUF_EMBED_DIM = "1024";
  delete process.env.GGUF_MAX_VRAM_MB;
  /**
   * ★ Pha 2B Task 3 — biên chờ giữa hai lượt thử là 5.000 ms THẬT (§5.5 bước 2). File này canh
   * HÀNH VI của đường lùi, không canh biên chờ; để nguyên 5.000 thì ca dưới hết giờ ở 5.000 ms và
   * — nguy hiểm hơn — công việc còn dang dở của nó rò sang ca kế tiếp, làm hỏng bộ đếm lời gọi
   * (đo được: ca "rethrows a non-OOM error" thấy 2 lời gọi thay vì 1, KHÔNG phải vì mã sai).
   * Biên chờ mặc định được chứng minh ở ĐÚNG MỘT chỗ: `vram/threeOutcomes.test.ts` §2.
   */
  process.env.VRAM_LOAD_RETRY_DELAY_MS = "0";
});

// Import AFTER mocks. Re-import fresh each test to reset module-level loadedModels Map.
async function freshEngine() {
  vi.resetModules();
  return await import("./aiGgufEngine");
}

describe("generateEmbedding", () => {
  it("uses model.createEmbeddingContext (not `new LlamaEmbeddingContext`) and returns dim 1024", async () => {
    const eng = await freshEngine();
    const res = await eng.generateEmbedding("hello world", "embed-model");
    expect(res.dimensions).toBe(1024);
    expect(res.embedding.length).toBe(1024);
    expect(createEmbeddingContextSpy).toHaveBeenCalled();
    expect(newEmbeddingContextCtorSpy).not.toHaveBeenCalled();
  });

  it("throws a clear error when embedding dimension != GGUF_EMBED_DIM", async () => {
    EMBED_DIM = 512;
    createEmbeddingContextSpy.mockResolvedValue({
      getEmbeddingFor: vi.fn(async () => ({ vector: new Array(512).fill(0.1) })),
      dispose: embeddingContextDisposeSpy,
    });
    const eng = await freshEngine();
    await expect(eng.generateEmbedding("x", "embed-model")).rejects.toThrow(/dimension mismatch|GGUF_EMBED_MODEL/i);
  });

  it("caches the embedding context — createEmbeddingContext called once across multiple embeds", async () => {
    const eng = await freshEngine();
    await eng.generateEmbedding("a", "embed-model");
    await eng.generateEmbedding("b", "embed-model");
    await eng.generateEmbeddings(["c", "d"], "embed-model");
    expect(createEmbeddingContextSpy).toHaveBeenCalledTimes(1);
  });
});

describe("generateEmbedding/generateEmbeddings — GGUF_EMBED_MODEL suffix normalization (doc69 W1-4 regression)", () => {
  // FIX regression: generateEmbedding/generateEmbeddings used to read the module-level
  // `GGUF_EMBED_MODEL` RAW (no ".gguf" strip) when called with no explicit modelId — exactly how
  // kbVectorStore.ingestKbChunks/searchKb call them. A live `.env` value that ALREADY carries the
  // ".gguf" suffix (e.g. `GGUF_EMBED_MODEL=Qwen3-Embedding-0.6B-f16.gguf`, as configured in this
  // repo's `.env`) fell straight through to getOrLoadModel(), which appends ".gguf" itself →
  // "...f16.gguf.gguf" → `GGUF model file not found`. Now resolved via modelResolver's
  // embedModelBasename() (toBasename/ensureGgufSuffix), so a value with OR without the suffix
  // always resolves to the SAME correct single-".gguf" basename.
  const savedEmbedModel = process.env.GGUF_EMBED_MODEL;
  afterEach(() => {
    if (savedEmbedModel === undefined) delete process.env.GGUF_EMBED_MODEL;
    else process.env.GGUF_EMBED_MODEL = savedEmbedModel;
  });

  it("GGUF_EMBED_MODEL WITH .gguf suffix (live .env shape) resolves to the correct basename, never '.gguf.gguf'", async () => {
    process.env.GGUF_EMBED_MODEL = "Qwen3-Embedding-0.6B-f16.gguf";
    const eng = await freshEngine();
    // No explicit modelId — exercises the exact live call shape (kbVectorStore's
    // ingestKbChunks/searchKb call generateEmbedding/generateEmbeddings this way).
    const res = await eng.generateEmbedding("hello world");
    expect(res.modelId).toBe("Qwen3-Embedding-0.6B-f16");
    const calledPaths = fakeLlama.loadModel.mock.calls.map((c: any[]) => String(c[0]?.modelPath ?? ""));
    expect(calledPaths.some((p) => /\.gguf\.gguf$/i.test(p))).toBe(false);
  });

  it("GGUF_EMBED_MODEL WITHOUT .gguf suffix resolves to the SAME basename (idempotent either way)", async () => {
    process.env.GGUF_EMBED_MODEL = "Qwen3-Embedding-0.6B-f16";
    const eng = await freshEngine();
    const res = await eng.generateEmbedding("hello world");
    expect(res.modelId).toBe("Qwen3-Embedding-0.6B-f16");
    const calledPaths = fakeLlama.loadModel.mock.calls.map((c: any[]) => String(c[0]?.modelPath ?? ""));
    expect(calledPaths.some((p) => /\.gguf\.gguf$/i.test(p))).toBe(false);
  });

  it("generateEmbeddings (batch) exhibits the same fix — no explicit modelId, suffix already present", async () => {
    process.env.GGUF_EMBED_MODEL = "Qwen3-Embedding-0.6B-f16.gguf";
    const eng = await freshEngine();
    const res = await eng.generateEmbeddings(["a", "b"]);
    expect(res.modelId).toBe("Qwen3-Embedding-0.6B-f16");
    const calledPaths = fakeLlama.loadModel.mock.calls.map((c: any[]) => String(c[0]?.modelPath ?? ""));
    expect(calledPaths.some((p) => /\.gguf\.gguf$/i.test(p))).toBe(false);
  });
});

describe("generateQualityInsights", () => {
  it("returns the stable schema shape every time (grammar-constrained)", async () => {
    const eng = await freshEngine();
    const data = {
      totalInspections: 100,
      passRate: 95.5,
      topDefects: [{ type: "scratch", count: 3, percentage: 3.0 }],
      periodStart: "2026-05-01",
      periodEnd: "2026-05-30",
    };
    for (let i = 0; i < 5; i++) {
      const out = await eng.generateQualityInsights(data, "text-model", "vi");
      expect(out).toHaveProperty("summary");
      expect(Array.isArray(out.trends)).toBe(true);
      expect(Array.isArray(out.risks)).toBe(true);
      expect(Array.isArray(out.recommendations)).toBe(true);
    }
    expect(fakeLlama.createGrammarForJsonSchema).toHaveBeenCalled();
  });
});

describe("LRU eviction", () => {
  it("evicts by count when exceeding GGUF_MAX_LOADED_MODELS", async () => {
    process.env.GGUF_MAX_LOADED_MODELS = "2";
    const eng = await freshEngine();
    await eng.loadGgufModel({ modelPath: "m1.gguf" });
    await eng.loadGgufModel({ modelPath: "m2.gguf" });
    expect(eng.getLoadedGgufModelNames().sort()).toEqual(["m1", "m2"]);
    // Loading a 3rd should evict the LRU (m1).
    await eng.loadGgufModel({ modelPath: "m3.gguf" });
    const names = eng.getLoadedGgufModelNames();
    expect(names.length).toBe(2);
    expect(names).not.toContain("m1");
    expect(names).toContain("m3");
  });

  it("does NOT evict a model with refCount > 0", async () => {
    process.env.GGUF_MAX_LOADED_MODELS = "1";
    const eng = await freshEngine();
    // Preload m1 so the in-flight call only bumps refCount (no async load to wait through).
    await eng.loadGgufModel({ modelPath: "m1.gguf" });
    // Hold a long-running embedding on m1 so its refCount stays > 0 during the next load.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let entered!: () => void;
    const enteredP = new Promise<void>((r) => { entered = r; });
    createEmbeddingContextSpy.mockResolvedValue({
      getEmbeddingFor: vi.fn(async () => {
        entered();
        await gate;
        return { vector: new Array(1024).fill(0.1) };
      }),
      dispose: embeddingContextDisposeSpy,
    });
    const inFlight = eng.generateEmbedding("busy", "m1");
    // Wait until the embedding call is actually in progress (refCount already incremented).
    await enteredP;
    // Now load m2 — capacity is 1, but m1 is in use → must NOT be evicted. ⚠ Pha 2B Task 5: khe
    // vẫn kín, nhưng lượt nạp KHÔNG còn được cho qua ở đây — cổng SỔ (reserve) quyết định ngay sau.
    await eng.loadGgufModel({ modelPath: "m2.gguf" });
    expect(eng.getLoadedGgufModelNames()).toContain("m1");
    release();
    await inFlight;
  });
});

/**
 * ★★★ Pha 2B Task 3 — BA KẾT CỤC (§5.5) NHÌN TỪ `loadGgufModel()`.
 *
 * ⚠ Bản trước của khối này khoá **CHÍNH SÁCH CŨ** (2 lượt: "max" rồi "auto") và — quan trọng hơn —
 * dựng lỗi bằng chuỗi `ggml_backend_cuda_buffer_type_alloc_buffer: … cudaMalloc failed: out of
 * memory`, tức **dòng llama.cpp in ra STDERR**, KHÔNG PHẢI `err.message` mà JS nhận được. Vì thế nó
 * xanh suốt trong khi đường lùi THẬT chưa bao giờ chạy trên máy thật (Ư0: 0/24 lượt).
 * Chuỗi THẬT là ba chữ `Failed to load model` (`LlamaModel.js:593`) — canh ở
 * `vram/threeOutcomes.test.ts` §1 bằng cách đọc thẳng `node_modules`.
 */
describe("VRAM OOM fallback — ba kết cục §5.5", () => {
  it("★★★ chuỗi lỗi THẬT ('Failed to load model') kích hoạt đủ 4 lượt: max · max · max · auto", async () => {
    const eng = await freshEngine();
    fakeLlama.loadModel
      .mockRejectedValueOnce(new Error("Failed to load model"))
      .mockRejectedValueOnce(new Error("Failed to load model"))
      .mockRejectedValueOnce(new Error("Failed to load model"))
      .mockImplementationOnce(async (opts: any) => makeFakeModel(opts.modelPath));

    await eng.loadGgufModel({ modelPath: "big.gguf" });

    expect(eng.getLoadedGgufModelNames()).toContain("big");
    // Lượt đầu + 2 lượt THỬ LẠI (trần không tất định) + 1 lượt HẠ SỐ LỚP.
    expect(fakeLlama.loadModel).toHaveBeenCalledTimes(4);
    expect(fakeLlama.loadModel.mock.calls.map((c: any[]) => c[0].gpuLayers)).toEqual([
      "max", "max", "max", "auto",
    ]);
  });

  it("chuỗi CŨ (cudaMalloc/out of memory) vẫn kích hoạt đường lùi — bản vá NỚI, không THAY", async () => {
    const eng = await freshEngine();
    fakeLlama.loadModel
      .mockRejectedValueOnce(new Error("cudaMalloc failed: out of memory"))
      .mockImplementationOnce(async (opts: any) => makeFakeModel(opts.modelPath));

    await eng.loadGgufModel({ modelPath: "big.gguf" });
    expect(eng.getLoadedGgufModelNames()).toContain("big");
    // Thắng ngay ở lượt THỬ LẠI đầu tiên ⇒ vẫn "max", chưa cần hạ số lớp.
    expect(fakeLlama.loadModel).toHaveBeenCalledTimes(2);
    expect(fakeLlama.loadModel.mock.calls.map((c: any[]) => c[0].gpuLayers)).toEqual(["max", "max"]);
  });

  it("rethrows a non-OOM load error without retrying", async () => {
    const eng = await freshEngine();
    fakeLlama.loadModel.mockRejectedValueOnce(new Error("corrupt gguf header"));
    await expect(eng.loadGgufModel({ modelPath: "bad.gguf" })).rejects.toThrow("corrupt gguf header");
    expect(fakeLlama.loadModel).toHaveBeenCalledTimes(1); // no retry
  });

  it("★★ gpuLayers: -1 (đường vào THẬT của aiGgufRouter) KHÔNG BAO GIỜ tới node-llama-cpp", async () => {
    const eng = await freshEngine();
    await eng.loadGgufModel({ modelPath: "neg.gguf", gpuLayers: -1 });
    // -1 ⇒ Math.max(0, Math.min(totalLayers, -1)) === 0 ⇒ nạp 0 lớp, chạy CPU, không báo gì.
    expect(fakeLlama.loadModel.mock.calls[0][0].gpuLayers).toBe("auto");
  });
});

describe("unloadGgufModel", () => {
  it("disposes the cached embedding context before unloading", async () => {
    const eng = await freshEngine();
    await eng.generateEmbedding("seed", "m1"); // creates + caches embedding ctx on m1
    expect(createEmbeddingContextSpy).toHaveBeenCalledTimes(1);
    const ok = await eng.unloadGgufModel("m1");
    expect(ok).toBe(true);
    expect(embeddingContextDisposeSpy).toHaveBeenCalled();
    expect(eng.getLoadedGgufModelNames()).not.toContain("m1");
  });
});
