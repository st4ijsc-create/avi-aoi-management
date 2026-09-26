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
const runWorkflowChainMock = vi.fn();
const getModuleAuditPresetMock = vi.fn();
vi.mock("../services/aiSpecialistAgentService", () => ({
  runSpecialistAgent: (...a: any[]) => runAgentMock(...a),
  runSpecialistWorkflowChain: (...a: any[]) => runWorkflowChainMock(...a),
  listSpecialistAgents: vi.fn(() => []),
  buildWorkflowAgentOrder: vi.fn(() => ["backend-engineer"]),
  listModuleAuditPresets: vi.fn(() => []),
  getModuleAuditPreset: (...a: any[]) => getModuleAuditPresetMock(...a),
  SPECIALIST_BRIDGE_TOOLS: [],
  ensureSpecialistBridgeToolsRegistered: vi.fn(),
}));
// Wave 1 FF-B — `gatherRepoContextMock` is a named outer const (not inlined in the
// factory) so individual tests can override its behaviour (never-resolving promise,
// reject, custom resolved value) to prove the request path never awaits it.
const gatherRepoContextMock = vi.fn(async () => ({ files: [], skipped: [], dependencies: [], ragSnippets: [], totalBytes: 0 }));
vi.mock("../services/ai/repoContextService", () => ({
  gatherRepoContext: (...a: any[]) => gatherRepoContextMock(...a),
}));

const ENGINEER = { id: 7, role: "engineer", name: "Eng", twoFactorEnabled: true };

function ctx(user: typeof ENGINEER = ENGINEER) {
  return { user, req: {} } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionDetailMock.mockResolvedValue({ id: 42 });
  upsertFeedbackMock.mockResolvedValue({ ok: true });
  // Fresh default per test — some tests below override this via mockReturnValueOnce/
  // mockRejectedValueOnce, which `clearAllMocks()` (mockClear, NOT mockReset) does not
  // drain from the once-queue. Re-asserting the plain resolved default here keeps any
  // earlier test's *Once queue from leaking into a later test that expects the default.
  gatherRepoContextMock.mockReset();
  gatherRepoContextMock.mockImplementation(async () => ({ files: [], skipped: [], dependencies: [], ragSnippets: [], totalBytes: 0 }));
});

describe("runSpecialistSessionInBackground", () => {
  it("model lỗi ⇒ phiên được đánh dấu failed, KHÔNG ném ra ngoài", async () => {
    const { runSpecialistSessionInBackground } = await import("./aiSpecialistAgentRouter");
    runAgentMock.mockRejectedValue(new Error("model boom"));
    await expect(
      runSpecialistSessionInBackground({
        sessionId: 42, userId: 1,
        runInput: { agentId: "backend-engineer", objective: "x".repeat(20) },
        gatherContext: null,
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
      gatherContext: null,
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
// (getSessionDetail đẩy nguyên khối đó về trình duyệt mỗi 2s khi poll). Wave 1
// FF-B đổi chỗ NẠP ngữ cảnh (nay xảy ra BÊN TRONG hàm nền, qua `gatherContext`
// thay vì `runInput.repoContext` đã nạp sẵn) — các test dưới đây được viết lại
// theo chữ ký mới, nhưng vẫn khẳng định đúng bất biến I-5 cũ.
describe("runSpecialistSessionInBackground — Wave 1 FF-B (nạp ngữ cảnh trong nền, brief test #2-#5)", () => {
  it("2. gatherContext khác null ⇒ gatherRepoContext được gọi ĐÚNG 1 LẦN, runSpecialistAgent nhận repoContext đã nạp", async () => {
    const loaded = {
      files: [{ path: "a.ts", content: "export const A = 1;", bytes: 20, truncated: false, redacted: false }],
      skipped: [], dependencies: [], ragSnippets: [], totalBytes: 20,
    };
    gatherRepoContextMock.mockResolvedValueOnce(loaded);
    runAgentMock.mockResolvedValue({
      agent: { id: "backend-engineer" }, modelId: "m", output: { summary: "ok" },
      metrics: { tokensPrompt: 1, tokensGenerated: 2, totalTimeMs: 3, tokensPerSecond: 4 },
    });

    const { runSpecialistSessionInBackground } = await import("./aiSpecialistAgentRouter");
    await runSpecialistSessionInBackground({
      sessionId: 42, userId: 1,
      runInput: { agentId: "backend-engineer", objective: "x".repeat(20) },
      gatherContext: { files: ["a.ts"], objective: "x".repeat(20) },
    });

    expect(gatherRepoContextMock).toHaveBeenCalledTimes(1);
    expect(gatherRepoContextMock).toHaveBeenCalledWith({ files: ["a.ts"], objective: "x".repeat(20) });
    expect(runAgentMock.mock.calls[0]![0].repoContext).toEqual(loaded);
  });

  it("3. gatherContext: null (tắt mắt) ⇒ gatherRepoContext KHÔNG được gọi; runSpecialistAgent nhận repoContext=undefined", async () => {
    runAgentMock.mockResolvedValue({
      agent: { id: "backend-engineer" }, modelId: "m", output: { summary: "ok" },
      metrics: { tokensPrompt: 1, tokensGenerated: 2, totalTimeMs: 3, tokensPerSecond: 4 },
    });

    const { runSpecialistSessionInBackground } = await import("./aiSpecialistAgentRouter");
    await runSpecialistSessionInBackground({
      sessionId: 42, userId: 1,
      runInput: { agentId: "backend-engineer", objective: "x".repeat(20) },
      gatherContext: null,
    });

    expect(gatherRepoContextMock).not.toHaveBeenCalled();
    expect(runAgentMock.mock.calls[0]![0].repoContext).toBeUndefined();
  });

  it("4. gatherRepoContext bị lỗi ⇒ phiên vẫn kết thúc failed, hàm nền KHÔNG ném (fire-and-forget sống còn)", async () => {
    gatherRepoContextMock.mockRejectedValueOnce(new Error("rag boom"));

    const { runSpecialistSessionInBackground } = await import("./aiSpecialistAgentRouter");
    await expect(
      runSpecialistSessionInBackground({
        sessionId: 42, userId: 1,
        runInput: { agentId: "backend-engineer", objective: "x".repeat(20) },
        gatherContext: { files: [], objective: "x".repeat(20) },
      }),
    ).resolves.toBeUndefined();

    expect(completeMock).toHaveBeenCalledWith(42, 1, expect.objectContaining({ status: "failed" }));
    // Không tới được bước gọi model — lỗi xảy ra trước đó, ở bước nạp ngữ cảnh.
    expect(runAgentMock).not.toHaveBeenCalled();
  });

  it("5a. inputPayload lưu bản TÓM TẮT repoContextSummary, KHÔNG chứa nội dung file (chống hồi quy I-5)", async () => {
    gatherRepoContextMock.mockResolvedValueOnce({
      files: [
        { path: "a.ts", content: "MÃ-NGUỒN-KHỔNG-LỒ", bytes: 10, truncated: true, redacted: false },
        { path: "b.ts", content: "y", bytes: 1, truncated: false, redacted: false },
      ],
      skipped: [{ path: "c.py", reason: "DENIED_EXT" }],
      dependencies: [],
      ragSnippets: [],
      totalBytes: 11,
    });
    runAgentMock.mockResolvedValue({
      agent: { id: "backend-engineer" },
      modelId: "m",
      output: { summary: "ok" },
      metrics: { tokensPrompt: 1, tokensGenerated: 2, totalTimeMs: 3, tokensPerSecond: 4 },
    });

    const { runSpecialistSessionInBackground } = await import("./aiSpecialistAgentRouter");
    await runSpecialistSessionInBackground({
      sessionId: 42,
      userId: 1,
      runInput: { agentId: "backend-engineer", objective: "x".repeat(20) },
      gatherContext: { files: ["a.ts", "b.ts"], objective: "x".repeat(20) },
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

  it("5b. tắt mắt (gatherContext: null) ⇒ tóm tắt toàn 0", async () => {
    runAgentMock.mockResolvedValue({
      agent: { id: "backend-engineer" },
      modelId: "m",
      output: { summary: "ok" },
      metrics: { tokensPrompt: 1, tokensGenerated: 2, totalTimeMs: 3, tokensPerSecond: 4 },
    });

    const { runSpecialistSessionInBackground } = await import("./aiSpecialistAgentRouter");
    await runSpecialistSessionInBackground({
      sessionId: 42, userId: 1,
      runInput: { agentId: "backend-engineer", objective: "x".repeat(20) },
      gatherContext: null,
    });

    expect((appendMock.mock.calls[0]![0] as any).inputPayload.repoContextSummary).toEqual({
      filesRead: 0, skipped: 0, truncated: 0, totalBytes: 0,
    });
  });
});

// Wave 1 FF-B — brief test #1: request path (procedure `run`) must NEVER await
// gatherRepoContext. Proven by making it a promise that NEVER resolves — if `run`
// still awaited it directly (the pre-fix bug), this test would hang/timeout instead
// of resolving with {sessionId, started:true}.
describe("aiSpecialistAgentRouter — Wave 1 FF-B: request path không chờ gatherRepoContext", () => {
  it("1. run() vẫn trả {sessionId,started:true} ngay cả khi gatherRepoContext KHÔNG BAO GIỜ resolve", async () => {
    gatherRepoContextMock.mockReturnValueOnce(new Promise(() => { /* không bao giờ resolve */ }));
    const { aiSpecialistAgentRouter } = await import("./aiSpecialistAgentRouter");
    const caller = aiSpecialistAgentRouter.createCaller(ctx());

    const res = await caller.run({ agentId: "backend-engineer", objective: "x".repeat(20) });

    expect(res).toEqual({ sessionId: 42, started: true });
  });

  it("runWorkflowChain() vẫn trả {sessionId,started:true} ngay cả khi gatherRepoContext KHÔNG BAO GIỜ resolve", async () => {
    gatherRepoContextMock.mockReturnValueOnce(new Promise(() => { /* không bao giờ resolve */ }));
    const { aiSpecialistAgentRouter } = await import("./aiSpecialistAgentRouter");
    const caller = aiSpecialistAgentRouter.createCaller(ctx());

    const res = await caller.runWorkflowChain({ objective: "x".repeat(20) });

    expect(res).toEqual({ sessionId: 42, started: true });
  });

  it("runModuleAudit() vẫn trả {sessionId,started:true} ngay cả khi gatherRepoContext KHÔNG BAO GIỜ resolve (module-audit nạp ngữ cảnh vô điều kiện)", async () => {
    getModuleAuditPresetMock.mockReturnValueOnce({
      id: "ai-chat",
      label: "AI Chat Module",
      description: "d",
      moduleName: "ai-chat",
      files: ["server/routers/aiChatRouter.ts"],
      techStack: ["tRPC"],
      objective: "Audit module AI Chat",
      constraints: [],
      includeBackend: true,
      includeFrontend: true,
      includeQa: true,
    });
    gatherRepoContextMock.mockReturnValueOnce(new Promise(() => { /* không bao giờ resolve */ }));
    const { aiSpecialistAgentRouter } = await import("./aiSpecialistAgentRouter");
    const caller = aiSpecialistAgentRouter.createCaller(ctx());

    const res = await caller.runModuleAudit({ presetId: "ai-chat" });

    expect(res).toEqual({ sessionId: 42, started: true });
    // "vô điều kiện" — được GỌI (chỉ là không được AWAIT ở request path), không có
    // công tắc includeRepoContext trong input schema của runModuleAudit.
    // Task 6 (SECURITY, final-fix round) — `callerRole` now threads ctx.user.role through so
    // retrieveKnowledge's Studio-corpus gate sees the (already admin/engineer-only, via
    // specialistProcedure) caller.
    expect(gatherRepoContextMock).toHaveBeenCalledWith({
      files: ["server/routers/aiChatRouter.ts"],
      objective: "Audit module AI Chat",
      callerRole: "engineer",
    });
  });
});
