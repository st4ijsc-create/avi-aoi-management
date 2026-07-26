/**
 * doc69 G2-6 — Integration tests: aiGgufEngine's server→in-process fallback wiring
 * (generateText / generateJSON) against a MOCKED aiLlamaServerClient. No live llama-server / GPU
 * required — node-llama-cpp is also fully mocked (same scaffold as aiGgufEngine.test.ts) so the
 * "in-process" path really runs and really returns an answer, proving the fallback is not just a
 * theoretical catch block.
 *
 * TDD per the task brief:
 *  - server-up (shouldUseServerForText=true, preflight healthy, generate succeeds) → SERVER path
 *    used; in-process (node-llama-cpp) never touched.
 *  - server-down (preflight unhealthy) → skips straight to IN-PROCESS; answer still returned;
 *    the server's generate function is never even called (fast fail, no waiting on a hung POST).
 *  - server passes preflight but the generation call itself fails/times out → still falls back
 *    to IN-PROCESS; answer still returned.
 *  - LLAMA_SERVER_STRICT=true + server down → THROWS instead of silently degrading (existing
 *    safety-valve behaviour, confirmed unchanged).
 *  - shouldUseServerForText()=false (LLAMA_SERVER_ENABLED off, the default) → in-process path,
 *    byte-identical to before this task — the client's preflight/generate are never invoked.
 *  - getEngineHealth() surfaces thinkingTier + llamaServer status fields.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the llama-server client (fully controllable per test) ───────────
const shouldUseServerForTextMock = vi.fn<(...a: any[]) => boolean>();
const preflightHealthyMock = vi.fn<(...a: any[]) => Promise<boolean>>();
const serverGenerateTextMock = vi.fn<(...a: any[]) => Promise<any>>();
const serverGenerateJSONMock = vi.fn<(...a: any[]) => Promise<any>>();
const llamaServerStrictMock = vi.fn<() => boolean>(() => false);
const llamaServerEnabledMock = vi.fn<() => boolean>(() => false);
const llamaServerHealthyMock = vi.fn<(...a: any[]) => Promise<boolean>>(async () => false);

vi.mock("./aiLlamaServerClient", () => ({
  shouldUseServerForText: (...a: any[]) => shouldUseServerForTextMock(...a),
  preflightHealthy: (...a: any[]) => preflightHealthyMock(...a),
  serverGenerateText: (...a: any[]) => serverGenerateTextMock(...a),
  serverGenerateJSON: (...a: any[]) => serverGenerateJSONMock(...a),
  llamaServerStrict: (...a: any[]) => llamaServerStrictMock(...a),
  llamaServerEnabled: (...a: any[]) => llamaServerEnabledMock(...a),
  llamaServerHealthy: (...a: any[]) => llamaServerHealthyMock(...a),
}));

// ─── Mock aiModelRouter (only getThinkingTierStatus is consumed by getEngineHealth) ─
const getThinkingTierStatusMock = vi.fn(() => ({
  enabled: false,
  modelConfigured: false,
  fileExists: false,
  active: false,
  reason: "disabled (AI_THINKING_TIER_ENABLED is off) — hard rca/report use the default deep model",
}));
vi.mock("./aiModelRouter", () => ({
  getThinkingTierStatus: (...a: any[]) => getThinkingTierStatusMock(...a),
}));

// ─── Mock node-llama-cpp so the in-process path runs without a real model/binary ──
const IN_PROCESS_ANSWER = "in-process answer";
function makeFakeModel() {
  return {
    size: 1234,
    tokenize: (t: string) => t.split(" "),
    createContext: vi.fn(async () => ({
      getSequence: () => ({ dispose: vi.fn() }),
      dispose: vi.fn(),
    })),
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

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  process.env.GGUF_MAX_LOADED_MODELS = "2";
  process.env.GGUF_DEFAULT_MODEL = "qwen3-30b-a3b-instruct.gguf"; // in-process path needs a default model to auto-load
  shouldUseServerForTextMock.mockReturnValue(false);
  llamaServerStrictMock.mockReturnValue(false);
  llamaServerEnabledMock.mockReturnValue(false);
});

async function freshEngine() {
  vi.resetModules();
  return await import("./aiGgufEngine");
}

describe("generateText — server↔in-process fallback", () => {
  it("server-up: uses the SERVER path when healthy, never touches in-process", async () => {
    shouldUseServerForTextMock.mockReturnValue(true);
    preflightHealthyMock.mockResolvedValue(true);
    serverGenerateTextMock.mockResolvedValue({
      text: "server answer",
      tokensGenerated: 5,
      tokensPrompt: 3,
      totalTimeMs: 42,
      tokensPerSecond: 100,
      modelId: "qwen3-30b-a3b-instruct",
    });

    const eng = await freshEngine();
    const result = await eng.generateText({ prompt: "hi" });

    expect(result.text).toBe("server answer");
    expect(serverGenerateTextMock).toHaveBeenCalledTimes(1);
    expect(fakeLlama.loadModel).not.toHaveBeenCalled(); // in-process never touched
  });

  it("server-down (preflight unhealthy): falls back to IN-PROCESS fast, without ever calling serverGenerateText, and still returns an answer", async () => {
    shouldUseServerForTextMock.mockReturnValue(true);
    preflightHealthyMock.mockResolvedValue(false);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const eng = await freshEngine();
    const result = await eng.generateText({ prompt: "hi" });

    expect(result.text).toBe(IN_PROCESS_ANSWER);
    expect(serverGenerateTextMock).not.toHaveBeenCalled(); // fast fail, no hung POST attempted
    expect(fakeLlama.loadModel).toHaveBeenCalled(); // in-process actually ran
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/preflight health check failed/));
    warnSpy.mockRestore();
  });

  it("server passes preflight but the generation call itself fails/times out: still falls back to IN-PROCESS, answer still returned", async () => {
    shouldUseServerForTextMock.mockReturnValue(true);
    preflightHealthyMock.mockResolvedValue(true);
    serverGenerateTextMock.mockRejectedValue(new Error("upstream timed out"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const eng = await freshEngine();
    const result = await eng.generateText({ prompt: "hi" });

    expect(result.text).toBe(IN_PROCESS_ANSWER);
    expect(serverGenerateTextMock).toHaveBeenCalledTimes(1);
    expect(fakeLlama.loadModel).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/generation failed, falling back in-process/));
    warnSpy.mockRestore();
  });

  it("LLAMA_SERVER_STRICT=true + server down: THROWS instead of silently degrading (existing safety valve, unchanged)", async () => {
    shouldUseServerForTextMock.mockReturnValue(true);
    preflightHealthyMock.mockResolvedValue(false);
    llamaServerStrictMock.mockReturnValue(true);

    const eng = await freshEngine();
    await expect(eng.generateText({ prompt: "hi" })).rejects.toThrow(/LLAMA_SERVER_STRICT/);
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
  });

  it("LLAMA_SERVER_ENABLED off (shouldUseServerForText=false, the default): in-process path, byte-identical — client preflight/generate never invoked", async () => {
    shouldUseServerForTextMock.mockReturnValue(false);

    const eng = await freshEngine();
    const result = await eng.generateText({ prompt: "hi" });

    expect(result.text).toBe(IN_PROCESS_ANSWER);
    expect(preflightHealthyMock).not.toHaveBeenCalled();
    expect(serverGenerateTextMock).not.toHaveBeenCalled();
    expect(fakeLlama.loadModel).toHaveBeenCalled();
  });
});

describe("generateJSON — server↔in-process fallback", () => {
  const schema = { type: "object", properties: { ok: { type: "boolean" } } };

  it("server-up: uses the SERVER path for schema-constrained JSON", async () => {
    shouldUseServerForTextMock.mockReturnValue(true);
    preflightHealthyMock.mockResolvedValue(true);
    serverGenerateJSONMock.mockResolvedValue({
      data: { ok: true },
      raw: '{"ok":true}',
      tokensGenerated: 2,
      tokensPrompt: 2,
      totalTimeMs: 10,
      tokensPerSecond: 200,
      modelId: "qwen3-30b-a3b-instruct",
    });

    const eng = await freshEngine();
    const result = await eng.generateJSON(schema, { prompt: "hi" });
    expect(result.data).toEqual({ ok: true });
    expect(serverGenerateJSONMock).toHaveBeenCalledTimes(1);
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
  });

  it("server-down: falls back to IN-PROCESS GBNF-constrained generation, answer still returned", async () => {
    shouldUseServerForTextMock.mockReturnValue(true);
    preflightHealthyMock.mockResolvedValue(false);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const eng = await freshEngine();
    const result = await eng.generateJSON(schema, { prompt: "hi" });

    expect(result.data).toEqual({ ok: true }); // FakeChatSession returns {"ok":true} under grammar
    expect(serverGenerateJSONMock).not.toHaveBeenCalled();
    expect(fakeLlama.createGrammarForJsonSchema).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("LLAMA_SERVER_ENABLED off: in-process unchanged, client never invoked", async () => {
    shouldUseServerForTextMock.mockReturnValue(false);
    const eng = await freshEngine();
    const result = await eng.generateJSON(schema, { prompt: "hi" });
    expect(result.data).toEqual({ ok: true });
    expect(preflightHealthyMock).not.toHaveBeenCalled();
    expect(serverGenerateJSONMock).not.toHaveBeenCalled();
  });
});

describe("getEngineHealth — thinkingTier + llamaServer honesty surface", () => {
  it("reports llamaServer.healthy as null (not probed) when the server is disabled — zero-cost no-op for the default OFF state", async () => {
    llamaServerEnabledMock.mockReturnValue(false);
    const eng = await freshEngine();
    const health = await eng.getEngineHealth();
    expect(health.llamaServer.enabled).toBe(false);
    expect(health.llamaServer.healthy).toBeNull();
    expect(llamaServerHealthyMock).not.toHaveBeenCalled();
  });

  it("probes and reports llamaServer.healthy when the server is enabled", async () => {
    llamaServerEnabledMock.mockReturnValue(true);
    llamaServerStrictMock.mockReturnValue(true);
    llamaServerHealthyMock.mockResolvedValue(true);
    const eng = await freshEngine();
    const health = await eng.getEngineHealth();
    expect(health.llamaServer).toEqual({ enabled: true, strict: true, healthy: true });
    expect(llamaServerHealthyMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces the thinking-tier status from aiModelRouter.getThinkingTierStatus() verbatim", async () => {
    getThinkingTierStatusMock.mockReturnValue({
      enabled: true,
      modelConfigured: false,
      fileExists: false,
      active: false,
      reason: "AI_THINKING_TIER_ENABLED is on but GGUF_THINKING_MODEL is unset — inactive, falling back to the default deep model",
    });
    const eng = await freshEngine();
    const health = await eng.getEngineHealth();
    expect(health.thinkingTier.enabled).toBe(true);
    expect(health.thinkingTier.active).toBe(false);
    expect(health.thinkingTier.reason).toMatch(/unset/i);
  });
});
