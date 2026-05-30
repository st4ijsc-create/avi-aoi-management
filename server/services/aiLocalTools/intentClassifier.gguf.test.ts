/**
 * WS-G4 — intentClassifier GGUF-default path.
 *
 * Verifies classifyToolIntentLLM() uses the in-process GGUF engine
 * (generateJSON) by default and returns a validated ToolDecision.
 * aiGgufEngine is mocked so no model/daemon is required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// LLM_FALLBACK_ENABLED / USE_LEGACY_OLLAMA are captured at module load. ESM hoists
// `import` above plain statements, so the env MUST be set in a hoisted block to take
// effect before intentClassifier is evaluated.
vi.hoisted(() => {
  process.env.AI_TOOL_LLM_FALLBACK = "1";
  delete process.env.USE_LEGACY_OLLAMA; // default → GGUF
});

const generateJSON = vi.fn();
const isGgufAvailable = vi.fn();

vi.mock("../aiGgufEngine", () => ({
  generateJSON: (...args: unknown[]) => generateJSON(...args),
  isGgufAvailable: (...args: unknown[]) => isGgufAvailable(...args),
}));

import "./handlers"; // side-effect: registers built-in tools (get_today_stats, ...)
import { classifyToolIntentLLM } from "./intentClassifier";

beforeEach(() => {
  vi.clearAllMocks();
  isGgufAvailable.mockResolvedValue(true);
});

describe("classifyToolIntentLLM — GGUF default", () => {
  it("returns the tool label from grammar-constrained JSON (valid tool + args)", async () => {
    generateJSON.mockResolvedValue({ data: { tool: "get_today_stats", args: {} } });

    const decision = await classifyToolIntentLLM("Cho tôi xem chỉ số hôm nay");

    expect(generateJSON).toHaveBeenCalledTimes(1);
    expect(decision.tool).toBe("get_today_stats");
    expect(decision.reason).toBe("LLM_MATCH");
    expect(decision.args).toEqual({});
  });

  it("maps tool='none' → no tool (LLM_NONE)", async () => {
    generateJSON.mockResolvedValue({ data: { tool: "none", args: {} } });

    const decision = await classifyToolIntentLLM("kể chuyện cười cho tôi");
    expect(decision.tool).toBeNull();
    expect(decision.reason).toBe("LLM_NONE");
  });

  it("rejects an unknown tool name from the model", async () => {
    generateJSON.mockResolvedValue({ data: { tool: "made_up_tool", args: {} } });

    const decision = await classifyToolIntentLLM("một câu hỏi bất kỳ");
    expect(decision.tool).toBeNull();
    expect(decision.reason).toMatch(/^LLM_UNKNOWN_TOOL:/);
  });

  it("does not call Ollama HTTP when GGUF succeeds (no daemon needed)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    generateJSON.mockResolvedValue({ data: { tool: "get_today_stats", args: {} } });

    await classifyToolIntentLLM("hôm nay thế nào");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
