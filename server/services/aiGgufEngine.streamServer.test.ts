/**
 * ★★★ G1 — ĐỊNH TUYẾN ĐƯỜNG **STREAMING** QUA `llama-server`.
 *
 * TRẠNG THÁI TRƯỚC BẢN VÁ (đo bằng chính lưới `serverCtxOverflow`): `generateTextStream` và
 * `chatCompletionStream` đi THẲNG `getOrLoadModel()`. Hệ quả kép:
 *   • prefix-cache 44–74× (G1-A) KHÔNG phục vụ đường người dùng thật đi;
 *   • và với model 30B mà `llama-server` đang giữ, mọi lượt stream đâm vào cổng G1-D rồi CHẾT —
 *     đúng, nhưng vô ích: câu trả lời không ra.
 *
 * FILE NÀY CANH BỐN CÂU, mỗi câu có cầu chì riêng (KHÔNG neo chung vào một chuỗi — xem ghi chú về
 * đột biến M3 trong `aiGgufEngine.serverCtxOverflow.test.ts`: một lưới chỉ đòi `/TỪ CHỐI/` vẫn
 * xanh 12/12 khi lớp phòng thủ thứ nhất bị gỡ HẲN):
 *   1. Đi ĐÚNG ĐƯỜNG: server bật + khoẻ ⇒ chữ đến từ server, **không một byte trọng số nào được nạp**.
 *   2. Ba cổng của `thuDuongServer` được TÁI DÙNG NGUYÊN VẸN trên đường stream (ngân sách ngữ
 *      cảnh → preflight → cấm-lùi-nạp-trùng). Đây là chỗ lớp lỗi "N+1" hay chui vào: một thân thứ
 *      hai gần-giống, rồi bản vá sau chỉ sửa một thân.
 *   3. ★ CỔNG MỚI CỦA RIÊNG STREAM — **đứt giữa chừng SAU khi đã phát chữ ⇒ CẤM chạy lại**. Đường
 *      không-streaming không có cổng này vì nó không thể "đã trả một nửa". Chạy lại ở đây tạo ra
 *      một câu trả lời NỐI HAI NỬA của hai lượt suy luận khác nhau, và không ai được báo.
 *   4. Đường KHÔNG được phá: model khác (4B/FIM/embed) và server-im-lặng vẫn chạy in-process y cũ.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GgufStreamChunk } from "./aiGgufEngine";

// ─── Mock llama-server client — cùng khuôn với serverCtxOverflow.test.ts ──────────────────────
const shouldUseServerForTextMock = vi.fn<(...a: any[]) => boolean>();
const laModelServerDangGiuMock = vi.fn<(...a: any[]) => boolean>();
const preflightHealthyMock = vi.fn<(...a: any[]) => Promise<boolean>>();
const llamaServerStrictMock = vi.fn<() => boolean>(() => false);
const llamaServerEnabledMock = vi.fn<() => boolean>(() => true);
const serverGenerateTextStreamMock = vi.fn<(...a: any[]) => AsyncGenerator<GgufStreamChunk>>();
const serverChatCompletionStreamMock = vi.fn<(...a: any[]) => AsyncGenerator<GgufStreamChunk>>();

vi.mock("./aiLlamaServerClient", async () => {
  // ⚠ Các hàm THUẦN (ngân sách ngữ cảnh, `laLoiTranNguCanh`, `LoiStreamServer`,
  // `daPhatChuTruocKhiHong`) dùng BẢN THẬT — chúng chính là vị từ đang được kiểm.
  const that = await vi.importActual<typeof import("./aiLlamaServerClient")>("./aiLlamaServerClient");
  return {
    ...that,
    shouldUseServerForText: (...a: any[]) => shouldUseServerForTextMock(...a),
    laModelServerDangGiu: (...a: any[]) => laModelServerDangGiuMock(...a),
    preflightHealthy: (...a: any[]) => preflightHealthyMock(...a),
    llamaServerStrict: (...a: any[]) => (llamaServerStrictMock as (...x: any[]) => any)(...a),
    llamaServerEnabled: (...a: any[]) => (llamaServerEnabledMock as (...x: any[]) => any)(...a),
    serverGenerateTextStream: (...a: any[]) => serverGenerateTextStreamMock(...a),
    serverChatCompletionStream: (...a: any[]) => serverChatCompletionStreamMock(...a),
  };
});

vi.mock("./aiModelRouter", () => ({
  getThinkingTierStatus: () => ({ enabled: false, modelConfigured: false, fileExists: false, active: false, reason: "off" }),
}));

// ─── node-llama-cpp giả: đường in-process CHẠY THẬT (để "không nạp" là một phép ĐO, không phải giả định) ──
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

/** Luồng server giả: phát các mảnh chữ rồi `done`; `loiSau` (nếu có) ném SAU khi phát xong. */
function luongServer(manh: string[], loiSau?: Error) {
  return async function* (): AsyncGenerator<GgufStreamChunk> {
    for (const m of manh) yield { type: "token", token: m };
    if (loiSau) throw loiSau;
    yield {
      type: "done",
      fullText: manh.join(""),
      tokensGenerated: manh.length,
      tokensPrompt: 7,
      totalTimeMs: 12,
      ttftMs: 4,
      tokensPerSecond: 100,
      modelId: SERVED,
    };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  process.env.GGUF_MAX_LOADED_MODELS = "2";
  process.env.GGUF_DEFAULT_MODEL = `${SERVED}.gguf`;
  process.env.LLAMA_SERVER_ENABLED = "true";
  process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8091";
  process.env.LLAMA_SERVER_MODEL = `${SERVED}.gguf`;
  process.env.GGUF_MAX_CTX = "32768";
  delete process.env.LLAMA_SERVER_CTX_PER_SLOT;
  delete process.env.LLAMA_SERVER_CTX;
  delete process.env.LLAMA_SERVER_PARALLEL;
  shouldUseServerForTextMock.mockReturnValue(true);
  laModelServerDangGiuMock.mockReturnValue(true);
  llamaServerStrictMock.mockReturnValue(false);
  llamaServerEnabledMock.mockReturnValue(true);
  preflightHealthyMock.mockResolvedValue(true);
  serverGenerateTextStreamMock.mockImplementation(luongServer(["Xin", " chào"]));
  serverChatCompletionStreamMock.mockImplementation(luongServer(["Hi", " there"]));
});

async function freshEngine() {
  vi.resetModules();
  return await import("./aiGgufEngine");
}

async function gom(gen: AsyncGenerator<GgufStreamChunk>): Promise<{ chunk: GgufStreamChunk[]; loi: Error | null }> {
  const chunk: GgufStreamChunk[] = [];
  try {
    for await (const c of gen) chunk.push(c);
    return { chunk, loi: null };
  } catch (e) {
    return { chunk, loi: e as Error };
  }
}

// ═══ CÂU 1 — ĐI ĐÚNG ĐƯỜNG ════════════════════════════════════════════════════════════════════
describe("★★★ câu 1: đường stream ĐI QUA llama-server (trước bản vá nó chưa bao giờ hỏi)", () => {
  it("★ generateTextStream: chữ đến TỪ SERVER và KHÔNG một byte trọng số nào được nạp", async () => {
    const eng = await freshEngine();
    const { chunk, loi } = await gom(eng.generateTextStream({ prompt: "câu hỏi ngắn" }));

    expect(loi).toBeNull();
    expect(chunk.filter((c) => c.type === "token").map((c) => c.token)).toEqual(["Xin", " chào"]);
    expect(chunk.at(-1)!.type).toBe("done");
    expect(chunk.at(-1)!.fullText).toBe("Xin chào");
    expect(serverGenerateTextStreamMock).toHaveBeenCalledTimes(1);
    // ĐÂY LÀ CÂU TRUNG TÂM: không có lượt nạp 30B thứ hai nào.
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
  });

  it("★ chatCompletionStream (đường /v1 gateway) cũng đi qua server, gửi NGUYÊN messages", async () => {
    const eng = await freshEngine();
    const { chunk, loi } = await gom(
      eng.chatCompletionStream({ messages: [{ role: "system", content: "S" }, { role: "user", content: "U" }] }),
    );
    expect(loi).toBeNull();
    expect(chunk.filter((c) => c.type === "token").map((c) => c.token)).toEqual(["Hi", " there"]);
    expect(serverChatCompletionStreamMock).toHaveBeenCalledTimes(1);
    const opts = serverChatCompletionStreamMock.mock.calls[0][0] as any;
    expect(opts.messages.map((m: any) => m.role)).toEqual(["system", "user"]);
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
  });

  it("AbortSignal của consumer được CHUYỂN TIẾP xuống client (huỷ tab phải huỷ lượt trên server)", async () => {
    const eng = await freshEngine();
    const ac = new AbortController();
    await gom(eng.generateTextStream({ prompt: "hi" }, undefined, ac.signal));
    expect(serverGenerateTextStreamMock.mock.calls[0][2]).toBe(ac.signal);
  });
});

// ═══ CÂU 2 — BA CỔNG CỦA `thuDuongServer` ĐƯỢC TÁI DÙNG NGUYÊN VẸN ═══════════════════════════
describe("★★ câu 2: đường stream dùng LẠI đúng ba cổng của đường không-streaming", () => {
  it("★ cổng (a) NGÂN SÁCH NGỮ CẢNH: prompt vượt trần/slot ⇒ không gửi, không nạp, câu từ chối nêu SỐ", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const eng = await freshEngine();

    const prompt = "ngữ cảnh RAG rất dài. ".repeat(10_000); // ~200.000 ký tự ⇒ ≥71.000 token
    const { loi } = await gom(eng.generateTextStream({ prompt }));

    expect(loi?.message).toMatch(/TỪ CHỐI TRUNG THỰC/);
    expect(loi?.message).toMatch(/32768 token MỖI SLOT/);
    expect(serverGenerateTextStreamMock).not.toHaveBeenCalled(); // chặn TỪ ĐẦU VÀO
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("cổng (a) áp cả cho chatCompletionStream (ngân sách tính trên TOÀN BỘ lịch sử hội thoại)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const eng = await freshEngine();

    const { loi } = await gom(
      eng.chatCompletionStream({
        messages: [
          { role: "system", content: "S".repeat(100_000) },
          { role: "user", content: "U".repeat(100_000) },
        ],
      }),
    );
    expect(loi?.message).toMatch(/TỪ CHỐI TRUNG THỰC/);
    expect(serverChatCompletionStreamMock).not.toHaveBeenCalled();
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("★ cổng (b) PREFLIGHT hỏng ⇒ server không giữ VRAM ⇒ VẪN lùi in-process (lưới an toàn cố ý)", async () => {
    preflightHealthyMock.mockResolvedValue(false);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const eng = await freshEngine();

    const { chunk, loi } = await gom(eng.generateTextStream({ prompt: "hi" }));
    expect(loi).toBeNull();
    expect(chunk.map((c) => c.token).join("")).toContain(IN_PROCESS_ANSWER);
    expect(serverGenerateTextStreamMock).not.toHaveBeenCalled();
    expect(fakeLlama.loadModel).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("cổng (b) + LLAMA_SERVER_STRICT=true ⇒ NÉM thay vì lùi (van an toàn cũ, không đổi)", async () => {
    preflightHealthyMock.mockResolvedValue(false);
    llamaServerStrictMock.mockReturnValue(true);
    const eng = await freshEngine();
    const { loi } = await gom(eng.generateTextStream({ prompt: "hi" }));
    expect(loi?.message).toMatch(/LLAMA_SERVER_STRICT/);
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
  });

  it("★ cổng (c) CẤM LÙI-NẠP-TRÙNG: server còn sống, stream hỏng TRƯỚC mảnh chữ nào ⇒ từ chối, không nạp", async () => {
    serverGenerateTextStreamMock.mockImplementation(
      luongServer([], new Error("[llamaServer] stream HTTP 400: exceeds the available context size")),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const eng = await freshEngine();

    const { chunk, loi } = await gom(eng.generateTextStream({ prompt: "hi" }));
    expect(chunk.filter((c) => c.type === "token")).toHaveLength(0);
    expect(loi?.message).toMatch(/TỪ CHỐI TRUNG THỰC/);
    expect(loi?.message).toMatch(/còn SỐNG \(vừa qua thăm dò\) nhưng lượt sinh chữ hỏng/);
    expect(loi?.message).toMatch(/VƯỢT NGỮ CẢNH/); // nói ĐÚNG nguyên nhân
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });
});

// ═══ CÂU 3 — CỔNG RIÊNG CỦA STREAM: ĐỨT GIỮA CHỪNG ═══════════════════════════════════════════
describe("★★★ câu 3: đứt SAU khi đã phát chữ ⇒ TUYỆT ĐỐI không chạy lại (câu trả lời nối hai nửa)", () => {
  const NUA_CAU = ["Nguyên nhân", " gốc rễ là"];

  it("★★★ server chết giữa chừng: chữ đã ra ⇒ NÉM, KHÔNG nạp in-process, câu lỗi nói rõ 'nối hai nửa'", async () => {
    serverGenerateTextStreamMock.mockImplementation(async function* () {
      for (const m of NUA_CAU) yield { type: "token", token: m } as GgufStreamChunk;
      const e: any = new Error("[llamaServer] stream lỗi: ECONNRESET");
      e.daPhatChu = true;
      throw e;
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const eng = await freshEngine();

    const { chunk, loi } = await gom(eng.generateTextStream({ prompt: "hi" }));
    expect(chunk.map((c) => c.token).join("")).toBe(NUA_CAU.join("")); // nửa câu ĐÃ ra ngoài
    expect(loi?.message).toMatch(/ĐỨT GIỮA CHỪNG/);
    expect(loi?.message).toMatch(/NỐI HAI NỬA/);
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
    expect(chunk.map((c) => c.token).join("")).not.toContain(IN_PROCESS_ANSWER); // không chạy lại
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("★★★ CẢ KHI model đã nằm sẵn in-process (lùi không tốn byte nào) vẫn KHÔNG được chạy lại", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const eng = await freshEngine();

    // Bước 1 — làm cho model nằm sẵn (đường server tắt).
    shouldUseServerForTextMock.mockReturnValue(false);
    laModelServerDangGiuMock.mockReturnValue(false);
    await gom(eng.generateTextStream({ prompt: "hi" }));
    const soNapBanDau = fakeLlama.loadModel.mock.calls.length;
    expect(soNapBanDau).toBe(1);

    // Bước 2 — bật lại server; nó đứt SAU khi phát chữ.
    shouldUseServerForTextMock.mockReturnValue(true);
    laModelServerDangGiuMock.mockReturnValue(true);
    serverGenerateTextStreamMock.mockImplementation(async function* () {
      yield { type: "token", token: "nửa" } as GgufStreamChunk;
      const e: any = new Error("ECONNRESET");
      e.daPhatChu = true;
      throw e;
    });

    const { chunk, loi } = await gom(eng.generateTextStream({ prompt: "hi" }));
    // ⚠ Đây là điểm PHÂN BIỆT với đường không-streaming: ở đó "model đã nằm sẵn" là ngoại lệ CHO
    // PHÉP lùi. Ở đây KHÔNG, vì cái ngăn cản không phải VRAM mà là tính toàn vẹn của câu trả lời.
    expect(loi?.message).toMatch(/ĐỨT GIỮA CHỪNG/);
    expect(chunk.map((c) => c.token).join("")).not.toContain(IN_PROCESS_ANSWER);
    expect(fakeLlama.loadModel.mock.calls.length).toBe(soNapBanDau);
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("chatCompletionStream có CÙNG cổng đứt-giữa-chừng (không phải chỉ generateTextStream)", async () => {
    serverChatCompletionStreamMock.mockImplementation(async function* () {
      yield { type: "token", token: "half" } as GgufStreamChunk;
      const e: any = new Error("socket hang up");
      e.daPhatChu = true;
      throw e;
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const eng = await freshEngine();
    const { loi } = await gom(eng.chatCompletionStream({ messages: [{ role: "user", content: "hi" }] }));
    expect(loi?.message).toMatch(/ĐỨT GIỮA CHỪNG/);
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });
});

// ═══ CÂU 4 — ĐƯỜNG KHÔNG ĐƯỢC PHÁ ════════════════════════════════════════════════════════════
describe("câu 4: mọi thứ KHÔNG phải model server giữ vẫn chạy in-process y như cũ", () => {
  it("model KHÁC (4B/FIM/embed): stream in-process, client server KHÔNG bị gọi lần nào", async () => {
    shouldUseServerForTextMock.mockReturnValue(false);
    laModelServerDangGiuMock.mockReturnValue(false);
    const eng = await freshEngine();
    const { chunk, loi } = await gom(eng.generateTextStream({ prompt: "hi" }, "qwen3-4b-instruct"));
    expect(loi).toBeNull();
    expect(chunk.map((c) => c.token).join("")).toContain(IN_PROCESS_ANSWER);
    expect(serverGenerateTextStreamMock).not.toHaveBeenCalled();
    expect(preflightHealthyMock).not.toHaveBeenCalled(); // đường nóng KHÔNG tốn một lượt thăm dò
    expect(fakeLlama.loadModel).toHaveBeenCalled();
  });

  it("LLAMA_SERVER_ENABLED off (mặc định của mọi cài đặt hôm nay): stream in-process, không đổi một byte hành vi", async () => {
    shouldUseServerForTextMock.mockReturnValue(false);
    laModelServerDangGiuMock.mockReturnValue(false);
    llamaServerEnabledMock.mockReturnValue(false);
    const eng = await freshEngine();
    const { chunk, loi } = await gom(eng.chatCompletionStream({ messages: [{ role: "user", content: "hi" }] }));
    expect(loi).toBeNull();
    expect(chunk.map((c) => c.token).join("")).toContain(IN_PROCESS_ANSWER);
    expect(serverChatCompletionStreamMock).not.toHaveBeenCalled();
  });
});
