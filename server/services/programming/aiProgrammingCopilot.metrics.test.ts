/**
 * Đợt 2 · Task 2 (doc71) — copilot lập trình phải ĐI QUA aiGateway để lượt gọi thật ghi được
 * vào `ai_gateway_metrics`. Trước sửa: `aiProgrammingCopilot.ts` gọi THẲNG `aiGgufEngine`
 * (chatCompletion/generateJSON/generateFim), không qua `aiGateway.planInference()` — nên
 * `ai_gateway_metrics` LUÔN 0 dòng cho task 'code'/'fim' dù copilot chạy thật (Đợt 0 đo được
 * 6 lượt thật ⇒ 0 dòng). Test này KHÔNG chứng minh dòng thật vào DB (đó là việc của truy vấn
 * SQL sống — xem task-2-report.md) — nó chỉ khoá HÀNH VI NỐI DÂY, cho **cả 3 điểm gọi thẳng
 * engine** (review round 1 bắt: bản đầu chỉ phủ `runCodeModel`, bỏ sót `runStructuredCodeModel`
 * và — hot-path đáng lo nhất — `completeInline`):
 *   1. `runCodeModel`        (chatCompletion,      task "code") — qua generateProgram(mode "generate")
 *   2. `runStructuredCodeModel` (generateJSON<unknown>, task "code") — qua generateProgram(kind "ir-flow")
 *   3. `completeInline`      (generateFim,         task "fim")  — gọi trực tiếp
 *
 * Mock TỐI THIỂU, mô phỏng đúng shape thật (không phải shape mẫu trong brief — hàm xuất khẩu
 * thật là `generateProgram` với field `request`, không phải `copilotGenerate`/`prompt`; và
 * `aiGateway` không xuất `enqueue` — chỉ xuất `planInference`, nên mock đó, không mock `enqueue`).
 *
 * `planInferenceSpy` tính `decision` bằng `aiModelRouter.route()` THẬT (KHÔNG mock module đó) —
 * để assertion "model không phải 'default'" có ý nghĩa thật (gắn với hành vi routing sản xuất
 * cho task "code"/"fim", chứ không phải hằng số tự bịa trong test).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── aiGgufEngine — engine giả, không nạp GGUF thật (mirror aiProgrammingCopilot.test.ts) ──
const isGgufAvailableMock = vi.fn(async () => true);
const chatCompletionMock = vi.fn(async () => ({
  // ST hợp lệ (VAR/END_VAR cân) để validate() thật KHÔNG kích self-repair — giữ record()
  // ở đúng 1 lần cho lượt gọi này.
  text: "```st\nVAR\n  run : BOOL;\nEND_VAR\nrun := TRUE;\n```",
  tokensGenerated: 17,
  tokensPrompt: 42,
  totalTimeMs: 120,
  tokensPerSecond: 141,
  modelId: "mock",
}));
const warmModelMock = vi.fn(async () => true);
const generateJSONMock = vi.fn();
const generateFimMock = vi.fn();

vi.mock("../aiGgufEngine", () => ({
  isGgufAvailable: (...a: any[]) => isGgufAvailableMock(...a),
  chatCompletion: (...a: any[]) => chatCompletionMock(...a),
  warmModel: (...a: any[]) => warmModelMock(...a),
  generateJSON: (...a: any[]) => generateJSONMock(...a),
  generateFim: (...a: any[]) => generateFimMock(...a),
  stripThinking: (t: string) => ({ answer: t, thinking: "" }),
}));

// ── aiProgrammingKnowledgeService — RAG tắt/rỗng, không chạm DB (mirror aiProgrammingCopilot.test.ts) ──
vi.mock("../aiProgrammingKnowledgeService", () => ({
  searchProgrammingKb: vi.fn(async () => ({
    query: "",
    enabled: false,
    semanticUsed: false,
    answerContext: "",
    citations: [],
    chunks: [],
  })),
}));

// ── aiGateway — CHỈ mock những gì aiProgrammingCopilot.ts thật sự dùng: `planInference`.
// aiGateway KHÔNG xuất `enqueue` (đó là hàm nội bộ, không export) — mock nó là vô nghĩa; brief
// mẫu sai chỗ này. `record` bên trong plan giả lập là cơ chế THẬT sẽ gọi enqueue() ở production.
// `aiModelRouter` KHÔNG bị mock trong file này (xem import tĩnh `route` dưới) — planInferenceSpy
// gọi route() THẬT để decision.modelId phản ánh đúng hành vi routing sản xuất.
const recordSpy = vi.fn();
const planInferenceSpy = vi.fn(async (req: { task: "code" | "fim"; text?: string }) => {
  const { route } = await import("../aiModelRouter");
  const decision = route({ task: req.task, text: req.text, requiredQuality: "high" });
  return {
    decision,
    abVariant: null as "A" | "B" | null,
    record: recordSpy,
    safeText: req.text ?? "",
    safetyFlags: { scope: "input", risk: "none", matched: [], redactedCount: 0, redactionTypes: [] },
    sanitizeOutput: (t: string) => t,
  };
});

vi.mock("../aiGateway", () => ({
  planInference: (...a: any[]) => planInferenceSpy(a[0]),
}));

import { generateProgram, completeInline } from "./aiProgrammingCopilot";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_PROGRAMMING_COPILOT_ENABLED = "true";
  // aiModelRouter.route() THẬT cần các basename này để "code"/"fim" KHÔNG rơi về modelId
  // undefined (điều kiện để toRow() ở production ghi 'default' — đúng bẫy tier "vision" Đợt 0
  // bắt được). vitest.setup.ts KHÔNG nạp .env nên phải set tay ở đây (mirror pinning.test.ts).
  process.env.GGUF_DEFAULT_MODEL = "test-default-model";
  process.env.GGUF_CODE_MODEL = "test-code-model";
  process.env.GGUF_FAST_MODEL = "test-fast-model";
  process.env.GGUF_FIM_MODEL = "test-fim-model";
});
afterEach(() => {
  delete process.env.AI_PROGRAMMING_COPILOT_ENABLED;
  delete process.env.GGUF_DEFAULT_MODEL;
  delete process.env.GGUF_CODE_MODEL;
  delete process.env.GGUF_FAST_MODEL;
  delete process.env.GGUF_FIM_MODEL;
  delete process.env.AI_CODE_ROUTER_ENABLED;
});

/** Lấy plan mà planInferenceSpy đã trả cho lượt gọi thứ `i` (0-based) — để soi decision.modelId. */
async function planAt(i: number) {
  return planInferenceSpy.mock.results[i]!.value as Promise<{ decision: { modelId?: string; tier: number } }>;
}

describe("aiProgrammingCopilot — nối qua aiGateway để ghi ai_gateway_metrics (Đợt 2 · Task 2)", () => {
  it("[runCodeModel] một lượt sinh mã (generateProgram, mode mặc định 'generate') gọi planInference với task='code' và ghi ĐÚNG MỘT dòng metric", async () => {
    const r = await generateProgram({ kind: "iec61131-st", request: "Viết block chớp đèn 1Hz" } as any);

    // Sinh mã vẫn hoạt động bình thường (hành vi sinh mã KHÔNG đổi) — chứng minh việc nối dây
    // không phá luồng cũ.
    expect(r.ok).toBe(true);
    expect(r.code).toContain("run := TRUE");

    // Điểm cốt lõi của Task 2: lượt gọi này phải đi qua aiGateway.planInference với task="code".
    expect(planInferenceSpy).toHaveBeenCalledTimes(1);
    expect(planInferenceSpy.mock.calls[0][0].task).toBe("code");

    // ...và phải ghi ĐÚNG MỘT dòng metric (record() == enqueue() ở production) cho lượt này.
    expect(recordSpy).toHaveBeenCalledTimes(1);
    const outcome = recordSpy.mock.calls[0][0];
    expect(outcome.outcome).toBe("ok");
    expect(typeof outcome.latencyMs).toBe("number");
    expect(outcome.tokensIn).toBe(42);
    expect(outcome.tokensOut).toBe(17);

    // model KHÔNG được là 'default' (bẫy tier "vision" Đợt 0) — route() thật cho task "code"
    // luôn trả modelId tường minh khi GGUF_CODE_MODEL/GGUF_DEFAULT_MODEL có cấu hình.
    const plan = await planAt(0);
    expect(typeof plan.decision.modelId).toBe("string");
    expect(plan.decision.modelId).not.toBe("default");
  });

  it("[runStructuredCodeModel] STRUCTURED KIND (ir-flow → generateJSON<unknown>) gọi planInference với task='code' và ghi ĐÚNG MỘT dòng metric — review round 1 Important-1", async () => {
    // Fixture "safe_move" y hệt aiProgrammingCopilot.test.ts's ir-flow test — lint/transpile thật
    // pass ngay lần đầu, không kích self-repair, giữ record() ở đúng 1 lần.
    const flow = {
      flow_id: "safe_move",
      target_device_type: "universal-robots",
      version: 1,
      blocks: [
        { id: "b1", type: "move_linear", target_pose: { x: 100, y: 100, z: 300, rx: 0, ry: 0, rz: 0 }, speed_mms: 100, acceleration: 1, blend_radius: 0 },
      ],
    };
    generateJSONMock.mockResolvedValueOnce({
      data: flow, raw: JSON.stringify(flow),
      tokensGenerated: 23, tokensPrompt: 61, totalTimeMs: 90, tokensPerSecond: 200, modelId: "mock",
    });

    const r = await generateProgram({ kind: "ir-flow", request: "move linearly to a pick pose" } as any);

    expect(generateJSONMock).toHaveBeenCalledTimes(1);
    expect(chatCompletionMock).not.toHaveBeenCalled(); // đi đường GBNF JSON, không phải free-text
    expect(r.ok).toBe(true);

    expect(planInferenceSpy).toHaveBeenCalledTimes(1);
    expect(planInferenceSpy.mock.calls[0][0].task).toBe("code");

    expect(recordSpy).toHaveBeenCalledTimes(1);
    const outcome = recordSpy.mock.calls[0][0];
    expect(outcome.outcome).toBe("ok");
    expect(outcome.tokensIn).toBe(61);
    expect(outcome.tokensOut).toBe(23);

    const plan = await planAt(0);
    expect(typeof plan.decision.modelId).toBe("string");
    expect(plan.decision.modelId).not.toBe("default");
  });

  it("[completeInline] ghost-text inline (generateFim) gọi planInference với task='fim' và ghi ĐÚNG MỘT dòng metric — review round 1 Important-1 (hot-path lo ngại nhất)", async () => {
    generateFimMock.mockResolvedValueOnce({
      text: "MOVEABS(10)", tokensGenerated: 3, tokensPrompt: 5, totalTimeMs: 40, tokensPerSecond: 75, modelId: "mock",
    });

    const r = await completeInline({ prefix: "MOVE ", suffix: "", language: "zmotion-basic" });

    expect(generateFimMock).toHaveBeenCalledTimes(1);
    expect(r.completion).toBe("MOVEABS(10)"); // ghost-text vẫn hoạt động bình thường

    expect(planInferenceSpy).toHaveBeenCalledTimes(1);
    expect(planInferenceSpy.mock.calls[0][0].task).toBe("fim");

    expect(recordSpy).toHaveBeenCalledTimes(1);
    const outcome = recordSpy.mock.calls[0][0];
    expect(outcome.outcome).toBe("ok");
    expect(outcome.tokensIn).toBe(5);
    expect(outcome.tokensOut).toBe(3);

    const plan = await planAt(0);
    expect(typeof plan.decision.modelId).toBe("string");
    expect(plan.decision.modelId).not.toBe("default");
  });

  it("GGUF offline (isGgufAvailable=false) → KHÔNG gọi planInference, KHÔNG ghi metric (không có gì để đo)", async () => {
    isGgufAvailableMock.mockResolvedValueOnce(false);
    const r = await generateProgram({ kind: "iec61131-st", request: "moving average filter" } as any);
    expect(r.ok).toBe(false);
    expect(planInferenceSpy).not.toHaveBeenCalled();
    expect(recordSpy).not.toHaveBeenCalled();
  });

  it("planInference ném lỗi (rate-limit/…) → KHÔNG được làm hỏng việc sinh mã (fail-open)", async () => {
    planInferenceSpy.mockRejectedValueOnce(new Error("AI rate limit exceeded"));
    const r = await generateProgram({ kind: "iec61131-st", request: "toggle a run bit" } as any);
    // Sinh mã vẫn ra kết quả bình thường dù ghi metric thất bại.
    expect(r.ok).toBe(true);
    expect(r.code).toContain("run := TRUE");
  });

  it("[completeInline] planInference ném lỗi → ghost-text vẫn chạy tiếp, KHÔNG bị chặn (fail-open cho hot-path)", async () => {
    planInferenceSpy.mockRejectedValueOnce(new Error("AI rate limit exceeded"));
    generateFimMock.mockResolvedValueOnce({
      text: "END_IF;", tokensGenerated: 2, tokensPrompt: 2, totalTimeMs: 10, tokensPerSecond: 200, modelId: "mock",
    });
    const r = await completeInline({ prefix: "IF x THEN\n", suffix: "\n" });
    expect(r.completion).toBe("END_IF;");
    expect(generateFimMock).toHaveBeenCalledTimes(1);
  });
});
