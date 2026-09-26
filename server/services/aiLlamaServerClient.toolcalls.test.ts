/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * G2-B — TẦNG DÂY: `serverChatCompletion` / `serverChatCompletionStream` VỚI `tools`.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Lưới gateway (`openaiGateway.nativeTools.test.ts`) **mock cả `aiGgufEngine`**, nên nó không thể
 * nói gì về việc `tools` có thật sự lên tới thân yêu cầu HTTP hay không, và **không thể** bắt được
 * cái bẫy nguy hiểm nhất của bản vá này:
 *
 * ⚠⚠ **CÁI BẪY**: một lượt tool-call THÀNH CÔNG trả `content: ""` (đo sống b9814:
 * `finish_reason:"tool_calls"`, `content:""`). Mà `phanDinhCauTraLoiRong()` — cổng dựng ở G5-D để
 * bắt "câu trả lời rỗng" — KHÔNG biết gì về tool và sẽ **NÉM trên đúng những lượt tool-call thành
 * công nhất**, kèm một câu lỗi nói về *"token cạn kiệt vào suy luận"*: một chẩn đoán hoàn toàn sai
 * cho một lượt hoàn toàn đúng. Nối dây tool mà quên chỗ này ⇒ 100% lượt native hỏng.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_machine_oee",
      description: "OEE",
      parameters: { type: "object", properties: { machineId: { type: "string" } } },
    },
  },
];

/** Bắt lấy thân yêu cầu POST và trả về JSON đã cho. */
function stubFetch(json: unknown): { than: () => any } {
  let than: any = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: any) => {
      than = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => json } as any;
    }),
  );
  return { than: () => than };
}

// ═══ 1. THÂN YÊU CẦU ══════════════════════════════════════════════════════════════════════════
describe("G2-B · `tools` lên tới thân yêu cầu HTTP", () => {
  it("gửi `tools` + `tool_choice:auto` khi options có tools", async () => {
    const srv = await freshClient();
    const cap = stubFetch({ choices: [{ message: { role: "assistant", content: "x" }, finish_reason: "stop" }] });
    await srv.serverChatCompletion({ messages: [{ role: "user", content: "hỏi" }], tools: TOOLS });
    expect(cap.than().tools).toHaveLength(1);
    expect(cap.than().tools[0].function.name).toBe("get_machine_oee");
    expect(cap.than().tool_choice).toBe("auto");
  });

  it("KHÔNG có tools ⇒ thân yêu cầu KHÔNG có ô `tools` (prefix-cache của lượt chat cũ không đổi)", async () => {
    const srv = await freshClient();
    const cap = stubFetch({ choices: [{ message: { content: "x" } }] });
    await srv.serverChatCompletion({ messages: [{ role: "user", content: "hỏi" }] });
    expect(cap.than()).not.toHaveProperty("tools");
    expect(cap.than()).not.toHaveProperty("tool_choice");
  });

  it("`tools: []` KHÔNG rẽ nhánh `{%- if tools %}` của chat template", async () => {
    const srv = await freshClient();
    const cap = stubFetch({ choices: [{ message: { content: "x" } }] });
    await srv.serverChatCompletion({ messages: [{ role: "user", content: "hỏi" }], tools: [] });
    expect(cap.than()).not.toHaveProperty("tools");
  });

  it("vai `tool` + `tool_call_id` + assistant.tool_calls lên dây NGUYÊN VẸN", async () => {
    const srv = await freshClient();
    const cap = stubFetch({ choices: [{ message: { content: "87.3%" } }] });
    await srv.serverChatCompletion({
      messages: [
        { role: "user", content: "OEE?" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "c1", content: '{"oee":0.873}' },
      ],
      tools: TOOLS,
    });
    const msgs = cap.than().messages;
    expect(msgs[2].role).toBe("tool");
    expect(msgs[2].tool_call_id).toBe("c1");
    expect(msgs[1].tool_calls[0].id).toBe("c1");
  });
});

// ═══ 2. ⚠⚠ CÁI BẪY: content RỖNG + tool_calls ═════════════════════════════════════════════════
describe("G2-B · lượt tool-call thành công có `content: \"\"` — KHÔNG được coi là câu trả lời rỗng", () => {
  const DAP_UNG_TOOLCALL = {
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            { type: "function", function: { name: "get_machine_oee", arguments: '{"machineId": "AOI-01"}' }, id: "xdCz" },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 190, completion_tokens: 27 },
  };

  it("KHÔNG NÉM, và trả về toolCalls + finishReason='tool_calls'", async () => {
    const srv = await freshClient();
    stubFetch(DAP_UNG_TOOLCALL);
    const kq = await srv.serverChatCompletion({ messages: [{ role: "user", content: "OEE?" }], tools: TOOLS });
    expect(kq.toolCalls).toHaveLength(1);
    expect(kq.toolCalls![0].function.name).toBe("get_machine_oee");
    expect(kq.toolCalls![0].function.arguments).toBe('{"machineId": "AOI-01"}');
    expect(kq.finishReason).toBe("tool_calls");
    expect(kq.text).toBe("");
  });

  it("⚠ content rỗng mà KHÔNG có tool_calls thì VẪN NÉM như trước (không nới lỏng cổng cũ)", async () => {
    const srv = await freshClient();
    stubFetch({
      choices: [{ finish_reason: "length", message: { role: "assistant", content: "", reasoning_content: "x".repeat(400) } }],
      usage: { prompt_tokens: 10, completion_tokens: 300 },
    });
    await expect(
      srv.serverChatCompletion({ messages: [{ role: "user", content: "hỏi" }], maxTokens: 300, tools: TOOLS }),
    ).rejects.toThrow();
  });

  it("lượt KHÔNG tool vẫn không mọc ô `toolCalls` (không phải `[]`)", async () => {
    const srv = await freshClient();
    stubFetch({ choices: [{ message: { content: "xin chào" }, finish_reason: "stop" }] });
    const kq = await srv.serverChatCompletion({ messages: [{ role: "user", content: "chào" }] });
    expect(kq).not.toHaveProperty("toolCalls");
  });
});

// ═══ 3. BỘ VỚT — build không phân giải ⇒ `<tool_call>` nguyên văn trong content ════════════════
describe("G2-B · bộ VỚT `<tool_call>` khỏi content", () => {
  it("vớt được, và LẤY khối ấy RA khỏi chữ hiển thị", async () => {
    const srv = await freshClient();
    stubFetch({
      choices: [
        { message: { content: '<tool_call>\n{"name":"get_machine_oee","arguments":{"machineId":"AOI-01"}}\n</tool_call>' }, finish_reason: "stop" },
      ],
    });
    const kq = await srv.serverChatCompletion({ messages: [{ role: "user", content: "OEE?" }], tools: TOOLS });
    expect(kq.toolCalls).toHaveLength(1);
    expect(kq.text).not.toContain("tool_call");
  });

  it("⚠ KHÔNG vớt khi lượt này KHÔNG gửi tools — một câu trả lời NÓI VỀ `<tool_call>` không phải một hành động", async () => {
    const srv = await freshClient();
    stubFetch({
      choices: [{ message: { content: 'Cú pháp là <tool_call>{"name":"x","arguments":{}}</tool_call> nhé.' }, finish_reason: "stop" }],
    });
    const kq = await srv.serverChatCompletion({ messages: [{ role: "user", content: "cú pháp tool_call?" }] });
    expect(kq).not.toHaveProperty("toolCalls");
    expect(kq.text).toContain("tool_call");
  });
});

// ═══ 4. STREAM ════════════════════════════════════════════════════════════════════════════════
/** Thân SSE phát các mảnh cho trước. */
function thanSse(sukien: string[]) {
  const enc = new TextEncoder();
  const mieng = sukien.map((s) => enc.encode(s));
  let i = 0;
  const reader = {
    async read() {
      if (i >= mieng.length) return { done: true };
      return { done: false, value: mieng[i++] };
    },
    async cancel() {
      i = mieng.length;
    },
  };
  return { getReader: () => reader };
}

function stubSse(sukien: string[]): { than: () => any } {
  let than: any = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_u: string, init: any) => {
      than = JSON.parse(init.body);
      return { ok: true, status: 200, body: thanSse(sukien) } as any;
    }),
  );
  return { than: () => than };
}

describe("G2-B · streaming tool-calls", () => {
  const SU_KIEN = [
    'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":null}}]}\n\n',
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"get_machine_oee","arguments":"{"}}]}}]}\n\n',
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"machineId\\":\\"AOI-01\\"}"}}]}}]}\n\n',
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":190,"completion_tokens":27}}\n\n',
    "data: [DONE]\n\n",
  ];

  async function chay(sukien: string[], opts: any) {
    const srv = await freshClient();
    const cap = stubSse(sukien);
    const ra: GgufStreamChunk[] = [];
    for await (const c of srv.serverChatCompletionStream(opts)) ra.push(c);
    return { ra, cap };
  }

  it("phát chunk `tool_call_delta` cho MỖI mảnh, và gom đủ ở chunk `done`", async () => {
    const { ra } = await chay(SU_KIEN, { messages: [{ role: "user", content: "OEE?" }], tools: TOOLS });
    const deltas = ra.filter((c) => c.type === "tool_call_delta");
    expect(deltas).toHaveLength(2);
    const done = ra.find((c) => c.type === "done")!;
    expect(done.toolCalls).toHaveLength(1);
    expect(done.toolCalls![0].function.arguments).toBe('{"machineId":"AOI-01"}');
    expect(done.finishReason).toBe("tool_calls");
  });

  it("⚠⚠ luồng tool-call thuần (0 mảnh chữ) KHÔNG bị coi là 'câu trả lời rỗng' ⇒ KHÔNG có chunk error", async () => {
    const { ra } = await chay(SU_KIEN, { messages: [{ role: "user", content: "OEE?" }], tools: TOOLS, maxTokens: 300 });
    expect(ra.filter((c) => c.type === "error")).toHaveLength(0);
    expect(ra.find((c) => c.type === "done")!.fullText).toBe("");
  });

  /**
   * ★★★ CA NÀY TỒN TẠI VÌ MỘT ĐỘT BIẾN SỐNG SÓT, VÀ VÌ SAO NÓ SỐNG MỚI LÀ ĐIỀU ĐÁNG GHI.
   *
   * Đột biến M4 = bỏ `&& !boGomTool.coToolCall` khỏi cổng câu-trả-lời-rỗng ở `streamChatCompletion`.
   * Lưới ban đầu KHÔNG bắt được, và đó KHÔNG phải vì cổng ấy thừa — mà vì `phanDinhCauTraLoiRong()`
   * có HAI ca ném hai lỗi KHÁC LOẠI, còn chỗ gọi ở đường stream chỉ ném tiếp **một** loại:
   *   • ca (B) — có `reasoning_content` ⇒ `LoiTokenCanKietVaoSuyLuan` ⇒ **được ném tiếp**;
   *   • ca (A) — rỗng CẢ HAI ⇒ `Error("empty completion")` ⇒ **bị nuốt có chủ đích** (quyết định
   *     của G5-D: đường stream cố ý giữ nguyên hành vi cũ cho ca A).
   * Roster đang chạy (Qwen3-30B-A3B-**Instruct**) KHÔNG phát `reasoning_content`, nên mọi ca cũ
   * rơi vào (A) ⇒ bỏ cổng đi cũng chẳng thấy gì.
   *
   * ⇒ Cổng ấy chỉ LÊN TIẾNG trên một model LAI (biến thể thinking của Qwen3, DeepSeek-R1…): suy
   * luận trước, rồi `tool_calls`, `content` rỗng. Khi đó bỏ cổng = **mọi lượt tool-call của model
   * lai đều chết** kèm chẩn đoán sai *"token cạn kiệt vào suy luận"*. Ca dưới đây dựng ĐÚNG hình
   * dạng ấy — nó không phải ca thêm cho đủ số, nó là ca cho kịch bản mà cổng được sinh ra để canh.
   */
  it("★ model LAI: reasoning_content + tool_calls + content rỗng ⇒ KHÔNG bị coi là câu trả lời rỗng", async () => {
    const { ra } = await chay(
      [
        'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":null}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"reasoning_content":"Người dùng hỏi OEE. Ta nên gọi tool."}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"get_machine_oee","arguments":"{}"}}]}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ],
      { messages: [{ role: "user", content: "OEE?" }], tools: TOOLS, maxTokens: 300 },
    );
    const done = ra.find((c) => c.type === "done");
    expect(done, "luồng phải kết thúc bằng chunk `done`, không phải một exception").toBeTruthy();
    expect(done!.toolCalls).toHaveLength(1);
    expect(done!.reasoningText).toContain("gọi tool");
  });

  it("mảnh tool_call KHÔNG BAO GIỜ ra dưới dạng chunk `token`", async () => {
    const { ra } = await chay(SU_KIEN, { messages: [{ role: "user", content: "OEE?" }], tools: TOOLS });
    for (const c of ra.filter((x) => x.type === "token")) {
      expect(c.token ?? "").not.toContain("machineId");
      expect(c.token ?? "").not.toContain("get_machine_oee");
    }
  });

  it("`tools` lên tới thân yêu cầu STREAM", async () => {
    const { cap } = await chay(SU_KIEN, { messages: [{ role: "user", content: "OEE?" }], tools: TOOLS });
    expect(cap.than().tools).toHaveLength(1);
    expect(cap.than().stream).toBe(true);
  });

  it("luồng CHỮ thường không mọc ô toolCalls và vẫn `done` bình thường", async () => {
    const { ra } = await chay(
      [
        'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":null}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"content":"xin "}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"content":"chào"}}]}\n\n',
        "data: [DONE]\n\n",
      ],
      { messages: [{ role: "user", content: "chào" }] },
    );
    const done = ra.find((c) => c.type === "done")!;
    expect(done.fullText).toBe("xin chào");
    expect(done).not.toHaveProperty("toolCalls");
    expect(ra.filter((c) => c.type === "tool_call_delta")).toHaveLength(0);
  });
});
