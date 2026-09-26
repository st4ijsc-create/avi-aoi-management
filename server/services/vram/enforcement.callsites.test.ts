/**
 * ★★★ Pha 2B Task 5, review vòng 1 (E + I-3) — LỜI TỪ CHỐI BIẾN MẤT Ở **TẦNG TRÊN** CÁI `catch`
 * ĐÃ ĐƯỢC KIỂM.
 *
 * Vòng đầu tôi dạy đúng cái `catch` **ôm sát** mỗi lời gọi `beginVramAllocation()`, và ca quét văn
 * bản khai "đủ" vì file nào cũng **có** nhập `isVramRefusal`. Review tìm ra hai chỗ mà một `catch`
 * **RỘNG HƠN** nuốt lời từ chối sau đó:
 *
 *   • `aiReranker.ts` — một `try` bao CẢ HAI lời gọi, và `catch` của nó đóng `_rankCtxFailed` —
 *     một **cửa MỘT CHIỀU**: một lần thiếu VRAM tạm thời = MẤT reranker GGUF tới lúc khởi động lại,
 *     kèm chẩn đoán SAI (*"model not a reranker?"*).
 *   • `aiGgufEngine.getLlama()` — `catch` **viết lại MỌI lỗi** thành *"node-llama-cpp is not
 *     available"*: lời từ chối mức `production` của `cuda-backend` **mất danh tính** (`name` không
 *     còn là `VramRefusedError`) ⇒ mọi vị từ phía trên mù với nó, và người trực nhận lệnh đi **cài
 *     một gói đã có sẵn**.
 *
 * ⇒ Bài học ghi lại cho lượt sau: *"file có nhập vị từ"* KHÔNG đồng nghĩa *"mọi đường thoát của
 * file đó đã được dạy"*. Lưới đúng phải đi theo **ĐƯỜNG THOÁT**, không theo **FILE**.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const MIB = 1024 * 1024;

/** Lỗi từ chối GIẢ — nhận diện bằng `name`, đúng cách `isVramRefusal()` nhận diện. */
function taoLoiTuChoi(owner: string): Error {
  const err = new Error(`Không đủ VRAM cho ${owner}: xin 17000 MiB, còn 12 MiB.`);
  err.name = "VramRefusedError";
  (err as unknown as { facts: unknown }).facts = { preemptable: [], holders: [], owner };
  return err;
}

/** Mọi lượt `noteRefCount()` đã khai, theo thứ tự — để ca M-5 đọc được "khai lúc nào, bằng mấy". */
const refCountCalls: { owner: string; n: number }[] = [];
const beginSpy = vi.fn(async (opts: { owner: string }) => {
  if (tuChoiOwner !== null && opts.owner.startsWith(tuChoiOwner)) throw taoLoiTuChoi(opts.owner);
  return {
    commitMeasured: async () => {},
    release: () => {},
    noteRefCount: (n: number) => { refCountCalls.push({ owner: opts.owner, n }); },
  };
});
let tuChoiOwner: string | null = null;

vi.mock("./vramWiring", () => ({
  beginVramAllocation: beginSpy,
  CUDA_BACKEND_FALLBACK_BYTES: 452_595_712,
}));
vi.mock("../vram/vramWiring", () => ({
  beginVramAllocation: beginSpy,
  CUDA_BACKEND_FALLBACK_BYTES: 452_595_712,
}));

// node-llama-cpp: `getLlama()` THÀNH CÔNG — ta đang kiểm đường TỪ CHỐI, không kiểm đường thư viện hỏng.
const fakeLlama = {
  getVramState: async () => ({ used: 0, total: 32_607 * MIB }),
  loadModel: async () => ({
    gpuLayers: 25,
    size: 600 * MIB,
    createContext: async () => ({ dispose: async () => {} }),
    createRankingContext: async () => ({ rankAll: async (_q: string, d: string[]) => d.map(() => 0.5) }),
    dispose: async () => {},
  }),
};
vi.mock("node-llama-cpp", () => ({
  getLlama: vi.fn(async () => fakeLlama),
  LlamaChatSession: class { constructor(_o: unknown) {} async prompt() { return "{}"; } },
  LlamaEmbeddingContext: class {},
  LlamaJsonSchemaGrammar: class {},
  // `aiReranker` truyền mức log vào `getLlama({ logLevel })` — thiếu export này thì lượt gọi ném
  // MỘT LỖI KHÁC HẲN và ca test xanh/đỏ vì lý do không liên quan.
  LlamaLogLevel: { disabled: "disabled", fatal: "fatal", error: "error", warn: "warn", info: "info", log: "log", debug: "debug" },
}));

// ⚠ KHAI BÁO HÀM, không phải `const`: `vi.mock(...)` được HOIST lên đầu module, nên một `const`
// truyền vào đó sẽ "Cannot access before initialization". Khai báo hàm thì hoist cùng.
function fsMock() {
  const api = {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => [] as string[]),
    // ⚠ `isFile()` BẮT BUỘC: `isPlausibleGgufFile()` gọi nó TRƯỚC khi đọc magic; thiếu nó thì
    // `stat.isFile is not a function` rơi vào `catch` và file bị coi là KHÔNG hợp lệ.
    statSync: vi.fn(() => ({ size: 600 * MIB, mtime: new Date(), isFile: () => true })),
    openSync: vi.fn(() => 1),
    // ⚠ `validateGgufFile()` đọc 4 byte MAGIC. Trả 4 mà không GHI gì vào buffer ⇒ "bad magic
    // header" ⇒ reranker rơi về nấc LLM TRƯỚC khi chạm tới giấy phép VRAM, và ca này xanh/đỏ vì
    // một lý do chẳng liên quan gì tới thứ nó đang canh.
    readSync: vi.fn((_fd: number, buf: Buffer) => { buf.write("GGUF", 0, "ascii"); return 4; }),
    closeSync: vi.fn(),
  };
  return { default: api, ...api };
}
// ⚠ HAI đặc tả, HAI module khác nhau với vitest: `aiGgufEngine` nhập `"fs"`, `aiReranker` nhập
// `"node:fs"`. Thiếu bản `node:fs` thì `resolveRerankerModelPath()` đọc đĩa THẬT, không thấy file,
// và ca này xanh vì một lý do chẳng liên quan gì tới thứ nó đang canh (đã trả giá đúng một lượt).
vi.mock("fs", fsMock);
vi.mock("node:fs", fsMock);

beforeEach(() => {
  beginSpy.mockClear();
  refCountCalls.length = 0;
  tuChoiOwner = null;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.RAG_RERANKER_MODE;
  delete process.env.RAG_RERANKER_ENABLED;
  delete process.env.GGUF_RERANKER_MODEL;
});

describe("E — lời từ chối phải sống sót qua các `catch` RỘNG", () => {
  it("★★★ (I-3) getLlama(): từ chối `cuda-backend` KHÔNG bị viết lại thành 'node-llama-cpp is not available'", async () => {
    tuChoiOwner = "cuda-backend";
    const engine = await import("../aiGgufEngine");
    let bat: unknown = null;
    try {
      await engine.loadGgufModel({ modelPath: "C:/khong-quan-trong/model.gguf" });
    } catch (e) {
      bat = e;
    }
    expect(bat).not.toBeNull();
    // ★ DANH TÍNH còn nguyên ⇒ mọi `catch` phía trên vẫn nhận ra đây là một lời TỪ CHỐI.
    expect((bat as Error).name).toBe("VramRefusedError");
    expect((bat as Error).message).not.toContain("node-llama-cpp is not available");
    // …và lỗi KHÁC vẫn được viết lại như cũ (câu đó sinh ra để nói đúng ca thiếu gói).
    expect(beginSpy).toHaveBeenCalled();
  });

  it("★★ (M-5) model vừa nạp xong PHẢI khai NHÀN RỖI ngay — không đợi lượt dùng đầu tiên", async () => {
    const engine = await import("../aiGgufEngine");
    await engine.loadGgufModel({ modelPath: "C:/khong-quan-trong/model.gguf" });
    /**
     * `reserve()` mở giấy phép ở trạng thái ĐANG DÙNG (mặc định an toàn `refCount = 1`), còn bản
     * ghi engine khai `refCount: 0`. Thiếu lượt đồng bộ lúc ĐĂNG KÝ, hai cuốn sổ lệch nhau cho tới
     * lượt dùng ĐẦU TIÊN ⇒ một model được **làm ấm rồi để đó** là ứng viên nhường chỗ **VÔ HÌNH**:
     * `evictLRU()` đuổi được nó, còn câu từ chối thì khai "không có ai nhường được".
     */
    const cuaModel = refCountCalls.filter((c) => c.owner.startsWith("gguf:"));
    expect(cuaModel.length).toBeGreaterThan(0);
    expect(cuaModel[cuaModel.length - 1]!.n).toBe(0);
  });

  it("★★★ (E) reranker: từ chối KHÔNG đóng cửa vĩnh viễn — lượt sau PHẢI xin lại", async () => {
    process.env.RAG_RERANKER_ENABLED = "true";
    process.env.RAG_RERANKER_MODE = "gguf";
    process.env.GGUF_RERANKER_MODEL = "C:/khong-quan-trong/bge-reranker.gguf";
    tuChoiOwner = "cuda-backend:reranker";

    const { rerank } = await import("../aiReranker");
    const pool = [
      { id: "a", text: "alpha", score: 0.9 },
      { id: "b", text: "beta", score: 0.8 },
    ];

    const lan1 = await rerank("q", pool, 2);
    const soLanXinSauLan1 = beginSpy.mock.calls.length;
    const lan2 = await rerank("q", pool, 2);

    // Hệ vẫn trả kết quả (hạ cấp, không vỡ) …
    expect(lan1.length).toBeGreaterThan(0);
    expect(lan2.length).toBeGreaterThan(0);
    // ★ …và cửa KHÔNG bị đóng: lượt thứ hai vẫn ĐI XIN LẠI. Với `_rankCtxFailed = true` (bản
    // trước), `getRankingContext()` thoát ở dòng đầu và số lời gọi ĐỨNG YÊN.
    expect(beginSpy.mock.calls.length).toBeGreaterThan(soLanXinSauLan1);
  });
});
