/**
 * Đợt 2 Task 3 — model nhúng thôi trả tiền hai lần.
 *
 * (a) loadGgufModel() (~684-691) tạo context THƯỜNG (GGUF_DEFAULT_CTX×GGUF_SEQUENCES) cho
 *     MỌI model nó nạp, kể cả model chỉ dùng để nhúng — model đó không bao giờ sinh chữ. Đo
 *     Đợt 1: model + ctx thường = 3.649 MiB · embedding ctx = 654 MiB ⇒ dư địa ước ~2,0 GB.
 * (b) getEmbeddingContext() (~2281, cách chỗ Đợt 1 Task 1 vá cho loadGgufModel() 3 dòng)
 *     KHÔNG có khoá in-flight — nhiều lượt generateEmbedding() đồng thời trên CÙNG model đều
 *     thấy loaded.embeddingContext rỗng (chưa kịp ghi) và cùng gọi createEmbeddingContext()
 *     song song. Đo: 4 lượt tuần tự = 654 MiB; đồng thời = 2.430 MiB (+1.776 MiB, đỉnh nhất
 *     thời vài giây, không rò vĩnh viễn). Tới được thật vì GGUF_MAX_CONCURRENCY=4 (.env) và
 *     6 nơi gọi do HTTP điều khiển.
 *
 * ⚠ Mẫu test trong brief gọi generateEmbedding() KHÔNG truyền modelId — nhưng GGUF_EMBED_MODEL
 * không được nạp trong môi trường test (vitest.setup.ts không đọc .env, xác nhận ở
 * docs/superpowers/reports/2026-08-02-dot2-report.md §2), nên effectiveId sẽ rơi vào nhánh dự
 * phòng "không có modelId" của getOrLoadModel() (~1041-1066) — KHÁC nhánh chính (~1069-1071)
 * mà đường nhúng thật (GGUF_EMBED_MODEL đã cấu hình trong .env) luôn đi qua. Sửa: truyền
 * modelId TƯỜNG MINH — đúng quy ước sẵn có ở aiGgufEngine.test.ts / aiGgufEngine.embedCtx.
 * test.ts (`generateEmbedding(text, "embed-model")`) — để cả hai lượt gọi hội tụ về ĐÚNG MỘT
 * modelId một cách xác định, không phụ thuộc env.
 *
 * ⚠ Test 2 CẦN process.env.GGUF_MAX_CONCURRENCY >= 2 TRƯỚC khi import module: mặc định thật
 * của server/services/ggufConcurrency.ts là 1 (semaphore toàn cục, đọc env ở module-scope).
 * Với concurrency=1, withGgufSlot() tự XẾP HÀNG hai lượt generateEmbedding() — chúng không
 * bao giờ thực sự chồng nhau trong tiến trình test, khiến test XANH GIẢ (không chứng minh
 * được khoá in-flight) bất kể getEmbeddingContext() có khoá hay không. Production đặt
 * GGUF_MAX_CONCURRENCY=4 (.env) — chính là lý do race này "tới được thật" ngoài đời, đúng như
 * brief ghi.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const createContextSpy = vi.fn();
const createEmbeddingContextSpy = vi.fn();

vi.mock("node-llama-cpp", () => ({
  getLlama: vi.fn(async () => ({
    loadModel: async (opts: any) => ({
      __id: opts.modelPath,
      size: 1234,
      tokenize: (t: string) => t.split(" "),
      createContext: async (o: any) => {
        createContextSpy(o);
        return { getSequence: () => ({ dispose: () => {} }), dispose: async () => {} };
      },
      createEmbeddingContext: async (o: any) => {
        createEmbeddingContextSpy(o);
        // Giả lập nạp chậm để hai lượt gọi ĐỒNG THỜI chắc chắn chồng nhau (race thật, không
        // phải giả định) — cùng khuôn với aiGgufEngine.inflight.test.ts (Đợt 1 Task 1).
        await new Promise((r) => setTimeout(r, 50));
        return {
          getEmbeddingFor: async () => ({ vector: new Array(1024).fill(0.1) }),
          dispose: async () => {},
        };
      },
      dispose: async () => {},
    }),
    getVramState: async () => ({
      used: 1_000_000_000,
      total: 32_000_000_000,
      free: 31_000_000_000,
      unifiedSize: 0,
    }),
  })),
}));

// fs mock theo đúng quy ước sẵn có ở aiGgufEngine.test.ts / .inflight.test.ts / .embedCtx.test.ts:
// loadGgufModel() → resolveModelPath() gọi fs.existsSync() THẬT trên đĩa. Không mock thì
// resolveModelPath() throw "file not found" trước khi chạm tới chỗ cần kiểm (mock không mô tả
// đúng thế giới thật).
vi.mock("fs", () => {
  const api = {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => [] as string[]),
    statSync: vi.fn(() => ({ size: 1234, mtime: new Date() })),
  };
  return { default: api, ...api };
});

describe("model nhúng — thôi trả tiền hai lần (Đợt 2 Task 3)", () => {
  beforeEach(() => {
    createContextSpy.mockClear();
    createEmbeddingContextSpy.mockClear();
    vi.resetModules();
    process.env.GGUF_EMBED_DIM = "1024";
    process.env.GGUF_MAX_CONCURRENCY = "4"; // xem cảnh báo ở đầu file — bắt buộc >1
    delete process.env.GGUF_MAX_VRAM_MB;
  });

  it("KHÔNG tạo context thường (createContext) cho model chỉ dùng để nhúng", async () => {
    const { generateEmbedding } = await import("./aiGgufEngine");
    await generateEmbedding("một câu tiếng Việt", "embed-model");
    expect(createContextSpy).not.toHaveBeenCalled();
  });

  it("hai lượt nhúng ĐỒNG THỜI trên CÙNG model chỉ tạo MỘT embedding context", async () => {
    const { generateEmbedding } = await import("./aiGgufEngine");
    await Promise.all([
      generateEmbedding("câu A", "embed-model"),
      generateEmbedding("câu B", "embed-model"),
    ]);
    expect(createEmbeddingContextSpy).toHaveBeenCalledTimes(1);
  });
});
