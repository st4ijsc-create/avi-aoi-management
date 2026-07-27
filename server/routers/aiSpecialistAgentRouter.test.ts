import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

// Fix round 1 (IMPORTANT-3) — the new submitFeedback test below goes through the
// REAL tRPC caller (specialistProcedure = roleProcedure + moduleGate("MOD_AI")),
// unlike the pre-existing tests in this file which only call the exported
// background-runner functions directly and never touch moduleGate. Without this,
// moduleGate's entitlement resolution touches "../db" for real (server/_core/
// moduleGate.ts) — mirrors server/routers/aiSpecialistActionBridge.test.ts's exact
// same workaround for the exact same router. MUST be set before "../_core/env" is
// ever evaluated, and ESM static imports are hoisted ahead of any top-level
// statement — so the router is imported DYNAMICALLY in every test below, never via
// a top-level `import ... from "./aiSpecialistAgentRouter"`.
process.env.LICENSE_BYPASS = "true";

const completeMock = vi.fn(async () => {});
const appendMock = vi.fn(async () => {});
const getSessionByIdMock = vi.fn(async () => ({ id: 42 }));
const upsertFeedbackMock = vi.fn(async () => ({ ok: true }));
vi.mock("../db/aiSpecialist", () => ({
  createAiSpecialistSession: vi.fn(async () => ({ id: 42 })),
  appendAiSpecialistSessionStep: (...a: any[]) => appendMock(...a),
  completeAiSpecialistSession: (...a: any[]) => completeMock(...a),
  getAiSpecialistSessionById: (...a: any[]) => getSessionByIdMock(...a),
  getAiSpecialistSessionDetail: vi.fn(async () => ({ id: 42 })),
  listAiSpecialistSessions: vi.fn(async () => []),
  getModuleImprovementStats: vi.fn(async () => ({})),
  upsertSpecialistFeedback: (...a: any[]) => upsertFeedbackMock(...a),
  getSpecialistQualityScoreboard: vi.fn(async () => ({ rows: [], overall: { total: 0, usefulPct: 0 } })),
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

const ENGINEER = { id: 7, role: "engineer", name: "Eng", twoFactorEnabled: true };

function ctx(user: typeof ENGINEER = ENGINEER) {
  return { user, req: {} } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionByIdMock.mockResolvedValue({ id: 42 });
  upsertFeedbackMock.mockResolvedValue({ ok: true });
});

describe("runSpecialistSessionInBackground", () => {
  it("model lỗi ⇒ phiên được đánh dấu failed, KHÔNG ném ra ngoài", async () => {
    const { runSpecialistSessionInBackground } = await import("./aiSpecialistAgentRouter");
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
    const { runSpecialistSessionInBackground } = await import("./aiSpecialistAgentRouter");
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

// IMPORTANT-3 fix-round (Task 3 review) — the FORBIDDEN ownership guard on
// submitFeedback had zero coverage: a future edit dropping the
// getAiSpecialistSessionById(...) check would let a user rate someone else's
// session with nothing catching it.
describe("aiSpecialistAgentRouter.submitFeedback", () => {
  it("phiên không thuộc về người dùng hiện tại ⇒ FORBIDDEN, KHÔNG gọi upsertSpecialistFeedback", async () => {
    getSessionByIdMock.mockResolvedValueOnce(null); // getAiSpecialistSessionById trả falsy = không phải chủ phiên
    const { aiSpecialistAgentRouter } = await import("./aiSpecialistAgentRouter");
    const caller = aiSpecialistAgentRouter.createCaller(ctx());

    await expect(
      caller.submitFeedback({
        sessionId: 999,
        agentId: "backend-engineer",
        rating: "useful",
        repoContextUsed: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(getSessionByIdMock).toHaveBeenCalledWith(999, ENGINEER.id);
    expect(upsertFeedbackMock).not.toHaveBeenCalled();
  });

  it("phiên thuộc về người dùng hiện tại ⇒ gọi upsertSpecialistFeedback với userId lấy từ ctx (không phải input)", async () => {
    getSessionByIdMock.mockResolvedValueOnce({ id: 999, userId: ENGINEER.id });
    const { aiSpecialistAgentRouter } = await import("./aiSpecialistAgentRouter");
    const caller = aiSpecialistAgentRouter.createCaller(ctx());

    const res = await caller.submitFeedback({
      sessionId: 999,
      agentId: "backend-engineer",
      rating: "useful",
      repoContextUsed: true,
    });

    expect(res).toEqual({ ok: true });
    expect(upsertFeedbackMock).toHaveBeenCalledTimes(1);
    expect(upsertFeedbackMock.mock.calls[0]![0]).toMatchObject({ sessionId: 999, userId: ENGINEER.id });
  });
});
