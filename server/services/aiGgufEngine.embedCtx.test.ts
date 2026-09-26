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
 * SỬA SAU REVIEW VÒNG 1 (Important): brief gốc ước lượng chunk dài nhất "~600 token" từ
 * `maxChunkChars=1800` trong knowledge/chunks-stats.json — đây là TRẦN CÔNG BỐ, không phải
 * trần được thực thi (scripts/ai-kb/build-knowledge-chunks.mjs không chặn cứng khi gặp khối
 * không có ranh giới câu/đoạn, ví dụ bảng markdown). Đo THẬT bằng tokenizer của chính model
 * nhúng (Qwen3-Embedding-0.6B) trên chunk dài nhất thực tế trong knowledge/chunks.jsonl
 * (id "doc:docs/ECOSYSTEM/27_AOI_AVI_END_TO_END_AUDIT_UPGRADE_PLAN_2026-07.md#23", 6.135 ký
 * tự): **1.879 token thật** — vượt EMBED_CTX=1024 tới 83%. node-llama-cpp KHÔNG cắt âm thầm
 * khi input vượt contextSize — nó THROW ("Input is longer than the context size...").
 *
 * ⚠ ĐÍNH CHÍNH 2026-08-02 (Đợt 2 Task 4 + Task 6) — câu tiếp theo của comment này SAI, đã sửa:
 * bản cũ viết *"throw đó bị kbVectorStore.ts:68 (ingestKbChunks) nuốt thành skipped++ nên nội
 * dung âm thầm vắng mặt khỏi kb_chunks"*. Task 4 đọc mã thật và `git blame`: hàm đó nằm ở
 * `server/services/kb/kbVectorStore.ts` (KHÔNG phải `server/services/kbVectorStore.ts` — hai
 * file khác nhau, cả hai đều sống), và `catch` quanh `generateEmbedding()` **ĐÃ log**
 * `[KB] embed/store failed for <docId>: <err.message>` từ **commit gốc `e4e24aa6` (2026-06-24)`**,
 * tức TRƯỚC cả Đợt 0 — chưa từng im lặng. ⇒ Lý do nâng EMBED_CTX **không phải** "lỗi bị nuốt"
 * mà là: chunk dài nhất THẬT sẽ throw ⇒ nó bị **bỏ qua (skipped) và thiếu khỏi `kb_chunks`** —
 * ồn ào trong log, nhưng vẫn là mất dữ liệu nếu không ai đọc log. (Ba đường `skipped++` khác
 * nhau nay được đếm riêng — Đợt 2 Task 4.)
 *
 * EMBED_CTX nâng lên 2048 (biên ~9% so với 1.879) để chunk dài nhất THẬT đi qua được mà không
 * throw. Chi tiết: docs/superpowers/reports/2026-08-02-dot2-report.md §4.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Đếm opts thực sự truyền vào createEmbeddingContext — đây là nơi "auto" bị bắt quả tang.
const createEmbeddingContextSpy = vi.fn();

// Tokenizer giả — đếm theo "từ" cách nhau bởi khoảng trắng (giống quy ước tokenize() giả ở
// aiGgufEngine.test.ts). Không cần khớp CHÍNH XÁC BPE thật của model, chỉ cần mô phỏng đúng
// QUAN HỆ NHÂN QUẢ: input càng dài → càng nhiều token → càng dễ vượt contextSize.
const fakeTokenize = (t: string) => t.split(/\s+/).filter(Boolean);

vi.mock("node-llama-cpp", () => ({
  getLlama: vi.fn(async () => ({
    loadModel: async (opts: any) => ({
      __id: opts.modelPath,
      size: 1234,
      embeddingVectorSize: 1024,
      tokenize: fakeTokenize,
      createContext: async () => ({
        getSequence: () => ({ dispose: () => {} }),
        dispose: async () => {},
      }),
      createEmbeddingContext: async (ctxOpts: any) => {
        createEmbeddingContextSpy(ctxOpts);
        const ctxSize = typeof ctxOpts.contextSize === "number" ? ctxOpts.contextSize : Infinity;
        return {
          // Mô phỏng ĐÚNG hành vi thật của node-llama-cpp đã kiểm chứng thực nghiệm: input
          // vượt contextSize thì THROW, KHÔNG cắt âm thầm. Nếu mock cắt âm thầm ở đây, test
          // sẽ không bao giờ bắt được lỗi Important vừa phát hiện (mock không mô tả thế giới thật).
          getEmbeddingFor: async (text: string) => {
            const tokenCount = fakeTokenize(text).length;
            if (tokenCount > ctxSize) {
              throw new Error(
                `Input is longer than the context size that this LlamaContext was created with (${tokenCount} > ${ctxSize})`,
              );
            }
            return { vector: new Array(1024).fill(0.1) };
          },
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

/** Số token THẬT đo được (bằng tokenizer của chính model nhúng) trên chunk dài nhất hiện có
 *  trong knowledge/chunks.jsonl — xem chú thích ở đầu file để biết cách đo. */
const REAL_LONGEST_CHUNK_TOKENS = 1879;

/** Chuỗi giả có ĐÚNG REAL_LONGEST_CHUNK_TOKENS "từ" — dùng fakeTokenize ở trên để đếm, không
 *  phụ thuộc nội dung thật của knowledge/chunks.jsonl (test tự chứa, không đọc đĩa). */
function buildTextWithTokens(n: number): string {
  return Array.from({ length: n }, (_, i) => `từ${i}`).join(" ");
}

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

  it("ngữ cảnh đủ chứa chunk dài nhất THẬT (1.879 token đo bằng tokenizer thật) và có biên an toàn", async () => {
    const { generateEmbedding } = await import("./aiGgufEngine");
    await generateEmbedding("một câu tiếng Việt để nhúng", "embed-model");

    const opts = createEmbeddingContextSpy.mock.calls[0][0];
    expect(typeof opts.contextSize).toBe("number");
    // SỬA review vòng 1: 1024 (dựa trên maxChunkChars=1800 ⇒ ước ~600 token) là SAI — chunk
    // dài nhất THẬT đo được là 1.879 token. Trần dưới phải phủ được số thật, không phải ước lượng.
    expect(opts.contextSize).toBeGreaterThanOrEqual(REAL_LONGEST_CHUNK_TOKENS);
    expect(opts.contextSize).toBeLessThanOrEqual(4096); // không quay lại cấp thừa như "auto"
  });

  it("KHÔNG throw khi nhúng input dài bằng đúng chunk RAG thật dài nhất (1.879 token) — review round 1 Important", async () => {
    const { generateEmbedding } = await import("./aiGgufEngine");
    const longestRealChunkEquivalent = buildTextWithTokens(REAL_LONGEST_CHUNK_TOKENS);

    // Trước khi vá (EMBED_CTX=1024 < 1.879): node-llama-cpp THROW "Input is longer than the
    // context size...". Throw đó bị kbVectorStore.ts:68 nuốt thành skipped++ trong sản xuất —
    // nội dung âm thầm vắng mặt khỏi kb_chunks. Test này phải xanh, tức KHÔNG được throw.
    await expect(generateEmbedding(longestRealChunkEquivalent, "embed-model")).resolves.toMatchObject({
      dimensions: 1024,
    });
  });
});
