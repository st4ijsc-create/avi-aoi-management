import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const generateFimMock = vi.fn();
vi.mock("../aiGgufEngine", () => ({
  generateFim: (...a: any[]) => generateFimMock(...a),
  isGgufAvailable: vi.fn(async () => true),
  // completeInline destructures { generateFim, stripThinking } from the same dynamic
  // import in one statement — the sibling aiProgrammingCopilot.test.ts mock proves this
  // export is required too (its absence otherwise throws before generateFim is ever
  // called: "No stripThinking export is defined on the mock").
  stripThinking: (t: string) => ({ answer: t, thinking: "" }),
}));

import { completeInline } from "./aiProgrammingCopilot";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_PROGRAMMING_COPILOT_ENABLED = "true";
  // vitest.setup.ts deliberately does NOT load GGUF_*/AI_* flags from .env (so tests don't
  // silently inherit production model config) — completeInline's model-resolution chain
  // (aiModelRouter task:"fim" → modelResolver.fimModelBasename()) needs a REAL basename to
  // resolve, so this test supplies its own, cleaned up in afterEach.
  process.env.GGUF_FAST_MODEL = "test-fim-model";
  generateFimMock.mockResolvedValue({ completion: "x" });
});

afterEach(() => {
  delete process.env.AI_PROGRAMMING_COPILOT_ENABLED;
  delete process.env.GGUF_FAST_MODEL;
});

describe("completeInline — ghim model tường minh", () => {
  it("truyền modelId tường minh cho generateFim (không để engine tự chọn)", async () => {
    await completeInline({ prefix: "MOVE ", suffix: "", language: "zmotion-basic" } as any);
    expect(generateFimMock).toHaveBeenCalled();
    const secondArg = generateFimMock.mock.calls[0][1];
    expect(secondArg).toBeTruthy();
    expect(typeof secondArg).toBe("string");
  });

  it("cờ TẮT ⇒ trả completion rỗng, KHÔNG gọi model (fail-safe cũ giữ nguyên)", async () => {
    process.env.AI_PROGRAMMING_COPILOT_ENABLED = "false";
    const r = await completeInline({ prefix: "a", suffix: "", language: "gcode" } as any);
    expect(r.completion).toBe("");
    expect(generateFimMock).not.toHaveBeenCalled();
  });

  it("generateFim ném ⇒ completion rỗng, KHÔNG ném ra ngoài (gõ phím không được vỡ)", async () => {
    generateFimMock.mockRejectedValue(new Error("boom"));
    const r = await completeInline({ prefix: "a", suffix: "", language: "gcode" } as any);
    expect(r.completion).toBe("");
  });
});
