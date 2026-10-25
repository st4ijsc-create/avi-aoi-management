/**
 * Lô độ-tin-cậy `ai.phan-loai` — NỐI DÂY llama-server: `topLogprobs` ⇒ body có `logprobs:true, top_logprobs:N`; phản hồi ⇒ `logprobsDau` đã chuẩn hoá (≤ 8 token);
 * KHÔNG xin ⇒ body không có khóa và kết quả không có `logprobsDau` (không bịa).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };
const bodies: Array<Record<string, unknown>> = [];

const phanHoi = (coLogprobs: boolean) => ({
  choices: [
    {
      message: { role: "assistant", content: "dien" },
      finish_reason: "stop",
      ...(coLogprobs
        ? { logprobs: { content: Array.from({ length: 12 }, (_, i) => ({ token: i === 0 ? "dien" : "x", logprob: -0.05, top_logprobs: [{ token: "dien", logprob: -0.05 }, { token: "vat", logprob: -3.2 }] })) } }
        : {}),
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 12 },
});

beforeEach(() => {
  bodies.length = 0;
  Object.assign(process.env, { LLAMA_SERVER_ENABLED: "true", LLAMA_SERVER_URL: "http://127.0.0.1:8091", LLAMA_SERVER_MODEL: "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

async function chay(topLogprobs: number | undefined, server: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (String(url).includes("/v1/chat/completions")) {
        bodies.push(JSON.parse(init!.body!));
        return new Response(JSON.stringify(phanHoi(server)), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  vi.resetModules();
  const c = await import("./aiLlamaServerClient");
  return c.serverChatCompletion({ messages: [{ role: "user", content: "x" }], topLogprobs }, "Qwen3.6-35B-A3B-UD-Q4_K_XL");
}

describe("serverChatCompletion — logprobs", () => {
  it("★ topLogprobs=10 ⇒ body logprobs:true + top_logprobs:10; kết quả mang ≤ 8 token đầu kèm top", async () => {
    const r = await chay(10, true);
    expect(bodies[0]).toMatchObject({ logprobs: true, top_logprobs: 10 });
    expect(r.logprobsDau).toHaveLength(8);
    expect(r.logprobsDau![0]).toEqual({ token: "dien", logprob: -0.05, top: [{ token: "dien", logprob: -0.05 }, { token: "vat", logprob: -3.2 }] });
  });

  it("top_logprobs bị kẹp ≤ 20", async () => {
    await chay(500, true);
    expect(bodies[0].top_logprobs).toBe(20);
  });

  it("★ KHÔNG xin ⇒ body không có logprobs/top_logprobs và kết quả không có logprobsDau", async () => {
    const r = await chay(undefined, false);
    expect(bodies[0]).not.toHaveProperty("logprobs");
    expect(bodies[0]).not.toHaveProperty("top_logprobs");
    expect(r).not.toHaveProperty("logprobsDau");
  });

  it("★ xin nhưng server KHÔNG trả logprobs ⇒ logprobsDau undefined (không bịa)", async () => {
    const r = await chay(10, false);
    expect(bodies[0]).toMatchObject({ logprobs: true });
    expect(r.logprobsDau).toBeUndefined();
  });
});
