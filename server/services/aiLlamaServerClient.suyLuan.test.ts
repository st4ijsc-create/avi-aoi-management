/**
 * ★★★ G5-D — **Ô DỮ LIỆU THỨ HAI**: `message.reasoning_content`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỚP LỖI ĐANG CANH — *"hỏng mà KHÔNG có gì đỏ"*
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `llama-server` chạy với `--jinja` (mặc định BẬT ở build b9814) và `--reasoning-format auto` sẽ
 * **tách** khối suy luận của model lai ra khỏi `message.content` và đặt nó vào
 * `message.reasoning_content`. Bản trước G5-D đọc DUY NHẤT `content`. Hệ quả đo được (A/B
 * 2026-08-16, `max_tokens=500`): **4/5 prompt trả về `content` RỖNG** với model suy luận lai —
 * và **không một dòng log lỗi nào**, vì `""` không phải lỗi, nó chỉ là "câu trả lời rỗng".
 *
 * HAI CA KHÁC HẲN NHAU, TRƯỚC ĐÂY BỊ GỘP LÀM MỘT:
 *   (A) `content` rỗng **và** `reasoning_content` rỗng ⇒ *"model không trả lời"* — hỏng ở model
 *       hoặc ở đường truyền.
 *   (B) `content` rỗng **mà** `reasoning_content` CÓ CHỮ ⇒ *"model tiêu hết hạn mức token vào
 *       suy luận trước khi kịp thoát `<think>`"* — model KHÔNG hỏng, **hạn mức token sai**. Cách
 *       sửa hoàn toàn khác: nâng `maxTokens` hoặc tắt suy luận cho lượt đó.
 * Gộp (B) vào (A) là chẩn đoán sai nguyên nhân, và đó chính là cái đã xảy ra.
 *
 * ⚠ VỊ TỪ DÙNG CHUNG: cả bốn đường (text · JSON · chat không-stream · stream) gọi ĐÚNG MỘT hàm
 * `phanDinhCauTraLoiRong()`. Repo này đã dính lớp lỗi "N+1" **17 lần**; bốn bản sao của cùng một
 * phép phân định là bốn cơ hội để chúng trôi khỏi nhau. §5 dưới đây cưỡng chế điều đó bằng cách
 * quét MÃ NGUỒN.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GgufStreamChunk } from "./aiGgufEngine";

async function freshClient() {
  vi.resetModules();
  return await import("./aiLlamaServerClient");
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.LLAMA_SERVER_STRICT;
  delete process.env.LLAMA_SERVER_API_KEY;
  process.env.LLAMA_SERVER_ENABLED = "true";
  process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8091";
  process.env.GGUF_DEFAULT_MODEL = "qwen3-30b-a3b-instruct.gguf";
  process.env.LLAMA_SERVER_MODEL = "qwen3-30b-a3b-instruct.gguf";
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

/** Một phản hồi `/v1/chat/completions` không-streaming với `message` cho trước. */
function resChat(message: Record<string, unknown>, usage?: Record<string, unknown>): Response {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        choices: [{ index: 0, finish_reason: "length", message }],
        usage: usage ?? { prompt_tokens: 4432, completion_tokens: 120 },
      };
    },
    async text() {
      return "";
    },
  } as unknown as Response;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §1 — ĐỌC HAI Ô, KHÔNG TRỘN
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("G5-D §1 — docHaiNua(): `content` và `reasoning_content` là HAI phần TÁCH BẠCH", () => {
  it("★ trả về đúng hai nửa; không nửa nào lẫn vào nửa kia", async () => {
    const c = await freshClient();
    const nua = c.docHaiNua({ role: "assistant", content: "ĐÁP ÁN", reasoning_content: "NỘI TÂM" });
    expect(nua.noiDung).toBe("ĐÁP ÁN");
    expect(nua.suyLuan).toBe("NỘI TÂM");
    // Trộn là lớp lỗi rò suy luận ra giao diện (xem ai/thinkingStrip.ts) — canh cả hai chiều.
    expect(nua.noiDung).not.toContain("NỘI TÂM");
    expect(nua.suyLuan).not.toContain("ĐÁP ÁN");
  });

  it("thiếu trường / `null` / kiểu lạ ⇒ chuỗi rỗng, KHÔNG ném và KHÔNG ra chuỗi \"null\"", async () => {
    const c = await freshClient();
    expect(c.docHaiNua({ content: null, reasoning_content: null })).toEqual({ noiDung: "", suyLuan: "" });
    expect(c.docHaiNua({})).toEqual({ noiDung: "", suyLuan: "" });
    expect(c.docHaiNua(undefined)).toEqual({ noiDung: "", suyLuan: "" });
    expect(c.docHaiNua({ content: 123, reasoning_content: { a: 1 } })).toEqual({ noiDung: "", suyLuan: "" });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §2 — PHÂN ĐỊNH BA CA, VÀ CA (B) PHẢI **KÊU TO**
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("G5-D §2 — phanDinhCauTraLoiRong(): ba ca, ba kết cục KHÁC NHAU", () => {
  it("có chữ ⇒ không ném (dù có suy luận kèm theo hay không)", async () => {
    const c = await freshClient();
    expect(() => c.phanDinhCauTraLoiRong({ noiDung: "x", suyLuan: "" }, {})).not.toThrow();
    expect(() => c.phanDinhCauTraLoiRong({ noiDung: "x", suyLuan: "dài" }, {})).not.toThrow();
  });

  it("★★★ ca (B) — rỗng chữ + CÓ suy luận ⇒ ném `LoiTokenCanKietVaoSuyLuan`, KHÔNG phải \"empty completion\"", async () => {
    const c = await freshClient();
    let bat: unknown;
    try {
      c.phanDinhCauTraLoiRong(
        { noiDung: "", suyLuan: "để xem nào, câu hỏi này hỏi về lô LSX…" },
        { maxTokens: 120, finishReason: "length", ten: "phân loại ý định" },
      );
    } catch (e) {
      bat = e;
    }
    expect(bat, "ca (B) PHẢI ném — im lặng trả rỗng là chính lỗ đang vá").toBeInstanceOf(
      c.LoiTokenCanKietVaoSuyLuan,
    );
    const err = bat as InstanceType<typeof c.LoiTokenCanKietVaoSuyLuan>;
    // Câu lỗi phải nói được NGUYÊN NHÂN + CÁCH SỬA, không chỉ "rỗng".
    expect(err.message).toMatch(/suy luận/i);
    expect(err.message).toMatch(/120/); // hạn mức đã dùng — con số người vận hành cần
    expect(err.message).toMatch(/maxTokens|enable_thinking/); // ít nhất một cách sửa nêu tên
    expect(err.soKyTuSuyLuan).toBeGreaterThan(0);
    expect(err.maxTokens).toBe(120);
    // ⚠ KHÔNG được là câu "empty completion" cũ — nếu trùng câu thì người đọc log vẫn chẩn sai.
    expect(err.message).not.toMatch(/empty completion/);
  });

  it("ca (A) — rỗng cả hai ⇒ ném lỗi \"empty completion\" cũ, KHÔNG phải lỗi cạn token", async () => {
    const c = await freshClient();
    let bat: unknown;
    try {
      c.phanDinhCauTraLoiRong({ noiDung: "", suyLuan: "" }, { ten: "generation" });
    } catch (e) {
      bat = e;
    }
    expect(bat).toBeInstanceOf(Error);
    expect(bat).not.toBeInstanceOf(c.LoiTokenCanKietVaoSuyLuan);
    expect((bat as Error).message).toMatch(/empty completion/);
  });

  it("chuỗi suy luận chỉ toàn khoảng trắng KHÔNG được tính là \"có suy luận\"", async () => {
    const c = await freshClient();
    // Nếu tính, ta sẽ báo "cạn token vào suy luận" cho một ca thực chất là (A) ⇒ chẩn sai chiều kia.
    expect(() => c.phanDinhCauTraLoiRong({ noiDung: "", suyLuan: "   \n\t " }, {})).toThrow(/empty completion/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §3 — BỐN ĐƯỜNG SỐNG ĐỀU PHẢI ĐI QUA PHÉP PHÂN ĐỊNH ẤY
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("G5-D §3 — bốn đường sinh chữ đọc `reasoning_content`", () => {
  it("★ serverGenerateText: content rỗng + reasoning có chữ ⇒ lỗi CẠN TOKEN (không im lặng)", async () => {
    const c = await freshClient();
    vi.stubGlobal("fetch", vi.fn(async () => resChat({ content: "", reasoning_content: "nghĩ mãi…" })));
    await expect(c.serverGenerateText({ prompt: "hỏi", maxTokens: 120 })).rejects.toBeInstanceOf(
      c.LoiTokenCanKietVaoSuyLuan,
    );
  });

  it("★ serverGenerateText: có chữ ⇒ `text` KHÔNG chứa suy luận, suy luận nằm ở trường `reasoning`", async () => {
    const c = await freshClient();
    vi.stubGlobal("fetch", vi.fn(async () => resChat({ content: "ĐÁP", reasoning_content: "NỘI TÂM" })));
    const kq = await c.serverGenerateText({ prompt: "hỏi" });
    expect(kq.text).toBe("ĐÁP");
    expect(kq.text).not.toContain("NỘI TÂM");
    expect(kq.reasoning).toBe("NỘI TÂM");
  });

  it("★ serverGenerateJSON: content rỗng + reasoning có chữ ⇒ lỗi CẠN TOKEN, không phải \"invalid JSON\"", async () => {
    const c = await freshClient();
    vi.stubGlobal("fetch", vi.fn(async () => resChat({ content: "", reasoning_content: "chọn tool nào đây…" })));
    // Chẩn "invalid JSON" cho một ca cạn token là đúng lớp lỗi "chẩn sai nguyên nhân".
    await expect(
      c.serverGenerateJSON({ type: "object" }, { prompt: "phân loại", maxTokens: 120 }),
    ).rejects.toBeInstanceOf(c.LoiTokenCanKietVaoSuyLuan);
  });

  it("★ serverChatCompletion (P1, đường MỚI): cùng phép phân định", async () => {
    const c = await freshClient();
    vi.stubGlobal("fetch", vi.fn(async () => resChat({ content: "", reasoning_content: "viết ST thế nào…" })));
    await expect(
      c.serverChatCompletion({ messages: [{ role: "user", content: "sinh mã" }], maxTokens: 1536 }),
    ).rejects.toBeInstanceOf(c.LoiTokenCanKietVaoSuyLuan);
  });

  it("★★ streaming: `delta.reasoning_content` KHÔNG được phát ra như chữ cho người dùng", async () => {
    const c = await freshClient();
    const sk = (d: Record<string, unknown>) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: d }] })}\n\n`;
    const day =
      sk({ role: "assistant", content: null }) +
      sk({ reasoning_content: "NỘI TÂM-1" }) +
      sk({ reasoning_content: "NỘI TÂM-2" }) +
      sk({ content: "ĐÁP" }) +
      "data: [DONE]\n\n";
    vi.stubGlobal("fetch", vi.fn(async () => resStream(day)));
    const manh: GgufStreamChunk[] = [];
    for await (const m of c.serverGenerateTextStream({ prompt: "x" })) manh.push(m);
    const chu = manh.filter((m) => m.type === "token").map((m) => m.token).join("");
    expect(chu, "suy luận rò ra giao diện qua đường stream").toBe("ĐÁP");
    const xong = manh.find((m) => m.type === "done")!;
    expect(xong.fullText).toBe("ĐÁP");
    expect(xong.reasoningText).toBe("NỘI TÂM-1NỘI TÂM-2");
  });

  it("★★★ streaming: CHỈ có suy luận, không có chữ ⇒ NÉM (trước G5-D: `done` với fullText rỗng, im lặng)", async () => {
    const c = await freshClient();
    const sk = (d: Record<string, unknown>) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: d }] })}\n\n`;
    const day = sk({ reasoning_content: "nghĩ tới hết token…" }) + "data: [DONE]\n\n";
    vi.stubGlobal("fetch", vi.fn(async () => resStream(day)));
    const chay = async () => {
      for await (const _ of c.serverGenerateTextStream({ prompt: "x", maxTokens: 120 })) {
        /* tiêu thụ */
      }
    };
    await expect(chay()).rejects.toThrow(/suy luận/i);
    // ⚠ `daPhatChu` PHẢI là false: chưa mảnh chữ nào tới người dùng ⇒ lùi in-process vẫn an toàn,
    // và đó là bit mà `quyetDinhSauLoiServer()` đọc để chọn giữa "lùi" và "từ chối trung thực".
    await expect(chay()).rejects.toSatisfy((e: any) => e.daPhatChu === false);
  });
});

/** Thân SSE phát trọn `day` trong MỘT mảnh. */
function resStream(day: string): Response {
  const byte = new TextEncoder().encode(day);
  let xong = false;
  const reader = {
    async read(): Promise<{ done: boolean; value?: Uint8Array }> {
      if (xong) return { done: true };
      xong = true;
      return { done: false, value: byte };
    },
    async cancel() {
      xong = true;
    },
  };
  return { ok: true, status: 200, body: { getReader: () => reader } } as unknown as Response;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §4 — `enable_thinking=false`: CÁCH TRUYỀN ĐÃ XÁC MINH TRÊN SERVER THẬT
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// BẰNG CHỨNG (build `b9814-487a6cc16`, `:8091`, đo 2026-08-17 — KHÔNG lấy từ tài liệu):
//   `POST /apply-template {"messages":[…],"chat_template_kwargs":{"messages":123}}`
//     → HTTP 400 `"While executing MemberExpression at line 13 … Cannot access property with
//        non-string: got Integer"`
//   `POST /apply-template {"messages":[…],"chat_template_kwargs":{"tools":123}}`
//     → HTTP 400 `"While executing For at line 7 … Expected iterable or object type in for loop"`
//   cùng thân KHÔNG có `chat_template_kwargs` → HTTP 200, prompt bình thường.
// Hai lỗi ấy bật ra ở ĐÚNG dòng của chat template đọc `messages`/`tools` ⇒ giá trị trong
// `chat_template_kwargs` **thật sự được nạp vào ngữ cảnh Jinja**, không phải bị nuốt im lặng.
// ⚠ Cùng lượt đo cũng cho thấy trường TOP-LEVEL `enable_thinking` KHÔNG có tác dụng gì — đó là
// lý do §4 canh vị trí LỒNG, không canh sự tồn tại của chuỗi "enable_thinking" ở đâu đó.

describe("G5-D §4 — tắt suy luận qua `chat_template_kwargs` (vị trí LỒNG, đã xác minh sống)", () => {
  /** `noiDung` mặc định là JSON hợp lệ để cùng một tiện ích dùng được cho CẢ đường JSON. */
  async function batThan(goi: (c: any) => Promise<unknown>, noiDung = '{"tool":"none"}'): Promise<any> {
    const c = await freshClient();
    let than: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: any) => {
        than = JSON.parse(init.body);
        return resChat({ content: noiDung });
      }),
    );
    await goi(c);
    return than;
  }

  it("★★ `disableThinking: true` ⇒ `chat_template_kwargs.enable_thinking === false` (LỒNG, không top-level)", async () => {
    const than = await batThan((c) => c.serverGenerateText({ prompt: "x", disableThinking: true }));
    expect(than.chat_template_kwargs).toEqual({ enable_thinking: false });
    // Top-level đã ĐO là bị bỏ qua ⇒ gửi ở đó là dựng thêm một cờ vô hiệu.
    expect(than.enable_thinking).toBeUndefined();
  });

  it("không khai ⇒ KHÔNG gửi trường nào (không đổi hành vi của mọi bên gọi cũ)", async () => {
    const than = await batThan((c) => c.serverGenerateText({ prompt: "x" }));
    expect(than.chat_template_kwargs).toBeUndefined();
  });

  it("★ áp dụng cho CẢ BỐN đường, không chỉ đường text", async () => {
    const t1 = await batThan((c) => c.serverGenerateJSON({ type: "object" }, { prompt: "x", disableThinking: true }));
    expect(t1.chat_template_kwargs).toEqual({ enable_thinking: false });

    const t2 = await batThan((c) =>
      c.serverChatCompletion({ messages: [{ role: "user", content: "x" }], disableThinking: true }),
    );
    expect(t2.chat_template_kwargs).toEqual({ enable_thinking: false });

    const c = await freshClient();
    let than: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: any) => {
        than = JSON.parse(init.body);
        return resStream(`data: ${JSON.stringify({ choices: [{ delta: { content: "a" } }] })}\n\ndata: [DONE]\n\n`);
      }),
    );
    for await (const _ of c.serverGenerateTextStream({ prompt: "x", disableThinking: true })) {
      /* tiêu thụ */
    }
    expect(than.chat_template_kwargs).toEqual({ enable_thinking: false });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §5 — LƯỚI CHỐNG "N+1": MỘT phép phân định, KHÔNG BỐN BẢN SAO
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("G5-D §5 — vị từ trên MÃ NGUỒN: không có bản sao thứ hai để trôi", () => {
  const NGUON = readFileSync(resolve(process.cwd(), "server/services/aiLlamaServerClient.ts"), "utf8");
  /**
   * Bóc CHÚ THÍCH thôi — **KHÔNG bóc chuỗi**.
   * ⚠ Lượt đầu tiên viết lưới này đã bóc cả chuỗi (chép khuôn từ `diemNghenNap.test.ts`) và §5.2
   * lập tức đếm được **0** lần `"empty completion"` thay vì 1: phép bóc đã xoá mất chính cái nó
   * được dựng ra để đếm — một thước đo MÙ đúng thứ nó phải đo. Ở đây thứ cần đếm NẰM TRONG chuỗi,
   * nên chuỗi phải được giữ; đổi lại phải bóc chú thích cho sạch, vì repo này viết docstring rất
   * dài và có nhắc lại nguyên văn câu lỗi.
   */
  const BOC = NGUON.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  it("★★ mọi nơi ĐỌC `reasoning_content` đều nằm trong đúng HAI hàm đọc (`docHaiNua` / delta)", () => {
    // Đếm ĐIỂM ĐỌC (`…?.reasoning_content`), không đếm mọi lần chuỗi xuất hiện — câu lỗi có nhắc
    // tên ô cho người vận hành, và lưới không được đỏ vì một câu tiếng Việt.
    const n = (BOC.match(/\.reasoning_content/g) || []).length;
    expect(
      n,
      "Có chỗ thứ ba đọc thẳng `reasoning_content`. Mỗi chỗ như thế là một bản sao của phép đọc, " +
        "và bản sao là cách lớp lỗi N+1 quay lại: một bản vá sửa một chỗ, chỗ kia trôi đi mà lưới " +
        "vẫn xanh. Đưa nó qua `docHaiNua()` / `suyLuanTrongChunk()`.",
    ).toBe(2);
  });

  it("★★★ mọi lời ném \"empty completion\" đi qua `phanDinhCauTraLoiRong()`, không viết tay", () => {
    // Trước G5-D có 3 chỗ tự viết `if (!text) throw new Error("… empty …")`. Mỗi chỗ như thế là
    // một chỗ CHẨN SAI ca (B) thành ca (A).
    const viTri = (BOC.match(/empty completion/g) || []).length;
    expect(
      viTri,
      "Câu 'empty completion' chỉ được phép xuất hiện MỘT lần — bên trong phanDinhCauTraLoiRong().",
    ).toBe(1);
    const soGoi = (BOC.match(/phanDinhCauTraLoiRong\(/g) || []).length;
    expect(soGoi, "định nghĩa + ít nhất 4 điểm gọi (text · JSON · chat · stream)").toBeGreaterThanOrEqual(5);
  });

  it("★ `chat_template_kwargs` được lắp ở ĐÚNG MỘT hàm dùng chung", () => {
    // ⚠ Đếm ĐIỂM GHI (`… .chat_template_kwargs = …`), không đếm mọi lần chuỗi xuất hiện: câu lỗi
    // của `LoiTokenCanKietVaoSuyLuan` cũng nhắc tên trường (cố ý — người vận hành cần biết gọi cờ
    // gì), và một lưới đếm sự-xuất-hiện sẽ đỏ vì một câu tiếng Việt. Cái cần cấm là điểm GHI thứ hai.
    expect(
      (BOC.match(/chat_template_kwargs\s*=/g) || []).length,
      "Lắp tay ở từng đường ⇒ đường thứ năm ra đời sẽ quên, và cờ tắt suy luận im lặng vô hiệu.",
    ).toBe(1);
  });
});

// ⚠ §6 (ngân sách ngữ cảnh của một HỘI THOẠI) nằm ở `aiGgufEngine.chatServer.test.ts`, cùng chỗ
// với hàm nó canh (`nganSachTuHoiThoai` sống trong engine — xem ghi chú ở cuối module client về
// lý do nó KHÔNG sống ở đây).

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §7 — ★ B2 (2026-09-22): `lapCoSampling()` — top_k / min_p / presence_penalty TƯỜNG MINH
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// Đo `/props` :8091 (b9814, Qwen3.6-35B-A3B) 2026-09-22: mặc định server `top_k 20 · top_p 0,95 ·
// min_p 0,05 · presence 0 · repeat 1`. Chính hãng khuyến nghị `min_p 0` — tức HỒ SƠ CHÍNH HÃNG chỉ
// tới được server khi client GỬI số 0 tường minh; "không gửi" = 0,05, không phải 0. Lưới §7 canh
// đúng chỗ đó: đặt ⇒ đi (kể cả 0); không đặt ⇒ không đi (hành vi cũ của mọi bên gọi y nguyên).

describe("B2 §7 — lapCoSampling(): ba trường sampling đi đúng tên, KHÔNG đi khi không đặt", () => {
  async function batThan(goi: (c: any) => Promise<unknown>, noiDung = '{"tool":"none"}'): Promise<any> {
    const c = await freshClient();
    let than: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: any) => {
        than = JSON.parse(init.body);
        return resChat({ content: noiDung });
      }),
    );
    await goi(c);
    return than;
  }

  it("★★ đặt topK/minP/presencePenalty ⇒ body.top_k/min_p/presence_penalty đúng giá trị — KỂ CẢ 0", async () => {
    const than = await batThan((c) => c.serverGenerateText({ prompt: "x", topK: 20, minP: 0, presencePenalty: 1.5 }));
    expect(than.top_k).toBe(20);
    expect(than.min_p, "0 phải ĐI — vắng là 0,05 của server, không phải 0").toBe(0);
    expect(than.presence_penalty).toBe(1.5);
  });

  it("không đặt ⇒ KHÔNG gửi trường nào (server giữ mặc định của nó — hành vi cũ)", async () => {
    const than = await batThan((c) => c.serverGenerateText({ prompt: "x" }));
    expect(than.top_k).toBeUndefined();
    expect(than.min_p).toBeUndefined();
    expect(than.presence_penalty).toBeUndefined();
  });

  it("giá trị không hữu hạn (NaN) bị BỎ, không gửi rác xuống server", async () => {
    const than = await batThan((c) => c.serverGenerateText({ prompt: "x", minP: Number.NaN, topK: Number.POSITIVE_INFINITY }));
    expect(than.min_p).toBeUndefined();
    expect(than.top_k).toBeUndefined();
  });

  it("★ áp dụng cho CẢ BỐN đường chat (text · JSON · chat · stream)", async () => {
    const t1 = await batThan((c) => c.serverGenerateJSON({ type: "object" }, { prompt: "x", minP: 0, presencePenalty: 0 }));
    expect(t1.min_p).toBe(0);
    expect(t1.presence_penalty).toBe(0);

    const t2 = await batThan((c) =>
      c.serverChatCompletion({ messages: [{ role: "user", content: "x" }], minP: 0, topK: 20 }),
    );
    expect(t2.min_p).toBe(0);
    expect(t2.top_k).toBe(20);

    const c = await freshClient();
    let than: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: any) => {
        than = JSON.parse(init.body);
        return resStream(`data: ${JSON.stringify({ choices: [{ delta: { content: "a" } }] })}\n\ndata: [DONE]\n\n`);
      }),
    );
    for await (const _ of c.serverGenerateTextStream({ prompt: "x", minP: 0, presencePenalty: 1.5, topK: 20 })) {
      /* tiêu thụ */
    }
    expect(than.min_p).toBe(0);
    expect(than.presence_penalty).toBe(1.5);
    expect(than.top_k).toBe(20);
  });

  it("★★ vị từ trên MÃ NGUỒN: `min_p`/`presence_penalty` ghi ở ĐÚNG MỘT điểm; `top_k` ở HAI (chat dùng chung + /infill)", () => {
    const nguon = readFileSync(resolve(process.cwd(), "server/services/aiLlamaServerClient.ts"), "utf8");
    const boc = nguon.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    expect((boc.match(/body\.min_p\s*=/g) || []).length, "điểm ghi min_p thứ hai = bản sao để trôi (N+1)").toBe(1);
    expect((boc.match(/body\.presence_penalty\s*=/g) || []).length).toBe(1);
    // `/infill` không có chat template ⇒ không đi qua builder chat; nó tự ghi top_k — và CHỈ top_k.
    expect((boc.match(/body\.top_k\s*=/g) || []).length).toBe(2);
    // định nghĩa + 5 điểm gọi (text · JSON · chat · stream ×2). Thiếu một ⇒ một đường mất hồ sơ trong im lặng.
    expect((boc.match(/lapCoSampling\(/g) || []).length).toBeGreaterThanOrEqual(6);
    // Mỗi điểm lắp cờ tắt nghĩ phải đi kèm điểm lắp sampling — hai cờ cùng một lớp "đường thứ N quên".
    // Đếm ĐIỂM GỌI (`…(body,`), không đếm định nghĩa (`…(body:`): lượt đầu viết lưới này đếm lẫn định nghĩa
    // của `lapCoTatSuyLuan` (một dòng) mà không đếm của `lapCoSampling` (xuống dòng) ⇒ 6 ≠ 5, đỏ oan.
    const diemGoiSampling = (boc.match(/lapCoSampling\(body,/g) || []).length;
    const diemGoiTatNghi = (boc.match(/lapCoTatSuyLuan\(body,/g) || []).length;
    expect(diemGoiSampling).toBe(diemGoiTatNghi);
    expect(diemGoiSampling).toBe(5);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §8 — ★ B7 (2026-09-22): `tokensReasoning` = số sự kiện SSE mang `delta.reasoning_content`
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// `usage.completion_tokens` / `timings.predicted_n` của llama-server GỘP cả token trong `<think>`;
// server không trả riêng số token suy luận. Đường stream lại nhận MỘT sự kiện mỗi token ⇒ đếm sự kiện
// mang `reasoning_content` là phép đo rẻ nhất và không bịa. Lưới canh: đếm đúng · không đụng
// `tokensGenerated` · và 0 là SỐ ĐO (đã xem trọn luồng), không phải "không biết".

describe("B7 §8 — tokensReasoning trên chunk `done` của đường stream", () => {
  const sk = (d: Record<string, unknown>) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: d }] })}\n\n`;

  it("★★ 3 sự kiện suy luận + 2 sự kiện chữ ⇒ tokensReasoning 3; chữ tới người dùng KHÔNG lẫn suy luận", async () => {
    const c = await freshClient();
    const day =
      sk({ role: "assistant", content: null }) +
      sk({ reasoning_content: "nghĩ-1" }) +
      sk({ reasoning_content: "nghĩ-2" }) +
      sk({ reasoning_content: "nghĩ-3" }) +
      sk({ content: "ĐÁP" }) +
      sk({ content: "-ÁN" }) +
      "data: [DONE]\n\n";
    vi.stubGlobal("fetch", vi.fn(async () => resStream(day)));
    const manh: GgufStreamChunk[] = [];
    for await (const m of c.serverGenerateTextStream({ prompt: "x" })) manh.push(m);
    const xong = manh.find((m) => m.type === "done")!;
    expect(xong.tokensReasoning).toBe(3);
    expect(xong.fullText).toBe("ĐÁP-ÁN");
    expect(xong.reasoningText).toBe("nghĩ-1nghĩ-2nghĩ-3");
  });

  it("sự kiện `reasoning_content` RỖNG không được đếm (không phải một token)", async () => {
    const c = await freshClient();
    const day = sk({ reasoning_content: "" }) + sk({ reasoning_content: "a" }) + sk({ content: "x" }) + "data: [DONE]\n\n";
    vi.stubGlobal("fetch", vi.fn(async () => resStream(day)));
    const manh: GgufStreamChunk[] = [];
    for await (const m of c.serverGenerateTextStream({ prompt: "x" })) manh.push(m);
    expect(manh.find((m) => m.type === "done")!.tokensReasoning).toBe(1);
  });

  it("★ không có suy luận ⇒ 0 — là SỐ ĐO (đã xem trọn luồng), không phải undefined", async () => {
    const c = await freshClient();
    const day = sk({ content: "chỉ chữ" }) + "data: [DONE]\n\n";
    vi.stubGlobal("fetch", vi.fn(async () => resStream(day)));
    const manh: GgufStreamChunk[] = [];
    for await (const m of c.serverGenerateTextStream({ prompt: "x" })) manh.push(m);
    const xong = manh.find((m) => m.type === "done")!;
    expect(xong.tokensReasoning).toBe(0);
    expect(xong.reasoningText).toBeUndefined();
  });
});
