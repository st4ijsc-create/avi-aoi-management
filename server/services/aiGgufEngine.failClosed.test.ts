/**
 * ★★★ Đợt 0.1 — FAIL-CLOSED cho model CHÍNH: llama-server chết ⇒ KHÔNG nạp model đó vào tiến trình node.
 *
 * ĐO ĐƯỢC (2026-10-14): `:8091` chết từ 10/9; `/api/health/ai` báo `fallback: silent`; lượt sinh mã
 * kế tiếp sẽ nạp model 21 GB vào tiến trình node (TTFT 71 → 5.304 ms), và khi giám sát (hoặc người)
 * dựng lại llama-server thì HAI bản cùng model tranh 32 GB VRAM.
 *
 * Hợp đồng canh ở đây:
 *   • model server đang giữ + server chết ⇒ CHỜ có trần cho giám sát dựng lại; sống lại ⇒ phục vụ QUA
 *     server; vẫn chết ⇒ ném `LLAMA_SERVER_DOWN` — và `llama.loadModel` KHÔNG BAO GIỜ được gọi.
 *   • phủ CẢ BỐN đường sinh chữ (generateText · generateJSON · generateTextStream · chatCompletion ·
 *     chatCompletionStream) lẫn ĐIỂM NGHẼN `loadGgufModel` (đường không hỏi server: warmModel/FIM).
 *   • model KHÁC (4B fast / embed / FIM in-process) không bị ảnh hưởng.
 *   • `LLAMA_SERVER_STRICT=true` giữ NGUYÊN câu cũ; `LLAMA_SERVER_FAIL_CLOSED=false` = hành vi cũ.
 *
 * ⚠ KHÔNG mock `./ai/giamSatLlamaServer` — chính cửa chờ là thứ đang được kiểm. Thứ được giả là
 *   `preflightHealthy` (phép "server khoẻ chưa") và node-llama-cpp, để không ca nào mở kết nối thật
 *   tới :8091 (đang có phép đo chạy trên đó) và để đường in-process CHẠY THẬT nếu bị lọt vào.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const shouldUseServerForTextMock = vi.fn<(...a: any[]) => boolean>();
const laModelServerDangGiuMock = vi.fn<(...a: any[]) => boolean>();
const preflightHealthyMock = vi.fn<(...a: any[]) => Promise<boolean>>();
const serverGenerateTextMock = vi.fn<(...a: any[]) => Promise<any>>();
const serverGenerateJSONMock = vi.fn<(...a: any[]) => Promise<any>>();
const serverChatCompletionMock = vi.fn<(...a: any[]) => Promise<any>>();
const serverGenerateTextStreamMock = vi.fn<(...a: any[]) => AsyncGenerator<any>>();
const serverChatCompletionStreamMock = vi.fn<(...a: any[]) => AsyncGenerator<any>>();
const llamaServerStrictMock = vi.fn<() => boolean>(() => false);

vi.mock("./aiLlamaServerClient", async () => {
  const that = await vi.importActual<typeof import("./aiLlamaServerClient")>("./aiLlamaServerClient");
  return {
    ...that,
    shouldUseServerForText: (...a: any[]) => shouldUseServerForTextMock(...a),
    laModelServerDangGiu: (...a: any[]) => laModelServerDangGiuMock(...a),
    preflightHealthy: (...a: any[]) => preflightHealthyMock(...a),
    preflightHealthyForFim: async () => false,
    serverGenerateText: (...a: any[]) => serverGenerateTextMock(...a),
    serverGenerateJSON: (...a: any[]) => serverGenerateJSONMock(...a),
    serverChatCompletion: (...a: any[]) => serverChatCompletionMock(...a),
    serverGenerateTextStream: (...a: any[]) => serverGenerateTextStreamMock(...a),
    serverChatCompletionStream: (...a: any[]) => serverChatCompletionStreamMock(...a),
    llamaServerStrict: (...a: any[]) => (llamaServerStrictMock as (...x: any[]) => any)(...a),
    llamaServerEnabled: () => true,
    llamaServerHealthy: async () => false,
  };
});

vi.mock("./aiModelRouter", () => ({
  getThinkingTierStatus: () => ({ enabled: false, modelConfigured: false, fileExists: false, active: false, reason: "off" }),
}));

const IN_PROCESS_ANSWER = "in-process answer";
function makeFakeModel() {
  return {
    size: 1234,
    gpuLayers: 99,
    tokenize: (t: string) => t.split(" "),
    createContext: vi.fn(async () => ({ getSequence: () => ({ dispose: vi.fn() }), dispose: vi.fn() })),
    dispose: vi.fn(),
  };
}
const GiB = 1024 * 1024 * 1024;
const fakeLlama = {
  loadModel: vi.fn(async () => makeFakeModel()),
  getVramState: vi.fn(async () => ({ total: 32 * GiB, used: 2 * GiB, free: 30 * GiB, unifiedSize: 0 })),
  createGrammarForJsonSchema: vi.fn(async () => ({ parse: (s: string) => JSON.parse(s) })),
};
class FakeChatSession {
  constructor(_opts: any) {}
  async prompt(_p: string, opts: any) {
    if (opts?.grammar) return JSON.stringify({ ok: true });
    opts?.onTextChunk?.(IN_PROCESS_ANSWER);
    return IN_PROCESS_ANSWER;
  }
}
vi.mock("node-llama-cpp", () => ({
  getLlama: vi.fn(async () => fakeLlama),
  LlamaChatSession: FakeChatSession,
  LlamaJsonSchemaGrammar: class {},
}));

vi.mock("fs", () => {
  const api = {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => [] as string[]),
    statSync: vi.fn(() => ({ size: 1234, mtime: new Date() })),
  };
  return { default: api, ...api };
});

const SERVED = "qwen3-30b-a3b-instruct";
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  process.env.GGUF_MAX_LOADED_MODELS = "2";
  process.env.GGUF_DEFAULT_MODEL = `${SERVED}.gguf`;
  process.env.LLAMA_SERVER_ENABLED = "true";
  process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8091";
  process.env.LLAMA_SERVER_MODEL = `${SERVED}.gguf`;
  process.env.GGUF_MAX_CTX = "32768";
  // Trần chờ ngắn để lưới chạy nhanh — giá trị THẬT mặc định (120 s) được canh ở giamSatLlamaServer.test.ts.
  process.env.LLAMA_SERVER_DOWN_WAIT_MS = "60";
  process.env.LLAMA_SERVER_DOWN_POLL_MS = "10";
  delete process.env.LLAMA_SERVER_FAIL_CLOSED;
  delete process.env.LLAMA_WATCHDOG_ENABLED;
  delete process.env.LLAMA_SERVER_CTX_PER_SLOT;
  delete process.env.LLAMA_SERVER_CTX;
  delete process.env.LLAMA_SERVER_PARALLEL;
  shouldUseServerForTextMock.mockReturnValue(true);
  laModelServerDangGiuMock.mockReturnValue(true);
  llamaServerStrictMock.mockReturnValue(false);
  preflightHealthyMock.mockResolvedValue(false);
});

async function freshEngine() {
  vi.resetModules();
  return await import("./aiGgufEngine");
}

async function gomStream(it: AsyncIterable<any>): Promise<any[]> {
  const out: any[] = [];
  for await (const c of it) out.push(c);
  return out;
}

const SERVER_TRA_LOI = {
  text: "server answer",
  tokensGenerated: 2,
  tokensPrompt: 1,
  totalTimeMs: 5,
  tokensPerSecond: 100,
  modelId: SERVED,
};

describe("★★★ model CHÍNH + server chết ⇒ KHÔNG nạp in-process, ném LLAMA_SERVER_DOWN", () => {
  it("generateText: chờ tới trần rồi ném mã LLAMA_SERVER_DOWN; loadModel KHÔNG được gọi", async () => {
    const eng = await freshEngine();
    const loi = await eng.generateText({ prompt: "hi" }).catch((e) => e);
    expect(loi?.code).toBe("LLAMA_SERVER_DOWN");
    expect(String(loi?.message)).toMatch(/khởi động lại/);
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
    // Đã THỰC SỰ chờ (thăm dò lặp lại), không phải ném ngay sau preflight đầu.
    expect(preflightHealthyMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("generateJSON: cùng cửa", async () => {
    const eng = await freshEngine();
    const loi = await eng.generateJSON({ type: "object" }, { prompt: "hi" }).catch((e) => e);
    expect(loi?.code).toBe("LLAMA_SERVER_DOWN");
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
  });

  it("chatCompletion (đường sinh mã của copilot): cùng cửa", async () => {
    const eng = await freshEngine();
    const loi = await eng.chatCompletion({ messages: [{ role: "user", content: "hi" }] }).catch((e) => e);
    expect(loi?.code).toBe("LLAMA_SERVER_DOWN");
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
  });

  it("generateTextStream + chatCompletionStream: cùng cửa (không phát chữ in-process)", async () => {
    const eng = await freshEngine();
    const l1 = await gomStream(eng.generateTextStream({ prompt: "hi" })).catch((e) => e);
    const l2 = await gomStream(eng.chatCompletionStream({ messages: [{ role: "user", content: "hi" }] })).catch((e) => e);
    for (const l of [l1, l2]) {
      if (Array.isArray(l)) {
        // Một số đường stream biến lỗi thành chunk `error` thay vì ném — chấp nhận cả hai, miễn KHÔNG có chữ in-process.
        expect(l.some((c) => c.type === "token" && String(c.token).includes(IN_PROCESS_ANSWER))).toBe(false);
        expect(JSON.stringify(l)).toMatch(/LLAMA_SERVER_DOWN/);
      } else {
        expect(l?.code).toBe("LLAMA_SERVER_DOWN");
      }
    }
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
  });

  it("★ server SỐNG LẠI trong lúc chờ ⇒ lượt được phục vụ QUA server, không nạp gì", async () => {
    let n = 0;
    preflightHealthyMock.mockImplementation(async () => ++n >= 3);
    serverGenerateTextMock.mockResolvedValue(SERVER_TRA_LOI);
    const eng = await freshEngine();
    const r = await eng.generateText({ prompt: "hi" });
    expect(r.text).toBe("server answer");
    expect(serverGenerateTextMock).toHaveBeenCalledTimes(1);
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
  });

  it("LLAMA_WATCHDOG_ENABLED=false ⇒ không ai dựng lại ⇒ ném NGAY (một lần thăm dò), không chờ", async () => {
    process.env.LLAMA_WATCHDOG_ENABLED = "false";
    process.env.LLAMA_SERVER_DOWN_WAIT_MS = "60000";
    const eng = await freshEngine();
    const t0 = Date.now();
    const loi = await eng.generateText({ prompt: "hi" }).catch((e) => e);
    expect(loi?.code).toBe("LLAMA_SERVER_DOWN");
    expect(String(loi?.message)).toMatch(/giám sát tự khởi động lại đang TẮT/);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(preflightHealthyMock).toHaveBeenCalledTimes(1);
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
  });

  it("★ ĐIỂM NGHẼN: đường KHÔNG hỏi server (warmModel) cho model chính + server chết ⇒ LLAMA_SERVER_DOWN, không nạp", async () => {
    const eng = await freshEngine();
    const loi = await eng.loadGgufModel({ modelPath: `${SERVED}.gguf` }).catch((e: any) => e);
    expect(loi?.code).toBe("LLAMA_SERVER_DOWN");
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
  });
});

describe("KHÔNG phá đường khác", () => {
  it("model KHÁC (4B fast / embed) ⇒ in-process chạy bình thường, không chờ", async () => {
    laModelServerDangGiuMock.mockImplementation((id?: string) => !id || String(id).includes("30b"));
    shouldUseServerForTextMock.mockImplementation((id?: string) => !id || String(id).includes("30b"));
    const eng = await freshEngine();
    const r = await eng.generateText({ prompt: "hi" }, "qwen3-4b-instruct");
    expect(r.text).toBe(IN_PROCESS_ANSWER);
    expect(fakeLlama.loadModel).toHaveBeenCalled();
    expect(preflightHealthyMock).not.toHaveBeenCalled();
  });

  it("LLAMA_SERVER_STRICT=true ⇒ câu ném CŨ, nguyên văn (tương thích)", async () => {
    llamaServerStrictMock.mockReturnValue(true);
    const eng = await freshEngine();
    await expect(eng.generateText({ prompt: "hi" })).rejects.toThrow(/LLAMA_SERVER_STRICT/);
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
  });

  it("LLAMA_SERVER_FAIL_CLOSED=false ⇒ hành vi CŨ: lùi in-process (lối thoát có chủ ý của người vận hành)", async () => {
    process.env.LLAMA_SERVER_FAIL_CLOSED = "false";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const eng = await freshEngine();
    const r = await eng.generateText({ prompt: "hi" });
    expect(r.text).toBe(IN_PROCESS_ANSWER);
    expect(fakeLlama.loadModel).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
