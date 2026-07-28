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
// Fix round 2 (I-4) — submitFeedback's ownership check moved from
// getAiSpecialistSessionById to getAiSpecialistSessionDetail: SAME userId-scoped
// WHERE, but it also returns `steps`, which is where the server-side truth
// (`repoContextSummary`) lives. The ownership assertions below are unchanged in
// strength — only the function they name.
const getSessionDetailMock = vi.fn(async (): Promise<any> => ({ id: 42 }));
const upsertFeedbackMock = vi.fn(async () => ({ ok: true }));
vi.mock("../db/aiSpecialist", () => ({
  createAiSpecialistSession: vi.fn(async () => ({ id: 42 })),
  appendAiSpecialistSessionStep: (...a: any[]) => appendMock(...a),
  completeAiSpecialistSession: (...a: any[]) => completeMock(...a),
  getAiSpecialistSessionDetail: (...a: any[]) => getSessionDetailMock(...(a as [])),
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
  getSessionDetailMock.mockResolvedValue({ id: 42 });
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
// submitFeedback had zero coverage: a future edit dropping the userId-scoped
// session lookup would let a user rate someone else's session with nothing
// catching it.
describe("aiSpecialistAgentRouter.submitFeedback", () => {
  it("phiên không thuộc về người dùng hiện tại ⇒ FORBIDDEN, KHÔNG gọi upsertSpecialistFeedback", async () => {
    getSessionDetailMock.mockResolvedValueOnce(null); // lookup lọc theo userId trả falsy = không phải chủ phiên
    const { aiSpecialistAgentRouter } = await import("./aiSpecialistAgentRouter");
    const caller = aiSpecialistAgentRouter.createCaller(ctx());

    await expect(
      caller.submitFeedback({ sessionId: 999, rating: "useful" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(getSessionDetailMock).toHaveBeenCalledWith(999, ENGINEER.id);
    expect(upsertFeedbackMock).not.toHaveBeenCalled();
  });

  it("phiên thuộc về người dùng hiện tại ⇒ gọi upsertSpecialistFeedback với userId lấy từ ctx (không phải input)", async () => {
    getSessionDetailMock.mockResolvedValueOnce({ id: 999, userId: ENGINEER.id, moduleName: "ai", steps: [] });
    const { aiSpecialistAgentRouter } = await import("./aiSpecialistAgentRouter");
    const caller = aiSpecialistAgentRouter.createCaller(ctx());

    const res = await caller.submitFeedback({ sessionId: 999, rating: "useful" });

    expect(res).toEqual({ ok: true });
    expect(upsertFeedbackMock).toHaveBeenCalledTimes(1);
    expect(upsertFeedbackMock.mock.calls[0]![0]).toMatchObject({ sessionId: 999, userId: ENGINEER.id });
  });

  // I-4 — client GỬI GÌ CŨNG KHÔNG ĂN THUA: 3 trường agentId/moduleName/
  // repoContextUsed đã bị bỏ khỏi hợp đồng input, giá trị lưu luôn suy ra từ
  // phiên trên máy chủ. zod strip khoá lạ, nên gửi thừa không lỗi — nhưng cũng
  // không có tác dụng gì.
  it("client gửi kèm agentId/moduleName/repoContextUsed sai ⇒ bị phớt lờ, giá trị lưu lấy theo phiên", async () => {
    getSessionDetailMock.mockResolvedValueOnce({
      id: 999,
      userId: ENGINEER.id,
      moduleName: "ai-inspection",
      requestedAgents: ["qa-optimizer"],
      steps: [{ agentId: "qa-optimizer", inputPayload: { repoContextSummary: { filesRead: 3, skipped: 1, truncated: 0, totalBytes: 10 } } }],
    });
    const { aiSpecialistAgentRouter } = await import("./aiSpecialistAgentRouter");
    const caller = aiSpecialistAgentRouter.createCaller(ctx());

    await caller.submitFeedback({
      sessionId: 999,
      rating: "useful",
      // @ts-expect-error — 3 trường này CỐ Ý không còn trong hợp đồng input
      agentId: "data-analyst",
      moduleName: "phịa",
      repoContextUsed: false,
    });

    expect(upsertFeedbackMock.mock.calls[0]![0]).toMatchObject({
      agentId: "qa-optimizer",
      moduleName: "ai-inspection",
      repoContextUsed: true,
    });
  });

  // I-2 — bật công tắc "cho agent đọc mã" nhưng đọc được 0 file (ô File liên
  // quan bỏ trống, gõ sai đường dẫn, file .py, file trong node_modules/…) thì
  // prompt GIỐNG HỆT lúc tắt mắt ⇒ phiếu phải ghi "không có mắt".
  it("phiên đọc được 0 file ⇒ repoContextUsed = false (dù công tắc bật)", async () => {
    getSessionDetailMock.mockResolvedValueOnce({
      id: 999,
      userId: ENGINEER.id,
      moduleName: null,
      requestedAgents: ["backend-engineer"],
      steps: [{ agentId: "backend-engineer", inputPayload: { repoContextSummary: { filesRead: 0, skipped: 2, truncated: 0, totalBytes: 0 } } }],
    });
    const { aiSpecialistAgentRouter } = await import("./aiSpecialistAgentRouter");
    const caller = aiSpecialistAgentRouter.createCaller(ctx());

    await caller.submitFeedback({ sessionId: 999, rating: "partial" });

    expect(upsertFeedbackMock.mock.calls[0]![0]).toMatchObject({
      agentId: "backend-engineer",
      moduleName: null,
      repoContextUsed: false,
    });
  });
});

describe("deriveFeedbackFacts (hàm thuần — máy chủ là nguồn sự thật)", () => {
  it("filesRead = 0 ⇒ repoContextUsed false; filesRead > 0 ⇒ true", async () => {
    const { deriveFeedbackFacts } = await import("./aiSpecialistAgentRouter");
    const mk = (filesRead: number) => ({
      moduleName: "m",
      requestedAgents: ["backend-engineer"],
      steps: [{ agentId: "backend-engineer", inputPayload: { repoContextSummary: { filesRead } } }],
    });
    expect(deriveFeedbackFacts(mk(0)).repoContextUsed).toBe(false);
    expect(deriveFeedbackFacts(mk(3)).repoContextUsed).toBe(true);
  });

  it("phiên cũ KHÔNG có repoContextSummary ⇒ repoContextUsed false (không đoán bừa là true)", async () => {
    const { deriveFeedbackFacts } = await import("./aiSpecialistAgentRouter");
    const facts = deriveFeedbackFacts({
      moduleName: null,
      requestedAgents: ["data-analyst"],
      steps: [{ agentId: "data-analyst", inputPayload: { objective: "x" } }],
    });
    expect(facts).toEqual({ agentId: "data-analyst", moduleName: null, repoContextUsed: false });
  });

  it("phiên chưa có bước nào ⇒ lấy agent đầu tiên trong requestedAgents", async () => {
    const { deriveFeedbackFacts } = await import("./aiSpecialistAgentRouter");
    expect(deriveFeedbackFacts({ moduleName: "m", requestedAgents: ["frontend-engineer", "qa-optimizer"], steps: [] }).agentId)
      .toBe("frontend-engineer");
  });

  it("không có gì để suy ⇒ 'unknown', KHÔNG ném", async () => {
    const { deriveFeedbackFacts } = await import("./aiSpecialistAgentRouter");
    expect(deriveFeedbackFacts({})).toEqual({ agentId: "unknown", moduleName: null, repoContextUsed: false });
  });
});

// I-5 — 256KB mã nguồn + mảnh RAG KHÔNG được nằm trong inputPayload lưu xuống DB
// (getSessionDetail đẩy nguyên khối đó về trình duyệt mỗi 2s khi poll).
describe("runSpecialistSessionInBackground — không lưu nguyên khối ngữ cảnh (I-5)", () => {
  it("inputPayload lưu bản TÓM TẮT, không có repoContext", async () => {
    const { runSpecialistSessionInBackground } = await import("./aiSpecialistAgentRouter");
    runAgentMock.mockResolvedValue({
      agent: { id: "backend-engineer" },
      modelId: "m",
      output: { summary: "ok" },
      metrics: { tokensPrompt: 1, tokensGenerated: 2, totalTimeMs: 3, tokensPerSecond: 4 },
    });

    await runSpecialistSessionInBackground({
      sessionId: 42,
      userId: 1,
      runInput: {
        agentId: "backend-engineer",
        objective: "x".repeat(20),
        repoContext: {
          files: [
            { path: "a.ts", content: "MÃ-NGUỒN-KHỔNG-LỒ", bytes: 10, truncated: true, redacted: false },
            { path: "b.ts", content: "y", bytes: 1, truncated: false, redacted: false },
          ],
          skipped: [{ path: "c.py", reason: "DENIED_EXT" }],
          dependencies: [],
          ragSnippets: [],
          totalBytes: 11,
        },
      } as any,
    });

    // Model vẫn nhận đủ ngữ cảnh…
    expect(runAgentMock.mock.calls[0]![0].repoContext.files).toHaveLength(2);
    // …nhưng DB thì không.
    const saved = appendMock.mock.calls[0]![0] as any;
    expect(saved.inputPayload.repoContext).toBeUndefined();
    expect(JSON.stringify(saved.inputPayload)).not.toContain("MÃ-NGUỒN-KHỔNG-LỒ");
    expect(saved.inputPayload.repoContextSummary).toEqual({
      filesRead: 2, skipped: 1, truncated: 1, totalBytes: 11,
    });
  });

  it("tắt mắt (không có repoContext) ⇒ tóm tắt toàn 0", async () => {
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

    expect((appendMock.mock.calls[0]![0] as any).inputPayload.repoContextSummary).toEqual({
      filesRead: 0, skipped: 0, truncated: 0, totalBytes: 0,
    });
  });
});
