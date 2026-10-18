/**
 * ★★★ ĐỢT 4B — lưới `GoiModel` qua `/v1/chat/completions`: stream tool call ghép theo index, suy luận ra kênh RIÊNG,
 * hỏi lại ĐÚNG MỘT lần với `enable_thinking=false` khi có dấu `TOOL_CALL_TRONG_SUY_LUAN`, lỗi 401/403/429 rõ ràng.
 * Khung SSE lấy ĐÚNG hình dạng `server/routes/openaiGateway.ts` phát (đọc mã 2026-10-17).
 */
import { describe, it, expect } from "vitest";
import { taoGoiModelV1 } from "./goiModelV1";
import type { ManhModel } from "../../../shared/agentCore/index";

function sse(...khung: unknown[]): string {
  return khung.map((k) => (k === "[DONE]" ? "data: [DONE]\n\n" : `data: ${JSON.stringify(k)}\n\n`)).join("");
}

function dapStream(vanBan: string, catMoi = 7): Response {
  const bytes = new TextEncoder().encode(vanBan);
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + catMoi));
      i += catMoi;
    },
  });
  return { status: 200, body, headers: new Headers() } as unknown as Response;
}

function dapLoi(status: number, than: unknown, headers: Record<string, string> = {}): Response {
  return { status, body: null, headers: new Headers(headers), json: async () => than } as unknown as Response;
}

const delta = (d: Record<string, unknown>, finish: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] });

async function gom(it: AsyncIterable<ManhModel>): Promise<ManhModel[]> {
  const ra: ManhModel[] = [];
  for await (const m of it) ra.push(m);
  return ra;
}

const vaoMau = () => ({
  tinNhan: [{ role: "user" as const, content: "sửa lỗi" }],
  congCu: [{ type: "function" as const, function: { name: "read_file", parameters: { type: "object" } } }],
  signal: new AbortController().signal,
});

describe("GoiModel /v1 — luồng", () => {
  it("★★★ tool call ghép từ nhiều mảnh theo index + suy luận ra kênh `nghi` + Bearer token", async () => {
    const than: Array<Record<string, unknown>> = [];
    const headers: Array<Record<string, string>> = [];
    const f = (async (_u: string, init: { body: string; headers: Record<string, string> }) => {
      than.push(JSON.parse(init.body));
      headers.push(init.headers);
      return dapStream(
        sse(
          delta({ role: "assistant" }),
          delta({ content: "Đọc " }),
          delta({ content: "tệp." }),
          delta({ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "read_file", arguments: '{"pa' } }] }),
          delta({ tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }] }),
          delta({ tool_calls: [{ index: 1, id: "c2", type: "function", function: { name: "grep", arguments: '{"pattern":"x"}' } }] }),
          delta({ reasoning_content: "nghĩ kín" }),
          delta({}, "tool_calls"),
          "[DONE]",
        ),
      );
    }) as unknown as typeof fetch;
    const goi = taoGoiModelV1({ serverUrl: "http://may:3000", layToken: async () => "avgw_abc", fetch: f });
    const ra = await gom(goi(vaoMau()));
    expect(ra.filter((m) => m.loai === "chu").map((m) => (m as { noiDung: string }).noiDung).join("")).toBe("Đọc tệp.");
    expect(ra.filter((m) => m.loai === "nghi")).toEqual([{ loai: "nghi", noiDung: "nghĩ kín" }]);
    const xong = ra.at(-1) as Extract<ManhModel, { loai: "xong" }>;
    expect(xong.loai).toBe("xong");
    expect(xong.toolCalls).toEqual([
      { id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } },
      { id: "c2", type: "function", function: { name: "grep", arguments: '{"pattern":"x"}' } },
    ]);
    expect(headers[0].authorization).toBe("Bearer avgw_abc");
    expect(than[0]).toMatchObject({ stream: true, model: "chat", tool_choice: "auto", max_tokens: 16000 });
    expect(than[0].chat_template_kwargs).toBeUndefined();
    // chữ suy luận KHÔNG bao giờ lẫn vào chữ
    expect(ra.some((m) => m.loai === "chu" && m.noiDung.includes("nghĩ"))).toBe(false);
  });

  it("★★★ khung lỗi mang dấu TOOL_CALL_TRONG_SUY_LUAN ⇒ hỏi lại ĐÚNG MỘT lần với enable_thinking=false", async () => {
    const than: Array<Record<string, unknown>> = [];
    let lan = 0;
    const f = (async (_u: string, init: { body: string }) => {
      than.push(JSON.parse(init.body));
      lan++;
      if (lan === 1) {
        return dapStream(
          sse(
            delta({ role: "assistant" }),
            {
              choices: [{ index: 0, delta: {}, finish_reason: "error" }],
              error: { message: "[llamaServer] TOOL_CALL_TRONG_SUY_LUAN: model phát <tool_call> TRONG chuỗi suy luận", type: "server_error" },
            },
            delta({ reasoning_content: "<tool_call>{...}" }),
            delta({}, "stop"),
            "[DONE]",
          ),
        );
      }
      return dapStream(sse(delta({ tool_calls: [{ index: 0, id: "k", function: { name: "read_file", arguments: "{}" } }] }), delta({}, "tool_calls"), "[DONE]"));
    }) as unknown as typeof fetch;
    const ra = await gom(taoGoiModelV1({ serverUrl: "http://m", layToken: async () => "avgw_x", fetch: f })(vaoMau()));
    expect(lan).toBe(2);
    expect(than[1].chat_template_kwargs).toEqual({ enable_thinking: false });
    // suy luận của lượt hỏng (chứa <tool_call>) KHÔNG được phát ra
    expect(ra.some((m) => m.loai === "nghi")).toBe(false);
    expect((ra.at(-1) as Extract<ManhModel, { loai: "xong" }>).toolCalls[0].function.name).toBe("read_file");
  });

  // ★★★ Đợt 4 (V-dot4-1/2) — máy chủ mới trả `error.code`; máy chủ cũ trả thông điệp G5-D (câu trả lời cuối nằm TRONG
  //   suy luận, content rỗng — 5/6 lượt `loi-model` đo được: extension cũ không nhận ra ⇒ lõi thử lại y hệt ⇒ chết).
  const motLanLoiRoiOn = (loi: Record<string, unknown>) => {
    const than: Array<Record<string, unknown>> = [];
    let lan = 0;
    const f = (async (_u: string, init: { body: string }) => {
      than.push(JSON.parse(init.body));
      lan++;
      if (lan === 1) return dapStream(sse(delta({ role: "assistant" }), { error: loi }));
      return dapStream(sse(delta({ tool_calls: [{ index: 0, id: "k", function: { name: "read_file", arguments: "{}" } }] }), delta({}, "tool_calls"), "[DONE]"));
    }) as unknown as typeof fetch;
    return { f, than, lan: () => lan };
  };
  it.each([
    ["code tool_call_in_reasoning (thông điệp KHÔNG có dấu)", { message: "model emitted a tool call inside reasoning", type: "server_error", code: "tool_call_in_reasoning" }],
    ["code reasoning_without_content", { message: "x", type: "server_error", code: "reasoning_without_content" }],
    [
      "thông điệp G5-D của máy chủ CŨ (không code)",
      { message: "[aiGgufEngine] TỪ CHỐI TRUNG THỰC (G1-D, streaming chat completion): … hỏng: [llamaServer] TỪ CHỐI TRUNG THỰC (G5-D, stream): model đã tiêu HẾT hạn mức 16000 token vào chuỗi SUY LUẬN" },
    ],
  ])("★★★ %s ⇒ hỏi lại ĐÚNG MỘT lần với enable_thinking=false", async (_ten, loi) => {
    const k = motLanLoiRoiOn(loi);
    const ra = await gom(taoGoiModelV1({ serverUrl: "http://m", layToken: async () => "avgw_x", fetch: k.f })(vaoMau()));
    expect(k.lan()).toBe(2);
    expect(k.than[0].chat_template_kwargs).toBeUndefined();
    expect(k.than[1].chat_template_kwargs).toEqual({ enable_thinking: false });
    expect((ra.at(-1) as Extract<ManhModel, { loai: "xong" }>).toolCalls[0].function.name).toBe("read_file");
  });

  it("★★★ HTTP 500 JSON có code tool_call_in_reasoning (đường không-luồng của cổng) ⇒ hỏi lại nghĩ TẮT", async () => {
    const than: Array<Record<string, unknown>> = [];
    let lan = 0;
    const f = (async (_u: string, init: { body: string }) => {
      than.push(JSON.parse(init.body));
      lan++;
      if (lan === 1) return dapLoi(500, { error: { message: "x", type: "server_error", code: "tool_call_in_reasoning" } });
      return dapStream(sse(delta({ content: "ok" }), delta({}, "stop"), "[DONE]"));
    }) as unknown as typeof fetch;
    await gom(taoGoiModelV1({ serverUrl: "http://m", layToken: async () => "avgw_x", fetch: f })(vaoMau()));
    expect(lan).toBe(2);
    expect(than[1].chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("★★ G5-D lặp lại cả lần nghĩ TẮT ⇒ LoiModel SUY_LUAN_KHONG_CO_TRA_LOI, không lần ba", async () => {
    let lan = 0;
    const f = (async () => {
      lan++;
      return dapStream(sse({ error: { message: "x", code: "reasoning_without_content" } }, "[DONE]"));
    }) as unknown as typeof fetch;
    await expect(gom(taoGoiModelV1({ serverUrl: "http://m", layToken: async () => "avgw_x", fetch: f })(vaoMau()))).rejects.toMatchObject({
      ma: "SUY_LUAN_KHONG_CO_TRA_LOI",
    });
    expect(lan).toBe(2);
  });

  it("★★ dấu lặp lại ở lần hai ⇒ LoiModel, KHÔNG hỏi lần ba", async () => {
    let lan = 0;
    const f = (async () => {
      lan++;
      return dapStream(sse({ error: { message: "TOOL_CALL_TRONG_SUY_LUAN again" } }, "[DONE]"));
    }) as unknown as typeof fetch;
    await expect(gom(taoGoiModelV1({ serverUrl: "http://m", layToken: async () => "avgw_x", fetch: f })(vaoMau()))).rejects.toMatchObject({
      ma: "TOOL_CALL_TRONG_SUY_LUAN",
    });
    expect(lan).toBe(2);
  });

  it("★★ lỗi giữa luồng KHÔNG có dấu ⇒ LoiModel tạm thời (lõi thử lại), không hỏi lại tắt nghĩ", async () => {
    let lan = 0;
    const f = (async () => {
      lan++;
      return dapStream(sse({ choices: [{ index: 0, delta: {}, finish_reason: "error" }], error: { message: "LLAMA_SERVER_DOWN" } }, "[DONE]"));
    }) as unknown as typeof fetch;
    await expect(gom(taoGoiModelV1({ serverUrl: "http://m", layToken: async () => "avgw_x", fetch: f })(vaoMau()))).rejects.toMatchObject({
      tamThoi: true,
    });
    expect(lan).toBe(1);
  });

  it("★★ luồng đứt (không [DONE], không finish_reason) ⇒ tạm thời MODEL_CUT", async () => {
    const f = (async () => dapStream(sse(delta({ content: "dở" })))) as unknown as typeof fetch;
    await expect(gom(taoGoiModelV1({ serverUrl: "http://m", layToken: async () => "avgw_x", fetch: f })(vaoMau()))).rejects.toMatchObject({
      ma: "MODEL_CUT",
      tamThoi: true,
    });
  });
});

describe("GoiModel /v1 — lỗi HTTP có thông điệp rõ", () => {
  it("★★★ 401 ⇒ không tạm thời, chỉ đường đăng nhập device flow, gọi khi401", async () => {
    let bao = 0;
    const f = (async () => dapLoi(401, { error: { message: "API token expired.", code: "token_expired" } })) as unknown as typeof fetch;
    const p = gom(taoGoiModelV1({ serverUrl: "http://m", layToken: async () => "avgw_x", fetch: f, khi401: () => void bao++ })(vaoMau()));
    await expect(p).rejects.toMatchObject({ ma: "TOKEN_401", tamThoi: false });
    await expect(p).rejects.toThrow(/Đăng nhập AI Local \(device flow\)/);
    expect(bao).toBe(1);
  });
  it("★★ 403 thiếu phạm vi ⇒ nói thiếu 'chat'", async () => {
    const f = (async () => dapLoi(403, { error: { code: "insufficient_scope", message: "lacks chat" } })) as unknown as typeof fetch;
    await expect(gom(taoGoiModelV1({ serverUrl: "http://m", layToken: async () => "avgw_x", fetch: f })(vaoMau()))).rejects.toThrow(/phạm vi 'chat'/);
  });
  it("★★ 429 ⇒ kèm Retry-After", async () => {
    const f = (async () => dapLoi(429, { error: { code: "rate_limit_exceeded" } }, { "retry-after": "12" })) as unknown as typeof fetch;
    await expect(gom(taoGoiModelV1({ serverUrl: "http://m", layToken: async () => "avgw_x", fetch: f })(vaoMau()))).rejects.toThrow(/~12 giây/);
  });
  it("★★ chưa có token ⇒ KHÔNG gọi mạng", async () => {
    let goi = 0;
    const f = (async () => {
      goi++;
      return dapLoi(500, {});
    }) as unknown as typeof fetch;
    await expect(gom(taoGoiModelV1({ serverUrl: "http://m", layToken: async () => undefined, fetch: f })(vaoMau()))).rejects.toMatchObject({
      ma: "CHUA_CO_TOKEN",
    });
    expect(goi).toBe(0);
  });
  it("★★ 503 ⇒ tạm thời", async () => {
    const f = (async () => dapLoi(503, { error: { message: "Local GGUF engine not available." } })) as unknown as typeof fetch;
    await expect(gom(taoGoiModelV1({ serverUrl: "http://m", layToken: async () => "avgw_x", fetch: f })(vaoMau()))).rejects.toMatchObject({
      tamThoi: true,
    });
  });
});

/**
 * ★★ 4B-client — `usage` THẬT của máy chủ (126de672b): xin `stream_options.include_usage` ⇒ chunk CUỐI `choices: []` + `usage`,
 * đứng SAU finish và TRƯỚC `[DONE]` (khuôn `openaiGateway.kwargsUsage.test.ts`). Đồng hồ ngữ cảnh dùng số này thay ước lượng.
 */
describe("GoiModel /v1 — usage thật", () => {
  it("★★ chunk cuối choices:[] + usage ⇒ `xong.usage` {vao, ra, nghi}; thân yêu cầu xin include_usage", async () => {
    const than: Array<Record<string, unknown>> = [];
    const f = (async (_u: string, init: { body: string }) => {
      than.push(JSON.parse(init.body));
      return dapStream(
        sse(
          delta({ content: "xong" }),
          delta({}, "stop"),
          {
            object: "chat.completion.chunk",
            choices: [],
            usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, completion_tokens_details: { reasoning_tokens: 4 } },
          },
          "[DONE]",
        ),
      );
    }) as unknown as typeof fetch;
    const ra = await gom(taoGoiModelV1({ serverUrl: "http://may", layToken: async () => "avgw_x", fetch: f })(vaoMau()));
    expect(than[0].stream_options).toEqual({ include_usage: true });
    const xong = ra.at(-1) as Extract<ManhModel, { loai: "xong" }>;
    expect(xong.usage).toEqual({ vao: 11, ra: 7, nghi: 4 });
    expect(ra.filter((m) => m.loai === "chu").map((m) => (m as { noiDung: string }).noiDung).join("")).toBe("xong");
  });
});
