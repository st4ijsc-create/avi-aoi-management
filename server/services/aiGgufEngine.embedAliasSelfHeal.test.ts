/**
 * Đợt 2 Task 3 — review round 1 Critical-1: `embeddingOnly` (thêm ở commit trước, cho phép
 * `loadGgufModel()` bỏ qua context thường khi model chỉ dùng để nhúng) đầu độc CACHE dùng
 * CHUNG cho mọi purpose.
 *
 * `purpose === "embed"` (nguồn cờ `embeddingOnly: purpose === "embed"` trong `getOrLoadModel()`)
 * là thuộc tính của LƯỢT GỌI, KHÔNG phải của MODEL — nhưng `loadedModels` cache theo `modelId`,
 * dùng chung cho mọi purpose. `modelId` trong `generateEmbedding(text, modelId)` đến từ HTTP
 * (`server/routers/aiGgufRouter.ts` — `protectedProcedure`, `modelId: z.string().optional()`,
 * bất kỳ người dùng đã đăng nhập nào truyền được): nếu `modelId` TRÙNG basename với một model
 * TEXT (kể cả chính `GGUF_DEFAULT_MODEL`), model TEXT đó bị nạp với `context===undefined` rồi
 * CACHE VĨNH VIỄN. Lượt `generateText()` sau đó (không truyền modelId) đi qua
 * `getGenerationModel()` bước 1 (`takeLoadedModel(defaultId)`) — trả lại y nguyên bản cache đó
 * mà KHÔNG kiểm `.context` ⇒ `loaded.context.getSequence()` ném `TypeError`. KHÔNG tự lành —
 * model hỏng vẫn resident, mọi lượt sinh chữ sau đều vỡ tới khi restart hoặc admin unload.
 *
 * Sửa: `ensureTextContext()` — lưới an toàn tạo LƯỜI context thường đúng công thức production
 * (giống hệt `loadGgufModel()`) ngay tại điểm cần dùng (6 hàm sinh chữ), nếu `.context` còn
 * thiếu. Model TỰ LÀNH ở lượt gọi kế tiếp thay vì kẹt vĩnh viễn.
 *
 * Mock node-llama-cpp/fs/aiLlamaServerClient/aiModelRouter COPY nguyên khuôn từ
 * aiGgufEngine.textModelGuard.test.ts (file test DUY NHẤT trong repo chạy generateText() THẬT,
 * không mock chính generateText) — để tái hiện đúng đường sản xuất, không phải giả định.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the llama-server client (default OFF → in-process path, like production) ───
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

// ─── node-llama-cpp so the in-process path runs with no real model/GPU ───
const EMBED_DIM = 1024;
const createContextSpy = vi.fn();
function makeFakeModel() {
  return {
    size: 1234,
    tokenize: (t: string) => t.split(" "),
    createContext: vi.fn(async (o: any) => {
      createContextSpy(o);
      return { getSequence: () => ({ dispose: vi.fn() }), dispose: vi.fn() };
    }),
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
    return "in-process answer";
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

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  createContextSpy.mockClear();
  process.env = { ...ORIGINAL_ENV };
  process.env.GGUF_DEFAULT_MODEL = DEFAULT_FILE;
  // ⚠ GGUF_EMBED_MODEL CỐ Ý không set — bài test này mô phỏng modelId đến từ HTTP
  // (aiGgufRouter.ts, không phải qua GGUF_EMBED_MODEL đã cấu hình).
  delete process.env.GGUF_EMBED_MODEL;
  process.env.GGUF_EMBED_DIM = String(EMBED_DIM);
  process.env.GGUF_MAX_LOADED_MODELS = "4";
  process.env.GGUF_MAX_VRAM_MB = "0";
  process.env.GGUF_MAX_CONCURRENCY = "4";
  delete process.env.LLAMA_SERVER_ENABLED;
});

async function freshEngine() {
  vi.resetModules();
  return await import("./aiGgufEngine");
}

describe("review round 1 Critical-1 — embeddingOnly không được đầu độc cache model TEXT", () => {
  it("nhúng bằng modelId TRÙNG GGUF_DEFAULT_MODEL (mô phỏng modelId từ HTTP), rồi sinh chữ — KHÔNG throw, tự lành", async () => {
    const eng = await freshEngine();

    // Mô phỏng chính xác kịch bản reviewer tái hiện: generateEmbedding() nhận modelId TRÙNG
    // basename với model TEXT (ở đây trùng luôn GGUF_DEFAULT_MODEL) — HTTP protectedProcedure
    // cho phép bất kỳ modelId nào, không kiểm nó có phải model nhúng thật hay không.
    const embedRes = await eng.generateEmbedding("một câu tiếng Việt", DEFAULT_BASE);
    expect(embedRes.dimensions).toBe(EMBED_DIM);

    // Model DEFAULT_BASE giờ đã cache trong loadedModels với context===undefined (nạp qua
    // đường embeddingOnly). Lượt sinh chữ SAU ĐÓ (không truyền modelId) đi qua
    // getGenerationModel() bước 1 — takeLoadedModel(defaultId) — PHẢI vẫn dùng được.
    const result = await eng.generateText({ prompt: "xin chào" });
    expect(result.modelId).toBe(DEFAULT_BASE);
    expect(typeof result.text).toBe("string");
  });

  it("model TEXT bình thường (KHÔNG đi qua đường nhúng) vẫn tạo context ở lần nạp — không tốn thêm context lười", async () => {
    const eng = await freshEngine();

    await eng.generateText({ prompt: "hi" }); // nạp DEFAULT_BASE bình thường (purpose="generate")
    expect(createContextSpy).toHaveBeenCalledTimes(1); // context thường tạo ngay lúc nạp, không cần lười
  });
});
