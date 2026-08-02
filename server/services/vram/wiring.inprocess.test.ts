/**
 * Pha 1 Task 5 — DÂY NỐI trong tiến trình.
 *
 * Bốn task trước dựng xong sổ cái (Task 1), nhật ký (Task 2), ước lượng (Task 3) và đối chiếu
 * (Task 4) — nhưng KHÔNG AI GỌI chúng. Test này canh đúng một điều: mỗi điểm cấp phát VRAM
 * trong tiến trình để lại MỘT giấy phép trong sổ, kèm số THẬT đo quanh lượt cấp phát.
 *
 * SÁU hộ tiêu thụ:
 *   1. loadGgufModel                 gguf:${modelId}            gguf-model          interactive
 *   2. getEmbeddingContext           gguf-embed-ctx:${modelId}  gguf-embed-context  background
 *   3. ensureTextContext             gguf-ctx:${modelId}        gguf-context        interactive
 *   4. aiInferenceEngine.getSession  onnx:${model.code}         onnx-session        production
 *   5. ocrService.getOnnxSession     onnx-ocr:${modelPath}      onnx-session        production
 *   6. aiReranker (llama.loadModel)  reranker:${modelPath}      gguf-model          background
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
}));

/** Kích thước file .gguf/.onnx trên đĩa — nguồn của ước lượng nấc "file-size". */
const FILE_BYTES = vi.hoisted(() => 777 * 1024 * 1024);

vi.mock("node-llama-cpp", () => {
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

vi.mock("onnxruntime-node", () => ({
  InferenceSession: {
    create: async (modelPath: string) => {
      // Hai hộ ONNX cộng số KHÁC NHAU để test phân biệt được lease của ai.
      gpu.used += /rec\.onnx$/.test(String(modelPath)) ? ALLOC.OCR : ALLOC.ONNX;
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

vi.mock("../../db/ai", () => ({
  getAiModelById: async (id: number) => ({
    id,
    code: "AOI-CLS-1",
    currentVersion: "1.0.0",
    status: "ACTIVE",
    filePath: "/uploads/models/cls.onnx",
    preprocessConfig: { resize: { width: 224, height: 224 }, colorSpace: "RGB", channelFirst: true },
    inputShape: [1, 3, 224, 224],
    labels: ["ok", "ng"],
    postprocessConfig: { outputType: "classification", confidenceThreshold: 0.1, topK: 5 },
  }),
  createInferenceResult: async () => ({ id: 1 }),
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
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  process.env.GGUF_DEFAULT_MODEL = DEFAULT_FILE;
  process.env.GGUF_EMBED_DIM = "1024";
  process.env.GGUF_MAX_LOADED_MODELS = "8";
  process.env.GGUF_MAX_VRAM_MB = "0";
  process.env.GGUF_MAX_CONCURRENCY = "4";
  process.env.AI_BATCH_MAX = "1"; // đường trực tiếp, không micro-batch → xác định
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
