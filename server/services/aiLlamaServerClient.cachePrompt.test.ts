/**
 * ★ Đợt 12 H0.1 (2026-10-31) — chunk `done` của đường stream llama-server TÁCH token prompt tái dùng từ prefix-cache (`cacheN` =
 * `timings.cache_n`) và xử lý lại (`promptN` = `timings.prompt_n`). Trước đây hai số bị cộng vào `tokensPrompt` ⇒ mất tỉ lệ trúng cache.
 *
 * ĐỘT BIẾN PHẢI BẮT: đảo cache_n/prompt_n · bỏ dự phòng `usage.prompt_tokens_details.cached_tokens` · ghi 0 khi server không khai
 * (không biết ≠ 0) · nhận số âm / rác · `tokensPrompt` đổi nghĩa (phải vẫn là TỔNG).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GgufStreamChunk } from "./aiGgufEngine";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.LLAMA_SERVER_STRICT;
  delete process.env.LLAMA_SERVER_API_KEY;
  delete process.env.LLAMA_SERVER_STREAM_IDLE_TIMEOUT_MS;
  process.env.LLAMA_SERVER_ENABLED = "true";
  process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8091";
  process.env.GGUF_DEFAULT_MODEL = "qwen3-30b-a3b-instruct.gguf";
  process.env.LLAMA_SERVER_MODEL = "qwen3-30b-a3b-instruct.gguf";
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

const enc = new TextEncoder();

function res(byte: Uint8Array): Response {
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

const chu = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "ok" } }] })}\n\n`;
const cuoi = (them: Record<string, unknown>) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], ...them })}\n\n` + "data: [DONE]\n\n";

async function done(duoi: string): Promise<GgufStreamChunk> {
  vi.stubGlobal("fetch", vi.fn(async () => res(enc.encode(chu + duoi))));
  vi.resetModules();
  const c = await import("./aiLlamaServerClient");
  let d: GgufStreamChunk | undefined;
  for await (const x of c.serverGenerateTextStream({ prompt: "hi" })) if (x.type === "done") d = x;
  return d!;
}

describe("H0.1 — cacheN / promptN trên chunk done", () => {
  it("★ timings.cache_n / prompt_n ⇒ cacheN / promptN riêng; tokensPrompt vẫn là TỔNG", async () => {
    const d = await done(cuoi({ usage: { prompt_tokens: 6554, completion_tokens: 3 }, timings: { cache_n: 6000, prompt_n: 554, predicted_n: 3 } }));
    expect([d.cacheN, d.promptN, d.tokensPrompt]).toEqual([6000, 554, 6554]);
  });

  it("thiếu timings ⇒ dự phòng usage.prompt_tokens_details.cached_tokens (promptN = prompt_tokens − cached)", async () => {
    const d = await done(cuoi({ usage: { prompt_tokens: 14, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 12 } } }));
    expect([d.cacheN, d.promptN, d.tokensPrompt]).toEqual([12, 2, 14]);
  });

  it("timings thắng usage khi có cả hai (timings là số server đo trực tiếp)", async () => {
    const d = await done(
      cuoi({ usage: { prompt_tokens: 14, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 1 } }, timings: { cache_n: 12, prompt_n: 2 } }),
    );
    expect([d.cacheN, d.promptN]).toEqual([12, 2]);
  });

  it("cache trượt hoàn toàn (cache_n 0) ⇒ 0 là SỐ ĐO, không phải vắng", async () => {
    const d = await done(cuoi({ timings: { cache_n: 0, prompt_n: 900 } }));
    expect([d.cacheN, d.promptN]).toEqual([0, 900]);
  });

  it("server không khai gì ⇒ KHÔNG có trường (không biết ≠ 0)", async () => {
    const d = await done(cuoi({ usage: { prompt_tokens: 14, completion_tokens: 3 } }));
    expect("cacheN" in d).toBe(false);
    expect("promptN" in d).toBe(false);
    expect(d.tokensPrompt).toBe(14);
  });

  it("(kiem-dinh i5) số dạng chuỗi \"123\" vẫn đọc được", async () => {
    const d = await done(cuoi({ timings: { cache_n: "12", prompt_n: "2" } }));
    expect([d.cacheN, d.promptN]).toEqual([12, 2]);
  });

  it("(kiem-dinh i1) chunk đủ cặp rồi chunk sau chỉ MỘT nửa ⇒ giữ cặp cũ, không ghép nửa mới", async () => {
    const motNua = `data: ${JSON.stringify({ choices: [{ index: 0, delta: {} }], timings: { cache_n: 99 } })}\n\n`;
    const d = await done(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {} }], timings: { cache_n: 12, prompt_n: 2 } })}\n\n` + motNua + cuoi({}));
    expect([d.cacheN, d.promptN]).toEqual([12, 2]);
  });

  it("rác / âm / chỉ một nửa ⇒ không nhận (luôn đi cặp)", async () => {
    for (const t of [{ cache_n: -1, prompt_n: 2 }, { cache_n: "x", prompt_n: 2 }, { cache_n: 12 }, { prompt_n: 2 }]) {
      const d = await done(cuoi({ timings: t }));
      expect(["cacheN" in d, "promptN" in d], JSON.stringify(t)).toEqual([false, false]);
    }
    // cached_tokens > prompt_tokens là vô lý ⇒ không dựng promptN âm
    const d = await done(cuoi({ usage: { prompt_tokens: 5, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 9 } } }));
    expect("cacheN" in d).toBe(false);
  });
});
