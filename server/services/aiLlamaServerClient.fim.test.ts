/**
 * doc69 Wave 4 · C2 — Unit tests for the FIM-over-persistent-server addition to
 * server/services/aiLlamaServerClient.ts (shouldUseServerForFim / preflightHealthyForFim /
 * generateFimViaServer). No live llama-server / GPU required: `global.fetch` is fully mocked.
 *
 * Companion to aiLlamaServerClient.test.ts (the pre-existing TEXT-path tests, untouched) and
 * aiGgufEngine.fim.server.test.ts (the engine-side generateFim routing/fallback tests, mocking
 * this module).
 *
 * Covers:
 *  - shouldUseServerForFim(): disabled by default; requires LLAMA_SERVER_ENABLED=true AND a
 *    resolvable URL; shared-server shape requires a served-model match (mirrors
 *    shouldUseServerForText); dedicated LLAMA_FIM_SERVER_URL shape skips the match.
 *  - preflightHealthyForFim(): probes the dedicated FIM URL when set, else the shared
 *    LLAMA_SERVER_URL — never throws.
 *  - generateFimViaServer(): builds the correct POST /infill request (input_prefix/input_suffix/
 *    n_predict/…), maps a successful response into GgufGenerateResult; throws (never silently
 *    swallows) on HTTP error / empty completion — caller decides fallback.
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
  delete process.env.LLAMA_FIM_SERVER_URL;
  delete process.env.LLAMA_SERVER_STRICT;
  delete process.env.LLAMA_SERVER_API_KEY;
  delete process.env.LLAMA_SERVER_TIMEOUT_MS;
  delete process.env.LLAMA_SERVER_HEALTH_TIMEOUT_MS;
  delete process.env.LLAMA_SERVER_MODEL;
  delete process.env.GGUF_FIM_MODEL;
  delete process.env.GGUF_FAST_MODEL;
  delete process.env.GGUF_CODE_MODEL;
  process.env.GGUF_DEFAULT_MODEL = "qwen3-30b-a3b-instruct.gguf";
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

describe("shouldUseServerForFim", () => {
  it("is disabled by default (no env set) — same safety baseline as text", async () => {
    const c = await freshClient();
    expect(c.shouldUseServerForFim()).toBe(false);
  });

  it("requires BOTH LLAMA_SERVER_ENABLED=true AND a resolvable URL (LLAMA_SERVER_URL or LLAMA_FIM_SERVER_URL)", async () => {
    process.env.LLAMA_SERVER_ENABLED = "true";
    // No URL of either kind set.
    let c = await freshClient();
    expect(c.shouldUseServerForFim()).toBe(false);

    vi.resetModules();
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8080";
    delete process.env.LLAMA_SERVER_ENABLED; // flag off
    c = await freshClient();
    expect(c.shouldUseServerForFim()).toBe(false);
  });

  it("shared-server shape: routes only when the requested FIM model matches LLAMA_SERVER_MODEL (mirrors shouldUseServerForText)", async () => {
    process.env.LLAMA_SERVER_ENABLED = "true";
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8080";
    process.env.LLAMA_SERVER_MODEL = "qwen3-coder-30b-a3b.gguf";
    const c = await freshClient();

    expect(c.shouldUseServerForFim("qwen3-coder-30b-a3b")).toBe(true);
    // A different model (e.g. the deep/vision tier) must NOT be routed to this FIM-shared server.
    expect(c.shouldUseServerForFim("qwen3-4b-instruct")).toBe(false);
  });

  it("shared-server shape: undefined modelId resolves via the SAME chain as fimModelBasename() (GGUF_FIM_MODEL → FAST → DEFAULT)", async () => {
    process.env.LLAMA_SERVER_ENABLED = "true";
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8080";
    process.env.GGUF_FIM_MODEL = "qwen3-coder-fim.gguf";
    process.env.LLAMA_SERVER_MODEL = "qwen3-coder-fim.gguf";
    const c = await freshClient();
    expect(c.shouldUseServerForFim()).toBe(true);

    vi.resetModules();
    // Now LLAMA_SERVER_MODEL points at something else — no match, must not route.
    process.env.LLAMA_SERVER_MODEL = "some-other-model.gguf";
    const c2 = await freshClient();
    expect(c2.shouldUseServerForFim()).toBe(false);
  });

  it("dedicated FIM server (LLAMA_FIM_SERVER_URL set): routes whenever enabled + reachable, WITHOUT a served-model match", async () => {
    process.env.LLAMA_SERVER_ENABLED = "true";
    process.env.LLAMA_FIM_SERVER_URL = "http://127.0.0.1:9090";
    // No LLAMA_SERVER_MODEL / LLAMA_SERVER_URL at all — dedicated shape doesn't need them.
    const c = await freshClient();
    expect(c.shouldUseServerForFim("anything-goes")).toBe(true);
    expect(c.shouldUseServerForFim()).toBe(true);
  });

  it("LLAMA_FIM_SERVER_URL takes priority over LLAMA_SERVER_URL when both are set", async () => {
    process.env.LLAMA_SERVER_ENABLED = "true";
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8080";
    process.env.LLAMA_SERVER_MODEL = "qwen3-30b-a3b-instruct.gguf"; // would NOT match a FIM request
    process.env.LLAMA_FIM_SERVER_URL = "http://127.0.0.1:9090"; // dedicated — no match needed
    const c = await freshClient();
    expect(c.shouldUseServerForFim("qwen3-coder-30b-a3b")).toBe(true);
  });
});

describe("preflightHealthyForFim", () => {
  it("returns false immediately when no FIM/shared URL is configured (no network call)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const c = await freshClient();
    await expect(c.preflightHealthyForFim()).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("probes the DEDICATED LLAMA_FIM_SERVER_URL when set (not LLAMA_SERVER_URL)", async () => {
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8080";
    process.env.LLAMA_FIM_SERVER_URL = "http://127.0.0.1:9090";
    const fetchSpy = vi.fn(async (url: string) => {
      expect(String(url)).toContain("127.0.0.1:9090");
      expect(String(url)).toContain("/health");
      return { ok: true } as Response;
    });
    vi.stubGlobal("fetch", fetchSpy);
    const c = await freshClient();
    await expect(c.preflightHealthyForFim()).resolves.toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to the SHARED LLAMA_SERVER_URL when no dedicated FIM URL is set", async () => {
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8080";
    const fetchSpy = vi.fn(async (url: string) => {
      expect(String(url)).toContain("127.0.0.1:8080");
      return { ok: true } as Response;
    });
    vi.stubGlobal("fetch", fetchSpy);
    const c = await freshClient();
    await expect(c.preflightHealthyForFim()).resolves.toBe(true);
  });

  it("never throws — unreachable server resolves false", async () => {
    process.env.LLAMA_FIM_SERVER_URL = "http://127.0.0.1:9090";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const c = await freshClient();
    await expect(c.preflightHealthyForFim()).resolves.toBe(false);
  });
});

describe("generateFimViaServer", () => {
  const opts = () => ({ prefix: "function add(a, b) {\n  ", suffix: "\n}", maxTokens: 32 });

  it("POSTs the correct /infill request (input_prefix/input_suffix/n_predict) and maps a successful response", async () => {
    process.env.LLAMA_FIM_SERVER_URL = "http://127.0.0.1:9090";
    const fetchSpy = vi.fn(async (url: string, init: any) => {
      expect(String(url)).toBe("http://127.0.0.1:9090/infill");
      const body = JSON.parse(init.body);
      expect(body.input_prefix).toBe("function add(a, b) {\n  ");
      expect(body.input_suffix).toBe("\n}");
      expect(body.n_predict).toBe(32);
      expect(body.stream).toBe(false);
      return {
        ok: true,
        json: async () => ({
          content: "return a + b;",
          tokens_predicted: 6,
          tokens_evaluated: 12,
        }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchSpy);
    const c = await freshClient();
    const result = await c.generateFimViaServer("function add(a, b) {\n  ", "\n}", opts());
    expect(result.text).toBe("return a + b;");
    expect(result.tokensGenerated).toBe(6);
    expect(result.tokensPrompt).toBe(12);
    expect(typeof result.totalTimeMs).toBe("number");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("includes stop sequences and top_k when provided", async () => {
    process.env.LLAMA_FIM_SERVER_URL = "http://127.0.0.1:9090";
    const fetchSpy = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      expect(body.stop).toEqual(["\n\n"]);
      expect(body.top_k).toBe(40);
      return { ok: true, json: async () => ({ content: "x", tokens_predicted: 1, tokens_evaluated: 1 }) } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchSpy);
    const c = await freshClient();
    await c.generateFimViaServer("a", "b", { prefix: "a", suffix: "b", stopSequences: ["\n\n"], topK: 40 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws a clear error on a non-ok HTTP response — caller decides fallback (never silently swallowed)", async () => {
    process.env.LLAMA_FIM_SERVER_URL = "http://127.0.0.1:9090";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => "model not loaded",
    }) as unknown as Response));
    const c = await freshClient();
    await expect(c.generateFimViaServer("a", "b", opts())).rejects.toThrow(/FIM HTTP 503/);
  });

  it("throws on a connection error (server down) — caller decides fallback", async () => {
    process.env.LLAMA_FIM_SERVER_URL = "http://127.0.0.1:9090";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const c = await freshClient();
    await expect(c.generateFimViaServer("a", "b", opts())).rejects.toThrow(/ECONNREFUSED/);
  });

  it("throws on an empty completion", async () => {
    process.env.LLAMA_FIM_SERVER_URL = "http://127.0.0.1:9090";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ content: "" }),
    }) as unknown as Response));
    const c = await freshClient();
    await expect(c.generateFimViaServer("a", "b", opts())).rejects.toThrow(/empty FIM completion/);
  });

  it("throws when neither LLAMA_FIM_SERVER_URL nor LLAMA_SERVER_URL is configured", async () => {
    const c = await freshClient();
    await expect(c.generateFimViaServer("a", "b", opts())).rejects.toThrow(/no FIM server URL configured/);
  });
});
