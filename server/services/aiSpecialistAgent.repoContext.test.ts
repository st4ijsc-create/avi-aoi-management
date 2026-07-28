import { describe, it, expect, vi, beforeEach } from "vitest";

// Wave 1 FF-A fix-round 2 — `runSpecialistAgent`'s PRIMARY path is now
// `generateJSON` (grammar-constrained), not `generateText`. Mock both (real
// module exports both) so the primary path succeeds and these prompt-content
// assertions exercise the actual call site instead of accidentally falling
// through the fail-safe fallback (which would still pass today, but for the
// wrong reason — a "No generateJSON export defined" mock error swallowed by
// runSpecialistAgent's own catch, not a real assertion of prompt content on
// the primary path).
vi.mock("./aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  generateJSON: vi.fn(async () => ({
    data: {
      summary: "s",
      diagnosis: ["d"],
      actionPlan: [],
      patchHints: [],
      testPlan: [],
      optimizationIdeas: [],
      risks: [],
      reportTemplate: [],
    },
    raw: '{"summary":"s"}',
    modelId: "test-model",
    tokensGenerated: 10,
    tokensPrompt: 20,
    totalTimeMs: 100,
    tokensPerSecond: 5,
  })),
  generateText: vi.fn(async () => ({
    text: JSON.stringify({ summary: "s", diagnosis: "d", actionPlan: [], patchHints: [], testPlan: [], optimizationIdeas: [], risks: [] }),
    modelId: "test-model",
    tokensGenerated: 10, tokensPrompt: 20, totalTimeMs: 100, tokensPerSecond: 5,
  })),
}));
import { generateJSON, generateText } from "./aiGgufEngine";
import { runSpecialistAgent } from "./aiSpecialistAgentService";

beforeEach(() => vi.clearAllMocks());

describe("runSpecialistAgent — repoContext", () => {
  it("KHÔNG có repoContext ⇒ prompt giữ nguyên hành vi cũ (chỉ tên file)", async () => {
    await runSpecialistAgent({
      agentId: "backend-engineer",
      objective: "sửa lỗi X trong service",
      files: ["server/services/a.ts"],
    });
    // generateJSON(schema, options, modelId) — prompt nằm trong options (arg thứ 2).
    const prompt = (generateJSON as any).mock.calls[0][1].prompt as string;
    expect(prompt).toContain("Related files:");
    expect(prompt).toContain("server/services/a.ts");
    expect(prompt).not.toContain("FILE CONTENT");
    expect(generateText).not.toHaveBeenCalled(); // đường chính thành công ⇒ không cần lưới dự phòng
  });

  it("CÓ repoContext ⇒ prompt chứa nội dung file THẬT + phụ thuộc + RAG", async () => {
    await runSpecialistAgent({
      agentId: "backend-engineer",
      objective: "sửa lỗi X trong service",
      files: ["server/services/a.ts"],
      repoContext: {
        files: [{ path: "server/services/a.ts", content: "export const A = 1;", bytes: 19, truncated: false, redacted: false }],
        skipped: [{ path: ".env", reason: "DENIED_SECRET" }],
        dependencies: ["server/services/b.ts"],
        ragSnippets: [{ sourcePath: "server/services/c.ts", text: "ngữ cảnh liên quan", score: 0.8 }],
        totalBytes: 19,
      },
    });
    const prompt = (generateJSON as any).mock.calls[0][1].prompt as string;
    expect(prompt).toContain("FILE CONTENT");
    expect(prompt).toContain("export const A = 1;");
    expect(prompt).toContain("server/services/b.ts");
    expect(prompt).toContain("ngữ cảnh liên quan");
  });

  it("file bị cắt phải được nói rõ trong prompt (không giả vờ là đầy đủ)", async () => {
    await runSpecialistAgent({
      agentId: "backend-engineer",
      objective: "sửa lỗi X",
      repoContext: {
        files: [{ path: "server/services/big.ts", content: "xxx", bytes: 999999, truncated: true, redacted: false }],
        skipped: [], dependencies: [], ragSnippets: [], totalBytes: 3,
      },
    });
    const prompt = (generateJSON as any).mock.calls[0][1].prompt as string;
    expect(prompt).toContain("truncated");
  });
});
