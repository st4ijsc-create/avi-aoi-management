/**
 * Pha 1 Task 5 — DÂY NỐI trong tiến trình.
 *
 * Bốn task trước dựng xong sổ cái (Task 1), nhật ký (Task 2), ước lượng (Task 3) và đối chiếu
 * (Task 4) — nhưng KHÔNG AI GỌI chúng. Test này canh đúng một điều: mỗi điểm cấp phát VRAM
 * trong tiến trình để lại MỘT giấy phép trong sổ, kèm số THẬT đo quanh lượt cấp phát.
 *
 * BẢY hộ tiêu thụ (sáu theo brief + hộ thứ BẢY do review vòng 1 I-2 phát hiện):
 *   1. loadGgufModel                 gguf:${modelId}            gguf-model          interactive
 *   2. getEmbeddingContext           gguf-embed-ctx:${modelId}  gguf-embed-context  background
 *   3. ensureTextContext             gguf-ctx:${modelId}        gguf-context        interactive
 *   4. aiInferenceEngine.getSession  onnx:${model.code}         onnx-session        production
 *   5. ocrService.getOnnxSession     onnx-ocr:${modelPath}      onnx-session        production
 *   6. aiReranker (llama.loadModel)  reranker:${modelPath}      gguf-model          background
 *   7. aiImageEmbedding.getEmbeddingSession  onnx-img:${code}   onnx-session        production
 *
 * ⚠ Hộ thứ SÁU là lý do mới nhất khiến module này tồn tại: `aiReranker.ts:361` gọi THẲNG
 * `llama.loadModel` — không qua `loadGgufModel` ⇒ vô hình với `loadedModels`, với `evictLRU`
 * và với mọi phép cộng VRAM của cả ba đợt trước. Hôm nay nó 0 MiB CHỈ VÌ `RAG_RERANKER_GPU=false`;
 * đổi một cờ là có ngay một hộ tiêu thụ mà không công cụ nào thấy.
 *
 * ⚠ QUY ƯỚC MODULE-IDENTITY (đọc trước khi sửa test này): `vi.resetModules()` tạo một THẾ HỆ
 * module mới. Mã sản xuất `import()` ĐỘNG `./vram/vramBroker`, nên nếu test `import` sổ cái ở
 * đầu file (thế hệ CŨ) thì nó soi vào MỘT SỔ KHÁC và luôn thấy rỗng — xanh/đỏ đều sai lý do.
 * Vì vậy: MỌI lượt import (cả mã sản xuất lẫn sổ cái) đều nằm TRONG thân test, SAU cùng một
 * `vi.resetModules()`.
 *
 * ⚠ Đầu dò VRAM giả: `gpu.used` là "thiết bị". Mock `loadModel`/`createContext`/
 * `InferenceSession.create` CỘNG vào nó đúng như một lượt cấp phát thật ⇒ test đo được rằng
 * `commit()` ghi ĐÚNG delta quanh lượt cấp phát, chứ không phải một hằng số nào đó.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const GiB = 1024 * 1024 * 1024;

/** "VRAM thiết bị" giả — mock cộng vào đây mỗi lượt cấp phát. */
const gpu = vi.hoisted(() => ({ used: 2 * 1024 * 1024 * 1024 }));

/** Số byte mỗi lượt cấp phát giả chiếm. Khác nhau để không nhầm hộ này với hộ kia. */
const ALLOC = vi.hoisted(() => ({
  MODEL: 400 * 1024 * 1024,
  CTX: 120 * 1024 * 1024,
  EMBED_CTX: 60 * 1024 * 1024,
  ONNX: 90 * 1024 * 1024,
  OCR: 30 * 1024 * 1024,
  IMG: 45 * 1024 * 1024,
}));

/** Kích thước file .gguf/.onnx trên đĩa — nguồn của ước lượng nấc "file-size". */
const FILE_BYTES = vi.hoisted(() => 777 * 1024 * 1024);

/**
 * ⚠ CÁCH LY DOMOCK (bài học đau, ghi lại để người sau khỏi vấp):
 * `vi.resetModules()` chỉ dọn REGISTRY MODULE — nó KHÔNG gỡ các đăng ký `vi.doMock()`.
 * Bản đầu của file này để test 10 (`doMock("./vramBroker")` cho `reserve` NÉM) RÒ sang MỌI
 * test sau nó: sổ cái hỏng ⇒ không giấy phép nào được ghi ⇒ ba ca khẳng định-VẮNG-MẶT (A, C, H)
 * xanh MỘT CÁCH RỖNG, còn D/E đỏ vì lý do sai. Bằng chứng: E chạy RIÊNG thì XANH, chạy trong
 * bộ thì ĐỎ. Vì vậy `beforeEach` bên dưới GỠ tường minh từng module từng bị doMock, và ĐẶT LẠI
 * mock mặc định của `node-llama-cpp` (module này bị `vi.mock` hoisted ở đầu file nên không được
 * `doUnmock` — sẽ mất luôn bản giả mặc định).
 */
const nlcFactory = vi.hoisted(() => () => {
  class FakeChatSession {
    constructor(_o: unknown) {}
    async prompt(_p: string, _o?: unknown) {
      return "ok";
    }
  }
  const makeModel = () => ({
    size: 1234,
    tokenize: (t: string) => t.split(" "),
    createContext: async () => {
      gpu.used += ALLOC.CTX;
      return { getSequence: () => ({ dispose: () => {} }), dispose: async () => {} };
    },
    createEmbeddingContext: async () => {
      gpu.used += ALLOC.EMBED_CTX;
      return {
        getEmbeddingFor: async () => ({ vector: new Array(1024).fill(0.01) }),
        dispose: async () => {},
      };
    },
    createRankingContext: async () => ({
      rankAll: async (_q: string, docs: string[]) => docs.map(() => 0.5),
      dispose: async () => {},
    }),
    dispose: async () => {},
  });
  return {
    getLlama: async () => ({
      loadModel: async (_o: unknown) => {
        gpu.used += ALLOC.MODEL;
        return makeModel();
      },
      getVramState: async () => ({
        total: 32 * 1024 * 1024 * 1024,
        used: gpu.used,
        free: 32 * 1024 * 1024 * 1024 - gpu.used,
        unifiedSize: 0,
      }),
      createGrammarForJsonSchema: async () => ({ parse: (s: string) => JSON.parse(s) }),
    }),
    LlamaChatSession: FakeChatSession,
    LlamaJsonSchemaGrammar: class {},
    LlamaLogLevel: { fatal: "fatal", error: "error", warn: "warn", info: "info" },
  };
});
vi.mock("node-llama-cpp", nlcFactory);

// fs mock theo đúng quy ước sẵn có (aiGgufEngine.embedNoTextCtx.test.ts §67): resolveModelPath()
// gọi fs.existsSync() THẬT trên đĩa — không mock thì nó ném TRƯỚC khi chạm đích cần kiểm.
// ⚠ aiReranker.ts dùng `import fs from "node:fs"` (specifier KHÁC "fs") và kiểm magic header
// GGUF bằng openSync/readSync ⇒ mock phải phục vụ cả hai specifier và cả bốn hàm đó.
const fsApi = vi.hoisted(() => ({
  existsSync: () => true,
  mkdirSync: () => {},
  readdirSync: () => [] as string[],
  statSync: () => ({ size: 777 * 1024 * 1024, mtime: new Date(), isFile: () => true }),
  readFileSync: () => "a\nb\nc\n",
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

/**
 * Pha 2A Task 3 — `actualBytes` nay đo bằng BỘ ĐẾM THEO TIẾN TRÌNH (`vramProcessProbe`), không
 * còn bằng `used` toàn thiết bị. Bản giả phản chiếu ĐÚNG `gpu.used` mà node-llama-cpp/onnxruntime
 * giả đang cộng vào, nên mọi con số ALLOC.* của file này giữ nguyên ý nghĩa: byte của CHÍNH tiến
 * trình này. Không mock thì test gọi `powershell.exe` THẬT (~2-4 s/lượt, hai lượt mỗi cửa sổ) —
 * hết giờ, và số đo là của máy chứ không phải của kịch bản.
 */
const processProbeFactory = vi.hoisted(() => () => ({
  readProcessVram: async () => ({
    totalBytes: gpu.used,
    byPid: new Map<number, number>([[process.pid, gpu.used]]),
    byLuid: new Map<string, number>(),
    sampledAtMs: Date.now(),
  }),
}));
vi.mock("./vramProcessProbe", processProbeFactory);

vi.mock("sharp", () => {
  const pipeline: Record<string, unknown> = {};
  Object.assign(pipeline, {
    resize: () => pipeline,
    grayscale: () => pipeline,
    removeAlpha: () => pipeline,
    toColourspace: () => pipeline,
    raw: () => pipeline,
    toBuffer: async () => Buffer.alloc(224 * 224 * 3, 128),
    metadata: async () => ({ width: 100, height: 48 }),
  });
  return { default: () => pipeline };
});

/** Ném ở lượt tạo session ONNX kế tiếp (ca H của I-4). */
const onnxFail = vi.hoisted(() => ({ on: false }));

vi.mock("onnxruntime-node", () => ({
  InferenceSession: {
    create: async (modelPath: string) => {
      if (onnxFail.on) throw new Error("ONNX create hỏng (ca thử nghiệm)");
      // Ba hộ ONNX cộng số KHÁC NHAU để test phân biệt được lease của ai.
      const p = String(modelPath);
      gpu.used += /rec\.onnx$/.test(p) ? ALLOC.OCR : /emb\.onnx$/.test(p) ? ALLOC.IMG : ALLOC.ONNX;
      return {
        inputNames: ["x"],
        outputNames: ["y"],
        run: async () => ({ y: { data: new Float32Array([0.2, 0.8]), dims: [1, 2] } }),
      };
    },
  },
  Tensor: class {
    constructor(
      public type: string,
      public data: unknown,
      public dims: number[],
    ) {}
  },
}));

// id 42 = model NHÚNG ẢNH (hộ thứ BẢY, aiImageEmbedding); id khác = model phân loại AOI.
vi.mock("../../db/ai", () => ({
  getAiModelById: async (id: number) =>
    id === 42
      ? {
          id,
          code: "AOI-EMB-1",
          currentVersion: "1.0.0",
          status: "ACTIVE",
          filePath: "/uploads/models/emb.onnx",
          preprocessConfig: { resize: { width: 224, height: 224 }, colorSpace: "RGB", channelFirst: true },
          inputShape: [1, 3, 224, 224],
        }
      : {
          id,
          code: "AOI-CLS-1",
          currentVersion: "1.0.0",
          status: "ACTIVE",
          filePath: "/uploads/models/cls.onnx",
          preprocessConfig: { resize: { width: 224, height: 224 }, colorSpace: "RGB", channelFirst: true },
          inputShape: [1, 3, 224, 224],
          labels: ["ok", "ng"],
          postprocessConfig: { outputType: "classification", confidenceThreshold: 0.1, topK: 5 },
        },
  createInferenceResult: async () => ({ id: 1 }),
  getActiveModelForProduct: async () => null,
  getAiModels: async () => [],
}));

vi.mock("../aiLlamaServerClient", () => ({
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

const DEFAULT_FILE = "Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL.gguf";
const DEFAULT_BASE = "Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL";
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  // ⚠ Xem khối chú thích "CÁCH LY DOMOCK" ở đầu file — không có bốn dòng này thì mock của một
  // test rò sang mọi test sau, và các ca khẳng định-VẮNG-MẶT xanh một cách RỖNG.
  vi.doUnmock("./vramBroker");
  vi.doUnmock("./vramProbe");
  vi.doUnmock("./vramEventLog");
  vi.doUnmock("./vramEstimator");
  vi.doMock("node-llama-cpp", nlcFactory); // đặt lại bản giả MẶC ĐỊNH (A/B/C ghi đè riêng)
  // ⚠ ĐẶT LẠI, KHÔNG `doUnmock`: gỡ bản giả đầu dò theo tiến trình sẽ cho test gọi
  // `powershell.exe` THẬT (~3 s/lượt) và số đo thành của MÁY chứ không của kịch bản — hết giờ,
  // và đỏ vì lý do sai. Ca E ghi đè riêng bằng `doMock`, dòng này trả lại bản mặc định.
  vi.doMock("./vramProcessProbe", processProbeFactory);
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  process.env.GGUF_DEFAULT_MODEL = DEFAULT_FILE;
  process.env.GGUF_EMBED_DIM = "1024";
  process.env.GGUF_MAX_LOADED_MODELS = "8";
  process.env.GGUF_MAX_VRAM_MB = "0";
  process.env.GGUF_MAX_CONCURRENCY = "4";
  process.env.AI_BATCH_MAX = "1"; // đường trực tiếp, không micro-batch → xác định
  onnxFail.on = false;
  delete process.env.GGUF_EMBED_MODEL;
  delete process.env.GGUF_RERANKER_MODEL;
  delete process.env.LLAMA_SERVER_ENABLED;
  gpu.used = 2 * GiB;
});

/** Ảnh chụp sổ cái CÙNG THẾ HỆ module với mã sản xuất vừa chạy (xem cảnh báo đầu file). */
async function leases() {
  const { snapshot } = await import("./vramBroker");
  return snapshot().leases;
}

async function leaseOf(owner: string) {
  return (await leases()).find((l) => l.request.owner === owner);
}

describe("Pha 1 Task 5 — sáu hộ tiêu thụ trong tiến trình đều để lại giấy phép", () => {
  it("1. loadGgufModel ghi giấy phép gguf-model kèm số THẬT (trọng số + context)", async () => {
    const { loadGgufModel } = await import("../aiGgufEngine");
    await loadGgufModel({ modelPath: "Qwen3-Test.gguf" });

    const lease = await leaseOf("gguf:Qwen3-Test");
    expect(lease).toBeDefined();
    expect(lease!.request.kind).toBe("gguf-model");
    expect(lease!.request.priority).toBe("interactive");
    // Ước lượng đến từ kích thước file trên đĩa (nấc 2 của vramEstimator).
    expect(lease!.request.estimateSource).toBe("file-size");
    expect(lease!.request.estimatedBytes).toBe(FILE_BYTES);
    // Số THẬT = delta đo quanh lượt cấp phát = trọng số + context thường.
    expect(lease!.actualBytes).toBe(ALLOC.MODEL + ALLOC.CTX);
  });

  it("2. getLlama() nối đầu dò vào thể hiện llama (setLlamaInstanceHandle) — hết lùi về nvidia-smi", async () => {
    const { loadGgufModel } = await import("../aiGgufEngine");
    await loadGgufModel({ modelPath: "Qwen3-Test.gguf" });

    const { getLlamaInstanceIfReady } = await import("./llamaHandle");
    const h = getLlamaInstanceIfReady();
    expect(h).not.toBeNull();
    expect(typeof h!.getVramState).toBe("function");
  });

  it("3. unloadGgufModel TRẢ giấy phép — sổ không giữ chỗ ma", async () => {
    const { loadGgufModel, unloadGgufModel } = await import("../aiGgufEngine");
    await loadGgufModel({ modelPath: "Qwen3-Test.gguf" });
    expect(await leaseOf("gguf:Qwen3-Test")).toBeDefined();

    await unloadGgufModel("Qwen3-Test");
    expect(await leaseOf("gguf:Qwen3-Test")).toBeUndefined();
  });

  it("4. getEmbeddingContext ghi giấy phép gguf-embed-context (background)", async () => {
    const { generateEmbedding } = await import("../aiGgufEngine");
    await generateEmbedding("một câu tiếng Việt", "embed-model");

    const lease = await leaseOf("gguf-embed-ctx:embed-model");
    expect(lease).toBeDefined();
    expect(lease!.request.kind).toBe("gguf-embed-context");
    expect(lease!.request.priority).toBe("background");
    expect(lease!.actualBytes).toBe(ALLOC.EMBED_CTX);
  });

  it("5. ensureTextContext (context tạo LƯỜI) ghi giấy phép gguf-context (interactive)", async () => {
    const eng = await import("../aiGgufEngine");
    // Nạp qua đường NHÚNG ⇒ model không có context thường (embeddingOnly).
    await eng.generateEmbedding("một câu tiếng Việt", DEFAULT_BASE);
    expect(await leaseOf(`gguf-ctx:${DEFAULT_BASE}`)).toBeUndefined();

    // Lượt sinh chữ sau đó tạo LƯỜI context thường → phải để lại giấy phép RIÊNG.
    await eng.generateText({ prompt: "xin chào" });

    const lease = await leaseOf(`gguf-ctx:${DEFAULT_BASE}`);
    expect(lease).toBeDefined();
    expect(lease!.request.kind).toBe("gguf-context");
    expect(lease!.request.priority).toBe("interactive");
    expect(lease!.actualBytes).toBe(ALLOC.CTX);
  });

  it("6. aiInferenceEngine.getSession ghi giấy phép onnx-session ở mức PRODUCTION (đường kiểm tra AOI)", async () => {
    const { setLlamaInstanceHandle } = await import("./llamaHandle");
    setLlamaInstanceHandle({ getVramState: async () => ({ used: gpu.used, total: 32 * GiB }) });

    const { runInference } = await import("../aiInferenceEngine");
    await runInference(7, Buffer.alloc(64));

    const lease = await leaseOf("onnx:AOI-CLS-1");
    expect(lease).toBeDefined();
    expect(lease!.request.kind).toBe("onnx-session");
    expect(lease!.request.priority).toBe("production");
    expect(lease!.actualBytes).toBe(ALLOC.ONNX);
  });

  it("7. ocrService.getOnnxSession ghi giấy phép onnx-session ở mức PRODUCTION", async () => {
    const { setLlamaInstanceHandle } = await import("./llamaHandle");
    setLlamaInstanceHandle({ getVramState: async () => ({ used: gpu.used, total: 32 * GiB }) });

    process.env.OCR_MODEL_DIR = "/models/ocr";
    const { runOcr } = await import("../ai/ocrService");
    await runOcr(Buffer.alloc(64));

    const lease = (await leases()).find((l) => l.request.owner.startsWith("onnx-ocr:"));
    expect(lease).toBeDefined();
    expect(lease!.request.kind).toBe("onnx-session");
    expect(lease!.request.priority).toBe("production");
    expect(lease!.actualBytes).toBe(ALLOC.OCR);
  });

  it("8. aiReranker — HỘ TIÊU THỤ THỨ SÁU, gọi thẳng llama.loadModel — cũng ghi giấy phép", async () => {
    const { setLlamaInstanceHandle } = await import("./llamaHandle");
    setLlamaInstanceHandle({ getVramState: async () => ({ used: gpu.used, total: 32 * GiB }) });

    process.env.RAG_RERANKER_ENABLED = "true";
    process.env.RAG_RERANKER_MODE = "gguf";
    process.env.GGUF_RERANKER_MODEL = "bge-reranker-v2-m3-Q8_0.gguf";

    const { rerank } = await import("../aiReranker");
    await rerank("câu hỏi", [
      { id: "a", text: "tài liệu A" },
      { id: "b", text: "tài liệu B" },
    ]);

    const lease = (await leases()).find((l) => l.request.owner.startsWith("reranker:"));
    expect(lease).toBeDefined();
    expect(lease!.request.kind).toBe("gguf-model");
    expect(lease!.request.priority).toBe("background");
    expect(lease!.request.estimateSource).toBe("file-size");
    expect(lease!.actualBytes).toBe(ALLOC.MODEL);
  });

  it("9. disposeReranker TRẢ giấy phép của hộ thứ sáu", async () => {
    process.env.RAG_RERANKER_ENABLED = "true";
    process.env.RAG_RERANKER_MODE = "gguf";
    process.env.GGUF_RERANKER_MODEL = "bge-reranker-v2-m3-Q8_0.gguf";

    const rr = await import("../aiReranker");
    await rr.rerank("câu hỏi", [{ id: "a", text: "tài liệu A" }]);
    expect((await leases()).some((l) => l.request.owner.startsWith("reranker:"))).toBe(true);

    await rr.disposeReranker();
    expect((await leases()).some((l) => l.request.owner.startsWith("reranker:"))).toBe(false);
  });

  it("10. reserve() KHÔNG bao giờ chặn đường cấp phát: telemetry hỏng thì lượt nạp VẪN xong", async () => {
    // Sổ cái ném ở MỌI lối vào — mô phỏng telemetry hỏng hoàn toàn.
    vi.doMock("./vramBroker", () => ({
      reserve: () => {
        throw new Error("sổ cái hỏng");
      },
      commit: () => {
        throw new Error("sổ cái hỏng");
      },
      release: () => {
        throw new Error("sổ cái hỏng");
      },
      snapshot: () => ({ totalReservedBytes: 0, leases: [] }),
      leaseBytes: () => 0,
    }));

    const { loadGgufModel } = await import("../aiGgufEngine");
    await expect(loadGgufModel({ modelPath: "Qwen3-Test.gguf" })).resolves.toBe("Qwen3-Test");
  });

  it("11. nối dây KHÔNG được tự bật bộ đếm giờ nhật ký (chỉ boot mới bật)", async () => {
    const { loadGgufModel } = await import("../aiGgufEngine");
    await loadGgufModel({ modelPath: "Qwen3-Test.gguf" });

    const { __hasVramLogTimer } = await import("./vramEventLog");
    expect(__hasVramLogTimer()).toBe(false);
  });
});

/**
 * Task 5 review vòng 1, I-2 — HỘ TIÊU THỤ THỨ BẢY.
 *
 * `aiImageEmbedding.ts:468` gọi `ort.InferenceSession.create` với EP **`cuda`** khi
 * `ENABLE_CUDA=true`, cache trong `embeddingSessionCache` RIÊNG (không dùng chung
 * `LruSessionCache` của aiInferenceEngine), vào qua `getEmbeddingSession()` từ ≥9 module
 * đang SỐNG (phát hiện bất thường · tìm ảnh · học chủ động · featureStore · embeddingHead).
 *
 * Hôm nay 0 MiB CHỈ VÌ `ENABLE_CUDA` không có trong `.env` — đúng lớp mù đã sinh ra hộ
 * thứ sáu (reranker, 0 MiB chỉ vì `RAG_RERANKER_GPU=false`). Đổi một cờ là có ngay một hộ
 * tiêu thụ mà không công cụ nào thấy.
 */
describe("I-2 — hộ tiêu thụ THỨ BẢY: aiImageEmbedding", () => {
  it("12. extractEmbedding ghi giấy phép onnx-img ở mức PRODUCTION (phục vụ phát hiện bất thường)", async () => {
    const { setLlamaInstanceHandle } = await import("./llamaHandle");
    setLlamaInstanceHandle({ getVramState: async () => ({ used: gpu.used, total: 32 * GiB }) });

    const { extractEmbedding } = await import("../aiImageEmbedding");
    await extractEmbedding(42, Buffer.alloc(64));

    const lease = await leaseOf("onnx-img:AOI-EMB-1");
    expect(lease).toBeDefined();
    expect(lease!.request.kind).toBe("onnx-session");
    expect(lease!.request.priority).toBe("production");
    expect(lease!.actualBytes).toBe(ALLOC.IMG);
  });

  it("13. evictEmbeddingSessionCache TRẢ giấy phép của hộ thứ bảy", async () => {
    const { setLlamaInstanceHandle } = await import("./llamaHandle");
    setLlamaInstanceHandle({ getVramState: async () => ({ used: gpu.used, total: 32 * GiB }) });

    const emb = await import("../aiImageEmbedding");
    await emb.extractEmbedding(42, Buffer.alloc(64));
    expect(await leaseOf("onnx-img:AOI-EMB-1")).toBeDefined();

    emb.evictEmbeddingSessionCache(42);
    expect(await leaseOf("onnx-img:AOI-EMB-1")).toBeUndefined();
  });
});

/**
 * Task 5 review vòng 1, I-4 — LƯỚI CHO PHẦN RỦI RO NHẤT.
 *
 * Bốn khối `catch`-trả-chỗ mới và hai dòng bị sửa duy nhất của cả thay đổi
 * (`LruSessionCache`) trước đây KHÔNG có test nào. Reviewer tự viết 8 ca và cả 8 xanh ⇒ mã
 * đúng — nhưng repo không bắt được hồi quy. Tám ca đó nay nằm ở đây.
 *
 * Nguyên tắc chung cả tám: **telemetry KHÔNG BAO GIỜ được làm hỏng đường cấp phát, và
 * đường cấp phát hỏng KHÔNG BAO GIỜ được để lại giấy phép treo trong sổ.**
 */
describe("I-4 — tám nhánh LỖI: trả chỗ đúng, và telemetry hỏng không làm ngã ai", () => {
  it("A. loadGgufModel NÉM ⇒ sổ RỖNG (không để lại giấy phép ma)", async () => {
    vi.doMock("node-llama-cpp", () => ({
      getLlama: async () => ({
        loadModel: async () => {
          throw new Error("cudaMalloc thất bại (ca thử nghiệm)");
        },
        getVramState: async () => ({ total: 32 * GiB, used: gpu.used, free: 1 }),
      }),
    }));

    const { loadGgufModel } = await import("../aiGgufEngine");
    await expect(loadGgufModel({ modelPath: "Qwen3-Test.gguf" })).rejects.toThrow(/cudaMalloc/);

    expect((await leases()).filter((l) => l.request.owner.startsWith("gguf:"))).toHaveLength(0);
  });

  it("B. ensureTextContext NÉM SAU reserve TRƯỚC commit ⇒ TRẢ chỗ", async () => {
    // createContext ném CHỈ ở lượt tạo LƯỜI (lượt nạp embeddingOnly không gọi createContext).
    vi.doMock("node-llama-cpp", () => {
      class FakeChatSession {
        constructor(_o: unknown) {}
        async prompt() {
          return "ok";
        }
      }
      return {
        getLlama: async () => ({
          loadModel: async () => ({
            size: 1234,
            tokenize: (t: string) => t.split(" "),
            createContext: async () => {
              throw new Error("hết VRAM khi tạo context (ca thử nghiệm)");
            },
            createEmbeddingContext: async () => ({
              getEmbeddingFor: async () => ({ vector: new Array(1024).fill(0.01) }),
              dispose: async () => {},
            }),
            dispose: async () => {},
          }),
          getVramState: async () => ({ total: 32 * GiB, used: gpu.used, free: 1 }),
          createGrammarForJsonSchema: async () => ({ parse: (s: string) => JSON.parse(s) }),
        }),
        LlamaChatSession: FakeChatSession,
        LlamaJsonSchemaGrammar: class {},
        LlamaLogLevel: { fatal: "fatal", error: "error", warn: "warn", info: "info" },
      };
    });

    const eng = await import("../aiGgufEngine");
    await eng.generateEmbedding("một câu tiếng Việt", DEFAULT_BASE);
    await expect(eng.generateText({ prompt: "xin chào" })).rejects.toThrow(/hết VRAM/);

    // Giấy phép gguf-ctx ĐÃ được reserve rồi mới ném ⇒ phải được trả lại, không treo.
    expect(await leaseOf(`gguf-ctx:${DEFAULT_BASE}`)).toBeUndefined();
  });

  it("C. getEmbeddingContext NÉM ⇒ TRẢ chỗ", async () => {
    vi.doMock("node-llama-cpp", () => ({
      getLlama: async () => ({
        loadModel: async () => ({
          size: 1234,
          tokenize: (t: string) => t.split(" "),
          createContext: async () => ({ getSequence: () => ({ dispose: () => {} }), dispose: async () => {} }),
          createEmbeddingContext: async () => {
            throw new Error("model không hỗ trợ nhúng (ca thử nghiệm)");
          },
          dispose: async () => {},
        }),
        getVramState: async () => ({ total: 32 * GiB, used: gpu.used, free: 1 }),
      }),
    }));

    const { generateEmbedding } = await import("../aiGgufEngine");
    await expect(generateEmbedding("câu", "embed-model")).rejects.toThrow(/embedding|nhúng/i);

    expect(await leaseOf("gguf-embed-ctx:embed-model")).toBeUndefined();
  });

  it("D. LruSessionCache ĐUỔI (AI_SESSION_CACHE_MAX=2, nạp model thứ 3) ⇒ TRẢ chỗ model đầu", async () => {
    process.env.AI_SESSION_CACHE_MAX = "2";
    const { setLlamaInstanceHandle } = await import("./llamaHandle");
    setLlamaInstanceHandle({ getVramState: async () => ({ used: gpu.used, total: 32 * GiB }) });

    const { runInference } = await import("../aiInferenceEngine");
    await runInference(1, Buffer.alloc(64));
    await runInference(2, Buffer.alloc(64));
    await runInference(3, Buffer.alloc(64));

    // Ba model dùng CHUNG code "AOI-CLS-1" nên chung owner; điều cần canh là sổ KHÔNG tích
    // luỹ ba giấy phép — cái bị đuổi khỏi cache phải rời sổ theo.
    const onnxLeases = (await leases()).filter((l) => l.request.owner.startsWith("onnx:"));
    expect(onnxLeases).toHaveLength(2);
  });

  // Pha 2A Task 3 — ĐẦU DÒ của đường đo nay là `vramProcessProbe` (bộ đếm theo tiến trình), nên
  // ca "đầu dò ném" phải nhắm vào ĐÓ mới còn kiểm được thứ nó sinh ra để kiểm. Nhắm vào
  // `./vramProbe` như bản cũ sẽ xanh RỖNG: đường đo không còn gọi module đó nữa.
  it("E. đầu dò (theo tiến trình) NÉM ⇒ lượt nạp VẪN xong (chỉ mất số đo)", async () => {
    vi.doMock("./vramProcessProbe", () => ({
      readProcessVram: async () => {
        throw new Error("đầu dò hỏng (ca thử nghiệm)");
      },
    }));

    const { loadGgufModel } = await import("../aiGgufEngine");
    await expect(loadGgufModel({ modelPath: "Qwen3-Test.gguf" })).resolves.toBe("Qwen3-Test");

    // Giấy phép vẫn được ghi (với ước lượng), chỉ KHÔNG có số THẬT.
    const lease = await leaseOf("gguf:Qwen3-Test");
    expect(lease).toBeDefined();
    expect(lease!.actualBytes).toBeNull();
  });

  it("F. logVramEvent NÉM ⇒ lượt nạp VẪN xong", async () => {
    vi.doMock("./vramEventLog", () => ({
      logVramEvent: () => {
        throw new Error("nhật ký hỏng (ca thử nghiệm)");
      },
      __hasVramLogTimer: () => false,
      __setVramLogTimerEnabled: () => {},
      flushVramEvents: async () => 0,
    }));

    const { loadGgufModel } = await import("../aiGgufEngine");
    await expect(loadGgufModel({ modelPath: "Qwen3-Test.gguf" })).resolves.toBe("Qwen3-Test");
  });

  it("G. estimateBytesFor NÉM ⇒ lượt nạp VẪN xong", async () => {
    vi.doMock("./vramEstimator", () => ({
      estimateBytesFor: async () => {
        throw new Error("ước lượng hỏng (ca thử nghiệm)");
      },
      recordActual: () => {},
    }));

    const { loadGgufModel } = await import("../aiGgufEngine");
    await expect(loadGgufModel({ modelPath: "Qwen3-Test.gguf" })).resolves.toBe("Qwen3-Test");
  });

  it("I. aiReranker nạp HỎNG ⇒ TRẢ chỗ, degrade sang llm mà không để lại giấy phép treo", async () => {
    // NEW-6 (review vòng 2): nhánh `catch` của getRankingContext phải trả ĐÚNG giấy phép của
    // chính lượt này. `createRankingContext` ném = ca thật hay gặp nhất (model không phải reranker).
    vi.doMock("node-llama-cpp", () => ({
      getLlama: async () => ({
        loadModel: async () => ({
          createRankingContext: async () => {
            throw new Error("model không có đầu rank (ca thử nghiệm)");
          },
          dispose: async () => {},
        }),
        getVramState: async () => ({ total: 32 * GiB, used: gpu.used, free: 1 }),
      }),
      LlamaLogLevel: { fatal: "fatal", error: "error", warn: "warn", info: "info" },
    }));

    process.env.RAG_RERANKER_ENABLED = "true";
    process.env.RAG_RERANKER_MODE = "gguf";
    process.env.GGUF_RERANKER_MODEL = "bge-reranker-v2-m3-Q8_0.gguf";

    const { rerank } = await import("../aiReranker");
    // rerank KHÔNG BAO GIỜ ném — nó degrade. Điều cần canh là sổ sạch.
    await rerank("câu hỏi", [{ id: "a", text: "tài liệu A" }]);

    expect((await leases()).filter((l) => l.request.owner.startsWith("reranker:"))).toHaveLength(0);
  });

  it("H. InferenceSession.create NÉM ⇒ TRẢ chỗ (không tích luỹ giấy phép mỗi lượt thử lại)", async () => {
    const { setLlamaInstanceHandle } = await import("./llamaHandle");
    setLlamaInstanceHandle({ getVramState: async () => ({ used: gpu.used, total: 32 * GiB }) });

    onnxFail.on = true;
    const { runInference } = await import("../aiInferenceEngine");
    await expect(runInference(1, Buffer.alloc(64))).rejects.toThrow(/ONNX create hỏng/);
    await expect(runInference(1, Buffer.alloc(64))).rejects.toThrow(/ONNX create hỏng/);

    expect((await leases()).filter((l) => l.request.owner.startsWith("onnx:"))).toHaveLength(0);
  });
});
