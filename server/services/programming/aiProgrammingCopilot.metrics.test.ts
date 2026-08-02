/**
 * Đợt 2 · Task 2 (doc71) — copilot lập trình phải ĐI QUA aiGateway để lượt gọi thật ghi được
 * vào `ai_gateway_metrics`. Trước sửa: `aiProgrammingCopilot.ts` gọi THẲNG `aiGgufEngine`
 * (chatCompletion/generateJSON/generateFim), không qua `aiGateway.planInference()` — nên
 * `ai_gateway_metrics` LUÔN 0 dòng cho task 'code'/'fim' dù copilot chạy thật (Đợt 0 đo được
 * 6 lượt thật ⇒ 0 dòng). Test này KHÔNG chứng minh dòng thật vào DB (đó là việc của truy vấn
 * SQL sống — xem task-2-report.md) — nó chỉ khoá HÀNH VI NỐI DÂY: một lượt sinh mã (mode
 * "generate") phải gọi `aiGateway.planInference({task:"code", …})` rồi gọi `plan.record(...)`
 * ĐÚNG MỘT LẦN cho lượt đó.
 *
 * Mock TỐI THIỂU, mô phỏng đúng shape thật (không phải shape mẫu trong brief — hàm xuất khẩu
 * thật là `generateProgram` với field `request`, không phải `copilotGenerate`/`prompt`; và
 * `aiGateway` không xuất `enqueue` — chỉ xuất `planInference`, nên mock đó, không mock `enqueue`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
const recordSpy = vi.fn();
const planInferenceSpy = vi.fn(async (req: { task: string; text?: string }) => ({
  decision: {
    tier: 2,
    modelId: "Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL",
    requiresHitl: false,
    maxTokens: 1536,
    temperature: 0.3,
    jsonMode: false,
  },
  abVariant: null as "A" | "B" | null,
  record: recordSpy,
  safeText: req.text ?? "",
  safetyFlags: { scope: "input", risk: "none", matched: [], redactedCount: 0, redactionTypes: [] },
  sanitizeOutput: (t: string) => t,
}));

vi.mock("../aiGateway", () => ({
  planInference: (...a: any[]) => planInferenceSpy(a[0]),
}));

import { generateProgram } from "./aiProgrammingCopilot";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_PROGRAMMING_COPILOT_ENABLED = "true";
});

describe("aiProgrammingCopilot — nối qua aiGateway để ghi ai_gateway_metrics (Đợt 2 · Task 2)", () => {
  it("một lượt sinh mã (generateProgram, mode mặc định 'generate') gọi planInference với task='code' và ghi ĐÚNG MỘT dòng metric", async () => {
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
});
