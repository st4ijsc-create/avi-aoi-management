/**
 * Đợt 1 Task 2 — ngân sách contextSize cho embedding context.
 *
 * Bối cảnh: getEmbeddingContext() (aiGgufEngine.ts ~2258-2273) gọi
 * model.createEmbeddingContext({ contextSize: "auto", ... }). "auto" cấp phát TOÀN BỘ
 * cửa sổ ngữ cảnh mà model nhúng được huấn luyện — Đợt 0 đo được model 0.6B (file chỉ
 * 1,2 GB) chiếm 5.664 MiB VRAM, tức ~4,5 GB là buffer thừa không dùng tới. Model nhúng
 * còn được nạp kèm một context thường (createContext, GGUF_DEFAULT_CTX=4096) mà nó
 * không bao giờ dùng để sinh chữ — "auto" ở đây là trả tiền lần thứ hai cho một cửa sổ
 * ngữ cảnh không tương xứng với nhu cầu thật.
 *
 * Chunk RAG dài nhất: maxChunkChars=1800 (knowledge/chunks-stats.json) ⇒ ~600 token.
 * contextSize cố định 1024 là dư ~70% biên an toàn, không còn phụ thuộc "auto".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Đếm opts thực sự truyền vào createEmbeddingContext — đây là nơi "auto" bị bắt quả tang.
const createEmbeddingContextSpy = vi.fn();

vi.mock("node-llama-cpp", () => ({
  getLlama: vi.fn(async () => ({
    loadModel: async (opts: any) => ({
      __id: opts.modelPath,
      size: 1234,
      embeddingVectorSize: 1024,
      createContext: async () => ({
        getSequence: () => ({ dispose: () => {} }),
        dispose: async () => {},
      }),
      createEmbeddingContext: async (ctxOpts: any) => {
        createEmbeddingContextSpy(ctxOpts);
        return {
          getEmbeddingFor: async () => ({ vector: new Array(1024).fill(0.1) }),
          dispose: async () => {},
        };
      },
      dispose: async () => {},
    }),
    getVramState: async () => ({ used: 1_000_000_000, total: 32_000_000_000, free: 31_000_000_000, unifiedSize: 0 }),
  })),
}));

// fs mock theo đúng quy ước sẵn có ở aiGgufEngine.test.ts / aiGgufEngine.inflight.test.ts:
// loadGgufModel() → resolveModelPath() gọi fs.existsSync() THẬT trên đĩa. Không mock thì
// resolveModelPath() throw "file not found" trước khi chạm tới getEmbeddingContext(), và
// test không chứng minh được gì về contextSize (mock không mô tả đúng thế giới thật).
vi.mock("fs", () => {
  const api = {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => [] as string[]),
    statSync: vi.fn(() => ({ size: 1234, mtime: new Date() })),
  };
  return { default: api, ...api };
});

describe("getEmbeddingContext — ngân sách ngữ cảnh", () => {
  beforeEach(() => {
    createEmbeddingContextSpy.mockClear();
    vi.resetModules();
    process.env.GGUF_EMBED_DIM = "1024";
    delete process.env.GGUF_EMBED_CTX;
  });

  it("KHÔNG dùng contextSize 'auto' — nó cấp toàn bộ cửa sổ model", async () => {
    const { generateEmbedding } = await import("./aiGgufEngine");
    await generateEmbedding("một câu tiếng Việt để nhúng", "embed-model");

    expect(createEmbeddingContextSpy).toHaveBeenCalled();
    const opts = createEmbeddingContextSpy.mock.calls[0][0];
    expect(opts.contextSize).not.toBe("auto");
  });

  it("ngữ cảnh đủ chứa chunk dài nhất (~600 token) và có biên an toàn", async () => {
    const { generateEmbedding } = await import("./aiGgufEngine");
    await generateEmbedding("một câu tiếng Việt để nhúng", "embed-model");

    const opts = createEmbeddingContextSpy.mock.calls[0][0];
    expect(typeof opts.contextSize).toBe("number");
    expect(opts.contextSize).toBeGreaterThanOrEqual(1024); // chunk dài nhất ~600 token
    expect(opts.contextSize).toBeLessThanOrEqual(4096); // không quay lại cấp thừa
  });
});
