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

/**
 * Review vòng 1 — Important: đếm số lượt `initLlama()` (tức `getLlama` xuất khẩu bởi
 * node-llama-cpp, KHÔNG nhầm với hàm nội bộ `aiGgufEngine.getLlama()`) THẬT SỰ chạy. Ca đua
 * (Promise.all) canh trực tiếp con số này — sổ đúng MỘT giấy phép nhưng `initLlama()` chạy HAI
 * lần vẫn là race chưa vá (giấy phép thứ hai ghi ĐÈ, không phải bị chặn thật).
 */
const initCalls = vi.hoisted(() => ({ count: 0 }));

/**
 * Cờ điều khiển được TỪ TRONG một test, KHÔNG cần `vi.doMock` + `vi.resetModules()` giữa
 * chừng — đổi mock qua `doMock`/`resetModules()` giữa một test sẽ tạo THẾ HỆ MODULE MỚI (state
 * `llamaInitInFlight`/`llamaInstance` trong sản xuất bị xoá theo), nên một lượt "thử lại sau khi
 * hỏng" kiểm qua đường đó KHÔNG chứng minh được gì về khoá của THẾ HỆ CŨ. Cờ này giữ nguyên MỘT
 * thế hệ module xuyên suốt cả test: lượt đầu ném thật, lượt sau (cùng generation) thành công
 * thật — đúng test "retry tự lành" cần.
 */
const initFail = vi.hoisted(() => ({ on: false }));

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
    getLlama: async () => {
      initCalls.count++;
      if (initFail.on) throw new Error("CUDA driver mismatch (ca thử nghiệm, đang có người chờ)");
      return {
        loadModel: async (_o: unknown) => makeModel(),
        getVramState: async () => ({
          total: 32 * GiB,
          used: gpu.used,
          free: 32 * GiB - gpu.used,
          unifiedSize: 0,
        }),
        createGrammarForJsonSchema: async () => ({ parse: (s: string) => JSON.parse(s) }),
      };
    },
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
  readDeviceVramUncached: async () => ({ usedBytes: probeState.used, totalBytes: 32 * GiB, source: "native" as const }),
  readDeviceVram: async () => ({ usedBytes: probeState.used, totalBytes: 32 * GiB, source: "native" as const }),
  __clearProbeCache: () => {},
}));

/**
 * ★ Pha 2A Task 3 — ĐẦU DÒ CỦA ĐƯỜNG ĐO NAY LÀ BỘ ĐẾM THEO TIẾN TRÌNH. Logic "lượt đọc thứ HAI
 * cộng BACKEND_DELTA" chuyển nguyên vẹn sang đây: hai đầu đo của cửa sổ backend là lượt 1 và 2,
 * nên delta đo được vẫn đúng bằng BACKEND_DELTA và chỉ MỘT delta khác 0 trong cả test.
 * `./vramProbe` ở trên giữ lại cho reconciler/nền — Đ4: hai thước, không trộn.
 */
const processProbeFactory = vi.hoisted(() => () => ({
  readProcessVram: async () => {
    probeState.calls++;
    if (probeState.calls === 2) probeState.used += BACKEND_DELTA;
    return {
      totalBytes: probeState.used,
      byPid: new Map<number, number>([[process.pid, probeState.used]]),
      byLuid: new Map<string, number>(),
      sampledAtMs: Date.now(),
    };
  },
  /**
   * ★ Pha 2A Task 6 — BẢN GIẢ CỦA BIÊN LẮNG, cố ý KHÔNG chờ. Bộ test này không đo bộ đếm thật nên
   * chờ 250 ms mỗi lượt `commitMeasured()` chỉ là thời gian chết. Biên lắng THẬT được canh ở
   * `wiring.settle.test.ts` (thứ tự gọi + sàn của hằng số) — nơi duy nhất được phép khẳng định nó.
   * ⚠ PHẢI khai ở MỌI bản giả của module này: `vramWiring` để lời gọi NÉM nếu thiếu (không nuốt).
   */
  awaitCounterSettle: async () => {},
}));
vi.mock("./vramProcessProbe", processProbeFactory);

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  // vi.resetModules() KHÔNG gỡ vi.doMock — đặt lại tường minh mọi thứ mock BẰNG TAY mỗi test,
  // đúng bài học wiring.inprocess.test.ts.
  vi.doUnmock("./vramBroker");
  vi.doUnmock("./vramEventLog");
  vi.doUnmock("./vramEstimator");
  vi.doMock("node-llama-cpp", nlcFactory); // đặt lại bản giả MẶC ĐỊNH (không test nào ở file này ghi đè riêng)
  vi.doMock("./vramProcessProbe", processProbeFactory);
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  process.env.GGUF_DEFAULT_MODEL = "Qwen3-Test.gguf";
  process.env.GGUF_MAX_LOADED_MODELS = "8";
  process.env.GGUF_MAX_VRAM_MB = "0";
  process.env.GGUF_MAX_CONCURRENCY = "4";
  gpu.used = 2 * GiB;
  probeState.used = 2 * GiB;
  probeState.calls = 0;
  initCalls.count = 0;
  initFail.on = false;
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

  /**
   * Review vòng 1, Important — `if (llamaInstance) return llamaInstance` (đầu `getLlama()`)
   * KHÔNG nguyên tử. `inFlightLoads` khoá theo MODEL ID nên KHÔNG chặn được hai model KHÁC
   * NHAU cùng gọi `getLlama()` trong lúc lượt đầu còn đang `await import("node-llama-cpp")` —
   * cả hai đều thấy `llamaInstance === null` và đều chạy tiếp xuống dưới. Race có sẵn từ BASE;
   * Task 2 nới cửa sổ đua (thêm hai `await` — `beginVram()`/`commitMeasured()`) và gắn một hệ
   * quả MỚI: sổ ghi HAI giấy phép "cuda-backend" cho một backend thật. Đây đúng dữ liệu Task 6
   * (Ư0) sẽ đọc để biết "lúc đó ai đang giữ gì" khi CUDA context được tạo.
   */
  it("ĐUA: hai loadGgufModel() cho HAI model khác nhau chạy ĐỒNG THỜI (Promise.all) ⇒ initLlama() chạy ĐÚNG MỘT lần, sổ chỉ MỘT giấy phép cuda-backend", async () => {
    const { __resetBrokerForTests, snapshot } = await import("./vramBroker");
    __resetBrokerForTests();
    const { loadGgufModel } = await import("../aiGgufEngine");

    await Promise.all([
      loadGgufModel({ modelPath: "Model-A.gguf" }),
      loadGgufModel({ modelPath: "Model-B.gguf" }),
    ]);

    expect(initCalls.count).toBe(1);
    expect(snapshot().leases.filter((x) => x.request.owner === "cuda-backend")).toHaveLength(1);
  });

  /**
   * Bài học Task 1 áp lại cho CHÍNH khoá in-flight mới thêm — "nếu khoá kích hoạt SAI thì bao
   * lâu tự lành?". Ca: `initLlama()` NÉM trong khi một lượt gọi thứ hai đang CHỜ (đã tham gia
   * cùng một `initPromise`/khoá). Cả hai lượt gọi phải cùng nhận lỗi (không lượt nào treo vô
   * hạn), khoá phải được xoá (không phải một `finally` bị bỏ sót), và lượt gọi TIẾP THEO (retry,
   * `initLlama()` nay thành công) phải nạp được — không kẹt lại vĩnh viễn vì khoá không được dọn.
   */
  it("initLlama() ném trong khi lượt thứ hai đang CHỜ ⇒ CẢ HAI nhận lỗi, khoá được dọn, lượt retry sau (CÙNG thế hệ module) nạp được", async () => {
    // ⚠ initFail (không phải vi.doMock + resetModules() giữa chừng): đổi module mock giữa test
    // sẽ tạo THẾ HỆ MODULE MỚI — `llamaInstance`/khoá in-flight của sản xuất bị xoá theo, nên một
    // lượt "thử lại" qua đường đó luôn thành công dù có bug hay không, không chứng minh được gì.
    // Cờ này giữ NGUYÊN một thế hệ xuyên suốt: lượt đầu ném thật, lượt sau (cùng generation,
    // cùng biến khoá) thành công thật — mới canh đúng "khoá có được DỌN hay không".
    initFail.on = true;

    const { __resetBrokerForTests, snapshot } = await import("./vramBroker");
    __resetBrokerForTests();
    const { loadGgufModel } = await import("../aiGgufEngine");

    const results = await Promise.allSettled([
      loadGgufModel({ modelPath: "Model-A.gguf" }),
      loadGgufModel({ modelPath: "Model-B.gguf" }),
    ]);

    // Cả hai lượt gọi (khởi xướng lẫn chờ) đều phải NHẬN LỖI — không lượt nào treo vô hạn hay
    // âm thầm "thành công" nhờ khoá.
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("rejected");
    expect(String((results[0] as PromiseRejectedResult).reason)).toMatch(/node-llama-cpp is not available/);
    expect(String((results[1] as PromiseRejectedResult).reason)).toMatch(/node-llama-cpp is not available/);

    // Đúng MỘT lượt initLlama() thật đã chạy cho cả cặp đang chờ (khoá gộp chúng lại) — không
    // phải hai lượt độc lập đều tự ném.
    expect(initCalls.count).toBe(1);

    // Không giấy phép treo sau lượt hỏng.
    expect(snapshot().leases.filter((x) => x.request.owner === "cuda-backend")).toHaveLength(0);

    // Khoá PHẢI được dọn: initLlama() nay thành công (CÙNG thế hệ module, CÙNG biến khoá) —
    // nếu khoá còn kẹt (finally bị bỏ sót), lượt này treo vô hạn thay vì resolve.
    initFail.on = false;
    await expect(loadGgufModel({ modelPath: "Model-C.gguf" })).resolves.toBe("Model-C");
    expect(initCalls.count).toBe(2);
    expect(snapshot().leases.filter((x) => x.request.owner === "cuda-backend")).toHaveLength(1);
  });
});
