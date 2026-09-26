/**
 * ★ I-1 (vá sau review TOÀN NHÁNH) — `getLlama()` THỨ HAI của tiến trình, NGOÀI SỔ.
 *
 * Task 2 đưa backend CUDA (~430 MiB — khoản LỚN NHẤT của "sàn cấu trúc" Pha 1) vào sổ, nhưng chỉ
 * khép **MỘT** thể hiện: `aiGgufEngine.getLlama()`. `getRankingContext()` trong `aiReranker.ts` gọi
 * `getLlama({gpu:"auto"})` của node-llama-cpp **THẲNG**, còn `beginVramAllocation()` của nó thì mãi
 * ~20 dòng sau — tức backend nằm gọn trong `beforeUsed` của giấy phép model và **KHÔNG BAO GIỜ vào
 * sổ**. Chính comment cạnh lượt gọi đó tự khai: *"Runs on the reranker's own backend instance"*.
 * ⚠ N-6: **KHÔNG ghim số dòng** ở đây. Ba con trỏ dòng cứng của bản trước đã lệch ngay trong chính
 * commit thêm chúng — mô tả tương đối (grep được) là thứ sống sót qua lần sửa kế tiếp.
 *
 * ⚠ VÌ SAO PHẢI VÁ DÙ HÔM NAY 0 MiB: `.env` đang `RAG_RERANKER_GPU=false` ⇒ `gpu:false` ⇒ backend
 * không chiếm VRAM. **Một lần lật cờ** là Pha 2 tính `headroom` thiếu ~430 MiB — đúng quy luật Ư0
 * đã tự rút ("Task 2 chỉ khép MỘT thể hiện") và đúng lớp mù đã sinh ra hộ thứ sáu/thứ bảy.
 *
 * ⚠ HAI THỂ HIỆN LÀ CÓ THẬT ⇒ `types.ts` từng ghi `gguf-backend` là *"singleton cả tiến trình"* là
 * SAI; đã sửa cùng bản vá này. Ca 2 dưới đây canh CHÍNH cái sai đó: hai owner backend PHÂN BIỆT.
 *
 * ⚠ QUY ƯỚC MODULE-IDENTITY (như `wiring.backend.test.ts`): mã sản xuất `import()` ĐỘNG
 * `./vram/vramWiring` ⇒ mọi lượt import (sản xuất lẫn sổ cái) phải nằm TRONG thân test, SAU cùng
 * một `vi.resetModules()`, nếu không test soi vào MỘT SỔ KHÁC và xanh/đỏ đều sai lý do.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

/** Delta THẬT đo được ở Pha 1 quanh lượt khởi tạo backend CUDA (+431/+430/+431, 3 lượt). */
const BACKEND_DELTA = 430 * MiB;
/** Trọng số reranker bge trên GPU — nhỏ, và CỐ Ý khác BACKEND_DELTA để phân biệt được lease nào. */
const RERANKER_DELTA = 18 * MiB;

/**
 * "VRAM thiết bị" giả, do CHÍNH node-llama-cpp giả điều khiển (không đếm theo THỨ TỰ lượt đọc):
 * `getLlama()` cộng backend, `loadModel()` cộng trọng số. Đếm theo thứ tự sẽ lệ thuộc vào việc
 * bản vá có thêm hai lượt đo hay không ⇒ test sẽ đỏ/xanh vì SAI lý do.
 */
const gpu = vi.hoisted(() => ({ used: 2 * 1024 * 1024 * 1024 }));
const initCalls = vi.hoisted(() => ({ count: 0 }));
/**
 * ★ N-1 — `getLlama()` của node-llama-cpp **CACHE THEO THAM SỐ**: lượt gọi thứ hai với cùng options
 * trả về ĐÚNG thể hiện cũ và **KHÔNG cấp phát lại**. Bản giả phải mô phỏng đúng điều đó, nếu không
 * ca "hai lượt song song" sẽ đo một thế giới không tồn tại (mỗi lượt +430 MiB thật) và **giấu mất**
 * chính lỗi cần bắt: giấy phép thứ hai là một lease **MA 0 byte** cộng trùng vào sổ.
 */
const backendCache = vi.hoisted(() => ({ instance: null as unknown }));

const nlcFactory = vi.hoisted(() => () => ({
  getLlama: async (_o: unknown) => {
    initCalls.count++;
    if (backendCache.instance) return backendCache.instance;
    gpu.used += 430 * 1024 * 1024;
    backendCache.instance = {
      loadModel: async (_m: unknown) => {
        gpu.used += 18 * 1024 * 1024;
        return {
          createRankingContext: async () => ({
            rankAll: async (_q: string, docs: string[]) => docs.map((_d, i) => 1 - i / 10),
          }),
          dispose: async () => {},
        };
      },
      getVramState: async () => ({ total: 32 * 1024 * 1024 * 1024, used: gpu.used, free: 0, unifiedSize: 0 }),
    };
    return backendCache.instance;
  },
  LlamaLogLevel: { fatal: "fatal", error: "error", warn: "warn", info: "info" },
}));
vi.mock("node-llama-cpp", nlcFactory);

// aiReranker dùng `import fs from "node:fs"` và kiểm magic header GGUF bằng openSync/readSync ⇒
// mock phải phục vụ cả hai specifier và cả bốn hàm đó (đúng quy ước wiring.inprocess.test.ts).
const fsApi = vi.hoisted(() => ({
  existsSync: () => true,
  mkdirSync: () => {},
  statSync: () => ({ size: 606 * 1024 * 1024, mtime: new Date(), isFile: () => true }),
  openSync: () => 1,
  readSync: (_fd: number, buf: Buffer) => {
    buf[0] = 0x47;
    buf[1] = 0x47;
    buf[2] = 0x55;
    buf[3] = 0x46;
    return 4;
  },
  closeSync: () => {},
}));
vi.mock("fs", () => ({ default: fsApi, ...fsApi }));
vi.mock("node:fs", () => ({ default: fsApi, ...fsApi }));

vi.mock("./vramProbe", () => ({
  readDeviceVramUncached: async () => ({ usedBytes: gpu.used, totalBytes: 32 * 1024 * 1024 * 1024, source: "native" as const }),
  readDeviceVram: async () => ({ usedBytes: gpu.used, totalBytes: 32 * 1024 * 1024 * 1024, source: "native" as const }),
  __clearProbeCache: () => {},
}));

/**
 * Pha 2A Task 3 — đường đo `actualBytes` nay đọc BỘ ĐẾM THEO TIẾN TRÌNH. Bản giả phản chiếu đúng
 * `gpu.used` mà node-llama-cpp giả cộng vào, nên BACKEND_DELTA/RERANKER_DELTA giữ nguyên ý nghĩa.
 */
const processProbeFactory = vi.hoisted(() => () => ({
  readProcessVram: async () => ({
    totalBytes: gpu.used,
    byPid: new Map<number, number>([[process.pid, gpu.used]]),
    byLuid: new Map<string, number>(),
    sampledAtMs: Date.now(),
  }),
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
  vi.doUnmock("./vramBroker");
  vi.doUnmock("./vramEventLog");
  vi.doUnmock("./vramEstimator");
  vi.doMock("node-llama-cpp", nlcFactory);
  vi.doMock("./vramProcessProbe", processProbeFactory);
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  process.env.RAG_RERANKER_ENABLED = "true";
  process.env.RAG_RERANKER_MODE = "gguf";
  process.env.RAG_RERANKER_GPU = "true"; // ĐÚNG cấu hình mà một lần lật cờ sẽ tạo ra
  process.env.GGUF_RERANKER_MODEL = "bge-reranker-v2-m3-Q8_0.gguf";
  process.env.GGUF_MODELS_DIR = "D:\\uploads\\gguf-models";
  gpu.used = 2 * GiB;
  initCalls.count = 0;
  backendCache.instance = null;
});

describe("I-1 — backend CUDA của aiReranker (getLlama THỨ HAI) phải vào sổ", () => {
  it("★ rerank(mode=gguf, GPU) ghi giấy phép gguf-backend RIÊNG với delta THẬT quanh getLlama()", async () => {
    const { __resetBrokerForTests, snapshot } = await import("./vramBroker");
    __resetBrokerForTests();
    const { rerank } = await import("../aiReranker");

    await rerank("câu hỏi", [{ id: "a", text: "tài liệu A" }]);

    expect(initCalls.count).toBe(1); // backend THẬT SỰ được tạo trong lượt này
    const backend = snapshot().leases.find((l) => l.request.kind === "gguf-backend");
    expect(backend, "backend CUDA của reranker phải có giấy phép").toBeDefined();
    expect(backend!.request.owner).toContain("reranker");
    // Delta đo quanh ĐÚNG lượt gọi getLlama() — không phải ước lượng, không phải hằng số.
    expect(backend!.actualBytes).toBe(BACKEND_DELTA);
  });

  it("★ backend KHÔNG được lẫn vào giấy phép của model: hai lease, hai con số THẬT tách bạch", async () => {
    const { __resetBrokerForTests, snapshot } = await import("./vramBroker");
    __resetBrokerForTests();
    const { rerank } = await import("../aiReranker");

    await rerank("câu hỏi", [{ id: "a", text: "tài liệu A" }]);

    const leases = snapshot().leases;
    const backend = leases.find((l) => l.request.kind === "gguf-backend");
    const model = leases.find((l) => l.request.owner.startsWith("reranker:"));
    expect(backend).toBeDefined();
    expect(model).toBeDefined();
    // Hai owner PHÂN BIỆT — đây là chỗ chứng minh "singleton cả tiến trình" (types.ts) là SAI:
    // tiến trình có HAI thể hiện backend độc lập, và sổ phải thấy được cả hai.
    expect(backend!.request.owner).not.toBe(model!.request.owner);
    expect(model!.actualBytes).toBe(RERANKER_DELTA);
    // ⚠ Cửa sổ đo của backend phải ĐÓNG trước khi cửa sổ của model mở — nếu không, Task 8 gắn
    // `measureFailed` cho CẢ HAI và bản vá này tự tay làm mù đúng phép đo nó vừa thêm.
    expect(backend!.measureFailed).toBeFalsy();
    expect(model!.measureFailed).toBeFalsy();
  });

  /**
   * ★★ N-1 (review cổng cuối) — BẢN VÁ I-1 TỰ ĐẺ LẠI ĐÚNG LỚP LỖI CỘNG-TRÙNG.
   *
   * `getRankingContext()` **KHÔNG có khoá in-flight** (chính mã tự khai ở hai chỗ: docstring
   * `localTicket` và nhánh `catch` cuối hàm). Hai lượt `rerank()` song song vì thế **đều thấy**
   * `_rankBackendTicket === null`, **đều mở** giấy phép, và lượt sau **đè con trỏ** ⇒ lượt đầu
   * **treo VĨNH VIỄN** (`disposeReranker()` CỐ Ý không đụng tới giấy phép backend).
   *
   * ⚠ HAI HỆ QUẢ, và hệ quả thứ hai KHÔNG phụ thuộc cờ GPU:
   *   1. `RAG_RERANKER_GPU=true` (đúng cấu hình I-1 sinh ra để phục vụ) ⇒ **+430 MiB cộng trùng
   *      vĩnh viễn** = **84 %** ngân sách ngưỡng 512 MiB tiêu bằng một lease MA; Pha 2 tính
   *      `headroom` **thiếu đúng khoản mà I-1 vừa đi tìm**.
   *   2. Hai cửa sổ đo của hai lượt song song **CHỒNG nhau** ⇒ Task 8 gắn `measureFailed` cho CẢ
   *      HAI ⇒ `actualBytes === null` **vĩnh viễn** trên một giấy phép **KHÔNG có đường release**
   *      ⇒ lá chắn HOÃN (T5-1) chặn nền **VĨNH VIỄN, không tự lành kể cả sau unload/evict** —
   *      **phủ định trực tiếp** lời hứa *"≤ 1 nhịp; xấu nhất restart"* ở báo cáo §11.4.
   *
   * ⇒ Bản vá: sao ĐÚNG khuôn mà đường model ngay dưới đã dùng từ trước — **trả giấy phép cũ TRƯỚC
   * khi ghi đè con trỏ**.
   */
  it("★★ N-1: HAI rerank() SONG SONG ⇒ ĐÚNG MỘT giấy phép cuda-backend:reranker, không lease MA", async () => {
    const { __resetBrokerForTests, snapshot } = await import("./vramBroker");
    __resetBrokerForTests();
    const { rerank, disposeReranker } = await import("../aiReranker");

    await Promise.all([
      rerank("câu hỏi A", [{ id: "a", text: "tài liệu A" }]),
      rerank("câu hỏi B", [{ id: "b", text: "tài liệu B" }]),
    ]);

    const backends = snapshot().leases.filter((l) => l.request.owner === "cuda-backend:reranker");
    expect(backends, "hai lượt song song KHÔNG được để lại hai giấy phép backend").toHaveLength(1);

    // …và `disposeReranker()` CỐ Ý không trả giấy phép backend (thể hiện `Llama` vẫn sống), nên
    // một lease thừa lọt qua đây là lease treo VĨNH VIỄN — kiểm luôn để nói rõ không có đường lùi.
    await disposeReranker();
    expect(snapshot().leases.filter((l) => l.request.owner === "cuda-backend:reranker")).toHaveLength(1);
  });

  it("ĐỘT BIẾN: lượt rerank THỨ HAI không đẻ thêm giấy phép backend (ngữ cảnh đã có, không cấp phát lại)", async () => {
    const { __resetBrokerForTests, snapshot } = await import("./vramBroker");
    __resetBrokerForTests();
    const { rerank } = await import("../aiReranker");

    await rerank("câu hỏi", [{ id: "a", text: "tài liệu A" }]);
    await rerank("câu hỏi 2", [{ id: "b", text: "tài liệu B" }]);

    expect(initCalls.count).toBe(1); // ranking context đã cache ⇒ getLlama() không chạy lại
    expect(snapshot().leases.filter((l) => l.request.kind === "gguf-backend")).toHaveLength(1);
  });
});
