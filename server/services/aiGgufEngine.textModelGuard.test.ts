/**
 * doc69 Wave 1 "modelfix" — REGRESSION GUARD: the engine must NEVER generate text with the
 * EMBEDDING model.
 *
 * MEASURED BUG (6 live runs, modelId read back from the DB): the same request produced coherent
 * Vietnamese from `Qwen3-30B-A3B-Instruct-…` in runs #1/#2 and token-repetition garbage
 * ("result result result…") from `Qwen3-Embedding-0.6B-f16` in runs #3-#6. Root cause was the
 * PRIORITY ORDER inside `getOrLoadModel(undefined)`: "whatever model is already resident" won over
 * `GGUF_DEFAULT_MODEL`, and RAG (`retrieveKnowledge`) makes the 0.6B embedder resident first — so
 * every un-pinned generation call fell into an embedding model, which has no text-generation head.
 *
 * Every earlier unit test mocked `generateText` itself, so none of them could ever see this. These
 * tests therefore run the REAL engine (node-llama-cpp + fs mocked) and assert on the resolved
 * `modelId`, which is exactly the field the live measurement read.
 *
 * The embedding path is the biggest regression risk of the fix (the same `getOrLoadModel` serves
 * both), so it is pinned here too.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the llama-server client (default OFF → in-process path, like production) ───
vi.mock("./aiLlamaServerClient", () => ({
  shouldUseServerForText: () => false,
  // G1-D — vị từ hạt nhân "model này có phải cái llama-server đang giữ không" (điểm nghẽn loadGgufModel).
  laModelServerDangGiu: () => false,
  shouldUseServerForFim: () => false,
  preflightHealthy: async () => false,
  preflightHealthyForFim: async () => false,
  serverGenerateText: async () => {
    throw new Error("server path must not be used in these tests");
  },
  serverGenerateJSON: async () => {
    throw new Error("server path must not be used in these tests");
  },
  generateFimViaServer: async () => {
    throw new Error("server path must not be used in these tests");
  },
  llamaServerStrict: () => false,
  llamaServerEnabled: () => false,
  llamaServerHealthy: async () => false,
}));

vi.mock("./aiModelRouter", () => ({
  getThinkingTierStatus: () => ({
    enabled: false,
    modelConfigured: false,
    fileExists: false,
    active: false,
    reason: "disabled",
  }),
}));

// ─── Mock node-llama-cpp so the in-process path runs with no real model/GPU ───
const EMBED_DIM = 1024;
function makeFakeModel() {
  return {
    size: 1234,
    tokenize: (t: string) => t.split(" "),
    createContext: vi.fn(async () => ({
      getSequence: () => ({ dispose: vi.fn() }),
      dispose: vi.fn(),
    })),
    createEmbeddingContext: vi.fn(async () => ({
      getEmbeddingFor: async () => ({ vector: new Array(EMBED_DIM).fill(0.01) }),
      dispose: vi.fn(),
    })),
    dispose: vi.fn(),
  };
}
const GiB = 1024 * 1024 * 1024;
/** Model basenames whose load must FAIL (simulates VRAM OOM / missing weights). */
let unloadableBasenames: string[] = [];
const fakeLlama = {
  loadModel: vi.fn(async (opts: any) => {
    const base = String(opts?.modelPath ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
    if (unloadableBasenames.some((b) => base.startsWith(b))) {
      throw new Error(`simulated load failure for ${base}`);
    }
    return makeFakeModel();
  }),
  getVramState: vi.fn(async () => ({ total: 32 * GiB, used: 2 * GiB, free: 30 * GiB, unifiedSize: 0 })),
  createGrammarForJsonSchema: vi.fn(async () => ({ parse: (s: string) => JSON.parse(s) })),
};
class FakeChatSession {
  constructor(_opts: any) {}
  async prompt(_p: string, _opts: any) {
    return "in-process answer";
  }
}
vi.mock("node-llama-cpp", () => ({
  getLlama: vi.fn(async () => fakeLlama),
  LlamaChatSession: FakeChatSession,
  LlamaJsonSchemaGrammar: class {},
}));

/** Files the mocked models dir reports (drives the "first .gguf on disk" fallback). */
let dirFiles: string[] = [];
vi.mock("fs", () => {
  const api = {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => dirFiles),
    statSync: vi.fn(() => ({ size: 1234, mtime: new Date(), isFile: () => true })),
  };
  return { default: api, ...api };
});

const DEFAULT_FILE = "Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL.gguf";
const DEFAULT_BASE = "Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL";
const EMBED_FILE = "Qwen3-Embedding-0.6B-f16.gguf";
const EMBED_BASE = "Qwen3-Embedding-0.6B-f16";
const FAST_FILE = "Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf";
const FAST_BASE = "Qwen3-4B-Instruct-2507-UD-Q4_K_XL";
// Real files that live in this deployment's GGUF_MODELS_DIR and are NOT text generators.
const RERANK_FILE = "bge-reranker-v2-m3-Q8_0.gguf"; // cross-encoder ranking model
const RERANK_BASE = "bge-reranker-v2-m3-Q8_0";
const MMPROJ_FILE = "Qwen3-VL-8B-mmproj-F16.gguf"; // vision projector, not a chat model
const MMPROJ_BASE = "Qwen3-VL-8B-mmproj-F16";
// FIX ROUND 2 — a SECOND embedder that is NOT registered in ANY of GGUF_EMBED_MODEL /
// GGUF_EMBEDDING_MODEL / GGUF_RERANKER_MODEL / GGUF_VISION_MMPROJ. Exact-identity matching alone
// cannot see it, which is the hole the re-review reproduced empirically.
const UNTRACKED_EMBED_FILE = "custom-embedding-index-Q8_0.gguf";
const UNTRACKED_EMBED_BASE = "custom-embedding-index-Q8_0";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  process.env.GGUF_DEFAULT_MODEL = DEFAULT_FILE;
  process.env.GGUF_EMBED_MODEL = EMBED_FILE;
  process.env.GGUF_EMBED_DIM = String(EMBED_DIM);
  process.env.GGUF_MAX_LOADED_MODELS = "4";
  process.env.GGUF_MAX_VRAM_MB = "0";
  delete process.env.LLAMA_SERVER_ENABLED;
  dirFiles = [DEFAULT_FILE, EMBED_FILE, FAST_FILE];
  unloadableBasenames = [];
});

async function freshEngine() {
  vi.resetModules();
  return await import("./aiGgufEngine");
}

describe("getOrLoadModel(undefined) — text generation must never land on the embedding model", () => {
  it("1. only the EMBEDDER is resident (the RAG-first ordering that caused the live bug) ⇒ generation uses GGUF_DEFAULT_MODEL, never the embedder", async () => {
    const eng = await freshEngine();

    // Reproduce production: retrieveKnowledge() makes the 0.6B embedder the FIRST resident model.
    await eng.loadGgufModel({ modelPath: EMBED_FILE });

    const result = await eng.generateText({ prompt: "Phân tích lỗi hàn thiếc" });

    expect(result.modelId).not.toBe(EMBED_BASE);
    expect(result.modelId).toBe(DEFAULT_BASE);
  });

  it("2. NO text-generation model is available ⇒ throws an explicit error naming the cause and NEVER falls back to the embedder", async () => {
    delete process.env.GGUF_DEFAULT_MODEL; // no chat model configured
    dirFiles = [EMBED_FILE]; // …and nothing but the embedder on disk
    const eng = await freshEngine();

    await eng.loadGgufModel({ modelPath: EMBED_FILE });

    await expect(eng.generateText({ prompt: "hi" })).rejects.toThrow(
      /No text-generation model available/i,
    );
    // The message must name the real cause, not a generic "no model".
    await expect(eng.generateText({ prompt: "hi" })).rejects.toThrow(/embedding model/i);
  });

  it("3. the DEFAULT model is already resident ⇒ it is reused as-is (no regression, no reload)", async () => {
    const eng = await freshEngine();

    await eng.loadGgufModel({ modelPath: DEFAULT_FILE });
    const loadsAfterWarm = fakeLlama.loadModel.mock.calls.length;

    const result = await eng.generateText({ prompt: "hi" });

    expect(result.modelId).toBe(DEFAULT_BASE);
    expect(fakeLlama.loadModel.mock.calls.length).toBe(loadsAfterWarm); // reused, not reloaded
  });

  it("3b. embedder resident AND default model resident ⇒ still picks the default (resident-order must not decide)", async () => {
    const eng = await freshEngine();

    await eng.loadGgufModel({ modelPath: EMBED_FILE }); // first in the Map
    await eng.loadGgufModel({ modelPath: DEFAULT_FILE });

    const result = await eng.generateText({ prompt: "hi" });

    expect(result.modelId).toBe(DEFAULT_BASE);
  });

  it("4. GGUF_DEFAULT_MODEL cannot load (VRAM) but another NON-embedding model is resident ⇒ degrades to that text model, never the embedder", async () => {
    unloadableBasenames = [DEFAULT_BASE];
    const eng = await freshEngine();

    await eng.loadGgufModel({ modelPath: EMBED_FILE });
    await eng.loadGgufModel({ modelPath: FAST_FILE });

    const result = await eng.generateText({ prompt: "hi" });

    expect(result.modelId).toBe(FAST_BASE);
    expect(result.modelId).not.toBe(EMBED_BASE);
  });

  it("5. streaming generation is protected by the same guard", async () => {
    const eng = await freshEngine();
    await eng.loadGgufModel({ modelPath: EMBED_FILE });

    const seen: string[] = [];
    for await (const chunk of eng.generateTextStream({ prompt: "hi" })) {
      if (chunk.type === "done" && chunk.modelId) seen.push(chunk.modelId);
      if (chunk.type === "error") throw new Error(chunk.error);
    }

    expect(seen).not.toContain(EMBED_BASE);
    expect(seen).toContain(DEFAULT_BASE);
  });
});

/**
 * FIX ROUND 1 — the same bug class, reachable through a single `.env` typo instead of through
 * load order. `.env` carries BOTH `GGUF_EMBEDDING_MODEL=` (unused) and `GGUF_EMBED_MODEL=`, so
 * pointing `GGUF_DEFAULT_MODEL` at the embedder is a realistic mistake. Steps 1-2 of the ladder
 * used to return it with no warning and no throw.
 */
describe("GGUF_DEFAULT_MODEL misconfigured to a NON-generative model", () => {
  it("13. GGUF_DEFAULT_MODEL == the embedder, another text model resident ⇒ uses the text model and never loads the embedder as 'default'", async () => {
    process.env.GGUF_DEFAULT_MODEL = EMBED_FILE; // the config typo
    const eng = await freshEngine();

    await eng.loadGgufModel({ modelPath: FAST_FILE });
    const loadsAfterWarm = fakeLlama.loadModel.mock.calls.length;

    const result = await eng.generateText({ prompt: "hi" });

    expect(result.modelId).toBe(FAST_BASE);
    expect(result.modelId).not.toBe(EMBED_BASE);
    // It must not have tried to LOAD the embedder as the "default chat model" either.
    expect(fakeLlama.loadModel.mock.calls.length).toBe(loadsAfterWarm);
  });

  it("14. GGUF_DEFAULT_MODEL == the embedder AND the embedder is the only resident/on-disk model ⇒ throws, naming the misconfiguration", async () => {
    process.env.GGUF_DEFAULT_MODEL = EMBED_FILE;
    dirFiles = [EMBED_FILE];
    const eng = await freshEngine();

    await eng.loadGgufModel({ modelPath: EMBED_FILE }); // resident — must still be refused

    await expect(eng.generateText({ prompt: "hi" })).rejects.toThrow(
      /No text-generation model available/i,
    );
    await expect(eng.generateText({ prompt: "hi" })).rejects.toThrow(
      /GGUF_DEFAULT_MODEL[\s\S]*non-generative/i,
    );
  });

  it("15. GGUF_DEFAULT_MODEL == the RERANKER (declared via GGUF_RERANKER_MODEL) ⇒ also refused, not just the embedder", async () => {
    process.env.GGUF_DEFAULT_MODEL = RERANK_FILE;
    process.env.GGUF_RERANKER_MODEL = RERANK_FILE;
    dirFiles = [RERANK_FILE, EMBED_FILE];
    const eng = await freshEngine();

    await expect(eng.generateText({ prompt: "hi" })).rejects.toThrow(
      /No text-generation model available/i,
    );
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
  });
});

/**
 * FIX ROUND 2 — the hole the re-review reproduced empirically: exact-identity matching only sees a
 * non-generative model if that exact file is ALSO assigned to one of the four env vars. An embedder
 * that nobody registered (a second index model, a leftover download) sailed through steps 0-2 and
 * was returned for generation — both when resident and when loaded on demand.
 *
 * Tests 13-15 could never catch it: they always set the file simultaneously as its tracked env var,
 * which masks the gap. These set GGUF_EMBED_MODEL to the REAL tracked embedder and point
 * GGUF_DEFAULT_MODEL at a DIFFERENT, unregistered one.
 */
describe("GGUF_DEFAULT_MODEL is an UNREGISTERED non-generative model (fix round 2)", () => {
  it("19. unregistered embedder as default, ALREADY RESIDENT ⇒ refused; falls through to a real text model", async () => {
    process.env.GGUF_EMBED_MODEL = EMBED_FILE; // the tracked embedder — a DIFFERENT file
    process.env.GGUF_DEFAULT_MODEL = UNTRACKED_EMBED_FILE; // registered nowhere
    const eng = await freshEngine();

    await eng.loadGgufModel({ modelPath: UNTRACKED_EMBED_FILE }); // step-1 path: already resident
    await eng.loadGgufModel({ modelPath: FAST_FILE });

    const result = await eng.generateText({ prompt: "hi" });

    expect(result.modelId).not.toBe(UNTRACKED_EMBED_BASE);
    expect(result.modelId).toBe(FAST_BASE);
  });

  it("20. unregistered embedder as default, MUST LOAD ⇒ never loaded; falls through to the on-disk chat model", async () => {
    process.env.GGUF_EMBED_MODEL = EMBED_FILE;
    process.env.GGUF_DEFAULT_MODEL = UNTRACKED_EMBED_FILE;
    dirFiles = [UNTRACKED_EMBED_FILE, DEFAULT_FILE];
    const eng = await freshEngine();

    const result = await eng.generateText({ prompt: "hi" });

    expect(result.modelId).not.toBe(UNTRACKED_EMBED_BASE);
    expect(result.modelId).toBe(DEFAULT_BASE);
    // It must never even attempt to LOAD the unregistered embedder.
    const paths = fakeLlama.loadModel.mock.calls.map((c: any[]) => String(c[0]?.modelPath ?? ""));
    expect(paths.some((p) => p.includes(UNTRACKED_EMBED_BASE))).toBe(false);
  });

  it("21. unregistered embedder as default with NO alternative ⇒ throws, naming the value, the reason and the override", async () => {
    process.env.GGUF_EMBED_MODEL = EMBED_FILE;
    process.env.GGUF_DEFAULT_MODEL = UNTRACKED_EMBED_FILE;
    dirFiles = [UNTRACKED_EMBED_FILE];
    const eng = await freshEngine();

    await expect(eng.generateText({ prompt: "hi" })).rejects.toThrow(
      /No text-generation model available/i,
    );
    // Actionable: names the offending value …
    await expect(eng.generateText({ prompt: "hi" })).rejects.toThrow(
      new RegExp(UNTRACKED_EMBED_BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    );
    // … and tells the operator how to override if it really IS a chat model.
    await expect(eng.generateText({ prompt: "hi" })).rejects.toThrow(
      /GGUF_ALLOW_NONGENERATIVE_DEFAULT/,
    );
  });

  it("22. escape hatch: GGUF_ALLOW_NONGENERATIVE_DEFAULT=true lets a legitimately-named chat model through", async () => {
    process.env.GGUF_EMBED_MODEL = EMBED_FILE;
    process.env.GGUF_DEFAULT_MODEL = UNTRACKED_EMBED_FILE;
    process.env.GGUF_ALLOW_NONGENERATIVE_DEFAULT = "true";
    dirFiles = [UNTRACKED_EMBED_FILE];
    const eng = await freshEngine();

    const result = await eng.generateText({ prompt: "hi" });

    expect(result.modelId).toBe(UNTRACKED_EMBED_BASE);
  });

  it("23. the escape hatch does NOT override the self-contradictory case (default === the DECLARED embedder)", async () => {
    process.env.GGUF_EMBED_MODEL = EMBED_FILE;
    process.env.GGUF_DEFAULT_MODEL = EMBED_FILE; // same file declared as the embedder
    process.env.GGUF_ALLOW_NONGENERATIVE_DEFAULT = "true";
    dirFiles = [EMBED_FILE];
    const eng = await freshEngine();

    await expect(eng.generateText({ prompt: "hi" })).rejects.toThrow(
      /No text-generation model available/i,
    );
  });

  it("24. the escape hatch defaults OFF (absent env var behaves exactly like test 21)", async () => {
    process.env.GGUF_EMBED_MODEL = EMBED_FILE;
    process.env.GGUF_DEFAULT_MODEL = UNTRACKED_EMBED_FILE;
    delete process.env.GGUF_ALLOW_NONGENERATIVE_DEFAULT;
    dirFiles = [UNTRACKED_EMBED_FILE];
    const eng = await freshEngine();

    await expect(eng.generateText({ prompt: "hi" })).rejects.toThrow(
      /No text-generation model available/i,
    );
  });

  it("25. a normal chat model is NOT tripped by the heuristic (no false positive on the real default)", async () => {
    const eng = await freshEngine();
    const result = await eng.generateText({ prompt: "hi" });
    expect(result.modelId).toBe(DEFAULT_BASE);
  });
});

/**
 * FIX ROUND 1 — the blind disk fallback (step 4) only skipped embedders. GGUF_MODELS_DIR also
 * holds a cross-encoder reranker and a vision projector; readdir order could hand either to a
 * generation request — the same garbage class, one rung further down the degradation ladder.
 */
describe("disk fallback (step 4) must skip every non-generative .gguf, not just embedders", () => {
  it("16. reranker + projector listed BEFORE the chat model ⇒ still picks the chat model", async () => {
    delete process.env.GGUF_DEFAULT_MODEL; // force the blind disk scan
    delete process.env.GGUF_RERANKER_MODEL; // prove the NAME heuristic, not an env exact-match
    delete process.env.GGUF_VISION_MMPROJ;
    dirFiles = [RERANK_FILE, MMPROJ_FILE, EMBED_FILE, DEFAULT_FILE];
    const eng = await freshEngine();

    const result = await eng.generateText({ prompt: "hi" });

    expect(result.modelId).toBe(DEFAULT_BASE);
    expect(result.modelId).not.toBe(RERANK_BASE);
    expect(result.modelId).not.toBe(MMPROJ_BASE);
  });

  it("17. ONLY non-generative .gguf files on disk ⇒ throws instead of 'generating' with a reranker/projector", async () => {
    delete process.env.GGUF_DEFAULT_MODEL;
    delete process.env.GGUF_RERANKER_MODEL;
    delete process.env.GGUF_VISION_MMPROJ;
    dirFiles = [RERANK_FILE, MMPROJ_FILE, EMBED_FILE];
    const eng = await freshEngine();

    await expect(eng.generateText({ prompt: "hi" })).rejects.toThrow(
      /No text-generation model available/i,
    );
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
  });

  it("18. a resident projector is not used for generation either (step 3 degradation path)", async () => {
    delete process.env.GGUF_DEFAULT_MODEL;
    delete process.env.GGUF_VISION_MMPROJ;
    dirFiles = []; // nothing on disk to fall through to
    const eng = await freshEngine();

    await eng.loadGgufModel({ modelPath: MMPROJ_FILE });

    await expect(eng.generateText({ prompt: "hi" })).rejects.toThrow(
      /No text-generation model available/i,
    );
  });
});

describe("embedding path (biggest regression risk of the guard) — must keep working", () => {
  it("6. generateEmbedding() resolves the EMBEDDING model even when the chat model is resident", async () => {
    const eng = await freshEngine();
    await eng.loadGgufModel({ modelPath: DEFAULT_FILE }); // chat model hot first

    const out = await eng.generateEmbedding("kiểm tra");

    expect(out.modelId).toBe(EMBED_BASE);
    expect(out.dimensions).toBe(EMBED_DIM);
  });

  it("7. generateEmbeddings() (batch) also resolves the EMBEDDING model", async () => {
    const eng = await freshEngine();
    await eng.loadGgufModel({ modelPath: DEFAULT_FILE });

    const out = await eng.generateEmbeddings(["a", "b"]);

    expect(out.modelId).toBe(EMBED_BASE);
    expect(out.embeddings).toHaveLength(2);
    expect(out.dimensions).toBe(EMBED_DIM);
  });

  it("8. embedding with ONLY the embedder resident does not drag in the 30B chat model", async () => {
    const eng = await freshEngine();
    await eng.loadGgufModel({ modelPath: EMBED_FILE });
    const loadsAfterWarm = fakeLlama.loadModel.mock.calls.length;

    const out = await eng.generateEmbedding("x");

    expect(out.modelId).toBe(EMBED_BASE);
    expect(fakeLlama.loadModel.mock.calls.length).toBe(loadsAfterWarm);
  });

  it("9. countTokens() is tokenizer-only ⇒ reuses whatever is resident, it must NOT force-load the 30B", async () => {
    const eng = await freshEngine();
    await eng.loadGgufModel({ modelPath: EMBED_FILE });
    const loadsAfterWarm = fakeLlama.loadModel.mock.calls.length;

    const n = await eng.countTokens("a b c");

    expect(n).toBe(3);
    expect(fakeLlama.loadModel.mock.calls.length).toBe(loadsAfterWarm);
  });
});

/** Real-timer settle helper — the warm path chains through dynamic imports, which fake timers
 *  cannot reliably flush (the pending load then leaks into the NEXT test). */
async function settle(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe("boot-time deep-model warm (the VRAM-ordering trap the engine already documented)", () => {
  it("10. initDeepModelWarmup() makes GGUF_DEFAULT_MODEL resident — and never the embedder", async () => {
    process.env.GGUF_WARM_DELAY_MS = "1";
    const eng = await freshEngine();

    eng.initDeepModelWarmup();
    for (let i = 0; i < 40 && fakeLlama.loadModel.mock.calls.length === 0; i++) await settle(10);

    expect(fakeLlama.loadModel).toHaveBeenCalled();
    const paths = fakeLlama.loadModel.mock.calls.map((c: any[]) => String(c[0]?.modelPath ?? ""));
    expect(paths.some((p) => p.includes(DEFAULT_BASE))).toBe(true);
    expect(paths.some((p) => p.includes(EMBED_BASE))).toBe(false);
  });

  it("11. initDeepModelWarmup() is a no-op when GGUF_WARM_DEEP_MODEL_ON_BOOT=false", async () => {
    process.env.GGUF_WARM_DEEP_MODEL_ON_BOOT = "false";
    process.env.GGUF_WARM_DELAY_MS = "1";
    const eng = await freshEngine();

    eng.initDeepModelWarmup();
    await settle(120);

    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
  });

  it("12. initDeepModelWarmup() is idempotent (a second call never double-warms)", async () => {
    process.env.GGUF_WARM_DELAY_MS = "1";
    const eng = await freshEngine();

    eng.initDeepModelWarmup();
    eng.initDeepModelWarmup();
    for (let i = 0; i < 40 && fakeLlama.loadModel.mock.calls.length === 0; i++) await settle(10);
    await settle(60);

    expect(fakeLlama.loadModel).toHaveBeenCalledTimes(1);
  });
});
