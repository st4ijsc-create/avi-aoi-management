/**
 * Đợt 1 Task 1 — khoá in-flight cho loadGgufModel().
 *
 * Bối cảnh: hai nơi ĐỘC LẬP trong app cùng gọi warmModel(GGUF_DEFAULT_MODEL) khi khởi
 * động (backgroundJobs.ts delay 3000ms và aiLocalKnowledgeApi.ts delay 2000ms). Cả hai
 * đường đều đi qua loadGgufModel() — hàm này KHÔNG có khoá nên khi hai lượt gọi cùng
 * modelId chồng lên nhau, cả hai đều vượt qua `loadedModels.has()` (model chưa kịp nạp
 * xong ở lượt đầu) và cùng gọi llama.loadModel() song song. Với model 30B: lượt hai
 * cudaMalloc lỗi (không đủ VRAM cho 2 bản 17GB cùng lúc) ⇒ 45/45 lượt boot thất bại. Với
 * model 4B: cả hai lượt đều thành công, `loadedModels.set()` (vô điều kiện) bị ghi đè,
 * bản đầu mồ côi ~3.474 MiB mà evictLRU() không với tới ⇒ rò VRAM, chỉ restart mới dọn.
 *
 * Test này tái hiện race bằng loadModel giả nạp chậm (setTimeout 50ms) — nếu không có
 * khoá, hai lượt gọi Promise.all() chắc chắn chồng nhau và loadModel bị gọi 2 lần.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Đếm số lần thực sự chạm tới lớp nạp model nặng (loadModel của node-llama-cpp).
const loadModelSpy = vi.fn();

vi.mock("node-llama-cpp", () => ({
  getLlama: vi.fn(async () => ({
    loadModel: async (opts: any) => {
      loadModelSpy(opts);
      // Giả lập nạp chậm để hai lượt gọi chắc chắn chồng nhau (race thật, không phải giả định).
      await new Promise((r) => setTimeout(r, 50));
      return {
        createContext: async () => ({ dispose: async () => {} }),
        createEmbeddingContext: async () => ({ dispose: async () => {} }),
        dispose: async () => {},
      };
    },
    getVramState: async () => ({ used: 1_000_000_000, total: 32_000_000_000 }),
  })),
}));

// fs bị mock giống server/services/aiGgufEngine.test.ts đang có sẵn: loadGgufModel() gọi
// resolveModelPath() → fs.existsSync() THẬT trên đĩa để kiểm tra file model có tồn tại
// không. Test này không có file .gguf thật nào trên đĩa (mục đích: race condition thuần,
// không phụ thuộc file lớn) — nếu KHÔNG mock fs, resolveModelPath() sẽ throw "file not
// found" NGAY LẬP TỨC ở cả hai lượt gọi, loadModelSpy không bao giờ được chạm tới, và test
// không chứng minh được gì về khoá in-flight (mock không mô tả đúng thế giới thật).
vi.mock("fs", () => {
  const api = {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => [] as string[]),
    statSync: vi.fn(() => ({ size: 1234, mtime: new Date() })),
  };
  return { default: api, ...api };
});

describe("loadGgufModel — khoá in-flight", () => {
  beforeEach(() => {
    loadModelSpy.mockClear();
    vi.resetModules();
  });

  it("hai lượt gọi ĐỒNG THỜI cùng một model chỉ nạp MỘT lần", async () => {
    const { loadGgufModel } = await import("./aiGgufEngine");
    const cfg = { modelPath: "test-model.gguf" } as any;

    const [a, b] = await Promise.all([loadGgufModel(cfg), loadGgufModel(cfg)]);

    expect(a).toBe(b);
    expect(loadModelSpy).toHaveBeenCalledTimes(1); // ĐỎ trước khi vá: sẽ là 2
  });

  it("lượt gọi SAU khi lượt đầu xong vẫn dùng lại model đã nạp, không nạp lại", async () => {
    const { loadGgufModel } = await import("./aiGgufEngine");
    const cfg = { modelPath: "test-model.gguf" } as any;

    await loadGgufModel(cfg);
    await loadGgufModel(cfg);

    expect(loadModelSpy).toHaveBeenCalledTimes(1);
  });
});
