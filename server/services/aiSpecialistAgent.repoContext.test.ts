import { describe, it, expect, vi, beforeEach } from "vitest";

// Wave 1 FF-A fix-round 4 — `runSpecialistAgent`'s grammar-constrained
// `generateJSON` path (round 2) was REVERTED (live measurement showed it
// degraded output CONTENT — see the doc comment on `runSpecialistAgent` in
// aiSpecialistAgentService.ts). The primary — and only — generation call is
// `generateText` again, exactly as before round 2. Mock only what the
// service module actually imports now.
vi.mock("./aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  generateText: vi.fn(async () => ({
    text: JSON.stringify({ summary: "s", diagnosis: "d", actionPlan: [], patchHints: [], testPlan: [], optimizationIdeas: [], risks: [] }),
    modelId: "test-model",
    tokensGenerated: 10, tokensPrompt: 20, totalTimeMs: 100, tokensPerSecond: 5,
  })),
}));
import { generateText } from "./aiGgufEngine";
import { runSpecialistAgent } from "./aiSpecialistAgentService";

beforeEach(() => vi.clearAllMocks());

describe("runSpecialistAgent — repoContext", () => {
  it("KHÔNG có repoContext ⇒ prompt giữ nguyên hành vi cũ (chỉ tên file)", async () => {
    await runSpecialistAgent({
      agentId: "backend-engineer",
      objective: "sửa lỗi X trong service",
      files: ["server/services/a.ts"],
    });
    expect(generateText).toHaveBeenCalledTimes(1);
    const prompt = (generateText as any).mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Related files:");
    expect(prompt).toContain("server/services/a.ts");
    expect(prompt).not.toContain("FILE CONTENT");
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
    const prompt = (generateText as any).mock.calls[0][0].prompt as string;
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
    const prompt = (generateText as any).mock.calls[0][0].prompt as string;
    expect(prompt).toContain("truncated");
  });
});
