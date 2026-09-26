/**
 * doc69 G2-6 — Unit tests for the persistent llama-server client (server/services/aiLlamaServerClient.ts).
 * No live llama-server / GPU required: `global.fetch` is fully mocked.
 *
 * Covers:
 *  - llamaServerEnabled() / shouldUseServerForText() gating (URL required, model-basename match).
 *  - llamaServerHealthy(): /health ok → true; /health fails → falls back to /v1/models; both
 *    fail (or time out) → false. Never throws.
 *  - preflightHealthy(): wraps llamaServerHealthy() with the SHORT LLAMA_SERVER_HEALTH_TIMEOUT_MS
 *    (default 2s) instead of the long generation timeout — a genuine real-timer test proves the
 *    short timeout actually aborts quickly.
 *  - serverGenerateText()/serverGenerateJSON(): success maps the OpenAI-shaped response correctly;
 *    HTTP error / empty completion / invalid JSON all throw a clear error (caller decides fallback).
 *
 * The engine-side fallback decision (server-up → server path; server-down/timeout → in-process;
 * LLAMA_SERVER_ENABLED off → in-process unchanged) is covered separately in
 * aiGgufEngine.llamaServerFallback.test.ts (mocks this module + node-llama-cpp).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

async function freshClient() {
  vi.resetModules();
  return await import("./aiLlamaServerClient");
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.LLAMA_SERVER_ENABLED;
  delete process.env.LLAMA_SERVER_URL;
  delete process.env.LLAMA_SERVER_STRICT;
  delete process.env.LLAMA_SERVER_API_KEY;
  delete process.env.LLAMA_SERVER_TIMEOUT_MS;
  delete process.env.LLAMA_SERVER_HEALTH_TIMEOUT_MS;
  delete process.env.LLAMA_SERVER_MODEL;
  process.env.GGUF_DEFAULT_MODEL = "qwen3-30b-a3b-instruct.gguf";
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

describe("llamaServerEnabled / shouldUseServerForText", () => {
  it("is disabled by default (no env set) — the safety baseline for everyone today", async () => {
    const c = await freshClient();
    expect(c.llamaServerEnabled()).toBe(false);
    expect(c.shouldUseServerForText()).toBe(false);
  });

  it("requires BOTH LLAMA_SERVER_ENABLED=true AND a non-empty LLAMA_SERVER_URL", async () => {
    process.env.LLAMA_SERVER_ENABLED = "true";
    // URL still unset.
    let c = await freshClient();
    expect(c.llamaServerEnabled()).toBe(false);

    vi.resetModules();
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8080";
    // Flag still unset.
    delete process.env.LLAMA_SERVER_ENABLED;
    c = await freshClient();
    expect(c.llamaServerEnabled()).toBe(false);

    vi.resetModules();
    process.env.LLAMA_SERVER_ENABLED = "true";
    c = await freshClient();
    expect(c.llamaServerEnabled()).toBe(true);
  });

  it("routes text generation only when the requested model matches the model the server serves", async () => {
    process.env.LLAMA_SERVER_ENABLED = "true";
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8080";
    process.env.LLAMA_SERVER_MODEL = "qwen3-30b-a3b-instruct.gguf";
    const c = await freshClient();

    // undefined modelId → "the deep default", which the server serves.
    expect(c.shouldUseServerForText()).toBe(true);
    expect(c.shouldUseServerForText("qwen3-30b-a3b-instruct")).toBe(true);
    // A different model (e.g. the fast/vision tier) must NOT be routed to this server.
    expect(c.shouldUseServerForText("qwen3-4b-instruct")).toBe(false);
  });
});

describe("llamaServerHealthy", () => {
  it("returns false immediately when LLAMA_SERVER_URL is unset (no network call)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const c = await freshClient();
    await expect(c.llamaServerHealthy()).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns true when /health responds ok", async () => {
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8080";
    const fetchSpy = vi.fn(async (url: string) => {
      expect(String(url)).toContain("/health");
      return { ok: true } as Response;
    });
    vi.stubGlobal("fetch", fetchSpy);
    const c = await freshClient();
    await expect(c.llamaServerHealthy()).resolves.toBe(true);
  });

  it("falls back to /v1/models when /health fails, and reports healthy if that succeeds", async () => {
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8080";
    const fetchSpy = vi.fn(async (url: string) => {
      if (String(url).includes("/health")) throw new Error("ECONNREFUSED");
      expect(String(url)).toContain("/v1/models");
      return { ok: true } as Response;
    });
    vi.stubGlobal("fetch", fetchSpy);
    const c = await freshClient();
    await expect(c.llamaServerHealthy()).resolves.toBe(true);
  });

  it("returns false (never throws) when both /health and /v1/models are unreachable", async () => {
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8080";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const c = await freshClient();
    await expect(c.llamaServerHealthy()).resolves.toBe(false);
  });
});

describe("preflightHealthy — short-timeout pre-generation probe (doc69 G2-6 robustness)", () => {
  it("uses LLAMA_SERVER_HEALTH_TIMEOUT_MS (short) rather than the long generation timeout — a hung server is detected fast", async () => {
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8080";
    process.env.LLAMA_SERVER_HEALTH_TIMEOUT_MS = "30"; // deliberately tiny, real timer
    process.env.LLAMA_SERVER_TIMEOUT_MS = "120000"; // the (irrelevant here) long generation timeout

    // Simulate a hung connection: fetch never resolves/rejects on its own — only the
    // AbortController's signal should end it. Mirrors real `fetch` semantics: an
    // ALREADY-aborted signal rejects immediately (matters for the /health → /v1/models
    // fallback, which now shares one AbortController/timer across both attempts).
    vi.stubGlobal("fetch", vi.fn((_url: string, opts?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        if (opts?.signal?.aborted) abort();
        else opts?.signal?.addEventListener("abort", abort);
      });
    }));

    const c = await freshClient();
    const start = Date.now();
    const healthy = await c.preflightHealthy();
    const elapsedMs = Date.now() - start;

    expect(healthy).toBe(false);
    // Generous upper bound so this isn't flaky on a loaded CI box, but proves it did NOT wait
    // anywhere near the 120s generation timeout.
    expect(elapsedMs).toBeLessThan(2000);
  }, 10_000);

  it("reports healthy quickly when the server responds", async () => {
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8080";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true }) as Response));
    const c = await freshClient();
    await expect(c.preflightHealthy()).resolves.toBe(true);
  });
});

describe("serverGenerateText", () => {
  const opts = () => ({ prompt: "hello", maxTokens: 64 });

  it("maps a successful OpenAI-shaped completion into GgufGenerateResult", async () => {
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8080";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
      expect(String(url)).toContain("/v1/chat/completions");
      const body = JSON.parse(init.body);
      expect(body.messages[0].content).toBe("hello");
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "The answer is 42." } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      } as unknown as Response;
    }));
    const c = await freshClient();
    const result = await c.serverGenerateText(opts());
    expect(result.text).toBe("The answer is 42.");
    expect(result.tokensPrompt).toBe(10);
    expect(result.tokensGenerated).toBe(5);
    expect(typeof result.totalTimeMs).toBe("number");
  });

  it("throws a clear error on a non-ok HTTP response (caller decides fallback)", async () => {
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8080";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => "model not loaded",
    }) as unknown as Response));
    const c = await freshClient();
    await expect(c.serverGenerateText(opts())).rejects.toThrow(/HTTP 503/);
  });

  it("throws on a connection error (server down) — caller decides fallback", async () => {
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8080";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const c = await freshClient();
    await expect(c.serverGenerateText(opts())).rejects.toThrow(/ECONNREFUSED/);
  });

  it("throws on an empty completion", async () => {
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8080";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "" } }] }),
    }) as unknown as Response));
    const c = await freshClient();
    await expect(c.serverGenerateText(opts())).rejects.toThrow(/empty completion/);
  });
});

describe("serverGenerateJSON", () => {
  it("parses a valid JSON completion", async () => {
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8080";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"summary":"ok"}' } }],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      }),
    }) as unknown as Response));
    const c = await freshClient();
    const result = await c.serverGenerateJSON<{ summary: string }>({ type: "object" }, { prompt: "x" });
    expect(result.data.summary).toBe("ok");
  });

  it("throws a clear error when the server returns invalid JSON", async () => {
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8080";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "not json" } }] }),
    }) as unknown as Response));
    const c = await freshClient();
    await expect(c.serverGenerateJSON({ type: "object" }, { prompt: "x" })).rejects.toThrow(/invalid JSON/);
  });
});
