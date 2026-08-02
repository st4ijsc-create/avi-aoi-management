/**
 * Đợt 2 — review TOÀN NHÁNH, Important-2: cổng "TỪ CHỐI TRUNG THỰC" chỉ đóng NỬA VẾ.
 *
 * `ensureTextContext()` (server/services/aiGgufEngine.ts) đặt
 *
 *     if (loaded.context) return loaded.context;          // ← lối thoát SỚM
 *     ...
 *     if (isConfiguredNonGenerativeModelId(modelId)) throw ...   // ← cổng, ~8 dòng BÊN DƯỚI
 *
 * ⇒ Cổng chỉ chặn được model nào **thiếu** context thường. Một model **ĐÃ KHAI BÁO** qua `.env`
 * là embedder/reranker/projector mà **lỡ nạp KÈM context thường** thì thoát ở dòng đầu và **không
 * bao giờ tới cổng** — rồi `LlamaChatSession` sinh chữ trên một model không có đầu sinh văn bản,
 * cho ra **chuỗi lặp vô nghĩa được trình bày như câu trả lời thật**.
 *
 * Model khai báo nạp KÈM context thường xảy ra bất cứ khi nào lượt gọi ĐẦU TIÊN chạm nó có
 * `purpose = "generate"` (mặc định của `getOrLoadModel`) — ví dụ ngay sau boot, khi chưa lượt nhúng
 * nào kịp nạp nó trước. Lúc đó `loadGgufModel({ embeddingOnly: false })` tạo context thường như mọi
 * model text khác.
 *
 * ĐƯỜNG HTTP CÓ THẬT (reviewer tái hiện): server/routes/openaiGateway.ts:365 → `resolveModelId` →
 * `resolveLogicalModel("embed")` (server/services/ai/modelResolver.ts:238) → `chatCompletion(...)`.
 *
 * VÌ SAO KHÔNG PHẢI "minor": rác trình bày như câu trả lời thật **tệ hơn** một lỗi ném ra — Task 3
 * chính là task dựng nguyên tắc "từ-chối-trung-thực" này. Bản vá là **chuyển cổng lên TRƯỚC lối
 * thoát sớm**.
 *
 * ⚠ RÀNG BUỘC: KHÔNG được phá ca TỰ LÀNH hợp lệ. Model **TEXT** bị alias nhầm qua `modelId` HTTP
 * (Critical-1 của vòng trước — aiGgufEngine.embedAliasSelfHeal.test.ts) **vẫn phải tự lành**; chỉ
 * model **THẬT SỰ KHAI BÁO** qua env mới bị từ chối.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./aiLlamaServerClient", () => ({
  shouldUseServerForText: () => false,
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

const EMBED_DIM = 1024;
/** Chuỗi lặp vô nghĩa — thứ một embedder bị ép sinh chữ thực sự trả về. Nếu test thấy chuỗi này
 *  lọt ra ngoài như câu trả lời thì cổng đã hỏng. */
const GARBAGE = "result result result result";
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
const fakeLlama = {
  loadModel: vi.fn(async () => makeFakeModel()),
  getVramState: vi.fn(async () => ({ total: 32 * GiB, used: 2 * GiB, free: 30 * GiB, unifiedSize: 0 })),
  createGrammarForJsonSchema: vi.fn(async () => ({ parse: (s: string) => JSON.parse(s) })),
};
class FakeChatSession {
  constructor(_opts: any) {}
  async prompt(_p: string, _opts: any) {
    return GARBAGE;
  }
}
vi.mock("node-llama-cpp", () => ({
  getLlama: vi.fn(async () => fakeLlama),
  LlamaChatSession: FakeChatSession,
  LlamaJsonSchemaGrammar: class {},
}));

vi.mock("fs", () => {
  const api = {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => [] as string[]),
    statSync: vi.fn(() => ({ size: 1234, mtime: new Date(), isFile: () => true })),
  };
  return { default: api, ...api };
});

const DEFAULT_FILE = "Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL.gguf";
const DEFAULT_BASE = "Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL";
const EMBED_FILE = "Qwen3-Embedding-0.6B-f16.gguf";
const EMBED_BASE = "Qwen3-Embedding-0.6B-f16";
const RERANK_FILE = "bge-reranker-v2-m3-Q8_0.gguf";
const RERANK_BASE = "bge-reranker-v2-m3-Q8_0";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  process.env.GGUF_DEFAULT_MODEL = DEFAULT_FILE;
  process.env.GGUF_EMBED_DIM = String(EMBED_DIM);
  process.env.GGUF_MAX_LOADED_MODELS = "4";
  process.env.GGUF_MAX_VRAM_MB = "0";
  process.env.GGUF_MAX_CONCURRENCY = "4";
  delete process.env.GGUF_EMBED_MODEL;
  delete process.env.GGUF_RERANKER_MODEL;
  delete process.env.LLAMA_SERVER_ENABLED;
});

async function freshEngine() {
  vi.resetModules();
  return await import("./aiGgufEngine");
}

describe("review toàn nhánh I-2 — cổng từ-chối-trung-thực phải đóng CẢ VẾ 'đã có context thường'", () => {
  it("generateText ghim model nhúng ĐÃ KHAI BÁO, nạp lần đầu qua đường SINH CHỮ (có context thường) ⇒ PHẢI từ chối", async () => {
    process.env.GGUF_EMBED_MODEL = EMBED_FILE; // khai báo THẬT qua env — không đoán theo tên file
    const eng = await freshEngine();

    // ⚠ CỐ Ý KHÔNG gọi generateEmbedding() trước. Lượt gọi ĐẦU TIÊN chạm model này là một lượt
    // SINH CHỮ ⇒ getOrLoadModel(purpose="generate") ⇒ loadGgufModel({embeddingOnly:false}) ⇒
    // context THƯỜNG được tạo ngay lúc nạp. Đây là trạng thái "ngay sau boot" mà bản vá vòng
    // trước không chặn được: ensureTextContext() thoát ở `if (loaded.context) return ...`.
    await expect(eng.generateText({ prompt: "xin chào" }, EMBED_BASE)).rejects.toThrow(
      /declared|khai báo|embedding|nhúng/i,
    );
  });

  it("chatCompletion ghim model nhúng ĐÃ KHAI BÁO (đường HTTP openaiGateway → resolveLogicalModel('embed')) ⇒ PHẢI từ chối", async () => {
    process.env.GGUF_EMBED_MODEL = EMBED_FILE;
    const eng = await freshEngine();

    await expect(
      eng.chatCompletion({ messages: [{ role: "user", content: "xin chào" }] }, EMBED_BASE),
    ).rejects.toThrow(/declared|khai báo|embedding|nhúng/i);
  });

  it("KHÔNG được trả về chuỗi lặp vô nghĩa như câu trả lời thật", async () => {
    process.env.GGUF_EMBED_MODEL = EMBED_FILE;
    const eng = await freshEngine();

    let text: string | null = null;
    try {
      const r = await eng.generateText({ prompt: "xin chào" }, EMBED_BASE);
      text = r.text;
    } catch {
      /* từ chối trung thực — đúng hành vi mong muốn */
    }
    // Đây là chỗ đau thật sự: rác trình bày như câu trả lời tệ hơn một lỗi ném ra.
    expect(text).not.toBe(GARBAGE);
    expect(text).toBeNull();
  });

  it("reranker ĐÃ KHAI BÁO cũng bị từ chối trên đường 'đã có context thường'", async () => {
    process.env.GGUF_RERANKER_MODEL = RERANK_FILE;
    const eng = await freshEngine();

    await expect(eng.generateText({ prompt: "xin chào" }, RERANK_BASE)).rejects.toThrow(
      /declared|khai báo|rerank/i,
    );
  });

  it("⚠ KHÔNG PHÁ ca tự-lành hợp lệ: model TEXT bị alias qua modelId HTTP vẫn tự lành", async () => {
    // GGUF_EMBED_MODEL CỐ Ý không set ⇒ DEFAULT_BASE KHÔNG được khai báo là non-generative.
    const eng = await freshEngine();

    // Nhúng bằng modelId trùng model TEXT ⇒ cache với context===undefined (Critical-1 vòng trước).
    await eng.generateEmbedding("một câu tiếng Việt", DEFAULT_BASE);

    // Lượt sinh chữ sau đó PHẢI tự lành (tạo context lười), KHÔNG bị cổng mới chặn nhầm.
    const result = await eng.generateText({ prompt: "xin chào" });
    expect(result.modelId).toBe(DEFAULT_BASE);
    expect(typeof result.text).toBe("string");
  });

  it("⚠ KHÔNG PHÁ đường thường: model TEXT bình thường vẫn sinh chữ được", async () => {
    process.env.GGUF_EMBED_MODEL = EMBED_FILE; // có khai báo embedder, nhưng ta dùng model TEXT
    const eng = await freshEngine();

    const result = await eng.generateText({ prompt: "xin chào" });
    expect(result.modelId).toBe(DEFAULT_BASE);
    expect(typeof result.text).toBe("string");
  });
});
