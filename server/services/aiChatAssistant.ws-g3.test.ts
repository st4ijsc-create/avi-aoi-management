/**
 * WS-G3 — processChat ordering + offline fallback (no cloud LLM).
 *
 * Asserts:
 *  - processChat uses GGUF even when OPENAI_API_KEY is set (fake key)
 *  - offline reply (GGUF unavailable + DB unavailable) is non-empty in en + vi
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const isGgufAvailable = vi.fn();
const chatCompletion = vi.fn();

vi.mock("./aiGgufEngine", () => ({
  isGgufAvailable: (...a: unknown[]) => isGgufAvailable(...a),
  chatCompletion: (...a: unknown[]) => chatCompletion(...a),
}));

// DB unavailable → tools return {error}, offline path still produces text.
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => null) }));

import { processChat } from "./aiChatAssistant";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("processChat — GGUF-first ordering", () => {
  it("uses GGUF (not cloud) even when OPENAI_API_KEY is set", async () => {
    process.env.OPENAI_API_KEY = "sk-fake-should-be-ignored";
    isGgufAvailable.mockResolvedValue(true);
    chatCompletion
      .mockResolvedValueOnce({ text: '{"tools":[]}', tokensGenerated: 1, tokensPrompt: 1 }) // tool selection
      .mockResolvedValueOnce({ text: "Phân tích từ local LLM", tokensGenerated: 10, tokensPrompt: 5 }); // narration

    const res = await processChat({
      conversationId: "c1",
      messages: [],
      userMessage: "Tổng quan chất lượng",
      language: "vi",
    });

    expect(isGgufAvailable).toHaveBeenCalled();
    expect(chatCompletion).toHaveBeenCalled();
    expect(res.reply).toContain("Phân tích từ local LLM");
    expect(res.reply).toContain("GGUF");

    delete process.env.OPENAI_API_KEY;
  });

  it("offline fallback returns non-empty reply (vi)", async () => {
    isGgufAvailable.mockResolvedValue(false);
    const res = await processChat({
      conversationId: "c2",
      messages: [],
      userMessage: "xin chào",
      language: "vi",
    });
    expect(res.reply.trim().length).toBeGreaterThan(0);
    expect(res.reply).not.toContain("OPENAI_API_KEY");
  });

  it("offline fallback returns non-empty reply (en)", async () => {
    isGgufAvailable.mockResolvedValue(false);
    const res = await processChat({
      conversationId: "c3",
      messages: [],
      userMessage: "hello",
      language: "en",
    });
    expect(res.reply.trim().length).toBeGreaterThan(0);
    expect(res.reply).not.toContain("OPENAI_API_KEY");
  });
});
