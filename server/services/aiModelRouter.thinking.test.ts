/**
 * B6.2 — Thinking/reasoning tier wiring tests for aiModelRouter + the <think>-stripping helper.
 *
 * Covers:
 *  - When AI_THINKING_TIER_ENABLED on + GGUF_THINKING_MODEL set + file exists:
 *      hardest rca/report routes to the Thinking model (decision.thinking === true).
 *  - When the flag is OFF (default): routes to GGUF_DEFAULT_MODEL (byte-identical to legacy).
 *  - When the flag is on but the model file is MISSING: falls back to the default deep model
 *    (fail-safe, no throw).
 *  - Only hard rca/report qualify — hard chat / medium rca do NOT escalate.
 *  - stripThinking() removes well-formed, unclosed, and stray-close <think> blocks.
 *
 * aiGgufEngine.ggufModelFileExists is mocked so no real GGUF file / native binary is needed.
 * stripThinking is the REAL implementation (pure) via importActual.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Control whether the thinking-model "file" exists on disk.
let FILE_EXISTS = true;

vi.mock("./aiGgufEngine", async () => {
  const actual = await vi.importActual<typeof import("./aiGgufEngine")>("./aiGgufEngine");
  return {
    // Keep the real, pure stripThinking implementation under test.
    stripThinking: actual.stripThinking,
    // Stub the fs-backed existence check.
    ggufModelFileExists: vi.fn(() => FILE_EXISTS),
  };
});

// Re-import the router fresh each test so module-level "warned once" state resets.
async function freshRouter() {
  vi.resetModules();
  return await import("./aiModelRouter");
}

beforeEach(() => {
  FILE_EXISTS = true;
  process.env.GGUF_DEFAULT_MODEL = "qwen3-30b-a3b-instruct";
  delete process.env.GGUF_THINKING_MODEL;
  delete process.env.AI_THINKING_TIER_ENABLED;
});

describe("thinking-tier routing", () => {
  it("routes hard rca to the Thinking model when flag+model set and file exists", async () => {
    process.env.AI_THINKING_TIER_ENABLED = "true";
    process.env.GGUF_THINKING_MODEL = "qwen3-30b-a3b-thinking";
    const { route } = await freshRouter();
    const d = route({ task: "rca", requiredQuality: "high" }); // rca/high → hard
    expect(d.thinking).toBe(true);
    expect(d.modelId).toBe("qwen3-30b-a3b-thinking");
    expect(d.tier).toBe(2);
  });

  it("routes hard report to the Thinking model too", async () => {
    process.env.AI_THINKING_TIER_ENABLED = "1";
    process.env.GGUF_THINKING_MODEL = "thinker.gguf"; // .gguf suffix is stripped
    const { route } = await freshRouter();
    const d = route({ task: "report" });
    expect(d.thinking).toBe(true);
    expect(d.modelId).toBe("thinker");
  });

  it("falls back to default deep model when the flag is OFF (legacy behaviour)", async () => {
    process.env.GGUF_THINKING_MODEL = "qwen3-30b-a3b-thinking"; // set but master switch off
    const { route } = await freshRouter();
    const d = route({ task: "rca", requiredQuality: "high" });
    expect(d.thinking).toBeFalsy();
    expect(d.modelId).toBe("qwen3-30b-a3b-instruct");
  });

  it("falls back to default deep model when GGUF_THINKING_MODEL is unset", async () => {
    process.env.AI_THINKING_TIER_ENABLED = "true";
    const { route } = await freshRouter();
    const d = route({ task: "rca", requiredQuality: "high" });
    expect(d.thinking).toBeFalsy();
    expect(d.modelId).toBe("qwen3-30b-a3b-instruct");
  });

  it("fail-safe: falls back (no throw) when the thinking model file is MISSING", async () => {
    FILE_EXISTS = false;
    process.env.AI_THINKING_TIER_ENABLED = "true";
    process.env.GGUF_THINKING_MODEL = "does-not-exist";
    const { route } = await freshRouter();
    const d = route({ task: "rca", requiredQuality: "high" });
    expect(d.thinking).toBeFalsy();
    expect(d.modelId).toBe("qwen3-30b-a3b-instruct");
  });

  it("does NOT escalate non-qualifying hard tasks (e.g. hard chat) to the Thinking model", async () => {
    process.env.AI_THINKING_TIER_ENABLED = "true";
    process.env.GGUF_THINKING_MODEL = "qwen3-30b-a3b-thinking";
    const { route } = await freshRouter();
    // A long multistep chat is "hard" but chat ∉ {rca, report} → stays on the deep instruct model.
    const longMultistep = "Compare and analyze step by step ".repeat(40);
    const d = route({ task: "chat", text: longMultistep });
    expect(d.thinking).toBeFalsy();
    expect(d.modelId).toBe("qwen3-30b-a3b-instruct");
  });

  it("does NOT escalate medium rca (only hard qualifies)", async () => {
    process.env.AI_THINKING_TIER_ENABLED = "true";
    process.env.GGUF_THINKING_MODEL = "qwen3-30b-a3b-thinking";
    const { route } = await freshRouter();
    // rca with requiredQuality "low" → medium, not hard.
    const d = route({ task: "rca", requiredQuality: "low" });
    expect(d.thinking).toBeFalsy();
    expect(d.modelId).toBe("qwen3-30b-a3b-instruct");
  });
});

describe("stripThinking helper", () => {
  it("removes a well-formed <think>…</think> block and returns the clean answer", async () => {
    const { stripThinking } = await import("./aiGgufEngine");
    const out = stripThinking("<think>let me reason about X</think>The answer is 42.");
    expect(out.answer).toBe("The answer is 42.");
    expect(out.thinking).toContain("reason about X");
  });

  it("removes multiple think blocks", async () => {
    const { stripThinking } = await import("./aiGgufEngine");
    const out = stripThinking("<think>a</think>Part1 <think>b</think>Part2");
    expect(out.answer).toBe("Part1 Part2");
    expect(out.thinking).toContain("a");
    expect(out.thinking).toContain("b");
  });

  it("handles an UNCLOSED <think> (truncated output) by dropping to end", async () => {
    const { stripThinking } = await import("./aiGgufEngine");
    const out = stripThinking("Visible answer.\n<think>reasoning that got cut off");
    expect(out.answer).toBe("Visible answer.");
    expect(out.thinking).toContain("cut off");
  });

  it("handles a stray leading </think> with no opening tag", async () => {
    const { stripThinking } = await import("./aiGgufEngine");
    const out = stripThinking("hidden reasoning</think>Final answer here.");
    expect(out.answer).toBe("Final answer here.");
    expect(out.thinking).toContain("hidden reasoning");
  });

  it("is a no-op for plain text without think tags", async () => {
    const { stripThinking } = await import("./aiGgufEngine");
    const out = stripThinking("just a normal answer");
    expect(out.answer).toBe("just a normal answer");
    expect(out.thinking).toBe("");
  });

  it("fail-safe: keeps the original when stripping would leave an empty answer", async () => {
    const { stripThinking } = await import("./aiGgufEngine");
    const out = stripThinking("<think>only reasoning, no answer</think>");
    expect(out.answer).toBe("<think>only reasoning, no answer</think>");
  });
});
