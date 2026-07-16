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
import { describe, it, expect, vi, beforeEach } from "vitest";

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
    // Now load m2 — capacity is 1, but m1 is in use → must NOT be evicted (temporary overflow).
    await eng.loadGgufModel({ modelPath: "m2.gguf" });
    expect(eng.getLoadedGgufModelNames()).toContain("m1");
    release();
    await inFlight;
  });
});

describe("VRAM OOM fallback", () => {
  it("retries with gpuLayers:'auto' when a full GPU offload runs out of VRAM", async () => {
    const eng = await freshEngine();
    // First load attempt OOMs on the full ("max") offload; the retry succeeds.
    fakeLlama.loadModel
      .mockRejectedValueOnce(
        new Error("ggml_backend_cuda_buffer_type_alloc_buffer: cudaMalloc failed: out of memory"),
      )
      .mockImplementationOnce(async (opts: any) => makeFakeModel(opts.modelPath));

    await eng.loadGgufModel({ modelPath: "big.gguf" });

    // Model still loaded despite the initial OOM.
    expect(eng.getLoadedGgufModelNames()).toContain("big");
    // Two attempts: first "max" (default), retry "auto".
    expect(fakeLlama.loadModel).toHaveBeenCalledTimes(2);
    expect(fakeLlama.loadModel.mock.calls[0][0].gpuLayers).toBe("max");
    expect(fakeLlama.loadModel.mock.calls[1][0].gpuLayers).toBe("auto");
  });

  it("rethrows a non-OOM load error without retrying", async () => {
    const eng = await freshEngine();
    fakeLlama.loadModel.mockRejectedValueOnce(new Error("corrupt gguf header"));
    await expect(eng.loadGgufModel({ modelPath: "bad.gguf" })).rejects.toThrow("corrupt gguf header");
    expect(fakeLlama.loadModel).toHaveBeenCalledTimes(1); // no retry
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
