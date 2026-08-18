/**
 * ★★★ G1-D — ĐƯỜNG TRÀN NGỮ CẢNH ⇒ NẠP **BẢN THỨ HAI** CỦA MODEL 30B.
 *
 * BỐI CẢNH ĐO SỐNG (2026-08-16, RTX 5090 32.607 MiB):
 *   • `llama-server` chạy thật ở `127.0.0.1:8091`, `/props` khai `total_slots=2`,
 *     `default_generation_settings.n_ctx = 32768` ⇒ **32.768 token MỖI SLOT**.
 *   • `nvidia-smi`: 26.518 MiB đã dùng / **5.673 MiB trống**. Trọng số 30B in-process ≈ 19.000 MiB.
 *   ⇒ Một lượt nạp thứ hai KHÔNG THỂ vừa. Kết cục tốt nhất là `cudaMalloc OOM`; kết cục tệ nhất là
 *     `vramLoadOutcome.reclaim()` gọi `preempt()` và **giết sidecar thị giác 7,8 GB đang phục vụ**
 *     cho một lượt nạp chắc chắn hỏng.
 *
 * CHUỖI HỎNG (mã TRƯỚC bản vá):
 *   prompt > 32.768 token → `serverGenerateText()` ném (`HTTP 400 … exceeds the available context
 *   size`) → `generateText()` bắt, `console.warn`, **đi tiếp** → `getOrLoadModel()` →
 *   `loadGgufModel()` → `llama.loadModel()` **cho CHÍNH model mà llama-server đang giữ**.
 *
 * BA LỚP PHÒNG THỦ ĐƯỢC CANH Ở ĐÂY:
 *   (a) CỔNG ĐẦU VÀO — ước lượng token TRƯỚC khi gửi; vượt trần/slot ⇒ TỪ CHỐI TRUNG THỰC,
 *       không gửi, không nạp.
 *   (b) CẤM NẠP TRÙNG — server CÒN SỐNG mà lượt sinh chữ hỏng ⇒ **KHÔNG** lùi in-process cho
 *       cùng model. Cưỡng chế ở HAI nơi: điểm rẽ nhánh (`generateText`/`generateJSON`) và
 *       **điểm nghẽn** `loadGgufModel()` — nơi mọi đường vào (kể cả `generateTextStream`,
 *       `chatCompletion`, `warmModel`, router HTTP) bắt buộc đi qua.
 *   (c) KHÔNG IM LẶNG — mọi lượt rơi vào nhánh này có `console.warn` + sự kiện VRAM.
 *
 * ⚠ ĐƯỜNG KHÔNG ĐƯỢC PHÁ: server **không trả lời** (preflight hỏng) ⇒ tiến trình đó không giữ
 * VRAM nữa ⇒ lùi in-process VẪN ĐÚNG và vẫn phải chạy (đây là lựa chọn CÓ CHỦ Ý của người vận
 * hành, ghi trong `.env`: `LLAMA_SERVER_STRICT` cố ý để TẮT).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock llama-server client (điều khiển được từng ca) ───────────────────────
const shouldUseServerForTextMock = vi.fn<(...a: any[]) => boolean>();
const laModelServerDangGiuMock = vi.fn<(...a: any[]) => boolean>();
const preflightHealthyMock = vi.fn<(...a: any[]) => Promise<boolean>>();
const serverGenerateTextMock = vi.fn<(...a: any[]) => Promise<any>>();
const serverGenerateJSONMock = vi.fn<(...a: any[]) => Promise<any>>();
// G1 — đường stream nay ĐI QUA server, nên nó phải giả được ở đây; nếu để bản thật (spread
// `...that`) thì ca test sẽ mở một kết nối HTTP thật tới `:8091` và kết quả phụ thuộc việc máy dev
// có đang chạy llama-server hay không — một cái thước KHÔNG TẤT ĐỊNH.
const serverGenerateTextStreamMock = vi.fn<(...a: any[]) => AsyncGenerator<any>>();
const serverChatCompletionStreamMock = vi.fn<(...a: any[]) => AsyncGenerator<any>>();
const llamaServerStrictMock = vi.fn<() => boolean>(() => false);
const llamaServerEnabledMock = vi.fn<() => boolean>(() => true);
const llamaServerHealthyMock = vi.fn<(...a: any[]) => Promise<boolean>>(async () => false);

vi.mock("./aiLlamaServerClient", async () => {
  // ⚠ Ba hàm THUẦN (`serverSlotContextTokens`/`uocLuongSoToken`/`kiemNganSachNguCanh`/
  // `laLoiTranNguCanh`) dùng BẢN THẬT: chúng chính là vị từ đang được kiểm, giả chúng đi là
  // dựng một cái thước thứ hai.
  const that = await vi.importActual<typeof import("./aiLlamaServerClient")>("./aiLlamaServerClient");
  return {
    ...that,
    shouldUseServerForText: (...a: any[]) => shouldUseServerForTextMock(...a),
    laModelServerDangGiu: (...a: any[]) => laModelServerDangGiuMock(...a),
    preflightHealthy: (...a: any[]) => preflightHealthyMock(...a),
    serverGenerateText: (...a: any[]) => serverGenerateTextMock(...a),
    serverGenerateJSON: (...a: any[]) => serverGenerateJSONMock(...a),
    serverGenerateTextStream: (...a: any[]) => serverGenerateTextStreamMock(...a),
    serverChatCompletionStream: (...a: any[]) => serverChatCompletionStreamMock(...a),
    // Hai hàm này khai báo 0 tham số ⇒ spread `any[]` vào chúng là TS2556. Ép kiểu tại chỗ gọi
    // (không đổi hành vi) thay vì bỏ spread, để giữ đúng một khuôn với các dòng còn lại.
    llamaServerStrict: (...a: any[]) => (llamaServerStrictMock as (...x: any[]) => any)(...a),
    llamaServerEnabled: (...a: any[]) => (llamaServerEnabledMock as (...x: any[]) => any)(...a),
    llamaServerHealthy: (...a: any[]) => llamaServerHealthyMock(...a),
  };
});

vi.mock("./aiModelRouter", () => ({
  getThinkingTierStatus: () => ({ enabled: false, modelConfigured: false, fileExists: false, active: false, reason: "off" }),
}));

// ─── node-llama-cpp giả: đường in-process CHẠY THẬT (chứng minh lỗ, không chỉ suy diễn) ──
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

/** Nguyên văn câu llama.cpp trả khi prompt vượt ctx của slot (build b9814, `/v1/chat/completions`). */
const LOI_TRAN_NGU_CANH =
  '[llamaServer] HTTP 400: {"error":{"code":400,"message":"the request exceeds the available context ' +
  'size, try increasing it","type":"exceed_context_size_error"}}';

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
});

async function freshEngine() {
  vi.resetModules();
  return await import("./aiGgufEngine");
}

describe("(b) server CÒN SỐNG + lượt sinh chữ hỏng ⇒ CẤM nạp bản thứ hai in-process", () => {
  /**
   * ⚠ VÌ SAO CÁC CA DƯỚI ĐÂY ĐÒI ĐÚNG CÂU CỦA **ĐIỂM RẼ NHÁNH**, không chỉ đòi "có ném".
   *
   * Bản vá có HAI lớp cùng bắt được ca này (điểm rẽ nhánh `thuDuongServer` và điểm nghẽn
   * `loadGgufModel`). Nếu lưới chỉ đòi `/TỪ CHỐI TRUNG THỰC/` thì gỡ HẲN lớp thứ nhất đi lưới
   * **VẪN XANH** — đo thật bằng đột biến M3: 12/12 xanh với lớp (b) đã bị gỡ. Một lưới như thế
   * không canh được lớp nào cả, nó chỉ canh "hợp lực của cả hai". Neo vào câu riêng của từng lớp
   * là cách duy nhất để mỗi lớp có cầu chì của chính nó.
   */
  const DAU_HIEU_DIEM_RE_NHANH = /còn SỐNG \(vừa qua thăm dò\) nhưng lượt sinh chữ hỏng/;

  it("★ generateText: lỗi TRÀN NGỮ CẢNH từ server KHÔNG được biến thành một lượt nạp 30B thứ hai", async () => {
    serverGenerateTextMock.mockRejectedValue(new Error(LOI_TRAN_NGU_CANH));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const eng = await freshEngine();
    const loi = await eng.generateText({ prompt: "câu hỏi dài" }).then(
      () => null,
      (e: Error) => e,
    );
    expect(loi?.message).toMatch(/TỪ CHỐI TRUNG THỰC/);
    expect(loi?.message).toMatch(DAU_HIEU_DIEM_RE_NHANH); // lớp (b) tại điểm rẽ nhánh đã chặn
    expect(loi?.message).toMatch(/VƯỢT NGỮ CẢNH/); // và nói ĐÚNG nguyên nhân cho người dùng

    // ĐÂY LÀ CÂU KHẲNG ĐỊNH TRUNG TÂM: không một byte trọng số nào được nạp thêm.
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("★ generateJSON: cùng bất biến trên đường JSON có ràng buộc lược đồ", async () => {
    serverGenerateJSONMock.mockRejectedValue(new Error(LOI_TRAN_NGU_CANH));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const eng = await freshEngine();
    const loi = await eng
      .generateJSON({ type: "object", properties: { ok: { type: "boolean" } } }, { prompt: "hỏi" })
      .then(
        () => null,
        (e: Error) => e,
      );
    expect(loi?.message).toMatch(/TỪ CHỐI TRUNG THỰC/);
    expect(loi?.message).toMatch(DAU_HIEU_DIEM_RE_NHANH);
    expect(loi?.message).toMatch(/JSON generation/);
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("lỗi server BẤT KỲ (không riêng tràn ngữ cảnh) cũng không được nạp bản thứ hai khi server còn sống", async () => {
    serverGenerateTextMock.mockRejectedValue(new Error("[llamaServer] empty completion"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const eng = await freshEngine();
    const loi = await eng.generateText({ prompt: "hi" }).then(
      () => null,
      (e: Error) => e,
    );
    expect(loi?.message).toMatch(/TỪ CHỐI TRUNG THỰC/);
    expect(loi?.message).toMatch(DAU_HIEU_DIEM_RE_NHANH);
    expect(loi?.message).not.toMatch(/VƯỢT NGỮ CẢNH/); // KHÔNG bịa nguyên nhân cho một lỗi khác
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("(c) KHÔNG IM LẶNG: lượt từ chối ghi một dòng console.error nêu đích danh 'bản thứ hai'", async () => {
    serverGenerateTextMock.mockRejectedValue(new Error(LOI_TRAN_NGU_CANH));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const eng = await freshEngine();
    await expect(eng.generateText({ prompt: "hi" })).rejects.toThrow();

    const noiDung = [...warnSpy.mock.calls, ...errSpy.mock.calls].map((c) => String(c[0] ?? "")).join("\n");
    expect(noiDung).toMatch(/bản thứ hai/i);
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });
});

describe("(a) CỔNG ĐẦU VÀO — vượt trần token MỖI SLOT thì không gửi, không nạp", () => {
  it("★ prompt ước lượng > 32.768 token: KHÔNG POST lên server, KHÔNG nạp in-process, câu từ chối nêu số", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const eng = await freshEngine();

    // 200.000 ký tự ⇒ ≥ 71.000 token theo bất kỳ thước nào (đo thật trên chunk tiếng Việt:
    // 2,85–4,08 ký tự/token).
    const prompt = "ngữ cảnh RAG rất dài. ".repeat(10_000);
    await expect(eng.generateText({ prompt })).rejects.toThrow(/TỪ CHỐI TRUNG THỰC/);

    expect(serverGenerateTextMock).not.toHaveBeenCalled(); // chặn TỪ ĐẦU VÀO, không thử rồi mới hỏng
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("prompt bình thường: cổng đầu vào KHÔNG chắn — đường server chạy y như cũ", async () => {
    serverGenerateTextMock.mockResolvedValue({
      text: "server answer", tokensGenerated: 5, tokensPrompt: 3,
      totalTimeMs: 42, tokensPerSecond: 100, modelId: SERVED,
    });
    const eng = await freshEngine();
    const r = await eng.generateText({ prompt: "câu hỏi ngắn" });
    expect(r.text).toBe("server answer");
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
  });
});

describe("ĐƯỜNG KHÔNG ĐƯỢC PHÁ — server KHÔNG trả lời ⇒ nó không giữ VRAM ⇒ vẫn lùi in-process", () => {
  it("preflight hỏng: vẫn nạp in-process và vẫn trả lời (lựa chọn có chủ ý của người vận hành)", async () => {
    preflightHealthyMock.mockResolvedValue(false);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const eng = await freshEngine();
    const r = await eng.generateText({ prompt: "hi" });

    expect(r.text).toBe(IN_PROCESS_ANSWER);
    expect(fakeLlama.loadModel).toHaveBeenCalled();
    expect(serverGenerateTextMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("model ĐÃ nằm sẵn trong tiến trình: lỗi server vẫn lùi in-process được — không tốn thêm byte nào", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const eng = await freshEngine();

    // Bước 1 — làm cho model nằm sẵn qua đường server-tắt.
    shouldUseServerForTextMock.mockReturnValue(false);
    laModelServerDangGiuMock.mockReturnValue(false);
    await eng.generateText({ prompt: "hi" });
    const soLuotNapBanDau = fakeLlama.loadModel.mock.calls.length;
    expect(soLuotNapBanDau).toBe(1);

    // Bước 2 — bật lại server; nó sống, lượt sinh chữ hỏng. Vì model ĐÃ nằm sẵn, lùi in-process
    // KHÔNG cần nạp thêm ⇒ được phép.
    shouldUseServerForTextMock.mockReturnValue(true);
    laModelServerDangGiuMock.mockReturnValue(true);
    serverGenerateTextMock.mockRejectedValue(new Error(LOI_TRAN_NGU_CANH));
    const r = await eng.generateText({ prompt: "hi" });

    expect(r.text).toBe(IN_PROCESS_ANSWER);
    expect(fakeLlama.loadModel.mock.calls.length).toBe(soLuotNapBanDau); // KHÔNG nạp thêm lần nào
    warnSpy.mockRestore();
  });
});

describe("ĐIỂM NGHẼN `loadGgufModel` — vị từ MỘT chỗ, phủ MỌI đường vào (kể cả đường không đi qua server)", () => {
  /**
   * ⚠ ĐÍNH CHÍNH 2026-08-16 (G1) — CÂU CŨ Ở ĐÂY ĐÃ HẾT ĐÚNG.
   *
   * Bản trước của ca này tên là *"generateTextStream (đường ops-chat THẬT — **chưa bao giờ hỏi
   * llama-server**) cũng bị chặn"*, và nó đo đúng thực tế lúc đó: đường stream đi thẳng
   * `getOrLoadModel()`, nên điểm nghẽn `loadGgufModel()` là lớp DUY NHẤT bắt được nó.
   *
   * G1 đã ĐỊNH TUYẾN đường stream qua llama-server (`thuDuongServerStream`). Vế "chưa bao giờ hỏi"
   * nay SAI, và nếu để nguyên thì ca này biến thành một lưới đo một hình dạng KHÔNG CÒN TỒN TẠI —
   * đúng lớp lỗi đã trả giá ở Pha 7 (lưới đo một hình dạng dữ liệu không tồn tại ⇒ bản vá deploy
   * xong thành nhà tù thật). Ca được viết lại để đo BẤT BIẾN, không đo đường đi:
   * **lượt stream cho model 30B mà server đang giữ KHÔNG BAO GIỜ nạp bản thứ hai** — dù nó được
   * phục vụ (nhánh 1) hay bị từ chối (nhánh 2).
   * ⚠⚠ ĐÍNH CHÍNH THỨ HAI 2026-08-17 (G5-D · P1) — dòng cuối của khối trên NAY CŨNG ĐÃ HẾT ĐÚNG,
   * theo ĐÚNG cách mà dòng đầu đã hết đúng một ngày trước. Nguyên văn nó là: *"Điểm nghẽn
   * `loadGgufModel()` VẪN được canh ở ca `chatCompletion` ngay dưới: hàm đó vẫn đi thẳng
   * `getOrLoadModel()`."* — P1 vừa định tuyến `chatCompletion()` qua `thuDuongServer()`, nên vế
   * "vẫn đi thẳng" SAI.
   *
   * ★ ĐÂY LÀ CHỖ DỄ TRẢ NỢ-ĐẺ-NỢ NHẤT: ca cũ khai `.rejects.toThrow(/TỪ CHỐI TRUNG THỰC/)` —
   * tức nó đo **CƠ CHẾ** (ném ở điểm nghẽn), không đo **BẤT BIẾN** (không nạp bản thứ hai). Sau
   * P1, bất biến vẫn đúng (server phục vụ ⇒ chẳng nạp gì cả) nhưng cơ chế đổi ⇒ ca đỏ. Nới ca
   * bằng cách xoá vế `toThrow` là **dời cái được canh ra khỏi tầm phát biểu của lưới** (lớp lỗi
   * C-2 của Pha 7). Cách xử lý ĐÚNG, và là cách khối trên đã dùng cho `generateTextStream`:
   *   • ca dưới đây được viết lại để phát biểu BẤT BIẾN (`loadModel` không được gọi), đúng với cả
   *     hai kết cục;
   *   • vế "một đường vào KHÔNG qua điểm rẽ nhánh vẫn bị điểm nghẽn bắt" KHÔNG bị bỏ — nó được
   *     canh nguyên vẹn ở `aiGgufEngine.chatServer.test.ts` §2 (ca `shouldUseServerForText=false`),
   *     nơi đường chat buộc phải xuống in-process và điểm nghẽn là lớp DUY NHẤT chặn nó.
   */
  it("★★ generateTextStream (đường ops-chat THẬT): server phục vụ ⇒ KHÔNG nạp bản thứ hai", async () => {
    const eng = await freshEngine();
    serverGenerateTextStreamMock.mockImplementation(async function* () {
      yield { type: "token", token: "câu trả lời từ server" };
      yield { type: "done", fullText: "câu trả lời từ server", tokensPrompt: 3, tokensGenerated: 4 };
    });

    const ra: string[] = [];
    for await (const chunk of eng.generateTextStream({ prompt: "hi" })) {
      if (chunk.type === "token") ra.push(String(chunk.token));
    }
    expect(ra.join("")).toBe("câu trả lời từ server");
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
  });

  it("★★ generateTextStream: server còn SỐNG mà lượt stream hỏng ⇒ TỪ CHỐI, vẫn KHÔNG nạp bản thứ hai", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const eng = await freshEngine();
    serverGenerateTextStreamMock.mockImplementation(async function* () {
      throw new Error(LOI_TRAN_NGU_CANH);
      // eslint-disable-next-line no-unreachable
      yield { type: "token", token: "" };
    });

    const loi: string[] = [];
    try {
      for await (const chunk of eng.generateTextStream({ prompt: "hi" })) {
        if (chunk.type === "error") loi.push(String(chunk.error));
      }
    } catch (e) {
      loi.push(String((e as Error)?.message ?? e));
    }
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
    expect(loi.join("\n")).toMatch(/bản thứ hai|TỪ CHỐI TRUNG THỰC/i);
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("★★ chatCompletion (đường /v1 gateway): BẤT BIẾN — không bao giờ nạp bản thứ hai", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const eng = await freshEngine();
    // Không khai TRƯỚC là lượt này sẽ được phục vụ hay bị từ chối — đó chính là CƠ CHẾ, thứ P1 vừa
    // đổi. Chỉ phát biểu điều KHÔNG được phép xảy ra ở cả hai kết cục.
    await eng
      .chatCompletion({ messages: [{ role: "user", content: "hi" }] })
      .catch(() => undefined);
    expect(
      fakeLlama.loadModel,
      "lượt chat cho model mà llama-server đang giữ đã nạp BẢN THỨ HAI (~19.000 MiB)",
    ).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("model KHÁC (FIM/fast/embed) KHÔNG bị chặn — điểm nghẽn chỉ canh đúng model server đang giữ", async () => {
    laModelServerDangGiuMock.mockImplementation((id?: string) => String(id ?? "").includes("30b"));
    shouldUseServerForTextMock.mockReturnValue(false);
    const eng = await freshEngine();
    const r = await eng.generateText({ prompt: "hi" }, "qwen3-4b-instruct");
    expect(r.text).toBe(IN_PROCESS_ANSWER);
    expect(fakeLlama.loadModel).toHaveBeenCalled();
  });

  it("server KHÔNG trả lời ⇒ điểm nghẽn MỞ (tiến trình đó không còn giữ VRAM)", async () => {
    preflightHealthyMock.mockResolvedValue(false);
    shouldUseServerForTextMock.mockReturnValue(false); // ép đi thẳng đường in-process
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const eng = await freshEngine();
    const r = await eng.generateText({ prompt: "hi" });
    expect(r.text).toBe(IN_PROCESS_ANSWER);
    expect(fakeLlama.loadModel).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
