/**
 * Pha 1.5 Task 2 — backend CUDA của `getLlama()` vào sổ.
 *
 * `getLlama()` (aiGgufEngine.ts:331) là hàm NỘI BỘ, KHÔNG export — cùng quy ước với mọi hàm
 * private khác của file này (`ensureCapacity`, `evictLRU`, `resolveModelPath`, ...), luôn được
 * kiểm qua một hàm export thật sự chạm nó. `loadGgufModel()` là điểm chạm đó (dòng 727:
 * `const llama = await getLlama();`) — dùng lại đúng quy ước mock của
 * `wiring.inprocess.test.ts` (mock `node-llama-cpp` tối thiểu đủ cho `loadGgufModel` chạy hết).
 *
 * ⚠ QUY ƯỚC MODULE-IDENTITY (như wiring.inprocess.test.ts): `vi.resetModules()` tạo một THẾ HỆ
 * module mới; mọi lượt `import()` (sản xuất lẫn sổ cái `./vramBroker`) phải nằm TRONG thân test,
 * SAU CÙNG một `vi.resetModules()`, nếu không test soi vào một sổ khác và luôn thấy rỗng.
 *
 * ⚠ ĐẦU DÒ: khoảnh khắc `beginVramAllocation` mở ra CHO CHÍNH backend CUDA nằm TRƯỚC
 * `setLlamaInstanceHandle()` (nó chỉ được nối SAU khi backend đã khởi tạo xong) — ở lượt gọi
 * ĐẦU TIÊN của cả tiến trình, `vramProbe.probeOnce()` chưa có handle native nên sẽ lùi về
 * `nvidia-smi` thật (subprocess) nếu không bị mock — chậm và không tất định trong CI. Test này
 * mock thẳng `./vramProbe` để điều khiển được delta TRƯỚC/SAU một cách tất định, và (Task 1 vừa
 * thêm) luôn kèm `source: "native" | "smi"` — thiếu trường đó test có thể đỏ vì lý do SAI.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const GiB = 1024 * 1024 * 1024;

/** Delta giả cho lượt khởi tạo backend CUDA — tách biệt khỏi mọi delta khác trong test này. */
const BACKEND_DELTA = 430 * 1024 * 1024;

/** "VRAM thiết bị" giả dùng CHUNG cho mock node-llama-cpp (loadModel/createContext...). */
const gpu = vi.hoisted(() => ({ used: 2 * 1024 * 1024 * 1024 }));

const nlcFactory = vi.hoisted(() => () => {
  const makeModel = () => ({
    size: 1234,
    tokenize: (t: string) => t.split(" "),
    createContext: async () => ({
      getSequence: () => ({ dispose: () => {} }),
      dispose: async () => {},
    }),
    createEmbeddingContext: async () => ({
      getEmbeddingFor: async () => ({ vector: new Array(1024).fill(0.01) }),
      dispose: async () => {},
    }),
    dispose: async () => {},
  });
  return {
    getLlama: async () => ({
      loadModel: async (_o: unknown) => makeModel(),
      getVramState: async () => ({
        total: 32 * GiB,
        used: gpu.used,
        free: 32 * GiB - gpu.used,
        unifiedSize: 0,
      }),
      createGrammarForJsonSchema: async () => ({ parse: (s: string) => JSON.parse(s) }),
    }),
    LlamaChatSession: class {
      constructor(_o: unknown) {}
      async prompt(_p: string, _o?: unknown) {
        return "ok";
      }
    },
    LlamaJsonSchemaGrammar: class {},
    LlamaLogLevel: { fatal: "fatal", error: "error", warn: "warn", info: "info" },
  };
});
vi.mock("node-llama-cpp", nlcFactory);

const fsApi = vi.hoisted(() => ({
  existsSync: () => true,
  mkdirSync: () => {},
  statSync: () => ({ size: 777 * 1024 * 1024, mtime: new Date(), isFile: () => true }),
}));
vi.mock("fs", () => ({ default: fsApi, ...fsApi }));
vi.mock("node:fs", () => ({ default: fsApi, ...fsApi }));

/**
 * Đầu dò VRAM giả, TÁCH KHỎI `gpu.used` của node-llama-cpp: lượt gọi thứ HAI (đúng ngay sau
 * `initLlama()` thật của backend CUDA, trước bất kỳ delta nào khác) cộng thêm BACKEND_DELTA —
 * mô phỏng ~430 MiB mà Pha 1 đo được quanh lượt khởi tạo backend. Mọi lượt đo khác (trước lượt
 * 2, và mọi lượt sau) giữ nguyên ⇒ chỉ MỘT delta khác 0 trong toàn bộ test, đúng bằng BACKEND_DELTA.
 */
const probeState = vi.hoisted(() => ({ used: 2 * 1024 * 1024 * 1024, calls: 0 }));
vi.mock("./vramProbe", () => ({
  readDeviceVramUncached: async () => {
    probeState.calls++;
    if (probeState.calls === 2) probeState.used += BACKEND_DELTA;
    return { usedBytes: probeState.used, totalBytes: 32 * GiB, source: "native" as const };
  },
  readDeviceVram: async () => ({ usedBytes: probeState.used, totalBytes: 32 * GiB, source: "native" as const }),
  __clearProbeCache: () => {},
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  // vi.resetModules() KHÔNG gỡ vi.doMock — đặt lại tường minh mọi thứ mock BẰNG TAY mỗi test,
  // đúng bài học wiring.inprocess.test.ts.
  vi.doUnmock("./vramBroker");
  vi.doUnmock("./vramEventLog");
  vi.doUnmock("./vramEstimator");
  vi.doMock("node-llama-cpp", nlcFactory); // đặt lại bản giả MẶC ĐỊNH (không test nào ở file này ghi đè riêng)
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  process.env.GGUF_DEFAULT_MODEL = "Qwen3-Test.gguf";
  process.env.GGUF_MAX_LOADED_MODELS = "8";
  process.env.GGUF_MAX_VRAM_MB = "0";
  process.env.GGUF_MAX_CONCURRENCY = "4";
  gpu.used = 2 * GiB;
  probeState.used = 2 * GiB;
  probeState.calls = 0;
});

describe("backend CUDA — khoản ~430 MiB lớn nhất của sàn cấu trúc", () => {
  it("★ getLlama() ghi giấy phép gguf-backend ở mức PRODUCTION, với delta THẬT quanh initLlama()", async () => {
    const { __resetBrokerForTests, snapshot } = await import("./vramBroker");
    __resetBrokerForTests();
    const { loadGgufModel } = await import("../aiGgufEngine");

    await loadGgufModel({ modelPath: "Model-A.gguf" });

    const l = snapshot().leases.find((x) => x.request.owner === "cuda-backend");
    expect(l).toBeDefined();
    expect(l!.request.kind).toBe("gguf-backend");
    expect(l!.request.priority).toBe("production");
    expect(l!.actualBytes).toBe(BACKEND_DELTA);
  });

  it("nạp HAI model khác nhau: getLlama() chỉ chạm backend MỘT lần ⇒ chỉ MỘT giấy phép cuda-backend (singleton cả tiến trình)", async () => {
    const { __resetBrokerForTests, snapshot } = await import("./vramBroker");
    __resetBrokerForTests();
    const { loadGgufModel } = await import("../aiGgufEngine");

    await loadGgufModel({ modelPath: "Model-A.gguf" });
    await loadGgufModel({ modelPath: "Model-B.gguf" });

    expect(snapshot().leases.filter((x) => x.request.owner === "cuda-backend")).toHaveLength(1);
  });

  /**
   * Bài học Task 1 (Pha 1.5) — "nếu nhánh mới kích hoạt SAI thì bao lâu nó tự lành?". Backend
   * là singleton (`llamaInstance` chỉ gán SAU khi `initLlama()` xong); nếu nó NÉM giữa lúc
   * `beginVram()` đã mở giấy phép, `llamaInstance` VẪN null ⇒ lượt gọi kế tiếp lại chạy lại
   * đúng khối này. Không trả giấy phép ở nhánh lỗi ⇒ mỗi lượt retry đẻ thêm MỘT giấy phép
   * "cuda-backend" treo vĩnh viễn trong sổ (không bao giờ tự lành, vì owner này không có đường
   * release nào khác). Ca này canh: thất bại KHÔNG để lại giấy phép ma.
   */
  it("initLlama() ném ⇒ giấy phép cuda-backend được TRẢ ngay — lượt retry sau không đẻ thêm giấy phép treo", async () => {
    vi.doMock("node-llama-cpp", () => ({
      getLlama: async () => {
        throw new Error("CUDA driver mismatch (ca thử nghiệm)");
      },
    }));

    const { __resetBrokerForTests, snapshot } = await import("./vramBroker");
    __resetBrokerForTests();
    const { loadGgufModel } = await import("../aiGgufEngine");

    await expect(loadGgufModel({ modelPath: "Model-A.gguf" })).rejects.toThrow(/node-llama-cpp is not available/);
    await expect(loadGgufModel({ modelPath: "Model-B.gguf" })).rejects.toThrow(/node-llama-cpp is not available/);

    expect(snapshot().leases.filter((x) => x.request.owner === "cuda-backend")).toHaveLength(0);
  });
});
