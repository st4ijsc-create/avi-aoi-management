/**
 * ★★★ G5-D · P1 — `chatCompletion()` ĐI QUA `llama-server`, và ba cổng G1-D CÒN NGUYÊN.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖI ĐANG VÁ — **lỗi CHẶN, không phải "thiếu tối ưu"**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `generateText`/`generateJSON` đi qua `thuDuongServer()` từ G1-D. `chatCompletion()` thì KHÔNG —
 * nó đi thẳng `getOrLoadModel()`. Mà `aiProgrammingCopilot.runCodeModel()` dùng đúng
 * `chatCompletion()`.
 * Hệ quả ở cấu hình `GGUF_CODE_MODEL == LLAMA_SERVER_MODEL` (chính là cấu hình "MỘT model duy
 * nhất" mà phép A/B cần): lượt in-process đòi nạp đúng model server đang giữ ⇒ cổng
 * `chanNapTrungModelServer()` NÉM (đúng chức trách) ⇒ copilot nuốt lỗi ⇒ **mọi yêu cầu sinh mã
 * trả "không có gợi ý" trong im lặng**. Model được chọn làm "một model duy nhất" tự động thua ở
 * mọi lượt sinh mã ⇒ phép A/B bất công **theo cấu tạo**.
 *
 * ⚠ BẤT BIẾN PHẢI GIỮ (đây là phần dễ làm hỏng nhất của bản vá):
 *   (a) `kiemNganSachNguCanh()` — cổng ngân sách ngữ cảnh, hằng **2,8 ký tự/token** đã đo. Đường
 *       chat phải dùng CHÍNH nó, không được có phép cân thứ hai.
 *   (b) `laModelServerDangGiu()` — cấm nạp trùng theo BẰNG CHỨNG.
 *   (c) điểm nghẽn `loadGgufModel()` vẫn chặn đường chat khi đường server KHÔNG được chọn.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const shouldUseServerForTextMock = vi.fn(() => true);
const laModelServerDangGiuMock = vi.fn(() => true);
const preflightHealthyMock = vi.fn(async () => true);
const serverChatCompletionMock = vi.fn();
const llamaServerStrictMock = vi.fn(() => false);

vi.mock("./aiLlamaServerClient", async () => {
  // Ba hàm THUẦN (`uocLuongSoToken`/`kiemNganSachNguCanh`/`serverSlotContextTokens`) dùng BẢN
  // THẬT: chúng chính là cổng đang được kiểm, giả chúng đi là dựng một cái thước thứ hai.
  const that = await vi.importActual<typeof import("./aiLlamaServerClient")>("./aiLlamaServerClient");
  return {
    ...that,
    shouldUseServerForText: (...a: any[]) => (shouldUseServerForTextMock as any)(...a),
    laModelServerDangGiu: (...a: any[]) => (laModelServerDangGiuMock as any)(...a),
    preflightHealthy: (...a: any[]) => (preflightHealthyMock as any)(...a),
    serverChatCompletion: (...a: any[]) => serverChatCompletionMock(...a),
    llamaServerStrict: (...a: any[]) => (llamaServerStrictMock as any)(...a),
  };
});

vi.mock("./aiModelRouter", () => ({
  getThinkingTierStatus: () => ({ enabled: false, modelConfigured: false, fileExists: false, active: false, reason: "off" }),
}));

// node-llama-cpp giả — đường in-process CHẠY THẬT để phân biệt "được server phục vụ" với "đã nạp".
const IN_PROCESS = "in-process answer";
const napModel = vi.fn(async () => ({
  size: 1234,
  tokenize: (s: string) => new Array(Math.ceil(s.length / 4)).fill(0),
  createContext: async () => ({
    contextSize: 4096,
    getSequence: () => ({ dispose() {} }),
    dispose() {},
  }),
  dispose() {},
}));
vi.mock("node-llama-cpp", () => ({
  getLlama: async () => ({ loadModel: napModel, createGrammarForJsonSchema: async () => ({}) }),
  LlamaChatSession: class {
    async prompt() {
      return IN_PROCESS;
    }
  },
  LlamaJsonSchemaGrammar: class {},
}));

// Đường in-process kiểm sự tồn tại của file trọng số trước khi nạp; ở đây không có file thật nào.
vi.mock("fs", () => {
  const api = {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => [] as string[]),
    statSync: vi.fn(() => ({ size: 1234, mtime: new Date() })),
  };
  return { default: api, ...api };
});

async function freshEngine() {
  vi.resetModules();
  return await import("./aiGgufEngine");
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.LLAMA_SERVER_ENABLED = "true";
  process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8091";
  process.env.GGUF_DEFAULT_MODEL = "qwen3-30b-a3b-instruct.gguf";
  process.env.LLAMA_SERVER_MODEL = "qwen3-30b-a3b-instruct.gguf";
  delete process.env.LLAMA_SERVER_CTX_PER_SLOT;
  delete process.env.LLAMA_SERVER_CTX;
  delete process.env.GGUF_MAX_CTX;
  napModel.mockClear();
  shouldUseServerForTextMock.mockReturnValue(true);
  laModelServerDangGiuMock.mockReturnValue(true);
  preflightHealthyMock.mockResolvedValue(true);
  llamaServerStrictMock.mockReturnValue(false);
  serverChatCompletionMock.mockReset();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const HOI = { messages: [{ role: "user" as const, content: "sinh cho tôi một khối ST" }] };

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §1 — ĐƯỜNG SERVER CÓ THẬT (đây là bản vá P1)
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("G5-D · P1 §1 — chatCompletion đi qua llama-server", () => {
  it("★★★ model là CHÍNH cái server đang giữ ⇒ ĐƯỢC SERVER PHỤC VỤ, KHÔNG nạp bản thứ hai", async () => {
    serverChatCompletionMock.mockResolvedValue({
      text: "PROGRAM p END_PROGRAM",
      tokensGenerated: 9,
      tokensPrompt: 20,
      totalTimeMs: 5,
      tokensPerSecond: 1800,
      modelId: "qwen3-30b-a3b-instruct",
    });
    const eng = await freshEngine();
    const r = await eng.chatCompletion(HOI);
    expect(r.text).toBe("PROGRAM p END_PROGRAM");
    expect(serverChatCompletionMock).toHaveBeenCalledTimes(1);
    // ⚠ Câu QUAN TRỌNG NHẤT của bản vá: lượt sinh mã KHÔNG còn phải nạp 19 GB trọng số nữa.
    expect(napModel, "đã nạp bản thứ hai — bản vá P1 vô nghĩa").not.toHaveBeenCalled();
  });

  it("★ `disableThinking` và `messages` được chuyển NGUYÊN VẸN xuống client (không bẹp thành chuỗi)", async () => {
    serverChatCompletionMock.mockResolvedValue({
      text: "ok", tokensGenerated: 1, tokensPrompt: 1, totalTimeMs: 1, tokensPerSecond: 1, modelId: "m",
    });
    const eng = await freshEngine();
    await eng.chatCompletion({
      messages: [
        { role: "system", content: "S" },
        { role: "user", content: "U" },
      ],
      disableThinking: true,
    });
    const [opts] = serverChatCompletionMock.mock.calls[0];
    expect(opts.messages).toEqual([
      { role: "system", content: "S" },
      { role: "user", content: "U" },
    ]);
    expect(opts.disableThinking).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §2 — BA CỔNG G1-D CÒN NGUYÊN TRÊN ĐƯỜNG MỚI
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("G5-D · P1 §2 — bất biến G1-D không bị bản vá làm mẻ", () => {
  it("★★★ cổng (a) NGÂN SÁCH: hội thoại vượt ctx/slot ⇒ TỪ CHỐI TRUNG THỰC, KHÔNG POST, KHÔNG nạp", async () => {
    process.env.LLAMA_SERVER_CTX_PER_SLOT = "1000";
    const eng = await freshEngine();
    await expect(
      eng.chatCompletion({
        messages: [{ role: "user", content: "X".repeat(2800) }], // ~1000 token @2,8 ký tự/token
        maxTokens: 100,
      }),
    ).rejects.toThrow(/TỪ CHỐI TRUNG THỰC|vượt trần/i);
    expect(serverChatCompletionMock).not.toHaveBeenCalled();
    expect(napModel, "lùi in-process khi vượt ctx = đốt 19 GB rồi mới hỏng").not.toHaveBeenCalled();
  });

  it("★★ cổng (a) đếm **MỌI** lượt, kể cả `assistant` — bỏ sót một vai ⇒ cổng cho lọt", async () => {
    process.env.LLAMA_SERVER_CTX_PER_SLOT = "1000";
    const eng = await freshEngine();
    // 4 lượt × 280 ký tự = 1.120 ký tự = 400 token. Chỉ vượt 1000 khi maxTokens=700 được CỘNG vào
    // và cả bốn lượt đều được đếm (400+700=1100). Bỏ sót lượt `assistant` ⇒ 300+700=1000 ⇒ LỌT.
    const ns = eng.nganSachTuHoiThoai({
      messages: [
        { role: "system", content: "S".repeat(280) },
        { role: "user", content: "U".repeat(280) },
        { role: "assistant", content: "A".repeat(280) },
        { role: "user", content: "V".repeat(280) },
      ],
      maxTokens: 700,
    });
    const srv = await import("./aiLlamaServerClient");
    expect(srv.uocLuongSoToken(ns.systemPrompt) + srv.uocLuongSoToken(ns.prompt)).toBeGreaterThanOrEqual(400);
    // ⚠ Cân bằng CHÍNH `kiemNganSachNguCanh()` — không viết lại phép cân ở đây.
    expect(srv.kiemNganSachNguCanh(ns).vua).toBe(false);
  });

  it("★★ cổng (c) CẤM LÙI: server còn SỐNG mà lượt chat hỏng ⇒ KHÔNG lùi in-process", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    serverChatCompletionMock.mockRejectedValue(new Error("HTTP 500: boom"));
    const eng = await freshEngine();
    await expect(eng.chatCompletion(HOI)).rejects.toThrow(/TỪ CHỐI TRUNG THỰC|bản thứ hai/i);
    expect(napModel).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("★★★ điểm nghẽn `loadGgufModel` VẪN chặn đường chat khi đường server KHÔNG được chọn", async () => {
    // Đây là ca giữ lại nguyên vẹn ý đồ cũ của `serverCtxOverflow.test.ts`: một đường vào KHÔNG đi
    // qua server vẫn phải bị điểm nghẽn bắt. `shouldUseServerForText=false` (vd người vận hành tắt
    // định tuyến) nhưng `laModelServerDangGiu=true` + server còn sống ⇒ CẤM nạp.
    shouldUseServerForTextMock.mockReturnValue(false);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const eng = await freshEngine();
    await expect(eng.chatCompletion(HOI)).rejects.toThrow(/TỪ CHỐI TRUNG THỰC|bản thứ hai/i);
    expect(serverChatCompletionMock).not.toHaveBeenCalled();
    expect(napModel).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("model KHÁC (fast/embed) ⇒ đường chat in-process chạy bình thường, không bị chặn oan", async () => {
    shouldUseServerForTextMock.mockReturnValue(false);
    laModelServerDangGiuMock.mockReturnValue(false);
    const eng = await freshEngine();
    const r = await eng.chatCompletion(HOI, "qwen3-4b-instruct");
    expect(r.text).toBe(IN_PROCESS);
    expect(napModel).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §3 — ★★★ G2-B: TOOL-CALLING GỐC. "ĐƯỜNG NÀY KHÔNG BIẾT GỌI TOOL" PHẢI NÓI THÀNH LỜI.
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠⚠ VÌ SAO KHỐI NÀY TỒN TẠI: nó được viết SAU khi hai đột biến SỐNG SÓT — bỏ hẳn `throw new
// LoiToolCallKhongHoTro(...)` khỏi `chatCompletion()` và `chatCompletionStream()` mà **không một
// ca nào đỏ**. Lưới gateway mock cả engine này, lưới `aiLlamaServerClient` không đi qua engine ⇒
// giữa hai lưới có đúng một khoảng trống, và khoảng trống ấy nằm ngay trên hàng rào trung tâm của
// G2-B.
//
// Hành vi bị bỏ đi khi đột biến sống: một caller nêu `tools`, đường server không phục vụ được
// (server tắt / giữ model khác / preflight trượt), lượt gọi **âm thầm rơi xuống in-process**, ở đó
// hội thoại bị bẹp thành `"User: …\nAssistant: …"`, `tools` bị vứt KHÔNG MỘT LỜI, và caller nhận
// một câu chữ thường + `toolCalls === undefined`. Không phân biệt được với "model không muốn gọi
// tool". Đó CHÍNH LÀ lớp lỗi G2-B tồn tại để xoá, chỉ đổi chỗ từ `_core/llm.ts` sang đây.
const TOOLS_G2B = [
  {
    type: "function" as const,
    function: { name: "get_machine_oee", description: "OEE", parameters: { type: "object", properties: {} } },
  },
];

describe("G2-B §3 — đường in-process TỪ CHỐI TRUNG THỰC khi caller nêu `tools`", () => {
  it("★★★ chatCompletion: server không phục vụ + có `tools` ⇒ NÉM, và KHÔNG nạp model in-process", async () => {
    shouldUseServerForTextMock.mockReturnValue(false); // server không giữ model này
    const eng = await freshEngine();
    await expect(eng.chatCompletion({ ...HOI, tools: TOOLS_G2B })).rejects.toThrow(/tool-calling/i);
    // ⚠ Câu thứ hai mới là câu đắt: nếu chỉ kiểm "có ném", một bản vá ném SAU khi đã nạp 19 GB
    // trọng số vẫn xanh. Từ chối phải xảy ra TRƯỚC khi tiêu tài nguyên.
    expect(napModel, "đã nạp trọng số rồi mới từ chối").not.toHaveBeenCalled();
  });

  it("★★★ chatCompletionStream: cùng điều kiện ⇒ NÉM (không phát chunk `error` giả)", async () => {
    shouldUseServerForTextMock.mockReturnValue(false);
    const eng = await freshEngine();
    await expect(
      (async () => {
        for await (const _c of eng.chatCompletionStream({ ...HOI, tools: TOOLS_G2B })) {
          /* không được tới đây */
        }
      })(),
    ).rejects.toThrow(/tool-calling/i);
    expect(napModel).not.toHaveBeenCalled();
  });

  it("lỗi mang `code` đọc được bằng máy, không phải chỉ một chuỗi", async () => {
    shouldUseServerForTextMock.mockReturnValue(false);
    const eng = await freshEngine();
    const err = await eng.chatCompletion({ ...HOI, tools: TOOLS_G2B }).catch((e) => e);
    expect(err).toBeInstanceOf(eng.LoiToolCallKhongHoTro);
    expect(err.code).toBe("tool_calls_unsupported_path");
  });

  it("⚠ KHÔNG có `tools` ⇒ vẫn lùi in-process ĐÚNG NHƯ TRƯỚC (cờ không đụng đường chat cũ)", async () => {
    shouldUseServerForTextMock.mockReturnValue(false);
    // Cổng G1-D chanNapTrungModelServer() phải NHẢ ra thì đường in-process mới chạy được — nếu
    // không, ca này đỏ vì một lý do KHÁC HẲN (cấm nạp trùng) và chẳng nói gì về G2-B.
    laModelServerDangGiuMock.mockReturnValue(false);
    const eng = await freshEngine();
    const r = await eng.chatCompletion(HOI);
    expect(r.text).toBe(IN_PROCESS);
    expect(napModel).toHaveBeenCalled();
  });

  it("`tools: []` KHÔNG kích hoạt từ chối (mảng rỗng nghĩa là không có tool nào)", async () => {
    shouldUseServerForTextMock.mockReturnValue(false);
    laModelServerDangGiuMock.mockReturnValue(false);
    const eng = await freshEngine();
    const r = await eng.chatCompletion({ ...HOI, tools: [] });
    expect(r.text).toBe(IN_PROCESS);
  });

  it("★ đường SERVER phục vụ được thì `tools` đi XUỐNG client, không bị chặn oan", async () => {
    shouldUseServerForTextMock.mockReturnValue(true);
    serverChatCompletionMock.mockResolvedValue({
      text: "", toolCalls: [{ id: "c", type: "function", function: { name: "get_machine_oee", arguments: "{}" } }],
      finishReason: "tool_calls", tokensGenerated: 5, tokensPrompt: 20, totalTimeMs: 1, tokensPerSecond: 1, modelId: "m",
    });
    const eng = await freshEngine();
    const r = await eng.chatCompletion({ ...HOI, tools: TOOLS_G2B });
    expect(serverChatCompletionMock.mock.calls[0][0].tools).toHaveLength(1);
    expect(r.toolCalls).toHaveLength(1);
    expect(napModel).not.toHaveBeenCalled();
  });
});
