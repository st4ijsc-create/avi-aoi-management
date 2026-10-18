/**
 * ★★★ Đợt 4B-server — hai lỗ cổng `/v1` mà extension v0.2 (Đợt 4B) báo cáo:
 *
 *   §1 `chat_template_kwargs` được chuyển tới engine theo DANH SÁCH TRẮNG: CHỈ `enable_thinking` kiểu boolean, qua đường
 *      ĐÃ CÓ (`GgufChatOptions.disableThinking` ⇒ `aiLlamaServerClient.lapCoTatSuyLuan`). `false` ⇒ `disableThinking:true`;
 *      `true` ⇒ không cờ (mặc định server). Mọi khoá khác / kiểu sai ⇒ BỎ — không khoá lạ nào tới được thân yêu cầu
 *      của llama-server (một khoá template tuỳ ý là một cần gạt hành vi model do caller điều khiển).
 *   §2 stream + `stream_options.include_usage: true` ⇒ chunk CUỐI (trước `[DONE]`) theo chuẩn OpenAI: `choices: []` +
 *      `usage {prompt_tokens, completion_tokens, total_tokens}` (+ `completion_tokens_details.reasoning_tokens` khi engine
 *      ĐẾM được — `tokensReasoning` có mặt; vắng ⇒ không bịa 0). Không xin ⇒ không có chunk usage (hành vi cũ, bit-đối-bit).
 *      Cùng hợp đồng cho `/completions` stream (opt-in, chỉ khi xin).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  streamOpts: [] as any[],
  done: { type: "done", tokensPrompt: 11, tokensGenerated: 7, tokensReasoning: 4 } as Record<string, unknown>,
}));

const chatCompletionMock = vi.fn(async (_opts: any) => ({
  text: "ok",
  tokensPrompt: 3,
  tokensGenerated: 2,
  modelId: "x",
  totalTimeMs: 1,
  tokensPerSecond: 1,
}));
const generateFimMock = vi.fn(async () => ({ text: "return 1;", tokensPrompt: 5, tokensGenerated: 2, modelId: "x", totalTimeMs: 1, tokensPerSecond: 1 }));

vi.mock("../services/aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  chatCompletion: (...a: unknown[]) => chatCompletionMock(...(a as [any])),
  generateText: vi.fn(),
  generateFim: () => generateFimMock(),
  generateEmbedding: vi.fn(),
  generateEmbeddings: vi.fn(),
  chatCompletionStream: (opts: any) => {
    h.streamOpts.push(opts);
    return (async function* () {
      yield { type: "token", token: "xin " };
      yield { type: "token", token: "chao" };
      yield h.done;
    })();
  },
  generateTextStream: async function* () {},
}));
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => null) }));

import { createOpenAiGatewayRouter } from "./openaiGateway";

const KEY = "KWARGS-USAGE-KEY";
let may: { url: string; server: Server };
beforeAll(async () => {
  const app = express();
  app.use("/v1", createOpenAiGatewayRouter({ apiKey: KEY }));
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  may = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
});
afterAll(() => new Promise<void>((r) => may.server.close(() => r())));
beforeEach(() => {
  vi.clearAllMocks();
  h.streamOpts = [];
  h.done = { type: "done", tokensPrompt: 11, tokensGenerated: 7, tokensReasoning: 4 };
});

const post = (duong: string, than: Record<string, unknown>) =>
  fetch(`${may.url}/v1${duong}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(than),
  });
const MSG = [{ role: "user", content: "hi" }];

/** Tách SSE ⇒ mảng sự kiện JSON + cờ `[DONE]`. */
async function docSse(r: Response): Promise<{ suKien: any[]; done: boolean }> {
  const than = await r.text();
  const khung = than.split("\n\n").map((k) => k.trim()).filter(Boolean);
  const suKien: any[] = [];
  let done = false;
  for (const k of khung) {
    const d = k.replace(/^data:\s*/, "");
    if (d === "[DONE]") done = true;
    else suKien.push(JSON.parse(d));
  }
  return { suKien, done };
}

describe("§1 — `chat_template_kwargs`: danh sách trắng CHỈ `enable_thinking` boolean", () => {
  it("non-stream: enable_thinking=false ⇒ engine nhận disableThinking:true", async () => {
    const r = await post("/chat/completions", { messages: MSG, chat_template_kwargs: { enable_thinking: false } });
    expect(r.status).toBe(200);
    expect(chatCompletionMock.mock.calls[0][0].disableThinking).toBe(true);
  });
  it("stream: enable_thinking=false ⇒ disableThinking:true trên chatCompletionStream", async () => {
    const r = await post("/chat/completions", { messages: MSG, stream: true, chat_template_kwargs: { enable_thinking: false } });
    await r.text();
    expect(h.streamOpts[0].disableThinking).toBe(true);
  });
  it("enable_thinking=true / vắng ⇒ KHÔNG có ô disableThinking (mặc định server, hình dạng cũ bit-đối-bit)", async () => {
    await post("/chat/completions", { messages: MSG, chat_template_kwargs: { enable_thinking: true } });
    await post("/chat/completions", { messages: MSG });
    for (const c of chatCompletionMock.mock.calls) expect("disableThinking" in c[0]).toBe(false);
  });
  it("khoá KHÁC và kiểu SAI bị bỏ: không khoá nào ngoài danh sách trắng chạm tới engine", async () => {
    await post("/chat/completions", {
      messages: MSG,
      chat_template_kwargs: { enable_thinking: "false", add_generation_prompt: false, tools_in_user_message: true, __proto__x: 1 },
    });
    await post("/chat/completions", { messages: MSG, chat_template_kwargs: "enable_thinking=false" });
    await post("/chat/completions", { messages: MSG, chat_template_kwargs: [false] });
    expect(chatCompletionMock).toHaveBeenCalledTimes(3);
    for (const c of chatCompletionMock.mock.calls) {
      const o = c[0];
      expect("disableThinking" in o).toBe(false);
      const s = JSON.stringify(o);
      for (const k of ["chat_template_kwargs", "add_generation_prompt", "tools_in_user_message", "enable_thinking", "__proto__x"]) {
        expect(s.includes(k)).toBe(false);
      }
    }
  });
});

describe("§2 — usage trong luồng (`stream_options.include_usage`)", () => {
  it("chat stream + include_usage ⇒ chunk cuối choices:[] + usage {11, 7, 18, reasoning 4}, đứng SAU finish và TRƯỚC [DONE]", async () => {
    const r = await post("/chat/completions", { messages: MSG, stream: true, stream_options: { include_usage: true } });
    const { suKien, done } = await docSse(r);
    expect(done).toBe(true);
    const cuoi = suKien[suKien.length - 1];
    expect(cuoi.object).toBe("chat.completion.chunk");
    expect(cuoi.choices).toEqual([]);
    expect(cuoi.usage).toEqual({
      prompt_tokens: 11,
      completion_tokens: 7,
      total_tokens: 18,
      completion_tokens_details: { reasoning_tokens: 4 },
    });
    const iFinish = suKien.findIndex((e) => e.choices?.[0]?.finish_reason === "stop");
    expect(iFinish).toBeGreaterThanOrEqual(0);
    expect(iFinish).toBe(suKien.length - 2);
    expect(suKien[0].id).toBe(cuoi.id);
  });
  it("engine KHÔNG đếm suy luận (tokensReasoning vắng) ⇒ không có completion_tokens_details (không bịa 0)", async () => {
    h.done = { type: "done", tokensPrompt: 2, tokensGenerated: 1 };
    const { suKien } = await docSse(await post("/chat/completions", { messages: MSG, stream: true, stream_options: { include_usage: true } }));
    expect(suKien[suKien.length - 1].usage).toEqual({ prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 });
  });
  it("KHÔNG xin (vắng / false) ⇒ không chunk usage nào (hành vi cũ)", async () => {
    for (const than of [{}, { stream_options: { include_usage: false } }]) {
      const { suKien, done } = await docSse(await post("/chat/completions", { messages: MSG, stream: true, ...than }));
      expect(done).toBe(true);
      expect(suKien.some((e) => "usage" in e)).toBe(false);
      expect(suKien[suKien.length - 1].choices[0].finish_reason).toBe("stop");
    }
  });
  it("/completions stream + include_usage ⇒ chunk usage text_completion cuối {5, 2, 7}; không xin ⇒ không có", async () => {
    const co = await docSse(await post("/completions", { prompt: "a", suffix: "b", stream: true, stream_options: { include_usage: true } }));
    const cuoi = co.suKien[co.suKien.length - 1];
    expect(cuoi).toMatchObject({ object: "text_completion", choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } });
    const khong = await docSse(await post("/completions", { prompt: "a", suffix: "b", stream: true }));
    expect(khong.suKien.some((e) => "usage" in e)).toBe(false);
  });
});
