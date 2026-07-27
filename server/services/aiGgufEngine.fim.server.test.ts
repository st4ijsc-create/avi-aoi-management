/**
 * doc69 Wave 4 · C2 — Integration tests: aiGgufEngine.generateFim's server→in-process fallback
 * wiring against a MOCKED aiLlamaServerClient. No live llama-server / GPU required —
 * node-llama-cpp is also fully mocked (same scaffold as aiGgufEngine.llamaServerFallback.test.ts)
 * so the "in-process" FIM path (generateFimNative → node-llama-cpp's LlamaCompletion) really runs
 * and really returns an answer, proving the fallback is not just a theoretical catch block.
 *
 * TDD per the task brief (C2):
 *  - server-up (shouldUseServerForFim=true, preflight healthy, generate succeeds) → SERVER path
 *    used; in-process (LlamaCompletion / node-llama-cpp model load) never touched.
 *  - server-down (preflight unhealthy) → skips straight to IN-PROCESS generateFimNative; answer
 *    still returned; generateFimViaServer is never even called (fast fail, no hung POST).
 *  - server passes preflight but the generation call itself fails: still falls back to
 *    IN-PROCESS; answer still returned; same shape (GgufGenerateResult).
 *  - LLAMA_SERVER_STRICT=true + server down (preflight unhealthy) → THROWS instead of silently
 *    degrading, mirroring generateText's existing safety-valve behavior.
 *  - shouldUseServerForFim()=false (LLAMA_SERVER_ENABLED off, the default) → in-process path,
 *    byte-identical to before C2 — the client's FIM preflight/generate are never invoked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the llama-server client (fully controllable per test) ───────────
const shouldUseServerForTextMock = vi.fn<(...a: any[]) => boolean>(() => false);
const preflightHealthyMock = vi.fn<(...a: any[]) => Promise<boolean>>(async () => false);
const serverGenerateTextMock = vi.fn<(...a: any[]) => Promise<any>>();
const serverGenerateJSONMock = vi.fn<(...a: any[]) => Promise<any>>();
const shouldUseServerForFimMock = vi.fn<(...a: any[]) => boolean>();
const preflightHealthyForFimMock = vi.fn<(...a: any[]) => Promise<boolean>>();
const generateFimViaServerMock = vi.fn<(...a: any[]) => Promise<any>>();
const llamaServerStrictMock = vi.fn<() => boolean>(() => false);
const llamaServerEnabledMock = vi.fn<() => boolean>(() => false);
const llamaServerHealthyMock = vi.fn<(...a: any[]) => Promise<boolean>>(async () => false);

vi.mock("./aiLlamaServerClient", () => ({
  shouldUseServerForText: (...a: any[]) => shouldUseServerForTextMock(...a),
  preflightHealthy: (...a: any[]) => preflightHealthyMock(...a),
  serverGenerateText: (...a: any[]) => serverGenerateTextMock(...a),
  serverGenerateJSON: (...a: any[]) => serverGenerateJSONMock(...a),
  shouldUseServerForFim: (...a: any[]) => shouldUseServerForFimMock(...a),
  preflightHealthyForFim: (...a: any[]) => preflightHealthyForFimMock(...a),
  generateFimViaServer: (...a: any[]) => generateFimViaServerMock(...a),
  llamaServerStrict: (...a: any[]) => llamaServerStrictMock(...a),
  llamaServerEnabled: (...a: any[]) => llamaServerEnabledMock(...a),
  llamaServerHealthy: (...a: any[]) => llamaServerHealthyMock(...a),
}));

// ─── Mock aiModelRouter (only getThinkingTierStatus is consumed by getEngineHealth) ─
vi.mock("./aiModelRouter", () => ({
  getThinkingTierStatus: () => ({
    enabled: false,
    modelConfigured: false,
    fileExists: false,
    active: false,
    reason: "disabled",
  }),
}));

// ─── Mock node-llama-cpp so the in-process FIM path (generateFimNative) runs without a real
//     model/binary. Adds LlamaCompletion (native infill) alongside the existing chat-session fake
//     used by generateFimChatFallback (and generateText/generateJSON generally). ──────────────
const IN_PROCESS_FIM_ANSWER = "return a + b;";
const IN_PROCESS_CHAT_ANSWER = "in-process chat-fallback answer";
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
  async prompt(_p: string, _opts: any) {
    return IN_PROCESS_CHAT_ANSWER;
  }
}
class FakeCompletion {
  infillSupported = true;
  constructor(_opts: any) {}
  async generateInfillCompletion(_prefix: string, _suffix: string, _opts: any) {
    return IN_PROCESS_FIM_ANSWER;
  }
  async generateCompletion(_prefix: string, _opts: any) {
    return IN_PROCESS_FIM_ANSWER;
  }
  dispose() {}
}
vi.mock("node-llama-cpp", () => ({
  getLlama: vi.fn(async () => fakeLlama),
  LlamaChatSession: FakeChatSession,
  LlamaCompletion: FakeCompletion,
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
  process.env.GGUF_DEFAULT_MODEL = "qwen3-30b-a3b-instruct.gguf"; // fimModelBasename()'s final fallback
  shouldUseServerForTextMock.mockReturnValue(false);
  shouldUseServerForFimMock.mockReturnValue(false);
  llamaServerStrictMock.mockReturnValue(false);
  llamaServerEnabledMock.mockReturnValue(false);
});

async function freshEngine() {
  vi.resetModules();
  return await import("./aiGgufEngine");
}

describe("generateFim — server↔in-process fallback (doc69 C2)", () => {
  it("server-up: uses the SERVER path when shouldUseServerForFim + preflight are healthy, never touches in-process", async () => {
    shouldUseServerForFimMock.mockReturnValue(true);
    preflightHealthyForFimMock.mockResolvedValue(true);
    generateFimViaServerMock.mockResolvedValue({
      text: "server FIM answer",
      tokensGenerated: 5,
      tokensPrompt: 3,
      totalTimeMs: 42,
      tokensPerSecond: 100,
      modelId: "qwen3-coder-30b-a3b",
    });

    const eng = await freshEngine();
    const result = await eng.generateFim({ prefix: "function add(a, b) {\n  ", suffix: "\n}" });

    expect(result.text).toBe("server FIM answer");
    expect(generateFimViaServerMock).toHaveBeenCalledTimes(1);
    expect(fakeLlama.loadModel).not.toHaveBeenCalled(); // in-process never touched
  });

  it("passes prefix/suffix/options straight through to generateFimViaServer", async () => {
    shouldUseServerForFimMock.mockReturnValue(true);
    preflightHealthyForFimMock.mockResolvedValue(true);
    generateFimViaServerMock.mockResolvedValue({
      text: "x", tokensGenerated: 1, tokensPrompt: 1, totalTimeMs: 1, tokensPerSecond: 1, modelId: "m",
    });

    const eng = await freshEngine();
    await eng.generateFim({ prefix: "PREFIX", suffix: "SUFFIX", maxTokens: 64, temperature: 0.2 });

    expect(generateFimViaServerMock).toHaveBeenCalledWith(
      "PREFIX",
      "SUFFIX",
      expect.objectContaining({ prefix: "PREFIX", suffix: "SUFFIX", maxTokens: 64, temperature: 0.2 }),
    );
  });

  it("server-down (preflight unhealthy): falls back to IN-PROCESS native FIM fast, without calling generateFimViaServer, and still returns an answer of the SAME shape", async () => {
    shouldUseServerForFimMock.mockReturnValue(true);
    preflightHealthyForFimMock.mockResolvedValue(false);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const eng = await freshEngine();
    const result = await eng.generateFim({ prefix: "function add(a, b) {\n  ", suffix: "\n}" });

    expect(result.text).toBe(IN_PROCESS_FIM_ANSWER);
    expect(result).toEqual(
      expect.objectContaining({
        text: expect.any(String),
        tokensGenerated: expect.any(Number),
        tokensPrompt: expect.any(Number),
        totalTimeMs: expect.any(Number),
        tokensPerSecond: expect.any(Number),
        modelId: expect.any(String),
      }),
    );
    expect(generateFimViaServerMock).not.toHaveBeenCalled(); // fast fail, no hung POST attempted
    expect(fakeLlama.loadModel).toHaveBeenCalled(); // in-process actually ran
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/FIM preflight health check failed/));
    warnSpy.mockRestore();
  });

  it("server passes preflight but the generation call itself fails: still falls back to IN-PROCESS, answer still returned", async () => {
    shouldUseServerForFimMock.mockReturnValue(true);
    preflightHealthyForFimMock.mockResolvedValue(true);
    generateFimViaServerMock.mockRejectedValue(new Error("upstream FIM timed out"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const eng = await freshEngine();
    const result = await eng.generateFim({ prefix: "function add(a, b) {\n  ", suffix: "\n}" });

    expect(result.text).toBe(IN_PROCESS_FIM_ANSWER);
    expect(generateFimViaServerMock).toHaveBeenCalledTimes(1);
    expect(fakeLlama.loadModel).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/FIM generation failed, falling back in-process/));
    warnSpy.mockRestore();
  });

  it("LLAMA_SERVER_STRICT=true + server down (preflight unhealthy): THROWS instead of silently degrading", async () => {
    shouldUseServerForFimMock.mockReturnValue(true);
    preflightHealthyForFimMock.mockResolvedValue(false);
    llamaServerStrictMock.mockReturnValue(true);

    const eng = await freshEngine();
    await expect(eng.generateFim({ prefix: "a", suffix: "b" })).rejects.toThrow(/LLAMA_SERVER_STRICT/);
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
  });

  it("LLAMA_SERVER_STRICT=true + preflight healthy but generation fails: THROWS (does not fall back)", async () => {
    shouldUseServerForFimMock.mockReturnValue(true);
    preflightHealthyForFimMock.mockResolvedValue(true);
    generateFimViaServerMock.mockRejectedValue(new Error("upstream FIM timed out"));
    llamaServerStrictMock.mockReturnValue(true);

    const eng = await freshEngine();
    await expect(eng.generateFim({ prefix: "a", suffix: "b" })).rejects.toThrow(/upstream FIM timed out/);
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
  });

  it("LLAMA_SERVER_ENABLED off (shouldUseServerForFim=false, the default): in-process path, byte-identical — client FIM preflight/generate never invoked", async () => {
    shouldUseServerForFimMock.mockReturnValue(false);

    const eng = await freshEngine();
    const result = await eng.generateFim({ prefix: "function add(a, b) {\n  ", suffix: "\n}" });

    expect(result.text).toBe(IN_PROCESS_FIM_ANSWER);
    expect(preflightHealthyForFimMock).not.toHaveBeenCalled();
    expect(generateFimViaServerMock).not.toHaveBeenCalled();
    expect(fakeLlama.loadModel).toHaveBeenCalled();
  });
});
