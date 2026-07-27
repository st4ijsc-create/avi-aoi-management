import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

const completeMock = vi.fn(async () => {});
const appendMock = vi.fn(async () => {});
vi.mock("../db/aiSpecialist", () => ({
  createAiSpecialistSession: vi.fn(async () => ({ id: 42 })),
  appendAiSpecialistSessionStep: (...a: any[]) => appendMock(...a),
  completeAiSpecialistSession: (...a: any[]) => completeMock(...a),
  getAiSpecialistSessionById: vi.fn(async () => ({ id: 42 })),
  getAiSpecialistSessionDetail: vi.fn(async () => ({ id: 42 })),
  listAiSpecialistSessions: vi.fn(async () => []),
  getModuleImprovementStats: vi.fn(async () => ({})),
}));

const runAgentMock = vi.fn();
vi.mock("../services/aiSpecialistAgentService", () => ({
  runSpecialistAgent: (...a: any[]) => runAgentMock(...a),
  runSpecialistWorkflowChain: vi.fn(),
  listSpecialistAgents: vi.fn(() => []),
  buildWorkflowAgentOrder: vi.fn(() => ["backend-engineer"]),
  listModuleAuditPresets: vi.fn(() => []),
  getModuleAuditPreset: vi.fn(),
  SPECIALIST_BRIDGE_TOOLS: [],
  ensureSpecialistBridgeToolsRegistered: vi.fn(),
}));
vi.mock("../services/ai/repoContextService", () => ({
  gatherRepoContext: vi.fn(async () => ({ files: [], skipped: [], dependencies: [], ragSnippets: [], totalBytes: 0 })),
}));

import { runSpecialistSessionInBackground } from "./aiSpecialistAgentRouter";

beforeEach(() => { vi.clearAllMocks(); });

describe("runSpecialistSessionInBackground", () => {
  it("model lỗi ⇒ phiên được đánh dấu failed, KHÔNG ném ra ngoài", async () => {
    runAgentMock.mockRejectedValue(new Error("model boom"));
    await expect(
      runSpecialistSessionInBackground({
        sessionId: 42, userId: 1,
        runInput: { agentId: "backend-engineer", objective: "x".repeat(20) },
      }),
    ).resolves.toBeUndefined();
    expect(completeMock).toHaveBeenCalledWith(42, 1, expect.objectContaining({ status: "failed" }));
  });

  it("chạy xong ⇒ phiên completed + có bước được ghi", async () => {
    runAgentMock.mockResolvedValue({
      agent: { id: "backend-engineer" },
      modelId: "m",
      output: { summary: "ok" },
      metrics: { tokensPrompt: 1, tokensGenerated: 2, totalTimeMs: 3, tokensPerSecond: 4 },
    });
    await runSpecialistSessionInBackground({
      sessionId: 42, userId: 1,
      runInput: { agentId: "backend-engineer", objective: "x".repeat(20) },
    });
    expect(appendMock).toHaveBeenCalled();
    expect(completeMock).toHaveBeenCalledWith(42, 1, expect.objectContaining({ status: "completed" }));
  });
});

it("KHÔNG còn procedure nào dùng protectedProcedure (chống tụt quyền về sau)", () => {
  const src = fs.readFileSync("server/routers/aiSpecialistAgentRouter.ts", "utf8");
  expect(src).not.toMatch(/\bprotectedProcedure\b/);
});
