/**
 * ★ I-1 (vá sau review TOÀN NHÁNH) — `getLlama()` THỨ HAI của tiến trình, NGOÀI SỔ.
 *
 * Task 2 đưa backend CUDA (~430 MiB — khoản LỚN NHẤT của "sàn cấu trúc" Pha 1) vào sổ, nhưng chỉ
 * khép **MỘT** thể hiện: `aiGgufEngine.getLlama()`. `aiReranker.ts:362` gọi `getLlama({gpu:"auto"})`
 * của node-llama-cpp **THẲNG**, và `beginVramAllocation()` của nó mãi `:382` — tức backend nằm gọn
 * trong `beforeUsed` của giấy phép model và **KHÔNG BAO GIỜ vào sổ**. Chính comment `:366` tự khai:
 * *"Runs on the reranker's own backend instance"*.
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

const nlcFactory = vi.hoisted(() => () => ({
  getLlama: async (_o: unknown) => {
    initCalls.count++;
    gpu.used += 430 * 1024 * 1024;
    return {
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

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  vi.doUnmock("./vramBroker");
  vi.doUnmock("./vramEventLog");
  vi.doUnmock("./vramEstimator");
  vi.doMock("node-llama-cpp", nlcFactory);
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  process.env.RAG_RERANKER_ENABLED = "true";
  process.env.RAG_RERANKER_MODE = "gguf";
  process.env.RAG_RERANKER_GPU = "true"; // ĐÚNG cấu hình mà một lần lật cờ sẽ tạo ra
  process.env.GGUF_RERANKER_MODEL = "bge-reranker-v2-m3-Q8_0.gguf";
  process.env.GGUF_MODELS_DIR = "D:\\uploads\\gguf-models";
  gpu.used = 2 * GiB;
  initCalls.count = 0;
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
