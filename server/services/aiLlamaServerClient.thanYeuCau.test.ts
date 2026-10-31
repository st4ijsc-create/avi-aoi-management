/**
 * ★ Đợt 12 H3.2 — CỔNG CHÍNH của "mô tả khai báo mỗi model": ẢNH CHỤP thân yêu cầu llama-server (đường agent `serverChatCompletionStream`
 * + đường văn bản `serverGenerateTextStream`) cho các ca mang hành vi THEO MODEL. Ảnh được ghi TRƯỚC khi gom hành vi vào
 * `shared/ai/moTaModel.ts` và phải GIỮ NGUYÊN sau đó với Qwen3.6-35B-A3B (byte gửi model y hệt ⇒ không cần A/B GPU).
 * Đổi ảnh = đổi byte gửi model ⇒ phải có lý do + A/B ở cửa sổ GPU.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GgufChatOptions } from "./aiGgufEngine";

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.LLAMA_SERVER_STRICT;
  delete process.env.LLAMA_SERVER_API_KEY;
  process.env.LLAMA_SERVER_ENABLED = "true";
  process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8091";
  process.env.GGUF_DEFAULT_MODEL = "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf";
  process.env.LLAMA_SERVER_MODEL = "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf";
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

const enc = new TextEncoder();
const SSE = `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;

async function thanGui(goi: (c: typeof import("./aiLlamaServerClient")) => AsyncIterable<unknown>): Promise<Record<string, unknown>> {
  vi.resetModules();
  const c = await import("./aiLlamaServerClient");
  let than: Record<string, unknown> | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_u: string, init: { body: string }) => {
      than = JSON.parse(init.body) as Record<string, unknown>;
      let xong = false;
      const reader = { read: async () => (xong ? { done: true } : ((xong = true), { done: false, value: enc.encode(SSE) })), cancel: async () => undefined };
      return { ok: true, status: 200, body: { getReader: () => reader }, headers: { get: () => null } } as unknown as Response;
    }),
  );
  for await (const _ of goi(c)) void _;
  return than!;
}

const TIN: GgufChatOptions["messages"] = [
  { role: "system", content: "Bạn là tác nhân lập trình." },
  { role: "user", content: "sửa a.ts" },
];
const TOOLS = [{ type: "function", function: { name: "read_file", description: "đọc tệp", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } }];

const CA: Array<[string, GgufChatOptions]> = [
  ["thuong", { messages: TIN, maxTokens: 16000, temperature: 0.2, topP: 0.9, repeatPenalty: 1.05 }],
  ["tat-nghi", { messages: TIN, maxTokens: 16000, disableThinking: true }],
  [
    "giu-nghi",
    { messages: [...TIN, { role: "assistant", content: "đã đọc", nghiTruoc: "cần đọc a.ts" }, { role: "user", content: "tiếp" }], maxTokens: 16000, preserveThinking: true },
  ],
  ["tat-nghi+giu-nghi", { messages: TIN, maxTokens: 16000, disableThinking: true, preserveThinking: true }],
  ["ngan-sach-nghi", { messages: TIN, maxTokens: 16000, thinkingBudgetTokens: 4000 }],
  ["ngan-sach-nghi+tat-nghi", { messages: TIN, maxTokens: 16000, thinkingBudgetTokens: 4000, disableThinking: true }],
  ["sampling-b2", { messages: TIN, maxTokens: 16000, topK: 20, minP: 0, presencePenalty: 0 }],
  ["tools", { messages: TIN, maxTokens: 16000, tools: TOOLS, toolChoice: "auto" } as never],
];

describe("H3.2 — ảnh chụp thân yêu cầu llama-server (Qwen3.6-35B-A3B)", () => {
  it.each(CA)("chat stream · %s", async (_ten, o) => {
    expect(await thanGui((c) => c.serverChatCompletionStream(o, "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf"))).toMatchSnapshot();
  });
  it("text stream · tat-nghi", async () => {
    expect(await thanGui((c) => c.serverGenerateTextStream({ prompt: "hi", disableThinking: true } as never, "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf"))).toMatchSnapshot();
  });
  it("model lạ (không có mô tả) · tat-nghi+giu-nghi+ngan-sach ⇒ như hôm nay", async () => {
    expect(
      await thanGui((c) => c.serverChatCompletionStream({ messages: TIN, maxTokens: 100, disableThinking: true, preserveThinking: true, thinkingBudgetTokens: 10 }, "model-la-xyz.gguf")),
    ).toMatchSnapshot();
  });
});
